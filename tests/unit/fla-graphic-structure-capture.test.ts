import { describe, expect, it } from 'vitest';
import { reconstructFlaGraphicStructure } from '../../src/domain';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';
import {
  resolveFlaDisplayList,
  type FlaDisplayListLayer,
} from '../../src/main/services/fla-display-list-resolver';

const m = (tx: number, ty: number, s = 1) => ({ a: s, b: 0, c: 0, d: s, tx, ty });

function layer(name: string, elements: FlaDisplayListLayer['elements'], extra: Partial<FlaDisplayListLayer> = {}): FlaDisplayListLayer {
  return { name, visible: true, elements, ...extra };
}

describe('captureFlaGraphicStructure', () => {
  const armFrame = { frameIndex: 0, layers: [layer('arm', [
    { kind: 'bitmap', libraryItemName: 'arm.png', sourceAddress: 'LIB/Arm/bitmap[0]', localTransform: m(1, 1) },
  ])] };
  const resolved = resolveFlaDisplayList({
    root: {
      kind: 'graphic',
      name: 'Walk',
      frameContext: {
        frameIndex: 0,
        layers: [
          layer('body', [{
            kind: 'group', groupId: 'outer', sourceAddress: 'LIB/Walk/group[0]', localTransform: m(10, 5, 2),
            elements: [
              { kind: 'symbol', libraryItemName: 'Arm', symbolType: 'graphic', sourceAddress: 'LIB/Walk/sym[0]', localTransform: m(3, 0) },
              { kind: 'symbol', libraryItemName: 'Arm', symbolType: 'graphic', sourceAddress: 'LIB/Walk/sym[1]', localTransform: m(-3, 0) },
              { kind: 'shape', shapeId: 's1', sourceAddress: 'LIB/Walk/shape[0]', localTransform: m(0, 0) },
            ],
          }]),
          layer('blurred', [{ kind: 'shape', shapeId: 's2', localTransform: m(0, 0) }], {
            frameFilter: { kind: 'blur', blurX: 2, blurY: 2, quality: 'low', enabled: true },
          }),
        ],
      },
    },
    symbols: new Map([['Arm', { kind: 'graphic' as const, libraryItemName: 'Arm', frameContext: armFrame }]]),
  });

  it('keeps nested Group/Symbol/Bitmap/opaque nodes with shared refs and local matrices', () => {
    if (!resolved.ok) throw new Error(resolved.message);
    const structure = captureFlaGraphicStructure(resolved.displayList);
    expect(structure).toBeDefined();
    const flat = reconstructFlaGraphicStructure(structure!);
    expect(flat.map((entry) => entry.node.type)).toEqual(['group', 'symbol', 'bitmap', 'symbol', 'bitmap', 'opaque', 'opaque']);
    const symbols = flat.filter((entry) => entry.node.type === 'symbol');
    expect(symbols.every((entry) => entry.node.type === 'symbol' && entry.node.symbolRef === 'Arm')).toBe(true);
    expect(new Set(flat.map((entry) => entry.node.id)).size).toBe(flat.length);
    // The bitmap under the first Arm: world = group(10,5,×2) · sym(3,0) · bitmap(1,1) = (18, 7).
    expect(flat[2]!.worldTransform).toMatchObject({ a: 2, tx: 18, ty: 7 });
    expect(flat[2]!.node.localTransform).toMatchObject({ a: 1, tx: 1, ty: 1 });
  });

  it('degrades only the filtered layer to opaque nodes', () => {
    if (!resolved.ok) throw new Error(resolved.message);
    const structure = captureFlaGraphicStructure(resolved.displayList)!;
    const [body, blurred] = structure.frames[0]!.layers;
    expect(body!.nodes[0]!.type).toBe('group');
    expect(blurred!.nodes[0]).toMatchObject({ type: 'opaque', opaqueKind: 'filter' });
  });
});
