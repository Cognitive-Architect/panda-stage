#!/usr/bin/env node
/** Run the C1 Electron parser probe for every materialized research copy. */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--copies-manifest') {
      args.copiesManifest = argv[index + 1];
      index += 1;
    } else if (value === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (value === '--logs') {
      args.logs = argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function parseJsonLine(stdout) {
  const lines = String(stdout).split(/\r?\n/u).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue looking for the one-line result after Electron diagnostics.
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.copiesManifest || !args.out) {
    process.stderr.write(
      'Usage: node scripts/fla-c1-run-electron-probes.cjs --copies-manifest "<copies.json>" --out "<results.json>" [--logs "<log-dir>"]\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  const manifestPath = resolve(args.copiesManifest);
  const outPath = resolve(args.out);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const logsDir = resolve(args.logs || join(dirname(outPath), 'electron-probe-logs'));
  const electronPath = require('electron');
  const probeScript = resolve(__dirname, 'fla-c1-electron-parser.cjs');
  const repoRoot = resolve(__dirname, '..');
  mkdirSync(logsDir, { recursive: true });
  const results = [];
  for (const sample of manifest.samples || []) {
    if (!existsSync(sample.compensatedCopyPath)) {
      results.push({
        originalSha256: sample.originalSha256,
        status: 'failure',
        reason: 'materialized research copy is missing',
      });
      continue;
    }
    const logBase = join(logsDir, sample.sampleId);
    const child = spawnSync(
      electronPath,
      [
        probeScript,
        '--source', sample.compensatedCopyPath,
        '--original-sha256', sample.originalSha256,
        '--user-data', `${logBase}-user-data`,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
        env: { ...process.env, VITE_DEV_SERVER_URL: '' },
      },
    );
    const stdout = String(child.stdout || '');
    const stderr = String(child.stderr || '');
    const result = parseJsonLine(stdout);
    writeFileSync(`${logBase}.stdout.log`, stdout, 'utf8');
    writeFileSync(`${logBase}.stderr.log`, stderr, 'utf8');
    // The production app can report a benign hidden-window cleanup race while
    // Electron is exiting after it has already emitted a valid inspection
    // result. The structured parser result is the authoritative evidence;
    // retain the non-zero exit as a warning instead of misclassifying the
    // completed inspection as a parser failure.
    if (result?.response?.ok === true) {
      results.push({
        originalSha256: sample.originalSha256,
        sampleId: sample.sampleId,
        status: 'success',
        processExitCode: child.status,
        cleanupWarning: child.status !== 0 || Boolean(child.signal),
        parser: result,
      });
    } else {
      results.push({
        originalSha256: sample.originalSha256,
        sampleId: sample.sampleId,
        status: 'failure',
        exitCode: child.status,
        signal: child.signal,
        timedOut: child.error?.code === 'ETIMEDOUT',
        stdoutTail: stdout.slice(-2_000),
        stderrTail: stderr.slice(-2_000),
      });
    }
  }
  writeFileSync(outPath, `${JSON.stringify({
    schemaVersion: '1.0.0-c1-electron-results',
    parserCodePolicy: 'current C1 checkout production parser path; no production source changes',
    projectMutation: 'none',
    results,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`fla-c1-run-electron-probes: wrote ${results.length} results -> ${outPath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`fla-c1-run-electron-probes: ${error.stack || error.message}\n`);
  process.exit(1);
}
