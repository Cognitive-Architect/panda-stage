import { describe, expect, it } from 'vitest';
import {
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  resolveFlaDisplayList,
  type FlaDisplayListFrameContext,
  type FlaDisplayListResolverInput,
  type FlaGraphicSymbolDefinition,
} from '../../src/main/services/fla-display-list-resolver';

const IDENTITY = FLA_DISPLAY_LIST_IDENTITY_MATRIX;

function frameContext(
  layers: FlaDisplayListFrameContext['layers'],
  frameIndex = 0,
): FlaDisplayListFrameContext {
  return { frameIndex, layers };
}

/** Generated, repo-safe display-list fixture; it never opens or writes a FLA. */
function buildP0C01Fixture(): FlaDisplayListResolverInput {
  const symbolB: FlaGraphicSymbolDefinition = {
    kind: 'graphic',
    libraryItemName: 'symbol-b',
    frameContext: frameContext([
      {
        name: 'b-visible-layer',
        visible: true,
        elements: [
          {
            kind: 'bitmap',
            libraryItemName: 'bitmap-ref.png',
            localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 6 },
          },
          { kind: 'shape', shapeId: 'shape-in-b', localTransform: IDENTITY },
        ],
      },
      {
        name: 'b-second-visible-layer',
        visible: true,
        elements: [{ kind: 'shape', shapeId: 'shape-in-b-second-layer', localTransform: IDENTITY }],
      },
      {
        name: 'b-hidden-layer',
        visible: false,
        elements: [{ kind: 'bitmap', libraryItemName: 'hidden-bitmap.png' }],
      },
    ]),
  };
  const symbolA: FlaGraphicSymbolDefinition = {
    kind: 'graphic',
    libraryItemName: 'symbol-a',
    frameContext: frameContext([
      {
        name: 'a-layer',
        visible: true,
        elements: [
          {
            kind: 'group',
            groupId: 'nested-a-group',
            localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 2 },
            elements: [
              {
                kind: 'symbol',
                libraryItemName: 'symbol-b',
                symbolType: 'graphic',
                localTransform: { a: 0, b: 2, c: -2, d: 0, tx: 3, ty: 4 },
              },
            ],
          },
        ],
      },
    ]),
  };

  return {
    root: {
      kind: 'scene',
      name: 'synthetic-scene',
      frameContext: frameContext([
        {
          name: 'source-layer-0',
          visible: true,
          elements: [
            { kind: 'shape', shapeId: 'scene-shape', localTransform: IDENTITY },
            {
              kind: 'symbol',
              libraryItemName: 'symbol-a',
              symbolType: 'graphic',
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
            },
            { kind: 'bitmap', libraryItemName: 'scene-overlay.png', localTransform: IDENTITY },
            {
              kind: 'symbol',
              libraryItemName: 'missing-but-hidden',
              symbolType: 'graphic',
              visible: false,
            },
          ],
        },
        {
          name: 'source-hidden-layer',
          visible: false,
          elements: [{ kind: 'symbol', libraryItemName: 'also-missing', symbolType: 'graphic' }],
        },
        {
          name: 'source-layer-1',
          visible: true,
          elements: [{ kind: 'shape', shapeId: 'second-layer-shape', localTransform: IDENTITY }],
        },
      ], 7),
    },
    symbols: new Map([
      ['symbol-a', symbolA],
      ['symbol-b', symbolB],
    ]),
  };
}

describe('P0-C01 FLA display-list resolver', () => {
  it('resolves a caller-selected Graphic frame context without selecting or advancing its timeline', () => {
    const result = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: 'selected-graphic',
        frameContext: frameContext([{
          name: 'selected-layer',
          visible: true,
          elements: [{ kind: 'bitmap', libraryItemName: 'selected-frame-bitmap.png' }],
        }], 4),
      },
      symbols: new Map(),
    });

    expect(result).toMatchObject({
      ok: true,
      displayList: {
        kind: 'graphic',
        sourceName: 'selected-graphic',
        frameIndex: 4,
        layers: [{ children: [{ kind: 'bitmap', libraryItemName: 'selected-frame-bitmap.png' }] }],
      },
    });
  });

  it('recursively resolves Graphic symbols, preserves source order, omits hidden entries, and accumulates parent × local transforms', () => {
    const result = resolveFlaDisplayList(buildP0C01Fixture());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const displayList = result.displayList;
    expect(displayList).toMatchObject({
      kind: 'scene',
      sourceName: 'synthetic-scene',
      frameIndex: 7,
    });
    expect(displayList.layers.map((layer) => layer.name)).toEqual(['source-layer-0', 'source-layer-1']);

    const sceneChildren = displayList.layers[0]?.children ?? [];
    expect(sceneChildren.map((node) => node.kind === 'group'
      ? node.symbolLibraryItemName ?? node.groupId
      : node.kind === 'shape' ? node.shapeId : node.libraryItemName)).toEqual([
      'scene-shape',
      'symbol-a',
      'scene-overlay.png',
    ]);

    const symbolA = sceneChildren[1];
    expect(symbolA?.kind).toBe('group');
    if (!symbolA || symbolA.kind !== 'group') return;
    expect(symbolA.worldTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 });

    const nestedGroup = symbolA.children[0];
    expect(nestedGroup?.kind).toBe('group');
    if (!nestedGroup || nestedGroup.kind !== 'group') return;
    expect(nestedGroup.groupId).toBe('nested-a-group');
    expect(nestedGroup.worldTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 11, ty: 22 });

    const symbolB = nestedGroup.children[0];
    expect(symbolB?.kind).toBe('group');
    if (!symbolB || symbolB.kind !== 'group') return;
    expect(symbolB.symbolLibraryItemName).toBe('symbol-b');
    expect(symbolB.worldTransform).toEqual({ a: 0, b: 2, c: -2, d: 0, tx: 14, ty: 26 });
    expect(symbolB.children.map((node) => node.kind)).toEqual(['bitmap', 'shape', 'shape']);
    expect(symbolB.children[0]?.kind === 'bitmap' ? symbolB.children[0].libraryItemName : null)
      .toBe('bitmap-ref.png');
    expect(symbolB.children[0]?.worldTransform).toEqual({ a: 0, b: 2, c: -2, d: 0, tx: 2, ty: 36 });
    expect(symbolB.children[1]?.worldTransform).toEqual({ a: 0, b: 2, c: -2, d: 0, tx: 14, ty: 26 });
    expect(symbolB.children[2]?.kind === 'shape' ? symbolB.children[2].shapeId : null)
      .toBe('shape-in-b-second-layer');
    expect(displayList.layers[1]?.children[0]?.kind === 'shape'
      ? displayList.layers[1].children[0].shapeId
      : null).toBe('second-layer-shape');
    expect(displayList.resolvedNodeCount).toBe(9);
  });

  it('fails deterministically when a referenced Graphic definition is missing', () => {
    const input: FlaDisplayListResolverInput = {
      root: {
        kind: 'scene',
        name: 'missing-symbol-scene',
        frameContext: frameContext([{
          name: 'layer',
          visible: true,
          elements: [{ kind: 'symbol', libraryItemName: 'absent-symbol', symbolType: 'graphic' }],
        }]),
      },
      symbols: new Map(),
    };

    const first = resolveFlaDisplayList(input);
    const second = resolveFlaDisplayList(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: false,
      code: 'MISSING_SYMBOL',
      message: 'Graphic symbol definition not found: absent-symbol',
      sourcePath: 'scene(missing-symbol-scene)/layer[0]:layer/element[0]',
    });
  });

  it('detects symbol cycles with a stable expansion path', () => {
    const symbolA: FlaGraphicSymbolDefinition = {
      kind: 'graphic',
      libraryItemName: 'A',
      frameContext: frameContext([{
        name: 'A-layer',
        visible: true,
        elements: [{ kind: 'symbol', libraryItemName: 'B', symbolType: 'graphic' }],
      }]),
    };
    const symbolB: FlaGraphicSymbolDefinition = {
      kind: 'graphic',
      libraryItemName: 'B',
      frameContext: frameContext([{
        name: 'B-layer',
        visible: true,
        elements: [{ kind: 'symbol', libraryItemName: 'A', symbolType: 'graphic' }],
      }]),
    };
    const input: FlaDisplayListResolverInput = {
      root: {
        kind: 'scene',
        name: 'cycle-scene',
        frameContext: frameContext([{
          name: 'layer',
          visible: true,
          elements: [{ kind: 'symbol', libraryItemName: 'A', symbolType: 'graphic' }],
        }]),
      },
      symbols: new Map([['A', symbolA], ['B', symbolB]]),
    };

    expect(resolveFlaDisplayList(input)).toMatchObject({
      ok: false,
      code: 'SYMBOL_CYCLE',
      message: 'Graphic symbol cycle: A -> B -> A',
    });
  });

  it('bounds nested group/symbol depth and resolved-node traversal', () => {
    const input = buildP0C01Fixture();
    expect(resolveFlaDisplayList(input, { maxRecursionDepth: 2 })).toMatchObject({
      ok: false,
      code: 'MAX_RECURSION_DEPTH_EXCEEDED',
    });
    expect(resolveFlaDisplayList(input, { maxResolvedNodeCount: 2 })).toMatchObject({
      ok: false,
      code: 'MAX_RESOLVED_NODES_EXCEEDED',
    });
  });

  it('returns deterministic unsupported and invalid-matrix failures', () => {
    const unsupported = resolveFlaDisplayList({
      root: {
        kind: 'scene',
        name: 'unsupported-scene',
        frameContext: frameContext([{
          name: 'layer',
          visible: true,
          elements: [{ kind: 'symbol', libraryItemName: 'movie', symbolType: 'movieclip' }],
        }]),
      },
      symbols: new Map(),
    });
    expect(unsupported).toMatchObject({ ok: false, code: 'UNSUPPORTED_SYMBOL_TYPE' });

    const invalidMatrix = resolveFlaDisplayList({
      root: {
        kind: 'scene',
        name: 'invalid-matrix-scene',
        frameContext: frameContext([{
          name: 'layer',
          visible: true,
          elements: [{ kind: 'bitmap', libraryItemName: 'invalid.png', localTransform: { ...IDENTITY, tx: Number.NaN } }],
        }]),
      },
      symbols: new Map(),
    });
    expect(invalidMatrix).toMatchObject({ ok: false, code: 'INVALID_MATRIX' });
  });
});
