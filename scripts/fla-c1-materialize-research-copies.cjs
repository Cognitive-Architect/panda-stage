#!/usr/bin/env node
/**
 * C1-only helper that materializes measured compensations outside the source
 * corpus so the real Electron parser can inspect them. The copies are
 * disposable research outputs, never production assets and never tracked.
 */

'use strict';

const { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');
const { compensateKnownMismatch, inspectZipBoundary, sha256 } = require('./fla-c1-recovery-evidence.cjs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') {
      args.root = argv[index + 1];
      index += 1;
    } else if (value === '--out-dir') {
      args.outDir = argv[index + 1];
      index += 1;
    } else if (value === '--manifest') {
      args.manifest = argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.outDir || !args.manifest) {
    process.stderr.write(
      'Usage: node scripts/fla-c1-materialize-research-copies.cjs --root "<approved-root>" --out-dir "<disposable-copy-dir>" --manifest "<manifest.json>"\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  if (![args.root, args.outDir, args.manifest].every(isAbsolute)) {
    throw new Error('C1 copy materialization requires absolute paths');
  }
  const root = resolve(args.root);
  const outDir = resolve(args.outDir);
  const manifestPath = resolve(args.manifest);
  if (!statSync(root).isDirectory()) throw new Error(`Approved root is not a directory: ${root}`);
  if (outDir === root || outDir.startsWith(`${root}\\`)) {
    throw new Error('Research copies must be outside the approved source root');
  }
  mkdirSync(outDir, { recursive: true });
  const samples = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.fla')).sort((a, b) => a.name.localeCompare(b.name, 'en-US'))) {
    const sourcePath = resolve(root, entry.name);
    const sourceBytes = readFileSync(sourcePath);
    const originalSha256 = sha256(sourceBytes);
    const boundary = inspectZipBoundary(sourceBytes);
    const compensation = compensateKnownMismatch(sourceBytes, boundary);
    if (!compensation.applied) continue;
    const sampleId = `fla-${originalSha256.slice(0, 16).toLowerCase()}`;
    const copyPath = resolve(outDir, `${sampleId}.research-copy.fla`);
    if (existsSync(copyPath)) {
      throw new Error(`Refusing to overwrite an existing research copy: ${copyPath}`);
    }
    writeFileSync(copyPath, compensation.bytes);
    samples.push({
      sampleId,
      originalBasename: entry.name,
      originalSha256,
      compensatedCopyPath: copyPath,
      compensatedCopySha256: sha256(compensation.bytes),
      originalFilesWritten: false,
      normalization: {
        field: compensation.field,
        offset: compensation.offset,
        from: compensation.from,
        to: compensation.to,
        deltaBytes: compensation.deltaBytes,
        mode: compensation.mode,
      },
    });
  }
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: '1.0.0-c1-research-copies',
    sourceRootPolicy: 'approved source root read-only',
    disposableOutputPolicy: 'all files in this directory are Panda/research-owned temporary copies',
    samples,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`fla-c1-materialize-research-copies: wrote ${samples.length} copies -> ${outDir}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`fla-c1-materialize-research-copies: ${error.stack || error.message}\n`);
  process.exit(1);
}
