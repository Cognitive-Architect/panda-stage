import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../shared/affine-matrix';
import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import type { EvaluatedLayer } from './evaluate-shot-at-time';
import type { Layer, Shot } from './models';
import { composeAffineMatrix } from './models/flaGraphicTimeline';

export function layerPoseMatrix(layer: Pick<EvaluatedLayer, 'x' | 'y' | 'flipX' | 'rotationDeg' | 'scaleX' | 'scaleY'>): AffineMatrix2D {
  return composeAffineMatrix({
    tx: layer.x, ty: layer.y, rotationDeg: layer.rotationDeg % 360,
    scaleX: layer.flipX ? -layer.scaleX : layer.scaleX, scaleY: layer.scaleY,
  });
}

export function validLayerParentTargets(shot: Shot, childId: string): Layer[] {
  const byId = new Map(shot.layers.map((layer) => [layer.id, layer]));
  return shot.layers.filter((candidate) => {
    const seen = new Set([childId]);
    let layer: Layer | undefined = candidate;
    while (layer) {
      if (seen.has(layer.id)) return false;
      seen.add(layer.id);
      layer = layer.parentLayerId ? byId.get(layer.parentLayerId) : undefined;
    }
    return true;
  });
}

export function applyLayerParenting(shot: Shot, layers: EvaluatedLayer[], timeMs: number): EvaluatedLayer[] {
  if (!shot.layers.some((layer) =>
    layer.parentLayerId || layer.parentSpaceOffset || layer.depth !== undefined || layer.depthKeys || layer.cameraSpace,
  )) return layers;
  const authored = new Map(shot.layers.map((layer) => [layer.id, layer]));
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
      current = authored.get(current)?.parentLayerId;
    }
    for (const entry of chain.reverse()) {
      const layer = authored.get(entry);
      const parentId = invalidEdges.has(entry) ? undefined : layer?.parentLayerId;
      const parent = parentId ? world.get(parentId) : undefined;
      const depth = layer?.depthKeys?.length
        ? evaluateAnimationTrackAtTime({ keys: layer.depthKeys }, timeMs)
        : layer?.depth ?? (parentId ? depths.get(parentId) : undefined);
      const cameraSpace = parentId && parent ? cameraSpaces.get(parentId) : layer?.cameraSpace;
      if (depth !== undefined) depths.set(entry, depth);
      if (cameraSpace !== undefined) cameraSpaces.set(entry, cameraSpace);
      const offset = layer?.parentSpaceOffset;
      const space = parent && offset ? multiplyAffineMatrices(parent, offset) : parent ?? offset;
      const pose = local.get(entry)!;
      const posed = space && multiplyAffineMatrices(space, pose);
      if (layer?.parentLayerId && !invalidEdges.has(entry) && unavailable.has(layer.parentLayerId)) unavailable.add(entry);
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
      ...(effectiveDepth !== undefined ? { effectiveDepth } : {}),
      ...(effectiveCameraSpace ? { effectiveCameraSpace } : {}),
      ...(unavailable.has(layer.id) ? { parentSpaceUnavailable: true } : {}),
      ...(parentSpace ? { parentSpace } : {}),
    };
  });
}

export function evaluatedLayerWorldMatrix(layer: EvaluatedLayer): AffineMatrix2D {
  const pose = layerPoseMatrix(layer);
  return layer.parentSpace ? multiplyAffineMatrices(layer.parentSpace, pose) : pose;
}
