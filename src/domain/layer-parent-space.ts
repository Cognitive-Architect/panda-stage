import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../shared/affine-matrix';
import { resolveLayerAttachmentLocalMatrix } from './layer-attachment';
import { resolveCharacterActionRenderTransform } from './selectors/visualParts';
import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import type { EvaluatedLayer } from './evaluate-shot-at-time';
import type { Layer, Project, Shot } from './models';
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

export function applyLayerParenting(project: Project, shot: Shot, layers: EvaluatedLayer[], timeMs: number): EvaluatedLayer[] {
  if (!shot.layers.some((layer) =>
    layer.parentLayerId || layer.parentSpaceOffset || layer.depth !== undefined || layer.depthKeys || layer.cameraSpace,
  )) return layers;
  const evaluated = new Map(layers.map((layer) => [layer.id, layer]));
  const usingAttachmentFallback = new Set<string>();
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
      let targetWorld = parent;
      if (parent && parentId && layer?.parentAttachment) {
        const owner = authored.get(parentId)!;
        const ownerPose = evaluated.get(parentId)!;
        const targetLocal = resolveLayerAttachmentLocalMatrix(project, owner, ownerPose, layer.parentAttachment.target);
        if (!targetLocal) usingAttachmentFallback.add(entry);
        targetWorld = layerAttachmentWorldMatrix(
          ownerPose, targetLocal ?? layer.parentAttachment.ownerLocalFallback, spaces.get(parentId),
        );
      }
      const offset = layer?.parentSpaceOffset;
      const space = targetWorld && offset ? multiplyAffineMatrices(targetWorld, offset) : targetWorld ?? offset;
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
