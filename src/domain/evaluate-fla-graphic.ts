import type { AffineMatrix2D } from '../shared/affine-matrix';
import {
  invertAffineMatrix,
  multiplyAffineMatrices,
} from '../shared/affine-matrix';
import type {
  FlaGraphicDefinition,
  FlaGraphicStructureFrame,
  FlaGraphicStructureNode,
} from './models';
import {
  getFlaGraphicInstanceTransformOverride,
  type FlaGraphicInstanceTransformOverrides,
} from './models/flaGraphicInstanceOverrides';

const identity: AffineMatrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

// Project snapshots and their Definition/Layer data are immutable: identity
// keys let playback reuse the same evaluated tree while scrubbing a held frame.
const definitionVisualCache = new WeakMap<
  FlaGraphicDefinition,
  Map<number, EvaluatedFlaGraphicVisual>
>();
const instanceAuthoredVisualCache = new WeakMap<
  FlaGraphicDefinition,
  Map<number, EvaluatedFlaGraphicVisual>
>();
const instanceOverrideVisualCache = new WeakMap<
  object,
  WeakMap<FlaGraphicDefinition, Map<number, EvaluatedFlaGraphicVisual>>
>();

export type FlaGraphicEvaluationMode = 'definition' | 'instance';

export interface EvaluatedFlaGraphicClipShape {
  readonly shapeId: string;
  readonly pathData: readonly string[];
  readonly worldTransform: AffineMatrix2D;
}

export interface EvaluatedFlaGraphicClipPath {
  /** Shapes form a union; separate clipPaths intersect. */
  readonly shapes: readonly EvaluatedFlaGraphicClipShape[];
}

export interface EvaluatedFlaGraphicNode {
  readonly source: FlaGraphicStructureNode;
  readonly path: readonly string[];
  readonly authoredLocalTransform: AffineMatrix2D;
  readonly localTransform: AffineMatrix2D;
  readonly worldTransform: AffineMatrix2D;
  readonly clipPaths: readonly EvaluatedFlaGraphicClipPath[];
  /** False means this node or subtree degrades locally. */
  readonly renderable: boolean;
  readonly children: readonly EvaluatedFlaGraphicNode[];
}

export interface EvaluatedFlaGraphicLayer {
  readonly name: string;
  readonly nodes: readonly EvaluatedFlaGraphicNode[];
}

/**
 * Pure Definition/Instance result for one exact FLA Graphic frame ordinal.
 * The outer Layer transform is intentionally absent and remains owned by the
 * existing Stage render contract.
 */
export interface EvaluatedFlaGraphicVisual {
  readonly mode: FlaGraphicEvaluationMode;
  readonly frameOrdinal: number;
  readonly frameAssetId: string;
  readonly frameOffset: { readonly x: number; readonly y: number };
  readonly frameViewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly anchor: { readonly x: number; readonly y: number };
  readonly structureFrame: FlaGraphicStructureFrame | null;
  readonly layers: readonly EvaluatedFlaGraphicLayer[] | null;
  /** Unique Project asset references needed by this frame, including fallback. */
  readonly resourceAssetIds: readonly string[];
}

function finiteMatrix(matrix: AffineMatrix2D): boolean {
  return [
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.tx,
    matrix.ty,
  ].every(Number.isFinite);
}

function compose(
  outer: AffineMatrix2D,
  inner: AffineMatrix2D,
): AffineMatrix2D | null {
  const result = multiplyAffineMatrices(outer, inner);
  return finiteMatrix(result) ? result : null;
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

function clipPathLocalTransform(
  shape: NonNullable<FlaGraphicStructureNode['clipPaths']>[number]['shapes'][number],
  parentAuthoredWorld: AffineMatrix2D,
): AffineMatrix2D | null {
  if (shape.parentLocalTransform) return shape.parentLocalTransform;
  const parentInverse = invertAffineMatrix(parentAuthoredWorld);
  if (!parentInverse) return null;
  return compose(parentInverse, shape.worldTransform);
}

function collectNodeAssetIds(
  nodes: readonly FlaGraphicStructureNode[],
  target: Set<string>,
): void {
  for (const node of nodes) {
    if (node.type === 'bitmap' && node.assetId) target.add(node.assetId);
    if (node.type === 'opaque' && safeOpaqueFallback(node)) {
      target.add(node.fallbackAssetId!);
    }
    if (node.type === 'group' || node.type === 'symbol') {
      collectNodeAssetIds(node.children, target);
    }
  }
}

function visualCacheFor(input: {
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly mode: FlaGraphicEvaluationMode;
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
}): Map<number, EvaluatedFlaGraphicVisual> {
  const { definition, frameOrdinal, mode, instanceTransformOverrides } = input;
  if (mode === 'definition') {
    let cache = definitionVisualCache.get(definition);
    if (!cache) {
      cache = new Map();
      definitionVisualCache.set(definition, cache);
    }
    return cache;
  }

  const frameOverrides = instanceTransformOverrides?.[String(frameOrdinal)];
  if (!frameOverrides || Object.keys(frameOverrides).length === 0) {
    let cache = instanceAuthoredVisualCache.get(definition);
    if (!cache) {
      cache = new Map();
      instanceAuthoredVisualCache.set(definition, cache);
    }
    return cache;
  }

  let cacheByDefinition = instanceOverrideVisualCache.get(instanceTransformOverrides);
  if (!cacheByDefinition) {
    cacheByDefinition = new WeakMap();
    instanceOverrideVisualCache.set(instanceTransformOverrides, cacheByDefinition);
  }
  let cache = cacheByDefinition.get(definition);
  if (!cache) {
    cache = new Map();
    cacheByDefinition.set(definition, cache);
  }
  return cache;
}

function evaluateClipPaths(
  node: FlaGraphicStructureNode,
  parentAuthoredWorld: AffineMatrix2D,
  parentEffectiveWorld: AffineMatrix2D,
): { readonly clips: readonly EvaluatedFlaGraphicClipPath[]; readonly valid: boolean } {
  const sourceClips = node.clipPaths ?? [];
  const clips: EvaluatedFlaGraphicClipPath[] = [];
  for (const clipPath of sourceClips) {
    if (clipPath.shapes.length === 0) return { clips: [], valid: false };
    const shapes: EvaluatedFlaGraphicClipShape[] = [];
    for (const shape of clipPath.shapes) {
      if (!shape.pathData?.length || shape.pathData.some((path) => path.length === 0)) {
        return { clips: [], valid: false };
      }
      const local = clipPathLocalTransform(shape, parentAuthoredWorld);
      const world = local ? compose(parentEffectiveWorld, local) : null;
      if (!world) return { clips: [], valid: false };
      shapes.push({
        shapeId: shape.shapeId,
        pathData: shape.pathData,
        worldTransform: world,
      });
    }
    clips.push({ shapes });
  }
  return { clips, valid: true };
}

/**
 * The one formal FLA Graphic evaluator. Definition mode ignores Layer state;
 * Instance mode applies only sparse node-local matrices from the owning Layer.
 * Stale paths are never visited and therefore cannot affect the output.
 */
export function evaluateFlaGraphicVisual(input: {
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly mode: FlaGraphicEvaluationMode;
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
}): EvaluatedFlaGraphicVisual | null {
  const { definition, frameOrdinal, mode } = input;
  if (!Number.isSafeInteger(frameOrdinal) || frameOrdinal < 0) return null;
  const cache = visualCacheFor(input);
  const cachedVisual = cache.get(frameOrdinal);
  if (cachedVisual) return cachedVisual;
  const frame = definition.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return null;
  const structureFrame = definition.structure?.frames.find(
    (candidate) => candidate.ordinal === frameOrdinal,
  ) ?? null;
  const resourceAssetIds = new Set<string>([frame.assetId]);
  if (!structureFrame) {
    const visual: EvaluatedFlaGraphicVisual = {
      mode,
      frameOrdinal,
      frameAssetId: frame.assetId,
      frameOffset: frame.offset,
      frameViewport: frame.sourceViewport,
      canvas: definition.source.canvas,
      anchor: definition.source.anchor,
      structureFrame: null,
      layers: null,
      resourceAssetIds: [...resourceAssetIds],
    };
    cache.set(frameOrdinal, visual);
    return visual;
  }

  collectNodeAssetIds(
    structureFrame.layers.flatMap((layer) => layer.nodes),
    resourceAssetIds,
  );
  const overrides = mode === 'instance'
    ? input.instanceTransformOverrides
    : undefined;
  const evaluateNodes = (
    nodes: readonly FlaGraphicStructureNode[],
    parentAuthoredWorld: AffineMatrix2D,
    parentEffectiveWorld: AffineMatrix2D,
    parentPath: readonly string[],
  ): readonly EvaluatedFlaGraphicNode[] =>
    nodes
      .slice()
      .sort((left, right) => left.drawOrder - right.drawOrder)
      .map((node) => {
        const path = [...parentPath, node.id];
        let authoredLocalTransform = node.localTransform;
        if (
          node.type === 'opaque' &&
          node.fallbackScope === 'frame-crop' &&
          node.fallbackViewBox
        ) {
          const parentInverse = invertAffineMatrix(parentAuthoredWorld);
          const localized = parentInverse
            ? compose(parentInverse, {
                ...identity,
                tx: node.fallbackViewBox.x,
                ty: node.fallbackViewBox.y,
              })
            : null;
          if (localized) authoredLocalTransform = localized;
        }
        const localTransform = node.type === 'opaque'
          ? authoredLocalTransform
          : getFlaGraphicInstanceTransformOverride(
              overrides,
              frameOrdinal,
              path,
            ) ?? authoredLocalTransform;
        const worldTransform = compose(parentEffectiveWorld, localTransform);
        const fallbackReady = node.type !== 'opaque' || safeOpaqueFallback(node);
        const clipResult = node.type === 'opaque' && fallbackReady
          // Safe opaque fallback images already contain their authored mask.
          ? { clips: [], valid: true }
          : evaluateClipPaths(node, parentAuthoredWorld, parentEffectiveWorld);
        const renderable = Boolean(worldTransform && fallbackReady && clipResult.valid);
        const nextAuthoredWorld = compose(parentAuthoredWorld, node.localTransform);
        const nextEffectiveWorld = worldTransform;
        const children = node.type === 'group' || node.type === 'symbol'
          ? evaluateNodes(
              node.children,
              nextAuthoredWorld ?? parentAuthoredWorld,
              nextEffectiveWorld ?? parentEffectiveWorld,
              path,
            )
          : [];
        return {
          source: node,
          path,
          authoredLocalTransform,
          localTransform,
          worldTransform: worldTransform ?? parentEffectiveWorld,
          clipPaths: clipResult.clips,
          renderable,
          children,
        };
      });
  const layers = structureFrame.layers.map((layer) => ({
    name: layer.name,
    nodes: evaluateNodes(layer.nodes, identity, identity, []),
  }));
  const visual: EvaluatedFlaGraphicVisual = {
    mode,
    frameOrdinal,
    frameAssetId: frame.assetId,
    frameOffset: frame.offset,
    frameViewport: frame.sourceViewport,
    canvas: definition.source.canvas,
    anchor: definition.source.anchor,
    structureFrame,
    layers,
    resourceAssetIds: [...resourceAssetIds],
  };
  cache.set(frameOrdinal, visual);
  return visual;
}
