const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const baseDirectory = path.resolve(
  process.env.PANDA_STAGE_ISSUE827_ROOT ?? 'D:\\PandaStage-Acceptance\\issue827-dl04',
);
const sampleId = Number(process.env.PANDA_STAGE_ISSUE827_SAMPLE ?? '0');

if (sampleId === 1 || sampleId === 2) {
  process.env.PANDA_STAGE_ISSUE827_DL04 = '1';
  process.env.PANDA_STAGE_ISSUE827_SAMPLE = String(sampleId);
  process.env.PANDA_STAGE_ISSUE827_ROOT = baseDirectory;
  require('./verify-issue819-dl02.cjs');
} else {
  const wrapperRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const invocationRoot = path.join(baseDirectory, `i830-${wrapperRunId}`);
  const sourceCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();

  const runChild = (id) => new Promise((resolve) => {
    const childRoot = path.join(invocationRoot, `sample-${id}`);
    const env = {
      ...process.env,
      PANDA_STAGE_ISSUE827_DL04: '1',
      PANDA_STAGE_ISSUE827_SAMPLE: String(id),
      PANDA_STAGE_ISSUE827_ROOT: childRoot,
      PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID: wrapperRunId,
      PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA: sourceCommitSha,
    };
    const child = spawn(process.execPath, [__filename], {
      cwd: repositoryRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => resolve({ sampleId: id, childRoot, exitCode: null, error: String(error.stack ?? error), stdout: stdout.trim(), stderr: stderr.trim() }));
    child.once('close', (code) => resolve({ sampleId: id, childRoot, exitCode: code, error: null, stdout: stdout.trim(), stderr: stderr.trim() }));
  });

  async function findReceipt(sampleRoot, expectedSampleId) {
    const runDirectories = await fsp.readdir(sampleRoot, { withFileTypes: true }).catch(() => []);
    const candidates = runDirectories.filter((item) => item.isDirectory()).sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of candidates) {
      const receiptPath = path.join(sampleRoot, entry.name, 'acceptance-receipt.json');
      try {
        const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
        if (receipt.wrapperRunId === wrapperRunId && receipt.sampleId === expectedSampleId) {
          return { path: receiptPath, receipt };
        }
      } catch {
        // This invocation's failed child may have only written electron-failure.json.
      }
    }
    return null;
  }

  async function findFailureEvidence(sampleRoot) {
    const runDirectories = await fsp.readdir(sampleRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of runDirectories.filter((item) => item.isDirectory())) {
      const failurePath = path.join(sampleRoot, entry.name, 'evidence', 'electron-failure.json');
      try {
        return { path: failurePath, evidence: JSON.parse(await fsp.readFile(failurePath, 'utf8')) };
      } catch {
        // Continue through this invocation's new run directory only.
      }
    }
    return null;
  }

  function validateBackgroundEvidence(receipt, label) {
    const output = Object.values(receipt.outputs ?? {})[0];
    const backgrounds = output?.backgrounds ?? [];
    if (backgrounds.length !== 3) throw new Error(`${label}: expected three encoded background records.`);
    if (new Set(backgrounds.map((entry) => entry.assetId)).size !== 3) throw new Error(`${label}: background asset IDs are not distinct.`);
    if (new Set(backgrounds.map((entry) => entry.sha256)).size !== 3) throw new Error(`${label}: background SHA-256 values are not distinct.`);
    if (!Array.isArray(output.boundaries) || output.boundaries.length !== 2) throw new Error(`${label}: expected encoded evidence at both Shot boundaries.`);
    for (const boundary of output.boundaries) {
      const beforeExpected = backgrounds[boundary.shotIndex - 1];
      const afterExpected = backgrounds[boundary.shotIndex];
      const before = boundary.encodedBackgrounds?.before;
      const after = boundary.encodedBackgrounds?.after;
      if (!beforeExpected || !afterExpected || before?.expectedAssetId !== beforeExpected.assetId || after?.expectedAssetId !== afterExpected.assetId) {
        throw new Error(`${label}: boundary ${boundary.shotIndex} is not linked to its expected background assets.`);
      }
      if (before?.nearestBackground?.shotIndex !== boundary.shotIndex - 1 || after?.nearestBackground?.shotIndex !== boundary.shotIndex) {
        throw new Error(`${label}: encoded frame color features do not identify the expected adjacent Shots.`);
      }
      if (before.nearestBackground.distance > 36 || after.nearestBackground.distance > 36) {
        throw new Error(`${label}: encoded frame color features are outside the expected background tolerance.`);
      }
    }
    return { output, backgrounds, boundaries: output.boundaries };
  }

  function validateSaveReopen(receipt) {
    const evidence = receipt.fixture?.saveReopen;
    if (!evidence || !evidence.diskBytesUnchanged || evidence.reopenedDirty !== false || evidence.originalOpenInstanceId === evidence.reopenedOpenInstanceId) {
      throw new Error('Sample 1 did not prove a clean Creator Save, Close, and disk-backed Recent Project reopen.');
    }
    if (JSON.stringify(evidence.beforeReopen) !== JSON.stringify(evidence.afterReopen)) {
      throw new Error('Sample 1 Shot order, durations, clip timing, backgrounds, or asset hashes changed after reopen.');
    }
    if (receipt.fixture.dirtyAtCapture !== false || (receipt.fixture.persistenceFingerprint?.assets?.length ?? 0) < 3) {
      throw new Error('Sample 1 export was not captured from the saved Project with persisted asset fingerprints.');
    }
    if (receipt.fixture.saveReopen.projectId !== receipt.fixture.projectId) {
      throw new Error('Sample 1 reopened a different Project identity.');
    }
  }

  function validateFailureInjection(receipt) {
    const evidence = receipt.runtimeRenderFailure;
    if (!evidence || evidence.job?.status !== 'failed' || evidence.injection?.shotIndex !== 1 || !Number.isInteger(evidence.injection?.frameIndex)) {
      throw new Error('Sample 1 is missing the deterministic second-Shot formal render failure.');
    }
    if (evidence.injection.shotId !== receipt.fixture.shots[1]?.shotId || evidence.injection.jobId !== evidence.job.jobId) {
      throw new Error('Sample 1 failure injection did not identify the second Shot and failed Job.');
    }
    if (!evidence.outputAbsent || !evidence.projectFileUnchanged || !evidence.sourceAssetsUnchanged || !evidence.editorStateUnchanged || !evidence.priorSuccessfulOutputUnchanged) {
      throw new Error('Sample 1 late-Shot failure changed a protected output, project, source, or editor state.');
    }
    if (evidence.stagingCleanup?.outputTemporaries?.length || evidence.stagingCleanup?.frameJobDirectories?.length || evidence.stagingCleanup?.preparationSnapshots?.length) {
      throw new Error('Sample 1 late-Shot failure left staging or preparation data behind.');
    }
    if (evidence.hiddenWindowDiagnosticsAfterFailure?.pendingFrameJobId || evidence.hiddenWindowDiagnosticsAfterFailure?.loadedJobId) {
      throw new Error('Sample 1 late-Shot failure left a hidden renderer request active.');
    }
  }

  async function main() {
    await fsp.mkdir(invocationRoot, { recursive: true });
    const children = [];
    const samples = [];
    const failures = [];
    for (const id of [1, 2]) {
      const child = await runChild(id);
      children.push(child);
      const found = await findReceipt(child.childRoot, id);
      const failureEvidence = found ? null : await findFailureEvidence(child.childRoot);
      samples.push({ sampleId: id, receiptPath: found?.path ?? null, receipt: found?.receipt ?? null, failureEvidence });
      if (child.exitCode !== 0) failures.push(`Sample ${id} Electron child exited ${child.exitCode ?? 'before exit'}: ${child.error ?? child.stderr ?? child.stdout}`);
      if (!found) failures.push(`Sample ${id} did not write a fresh receipt for wrapper run ${wrapperRunId}.`);
      else if (found.receipt.auto !== 'PASS') failures.push(`Sample ${id} receipt auto status was ${found.receipt.auto}.`);
    }

    if (failures.length === 0) {
      const first = samples[0].receipt;
      const second = samples[1].receipt;
      try {
        if (first.wrapperRunId !== wrapperRunId || second.wrapperRunId !== wrapperRunId) throw new Error('Child receipts do not belong to this wrapper invocation.');
        if (first.sourceCommitSha !== sourceCommitSha || second.sourceCommitSha !== sourceCommitSha) throw new Error('Child receipts do not identify the same wrapper source commit.');
        if (first.fixture?.projectId === second.fixture?.projectId) throw new Error('The two samples do not use distinct Project IDs.');
        if (first.fixture?.projectFileSha256 === second.fixture?.projectFileSha256) throw new Error('The two samples do not have distinct persisted Project hashes.');
        const firstEvidence = validateBackgroundEvidence(first, 'Sample 1');
        const secondEvidence = validateBackgroundEvidence(second, 'Sample 2');
        if (new Set([...firstEvidence.backgrounds, ...secondEvidence.backgrounds].map((entry) => entry.sha256)).size !== 6) {
          throw new Error('The two fresh samples do not have six distinct background SHA-256 values.');
        }
        if (!firstEvidence.output?.sha256 || !secondEvidence.output?.sha256 || firstEvidence.output.sha256 === secondEvidence.output.sha256) {
          throw new Error('The two distinct Project exports must have different MP4 SHA-256 hashes.');
        }
        validateSaveReopen(first);
        if (second.fixture?.dirtyAtCapture !== true || second.fixture?.saveReopen !== null) {
          throw new Error('Sample 2 must retain the unsaved editor snapshot export path.');
        }
        validateFailureInjection(first);
      } catch (error) {
        failures.push(error.message);
      }
    }

    const combined = {
      issue: 830,
      parentIssue: 827,
      workOrder: 'DL-04 two-sample independent backgrounds, save/reopen, and late-Shot failure acceptance',
      wrapperRunId,
      sourceCommitSha,
      startedAt,
      completedAt: new Date().toISOString(),
      auto: failures.length === 0 ? 'PASS' : samples.some((sample) => sample.receipt?.auto === 'PASS') ? 'PARTIAL' : 'FAIL',
      owner: 'FOLLOWUP_REVIEW_READY',
      ownerReview: 'DEFERRED_TO_DL07',
      multiShotAvAccepted: false,
      samples,
      electronChildren: children,
      failures,
    };
    const receiptPath = path.join(invocationRoot, 'combined-acceptance-receipt.json');
    await fsp.writeFile(receiptPath, JSON.stringify(combined, null, 2), 'utf8');
    if (failures.length > 0) {
      console.error(`FAIL #830 DL-04 one-invocation acceptance: ${receiptPath}\n${failures.join('\n')}`);
      app.exit(1);
      return;
    }
    console.log(`PASS #830 DL-04 two-Project Windows Electron acceptance: ${receiptPath}`);
    app.quit();
  }

  main().catch(async (error) => {
    const failureReceipt = {
      issue: 830,
      parentIssue: 827,
      wrapperRunId,
      sourceCommitSha,
      startedAt,
      completedAt: new Date().toISOString(),
      auto: 'FAIL',
      error: String(error.stack ?? error),
      owner: 'FOLLOWUP_REVIEW_READY',
      ownerReview: 'DEFERRED_TO_DL07',
      multiShotAvAccepted: false,
    };
    await fsp.mkdir(invocationRoot, { recursive: true });
    await fsp.writeFile(path.join(invocationRoot, 'combined-acceptance-receipt.json'), JSON.stringify(failureReceipt, null, 2), 'utf8').catch(() => undefined);
    console.error(error.stack ?? error);
    app.exit(1);
  });
}
