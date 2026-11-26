import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { buildRenderableTargetCatalog, buildSvgForRenderTarget, buildSvgForResolvedDisplayList } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { planFlaScale9Slices, readFlaScale9Grid } from '../../src/shared/fla-scale9';

const bounds = { left: -20, top: -18, right: 100, bottom: 62 };
const grid = { left: -5, top: -10, right: 70, bottom: 48 };

describe('static XFL Scale9Grid', () => {
  it.each([[1, 0], [2, 9], [-2, 9]])(
    'scales the finished shape under its parent at local scale %s',
    (scaleX, sliceCount) => {
      const tile = '<DOMSymbolItem name="Tile" symbolType="graphic" scalingGrid="true" scalingGridRect="200 200 1800 1800">' +
        '<timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>' +
        '<DOMShape><fills><FillStyle index="1"><SolidColor color="#123456"/></FillStyle></fills>' +
        '<edges><Edge fillStyle0="1" edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape>' +
        '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';
      const doc = `<DOMDocument width="640" height="480" frameRate="24"><timelines><DOMTimeline name="Scene 1">
        <layers><DOMLayer><frames><DOMFrame index="0"><elements><DOMGroup>
          <matrix><Matrix a="2" d="2" tx="12" ty="24"/></matrix>
          <members><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
            <matrix><Matrix a="${scaleX * 2}" d="2" tx="512" ty="24"/></matrix>
          </DOMSymbolInstance></members>
        </DOMGroup></elements></DOMFrame></frames></DOMLayer></layers>
        </DOMTimeline></timelines></DOMDocument>`;
      const adapted = adaptFlaXflDisplaySource(doc, [{ name: 'Tile.xml', xml: tile }]);
      if (!adapted.ok) throw new Error(adapted.message);
      const scene = adapted.source.sceneTimelines[0]!;
      const resolved = resolveFlaDisplayList({
        root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext }, symbols: adapted.source.symbols,
      });
      if (!resolved.ok) throw new Error(resolved.message);
      const rendered = buildSvgForResolvedDisplayList({
        displayList: resolved.displayList, shapeBlocks: adapted.source.shapeBlocks, renderTargetId: 'parent-scale',
        stageWidth: 640, stageHeight: 480, resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
      });
      if (!rendered.ok) throw new Error(rendered.message);
      expect(rendered.svg.match(/overflow="hidden"/gu) ?? []).toHaveLength(sliceCount);
      if (sliceCount) expect(rendered.svg).toContain('width="20" height="20"');
      else expect(rendered.svg).toContain('matrix(2 0 0 2 512 24)');
      expect(rendered.projectionWarning).toBeUndefined();
    },
  );

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

  it.each(['LinearGradient', 'RadialGradient'] as const)(
    'separates 9-slice geometry from %s fill mapping without per-slice viewBox gradient distortion (E-F02)',
    async (gradientTag) => {
      const zip = new JSZip();
      const fillXml = gradientTag === 'LinearGradient'
        ? `<LinearGradient spreadMethod="pad"><matrix><Matrix a="0.0732421875" d="0.048828125" tx="40" ty="22"/></matrix>
            <GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/></LinearGradient>`
        : `<RadialGradient spreadMethod="pad" focalPointRatio="0.25"><matrix><Matrix a="0.05" d="0.05" tx="40" ty="22"/></matrix>
            <GradientEntry color="#00ff00" ratio="0"/><GradientEntry color="#000080" ratio="1"/></RadialGradient>`;
      const shape = `<DOMShape><fills><FillStyle index="1">${fillXml}</FillStyle></fills>
        <edges><Edge fillStyle0="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>`;
      zip.file('LIBRARY/GradTile.xml', `<DOMSymbolItem name="GradTile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100 -200 1400 960">
        <timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>${shape}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
      zip.file('DOMDocument.xml', `<DOMDocument width="400" height="300" frameRate="24"><symbols><Include href="GradTile.xml"/></symbols>
        <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>
          <DOMSymbolInstance libraryItemName="GradTile" symbolType="graphic"><matrix><Matrix a="2" d="1.5" tx="60" ty="40"/></matrix></DOMSymbolInstance>
        </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
      const bytes = await zip.generateAsync({ type: 'uint8array' });
      const catalog = await buildRenderableTargetCatalog(bytes);
      if (!catalog.ok) throw new Error(catalog.message);
      const scene = catalog.entries.find(({ target }) => target.kind === 'scene')!.target;
      const rendered = await buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 });
      if (!rendered.ok) throw new Error(rendered.message);
      // Gradient must NOT use nested <svg preserveAspectRatio="none"> which kinks the gradient per zone.
      expect(rendered.svg).not.toContain('preserveAspectRatio="none"');
      // Geometry is still clipped into 9 target slice rects with fixed corners (15x8 and 30x14).
      expect(rendered.svg.match(/id="fla-s9-clip-/gu)).toHaveLength(9);
      expect(rendered.svg).toContain('width="15" height="8"');
      expect(rendered.svg).toContain('width="30" height="14"');
      // One continuous stage-space gradient definition (-s9-) covers all 9 slices.
      const gradTagName = gradientTag === 'LinearGradient' ? 'linearGradient' : 'radialGradient';
      expect(rendered.svg.match(new RegExp(`<${gradTagName} id="fla-[^"]+-s9-`, 'gu'))).toHaveLength(1);
      expect(rendered.projectionWarning).toBeUndefined();
    },
  );

  it('diagnoses skewed and unsupported text/stroke Scale9Grid locally while keeping healthy solid siblings intact (E-F02)', async () => {
    const zip = new JSZip();
    const solidShape = `<DOMShape><fills><FillStyle index="1"><SolidColor color="#2244aa"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>`;
    const strokedShape = `<DOMShape><fills><FillStyle index="1"><SolidColor color="#aa4422"/></FillStyle></fills>
      <strokes><StrokeStyle index="1"><SolidStroke weight="2"><fill><SolidColor color="#000000"/></fill></SolidStroke></StrokeStyle></strokes>
      <edges><Edge fillStyle0="1" strokeStyle="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>`;
    zip.file('LIBRARY/SolidTile.xml', `<DOMSymbolItem name="SolidTile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100 -200 1400 960">
      <timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>${solidShape}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
    zip.file('LIBRARY/StrokedTile.xml', `<DOMSymbolItem name="StrokedTile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100 -200 1400 960">
      <timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>${strokedShape}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
    zip.file('DOMDocument.xml', `<DOMDocument width="500" height="300" frameRate="24">
      <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="SolidTile" symbolType="graphic"><matrix><Matrix a="2" d="1.5" tx="50" ty="50"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="SolidTile" symbolType="graphic"><matrix><Matrix a="2" b="0.4" c="0" d="1.5" tx="260" ty="50"/></matrix></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="StrokedTile" symbolType="graphic"><matrix><Matrix a="2" d="1.5" tx="50" ty="180"/></matrix></DOMSymbolInstance>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error(catalog.message);
    const scene = catalog.entries.find(({ target }) => target.kind === 'scene')!.target;
    const rendered = await buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 });
    if (!rendered.ok) throw new Error(rendered.message);
    // Healthy solid Scale9Grid sibling still emits 9 slices; skewed & stroked siblings fall back cleanly with diagnostics.
    expect(rendered.svg.match(/preserveAspectRatio="none" overflow="hidden"/gu)).toHaveLength(9);
    expect(rendered.svg).toContain('#aa4422');
    expect(rendered.projectionWarning).toContain('skewed transform');
    expect(rendered.projectionWarning).toContain('stroke');
  });

  it('composes Scale9Grid with RGBA, Glow filter, Mask and Multiply blend once each (E-F02)', async () => {
    const zip = new JSZip();
    const solidShape = `<DOMShape><fills><FillStyle index="1"><SolidColor color="#204080"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!-400 -360|2000 -360|2000 1240|-400 1240|-400 -360"/></edges></DOMShape>`;
    const maskShape = `<DOMShape><fills><FillStyle index="1"><SolidColor color="#ffffff"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!0 0|6000 0|6000 4000|0 4000|0 0"/></edges></DOMShape>`;
    zip.file('LIBRARY/CardTile.xml', `<DOMSymbolItem name="CardTile" symbolType="graphic" scalingGrid="true" scalingGridRect="-100 -200 1400 960">
      <timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>${solidShape}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
    zip.file('DOMDocument.xml', `<DOMDocument width="400" height="300" frameRate="24">
      <timelines><DOMTimeline name="Scene 1"><layers>
        <DOMLayer name="Mask" layerType="mask"><frames><DOMFrame index="0"><elements>${maskShape}</elements></DOMFrame></frames></DOMLayer>
        <DOMLayer name="Masked" layerType="masked" parentLayerIndex="0"><frames><DOMFrame index="0"><elements>
          <DOMSymbolInstance libraryItemName="CardTile" symbolType="graphic" blendMode="multiply">
            <matrix><Matrix a="2" d="1.5" tx="80" ty="60"/></matrix>
            <color><Color redMultiplier="1.5" greenOffset="16" alphaMultiplier="0.5"/></color>
            <filters><GlowFilter blurX="4" blurY="4" color="#00ff88" alpha="1" strength="1" inner="true"/></filters>
          </DOMSymbolInstance>
        </elements></DOMFrame></frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error(catalog.message);
    const scene = catalog.entries.find(({ target }) => target.kind === 'scene')!.target;
    const rendered = await buildSvgForRenderTarget(bytes, { ...scene, selectedFrameIndex: 0 });
    if (!rendered.ok) throw new Error(rendered.message);
    expect(rendered.svg.match(/preserveAspectRatio="none" overflow="hidden"/gu)).toHaveLength(9);
    expect(rendered.svg.match(/mix-blend-mode:multiply/gu)).toHaveLength(1);
    expect(rendered.svg.match(/clip-path="url\(#fla-mask-clip-/gu)).toHaveLength(1);
    expect(rendered.svg.match(/id="fla-rgba-transform-/gu)).toHaveLength(1);
    expect(rendered.svg.match(/id="fla-instance-filter-/gu)).toHaveLength(1);
  });
});
import JSZip from 'jszip';
