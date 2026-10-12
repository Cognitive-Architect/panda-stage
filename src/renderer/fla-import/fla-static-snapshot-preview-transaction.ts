import type {
  FlaStaticSnapshotPreviewRequest,
  FlaStaticSnapshotPreviewResponse,
} from '../../shared/fla-static-snapshot-api';
import {
  finishIssue762Profile,
  startIssue762Profile,
} from '../../shared/issue762-performance-profile';
import type { FlaStaticSnapshotCatalogClient } from './fla-static-snapshot-render';

export type FlaStaticSnapshotPreviewTransactionClient = Pick<
  FlaStaticSnapshotCatalogClient,
  'preview' | 'cancel'
>;

export interface FlaStaticSnapshotPreviewTransactionOptions {
  shouldRun?: () => boolean;
  onRequestStart?: () => void;
  onRequestSettled?: () => void;
  profileLabel?: string;
  candidateIndex?: number;
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
  const queuedAt = startIssue762Profile();
  const profileDetails = {
    requestId: request.requestId,
    targetId: request.target.renderTargetId,
    selectedFrameIndex: request.target.selectedFrameIndex ?? 0,
    ...(options.profileLabel ? { profileLabel: options.profileLabel } : {}),
    ...(Number.isInteger(options.candidateIndex) ? { candidateIndex: options.candidateIndex } : {}),
  };
  return queue.run(async () => {
    finishIssue762Profile('ui.preview.queue-wait', queuedAt, profileDetails);
    const transactionStartedAt = startIssue762Profile();
    if (options.shouldRun && !options.shouldRun()) {
      finishIssue762Profile('ui.preview.transaction-total', transactionStartedAt, {
        ...profileDetails,
        outcome: 'skipped',
      });
      return { skipped: true };
    }
    options.onRequestStart?.();

    let response: FlaStaticSnapshotPreviewResponse | undefined;
    let value: T | undefined;
    let operationError: Error | undefined;
    let cleanupError: Error | undefined;
    const previewStartedAt = startIssue762Profile();
    let previewSettled = false;

    try {
      response = await client.preview(request);
      previewSettled = true;
      finishIssue762Profile('ui.preview.main-roundtrip', previewStartedAt, {
        ...profileDetails,
        outcome: response.ok ? 'success' : response.error.code,
      });
      const consumeStartedAt = startIssue762Profile();
      value = consume ? await consume(response) : response as T;
      finishIssue762Profile('ui.preview.consume', consumeStartedAt, profileDetails);
    } catch (error) {
      if (!previewSettled) {
        finishIssue762Profile('ui.preview.main-roundtrip', previewStartedAt, {
          ...profileDetails,
          outcome: 'error',
        });
      }
      finishIssue762Profile('ui.preview.operation-error', transactionStartedAt, {
        ...profileDetails,
        outcome: 'error',
      });
      operationError = toError(error);
    }

    const cancelStartedAt = startIssue762Profile();
    try {
      await client.cancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        requestId: request.requestId,
      });
      finishIssue762Profile('ui.preview.cancel-cleanup', cancelStartedAt, profileDetails);
    } catch (error) {
      finishIssue762Profile('ui.preview.cancel-cleanup-error', cancelStartedAt, {
        ...profileDetails,
        outcome: 'error',
      });
      cleanupError = toError(error);
    } finally {
      options.onRequestSettled?.();
    }

    finishIssue762Profile('ui.preview.transaction-total', transactionStartedAt, {
      ...profileDetails,
      outcome: operationError ? 'operation-error' : cleanupError ? 'cleanup-error' : 'settled',
    });
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
