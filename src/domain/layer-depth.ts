import { NATIVE_CAMERA_FOCAL_LENGTH } from './camera-projection';
import { LAYER_DEPTH_MAX, LAYER_DEPTH_MIN } from './constants';
import { evaluateAnimationTrackAtTime, sliceAnimationCurve } from './evaluate-animation-core';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import { resolveLayerParentBindingAtTime } from './layer-parent-space';
import { ProjectSchema, type Layer, type Project, type Shot } from './models';
import { resolveTimelineFrameTime } from './timeline/frame-grid';

export interface ParallaxDepthSliderRange {
  readonly focalLength?: number;
  readonly minDepth?: number;
  readonly maxDepth?: number;
}

function resolveParallaxRange(options?: ParallaxDepthSliderRange): {
  focalLength: number;
  minDepth: number;
  maxDepth: number;
  parallaxNear: number;
  parallaxFar: number;
} {
  const focalLength = options?.focalLength ?? NATIVE_CAMERA_FOCAL_LENGTH;
  const minDepth = options?.minDepth ?? LAYER_DEPTH_MIN;
  const maxDepth = options?.maxDepth ?? LAYER_DEPTH_MAX;
  const parallaxNear = focalLength / (focalLength + minDepth);
  const parallaxFar = focalLength / (focalLength + maxDepth);
  return { focalLength, minDepth, maxDepth, parallaxNear, parallaxFar };
}

/**
 * Map layer depth to a normalized [0, 1] near->far slider position by
 * reference rest parallax p = F / (F + d), matching AniCraft's layer_depth
 * perceptual distribution using Panda's own focal length and depth bounds.
 */
export function depthToParallaxSlider(
  depth: number,
  options?: ParallaxDepthSliderRange,
): number {
  const { focalLength, minDepth, maxDepth, parallaxNear, parallaxFar } = resolveParallaxRange(options);
  const clamped = Number.isFinite(depth)
    ? Math.max(minDepth, Math.min(maxDepth, depth))
    : 0;
  if (clamped <= minDepth) return 0;
  if (clamped >= maxDepth) return 1;
  const parallax = focalLength / (focalLength + clamped);
  const u = (parallaxNear - parallax) / (parallaxNear - parallaxFar);
  return Math.max(0, Math.min(1, u));
}

/** Inverse of `depthToParallaxSlider`: maps normalized [0, 1] slider to depth. */
export function parallaxSliderToDepth(
  slider: number,
  options?: ParallaxDepthSliderRange,
): number {
  const { focalLength, minDepth, maxDepth, parallaxNear, parallaxFar } = resolveParallaxRange(options);
  const u = Number.isFinite(slider) ? Math.max(0, Math.min(1, slider)) : depthToParallaxSlider(0, options);
  if (u <= 0) return minDepth;
  if (u >= 1) return maxDepth;
  const parallax = parallaxNear - u * (parallaxNear - parallaxFar);
  const raw = focalLength / parallax - focalLength;
  const clamped = Math.max(minDepth, Math.min(maxDepth, raw));
  return Object.is(clamped, -0) ? 0 : clamped;
}

export const PARALLAX_SLIDER_ZERO_POSITION = depthToParallaxSlider(0);

export type LayerDepthSourceKind =
  | 'depth-keys'
  | 'dynamic-preserve'
  | 'dynamic-inherit'
  | 'own-static'
  | 'inherited-static'
  | 'default';

export interface LayerDepthSourceInfo {
  readonly kind: LayerDepthSourceKind;
  readonly parentLayerId?: string;
  readonly parentLayerName?: string;
  readonly keyTimeMs?: number;
}

/** Describe where a layer's effective depth originates at `timeMs` without mutating state. */
export function resolveLayerDepthSource(
  shot: Shot,
  layer: Layer,
  timeMs: number,
): LayerDepthSourceInfo {
  if (layer.depthKeys?.length) {
    return { kind: 'depth-keys' };
  }
  const binding = resolveLayerParentBindingAtTime(layer, timeMs);
  const parentLayer = binding.parentLayerId
    ? shot.layers.find((candidate) => candidate.id === binding.parentLayerId)
    : undefined;
  if (binding.source === 'key') {
    if (binding.depthMode === 'preserve') {
      return {
        kind: 'dynamic-preserve',
        keyTimeMs: binding.keyTimeMs,
        ...(parentLayer ? { parentLayerId: parentLayer.id, parentLayerName: parentLayer.name } : {}),
      };
    }
    if (binding.depthMode === 'inherit' && parentLayer) {
      return {
        kind: 'dynamic-inherit',
        keyTimeMs: binding.keyTimeMs,
        parentLayerId: parentLayer.id,
        parentLayerName: parentLayer.name,
      };
    }
    if (layer.depth !== undefined) {
      return { kind: 'own-static', keyTimeMs: binding.keyTimeMs };
    }
    if (parentLayer) {
      return {
        kind: 'dynamic-inherit',
        keyTimeMs: binding.keyTimeMs,
        parentLayerId: parentLayer.id,
        parentLayerName: parentLayer.name,
      };
    }
    return { kind: 'default', keyTimeMs: binding.keyTimeMs };
  }
  if (layer.depth !== undefined) {
    return { kind: 'own-static' };
  }
  if (parentLayer) {
    return {
      kind: 'inherited-static',
      parentLayerId: parentLayer.id,
      parentLayerName: parentLayer.name,
    };
  }
  return { kind: 'default' };
}

function clampDepthValue(depth: number): number {
  return Math.max(LAYER_DEPTH_MIN, Math.min(LAYER_DEPTH_MAX, depth));
}

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

/**
 * Update depth for one dynamic parent-key handoff segment without silently
 * rewriting the static base depth or other handoff segments.
 */
export function setLayerParentKeyDepth(
  project: Project,
  shotId: string,
  layerId: string,
  keyTimeMs: number,
  depth?: number,
): Project {
  return editLayerDepth(project, shotId, layerId, (layer) => {
    if (layer.depthKeys?.length || !layer.parentKeys?.length) return layer;
    const index = layer.parentKeys.findIndex((key) => key.timeMs === keyTimeMs);
    if (index < 0) return layer;
    const target = layer.parentKeys[index]!;
    if (depth === undefined) {
      if (!target.parentLayerId) return layer;
      if (target.depthMode === 'inherit' && target.depth === undefined) return layer;
      const nextKey = { ...target, depthMode: 'inherit' as const, depth: undefined };
      return {
        ...layer,
        parentKeys: layer.parentKeys.map((key, i) => (i === index ? nextKey : key)),
      };
    }
    const clamped = clampDepthValue(depth);
    if (target.depthMode === 'preserve' && target.depth === clamped) return layer;
    const nextKey = { ...target, depthMode: 'preserve' as const, depth: clamped };
    return {
      ...layer,
      parentKeys: layer.parentKeys.map((key, i) => (i === index ? nextKey : key)),
    };
  });
}

/**
 * Apply a depth edit scoped to the layer's current authoring mode at `timeMs`:
 * - animated `depthKeys` -> edits current frame key via `setLayerDepthKey`
 * - active dynamic `parentKey` segment -> edits only that segment via `setLayerParentKeyDepth`
 * - static base -> edits `layer.depth` via `setLayerDepth`
 */
export function applyScopedLayerDepthEdit(
  project: Project,
  shotId: string,
  layerId: string,
  timeMs: number,
  depth?: number,
): Project {
  const shot = project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  if (!shot || !layer || !canEditLayerDepth(layer, shot)) return project;
  if (layer.depthKeys?.length) {
    if (depth === undefined) return project;
    return setLayerDepthKey(project, shotId, layerId, timeMs, clampDepthValue(depth));
  }
  const binding = resolveLayerParentBindingAtTime(layer, timeMs);
  if (binding.source === 'key' && binding.keyTimeMs !== undefined) {
    return setLayerParentKeyDepth(project, shotId, layerId, binding.keyTimeMs, depth);
  }
  return setLayerDepth(project, shotId, layerId, depth === undefined ? undefined : clampDepthValue(depth));
}
