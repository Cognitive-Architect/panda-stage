import { createCharacterPartAnimationClip } from '../character-part-animation';
import {
  compositeKeyTimesForTarget,
  evaluateTargetMotionValues,
  upsertTargetKeyValues,
} from '../animation-track-ops';
import { type AnimationProperty } from '../models/animationCore';
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
  const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
  return evaluateTargetMotionValues(
    clip?.tracks ?? [],
    { kind: 'character-part', layerId: layer.id, partId: input.partId },
    input.timeMs,
  );
}

/** UI aggregation only: no Composite Key data is ever persisted. */
export function characterCompositeKeyTimes(layer: Project['shots'][number]['layers'][number], partId: string): number[] {
  const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
  return compositeKeyTimesForTarget(clip?.tracks ?? [], {
    kind: 'character-part',
    layerId: layer.id,
    partId,
  });
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
    clip.tracks = upsertTargetKeyValues(clip.tracks, basis.target, input.timeMs, changes);
    return ProjectSchema.parse({ ...project, shots: project.shots.map(s => s.id === shot.id ? {
      ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, animationClip: clip } : l),
    } : s) });
  }
}
