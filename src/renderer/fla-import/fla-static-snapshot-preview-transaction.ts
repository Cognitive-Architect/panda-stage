import type {
  FlaStaticSnapshotPreviewRequest,
  FlaStaticSnapshotPreviewResponse,
} from '../../shared/fla-static-snapshot-api';
import type { FlaStaticSnapshotCatalogClient } from './fla-static-snapshot-render';

export type FlaStaticSnapshotPreviewTransactionClient = Pick<
  FlaStaticSnapshotCatalogClient,
  'preview' | 'cancel'
>;

export interface FlaStaticSnapshotPreviewTransactionOptions {
  shouldRun?: () => boolean;
  onRequestStart?: () => void;
  onRequestSettled?: () => void;
}

export interface FlaStaticSnapshotPreviewTransactionResult<T> {
  skipped: boolean;
  response?: FlaStaticSnapshotPreviewResponse;
  value?: T;
  operationError?: Error;
  cleanupError?: Error;
}

/**
 * The Main snapshot rasterizer is single-flight. Keep each renderer preview,
 * its optional commit, and its request-scoped cleanup together so concurrent
 * scan/focus work cannot supersede the request another UI action is using.
 */
export class FlaStaticSnapshotPreviewQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let releaseTurn: (() => void) | null = null;
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    this.tail = previous.then(() => turn, () => turn);

    return previous
      .catch(() => undefined)
      .then(async () => {
        try {
          return await operation();
        } finally {
          releaseTurn?.();
        }
      });
  }
}

export const flaStaticSnapshotPreviewQueue = new FlaStaticSnapshotPreviewQueue();

export function runFlaStaticSnapshotPreviewTransaction<T = FlaStaticSnapshotPreviewResponse>(
  client: FlaStaticSnapshotPreviewTransactionClient,
  request: FlaStaticSnapshotPreviewRequest,
  queue: FlaStaticSnapshotPreviewQueue = flaStaticSnapshotPreviewQueue,
  consume?: (response: FlaStaticSnapshotPreviewResponse) => T | Promise<T>,
  options: FlaStaticSnapshotPreviewTransactionOptions = {},
): Promise<FlaStaticSnapshotPreviewTransactionResult<T>> {
  return queue.run(async () => {
    if (options.shouldRun && !options.shouldRun()) return { skipped: true };
    options.onRequestStart?.();

    let response: FlaStaticSnapshotPreviewResponse | undefined;
    let value: T | undefined;
    let operationError: Error | undefined;
    let cleanupError: Error | undefined;

    try {
      response = await client.preview(request);
      value = consume ? await consume(response) : response as T;
    } catch (error) {
      operationError = toError(error);
    }

    try {
      await client.cancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        requestId: request.requestId,
      });
    } catch (error) {
      cleanupError = toError(error);
    } finally {
      options.onRequestSettled?.();
    }

    return {
      skipped: false,
      ...(response ? { response } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(operationError ? { operationError } : {}),
      ...(cleanupError ? { cleanupError } : {}),
    };
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
