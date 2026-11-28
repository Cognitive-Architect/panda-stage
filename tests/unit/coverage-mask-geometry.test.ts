import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCoverageMaskClips,
  resolveCoverageMaskGeometry,
  type CoverageMaskClip,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
  type FlaVectorPathCommand,
  type LayerVisualParts,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { createCoverageMaskClipFunc } from '../../src/renderer/stage/coverageMaskClip';

/**
 * #1453 x #1454 (#1464 R3): a Group/Symbol coverage mask must use the real
 * drawable descendant shapes (recursively, with accumulated world transforms),
 * preserve each region's own fill rule, and merge mixed regions into ONE
 * non-negative `nonzero` clip. Empty-but-valid coverage is distinct from
 * unsupported geometry.
 */

const MASK_LAYER_ID = 'mask-layer';
const TARGET_LAYER_ID = 'target-layer';

function matrix(tx = 0, ty = 0): AffineMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

function rectCommands(x: number, y: number, width: number, height: number): FlaVectorPathCommand[] {
  return [
    { type: 'M', x, y },
    { type: 'L', x: x + width, y },
    { type: 'L', x: x + width, y: y + height },
    { type: 'L', x, y: y + height },
    { type: 'Z' },
  ];
}

interface RegionSpec {
  readonly contours: readonly FlaVectorPathCommand[][];
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly opacity?: number;
  readonly regionRef?: string;
}

function vectorNode(
  id: string,
  worldTransform: AffineMatrix2D,
  regions: readonly RegionSpec[],
): EvaluatedFlaGraphicNode {
  return {
    source: {
      type: 'opaque',
      id,
      drawOrder: 0,
      localTransform: worldTransform,
      authored: 'native',
    },
    path: [id],
    authoredLocalTransform: worldTransform,
    localTransform: worldTransform,
    worldTransform,
    clipPaths: [],
    renderable: true,
    children: [],
    vectorVisual: {
      baseViewBox: { x: 0, y: 0, width: 200, height: 200 },
      regions: regions.map((region, index) => ({
        regionRef: region.regionRef ?? `${id}-region-${index}`,
        fill: {
          kind: 'solid',
          color: '#ff0000',
          opacity: region.opacity ?? 1,
          fillRule: region.fillRule ?? 'nonzero',
        },
        contours: region.contours.map((commands) => ({ closed: true, commands })),
        strokes: [],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      })),
    },
  } as unknown as EvaluatedFlaGraphicNode;
}

function groupNode(
  id: string,
  worldTransform: AffineMatrix2D,
  children: readonly EvaluatedFlaGraphicNode[],
  type: 'group' | 'symbol' = 'group',
): EvaluatedFlaGraphicNode {
  return {
    source: {
      type,
      id,
      drawOrder: 0,
      localTransform: worldTransform,
      ...(type === 'symbol' ? { symbolRef: 'Symbol' } : {}),
    },
    path: [id],
    authoredLocalTransform: worldTransform,
    localTransform: worldTransform,
    worldTransform,
    clipPaths: [],
    renderable: true,
    children,
  } as unknown as EvaluatedFlaGraphicNode;
}

function textNode(id: string, worldTransform: AffineMatrix2D): EvaluatedFlaGraphicNode {
  return {
    source: { type: 'static-text', id, drawOrder: 0, localTransform: worldTransform },
    path: [id],
    authoredLocalTransform: worldTransform,
    localTransform: worldTransform,
    worldTransform,
    clipPaths: [],
    renderable: true,
    children: [],
    staticText: { text: 'mask', fontFamily: 'Arial', fontSize: 12 },
  } as unknown as EvaluatedFlaGraphicNode;
}

function bitmapNode(
  id: string,
  worldTransform: AffineMatrix2D,
  assetId: string,
): EvaluatedFlaGraphicNode {
  return {
    source: {
      type: 'bitmap',
      id,
      drawOrder: 0,
      localTransform: worldTransform,
      bitmapRef: 'Library/art.png',
      assetId,
    },
    path: [id],
    authoredLocalTransform: worldTransform,
    localTransform: worldTransform,
    worldTransform,
    clipPaths: [],
    renderable: true,
    children: [],
  } as unknown as EvaluatedFlaGraphicNode;
}

function graphicVisual(
  layers: EvaluatedFlaGraphicVisual['layers'],
): LayerVisualParts {
  return {
    ownerLayerId: MASK_LAYER_ID,
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
      frameViewport: { x: 0, y: 0, width: 200, height: 200 },
      canvas: { width: 200, height: 200 },
      anchor: { x: 100, y: 100 },
      structureFrame: null,
      resourceAssetIds: [],
      layers,
    } as unknown as EvaluatedFlaGraphicVisual,
  } as unknown as LayerVisualParts;
}

function maskRenderLayer(visual: LayerVisualParts, id = MASK_LAYER_ID) {
  return {
    evaluated: {
      id,
      coverageMask: { role: 'mask-layer' as const, targetLayerIds: [TARGET_LAYER_ID] },
    },
    visual,
    render: {
      id,
      assetId: 'frame-asset',
      isBackground: false,
      listening: false as const,
      x: 200,
      y: 200,
      width: 200,
      height: 200,
      offsetX: 0,
      offsetY: 0,
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

type ImageSizes = ReadonlyMap<string, { readonly width: number; readonly height: number }>;

/** Mask render layer whose graphic-canvas -> stage matrix is the identity. */
function geometryOf(visual: LayerVisualParts, imageSizes?: ImageSizes) {
  return resolveCoverageMaskGeometry({
    layer: maskRenderLayer(visual),
    width: 1_920,
    height: 1_080,
    ...(imageSizes ? { imageSizes } : {}),
  });
}

class FakePath2D {
  constructor(readonly pathData: string = '') {}
}

function compiledClip(clip: CoverageMaskClip): { d: string; rule: CanvasFillRule } {
  const clipFunc = createCoverageMaskClipFunc(clip);
  if (!clipFunc) throw new Error('Expected a compiled coverage clip.');
  const [path, rule] = clipFunc();
  return { d: (path as unknown as FakePath2D).pathData, rule };
}

type TestPoint = { readonly x: number; readonly y: number };

function parsePathPolygons(d: string): TestPoint[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gu) ?? [];
  const polygons: TestPoint[][] = [];
  let current: TestPoint[] | null = null;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === 'M') {
      current = [{ x: Number(tokens[index + 1]), y: Number(tokens[index + 2]) }];
      polygons.push(current);
      index += 3;
    } else if (token === 'L') {
      if (!current) throw new Error('L before M');
      current.push({ x: Number(tokens[index + 1]), y: Number(tokens[index + 2]) });
      index += 3;
    } else if (token === 'Z' || token === 'z') {
      index += 1;
    } else {
      throw new Error(`Unsupported test path command ${token}`);
    }
  }
  return polygons;
}

function windingAt(polygons: readonly TestPoint[][], point: TestPoint): number {
  let winding = 0;
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]!;
      const end = polygon[(index + 1) % polygon.length]!;
      if (start.y <= point.y) {
        if (
          end.y > point.y &&
          (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y) > 0
        ) {
          winding += 1;
        }
      } else if (
        end.y <= point.y &&
        (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y) < 0
      ) {
        winding -= 1;
      }
    }
  }
  return winding;
}

function isCovered(clip: CoverageMaskClip, point: TestPoint): boolean {
  const { d, rule } = compiledClip(clip);
  const winding = windingAt(parsePathPolygons(d), point);
  if (rule === 'evenodd') return Math.abs(winding) % 2 === 1;
  return winding !== 0;
}

function clipFor(visual: LayerVisualParts, imageSizes?: ImageSizes): CoverageMaskClip {
  const map = buildCoverageMaskClips(
    {
      width: 1_920,
      height: 1_080,
      layers: [
        maskRenderLayer(visual),
        { evaluated: { id: TARGET_LAYER_ID }, visual: null, render: maskRenderLayer(visual).render },
      ],
    },
    undefined,
    imageSizes,
  );
  const clip = map.clips.get(TARGET_LAYER_ID);
  if (!clip) throw new Error('Expected a resolved coverage clip.');
  return clip;
}

beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function singleLayer(...nodes: EvaluatedFlaGraphicNode[]) {
  return graphicVisual([{ name: 'coverage-art', nodes }]);
}

describe('Group/Symbol coverage uses real drawable descendants (#1464 R3)', () => {
  it('unions the actual child shapes of a Group instead of its bounding box', () => {
    const group = groupNode('group', matrix(), [
      vectorNode('child-a', matrix(10, 10), [{ contours: [rectCommands(0, 0, 20, 20)] }]),
      vectorNode('child-b', matrix(40, 10), [{ contours: [rectCommands(0, 0, 20, 20)] }]),
    ]);
    const resolution = geometryOf(singleLayer(group));
    expect(resolution.status).toBe('resolved');
    expect(resolution.paths).toHaveLength(2);

    const clip = clipFor(singleLayer(group));
    expect(isCovered(clip, { x: 15, y: 15 })).toBe(true);
    expect(isCovered(clip, { x: 45, y: 15 })).toBe(true);
    // Inside the Group bounding box, outside both children: not covered.
    expect(isCovered(clip, { x: 35, y: 15 })).toBe(false);
    expect(isCovered(clip, { x: 5, y: 5 })).toBe(false);
  });

  it('recurses through a Symbol instance with accumulated world transforms', () => {
    // `worldTransform` is accumulated by the FLA evaluator: group 10,10 ->
    // symbol 15,15 -> inner shape 25,25.
    const symbol = groupNode('symbol', matrix(15, 15), [
      vectorNode('inner', matrix(25, 25), [{ contours: [rectCommands(0, 0, 10, 10)] }]),
    ], 'symbol');
    const visual = singleLayer(groupNode('group', matrix(10, 10), [symbol]));
    const resolution = geometryOf(visual);
    expect(resolution.status).toBe('resolved');
    expect(resolution.paths).toHaveLength(1);
    const clip = clipFor(visual);
    expect(isCovered(clip, { x: 27, y: 27 })).toBe(true);
    expect(isCovered(clip, { x: 20, y: 20 })).toBe(false);
  });

  it('preserves nonzero overlapping filled children as a union', () => {
    const group = groupNode('group', matrix(), [
      vectorNode('left', matrix(), [{ contours: [rectCommands(0, 0, 30, 30)] }]),
      vectorNode('right', matrix(), [{ contours: [rectCommands(15, 0, 30, 30)] }]),
    ]);
    const clip = clipFor(singleLayer(group));
    expect(isCovered(clip, { x: 10, y: 10 })).toBe(true);
    expect(isCovered(clip, { x: 20, y: 10 })).toBe(true);
    expect(isCovered(clip, { x: 35, y: 10 })).toBe(true);
    expect(isCovered(clip, { x: 46, y: 10 })).toBe(false);
  });
});

describe('fill-rule semantics survive the merged coverage (#1464 R3)', () => {
  it('keeps an evenodd hole made of same-direction inner/outer contours', () => {
    const holeRegion: RegionSpec = {
      fillRule: 'evenodd',
      contours: [rectCommands(2, 2, 26, 26), rectCommands(8, 8, 14, 14)],
    };
    const resolution = geometryOf(singleLayer(vectorNode('shape', matrix(), [holeRegion])));
    expect(resolution.status).toBe('resolved');
    expect(resolution.issues).toEqual([]);
    const clip = clipFor(singleLayer(vectorNode('shape', matrix(), [holeRegion])));
    expect(compiledClip(clip).rule).toBe('nonzero');
    expect(isCovered(clip, { x: 4, y: 4 })).toBe(true);
    expect(isCovered(clip, { x: 15, y: 15 })).toBe(false);
    expect(isCovered(clip, { x: 29, y: 29 })).toBe(false);
  });

  it('merges mixed evenodd and nonzero regions without globally switching the rule', () => {
    const group = groupNode('group', matrix(), [
      vectorNode('ring', matrix(), [{
        fillRule: 'evenodd',
        contours: [rectCommands(2, 2, 30, 30), rectCommands(10, 10, 10, 10)],
      }]),
      vectorNode('patch', matrix(), [{ contours: [rectCommands(15, 15, 10, 10)] }]),
    ]);
    const clip = clipFor(singleLayer(group));
    expect(compiledClip(clip).rule).toBe('nonzero');
    expect(isCovered(clip, { x: 5, y: 5 })).toBe(true);
    // Ring hole not covered by the nonzero patch.
    expect(isCovered(clip, { x: 12, y: 12 })).toBe(false);
    // Ring hole covered by the nonzero patch: the union is filled.
    expect(isCovered(clip, { x: 17, y: 17 })).toBe(true);
  });

  it('keeps a mirrored bitmap leaf from cancelling a vector region in the merged clip', () => {
    const bitmap = bitmapNode(
      'mirrored-bitmap',
      { a: -1, b: 0, c: 0, d: 1, tx: 10, ty: 0 },
      'bitmap-asset',
    );
    const vector = vectorNode('vector', matrix(), [{ contours: [rectCommands(0, 0, 20, 20)] }]);
    const visual = singleLayer(groupNode('group', matrix(), [bitmap, vector]));
    const imageSizes = new Map([['bitmap-asset', { width: 20, height: 20 }]]);
    const resolution = geometryOf(visual, imageSizes);
    expect(resolution.status).toBe('resolved');
    expect(resolution.paths).toHaveLength(2);
    const clip = clipFor(visual, imageSizes);
    // Overlap: a mirrored (negative winding) rect must not cancel the vector fill.
    expect(isCovered(clip, { x: 5, y: 5 })).toBe(true);
    expect(isCovered(clip, { x: -5, y: 5 })).toBe(true);
    expect(isCovered(clip, { x: 15, y: 5 })).toBe(true);
    expect(isCovered(clip, { x: -15, y: 5 })).toBe(false);
  });

  it('reports a zero-net-area self-intersecting contour instead of dropping it', () => {
    const symmetricBowtie = vectorNode('zero-area-bowtie', matrix(), [{
      contours: [[
        { type: 'M', x: 2, y: 2 },
        { type: 'L', x: 20, y: 20 },
        { type: 'L', x: 20, y: 2 },
        { type: 'L', x: 2, y: 20 },
        { type: 'Z' },
      ]],
    }]);
    const resolution = geometryOf(singleLayer(symmetricBowtie));
    expect(resolution.status).toBe('unsupported');
    expect(resolution.issues).toEqual([
      expect.objectContaining({ code: 'unsupported-geometry' }),
    ]);
  });

  it('reports unsupported geometry locally while other regions still clip', () => {
    // Asymmetric self-intersecting (figure-eight) nonzero contour: it has a
    // non-zero net area, so it must be reported instead of silently skipped.
    const bowtie = vectorNode('bowtie', matrix(), [{
      contours: [[
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 40, y: 0 },
        { type: 'L', x: 10, y: 20 },
        { type: 'L', x: 40, y: 20 },
        { type: 'Z' },
      ]],
    }]);
    const valid = vectorNode('valid', matrix(30, 2), [{ contours: [rectCommands(0, 0, 15, 15)] }]);
    const visual = singleLayer(groupNode('group', matrix(), [bowtie, valid]));
    const resolution = geometryOf(visual);
    expect(resolution.status).toBe('resolved');
    expect(resolution.paths).toHaveLength(1);
    expect(resolution.issues).toEqual([
      expect.objectContaining({ code: 'unsupported-geometry', regionRef: 'bowtie-region-0' }),
    ]);
    const clip = clipFor(visual);
    expect(isCovered(clip, { x: 40, y: 10 })).toBe(true);
    // The unrepresentable figure-eight is degraded locally, not turned into a box.
    expect(isCovered(clip, { x: 10, y: 10 })).toBe(false);
    expect(clip.issues).toHaveLength(1);
  });
});

describe('empty vs unsupported coverage (#1464 R3)', () => {
  it('distinguishes valid empty coverage from unsupported text coverage', () => {
    const empty = geometryOf(singleLayer(groupNode('empty-group', matrix(), [])));
    expect(empty).toMatchObject({ status: 'empty', paths: [], issues: [] });

    const faded = geometryOf(singleLayer(
      vectorNode('faded', matrix(), [{ contours: [rectCommands(0, 0, 10, 10)], opacity: 0 }]),
    ));
    expect(faded).toMatchObject({ status: 'empty', paths: [] });

    const text = geometryOf(singleLayer(textNode('text', matrix())));
    expect(text.status).toBe('unsupported');
    expect(text.issues).toEqual([
      expect.objectContaining({ code: 'unsupported-text' }),
    ]);
  });

  it('reports an unknown bitmap leaf size as unsupported, not empty', () => {
    const resolution = geometryOf(singleLayer(bitmapNode('bitmap', matrix(), 'missing-asset')));
    expect(resolution.status).toBe('unsupported');
    expect(resolution.issues).toEqual([
      expect.objectContaining({ code: 'unknown-bitmap-size' }),
    ]);
  });

  it('clips targets to nothing for valid empty coverage and leaves unsupported masks unclipped', () => {
    const emptyVisual = singleLayer(groupNode('empty-group', matrix(), []));
    const emptyMap = buildCoverageMaskClips(
      {
        width: 1_920,
        height: 1_080,
        layers: [
          maskRenderLayer(emptyVisual),
          { evaluated: { id: TARGET_LAYER_ID }, visual: null, render: maskRenderLayer(emptyVisual).render },
        ],
      },
      undefined,
    );
    const emptyClip = emptyMap.clips.get(TARGET_LAYER_ID)!;
    expect(emptyClip.empty).toBe(true);
    expect(emptyClip.paths).toEqual([]);
    expect([...emptyMap.emptyMaskLayerIds]).toEqual([MASK_LAYER_ID]);
    expect([...emptyMap.unresolvedMaskLayerIds]).toEqual([]);
    // An empty Path2D clip hides the target (no paint coverage).
    expect(compiledClip(emptyClip)).toEqual({ d: '', rule: 'nonzero' });

    const unsupportedVisual = singleLayer(textNode('text', matrix()));
    const unsupportedMap = buildCoverageMaskClips(
      {
        width: 1_920,
        height: 1_080,
        layers: [
          maskRenderLayer(unsupportedVisual),
          { evaluated: { id: TARGET_LAYER_ID }, visual: null, render: maskRenderLayer(unsupportedVisual).render },
        ],
      },
      undefined,
    );
    expect(unsupportedMap.clips.size).toBe(0);
    expect([...unsupportedMap.unresolvedMaskLayerIds]).toEqual([MASK_LAYER_ID]);
    expect([...unsupportedMap.emptyMaskLayerIds]).toEqual([]);
    expect(unsupportedMap.issues).toEqual([
      expect.objectContaining({ code: 'unsupported-text' }),
    ]);
  });

  it('keeps an image mask Layer footprint fallback unchanged', () => {
    const imageVisual = {
      ...graphicVisual(null),
      flaGraphic: undefined,
      combinedLocalBounds: { x: -50, y: -50, width: 100, height: 100 },
    } as unknown as LayerVisualParts;
    const resolution = geometryOf(imageVisual);
    expect(resolution.status).toBe('resolved');
    expect(resolution.paths).toEqual([
      { d: 'M 150 150 L 250 150 L 250 250 L 150 250 Z' },
    ]);
  });
});
