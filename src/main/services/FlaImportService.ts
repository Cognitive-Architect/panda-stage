import { randomUUID } from 'node:crypto';
import {
  AnimationImportIRSchema,
  type FlaImportErrorCode,
  type FlaCancelResponse,
  type FlaCancelRequest,
  type FlaInspectionResponse,
  type FlaWorkerStartRequest,
  type AnimationImportIR,
} from '../../shared/fla-import-api';
import {
  flaErrorDiagnostics,
  flaZeroRasterDiagnostic,
} from '../../shared/fla-import-diagnostics';
import type { FlaAssetCommitSession } from './FlaAssetCommitService';
import {
  FlaPreflightError,
  preflightFlaSource,
} from './fla-import-preflight-service';
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
): FlaInspectionResponse {
  const trimmed = message.trim().slice(0, 1_000) || 'FLA inspection failed';
  return {
    ok: false,
    error: { code, message: trimmed },
    diagnostics: flaErrorDiagnostics({ code, message: trimmed }),
  };
}

function operationErrorResponse(error: unknown): FlaInspectionResponse {
  if (error instanceof FlaPreflightError || error instanceof FlaParserOperationError) {
    return errorResponse(error.code, error.message);
  }
  return errorResponse('PARSER_CRASH', 'FLA inspection failed inside the isolated parser boundary');
}

export class FlaImportService {
  private readonly parserWindowManager: FlaParserWindowManager;
  private readonly sessions = new Map<string, FlaInspectionResponse & { ok: true }>();
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
    this.active = active;
    try {
      const preflight = await preflightFlaSource(sourcePath, abortController.signal);
      if (abortController.signal.aborted) {
        return errorResponse('USER_CANCELLED', 'FLA inspection was cancelled');
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
        return errorResponse('PARSER_CRASH', 'FLA parser returned a source identity mismatch');
      }
      const response = {
        ok: true as const,
        sessionId,
        ir: validated,
        diagnostics: flaZeroRasterDiagnostic(validated),
      };
      this.sessions.set(sessionId, response);
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (!oldest) break;
        this.sessions.delete(oldest);
      }
      return response;
    } catch (error) {
      return operationErrorResponse(error);
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
