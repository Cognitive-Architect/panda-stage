import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { buildRenderableTargetCatalog, buildSvgForRenderTarget, buildSvgForResolvedDisplayList } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { planFlaScale9Slices, readFlaScale9Grid } from '../../src/shared/fla-scale9';

const bounds = { left: -20, top: -18, right: 100, bottom: 62 };
const grid = { left: -5, top: -10, right: 70, bottom: 48 };

describe('static XFL Scale9Grid', () => {
  it('mirrors the current drawable frame while a rotated occurrence falls back to ordinary scaling', async () => {
    const zip = new JSZip();
    const shape = (color: string) => `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>`;
    zip.file('LIBRARY/Tile.xml', `<DOMSymbolItem name="Tile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100 -200 1400 960">
      <timeline><DOMTimeline><layers><DOMLayer><frames>
        <DOMFrame index="0"><elements>${shape('#ff0000')}</elements></DOMFrame>
        <DOMFrame index="1"><elements>${shape('#0000ff')}</elements></DOMFrame>
      </frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
    zip.file('DOMDocument.xml', `<DOMDocument width="400" height="300" frameRate="24"><symbols><Include href="Tile.xml"/></symbols>
      <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"/>
      </elements></DOMFrame><DOMFrame index="1"><elements>
        <DOMSymbolInstance libraryItemName="Tile" symbolType="graphic" loop="single frame" firstFrame="1">
          <matrix><Matrix a="-2" d="1.5" tx="220" ty="130"/></matrix>
        </DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="Tile" symbolType="graphic" loop="single frame" firstFrame="1">
          <matrix><Matrix a="0" b="2" c="-2" d="0" tx="320" ty="220"/></matrix>
        </DOMSymbolInstance>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error(catalog.message);
    const scene = catalog.entries.find(({ target }) => target.kind === 'scene')!.target;
    const rendered = await buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 1 });
    if (!rendered.ok) throw new Error(rendered.message);
    expect(rendered.svg.match(/overflow="hidden"/gu)).toHaveLength(9);
    expect(rendered.svg).toContain('width="15" height="8"');
    expect(rendered.svg).toContain('width="30" height="14"');
    expect(rendered.svg).toContain('fill="#0000ff"');
    expect(rendered.svg).not.toContain('fill="#ff0000"');
  });

  it('binds a twip grid to the referenced static symbol definition and occurrence', () => {
    const xml = `<DOMDocument frameRate="24"><timelines><DOMTimeline><layers><DOMLayer><frames>
      <DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"><matrix><Matrix a="2" d="1.5" tx="40"/></matrix></DOMSymbolInstance>
      </elements></DOMFrame>
    </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const result = adaptFlaXflDisplaySource(xml, [{
      name: 'Tile.xml',
      xml: `<DOMSymbolItem name="Tile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100    -200 1400 960">
        <timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>
          <DOMShape><fills><FillStyle index="1"><SolidColor color="#123456"/></FillStyle></fills>
          <edges><Edge fillStyle0="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>
        </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline>
      </DOMSymbolItem>`,
    }]);
    if (!result.ok) throw new Error(result.message);
    const { source } = result;
    expect(source.symbols.get('Tile')?.scale9Grid).toEqual(grid);
    const scene = source.sceneTimelines[0]!;
    const resolved = resolveFlaDisplayList({ root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext }, symbols: source.symbols });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.displayList.layers[0]?.children[0]).toMatchObject({
      kind: 'group', scale9Grid: grid, worldTransform: { a: 2, d: 1.5, tx: 40 },
    });
    const resultSvg = buildSvgForResolvedDisplayList({
      displayList: resolved.displayList, shapeBlocks: source.shapeBlocks, renderTargetId: 'scale9-tiles',
      stageWidth: 320, stageHeight: 240, resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
    });
    expect(resultSvg.ok).toBe(true);
    if (!resultSvg.ok) throw new Error(resultSvg.message);
    expect(resultSvg.svg.match(/preserveAspectRatio="none" overflow="hidden"/gu)).toHaveLength(9);
    expect(resultSvg.svg).toContain('width="15" height="8"');
    expect(resultSvg.svg).toContain('width="30" height="14"');
    expect(readFlaScale9Grid({ scalingGrid: 'true', scalingGridRect: '0 0 0 0' })).toBeUndefined();
    expect(readFlaScale9Grid({ scalingGrid: 'true', scalingGridRect: '0 0 Infinity 80' })).toBeUndefined();
  });

  it('keeps asymmetric margins fixed, neighboring edges continuous and registration stationary', () => {
    const slices = planFlaScale9Slices(bounds, grid, 2, 1.5)!;
    expect(slices).toHaveLength(9);
    const first = slices[0]!.target;
    const last = slices[8]!.target;
    expect(first.right - first.left).toBeCloseTo(15);
    expect(first.bottom - first.top).toBeCloseTo(8);
    expect(last.right - last.left).toBeCloseTo(30);
    expect(last.bottom - last.top).toBeCloseTo(14);
    expect(last.right - first.left).toBeCloseTo(240);
    expect(last.bottom - first.top).toBeCloseTo(120);
    expect(first.right).toBe(slices[1]!.target.left);
    expect(first.bottom).toBe(slices[3]!.target.top);
    const center = slices[4]!.target;
    expect(center.left + (center.right - center.left) * 5 / 75).toBeCloseTo(0);
    expect(center.top + (center.bottom - center.top) * 10 / 58).toBeCloseTo(0);
    expect(planFlaScale9Slices(bounds, grid, 1, 1)?.every((slice) =>
      JSON.stringify(slice.target) === JSON.stringify(slice.source))).toBe(true);
  });

  it('fits undersized margins without making the center negative', () => {
    const slices = planFlaScale9Slices(bounds, grid, 0.1, 0.1)!;
    const center = slices[4]!.target;
    expect(center.right - center.left).toBeCloseTo(0);
    expect(center.bottom - center.top).toBeCloseTo(0);
    expect(slices[8]!.target.right - slices[0]!.target.left).toBeCloseTo(12);
    expect(slices[8]!.target.bottom - slices[0]!.target.top).toBeCloseTo(8);
    expect(planFlaScale9Slices(bounds, grid, -1, 1)).toBeNull();
    expect(planFlaScale9Slices(bounds, { ...grid, left: -25 }, 1, 1)).toBeNull();
  });
});
import JSZip from 'jszip';
