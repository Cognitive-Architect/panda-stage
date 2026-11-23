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

function evaluateBezier(progress: number, handles: AnimationBezier): number {
  if (progress <= 0 || progress >= 1) return progress;
  const axis = (time: number, first: number, second: number): number =>
    3 * (1 - time) ** 2 * time * first + 3 * (1 - time) * time ** 2 * second + time ** 3;
  let min = 0;
  let max = 1;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const midpoint = (min + max) / 2;
    if (axis(midpoint, handles.x1, handles.x2) < progress) min = midpoint;
    else max = midpoint;
  }
  return axis((min + max) / 2, handles.y1, handles.y2);
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
export function evaluateAnimationTrackAtTime(track: AnimationTrack, requestedTimeMs: number): number {
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
