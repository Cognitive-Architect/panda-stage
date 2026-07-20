import { BrowserWindow } from 'electron';
import path from 'node:path';
import {
  ExportFrameFailedSchema,
  ExportFrameReadySchema,
  ExportLoadProbeRequestSchema,
  ExportProbeLoadedSchema,
  ExportRenderFrameRequestSchema,
  type ExportFrameFailed,
  type ExportFrameReady,
  type ExportLoadProbeRequest,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
} from '../../shared/export-types';
import { IPC_CHANNELS } from '../../shared/ipc/channels';

const READY_TIMEOUT_MS = 10_000;
const LOAD_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 15_000;

interface PendingRequest<TRequest, TResponse> {
  request: TRequest;
  resolve: (response: TResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class HiddenWindowManager {
  private window: BrowserWindow | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimeout: NodeJS.Timeout | null = null;
  private loadedJobId: string | null = null;
  private pendingLoad: PendingRequest<
    ExportLoadProbeRequest,
    ExportProbeLoaded
  > | null = null;
  private pendingFrame: PendingRequest<
    ExportRenderFrameRequest,
    ExportFrameReady
  > | null = null;

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async create(): Promise<BrowserWindow> {
    const existingWindow = this.getWindow();
    if (existingWindow) {
      return existingWindow;
    }

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimeout = setTimeout(() => {
        reject(new Error('Hidden window ready handshake timed out.'));
      }, READY_TIMEOUT_MS);
    });

    const window = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/hidden.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;

    window.once('closed', () => {
      if (this.window === window) {
        this.window = null;
      }
      this.rejectReady(new Error('Hidden window closed before ready.'));
      this.rejectPendingRequests(
        new Error('Hidden window closed during frame export.'),
      );
    });

    try {
      const developmentUrl = process.env.VITE_DEV_SERVER_URL;
      if (developmentUrl) {
        await window.loadURL(new URL('hidden.html', developmentUrl).toString());
      } else {
        await window.loadFile(
          path.join(__dirname, '../../../dist/renderer/hidden.html'),
        );
      }

      await readyPromise;
      console.info(
        `Hidden window ready (webContents=${window.webContents.id}).`,
      );
      return window;
    } catch (error) {
      void readyPromise.catch(() => undefined);
      this.close();
      throw error;
    }
  }

  async loadProbe(
    rawRequest: ExportLoadProbeRequest,
  ): Promise<ExportProbeLoaded> {
    const request = ExportLoadProbeRequestSchema.parse(rawRequest);
    const window = this.requireWindow();
    if (this.pendingLoad || this.pendingFrame) {
      throw new Error('Hidden window is busy with another export request.');
    }

    const promise = new Promise<ExportProbeLoaded>((resolve, reject) => {
      this.pendingLoad = {
        request,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pendingLoad = null;
          reject(
            new Error(`Job ${request.jobId} probe-load handshake timed out.`),
          );
        }, LOAD_TIMEOUT_MS),
      };
    });
    window.webContents.send(IPC_CHANNELS.EXPORT_LOAD_PROBE, request);
    return promise;
  }

  async renderFrame(
    rawRequest: ExportRenderFrameRequest,
  ): Promise<ExportFrameReady> {
    const request = ExportRenderFrameRequestSchema.parse(rawRequest);
    const window = this.requireWindow();
    if (this.loadedJobId !== request.jobId) {
      throw new Error(`Hidden window has not loaded Job ${request.jobId}.`);
    }
    if (this.pendingLoad || this.pendingFrame) {
      throw new Error('Hidden window is busy with another export request.');
    }

    const promise = new Promise<ExportFrameReady>((resolve, reject) => {
      this.pendingFrame = {
        request,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pendingFrame = null;
          reject(
            new Error(
              `Job ${request.jobId} frame ${request.frameIndex} render timed out.`,
            ),
          );
        }, FRAME_TIMEOUT_MS),
      };
    });
    window.webContents.send(IPC_CHANNELS.EXPORT_RENDER_FRAME, request);
    return promise;
  }

  markReady(senderId: number): void {
    this.assertSender(senderId);
    this.clearReadyTimeout();
    this.readyResolve?.();
    this.clearReadyCallbacks();
  }

  markProbeLoaded(senderId: number, rawPayload: ExportProbeLoaded): void {
    this.assertSender(senderId);
    const payload = ExportProbeLoadedSchema.parse(rawPayload);
    const pending = this.pendingLoad;
    if (!pending || pending.request.jobId !== payload.jobId) {
      throw new Error(`Unexpected probe-loaded response for Job ${payload.jobId}.`);
    }

    clearTimeout(pending.timeout);
    this.pendingLoad = null;
    this.loadedJobId = payload.jobId;
    pending.resolve(payload);
  }

  markFrameReady(senderId: number, rawPayload: ExportFrameReady): void {
    this.assertSender(senderId);
    const payload = ExportFrameReadySchema.parse(rawPayload);
    const pending = this.pendingFrame;
    if (
      !pending ||
      pending.request.jobId !== payload.jobId ||
      pending.request.frameIndex !== payload.frameIndex ||
      pending.request.timeMs !== payload.timeMs
    ) {
      throw new Error(
        `Unexpected frame-ready response for Job ${payload.jobId}, frame ${payload.frameIndex}.`,
      );
    }

    clearTimeout(pending.timeout);
    this.pendingFrame = null;
    pending.resolve(payload);
  }

  markFrameFailed(senderId: number, rawPayload: ExportFrameFailed): void {
    this.assertSender(senderId);
    const payload = ExportFrameFailedSchema.parse(rawPayload);
    const pending = this.pendingFrame;
    if (
      !pending ||
      pending.request.jobId !== payload.jobId ||
      pending.request.frameIndex !== payload.frameIndex ||
      pending.request.timeMs !== payload.timeMs
    ) {
      throw new Error(
        `Unexpected frame-failed response for Job ${payload.jobId}, frame ${payload.frameIndex}.`,
      );
    }

    clearTimeout(pending.timeout);
    this.pendingFrame = null;
    pending.reject(
      new Error(
        `Job ${payload.jobId} frame ${payload.frameIndex} failed: ${payload.error}`,
      ),
    );
  }

  close(): void {
    const cleanupError = new Error('Hidden window closed during cleanup.');
    this.rejectReady(cleanupError);
    this.rejectPendingRequests(cleanupError);
    this.loadedJobId = null;
    const window = this.getWindow();
    this.window = null;
    if (window) {
      window.destroy();
    }
  }

  private requireWindow(): BrowserWindow {
    const window = this.getWindow();
    if (!window) {
      throw new Error('Hidden window is unavailable.');
    }
    return window;
  }

  private assertSender(senderId: number): void {
    const window = this.requireWindow();
    if (window.webContents.id !== senderId) {
      throw new Error('Hidden export response came from an unknown sender.');
    }
  }

  private rejectPendingRequests(error: Error): void {
    if (this.pendingLoad) {
      clearTimeout(this.pendingLoad.timeout);
      this.pendingLoad.reject(error);
      this.pendingLoad = null;
    }
    if (this.pendingFrame) {
      clearTimeout(this.pendingFrame.timeout);
      this.pendingFrame.reject(error);
      this.pendingFrame = null;
    }
  }

  private rejectReady(error: Error): void {
    this.clearReadyTimeout();
    this.readyReject?.(error);
    this.clearReadyCallbacks();
  }

  private clearReadyTimeout(): void {
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
  }

  private clearReadyCallbacks(): void {
    this.readyResolve = null;
    this.readyReject = null;
  }
}
