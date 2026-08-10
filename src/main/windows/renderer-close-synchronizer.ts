import { randomUUID } from 'node:crypto';
import {
  NativeCloseSyncRequestSchema,
  NativeCloseSyncResponseSchema,
  type NativeCloseSyncRequest,
} from '../../shared/native-close-sync';

export interface RendererCloseSyncWindow {
  isDestroyed(): boolean;
  webContents: {
    id: number;
    send(channel: string, payload: unknown): void;
  };
}

export interface RendererCloseSynchronizerDependencies {
  getWindow: () => RendererCloseSyncWindow | null;
  send: (
    window: RendererCloseSyncWindow,
    request: NativeCloseSyncRequest,
  ) => void;
  createRequestId?: () => string;
  timeoutMs?: number;
}

export type RendererCloseSyncResult =
  | { ok: true }
  | { ok: false; error: string };

interface PendingRequest {
  resolve: (result: RendererCloseSyncResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export class RendererCloseSynchronizer {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly createRequestId: () => string;
  private readonly timeoutMs: number;

  constructor(
    private readonly dependencies: RendererCloseSynchronizerDependencies,
  ) {
    this.createRequestId =
      dependencies.createRequestId ?? (() => randomUUID());
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  synchronize(): Promise<RendererCloseSyncResult> {
    const window = this.dependencies.getWindow();
    if (!window || window.isDestroyed()) {
      return Promise.resolve({
        ok: false,
        error: 'Renderer window is unavailable for close synchronization.',
      });
    }

    const request = NativeCloseSyncRequestSchema.parse({
      requestId: this.createRequestId(),
    });
    const promise = new Promise<RendererCloseSyncResult>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(request.requestId)) return;
        this.pending.delete(request.requestId);
        resolve({
          ok: false,
          error: 'Renderer close synchronization timed out.',
        });
      }, this.timeoutMs);
      this.pending.set(request.requestId, { resolve, timeout });
    });

    try {
      this.dependencies.send(window, request);
    } catch (error) {
      this.resolve(request.requestId, {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Renderer close synchronization could not be sent.',
      });
    }
    return promise;
  }

  handleResponse(senderId: number, rawResponse: unknown): boolean {
    let response: ReturnType<typeof NativeCloseSyncResponseSchema.parse>;
    try {
      response = NativeCloseSyncResponseSchema.parse(rawResponse);
    } catch {
      return false;
    }

    const pending = this.pending.get(response.requestId);
    const window = this.dependencies.getWindow();
    if (
      !pending ||
      !window ||
      window.isDestroyed() ||
      window.webContents.id !== senderId
    ) {
      return false;
    }

    this.resolve(
      response.requestId,
      response.ok
        ? { ok: true }
        : { ok: false, error: response.error },
    );
    return true;
  }

  dispose(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        ok: false,
        error: 'Renderer close synchronization was disposed.',
      });
      this.pending.delete(requestId);
    }
  }

  private resolve(
    requestId: string,
    result: RendererCloseSyncResult,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(result);
  }
}
