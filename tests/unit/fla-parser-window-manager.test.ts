import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import {
  FlaParserOperationError,
  type FlaParserWindowFactory,
  FlaParserWindowManager,
} from '../../src/main/windows/fla-parser-window-manager';

class FakeWebContents extends EventEmitter {
  readonly id = 451;
  readonly session = {
    webRequest: { onBeforeRequest: vi.fn() },
  };
  readonly send = vi.fn();

  setWindowOpenHandler(): void {}
}

class FakeBrowserWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  private destroyed = false;
  private url = '';

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(url: string): Promise<void> {
    this.url = url;
  }

  async loadFile(filePath: string): Promise<void> {
    this.url = `file://${filePath}`;
  }

  getURL(): string {
    return this.url;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

const fakeState: { instances: FakeBrowserWindow[] } = { instances: [] };
const windowFactory: FlaParserWindowFactory = {
  create: () => {
    const window = new FakeBrowserWindow();
    fakeState.instances.push(window);
    return window as unknown as BrowserWindow;
  },
};

const SESSION_ID = '00000000-0000-4000-8000-000000000251';

function request() {
  return {
    sessionId: SESSION_ID,
    source: {
      basename: 'sample.fla',
      byteLength: 1,
      sha256: 'a'.repeat(64),
      bytes: new Uint8Array([1]),
      containsActionScript: false,
    },
  } as const;
}

function start(manager: FlaParserWindowManager): Promise<unknown> {
  const promise = manager.inspect(request());
  const window = fakeState.instances[fakeState.instances.length - 1];
  if (!window) throw new Error('fake parser window was not created');
  manager.markReady(window.webContents.id);
  return promise;
}

async function settleStart(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function expectOperation(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected parser operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FlaParserOperationError);
    expect((error as FlaParserOperationError).code).toBe(code);
  }
}

afterEach(() => {
  for (const instance of fakeState.instances) instance.destroy();
  fakeState.instances.length = 0;
});

describe('FlaParserWindowManager lifecycle containment', () => {
  it('turns a no-progress watchdog expiry into PARSER_TIMEOUT and destroys the worker', async () => {
    const manager = new FlaParserWindowManager({
      readyTimeoutMs: 100,
      parserWallTimeMs: 200,
      noProgressWatchdogMs: 20,
      cancelGraceMs: 10,
    }, windowFactory);
    const promise = start(manager);

    await expectOperation(promise, 'PARSER_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.getDiagnostics()).toEqual({
      windowOpen: false,
      workerReady: false,
      sessionId: null,
    });
    manager.close();
  });

  it('maps parser renderer death to PARSER_CRASH and destroys the window', async () => {
    const manager = new FlaParserWindowManager({
      readyTimeoutMs: 100,
      parserWallTimeMs: 200,
      noProgressWatchdogMs: 200,
      cancelGraceMs: 10,
    }, windowFactory);
    const promise = start(manager);
    await settleStart();
    const window = fakeState.instances[fakeState.instances.length - 1];
    if (!window) throw new Error('fake parser window was not created');

    window.webContents.emit('render-process-gone');
    await expectOperation(promise, 'PARSER_CRASH');
    expect(manager.getDiagnostics().windowOpen).toBe(false);
    manager.close();
  });

  it('cancels an active session and completes cleanup after the grace period', async () => {
    const manager = new FlaParserWindowManager({
      readyTimeoutMs: 100,
      parserWallTimeMs: 200,
      noProgressWatchdogMs: 200,
      cancelGraceMs: 10,
    }, windowFactory);
    const promise = start(manager);
    await settleStart();

    expect(manager.cancel(SESSION_ID)).toBe(true);
    await expectOperation(promise, 'USER_CANCELLED');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.getDiagnostics().windowOpen).toBe(false);
    manager.close();
  });

  it('rejects malformed worker results as PARSER_CRASH', async () => {
    const manager = new FlaParserWindowManager({
      readyTimeoutMs: 100,
      parserWallTimeMs: 200,
      noProgressWatchdogMs: 200,
      cancelGraceMs: 10,
    }, windowFactory);
    const promise = start(manager);
    await settleStart();
    const window = fakeState.instances[fakeState.instances.length - 1];
    if (!window) throw new Error('fake parser window was not created');

    manager.markResult(window.webContents.id, { sessionId: SESSION_ID, ir: null });
    await expectOperation(promise, 'PARSER_CRASH');
    expect(manager.getDiagnostics().windowOpen).toBe(false);
    manager.close();
  });
});
