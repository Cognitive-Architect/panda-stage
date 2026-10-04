import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { createFlaStaticSnapshotBitmapMediaLookup } from '../../src/main/services/fla-static-snapshot-media-resolver';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return chunk;
}

function pngWithDimensions(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = 1 + width * 4;
  const rgba = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    rgba[y * rowBytes] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = y * rowBytes + 1 + x * 4;
      rgba[pixelOffset] = 40;
      rgba[pixelOffset + 1] = 90;
      rgba[pixelOffset + 2] = 210;
      rgba[pixelOffset + 3] = 255;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rgba)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function matrix(a = 1, d = 1, tx = 0, ty = 0, b = 0, c = 0): string {
  return `<matrix><Matrix a="${a}" b="${b}" c="${c}" d="${d}" tx="${tx}" ty="${ty}"/></matrix>`;
}

function shape(tx = 0, ty = 0, width = 1, height = 1): string {
  const right = width * 20;
  const bottom = height * 20;
  return `<DOMShape>${matrix(1, 1, tx, ty)}<fills><FillStyle index="1"><SolidColor color="#336699"/></FillStyle></fills><edges><Edge fillStyle1="1" cubics="!0 0|${right} 0|${right} ${bottom}|0 ${bottom}|0 0"/></edges></DOMShape>`;
}

function frameTimeline(name: string, elements: string): string {
  return `<DOMTimeline name="${name}"><layers><DOMLayer name="Layer 1"><frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline>`;
}

function graphicSymbol(name: string, elements: string): string {
  return `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${frameTimeline(name, elements)}</timeline></DOMSymbolItem>`;
}

async function makeFla(
  sceneElements: string,
  symbols: Readonly<Record<string, string>> = {},
  stage = { width: 32, height: 24 },
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<DOMDocument width="${stage.width}" height="${stage.height}"><timelines>${frameTimeline('Scene 1', sceneElements)}</timelines></DOMDocument>`);
  for (const [name, xml] of Object.entries(symbols)) zip.file(`LIBRARY/${name}.xml`, xml);
  return zip.generateAsync({ type: 'uint8array' });
}

function mediaItem(width = 1, height = 1): AnimationImportIR['media'][number] {
  const bytes = pngWithDimensions(width, height);
  return {
    id: 'fla-media-c03-bitmap',
    name: 'Sticker',
    sourceReference: 'LIBRARY/sticker.png',
    bitmapDataReference: null,
    sourceFormat: 'png',
    width,
    height,
    payload: {
      mimeType: 'image/png',
      width,
      height,
      bytes,
      alpha: { kind: 'opaque', zeroAlphaPixels: 0, partialAlphaPixels: 0 },
    },
  };
}

describe('P0-C03 production target integration', () => {
  it('catalogs and composes a bitmap-only scene with multiple placements', async () => {
    const bytes = await makeFla(
      `<DOMBitmapInstance libraryItemName="LIBRARY/sticker.png">${matrix(1, 1, 3, 4)}</DOMBitmapInstance><DOMBitmapInstance libraryItemName="LIBRARY/sticker.png">${matrix(1, 1, 12, 8)}</DOMBitmapInstance>`,
    );
    const lookup = createFlaStaticSnapshotBitmapMediaLookup([mediaItem()]);
    const catalog = await buildRenderableTargetCatalog(bytes, lookup);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;

    const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
    expect(scene?.previewSupported).toBe(true);
    expect(scene?.target.userLabel).toContain('主场景');
    if (!scene) return;

    const composed = await buildSvgForRenderTarget(bytes, scene.target, lookup);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.hasRenderablePath).toBe(false);
    expect(composed.composition.bitmapInstanceCount).toBe(2);
    expect(composed.svg.match(/<use\b/gu)).toHaveLength(2);
    expect(composed.svg).toContain('expandedSymbols=0');
    expect(composed.svg).toContain('bitmapInstances=2');
  });

  it('expands nested Graphic symbols and composes every drawable child', async () => {
    const bytes = await makeFla(
      `<DOMSymbolInstance libraryItemName="outer" symbolType="graphic">${matrix()}</DOMSymbolInstance>`,
      {
        outer: graphicSymbol(
          'outer',
          `<DOMSymbolInstance libraryItemName="inner" symbolType="graphic">${matrix()}</DOMSymbolInstance>`,
        ),
        inner: graphicSymbol('inner', shape(1, 2) + shape(9, 10)),
      },
    );
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
    expect(scene?.previewSupported).toBe(true);
    if (!scene) return;

    const composed = await buildSvgForRenderTarget(bytes, scene.target);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.composition.shapeCount).toBe(2);
    expect(composed.composition.expandedSymbolCount).toBe(2);
    expect(composed.composition.resolvedNodeCount).toBeGreaterThan(2);
    expect(composed.svg).toContain('expandedSymbols=2');
    expect(composed.svg.match(/<path\b/gu)).toHaveLength(2);
  });

  it('treats a grouped child Matrix as absolute and does not apply the group twice', async () => {
    const bytes = await makeFla(
      `<DOMGroup>${matrix(2, 2, 10, 15)}<members>${shape(30, 40)}</members></DOMGroup>`,
    );
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
    expect(scene).toBeDefined();
    if (!scene) return;

    const composed = await buildSvgForRenderTarget(bytes, scene.target);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.svg).toContain('transform="matrix(1 0 0 1 30 40)"');
    expect(composed.svg).not.toContain('matrix(2 0 0 2 70 95)');
  });

  it('frames a small Graphic to its vector content inside a large authored document', async () => {
    const bytes = await makeFla('', {
      sticker: graphicSymbol('sticker', shape(0, 0, 50, 60)),
    }, { width: 1920, height: 1080 });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const graphic = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol');
    expect(graphic?.previewSupported).toBe(true);
    if (!graphic) return;

    const composedGraphic = await buildSvgForRenderTarget(bytes, graphic.target);
    expect(composedGraphic.ok).toBe(true);
    if (!composedGraphic.ok) return;
    expect(composedGraphic.width).toBe(58);
    expect(composedGraphic.height).toBe(68);
    expect(composedGraphic.svg).toContain('viewBox="-4 -4 58 68"');
    expect(composedGraphic.composition.framing).toMatchObject({
      mode: 'content',
      contentBounds: { x: 0, y: 0, width: 50, height: 60 },
      viewBox: { x: -4, y: -4, width: 58, height: 68 },
      padding: 4,
      outputWidth: 58,
      outputHeight: 68,
    });
  });

  it('keeps Graphic leaves with negative coordinates inside the content viewBox', async () => {
    const bytes = await makeFla('', {
      negative: graphicSymbol('negative', shape(-40, -30, 50, 60)),
    }, { width: 1920, height: 1080 });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const graphic = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol');
    expect(graphic).toBeDefined();
    if (!graphic) return;

    const composed = await buildSvgForRenderTarget(bytes, graphic.target);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.svg).toContain('viewBox="-44 -34 58 68"');
    expect(composed.composition.framing.contentBounds).toEqual({ x: -40, y: -30, width: 50, height: 60 });
  });

  it('uses the actual supported cubic path extrema when framing Graphic vector content', async () => {
    const cubic = `<DOMShape>${matrix()}<edges><Edge cubics="!0 0(;0 200 200 200 200 0);"/></edges></DOMShape>`;
    const bytes = await makeFla('', { curve: graphicSymbol('curve', cubic) }, { width: 1920, height: 1080 });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const graphic = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol');
    expect(graphic).toBeDefined();
    if (!graphic) return;

    const composed = await buildSvgForRenderTarget(bytes, graphic.target);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.composition.framing.contentBounds).toEqual({ x: 0, y: 0, width: 10, height: 7.5 });
    expect(composed.svg).toContain('viewBox="-4 -4 18 15.5"');
  });

  it('bounds transformed bitmap and vector geometry with translation, scale, and a skewed affine matrix', async () => {
    const bitmapMatrix = matrix(2, 3, -20, 10, 0.5, 0.75);
    const vectorMatrix = matrix(1.5, 2, 30, -10, 0.25, -0.5);
    const bytes = await makeFla('', {
      bitmapGraphic: graphicSymbol('bitmapGraphic',
        `<DOMBitmapInstance libraryItemName="LIBRARY/sticker.png">${bitmapMatrix}</DOMBitmapInstance>`),
      vectorGraphic: graphicSymbol('vectorGraphic', shape(0, 0, 20, 10).replace(
        matrix(),
        vectorMatrix,
      )),
    }, { width: 1920, height: 1080 });
    const lookup = createFlaStaticSnapshotBitmapMediaLookup([mediaItem(4, 2)]);
    const catalog = await buildRenderableTargetCatalog(bytes, lookup);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;

    const bitmapTarget = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol' && entry.target.userLabel === 'bitmapGraphic');
    expect(bitmapTarget?.previewSupported).toBe(true);
    if (!bitmapTarget) return;
    const composedBitmap = await buildSvgForRenderTarget(bytes, bitmapTarget.target, lookup);
    expect(composedBitmap.ok).toBe(true);
    if (!composedBitmap.ok) return;
    expect(composedBitmap.composition.framing.contentBounds).toEqual({ x: -20, y: 10, width: 9.5, height: 8 });
    expect(composedBitmap.svg).toContain('viewBox="-24 6 17.5 16"');

    const vectorTarget = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol' && entry.target.userLabel === 'vectorGraphic');
    expect(vectorTarget?.previewSupported).toBe(true);
    if (!vectorTarget) return;
    const composedVector = await buildSvgForRenderTarget(bytes, vectorTarget.target);
    expect(composedVector.ok).toBe(true);
    if (!composedVector.ok) return;
    expect(composedVector.composition.framing.contentBounds).toEqual({ x: 25, y: -10, width: 35, height: 25 });
    expect(composedVector.svg).toContain('viewBox="21 -14 43 33"');
  });

  it('scales a very large Graphic viewport to the existing pixel budget without cropping its viewBox', async () => {
    const bytes = await makeFla('', {
      large: graphicSymbol('large', shape(0, 0, 100_000, 100_000)),
    }, { width: 1920, height: 1080 });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const graphic = catalog.entries.find((entry) => entry.target.kind === 'graphic-symbol');
    expect(graphic).toBeDefined();
    if (!graphic) return;

    const composed = await buildSvgForRenderTarget(bytes, graphic.target);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.width).toBeLessThanOrEqual(4096);
    expect(composed.height).toBeLessThanOrEqual(4096);
    expect(composed.pixelCount).toBeLessThanOrEqual(16_777_216);
    expect(composed.composition.framing.viewBox).toEqual({ x: -4, y: -4, width: 100_008, height: 100_008 });
    expect(composed.composition.framing.outputWidth).toBe(4096);
    expect(composed.composition.framing.outputHeight).toBe(4096);
  });

  it('keeps non-empty Scene targets at authored stage size instead of tight-framing their content', async () => {
    const bytes = await makeFla(shape(2, 3, 4, 5), {
      sticker: graphicSymbol('sticker', shape(0, 0, 50, 60)),
    }, { width: 1920, height: 1080 });
    const catalog = await buildRenderableTargetCatalog(bytes);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
    expect(scene?.previewSupported).toBe(true);
    if (!scene || scene.target.kind !== 'scene') return;

    const composedScene = await buildSvgForRenderTarget(bytes, scene.target);
    expect(composedScene.ok).toBe(true);
    if (!composedScene.ok) return;
    expect(composedScene.width).toBe(1920);
    expect(composedScene.height).toBe(1080);
    expect(composedScene.svg).toContain('viewBox="0 0 1920 1080"');
    expect(composedScene.composition.framing.mode).toBe('stage');

    const timelineTarget = { ...scene.target, kind: 'timeline' as const };
    const composedTimeline = await buildSvgForRenderTarget(bytes, timelineTarget);
    expect(composedTimeline.ok).toBe(true);
    if (!composedTimeline.ok) return;
    expect(composedTimeline.width).toBe(1920);
    expect(composedTimeline.height).toBe(1080);
    expect(composedTimeline.svg).toContain('viewBox="0 0 1920 1080"');
    expect(composedTimeline.composition.framing.mode).toBe('stage');
  });
});
