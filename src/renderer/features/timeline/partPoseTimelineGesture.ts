import {
  frameTimeMs,
  lastValidFrameTime,
  TIMELINE_FPS,
} from '../../../domain/timeline/frame-grid';

/** Resolve a preview against adjacent keys without crossing either neighbor. */
export function previewPartPoseKeyTime(input: {
  fromTimeMs: number;
  deltaPx: number;
  pixelsPerMs: number;
  previousTimeMs: number;
  nextTimeMs: number | null;
  durationMs: number;
}): number {
  const {
    fromTimeMs,
    deltaPx,
    pixelsPerMs,
    previousTimeMs,
    nextTimeMs,
    durationMs,
  } = input;
  if (
    !Number.isFinite(deltaPx) ||
    !Number.isFinite(pixelsPerMs) ||
    pixelsPerMs <= 0
  ) {
    return fromTimeMs;
  }

  const frameIndex = (timeMs: number): number =>
    Math.round((timeMs * TIMELINE_FPS) / 1_000);
  const minimum = frameIndex(previousTimeMs) + 1;
  const maximum =
    frameIndex(nextTimeMs ?? lastValidFrameTime(durationMs)) -
    (nextTimeMs === null ? 0 : 1);
  if (maximum < minimum) return fromTimeMs;

  const requested = Math.round(
    ((fromTimeMs + deltaPx / pixelsPerMs) * TIMELINE_FPS) / 1_000,
  );
  return frameTimeMs(Math.max(minimum, Math.min(maximum, requested)));
}
