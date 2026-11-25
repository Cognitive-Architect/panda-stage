import {
  FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES,
  FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH,
  FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATHS_PER_SHAPE,
  FLA_GRAPHIC_STRUCTURE_MASK_PATH_PATTERN,
  FlaGraphicStructureSchema,
  type FlaGraphicNestedSymbolDefinition,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
} from '../../domain';
import type {
  FlaResolvedClipPath,
  FlaResolvedDisplayLayer,
  FlaResolvedDisplayList,
  FlaResolvedDisplayNode,
} from './fla-display-list-resolver';
import {
  localizeAbsoluteLeafMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';

type StructureClipPaths = NonNullable<FlaGraphicStructureNode['clipPaths']>;

interface MaskPathByteBudget {
  remainingBytes: number;
}

const identityMatrix: AffineMatrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};
const maskPathTextEncoder = new TextEncoder();

function clipPathsOf(
  clipPaths: readonly FlaResolvedClipPath[] | undefined,
  parentWorld: AffineMatrix2D,
  shapePathData: ReadonlyMap<string, readonly string[]>,
  maskPathByteBudget: MaskPathByteBudget,
): StructureClipPaths | undefined {
  if (!clipPaths?.length) return undefined;
  return clipPaths.map((clip) => ({
    shapes: clip.shapes.map((shape) => ({
      shapeId: shape.shapeId,
      worldTransform: { ...shape.worldTransform },
      ...(() => {
        const localized = localizeAbsoluteLeafMatrix(parentWorld, shape.worldTransform);
        return localized.ok
          ? { parentLocalTransform: { ...localized.value } }
          : {};
      })(),
      ...(() => {
        const pathData = shapePathData.get(shape.shapeId);
        if (!pathData?.length || pathData.length > FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATHS_PER_SHAPE) {
          return {};
        }
        let pathBytes = 0;
        for (const path of pathData) {
          const pathByteLength = maskPathTextEncoder.encode(path).byteLength;
          if (
            path.length === 0 ||
            pathByteLength > FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH ||
            !FLA_GRAPHIC_STRUCTURE_MASK_PATH_PATTERN.test(path)
          ) {
            return {};
          }
          pathBytes += pathByteLength;
          if (pathBytes > maskPathByteBudget.remainingBytes) return {};
        }
        // Charge each persisted copy, including repeated shape references.
        maskPathByteBudget.remainingBytes -= pathBytes;
        return { pathData: [...pathData] };
      })(),
    })),
  }));
}

export interface SubtreeBounds {
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly scope?: 'subtree' | 'frame-crop';
}

export interface IsolatedSubtreeCaptureResult extends SubtreeBounds {
  readonly sourceRef?: string;
  readonly reason?: string;
}

export interface IsolatedFilteredLayerCaptureResult extends IsolatedSubtreeCaptureResult {
  readonly clipPaths?: readonly FlaResolvedClipPath[];
}

export interface CaptureFlaGraphicStructureOptions {
  readonly fallbackAssetId?: string;
  readonly fallbackViewBox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly resolveSubtreeBounds?: (node: FlaResolvedDisplayNode) => SubtreeBounds | undefined;
  /** Isolated Shape artwork is in source-node local space; filtered layers stay residual. */
  readonly resolveIsolatedShape?: (node: Extract<FlaResolvedDisplayNode, { kind: 'shape' }>) => SubtreeBounds | undefined;
  /** Isolated opaque subtree (static text, instance-filtered group, or per-channel color group) in node-local space. */
  readonly resolveIsolatedSubtree?: (
    node: FlaResolvedDisplayNode,
    context: {
      readonly opaqueKind: 'text' | 'filter' | 'symbol';
      readonly parentWorld: AffineMatrix2D;
    },
  ) => IsolatedSubtreeCaptureResult | undefined;
  /** Isolated frame-filtered layer rendered as one semantically closed subtree in layer-local space. */
  readonly resolveIsolatedFilteredLayer?: (
    layer: FlaResolvedDisplayLayer,
    layerIndex: number,
  ) => IsolatedFilteredLayerCaptureResult | undefined;
  readonly subtreeBoundsMap?: ReadonlyMap<string, SubtreeBounds>;
  readonly sourceBasename?: string;
  readonly bitmapAssetMap?: ReadonlyMap<string, string>;
  /** Main-process, bounded vector contours extracted from source shape blocks. */
  readonly clipPathShapePathData?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Capture the authored object tree from the resolved FLA display list, before
 * any SVG baking. Resolved Symbol instances (expanded as Groups carrying
 * `symbolLibraryItemName`) become `symbol` nodes that keep their shared
 * definition reference; Shapes and unsupported elements are typed opaque and
 * keep the SVG fallback.
 */
export function captureFlaGraphicStructure(
  displayList: FlaResolvedDisplayList,
  options: CaptureFlaGraphicStructureOptions = {},
): FlaGraphicStructure | undefined {
  const canStoreClipPaths = (clipPaths: readonly FlaResolvedClipPath[] | undefined): boolean =>
    !clipPaths?.some((clip) => clip.shapes.length === 0 || clip.shapes.some((shape) => shape.clipPaths?.length));
  const canStoreMaskGeometry = (node: FlaResolvedDisplayNode): boolean => node.kind === 'group'
    ? canStoreClipPaths(node.instanceFilterClips) &&
      canStoreClipPaths(node.inheritedClipPaths) &&
      node.children.every(canStoreMaskGeometry)
    : canStoreClipPaths(node.clipPaths);
  if (displayList.maskDiagnostics?.length || displayList.ikPoseDiagnostics?.length ||
      !displayList.layers.every((layer) => layer.children.every(canStoreMaskGeometry))) return undefined;
  const usedIds = new Set<string>();
  const symbolDefinitions: Record<string, FlaGraphicNestedSymbolDefinition> = {};
  const maskPathByteBudget: MaskPathByteBudget = {
    remainingBytes: FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES,
  };
  const uniqueId = (preferred: string): string => {
    let id = preferred.slice(0, 900);
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${preferred.slice(0, 880)}#${suffix}`;
    usedIds.add(id);
    return id;
  };
  const convert = (
    nodes: readonly FlaResolvedDisplayNode[],
    parentId: string,
    forceOpaque: 'filter' | null,
    parentWorld: AffineMatrix2D = identityMatrix,
  ): FlaGraphicStructureNode[] =>
    nodes.map((node, drawOrder): FlaGraphicStructureNode => {
      const fallbackId = `${parentId}/${node.kind}[${drawOrder}]`;
      const id = uniqueId(node.sourceAddress ?? fallbackId);
      const authoredWorld = multiplyAffineMatrices(parentWorld, node.localTransform);
      const clipPaths = clipPathsOf(
        node.kind === 'group' ? undefined : node.clipPaths,
        parentWorld,
        options.clipPathShapePathData ?? new Map(),
        maskPathByteBudget,
      );
      const base = {
        id,
        ...(node.sourceAddress ? { sourceAddress: node.sourceAddress } : {}),
        drawOrder,
        localTransform: { ...node.localTransform },
        ...(clipPaths ? { clipPaths } : {}),
      };
      const resolveBounds = (): SubtreeBounds | undefined => {
        if (node.sourceAddress && options.subtreeBoundsMap?.has(node.sourceAddress)) {
          return options.subtreeBoundsMap.get(node.sourceAddress);
        }
        if (node.kind === 'shape' && options.subtreeBoundsMap?.has(node.shapeId)) {
          return options.subtreeBoundsMap.get(node.shapeId);
        }
        const resolved = options.resolveSubtreeBounds?.(node);
        if (resolved) return resolved;
        if (options.fallbackViewBox && !options.resolveSubtreeBounds && !options.subtreeBoundsMap) {
          return { viewBox: options.fallbackViewBox, scope: 'subtree' };
        }
        return undefined;
      };
      const bounds = (node.kind === 'shape' && !forceOpaque ? options.resolveIsolatedShape?.(node) : undefined) ?? resolveBounds();
      const fallbackScope = bounds?.scope ?? (bounds ? 'frame-crop' : undefined);
      const fallbackViewBox = bounds?.viewBox;
      const fallbackAssetId = fallbackViewBox && options.fallbackAssetId ? options.fallbackAssetId : undefined;

      if (forceOpaque) {
        return {
          ...base,
          type: 'opaque',
          opaqueKind: forceOpaque,
          ...(fallbackScope ? { fallbackScope } : {}),
          ...(fallbackAssetId ? { fallbackAssetId } : {}),
          ...(fallbackViewBox ? { fallbackViewBox: { ...fallbackViewBox } } : {}),
        };
      }
      if (node.kind === 'shape') {
        return {
          ...base,
          type: 'opaque',
          opaqueKind: 'shape',
          sourceRef: node.shapeId,
          ...(fallbackScope ? { fallbackScope } : {}),
          ...(fallbackAssetId ? { fallbackAssetId } : {}),
          ...(fallbackViewBox ? { fallbackViewBox: { ...fallbackViewBox } } : {}),
        };
      }
      if (node.kind === 'bitmap') {
        const assetId = options.bitmapAssetMap?.get(node.libraryItemName);
        return {
          ...base,
          type: 'bitmap',
          bitmapRef: node.libraryItemName,
          ...(assetId ? { assetId } : {}),
          ...(options.sourceBasename ? { sourceBasename: options.sourceBasename } : {}),
        };
      }
      if (node.kind === 'text') {
        const isolated = options.resolveIsolatedSubtree?.(node, {
          opaqueKind: 'text',
          parentWorld,
        });
        const textScope = isolated?.scope ?? (isolated ? 'subtree' : fallbackScope);
        const textViewBox = isolated?.viewBox ?? fallbackViewBox;
        const textAssetId = textViewBox && options.fallbackAssetId ? options.fallbackAssetId : undefined;
        return {
          ...base,
          type: 'opaque',
          opaqueKind: 'text',
          sourceRef: isolated?.sourceRef ?? node.textId,
          reason: isolated?.reason ?? 'Static text uses rasterized snapshot fallback',
          ...(textScope ? { fallbackScope: textScope } : {}),
          ...(textAssetId ? { fallbackAssetId: textAssetId } : {}),
          ...(textViewBox ? { fallbackViewBox: { ...textViewBox } } : {}),
        };
      }
      if (node.opaque) {
        return {
          ...base,
          type: 'opaque',
          opaqueKind: node.opaque.kind,
          ...(node.opaque.sourceRef ? { sourceRef: node.opaque.sourceRef } : {}),
          reason: node.opaque.reason,
          ...(fallbackScope ? { fallbackScope } : {}),
          ...(fallbackAssetId ? { fallbackAssetId } : {}),
          ...(fallbackViewBox ? { fallbackViewBox: { ...fallbackViewBox } } : {}),
        };
      }
      const hasEnabledInstanceFilters = Boolean(node.instanceFilters?.some((filter) => filter.enabled));
      const hasPerChannelRgbTransform = node.rgbTransform?.channelOffsets !== undefined;
      if (hasEnabledInstanceFilters || hasPerChannelRgbTransform) {
        const opaqueKind = hasEnabledInstanceFilters ? 'filter' : 'symbol';
        const groupClipPaths = clipPathsOf(
          node.instanceFilterClips ?? node.inheritedClipPaths,
          parentWorld,
          options.clipPathShapePathData ?? new Map(),
          maskPathByteBudget,
        );
        const isolated = options.resolveIsolatedSubtree?.(node, {
          opaqueKind,
          parentWorld,
        });
        const subtreeScope = isolated?.scope ?? (isolated ? 'subtree' : fallbackScope);
        const subtreeViewBox = isolated?.viewBox ?? fallbackViewBox;
        const subtreeAssetId = subtreeViewBox && options.fallbackAssetId ? options.fallbackAssetId : undefined;
        const fallbackSourceRef = node.symbolLibraryItemName ?? node.groupId;
        return {
          ...base,
          ...(groupClipPaths ? { clipPaths: groupClipPaths } : {}),
          type: 'opaque',
          opaqueKind,
          ...(isolated?.sourceRef ? { sourceRef: isolated.sourceRef } : (fallbackSourceRef ? { sourceRef: fallbackSourceRef } : {})),
          reason: isolated?.reason ?? (hasEnabledInstanceFilters
            ? 'Instance filter subtree uses isolated fallback'
            : 'Per-channel color transform subtree uses isolated fallback'),
          ...(subtreeScope ? { fallbackScope: subtreeScope } : {}),
          ...(subtreeAssetId ? { fallbackAssetId: subtreeAssetId } : {}),
          ...(subtreeViewBox ? { fallbackViewBox: { ...subtreeViewBox } } : {}),
        };
      }
      if (node.symbolLibraryItemName) {
        const symbolInstance = node.symbolInstance;
        const frameSelectionKey = symbolInstance?.frameSelectionKey;
        const baseDefKey = (
          frameSelectionKey
            ? `${node.symbolLibraryItemName}::${frameSelectionKey}`
            : node.symbolLibraryItemName
        ).slice(0, 880);
        const nestedDefinitionId = baseDefKey;
        if (!symbolDefinitions[nestedDefinitionId]) {
          const defChildren = convert(node.children, `def:${nestedDefinitionId}`, null, authoredWorld);
          symbolDefinitions[nestedDefinitionId] = {
            symbolRef: node.symbolLibraryItemName,
            ...(symbolInstance?.sourceFrameCount !== undefined ? { sourceFrameCount: symbolInstance.sourceFrameCount } : {}),
            ...(frameSelectionKey !== undefined ? { frameSelectionKey } : {}),
            children: defChildren,
          };
        }
        return {
          ...base,
          type: 'symbol',
          symbolRef: node.symbolLibraryItemName,
          nestedDefinitionId,
          ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
          ...(node.rgbTransform ? { rgbTransform: { ...node.rgbTransform } } : {}),
          ...(frameSelectionKey !== undefined ? { frameSelectionKey } : {}),
          ...(symbolInstance?.playbackMode !== undefined ? { playbackMode: symbolInstance.playbackMode } : {}),
          ...(symbolInstance?.firstFrame !== undefined ? { firstFrame: symbolInstance.firstFrame } : {}),
          ...(symbolInstance?.lastFrame !== undefined ? { lastFrame: symbolInstance.lastFrame } : {}),
          ...(symbolInstance?.synchronizedFirstFrame !== undefined ? { synchronizedFirstFrame: symbolInstance.synchronizedFirstFrame } : {}),
          ...(symbolInstance?.sourceParentFrameSpanStart !== undefined ? { sourceParentFrameSpanStart: symbolInstance.sourceParentFrameSpanStart } : {}),
        };
      }
      const children = convert(node.children, id, null, authoredWorld);
      return { ...base, type: 'group', groupId: node.groupId, children };
    });

  const layers = displayList.layers.map((layer, layerIndex) => {
    if (layer.frameFilter && options.resolveIsolatedFilteredLayer) {
      const isolatedLayer = options.resolveIsolatedFilteredLayer(layer, layerIndex);
      if (isolatedLayer) {
        const layerClips = clipPathsOf(
          isolatedLayer.clipPaths,
          identityMatrix,
          options.clipPathShapePathData ?? new Map(),
          maskPathByteBudget,
        );
        const singleChild = layer.children.length === 1 ? layer.children[0] : undefined;
        const preferredId = singleChild?.sourceAddress ?? `layer[${layerIndex}]/filter[0]`;
        const id = uniqueId(preferredId);
        return {
          name: layer.name.slice(0, 500),
          nodes: [{
            id,
            ...(singleChild?.sourceAddress ? { sourceAddress: singleChild.sourceAddress } : {}),
            drawOrder: 0,
            localTransform: { ...identityMatrix },
            ...(layerClips ? { clipPaths: layerClips } : {}),
            type: 'opaque' as const,
            opaqueKind: 'filter' as const,
            ...(isolatedLayer.sourceRef ? { sourceRef: isolatedLayer.sourceRef } : {}),
            reason: isolatedLayer.reason ?? 'Layer filter uses isolated subtree fallback',
            fallbackScope: isolatedLayer.scope ?? 'subtree',
            ...(options.fallbackAssetId ? { fallbackAssetId: options.fallbackAssetId } : {}),
            fallbackViewBox: { ...isolatedLayer.viewBox },
          }],
        };
      }
    }
    return {
      name: layer.name.slice(0, 500),
      nodes: convert(layer.children, `layer[${layerIndex}]`, layer.frameFilter ? 'filter' : null),
    };
  });
  const parsed = FlaGraphicStructureSchema.safeParse({
    version: 1,
    ...(Object.keys(symbolDefinitions).length > 0 ? { symbolDefinitions } : {}),
    frames: [{ ordinal: 0, layers }],
  });
  return parsed.success ? parsed.data : undefined;
}
