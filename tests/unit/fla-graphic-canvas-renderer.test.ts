import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateFlaGraphicNodeCompositePlan,
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

  it.each([true, false])('applies occurrence color once with structured frame = %s', (structured) => {
    const base = buildProjectWithAnimation().animations[0]!;
    const assetId = base.frames[0]!.assetId;
    const definition = FlaGraphicDefinitionSchema.parse({
      ...base, kind: 'fla-graphic', durationMs: 1000 / base.source.sourceFps,
      source: { ...base.source, endFrameIndex: 0, canvas: { width: 20, height: 20 }, anchor: { x: 0, y: 0 } },
      frames: [{ ...base.frames[0]!, ordinal: 0, sourceFrameIndex: 0, createdBySequenceImport: false,
        offset: { x: 3, y: 4 }, sourceViewport: { x: 3, y: 4, width: 8, height: 8 } }],
      ...(structured ? { structure: { version: 1, frames: [{ ordinal: 0, layers: [{ name: 'Part', nodes: [{
        type: 'bitmap', id: 'bitmap', drawOrder: 0, localTransform: matrix(3, 4), bitmapRef: 'part.png', assetId,
      }] }] }] } } : {}),
    });
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
    const images = new Map([[assetId, new FakeImage() as unknown as CanvasImageSource]]);
    const baseInput = { definition, frameOrdinal: 0, mode: 'instance' as const };
    const red = evaluateFlaGraphicVisual({ ...baseInput, instanceColor: {
      opacity: 0.5, rgbTransform: { multiplier: 0.5, offset: 0, channelOffsets: [64, 0, 0] },
    } })!;
    const bright = evaluateFlaGraphicVisual({ ...baseInput, instanceColor: {
      rgbTransform: { multiplier: 0.5, offset: 127.5 },
    } })!;
    const redRaster = renderFlaGraphicCanvas(red, images)!;
    const brightRaster = renderFlaGraphicCanvas(bright, images)!;
    expect(redRaster.rect).toEqual(structured
      ? { x: -10, y: -10, width: 20, height: 20 }
      : { x: -7, y: -6, width: 8, height: 8 });
    expect((redRaster.canvas as unknown as FakeCanvas).context.writtenPixels).toEqual([114, 40, 30, 128]);
    expect((brightRaster.canvas as unknown as FakeCanvas).context.writtenPixels).toEqual([178, 168, 158, 255]);
    expect((redRaster.canvas as unknown as FakeCanvas).context.readCount).toBe(1);
    expect(evaluateFlaGraphicVisual({ ...baseInput, mode: 'definition', instanceColor: red.instanceColor })?.instanceColor)
      .toBeUndefined();
  });

  it('reports small drawable bounds separately from the authored Graphic canvas', () => {
    const base = buildProjectWithAnimation().animations[0]!;
    const assetId = base.frames[0]!.assetId;
    const definition = FlaGraphicDefinitionSchema.parse({
      ...base, kind: 'fla-graphic', durationMs: 1000 / base.source.sourceFps,
      source: { ...base.source, endFrameIndex: 0, canvas: { width: 1920, height: 1080 }, anchor: { x: 0, y: 0 } },
      frames: [{ ...base.frames[0]!, ordinal: 0, sourceFrameIndex: 0, createdBySequenceImport: false,
        sourceViewport: { x: 0, y: 0, width: 1920, height: 1080 } }],
      structure: { version: 1, frames: [{ ordinal: 0, layers: [{ name: 'Part', nodes: [{
        type: 'bitmap', id: 'bitmap', drawOrder: 0, localTransform: matrix(972, 568), bitmapRef: 'part.png', assetId,
      }] }] }] },
    });
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
    const visual = evaluateFlaGraphicVisual({ definition, frameOrdinal: 0, mode: 'definition' })!;
    const raster = renderFlaGraphicCanvas(visual, new Map([[assetId, new FakeImage() as unknown as CanvasImageSource]]))!;
    expect(raster.rect).toEqual({ x: -960, y: -540, width: 1920, height: 1080 });
    expect(raster.visibleRect).toEqual({ x: 12, y: 28, width: 8, height: 8 });
    expect((raster.canvas as unknown as FakeCanvas).context.readCount).toBe(0);
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

  it.each([
    { blendMode: 'multiply' as const, expectedOp: 'multiply' },
    { blendMode: 'screen' as const, expectedOp: 'screen' },
    { blendMode: 'add' as const, expectedOp: 'lighter' },
  ])(
    'composites $blendMode (-> $expectedOp) against out-of-group and in-group backdrops with opaque/semi-transparent overlays and R01 outer color isolation (#1296)',
    ({ blendMode, expectedOp }) => {
      const frameAssetId = 'b1000000-0000-4000-8000-000000000001';
      const bgAssetId = '20000000-0000-4000-8000-000000000001';
      const overlayAssetId = '20000000-0000-4000-8000-000000000002';
      const makeDef = (options: {
        withBackdrop: boolean;
        opacity: number;
        isolateParent: boolean;
      }) =>
        FlaGraphicDefinitionSchema.parse({
          id: 'b0000000-0000-4000-8000-000000000001',
          kind: 'fla-graphic',
          name: `Blend-${blendMode}`,
          source: {
            basename: 'blend.fla',
            sha256: 'c'.repeat(64),
            renderTargetId: 'blend-target',
            targetKind: 'graphic-symbol',
            targetName: 'BlendHost',
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
            sha256: 'd'.repeat(64),
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
                name: 'blend-layer',
                nodes: [
                  ...(options.withBackdrop
                    ? [{
                        type: 'bitmap' as const,
                        id: 'backdrop',
                        drawOrder: 0,
                        localTransform: matrix(0, 0),
                        bitmapRef: 'bg.png',
                        assetId: bgAssetId,
                      }]
                    : []),
                  {
                    type: 'symbol' as const,
                    id: 'parent-wrapper',
                    drawOrder: options.withBackdrop ? 1 : 0,
                    localTransform: matrix(0, 0),
                    symbolRef: 'Wrapper',
                    ...(options.isolateParent ? { opacity: 0.8 } : {}),
                    children: [
                      ...(options.isolateParent
                        ? [{
                            type: 'bitmap' as const,
                            id: 'in-group-bg',
                            drawOrder: 0,
                            localTransform: matrix(0, 0),
                            bitmapRef: 'bg.png',
                            assetId: bgAssetId,
                          }]
                        : []),
                      {
                        type: 'symbol' as const,
                        id: 'blended-overlay',
                        drawOrder: options.isolateParent ? 1 : 0,
                        localTransform: matrix(2, 2),
                        symbolRef: 'Overlay',
                        blendMode,
                        opacity: options.opacity,
                        children: [{
                          type: 'bitmap' as const,
                          id: 'overlay-bmp',
                          drawOrder: 0,
                          localTransform: matrix(0, 0),
                          bitmapRef: 'overlay.png',
                          assetId: overlayAssetId,
                        }],
                      },
                    ],
                  },
                ],
              }],
            }],
          },
        });

      const bgImage = new FakeImage() as unknown as CanvasImageSource;
      const overlayImage = new FakeImage() as unknown as CanvasImageSource;
      const imageMap = new Map([
        [bgAssetId, bgImage],
        [overlayAssetId, overlayImage],
      ]);

      // 1) Out-of-group backdrop + semi-transparent overlay + R01 outer instanceColor:
      //    Plain parent wrapper is NOT isolated (needsComposite === false), so blended child
      //    composites directly onto root output canvas with globalCompositeOperation = expectedOp!
      const outCanvases: FakeCanvas[] = [];
      vi.stubGlobal('document', {
        createElement: () => {
          const canvas = new FakeCanvas();
          outCanvases.push(canvas);
          return canvas;
        },
      });
      const outVisual = evaluateFlaGraphicVisual({
        definition: makeDef({ withBackdrop: true, opacity: 0.5, isolateParent: false }),
        frameOrdinal: 0,
        mode: 'instance',
        instanceColor: { opacity: 0.75, rgbTransform: { multiplier: 0.5, offset: 20 } },
      })!;
      const parentNode = outVisual.layers![0]!.nodes[1]!;
      const blendedNode = parentNode.children[0]!;
      expect(evaluateFlaGraphicNodeCompositePlan(parentNode)).toMatchObject({
        needsComposite: false,
        blendMode: 'normal',
        canvasCompositeOperation: 'source-over',
      });
      expect(evaluateFlaGraphicNodeCompositePlan(blendedNode)).toMatchObject({
        needsComposite: true,
        blendMode,
        canvasCompositeOperation: expectedOp,
        opacity: 0.5,
      });

      const outRendered = renderFlaGraphicCanvas(outVisual, imageMap)!;
      const rootCanvas = outRendered.canvas as unknown as FakeCanvas;
      // Only 2 canvases created: root output + blended overlay scratch (plain parent NOT isolated!).
      expect(outCanvases).toHaveLength(2);
      const overlayScratch = outCanvases[1]!;
      expect(rootCanvas.context.draws).toHaveLength(2);
      expect(rootCanvas.context.draws[0]).toMatchObject({
        image: bgImage,
        alpha: 1,
        compositeOperation: 'source-over',
      });
      expect(rootCanvas.context.draws[1]).toMatchObject({
        image: overlayScratch,
        alpha: 0.5,
        compositeOperation: expectedOp,
      });
      // R01 outer instanceColor applied ONCE to root output canvas, never to scratch.
      expect(rootCanvas.context.readCount).toBe(1);
      expect(overlayScratch.context.readCount).toBe(0);

      // 2) In-group backdrop (isolated parent with opacity 0.8) + opaque overlay:
      const inCanvases: FakeCanvas[] = [];
      vi.stubGlobal('document', {
        createElement: () => {
          const canvas = new FakeCanvas();
          inCanvases.push(canvas);
          return canvas;
        },
      });
      const inVisual = evaluateFlaGraphicVisual({
        definition: makeDef({ withBackdrop: false, opacity: 1, isolateParent: true }),
        frameOrdinal: 0,
        mode: 'instance',
      })!;
      const inRendered = renderFlaGraphicCanvas(inVisual, imageMap)!;
      const inRoot = inRendered.canvas as unknown as FakeCanvas;
      // 3 canvases: root + isolated parent scratch + blended child scratch.
      expect(inCanvases).toHaveLength(3);
      const parentScratch = inCanvases[1]!;
      const childScratch = inCanvases[2]!;
      expect(parentScratch.context.draws[0]).toMatchObject({
        image: bgImage,
        compositeOperation: 'source-over',
      });
      expect(parentScratch.context.draws[1]).toMatchObject({
        image: childScratch,
        alpha: 1,
        compositeOperation: expectedOp,
      });
      expect(inRoot.context.draws[0]).toMatchObject({
        image: parentScratch,
        alpha: 0.8,
        compositeOperation: 'source-over',
      });

      // 3) Transparent background (no backdrop): overlay still composites onto empty canvas with expectedOp.
      const transparentCanvases: FakeCanvas[] = [];
      vi.stubGlobal('document', {
        createElement: () => {
          const canvas = new FakeCanvas();
          transparentCanvases.push(canvas);
          return canvas;
        },
      });
      const transparentVisual = evaluateFlaGraphicVisual({
        definition: makeDef({ withBackdrop: false, opacity: 1, isolateParent: false }),
        frameOrdinal: 0,
        mode: 'instance',
      })!;
      const transparentRendered = renderFlaGraphicCanvas(transparentVisual, imageMap)!;
      const transparentRoot = transparentRendered.canvas as unknown as FakeCanvas;
      expect(transparentRoot.context.draws).toHaveLength(1);
      expect(transparentRoot.context.draws[0]).toMatchObject({
        alpha: 1,
        compositeOperation: expectedOp,
      });
    },
  );

  it('applies full 4-channel RGBA with positive alphaOffset only inside valid coverage without tinting canvas padding (E-F03)', () => {
    const base = buildProjectWithAnimation().animations[0]!;
    const assetId = base.frames[0]!.assetId;
    const definition = FlaGraphicDefinitionSchema.parse({
      ...base,
      kind: 'fla-graphic',
      durationMs: 1000 / base.source.sourceFps,
      source: { ...base.source, endFrameIndex: 0, canvas: { width: 20, height: 20 }, anchor: { x: 0, y: 0 } },
      frames: [{
        ...base.frames[0]!, ordinal: 0, sourceFrameIndex: 0, createdBySequenceImport: false,
        offset: { x: 0, y: 0 }, sourceViewport: { x: 0, y: 0, width: 20, height: 20 },
      }],
      structure: {
        version: 1,
        frames: [{
          ordinal: 0,
          layers: [{
            name: 'BitmapLayer',
            nodes: [{
              type: 'symbol',
              id: 'sym-rgba',
              drawOrder: 0,
              localTransform: matrix(2, 2),
              symbolRef: 'Tile',
              rgbaTransform: { multipliers: [2, 0.5, 1, 0.5], offsets: [-20, 30, 0, 100] },
              children: [{
                type: 'bitmap',
                id: 'bmp',
                drawOrder: 0,
                localTransform: matrix(0, 0),
                bitmapRef: 'tile.png',
                assetId,
              }],
            }],
          }],
        }],
      },
    });
    // Pixel 0: opaque [150, 80, 40, 255] inside bitmap
    // Pixel 1: interior transparent bitmap texel [0, 0, 0, 0] with coverage alpha=255
    // Pixel 2: semi-transparent edge [100, 60, 20, 128] inside bitmap
    // Pixel 3: outside canvas padding [0, 0, 0, 0] with coverage alpha=0
    const createdCanvases: Array<{ fillRects: number[][]; written: number[] }> = [];
    let canvasOrdinal = 0;
    vi.stubGlobal('document', {
      createElement: () => {
        const ordinal = canvasOrdinal++;
        const state = { fillRects: [] as number[][], written: [] as number[] };
        createdCanvases.push(state);
        const ctx = {
          globalAlpha: 1,
          globalCompositeOperation: 'source-over',
          fillStyle: '',
          save() {},
          restore() {},
          setTransform() {},
          clearRect() {},
          drawImage() {},
          fillRect(...args: number[]) { state.fillRects.push(args); },
          getImageData() {
            if (ordinal === 2) {
              // Coverage canvas: pixels 0, 1, 2 are covered; pixel 3 is outer canvas padding
              return { data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0]) };
            }
            return { data: new Uint8ClampedArray([150, 80, 40, 255, 0, 0, 0, 0, 100, 60, 20, 128, 0, 0, 0, 0]) };
          },
          putImageData(img: { data: Uint8ClampedArray }) { state.written = Array.from(img.data); },
        };
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    const visual = evaluateFlaGraphicVisual({ definition, frameOrdinal: 0, mode: 'instance' })!;
    renderFlaGraphicCanvas(visual, new Map([[assetId, new FakeImage() as unknown as CanvasImageSource]]));
    // Canvas 0 = root, Canvas 1 = symbol scratch, Canvas 2 = symbol coverage scratch
    expect(createdCanvases[2]!.fillRects).toEqual([[0, 0, 8, 8]]);
    expect(createdCanvases[1]!.written).toEqual([
      255, 70, 40, 228, // pixel 0: clamp(150*2-20)=255, 80*0.5+30=70, 40, round(255*0.5+100)=228
      0, 30, 0, 100,    // pixel 1: interior transparent bitmap texel receives +100 alpha & +30 green
      180, 60, 20, 164, // pixel 2: semi-transparent edge clamped cleanly
      0, 0, 0, 0,       // pixel 3: outer canvas padding stays completely transparent (no tinted rect!)
    ]);
  });
});
