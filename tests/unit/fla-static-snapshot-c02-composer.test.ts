import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  resolveFlaDisplayList,
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  type FlaResolvedDisplayList,
} from '../../src/main/services/fla-display-list-resolver';
import {
  buildSvgForResolvedDisplayList,
  type FlaStaticSnapshotBitmapMediaLookup,
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
  const crcInput = Buffer.concat([typeBytes, Buffer.from(data)]);
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.byteLength);
  return chunk;
}

function rgbaPng(width: number, height: number, pixels: readonly number[][]): Uint8Array {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[y * width + x] ?? [0, 0, 0, 0];
      for (let channel = 0; channel < 4; channel += 1) {
        scanlines[rowOffset + 1 + x * 4 + channel] = pixel[channel] ?? 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function mediaItem(
  id: string,
  name: string,
  sourceReference: string,
  width: number,
  height: number,
  bytes: Uint8Array,
): AnimationImportIR['media'][number] {
  return {
    id,
    name,
    sourceReference,
    bitmapDataReference: null,
    sourceFormat: 'png',
    width,
    height,
    payload: {
      mimeType: 'image/png',
      width,
      height,
      bytes,
      alpha: { kind: 'mixed', zeroAlphaPixels: 2, partialAlphaPixels: 1 },
    },
  };
}

const BLUE_PNG = rgbaPng(4, 4, Array.from({ length: 16 }, () => [0, 0, 255, 255]));
const RED_ALPHA_PNG = rgbaPng(2, 2, [
  [255, 0, 0, 255], [0, 0, 0, 0],
  [255, 0, 0, 128], [0, 0, 0, 0],
]);

const SHAPE_BLOCK = `<DOMShape>
  <fills><FillStyle index="1"><SolidColor color="#00ff00" alpha="1"/></FillStyle></fills>
  <edges><Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/></edges>
</DOMShape>`;

function c02Fixture(): {
  readonly lookup: FlaStaticSnapshotBitmapMediaLookup;
  readonly shapeBlocks: ReadonlyMap<string, string>;
  readonly displayList: FlaResolvedDisplayList;
} {
  const result = resolveFlaDisplayList({
    root: {
      kind: 'scene',
      name: 'C02 overlap fixture',
      frameContext: {
        frameIndex: 0,
        layers: [
          {
            name: 'Layer 1',
            visible: true,
            elements: [
              { kind: 'bitmap', libraryItemName: 'LIBRARY/background.png' },
              {
                kind: 'shape',
                shapeId: 'fixture-shape',
                localTransform: { ...FLA_DISPLAY_LIST_IDENTITY_MATRIX, ty: 3 },
              },
            ],
          },
          {
            name: 'Layer 2',
            visible: true,
            elements: [
              {
                kind: 'symbol',
                libraryItemName: 'front-symbol',
                symbolType: 'graphic',
                localTransform: { ...FLA_DISPLAY_LIST_IDENTITY_MATRIX, tx: 1 },
              },
            ],
          },
        ],
      },
    },
    symbols: new Map([[
      'front-symbol',
      {
        kind: 'graphic',
        libraryItemName: 'front-symbol',
        frameContext: {
          frameIndex: 0,
          layers: [{
            name: 'front-symbol-layer',
            visible: true,
            elements: [{
              kind: 'group',
              groupId: 'translated-child-group',
              localTransform: { ...FLA_DISPLAY_LIST_IDENTITY_MATRIX, tx: 1, ty: 1 },
              elements: [{ kind: 'bitmap', libraryItemName: 'overlay.png' }],
            }],
          }],
        },
      },
    ]]),
  });
  if (!result.ok) throw new Error(`fixture resolver failed: ${result.code}`);

  const media = [
    mediaItem('fla-media-c02-background', 'background.png', 'LIBRARY/background.png', 4, 4, BLUE_PNG),
    mediaItem('fla-media-c02-overlay', 'overlay.png', 'LIBRARY/overlay.png', 2, 2, RED_ALPHA_PNG),
  ];
  return {
    lookup: createFlaStaticSnapshotBitmapMediaLookup(media),
    shapeBlocks: new Map([['fixture-shape', SHAPE_BLOCK]]),
    displayList: result.displayList,
  };
}

describe('P0-C02 composed snapshot SVG', () => {
  it('embeds multiple Panda PNGs and supported shapes in source back-to-front order with absolute transforms once', () => {
    const fixture = c02Fixture();
    const result = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: fixture.lookup,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('viewBox="0 0 4 4" width="4" height="4"');
    expect(result.svg.match(/<image\b/g)).toHaveLength(2);
    expect(result.svg.match(/<use\b/g)).toHaveLength(2);
    expect(result.svg.match(/<path\b/g)).toHaveLength(1);
    expect(result.svg.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(result.svg).toContain('transform="matrix(1 0 0 1 2 1)"');
    expect(result.svg).not.toMatch(/\bhref="(?:https?:|file:)/iu);
    expect(result).toMatchObject({
      composition: { bitmapInstanceCount: 2, shapeCount: 1 },
      hasRenderablePath: true,
    });
  });

  it('resolves exact media references and refuses ambiguous basename fallback', () => {
    const first = mediaItem('fla-media-c02-first', 'one/shared.png', 'LIBRARY/one/shared.png', 2, 2, RED_ALPHA_PNG);
    const second = mediaItem('fla-media-c02-second', 'two/shared.png', 'LIBRARY/two/shared.png', 2, 2, RED_ALPHA_PNG);
    const lookup = createFlaStaticSnapshotBitmapMediaLookup([first, second]);

    expect(lookup('LIBRARY/one/shared.png')).toMatchObject({ ok: true, media: { id: first.id } });
    expect(lookup('shared.png')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(lookup('missing.png')).toEqual({ ok: false, reason: 'missing' });
  });

  it('fails closed for unresolved media, malformed PNGs, and stage budgets', () => {
    const fixture = c02Fixture();
    const unresolved = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
    });
    expect(unresolved).toMatchObject({ ok: false, code: 'TARGET_UNSUPPORTED' });

    const invalidMedia = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: (name) => ({
        ok: true,
        media: {
          id: 'fla-media-c02-invalid',
          width: 2,
          height: 2,
          pngBytes: name.includes('background') ? BLUE_PNG : new Uint8Array([1, 2, 3]),
        },
      }),
    });
    expect(invalidMedia).toMatchObject({ ok: false, code: 'RENDER_FAILED' });

    const overBudget = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      stageWidth: 4_097,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: fixture.lookup,
    });
    expect(overBudget).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
  });
});
