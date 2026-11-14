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
  return !tail || /^(?:[0-9a-f]{8}-|[0-9a-f]{16,}(?:\.[^.]+)?$|fla-(?:group|node|shape|bitmap|symbol)-|(?:group|node|shape)[-_:]?\d|.*\[\d+\])/i.test(tail)
    ? fallback : tail;
}

function readableGroupName(
  node: Extract<FlaGraphicStructureNode, { type: 'group' }>,
  structure?: FlaGraphicStructure,
): string | null {
  const ownName = friendlyTail(node.groupId, '');
  if (ownName) return ownName;
  // Breadth first: prefer the nearest authored identity, then sibling draw order.
  let descendants = [...node.children].sort((a, b) => a.drawOrder - b.drawOrder);
  for (let depth = 0; depth < 64 && descendants.length; depth++) {
    const next: FlaGraphicStructureNode[] = [];
    for (const child of descendants) {
      const name = child.type === 'symbol' ? friendlyTail(child.symbolRef, '')
        : child.type === 'bitmap' ? (friendlyTail(child.bitmapRef, '') || friendlyTail(child.sourceBasename ?? '', '')).replace(/\.[^.]+$/, '')
          : child.type === 'group' ? friendlyTail(child.groupId, '') : '';
      if (name) return name;
      const children = child.type === 'group' ? child.children
        : child.type === 'symbol' ? resolveFlaGraphicSymbolChildren(child, structure) : [];
      next.push(...[...children].sort((a, b) => a.drawOrder - b.drawOrder));
    }
    descendants = next;
  }
  return null;
}

export function structureNodeLabel(node: FlaGraphicStructureNode, structure?: FlaGraphicStructure): string {
  switch (node.type) {
    case 'symbol': return friendlyTail(node.symbolRef, '元件');
    case 'bitmap': return friendlyTail(node.sourceBasename ?? node.bitmapRef, '位图');
    case 'group': return readableGroupName(node, structure) ?? '未命名';
    case 'opaque': return ({ shape: '形状', text: '文本', filter: '滤镜', symbol: '元件', unknown: '对象' })[node.opaqueKind];
  }
}

/** UI projection only: occurrence paths remain the editor's authored node paths. */
export function projectStructureTree(frame: FlaGraphicStructureFrame, structure: FlaGraphicStructure): StructureTreeRow[] {
  const visit = (nodes: readonly FlaGraphicStructureNode[], parent: readonly string[], depth: number): StructureTreeRow[] => {
    let unnamedGroupCount = 0;
    return [...nodes].sort((a, b) => a.drawOrder - b.drawOrder).map(node => {
      const path = [...parent, node.id];
      const children = depth < 64
        ? node.type === 'group' ? node.children
          : node.type === 'symbol' ? resolveFlaGraphicSymbolChildren(node, structure) : []
        : [];
      const label = node.type === 'group'
        ? readableGroupName(node, structure) ?? `未命名 ${++unnamedGroupCount}`
        : structureNodeLabel(node, structure);
      return { key: JSON.stringify(path), label, type: node.type, path, node, children: visit(children, path, depth + 1) };
    });
  };
  return frame.layers.map((layer, index) => ({
    key: `layer:${index}`, label: layer.name || `图层 ${index + 1}`, type: 'layer', path: [], node: null,
    children: visit(layer.nodes, [], 0),
  }));
}

export function structureAncestorKeys(path: readonly string[]): string[] {
  return path.slice(0, -1).map((_, index) => JSON.stringify(path.slice(0, index + 1)));
}
