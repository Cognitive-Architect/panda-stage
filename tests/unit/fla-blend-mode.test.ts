import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  flaBlendModeToCanvasCompositeOperation,
  flaBlendModeToSvgMixBlendMode,
  parseXflBlendMode,
} from '../../src/shared/fla-blend-mode';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';

async function buildFlaBytes(
  docXml: string,
  libraryEntries: ReadonlyArray<{ readonly name: string; readonly xml: string }> = [],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  for (const entry of libraryEntries) {
    zip.file(entry.name, entry.xml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

const solidBox = (color: string) =>
  `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills>` +
  '<edges><Edge fillStyle1="1" edges="!0 0|800 0|800 800|0 800|0 0"/></edges></DOMShape>';

const graphicSymbol = (name: string, elements: string) =>
  `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline><DOMTimeline name="${name}"><layers>` +
  `<DOMLayer name="L1"><frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames></DOMLayer>` +
  '</layers></DOMTimeline></timeline></DOMSymbolItem>';

describe('FLA Blend Modes shared mapping (S01-C / #1296)', () => {
  it('parses normal, multiply, screen, add and rejects unsupported advanced blend modes with diagnostics', () => {
    expect(parseXflBlendMode(undefined)).toEqual({ ok: true, blendMode: undefined });
    expect(parseXflBlendMode('')).toEqual({ ok: true, blendMode: undefined });
    expect(parseXflBlendMode('normal')).toEqual({ ok: true, blendMode: undefined });
    expect(parseXflBlendMode('Multiply')).toEqual({ ok: true, blendMode: 'multiply' });
    expect(parseXflBlendMode('SCREEN')).toEqual({ ok: true, blendMode: 'screen' });
    expect(parseXflBlendMode('add')).toEqual({ ok: true, blendMode: 'add' });

    expect(flaBlendModeToCanvasCompositeOperation('normal')).toBe('source-over');
    expect(flaBlendModeToCanvasCompositeOperation('multiply')).toBe('multiply');
    expect(flaBlendModeToCanvasCompositeOperation('screen')).toBe('screen');
    expect(flaBlendModeToCanvasCompositeOperation('add')).toBe('lighter');

    expect(flaBlendModeToSvgMixBlendMode('normal')).toBeNull();
    expect(flaBlendModeToSvgMixBlendMode('multiply')).toBe('multiply');
    expect(flaBlendModeToSvgMixBlendMode('screen')).toBe('screen');
    expect(flaBlendModeToSvgMixBlendMode('add')).toBe('plus-lighter');

    for (const unsupported of ['layer', 'darken', 'lighten', 'difference', 'invert', 'alpha', 'erase', 'overlay', 'hardlight', 'subtract']) {
      expect(parseXflBlendMode(unsupported)).toMatchObject({
        ok: false,
        raw: unsupported,
        reason: `Unsupported XFL blendMode "${unsupported}"`,
      });
    }
  });
});

describe('FLA Multiply / Screen / Add XFL parsing, structure capture, SVG compositing, and local degradation (S01-C / #1296)', () => {
  it.each(['classic', 'object'].flatMap((motion) =>
    [undefined, 'normal', 'multiply', 'screen', 'add', 'overlay'].map((blendMode) => ({ motion, blendMode })),
  ))('F07: imports and renders $motion Motion with $blendMode over authored artwork', async ({ motion, blendMode }) => {
    const instance = (tx: number) => '<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"' +
      `${blendMode ? ` blendMode="${blendMode}"` : ''}><matrix><Matrix tx="${tx}"/></matrix></DOMSymbolInstance>`;
    const movingFrames = motion === 'classic'
      ? `<DOMFrame index="0" duration="4" tweenType="motion" keyMode="17921"><elements>${instance(0)}</elements></DOMFrame>
        <DOMFrame index="4" keyMode="9728"><elements>${instance(40)}</elements></DOMFrame>`
      : `<DOMFrame index="0" duration="5" tweenType="motion object">
          <motionObjectXML><AnimationCore TimeScale="24000" duration="5000"><PropertyContainer id="headContainer">
            <Property id="Motion_X"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,40"/></Property>
          </PropertyContainer></AnimationCore></motionObjectXML><elements>${instance(0)}</elements>
        </DOMFrame>`;
    const host = `<DOMSymbolItem name="Host" symbolType="graphic"><timeline><DOMTimeline name="Host"><layers>
        <DOMLayer name="Moving"><frames>${movingFrames}</frames></DOMLayer>
        <DOMLayer name="Backdrop"><frames><DOMFrame index="0" duration="5"><elements>${solidBox('#336699')}</elements></DOMFrame></frames></DOMLayer>
      </layers></DOMTimeline></timeline></DOMSymbolItem>`;
    const bytes = await buildFlaBytes(`<DOMDocument width="200" height="200" frameRate="24">
      <symbols><Include href="Host.xml"/><Include href="Tile.xml"/></symbols>
      <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="Host" symbolType="graphic"/>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`,
    [{ name: 'LIBRARY/Tile.xml', xml: graphicSymbol('Tile', solidBox('#ff8800')) },
      { name: 'LIBRARY/Host.xml', xml: host }]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const target = catalog.entries.find(({ target }) => target.sourceLibraryItemName === 'Host')!.target;
    const rendered = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 2 }, undefined, prepared.source);
    if (blendMode === 'overlay') {
      expect(rendered).toMatchObject({ ok: false, message: expect.stringMatching(/blendMode|混合模式/u) });
      return;
    }
    if (!rendered.ok) throw new Error(rendered.message);
    const tx = /matrix\(1 0 0 1 ([\d.]+) 0\)" fill="#ff8800"/u.exec(rendered.svg)?.[1];
    expect(Number(tx)).toBeCloseTo(20);
    expect(rendered.svg).toContain('#336699');
    expect(rendered.svg).toContain('#ff8800');
    if (blendMode && blendMode !== 'normal') {
      expect(rendered.svg).toContain(`mix-blend-mode:${blendMode === 'add' ? 'plus-lighter' : blendMode}`);
    } else {
      expect(rendered.svg).not.toContain('mix-blend-mode:');
    }
  });

  it.each([
    { blendMode: 'multiply', svgMode: 'multiply' },
    { blendMode: 'screen', svgMode: 'screen' },
    { blendMode: 'add', svgMode: 'plus-lighter' },
  ])('preserves $blendMode across display list, captured structure, and SVG without isolating plain siblings', async ({ blendMode, svgMode }) => {
    const bgSym = graphicSymbol('BgBox', solidBox('#336699'));
    const fxSym = graphicSymbol('FxBox', solidBox('#ff8800'));
    const hostSym = graphicSymbol(
      'BlendHost',
      '<DOMSymbolInstance libraryItemName="BgBox" symbolType="graphic"/>' +
        `<DOMSymbolInstance libraryItemName="FxBox" symbolType="graphic" blendMode="${blendMode}">` +
        '<matrix><Matrix tx="10" ty="10"/></matrix>' +
        '<color><Color alphaMultiplier="0.6"/></color>' +
        '</DOMSymbolInstance>',
    );
    const docXml =
      '<DOMDocument width="200" height="200" frameRate="24">' +
      '<symbols><Include href="BgBox.xml"/><Include href="FxBox.xml"/><Include href="BlendHost.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="BlendHost" symbolType="graphic"/>' +
      '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';

    const bytes = await buildFlaBytes(docXml, [
      { name: 'LIBRARY/BgBox.xml', xml: bgSym },
      { name: 'LIBRARY/FxBox.xml', xml: fxSym },
      { name: 'LIBRARY/BlendHost.xml', xml: hostSym },
    ]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);

    const hostEntry = catalog.entries.find((e) => e.target.sourceLibraryItemName === 'BlendHost')!;
    expect(hostEntry.previewSupported).toBe(true);
    const svg = await buildSvgForRenderTarget(bytes, hostEntry.target, undefined, prepared.source);
    if (!svg.ok) throw new Error(svg.message);

    // Plain BgBox path is NOT wrapped in an unnecessary <g>, while FxBox carries opacity + mix-blend-mode.
    expect(svg.svg).toContain(`opacity="0.6" style="mix-blend-mode:${svgMode}"`);
    expect([...svg.svg.matchAll(/mix-blend-mode:/gu)]).toHaveLength(1);

    // Structure capture preserves blendMode & opacity on the nested symbol node.
    const hostDesc = prepared.source.graphicSymbols.find((s) => s.sourceLibraryItemName === 'BlendHost')!;
    const resolved = resolveFlaDisplayList({
      root: { kind: 'graphic', name: hostDesc.sourceLibraryItemName, frameContext: hostDesc.frameContext },
      symbols: prepared.source.symbols,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const structure = captureFlaGraphicStructure(resolved.displayList, {});
    const nodes = structure?.frames[0]?.layers[0]?.nodes ?? [];
    expect(nodes[0]).toMatchObject({ type: 'symbol', symbolRef: 'BgBox' });
    expect((nodes[0] as { blendMode?: string }).blendMode).toBeUndefined();
    expect(nodes[1]).toMatchObject({
      type: 'symbol',
      symbolRef: 'FxBox',
      blendMode,
      opacity: 0.6,
    });
  });

  it('preserves mask, multi-filter source order, RGB transform, opacity, and blendMode nesting without double-applying', async () => {
    const fxSym = graphicSymbol('GlowOrb', solidBox('#ffcc00'));
    const docXml =
      '<DOMDocument width="200" height="200" frameRate="24">' +
      '<symbols><Include href="GlowOrb.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="Mask" layerType="mask"><frames><DOMFrame index="0"><elements>' +
      solidBox('#000000') +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '<DOMLayer name="MaskedBlend" parentLayerIndex="0"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="GlowOrb" symbolType="graphic" blendMode="add">' +
      '<color><Color alphaMultiplier="0.5" brightness="0.25"/></color>' +
      '<filters>' +
      '<DropShadowFilter blurX="4" blurY="4" distance="6" angle="45" color="#112233" alpha="0.8" strength="1" quality="1"/>' +
      '<GlowFilter blurX="6" blurY="6" color="#ffee00" alpha="0.7" strength="1" quality="1"/>' +
      '</filters>' +
      '</DOMSymbolInstance>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';

    const bytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/GlowOrb.xml', xml: fxSym }]);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const sceneEntry = catalog.entries.find((e) => e.target.kind === 'scene')!;
    expect(sceneEntry.previewSupported).toBe(true);

    const svg = await buildSvgForRenderTarget(bytes, sceneEntry.target, undefined, prepared.source);
    if (!svg.ok) throw new Error(svg.message);
    // Nesting order: clip-path (outer) -> opacity + mix-blend-mode + instance filter -> rgb-transform (inner) -> path.
    expect(svg.svg).toMatch(
      /<g clip-path="url\(#fla-mask-clip-[a-f0-9]+\)"><g opacity="0\.5" style="mix-blend-mode:plus-lighter" filter="url\(#fla-instance-filter-[a-f0-9]+\)"><g filter="url\(#fla-rgb-transform-[a-f0-9]+\)"><path\b/u,
    );
    // Multi-filter preserves DropShadow (#112233) before Glow (#ffee00).
    const filterBody = svg.svg.match(/<filter id="fla-instance-filter-[a-f0-9]+"[^>]*>(.*?)<\/filter>/u)?.[1] ?? '';
    expect(filterBody.indexOf('#112233')).toBeGreaterThan(-1);
    expect(filterBody.indexOf('#ffee00')).toBeGreaterThan(filterBody.indexOf('#112233'));
  });

  it('degrades unsupported advanced blend modes locally with visible diagnostics while keeping healthy symbols usable', async () => {
    const healthySym = graphicSymbol('HealthyPart', solidBox('#16a34a'));
    const childSym = graphicSymbol('OverlayPart', solidBox('#e11d48'));

    for (const badBlend of ['subtract', 'overlay', 'difference', 'layer', 'alpha', 'erase']) {
      const docXml =
        '<DOMDocument width="200" height="200" frameRate="24">' +
        '<symbols><Include href="HealthyPart.xml"/><Include href="OverlayPart.xml"/></symbols>' +
        '<timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
        solidBox('#cccccc') +
        `<DOMSymbolInstance libraryItemName="OverlayPart" symbolType="graphic" blendMode="${badBlend}"/>` +
        '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>';

      const bytes = await buildFlaBytes(docXml, [
        { name: 'LIBRARY/HealthyPart.xml', xml: healthySym },
        { name: 'LIBRARY/OverlayPart.xml', xml: childSym },
      ]);
      const catalog = await buildRenderableTargetCatalog(bytes);
      if (!catalog.ok) throw new Error(catalog.message);
      expect(catalog.entries.find((e) => e.target.kind === 'scene')).toMatchObject({
        previewSupported: false,
        unsupportedReason: expect.stringContaining(`Unsupported XFL blendMode "${badBlend}"`),
      });
      expect(catalog.entries.find((e) => e.target.sourceLibraryItemName === 'HealthyPart')).toMatchObject({
        previewSupported: true,
      });
    }
  });
});
