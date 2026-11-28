import { ProjectSchema, type Project, type Shot } from '../models';
import { TimelineEventSchema, type CharacterActionEvent } from '../models/timeline-event';
import { LayeredCharacterActionSchema } from '../models/character';
import { characterFaceAndMouthPartIds } from '../character-part-animation';
import { captureMotionTrackRange } from '../user-motion-presets';
import { frameTimeMs, isValidFrameTime } from '../timeline/frame-grid';

function replaceShot(project: Project, shot: Shot): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((candidate) => candidate.id === shot.id ? shot : candidate),
  });
}

function selectedCharacterShot(project: Project, shotId: string, layerId: string): {
  shot: Shot;
  characterId: string;
} {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer || layer.source.kind !== 'character') {
    throw new Error('请选择镜头中的角色图层。');
  }
  if (layer.locked) throw new Error('该角色图层已锁定。');
  return { shot, characterId: layer.source.characterId };
}

/** Capture selected Part tracks as a named action on the same Character definition. */
export function saveLayeredCharacterAction(project: Project, shotId: string, layerId: string, input: {
  name: string; startMs: number; endMs: number; partIds: readonly string[]; headAnchorPartId?: string;
}, createId: () => string = () => crypto.randomUUID()): Project {
  const { shot, characterId } = selectedCharacterShot(project, shotId, layerId);
  const character = project.characters.find(({ id }) => id === characterId);
  const clip = shot.layers.find(({ id }) => id === layerId)?.animationClip;
  if (character?.mode !== 'adaptive-parts' || clip?.version !== 1) throw new Error('请先为分件角色编排部件动作。');
  const { startMs, endMs } = input;
  if (!isValidFrameTime(startMs) || !isValidFrameTime(endMs) || startMs >= endMs || endMs > shot.durationMs) {
    throw new Error('请选择镜头内的起止关键帧。');
  }
  if ((character.actions?.length ?? 0) >= 64) throw new Error('一个角色最多可保存 64 个动作。');
  const name = input.name.trim();
  if (!name || name.length > 64 || character.actions?.some((action) => action.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('请输入 1 到 64 个字符的未使用动作名称。');
  }
  const protectedIds = characterFaceAndMouthPartIds(character);
  const partIds = new Set(input.partIds.filter((id) => !protectedIds.has(id) && character.parts.some(({ partId }) => partId === id)));
  const tracks = clip.tracks.flatMap((track) => {
    if (track.target.kind !== 'character-part' || !partIds.has(track.target.partId)) return [];
    const saved = captureMotionTrackRange(track, startMs, endMs, false);
    return [{
      property: saved.property, partId: track.target.partId,
      keys: saved.keys.map(({ frameOffset, ...key }) => ({ ...key, timeMs: frameTimeMs(frameOffset) })),
    }];
  });
  if (!tracks.length) throw new Error('所选身体部件没有可保存的属性轨。');
  if (input.headAnchorPartId && !tracks.some(({ partId }) => partId === input.headAnchorPartId)) {
    throw new Error('请选择已勾选且有动作轨的身体部件作为头部跟随锚点。');
  }
  const action = LayeredCharacterActionSchema.parse({ id: createId(), name, kind: 'layered', tracks,
    headAnchorPartId: input.headAnchorPartId });
  return ProjectSchema.parse({ ...project, characters: project.characters.map((entry) => entry === character
    ? { ...character, actions: [...(character.actions ?? []), action] } : entry) });
}

/** Add or edit one bounded action on the selected existing Character Layer. */
export function upsertCharacterActionEvent(
  project: Project,
  shotId: string,
  layerId: string,
  values: { actionId: string; startMs: number; endMs: number; eventId?: string },
  createId: () => string = () => crypto.randomUUID(),
): Project {
  const { shot, characterId } = selectedCharacterShot(project, shotId, layerId);
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character?.actions?.some((action) => action.id === values.actionId)) {
    throw new Error('该动作不属于当前角色。');
  }
  if (!Number.isSafeInteger(values.startMs) || !Number.isSafeInteger(values.endMs) ||
      values.startMs < 0 || values.startMs >= values.endMs || values.endMs > shot.durationMs) {
    throw new Error('动作时间段必须在镜头范围内，且结束时间晚于开始时间。');
  }

  const existing = values.eventId
    ? shot.timelineEvents.find((event): event is CharacterActionEvent =>
        event.id === values.eventId && event.type === 'character-action' && event.layerId === layerId,
      )
    : undefined;
  if (values.eventId && !existing) throw new Error('该角色动作段已不存在。');
  const conflict = shot.timelineEvents.find((event) =>
    event.type === 'character-action' && event.layerId === layerId && event.id !== existing?.id &&
    event.startMs < values.endMs && values.startMs < event.endMs,
  );
  if (conflict) throw new Error('同一角色图层的动作时间段不能重叠。');
  if (existing && existing.actionId === values.actionId &&
      existing.startMs === values.startMs && existing.endMs === values.endMs) return project;

  const event = TimelineEventSchema.parse({
    id: existing?.id ?? createId(),
    type: 'character-action',
    layerId,
    startMs: values.startMs,
    endMs: values.endMs,
    actionId: values.actionId,
  });
  const timelineEvents = existing
    ? shot.timelineEvents.map((candidate) => candidate.id === existing.id ? event : candidate)
    : [...shot.timelineEvents, event];
  return replaceShot(project, { ...shot, timelineEvents });
}

/** Delete one action interval from its owning Character Layer. */
export function deleteCharacterActionEvent(
  project: Project,
  shotId: string,
  layerId: string,
  eventId: string,
): Project {
  const { shot } = selectedCharacterShot(project, shotId, layerId);
  const event = shot.timelineEvents.find((candidate) => candidate.id === eventId);
  if (event?.type !== 'character-action' || event.layerId !== layerId) {
    throw new Error('该角色动作段已不存在。');
  }
  return replaceShot(project, {
    ...shot,
    timelineEvents: shot.timelineEvents.filter((candidate) => candidate.id !== eventId),
  });
}
