import { describe, expect, it } from 'vitest';
import type { FlaGraphicStructure, FlaGraphicStructureNode } from '../../src/domain';
import { projectStructureTree, structureAncestorKeys, structureNodeLabel } from '../../src/renderer/features/properties/flaGraphicStructureTreeModel';
import { getFlaGraphicNodeAtPath, isFlaGraphicNodeEnterable, resolveFlaGraphicExitScopeTransition } from '../../src/renderer/features/canvas/flaGraphicEditScope';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const shape: FlaGraphicStructureNode = { type: 'opaque', id: 'source-address-private', drawOrder: 0, localTransform: identity, opaqueKind: 'shape' };
const symbol: FlaGraphicStructureNode = { type: 'symbol', id: 'symbol-occurrence', drawOrder: 0, localTransform: identity, symbolRef: 'library/人物/头部', nestedDefinitionId: 'definition-private' };
const structure: FlaGraphicStructure = { version: 1, frames: [{ ordinal: 0, layers: [{ name: '人物', nodes: [symbol] }] }],
  symbolDefinitions: { 'definition-private': { symbolRef: symbol.symbolRef, children: [shape] } } };

describe('Structured Inspector tree projection', () => {
  it('shows authored hierarchy with shared definitions expanded at their occurrence and uses existing node paths', () => {
    const rows = projectStructureTree(structure.frames[0]!, structure);
    const head = rows[0]!.children[0]!;
    const leaf = head.children[0]!;
    expect(rows[0]!.label).toBe('人物');
    expect(head.label).toBe('头部');
    expect(leaf.label).toBe('形状');
    expect(leaf.path).toEqual(['symbol-occurrence', 'source-address-private']);
    expect(getFlaGraphicNodeAtPath(structure.frames[0]!, leaf.path, structure)).toBe(shape);
    expect(isFlaGraphicNodeEnterable(symbol, structure)).toBe(true);
    expect(resolveFlaGraphicExitScopeTransition(structure.frames[0]!, head.path, structure)).toEqual({ nextScopePath: [], nextSelectedNodePath: head.path });
    expect(structureAncestorKeys(leaf.path)).toEqual([head.key]);
  });
  it('maps opaque kinds and avoids exposing generated group provenance', () => {
    expect(structureNodeLabel({ ...shape, opaqueKind: 'text' })).toBe('文本');
    expect(structureNodeLabel({ ...shape, opaqueKind: 'filter' })).toBe('滤镜');
    expect(structureNodeLabel({ ...shape, opaqueKind: 'unknown' })).toBe('对象');
    expect(structureNodeLabel({ type: 'group', id: 'private-id', drawOrder: 0, localTransform: identity, groupId: 'group-123', children: [] })).toBe('未命名');
  });

  it('prefers an authored group name, then the nearest readable descendant in authored order', () => {
    const group = (id: string, children: FlaGraphicStructureNode[], groupId = 'fla-group-private'): FlaGraphicStructureNode =>
      ({ type: 'group', id, drawOrder: 0, localTransform: identity, groupId, children });
    const bitmap: FlaGraphicStructureNode = { type: 'bitmap', id: 'bitmap-private', drawOrder: 1, localTransform: identity, bitmapRef: '服饰/衣服.png', sourceBasename: 'fla-bitmap-private' };
    expect(structureNodeLabel(group('named', [symbol], '身体'))).toBe('身体');
    expect(structureNodeLabel(group('head', [symbol]), structure)).toBe('头部');
    expect(structureNodeLabel(group('clothes', [bitmap]))).toBe('衣服');
    // A direct bitmap is nearer than the Symbol behind another anonymous Group.
    expect(structureNodeLabel(group('nearest', [group('deep', [symbol]), bitmap]), structure)).toBe('衣服');
    expect(structureNodeLabel(group('ordered', [bitmap, { ...symbol, drawOrder: 0 }]), structure)).toBe('头部');
  });

  it('resolves semantic names through normalized Symbol children without showing private identities', () => {
    const bitmap: FlaGraphicStructureNode = { type: 'bitmap', id: 'bitmap-private', drawOrder: 0, localTransform: identity, bitmapRef: '服饰/衣服.png' };
    const privateSymbol: FlaGraphicStructureNode = { ...symbol, symbolRef: 'fla-symbol-private', nestedDefinitionId: 'private' };
    const group: FlaGraphicStructureNode = { type: 'group', id: 'group-private', groupId: 'fla-group-private', drawOrder: 0, localTransform: identity, children: [privateSymbol] };
    const normalized = { ...structure, symbolDefinitions: { private: { symbolRef: 'fla-symbol-private', children: [bitmap] } } };
    expect(structureNodeLabel(group, normalized)).toBe('衣服');
    expect(structureNodeLabel({ ...group, children: [{ ...bitmap, bitmapRef: '1234567890abcdef1234567890abcdef.png' }] })).toBe('未命名');
  });

  it('numbers only anonymous groups within each sibling scope and preserves paths, hierarchy and project data', () => {
    const anonymous = (id: string, drawOrder: number, children: FlaGraphicStructureNode[] = [shape]): FlaGraphicStructureNode =>
      ({ type: 'group', id, groupId: `fla-group-${id}`, drawOrder, localTransform: identity, children });
    const frame = { ordinal: 0, layers: [
      { name: '人物', nodes: [anonymous('one', 0), { ...symbol, drawOrder: 1 }, anonymous('named', 2, [symbol]), anonymous('two', 3, [anonymous('nested', 0)])] },
      { name: '另一层', nodes: [anonymous('other', 0)] },
    ] };
    const input = { version: 1 as const, frames: [frame] };
    const before = JSON.stringify(input);
    const rows = projectStructureTree(frame, input);
    expect(rows[0]!.children.filter(row => row.type === 'group').map(row => row.label)).toEqual(['未命名 1', '头部', '未命名 2']);
    expect(rows[0]!.children[3]!.children[0]!.label).toBe('未命名 1');
    expect(rows[1]!.children[0]!.label).toBe('未命名 1');
    expect(rows[0]!.children[3]!.children[0]!.path).toEqual(['two', 'nested']);
    expect(projectStructureTree(frame, input)).toEqual(rows);
    expect(JSON.stringify(input)).toBe(before);
  });
});
