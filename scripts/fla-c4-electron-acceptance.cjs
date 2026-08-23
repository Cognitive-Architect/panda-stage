#!/usr/bin/env node
/**
 * C4 real-corpus routing receipt runner. Private FLA bytes stay under the
 * approved root; the receipt contains bounded metadata only.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');
const JSZip = require('jszip');

const CONTROLS = [
  {
    id: 'strict-raster',
    basename: '\u6587\u4ef6.fla',
    sha256: '84682edcd49b8fcc072ae740188677bae9d7d0fd603b8bed51a7ac4ddeb3119f',
    expectedRoute: 'v1-raster-review',
    expectedMediaCount: 158,
    recovered: false,
  },
  {
    id: 'recovered-raster',
    basename: '\u6c99\u96d5\u8868\u60c5\u5927\u5168\uff08\u514d\u8d39\u5206\u4eab\uff0c\u77ed\u5267\u614e\u7528\uff09.fla',
    sha256: 'd7d92d3f38eaf3fbac812f991b1a9e7239480afaafb4bddf7e62a374355ebc59',
    expectedRoute: 'v1-raster-review',
    expectedMediaCount: 128,
    recovered: true,
  },
  {
    id: 'recovered-structure-first',
    basename: '\u5411\u53f3\u8d70.fla',
    sha256: '79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098',
    expectedRoute: 'v2r-target-discovery',
    expectedMediaCount: 0,
    recovered: true,
  },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  return args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJsonLine(stdout) {
  for (const line of String(stdout).split(/\r?\n/u).reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try { return JSON.parse(line); } catch { /* Electron diagnostics may surround the receipt. */ }
  }
  return null;
}

function outsideApprovedRoot(root, out) {
  const rel = relative(root, out);
  return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`);
}

function directoryNames(root) {
  return readdirSync(root, { withFileTypes: true })
    .map((entry) => `${entry.isDirectory() ? 'd' : 'f'}:${entry.name}`)
    .sort();
}

function runProbe({ sourcePath, originalSha256, userData, logBase, repoRoot, electronPath, probeScript }) {
  const child = spawnSync(electronPath, [
    probeScript,
    '--source', sourcePath,
    '--original-sha256', originalSha256,
    '--user-data', userData,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, VITE_DEV_SERVER_URL: '' },
  });
  const stdout = String(child.stdout || '');
  const stderr = String(child.stderr || '');
  writeFileSync(`${logBase}.stdout.log`, stdout, 'utf8');
  writeFileSync(`${logBase}.stderr.log`, stderr, 'utf8');
  return {
    result: parseJsonLine(stdout),
    processExitCode: child.status,
    timedOut: child.error?.code === 'ETIMEDOUT',
    stderrTail: stderr.slice(-2_000),
  };
}

function bounded(control, probe) {
  const response = probe.result?.response;
  return {
    id: control.id,
    basename: control.basename,
    originalSha256: control.sha256,
    processExitCode: probe.processExitCode,
    timedOut: probe.timedOut,
    sourceHashInvariance: probe.result?.sourceHashInvariance ?? 'UNKNOWN',
    route: response?.route ?? 'blocked',
    mediaCount: response?.mediaCount ?? null,
    recoveryApplied: response?.trace?.recoveryApplied ?? false,
    ingestMode: response?.trace?.ingestMode ?? null,
    catalog: response?.catalog ?? null,
    releaseAccepted: response?.releaseAccepted ?? false,
    projectMutation: response?.projectMutation ?? 'UNKNOWN',
    error: response?.error,
    stderrTail: probe.result ? undefined : probe.stderrTail,
  };
}

async function makeNoTargetFla(outPath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="550" height="400" frameRate="24">
  <timelines><DOMTimeline name="empty"><layers><DOMLayer name="empty"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(outPath, bytes);
  return sha256(bytes);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !args.out) {
    throw new Error('Usage: node scripts/fla-c4-electron-acceptance.cjs --root "D:\\\u8868\u60c5\u5408\u96c6" --out "<external-receipt.json>"');
  }
  const root = resolve(args.root);
  const out = resolve(args.out);
  if (!existsSync(root)) throw new Error(`Approved FLA corpus root is missing: ${root}`);
  if (!outsideApprovedRoot(root, out)) throw new Error('--out must be outside the approved corpus root');
  const outputRoot = resolve(join(out, '..'));
  const logsDir = join(outputRoot, 'electron-logs');
  const userDataRoot = join(outputRoot, 'electron-user-data');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(userDataRoot, { recursive: true });

  const namesBefore = directoryNames(root);
  const repoRoot = resolve(__dirname, '..');
  const electronPath = require('electron');
  const probeScript = resolve(__dirname, 'fla-c4-electron-probe.cjs');
  const results = [];
  for (const control of CONTROLS) {
    const sourcePath = join(root, control.basename);
    if (!existsSync(sourcePath)) throw new Error(`Required C4 control is missing: ${control.basename}`);
    const actualHash = sha256(readFileSync(sourcePath));
    if (actualHash !== control.sha256) throw new Error(`Hash drift for ${control.basename}: ${actualHash}`);
    const probe = runProbe({
      sourcePath,
      originalSha256: actualHash,
      userData: join(userDataRoot, control.id),
      logBase: join(logsDir, control.id),
      repoRoot,
      electronPath,
      probeScript,
    });
    results.push(bounded(control, probe));
  }

  const repeats = [];
  for (const control of CONTROLS.filter((item) => item.recovered)) {
    const sourcePath = join(root, control.basename);
    const probe = runProbe({
      sourcePath,
      originalSha256: control.sha256,
      userData: join(userDataRoot, `${control.id}-repeat`),
      logBase: join(logsDir, `${control.id}-repeat`),
      repoRoot,
      electronPath,
      probeScript,
    });
    const repeated = bounded(control, probe);
    const first = results.find((item) => item.id === control.id);
    repeats.push({
      id: control.id,
      firstRoute: first?.route,
      secondRoute: repeated.route,
      deterministicRoute: first?.route === repeated.route,
      sourceHashInvariance: repeated.sourceHashInvariance,
      releaseAccepted: repeated.releaseAccepted,
    });
  }

  const noTargetPath = join(outputRoot, 'synthetic-no-target.fla');
  const noTargetHash = await makeNoTargetFla(noTargetPath);
  const noTargetControl = {
    id: 'synthetic-no-target',
    basename: 'synthetic-no-target.fla',
    sha256: noTargetHash,
  };
  const noTargetProbe = runProbe({
    sourcePath: noTargetPath,
    originalSha256: noTargetHash,
    userData: join(userDataRoot, 'synthetic-no-target'),
    logBase: join(logsDir, 'synthetic-no-target'),
    repoRoot,
    electronPath,
    probeScript,
  });
  const noTarget = bounded(noTargetControl, noTargetProbe);
  const namesAfter = directoryNames(root);

  const strictRaster = results.find((item) => item.id === 'strict-raster');
  const recoveredRaster = results.find((item) => item.id === 'recovered-raster');
  const structureFirst = results.find((item) => item.id === 'recovered-structure-first');
  const receipt = {
    schemaVersion: 'fla-v1.5-c4-electron-acceptance/1',
    execution: {
      approvedCorpusPolicy: 'D:\\\u8868\u60c5\u5408\u96c6 only; three exact-hash top-level controls',
      sourceRootRecorded: false,
      privateVisualBytesRecorded: false,
      parserPath: 'real Electron product inspection and existing V2-R catalog APIs',
      projectMutation: 'NONE: no V1, snapshot, or sequence commit API called',
    },
    controls: results,
    repeats,
    syntheticNoTarget: noTarget,
    summary: {
      gateA: strictRaster?.route === 'v1-raster-review' && strictRaster.mediaCount === 158 && !strictRaster.recoveryApplied ? 'PASS' : 'FAIL',
      gateB: recoveredRaster?.route === 'v1-raster-review' && recoveredRaster.mediaCount === 128 && recoveredRaster.recoveryApplied ? 'PASS' : 'FAIL',
      gateC: structureFirst?.route === 'v2r-target-discovery' && structureFirst.mediaCount === 0 && structureFirst.recoveryApplied && structureFirst.catalog?.ok && structureFirst.catalog.targetCount > 0 ? 'PASS' : 'FAIL',
      gateD: noTarget.route === 'v2r-target-discovery' && noTarget.catalog?.ok && noTarget.catalog.targetCount === 0 ? 'PASS' : 'FAIL',
      gateE: repeats.every((item) => item.deterministicRoute && item.sourceHashInvariance === 'PASS' && item.releaseAccepted) && JSON.stringify(namesBefore) === JSON.stringify(namesAfter) ? 'PASS' : 'FAIL',
      sourceHashInvariance: results.every((item) => item.sourceHashInvariance === 'PASS') ? 'PASS' : 'FAIL',
      sourceDirectoryArtifacts: JSON.stringify(namesBefore) === JSON.stringify(namesAfter) ? 'NONE' : 'CHANGED',
      projectMutationBeforeConfirm: 'NONE',
      maintainerHumanAcceptance: 'PENDING',
    },
  };
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`fla-c4-electron-acceptance: wrote receipt -> ${out}\n`);
  if (Object.values(receipt.summary).includes('FAIL')) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`fla-c4-electron-acceptance: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
