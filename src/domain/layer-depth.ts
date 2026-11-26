import { evaluateAnimationTrackAtTime, sliceAnimationCurve } from './evaluate-animation-core';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import { ProjectSchema, type Layer, type Project, type Shot } from './models';
import { resolveTimelineFrameTime } from './timeline/frame-grid';

function editLayerDepth(
  project: Project,
  shotId: string,
  layerId: string,
  edit: (layer: Layer, shot: Shot) => Layer,
): Project {
  const shot = project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  if (!shot || !layer || !canEditLayerDepth(layer, shot)) return project;
  const changed = edit(layer, shot);
  if (changed === layer) return project;
  return ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    shots: project.shots.map((candidate) => candidate === shot
      ? { ...shot, layers: shot.layers.map((entry) => entry === layer ? changed : entry) }
      : candidate),
  });
}

export function canEditLayerDepth(layer: Layer, shot: Shot): boolean {
  return !layer.locked || shot.backgroundLayerId === layer.id;
}

export function setLayerDepth(project: Project, shotId: string, layerId: string, depth?: number): Project {
  return editLayerDepth(project, shotId, layerId, (layer) =>
    layer.depthKeys?.length || layer.depth === depth ? layer : { ...layer, depth });
}

export function setLayerDepthKey(
  project: Project, shotId: string, layerId: string, requestedTimeMs: number, depth?: number,
): Project {
  return editLayerDepth(project, shotId, layerId, (layer, shot) => {
    const timeMs = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
    const depthAt = (time: number) => evaluateShotAtTime(shot, time, project)
      .layers.find(({ id }) => id === layerId)?.effectiveDepth ?? 0;
    const keys = [...(layer.depthKeys ?? [])];
    if (!keys.length && timeMs > 0) {
      keys.push({ timeMs: 0, value: depthAt(0), interpolationToNext: 'linear' });
    }
    const next = keys.findIndex((key) => key.timeMs >= timeMs);
    if (keys[next]?.timeMs === timeMs) {
      if (depth === undefined || depth === keys[next]!.value) return layer;
      keys[next] = { ...keys[next]!, value: depth };
    } else {
      const value = depth ?? depthAt(timeMs);
      const previous = keys[next - 1];
      const following = keys[next];
      if (previous && following) {
        const split = (timeMs - previous.timeMs) / (following.timeMs - previous.timeMs);
        keys[next - 1] = { ...previous, curveToNext: sliceAnimationCurve(previous.curveToNext, 0, split) };
        keys.splice(next, 0, {
          timeMs, value, interpolationToNext: previous.interpolationToNext,
          curveToNext: sliceAnimationCurve(previous.curveToNext, split, 1),
        });
      } else {
        keys.splice(next < 0 ? keys.length : next, 0, { timeMs, value, interpolationToNext: 'linear' });
      }
    }
    return { ...layer, depthKeys: keys };
  });
}

export function moveLayerDepthKey(
  project: Project, shotId: string, layerId: string, timeMs: number, requestedTimeMs: number,
): Project {
  return editLayerDepth(project, shotId, layerId, (layer, shot) => {
    const keys = layer.depthKeys;
    const index = keys?.findIndex((key) => key.timeMs === timeMs) ?? -1;
    if (!keys || index < 0) return layer;
    const nextTime = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
    const previous = keys[index - 1];
    const next = keys[index + 1];
    if (nextTime === timeMs || (previous && nextTime <= previous.timeMs) || (next && nextTime >= next.timeMs)) return layer;
    return { ...layer, depthKeys: keys.map((key, i) => i === index ? { ...key, timeMs: nextTime } : key) };
  });
}

export function removeLayerDepthKey(
  project: Project, shotId: string, layerId: string, timeMs: number,
): Project {
  return editLayerDepth(project, shotId, layerId, (layer) => {
    const keys = layer.depthKeys;
    if (!keys?.some((key) => key.timeMs === timeMs)) return layer;
    const remaining = keys.filter((key) => key.timeMs !== timeMs);
    return remaining.length ? { ...layer, depthKeys: remaining } : {
      ...layer, depthKeys: undefined, depth: evaluateAnimationTrackAtTime({ keys }, timeMs),
    };
  });
}
