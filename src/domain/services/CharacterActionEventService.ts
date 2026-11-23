import { ProjectSchema, type Project, type Shot } from '../models';
import { TimelineEventSchema, type CharacterActionEvent } from '../models/timeline-event';

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
