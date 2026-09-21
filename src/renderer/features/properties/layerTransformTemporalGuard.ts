export const TEMPORAL_TRANSFORM_STATUS =
  '时间轴预览中 · 回到 0:00 可调整图层';

/** Live Scrub keeps the formal Layer editable only at the base playhead. */
export function isLayerTransformEditableAtTime(currentTimeMs: number): boolean {
  return Number.isFinite(currentTimeMs) && currentTimeMs === 0;
}

/**
 * Re-check the Timeline immediately before a Properties mutation. The
 * callback keeps the check and the mutation in one synchronous ownership
 * boundary, covering blur/action/submit races without moving Timeline state
 * into the domain LayerService.
 */
export function runLayerTransformMutation(
  getCurrentTimeMs: () => number,
  onBlocked: () => void,
  mutation: () => void,
): boolean {
  if (!isLayerTransformEditableAtTime(getCurrentTimeMs())) {
    onBlocked();
    return false;
  }
  mutation();
  return true;
}
