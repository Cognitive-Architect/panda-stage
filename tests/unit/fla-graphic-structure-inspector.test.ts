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
    expect(structureNodeLabel({ type: 'group', id: 'private-id', drawOrder: 0, localTransform: identity, groupId: 'group-123', children: [] })).toBe('组');
  });
});
