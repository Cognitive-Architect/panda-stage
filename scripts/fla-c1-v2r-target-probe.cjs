#!/usr/bin/env node
/**
 * Optional C1 Phase-E bridge to the exact PR #285 V2-R target catalog.
 *
 * The builder is supplied as a compiled module from a separate, detached
 * checkout of PR #285. This script only passes original bytes or a
 * C1-compensated in-memory copy to that existing catalog function. It never
 * changes PR #285, production routing, or the approved source corpus.
 */

'use strict';

const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');
const { sha256, inspectZipBoundary, compensateKnownMismatch, KNOWN_RECOVERY_DELTA } = require('./fla-c1-recovery-evidence.cjs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') {
      args.root = argv[index + 1];
      index += 1;
    } else if (value === '--builder') {
      args.builder = argv[index + 1];
      index += 1;
    } else if (value === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fla'))
    .map((entry) => resolve(root, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en-US'));
}

function safeTarget(entry) {
  const target = entry.target || {};
  return {
    renderTargetId: target.renderTargetId,
    kind: target.kind,
    userLabel: target.userLabel,
    sourceLibraryItemName: target.sourceLibraryItemName,
    sourceTimelineIndex: target.sourceTimelineIndex,
    sourceSymbolName: target.sourceSymbolName,
    frameCount: target.frameCount,
    compatibility: target.compatibility,
    previewSupported: entry.previewSupported,
    unsupportedReason: entry.unsupportedReason,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.builder || !args.out) {
    process.stderr.write(
      'Usage: node scripts/fla-c1-v2r-target-probe.cjs --root "<approved-root>" --builder "<PR285-compiled-builder.js>" --out "<targets.json>"\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  if (![args.root, args.builder, args.out].every(isAbsolute)) {
    throw new Error('C1 target probe requires absolute --root, --builder and --out paths');
  }
  const root = resolve(args.root);
  const out = resolve(args.out);
  const builderPath = resolve(args.builder);
  if (!statSync(root).isDirectory()) throw new Error(`Approved root is not a directory: ${root}`);
  if (!existsSync(builderPath)) throw new Error(`PR #285 compiled builder is missing: ${builderPath}`);
  const builder = require(builderPath);
  if (typeof builder.buildRenderableTargetCatalog !== 'function') {
    throw new Error('The supplied builder does not expose buildRenderableTargetCatalog');
  }
  const samples = [];
  for (const filePath of listFiles(root)) {
    const bytes = readFileSync(filePath);
    const originalSha256 = sha256(bytes);
    const boundary = inspectZipBoundary(bytes);
    const compensation = compensateKnownMismatch(bytes, boundary);
    const input = compensation.applied ? compensation.bytes : bytes;
    const inputKind = compensation.applied ? 'research-copy-compensated-in-memory' : 'original-strict-pass-or-not-compensated';
    let result;
    try {
      const catalog = await builder.buildRenderableTargetCatalog(input);
      if (catalog.ok) {
        result = {
          status: 'success',
          renderableTargetCount: catalog.entries.length,
          summary: catalog.summary,
          entries: catalog.entries.map(safeTarget),
        };
      } else {
        result = {
          status: 'failure',
          renderableTargetCount: 0,
          error: { code: catalog.code, message: catalog.message },
        };
      }
    } catch (error) {
      result = {
        status: 'failure',
        renderableTargetCount: 0,
        error: { message: String(error && error.message ? error.message : error) },
      };
    }
    samples.push({
      basename: filePath.split(/[\\/]/).pop(),
      originalSha256,
      originalDeltaBytes: boundary.centralDirectoryDeltaBytes,
      compensationApplied: compensation.applied,
      compensationDeltaExpected: KNOWN_RECOVERY_DELTA,
      inputKind,
      exactPr285Builder: builderPath,
      ...result,
    });
  }
  const manifest = {
    schemaVersion: '1.0.0-c1-v2r-targets',
    generatedAt: new Date().toISOString(),
    codeHeadPolicy: 'exact PR #285 HEAD only; builder supplied by detached validation checkout',
    productionRoutingChanged: 'NO',
    samples,
  };
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`fla-c1-v2r-target-probe: wrote ${samples.length} samples -> ${out}\n`);
}

main().catch((error) => {
  process.stderr.write(`fla-c1-v2r-target-probe: ${error.stack || error.message}\n`);
  process.exit(1);
});
