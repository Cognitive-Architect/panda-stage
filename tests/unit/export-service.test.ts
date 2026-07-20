import { describe, expect, it } from 'vitest';
import type { FrameFileSystem } from '../../src/main/services/FileSystemService';
import {
  ExportJobError,
  ExportService,
  type FrameRenderer,
} from '../../src/main/services/ExportService';
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

  async createJobDirectory(jobId: string): Promise<string> {
    const directory = `/jobs/${jobId}`;
    this.directories.set(directory, new Map());
    return directory;
  }

  async writeFrame(directory: string, fileName: string, bytes: Uint8Array) {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
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
    this.directories.delete(directory);
  }
}

class MemoryRenderer implements FrameRenderer {
  requests: ExportRenderFrameRequest[] = [];
  failAtFrame: number | null = null;

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
      /cancelled and cleaned up/,
    );
    expect(fileSystem.directories.size).toBe(0);
  });
});
