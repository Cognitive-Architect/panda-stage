import { randomUUID } from 'node:crypto';
import {
  AnimationImportIRSchema,
  type FlaDiagnostic,
  type FlaImportErrorCode,
  type FlaCancelResponse,
  type FlaCancelRequest,
  type FlaInspectionResponse,
  type FlaInspectionTrace,
  type FlaWorkerStartRequest,
  type AnimationImportIR,
} from '../../shared/fla-import-api';
import {
  flaErrorDiagnostics,
  flaRecoveryFailureDiagnostics,
  flaZeroRasterDiagnostic,
} from '../../shared/fla-import-diagnostics';
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
  private readonly sessions = new Map<
    string,
    (FlaInspectionResponse & { ok: true }) & { sourceBytes: Uint8Array }
  >();
  private active: ActiveInspection | null = null;

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
    let trace: FlaInspectionTrace | undefined;
    this.active = active;
    try {
      const source = await readFlaSourceBytes(sourcePath, abortController.signal);
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
      if (abortController.signal.aborted) {
        return errorResponse('USER_CANCELLED', 'FLA inspection was cancelled', { trace });
      }
      active.stage = 'parser';
      const request: FlaWorkerStartRequest = {
        sessionId,
        source: {
          basename: preflight.basename,
          byteLength: preflight.byteLength,
          sha256: preflight.sha256,
          bytes: preflight.bytes,
          containsActionScript: preflight.containsActionScript,
        },
      };
      const ir = await this.parserWindowManager.inspect(request);
      const validated = AnimationImportIRSchema.parse(ir);
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
      this.sessions.set(sessionId, { ...response, sourceBytes: preflight.bytes });
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (!oldest) break;
        this.sessions.delete(oldest);
      }
      return response;
    } catch (error) {
      return operationErrorResponse(
        error,
        trace ? { ...trace, parserResult: 'failure' } : undefined,
      );
    } finally {
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
      this.sessions.delete(active.sessionId);
      return { accepted: true };
    }
    const sessionId = request.sessionId;
    if (sessionId && this.sessions.delete(sessionId)) return { accepted: true };
    return { accepted: false };
  }

  /** Main-only lookup used by Slice 3.  The Renderer receives only the
   * identifier; the encoded PNG payloads remain in this process-owned session.
   */
  getSession(sessionId: string): FlaAssetCommitSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      sessionId,
      ir: session.ir as AnimationImportIR,
      sourceBytes: session.sourceBytes,
    };
  }

  releaseSession(sessionId: string): void {
    this.sessions.delete(sessionId);
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
    this.sessions.clear();
    this.parserWindowManager.close();
  }
}
