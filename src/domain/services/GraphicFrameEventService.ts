import { ProjectSchema, type Project } from '../models/project';
import { isFlaGraphicDefinition } from '../models/animation';
import { resolveFlaGraphicPreviewTimeline } from '../selectors/animationSourceTimeline';
import { resolveTimelineFrameTime } from '../timeline/frame-grid';
import type { GraphicFrameEvent } from '../models/timeline-event';
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
  if (previous?.sourceFrameIndex === sourceFrameIndex) return project;
  const event: GraphicFrameEvent = {
    id: previous?.id ?? crypto.randomUUID(), type: 'graphic-frame', layerId, animationId,
    startMs: time, endMs: time, sourceFrameIndex,
  };
  const timelineEvents = previous
    ? shot.timelineEvents.map((entry) => entry === previous ? event : entry)
    : [...shot.timelineEvents, event];
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot ? { ...shot, timelineEvents } : entry),
  });
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
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot
      ? { ...shot, timelineEvents: shot.timelineEvents.filter((event) => event !== key) }
      : entry),
  });
}
