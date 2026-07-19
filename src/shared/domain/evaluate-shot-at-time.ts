import { z } from 'zod';
import type { Layer, MoveEvent, Shot } from './schema';

const EvaluationTimeSchema = z.number().int().nonnegative();

export type EvaluatedLayer = Pick<
  Layer,
  | 'id'
  | 'assetId'
  | 'anchor'
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotationDeg'
  | 'opacity'
  | 'visible'
  | 'zIndex'
>;

export interface EvaluatedShot {
  shotId: string;
  timeMs: number;
  layers: EvaluatedLayer[];
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

function evaluateMove(
  event: MoveEvent,
  timeMs: number,
): Pick<EvaluatedLayer, 'x' | 'y'> | null {
  if (timeMs < event.startMs) {
    return null;
  }

  const elapsedMs = Math.min(timeMs - event.startMs, event.durationMs);
  const progress = ease(elapsedMs / event.durationMs, event.easing);

  return {
    x: interpolate(event.from.x, event.to.x, progress),
    y: interpolate(event.from.y, event.to.y, progress),
  };
}

/**
 * Evaluates a validated shot into a deterministic, serializable snapshot.
 * The caller supplies integer milliseconds; values past the shot end clamp to
 * the final frame so preview and export can share the same behavior.
 */
export function evaluateShotAtTime(
  shot: Shot,
  requestedTimeMs: number,
): EvaluatedShot {
  const parsedTimeMs = EvaluationTimeSchema.parse(requestedTimeMs);
  const timeMs = Math.min(parsedTimeMs, shot.durationMs);
  const eventsByLayer = new Map<string, MoveEvent[]>();

  for (const event of shot.timelineEvents) {
    const events = eventsByLayer.get(event.layerId) ?? [];
    events.push(event);
    eventsByLayer.set(event.layerId, events);
  }

  return {
    shotId: shot.id,
    timeMs,
    layers: [...shot.layers]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((layer) => {
        let x = layer.x;
        let y = layer.y;
        const events = [...(eventsByLayer.get(layer.id) ?? [])].sort(
          (left, right) =>
            left.startMs - right.startMs || left.id.localeCompare(right.id),
        );

        for (const event of events) {
          const evaluatedMove = evaluateMove(event, timeMs);
          if (evaluatedMove) {
            ({ x, y } = evaluatedMove);
          }
        }

        return {
          id: layer.id,
          assetId: layer.assetId,
          anchor: layer.anchor,
          x,
          y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          rotationDeg: layer.rotationDeg,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex: layer.zIndex,
        };
      }),
  };
}
