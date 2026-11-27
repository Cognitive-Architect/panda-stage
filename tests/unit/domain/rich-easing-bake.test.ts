import { describe, expect, it } from 'vitest';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  ProjectSchema,
  RICH_EASING_BACK_OVERSHOOT,
  RICH_EASING_DIRECTIONS,
  RICH_EASING_FAMILIES,
  RICH_EASING_PRESETS,
  bakeRichEasingToPropertySegments,
  editAnimationPropertyKey,
  editAnimationPropertyRange,
  evaluateAnimationTrackAtTime,
  evaluateRichEasing,
  evaluateShotAtTime,
  frameTimeMs,
  getRichEasingPropertyApplicability,
  isRichEasingPresetId,
  isValidFrameTime,
  parseRichEasingPresetId,
  richEasingPresetId,
  type AnimationKey,
  type AnimationProperty,
  type LayerAnimationClip,
  type Project,
  type RichEasingDirection,
  type RichEasingFamily,
  type RichEasingPresetId,
} from '../../../src/domain';
import { animationCoreFixture } from '../../helpers/animationCoreFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { IDS } from './testProject';

/** Independent reference implementations of d3-ease / Penner equations. */
function referenceBounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

function referenceRichEasing(
  family: RichEasingFamily,
  direction: RichEasingDirection,
  t: number,
): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = 1.70158;
  const inFn = (u: number): number => {
    switch (family) {
      case 'sin':
        return 1 - Math.cos((u * Math.PI) / 2);
      case 'cubic':
        return Math.pow(u, 3);
      case 'circle':
        return 1 - Math.sqrt(1 - u * u);
      case 'quint':
        return Math.pow(u, 5);
      case 'back':
        return (s + 1) * Math.pow(u, 3) - s * Math.pow(u, 2);
      case 'bounce':
        return 1 - referenceBounceOut(1 - u);
    }
  };
  const outFn = (u: number): number => 1 - inFn(1 - u);
  switch (direction) {
    case 'in':
      return inFn(t);
    case 'out':
      return outFn(t);
    case 'in-out':
      return t < 0.5 ? inFn(2 * t) / 2 : (1 + outFn(2 * t - 1)) / 2;
  }
}

function buildLayerClipProject(options: {
  readonly baseScaleX?: number;
  readonly baseScaleY?: number;
  readonly tracks: Array<{
    readonly property: AnimationProperty;
    readonly keys: AnimationKey[];
  }>;
}): { project: Project; shotId: string; layerId: string } {
  const base = graphicFaceProject();
  const shot = base.shots[0]!;
  const templateLayer = shot.layers.find((entry) => entry.id === IDS.layerAsset)!;
  const baseScaleX = options.baseScaleX ?? 1;
  const baseScaleY = options.baseScaleY ?? 1;
  const clip: LayerAnimationClip = {
    version: 2,
    targetBases: [
      {
        target: { kind: 'layer', layerId: IDS.animationLayer },
        animationId: FACE_GRAPHIC_ID,
        baseTransform: {
          x: 500,
          y: 400,
          scaleX: baseScaleX,
          scaleY: baseScaleY,
          rotationDeg: 0,
        },
        sourceCanvas: { width: 1000, height: 1000 },
        pivot: { space: 'target-local', x: 500, y: 500 },
      },
    ],
    tracks: options.tracks.map((entry) => ({
      target: { kind: 'layer', layerId: IDS.animationLayer },
      property: entry.property,
      keys: entry.keys,
    })),
  };
  const animationLayer = {
    ...templateLayer,
    id: IDS.animationLayer,
    name: 'Animated Graphic',
    source: { kind: 'animation' as const, animationId: FACE_GRAPHIC_ID },
    x: 500,
    y: 400,
    scaleX: baseScaleX,
    scaleY: baseScaleY,
    startTimeMs: 0,
    animationFirstFrame: 2,
    animationPlayback: { mode: 'loop' as const, endBehavior: 'hold' as const },
    animationClip: clip,
  };
  const project = ProjectSchema.parse({
    ...base,
    shots: base.shots.map((entry) =>
      entry.id === shot.id
        ? {
            ...entry,
            layers: [...entry.layers, animationLayer],
            timelineEvents: [
              ...entry.timelineEvents,
              {
                id: '81000000-0000-4000-8000-000000000001',
                layerId: IDS.animationLayer,
                type: 'graphic-frame' as const,
                startMs: 250,
                endMs: 250,
                animationId: FACE_GRAPHIC_ID,
                sourceFrameIndex: base.animations[0]!.source.startFrameIndex,
              },
              {
                id: '81000000-0000-4000-8000-000000000002',
                layerId: IDS.animationLayer,
                type: 'opacity' as const,
                startMs: 0,
                endMs: 1000,
                from: 0.2,
                to: 1,
                easing: 'ease-in-out' as const,
              },
            ],
          }
        : entry,
    ),
  });
  return { project, shotId: shot.id, layerId: IDS.animationLayer };
}

describe('pure rich easing math (AN-PROD-C01)', () => {
  it('exposes all 6 families x 3 directions with metadata and helpers', () => {
    expect(RICH_EASING_FAMILIES).toEqual(['sin', 'cubic', 'circle', 'quint', 'back', 'bounce']);
    expect(RICH_EASING_DIRECTIONS).toEqual(['in', 'out', 'in-out']);
    expect(RICH_EASING_PRESETS).toHaveLength(18);
    expect(RICH_EASING_BACK_OVERSHOOT).toBe(1.70158);
    for (const family of RICH_EASING_FAMILIES) {
      for (const direction of RICH_EASING_DIRECTIONS) {
        const id = richEasingPresetId(family, direction);
        expect(isRichEasingPresetId(id)).toBe(true);
        expect(parseRichEasingPresetId(id)).toEqual({ family, direction });
      }
    }
    expect(isRichEasingPresetId('elastic-in')).toBe(false);
    expect(isRichEasingPresetId('')).toBe(false);
  });

  const samplePoints = [0, 0.05, 0.1, 0.2, 0.25, 1 / 3, 0.4, 0.5, 0.6, 2 / 3, 0.75, 0.85, 0.95, 1];

  it.each(RICH_EASING_PRESETS.map((meta) => [meta.id, meta.family, meta.direction] as const))(
    'matches independent formula and exact endpoints for %s',
    (presetId, family, direction) => {
      const atZero = evaluateRichEasing(presetId, 0);
      const atOne = evaluateRichEasing(presetId, 1);
      expect(Object.is(atZero, 0)).toBe(true);
      expect(Object.is(atOne, 1)).toBe(true);
      expect(Object.is(evaluateRichEasing(presetId, -0), 0)).toBe(true);
      expect(evaluateRichEasing(presetId, -0.5)).toBe(0);
      expect(evaluateRichEasing(presetId, 1.5)).toBe(1);

      for (const t of samplePoints) {
        const actual = evaluateRichEasing(presetId, t);
        const expected = referenceRichEasing(family, direction, t);
        expect(Number.isFinite(actual)).toBe(true);
        expect(Object.is(actual, -0)).toBe(false);
        expect(actual).toBeCloseTo(expected, 12);
      }
    },
  );

  it('preserves true overshoot outside [0, 1] on back family without clamping', () => {
    expect(evaluateRichEasing('back-in', 0.35)).toBeLessThan(0);
    expect(evaluateRichEasing('back-out', 0.65)).toBeGreaterThan(1);
    expect(evaluateRichEasing('back-in-out', 0.2)).toBeLessThan(0);
    expect(evaluateRichEasing('back-in-out', 0.8)).toBeGreaterThan(1);
  });

  it('exhibits expected bounce rebound valleys inside [0, 1]', () => {
    // At 6/11 (~0.5455), bounce-out hits its first rebound peak/valley of 0.75,
    // which is lower than the hit at 4/11 (~0.3636) where it reached 1.0.
    const hit1 = evaluateRichEasing('bounce-out', 4 / 11);
    const valley1 = evaluateRichEasing('bounce-out', 6 / 11);
    const hit2 = evaluateRichEasing('bounce-out', 8 / 11);
    const valley2 = evaluateRichEasing('bounce-out', 9 / 11);
    expect(hit1).toBeCloseTo(1, 12);
    expect(valley1).toBeCloseTo(0.75, 12);
    expect(valley1).toBeLessThan(hit1);
    expect(hit2).toBeCloseTo(1, 12);
    expect(valley2).toBeCloseTo(0.9375, 12);
    expect(valley2).toBeLessThan(hit2);

    // bounce-in rebounds near the start (mirror of bounce-out)
    expect(evaluateRichEasing('bounce-in', 1 - 6 / 11)).toBeCloseTo(0.25, 12);
    expect(evaluateRichEasing('bounce-in', 1 - 4 / 11)).toBeCloseTo(0, 12);

    // bounce-in-out has rebounds in both halves
    expect(evaluateRichEasing('bounce-in-out', 0.5)).toBeCloseTo(0.5, 12);
    expect(evaluateRichEasing('bounce-in-out', (1 - 6 / 11) / 2)).toBeCloseTo(0.125, 12);
    expect(evaluateRichEasing('bounce-in-out', 0.5 + (6 / 11) / 2)).toBeCloseTo(0.875, 12);
  });

  it('rejects non-finite progress or unknown preset IDs', () => {
    expect(() => evaluateRichEasing('cubic-in', Number.NaN)).toThrow(RangeError);
    expect(() => evaluateRichEasing('cubic-in', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() =>
      evaluateRichEasing('invalid-preset' as RichEasingPresetId, 0.5),
    ).toThrow(RangeError);
  });
});

describe('bakeRichEasingToPropertySegments (AN-PROD-C01)', () => {
  it('samples on formal 24 FPS frame grid (41->42ms quantization, non-zero start, and short segments)', () => {
    const { project, shotId, layerId } = buildLayerClipProject({
      tracks: [
        {
          property: 'transform.offsetX',
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'ease-in', curveToNext: { bezier: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } } },
            { timeMs: 125, value: 120, interpolationToNext: 'ease-out' },
            { timeMs: 167, value: 160, interpolationToNext: 'ease-in-out' }, // 1-frame short segment (frame 3 -> frame 4)
            { timeMs: 500, value: 400, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const target = { kind: 'layer' as const, layerId };

    // 1) Segment 0 -> 125ms (frames 0..3): intermediate frames must be 42ms and 83ms (never 41ms).
    const firstBake = bakeRichEasingToPropertySegments(project, {
      shotId,
      target,
      property: 'transform.offsetX',
      presetId: 'cubic-out',
      keyTimesMs: [0, 125],
    });
    expect(firstBake.bakedSegments).toBe(1);
    expect(firstBake.insertedKeys).toBe(2);
    expect(firstBake.preservedAnchorTimesMs).toEqual([0, 125]);
    const trackAfterFirst = firstBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks[0]!;
    expect(trackAfterFirst.keys.map((key) => key.timeMs)).toEqual([0, 42, 83, 125, 167, 500]);
    for (const key of trackAfterFirst.keys) {
      expect(isValidFrameTime(key.timeMs)).toBe(true);
    }
    // Replaced curveToNext cleared on baked segment start (0ms), linear interpolation inside
    expect(trackAfterFirst.keys[0]).toEqual({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
    expect(trackAfterFirst.keys[1]!.value).toBeCloseTo(120 * evaluateRichEasing('cubic-out', 42 / 125), 10);
    expect(trackAfterFirst.keys[2]!.value).toBeCloseTo(120 * evaluateRichEasing('cubic-out', 83 / 125), 10);
    // External segment starting at 125ms is untouched
    expect(trackAfterFirst.keys[3]).toEqual({ timeMs: 125, value: 120, interpolationToNext: 'ease-out' });

    // 2) Short 1-frame segment 125 -> 167ms (frame 3 -> frame 4): no intermediate grid frames,
    // preserves endpoints without fabricating off-grid keys, clears segment easing to linear.
    const shortBake = bakeRichEasingToPropertySegments(firstBake.project, {
      shotId,
      target,
      property: 'transform.offsetX',
      presetId: 'bounce-out',
      keyTimesMs: [125, 167],
    });
    expect(shortBake.bakedSegments).toBe(1);
    expect(shortBake.insertedKeys).toBe(0);
    expect(shortBake.preservedAnchorTimesMs).toEqual([125, 167]);
    const trackAfterShort = shortBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks[0]!;
    expect(trackAfterShort.keys.map((key) => key.timeMs)).toEqual([0, 42, 83, 125, 167, 500]);
    expect(trackAfterShort.keys[3]).toEqual({ timeMs: 125, value: 120, interpolationToNext: 'linear' });
    expect(trackAfterShort.keys[4]).toEqual({ timeMs: 167, value: 160, interpolationToNext: 'ease-in-out' });

    // 3) Non-zero start segment 167 -> 500ms (frame 4 -> frame 12): frames 5..11 inserted
    const nonZeroBake = bakeRichEasingToPropertySegments(shortBake.project, {
      shotId,
      target,
      property: 'transform.offsetX',
      presetId: 'sin-in-out',
      keyTimesMs: [167, 500],
    });
    expect(nonZeroBake.insertedKeys).toBe(7); // frames 5, 6, 7, 8, 9, 10, 11
    const trackAfterNonZero = nonZeroBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks[0]!;
    const expectedNonZeroTimes = [5, 6, 7, 8, 9, 10, 11].map((frame) => frameTimeMs(frame));
    for (const timeMs of expectedNonZeroTimes) {
      const bakedKey = trackAfterNonZero.keys.find((key) => key.timeMs === timeMs)!;
      expect(bakedKey).toBeDefined();
      expect(bakedKey.interpolationToNext).toBe('linear');
      const u = (timeMs - 167) / (500 - 167);
      expect(bakedKey.value).toBeCloseTo(160 + (400 - 160) * evaluateRichEasing('sin-in-out', u), 10);
    }
  });

  it('preserves manual anchor keyframes across multi-segment selection and leaves external segments, properties, 0ms base, events, and Graphic frame selection untouched', () => {
    const externalCurve = { bezier: { x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.95 } };
    const { project, shotId, layerId } = buildLayerClipProject({
      tracks: [
        {
          property: 'transform.offsetX',
          keys: [
            { timeMs: 0, value: 10, interpolationToNext: 'ease-in', curveToNext: externalCurve },
            { timeMs: 250, value: 100, interpolationToNext: 'ease-out', curveToNext: { bezier: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 } } },
            { timeMs: 500, value: 220, interpolationToNext: 'step' },
            { timeMs: 750, value: 50, interpolationToNext: 'ease-in-out', curveToNext: externalCurve },
            { timeMs: 1000, value: 300, interpolationToNext: 'linear' },
          ],
        },
        {
          property: 'transform.offsetY',
          keys: [
            { timeMs: 0, value: -20, interpolationToNext: 'ease-in', curveToNext: externalCurve },
            { timeMs: 1000, value: 80, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const beforeSnapshot = structuredClone(project);
    const target = { kind: 'layer' as const, layerId };

    // Bake multi-key selection [250, 500, 750] (two adjacent segments: 250->500 and 500->750)
    const result = bakeRichEasingToPropertySegments(project, {
      shotId,
      target,
      property: 'transform.offsetX',
      presetId: 'quint-in-out',
      keyTimesMs: [250, 500, 750],
    });

    // Original project was not mutated
    expect(project).toEqual(beforeSnapshot);

    expect(result.bakedSegments).toBe(2);
    expect(result.preservedAnchorTimesMs).toEqual([250, 500, 750]);

    const shot = result.project.shots[0]!;
    const layer = shot.layers.find((entry) => entry.id === layerId)!;
    const xTrack = layer.animationClip!.tracks.find((t) => t.property === 'transform.offsetX')!;
    const yTrack = layer.animationClip!.tracks.find((t) => t.property === 'transform.offsetY')!;

    // 0ms base key & pre-selection external segment (0->250) completely preserved
    expect(xTrack.keys[0]).toEqual({ timeMs: 0, value: 10, interpolationToNext: 'ease-in', curveToNext: externalCurve });
    // Post-selection external segment (750->1000) completely preserved
    const key750 = xTrack.keys.find((k) => k.timeMs === 750)!;
    expect(key750).toEqual({ timeMs: 750, value: 50, interpolationToNext: 'ease-in-out', curveToNext: externalCurve });
    expect(xTrack.keys.at(-1)).toEqual({ timeMs: 1000, value: 300, interpolationToNext: 'linear' });

    // Manual anchor at 500ms preserved with exact value 220, baked outgoing segment uses linear without curveToNext
    const key500 = xTrack.keys.find((k) => k.timeMs === 500)!;
    expect(key500).toEqual({ timeMs: 500, value: 220, interpolationToNext: 'linear' });
    const key250 = xTrack.keys.find((k) => k.timeMs === 250)!;
    expect(key250).toEqual({ timeMs: 250, value: 100, interpolationToNext: 'linear' });

    // Midpoints of both segments match quint-in-out evaluated separately on each segment
    expect(evaluateAnimationTrackAtTime(xTrack, 375)).toBeCloseTo(
      100 + (220 - 100) * evaluateRichEasing('quint-in-out', 0.5),
      10,
    );
    expect(evaluateAnimationTrackAtTime(xTrack, 625)).toBeCloseTo(
      220 + (50 - 220) * evaluateRichEasing('quint-in-out', 0.5),
      10,
    );

    // Other property track untouched
    expect(yTrack).toEqual(beforeSnapshot.shots[0]!.layers.find((entry) => entry.id === layerId)!.animationClip!.tracks[1]);
    // Target basis, timeline events (opacity + graphic-frame), source assets, and Graphic playback untouched
    expect(layer.animationClip!.targetBases).toEqual(
      beforeSnapshot.shots[0]!.layers.find((entry) => entry.id === layerId)!.animationClip!.targetBases,
    );
    expect(shot.timelineEvents).toEqual(beforeSnapshot.shots[0]!.timelineEvents);
    expect(layer.animationFirstFrame).toBe(2);
    expect(layer.animationPlayback).toEqual({ mode: 'loop', endBehavior: 'hold' });
    expect(result.project.assets).toEqual(beforeSnapshot.assets);
    expect(result.project.animations).toEqual(beforeSnapshot.animations);
  });

  it('supports post-bake manual key editing and evaluates smoothly through standard track evaluator', () => {
    const { project, shotId, layerId } = buildLayerClipProject({
      tracks: [
        {
          property: 'transform.rotationDeg',
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' },
            { timeMs: 500, value: 90, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const target = { kind: 'layer' as const, layerId };
    const baked = bakeRichEasingToPropertySegments(project, {
      shotId,
      target,
      property: 'transform.rotationDeg',
      presetId: 'back-out',
      keyTimesMs: [0, 500],
    });

    // Verify true back overshoot is preserved on rotation (> 90 deg)
    const bakedTrack = baked.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks[0]!;
    const maxRotation = Math.max(...bakedTrack.keys.map((k) => k.value));
    expect(maxRotation).toBeGreaterThan(90);

    // Manually edit one baked key at 250ms and verify evaluation reflects the manual edit
    const manuallyEdited = editAnimationPropertyKey(
      baked.project,
      { shotId, target, property: 'transform.rotationDeg', keyTimeMs: 250 },
      { value: 135 },
    );
    const evaluated = evaluateShotAtTime(manuallyEdited.shots[0]!, 250, manuallyEdited);
    const evaluatedLayer = evaluated.layers.find((entry) => entry.id === layerId)!;
    expect(evaluatedLayer.rotationDeg).toBeCloseTo(135, 10);

    // Round-trip through JSON + ProjectSchema without any extra schema fields
    const reparsed = ProjectSchema.parse(JSON.parse(JSON.stringify(manuallyEdited)));
    expect(reparsed).toEqual(manuallyEdited);
  });

  it('handles scale legal bounds per property for both layer clips and character-part clips while preserving endpoints and non-scale overshoot', () => {
    // 1) Layer clip v2: baseScaleX = 1.0, scaleX from 0.06 -> 2.0 with back-in
    //    back-in overshoots negative, which would violate LAYER_MIN_SCALE (0.05).
    //    Intermediate samples must clamp to legal [0.05, 20] while endpoints stay 0.06 and 2.0.
    const { project, shotId, layerId } = buildLayerClipProject({
      baseScaleX: 1,
      baseScaleY: 1,
      tracks: [
        {
          property: 'transform.scaleX',
          keys: [
            { timeMs: 0, value: 0.06, interpolationToNext: 'linear' },
            { timeMs: 500, value: 2.0, interpolationToNext: 'linear' },
          ],
        },
        {
          property: 'transform.offsetX',
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' },
            { timeMs: 500, value: 100, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const layerTarget = { kind: 'layer' as const, layerId };

    const scaleBake = bakeRichEasingToPropertySegments(project, {
      shotId,
      target: layerTarget,
      property: 'transform.scaleX',
      presetId: 'back-in',
      keyTimesMs: [0, 500],
    });
    expect(scaleBake.clampedScaleSamples).toBeGreaterThan(0);
    const scaleTrack = scaleBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks.find((t) => t.property === 'transform.scaleX')!;
    expect(scaleTrack.keys[0]!.value).toBe(0.06);
    expect(scaleTrack.keys.at(-1)!.value).toBe(2.0);
    for (const key of scaleTrack.keys) {
      expect(Number.isFinite(key.value)).toBe(true);
      expect(key.value).toBeGreaterThanOrEqual(LAYER_MIN_SCALE);
      expect(key.value).toBeLessThanOrEqual(LAYER_MAX_SCALE);
    }
    // Unrelated offsetX track untouched
    const offsetTrackBefore = project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks.find((t) => t.property === 'transform.offsetX')!;
    const offsetTrackAfter = scaleBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks.find((t) => t.property === 'transform.offsetX')!;
    expect(offsetTrackAfter).toEqual(offsetTrackBefore);

    // 2) Position offsetX with back-in DOES preserve negative overshoot (not clamped)
    const offsetBake = bakeRichEasingToPropertySegments(scaleBake.project, {
      shotId,
      target: layerTarget,
      property: 'transform.offsetX',
      presetId: 'back-in',
      keyTimesMs: [0, 500],
    });
    expect(offsetBake.clampedScaleSamples).toBe(0);
    const bakedOffsetTrack = offsetBake.project.shots[0]!.layers
      .find((entry) => entry.id === layerId)!
      .animationClip!.tracks.find((t) => t.property === 'transform.offsetX')!;
    expect(Math.min(...bakedOffsetTrack.keys.map((k) => k.value))).toBeLessThan(0);

    // 3) Character-part clip v1: scaleY from 1.0 -> 19.8 with back-out clamps upper overshoot to CHARACTER_PART_MAX_SCALE (20)
    const partFixture = animationCoreFixture();
    const partLayer = partFixture.project.shots[0]!.layers.find((entry) => entry.id === partFixture.layerId)!;
    const partTarget = partLayer.animationClip!.tracks[0]!.target;
    const partProject = ProjectSchema.parse({
      ...partFixture.project,
      shots: partFixture.project.shots.map((shot, idx) =>
        idx === 0
          ? {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === partFixture.layerId
                  ? {
                      ...layer,
                      animationClip: {
                        ...layer.animationClip!,
                        tracks: [
                          ...layer.animationClip!.tracks,
                          {
                            target: partTarget,
                            property: 'transform.scaleY' as const,
                            keys: [
                              { timeMs: 0, value: 1.0, interpolationToNext: 'linear' as const },
                              { timeMs: 500, value: 19.8, interpolationToNext: 'linear' as const },
                            ],
                          },
                        ],
                      },
                    }
                  : layer,
              ),
            }
          : shot,
      ),
    });

    const partScaleBake = bakeRichEasingToPropertySegments(partProject, {
      shotId: IDS.shot,
      target: partTarget,
      property: 'transform.scaleY',
      presetId: 'back-out',
      keyTimesMs: [0, 500],
    });
    expect(partScaleBake.clampedScaleSamples).toBeGreaterThan(0);
    const partScaleTrack = partScaleBake.project.shots[0]!.layers
      .find((entry) => entry.id === partFixture.layerId)!
      .animationClip!.tracks.find((t) => t.property === 'transform.scaleY')!;
    expect(partScaleTrack.keys[0]!.value).toBe(1.0);
    expect(partScaleTrack.keys.at(-1)!.value).toBe(19.8);
    for (const key of partScaleTrack.keys) {
      expect(key.value).toBeGreaterThanOrEqual(CHARACTER_PART_MIN_SCALE);
      expect(key.value).toBeLessThanOrEqual(CHARACTER_PART_MAX_SCALE);
    }
  });

  it('marks opacity explicitly locally inapplicable and never creates an opacity track or fakes linear success', () => {
    const check = getRichEasingPropertyApplicability('opacity', 'bounce-out');
    expect(check.applicable).toBe(false);
    expect(check.reason).toBeTruthy();
    expect(getRichEasingPropertyApplicability('transform.offsetX', 'bounce-out')).toEqual({
      applicable: true,
    });

    const { project, shotId, layerId } = buildLayerClipProject({
      tracks: [
        {
          property: 'transform.offsetX',
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' },
            { timeMs: 500, value: 100, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const before = structuredClone(project);

    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target: { kind: 'layer', layerId },
        property: 'opacity',
        presetId: 'bounce-out',
        keyTimesMs: [0, 1000],
      }),
    ).toThrow(check.reason);
    expect(project).toEqual(before);
  });

  it('rejects locked layers, missing/stale keys, off-grid keys, duplicate keys, and unknown shots/tracks atomically', () => {
    const { project, shotId, layerId } = buildLayerClipProject({
      tracks: [
        {
          property: 'transform.offsetX',
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' },
            { timeMs: 500, value: 100, interpolationToNext: 'linear' },
          ],
        },
      ],
    });
    const target = { kind: 'layer' as const, layerId };

    // Locked layer
    const lockedProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === layerId ? { ...layer, locked: true } : layer,
        ),
      })),
    });
    expect(() =>
      bakeRichEasingToPropertySegments(lockedProject, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0, 500],
      }),
    ).toThrow('不可编辑');

    // Stale / missing keyframe
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0, 250],
      }),
    ).toThrow('关键帧已不存在');

    // Off-grid timestamp (41ms is not on 24fps grid)
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0, 41],
      }),
    ).toThrow('有效帧网格');

    // Duplicate timestamps
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0, 0],
      }),
    ).toThrow('重复时间戳');

    // Single keyframe only
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0],
      }),
    ).toThrow('至少选择两个关键帧');

    // Missing property track
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetY',
        presetId: 'cubic-in',
        keyTimesMs: [0, 500],
      }),
    ).toThrow('属性轨道已不存在');

    // Unknown shot
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId: '50000000-0000-4000-8000-000000000099',
        target,
        property: 'transform.offsetX',
        presetId: 'cubic-in',
        keyTimesMs: [0, 500],
      }),
    ).toThrow('不可编辑');

    // Invalid preset
    expect(() =>
      bakeRichEasingToPropertySegments(project, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'elastic-out' as RichEasingPresetId,
        keyTimesMs: [0, 500],
      }),
    ).toThrow('不支持的高级缓动预设');
  });
});

it('fills only vacant frames without changing the trajectory, and requires explicit overwrite for a property range', () => {
  const xKeys: AnimationKey[] = [
    { timeMs: 0, value: 0, interpolationToNext: 'ease-in-out' },
    { timeMs: 500, value: 40, interpolationToNext: 'step' },
    { timeMs: 1000, value: 30, interpolationToNext: 'linear' },
  ];
  const yKeys: AnimationKey[] = [{ timeMs: 0, value: 9, interpolationToNext: 'linear' }];
  const { project, shotId, layerId } = buildLayerClipProject({
    tracks: [
      { property: 'transform.offsetX', keys: xKeys }, { property: 'transform.offsetY', keys: yKeys },
    ],
  });
  const address = { shotId, target: { kind: 'layer' as const, layerId }, property: 'transform.offsetX' as const };
  const tracks = (state: Project) => state.shots.find(({ id }) => id === shotId)!.layers
    .find(({ id }) => id === layerId)!.animationClip!.tracks;
  const filled = editAnimationPropertyRange(project, address, { kind: 'insert', startMs: 0, endMs: 1000, count: 4 });
  const [x, y] = tracks(filled);
  expect(y!.keys).toEqual(yKeys);
  expect(x!.keys).toHaveLength(7);
  expect(x!.keys.every(({ timeMs }) => isValidFrameTime(timeMs))).toBe(true);
  for (let frame = 0; frame <= 28; frame++) {
    const time = frameTimeMs(frame);
    expect(evaluateAnimationTrackAtTime(x!, time)).toBeCloseTo(evaluateAnimationTrackAtTime({ keys: xKeys }, time), 6);
  }
  expect(() => editAnimationPropertyRange(project, address,
    { kind: 'paste', timeMs: 500, keys: xKeys.slice(0, 2), overwrite: false })).toThrow();
  expect(() => editAnimationPropertyRange(project, address,
    { kind: 'paste', timeMs: 0, keys: xKeys.slice(0, 2), overwrite: true })).toThrow();
  const pasted = editAnimationPropertyRange(project, address,
    { kind: 'paste', timeMs: 500, keys: xKeys.slice(0, 2), overwrite: true });
  const pastedTrack = tracks(pasted)[0]!;
  expect(pastedTrack.keys.filter(({ timeMs }) => timeMs >= 500 && timeMs <= 1000))
    .toMatchObject([{ timeMs: 500, value: 0, interpolationToNext: 'ease-in-out' }, { timeMs: 1000, value: 40 }]);
  expect(pastedTrack.keys[0]).toMatchObject({ timeMs: 0, value: 0 });
  expect(tracks(pasted)[1]!.keys).toEqual(yKeys);
  for (const frame of [0, 1, 4, 10, 11, 25, 26, 28]) {
    const time = frameTimeMs(frame);
    expect(evaluateAnimationTrackAtTime(pastedTrack, time)).toBeCloseTo(evaluateAnimationTrackAtTime({ keys: xKeys }, time), 6);
  }
  const deleted = editAnimationPropertyRange(filled, address, { kind: 'delete', startMs: 0, endMs: 500 });
  expect(tracks(deleted)[0]!.keys.filter(({ timeMs }) => timeMs <= 500).map(({ timeMs }) => timeMs)).toEqual([0, 500]);
});
