import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const load = (name: string) => readFile(new URL(`../fixtures/fla-dynamic-mask/${name}.fla`, import.meta.url));
const clipIds = (svg: string) => [...svg.matchAll(/<clipPath id="([^"]+)"/gu)].map((match) => match[1]);

async function sceneSampler(bytes: Uint8Array) {
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find(({ target }) => target.kind === 'scene');
  if (!scene?.previewSupported) throw new Error(scene?.unsupportedReason ?? 'Missing scene target');
  return async (frameIndex: number) => {
    const output = await buildSvgForRenderTarget(bytes,
      { ...scene.target, selectedFrameIndex: frameIndex }, undefined, prepared.source);
    if (!output.ok) throw new Error(output.message);
    return output;
  };
}

describe('Animate dynamic masks', () => {
  it.each(['ordinary', 'mask'] as const)('isolates a bad IK %s layer through catalog and real SVG composition', async (kind) => {
    const zip = await JSZip.loadAsync(await load('MASK'));
    const doc = await zip.file('DOMDocument.xml')!.async('string');
    const broken = (frame: string) => frame.replace(/tweenType="[^"]+"/u, 'tweenType="IK pose"');
    const updated = kind === 'mask'
      ? doc.replace(/<DOMLayer[^>]*name="Moving[ _]windows"[^>]*>[\s\S]*?<\/DOMLayer>/u, (layer) =>
        layer.replace(/<DOMFrame[^>]+tweenType="motion object"[^>]*>/u, broken))
      : doc.replace('<layers>', '<layers><DOMLayer name="Bad armature"><frames>' +
        '<DOMFrame index="0" duration="8" tweenType="IK pose"><elements>' +
        '<DOMSymbolInstance libraryItemName="DoubleWindow" symbolType="graphic"/>' +
        '</elements><betweenFrameMatrixList><Matrix/></betweenFrameMatrixList></DOMFrame></frames></DOMLayer>')
        .replace(/parentLayerIndex="(\d+)"/gu, (_, value: string) => `parentLayerIndex="${Number(value) + 1}"`);
    expect(updated).not.toBe(doc);
    zip.file('DOMDocument.xml', updated);
    const sample = await sceneSampler(await zip.generateAsync({ type: 'uint8array' }));
    const frame = await sample(3);
    expect(frame.svg).toMatch(/#196be6/iu);
    expect(frame.svg).toMatch(/#f23544/iu);
    if (kind === 'mask') {
      expect(frame.maskWarning).toMatch(/骨架/u);
      expect(frame.svg).not.toMatch(/#f08f36/iu);
    } else {
      expect(frame.ikPoseWarning).toMatch(/Bad armature.*第 1–8 帧.*骨架/u);
      expect(frame.maskWarning).toBeUndefined();
      expect(frame.svg).toMatch(/#f08f36/iu);
    }
  });
  it('updates the shape and object motion clip geometry on the same source frame', async () => {
    const sample = await sceneSampler(await load('MASK'));
    const [middle, start, end] = [await sample(3), await sample(0), await sample(7)];
    for (const frame of [start, middle, end]) {
      expect(frame.maskWarning).toBeUndefined();
      expect(clipIds(frame.svg)).toHaveLength(2);
      expect(frame.svg).toMatch(/#f23544/iu);
      expect(frame.svg).toMatch(/#196be6/iu);
      expect(frame.svg).toMatch(/#f08f36/iu);
      expect(frame.svg).not.toMatch(/#000000/iu);
      expect([...frame.svg.matchAll(/<g clip-path=/gu)]).toHaveLength(3);
    }
    expect(new Set([start, middle, end].flatMap(({ svg }) => clipIds(svg))).size).toBe(6);
    expect((await sample(3)).svg).toEqual(middle.svg);
  });

  it('preserves nested intersections, mirror transforms and both symbol clocks', async () => {
    const sample = await sceneSampler(await load('MASK-NESTED'));
    const [end, start, middle] = [await sample(7), await sample(0), await sample(3)];
    for (const frame of [start, middle, end]) {
      expect(frame.maskWarning).toBeUndefined();
      expect(frame.svg).toMatch(/matrix\(-1[ ,]/u);
      expect(frame.svg).toMatch(/#21b572/iu);
      expect(frame.svg).toMatch(/#f18d36/iu);
      expect(frame.svg).toContain('clip-rule="nonzero"');
      expect([...frame.svg.matchAll(/<g clip-path=/gu)]).toHaveLength(3);
    }
    expect(new Set([start, middle, end].flatMap(({ svg }) => clipIds(svg))).size).toBe(9);
    expect((await sample(0)).svg).toEqual(start.svg);
  });

  it('uses the Animate export semantics for blank, hidden and ended mask layers', async () => {
    const sample = await sceneSampler(await load('MASK-EDGE'));
    const start = await sample(0);
    const after = await sample(3);
    expect(start.maskWarning).toBeUndefined();
    expect(after.maskWarning).toBeUndefined();
    expect(clipIds(start.svg)).toHaveLength(3);
    expect(clipIds(after.svg)).toHaveLength(1);
    expect(clipIds(start.svg)).toContain(clipIds(after.svg)[0]);
    expect((await sample(5)).svg.replace(/<desc>.*?<\/desc>/u, ''))
      .toEqual(after.svg.replace(/<desc>.*?<\/desc>/u, ''));
  });

  it('omits an unresolved mask dependency group and still composes the healthy scene layers', async () => {
    const zip = await JSZip.loadAsync(await load('MASK'));
    const doc = await zip.file('DOMDocument.xml')!.async('string');
    zip.file('DOMDocument.xml', doc.replace('libraryItemName="DoubleWindow"', 'libraryItemName="MissingWindow"'));
    const sample = await sceneSampler(await zip.generateAsync({ type: 'uint8array' }));
    const frame = await sample(3);
    expect(frame.maskWarning).toMatch(/Moving[ _]windows/u);
    expect(frame.maskWarning).toContain('MissingWindow');
    expect(frame.svg).not.toMatch(/#f08f36/iu);
    expect(frame.svg).toMatch(/#196be6/iu);
    expect(frame.svg).toMatch(/#f23544/iu);
  });
});
describe('scene cover with a blank lead-in', () => {
  it('uses the first Shape Tween mask frame as cover without changing the source positions', async () => {
    const bytes = await load('MASK-LEAD-IN');
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
    if (!catalog.ok) throw new Error(catalog.message);
    const entry = catalog.entries.find(({ target }) => target.kind === 'scene');
    expect(entry).toMatchObject({ previewSupported: true, isBlank: false, target: {
      frameCount: 11, selectedFrameIndex: 3,
    } });
    const cover = await buildSvgForRenderTarget(bytes, entry!.target, undefined, prepared.source);
    const blank = await buildSvgForRenderTarget(bytes, { ...entry!.target, selectedFrameIndex: 0 }, undefined, prepared.source);
    expect(cover).toMatchObject({ ok: true, hasRenderablePath: true });
    expect(blank).toMatchObject({ ok: true, hasRenderablePath: false });
    if (cover.ok) expect(clipIds(cover.svg)).toHaveLength(1);
  });
});
