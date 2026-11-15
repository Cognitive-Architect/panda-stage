import type {
  FlaGraphicDefinition,
  FlaGraphicStructureNode,
  Layer,
  Project,
  Shot,
  TimelineEvent,
} from './models';
import {
  collectFlaGraphicTimelineDurationMs,
  type FlaGraphicInternalTimeline,
} from './models/flaGraphicTimeline';
import { evaluateLayerMotionAtTime } from './evaluate-layer-motion';

/**
 * A single evaluated layer at one exact moment. Its formal fields remain
 * compatible with the legacy evaluator so `shared/stage/render-model.ts` can
 * consume it; optional runtime projection fields stay transient. `assetId` is
 * the resolved image asset used by the renderer (for character layers this is
 * the active expression's asset).
 */
export interface EvaluatedLayer {
  id: string;
  assetId: string;
  /** The formal Expression state before any transient Mouth projection. */
  currentExpressionId?: string | null;
  /** The transient Mouth asset projected after formal evaluation, if any. */
  mouthOverrideAssetId?: string | null;
  /** Transient source-canvas projection for a formal animation instance. */
  animationFrame?: {
    animationId: string;
    frameOrdinal: number;
    internalTimeMs?: number;
    offset: { x: number; y: number };
    viewport: { width: number; height: number };
    canvas: { width: number; height: number };
  };
  /** Runtime-only Head Group transform projected from the active Dialogue. */
  headGroupTransform?: EvaluatedHeadGroupTransform;
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

export interface EvaluatedHeadGroupTransform {
  /** Translation relative to the Character-local Head pivot. */
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
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
  if (event.type === 'scale' || event.type === 'opacity') {
    return event.easing;
  }
  return 'linear';
}

interface ResolvedLayerVisualState {
  assetId: string | null;
  currentExpressionId: string | null;
  animationVisible?: boolean;
  animationFrame?: EvaluatedLayer['animationFrame'];
}

function resolveLayerVisualState(
  project: Project,
  layer: Layer,
): ResolvedLayerVisualState {
  if (layer.source.kind === 'asset') {
    return { assetId: layer.source.assetId, currentExpressionId: null };
  }
  if (layer.source.kind === 'animation') {
    return { assetId: null, currentExpressionId: null };
  }
  const characterId = layer.source.characterId;
  const expressionId = layer.source.expressionId;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (!character || character.mode === 'adaptive-parts') {
    return { assetId: null, currentExpressionId: null };
  }
  const expression = character?.expressions.find(
    (candidate) => candidate.id === expressionId,
  );
  return {
    assetId: expression?.assetId ?? null,
    currentExpressionId: expression?.id ?? null,
  };
}

export interface AnimationPlaybackFrameState<TFrame> {
  readonly frame: TFrame;
  readonly sourceFrameIndex: number;
  readonly internalTimeMs: number;
  readonly elapsedMs: number;
  readonly completedOnce: boolean;
}

/**
 * Shared FLA Graphic / Sequence playback frame & internal clock resolver.
 * Projects a Shot-level elapsed timeline onto frame selection and continuous
 * `internalTimeMs` so Animation layers and Graphic CharacterParts share one rule.
 */
export function resolveAnimationPlaybackFrameState<
  TFrame extends { readonly ordinal: number },
>(
  animation: {
    readonly frames: readonly TFrame[];
    readonly source: { readonly sourceFps: number };
    readonly kind?: string;
    readonly structure?: {
      readonly timeline?: FlaGraphicInternalTimeline;
    };
  },
  startTimeMs: number,
  firstFrameIndex: number,
  playback: NonNullable<Layer['animationPlayback']>,
  timeMs: number,
): AnimationPlaybackFrameState<TFrame> | null {
  if (animation.frames.length === 0) {
    return null;
  }
  const elapsedMs = timeMs - startTimeMs;
  const elapsedSourceFrames = Math.floor(
    Math.max(0, elapsedMs) * animation.source.sourceFps / 1_000,
  );
  const firstFrame = Math.min(firstFrameIndex, animation.frames.length - 1);
  const availableFrames = animation.frames.length - firstFrame;
  const completedOnce = elapsedSourceFrames >= availableFrames;
  const sourceFrameIndex = playback.mode === 'single-frame'
    ? firstFrame
    : playback.mode === 'loop'
      ? firstFrame + (elapsedSourceFrames % availableFrames)
      : Math.min(animation.frames.length - 1, firstFrame + elapsedSourceFrames);
  const frameMs = 1_000 / Math.max(1, animation.source.sourceFps || 24);
  const firstFrameMs = Math.round(firstFrame * frameMs);
  const clampedElapsedMs = Math.max(0, elapsedMs);
  let internalTimeMs = firstFrameMs;
  if (playback.mode !== 'single-frame') {
    if (playback.mode === 'loop') {
      const timelineDurationMs =
        animation.kind === 'fla-graphic' && animation.structure
          ? collectFlaGraphicTimelineDurationMs(animation.structure.timeline)
          : 0;
      const loopDurationMs =
        animation.frames.length > 1
          ? Math.round(availableFrames * frameMs)
          : timelineDurationMs > firstFrameMs
            ? timelineDurationMs - firstFrameMs
            : 0;
      internalTimeMs =
        loopDurationMs > 0
          ? firstFrameMs + (clampedElapsedMs % loopDurationMs)
          : firstFrameMs + clampedElapsedMs;
    } else {
      internalTimeMs = firstFrameMs + clampedElapsedMs;
    }
  }
  const frame = animation.frames[sourceFrameIndex];
  if (!frame) {
    return null;
  }
  return {
    frame,
    sourceFrameIndex,
    internalTimeMs,
    elapsedMs,
    completedOnce,
  };
}

/**
 * Returns true when an FLA Graphic Definition carries temporal motion across
 * external frames, root/nested timelines, or multi-frame nested symbol instances.
 * Static single-frame Graphics stay pinned at frame 0 / resting clock.
 */
export function hasFlaGraphicTemporalPlayback(
  definition: FlaGraphicDefinition,
): boolean {
  if (definition.frames.length > 1) return true;
  if (!definition.structure) return false;
  if (
    collectFlaGraphicTimelineDurationMs(
      definition.structure.timeline,
      definition.structure,
    ) > 0
  ) {
    return true;
  }
  const visitedSymbolDefs = new Set<string>();
  const hasAnimatedNestedSymbol = (
    nodes: readonly FlaGraphicStructureNode[],
  ): boolean => {
    for (const node of nodes) {
      if (node.type === 'symbol') {
        const nestedDefId = node.nestedDefinitionId;
        const nestedDef = nestedDefId
          ? definition.structure?.symbolDefinitions?.[nestedDefId]
          : undefined;
        if (nestedDef) {
          if ((nestedDef.sourceFrameCount ?? 1) > 1) return true;
          if (nestedDefId && !visitedSymbolDefs.has(nestedDefId)) {
            visitedSymbolDefs.add(nestedDefId);
            if (hasAnimatedNestedSymbol(nestedDef.children)) return true;
          }
        }
        if (node.children && hasAnimatedNestedSymbol(node.children)) return true;
      } else if (node.type === 'group' && hasAnimatedNestedSymbol(node.children)) {
        return true;
      }
    }
    return false;
  };
  return definition.structure.frames.some((frame) =>
    frame.layers.some((layer) => hasAnimatedNestedSymbol(layer.nodes)),
  );
}

function resolveAnimationFrame(
  project: Project,
  animationId: string,
  startTimeMs: number,
  firstFrameIndex: number,
  playback: NonNullable<Layer['animationPlayback']>,
  timeMs: number,
): ResolvedLayerVisualState {
  const animation = project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!animation || animation.frames.length === 0) {
    return {
      assetId: null,
      currentExpressionId: null,
      animationVisible: false,
    };
  }
  const state = resolveAnimationPlaybackFrameState(
    animation,
    startTimeMs,
    firstFrameIndex,
    playback,
    timeMs,
  );
  if (!state) {
    return {
      assetId: null,
      currentExpressionId: null,
      animationVisible: false,
    };
  }
  const { frame, internalTimeMs, elapsedMs, completedOnce } = state;
  return {
    assetId: frame.assetId,
    currentExpressionId: null,
    animationVisible:
      elapsedMs >= 0 &&
      !(playback.mode === 'once' && playback.endBehavior === 'hide' && completedOnce),
    animationFrame: {
      animationId: animation.id,
      frameOrdinal: frame.ordinal,
      internalTimeMs,
      offset: frame.offset,
      viewport: {
        width: frame.sourceViewport.width,
        height: frame.sourceViewport.height,
      },
      canvas: animation.source.canvas,
    },
  };
}

function resolveExpressionState(
  project: Project,
  characterId: string,
  expressionId: string,
  fallbackExpressionId: string | undefined,
): ResolvedLayerVisualState {
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (!character) {
    return { assetId: null, currentExpressionId: null };
  }
  if (character.mode === 'adaptive-parts') {
    return { assetId: null, currentExpressionId: null };
  }
  const target =
    character.expressions.find(
      (candidate) => candidate.id === expressionId,
    ) ??
    character.expressions.find(
      (candidate) => candidate.id === fallbackExpressionId,
    );
  return {
    assetId: target?.assetId ?? null,
    currentExpressionId: target?.id ?? null,
  };
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
      let scaleX = layer.scaleX;
      let scaleY = layer.scaleY;
      const rotationDeg = layer.rotationDeg;
      let opacity = layer.opacity;
      let flipX = layer.flipX;
      let visible = layer.visible;
      const animationSource =
        layer.source.kind === 'animation' ? layer.source : null;
      const initialVisual = animationSource
        ? resolveAnimationFrame(
            project,
            animationSource.animationId,
            layer.startTimeMs ?? 0,
            layer.animationFirstFrame ?? 0,
            layer.animationPlayback ?? { mode: 'once', endBehavior: 'hold' },
            timeMs,
          )
        : resolveLayerVisualState(project, layer);
      const animationVisible = initialVisual.animationVisible ?? true;
      let assetId = initialVisual.assetId;
      let currentExpressionId = initialVisual.currentExpressionId;

      const events = [
        ...(eventsByLayer.get(layer.id) ?? []),
      ].sort(
        (left, right) =>
          left.startMs - right.startMs || left.id.localeCompare(right.id),
      );

      const motion = evaluateLayerMotionAtTime(layer, events, timeMs);

      for (const event of events) {
        if (event.type === 'move' || event.type === 'shake') {
          // Position + Shake are resolved by the single formal motion seam
          // above. Keeping them out of this state loop prevents a later Move
          // from overwriting a temporary Shake offset.
          continue;
        }
        // Future events (timeMs before the event starts) must not participate
        // in evaluation: skipping them leaves the layer at its base state
        // (or the state produced by earlier events) instead of overwriting it
        // with `from`. Events whose start has passed keep contributing — for
        // timeMs > endMs `rawProgress` resolves to 1, applying the final state.
        if (timeMs < event.startMs) {
          continue;
        }
        const span = Math.max(1, event.endMs - event.startMs);
        const rawProgress =
          timeMs < event.startMs
            ? 0
            : timeMs > event.endMs
              ? 1
              : (timeMs - event.startMs) / span;
        const progress = ease(rawProgress, eventEasing(event));

        switch (event.type) {
          case 'scale': {
            scaleX = interpolate(event.from.x, event.to.x, progress);
            scaleY = interpolate(event.from.y, event.to.y, progress);
            break;
          }
          case 'opacity': {
            opacity = clamp01(interpolate(event.from, event.to, progress));
            break;
          }
          case 'expression': {
            if (layer.source.kind === 'character') {
              const resolved = resolveExpressionState(
                project,
                layer.source.characterId,
                event.expressionId,
                layer.source.expressionId,
              );
              if (resolved.assetId) {
                assetId = resolved.assetId;
                currentExpressionId = resolved.currentExpressionId;
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
        currentExpressionId,
        mouthOverrideAssetId: null,
        ...(initialVisual.animationFrame
          ? { animationFrame: initialVisual.animationFrame }
          : {}),
        anchor: layer.anchor,
        x: motion.displayPosition.x,
        y: motion.displayPosition.y,
        scaleX,
        scaleY,
        flipX,
        rotationDeg,
        opacity,
        visible: visible && animationVisible,
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
