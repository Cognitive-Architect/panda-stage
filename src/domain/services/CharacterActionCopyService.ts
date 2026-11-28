import { evaluateTargetMotionValues } from '../animation-track-ops';
import { characterFaceAndMouthPartIds } from '../character-part-animation';
import { CHARACTER_PART_MAX_SCALE, CHARACTER_PART_MIN_SCALE } from '../constants';
import type { AnimationKey, AnimationProperty } from '../models/animationCore';
import {
  LayeredCharacterActionSchema,
  type AdaptivePartsCharacter,
  type CharacterAction,
  type LayeredCharacterAction,
} from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import type { CharacterActionEvent } from '../models/timeline-event';
import type { Layer } from '../models/layer';
import { frameTimeMs, TIMELINE_FPS } from '../timeline/frame-grid';

/** Upper bound shared with the existing layered-action authoring entry. */
const MAX_ACTION_NAME_LENGTH = 64;
const MAX_CHARACTER_ACTIONS = 64;
const INSTANCE_COPY_SUFFIX = ' 副本';

export interface CharacterActionInstanceAddress {
  shotId: string;
  layerId: string;
  eventId: string;
}

export interface CharacterActionInstanceDuplicateResult {
  project: Project;
  actionId: string;
}

/**
 * Explicit editing context for an instance-scoped action copy. Threading this
 * through the existing pose/IK services keeps writes anchored in action-local
 * time without introducing global state.
 */
export interface CharacterActionInstanceEdit {
  actionId: string;
  /** `shotTimeMs - event.startMs`, matching evaluated layered-action time. */
  localTimeMs: number;
}

export interface ResolvedCharacterActionInstanceEdit
  extends CharacterActionInstanceEdit {
  event: CharacterActionEvent;
  action: LayeredCharacterAction;
  layerId: string;
}

/** True when `action` is an instance-editable copy bound to this Character Layer. */
export function isCharacterActionInstanceCopyForLayer(
  action: CharacterAction | undefined,
  layerId: string,
): action is LayeredCharacterAction {
  return Boolean(
    action && 'kind' in action && action.instanceScope?.layerId === layerId,
  );
}

function selectedCharacterShot(
  project: Project,
  shotId: string,
  layerId: string,
): { shot: Project['shots'][number]; layer: Layer; character: AdaptivePartsCharacter } {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer || layer.source.kind !== 'character') {
    throw new Error('请选择镜头中的角色图层。');
  }
  if (layer.locked) throw new Error('该角色图层已锁定。');
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (character?.mode !== 'adaptive-parts') {
    throw new Error('请先为分件角色编排部件动作。');
  }
  return { shot, layer, character };
}

function actionEventOnLayer(
  shot: Project['shots'][number],
  layerId: string,
  eventId: string,
): CharacterActionEvent {
  const event = shot.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.id === eventId &&
      candidate.type === 'character-action' &&
      candidate.layerId === layerId,
  );
  if (!event) throw new Error('该角色动作段已不存在。');
  return event;
}

function replaceCharacterActions(
  project: Project,
  character: AdaptivePartsCharacter,
  actions: CharacterAction[],
): Project {
  return ProjectSchema.parse({
    ...project,
    characters: project.characters.map((candidate) => candidate.id === character.id
      ? { ...character, actions }
      : candidate),
  });
}

/**
 * Replaces Character actions and one Shot atomically so reference validation
 * never observes the event/action pair mid-update.
 */
function replaceCharacterActionsAndShot(
  project: Project,
  character: AdaptivePartsCharacter,
  actions: CharacterAction[],
  shot: Project['shots'][number],
): Project {
  return ProjectSchema.parse({
    ...project,
    characters: project.characters.map((candidate) => candidate.id === character.id
      ? { ...character, actions }
      : candidate),
    shots: project.shots.map((candidate) => candidate.id === shot.id ? shot : candidate),
  });
}

/** Unique, name-length-bounded display name for an instance copy. */
export function instanceCharacterActionCopyName(
  sourceName: string,
  takenNames: ReadonlySet<string>,
): string {
  const base = sourceName.trim() || '动作';
  for (let index = 0; index < MAX_CHARACTER_ACTIONS; index += 1) {
    const suffix = index === 0 ? INSTANCE_COPY_SUFFIX : `${INSTANCE_COPY_SUFFIX} ${index + 1}`;
    const head = base.slice(0, Math.max(1, MAX_ACTION_NAME_LENGTH - suffix.length)).trimEnd();
    const candidate = `${head}${suffix}`;
    if (!takenNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error('无法生成不重复的动作副本名称。');
}

/**
 * Copies a shared layered action into an independent, instance-scoped copy and
 * repoints only this one action event to it. The source action and every other
 * event/layer stay untouched. Duplicating a segment that already uses a copy
 * for this same layer is idempotent (returns the untouched project).
 */
export function duplicateCharacterActionForInstance(
  project: Project,
  address: CharacterActionInstanceAddress,
  createId: () => string = () => crypto.randomUUID(),
): CharacterActionInstanceDuplicateResult {
  const { shot, layer, character } = selectedCharacterShot(
    project,
    address.shotId,
    address.layerId,
  );
  const event = actionEventOnLayer(shot, layer.id, address.eventId);
  const actions = character.actions ?? [];
  const source = actions.find((candidate) => candidate.id === event.actionId);
  if (!source) throw new Error('该动作不属于当前角色。');
  if (!('kind' in source)) {
    throw new Error('整图动作不支持局部修改，请先改用分件动作。');
  }
  if (source.instanceScope) {
    if (source.instanceScope.layerId === layer.id) {
      // Already an independent copy for this instance: keep it unchanged.
      return { project, actionId: source.id };
    }
    throw new Error('该动作副本属于其他图层，不能再次绑定。');
  }
  if (actions.length >= MAX_CHARACTER_ACTIONS) {
    throw new Error('一个角色最多可保存 64 个动作。');
  }

  const copy = structuredClone(source);
  copy.id = createId();
  copy.name = instanceCharacterActionCopyName(
    source.name,
    new Set(actions.map((action) => action.name.toLocaleLowerCase())),
  );
  copy.originActionId = source.id;
  copy.instanceScope = { layerId: layer.id };

  const nextActions = [...actions, LayeredCharacterActionSchema.parse(copy)];
  return {
    project: replaceCharacterActionsAndShot(project, character, nextActions, {
      ...shot,
      timelineEvents: shot.timelineEvents.map((candidate) =>
        candidate.id === event.id ? { ...event, actionId: copy.id } : candidate,
      ),
    }),
    actionId: copy.id,
  };
}

function isActionReferenced(
  project: Project,
  actionId: string,
  ignoredEventId: string,
): boolean {
  return project.shots.some((shot) => shot.timelineEvents.some(
    (event) =>
      event.id !== ignoredEventId &&
      event.type === 'character-action' &&
      event.actionId === actionId,
  ));
}

/**
 * Restores the shared action reference for one action event. The instance copy
 * is removed only when no other event still references it.
 */
export function revertCharacterActionForInstance(
  project: Project,
  address: CharacterActionInstanceAddress,
): Project {
  const { shot, layer, character } = selectedCharacterShot(
    project,
    address.shotId,
    address.layerId,
  );
  const event = actionEventOnLayer(shot, layer.id, address.eventId);
  const actions = character.actions ?? [];
  const copy = actions.find((candidate) => candidate.id === event.actionId);
  if (!copy || !('kind' in copy)) throw new Error('当前动作段不是独立副本，无需恢复。');
  if (!copy.instanceScope) throw new Error('当前动作段不是独立副本，无需恢复。');
  const origin = copy.originActionId
    ? actions.find((candidate) => candidate.id === copy.originActionId)
    : undefined;
  if (!origin) throw new Error('找不到原始共享动作，无法恢复。');

  const nextActions = isActionReferenced(project, copy.id, event.id)
    ? actions
    : actions.filter((candidate) => candidate.id !== copy.id);
  return replaceCharacterActionsAndShot(project, character, nextActions, {
    ...shot,
    timelineEvents: shot.timelineEvents.map((candidate) =>
      candidate.id === event.id ? { ...event, actionId: origin.id } : candidate,
    ),
  });
}

/**
 * Resolves the active instance-scoped copy edit for this layer/time, if any.
 * Shared actions deliberately resolve to `undefined` so the existing layer-clip
 * write path keeps its historical behavior.
 */
export function resolveCharacterActionInstanceEdit(
  project: Project,
  shotId: string,
  layerId: string,
  timeMs: number,
): ResolvedCharacterActionInstanceEdit | undefined {
  return resolveCharacterActionInstanceEditForInput(project, { shotId, layerId, timeMs });
}

/**
 * Prefers an explicitly threaded editing context while still validating it
 * against the current project data and event ownership.
 */
export function resolveCharacterActionInstanceEditForInput(
  project: Project,
  input: {
    shotId: string;
    layerId: string;
    timeMs: number;
    actionEdit?: CharacterActionInstanceEdit;
  },
): ResolvedCharacterActionInstanceEdit | undefined {
  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === input.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  if (!shot || !layer || !characterId) return undefined;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (character?.mode !== 'adaptive-parts') return undefined;
  const event = shot.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.type === 'character-action' &&
      candidate.layerId === layer.id &&
      candidate.startMs <= input.timeMs &&
      input.timeMs < candidate.endMs,
  );
  if (!event) return undefined;
  const action = character.actions?.find((candidate) => candidate.id === event.actionId);
  if (!isCharacterActionInstanceCopyForLayer(action, layer.id)) return undefined;
  if (input.actionEdit) {
    if (input.actionEdit.actionId !== action.id) return undefined;
    if (!Number.isFinite(input.actionEdit.localTimeMs)) return undefined;
    return {
      actionId: action.id,
      localTimeMs: input.actionEdit.localTimeMs,
      event,
      action,
      layerId: layer.id,
    };
  }
  return {
    actionId: action.id,
    localTimeMs: input.timeMs - event.startMs,
    event,
    action,
    layerId: layer.id,
  };
}

/** Action-source time uses the same frame grid as captured layered actions. */
function actionLocalFrameTimeMs(localTimeMs: number): number {
  return frameTimeMs(Math.round((localTimeMs * TIMELINE_FPS) / 1_000));
}

function upsertInstanceActionTrack(
  tracks: LayeredCharacterAction['tracks'],
  partId: string,
  property: AnimationProperty,
  localTimeMs: number,
  value: number,
  seedValue: number,
): LayeredCharacterAction['tracks'] {
  const index = tracks.findIndex(
    (track) => track.partId === partId && track.property === property,
  );
  if (index >= 0) {
    const track = tracks[index]!;
    const existing = track.keys.find((key) => key.timeMs === localTimeMs);
    const nextKey: AnimationKey = {
      timeMs: localTimeMs,
      value,
      interpolationToNext: existing?.interpolationToNext ?? 'linear',
    };
    const nextTracks = [...tracks];
    nextTracks[index] = {
      ...track,
      keys: [
        ...track.keys.filter((key) => key.timeMs !== localTimeMs),
        nextKey,
      ].sort((left, right) => left.timeMs - right.timeMs),
    };
    return nextTracks;
  }
  // A layered action track requires at least two keys, the first at 0 ms.
  // Seeding 0 ms with the layer pose at segment start keeps the new override
  // anchored to the action source instead of rewriting the whole segment.
  const actionEndMs = Math.max(
    frameTimeMs(1),
    ...tracks.map((track) => track.keys.at(-1)!.timeMs),
  );
  const keys: AnimationKey[] = localTimeMs === 0
    ? [
        { timeMs: 0, value, interpolationToNext: 'linear' },
        { timeMs: actionEndMs, value, interpolationToNext: 'linear' },
      ]
    : [
        { timeMs: 0, value: seedValue, interpolationToNext: 'linear' },
        { timeMs: localTimeMs, value, interpolationToNext: 'linear' },
      ];
  return [...tracks, { partId, property, keys }];
}

/**
 * Writes Part transform values into the instance copy's action tracks at
 * action-local time. This is the data actually consumed by layered-action
 * playback; the layer `animationClip` is never touched.
 */
export function writeCharacterActionInstanceValues(
  project: Project,
  edit: ResolvedCharacterActionInstanceEdit,
  partId: string,
  changes: Partial<Record<AnimationProperty, number>>,
): Project {
  const { layer, character, event } = resolveEditOwner(project, edit);
  const currentAction = character.actions?.find((candidate) => candidate.id === edit.actionId);
  if (!isCharacterActionInstanceCopyForLayer(currentAction, layer.id)) {
    throw new Error('当前动作段已不是独立副本，请重新选择。');
  }
  const protectedPartIds = characterFaceAndMouthPartIds(character);
  if (protectedPartIds.has(partId)) {
    throw new Error('脸部和嘴型部件由表情系统控制，不能写入动作副本。');
  }
  const part = character.parts.find((candidate) => candidate.partId === partId);
  if (!part) throw new Error('角色默认姿势中已没有此部件。');
  if (!part.visible) throw new Error('无法编辑此动画部件。');

  const localTimeMs = actionLocalFrameTimeMs(edit.localTimeMs);
  if (!Number.isFinite(localTimeMs) || localTimeMs < 0) {
    throw new Error('请选择镜头内的有效帧。');
  }
  const clipTracks = layer.animationClip?.version === 1 ? layer.animationClip.tracks : [];
  const seed = evaluateTargetMotionValues(
    clipTracks,
    { kind: 'character-part', layerId: layer.id, partId },
    event.startMs,
  );

  let tracks = currentAction.tracks;
  for (const [property, rawValue] of Object.entries(changes) as [
    AnimationProperty,
    number | undefined,
  ][]) {
    if (rawValue === undefined) continue;
    if (!Number.isFinite(rawValue)) throw new Error('请输入有效的变换数值。');
    if (
      (property === 'transform.scaleX' || property === 'transform.scaleY') &&
      (rawValue < CHARACTER_PART_MIN_SCALE || rawValue > CHARACTER_PART_MAX_SCALE)
    ) {
      throw new Error(
        `缩放范围为 ${CHARACTER_PART_MIN_SCALE * 100}%～${CHARACTER_PART_MAX_SCALE * 100}%。`,
      );
    }
    tracks = upsertInstanceActionTrack(
      tracks,
      partId,
      property,
      localTimeMs,
      rawValue,
      seed[property],
    );
  }
  const nextAction = LayeredCharacterActionSchema.parse({ ...currentAction, tracks });
  return replaceCharacterActions(
    project,
    character,
    (character.actions ?? []).map((candidate) =>
      candidate.id === nextAction.id ? nextAction : candidate,
    ),
  );
}

function resolveEditOwner(
  project: Project,
  edit: ResolvedCharacterActionInstanceEdit,
): { layer: Layer; character: AdaptivePartsCharacter; event: CharacterActionEvent } {
  const shot = project.shots.find((candidate) =>
    candidate.layers.some((entry) => entry.id === edit.layerId),
  );
  const layer = shot?.layers.find((candidate) => candidate.id === edit.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  if (!shot || !layer || !characterId) throw new Error('该角色动作段已不存在。');
  if (layer.locked) throw new Error('该角色图层已锁定。');
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (character?.mode !== 'adaptive-parts') {
    throw new Error('请先为分件角色编排部件动作。');
  }
  const event = shot.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.id === edit.event.id &&
      candidate.type === 'character-action' &&
      candidate.layerId === layer.id,
  );
  if (!event) throw new Error('该角色动作段已不存在。');
  return { layer, character, event };
}
