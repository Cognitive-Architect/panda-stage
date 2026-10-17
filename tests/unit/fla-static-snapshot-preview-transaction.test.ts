import { describe, expect, it, vi } from 'vitest';
import type {
  FlaStaticSnapshotPreviewRequest,
  FlaStaticSnapshotPreviewSuccess,
} from '../../src/shared/fla-static-snapshot-api';
import {
  FlaStaticSnapshotPreviewQueue,
  runFlaStaticSnapshotPreviewTransaction,
} from '../../src/renderer/fla-import/fla-static-snapshot-preview-transaction';

const REQUEST_A = '7f1e0000-0000-4000-8000-000000000001';
const REQUEST_B = '7f1e0000-0000-4000-8000-000000000002';

function request(requestId: string): FlaStaticSnapshotPreviewRequest {
  return {
    format: 'fla-static-snapshot-preview',
    version: 1,
    requestId,
    sessionId: '7f1e0000-0000-4000-8000-000000000099',
    target: {
      renderTargetId: `fla-render-target-${'a'.repeat(64)}`,
      kind: 'graphic-symbol',
      userLabel: 'candidate',
      frameCount: 1,
      selectedFrameIndex: 0,
      compatibility: ['exact'],
    },
  } as FlaStaticSnapshotPreviewRequest;
}

function preview(requestId: string): FlaStaticSnapshotPreviewSuccess {
  return {
    ok: true,
    requestId,
    targetRenderTargetId: `fla-render-target-${'a'.repeat(64)}`,
    targetSelectedFrameIndex: 0,
    width: 332,
    height: 673,
    pixelCount: 332 * 673,
    bytes: new Uint8Array([1, 2, 3]),
    sha256: 'a'.repeat(64),
    wallClockMs: 1,
    isFirstPreviewForSession: false,
    startedAt: '2026-10-11T00:00:00.000Z',
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('FLA static snapshot preview transaction', () => {
  it('serializes scan and focus previews through request-scoped cleanup', async () => {
    const events: string[] = [];
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const client = {
      preview: vi.fn(async (input: FlaStaticSnapshotPreviewRequest) => {
        events.push(`preview:${input.requestId}`);
        if (input.requestId === REQUEST_A) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return preview(input.requestId);
      }),
      cancel: vi.fn(async (input: { requestId?: string }) => {
        events.push(`cancel:${input.requestId}`);
        return { accepted: true, cancelledRequestId: input.requestId };
      }),
    };
    const queue = new FlaStaticSnapshotPreviewQueue();

    const scanning = runFlaStaticSnapshotPreviewTransaction(client, request(REQUEST_A), queue);
    await firstStarted.promise;
    const focused = runFlaStaticSnapshotPreviewTransaction(client, request(REQUEST_B), queue);
    await Promise.resolve();
    expect(events).toEqual([`preview:${REQUEST_A}`]);

    releaseFirst.resolve();
    const [scanResult, focusResult] = await Promise.all([scanning, focused]);

    expect(scanResult.response?.ok).toBe(true);
    expect(focusResult.response?.ok).toBe(true);
    expect(events).toEqual([
      `preview:${REQUEST_A}`,
      `cancel:${REQUEST_A}`,
      `preview:${REQUEST_B}`,
      `cancel:${REQUEST_B}`,
    ]);
  });

  it('keeps a confirmed commit result when preview cleanup rejects', async () => {
    const committed = { status: 'imported', assetCount: 1 };
    const client = {
      preview: vi.fn(async (input: FlaStaticSnapshotPreviewRequest) => preview(input.requestId)),
      cancel: vi.fn(async () => {
        throw new Error('snapshot cleanup failed');
      }),
    };

    const result = await runFlaStaticSnapshotPreviewTransaction(
      client,
      request(REQUEST_A),
      new FlaStaticSnapshotPreviewQueue(),
      async (response) => {
        if (!response.ok) throw new Error('preview failed');
        return committed;
      },
    );

    expect(result.value).toBe(committed);
    expect(result.operationError).toBeUndefined();
    expect(result.cleanupError?.message).toBe('snapshot cleanup failed');
  });

  it('settles a scan preview when request cleanup rejects', async () => {
    const client = {
      preview: vi.fn(async (input: FlaStaticSnapshotPreviewRequest) => preview(input.requestId)),
      cancel: vi.fn(async () => {
        throw new Error('scan cleanup failed');
      }),
    };

    const result = await runFlaStaticSnapshotPreviewTransaction(
      client,
      request(REQUEST_A),
      new FlaStaticSnapshotPreviewQueue(),
    );

    expect(result.response?.ok).toBe(true);
    expect(result.operationError).toBeUndefined();
    expect(result.cleanupError?.message).toBe('scan cleanup failed');
  });

  it('reports operation and cleanup failures independently without rejecting the caller', async () => {
    const client = {
      preview: vi.fn(async (input: FlaStaticSnapshotPreviewRequest) => preview(input.requestId)),
      cancel: vi.fn(async () => {
        throw new Error('cancel rejected');
      }),
    };

    const result = await runFlaStaticSnapshotPreviewTransaction(
      client,
      request(REQUEST_A),
      new FlaStaticSnapshotPreviewQueue(),
      async () => {
        throw new Error('commit response unavailable');
      },
    );

    expect(result.operationError?.message).toBe('commit response unavailable');
    expect(result.cleanupError?.message).toBe('cancel rejected');
    expect(client.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not start or clean up a preview that became stale while queued', async () => {
    const client = {
      preview: vi.fn(async (input: FlaStaticSnapshotPreviewRequest) => preview(input.requestId)),
      cancel: vi.fn(async () => ({ accepted: false })),
    };

    const result = await runFlaStaticSnapshotPreviewTransaction(
      client,
      request(REQUEST_A),
      new FlaStaticSnapshotPreviewQueue(),
      undefined,
      { shouldRun: () => false },
    );

    expect(result.skipped).toBe(true);
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
  });
});
