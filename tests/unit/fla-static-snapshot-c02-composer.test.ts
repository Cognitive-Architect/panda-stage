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

function c02Fixture(withFrameBlur = false): {
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
            ...(withFrameBlur ? {
              frameFilter: { kind: 'blur' as const, blurX: 0, blurY: 2, quality: 'low' as const, enabled: true as const },
            } : {}),
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
  it.each([
    ['BitmapFill', '', false],
    ['BitmapFill', ' bitmapIsClipped="true"', true],
    ['ClippedBitmapFill', '', true],
  ] as const)('composes %s%s through the shared image registry', (tag, attributes, clipped) => {
    const fixture = c02Fixture();
    const paint = `<${tag} bitmapPath="background.png" allowSmoothing="false"${attributes}>` +
      `<matrix><Matrix a="40" b="10" c="-20" d="30" tx="60" ty="-80"/></matrix></${tag}>`;
    const result = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      renderTargetId: 'c02-bitmap-fill',
      stageWidth: 40,
      stageHeight: 40,
      shapeBlocks: new Map([['fixture-shape', SHAPE_BLOCK.replace('<SolidColor color="#00ff00" alpha="1"/>', paint)]]),
      resolveBitmapMedia: fixture.lookup,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.composition).toMatchObject({ bitmapInstanceCount: 2, fillRegionCount: 1, skippedBitmapFillCount: 0 });
    expect(result.svg.match(/<image\b/gu)).toHaveLength(2);
    expect(result.svg).toContain('image-rendering="pixelated"');
    if (clipped) {
      expect(result.svg).not.toContain('<pattern');
      expect(result.svg).toContain('<clipPath id="fla-bitmap-clip-');
      expect(result.svg).toMatch(/<g transform="matrix\(1 0 0 1 0 3\)"><g clip-path="url\(#fla-bitmap-clip-[\da-f]+\)"><use href="#fla-bitmap-[\da-f]+" transform="matrix\(2 0.5 -1 1.5 60 -80\)"/u);
    } else {
      expect(result.svg).toMatch(/<pattern[^>]+patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="matrix\(2 0.5 -1 1.5 60 -80\)"/u);
      expect(result.svg).toMatch(/<path[^>]+transform="matrix\(1 0 0 1 0 3\)" fill="url\(#fla-bitmap-pattern-/u);
    }
  });

  it('fails on an invalid PNG or matrix even when the bitmap is used as a fill', () => {
    const fixture = c02Fixture();
    const render = (paint: string, resolveBitmapMedia = fixture.lookup) => buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      renderTargetId: 'c02-invalid-bitmap-fill',
      stageWidth: 40,
      stageHeight: 40,
      shapeBlocks: new Map([['fixture-shape', SHAPE_BLOCK.replace('<SolidColor color="#00ff00" alpha="1"/>', paint)]]),
      resolveBitmapMedia,
    });
    expect(render('<BitmapFill bitmapPath="background.png"><matrix><Matrix tx="Infinity"/></matrix></BitmapFill>'))
      .toMatchObject({ ok: false, code: 'RENDER_FAILED', message: expect.stringContaining('invalid matrix') });
    expect(render('<BitmapFill bitmapPath="bad"/>', (name) => name === 'bad'
      ? { ok: true, media: { id: 'bad', width: 5, height: 4, pngBytes: BLUE_PNG } }
      : fixture.lookup(name)))
      .toMatchObject({ ok: false, code: 'RENDER_FAILED', message: expect.stringContaining('not a bounded RGBA PNG') });
  });

  it('composes shapes whose aggregate raw runs exceed the former limit', () => {
    const shapeCount = 8;
    const edgesPerShape = 8_200;
    const shapeId = 'fragmented-shape';
    const shapeBlock = SHAPE_BLOCK.replace('</edges>',
      '<Edge edges="!0 0|20 0"/>'.repeat(edgesPerShape - 1) + '</edges>');
    const resolved = resolveFlaDisplayList({
      root: {
        kind: 'scene',
        name: 'Fragmented shapes',
        frameContext: {
          frameIndex: 0,
          layers: [{
            name: 'Shapes',
            visible: true,
            elements: Array.from({ length: shapeCount }, () => ({ kind: 'shape', shapeId })),
          }],
        },
      },
      symbols: new Map(),
    });
    if (!resolved.ok) throw new Error(resolved.message);

    const result = buildSvgForResolvedDisplayList({
      displayList: resolved.displayList,
      renderTargetId: 'fragmented-shapes',
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: new Map([[shapeId, shapeBlock]]),
      resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
    });

    if (!result.ok) throw new Error(result.message);
    expect(result.composition).toMatchObject({
      sourceEdgeCount: 65_600,
      rawStyleRunCount: 65_600,
      uniqueEffectiveStyleCount: shapeCount,
      postReconstructionFillCount: shapeCount,
      postReconstructionStrokePathCount: 0,
      fillBoundarySegmentCount: shapeCount * 4,
      svgByteLength: Buffer.byteLength(result.svg),
    });
  });

  it('embeds multiple Panda PNGs and supported shapes in caller-supplied painter order with absolute transforms once', () => {
    const fixture = c02Fixture();
    const result = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      renderTargetId: 'c02-composer-scene',
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

  it('applies a vertical BlurFilter to its owning frame layer and expands filtered content bounds', () => {
    const fixture = c02Fixture(true);
    const displayList: FlaResolvedDisplayList = { ...fixture.displayList, kind: 'graphic' };
    const baselineFixture = c02Fixture();
    const baselineList: FlaResolvedDisplayList = { ...baselineFixture.displayList, kind: 'graphic' };
    const result = buildSvgForResolvedDisplayList({
      displayList,
      renderTargetId: 'c02-frame-blur-scene',
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: fixture.lookup,
    });
    const baseline = buildSvgForResolvedDisplayList({
      displayList: baselineList,
      renderTargetId: 'c02-frame-blur-baseline',
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: baselineFixture.shapeBlocks,
      resolveBitmapMedia: baselineFixture.lookup,
    });

    expect(result.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!result.ok || !baseline.ok) return;
    expect(result.svg).toContain('<feGaussianBlur in="SourceGraphic" stdDeviation="0 2"/>');
    expect(result.height).toBeGreaterThan(0);
    const filterGroupStart = result.svg.indexOf('<g filter="url(#fla-frame-blur-');
    const shapePath = result.svg.indexOf('<path');
    const filterGroupEnd = result.svg.indexOf('</g>', filterGroupStart);
    const unfilteredFrontLayerUse = result.svg.lastIndexOf('transform="matrix(1 0 0 1 2 1)"');
    expect(filterGroupStart).toBeGreaterThanOrEqual(0);
    expect(shapePath).toBeGreaterThan(filterGroupStart);
    expect(filterGroupEnd).toBeGreaterThan(shapePath);
    expect(unfilteredFrontLayerUse).toBeGreaterThan(filterGroupEnd);
    expect(result.composition.framing.contentBounds?.height)
      .toBeGreaterThan(baseline.composition.framing.contentBounds?.height ?? 0);
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
      renderTargetId: 'c02-composer-scene',
      stageWidth: 4,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
    });
    expect(unresolved).toMatchObject({ ok: false, code: 'TARGET_UNSUPPORTED' });

    const invalidMedia = buildSvgForResolvedDisplayList({
      displayList: fixture.displayList,
      renderTargetId: 'c02-composer-scene',
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
      renderTargetId: 'c02-composer-scene',
      stageWidth: 4_097,
      stageHeight: 4,
      shapeBlocks: fixture.shapeBlocks,
      resolveBitmapMedia: fixture.lookup,
    });
    expect(overBudget).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
  });
});
