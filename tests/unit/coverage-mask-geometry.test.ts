import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCoverageMaskClips,
  commandsToSvgPathD,
  resolveCoverageMaskGeometry,
  type CoverageMaskClip,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
  type FlaVectorPathCommand,
  type LayerVisualParts,
} from '../../src/domain';
import { convertCoverageRegionToNonzero } from '../../src/domain/selectors/coverageMaskFillRule';
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

type TestSegment =
  | { readonly kind: 'L'; readonly start: TestPoint; readonly end: TestPoint; readonly controls: readonly [] }
  | { readonly kind: 'Q'; readonly start: TestPoint; readonly end: TestPoint; readonly controls: readonly [TestPoint] }
  | {
      readonly kind: 'C';
      readonly start: TestPoint;
      readonly end: TestPoint;
      readonly controls: readonly [TestPoint, TestPoint];
    };

/**
 * Parses the emitted SVG path data into command contours. The test evaluates the
 * REAL emitted curve commands (M/L/Q/C), not a sampled polyline: the coverage
 * assertions below must describe the authored curves exactly.
 */
function parsePathContours(d: string): FlaVectorPathCommand[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gu) ?? [];
  const contours: FlaVectorPathCommand[][] = [];
  let current: FlaVectorPathCommand[] | null = null;
  let index = 0;
  const next = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index++]!;
    if (token === 'M') {
      current = [{ type: 'M', x: next(), y: next() }];
      contours.push(current);
    } else if (token === 'L') {
      if (!current) throw new Error('L before M');
      current.push({ type: 'L', x: next(), y: next() });
    } else if (token === 'Q') {
      if (!current) throw new Error('Q before M');
      current.push({ type: 'Q', cx: next(), cy: next(), x: next(), y: next() });
    } else if (token === 'C') {
      if (!current) throw new Error('C before M');
      current.push({
        type: 'C',
        c1x: next(),
        c1y: next(),
        c2x: next(),
        c2y: next(),
        x: next(),
        y: next(),
      });
    } else if (token === 'Z' || token === 'z') {
      // Implicitly closed by the fill.
    } else {
      throw new Error(`Unsupported test path command ${token}`);
    }
  }
  return contours;
}

function contourTestSegments(commands: readonly FlaVectorPathCommand[]): TestSegment[] {
  const first = commands[0];
  if (!first || first.type !== 'M') return [];
  const segments: TestSegment[] = [];
  let current: TestPoint = { x: first.x, y: first.y };
  for (let index = 1; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === 'Z') continue;
    if (command.type === 'M') throw new Error('multiple M commands in one contour');
    const end: TestPoint = { x: command.x, y: command.y };
    if (command.type === 'L') {
      segments.push({ kind: 'L', start: current, end, controls: [] });
    } else if (command.type === 'Q') {
      segments.push({
        kind: 'Q',
        start: current,
        end,
        controls: [{ x: command.cx, y: command.cy }],
      });
    } else {
      segments.push({
        kind: 'C',
        start: current,
        end,
        controls: [
          { x: command.c1x, y: command.c1y },
          { x: command.c2x, y: command.c2y },
        ],
      });
    }
    current = end;
  }
  if (segments.length > 0 && (current.x !== first.x || current.y !== first.y)) {
    segments.push({ kind: 'L', start: current, end: { x: first.x, y: first.y }, controls: [] });
  }
  return segments;
}

function segmentPointAt(segment: TestSegment, t: number): TestPoint {
  const u = 1 - t;
  if (segment.kind === 'L') {
    return {
      x: u * segment.start.x + t * segment.end.x,
      y: u * segment.start.y + t * segment.end.y,
    };
  }
  if (segment.kind === 'Q') {
    const control = segment.controls[0];
    return {
      x: u * u * segment.start.x + 2 * u * t * control.x + t * t * segment.end.x,
      y: u * u * segment.start.y + 2 * u * t * control.y + t * t * segment.end.y,
    };
  }
  const [control1, control2] = segment.controls;
  return {
    x:
      u * u * u * segment.start.x +
      3 * u * u * t * control1.x +
      3 * u * t * t * control2.x +
      t * t * t * segment.end.x,
    y:
      u * u * u * segment.start.y +
      3 * u * u * t * control1.y +
      3 * u * t * t * control2.y +
      t * t * t * segment.end.y,
  };
}

function segmentYDerivative(segment: TestSegment, t: number): number {
  const epsilon = 1e-7;
  const from = Math.max(0, t - epsilon);
  const to = Math.min(1, t + epsilon);
  return (
    (segmentPointAt(segment, to).y - segmentPointAt(segment, from).y) / (to - from)
  );
}

/** Real roots of y(t) = y on [0, 1); half-open so shared vertices count once. */
function segmentYRoots(segment: TestSegment, y: number): number[] {
  const valueAt = (t: number): number => segmentPointAt(segment, t).y - y;
  const roots: number[] = [];
  const steps = 512;
  if (Math.abs(valueAt(0)) <= 1e-12) roots.push(0);
  let previousT = 0;
  let previous = valueAt(0);
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const value = valueAt(t);
    if (value === 0 && t < 1 - 1e-9) {
      roots.push(t);
    } else if (previous !== 0 && (previous < 0) !== (value < 0)) {
      let low = previousT;
      let high = t;
      let lowValue = previous;
      for (let iteration = 0; iteration < 64; iteration += 1) {
        const middle = (low + high) / 2;
        const middleValue = valueAt(middle);
        if ((lowValue < 0) !== (middleValue < 0)) {
          high = middle;
        } else {
          low = middle;
          lowValue = middleValue;
        }
      }
      const root = (low + high) / 2;
      if (root < 1 - 1e-9) roots.push(root);
    }
    previousT = t;
    previous = value;
  }
  return roots;
}

/** Winding of the emitted clip geometry at one point, including real curves. */
function windingAtClip(clip: CoverageMaskClip, point: TestPoint): number {
  const { d } = compiledClip(clip);
  let winding = 0;
  for (const contour of parsePathContours(d)) {
    for (const segment of contourTestSegments(contour)) {
      for (const root of segmentYRoots(segment, point.y)) {
        const crossingX = segmentPointAt(segment, root).x;
        const direction = segmentYDerivative(segment, root) > 0 ? 1 : -1;
        if (crossingX > point.x) {
          winding += direction;
        }
      }
    }
  }
  return winding;
}

function isCovered(clip: CoverageMaskClip, point: TestPoint): boolean {
  const { rule } = compiledClip(clip);
  const winding = windingAtClip(clip, point);
  if (rule === 'evenodd') return Math.abs(winding) % 2 === 1;
  return winding !== 0;
}

function authoredPathD(contours: readonly (readonly FlaVectorPathCommand[])[]): string {
  return contours.map((commands) => commandsToSvgPathD(commands)).join(' ').trim();
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

/**
 * #1469 F4: curve fill-rule equivalence is never claimed from polyline sampling.
 *
 * The ticket counterexample is a quadratic curve `M 0 1500 Q 600 -1500 1200 1500`
 * whose real Y at X=550 is ~10.42 while the old 12-step polyline gives ~20.83.
 * A closed contour plus a small rectangle placed between the two geometries
 * really intersects the curve; the sampled polyline does not, so the old
 * sampled equivalence test declared the evenodd region convertible and emitted
 * the original curves under `nonzero` with inverted winding.
 */
const CURVE_BLOB: FlaVectorPathCommand[] = [
  { type: 'M', x: 0, y: 1500 },
  { type: 'Q', cx: 600, cy: -1500, x: 1200, y: 1500 },
  { type: 'L', x: 1200, y: 2000 },
  { type: 'L', x: 0, y: 2000 },
  { type: 'Z' },
];
/** X 553..557, Y 7..10: crosses the real curve, misses the 12-step polyline. */
const BETWEEN_CURVE_AND_POLYLINE = rectCommands(553, 7, 4, 3);

/** Y of the real quadratic at X, in the ticket's stage coordinates. */
function realCurveYAtX(x: number): number {
  const t = x / 1200;
  return 1500 * (1 - 2 * t) ** 2;
}

/** Y of the old fixed 12-step flattening at X (uniform in t). */
function sampledCurveYAtX(x: number): number {
  const steps = 12;
  const sampleY = (index: number): number => 1500 * (1 - (2 * index) / steps) ** 2;
  const position = (x / 1200) * steps;
  const index = Math.floor(position);
  const fraction = position - index;
  return sampleY(index) + (sampleY(index + 1) - sampleY(index)) * fraction;
}

/** Nested curve blobs used for nonzero/evenodd curve holes and disjoint merges. */
const OUTER_BLOB: FlaVectorPathCommand[] = [
  { type: 'M', x: 0, y: 100 },
  { type: 'Q', cx: 100, cy: -100, x: 200, y: 100 },
  { type: 'Q', cx: 100, cy: 300, x: 0, y: 100 },
  { type: 'Z' },
];
/** Same traversal direction as the outer blob (an evenodd hole). */
const HOLE_SAME_WINDING: FlaVectorPathCommand[] = [
  { type: 'M', x: 60, y: 100 },
  { type: 'Q', cx: 100, cy: 40, x: 140, y: 100 },
  { type: 'Q', cx: 100, cy: 160, x: 60, y: 100 },
  { type: 'Z' },
];
/** Reversed traversal direction (a nonzero hole). */
const HOLE_OPPOSITE_WINDING: FlaVectorPathCommand[] = [
  { type: 'M', x: 60, y: 100 },
  { type: 'Q', cx: 100, cy: 160, x: 140, y: 100 },
  { type: 'Q', cx: 100, cy: 40, x: 60, y: 100 },
  { type: 'Z' },
];

describe('curve fill-rule conversion is never sampled (#1469 F4)', () => {
  it('rejects the ticket counterexample instead of declaring sampled equivalence', () => {
    // The documented sampling gap that makes any polyline proof invalid.
    expect(realCurveYAtX(550)).toBeCloseTo(10.42, 2);
    expect(sampledCurveYAtX(550)).toBeCloseTo(20.83, 2);

    const conversion = convertCoverageRegionToNonzero({
      fillRule: 'evenodd',
      contours: [CURVE_BLOB, BETWEEN_CURVE_AND_POLYLINE],
    });
    expect(conversion.ok).toBe(false);
    expect(conversion).toMatchObject({ code: 'unsupported-curve-fill-rule' });
  });

  it('emits the sole evenodd curve region with the authored rule and exact curves', () => {
    const visual = singleLayer(vectorNode('curve-shape', matrix(), [{
      fillRule: 'evenodd',
      contours: [CURVE_BLOB, BETWEEN_CURVE_AND_POLYLINE],
    }]));
    const clip = clipFor(visual);
    expect(clip.fillRule).toBe('evenodd');
    expect(compiledClip(clip).rule).toBe('evenodd');
    // No approximate conversion: the exact authored curves are preserved.
    expect(clip.paths).toHaveLength(1);
    expect(clip.paths[0]!.d).toBe(authoredPathD([CURVE_BLOB, BETWEEN_CURVE_AND_POLYLINE]));

    // The real rectangle/curve crossing makes the point doubly wound (winding 2),
    // so authored evenodd is a hole. A nonzero interpretation would paint it.
    expect(windingAtClip(clip, { x: 555, y: 9 })).toBe(2);
    expect(isCovered(clip, { x: 555, y: 9 })).toBe(false);
    expect(isCovered(clip, { x: 600, y: 100 })).toBe(true);
  });

  it('keeps an ordinary nonzero curve hole with opposite winding exact', () => {
    const visual = singleLayer(vectorNode('curve-ring', matrix(), [{
      fillRule: 'nonzero',
      contours: [OUTER_BLOB, HOLE_OPPOSITE_WINDING],
    }]));
    const clip = clipFor(visual);
    expect(clip.fillRule).toBe('nonzero');
    expect(clip.issues).toEqual([]);
    expect(clip.paths[0]!.d).toBe(authoredPathD([OUTER_BLOB, HOLE_OPPOSITE_WINDING]));
    // Ring (winding 1) painted, hole (winding 0) and outside (0) not painted.
    expect(isCovered(clip, { x: 100, y: 35 })).toBe(true);
    expect(isCovered(clip, { x: 100, y: 100 })).toBe(false);
    expect(isCovered(clip, { x: 100, y: 180 })).toBe(true);
    expect(isCovered(clip, { x: 100, y: 220 })).toBe(false);
  });

  it('keeps an evenodd curve hole with the authored evenodd rule', () => {
    const visual = singleLayer(vectorNode('curve-evenodd-ring', matrix(), [{
      fillRule: 'evenodd',
      contours: [OUTER_BLOB, HOLE_SAME_WINDING],
    }]));
    const clip = clipFor(visual);
    expect(compiledClip(clip).rule).toBe('evenodd');
    expect(windingAtClip(clip, { x: 100, y: 100 })).toBe(2);
    expect(isCovered(clip, { x: 100, y: 100 })).toBe(false);
    expect(isCovered(clip, { x: 100, y: 35 })).toBe(true);
  });

  it('keeps provably disjoint nonzero curve regions (including a mirrored one)', () => {
    const visual = singleLayer(
      vectorNode('blob-a', matrix(), [{ contours: [OUTER_BLOB] }]),
      // Mirror + translate: exact bounds stay disjoint from blob-a.
      vectorNode('blob-b', { a: -1, b: 0, c: 0, d: 1, tx: 600, ty: 0 }, [
        { contours: [OUTER_BLOB] },
      ]),
    );
    const clip = clipFor(visual);
    expect(clip.issues).toEqual([]);
    expect(clip.fillRule).toBe('nonzero');
    expect(clip.paths).toHaveLength(2);
    expect(isCovered(clip, { x: 100, y: 100 })).toBe(true);
    expect(isCovered(clip, { x: 500, y: 100 })).toBe(true);
    expect(isCovered(clip, { x: 300, y: 100 })).toBe(false);
  });

  it('keeps disjoint evenodd curve regions under one authored evenodd clip', () => {
    const visual = singleLayer(
      vectorNode('blob-a', matrix(), [{ fillRule: 'evenodd', contours: [OUTER_BLOB] }]),
      vectorNode('blob-b', matrix(400), [{ fillRule: 'evenodd', contours: [OUTER_BLOB] }]),
    );
    const clip = clipFor(visual);
    expect(clip.issues).toEqual([]);
    expect(compiledClip(clip).rule).toBe('evenodd');
    expect(clip.paths).toHaveLength(2);
    expect(isCovered(clip, { x: 100, y: 100 })).toBe(true);
    expect(isCovered(clip, { x: 500, y: 100 })).toBe(true);
    expect(isCovered(clip, { x: 300, y: 100 })).toBe(false);
  });

  it('degrades an overlapping curve region typed instead of claiming a merge', () => {
    const visual = singleLayer(
      vectorNode('blob-a', matrix(), [{ contours: [OUTER_BLOB] }]),
      vectorNode('blob-b', matrix(100), [{ contours: [OUTER_BLOB] }]),
    );
    const resolution = geometryOf(visual);
    expect(resolution.status).toBe('resolved');
    // Only the first region's bounds are provably disjoint; the second one is
    // locally degraded with a typed issue instead of being merged by sampling.
    expect(resolution.paths).toHaveLength(1);
    expect(resolution.fillRule).toBe('nonzero');
    expect(resolution.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported-curve-fill-rule',
        regionRef: 'blob-b-region-0',
      }),
    ]);
  });

  it('degrades curve regions with mixed evenodd/nonzero rules locally', () => {
    const visual = singleLayer(
      vectorNode('blob-nonzero', matrix(), [{ contours: [OUTER_BLOB] }]),
      vectorNode('blob-evenodd', matrix(400), [{ fillRule: 'evenodd', contours: [OUTER_BLOB] }]),
    );
    const resolution = geometryOf(visual);
    expect(resolution.status).toBe('resolved');
    expect(resolution.fillRule).toBe('nonzero');
    expect(resolution.paths).toHaveLength(1);
    expect(resolution.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported-curve-fill-rule',
        regionRef: 'blob-evenodd-region-0',
      }),
    ]);
  });
});
