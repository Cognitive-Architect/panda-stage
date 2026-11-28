import { invertAffineMatrix } from '../../shared/affine-matrix';
import { evaluatedLayerWorldMatrix } from '../layer-parent-space';
import { projectShotDialogueVisual } from '../selectors/temporalRender';
import {
  compositeKeyTimesForTarget,
  deleteTargetKeyAtTime,
  hasTargetOutgoingInterval,
  NEUTRAL_ANIMATION_MOTION,
  pasteTargetKeysAtTime,
  pasteTargetKeySnapshotAtTime,
  planTargetKeysRetime,
  planTargetKeySpanDuration,
  readTargetAuthoredKeyValues,
  retimeTargetKeys,
  retimeTargetKeySpanDuration,
  setTargetKeyEasing,
  targetCompositeKeyEasing,
  upsertTargetKeyValues,
  type AnimationMotionValues,
  type TargetKeySpanDurationInput,
  type TargetKeySpanDurationPlan,
  type TargetKeysRetimeInput,
  type TargetKeysRetimePlan,
} from '../animation-track-ops';
import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  assertLayerClipFinalScalesInBounds,
  evaluateLayerPreTrackState,
  evaluateShotAtTime,
} from '../evaluate-shot-at-time';
import {
  MIN_CURVE_ARC_LENGTH,
  sampleCubicBezierBySteps,
  type CurveMotionSpeedMode,
  type Point,
} from '../geometry';
import {
  createLayerAnimationClip,
  canAuthorLayerRootMotion,
  centeredLayerMotionClip,
  evaluateLayerRelativeMotionValues,
  findLayerMotionGraphic,
  layerRootMotionClip,
  layerPivotLocalOffset,
  layerPivotStageVector,
  recalibrateLayerAnimationPivot,
  solveLayerRelativeOffsetForStagePoint,
  type LayerBasePose,
} from '../layer-animation';
import { insertAnimationTrackSample } from '../evaluate-animation-core';
import type {
  AnimationInterpolation,
  AnimationKey,
  AnimationProperty,
  AnimationTrack,
  LayerAnimationClip,
  LayerTargetRef,
  TargetLocalPivot,
} from '../models/animationCore';
import type { Layer } from '../models/layer';
import { ProjectSchema, type Project } from '../models/project';
import type { Shot } from '../models/shot';
import { recognizePositionChain } from '../position-chain';
import {
  frameTimeMs,
  isValidFrameTime,
  lastValidFrameTime,
} from '../timeline/frame-grid';
import { normalizeLayerRotation } from './LayerService';
import { PositionProjectService } from './PositionProjectService';
import { applyUserMotionPresetTracks, captureUserMotionPreset } from '../user-motion-presets';
import { buildAudioMotionTracks, type AudioMotionDraft } from '../audio-motion';

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

export interface LayerKeySpanDurationInput
  extends LayerMotionTargetInput,
    TargetKeySpanDurationInput {}

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

export interface LayerCurveMotionInput extends LayerMotionTargetInput {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
  readonly speedMode: CurveMotionSpeedMode;
  readonly replacePosition?: boolean;
}

export function layerCurveMotionPositionTracks(layer: Layer): AnimationTrack[] {
  return layerRootMotionClip(layer)?.tracks.filter(({ property }) =>
    property === 'transform.offsetX' || property === 'transform.offsetY') ?? [];
}

export function getLayerCurveMotionConflict(
  shot: Shot,
  layer: Layer,
  replacement?: { startMs: number; endMs: number },
): string | null {
  if (shot.backgroundLayerId === layer.id) {
    return '背景图层不能生成曲线运动。';
  }
  if (!replacement && layerCurveMotionPositionTracks(layer).length) {
    return '当前图层已有 X/Y 位移关键帧，请明确选择替换区段。';
  }
  if (
    shot.timelineEvents.some(
      (event) =>
        event.layerId === layer.id &&
        (event.type === 'move' || event.type === 'shake') &&
        (!replacement || (event.startMs <= replacement.endMs && event.endMs >= replacement.startMs)),
    )
  ) {
    return '当前图层存在时间轴移动或抖动事件，请先移除相关位置事件后再生成曲线运动。';
  }
  return null;
}

function assertStagePointInBounds(point: Point, label: string): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > PROJECT_WIDTH ||
    point.y < 0 ||
    point.y > PROJECT_HEIGHT
  ) {
    throw new Error(
      `${label}坐标必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    );
  }
}

function layerTargetRef(layerId: string): LayerTargetRef {
  return { kind: 'layer', layerId };
}

function resolveLayerContext(
  project: Project,
  shotId: string,
  layerId: string,
  allowCharacterRoot = false,
): {
  readonly shot: Shot;
  readonly layer: Layer;
} {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot) {
    throw new Error(`找不到镜头：${shotId}`);
  }
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.id === shot.backgroundLayerId) {
    throw new Error('请选择有效的 FLA 图形动画图层。');
  }
  const animation = findLayerMotionGraphic(project, layer);
  if (!animation && !canAuthorLayerRootMotion(layer) &&
    !(allowCharacterRoot && layer.source.kind === 'character')) {
    throw new Error('对象动作仅支持 FLA 图形（Graphic）图层。');
  }
  if (animation && layer.animationClip && layer.animationClip.version !== 2) {
    throw new Error('图层动画容器版本无效。');
  }
  return { shot, layer };
}

function assertMutableLayerContext(
  project: Project,
  shotId: string,
  layerId: string,
  allowCharacterRoot = false,
) {
  const resolved = resolveLayerContext(project, shotId, layerId, allowCharacterRoot);
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

function validateDisplayScale(value: number): number {
  if (!Number.isFinite(value) || value < LAYER_MIN_SCALE || value > LAYER_MAX_SCALE) {
    throw new Error(`图层缩放必须是 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间的有限数字。`);
  }
  return value;
}

function validateScaleMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('图层关键帧缩放倍率必须是大于 0 的有限数字。');
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
      validateScaleMultiplier(value);
    }
  }
}

/** Read relative Property Track values for an FLA Graphic Layer at `timeMs`. */
export function layerMotionValues(
  project: Project,
  input: LayerKeyTimeInput,
): LayerMotionValues {
  const { layer } = resolveLayerContext(project, input.shotId, input.layerId);
  return evaluateLayerRelativeMotionValues(layerRootMotionClip(layer), layer.id, input.timeMs);
}

/** UI aggregation only: sorted unique Composite Key timestamps on a Layer Clip v2. */
export function layerCompositeKeyTimes(layer: Layer): number[] {
  const clip = layerRootMotionClip(layer);
  if (!clip) return [];
  return compositeKeyTimesForTarget(clip.tracks, layerTargetRef(layer.id));
}

/** True when the Layer Clip v2 has an outgoing interval at `timeMs`. */
export function hasLayerCompositeKeyOutgoingInterval(
  layer: Layer,
  timeMs: number,
): boolean {
  const clip = layerRootMotionClip(layer);
  if (!clip) return false;
  return hasTargetOutgoingInterval(clip.tracks, layerTargetRef(layer.id), timeMs);
}

/** Outgoing easing at `timeMs` for a Layer Clip v2, or null if none. */
export function layerCompositeKeyEasing(
  layer: Layer,
  timeMs: number,
): AnimationInterpolation | null {
  const clip = layerRootMotionClip(layer);
  if (!clip) return null;
  return targetCompositeKeyEasing(clip.tracks, layerTargetRef(layer.id), timeMs);
}

/** Freeze ONLY the actually authored sparse properties at `timeMs` for clipboard copy. */
export function layerCompositePoseSnapshot(
  layer: Layer,
  timeMs: number,
): Partial<LayerMotionValues> | null {
  const clip = layerRootMotionClip(layer);
  if (!clip) return null;
  return readTargetAuthoredKeyValues(clip.tracks, layerTargetRef(layer.id), timeMs);
}

/** Thin Domain service for Character-free FLA Graphic Layer animation tracks and basis edits. */
export class LayerMotionService {
  private readonly positionProjectService = new PositionProjectService();

  saveUserMotionPreset(project: Project, input: LayerMotionTargetInput & {
    name: string; startMs: number; endMs: number; replaceId?: string;
  }): Project {
    const { shot, layer } = resolveLayerContext(project, input.shotId, input.layerId);
    assertValidFrame(shot, input.startMs);
    assertValidFrame(shot, input.endMs);
    const clip = layerRootMotionClip(layer);
    if (!clip || input.endMs <= input.startMs) throw new Error('请选择有关键帧的运动时段。');
    const library = project.userMotionPresets ?? [];
    if (input.replaceId && !library.some((item) => item.id === input.replaceId)) {
      throw new Error('找不到要更新的运动预设。');
    }
    const preset = captureUserMotionPreset(clip, input.replaceId ?? crypto.randomUUID(),
      input.name, input.startMs, input.endMs);
    return ProjectSchema.parse({ ...project, userMotionPresets: input.replaceId
      ? library.map((item) => item.id === input.replaceId ? preset : item)
      : [...library, preset] });
  }

  applyUserMotionPreset(
    project: Project,
    input: LayerKeyTimeInput,
    presetId: string,
    options: { readonly allowCharacterRoot?: boolean } = {},
  ): Project {
    const { shot, layer } = assertMutableLayerContext(project, input.shotId, input.layerId, options.allowCharacterRoot);
    const preset = project.userMotionPresets?.find((entry) => entry.id === presetId);
    if (!preset) throw new Error('找不到选择的运动预设。');
    assertValidFrame(shot, input.timeMs);
    const clip = layerRootMotionClip(layer) ?? (layer.source.kind === 'character'
      ? centeredLayerMotionClip(layer)
      : createLayerAnimationClip(project, shot.id, layer.id));
    const tracks = applyUserMotionPresetTracks(clip, layer.id, preset, input.timeMs, shot.durationMs);
    return this.commitLayerClip(project, shot.id, layer.id, { ...clip, tracks });
  }

  applyAudioMotion(project: Project, input: LayerMotionTargetInput, draft: AudioMotionDraft): Project {
    const { shot, layer } = assertMutableLayerContext(project, input.shotId, input.layerId);
    assertValidFrame(shot, draft.startMs);
    assertValidFrame(shot, draft.endMs);
    if (draft.endMs <= draft.startMs || !Number.isFinite(draft.strength) || draft.strength <= 0 || draft.strength > 1) {
      throw new Error('请选择有效的音频时段与运动强度。');
    }
    let previous = draft.startMs;
    for (const point of draft.levels) {
      assertValidFrame(shot, point.timeMs);
      if (point.timeMs <= previous || point.timeMs >= draft.endMs ||
          !Number.isFinite(point.level) || point.level < 0 || point.level > 1) {
        throw new Error('音量草稿包含不在选段内的关键帧。');
      }
      previous = point.timeMs;
    }
    if (!draft.levels.some(({ level }) => level > 0)) throw new Error('所选时段内没有可生成运动的声音。');
    const clip = layerRootMotionClip(layer) ?? createLayerAnimationClip(project, shot.id, layer.id);
    const tracks = buildAudioMotionTracks(clip, layer.id, draft);
    return this.commitLayerClip(project, shot.id, layer.id, { ...clip, tracks });
  }

  /**
   * Bake a single-segment 2D cubic Bézier curve into explicit frame-grid
   * `transform.offsetX` and `transform.offsetY` keys on the Layer's v2 Clip.
   */
  applyCurveMotion(project: Project, input: LayerCurveMotionInput): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    if (
      !Number.isSafeInteger(input.startFrame) ||
      !Number.isSafeInteger(input.endFrame) ||
      input.startFrame < 0 ||
      input.endFrame <= input.startFrame
    ) {
      throw new Error('起止帧必须是非负整数，且止帧必须晚于起帧至少 1 帧。');
    }
    const maxValidMs = lastValidFrameTime(shot.durationMs);
    const startTimeMs = frameTimeMs(input.startFrame);
    const endTimeMs = frameTimeMs(input.endFrame);
    if (
      !isValidFrameTime(startTimeMs) ||
      !isValidFrameTime(endTimeMs) ||
      endTimeMs > maxValidMs ||
      endTimeMs > shot.durationMs
    ) {
      throw new Error('起止帧必须位于当前镜头的合法帧范围内。');
    }
    const replacing = input.replacePosition === true && layerCurveMotionPositionTracks(layer).length > 0;
    const interval = input.replacePosition ? { startMs: startTimeMs, endMs: endTimeMs } : undefined;
    const conflict = getLayerCurveMotionConflict(shot, layer, interval);
    if (conflict) throw new Error(conflict);
    if (input.speedMode !== 'constant' && input.speedMode !== 'ease-in-out') {
      throw new Error('请选择有效的曲线速度模式。');
    }

    const evaluateCurveLayer = (timeMs: number) => projectShotDialogueVisual(
      project, shot, evaluateShotAtTime(shot, timeMs, project),
    ).layers.find((candidate) => candidate.id === layer.id);
    const evaluatedAtStart = evaluateCurveLayer(startTimeMs);
    if (!evaluatedAtStart || evaluatedAtStart.parentSpaceUnavailable) {
      throw new Error(`找不到图层：${layer.id}`);
    }
    const startAnchor = evaluatedLayerWorldMatrix(evaluatedAtStart);
    const p0: Point = { x: startAnchor.tx, y: startAnchor.ty };
    const evaluatedAtEnd = replacing
      ? evaluateCurveLayer(endTimeMs)
      : undefined;
    if (replacing && (!evaluatedAtEnd || evaluatedAtEnd.parentSpaceUnavailable)) {
      throw new Error('无法解析曲线终点的图层坐标。');
    }
    const endAnchor = evaluatedAtEnd && evaluatedLayerWorldMatrix(evaluatedAtEnd);
    const p3 = endAnchor ? { x: endAnchor.tx, y: endAnchor.ty } : input.p3;
    if (!replacing) assertStagePointInBounds(p0, '起点 P0');
    assertStagePointInBounds(input.p1, '控制点 P1');
    assertStagePointInBounds(input.p2, '控制点 P2');
    if (!replacing) assertStagePointInBounds(p3, '终点 P3');

    const stepCount = input.endFrame - input.startFrame;
    const sampled = sampleCubicBezierBySteps(
      { p0, p1: input.p1, p2: input.p2, p3 },
      stepCount,
      input.speedMode,
    );
    if (sampled.totalLength <= MIN_CURVE_ARC_LENGTH) {
      throw new Error('曲线路径长度为 0，请调整控制点或终点后再生成。');
    }

    const existingClip = layerRootMotionClip(layer);
    const clip = existingClip
      ? structuredClone(existingClip)
      : createLayerAnimationClip(project, shot.id, layer.id);
    const basis = clip.targetBases[0]!;
    const sourceCanvas = basis.sourceCanvas;
    const localPivot = layerPivotLocalOffset(basis.pivot, sourceCanvas);

    const samplesNeedParentSpace = Boolean(layer.parentLayerId || layer.parentKeys?.length || layer.parentSpaceOffset);
    const offsetXKeys: AnimationKey[] = [];
    const offsetYKeys: AnimationKey[] = [];
    if (!replacing && startTimeMs > 0) {
      offsetXKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
      offsetYKeys.push({ timeMs: 0, value: 0, interpolationToNext: 'linear' });
    }

    for (let step = 0; step <= stepCount; step += 1) {
      const timeMs = frameTimeMs(input.startFrame + step);
      const worldPoint = sampled.points[step]!;
      let samplePoint = worldPoint;
      if (samplesNeedParentSpace) {
        const evaluated = evaluateCurveLayer(timeMs);
        if (!evaluated || evaluated.parentSpaceUnavailable) throw new Error('无法解析曲线区段的图层坐标。');
        if (evaluated.parentSpace) {
          const inverse = invertAffineMatrix(evaluated.parentSpace);
          if (!inverse) throw new Error('当前父级的图层变换不可逆。');
          const { a, b, c, d, tx, ty } = inverse;
          samplePoint = { x: a * worldPoint.x + c * worldPoint.y + tx, y: b * worldPoint.x + d * worldPoint.y + ty };
        }
      }
      const preTrack = evaluateLayerPreTrackState(shot, layer, timeMs, project);
      const currentRel = evaluateLayerRelativeMotionValues(
        existingClip,
        layer.id,
        timeMs,
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
        samplePoint,
      );
      offsetXKeys.push({
        timeMs,
        value: solved.offsetX!,
        interpolationToNext: 'linear',
      });
      offsetYKeys.push({
        timeMs,
        value: solved.offsetY!,
        interpolationToNext: 'linear',
      });
    }

    const target = layerTargetRef(layer.id);
    const original = layerCurveMotionPositionTracks(layer);
    const positionTracks = [
      { target, property: 'transform.offsetX' as const, keys: offsetXKeys },
      { target, property: 'transform.offsetY' as const, keys: offsetYKeys },
    ];
    if (replacing) {
      for (const track of positionTracks) {
        const oldKeys = original.find(({ property }) => property === track.property)?.keys ??
          [{ timeMs: 0, value: 0, interpolationToNext: 'linear' as const }];
        const anchors = insertAnimationTrackSample(insertAnimationTrackSample(oldKeys, startTimeMs), endTimeMs);
        const start = anchors.find(({ timeMs }) => timeMs === startTimeMs)!;
        const end = anchors.find(({ timeMs }) => timeMs === endTimeMs)!;
        track.keys = [
          ...anchors.filter(({ timeMs }) => timeMs < startTimeMs),
          { ...track.keys[0]!, value: start.value },
          ...track.keys.slice(1, -1),
          end,
          ...anchors.filter(({ timeMs }) => timeMs > endTimeMs),
        ];
      }
    }
    const nextTracks: LayerAnimationClip['tracks'] = [
      ...clip.tracks.filter(({ property }) => property !== 'transform.offsetX' && property !== 'transform.offsetY'),
      ...positionTracks,
    ];
    return this.commitLayerClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

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

    const existingClip = layerRootMotionClip(layer);
    const current = evaluateLayerRelativeMotionValues(
      existingClip,
      layer.id,
      input.timeMs,
    );
    const hasDiff = (Object.keys(changes) as AnimationProperty[]).some(
      (property) =>
        changes[property] !== undefined && changes[property] !== current[property],
    );
    if (!hasDiff) {
      if (existingClip) {
        assertLayerClipFinalScalesInBounds(shot, layer, project, [input.timeMs]);
      } else {
        const preTrack = evaluateLayerPreTrackState(shot, layer, input.timeMs, project);
        if (changes['transform.scaleX'] !== undefined) {
          validateDisplayScale(preTrack.scaleX * changes['transform.scaleX']);
        }
        if (changes['transform.scaleY'] !== undefined) {
          validateDisplayScale(preTrack.scaleY * changes['transform.scaleY']);
        }
      }
      return project;
    }

    const clip = existingClip
      ? structuredClone(existingClip)
      : createLayerAnimationClip(project, shot.id, layer.id);
    clip.tracks = upsertTargetKeyValues(
      clip.tracks,
      layerTargetRef(layer.id),
      input.timeMs,
      changes,
    );
    return this.commitLayerClip(project, shot.id, layer.id, clip, [input.timeMs]);
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
    const { shot, layer } = assertMutableLayerContext(
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
        validateDisplayScale(value);
      }
    }

    const preTrack = evaluateLayerPreTrackState(shot, layer, input.timeMs, project);
    const existingClip = layerRootMotionClip(layer);
    const { sourceCanvas, pivot } = (existingClip ?? createLayerAnimationClip(project, shot.id, layer.id)).targetBases[0]!;
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
          ? validateScaleMultiplier(patch.scaleX / prePose.scaleX)
          : currentRel['transform.scaleX'];
      const nextRelScaleY =
        patch.scaleY !== undefined
          ? validateScaleMultiplier(patch.scaleY / prePose.scaleY)
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
        const solved = solveLayerRelativeOffsetForStagePoint(
          localPivot,
          prePose,
          preTrack.flipX,
          nextRelRot,
          nextRelScaleX,
          nextRelScaleY,
          { x: patch.x, y: patch.y },
        );
        if (solved.offsetX !== undefined) {
          changes['transform.offsetX'] = solved.offsetX;
        }
        if (solved.offsetY !== undefined) {
          changes['transform.offsetY'] = solved.offsetY;
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
        ? validateDisplayScale(patch.scaleX / currentRel['transform.scaleX'])
        : layer.scaleX;
    const nextStaticScaleY =
      patch.scaleY !== undefined
        ? validateDisplayScale(patch.scaleY / currentRel['transform.scaleY'])
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
    const existing = layerRootMotionClip(layer);
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
    const existing = layerRootMotionClip(layer);
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
    const existing = layerRootMotionClip(layer);
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

  planKeySpanDuration(
    project: Project,
    input: LayerKeySpanDurationInput,
  ): TargetKeySpanDurationPlan {
    const { shot, layer } = resolveLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = layerRootMotionClip(layer);
    return planTargetKeySpanDuration(
      existing?.tracks ?? [],
      layerTargetRef(layer.id),
      shot.durationMs,
      input,
    );
  }

  retimeKeySpanDuration(
    project: Project,
    input: LayerKeySpanDurationInput,
  ): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    const existing = layerRootMotionClip(layer);
    if (!existing) {
      throw new Error('找不到可调整时长的关键帧选段。');
    }
    const nextTracks = retimeTargetKeySpanDuration(
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
    const existing = layerRootMotionClip(layer);
    if (!existing) {
      throw new Error('该关键帧没有可设置插值的后续区间。');
    }
    const nextTracks = setTargetKeyEasing(
      existing.tracks,
      layerTargetRef(layer.id),
      input.timeMs,
      easing,
    );
    if (nextTracks === existing.tracks) return project;
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
    const existing = layerRootMotionClip(layer);
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
    return this.commitLayerClip(
      project,
      shot.id,
      layer.id,
      {
        ...existing,
        tracks: nextTracks,
      },
      [input.toTimeMs],
    );
  }

  /** Paste a frozen sparse pose snapshot captured at Copy time onto `input.timeMs`. */
  pastePoseSnapshot(
    project: Project,
    input: LayerKeyTimeInput,
    pose: Partial<LayerMotionValues>,
  ): Project {
    const { shot, layer } = assertMutableLayerContext(
      project,
      input.shotId,
      input.layerId,
    );
    assertValidFrame(shot, input.timeMs);
    validateMotionPatch(pose);
    const existing = layerRootMotionClip(layer);
    const clip = existing
      ? structuredClone(existing)
      : createLayerAnimationClip(project, shot.id, layer.id);
    const nextTracks = pasteTargetKeySnapshotAtTime(
      clip.tracks,
      layerTargetRef(layer.id),
      shot.durationMs,
      input.timeMs,
      pose,
    );
    if (existing && nextTracks === clip.tracks) return project;
    return this.commitLayerClip(
      project,
      shot.id,
      layer.id,
      {
        ...clip,
        tracks: nextTracks,
      },
      [input.timeMs],
    );
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
    extraCheckTimesMs: readonly number[] = [],
  ): Project {
    const nextProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id !== layerId ? layer : findLayerMotionGraphic(project, layer)
                  ? { ...layer, animationClip: clip }
                  : { ...layer, layerMotionTracks: clip.tracks },
              ),
            }
          : shot,
      ),
    });
    const nextShot = nextProject.shots.find((shot) => shot.id === shotId)!;
    const nextLayer = nextShot.layers.find((layer) => layer.id === layerId)!;
    assertLayerClipFinalScalesInBounds(
      nextShot,
      nextLayer,
      nextProject,
      extraCheckTimesMs,
    );
    return nextProject;
  }
}
