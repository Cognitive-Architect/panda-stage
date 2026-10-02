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

function onePixelPng(): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 40, 90, 210, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function matrix(a = 1, d = 1, tx = 0, ty = 0): string {
  return `<matrix><Matrix a="${a}" d="${d}" tx="${tx}" ty="${ty}"/></matrix>`;
}

function shape(tx = 0, ty = 0): string {
  return `<DOMShape>${matrix(1, 1, tx, ty)}<fills><FillStyle index="1"><SolidColor color="#336699"/></FillStyle></fills><edges><Edge cubics="!0 0|20 0|20 20|0 20|0 0"/></edges></DOMShape>`;
}

function frameTimeline(name: string, elements: string): string {
  return `<DOMTimeline name="${name}"><layers><DOMLayer name="Layer 1"><frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline>`;
}

function graphicSymbol(name: string, elements: string): string {
  return `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${frameTimeline(name, elements)}</timeline></DOMSymbolItem>`;
}

async function makeFla(sceneElements: string, symbols: Readonly<Record<string, string>> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<DOMDocument width="32" height="24"><timelines>${frameTimeline('Scene 1', sceneElements)}</timelines></DOMDocument>`);
  for (const [name, xml] of Object.entries(symbols)) zip.file(`LIBRARY/${name}.xml`, xml);
  return zip.generateAsync({ type: 'uint8array' });
}

function mediaItem(): AnimationImportIR['media'][number] {
  const bytes = onePixelPng();
  return {
    id: 'fla-media-c03-bitmap',
    name: 'Sticker',
    sourceReference: 'LIBRARY/sticker.png',
    bitmapDataReference: null,
    sourceFormat: 'png',
    width: 1,
    height: 1,
    payload: {
      mimeType: 'image/png',
      width: 1,
      height: 1,
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
});
