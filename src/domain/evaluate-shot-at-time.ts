import { applyLayerParenting } from './layer-parent-space';
import { resolveLayerAnimationTimeLink } from './animation-time-link';
import {
  applyResolvedCoverageMasks,
  resolveShotCoverageMasks,
  type EvaluatedCoverageMask,
} from './coverage-mask';
import type { AffineMatrix2D } from '../shared/affine-matrix';
import type {
  FlaGraphicDefinition,
  FlaGraphicStructureNode,
  BakedCharacterAction,
  LayeredCharacterAction,
  Layer,
  MouthPose,
  Project,
  Shot,
  TimelineEvent,
  GraphicPlaybackEvent,
} from './models';
import type { MouthCueEvent, MouthCueState } from './models/timeline-event';
import { isFlaGraphicDefinition, type ProjectAnimationDefinition } from './models/animation';
import {
  evaluateFlaVideoClock,
  flaVideoFrameAssetKey,
} from '../shared/fla-video-clock';
import { resolveFlaGraphicPreviewTimeline } from './selectors/animationSourceTimeline';
import {
  collectFlaGraphicTimelineDurationMs,
  type FlaGraphicInternalTimeline,
} from './models/flaGraphicTimeline';
import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from './constants';
import { TIMELINE_FPS, frameTimeMs, isValidFrameTime, isValidSignedFrameTime } from './timeline/frame-grid';
import { evaluateLayerMotionAtTime, type EvaluatedLayerMotion } from './evaluate-layer-motion';
import { evaluateAnimationClipAtTime, evaluateAnimationEase, type EvaluatedAnimationValue } from './evaluate-animation-core';
import {
  evaluateCompositeFacePoseAtTime,
  type EvaluatedCharacterNodePose,
} from './character-node-animation';
import {
  characterBonePoseMap,
  characterBoneProtectedPartIds,
  evaluateCharacterBonePose,
  evaluatedCharacterBonePoseList,
  type EvaluatedCharacterBonePose,
} from './character-bone-pose';
import {
  applyCharacterEndEffectorLocksToValues,
  characterEndEffectorLayerStageMatrix,
  characterEndEffectorLockActiveAt,
  resolveCharacterEndEffectorResidualsFromPose,
  type CharacterEndEffectorResidual,
  type CharacterEndEffectorResidualReason,
} from './character-end-effector-lock';
import {
  composeAnimatedLayerTransform,
  evaluateLayerRelativeMotionValues,
  layerRootMotionClip,
  resolveLayerAnimationBasis,
  type LayerBasePose,
} from './layer-animation';
import { resolveCharacterActionForLayer } from './character-part-animation';
import { evaluateLayerPinWarp, type EvaluatedPinWarp } from './pin-warp';

/**
 * A single evaluated layer at one exact moment. Its formal fields remain
 * compatible with the legacy evaluator so `shared/stage/render-model.ts` can
 * consume it; optional runtime projection fields stay transient. `assetId` is
 * the resolved image asset used by the renderer (for character layers this is
 * the active expression's asset).
 */
export interface EvaluatedLayer {
  visualEffects?: import('./models/layerVisualEffects').LayerVisualEffects;
  /**
   * Resolved author-level coverage mask relation for this exact frame (#1454).
   * A `mask-layer` Layer supplies coverage and must not be drawn as ordinary
   * output; a `masked-target` Layer is clipped by `maskLayerId`.
   */
  coverageMask?: EvaluatedCoverageMask;
  /** Inherited affine space. The ordinary pose and animation tracks stay local. */
  parentSpace?: AffineMatrix2D;
  parentSpaceUnavailable?: true;
  parentAttachmentFallback?: true;
  control?: true;
  effectiveDepth?: number;
  effectiveCameraSpace?: 'world' | 'screen';
  /** Transient Animation Core values at the same absolute Shot time. */
  animationValues?: EvaluatedAnimationValue[];
  /** Absolute Shot timestamp used for both outer motion and Graphic internal playback. */
  animationTimeMs?: number;
  /** Transient evaluated Composite Face pose for Character Node Clip v3. */
  faceTransform?: EvaluatedCharacterNodePose;
  /**
   * Deterministic parent-first FK Bone pose map for an Adaptive Parts Character
   * instance (#1455). Transient, plain serializable matrices; Stage, Preview and
   * Export derive the same Part matrices from this evaluation seam.
   */
  characterBonePose?: EvaluatedCharacterBonePose[];
  /**
   * Transient per-Layer end-effector lock feedback (#1456). Present only when
   * an authored lock is active at this time and either could not be reached or
   * was skipped because a higher-priority lock owns a shared ancestor.
   */
  endEffectorResiduals?: CharacterEndEffectorResidual[];
  /**
   * Transient bitmap pin-warp evaluation for this exact frame (#1460). Present
   * only for Layers that author `pinWarp`; Stage, Preview, Export, and the
   * editor all consume this one evaluated mesh. `invalid` means the local
   * degradation path (draw the ordinary un-warped image).
   */
  pinWarp?: EvaluatedPinWarp;
  id: string;
  assetId: string;
  /** The formal Expression state before any transient Mouth projection. */
  currentExpressionId?: string | null;
  /** The transient Mouth asset projected after formal evaluation, if any. */
  mouthOverrideAssetId?: string | null;
  mouthOpen?: boolean;
  mouthPose?: MouthPose;
  /** Transient named Character action replacing the base Character visual. */
  characterAction?: BakedCharacterAction;
  layeredCharacterAction?: { action: LayeredCharacterAction; localTimeMs: number };
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function eventEasing(event: TimelineEvent): 'linear' | 'ease-in-out' {
  if (event.type === 'scale') {
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
  timeMs = 0,
): ResolvedLayerVisualState {
  if (layer.source.kind === 'asset') {
    return { assetId: layer.source.assetId, currentExpressionId: null };
  }
  if (layer.source.kind === 'video') {
    const videoAssetId = layer.source.assetId;
    const asset = project.assets.find((candidate) => candidate.id === videoAssetId);
    if (!asset || asset.kind !== 'video') {
      return { assetId: null, currentExpressionId: null };
    }
    const sample = evaluateFlaVideoClock({
      shotTimeMs: timeMs,
      layerStartTimeMs: layer.startTimeMs ?? 0,
      timing: asset.videoTiming,
      playbackMode: layer.source.playbackMode,
      trimStartMs: layer.source.trimStartMs,
      trimEndMs: layer.source.trimEndMs,
      heldFrameIndex: layer.source.heldFrameIndex,
      sourceFps: layer.source.sourceFps,
    });
    return {
      assetId: sample ? flaVideoFrameAssetKey(asset.id, sample.sampleIndex) : null,
      currentExpressionId: null,
    };
  }
  if (layer.source.kind === 'animation' || layer.source.kind === 'control') {
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

function resolveCharacterActionHoldTimeMs(animation: ProjectAnimationDefinition): number {
  const outerEnd = Math.max(0, animation.durationMs - 1);
  if (!isFlaGraphicDefinition(animation) || animation.frames.length !== 1) return outerEnd;

  const timeline = resolveFlaGraphicPreviewTimeline(animation, true);
  if (!timeline.hasInternalTimeline) return outerEnd;
  const lastFrame = timeline.sampleAtFrameIndex(timeline.totalFrames - 1);
  // Sample the terminal authored pose so a nested Graphic does not wrap
  // while the outer action is holding at the end of its source.
  return Math.max(timeline.timelineDurationMs, lastFrame.internalTimeMs ?? 0);
}

function elapsedAnimationSourcePosition(timeMs: number, startTimeMs: number, sourceFps: number): number {
  // Resolve on-grid stamps (including negative signed frame offsets) as frame indices so 958 ms is frame 23 at 24 fps.
  return isValidFrameTime(timeMs) && isValidSignedFrameTime(startTimeMs)
    ? (Math.round(timeMs * TIMELINE_FPS / 1_000) - Math.round(startTimeMs * TIMELINE_FPS / 1_000)) *
      sourceFps / TIMELINE_FPS
    : (timeMs - startTimeMs) * sourceFps / 1_000;
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
  const elapsedSourcePosition = elapsedAnimationSourcePosition(timeMs, startTimeMs, animation.source.sourceFps);
  const elapsedSourceFrames = Math.floor(Math.max(0, elapsedSourcePosition));
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
  animation: ProjectAnimationDefinition | undefined,
  startTimeMs: number,
  firstFrameIndex: number,
  playback: NonNullable<Layer['animationPlayback']>,
  timeMs: number,
  selectedSourceFrameIndex?: number,
  range?: Layer['animationSourceRange'],
  rangeFirstFrame?: number,
): ResolvedLayerVisualState {
  if (!animation || animation.frames.length === 0) {
    return {
      assetId: null,
      currentExpressionId: null,
      animationVisible: false,
    };
  }
  const selectedSample = selectedSourceFrameIndex !== undefined && isFlaGraphicDefinition(animation)
    ? resolveFlaGraphicPreviewTimeline(animation, true).sampleAtFrameIndex(selectedSourceFrameIndex - animation.source.startFrameIndex)
    : undefined;
  const state = range
    ? resolveAnimationSegmentFrame(animation, range, startTimeMs, playback, timeMs, rangeFirstFrame)
    : resolveAnimationPlaybackFrameState(animation, startTimeMs, firstFrameIndex, playback, timeMs);
  if (!state) {
    return {
      assetId: null,
      currentExpressionId: null,
      animationVisible: false,
    };
  }
  const { elapsedMs, completedOnce } = state;
  const frame = selectedSample ? animation.frames[selectedSample.frameOrdinal] ?? state.frame : state.frame;
  const internalTimeMs = selectedSample?.internalTimeMs ?? state.internalTimeMs;
  return {
    // Native FLA Graphic Definitions have no baked frame media asset; the
    // structured animationFrame below is their display source.
    assetId: frame.assetId ?? null,
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

function resolveAnimationSegmentFrame(
  animation: ProjectAnimationDefinition,
  range: NonNullable<Layer['animationSourceRange']>,
  startTimeMs: number,
  playback: NonNullable<Layer['animationPlayback']>,
  timeMs: number,
  firstFrame = range.firstFrame,
): AnimationPlaybackFrameState<ProjectAnimationDefinition['frames'][number]> | null {
  const timeline = resolveFlaGraphicPreviewTimeline(animation, true);
  if (range.lastFrame >= timeline.totalFrames) return null;
  const elapsedMs = timeMs - startTimeMs;
  const elapsedFrames = Math.max(0, elapsedAnimationSourcePosition(timeMs, startTimeMs, timeline.fps));
  const length = range.lastFrame - range.firstFrame + 1;
  const position = firstFrame - range.firstFrame + elapsedFrames;
  const completedOnce = position >= length;
  const local = playback.mode === 'single-frame' ? firstFrame - range.firstFrame
    : playback.mode === 'loop' ? position % length
    : completedOnce ? length - 1 : position;
  const sourceFrameIndex = range.firstFrame + Math.floor(local);
  const { frameOrdinal } = timeline.sampleAtFrameIndex(sourceFrameIndex);
  const frame = animation.frames[frameOrdinal];
  if (!frame) return null;
  return {
    frame, sourceFrameIndex, elapsedMs, completedOnce,
    internalTimeMs: (range.firstFrame + local) * 1_000 / timeline.fps,
  };
}

export function findGraphicPlaybackAtTime(
  events: readonly TimelineEvent[],
  layerId: string,
  animationId: string,
  timeMs: number,
): GraphicPlaybackEvent | undefined {
  return events.find((event): event is GraphicPlaybackEvent => event.type === 'graphic-playback' &&
    event.layerId === layerId && event.animationId === animationId && event.startMs <= timeMs && timeMs < event.endMs);
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
  graphicFrameTimeMs?: number,
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
  const animation = animationSource
    ? project.animations.find((entry) => entry.id === animationSource.animationId)
    : undefined;
  const graphicTimeMs = animation && isFlaGraphicDefinition(animation)
    ? graphicFrameTimeMs ?? timeMs
    : timeMs;
  const resolvedTimeLink = animationSource
    ? resolveLayerAnimationTimeLink(shot, layer)
    : { status: 'none' as const };
  const activeTimeLink =
    resolvedTimeLink.status === 'active' ? resolvedTimeLink : null;
  const effectiveStartTimeMs = activeTimeLink
    ? activeTimeLink.startMs
    : (layer.startTimeMs ?? 0);
  const insideTimeLinkWindow = activeTimeLink
    ? !activeTimeLink.outOfShotBounds &&
      graphicTimeMs >= activeTimeLink.visibleStartMs &&
      graphicTimeMs < activeTimeLink.visibleEndMs
    : true;
  const events = [...(eventsOverride ?? shot.timelineEvents.filter((event) => event.layerId === layer.id))].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
  const playbackRange = animationSource && graphicTimeMs >= effectiveStartTimeMs
    ? findGraphicPlaybackAtTime(events, layer.id, animationSource.animationId, graphicTimeMs)
    : undefined;
  const frameSwitch = !playbackRange && animationSource && events.filter((event) =>
    event.type === 'graphic-frame' && event.animationId === animationSource.animationId && event.startMs <= graphicTimeMs).at(-1);
  const initialVisual = animationSource && playbackRange
    ? resolveAnimationFrame(animation, playbackRange.playbackStartMs,
        playbackRange.firstFrame, playbackRange.playback, graphicTimeMs, undefined, playbackRange.range, playbackRange.firstFrame)
    : animationSource
    ? resolveAnimationFrame(
        animation,
        effectiveStartTimeMs,
        layer.animationFirstFrame ?? 0,
        layer.animationPlayback ?? { mode: 'once', endBehavior: 'hold' },
        graphicTimeMs,
        frameSwitch && frameSwitch.type === 'graphic-frame' ? frameSwitch.sourceFrameIndex : undefined,
        layer.animationSourceRange,
      )
    : resolveLayerVisualState(project, layer, timeMs);
  const animationVisible = (initialVisual.animationVisible ?? true) && insideTimeLinkWindow;
  let assetId = initialVisual.assetId;
  let currentExpressionId = initialVisual.currentExpressionId;

  const motion = evaluateLayerMotionAtTime(
    { id: layer.id, x: basePose.x, y: basePose.y },
    events,
    graphicTimeMs,
  );
  let controlledByMove = false;
  let controlledByScale = false;

  for (const event of events) {
    if (event.type === 'move') {
      if (graphicTimeMs >= event.startMs) controlledByMove = true;
      // Position + Shake are resolved by the single formal motion seam above.
      continue;
    }
    if (event.type === 'shake') {
      continue;
    }
    if (event.type === 'visibility') {
      if (graphicTimeMs >= event.startMs) visible = event.visible;
      continue;
    }
    // Future events (timeMs before the event starts) must not participate
    // in evaluation: skipping them leaves the layer at its base state
    // (or the state produced by earlier events) instead of overwriting it
    // with `from`. Events whose start has passed keep contributing — for
    // timeMs > endMs `rawProgress` resolves to 1, applying the final state.
    if (graphicTimeMs < event.startMs) {
      continue;
    }
    const span = Math.max(1, event.endMs - event.startMs);
    const rawProgress =
      graphicTimeMs < event.startMs
        ? 0
        : graphicTimeMs > event.endMs
          ? 1
          : (graphicTimeMs - event.startMs) / span;
    const progress = event.type === 'opacity'
      ? evaluateAnimationEase(rawProgress, event.easing, event.curveToNext)
      : evaluateAnimationEase(rawProgress, eventEasing(event));

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
  const clip = layerRootMotionClip(layer);
  if (!clip) return;
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
 * Normalizes a requested Shot timestamp to an integer millisecond value
 * clamped within `[0, durationMs]`, matching `evaluateShotAtTime`.
 */
export function normalizeShotTimeMs(
  requestedTimeMs: number,
  durationMs: number,
): number {
  return Math.max(0, Math.min(Math.round(requestedTimeMs), durationMs));
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
  const timeMs = normalizeShotTimeMs(requestedTimeMs, shot.durationMs);
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
  options?: { graphicFrameTimeMs?: number; includeShake?: boolean },
): EvaluatedShot {
  const timeMs = normalizeShotTimeMs(requestedTimeMs, shot.durationMs);
  // Author-level coverage mask relations are resolved once from the authored
  // Shot and projected onto the evaluated Layers; Renderers never re-derive
  // them. Invalid relations degrade locally instead of failing the frame.
  const coverageMaskResolution = resolveShotCoverageMasks(shot);

  const eventsByLayer = new Map<string, TimelineEvent[]>();
  for (const event of shot.timelineEvents) {
    if (options?.includeShake === false && event.type === 'shake') continue;
    const list = eventsByLayer.get(event.layerId) ?? [];
    list.push(event);
    eventsByLayer.set(event.layerId, list);
  }

  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EvaluatedLayer => {
      const actionEvent = layer.source.kind === 'character'
        ? (eventsByLayer.get(layer.id) ?? []).find((event) =>
            event.type === 'character-action' &&
            event.startMs <= timeMs &&
            timeMs < event.endMs,
          )
        : undefined;
      const characterId = layer.source.kind === 'character'
        ? layer.source.characterId
        : undefined;
      const character = characterId
        ? project.characters.find((candidate) => candidate.id === characterId)
        : undefined;
      // #1449: an instance-scoped action copy is only playable by the Layer
      // that owns it. A foreign reference degrades to the shared origin action
      // and never silently shares the private copy.
      const characterAction = actionEvent?.type === 'character-action'
        ? resolveCharacterActionForLayer(character, actionEvent.actionId, layer.id)
        : undefined;
      const bakedAction = characterAction && 'animationId' in characterAction ? characterAction : undefined;
      const actionAnimation = bakedAction
        ? project.animations.find((candidate) => candidate.id === bakedAction.animationId)
        : undefined;
      const actionFrame = actionEvent?.type === 'character-action' && actionAnimation
        ? resolveAnimationPlaybackFrameState(
            actionAnimation,
            actionEvent.startMs,
            0,
            { mode: 'once', endBehavior: 'hold' },
            timeMs,
          )
        : null;
      const activeCharacterAction = bakedAction && actionAnimation && actionFrame
        ? bakedAction
        : undefined;
      const layeredCharacterAction = characterAction && 'kind' in characterAction && actionEvent
        ? { action: characterAction, localTimeMs: timeMs - actionEvent.startMs }
        : undefined;
      const preTrack = evaluateLayerPreTrackState(
        shot,
        layer,
        timeMs,
        project,
        eventsByLayer.get(layer.id) ?? [],
        options?.graphicFrameTimeMs,
      );
      // #1460: the pin-warp mesh is resolved once per frame by the single
      // formal evaluator; renderers never re-derive poses or deformation.
      // Asset lookup stays inside the authored-warp branch so a Layer without
      // `pinWarp` takes the exact pre-#1460 evaluation path (and structural
      // probe callers without a full Project are unaffected).
      let pinWarpAsset: { readonly width: number; readonly height: number; readonly kind: string } | null = null;
      if (layer.pinWarp && layer.source.kind === 'asset') {
        const sourceAssetId = layer.source.assetId;
        const sourceAsset = project.assets.find(
          (candidate) => candidate.id === sourceAssetId,
        );
        if (sourceAsset?.kind === 'image') pinWarpAsset = sourceAsset;
      }
      const pinWarp = layer.pinWarp
        ? evaluateLayerPinWarp({
            pinWarp: layer.pinWarp,
            sourceKind: layer.source.kind,
            asset: pinWarpAsset,
            timeMs,
          })
        : undefined;
      const clip = layer.animationClip;
      const clipTimeMs =
        clip?.version === 2 && options?.graphicFrameTimeMs !== undefined
          ? options.graphicFrameTimeMs
          : timeMs;
      const rootMotionClip = layerRootMotionClip(layer);
      const animationValues = clip
        ? evaluateAnimationClipAtTime(clip, clipTimeMs)
        : undefined;
      const faceTransform =
        clip?.version === 3
          ? evaluateCompositeFacePoseAtTime(project, layer, timeMs, animationValues) ??
            undefined
          : undefined;
      const characterBonePose =
        clip?.version === 1 &&
        character?.mode === 'adaptive-parts' &&
        (character.bones?.length ?? 0) > 0
          ? evaluatedCharacterBonePoseList(
              evaluateCharacterBonePose({
                character,
                values: animationValues ?? [],
                layerId: layer.id,
              }),
            )
          : undefined;
      const finalTransform: LayerBasePose =
        rootMotionClip
          ? composeAnimatedLayerTransform(
              resolveLayerAnimationBasis(rootMotionClip, {
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
              clip === rootMotionClip && animationValues ? animationValues : evaluateAnimationClipAtTime(rootMotionClip, timeMs),
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
        ...(pinWarp ? { pinWarp } : {}),
        ...(animationValues ? { animationValues, animationTimeMs: timeMs } : {}),
        ...(faceTransform ? { faceTransform } : {}),
        ...(characterBonePose?.length ? { characterBonePose } : {}),
        assetId: actionFrame?.frame.assetId ?? mouthOpenOverride?.assetId ?? preTrack.assetId ?? '',
        currentExpressionId: preTrack.currentExpressionId,
        ...(activeCharacterAction ? { characterAction: activeCharacterAction } : {}),
        ...(layeredCharacterAction ? { layeredCharacterAction } : {}),
        mouthOverrideAssetId: mouthOpenOverride?.mouthOverrideAssetId ?? null,
        ...(mouthOpenOverride?.mouthOpen ? { mouthOpen: true } : {}),
        ...(actionFrame && actionAnimation
          ? {
              animationFrame: {
                animationId: actionAnimation.id,
                frameOrdinal: actionFrame.frame.ordinal,
                internalTimeMs: Math.min(
                  actionFrame.internalTimeMs,
                  resolveCharacterActionHoldTimeMs(actionAnimation),
                ),
                offset: actionFrame.frame.offset,
                viewport: {
                  width: actionFrame.frame.sourceViewport.width,
                  height: actionFrame.frame.sourceViewport.height,
                },
                canvas: actionAnimation.source.canvas,
              },
            }
          : preTrack.animationFrame
          ? { animationFrame: preTrack.animationFrame }
          : {}),
        ...(layer.source.kind === 'control' ? { control: true } : {}),
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
        ...(layer.visualEffects ? { visualEffects: layer.visualEffects } : {}),
      };
    });

  // The mask projection is resolved exactly once, after the final bone /
  // parent-space evaluation. The end-effector lock pass (#1456) re-parents the
  // Shot from the raw Layers, so projecting masks before it would drop them on
  // every solved frame (#1464 R1).
  const parentedLayers = applyLayerParenting(project, shot, layers, timeMs);
  if (!shot.layers.some((layer) => (layer.endEffectorLocks?.length ?? 0) > 0)) {
    // No authored locks: keep the byte-identical pre-#1456 evaluation path.
    return {
      shotId: shot.id,
      timeMs,
      backgroundLayerId: shot.backgroundLayerId,
      layers: applyResolvedCoverageMasks(parentedLayers, coverageMaskResolution),
    };
  }
  const lockedLayers = applyEndEffectorLocks(
    project,
    shot,
    layers,
    parentedLayers,
    timeMs,
  );
  return {
    shotId: shot.id,
    timeMs,
    backgroundLayerId: shot.backgroundLayerId,
    layers: applyResolvedCoverageMasks(lockedLayers, coverageMaskResolution),
  };
}

interface ActiveEndEffectorLockCandidate {
  readonly character: Extract<Project['characters'][number], { mode: 'adaptive-parts' }>;
  readonly locks: readonly NonNullable<Layer['endEffectorLocks']>[number][];
  readonly fixedCharacterCenter: { readonly x: number; readonly y: number };
}

/**
 * #1456 end-effector lock post-pass. It runs inside the formal evaluation path
 * after the Layer world/parent space is known, then reparents at most twice so
 * an attachment target that follows a solved Bone sees the final Part matrix.
 * Only Layers with an active lock are touched, so a project without locks is
 * evaluated byte-identically through the early return above.
 */
function applyEndEffectorLocks(
  project: Project,
  shot: Shot,
  baseLayers: EvaluatedLayer[],
  parentedLayers: EvaluatedLayer[],
  timeMs: number,
): EvaluatedLayer[] {
  const candidates = new Map<string, ActiveEndEffectorLockCandidate>();
  for (const layer of shot.layers) {
    const locks = layer.endEffectorLocks;
    if (!locks?.length) continue;
    const activeLocks = locks.filter((lock) => characterEndEffectorLockActiveAt(lock, timeMs));
    if (activeLocks.length === 0) continue;
    const source = layer.source;
    if (source.kind !== 'character') continue;
    if (layer.animationClip?.version !== 1) continue;
    const character = project.characters.find(({ id }) => id === source.characterId);
    if (character?.mode !== 'adaptive-parts' || !character.bones?.length) continue;
    candidates.set(layer.id, {
      character,
      locks: activeLocks,
      fixedCharacterCenter: layer.animationClip.fixedCharacterCenter,
    });
  }
  if (candidates.size === 0) return parentedLayers;

  let currentLayers = baseLayers;
  let parented = parentedLayers;
  const structuralReasonsByLayerId = new Map<
    string,
    ReadonlyMap<string, CharacterEndEffectorResidualReason>
  >();
  for (let pass = 0; pass < 2; pass += 1) {
    const spacesById = new Map(parented.map((layer) => [layer.id, layer.parentSpace]));
    let solvedThisPass = false;
    currentLayers = currentLayers.map((layer): EvaluatedLayer => {
      const candidate = candidates.get(layer.id);
      if (!candidate || !layer.animationValues) return layer;
      const localToStage = characterEndEffectorLayerStageMatrix(
        { ...layer, parentSpace: spacesById.get(layer.id) },
        candidate.fixedCharacterCenter,
      );
      const applied = applyCharacterEndEffectorLocksToValues({
        character: candidate.character,
        values: layer.animationValues,
        layerId: layer.id,
        locks: candidate.locks,
        localToStage,
        protectedPartIds: characterBoneProtectedPartIds(candidate.character),
        timeMs,
      });
      structuralReasonsByLayerId.set(layer.id, applied.structuralReasons);
      if (applied.solvedBoneIds.length === 0) return layer;
      solvedThisPass = true;
      const poses = evaluateCharacterBonePose({
        character: candidate.character,
        values: applied.values,
        layerId: layer.id,
      });
      return {
        ...layer,
        animationValues: applied.values,
        characterBonePose: evaluatedCharacterBonePoseList(poses),
      };
    });
    if (!solvedThisPass) break;
    const nextParented = applyLayerParenting(project, shot, currentLayers, timeMs);
    const nextSpaces = new Map(nextParented.map((layer) => [layer.id, layer.parentSpace]));
    let spacesStable = true;
    for (const [layerId, space] of spacesById) {
      if (JSON.stringify(space ?? null) !== JSON.stringify(nextSpaces.get(layerId) ?? null)) {
        spacesStable = false;
        break;
      }
    }
    parented = nextParented;
    if (spacesStable) break;
  }
  // #1469: re-measure every active lock against the FINAL returned Layers,
  // i.e. the final FK pose in the final parent space. The solve loop above may
  // run a second parent-space pass, so a residual measured mid-loop would
  // otherwise describe a superseded position.
  const finalSpacesById = new Map(parented.map((layer) => [layer.id, layer.parentSpace]));
  return parented.map((layer): EvaluatedLayer => {
    const candidate = candidates.get(layer.id);
    if (!candidate) return layer;
    const localToStage = characterEndEffectorLayerStageMatrix(
      { ...layer, parentSpace: finalSpacesById.get(layer.id) },
      candidate.fixedCharacterCenter,
    );
    const poses = layer.characterBonePose
      ? characterBonePoseMap(layer.characterBonePose)
      : evaluateCharacterBonePose({
          character: candidate.character,
          values: layer.animationValues ?? [],
          layerId: layer.id,
        });
    const residuals = resolveCharacterEndEffectorResidualsFromPose({
      character: candidate.character,
      poses,
      locks: candidate.locks,
      localToStage,
      timeMs,
      structuralReasons: structuralReasonsByLayerId.get(layer.id),
    });
    return residuals.length > 0 ? { ...layer, endEffectorResiduals: residuals } : layer;
  });
}
