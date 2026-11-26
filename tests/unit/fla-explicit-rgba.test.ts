import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { buildSvgForResolvedDisplayList } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';
import {
  evaluateFlaGraphicNodeCompositePlan,
  evaluateFlaGraphicVisual,
} from '../../src/domain/evaluate-fla-graphic';
import { FlaGraphicStructureSchema } from '../../src/domain/models/flaGraphicStructure';
import {
  applyFlaRgbaTransform,
  composeLinearFlaRgbaTransforms,
  FlaInstanceColorSchema,
  readFlaRgbaTransform,
} from '../../src/shared/fla-instance-color';

const solid = `<DOMShape><fills><FillStyle index="1"><SolidColor color="#204080" alpha="0"/></FillStyle></fills>
  <edges><Edge fillStyle0="1" edges="!0 0|400 0|400 400|0 400|0 0"/></edges></DOMShape>`;
const library = (shapes: string) => [{
  name: 'Tile.xml',
  xml: `<DOMSymbolItem name="Tile" symbolType="graphic"><timeline><DOMTimeline><layers><DOMLayer>
    <frames><DOMFrame index="0"><elements>${shapes}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`,
}];
const instance = (attrs: string, x: number) => `<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
  <matrix><Matrix tx="${x}"/></matrix><color><Color ${attrs}/></color></DOMSymbolInstance>`;

function render(instances: string, shapes = solid) {
  const adapted = adaptFlaXflDisplaySource(
    `<DOMDocument frameRate="24"><timelines><DOMTimeline><layers><DOMLayer><frames>
      <DOMFrame index="0"><elements>${instances}</elements></DOMFrame>
    </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`,
    library(shapes),
  );
  if (!adapted.ok) throw new Error(adapted.message);
  const { source } = adapted;
  const scene = source.sceneTimelines[0]!;
  const resolved = resolveFlaDisplayList({ root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext }, symbols: source.symbols });
  if (!resolved.ok) throw new Error(resolved.message);
  const svg = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList, shapeBlocks: source.shapeBlocks, renderTargetId: 'rgba-test',
    stageWidth: 320, stageHeight: 240, resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  if (!svg.ok) throw new Error(svg.message);
  return { svg, displayList: resolved.displayList };
}

describe('explicit XFL RGBA color', () => {
  it('clamps unpremultiplied channels using independent signed inputs', () => {
    const transform = readFlaRgbaTransform({ redMultiplier: '2', greenOffset: '-30', blueOffset: '150', alphaMultiplier: '.5', alphaOffset: '12' })!;
    expect(applyFlaRgbaTransform([150, 60, 200, 0], transform)).toEqual([255, 30, 255, 12]);
    expect(applyFlaRgbaTransform([2, 10, 40, 128], transform)).toEqual([4, 0, 190, 76]);
    expect(applyFlaRgbaTransform([2, 10, 40, 255], transform)).toEqual([4, 0, 190, 139.5]);
    expect(readFlaRgbaTransform({ redOffset: 'Infinity' })).toBeNull();
  });

  it('persists full 4-channel RGBA formally alongside legacy R01 schemas without double opacity (E-F03)', () => {
    // Legacy schemas remain valid
    expect(FlaInstanceColorSchema.parse({ opacity: 0.5 })).toEqual({ opacity: 0.5 });
    expect(FlaInstanceColorSchema.parse({
      opacity: 0.8,
      rgbTransform: { multiplier: 0.5, offset: 0, channelOffsets: [64, 32, 16] },
    })).toBeDefined();
    // Full 4-channel signed RGBA persists cleanly
    const full = FlaInstanceColorSchema.parse({
      rgbaTransform: { multipliers: [1.5, 0.5, 2, 0.75], offsets: [-20, 40, -100, 64] },
    });
    expect(full.rgbaTransform).toEqual({ multipliers: [1.5, 0.5, 2, 0.75], offsets: [-20, 40, -100, 64] });
    // Combining rgbaTransform with opacity or rgbTransform is rejected to prevent double-applying opacity
    expect(FlaInstanceColorSchema.safeParse({
      opacity: 0.5,
      rgbaTransform: { multipliers: [1, 1, 1, 0.5], offsets: [0, 0, 0, 0] },
    }).success).toBe(false);
  });

  it('only merges parent-child RGBA transforms when child cannot clamp any [0..255] input (E-F03)', () => {
    const linearChild = { multipliers: [0.5, 0.5, 0.5, 0.5], offsets: [20, 20, 20, 20] } as const;
    const parent = { multipliers: [1.2, 0.8, 1, 0.5], offsets: [-10, 15, 0, 10] } as const;
    const merged = composeLinearFlaRgbaTransforms(parent, linearChild)!;
    expect(merged).not.toBeNull();
    for (const sample of [[0, 0, 0, 0], [100, 150, 200, 128], [255, 255, 255, 255]] as const) {
      const sequential = applyFlaRgbaTransform(applyFlaRgbaTransform(sample, linearChild), parent);
      const combined = applyFlaRgbaTransform(sample, merged);
      expect(combined).toEqual(sequential.map((v) => expect.closeTo(v, 5)));
    }
    // Clamping child (multiplier > 1 or negative offset) MUST NOT merge blindly with parent
    const clampingChild = { multipliers: [2, 1, 1, 1], offsets: [-40, 0, 0, 0] } as const;
    expect(composeLinearFlaRgbaTransforms(parent, clampingChild)).toBeNull();
  });

  it('captures RGBA symbol occurrences as editable structure nodes sharing one Definition without opaque baking (E-F03)', () => {
    const active = render(
      instance('redMultiplier="2" greenOffset="-16" blueMultiplier="0.5" alphaOffset="102"', 10) +
      instance('redOffset="-32" blueOffset="127" alphaMultiplier="0.5" alphaOffset="-20"', 60),
    );
    const structure = captureFlaGraphicStructure(active.displayList);
    expect(structure).toBeDefined();
    // Schema round-trip (simulating Save / Reopen JSON serialization)
    const reopened = FlaGraphicStructureSchema.parse(JSON.parse(JSON.stringify(structure)));
    const nodes = reopened.frames[0]!.layers[0]!.nodes;
    expect(nodes).toHaveLength(2);
    // Both nodes stay formal editable 'symbol' nodes sharing the same nestedDefinitionId!
    expect(nodes[0]!.type).toBe('symbol');
    expect(nodes[1]!.type).toBe('symbol');
    if (nodes[0]!.type !== 'symbol' || nodes[1]!.type !== 'symbol') throw new Error('expected symbol nodes');
    expect(nodes[0]!.nestedDefinitionId).toBe(nodes[1]!.nestedDefinitionId);
    expect(nodes[0]!.rgbaTransform).toEqual({ multipliers: [2, 1, 0.5, 1], offsets: [0, -16, 0, 102] });
    expect(nodes[1]!.rgbaTransform).toEqual({ multipliers: [1, 1, 1, 0.5], offsets: [-32, 0, 127, -20] });
    // Formal evaluator preserves each instance's independent RGBA with opacity=1 (no double-multiply)
    const evaluated = evaluateFlaGraphicVisual({
      definition: {
        id: 'def-rgba',
        kind: 'fla-graphic',
        name: 'RgbaHost',
        durationMs: 1_000 / 24,
        source: {
          basename: 'rgba.fla',
          sha256: 'b'.repeat(64),
          renderTargetId: 'rt-rgba',
          targetKind: 'scene',
          targetName: 'Scene 1',
          sourceFps: 24,
          startFrameIndex: 0,
          endFrameIndex: 0,
          canvas: { width: 320, height: 240 },
          anchor: { x: 0, y: 0 },
          documentCanvas: { width: 320, height: 240 },
        },
        frames: [{
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: 'asset-0',
          sha256: 'c'.repeat(64),
          offset: { x: 0, y: 0 },
          sourceViewport: { x: 0, y: 0, width: 320, height: 240 },
          startMs: 0,
          durationMs: 1_000 / 24,
          createdBySequenceImport: false,
        }],
        structure: reopened,
      },
      frameOrdinal: 0,
      mode: 'instance',
    })!;
    const plan0 = evaluateFlaGraphicNodeCompositePlan(evaluated.layers![0]!.nodes[0]!);
    const plan1 = evaluateFlaGraphicNodeCompositePlan(evaluated.layers![0]!.nodes[1]!);
    expect(plan0.opacity).toBe(1);
    expect(plan0.rgbaTransform).toEqual({ multipliers: [2, 1, 0.5, 1], offsets: [0, -16, 0, 102] });
    expect(plan1.opacity).toBe(1);
    expect(plan1.rgbaTransform).toEqual({ multipliers: [1, 1, 1, 0.5], offsets: [-32, 0, 127, -20] });
  });

  it('keeps two source occurrences independent and clips positive alpha offset to solid fill coverage', () => {
    const active = render(instance('redMultiplier="2" greenOffset="-16" blueMultiplier="0.5" alphaOffset="102"', 10) +
      instance('redOffset="-32" blueOffset="127" alphaOffset="51"', 60));
    const [first, second] = active.displayList.layers[0]!.children;
    expect(first).toMatchObject({ symbolLibraryItemName: 'Tile', rgbaTransform: { multipliers: [2, 1, 0.5, 1], offsets: [0, -16, 0, 102] } });
    expect(second).toMatchObject({ symbolLibraryItemName: 'Tile', rgbaTransform: { offsets: [-32, 0, 127, 51] } });
    expect(active.svg.svg).toContain('fill="#403040" fill-opacity="0.4"');
    expect(active.svg.svg).toContain('fill="#0040ff" fill-opacity="0.2"');
    expect(active.svg.svg).not.toContain('feColorMatrix');
  });

  it('clamps positive alphaOffset filter region to objectBoundingBox for a sole bitmap without tinting outer canvas (E-F03)', () => {
    const png1x1 = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
      0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 2, 0, 0, 5, 0, 1, 122, 94, 171, 63,
      0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    const adapted = adaptFlaXflDisplaySource(
      `<DOMDocument frameRate="24"><timelines><DOMTimeline><layers><DOMLayer><frames>
        <DOMFrame index="0"><elements>${instance('redOffset="40" alphaOffset="102"', 10)}</elements></DOMFrame>
      </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`,
      library('<DOMBitmapInstance libraryItemName="tex.png"/>'),
    );
    if (!adapted.ok) throw new Error(adapted.message);
    const scene = adapted.source.sceneTimelines[0]!;
    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext },
      symbols: adapted.source.symbols,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const svg = buildSvgForResolvedDisplayList({
      displayList: resolved.displayList,
      shapeBlocks: adapted.source.shapeBlocks,
      renderTargetId: 'rgba-bitmap-test',
      stageWidth: 100,
      stageHeight: 100,
      resolveBitmapMedia: () => ({ ok: true, media: { id: 'tex-id', width: 1, height: 1, pngBytes: png1x1 } }),
    });
    if (!svg.ok) throw new Error(svg.message);
    expect(svg.svg).toContain('filterUnits="objectBoundingBox" x="0" y="0" width="1" height="1"');
    expect(svg.svg).toContain('0 0 0 1 0.4');
    expect(svg.projectionWarning).toBeUndefined();
  });

  it('keeps safe channels for complex artwork and diagnoses alpha coverage that cannot be determined', () => {
    const { svg } = render(instance('redMultiplier="2" alphaMultiplier=".5" alphaOffset="127"', 10), solid + solid);
    expect(svg.svg).toContain('values="2 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.5 0"');
    expect(svg.projectionWarning).toContain('Alpha offset');
  });
});
