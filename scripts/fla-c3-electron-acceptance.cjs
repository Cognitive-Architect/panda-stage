#!/usr/bin/env node
/**
 * C3 real Windows/Electron receipt runner.
 *
 * Only bounded metadata is written to --out. The approved source corpus is
 * read in place and is never copied or modified; logs and one synthetic Gate D
 * fixture are kept under the external acceptance directory.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');
const { buildNegativeFixtures } = require('./fla-c2-safe-recovery-envelope.cjs');
const {
  classifyForFlaRecovery,
} = require('../dist-electron/main/services/fla-recovery-classifier.js');

const CANDIDATE_RASTER = '沙雕表情大全（免费分享，短剧慎用）.fla';
const CANDIDATE_NON_RASTER = new Set([
  '人物倒地.fla',
  '向右走.fla',
  '性感修仙女.fla',
  '性感泳装女（补面需求）.fla',
  '蓝衣修仙男（补面需求）.fla',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') {
      args.root = argv[index + 1];
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJsonLine(stdout) {
  for (const line of String(stdout).split(/\r?\n/u).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Electron diagnostics can surround the one-line receipt.
    }
  }
  return null;
}

function assertOutputOutsideRoot(root, out) {
  const relativePath = relative(root, out);
  if (!isAbsolute(relativePath) && relativePath !== '' && !relativePath.startsWith(`..${sep}`) && relativePath !== '..') {
    throw new Error('--out must be outside the approved FLA corpus root');
  }
}

function runProbe({ sourcePath, originalSha256, userData, logBase, repoRoot, electronPath, probeScript }) {
  const child = spawnSync(
    electronPath,
    [
      probeScript,
      '--source', sourcePath,
      '--original-sha256', originalSha256,
      '--user-data', userData,
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
  writeFileSync(`${logBase}.stdout.log`, stdout, 'utf8');
  writeFileSync(`${logBase}.stderr.log`, stderr, 'utf8');
  const parsed = parseJsonLine(stdout);
  return {
    parsed,
    processExitCode: child.status,
    cleanupWarning: child.status !== 0 || Boolean(child.signal),
    timedOut: child.error?.code === 'ETIMEDOUT',
    stderrTail: stderr.slice(-2_000),
  };
}

function boundedSampleResult(sample, probe) {
  const response = probe.parsed?.response;
  return {
    basename: sample.basename,
    sampleId: sample.sampleId,
    originalSha256: sample.originalSha256,
    expectedClassifierState: sample.expectedClassifierState,
    status: response?.ok === true ? 'success' : 'failure',
    processExitCode: probe.processExitCode,
    cleanupWarning: probe.cleanupWarning,
    timedOut: probe.timedOut,
    sourceHashInvariance: probe.parsed?.sourceHashInvariance ?? 'UNKNOWN',
    response: response
      ? {
          ok: response.ok,
          error: response.error,
          diagnostics: response.diagnostics,
          source: response.source,
          mediaCount: response.mediaCount,
          placedInstanceCount: response.placedInstanceCount,
          libraryOnlyMediaCount: response.libraryOnlyMediaCount,
          trace: response.trace,
        }
      : null,
    stderrTail: probe.parsed ? undefined : probe.stderrTail,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.out) {
    process.stderr.write(
      'Usage: electron scripts/fla-c3-electron-acceptance.cjs --root "D:\\表情合集" --out "<external-receipt.json>"\n',
    );
    process.exit(args.help ? 0 : 2);
  }
  const root = resolve(args.root);
  const out = resolve(args.out);
  if (!existsSync(root)) throw new Error(`Approved FLA corpus root is missing: ${root}`);
  assertOutputOutsideRoot(root, out);
  const outputRoot = resolve(join(out, '..'));
  const logsDir = join(outputRoot, 'electron-logs');
  const userDataRoot = join(outputRoot, 'electron-user-data');
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(userDataRoot, { recursive: true });

  const samples = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fla'))
    .sort((left, right) => left.name.localeCompare(right.name, 'en-US'))
    .map((entry) => {
      const sourcePath = join(root, entry.name);
      const bytes = readFileSync(sourcePath);
      const classification = classifyForFlaRecovery(bytes);
      return {
        basename: entry.name,
        sourcePath,
        originalSha256: sha256(bytes),
        sampleId: `fla-${sha256(bytes).slice(0, 16)}`,
        expectedClassifierState: classification.state,
      };
    });
  const electronPath = require('electron');
  const repoRoot = resolve(__dirname, '..');
  const probeScript = resolve(__dirname, 'fla-c3-electron-probe.cjs');
  const results = [];

  for (const sample of samples) {
    const logBase = join(logsDir, sample.sampleId);
    const probe = runProbe({
      sourcePath: sample.sourcePath,
      originalSha256: sample.originalSha256,
      userData: join(userDataRoot, sample.sampleId),
      logBase,
      repoRoot,
      electronPath,
      probeScript,
    });
    results.push(boundedSampleResult(sample, probe));
  }

  const repeatSample = samples.find((sample) => sample.basename === CANDIDATE_RASTER) ?? samples.find((sample) => sample.expectedClassifierState === 'RECOVERY_CANDIDATE');
  let repeat = null;
  if (repeatSample) {
    const first = runProbe({
      sourcePath: repeatSample.sourcePath,
      originalSha256: repeatSample.originalSha256,
      userData: join(userDataRoot, `${repeatSample.sampleId}-repeat-1`),
      logBase: join(logsDir, `${repeatSample.sampleId}-repeat-1`),
      repoRoot,
      electronPath,
      probeScript,
    });
    const second = runProbe({
      sourcePath: repeatSample.sourcePath,
      originalSha256: repeatSample.originalSha256,
      userData: join(userDataRoot, `${repeatSample.sampleId}-repeat-2`),
      logBase: join(logsDir, `${repeatSample.sampleId}-repeat-2`),
      repoRoot,
      electronPath,
      probeScript,
    });
    repeat = {
      basename: repeatSample.basename,
      first: boundedSampleResult(repeatSample, first),
      second: boundedSampleResult(repeatSample, second),
      deterministic:
        JSON.stringify(first.parsed?.response?.trace) === JSON.stringify(second.parsed?.response?.trace) &&
        first.parsed?.sourceHashInvariance === 'PASS' &&
        second.parsed?.sourceHashInvariance === 'PASS',
    };
  }

  const negativeFixtures = await buildNegativeFixtures();
  const negativeFixture = negativeFixtures.find((fixture) => fixture.expectedState === 'AMBIGUOUS') ?? negativeFixtures[0];
  let gateD = null;
  if (negativeFixture) {
    const negativePath = join(outputRoot, 'synthetic-gate-d-negative.fla');
    writeFileSync(negativePath, negativeFixture.bytes);
    const probe = runProbe({
      sourcePath: negativePath,
      originalSha256: sha256(negativeFixture.bytes),
      userData: join(userDataRoot, 'gate-d-negative'),
      logBase: join(logsDir, 'gate-d-negative'),
      repoRoot,
      electronPath,
      probeScript,
    });
    gateD = {
      fixtureId: negativeFixture.id,
      expectedState: negativeFixture.expectedState,
      result: boundedSampleResult(
        {
          basename: 'synthetic-gate-d-negative.fla',
          sampleId: 'synthetic-gate-d-negative',
          originalSha256: sha256(negativeFixture.bytes),
          expectedClassifierState: negativeFixture.expectedState,
        },
        probe,
      ),
    };
  }

  const successful = results.filter((result) => result.status === 'success');
  const strictControls = successful.filter(
    (result) => result.expectedClassifierState === 'STRICT_VALID' && result.response?.trace?.recoveryApplied === false,
  );
  const recoveryCandidates = successful.filter(
    (result) => result.expectedClassifierState === 'RECOVERY_CANDIDATE' && result.response?.trace?.recoveryApplied === true,
  );
  const raster = results.find((result) => result.basename === CANDIDATE_RASTER);
  const nonRaster = results.find(
    (result) => CANDIDATE_NON_RASTER.has(result.basename) && result.response?.mediaCount === 0,
  );
  const receipt = {
    schemaVersion: 'fla-v1.5-c3-electron-acceptance/1',
    execution: {
      approvedCorpusPolicy: 'D:\\表情合集 only; top-level .fla files; originals read-only',
      sourceRootRecorded: false,
      normalizationStorage: 'MEMORY',
      projectMutation: 'NONE: inspection-only API; no Project or commit operation',
      parserPath: 'real Electron main -> Main recovery/preflight -> isolated sandbox FLA parser worker -> production adapter',
    },
    samples: results,
    repeat,
    gateD,
    summary: {
      realSampleCount: samples.length,
      strictControls: `${strictControls.length}/2`,
      recoveryCandidates: `${recoveryCandidates.length}/10`,
      postNormalizationStrictPass: `${recoveryCandidates.filter((result) => result.response?.trace?.postNormalizationStrictResult === 'pass').length}/${recoveryCandidates.length}`,
      parserSuccessAfterRecovery: `${recoveryCandidates.filter((result) => result.response?.trace?.parserResult === 'success').length}/${recoveryCandidates.length}`,
      sourceHashInvariance: results.every((result) => result.sourceHashInvariance === 'PASS') ? 'PASS' : 'FAIL',
      gateA: strictControls.length === 2 ? 'PASS' : 'FAIL',
      gateB: raster?.status === 'success' && raster.response?.trace?.recoveryApplied === true ? 'PASS' : 'FAIL',
      gateC: nonRaster?.status === 'success' && nonRaster.response?.trace?.recoveryApplied === true ? 'PASS' : 'FAIL',
      gateD: gateD?.result.status === 'failure' && gateD.result.response?.trace?.recoveryApplied !== true ? 'PASS' : 'FAIL',
      gateE: repeat?.deterministic === true ? 'PASS' : 'FAIL',
    },
  };
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`fla-c3-electron-acceptance: wrote ${samples.length} real results -> ${out}\n`);
  if (Object.values(receipt.summary).some((value) => value === 'FAIL')) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`fla-c3-electron-acceptance: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
