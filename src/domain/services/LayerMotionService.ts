import {
  compositeKeyTimesForTarget,
  deleteTargetKeyAtTime,
  hasTargetOutgoingInterval,
  NEUTRAL_ANIMATION_MOTION,
  pasteTargetKeysAtTime,
  planTargetKeysRetime,
  retimeTargetKeys,
  setTargetKeyEasing,
  targetCompositeKeyEasing,
  upsertTargetKeyValues,
  type AnimationMotionValues,
  type TargetKeysRetimeInput,
  type TargetKeysRetimePlan,
} from '../animation-track-ops';
import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import { evaluateLayerPreTrackState } from '../evaluate-shot-at-time';
import {
  createLayerAnimationClip,
  evaluateLayerRelativeMotionValues,
  layerPivotLocalOffset,
  layerPivotStageVector,
  recalibrateLayerAnimationPivot,
  type LayerBasePose,
} from '../layer-animation';
import { isFlaGraphicDefinition } from '../models/animation';
import type {
  AnimationInterpolation,
  AnimationProperty,
  LayerAnimationClip,
  LayerTargetRef,
  TargetLocalPivot,
} from '../models/animationCore';
import type { Layer } from '../models/layer';
import { ProjectSchema, type Project } from '../models/project';
import type { Shot } from '../models/shot';
import { recognizePositionChain } from '../position-chain';
import { isValidFrameTime } from '../timeline/frame-grid';
import { normalizeLayerRotation } from './LayerService';
import { PositionProjectService } from './PositionProjectService';

export const NEUTRAL_LAYER_MOTION = NEUTRAL_ANIMATION_MOTION;
export type LayerMotionValues = AnimationMotionValues;

export interface LayerMotionTargetInput {
  readonly shotId: string;
  readonly layerId: string;
}

export interface LayerMotionInput extends LayerMotionTargetInput {
  readonly timeMs: number;
  readonly autoKey: boolean;
}

export interface LayerKeyTimeInput extends LayerMotionTargetInput {
  readonly timeMs: number;
}

export interface LayerRetimeKeyInput extends LayerMotionTargetInput {
  readonly fromTimeMs: number;
  readonly toTimeMs: number;
}

export interface LayerBatchRetimeInput extends LayerMotionTargetInput, TargetKeysRetimeInput {}

export interface LayerPasteKeysInput extends LayerMotionTargetInput {
  readonly fromTimeMs: number;
  readonly toTimeMs: number;
}

export interface LayerDisplayTransformPatch {
  readonly x?: number;
  readonly y?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotationDeg?: number;
}

function layerTargetRef(layerId: string): LayerTargetRef {
  return { kind: 'layer', layerId };
}

function resolveLayerContext(
  project: Project,
  shotId: string,
  layerId: string,
): {
  readonly shot: Shot;
  readonly layer: Layer;
  readonly animation: Extract<Project['animations'][number], { kind: 'fla-graphic' }>;
} {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot) {
    throw new Error(`找不到镜头：${shotId}`);
  }
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.source.kind !== 'animation') {
    throw new Error('请选择有效的 FLA 图形动画图层。');
  }
  const animationId = layer.source.animationId;
  const animation = project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!animation || !isFlaGraphicDefinition(animation)) {
    throw new Error('对象动作仅支持 FLA 图形（Graphic）图层。');
  }
  if (layer.animationClip && layer.animationClip.version !== 2) {
    throw new Error('图层动画容器版本无效。');
  }
  return { shot, layer, animation };
}

function assertMutableLayerContext(
  project: Project,
  shotId: string,
  layerId: string,
) {
  const resolved = resolveLayerContext(project, shotId, layerId);
  if (resolved.layer.locked) {
    throw new Error(`图层“${resolved.layer.name}”已锁定，请先解锁。`);
  }
  return resolved;
}

function assertValidFrame(shot: Shot, timeMs: number): void {
  if (!isValidFrameTime(timeMs) || timeMs > shot.durationMs) {
    throw new Error('请选择镜头内的有效帧。');
  }
}

function validateScaleValue(value: number): number {
  if (!Number.isFinite(value) || value < LAYER_MIN_SCALE || value > LAYER_MAX_SCALE) {
    throw new Error(`图层缩放必须是 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间的有限数字。`);
  }
  return value;
}

function validateMotionPatch(changes: Partial<LayerMotionValues>): void {
  for (const property of Object.keys(changes) as AnimationProperty[]) {
    const value = changes[property];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      throw new Error('关键帧数值必须是有限数字。');
    }
    if (property === 'transform.scaleX' || property === 'transform.scaleY') {
      validateScaleValue(value);
    }
  }
}

function clipV2(layer: Layer): LayerAnimationClip | undefined {
  return layer.animationClip?.version === 2 ? layer.animationClip : undefined;
}

/** Read relative Property Track values for an FLA Graphic Layer at `timeMs`. */
export function layerMotionValues(
  project: Project,
  input: LayerKeyTimeInput,
): LayerMotionValues {
  const { layer } = resolveLayerContext(project, input.shotId, input.layerId);
  return evaluateLayerRelativeMotionValues(clipV2(layer), layer.id, input.timeMs);
}

/** UI aggregation only: sorted unique Composite Key timestamps on a Layer Clip v2. */
export function layerCompositeKeyTimes(layer: Layer): number[] {
  const clip = clipV2(layer);
  if (!clip) return [];
  return compositeKeyTimesForTarget(clip.tracks, layerTargetRef(layer.id));
}

/** True when the Layer Clip v2 has an outgoing interval at `timeMs`. */
export function hasLayerCompositeKeyOutgoingInterval(
  layer: Layer,
  timeMs: number,
): boolean {
  const clip = clipV2(layer);
  if (!clip) return false;
  return hasTargetOutgoingInterval(clip.tracks, layerTargetRef(layer.id), timeMs);
}

/** Outgoing easing at `timeMs` for a Layer Clip v2, or null if none. */
export function layerCompositeKeyEasing(
  layer: Layer,
  timeMs: number,
): AnimationInterpolation | null {
  const clip = clipV2(layer);
  if (!clip) return null;
  return targetCompositeKeyEasing(clip.tracks, layerTargetRef(layer.id), timeMs);
}

/** Thin Domain service for Character-free FLA Graphic Layer animation tracks and basis edits. */
export class LayerMotionService {
  private readonly positionProjectService = new PositionProjectService();

  /** Write relative Property Track keys at `input.timeMs` (no static Layer write). */
  applyKeys(
    project: Project,
    input: LayerKeyTimeInput,
    changes: Partial<LayerMotionValues>,
  ): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    assertValidFrame(shot, input.timeMs);
    validateMotionPatch(changes);

    const existingClip = clipV2(layer);
    const current = evaluateLayerRelativeMotionValues(
      existingClip,
      layer.id,
      input.timeMs,
    );
    const hasDiff = (Object.keys(changes) as AnimationProperty[]).some(
      (property) =>
        changes[property] !== undefined && changes[property] !== current[property],
    );
    if (!hasDiff) return project;

    const clip = existingClip
      ? structuredClone(existingClip)
      : createLayerAnimationClip(project, shot.id, layer.id);
    clip.tracks = upsertTargetKeyValues(
      clip.tracks,
      layerTargetRef(layer.id),
      input.timeMs,
      changes,
    );
    return this.commitLayerClip(project, shot.id, layer.id, clip);
  }

  /**
   * Author displayed Layer transform `(x, y, scaleX, scaleY, rotationDeg)` at `timeMs`.
   * - `autoKey: true`: back-solves relative track keys vs `Static/Basis + legacy Move/Scale + Shake`
   *   and writes ONLY changed Property Tracks (never mutates static Layer or legacy Events).
   * - `autoKey: false`: back-solves static transform deducting active relative tracks & Shake
   *   (refusing when legacy absolute Move/Scale events control an edited property), updating
   *   both static Layer and Clip Basis atomically if a Clip already exists.
   */
  applyTransform(
    project: Project,
    input: LayerMotionInput,
    patch: LayerDisplayTransformPatch,
  ): Project {
    const { shot, layer, animation } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    assertValidFrame(shot, input.timeMs);

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!Number.isFinite(value)) {
        throw new Error('图层变换数值必须是有限数字。');
      }
      if (key === 'scaleX' || key === 'scaleY') {
        validateScaleValue(value);
      }
    }

    const preTrack = evaluateLayerPreTrackState(shot, layer, input.timeMs, project);
    const existingClip = clipV2(layer);
    const sourceCanvas = existingClip
      ? existingClip.targetBases[0]!.sourceCanvas
      : animation.source.canvas;
    const pivot = existingClip
      ? existingClip.targetBases[0]!.pivot
      : ({
          space: 'target-local',
          x: sourceCanvas.width / 2,
          y: sourceCanvas.height / 2,
        } as const);
    const localPivot = layerPivotLocalOffset(pivot, sourceCanvas);
    const currentRel = evaluateLayerRelativeMotionValues(
      existingClip,
      layer.id,
      input.timeMs,
    );

    if (input.autoKey) {
      const prePose: LayerBasePose = {
        x: preTrack.motion.displayPosition.x,
        y: preTrack.motion.displayPosition.y,
        scaleX: preTrack.scaleX,
        scaleY: preTrack.scaleY,
        rotationDeg: preTrack.rotationDeg,
      };
      const changes: Partial<LayerMotionValues> = {};
      const nextRelRot =
        patch.rotationDeg !== undefined
          ? patch.rotationDeg - prePose.rotationDeg
          : currentRel['transform.rotationDeg'];
      const nextRelScaleX =
        patch.scaleX !== undefined
          ? validateScaleValue(patch.scaleX / prePose.scaleX)
          : currentRel['transform.scaleX'];
      const nextRelScaleY =
        patch.scaleY !== undefined
          ? validateScaleValue(patch.scaleY / prePose.scaleY)
          : currentRel['transform.scaleY'];

      if (patch.rotationDeg !== undefined) {
        changes['transform.rotationDeg'] = nextRelRot;
      }
      if (patch.scaleX !== undefined) {
        changes['transform.scaleX'] = nextRelScaleX;
      }
      if (patch.scaleY !== undefined) {
        changes['transform.scaleY'] = nextRelScaleY;
      }
      if (patch.x !== undefined || patch.y !== undefined) {
        const vBase = layerPivotStageVector(
          localPivot,
          prePose.rotationDeg,
          prePose.scaleX,
          prePose.scaleY,
          preTrack.flipX,
        );
        const vFinal = layerPivotStageVector(
          localPivot,
          prePose.rotationDeg + nextRelRot,
          prePose.scaleX * nextRelScaleX,
          prePose.scaleY * nextRelScaleY,
          preTrack.flipX,
        );
        if (patch.x !== undefined) {
          changes['transform.offsetX'] =
            patch.x - prePose.x + vFinal.x - vBase.x;
        }
        if (patch.y !== undefined) {
          changes['transform.offsetY'] =
            patch.y - prePose.y + vFinal.y - vBase.y;
        }
      }
      return this.applyKeys(
        project,
        { shotId: shot.id, layerId: layer.id, timeMs: input.timeMs },
        changes,
      );
    }

    const editingPosition = patch.x !== undefined || patch.y !== undefined;
    const editingScale = patch.scaleX !== undefined || patch.scaleY !== undefined;
    const isMoveLockedAtTime =
      preTrack.controlledByMove &&
      !(input.timeMs === 0 && recognizePositionChain({ shot, layer }).status === 'editable');
    if (editingPosition && isMoveLockedAtTime) {
      throw new Error('当前时刻位置正由时间轴移动事件控制，请开启自动关键帧或到事件生效前编辑基准。');
    }
    if (editingScale && preTrack.controlledByScale) {
      throw new Error('当前时刻缩放正由时间轴缩放事件控制，请开启自动关键帧或到事件生效前编辑基准。');
    }

    const nextStaticScaleX =
      patch.scaleX !== undefined
        ? validateScaleValue(patch.scaleX / currentRel['transform.scaleX'])
        : layer.scaleX;
    const nextStaticScaleY =
      patch.scaleY !== undefined
        ? validateScaleValue(patch.scaleY / currentRel['transform.scaleY'])
        : layer.scaleY;
    const nextStaticRotationDeg =
      patch.rotationDeg !== undefined
        ? normalizeLayerRotation(patch.rotationDeg - currentRel['transform.rotationDeg'])
        : layer.rotationDeg;

    let nextStaticX = layer.x;
    let nextStaticY = layer.y;
    if (editingPosition) {
      const vBase = layerPivotStageVector(
        localPivot,
        nextStaticRotationDeg,
        nextStaticScaleX,
        nextStaticScaleY,
        preTrack.flipX,
      );
      const vFinal = layerPivotStageVector(
        localPivot,
        nextStaticRotationDeg + currentRel['transform.rotationDeg'],
        nextStaticScaleX * currentRel['transform.scaleX'],
        nextStaticScaleY * currentRel['transform.scaleY'],
        preTrack.flipX,
      );
      if (patch.x !== undefined) {
        nextStaticX =
          patch.x -
          preTrack.motion.shakeOffset.x -
          currentRel['transform.offsetX'] -
          vBase.x +
          vFinal.x;
      }
      if (patch.y !== undefined) {
        nextStaticY =
          patch.y -
          preTrack.motion.shakeOffset.y -
          currentRel['transform.offsetY'] -
          vBase.y +
          vFinal.y;
      }
    }

    if (
      nextStaticX < 0 ||
      nextStaticX > PROJECT_WIDTH ||
      nextStaticY < 0 ||
      nextStaticY > PROJECT_HEIGHT
    ) {
      throw new Error(`图层坐标必须位于 0–${PROJECT_WIDTH} 和 0–${PROJECT_HEIGHT} 之间。`);
    }

    return this.positionProjectService.applyBaseBoundLayerChange(
      project,
      shot.id,
      layer.id,
      {
        x: nextStaticX,
        y: nextStaticY,
        scaleX: nextStaticScaleX,
        scaleY: nextStaticScaleY,
        rotationDeg: nextStaticRotationDeg,
      },
    );
  }

  deleteKey(project: Project, input: LayerKeyTimeInput): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = clipV2(layer);
    if (!existing) {
      throw new Error(`找不到位于 ${input.timeMs} ms 的关键帧。`);
    }
    const nextClip: LayerAnimationClip = {
      ...existing,
      tracks: deleteTargetKeyAtTime(
        existing.tracks,
        layerTargetRef(layer.id),
        input.timeMs,
      ),
    };
    return this.commitLayerClip(project, shot.id, layer.id, nextClip);
  }

  planKeysRetime(
    project: Project,
    input: LayerBatchRetimeInput,
  ): TargetKeysRetimePlan {
    const { shot, layer } = resolveLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = clipV2(layer);
    return planTargetKeysRetime(
      existing?.tracks ?? [],
      layerTargetRef(layer.id),
      shot.durationMs,
      input,
    );
  }

  retimeKey(project: Project, input: LayerRetimeKeyInput): Project {
    return this.retimeKeys(project, {
      shotId: input.shotId,
      layerId: input.layerId,
      fromTimesMs: [input.fromTimeMs],
      deltaMs: input.toTimeMs - input.fromTimeMs,
    });
  }

  retimeKeys(project: Project, input: LayerBatchRetimeInput): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = clipV2(layer);
    if (!existing) {
      throw new Error('找不到可移动的关键帧。');
    }
    const nextTracks = retimeTargetKeys(
      existing.tracks,
      layerTargetRef(layer.id),
      shot.durationMs,
      input,
    );
    if (nextTracks === existing.tracks) return project;
    return this.commitLayerClip(project, shot.id, layer.id, {
      ...existing,
      tracks: nextTracks,
    });
  }

  setKeyEasing(
    project: Project,
    input: LayerKeyTimeInput,
    easing: AnimationInterpolation,
  ): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = clipV2(layer);
    if (!existing) {
      throw new Error('该关键帧没有可设置插值的后续区间。');
    }
    const nextTracks = setTargetKeyEasing(
      existing.tracks,
      layerTargetRef(layer.id),
      input.timeMs,
      easing,
    );
    return this.commitLayerClip(project, shot.id, layer.id, {
      ...existing,
      tracks: nextTracks,
    });
  }

  pasteKeys(project: Project, input: LayerPasteKeysInput): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = clipV2(layer);
    if (!existing) {
      throw new Error(`找不到位于 ${input.fromTimeMs} ms 的可粘贴关键帧。`);
    }
    const nextTracks = pasteTargetKeysAtTime(
      existing.tracks,
      layerTargetRef(layer.id),
      shot.durationMs,
      input.fromTimeMs,
      input.toTimeMs,
    );
    return this.commitLayerClip(project, shot.id, layer.id, {
      ...existing,
      tracks: nextTracks,
    });
  }

  recalibratePivot(
    project: Project,
    input: LayerMotionTargetInput,
    pivot: TargetLocalPivot,
  ): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const clip = createLayerAnimationClip(project, shot.id, layer.id);
    const nextClip = recalibrateLayerAnimationPivot(
      clip,
      layerTargetRef(layer.id),
      pivot,
    );
    return this.commitLayerClip(project, shot.id, layer.id, nextClip);
  }

  private commitLayerClip(
    project: Project,
    shotId: string,
    layerId: string,
    clip: LayerAnimationClip,
  ): Project {
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === layerId ? { ...layer, animationClip: clip } : layer,
              ),
            }
          : shot,
      ),
    });
  }
}
