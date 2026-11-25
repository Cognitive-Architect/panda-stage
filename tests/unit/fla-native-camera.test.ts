import JSZip from 'jszip';
import { buildRenderableTargetCatalog, buildSvgForRenderTarget } from '../../src/main/services/fla-static-snapshot-svg-builder';
import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';

const tile = '<DOMShape><fills><FillStyle index="1"><SolidColor color="#123456"/></FillStyle></fills>' +
  '<edges><Edge fillStyle1="1" cubics="!0 0|400 0|400 400|0 400|0 0"/></edges></DOMShape>';
const symbol = '<DOMSymbolItem name="Tile" symbolType="graphic"><timeline><DOMTimeline name="Tile"><layers>' +
  '<DOMLayer><frames><DOMFrame index="0"><elements>' + tile +
  '</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>';
const library = [{ name: 'LIBRARY/Tile.xml', xml: symbol }];
const frame = (inner: string, attr = 'index="0" duration="5"') =>
  '<DOMFrame ' + attr + '><elements>' + inner + '</elements></DOMFrame>';
const layer = (name: string, inner: string, attr = '') =>
  '<DOMLayer name="' + name + '" ' + attr + '><frames>' + inner + '</frames></DOMLayer>';
const instance = (libraryItemName: string, matrix: string) =>
  '<DOMSymbolInstance symbolType="graphic" libraryItemName="' + libraryItemName + '">' +
  '<matrix><Matrix ' + matrix + '/></matrix></DOMSymbolInstance>';
const camera = (matrix: string, attr?: string) => frame(instance('__Camera__', matrix), attr);
const doc = (layers: string, attrs: string) => '<DOMDocument frameRate="24" width="200" height="100">' +
  '<symbols><Include href="Tile.xml"/></symbols><timelines><DOMTimeline name="Scene" ' + attrs + '><layers>' +
  layers + '</layers></DOMTimeline></timelines></DOMDocument>';

function prepare(layers: string, attrs = '') {
  const result = adaptFlaXflDisplaySource(doc(layers, attrs), library);
  if (!result.ok) throw new Error(result.message);
  const { source } = result;
  const scene = source.sceneTimelines[0]!;
  return {
    source,
    frameContext(frameIndex: number) {
      const current = source.buildSceneFrameContext(scene.xml, frameIndex, 'scene:0');
      if (!current.ok) throw new Error(current.message);
      return current.value;
    },
    layers(frameIndex: number) {
      const result = resolveFlaDisplayList({
        root: { kind: 'scene', name: 'Scene', frameContext: this.frameContext(frameIndex) },
        symbols: source.symbols,
      });
      if (!result.ok) throw new Error(result.message);
      return result.displayList.layers.map((layer) => [layer.name, layer.children[0]?.worldTransform] as const);
    },
  };
}

describe('native Animate Scene camera', () => {
  it('keeps the authored default camera and library Graphic coordinate systems', () => {
    const content = layer('Tile', frame(instance('Tile', 'tx="135" ty="62"')));
    const untouched = prepare(content);
    const baseline = prepare(layer('Camera', camera('tx="100" ty="50"'), 'layerType="camera"') + content);
    expect(baseline.layers(0)).toEqual(untouched.layers(0));
    expect(baseline.layers(0)).toEqual([['Tile', { a: 1, b: 0, c: 0, d: 1, tx: 135, ty: 62 }]]);
    expect(baseline.source.graphicSymbols.find((candidate) => candidate.sourceLibraryItemName === 'Tile')
      ?.frameContext.layers[0]?.stageProjection).toBeUndefined();
  });

  it('samples Classic Motion and depths, orders far to near, preserves attached layers and culls behind the camera', () => {
    const scene = prepare(
      layer('HUD', frame(instance('Tile', 'tx="16"')), 'attachedToCamera="true"') +
      layer('Far top', frame(instance('Tile', 'tx="140"'), 'index="0" duration="5" frameZDepth="120"')) +
      layer('Far bottom', frame(instance('Tile', 'tx="140"'), 'index="0" duration="5" frameZDepth="120"')) +
      layer('Near', frame(instance('Tile', 'tx="140" ty="50"'), 'index="0" duration="4" frameZDepth="0" tweenType="motion" keyMode="17921"') +
        frame(instance('Tile', 'tx="140" ty="50"'), 'index="4" frameZDepth="-100" keyMode="9728"')) +
      layer('Behind', frame(instance('Tile', ''), 'index="0" duration="5" frameZDepth="-600"')) +
      layer('Camera', camera('tx="100" ty="50"', 'index="0" duration="4" tweenType="motion"') +
        camera('a="0.5" d="0.5" tx="130" ty="50"', 'index="4" frameZDepth="20"'), 'layerType="camera"'),
    );
    expect(scene.layers(0).map(([name]) => name)).toEqual(['Far bottom', 'Far top', 'Near', 'HUD']);
    const mid = scene.layers(2);
    const end = scene.layers(4);
    expect(mid.map(([name]) => name)).toEqual(['Far bottom', 'Far top', 'HUD', 'Near']);
    expect(new Map(mid).get('Near')?.a).toBeCloseTo(528.25 / (528.25 - 60) / 0.75);
    expect(new Map(mid).get('Near')?.tx).toBeCloseTo(100 + (140 - 115) * 528.25 / (528.25 - 60) / 0.75);
    expect(new Map(mid).get('HUD')).toEqual(new Map(end).get('HUD'));
    expect(new Map(end).get('Near')?.a).toBeCloseTo(2 * 528.25 / (528.25 - 120));
    expect(scene.layers(2)).toEqual(mid);
  });

  it.each([false, true])('keeps mask projection local (folder parent: %s)', (inFolder) => {
    const content = layer('Masked', frame(instance('Tile', 'tx="130"')), `parentLayerIndex="${inFolder ? 1 : 0}"`);
    const folder = inFolder ? layer('Mask folder', '', 'layerType="folder" parentLayerIndex="0"') : '';
    const background = layer('Background', frame(instance('Tile', '')));
    const cameraLayer = layer('Camera', camera('tx="120" ty="50"'), 'layerType="camera"');
    for (const [maskDepth, visible] of [['0', true], ['100', false]] as const) {
      const scene = prepare(layer('Mask', frame(tile, 'index="0" frameZDepth="' + maskDepth + '"'), 'layerType="mask"') +
        folder + content + background + cameraLayer);
      const result = resolveFlaDisplayList({
        root: { kind: 'scene', name: 'Scene', frameContext: scene.frameContext(0) },
        symbols: scene.source.symbols,
      });
      if (!result.ok) throw new Error(result.message);
      expect(result.displayList.layers.map((layer) => layer.name)).toEqual(visible
        ? ['Background', 'Masked'] : ['Background']);
      if (visible) {
        const group = result.displayList.layers[1]?.children[0];
        const leaf = group?.kind === 'group' ? group.children[0] : undefined;
        expect(leaf).toMatchObject({ clipPaths: [{ shapes: [{ worldTransform: { tx: -20 } }] }] });
      } else {
        expect(result.displayList.maskDiagnostics?.join()).toContain('depth differs');
      }
    }
  });

  it('skips hidden Folder descendants before projection and keeps their authored end frame', () => {
    const hidden = layer('Hidden folder', '', 'layerType="folder" visible="false"');
    const masked = layer('Mask in folder', frame(tile), 'layerType="mask" parentLayerIndex="0"');
    const hiddenBehindMask = layer('Mask child', frame(tile), 'parentLayerIndex="1"');
    const hiddenDepth = layer('Hidden depth', frame(tile, 'index="0" duration="10" frameZDepth="-528"'), 'parentLayerIndex="0"');
    const healthy = layer('Healthy', frame(tile));
    const nativeCamera = layer('Camera', camera('tx="100" ty="50"'), 'layerType="camera"');
    const scene = prepare(hidden + masked + hiddenBehindMask + hiddenDepth + healthy + nativeCamera);
    expect(scene.source.sceneTimelines[0]?.frameCount).toBe(10);
    expect(scene.frameContext(0).projectionDiagnostics).toBeUndefined();
    expect(scene.layers(0).map(([name]) => name)).toEqual(['Healthy']);
    expect(scene.layers(9)).toEqual([]);
  });

  it.each(['true', 'false', '0'])('preserves the ten-frame authored scene when cameraLayerEnabled is %s', async (enabled) => {
    const cameraLayer = layer('Camera', camera('tx="150" ty="50"', 'index="0" duration="10"'), 'layerType="camera"');
    const artwork = layer('Artwork', frame(instance('Tile', 'tx="135" ty="62"')));
    const attrs = `cameraLayerEnabled="${enabled}"`;
    const scene = prepare(cameraLayer + artwork, attrs);
    expect(scene.source.sceneTimelines[0]?.frameCount).toBe(10);
    expect(scene.source.sceneTimelines[0]?.playbackFrameCount).toBeUndefined();
    expect(scene.layers(4)[0]?.[1]?.tx).toBe(enabled === 'true' ? 85 : 135);
    expect(scene.layers(5)).toEqual([]);
    expect(scene.layers(9)).toEqual([]);
    expect(() => scene.frameContext(10)).toThrow(/outside frameCount 10/u);

    const zip = new JSZip();
    zip.file('DOMDocument.xml', doc(cameraLayer + artwork, attrs));
    zip.file('LIBRARY/Tile.xml', symbol);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const catalog = await buildRenderableTargetCatalog(bytes);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find(({ target }) => target.kind === 'scene')!;
    expect(entry).toMatchObject({ previewSupported: true, target: { frameCount: 10 } });
    const final = await buildSvgForRenderTarget(bytes, { ...entry.target, selectedFrameIndex: 9 });
    expect(final).toMatchObject({ ok: true, width: 200, height: 100, hasRenderablePath: false });
    expect(await buildSvgForRenderTarget(bytes, { ...entry.target, selectedFrameIndex: 10 }))
      .toMatchObject({ ok: false, code: 'TARGET_OUT_OF_RANGE' });
  });

  it('uses valid disabled camera timing without interpreting its invalid neighboring metadata or tween', () => {
    const cameraLayer = layer('Camera',
      camera('a="0" d="0"', 'index="7" duration="3" tweenType="unknown" frameZDepth="broken"') +
      camera('', 'index="-1" duration="60"') +
      camera('', 'index="100" duration="100000"') +
      camera('', 'index="50" duration="0"'),
      'layerType="camera"');
    const artwork = layer('Artwork', frame(instance('Tile', 'tx="135" ty="62"'), 'index="0"'));
    const scene = prepare(cameraLayer + artwork, 'cameraLayerEnabled="false"');
    expect(scene.source.sceneTimelines[0]?.frameCount).toBe(10);
    expect(scene.source.sceneTimelines[0]?.playbackFrameCount).toBeUndefined();
    expect(scene.layers(0)[0]?.[1]?.tx).toBe(135);
    expect(scene.layers(9)).toEqual([]);
  });

  it('disables camera motion and camera depth while preserving layer depth', () => {
    const content = layer('Artwork', frame(instance('Tile', 'tx="135" ty="62"'))) +
      layer('HUD', frame(instance('Tile', 'tx="16"')), 'attachedToCamera="true"') +
      layer('Far', frame(instance('Tile', 'tx="140"'), 'index="0" duration="5" frameZDepth="120"'));
    const cameraLayer = layer('Camera', camera('tx="150" ty="50"', 'index="0" duration="5" frameZDepth="20"'),
      'layerType="camera"');
    expect(prepare(cameraLayer + content, 'cameraLayerEnabled="false"').layers(0)).toEqual(prepare(content).layers(0));
    expect(new Map(prepare(cameraLayer + content, 'cameraLayerEnabled="true"').layers(0)).get('Artwork')?.tx).toBeLessThan(100);
    const singular = layer('Camera', camera('a="0" d="0"', 'index="-1"'), 'layerType="camera"');
    expect(prepare(singular + content, 'cameraLayerEnabled="false"').layers(0)).toEqual(prepare(content).layers(0));
  });

  it('keeps healthy layers when a hidden or visible layer would exceed the projection range', () => {
    const content = layer('Artwork', frame(instance('Tile', 'tx="135" ty="62"')));
    const near = frame(instance('Tile', ''), 'index="0" frameZDepth="-528"');
    const hidden = prepare(layer('Too near', near, 'visible="false"') + content);
    const visible = prepare(layer('Too near', near) + content);
    expect(hidden.layers(0)).toEqual(prepare(content).layers(0));
    expect(visible.layers(0)).toEqual(hidden.layers(0));
    expect(hidden.frameContext(0).projectionDiagnostics).toBeUndefined();
    expect(visible.frameContext(0).projectionDiagnostics).toEqual([expect.stringContaining('Too near')]);
  });

  it('applies inverse rotation and retains healthy Graphics when the camera is singular', () => {
    const content = layer('Tile', frame(instance('Tile', 'tx="150" ty="50"')));
    const rotated = prepare(layer('Camera', camera('a="0" b="1" c="-1" d="0" tx="100" ty="50"'), 'layerType="camera"') + content);
    expect(rotated.layers(0)).toEqual([['Tile', { a: 0, b: -1, c: 1, d: 0, tx: 100, ty: 0 }]]);
    const singular = prepare(layer('Camera', camera('a="0" d="0"'), 'layerType="camera"') + content);
    expect(singular.frameContext(0).unsupportedDisplayReason).toContain('singular');
    expect(singular.source.graphicSymbols.map((candidate) => candidate.sourceLibraryItemName)).toContain('Tile');
  });
});
