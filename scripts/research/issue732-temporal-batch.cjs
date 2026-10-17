#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = '1e7091c4b34e4ff8b7d77bc5c10015b6e37f0c9f';
const TEMPORAL_PROBE = path.join(ROOT, 'scripts/research/issue732-temporal-product-probe.cjs');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--census-manifest') args.censusManifest = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  assert.ok(args.censusManifest, 'missing --census-manifest');
  assert.ok(args.out, 'missing --out');
  return { censusManifest: path.resolve(args.censusManifest), out: path.resolve(args.out) };
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
    TEMPORAL_PROBE,
    '--fixture-id', `issue732-${fixture.category.toLowerCase()}-${fixture.fixtureId}`,
    '--source', fixture.sourcePath,
    '--expected-sha256', fixture.sourceSha256,
    '--out', outputPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const jsonLine = String(result.stdout ?? '').trim().split(/\r?\n/u)
    .reverse().find((line) => line.trimStart().startsWith('{'));
  if (result.status !== 0 && !jsonLine) {
    const stderr = String(result.stderr ?? '').slice(-12_000);
    const stdout = String(result.stdout ?? '').slice(-4_000);
    throw new Error(`${fixture.filename} temporal product probe exited ${result.status}: ${stderr || stdout}`);
  }
  return {
    exitCode: result.status,
    stderrTail: String(result.stderr ?? '').slice(-2_000),
    receipt: jsonLine ? JSON.parse(jsonLine) : null,
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const relative = path.relative(ROOT, args.out);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'temporal evidence must remain outside the repository');
  assert.ok(!fs.existsSync(args.out), `refusing to overwrite existing evidence directory: ${args.out}`);
  const census = JSON.parse(fs.readFileSync(args.censusManifest, 'utf8'));
  assert.equal(census.issue, 732, 'input manifest is not the Issue #732 frozen census');
  assert.equal(census.baseline.commit, BASELINE, 'input manifest baseline differs from #732');
  assert.equal(census.results.length, 28, 'input manifest does not contain the frozen 28-source corpus');
  assert.deepEqual(census.inventory.delta, {}, 'census inventory delta must be explicitly reconciled before temporal rendering');
  fs.mkdirSync(args.out, { recursive: false });

  const results = [];
  for (const [index, censusFixture] of census.results.entries()) {
    const fixture = {
      fixtureId: censusFixture.fixtureId,
      category: censusFixture.category,
      filename: censusFixture.filename,
      sourcePath: censusFixture.sourcePath,
      sourceSha256: censusFixture.sourceSha256,
    };
    assert.equal(sha256File(fixture.sourcePath), fixture.sourceSha256, `${fixture.filename} no longer matches its frozen source SHA-256`);
    const outputPath = path.join(args.out, fixture.fixtureId);
    let probe;
    let failure = null;
    try {
      probe = invokeProbe(fixture, outputPath);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      probe = { exitCode: null, stderrTail: '', receipt: null };
    }
    const sourceSha256After = sha256File(fixture.sourcePath);
    assert.equal(sourceSha256After, fixture.sourceSha256, `${fixture.filename} source changed during temporal census`);
    const record = {
      ...fixture,
      sourceSha256After,
      sourceHashUnchanged: true,
      probeExitCode: probe.exitCode,
      stderrTail: probe.stderrTail,
      failure,
      receiptPath: probe.receipt ? path.join(outputPath, 'temporal-receipt.json') : null,
      gate5: probe.receipt?.gate5 ?? null,
      sourceStructure: probe.receipt?.productionInspection?.structure ?? null,
      sceneRootDiscovery: probe.receipt?.sceneRootDiscovery ?? null,
      evidenceDirectory: outputPath,
    };
    writeJson(path.join(outputPath, 'batch-record.json'), record);
    results.push(record);
    const gate5 = record.gate5;
    process.stdout.write(`${index + 1}/28 ${fixture.category} ${fixture.filename}: G5=${gate5?.status ?? 'PROBE_FAILED'}, roots=${gate5?.timelines?.length ?? 0}, requested=${gate5?.requestedFrameCount ?? 0}, resolved=${gate5?.resolvedFrameCount ?? 0}\n`);
  }

  const batch = {
    schemaVersion: 'issue732-temporal-batch/1',
    issue: 732,
    baseline: BASELINE,
    sourceHashInvariant: results.every((result) => result.sourceHashUnchanged),
    fileCount: results.length,
    results,
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'temporal-batch-manifest.json'), batch);
  const rows = results.map((result) => [
    result.category,
    JSON.stringify(result.filename),
    result.sourceSha256,
    result.gate5?.status ?? 'PROBE_FAILED',
    result.gate5?.requestedFrameCount ?? 0,
    result.gate5?.resolvedFrameCount ?? 0,
    result.gate5?.timelines?.length ?? 0,
    JSON.stringify(result.gate5?.timelines?.map((timeline) => timeline.firstBlocker) ?? []),
  ].join(','));
  fs.writeFileSync(path.join(args.out, 'temporal-summary.csv'), [
    'category,filename,sourceSha256,G5,requestedFrames,resolvedFrames,temporalRootTimelines,firstBlockers',
    ...rows,
    '',
  ].join('\n'), { flag: 'wx' });
  process.stdout.write(`\nIssue #732 production frame-sequence census complete: ${results.length} files; evidence=${args.out}\n`);
}

run();
