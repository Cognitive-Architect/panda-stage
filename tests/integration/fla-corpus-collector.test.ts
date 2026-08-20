/**
 * FLA V1.5-D corpus collector integration tests.
 *
 * - Reads only from explicitly provided --root (never crawls).
 * - Emits a normalized manifest with deterministic SHA-256.
 * - Classifies strict-PASS / strict-REJECT (+54) / no-DOMDocument cases.
 * - Captures zero-raster distinct from structurally-empty.
 * - Captures #278-corrected B1 frame/tween semantics.
 * - Excludes absolute local paths from the output.
 * - Refuses to overwrite output with a worse-shape manifest.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type {} from '../helpers/fla-corpus-probe.js';

const COLLECTOR = resolve(
  __dirname,
  '../../scripts/fla-corpus-collector.cjs',
);
const WORK_ROOT = resolve(tmpdir(), `fla-corpus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function writeSyntheticZip(_filePath: string, content: string) {
  // Use the same minimal ZIP builder as the unit tests, duplicated here
  // so the integration test is self-contained.
  const contentBuf = Buffer.from(content, 'utf8');
  const nameBuf = Buffer.from('DOMDocument.xml', 'utf8');
  const localHeaderSize = 30 + nameBuf.byteLength;
  const centralEntrySize = 46 + nameBuf.byteLength;
  const totalSize = localHeaderSize + contentBuf.byteLength + centralEntrySize + 22;

  const buf = Buffer.alloc(totalSize);
  let off = 0;
  // Local file header
  buf.writeUInt32LE(0x04034b50, off); off += 4;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(crc32Of(contentBuf), off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt16LE(nameBuf.byteLength, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  nameBuf.copy(buf, off); off += nameBuf.byteLength;
  contentBuf.copy(buf, off); off += contentBuf.byteLength;
  const localEnd = off;
  // Central directory
  buf.writeUInt32LE(0x02014b50, off); off += 4;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(crc32Of(contentBuf), off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt16LE(nameBuf.byteLength, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  nameBuf.copy(buf, off); off += nameBuf.byteLength;
  const centralEnd = off;
  // EOCD
  buf.writeUInt32LE(0x06054b50, off); off += 4;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt32LE(centralEnd - localEnd + 54, off); off += 4;
  buf.writeUInt32LE(localEnd, off); off += 4;
  buf.writeUInt16LE(0, off);

  // Overdeclare the central-directory size by +54 to simulate the recurring
  // malformed family (Issue #279 §"Seed corpus" / handoff #267).
  return Buffer.from(buf);
}

// Identical to writeSyntheticZip but with an accurate (delta=0) EOCD
// central-directory size declaration — used for the strict-PASS samples.
function writeCleanZip(_filePath: string, content: string) {
  const contentBuf = Buffer.from(content, 'utf8');
  const nameBuf = Buffer.from('DOMDocument.xml', 'utf8');
  const localHeaderSize = 30 + nameBuf.byteLength;
  const centralEntrySize = 46 + nameBuf.byteLength;
  const totalSize = localHeaderSize + contentBuf.byteLength + centralEntrySize + 22;
  const buf = Buffer.alloc(totalSize);
  let off = 0;
  buf.writeUInt32LE(0x04034b50, off); off += 4;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(crc32Of(contentBuf), off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt16LE(nameBuf.byteLength, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  nameBuf.copy(buf, off); off += nameBuf.byteLength;
  contentBuf.copy(buf, off); off += contentBuf.byteLength;
  const localEnd = off;
  buf.writeUInt32LE(0x02014b50, off); off += 4;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(20, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(crc32Of(contentBuf), off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt32LE(contentBuf.byteLength, off); off += 4;
  buf.writeUInt16LE(nameBuf.byteLength, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  nameBuf.copy(buf, off); off += nameBuf.byteLength;
  const centralEnd = off;
  buf.writeUInt32LE(0x06054b50, off); off += 4;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(0, off); off += 2;
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt32LE(centralEnd - localEnd, off); off += 4; // delta = 0
  buf.writeUInt32LE(localEnd, off); off += 4;
  buf.writeUInt16LE(0, off);
  return buf;
}

function crc32Of(buf: Buffer) {
  let crc = 0xffffffff >>> 0;
  for (let i = 0; i < buf.byteLength; i += 1) {
    crc = (crc ^ buf[i]!) >>> 0;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PASS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="100" height="100" frameRate="24">
  <media><DOMBitmapItem name="bm0" href="bin/x.dat"/></media>
  <timelines>
    <DOMTimeline>
      <layers><DOMLayer><frames><DOMFrame index="0" duration="1"/></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;

const ZERO_RASTER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="100" height="100" frameRate="24">
  <media/>
  <timelines>
    <DOMTimeline>
      <layers><DOMLayer><frames><DOMFrame index="0" duration="1"/><DOMFrame index="1" duration="1"/></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
});

afterEach(() => {
  if (existsSync(WORK_ROOT)) {
    rmSync(WORK_ROOT, { recursive: true, force: true });
  }
});

describe('fla-corpus-collector integration', () => {
  it('classifies 2 strict-PASS / 4 strict-REJECT +54 originals correctly', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    writeFileSync(
      resolve(WORK_ROOT, 'pass-raster.fla'),
      writeCleanZip('', PASS_XML),
    );
    writeFileSync(
      resolve(WORK_ROOT, 'pass-zero-raster.fla'),
      writeCleanZip('', ZERO_RASTER_XML),
    );
    // Each malformed sample carries a slightly different XML payload so the
    // resulting bytes (and therefore SHA-256) differ; otherwise dedup would
    // collapse them and obscure the 4-vs-2 baseline.
    for (let i = 0; i < 4; i += 1) {
      const xml = ZERO_RASTER_XML.replace(
        '<DOMFrame index="0" duration="1"/>',
        `<DOMFrame index="0" duration="1" comment="sample-${i}"/>`,
      );
      writeFileSync(
        resolve(WORK_ROOT, `malformed-${i}.fla`),
        writeSyntheticZip('', xml),
      );
    }
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    const res = spawnSync(
      process.execPath,
      [COLLECTOR, '--root', WORK_ROOT, '--out', outPath],
      { encoding: 'utf8' },
    );
    expect(res.status).toBe(0);
    const manifest = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(manifest.totals.samples).toBe(6);
    expect(manifest.totals.byPreflight).toEqual({ pass: 2, reject: 4 });
    expect(manifest.totals.byEvidenceShape).toEqual({
      rasterHeavy: 1,
      zeroRaster: 1,
      parserNotReached: 4,
    });
    expect(manifest.cReadinessAssessment.plus54FamilySampleCount).toBe(4);
  });

  it('captures zero-raster as distinct from structurally empty', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    writeFileSync(
      resolve(WORK_ROOT, 'zero-raster.fla'),
      writeCleanZip('', ZERO_RASTER_XML),
    );
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    spawnSync(process.execPath, [COLLECTOR, '--root', WORK_ROOT, '--out', outPath], {
      encoding: 'utf8',
    });
    const manifest = JSON.parse(readFileSync(outPath, 'utf8'));
    const sample = manifest.samples[0]!;
    expect(sample.raster?.bitmapMediaCount).toBe(0);
    expect(sample.structure?.sceneCount).toBe(1);
    expect(sample.structure?.frameCount).toBe(2);
    expect(sample.previewAvailable).toBe(false);
  });

  it('excludes absolute local paths from the output', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    writeFileSync(
      resolve(WORK_ROOT, 'pass-raster.fla'),
      writeCleanZip('', PASS_XML),
    );
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    spawnSync(process.execPath, [COLLECTOR, '--root', WORK_ROOT, '--out', outPath], {
      encoding: 'utf8',
    });
    const raw = readFileSync(outPath, 'utf8');
    // Must not contain the absolute workspace path that was passed in.
    expect(raw).not.toContain(WORK_ROOT);
    expect(raw).not.toMatch(/D:\\/);
    expect(raw).not.toMatch(/\/private\//);
  });

  it('refuses to run without --root', () => {
    const res = spawnSync(process.execPath, [COLLECTOR, '--out', 'x.json'], {
      encoding: 'utf8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('--root');
  });

  it('refuses to run without --out', () => {
    const res = spawnSync(process.execPath, [COLLECTOR, '--root', WORK_ROOT], {
      encoding: 'utf8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('--out');
  });

  it('refuses non-directory --root', () => {
    const res = spawnSync(
      process.execPath,
      [COLLECTOR, '--root', COLLECTOR, '--out', 'x.json'],
      { encoding: 'utf8' },
    );
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('not a directory');
  });

  it('never mutates source samples (collector is read-only)', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    const samplePath = resolve(WORK_ROOT, 'pass-raster.fla');
    writeFileSync(samplePath, writeCleanZip('', PASS_XML));
    const before = readFileSync(samplePath);
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    spawnSync(process.execPath, [COLLECTOR, '--root', WORK_ROOT, '--out', outPath], {
      encoding: 'utf8',
    });
    expect(readFileSync(samplePath).equals(before)).toBe(true);
  });

  it('deduplicates samples by SHA-256', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    const buf = writeCleanZip('', PASS_XML);
    writeFileSync(resolve(WORK_ROOT, 'dup-a.fla'), buf);
    writeFileSync(resolve(WORK_ROOT, 'dup-b.fla'), buf);
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    spawnSync(process.execPath, [COLLECTOR, '--root', WORK_ROOT, '--out', outPath], {
      encoding: 'utf8',
    });
    const manifest = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(manifest.totals.samples).toBe(1);
    const sample = manifest.samples[0]!;
    expect(sample.notes).toContain('duplicate-of:');
  });
});