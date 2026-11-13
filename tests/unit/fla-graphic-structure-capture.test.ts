import { describe, expect, it } from 'vitest';
import {
  FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES,
  FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH,
  reconstructFlaGraphicStructure,
} from '../../src/domain';
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

  it('captures bounded mask paths with transforms localized to the clipped parent', () => {
    const masked = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: 'MaskedGraphic',
        frameContext: {
          frameIndex: 0,
          layers: [
            layer('content', [{
              kind: 'group',
              groupId: 'body',
              sourceAddress: 'LIB/MaskedGraphic/group[0]',
              localTransform: m(10, 0),
              elements: [{
                kind: 'bitmap',
                libraryItemName: 'arm.png',
                sourceAddress: 'LIB/MaskedGraphic/arm[0]',
                localTransform: m(4, 0),
              }],
            }], { maskedBy: 'mask-1' }),
            layer('mask', [{
              kind: 'shape',
              shapeId: 'mask-shape',
              sourceAddress: 'LIB/MaskedGraphic/mask-shape[0]',
              localTransform: m(8, 0),
            }], { maskLayerId: 'mask-1' }),
          ],
        },
      },
      symbols: new Map(),
    });
    if (!masked.ok) throw new Error(masked.message);

    const structure = captureFlaGraphicStructure(masked.displayList, {
      clipPathShapePathData: new Map([[
        'mask-shape',
        ['M0 0L10 0L10 10Z'],
      ]]),
    });
    const flat = reconstructFlaGraphicStructure(structure!);
    const bitmap = flat.find((entry) => entry.node.type === 'bitmap')?.node;
    expect(bitmap?.clipPaths?.[0]?.shapes[0]).toMatchObject({
      shapeId: 'mask-shape',
      worldTransform: m(8, 0),
      parentLocalTransform: m(-2, 0),
      pathData: ['M0 0L10 0L10 10Z'],
    });
  });

  it('degrades only clipped nodes whose mask paths exceed the aggregate capture budget', () => {
    const maskPath = 'M0 0L1 1'.repeat(FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH / 8);
    const maskCount = Math.floor(
      FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES / FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH,
    ) + 1;
    const layers: FlaDisplayListLayer[] = [];
    const clipPathShapePathData = new Map<string, readonly string[]>();

    for (let index = 0; index < maskCount; index += 1) {
      const maskId = `mask-${index}`;
      const shapeId = `mask-shape-${index}`;
      layers.push(layer(`content-${index}`, [{
        kind: 'bitmap',
        libraryItemName: `bitmap-${index}`,
        localTransform: m(0, 0),
      }], { maskedBy: maskId }));
      layers.push(layer(`mask-${index}`, [{
        kind: 'shape',
        shapeId,
        localTransform: m(0, 0),
      }], { maskLayerId: maskId }));
      clipPathShapePathData.set(shapeId, [maskPath]);
    }

    const masked = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: 'MaskBudgetGraphic',
        frameContext: { frameIndex: 0, layers },
      },
      symbols: new Map(),
    });
    if (!masked.ok) throw new Error(masked.message);

    const structure = captureFlaGraphicStructure(masked.displayList, { clipPathShapePathData });
    expect(structure).toBeDefined();
    const bitmaps = reconstructFlaGraphicStructure(structure!)
      .filter((entry) => entry.node.type === 'bitmap')
      .map((entry) => entry.node);
    expect(bitmaps).toHaveLength(maskCount);
    expect(bitmaps.slice(0, maskCount - 1).every((node) => (
      node.type === 'bitmap' && node.clipPaths?.[0]?.shapes[0]?.pathData?.[0]?.length ===
        FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH
    ))).toBe(true);
    expect(bitmaps[maskCount - 1]?.clipPaths?.[0]?.shapes[0]?.pathData).toBeUndefined();
  });

  it('captures playbackMode and frameSelectionKey on symbol nodes, and fallback/assetId metadata', () => {
    const legFrame = {
      frameIndex: 0,
      layers: [
        layer('leg-layer', [
          { kind: 'bitmap', libraryItemName: 'leg.png', sourceAddress: 'LIB/Leg/bitmap[0]', localTransform: m(0, 0) },
        ]),
      ],
    };

    const resolvedTolerant = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: 'TolerantChar',
        frameContext: {
          frameIndex: 0,
          layers: [
            layer('main', [
              {
                kind: 'symbol',
                libraryItemName: 'Leg',
                symbolType: 'graphic',
                sourceAddress: 'LIB/TolerantChar/leg[0]',
                localTransform: m(5, 5),
                playbackMode: 'single-frame',
                firstFrame: '3',
                lastFrame: '3',
                synchronizedFirstFrame: 3,
                frameSelectionKey: 'key_sym_3',
              },
              {
                kind: 'symbol',
                libraryItemName: 'MissingOrUnsupported',
                symbolType: 'movieclip',
                sourceAddress: 'LIB/TolerantChar/clip[0]',
                localTransform: m(10, 10),
              },
            ]),
          ],
        },
      },
      symbols: new Map([['key_sym_3', { kind: 'graphic' as const, libraryItemName: 'Leg', frameContext: legFrame }]]),
    }, { tolerant: true });

    if (!resolvedTolerant.ok) throw new Error(resolvedTolerant.message);

    const structure = captureFlaGraphicStructure(resolvedTolerant.displayList, {
      fallbackAssetId: 'fallback-asset-uuid',
      fallbackViewBox: { x: 0, y: 0, width: 200, height: 150 },
      sourceBasename: 'char.fla',
      bitmapAssetMap: new Map([['leg.png', 'leg-asset-uuid']]),
    })!;

    expect(structure).toBeDefined();
    const flat = reconstructFlaGraphicStructure(structure);

    // Find symbol node
    const symbolNode = flat.find((e) => e.node.type === 'symbol');
    expect(symbolNode).toBeDefined();
    if (symbolNode && symbolNode.node.type === 'symbol') {
      expect(symbolNode.node.playbackMode).toBe('single-frame');
      expect(symbolNode.node.firstFrame).toBe('3');
      expect(symbolNode.node.lastFrame).toBe('3');
      expect(symbolNode.node.synchronizedFirstFrame).toBe(3);
      expect(symbolNode.node.frameSelectionKey).toBe('key_sym_3');
    }

    // Find bitmap node
    const bitmapNode = flat.find((e) => e.node.type === 'bitmap');
    expect(bitmapNode).toBeDefined();
    if (bitmapNode && bitmapNode.node.type === 'bitmap') {
      expect(bitmapNode.node.assetId).toBe('leg-asset-uuid');
      expect(bitmapNode.node.sourceBasename).toBe('char.fla');
    }

    // Find opaque node (from movieclip)
    const opaqueNode = flat.find((e) => e.node.type === 'opaque');
    expect(opaqueNode).toBeDefined();
    if (opaqueNode && opaqueNode.node.type === 'opaque') {
      expect(opaqueNode.node.opaqueKind).toBe('symbol');
      expect(opaqueNode.node.reason).toContain('movieclip');
      expect(opaqueNode.node.fallbackAssetId).toBe('fallback-asset-uuid');
      expect(opaqueNode.node.fallbackViewBox).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    }
  });

  it('assigns verified subtree bounds to supported shapes, and keeps unsafe opaque nodes without fake bounds', () => {
    const resolved = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: 'BoundsTest',
        frameContext: {
          frameIndex: 0,
          layers: [
            layer('main', [
              { kind: 'shape', shapeId: 'shape-with-bounds', localTransform: m(0, 0) },
              { kind: 'symbol', libraryItemName: 'unsafe-clip', symbolType: 'movieclip' },
            ]),
          ],
        },
      },
      symbols: new Map(),
    }, { tolerant: true });

    if (!resolved.ok) throw new Error(resolved.message);

    const structure = captureFlaGraphicStructure(resolved.displayList, {
      fallbackAssetId: 'frame-svg-asset-id',
      resolveSubtreeBounds: (node) => {
        if (node.kind === 'shape' && node.shapeId === 'shape-with-bounds') {
          return {
            scope: 'frame-crop',
            viewBox: { x: 10, y: 15, width: 40, height: 60 },
          };
        }
        return undefined;
      },
    })!;

    expect(structure).toBeDefined();
    const flat = reconstructFlaGraphicStructure(structure);
    const shapeNode = flat.find((e) => e.node.type === 'opaque' && e.node.sourceRef === 'shape-with-bounds');
    expect(shapeNode).toBeDefined();
    if (shapeNode && shapeNode.node.type === 'opaque') {
      expect(shapeNode.node.fallbackScope).toBe('frame-crop');
      expect(shapeNode.node.fallbackViewBox).toEqual({ x: 10, y: 15, width: 40, height: 60 });
      expect(shapeNode.node.fallbackAssetId).toBe('frame-svg-asset-id');
    }

    const unsafeNode = flat.find((e) => e.node.type === 'opaque' && e.node.opaqueKind === 'symbol');
    expect(unsafeNode).toBeDefined();
    if (unsafeNode && unsafeNode.node.type === 'opaque') {
      expect(unsafeNode.node.fallbackScope).toBeUndefined();
      expect(unsafeNode.node.fallbackViewBox).toBeUndefined();
      expect(unsafeNode.node.fallbackAssetId).toBeUndefined();
      expect(unsafeNode.node.reason).toContain('movieclip');
    }
  });
});
