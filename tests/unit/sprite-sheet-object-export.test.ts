import path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { evaluateExportPreparationSupport } from '../../src/domain/export-preparation';
import {
  computeLayerExportAnchor,
  planPngSequenceFrames,
  scopeShotForLayerExport,
  type ExportFrameReady,
  type ExportLoadFormalRequest,
  type ExportLoadProbeRequest,
  type ExportProbeLoaded,
  type ExportRenderFrameRequest,
} from '../../src/shared/export-types';
import {
  encodeRgbaPng,
  type PixiSpritesheetData,
  type RgbaImage,
} from '../../src/main/services/sprite-sheet-atlas';
import {
  ExportService,
  type FrameRenderer,
  type FullProbeMediaAdapter,
} from '../../src/main/services/ExportService';
import type { FrozenExportInput } from '../../src/main/services/ExportPreparationService';
import type { FrameFileSystem } from '../../src/main/services/FileSystemService';
import { buildProject } from './domain/testProject';

function createRectPng(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number; rgba: [number, number, number, number] },
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const idx = (y * width + x) * 4;
      data[idx] = rect.rgba[0];
      data[idx + 1] = rect.rgba[1];
      data[idx + 2] = rect.rgba[2];
      data[idx + 3] = rect.rgba[3];
    }
  }
  const image: RgbaImage = { width, height, data };
  return encodeRgbaPng(image);
}

class DiskStagingFileSystem implements FrameFileSystem {
  constructor(private readonly root: string) {}
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

describe('S03-C selected Graphic / action object sprite sheet export', () => {
  it('isolates the selected visible layer, excludes background & unrelated layers, and passes imagesOnly preparation check', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const bgLayer = shot.layers[0]!;
    const heroLayer = {
      ...bgLayer,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'HeroWalk',
      visible: true,
      opacity: 0.85,
      x: 480,
      y: 540,
      scaleX: 1.2,
      scaleY: 1.2,
      rotationDeg: 5,
    };
    const hiddenLayer = {
      ...bgLayer,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'HiddenProp',
      visible: false,
    };
    shot.layers.push(heroLayer, hiddenLayer);

    const { shot: isolatedShot, layer } = scopeShotForLayerExport(shot, heroLayer.id);
    expect(layer.id).toBe(heroLayer.id);
    expect(isolatedShot.backgroundLayerId).toBeNull();
    expect(isolatedShot.layers).toHaveLength(1);
    expect(isolatedShot.layers[0]!.id).toBe(heroLayer.id);
    expect(isolatedShot.layers[0]!.opacity).toBe(0.85);
    expect(isolatedShot.layers[0]!.x).toBe(480);
    expect(isolatedShot.layers[0]!.y).toBe(540);
    expect(isolatedShot.layers[0]!.rotationDeg).toBe(5);
    expect(isolatedShot.dialogues).toEqual([]);
    expect(isolatedShot.audioClips).toEqual([]);

    // Formal preparation support check allows null background in imagesOnly mode.
    const scopedProject = { ...project, shots: [isolatedShot] };
    expect(evaluateExportPreparationSupport(scopedProject, 'static', { imagesOnly: true })).toEqual([]);

    // Anchor derives stably from stage-space transform.
    expect(computeLayerExportAnchor(heroLayer, 1_920, 1_080)).toEqual({ x: 0.25, y: 0.5 });

    // Missing or hidden layers fail closed.
    expect(() => scopeShotForLayerExport(shot, '33333333-3333-4333-8333-333333333333')).toThrow();
    expect(() => scopeShotForLayerExport(shot, hiddenLayer.id)).toThrow();

    // Shot export without layerId remains intact.
    const fullShotSchedule = planPngSequenceFrames(project, {
      shotId: shot.id,
      transparent: true,
      spriteSheet: true,
    });
    expect(fullShotSchedule.selectedLayer).toBeUndefined();
    expect(fullShotSchedule.shot.layers).toHaveLength(shot.layers.length);
  });

  it('exports a 48-frame selected object over a chosen range through the formal S03-A/B multi-page PixiJS pipeline', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'panda-s03c-object-'));
    try {
      const project = buildProject();
      const shot = project.shots[0]!;
      shot.durationMs = 3_000;
      const bgLayer = shot.layers[0]!;
      const actionLayer = {
        ...bgLayer,
        id: '44444444-4444-4444-8444-444444444444',
        name: 'PandaJump',
        visible: true,
        opacity: 0.9,
        x: 960,
        y: 810,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
      };
      const unrelatedLayer = {
        ...bgLayer,
        id: '55555555-5555-4555-8555-555555555555',
        name: 'UnrelatedTree',
        visible: true,
      };
      shot.layers.push(actionLayer, unrelatedLayer);

      const framePayload = createRectPng(1_920, 1_080, {
        x: 300,
        y: 100,
        w: 1_400,
        h: 900,
        rgba: [240, 120, 40, 220],
      });

      const formalLoads: ExportLoadFormalRequest[] = [];
      const renderer: FrameRenderer = {
        async loadProbe(request: ExportLoadProbeRequest): Promise<ExportProbeLoaded> {
          return { jobId: request.jobId, acknowledged: true };
        },
        async loadFormal(request: ExportLoadFormalRequest) {
          formalLoads.push(request);
          return { jobId: request.jobId, acknowledged: true };
        },
        async renderFrame(request: ExportRenderFrameRequest): Promise<ExportFrameReady> {
          return {
            ...request,
            width: 1_920,
            height: 1_080,
            pngBytes: new Uint8Array(framePayload),
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

      const fileSystem = new DiskStagingFileSystem(parent);
      const service = new ExportService(renderer, fileSystem, adapter);
      const output = path.join(parent, 'object-atlas');

      // Export 2s (500ms..2500ms = 48 frames) of ONLY actionLayer, even when cameraMode was speaker-focus.
      const frozen = {
        candidate: {
          project,
          pngSequence: {
            shotId: shot.id,
            layerId: actionLayer.id,
            transparent: true,
            spriteSheet: true,
            range: { startMs: 500, endMs: 2_500 },
            spriteSheetOptions: {
              trim: true,
              scale: 1,
              padding: 2,
              extrusion: 1,
              format: 'pixi',
            },
          },
          renderSettings: { width: 1_920, height: 1_080, fps: 24 },
          outputIntent: { targetPath: output },
          cameraMode: 'speaker-focus',
        },
        media: [],
      } as unknown as FrozenExportInput;

      const job = service.startPngSequenceExport(frozen, async () => {});
      await expect(job.completion).resolves.toEqual({ outputPath: output });

      // Formal renderer received ONLY the isolated actionLayer with static camera & transparent background.
      expect(formalLoads).toHaveLength(1);
      expect(formalLoads[0]!.cameraMode).toBe('static');
      expect(formalLoads[0]!.solidClear).toBeUndefined();
      const loadedShot = formalLoads[0]!.project.shots[0]!;
      expect(loadedShot.backgroundLayerId).toBeNull();
      expect(loadedShot.layers.map((l) => l.id)).toEqual([actionLayer.id]);

      const master = JSON.parse(await readFile(path.join(output, 'sprite-sheet.json'), 'utf8'));
      expect(master.format).toBe('panda-sprite-sheet-master');
      expect(master.target).toEqual({
        kind: 'layer',
        layerId: actionLayer.id,
        layerName: 'PandaJump',
        sourceKind: actionLayer.source.kind,
        isolated: true,
      });
      expect(master.frames).toHaveLength(48);
      expect(master.meta.pageCount).toBeGreaterThan(1);
      expect(master.meta.anchor).toEqual({ x: 0.5, y: 0.75 });

      const rootPixi = JSON.parse(
        await readFile(path.join(output, 'sprite-sheet-000.json'), 'utf8'),
      ) as PixiSpritesheetData;
      expect(rootPixi.animations?.PandaJump).toHaveLength(48);
      expect(rootPixi.frames.frame_000000?.anchor).toEqual({ x: 0.5, y: 0.75 });
      expect(rootPixi.meta.related_multi_packs?.length).toBe(master.meta.pageCount - 1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 20_000);
});
