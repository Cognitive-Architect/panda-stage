import { ProjectSchema, type Project, type Shot } from '../models';
import { TimelineEventSchema, type ExpressionEvent } from '../models/timeline-event';
import { resolveTimelineFrameTime } from '../timeline/frame-grid';
import { validatePresetApplication } from '../validators/timelineEventValidator';

function replaceShot(project: Project, shot: Shot): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((candidate) =>
      candidate.id === shot.id ? shot : candidate,
    ),
  });
}

function selectedCharacterShot(
  project: Project,
  shotId: string,
  layerId: string,
): { shot: Shot; characterId: string } {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer || shot.backgroundLayerId === layerId || layer.source.kind !== 'character') {
    throw new Error('请先选择镜头中的角色。');
  }
  if (layer.locked) throw new Error('该角色已锁定。');
  return { shot, characterId: layer.source.characterId };
}

/** Author one persistent Expression switch on the selected formal occurrence. */
export function upsertExpressionEventAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  expressionId: string,
  requestedTimeMs: number,
  createId: () => string = () => crypto.randomUUID(),
): Project {
  const { shot, characterId } = selectedCharacterShot(project, shotId, layerId);
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character?.expressions.some((expression) => expression.id === expressionId)) {
    throw new Error('所选表情不属于该角色。');
  }
  if (
    !Number.isFinite(requestedTimeMs) ||
    requestedTimeMs < 0 ||
    requestedTimeMs >= shot.durationMs
  ) {
    throw new Error('请把播放头移到镜头内的有效时间。');
  }
  const timeMs = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
  if (timeMs >= shot.durationMs) {
    throw new Error('镜头结束处不能创建表情切换。');
  }

  // The evaluator resolves ties by id. Preserve older same-time events and
  // update only the effective one, so old projects retain their ordering.
  const existing = shot.timelineEvents
    .filter((event): event is ExpressionEvent =>
      event.type === 'expression' &&
      event.layerId === layerId &&
      event.startMs === timeMs,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .at(-1);
  if (existing) {
    if (existing.expressionId === expressionId) return project;
    return replaceShot(project, {
      ...shot,
      timelineEvents: shot.timelineEvents.map((event) =>
        event.id === existing.id ? { ...event, expressionId } : event,
      ),
    });
  }

  const event = TimelineEventSchema.parse({
    id: createId(),
    type: 'expression',
    layerId,
    startMs: timeMs,
    endMs: timeMs,
    expressionId,
  });
  const validation = validatePresetApplication(project, shotId, layerId, [event]);
  if (!validation.ok) throw new Error(validation.errors.join('；'));
  return replaceShot(project, {
    ...shot,
    timelineEvents: [...shot.timelineEvents, event],
  });
}

/** Delete one authored switch; earlier formal state then resolves naturally. */
export function deleteExpressionEvent(
  project: Project,
  shotId: string,
  layerId: string,
  eventId: string,
): Project {
  const { shot } = selectedCharacterShot(project, shotId, layerId);
  const event = shot.timelineEvents.find((candidate) => candidate.id === eventId);
  if (event?.type !== 'expression' || event.layerId !== layerId) {
    throw new Error('表情切换已不存在。');
  }
  return replaceShot(project, {
    ...shot,
    timelineEvents: shot.timelineEvents.filter((candidate) => candidate.id !== eventId),
  });
}
