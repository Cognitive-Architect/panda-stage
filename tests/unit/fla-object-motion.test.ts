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

  it('matches shadow distance curves by authored order and holds the eased end on seek', () => {
    const source = adaptFlaXflDisplaySource(`<DOMDocument frameRate="24"><timelines><DOMTimeline><layers>
      <DOMLayer><frames><DOMFrame index="0" duration="6" tweenType="motion object">
        <motionObjectXML><AnimationCore TimeScale="24000" duration="6000">
          <TimeMap type="Quadratic" strength="-100"/>
          <PropertyContainer id="headContainer"><Property id="Motion_X" value="3"/>
            <PropertyContainer id="Filters">
              <PropertyContainer><Property id="DropShadow_Distance" value="9"/></PropertyContainer>
              <PropertyContainer><Property id="DropShadow_Distance">
                <Keyframe timevalue="0" anchor="0,4"/><Keyframe timevalue="4000" anchor="0,20"/>
              </Property></PropertyContainer>
            </PropertyContainer>
          </PropertyContainer>
        </AnimationCore></motionObjectXML>
        <elements><DOMSymbolInstance libraryItemName="Tile" symbolType="graphic">
          <filters><DropShadowFilter enabled="false"/><GlowFilter blurX="0" strength="0"/>
            <DropShadowFilter blurX="5" blurY="0" angle="0" color="#123456"/></filters>
        </DOMSymbolInstance></elements>
      </DOMFrame></frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`, []);
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    for (const [frame, distance] of [[0, 4], [2, 8], [4, 20], [5, 20], [2, 8]]) {
      const sampled = source.source.buildSceneFrameContext(scene.xml, frame!, 'scene:0');
      if (!sampled.ok) throw new Error(sampled.message);
      expect(sampled.value.unsupportedDisplayReason).toBeUndefined();
      const element = sampled.value.layers[0]?.elements[0];
      if (element?.kind !== 'symbol') throw new Error('Missing sampled symbol');
      expect(element.localTransform?.tx).toBeCloseTo(3);
      expect(element.instanceFilters).toMatchObject([
        { kind: 'dropShadow', enabled: false, distance: 0 },
        { kind: 'glow', blurX: 0, strength: 0 },
        { kind: 'dropShadow', color: '#123456', blurX: 5, blurY: 0 },
      ]);
      expect(element.instanceFilters?.[2]?.distance).toBeCloseTo(distance!);
    }
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

  it('rejects out-of-range, non-finite, unsupported wave/custom presets, and invalid TimeMapIndex', () => {
    const cases = [
      { type: 'Bounce', strength: '101', mapIndex: '0' },
      { type: 'BounceIn', strength: '-101', mapIndex: '0' },
      { type: 'Spring', strength: '101', mapIndex: '0' },
      { type: 'Spring', strength: '-101', mapIndex: '0' },
      { type: 'Spring', strength: 'NaN', mapIndex: '0' },
      { type: 'Bounce', strength: 'Infinity', mapIndex: '0' },
      { type: 'BounceIn', strength: '', mapIndex: '0' },
      { type: 'SineWave', strength: '3', mapIndex: '0' },
      { type: 'SawtoothWave', strength: '3', mapIndex: '0' },
      { type: 'SquareWave', strength: '3', mapIndex: '0' },
      { type: 'DampedWave', strength: '3', mapIndex: '0' },
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

    // Verify unsupported wave preset on OM-2D fails only the scene candidate while keeping library symbols healthy.
    const waveZip = await JSZip.loadAsync(await readFile(fixture));
    const waveDoc = (await waveZip.file('DOMDocument.xml')!.async('string'))
      .replace('type="Quadratic"', 'type="SineWave"');
    waveZip.file('DOMDocument.xml', waveDoc);
    const waveCatalog = await buildRenderableTargetCatalog(await waveZip.generateAsync({ type: 'uint8array' }));
    if (!waveCatalog.ok) throw new Error(waveCatalog.message);
    expect(waveCatalog.entries.find(({ target }) => target.kind === 'scene')).toMatchObject({
      previewSupported: false,
      unsupportedReason: expect.stringContaining('缓动'),
    });
    expect(waveCatalog.entries.some(({ target, previewSupported }) => target.kind === 'graphic-symbol' && previewSupported)).toBe(true);
  });
});
