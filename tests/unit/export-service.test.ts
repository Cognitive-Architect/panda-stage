import { describe, expect, it } from 'vitest';
import type { FrameFileSystem } from '../../src/main/services/FileSystemService';
import {
  ExportJobError,
  ExportService,
  type FullProbeMediaAdapter,
  type FrameRenderer,
} from '../../src/main/services/ExportService';
import type { VideoProbeResult } from '../../src/shared/ffmpeg-types';
import type {
  ExportFrameReady,
  ExportLoadProbeRequest,
  ExportProbeLoaded,
  ExportRenderFrameRequest,
} from '../../src/shared/export-types';

class MemoryFileSystem implements FrameFileSystem {
  readonly directories = new Map<string, Map<string, Uint8Array>>();
  cleaned: string[] = [];
  inFlight = 0;
  peakInFlight = 0;
  failAtFile: string | null = null;
  successfulWrites: string[] = [];
  cleanupFailure: Error | null = null;
  projectDirectories: string[] = [];
  writeGate: Promise<void> | null = null;

  async createJobDirectory(jobId: string): Promise<string> {
    const directory = `/jobs/${jobId}`;
    this.directories.set(directory, new Map());
    return directory;
  }

  async writeFrame(directory: string, fileName: string, bytes: Uint8Array) {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    if (this.writeGate) await this.writeGate;
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.inFlight -= 1;
    if (fileName === this.failAtFile) {
      throw new Error(`simulated write failure: ${fileName}`);
    }
    this.directories.get(directory)?.set(fileName, bytes);
    this.successfulWrites.push(fileName);
  }

  async listFrameFiles(directory: string): Promise<string[]> {
    return [...(this.directories.get(directory)?.keys() ?? [])].sort();
  }

  async cleanupJobDirectory(directory: string): Promise<void> {
    this.cleaned.push(directory);
    if (this.cleanupFailure) throw this.cleanupFailure;
    this.directories.delete(directory);
  }

  async assertReadableProjectDirectory(directory: string): Promise<string> {
    this.projectDirectories.push(directory);
    return directory;
  }
}

class MemoryRenderer implements FrameRenderer {
  requests: ExportRenderFrameRequest[] = [];
  failAtFrame: number | null = null;
  cancelledJobs: string[] = [];
  prepared = 0;
  releasedJobs: string[] = [];

  cancelJob(jobId: string): boolean {
    this.cancelledJobs.push(jobId);
    return true;
  }

  async prepareJob(): Promise<void> {
    this.prepared += 1;
  }

  releaseJob(jobId: string): void {
    this.releasedJobs.push(jobId);
  }

  async loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded> {
    return { jobId: request.jobId, acknowledged: true };
  }

  async renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady> {
    this.requests.push(request);
    if (request.frameIndex === this.failAtFrame) {
      throw new Error(
        `simulated missing asset render failure: frame ${request.frameIndex}`,
      );
    }
    return {
      ...request,
      width: 1_920,
      height: 1_080,
      pngBytes: new Uint8Array([137, 80, 78, 71, request.frameIndex]),
    };
  }
}

const probeResult: VideoProbeResult = {
  codecName: 'h264',
  pixelFormat: 'yuv420p',
  width: 1_920,
  height: 1_080,
  fps: 24,
  frameCount: 72,
  durationSeconds: 3,
  hasAudio: true,
  audioCodecName: 'aac',
  audioSampleRate: 48_000,
  audioChannels: 1,
  audioStartSeconds: 0,
  audioDurationSeconds: 3.4,
  formatDurationSeconds: 3.4,
  raw: {},
};

class MemoryMediaAdapter implements FullProbeMediaAdapter {
  encodeRequests: Array<Record<string, unknown>> = [];
  muxRequests: Array<Record<string, unknown>> = [];
  signals: AbortSignal[] = [];
  blockEncode = false;
  encodeStarted: (() => void) | null = null;
  activeProcesses = 0;

  async encodePngSequence(
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    this.encodeRequests.push(request);
    if (signal) this.signals.push(signal);
    if (!this.blockEncode) return;
    this.activeProcesses = 1;
    this.encodeStarted?.();
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          this.activeProcesses = 0;
          reject(new Error('controlled encoding cancellation'));
        },
        { once: true },
      );
    });
  }

  async muxSingleAudio(
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    this.muxRequests.push(request);
    if (signal) this.signals.push(signal);
  }

  async probeVideo(): Promise<VideoProbeResult> {
    return probeResult;
  }

  getActiveProcessCount(): number {
    return this.activeProcesses;
  }
}

describe('ExportService', () => {
  it.each([
    [3_000, 72],
    [5_000, 120],
  ])('exports %i ms with %i unique frames and bounded writes', async (durationMs, count) => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    const service = new ExportService(renderer, fileSystem);

    const result = await service.runProbe({ durationMs, fps: 24 });
    const files = await fileSystem.listFrameFiles(result.outputDirectory);

    expect(result.totalFrames).toBe(count);
    expect(result.completedFrames).toBe(count);
    expect(files).toHaveLength(count);
    expect(new Set(files).size).toBe(count);
    expect(files[0]).toBe('frame_000000.png');
    expect(files.at(-1)).toBe(`frame_${String(count - 1).padStart(6, '0')}.png`);
    expect(fileSystem.peakInFlight).toBeLessThanOrEqual(3);
    expect(result.peakPendingWrites).toBeLessThanOrEqual(3);
  });

  it('rejects a duplicate concurrent job with the active Job ID', async () => {
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const renderer = new MemoryRenderer();
    renderer.loadProbe = async (request) => {
      await loadGate;
      return { jobId: request.jobId, acknowledged: true };
    };
    const service = new ExportService(renderer, new MemoryFileSystem());
    const first = service.runProbe({ durationMs: 3_000, fps: 24 });
    const activeJobId = service.getActiveJobId();

    await expect(service.runProbe({ durationMs: 3_000, fps: 24 })).rejects.toThrow(
      activeJobId ?? 'missing active Job ID',
    );
    releaseLoad();
    await first;
  });

  it.each(['render', 'write'] as const)('cleans partial output after a %s failure', async (kind) => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    if (kind === 'render') renderer.failAtFrame = 4;
    if (kind === 'write') fileSystem.failAtFile = 'frame_000004.png';
    const service = new ExportService(renderer, fileSystem);

    let jobError: ExportJobError | null = null;
    try {
      await service.runProbe({ durationMs: 3_000, fps: 24 });
    } catch (error) {
      expect(error).toBeInstanceOf(ExportJobError);
      jobError = error as ExportJobError;
    }
    expect(jobError).not.toBeNull();
    expect(fileSystem.cleaned).toHaveLength(1);
    expect(fileSystem.directories.size).toBe(0);
    expect(service.getActiveJobId()).toBeNull();
    if (kind === 'write') {
      const job = service.getJob(jobError?.jobId ?? 'missing-job-id');
      expect(fileSystem.successfulWrites).not.toContain('frame_000004.png');
      expect(job?.completedFrames).toBe(fileSystem.successfulWrites.length);
      expect(renderer.requests.length).toBeLessThan(10);
    }
  });

  it('cancels between frames and removes partial output', async () => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    const service = new ExportService(renderer, fileSystem);
    const originalRender = renderer.renderFrame.bind(renderer);
    renderer.renderFrame = async (request) => {
      const result = await originalRender(request);
      if (request.frameIndex === 2) service.cancelActiveJob();
      return result;
    };

    await expect(service.runProbe({ durationMs: 3_000, fps: 24 })).rejects.toThrow(
      /导出已取消并完成资源清理；可以立即重新导出/,
    );
    expect(fileSystem.directories.size).toBe(0);
  });

  it('uses one Job signal through a Unicode full export and removes its frame directory', async () => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    const media = new MemoryMediaAdapter();
    const service = new ExportService(renderer, fileSystem, media);
    const projectDirectory = 'C:\\熊猫 项目\\场景 🐼';
    const audioPath = 'C:\\熊猫 项目\\音频 音轨.wav';
    const outputPath = 'C:\\熊猫 输出\\成片 🎬.mp4';

    const result = await service.runFullProbe({
      projectDirectory,
      audioPath,
      outputPath,
      durationMs: 3_000,
      fps: 24,
      audioStartMs: 400,
      overwrite: true,
    });

    expect(result.status).toBe('completed');
    expect(result.probe).toEqual(probeResult);
    expect(fileSystem.projectDirectories).toEqual([projectDirectory]);
    expect(media.muxRequests[0]).toMatchObject({ audioPath, outputPath });
    expect(media.signals).toHaveLength(2);
    expect(media.signals[0]).toBe(media.signals[1]);
    expect(fileSystem.directories.size).toBe(0);
    expect(renderer.prepared).toBe(1);
    expect(renderer.releasedJobs).toEqual([result.jobId]);
  });

  it('cancels the current encoding process idempotently and can export again immediately', async () => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    const media = new MemoryMediaAdapter();
    media.blockEncode = true;
    let signalEncodeStarted!: () => void;
    const encodeStarted = new Promise<void>((resolve) => {
      signalEncodeStarted = resolve;
    });
    media.encodeStarted = signalEncodeStarted;
    const service = new ExportService(renderer, fileSystem, media);
    const request = {
      projectDirectory: 'C:\\项目 空格',
      audioPath: 'C:\\项目 空格\\声音.wav',
      outputPath: 'C:\\输出 空格\\成片.mp4',
      durationMs: 3_000 as const,
      fps: 24 as const,
      audioStartMs: 400,
      overwrite: true,
    };
    const handle = service.startFullProbe(request);
    await encodeStarted;

    expect(service.getActiveProcessCount()).toBe(1);
    expect(service.cancelJob('00000000-0000-4000-8000-000000000000')).toBe(
      false,
    );
    expect(service.cancelJob(handle.jobId)).toBe(true);
    expect(service.cancelJob(handle.jobId)).toBe(true);
    await expect(handle.completion).rejects.toThrow(
      new RegExp(`Export Job ${handle.jobId}.*可以立即重新导出`),
    );
    expect(renderer.cancelledJobs).toEqual([handle.jobId]);
    expect(service.getActiveProcessCount()).toBe(0);
    expect(fileSystem.directories.size).toBe(0);
    expect(media.muxRequests).toHaveLength(0);

    media.blockEncode = false;
    const recovered = await service.runFullProbe({
      ...request,
      outputPath: 'C:\\输出 空格\\恢复成片.mp4',
    });
    expect(recovered.status).toBe('completed');
    expect(service.getActiveJobId()).toBeNull();
  });

  it('waits for in-flight writes before cleanup when rendering is cancelled', async () => {
    let releaseWrites!: () => void;
    const fileSystem = new MemoryFileSystem();
    fileSystem.writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    const renderer = new MemoryRenderer();
    const service = new ExportService(renderer, fileSystem);
    const running = service.runProbe({ durationMs: 3_000, fps: 24 });

    while (fileSystem.inFlight < 3) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const jobId = service.getActiveJobId();
    expect(jobId).not.toBeNull();
    expect(service.cancelActiveJob()).toBe(true);
    expect(fileSystem.cleaned).toHaveLength(0);
    releaseWrites();
    await expect(running).rejects.toThrow(/可以立即重新导出/);
    expect(fileSystem.inFlight).toBe(0);
    expect(fileSystem.directories.size).toBe(0);
    expect(renderer.requests).toHaveLength(3);
  });

  it('reports cleanup failure with the Job ID and allows idempotent retry', async () => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    fileSystem.cleanupFailure = new Error('controlled file lock');
    const service = new ExportService(renderer, fileSystem);
    renderer.renderFrame = async (request) => {
      service.cancelActiveJob();
      return {
        ...request,
        width: 1_920,
        height: 1_080,
        pngBytes: new Uint8Array([137, 80, 78, 71, 1]),
      };
    };

    let failure: ExportJobError | null = null;
    try {
      await service.runProbe({ durationMs: 3_000, fps: 24 });
    } catch (error) {
      failure = error as ExportJobError;
    }
    expect(failure).toBeInstanceOf(ExportJobError);
    expect(failure?.message).toMatch(/controlled file lock.*关闭占用目录/);
    expect(service.getJob(failure?.jobId ?? '')?.status).toBe('failed');
    expect(fileSystem.cleaned).toHaveLength(1);

    fileSystem.cleanupFailure = null;
    await service.cleanupJob(failure?.jobId ?? '');
    await service.cleanupJob(failure?.jobId ?? '');
    expect(fileSystem.directories.size).toBe(0);
  });

  it('does not start a second cleanup cycle when successful media output cleanup fails', async () => {
    const renderer = new MemoryRenderer();
    const fileSystem = new MemoryFileSystem();
    const media = new MemoryMediaAdapter();
    fileSystem.cleanupFailure = new Error('controlled final cleanup lock');
    const service = new ExportService(renderer, fileSystem, media);
    const handle = service.startFullProbe({
      projectDirectory: 'C:\\项目',
      audioPath: 'C:\\项目\\音频.wav',
      outputPath: 'C:\\输出\\成片.mp4',
      durationMs: 3_000,
      fps: 24,
      audioStartMs: 400,
      overwrite: true,
    });

    await expect(handle.completion).rejects.toThrow(
      new RegExp(`Export Job ${handle.jobId}.*controlled final cleanup lock`),
    );
    expect(fileSystem.cleaned).toHaveLength(1);
    expect(service.getJob(handle.jobId)).toMatchObject({
      status: 'failed',
      phase: 'finished',
    });
  });
});
