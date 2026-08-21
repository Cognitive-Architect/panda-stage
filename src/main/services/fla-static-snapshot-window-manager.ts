/**
 * V2-R1 Static Snapshot — production rasterizer (sandboxed BrowserWindow).
 *
 * Issue #287 R1-B. This is the only place the Main-built SVG reaches a
 * renderer. The window is created with the same isolation posture proven
 * by the R0 research renderer and the production FLA parser window:
 *
 *   sandbox = true
 *   contextIsolation = true
 *   nodeIntegration = false
 *   no arbitrary renderer FS / network / ActionScript
 *
 * The renderer-side script (src/renderer/fla-import/fla-static-snapshot-renderer.ts)
 * draws the SVG onto a transparent canvas and returns PNG bytes. It never
 * sees the FLA source, only the SVG string we send it.
 */

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { FLA_STATIC_SNAPSHOT_LIMITS } from '../../shared/fla-static-snapshot-api';
import {
  type FlaStaticSnapshotRasterizeInput,
  type FlaStaticSnapshotRasterizeOutput,
  type FlaStaticSnapshotRasterizer,
} from './fla-static-snapshot-render-session';

export interface FlaStaticSnapshotWindowTiming {
  readyTimeoutMs: number;
  rasterizeWallTimeMs: number;
}

export interface FlaStaticSnapshotWindowFactory {
  create(options: BrowserWindowConstructorOptions): BrowserWindow;
}

const DEFAULT_TIMING: FlaStaticSnapshotWindowTiming = {
  readyTimeoutMs: 10_000,
  rasterizeWallTimeMs: FLA_STATIC_SNAPSHOT_LIMITS.previewWallTimeMs,
};

const DEFAULT_WINDOW_FACTORY: FlaStaticSnapshotWindowFactory = {
  create: (options) => new BrowserWindow(options),
};

interface PendingRasterize {
  resolve: (output: FlaStaticSnapshotRasterizeOutput) => void;
  reject: (error: Error) => void;
  wallTimer: NodeJS.Timeout;
}

export class FlaStaticSnapshotWindowManager implements FlaStaticSnapshotRasterizer {
  private readonly timing: FlaStaticSnapshotWindowTiming;
  private readonly windowFactory: FlaStaticSnapshotWindowFactory;
  private window: BrowserWindow | null = null;
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingRasterize>();
  // E: the single in-flight raster job identity. Must equal the pending
  // map key; a different request id replaces it via forced window teardown.
  private activeRequestId: string | null = null;
  // Set once close() is called; forces any in-flight ensureWindow() to
  // reject immediately instead of hanging on the ready handshake.
  private disposed = false;

  constructor(
    timing: Partial<FlaStaticSnapshotWindowTiming> = {},
    windowFactory: FlaStaticSnapshotWindowFactory = DEFAULT_WINDOW_FACTORY,
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.windowFactory = windowFactory;
  }

  async rasterize(input: FlaStaticSnapshotRasterizeInput): Promise<FlaStaticSnapshotRasterizeOutput> {
    if (this.disposed) {
      throw new Error('Snapshot rasterizer closed');
    }
    // E: enforce a single in-flight raster job. If a different request is
    // already pending, forcibly tear down its hidden window so the new
    // request gets a fresh, dedicated sandboxed renderer.
    const window = await this.ensureWindow(input.requestId);
    const requestId = input.requestId;
    const payload = { requestId, svg: input.svg };
    const promise = new Promise<FlaStaticSnapshotRasterizeOutput>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        wallTimer: setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error('Snapshot rasterization timed out'));
        }, this.timing.rasterizeWallTimeMs),
      });
    });
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.FLA_SNAPSHOT_RENDER, payload);
    }
    return promise;
  }

  markReady(senderId: number): void {
    if (this.disposed) return;
    const window = this.window;
    if (!window || window.webContents.id !== senderId) return;
    this.ready = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyResolve?.();
    this.readyResolve = null;
  }

  markResult(senderId: number, rawPayload: unknown): void {
    if (this.disposed) return;
    const window = this.window;
    if (!window || window.webContents.id !== senderId) return;
    if (typeof rawPayload !== 'object' || rawPayload === null) return;
    const payload = rawPayload as { requestId?: string; png?: number[]; width?: number; height?: number; pixelCount?: number };
    const requestId = payload.requestId;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (this.activeRequestId === requestId) this.activeRequestId = null;
    clearTimeout(pending.wallTimer);
    if (
      !Array.isArray(payload.png) ||
      typeof payload.width !== 'number' ||
      typeof payload.height !== 'number'
    ) {
      pending.reject(new Error('Snapshot rasterizer returned an invalid result'));
      return;
    }
    pending.resolve({
      pngBytes: Uint8Array.from(payload.png),
      width: payload.width,
      height: payload.height,
      pixelCount: payload.pixelCount ?? payload.width * payload.height,
    });
  }

  markError(senderId: number, rawPayload: unknown): void {
    if (this.disposed) return;
    const window = this.window;
    if (!window || window.webContents.id !== senderId) return;
    if (typeof rawPayload !== 'object' || rawPayload === null) return;
    const payload = rawPayload as { requestId?: string; message?: string };
    const requestId = payload.requestId;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (this.activeRequestId === requestId) this.activeRequestId = null;
    clearTimeout(pending.wallTimer);
    pending.reject(new Error(payload.message ?? 'Snapshot rasterization failed'));
  }

  /**
   * Bounded per-request cancellation (Corrective C).
   *
   * This is real cancellation: it rejects the caller's promise AND
   * forcibly destroys the dedicated hidden BrowserWindow that is executing
   * the raster job, so the canvas stops cooking. The next preview rebuilds
   * a fresh, sandboxed window via ensureWindow(). The security boundary is
   * unchanged (sandbox/contextIsolation/nodeIntegration are window
   * properties, not relaxed).
   */
  cancel(requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.wallTimer);
    if (this.activeRequestId === requestId) this.activeRequestId = null;
    // Physical stop: terminate the hidden renderer rather than leaving the
    // canvas to finish a result we will discard.
    this.destroyWindow();
    pending.reject(new Error('Snapshot rasterization cancelled'));
    return true;
  }

  close(): void {
    this.disposed = true;
    this.settlePendingError(new Error('Snapshot rasterizer closed'));
    this.destroyWindow();
  }

  private async ensureWindow(requestId: string): Promise<BrowserWindow> {
    // E: a real rasterizer can only run one job at a time. If a different
    // request is already in flight, tear down its hidden window first so
    // the new request owns a fresh sandboxed renderer (old pending entry is
    // settled as cancelled by the caller path; here we just reclaim the
    // window). This prevents the `pending` map from becoming an unbounded
    // set of actual hidden-renderer jobs.
    if (this.activeRequestId && this.activeRequestId !== requestId) {
      const oldPending = this.pending.get(this.activeRequestId);
      if (oldPending) {
        this.pending.delete(this.activeRequestId);
        clearTimeout(oldPending.wallTimer);
        oldPending.reject(new Error('Snapshot rasterization superseded'));
      }
      this.activeRequestId = null;
      this.destroyWindow();
    }

    const existing = this.getWindow();
    if (existing && this.ready) {
      this.activeRequestId = requestId;
      return existing;
    }
    if (existing) this.destroyWindow();

    const window = this.windowFactory.create({
      width: 2,
      height: 2,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/fla-static-snapshot.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        partition: `fla-snapshot-${randomUUID()}`,
      },
    });
    this.window = window;
    this.ready = false;
    const developmentUrl = process.env.VITE_DEV_SERVER_URL;
    const allowedDevelopmentOrigin = developmentUrl
      ? new URL(developmentUrl).origin
      : null;
    const allowedFileRoot = pathToFileURL(
      path.join(__dirname, '../../../dist/renderer'),
    ).toString();
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*', 'file://*/*'] },
      (details, callback) => {
        const allowed = allowedDevelopmentOrigin
          ? details.url.startsWith(`${allowedDevelopmentOrigin}/`)
          : details.url.startsWith(allowedFileRoot);
        callback({ cancel: !allowed });
      },
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      // C: when the snapshot renderer process/window dies, settle all
      // affected pending raster requests immediately instead of making
      // callers wait for the full wall-clock timeout.
      this.settlePendingError(new Error('Snapshot renderer process gone'));
      this.destroyWindow();
    });
    window.once('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.ready = false;
      }
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyTimer = setTimeout(() => {
        reject(new Error('Snapshot renderer ready handshake timed out'));
        this.readyTimer = null;
      }, this.timing.readyTimeoutMs);
    });

    try {
      if (developmentUrl) {
        await window.loadURL(new URL('fla-static-snapshot.html', developmentUrl).toString());
      } else {
        await window.loadFile(path.join(__dirname, '../../../dist/renderer/fla-static-snapshot.html'));
      }
      // A close() during spawn must reject the caller instead of hanging on
      // the handshake forever.
      if (this.disposed) throw new Error('Snapshot rasterizer closed');
      await readyPromise;
      this.activeRequestId = requestId;
      return window;
    } catch (error) {
      this.destroyWindow();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /** Reject every pending raster request with the given error (crash path). */
  private settlePendingError(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.wallTimer);
      pending.reject(error);
    }
    this.pending.clear();
    this.activeRequestId = null;
  }

  private destroyWindow(): void {
    const window = this.getWindow();
    this.window = null;
    this.ready = false;
    this.activeRequestId = null;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyResolve = null;
    if (window) window.destroy();
  }
}
