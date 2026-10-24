export function sampleAnimationFrameIndex(
  elapsedMs: number,
  sourceFps: number,
  frameCount: number,
): number {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(sourceFps) ||
    sourceFps <= 0 ||
    !Number.isInteger(frameCount) ||
    frameCount <= 0
  ) {
    return 0;
  }
  const elapsedFrames = Math.floor(Math.max(0, elapsedMs) * sourceFps / 1_000);
  return Math.min(frameCount - 1, elapsedFrames);
}

export interface AnimationPlaybackTimeline {
  sourceFps: number;
  frameCount: number;
  startedAtMs: number;
  lastFrameVisibleAtMs: number | null;
}

export interface AnimationPlaybackSample {
  frameIndex: number;
  elapsedMs: number;
  durationMs: number;
  complete: boolean;
}

export function animationPlaybackDurationMs(
  sourceFps: number,
  frameCount: number,
): number {
  if (
    !Number.isFinite(sourceFps) ||
    sourceFps <= 0 ||
    !Number.isInteger(frameCount) ||
    frameCount <= 0
  ) {
    return 0;
  }
  return frameCount * 1_000 / sourceFps;
}

export function createAnimationPlaybackTimeline(
  sourceFps: number,
  frameCount: number,
  nowMs: number,
  fromFrameIndex = 0,
): AnimationPlaybackTimeline {
  const frameDurationMs = Number.isFinite(sourceFps) && sourceFps > 0
    ? 1_000 / sourceFps
    : 0;
  const safeFromIndex = Number.isFinite(fromFrameIndex) ? Math.trunc(fromFrameIndex) : 0;
  const clampedIndex = Number.isInteger(frameCount) && frameCount > 0
    ? Math.min(frameCount - 1, Math.max(0, safeFromIndex))
    : 0;
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  return {
    sourceFps,
    frameCount,
    startedAtMs: safeNowMs - clampedIndex * frameDurationMs,
    lastFrameVisibleAtMs: null,
  };
}

export function sampleAnimationPlaybackTimeline(
  timeline: AnimationPlaybackTimeline,
  nowMs: number,
): AnimationPlaybackSample {
  const durationMs = animationPlaybackDurationMs(timeline.sourceFps, timeline.frameCount);
  const elapsedMs = Number.isFinite(nowMs)
    ? Math.max(0, nowMs - timeline.startedAtMs)
    : 0;
  const frameDurationMs = Number.isFinite(timeline.sourceFps) && timeline.sourceFps > 0
    ? 1_000 / timeline.sourceFps
    : 0;
  const lastFrameHasBeenVisible = frameDurationMs > 0 &&
    timeline.lastFrameVisibleAtMs !== null &&
    nowMs - timeline.lastFrameVisibleAtMs >= frameDurationMs;
  return {
    frameIndex: sampleAnimationFrameIndex(elapsedMs, timeline.sourceFps, timeline.frameCount),
    elapsedMs,
    durationMs,
    complete: durationMs > 0 && elapsedMs >= durationMs && lastFrameHasBeenVisible,
  };
}

export function markAnimationPlaybackFrameVisible(
  timeline: AnimationPlaybackTimeline,
  frameIndex: number,
  nowMs: number,
): void {
  if (frameIndex === timeline.frameCount - 1 && Number.isFinite(nowMs)) {
    timeline.lastFrameVisibleAtMs = nowMs;
  }
}

export function sampleLoopingAnimationFrameIndex(
  elapsedMs: number,
  sourceFps: number,
  frameCount: number,
): number {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(sourceFps) ||
    sourceFps <= 0 ||
    !Number.isInteger(frameCount) ||
    frameCount <= 0
  ) return 0;
  const elapsedFrames = Math.max(0, elapsedMs) * sourceFps / 1_000;
  const nearestFrame = Math.round(elapsedFrames);
  const roundingTolerance = Number.EPSILON * Math.max(4, Math.abs(elapsedFrames)) * 4;
  const wholeFrames = Math.abs(elapsedFrames - nearestFrame) <= roundingTolerance
    ? nearestFrame
    : Math.floor(elapsedFrames);
  return wholeFrames % frameCount;
}
