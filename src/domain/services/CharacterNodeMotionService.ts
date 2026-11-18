import { CHARACTER_PART_MAX_SCALE, CHARACTER_PART_MIN_SCALE } from '../constants';
import {
  applyTargetKeyMoves,
  compositeKeyTimesForTarget,
  deleteTargetKeyAtTime,
  evaluateTargetMotionValues,
  NEUTRAL_ANIMATION_MOTION,
  pasteTargetKeySnapshotAtTime,
  planTargetKeysRetime,
  setTargetKeyEasing,
  targetCompositeKeyEasing,
  hasTargetOutgoingInterval,
  upsertTargetKeyValues,
  type AnimationMotionValues,
} from '../animation-track-ops';
import {
  backSolveCharacterNodeRelativeMotion,
  characterNodeTargetRef,
  characterNodeTransformCapabilities,
  composeCharacterNodeTransform,
  createCharacterNodeBasisForFace,
  createCharacterNodeFaceAnimationClip,
  evaluateCompositeFacePoseAtTime,
  resolveCharacterNodeBasis,
  type EvaluatedCharacterNodePose,
} from '../character-node-animation';
import { layerPivotStageVector } from '../layer-animation';
import {
  AnimationInterpolationSchema,
  CharacterNodeAnimationClipSchema,
  sameAnimationTarget,
  type AnimationInterpolation,
  type AnimationProperty,
  type CharacterNodeAnimationClip,
  type CharacterNodeId,
} from '../models/animationCore';
import type { Character } from '../models/character';
import type { Layer } from '../models/layer';
import { ProjectSchema, type Project } from '../models/project';
import type { Shot } from '../models/shot';
import { isValidFrameTime, lastValidFrameTime } from '../timeline/frame-grid';
import {
  CHARACTER_RETIME_POLICY,
  type CharacterMotionValues,
} from './CharacterMotionService';
import { CharacterService } from './CharacterService';

const FACE_MOTION_PROPERTIES: readonly AnimationProperty[] = [
  'transform.offsetX',
  'transform.offsetY',
  'transform.rotationDeg',
  'transform.scaleX',
  'transform.scaleY',
];
const RELATIVE_SCALE_EPSILON = 1e-9;

export interface CharacterNodeMotionInput {
  shotId: string;
  layerId: string;
  nodeId: CharacterNodeId;
  timeMs: number;
  autoKey: boolean;
}

export interface CharacterNodeMotionKeyTargetInput {
  shotId: string;
  layerId: string;
  nodeId: CharacterNodeId;
}

export interface CharacterNodeMotionBatchRetimeMove {
  fromTimeMs: number;
  toTimeMs: number;
}

export interface CharacterNodeMotionBatchRetimePlan {
  changed: boolean;
  moves: readonly CharacterNodeMotionBatchRetimeMove[];
}

export type CharacterNodeMotionBatchRetimeInput = CharacterNodeMotionKeyTargetInput & {
  fromTimesMs: readonly number[];
} & (
  | { deltaMs: number; deltaFrames?: never }
  | { deltaFrames: number; deltaMs?: never }
);

export interface CharacterNodeMotionScaleBounds {
  readonly min: number;
  readonly max: number;
}

function normalizeStaticRotationDeg(rotationDeg: number): number {
  const wrapped = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
  // Preserve +180 boundary instead of jumping to -180 when exact +/-180 is edited.
  return rotationDeg > 0 && wrapped === -180 ? 180 : wrapped;
}

function snapRelativeScale(value: number): number {
  if (Math.abs(value - CHARACTER_PART_MIN_SCALE) <= RELATIVE_SCALE_EPSILON) {
    return CHARACTER_PART_MIN_SCALE;
  }
  if (Math.abs(value - CHARACTER_PART_MAX_SCALE) <= RELATIVE_SCALE_EPSILON) {
    return CHARACTER_PART_MAX_SCALE;
  }
  return value;
}

function formatPercent(value: number): string {
  const pct = Math.round(value * 100 * 100) / 100;
  return Number.isInteger(pct) ? String(pct) : String(pct);
}

function valuesFromPose(pose: EvaluatedCharacterNodePose): CharacterMotionValues {
  return {
    'transform.offsetX': pose.offsetX,
    'transform.offsetY': pose.offsetY,
    'transform.rotationDeg': pose.rotationDeg,
    'transform.scaleX': pose.scaleX,
    'transform.scaleY': pose.scaleY,
  };
}

function resolveCompositeFaceContext(
  project: Project,
  input: Pick<CharacterNodeMotionInput, 'shotId' | 'layerId' | 'nodeId'>,
): {
  shot: Shot;
  layer: Layer;
  character: Extract<Character, { mode: 'composite' }>;
} {
  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === input.layerId);
  if (!shot || !layer || layer.source.kind !== 'character') {
    throw new Error('请选择角色图层。');
  }
  const characterId = layer.source.characterId;
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character || character.mode !== 'composite') {
    throw new Error('脸部节点动作仅支持组合角色。');
  }
  const caps = characterNodeTransformCapabilities(character, input.nodeId);
  if (!caps.position && !caps.rotation && !caps.uniformScale) {
    throw new Error('当前仅支持编辑组合角色的脸部节点动作。');
  }
  return { shot, layer, character };
}

function requireEditableNodeClipContext(
  project: Project,
  input: CharacterNodeMotionKeyTargetInput,
) {
  const resolved = resolveCompositeFaceContext(project, input);
  if (resolved.layer.locked) {
    throw new Error('角色图层已锁定。');
  }
  return resolved;
}

function replaceLayerNodeAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
  clip: CharacterNodeAnimationClip,
): Project {
  const validatedClip = CharacterNodeAnimationClipSchema.parse(clip);
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId
        ? {
            ...shot,
            layers: shot.layers.map((layer) =>
              layer.id === layerId ? { ...layer, animationClip: validatedClip } : layer,
            ),
          }
        : shot,
    ),
  });
}

function activeClipBasisForFace(
  layer: Layer,
  character: Extract<Character, { mode: 'composite' }>,
) {
  const target = characterNodeTargetRef(layer.id, 'face');
  const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
  return (
    (clip ? resolveCharacterNodeBasis(clip, target) : undefined) ??
    createCharacterNodeBasisForFace(character, layer.id)
  );
}

/**
 * UI/authoring face values for Inspector & Canvas:
 * - `autoKey === false`: static `character.facePlacement`
 * - `autoKey === true`: evaluated face pose at `input.timeMs`
 */
export function characterNodeMotionValues(
  project: Project,
  input: CharacterNodeMotionInput,
): CharacterMotionValues {
  const { layer, character } = resolveCompositeFaceContext(project, input);
  if (!input.autoKey) {
    return {
      'transform.offsetX': character.facePlacement.offsetX,
      'transform.offsetY': character.facePlacement.offsetY,
      'transform.rotationDeg': character.facePlacement.rotationDeg,
      'transform.scaleX': character.facePlacement.scale,
      'transform.scaleY': character.facePlacement.scale,
    };
  }
  const pose = evaluateCompositeFacePoseAtTime(project, layer, input.timeMs);
  if (!pose) {
    throw new Error('无法读取脸部节点姿势。');
  }
  return valuesFromPose(pose);
}

/** Read raw relative Clip v3 Property Track values at `input.timeMs`. */
export function characterNodeRelativeMotionValues(
  project: Project,
  input: Pick<CharacterNodeMotionInput, 'shotId' | 'layerId' | 'nodeId' | 'timeMs'>,
): CharacterMotionValues {
  const { layer } = resolveCompositeFaceContext(project, input);
  const tracks = layer.animationClip?.version === 3 ? layer.animationClip.tracks : [];
  return evaluateTargetMotionValues(
    tracks,
    characterNodeTargetRef(layer.id, input.nodeId),
    input.timeMs,
  );
}

/** Evaluated scale multiplier bounds allowed by the current mode and persisted Basis. */
export function characterNodeMotionScaleBounds(
  project: Project,
  input: Pick<CharacterNodeMotionInput, 'shotId' | 'layerId' | 'nodeId' | 'autoKey'>,
): CharacterNodeMotionScaleBounds {
  const { layer, character } = resolveCompositeFaceContext(project, input);
  if (!input.autoKey) {
    return { min: CHARACTER_PART_MIN_SCALE, max: CHARACTER_PART_MAX_SCALE };
  }
  const basis = activeClipBasisForFace(layer, character);
  return {
    min: basis.baseTransform.scaleX * CHARACTER_PART_MIN_SCALE,
    max: basis.baseTransform.scaleX * CHARACTER_PART_MAX_SCALE,
  };
}

/** Reset values in the same UI value space as `characterNodeMotionValues`. */
export function characterNodeMotionResetValues(
  project: Project,
  input: Pick<CharacterNodeMotionInput, 'shotId' | 'layerId' | 'nodeId' | 'autoKey'>,
): CharacterMotionValues {
  const { layer, character } = resolveCompositeFaceContext(project, input);
  if (!input.autoKey) {
    return { ...NEUTRAL_ANIMATION_MOTION };
  }
  const basis = activeClipBasisForFace(layer, character);
  return valuesFromPose(
    composeCharacterNodeTransform(
      basis,
      { ...NEUTRAL_ANIMATION_MOTION },
      character.facePlacement.flipX,
    ),
  );
}

/** UI aggregation only: no Composite Key data is ever persisted. */
export function characterNodeCompositeKeyTimes(
  layer: Layer | undefined,
  nodeId: CharacterNodeId,
): number[] {
  if (!layer || layer.animationClip?.version !== 3) return [];
  return compositeKeyTimesForTarget(
    layer.animationClip.tracks,
    characterNodeTargetRef(layer.id, nodeId),
  );
}

/** True when this Character Node has authored Clip v3 motion beyond neutral 0 ms keys. */
export function hasAuthoredCharacterNodeMotion(
  layer: Layer | undefined,
  nodeId: CharacterNodeId,
): boolean {
  if (!layer || layer.animationClip?.version !== 3) return false;
  const target = characterNodeTargetRef(layer.id, nodeId);
  return layer.animationClip.tracks.some(
    (track) =>
      sameAnimationTarget(track.target, target) &&
      (track.keys.length > 1 ||
        track.keys.some(
          (key) =>
            key.value !== NEUTRAL_ANIMATION_MOTION[track.property] ||
            key.interpolationToNext !== 'linear',
        )),
  );
}

/** True when at least one Property Track for `nodeId` has a real outgoing interval at `timeMs`. */
export function hasCharacterNodeCompositeKeyOutgoingInterval(
  layer: Layer | undefined,
  nodeId: CharacterNodeId,
  timeMs: number,
): boolean {
  if (!layer || layer.animationClip?.version !== 3) return false;
  return hasTargetOutgoingInterval(
    layer.animationClip.tracks,
    characterNodeTargetRef(layer.id, nodeId),
    timeMs,
  );
}

/** Shared outgoing interpolation across real outgoing Property intervals at `timeMs`, or null. */
export function characterNodeCompositeKeyEasing(
  layer: Layer | undefined,
  nodeId: CharacterNodeId,
  timeMs: number,
): AnimationInterpolation | null {
  if (!layer || layer.animationClip?.version !== 3) return null;
  return targetCompositeKeyEasing(
    layer.animationClip.tracks,
    characterNodeTargetRef(layer.id, nodeId),
    timeMs,
  );
}

function normalizeUniformScaleChange(
  changes: Partial<CharacterMotionValues>,
): Partial<CharacterMotionValues> {
  const hasX = changes['transform.scaleX'] !== undefined;
  const hasY = changes['transform.scaleY'] !== undefined;
  if (!hasX && !hasY) return changes;
  if (hasX && hasY && changes['transform.scaleX'] !== changes['transform.scaleY']) {
    throw new Error('脸部节点仅支持等比缩放。');
  }
  const uniform = (hasX ? changes['transform.scaleX'] : changes['transform.scaleY'])!;
  return {
    ...changes,
    'transform.scaleX': uniform,
    'transform.scaleY': uniform,
  };
}

/**
 * Property-Track authoring adapter for Composite Face motion (Clip v3).
 * Delegates pure track operations to `animation-track-ops.ts`.
 */
export class CharacterNodeMotionService {
  apply(
    project: Project,
    input: CharacterNodeMotionInput,
    rawChanges: Partial<CharacterMotionValues>,
  ): Project {
    const { shot, layer, character } = resolveCompositeFaceContext(project, input);
    if (layer.locked) {
      throw new Error('角色图层已锁定。');
    }
    if (!isValidFrameTime(input.timeMs) || input.timeMs < 0 || input.timeMs > shot.durationMs) {
      throw new Error('请选择镜头内的有效帧。');
    }

    const changes = normalizeUniformScaleChange(rawChanges);
    const current = characterNodeMotionValues(project, input);
    const edited = FACE_MOTION_PROPERTIES.filter(
      (property) => changes[property] !== undefined && changes[property] !== current[property],
    );
    if (edited.length === 0) return project;

    if (!input.autoKey) {
      const nextValues = { ...current, ...changes };
      const scale = nextValues['transform.scaleX'];
      if (
        changes['transform.scaleX'] !== undefined &&
        (!Number.isFinite(scale) || scale < CHARACTER_PART_MIN_SCALE || scale > CHARACTER_PART_MAX_SCALE)
      ) {
        throw new Error(
          `缩放范围为 ${formatPercent(CHARACTER_PART_MIN_SCALE)}%～${formatPercent(CHARACTER_PART_MAX_SCALE)}%。`,
        );
      }
      return new CharacterService().setFacePlacement(project, character.id, {
        offsetX: nextValues['transform.offsetX'],
        offsetY: nextValues['transform.offsetY'],
        scale,
        rotationDeg: normalizeStaticRotationDeg(nextValues['transform.rotationDeg']),
        flipX: character.facePlacement.flipX,
      });
    }

    const clip = createCharacterNodeFaceAnimationClip(project, shot.id, layer.id);
    const target = characterNodeTargetRef(layer.id, input.nodeId);
    const basis = resolveCharacterNodeBasis(clip, target);
    if (!basis) {
      throw new Error('无法解析脸部节点动作基准。');
    }

    const relCurrent = evaluateTargetMotionValues(clip.tracks, target, input.timeMs);
    const currentPose = composeCharacterNodeTransform(
      basis,
      relCurrent,
      character.facePlacement.flipX,
    );
    const relChanges = backSolveCharacterNodeRelativeMotion(
      basis,
      character.facePlacement.flipX,
      relCurrent,
      currentPose,
      {
        ...(changes['transform.offsetX'] !== undefined ? { offsetX: changes['transform.offsetX'] } : {}),
        ...(changes['transform.offsetY'] !== undefined ? { offsetY: changes['transform.offsetY'] } : {}),
        ...(changes['transform.rotationDeg'] !== undefined ? { rotationDeg: changes['transform.rotationDeg'] } : {}),
        ...(changes['transform.scaleX'] !== undefined ? { scaleX: changes['transform.scaleX'] } : {}),
        ...(changes['transform.scaleY'] !== undefined ? { scaleY: changes['transform.scaleY'] } : {}),
      },
    );

    const validatedRelChanges: Partial<AnimationMotionValues> = { ...relChanges };
    for (const prop of ['transform.scaleX', 'transform.scaleY'] as const) {
      const rawRelScale = validatedRelChanges[prop];
      if (rawRelScale === undefined) continue;
      const snapped = snapRelativeScale(rawRelScale);
      if (
        !Number.isFinite(snapped) ||
        snapped < CHARACTER_PART_MIN_SCALE ||
        snapped > CHARACTER_PART_MAX_SCALE
      ) {
        const bounds = {
          min: basis.baseTransform.scaleX * CHARACTER_PART_MIN_SCALE,
          max: basis.baseTransform.scaleX * CHARACTER_PART_MAX_SCALE,
        };
        throw new Error(
          `脸部缩放范围为 ${formatPercent(bounds.min)}%～${formatPercent(bounds.max)}%。`,
        );
      }
      validatedRelChanges[prop] = snapped;
    }

    const nextTracks = upsertTargetKeyValues(
      clip.tracks,
      target,
      input.timeMs,
      validatedRelChanges,
    );
    if (nextTracks === clip.tracks) return project;
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Delete all Property Keys for this Character Node at a non-0ms Composite Key time. */
  deleteCompositeKey(
    project: Project,
    input: CharacterNodeMotionKeyTargetInput & { timeMs: number },
  ): Project {
    const { shot, layer } = requireEditableNodeClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    if (input.timeMs === 0) throw new Error('0 秒基础姿势关键帧不可删除。');
    const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要删除的动作关键帧。');
    const nextTracks = deleteTargetKeyAtTime(
      clip.tracks,
      characterNodeTargetRef(layer.id, input.nodeId),
      input.timeMs,
      {
        protectedBaseMessage: '0 秒基础姿势关键帧不可删除。',
        missingMessage: '找不到要删除的动作关键帧。',
      },
    );
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Atomically move all Property Keys for this Character Node at `fromTimeMs` to `toTimeMs`. */
  retimeCompositeKey(
    project: Project,
    input: CharacterNodeMotionKeyTargetInput & { fromTimeMs: number; toTimeMs: number },
  ): Project {
    const { shot, layer } = requireEditableNodeClipContext(project, input);
    if (!isValidFrameTime(input.fromTimeMs)) {
      throw new Error('源关键帧时间必须在项目帧网格上。');
    }
    if (!isValidFrameTime(input.toTimeMs)) {
      throw new Error('目标时间必须在项目帧网格上。');
    }
    if (input.fromTimeMs === 0) {
      throw new Error('0 秒基础姿势关键帧不可移动。');
    }
    if (input.toTimeMs === 0) {
      throw new Error('关键帧不能移动到 0 秒基础姿势位置。');
    }
    const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要移动的动作关键帧。');
    const target = characterNodeTargetRef(layer.id, input.nodeId);
    const plan = planTargetKeysRetime(
      clip.tracks,
      target,
      shot.durationMs,
      { fromTimesMs: [input.fromTimeMs], deltaMs: input.toTimeMs - input.fromTimeMs },
      CHARACTER_RETIME_POLICY,
    );
    if (!plan.changed) return project;
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: applyTargetKeyMoves(clip.tracks, target, plan.moves),
    });
  }

  /** Plan an atomic multi-key shift on this Character Node, rejecting the whole batch on invalid target. */
  planCompositeKeysRetime(
    project: Project,
    input: CharacterNodeMotionBatchRetimeInput,
  ): CharacterNodeMotionBatchRetimePlan {
    const { shot, layer } = requireEditableNodeClipContext(project, input);
    const plan = planTargetKeysRetime(
      layer.animationClip?.version === 3 ? layer.animationClip.tracks : [],
      characterNodeTargetRef(layer.id, input.nodeId),
      shot.durationMs,
      {
        fromTimesMs: input.fromTimesMs,
        ...(input.deltaFrames !== undefined
          ? { deltaFrames: input.deltaFrames }
          : { deltaMs: input.deltaMs }),
      },
      CHARACTER_RETIME_POLICY,
    );
    return { changed: plan.changed, moves: plan.moves };
  }

  /** Atomically shift multiple selected Composite Keys on this Character Node. */
  retimeCompositeKeys(
    project: Project,
    input: CharacterNodeMotionBatchRetimeInput,
  ): Project {
    const plan = this.planCompositeKeysRetime(project, input);
    if (!plan.changed) return project;
    const { shot, layer } = requireEditableNodeClipContext(project, input);
    const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要移动的动作关键帧。');
    const nextTracks = applyTargetKeyMoves(
      clip.tracks,
      characterNodeTargetRef(layer.id, input.nodeId),
      plan.moves,
    );
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Atomically write/update all 5 transform Property Tracks at `targetTimeMs` from a copied evaluated pose. */
  pasteCompositePose(
    project: Project,
    input: CharacterNodeMotionKeyTargetInput & {
      targetTimeMs: number;
      pose: CharacterMotionValues;
    },
  ): Project {
    const { shot, layer, character } = requireEditableNodeClipContext(project, input);
    if (
      !isValidFrameTime(input.targetTimeMs) ||
      input.targetTimeMs < 0 ||
      input.targetTimeMs > lastValidFrameTime(shot.durationMs)
    ) {
      throw new Error('请先将播放头移到镜头内的有效帧。');
    }
    for (const property of FACE_MOTION_PROPERTIES) {
      if (!Number.isFinite(input.pose[property])) {
        throw new Error('复制的姿势数值无效。');
      }
    }
    if (input.pose['transform.scaleX'] !== input.pose['transform.scaleY']) {
      throw new Error('脸部节点仅支持等比缩放。');
    }

    const clip = createCharacterNodeFaceAnimationClip(project, shot.id, layer.id);
    const target = characterNodeTargetRef(layer.id, input.nodeId);
    const basis = resolveCharacterNodeBasis(clip, target);
    if (!basis) {
      throw new Error('无法解析脸部节点动作基准。');
    }

    const flipX = character.facePlacement.flipX;
    const localPivot = { x: basis.pivot.x, y: basis.pivot.y };
    const vBase = layerPivotStageVector(
      localPivot,
      basis.baseTransform.rotationDeg,
      basis.baseTransform.scaleX,
      basis.baseTransform.scaleY,
      flipX,
    );
    const vFinal = layerPivotStageVector(
      localPivot,
      input.pose['transform.rotationDeg'],
      input.pose['transform.scaleX'],
      input.pose['transform.scaleY'],
      flipX,
    );

    const relScaleX = snapRelativeScale(
      input.pose['transform.scaleX'] / basis.baseTransform.scaleX,
    );
    const relScaleY = snapRelativeScale(
      input.pose['transform.scaleY'] / basis.baseTransform.scaleY,
    );
    if (
      relScaleX < CHARACTER_PART_MIN_SCALE ||
      relScaleX > CHARACTER_PART_MAX_SCALE ||
      relScaleY < CHARACTER_PART_MIN_SCALE ||
      relScaleY > CHARACTER_PART_MAX_SCALE
    ) {
      const bounds = {
        min: basis.baseTransform.scaleX * CHARACTER_PART_MIN_SCALE,
        max: basis.baseTransform.scaleX * CHARACTER_PART_MAX_SCALE,
      };
      throw new Error(
        `脸部缩放范围为 ${formatPercent(bounds.min)}%～${formatPercent(bounds.max)}%。`,
      );
    }

    const relPose: AnimationMotionValues = {
      'transform.offsetX':
        input.pose['transform.offsetX'] - basis.baseTransform.x - vBase.x + vFinal.x,
      'transform.offsetY':
        input.pose['transform.offsetY'] - basis.baseTransform.y - vBase.y + vFinal.y,
      'transform.rotationDeg':
        input.pose['transform.rotationDeg'] - basis.baseTransform.rotationDeg,
      'transform.scaleX': relScaleX,
      'transform.scaleY': relScaleY,
    };

    const nextTracks = pasteTargetKeySnapshotAtTime(
      clip.tracks,
      target,
      shot.durationMs,
      input.targetTimeMs,
      relPose,
      { invalidFrameMessage: '请先将播放头移到镜头内的有效帧。' },
    );
    if (layer.animationClip && nextTracks === clip.tracks) return project;
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Set outgoing interpolation only on Property Keys at `timeMs` that actually have a next key. */
  setCompositeKeyEasing(
    project: Project,
    input: CharacterNodeMotionKeyTargetInput & {
      timeMs: number;
      interpolationToNext: AnimationInterpolation;
    },
  ): Project {
    const { shot, layer } = requireEditableNodeClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    const easing = AnimationInterpolationSchema.parse(input.interpolationToNext);
    const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
    const compositeTimes = characterNodeCompositeKeyTimes(layer, input.nodeId);
    if (!clip || !compositeTimes.includes(input.timeMs)) {
      throw new Error('找不到要修改补间的动作关键帧。');
    }
    const nextTracks = setTargetKeyEasing(
      clip.tracks,
      characterNodeTargetRef(layer.id, input.nodeId),
      input.timeMs,
      easing,
      { missingOutgoingMessage: '当前关键帧没有可修改的补间区间。' },
    );
    if (nextTracks === clip.tracks) return project;
    return replaceLayerNodeAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }
}
