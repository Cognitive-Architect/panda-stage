/* Issue #403 Problem 2: aggregate short/Chinese/ASCII real Electron samples. */

'use strict';

const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_SOURCE = 'D:\\表情合集\\文件.fla';
const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue403-raster-containment';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const sourcePath = resolve(args.source || DEFAULT_SOURCE);
const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'evidence'));
const outPath = resolve(args.out || join(acceptanceRoot, 'issue403-raster-containment-receipt.json'));
const sourceDir = join(acceptanceRoot, 'sources');
const workerPath = join(__dirname, 'verify-issue403-raster-containment-worker.cjs');
const electronBinary = join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const samples = [
  { key: 'short', basename: 'issue403-short.fla', requiresEllipsis: false },
  {
    key: 'long-chinese',
    basename: 'issue403-这是一份用于检查长文件名收缩与兼容性容器的中文源文件名-验收样本.fla',
    requiresEllipsis: true,
  },
  {
    key: 'long-ascii',
    basename: `issue403-${'X'.repeat(128)}.fla`,
    requiresEllipsis: true,
  },
];

function runSample(sample) {
  const sampleSource = join(sourceDir, sample.basename);
  const sampleRoot = join(acceptanceRoot, sample.key);
  const sampleEvidence = join(evidenceDir, sample.key);
  const sampleUserData = join(sampleRoot, 'electron-user-data');
  const sampleOut = join(sampleEvidence, 'receipt.json');
  mkdirSync(sampleEvidence, { recursive: true });
  mkdirSync(sampleRoot, { recursive: true });
  copyFileSync(sourcePath, sampleSource);
  const child = spawnSync(
    electronBinary,
    [
      workerPath,
      '--sample-key', sample.key,
      '--source', sampleSource,
      '--acceptance-root', sampleRoot,
      '--user-data', sampleUserData,
      '--evidence-dir', sampleEvidence,
      '--out', sampleOut,
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 240_000,
      windowsHide: true,
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`Issue #403 ${sample.key} worker failed (exit ${child.status}).\n${child.stdout}\n${child.stderr}`);
  }
  const receipt = JSON.parse(readFileSync(sampleOut, 'utf8'));
  return {
    ...receipt,
    expected: { basename: sample.basename, requiresEllipsis: sample.requiresEllipsis },
  };
}

function assertSample(sample) {
  const checks = sample.checks;
  const expectedBasename = sample.expected.basename;
  const valid = [
    checks.sourceNameContained,
    checks.compatibilityContained,
    checks.overviewBeforeCenter,
    checks.horizontalOverflow,
    checks.fullBasenameAvailable,
    checks.threeZonesPresent,
    checks.compatibilityCollapsedByDefault,
    checks.bodyHorizontalOverflowHidden,
    checks.sourceHashInvariant,
    checks.projectAssetCountUnchanged,
    sample.layout.sourceBasename === expectedBasename,
    sample.layout.sourceTitle === expectedBasename,
    sample.expected.requiresEllipsis ? sample.layout.sourceEllipsized : !sample.layout.sourceEllipsized,
  ].every(Boolean);
  if (!valid) throw new Error(`Issue #403 ${sample.sampleKey} evidence is incomplete: ${JSON.stringify(sample)}`);
}

function main() {
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  if (!existsSync(electronBinary)) throw new Error(`Electron binary is missing: ${electronBinary}`);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const results = samples.map(runSample);
  results.forEach(assertSample);
  const receipt = {
    schemaVersion: 'issue403-raster-containment-electron-acceptance/1',
    acceptance: {
      kind: 'automated-real-windows-electron',
      realWindowsElectron: true,
      sourceKind: 'copied-real-raster-fla',
    },
    source: { inputPath: sourcePath },
    samples: results,
    checkpoint: {
      PROBLEM_2_STATUS: 'PASS',
      shortBasename: 'PASS',
      longChineseBasename: 'PASS',
      longASCIIbasename: 'PASS',
      compatibilityContained: true,
      horizontalOverflow: false,
      basenameEllipsisWorks: true,
      fullBasenameAccessibleTruth: true,
    },
  };
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
