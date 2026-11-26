import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FlaStructureIRSchema,
  FLA_IMPORT_LIMITS,
  FlaBitmapMediaIRSchema,
  type FlaDiagnostic,
  type FlaImportErrorCode,
  type FlaCancelResponse,
  type FlaCancelRequest,
  type FlaInspectionResponse,
  type FlaInspectionTrace,
  type FlaWorkerStartRequest,
  type AnimationImportIR,
  type FlaBitmapMedia,
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
import { readFlaEmbeddedVideo } from './fla-native-video';
import type { FFmpegAdapter } from './FFmpegAdapter';
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
  archiveEntries: FlaPreflightResult['entries'];
  mediaLoad?: Promise<AnimationImportIR['media']>;
  hydratedMedia: Map<string, Promise<FlaBitmapMedia>>;
  hydratedBytes: number;
  activeOperationId?: string;
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
  private parserTail = Promise.resolve();

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
      if (abortController.signal.aborted) {
        return errorResponse('USER_CANCELLED', 'FLA inspection was cancelled', { trace });
      }
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
      const ir = await this.runParser(() => {
        if (abortController.signal.aborted) {
          throw new FlaParserOperationError('USER_CANCELLED', 'FLA inspection was cancelled');
        }
        active.stage = 'parser';
        return this.parserWindowManager.inspect(request);
      });
      finishIssue762Profile('fla.source.parser-inspect', parserStartedAt, {
        requestId,
        byteLength: preflight.byteLength,
      });
      if (abortController.signal.aborted) {
        return errorResponse('USER_CANCELLED', 'FLA inspection was cancelled', { trace });
      }
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
      this.sessions.set(sessionId, {
        ...response,
        workerSource: request.source,
        archiveEntries: preflight.entries,
        hydratedMedia: new Map(),
        hydratedBytes: 0,
      });
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
      hydrateMedia: (mediaId) => this.hydrateMedia(session, mediaId),
    };
  }

  getSoundSource(sessionId: string, soundId: string) {
    const session = this.sessions.get(sessionId);
    const sound = session?.ir.sounds?.find(({ id }) => id === soundId);
    return session && sound ? { sound, bytes: session.workerSource.bytes, entries: session.archiveEntries } : null;
  }

  async prepareEmbeddedVideo(
    sessionId: string,
    videoName: string,
    adapter: Pick<FFmpegAdapter, 'probeFlaNativeVideo'>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const media = readFlaEmbeddedVideo(session.workerSource.bytes, session.archiveEntries, videoName);
    if (!media) return null;

    const controller = new AbortController();
    const unsubscribe = this.onSessionReleased((releasedId) => {
      if (releasedId === sessionId) controller.abort();
    });
    const preparationSignal = AbortSignal.any([signal, controller.signal]);
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'panda-stage-fla-video-'));
      const target = path.join(directory, media.mimeType === 'video/mp4' ? 'source.mp4' : 'source.mov');
      await writeFile(target, media.bytes, { flag: 'wx', signal: preparationSignal });
      const metadata = await adapter.probeFlaNativeVideo(target, preparationSignal);
      preparationSignal.throwIfAborted();
      return {
        ...media,
        metadata,
        sourceSha256: session.trace?.originalSourceSha256 ?? session.ir.source.sha256,
      };
    } finally {
      unsubscribe();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  getSoundTimelineSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      ir: session.ir,
      bytes: session.workerSource.bytes,
      entries: session.archiveEntries,
    };
  }

  async previewRaster(sessionId: string, mediaId: string): Promise<FlaRasterPreviewResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: { code: 'MEDIA_DECODE_FAILED', message: 'The bitmap is unavailable in this FLA review.' } };
    }
    try {
      const media = await this.hydrateMedia(session, mediaId);
      return { ok: true, payload: media.payload };
    } catch (error) {
      if (error instanceof FlaParserOperationError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
    }
    return { ok: false, error: { code: 'MEDIA_DECODE_FAILED', message: 'The selected FLA bitmap could not be decoded.' } };
  }

  // The existing parser window accepts one operation at a time.
  private runParser<T>(start: () => Promise<T>): Promise<T> {
    const result = this.parserTail.then(start);
    this.parserTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertSessionCurrent(session: InspectionSession): void {
    if (this.sessions.get(session.sessionId) !== session) {
      throw new FlaParserOperationError('USER_CANCELLED', 'The FLA inspection session ended');
    }
  }

  private runSessionParser<T>(
    session: InspectionSession,
    start: (operationId: string) => Promise<T>,
  ): Promise<T> {
    return this.runParser(async () => {
      this.assertSessionCurrent(session);
      const operationId = randomUUID();
      session.activeOperationId = operationId;
      try {
        const result = await start(operationId);
        this.assertSessionCurrent(session);
        return result;
      } finally {
        delete session.activeOperationId;
      }
    });
  }

  private async hydrateMedia(session: InspectionSession, mediaId: string): Promise<FlaBitmapMedia> {
    this.assertSessionCurrent(session);
    const entry = session.ir.media.find((item) => item.id === mediaId);
    if (!entry) {
      throw new FlaParserOperationError('MEDIA_DECODE_FAILED', 'The bitmap is unavailable in this FLA review');
    }
    let result = session.hydratedMedia.get(mediaId);
    if (!result) {
      const { payload: existingPayload, ...bitmap } = entry;
      if (existingPayload) return FlaBitmapMediaIRSchema.parse(entry);
      const leaf = bitmap.sourceReference.split('/').at(-1);
      const allowHrefLeafFallback = !session.ir.media.some((other) =>
        other.id !== mediaId && other.sourceReference.split('/').at(-1) === leaf,
      );
      result = this.runSessionParser(session, async (operationId) => {
        const media = await this.parserWindowManager.hydrate({
          sessionId: operationId,
          mode: 'hydrate-raster',
          source: session.workerSource,
          bitmap,
          allowHrefLeafFallback,
        });
        this.assertSessionCurrent(session);
        if (media.id !== mediaId || bitmapSourceKey(media) !== bitmapSourceKey(entry) ||
            media.width !== media.payload.width || media.height !== media.payload.height ||
            media.payload.bytes.byteLength === 0) {
          throw new FlaParserOperationError('PARSER_CRASH', 'FLA parser returned an invalid bitmap result');
        }
        const nextBytes = session.hydratedBytes + media.payload.bytes.byteLength;
        if (nextBytes > FLA_IMPORT_LIMITS.maxTotalDecodedRgbaBytes) {
          throw new FlaParserOperationError('MEDIA_LIMIT_EXCEEDED', 'The FLA session bitmap budget was exceeded');
        }
        session.hydratedBytes = nextBytes;
        return media;
      });
      session.hydratedMedia.set(mediaId, result);
    }
    try {
      const media = await result;
      this.assertSessionCurrent(session);
      return media;
    } catch (error) {
      if (session.hydratedMedia.get(mediaId) === result) session.hydratedMedia.delete(mediaId);
      throw error;
    }
  }

  /** Compatibility for explicit Graphic, Snapshot and Sequence requests. */
  private async loadMedia(session: InspectionSession): Promise<AnimationImportIR['media']> {
    this.assertSessionCurrent(session);
    const { ir: catalog, workerSource } = session;
    if (catalog.media.length === 0) return [];
    const load = session.mediaLoad ??= this.runSessionParser(session, async (operationId) => {
      const decoded = await this.parserWindowManager.inspect({
        sessionId: operationId,
        mode: 'raster-compatibility',
        source: workerSource,
      });
      if (decoded.source.sha256 !== workerSource.sha256 ||
          decoded.source.byteLength !== workerSource.byteLength ||
          decoded.source.basename !== workerSource.basename) {
        throw new FlaParserOperationError('PARSER_CRASH', 'FLA parser returned a source identity mismatch');
      }
      const byReference = new Map(decoded.media.map((media) => [bitmapSourceKey(media), media]));
      return catalog.media.flatMap((entry) => {
        const item = byReference.get(bitmapSourceKey(entry));
        return item?.payload ? [FlaBitmapMediaIRSchema.parse({ ...item, id: entry.id })] : [];
      });
    });
    try {
      const media = await load;
      this.assertSessionCurrent(session);
      return media;
    } catch (error) {
      if (session.mediaLoad === load) delete session.mediaLoad;
      throw error;
    }
  }

  releaseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sessions.delete(sessionId)) return;
    if (session.activeOperationId) this.parserWindowManager.cancel(session.activeOperationId);
    session.hydratedMedia.clear();
    delete session.mediaLoad;
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
