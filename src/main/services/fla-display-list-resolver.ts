import { invertAffineMatrix, type AffineMatrix2D } from '../../shared/affine-matrix';

/**
 * P0-C01: Panda-owned, Main-side resolver for one already-selected FLA frame.
 *
 * This is an ephemeral composition model. It deliberately contains references
 * to shapes and bitmap library items, not parser objects, image bytes, project
 * data, paths, or renderer capabilities. The caller supplies painter-ordered
 * arrays and a concrete frame context; this module preserves that order
 * without selecting timeline frames or interpolating tweens (P1).
 */

export type FlaDisplayListMatrix = AffineMatrix2D;

export const FLA_DISPLAY_LIST_IDENTITY_MATRIX: FlaDisplayListMatrix =
  Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/**
 * The frame context is already selected by the caller. C01 resolves its
 * display list; it does not implement keyframe hold rules, Graphic frame
 * synchronization, frame ranges, or tween interpolation.
 */
export interface FlaDisplayListFrameContext {
  readonly frameIndex: number;
  readonly projectionDiagnostics?: readonly string[];
  /** Layers are supplied back-to-front in painter order; the resolver preserves it. */
  readonly layers: readonly FlaDisplayListLayer[];
  /** Set when visible authored content was found outside the safe display subset. */
  readonly unsupportedDisplayReason?: string;
}

export interface FlaInstanceFilter {
  readonly kind: 'blur' | 'glow' | 'dropShadow';
  readonly enabled: boolean;
  readonly blurX: number;
  readonly blurY: number;
  readonly color: string;
  readonly alpha: number;
  readonly strength: number;
  readonly distance: number;
  readonly angle: number;
}

export interface FlaDisplayListBlurFilter {
  readonly kind: 'blur';
  readonly blurX: number;
  readonly blurY: number;
  readonly quality: 'low';
  readonly enabled: true;
}

/** Shared RGB multiplier with either a uniform brightness or per-channel tint offset. */
export interface FlaDisplayListRgbTransform {
  readonly multiplier: number;
  /** Additive channel offset in 0..255 units. */
  readonly offset: number;
  readonly channelOffsets?: readonly [number, number, number];
}

export function isValidFlaDisplayListRgbTransform(transform: FlaDisplayListRgbTransform): boolean {
  const validOffset = (value: number) => Number.isFinite(value) && value >= 0 && value <= 255;
  return Number.isFinite(transform.multiplier) && transform.multiplier >= 0 &&
    transform.multiplier <= 1 && validOffset(transform.offset) &&
    (transform.channelOffsets === undefined ||
      (Array.isArray(transform.channelOffsets) && transform.channelOffsets.length === 3 &&
        Array.from(transform.channelOffsets).every(validOffset)));
}

export interface FlaDisplayListLayer {
  readonly name: string;
  readonly stageProjection?: FlaDisplayListMatrix;
  readonly incompatibleStageMask?: boolean;
  readonly visible: boolean;
  readonly elements: readonly FlaDisplayListElement[];
  /** One source-supported DOMFrame BlurFilter scoped to this layer's contents. */
  readonly frameFilter?: FlaDisplayListBlurFilter;
  /** Source XFL mask identity. Mask geometry is not painted as ordinary artwork. */
  readonly maskLayerId?: string;
  readonly unsupportedMaskReason?: string;
  readonly skippedIkPoseReason?: string;
  /** Source XFL mask identity linked to this layer through parentLayerIndex. */
  readonly maskedBy?: string;
}

export type FlaDisplayListElement =
  | {
      readonly kind: 'shape';
      readonly shapeId: string;
      /** Source-grounded XFL address retained for adaptive Part identity. */
      readonly sourceAddress?: string;
      readonly sourceParentFrameIndex?: number;
      readonly sourceParentFrameSpanStart?: number;
      readonly sourceParentSpanTweenType?: string;
      /** Transform from this node's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    }
  | {
      readonly kind: 'bitmap';
      readonly libraryItemName: string;
      readonly sourceAddress?: string;
      readonly sourceParentFrameIndex?: number;
      readonly sourceParentFrameSpanStart?: number;
      readonly sourceParentSpanTweenType?: string;
      /** Transform from this node's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    }
  | {
      readonly kind: 'text';
      readonly textId: string;
      readonly sourceAddress?: string;
      readonly sourceParentFrameIndex?: number;
      readonly sourceParentFrameSpanStart?: number;
      readonly sourceParentSpanTweenType?: string;
      /** Transform from this text node's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    }
  | {
      readonly kind: 'group';
      readonly groupId: string;
      readonly sourceAddress?: string;
      readonly sourceParentFrameIndex?: number;
      readonly sourceParentFrameSpanStart?: number;
      readonly sourceParentSpanTweenType?: string;
      /** Transform from this group’s local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
      readonly elements: readonly FlaDisplayListElement[];
    }
  | {
      readonly kind: 'symbol';
      readonly libraryItemName: string;
      readonly symbolType: 'graphic' | 'movieclip' | 'button' | 'ik container';
      readonly movieClipRun?: { readonly start: number; readonly end: number };
      /** Raw XFL playback mode retained for bounded nested-frame selection. */
      readonly playbackMode?: string;
      /** Raw XFL firstFrame/lastFrame attributes; parsing stays fail-closed. */
      readonly firstFrame?: string;
      readonly lastFrame?: string;
      /** Effective firstFrame accumulated across a verified Classic Motion Sync chain. */
      readonly synchronizedFirstFrame?: number;
      /** Bounded source alpha multiplier for the #1044 synchronized motion span. */
      readonly alphaMultiplier?: number;
      /** Shared red/green/blue transform for the bounded #1055 Sync color tween. */
      readonly rgbTransform?: FlaDisplayListRgbTransform;
      readonly instanceFilters?: readonly FlaInstanceFilter[];
      /** Parent timeline coordinate and containing DOMFrame span start. */
      readonly sourceParentFrameIndex?: number;
      readonly sourceParentFrameSpanStart?: number;
      /**
       * Tween type of the containing parent DOMFrame span ('none' for a static
       * authored/held span). Used to keep firstFrame bounded to a static/span-local
       * owning span; an animated (tweened) firstFrame stays fail-closed (#721/#720).
       */
      readonly sourceParentSpanTweenType?: string;
      /** Raw Sync marker for the bounded #1044 synchronized-motion experiment. */
      readonly sourceParentMotionTweenSync?: boolean;
      /** Stable source address of this DOMSymbolInstance within the XFL. */
      readonly sourceAddress?: string;
      /** Per-instance definition lookup; libraryItemName remains source identity. */
      readonly frameSelectionKey?: string;
      /** Transform from this instance's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    };

export interface FlaGraphicSymbolDefinition {
  readonly kind: 'graphic';
  readonly libraryItemName: string;
  readonly sourceFrameCount?: number;
  /** Concrete frame context for this definition; no frame selection occurs here. */
  readonly frameContext: FlaDisplayListFrameContext;
}

export type FlaDisplayListRoot =
  | {
      readonly kind: 'scene';
      readonly name: string;
      readonly frameContext: FlaDisplayListFrameContext;
    }
  | {
      readonly kind: 'graphic';
      readonly name: string;
      readonly frameContext: FlaDisplayListFrameContext;
    };

export interface FlaDisplayListResolverInput {
  readonly root: FlaDisplayListRoot;
  /**
   * Exact source library-item name, or a per-instance frameSelectionKey, to a
   * Panda-owned Graphic definition. Definitions always retain the source name.
   */
  readonly symbols: ReadonlyMap<string, FlaGraphicSymbolDefinition>;
}

export interface FlaDisplayListResolverLimits {
  /** Bounds nested groups and symbol expansion depth. */
  readonly maxRecursionDepth: number;
  /** Bounds emitted nodes and source nodes visited, including hidden nodes. */
  readonly maxResolvedNodeCount: number;
  /**
   * When true, elements/subtrees that fail resolution (e.g. unsupported symbol
   * types, cycles, missing symbols, exceeded limits) degrade to typed opaque
   * stand-in nodes instead of failing the entire display list.
   */
  readonly tolerant?: boolean;
}

export const DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS: FlaDisplayListResolverLimits =
  Object.freeze({
    maxRecursionDepth: 64,
    maxResolvedNodeCount: 100_000,
  });

export interface FlaResolvedShapeNode {
  readonly kind: 'shape';
  readonly shapeId: string;
  readonly sourceAddress?: string;
  readonly localTransform: FlaDisplayListMatrix;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly clipPaths?: readonly FlaResolvedClipPath[];
}

export interface FlaResolvedBitmapNode {
  readonly kind: 'bitmap';
  readonly libraryItemName: string;
  readonly sourceAddress?: string;
  readonly localTransform: FlaDisplayListMatrix;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly clipPaths?: readonly FlaResolvedClipPath[];
}

export interface FlaResolvedTextNode {
  readonly kind: 'text';
  readonly textId: string;
  readonly sourceAddress?: string;
  readonly localTransform: FlaDisplayListMatrix;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly clipPaths?: readonly FlaResolvedClipPath[];
}

export interface FlaResolvedClipShape {
  readonly shapeId: string;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly clipPaths?: readonly FlaResolvedClipPath[];
}

/** One XFL mask; its filled vector shapes form a union within this clip path. */
export interface FlaResolvedClipPath {
  readonly shapes: readonly FlaResolvedClipShape[];
  readonly sourcePath?: string;
}

export interface FlaResolvedGroupNode {
  readonly kind: 'group';
  readonly groupId: string;
  readonly symbolLibraryItemName?: string;
  readonly sourceAddress?: string;
  readonly localTransform: FlaDisplayListMatrix;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly opacity?: number;
  readonly instanceFilters?: readonly FlaInstanceFilter[];
  readonly instanceFilterClips?: readonly FlaResolvedClipPath[];
  readonly rgbTransform?: FlaDisplayListRgbTransform;
  readonly symbolInstance?: {
    readonly sourceFrameCount?: number;
    readonly sourceParentFrameSpanStart?: number;
    readonly frameSelectionKey?: string;
    readonly playbackMode?: string;
    readonly firstFrame?: string;
    readonly lastFrame?: string;
    readonly synchronizedFirstFrame?: number;
  };
  readonly opaque?: {
    readonly kind: 'shape' | 'text' | 'filter' | 'symbol' | 'unknown';
    readonly reason: string;
    readonly sourceRef?: string;
  };
  readonly children: readonly FlaResolvedDisplayNode[];
}

export type FlaResolvedDisplayNode =
  | FlaResolvedShapeNode
  | FlaResolvedBitmapNode
  | FlaResolvedTextNode
  | FlaResolvedGroupNode;

export interface FlaResolvedDisplayLayer {
  readonly name: string;
  readonly children: readonly FlaResolvedDisplayNode[];
  readonly frameFilter?: FlaDisplayListBlurFilter;
}

export interface FlaResolvedDisplayList {
  readonly kind: 'scene' | 'graphic';
  readonly sourceName: string;
  readonly frameIndex: number;
  readonly layers: readonly FlaResolvedDisplayLayer[];
  readonly resolvedNodeCount: number;
  readonly maskDiagnostics?: readonly string[];
  readonly projectionDiagnostics?: readonly string[];
  readonly ikPoseDiagnostics?: readonly string[];
}

export type FlaDisplayListResolverErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_MATRIX'
  | 'UNSUPPORTED_DISPLAY_CONTENT'
  | 'UNSUPPORTED_SYMBOL_TYPE'
  | 'MISSING_SYMBOL'
  | 'SYMBOL_CYCLE'
  | 'MAX_RECURSION_DEPTH_EXCEEDED'
  | 'MAX_RESOLVED_NODES_EXCEEDED';

export interface FlaDisplayListResolverFailure {
  readonly ok: false;
  readonly code: FlaDisplayListResolverErrorCode;
  readonly message: string;
  readonly sourcePath: string;
}

export type FlaDisplayListResolverResult =
  | { readonly ok: true; readonly displayList: FlaResolvedDisplayList }
  | FlaDisplayListResolverFailure;

interface ResolveContext {
  readonly input: FlaDisplayListResolverInput;
  readonly limits: FlaDisplayListResolverLimits;
  visitedNodeCount: number;
  resolvedNodeCount: number;
  readonly maskDiagnostics: Set<string>;
  maskFailureCount: number;
  readonly ikPoseDiagnostics: Set<string>;
  ikPoseFailureCount: number;
}

type ResolveNodesResult =
  | { readonly ok: true; readonly nodes: readonly FlaResolvedDisplayNode[] }
  | FlaDisplayListResolverFailure;

type ResolveLayersResult =
  | { readonly ok: true; readonly layers: readonly FlaResolvedDisplayLayer[] }
  | FlaDisplayListResolverFailure;

function failure(
  code: FlaDisplayListResolverErrorCode,
  message: string,
  sourcePath: string,
): FlaDisplayListResolverFailure {
  return { ok: false, code, message, sourcePath };
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidFrameContext(frameContext: FlaDisplayListFrameContext): boolean {
  return Boolean(frameContext) &&
    Number.isSafeInteger(frameContext.frameIndex) &&
    frameContext.frameIndex >= 0 &&
    Array.isArray(frameContext.layers);
}

function isValidMatrix(matrix: FlaDisplayListMatrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .every(Number.isFinite);
}

/** Affine composition in the frozen parent × local order. */
function composeTransforms(
  parent: FlaDisplayListMatrix,
  local: FlaDisplayListMatrix,
): FlaDisplayListMatrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

/**
 * Cross-layer mask/content stage projection alignment.
 *
 * Adapted from the independent mask/content projection and inverse-matrix
 * alignment relationship in lifeart/fla-viewer @ b14fa1d1e3e2d2b035e174bde472a7941d385b17
 * (`src/video-exporter.ts` L1890-1923). Upstream declares ISC in README.md and
 * package.json (no standalone LICENSE file in that commit).
 *
 * Mask geometry (projected by P_M) and masked content (projected by P_C) are
 * each projected independently into Panda's shared projected stage space. Their
 * relative alignment into mask space is P_M^{-1} × P_C (so P_M × (P_M^{-1} × P_C) = P_C).
 * Returns null when either projection is non-finite/non-invertible or their
 * relative alignment overflows to a non-finite matrix.
 */
export function computeCrossLayerMaskAlignment(
  maskProjection: FlaDisplayListMatrix,
  contentProjection: FlaDisplayListMatrix,
): FlaDisplayListMatrix | null {
  if (!isValidMatrix(maskProjection) || !isValidMatrix(contentProjection)) {
    return null;
  }
  const maskInverse = invertAffineMatrix(maskProjection);
  if (!maskInverse || !invertAffineMatrix(contentProjection)) {
    return null;
  }
  const relative = composeTransforms(maskInverse, contentProjection);
  return isValidMatrix(relative) ? relative : null;
}

function enterSourceNode(context: ResolveContext, sourcePath: string): FlaDisplayListResolverFailure | null {
  context.visitedNodeCount += 1;
  if (context.visitedNodeCount > context.limits.maxResolvedNodeCount) {
    return failure(
      'MAX_RESOLVED_NODES_EXCEEDED',
      `Display-list traversal exceeded ${context.limits.maxResolvedNodeCount} nodes`,
      sourcePath,
    );
  }
  return null;
}

function addResolvedNode(context: ResolveContext, sourcePath: string): FlaDisplayListResolverFailure | null {
  context.resolvedNodeCount += 1;
  if (context.resolvedNodeCount > context.limits.maxResolvedNodeCount) {
    return failure(
      'MAX_RESOLVED_NODES_EXCEEDED',
      `Resolved display list exceeded ${context.limits.maxResolvedNodeCount} nodes`,
      sourcePath,
    );
  }
  return null;
}

function collectMaskShapes(
  nodes: readonly FlaResolvedDisplayNode[],
  sourcePath: string,
): { readonly ok: true; readonly shapes: readonly FlaResolvedClipShape[] } | FlaDisplayListResolverFailure {
  const shapes: FlaResolvedClipShape[] = [];
  const visit = (node: FlaResolvedDisplayNode, nodePath: string): FlaDisplayListResolverFailure | null => {
    if (node.kind === 'shape') {
      shapes.push({
        shapeId: node.shapeId,
        worldTransform: node.worldTransform,
        ...(node.clipPaths?.length ? { clipPaths: node.clipPaths } : {}),
      });
      return null;
    }
    if (node.kind === 'bitmap' || node.kind === 'text' || (node.kind === 'group' && (node.opaque || node.instanceFilters))) {
      return failure(
        'UNSUPPORTED_DISPLAY_CONTENT',
        'Only filled vector geometry is supported as mask items',
        nodePath,
      );
    }
    if (node.kind === 'group') {
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child) return failure('INVALID_INPUT', 'Missing mask child node', `${nodePath}/child[${index}]`);
        const childFailure = visit(child, `${nodePath}/child[${index}]`);
        if (childFailure) return childFailure;
      }
    }
    return null;
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) return failure('INVALID_INPUT', 'Missing mask node', `${sourcePath}/node[${index}]`);
    const nodeFailure = visit(node, `${sourcePath}/node[${index}]`);
    if (nodeFailure) return nodeFailure;
  }
  return { ok: true, shapes };
}

function resolveLayers(
  frameContext: FlaDisplayListFrameContext,
  parentTransform: FlaDisplayListMatrix,
  symbolStack: readonly string[],
  nestingDepth: number,
  sourcePath: string,
  context: ResolveContext,
  inheritedClipPaths: readonly FlaResolvedClipPath[] = [],
): ResolveLayersResult {
  if (!isValidFrameContext(frameContext)) {
    return failure('INVALID_INPUT', 'Invalid selected frame context', sourcePath);
  }
  if (frameContext.unsupportedDisplayReason) {
    return failure(
      'UNSUPPORTED_DISPLAY_CONTENT',
      frameContext.unsupportedDisplayReason,
      sourcePath,
    );
  }

  const maskLayers = new Map<string, FlaDisplayListLayer>();
  for (let index = 0; index < frameContext.layers.length; index += 1) {
    const layer = frameContext.layers[index];
    if (!layer?.maskLayerId) continue;
    if (maskLayers.has(layer.maskLayerId)) {
      return failure('INVALID_INPUT', 'Duplicate source mask identity', `${sourcePath}/layer[${index}]`);
    }
    maskLayers.set(layer.maskLayerId, layer);
  }

  // A dependency failure must not paint. An empty clip list means
  // an authored blank/uncovered mask layer, which Animate exports without a clip.
  type MaskResult =
    | {
        readonly ok: true;
        readonly clips: readonly FlaResolvedClipPath[];
        readonly projections: readonly FlaDisplayListMatrix[];
      }
    | FlaDisplayListResolverFailure;
  const maskCache = new Map<string, MaskResult>();
  const buildMask = (maskId: string, ancestry: readonly string[]): MaskResult => {
    if (ancestry.includes(maskId) || ancestry.length >= context.limits.maxRecursionDepth) {
      return failure('UNSUPPORTED_DISPLAY_CONTENT', 'Mask dependency is cyclic or too deeply nested', sourcePath);
    }
    const layer = maskLayers.get(maskId);
    if (!layer) return failure('UNSUPPORTED_DISPLAY_CONTENT', 'Masked layer references a missing mask', sourcePath);
    const maskPath = `${sourcePath}/mask(${layer.name})`;
    if (layer.unsupportedMaskReason || layer.frameFilter || layer.incompatibleStageMask) {
      return failure('UNSUPPORTED_DISPLAY_CONTENT', layer.unsupportedMaskReason ?? 'Mask filter is unsupported', maskPath);
    }
    const maskProjection = layer.stageProjection ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
    if (!isValidMatrix(maskProjection) || !invertAffineMatrix(maskProjection)) {
      return failure('UNSUPPORTED_DISPLAY_CONTENT', 'Mask stage projection is non-invertible', maskPath);
    }
    const enclosing = layer.maskedBy ? resolveMask(layer.maskedBy, [...ancestry, maskId])
      : { ok: true as const, clips: [], projections: [] };
    if (!enclosing.ok) return enclosing;
    for (const enclosingProjection of enclosing.projections) {
      if (!computeCrossLayerMaskAlignment(enclosingProjection, maskProjection)) {
        return failure('UNSUPPORTED_DISPLAY_CONTENT', 'Nested mask stage projection cannot be aligned', maskPath);
      }
    }
    if (layer.elements.length === 0) return enclosing;
    const maskTransform = layer.stageProjection
      ? composeTransforms(parentTransform, layer.stageProjection)
      : parentTransform;
    if (!isValidMatrix(maskTransform)) {
      return failure('UNSUPPORTED_DISPLAY_CONTENT', 'Mask stage projection is not finite', maskPath);
    }
    const diagnosticCount = context.maskFailureCount + context.ikPoseFailureCount;
    const resolvedMask = resolveElements(
      layer.elements,
      maskTransform,
      symbolStack,
      nestingDepth,
      maskPath,
      context,
      [],
    );
    if (!resolvedMask.ok) return resolvedMask;
    if (context.maskFailureCount + context.ikPoseFailureCount !== diagnosticCount) {
      return failure('UNSUPPORTED_DISPLAY_CONTENT', 'A nested mask dependency could not be sampled', maskPath);
    }
    const maskShapes = collectMaskShapes(resolvedMask.nodes, maskPath);
    if (!maskShapes.ok) return maskShapes;
    // A present symbol with no display geometry has an empty silhouette.
    return {
      ok: true,
      clips: [...enclosing.clips, { shapes: maskShapes.shapes, sourcePath: maskPath }],
      projections: [...enclosing.projections, maskProjection],
    };
  };
  const resolveMask = (maskId: string, ancestry: readonly string[] = []): MaskResult => {
    const cached = maskCache.get(maskId);
    if (cached) return cached;
    const result = buildMask(maskId, ancestry);
    maskCache.set(maskId, result);
    return result;
  };

  const layers: FlaResolvedDisplayLayer[] = [];
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    const layerPath = `${sourcePath}/layer[${layerIndex}]`;
    const layerBudgetFailure = enterSourceNode(context, layerPath);
    if (layerBudgetFailure) return layerBudgetFailure;
    if (!layer) return failure('INVALID_INPUT', 'Missing layer entry', layerPath);
    if (layer.maskLayerId) continue;
    if (!layer.visible) continue;
    if (layer.skippedIkPoseReason) {
      context.ikPoseFailureCount += 1;
      if (context.ikPoseDiagnostics.size < 32) {
        context.ikPoseDiagnostics.add(`${layer.name}：${layer.skippedIkPoseReason}`.slice(0, 500));
      }
      continue;
    }

    const layerProjection = layer.stageProjection ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
    let mask: MaskResult | undefined = layer.incompatibleStageMask
      ? failure('UNSUPPORTED_DISPLAY_CONTENT', 'Native depth differs between a mask and its content', layerPath)
      : layer.maskedBy ? resolveMask(layer.maskedBy) : undefined;
    if (mask?.ok) {
      for (const maskProjection of mask.projections) {
        if (!computeCrossLayerMaskAlignment(maskProjection, layerProjection)) {
          mask = failure('UNSUPPORTED_DISPLAY_CONTENT', 'Mask and content stage projections cannot be aligned', layerPath);
          break;
        }
      }
    }
    if (mask && !mask.ok) {
      if (mask.code === 'MAX_RESOLVED_NODES_EXCEEDED') return mask;
      context.maskFailureCount += 1;
      if (context.maskDiagnostics.size < 32) {
        context.maskDiagnostics.add(`${layer.name}: ${mask.message} (${mask.sourcePath})`.slice(0, 500));
      }
      continue;
    }
    const activeClipPaths = mask?.clips.length
      ? [...inheritedClipPaths, ...mask.clips]
      : inheritedClipPaths;

    const layerTransform = layer.stageProjection
      ? composeTransforms(parentTransform, layer.stageProjection)
      : parentTransform;
    if (!isValidMatrix(layerTransform)) {
      return failure('INVALID_MATRIX', 'Layer stage projection is not finite', layerPath);
    }
    const resolved = resolveElements(
      layer.elements,
      layerTransform,
      symbolStack,
      nestingDepth,
      `${layerPath}:${layer.name}`,
      context,
      activeClipPaths,
    );
    if (!resolved.ok) return resolved;
    layers.push({
      name: layer.name,
      children: resolved.nodes,
      ...(layer.frameFilter ? { frameFilter: layer.frameFilter } : {}),
    });
  }
  return { ok: true, layers };
}

function opaqueStandIn(
  element: FlaDisplayListElement,
  parentTransform: FlaDisplayListMatrix,
  reason: string,
): FlaResolvedGroupNode {
  const authored = element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
  const localTransform = isValidMatrix(authored) ? authored : FLA_DISPLAY_LIST_IDENTITY_MATRIX;
  const composed = composeTransforms(parentTransform, localTransform);
  const sourceRef = element.kind === 'symbol' || element.kind === 'bitmap'
    ? element.libraryItemName
    : element.kind === 'shape'
      ? element.shapeId
      : element.kind === 'text'
        ? element.textId
        : element.groupId;
  const symbolInstance =
    element.kind === 'symbol'
      ? {
          ...(element.frameSelectionKey !== undefined ? { frameSelectionKey: element.frameSelectionKey } : {}),
          ...(element.playbackMode !== undefined ? { playbackMode: element.playbackMode } : {}),
          ...(element.firstFrame !== undefined ? { firstFrame: element.firstFrame } : {}),
          ...(element.lastFrame !== undefined ? { lastFrame: element.lastFrame } : {}),
          ...(element.synchronizedFirstFrame !== undefined ? { synchronizedFirstFrame: element.synchronizedFirstFrame } : {}),
        }
      : undefined;
  return {
    kind: 'group',
    groupId: `opaque:${sourceRef || element.kind}`,
    ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
    ...(element.kind === 'symbol' ? { symbolLibraryItemName: element.libraryItemName } : {}),
    localTransform,
    worldTransform: isValidMatrix(composed) ? composed : localTransform,
    children: [],
    ...(symbolInstance && Object.keys(symbolInstance).length > 0 ? { symbolInstance } : {}),
    opaque: {
      kind: element.kind === 'symbol'
        ? 'symbol'
        : element.kind === 'shape'
          ? 'shape'
          : element.kind === 'text'
            ? 'text'
            : 'unknown',
      reason,
      ...(sourceRef ? { sourceRef } : {}),
    },
  };
}

function resolveElements(
  elements: readonly FlaDisplayListElement[],
  parentTransform: FlaDisplayListMatrix,
  symbolStack: readonly string[],
  nestingDepth: number,
  sourcePath: string,
  context: ResolveContext,
  clipPaths: readonly FlaResolvedClipPath[],
): ResolveNodesResult {
  if (!Array.isArray(elements)) {
    return failure('INVALID_INPUT', 'Frame or group elements must be an array', sourcePath);
  }

  const nodes: FlaResolvedDisplayNode[] = [];
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex];
    const elementPath = `${sourcePath}/element[${elementIndex}]`;
    const nodeBudgetFailure = enterSourceNode(context, elementPath);
    if (nodeBudgetFailure) {
      if (!context.limits.tolerant || !element) return nodeBudgetFailure;
      nodes.push(opaqueStandIn(element, parentTransform, nodeBudgetFailure.message));
      continue;
    }
    if (!element) return failure('INVALID_INPUT', 'Missing display element', elementPath);
    if (element.visible === false) continue;

    const localTransform = element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
    if (!isValidMatrix(localTransform)) {
      if (!context.limits.tolerant) {
        return failure('INVALID_MATRIX', 'Display element matrix contains a non-finite value', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Display element matrix contains a non-finite value'));
      continue;
    }
    const worldTransform = composeTransforms(parentTransform, localTransform);
    if (!isValidMatrix(worldTransform)) {
      if (!context.limits.tolerant) {
        return failure('INVALID_MATRIX', 'Accumulated display element matrix is not finite', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Accumulated display element matrix is not finite'));
      continue;
    }

    if (element.kind === 'shape') {
      if (!element.shapeId) return failure('INVALID_INPUT', 'Shape reference is empty', elementPath);
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) {
        if (!context.limits.tolerant) return budgetFailure;
        nodes.push(opaqueStandIn(element, parentTransform, budgetFailure.message));
        continue;
      }
      nodes.push({
        kind: 'shape',
        shapeId: element.shapeId,
        ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
        localTransform,
        worldTransform,
        ...(clipPaths.length ? { clipPaths } : {}),
      });
      continue;
    }

    if (element.kind === 'bitmap') {
      if (!element.libraryItemName) return failure('INVALID_INPUT', 'Bitmap reference is empty', elementPath);
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) {
        if (!context.limits.tolerant) return budgetFailure;
        nodes.push(opaqueStandIn(element, parentTransform, budgetFailure.message));
        continue;
      }
      nodes.push({
        kind: 'bitmap',
        libraryItemName: element.libraryItemName,
        ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
        localTransform,
        worldTransform,
        ...(clipPaths.length ? { clipPaths } : {}),
      });
      continue;
    }

    if (element.kind === 'text') {
      if (!element.textId) return failure('INVALID_INPUT', 'Text reference is empty', elementPath);
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) {
        if (!context.limits.tolerant) return budgetFailure;
        nodes.push(opaqueStandIn(element, parentTransform, budgetFailure.message));
        continue;
      }
      nodes.push({
        kind: 'text',
        textId: element.textId,
        ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
        localTransform,
        worldTransform,
        ...(clipPaths.length ? { clipPaths } : {}),
      });
      continue;
    }

    if (element.kind === 'group') {
      const nextDepth = nestingDepth + 1;
      if (nextDepth > context.limits.maxRecursionDepth) {
        if (!context.limits.tolerant) {
          return failure(
            'MAX_RECURSION_DEPTH_EXCEEDED',
            `Display-list nesting exceeded ${context.limits.maxRecursionDepth}`, elementPath,
          );
        }
        nodes.push(opaqueStandIn(element, parentTransform, `Display-list nesting exceeded ${context.limits.maxRecursionDepth}`));
        continue;
      }
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) {
        if (!context.limits.tolerant) return budgetFailure;
        nodes.push(opaqueStandIn(element, parentTransform, budgetFailure.message));
        continue;
      }
      const children = resolveElements(
        element.elements,
        worldTransform,
        symbolStack,
        nextDepth,
        `${elementPath}:${element.groupId}`,
        context,
        clipPaths,
      );
      if (!children.ok) {
        if (!context.limits.tolerant) return children;
        nodes.push(opaqueStandIn(element, parentTransform, children.message));
        continue;
      }
      nodes.push({
        kind: 'group',
        groupId: element.groupId,
        ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
        localTransform,
        worldTransform,
        children: children.nodes,
      });
      continue;
    }

    if (element.symbolType !== 'graphic') {
      if (!context.limits.tolerant) {
        return failure(
          'UNSUPPORTED_SYMBOL_TYPE',
          `Only Graphic symbols are supported in C01: ${element.libraryItemName} (${element.symbolType})`,
          elementPath,
        );
      }
      nodes.push(opaqueStandIn(element, parentTransform, `Unsupported symbol type: ${element.symbolType}`));
      continue;
    }
    if (element.alphaMultiplier !== undefined &&
        (!Number.isFinite(element.alphaMultiplier) || element.alphaMultiplier < 0 || element.alphaMultiplier > 1)) {
      if (!context.limits.tolerant) {
        return failure('INVALID_INPUT', 'Graphic alpha multiplier must be within 0..1', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Graphic alpha multiplier must be within 0..1'));
      continue;
    }
    if (element.rgbTransform !== undefined && !isValidFlaDisplayListRgbTransform(element.rgbTransform)) {
      if (!context.limits.tolerant) {
        return failure('INVALID_INPUT', 'Graphic RGB transform must use a multiplier in 0..1 and offset in 0..255', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Graphic RGB transform must use a multiplier in 0..1 and offset in 0..255'));
      continue;
    }
    if (!element.libraryItemName) {
      if (!context.limits.tolerant) {
        return failure('INVALID_INPUT', 'Graphic symbol reference is empty', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Graphic symbol reference is empty'));
      continue;
    }
    if (symbolStack.includes(element.libraryItemName)) {
      if (!context.limits.tolerant) {
        return failure(
          'SYMBOL_CYCLE',
          `Graphic symbol cycle: ${[...symbolStack, element.libraryItemName].join(' -> ')}`,
          elementPath,
        );
      }
      nodes.push(opaqueStandIn(element, parentTransform, `Graphic symbol cycle: ${[...symbolStack, element.libraryItemName].join(' -> ')}`));
      continue;
    }
    const definition = context.input.symbols.get(element.frameSelectionKey ?? element.libraryItemName);
    if (!definition) {
      if (!context.limits.tolerant) {
        return failure(
          'MISSING_SYMBOL',
          `Graphic symbol definition not found: ${element.libraryItemName}`,
          elementPath,
        );
      }
      nodes.push(opaqueStandIn(element, parentTransform, `Graphic symbol definition not found: ${element.libraryItemName}`));
      continue;
    }
    if (definition.libraryItemName !== element.libraryItemName || definition.kind !== 'graphic') {
      if (!context.limits.tolerant) {
        return failure('INVALID_INPUT', 'Graphic symbol definition identity is inconsistent', elementPath);
      }
      nodes.push(opaqueStandIn(element, parentTransform, 'Graphic symbol definition identity is inconsistent'));
      continue;
    }

    const nextDepth = nestingDepth + 1;
    if (nextDepth > context.limits.maxRecursionDepth) {
      if (!context.limits.tolerant) {
        return failure(
          'MAX_RECURSION_DEPTH_EXCEEDED',
          `Symbol expansion exceeded ${context.limits.maxRecursionDepth}`, elementPath,
        );
      }
      nodes.push(opaqueStandIn(element, parentTransform, `Symbol expansion exceeded ${context.limits.maxRecursionDepth}`));
      continue;
    }
    const budgetFailure = addResolvedNode(context, elementPath);
    if (budgetFailure) {
      if (!context.limits.tolerant) return budgetFailure;
      nodes.push(opaqueStandIn(element, parentTransform, budgetFailure.message));
      continue;
    }
    const childLayers = resolveLayers(
      definition.frameContext,
      worldTransform,
      [...symbolStack, element.libraryItemName],
      nextDepth,
      `${elementPath}:symbol(${element.libraryItemName})`,
      context,
      clipPaths,
    );
    if (!childLayers.ok) {
      if (!context.limits.tolerant) return childLayers;
      nodes.push(opaqueStandIn(element, parentTransform, childLayers.message));
      continue;
    }
    const symbolInstance = {
      ...(definition.sourceFrameCount !== undefined ? { sourceFrameCount: definition.sourceFrameCount } : {}),
      ...(element.sourceParentFrameSpanStart !== undefined ? { sourceParentFrameSpanStart: element.sourceParentFrameSpanStart } : {}),
      ...(element.frameSelectionKey !== undefined ? { frameSelectionKey: element.frameSelectionKey } : {}),
      ...(element.playbackMode !== undefined ? { playbackMode: element.playbackMode } : {}),
      ...(element.firstFrame !== undefined ? { firstFrame: element.firstFrame } : {}),
      ...(element.lastFrame !== undefined ? { lastFrame: element.lastFrame } : {}),
      ...(element.synchronizedFirstFrame !== undefined ? { synchronizedFirstFrame: element.synchronizedFirstFrame } : {}),
    };
    nodes.push({
      kind: 'group',
      groupId: `symbol:${element.libraryItemName}`,
      symbolLibraryItemName: element.libraryItemName,
      ...(element.sourceAddress ? { sourceAddress: element.sourceAddress } : {}),
      localTransform,
      worldTransform,
      ...(element.alphaMultiplier !== undefined ? { opacity: element.alphaMultiplier } : {}),
      ...(element.rgbTransform ? { rgbTransform: element.rgbTransform } : {}),
      ...(element.instanceFilters?.some((filter: FlaInstanceFilter) => filter.enabled)
        ? { instanceFilters: element.instanceFilters, instanceFilterClips: clipPaths } : {}),
      ...(Object.keys(symbolInstance).length ? { symbolInstance } : {}),
      children: childLayers.layers.flatMap((layer) => layer.children),
    });
  }
  return { ok: true, nodes };
}

/** Resolve one caller-selected scene or Graphic frame into an ordered tree. */
export function resolveFlaDisplayList(
  input: FlaDisplayListResolverInput,
  limits: Partial<FlaDisplayListResolverLimits> = {},
): FlaDisplayListResolverResult {
  const resolvedLimits = { ...DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS, ...limits };
  if (!validLimit(resolvedLimits.maxRecursionDepth) || !validLimit(resolvedLimits.maxResolvedNodeCount)) {
    return failure('INVALID_INPUT', 'Resolver limits must be positive safe integers', 'root');
  }
  if (!input || !input.root || !input.root.name || !input.symbols ||
      typeof input.symbols.get !== 'function' ||
      (input.root.kind !== 'scene' && input.root.kind !== 'graphic')) {
    return failure('INVALID_INPUT', 'Resolver input requires a named root and symbol map', 'root');
  }

  const rootTransform = FLA_DISPLAY_LIST_IDENTITY_MATRIX;
  const rootSymbolStack = input.root.kind === 'graphic' ? [input.root.name] : [];
  const context: ResolveContext = {
    input,
    limits: resolvedLimits,
    visitedNodeCount: 0,
    resolvedNodeCount: 0,
    maskDiagnostics: new Set(),
    maskFailureCount: 0,
    ikPoseDiagnostics: new Set(),
    ikPoseFailureCount: 0,
  };
  const layers = resolveLayers(
    input.root.frameContext,
    rootTransform,
    rootSymbolStack,
    0,
    `${input.root.kind}(${input.root.name})`,
    context,
  );
  if (!layers.ok) return layers;
  return {
    ok: true,
    displayList: {
      kind: input.root.kind,
      sourceName: input.root.name,
      frameIndex: input.root.frameContext.frameIndex,
      layers: layers.layers,
      resolvedNodeCount: context.resolvedNodeCount,
      ...(input.root.frameContext.projectionDiagnostics?.length ? { projectionDiagnostics: input.root.frameContext.projectionDiagnostics } : {}),
      ...(context.maskDiagnostics.size ? { maskDiagnostics: [...context.maskDiagnostics] } : {}),
      ...(context.ikPoseDiagnostics.size ? { ikPoseDiagnostics: [...context.ikPoseDiagnostics] } : {}),
    },
  };
}
