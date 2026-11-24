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
const doc = (layers: string) => '<DOMDocument frameRate="24" width="200" height="100">' +
  '<symbols><Include href="Tile.xml"/></symbols><timelines><DOMTimeline name="Scene"><layers>' +
  layers + '</layers></DOMTimeline></timelines></DOMDocument>';

function prepare(layers: string) {
  const result = adaptFlaXflDisplaySource(doc(layers), library);
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

  it('keeps matching mask geometry in camera space and diagnoses different mask depth locally', () => {
    const content = layer('Masked', frame(instance('Tile', 'tx="130"')), 'parentLayerIndex="0"');
    const background = layer('Background', frame(instance('Tile', '')));
    const cameraLayer = layer('Camera', camera('tx="120" ty="50"'), 'layerType="camera"');
    for (const [maskDepth, visible] of [['0', true], ['100', false]] as const) {
      const scene = prepare(layer('Mask', frame(tile, 'index="0" frameZDepth="' + maskDepth + '"'), 'layerType="mask"') +
        content + background + cameraLayer);
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

  it('applies inverse rotation and retains healthy Graphics when the camera is singular', () => {
    const content = layer('Tile', frame(instance('Tile', 'tx="150" ty="50"')));
    const rotated = prepare(layer('Camera', camera('a="0" b="1" c="-1" d="0" tx="100" ty="50"'), 'layerType="camera"') + content);
    expect(rotated.layers(0)).toEqual([['Tile', { a: 0, b: -1, c: 1, d: 0, tx: 100, ty: 0 }]]);
    const singular = prepare(layer('Camera', camera('a="0" d="0"'), 'layerType="camera"') + content);
    expect(singular.frameContext(0).unsupportedDisplayReason).toContain('singular');
    expect(singular.source.graphicSymbols.map((candidate) => candidate.sourceLibraryItemName)).toContain('Tile');
  });
});
