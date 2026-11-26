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
import { FlaGraphicEditableTextSchema } from '../../domain/models/flaGraphicInstanceText';
import type { FlaStaticTextDescriptor } from '../../shared/fla-static-text';
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
  /** Placement of the isolated SVG axes in the original display list. */
  readonly artworkTransform?: AffineMatrix2D;
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
  readonly resolveShapeCoveragePathData?: (node: Extract<FlaResolvedDisplayNode, { kind: 'shape' }>) => readonly string[] | undefined;
  /** Isolated opaque subtree artwork in node-local or explicit effect space. */
  readonly resolveIsolatedSubtree?: (
    node: FlaResolvedDisplayNode,
    context: {
      readonly opaqueKind: 'text' | 'filter' | 'symbol';
      readonly parentWorld: AffineMatrix2D;
    },
  ) => IsolatedSubtreeCaptureResult | undefined;
  readonly resolveStaticText?: (node: FlaResolvedDisplayNode) => FlaStaticTextDescriptor | undefined;
  /** Isolated frame-filtered layer rendered as one semantically closed subtree in layer-local space. */
  readonly resolveIsolatedFilteredLayer?: (
    layer: FlaResolvedDisplayLayer,
    layerIndex: number,
    frameOrdinal: number,
  ) => IsolatedFilteredLayerCaptureResult | undefined;
  readonly subtreeBoundsMap?: ReadonlyMap<string, SubtreeBounds>;
  readonly sourceBasename?: string;
  readonly bitmapAssetMap?: ReadonlyMap<string, string>;
  /** Main-process, bounded vector contours extracted from source shape blocks. */
  readonly clipPathShapePathData?: ReadonlyMap<string, readonly string[]>;
}

export function hasScreenSpaceArtwork(node: FlaResolvedDisplayNode): boolean {
  if (node.kind === 'group') {
    return Boolean(node.scale9Grid || node.instanceFilters?.some((filter) => filter.enabled)) ||
      node.children.some(hasScreenSpaceArtwork);
  }
  return node.kind === 'text' && Boolean(node.instanceFilters?.some((filter) => filter.enabled));
}

/**
 * Capture the authored object tree from one or more resolved FLA display lists
 * (one per Definition frame ordinal), before any SVG baking. Resolved Symbol
 * instances become `symbol` nodes that keep their shared definition reference;
 * Shapes and unsupported/isolated elements are typed opaque and keep their
 * subtree/frame SVG fallback.
 */
export function captureFlaGraphicStructureFrames(
  frameDisplayLists: readonly FlaResolvedDisplayList[],
  options: CaptureFlaGraphicStructureOptions = {},
): FlaGraphicStructure | undefined {
  if (frameDisplayLists.length === 0 || frameDisplayLists.length > 256) return undefined;
  const canStoreClipPaths = (clipPaths: readonly FlaResolvedClipPath[] | undefined): boolean =>
    !clipPaths?.some((clip) => clip.shapes.length === 0 || clip.shapes.some((shape) => shape.clipPaths?.length));
  const canStoreMaskGeometry = (node: FlaResolvedDisplayNode): boolean => node.kind === 'group'
    ? canStoreClipPaths(node.instanceFilterClips) &&
      canStoreClipPaths(node.inheritedClipPaths) &&
      node.children.every(canStoreMaskGeometry)
    : canStoreClipPaths(node.clipPaths);
  for (const displayList of frameDisplayLists) {
    if (displayList.maskDiagnostics?.length || displayList.ikPoseDiagnostics?.length ||
        !displayList.layers.every((layer) => layer.children.every(canStoreMaskGeometry))) {
      return undefined;
    }
  }
  const usedIds = new Set<string>();
  let invalidArtworkPlacement = false;
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
      const artworkPlacement = (isolated: IsolatedSubtreeCaptureResult | undefined) => {
        if (!isolated?.artworkTransform) return {};
        const placement = localizeAbsoluteLeafMatrix(parentWorld, isolated.artworkTransform);
        if (!placement.ok) invalidArtworkPlacement = true;
        return placement.ok ? { localTransform: placement.value } : {};
      };
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
        const rawCoverage = options.resolveShapeCoveragePathData?.(node);
        let coveragePathData: string[] | undefined;
        if (rawCoverage?.length && rawCoverage.length <= FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATHS_PER_SHAPE) {
          let totalBytes = 0;
          const valid = rawCoverage.every((entry) => {
            if (!FLA_GRAPHIC_STRUCTURE_MASK_PATH_PATTERN.test(entry)) return false;
            const bytes = maskPathTextEncoder.encode(entry).byteLength;
            if (bytes === 0 || bytes > FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH) return false;
            totalBytes += bytes;
            return true;
          });
          if (valid && totalBytes <= maskPathByteBudget.remainingBytes) {
            maskPathByteBudget.remainingBytes -= totalBytes;
            coveragePathData = [...rawCoverage];
          }
        }
        return {
          ...base,
          type: 'opaque',
          opaqueKind: 'shape',
          sourceRef: node.shapeId,
          ...(fallbackScope ? { fallbackScope } : {}),
          ...(fallbackAssetId ? { fallbackAssetId } : {}),
          ...(fallbackViewBox ? { fallbackViewBox: { ...fallbackViewBox } } : {}),
          ...(coveragePathData ? { coveragePathData } : {}),
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
        const editableText = isolated && !isolated.artworkTransform
          ? FlaGraphicEditableTextSchema.safeParse(options.resolveStaticText?.(node))
          : undefined;
        return {
          ...base,
          ...artworkPlacement(isolated),
          type: 'opaque',
          opaqueKind: 'text',
          ...(editableText?.success ? { editableText: editableText.data } : {}),
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
      const hasNonSymbolPerChannelColor = !node.symbolLibraryItemName &&
        (node.rgbTransform?.channelOffsets !== undefined || node.rgbaTransform !== undefined);
      const opaqueKind = hasEnabledInstanceFilters ? 'filter' : 'symbol';
      const isolated = (hasEnabledInstanceFilters || hasNonSymbolPerChannelColor || node.scale9Grid)
        ? options.resolveIsolatedSubtree?.(node, { opaqueKind, parentWorld }) : undefined;
      if (hasEnabledInstanceFilters || hasNonSymbolPerChannelColor || isolated) {
        const groupClipPaths = clipPathsOf(
          node.instanceFilterClips ?? node.inheritedClipPaths,
          parentWorld,
          options.clipPathShapePathData ?? new Map(),
          maskPathByteBudget,
        );
        const subtreeScope = isolated?.scope ?? (isolated ? 'subtree' : fallbackScope);
        const subtreeViewBox = isolated?.viewBox ?? fallbackViewBox;
        const subtreeAssetId = subtreeViewBox && options.fallbackAssetId ? options.fallbackAssetId : undefined;
        const fallbackSourceRef = node.symbolLibraryItemName ?? node.groupId;
        return {
          ...base,
          ...artworkPlacement(isolated),
          ...(groupClipPaths ? { clipPaths: groupClipPaths } : {}),
          type: 'opaque',
          opaqueKind,
          ...(isolated?.sourceRef ? { sourceRef: isolated.sourceRef } : (fallbackSourceRef ? { sourceRef: fallbackSourceRef } : {})),
          reason: isolated?.reason ?? (hasEnabledInstanceFilters
            ? 'Instance filter subtree uses isolated fallback'
            : 'Per-channel color transform subtree uses isolated fallback'),
          ...(node.blendMode ? { blendMode: node.blendMode } : {}),
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
        // A child effect is baked against the occurrence's display axes. A symbol
        // placed at a different scale or rotation cannot share that child's SVG.
        const needsEffectVariant = options.resolveIsolatedSubtree && node.children.some(hasScreenSpaceArtwork);
        const { a, b, c, d } = node.worldTransform;
        const nestedDefinitionId = needsEffectVariant
          ? `${baseDefKey}::effects:${[a, b, c, d].join(',')}`
          : baseDefKey;
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
          ...(node.rgbaTransform
            ? {
                rgbaTransform: {
                  multipliers: [...node.rgbaTransform.multipliers] as [number, number, number, number],
                  offsets: [...node.rgbaTransform.offsets] as [number, number, number, number],
                },
              }
            : {
                ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
                ...(node.rgbTransform
                  ? {
                      rgbTransform: {
                        multiplier: node.rgbTransform.multiplier,
                        offset: node.rgbTransform.offset,
                        ...(node.rgbTransform.channelOffsets
                          ? { channelOffsets: [...node.rgbTransform.channelOffsets] as [number, number, number] }
                          : {}),
                      },
                    }
                  : {}),
              }),
          ...(node.blendMode ? { blendMode: node.blendMode } : {}),
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

  const frames = frameDisplayLists.map((displayList, frameOrdinal) => {
    const layerPrefix = frameDisplayLists.length > 1 ? `frame[${frameOrdinal}]/` : '';
    const layers = displayList.layers.map((layer, layerIndex) => {
      if (layer.frameFilter && options.resolveIsolatedFilteredLayer) {
        const isolatedLayer = options.resolveIsolatedFilteredLayer(layer, layerIndex, frameOrdinal);
        if (isolatedLayer) {
          const layerClips = clipPathsOf(
            isolatedLayer.clipPaths,
            identityMatrix,
            options.clipPathShapePathData ?? new Map(),
            maskPathByteBudget,
          );
          const singleChild = layer.children.length === 1 ? layer.children[0] : undefined;
          const preferredId = singleChild?.sourceAddress ?? `${layerPrefix}layer[${layerIndex}]/filter[0]`;
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
        nodes: convert(layer.children, `${layerPrefix}layer[${layerIndex}]`, layer.frameFilter ? 'filter' : null),
      };
    });
    return { ordinal: frameOrdinal, layers };
  });
  if (invalidArtworkPlacement) return undefined;
  const parsed = FlaGraphicStructureSchema.safeParse({
    version: 1,
    ...(Object.keys(symbolDefinitions).length > 0 ? { symbolDefinitions } : {}),
    frames,
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Capture the authored object tree from a single resolved FLA display list
 * (frame 0), before any SVG baking.
 */
export function captureFlaGraphicStructure(
  displayList: FlaResolvedDisplayList,
  options: CaptureFlaGraphicStructureOptions = {},
): FlaGraphicStructure | undefined {
  return captureFlaGraphicStructureFrames([displayList], options);
}
