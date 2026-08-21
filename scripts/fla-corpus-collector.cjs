#!/usr/bin/env node
// @ts-check
/**
 * FLA V1.5-D corpus collector (CLI).
 *
 * Read-only evidence harness that scans an explicitly approved corpus
 * directory for `.fla` files and emits a normalized manifest JSON.
 *
 * Hard rules (per Issue #279):
 *   - `--root` must be provided; the collector does NOT crawl beyond it.
 *   - The collector never rewrites originals.
 *   - The manifest never stores absolute filesystem paths (privacy).
 *   - Hashes are deterministic; duplicates are deduplicated by SHA-256.
 *   - Output is JSON, suitable for Git diff/review.
 *
 * Usage:
 *   node scripts/fla-corpus-collector.cjs --root "D:\\表情合集" \
 *                                        --out docs/research/fla-corpus-manifest.json
 */

'use strict';

const { readdirSync, readFileSync, writeFileSync, statSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const probe = require('../tests/helpers/fla-corpus-probe.cjs');

const VERSION = '1.1.0';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') {
      out.root = argv[i + 1];
      i += 1;
    } else if (a === '--out') {
      out.out = argv[i + 1];
      i += 1;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--seed-name') {
      // Optional override for the per-sample `basename` recorded in the
      // manifest. Useful for sanitized corpora where filenames are private.
      out.seedName = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function listFlaFiles(root) {
  // Top-level only: the collector does not recursively crawl. This matches
  // Issue #279 §B's "do not recursively crawl the user's whole disk".
  const entries = readdirSync(root, { withFileTypes: true });
  return entries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.fla'))
    .map((d) => resolve(root, d.name));
}

function sha256Hex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.out) {
    process.stderr.write(
      [
        'fla-corpus-collector --root "<explicit corpus root>" --out "<manifest path>"',
        '',
        'Reads .fla files from <root> (top-level only) and emits a',
        'normalized JSON manifest. Never writes to <root>.',
        '',
      ].join('\n'),
    );
    process.exit(args.help ? 0 : 2);
  }

  const root = resolve(args.root);
  const stat = statSync(root);
  if (!stat.isDirectory()) {
    process.stderr.write(`fla-corpus-collector: --root is not a directory: ${root}\n`);
    process.exit(2);
  }

  const flaFiles = listFlaFiles(root);
  const records = [];
  const dedupeMap = new Map();
  for (const filePath of flaFiles) {
    let bytes;
    try {
      bytes = readFileSync(filePath);
    } catch (err) {
      process.stderr.write(`skip (read): ${filePath} :: ${err.message}\n`);
      continue;
    }
    let record;
    try {
      record = await probe.inspectSample(
        bytes,
        args.seedName ? args.seedName : filePath.split(/[\\/]/).pop(),
        'external-original',
        [],
        '',
      );
    } catch (err) {
      // Errors here mean the file is unreadable as a FLA — record a stub.
      const sha = sha256Hex(bytes).toUpperCase();
      record = {
        sampleId: `fla-${sha.slice(0, 16).toLowerCase()}`,
        basename: filePath.split(/[\\/]/).pop(),
        sha256: sha,
        byteLength: bytes.byteLength,
        containerFamily: 'ZIP/XFL',
        evidenceOrigin: 'external-original',
        categoryTags: [],
        preflight: {
          result: 'reject',
          reasonCategory: 'archive-malformed',
          centralDirectoryDeclaredBytes: null,
          centralDirectoryActualBytes: null,
          centralDirectoryDeltaBytes: null,
          cdEndsExactlyAtEocd: null,
          zip64Indicator: null,
          encryptionIndicator: null,
        },
        offlineProbe: {
          status: 'error',
          raster: null,
          structure: null,
        },
        productionParser: {
          status: 'not-verified',
          previewAvailable: false,
        },
        sourceUnchanged: 'verified',
        notes: `corpus-probe threw: ${(err && err.message) || String(err)}`,
      };
    }
    // Privacy: strip any absolute path leaks.
    record.basename = record.basename.split(/[\\/]/).pop();
    delete record.filePath;
    const prior = dedupeMap.get(record.sha256);
    if (prior) {
      prior.notes = (prior.notes || '') + ` | duplicate-of:${record.sampleId}`;
      continue;
    }
    dedupeMap.set(record.sha256, record);
    records.push(record);
  }

  const totals = {
    samples: records.length,
    byPreflight: {
      pass: records.filter((r) => r.preflight.result === 'pass').length,
      reject: records.filter((r) => r.preflight.result === 'reject').length,
    },
    byOrigin: {},
    byEvidenceShape: {
      offlineStrictPass: 0,
      offlineStructEmpty: 0,
      parserNotVerified: 0,
    },
  };
  for (const r of records) {
    totals.byOrigin[r.evidenceOrigin] = (totals.byOrigin[r.evidenceOrigin] || 0) + 1;
    // Issue #280 corrective item 3: evidence shape now keys on the offline-probe
    // status, since `productionParser.status` is hard-pinned to `'not-verified'`
    // by the offline-only helper.
    if (r.offlineProbe.status !== 'success') {
      totals.byEvidenceShape.parserNotVerified += 1;
    } else if (r.offlineProbe.raster && r.offlineProbe.raster.bitmapMediaCount > 0) {
      totals.byEvidenceShape.offlineStrictPass += 1;
    } else {
      totals.byEvidenceShape.offlineStructEmpty += 1;
    }
  }

  // C readiness assessment (read-only evidence; no production tolerance).
  const plus54 = records.filter(
    (r) =>
      r.preflight.result === 'reject' &&
      r.preflight.centralDirectoryDeltaBytes === 54,
  );
  const cReadinessAssessment = {
    state:
      plus54.length === 0
        ? 'C_NOT_RELEVANT'
        : plus54.length === 1
          ? 'C_NOT_READY'
          : 'C_EVIDENCE_IMPROVED_BUT_STILL_BLOCKED',
    plus54FamilySampleCount: plus54.length,
    provenanceGrouping: 'single-seed-bundle',
    negativeEdgeCoverage: [
      'preflight_reject_eocd_cd_size_overdeclare',
      'preflight_reject_no_domdocument',
      'zero_raster_structural_not_empty',
    ],
    stillMissingEvidence: [
      'additional independent real originals beyond the seed six',
      'parser-runtime end-to-end on strict-PASS samples (pending GUI runner)',
      'cross-producer +54 family provenance grouping',
    ],
  };

  const manifest = {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    command: `node scripts/fla-corpus-collector.cjs --root "<seed-root>" --out "${args.out}"`,
    totals,
    cReadinessAssessment,
    samples: records,
  };

  writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `fla-corpus-collector: wrote ${records.length} samples -> ${args.out}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fla-corpus-collector: ${err.stack || err.message}\n`);
  process.exit(1);
});