import type { Point } from './geometry';
import type {
  Layer,
  MoveEvent,
  ShakeEvent,
  TimelineEvent,
} from './models';

/** The runtime-only position values resolved for one layer at one time. */
export interface EvaluatedLayerMotion {
  /** The authored/main route before any temporary Shake contribution. */
  readonly mainPosition: Point;
  /** The sum of all active temporary Shake contributions. */
  readonly shakeOffset: Point;
  /** The position sent to display consumers. */
  readonly displayPosition: Point;
}

function timelineEventOrder(left: TimelineEvent, right: TimelineEvent): number {
  return left.startMs - right.startMs || left.id.localeCompare(right.id);
}

/**
 * Shake contributions are summed in a payload-defined order rather than by
 * event id. This keeps floating-point accumulation stable when persisted
 * event ids or the input array order changes.
 */
function shakeEventOrder(left: ShakeEvent, right: ShakeEvent): number {
  return (
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.frequencyHz - right.frequencyHz ||
    left.amplitudeX - right.amplitudeX ||
    left.amplitudeY - right.amplitudeY
  );
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function ease(progress: number, easing: MoveEvent['easing']): number {
  if (easing === 'linear') {
    return progress;
  }
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function evaluateMoveAtTime(
  basePosition: Point,
  moveEvents: readonly MoveEvent[],
  timeMs: number,
): Point {
  const mainPosition = { x: basePosition.x, y: basePosition.y };

  for (const event of [...moveEvents].sort(timelineEventOrder)) {
    // Preserve the formal Move semantics: a future event does not overwrite
    // the current state, while a completed event holds its final endpoint.
    if (timeMs < event.startMs) {
      continue;
    }
    const span = Math.max(1, event.endMs - event.startMs);
    const rawProgress =
      timeMs > event.endMs
        ? 1
        : (timeMs - event.startMs) / span;
    const progress = ease(rawProgress, event.easing);
    mainPosition.x = interpolate(event.from.x, event.to.x, progress);
    mainPosition.y = interpolate(event.from.y, event.to.y, progress);
  }

  return mainPosition;
}

function evaluateShakeAtTime(
  shakeEvents: readonly ShakeEvent[],
  timeMs: number,
): Point {
  const shakeOffset = { x: 0, y: 0 };

  for (const event of [...shakeEvents].sort(shakeEventOrder)) {
    if (timeMs < event.startMs || timeMs > event.endMs) {
      continue;
    }
    const seconds = (timeMs - event.startMs) / 1_000;
    const wave = Math.sin(2 * Math.PI * event.frequencyHz * seconds);
    shakeOffset.x += event.amplitudeX * wave;
    shakeOffset.y += event.amplitudeY * wave;
  }

  return shakeOffset;
}

/**
 * Resolve Position + Shake once for one layer. The result is runtime-only:
 * it is never written into the Project or treated as an authored key.
 *
 * `timeMs` is expected to be the already-clamped time supplied by the formal
 * Shot evaluator. Move events keep their existing start/id ordering, while
 * Shake is evaluated independently and added only after main Position is
 * complete.
 */
export function evaluateLayerMotionAtTime(
  layer: Pick<Layer, 'id' | 'x' | 'y'>,
  events: readonly TimelineEvent[],
  timeMs: number,
): EvaluatedLayerMotion {
  const layerEvents = events.filter((event) => event.layerId === layer.id);
  const moveEvents = layerEvents.filter(
    (event): event is MoveEvent => event.type === 'move',
  );
  const shakeEvents = layerEvents.filter(
    (event): event is ShakeEvent => event.type === 'shake',
  );
  const mainPosition = evaluateMoveAtTime(
    { x: layer.x, y: layer.y },
    moveEvents,
    timeMs,
  );
  const shakeOffset = evaluateShakeAtTime(shakeEvents, timeMs);
  const displayPosition = {
    x: mainPosition.x + shakeOffset.x,
    y: mainPosition.y + shakeOffset.y,
  };

  return { mainPosition, shakeOffset, displayPosition };
}
