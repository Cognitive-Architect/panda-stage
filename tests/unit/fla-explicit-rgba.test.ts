import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { buildSvgForResolvedDisplayList } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { applyFlaRgbaTransform, readFlaRgbaTransform } from '../../src/shared/fla-instance-color';

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

  it('keeps safe channels for complex artwork and diagnoses alpha coverage that cannot be determined', () => {
    const { svg } = render(instance('redMultiplier="2" alphaMultiplier=".5" alphaOffset="127"', 10), solid + solid);
    expect(svg.svg).toContain('values="2 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.5 0"');
    expect(svg.projectionWarning).toContain('Alpha offset');
  });
});
