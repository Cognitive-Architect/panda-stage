const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { summarizeMemoryTrend } = require('./issue851-o2-memory-trend.cjs');

const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const {
  ExportPreparationService,
} = require('../dist-electron/main/services/ExportPreparationService.js');
const {
  NodeExportPreparationFileStore,
} = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const {
  FileSystemService,
} = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const {
  resolveMediaToolPaths,
} = require('../dist-electron/main/services/production-resources.js');
const {
  HiddenWindowManager,
} = require('../dist-electron/main/windows/hidden-window-manager.js');
const {
  registerIpcHandlers,
} = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const {
  registerExportPreparationIpcHandlers,
} = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

const repoRoot = path.resolve(__dirname, '..');
const codeSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
const baseO1Sha = '3a05e3efba6e08bc52dc45f732f242a0f116b794';
const baseSafeSha = '143d74c258764fede19cbd1ceb5435d6d6acaf90';
const isMemoryPreflight = process.argv.includes('--preflight-memory');
const mode = process.env.PANDA_STAGE_O2_PNG_MODE ||
  (isMemoryPreflight ? 'legacy-blob' : process.argv[2] || 'legacy-blob');
const drawMode = 'explicit-sync';
const fixtureRoot = path.resolve(
  process.env.PANDA_STAGE_O2_FIXTURE_ROOT ||
    'D:\\PandaStage-Acceptance\\issue849-o2',
);
const measurementPreflightPath = path.resolve(
  process.env.PANDA_STAGE_O2_MEMORY_PREFLIGHT_RECEIPT ||
    path.join(fixtureRoot, 'measurement-preflight-f01.json'),
);
const runName = process.env.PANDA_STAGE_O2_RUN_ID ||
  (mode === 'legacy-blob' ? 'f01-legacy-blob' : 'f01-worker-png');
if (!/^[a-z0-9-]+$/iu.test(runName)) throw new Error(`Invalid Issue #851 run name: ${runName}`);
const runRoot = path.join(fixtureRoot, 'runs', runName);
const projectRoot = path.join(fixtureRoot, 'project');
const projectPath = path.join(projectRoot, 'project.json');
const CANCEL_OUTPUT_PATH = path.join(runRoot, 'cancelled-output.mp4');
const PREPARATION_REVISION = 7;
const OPEN_INSTANCE_ID = 849;
const RUN_TIMEOUT_MS = 295_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function sampleHiddenRendererMemory(hiddenWindow, sampleIndex, startedAt) {
  const rendererPid = hiddenWindow.webContents.getOSProcessId();
  const deadline = Date.now() + 5_000;
  let rendererMetric = null;
  while (Date.now() < deadline) {
    rendererMetric = app.getAppMetrics().find((metric) => metric.pid === rendererPid) ?? null;
    if (rendererMetric) break;
    await delay(100);
  }
  assert(rendererMetric, `No app metric matched hidden renderer pid ${rendererPid}.`);
  const { privateBytes, workingSetSize, peakWorkingSetSize } = rendererMetric.memory;
  assert(
    Number.isFinite(privateBytes) && privateBytes > 0 &&
      Number.isFinite(workingSetSize) && workingSetSize > 0 &&
      Number.isFinite(peakWorkingSetSize) && peakWorkingSetSize > 0,
    `Hidden renderer pid ${rendererPid} returned incomplete memory metrics.`,
  );
  return {
    sampleIndex,
    elapsedMs: Math.round(performance.now() - startedAt),
    rendererPid,
    privateBytes: privateBytes * 1_024,
    workingSetBytes: workingSetSize * 1_024,
    peakWorkingSetBytes: peakWorkingSetSize * 1_024,
  };
}

async function runMemoryPreflight() {
  assert(process.platform === 'win32', 'Memory sampler preflight must run on Windows.');
  assert(branch === 'issue-851-o2-f01', `Expected isolated O2-F01 branch, got ${branch}.`);
  const existingReceipt = await fs.stat(measurementPreflightPath).then(() => true, () => false);
  assert(!existingReceipt, `Refusing to overwrite memory preflight receipt: ${measurementPreflightPath}`);
  await app.whenReady();
  let hiddenWindow = null;
  const startedAt = performance.now();
  const samples = [];
  let failure = null;
  try {
    hiddenWindow = new BrowserWindow({
      width: 480,
      height: 320,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await hiddenWindow.loadURL('data:text/html,<html><body>O2-F01 memory sampler preflight</body></html>');
    for (let index = 0; index < 3; index += 1) {
      samples.push(await sampleHiddenRendererMemory(hiddenWindow, index, startedAt));
      if (index < 2) await delay(500);
    }
  } catch (error) {
    failure = error;
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) hiddenWindow.destroy();
  }

  const receipt = {
    status: failure ? 'STOP' : 'PASS',
    issue: 851,
    codeSha,
    branch,
    source: 'app.getAppMetrics() matched to hiddenWindow.webContents.getOSProcessId()',
    units: 'bytes (Electron memory values in KiB multiplied by 1024)',
    intervalMs: 500,
    samples,
    error: failure ? (failure.stack || String(failure)) : null,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
  await fs.writeFile(measurementPreflightPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ ...receipt, receiptPath: measurementPreflightPath }, null, 2) + '\n');
  if (failure) throw failure;
  app.quit();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function hashProjectInputs(project) {
  const projectBytes = await fs.readFile(projectPath);
  const assets = [];
  for (const asset of project.assets) {
    const bytes = await fs.readFile(path.join(projectRoot, asset.relativePath));
    assets.push({
      assetId: asset.id,
      relativePath: asset.relativePath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  return {
    projectFileSha256: sha256(projectBytes),
    projectFileByteLength: projectBytes.byteLength,
    projectAssets: assets.sort((left, right) => left.assetId.localeCompare(right.assetId)),
  };
}

function makeCandidateFingerprint(candidate) {
  const projectSha256 = sha256(Buffer.from(stableJson(candidate.project), 'utf8'));
  const media = candidate.mediaManifest
    .map(({ assetId, kind, mimeType, sha256: digest, byteLength }) => ({
      assetId,
      kind,
      mimeType,
      sha256: digest,
      byteLength,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const payload = {
    projectSha256,
    media,
    cameraMode: candidate.cameraMode,
    renderSettings: candidate.renderSettings,
  };
  return {
    projectSha256,
    media,
    cameraMode: candidate.cameraMode,
    renderSettings: candidate.renderSettings,
    frozenInputSha256: sha256(Buffer.from(stableJson(payload), 'utf8')),
  };
}

async function fontFingerprint() {
  const windowsRoot = process.env.WINDIR || 'C:\\Windows';
  const candidatePaths = [
    path.join(windowsRoot, 'Fonts', 'arial.ttf'),
    path.join(windowsRoot, 'Fonts', 'arialbd.ttf'),
  ];
  const files = [];
  for (const filePath of candidatePaths) {
    try {
      const bytes = await fs.readFile(filePath);
      files.push({ path: filePath, byteLength: bytes.byteLength, sha256: sha256(bytes) });
    } catch {
      files.push({ path: filePath, missing: true });
    }
  }
  return files;
}

class EvidenceFileSystemService extends FileSystemService {
  constructor(jobRoot, capturedFramesRoot) {
    super(jobRoot);
    this.capturedFramesRoot = capturedFramesRoot;
  }

  async writeFrame(jobDirectory, fileName, pngBytes) {
    await super.writeFrame(jobDirectory, fileName, pngBytes);
    const jobEvidenceRoot = path.join(
      this.capturedFramesRoot,
      path.basename(jobDirectory),
    );
    await fs.mkdir(jobEvidenceRoot, { recursive: true });
    await fs.writeFile(
      path.join(jobEvidenceRoot, fileName),
      pngBytes,
      { flag: 'wx' },
    );
  }
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main() {
  assert(mode === 'legacy-blob' || mode === 'worker-png', `Invalid PNG mode: ${mode}`);
  assert(process.platform === 'win32', 'Issue #851 formal export acceptance must run on Windows.');
  assert(branch === 'issue-851-o2-f01', `Expected isolated O2-F01 branch, got ${branch}.`);
  const worktreeStatus = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  assert(worktreeStatus === '', `O2 measurement requires a clean committed tree: ${worktreeStatus}`);
  let sameRoundLegacyPeakPrivateBytes = null;
  if (mode === 'worker-png') {
    const legacyReceiptPath = path.join(fixtureRoot, 'runs', 'f01-legacy-blob', 'receipt.json');
    const legacyReceipt = JSON.parse(await fs.readFile(legacyReceiptPath, 'utf8'));
    assert(legacyReceipt.status === 'PASS' && legacyReceipt.issue === 851,
      'Worker B requires a completed same-round A receipt.');
    assert(legacyReceipt.runName === 'f01-legacy-blob' && legacyReceipt.drawMode === 'explicit-sync' &&
      legacyReceipt.pngMode === 'legacy-blob', 'Worker B found an unexpected A run or mode.');
    assert(legacyReceipt.codeSha === codeSha && legacyReceipt.branch === branch &&
      legacyReceipt.baseSafeSha === baseSafeSha,
    'Worker B and A must use the same committed source and safe baseline.');
    sameRoundLegacyPeakPrivateBytes = legacyReceipt.hiddenRendererMemory?.privateBytes?.maxMs;
    assert(Number.isFinite(sameRoundLegacyPeakPrivateBytes) && sameRoundLegacyPeakPrivateBytes > 0,
      'Worker B requires a measured A hidden-renderer private-memory peak.');
  }
  const projectBytes = await fs.readFile(projectPath);
  const project = ProjectSchema.parse(JSON.parse(projectBytes.toString('utf8')));
  const beforeInputs = await hashProjectInputs(project);
  const outputPath = path.join(runRoot, 'formal-output.mp4');
  const framesRoot = path.join(runRoot, 'decoded-input-frames');
  const tempJobsRoot = path.join(runRoot, 'frame-job-temp');
  const frozenMediaRoot = path.join(runRoot, 'frozen-media-temp');
  const existingRun = await fs.stat(runRoot).then(() => true, () => false);
  assert(!existingRun, `Refusing to reuse an existing Issue #851 run directory: ${runRoot}`);
  await fs.mkdir(framesRoot, { recursive: true });

  let mainWindow = null;
  let hiddenManager = null;
  let exportService = null;
  let preparationService = null;
  let preparationFileStore;
  let removeExportHandlers = null;
  let removePreparationHandlers = null;
  let activeHandle = null;
  let selectionTargetPath = outputPath;
  let timeout = null;
  const outputUpdates = [];
  const frameResponseTimings = [];
  const hiddenFrameTimings = [];
  const workerLifecycle = [];
  const selectedModeReports = [];
  const hiddenRendererMemorySamples = [];
  const hiddenMemorySamplingErrors = [];
  const selectedModes = [];
  const candidateFinalizePromises = new Map();
  const phaseUpdates = [];
  const runStartedAt = performance.now();
  let result = null;
  let failure = null;
  let preparationMs = null;
  let rendererInvokeMs = null;
  let mainJobMs = null;
  let candidateFingerprint;
  let fontFiles;
  let mediaTools;
  let actualDrawMode = null;
  let actualPngMode = null;
  let memorySampleTimer = null;
  let memorySampleJobId = null;
  let memoryJobStartedAt = null;
  let sampleHiddenMemoryNow = () => {};
  let primaryMemoryJobId = null;
  let liveMemoryStopReason = null;
  let liveMemoryCancelAccepted = null;
  let failureReceipt = null;
  let primaryHiddenWindowClosed;

  try {
    await app.whenReady();
    mainWindow = new BrowserWindow({
      width: 480,
      height: 320,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../dist-electron/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      const jobPrefix = 'PANDA_STAGE_O1_JOB ';
      if (message.startsWith(jobPrefix)) {
        try {
          outputUpdates.push({ at: performance.now(), update: JSON.parse(message.slice(jobPrefix.length)) });
        } catch {
          // Ignore unrelated renderer console messages.
        }
      }
    });
    await mainWindow.loadURL('data:text/html,<html><body>Issue 849 O2 acceptance</body></html>');
    await mainWindow.webContents.executeJavaScript(`
      if (!window.pandaStage?.export || !window.pandaStage?.exportPreparation) {
        throw new Error('Panda Stage preload API did not load in the acceptance window.');
      }
      window.pandaStage.export.onUpdate((update) => {
        console.info('PANDA_STAGE_O1_JOB ' + JSON.stringify(update));
      });
      true;
    `);

    let trackedSnapshot = {
      project,
      revision: PREPARATION_REVISION,
      dirty: false,
      openInstanceId: OPEN_INSTANCE_ID,
    };
    preparationFileStore = new NodeExportPreparationFileStore(frozenMediaRoot);
    preparationService = new ExportPreparationService({
      getCurrentProjectSnapshot: (candidateRoot) =>
        path.resolve(candidateRoot) === path.resolve(projectRoot)
          ? trackedSnapshot
          : null,
      fileStore: preparationFileStore,
    });
    hiddenManager = new HiddenWindowManager({
      formalDrawMode: drawMode,
      formalPngMode: mode,
      frameTiming: true,
    });
    const originalPrepareJob = hiddenManager.prepareJob.bind(hiddenManager);
    hiddenManager.prepareJob = async (kind) => {
      await originalPrepareJob(kind);
      if (kind === 'formal') {
        if (memorySampleTimer) clearInterval(memorySampleTimer);
        actualDrawMode = hiddenManager.getDiagnostics().drawMode;
        actualPngMode = hiddenManager.getDiagnostics().pngMode;
        selectedModes.push({ jobId: null, drawMode: actualDrawMode, pngMode: actualPngMode });
        const hiddenWindow = hiddenManager.getWindow();
        hiddenWindow?.webContents.on('console-message', (_event, _level, message) => {
          const framePrefix = 'PANDA_STAGE_O1_FRAME ';
          if (message.startsWith(framePrefix)) {
            try {
              hiddenFrameTimings.push(JSON.parse(message.slice(framePrefix.length)));
            } catch {
              // Ignore unrelated hidden-renderer console messages.
            }
          }
          const workerPrefix = 'PANDA_STAGE_O2_WORKER ';
          if (message.startsWith(workerPrefix)) {
            try {
              workerLifecycle.push(JSON.parse(message.slice(workerPrefix.length)));
            } catch {
              // Ignore unrelated hidden-renderer console messages.
            }
          }
          const modePrefix = 'PANDA_STAGE_O2_JOB_MODE ';
          if (message.startsWith(modePrefix)) {
            try {
              selectedModeReports.push(JSON.parse(message.slice(modePrefix.length)));
            } catch {
              // Ignore unrelated hidden-renderer console messages.
            }
          }
        });
        const sampleHiddenMemory = () => {
          if (!hiddenWindow || hiddenWindow.isDestroyed()) return;
          try {
            const rendererPid = hiddenWindow.webContents.getOSProcessId();
            const rendererMetric = app.getAppMetrics().find((metric) => metric.pid === rendererPid);
            if (!rendererMetric) {
              hiddenMemorySamplingErrors.push(`No app metric for hidden renderer pid ${rendererPid}.`);
              return;
            }
            const privateBytes = rendererMetric.memory.privateBytes;
            const workingSetBytes = rendererMetric.memory.workingSetSize;
            if (!Number.isFinite(privateBytes) || !Number.isFinite(workingSetBytes)) {
              hiddenMemorySamplingErrors.push(`Hidden renderer pid ${rendererPid} returned incomplete memory metrics.`);
              return;
            }
            const sample = {
              jobId: memorySampleJobId,
              at: performance.now(),
              elapsedMs: memoryJobStartedAt === null
                ? null
                : Math.round(performance.now() - memoryJobStartedAt),
              rendererPid,
              privateBytes: privateBytes * 1_024,
              workingSetBytes: workingSetBytes * 1_024,
              peakWorkingSetBytes: rendererMetric.memory.peakWorkingSetSize * 1_024,
            };
            hiddenRendererMemorySamples.push(sample);
            if (
              mode === 'worker-png' &&
              sample.jobId === primaryMemoryJobId &&
              sameRoundLegacyPeakPrivateBytes !== null &&
              !liveMemoryStopReason
            ) {
              const primarySamples = hiddenRendererMemorySamples.filter((entry) =>
                entry.jobId === primaryMemoryJobId && Number.isFinite(entry.elapsedMs),
              );
              const trend = summarizeMemoryTrend(primarySamples);
              if (sample.privateBytes > sameRoundLegacyPeakPrivateBytes * 2) {
                liveMemoryStopReason =
                  `Worker B private memory crossed 2x same-round A peak (${sample.privateBytes} > ${sameRoundLegacyPeakPrivateBytes * 2} bytes).`;
              } else if (trend.sustainedUncontrolledGrowth) {
                liveMemoryStopReason =
                  `Worker B showed sustained private-memory growth (${trend.increaseBytes} bytes across ${trend.sampleCount} samples).`;
              }
              if (liveMemoryStopReason) {
                liveMemoryCancelAccepted = exportService?.cancelJob(primaryMemoryJobId) ?? false;
                if (!liveMemoryCancelAccepted) hiddenManager?.cancelJob(primaryMemoryJobId);
                process.stderr.write(`O2-F01 live memory stop: ${liveMemoryStopReason}\n`);
              }
            }
          } catch (error) {
            hiddenMemorySamplingErrors.push(error instanceof Error ? error.message : String(error));
          }
        };
        sampleHiddenMemoryNow = sampleHiddenMemory;
        sampleHiddenMemory();
        memorySampleTimer = setInterval(sampleHiddenMemory, 500);
      }
    };
    const originalRenderFrame = hiddenManager.renderFrame.bind(hiddenManager);
    hiddenManager.renderFrame = async (request) => {
      const startedAt = performance.now();
      const response = await originalRenderFrame(request);
      frameResponseTimings.push({
        jobId: request.jobId,
        frameIndex: request.frameIndex,
        timeMs: request.timeMs,
        shotId: request.shotId ?? null,
        shotLocalTimeMs: request.shotLocalTimeMs ?? null,
        elapsedMs: performance.now() - startedAt,
        pngByteLength: response.pngBytes.byteLength,
      });
      return response;
    };

    mediaTools = resolveMediaToolPaths({
      isPackaged: false,
      resourcesPath: process.resourcesPath,
    });
    const ffmpeg = new FFmpegAdapter({
      ffmpegPath: mediaTools.ffmpegPath,
      ffprobePath: mediaTools.ffprobePath,
    });
    const fileSystem = new EvidenceFileSystemService(tempJobsRoot, framesRoot);
    exportService = new ExportService(hiddenManager, fileSystem, ffmpeg);
    exportService.subscribe((update) => {
      phaseUpdates.push({ at: performance.now(), update });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
      }
    });
    removeExportHandlers = registerIpcHandlers({
      getMainWindow: () => mainWindow,
      getHiddenWindow: () => hiddenManager.getWindow(),
      markHiddenReady: (senderId) => hiddenManager.markReady(senderId),
      markProbeLoaded: (senderId, payload) => hiddenManager.markProbeLoaded(senderId, payload),
      markFormalLoaded: (senderId, payload) => hiddenManager.markFormalLoaded(senderId, payload),
      markFrameReady: (senderId, payload) => hiddenManager.markFrameReady(senderId, payload),
      markFrameFailed: (senderId, payload) => hiddenManager.markFrameFailed(senderId, payload),
      startFullProbe: () => {
        throw new Error('The O2 verifier only starts formal Project exports.');
      },
      startFormalExport: async (request) => {
        const input = await preparationService.acquireCandidateForExport(
          request.snapshotId,
          request.reuseSnapshot,
        );
        candidateFingerprint = makeCandidateFingerprint(input.candidate);
        let handle;
        try {
          handle = exportService.startFormalExport(
            input,
            () => preparationService.assertOutputTargetUnchanged(request.snapshotId),
          );
        } catch (error) {
          await preparationService.finalizeCandidateExport(request.snapshotId);
          throw error;
        }
        if (primaryMemoryJobId === null) primaryMemoryJobId = handle.jobId;
        activeHandle = handle;
        memorySampleJobId = handle.jobId;
        memoryJobStartedAt = performance.now();
        sampleHiddenMemoryNow();
        void handle.completion.then(
          () => {
            const finalizePromise = preparationService.finalizeCandidateExport(request.snapshotId);
            candidateFinalizePromises.set(request.snapshotId, finalizePromise);
            return finalizePromise;
          },
          () => {
            const finalizePromise = preparationService.finalizeCandidateExport(request.snapshotId);
            candidateFinalizePromises.set(request.snapshotId, finalizePromise);
            return finalizePromise;
          },
        );
        return { jobId: handle.jobId, status: 'running' };
      },
      cancelExport: (jobId) => {
        const accepted = exportService.cancelJob(jobId);
        return {
          jobId,
          accepted,
          status: exportService.getJob(jobId)?.status ?? 'cancelled',
        };
      },
      revealExportOutput: async (jobId) => Boolean(exportService.getCompletedOutputPath(jobId)),
    });
    removePreparationHandlers = registerExportPreparationIpcHandlers({
      getMainWindow: () => mainWindow,
      service: preparationService,
      selectOutputPath: async (_window, request) => {
        assert(path.resolve(request.projectRoot) === path.resolve(projectRoot), 'Output selection used a different Project root.');
        assert(request.projectId === project.id, 'Output selection used a different Project id.');
        return selectionTargetPath;
      },
    });

    fontFiles = await fontFingerprint();
    const attemptId = crypto.randomUUID();
    const preparationStartedAt = performance.now();
    const exported = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const project = ${JSON.stringify(project)};
        const request = {
          projectRoot: ${JSON.stringify(projectRoot)},
          projectId: ${JSON.stringify(project.id)},
          projectName: ${JSON.stringify(project.name)},
          openInstanceId: ${OPEN_INSTANCE_ID},
        };
        const output = await window.pandaStage.exportPreparation.selectOutput(request);
        if (output.status !== 'selected') {
          throw new Error('Formal output selection was blocked: ' + JSON.stringify(output));
        }
        const prepared = await window.pandaStage.exportPreparation.prepare({
          selectionId: output.selectionId,
          attemptId: ${JSON.stringify(attemptId)},
          projectRoot: ${JSON.stringify(projectRoot)},
          projectId: ${JSON.stringify(project.id)},
          openInstanceId: ${OPEN_INSTANCE_ID},
          revision: ${PREPARATION_REVISION},
          dirty: false,
          cameraMode: 'speaker-focus',
          project,
        });
        if (prepared.status !== 'PREPARATION_READY') {
          throw new Error('Formal preparation was blocked: ' + JSON.stringify(prepared));
        }
        return {
          snapshotId: prepared.candidate.snapshotId,
          candidate: prepared.candidate,
        };
      })()
    `);
    preparationMs = performance.now() - preparationStartedAt;
    candidateFingerprint = makeCandidateFingerprint(exported.candidate);
    assert(exported.candidate.revision === PREPARATION_REVISION, 'Frozen candidate revision drifted.');
    assert(exported.candidate.dirtyAtCapture === false, 'Frozen candidate dirty state drifted.');
    assert(exported.candidate.mediaManifest.length === project.assets.length, 'Frozen media manifest omitted a Project asset.');

    const formalInvokeStartedAt = performance.now();
    timeout = setTimeout(() => {
      if (activeHandle) exportService.cancelJob(activeHandle.jobId);
    }, RUN_TIMEOUT_MS);
    const startResponse = await mainWindow.webContents.executeJavaScript(
      `window.pandaStage.export.startFormal(${JSON.stringify(exported.snapshotId)}, false)`,
    );
    rendererInvokeMs = performance.now() - formalInvokeStartedAt;
    assert(startResponse.status === 'running', 'Formal Export IPC did not start a Job.');
    assert(activeHandle?.jobId === startResponse.jobId, 'Export Job identity changed across Main IPC.');
    await waitUntil(
      () => selectedModes.some((entry) => entry.jobId === null),
      10_000,
      'Formal HiddenWindowManager did not record its draw mode within 10 seconds.',
    );
    selectedModes.at(-1).jobId = startResponse.jobId;
    assert(actualDrawMode === drawMode, `Selected draw mode ${actualDrawMode} does not match required mode ${drawMode}.`);
    assert(actualPngMode === mode, `Selected PNG mode ${actualPngMode} does not match requested mode ${mode}.`);
    const primaryHandle = activeHandle;

    const mainJobStartedAt = performance.now();
    try {
      result = await primaryHandle.completion;
    } finally {
      mainJobMs = performance.now() - mainJobStartedAt;
    }
    if (liveMemoryStopReason) {
      throw new Error(`ROLLBACK_MEMORY: ${liveMemoryStopReason}`);
    }
    clearTimeout(timeout);
    timeout = null;
    primaryHiddenWindowClosed = hiddenManager.getDiagnostics().windowOpen === false;
    assert(primaryHiddenWindowClosed, 'Primary formal Job did not release its hidden renderer window.');
    assert(result.totalFrames === 108, `Expected 108 frames, received ${result.totalFrames}.`);
    assert(result.completedFrames === 108, `Expected 108 completed frames, received ${result.completedFrames}.`);
    assert(frameResponseTimings.length === 108, `Expected 108 renderer responses, received ${frameResponseTimings.length}.`);
    assert(hiddenFrameTimings.length === 108, `Expected 108 hidden capture timing records, received ${hiddenFrameTimings.length}.`);
    const primaryWorkerLifecycle = workerLifecycle.filter((entry) => entry.jobId === result.jobId);
    if (mode === 'worker-png') {
      assert(primaryWorkerLifecycle.filter((entry) => entry.event === 'created').length === 1,
        'The formal Job did not create exactly one PNG Worker.');
    } else {
      assert(primaryWorkerLifecycle.length === 0, 'legacy-blob unexpectedly created a PNG Worker.');
    }
    assert(selectedModeReports.some((entry) =>
      entry.jobId === result.jobId && entry.drawMode === drawMode && entry.pngMode === mode),
    'The hidden renderer did not report the actual formal Job modes.');
    assert(candidateFingerprint !== null, 'The formal candidate fingerprint was not recorded.');
    assert(result.elapsedMs <= 300_000, `Formal export exceeded five minutes: ${result.elapsedMs} ms.`);
    assert(result.probe.hasAudio && result.probe.audioSampleRate === 48_000, 'Output audio is not 48 kHz.');
    await candidateFinalizePromises.get(exported.snapshotId);
    const afterInputs = await hashProjectInputs(project);
    assert(stableJson(beforeInputs) === stableJson(afterInputs), 'Project or source media changed during the formal export.');

    const outputHashBeforeNoClobber = await hashFile(outputPath);
    let noClobberRejected = false;
    try {
      await fileSystem.prepareFinalOutput(outputPath, false);
    } catch {
      noClobberRejected = true;
    }
    const outputHashAfterNoClobber = await hashFile(outputPath);
    assert(noClobberRejected, 'An existing formal MP4 target was not rejected.');
    assert(outputHashBeforeNoClobber === outputHashAfterNoClobber, 'No-clobber check changed the completed MP4.');

    const primaryCandidateFingerprint = { ...candidateFingerprint };
    selectionTargetPath = CANCEL_OUTPUT_PATH;
    const cancelAttemptId = crypto.randomUUID();
    const cancelPrepared = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const project = ${JSON.stringify(project)};
        const request = {
          projectRoot: ${JSON.stringify(projectRoot)},
          projectId: ${JSON.stringify(project.id)},
          projectName: ${JSON.stringify(project.name)},
          openInstanceId: ${OPEN_INSTANCE_ID},
        };
        const output = await window.pandaStage.exportPreparation.selectOutput(request);
        if (output.status !== 'selected') {
          throw new Error('Cancellation target selection was blocked: ' + JSON.stringify(output));
        }
        const prepared = await window.pandaStage.exportPreparation.prepare({
          selectionId: output.selectionId,
          attemptId: ${JSON.stringify(cancelAttemptId)},
          projectRoot: ${JSON.stringify(projectRoot)},
          projectId: ${JSON.stringify(project.id)},
          openInstanceId: ${OPEN_INSTANCE_ID},
          revision: ${PREPARATION_REVISION},
          dirty: false,
          cameraMode: 'speaker-focus',
          project,
        });
        if (prepared.status !== 'PREPARATION_READY') {
          throw new Error('Cancellation formal preparation was blocked: ' + JSON.stringify(prepared));
        }
        return { snapshotId: prepared.candidate.snapshotId, candidate: prepared.candidate };
      })()
    `);
    const cancelCandidateFingerprint = makeCandidateFingerprint(cancelPrepared.candidate);
    assert(cancelCandidateFingerprint.frozenInputSha256 === primaryCandidateFingerprint.frozenInputSha256,
      'Cancellation smoke test did not use the same frozen Project and media.');
    const cancelFrameStart = frameResponseTimings.length;
    const selectedModeCountBeforeCancel = selectedModes.length;
    const cancellationStartedAt = performance.now();
    const cancelStartResponse = await mainWindow.webContents.executeJavaScript(
      `window.pandaStage.export.startFormal(${JSON.stringify(cancelPrepared.snapshotId)}, false)`,
    );
    assert(cancelStartResponse.status === 'running', 'Cancellation smoke formal Job did not start.');
    const cancelHandle = activeHandle;
    assert(cancelHandle?.jobId === cancelStartResponse.jobId, 'Cancellation smoke Job identity changed across Main IPC.');
    await waitUntil(
      () => selectedModes.length > selectedModeCountBeforeCancel,
      10_000,
      'Cancellation HiddenWindowManager did not record its draw mode within 10 seconds.',
    );
    selectedModes.at(-1).jobId = cancelStartResponse.jobId;
    assert(actualDrawMode === drawMode, `Cancellation smoke selected draw mode ${actualDrawMode}, expected ${drawMode}.`);
    assert(actualPngMode === mode, `Cancellation smoke selected PNG mode ${actualPngMode}, expected ${mode}.`);
    await waitUntil(
      () => frameResponseTimings.some((frame) => frame.jobId === cancelStartResponse.jobId),
      20_000,
      'Cancellation smoke did not receive its first frame within 20 seconds.',
    );
    const cancelResponse = await mainWindow.webContents.executeJavaScript(
      `window.pandaStage.export.cancel(${JSON.stringify(cancelStartResponse.jobId)})`,
    );
    assert(cancelResponse.accepted === true, 'Formal Export API rejected cancellation of the active Job.');
    let cancellationError = null;
    try {
      await cancelHandle.completion;
    } catch (error) {
      cancellationError = error;
    }
    assert(cancellationError, 'Cancellation smoke Job completed instead of cancelling.');
    await candidateFinalizePromises.get(cancelPrepared.snapshotId);
    const cancelledJob = exportService.getJob(cancelStartResponse.jobId);
    assert(cancelledJob?.status === 'cancelled', `Cancellation Job status was ${cancelledJob?.status ?? 'missing'}.`);
    assert(!(await fs.stat(CANCEL_OUTPUT_PATH).then(() => true, () => false)), 'Cancelled formal Job created a final MP4.');
    assert(preparationFileStore.getOwnedPath(cancelPrepared.snapshotId) === null, 'Cancelled frozen media candidate was not removed.');
    assert(frameResponseTimings.length > cancelFrameStart, 'Cancellation smoke did not render a frame before cancellation.');
    const cancellationElapsedMs = performance.now() - cancellationStartedAt;
    assert(cancellationElapsedMs < 30_000, `Cancellation smoke exceeded 30 seconds: ${cancellationElapsedMs} ms.`);
    await waitUntil(
      () => hiddenManager.getDiagnostics().windowOpen === false,
      5_000,
      'Cancellation did not release its hidden renderer window.',
    );
    let cancelWorkerLifecycle = workerLifecycle.filter((entry) => entry.jobId === cancelStartResponse.jobId);
    let cancelledRendererClosed = hiddenManager.getDiagnostics().windowOpen === false;
    if (mode === 'worker-png') {
      assert(cancelWorkerLifecycle.filter((entry) => entry.event === 'created').length === 1,
        'Cancellation smoke did not create one PNG Worker.');
      if (!cancelledRendererClosed) {
        await waitUntil(
          () => workerLifecycle.some((entry) => entry.jobId === cancelStartResponse.jobId && entry.event === 'terminated') ||
            hiddenManager.getDiagnostics().windowOpen === false,
          5_000,
          'Cancellation did not terminate its PNG Worker or close its hidden renderer.',
        );
        cancelledRendererClosed = hiddenManager.getDiagnostics().windowOpen === false;
      }
      assert(cancelledRendererClosed ||
        workerLifecycle.some((entry) => entry.jobId === cancelStartResponse.jobId && entry.event === 'terminated'),
      'Cancellation left its PNG Worker without an observed termination path.');
      cancelWorkerLifecycle = workerLifecycle.filter((entry) => entry.jobId === cancelStartResponse.jobId);
    }
    const ffmpegActiveProcessCount = exportService.getActiveProcessCount();
    assert(ffmpegActiveProcessCount === 0,
      `FFmpeg child processes remain after cleanup: ${ffmpegActiveProcessCount}.`);

    const tempJobEntries = await fs.readdir(tempJobsRoot);
    const frozenMediaEntries = await fs.readdir(frozenMediaRoot);
    const outputStagingFiles = (await fs.readdir(runRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith('.panda-stage-export-'))
      .map((entry) => entry.name);
    assert(tempJobEntries.length === 0, `Temporary frame-job directories remain: ${tempJobEntries.join(', ')}`);
    assert(frozenMediaEntries.length === 0, `Frozen media candidates remain: ${frozenMediaEntries.join(', ')}`);
    assert(outputStagingFiles.length === 0, `Formal output staging files remain: ${outputStagingFiles.join(', ')}`);
    assert(preparationFileStore.getOwnedPath(exported.snapshotId) === null, 'Completed frozen media candidate is still owned.');
    assert(hiddenManager.getDiagnostics().windowOpen === false, 'Hidden render window remained open after Job cleanup.');
    assert(outputHashBeforeNoClobber === await hashFile(outputPath), 'Cancellation or cleanup changed the completed formal MP4.');

    const finalInputs = await hashProjectInputs(project);
    assert(stableJson(beforeInputs) === stableJson(finalInputs), 'Project or source media changed during the cancellation smoke test.');

    const primaryFrameResponses = frameResponseTimings.filter((frame) => frame.jobId === result.jobId);
    const primaryHiddenTimings = hiddenFrameTimings.filter((frame) => frame.jobId === result.jobId);
    const primaryMemorySamples = hiddenRendererMemorySamples.filter((sample) => sample.jobId === result.jobId);
    assert(primaryMemorySamples.length > 0, 'No hidden renderer memory samples were recorded.');
    const frameDirectory = path.join(framesRoot, result.jobId);

    const frameHashes = await Promise.all(
      primaryFrameResponses.map(async (frame) => ({
        frameIndex: frame.frameIndex,
        timeMs: frame.timeMs,
        shotId: frame.shotId,
        shotLocalTimeMs: frame.shotLocalTimeMs,
        pngSha256: sha256(
          await fs.readFile(
            path.join(
              frameDirectory,
              `frame_${String(frame.frameIndex).padStart(6, '0')}.png`,
            ),
          ),
        ),
        pngByteLength: frame.pngByteLength,
      })),
    );
    const phases = summarizePhases(phaseUpdates, result.jobId);
    const receipt = {
      status: 'PASS',
      issue: 851,
      codeSha,
      branch,
      baseO1Sha,
      baseSafeSha,
      runName,
      drawMode: actualDrawMode,
      pngMode: actualPngMode,
      jobId: result.jobId,
      fixtureRoot,
      projectRoot,
      outputPath,
      projectInputBefore: beforeInputs,
      projectInputAfter: finalInputs,
      projectInputUnchanged: stableJson(beforeInputs) === stableJson(finalInputs),
      frozenCandidate: {
        ...primaryCandidateFingerprint,
        snapshotId: exported.snapshotId,
        revision: exported.candidate.revision,
        dirtyAtCapture: exported.candidate.dirtyAtCapture,
        mediaManifest: exported.candidate.mediaManifest.map((entry) => ({
          assetId: entry.assetId,
          kind: entry.kind,
          mimeType: entry.mimeType,
          byteLength: entry.byteLength,
          sha256: entry.sha256,
        })),
      },
      renderSettings: exported.candidate.renderSettings,
      cameraMode: exported.candidate.cameraMode,
      fontFiles,
      mediaTools: {
        ffmpegPath: mediaTools.ffmpegPath,
        ffprobePath: mediaTools.ffprobePath,
      },
      preparationMs,
      rendererInvokeMs,
      apiStartToCompleteMs: rendererInvokeMs + mainJobMs,
      exportServiceElapsedMs: result.elapsedMs,
      mainJobWallMs: mainJobMs,
      mainFrameReady: summarizeDurations(primaryFrameResponses.map((frame) => frame.elapsedMs)),
      hiddenRendererStages: summarizeFrameTiming(primaryHiddenTimings),
      hiddenRendererMemory: summarizeHiddenRendererMemory(primaryMemorySamples),
      hiddenRendererMemorySamples: primaryMemorySamples.map((sample) => ({
        elapsedMs: sample.elapsedMs,
        rendererPid: sample.rendererPid,
        privateBytes: sample.privateBytes,
        workingSetBytes: sample.workingSetBytes,
        peakWorkingSetBytes: sample.peakWorkingSetBytes,
      })),
      hiddenMemorySamplingErrors,
      workerLifecycle: primaryWorkerLifecycle,
      selectedModeReports: selectedModeReports.filter((entry) => entry.jobId === result.jobId),
      exportPhases: phases,
      frameCount: result.completedFrames,
      frameDirectory,
      frameHashes,
      probe: result.probe,
      peakMemory: result.render.memory,
      totalPngBytes: result.render.totalBytes,
      rendererFrameResponses: primaryFrameResponses,
      hiddenFrameTimings: primaryHiddenTimings,
      selectedJobModes: selectedModes,
      outputUpdates: outputUpdates
        .filter((entry) => entry.update.jobId === result.jobId)
        .map((entry) => ({ at: entry.at, status: entry.update.status, phase: entry.update.phase, completedFrames: entry.update.completedFrames })),
      elapsedFromVerifierStartMs: performance.now() - runStartedAt,
      cleanup: {
        frameJobDirectoriesRemoved: true,
        frozenMediaCandidateRemoved: true,
        outputStagingFilesRemoved: true,
        hiddenRenderWindowClosed: true,
        noClobberRejected,
        outputUnchangedAfterNoClobber: outputHashBeforeNoClobber === outputHashAfterNoClobber,
        cancelledJobAccepted: cancelResponse.accepted,
        cancelledJobStatus: cancelledJob.status,
        cancelledJobRenderedFrames: cancelledJob.completedFrames,
        cancelledOutputAbsent: true,
        cancellationElapsedMs,
        cancelledJobWorkerLifecycle: cancelWorkerLifecycle,
        cancelledHiddenWindowClosed: cancelledRendererClosed,
        cancelledWorkerStopped:
          mode !== 'worker-png' ||
          cancelledRendererClosed ||
          cancelWorkerLifecycle.some((entry) => entry.event === 'terminated'),
        cancelledWorkerStopEvidence:
          mode !== 'worker-png'
            ? null
            : cancelWorkerLifecycle.some((entry) => entry.event === 'terminated')
              ? 'worker-terminated-event'
              : 'hidden-renderer-destroyed',
        ffmpegActiveProcessCount,
        primaryWorkerReleasedWithHiddenWindow: primaryHiddenWindowClosed,
      },
    };
    const receiptPath = path.join(runRoot, 'receipt.json');
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ status: receipt.status, codeSha, branch, mode, jobId: result.jobId, totalFrames: result.completedFrames, elapsedMs: result.elapsedMs, renderElapsedMs: result.render.elapsedMs, receiptPath }, null, 2) + '\n');
  } catch (error) {
    failure = error;
    const primaryMemorySamples = hiddenRendererMemorySamples.filter((sample) =>
      sample.jobId === primaryMemoryJobId,
    );
    failureReceipt = {
      status: liveMemoryStopReason ? 'ROLLBACK_MEMORY' : 'STOP',
      issue: 851,
      codeSha,
      branch,
      baseO1Sha,
      baseSafeSha,
      runName,
      jobId: primaryMemoryJobId,
      drawMode,
      pngMode: mode,
      fixtureRoot,
      runRoot,
      error: error?.stack || String(error),
      liveMemoryStopReason,
      sameRoundLegacyPeakPrivateBytes,
      liveMemoryCancelAccepted,
      candidateFingerprint: candidateFingerprint ?? null,
      fontFiles: fontFiles ?? null,
      cameraMode: candidateFingerprint?.cameraMode ?? null,
      renderSettings: candidateFingerprint?.renderSettings ?? null,
      actualDrawMode,
      actualPngMode,
      preparationMs,
      rendererInvokeMs,
      mainJobMs,
      frameResponses: frameResponseTimings.length,
      hiddenFrameTimings: hiddenFrameTimings.length,
      hiddenRendererMemory: primaryMemorySamples.length > 0
        ? summarizeHiddenRendererMemory(primaryMemorySamples)
        : null,
      hiddenRendererMemorySamples: primaryMemorySamples.map((sample) => ({
        elapsedMs: sample.elapsedMs,
        rendererPid: sample.rendererPid,
        privateBytes: sample.privateBytes,
        workingSetBytes: sample.workingSetBytes,
        peakWorkingSetBytes: sample.peakWorkingSetBytes,
      })),
      hiddenMemorySamplingErrors,
      workerLifecycle,
      selectedJobModes: selectedModeReports,
      hiddenWindowDiagnostics: hiddenManager?.getDiagnostics() ?? null,
      projectInputBefore: await hashProjectInputs(project).catch(() => null),
      elapsedFromVerifierStartMs: performance.now() - runStartedAt,
    };
    process.stderr.write((error?.stack || String(error)) + '\n');
  } finally {
    if (timeout) clearTimeout(timeout);
    if (memorySampleTimer) clearInterval(memorySampleTimer);
    if (removeExportHandlers) removeExportHandlers();
    if (removePreparationHandlers) removePreparationHandlers();
    try {
      await preparationService?.dispose();
    } catch (error) {
      process.stderr.write(`Export preparation cleanup failed: ${String(error)}\n`);
      if (!failure) failure = error;
    }
    try {
      if (activeHandle && exportService?.canCancelJob(activeHandle.jobId)) {
        exportService.cancelJob(activeHandle.jobId);
      }
      hiddenManager?.releaseJob();
      primaryHiddenWindowClosed = hiddenManager?.getDiagnostics().windowOpen === false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    } catch (error) {
      process.stderr.write(`Electron acceptance cleanup failed: ${String(error)}\n`);
      if (!failure) failure = error;
    }
  }

  if (failureReceipt) {
    const tempJobEntries = await fs.readdir(tempJobsRoot).catch(() => []);
    const frozenMediaEntries = await fs.readdir(frozenMediaRoot).catch(() => []);
    const runEntries = await fs.readdir(runRoot, { withFileTypes: true }).catch(() => []);
    const outputStagingFiles = runEntries
      .filter((entry) => entry.isFile() && entry.name.startsWith('.panda-stage-export-'))
      .map((entry) => entry.name);
    const primaryJob = primaryMemoryJobId ? exportService?.getJob(primaryMemoryJobId) : null;
    failureReceipt.cleanup = {
      hiddenRenderWindowClosed: primaryHiddenWindowClosed === true,
      mainWindowClosed: !mainWindow || mainWindow.isDestroyed(),
      primaryJobStatus: primaryJob?.status ?? null,
      cancelledJobStatus: primaryJob?.status ?? null,
      cancelledOutputAbsent: !(await fs.stat(outputPath).then(() => true, () => false)),
      frameJobDirectoriesRemoved: tempJobEntries.length === 0,
      frozenMediaCandidateRemoved: frozenMediaEntries.length === 0,
      outputStagingFilesRemoved: outputStagingFiles.length === 0,
      ffmpegActiveProcessCount: exportService?.getActiveProcessCount() ?? null,
      primaryWorkerStopped:
        mode !== 'worker-png' ||
        primaryHiddenWindowClosed === true ||
        workerLifecycle.some((entry) =>
          entry.jobId === primaryMemoryJobId && entry.event === 'terminated',
        ),
    };
    await fs.writeFile(
      path.join(runRoot, 'receipt.json'),
      JSON.stringify(failureReceipt, null, 2) + '\n',
      { flag: 'wx' },
    ).catch((error) => {
      process.stderr.write(`Failed to write the STOP receipt: ${String(error)}\n`);
    });
    process.stdout.write(JSON.stringify({
      status: failureReceipt.status,
      codeSha,
      branch,
      mode,
      runName,
      jobId: primaryMemoryJobId,
      memorySamples: failureReceipt.hiddenRendererMemorySamples.length,
      receiptPath: path.join(runRoot, 'receipt.json'),
      cleanup: failureReceipt.cleanup,
    }, null, 2) + '\n');
  }

  if (failure) app.exit(1);
  else app.quit();
}

function summarizeDurations(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  return {
    count: sorted.length,
    p50Ms: sorted[Math.floor((sorted.length - 1) / 2)],
    medianMs: sorted[Math.floor((sorted.length - 1) / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    maxMs: sorted.at(-1),
  };
}

function summarizeFrameTiming(frames) {
    const fields = [
      'readyGateMs',
      'fontWaitMs',
      'synchronousDrawMs',
      'stageCaptureMs',
      'pngEncodeMs',
      'pngSnapshotMs',
      'pngTransferDispatchMs',
      'workerDrawMs',
      'workerConvertToBlobMs',
      'workerArrayBufferMs',
      'workerEncodeMs',
      'workerReturnMs',
      'workerRoundTripMs',
      'requestToPngMs',
    ];
  return Object.fromEntries(fields.map((field) => [
    field,
    summarizeDurations(frames.map((frame) => frame[field]).filter(Number.isFinite)),
  ]));
}

function summarizeHiddenRendererMemory(samples) {
  const sorted = [...samples].sort((left, right) => left.at - right.at);
  const summarize = (key) => summarizeDurations(sorted.map((sample) => sample[key]));
  return {
    sampleCount: samples.length,
    privateBytes: summarize('privateBytes'),
    workingSetBytes: summarize('workingSetBytes'),
    peakWorkingSetBytes: summarize('peakWorkingSetBytes'),
    startPrivateBytes: sorted[0]?.privateBytes ?? null,
    endPrivateBytes: sorted.at(-1)?.privateBytes ?? null,
    startWorkingSetBytes: sorted[0]?.workingSetBytes ?? null,
    endWorkingSetBytes: sorted.at(-1)?.workingSetBytes ?? null,
  };
}

function summarizePhases(entries, jobId) {
  const updates = entries
    .filter((entry) => entry.update.jobId === jobId)
    .sort((left, right) => left.at - right.at);
  if (updates.length === 0) return {};
  const totals = {};
  let phase = updates[0].update.phase;
  let phaseStartedAt = updates[0].at;
  for (let index = 1; index < updates.length; index += 1) {
    const current = updates[index];
    if (current.update.phase === phase) continue;
    totals[phase] = (totals[phase] ?? 0) + current.at - phaseStartedAt;
    phase = current.update.phase;
    phaseStartedAt = current.at;
  }
  const last = updates.at(-1);
  totals[phase] = (totals[phase] ?? 0) + last.at - phaseStartedAt;
  return totals;
}

if (isMemoryPreflight) {
  runMemoryPreflight().catch((error) => {
    process.stderr.write((error?.stack || String(error)) + '\n');
    app.exit(1);
  });
} else {
  main().catch((error) => {
    process.stderr.write((error?.stack || String(error)) + '\n');
    app.exit(1);
  });
}
