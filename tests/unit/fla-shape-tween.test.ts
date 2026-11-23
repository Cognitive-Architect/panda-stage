import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';

function solidShape(x: number, color: string, controlX = 384): string {
  return '<DOMShape><matrix><Matrix tx="5" ty="3"/></matrix>' +
    '<fills><FillStyle index="1"><SolidColor color="' + color + '"/></FillStyle></fills>' +
    '<edges><Edge fillStyle0="1" edges="!' + x + ' 0|256 0[' + controlX +
    ' 128 256 256|' + x + ' 0"/></edges></DOMShape>';
}

async function buildFixture(unsupportedPair: boolean) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="50" height="50"/>');
  const controlB = unsupportedPair ? 'invalid' : '#2, #0.8';
  const morph = '<MorphShape><morphSegments><MorphSegment ' +
    'startPointA="#FFFFFF.8, 0" startPointB="#0.8, 0" ' +
    'fillIndex1="0" fillIndex2="0" strokeIndex1="0" strokeIndex2="0">' +
    '<MorphCurves anchorPointA="1, 0" anchorPointB="1, 0" isLine="true"/>' +
    '<MorphCurves anchorPointA="1, 1" anchorPointB="1, 1" ' +
    'controlPointA="#1.8, #0.8" controlPointB="' + controlB + '"/>' +
    '<MorphCurves anchorPointA="#FFFFFF.8, 0" anchorPointB="#0.8, 0" isLine="true"/>' +
    '</MorphSegment></morphSegments></MorphShape>';
  zip.file('LIBRARY/shape-tween.xml',
    '<DOMSymbolItem name="shape-tween" symbolType="graphic"><timeline><DOMTimeline><layers>' +
    '<DOMLayer name="mouth"><frames><DOMFrame index="0" duration="4" tweenType="shape">' +
    morph + '<elements>' + solidShape(-128, '#ff0000') + '</elements></DOMFrame>' +
    '<DOMFrame index="4"><elements>' + solidShape(128, '#0000ff', 512) + '</elements></DOMFrame></frames></DOMLayer>' +
    '<DOMLayer name="other"><frames><DOMFrame index="0" duration="2"><elements>' +
    solidShape(0, '#00ff00') + '</elements></DOMFrame><DOMFrame index="2" duration="3"><elements>' +
    solidShape(0, '#ffff00') + '</elements></DOMFrame></frames></DOMLayer>' +
    '</layers></DOMTimeline></timeline></DOMSymbolItem>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const target: FlaRenderTarget = {
    renderTargetId: 'fla-render-target-shape-tween',
    kind: 'graphic-symbol',
    userLabel: 'Shape Tween',
    sourceLibraryItemName: 'shape-tween',
    frameCount: 5,
    compatibility: [],
  };
  return async (frameIndex: number) => {
    const frame = await buildSvgForRenderTarget(
      bytes, { ...target, selectedFrameIndex: frameIndex }, undefined, prepared.source,
    );
    if (!frame.ok) throw new Error(frame.message);
    return frame.svg;
  };
}

describe('FLA Shape Tween display-list sampling', () => {
  it('uses the paired line and quadratic points at the requested time and preserves authored end frames', async () => {
    const render = await buildFixture(false);
    const middle = await render(2);
    expect(await render(0)).toContain('fill="#ff0000"');
    expect(await render(4)).toContain('fill="#0000ff"');
    expect(middle).toContain('fill="#800080"');
    expect(middle).toContain('Q 22.4000 6.4000 12.8000 0.0000');
    expect(middle).toContain('matrix(1 0 0 1 5 3)');
    expect(middle).toContain('fill="#ffff00"');
    expect(await render(1)).toContain('fill="#bf0040"');
    expect(await render(2)).toBe(middle);
  });

  it('holds the authored drawing on an unsupported tween while the other layer advances', async () => {
    const render = await buildFixture(true);
    const middle = await render(2);
    expect(middle).toContain('fill="#ff0000"');
    expect(middle).toContain('fill="#ffff00"');
    expect(await render(4)).toContain('fill="#0000ff"');
  });
});
