import { createCharacterPartAnimationClip } from '../character-part-animation';
import { evaluateAnimationTrackAtTime } from '../evaluate-animation-core';
import { AnimationTrackSchema, type AnimationProperty } from '../models/animationCore';
import { ProjectSchema, type Project } from '../models/project';
import { CharacterService } from './CharacterService';
import { characterPartSourceBounds, characterPartTransformFromStaticAdjustment } from '../geometry/characterPartLayout';
import { isValidFrameTime } from '../timeline/frame-grid';

export const NEUTRAL_CHARACTER_MOTION = {
  'transform.offsetX': 0, 'transform.offsetY': 0, 'transform.rotationDeg': 0,
  'transform.scaleX': 1, 'transform.scaleY': 1,
};
export type CharacterMotionValues = Record<AnimationProperty, number>;
export interface CharacterMotionInput {
  shotId: string; layerId: string; partId: string; timeMs: number; autoKey: boolean;
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
    return ProjectSchema.parse({ ...project, shots: project.shots.map(s => s.id === shot.id ? {
      ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, animationClip: clip } : l),
    } : s) });
  }
}
