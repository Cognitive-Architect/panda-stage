import { CHARACTER_PART_MAX_SCALE, CHARACTER_PART_MIN_SCALE } from '../constants';
import {
  applyTargetKeyMoves,
  compositeKeyTimesForTarget,
  deleteTargetKeyAtTime,
  evaluateTargetMotionValues,
  hasTargetOutgoingInterval,
  NEUTRAL_ANIMATION_MOTION,
  pasteTargetKeySnapshotAtTime,
  planTargetKeysRetime,
  setTargetKeyEasing,
  targetCompositeKeyEasing,
  upsertTargetKeyValues,
  type TargetRetimePolicy,
} from '../animation-track-ops';
import {
  characterFaceAndMouthPartIds,
  createCharacterPartAnimationClip,
} from '../character-part-animation';
import { evaluateAnimationTrackAtTime } from '../evaluate-animation-core';
import {
  CharacterPoseAnimationClipV0Schema,
  AnimationInterpolationSchema,
  type AnimationClipV0,
  type AnimationInterpolation,
  type AnimationProperty,
  type CharacterPartTargetRef,
} from '../models/animationCore';
import { ProjectSchema, type Project } from '../models/project';
import { CharacterService } from './CharacterService';
import {
  resolveCharacterActionInstanceEditForInput,
  writeCharacterActionInstanceValues,
  type CharacterActionInstanceEdit,
} from './CharacterActionCopyService';
import {
  characterPartSourceBounds,
  characterPartTransformFromStaticAdjustment,
} from '../geometry/characterPartLayout';
import {
  isValidFrameTime,
  lastValidFrameTime,
} from '../timeline/frame-grid';

export const NEUTRAL_CHARACTER_MOTION = { ...NEUTRAL_ANIMATION_MOTION };
export const CHARACTER_MOTION_PROPERTIES: readonly AnimationProperty[] = [
  'transform.offsetX',
  'transform.offsetY',
  'transform.rotationDeg',
  'transform.scaleX',
  'transform.scaleY',
];
export type CharacterMotionValues = Record<AnimationProperty, number>;
export interface CharacterMotionInput {
  shotId: string; layerId: string; partId: string; timeMs: number; autoKey: boolean;
  /**
   * Optional explicit instance-copy edit context. When omitted the service
   * resolves the active instance-scoped action copy from the project itself.
   */
  actionEdit?: CharacterActionInstanceEdit;
}
export interface CharacterMotionKeyTargetInput {
  shotId: string; layerId: string; partId: string;
}
export interface CharacterMotionBatchRetimeMove {
  fromTimeMs: number;
  toTimeMs: number;
}
export interface CharacterMotionBatchRetimePlan {
  changed: boolean;
  moves: readonly CharacterMotionBatchRetimeMove[];
}
export type CharacterMotionBatchRetimeInput = CharacterMotionKeyTargetInput & {
  fromTimesMs: readonly number[];
} & (
  | { deltaMs: number; deltaFrames?: never }
  | { deltaFrames: number; deltaMs?: never }
);

export const CHARACTER_RETIME_POLICY: TargetRetimePolicy = {
  disallowCrossingUnselected: true,
  messages: {
    emptySelection: '请先选择要移动的动作关键帧。',
    duplicateSource: '存在重复的源动作关键帧时间。',
    sourceZeroProtected: '0 秒基础姿势关键帧不可移动。',
    targetZeroProtected: '关键帧不能移动到 0 秒基础姿势位置。',
    invalidSourceGrid: '源关键帧时间必须在项目帧网格上。',
    invalidTargetGrid: '目标时间必须在项目帧网格上。',
    missingSource: '找不到要移动的动作关键帧。',
    duplicateTarget: '批量移动后关键帧时间发生重叠。',
    outOfShot: '目标时间不能超出镜头时长。',
    collision: '目标时间已存在动作关键帧。',
    crossUnselected: '动作关键帧不能越过未选中的相邻关键帧。',
  },
};

function partTargetRef(layerId: string, partId: string): CharacterPartTargetRef {
  return { kind: 'character-part', layerId, partId };
}

function context(project: Project, input: CharacterMotionInput) {
  const shot = project.shots.find(s => s.id === input.shotId);
  const layer = shot?.layers.find(l => l.id === input.layerId);
  if (!shot || !layer || layer.source.kind !== 'character') throw new Error('请选择角色部件。');
  const characterId = layer.source.characterId;
  const character = project.characters.find(c => c.id === characterId);
  if (!character || character.mode !== 'adaptive-parts') throw new Error('请选择拆分角色。');
  return { shot, layer, character };
}

export function characterMotionValues(project: Project, input: CharacterMotionInput): CharacterMotionValues {
  const { layer, character } = context(project, input);
  if (!input.autoKey) {
    const part = character.parts.find(p => p.partId === input.partId);
    if (!part) throw new Error('角色默认姿势中已没有此部件。');
    const adjustment = part.staticAdjustment;
    return {
      'transform.offsetX': adjustment?.offsetX ?? 0, 'transform.offsetY': adjustment?.offsetY ?? 0,
      'transform.rotationDeg': adjustment?.rotationDeg ?? 0,
      'transform.scaleX': adjustment?.scale ?? 1, 'transform.scaleY': adjustment?.scale ?? 1,
    };
  }
  const values = evaluateTargetMotionValues(
    (layer.animationClip?.version === 1 ? layer.animationClip.tracks : []),
    partTargetRef(layer.id, input.partId),
    input.timeMs,
  );
  // Instance-scoped copies are the only edit target inside an action segment:
  // their tracks are appended after base values by the shared evaluator.
  // Protected face/mouth Parts are excluded exactly like layered-action playback.
  const actionEdit = resolveCharacterActionInstanceEditForInput(project, input);
  if (!actionEdit || characterFaceAndMouthPartIds(character).has(input.partId)) {
    return values;
  }
  for (const track of actionEdit.action.tracks) {
    if (track.partId !== input.partId) continue;
    values[track.property] = evaluateAnimationTrackAtTime(track, actionEdit.localTimeMs);
  }
  return values;
}

/** UI aggregation only: no Composite Key data is ever persisted. */
export function characterCompositeKeyTimes(layer: Project['shots'][number]['layers'][number], partId: string): number[] {
  return compositeKeyTimesForTarget(
    (layer.animationClip?.version === 1 ? layer.animationClip.tracks : []),
    partTargetRef(layer.id, partId),
  );
}

/** True when this Part has authored animation beyond a neutral 0 ms key. */
export function hasAuthoredCharacterPartMotion(
  layer: Project['shots'][number]['layers'][number] | undefined,
  partId: string,
): boolean {
  return Boolean(
    layer?.animationClip?.version === 1 && layer.animationClip.tracks.some(
      (track) =>
        track.target.kind === 'character-part' &&
        track.target.partId === partId &&
        (track.keys.length > 1 ||
          track.keys.some(
            (key) =>
              key.value !== NEUTRAL_CHARACTER_MOTION[track.property] ||
              key.interpolationToNext !== 'linear',
          )),
    ),
  );
}

/** True when at least one Property Track has a real outgoing interval starting at `timeMs`. */
export function hasCompositeKeyOutgoingInterval(
  layer: Project['shots'][number]['layers'][number] | undefined,
  partId: string,
  timeMs: number,
): boolean {
  if (!layer) return false;
  return hasTargetOutgoingInterval(
    (layer.animationClip?.version === 1 ? layer.animationClip.tracks : []),
    partTargetRef(layer.id, partId),
    timeMs,
  );
}

/** Shared outgoing interpolation across real outgoing Property intervals at `timeMs`, or null if none or mixed. */
export function characterCompositeKeyEasing(
  layer: Project['shots'][number]['layers'][number] | undefined,
  partId: string,
  timeMs: number,
): AnimationInterpolation | null {
  if (!layer) return null;
  return targetCompositeKeyEasing(
    (layer.animationClip?.version === 1 ? layer.animationClip.tracks : []),
    partTargetRef(layer.id, partId),
    timeMs,
  );
}

function replaceLayerAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
  clip: AnimationClipV0,
): Project {
  const validatedClip = CharacterPoseAnimationClipV0Schema.parse(clip);
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

function requireEditableClipContext(project: Project, input: CharacterMotionKeyTargetInput) {
  const { shot, layer, character } = context(project, { ...input, timeMs: 0, autoKey: true });
  if (layer.locked) throw new Error('角色图层已锁定。');
  return { shot, layer, character };
}

/** Thin Property Track facade, adapted from #979 set-key semantics. */
export class CharacterMotionService {
  apply(project: Project, input: CharacterMotionInput, changes: Partial<CharacterMotionValues>): Project {
    const { shot, layer, character } = context(project, input);
    if (layer.locked) throw new Error('角色图层已锁定。');
    if (!isValidFrameTime(input.timeMs) || input.timeMs > shot.durationMs) throw new Error('请选择镜头内的有效帧。');
    const actionEdit = resolveCharacterActionInstanceEditForInput(project, input);
    const current = characterMotionValues(project, input);
    const properties = (Object.keys(changes) as AnimationProperty[]).filter(property => changes[property] !== current[property]);
    if (!properties.length) return project;
    if (!input.autoKey) {
      if (actionEdit) throw new Error('当前动作段使用独立副本，请开启自动关键帧后再调整姿势。');
      const part = character.parts.find(p => p.partId === input.partId);
      if (!part) throw new Error('角色默认姿势中已没有此部件。');
      const values = { ...current, ...changes };
      if (values['transform.scaleX'] !== values['transform.scaleY']) throw new Error('静态姿势仅支持等比缩放。');
      const adjustment = {
        offsetX: values['transform.offsetX'], offsetY: values['transform.offsetY'],
        rotationDeg: ((values['transform.rotationDeg'] + 180) % 360 + 360) % 360 - 180,
        scale: values['transform.scaleX'],
      };
      const bounds = characterPartSourceBounds(part, project.animations, project.assets);
      if (!bounds) throw new Error('无法读取部件源尺寸。');
      const sourceRestTransform = part.sourceRestTransform ?? part.restTransform;
      return new CharacterService().updateAdaptivePart(project, character.id, part.partId, {
        sourceRestTransform, staticAdjustment: adjustment,
        restTransform: characterPartTransformFromStaticAdjustment(character.sourceRootTransform, sourceRestTransform, bounds, adjustment),
      });
    }
    if (actionEdit) {
      const writable: Partial<Record<AnimationProperty, number>> = {};
      for (const property of properties) writable[property] = changes[property];
      return writeCharacterActionInstanceValues(
        project,
        actionEdit,
        input.partId,
        writable,
      );
    }
    const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
    const basis = clip.targetBases.find(b => b.target.partId === input.partId);
    if (!basis || !basis.visible) throw new Error('无法编辑此动画部件。');
    const nextTracks = upsertTargetKeyValues(clip.tracks, basis.target, input.timeMs, changes);
    if (nextTracks === clip.tracks) return project;
    clip.tracks = nextTracks;
    return replaceLayerAnimationClip(project, shot.id, layer.id, clip);
  }

  /** Delete all Property Keys for this Part at a non-0ms Composite Key time. */
  deleteCompositeKey(project: Project, input: CharacterMotionKeyTargetInput & { timeMs: number }): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    if (input.timeMs === 0) throw new Error('0 秒基础姿势关键帧不可删除。');
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要删除的动作关键帧。');
    const nextTracks = deleteTargetKeyAtTime(
      clip.tracks,
      partTargetRef(layer.id, input.partId),
      input.timeMs,
      {
        protectedBaseMessage: '0 秒基础姿势关键帧不可删除。',
        missingMessage: '找不到要删除的动作关键帧。',
      },
    );
    return replaceLayerAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Atomically move all Property Keys for this Part at `fromTimeMs` to `toTimeMs`. */
  retimeCompositeKey(
    project: Project,
    input: CharacterMotionKeyTargetInput & { fromTimeMs: number; toTimeMs: number },
  ): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.fromTimeMs)) throw new Error('源关键帧时间必须在项目帧网格上。');
    if (!isValidFrameTime(input.toTimeMs)) throw new Error('目标时间必须在项目帧网格上。');
    if (input.fromTimeMs === 0) throw new Error('0 秒基础姿势关键帧不可移动。');
    if (input.toTimeMs === 0) throw new Error('关键帧不能移动到 0 秒基础姿势位置。');

    const target = partTargetRef(layer.id, input.partId);
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要移动的动作关键帧。');
    const plan = planTargetKeysRetime(
      clip.tracks,
      target,
      shot.durationMs,
      { fromTimesMs: [input.fromTimeMs], deltaMs: input.toTimeMs - input.fromTimeMs },
      CHARACTER_RETIME_POLICY,
    );
    if (!plan.changed) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: applyTargetKeyMoves(clip.tracks, target, plan.moves),
    });
  }

  /** Plan an atomic multi-key shift on one Part, rejecting the whole batch on any invalid candidate. */
  planCompositeKeysRetime(
    project: Project,
    input: CharacterMotionBatchRetimeInput,
  ): CharacterMotionBatchRetimePlan {
    const { shot, layer } = requireEditableClipContext(project, input);
    const plan = planTargetKeysRetime(
      (layer.animationClip?.version === 1 ? layer.animationClip.tracks : []),
      partTargetRef(layer.id, input.partId),
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

  /** Atomically shift multiple selected Composite Keys on the same Part once with full-batch validation. */
  retimeCompositeKeys(project: Project, input: CharacterMotionBatchRetimeInput): Project {
    const plan = this.planCompositeKeysRetime(project, input);
    if (!plan.changed) return project;
    const { shot, layer } = requireEditableClipContext(project, input);
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要移动的动作关键帧。');
    const nextTracks = applyTargetKeyMoves(
      clip.tracks,
      partTargetRef(layer.id, input.partId),
      plan.moves,
    );
    return replaceLayerAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Atomically write/update all 5 transform Property Tracks at `targetTimeMs` from a copied pose. */
  pasteCompositePose(
    project: Project,
    input: CharacterMotionKeyTargetInput & { targetTimeMs: number; pose: CharacterMotionValues },
  ): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.targetTimeMs) || input.targetTimeMs > lastValidFrameTime(shot.durationMs)) {
      throw new Error('请先将播放头移到镜头内的有效帧。');
    }
    for (const property of CHARACTER_MOTION_PROPERTIES) {
      const value = input.pose[property];
      if (!Number.isFinite(value)) throw new Error('复制的姿势数值无效。');
      if (
        (property === 'transform.scaleX' || property === 'transform.scaleY') &&
        (value < CHARACTER_PART_MIN_SCALE || value > CHARACTER_PART_MAX_SCALE)
      ) {
        throw new Error(`缩放范围为 ${CHARACTER_PART_MIN_SCALE * 100}%～${CHARACTER_PART_MAX_SCALE * 100}%。`);
      }
    }

    const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
    const basis = clip.targetBases.find((candidate) => candidate.target.partId === input.partId);
    if (!basis || !basis.visible) throw new Error('无法编辑此动画部件。');

    const nextTracks = pasteTargetKeySnapshotAtTime(
      clip.tracks,
      basis.target,
      shot.durationMs,
      input.targetTimeMs,
      input.pose,
      { invalidFrameMessage: '请先将播放头移到镜头内的有效帧。' },
    );
    if (layer.animationClip && nextTracks === clip.tracks) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }

  /** Set outgoing interpolation only on Property Keys at `timeMs` that actually have a next key. */
  setCompositeKeyEasing(
    project: Project,
    input: CharacterMotionKeyTargetInput & { timeMs: number; interpolationToNext: AnimationInterpolation },
  ): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    const easing = AnimationInterpolationSchema.parse(input.interpolationToNext);
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    const compositeTimes = characterCompositeKeyTimes(layer, input.partId);
    if (!clip || !compositeTimes.includes(input.timeMs)) {
      throw new Error('找不到要修改补间的动作关键帧。');
    }
    const nextTracks = setTargetKeyEasing(
      clip.tracks,
      partTargetRef(layer.id, input.partId),
      input.timeMs,
      easing,
      { missingOutgoingMessage: '当前关键帧没有可修改的补间区间。' },
    );
    if (nextTracks === clip.tracks) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, {
      ...clip,
      tracks: nextTracks,
    });
  }
}
