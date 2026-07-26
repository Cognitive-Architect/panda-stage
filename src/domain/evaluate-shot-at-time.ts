import type { Layer, Project, Shot, TimelineEvent } from './models';

/**
 * A single evaluated layer at one exact moment. Shape is intentionally
 * identical to the legacy evaluator so `shared/stage/render-model.ts` can
 * consume it without changes. `assetId` is the resolved image asset used by
 * the renderer (for character layers this is the active expression's asset).
 */
export interface EvaluatedLayer {
  id: string;
  assetId: string;
  anchor: 'center';
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
}

export interface EvaluatedShot {
  shotId: string;
  timeMs: number;
  backgroundLayerId: string | null;
  layers: EvaluatedLayer[];
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function ease(progress: number, easing: 'linear' | 'ease-in-out'): number {
  if (easing === 'linear') {
    return progress;
  }
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function eventEasing(event: TimelineEvent): 'linear' | 'ease-in-out' {
  if (
    event.type === 'move' ||
    event.type === 'scale' ||
    event.type === 'opacity'
  ) {
    return event.easing;
  }
  return 'linear';
}

function resolveLayerAssetId(project: Project, layer: Layer): string | null {
  if (layer.source.kind === 'asset') {
    return layer.source.assetId;
  }
  const characterId = layer.source.characterId;
  const expressionId = layer.source.expressionId;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  const expression = character?.expressions.find(
    (candidate) => candidate.id === expressionId,
  );
  return expression?.assetId ?? null;
}

function resolveExpressionAssetId(
  project: Project,
  characterId: string,
  expressionId: string,
  fallbackExpressionId: string,
): string | null {
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (!character) {
    return null;
  }
  const target =
    character.expressions.find(
      (candidate) => candidate.id === expressionId,
    ) ??
    character.expressions.find(
      (candidate) => candidate.id === fallbackExpressionId,
    );
  return target?.assetId ?? null;
}

/**
 * Evaluates a validated shot into a deterministic, serializable snapshot at
 * Evaluates a validated shot into a deterministic, serializable snapshot at
 * one exact moment. Time is clamped to `[0, shot.durationMs]`. Supports all
 * seven timeline event kinds; character expression events resolve the active
 * image asset, falling back to the layer's base expression when the reference
 * is invalid (R6) instead of throwing.
 */
export function evaluateShotAtTime(
  shot: Shot,
  requestedTimeMs: number,
  project: Project,
): EvaluatedShot {
  const timeMs = Math.max(
    0,
    Math.min(Math.round(requestedTimeMs), shot.durationMs),
  );

  const eventsByLayer = new Map<string, TimelineEvent[]>();
  for (const event of shot.timelineEvents) {
    const list = eventsByLayer.get(event.layerId) ?? [];
    list.push(event);
    eventsByLayer.set(event.layerId, list);
  }

  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EvaluatedLayer => {
      let x = layer.x;
      let y = layer.y;
      let scaleX = layer.scaleX;
      let scaleY = layer.scaleY;
      const rotationDeg = layer.rotationDeg;
      let opacity = layer.opacity;
      let flipX = layer.flipX;
      let visible = layer.visible;
      let assetId = resolveLayerAssetId(project, layer);

      const events = [
        ...(eventsByLayer.get(layer.id) ?? []),
      ].sort(
        (left, right) =>
          left.startMs - right.startMs || left.id.localeCompare(right.id),
      );

      for (const event of events) {
        const span = Math.max(1, event.endMs - event.startMs);
        const rawProgress =
          timeMs < event.startMs
            ? 0
            : timeMs > event.endMs
              ? 1
              : (timeMs - event.startMs) / span;
        const progress = ease(rawProgress, eventEasing(event));

        switch (event.type) {
          case 'move': {
            x = interpolate(event.from.x, event.to.x, progress);
            y = interpolate(event.from.y, event.to.y, progress);
            break;
          }
          case 'scale': {
            scaleX = interpolate(event.from.x, event.to.x, progress);
            scaleY = interpolate(event.from.y, event.to.y, progress);
            break;
          }
          case 'opacity': {
            opacity = clamp01(interpolate(event.from, event.to, progress));
            break;
          }
          case 'shake': {
            if (timeMs >= event.startMs && timeMs <= event.endMs) {
              const seconds = (timeMs - event.startMs) / 1000;
              const wave =
                Math.sin(2 * Math.PI * event.frequencyHz * seconds);
              x += event.amplitudeX * wave;
              y += event.amplitudeY * wave;
            }
            break;
          }
          case 'expression': {
            if (layer.source.kind === 'character') {
              const resolved = resolveExpressionAssetId(
                project,
                layer.source.characterId,
                event.expressionId,
                layer.source.expressionId,
              );
              if (resolved) {
                assetId = resolved;
              }
            }
            break;
          }
          case 'flip': {
            flipX = event.flipped;
            break;
          }
          case 'visibility': {
            visible = event.visible;
            break;
          }
        }
      }

      return {
        id: layer.id,
        assetId: assetId ?? '',
        anchor: layer.anchor,
        x,
        y,
        scaleX,
        scaleY,
        flipX,
        rotationDeg,
        opacity,
        visible,
        zIndex: layer.zIndex,
      };
    });

  return {
    shotId: shot.id,
    timeMs,
    backgroundLayerId: shot.backgroundLayerId,
    layers,
  };
}
