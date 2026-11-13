import type { AffineMatrix2D } from '../shared/affine-matrix';
import {
  invertAffineMatrix,
  multiplyAffineMatrices,
} from '../shared/affine-matrix';
import { evaluateFlaGraphicFrame } from '../shared/fla-graphic-playback';
import {
  resolveFlaGraphicSymbolChildren,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type FlaGraphicStructureFrame,
  type FlaGraphicStructureNode,
} from './models';
import {
  evaluateFlaGraphicTrackAtTime,
  resolveFlaGraphicStableNodeIdentity,
  type FlaGraphicInternalTimeline,
} from './models/flaGraphicTimeline';
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
  Map<string, EvaluatedFlaGraphicVisual>
>();
const instanceAuthoredVisualCache = new WeakMap<
  FlaGraphicDefinition,
  Map<string, EvaluatedFlaGraphicVisual>
>();
const instanceOverrideVisualCache = new WeakMap<
  object,
  WeakMap<FlaGraphicDefinition, Map<string, EvaluatedFlaGraphicVisual>>
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

export interface FlaGraphicNodeCompositePlan {
  readonly needsComposite: boolean;
  readonly hasClips: boolean;
  readonly opacity: number;
  readonly rgbTransform: { readonly multiplier: number; readonly offset: number } | null;
}

/**
 * Pure domain compositing semantics for an evaluated FLA Graphic node so the
 * raster backend never owns mask/opacity/rgb-transform rules.
 */
export function evaluateFlaGraphicNodeCompositePlan(
  node: EvaluatedFlaGraphicNode,
): FlaGraphicNodeCompositePlan {
  const hasClips = node.clipPaths.length > 0;
  const opacity = node.source.type === 'symbol' ? (node.source.opacity ?? 1) : 1;
  const rawRgb = node.source.type === 'symbol' ? node.source.rgbTransform : undefined;
  const rgbTransform =
    rawRgb && !(rawRgb.multiplier === 1 && rawRgb.offset === 0)
      ? rawRgb
      : null;
  return {
    needsComposite: hasClips || opacity !== 1 || rgbTransform !== null,
    hasClips,
    opacity,
    rgbTransform,
  };
}

/**
 * Normalized [0..1] source-rect ratios for a frame-crop opaque fallback within
 * the evaluated frame viewport.
 */
export function evaluateOpaqueFrameCropNormalizedRect(
  fallbackViewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  frameViewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): { readonly normX: number; readonly normY: number; readonly normWidth: number; readonly normHeight: number } | null {
  if (frameViewport.width <= 0 || frameViewport.height <= 0) return null;
  const rawLeft = (fallbackViewBox.x - frameViewport.x) / frameViewport.width;
  const rawTop = (fallbackViewBox.y - frameViewport.y) / frameViewport.height;
  const rawRight = rawLeft + fallbackViewBox.width / frameViewport.width;
  const rawBottom = rawTop + fallbackViewBox.height / frameViewport.height;
  const normX = Math.max(0, rawLeft);
  const normY = Math.max(0, rawTop);
  const right = Math.min(1, rawRight);
  const bottom = Math.min(1, rawBottom);
  if (right <= normX || bottom <= normY) return null;
  return {
    normX,
    normY,
    normWidth: right - normX,
    normHeight: bottom - normY,
  };
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
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): void {
  for (const node of nodes) {
    if (node.type === 'bitmap' && node.assetId) target.add(node.assetId);
    if (node.type === 'opaque' && safeOpaqueFallback(node)) {
      target.add(node.fallbackAssetId!);
    }
    if (node.type === 'group') {
      collectNodeAssetIds(node.children, target, structure);
    } else if (node.type === 'symbol') {
      collectNodeAssetIds(resolveFlaGraphicSymbolChildren(node, structure), target, structure);
    }
  }
}

function visualCacheFor(input: {
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly mode: FlaGraphicEvaluationMode;
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
}): Map<string, EvaluatedFlaGraphicVisual> {
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

function resolveNestedSymbolInternalTimeMs(
  node: Extract<FlaGraphicStructureNode, { type: 'symbol' }>,
  sourceFrameCount: number | undefined,
  parentInternalTimeMs: number,
  fps: number,
): number {
  const rawFirstFrame =
    node.synchronizedFirstFrame ??
    (node.firstFrame !== undefined ? Number.parseInt(node.firstFrame, 10) : 0);
  const firstFrameIndex =
    Number.isFinite(rawFirstFrame) && rawFirstFrame > 0 ? rawFirstFrame : 0;
  const frameMs = 1_000 / Math.max(1, fps);
  const firstFrameMs = firstFrameIndex * frameMs;
  const mode = node.playbackMode?.trim().toLowerCase().replaceAll('-', ' ') ?? 'loop';
  if (sourceFrameCount !== undefined) {
    const elapsedMs = Math.max(0, parentInternalTimeMs - (node.sourceParentFrameSpanStart ?? 0) * frameMs);
    const elapsedFrames = elapsedMs / frameMs;
    const frameOffset = Math.floor(elapsedFrames + 1e-9);
    const lastFrame = node.lastFrame !== undefined ? Number(node.lastFrame) : undefined;
    // Source visual selection and E6 properties use the very same Graphic clock.
    // Only the sub-frame fraction is retained for continuous property tweens.
    const selected = evaluateFlaGraphicFrame(mode, firstFrameIndex, lastFrame, sourceFrameCount, frameOffset);
    const next = evaluateFlaGraphicFrame(mode, firstFrameIndex, lastFrame, sourceFrameCount, frameOffset + 1);
    if (selected.ok && next.ok) {
      const phaseMs = selected.frameIndex === next.frameIndex ? 0 : Math.max(0, elapsedMs - frameOffset * frameMs);
      const direction = mode.endsWith('reverse') ? -1 : 1;
      const localMs = selected.frameIndex * frameMs + direction * phaseMs;
      return localMs < 0 ? localMs + sourceFrameCount * frameMs : localMs;
    }
  }
  if (mode === 'single frame') {
    return firstFrameMs;
  }
  // Older structures have no source span. Hold the property's terminal pose
  // through its evaluator instead of inventing a Symbol duration from its keys.
  return firstFrameMs + parentInternalTimeMs;
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
  readonly internalTimeMs?: number;
}): EvaluatedFlaGraphicVisual | null {
  const { definition, frameOrdinal, mode } = input;
  if (!Number.isSafeInteger(frameOrdinal) || frameOrdinal < 0) return null;
  const fps = Math.max(1, definition.source.sourceFps || 24);
  const effectiveInternalTimeMs =
    input.internalTimeMs !== undefined && Number.isFinite(input.internalTimeMs)
      ? Math.max(0, input.internalTimeMs)
      : Math.round(frameOrdinal * (1_000 / fps));
  const cacheKey = `${frameOrdinal}:${effectiveInternalTimeMs}`;
  const cache = visualCacheFor(input);
  const cachedVisual = cache.get(cacheKey);
  if (cachedVisual) return cachedVisual;
  const frame = definition.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return null;
  const structureFrame = definition.structure?.frames.find(
    (candidate) => candidate.ordinal === frameOrdinal,
  ) ?? null;
  const resourceAssetIds = new Set<string>(structureFrame ? [] : [frame.assetId]);
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
    if (cache.size < 256) cache.set(cacheKey, visual);
    return visual;
  }

  collectNodeAssetIds(
    structureFrame.layers.flatMap((layer) => layer.nodes),
    resourceAssetIds,
    definition.structure,
  );
  const overrides = mode === 'instance'
    ? input.instanceTransformOverrides
    : undefined;
  const structure = definition.structure!;
  interface TimelineEvaluationContext {
    readonly ownerKind: 'frame' | 'symbol';
    readonly ownerSymbolDefId: string | null;
    readonly containerRootNodes: readonly FlaGraphicStructureNode[];
    readonly timeline: FlaGraphicInternalTimeline | undefined;
    readonly internalTimeMs: number;
  }
  const evaluateNodes = (
    nodes: readonly FlaGraphicStructureNode[],
    parentAuthoredWorld: AffineMatrix2D,
    parentEffectiveWorld: AffineMatrix2D,
    parentPath: readonly string[],
    timelineContext: TimelineEvaluationContext,
  ): readonly EvaluatedFlaGraphicNode[] =>
    nodes
      .slice()
      .sort((left, right) => left.drawOrder - right.drawOrder)
      .map((node) => {
        const path = [...parentPath, node.id];
        let authoredLocalTransform = node.localTransform;
        if (node.type !== 'opaque' && timelineContext.timeline) {
          const trackId = resolveFlaGraphicStableNodeIdentity(
            node,
            structure,
            timelineContext.ownerKind,
            timelineContext.ownerSymbolDefId,
            timelineContext.containerRootNodes,
          );
          if (trackId) {
            const track = timelineContext.timeline.tracks.find(
              (candidate) => candidate.trackId === trackId,
            );
            const evaluatedMatrix = track
              ? evaluateFlaGraphicTrackAtTime(track, timelineContext.internalTimeMs)
              : null;
            if (evaluatedMatrix) {
              authoredLocalTransform = evaluatedMatrix;
            }
          }
        }
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
        const nextAuthoredWorld = compose(parentAuthoredWorld, authoredLocalTransform);
        const nextEffectiveWorld = worldTransform;
        let children: readonly EvaluatedFlaGraphicNode[] = [];
        if (node.type === 'group') {
          children = evaluateNodes(
            node.children,
            nextAuthoredWorld ?? parentAuthoredWorld,
            nextEffectiveWorld ?? parentEffectiveWorld,
            path,
            timelineContext,
          );
        } else if (node.type === 'symbol') {
          const nestedDef = node.nestedDefinitionId
            ? structure.symbolDefinitions?.[node.nestedDefinitionId]
            : undefined;
          const parentSourceTimeMs = timelineContext.internalTimeMs +
            (timelineContext.ownerKind === 'frame' && node.sourceParentFrameSpanStart !== undefined
              ? definition.source.startFrameIndex * (1_000 / fps)
              : 0);
          const childTimelineContext: TimelineEvaluationContext = nestedDef
            ? {
                ownerKind: 'symbol',
                ownerSymbolDefId: node.nestedDefinitionId!,
                containerRootNodes: nestedDef.children,
                timeline: nestedDef.timeline,
                internalTimeMs: resolveNestedSymbolInternalTimeMs(
                  node,
                  nestedDef.sourceFrameCount,
                  parentSourceTimeMs,
                  fps,
                ),
              }
            : {
                ...timelineContext,
                internalTimeMs: resolveNestedSymbolInternalTimeMs(
                  node,
                  undefined,
                  parentSourceTimeMs,
                  fps,
                ),
              };
          children = evaluateNodes(
            resolveFlaGraphicSymbolChildren(node, structure),
            nextAuthoredWorld ?? parentAuthoredWorld,
            nextEffectiveWorld ?? parentEffectiveWorld,
            path,
            childTimelineContext,
          );
        }
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
  const frameRootNodes = structureFrame.layers.flatMap((layer) => layer.nodes);
  const rootTimelineContext: TimelineEvaluationContext = {
    ownerKind: 'frame',
    ownerSymbolDefId: null,
    containerRootNodes: frameRootNodes,
    timeline: structure.timeline,
    internalTimeMs: effectiveInternalTimeMs,
  };
  const layers = structureFrame.layers.map((layer) => ({
    name: layer.name,
    nodes: evaluateNodes(layer.nodes, identity, identity, [], rootTimelineContext),
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
  if (cache.size < 256) cache.set(cacheKey, visual);
  return visual;
}
