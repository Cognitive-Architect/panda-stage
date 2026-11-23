import { resolveEffectiveMouthCue } from '../evaluate-shot-at-time';
import { listCharacterTalkingSources } from '../selectors/characterFaceSource';
import { ProjectSchema, type Character, type Project, type Shot } from '../models';
import {
  TimelineEventSchema,
  type MouthCueEvent,
  type MouthCueState,
} from '../models/timeline-event';
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
  if (
    !shot ||
    !layer ||
    shot.backgroundLayerId === layerId ||
    layer.source.kind !== 'character'
  ) {
    throw new Error('请先选择镜头中的角色。');
  }
  if (layer.locked) throw new Error('该角色已锁定。');
  return { shot, characterId: layer.source.characterId };
}

/** True when the Character defines a valid existing mouth-open visual source. */
export function characterHasMouthOpenVisual(
  project: Project,
  character: Character | null | undefined,
): boolean {
  if (!character || (character.mode === 'adaptive-parts' && !character.faceBinding)) {
    return false;
  }
  if (character.mouthOpenVisualSource) return true;
  if (!character.mouthOpenAssetId) return false;
  return project.assets.some(
    (asset) => asset.id === character.mouthOpenAssetId && asset.kind === 'image',
  );
}

/** Author one discrete point-state Mouth Cue (`rest` or `open`) on a Character Layer. */
export function upsertMouthCueEventAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  state: MouthCueState,
  requestedTimeMs: number,
  createId: () => string = () => crypto.randomUUID(),
): Project {
  const { shot, characterId } = selectedCharacterShot(project, shotId, layerId);
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character || (character.mode === 'adaptive-parts' && !character.faceBinding)) {
    throw new Error('当前角色不支持嘴型关键帧。');
  }
  if (!characterHasMouthOpenVisual(project, character) &&
    !(state === 'rest' && listCharacterTalkingSources(character).length > 0)) {
    throw new Error('请先为角色配置张嘴视觉。');
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
    throw new Error('镜头结束处不能创建嘴型切换。');
  }

  // Match ExpressionEventService same-time tie semantics deterministically.
  const existing = shot.timelineEvents
    .filter(
      (event): event is MouthCueEvent =>
        event.type === 'mouth-cue' &&
        event.layerId === layerId &&
        event.startMs === timeMs,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .at(-1);
  if (existing) {
    if (existing.state === state) return project;
    return replaceShot(project, {
      ...shot,
      timelineEvents: shot.timelineEvents.map((event) =>
        event.id === existing.id ? { ...event, state } : event,
      ),
    });
  }

  // Only skip when an earlier authored cue already yields the exact same state (`open` or `rest`).
  // Never skip when resolved state is `'none'`, because explicit `'rest'` suppresses Simple Mouth.
  if (resolveEffectiveMouthCue(shot, layerId, timeMs) === state) {
    return project;
  }

  const event = TimelineEventSchema.parse({
    id: createId(),
    type: 'mouth-cue',
    layerId,
    startMs: timeMs,
    endMs: timeMs,
    state,
  });
  const validation = validatePresetApplication(project, shotId, layerId, [event]);
  if (!validation.ok) throw new Error(validation.errors.join('；'));
  return replaceShot(project, {
    ...shot,
    timelineEvents: [...shot.timelineEvents, event],
  });
}

/** Delete one authored Mouth Cue; earlier cue or Simple Mouth fallback resolves naturally. */
export function deleteMouthCueEvent(
  project: Project,
  shotId: string,
  layerId: string,
  eventId: string,
): Project {
  const { shot } = selectedCharacterShot(project, shotId, layerId);
  const event = shot.timelineEvents.find((candidate) => candidate.id === eventId);
  if (event?.type !== 'mouth-cue' || event.layerId !== layerId) {
    throw new Error('嘴型关键帧已不存在。');
  }
  return replaceShot(project, {
    ...shot,
    timelineEvents: shot.timelineEvents.filter((candidate) => candidate.id !== eventId),
  });
}
