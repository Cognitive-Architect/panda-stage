import { resolveFlaGraphicSymbolChildren, type FlaGraphicStructure, type FlaGraphicStructureFrame, type FlaGraphicStructureNode } from '../../../domain';

export interface StructureTreeRow {
  readonly key: string;
  readonly label: string;
  readonly type: 'layer' | FlaGraphicStructureNode['type'];
  readonly path: readonly string[];
  readonly node: FlaGraphicStructureNode | null;
  readonly children: readonly StructureTreeRow[];
}

function friendlyTail(value: string, fallback: string): string {
  const tail = value.split(/[\\/]/).pop()?.trim() ?? '';
  // Capture-generated identities are provenance, not creator-facing names.
  return !tail || /^(?:[0-9a-f]{8}-|fla-(?:group|node|shape)-|(?:group|node|shape)[-_:]?\d|.*\[\d+\])/i.test(tail)
    ? fallback : tail;
}

export function structureNodeLabel(node: FlaGraphicStructureNode): string {
  switch (node.type) {
    case 'symbol': return friendlyTail(node.symbolRef, '元件');
    case 'bitmap': return friendlyTail(node.sourceBasename ?? node.bitmapRef, '位图');
    case 'group': return friendlyTail(node.groupId, '组');
    case 'opaque': return ({ shape: '形状', text: '文本', filter: '滤镜', symbol: '元件', unknown: '对象' })[node.opaqueKind];
  }
}

/** UI projection only: occurrence paths remain the editor's authored node paths. */
export function projectStructureTree(frame: FlaGraphicStructureFrame, structure: FlaGraphicStructure): StructureTreeRow[] {
  const visit = (nodes: readonly FlaGraphicStructureNode[], parent: readonly string[], depth: number): StructureTreeRow[] =>
    [...nodes].sort((a, b) => a.drawOrder - b.drawOrder).map(node => {
      const path = [...parent, node.id];
      const children = depth < 64
        ? node.type === 'group' ? node.children
          : node.type === 'symbol' ? resolveFlaGraphicSymbolChildren(node, structure) : []
        : [];
      return { key: JSON.stringify(path), label: structureNodeLabel(node), type: node.type, path, node, children: visit(children, path, depth + 1) };
    });
  return frame.layers.map((layer, index) => ({
    key: `layer:${index}`, label: layer.name || `图层 ${index + 1}`, type: 'layer', path: [], node: null,
    children: visit(layer.nodes, [], 0),
  }));
}

export function structureAncestorKeys(path: readonly string[]): string[] {
  return path.slice(0, -1).map((_, index) => JSON.stringify(path.slice(0, index + 1)));
}
