import path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  StreamingSpriteSheetPacker,
  buildPixiPageManifest,
  decodeRgbaPng,
  encodeRgbaPng,
  scaleRgbaImage,
  trimRgbaImage,
  type PixiSpritesheetData,
  type RgbaImage,
} from '../../src/main/services/sprite-sheet-atlas';
import {
  TESTED_PIXI_JS_VERSION,
  assemblePixiMultiPackTextures,
  resolvePixiMultiPackAnimation,
  type PixiLikeSpritesheet,
} from '../../src/shared/pixi-spritesheet-consumer';
import {
  ExportJobError,
  ExportService,
  type FrameRenderer,
  type FullProbeMediaAdapter,
} from '../../src/main/services/ExportService';
import type { FrozenExportInput } from '../../src/main/services/ExportPreparationService';
import type { FrameFileSystem } from '../../src/main/services/FileSystemService';
import type {
  ExportFrameReady,
  ExportLoadFormalRequest,
  ExportLoadProbeRequest,
  ExportProbeLoaded,
  ExportRenderFrameRequest,
} from '../../src/shared/export-types';
import { buildProject } from './domain/testProject';

const jsonFault = vi.hoisted(() => ({ failPath: null as string | null }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (jsonFault.failPath !== null && args[0] === jsonFault.failPath) {
        return Promise.reject(new Error('simulated pixi json write failure'));
      }
      return actual.open(...args);
    },
  };
});

function createSolidRectImage(
  width: number,
  height: number,
  rect?: { x: number; y: number; w: number; h: number; rgba: [number, number, number, number] },
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const idx = (y * width + x) * 4;
        data[idx] = rect.rgba[0];
        data[idx + 1] = rect.rgba[1];
        data[idx + 2] = rect.rgba[2];
        data[idx + 3] = rect.rgba[3];
      }
    }
  }
  return { width, height, data };
}

function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const idx = (y * image.width + x) * 4;
  return [image.data[idx]!, image.data[idx + 1]!, image.data[idx + 2]!, image.data[idx + 3]!];
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
    return (await readdir(directory)).filter((name) => name.endsWith('.png')).sort();
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

describe('S03-B transparent trim, output scale, padding/extrusion, and PixiJS multi-pack', () => {
  it('scales first in premultiplied alpha space, trims non-zero alpha preserving semi-transparent edges, and extrudes without bleed', () => {
    // 40x20 image with opaque core at (10..19, 4..13) and semi-transparent halo at x=8..9
    const src = createSolidRectImage(40, 20, { x: 10, y: 4, w: 10, h: 10, rgba: [255, 60, 40, 255] });
    for (let y = 4; y < 14; y += 1) {
      for (let x = 8; x < 10; x += 1) {
        const idx = (y * 40 + x) * 4;
        src.data[idx] = 255;
        src.data[idx + 1] = 60;
        src.data[idx + 2] = 40;
        src.data[idx + 3] = 24; // semi-transparent edge must be preserved!
      }
    }

    const roundTrip = decodeRgbaPng(encodeRgbaPng(src));
    expect(roundTrip.width).toBe(40);
    expect(roundTrip.height).toBe(20);
    expect(pixelAt(roundTrip, 8, 5)).toEqual([255, 60, 40, 24]);

    // Scale to 0.5 first -> 20x10, then trim -> x: 4..9 (w=6), y: 2..6 (h=5)
    const scaled = scaleRgbaImage(roundTrip, 0.5);
    expect(scaled.width).toBe(20);
    expect(scaled.height).toBe(10);
    expect(pixelAt(scaled, 4, 2)).toEqual([255, 60, 40, 24]);

    const trimmed = trimRgbaImage(scaled, true);
    expect(trimmed.empty).toBe(false);
    expect(trimmed.trimmed).toBe(true);
    expect(trimmed.sourceWidth).toBe(20);
    expect(trimmed.sourceHeight).toBe(10);
    expect(trimmed.trimX).toBe(4);
    expect(trimmed.trimY).toBe(2);
    expect(trimmed.width).toBe(6);
    expect(trimmed.height).toBe(5);

    // Pack two sprites with padding=2, extrusion=1 and verify extrusion ring & transparent gap.
    const blue = trimRgbaImage(
      createSolidRectImage(20, 10, { x: 2, y: 1, w: 4, h: 4, rgba: [20, 100, 255, 255] }),
      true,
    );
    const empty1 = trimRgbaImage(createSolidRectImage(20, 10), true);
    const empty2 = trimRgbaImage(createSolidRectImage(20, 10), true);

    const packer = new StreamingSpriteSheetPacker({
      trim: true,
      scale: 0.5,
      padding: 2,
      extrusion: 1,
      anchor: { x: 0.5, y: 0.5 },
    });
    expect(packer.addFrame({ index: 0, name: 'frame_000000', timeMs: 0, durationMs: 41 }, trimmed)).toBeNull();
    expect(packer.addFrame({ index: 1, name: 'frame_000001', timeMs: 41, durationMs: 42 }, blue)).toBeNull();
    expect(packer.addFrame({ index: 2, name: 'frame_000002', timeMs: 83, durationMs: 42 }, empty1)).toBeNull();
    expect(packer.addFrame({ index: 3, name: 'frame_000003', timeMs: 125, durationMs: 41 }, empty2)).toBeNull();

    const page = packer.flushCurrentPage();
    expect(page).not.toBeNull();
    const decodedPage = decodeRgbaPng(page!.pngBytes);

    // Frame 0 sits at x=padding+extrusion=3, y=3, w=6, h=5.
    const f0 = page!.frames[0]!;
    expect(f0.frame).toEqual({ x: 3, y: 3, w: 6, h: 5 });
    // Extruded top-left corner at (2, 2) must equal sprite top-left (3, 3) = [255, 60, 40, 24]
    expect(pixelAt(decodedPage, 2, 2)).toEqual([255, 60, 40, 24]);
    // Extruded right edge at (9, 3) must equal sprite right edge (8, 3) = [255, 60, 40, 255]
    expect(pixelAt(decodedPage, 9, 3)).toEqual([255, 60, 40, 255]);

    // Frame 1 (blue) starts at x = 2 + (6+2) + 2 + 1 = 13, y = 3, w = 4, h = 4.
    const f1 = page!.frames[1]!;
    expect(f1.frame).toEqual({ x: 13, y: 3, w: 4, h: 4 });
    // 2px padding gap at x=10 and x=11 must be fully transparent (no bleed between sprites!)
    expect(pixelAt(decodedPage, 10, 3)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(decodedPage, 11, 3)).toEqual([0, 0, 0, 0]);
    // Blue extrusion at x=12 must be blue
    expect(pixelAt(decodedPage, 12, 3)).toEqual([20, 100, 255, 255]);

    // Empty frames 2 & 3 share the exact same 1x1 transparent tile while preserving timeMs & durationMs.
    const f2 = page!.frames[2]!;
    const f3 = page!.frames[3]!;
    expect(f2.empty).toBe(true);
    expect(f3.empty).toBe(true);
    expect(f2.frame).toEqual(f3.frame);
    expect(f2.frame.w).toBe(1);
    expect(f2.frame.h).toBe(1);
    expect(pixelAt(decodedPage, f2.frame.x, f2.frame.y)).toEqual([0, 0, 0, 0]);
    expect(f2.timeMs).toBe(83);
    expect(f2.durationMs).toBe(42);
    expect(f3.timeMs).toBe(125);
    expect(f3.durationMs).toBe(41);
  });

  it('exports 48 frames (2s @ 24fps) as multi-page PixiJS SpritesheetData + Panda master manifest and rolls back on failure', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'panda-s03b-pixi-48-'));
    try {
      const fileSystem = new DiskStagingFileSystem(parent);
      // Pre-build 48 frames of 1920x1080 with large opaque regions (1200x700) so at scale=0.5 (600x350)
      // or scale=1 (1200x700) they span multiple pages cleanly, plus 2 empty frames (index 10 and 35).
      // To keep test execution fast while exercising real 1920x1080 PNG decoding & multi-page packing,
      // we generate 3 reusable PNG payloads (frameA, frameB, emptyFrame) and vary by frameIndex.
      const frameA = encodeRgbaPng(
        createSolidRectImage(1_920, 1_080, { x: 100, y: 100, w: 1_500, h: 900, rgba: [220, 80, 50, 255] }),
      );
      const frameB = encodeRgbaPng(
        createSolidRectImage(1_920, 1_080, { x: 200, y: 120, w: 1_500, h: 900, rgba: [50, 140, 230, 200] }),
      );
      const emptyFrame = encodeRgbaPng(createSolidRectImage(1_920, 1_080));

      const renderer: FrameRenderer = {
        async loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded> {
          return { jobId: request.jobId, acknowledged: true };
        },
        async loadFormal(request: ExportLoadFormalRequest) {
          return { jobId: request.jobId, acknowledged: true };
        },
        async renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady> {
          const payload =
            request.frameIndex === 10 || request.frameIndex === 35
              ? emptyFrame
              : request.frameIndex % 2 === 0
                ? frameA
                : frameB;
          return {
            ...request,
            width: 1_920,
            height: 1_080,
            pngBytes: new Uint8Array(payload),
          };
        },
        cancelJob: () => true,
      };

      const adapter: FullProbeMediaAdapter = {
        async encodePngSequence() {},
        async probeVideo() {
          throw new Error('not used');
        },
      };

      const project = buildProject();
      project.shots[0]!.durationMs = 2_000; // 48 frames @ 24fps
      const service = new ExportService(renderer, fileSystem, adapter);
      const output = path.join(parent, 'pixi-48');

      const makeFrozen = (targetPath: string) =>
        ({
          candidate: {
            project,
            pngSequence: {
              shotId: project.shots[0]!.id,
              spriteSheet: true,
              transparent: true,
              spriteSheetOptions: {
                trim: true,
                scale: 1,
                padding: 2,
                extrusion: 1,
                format: 'pixi',
                anchor: { x: 0.5, y: 0.5 },
                animationName: 'walk',
              },
            },
            renderSettings: { width: 1_920, height: 1_080, fps: 24 },
            outputIntent: { targetPath },
            cameraMode: 'static',
          },
          media: [],
        }) as unknown as FrozenExportInput;

      const job = service.startPngSequenceExport(makeFrozen(output), async () => {});
      await expect(job.completion).resolves.toEqual({ outputPath: output });

      const files = (await readdir(output)).sort();
      const master = JSON.parse(await readFile(path.join(output, 'sprite-sheet.json'), 'utf8'));
      expect(master.format).toBe('panda-sprite-sheet-master');
      expect(master.meta.pageCount).toBeGreaterThan(1);
      expect(master.frames).toHaveLength(48);

      const pageCount: number = master.meta.pageCount;
      expect(master.pixiEntry).toBe('sprite-sheet-000.json');
      expect(master.pixiSheets).toHaveLength(pageCount);

      // Verify PixiJS v8 multi-pack chain: root sheet links related_multi_packs, omits cross-page
      // `animations` so PixiJS v8 `Spritesheet._processAnimations` never produces undefined textures,
      // and Panda master manifest carries the ordered cross-page animation sequence.
      const expectedAllFrameNames = Array.from(
        { length: 48 },
        (_, i) => `frame_${String(i).padStart(6, '0')}`,
      );
      expect(master.pixiTargetVersion).toBe(TESTED_PIXI_JS_VERSION);
      expect(master.animationName).toBe('walk');
      expect(master.animations?.walk).toEqual(expectedAllFrameNames);

      const rootPixi = JSON.parse(
        await readFile(path.join(output, 'sprite-sheet-000.json'), 'utf8'),
      ) as PixiSpritesheetData;
      expect(rootPixi.meta.image).toBe('sprite-sheet-000.png');
      expect(rootPixi.meta.related_multi_packs).toEqual(
        Array.from({ length: pageCount - 1 }, (_, i) => `sprite-sheet-${String(i + 1).padStart(3, '0')}.json`),
      );
      expect(rootPixi.animations).toBeUndefined();

      const seenFrames = new Set<string>();
      const parsedSheets: PixiLikeSpritesheet<{ name: string; page: number; data: PixiSpritesheetData['frames'][string] }>[] = [];
      for (let p = 0; p < pageCount; p += 1) {
        const jsonName = `sprite-sheet-${String(p).padStart(3, '0')}.json`;
        const pngName = `sprite-sheet-${String(p).padStart(3, '0')}.png`;
        expect(files).toContain(jsonName);
        expect(files).toContain(pngName);

        const sheet = JSON.parse(await readFile(path.join(output, jsonName), 'utf8')) as PixiSpritesheetData;
        expect(sheet.animations).toBeUndefined();
        expect(sheet.meta.image).toBe(pngName);
        expect(sheet.meta.size.w).toBeLessThanOrEqual(8192);
        expect(sheet.meta.size.h).toBeLessThanOrEqual(8192);
        expect(sheet.meta.size.w * sheet.meta.size.h).toBeLessThanOrEqual(32 * 1024 * 1024);

        const pagePng = decodeRgbaPng(await readFile(path.join(output, pngName)));
        expect(pagePng.width).toBe(sheet.meta.size.w);
        expect(pagePng.height).toBe(sheet.meta.size.h);

        const textures: Record<string, { name: string; page: number; data: PixiSpritesheetData['frames'][string] }> = {};
        for (const [name, entry] of Object.entries(sheet.frames)) {
          expect(seenFrames.has(name)).toBe(false);
          seenFrames.add(name);
          expect(entry.rotated).toBe(false);
          expect(entry.sourceSize).toEqual({ w: 1_920, h: 1_080 });
          expect(entry.anchor).toEqual({ x: 0.5, y: 0.5 });
          expect(entry.frame.x + entry.frame.w).toBeLessThanOrEqual(pagePng.width);
          expect(entry.frame.y + entry.frame.h).toBeLessThanOrEqual(pagePng.height);
          textures[name] = { name, page: p, data: entry };
        }
        parsedSheets.push({ textures });
      }
      expect(seenFrames.size).toBe(48);

      // Simulate PixiJS v8 linkedSheets attachment and verify consumer helper assembles all 48 frames in order.
      const linkedRoot: PixiLikeSpritesheet<{ name: string; page: number; data: PixiSpritesheetData['frames'][string] }> = {
        textures: parsedSheets[0]!.textures,
        linkedSheets: parsedSheets.slice(1),
      };
      const resolved = resolvePixiMultiPackAnimation(linkedRoot, master);
      expect(resolved.animationName).toBe('walk');
      expect(resolved.textures).toHaveLength(48);
      expect(resolved.textures.every((t) => t !== undefined)).toBe(true);
      expect(resolved.textures.map((t) => t.name)).toEqual(expectedAllFrameNames);
      expect(new Set(resolved.textures.map((t) => t.page)).size).toBe(pageCount);
      expect(() => assemblePixiMultiPackTextures(linkedRoot, ['frame_999999'])).toThrow(/missing 1 frame/i);

      // Verify single-page PixiJS manifest keeps native `animations` referencing only local textures.
      const singlePageManifest = buildPixiPageManifest({
        pageIndex: 0,
        pageCount: 1,
        imageName: 'sprite-sheet.png',
        width: 100,
        height: 100,
        pageFrames: [master.frames[0]],
        allFrameNames: [master.frames[0].name],
        animationName: 'idle',
      });
      expect(singlePageManifest.animations).toEqual({ idle: ['frame_000000'] });
      expect(singlePageManifest.meta.related_multi_packs).toBeUndefined();

      // Verify empty frames (10 and 35) preserved duration & trimmed to 1x1 transparent tile.
      const frame10 = master.frames[10];
      const frame35 = master.frames[35];
      expect(frame10.empty).toBe(true);
      expect(frame10.frame.w).toBe(1);
      expect(frame10.durationMs).toBeGreaterThan(0);
      expect(frame35.empty).toBe(true);
      expect(frame35.frame.w).toBe(1);
      expect(master.frames.reduce((sum: number, f: { durationMs: number }) => sum + f.durationMs, 0)).toBe(2000);

      // Verify rollback on JSON write failure leaves zero half-pack!
      const failedOutput = path.join(parent, 'pixi-rollback');
      jsonFault.failPath = path.join(failedOutput, 'sprite-sheet-001.json');
      const failedJob = service.startPngSequenceExport(makeFrozen(failedOutput), async () => {});
      await expect(failedJob.completion).rejects.toThrow('simulated pixi json write failure');
      jsonFault.failPath = null;
      expect(await readdir(parent)).toEqual(['pixi-48']);

      // Verify cancel leaves zero half-pack!
      const cancelledOutput = path.join(parent, 'pixi-cancel');
      const unsub = service.subscribe((update) => {
        if (update.completedFrames === 5 && update.status === 'running') {
          service.cancelJob(update.jobId);
        }
      });
      const cancelJob = service.startPngSequenceExport(makeFrozen(cancelledOutput), async () => {});
      await expect(cancelJob.completion).rejects.toBeInstanceOf(ExportJobError);
      unsub();
      expect(await readdir(parent)).toEqual(['pixi-48']);
    } finally {
      jsonFault.failPath = null;
      await rm(parent, { recursive: true, force: true });
    }
  }, 20_000);
});
