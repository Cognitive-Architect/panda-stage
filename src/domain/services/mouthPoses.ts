import type { MouthPoseCategory, MouthPoseEvent, Project, Shot, TimelineEvent } from '../models';
import { ProjectSchema } from '../models';
import { exportFrameTimeMs, firstExportFrameTimeAtOrAfter } from '../timeline/frame-grid';

export interface MouthPoseWindow { startMs: number; endMs: number }
export interface MouthPoseDraftSegment extends MouthPoseWindow { category: MouthPoseCategory }
interface MouthPoseSelection extends MouthPoseWindow {
  shotId: string;
  layerId: string;
  dialogueId: string;
}

export function intersectMouthPoseWindow(a: MouthPoseWindow, b: MouthPoseWindow): MouthPoseWindow | null {
  const startMs = Math.max(a.startMs, b.startMs);
  const endMs = Math.min(a.endMs, b.endMs);
  return startMs < endMs ? { startMs, endMs } : null;
}

export function selectMouthPoseGeneration(project: Project, selection: MouthPoseSelection) {
  const shot = project.shots.find((item) => item.id === selection.shotId);
  const layer = shot?.layers.find((item) => item.id === selection.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find((item) => item.id === characterId);
  const dialogue = shot?.dialogues.find((item) => item.id === selection.dialogueId);
  const clip = shot?.audioClips.find((item) => item.id === dialogue?.audioClipId);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  if (!shot || !layer || layer.locked || !character?.mouthPoseSet || characterId !== dialogue?.characterId) {
    throw new Error('请选择当前对白角色的一个可编辑镜头实例，并配置口型。');
  }
  if (!dialogue || !clip || clip.role !== 'dialogue' || asset?.kind !== 'audio' ||
      asset.durationMs === undefined || !asset.sha256) {
    throw new Error('请先为这段对白绑定可读的配音。');
  }
  if (!Number.isSafeInteger(selection.startMs) || !Number.isSafeInteger(selection.endMs) ||
      selection.startMs < dialogue.startMs || selection.endMs > dialogue.endMs ||
      selection.startMs >= selection.endMs) throw new Error('请选择对白内的有效时间范围。');
  const audio = intersectMouthPoseWindow(selection, {
    startMs: clip.startMs, endMs: Math.min(clip.endMs, clip.startMs + asset.durationMs - clip.offsetMs),
  });
  if (!audio || audio.endMs - audio.startMs > 120_000) throw new Error('所选范围须包含配音，单次最多分析 120 秒。');
  return {
    shot, layer, dialogue, poseSet: character.mouthPoseSet, asset, sha256: asset.sha256, audio,
    sourceStartMs: clip.offsetMs + audio.startMs - clip.startMs,
  };
}

function replaceEvents(project: Project, shot: Shot, timelineEvents: TimelineEvent[]): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((item) => item.id === shot.id ? { ...item, timelineEvents } : item),
  });
}

function subtract(window: MouthPoseWindow, blockers: readonly MouthPoseWindow[]): MouthPoseWindow[] {
  let startMs = window.startMs;
  const result: MouthPoseWindow[] = [];
  for (const blocker of blockers) {
    if (blocker.endMs <= startMs) continue;
    if (blocker.startMs >= window.endMs) break;
    if (blocker.startMs > startMs) result.push({ startMs, endMs: blocker.startMs });
    startMs = blocker.endMs;
    if (startMs >= window.endMs) return result;
  }
  if (startMs < window.endMs) result.push({ startMs, endMs: window.endMs });
  return result;
}

export function applyMouthPoseDraft(
  project: Project, selection: MouthPoseSelection, draft: readonly MouthPoseDraftSegment[], createId: () => string,
): Project {
  const { shot, poseSet, audio } = selectMouthPoseGeneration(project, selection);
  let cursor = selection.startMs;
  for (const segment of draft) {
    if (segment.startMs !== cursor || segment.endMs <= cursor || !poseSet.analyzerMapping[segment.category]) {
      throw new Error('口型草稿时间或映射无效，请重新生成。');
    }
    cursor = segment.endMs;
  }
  if (cursor !== selection.endMs || draft.length > 6_000) throw new Error('口型草稿范围不完整。');

  // Export samples one project-wide grid. A Shot after an off-grid cut has
  // that same grid shifted by its own start time.
  const shotStartMs = project.shots.slice(0, project.shots.indexOf(shot))
    .reduce((start, item) => start + item.durationMs, 0);
  const snap = (timeMs: number) =>
    exportFrameTimeMs(Math.round((shotStartMs + timeMs) * project.fps / 1_000), project.fps) - shotStartMs;
  const hasSample = (window: MouthPoseWindow): boolean =>
    firstExportFrameTimeAtOrAfter(shotStartMs + window.startMs, project.fps) < shotStartMs + window.endMs;
  if (!hasSample(selection)) throw new Error('这段范围没有可显示口型的帧，请稍微扩大范围。');

  const manuals = shot.timelineEvents.filter((event) =>
    event.type === 'mouth-pose' && event.origin === 'manual' && event.layerId === selection.layerId)
    .sort((a, b) => a.startMs - b.startMs);
  const retained = shot.timelineEvents.flatMap((event): TimelineEvent[] => {
    if (event.type !== 'mouth-pose' || event.origin !== 'generated' ||
        event.layerId !== selection.layerId || event.dialogueId !== selection.dialogueId ||
        !intersectMouthPoseWindow(event, selection)) return [event];
    return subtract(event, [selection]).filter(hasSample)
      .map((window, index) => ({ ...event, ...window, id: index ? createId() : event.id }));
  });
  const generationId = createId();
  const generated: MouthPoseEvent[] = [];
  for (const [index, segment] of draft.entries()) {
    const bounds = segment.category === 'rest' ? selection : audio;
    const snapped = intersectMouthPoseWindow(bounds, {
      startMs: index === 0 ? selection.startMs : snap(segment.startMs),
      endMs: index === draft.length - 1 ? selection.endMs : snap(segment.endMs),
    });
    if (!snapped) continue;
    for (const window of subtract(snapped, manuals).filter(hasSample)) {
      const poseId = poseSet.analyzerMapping[segment.category];
      const last = generated.at(-1);
      if (last?.poseId === poseId && last.endMs === window.startMs) {
        last.endMs = window.endMs;
      } else {
        generated.push({ ...window, id: createId(), type: 'mouth-pose', origin: 'generated', poseId,
          generationId, layerId: selection.layerId, dialogueId: selection.dialogueId });
      }
    }
  }
  return replaceEvents(project, shot, [...retained, ...generated]);
}

export function setManualMouthPose(project: Project, shotId: string, layerId: string, id: string,
  values: MouthPoseWindow & { poseId: string; dialogueId?: string }): Project {
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot || !shot.layers.some((layer) => layer.id === layerId && !layer.locked)) throw new Error('口型图层不可编辑。');
  const existing = shot.timelineEvents.find((event) => event.id === id);
  if (existing && (existing.type !== 'mouth-pose' || existing.layerId !== layerId)) throw new Error('找不到该口型段。');
  const dialogueId = existing?.type === 'mouth-pose' ? existing.dialogueId : values.dialogueId;
  const updated: MouthPoseEvent = {
    id, layerId, type: 'mouth-pose', origin: 'manual', poseId: values.poseId,
    startMs: values.startMs, endMs: values.endMs, ...(dialogueId ? { dialogueId } : {}),
  };
  return replaceEvents(project, shot, [...shot.timelineEvents.filter((event) => event.id !== id), updated]);
}

export function resolveMouthPoseEvent(shot: Shot, layerId: string, timeMs: number): MouthPoseEvent | undefined {
  let winner: MouthPoseEvent | undefined;
  for (const event of shot.timelineEvents) {
    if (event.type !== 'mouth-pose' || event.layerId !== layerId ||
        event.startMs > timeMs || timeMs >= event.endMs) continue;
    if (!winner || (event.origin === winner.origin
      ? event.startMs > winner.startMs || (event.startMs === winner.startMs && event.id > winner.id)
      : event.origin === 'manual')) winner = event;
  }
  return winner;
}

export type DialogueMouthPoseMove =
  | { readonly dialogueId: string; readonly deltaMs: number }
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

function resolveMovedDeltaMs(
  moved: DialogueMouthPoseMove | undefined,
  dialogueId: string,
): number {
  if (!moved) return 0;
  if (moved instanceof Map) {
    return moved.get(dialogueId) ?? 0;
  }
  if (
    'dialogueId' in moved &&
    'deltaMs' in moved &&
    typeof moved.dialogueId === 'string' &&
    typeof moved.deltaMs === 'number'
  ) {
    return moved.dialogueId === dialogueId ? moved.deltaMs : 0;
  }
  const value = (moved as Readonly<Record<string, number>>)[dialogueId];
  return typeof value === 'number' ? value : 0;
}

export function reconcileDialogueMouthPoses(
  before: Shot,
  after: Shot,
  moved?: DialogueMouthPoseMove,
): TimelineEvent[] {
  return after.timelineEvents.flatMap((event): TimelineEvent[] => {
    if (event.type !== 'mouth-pose' || !event.dialogueId) return [event];
    const oldDialogue = before.dialogues.find((item) => item.id === event.dialogueId);
    const dialogue = after.dialogues.find((item) => item.id === event.dialogueId);
    if (!dialogue || (oldDialogue && oldDialogue.characterId !== dialogue.characterId)) return [];
    const delta = resolveMovedDeltaMs(moved, event.dialogueId);
    const window = intersectMouthPoseWindow(dialogue, { startMs: event.startMs + delta, endMs: event.endMs + delta });
    if (!window) return [];
    if (event.origin === 'manual') return [{ ...event, ...window }];
    const oldClip = before.audioClips.find((item) => item.id === oldDialogue?.audioClipId);
    const clip = after.audioClips.find((item) => item.id === dialogue.audioClipId);
    if (!oldDialogue) return clip ? [{ ...event, ...window }] : [];
    if (!oldClip || !clip || oldClip.assetId !== clip.assetId) return [];
    const oldSourceClock = oldClip.offsetMs - oldClip.startMs;
    const newSourceClock = clip.offsetMs - clip.startMs + delta;
    if (oldSourceClock !== newSourceClock) return [];
    // Generated rest segments may cover intentional gaps before and after
    // the voice. A trimmed clip must not retain old speech poses in those gaps.
    const lostLeft = Math.max(clip.startMs, oldClip.startMs + delta);
    const lostRight = Math.min(clip.endMs, oldClip.endMs + delta);
    let startMs = window.startMs;
    let endMs = window.endMs;
    if (clip.startMs > oldClip.startMs + delta) startMs = Math.max(startMs, lostLeft);
    if (clip.endMs < oldClip.endMs + delta) endMs = Math.min(endMs, lostRight);
    return startMs < endMs ? [{ ...event, startMs, endMs }] : [];
  });
}
