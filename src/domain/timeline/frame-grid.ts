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

/** Export samples at the start of each frame, rounded down to milliseconds. */
export function exportFrameTimeMs(frameIndex: number, fps: number = TIMELINE_FPS): number {
  return Math.floor((frameIndex / safeFps(fps)) * 1_000);
}

/** Match an output sample to its authoring frame, leaving off-grid samples intact. */
export function resolveExportFrameAuthoringTime(timeMs: number, durationMs: number): number {
  const frameIndex = Math.round(timeMs * TIMELINE_FPS / 1_000);
  return timeMs === exportFrameTimeMs(frameIndex)
    ? Math.min(durationMs, frameTimeMs(frameIndex))
    : timeMs;
}

/** First export sample at or after an absolute time. */
export function firstExportFrameTimeAtOrAfter(timeMs: number, fps: number = TIMELINE_FPS): number {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return 0;
  const resolvedFps = safeFps(fps);
  const index = Math.floor(timeMs * resolvedFps / 1_000);
  const time = exportFrameTimeMs(index, resolvedFps);
  return time >= timeMs ? time : exportFrameTimeMs(index + 1, resolvedFps);
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

/** Convert a signed frame delta to an integer millisecond offset at the Timeline FPS. */
export function signedFrameOffsetMs(
  frameDelta: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(frameDelta) || frameDelta === 0) {
    return 0;
  }
  const sign = frameDelta < 0 ? -1 : 1;
  const frames = Math.round(Math.abs(frameDelta));
  const ms = Math.round(frames * (1_000 / safeFps(fps)));
  return ms === 0 ? 0 : sign * ms;
}

/** Snap a signed millisecond offset to the nearest signed Timeline frame offset. */
export function snapSignedFrameOffsetMs(
  offsetMs: number,
  fps: number = TIMELINE_FPS,
): number {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) {
    return 0;
  }
  const sign = offsetMs < 0 ? -1 : 1;
  const frames = Math.round((Math.abs(offsetMs) * safeFps(fps)) / 1_000);
  return signedFrameOffsetMs(sign * frames, fps);
}

/** Step a signed millisecond offset by `deltaFrames` on the Timeline frame grid. */
export function stepSignedFrameOffsetMs(
  currentOffsetMs: number,
  deltaFrames: number,
  fps: number = TIMELINE_FPS,
): number {
  const resolvedFps = safeFps(fps);
  const currentFrames = Number.isFinite(currentOffsetMs)
    ? Math.round((currentOffsetMs * resolvedFps) / 1_000)
    : 0;
  const nextFrames = currentFrames + Math.round(deltaFrames);
  return signedFrameOffsetMs(nextFrames, resolvedFps);
}

/** True for integer times (including negative offsets) aligned to the Timeline frame grid. */
export function isValidSignedFrameTime(
  timeMs: number,
  fps: number = TIMELINE_FPS,
): boolean {
  return (
    Number.isInteger(timeMs) &&
    (timeMs >= 0 ? isValidFrameTime(timeMs, fps) : isValidFrameTime(-timeMs, fps))
  );
}
