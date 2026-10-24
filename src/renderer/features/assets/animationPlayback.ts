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
