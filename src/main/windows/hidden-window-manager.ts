import { BrowserWindow } from 'electron';
import path from 'node:path';

const READY_TIMEOUT_MS = 10_000;

export class HiddenWindowManager {
  private window: BrowserWindow | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimeout: NodeJS.Timeout | null = null;

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
    });

    const developmentUrl = process.env.VITE_DEV_SERVER_URL;
    if (developmentUrl) {
      await window.loadURL(new URL('hidden.html', developmentUrl).toString());
    } else {
      await window.loadFile(
        path.join(__dirname, '../../../dist/renderer/hidden.html'),
      );
    }

    try {
      await readyPromise;
      console.info(`Hidden window ready (webContents=${window.webContents.id}).`);
      return window;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  markReady(senderId: number): void {
    const window = this.getWindow();
    if (!window || window.webContents.id !== senderId) {
      throw new Error('Hidden ready handshake came from an unknown sender.');
    }

    this.clearReadyTimeout();
    this.readyResolve?.();
    this.clearReadyCallbacks();
  }

  close(): void {
    this.rejectReady(new Error('Hidden window was closed during cleanup.'));
    const window = this.getWindow();
    this.window = null;
    if (window) {
      window.destroy();
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
