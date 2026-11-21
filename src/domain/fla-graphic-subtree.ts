import {
  evaluateFlaGraphicNodeCompositePlan,
  type EvaluatedFlaGraphicLayer,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVisual,
} from './evaluate-fla-graphic';
import {
  unionFlaShapeRegionBounds,
  type FlaEditableShapeRegion,
} from './fla-shape-vector';
import type { FlaGraphicStructureFrame, FlaGraphicStructureNode } from './models';

export interface FlaGraphicAssetDimensionLike {
  readonly id: string;
  readonly kind: string;
  readonly width?: number;
  readonly height?: number;
}

const subtreeVisualCache = new WeakMap<
  EvaluatedFlaGraphicVisual,
  Map<string, EvaluatedFlaGraphicVisual>
>();

function sameNodePath(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isStrictPrefixPath(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length >= full.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== full[index]) return false;
  }
  return true;
}

export interface FlaGraphicSubtreeRegionSelection {
  readonly regionRef?: string;
  readonly regionVector?: FlaEditableShapeRegion;
}

function filterNodeSubtree(
  node: EvaluatedFlaGraphicNode,
  targetPath: readonly string[],
  regionSelection?: FlaGraphicSubtreeRegionSelection,
): EvaluatedFlaGraphicNode | null {
  if (sameNodePath(node.path, targetPath)) {
    const requestedRef = regionSelection?.regionRef;
    const providedVector = regionSelection?.regionVector;
    if (requestedRef || providedVector) {
      let resolvedVector = providedVector;
      if (requestedRef && resolvedVector && resolvedVector.regionRef !== requestedRef) {
        return null;
      }
      if (requestedRef && !resolvedVector && node.vectorVisual) {
        const matches = node.vectorVisual.regions.filter(
          (candidate) => candidate.regionRef === requestedRef,
        );
        if (matches.length === 1) {
          resolvedVector = matches[0];
        }
      }
      if (!resolvedVector) {
        // Fail closed: an incomplete or unmatched regionRef must never expand back into the full Shape.
        return null;
      }
      const baseViewBox =
        node.vectorVisual?.baseViewBox ??
        (node.source.type === 'opaque' && node.source.fallbackViewBox
          ? {
              x: node.source.fallbackViewBox.x,
              y: node.source.fallbackViewBox.y,
              width: node.source.fallbackViewBox.width,
              height: node.source.fallbackViewBox.height,
            }
          : { ...resolvedVector.bounds });
      return {
        ...node,
        vectorVisual: {
          baseViewBox,
          regions: [resolvedVector],
          ...(node.vectorVisual?.defsSvg
            ? { defsSvg: node.vectorVisual.defsSvg }
            : {}),
        },
        ...(requestedRef ? { regionRef: requestedRef } : {}),
      };
    }
    return node;
  }
  if (!isStrictPrefixPath(node.path, targetPath)) {
    return null;
  }
  const matchedChildren: EvaluatedFlaGraphicNode[] = [];
  for (const child of node.children) {
    const filtered = filterNodeSubtree(child, targetPath, regionSelection);
    if (filtered) matchedChildren.push(filtered);
  }
  if (matchedChildren.length === 0) return null;
  return {
    ...node,
    children: matchedChildren,
  };
}

function safeOpaqueFallback(
  node: Extract<FlaGraphicStructureNode, { type: 'opaque' }>,
): boolean {
  return Boolean(
    node.fallbackAssetId &&
      node.fallbackScope &&
      node.fallbackViewBox &&
      node.fallbackViewBox.width > 0 &&
      node.fallbackViewBox.height > 0,
  );
}

function collectRetainedResourceIds(
  nodes: readonly EvaluatedFlaGraphicNode[],
  target: Set<string>,
): void {
  for (const node of nodes) {
    if (node.source.type === 'bitmap' && node.source.assetId) {
      target.add(node.source.assetId);
    } else if (node.source.type === 'opaque' && safeOpaqueFallback(node.source)) {
      target.add(node.source.fallbackAssetId!);
    }
    if (node.children.length > 0) {
      collectRetainedResourceIds(node.children, target);
    }
  }
}

function toFilteredStructureNode(
  node: EvaluatedFlaGraphicNode,
): FlaGraphicStructureNode {
  if (node.source.type === 'group') {
    return {
      ...node.source,
      children: node.children.map(toFilteredStructureNode),
    };
  }
  return node.source;
}

function buildEmptyStructuredVisual(
  visual: EvaluatedFlaGraphicVisual,
): EvaluatedFlaGraphicVisual {
  return {
    ...visual,
    structureFrame: {
      ordinal: visual.frameOrdinal,
      layers: [],
    },
    layers: [],
    resourceAssetIds: [],
  };
}

/**
 * Pure, cache-friendly selector that isolates a single subtree at `nodePath`
 * inside an evaluated FLA Graphic visual without mutating the shared visual.
 * Preserves ancestor transforms, opacity, color transforms, and masks while
 * stripping sibling branches and returning an empty structured visual on miss.
 */
export function selectFlaGraphicSubtreeVisual(
  visual: EvaluatedFlaGraphicVisual,
  nodePath: readonly string[],
  regionSelection?: FlaGraphicSubtreeRegionSelection,
): EvaluatedFlaGraphicVisual {
  const useCache = !regionSelection?.regionVector && !regionSelection?.regionRef;
  const pathKey = useCache ? JSON.stringify(nodePath) : '';
  const cache = useCache ? subtreeVisualCache.get(visual) : undefined;
  const cached = useCache ? cache?.get(pathKey) : undefined;
  if (cached) return cached;

  let selected: EvaluatedFlaGraphicVisual;
  if (nodePath.length === 0 || !visual.structureFrame || !visual.layers) {
    selected = buildEmptyStructuredVisual(visual);
  } else {
    const matchedLayers: EvaluatedFlaGraphicLayer[] = [];
    const resourceAssetIds = new Set<string>();
    for (const layer of visual.layers) {
      const matchedNodes: EvaluatedFlaGraphicNode[] = [];
      for (const node of layer.nodes) {
        const filtered = filterNodeSubtree(node, nodePath, regionSelection);
        if (filtered) matchedNodes.push(filtered);
      }
      if (matchedNodes.length > 0) {
        collectRetainedResourceIds(matchedNodes, resourceAssetIds);
        matchedLayers.push({
          name: layer.name,
          nodes: matchedNodes,
        });
      }
    }
    if (matchedLayers.length === 0) {
      selected = buildEmptyStructuredVisual(visual);
    } else {
      const filteredStructureFrame: FlaGraphicStructureFrame = {
        ordinal: visual.structureFrame.ordinal,
        layers: matchedLayers.map((layer) => ({
          name: layer.name,
          nodes: layer.nodes.map(toFilteredStructureNode),
        })),
      };
      selected = {
        ...visual,
        structureFrame: filteredStructureFrame,
        layers: matchedLayers,
        resourceAssetIds: [...resourceAssetIds],
      };
    }
  }

  if (useCache) {
    let targetCache = cache;
    if (!targetCache) {
      targetCache = new Map();
      subtreeVisualCache.set(visual, targetCache);
    }
    if (targetCache.size < 256) targetCache.set(pathKey, selected);
  }
  return selected;
}

/** Whether `nodePath` matched at least one node in `visual`. */
export function hasMatchedFlaGraphicSubtree(
  visual: EvaluatedFlaGraphicVisual,
  nodePath: readonly string[],
): boolean {
  const selected = selectFlaGraphicSubtreeVisual(visual, nodePath);
  return Boolean(selected.layers?.some((layer) => layer.nodes.length > 0));
}

function hasRenderableLeaf(nodes: readonly EvaluatedFlaGraphicNode[]): boolean {
  for (const node of nodes) {
    if (!node.renderable) continue;
    if (node.vectorVisual) {
      if (
        node.vectorVisual.regions.length > 0 ||
        (node.vectorVisual.residueStrokes?.length ?? 0) > 0
      ) {
        return true;
      }
      continue;
    }
    if (node.source.type === 'bitmap' && Boolean(node.source.assetId)) {
      return true;
    }
    if (node.source.type === 'opaque' && safeOpaqueFallback(node.source)) {
      return true;
    }
    if (node.children.length > 0 && hasRenderableLeaf(node.children)) {
      return true;
    }
  }
  return false;
}

/** Whether the selected visual retains at least one renderable leaf. */
export function hasRenderableFlaGraphicSubtree(
  visual: EvaluatedFlaGraphicVisual,
): boolean {
  return Boolean(visual.layers?.some((layer) => hasRenderableLeaf(layer.nodes)));
}

/**
 * Computes tight owner-local `{ x, y, width, height }` bounds in Graphic Part
 * `localRect` coordinates for the drawable leaves retained in `visual`.
 */
export function measureFlaGraphicSubtreeBounds(
  visual: EvaluatedFlaGraphicVisual,
  assets: readonly FlaGraphicAssetDimensionLike[] = [],
): { x: number; y: number; width: number; height: number } | null {
  if (!visual.layers || visual.layers.length === 0) return null;

  const assetsById = new Map<string, FlaGraphicAssetDimensionLike>();
  for (const asset of assets) {
    if (asset.kind === 'image') assetsById.set(asset.id, asset);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sawLeaf = false;

  const includeTransformedCorners = (
    matrix: EvaluatedFlaGraphicNode['worldTransform'],
    corners: readonly [number, number][],
  ): boolean => {
    for (const [lx, ly] of corners) {
      const wx = matrix.a * lx + matrix.c * ly + matrix.tx;
      const wy = matrix.b * lx + matrix.d * ly + matrix.ty;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    sawLeaf = true;
    return true;
  };

  const includeTransformedQuad = (
    matrix: EvaluatedFlaGraphicNode['worldTransform'],
    width: number,
    height: number,
  ): boolean =>
    includeTransformedCorners(matrix, [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]);

  const visitNodes = (nodes: readonly EvaluatedFlaGraphicNode[]): boolean => {
    for (const node of nodes) {
      if (!node.renderable) continue;
      // Preserve composite semantics hook so unreadable opacity=0 subtrees still
      // have consistent visibility gating with the renderer when desired.
      evaluateFlaGraphicNodeCompositePlan(node);
      if (node.vectorVisual) {
        if (
          node.vectorVisual.regions.length === 0 &&
          (node.vectorVisual.residueStrokes?.length ?? 0) === 0
        ) {
          continue;
        }
        const bounds = unionFlaShapeRegionBounds(
          node.vectorVisual.regions,
          node.vectorVisual.residueStrokes,
        );
        if (!bounds) continue;
        const bx = node.vectorVisual.baseViewBox.x;
        const by = node.vectorVisual.baseViewBox.y;
        const rx = bounds.x - bx;
        const ry = bounds.y - by;
        if (
          !includeTransformedCorners(node.worldTransform, [
            [rx, ry],
            [rx + bounds.width, ry],
            [rx, ry + bounds.height],
            [rx + bounds.width, ry + bounds.height],
          ])
        ) {
          return false;
        }
      } else if (node.source.type === 'bitmap') {
        if (!node.source.assetId) continue;
        const asset = assetsById.get(node.source.assetId);
        const width = asset?.width;
        const height = asset?.height;
        if (!width || !height || width <= 0 || height <= 0) {
          return false;
        }
        if (!includeTransformedQuad(node.worldTransform, width, height)) {
          return false;
        }
      } else if (node.source.type === 'opaque') {
        if (!safeOpaqueFallback(node.source)) continue;
        const viewBox = node.source.fallbackViewBox!;
        if (!includeTransformedQuad(node.worldTransform, viewBox.width, viewBox.height)) {
          return false;
        }
      } else if (node.children.length > 0) {
        if (!visitNodes(node.children)) return false;
      }
    }
    return true;
  };

  for (const layer of visual.layers) {
    if (!visitNodes(layer.nodes)) return null;
  }

  if (!sawLeaf) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x: minX - visual.anchor.x,
    y: minY - visual.anchor.y,
    width,
    height,
  };
}
