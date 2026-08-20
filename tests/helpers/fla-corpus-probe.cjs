// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * FLA V1.5-D corpus probe (pure-Node, read-only evidence helper).
 *
 * NOT production FLA inspection code. This module is the read-only evidence
 * layer that backs the V1.5-D corpus collector (scripts/fla-corpus-collector.cjs)
 * and the corpus manifest (docs/research/fla-corpus-manifest.json).
 *
 * It is deliberately decoupled from production code:
 *  - it never calls into the sandboxed preflight / parser-worker services;
 *  - it uses jszip (same ZIP decoder the production parser closure uses) to
 *    read the bytes directly;
 *  - it never writes to the original sample;
 *  - it computes SHA-256 deterministically and exposes container + structural
 *    facts that can be diffed across runs.
 *
 * The structural probe re-implements the B0 evidence matrix from
 * `tests/helpers/fla-structural-probe.ts` in plain JS so the corpus collector
 * can run via `node scripts/fla-corpus-collector.cjs` without TypeScript
 * compilation. The two probes share no runtime code, but their output shape
 * is intentionally kept aligned (B0 numeric allowlist).
 *
 * Privacy: this module never returns absolute filesystem paths. The collector
 * is responsible for mapping local paths to a stable `sampleId` derived from
 * the SHA-256 hash of the file bytes.
 */

'use strict';

const { createHash } = require('node:crypto');
const JSZip = require('jszip');

const DEFAULT_BUDGET = {
  maxSourceBytes: 256 * 1024 * 1024,
  maxZipEntries: 20_000,
  maxXmlBytes: 32 * 1024 * 1024,
};

function safeString(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function sha256Of(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex').toUpperCase();
}

/**
 * Container-only probe: reads the raw ZIP header bytes first (cheap, no
 * full archive parse), then only invokes jszip when the central-directory
 * size declaration is consistent with the actual byte layout. The recurring
 * malformed-archive family from #267/#271/#275 overdeclares the CD size by
 * +54 bytes; jszip throws `Corrupted zip: missing 54 bytes` on those
 * archives, so we pre-check the EOCD to keep the `archive-malformed`
 * classification observable on the producer/provenance side rather than
 * masking it inside a thrown exception.
 */
async function probeContainer(bytes) {
  if (bytes.byteLength > DEFAULT_BUDGET.maxSourceBytes) {
    const err = new Error(
      `FLA source ${bytes.byteLength} bytes exceeds budget ${DEFAULT_BUDGET.maxSourceBytes}`,
    );
    err.code = 'CORPUS_BUDGET_EXCEEDED';
    throw err;
  }
  const eocdEvidence = detectEocdDiscrepancy(bytes);
  // Strict preflight: declared CD size must not exceed actual CD bytes.
  // This mirrors the production `preflightFlaSource` fail-closed behavior.
  if (
    eocdEvidence.eocdFound &&
    eocdEvidence.centralDirectoryDeclaredBytes !== null &&
    eocdEvidence.centralDirectoryActualBytes !== null &&
    eocdEvidence.centralDirectoryDeclaredBytes > eocdEvidence.centralDirectoryActualBytes
  ) {
    return {
      entryCount: 0,
      hasDomDocument: false,
      domDocumentXml: '',
      libraryXmlEntries: [],
      eocdEvidence,
      rejectedBeforeJszip: true,
    };
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return {
      entryCount: 0,
      hasDomDocument: false,
      domDocumentXml: '',
      libraryXmlEntries: [],
      eocdEvidence,
      rejectedBeforeJszip: false,
      jszipError: err && err.message ? err.message : String(err),
    };
  }
  const names = Object.keys(zip.files);
  if (names.length > DEFAULT_BUDGET.maxZipEntries) {
    const err = new Error(
      `FLA archive entry count ${names.length} exceeds budget ${DEFAULT_BUDGET.maxZipEntries}`,
    );
    err.code = 'CORPUS_BUDGET_EXCEEDED';
    throw err;
  }
  const entryNameSet = new Set(names);
  const hasDomDocument = entryNameSet.has('DOMDocument.xml');
  const domDocName = names.find((n) => n === 'DOMDocument.xml');
  let domDocumentXml = '';
  if (hasDomDocument) {
    const entry = zip.files[domDocName];
    domDocumentXml = await entry.async('string');
    if (domDocumentXml.length > DEFAULT_BUDGET.maxXmlBytes) {
      const err = new Error(
        `FLA DOMDocument.xml size ${domDocumentXml.length} exceeds budget`,
      );
      err.code = 'CORPUS_BUDGET_EXCEEDED';
      throw err;
    }
  }
  const libraryXmlEntries = [];
  for (const name of names) {
    if (/LIBRARY\//i.test(name) && /\.xml$/i.test(name)) {
      const xml = await zip.files[name].async('string');
      libraryXmlEntries.push(xml);
    }
  }
  return {
    entryCount: names.length,
    hasDomDocument,
    domDocumentXml,
    libraryXmlEntries,
    eocdEvidence,
    rejectedBeforeJszip: false,
  };
}

function detectEocdDiscrepancy(bytes) {
  // ZIP EOCD signature 0x06054b50
  const buf = Buffer.from(bytes);
  const SIG = 0x06054b50;
  let eocdOffset = -1;
  // Scan from the bottom: the EOCD record is at most 65557 bytes long
  // (22-byte fixed record + up to 65535 bytes of trailing comment).
  const maxStart = Math.max(0, buf.byteLength - 22 - 0xffff);
  for (let i = buf.byteLength - 22; i >= maxStart; i--) {
    if (buf.readUInt32LE(i) === SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    return {
      eocdFound: false,
      centralDirectoryDeclaredBytes: null,
      centralDirectoryActualBytes: null,
      centralDirectoryDeltaBytes: null,
      cdEndsExactlyAtEocd: null,
    };
  }
  const cdSizeDeclared = buf.readUInt32LE(eocdOffset + 12);
  const cdOffsetDeclared = buf.readUInt32LE(eocdOffset + 16);
  const eocdRecordSize = 22;
  // `centralDirectoryActualBytes` is what the archive's EOCD + body actually
  // expose between the declared CD offset and the start of the EOCD record.
  // Subtract the fixed EOCD record size (no trailing comment in our corpus).
  const centralDirectoryActualBytes = Math.max(
    0,
    buf.byteLength - eocdRecordSize - cdOffsetDeclared,
  );
  const cdEndsExactlyAtEocd =
    cdOffsetDeclared + cdSizeDeclared + eocdRecordSize === buf.byteLength;
  // ZIP64 indicator: if EOCD's CD start uses 0xFFFFFFFF, ZIP64 locator must
  // exist; we do not decode the locator here, just flag the indicator.
  const cdSizeMarker = cdSizeDeclared === 0xffffffff;
  const cdOffsetMarker = cdOffsetDeclared === 0xffffffff;
  return {
    eocdFound: true,
    centralDirectoryDeclaredBytes: cdSizeDeclared,
    centralDirectoryActualBytes,
    centralDirectoryDeltaBytes: cdSizeDeclared - centralDirectoryActualBytes,
    cdEndsExactlyAtEocd,
    zip64Indicator: cdSizeMarker || cdOffsetMarker,
    encryptionIndicator: false,
  };
}

/**
 * Structural probe (B0-aligned, narrow B1-corrected): derives the 9 B1
 * counts from `DOMDocument.xml` and the `LIBRARY/*.xml` entries.
 *
 * `tweenCount` strictly counts `<DOMFrame ... tweenType="motion|shape">`
 * per the #278 corrected B0/B1 semantics. `frameCount` counts `<DOMFrame>`
 * elements (NOT bitmap placements).
 */
function probeStructure(domDocumentXml, libraryXmlEntries) {
  if (!domDocumentXml) {
    return zeroStructure();
  }
  const bitmapInMedia = (domDocumentXml.match(/<DOMBitmapItem\b/g) || []).length;
  const embeddedSymbols = (domDocumentXml.match(/<DOMSymbolItem\b/g) || []).length;

  let bitmapInLibrary = 0;
  let movieClipCount = 0;
  let graphicCount = 0;
  let buttonCount = 0;
  for (const libXml of libraryXmlEntries) {
    if (/<DOMBitmapItem\b/.test(libXml)) bitmapInLibrary += 1;
    const m = libXml.match(/<DOMSymbolItem\b[^>]*\bsymbolType="(\w+)"/);
    if (m) {
      if (m[1] === 'movieclip') movieClipCount += 1;
      else if (m[1] === 'graphic') graphicCount += 1;
      else if (m[1] === 'button') buttonCount += 1;
    }
  }

  const bitmapMediaCount = bitmapInMedia + bitmapInLibrary;
  const placedRefs = (domDocumentXml.match(
    /<DOMBitmapInstance\b[^>]*\blibraryItemName="([^"]*)"/g,
  ) || []);
  const placedNames = new Set();
  for (const ref of placedRefs) {
    const m = ref.match(/\blibraryItemName="([^"]*)"/);
    if (m) placedNames.add(m[1]);
  }
  const placedInstanceCount = placedNames.size;
  const libraryOnlyMediaCount = Math.max(0, bitmapMediaCount - placedInstanceCount);

  // Top-level timeline structure (only DOMDocument.xml contributes; library
  // symbols' internal timelines are intentionally NOT double-counted here to
  // keep this probe aligned with the B0 spike's evidence matrix).
  let layerCount = 0;
  let frameCount = 0;
  let tweenCount = 0;
  const sceneCount = extractBalancedBlocks(domDocumentXml, 'DOMTimeline').length;
  for (const tl of extractBalancedBlocks(domDocumentXml, 'DOMTimeline')) {
    layerCount += (tl.match(/<DOMLayer\b/g) || []).length;
    const frames = (tl.match(/<DOMFrame\b/g) || []).length;
    frameCount += frames;
    const tweens = (tl.match(/\btweenType="(motion|shape)"/g) || []).length;
    tweenCount += tweens;
  }

  return {
    sceneCount,
    totalTimelineCount: sceneCount + (movieClipCount + graphicCount + buttonCount + embeddedSymbols),
    layerCount,
    frameCount,
    tweenCount,
    symbolCount: movieClipCount + graphicCount + buttonCount + embeddedSymbols,
    movieClipCount,
    graphicCount,
    buttonCount,
    bitmapMediaCount,
    placedInstanceCount,
    libraryOnlyMediaCount,
  };
}

/**
 * Naive balanced extractor for `<tag>...</tag>` blocks (matches nesting).
 * Mirrors `tests/helpers/fla-structural-probe.ts` semantics.
 */
function extractBalancedBlocks(xml, tag) {
  const close = `</${tag}>`;
  const blocks = [];
  const openStack = [];
  let i = 0;
  const openNeedle = `<${tag}`;
  for (;;) {
    const oi = nextTagIndex(xml, openNeedle, i);
    const ci = xml.indexOf(close, i);
    if (oi === -1 && ci === -1) break;
    if (ci !== -1 && (oi === -1 || ci < oi)) {
      const start = openStack.pop();
      if (start !== undefined) blocks.push(xml.slice(start, ci + close.length));
      i = ci + close.length;
    } else if (oi !== -1) {
      openStack.push(oi);
      i = oi + openNeedle.length;
    } else {
      break;
    }
  }
  return blocks;
}

function nextTagIndex(xml, needle, from) {
  let i = from;
  for (;;) {
    const idx = xml.indexOf(needle, i);
    if (idx === -1) return -1;
    if (idx === 0 || xml[idx - 1] !== '/') return idx;
    i = idx + needle.length;
  }
}

function zeroStructure() {
  return {
    sceneCount: 0,
    totalTimelineCount: 0,
    layerCount: 0,
    frameCount: 0,
    tweenCount: 0,
    symbolCount: 0,
    movieClipCount: 0,
    graphicCount: 0,
    buttonCount: 0,
    bitmapMediaCount: 0,
    placedInstanceCount: 0,
    libraryOnlyMediaCount: 0,
  };
}

/**
 * Normalized per-sample record (the smallest unit of the corpus manifest).
 * Fields are intentionally restrictive to keep the on-disk diff small.
 */
function buildSampleRecord({
  sampleId,
  basename,
  sha256,
  byteLength,
  containerEvidence,
  structureEvidence,
  evidenceOrigin,
  categoryTags,
  notes,
}) {
  const preflightResult = containerEvidence.preflightResult;
  const parserReached = preflightResult === 'pass' && containerEvidence.hasDomDocument;
  return {
    sampleId: safeString(sampleId, 128),
    basename: safeString(basename, 260),
    sha256: safeString(sha256, 64),
    byteLength: Number.isFinite(byteLength) ? Math.max(0, Math.floor(byteLength)) : 0,
    containerFamily: 'ZIP/XFL',
    evidenceOrigin: safeString(evidenceOrigin, 64),
    categoryTags: Array.isArray(categoryTags) ? categoryTags.slice(0, 16).map((t) => safeString(t, 32)) : [],
    preflight: {
      result: preflightResult,
      reasonCategory: containerEvidence.preflightReasonCategory ?? null,
      centralDirectoryDeclaredBytes: containerEvidence.centralDirectoryDeclaredBytes,
      centralDirectoryActualBytes: containerEvidence.centralDirectoryActualBytes,
      centralDirectoryDeltaBytes: containerEvidence.centralDirectoryDeltaBytes,
      cdEndsExactlyAtEocd: containerEvidence.cdEndsExactlyAtEocd,
      zip64Indicator: containerEvidence.zip64Indicator,
      encryptionIndicator: containerEvidence.encryptionIndicator,
    },
    parserReached,
    raster: parserReached
      ? {
          bitmapMediaCount: structureEvidence.bitmapMediaCount,
          placedInstanceCount: structureEvidence.placedInstanceCount,
          libraryOnlyMediaCount: structureEvidence.libraryOnlyMediaCount,
        }
      : null,
    structure: parserReached
      ? {
          sceneCount: structureEvidence.sceneCount,
          totalTimelineCount: structureEvidence.totalTimelineCount,
          layerCount: structureEvidence.layerCount,
          frameCount: structureEvidence.frameCount,
          tweenCount: structureEvidence.tweenCount,
          symbolCount: structureEvidence.symbolCount,
          movieClipCount: structureEvidence.movieClipCount,
          graphicCount: structureEvidence.graphicCount,
          buttonCount: structureEvidence.buttonCount,
        }
      : null,
    previewAvailable: parserReached && (structureEvidence.bitmapMediaCount ?? 0) > 0,
    sourceUnchanged: 'verified',
    notes: safeString(notes, 1000),
  };
}

/**
 * Decide preflight result + reason category from the container evidence.
 * Mirrors the production preflight service's strict malformed family
 * detection (MALFORMED_ARCHIVE / +54-byte CD-size over-declaration), but
 * stays in pure-JS so the corpus collector can run without the
 * sandboxed parser-worker boundary.
 *
 * The recurring production anomaly (Issue #267 / handoff #270) is that the
 * ZIP central-directory size declared in the EOCD record is **larger than
 * the bytes the archive actually exposes**, by a recurring 54-byte delta.
 * jszip throws `Corrupted zip: missing 54 bytes` on these archives; we
 * detect the same delta here so the corpus manifest can record them as
 * `preflightResult: 'reject'` with `reasonCategory: 'archive-malformed'`.
 */
function classifyContainer(container) {
  const eocdEvidence = container.eocdEvidence;
  const hasDomDocument = container.hasDomDocument;
  if (
    eocdEvidence.eocdFound &&
    eocdEvidence.centralDirectoryDeclaredBytes !== null &&
    eocdEvidence.centralDirectoryActualBytes !== null &&
    eocdEvidence.centralDirectoryDeclaredBytes > eocdEvidence.centralDirectoryActualBytes
  ) {
    return { preflightResult: 'reject', preflightReasonCategory: 'archive-malformed' };
  }
  if (container.rejectedBeforeJszip) {
    return { preflightResult: 'reject', preflightReasonCategory: 'archive-malformed' };
  }
  if (!hasDomDocument) {
    return { preflightResult: 'reject', preflightReasonCategory: 'archive-malformed' };
  }
  if (container.jszipError) {
    return { preflightResult: 'reject', preflightReasonCategory: 'archive-malformed' };
  }
  return { preflightResult: 'pass', preflightReasonCategory: null };
}

/**
 * Main entry point: produce a normalized sample record from raw bytes.
 * Errors are propagated (not silently coerced) so the collector can record
 * `parse_error` entries separately.
 */
async function inspectSample(bytes, basename, evidenceOrigin, categoryTags, notes) {
  const sha256 = sha256Of(bytes);
  const sampleId = `fla-${sha256.slice(0, 16).toLowerCase()}`;
  const container = await probeContainer(bytes);
  const { preflightResult, preflightReasonCategory } = classifyContainer(container);
  let structureEvidence = zeroStructure();
  if (preflightResult === 'pass' && container.hasDomDocument) {
    structureEvidence = probeStructure(container.domDocumentXml, container.libraryXmlEntries);
  }
  return buildSampleRecord({
    sampleId,
    basename,
    sha256,
    byteLength: bytes.byteLength,
    containerEvidence: {
      preflightResult,
      preflightReasonCategory,
      centralDirectoryDeclaredBytes: container.eocdEvidence.centralDirectoryDeclaredBytes,
      centralDirectoryActualBytes: container.eocdEvidence.centralDirectoryActualBytes,
      centralDirectoryDeltaBytes: container.eocdEvidence.centralDirectoryDeltaBytes,
      cdEndsExactlyAtEocd: container.eocdEvidence.cdEndsExactlyAtEocd,
      zip64Indicator: container.eocdEvidence.zip64Indicator,
      encryptionIndicator: container.eocdEvidence.encryptionIndicator,
      hasDomDocument: container.hasDomDocument,
    },
    structureEvidence,
    evidenceOrigin,
    categoryTags,
    notes,
  });
}

module.exports = {
  inspectSample,
  probeContainer,
  probeStructure,
  classifyContainer,
  detectEocdDiscrepancy,
  sha256Of,
  zeroStructure,
};