import {
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  isValidFrameTime,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';

export const TEMPORAL_TRANSFORM_STATUS =
  '时间轴预览中 · 回到 0:00 可调整图层';

/** True when `layer` is a standalone ordinary FLA Graphic Layer eligible for Layer Target Motion. */
export function isSupportedLayerMotionLayer(
  project: Project | null | undefined,
  shot: Shot | null | undefined,
  layer: Layer | null | undefined,
): boolean {
  if (!project || !shot || !layer || shot.backgroundLayerId === layer.id) {
    return false;
  }
  const source = layer.source;
  if (source.kind !== 'animation') return false;
  const animation = project.animations.find(
    (candidate) => candidate.id === source.animationId,
  );
  return Boolean(animation && isFlaGraphicDefinition(animation));
}

/** True when a standalone FLA Graphic Layer can commit a static or keyframed transform at `currentTimeMs`. */
export function isLayerMotionTransformEditableAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  currentTimeMs: number,
): boolean {
  if (!isValidFrameTime(currentTimeMs) || currentTimeMs < 0) return false;
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (
    !shot ||
    !layer ||
    layer.locked ||
    currentTimeMs > shot.durationMs ||
    !isSupportedLayerMotionLayer(project, shot, layer)
  ) {
    return false;
  }
  const evaluated = evaluateShotAtTime(shot, currentTimeMs, project).layers.find(
    (candidate) => candidate.id === layerId,
  );
  return Boolean(evaluated?.visible);
}

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
