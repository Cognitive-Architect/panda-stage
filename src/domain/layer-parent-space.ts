import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../shared/affine-matrix';
import { resolveLayerAttachmentLocalMatrix } from './layer-attachment';
import { resolveCharacterActionRenderTransform } from './selectors/visualParts';
import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import type { EvaluatedLayer } from './evaluate-shot-at-time';
import type {
  Layer,
  LayerParentAttachment,
  LayerParentKey,
  LayerParentKeyDepthMode,
  LayerSpaceMatrix,
  Project,
  Shot,
} from './models';
import { composeAffineMatrix } from './models/flaGraphicTimeline';

export interface ActiveLayerParentBinding {
  readonly source: 'base' | 'key';
  readonly keyTimeMs?: number;
  readonly key?: LayerParentKey;
  readonly parentLayerId: string | undefined;
  readonly parentAttachment: LayerParentAttachment | undefined;
  readonly parentSpaceOffset: LayerSpaceMatrix | undefined;
  readonly depthMode: LayerParentKeyDepthMode | undefined;
  readonly keyDepth: number | undefined;
  readonly cameraSpace: 'world' | 'screen' | undefined;
}

export function resolveLayerParentBindingAtTime(layer: Layer, timeMs: number): ActiveLayerParentBinding {
  const keys = layer.parentKeys;
  if (keys?.length) {
    let active: LayerParentKey | undefined;
    for (const key of keys) {
      if (key.timeMs <= timeMs) active = key;
      else break;
    }
    if (active) {
      return {
        source: 'key',
        keyTimeMs: active.timeMs,
        key: active,
        parentLayerId: active.parentLayerId ?? undefined,
        parentAttachment: active.parentLayerId ? active.parentAttachment : undefined,
        parentSpaceOffset: active.parentSpaceOffset,
        depthMode: active.depthMode,
        keyDepth: active.depth,
        cameraSpace: active.cameraSpace,
      };
    }
  }
  return {
    source: 'base',
    parentLayerId: layer.parentLayerId,
    parentAttachment: layer.parentAttachment,
    parentSpaceOffset: layer.parentSpaceOffset,
    depthMode: undefined,
    keyDepth: undefined,
    cameraSpace: layer.cameraSpace,
  };
}

export function layerPoseMatrix(layer: Pick<EvaluatedLayer, 'x' | 'y' | 'flipX' | 'rotationDeg' | 'scaleX' | 'scaleY'>): AffineMatrix2D {
  return composeAffineMatrix({
    tx: layer.x, ty: layer.y, rotationDeg: layer.rotationDeg % 360,
    scaleX: layer.flipX ? -layer.scaleX : layer.scaleX, scaleY: layer.scaleY,
  });
}

function parentCycleSampleTimes(shot: Shot, startTimeMs: number, endTimeMs: number): number[] {
  const times = new Set<number>([startTimeMs]);
  for (const layer of shot.layers) {
    for (const key of layer.parentKeys ?? []) {
      if (key.timeMs >= startTimeMs && key.timeMs < endTimeMs) {
        times.add(key.timeMs);
      }
    }
  }
  return [...times].sort((left, right) => left - right);
}

export function validLayerParentTargets(
  shot: Shot,
  childId: string,
  timeMs?: number,
  endTimeMs?: number,
): Layer[] {
  const byId = new Map(shot.layers.map((layer) => [layer.id, layer]));
  const child = byId.get(childId);
  const rangeStart = timeMs ?? 0;
  const rangeEnd = endTimeMs ?? (timeMs === undefined ? (child?.parentKeys?.[0]?.timeMs ?? Infinity) : Infinity);
  const sampleTimes = parentCycleSampleTimes(shot, rangeStart, rangeEnd);
  return shot.layers.filter((candidate) => {
    if (candidate.id === childId) return false;
    for (const sampleTime of sampleTimes) {
      const seen = new Set([childId]);
      let layer: Layer | undefined = candidate;
      while (layer) {
        if (seen.has(layer.id)) return false;
        seen.add(layer.id);
        const nextParentId: string | undefined = resolveLayerParentBindingAtTime(layer, sampleTime).parentLayerId;
        layer = nextParentId ? byId.get(nextParentId) : undefined;
      }
    }
    return true;
  });
}

export function applyLayerParenting(project: Project, shot: Shot, layers: EvaluatedLayer[], timeMs: number): EvaluatedLayer[] {
  if (!shot.layers.some((layer) =>
    layer.parentLayerId || layer.parentSpaceOffset || layer.parentKeys?.length ||
    layer.depth !== undefined || layer.depthKeys || layer.cameraSpace,
  )) return layers;
  const evaluated = new Map(layers.map((layer) => [layer.id, layer]));
  const usingAttachmentFallback = new Set<string>();
  const authored = new Map(shot.layers.map((layer) => [layer.id, layer]));
  const bindings = new Map(shot.layers.map((layer) => [layer.id, resolveLayerParentBindingAtTime(layer, timeMs)]));
  const local = new Map(layers.map((layer) => [layer.id, layerPoseMatrix(layer)]));
  const depths = new Map<string, number>();
  const cameraSpaces = new Map<string, 'world' | 'screen'>();
  const spaces = new Map<string, AffineMatrix2D>();
  const world = new Map<string, AffineMatrix2D>();
  const invalidEdges = new Set<string>();
  const unavailable = new Set<string>();

  for (const { id } of layers) {
    const chain: string[] = [];
    const path = new Map<string, number>();
    let current: string | undefined = id;
    while (current && local.has(current) && !world.has(current)) {
      const cycleStart = path.get(current);
      if (cycleStart !== undefined) {
        chain.slice(cycleStart).forEach((entry) => invalidEdges.add(entry));
        break;
      }
      path.set(current, chain.length);
      chain.push(current);
      current = bindings.get(current)?.parentLayerId;
    }
    for (const entry of chain.reverse()) {
      const layer = authored.get(entry);
      const binding = bindings.get(entry);
      const parentId = invalidEdges.has(entry) ? undefined : binding?.parentLayerId;
      const parent = parentId ? world.get(parentId) : undefined;
      let depth: number | undefined;
      if (layer?.depthKeys?.length) {
        depth = evaluateAnimationTrackAtTime({ keys: layer.depthKeys }, timeMs);
      } else if (binding?.source === 'key') {
        if (binding.depthMode === 'preserve') {
          depth = binding.keyDepth ?? layer?.depth;
        } else if (binding.depthMode === 'inherit' && parentId) {
          depth = depths.get(parentId) ?? (layer?.depth !== undefined ? 0 : undefined);
        } else if (parentId) {
          depth = layer?.depth ?? depths.get(parentId);
        } else {
          depth = binding.keyDepth ?? layer?.depth;
        }
      } else {
        depth = layer?.depth ?? (parentId ? depths.get(parentId) : undefined);
      }
      const cameraSpace = parentId && parent
        ? cameraSpaces.get(parentId)
        : (binding?.cameraSpace ?? layer?.cameraSpace);
      if (depth !== undefined) depths.set(entry, depth);
      if (cameraSpace !== undefined) cameraSpaces.set(entry, cameraSpace);
      let targetWorld = parent;
      if (parent && parentId && binding?.parentAttachment) {
        const owner = authored.get(parentId)!;
        const ownerPose = evaluated.get(parentId)!;
        const targetLocal = resolveLayerAttachmentLocalMatrix(project, owner, ownerPose, binding.parentAttachment.target);
        if (!targetLocal) usingAttachmentFallback.add(entry);
        targetWorld = layerAttachmentWorldMatrix(
          ownerPose, targetLocal ?? binding.parentAttachment.ownerLocalFallback, spaces.get(parentId),
        );
      }
      const offset = binding?.parentSpaceOffset;
      const space = targetWorld && offset ? multiplyAffineMatrices(targetWorld, offset) : targetWorld ?? offset;
      const pose = local.get(entry)!;
      const posed = space && multiplyAffineMatrices(space, pose);
      if (parentId && unavailable.has(parentId)) unavailable.add(entry);
      if (!unavailable.has(entry) && space && posed && invertAffineMatrix(space) && Object.values(posed).every(Number.isFinite)) {
        spaces.set(entry, space);
        world.set(entry, posed);
      } else {
        if (space) unavailable.add(entry);
        world.set(entry, pose);
      }
    }
  }
  return layers.map((layer) => {
    const effectiveDepth = depths.get(layer.id);
    const effectiveCameraSpace = cameraSpaces.get(layer.id);
    const parentSpace = spaces.get(layer.id);
    return {
      ...layer,
      parentSpace: undefined,
      parentSpaceUnavailable: undefined,
      parentAttachmentFallback: usingAttachmentFallback.has(layer.id) || undefined,
      ...(effectiveDepth !== undefined ? { effectiveDepth } : {}),
      ...(effectiveCameraSpace ? { effectiveCameraSpace } : {}),
      ...(unavailable.has(layer.id) ? { parentSpaceUnavailable: true } : {}),
      ...(parentSpace ? { parentSpace } : {}),
    };
  });
}

export function layerAttachmentWorldMatrix(
  owner: EvaluatedLayer, targetLocal: AffineMatrix2D, ownerSpace: AffineMatrix2D | undefined,
): AffineMatrix2D {
  const ownerLocal = layerPoseMatrix(resolveCharacterActionRenderTransform(owner));
  const targetInParent = multiplyAffineMatrices(ownerLocal, targetLocal);
  return ownerSpace ? multiplyAffineMatrices(ownerSpace, targetInParent) : targetInParent;
}

export function evaluatedLayerWorldMatrix(layer: EvaluatedLayer): AffineMatrix2D {
  const pose = layerPoseMatrix(layer);
  return layer.parentSpace ? multiplyAffineMatrices(layer.parentSpace, pose) : pose;
}
