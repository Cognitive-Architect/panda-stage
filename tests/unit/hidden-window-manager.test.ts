import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/domain';

const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    loadFileArguments: unknown[] | null = null;
    loadURLArgument: string | null = null;

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

    async loadFile(filePath: string, options?: unknown): Promise<void> {
      this.loadFileArguments = [filePath, options];
    }

    async loadURL(url: string): Promise<void> {
      this.loadURLArgument = url;
    }

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back only the next formal Job after an explicit-sync frame timeout', async () => {
    vi.useFakeTimers();
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const startupWindow = manager.create();
    manager.markReady(42);
    await startupWindow;
    const firstCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await firstCreate;
    const jobId = randomUUID();
    const loading = manager.loadFormal({
      jobId,
      project: {} as unknown as Project,
      cameraMode: 'static',
      media: [],
    });
    manager.markFormalLoaded(42, { jobId, acknowledged: true });
    await loading;
    const rendering = manager.renderFrame({ jobId, frameIndex: 0, timeMs: 0 });
    const rejected = expect(rendering).rejects.toThrow(/frame 0 render timed out/);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    manager.releaseJob();

    const secondCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await secondCreate;
    expect(FakeBrowserWindow.instances[0]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'legacy-raf',
        pandaStagePngMode: 'legacy-blob',
      },
    });
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    expect(FakeBrowserWindow.instances[2]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'legacy-raf',
        pandaStagePngMode: 'legacy-blob',
      },
    });
    manager.releaseJob();
    vi.useRealTimers();
  });

  it('does not treat ordinary cancellation as a draw or PNG timeout', async () => {
    vi.useFakeTimers();
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const firstCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await firstCreate;
    const jobId = randomUUID();
    const loading = manager.loadFormal({
      jobId,
      project: {} as unknown as Project,
      cameraMode: 'static',
      media: [],
    });
    manager.markFormalLoaded(42, { jobId, acknowledged: true });
    await loading;
    const rendering = manager.renderFrame({ jobId, frameIndex: 0, timeMs: 0 });
    const rejected = expect(rendering).rejects.toThrow(/hidden rendering cancelled/);
    manager.cancelJob(jobId);
    await rejected;
    await vi.advanceTimersByTimeAsync(15_000);
    manager.releaseJob();

    const secondCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await secondCreate;
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    manager.releaseJob();
    vi.useRealTimers();
  });

  it('keeps legacy-raf selected after a legacy frame timeout', async () => {
    vi.useFakeTimers();
    const manager = new HiddenWindowManager({
      formalDrawMode: 'legacy-raf',
      formalPngMode: 'legacy-blob',
    });
    const firstCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await firstCreate;
    const jobId = randomUUID();
    const loading = manager.loadFormal({
      jobId,
      project: {} as unknown as Project,
      cameraMode: 'static',
      media: [],
    });
    manager.markFormalLoaded(42, { jobId, acknowledged: true });
    await loading;
    const rendering = manager.renderFrame({ jobId, frameIndex: 0, timeMs: 0 });
    const rejected = expect(rendering).rejects.toThrow(/frame 0 render timed out/);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    manager.releaseJob();

    const secondCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await secondCreate;
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'legacy-raf',
        pandaStagePngMode: 'legacy-blob',
      },
    });
    manager.releaseJob();
    vi.useRealTimers();
  });

  it('keeps probe Jobs on the legacy drawing and PNG paths', async () => {
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const creating = manager.prepareJob('probe');
    manager.markReady(42);
    await creating;
    expect(FakeBrowserWindow.instances[0]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'legacy-raf',
        pandaStagePngMode: 'legacy-blob',
      },
    });
    manager.releaseJob();
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

  it('correlates formal frame responses with the requested Shot and local time', async () => {
    const manager = new HiddenWindowManager();
    const creating = manager.create();
    manager.markReady(42);
    await creating;
    const jobId = randomUUID();
    const loading = manager.loadProbe({ jobId, durationMs: 3_000, fps: 24 });
    manager.markProbeLoaded(42, { jobId, acknowledged: true });
    await loading;
    const request = {
      jobId,
      frameIndex: 25,
      timeMs: 1_041,
      shotId: randomUUID(),
      shotLocalTimeMs: 40,
    };
    const rendering = manager.renderFrame(request);

    expect(() =>
      manager.markFrameReady(42, {
        ...request,
        shotLocalTimeMs: 39,
        width: 1_920,
        height: 1_080,
        pngBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
      }),
    ).toThrow(/Unexpected frame-ready response/);
    manager.markFrameReady(42, {
      ...request,
      width: 1_920,
      height: 1_080,
      pngBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    });
    await expect(rendering).resolves.toMatchObject(request);
    manager.close();
  });

  it('cancels only the matching Job, ignores its late frame, and releases the window', async () => {
    const manager = new HiddenWindowManager();
    const creating = manager.create();
    manager.markReady(42);
    await creating;
    const jobId = randomUUID();
    const loading = manager.loadProbe({ jobId, durationMs: 3_000, fps: 24 });
    manager.markProbeLoaded(42, { jobId, acknowledged: true });
    await loading;
    const rendering = manager.renderFrame({
      jobId,
      frameIndex: 3,
      timeMs: 125,
    });
    const rejected = expect(rendering).rejects.toThrow(
      `Export Job ${jobId}: hidden rendering cancelled`,
    );

    expect(manager.cancelJob(randomUUID())).toBe(false);
    expect(manager.cancelJob(jobId)).toBe(true);
    await rejected;
    expect(FakeBrowserWindow.instances[0]?.webContents.send).toHaveBeenCalledWith(
      'export:cancel-render',
      { jobId },
    );
    expect(() =>
      manager.markFrameReady(42, {
        jobId,
        frameIndex: 3,
        timeMs: 125,
        width: 1_920,
        height: 1_080,
        pngBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
      }),
    ).not.toThrow();
    expect(manager.getDiagnostics()).toEqual({
      windowOpen: true,
      loadedJobId: null,
      pendingLoadJobId: null,
      pendingFrameJobId: null,
      drawMode: 'legacy-raf',
      pngMode: 'legacy-blob',
    });

    manager.releaseJob();
    expect(manager.getDiagnostics().windowOpen).toBe(false);
  });

  it('fixes the formal draw mode before a Job and falls back only for the next Job', async () => {
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const firstCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await firstCreate;

    const firstJobId = randomUUID();
    const formalLoad = manager.loadFormal({
      jobId: firstJobId,
      project: {} as unknown as Project,
      cameraMode: 'static',
      media: [],
    });
    manager.markFormalLoaded(42, {
      jobId: firstJobId,
      acknowledged: true,
    });
    await formalLoad;

    const frameRequest = { jobId: firstJobId, frameIndex: 0, timeMs: 0 };
    const rendering = manager.renderFrame(frameRequest);
    const rejected = expect(rendering).rejects.toThrow(/draw failed/);
    manager.markFrameFailed(42, { ...frameRequest, error: 'draw failed' });
    await rejected;
    manager.releaseJob();

    const secondCreate = manager.prepareJob('formal');
    manager.markReady(42);
    await secondCreate;
    expect(FakeBrowserWindow.instances[0]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'legacy-raf',
        pandaStagePngMode: 'legacy-blob',
      },
    });
    expect(manager.getDiagnostics().drawMode).toBe('legacy-raf');
    manager.releaseJob();
  });

  it('replaces an idle startup window and keeps each Job mode locked until release', async () => {
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const startupWindow = manager.create();
    manager.markReady(42);
    await startupWindow;

    const firstJob = manager.prepareJob('formal');
    manager.markReady(42);
    await firstJob;

    expect(FakeBrowserWindow.instances[0]?.isDestroyed()).toBe(true);
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    await expect(manager.create('legacy-raf', 'legacy-blob')).rejects.toThrow(
      /Hidden window export modes cannot change during a Job/,
    );

    const firstJobId = randomUUID();
    const formalLoad = manager.loadFormal({
      jobId: firstJobId,
      project: {} as unknown as Project,
      cameraMode: 'static',
      media: [],
    });
    manager.markFormalLoaded(42, {
      jobId: firstJobId,
      acknowledged: true,
    });
    await formalLoad;
    manager.releaseJob();

    const secondJob = manager.prepareJob('formal');
    manager.markReady(42);
    await secondJob;
    expect(FakeBrowserWindow.instances[1]?.isDestroyed()).toBe(true);
    expect(FakeBrowserWindow.instances[2]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    manager.releaseJob();
  });

  it('clears the mode reservation when hidden-window startup fails so retry can proceed', async () => {
    const manager = new HiddenWindowManager({
      formalDrawMode: 'explicit-sync',
      formalPngMode: 'worker-png',
    });
    const failedStartup = manager.prepareJob('formal');
    manager.close();
    await expect(failedStartup).rejects.toThrow(
      /Hidden window closed during cleanup/,
    );

    const retry = manager.prepareJob('formal');
    manager.markReady(42);
    await retry;
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(FakeBrowserWindow.instances[1]?.loadFileArguments?.[1]).toEqual({
      query: {
        pandaStageDrawMode: 'explicit-sync',
        pandaStagePngMode: 'worker-png',
      },
    });
    manager.releaseJob();
  });
});
