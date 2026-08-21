/**
 * V2-R1 Static Snapshot — production rasterizer (WindowManager) tests.
 *
 * Issue #289 Corrective A/C/E/F. Exercises the real WindowManager with a
 * fake BrowserWindow factory so we can prove:
 *  - the same requestId reaches the renderer IPC payload (no replacement
 *    UUID between RenderSession and the hidden renderer);
 *  - cancel() physically destroys the hidden window (real stop, not only a
 *    logical promise rejection);
 *  - actual raster concurrency is bounded to 1 (a new request tears down
 *    the prior in-flight window);
 *  - a late RESULT/ERROR for a cancelled request is ignored;
 *  - renderer crash / window teardown clears pending jobs immediately.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import {
  FlaStaticSnapshotWindowManager,
  type FlaStaticSnapshotWindowFactory,
} from '../../src/main/services/fla-static-snapshot-window-manager';

class FakeWebContents extends EventEmitter {
  readonly id: number;
  readonly session = {
    webRequest: { onBeforeRequest: vi.fn() },
  };
  readonly send = vi.fn();
  readonly opened: string[] = [];

  constructor(id: number) {
    super();
    this.id = id;
  }

  setWindowOpenHandler(): void {}
}

class FakeBrowserWindow extends EventEmitter {
  readonly webContents: FakeWebContents;
  private destroyed = false;
  public createdOptions: BrowserWindowConstructorOptions | null = null;

  constructor(id: number) {
    super();
    this.webContents = new FakeWebContents(id);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(): Promise<void> {}
  async loadFile(): Promise<void> {}

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

const fakeState: { instances: FakeBrowserWindow[]; nextId: number } = {
  instances: [],
  nextId: 100,
};

const windowFactory: FlaStaticSnapshotWindowFactory = {
  create: (options: BrowserWindowConstructorOptions) => {
    const window = new FakeBrowserWindow(fakeState.nextId);
    fakeState.nextId += 1;
    window.createdOptions = options;
    fakeState.instances.push(window);
    return window as unknown as BrowserWindow;
  },
};

function reset(): void {
  fakeState.instances = [];
  fakeState.nextId = 100;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';
const REQUEST_A = '27000000-0000-4000-8000-0000000000a1';
const REQUEST_B = '27000000-0000-4000-8000-0000000000a2';

function manager(): FlaStaticSnapshotWindowManager {
  return new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 1000, rasterizeWallTimeMs: 1000 },
    windowFactory,
  );
}

/** Drive the fake renderer to its ready handshake. */
function makeReady(window: FakeBrowserWindow, mgr: FlaStaticSnapshotWindowManager): void {
  mgr.markReady(window.webContents.id);
}

function latestWindow(): FakeBrowserWindow {
  const window = fakeState.instances[fakeState.instances.length - 1];
  if (!window) throw new Error('no fake window was created');
  return window;
}

/** Let the ensureWindow() microtask resume and register the pending job. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FlaStaticSnapshotWindowManager — request identity (Corrective A)', () => {
  afterEach(reset);

  it('uses input.requestId as the pending key and IPC payload (no replacement UUID)', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    makeReady(window, mgr);
    await flush();
    // The IPC payload sent to the renderer must carry the same requestId.
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    const payload = window.webContents.send.mock.calls[0]![1] as { requestId: string; svg: string };
    expect(payload.requestId).toBe(REQUEST_A);
    expect(payload.svg).toBe(SVG);
    mgr.markResult(window.webContents.id, {
      requestId: REQUEST_A,
      png: Array.from(new Uint8Array([1, 2, 3])),
      width: 8,
      height: 8,
    });
    const out = await promise;
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    mgr.close();
  });

  it('registers the raster job under the caller requestId, not a randomUUID', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    makeReady(window, mgr);
    await flush();
    // cancel() must find the job by the same requestId.
    expect(mgr.cancel(REQUEST_A)).toBe(true);
    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(mgr.cancel('27000000-0000-4000-8000-00000000ffff')).toBe(false);
    mgr.close();
  });
});

describe('FlaStaticSnapshotWindowManager — physical cancellation (Corrective C)', () => {
  afterEach(reset);

  it('destroys the hidden BrowserWindow on cancel so the canvas stops', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    makeReady(window, mgr);
    await flush();
    expect(window.isDestroyed()).toBe(false);
    expect(mgr.cancel(REQUEST_A)).toBe(true);
    expect(window.isDestroyed()).toBe(true);
    await expect(promise).rejects.toThrow(/cancelled/i);
    mgr.close();
  });

  it('ignores a late RESULT for a cancelled request', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    makeReady(window, mgr);
    await flush();
    mgr.cancel(REQUEST_A);
    // A result arriving after cancel must not resolve the rejected promise.
    mgr.markResult(window.webContents.id, {
      requestId: REQUEST_A,
      png: Array.from(new Uint8Array([9])),
      width: 8,
      height: 8,
    });
    await expect(promise).rejects.toThrow(/cancelled/i);
    mgr.close();
  });

  it('rebuilds a fresh sandboxed window for the next preview after cancel', async () => {
    const mgr = manager();
    const promiseA = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowA = latestWindow();
    makeReady(windowA, mgr);
    await flush();
    mgr.cancel(REQUEST_A);
    expect(windowA.isDestroyed()).toBe(true);

    const promiseB = mgr.rasterize({ requestId: REQUEST_B, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowB = latestWindow();
    expect(windowB).not.toBe(windowA);
    makeReady(windowB, mgr);
    await flush();
    mgr.markResult(windowB.webContents.id, {
      requestId: REQUEST_B,
      png: Array.from(new Uint8Array([7])),
      width: 8,
      height: 8,
    });
    const out = await promiseB;
    expect(out.width).toBe(8);
    await expect(promiseA).rejects.toThrow(/cancelled/i);
    mgr.close();
  });
});

describe('FlaStaticSnapshotWindowManager — bounded concurrency (Corrective E)', () => {
  afterEach(reset);

  it('terminates the prior in-flight job before starting a new one', async () => {
    const mgr = manager();
    const promiseA = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowA = latestWindow();
    makeReady(windowA, mgr);
    await flush();
    // B arrives while A is still in flight.
    const promiseB = mgr.rasterize({ requestId: REQUEST_B, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowB = latestWindow();
    // A's window must have been destroyed (only one real raster job at a time).
    expect(windowA.isDestroyed()).toBe(true);
    expect(windowB).not.toBe(windowA);
    makeReady(windowB, mgr);
    await flush();
    mgr.markResult(windowB.webContents.id, {
      requestId: REQUEST_B,
      png: Array.from(new Uint8Array([5])),
      width: 8,
      height: 8,
    });
    const out = await promiseB;
    expect(out.width).toBe(8);
    // A's promise is rejected as superseded.
    await expect(promiseA).rejects.toThrow(/superseded/i);
    mgr.close();
  });
});

describe('FlaStaticSnapshotWindowManager — crash / teardown cleanup (Corrective F)', () => {
  afterEach(reset);

  it('rejects pending jobs immediately when the render process is gone', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    makeReady(window, mgr);
    await flush();
    window.webContents.emit('render-process-gone');
    await expect(promise).rejects.toThrow(/process gone/i);
    mgr.close();
  });

  it('clears all pending jobs on close without waiting for the wall clock', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    latestWindow();
    mgr.close();
    await expect(promise).rejects.toThrow(/closed/i);
  });
});

describe('FlaStaticSnapshotWindowManager — cold-start cancellation (Issue #290)', () => {
  afterEach(reset);

  it('cancel-before-READY settles A, destroys its window, and never sends raster IPC', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    // A is still waiting for READY; do NOT call markReady.
    expect(window.isDestroyed()).toBe(false);
    expect(mgr.cancel(REQUEST_A)).toBe(true);
    // Window is torn down and the startup promise rejects promptly.
    expect(window.isDestroyed()).toBe(true);
    await expect(promise).rejects.toThrow(/cancelled/i);
    // No raster IPC was ever dispatched for the cancelled startup.
    expect(window.webContents.send).not.toHaveBeenCalled();
    mgr.close();
  });

  it('supersede-before-READY settles A and lets only B proceed to raster IPC', async () => {
    const mgr = manager();
    const promiseA = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowA = latestWindow();
    // B arrives while A is still in the READY handshake.
    const promiseB = mgr.rasterize({ requestId: REQUEST_B, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const windowB = latestWindow();
    // A's startup window is destroyed/retired; no unresolved startup promise.
    expect(windowA.isDestroyed()).toBe(true);
    expect(windowB).not.toBe(windowA);
    await expect(promiseA).rejects.toThrow(/superseded/i);
    // Only B proceeds to READY + raster IPC.
    makeReady(windowB, mgr);
    await flush();
    expect(windowB.webContents.send).toHaveBeenCalledTimes(1);
    const payload = windowB.webContents.send.mock.calls[0]![1] as { requestId: string };
    expect(payload.requestId).toBe(REQUEST_B);
    mgr.markResult(windowB.webContents.id, {
      requestId: REQUEST_B,
      png: Array.from(new Uint8Array([4])),
      width: 8,
      height: 8,
    });
    const out = await promiseB;
    expect(out.width).toBe(8);
    mgr.close();
  });

  it('close-before-READY settles the startup request without a hung handshake', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    latestWindow();
    // No markReady; close() during startup must settle the request.
    mgr.close();
    await expect(promise).rejects.toThrow(/closed/i);
  });

  it('a late RESULT after cancel-before-READY is ignored', async () => {
    const mgr = manager();
    const promise = mgr.rasterize({ requestId: REQUEST_A, svg: SVG, width: 8, height: 8, pixelCount: 64 });
    const window = latestWindow();
    expect(mgr.cancel(REQUEST_A)).toBe(true);
    // A stale renderer RESULT must not resolve the rejected startup promise.
    mgr.markResult(window.webContents.id, {
      requestId: REQUEST_A,
      png: Array.from(new Uint8Array([9])),
      width: 8,
      height: 8,
    });
    await expect(promise).rejects.toThrow(/cancelled/i);
    mgr.close();
  });
});
