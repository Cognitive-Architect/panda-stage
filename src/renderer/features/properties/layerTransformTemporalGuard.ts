import { evaluateShotAtTime, type Project } from '../../../domain';

export const TEMPORAL_TRANSFORM_STATUS =
  '时间轴预览中 · 回到 0:00 可调整图层';

/** Live Scrub keeps ordinary formal Layers editable only at the base playhead. */
export function isLayerTransformEditableAtTime(currentTimeMs: number): boolean {
  return Number.isFinite(currentTimeMs) && currentTimeMs === 0;
}

/**
 * AM-03 permits editing the persisted base transform only when the selected
 * animation instance is visible and no Shot motion/scale event is overriding
 * that base value at the current playhead.
 */
export function isAnimationBaseTransformEditableAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  currentTimeMs: number,
): boolean {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs < 0) return false;
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer || layer.locked || layer.source.kind !== 'animation') {
    return false;
  }
  if (
    shot.timelineEvents.some(
      (event) =>
        event.layerId === layerId &&
        (event.type === 'move' || event.type === 'shake' || event.type === 'scale'),
    )
  ) {
    return false;
  }

  const evaluated = evaluateShotAtTime(shot, currentTimeMs, project).layers.find(
    (candidate) => candidate.id === layerId,
  );
  if (!evaluated?.visible) return false;

  const unchanged = (evaluatedValue: number, baseValue: number): boolean =>
    Math.abs(evaluatedValue - baseValue) <= 0.001;
  return (
    unchanged(evaluated.x, layer.x) &&
    unchanged(evaluated.y, layer.y) &&
    unchanged(evaluated.scaleX, layer.scaleX) &&
    unchanged(evaluated.scaleY, layer.scaleY) &&
    unchanged(evaluated.rotationDeg, layer.rotationDeg)
  );
}

/**
 * Re-check live editability immediately before a transform mutation. The
 * optional predicate is reserved for the formal animation base-transform
 * exception; existing callers keep the strict 0ms rule.
 */
export function runLayerTransformMutation(
  getCurrentTimeMs: () => number,
  onBlocked: () => void,
  mutation: () => void,
  canEditAtCurrentTime: (currentTimeMs: number) => boolean =
    isLayerTransformEditableAtTime,
): boolean {
  if (!canEditAtCurrentTime(getCurrentTimeMs())) {
    onBlocked();
    return false;
  }
  mutation();
  return true;
}
