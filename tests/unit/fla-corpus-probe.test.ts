/**
 * FLA V1.5-D corpus probe — pure-JS helper unit tests.
 *
 * No real-corpus side effects; deterministic XML fixtures only.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error -- .cjs runtime, types via ./fla-corpus-probe.d.ts
import probe from '../helpers/fla-corpus-probe.cjs';

const SYNTHETIC_PASS_XFL = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="1920" height="1080" frameRate="30">
  <media>
    <DOMBitmapItem name="bm0" href="bin/M 1 1.dat"/>
    <DOMBitmapItem name="bm1" href="bin/M 1 2.dat"/>
  </media>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Layer 1" visible="true">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="1">
              <elements>
                <DOMBitmapInstance libraryItemName="bm0"/>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
  <symbols/>
</DOMDocument>`;

const SYNTHETIC_ZERO_RASTER_XFL = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="100" height="100" frameRate="24">
  <media/>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Layer 1">
          <frames>
            <DOMFrame index="0" duration="1"/>
            <DOMFrame index="1" duration="1"/>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
  <symbols/>
</DOMDocument>`;

describe('fla-corpus-probe — detectEocdDiscrepancy', () => {
  it('reports clean EOCD when central directory matches declared size', () => {
    // A minimal valid ZIP with zero entries: EOCD only.
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(0, 8); // entries on this disk
    eocd.writeUInt16LE(0, 10);
    eocd.writeUInt32LE(0, 12); // CD size
    eocd.writeUInt32LE(0, 16); // CD offset
    eocd.writeUInt16LE(0, 20); // comment length
    const evidence = probe.detectEocdDiscrepancy(eocd);
    expect(evidence.eocdFound).toBe(true);
    expect(evidence.centralDirectoryDeltaBytes).toBe(0);
    expect(evidence.cdEndsExactlyAtEocd).toBe(true);
  });
});

describe('fla-corpus-probe — classifyContainer', () => {
  it('classifies +54 delta as archive-malformed reject (declared > actual)', () => {
    const r = probe.classifyContainer({
      eocdEvidence: {
        eocdFound: true,
        centralDirectoryDeclaredBytes: 154,
        centralDirectoryActualBytes: 100,
        centralDirectoryDeltaBytes: 54,
        cdEndsExactlyAtEocd: false,
        zip64Indicator: false,
        encryptionIndicator: false,
      },
      hasDomDocument: true,
      entryCount: 0,
      domDocumentXml: '',
      libraryXmlEntries: [],
      rejectedBeforeJszip: false,
    });
    expect(r.preflightResult).toBe('reject');
    expect(r.preflightReasonCategory).toBe('archive-malformed');
  });

  it('classifies clean EOCD + DOMDocument as pass', () => {
    const r = probe.classifyContainer({
      eocdEvidence: {
        eocdFound: true,
        centralDirectoryDeclaredBytes: 100,
        centralDirectoryActualBytes: 100,
        centralDirectoryDeltaBytes: 0,
        cdEndsExactlyAtEocd: true,
        zip64Indicator: false,
        encryptionIndicator: false,
      },
      hasDomDocument: true,
      entryCount: 1,
      domDocumentXml: '<DOMDocument/>',
      libraryXmlEntries: [],
      rejectedBeforeJszip: false,
    });
    expect(r.preflightResult).toBe('pass');
    expect(r.preflightReasonCategory).toBeNull();
  });

  it('classifies missing DOMDocument as reject', () => {
    const r = probe.classifyContainer({
      eocdEvidence: {
        eocdFound: false,
        centralDirectoryDeclaredBytes: null,
        centralDirectoryActualBytes: null,
        centralDirectoryDeltaBytes: null,
        cdEndsExactlyAtEocd: null,
        zip64Indicator: null,
        encryptionIndicator: null,
      },
      hasDomDocument: false,
      entryCount: 0,
      domDocumentXml: '',
      libraryXmlEntries: [],
      rejectedBeforeJszip: false,
    });
    expect(r.preflightResult).toBe('reject');
    expect(r.preflightReasonCategory).toBe('archive-malformed');
  });

  it('classifies rejected-before-jszip samples as archive-malformed reject', () => {
    const r = probe.classifyContainer({
      eocdEvidence: {
        eocdFound: true,
        centralDirectoryDeclaredBytes: 154,
        centralDirectoryActualBytes: 100,
        centralDirectoryDeltaBytes: 54,
        cdEndsExactlyAtEocd: false,
        zip64Indicator: false,
        encryptionIndicator: false,
      },
      hasDomDocument: false,
      entryCount: 0,
      domDocumentXml: '',
      libraryXmlEntries: [],
      rejectedBeforeJszip: true,
    });
    expect(r.preflightResult).toBe('reject');
    expect(r.preflightReasonCategory).toBe('archive-malformed');
  });
});

describe('fla-corpus-probe — probeStructure', () => {
  it('counts bitmap placements and library-only media on a synthetic PASS sample', () => {
    const structure = probe.probeStructure(SYNTHETIC_PASS_XFL, []);
    expect(structure).toEqual({
      sceneCount: 1,
      totalTimelineCount: 1,
      layerCount: 1,
      frameCount: 1,
      tweenCount: 0,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
      bitmapMediaCount: 2,
      placedInstanceCount: 1,
      libraryOnlyMediaCount: 1,
    });
  });

  it('treats zero-raster + non-empty structure as zero-raster (not empty)', () => {
    const structure = probe.probeStructure(SYNTHETIC_ZERO_RASTER_XFL, []);
    expect(structure.sceneCount).toBe(1);
    expect(structure.frameCount).toBe(2);
    expect(structure.tweenCount).toBe(0);
    expect(structure.bitmapMediaCount).toBe(0);
    expect(structure.placedInstanceCount).toBe(0);
  });

  it('uses #278-corrected tweenCount semantics (narrow B0; ignores tweens / morphShape)', () => {
    const xmlWithFakeTween = `<?xml version="1.0"?>
<DOMDocument>
  <media/>
  <timelines>
    <DOMTimeline>
      <layers>
        <DOMLayer>
          <frames>
            <DOMFrame index="0" duration="1" tweenType="none">
              <Ease/>
              <CustomEase/>
            </DOMFrame>
            <DOMFrame index="1" duration="1" tweenType="motion"/>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
    const structure = probe.probeStructure(xmlWithFakeTween, []);
    expect(structure.frameCount).toBe(2);
    expect(structure.tweenCount).toBe(1); // only the motion tweenType, not the <Ease> children
  });

  it('aggregates symbol-type counts from LIBRARY/*.xml entries', () => {
    const structure = probe.probeStructure(SYNTHETIC_ZERO_RASTER_XFL, [
      `<?xml version="1.0"?><DOMSymbolItem symbolType="graphic" name="g1"><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0" duration="1"/></DOMLayer></layers></DOMTimeline></DOMSymbolItem>`,
      `<?xml version="1.0"?><DOMSymbolItem symbolType="movieclip" name="mc1"/>`,
      `<?xml version="1.0"?><DOMSymbolItem symbolType="button" name="b1"/>`,
      `<?xml version="1.0"?><DOMBitmapItem name="bmx"/>`,
    ]);
    expect(structure.graphicCount).toBe(1);
    expect(structure.movieClipCount).toBe(1);
    expect(structure.buttonCount).toBe(1);
    expect(structure.symbolCount).toBe(3);
    // DOMDocument has no <DOMBitmapItem>, but the LIBRARY xml does include
    // a single bitmap reference (bmx) — exactly the kind of placement that
    // distinguishes "placed vs library-only" downstream.
    expect(structure.bitmapMediaCount).toBe(1);
    expect(structure.libraryOnlyMediaCount).toBe(1);
    expect(structure.placedInstanceCount).toBe(0);
  });
});

describe('fla-corpus-probe — inspectSample end-to-end on synthetic ZIP', () => {
  // Build a minimal valid ZIP with one entry (DOMDocument.xml) so jszip can
  // open it. We construct it byte-for-byte to keep the test deterministic.
  function buildMinimalZip(content: string) {
    const contentBuf = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from('DOMDocument.xml', 'utf8');
    const localHeaderSize = 30 + nameBuf.byteLength;
    const centralEntrySize = 46 + nameBuf.byteLength;
    const totalSize = localHeaderSize + contentBuf.byteLength + centralEntrySize + 22;

    const buf = Buffer.alloc(totalSize);
    let off = 0;
    // Local file header
    buf.writeUInt32LE(0x04034b50, off); off += 4;
    buf.writeUInt16LE(20, off); off += 2; // version needed
    buf.writeUInt16LE(0, off); off += 2; // flags
    buf.writeUInt16LE(0, off); off += 2; // compression (store)
    buf.writeUInt16LE(0, off); off += 2; // mod time
    buf.writeUInt16LE(0, off); off += 2; // mod date
    buf.writeUInt32LE(crc32Of(contentBuf), off); off += 4;
    buf.writeUInt32LE(contentBuf.byteLength, off); off += 4; // compressed
    buf.writeUInt32LE(contentBuf.byteLength, off); off += 4; // uncompressed
    buf.writeUInt16LE(nameBuf.byteLength, off); off += 2;
    buf.writeUInt16LE(0, off); off += 2; // extra length
    nameBuf.copy(buf, off); off += nameBuf.byteLength;
    contentBuf.copy(buf, off); off += contentBuf.byteLength;

    const localEnd = off;
    // Central directory header
    buf.writeUInt32LE(0x02014b50, off); off += 4;
    buf.writeUInt16LE(20, off); off += 2; // version made by
    buf.writeUInt16LE(20, off); off += 2; // version needed
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

    // EOCD
    buf.writeUInt32LE(0x06054b50, off); off += 4;
    buf.writeUInt16LE(0, off); off += 2;
    buf.writeUInt16LE(0, off); off += 2;
    buf.writeUInt16LE(1, off); off += 2;
    buf.writeUInt16LE(1, off); off += 2;
    buf.writeUInt32LE(centralEntrySize, off); off += 4;
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

  it('produces a normalized sample record with the corrected B1 structural facts', async () => {
    const zip = buildMinimalZip(SYNTHETIC_PASS_XFL);
    const record = await probe.inspectSample(
      new Uint8Array(zip),
      'synthetic.fla',
      'synthetic-fixture',
      ['raster-heavy'],
      '',
    );
    expect(record.evidenceOrigin).toBe('synthetic-fixture');
    expect(record.preflight.result).toBe('pass');
    expect(record.preflight.reasonCategory).toBeNull();
    expect(record.parserReached).toBe(true);
    expect(record.structure?.frameCount).toBe(1); // corrected B1 semantics
    expect(record.structure?.tweenCount).toBe(0);
    expect(record.raster?.bitmapMediaCount).toBe(2);
    expect(record.raster?.placedInstanceCount).toBe(1);
    expect(record.raster?.libraryOnlyMediaCount).toBe(1);
    expect(record.previewAvailable).toBe(true);
    expect(record.sourceUnchanged).toBe('verified');
  });

  it('keeps source files untouched (record never carries byte mutation)', async () => {
    const zip = buildMinimalZip(SYNTHETIC_ZERO_RASTER_XFL);
    const before = Buffer.from(zip);
    await probe.inspectSample(
      new Uint8Array(zip),
      'synthetic-zero.fla',
      'synthetic-fixture',
      ['zero-raster'],
      '',
    );
    expect(zip.equals(before)).toBe(true);
  });
});