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
  type Point,
} from '../geometry';
import {
  isFlaGraphicDefinition,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  ProjectSchema,
  type AnimationPlayback,
  type Layer,
  type Project,
  type Shot,
} from '../models';
import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../../shared/affine-matrix';
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
  deleteFlaGraphicTimelineKeyframe as deleteTimelineKeyframePure,
  duplicateFlaGraphicTimelineKeyframe as duplicateTimelineKeyframePure,
  evaluateFlaGraphicTrackAtTime,
  moveFlaGraphicTimelineKeyframe as moveTimelineKeyframePure,
  resolveFlaGraphicTimelineTarget,
  setFlaGraphicTimelineKeyframeEasing as setTimelineKeyframeEasingPure,
  updateFlaGraphicTimelineKeyframeTransform as updateTimelineKeyframeTransformPure,
  withFlaGraphicContainerTimeline,
  type FlaGraphicInternalTimeline,
  type FlaGraphicTimelineTargetInfo,
  type FlaGraphicTransformEasing,
} from '../models/flaGraphicTimeline';
import type { AssetDropPayload } from '../assetDropPayload';
import { resolveBackgroundSourceDimensions } from '../selectors/canvasLayers';
import { PositionProjectService } from './PositionProjectService';
import { evaluatedLayerWorldMatrix, validLayerParentTargets } from '../layer-parent-space';
import { evaluateShotAtTime, type EvaluatedLayer } from '../evaluate-shot-at-time';
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
  | 'SHAPE_SVG_REQUIRED'
  | 'SHAPE_NO_EDITABLE_REGIONS'
  | 'SHAPE_NODE_REQUIRED'
  | 'SHAPE_BITMAP_FILL_UNSUPPORTED'
  | 'SHAPE_AMBIGUOUS_STROKES'
  | 'SHAPE_REGION_NOT_FOUND'
  | 'SHAPE_REGION_REQUIRED'
  | 'SHAPE_FILL_NOT_SOLID';

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
  const normalized = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
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
    return this.appendLayer(
      project,
      shot,
      character.name,
      { kind: 'character', characterId: character.id },
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
    return this.commitShapeOverrides(
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
    },
  ): Project {
    return this.mutateFlaGraphicShapeRegion(project, {
      ...input,
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
        if (!target.trsSafe) {
          throw new Error(
            '当前节点包含倾斜或非标准缩放变换，内部时间轴暂不支持添加关键帧。',
          );
        }
        const existingTrack = target.timeline?.tracks.find(
          (t) => t.trackId === target.trackId,
        );
        const initialMatrix =
          (existingTrack
            ? evaluateFlaGraphicTrackAtTime(existingTrack, timeMs)
            : null) ?? target.targetNode.localTransform;
        return addTimelineKeyframePure(
          target.timeline,
          target.trackId,
          timeMs,
          initialMatrix,
          easing,
        );
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
        if (!target.trsSafe) {
          throw new Error(
            '当前节点包含倾斜或非标准缩放变换，内部时间轴暂不支持编辑关键帧。',
          );
        }
        return updateTimelineKeyframeTransformPure(
          target.timeline,
          target.trackId,
          timeMs,
          localTransform,
        );
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
    const toTimeMs = resolveTimelineFrameTime(requestedToTimeMs, shot.durationMs);
    if (toTimeMs === fromTimeMs) return project;
    const others = existingKeys.filter((key) => key.timeMs !== fromTimeMs);
    if (others.some((key) => key.timeMs === toTimeMs)) {
      throw new Error('目标帧已存在父级切换关键帧。');
    }
    const shotWithoutMoving: Shot = {
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.id === childId ? { ...layer, parentKeys: others.length ? others : undefined } : layer,
      ),
    };
    const nextKeyTime = others.find((key) => key.timeMs > toTimeMs)?.timeMs ?? Infinity;
    if (
      moving.parentLayerId !== null &&
      !validLayerParentTargets(shotWithoutMoving, childId, toTimeMs, nextKeyTime).some(({ id }) => id === moving.parentLayerId)
    ) {
      throw new Error('移动到目标帧会形成父级循环。');
    }
    const movedKey = this.buildParentKeyAtBoundary(
      project,
      shotWithoutMoving,
      child,
      toTimeMs,
      moving.parentLayerId,
      { target: moving.parentAttachment?.target, depthMode: moving.depthMode },
    );
    const parentKeys = [...others, movedKey].sort((left, right) => left.timeMs - right.timeMs);
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
      const baseRefsDeleted = candidate.parentLayerId === layerId;
      const keysRefDeleted = Boolean(candidate.parentKeys?.some((key) => key.parentLayerId === layerId));
      if (!baseRefsDeleted && !keysRefDeleted) return candidate;
      let nextCandidate = candidate;
      if (baseRefsDeleted) {
        const baseIsActive = !candidate.parentKeys?.length || timeMs < candidate.parentKeys[0]!.timeMs;
        const basePose = poseAt(baseIsActive ? timeMs : 0, candidate.id);
        nextCandidate = {
          ...nextCandidate,
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
          const preservedDepth = frozenParentKeyDepth(nextCandidate, segPose, false);
          const preservedSpace = frozenDetachedKeyCameraSpace(nextCandidate, segPose);
          return {
            timeMs: key.timeMs,
            parentLayerId: null,
            ...(segPose?.parentSpace ? { parentSpaceOffset: segPose.parentSpace } : {}),
            depthMode: 'preserve',
            ...(preservedDepth !== undefined ? { depth: preservedDepth } : {}),
            ...(preservedSpace ? { cameraSpace: preservedSpace } : {}),
          };
        });
        nextCandidate = { ...nextCandidate, parentKeys: nextKeys };
      }
      return nextCandidate;
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
    const copiedParentKeys = sameShot && layer.parentKeys?.length
      ? layer.parentKeys
          .filter((key) => key.parentLayerId === null || destination.layers.some(({ id }) => id === key.parentLayerId))
          .map((key) => structuredClone(key))
      : undefined;

    const usedIds = this.projectIds(project);
    const duplicateId = this.nextUniqueId(usedIds);
    usedIds.add(duplicateId);
    const offsetPosition = clampLayerPosition({
      x: layer.x + 24,
      y: layer.y + 24,
    });
    const position = !sameShot ? { x: layer.x, y: layer.y } :
      offsetPosition.x === layer.x && offsetPosition.y === layer.y
        ? clampLayerPosition({ x: layer.x - 24, y: layer.y - 24 })
        : offsetPosition;
    const {
      parentKeys: _sourceParentKeys,
      animationTimeLink: _sourceAnimationTimeLink,
      ...layerBase
    } = layer;
    void _sourceParentKeys;
    void _sourceAnimationTimeLink;
    const duplicate: Layer = {
      ...layerBase,
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
      id: duplicateId,
      ...remapLayerMotionOwner(layer, duplicateId),
      parentLayerId: keepParent ? layer.parentLayerId : undefined,
      parentAttachment: keepParent ? layer.parentAttachment : undefined,
      ...(copiedParentKeys?.length ? { parentKeys: copiedParentKeys } : {}),
      ...(sameShot && layer.animationTimeLink ? { animationTimeLink: { ...layer.animationTimeLink } } : {}),
      parentSpaceOffset: copiedSpace,
      cameraSpace: detachedPose ? detachedPose.effectiveCameraSpace : layer.cameraSpace,
      depth: detachedPose ? preservedDetachedDepth(layer, detachedPose) : layer.depth,
      name: `${layer.name} 副本`,
      x: position.x,
      y: position.y,
      zIndex: Math.max(-1, ...destination.layers.map((item) => item.zIndex)) + 1,
    };
    if (duplicate.animationClip?.version === 2) {
      duplicate.animationClip = syncLayerAnimationClipBasis(duplicate.animationClip, duplicateId, duplicate);
    }
    const duplicatedEvents = shot.timelineEvents
      .filter((event) => event.layerId === layer.id && (event.type !== 'mouth-pose' || !event.dialogueId ||
        (sameShot && destination.dialogues.some(({ id }) => id === event.dialogueId))))
      .map((event) => {
        const id = this.nextUniqueId(usedIds);
        usedIds.add(id);
        return { ...event, id, layerId: duplicate.id };
      });
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
