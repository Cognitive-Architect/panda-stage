/**
 * Renderer/composite coverage for author-level coverage masks (#1454).
 *
 * 1. Canvas-level contract: the existing FLA internal `clipPaths` mask keeps its
 *    `destination-in` composite behaviour (no regression), and the new
 *    author-level coverage geometry compiles into the same Path2D clip Konva
 *    applies to every target Layer.
 * 2. Source-level contract locks: Stage/Preview/Export share the formal
 *    `StageRenderer` clip path and the Inspector exposes the Chinese controls.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FlaGraphicDefinitionSchema,
  buildCoverageMaskClips,
  evaluateFlaGraphicVisual,
  resolveCoverageMaskClipPaths,
  type LayerVisualParts,
} from '../../src/domain';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { createCoverageMaskClipFunc } from '../../src/renderer/stage/coverageMaskClip';

type DrawRecord = {
  image: unknown;
  alpha: number;
  compositeOperation: string;
  args: number[];
};

class FakeCanvasContext {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  draws: DrawRecord[] = [];
  setTransforms: number[][] = [];
  fills: string[] = [];
  readCount = 0;
  writtenPixels: number[] = [];
  private readonly stack: Array<{ alpha: number; operation: string }> = [];

  save(): void {
    this.stack.push({ alpha: this.globalAlpha, operation: this.globalCompositeOperation });
  }

  restore(): void {
    const saved = this.stack.pop();
    this.globalAlpha = saved?.alpha ?? 1;
    this.globalCompositeOperation = saved?.operation ?? 'source-over';
  }

  setTransform(...values: number[]): void {
    this.setTransforms.push(values);
  }

  translate(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  closePath(): void {}

  clearRect(): void {}

  drawImage(image: unknown, ...args: number[]): void {
    this.draws.push({
      image,
      alpha: this.globalAlpha,
      compositeOperation: this.globalCompositeOperation,
      args,
    });
  }

  fill(path: Path2D): void {
    this.fills.push((path as unknown as { pathData: string }).pathData);
  }

  getImageData(): ImageData {
    this.readCount += 1;
    return { data: new Uint8ClampedArray([100, 80, 60, 255]) } as ImageData;
  }

  putImageData(imageData: ImageData): void {
    this.writtenPixels = [...imageData.data];
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeCanvasContext();

  getContext(): CanvasRenderingContext2D {
    return this.context as unknown as CanvasRenderingContext2D;
  }
}

class FakeImage {
  width = 8;
  height = 8;
}

class FakePath2D {
  constructor(readonly pathData: string) {}
}

function matrix(tx = 0, ty = 0) {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('existing FLA internal clipPaths stay unchanged (#1454 regression)', () => {
  it('composites a nested FLA mask with destination-in exactly as before', () => {
    const frameAssetId = 'a1000000-0000-4000-8000-000000000001';
    const bitmapAssetId = '10000000-0000-4000-8000-000000000001';
    const definition = FlaGraphicDefinitionSchema.parse({
      id: 'a0000000-0000-4000-8000-000000000001',
      kind: 'fla-graphic',
      name: 'Nested mask fixture',
      source: {
        basename: 'nested-mask.fla',
        sha256: 'a'.repeat(64),
        renderTargetId: 'nested-mask-target',
        targetKind: 'graphic-symbol',
        targetName: 'NestedMask',
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 20, height: 20 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 20, height: 20 },
      },
      durationMs: 1_000 / 24,
      frames: [{
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: frameAssetId,
        sha256: 'b'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 20, height: 20 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 1_000 / 24,
        createdBySequenceImport: false,
      }],
      structure: {
        version: 1,
        frames: [{
          ordinal: 0,
          layers: [{
            name: 'artwork',
            nodes: [{
              type: 'group',
              id: 'group',
              drawOrder: 0,
              localTransform: matrix(3),
              groupId: 'group-ref',
              children: [{
                type: 'symbol',
                id: 'symbol',
                drawOrder: 0,
                localTransform: matrix(5),
                symbolRef: 'Symbol',
                clipPaths: [{
                  shapes: [{
                    shapeId: 'mask-shape',
                    worldTransform: matrix(7),
                    parentLocalTransform: matrix(4),
                    pathData: ['M0 0L8 0L8 8Z'],
                  }],
                }],
                children: [{
                  type: 'bitmap',
                  id: 'masked-bitmap',
                  drawOrder: 0,
                  localTransform: matrix(2),
                  bitmapRef: 'Library/masked.png',
                  assetId: bitmapAssetId,
                }],
              }],
            }],
          }],
        }],
      },
    });
    const visual = evaluateFlaGraphicVisual({ definition, frameOrdinal: 0, mode: 'instance' });
    if (!visual) throw new Error('Expected evaluated FLA Graphic visual.');

    const canvases: FakeCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = new FakeCanvas();
        canvases.push(canvas);
        return canvas;
      },
    });
    vi.stubGlobal('Path2D', FakePath2D);
    const rendered = renderFlaGraphicCanvas(
      visual,
      new Map([[bitmapAssetId, new FakeImage() as unknown as CanvasImageSource]]),
    );

    const output = rendered!.canvas as unknown as FakeCanvas;
    const symbolCanvas = canvases[1]!;
    const maskCanvas = canvases[2]!;
    expect(output.context.draws).toHaveLength(1);
    expect(symbolCanvas.context.draws[0]?.image).toBeInstanceOf(FakeImage);
    expect(symbolCanvas.context.draws.some((draw) =>
      draw.image === maskCanvas && draw.compositeOperation === 'destination-in',
    )).toBe(true);
    expect(maskCanvas.context.fills).toEqual(['M0 0L8 0L8 8Z']);
    expect(maskCanvas.context.setTransforms).toContainEqual([1, 0, 0, 1, 7, 0]);
  });
});

function vectorMaskVisual(): LayerVisualParts {
  const identity = matrix();
  return {
    ownerLayerId: 'mask-layer',
    kind: 'fla-graphic',
    ownerTransform: {
      anchor: 'center',
      x: 100,
      y: 100,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
    },
    facePlacement: null,
    parts: [],
    headGroup: null,
    combinedLocalBounds: { x: -50, y: -50, width: 100, height: 100 },
    activeFace: null,
    resources: { required: [], candidates: [], fallback: [] },
    flaGraphic: {
      mode: 'instance',
      frameOrdinal: 0,
      frameAssetId: 'frame-asset',
      frameOffset: { x: 0, y: 0 },
      frameViewport: { x: 0, y: 0, width: 100, height: 100 },
      canvas: { width: 100, height: 100 },
      anchor: { x: 50, y: 50 },
      structureFrame: null,
      resourceAssetIds: [],
      layers: [{
        name: 'mask-art',
        nodes: [{
          source: {
            type: 'shape',
            id: 'mask-shape-node',
            drawOrder: 0,
            localTransform: identity,
          },
          path: ['mask-shape-node'],
          authoredLocalTransform: identity,
          localTransform: identity,
          worldTransform: identity,
          clipPaths: [],
          renderable: true,
          children: [],
          displayName: 'Mask shape',
          vectorVisual: {
            baseViewBox: { x: 0, y: 0, width: 100, height: 100 },
            regions: [{
              regionRef: 'region-0',
              fill: { kind: 'solid', color: '#ff0000', opacity: 1, fillRule: 'nonzero' },
              contours: [{
                closed: true,
                commands: [
                  { type: 'M', x: 2, y: 3 },
                  { type: 'L', x: 12, y: 3 },
                  { type: 'L', x: 12, y: 13 },
                  { type: 'Z' },
                ],
              }],
              strokes: [],
              bounds: { x: 2, y: 3, width: 10, height: 10 },
            }],
          },
        }],
      }],
    },
  } as unknown as LayerVisualParts;
}

function vectorMaskRenderLayer() {
  return {
    evaluated: {
      id: 'mask-layer',
      coverageMask: { role: 'mask-layer' as const, targetLayerIds: ['target-a', 'target-b'] },
    },
    visual: vectorMaskVisual(),
    render: {
      id: 'mask-layer',
      assetId: 'frame-asset',
      isBackground: false,
      listening: false as const,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      offsetX: 50,
      offsetY: 50,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 1,
      coverScale: null,
    },
  };
}

describe('author-level coverage mask composite (#1454)', () => {
  it('converts vector shape coverage into stage-space clip paths', () => {
    const layer = vectorMaskRenderLayer();
    expect(resolveCoverageMaskClipPaths({ layer, width: 1_920, height: 1_080 })).toEqual([
      { d: 'M 2 3 L 12 3 L 12 13 Z', fillRule: 'nonzero' },
    ]);
  });

  it('compiles one shared Path2D clip for every target of the same mask', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const clips = buildCoverageMaskClips(
      {
        width: 1_920,
        height: 1_080,
        layers: [
          vectorMaskRenderLayer(),
          {
            evaluated: { id: 'target-a' },
            visual: null,
            render: vectorMaskRenderLayer().render,
          },
          {
            evaluated: { id: 'target-b' },
            visual: null,
            render: vectorMaskRenderLayer().render,
          },
        ],
      },
      undefined,
    );
    const targetA = clips.clips.get('target-a');
    const targetB = clips.clips.get('target-b');
    expect(targetA).toBeDefined();
    expect(targetA).toBe(targetB);
    const clipFunc = createCoverageMaskClipFunc(targetA!);
    expect(clipFunc).not.toBeNull();
    const clipArgs = clipFunc!();
    expect(clipArgs).toHaveLength(2);
    expect(clipArgs[1]).toBe('nonzero');
    expect((clipArgs[0] as unknown as FakePath2D).pathData)
      .toBe('M 2 3 L 12 3 L 12 13 Z');
    // The compiled Path2D is reused for every draw of the shared clip.
    expect((clipFunc!()[0] as unknown as FakePath2D))
      .toBe(clipArgs[0]);
  });

  it('degrades without an empty clip when Path2D is unavailable', () => {
    vi.stubGlobal('Path2D', undefined);
    expect(createCoverageMaskClipFunc({
      maskLayerId: 'mask-layer',
      paths: [{ d: 'M 0 0 L 10 0 L 10 10 Z', fillRule: 'nonzero' }],
    })).toBeNull();
  });
});

describe('coverage mask renderer/Inspector wiring (#1454)', () => {
  const source = (relative: string): string =>
    readFileSync(new URL(`../../src/${relative}`, import.meta.url), 'utf8');

  it('hides mask layers from output but clips targets in the shared Stage renderer', () => {
    const stageRenderer = source('renderer/stage/StageRenderer.tsx');
    expect(stageRenderer).toContain('buildCoverageMaskClips');
    expect(stageRenderer).toContain('isDrawableStageLayer');
    expect(stageRenderer).toContain('CoverageMaskClipGroup');
    expect(stageRenderer).toContain('data-coverage-mask-layer-ids');
  });

  it('clips targets and keeps the mask Layer selectable on the editor Canvas', () => {
    const editorCanvas = source('renderer/features/canvas/CanvasStage.tsx');
    expect(editorCanvas).toContain('buildCoverageMaskClips');
    expect(editorCanvas).toContain('CoverageMaskClipGroup');
    expect(editorCanvas).toContain('maskLayerEditing');
    expect(editorCanvas).toContain('data-coverage-mask-target-json');
  });

  it('exposes the Chinese mask Inspector controls', () => {
    const inspectorControl = source('renderer/features/properties/LayerCoverageMaskControl.tsx');
    expect(inspectorControl).toContain('设为遮罩');
    expect(inspectorControl).toContain('解除遮罩');
    expect(inspectorControl).toContain('被遮罩图层');
    expect(inspectorControl).toContain('已自动忽略');
    expect(inspectorControl).toContain('layerStore.setMaskTargets');
    expect(source('renderer/shell/RightInspector.tsx')).toContain('LayerCoverageMaskControl');
    expect(source('renderer/features/properties/ShotLayerListPanel.tsx')).toContain('遮罩图层');
  });
});
