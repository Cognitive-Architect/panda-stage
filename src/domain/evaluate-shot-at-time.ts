import type {
  FlaGraphicDefinition,
  FlaGraphicStructureNode,
  Layer,
  MouthPose,
  Project,
  Shot,
  TimelineEvent,
} from './models';
import type { MouthCueEvent, MouthCueState } from './models/timeline-event';
import {
  collectFlaGraphicTimelineDurationMs,
  type FlaGraphicInternalTimeline,
} from './models/flaGraphicTimeline';
import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from './constants';
import { TIMELINE_FPS, frameTimeMs } from './timeline/frame-grid';
import { evaluateLayerMotionAtTime, type EvaluatedLayerMotion } from './evaluate-layer-motion';
import { evaluateAnimationClipAtTime, type EvaluatedAnimationValue } from './evaluate-animation-core';
import {
  evaluateCompositeFacePoseAtTime,
  type EvaluatedCharacterNodePose,
} from './character-node-animation';
import {
  composeAnimatedLayerTransform,
  evaluateLayerRelativeMotionValues,
  resolveLayerAnimationBasis,
  type LayerBasePose,
} from './layer-animation';

/**
 * A single evaluated layer at one exact moment. Its formal fields remain
 * compatible with the legacy evaluator so `shared/stage/render-model.ts` can
 * consume it; optional runtime projection fields stay transient. `assetId` is
 * the resolved image asset used by the renderer (for character layers this is
 * the active expression's asset).
 */
export interface EvaluatedLayer {
  /** Transient Animation Core values at the same absolute Shot time. */
  animationValues?: EvaluatedAnimationValue[];
  /** Absolute Shot timestamp used for both outer motion and Graphic internal playback. */
  animationTimeMs?: number;
  /** Transient evaluated Composite Face pose for Character Node Clip v3. */
  faceTransform?: EvaluatedCharacterNodePose;
  id: string;
  assetId: string;
  /** The formal Expression state before any transient Mouth projection. */
  currentExpressionId?: string | null;
  /** The transient Mouth asset projected after formal evaluation, if any. */
  mouthOverrideAssetId?: string | null;
  mouthOpen?: boolean;
  mouthPose?: MouthPose;
  talkingAnimationElapsedMs?: number | 'rest';
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
  if (!character) {
    return { assetId: null, currentExpressionId: null };
  }
  if (character.mode === 'adaptive-parts') {
    const expressions = character.expressions ?? [];
    const targetId = expressionId ?? character.defaultExpressionId;
    const expression = targetId
      ? expressions.find((candidate) => candidate.id === targetId)
      : undefined;
    return {
      assetId: expression?.assetId ?? null,
      currentExpressionId: expression?.id ?? null,
    };
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
  if (character.mode === 'adaptive-parts' && !character.faceBinding) {
    return { assetId: null, currentExpressionId: null };
  }
  const expressions = character.expressions ?? [];
  const target =
    expressions.find(
      (candidate) => candidate.id === expressionId,
    ) ??
    expressions.find(
      (candidate) => candidate.id === fallbackExpressionId,
    );
  return {
    assetId: target?.assetId ?? null,
    currentExpressionId: target?.id ?? null,
  };
}

export interface EvaluatedLayerPreTrackState {
  readonly basePose: LayerBasePose;
  readonly motion: EvaluatedLayerMotion;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number;
  readonly opacity: number;
  readonly flipX: boolean;
  readonly visible: boolean;
  readonly controlledByMove: boolean;
  readonly controlledByScale: boolean;
  readonly assetId: string | null;
  readonly currentExpressionId: string | null;
  readonly animationVisible: boolean;
  readonly animationFrame?: EvaluatedLayer['animationFrame'];
}

/**
 * Evaluate `Static/Basis -> legacy TimelineEvents -> legacy Shake` before any
 * Layer Property Track composition. Shared by the Shot evaluator and
 * LayerMotionService back-solving.
 */
export function evaluateLayerPreTrackState(
  shot: Shot,
  layer: Layer,
  requestedTimeMs: number,
  project: Project,
  eventsOverride?: readonly TimelineEvent[],
): EvaluatedLayerPreTrackState {
  const timeMs = Math.max(
    0,
    Math.min(Math.round(requestedTimeMs), shot.durationMs),
  );
  const layerBasis =
    layer.animationClip?.version === 2
      ? resolveLayerAnimationBasis(layer.animationClip, {
          kind: 'layer',
          layerId: layer.id,
        })
      : null;
  const basePose: LayerBasePose = layerBasis
    ? { ...layerBasis.baseTransform }
    : {
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotationDeg: layer.rotationDeg,
      };
  let scaleX = basePose.scaleX;
  let scaleY = basePose.scaleY;
  const rotationDeg = basePose.rotationDeg;
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

  const events = [...(eventsOverride ?? shot.timelineEvents.filter((event) => event.layerId === layer.id))].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );

  const motion = evaluateLayerMotionAtTime(
    { id: layer.id, x: basePose.x, y: basePose.y },
    events,
    timeMs,
  );
  let controlledByMove = false;
  let controlledByScale = false;

  for (const event of events) {
    if (event.type === 'move') {
      if (timeMs >= event.startMs) controlledByMove = true;
      // Position + Shake are resolved by the single formal motion seam above.
      continue;
    }
    if (event.type === 'shake') {
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
        controlledByScale = true;
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
          if (resolved.currentExpressionId) {
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
    basePose,
    motion,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    flipX,
    visible,
    controlledByMove,
    controlledByScale,
    assetId,
    currentExpressionId,
    animationVisible,
    animationFrame: initialVisual.animationFrame,
  };
}

const FINAL_SCALE_TOLERANCE = 1e-12;

/**
 * Enforce that a Layer Clip v2's composed final scaleX/scaleY stay within
 * `LAYER_MIN_SCALE..LAYER_MAX_SCALE` across authored timestamps and legacy
 * ScaleEvent boundaries. Used at authoring boundaries, never to silently clamp.
 */
export function assertLayerClipFinalScalesInBounds(
  shot: Shot,
  layer: Layer,
  project: Project,
  extraTimesMs: readonly number[] = [],
): void {
  const clip = layer.animationClip;
  if (!clip || clip.version !== 2) return;
  const events = shot.timelineEvents.filter((event) => event.layerId === layer.id);
  const scaleTracks = clip.tracks.filter(
    (track) =>
      track.property === 'transform.scaleX' || track.property === 'transform.scaleY',
  );
  if (scaleTracks.length === 0) return;

  const checkTimes = new Set<number>([0]);
  for (const timeMs of extraTimesMs) {
    if (Number.isFinite(timeMs)) {
      checkTimes.add(Math.max(0, Math.min(Math.round(timeMs), shot.durationMs)));
    }
  }
  for (const track of scaleTracks) {
    for (const key of track.keys) {
      checkTimes.add(Math.max(0, Math.min(Math.round(key.timeMs), shot.durationMs)));
    }
  }
  const scaleEvents = events.filter(
    (event): event is Extract<TimelineEvent, { type: 'scale' }> =>
      event.type === 'scale',
  );
  for (const event of scaleEvents) {
    checkTimes.add(Math.max(0, Math.min(Math.round(event.startMs), shot.durationMs)));
    checkTimes.add(Math.max(0, Math.min(Math.round(event.endMs), shot.durationMs)));

    if (event.from.x === event.to.x && event.from.y === event.to.y) continue;
    const eventStart = Math.max(0, Math.round(event.startMs));
    const eventEnd = Math.min(shot.durationMs, Math.round(event.endMs));
    if (eventStart >= eventEnd) continue;

    for (const track of scaleTracks) {
      for (let index = 0; index < track.keys.length - 1; index += 1) {
        const fromKey = track.keys[index]!;
        const toKey = track.keys[index + 1]!;
        if (fromKey.value === toKey.value || fromKey.interpolationToNext === 'step') {
          continue;
        }
        const overlapStart = Math.max(eventStart, fromKey.timeMs);
        const overlapEnd = Math.min(eventEnd, toKey.timeMs);
        if (overlapStart >= overlapEnd) continue;

        const startFrame = Math.max(
          0,
          Math.floor((overlapStart * TIMELINE_FPS) / 1_000) - 1,
        );
        const endFrame = Math.max(
          0,
          Math.ceil((overlapEnd * TIMELINE_FPS) / 1_000) + 1,
        );
        for (let frameIndex = startFrame; frameIndex <= endFrame; frameIndex += 1) {
          const frameMs = frameTimeMs(frameIndex, TIMELINE_FPS);
          if (frameMs >= overlapStart && frameMs <= overlapEnd) {
            checkTimes.add(frameMs);
          }
        }
      }
    }
  }

  for (const timeMs of checkTimes) {
    const preTrack = evaluateLayerPreTrackState(shot, layer, timeMs, project, events);
    const relative = evaluateLayerRelativeMotionValues(clip, layer.id, timeMs);
    for (const [axis, preScale, multiplier] of [
      ['scaleX', preTrack.scaleX, relative['transform.scaleX']],
      ['scaleY', preTrack.scaleY, relative['transform.scaleY']],
    ] as const) {
      const finalScale = preScale * multiplier;
      if (
        !Number.isFinite(finalScale) ||
        finalScale < LAYER_MIN_SCALE - FINAL_SCALE_TOLERANCE ||
        finalScale > LAYER_MAX_SCALE + FINAL_SCALE_TOLERANCE
      ) {
        throw new Error(
          `图层最终显示缩放 ${axis}=${finalScale} 超出合法范围（${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE}）。`,
        );
      }
    }
  }
}

/**
 * Deterministic point-state resolver for authored Mouth Cues (`rest | open | none`).
 * Depends strictly on `shot.timelineEvents`, `layerId`, and `requestedTimeMs`.
 */
export function resolveEffectiveMouthCue(
  shot: Shot,
  layerId: string,
  requestedTimeMs: number,
): MouthCueState | 'none' {
  const timeMs = Math.max(
    0,
    Math.min(Math.round(requestedTimeMs), shot.durationMs),
  );
  const effective = shot.timelineEvents
    .filter(
      (event): event is MouthCueEvent =>
        event.type === 'mouth-cue' &&
        event.layerId === layerId &&
        event.startMs <= timeMs,
    )
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  return effective?.state ?? 'none';
}

function resolveAuthoredMouthOpenOverride(
  project: Project,
  layer: Layer,
): {
  assetId?: string;
  mouthOverrideAssetId: string | null;
  mouthOpen?: boolean;
} | null {
  if (layer.source.kind !== 'character') return null;
  const characterId = layer.source.characterId;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (
    !character ||
    (character.mode === 'adaptive-parts' && !character.faceBinding) ||
    (!character.mouthOpenAssetId && !character.mouthOpenVisualSource)
  ) {
    return null;
  }
  const mouthAsset = character.mouthOpenAssetId
    ? project.assets.find((candidate) => candidate.id === character.mouthOpenAssetId)
    : undefined;
  if (!character.mouthOpenVisualSource && mouthAsset?.kind !== 'image') {
    return null;
  }
  return {
    ...(mouthAsset?.kind === 'image' ? { assetId: mouthAsset.id } : {}),
    mouthOverrideAssetId: mouthAsset?.id ?? null,
    ...(character.mouthOpenVisualSource ? { mouthOpen: true } : {}),
  };
}

/**
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
      const preTrack = evaluateLayerPreTrackState(
        shot,
        layer,
        timeMs,
        project,
        eventsByLayer.get(layer.id) ?? [],
      );
      const clip = layer.animationClip;
      const animationValues = clip
        ? evaluateAnimationClipAtTime(clip, timeMs)
        : undefined;
      const faceTransform =
        clip?.version === 3
          ? evaluateCompositeFacePoseAtTime(project, layer, timeMs, animationValues) ??
            undefined
          : undefined;
      const finalTransform: LayerBasePose =
        layer.animationClip?.version === 2 && animationValues
          ? composeAnimatedLayerTransform(
              resolveLayerAnimationBasis(layer.animationClip, {
                kind: 'layer',
                layerId: layer.id,
              }),
              {
                x: preTrack.motion.displayPosition.x,
                y: preTrack.motion.displayPosition.y,
                scaleX: preTrack.scaleX,
                scaleY: preTrack.scaleY,
                rotationDeg: preTrack.rotationDeg,
              },
              preTrack.flipX,
              animationValues,
            )
          : {
              x: preTrack.motion.displayPosition.x,
              y: preTrack.motion.displayPosition.y,
              scaleX: preTrack.scaleX,
              scaleY: preTrack.scaleY,
              rotationDeg: preTrack.rotationDeg,
            };

      const mouthCue =
        layer.source.kind === 'character'
          ? resolveEffectiveMouthCue(shot, layer.id, timeMs)
          : 'none';
      const mouthOpenOverride =
        mouthCue === 'open'
          ? resolveAuthoredMouthOpenOverride(project, layer)
          : null;

      return {
        id: layer.id,
        ...(animationValues ? { animationValues, animationTimeMs: timeMs } : {}),
        ...(faceTransform ? { faceTransform } : {}),
        assetId: mouthOpenOverride?.assetId ?? preTrack.assetId ?? '',
        currentExpressionId: preTrack.currentExpressionId,
        mouthOverrideAssetId: mouthOpenOverride?.mouthOverrideAssetId ?? null,
        ...(mouthOpenOverride?.mouthOpen ? { mouthOpen: true } : {}),
        ...(preTrack.animationFrame
          ? { animationFrame: preTrack.animationFrame }
          : {}),
        anchor: layer.anchor,
        x: finalTransform.x,
        y: finalTransform.y,
        scaleX: finalTransform.scaleX,
        scaleY: finalTransform.scaleY,
        flipX: preTrack.flipX,
        rotationDeg: finalTransform.rotationDeg,
        opacity: preTrack.opacity,
        visible: preTrack.visible && preTrack.animationVisible,
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
