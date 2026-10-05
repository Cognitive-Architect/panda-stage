import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
interface PngInfo {
  width: number;
  height: number;
  visiblePixelCount: number;
  visibleBounds: null | { x: number; y: number; width: number; height: number };
  isBlank: boolean;
}

interface BatchRow {
  candidateId: string;
  sourceAddress: Record<string, string | number>;
  sourceAddressLabel: string;
  displayLabel: string;
  sourceStateClasses: string[];
  renderAddressClass: string;
  status: string;
  isBlank: boolean;
  pngInfo: PngInfo;
  pngBytes: Buffer;
  svgSha256: string;
  pngSha256: string;
  duplicateGroupId?: string | null;
  representativeCandidateId?: string | null;
  previewIncluded?: boolean;
  [key: string]: unknown;
}

interface PreviewTile extends BatchRow {
  section: string;
}

interface DuplicateMember {
  candidateId: string;
  sourceAddress: Record<string, string | number>;
}

interface DuplicateGroup {
  evidenceKind: string;
  memberCandidateIds: string[];
  representativeCandidateId: string;
  svgHashesIdentical: boolean;
  memberSvgHashes: string[];
  members: DuplicateMember[];
}

interface LayoutTile {
  candidateId: string;
  sourceCrop: { x: number; y: number; width: number; height: number };
  presentationTransform: { fit: string };
}

interface ContactSheetLayout {
  width: number;
  height: number;
  order: string[];
  tiles: LayoutTile[];
  sections: Array<{ id: string }>;
}

interface IsolatedResult {
  candidateId: string;
  status: string;
  error?: string;
}

const core = require('../../scripts/research/issue705-black-asset-batch-core.cjs') as {
  ACCEPTED_B2_MANIFEST_SHA256: string;
  analyzePng: (bytes: Uint8Array) => PngInfo;
  buildContactSheetLayout: (tiles: PreviewTile[], options?: Partial<{ sheetWidth: number; columns: number; margin: number; gap: number }>) => ContactSheetLayout;
  buildContactSheetSvg: (layout: ContactSheetLayout, tiles: PreviewTile[]) => string;
  finalizeBatchResults: (rows: BatchRow[]) => {
    results: BatchRow[];
    duplicateGroups: DuplicateGroup[];
    previewTiles: PreviewTile[];
  };
  isolateCandidateFailures: (
    candidates: Array<{ candidateId: string }>,
    renderOne: (candidate: { candidateId: string }) => Promise<IsolatedResult>,
  ) => Promise<IsolatedResult[]>;
  validateB2Manifest: (manifest: Record<string, unknown>, hash: string) => unknown;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, payload])));
  return Buffer.concat([length, name, payload, checksum]);
}

function rgbaPng(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 4 + 1);
    raw[offset] = 0;
    Buffer.from(pixels).copy(raw, offset + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function renderedRow(
  candidateId: string,
  pngBytes: Buffer,
  sourceName: string,
  renderAddressClass = 'DIRECT_COMPONENT_STATE',
  svgSha256 = 'a'.repeat(64),
): BatchRow {
  const pngInfo = core.analyzePng(pngBytes);
  return {
    candidateId,
    sourceAddress: { sourceName, frameIndex: 0 },
    sourceAddressLabel: `${sourceName}@0`,
    displayLabel: candidateId,
    sourceStateClasses: [renderAddressClass === 'DIRECT_COMPONENT_STATE' ? 'COMPONENT_ASSET' : 'FULL_CHARACTER_STATE'],
    renderAddressClass,
    status: 'RENDER_PENDING',
    isBlank: pngInfo.isBlank,
    pngInfo,
    pngBytes,
    svgSha256,
    pngSha256: hash(pngBytes),
  };
}

describe('Issue #705 Black asset batch core', () => {
  it('accepts the pinned B2 manifest and fails closed on any different manifest hash', () => {
    const bytes = readFileSync('docs/research/issue-704-black-candidate-manifest.json');
    const manifest = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const manifestHash = hash(bytes);

    expect(manifestHash).toBe(core.ACCEPTED_B2_MANIFEST_SHA256);
    expect(() => core.validateB2Manifest(manifest, manifestHash)).not.toThrow();
    expect(() => core.validateB2Manifest(manifest, '0'.repeat(64))).toThrow(/accepted Issue #704 manifest/u);
  });

  it('detects fully transparent PNGs and computes alpha-visible bounds without modifying the input', () => {
    const blank = rgbaPng(3, 2, new Uint8Array(3 * 2 * 4));
    const rgba = new Uint8Array(4 * 3 * 4);
    rgba.set([20, 40, 60, 255], (1 * 4 + 2) * 4);
    rgba.set([10, 30, 50, 1], (2 * 4 + 3) * 4);
    const visible = rgbaPng(4, 3, rgba);
    const originalHash = hash(visible);

    expect(core.analyzePng(blank)).toMatchObject({ width: 3, height: 2, visiblePixelCount: 0, visibleBounds: null, isBlank: true });
    expect(core.analyzePng(visible)).toMatchObject({
      width: 4,
      height: 3,
      visiblePixelCount: 2,
      visibleBounds: { x: 2, y: 1, width: 2, height: 2 },
      isBlank: false,
    });
    expect(hash(visible)).toBe(originalHash);
    const damaged = Buffer.from(blank);
    const lastByteIndex = damaged.length - 1;
    damaged[lastByteIndex] = (damaged[lastByteIndex] ?? 0) ^ 0xff;
    expect(() => core.analyzePng(damaged)).toThrow(/CRC mismatch/u);
  });

  it('groups byte-identical PNGs, preserves distinct SVG evidence and every source address, and selects one representative', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    pixels.set([0, 0, 0, 255], (1 * 4 + 1) * 4);
    const png = rgbaPng(4, 4, pixels);
    const first = renderedRow('B3-CONTROL-DUP-A', png, 'source-a');
    const second = renderedRow('B3-CONTROL-DUP-B', png, 'source-b', 'DIRECT_FULL_CHARACTER_STATE', 'b'.repeat(64));
    const blank = renderedRow('B3-CONTROL-BLANK', rgbaPng(2, 2, new Uint8Array(16)), 'source-empty');

    const result = core.finalizeBatchResults([second, blank, first]);
    expect(result.duplicateGroups).toHaveLength(1);
    const duplicateGroup = result.duplicateGroups[0]!;
    expect(duplicateGroup).toMatchObject({
      evidenceKind: 'EXACT_PNG_SHA256',
      memberCandidateIds: ['B3-CONTROL-DUP-A', 'B3-CONTROL-DUP-B'],
      representativeCandidateId: 'B3-CONTROL-DUP-A',
      svgHashesIdentical: false,
      memberSvgHashes: ['a'.repeat(64), 'b'.repeat(64)],
    });
    expect(duplicateGroup.members.map((member) => member.sourceAddress.sourceName))
      .toEqual(['source-a', 'source-b']);
    expect(result.results.find((row) => row.candidateId === 'B3-CONTROL-BLANK')).toMatchObject({ status: 'BLANK', previewIncluded: false });
    expect(result.previewTiles.map((tile) => tile.candidateId)).toEqual(['B3-CONTROL-DUP-A']);
  });

  it('orders full-character and component sections deterministically and keeps crop transforms presentation-only', () => {
    const rgba = new Uint8Array(10 * 8 * 4);
    rgba.set([50, 80, 120, 255], (2 * 10 + 3) * 4);
    const png = rgbaPng(10, 8, rgba);
    const rows = [
      renderedRow('B3-C', png, 'component-c'),
      renderedRow('B3-B', png, 'full-b', 'DIRECT_FULL_CHARACTER_STATE'),
      renderedRow('B3-A', png, 'component-a'),
    ];
    const finalized = core.finalizeBatchResults(rows);
    const uniqueRows = finalized.results.map((row) => ({
      ...row,
      status: 'RENDER_PENDING',
      pngSha256: `${row.candidateId.endsWith('A') ? '1' : row.candidateId.endsWith('B') ? '2' : '3'}`.repeat(64),
      duplicateGroupId: null,
      representativeCandidateId: null,
      previewIncluded: false,
    }));
    const unique = core.finalizeBatchResults(uniqueRows);
    const layout = core.buildContactSheetLayout(unique.previewTiles, { sheetWidth: 420, columns: 2, margin: 20, gap: 10 });
    const svg = core.buildContactSheetSvg(layout, unique.previewTiles);

    expect(layout.order).toEqual(['B3-B', 'B3-A', 'B3-C']);
    expect(layout.sections.map((section) => section.id)).toEqual(['FULL_CHARACTER_ASSETS', 'COMPONENT_ASSETS']);
    expect(layout.tiles.every((tile) => tile.sourceCrop && tile.presentationTransform.fit === 'contain-alpha-visible-bounds')).toBe(true);
    expect(svg.indexOf('B3-B')).toBeLessThan(svg.indexOf('B3-A'));
    expect(svg).toContain('data:image/png;base64,');
    expect(unique.results).toHaveLength(3);
  });

  it('records an individual render failure and continues with later candidates', async () => {
    const attempted: string[] = [];
    const results = await core.isolateCandidateFailures(
      [{ candidateId: 'B3-A' }, { candidateId: 'B3-FAIL' }, { candidateId: 'B3-C' }],
      async (candidate) => {
        attempted.push(candidate.candidateId);
        if (candidate.candidateId === 'B3-FAIL') throw new Error('isolated failure');
        return { candidateId: candidate.candidateId, status: 'RENDER_PENDING' };
      },
    );

    expect(attempted).toEqual(['B3-A', 'B3-FAIL', 'B3-C']);
    expect(results.map((row) => row.status)).toEqual(['RENDER_PENDING', 'RENDER_FAILED', 'RENDER_PENDING']);
    expect(results[1]).toMatchObject({ candidateId: 'B3-FAIL', error: 'isolated failure' });
  });
});
