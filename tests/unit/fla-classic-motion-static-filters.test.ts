import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const TILE_SHAPE =
  '<DOMShape><fills><FillStyle index="1"><SolidColor color="#336699"/></FillStyle></fills>' +
  '<edges><Edge fillStyle0="1" edges="!0 0|400 0|400 400|0 400|0 0"/></edges></DOMShape>';

function symbolItemXml(name: string, framesXml: string): string {
  return `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline><DOMTimeline name="${name}"><layers>` +
    `<DOMLayer name="Layer 1"><frames>${framesXml}</frames></DOMLayer>` +
    `</layers></DOMTimeline></timeline></DOMSymbolItem>`;
}

async function buildClassicMotionFla(options: {
  readonly startFilters?: string;
  readonly endFilters?: string;
  readonly startColor?: string;
  readonly endColor?: string;
  readonly startMatrix?: string;
  readonly endMatrix?: string;
}): Promise<Uint8Array> {
  const startMatrix = options.startMatrix ?? 'a="1" b="0" c="0" d="1" tx="10" ty="20"';
  const endMatrix = options.endMatrix ?? 'a="0" b="2" c="-2" d="0" tx="90" ty="60"';
  const framesXml =
    `<DOMFrame index="0" duration="4" tweenType="motion" keyMode="22017"><elements>` +
    `<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">` +
    `<matrix><Matrix ${startMatrix}/></matrix>` +
    (options.startColor ? `<color><Color ${options.startColor}/></color>` : '') +
    (options.startFilters ? `<filters>${options.startFilters}</filters>` : '') +
    `</DOMSymbolInstance></elements></DOMFrame>` +
    `<DOMFrame index="4" duration="1" keyMode="9728"><elements>` +
    `<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">` +
    `<matrix><Matrix ${endMatrix}/></matrix>` +
    (options.endColor ? `<color><Color ${options.endColor}/></color>` : '') +
    (options.endFilters ? `<filters>${options.endFilters}</filters>` : '') +
    `</DOMSymbolInstance></elements></DOMFrame>`;

  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="300" height="200" frameRate="24"/>');
  zip.file('LIBRARY/Tile.xml', symbolItemXml('Tile', `<DOMFrame index="0"><elements>${TILE_SHAPE}</elements></DOMFrame>`));
  zip.file('LIBRARY/MotionRoot.xml', symbolItemXml('MotionRoot', framesXml));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Classic Motion static instance filter preservation (S01-A)', () => {
  it('keeps inner knockout Glow and an explicit AIR color matrix in authored order', async () => {
    const filters = '<GlowFilter inner="true" knockout="true" blurX="6" blurY="8"/>' +
      '<AdjustColorFilter matrix="1 0 0 0 51 0 0.5 0 0 0 0 0 1 0 -51 0 0 0 1 0"/>';
    const bytes = await buildClassicMotionFla({ startFilters: filters, endFilters: filters });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const target = catalog.entries.find((entry) => entry.target.sourceLibraryItemName === 'MotionRoot')!.target;
    const rendered = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 2 }, undefined, prepared.source);
    if (!rendered.ok) throw new Error(rendered.message);
    expect(rendered.svg).toContain('slope="-1" intercept="1"');
    expect(rendered.svg).toContain('in="blur0" in2="SourceGraphic" operator="in" result="silhouette0"');
    expect(rendered.svg).not.toContain('<feMerge result="effect0">');
    expect(rendered.svg).toContain('<feColorMatrix in="effect0" type="matrix" values="1 0 0 0 0.2 0 0.5 0 0 0 0 0 1 0 -0.2 0 0 0 1 0" result="effect1"/>');
  });

  it('preserves static Blur, Glow, and DropShadow filters in order across start, mid, and end frames during move/rotate/scale and color tween', async () => {
    const filters =
      '<BlurFilter blurX="4" blurY="6"/>' +
      '<GlowFilter isEnabled="false" blurX="9" blurY="9"/>' +
      '<GlowFilter blurX="8" blurY="8" color="#00FF88" alpha="0.75" strength="1.5"/>' +
      '<DropShadowFilter blurX="6" blurY="6" distance="10" angle="0" color="#112233" alpha="0.5" strength="1.2"/>';
    const bytes = await buildClassicMotionFla({
      startFilters: filters,
      endFilters: filters,
      startColor: 'alphaMultiplier="0.4" brightness="0"',
      endColor: 'alphaMultiplier="1" brightness="0.5"',
    });

    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const { source } = prepared;
    const motionRoot = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === 'MotionRoot');
    if (!motionRoot) throw new Error('Missing MotionRoot graphic symbol');

    const expectedFilters = [
      { kind: 'blur', enabled: true, blurX: 4, blurY: 6 },
      { kind: 'glow', enabled: false },
      { kind: 'glow', enabled: true, blurX: 8, blurY: 8, color: '#00FF88', alpha: 0.75, strength: 1.5 },
      { kind: 'dropShadow', enabled: true, blurX: 6, blurY: 6, distance: 10, angle: 0, color: '#112233', alpha: 0.5, strength: 1.2 },
    ];

    for (const [frameIndex, expectedTx, expectedTy, expectedAlpha] of [
      [0, 10, 20, 0.4],
      [2, 50, 40, 0.7],
      [4, 90, 60, undefined],
    ] as const) {
      const ctx = source.buildGraphicFrameContext(
        motionRoot.timelineXml,
        motionRoot.frameSpanIndex,
        frameIndex,
        `motion-root:${frameIndex}`,
      );
      if (!ctx.ok) throw new Error(ctx.message);
      const element = ctx.value.layers[0]?.elements[0];
      if (element?.kind !== 'symbol' || !element.localTransform) throw new Error(`Missing symbol at frame ${frameIndex}`);
      expect(element.localTransform.tx).toBeCloseTo(expectedTx, 5);
      expect(element.localTransform.ty).toBeCloseTo(expectedTy, 5);
      if (expectedAlpha === undefined) {
        expect(element.alphaMultiplier).toBeUndefined();
      } else {
        expect(element.alphaMultiplier).toBeCloseTo(expectedAlpha, 5);
      }
      expect(element.instanceFilters).toMatchObject(expectedFilters);
      if (frameIndex === 2) {
        // Midpoint of 0° -> 90° rotation and scale 1 -> 2 is 45° and scale 1.5.
        expect(Math.hypot(element.localTransform.a, element.localTransform.b)).toBeCloseTo(1.5, 5);
        expect(Math.atan2(element.localTransform.b, element.localTransform.a) * 180 / Math.PI).toBeCloseTo(45, 5);
        expect(element.rgbTransform?.multiplier).toBeCloseTo(0.75, 5);
        expect(element.rgbTransform?.offset).toBeCloseTo(63.75, 5);
      }
    }

    // Formal catalog + SVG render consumes all 3 enabled filters in original order without collapsing shadows
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, source);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find((candidate) => candidate.target.sourceLibraryItemName === 'MotionRoot');
    expect(entry).toMatchObject({ previewSupported: true, target: { frameCount: 5 } });

    for (const frameIndex of [0, 2, 4]) {
      const svg = await buildSvgForRenderTarget(bytes, { ...entry!.target, selectedFrameIndex: frameIndex }, undefined, source);
      if (!svg.ok) throw new Error(svg.message);
      expect(svg.hasRenderablePath).toBe(true);
      expect(svg.svg).toContain('result="effect0"');
      expect(svg.svg).not.toContain('result="effect1"');
      expect(svg.svg).toContain('result="effect2"');
      expect(svg.svg).toContain('result="effect3"');
      expect([...svg.svg.matchAll(/<feMerge\b/gu)]).toHaveLength(2);
    }
  });

  it('keeps no-filter Classic Motion behavior unchanged', async () => {
    const bytes = await buildClassicMotionFla({});
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const motionRoot = prepared.source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === 'MotionRoot')!;
    const mid = prepared.source.buildGraphicFrameContext(motionRoot.timelineXml, motionRoot.frameSpanIndex, 2, 'no-filter:2');
    if (!mid.ok) throw new Error(mid.message);
    const element = mid.value.layers[0]?.elements[0];
    if (element?.kind !== 'symbol') throw new Error('Missing symbol');
    expect(element.instanceFilters).toBeUndefined();
    expect(element.localTransform?.tx).toBeCloseTo(50, 5);
  });

  it.each([
    ['changing blurX value', '<BlurFilter blurX="4" blurY="4"/>', '<BlurFilter blurX="12" blurY="4"/>'],
    ['changing filter order', '<BlurFilter blurX="4" blurY="4"/><GlowFilter blurX="6" blurY="6"/>', '<GlowFilter blurX="6" blurY="6"/><BlurFilter blurX="4" blurY="4"/>'],
    ['filter on start endpoint only', '<DropShadowFilter distance="6"/>', ''],
    ['changing enabled state', '<DropShadowFilter isEnabled="true" distance="6"/>', '<DropShadowFilter isEnabled="false" distance="6"/>'],
    ['unsupported BevelFilter', '<BevelFilter blurX="4" blurY="4"/>', '<BevelFilter blurX="4" blurY="4"/>'],
    ['invalid inner GlowFilter flag', '<GlowFilter inner="unknown"/>', '<GlowFilter inner="unknown"/>'],
  ])('rejects unsupported Classic Motion filter combinations without arbitrary interpolation: %s', async (_label, startFilters, endFilters) => {
    const bytes = await buildClassicMotionFla({ startFilters, endFilters });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const motionRoot = prepared.source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === 'MotionRoot')!;
    const mid = prepared.source.buildGraphicFrameContext(motionRoot.timelineXml, motionRoot.frameSpanIndex, 2, 'rejected:2');
    expect(mid.ok).toBe(false);
    // Unaffected Tile symbol remains previewable in catalog
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    expect(catalog.entries.find((entry) => entry.target.sourceLibraryItemName === 'Tile')).toMatchObject({ previewSupported: true });
  });
});
