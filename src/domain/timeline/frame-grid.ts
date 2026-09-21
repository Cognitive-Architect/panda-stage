import { PROJECT_FPS } from '../constants';

/** The single Timeline time base shared by playback-facing authoring code. */
export const TIMELINE_FPS = PROJECT_FPS;

function safeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : TIMELINE_FPS;
}

/** Milliseconds represented by one frame at the active Timeline FPS. */
export function frameDurationMs(fps: number = TIMELINE_FPS): number {
  return 1_000 / safeFps(fps);
}

/** Convert a non-negative frame index to the persisted integer millisecond. */
export function frameTimeMs(
  frameIndex: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(frameIndex) || frameIndex < 0) {
    return 0;
  }
  return Math.round(Math.floor(frameIndex) * (1_000 / safeFps(fps)));
}

/** Snap a time to the nearest integer-millisecond Timeline frame boundary. */
export function snapToFrame(
  timeMs: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(timeMs)) {
    return 0;
  }
  const safeTime = Math.max(0, timeMs);
  const frameIndex = Math.round((safeTime * safeFps(fps)) / 1_000);
  return frameTimeMs(frameIndex, fps);
}

/** Integer persisted span for one Timeline frame. */
export function integerFrameSpanMs(fps: number = TIMELINE_FPS): number {
  return Math.max(1, snapToFrame(frameDurationMs(fps), fps));
}

/**
 * Return the last legal frame whose persisted time is inside the Shot.
 * Playback may still use the real, possibly off-grid Shot duration.
 */
export function lastValidFrameTime(
  durationMs: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  const safeDuration = Math.max(0, durationMs);
  const resolvedFps = safeFps(fps);
  // `frameTimeMs` rounds a theoretical frame time to the persisted integer.
  // The largest legal index is therefore the largest integer strictly below
  // `(durationMs + 0.5) * fps / 1000`, not merely the floor of duration's
  // theoretical frame index. The correction loops only compensate for
  // floating-point boundaries; they do not step through time by a fixed ms
  // increment.
  let frameIndex = Math.max(
    0,
    Math.ceil(((safeDuration + 0.5) * resolvedFps) / 1_000) - 1,
  );
  while (frameTimeMs(frameIndex + 1, resolvedFps) <= safeDuration) {
    frameIndex += 1;
  }
  while (frameIndex > 0 && frameTimeMs(frameIndex, fps) > safeDuration) {
    frameIndex -= 1;
  }
  return frameTimeMs(frameIndex, resolvedFps);
}

/** Resolve an authoring time to the nearest legal in-range Timeline frame. */
export function resolveTimelineFrameTime(
  timeMs: number,
  durationMs: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs)) {
    return 0;
  }
  const safeDuration = Math.max(0, durationMs);
  const clamped = Math.min(safeDuration, Math.max(0, timeMs));
  const snapped = snapToFrame(clamped, fps);
  return snapped <= safeDuration
    ? snapped
    : lastValidFrameTime(safeDuration, fps);
}

/** True only for persisted integer times that are legal Timeline frames. */
export function isValidFrameTime(
  timeMs: number,
  fps: number = TIMELINE_FPS,
): boolean {
  return (
    Number.isInteger(timeMs) &&
    timeMs >= 0 &&
    snapToFrame(timeMs, fps) === timeMs
  );
}
