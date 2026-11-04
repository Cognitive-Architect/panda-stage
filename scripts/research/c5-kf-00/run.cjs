const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_DIR = path.resolve(
  process.env.PANDA_C5_KF00_OUTPUT_DIR ??
    'D:\\PandaStage-Acceptance\\issue-962-c5-kf00\\run',
);
const RECEIPT_PATH = path.join(OUTPUT_DIR, 'receipt.json');
const BASELINE_HEAD = 'c5da50a7c32f77c01676b4ac0e295ccf3ccda659';
const COMMAND = 'pnpm research:c5-kf-00';
const PACKAGE_MANAGER = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
).packageManager;

function gitValue(...args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
}

function writeReceipt(receipt) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function readReceipt(fallback) {
  if (!fs.existsSync(RECEIPT_PATH)) return fallback;
  return JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf8'));
}

function invokePnpm(args) {
  const result = spawnSync('pnpm', args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`Failed to start pnpm: ${result.error.message}`);
  }
  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal ?? null,
    spawnError: result.error?.message ?? null,
  };
}

function startReceipt(startedAt) {
  return {
    schema: 'c5-kf-00-research-receipt/v1',
    generatedAt: startedAt,
    baselineHead: BASELINE_HEAD,
    experimentHead: gitValue('rev-parse', 'HEAD'),
    branch: gitValue('branch', '--show-current'),
    command: COMMAND,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      packageManager: PACKAGE_MANAGER,
      privateProjectInputProvided: Boolean(process.env.PANDA_C5_KF00_REAL_PROJECT_DIR),
      privateSourceInputProvided: Boolean(process.env.PANDA_C5_KF00_SOURCE_FLA),
    },
    process: {
      projectSave: 'NOT_RUN',
      productionUi: 'NOT_RUN',
      productTimer: 'NOT_RUN',
      formalExport: 'NOT_RUN',
    },
    synthetic: { status: 'NOT_RUN' },
    realAsset: { status: 'NOT_RUN' },
    outputs: {},
    capturePending: false,
    run: {
      status: 'RUNNING',
      startedAt,
      completedAt: null,
      testExitCode: null,
      captureExitCode: null,
      exitCode: null,
      failureStage: null,
    },
  };
}

function printSummary(receipt) {
  console.log(
    JSON.stringify(
      {
        gate: receipt.gate,
        realVisualGate: receipt.realVisualGate,
        run: receipt.run,
        receiptPath: RECEIPT_PATH,
      },
      null,
      2,
    ),
  );
}

function finishFailure(receipt, { stage, exitCode, signal, spawnError, testExitCode, captureExitCode }) {
  receipt.gate = 'TECH_FAIL';
  receipt.capturePending = false;
  receipt.failure = {
    stage,
    exitCode,
    signal,
    spawnError,
  };
  if (stage === 'VITEST') {
    receipt.capture = { status: 'SKIPPED_TESTS_FAILED' };
  } else if (!receipt.capture || receipt.capture.status !== 'FAIL') {
    receipt.capture = {
      ...(receipt.capture ?? {}),
      status: 'FAIL',
    };
  }
  receipt.run = {
    status: 'FAIL',
    startedAt: receipt.run?.startedAt,
    completedAt: new Date().toISOString(),
    testExitCode: testExitCode ?? null,
    captureExitCode: captureExitCode ?? null,
    exitCode,
    failureStage: stage,
  };
  writeReceipt(receipt);
  printSummary(receipt);
  process.exitCode = exitCode || 1;
}

const startedAt = new Date().toISOString();
let receipt = startReceipt(startedAt);
writeReceipt(receipt);

const tests = invokePnpm([
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.research.config.ts',
  'tests/research/c5-kf-00.test.ts',
]);
receipt = readReceipt(receipt);
if (tests.exitCode !== 0) {
  finishFailure(receipt, {
    stage: 'VITEST',
    exitCode: tests.exitCode,
    signal: tests.signal,
    spawnError: tests.spawnError,
    testExitCode: tests.exitCode,
  });
} else {
  const capture = invokePnpm([
    'exec',
    'electron',
    'scripts/research/c5-kf-00/capture.cjs',
  ]);
  receipt = readReceipt(receipt);
  if (capture.exitCode !== 0 || receipt.gate !== 'TECH_PASS' || receipt.capturePending !== false) {
    finishFailure(receipt, {
      stage: 'ELECTRON_CAPTURE',
      exitCode: capture.exitCode || 1,
      signal: capture.signal,
      spawnError: capture.spawnError,
      testExitCode: tests.exitCode,
      captureExitCode: capture.exitCode,
    });
  } else {
    receipt.environment = {
      ...receipt.environment,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      packageManager: PACKAGE_MANAGER,
      privateProjectInputProvided: Boolean(process.env.PANDA_C5_KF00_REAL_PROJECT_DIR),
      privateSourceInputProvided: Boolean(process.env.PANDA_C5_KF00_SOURCE_FLA),
    };
    receipt.run = {
      status: 'PASS',
      startedAt: receipt.run?.startedAt ?? startedAt,
      completedAt: new Date().toISOString(),
      testExitCode: tests.exitCode,
      captureExitCode: capture.exitCode,
      exitCode: 0,
      failureStage: null,
    };
    writeReceipt(receipt);
    printSummary(receipt);
    process.exitCode = 0;
  }
}
