import {
  FlaGraphicStructureSchema,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
} from '../../domain';
import type {
  FlaResolvedClipPath,
  FlaResolvedDisplayList,
  FlaResolvedDisplayNode,
} from './fla-display-list-resolver';

type StructureClipPaths = NonNullable<FlaGraphicStructureNode['clipPaths']>;

function clipPathsOf(clipPaths: readonly FlaResolvedClipPath[] | undefined): StructureClipPaths | undefined {
  if (!clipPaths?.length) return undefined;
  return clipPaths.map((clip) => ({
    shapes: clip.shapes.map((shape) => ({
      shapeId: shape.shapeId,
      worldTransform: { ...shape.worldTransform },
    })),
  }));
}

/**
 * Capture the authored object tree from the resolved FLA display list, before
 * any SVG baking. Resolved Symbol instances (expanded as Groups carrying
 * `symbolLibraryItemName`) become `symbol` nodes that keep their shared
 * definition reference; Shapes are typed opaque and keep the SVG fallback.
 */
export function captureFlaGraphicStructure(
  displayList: FlaResolvedDisplayList,
): FlaGraphicStructure | undefined {
  const usedIds = new Set<string>();
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
  ): FlaGraphicStructureNode[] =>
    nodes.map((node, drawOrder): FlaGraphicStructureNode => {
      const fallbackId = `${parentId}/${node.kind}[${drawOrder}]`;
      const id = uniqueId(node.sourceAddress ?? fallbackId);
      const base = {
        id,
        ...(node.sourceAddress ? { sourceAddress: node.sourceAddress } : {}),
        drawOrder,
        localTransform: { ...node.localTransform },
        ...(node.kind === 'group' ? {} : (() => {
          const clipPaths = clipPathsOf(node.clipPaths);
          return clipPaths ? { clipPaths } : {};
        })()),
      };
      if (forceOpaque) {
        return { ...base, type: 'opaque', opaqueKind: forceOpaque };
      }
      if (node.kind === 'shape') {
        return { ...base, type: 'opaque', opaqueKind: 'shape', sourceRef: node.shapeId };
      }
      if (node.kind === 'bitmap') {
        return { ...base, type: 'bitmap', bitmapRef: node.libraryItemName };
      }
      const children = convert(node.children, id, null);
      if (node.symbolLibraryItemName) {
        return {
          ...base,
          type: 'symbol',
          symbolRef: node.symbolLibraryItemName,
          ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
          ...(node.rgbTransform ? { rgbTransform: { ...node.rgbTransform } } : {}),
          children,
        };
      }
      return { ...base, type: 'group', groupId: node.groupId, children };
    });

  const layers = displayList.layers.map((layer, layerIndex) => ({
    name: layer.name.slice(0, 500),
    nodes: convert(layer.children, `layer[${layerIndex}]`, layer.frameFilter ? 'filter' : null),
  }));
  const parsed = FlaGraphicStructureSchema.safeParse({
    version: 1,
    frames: [{ ordinal: 0, layers }],
  });
  return parsed.success ? parsed.data : undefined;
}
