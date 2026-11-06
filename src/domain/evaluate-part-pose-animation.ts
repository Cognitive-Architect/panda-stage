import type {
  PartPoseAnimation,
  PartPoseEasing,
  PartPoseKeyframe,
} from './models/pose-animation';

export interface EvaluatedPartPose {
  partId: string;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function ease(progress: number, easing: PartPoseEasing): number {
  switch (easing) {
    case 'step':
      return progress < 1 ? 0 : 1;
    case 'linear':
      return progress;
    case 'ease-in':
      return progress * progress;
    case 'ease-out':
      return 1 - (1 - progress) * (1 - progress);
    case 'ease-in-out':
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }
}

function evaluateTrack(
  track: PartPoseAnimation['tracks'][number],
  timeMs: number,
): EvaluatedPartPose {
  const keys = track.keys;
  const first = keys[0]!;
  if (timeMs <= first.timeMs) {
    return { partId: track.partId, ...firstPose(first) };
  }

  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index]!;
    const to = keys[index + 1]!;
    const startMs = from.timeMs;
    const endMs = to.timeMs;
    if (timeMs > endMs) continue;
    const rawProgress = Math.min(
      1,
      Math.max(0, (timeMs - startMs) / Math.max(1, endMs - startMs)),
    );
    const progress = ease(rawProgress, from.easingToNext);
    return {
      partId: track.partId,
      offsetX: interpolate(from.offsetX, to.offsetX, progress),
      offsetY: interpolate(from.offsetY, to.offsetY, progress),
      // Angles are authored as continuous values; do not wrap across ±180°.
      rotationDeg: interpolate(from.rotationDeg, to.rotationDeg, progress),
      scale: interpolate(from.scale, to.scale, progress),
    };
  }

  const last = keys.at(-1)!;
  return { partId: track.partId, ...firstPose(last) };
}

function firstPose(key: PartPoseKeyframe): Omit<EvaluatedPartPose, 'partId'> {
  return {
    offsetX: key.offsetX,
    offsetY: key.offsetY,
    rotationDeg: key.rotationDeg,
    scale: key.scale,
  };
}

/** Evaluate every captured Part at one absolute Shot time. */
export function evaluatePartPoseAnimationAtTime(
  animation: PartPoseAnimation,
  requestedTimeMs: number,
): EvaluatedPartPose[] {
  const timeMs = Number.isFinite(requestedTimeMs)
    ? Math.max(0, Math.round(requestedTimeMs))
    : 0;
  return animation.tracks.map((track) => evaluateTrack(track, timeMs));
}
