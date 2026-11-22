import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';

const fixture = new URL('../fixtures/fla-object-motion/OM-2D.fla', import.meta.url);

describe('Animate Object Motion', () => {
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
});
