import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateFlaGraphicVisual,
  FlaGraphicDefinitionSchema,
} from '../../src/domain';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { buildProjectWithAnimation } from './domain/testProject';
import { decomposeAffineMatrix } from '../../src/domain';

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
    this.stack.push({
      alpha: this.globalAlpha,
      operation: this.globalCompositeOperation,
    });
  }

  restore(): void {
    const saved = this.stack.pop();
    this.globalAlpha = saved?.alpha ?? 1;
    this.globalCompositeOperation = saved?.operation ?? 'source-over';
  }

  setTransform(...values: number[]): void {
    this.setTransforms.push(values);
  }

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

describe('shared FLA Graphic Canvas renderer', () => {
  it.each([
    { name: 'up', matrix: matrix(2, -40), rect: { x: -10, y: -50, width: 20, height: 60 } },
    { name: 'left', matrix: matrix(-40, 2), rect: { x: -42, y: -10, width: 52, height: 20 } },
    { name: 'right/down', matrix: matrix(40, 40), rect: { x: -10, y: -10, width: 56, height: 48 } },
    { name: 'scale/rotate', matrix: { a: 0, b: 3, c: -2, d: 0, tx: 2, ty: 2 }, rect: { x: -16, y: -10, width: 26, height: 26 } },
  ])('keeps a nested Child visible outside authored bounds: $name (#1092 B)', ({ matrix: childMatrix, rect }) => {
    const base = buildProjectWithAnimation().animations[0]!;
    const assetId = base.frames[0]!.assetId;
    const definition = FlaGraphicDefinitionSchema.parse({
      ...base, kind: 'fla-graphic', durationMs: 1000 / base.source.sourceFps,
      source: { ...base.source, endFrameIndex: 0, canvas: { width: 20, height: 20 }, anchor: { x: 0, y: 0 } },
      frames: [{ ...base.frames[0]!, ordinal: 0, sourceFrameIndex: 0, createdBySequenceImport: false, sourceViewport: { x: 0, y: 0, width: 20, height: 20 } }],
      structure: { version: 1, symbolDefinitions: { child: {
        symbolRef: 'Child', children: [{ type: 'bitmap', id: 'bitmap', sourceAddress: 'child-bitmap', drawOrder: 0,
          localTransform: childMatrix, bitmapRef: 'child.png', assetId }],
      } }, frames: [{ ordinal: 0, layers: [{ name: 'Layer', nodes: [{
        type: 'group', id: 'group', groupId: 'group', drawOrder: 0, localTransform: matrix(3), children: [{
          type: 'symbol', id: 'symbol', symbolRef: 'Child', nestedDefinitionId: 'child', drawOrder: 0, localTransform: matrix(5),
        }],
      }] }] }] },
    });
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
    const images = new Map([[assetId, new FakeImage() as unknown as CanvasImageSource]]);
    for (const mode of ['definition', 'instance', 'timeline']) {
      // Both a persisted Shared Definition and a sparse Instance override use
      // the same evaluated world bounds; selection keeps the authored origin.
      const restored = FlaGraphicDefinitionSchema.parse(JSON.parse(JSON.stringify(definition)));
      if (mode !== 'definition') restored.structure!.symbolDefinitions!.child!.children[0]!.localTransform = matrix();
      if (mode === 'timeline') restored.structure!.symbolDefinitions!.child!.timeline = { tracks: [{
        trackId: 'addr:child-bitmap', keyframes: [
          { timeMs: 0, easing: 'linear', transform: decomposeAffineMatrix(matrix()) },
          { timeMs: 1000, easing: 'linear', transform: decomposeAffineMatrix(childMatrix) },
        ],
      }] };
      const visual = evaluateFlaGraphicVisual({ definition: restored, frameOrdinal: 0, mode: mode === 'instance' ? 'instance' : 'definition', internalTimeMs: 1000,
        ...(mode === 'instance' ? { instanceTransformOverrides: { '0': { '["group","symbol","bitmap"]': childMatrix } } } : {}),
      })!;
      const raster = renderFlaGraphicCanvas(visual, images)!;
      for (const [key, value] of Object.entries(rect)) {
        expect(raster.rect[key as keyof typeof rect]).toBeCloseTo(value, 6);
      }
      const canvas = raster.canvas as unknown as FakeCanvas;
      expect(canvas.width).toBeGreaterThanOrEqual(rect.width);
      expect(canvas.height).toBeGreaterThanOrEqual(rect.height);
      expect(canvas.context.draws[0]?.image).toBe(images.get(assetId));
      const placement = canvas.context.setTransforms[0]!;
      expect(raster.rect.x + placement[4]!).toBeCloseTo(childMatrix.tx + 8 - 10, 6);
      expect(raster.rect.y + placement[5]!).toBeCloseTo(childMatrix.ty - 10, 6);
    }
  });

  it('composites a transformed nested mask, applies Symbol RGB transform and opacity, and keeps sibling fallback local', () => {
    const frameAssetId = 'a1000000-0000-4000-8000-000000000001';
    const bitmapAssetId = '10000000-0000-4000-8000-000000000001';
    const siblingAssetId = '10000000-0000-4000-8000-000000000002';
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
              children: [
                {
                  type: 'symbol',
                  id: 'symbol',
                  drawOrder: 0,
                  localTransform: matrix(5),
                  symbolRef: 'Symbol',
                  opacity: 0.4,
                  rgbTransform: { multiplier: 0.5, offset: 10 },
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
                },
                {
                  type: 'bitmap',
                  id: 'visible-sibling',
                  drawOrder: 1,
                  localTransform: matrix(12),
                  bitmapRef: 'Library/sibling.png',
                  assetId: siblingAssetId,
                },
                {
                  type: 'opaque',
                  id: 'unsafe-opaque',
                  drawOrder: 2,
                  localTransform: matrix(15),
                  opaqueKind: 'filter',
                },
              ],
            }],
          }],
        }],
      },
    });
    const visual = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: 0,
      mode: 'instance',
    });
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
    const bitmap = new FakeImage() as unknown as CanvasImageSource;
    const sibling = new FakeImage() as unknown as CanvasImageSource;
    const rendered = renderFlaGraphicCanvas(visual, new Map([
      [bitmapAssetId, bitmap],
      [siblingAssetId, sibling],
    ]));

    const output = rendered!.canvas as unknown as FakeCanvas;
    const symbolCanvas = canvases[1]!;
    const maskCanvas = canvases[2]!;
    expect(output.context.draws).toHaveLength(2);
    expect(output.context.draws[0]).toMatchObject({ image: symbolCanvas, alpha: 0.4 });
    expect(output.context.draws[1]).toMatchObject({ image: sibling, alpha: 1 });
    expect(symbolCanvas.context.draws[0]?.image).toBe(bitmap);
    expect(symbolCanvas.context.draws.some((draw) =>
      draw.image === maskCanvas && draw.compositeOperation === 'destination-in',
    )).toBe(true);
    expect(maskCanvas.context.fills).toEqual(['M0 0L8 0L8 8Z']);
    expect(maskCanvas.context.setTransforms).toContainEqual([1, 0, 0, 1, 7, 0]);
    expect(symbolCanvas.context.readCount).toBe(1);
    expect(symbolCanvas.context.writtenPixels).toEqual([60, 50, 40, 255]);
  });
});
