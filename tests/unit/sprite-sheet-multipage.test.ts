import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  SPRITE_SHEET_MAX_DIMENSION,
  SPRITE_SHEET_MAX_PIXELS,
  planSpriteSheetPages,
  type ExportFrameReady,
  type ExportLoadFormalRequest,
  type ExportLoadProbeRequest,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
} from '../../src/shared/export-types';
import {
  ExportJobError,
  ExportService,
  type FrameRenderer,
  type FullProbeMediaAdapter,
} from '../../src/main/services/ExportService';
import type { FrozenExportInput } from '../../src/main/services/ExportPreparationService';
import type { FrameFileSystem } from '../../src/main/services/FileSystemService';
import { buildProject } from './domain/testProject';

const manifestWriteFault = vi.hoisted(() => ({ failPath: null as string | null }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (manifestWriteFault.failPath !== null && args[0] === manifestWriteFault.failPath) {
        return Promise.reject(new Error('simulated multi-page manifest write failure'));
      }
      return actual.open(...args);
    },
  };
});

function makePngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.alloc(26);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6; // RGBA
  return new Uint8Array(bytes);
}

class DiskStagingFileSystem implements FrameFileSystem {
  constructor(private readonly root: string) {}
  cleanedDirectories: string[] = [];

  async createJobDirectory(jobId: string): Promise<string> {
    return mkdtemp(path.join(this.root, `staging-${jobId.slice(0, 8)}-`));
  }

  async writeFrame(directory: string, fileName: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path.join(directory, fileName), bytes);
  }

  async writeFrozenAudio(directory: string, fileName: string, bytes: Uint8Array): Promise<string> {
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, bytes);
    return filePath;
  }

  async listFrameFiles(directory: string): Promise<string[]> {
    return (await readdir(directory)).filter((name) => name.startsWith('frame_') && name.endsWith('.png')).sort();
  }

  async cleanupJobDirectory(directory: string): Promise<void> {
    await rm(directory, { recursive: true, force: true });
    this.cleanedDirectories.push(directory);
  }

  async assertReadableProjectDirectory(directory: string): Promise<string> {
    return directory;
  }

  async prepareFinalOutput(outputPath: string): Promise<string> {
    return outputPath;
  }

  async prepareFormalOutput(outputPath: string): Promise<string> {
    return outputPath;
  }

  async assertFormalOutputLocation(): Promise<void> {}

  createFinalOutputStagingPath(jobId: string, outputPath: string): string {
    return `${outputPath}.${jobId}.staging`;
  }

  async commitFinalOutput(): Promise<void> {}
  async commitFormalOutputNoReplace(): Promise<void> {}
  async cleanupFinalOutputStaging(): Promise<void> {}
}

class FakeFormalRenderer implements FrameRenderer {
  formalLoads: ExportLoadFormalRequest[] = [];
  renderedRequests: ExportRenderFrameRequest[] = [];
  cancelledJobs: string[] = [];

  async loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded> {
    return { jobId: request.jobId, acknowledged: true };
  }

  async loadFormal(request: ExportLoadFormalRequest): Promise<{ jobId: string; acknowledged: true }> {
    this.formalLoads.push(request);
    return { jobId: request.jobId, acknowledged: true };
  }

  async renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady> {
    this.renderedRequests.push(request);
    return {
      ...request,
      width: 1_920,
      height: 1_080,
      pngBytes: makePngHeader(1_920, 1_080),
    };
  }

  cancelJob(jobId: string): boolean {
    this.cancelledJobs.push(jobId);
    return true;
  }
}

describe('S03-A multi-page sprite sheet capacity planning and formal export', () => {
  it('plans 16/17/24/48 frames at 1920x1080 and derives capacity from actual cell dimensions', () => {
    const plan16 = planSpriteSheetPages(16, 1920, 1080);
    expect(plan16.maxFramesPerPage).toBe(16);
    expect(plan16.pages).toEqual([
      {
        pageIndex: 0,
        frameStart: 0,
        frameCount: 16,
        columns: 4,
        rows: 4,
        width: 7680,
        height: 4320,
        imageName: 'sprite-sheet.png',
      },
    ]);

    const plan17 = planSpriteSheetPages(17, 1920, 1080);
    expect(plan17.pages).toHaveLength(2);
    expect(plan17.pages[0]).toMatchObject({
      pageIndex: 0,
      frameStart: 0,
      frameCount: 16,
      columns: 4,
      rows: 4,
      width: 7680,
      height: 4320,
      imageName: 'sprite-sheet-000.png',
    });
    expect(plan17.pages[1]).toMatchObject({
      pageIndex: 1,
      frameStart: 16,
      frameCount: 1,
      columns: 1,
      rows: 1,
      width: 1920,
      height: 1080,
      imageName: 'sprite-sheet-001.png',
    });

    const plan24 = planSpriteSheetPages(24, 1920, 1080);
    expect(plan24.pages).toHaveLength(2);
    expect(plan24.pages[0]).toMatchObject({ frameStart: 0, frameCount: 16, width: 7680, height: 4320 });
    expect(plan24.pages[1]).toMatchObject({ frameStart: 16, frameCount: 8, columns: 2, rows: 4, width: 3840, height: 4320 });

    const plan48 = planSpriteSheetPages(48, 1920, 1080);
    expect(plan48.pages).toHaveLength(3);
    expect(plan48.pages.map((p) => [p.pageIndex, p.frameStart, p.frameCount, p.imageName])).toEqual([
      [0, 0, 16, 'sprite-sheet-000.png'],
      [1, 16, 16, 'sprite-sheet-001.png'],
      [2, 32, 16, 'sprite-sheet-002.png'],
    ]);
    for (const page of plan48.pages) {
      expect(page.width).toBeLessThanOrEqual(SPRITE_SHEET_MAX_DIMENSION);
      expect(page.height).toBeLessThanOrEqual(SPRITE_SHEET_MAX_DIMENSION);
      expect(page.width * page.height).toBeLessThanOrEqual(SPRITE_SHEET_MAX_PIXELS);
    }

    // Non-1920x1080 cells must not hardcode 16 frames per page.
    const planSquare = planSpriteSheetPages(40, 1000, 1000);
    expect(planSquare.maxFramesPerPage).toBe(32);
    expect(planSquare.pages.map((p) => p.frameCount)).toEqual([32, 8]);

    // Larger cells reduce capacity below 16 naturally (2x7 = 14 fits 4100x7700 <= 32Mi px).
    const planWide = planSpriteSheetPages(25, 2050, 1100);
    expect(planWide.maxFramesPerPage).toBe(14);
    expect(planWide.pages.map((p) => p.frameCount)).toEqual([14, 11]);

    // Oversized single frame fails cleanly.
    expect(() => planSpriteSheetPages(1, 9000, 1080)).toThrow();
  });

  it('exports 48 frames (2s @ 24fps) across 3 pages page-by-page without retaining prior page frames', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'panda-s03a-48-'));
    try {
      const fileSystem = new DiskStagingFileSystem(parent);
      const renderer = new FakeFormalRenderer();
      const encodeCalls: Array<{
        outputName: string;
        frameCount: number;
        columns: number;
        rows: number;
        diskFramesPresent: string[];
      }> = [];
      const adapter: FullProbeMediaAdapter = {
        async encodePngSequence() {},
        async probeVideo() {
          throw new Error('not used');
        },
        async encodeSpriteSheet(request) {
          const diskFramesPresent = (await readdir(request.framesDirectory))
            .filter((name) => name.startsWith('frame_') && name.endsWith('.png'))
            .sort();
          encodeCalls.push({
            outputName: path.basename(request.outputPath),
            frameCount: request.frameCount,
            columns: request.columns,
            rows: request.rows,
            diskFramesPresent,
          });
          await writeFile(request.outputPath, makePngHeader(request.columns * 1920, request.rows * 1080));
        },
      };

      const project = buildProject();
      project.shots[0]!.durationMs = 2_000;
      const service = new ExportService(renderer, fileSystem, adapter);
      const output = path.join(parent, 'sprites-48');
      const frozen = {
        candidate: {
          project,
          pngSequence: { shotId: project.shots[0]!.id, spriteSheet: true, transparent: true },
          renderSettings: { width: 1920, height: 1080, fps: 24 },
          outputIntent: { targetPath: output },
          cameraMode: 'static',
        },
        media: [],
      } as unknown as FrozenExportInput;

      const job = service.startPngSequenceExport(frozen, async () => {});
      await expect(job.completion).resolves.toEqual({ outputPath: output });

      expect(renderer.formalLoads).toHaveLength(1);
      expect(renderer.formalLoads[0]?.solidClear).toBeUndefined();
      expect(renderer.renderedRequests).toHaveLength(48);

      expect(encodeCalls).toHaveLength(3);
      expect(encodeCalls.map((call) => [call.outputName, call.frameCount, call.columns, call.rows])).toEqual([
        ['sprite-sheet-000.png', 16, 4, 4],
        ['sprite-sheet-001.png', 16, 4, 4],
        ['sprite-sheet-002.png', 16, 4, 4],
      ]);
      for (const call of encodeCalls) {
        expect(call.diskFramesPresent).toHaveLength(16);
        expect(call.diskFramesPresent[0]).toBe('frame_000000.png');
        expect(call.diskFramesPresent[15]).toBe('frame_000015.png');
      }

      expect((await readdir(output)).sort()).toEqual([
        'sprite-sheet-000.png',
        'sprite-sheet-001.png',
        'sprite-sheet-002.png',
        'sprite-sheet.json',
      ]);

      const manifest = JSON.parse(await readFile(path.join(output, 'sprite-sheet.json'), 'utf8'));
      expect(manifest.meta).toEqual({
        image: 'sprite-sheet-000.png',
        images: ['sprite-sheet-000.png', 'sprite-sheet-001.png', 'sprite-sheet-002.png'],
        pageCount: 3,
        fps: 24,
        size: { w: 7680, h: 4320 },
        origin: 'top-left',
        units: 'px',
      });
      expect(manifest.pages).toEqual([
        { index: 0, image: 'sprite-sheet-000.png', size: { w: 7680, h: 4320 }, columns: 4, rows: 4, frameStart: 0, frameCount: 16 },
        { index: 1, image: 'sprite-sheet-001.png', size: { w: 7680, h: 4320 }, columns: 4, rows: 4, frameStart: 16, frameCount: 16 },
        { index: 2, image: 'sprite-sheet-002.png', size: { w: 7680, h: 4320 }, columns: 4, rows: 4, frameStart: 32, frameCount: 16 },
      ]);
      expect(manifest.frames).toHaveLength(48);
      expect(manifest.frames.map((f: { index: number }) => f.index)).toEqual(Array.from({ length: 48 }, (_, i) => i));
      expect(manifest.frames[0]).toMatchObject({
        index: 0,
        name: 'frame_000000',
        timeMs: 0,
        page: 0,
        frame: { x: 0, y: 0, w: 1920, h: 1080 },
      });
      expect(manifest.frames[16]).toMatchObject({
        index: 16,
        name: 'frame_000016',
        page: 1,
        frame: { x: 0, y: 0, w: 1920, h: 1080 },
      });
      expect(manifest.frames[47]).toMatchObject({
        index: 47,
        name: 'frame_000047',
        page: 2,
        frame: { x: 5760, y: 3240, w: 1920, h: 1080 },
      });
      const totalDurationMs = manifest.frames.reduce((sum: number, f: { durationMs: number }) => sum + f.durationMs, 0);
      expect(totalDurationMs).toBe(2000);
      expect(fileSystem.cleanedDirectories).toHaveLength(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('cleans temp artifacts and leaves no half-pack on cancel, failure, or existing target', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'panda-s03a-safety-'));
    try {
      const fileSystem = new DiskStagingFileSystem(parent);
      const renderer = new FakeFormalRenderer();
      const adapter: FullProbeMediaAdapter = {
        async encodePngSequence() {},
        async probeVideo() {
          throw new Error('not used');
        },
        async encodeSpriteSheet(request) {
          await writeFile(request.outputPath, makePngHeader(request.columns * 1920, request.rows * 1080));
        },
      };

      const project = buildProject();
      project.shots[0]!.durationMs = 1_000; // 24 frames -> 2 pages (16 + 8)
      const service = new ExportService(renderer, fileSystem, adapter);
      const makeFrozen = (targetPath: string) =>
        ({
          candidate: {
            project,
            pngSequence: { shotId: project.shots[0]!.id, spriteSheet: true, transparent: true },
            renderSettings: { width: 1920, height: 1080, fps: 24 },
            outputIntent: { targetPath },
            cameraMode: 'static',
          },
          media: [],
        }) as unknown as FrozenExportInput;

      // 1. Cancel during page 2 (after 18 frames)
      const cancelledOutput = path.join(parent, 'cancelled-24');
      const unsub = service.subscribe((update) => {
        if (update.completedFrames === 18 && update.status === 'running') {
          service.cancelJob(update.jobId);
        }
      });
      const cancelJob = service.startPngSequenceExport(makeFrozen(cancelledOutput), async () => {});
      await expect(cancelJob.completion).rejects.toBeInstanceOf(ExportJobError);
      unsub();
      expect(service.getJob(cancelJob.jobId)?.status).toBe('cancelled');
      expect(await readdir(parent)).toEqual([]);

      // 2. Roll back all pages when manifest write fails during commit
      const rollbackOutput = path.join(parent, 'rollback-24');
      manifestWriteFault.failPath = path.join(rollbackOutput, 'sprite-sheet.json');
      const failedJob = service.startPngSequenceExport(makeFrozen(rollbackOutput), async () => {});
      await expect(failedJob.completion).rejects.toThrow('simulated multi-page manifest write failure');
      manifestWriteFault.failPath = null;
      expect(service.getJob(failedJob.jobId)?.status).toBe('failed');
      expect(await readdir(parent)).toEqual([]);

      // 3. Do not corrupt an existing target directory
      const existingOutput = path.join(parent, 'existing-target');
      await mkdir(existingOutput);
      await writeFile(path.join(existingOutput, 'keep.txt'), 'precious');
      const collisionJob = service.startPngSequenceExport(makeFrozen(existingOutput), async () => {});
      await expect(collisionJob.completion).rejects.toBeInstanceOf(ExportJobError);
      expect(await readFile(path.join(existingOutput, 'keep.txt'), 'utf8')).toBe('precious');
      expect(await readdir(existingOutput)).toEqual(['keep.txt']);
    } finally {
      manifestWriteFault.failPath = null;
      await rm(parent, { recursive: true, force: true });
    }
  });
});
