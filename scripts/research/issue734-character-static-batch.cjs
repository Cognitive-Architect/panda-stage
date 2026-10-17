#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join(ROOT, 'scripts/research/issue734-character-static-probe.cjs');
const MANIFEST_PATH = path.join(ROOT, 'docs/research/issue-732-cross-category-capability-census.json');
const ISSUE734_BASELINE = '93fe7fac21c6c0872eb92efba079c81abf611116';
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') args.out = argv[++index];
  }
  assert.ok(args.out, 'missing --out');
  return { out: path.resolve(args.out) };
}

function sha256File(filePath) {
  return HASH(fs.readFileSync(filePath));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function invokeProbe(fixture, outputPath) {
  const electronBinary = require('electron');
  const result = spawnSync(electronBinary, [
    PROBE,
    '--fixture-id', fixture.fixtureId,
    '--source', fixture.sourcePath,
    '--expected-sha256', fixture.sourceSha256,
    '--out', outputPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? '');
  const jsonLine = stdout.trim().split(/\r?\n/u).reverse()
    .find((line) => line.trimStart().startsWith('{'));
  return {
    exitCode: result.status,
    signal: result.signal,
    stderrTail: String(result.stderr ?? '').slice(-4_000),
    stdoutTail: stdout.slice(-2_000),
    receipt: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const relative = path.relative(ROOT, args.out);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #734 evidence must remain outside the repository');
  assert.ok(!fs.existsSync(args.out), `refusing to overwrite existing evidence directory: ${args.out}`);
  const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(baseline, ISSUE734_BASELINE, 'working HEAD differs from Issue #734 frozen baseline');
  const census = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(census.issue, 732, 'input is not the frozen Issue #732 corpus manifest');
  const fixtures = census.files.filter((fixture) => fixture.category === 'CHARACTER');
  assert.equal(fixtures.length, 11, 'frozen character corpus must contain exactly 11 sources');
  fs.mkdirSync(args.out, { recursive: false });

  const records = [];
  for (const [index, sourceFixture] of fixtures.entries()) {
    const fixture = {
      fixtureId: `character-${String(index + 1).padStart(2, '0')}`,
      filename: sourceFixture.filename,
      sourcePath: sourceFixture.sourcePath,
      sourceSha256: sourceFixture.sourceSha256,
    };
    assert.equal(sha256File(fixture.sourcePath), fixture.sourceSha256, `${fixture.filename} differs from frozen Issue #732 source SHA-256`);
    const outputPath = path.join(args.out, fixture.fixtureId);
    let probe;
    let failure = null;
    try {
      probe = invokeProbe(fixture, outputPath);
      if (probe.exitCode !== 0) failure = `Electron probe exited ${probe.exitCode ?? probe.signal ?? 'unknown'}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      probe = { exitCode: null, signal: null, stderrTail: '', stdoutTail: '', receipt: null };
    }
    const sourceSha256After = sha256File(fixture.sourcePath);
    assert.equal(sourceSha256After, fixture.sourceSha256, `${fixture.filename} source changed during batch`);
    const receiptPath = path.join(outputPath, 'static-truth-probe.json');
    const evidenceReceipt = fs.existsSync(receiptPath)
      ? JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
      : null;
    const record = {
      ...fixture,
      sourceSha256After,
      sourceHashUnchanged: sourceSha256After === fixture.sourceSha256,
      probeExitCode: probe.exitCode,
      failure,
      stderrTail: probe.stderrTail,
      stdoutTail: probe.stdoutTail,
      receiptPath: evidenceReceipt ? receiptPath : null,
      candidateCount: evidenceReceipt?.candidates?.length ?? probe.receipt?.candidateCount ?? null,
      renderedCount: evidenceReceipt?.candidates?.filter((candidate) => candidate.renderer.status === 'RENDERED').length ?? probe.receipt?.renderedCount ?? null,
      sceneRoots: evidenceReceipt?.sourceComposition?.sceneRoots ?? null,
      evidenceDirectory: outputPath,
    };
    writeJson(path.join(outputPath, 'batch-record.json'), record);
    records.push(record);
    process.stdout.write(`${index + 1}/11 ${fixture.filename}: candidates=${record.candidateCount ?? 'PROBE_FAILED'}, rendered=${record.renderedCount ?? 0}, failure=${failure ?? 'none'}\n`);
  }

  const batch = {
    schemaVersion: 'issue734-character-static-batch/1',
    issue: 734,
    baseline: ISSUE734_BASELINE,
    corpusManifest: 'docs/research/issue-732-cross-category-capability-census.json',
    sourceHashInvariant: records.every((record) => record.sourceHashUnchanged),
    fileCount: records.length,
    results: records,
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'static-batch-manifest.json'), batch);
  process.stdout.write(`\nIssue #734 character static probe complete: ${records.length} files; evidence=${args.out}\n`);
}

run();
