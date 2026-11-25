import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { evaluateFlaObjectMotion, parseFlaObjectMotion } from '../../src/main/services/fla-object-motion';
import { getFlaXflDirectChildren } from '../../src/main/services/fla-static-snapshot-display-list-adapter';

const fixture = new URL('../fixtures/fla-object-motion/OM-2D.fla', import.meta.url);

describe('Animate Object Motion', () => {
  it('evaluates Wave counts, sample clamping, and eased endpoint holds from XFL TimeMaps', () => {
    const times = [0, 0.25, 0.5, 0.75, 1, 1.25];
    const sample = (type: string, strength: string, ratios = times) => {
      const xml = `<DOMFrame><motionObjectXML><AnimationCore TimeScale="100000" duration="150000">
        <TimeMap type="${type}" strength="${strength}"/>
        <PropertyContainer id="headContainer">
          <Property id="Motion_X"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="100000" anchor="0,100"/></Property>
        </PropertyContainer>
      </AnimationCore></motionObjectXML></DOMFrame>`;
      const parsed = parseFlaObjectMotion({ name: 'DOMFrame', attributes: {}, xml }, getFlaXflDirectChildren);
      if (!parsed.ok) return null;
      return ratios.map((ratio) => {
        const evaluated = evaluateFlaObjectMotion(parsed.value, ratio, 1, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, { x: 0, y: 0 });
        if (!evaluated.ok) throw new Error(evaluated.message);
        return evaluated.value.matrix.tx;
      });
    };
    const approx = (values: number[]) => values.map((value) => expect.closeTo(value, 5));
    const linear = [0, 25, 50, 75, 100, 100];
    expect(sample('SineWave', '2')).toEqual(approx([0, 50, 100, 50, 0, 0]));
    expect(sample('SineWave', '1')).toEqual(approx([0, 50 - 25 * Math.SQRT2, 50, 50 + 25 * Math.SQRT2, 100, 100]));
    expect(sample('SawtoothWave', '2.9')).toEqual(approx([0, 50, 100, 50, 0, 0]));
    expect(sample('SquareWave', '2', [0, 0.25, 0.5, 0.5001, 0.75, 1, 1.25])).toEqual([0, 0, 0, 100, 100, 0, 0]);
    expect(sample('DampedWave', '2')).toEqual(approx([0, 50 * Math.exp(-0.5), 0, 50 * Math.exp(-1.5), 0, 0]));
    for (const strength of ['-100', '-2.5', '0', '0.9']) {
      for (const type of ['SineWave', 'SawtoothWave', 'DampedWave']) {
        expect(sample(type, strength)).toEqual(approx(linear));
      }
      expect(sample('SquareWave', strength)).toEqual([0, 0, 0, 100, 0, 0]);
    }
    expect(sample('SawtoothWave', '100', [0.01, 0.02, 1])).toEqual(approx([100, 0, 0]));
    expect(sample('SineWave', '100', [0.01, 0.02, 1])).toEqual(approx([100, 0, 0]));
    expect(sample('DampedWave', '100', [0.005, 0.01, 1])).toEqual(approx([50 * Math.exp(-0.5), 0, 0]));
    expect(sample('SquareWave', '100', [0.01, 0.011, 1])).toEqual([0, 100, 0]);
    for (const type of ['SineWave', 'SawtoothWave', 'SquareWave', 'DampedWave']) {
      for (const strength of ['NaN', 'Infinity', '101', '-101']) expect(sample(type, strength)).toBeNull();
    }
    for (const type of ['RandomSquareWave', 'Custom', 'Unknown']) expect(sample(type, '2')).toBeNull();
  });

  it.each([
    ['Quadratic', '-100', [5, 8.75, 20, 20, 8.75]],
    ['SineWave', '2', [5, 20, 5, 5, 20]],
  ] as const)('matches %s shadow curves by authored order and holds the eased end on seek', (type, strength, distances) => {
    const source = adaptFlaXflDisplaySource(`<DOMDocument frameRate="24"><timelines><DOMTimeline><layers>
      <DOMLayer><frames><DOMFrame index="0" duration="6" tweenType="motion object">
        <motionObjectXML><AnimationCore TimeScale="24000" duration="6000">
          <TimeMap type="${type}" strength="${strength}"/>
          <PropertyContainer id="headContainer"><Property id="Motion_X" value="3"/>
            <PropertyContainer id="Filters">
              <PropertyContainer><Property id="DropShadow_Quality" value="3"/><Property id="DropShadow_Distance" value="9"/></PropertyContainer>
              <PropertyContainer id="DropShadow_Filter">
                <Property id="DropShadow_Distance"><Keyframe timevalue="0" anchor="0,5"/><Keyframe timevalue="4000" anchor="0,20"/></Property>
                <Property enabled="1" id="DropShadow_BlurX" ignoreTimeMap="0"><Keyframe anchor="0,6" next="0,6" previous="0,6" timevalue="0"/></Property>
                <Property enabled="1" id="DropShadow_BlurY" value="0"/>
                <Property enabled="1" id="DropShadow_Strength" value="60"/>
                <Property enabled="1" id="DropShadow_Quality" value="1"/>
                <Property enabled="1" id="DropShadow_Angle" value="0"/>
                <Property enabled="1" id="DropShadow_InnerShadow" value="0"/>
                <Property enabled="1" id="DropShadow_Color"><Keyframe timevalue="0" value="0x123456ff"/></Property>
              </PropertyContainer>
            </PropertyContainer>
          </PropertyContainer>
        </AnimationCore></motionObjectXML>
        <elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
          <filters><DropShadowFilter isEnabled="false" enabled="true"/><GlowFilter blurX="0" strength="0"/>
            <DropShadowFilter isEnabled="1" blurX="5" blurY="0" angle="0" color="#123456"/></filters>
        </DOMSymbolInstance></elements>
      </DOMFrame></frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`, []);
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    for (const [index, frame] of [0, 2, 4, 5, 2].entries()) {
      const distance = distances[index]!;
      const sampled = source.source.buildSceneFrameContext(scene.xml, frame, 'scene:0');
      if (!sampled.ok) throw new Error(sampled.message);
      expect(sampled.value.unsupportedDisplayReason).toBeUndefined();
      const element = sampled.value.layers[0]?.elements[0];
      if (element?.kind !== 'symbol') throw new Error('Missing sampled symbol');
      expect(element.localTransform?.tx).toBeCloseTo(3);
      expect(element.instanceFilters).toMatchObject([
        { kind: 'dropShadow', enabled: false, distance: 0 },
        { kind: 'glow', blurX: 0, strength: 0 },
        { kind: 'dropShadow', enabled: true, color: '#123456', alpha: 1, strength: 0.6, blurX: 6, blurY: 0 },
      ]);
      expect(element.instanceFilters?.[2]?.distance).toBeCloseTo(distance!);
    }
  });

  it.each([
    '<Keyframe timevalue="2000" anchor="0,2"/>',
    '<Keyframe timevalue="2000" anchor="0,1" previous="-500,3" next="500,1"/>',
  ])('diagnoses a non-constant discrete companion despite equal endpoints', (middle) => {
    const xml = `<DOMFrame><motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
      <PropertyContainer id="Filters"><PropertyContainer id="DropShadow_Filter">
        <Property id="DropShadow_Distance" value="5"/>
        <Property id="DropShadow_Quality"><Keyframe timevalue="0" anchor="0,1"/>${middle}
          <Keyframe timevalue="4000" anchor="0,1"/></Property>
      </PropertyContainer></PropertyContainer>
      </AnimationCore></motionObjectXML></DOMFrame>`;
    expect(parseFlaObjectMotion({ name: 'DOMFrame', xml, attributes: {} }, getFlaXflDirectChildren))
      .toMatchObject({ ok: false, message: expect.stringContaining('DropShadow_Quality') });
  });

  it('evaluates multi-parameter Blur, Glow, and DropShadow curves with duplicate/disabled slots, 0-degree angle, RGBA alpha/255, and ordered SVG output', async () => {
    const shape = '<DOMShape><fills><FillStyle index="1"><SolidColor color="#406080"/></FillStyle></fills>' +
      '<edges><Edge fillStyle0="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>';
    const tileXml = `<DOMSymbolItem name="Tile" symbolType="graphic"><timeline><DOMTimeline><layers>` +
      `<DOMLayer><frames><DOMFrame index="0"><elements>${shape}</elements></DOMFrame></frames></DOMLayer>` +
      `</layers></DOMTimeline></timeline></DOMSymbolItem>`;
    const docXml = `<DOMDocument width="200" height="200" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers>
      <DOMLayer><frames><DOMFrame index="0" duration="5" tweenType="motion object">
        <motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
          <PropertyContainer id="headContainer">
            <Property id="Motion_X"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,40"/></Property>
            <PropertyContainer id="Filters">
              <PropertyContainer id="Glow_Filter">
                <Property id="Glow_Quality" value="3"/>
                <Property id="Glow_Strength" value="200"/>
              </PropertyContainer>
              <PropertyContainer id="Blur_Filter">
                <Property id="Blur_BlurX"><Keyframe timevalue="0" anchor="0,2"/><Keyframe timevalue="4000" anchor="0,10"/></Property>
                <Property id="Blur_Quality" value="1"/>
              </PropertyContainer>
              <PropertyContainer id="DropShadow_Filter">
                <Property id="DropShadow_Angle"><Keyframe timevalue="0" anchor="0,90"/><Keyframe timevalue="4000" anchor="0,0"/></Property>
                <Property id="DropShadow_Strength"><Keyframe timevalue="0" anchor="0,40"/><Keyframe timevalue="4000" anchor="0,120"/></Property>
                <Property id="DropShadow_Color"><Keyframe timevalue="0" value="0x00408040"/><Keyframe timevalue="4000" value="0xfe8000ff"/></Property>
              </PropertyContainer>
              <PropertyContainer id="Glow_Filter">
                <Property id="Glow_BlurX"><Keyframe timevalue="0" anchor="0,4"/><Keyframe timevalue="4000" anchor="0,12"/></Property>
                <Property id="Glow_BlurY" value="8"/>
                <Property id="Glow_Strength"><Keyframe timevalue="0" anchor="0,50"/><Keyframe timevalue="4000" anchor="0,150"/></Property>
                <Property id="Glow_Color"><Keyframe timevalue="0" value="0x20406080"/><Keyframe timevalue="4000" value="0x6080a0ff"/></Property>
                <Property id="Glow_InnerGlow" value="0"/>
                <Property id="Glow_Knockout" value="0"/>
              </PropertyContainer>
              <PropertyContainer id="DropShadow_Filter">
                <Property id="DropShadow_Distance"><Keyframe timevalue="0" anchor="0,4"/><Keyframe timevalue="4000" anchor="0,16"/></Property>
                <Property id="DropShadow_BlurY"><Keyframe timevalue="0" anchor="0,2"/><Keyframe timevalue="4000" anchor="0,14"/></Property>
                <Property id="DropShadow_Angle" value="0"/>
              </PropertyContainer>
            </PropertyContainer>
          </PropertyContainer>
        </AnimationCore></motionObjectXML>
        <elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
          <matrix><Matrix tx="20" ty="30"/></matrix>
          <filters>
            <GlowFilter isEnabled="false" blurX="9" blurY="9" color="#111111"/>
            <BlurFilter blurX="2" blurY="7"/>
            <DropShadowFilter blurX="6" blurY="4" distance="11" angle="90" color="#004080" alpha="0.25" strength="0.4"/>
            <GlowFilter blurX="4" blurY="8" color="#204060" alpha="0.5" strength="0.5"/>
            <DropShadowFilter blurX="3" blurY="2" distance="4" angle="45" color="#abcdef" alpha="0.75" strength="0.8"/>
          </filters>
        </DOMSymbolInstance></elements>
      </DOMFrame></frames></DOMLayer>
    </layers></DOMTimeline></timelines></DOMDocument>`;

    const zip = new JSZip();
    zip.file('DOMDocument.xml', docXml);
    zip.file('LIBRARY/Tile.xml', tileXml);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const { source } = prepared;
    const scene = source.sceneTimelines[0]!;

    const mid = source.buildSceneFrameContext(scene.xml, 2, 'scene:0');
    if (!mid.ok) throw new Error(mid.message);
    expect(mid.value.unsupportedDisplayReason).toBeUndefined();
    const midEl = mid.value.layers[0]?.elements[0];
    if (midEl?.kind !== 'symbol') throw new Error('Missing mid symbol');
    expect(midEl.localTransform?.tx).toBeCloseTo(40, 5);
    expect(midEl.instanceFilters).toHaveLength(5);
    // Slot 0: disabled Glow preserved
    expect(midEl.instanceFilters?.[0]).toMatchObject({ kind: 'glow', enabled: false });
    // Slot 1: Blur animates blurX (2 -> 10 => 6), preserves unanimated blurY=7
    expect(midEl.instanceFilters?.[1]).toMatchObject({
      kind: 'blur', enabled: true, blurX: expect.closeTo(6, 5), blurY: 7,
    });
    // Slot 2: DropShadow #1 animates angle (90 -> 0 => 45), strength (0.4 -> 1.2 => 0.8), RGBA color, preserves blurX=6, blurY=4, distance=11
    expect(midEl.instanceFilters?.[2]).toMatchObject({
      kind: 'dropShadow', enabled: true, blurX: 6, blurY: 4, distance: 11, color: '#7f6040',
    });
    expect(midEl.instanceFilters?.[2]?.angle).toBeCloseTo(45, 5);
    expect(midEl.instanceFilters?.[2]?.strength).toBeCloseTo(0.8, 5);
    expect(midEl.instanceFilters?.[2]?.alpha).toBeCloseTo((0x40 + 0xff) / 2 / 255, 5);
    // Slot 3: Glow #2 animates blurX (4 -> 12 => 8), constant blurY=8, strength (0.5 -> 1.5 => 1.0), RGBA color
    expect(midEl.instanceFilters?.[3]).toMatchObject({
      kind: 'glow', enabled: true, blurX: expect.closeTo(8, 5), blurY: 8, color: '#406080',
    });
    expect(midEl.instanceFilters?.[3]?.strength).toBeCloseTo(1, 5);
    expect(midEl.instanceFilters?.[3]?.alpha).toBeCloseTo((0x80 + 0xff) / 2 / 255, 5);
    // Slot 4: DropShadow #2 animates distance (4 -> 16 => 10), blurY (2 -> 14 => 8), constant angle=0 (preserved!), preserves authored blurX=3, color=#abcdef, alpha=0.75, strength=0.8
    expect(midEl.instanceFilters?.[4]).toMatchObject({
      kind: 'dropShadow',
      enabled: true,
      blurX: 3,
      blurY: expect.closeTo(8, 5),
      distance: expect.closeTo(10, 5),
      angle: 0,
      color: '#abcdef',
      alpha: 0.75,
      strength: 0.8,
    });

    // End frame (4): DropShadow #1 reaches 0-degree angle explicitly (not defaulted to 45)
    const end = source.buildSceneFrameContext(scene.xml, 4, 'scene:0');
    if (!end.ok) throw new Error(end.message);
    const endEl = end.value.layers[0]?.elements[0];
    if (endEl?.kind !== 'symbol') throw new Error('Missing end symbol');
    expect(endEl.instanceFilters?.[2]).toMatchObject({
      kind: 'dropShadow', enabled: true, angle: 0, color: '#fe8000', alpha: 1,
    });
    expect(endEl.instanceFilters?.[2]?.strength).toBeCloseTo(1.2, 5);

    // Formal SVG render consumes all 4 enabled filters in original order (indices 1, 2, 3, 4) without collapsing shadows
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, source);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find(({ target }) => target.kind === 'scene');
    expect(entry).toMatchObject({ previewSupported: true });
    const svg = await buildSvgForRenderTarget(bytes, { ...entry!.target, selectedFrameIndex: 2 }, undefined, source);
    if (!svg.ok) throw new Error(svg.message);
    expect(svg.svg).toContain('result="effect1"');
    expect(svg.svg).toContain('in="effect1"');
    expect(svg.svg).toContain('result="effect2"');
    expect(svg.svg).toContain('in="effect2"');
    expect(svg.svg).toContain('result="effect3"');
    expect(svg.svg).toContain('in="effect3"');
    expect(svg.svg).toContain('result="effect4"');
    expect(svg.svg).not.toContain('result="effect0"');
    expect([...svg.svg.matchAll(/<feMerge\b/gu)]).toHaveLength(3);
  });

  it.each([
    ['unsupported filter kind', '<PropertyContainer id="Bevel_Filter"><Property id="Bevel_BlurX" value="4"/></PropertyContainer>', '<BlurFilter/>'],
    ['non-neutral Glow_InnerGlow', '<PropertyContainer id="Glow_Filter"><Property id="Glow_InnerGlow" value="1"/></PropertyContainer>', '<GlowFilter/>'],
    ['non-neutral Blur_Quality', '<PropertyContainer id="Blur_Filter"><Property id="Blur_Quality" value="2"/></PropertyContainer>', '<BlurFilter/>'],
    ['out-of-range BlurX curve', '<PropertyContainer id="Blur_Filter"><Property id="Blur_BlurX"><Keyframe timevalue="0" anchor="0,5"/><Keyframe timevalue="4000" anchor="0,300"/></Property></PropertyContainer>', '<BlurFilter/>'],
    ['unmatched authored filter', '<PropertyContainer id="Glow_Filter"><Property id="Glow_BlurX" value="8"/></PropertyContainer>', '<BlurFilter/>'],
  ])('degrades locally for unsupported Object Motion filter combination: %s', async (_label, filterCurveXml, authoredFilterXml) => {
    const shape = '<DOMShape><fills><FillStyle index="1"><SolidColor color="#406080"/></FillStyle></fills>' +
      '<edges><Edge fillStyle0="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>';
    const zip = new JSZip();
    zip.file('LIBRARY/Tile.xml', `<DOMSymbolItem name="Tile" symbolType="graphic"><timeline><DOMTimeline><layers>` +
      `<DOMLayer><frames><DOMFrame index="0"><elements>${shape}</elements></DOMFrame></frames></DOMLayer>` +
      `</layers></DOMTimeline></timeline></DOMSymbolItem>`);
    zip.file('DOMDocument.xml', `<DOMDocument width="200" height="200" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers>` +
      `<DOMLayer><frames><DOMFrame index="0" duration="5" tweenType="motion object">` +
      `<motionObjectXML><AnimationCore TimeScale="24000" duration="5000"><PropertyContainer id="headContainer">` +
      `<Property id="Motion_X" value="5"/><PropertyContainer id="Filters">${filterCurveXml}</PropertyContainer>` +
      `</PropertyContainer></AnimationCore></motionObjectXML>` +
      `<elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"><filters>${authoredFilterXml}</filters></DOMSymbolInstance></elements>` +
      `</DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const scene = prepared.source.sceneTimelines[0]!;
    const sampled = prepared.source.buildSceneFrameContext(scene.xml, 2, 'scene:0');
    if (!sampled.ok) throw new Error(sampled.message);
    expect(sampled.value.unsupportedDisplayReason).toBeTruthy();
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    expect(catalog.entries.some(({ target, previewSupported }) => target.kind === 'scene' && previewSupported)).toBe(false);
    expect(catalog.entries.some(({ target, previewSupported }) => target.kind === 'graphic-symbol' && previewSupported)).toBe(true);
  });

  it('discovers a scene with a blank lead-in and samples its authored axes and off-centre pivot', async () => {
    const bytes = await readFile(fixture);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'catalog');
    if (!prepared.ok) throw new Error(prepared.message);
    const { source } = prepared;
    const scene = source.sceneTimelines[0]!;
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, source);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find(({ target }) => target.kind === 'scene');
    if (entry?.unsupportedReason) throw new Error(entry.unsupportedReason);
    expect(entry).toMatchObject({ previewSupported: true, target: { frameCount: 16, selectedFrameIndex: 4 } });
    expect(scene.frameContext.layers[0]?.elements).toEqual([]);

    function sample(index: number) {
      const frame = source.buildSceneFrameContext(scene.xml, index, 'scene:0');
      if (!frame.ok) throw new Error(frame.message);
      expect(frame.value.unsupportedDisplayReason).toBeUndefined();
      const symbol = frame.value.layers[0]?.elements[0];
      if (symbol?.kind !== 'symbol' || !symbol.localTransform) throw new Error('Missing sampled symbol');
      return { matrix: symbol.localTransform, alpha: symbol.alphaMultiplier };
    }
    const start = sample(4);
    const mid = sample(9);
    const end = sample(15);
    expect(start).toMatchObject({ matrix: { a: 1, b: 0, d: 1, tx: 92, ty: 74 }, alpha: 1 });
    function pivot({ matrix: m }: ReturnType<typeof sample>) {
      return [m.a * 11.2 + m.c * 27 + m.tx, m.b * 11.2 + m.d * 27 + m.ty] as const;
    }
    expect(pivot(start)).toEqual([103.2, 101]);
    expect(pivot(mid)[0] - pivot(start)[0]).toBeLessThan(20);
    expect(pivot(mid)[1] - pivot(start)[1]).toBeCloseTo(40, 4);
    expect(pivot(end)[0]).toBeCloseTo(257.2, 4);
    expect(pivot(end)[1]).toBeCloseTo(189, 4);
    expect(Math.hypot(end.matrix.a, end.matrix.b)).toBeCloseTo(1.45, 5);
    expect(Math.hypot(end.matrix.c, end.matrix.d)).toBeCloseTo(0.8, 5);
    expect(Math.atan2(end.matrix.b, end.matrix.a) * 180 / Math.PI).toBeCloseTo(65, 5);
    expect(Math.atan2(-end.matrix.c, end.matrix.d) * 180 / Math.PI).toBeCloseTo(82, 5);
    expect(mid.alpha).toBeCloseTo(100 / 100 - 0.5 * 5 / 11, 5);
    expect(end.alpha).toBe(0.5);
    expect(sample(9)).toEqual(mid);
    const svg = await buildSvgForRenderTarget(bytes, { ...entry!.target, selectedFrameIndex: 15 }, undefined, source);
    expect(svg).toMatchObject({ ok: true, hasRenderablePath: true });
    if (svg.ok) expect(svg.svg).toContain('opacity="0.5"');
  });

  it('diagnoses unsupported easing locally and retains unaffected library candidates', async () => {
    const original = await JSZip.loadAsync(await readFile(fixture));
    const doc = (await original.file('DOMDocument.xml')!.async('string'))
      .replace('type="Quadratic"', 'type="Custom"');
    original.file('DOMDocument.xml', doc);
    const catalog = await buildRenderableTargetCatalog(await original.generateAsync({ type: 'uint8array' }));
    if (!catalog.ok) throw new Error(catalog.message);
    expect(catalog.entries.find(({ target }) => target.kind === 'scene')).toMatchObject({
      previewSupported: false,
      unsupportedReason: expect.stringContaining('缓动'),
    });
    expect(catalog.entries.some(({ target, previewSupported }) => target.kind === 'graphic-symbol' && previewSupported)).toBe(true);
  });

  it('uses source time, applies easing and preserves an unanimated authored transform', () => {
    const instance = '<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"><matrix><Matrix a="2" d="3" tx="40"/></matrix></DOMSymbolInstance>';
    const motion = '<motionObjectXML><AnimationCore TimeScale="6000" duration="5000"><TimeMap strength="-100" type="Quadratic"/>' +
      '<PropertyContainer id="headContainer"><Property id="Motion_X">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,80" timevalue="4000"/>' +
      '</Property><Property id="Brightness_Amount" ignoreTimeMap="1">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,50" timevalue="4000"/>' +
      '</Property></PropertyContainer></AnimationCore></motionObjectXML>';
    const source = adaptFlaXflDisplaySource('<DOMDocument frameRate="12"><timelines><DOMTimeline>' +
      '<layers><DOMLayer><frames><DOMFrame index="2" duration="5" tweenType="motion object">' +
      motion + '<elements>' + instance + '</elements></DOMFrame></frames></DOMLayer></layers>' +
      '</DOMTimeline></timelines></DOMDocument>', []);
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    const sampled = source.source.buildSceneFrameContext(scene.xml, 4, 'scene:0');
    if (!sampled.ok) throw new Error(sampled.message);
    const symbol = sampled.value.layers[0]?.elements[0];
    expect(symbol).toMatchObject({ kind: 'symbol', localTransform: { a: 2, d: 3 } });
    if (symbol?.kind !== 'symbol') throw new Error('Missing sampled symbol');
    expect(symbol.localTransform?.tx).toBeCloseTo(45, 5);
    expect(symbol.rgbTransform?.multiplier).toBeCloseTo(0.875, 5);
    expect(symbol.rgbTransform?.offset).toBeCloseTo(31.875, 5);
  });

  it('composes a moving parent once and carries tint in three independent channels', () => {
    function layer(name: string, rig: string, parent: string, x: number, movement: number, color = '') {
      return `<DOMLayer name="${name}" ${rig}><frames>
        <DOMFrame index="0" duration="5" tweenType="motion object" ${parent}>
          <motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
            <PropertyContainer id="headContainer">
              <Property id="Motion_X"><Keyframe anchor="0,0" timevalue="0"/>
                <Keyframe anchor="0,${movement}" timevalue="4000"/></Property>${color}
            </PropertyContainer>
          </AnimationCore></motionObjectXML>
          <elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
            <matrix><Matrix tx="${x}"/></matrix>
          </DOMSymbolInstance></elements>
        </DOMFrame>
      </frames></DOMLayer>`;
    }
    const child = layer('Child', '', 'parentLayerIndex="7"', 100, 40,
      '<Property id="Tint_Amount" value="50"/><Property id="Tint_Color" value="0x804020ff"/>');
    const parent = layer('Parent', 'layerRiggingIndex="7"', '', 10, 20);
    const source = adaptFlaXflDisplaySource(`<DOMDocument frameRate="24"><timelines><DOMTimeline><layers>
      ${child}${parent}</layers></DOMTimeline></timelines></DOMDocument>`, []);
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    const sampled = source.source.buildSceneFrameContext(scene.xml, 4, 'scene:0');
    if (!sampled.ok) throw new Error(sampled.message);
    expect(sampled.value.layers.find((candidate) => candidate.name === 'Child')?.elements[0]).toMatchObject({
      kind: 'symbol',
      localTransform: { tx: 160, ty: 0 },
      rgbTransform: { multiplier: 0.5, offset: 0, channelOffsets: [64, 32, 16] },
    });
  });

  it.each([false, true])('animates Tint Amount with authored or explicit RGB (explicit=%s)', async (explicit) => {
    const zip = await JSZip.loadAsync(await readFile(fixture));
    const doc = await zip.file('DOMDocument.xml')!.async('string');
    const changed = doc.replace('<Color/>', '<Color tintColor="#C06030" tintMultiplier="0"/>');
    const tint = '<Property id="Tint_Amount" ignoreTimeMap="1">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,100" timevalue="11000"/></Property>' +
      (explicit ? '<Property id="Tint_Color" value="0x2070e0ff"/>' : '');
    const withTint = changed.replace(/<PropertyContainer\b[^>]*>/u, '$&' + tint);
    expect(withTint).toContain('Tint_Amount');
    zip.file('DOMDocument.xml', withTint);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const scene = prepared.source.sceneTimelines[0]!;
    const expected = explicit ? [32,112,224] : [192,96,48];
    for (const ordinal of [4,9,15]) {
      const result = prepared.source.buildSceneFrameContext(scene.xml, ordinal, 'scene:0');
      if (!result.ok) throw new Error(result.message);
      const symbol = result.value.layers[0]?.elements[0];
      if (symbol?.kind !== 'symbol' || !symbol.rgbTransform) throw new Error(result.value.unsupportedDisplayReason ?? 'Missing Tint');
      const amount = 1 - symbol.rgbTransform.multiplier;
      expect(amount).toBeCloseTo((ordinal - 4) / 11, 5);
      expect(symbol.rgbTransform.channelOffsets).toEqual(expected.map((channel) => expect.closeTo(channel * amount, 5)));
    }
  });

  it('evaluates Bounce, BounceIn, and Spring presets with positive, negative, zero, and bounded strength semantics', () => {
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const zeroPivot = { x: 0, y: 0 };

    function samplePreset(type: string, strength: string, ratios: readonly number[]): number[] {
      const xml = `<DOMFrame index="0" duration="200" tweenType="motion object"><motionObjectXML>` +
        `<AnimationCore TimeScale="100000" duration="100000">` +
        `<TimeMap strength="${strength}" type="${type}"/>` +
        `<PropertyContainer id="headContainer"><Property id="Motion_X">` +
        `<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,100" timevalue="100000"/>` +
        `</Property></PropertyContainer></AnimationCore></motionObjectXML></DOMFrame>`;
      const parsed = parseFlaObjectMotion({ name: 'DOMFrame', attributes: {}, xml }, getFlaXflDirectChildren);
      if (!parsed.ok) throw new Error(parsed.message);
      return ratios.map((ratio) => {
        const res = evaluateFlaObjectMotion(parsed.value, ratio, 1, identity, zeroPivot);
        if (!res.ok) throw new Error(res.message);
        return res.value.matrix.tx;
      });
    }

    // Bounce (+3): 3 decaying arcs returning to 0; peaks at 3/11 (100), 7.5/11 (100*e^-1), 10/11 (100*e^-2), valleys at 6/11, 9/11, 1.
    const bouncePos = samplePreset('Bounce', '3', [0, 3 / 11, 6 / 11, 7.5 / 11, 9 / 11, 10 / 11, 1]);
    expect(bouncePos[0]).toBeCloseTo(0, 5);
    expect(bouncePos[1]).toBeCloseTo(100, 5);
    expect(bouncePos[2]).toBeCloseTo(0, 5);
    expect(bouncePos[3]).toBeCloseTo(100 * Math.exp(-1), 4);
    expect(bouncePos[4]).toBeCloseTo(0, 5);
    expect(bouncePos[5]).toBeCloseTo(100 * Math.exp(-2), 4);
    expect(bouncePos[6]).toBeCloseTo(0, 5);

    // Bounce (-3): time-mirrored decaying arcs (small arc first, tallest arc last).
    const bounceNeg = samplePreset('Bounce', '-3', [0, 1 / 11, 3.5 / 11, 8 / 11, 1]);
    expect(bounceNeg[0]).toBeCloseTo(0, 5);
    expect(bounceNeg[1]).toBeCloseTo(100 * Math.exp(-2), 4);
    expect(bounceNeg[2]).toBeCloseTo(100 * Math.exp(-1), 4);
    expect(bounceNeg[3]).toBeCloseTo(100, 5);
    expect(bounceNeg[4]).toBeCloseTo(0, 5);

    // BounceIn (+3): quadratic fall to 100 over [0, 6/11], then damped rebounds from 100.
    const bounceInPos = samplePreset('BounceIn', '3', [0, 3 / 11, 6 / 11, 7.5 / 11, 9 / 11, 10 / 11, 1]);
    expect(bounceInPos[0]).toBeCloseTo(0, 5);
    expect(bounceInPos[1]).toBeCloseTo(25, 5);
    expect(bounceInPos[2]).toBeCloseTo(100, 5);
    expect(bounceInPos[3]).toBeCloseTo(100 * (1 - Math.exp(-1)), 4);
    expect(bounceInPos[4]).toBeCloseTo(100, 5);
    expect(bounceInPos[5]).toBeCloseTo(100 * (1 - Math.exp(-2)), 4);
    expect(bounceInPos[6]).toBeCloseTo(100, 5);

    // BounceIn (-3): 1 - bounceIn(3, 1 - r) -> small rebounds near 0, accelerating to 100 at end.
    const bounceInNeg = samplePreset('BounceIn', '-3', [0, 1 / 11, 3.5 / 11, 8 / 11, 1]);
    expect(bounceInNeg[0]).toBeCloseTo(0, 5);
    expect(bounceInNeg[1]).toBeCloseTo(100 * Math.exp(-2), 4);
    expect(bounceInNeg[2]).toBeCloseTo(100 * Math.exp(-1), 4);
    expect(bounceInNeg[3]).toBeCloseTo(75, 5);
    expect(bounceInNeg[4]).toBeCloseTo(100, 5);

    // Spring (3): quarter-sine startup to 100 at 0.4/3, then damped cosine settling toward 70, ending at 70 + 30*e^-3.
    const startup = 0.4 / 3;
    const cycle = (1 - startup) / 3;
    const springPos = samplePreset('Spring', '3', [0, startup / 2, startup, startup + cycle / 2, startup + cycle, 1]);
    expect(springPos[0]).toBeCloseTo(0, 5);
    expect(springPos[1]).toBeCloseTo(100 * Math.SQRT1_2, 4);
    expect(springPos[2]).toBeCloseTo(100, 5);
    expect(springPos[3]).toBeCloseTo(100 * (0.7 - 0.3 * Math.exp(-0.5)), 4);
    expect(springPos[4]).toBeCloseTo(100 * (0.7 + 0.3 * Math.exp(-1)), 4);
    expect(springPos[5]).toBeCloseTo(100 * (0.7 + 0.3 * Math.exp(-3)), 4);

    // Zero / sub-1 / non-positive counts fall back to linear per reference semantics.
    for (const [type, strength] of [
      ['Bounce', '0'],
      ['Bounce', '0.5'],
      ['Bounce', '-0.5'],
      ['BounceIn', '0'],
      ['Spring', '0'],
      ['Spring', '-5'],
      ['Spring', '0.9'],
    ] as const) {
      expect(samplePreset(type, strength, [0, 0.25, 0.5, 1])).toEqual([
        expect.closeTo(0, 5),
        expect.closeTo(25, 5),
        expect.closeTo(50, 5),
        expect.closeTo(100, 5),
      ]);
    }

    // Upper/lower finite boundaries (100 / -100) stay valid and finite.
    expect(samplePreset('Spring', '100', [1])[0]).toBeCloseTo(70, 5);
    expect(samplePreset('Bounce', '100', [0, 1])).toEqual([expect.closeTo(0, 5), expect.closeTo(0, 5)]);
    expect(samplePreset('BounceIn', '-100', [0, 1])).toEqual([expect.closeTo(0, 5), expect.closeTo(100, 5)]);
  });

  it('rejects out-of-range and non-finite strengths, unsupported presets, and invalid TimeMapIndex', () => {
    const cases = [
      { type: 'Bounce', strength: '101', mapIndex: '0' },
      { type: 'BounceIn', strength: '-101', mapIndex: '0' },
      { type: 'Spring', strength: '101', mapIndex: '0' },
      { type: 'Spring', strength: '-101', mapIndex: '0' },
      { type: 'Spring', strength: 'NaN', mapIndex: '0' },
      { type: 'Bounce', strength: 'Infinity', mapIndex: '0' },
      { type: 'BounceIn', strength: '', mapIndex: '0' },
      { type: 'RandomSquareWave', strength: '3', mapIndex: '0' },
      { type: 'Custom', strength: '0', mapIndex: '0' },
      { type: 'Spring', strength: '3', mapIndex: '2' },
      { type: 'Spring', strength: '3', mapIndex: '-1' },
    ];
    for (const item of cases) {
      const xml = `<DOMFrame index="0" duration="10" tweenType="motion object"><motionObjectXML>` +
        `<AnimationCore TimeScale="24000" duration="10000">` +
        `<TimeMap strength="${item.strength}" type="${item.type}"/>` +
        `<PropertyContainer id="headContainer"><Property id="Motion_X" TimeMapIndex="${item.mapIndex}">` +
        `<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,100" timevalue="8000"/>` +
        `</Property></PropertyContainer></AnimationCore></motionObjectXML></DOMFrame>`;
      const parsed = parseFlaObjectMotion({ name: 'DOMFrame', attributes: {}, xml }, getFlaXflDirectChildren);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain('缓动');
    }
  });

  it('holds eased(1) at and after the last keyframe within the same span, hands off cleanly to the next authored frame, and matches out-of-order seek', () => {
    const instance = (tx: number) =>
      `<DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"><matrix><Matrix tx="${tx}"/></matrix></DOMSymbolInstance>`;
    // Span 1: frames 0..9 (duration 10) at 10fps, TimeScale=10000 -> 1000 ticks/frame.
    // Motion_X (Spring 3) & Motion_Y (Bounce 2) have keys at 0..6000 (frames 0..6), then hold through frames 7..9.
    // Scale_X has a single key (120), Rotation_Z has 3 keys with DualCubic, Alpha_Amount has ignoreTimeMap="1".
    // Span 2: frames 10..11 (duration 2) is a normal static frame that must take over at frame 10.
    const motion = '<motionObjectXML><AnimationCore TimeScale="10000" duration="10000">' +
      '<TimeMap strength="3" type="Spring"/>' +
      '<TimeMap strength="2" type="Bounce"/>' +
      '<TimeMap strength="-80" type="DualCubic"/>' +
      '<PropertyContainer id="headContainer">' +
      '<Property id="Motion_X" TimeMapIndex="0">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,100" timevalue="6000"/>' +
      '</Property>' +
      '<Property id="Motion_Y" TimeMapIndex="1">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,80" timevalue="6000"/>' +
      '</Property>' +
      '<Property id="Scale_X" TimeMapIndex="0"><Keyframe anchor="0,120" timevalue="0"/></Property>' +
      '<Property id="Rotation_Z" TimeMapIndex="2">' +
      '<Keyframe anchor="0,0" timevalue="0"/><Keyframe anchor="0,30" timevalue="3000"/><Keyframe anchor="0,90" timevalue="6000"/>' +
      '</Property>' +
      '<Property id="Alpha_Amount" TimeMapIndex="0" ignoreTimeMap="1">' +
      '<Keyframe anchor="0,100" timevalue="0"/><Keyframe anchor="0,40" timevalue="6000"/>' +
      '</Property>' +
      '</PropertyContainer></AnimationCore></motionObjectXML>';
    const source = adaptFlaXflDisplaySource(
      '<DOMDocument frameRate="10"><timelines><DOMTimeline><layers><DOMLayer><frames>' +
      `<DOMFrame index="0" duration="10" tweenType="motion object">${motion}<elements>${instance(10)}</elements></DOMFrame>` +
      `<DOMFrame index="10" duration="2"><elements>${instance(500)}</elements></DOMFrame>` +
      '</frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>',
      [],
    );
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    expect(scene.frameCount).toBe(12);

    const sampleAt = (frameIndex: number) => {
      const ctx = source.source.buildSceneFrameContext(scene.xml, frameIndex, 'scene:0');
      if (!ctx.ok) throw new Error(ctx.message);
      const sym = ctx.value.layers[0]?.elements[0];
      if (sym?.kind !== 'symbol' || !sym.localTransform) throw new Error(`Missing symbol at frame ${frameIndex}`);
      return { matrix: sym.localTransform, alpha: sym.alphaMultiplier };
    };

    const start = sampleAt(0);
    const mid = sampleAt(2);
    const beforeLast = sampleAt(5);
    const atLast = sampleAt(6);
    const afterLast1 = sampleAt(7);
    const afterLast2 = sampleAt(9);
    const nextSpan = sampleAt(10);

    // Start (frame 0): tx=10, ty=0, scaleX=1.2, alpha=1.
    expect(start.matrix.tx).toBeCloseTo(10, 5);
    expect(start.matrix.ty).toBeCloseTo(0, 5);
    expect(Math.hypot(start.matrix.a, start.matrix.b)).toBeCloseTo(1.2, 5);
    expect(start.alpha).toBeCloseTo(1, 5);

    // Mid (frame 2, ratio = 1/3): Spring has moved past 0 and Bounce is non-zero.
    expect(mid.matrix.tx).toBeGreaterThan(50);
    expect(mid.matrix.ty).toBeGreaterThan(50);
    expect(beforeLast.matrix.tx).not.toBeCloseTo(110, 1);

    // Last key (frame 6) and post-last-key frames (7, 9):
    // Spring(3) holds 10 + 100 * (0.7 + 0.3 * e^-3) != 110; Bounce(2) holds 0 != 80;
    // Scale_X stays single-key constant 1.2; Alpha (ignoreTimeMap) holds 0.4; Rotation_Z (DualCubic) holds 90 deg.
    const expectedSpringEndTx = 10 + 100 * (0.7 + 0.3 * Math.exp(-3));
    for (const held of [atLast, afterLast1, afterLast2]) {
      expect(held.matrix.tx).toBeCloseTo(expectedSpringEndTx, 5);
      expect(held.matrix.ty).toBeCloseTo(0, 5);
      expect(Math.hypot(held.matrix.a, held.matrix.b)).toBeCloseTo(1.2, 5);
      expect(Math.atan2(held.matrix.b, held.matrix.a) * 180 / Math.PI).toBeCloseTo(90, 4);
      expect(held.alpha).toBeCloseTo(0.4, 5);
    }

    // Next authored DOMFrame (frame 10) takes over cleanly.
    expect(nextSpan.matrix).toMatchObject({ a: 1, b: 0, c: 0, d: 1, tx: 500, ty: 0 });
    expect(nextSpan.alpha).toBeUndefined();

    // Out-of-order seek matches sequential evaluation identically.
    for (const ordinal of [10, 6, 0, 9, 2, 7, 5]) {
      expect(sampleAt(ordinal)).toEqual(
        ordinal === 10 ? nextSpan
          : ordinal === 6 ? atLast
          : ordinal === 0 ? start
          : ordinal === 9 ? afterLast2
          : ordinal === 2 ? mid
          : ordinal === 7 ? afterLast1
          : beforeLast,
      );
    }
  });

  it('supports Bounce/Spring mixed with existing TimeMaps on OM-2D fixture while preserving pivot, colors, and SVG output', async () => {
    const zip = await JSZip.loadAsync(await readFile(fixture));
    const originalDoc = await zip.file('DOMDocument.xml')!.async('string');
    // Replace the Quadratic TimeMap with Spring(3) + add a second Quadratic TimeMap (index 1) for Alpha/Scale,
    // keeping Motion_X/Motion_Y on TimeMapIndex 0 (Spring 3).
    const modifiedDoc = originalDoc
      .replace(
        /<TimeMap\b[^>]*type="Quadratic"[^>]*\/>/u,
        '<TimeMap strength="3" type="Spring"/><TimeMap strength="50" type="Quadratic"/>',
      )
      .replace(/<Property\b([^>]*id="Alpha_Amount"[^>]*)>/u, '<Property TimeMapIndex="1"$1>');
    expect(modifiedDoc).toContain('type="Spring"');
    expect(modifiedDoc).toContain('TimeMapIndex="1"');
    zip.file('DOMDocument.xml', modifiedDoc);
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'catalog');
    if (!prepared.ok) throw new Error(prepared.message);
    const { source } = prepared;
    const scene = source.sceneTimelines[0]!;
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, source);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find(({ target }) => target.kind === 'scene');
    expect(entry).toMatchObject({ previewSupported: true, target: { frameCount: 16, selectedFrameIndex: 4 } });

    const frameEnd = source.buildSceneFrameContext(scene.xml, 15, 'scene:0');
    if (!frameEnd.ok) throw new Error(frameEnd.message);
    const symEnd = frameEnd.value.layers[0]?.elements[0];
    if (symEnd?.kind !== 'symbol' || !symEnd.localTransform) throw new Error('Missing end symbol');

    // Spring(3) ends at ratio = 0.7 + 0.3 * e^-3 < 1, so off-centre pivot X is strictly less than raw end key 257.2.
    const m = symEnd.localTransform;
    const endPivotX = m.a * 11.2 + m.c * 27 + m.tx;
    expect(endPivotX).toBeGreaterThan(103.2);
    expect(endPivotX).toBeLessThan(257.2);
    // Alpha_Amount uses TimeMapIndex="1" (Quadratic), which still ends at 0.5.
    expect(symEnd.alphaMultiplier).toBeCloseTo(0.5, 5);

    const svg = await buildSvgForRenderTarget(bytes, { ...entry!.target, selectedFrameIndex: 15 }, undefined, source);
    expect(svg).toMatchObject({ ok: true, hasRenderablePath: true });
    if (svg.ok) expect(svg.svg).toContain('opacity="0.5"');

    // RandomSquareWave still degrades the scene locally while keeping library symbols healthy.
    const waveZip = await JSZip.loadAsync(await readFile(fixture));
    const waveDoc = (await waveZip.file('DOMDocument.xml')!.async('string'))
      .replace('type="Quadratic"', 'type="RandomSquareWave"');
    waveZip.file('DOMDocument.xml', waveDoc);
    const waveCatalog = await buildRenderableTargetCatalog(await waveZip.generateAsync({ type: 'uint8array' }));
    if (!waveCatalog.ok) throw new Error(waveCatalog.message);
    expect(waveCatalog.entries.find(({ target }) => target.kind === 'scene')).toMatchObject({
      previewSupported: false,
      unsupportedReason: expect.stringContaining('缓动'),
    });
    expect(waveCatalog.entries.some(({ target, previewSupported }) => target.kind === 'graphic-symbol' && previewSupported)).toBe(true);
  });

  it('samples Wave presets through a real FLA package and hands off to the next authored XFL frame', async () => {
    const zip = await JSZip.loadAsync(await readFile(fixture));
    const doc = await zip.file('DOMDocument.xml')!.async('string');
    const wavified = doc.replace(
      /<TimeMap\b[^>]*type="Quadratic"[^>]*\/>/u,
      '<TimeMap type="SineWave" strength="2"/><TimeMap type="SawtoothWave" strength="2"/>',
    ).replace(/<Property\b([^>]*id="Rotation_Z"[^>]*)>/u, '<Property TimeMapIndex="1"$1>');
    expect(wavified).not.toBe(doc);
    zip.file('DOMDocument.xml', wavified);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'catalog');
    if (!prepared.ok) throw new Error(prepared.message);
    const { source } = prepared;
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, source);
    if (!catalog.ok) throw new Error(catalog.message);
    const scene = source.sceneTimelines[0]!;
    const target = catalog.entries.find(({ target }) => target.kind === 'scene')!;
    expect(target.previewSupported).toBe(true);
    expect(await buildSvgForRenderTarget(bytes, { ...target.target, selectedFrameIndex: 9 }, undefined, source))
      .toMatchObject({ ok: true, hasRenderablePath: true });
    const sample = (frame: number) => {
      const result = source.buildSceneFrameContext(scene.xml, frame, 'scene:0');
      if (!result.ok) throw new Error(result.message);
      const node = result.value.layers[0]?.elements[0];
      if (node?.kind !== 'symbol' || !node.localTransform) throw new Error('Expected sampled symbol');
      return node.localTransform;
    };
    const start = sample(4);
    const middle = sample(9);
    const end = sample(15);
    expect(middle.tx).not.toBeCloseTo(start.tx, 2);
    expect(end.tx).toBeCloseTo(start.tx, 5);
    expect(end.ty).toBeCloseTo(start.ty, 5);

    const xml = `<DOMDocument frameRate="24"><timelines><DOMTimeline><layers><DOMLayer><frames>
      <DOMFrame index="0" duration="7" tweenType="motion object"><motionObjectXML>
        <AnimationCore TimeScale="24000" duration="7000"><TimeMap type="SawtoothWave" strength="2"/>
          <PropertyContainer id="headContainer">
            <Property id="Rotation_Z"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,90"/></Property>
          </PropertyContainer></AnimationCore></motionObjectXML>
        <elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic"/></elements>
      </DOMFrame>
      <DOMFrame index="7"><elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
        <matrix><Matrix a="0" b="1" c="-1" d="0" tx="50"/></matrix>
      </DOMSymbolInstance></elements></DOMFrame>
    </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(xml, []);
    if (!adapted.ok) throw new Error(adapted.message);
    const track = adapted.source.sceneTimelines[0]!;
    for (const [frame, angle, x] of [[2, 90, 0], [4, 0, 0], [6, 0, 0], [7, 90, 50]] as const) {
      const result = adapted.source.buildSceneFrameContext(track.xml, frame, 'scene:0');
      if (!result.ok) throw new Error(result.message);
      const m = result.value.layers[0]?.elements[0]?.localTransform;
      expect(m).toBeDefined();
      expect(Math.atan2(m!.b, m!.a) * 180 / Math.PI).toBeCloseTo(angle, 5);
      expect(m!.tx).toBeCloseTo(x, 5);
    }
  });
});
