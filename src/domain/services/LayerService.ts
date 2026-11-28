import { resolveLayerAnimationTimeLink } from '../animation-time-link';
import { layerAttachmentTargetKey, resolveLayerAttachmentLocalMatrix } from '../layer-attachment';
import { layerAttachmentWorldMatrix } from '../layer-parent-space';
import { projectShotDialogueVisual } from '../selectors/temporalRender';
import type { LayerAttachmentTarget, LayerParentKey, LayerParentKeyDepthMode } from '../models';
import { resolveTimelineFrameTime } from '../timeline/frame-grid';
import type { FlaInstanceColor } from '../../shared/fla-instance-color';
import { FlaGraphicInstanceTextOverridesSchema } from '../models/flaGraphicInstanceText';
import {
  LAYER_DEPTH_MAX,
  LAYER_DEPTH_MIN,
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  calculateCoverTransform,
  normalizeGeneratedStagePoint,
  planBackgroundTiles,
  sampleScrollingTile,
  sampleOrbitFlight,
  sampleConvergingFlight,
  type BackgroundTileInput,
  type ConvergingFlightInput,
  type OrbitFlightInput,
  normalizeNegativeZero,
  RADIAL_BURST_MAX_COUNT,
  RADIAL_BURST_MAX_SEED,
  RADIAL_BURST_MIN_COUNT,
  samplePathArrayLayout,
  sampleRadialArrayLayout,
  sampleRadialBurstInstances,
  STATIC_ARRAY_MAX_COUNT,
  STATIC_ARRAY_MIN_COUNT,
  type CubicBezier2D,
  type Point,
  type ShapeMorphFailureCode,
  type StaticArrayOrientationMode,
} from '../geometry';
import { evaluateAnimationEase } from '../evaluate-animation-core';
import {
  FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN,
  isFlaGraphicDefinition,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  ProjectSchema,
  type AnimationPlayback,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Layer,
  type Project,
  type Shot,
  type TimelineEvent,
} from '../models';
import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../../shared/affine-matrix';
import { NameSchema } from '../models/common';
import { LayerCoverageMaskTargetsSchema } from '../models/layerCoverageMask';
import { assertCoverageMaskChange, resolveShotCoverageMasks } from '../coverage-mask';
import { hasLayerVisualEffects, LayerVisualEffectsSchema, type LayerVisualEffects } from '../models/layerVisualEffects';
import { AnimationSourceRangeSchema, type AnimationSourceRange } from '../models/animationSourceRange';
import { ReusableAnimationSegmentSchema, type ReusableAnimationSegment } from '../models/reusableAnimationSegment';
import { resolveFlaGraphicPreviewTimeline } from '../selectors/animationSourceTimeline';
import {
  cloneFlaEditableShapeRegion,
  cloneFlaGraphicShapeNodeOverride,
  cloneFlaGraphicShapeOverrides,
  decomposeSvgToEditableShapeRegions,
  findFlaExtractedShapeRegionByPath,
  moveFlaShapeRegionVertex as moveShapeRegionVertexPure,
  setFlaShapeRegionSolidFillColor as setShapeRegionSolidFillColorPure,
  type FlaEditableShapeRegion,
  type FlaGraphicShapeNodeOverride,
  type FlaGraphicShapeOverrides,
  type FlaShapeVertexTarget,
} from '../fla-shape-vector';
import {
  cloneFlaGraphicInstanceTransformOverrides,
  findFlaGraphicStructureNodeAtPath,
  flaGraphicInstanceNodePathKey,
  getFlaGraphicInstanceTransformOverride,
  pruneFlaGraphicInstanceTransformOverrides,
  setFlaGraphicInstanceTransformOverride,
  updateFlaGraphicStructureAuthoredTransform,
} from '../models/flaGraphicInstanceOverrides';
import {
  addFlaGraphicTimelineKeyframe as addTimelineKeyframePure,
  clearFlaGraphicNodeIdentityAlias as clearNodeIdentityAliasPure,
  deleteFlaGraphicTimelineKeyframe as deleteTimelineKeyframePure,
  duplicateFlaGraphicTimelineKeyframe as duplicateTimelineKeyframePure,
  evaluateFlaGraphicTrackAtTime,
  isAffineMatrixTimelineRepresentable,
  isFlaGraphicTransformTrackInterpolationSafe,
  listFlaGraphicIdentityAliasAssignments,
  moveFlaGraphicTimelineKeyframe as moveTimelineKeyframePure,
  resolveFlaGraphicTimelineTarget,
  setFlaGraphicNodeIdentityAlias as setNodeIdentityAliasPure,
  setFlaGraphicTimelineKeyframeEasing as setTimelineKeyframeEasingPure,
  updateFlaGraphicTimelineKeyframeTransform as updateTimelineKeyframeTransformPure,
  withFlaGraphicContainerTimeline,
  type FlaGraphicInternalTimeline,
  type FlaGraphicTimelineTargetInfo,
  type FlaGraphicTransformEasing,
} from '../models/flaGraphicTimeline';
import {
  FLA_SHAPE_TWEEN_MAX_HINTS,
  findFlaShapeTweenTrackById,
  findFlaShapeTweenTrackForTarget,
  flaShapeTweenTargetKey,
  prepareFlaShapeTweenTrack,
  resolveFlaShapeTweenPoseEdit,
  sameFlaShapeTweenStyle,
  stableFlaShapeTweenHintId,
  toFlaShapeTweenHintLocation,
  withFlaShapeTweenHintLocations,
  withFlaShapeTweenHints,
  withFlaShapeTweenTrack,
  withoutFlaShapeTweenTrack,
  type FlaShapeTweenEasing,
  type FlaShapeTweenHint,
  type FlaShapeTweenHintLocation,
  type FlaShapeTweenTarget,
  type FlaShapeTweenTrack,
} from '../models/flaShapeTween';
import type { AssetDropPayload } from '../assetDropPayload';
import { resolveBackgroundSourceDimensions } from '../selectors/canvasLayers';
import {
  createLayerAnimationClip,
  duplicateLayerAnimationClip,
  evaluateLayerRelativeMotionValues,
  layerPivotLocalOffset,
  solveLayerRelativeOffsetForStagePoint,
  type LayerBasePose,
} from '../layer-animation';
import {
  type EvaluatedLayer,
  evaluateLayerPreTrackState,
  evaluateShotAtTime,
} from '../evaluate-shot-at-time';
import {
  frameTimeMs,
  isValidFrameTime,
  lastValidFrameTime,
  TIMELINE_FPS,
} from '../timeline/frame-grid';
import type { AnimationKey, LayerAnimationClip } from '../models/animationCore';
import { PositionProjectService } from './PositionProjectService';
import {
  batchBaseParentEditCreatesCycle,
  evaluatedLayerWorldMatrix,
  parentKeyEditCreatesCycle,
  validLayerParentTargets,
} from '../layer-parent-space';
import { remapLayerMotionOwner, syncLayerAnimationClipBasis } from '../layer-animation';

function clampLayerDepth(depth: number): number {
  return Math.max(LAYER_DEPTH_MIN, Math.min(LAYER_DEPTH_MAX, depth));
}

function preservedDetachedDepth(
  layer: Pick<Layer, 'depth' | 'depthKeys'>,
  pose: Pick<EvaluatedLayer, 'effectiveDepth'> | undefined,
): number | undefined {
  if (layer.depthKeys?.length || layer.depth !== undefined) return layer.depth;
  const inherited = pose?.effectiveDepth;
  if (inherited === undefined || !Number.isFinite(inherited)) return undefined;
  return clampLayerDepth(inherited);
}

function frozenParentKeyDepth(
  layer: Pick<Layer, 'depth' | 'depthKeys'>,
  pose: Pick<EvaluatedLayer, 'effectiveDepth'> | undefined,
  forceZeroWhenPreserving = false,
): number | undefined {
  if (layer.depthKeys?.length) return undefined;
  const effective = pose?.effectiveDepth;
  if (effective === undefined || !Number.isFinite(effective)) {
    return forceZeroWhenPreserving && layer.depth === undefined ? 0 : undefined;
  }
  if (layer.depth !== undefined && Math.abs(effective - layer.depth) <= 1e-6) {
    return undefined;
  }
  return clampLayerDepth(effective);
}

function frozenDetachedKeyCameraSpace(
  layer: Pick<Layer, 'cameraSpace'>,
  pose: Pick<EvaluatedLayer, 'effectiveCameraSpace'> | undefined,
): 'world' | 'screen' | undefined {
  if (pose?.effectiveCameraSpace === 'screen') return 'screen';
  if (layer.cameraSpace === 'screen') return 'world';
  return undefined;
}

export interface SetParentKeyOptions {
  readonly target?: LayerAttachmentTarget;
  readonly depthMode?: LayerParentKeyDepthMode;
}

interface BakedGraphicSample {
  readonly frame: number;
  readonly position: Point;
  readonly rotationDeg?: number;
  readonly scaleMultiplier?: number;
}

export interface DiffusionGhostInput {
  readonly count: number;
  readonly maxScale: number;
  readonly decay: number;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly staggerFrames: number;
}

type BakedGraphicEvent =
  | Omit<Extract<TimelineEvent, { type: 'visibility' }>, 'id' | 'layerId'>
  | Omit<Extract<TimelineEvent, { type: 'opacity' }>, 'id' | 'layerId'>;

function bakedVisibility(frame: number, visible: boolean): BakedGraphicEvent {
  const timeMs = frameTimeMs(frame);
  return { type: 'visibility', startMs: timeMs, endMs: timeMs, visible };
}

function validateBakeFrames(shot: Shot, start: number, duration: number, stagger: number, count: number, minimumDuration = 1): number {
  const lastFrame = Math.round(lastValidFrameTime(shot.durationMs) * TIMELINE_FPS / 1000);
  const end = start + duration + (count - 1) * stagger;
  if (!Number.isSafeInteger(start) || start < 0 ||
    !Number.isSafeInteger(duration) || duration < minimumDuration ||
    !Number.isSafeInteger(stagger) || stagger < 0 ||
    !Number.isSafeInteger(end) || end > lastFrame) {
    throw new Error(`请调整起帧、持续时间或间隔，结束帧须在镜头末帧 ${lastFrame} 以内。`);
  }
  if (count * (duration + 1) > 50_000) throw new Error('生成的关键帧过多，请减少实例或缩短持续时间。');
  return lastFrame;
}

export type LayerServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'LAYER_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_TYPE_MISMATCH'
  | 'BACKGROUND_LAYER_INVALID'
  | 'CHARACTER_IDENTITY_MISMATCH'
  | 'ANIMATION_NOT_FOUND'
  | 'ANIMATION_LAYER_REQUIRED'
  | 'INVALID_ANIMATION_START_TIME'
  | 'INVALID_ANIMATION_PLAYBACK'
  | 'ANIMATION_FRAME_INVALID'
  | 'INVALID_POSITION'
  | 'INVALID_TRANSFORM'
  | 'BACKGROUND_COVER_INVALID'
  | 'BACKGROUND_LAYER_PROTECTED'
  | 'LAYER_LOCKED'
  | 'ID_GENERATION_FAILED'
  | 'FLA_GRAPHIC_REQUIRED'
  | 'COVERAGE_MASK_CONTROL_LAYER'
  | 'COVERAGE_MASK_LAYER_CONFLICT'
  | 'SHAPE_SVG_REQUIRED'
  | 'SHAPE_NO_EDITABLE_REGIONS'
  | 'SHAPE_NODE_REQUIRED'
  | 'SHAPE_BITMAP_FILL_UNSUPPORTED'
  | 'SHAPE_AMBIGUOUS_STROKES'
  | 'SHAPE_REGION_NOT_FOUND'
  | 'SHAPE_REGION_REQUIRED'
  | 'SHAPE_FILL_NOT_SOLID'
  | 'SHAPE_TWEEN_DEFINITION_ONLY'
  | 'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED'
  | 'SHAPE_TWEEN_REGION_REQUIRED'
  | 'SHAPE_TWEEN_DUPLICATE'
  | 'SHAPE_TWEEN_NOT_FOUND'
  | 'SHAPE_TWEEN_TARGET_UNSUPPORTED'
  | 'SHAPE_TWEEN_MID_RANGE_READONLY'
  | 'SHAPE_TWEEN_INVALID_TIME'
  | 'SHAPE_TWEEN_HINT_LIMIT'
  | 'INVALID_GRID_ARRAY'
  | 'INVALID_RADIAL_ARRAY'
  | 'INVALID_PATH_ARRAY'
  | 'INVALID_AFTERIMAGE'
  | 'INVALID_RADIAL_BURST'
  | 'NODE_IDENTITY_TARGET_NOT_FOUND'
  | 'NODE_IDENTITY_OPAQUE'
  | 'NODE_IDENTITY_PROVEN'
  | 'INVALID_NODE_IDENTITY_ALIAS'
  | 'NODE_IDENTITY_ALIAS_NOT_FOUND'
  | 'NODE_IDENTITY_ALIAS_CONFLICT'
  | 'NODE_IDENTITY_ALIAS_TRACKED'
  | 'NODE_IDENTITY_ALIAS_SHAPE_TWEEN'
  | 'NODE_IDENTITY_ALIAS_ATTACHED'
  | 'NODE_IDENTITY_ALIAS_GENERATION_FAILED'
  | 'NATIVE_GRAPHIC_SOURCE_REQUIRED'
  | 'NATIVE_GRAPHIC_FRAME_REQUIRED'
  | 'NATIVE_GRAPHIC_SELECTION_EMPTY'
  | 'NATIVE_GRAPHIC_SELECTION_INVALID'
  | 'NATIVE_GRAPHIC_SELECTION_OVERLAP'
  | 'NATIVE_GRAPHIC_MEDIA_UNRESOLVED'
  | 'NATIVE_GRAPHIC_DEFINITION_NOT_FOUND'
  | 'NATIVE_GRAPHIC_NOT_NATIVE'
  | 'NATIVE_GRAPHIC_IN_USE'
  | 'NATIVE_GRAPHIC_NODE_NOT_FOUND'
  | 'NATIVE_GRAPHIC_LAST_NODE'
  | 'NATIVE_GRAPHIC_SOURCE_NODE_NOT_EDITABLE'
  | 'NATIVE_GRAPHIC_NAME_CONFLICT'
  | 'NATIVE_GRAPHIC_FRAME_ORDINAL_INVALID'
  | 'NATIVE_GRAPHIC_FRAME_LIMIT'
  | 'NATIVE_GRAPHIC_EXPOSURE_COUNT_INVALID'
  | 'NATIVE_GRAPHIC_EXPOSURE_NOT_HELD'
  | 'NATIVE_GRAPHIC_LAYER_NOT_FOUND'
  | 'NATIVE_GRAPHIC_LAST_LAYER'
  | 'NATIVE_GRAPHIC_GROUP_UNSUPPORTED'
  | 'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED';

export class LayerServiceError extends Error {
  constructor(
    readonly code: LayerServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LayerServiceError';
  }
}

export type CreateLayerInput = AssetDropPayload & {
  position: Point;
  /** Captured from the formal Shot timeline at the instant of an animation drop. */
  startTimeMs?: number;
};

export interface LayerServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

export const GRID_ARRAY_DEFAULT_ROWS = 3;
export const GRID_ARRAY_DEFAULT_COLS = 4;
export const GRID_ARRAY_DEFAULT_SPACING_X = 100;
export const GRID_ARRAY_DEFAULT_SPACING_Y = 80;
export const GRID_ARRAY_MAX_INSTANCES = 100;

export interface GridArrayInput {
  readonly rows: number;
  readonly cols: number;
  readonly spacingX: number;
  readonly spacingY: number;
}

export interface DuplicateGridArrayResult {
  readonly project: Project;
  readonly layers: readonly Layer[];
}

export interface RadialArrayInput {
  readonly count: number;
  readonly center: Point;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly orientation: StaticArrayOrientationMode;
}

export interface PathArrayInput {
  readonly count: number;
  readonly curve: CubicBezier2D;
  readonly orientation: StaticArrayOrientationMode;
}

export interface DuplicateStaticArrayResult {
  readonly project: Project;
  readonly layers: readonly Layer[];
}

export const AFTERIMAGE_MIN_COUNT = 3;
export const AFTERIMAGE_MAX_COUNT = 8;
export const AFTERIMAGE_DEFAULT_COUNT = 4;
export const AFTERIMAGE_DEFAULT_DELAY_FRAMES = 2;
export const AFTERIMAGE_DEFAULT_DECAY = 0.6;

export interface AfterimageInput {
  readonly count: number;
  readonly delayFrames: number;
  readonly decay: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface GenerateAfterimagesResult {
  readonly project: Project;
  readonly layers: readonly Layer[];
}

export interface RadialBurstInput {
  readonly count: number;
  readonly center: Point;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly maxRotationDeg: number;
  readonly startFrame: number;
  readonly durationFrames: number;
  readonly staggerFrames: number;
  readonly seed: number;
  readonly fadeOut: boolean;
}

export interface GenerateRadialBurstResult {
  readonly project: Project;
  readonly layers: readonly Layer[];
}

export interface CreateLayerResult {
  project: Project;
  layer: Layer;
}

export interface LayerTransformInput {
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  flipX: boolean;
}

export interface AnimationPlaybackInput {
  startTimeMs?: number;
  mode?: AnimationPlayback['mode'];
  endBehavior?: AnimationPlayback['endBehavior'];
}

export interface CreateAnimationLayerInput {
  animationId: string;
  position: Point;
  startTimeMs: number;
  firstFrameIndex?: number;
  playback?: AnimationPlayback;
  sourceRange?: AnimationSourceRange;
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotationDeg?: number;
    opacity?: number;
    flipX?: boolean;
  };
  flaOccurrence?: Extract<Layer['source'], { kind: 'animation' }>['flaOccurrence'];
}

export type SaveAnimationSegmentInput = Omit<ReusableAnimationSegment, 'id'> & { replaceId?: string };

export type LayerOrderAction =
  | 'forward'
  | 'backward'
  | 'front'
  | 'back';

export function normalizeLayerRotation(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      '图层旋转角度必须是有限数字。',
    );
  }
  const normalized = (((rotationDeg % 360) + 540) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function validateLayerScale(scale: number): number {
  if (
    !Number.isFinite(scale) ||
    scale < LAYER_MIN_SCALE ||
    scale > LAYER_MAX_SCALE
  ) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      `图层缩放必须是 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间的有限数字。`,
    );
  }
  return scale;
}

function validateLayerOpacity(opacity: number): number {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      '图层不透明度必须是 0–1 之间的有限数字。',
    );
  }
  return opacity;
}

function suffixedLayerName(baseName: string, suffix: string): string {
  const maxBaseLength = Math.max(1, 200 - suffix.length);
  return `${baseName.trim().slice(0, maxBaseLength)}${suffix}`;
}

function duplicateGridLayerName(
  baseName: string,
  row: number,
  col: number,
): string {
  return suffixedLayerName(baseName, ` 副本 ${row + 1}-${col + 1}`);
}

function afterimageLayerName(baseName: string, index: number): string {
  return suffixedLayerName(baseName, ` 残影 ${index}`);
}

function radialBurstLayerName(baseName: string, index: number): string {
  return suffixedLayerName(baseName, ` 爆炸 ${index + 1}`);
}

function clampAlpha01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampLayerPosition(point: Point): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new LayerServiceError(
      'INVALID_POSITION',
      '图层坐标必须是有限数字。',
    );
  }
  return {
    x: Math.min(PROJECT_WIDTH, Math.max(0, point.x)),
    y: Math.min(PROJECT_HEIGHT, Math.max(0, point.y)),
  };
}

function validateLayerPosition(point: Point): Point {
  const position = clampLayerPosition(point);
  if (position.x !== point.x || position.y !== point.y) {
    throw new LayerServiceError(
      'INVALID_POSITION',
      `图层坐标必须位于 0–${PROJECT_WIDTH} 和 0–${PROJECT_HEIGHT} 之间。`,
    );
  }
  return position;
}

export class LayerService {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly positionProjectService: PositionProjectService;

  constructor(options: LayerServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.positionProjectService = new PositionProjectService({
      now: this.now,
    });
  }

  createFromAsset(
    project: Project,
    shotId: string,
    input: CreateLayerInput,
  ): CreateLayerResult {
    const shot = this.shot(project, shotId);
    const position = clampLayerPosition(input.position);
    if (input.type === 'animation') {
      if (input.startTimeMs === undefined) {
        throw new LayerServiceError(
          'INVALID_ANIMATION_START_TIME',
          'Animation start time must be within the shot duration.',
        );
      }
      return this.createFromAnimation(project, shotId, {
        animationId: input.animationId,
        position,
        startTimeMs: input.startTimeMs,
      });
    }
    if (input.type === 'character-expression') {
      const character = project.characters.find(candidate => candidate.id === input.characterId);
      const expression = (character?.mode === 'adaptive-parts' ? character.expressions ?? [] : character?.expressions ?? []).find(candidate => candidate.id === input.expressionId);
      if (expression?.visualSource && !input.assetId && character) {
        return this.appendLayer(project, shot, character.name, { kind: 'character', characterId: character.id, expressionId: expression.id }, position, character.defaultScale, character.defaultFlipX);
      }
    }
    const asset = project.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new LayerServiceError(
        'ASSET_NOT_FOUND',
        `找不到素材：${input.assetId}`,
      );
    }
    if (asset.kind !== 'image' || input.type === 'audio') {
      throw new LayerServiceError(
        'ASSET_TYPE_MISMATCH',
        '只有图片素材可以放入画布。',
      );
    }

    const expressionAssetIds = new Set(
      project.characters.flatMap((character) =>
        character.mode === 'adaptive-parts'
          ? []
          : character.expressions.map((expression) => expression.assetId),
      ),
    );
    if (input.type === 'asset-image' && expressionAssetIds.has(asset.id)) {
      throw new LayerServiceError(
        'ASSET_TYPE_MISMATCH',
        '素材类型与受控拖放载荷不一致。',
      );
    }

    const character =
      input.type === 'character-expression'
        ? project.characters.find(
            (candidate) => candidate.id === input.characterId,
          )
        : undefined;
    const expression =
      input.type === 'character-expression' &&
      character &&
      character.mode !== 'adaptive-parts'
        ? character.expressions.find(
            (candidate) => candidate.id === input.expressionId,
          )
        : undefined;
    if (
      input.type === 'character-expression' &&
      (!character ||
        !expression ||
        expression.assetId !== input.assetId)
    ) {
      throw new LayerServiceError(
        'CHARACTER_IDENTITY_MISMATCH',
        '角色、表情与图片素材的身份关系不一致。',
      );
    }

    const scale =
      input.type === 'character-expression'
        ? character!.defaultScale
        : 1;
    return this.appendLayer(
      project,
      shot,
      asset.name,
      input.type === 'character-expression'
        ? {
            kind: 'character',
            characterId: character!.id,
            expressionId: expression!.id,
          }
        : { kind: 'asset', assetId: asset.id },
      position,
      scale,
      input.type === 'character-expression' ? character!.defaultFlipX : false,
    );
  }

  createControl(project: Project, shotId: string): CreateLayerResult {
    return this.appendLayer(project, this.shot(project, shotId), '控制层', { kind: 'control' },
      { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 }, 1, false);
  }

  createFromAnimation(
    project: Project,
    shotId: string,
    input: CreateAnimationLayerInput,
  ): CreateLayerResult {
    const shot = this.shot(project, shotId);
    const animation = project.animations.find(
      (candidate) => candidate.id === input.animationId,
    );
    if (!animation) {
      throw new LayerServiceError(
        'ANIMATION_NOT_FOUND',
        'Animation definition is unavailable.',
      );
    }
    const position = validateLayerPosition(input.position);
    if (
      !Number.isFinite(input.startTimeMs) ||
      input.startTimeMs < 0 ||
      input.startTimeMs > shot.durationMs
    ) {
      throw new LayerServiceError(
        'INVALID_ANIMATION_START_TIME',
        'Animation start time must be within the shot duration.',
      );
    }
    const firstFrameIndex = input.firstFrameIndex ?? 0;
    const range = input.sourceRange && AnimationSourceRangeSchema.parse(input.sourceRange);
    if (range && range.lastFrame >= resolveFlaGraphicPreviewTimeline(animation, true).totalFrames) {
      throw new LayerServiceError('ANIMATION_FRAME_INVALID', '片段超出源动画的帧范围。');
    }
    if (
      !Number.isSafeInteger(firstFrameIndex) ||
      firstFrameIndex < 0 ||
      firstFrameIndex >= animation.frames.length
    ) {
      throw new LayerServiceError(
        'ANIMATION_FRAME_INVALID',
        'Animation first frame is outside the referenced Definition.',
      );
    }
    for (const frame of animation.frames) {
      // Native FLA Graphic Definitions render from their authored structure and
      // intentionally carry no baked frame media asset.
      if (!frame.assetId) continue;
      const frameAsset = project.assets.find(
        (candidate) => candidate.id === frame.assetId,
      );
      if (
        !frameAsset ||
        frameAsset.kind !== 'image' ||
        frameAsset.sha256 !== frame.sha256
      ) {
        throw new LayerServiceError(
          'ANIMATION_FRAME_INVALID',
          'An animation frame is missing or has a mismatched content hash.',
        );
      }
    }
    const transform = input.transform ?? {};
    const usedIds = this.projectIds(project);
    const layer: Layer = {
      id: this.nextUniqueId(usedIds),
      name: animation.name,
      source: {
        kind: 'animation',
        animationId: animation.id,
        ...(input.flaOccurrence ? { flaOccurrence: input.flaOccurrence } : {}),
      },
      startTimeMs: input.startTimeMs,
      animationFirstFrame: firstFrameIndex,
      animationPlayback: input.playback ?? { mode: 'once', endBehavior: 'hold' },
      ...(range ? { animationSourceRange: range } : {}),
      anchor: 'center',
      x: position.x,
      y: position.y,
      scaleX: validateLayerScale(transform.scaleX ?? 1),
      scaleY: validateLayerScale(transform.scaleY ?? 1),
      rotationDeg: normalizeLayerRotation(transform.rotationDeg ?? 0),
      opacity: validateLayerOpacity(transform.opacity ?? 1),
      visible: true,
      locked: false,
      flipX: transform.flipX ?? false,
      zIndex: Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1,
    };
    return {
      project: this.replaceShot(project, { ...shot, layers: [...shot.layers, layer] }),
      layer,
    };
  }

  restoreFlaOccurrenceColor(project: Project, shotId: string, layerId: string, instanceColor: FlaInstanceColor): Project {
    const shot = this.shot(project, shotId);
    const layers = shot.layers.map((layer) => {
      if (layer.id !== layerId || layer.source.kind !== 'animation') return layer;
      const { flaOccurrence } = layer.source;
      if (!flaOccurrence || flaOccurrence.instanceColor) return layer;
      return { ...layer, source: { ...layer.source, flaOccurrence: { ...flaOccurrence, instanceColor } } };
    });
    return this.replaceShot(project, { ...shot, layers });
  }

  saveAnimationSegment(project: Project, input: SaveAnimationSegmentInput): Project {
    const animation = project.animations.find((entry) => entry.id === input.animationId);
    if (!animation) throw new LayerServiceError('ANIMATION_NOT_FOUND', '请选择存在的源动画。');
    if (input.range.lastFrame >= resolveFlaGraphicPreviewTimeline(animation, true).totalFrames) {
      throw new LayerServiceError('ANIMATION_FRAME_INVALID', '片段超出源动画的帧范围。');
    }
    const library = project.animationSegments ?? [];
    const { replaceId, ...segment } = input;
    if (replaceId && !library.some((entry) => entry.id === replaceId)) {
      throw new LayerServiceError('ANIMATION_NOT_FOUND', '找不到要更新的片段。');
    }
    const saved = ReusableAnimationSegmentSchema.parse({
      ...segment,
      id: replaceId ?? this.nextUniqueId(this.projectIds(project)),
      position: validateLayerPosition(segment.position),
    });
    return ProjectSchema.parse({ ...project, animationSegments: replaceId
      ? library.map((entry) => entry.id === replaceId ? saved : entry)
      : [...library, saved] });
  }

  placeAnimationSegment(project: Project, shotId: string, segmentId: string, startTimeMs: number): CreateLayerResult {
    const segment = project.animationSegments?.find((entry) => entry.id === segmentId);
    if (!segment) throw new LayerServiceError('ANIMATION_NOT_FOUND', '找不到选择的动画片段。');
    return this.createFromAnimation(project, shotId, {
      animationId: segment.animationId,
      position: segment.position,
      startTimeMs,
      playback: segment.playback,
      sourceRange: segment.range,
    });
  }

  createFromAdaptiveCharacter(
    project: Project,
    shotId: string,
    characterId: string,
    rawPosition: Point,
    expressionId?: string,
  ): CreateLayerResult {
    const shot = this.shot(project, shotId);
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new LayerServiceError(
        'CHARACTER_IDENTITY_MISMATCH',
        '所选角色目前无法放入镜头。',
      );
    }
    if (
      expressionId !== undefined &&
      (!character.faceBinding ||
        !character.expressions?.some((expression) => expression.id === expressionId))
    ) {
      throw new LayerServiceError(
        'CHARACTER_IDENTITY_MISMATCH',
        '所选表情无法用于此角色。',
      );
    }
    return this.appendLayer(
      project,
      shot,
      character.name,
      {
        kind: 'character',
        characterId: character.id,
        ...(expressionId === undefined ? {} : { expressionId }),
      },
      clampLayerPosition(rawPosition),
      character.defaultScale,
      character.defaultFlipX,
    );
  }

  setBackground(
    project: Project,
    shotId: string,
    layerId: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    const dimensions = resolveBackgroundSourceDimensions(project, layer);

    if (!dimensions) {
      throw new LayerServiceError(
        'BACKGROUND_LAYER_INVALID',
        '只有可渲染的图片或元件图层才能设为镜头背景。',
      );
    }
    if (shot.backgroundLayerId === layer.id) {
      if (layer.locked && !layer.parentLayerId && !layer.parentSpaceOffset && !layer.parentKeys?.length && !layer.layerMotionTracks && layer.cameraSpace !== 'screen') return project;
      const layers = [...shot.layers];
      const { parentKeys: _clearedParentKeys, ...layerWithoutParentKeys } = layer;
      void _clearedParentKeys;
      layers[layerIndex] = {
        ...layerWithoutParentKeys,
        parentLayerId: undefined,
        parentAttachment: undefined,
        parentSpaceOffset: undefined,
        layerMotionTracks: undefined,
        cameraSpace: undefined,
        locked: true,
        zIndex: 0,
      };
      return this.replaceShot(project, {
        ...shot,
        layers: this.normalizeLayerOrder(
          { ...shot, layers },
          layers
            .filter((candidate) => candidate.id !== layer.id)
            .sort((left, right) => left.zIndex - right.zIndex),
        ),
      });
    }

    const orderedContent = shot.layers
      .filter((candidate) => candidate.id !== layer.id)
      .sort((left, right) => left.zIndex - right.zIndex);
    const layers = [
      this.coverLayer(layer, dimensions.width, dimensions.height, true),
      ...orderedContent.map((candidate, index) => ({
        ...candidate,
        zIndex: index + 1,
      })),
    ];

    return this.replaceShot(project, {
      ...shot,
      backgroundLayerId: layer.id,
      layers,
    });
  }

  fillBackground(project: Project, shotId: string): Project {
    const shot = this.shot(project, shotId);
    if (!shot.backgroundLayerId) return project;

    const backgroundIndex = this.layerIndex(
      shot,
      shot.backgroundLayerId,
    );
    const background = shot.layers[backgroundIndex]!;
    const dimensions = resolveBackgroundSourceDimensions(project, background);
    if (!dimensions) {
      throw new LayerServiceError(
        'BACKGROUND_LAYER_INVALID',
        '当前正式背景没有可用的视觉源，无法填满画布。',
      );
    }

    const filledBackground = this.coverLayer(
      background,
      dimensions.width,
      dimensions.height,
      background.locked,
    );
    const orderedContent = shot.layers
      .filter((candidate) => candidate.id !== background.id)
      .sort((left, right) => left.zIndex - right.zIndex);
    const layers = [
      filledBackground,
      ...orderedContent.map((candidate, index) => ({
        ...candidate,
        zIndex: index + 1,
      })),
    ];
    const changed =
      backgroundIndex !== 0 ||
      Boolean(background.parentLayerId || background.parentSpaceOffset || background.parentKeys?.length || background.layerMotionTracks || background.cameraSpace === 'screen') ||
      background.x !== filledBackground.x ||
      background.y !== filledBackground.y ||
      background.scaleX !== filledBackground.scaleX ||
      background.scaleY !== filledBackground.scaleY ||
      background.rotationDeg !== filledBackground.rotationDeg ||
      background.flipX !== filledBackground.flipX ||
      background.zIndex !== filledBackground.zIndex ||
      shot.layers.some(
        (candidate, index) =>
          candidate.id !== layers[index]!.id ||
          candidate.zIndex !== layers[index]!.zIndex,
      );
    if (!changed) return project;

    return this.replaceShot(project, {
      ...shot,
      layers,
    });
  }

  clearBackground(project: Project, shotId: string): Project {
    const shot = this.shot(project, shotId);
    if (!shot.backgroundLayerId) return project;
    const background = shot.layers.find(
      (candidate) => candidate.id === shot.backgroundLayerId,
    );
    if (!background) {
      throw new LayerServiceError(
        'LAYER_NOT_FOUND',
        `找不到图层：${shot.backgroundLayerId}`,
      );
    }
    const layers = shot.layers
      .map((candidate) =>
        candidate.id === background.id
          ? { ...candidate, locked: false }
          : candidate,
      )
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((candidate, index) => ({
        ...candidate,
        zIndex: index,
      }));
    return this.replaceShot(project, {
      ...shot,
      backgroundLayerId: null,
      layers,
    });
  }

  updatePosition(
    project: Project,
    shotId: string,
    layerId: string,
    rawPosition: Point,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    if (layer.locked) {
      throw new LayerServiceError(
        'LAYER_LOCKED',
        `图层“${layer.name}”已锁定，无法移动。`,
      );
    }
    const position = validateLayerPosition(rawPosition);
    if (layer.x === position.x && layer.y === position.y) {
      return project;
    }
    return this.positionProjectService.applyBaseBoundLayerChange(
      project,
      shotId,
      layerId,
      position,
    );
  }

  updateTransform(
    project: Project,
    shotId: string,
    layerId: string,
    input: LayerTransformInput,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const position = validateLayerPosition({ x: input.x, y: input.y });
    const scale = validateLayerScale(input.scale);
    const rotationDeg = normalizeLayerRotation(input.rotationDeg);
    const opacity = validateLayerOpacity(input.opacity);
    const replacement: Layer = {
      ...layer,
      ...position,
      scaleX: scale,
      scaleY: scale,
      rotationDeg,
      opacity,
      flipX: input.flipX,
    };
    if (
      layer.x === replacement.x &&
      layer.y === replacement.y &&
      layer.scaleX === replacement.scaleX &&
      layer.scaleY === replacement.scaleY &&
      layer.rotationDeg === replacement.rotationDeg &&
      layer.opacity === replacement.opacity &&
      layer.flipX === replacement.flipX
    ) {
      return project;
    }
    return this.positionProjectService.applyBaseBoundLayerChange(
      project,
      shotId,
      layerId,
      replacement,
    );
  }

  updateFlaGraphicInstanceTransform(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    localTransform: AffineMatrix2D,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const source = layer.source;
    if (source.kind !== 'animation') return project;
    const definition = project.animations.find(
      (candidate) => candidate.id === source.animationId,
    );
    if (
      !definition ||
      !('kind' in definition) ||
      definition.kind !== 'fla-graphic' ||
      !definition.structure
    ) {
      return project;
    }
    const node = findFlaGraphicStructureNodeAtPath(
      definition.structure,
      frameOrdinal,
      nodePath,
    );
    const frameKey = String(frameOrdinal);
    const extractedMatch =
      !node
        ? findFlaExtractedShapeRegionByPath(
            layer.flaGraphicInstanceShapeOverrides?.[frameKey],
            nodePath,
          ) ??
          findFlaExtractedShapeRegionByPath(
            definition.flaGraphicSharedShapeOverrides?.[frameKey],
            nodePath,
          )
        : null;
    const authoredTransform =
      node && isFlaGraphicNodeTransformable(node)
        ? node.localTransform
        : extractedMatch?.entry.localTransform;
    if (!authoredTransform) return project;

    const pruned = pruneFlaGraphicInstanceTransformOverrides(
      layer.flaGraphicInstanceTransformOverrides,
      definition.structure,
      {
        instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
        sharedShapeOverrides: definition.flaGraphicSharedShapeOverrides,
      },
    );
    const nextOverrides = setFlaGraphicInstanceTransformOverride(
      pruned,
      frameOrdinal,
      nodePath,
      authoredTransform,
      localTransform,
    );
    if (nextOverrides === layer.flaGraphicInstanceTransformOverrides) {
      return project;
    }

    const nextLayer: Layer = { ...layer };
    delete nextLayer.flaGraphicInstanceTransformOverrides;
    if (nextOverrides) {
      nextLayer.flaGraphicInstanceTransformOverrides = nextOverrides;
    }
    const layers = [...shot.layers];
    layers[layerIndex] = nextLayer;
    return this.replaceShot(project, { ...shot, layers });
  }

  updateFlaGraphicInstanceText(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    characters: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const source = layer.source;
    if (source.kind !== 'animation') return project;
    const definition = project.animations.find(({ id }) => id === source.animationId);
    if (!definition || !('kind' in definition) || definition.kind !== 'fla-graphic' || !definition.structure) return project;
    const node = findFlaGraphicStructureNodeAtPath(definition.structure, frameOrdinal, nodePath);
    if (node?.type !== 'opaque' || node.opaqueKind !== 'text' || !node.editableText) return project;

    const frameKey = String(frameOrdinal);
    const pathKey = flaGraphicInstanceNodePathKey(nodePath);
    const original = node.editableText.runs[0].characters;
    const overrides = { ...layer.flaGraphicInstanceTextOverrides };
    const frameOverrides = { ...overrides[frameKey] };
    if ((frameOverrides[pathKey] ?? original) === characters) return project;
    if (characters === original) delete frameOverrides[pathKey];
    else frameOverrides[pathKey] = characters;
    if (Object.keys(frameOverrides).length) overrides[frameKey] = frameOverrides;
    else delete overrides[frameKey];
    const nextLayer = { ...layer };
    delete nextLayer.flaGraphicInstanceTextOverrides;
    if (Object.keys(overrides).length) {
      const validated = FlaGraphicInstanceTextOverridesSchema.safeParse(overrides);
      if (!validated.success) throw new Error('替换文字超出支持范围。');
      nextLayer.flaGraphicInstanceTextOverrides = validated.data;
    }
    const layers = [...shot.layers];
    layers[layerIndex] = nextLayer;
    return this.replaceShot(project, { ...shot, layers });
  }

  updateFlaGraphicSharedDefinitionTransform(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    localTransform: AffineMatrix2D,
  ): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertEditable(shot, layer);
    const source = layer.source;
    if (source.kind !== 'animation') return project;
    const animationIndex = project.animations.findIndex(
      (candidate) => candidate.id === source.animationId,
    );
    if (animationIndex < 0) return project;
    const definition = project.animations[animationIndex]!;
    if (!isFlaGraphicDefinition(definition) || !definition.structure) {
      return project;
    }
    const nextStructure = updateFlaGraphicStructureAuthoredTransform(
      definition.structure,
      frameOrdinal,
      nodePath,
      localTransform,
    );
    if (nextStructure !== definition.structure) {
      const nextAnimations = [...project.animations];
      nextAnimations[animationIndex] = {
        ...definition,
        structure: nextStructure,
      };
      return {
        ...project,
        animations: nextAnimations,
      };
    }

    const frameKey = String(frameOrdinal);
    const extractedMatch = findFlaExtractedShapeRegionByPath(
      definition.flaGraphicSharedShapeOverrides?.[frameKey],
      nodePath,
    );
    if (!extractedMatch) return project;
    const nextShapeOverrides = cloneFlaGraphicShapeOverrides(
      definition.flaGraphicSharedShapeOverrides,
    );
    const ownerOverride = nextShapeOverrides?.[frameKey]?.[extractedMatch.ownerPathKey];
    const targetEntry = ownerOverride?.extractedRegions[extractedMatch.entryIndex];
    if (!nextShapeOverrides || !ownerOverride || !targetEntry) return project;
    targetEntry.localTransform = { ...localTransform };
    const nextAnimations = [...project.animations];
    nextAnimations[animationIndex] = {
      ...definition,
      flaGraphicSharedShapeOverrides: nextShapeOverrides,
    };
    return {
      ...project,
      animations: nextAnimations,
    };
  }

  /**
   * Assigns an author-stable identity to an otherwise ambiguous FLA Graphic
   * node. Only nodes without a source-proven identity can be associated; the
   * node path is unchanged, so existing tracks and instance overrides for other
   * nodes stay valid. Passing `aliasId` joins an existing author association
   * (the explicit cross-frame mapping path).
   */
  setFlaGraphicNodeIdentityAlias(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    aliasId?: string,
  ): Project {
    const { animationIndex, definition } = this.resolveEditableFlaGraphicContext(
      project,
      shotId,
      layerId,
    );
    const structure = definition.structure!;
    const target = resolveFlaGraphicTimelineTarget(
      structure,
      frameOrdinal,
      nodePath,
    );
    if (!target) {
      throw new LayerServiceError(
        'NODE_IDENTITY_TARGET_NOT_FOUND',
        '找不到要关联的元件节点。',
      );
    }
    if (target.authoringCapability === 'readonly-opaque') {
      throw new LayerServiceError(
        'NODE_IDENTITY_OPAQUE',
        '当前对象只读，无法建立节点关联。',
      );
    }
    if (target.identitySource !== null && target.identitySource !== 'alias') {
      throw new LayerServiceError(
        'NODE_IDENTITY_PROVEN',
        '当前节点已有源稳定身份，无需建立关联。',
      );
    }
    const assignments = listFlaGraphicIdentityAliasAssignments(structure);
    const currentAliasId = target.identityAliasId;
    const nextAliasId =
      aliasId === undefined
        ? this.nextFlaGraphicNodeIdentityAliasId(assignments)
        : aliasId;
    if (!FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN.test(nextAliasId)) {
      throw new LayerServiceError(
        'INVALID_NODE_IDENTITY_ALIAS',
        '关联身份格式无效。',
      );
    }
    if (currentAliasId === nextAliasId) return project;
    if (
      aliasId !== undefined &&
      !assignments.some((assignment) => assignment.aliasId === nextAliasId)
    ) {
      throw new LayerServiceError(
        'NODE_IDENTITY_ALIAS_NOT_FOUND',
        '所选关联身份不存在，请刷新后重试。',
      );
    }
    if (
      assignments.some(
        (assignment) =>
          assignment.containerKey === target.identityContainerKey &&
          assignment.nodeId !== target.targetNode.id &&
          assignment.aliasId === nextAliasId,
      )
    ) {
      throw new LayerServiceError(
        'NODE_IDENTITY_ALIAS_CONFLICT',
        '同一帧中的不同节点不能共用同一关联身份。',
      );
    }
    if (currentAliasId) {
      this.assertFlaGraphicIdentityAliasDetachable(
        project,
        definition,
        target,
        currentAliasId,
        '调整',
      );
    }
    const nextStructure = setNodeIdentityAliasPure(
      structure,
      frameOrdinal,
      nodePath,
      nextAliasId,
    );
    if (nextStructure === structure) return project;
    return this.commitFlaGraphicStructureChange(
      project,
      animationIndex,
      definition,
      nextStructure,
    );
  }

  /**
   * Removes an author-stable identity. Rejected while the identity still owns
   * keyframes or an attachment target, so the operation can never silently
   * orphan authored data.
   */
  clearFlaGraphicNodeIdentityAlias(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
  ): Project {
    const { animationIndex, definition } = this.resolveEditableFlaGraphicContext(
      project,
      shotId,
      layerId,
    );
    const structure = definition.structure!;
    const target = resolveFlaGraphicTimelineTarget(
      structure,
      frameOrdinal,
      nodePath,
    );
    if (!target) {
      throw new LayerServiceError(
        'NODE_IDENTITY_TARGET_NOT_FOUND',
        '找不到要解除关联的元件节点。',
      );
    }
    const currentAliasId = target.identityAliasId;
    if (!currentAliasId) return project;
    this.assertFlaGraphicIdentityAliasDetachable(
      project,
      definition,
      target,
      currentAliasId,
      '解除',
    );
    const nextStructure = clearNodeIdentityAliasPure(
      structure,
      frameOrdinal,
      nodePath,
    );
    if (nextStructure === structure) return project;
    return this.commitFlaGraphicStructureChange(
      project,
      animationIndex,
      definition,
      nextStructure,
    );
  }

  /**
   * Rejects an alias change that would leave an authored consumer pointing at an
   * identity the node no longer resolves to. Consumers are judged against the
   * real Definition, timeline container and instance ownership, so an unrelated
   * Definition reusing the same alias id can never block the operation.
   */
  private assertFlaGraphicIdentityAliasDetachable(
    project: Project,
    definition: FlaGraphicDefinition,
    target: FlaGraphicTimelineTargetInfo,
    aliasId: string,
    action: string,
  ): void {
    const trackId = `alias:${aliasId}`;
    // Keyframe tracks live in the owning timeline container.
    if (target.timeline?.tracks.some((track) => track.trackId === trackId)) {
      throw new LayerServiceError(
        'NODE_IDENTITY_ALIAS_TRACKED',
        `当前关联身份上已有关键帧轨道，请先删除该轨道的关键帧后再${action}关联。`,
      );
    }
    // Shape Tween tracks resolve their target through the same stable identity,
    // but they are scoped by timeline owner (frame vs nested Symbol definition).
    const structure = definition.structure!;
    const ownerShapeTween = (structure.shapeTweenTracks ?? []).some(
      (track) =>
        track.target.nodeTrackId === trackId &&
        track.target.ownerKind === target.ownerKind &&
        (track.target.ownerSymbolDefId ?? null) === (target.ownerSymbolDefId ?? null),
    );
    if (ownerShapeTween) {
      throw new LayerServiceError(
        'NODE_IDENTITY_ALIAS_SHAPE_TWEEN',
        `当前关联身份上仍有形状补间，请先删除该形状补间后再${action}关联。`,
      );
    }
    // Static and dynamic (parentKeys) Graphic attachments resolve their target
    // through the owner Layer's own Definition instance.
    const attachmentReferencesAlias = (
      attachment: LayerParentKey['parentAttachment'] | Layer['parentAttachment'],
    ): boolean =>
      attachment?.target.kind === 'graphic-node' &&
      attachment.target.identityPath?.includes(trackId) === true;
    const ownerUsesDefinition = (shot: Shot, ownerLayerId: string | undefined): boolean => {
      if (!ownerLayerId) return false;
      const owner = shot.layers.find((layer) => layer.id === ownerLayerId);
      return owner?.source.kind === 'animation' && owner.source.animationId === definition.id;
    };
    for (const shot of project.shots) {
      for (const layer of shot.layers) {
        if (
          attachmentReferencesAlias(layer.parentAttachment) &&
          ownerUsesDefinition(shot, layer.parentLayerId)
        ) {
          throw new LayerServiceError(
            'NODE_IDENTITY_ALIAS_ATTACHED',
            `当前关联身份仍被图层挂接引用，请先修改挂接目标后再${action}关联。`,
          );
        }
        for (const key of layer.parentKeys ?? []) {
          if (
            attachmentReferencesAlias(key.parentAttachment) &&
            ownerUsesDefinition(shot, key.parentLayerId ?? undefined)
          ) {
            throw new LayerServiceError(
              'NODE_IDENTITY_ALIAS_ATTACHED',
              `当前关联身份仍被图层挂接引用，请先修改挂接目标后再${action}关联。`,
            );
          }
        }
      }
    }
  }

  private nextFlaGraphicNodeIdentityAliasId(
    assignments: ReturnType<typeof listFlaGraphicIdentityAliasAssignments>,
  ): string {
    const usedAliasIds = new Set(
      assignments.map((assignment) => assignment.aliasId),
    );
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = `identity-${this.createId()}`;
      if (
        FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN.test(candidate) &&
        !usedAliasIds.has(candidate)
      ) {
        return candidate;
      }
    }
    throw new LayerServiceError(
      'NODE_IDENTITY_ALIAS_GENERATION_FAILED',
      '无法生成节点关联身份，请重试。',
    );
  }

  private commitFlaGraphicStructureChange(
    project: Project,
    animationIndex: number,
    definition: FlaGraphicDefinition,
    nextStructure: FlaGraphicStructure,
  ): Project {
    const nextAnimations = [...project.animations];
    nextAnimations[animationIndex] = { ...definition, structure: nextStructure };
    return ProjectSchema.parse({ ...project, animations: nextAnimations });
  }

  private resolveEditableFlaGraphicContext(
    project: Project,
    shotId: string,
    layerId: string,
  ) {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    if (layer.source.kind !== 'animation') {
      throw new LayerServiceError('ANIMATION_LAYER_REQUIRED', '当前图层不是 FLA Graphic 动画图层。');
    }
    const animationId = layer.source.animationId;
    const animationIndex = project.animations.findIndex(
      (candidate) => candidate.id === animationId,
    );
    const definition = animationIndex >= 0 ? project.animations[animationIndex] : undefined;
    if (
      !definition ||
      !isFlaGraphicDefinition(definition) ||
      !definition.structure
    ) {
      throw new LayerServiceError('FLA_GRAPHIC_REQUIRED', '当前图层未关联可编辑的结构化 Graphic。');
    }
    return { shot, layerIndex, layer, animationIndex, definition };
  }

  private resolveOrSeedShapeNodeOverride(input: {
    readonly existingOverride: FlaGraphicShapeNodeOverride | undefined;
    readonly fallbackViewBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly sourceShapeRef?: string;
    readonly svgText?: string;
  }): FlaGraphicShapeNodeOverride {
    if (input.existingOverride) {
      return cloneFlaGraphicShapeNodeOverride(input.existingOverride);
    }
    if (!input.svgText) {
      throw new LayerServiceError(
        'SHAPE_SVG_REQUIRED',
        '当前 Shape 尚未加载矢量 SVG 资源，请稍后重试。',
      );
    }
    const decomposed = decomposeSvgToEditableShapeRegions(input.svgText, {
      ...(input.sourceShapeRef ? { sourceShapeRef: input.sourceShapeRef } : {}),
      ...(input.fallbackViewBox ? { baseViewBox: input.fallbackViewBox } : {}),
    });
    if (decomposed.regions.length === 0) {
      throw new LayerServiceError(
        'SHAPE_NO_EDITABLE_REGIONS',
        '当前 Shape 内没有可提取或可编辑的绘制区域。',
      );
    }
    return {
      baseViewBox: { ...decomposed.viewBox },
      regions: decomposed.regions.map((region) => ({ ...region })),
      excludedRegionRefs: [],
      extractedRegions: [],
      ...(decomposed.residueStrokes.length > 0
        ? {
            residueStrokes: decomposed.residueStrokes.map((s) => ({
              ...s,
              commands: s.commands.map((cmd) => ({ ...cmd })),
            })),
          }
        : {}),
      ...(decomposed.hasUnrenderableResidue ? { hasUnrenderableResidue: true } : {}),
      ...(decomposed.ambiguousRegionRefs.size > 0
        ? { ambiguousRegionRefs: [...decomposed.ambiguousRegionRefs] }
        : {}),
      ...(decomposed.bitmapFillRegionRefs.size > 0
        ? { bitmapFillRegionRefs: [...decomposed.bitmapFillRegionRefs] }
        : {}),
      ...(decomposed.defsSvg ? { sourceDefsSvg: decomposed.defsSvg } : {}),
    };
  }

  private assertShapeOverrideSafeForEdit(
    nodeOverride: FlaGraphicShapeNodeOverride,
  ): void {
    if (
      nodeOverride.hasUnrenderableResidue ||
      (nodeOverride.bitmapFillRegionRefs?.length ?? 0) > 0 ||
      nodeOverride.regions.some((r) => r.fill.kind === 'preserved')
    ) {
      throw new LayerServiceError(
        'SHAPE_BITMAP_FILL_UNSUPPORTED',
        '当前形状包含位图填充或受保护的复杂绘制残留，暂不支持拆区或内部矢量编辑；请选择更外层组合。',
      );
    }
  }

  private commitShapeOverrides(
    project: Project,
    context: ReturnType<LayerService['resolveEditableFlaGraphicContext']>,
    mode: 'instance' | 'definition',
    frameKey: string,
    ownerPathKey: string,
    nextNodeOverride: FlaGraphicShapeNodeOverride,
  ): Project {
    if (mode === 'definition') {
      const nextShared: FlaGraphicShapeOverrides =
        cloneFlaGraphicShapeOverrides(
          context.definition.flaGraphicSharedShapeOverrides,
        ) ?? {};
      nextShared[frameKey] = {
        ...nextShared[frameKey],
        [ownerPathKey]: nextNodeOverride,
      };
      const nextAnimations = [...project.animations];
      nextAnimations[context.animationIndex] = {
        ...context.definition,
        flaGraphicSharedShapeOverrides: nextShared,
      };
      return { ...project, animations: nextAnimations };
    }
    const nextInstance: FlaGraphicShapeOverrides =
      cloneFlaGraphicShapeOverrides(context.layer.flaGraphicInstanceShapeOverrides) ?? {};
    nextInstance[frameKey] = {
      ...nextInstance[frameKey],
      [ownerPathKey]: nextNodeOverride,
    };
    const layers = [...context.shot.layers];
    layers[context.layerIndex] = {
      ...context.layer,
      flaGraphicInstanceShapeOverrides: nextInstance,
    };
    return this.replaceShot(project, { ...context.shot, layers });
  }

  extractFlaGraphicShapeRegion(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly frameOrdinal: number;
      readonly nodePath: readonly string[];
      readonly regionRef: string;
      readonly mode: 'instance' | 'definition';
      readonly svgText?: string;
      readonly displayName?: string;
    },
  ): {
    readonly project: Project;
    readonly extractedNodePath: readonly string[];
    readonly region: FlaEditableShapeRegion;
  } {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const node = findFlaGraphicStructureNodeAtPath(
      context.definition.structure!,
      input.frameOrdinal,
      input.nodePath,
    );
    if (!node || !isFlaGraphicEditableSubtreeShapeNode(node)) {
      throw new LayerServiceError(
        'SHAPE_NODE_REQUIRED',
        '仅支持在可编辑的独立 Shape 节点内部提取绘制区域。',
      );
    }
    const frameKey = String(input.frameOrdinal);
    const ownerPathKey = flaGraphicInstanceNodePathKey(input.nodePath);
    const existingOverride =
      input.mode === 'instance'
        ? context.layer.flaGraphicInstanceShapeOverrides?.[frameKey]?.[ownerPathKey] ??
          context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[ownerPathKey]
        : context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[ownerPathKey];
    const nodeOverride = this.resolveOrSeedShapeNodeOverride({
      existingOverride,
      fallbackViewBox: node.fallbackViewBox,
      sourceShapeRef: node.sourceRef,
      svgText: input.svgText,
    });
    this.assertShapeOverrideSafeForEdit(nodeOverride);

    if (nodeOverride.bitmapFillRegionRefs?.includes(input.regionRef)) {
      throw new LayerServiceError(
        'SHAPE_BITMAP_FILL_UNSUPPORTED',
        '当前区域包含位图填充，暂不支持单独提取；请选择更外层组合。',
      );
    }
    if (nodeOverride.ambiguousRegionRefs?.includes(input.regionRef)) {
      throw new LayerServiceError(
        'SHAPE_AMBIGUOUS_STROKES',
        '当前区域的描边与相邻形状共用且无法明确归属，暂不支持单独提取；请选择更外层组合。',
      );
    }

    const parentPath = input.nodePath.slice(0, -1);
    const alreadyExtracted = nodeOverride.extractedRegions.find(
      (entry) => entry.regionRef === input.regionRef,
    );
    if (alreadyExtracted) {
      return {
        project,
        extractedNodePath: [...parentPath, alreadyExtracted.id],
        region: alreadyExtracted.region,
      };
    }

    const region = nodeOverride.regions.find(
      (candidate) => candidate.regionRef === input.regionRef,
    );
    if (!region) {
      throw new LayerServiceError(
        'SHAPE_REGION_NOT_FOUND',
        '未能定位所选绘制区域，请重新点选目标形状后再试。',
      );
    }
    if (region.fill.kind === 'preserved') {
      throw new LayerServiceError(
        'SHAPE_BITMAP_FILL_UNSUPPORTED',
        '当前区域包含位图或受保护填充，暂不支持单独提取；请选择更外层组合。',
      );
    }

    const authoredTransform =
      input.mode === 'instance'
        ? getFlaGraphicInstanceTransformOverride(
            context.layer.flaGraphicInstanceTransformOverrides,
            input.frameOrdinal,
            input.nodePath,
          ) ?? node.localTransform
        : node.localTransform;
    const entryId = `${node.id}::${region.regionRef}`;
    const neutralName =
      input.displayName?.trim() || `区域 ${nodeOverride.extractedRegions.length + 1}`;
    const entry = {
      id: entryId,
      regionRef: region.regionRef,
      displayName: neutralName.slice(0, 120),
      region: cloneFlaEditableShapeRegion(region),
      baseViewBox: { ...region.bounds },
      localTransform: { ...authoredTransform },
    };
    const nextNodeOverride: FlaGraphicShapeNodeOverride = {
      ...nodeOverride,
      excludedRegionRefs: nodeOverride.excludedRegionRefs.includes(region.regionRef)
        ? [...nodeOverride.excludedRegionRefs]
        : [...nodeOverride.excludedRegionRefs, region.regionRef],
      extractedRegions: [...nodeOverride.extractedRegions, entry],
    };
    return {
      project: this.commitShapeOverrides(
        project,
        context,
        input.mode,
        frameKey,
        ownerPathKey,
        nextNodeOverride,
      ),
      extractedNodePath: [...parentPath, entry.id],
      region: entry.region,
    };
  }

  private mutateFlaGraphicShapeRegion(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly frameOrdinal: number;
      readonly nodePath: readonly string[];
      readonly regionRef?: string;
      readonly mode: 'instance' | 'definition';
      readonly svgText?: string;
      readonly mutator: (region: FlaEditableShapeRegion) => FlaEditableShapeRegion | null;
      readonly failReason?: { readonly code: LayerServiceErrorCode; readonly message: string };
      /** Mirror an editable endpoint region edit into its author Shape Tween pose(s). */
      readonly tweenPoseScope?: 'current-endpoint' | 'both';
      readonly internalTimeMs?: number;
    },
  ): Project {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const frameKey = String(input.frameOrdinal);
    const extractedMatch =
      (input.mode === 'instance'
        ? findFlaExtractedShapeRegionByPath(
            context.layer.flaGraphicInstanceShapeOverrides?.[frameKey],
            input.nodePath,
          ) ??
          findFlaExtractedShapeRegionByPath(
            context.definition.flaGraphicSharedShapeOverrides?.[frameKey],
            input.nodePath,
          )
        : findFlaExtractedShapeRegionByPath(
            context.definition.flaGraphicSharedShapeOverrides?.[frameKey],
            input.nodePath,
          ));

    if (extractedMatch) {
      const existingOwner =
        input.mode === 'instance'
          ? context.layer.flaGraphicInstanceShapeOverrides?.[frameKey]?.[
              extractedMatch.ownerPathKey
            ] ??
            context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[
              extractedMatch.ownerPathKey
            ]
          : context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[
              extractedMatch.ownerPathKey
            ];
      if (!existingOwner) return project;
      const clonedOwner = cloneFlaGraphicShapeNodeOverride(existingOwner);
      const entry = clonedOwner.extractedRegions[extractedMatch.entryIndex];
      if (!entry) return project;
      const updated = input.mutator(entry.region);
      if (!updated) {
        if (input.failReason) {
          throw new LayerServiceError(input.failReason.code, input.failReason.message);
        }
        return project;
      }
      entry.region = updated;
      return this.commitShapeOverrides(
        project,
        context,
        input.mode,
        frameKey,
        extractedMatch.ownerPathKey,
        clonedOwner,
      );
    }

    const node = findFlaGraphicStructureNodeAtPath(
      context.definition.structure!,
      input.frameOrdinal,
      input.nodePath,
    );
    if (!node || !isFlaGraphicEditableSubtreeShapeNode(node)) {
      throw new LayerServiceError(
        'SHAPE_NODE_REQUIRED',
        '当前节点不支持内部区域矢量编辑。',
      );
    }
    const ownerPathKey = flaGraphicInstanceNodePathKey(input.nodePath);
    const existingOverride =
      input.mode === 'instance'
        ? context.layer.flaGraphicInstanceShapeOverrides?.[frameKey]?.[ownerPathKey] ??
          context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[ownerPathKey]
        : context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[ownerPathKey];
    const nodeOverride = this.resolveOrSeedShapeNodeOverride({
      existingOverride,
      fallbackViewBox: node.fallbackViewBox,
      sourceShapeRef: node.sourceRef,
      svgText: input.svgText,
    });
    this.assertShapeOverrideSafeForEdit(nodeOverride);
    const targetRef =
      input.regionRef ??
      (nodeOverride.regions.length === 1 ? nodeOverride.regions[0]!.regionRef : undefined);
    if (!targetRef) {
      throw new LayerServiceError(
        'SHAPE_REGION_REQUIRED',
        '请先点选要编辑的具体绘制区域。',
      );
    }
    const regionIndex = nodeOverride.regions.findIndex(
      (candidate) => candidate.regionRef === targetRef,
    );
    if (regionIndex < 0) {
      throw new LayerServiceError('SHAPE_REGION_NOT_FOUND', '未找到对应的绘制区域。');
    }
    const currentRegion = nodeOverride.regions[regionIndex]!;
    if (currentRegion.fill.kind === 'preserved') {
      throw new LayerServiceError(
        'SHAPE_BITMAP_FILL_UNSUPPORTED',
        '当前区域包含位图或复杂受保护填充，暂保持只读。',
      );
    }
    const updated = input.mutator(currentRegion);
    if (!updated) {
      if (input.failReason) {
        throw new LayerServiceError(input.failReason.code, input.failReason.message);
      }
      return project;
    }
    const nextRegions = [...nodeOverride.regions];
    nextRegions[regionIndex] = updated;
    const nextTweenTrack = this.resolveShapeTweenPoseUpdate({
      definition: context.definition,
      frameOrdinal: input.frameOrdinal,
      nodePath: input.nodePath,
      regionRef: currentRegion.regionRef,
      mutator: input.mutator,
      ...(input.tweenPoseScope ? { tweenPoseScope: input.tweenPoseScope } : {}),
      ...(input.internalTimeMs !== undefined ? { internalTimeMs: input.internalTimeMs } : {}),
      ...(input.failReason ? { failReason: input.failReason } : {}),
    });
    const committed = this.commitShapeOverrides(
      project,
      context,
      input.mode,
      frameKey,
      ownerPathKey,
      {
        ...nodeOverride,
        regions: nextRegions,
      },
    );
    if (!nextTweenTrack) return committed;
    return this.commitFlaGraphicShapeTweenTrack(
      committed,
      context.animationIndex,
      nextTweenTrack,
    );
  }

  /**
   * Mirrors an endpoint region edit into the region's author Shape Tween so the
   * two authored poses stay directly editable at the tween's start / end time.
   * Mid-range geometry edits are rejected; fill/style edits update both poses.
   */
  private resolveShapeTweenPoseUpdate(input: {
    readonly definition: FlaGraphicDefinition;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly regionRef: string;
    readonly mutator: (region: FlaEditableShapeRegion) => FlaEditableShapeRegion | null;
    readonly tweenPoseScope?: 'current-endpoint' | 'both';
    readonly internalTimeMs?: number;
    readonly failReason?: { readonly code: LayerServiceErrorCode; readonly message: string };
  }): FlaShapeTweenTrack | null {
    if (!input.tweenPoseScope || !input.definition.structure) return null;
    const track = this.resolveShapeTweenForShapeNode(
      input.definition.structure,
      input.frameOrdinal,
      input.nodePath,
      input.regionRef,
    );
    if (!track) return null;
    const noChange = (): FlaShapeTweenTrack | null => {
      if (input.failReason) {
        throw new LayerServiceError(input.failReason.code, input.failReason.message);
      }
      return null;
    };
    if (input.tweenPoseScope === 'both') {
      const from = input.mutator(track.from);
      const to = input.mutator(track.to);
      if (!from || !to) return noChange();
      return { ...track, from, to };
    }
    const internalTimeMs =
      input.internalTimeMs ??
      Math.round(
        (input.frameOrdinal * 1_000) /
          Math.max(1, input.definition.source.sourceFps || 24),
      );
    const pose = resolveFlaShapeTweenPoseEdit(track, internalTimeMs);
    if (pose === 'interpolated') {
      throw new LayerServiceError(
        'SHAPE_TWEEN_MID_RANGE_READONLY',
        '形状补间区间内不能直接编辑端点姿态，请拖到补间起点或终点后再编辑。',
      );
    }
    const updatedPose = input.mutator(track[pose]);
    if (!updatedPose) return noChange();
    return { ...track, [pose]: updatedPose };
  }

  private resolveShapeTweenForShapeNode(
    structure: NonNullable<FlaGraphicDefinition['structure']>,
    frameOrdinal: number,
    nodePath: readonly string[],
    regionRef: string,
  ): FlaShapeTweenTrack | null {
    const target = resolveFlaGraphicTimelineTarget(structure, frameOrdinal, nodePath);
    if (!target?.trackId) return null;
    return findFlaShapeTweenTrackForTarget(structure.shapeTweenTracks, {
      nodeTrackId: target.trackId,
      ownerKind: target.ownerKind,
      ...(target.ownerSymbolDefId
        ? { ownerSymbolDefId: target.ownerSymbolDefId }
        : {}),
      regionRef,
      sourceFrameOrdinal: frameOrdinal,
      sourceNodePath: [...nodePath],
    });
  }

  private commitFlaGraphicShapeTweenTrack(
    project: Project,
    animationIndex: number,
    nextTrack: FlaShapeTweenTrack,
  ): Project {
    const definition = project.animations[animationIndex];
    if (!definition || !isFlaGraphicDefinition(definition) || !definition.structure) {
      return project;
    }
    const nextStructure = withFlaShapeTweenTrack(definition.structure, nextTrack);
    if (nextStructure === definition.structure) return project;
    const nextAnimations = [...project.animations];
    nextAnimations[animationIndex] = {
      ...definition,
      structure: nextStructure,
    };
    return { ...project, animations: nextAnimations };
  }

  /**
   * Validates authored geometry (and optional author hints) before persisting a
   * tween edit. Multi-contour / hole pairing is enabled; only the documented
   * unsupported topology remains a typed rejection.
   */
  private assertFlaShapeTweenGeometrySupported(
    region: FlaEditableShapeRegion,
    other?: FlaEditableShapeRegion,
    hints?: readonly FlaShapeTweenHint[],
  ): void {
    if (region.fill.kind === 'preserved') {
      throw new LayerServiceError(
        'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
        '当前区域包含位图或受保护填充，暂不支持形状补间。',
      );
    }
    const prepared = prepareFlaShapeTweenTrack({
      tweenId: 'shape-tween-validation',
      target: {
        nodeTrackId: 'validation',
        ownerKind: 'frame',
        regionRef: region.regionRef,
        sourceFrameOrdinal: 0,
        sourceNodePath: ['validation'],
      },
      startTimeMs: 0,
      endTimeMs: 1,
      easing: 'linear',
      from: region,
      to: other ?? region,
      ...(hints && hints.length > 0 ? { hints: [...hints] } : {}),
    });
    if (prepared.ok) return;
    throw new LayerServiceError(
      'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
      this.faShapeTweenGeometryFailureMessage(prepared.code),
    );
  }

  private faShapeTweenGeometryFailureMessage(code: ShapeMorphFailureCode): string {
    switch (code) {
      case 'open-contour':
        return '形状补间要求两个姿态都是闭合轮廓。';
      case 'unsupported-topology':
        return '暂不支持该多轮廓/孔洞拓扑：仅支持一个外轮廓加直接孔洞，或互不相交的外轮廓组合。';
      case 'degenerate-contour':
        return '当前轮廓的面积为 0，无法创建形状补间。';
      case 'too-many-segments':
        return '当前轮廓过于复杂，暂不支持形状补间。';
      case 'empty-pose':
        return '当前区域没有可用的闭合轮廓。';
      case 'invalid-hint':
        return '提示点位置无效，请重新选择提示点所在的轮廓顶点或位置。';
      case 'ambiguous-hints':
        return '提示点存在重复或歧义，请调整提示点位置。';
      case 'crossing-hints':
        return '提示点顺序交叉，无法建立一致的对应关系，请重新放置提示点。';
      default:
        return '当前轮廓无法进行形状补间。';
    }
  }

  /** Validates a candidate hint set against the track's two authored poses. */
  private assertFlaShapeTweenHintsSupported(
    track: FlaShapeTweenTrack,
    hints: readonly FlaShapeTweenHint[],
  ): void {
    const prepared = prepareFlaShapeTweenTrack({ ...track, hints: [...hints] });
    if (prepared.ok) return;
    throw new LayerServiceError(
      'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
      this.faShapeTweenGeometryFailureMessage(prepared.code),
    );
  }

  private stableFlaShapeTweenId(target: FlaShapeTweenTarget): string {
    const text = flaShapeTweenTargetKey(target);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
    }
    return `shape-tween-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  private sanitizeFlaShapeTweenTime(
    value: number,
    label: string,
  ): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_INVALID_TIME',
        `${label}必须为非负整数毫秒。`,
      );
    }
    return value;
  }

  createFlaGraphicShapeTween(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly frameOrdinal: number;
      readonly nodePath: readonly string[];
      readonly regionRef?: string;
      readonly mode: 'instance' | 'definition';
      readonly svgText?: string;
      readonly startTimeMs: number;
      readonly durationMs: number;
      readonly easing?: FlaShapeTweenEasing;
    },
  ): Project {
    if (input.mode !== 'definition') {
      throw new LayerServiceError(
        'SHAPE_TWEEN_DEFINITION_ONLY',
        '形状补间仅支持在共享元件定义中创建，请切换到元件内部时间轴后再试。',
      );
    }
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    const frameKey = String(input.frameOrdinal);
    const existingExtracted = findFlaExtractedShapeRegionByPath(
      context.definition.flaGraphicSharedShapeOverrides?.[frameKey],
      input.nodePath,
    );
    if (existingExtracted) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_TARGET_UNSUPPORTED',
        '已拆分出的独立区域暂不支持形状补间，请直接对 Shape 内的区域创建补间。',
      );
    }
    const targetInfo = resolveFlaGraphicTimelineTarget(
      structure,
      input.frameOrdinal,
      input.nodePath,
    );
    if (!targetInfo || !isFlaGraphicEditableSubtreeShapeNode(targetInfo.targetNode)) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_TARGET_UNSUPPORTED',
        '请选择可编辑的独立 Shape 内部区域后再创建形状补间。',
      );
    }
    if (!targetInfo.trackId) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_TARGET_UNSUPPORTED',
        '当前形状节点缺少稳定的跨帧身份，暂不支持形状补间。',
      );
    }
    const ownerPathKey = flaGraphicInstanceNodePathKey(input.nodePath);
    const nodeOverride = this.resolveOrSeedShapeNodeOverride({
      existingOverride:
        context.definition.flaGraphicSharedShapeOverrides?.[frameKey]?.[ownerPathKey],
      fallbackViewBox: targetInfo.targetNode.fallbackViewBox,
      sourceShapeRef: targetInfo.targetNode.sourceRef,
      svgText: input.svgText,
    });
    this.assertShapeOverrideSafeForEdit(nodeOverride);
    const regionRef =
      input.regionRef ??
      (nodeOverride.regions.length === 1
        ? nodeOverride.regions[0]!.regionRef
        : undefined);
    if (!regionRef) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_REGION_REQUIRED',
        '请先点选要补间的具体绘制区域。',
      );
    }
    const region = nodeOverride.regions.find(
      (candidate) => candidate.regionRef === regionRef,
    );
    if (!region) {
      throw new LayerServiceError(
        'SHAPE_REGION_NOT_FOUND',
        '未找到对应的绘制区域。',
      );
    }
    this.assertFlaShapeTweenGeometrySupported(region);
    const target: FlaShapeTweenTarget = {
      nodeTrackId: targetInfo.trackId,
      ownerKind: targetInfo.ownerKind,
      ...(targetInfo.ownerSymbolDefId
        ? { ownerSymbolDefId: targetInfo.ownerSymbolDefId }
        : {}),
      regionRef,
      sourceFrameOrdinal: input.frameOrdinal,
      sourceNodePath: [...input.nodePath],
    };
    if (
      findFlaShapeTweenTrackForTarget(structure.shapeTweenTracks, target)
    ) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_DUPLICATE',
        '当前区域已存在形状补间，请直接编辑或删除现有补间。',
      );
    }
    const startTimeMs = this.sanitizeFlaShapeTweenTime(
      input.startTimeMs,
      '补间开始时间',
    );
    const durationMs = this.sanitizeFlaShapeTweenTime(
      input.durationMs,
      '补间时长',
    );
    if (durationMs <= 0) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_INVALID_TIME',
        '补间时长必须大于 0 毫秒。',
      );
    }
    const endTimeMs = startTimeMs + durationMs;
    if (!Number.isSafeInteger(endTimeMs)) {
      throw new LayerServiceError('SHAPE_TWEEN_INVALID_TIME', '补间结束时间超出支持范围。');
    }
    const from = cloneFlaEditableShapeRegion(region);
    const to = cloneFlaEditableShapeRegion(region);
    const track: FlaShapeTweenTrack = {
      tweenId: this.stableFlaShapeTweenId(target),
      target,
      startTimeMs,
      endTimeMs,
      easing: input.easing ?? 'linear',
      from,
      to,
    };
    const committed = this.commitShapeOverrides(
      project,
      context,
      'definition',
      frameKey,
      ownerPathKey,
      nodeOverride,
    );
    const next = this.commitFlaGraphicShapeTweenTrack(
      committed,
      context.animationIndex,
      track,
    );
    return ProjectSchema.parse(next);
  }

  updateFlaGraphicShapeTween(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly tweenId: string;
      readonly pose?: 'from' | 'to';
      readonly region?: FlaEditableShapeRegion;
      readonly startTimeMs?: number;
      readonly endTimeMs?: number;
      readonly easing?: FlaShapeTweenEasing;
    },
  ): Project {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    const track = findFlaShapeTweenTrackById(structure.shapeTweenTracks, input.tweenId);
    if (!track) {
      return project;
    }
    if (input.pose && !input.region) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
        '修改补间姿态需要提供新的区域几何。',
      );
    }
    if (input.region && !input.pose) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
        '请指定要修改的补间姿态。',
      );
    }
    if (!input.pose && !input.region && input.startTimeMs === undefined &&
        input.endTimeMs === undefined && input.easing === undefined) {
      return project;
    }
    let nextTrack: FlaShapeTweenTrack = { ...track };
    if (input.pose && input.region) {
      const nextRegion = cloneFlaEditableShapeRegion(input.region);
      const otherPose = input.pose === 'from' ? track.to : track.from;
      if (!sameFlaShapeTweenStyle(nextRegion, otherPose)) {
        throw new LayerServiceError(
          'SHAPE_TWEEN_GEOMETRY_UNSUPPORTED',
          '形状补间的两个姿态必须使用相同的填充和描边样式。',
        );
      }
      this.assertFlaShapeTweenGeometrySupported(
        nextRegion,
        input.pose === 'from' ? track.to : track.from,
        track.hints,
      );
      nextTrack = { ...nextTrack, [input.pose]: nextRegion };
    }
    const startTimeMs =
      input.startTimeMs !== undefined
        ? this.sanitizeFlaShapeTweenTime(input.startTimeMs, '补间开始时间')
        : nextTrack.startTimeMs;
    const endTimeMs =
      input.endTimeMs !== undefined
        ? this.sanitizeFlaShapeTweenTime(input.endTimeMs, '补间结束时间')
        : nextTrack.endTimeMs;
    if (endTimeMs <= startTimeMs) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_INVALID_TIME',
        '补间结束时间必须晚于开始时间。',
      );
    }
    nextTrack = {
      ...nextTrack,
      startTimeMs,
      endTimeMs,
      ...(input.easing !== undefined ? { easing: input.easing } : {}),
    };
    const next = this.commitFlaGraphicShapeTweenTrack(
      project,
      context.animationIndex,
      nextTrack,
    );
    return ProjectSchema.parse(next);
  }

  deleteFlaGraphicShapeTween(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly tweenId: string;
    },
  ): Project {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    if (!findFlaShapeTweenTrackById(structure.shapeTweenTracks, input.tweenId)) {
      return project;
    }
    const nextStructure = withoutFlaShapeTweenTrack(structure, input.tweenId);
    if (nextStructure === structure) return project;
    const nextAnimations = [...project.animations];
    nextAnimations[context.animationIndex] = {
      ...context.definition,
      structure: nextStructure,
    };
    return ProjectSchema.parse({ ...project, animations: nextAnimations });
  }

  /**
   * Adds one author hint pair to an existing tween (#1458). One call = one undo
   * through the renderer store; invalid geometry/conflicting hints are rejected
   * with a clear Chinese error and never persisted.
   */
  addFlaGraphicShapeTweenHint(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly tweenId: string;
      readonly from: FlaShapeTweenHintLocation;
      readonly to: FlaShapeTweenHintLocation;
    },
  ): Project {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    const track = findFlaShapeTweenTrackById(structure.shapeTweenTracks, input.tweenId);
    if (!track) {
      throw new LayerServiceError('SHAPE_TWEEN_NOT_FOUND', '未找到对应的形状补间。');
    }
    const existing = track.hints ?? [];
    if (existing.length >= FLA_SHAPE_TWEEN_MAX_HINTS) {
      throw new LayerServiceError(
        'SHAPE_TWEEN_HINT_LIMIT',
        `一个形状补间最多支持 ${FLA_SHAPE_TWEEN_MAX_HINTS} 个提示点。`,
      );
    }
    const location = {
      from: toFlaShapeTweenHintLocation(input.from),
      to: toFlaShapeTweenHintLocation(input.to),
    };
    const hintId = stableFlaShapeTweenHintId(location, (candidate) =>
      existing.some((hint) => hint.hintId === candidate),
    );
    const nextHints = [...existing, { hintId, ...location }];
    this.assertFlaShapeTweenHintsSupported(track, nextHints);
    const next = this.commitFlaGraphicShapeTweenTrack(
      project,
      context.animationIndex,
      withFlaShapeTweenHints(track, nextHints),
    );
    return ProjectSchema.parse(next);
  }

  /** Moves one authored hint endpoint; one call = one undo. */
  updateFlaGraphicShapeTweenHint(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly tweenId: string;
      readonly hintId: string;
      readonly from?: FlaShapeTweenHintLocation;
      readonly to?: FlaShapeTweenHintLocation;
    },
  ): Project {
    if (input.from === undefined && input.to === undefined) return project;
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    const track = findFlaShapeTweenTrackById(structure.shapeTweenTracks, input.tweenId);
    if (!track) {
      throw new LayerServiceError('SHAPE_TWEEN_NOT_FOUND', '未找到对应的形状补间。');
    }
    const existing = track.hints ?? [];
    const hintIndex = existing.findIndex((hint) => hint.hintId === input.hintId);
    if (hintIndex < 0) {
      throw new LayerServiceError('SHAPE_TWEEN_NOT_FOUND', '未找到对应的形状提示点。');
    }
    const nextHints = existing.map((hint, index) =>
      index === hintIndex
        ? withFlaShapeTweenHintLocations(hint, {
            ...(input.from !== undefined ? { from: input.from } : {}),
            ...(input.to !== undefined ? { to: input.to } : {}),
          })
        : hint,
    );
    this.assertFlaShapeTweenHintsSupported(track, nextHints);
    const next = this.commitFlaGraphicShapeTweenTrack(
      project,
      context.animationIndex,
      withFlaShapeTweenHints(track, nextHints),
    );
    return ProjectSchema.parse(next);
  }

  /** Removes one author hint; removing the last hint restores the unhinted track shape. */
  removeFlaGraphicShapeTweenHint(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly tweenId: string;
      readonly hintId: string;
    },
  ): Project {
    const context = this.resolveEditableFlaGraphicContext(
      project,
      input.shotId,
      input.layerId,
    );
    const structure = context.definition.structure!;
    const track = findFlaShapeTweenTrackById(structure.shapeTweenTracks, input.tweenId);
    if (!track) return project;
    const existing = track.hints ?? [];
    const nextHints = existing.filter((hint) => hint.hintId !== input.hintId);
    if (nextHints.length === existing.length) return project;
    const next = this.commitFlaGraphicShapeTweenTrack(
      project,
      context.animationIndex,
      withFlaShapeTweenHints(track, nextHints),
    );
    return ProjectSchema.parse(next);
  }

  updateFlaGraphicShapeRegionFillColor(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly frameOrdinal: number;
      readonly nodePath: readonly string[];
      readonly regionRef?: string;
      readonly mode: 'instance' | 'definition';
      readonly color: string;
      readonly opacity?: number;
      readonly svgText?: string;
    },
  ): Project {
    return this.mutateFlaGraphicShapeRegion(project, {
      ...input,
      ...(input.mode === 'definition'
        ? { tweenPoseScope: 'both' as const }
        : {}),
      mutator: (region) => setShapeRegionSolidFillColorPure(region, input.color, input.opacity),
      failReason: {
        code: 'SHAPE_FILL_NOT_SOLID',
        message: '仅纯色填充区域支持修改填充色，渐变或位图填充暂保持只读。',
      },
    });
  }

  moveFlaGraphicShapeRegionVertex(
    project: Project,
    input: {
      readonly shotId: string;
      readonly layerId: string;
      readonly frameOrdinal: number;
      readonly nodePath: readonly string[];
      readonly regionRef?: string;
      readonly mode: 'instance' | 'definition';
      readonly target: FlaShapeVertexTarget;
      readonly x: number;
      readonly y: number;
      readonly svgText?: string;
      /** Current internal Graphic time used to resolve the authored tween endpoint. */
      readonly internalTimeMs?: number;
    },
  ): Project {
    return this.mutateFlaGraphicShapeRegion(project, {
      ...input,
      ...(input.mode === 'definition'
        ? { tweenPoseScope: 'current-endpoint' as const }
        : {}),
      mutator: (region) => moveShapeRegionVertexPure(region, input.target, input.x, input.y),
    });
  }

  private mutateFlaGraphicTimeline(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    mutator: (
      target: FlaGraphicTimelineTargetInfo & { readonly trackId: string },
    ) => FlaGraphicInternalTimeline | undefined,
  ): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertEditable(shot, layer);
    const source = layer.source;
    if (source.kind !== 'animation') return project;
    const animationIndex = project.animations.findIndex(
      (candidate) => candidate.id === source.animationId,
    );
    if (animationIndex < 0) return project;
    const definition = project.animations[animationIndex]!;
    if (!isFlaGraphicDefinition(definition) || !definition.structure) {
      return project;
    }
    const target = resolveFlaGraphicTimelineTarget(
      definition.structure,
      frameOrdinal,
      nodePath,
    );
    if (!target || !target.trackId) return project;
    const nextTimeline = mutator({ ...target, trackId: target.trackId });
    const nextStructure = withFlaGraphicContainerTimeline(
      definition.structure,
      target,
      nextTimeline,
    );
    if (nextStructure === definition.structure) return project;
    const nextAnimations = [...project.animations];
    nextAnimations[animationIndex] = {
      ...definition,
      structure: nextStructure,
    };
    return {
      ...project,
      animations: nextAnimations,
    };
  }

  /**
   * Rejects internal transform-key authoring for a target that is locally
   * read-only: opaque nodes, nodes without a stable identity, matrices that
   * cannot be losslessly keyed (non-finite / near-singular / non-round-tripping),
   * and tracks whose consecutive keys flip the determinant sign (interpolating
   * them would pass through an almost degenerate, visually flipping frame).
   */
  private assertFlaGraphicTimelineAuthoringAllowed(
    target: FlaGraphicTimelineTargetInfo,
    action: string,
  ): void {
    switch (target.authoringCapability) {
      case 'editable':
        return;
      case 'readonly-opaque':
        throw new Error(`当前对象只读，无法${action}。`);
      case 'readonly-identity':
        throw new Error(`当前节点无稳定身份，无法${action}。`);
      case 'readonly-trs-unsafe':
        throw new Error(`当前节点变换无法无损分解为内部关键帧，暂不支持${action}。`);
      case 'readonly-affine-unsafe':
        throw new Error(
          `相邻关键帧的缩放方向相反，补间会经过退化帧，暂不支持${action}。`,
        );
    }
  }

  addFlaGraphicTimelineKeyframe(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    easing: FlaGraphicTransformEasing = 'linear',
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) => {
        this.assertFlaGraphicTimelineAuthoringAllowed(target, '添加关键帧');
        const existingTrack = target.timeline?.tracks.find(
          (t) => t.trackId === target.trackId,
        );
        const initialMatrix =
          (existingTrack
            ? evaluateFlaGraphicTrackAtTime(existingTrack, timeMs)
            : null) ?? target.targetNode.localTransform;
        if (!isAffineMatrixTimelineRepresentable(initialMatrix)) {
          throw new Error(
            '当前节点变换无法无损分解为内部关键帧，暂不支持添加关键帧。',
          );
        }
        const nextTimeline = addTimelineKeyframePure(
          target.timeline,
          target.trackId,
          timeMs,
          initialMatrix,
          easing,
        );
        const nextTrack = nextTimeline.tracks.find(
          (candidate) => candidate.trackId === target.trackId,
        );
        if (nextTrack && !isFlaGraphicTransformTrackInterpolationSafe(nextTrack)) {
          throw new Error(
            '新增关键帧会使相邻关键帧的缩放方向相反，暂不支持添加关键帧。',
          );
        }
        return nextTimeline;
      },
    );
  }

  updateFlaGraphicTimelineKeyframeTransform(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    localTransform: AffineMatrix2D,
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) => {
        this.assertFlaGraphicTimelineAuthoringAllowed(target, '编辑关键帧');
        if (!isAffineMatrixTimelineRepresentable(localTransform)) {
          throw new Error(
            '该变换包含无法无损表示的分量（近奇异或非有限），暂不支持写入关键帧。',
          );
        }
        const nextTimeline = updateTimelineKeyframeTransformPure(
          target.timeline,
          target.trackId,
          timeMs,
          localTransform,
        );
        const nextTrack = nextTimeline?.tracks.find(
          (candidate) => candidate.trackId === target.trackId,
        );
        if (
          nextTrack &&
          !isFlaGraphicTransformTrackInterpolationSafe(nextTrack)
        ) {
          throw new Error(
            '该变换会使相邻关键帧的缩放方向相反，补间会经过退化帧，暂不支持写入关键帧。',
          );
        }
        return nextTimeline;
      },
    );
  }

  deleteFlaGraphicTimelineKeyframe(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) =>
        deleteTimelineKeyframePure(target.timeline, target.trackId, timeMs),
    );
  }

  moveFlaGraphicTimelineKeyframe(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) =>
        moveTimelineKeyframePure(
          target.timeline,
          target.trackId,
          fromTimeMs,
          toTimeMs,
        ),
    );
  }

  duplicateFlaGraphicTimelineKeyframe(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) =>
        duplicateTimelineKeyframePure(
          target.timeline,
          target.trackId,
          fromTimeMs,
          toTimeMs,
        ),
    );
  }

  setFlaGraphicTimelineKeyframeEasing(
    project: Project,
    shotId: string,
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    easing: FlaGraphicTransformEasing,
  ): Project {
    return this.mutateFlaGraphicTimeline(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      (target) =>
        setTimelineKeyframeEasingPure(
          target.timeline,
          target.trackId,
          timeMs,
          easing,
        ),
    );
  }

  toggleFlipX(
    project: Project,
    shotId: string,
    layerId: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const layers = [...shot.layers];
    layers[layerIndex] = { ...layer, flipX: !layer.flipX };
    return this.replaceShot(project, { ...shot, layers });
  }

  updateAnimationPlayback(
    project: Project,
    shotId: string,
    layerId: string,
    input: AnimationPlaybackInput,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        '只能修改动画图层的播放设置。',
      );
    }
    this.assertEditable(shot, layer);

    const startTimeMs = input.startTimeMs ?? layer.startTimeMs;
    if (
      startTimeMs === undefined ||
      !Number.isFinite(startTimeMs) ||
      startTimeMs < 0 ||
      startTimeMs > shot.durationMs
    ) {
      throw new LayerServiceError(
        'INVALID_ANIMATION_START_TIME',
        '动画开始时间必须位于当前镜头时长内。',
      );
    }
    const mode = input.mode ?? layer.animationPlayback.mode;
    const endBehavior =
      input.endBehavior ?? layer.animationPlayback.endBehavior;
    if (
      (mode !== 'once' && mode !== 'loop') ||
      (endBehavior !== 'hold' && endBehavior !== 'hide')
    ) {
      throw new LayerServiceError(
        'INVALID_ANIMATION_PLAYBACK',
        '请选择有效的动画播放方式和结束行为。',
      );
    }
    if (
      startTimeMs === layer.startTimeMs &&
      mode === layer.animationPlayback.mode &&
      endBehavior === layer.animationPlayback.endBehavior
    ) {
      return project;
    }
    const layers = [...shot.layers];
    layers[layerIndex] = {
      ...layer,
      startTimeMs,
      animationPlayback: { mode, endBehavior },
    };
    return this.replaceShot(project, { ...shot, layers });
  }

  applySourceLoop(
    project: Project, shotId: string, layerId: string,
    input: { firstFrame: number; lastFrame: number; closingReference: boolean; throughLayerId: string },
  ): { project: Project; stoppedAt?: string } {
    const shot = this.shot(project, shotId);
    const ordered = [...shot.layers].sort((left, right) => left.zIndex - right.zIndex);
    const startIndex = ordered.findIndex(({ id }) => id === layerId);
    const endIndex = ordered.findIndex(({ id }) => id === input.throughLayerId);
    const start = ordered[startIndex];
    if (!start || start.source.kind !== 'animation' || endIndex < startIndex) {
      throw new LayerServiceError('ANIMATION_LAYER_REQUIRED', '请选择从当前动画图层开始的连续范围。');
    }
    this.assertEditable(shot, start);
    const animationId = start.source.animationId;
    const definition = project.animations.find(({ id }) => id === animationId);
    if (!definition || input.lastFrame >= resolveFlaGraphicPreviewTimeline(definition, true).totalFrames) {
      throw new LayerServiceError('ANIMATION_FRAME_INVALID', '尾帧必须位于源动画内。');
    }
    const range = AnimationSourceRangeSchema.safeParse({
      firstFrame: input.firstFrame,
      lastFrame: input.lastFrame - Number(input.closingReference),
    });
    if (!range.success) throw new LayerServiceError('ANIMATION_FRAME_INVALID', '循环至少保留一个播放帧。');
    const edits = new Map<string, Layer>();
    let stoppedAt: string | undefined;
    for (const layer of ordered.slice(startIndex, endIndex + 1)) {
      if (layer.source.kind !== 'animation' || layer.source.animationId !== animationId || layer.locked || !layer.animationPlayback) {
        stoppedAt = layer.name;
        break;
      }
      if (layer.animationSourceRange?.firstFrame === range.data.firstFrame &&
        layer.animationSourceRange.lastFrame === range.data.lastFrame && layer.animationPlayback.mode === 'loop') continue;
      edits.set(layer.id, { ...layer, animationSourceRange: range.data, animationPlayback: { ...layer.animationPlayback, mode: 'loop' } });
    }
    const next = edits.size ? this.replaceShot(project, { ...shot, layers: shot.layers.map((layer) => edits.get(layer.id) ?? layer) }) : project;
    return { project: next, stoppedAt };
  }

  reorder(
    project: Project,
    shotId: string,
    layerId: string,
    action: LayerOrderAction,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    const ordered = shot.layers
      .filter((candidate) => candidate.id !== shot.backgroundLayerId)
      .sort((left, right) => left.zIndex - right.zIndex);
    const currentIndex = ordered.findIndex(
      (candidate) => candidate.id === layer.id,
    );
    const targetIndex =
      action === 'front'
        ? ordered.length - 1
        : action === 'back'
          ? 0
          : action === 'forward'
            ? Math.min(ordered.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
    if (targetIndex === currentIndex) return project;
    ordered.splice(currentIndex, 1);
    ordered.splice(targetIndex, 0, layer);
    return this.replaceShot(project, {
      ...shot,
      layers: this.normalizeLayerOrder(shot, ordered),
    });
  }

  renameContentLayers(project: Project, shotId: string, names: ReadonlyMap<string, string>): Project {
    const shot = this.shot(project, shotId);
    const changes = new Map<string, string>();
    for (const [id, input] of names) {
      const layer = shot.layers[this.layerIndex(shot, id)]!;
      this.assertContentLayer(shot, layer);
      this.assertEditable(shot, layer);
      const name = NameSchema.parse(input);
      if (name !== layer.name) changes.set(id, name);
    }
    if (!changes.size) return project;
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => {
        const name = changes.get(layer.id);
        return name === undefined ? layer : { ...layer, name };
      }),
    });
  }

  /**
   * Sets (or clears) an author-level coverage mask relationship (#1454).
   * A Layer with `maskTargets` present is a mask layer and is not drawn as
   * ordinary output content; the listed Layers are clipped by its coverage.
   * `targetLayerIds === null` removes the mask relationship entirely.
   */
  setMaskTargets(
    project: Project,
    shotId: string,
    layerId: string,
    targetLayerIds: readonly string[] | null,
  ): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    if (layer.source.kind === 'control') {
      throw new LayerServiceError(
        'COVERAGE_MASK_CONTROL_LAYER',
        '控制层没有可用于遮罩的画面。',
      );
    }
    if (targetLayerIds === null) {
      if (layer.maskTargets === undefined) return project;
      const { maskTargets: _previous, ...base } = layer;
      void _previous;
      return this.replaceShot(project, {
        ...shot,
        layers: shot.layers.map((entry) => (entry === layer ? base : entry)),
      });
    }
    const claimedMaskLayerId = resolveShotCoverageMasks(shot)
      .maskLayerIdByTarget.get(layer.id);
    if (claimedMaskLayerId !== undefined) {
      throw new LayerServiceError(
        'COVERAGE_MASK_LAYER_CONFLICT',
        `图层“${layer.name}”当前被其他遮罩覆盖，不能同时作为遮罩。请先解除原遮罩。`,
      );
    }
    const parsed = LayerCoverageMaskTargetsSchema.parse([...targetLayerIds]);
    const previous = layer.maskTargets;
    if (
      previous !== undefined &&
      previous.length === parsed.length &&
      previous.every((id, index) => id === parsed[index])
    ) {
      return project;
    }
    assertCoverageMaskChange(shot, layer.id, parsed);
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((entry) =>
        entry === layer ? { ...entry, maskTargets: parsed } : entry,
      ),
    });
  }

  setVisualEffects(project: Project, shotId: string, layerId: string, effects?: LayerVisualEffects): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    if (layer.source.kind === 'control') throw new Error('控制层没有可应用效果的画面。');
    const parsed = effects === undefined ? undefined : LayerVisualEffectsSchema.parse(effects);
    const next = parsed && hasLayerVisualEffects(parsed) ? parsed : undefined;
    if (JSON.stringify(layer.visualEffects) === JSON.stringify(next)) return project;
    const { visualEffects: _previous, ...base } = layer;
    void _previous;
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((entry) => entry === layer ? { ...base, ...(next ? { visualEffects: next } : {}) } : entry),
    });
  }

  updateLayerAppearance(project: Project, shotId: string, layerId: string, changes: Partial<Pick<Layer, 'opacity' | 'flipX'>>): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertEditable(shot, layer);
    return this.replaceShot(project, { ...shot, layers: shot.layers.map((entry) =>
      entry.id === layerId ? { ...entry, ...changes } : entry) });
  }

  setCameraAttachment(project: Project, shotId: string, layerId: string, attached: boolean): Project {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    if (layer.parentLayerId || layer.parentKeys?.some((key) => key.parentLayerId !== null)) {
      throw new Error('请先解除父级绑定，再切换相机附着。');
    }
    if ((layer.cameraSpace === 'screen') === attached) return project;
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((entry) => entry.id === layerId
        ? { ...entry, cameraSpace: attached ? 'screen' : undefined }
        : entry),
    });
  }

  private buildParentKeyAtBoundary(
    project: Project,
    evalShot: Shot,
    child: Layer,
    timeMs: number,
    parentId: string | null,
    options?: SetParentKeyOptions,
  ): LayerParentKey {
    const poses = projectShotDialogueVisual(project, evalShot, evaluateShotAtTime(evalShot, timeMs, project)).layers;
    const childPose = poses.find(({ id }) => id === child.id);
    const oldSpace = childPose?.parentSpace;
    const oldCameraSpace = childPose?.effectiveCameraSpace ?? 'world';
    if (parentId === null) {
      const preservedDepth = frozenParentKeyDepth(child, childPose, false);
      const preservedSpace = frozenDetachedKeyCameraSpace(child, childPose);
      return {
        timeMs,
        parentLayerId: null,
        ...(oldSpace ? { parentSpaceOffset: oldSpace } : {}),
        depthMode: 'preserve',
        ...(preservedDepth !== undefined ? { depth: preservedDepth } : {}),
        ...(preservedSpace ? { cameraSpace: preservedSpace } : {}),
      };
    }
    const parentPose = poses.find(({ id }) => id === parentId);
    const owner = evalShot.layers.find(({ id }) => id === parentId);
    if (!parentPose || !owner) {
      throw new LayerServiceError('LAYER_NOT_FOUND', `找不到图层：${parentId}`);
    }
    const newCameraSpace = parentPose.effectiveCameraSpace ?? 'world';
    if (oldCameraSpace !== newCameraSpace) {
      throw new Error('不支持直接跨世界空间与屏幕空间交接，请先解除绑定并切换相机附着后再绑定。');
    }
    const target = options?.target;
    const targetLocal = target ? resolveLayerAttachmentLocalMatrix(project, owner, parentPose, target) : undefined;
    if (target && !targetLocal) throw new Error('当前帧没有可用的挂接姿态。');
    const world = targetLocal
      ? layerAttachmentWorldMatrix(parentPose, targetLocal, parentPose.parentSpace)
      : evaluatedLayerWorldMatrix(parentPose);
    const parentInverse = !parentPose.parentSpaceUnavailable ? invertAffineMatrix(world) : undefined;
    if (!parentInverse) throw new Error('父级图层的当前变换无法反算。请调整父级姿态后重试。');
    const offset = oldSpace ? multiplyAffineMatrices(parentInverse, oldSpace) : parentInverse;
    const oldDepth = childPose?.effectiveDepth ?? 0;
    const newDepth = parentPose.effectiveDepth ?? 0;
    const depthsDiffer = Math.abs(oldDepth - newDepth) > 1e-6;
    const depthMode: LayerParentKeyDepthMode = options?.depthMode ?? (depthsDiffer ? 'preserve' : 'inherit');
    const preservedDepth = depthMode === 'preserve' ? frozenParentKeyDepth(child, childPose, depthsDiffer) : undefined;
    return {
      timeMs,
      parentLayerId: parentId,
      ...(target && targetLocal ? { parentAttachment: { target, ownerLocalFallback: targetLocal } } : {}),
      parentSpaceOffset: offset,
      depthMode,
      ...(preservedDepth !== undefined ? { depth: preservedDepth } : {}),
    };
  }

  setParent(project: Project, shotId: string, childId: string, parentId: string | null, timeMs: number, target?: LayerAttachmentTarget): Project {
    const shot = this.shot(project, shotId);
    const child = shot.layers[this.layerIndex(shot, childId)]!;
    this.assertContentLayer(shot, child);
    this.assertEditable(shot, child);
    const previousTarget = child.parentAttachment?.target;
    if ((child.parentLayerId ?? null) === parentId &&
      (previousTarget && layerAttachmentTargetKey(previousTarget)) === (target && layerAttachmentTargetKey(target))) return project;
    const baseEndMs = child.parentKeys?.[0]?.timeMs ?? Infinity;
    if (parentId && !validLayerParentTargets(shot, childId, 0, baseEndMs).some(({ id }) => id === parentId)) {
      throw new Error('请选择同一镜头内不会形成循环的父级图层。');
    }
    const evalShot: Shot = child.parentKeys?.length
      ? { ...shot, layers: shot.layers.map((layer) => (layer.id === childId ? { ...layer, parentKeys: undefined } : layer)) }
      : shot;
    const poses = projectShotDialogueVisual(project, evalShot, evaluateShotAtTime(evalShot, timeMs, project)).layers;
    const childPose = poses.find(({ id }) => id === childId);
    const oldSpace = childPose?.parentSpace;
    const parent = poses.find(({ id }) => id === parentId);
    const owner = parent && evalShot.layers.find(({ id }) => id === parent.id);
    const targetLocal = owner && parent && target ? resolveLayerAttachmentLocalMatrix(project, owner, parent, target) : undefined;
    if (target && !targetLocal) throw new Error('当前帧没有可用的挂接姿态。');
    const world = parent && (targetLocal
      ? layerAttachmentWorldMatrix(parent, targetLocal, parent.parentSpace)
      : evaluatedLayerWorldMatrix(parent));
    const parentInverse = world && !parent?.parentSpaceUnavailable && invertAffineMatrix(world);
    if (parent && !parentInverse) throw new Error('父级图层的当前变换无法反算。请调整父级姿态后重试。');
    const offset = parentInverse && oldSpace ? multiplyAffineMatrices(parentInverse, oldSpace) : parentInverse || oldSpace;
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => layer.id === childId ? {
        ...layer, parentLayerId: parentId ?? undefined, parentSpaceOffset: offset,
        cameraSpace: parentId ? undefined : childPose?.effectiveCameraSpace,
        depth: parentId ? layer.depth : preservedDetachedDepth(layer, childPose),
        parentAttachment: target && targetLocal ? { target, ownerLocalFallback: targetLocal } : undefined,
      } : layer),
    });
  }

  /**
   * Atomically bind or detach static base parenting for multiple layers in one
   * Shot. All pre-edit world poses are captured from the SAME pre-edit snapshot
   * before computing compensations so selected parent-child pairs keep their
   * exact world poses. Dynamic `parentKeys` segments are preserved untouched.
   */
  batchSetParent(
    project: Project,
    shotId: string,
    childIds: readonly string[],
    parentId: string | null,
    timeMs: number,
    target?: LayerAttachmentTarget,
  ): Project {
    const uniqueChildIds = Array.from(new Set(childIds));
    if (uniqueChildIds.length === 0) return project;
    const shot = this.shot(project, shotId);
    const selectedSet = new Set(uniqueChildIds);

    // 1. Validate every selected child up front (atomic: reject entire batch on any invalid input).
    const children: Layer[] = [];
    for (const childId of uniqueChildIds) {
      const child = shot.layers[this.layerIndex(shot, childId)]!;
      this.assertContentLayer(shot, child);
      this.assertEditable(shot, child);
      children.push(child);
    }

    // 2. Validate parent target (forbid self-binding, missing parent, and cycles in final graph).
    if (parentId !== null) {
      this.layerIndex(shot, parentId);
      if (selectedSet.has(parentId)) {
        throw new Error('不能将选中的图层绑定到自身。');
      }
      if (batchBaseParentEditCreatesCycle(shot, uniqueChildIds, parentId)) {
        throw new Error('请选择同一镜头内不会形成循环的父级图层。');
      }
    }

    const nextTargetKey = parentId && target ? layerAttachmentTargetKey(target) : undefined;
    const hasAnyChange = children.some((child) => {
      const prevParentId = child.parentLayerId ?? null;
      const prevTargetKey = child.parentAttachment?.target
        ? layerAttachmentTargetKey(child.parentAttachment.target)
        : undefined;
      return prevParentId !== parentId || prevTargetKey !== nextTargetKey;
    });
    if (!hasAnyChange) return project;

    // 3. Capture ALL pre-edit world poses from the SAME pre-edit snapshot.
    const hasAnyDynamicKeys = children.some((child) => Boolean(child.parentKeys?.length));
    const baseEvalShot: Shot = hasAnyDynamicKeys
      ? {
          ...shot,
          layers: shot.layers.map((layer) =>
            selectedSet.has(layer.id) && layer.parentKeys?.length
              ? { ...layer, parentKeys: undefined }
              : layer,
          ),
        }
      : shot;
    const prePoses = projectShotDialogueVisual(
      project,
      baseEvalShot,
      evaluateShotAtTime(baseEvalShot, timeMs, project),
    ).layers;
    const prePosesById = new Map(prePoses.map((pose) => [pose.id, pose]));

    // 4. Compute invariant target parent inverse ONCE from the pre-edit snapshot.
    let parentInverse: AffineMatrix2D | undefined;
    let resolvedAttachment: Layer['parentAttachment'];
    if (parentId !== null) {
      const parentPose = prePosesById.get(parentId);
      const owner = baseEvalShot.layers.find(({ id }) => id === parentId);
      const targetLocal =
        owner && parentPose && target
          ? resolveLayerAttachmentLocalMatrix(project, owner, parentPose, target)
          : undefined;
      if (target && !targetLocal) {
        throw new Error('当前帧没有可用的挂接姿态。');
      }
      const world =
        parentPose &&
        (targetLocal
          ? layerAttachmentWorldMatrix(parentPose, targetLocal, parentPose.parentSpace)
          : evaluatedLayerWorldMatrix(parentPose));
      const inv =
        world && !parentPose?.parentSpaceUnavailable ? invertAffineMatrix(world) : undefined;
      if (!inv) {
        throw new Error('父级图层的当前变换无法反算。请调整父级姿态后重试。');
      }
      parentInverse = inv;
      resolvedAttachment =
        target && targetLocal ? { target, ownerLocalFallback: targetLocal } : undefined;
    }

    // 5. Commit all compensated bindings in ONE atomic replaceShot.
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => {
        if (!selectedSet.has(layer.id)) return layer;
        const childPose = prePosesById.get(layer.id);
        const oldSpace = childPose?.parentSpace;
        const offset =
          parentInverse && oldSpace
            ? multiplyAffineMatrices(parentInverse, oldSpace)
            : parentInverse || oldSpace;
        return {
          ...layer,
          parentLayerId: parentId ?? undefined,
          parentSpaceOffset: offset,
          cameraSpace: parentId ? undefined : childPose?.effectiveCameraSpace,
          depth: parentId ? layer.depth : preservedDetachedDepth(layer, childPose),
          parentAttachment: parentId ? resolvedAttachment : undefined,
        };
      }),
    });
  }

  batchDetachParent(
    project: Project,
    shotId: string,
    childIds: readonly string[],
    timeMs: number,
  ): Project {
    return this.batchSetParent(project, shotId, childIds, null, timeMs);
  }

  /**
   * Create a new empty control layer and batch-bind all selected children to it
   * in a single atomic Project result (one Undo/Redo transaction).
   */
  createControllerAndBindLayers(
    project: Project,
    shotId: string,
    childIds: readonly string[],
    timeMs: number,
  ): CreateLayerResult {
    const uniqueChildIds = Array.from(new Set(childIds));
    const shot = this.shot(project, shotId);
    for (const childId of uniqueChildIds) {
      const child = shot.layers[this.layerIndex(shot, childId)]!;
      this.assertContentLayer(shot, child);
      this.assertEditable(shot, child);
    }
    const created = this.createControl(project, shotId);
    if (uniqueChildIds.length === 0) return created;
    const bound = this.batchSetParent(
      created.project,
      shotId,
      uniqueChildIds,
      created.layer.id,
      timeMs,
    );
    return { project: bound, layer: created.layer };
  }

  setParentKey(
    project: Project,
    shotId: string,
    childId: string,
    requestedTimeMs: number,
    parentId: string | null,
    options?: SetParentKeyOptions,
  ): Project {
    const shot = this.shot(project, shotId);
    const child = shot.layers[this.layerIndex(shot, childId)]!;
    this.assertContentLayer(shot, child);
    this.assertEditable(shot, child);
    const timeMs = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
    const existingKeys = child.parentKeys ?? [];
    const nextKeyTime = existingKeys.find((key) => key.timeMs > timeMs)?.timeMs ?? Infinity;
    if (parentId !== null && !validLayerParentTargets(shot, childId, timeMs, nextKeyTime).some(({ id }) => id === parentId)) {
      throw new Error('请选择同一镜头内不会形成循环的父级图层。');
    }
    const nextKey = this.buildParentKeyAtBoundary(project, shot, child, timeMs, parentId, options);
    const parentKeys = [
      ...existingKeys.filter((key) => key.timeMs !== timeMs),
      nextKey,
    ].sort((left, right) => left.timeMs - right.timeMs);
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => (layer.id === childId ? { ...layer, parentKeys } : layer)),
    });
  }

  moveParentKey(
    project: Project,
    shotId: string,
    childId: string,
    fromTimeMs: number,
    requestedToTimeMs: number,
  ): Project {
    const shot = this.shot(project, shotId);
    const child = shot.layers[this.layerIndex(shot, childId)]!;
    this.assertContentLayer(shot, child);
    this.assertEditable(shot, child);
    const existingKeys = child.parentKeys ?? [];
    const moving = existingKeys.find((key) => key.timeMs === fromTimeMs);
    if (!moving) return project;
    if (!Number.isFinite(requestedToTimeMs) || requestedToTimeMs < 0 || requestedToTimeMs > shot.durationMs) {
      throw new Error('请输入镜头时长范围内的交接时间。');
    }
    const toTimeMs = resolveTimelineFrameTime(requestedToTimeMs, shot.durationMs);
    if (toTimeMs === fromTimeMs) return project;
    const others = existingKeys.filter((key) => key.timeMs !== fromTimeMs);
    if (others.some((key) => key.timeMs === toTimeMs)) {
      throw new Error('目标帧已存在父级切换关键帧。');
    }
    const candidateKeys = [...others, { ...moving, timeMs: toTimeMs }].sort((left, right) => left.timeMs - right.timeMs);
    const ranges = [fromTimeMs, toTimeMs].map((startMs) => ({
      startMs,
      endMs: others.find((key) => key.timeMs > startMs)?.timeMs ?? Infinity,
    }));
    if (parentKeyEditCreatesCycle(shot, child, { ...child, parentKeys: candidateKeys }, ranges)) {
      throw new Error('移动交接帧会让图层在同一时间互为父级，形成循环。请选择其他时间。');
    }
    const shotWithoutMoving: Shot = {
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.id === childId ? { ...layer, parentKeys: others.length ? others : undefined } : layer,
      ),
    };
    const movedKey = this.buildParentKeyAtBoundary(
      project,
      shotWithoutMoving,
      child,
      toTimeMs,
      moving.parentLayerId,
      { target: moving.parentAttachment?.target, depthMode: moving.depthMode },
    );
    const parentKeys = candidateKeys.map((key) => key.timeMs === toTimeMs ? movedKey : key);
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => (layer.id === childId ? { ...layer, parentKeys } : layer)),
    });
  }

  removeParentKey(
    project: Project,
    shotId: string,
    childId: string,
    timeMs: number,
  ): Project {
    const shot = this.shot(project, shotId);
    const child = shot.layers[this.layerIndex(shot, childId)]!;
    this.assertContentLayer(shot, child);
    this.assertEditable(shot, child);
    const existingKeys = child.parentKeys ?? [];
    if (!existingKeys.some((key) => key.timeMs === timeMs)) return project;
    const remaining = existingKeys.filter((key) => key.timeMs !== timeMs);
    const endMs = remaining.find((key) => key.timeMs > timeMs)?.timeMs ?? Infinity;
    if (parentKeyEditCreatesCycle(shot, child, { ...child, parentKeys: remaining }, [{ startMs: timeMs, endMs }])) {
      throw new Error('删除交接帧会让图层在同一时间互为父级，形成循环。');
    }
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => {
        if (layer.id !== childId) return layer;
        if (remaining.length) return { ...layer, parentKeys: remaining };
        const { parentKeys: _removedParentKeys, ...rest } = layer;
        void _removedParentKeys;
        return rest;
      }),
    });
  }

  realignParentKey(
    project: Project,
    shotId: string,
    childId: string,
    timeMs: number,
  ): Project {
    const shot = this.shot(project, shotId);
    const child = shot.layers[this.layerIndex(shot, childId)]!;
    this.assertContentLayer(shot, child);
    this.assertEditable(shot, child);
    const existingKeys = child.parentKeys ?? [];
    const targetKey = existingKeys.find((key) => key.timeMs === timeMs);
    if (!targetKey) return project;
    const others = existingKeys.filter((key) => key.timeMs !== timeMs);
    const shotWithoutTarget: Shot = {
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.id === childId ? { ...layer, parentKeys: others.length ? others : undefined } : layer,
      ),
    };
    const realigned = this.buildParentKeyAtBoundary(
      project,
      shotWithoutTarget,
      child,
      timeMs,
      targetKey.parentLayerId,
      { target: targetKey.parentAttachment?.target, depthMode: targetKey.depthMode },
    );
    const parentKeys = existingKeys.map((key) => (key.timeMs === timeMs ? realigned : key));
    return this.replaceShot(project, {
      ...shot,
      layers: shot.layers.map((layer) => (layer.id === childId ? { ...layer, parentKeys } : layer)),
    });
  }

  deleteLayer(
    project: Project,
    shotId: string,
    layerId: string,
    timeMs = 0,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    const poseCache = new Map<number, Map<string, EvaluatedLayer>>();
    const poseAt = (evalTimeMs: number, targetLayerId: string): EvaluatedLayer | undefined => {
      let atTime = poseCache.get(evalTimeMs);
      if (!atTime) {
        atTime = new Map(
          projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, evalTimeMs, project)).layers.map(
            (pose) => [pose.id, pose],
          ),
        );
        poseCache.set(evalTimeMs, atTime);
      }
      return atTime.get(targetLayerId);
    };
    const remaining = shot.layers.filter((candidate) => candidate.id !== layer.id).map((candidate) => {
      // Deleting a target Layer must not persist a dangling mask relationship.
      const nextCandidate = candidate.maskTargets?.includes(layer.id)
        ? {
            ...candidate,
            maskTargets: candidate.maskTargets.filter((id) => id !== layer.id),
          }
        : candidate;
      const baseRefsDeleted = candidate.parentLayerId === layerId;
      const keysRefDeleted = Boolean(candidate.parentKeys?.some((key) => key.parentLayerId === layerId));
      if (!baseRefsDeleted && !keysRefDeleted) return nextCandidate;
      let updatedCandidate = nextCandidate;
      if (baseRefsDeleted) {
        const baseIsActive = !candidate.parentKeys?.length || timeMs < candidate.parentKeys[0]!.timeMs;
        const basePose = poseAt(baseIsActive ? timeMs : 0, candidate.id);
        updatedCandidate = {
          ...updatedCandidate,
          parentLayerId: undefined,
          parentAttachment: undefined,
          parentSpaceOffset: basePose?.parentSpace,
          cameraSpace: basePose?.effectiveCameraSpace,
          depth: preservedDetachedDepth(candidate, basePose),
        };
      }
      if (keysRefDeleted && candidate.parentKeys) {
        const nextKeys: LayerParentKey[] = candidate.parentKeys.map((key, index) => {
          if (key.parentLayerId !== layerId) return key;
          const nextTime = candidate.parentKeys![index + 1]?.timeMs ?? Infinity;
          const isCurrentSegment = timeMs >= key.timeMs && timeMs < nextTime;
          const segPose = poseAt(isCurrentSegment ? timeMs : key.timeMs, candidate.id);
          const preservedDepth = frozenParentKeyDepth(updatedCandidate, segPose, false);
          const preservedSpace = frozenDetachedKeyCameraSpace(updatedCandidate, segPose);
          return {
            timeMs: key.timeMs,
            parentLayerId: null,
            ...(segPose?.parentSpace ? { parentSpaceOffset: segPose.parentSpace } : {}),
            depthMode: 'preserve',
            ...(preservedDepth !== undefined ? { depth: preservedDepth } : {}),
            ...(preservedSpace ? { cameraSpace: preservedSpace } : {}),
          };
        });
        updatedCandidate = { ...updatedCandidate, parentKeys: nextKeys };
      }
      return updatedCandidate;
    });
    const remainingShot = { ...shot, layers: remaining };
    return this.replaceShot(project, {
      ...remainingShot,
      layers: this.normalizeLayerOrder(
        remainingShot,
        remaining
          .filter(
            (candidate) => candidate.id !== shot.backgroundLayerId,
          )
          .sort((left, right) => left.zIndex - right.zIndex),
      ),
      timelineEvents: shot.timelineEvents.filter(
        (event) => event.layerId !== layer.id,
      ),
    });
  }

  duplicateAnimationLayer(
    project: Project,
    shotId: string,
    layerId: string,
  ): CreateLayerResult {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        '只能复制动画图层。',
      );
    }
    return this.duplicateLayer(project, shotId, layerId);
  }

  duplicateLayer(project: Project, shotId: string, layerId: string, destinationShotId = shotId, timeMs = 0, sourceProject = project): CreateLayerResult {
    const shot = this.shot(sourceProject, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    const destination = this.shot(project, destinationShotId);
    const sameShot = shot.id === destination.id;
    const keepParent = sameShot && destination.layers.some(({ id }) => id === layer.parentLayerId);
    const hasParenting = Boolean(layer.parentLayerId || layer.parentKeys?.length);
    const detachedPose = (!sameShot && hasParenting) || (!keepParent && layer.parentLayerId)
      ? projectShotDialogueVisual(sourceProject, shot, evaluateShotAtTime(shot, timeMs, sourceProject))
        .layers.find(({ id }) => id === layerId)
      : undefined;
    const copiedSpace = detachedPose?.parentSpace ?? layer.parentSpaceOffset;
    const copiedDepth = detachedPose && !sameShot && layer.parentKeys?.length && !layer.depthKeys?.length
      ? detachedPose.effectiveDepth ?? 0
      : preservedDetachedDepth(layer, detachedPose);
    const copiedParentKeys = sameShot && layer.parentKeys?.length
      ? layer.parentKeys
          .filter((key) => key.parentLayerId === null || destination.layers.some(({ id }) => id === key.parentLayerId))
          .map((key) => structuredClone(key))
      : undefined;

    const usedIds = this.projectIds(project);
    const offsetPosition = clampLayerPosition({
      x: layer.x + 24,
      y: layer.y + 24,
    });
    const position = !sameShot ? { x: layer.x, y: layer.y } :
      offsetPosition.x === layer.x && offsetPosition.y === layer.y
        ? clampLayerPosition({ x: layer.x - 24, y: layer.y - 24 })
        : offsetPosition;
    const sourceEvents = shot.timelineEvents.filter((event) =>
      event.layerId === layer.id && (event.type !== 'mouth-pose' || !event.dialogueId ||
        (sameShot && destination.dialogues.some(({ id }) => id === event.dialogueId))));
    const { parentKeys: _parentKeys, animationTimeLink: _timeLink, ...layerBase } = layer;
    void _parentKeys;
    void _timeLink;
    const copySource: Layer = {
      ...layerBase,
      parentLayerId: keepParent ? layer.parentLayerId : undefined,
      parentAttachment: keepParent ? layer.parentAttachment : undefined,
      ...(copiedParentKeys?.length ? { parentKeys: copiedParentKeys } : {}),
      ...(sameShot &&
      layer.animationTimeLink &&
      resolveLayerAnimationTimeLink(destination, layer).status === 'active'
        ? { animationTimeLink: { ...layer.animationTimeLink } }
        : {}),
      parentSpaceOffset: copiedSpace,
      cameraSpace: detachedPose ? detachedPose.effectiveCameraSpace : layer.cameraSpace,
      depth: copiedDepth,
    };
    const { layer: duplicate, events: duplicatedEvents } = this.buildDuplicatedAnimationLayer(
      copySource, sourceEvents, usedIds, position, Math.max(-1, ...destination.layers.map(({ zIndex }) => zIndex)) + 1,
      suffixedLayerName(layer.name, ' 副本'),
    );
    const nextShot = {
      ...destination,
      layers: [...destination.layers, duplicate],
      timelineEvents: [...destination.timelineEvents, ...duplicatedEvents],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layer: duplicate,
    };
  }

  duplicateAnimationLayerGrid(
    project: Project,
    shotId: string,
    layerId: string,
    input: GridArrayInput,
  ): DuplicateGridArrayResult {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        '只能对 FLA 图形动画图层执行排兵布阵。',
      );
    }
    const animationId = layer.source.animationId;
    const definition = project.animations.find(
      (candidate) => candidate.id === animationId,
    );
    if (!definition || !isFlaGraphicDefinition(definition)) {
      throw new LayerServiceError(
        'FLA_GRAPHIC_REQUIRED',
        '排兵布阵仅支持 FLA 图形（Graphic）动画图层。',
      );
    }
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);

    const { rows, cols, spacingX, spacingY } = input;
    if (!Number.isSafeInteger(rows) || rows < 1 || !Number.isSafeInteger(cols) || cols < 1) {
      throw new LayerServiceError(
        'INVALID_GRID_ARRAY',
        '行数和列数必须是大于等于 1 的整数。',
      );
    }
    if (rows * cols > GRID_ARRAY_MAX_INSTANCES) {
      throw new LayerServiceError(
        'INVALID_GRID_ARRAY',
        `排兵布阵总数不能超过 ${GRID_ARRAY_MAX_INSTANCES} 个（含源图层）。`,
      );
    }
    if (cols > 1 && (!Number.isFinite(spacingX) || spacingX <= 0)) {
      throw new LayerServiceError(
        'INVALID_GRID_ARRAY',
        '多列布局时，横向间距必须是大于 0 的有限数字。',
      );
    }
    if (rows > 1 && (!Number.isFinite(spacingY) || spacingY <= 0)) {
      throw new LayerServiceError(
        'INVALID_GRID_ARRAY',
        '多行布局时，纵向间距必须是大于 0 的有限数字。',
      );
    }
    if (rows === 1 && cols === 1) {
      return { project, layers: [] };
    }

    const targets: { readonly row: number; readonly col: number; readonly position: Point }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (row === 0 && col === 0) continue;
        const x = layer.x + (col === 0 ? 0 : col * spacingX);
        const y = layer.y + (row === 0 ? 0 : row * spacingY);
        const clamped = clampLayerPosition({ x, y });
        if (clamped.x !== x || clamped.y !== y) {
          throw new LayerServiceError(
            'INVALID_POSITION',
            `阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整行列、间距或源位置。`,
          );
        }
        targets.push({ row, col, position: { x, y } });
      }
    }

    const usedIds = this.projectIds(project);
    const sourceEvents = shot.timelineEvents.filter(
      (event) => event.layerId === layer.id,
    );
    let nextZIndex = Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1;
    const createdLayers: Layer[] = [];
    const createdEvents: TimelineEvent[] = [];

    for (const target of targets) {
      const built = this.buildDuplicatedAnimationLayer(
        layer,
        sourceEvents,
        usedIds,
        target.position,
        nextZIndex,
        duplicateGridLayerName(layer.name, target.row, target.col),
      );
      nextZIndex += 1;
      createdLayers.push(built.layer);
      createdEvents.push(...built.events);
    }

    const nextShot = {
      ...shot,
      layers: [...shot.layers, ...createdLayers],
      timelineEvents: [...shot.timelineEvents, ...createdEvents],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layers: createdLayers,
    };
  }

  /**
   * Generate N static radial-array replicas evenly spaced around a full circle.
   * Reuses the safe duplication contract (Clip ownership, basis sync, Move translation,
   * overrides, events) without adding layout keyframes or moving/hiding the source.
   */
  duplicateAnimationLayerRadial(
    project: Project,
    shotId: string,
    layerId: string,
    input: RadialArrayInput,
  ): DuplicateStaticArrayResult {
    const { shot, layer } = this.assertFlaGraphicArraySource(
      project,
      shotId,
      layerId,
      '径向阵列',
    );
    const { count, center, radius, startAngleDeg, orientation } = input;
    if (
      !Number.isSafeInteger(count) ||
      count < STATIC_ARRAY_MIN_COUNT ||
      count > STATIC_ARRAY_MAX_COUNT
    ) {
      throw new LayerServiceError(
        'INVALID_RADIAL_ARRAY',
        `副本数量必须是 ${STATIC_ARRAY_MIN_COUNT}–${STATIC_ARRAY_MAX_COUNT} 之间的整数。`,
      );
    }
    const safeCenter = validateLayerPosition(center);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new LayerServiceError(
        'INVALID_RADIAL_ARRAY',
        '半径必须是大于 0 的有限数字。',
      );
    }
    if (!Number.isFinite(startAngleDeg)) {
      throw new LayerServiceError(
        'INVALID_RADIAL_ARRAY',
        '起始角度必须是有限数字。',
      );
    }
    if (orientation !== 'keep' && orientation !== 'align') {
      throw new LayerServiceError(
        'INVALID_RADIAL_ARRAY',
        '不支持的朝向模式。',
      );
    }

    const samples = sampleRadialArrayLayout({
      count,
      center: safeCenter,
      radius,
      startAngleDeg,
      orientation,
    });

    const targets: { readonly index: number; readonly position: Point; readonly rotationDeg: number }[] = [];
    for (const sample of samples) {
      const position = normalizeGeneratedStagePoint(sample.position);
      if (!position) {
        throw new LayerServiceError(
          'INVALID_POSITION',
          `径向阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整圆心、半径或数量。`,
        );
      }
      const targetRotationDeg =
        orientation === 'align'
          ? normalizeLayerRotation(layer.rotationDeg + sample.directionAngleDeg!)
          : layer.rotationDeg;
      targets.push({
        index: sample.index,
        position,
        rotationDeg: targetRotationDeg,
      });
    }

    return this.commitStaticArrayTargets(
      project,
      shot,
      layer,
      targets,
      (index) => `${layer.name} 径向 ${index + 1}`,
    );
  }

  /**
   * Generate N static replicas evenly spaced by arc length along a single cubic Bézier curve.
   * Reuses A02 arc-length sampling and the A00/A01 safe duplication contract.
   */
  duplicateAnimationLayerAlongPath(
    project: Project,
    shotId: string,
    layerId: string,
    input: PathArrayInput,
  ): DuplicateStaticArrayResult {
    const { shot, layer } = this.assertFlaGraphicArraySource(
      project,
      shotId,
      layerId,
      '沿路径阵列',
    );
    const { count, curve, orientation } = input;
    if (
      !Number.isSafeInteger(count) ||
      count < STATIC_ARRAY_MIN_COUNT ||
      count > STATIC_ARRAY_MAX_COUNT
    ) {
      throw new LayerServiceError(
        'INVALID_PATH_ARRAY',
        `副本数量必须是 ${STATIC_ARRAY_MIN_COUNT}–${STATIC_ARRAY_MAX_COUNT} 之间的整数。`,
      );
    }
    if (orientation !== 'keep' && orientation !== 'align') {
      throw new LayerServiceError(
        'INVALID_PATH_ARRAY',
        '不支持的朝向模式。',
      );
    }
    const safeCurve: CubicBezier2D = {
      p0: validateLayerPosition(curve.p0),
      p1: validateLayerPosition(curve.p1),
      p2: validateLayerPosition(curve.p2),
      p3: validateLayerPosition(curve.p3),
    };

    const sampled = samplePathArrayLayout({
      count,
      curve: safeCurve,
      orientation,
    });
    if (!sampled.ok) {
      if (sampled.reason === 'degenerate-tangent') {
        throw new LayerServiceError(
          'INVALID_PATH_ARRAY',
          '路径在部分采样点切线退化，无法沿路径切线对齐朝向；请调整控制点或改用“保持朝向”。',
        );
      }
      throw new LayerServiceError(
        'INVALID_PATH_ARRAY',
        '路径长度为 0（退化路径），请设置有效的起止点与控制点。',
      );
    }

    const targets: { readonly index: number; readonly position: Point; readonly rotationDeg: number }[] = [];
    for (const sample of sampled.samples) {
      const position = normalizeGeneratedStagePoint(sample.position);
      if (!position) {
        throw new LayerServiceError(
          'INVALID_POSITION',
          `沿路径阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整路径控制点或数量。`,
        );
      }
      const targetRotationDeg =
        orientation === 'align'
          ? normalizeLayerRotation(layer.rotationDeg + sample.directionAngleDeg!)
          : layer.rotationDeg;
      targets.push({
        index: sample.index,
        position,
        rotationDeg: targetRotationDeg,
      });
    }

    return this.commitStaticArrayTargets(
      project,
      shot,
      layer,
      targets,
      (index) => `${layer.name} 路径 ${index + 1}`,
    );
  }

  planBackgroundTiles(project: Project, shotId: string, layerId: string, input: BackgroundTileInput) {
    const { shot, layer } = this.assertFlaGraphicArraySource(project, shotId, layerId, '背景铺排');
    if (shot.layers.some((candidate) => candidate.id !== shot.backgroundLayerId && candidate.zIndex < layer.zIndex)) {
      throw new Error('请先将模板移到普通图层的最底部。');
    }
    if (
      layer.animationPlayback?.mode !== 'single-frame' ||
      layer.animationPlayback.endBehavior !== 'hold' ||
      layer.startTimeMs !== 0 ||
      normalizeLayerRotation(layer.rotationDeg) !== 0 ||
      !layer.visible ||
      layer.opacity !== 1 ||
      (layer.animationClip && (layer.animationClip.version !== 2 || layer.animationClip.tracks.length > 0)) ||
      shot.timelineEvents.some((event) => event.layerId === layerId)
    ) {
      throw new Error('请使用从第 0 帧开始、可见且不透明的单帧保持素材，清除外部动作并将旋转设为 0°。');
    }
    const dimensions = resolveBackgroundSourceDimensions(project, layer);
    if (!dimensions) throw new Error('无法读取模板画布，请选择有效的 Graphic 素材。');
    return planBackgroundTiles(
      dimensions.width * validateLayerScale(layer.scaleX),
      dimensions.height * validateLayerScale(layer.scaleY),
      shot.durationMs,
      input,
    );
  }

  generateBackgroundTiles(
    project: Project,
    shotId: string,
    layerId: string,
    input: BackgroundTileInput,
  ): DuplicateStaticArrayResult {
    const plan = this.planBackgroundTiles(project, shotId, layerId, input);
    const shot = this.shot(project, shotId);
    const source = shot.layers[this.layerIndex(shot, layerId)]!;
    const usedIds = this.projectIds(project);
    const basis = input.mode === 'loop' ? createLayerAnimationClip(project, shotId, layerId).targetBases[0]! : null;
    const createdLayers: Layer[] = [];
    const reverse = input.mode === 'loop' && (input.direction === 'right' || input.direction === 'down');

    for (let row = 0; row < plan.rows; row += 1) {
      for (let column = 0; column < plan.columns; column += 1) {
        const center = normalizeGeneratedStagePoint({
          x: plan.horizontal ? PROJECT_WIDTH / 2 : PROJECT_WIDTH / 2 + (column - (plan.columns - 1) / 2) * plan.width,
          y: plan.vertical ? PROJECT_HEIGHT / 2 : PROJECT_HEIGHT / 2 + (row - (plan.rows - 1) / 2) * plan.height,
        });
        if (!center) throw new Error('铺排坐标无效，请调整素材比例。');
        const { layer } = this.buildDuplicatedAnimationLayer(
          source,
          [],
          usedIds,
          center,
          0,
          suffixedLayerName(source.name, ` 铺排 ${createdLayers.length + 1}`),
        );
        if (input.mode === 'static' || !basis) {
          createdLayers.push(layer);
          continue;
        }
        const baseTransform = { ...center, scaleX: layer.scaleX, scaleY: layer.scaleY, rotationDeg: layer.rotationDeg };
        const pivot = layerPivotLocalOffset(basis.pivot, basis.sourceCanvas);
        const target = { kind: 'layer' as const, layerId: layer.id };
        const offsetX: AnimationKey[] = [];
        const offsetY: AnimationKey[] = [];
        for (let frame = 0; frame <= plan.lastFrame; frame += 1) {
          const sample = plan.horizontal
            ? sampleScrollingTile(column, plan.columns, plan.width, PROJECT_WIDTH, frame, input.periodFrames, reverse)
            : sampleScrollingTile(row, plan.rows, plan.height, PROJECT_HEIGHT, frame, input.periodFrames, reverse);
          const position = plan.horizontal ? { x: sample.center, y: center.y } : { x: center.x, y: sample.center };
          const solved = solveLayerRelativeOffsetForStagePoint(pivot, baseTransform, layer.flipX, 0, 1, 1, position);
          if (typeof solved.offsetX !== 'number' || typeof solved.offsetY !== 'number' ||
            !Number.isFinite(solved.offsetX) || !Number.isFinite(solved.offsetY)) {
            throw new Error('循环坐标无效，请调整素材比例。');
          }
          const timeMs = frameTimeMs(frame);
          const interpolationToNext = sample.recycleAfter && frame < plan.lastFrame ? 'step' : 'linear';
          offsetX.push({ timeMs, value: normalizeNegativeZero(solved.offsetX), interpolationToNext });
          offsetY.push({ timeMs, value: normalizeNegativeZero(solved.offsetY), interpolationToNext });
        }
        createdLayers.push({
          ...layer,
          animationClip: {
            version: 2,
            targetBases: [{ ...basis, target, baseTransform }],
            tracks: [
              { target, property: 'transform.offsetX', keys: offsetX },
              { target, property: 'transform.offsetY', keys: offsetY },
            ],
          },
        });
      }
    }
    const layers = [...shot.layers].sort((a, b) => a.zIndex - b.zIndex);
    layers.splice(layers.findIndex((layer) => layer.id === source.id) + 1, 0, ...createdLayers);
    const ordered = layers.map((layer, zIndex) => ({ ...layer, zIndex }));
    const first = ordered.findIndex((layer) => layer.id === createdLayers[0]!.id);
    return {
      project: this.replaceShot(project, { ...shot, layers: ordered }),
      layers: ordered.slice(first, first + createdLayers.length),
    };
  }

  generateOrbitFlight(project: Project, shotId: string, layerId: string, input: OrbitFlightInput): DuplicateStaticArrayResult {
    const { shot, layer } = this.assertFlaGraphicArraySource(project, shotId, layerId, '环绕飞行');
    const { count, referenceLayerIds, startFrame, durationFrames } = input;
    if (!Number.isInteger(count) || count < 1 || count > 8 ||
      !Number.isFinite(input.radiusX) || input.radiusX <= 0 ||
      !Number.isFinite(input.radiusY) || input.radiusY <= 0 ||
      !Number.isFinite(input.startAngleDeg) ||
      !['clockwise', 'counterclockwise'].includes(input.direction) ||
      !['keep', 'tangent'].includes(input.orientation)) {
      throw new Error('请检查飞行数量、椭圆半径、起始角和朝向。');
    }
    const lastFrame = validateBakeFrames(shot, startFrame, durationFrames, 0, count, 4);
    const context = this.prepareGraphicBake(project, shot, layer, startFrame);
    const referenceIds = new Set(referenceLayerIds);
    const referenceLayers = shot.layers.filter((entry) => referenceIds.has(entry.id)).sort((a, b) => a.zIndex - b.zIndex);
    if (referenceIds.size < 1 || referenceIds.size > 2 || referenceIds.size !== referenceLayerIds.length ||
      referenceLayers.length !== referenceIds.size || referenceLayers.some((entry) =>
        entry.id === layerId || entry.id === shot.backgroundLayerId ||
        !context.evaluated.layers.find((evaluated) => evaluated.id === entry.id)?.visible,
      )) {
      throw new Error('请选择一到两个在起帧可见、与模板不同的普通参考图层。');
    }
    const reference = context.evaluated.layers.find((entry) => entry.id === referenceLayerIds[0])!;
    const center = input.center ?? { x: reference.x, y: reference.y };
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error('请设置有效的环绕中心。');
    const bands: Layer[][] = Array.from({ length: referenceLayers.length + 1 }, () => []);
    const events: TimelineEvent[] = [];
    const labels = bands.length === 2 ? ['后', '前'] : ['后', '中', '前'];
    for (let index = 0; index < count; index += 1) {
      const samples = sampleOrbitFlight(input, center, index);
      bands.forEach((layers, band) => {
        let visible = false;
        const visibility: BakedGraphicEvent[] = [];
        for (const sample of samples) {
          const nextVisible = sample.band === band;
          if (nextVisible !== visible) visibility.push(bakedVisibility(sample.frame, nextVisible));
          visible = nextVisible;
        }
        const hideFrame = startFrame + durationFrames + 1;
        if (visible && hideFrame <= lastFrame) visibility.push(bakedVisibility(hideFrame, false));
        const baked = this.buildBakedGraphic(
          context,
          suffixedLayerName(layer.name, ` 环绕 ${index + 1} · ${labels[band]}`),
          samples,
          visibility,
        );
        layers.push(baked.layer);
        events.push(...baked.events);
      });
    }
    const layers = [...shot.layers].sort((a, b) => a.zIndex - b.zIndex).flatMap((entry) => {
      if (entry.id === referenceLayers[0]!.id) return [...bands[0]!, entry, ...bands[1]!];
      if (entry.id === referenceLayers[1]?.id) return [entry, ...bands[2]!];
      return [entry];
    });
    return this.commitGraphicBake(project, shot, layers, bands.flat(), events);
  }

  generateConvergingFlight(project: Project, shotId: string, layerId: string, input: ConvergingFlightInput): DuplicateStaticArrayResult {
    const { shot, layer } = this.assertFlaGraphicArraySource(project, shotId, layerId, '万剑归宗');
    const { count, startFrame, durationFrames, staggerFrames, radius, startAngleDeg, seed } = input;
    if (!Number.isInteger(count) || count < 1 || count > 32 ||
      !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(startAngleDeg) ||
      !Number.isFinite(input.bend) || input.bend < 0 ||
      !Number.isInteger(seed) || seed < 0 || seed > RADIAL_BURST_MAX_SEED ||
      !['keep', 'tangent'].includes(input.orientation) || typeof input.hideAfterArrival !== 'boolean') {
      throw new Error('请检查数量、半径、起始角、弯曲幅度、种子及朝向。');
    }
    const lastFrame = validateBakeFrames(shot, startFrame, durationFrames, staggerFrames, count);
    const context = this.prepareGraphicBake(project, shot, layer, startFrame);
    const target = validateLayerPosition(input.target ?? { x: context.pose.x, y: context.pose.y });
    const distribution = sampleRadialBurstInstances({
      count, center: target, radius, startAngleDeg, seed, maxRotationDeg: 0,
    });
    const created: Layer[] = [];
    const events: TimelineEvent[] = [];
    for (const sample of distribution) {
      const launchFrame = startFrame + sample.index * staggerFrames;
      const samples = sampleConvergingFlight(input, target, sample.endPoint, sample.w, launchFrame);
      const visibility = [bakedVisibility(launchFrame, true)];
      const hideFrame = launchFrame + durationFrames + 1;
      if (input.hideAfterArrival && hideFrame <= lastFrame) visibility.push(bakedVisibility(hideFrame, false));
      const baked = this.buildBakedGraphic(
        context,
        suffixedLayerName(layer.name, ` 汇聚 ${sample.index + 1}`),
        samples,
        visibility,
      );
      created.push(baked.layer);
      events.push(...baked.events);
    }
    const layers = [...shot.layers].sort((a, b) => a.zIndex - b.zIndex);
    return this.commitGraphicBake(project, shot, [...layers, ...created], created, events);
  }

  generateDiffusionGhosts(project: Project, shotId: string, layerId: string, input: DiffusionGhostInput): DuplicateStaticArrayResult {
    const { shot, layer } = this.assertFlaGraphicArraySource(project, shotId, layerId, '扩散虚影');
    const { count, startFrame, durationFrames, staggerFrames, maxScale, decay } = input;
    if (!Number.isInteger(count) || count < 3 || count > 8 ||
      !Number.isFinite(maxScale) || maxScale <= 1 ||
      !Number.isFinite(decay) || decay <= 0 || decay > 1) {
      throw new Error('请使用 3–8 个虚影、大于 1 的放大倍数及 0 到 1 之间的非零衰减系数。');
    }
    validateBakeFrames(shot, startFrame, durationFrames, staggerFrames, count);
    const context = this.prepareGraphicBake(project, shot, layer, startFrame);
    validateLayerScale(context.pose.scaleX * maxScale);
    validateLayerScale(context.pose.scaleY * maxScale);
    const position = { x: context.pose.x, y: context.pose.y };
    const created: Layer[] = [];
    const events: TimelineEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      const launch = startFrame + index * staggerFrames;
      const end = launch + durationFrames;
      const alpha = context.pose.opacity * decay ** (index + 1);
      if (alpha <= 0) throw new Error('虚影透明度过低，请增大衰减系数。');
      const samples = Array.from({ length: durationFrames + 1 }, (_, step) => ({
        frame: launch + step,
        position,
        scaleMultiplier: step === durationFrames ? maxScale : 1 + (maxScale - 1) * step / durationFrames,
      }));
      const visibilityAndFade = [bakedVisibility(launch, true)];
      // Persisted frame intervals alternate between 41 and 42 ms. Per-frame
      // segments keep the fade tied to frame progress and continuous between keys.
      for (let step = 0; step < durationFrames; step += 1) {
        visibilityAndFade.push({
          type: 'opacity',
          startMs: frameTimeMs(launch + step),
          endMs: frameTimeMs(launch + step + 1),
          from: alpha * (1 - step / durationFrames),
          to: alpha * (1 - (step + 1) / durationFrames),
          easing: 'linear',
        });
      }
      visibilityAndFade.push(bakedVisibility(end, false));
      const baked = this.buildBakedGraphic(
        context,
        suffixedLayerName(layer.name, ` 虚影 ${index + 1}`),
        samples,
        visibilityAndFade,
      );
      created.push(baked.layer);
      events.push(...baked.events);
    }
    const layers = [...shot.layers].sort((a, b) => a.zIndex - b.zIndex);
    layers.splice(layers.findIndex((entry) => entry.id === layerId), 0, ...[...created].reverse());
    return this.commitGraphicBake(project, shot, layers, created, events);
  }

  private prepareGraphicBake(project: Project, shot: Shot, source: Layer, startFrame: number) {
    const evaluated = evaluateShotAtTime(shot, frameTimeMs(startFrame), project);
    const pose = evaluated.layers.find((entry) => entry.id === source.id);
    if (!pose?.visible || pose.opacity <= 0) throw new Error('模板在起帧不可见，请选择可见的模板或调整起帧。');
    const basis = createLayerAnimationClip(project, shot.id, source.id).targetBases[0]!;
    const baseTransform: LayerBasePose = {
      ...clampLayerPosition({ x: pose.x, y: pose.y }),
      rotationDeg: normalizeLayerRotation(pose.rotationDeg),
      scaleX: validateLayerScale(pose.scaleX),
      scaleY: validateLayerScale(pose.scaleY),
    };
    return {
      evaluated, source, pose, basis, baseTransform,
      usedIds: this.projectIds(project),
      internalEvents: shot.timelineEvents.filter((event) => event.layerId === source.id &&
        (event.type === 'graphic-frame' || event.type === 'graphic-playback')),
    };
  }

  private buildBakedGraphic(
    context: ReturnType<LayerService['prepareGraphicBake']>,
    name: string,
    samples: readonly BakedGraphicSample[],
    events: readonly BakedGraphicEvent[],
  ) {
    const { source, usedIds, basis, baseTransform, pose } = context;
    const duplicate = this.buildDuplicatedAnimationLayer(source, context.internalEvents, usedIds, baseTransform, 0, name);
    const target = { kind: 'layer' as const, layerId: duplicate.layer.id };
    const pivot = layerPivotLocalOffset(basis.pivot, basis.sourceCanvas);
    const first = samples[0]!;
    const trackSamples = first.frame === 0 ? samples : [{ ...first, frame: 0 }, ...samples];
    const offsetX: AnimationKey[] = [];
    const offsetY: AnimationKey[] = [];
    const rotation: AnimationKey[] = [];
    const scale: AnimationKey[] = [];
    for (const sample of trackSamples) {
      const rotationDeg = sample.rotationDeg ?? 0;
      const multiplier = sample.scaleMultiplier ?? 1;
      if (sample.scaleMultiplier !== undefined) {
        validateLayerScale(baseTransform.scaleX * multiplier);
        validateLayerScale(baseTransform.scaleY * multiplier);
      }
      const solved = solveLayerRelativeOffsetForStagePoint(
        pivot, baseTransform, pose.flipX, rotationDeg, multiplier, multiplier, sample.position,
      );
      if (typeof solved.offsetX !== 'number' || typeof solved.offsetY !== 'number' ||
        ![solved.offsetX, solved.offsetY, rotationDeg].every(Number.isFinite)) {
        throw new Error('轨迹计算超出有效范围，请调整位置、半径或朝向。');
      }
      const key = { timeMs: frameTimeMs(sample.frame), interpolationToNext: 'linear' as const };
      offsetX.push({ ...key, value: normalizeNegativeZero(solved.offsetX) });
      offsetY.push({ ...key, value: normalizeNegativeZero(solved.offsetY) });
      if (sample.rotationDeg !== undefined) rotation.push({ ...key, value: normalizeNegativeZero(rotationDeg) });
      if (sample.scaleMultiplier !== undefined) scale.push({ ...key, value: multiplier });
    }
    const tracks: LayerAnimationClip['tracks'] = [
      { target, property: 'transform.offsetX', keys: offsetX },
      { target, property: 'transform.offsetY', keys: offsetY },
    ];
    if (rotation.length) tracks.push({ target, property: 'transform.rotationDeg', keys: rotation });
    if (scale.length) {
      tracks.push({ target, property: 'transform.scaleX', keys: scale });
      tracks.push({ target, property: 'transform.scaleY', keys: scale });
    }
    const layer: Layer = {
      ...duplicate.layer, ...baseTransform, flipX: pose.flipX, opacity: pose.opacity, visible: false,
      animationClip: { version: 2, targetBases: [{ ...basis, target, baseTransform }], tracks },
    };
    const addedEvents = events.map((event): TimelineEvent => {
      const id = this.nextUniqueId(usedIds);
      usedIds.add(id);
      return { ...event, id, layerId: layer.id };
    });
    return { layer, events: [...duplicate.events, ...addedEvents] };
  }

  private commitGraphicBake(
    project: Project, shot: Shot, layers: readonly Layer[], created: readonly Layer[], events: readonly TimelineEvent[],
  ): DuplicateStaticArrayResult {
    const ordered = layers.map((layer, zIndex) => ({ ...layer, zIndex }));
    const byId = new Map(ordered.map((layer) => [layer.id, layer]));
    return {
      project: this.replaceShot(project, { ...shot, layers: ordered, timelineEvents: [...shot.timelineEvents, ...events] }),
      layers: created.map((layer) => byId.get(layer.id)!),
    };
  }

  private assertFlaGraphicArraySource(
    project: Project,
    shotId: string,
    layerId: string,
    featureLabel: string,
  ): { readonly shot: Shot; readonly layer: Layer } {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        `只能对 FLA 图形动画图层执行${featureLabel}。`,
      );
    }
    const animationId = layer.source.animationId;
    const definition = project.animations.find(
      (candidate) => candidate.id === animationId,
    );
    if (!definition || !isFlaGraphicDefinition(definition)) {
      throw new LayerServiceError(
        'FLA_GRAPHIC_REQUIRED',
        `${featureLabel}仅支持 FLA 图形（Graphic）动画图层。`,
      );
    }
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    return { shot, layer };
  }

  private commitStaticArrayTargets(
    project: Project,
    shot: Shot,
    layer: Layer,
    targets: readonly { readonly index: number; readonly position: Point; readonly rotationDeg: number }[],
    formatName: (index: number) => string,
  ): DuplicateStaticArrayResult {
    const usedIds = this.projectIds(project);
    const sourceEvents = shot.timelineEvents.filter(
      (event) => event.layerId === layer.id,
    );
    let nextZIndex = Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1;
    const createdLayers: Layer[] = [];
    const createdEvents: TimelineEvent[] = [];

    for (const target of targets) {
      const built = this.buildDuplicatedAnimationLayer(
        layer,
        sourceEvents,
        usedIds,
        target.position,
        nextZIndex,
        formatName(target.index),
        target.rotationDeg,
      );
      nextZIndex += 1;
      createdLayers.push(built.layer);
      createdEvents.push(...built.events);
    }

    const nextShot = {
      ...shot,
      layers: [...shot.layers, ...createdLayers],
      timelineEvents: [...shot.timelineEvents, ...createdEvents],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layers: createdLayers,
    };
  }

  /**
   * Generate N native editable position-afterimage replicas directly beneath the
   * source FLA Graphic layer. Each replica i (1..N) samples the source's evaluated
   * stage anchor, opacity, and visibility at historical frame h = f - i * Δ.
   */
  generateAfterimages(
    project: Project,
    shotId: string,
    layerId: string,
    input: AfterimageInput,
  ): GenerateAfterimagesResult {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        '只能对 FLA 图形动画图层生成残影。',
      );
    }
    const animationId = layer.source.animationId;
    const definition = project.animations.find(
      (candidate) => candidate.id === animationId,
    );
    if (!definition || !isFlaGraphicDefinition(definition)) {
      throw new LayerServiceError(
        'FLA_GRAPHIC_REQUIRED',
        '位置残影仅支持 FLA 图形（Graphic）动画图层。',
      );
    }
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);

    const { count, delayFrames, decay, startFrame, endFrame } = input;
    if (
      !Number.isSafeInteger(count) ||
      count < AFTERIMAGE_MIN_COUNT ||
      count > AFTERIMAGE_MAX_COUNT
    ) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        `残影数量必须是 ${AFTERIMAGE_MIN_COUNT}–${AFTERIMAGE_MAX_COUNT} 之间的整数。`,
      );
    }
    if (!Number.isSafeInteger(delayFrames) || delayFrames < 1) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        '时间间隔必须是大于等于 1 的整数帧。',
      );
    }
    if (!Number.isFinite(decay) || decay <= 0 || decay >= 1) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        '透明度衰减系数必须是 0 到 1 之间（不含端点）的有限数字。',
      );
    }
    if (
      !Number.isSafeInteger(startFrame) ||
      !Number.isSafeInteger(endFrame) ||
      startFrame < 0 ||
      endFrame <= startFrame
    ) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        '起止帧必须是非负整数，且止帧必须晚于起帧。',
      );
    }
    const maxValidMs = lastValidFrameTime(shot.durationMs);
    const startTimeMs = frameTimeMs(startFrame);
    const endTimeMs = frameTimeMs(endFrame);
    if (
      !isValidFrameTime(startTimeMs) ||
      !isValidFrameTime(endTimeMs) ||
      endTimeMs > maxValidMs ||
      endTimeMs > shot.durationMs
    ) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        '起止帧必须位于当前镜头的合法帧范围内。',
      );
    }
    if (endFrame - startFrame < count * delayFrames) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        `时段长度不足：${count} 个残影 × ${delayFrames} 帧间隔至少需要 ${count * delayFrames} 帧。`,
      );
    }

    // Sample source layer history once across [startFrame..endFrame] from the original snapshot.
    const sourceSamples: {
      readonly frame: number;
      readonly timeMs: number;
      readonly x: number;
      readonly y: number;
      readonly opacity: number;
      readonly visible: boolean;
    }[] = [];
    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      const timeMs = frameTimeMs(frame);
      const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
        (candidate) => candidate.id === layer.id,
      );
      if (!evaluated) {
        throw new LayerServiceError('LAYER_NOT_FOUND', `找不到图层：${layer.id}`);
      }
      sourceSamples.push({
        frame,
        timeMs,
        x: evaluated.x,
        y: evaluated.y,
        opacity: evaluated.opacity,
        visible: evaluated.visible,
      });
    }

    const originSample = sourceSamples[0]!;
    const maxDisplacement = sourceSamples.reduce(
      (maxDist, sample) =>
        Math.max(maxDist, Math.hypot(sample.x - originSample.x, sample.y - originSample.y)),
      0,
    );
    if (maxDisplacement <= 1e-3) {
      throw new LayerServiceError(
        'INVALID_AFTERIMAGE',
        '所选时段内源图层没有有效位移，无法生成位置残影。',
      );
    }

    const usedIds = this.projectIds(project);
    const preservedSourceEvents = shot.timelineEvents.filter(
      (event) =>
        event.layerId === layer.id &&
        event.type !== 'move' &&
        event.type !== 'shake' &&
        event.type !== 'opacity' &&
        event.type !== 'visibility',
    );
    const baseClipTemplate: LayerAnimationClip =
      layer.animationClip?.version === 2
        ? structuredClone(layer.animationClip)
        : createLayerAnimationClip(project, shot.id, layer.id);
    const nonPositionTracks = baseClipTemplate.tracks.filter(
      (track) =>
        track.property !== 'transform.offsetX' &&
        track.property !== 'transform.offsetY',
    );
    const basisTemplate = baseClipTemplate.targetBases[0]!;
    const localPivot = layerPivotLocalOffset(
      basisTemplate.pivot,
      basisTemplate.sourceCanvas,
    );

    const nextFrameAfterEndMs = frameTimeMs(endFrame + 1);
    const hideAfterEndMs =
      nextFrameAfterEndMs <= maxValidMs && nextFrameAfterEndMs <= shot.durationMs
        ? nextFrameAfterEndMs
        : null;

    // Build replicas ordered farthest (i = count) to closest (i = 1) so zIndex rises toward the source layer.
    const createdLayers: Layer[] = [];
    const createdEvents: TimelineEvent[] = [];

    for (let i = count; i >= 1; i -= 1) {
      const replicaId = this.nextUniqueId(usedIds);
      usedIds.add(replicaId);

      const remappedClip = duplicateLayerAnimationClip(
        {
          ...baseClipTemplate,
          tracks: nonPositionTracks,
        },
        replicaId,
        {
          x: layer.x,
          y: layer.y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          rotationDeg: layer.rotationDeg,
        },
      );

      // Copy preserved non-position/non-opacity/non-visibility events with stable localeCompare ID ordering.
      const replicaPreservedEvents = this.cloneEventsPreservingOrder(
        preservedSourceEvents,
        replicaId,
        usedIds,
      );

      const firstActiveFrame = startFrame + i * delayFrames;
      const decayFactor = Math.pow(decay, i);

      // Compute target alphas & visibility over [firstActiveFrame..endFrame].
      const activeSamples: {
        readonly frame: number;
        readonly timeMs: number;
        readonly x: number;
        readonly y: number;
        readonly alpha: number;
        readonly visible: boolean;
      }[] = [];
      for (let frame = firstActiveFrame; frame <= endFrame; frame += 1) {
        const hist = sourceSamples[frame - i * delayFrames - startFrame]!;
        const alpha = clampAlpha01(hist.opacity * decayFactor);
        activeSamples.push({
          frame,
          timeMs: frameTimeMs(frame),
          x: hist.x,
          y: hist.y,
          alpha,
          visible: hist.visible && alpha > 1e-6,
        });
      }

      const initialAlpha = activeSamples[0]!.alpha;
      const alphaDynamic = activeSamples.some(
        (sample) => Math.abs(sample.alpha - initialAlpha) > 1e-6,
      );

      const replicaBaseLayer: Layer = {
        ...layer,
        ...(layer.flaGraphicInstanceTransformOverrides
          ? {
              flaGraphicInstanceTransformOverrides:
                cloneFlaGraphicInstanceTransformOverrides(
                  layer.flaGraphicInstanceTransformOverrides,
                ),
            }
          : {}),
        ...(layer.flaGraphicInstanceShapeOverrides
          ? {
              flaGraphicInstanceShapeOverrides: cloneFlaGraphicShapeOverrides(
                layer.flaGraphicInstanceShapeOverrides,
              ),
            }
          : {}),
        id: replicaId,
        name: afterimageLayerName(layer.name, i),
        opacity: initialAlpha,
        visible: false,
        locked: false,
        animationClip: remappedClip,
      };

      // Back-solve relative offsetX/Y for each active frame against the replica's own pre-track + non-position tracks.
      const offsetXKeys: AnimationKey[] = [];
      const offsetYKeys: AnimationKey[] = [];
      if (activeSamples[0]!.timeMs > 0) {
        offsetXKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
        offsetYKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
      }
      for (const sample of activeSamples) {
        const preTrack = evaluateLayerPreTrackState(
          shot,
          replicaBaseLayer,
          sample.timeMs,
          project,
          replicaPreservedEvents,
        );
        const currentRel = evaluateLayerRelativeMotionValues(
          remappedClip,
          replicaId,
          sample.timeMs,
        );
        const prePose: LayerBasePose = {
          x: preTrack.motion.displayPosition.x,
          y: preTrack.motion.displayPosition.y,
          scaleX: preTrack.scaleX,
          scaleY: preTrack.scaleY,
          rotationDeg: preTrack.rotationDeg,
        };
        const solved = solveLayerRelativeOffsetForStagePoint(
          localPivot,
          prePose,
          preTrack.flipX,
          currentRel['transform.rotationDeg'],
          currentRel['transform.scaleX'],
          currentRel['transform.scaleY'],
          { x: sample.x, y: sample.y },
        );
        offsetXKeys.push({
          timeMs: sample.timeMs,
          value: solved.offsetX!,
          interpolationToNext: 'linear',
        });
        offsetYKeys.push({
          timeMs: sample.timeMs,
          value: solved.offsetY!,
          interpolationToNext: 'linear',
        });
      }

      const target = { kind: 'layer' as const, layerId: replicaId };
      const finalClip: LayerAnimationClip = {
        ...remappedClip,
        tracks: [
          ...remappedClip.tracks,
          { target, property: 'transform.offsetX', keys: offsetXKeys },
          { target, property: 'transform.offsetY', keys: offsetYKeys },
        ],
      };

      // Emit visibility gating events (initially hidden; show/hide on exact state transitions).
      const gatingEvents: TimelineEvent[] = [];
      let currentlyVisible = false;
      for (const sample of activeSamples) {
        if (sample.visible !== currentlyVisible) {
          const eventId = this.nextUniqueId(usedIds);
          usedIds.add(eventId);
          gatingEvents.push({
            id: eventId,
            type: 'visibility',
            layerId: replicaId,
            startMs: sample.timeMs,
            endMs: sample.timeMs,
            visible: sample.visible,
          });
          currentlyVisible = sample.visible;
        }
      }
      if (currentlyVisible && hideAfterEndMs !== null) {
        const hideId = this.nextUniqueId(usedIds);
        usedIds.add(hideId);
        gatingEvents.push({
          id: hideId,
          type: 'visibility',
          layerId: replicaId,
          startMs: hideAfterEndMs,
          endMs: hideAfterEndMs,
          visible: false,
        });
      }

      // Emit dynamic opacity events when source history opacity varies (merging constant runs).
      const opacityEvents: TimelineEvent[] = [];
      if (alphaDynamic) {
        let segStart = 0;
        while (segStart < activeSamples.length - 1) {
          const fromSample = activeSamples[segStart]!;
          const nextSample = activeSamples[segStart + 1]!;
          if (Math.abs(nextSample.alpha - fromSample.alpha) <= 1e-6) {
            let runEnd = segStart + 1;
            while (
              runEnd + 1 < activeSamples.length &&
              Math.abs(activeSamples[runEnd + 1]!.alpha - fromSample.alpha) <= 1e-6
            ) {
              runEnd += 1;
            }
            segStart = runEnd;
            continue;
          }
          const eventId = this.nextUniqueId(usedIds);
          usedIds.add(eventId);
          opacityEvents.push({
            id: eventId,
            type: 'opacity',
            layerId: replicaId,
            startMs: fromSample.timeMs,
            endMs: nextSample.timeMs,
            from: fromSample.alpha,
            to: nextSample.alpha,
            easing: 'linear',
          });
          segStart += 1;
        }
      }

      createdLayers.push({
        ...replicaBaseLayer,
        animationClip: finalClip,
      });
      createdEvents.push(...replicaPreservedEvents, ...gatingEvents, ...opacityEvents);
    }

    // Insert replicas directly beneath the source layer while preserving all other layers' relative order.
    const orderedContent = shot.layers
      .filter((candidate) => candidate.id !== shot.backgroundLayerId)
      .sort((left, right) => left.zIndex - right.zIndex);
    const sourceOrderIndex = orderedContent.findIndex(
      (candidate) => candidate.id === layer.id,
    );
    const nextOrderedContent = [
      ...orderedContent.slice(0, sourceOrderIndex),
      ...createdLayers,
      ...orderedContent.slice(sourceOrderIndex),
    ];
    const normalizedLayers = this.normalizeLayerOrder(shot, nextOrderedContent);
    const createdById = new Map(
      normalizedLayers.map((candidate) => [candidate.id, candidate] as const),
    );
    const normalizedCreatedLayers = createdLayers.map(
      (candidate) => createdById.get(candidate.id)!,
    );

    const nextShot = {
      ...shot,
      layers: normalizedLayers,
      timelineEvents: [...shot.timelineEvents, ...createdEvents],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layers: normalizedCreatedLayers,
    };
  }

  /**
   * Generate N deterministic radial-burst replicas from one source FLA Graphic
   * layer with staggered launch frames, ease-out straight radial trajectories,
   * pivot-compensated rotation, and optional fade-out.
   */
  generateRadialBurst(
    project: Project,
    shotId: string,
    layerId: string,
    input: RadialBurstInput,
  ): GenerateRadialBurstResult {
    const shot = this.shot(project, shotId);
    const layer = shot.layers[this.layerIndex(shot, layerId)]!;
    if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
      throw new LayerServiceError(
        'ANIMATION_LAYER_REQUIRED',
        '只能对 FLA 图形动画图层生成径向爆炸。',
      );
    }
    const animationId = layer.source.animationId;
    const definition = project.animations.find(
      (candidate) => candidate.id === animationId,
    );
    if (!definition || !isFlaGraphicDefinition(definition)) {
      throw new LayerServiceError(
        'FLA_GRAPHIC_REQUIRED',
        '径向爆炸仅支持 FLA 图形（Graphic）动画图层。',
      );
    }
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);

    const {
      count,
      center,
      radius,
      startAngleDeg,
      maxRotationDeg,
      startFrame,
      durationFrames,
      staggerFrames,
      seed,
      fadeOut,
    } = input;

    if (
      !Number.isSafeInteger(count) ||
      count < RADIAL_BURST_MIN_COUNT ||
      count > RADIAL_BURST_MAX_COUNT
    ) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        `副本数量必须是 ${RADIAL_BURST_MIN_COUNT}–${RADIAL_BURST_MAX_COUNT} 之间的整数。`,
      );
    }
    const safeCenter = validateLayerPosition(center);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '爆炸半径必须是大于 0 的有限数字。',
      );
    }
    if (!Number.isFinite(startAngleDeg)) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '起始角度必须是有限数字。',
      );
    }
    if (!Number.isFinite(maxRotationDeg) || maxRotationDeg < 0) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '最大旋转幅度必须是大于等于 0 的有限数字。',
      );
    }
    if (!Number.isSafeInteger(startFrame) || startFrame < 0) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '起帧必须是非负整数。',
      );
    }
    if (!Number.isSafeInteger(durationFrames) || durationFrames < 1) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '持续帧数必须是大于等于 1 的整数。',
      );
    }
    if (!Number.isSafeInteger(staggerFrames) || staggerFrames < 0) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '逐实例延迟必须是非负整数帧。',
      );
    }
    if (
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > RADIAL_BURST_MAX_SEED
    ) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        `随机种子必须是 0–${RADIAL_BURST_MAX_SEED} 之间的整数。`,
      );
    }

    const maxValidMs = lastValidFrameTime(shot.durationMs);
    const startTimeMs = frameTimeMs(startFrame);
    const lastEndFrame = startFrame + (count - 1) * staggerFrames + durationFrames;
    const lastEndTimeMs = frameTimeMs(lastEndFrame);
    if (
      !isValidFrameTime(startTimeMs) ||
      !isValidFrameTime(lastEndTimeMs) ||
      startTimeMs > maxValidMs ||
      lastEndTimeMs > maxValidMs ||
      lastEndTimeMs > shot.durationMs
    ) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '最晚结束帧超出当前镜头合法帧范围，请缩短持续帧数、延迟、数量或提前起帧。',
      );
    }

    const evaluatedAtStart = evaluateShotAtTime(shot, startTimeMs, project).layers.find(
      (candidate) => candidate.id === layer.id,
    );
    if (!evaluatedAtStart) {
      throw new LayerServiceError('LAYER_NOT_FOUND', `找不到图层：${layer.id}`);
    }
    if (!evaluatedAtStart.visible || evaluatedAtStart.opacity <= 1e-6) {
      throw new LayerServiceError(
        'INVALID_RADIAL_BURST',
        '源图层在起帧不可见或完全透明，无法生成径向爆炸。',
      );
    }
    const initScaleX = validateLayerScale(evaluatedAtStart.scaleX);
    const initScaleY = validateLayerScale(evaluatedAtStart.scaleY);
    const initRotationDeg = normalizeLayerRotation(evaluatedAtStart.rotationDeg);
    const initFlipX = evaluatedAtStart.flipX;
    const initOpacity = clampAlpha01(evaluatedAtStart.opacity);

    const sourceCanvas =
      layer.animationClip?.version === 2
        ? { ...layer.animationClip.targetBases[0]!.sourceCanvas }
        : {
            width: definition.source.canvas.width,
            height: definition.source.canvas.height,
          };
    const pivot =
      layer.animationClip?.version === 2
        ? { ...layer.animationClip.targetBases[0]!.pivot }
        : {
            space: 'target-local' as const,
            x: sourceCanvas.width / 2,
            y: sourceCanvas.height / 2,
          };
    const localPivot = layerPivotLocalOffset(pivot, sourceCanvas);
    const basePose: LayerBasePose = {
      x: safeCenter.x,
      y: safeCenter.y,
      scaleX: initScaleX,
      scaleY: initScaleY,
      rotationDeg: initRotationDeg,
    };

    const samples = sampleRadialBurstInstances({
      count,
      center: safeCenter,
      radius,
      startAngleDeg,
      maxRotationDeg,
      seed,
    });

    const usedIds = this.projectIds(project);
    const internalGraphicEvents = shot.timelineEvents.filter(
      (event) =>
        event.layerId === layer.id &&
        (event.type === 'graphic-frame' || event.type === 'graphic-playback'),
    );
    let nextZIndex = Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1;

    const createdLayers: Layer[] = [];
    const createdEvents: TimelineEvent[] = [];

    for (const sample of samples) {
      if (
        !Number.isFinite(sample.angleDeg) ||
        !Number.isFinite(sample.distance) ||
        !Number.isFinite(sample.rotationDeltaDeg) ||
        !Number.isFinite(sample.endPoint.x) ||
        !Number.isFinite(sample.endPoint.y)
      ) {
        throw new LayerServiceError(
          'INVALID_RADIAL_BURST',
          '径向爆炸参数导致无效或超出范围的数值结果，请调整半径、角度或旋转幅度。',
        );
      }
      const replicaId = this.nextUniqueId(usedIds);
      usedIds.add(replicaId);

      const launchFrame = startFrame + sample.index * staggerFrames;
      const endFrame = launchFrame + durationFrames;
      const launchMs = frameTimeMs(launchFrame);
      const endMs = frameTimeMs(endFrame);

      const offsetXKeys: AnimationKey[] = [];
      const offsetYKeys: AnimationKey[] = [];
      const rotationKeys: AnimationKey[] = [];
      const hasRotation = sample.rotationDeltaDeg !== 0;

      if (launchMs > 0) {
        offsetXKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
        offsetYKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
        if (hasRotation) {
          rotationKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
        }
      }

      for (let step = 0; step <= durationFrames; step += 1) {
        const timeMs = frameTimeMs(launchFrame + step);
        const progress = evaluateAnimationEase(step / durationFrames, 'ease-out');
        const stageX = safeCenter.x + (sample.endPoint.x - safeCenter.x) * progress;
        const stageY = safeCenter.y + (sample.endPoint.y - safeCenter.y) * progress;
        const rawRelRotDeg = sample.rotationDeltaDeg * progress;
        if (
          !Number.isFinite(stageX) ||
          !Number.isFinite(stageY) ||
          !Number.isFinite(rawRelRotDeg)
        ) {
          throw new LayerServiceError(
            'INVALID_RADIAL_BURST',
            '径向爆炸轨迹计算出现非有限数值，请调整半径、角度或旋转幅度。',
          );
        }
        const relRotDeg = normalizeNegativeZero(rawRelRotDeg);
        const solved = solveLayerRelativeOffsetForStagePoint(
          localPivot,
          basePose,
          initFlipX,
          relRotDeg,
          1,
          1,
          { x: stageX, y: stageY },
        );
        if (
          typeof solved.offsetX !== 'number' ||
          typeof solved.offsetY !== 'number' ||
          !Number.isFinite(solved.offsetX) ||
          !Number.isFinite(solved.offsetY)
        ) {
          throw new LayerServiceError(
            'INVALID_RADIAL_BURST',
            '径向爆炸偏移反解出现非有限数值，请调整参数后重试。',
          );
        }
        offsetXKeys.push({
          timeMs,
          value: normalizeNegativeZero(solved.offsetX),
          interpolationToNext: 'linear',
        });
        offsetYKeys.push({
          timeMs,
          value: normalizeNegativeZero(solved.offsetY),
          interpolationToNext: 'linear',
        });
        if (hasRotation) {
          rotationKeys.push({
            timeMs,
            value: relRotDeg,
            interpolationToNext: 'linear',
          });
        }
      }

      const target = { kind: 'layer' as const, layerId: replicaId };
      const tracks: LayerAnimationClip['tracks'] = [
        { target, property: 'transform.offsetX', keys: offsetXKeys },
        { target, property: 'transform.offsetY', keys: offsetYKeys },
        ...(hasRotation
          ? [{ target, property: 'transform.rotationDeg' as const, keys: rotationKeys }]
          : []),
      ];
      const clip: LayerAnimationClip = {
        version: 2,
        targetBases: [
          {
            target,
            animationId,
            baseTransform: { ...basePose },
            sourceCanvas: { ...sourceCanvas },
            pivot: { ...pivot },
          },
        ],
        tracks,
      };

      const replica: Layer = {
        ...layer,
        ...(layer.flaGraphicInstanceTransformOverrides
          ? {
              flaGraphicInstanceTransformOverrides:
                cloneFlaGraphicInstanceTransformOverrides(
                  layer.flaGraphicInstanceTransformOverrides,
                ),
            }
          : {}),
        ...(layer.flaGraphicInstanceShapeOverrides
          ? {
              flaGraphicInstanceShapeOverrides: cloneFlaGraphicShapeOverrides(
                layer.flaGraphicInstanceShapeOverrides,
              ),
            }
          : {}),
        id: replicaId,
        name: radialBurstLayerName(layer.name, sample.index),
        x: safeCenter.x,
        y: safeCenter.y,
        scaleX: initScaleX,
        scaleY: initScaleY,
        rotationDeg: initRotationDeg,
        flipX: initFlipX,
        opacity: initOpacity,
        visible: false,
        locked: false,
        zIndex: nextZIndex,
        animationClip: clip,
      };
      nextZIndex += 1;

      const preservedEvents = this.cloneEventsPreservingOrder(
        internalGraphicEvents,
        replicaId,
        usedIds,
      );
      const showEventId = this.nextUniqueId(usedIds);
      usedIds.add(showEventId);
      const replicaEvents: TimelineEvent[] = [
        ...preservedEvents,
        {
          id: showEventId,
          type: 'visibility',
          layerId: replicaId,
          startMs: launchMs,
          endMs: launchMs,
          visible: true,
        },
      ];

      if (fadeOut) {
        const opacityEventId = this.nextUniqueId(usedIds);
        usedIds.add(opacityEventId);
        replicaEvents.push({
          id: opacityEventId,
          type: 'opacity',
          layerId: replicaId,
          startMs: launchMs,
          endMs,
          from: initOpacity,
          to: 0,
          easing: 'linear',
        });
        const hideAfterMs = frameTimeMs(endFrame + 1);
        if (hideAfterMs <= maxValidMs && hideAfterMs <= shot.durationMs) {
          const hideEventId = this.nextUniqueId(usedIds);
          usedIds.add(hideEventId);
          replicaEvents.push({
            id: hideEventId,
            type: 'visibility',
            layerId: replicaId,
            startMs: hideAfterMs,
            endMs: hideAfterMs,
            visible: false,
          });
        }
      }

      createdLayers.push(replica);
      createdEvents.push(...replicaEvents);
    }

    const nextShot = {
      ...shot,
      layers: [...shot.layers, ...createdLayers],
      timelineEvents: [...shot.timelineEvents, ...createdEvents],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layers: createdLayers,
    };
  }

  private cloneEventsPreservingOrder(
    sourceEvents: readonly TimelineEvent[],
    targetLayerId: string,
    usedIds: Set<string>,
    moveDelta?: Point,
  ): TimelineEvent[] {
    const sortedNewEventIds = sourceEvents
      .map(() => {
        const id = this.nextUniqueId(usedIds);
        usedIds.add(id);
        return id;
      })
      .sort((left, right) => left.localeCompare(right));
    const newEventIdBySourceId = new Map(
      [...sourceEvents]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((event, index) => [event.id, sortedNewEventIds[index]!] as const),
    );
    return sourceEvents.map((event) => {
      const cloned = structuredClone(event);
      const id = newEventIdBySourceId.get(event.id)!;
      if (cloned.type === 'move' && moveDelta) {
        return {
          ...cloned,
          id,
          layerId: targetLayerId,
          from: { x: cloned.from.x + moveDelta.x, y: cloned.from.y + moveDelta.y },
          to: { x: cloned.to.x + moveDelta.x, y: cloned.to.y + moveDelta.y },
        };
      }
      return { ...cloned, id, layerId: targetLayerId };
    });
  }

  private buildDuplicatedAnimationLayer(
    layer: Layer,
    sourceEvents: readonly TimelineEvent[],
    usedIds: Set<string>,
    position: Point,
    zIndex: number,
    name: string,
    rotationDeg: number = layer.rotationDeg,
  ): { readonly layer: Layer; readonly events: readonly TimelineEvent[] } {
    const duplicateId = this.nextUniqueId(usedIds);
    usedIds.add(duplicateId);
    const deltaX = position.x - layer.x;
    const deltaY = position.y - layer.y;
    const duplicate: Layer = {
      ...layer,
      ...(layer.flaGraphicInstanceTransformOverrides
        ? {
            flaGraphicInstanceTransformOverrides:
              cloneFlaGraphicInstanceTransformOverrides(
                layer.flaGraphicInstanceTransformOverrides,
              ),
          }
        : {}),
      ...(layer.flaGraphicInstanceShapeOverrides
        ? {
            flaGraphicInstanceShapeOverrides: cloneFlaGraphicShapeOverrides(
              layer.flaGraphicInstanceShapeOverrides,
            ),
          }
        : {}),
      ...structuredClone(remapLayerMotionOwner(layer, duplicateId)),
      ...(layer.flaGraphicInstanceTextOverrides
        ? { flaGraphicInstanceTextOverrides: structuredClone(layer.flaGraphicInstanceTextOverrides) } : {}),
      id: duplicateId,
      name,
      x: position.x,
      y: position.y,
      rotationDeg,
      zIndex,
    };
    // A duplicated/copied Layer is an ordinary Layer: copying the authored mask
    // relationship would give one target several masks and change output.
    if (duplicate.maskTargets !== undefined) delete duplicate.maskTargets;
    const motionBasis = { x: position.x, y: position.y, rotationDeg, scaleX: layer.scaleX, scaleY: layer.scaleY };
    if (duplicate.animationClip?.version === 2) {
      duplicate.animationClip = syncLayerAnimationClipBasis(duplicate.animationClip, duplicateId, motionBasis);
    }
    const events = this.cloneEventsPreservingOrder(
      sourceEvents,
      duplicate.id,
      usedIds,
      { x: deltaX, y: deltaY },
    );
    return { layer: duplicate, events };
  }

  setLocked(
    project: Project,
    shotId: string,
    layerId: string,
    locked: boolean,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    if (layer.locked === locked) return project;
    const layers = [...shot.layers];
    layers[layerIndex] = { ...layer, locked };
    return this.replaceShot(project, { ...shot, layers });
  }

  private shot(project: Project, shotId: string): Shot {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) {
      throw new LayerServiceError(
        'SHOT_NOT_FOUND',
        `找不到镜头：${shotId}`,
      );
    }
    return shot;
  }

  private layerIndex(shot: Shot, layerId: string): number {
    const index = shot.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      throw new LayerServiceError(
        'LAYER_NOT_FOUND',
        `找不到图层：${layerId}`,
      );
    }
    return index;
  }

  private assertEditable(_shot: Shot, layer: Layer): void {
    if (layer.locked) {
      throw new LayerServiceError(
        'LAYER_LOCKED',
        `图层“${layer.name}”已锁定，请先解锁。`,
      );
    }
  }

  private assertContentLayer(shot: Shot, layer: Layer): void {
    if (shot.backgroundLayerId === layer.id) {
      throw new LayerServiceError(
        'BACKGROUND_LAYER_PROTECTED',
        '背景图层不能通过普通图层层级工具排序或删除。',
      );
    }
  }

  private normalizeLayerOrder(
    shot: Shot,
    orderedContent: readonly Layer[],
  ): Layer[] {
    const background = shot.backgroundLayerId
      ? shot.layers.find(
          (layer) => layer.id === shot.backgroundLayerId,
        )
      : undefined;
    const start = background ? 1 : 0;
    return [
      ...(background ? [{ ...background, zIndex: 0 }] : []),
      ...orderedContent.map((layer, index) => ({
        ...layer,
        zIndex: start + index,
      })),
    ];
  }

  private coverLayer(
    layer: Layer,
    assetWidth: number,
    assetHeight: number,
    locked: boolean,
  ): Layer {
    const cover = calculateCoverTransform(
      { width: assetWidth, height: assetHeight },
      { width: PROJECT_WIDTH, height: PROJECT_HEIGHT },
    );
    if (!cover || !Number.isFinite(cover.scale)) {
      throw new LayerServiceError(
        'BACKGROUND_COVER_INVALID',
        '正式背景源尺寸无效，无法计算填满画布的几何。',
      );
    }
    const { parentKeys: _clearedCoverParentKeys, ...layerWithoutParentKeys } = layer;
    void _clearedCoverParentKeys;
    return {
      ...layerWithoutParentKeys,
      parentLayerId: undefined,
      parentAttachment: undefined,
      parentSpaceOffset: undefined,
      layerMotionTracks: undefined,
      cameraSpace: undefined,
      x: PROJECT_WIDTH / 2,
      y: PROJECT_HEIGHT / 2,
      scaleX: cover.scale,
      scaleY: cover.scale,
      rotationDeg: 0,
      flipX: false,
      locked,
      zIndex: 0,
    };
  }

  private replaceShot(project: Project, shot: Shot): Project {
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id ? shot : candidate,
      ),
      updatedAt: this.now().toISOString(),
    });
  }

  private appendLayer(
    project: Project,
    shot: Shot,
    name: string,
    source: Layer['source'],
    position: Point,
    scale: number,
    flipX: boolean,
  ): CreateLayerResult {
    const layer: Layer = {
      id: this.nextUniqueId(this.projectIds(project)),
      name,
      source,
      anchor: 'center',
      x: position.x,
      y: position.y,
      scaleX: scale,
      scaleY: scale,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX,
      zIndex: Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1,
    };
    return {
      project: this.replaceShot(project, {
        ...shot,
        layers: [...shot.layers, layer],
      }),
      layer,
    };
  }

  private projectIds(project: Project): Set<string> {
    return new Set([
      project.id,
      ...project.assets.map((asset) => asset.id),
      ...project.animations.map((animation) => animation.id),
      ...(project.animationSegments ?? []).map((segment) => segment.id),
      ...project.characters.flatMap((character) => [
        character.id,
        ...(character.mode === 'adaptive-parts'
          ? [
              ...character.parts.map((part) => part.partId),
              ...(character.expressions ?? []).map((expression) => expression.id),
            ]
          : character.expressions.map((expression) => expression.id)),
      ]),
      ...project.voiceProfiles.map((profile) => profile.id),
      ...project.subtitleStyles.map((style) => style.id),
      ...project.shots.flatMap((shot) => [
        shot.id,
        ...shot.layers.map((layer) => layer.id),
        ...shot.audioClips.map((clip) => clip.id),
        ...shot.dialogues.map((dialogue) => dialogue.id),
        ...shot.timelineEvents.map((event) => event.id),
      ]),
    ]);
  }

  private nextUniqueId(usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId();
      if (!usedIds.has(id)) return id;
    }
    throw new LayerServiceError(
      'ID_GENERATION_FAILED',
      '生成图层 ID 失败，请重试。',
    );
  }
}
