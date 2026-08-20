import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  FLA_IMPORT_LIMITS,
  FlaWorkerErrorSchema,
  FlaWorkerProgressSchema,
  FlaWorkerResultSchema,
  type AnimationImportIR,
  type FlaImportErrorCode,
  type FlaWorkerStartRequest,
} from '../../shared/fla-import-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';

export interface FlaParserWindowManagerTiming {
  readyTimeoutMs: number;
  parserWallTimeMs: number;
  noProgressWatchdogMs: number;
  cancelGraceMs: number;
}

export interface FlaParserWindowFactory {
  create(options: BrowserWindowConstructorOptions): BrowserWindow;
}

const DEFAULT_TIMING: FlaParserWindowManagerTiming = {
  readyTimeoutMs: 10_000,
  parserWallTimeMs: FLA_IMPORT_LIMITS.parserWallTimeMs,
  noProgressWatchdogMs: FLA_IMPORT_LIMITS.noProgressWatchdogMs,
  cancelGraceMs: FLA_IMPORT_LIMITS.cancelGraceMs,
};

const DEFAULT_WINDOW_FACTORY: FlaParserWindowFactory = {
  create: (options) => new BrowserWindow(options),
};

export class FlaParserOperationError extends Error {
  readonly code: FlaImportErrorCode;

  constructor(code: FlaImportErrorCode, message: string) {
    super(message);
    this.name = 'FlaParserOperationError';
    this.code = code;
  }
}

interface ActiveParse {
  sessionId: string;
  resolve: (ir: AnimationImportIR) => void;
  reject: (error: FlaParserOperationError) => void;
  wallTimer: NodeJS.Timeout;
  watchdogTimer: NodeJS.Timeout;
  destroyTimer: NodeJS.Timeout | null;
  settled: boolean;
  cancelRequested: boolean;
}

function operationError(code: FlaImportErrorCode, message: string): FlaParserOperationError {
  return new FlaParserOperationError(code, message.slice(0, 1_000));
}

export class FlaParserWindowManager {
  private readonly timing: FlaParserWindowManagerTiming;
  private readonly windowFactory: FlaParserWindowFactory;
  private window: BrowserWindow | null = null;
  private ready = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private active: ActiveParse | null = null;
  private readonly cancelledSessionIds = new Set<string>();

  constructor(
    timing: Partial<FlaParserWindowManagerTiming> = {},
    windowFactory: FlaParserWindowFactory = DEFAULT_WINDOW_FACTORY,
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.windowFactory = windowFactory;
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  getDiagnostics(): {
    windowOpen: boolean;
    workerReady: boolean;
    sessionId: string | null;
  } {
    return {
      windowOpen: this.getWindow() !== null,
      workerReady: this.ready,
      sessionId: this.active?.sessionId ?? null,
    };
  }

  async inspect(request: FlaWorkerStartRequest): Promise<AnimationImportIR> {
    if (this.active) {
      throw operationError('PARSER_CRASH', 'The FLA parser worker is busy');
    }
    this.cancelledSessionIds.delete(request.sessionId);
    const window = await this.create();
    if (this.cancelledSessionIds.delete(request.sessionId)) {
      this.destroyWindow();
      throw operationError('USER_CANCELLED', 'FLA inspection was cancelled');
    }
    const promise = new Promise<AnimationImportIR>((resolve, reject) => {
      const active: ActiveParse = {
        sessionId: request.sessionId,
        resolve,
        reject,
        wallTimer: setTimeout(() => {
          this.requestTermination(
            active,
            'PARSER_TIMEOUT',
            'FLA parser wall time or no-progress watchdog expired',
          );
        }, this.timing.parserWallTimeMs),
        watchdogTimer: setTimeout(() => {
          this.requestTermination(
            active,
            'PARSER_TIMEOUT',
            'FLA parser made no progress within the watchdog window',
          );
        }, this.timing.noProgressWatchdogMs),
        destroyTimer: null,
        settled: false,
        cancelRequested: false,
      };
      this.active = active;
      if (this.cancelledSessionIds.delete(request.sessionId)) {
        this.requestTermination(active, 'USER_CANCELLED', 'FLA inspection was cancelled');
        return;
      }
      window.webContents.send(IPC_CHANNELS.FLA_WORKER_START, request);
    });
    return promise;
  }

  cancel(sessionId: string): boolean {
    const active = this.active;
    if (!active || active.sessionId !== sessionId || active.settled) {
      this.cancelledSessionIds.add(sessionId);
      const window = this.getWindow();
      if (window) window.webContents.send(IPC_CHANNELS.FLA_WORKER_CANCEL, sessionId);
      return true;
    }
    active.cancelRequested = true;
    const window = this.getWindow();
    if (window) window.webContents.send(IPC_CHANNELS.FLA_WORKER_CANCEL, sessionId);
    this.requestTermination(active, 'USER_CANCELLED', 'FLA inspection was cancelled');
    return true;
  }

  markReady(senderId: number): void {
    this.assertSender(senderId);
    this.ready = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyResolve?.();
    this.readyResolve = null;
    this.readyReject = null;
  }

  markProgress(senderId: number, rawPayload: unknown): void {
    this.assertSender(senderId);
    const active = this.active;
    let payload;
    try {
      payload = FlaWorkerProgressSchema.parse(rawPayload);
    } catch {
      if (active && !active.settled) {
        this.rejectActive(
          active,
          operationError('PARSER_CRASH', 'FLA parser progress message failed validation'),
          true,
        );
      }
      return;
    }
    if (!active || active.sessionId !== payload.sessionId || active.settled) return;
    clearTimeout(active.watchdogTimer);
    active.watchdogTimer = setTimeout(() => {
      this.requestTermination(
        active,
        'PARSER_TIMEOUT',
        'FLA parser made no progress within the watchdog window',
      );
    }, this.timing.noProgressWatchdogMs);
  }

  markResult(senderId: number, rawPayload: unknown): void {
    this.assertSender(senderId);
    const active = this.active;
    let payload;
    try {
      payload = FlaWorkerResultSchema.parse(rawPayload);
    } catch {
      if (active && !active.settled) {
        this.rejectActive(
          active,
          operationError('PARSER_CRASH', 'FLA parser result failed validation'),
          true,
        );
      }
      return;
    }
    if (!active || active.sessionId !== payload.sessionId || active.settled) return;
    this.resolveActive(active, payload.ir);
  }

  markError(senderId: number, rawPayload: unknown): void {
    this.assertSender(senderId);
    const active = this.active;
    let payload;
    try {
      payload = FlaWorkerErrorSchema.parse(rawPayload);
    } catch {
      if (active && !active.settled) {
        this.rejectActive(
          active,
          operationError('PARSER_CRASH', 'FLA parser error message failed validation'),
          true,
        );
      }
      return;
    }
    if (!active || active.sessionId !== payload.sessionId || active.settled) return;
    this.rejectActive(
      active,
      operationError(payload.error.code, payload.error.message),
      true,
    );
  }

  close(): void {
    const active = this.active;
    if (active && !active.settled) {
      this.rejectActive(
        active,
        operationError('PARSER_CRASH', 'FLA parser worker was closed'),
        false,
      );
    }
    this.clearReady(new Error('FLA parser worker closed'));
    this.active = null;
    this.cancelledSessionIds.clear();
    this.destroyWindow();
  }

  private async create(): Promise<BrowserWindow> {
    const existing = this.getWindow();
    if (existing && this.ready) return existing;
    if (existing) this.destroyWindow();

    const window = this.windowFactory.create({
      width: 2,
      height: 2,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/fla-parser.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        partition: `fla-parser-${randomUUID()}`,
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
      const active = this.active;
      if (active && !active.settled) {
        this.rejectActive(
          active,
          operationError('PARSER_CRASH', 'FLA parser renderer crashed'),
          true,
        );
      } else {
        this.destroyWindow();
      }
    });
    window.once('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.ready = false;
      }
      const active = this.active;
      if (active && !active.settled) {
        this.rejectActive(
          active,
          operationError('PARSER_CRASH', 'FLA parser window closed unexpectedly'),
          false,
        );
      }
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        reject(operationError('PARSER_CRASH', 'FLA parser worker ready handshake timed out'));
        this.readyTimer = null;
      }, this.timing.readyTimeoutMs);
    });

    try {
      if (developmentUrl) {
        await window.loadURL(new URL('fla-parser.html', developmentUrl).toString());
      } else {
        await window.loadFile(path.join(__dirname, '../../../dist/renderer/fla-parser.html'));
      }
      await readyPromise;
      return window;
    } catch (error) {
      this.clearReady(error instanceof Error ? error : new Error(String(error)));
      this.destroyWindow();
      throw operationError('PARSER_CRASH', 'FLA parser worker could not be started');
    }
  }

  private requestTermination(
    active: ActiveParse,
    code: FlaImportErrorCode,
    message: string,
  ): void {
    if (active.cancelRequested === false && code === 'USER_CANCELLED') {
      active.cancelRequested = true;
    }
    if (!active.settled) {
      active.settled = true;
      clearTimeout(active.wallTimer);
      clearTimeout(active.watchdogTimer);
      active.reject(operationError(code, message));
    }
    const window = this.getWindow();
    if (window) window.webContents.send(IPC_CHANNELS.FLA_WORKER_CANCEL, active.sessionId);
    if (!active.destroyTimer) {
      active.destroyTimer = setTimeout(() => {
        if (this.active === active) this.active = null;
        this.destroyWindow();
      }, this.timing.cancelGraceMs);
    }
  }

  private resolveActive(active: ActiveParse, ir: AnimationImportIR): void {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.wallTimer);
    clearTimeout(active.watchdogTimer);
    this.active = null;
    active.resolve(ir);
    this.destroyWindow();
  }

  private rejectActive(active: ActiveParse, error: FlaParserOperationError, destroy: boolean): void {
    if (!active.settled) {
      active.settled = true;
      clearTimeout(active.wallTimer);
      clearTimeout(active.watchdogTimer);
      active.reject(error);
    }
    if (this.active === active) this.active = null;
    if (destroy) this.destroyWindow();
  }

  private assertSender(senderId: number): void {
    const window = this.getWindow();
    if (!window || window.webContents.id !== senderId) {
      throw new Error('FLA parser message came from an unknown sender');
    }
  }

  private clearReady(error?: Error): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (error) this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
  }

  private destroyWindow(): void {
    const window = this.getWindow();
    this.window = null;
    this.ready = false;
    this.clearReady();
    if (window) window.destroy();
  }
}
