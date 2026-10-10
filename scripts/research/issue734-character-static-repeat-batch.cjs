#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const REPEAT_PROBE = path.join(ROOT, 'scripts/research/issue734-character-static-repeat.cjs');
const CENSUS_PATH = path.join(ROOT, 'docs/research/issue-732-cross-category-capability-census.json');
const ISSUE734_BASELINE = '93fe7fac21c6c0872eb92efba079c81abf611116';
const SELECTIONS = [
  { fixtureId: 'character-02', candidateId: 'C734-85AF59526B7E24D43637D3A0', rationale: 'single complete black-robed character root; Scene sheet separately preserves three authored views' },
  { fixtureId: 'character-03', candidateId: 'C734-E5AAE552C028340C8C18F0BE', rationale: 'complete umbrella character root; Scene first blocker is open fill' },
  { fixtureId: 'character-04', candidateId: 'C734-60D88285064C3789BE7CBF20', rationale: 'single complete blue-white robe character root' },
  { fixtureId: 'character-05', candidateId: 'C734-5964612EA45272BB4EAF6F8F', rationale: 'best available Scene composition; root identity is missing from the 64-target catalog and visual review remains pending' },
  { fixtureId: 'character-09', candidateId: 'C734-C593CFAD4DB6C1FA7130EDF4', rationale: 'single complete elder character root; Scene preserves two source-visible figures' },
  { fixtureId: 'character-11', candidateId: 'C734-95840C6ABA241C1D5805F2F3', rationale: 'single complete female character root; Scene preserves three authored views' },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--probe-root') args.probeRoot = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  assert.ok(args.probeRoot && args.out, 'expected --probe-root and --out');
  return { probeRoot: path.resolve(args.probeRoot), out: path.resolve(args.out) };
}

function assertExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #734 repeat evidence must remain outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite repeat evidence: ${directory}`);
}

function sha256File(filePath) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function invokeRepeat(fixture, candidate, rationale, outputPath) {
  const electronBinary = require('electron');
  const result = spawnSync(electronBinary, [
    REPEAT_PROBE,
    '--source', fixture.sourcePath,
    '--expected-sha256', fixture.sourceSha256,
    '--render-target-id', candidate.productIdentity.renderTargetId,
    '--frame-index', String(candidate.sourceAddress.frameIndex),
    '--expected-png-sha256', candidate.artifacts.png.sha256,
    '--expected-svg-sha256', candidate.artifacts.svg.sha256,
    '--out', outputPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const lines = String(result.stdout ?? '').trim().split(/\r?\n/u);
  const jsonLine = lines.reverse().find((line) => line.trimStart().startsWith('{'));
  return {
    exitCode: result.status,
    stderrTail: String(result.stderr ?? '').slice(-3_000),
    receipt: jsonLine ? JSON.parse(jsonLine) : null,
    rationale,
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalDirectory(args.out);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(head, ISSUE734_BASELINE, 'working HEAD differs from Issue #734 frozen baseline');
  const census = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf8'));
  assert.equal(census.issue, 732);
  const fixtures = new Map(census.files
    .filter((fixture) => fixture.category === 'CHARACTER')
    .map((fixture, index) => [`character-${String(index + 1).padStart(2, '0')}`, fixture]));
  fs.mkdirSync(args.out, { recursive: false });
  const results = [];

  for (const selection of SELECTIONS) {
    const fixture = fixtures.get(selection.fixtureId);
    assert.ok(fixture, `frozen fixture is missing: ${selection.fixtureId}`);
    const probeDirectory = path.join(args.probeRoot, selection.fixtureId);
    const probeReceiptPath = path.join(probeDirectory, 'static-truth-probe.json');
    const probeReceipt = JSON.parse(fs.readFileSync(probeReceiptPath, 'utf8'));
    const candidate = probeReceipt.candidates.find((entry) => entry.candidateId === selection.candidateId);
    assert.ok(candidate, `selected candidate is missing from ${selection.fixtureId}`);
    assert.equal(candidate.renderer.status, 'RENDERED', `selected candidate is not rendered: ${selection.candidateId}`);
    assert.equal(candidate.sourceAddress.frameIndex, 0, 'reviewed selected candidate frame changed');
    assert.equal(sha256File(path.join(probeDirectory, candidate.artifacts.png.path)), candidate.artifacts.png.sha256, 'selected PNG hash changed before repeat');
    assert.equal(sha256File(path.join(probeDirectory, candidate.artifacts.svg.path)), candidate.artifacts.svg.sha256, 'selected SVG hash changed before repeat');
    const outputPath = path.join(args.out, selection.fixtureId);
    let probe;
    let failure = null;
    try {
      probe = invokeRepeat(fixture, candidate, selection.rationale, outputPath);
      if (probe.exitCode !== 0) failure = `repeat Electron process exited ${probe.exitCode ?? 'unknown'}`;
      else if (!probe.receipt) failure = 'repeat process produced no JSON receipt';
      else if (!probe.receipt.repeat.pngMatches || !probe.receipt.repeat.svgMatches) failure = 'repeat output hash differs from the selected candidate';
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      probe = { exitCode: null, stderrTail: '', receipt: null };
    }
    const record = {
      ...selection,
      source: fixture.filename,
      sourceSha256: fixture.sourceSha256,
      renderTargetId: candidate.productIdentity.renderTargetId,
      selectedFrameIndex: candidate.sourceAddress.frameIndex,
      originalHashes: { pngSha256: candidate.artifacts.png.sha256, svgSha256: candidate.artifacts.svg.sha256 },
      exitCode: probe.exitCode,
      failure,
      repeatReceiptPath: probe.receipt ? path.join(outputPath, 'repeat-receipt.json') : null,
      repeatHashes: probe.receipt?.repeat ?? null,
      evidenceDirectory: outputPath,
    };
    writeJson(path.join(outputPath, 'batch-record.json'), record);
    results.push(record);
    process.stdout.write(`${selection.fixtureId} ${fixture.filename}: repeat=${failure ?? 'PASS'} PNG=${probe.receipt?.repeat.pngMatches ?? 'n/a'} SVG=${probe.receipt?.repeat.svgMatches ?? 'n/a'}\n`);
  }

  const batch = {
    schemaVersion: 'issue734-character-static-repeat-batch/1',
    issue: 734,
    baseline: ISSUE734_BASELINE,
    probeEvidenceDirectory: args.probeRoot,
    fileCount: results.length,
    deterministic: results.every((result) => !result.failure && result.repeatHashes?.pngMatches && result.repeatHashes?.svgMatches),
    results,
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'repeat-batch-manifest.json'), batch);
  process.stdout.write(`\nIssue #734 selected-candidate deterministic repeats complete: ${results.length}; deterministic=${batch.deterministic}\n`);
}

run();
