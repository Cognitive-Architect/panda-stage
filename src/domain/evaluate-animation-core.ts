import type {
  AnimationClipV0, AnimationInterpolation, AnimationProperty,
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
    const progress = ease(Math.min(1, Math.max(0,
      (timeMs - from.timeMs) / Math.max(1, to.timeMs - from.timeMs),
    )), from.interpolationToNext);
    // Continuous authored rotation; never normalize to the shortest arc.
    return from.value + (to.value - from.value) * progress;
  }
  return track.keys.at(-1)!.value;
}

export function evaluateAnimationClipAtTime(clip: AnimationClipV0, timeMs: number): EvaluatedAnimationValue[] {
  return clip.tracks.map((track) => ({
    target: { ...track.target },
    property: track.property,
    value: evaluateAnimationTrackAtTime(track, timeMs),
  }));
}
