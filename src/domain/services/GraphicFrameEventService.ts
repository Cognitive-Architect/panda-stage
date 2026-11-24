import { ProjectSchema, type Project } from '../models/project';
import { isFlaGraphicDefinition } from '../models/animation';
import type { AnimationSourceRange } from '../models/animationSourceRange';
import type { AnimationPlayback, Layer } from '../models/layer';
import { resolveFlaGraphicPreviewTimeline } from '../selectors/animationSourceTimeline';
import { resolveTimelineFrameTime } from '../timeline/frame-grid';
import { evaluateLayerPreTrackState, findGraphicPlaybackAtTime } from '../evaluate-shot-at-time';
import type { GraphicFrameEvent, GraphicPlaybackEvent } from '../models/timeline-event';
import type { Shot } from '../models/shot';

export function findGraphicFrameKey(shot: Shot, layerId: string, animationId: string, timeMs: number): GraphicFrameEvent | undefined {
  const time = resolveTimelineFrameTime(timeMs, shot.durationMs);
  return shot.timelineEvents.find((event): event is GraphicFrameEvent =>
    event.type === 'graphic-frame' && event.layerId === layerId && event.animationId === animationId &&
    event.startMs === time);
}

export function setGraphicFrameAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  animationId: string,
  sourceFrameIndex: number,
  timeMs: number,
): Project {
  const shot = project.shots.find((entry) => entry.id === shotId);
  const layer = shot?.layers.find((entry) => entry.id === layerId);
  const definition = project.animations.find((entry) => entry.id === animationId);
  if (!shot || layer?.source.kind !== 'animation' || layer.source.animationId !== animationId ||
      !definition || !isFlaGraphicDefinition(definition)) {
    throw new Error('请重新选择当前镜头里的 Graphic 实例。');
  }
  if (layer.locked) throw new Error('该图层已锁定。');
  const offset = sourceFrameIndex - definition.source.startFrameIndex;
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      offset >= resolveFlaGraphicPreviewTimeline(definition, true).totalFrames) {
    throw new Error('该帧不在当前元件的源时间轴内。');
  }
  const time = resolveTimelineFrameTime(timeMs, shot.durationMs);
  const previous = findGraphicFrameKey(shot, layerId, animationId, time);
  const playbackRange = findGraphicPlaybackAtTime(shot.timelineEvents, layerId, animationId, time);
  if (previous?.sourceFrameIndex === sourceFrameIndex && !playbackRange) return project;
  const event: GraphicFrameEvent = {
    id: previous?.id ?? crypto.randomUUID(), type: 'graphic-frame', layerId, animationId,
    startMs: time, endMs: time, sourceFrameIndex,
  };
  const timelineEvents = shot.timelineEvents.flatMap((entry): Shot['timelineEvents'] => {
    if (entry === previous) return [event];
    // A new direct key ends just this synchronization window. Other windows
    // and older authored keys retain their own positions.
    if (entry === playbackRange) return entry.startMs < time ? [{ ...entry, endMs: time }] : [];
    return [entry];
  });
  if (!previous) timelineEvents.push(event);
  return replaceGraphicEvents(project, shot, timelineEvents);
}

export function clearGraphicFrameAtTime(
  project: Project, shotId: string, layerId: string, animationId: string, timeMs: number, eventId: string,
): Project {
  const shot = project.shots.find((entry) => entry.id === shotId);
  const layer = shot?.layers.find((entry) => entry.id === layerId);
  if (!shot || layer?.source.kind !== 'animation' || layer.source.animationId !== animationId) return project;
  if (layer.locked) throw new Error('该图层已锁定。');
  const key = findGraphicFrameKey(shot, layerId, animationId, timeMs);
  if (key?.id !== eventId) return project;
  return replaceGraphicEvents(project, shot, shot.timelineEvents.filter((event) => event !== key));
}

export interface GraphicPlaybackSettings {
  firstFrame: number;
  range: AnimationSourceRange;
  playback: AnimationPlayback;
}

export function getGraphicPlaybackSyncContext(project: Project, shot: Shot, layer: Layer, timeMs: number) {
  const source = layer.source;
  const playback = layer.animationPlayback;
  if (source.kind !== 'animation' || !playback || layer.locked) return null;
  const definition = project.animations.find((entry) => entry.id === source.animationId);
  if (!definition || !isFlaGraphicDefinition(definition)) return null;
  const timeline = resolveFlaGraphicPreviewTimeline(definition, true);
  if (timeline.totalFrames < 2) return null;

  const startMs = resolveTimelineFrameTime(timeMs, shot.durationMs);
  const events = shot.timelineEvents.filter((event) => event.layerId === layer.id);
  const ranges = events.filter((event): event is GraphicPlaybackEvent =>
    event.type === 'graphic-playback' && event.animationId === definition.id);
  const current = findGraphicPlaybackAtTime(ranges, layer.id, definition.id, startMs);
  const defaultRange = { firstFrame: layer.animationFirstFrame ?? 0, lastFrame: timeline.totalFrames - 1 };
  const range = current?.range ?? layer.animationSourceRange ?? defaultRange;
  const latestKey = events.filter((event): event is GraphicFrameEvent =>
    event.type === 'graphic-frame' && event.animationId === definition.id &&
    event.startMs <= startMs).sort((left, right) => right.startMs - left.startMs)[0];
  const firstFrame = current?.firstFrame ?? (latestKey
    ? latestKey.sourceFrameIndex - definition.source.startFrameIndex : range.firstFrame);

  // Panda layers have one instance start and no time-varying source link.
  // Visibility events and once/hide playback are the actual gaps in this model.
  const boundaries = new Set([startMs, shot.durationMs]);
  for (const event of events) if (event.type === 'visibility') boundaries.add(event.startMs);
  const addPlaybackEnd = (origin: number, frameCount: number, fps: number): void => {
    const last = Math.floor(origin + frameCount * 1_000 / fps);
    // The evaluator also recognizes rounded Timeline frame stamps at the boundary.
    boundaries.add(last - 1);
    boundaries.add(last);
    boundaries.add(last + 1);
  };
  if (playback.mode === 'once' && playback.endBehavior === 'hide') {
    const sourceRange = layer.animationSourceRange;
    const frameCount = sourceRange ? sourceRange.lastFrame - sourceRange.firstFrame + 1
      : definition.frames.length - Math.min(defaultRange.firstFrame, definition.frames.length - 1);
    addPlaybackEnd(layer.startTimeMs ?? 0, frameCount, sourceRange ? timeline.fps : definition.source.sourceFps);
  }
  for (const entry of ranges) {
    boundaries.add(entry.startMs);
    boundaries.add(entry.endMs);
    if (entry.playback.mode === 'once' && entry.playback.endBehavior === 'hide') {
      addPlaybackEnd(entry.playbackStartMs, entry.range.lastFrame - entry.firstFrame + 1, timeline.fps);
    }
  }
  const endMs = [...boundaries].filter((boundary) => boundary >= startMs && boundary < shot.durationMs)
    .sort((left, right) => left - right).find((boundary) => {
      const state = evaluateLayerPreTrackState(shot, layer, boundary, project, events);
      return !state.visible || !state.animationVisible;
    }) ?? shot.durationMs;

  return {
    startMs, endMs, totalFrames: timeline.totalFrames,
    settings: { firstFrame, range, playback: current?.playback ?? playback } satisfies GraphicPlaybackSettings,
  };
}

export function syncGraphicPlaybackForward(
  project: Project, shotId: string, layerId: string, animationId: string, timeMs: number,
  requestedEndMs: number, settings: GraphicPlaybackSettings,
): Project {
  const shot = project.shots.find((entry) => entry.id === shotId);
  const layer = shot?.layers.find((entry) => entry.id === layerId);
  if (!shot || layer?.source.kind !== 'animation' || layer.source.animationId !== animationId || layer.locked) {
    throw new Error('请选择当前镜头中未锁定的 Graphic 实例。');
  }
  const context = getGraphicPlaybackSyncContext(project, shot, layer, timeMs);
  if (!context || !Number.isSafeInteger(requestedEndMs) || requestedEndMs > shot.durationMs ||
      requestedEndMs <= context.startMs || context.endMs <= context.startMs) {
    throw new Error('请选择播放头之后的有效结束时间。');
  }
  const { startMs } = context;
  const endMs = Math.min(context.endMs, requestedEndMs);
  const { firstFrame, range, playback } = settings;
  if (![firstFrame, range.firstFrame, range.lastFrame].every(Number.isSafeInteger) ||
      range.firstFrame < 0 || firstFrame < range.firstFrame || firstFrame > range.lastFrame ||
      range.lastFrame >= context.totalFrames) {
    throw new Error('起始帧必须在有效的源帧范围内。');
  }
  const active = findGraphicPlaybackAtTime(shot.timelineEvents, layerId, animationId, startMs);
  if (active?.startMs === startMs && active.playbackStartMs === startMs && active.endMs === endMs &&
      active.firstFrame === firstFrame && active.range.firstFrame === range.firstFrame && active.range.lastFrame === range.lastFrame &&
      active.playback.mode === playback.mode && active.playback.endBehavior === playback.endBehavior) return project;

  const sync: GraphicPlaybackEvent = {
    id: active?.startMs === startMs ? active.id : crypto.randomUUID(),
    type: 'graphic-playback', layerId, animationId, startMs, endMs,
    playbackStartMs: startMs, firstFrame, range, playback,
  };
  const timelineEvents = shot.timelineEvents.flatMap((entry): Shot['timelineEvents'] => {
    if (entry.type !== 'graphic-playback' || entry.layerId !== layerId || entry.animationId !== animationId ||
        entry.endMs <= startMs || entry.startMs >= endMs) return [entry];
    const retained: GraphicPlaybackEvent[] = [];
    const keepLeft = entry.startMs < startMs;
    if (keepLeft) retained.push({ ...entry, endMs: startMs });
    if (entry.endMs > endMs) {
      // Keep the original clock on the right so the existing playback resumes
      // in phase even when the player seeks directly into that fragment.
      retained.push({ ...entry, id: keepLeft || entry.id === sync.id ? crypto.randomUUID() : entry.id, startMs: endMs });
    }
    return retained;
  });
  return replaceGraphicEvents(project, shot, [...timelineEvents, sync]);
}

function replaceGraphicEvents(project: Project, shot: Shot, timelineEvents: Shot['timelineEvents']): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot ? { ...shot, timelineEvents } : entry),
  });
}
