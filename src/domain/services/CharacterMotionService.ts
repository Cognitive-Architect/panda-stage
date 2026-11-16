import { CHARACTER_PART_MAX_SCALE, CHARACTER_PART_MIN_SCALE } from '../constants';
import { createCharacterPartAnimationClip } from '../character-part-animation';
import { evaluateAnimationTrackAtTime } from '../evaluate-animation-core';
import {
  AnimationClipV0Schema,
  AnimationInterpolationSchema,
  AnimationTrackSchema,
  type AnimationClipV0,
  type AnimationInterpolation,
  type AnimationProperty,
} from '../models/animationCore';
import { ProjectSchema, type Project } from '../models/project';
import { CharacterService } from './CharacterService';
import { characterPartSourceBounds, characterPartTransformFromStaticAdjustment } from '../geometry/characterPartLayout';
import { isValidFrameTime, lastValidFrameTime } from '../timeline/frame-grid';

export const NEUTRAL_CHARACTER_MOTION = {
  'transform.offsetX': 0, 'transform.offsetY': 0, 'transform.rotationDeg': 0,
  'transform.scaleX': 1, 'transform.scaleY': 1,
};
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
}
export interface CharacterMotionKeyTargetInput {
  shotId: string; layerId: string; partId: string;
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
  const values = { ...NEUTRAL_CHARACTER_MOTION };
  for (const track of layer.animationClip?.tracks ?? []) {
    if (track.target.partId === input.partId) values[track.property] = evaluateAnimationTrackAtTime(track, input.timeMs);
  }
  return values;
}

/** UI aggregation only: no Composite Key data is ever persisted. */
export function characterCompositeKeyTimes(layer: Project['shots'][number]['layers'][number], partId: string): number[] {
  return [...new Set(layer.animationClip?.tracks.filter(t => t.target.partId === partId).flatMap(t => t.keys.map(k => k.timeMs)) ?? [])].sort((a, b) => a - b);
}

/** True when this Part has authored animation beyond a neutral 0 ms key. */
export function hasAuthoredCharacterPartMotion(
  layer: Project['shots'][number]['layers'][number] | undefined,
  partId: string,
): boolean {
  return Boolean(
    layer?.animationClip?.tracks.some(
      (track) =>
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

/** Shared outgoing interpolation at a Composite Key time, or null if property tracks differ. */
export function characterCompositeKeyEasing(
  layer: Project['shots'][number]['layers'][number] | undefined,
  partId: string,
  timeMs: number,
): AnimationInterpolation | null {
  const easings = (layer?.animationClip?.tracks ?? [])
    .filter((track) => track.target.partId === partId)
    .flatMap((track) => track.keys.filter((key) => key.timeMs === timeMs).map((key) => key.interpolationToNext));
  if (easings.length === 0) return null;
  const first = easings[0]!;
  return easings.every((entry) => entry === first) ? first : null;
}

function replaceLayerAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
  clip: AnimationClipV0,
): Project {
  const validatedClip = AnimationClipV0Schema.parse(clip);
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
    const current = characterMotionValues(project, input);
    const properties = (Object.keys(changes) as AnimationProperty[]).filter(property => changes[property] !== current[property]);
    if (!properties.length) return project;
    if (!input.autoKey) {
      const part = character.parts.find(p => p.partId === input.partId);
      if (!part) throw new Error('角色默认姿势中已没有此部件。');
      const values = { ...current, ...changes };
      if (values['transform.scaleX'] !== values['transform.scaleY']) throw new Error('静态姿势仅支持等比缩放。');
      const adjustment = {
        offsetX: values['transform.offsetX'], offsetY: values['transform.offsetY'],
        rotationDeg: ((values['transform.rotationDeg'] + 180) % 360 + 360) % 360 - 180,
        scale: values['transform.scaleX'],
      };
      const bounds = characterPartSourceBounds(part, project.animations);
      if (!bounds) throw new Error('无法读取部件源尺寸。');
      const sourceRestTransform = part.sourceRestTransform ?? part.restTransform;
      return new CharacterService().updateAdaptivePart(project, character.id, part.partId, {
        sourceRestTransform, staticAdjustment: adjustment,
        restTransform: characterPartTransformFromStaticAdjustment(character.sourceRootTransform, sourceRestTransform, bounds, adjustment),
      });
    }
    const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
    const basis = clip.targetBases.find(b => b.target.partId === input.partId);
    if (!basis || !basis.visible) throw new Error('无法编辑此动画部件。');
    for (const property of properties) {
      const existing = clip.tracks.find(t => t.target.partId === input.partId && t.property === property);
      const keys = existing?.keys ?? [{ timeMs: 0, value: NEUTRAL_CHARACTER_MOTION[property], interpolationToNext: 'linear' as const }];
      const atTime = keys.find(k => k.timeMs === input.timeMs);
      const nextKey = { timeMs: input.timeMs, value: changes[property]!, interpolationToNext: atTime?.interpolationToNext ?? 'linear' as const };
      const track = AnimationTrackSchema.parse({ target: basis.target, property, keys: [...keys.filter(k => k.timeMs !== input.timeMs), nextKey].sort((a, b) => a.timeMs - b.timeMs) });
      clip.tracks = [...clip.tracks.filter(t => !(t.target.partId === input.partId && t.property === property)), track];
    }
    return replaceLayerAnimationClip(project, shot.id, layer.id, clip);
  }

  /** Delete all Property Keys for this Part at a non-0ms Composite Key time. */
  deleteCompositeKey(project: Project, input: CharacterMotionKeyTargetInput & { timeMs: number }): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    if (input.timeMs === 0) throw new Error('0 秒基础姿势关键帧不可删除。');
    const clip = layer.animationClip;
    const hasKeysAtTime = Boolean(
      clip?.tracks.some((track) => track.target.partId === input.partId && track.keys.some((key) => key.timeMs === input.timeMs)),
    );
    if (!clip || !hasKeysAtTime) throw new Error('找不到要删除的动作关键帧。');
    const nextClip: AnimationClipV0 = {
      ...clip,
      tracks: clip.tracks.map((track) =>
        track.target.partId === input.partId
          ? { ...track, keys: track.keys.filter((key) => key.timeMs !== input.timeMs) }
          : track,
      ),
    };
    return replaceLayerAnimationClip(project, shot.id, layer.id, nextClip);
  }

  /** Atomically move all Property Keys for this Part at `fromTimeMs` to `toTimeMs`. */
  retimeCompositeKey(
    project: Project,
    input: CharacterMotionKeyTargetInput & { fromTimeMs: number; toTimeMs: number },
  ): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.fromTimeMs)) throw new Error('源关键帧时间必须在项目帧网格上。');
    if (!isValidFrameTime(input.toTimeMs)) throw new Error('目标时间必须在项目帧网格上。');
    if (input.toTimeMs > lastValidFrameTime(shot.durationMs)) throw new Error('目标时间不能超出镜头时长。');
    if (input.fromTimeMs === 0) throw new Error('0 秒基础姿势关键帧不可移动。');
    if (input.toTimeMs === 0) throw new Error('关键帧不能移动到 0 秒基础姿势位置。');

    const clip = layer.animationClip;
    const compositeTimes = characterCompositeKeyTimes(layer, input.partId);
    const keyIndex = compositeTimes.indexOf(input.fromTimeMs);
    if (!clip || keyIndex < 0) throw new Error('找不到要移动的动作关键帧。');
    if (input.toTimeMs === input.fromTimeMs) return project;

    if (
      compositeTimes.includes(input.toTimeMs) ||
      clip.tracks.some((track) => track.target.partId === input.partId && track.keys.some((key) => key.timeMs === input.toTimeMs))
    ) {
      throw new Error('目标时间已存在动作关键帧。');
    }
    const previousTimeMs = compositeTimes[keyIndex - 1];
    const nextTimeMs = compositeTimes[keyIndex + 1];
    if (
      (previousTimeMs !== undefined && input.toTimeMs <= previousTimeMs) ||
      (nextTimeMs !== undefined && input.toTimeMs >= nextTimeMs)
    ) {
      throw new Error('动作关键帧不能越过相邻关键帧。');
    }

    const nextClip: AnimationClipV0 = {
      ...clip,
      tracks: clip.tracks.map((track) => {
        if (track.target.partId !== input.partId || !track.keys.some((key) => key.timeMs === input.fromTimeMs)) {
          return track;
        }
        return AnimationTrackSchema.parse({
          ...track,
          keys: track.keys
            .map((key) => (key.timeMs === input.fromTimeMs ? { ...key, timeMs: input.toTimeMs } : key))
            .sort((left, right) => left.timeMs - right.timeMs),
        });
      }),
    };
    return replaceLayerAnimationClip(project, shot.id, layer.id, nextClip);
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

    let changed = !layer.animationClip;
    for (const property of CHARACTER_MOTION_PROPERTIES) {
      const existing = clip.tracks.find((track) => track.target.partId === input.partId && track.property === property);
      const keys = existing?.keys ?? [
        { timeMs: 0, value: NEUTRAL_CHARACTER_MOTION[property], interpolationToNext: 'linear' as const },
      ];
      const atTime = keys.find((key) => key.timeMs === input.targetTimeMs);
      const nextValue = input.pose[property];
      if (!existing || !atTime || atTime.value !== nextValue) changed = true;
      const nextKey = {
        timeMs: input.targetTimeMs,
        value: nextValue,
        interpolationToNext: atTime?.interpolationToNext ?? ('linear' as const),
      };
      const track = AnimationTrackSchema.parse({
        target: basis.target,
        property,
        keys: [...keys.filter((key) => key.timeMs !== input.targetTimeMs), nextKey].sort(
          (left, right) => left.timeMs - right.timeMs,
        ),
      });
      clip.tracks = [
        ...clip.tracks.filter((candidate) => !(candidate.target.partId === input.partId && candidate.property === property)),
        track,
      ];
    }
    if (!changed) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, clip);
  }

  /** Set outgoing interpolation on all Property Keys for this Part at `timeMs`. */
  setCompositeKeyEasing(
    project: Project,
    input: CharacterMotionKeyTargetInput & { timeMs: number; interpolationToNext: AnimationInterpolation },
  ): Project {
    const { shot, layer } = requireEditableClipContext(project, input);
    if (!isValidFrameTime(input.timeMs)) throw new Error('请选择有效帧时间。');
    const easing = AnimationInterpolationSchema.parse(input.interpolationToNext);
    const clip = layer.animationClip;
    const compositeTimes = characterCompositeKeyTimes(layer, input.partId);
    const keyIndex = compositeTimes.indexOf(input.timeMs);
    if (!clip || keyIndex < 0) throw new Error('找不到要修改补间的动作关键帧。');
    if (keyIndex === compositeTimes.length - 1) {
      throw new Error('最后一个关键帧没有到下一帧的补间区间。');
    }

    let changed = false;
    const nextTracks = clip.tracks.map((track) => {
      if (track.target.partId !== input.partId) return track;
      let trackChanged = false;
      const keys = track.keys.map((key) => {
        if (key.timeMs !== input.timeMs || key.interpolationToNext === easing) return key;
        trackChanged = true;
        changed = true;
        return { ...key, interpolationToNext: easing };
      });
      return trackChanged ? AnimationTrackSchema.parse({ ...track, keys }) : track;
    });
    if (!changed) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, { ...clip, tracks: nextTracks });
  }
}
