import type {
  AnimationBezier, AnimationClip, AnimationCurve, AnimationInterpolation, AnimationProperty,
  AnimationTargetRef, AnimationTrack,
} from './models/animationCore';

export interface EvaluatedAnimationValue {
  target: AnimationTargetRef;
  property: AnimationProperty;
  value: number;
}

/** Easing formulas ported from PR #979 @ c20bb25 (outgoing key semantics). */
function ease(progress: number, interpolation: AnimationInterpolation): number {
  switch (interpolation) {
    case 'step': return progress < 1 ? 0 : 1;
    case 'linear': return progress;
    case 'ease-in': return progress * progress;
    case 'ease-out': return 1 - (1 - progress) * (1 - progress);
    case 'ease-in-out': return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }
}

export const DEFAULT_ANIMATION_BEZIER: AnimationBezier = {
  x1: 1 / 3,
  y1: 1 / 3,
  x2: 2 / 3,
  y2: 2 / 3,
};

export interface InspectedAnimationCurve {
  hasWindow: boolean;
  isDirectCubic: boolean;
  equivalentBezier: AnimationBezier | null;
  canDragHandles: boolean;
}

function bezierAxis(time: number, first: number, second: number): number {
  return 3 * (1 - time) ** 2 * time * first + 3 * (1 - time) * time ** 2 * second + time ** 3;
}

function solveBezierTimeForX(targetX: number, x1: number, x2: number, iterations = 24): number {
  if (targetX <= 0) return 0;
  if (targetX >= 1) return 1;
  let min = 0;
  let max = 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const midpoint = (min + max) / 2;
    if (bezierAxis(midpoint, x1, x2) < targetX) min = midpoint;
    else max = midpoint;
  }
  return (min + max) / 2;
}

function evaluateBezier(progress: number, handles: AnimationBezier): number {
  if (progress <= 0 || progress >= 1) return progress;
  return bezierAxis(solveBezierTimeForX(progress, handles.x1, handles.x2, 24), handles.y1, handles.y2);
}

function subdivideCubic1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
): [number, number, number, number] {
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // Split [0, 1] at t0 -> right segment covering [t0, 1].
  const r01 = lerp(p0, p1, t0);
  const r12 = lerp(p1, p2, t0);
  const r23 = lerp(p2, p3, t0);
  const r012 = lerp(r01, r12, t0);
  const r123 = lerp(r12, r23, t0);
  const r0 = lerp(r012, r123, t0);
  const r1 = r123;
  const r2 = r23;
  const r3 = p3;
  // Split [t0, 1] at s = (t1 - t0) / (1 - t0) -> left segment covering [t0, t1].
  const s = t0 >= 1 ? 1 : (t1 - t0) / (1 - t0);
  const q01 = lerp(r0, r1, s);
  const q12 = lerp(r1, r2, s);
  const q23 = lerp(r2, r3, s);
  const q012 = lerp(q01, q12, s);
  const q123 = lerp(q12, q23, s);
  const q3 = lerp(q012, q123, s);
  return [r0, q01, q012, q3];
}

function snapUnitBoundary(value: number): number {
  if (Math.abs(value) <= 1e-7) return 0;
  if (Math.abs(value - 1) <= 1e-7) return 1;
  return value;
}

function extractSubBezier(base: AnimationBezier, w0: number, w1: number): AnimationBezier | null {
  const t0 = solveBezierTimeForX(w0, base.x1, base.x2, 48);
  const t1 = solveBezierTimeForX(w1, base.x1, base.x2, 48);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0 + 1e-12) return null;
  const [qx0, qx1, qx2, qx3] = subdivideCubic1D(0, base.x1, base.x2, 1, t0, t1);
  const [qy0, qy1, qy2, qy3] = subdivideCubic1D(0, base.y1, base.y2, 1, t0, t1);
  const dx = qx3 - qx0;
  const dy = qy3 - qy0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 1e-9 || dy <= 1e-9) return null;
  const x1 = snapUnitBoundary((qx1 - qx0) / dx);
  const y1 = snapUnitBoundary((qy1 - qy0) / dy);
  const x2 = snapUnitBoundary((qx2 - qx0) / dx);
  const y2 = snapUnitBoundary((qy2 - qy0) / dy);
  if (
    !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2) ||
    x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1 ||
    x1 > x2
  ) {
    return null;
  }
  return { x1, y1, x2, y2 };
}

/**
 * Return normalized cubic Bézier handles mathematically equivalent to the evaluated easing,
 * or `null` when the curve (e.g. `step`, `ease-in-out`, or non-cubic/out-of-range `curve.window`)
 * cannot be represented exactly as a single unit-square cubic Bézier.
 */
export function extractEquivalentCubicBezier(
  interpolation: AnimationInterpolation,
  curve?: AnimationCurve,
): AnimationBezier | null {
  if (!curve) {
    switch (interpolation) {
      case 'linear': return { ...DEFAULT_ANIMATION_BEZIER };
      case 'ease-in': return { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 };
      case 'ease-out': return { x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 };
      case 'ease-in-out':
      case 'step':
        return null;
    }
  }
  if (!curve.window) {
    return curve.bezier ? { ...curve.bezier } : extractEquivalentCubicBezier(interpolation);
  }
  const [w0, w1] = curve.window;
  if (!Number.isFinite(w0) || !Number.isFinite(w1) || w0 < 0 || w1 > 1 || w0 >= w1) return null;

  let candidate: AnimationBezier | null;
  if (curve.bezier) {
    candidate = extractSubBezier(curve.bezier, w0, w1);
  } else if (interpolation === 'linear') {
    candidate = { ...DEFAULT_ANIMATION_BEZIER };
  } else if (interpolation === 'ease-in') {
    candidate = extractSubBezier({ x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 }, w0, w1);
  } else if (interpolation === 'ease-out') {
    candidate = extractSubBezier({ x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 }, w0, w1);
  } else if (interpolation === 'ease-in-out') {
    if (w1 <= 0.5) {
      candidate = extractSubBezier({ x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 }, w0 * 2, w1 * 2);
    } else if (w0 >= 0.5) {
      candidate = extractSubBezier({ x1: 1 / 3, y1: 2 / 3, x2: 2 / 3, y2: 1 }, (w0 - 0.5) * 2, (w1 - 0.5) * 2);
    } else {
      return null;
    }
  } else {
    return null;
  }
  if (!candidate) return null;

  // Verify numerical equivalence against formal evaluation.
  for (const probe of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const expected = evaluateAnimationEase(probe, interpolation, curve);
    const actual = evaluateBezier(probe, candidate);
    if (Math.abs(actual - expected) > 1e-4) return null;
  }
  return candidate;
}

export function inspectAnimationCurve(
  interpolation: AnimationInterpolation,
  curve?: AnimationCurve,
): InspectedAnimationCurve {
  const hasWindow = Boolean(curve?.window);
  const isDirectCubic = Boolean(curve?.bezier && !hasWindow);
  const equivalentBezier = extractEquivalentCubicBezier(interpolation, curve);
  return {
    hasWindow,
    isDirectCubic,
    equivalentBezier,
    canDragHandles: equivalentBezier !== null,
  };
}

export function sampleAnimationEaseCurve(
  interpolation: AnimationInterpolation,
  curve?: AnimationCurve,
  steps = 64,
): ReadonlyArray<{ x: number; y: number }> {
  const count = Math.max(1, Math.round(steps));
  return Array.from({ length: count + 1 }, (_, index) => {
    const x = index / count;
    return { x, y: evaluateAnimationEase(x, interpolation, curve) };
  });
}

export function evaluateAnimationEase(progress: number, interpolation: AnimationInterpolation, curve?: AnimationCurve): number {
  if (!curve) return ease(progress, interpolation);
  if (progress <= 0 || progress >= 1) return progress;
  const sample = (time: number): number => curve.bezier ? evaluateBezier(time, curve.bezier) : ease(time, interpolation);
  if (!curve.window) return sample(progress);
  const [start, end] = curve.window;
  const startValue = sample(start);
  const length = sample(end) - startValue;
  return length > 0 ? (sample(start + progress * (end - start)) - startValue) / length : 0;
}

/** Compose windows of an existing easing without altering its original handle shape. */
export function sliceAnimationCurve(curve: AnimationCurve | undefined, from: number, to: number): AnimationCurve {
  const [start, end] = curve?.window ?? [0, 1];
  const span = end - start;
  return { ...curve, window: [start + from * span, start + to * span] };
}

/** Evaluate a validated track at absolute Shot time, without playback state. */
export function evaluateAnimationTrackAtTime(track: Pick<AnimationTrack, 'keys'>, requestedTimeMs: number): number {
  const timeMs = Number.isFinite(requestedTimeMs)
    ? Math.max(0, Math.round(requestedTimeMs)) : 0;
  const first = track.keys[0]!;
  if (timeMs <= first.timeMs) return first.value;
  for (let index = 0; index < track.keys.length - 1; index += 1) {
    const from = track.keys[index]!;
    const to = track.keys[index + 1]!;
    if (timeMs > to.timeMs) continue;
    // Exact keys retain their authored value even across a step boundary.
    if (timeMs === to.timeMs) return to.value;
    const progress = evaluateAnimationEase(Math.min(1, Math.max(0,
      (timeMs - from.timeMs) / Math.max(1, to.timeMs - from.timeMs),
    )), from.interpolationToNext, from.curveToNext);
    // Continuous authored rotation; never normalize to the shortest arc.
    return from.value + (to.value - from.value) * progress;
  }
  return track.keys.at(-1)!.value;
}

export function evaluateAnimationClipAtTime(clip: AnimationClip, timeMs: number): EvaluatedAnimationValue[] {
  return clip.tracks.map((track) => ({
    target: { ...track.target },
    property: track.property,
    value: evaluateAnimationTrackAtTime(track, timeMs),
  }));
}
