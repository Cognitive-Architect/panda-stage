import { characterFaceAndMouthPartIds } from '../character-part-animation';
import { AnimationPropertySchema } from '../models/animationKeys';
import {
  CharacterMotionMappingSchema, LayeredCharacterActionSchema,
  type AdaptivePartsCharacter, type CharacterMotionMappingRule, type LayeredCharacterAction,
} from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';
import { upsertCharacterActionEvent } from './CharacterActionEventService';

type MappingInput = {
  sourceCharacterId: string;
  sourceActionId: string;
  rules: readonly CharacterMotionMappingRule[];
};

function usableParts(character: AdaptivePartsCharacter) {
  const protectedParts = characterFaceAndMouthPartIds(character);
  return character.parts.filter(({ partId, visible }) => visible && !protectedParts.has(partId));
}

export function suggestCharacterMotionMapping(source: AdaptivePartsCharacter, action: LayeredCharacterAction,
  target: AdaptivePartsCharacter): CharacterMotionMappingRule[] {
  const targets = usableParts(target);
  const sources = usableParts(source);
  const ids = [...new Set(action.tracks.map(track => track.partId))];
  const selected = new Set<string>();
  const normalize = (name: string | undefined) => name?.trim().normalize('NFKC').toLocaleLowerCase();
  return ids.map(sourcePartId => {
    const name = normalize(sources.find(({ partId }) => partId === sourcePartId)?.displayName);
    const candidates = name ? targets.filter(part => normalize(part.displayName) === name) : [];
    const candidateId = candidates.length === 1 ? candidates[0]?.partId : undefined;
    const targetPartId = candidateId && !selected.has(candidateId) ? candidateId : undefined;
    if (targetPartId) selected.add(targetPartId);
    return { sourcePartId, targetPartId, mirror: false, translationScale: 1, pivotOffset: { x: 0, y: 0 },
      properties: [...AnimationPropertySchema.options] };
  });
}

/** Prepare the target occurrence and the saved mapping together so confirmation is one History entry. */
export function planMappedCharacterMotion(project: Project, shotId: string, layerId: string, startMs: number, input: MappingInput,
  createId: () => string = () => crypto.randomUUID()) {
  const shot = project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  const targetId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const target = project.characters.find(({ id }) => id === targetId);
  const source = project.characters.find(({ id }) => id === input.sourceCharacterId);
  const sourceAction = source?.actions?.find(({ id }) => id === input.sourceActionId);
  if (source?.mode !== 'adaptive-parts' || target?.mode !== 'adaptive-parts' || source.id === target.id ||
    !sourceAction || !('kind' in sourceAction) || !shot || !layer || layer.locked) throw new Error('请选择另一分件角色的可用身体动作。');
  if (!isValidFrameTime(startMs) || startMs >= shot.durationMs) throw new Error('请在镜头结束前选择一个有效帧。');
  const records = target.motionMappings ?? [];
  const previous = records.find(entry => entry.sourceCharacterId === source.id && entry.sourceActionId === sourceAction.id);
  const checked = CharacterMotionMappingSchema.safeParse({ ...input, generatedActionId: previous?.generatedActionId ?? createId() });
  if (!checked.success) throw new Error('请检查重复部件、位移比例和支点校准。');
  if (!previous && records.length >= 64) throw new Error('一个角色最多可保存 64 组动作映射。');
  const rules = checked.data.rules;
  const targetPartIds = new Set(usableParts(target).map(({ partId }) => partId));
  const sourcePartIds = new Set(usableParts(source).map(({ partId }) => partId));
  if (layer.animationClip?.version === 1) {
    const bases = new Set(layer.animationClip.targetBases.filter(basis => basis.visible).map(({ target }) => target.partId));
    for (const id of targetPartIds) if (!bases.has(id)) targetPartIds.delete(id);
  }
  const bySource = new Map(rules.map(rule => [rule.sourcePartId, rule]));
  const missingSourcePartIds = new Set<string>();
  const tracks: LayeredCharacterAction['tracks'] = [];
  for (const track of sourceAction.tracks) {
    const rule = bySource.get(track.partId);
    if (!rule?.targetPartId || !sourcePartIds.has(track.partId) || !targetPartIds.has(rule.targetPartId)) {
      missingSourcePartIds.add(track.partId);
      continue;
    }
    if (!rule.properties.includes(track.property)) continue;
    const translation = track.property === 'transform.offsetX' || track.property === 'transform.offsetY';
    const flip = rule.mirror && (track.property === 'transform.offsetX' || track.property === 'transform.rotationDeg');
    const multiplier = (translation ? rule.translationScale : 1) * (flip ? -1 : 1);
    tracks.push({ ...track, partId: rule.targetPartId, keys: track.keys.map(key => ({ ...key, value: key.value * multiplier })) });
  }
  if (!tracks.length) throw new Error('没有可应用的身体部件属性。');
  const mappedAnchor = sourceAction.headAnchorPartId ? bySource.get(sourceAction.headAnchorPartId)?.targetPartId : undefined;
  const headAnchorPartId = tracks.some(track => track.partId === mappedAnchor) ? mappedAnchor : undefined;
  const partPivotOffsets = rules.flatMap(({ targetPartId, pivotOffset }) => targetPartId && (pivotOffset.x || pivotOffset.y) &&
    tracks.some(track => track.partId === targetPartId && track.property !== 'transform.offsetX' && track.property !== 'transform.offsetY')
    ? [{ partId: targetPartId, offset: pivotOffset }] : []);
  const actions = target.actions ?? [];
  const reusable = actions.find(action => action.id === previous?.generatedActionId && 'kind' in action);
  const matches = reusable && 'kind' in reusable && JSON.stringify(reusable.tracks) === JSON.stringify(tracks) &&
    reusable.headAnchorPartId === headAnchorPartId && JSON.stringify(reusable.partPivotOffsets ?? []) === JSON.stringify(partPivotOffsets);
  const actionId = matches ? reusable.id : previous ? createId() : checked.data.generatedActionId;
  const actionName = `${source.name} · ${sourceAction.name}`.slice(0, 64).trimEnd();
  let name = actionName;
  for (let suffix = 2; actions.some(entry => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()); suffix++) {
    name = `${actionName.slice(0, 58)} (${suffix})`;
  }
  if (!matches && actions.length >= 64) throw new Error('目标角色的动作已满，请先删除未使用的动作。');
  const mapped = matches ? reusable : LayeredCharacterActionSchema.parse({ id: actionId, name, kind: 'layered', tracks,
    headAnchorPartId, partPivotOffsets: partPivotOffsets.length ? partPivotOffsets : undefined });
  const mapping = { ...checked.data, generatedActionId: actionId };
  const next = ProjectSchema.parse({ ...project, characters: project.characters.map(character => character !== target ? character : {
    ...target, actions: matches ? actions : [...actions, mapped],
    motionMappings: previous ? records.map(entry => entry === previous ? mapping : entry) : [...records, mapping],
  }) });
  const durationMs = Math.max(...sourceAction.tracks.map(({ keys }) => keys.at(-1)!.timeMs));
  const endMs = Math.min(shot.durationMs, startMs + durationMs);
  return { project: upsertCharacterActionEvent(next, shotId, layerId, { actionId, startMs, endMs }, createId),
    missingSourcePartIds: [...missingSourcePartIds], startMs, endMs };
}
