import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];

    readonly webContents = {
      id: 42,
      send: vi.fn(),
    };

    private destroyed = false;
    private readonly listeners = new Map<string, () => void>();

    constructor() {
      FakeBrowserWindow.instances.push(this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    async loadFile(): Promise<void> {}

    async loadURL(): Promise<void> {}

    once(event: string, listener: () => void): void {
      this.listeners.set(event, listener);
    }

    destroy(): void {
      this.destroyed = true;
      this.listeners.get('closed')?.();
    }
  }

  return { FakeBrowserWindow };
});

vi.mock('electron', () => ({ BrowserWindow: FakeBrowserWindow }));

import { HiddenWindowManager } from '../../src/main/windows/hidden-window-manager';

describe('HiddenWindowManager frame failure correlation', () => {
  beforeEach(() => {
    FakeBrowserWindow.instances = [];
  });

  it('rejects frame-failed responses whose timeMs does not match the pending request', async () => {
    const manager = new HiddenWindowManager();
    const creating = manager.create();
    manager.markReady(42);
    await creating;

    const jobId = randomUUID();
    const loading = manager.loadProbe({ jobId, durationMs: 3_000, fps: 24 });
    manager.markProbeLoaded(42, { jobId, acknowledged: true });
    await loading;

    const rendering = manager.renderFrame({ jobId, frameIndex: 1, timeMs: 41 });
    const expectedRejection = expect(rendering).rejects.toThrow(
      `Job ${jobId} frame 1 failed: controlled failure`,
    );

    expect(() =>
      manager.markFrameFailed(42, {
        jobId,
        frameIndex: 1,
        timeMs: 42,
        error: 'wrong timestamp',
      }),
    ).toThrow(/Unexpected frame-failed response/);

    manager.markFrameFailed(42, {
      jobId,
      frameIndex: 1,
      timeMs: 41,
      error: 'controlled failure',
    });
    await expectedRejection;
    manager.close();
  });
});
