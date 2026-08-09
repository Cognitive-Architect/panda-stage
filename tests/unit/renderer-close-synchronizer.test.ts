import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RendererCloseSynchronizer,
  type RendererCloseSyncWindow,
} from '../../src/main/windows/renderer-close-synchronizer';
import type { NativeCloseSyncRequest } from '../../src/shared/native-close-sync';

afterEach(() => {
  vi.useRealTimers();
});

function createHarness(timeoutMs = 100) {
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 17,
      send: vi.fn(),
    },
  };
  const send = vi.fn(
    (target: RendererCloseSyncWindow, request: NativeCloseSyncRequest) => {
    target.webContents.send('native-close:sync-request', request);
    },
  );
  const synchronizer = new RendererCloseSynchronizer({
    getWindow: () => window,
    send,
    createRequestId: () => 'close-request-1',
    timeoutMs,
  });
  return { synchronizer, window, send };
}

describe('RendererCloseSynchronizer', () => {
  it('accepts one validated response from the owned Renderer', async () => {
    const harness = createHarness();

    const result = harness.synchronizer.synchronize();

    expect(harness.send).toHaveBeenCalledWith(
      harness.window,
      { requestId: 'close-request-1' },
    );
    expect(
      harness.synchronizer.handleResponse(17, {
        ok: true,
        requestId: 'close-request-1',
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ ok: true });
  });

  it('propagates a Renderer autosave failure without approving close', async () => {
    const harness = createHarness();
    const result = harness.synchronizer.synchronize();

    expect(
      harness.synchronizer.handleResponse(17, {
        ok: false,
        requestId: 'close-request-1',
        error: 'Injected AUTOSAVE_UPDATE failure.',
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Injected AUTOSAVE_UPDATE failure.',
    });
  });

  it('keeps close fail-safe when an untrusted response is followed by timeout', async () => {
    vi.useFakeTimers();
    const harness = createHarness(50);
    const result = harness.synchronizer.synchronize();

    expect(
      harness.synchronizer.handleResponse(99, {
        ok: true,
        requestId: 'close-request-1',
      }),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Renderer close synchronization timed out.',
    });
  });
});
