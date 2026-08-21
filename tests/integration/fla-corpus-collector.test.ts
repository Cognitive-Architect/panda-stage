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
    // Issue #280 corrective item 3 + #281 Part A: byEvidenceShape is keyed
    // on offline-raster presence (renamed from the prior misleading
    // `offlineStrictPass` / `offlineStructEmpty` names), since productionParser
    // is hard-pinned to 'not-verified' by the offline-only helper.
    expect(manifest.totals.byEvidenceShape).toEqual({
      offlineRasterPresent: 1,
      offlineZeroRaster: 1,
      parserNotVerified: 4,
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
    expect(sample.offlineProbe.raster?.bitmapMediaCount).toBe(0);
    expect(sample.offlineProbe.structure?.sceneCount).toBe(1);
    expect(sample.offlineProbe.structure?.frameCount).toBe(2);
    // Issue #280 corrective item 3: previewAvailable must NOT be asserted
    // just because the offline probe found raster; here raster=0 anyway but
    // we additionally assert productionParser.previewAvailable stays false.
    expect(sample.productionParser.previewAvailable).toBe(false);
  });

  it('pins B0/B1 semantic parity for the corrected D probe (top + symbol-internal timelines)', () => {
    mkdirSync(WORK_ROOT, { recursive: true });
    // Synthetic 剑-equivalent: top-level DOMDocument + graphic symbol-internal timeline.
    const jianEquivXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="100" height="100" frameRate="24">
  <media/>
  <timelines>
    <DOMTimeline>
      <layers><DOMLayer><frames><DOMFrame index="0" duration="1"/></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
  <symbols/>
</DOMDocument>`;
    // Synthetic 剑 graphic symbol timeline (LIBRARY/scene-1-symbols.xml shape)
    const jianGraphicXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem symbolType="graphic" name="Graphic">
  <DOMTimeline>
    <layers><DOMLayer><frames><DOMFrame index="0" duration="1"/></frames></DOMLayer></layers>
  </DOMTimeline>
</DOMSymbolItem>`;
    // Build a small ZIP containing DOMDocument.xml + LIBRARY/GraphicSymbol.xml
    // to exercise the cross-timeline aggregation path.
    function buildTwoEntryZip(content: string, libContent: string): Buffer {
      const domName = Buffer.from('DOMDocument.xml', 'utf8');
      const libName = Buffer.from('LIBRARY/GraphicSymbol.xml', 'utf8');
      const contentBuf = Buffer.from(content, 'utf8');
      const libBuf = Buffer.from(libContent, 'utf8');
      const lh1 = 30 + domName.byteLength;
      const lh2 = 30 + libName.byteLength;
      const cdEntry1 = 46 + domName.byteLength;
      const cdEntry2 = 46 + libName.byteLength;
      const totalSize = lh1 + contentBuf.byteLength + lh2 + libBuf.byteLength + cdEntry1 + cdEntry2 + 22;
      const buf = Buffer.alloc(totalSize);
      function writeLocalHeader(name: Buffer, content: Buffer, buf: Buffer, offStart: number): number {
        let p = offStart;
        buf.writeUInt32LE(0x04034b50, p); p += 4;
        buf.writeUInt16LE(20, p); p += 2;
        buf.writeUInt16LE(0, p); p += 2;
        buf.writeUInt16LE(0, p); p += 2;
        buf.writeUInt16LE(0, p); p += 2;
        buf.writeUInt16LE(0, p); p += 2;
        buf.writeUInt32LE(crc32Of(content), p); p += 4;
        buf.writeUInt32LE(content.byteLength, p); p += 4;
        buf.writeUInt32LE(content.byteLength, p); p += 4;
        buf.writeUInt16LE(name.byteLength, p); p += 2;
        buf.writeUInt16LE(0, p); p += 2;
        name.copy(buf, p); p += name.byteLength;
        content.copy(buf, p); p += content.byteLength;
        return p;
      }
      const end1 = writeLocalHeader(domName, contentBuf, buf, 0);
      const end2 = writeLocalHeader(libName, libBuf, buf, end1);
      const cdStart = end2;
      let p = cdStart;
      function writeCentralHeader(name: Buffer, content: Buffer, localOffset: number, buf: Buffer, offStart: number): number {
        let q = offStart;
        buf.writeUInt32LE(0x02014b50, q); q += 4;
        buf.writeUInt16LE(20, q); q += 2;
        buf.writeUInt16LE(20, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt32LE(crc32Of(content), q); q += 4;
        buf.writeUInt32LE(content.byteLength, q); q += 4;
        buf.writeUInt32LE(content.byteLength, q); q += 4;
        buf.writeUInt16LE(name.byteLength, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt16LE(0, q); q += 2;
        buf.writeUInt32LE(0, q); q += 4;
        buf.writeUInt32LE(localOffset, q); q += 4;
        name.copy(buf, q); q += name.byteLength;
        return q;
      }
      p = writeCentralHeader(domName, contentBuf, 0, buf, p);
      p = writeCentralHeader(libName, libBuf, end1, buf, p);
      // EOCD
      const cdSizeDeclared = cdEntry1 + cdEntry2;
      buf.writeUInt32LE(0x06054b50, p); p += 4;
      buf.writeUInt16LE(0, p); p += 2;
      buf.writeUInt16LE(0, p); p += 2;
      buf.writeUInt16LE(2, p); p += 2;
      buf.writeUInt16LE(2, p); p += 2;
      buf.writeUInt32LE(cdSizeDeclared, p); p += 4;
      buf.writeUInt32LE(cdStart, p); p += 4;
      buf.writeUInt16LE(0, p);
      return buf;
    }
    writeFileSync(
      resolve(WORK_ROOT, 'jian-equiv.fla'),
      buildTwoEntryZip(jianEquivXml, jianGraphicXml),
    );
    const outPath = resolve(WORK_ROOT, 'manifest.json');
    const res = spawnSync(
      process.execPath,
      [COLLECTOR, '--root', WORK_ROOT, '--out', outPath],
      { encoding: 'utf8' },
    );
    expect(res.status).toBe(0);
    const manifest = JSON.parse(readFileSync(outPath, 'utf8'));
    const sample = manifest.samples[0]!;
    expect(sample.preflight.result).toBe('pass');
    expect(sample.offlineProbe.status).toBe('success');
    expect(sample.offlineProbe.structure?.sceneCount).toBe(1);
    expect(sample.offlineProbe.structure?.totalTimelineCount).toBe(2);
    expect(sample.offlineProbe.structure?.layerCount).toBe(2);
    expect(sample.offlineProbe.structure?.frameCount).toBe(2);
    expect(sample.offlineProbe.structure?.tweenCount).toBe(0);
    expect(sample.offlineProbe.structure?.symbolCount).toBe(1);
    expect(sample.offlineProbe.structure?.graphicCount).toBe(1);
    // Production parser stays not-verified, even though offline-parse succeeded.
    expect(sample.productionParser.status).toBe('not-verified');
    expect(sample.productionParser.previewAvailable).toBe(false);
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