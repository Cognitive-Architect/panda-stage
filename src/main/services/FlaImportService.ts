import { randomUUID } from 'node:crypto';
import {
  FlaStructureIRSchema,
  FlaBitmapMediaIRSchema,
  type FlaDiagnostic,
  type FlaImportErrorCode,
  type FlaCancelResponse,
  type FlaCancelRequest,
  type FlaInspectionResponse,
  type FlaInspectionTrace,
  type FlaWorkerStartRequest,
  type AnimationImportIR,
  type FlaInspectionIR,
  type FlaRasterPreviewResponse,
} from '../../shared/fla-import-api';
import {
  flaErrorDiagnostics,
  flaRecoveryFailureDiagnostics,
  flaZeroRasterDiagnostic,
} from '../../shared/fla-import-diagnostics';
import {
  finishIssue762Profile,
  startIssue762Profile,
} from '../../shared/issue762-performance-profile';
import type { FlaAssetCommitSession } from './FlaAssetCommitService';
import {
  FlaPreflightError,
  preflightFlaBytes,
  readFlaSourceBytes,
  type FlaPreflightResult,
} from './fla-import-preflight-service';
import {
  classifyForFlaRecovery,
  normalizeRecoveryCandidate,
} from './fla-recovery-classifier.js';
import type { FlaRecoveryClassification } from './fla-recovery-classifier.js';
import {
  FlaParserOperationError,
  FlaParserWindowManager,
} from '../windows/fla-parser-window-manager';

const MAX_SESSIONS = 4;

interface ActiveInspection {
  sessionId: string;
  requestId: string;
  abortController: AbortController;
  stage: 'preflight' | 'parser';
}

type InspectionSession = Extract<FlaInspectionResponse, { ok: true }> & {
  workerSource: FlaWorkerStartRequest['source'];
  mediaLoad?: { operationId: string | null; result: Promise<AnimationImportIR['media']> };
};

function bitmapSourceKey(media: FlaInspectionIR['media'][number]): string {
  return JSON.stringify([media.name, media.sourceReference, media.bitmapDataReference]);
}

function errorResponse(
  code: FlaImportErrorCode,
  message: string,
  options: {
    trace?: FlaInspectionTrace;
    diagnostics?: FlaDiagnostic[];
  } = {},
): FlaInspectionResponse {
  const trimmed = message.trim().slice(0, 1_000) || 'FLA inspection failed';
  const diagnostics = options.diagnostics;
  return {
    ok: false,
    error: { code, message: trimmed },
    diagnostics: diagnostics ?? flaErrorDiagnostics({ code, message: trimmed }),
    ...(options.trace ? { trace: options.trace } : {}),
  };
}

function operationErrorResponse(
  error: unknown,
  trace?: FlaInspectionTrace,
): FlaInspectionResponse {
  if (error instanceof FlaPreflightError || error instanceof FlaParserOperationError) {
    return errorResponse(error.code, error.message, { trace });
  }
  return errorResponse(
    'PARSER_CRASH',
    'FLA inspection failed inside the isolated parser boundary',
    { trace },
  );
}

function initialTrace(
  source: Awaited<ReturnType<typeof readFlaSourceBytes>>,
): FlaInspectionTrace {
  return {
    ingestMode: 'strict',
    recoveryApplied: false,
    originalStrictResult: 'reject',
    classifierState: 'REJECT',
    recoveryAttempted: false,
    postNormalizationStrictResult: 'not-run',
    parserResult: 'not-run',
    originalSourceSha256: source.sha256,
    originalSourceByteLength: source.byteLength,
  };
}

function candidateReason(classification: FlaRecoveryClassification): string | undefined {
  return classification.reasonCodes.find((code) => code.startsWith('RECOVERY_'));
}

export class FlaImportService {
  private readonly parserWindowManager: FlaParserWindowManager;
  private readonly sessions = new Map<string, InspectionSession>();
  private readonly sessionReleasedListeners = new Set<(sessionId: string) => void>();
  private active: ActiveInspection | null = null;
  private cancelledLoad?: Promise<void>;

  constructor(parserWindowManager = new FlaParserWindowManager()) {
    this.parserWindowManager = parserWindowManager;
  }

  async inspectSource(sourcePath: string, requestId: string): Promise<FlaInspectionResponse> {
    if (this.active) {
      return errorResponse('PARSER_CRASH', 'Another FLA inspection is already in progress');
    }
    const sessionId = randomUUID();
    const abortController = new AbortController();
    const active: ActiveInspection = { sessionId, requestId, abortController, stage: 'preflight' };
    const inspectionStartedAt = startIssue762Profile();
    let trace: FlaInspectionTrace | undefined;
    this.active = active;
    try {
      const sourceReadStartedAt = startIssue762Profile();
      const source = await readFlaSourceBytes(sourcePath, abortController.signal);
      finishIssue762Profile('fla.source.file-read', sourceReadStartedAt, {
        requestId,
        byteLength: source.bytes.byteLength,
      });
      const preflightStartedAt = startIssue762Profile();
      let preflight: FlaPreflightResult;
      try {
        preflight = preflightFlaBytes(source.bytes, source.basename, source.sourcePath);
        trace = {
          ...initialTrace(source),
          originalStrictResult: 'pass',
          classifierState: 'STRICT_VALID',
        };
      } catch (error) {
        if (!(error instanceof FlaPreflightError)) throw error;
        const classification = classifyForFlaRecovery(source.bytes);
        trace = {
          ...initialTrace(source),
          classifierState: classification.state,
          classifierReasonCodes: classification.reasonCodes,
        };
        if (classification.state !== 'RECOVERY_CANDIDATE') {
          finishIssue762Profile('fla.source.preflight', preflightStartedAt, {
            requestId,
            outcome: 'rejected',
          });
          return errorResponse(error.code, error.message, {
            trace,
            diagnostics: flaRecoveryFailureDiagnostics(classification.reasonCodes),
          });
        }

        const normalized = normalizeRecoveryCandidate(source.bytes, classification);
        trace = {
          ...trace,
          recoveryAttempted: true,
          recoveryReasonCode: candidateReason(classification),
        };
        if (!normalized.applied) {
          finishIssue762Profile('fla.source.preflight', preflightStartedAt, {
            requestId,
            outcome: 'recovery-not-applied',
          });
          return errorResponse('MALFORMED_ARCHIVE', 'FLA compatibility recovery could not be prepared', {
            trace,
            diagnostics: flaRecoveryFailureDiagnostics([
              ...classification.reasonCodes,
              'RECOVERY_NORMALIZATION_NOT_APPLIED',
            ]),
          });
        }

        try {
          // Recovery is permission to try a Panda-owned memory copy only.  The
          // exact same strict production validator must accept that copy before
          // any parser call is allowed.
          preflight = preflightFlaBytes(
            normalized.bytes,
            source.basename,
            source.sourcePath,
          );
        } catch (postError) {
          trace = {
            ...trace,
            postNormalizationStrictResult: 'fail',
          };
          if (postError instanceof FlaPreflightError) {
            finishIssue762Profile('fla.source.preflight', preflightStartedAt, {
              requestId,
              outcome: 'recovery-strict-validation-failed',
            });
            return errorResponse(postError.code, postError.message, {
              trace,
              diagnostics: flaRecoveryFailureDiagnostics([
                ...classification.reasonCodes,
                'POST_NORMALIZATION_STRICT_VALIDATION_FAILED',
              ]),
            });
          }
          throw postError;
        }
        trace = {
          ...trace,
          ingestMode: 'compatibility-recovered',
          recoveryApplied: true,
          postNormalizationStrictResult: 'pass',
        };
      }
      finishIssue762Profile('fla.source.preflight', preflightStartedAt, {
        requestId,
        outcome: 'accepted',
        byteLength: preflight.byteLength,
      });
      await this.cancelledLoad;
      if (abortController.signal.aborted) {
        return errorResponse('USER_CANCELLED', 'FLA inspection was cancelled', { trace });
      }
      active.stage = 'parser';
      const request: FlaWorkerStartRequest = {
        sessionId,
        mode: 'structure',
        source: {
          basename: preflight.basename,
          byteLength: preflight.byteLength,
          sha256: preflight.sha256,
          bytes: preflight.bytes,
          containsActionScript: preflight.containsActionScript,
        },
      };
      const parserStartedAt = startIssue762Profile();
      const ir = await this.parserWindowManager.inspect(request);
      finishIssue762Profile('fla.source.parser-inspect', parserStartedAt, {
        requestId,
        byteLength: preflight.byteLength,
      });
      const validated = FlaStructureIRSchema.parse(ir);
      if (
        validated.source.sha256 !== preflight.sha256 ||
        validated.source.byteLength !== preflight.byteLength ||
        validated.source.basename !== preflight.basename
      ) {
        return errorResponse('PARSER_CRASH', 'FLA parser returned a source identity mismatch', {
          trace: trace ? { ...trace, parserResult: 'failure' } : undefined,
        });
      }
      const completedTrace = trace
        ? { ...trace, parserResult: 'success' as const }
        : undefined;
      const response = {
        ok: true as const,
        sessionId,
        ir: validated,
        diagnostics: flaZeroRasterDiagnostic(validated),
        ...(completedTrace ? { trace: completedTrace } : {}),
      };
      this.sessions.set(sessionId, { ...response, workerSource: request.source });
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (!oldest) break;
        this.releaseSession(oldest);
      }
      return response;
    } catch (error) {
      return operationErrorResponse(
        error,
        trace ? { ...trace, parserResult: 'failure' } : undefined,
      );
    } finally {
      finishIssue762Profile('fla.source.inspect-total', inspectionStartedAt, {
        requestId,
        outcome: this.sessions.has(sessionId) ? 'accepted' : 'failed-or-cancelled',
      });
      if (this.active?.sessionId === sessionId) this.active = null;
    }
  }

  cancel(request: FlaCancelRequest): FlaCancelResponse {
    const active = this.active;
    const matchesActive = Boolean(
      active &&
        ((request.sessionId && active.sessionId === request.sessionId) ||
          (request.requestId && active.requestId === request.requestId)),
    );
    if (matchesActive && active) {
      active.abortController.abort();
      if (active.stage === 'parser') this.parserWindowManager.cancel(active.sessionId);
      this.releaseSession(active.sessionId);
      return { accepted: true };
    }
    const sessionId = request.sessionId;
    if (sessionId && this.sessions.has(sessionId)) {
      this.releaseSession(sessionId);
      return { accepted: true };
    }
    return { accepted: false };
  }

  /** Read the catalog and retained source without initiating media processing. */
  getSession(sessionId: string): FlaAssetCommitSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      sessionId,
      ir: session.ir,
      originalSourceSha256:
        session.trace?.originalSourceSha256 ?? session.ir.source.sha256,
      sourceBytes: session.workerSource.bytes,
      loadMedia: () => this.loadMedia(session),
    };
  }

  async previewRaster(sessionId: string, mediaId: string): Promise<FlaRasterPreviewResponse> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.ir.media.some((media) => media.id === mediaId)) {
      return { ok: false, error: { code: 'MEDIA_DECODE_FAILED', message: 'The bitmap is unavailable in this FLA review.' } };
    }
    try {
      const media = (await this.loadMedia(session)).find((item) => item.id === mediaId);
      if (media) return { ok: true, payload: media.payload };
    } catch (error) {
      if (error instanceof FlaParserOperationError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
    }
    return { ok: false, error: { code: 'MEDIA_DECODE_FAILED', message: 'The selected FLA bitmap could not be decoded.' } };
  }

  /** PERF-01 compatibility. Reuse the full parser on the first explicit
   * content request and share that operation within this inspection session.
   */
  private async loadMedia(session: InspectionSession): Promise<AnimationImportIR['media']> {
    const { sessionId, ir: catalog, workerSource } = session;
    if (this.sessions.get(sessionId) !== session) {
      throw new FlaParserOperationError('USER_CANCELLED', 'The FLA inspection session ended');
    }
    if (catalog.media.length === 0) return [];
    if (!session.mediaLoad) {
      const operationId = randomUUID();
      const result = this.parserWindowManager.inspect({
        sessionId: operationId,
        mode: 'raster-compatibility',
        source: workerSource,
      }).then((decoded) => {
        if (decoded.source.sha256 !== workerSource.sha256 ||
            decoded.source.byteLength !== workerSource.byteLength ||
            decoded.source.basename !== workerSource.basename) {
          throw new FlaParserOperationError('PARSER_CRASH', 'FLA parser returned a source identity mismatch');
        }
        // The catalog may not know dimensions which the full parser can read.
        // Keep catalog IDs and pair results only by exact source references.
        const byReference = new Map(decoded.media.map((media) => [bitmapSourceKey(media), media]));
        return catalog.media.flatMap((entry) => {
          const item = byReference.get(bitmapSourceKey(entry));
          if (!item?.payload) return [];
          return [FlaBitmapMediaIRSchema.parse({ ...item, id: entry.id })];
        });
      });
      session.mediaLoad = { operationId, result };
    }
    const load = session.mediaLoad;
    try {
      const media = await load.result;
      if (this.sessions.get(sessionId) !== session) {
        throw new FlaParserOperationError('USER_CANCELLED', 'The FLA inspection session ended');
      }
      return media;
    } catch (error) {
      if (session.mediaLoad === load) delete session.mediaLoad;
      throw error;
    } finally {
      if (session.mediaLoad === load) load.operationId = null;
    }
  }

  releaseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sessions.delete(sessionId)) return;
    if (session.mediaLoad?.operationId) {
      this.parserWindowManager.cancel(session.mediaLoad.operationId);
      const cancelled = session.mediaLoad.result.then(() => undefined, () => undefined);
      this.cancelledLoad = cancelled;
      void cancelled.then(() => {
        if (this.cancelledLoad === cancelled) this.cancelledLoad = undefined;
      });
    }
    for (const listener of [...this.sessionReleasedListeners]) {
      try {
        listener(sessionId);
      } catch (error) {
        console.error('FLA session release listener failed.', error);
      }
    }
  }

  onSessionReleased(listener: (sessionId: string) => void): () => void {
    this.sessionReleasedListeners.add(listener);
    return () => this.sessionReleasedListeners.delete(listener);
  }

  markWorkerReady(senderId: number): void {
    this.parserWindowManager.markReady(senderId);
  }

  markWorkerProgress(senderId: number, payload: unknown): void {
    this.parserWindowManager.markProgress(senderId, payload);
  }

  markWorkerResult(senderId: number, payload: unknown): void {
    this.parserWindowManager.markResult(senderId, payload);
  }

  markWorkerError(senderId: number, payload: unknown): void {
    this.parserWindowManager.markError(senderId, payload);
  }

  close(): void {
    this.active?.abortController.abort();
    this.active = null;
    for (const sessionId of [...this.sessions.keys()]) this.releaseSession(sessionId);
    this.sessionReleasedListeners.clear();
    this.parserWindowManager.close();
  }
}
