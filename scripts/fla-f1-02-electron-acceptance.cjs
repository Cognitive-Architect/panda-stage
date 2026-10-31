#!/usr/bin/env node
'use strict';

const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance';
const DEFAULT_SOURCE = path.join(
  ACCEPTANCE_ROOT,
  'issue-893-r1c-20261030-0d4aecbc',
  'source-readonly.fla',
);
const DEFAULT_REFERENCE = path.join(
  ACCEPTANCE_ROOT,
  'issue-893-r1c-20261030-0d4aecbc',
  'animate-exports',
  'an-original-stage-frame-000.png',
);
const EXPECTED_SOURCE_SHA256 = '0d4aecbc159990ce54b9d0d8c31ea0f3354cd7ed86df77bac19a562dfc761fa2';
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }
    if (!current || !current.startsWith('--')) continue;
    options[current.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function isWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function realRegularFile(inputPath, label) {
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file, not a link`);
  const actual = fs.realpathSync(resolved);
  if (actual.toLocaleLowerCase('en-US') !== resolved.toLocaleLowerCase('en-US')) {
    throw new Error(`${label} resolves through an alias; supply its real path`);
  }
  const repo = fs.realpathSync(REPO_ROOT);
  if (isWithin(repo, actual)) throw new Error(`${label} must stay outside the repository`);
  return actual;
}

function makeNewOutputDirectory(inputPath) {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved)) throw new Error('Output directory already exists; refusing to overwrite private evidence');
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync(parent);
  const repo = fs.realpathSync(REPO_ROOT);
  if (isWithin(repo, realParent) || isWithin(repo, resolved)) {
    throw new Error('Output directory must stay outside the repository');
  }
  fs.mkdirSync(resolved, { recursive: false });
  return resolved;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function writeNewFile(filePath, bytes) {
  const resolved = path.resolve(filePath);
  const outputRoot = fs.realpathSync(OUTPUT_DIRECTORY);
  if (!isWithin(outputRoot, resolved)) throw new Error('Evidence file escaped the new acceptance directory');
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const fd = fs.openSync(resolved, 'wx');
  try {
    fs.writeFileSync(fd, buffer);
  } finally {
    fs.closeSync(fd);
  }
  return { file: path.basename(resolved), byteLength: buffer.byteLength, sha256: sha256(buffer) };
}

function outputDirectoryDefault() {
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replaceAll('.', '');
  return path.join(ACCEPTANCE_ROOT, `issue906-f1-02-${stamp}`);
}

function summarizePlan(plan) {
  return {
    format: plan.format,
    version: plan.version,
    planId: plan.planId,
    sessionId: plan.sessionId,
    requestId: plan.requestId,
    generation: plan.generation,
    expiresAt: plan.expiresAt,
    source: plan.source,
    target: plan.target,
    poseIdentity: plan.poseIdentity,
    stage: plan.stage,
    capability: plan.capability,
    capabilityReason: plan.capabilityReason,
    units: plan.units,
  };
}

function closeOnce(window) {
  if (window && !window.isDestroyed()) window.destroy();
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write([
    'Usage: electron scripts/fla-f1-02-electron-acceptance.cjs [--source <readonly-copy.fla>] [--reference <animate-frame.png>] [--output-dir <new-directory>]',
    'Defaults use only the previously authorized sample A and its private Animate 2023 frame export.',
  ].join('\n') + '\n');
  process.exit(0);
}

let OUTPUT_DIRECTORY;
let sourcePath;
let referencePath;
let sourceStat;
let sourceHashBefore;
let inspectionService;
let snapshotWindowManager;
let renderSession;
let partPreviewService;
let mainWindow;
let removeFlaImportHandlers;
let removeSnapshotHandlers;
let removePartPreviewHandlers;
let removeSessionListener;
let observedResponse = null;
let sessionId = null;
let sourceInspection = null;
let primaryError = null;
let memorySampler = null;
const electronMemory = {
  samplingIntervalMs: 100,
  sampleCount: 0,
  peakMainProcessRssBytes: 0,
  peakAggregateWorkingSetKilobytes: 0,
  peakAggregatePrivateBytesKilobytes: 0,
  processHighWatermarks: {},
};

function sampleElectronMemory() {
  const metrics = app.getAppMetrics();
  let aggregateWorkingSetKilobytes = 0;
  let aggregatePrivateBytesKilobytes = 0;
  let privateBytesAvailable = metrics.length > 0;
  for (const metric of metrics) {
    aggregateWorkingSetKilobytes += metric.memory.peakWorkingSetSize;
    if (typeof metric.memory.privateBytes === 'number') {
      aggregatePrivateBytesKilobytes += metric.memory.privateBytes;
    } else {
      privateBytesAvailable = false;
    }
    const key = `${metric.pid}:${metric.type}:${metric.name || ''}`;
    const previous = electronMemory.processHighWatermarks[key];
    electronMemory.processHighWatermarks[key] = {
      pid: metric.pid,
      type: metric.type,
      name: metric.name || null,
      peakWorkingSetKilobytes: Math.max(previous?.peakWorkingSetKilobytes || 0, metric.memory.peakWorkingSetSize),
      peakPrivateBytesKilobytes: typeof metric.memory.privateBytes === 'number'
        ? Math.max(previous?.peakPrivateBytesKilobytes || 0, metric.memory.privateBytes)
        : null,
    };
  }
  electronMemory.sampleCount += 1;
  electronMemory.peakMainProcessRssBytes = Math.max(electronMemory.peakMainProcessRssBytes, process.memoryUsage().rss);
  electronMemory.peakAggregateWorkingSetKilobytes = Math.max(
    electronMemory.peakAggregateWorkingSetKilobytes,
    aggregateWorkingSetKilobytes,
  );
  if (privateBytesAvailable) {
    electronMemory.peakAggregatePrivateBytesKilobytes = Math.max(
      electronMemory.peakAggregatePrivateBytesKilobytes,
      aggregatePrivateBytesKilobytes,
    );
  }
}

function startElectronMemorySampling() {
  sampleElectronMemory();
  memorySampler = setInterval(sampleElectronMemory, electronMemory.samplingIntervalMs);
  memorySampler.unref?.();
}

function stopElectronMemorySampling() {
  if (memorySampler) clearInterval(memorySampler);
  memorySampler = null;
  sampleElectronMemory();
  return electronMemory;
}

try {
  sourcePath = realRegularFile(args.source || DEFAULT_SOURCE, 'Sample A source');
  referencePath = realRegularFile(args.reference || DEFAULT_REFERENCE, 'Animate reference PNG');
  sourceStat = fs.statSync(sourcePath);
  if (sourceStat.size <= 0 || sourceStat.size > MAX_SOURCE_BYTES) {
    throw new Error(`Sample A source exceeds the existing ${MAX_SOURCE_BYTES}-byte FLA source limit`);
  }
  sourceHashBefore = sha256File(sourcePath);
  if (sourceHashBefore !== EXPECTED_SOURCE_SHA256) {
    throw new Error('Sample A source SHA-256 does not match the previously accepted readonly copy');
  }
  OUTPUT_DIRECTORY = makeNewOutputDirectory(args['output-dir'] || outputDirectoryDefault());
  const profileDirectory = path.join(OUTPUT_DIRECTORY, 'electron-profile');
  fs.mkdirSync(profileDirectory, { recursive: false });
  app.setName('Panda Stage F1-02 Acceptance');
  app.setPath('userData', profileDirectory);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function runAcceptance() {
  startElectronMemorySampling();
  const {
    FlaImportService,
  } = require('../dist-electron/main/services/FlaImportService.js');
  const {
    FlaStaticSnapshotRenderSession,
  } = require('../dist-electron/main/services/fla-static-snapshot-render-session.js');
  const {
    FlaStaticSnapshotWindowManager,
  } = require('../dist-electron/main/services/fla-static-snapshot-window-manager.js');
  const {
    FlaPartPreviewService,
  } = require('../dist-electron/main/services/FlaPartPreviewService.js');
  const {
    registerFlaImportIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-import-ipc-handlers.js');
  const {
    registerFlaStaticSnapshotIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-static-snapshot-ipc-handlers.js');
  const {
    registerFlaPartPreviewIpcHandlers,
  } = require('../dist-electron/main/ipc/register-fla-part-preview-ipc-handlers.js');
  const {
    stableRenderTargetId,
  } = require('../dist-electron/main/services/fla-static-snapshot-svg-builder.js');
  const {
    validatePngEncodedImage,
  } = require('../dist-electron/main/services/PngThumbnailValidator.js');
  const {
    FLA_STATIC_SNAPSHOT_LIMITS,
  } = require('../dist-electron/shared/fla-static-snapshot-api.js');

  const referenceBytes = fs.readFileSync(referencePath);
  const referenceInfo = validatePngEncodedImage(referenceBytes, {
    maxWidth: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth,
    maxHeight: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight,
    maxPixels: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels,
    maxEncodedBytes: FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
  });
  if (!referenceInfo) throw new Error('Animate 2023 reference is not a valid bounded PNG');
  const referenceDataUrl = `data:image/png;base64,${referenceBytes.toString('base64')}`;

  mainWindow = new BrowserWindow({
    width: 1420,
    height: 1050,
    show: false,
    title: 'Panda Stage · F1-02 acceptance',
    webPreferences: {
      preload: path.join(REPO_ROOT, 'dist-electron', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, 'fla-f1-02-preview-harness.html'));
  mainWindow.show();
  mainWindow.focus();

  inspectionService = new FlaImportService();
  removeFlaImportHandlers = registerFlaImportIpcHandlers({
    getMainWindow: () => mainWindow,
    flaImportService: inspectionService,
    flaAssetCommitService: {},
    selectFlaSource: async () => null,
  });
  snapshotWindowManager = new FlaStaticSnapshotWindowManager();
  renderSession = new FlaStaticSnapshotRenderSession({
    rasterizer: snapshotWindowManager,
    sourceLookup: {
      getSource(id) {
        const session = inspectionService.getSession(id);
        if (!session?.sourceBytes) return null;
        const { basename, sha256: normalizedSha256 } = session.ir.source;
        if (!basename || !normalizedSha256) return null;
        return {
          bytes: session.sourceBytes,
          basename,
          sha256: normalizedSha256,
          originalSourceSha256: session.originalSourceSha256 ?? normalizedSha256,
          media: session.ir.media,
        };
      },
    },
  });
  partPreviewService = new FlaPartPreviewService({
    flaImportService: inspectionService,
    renderSession,
    rasterizer: snapshotWindowManager,
  });
  removeSessionListener = inspectionService.onSessionReleased((id) => partPreviewService?.invalidateSession(id));
  removeSnapshotHandlers = registerFlaStaticSnapshotIpcHandlers({
    getMainWindow: () => mainWindow,
    renderSession,
    commitService: {},
    windowManager: snapshotWindowManager,
  });
  removePartPreviewHandlers = registerFlaPartPreviewIpcHandlers({
    getMainWindow: () => mainWindow,
    service: {
      async preview(request) {
        observedResponse = await partPreviewService.preview(request);
        return observedResponse;
      },
      cancel(request) {
        return partPreviewService.cancel(request);
      },
    },
  });

  const inspectionRequestId = crypto.randomUUID();
  sourceInspection = await inspectionService.inspectSource(sourcePath, inspectionRequestId);
  if (!sourceInspection?.ok) {
    throw new Error(`Main FLA inspection failed: ${sourceInspection?.error?.code || 'unknown error'}`);
  }
  sessionId = sourceInspection.sessionId;
  const session = inspectionService.getSession(sessionId);
  if (!session?.sourceBytes) throw new Error('Main FLA inspection session did not retain its source bytes');
  const sourceHashAfterInspection = sha256(session.sourceBytes);
  const normalizedSha256 = session.ir.source.sha256.toLowerCase();
  const rawSha256 = (session.originalSourceSha256 || sourceInspection.ir.source.sha256).toLowerCase();
  if (rawSha256 !== EXPECTED_SOURCE_SHA256 || sourceHashAfterInspection !== normalizedSha256) {
    throw new Error('Main inspection raw or normalized source identity does not match the accepted readonly source A bytes');
  }

  const requestId = crypto.randomUUID();
  const targetIndex = 0;
  const targetId = stableRenderTargetId(session.sourceBytes, `scene\u0000timeline\u0000${targetIndex}`);
  const request = {
    format: 'fla-part-preview',
    version: 1,
    requestId,
    sessionId,
    generation: 1,
    target: { renderTargetId: targetId, selectedFrameIndex: 0 },
  };
  const startScript = `window.__startF1Preview(${JSON.stringify(request)}, ${JSON.stringify(referenceDataUrl)})`;
  const harnessStatus = await mainWindow.webContents.executeJavaScript(startScript, true);
  if (!harnessStatus?.done) throw new Error('The Electron preview harness did not settle its request');
  if (!harnessStatus.ok) throw new Error(`The Electron preview harness failed: ${harnessStatus.error}`);
  if (!harnessStatus.statusText?.startsWith(harnessStatus.capability)) {
    throw new Error('The Electron preview harness did not finish painting its measured status');
  }
  if (!observedResponse?.ok) throw new Error('The Main F1-02 handler did not return a successful preview');

  const response = observedResponse;
  const plan = partPreviewService.getPlan(response.planId, sessionId, request.generation);
  if (!plan) throw new Error('The Main-held PartPlan was missing or expired before acceptance capture');
  if (response.capability !== 'EDITABLE_PARTS_READY' || plan.units.length !== 5 || response.partPreviews.length !== 5) {
    throw new Error(`Sample A expected five independent source parts; got ${plan.units.length}`);
  }
  if (response.metrics.sourcePreparationCountForRequest !== 1 || response.metrics.rasterCount !== 7 ||
      response.metrics.displayListResolveCount !== 6) {
    throw new Error('Sample A did not use one prepared source, six display resolutions, and seven sandbox rasters');
  }
  if (harnessStatus.comparisons?.nativeVsReassembled?.comparable !== true ||
      harnessStatus.comparisons?.nativeVsAnimateReference?.comparable !== true) {
    throw new Error('Native, reassembled, and Animate PNGs did not have comparable stage dimensions');
  }
  if (response.stage.width !== referenceInfo.width || response.stage.height !== referenceInfo.height) {
    throw new Error(`Animate reference is ${referenceInfo.width}x${referenceInfo.height}, Panda preview is ${response.stage.width}x${response.stage.height}`);
  }
  const reassemblyComparison = harnessStatus.comparisons.nativeVsReassembled;
  const reassemblyChangedPixelRate = reassemblyComparison.differentPixels / reassemblyComparison.totalPixels;
  const sourceStatus = reassemblyChangedPixelRate <= 0.005 && reassemblyComparison.maximumChannelDifference <= 8
    ? 'NATIVE_SOURCE_GO'
    : 'PARTIAL';
  if (sourceStatus !== 'NATIVE_SOURCE_GO') {
    throw new Error(`Native/reassembled comparison is PARTIAL: ${(reassemblyChangedPixelRate * 100).toFixed(3)}% pixels differ, maximum channel delta ${reassemblyComparison.maximumChannelDifference}`);
  }

  await mainWindow.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const screenshot = await mainWindow.webContents.capturePage();
  const evidence = {
    native: writeNewFile(path.join(OUTPUT_DIRECTORY, 'native-whole-scene.png'), Buffer.from(response.nativePreview.bytes)),
    parts: response.partPreviews.map((part, index) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      drawOrder: part.drawOrder,
      ...writeNewFile(path.join(OUTPUT_DIRECTORY, `part-${String(index + 1).padStart(2, '0')}.png`), Buffer.from(part.image.bytes)),
    })),
    reassembled: writeNewFile(path.join(OUTPUT_DIRECTORY, 'reassembled-from-parts.png'), Buffer.from(response.reassembledPreview.bytes)),
    animateReference: {
      file: path.basename(referencePath),
      byteLength: referenceBytes.byteLength,
      sha256: sha256(referenceBytes),
    },
    screenshot: writeNewFile(path.join(OUTPUT_DIRECTORY, 'electron-preview.png'), screenshot.toPNG()),
    planReceipt: writeNewFile(
      path.join(OUTPUT_DIRECTORY, 'main-held-part-plan.json'),
      Buffer.from(JSON.stringify(summarizePlan(plan), null, 2), 'utf8'),
    ),
  };

  const sourceHashAfterRun = sha256File(sourcePath);
  if (sourceHashAfterRun !== sourceHashBefore) throw new Error('Readonly sample A bytes changed during acceptance');
  const memoryReceipt = stopElectronMemorySampling();
  const receipt = {
    format: 'panda-stage-issue906-f1-02-electron-acceptance',
    version: 1,
    accepted: true,
    verifiedAt: new Date().toISOString(),
    platform: process.platform,
    source: {
      basename: path.basename(sourcePath),
      rawSha256: rawSha256.toUpperCase(),
      normalizedSha256: normalizedSha256.toUpperCase(),
      sourceHashAfterRun: sourceHashAfterRun.toUpperCase(),
      byteLength: sourceStat.size,
      recoveryApplied: Boolean(sourceInspection.trace?.recoveryApplied),
    },
    target: response.target,
    stage: response.stage,
    capability: response.capability,
    sourceStatus,
    sourceAssessment: {
      rule: 'native/reassembled changed pixels <= 0.5% and maximum channel delta <= 8',
      reassemblyChangedPixelRate,
    },
    planId: response.planId,
    poseIdentity: response.poseIdentity,
    unitCount: plan.units.length,
    metrics: response.metrics,
    electronMemory: memoryReceipt,
    comparisons: harnessStatus.comparisons,
    evidence,
    issueAcceptanceStatus: 'PARTIAL',
    acceptanceCoverage: {
      AC01: 'PASS',
      AC02: 'PASS',
      AC03: 'PARTIAL',
      AC04: 'PASS',
      AC05: 'PASS',
      AC06: 'PARTIAL',
      AC07: 'PARTIAL',
      AC08: 'PASS',
      AC09: 'PASS',
      AC10: 'PASS',
      AC11: 'PASS',
    },
    mutationObservation: {
      pandaProjectLoaded: false,
      projectStateSnapshot: 'NOT_RUN',
      projectMutationServicesInjectedIntoPartPreview: false,
      sourceBytesReturnedToRenderer: false,
      sourceHashBeforeAndAfterMatches: true,
      onlySampleAUsed: true,
    },
  };
  writeNewFile(path.join(OUTPUT_DIRECTORY, 'receipt.json'), Buffer.from(JSON.stringify(receipt, null, 2), 'utf8'));
  process.stdout.write(`${JSON.stringify({ accepted: true, sourceStatus, issueAcceptanceStatus: 'PARTIAL', outputDirectory: OUTPUT_DIRECTORY, capability: response.capability, unitCount: plan.units.length, metrics: response.metrics, electronMemory: memoryReceipt, comparisons: harnessStatus.comparisons }, null, 2)}\n`);
}

function bestEffortCleanup(label, action) {
  try {
    action();
  } catch (error) {
    process.stderr.write(`F1-02 cleanup warning (${label}): ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function cleanup() {
  bestEffortCleanup('memory sampler', () => stopElectronMemorySampling());
  bestEffortCleanup('part preview IPC', () => removePartPreviewHandlers?.());
  bestEffortCleanup('part preview service', () => partPreviewService?.close());
  bestEffortCleanup('snapshot IPC', () => removeSnapshotHandlers?.());
  bestEffortCleanup('render session', () => renderSession?.close());
  bestEffortCleanup('import IPC', () => removeFlaImportHandlers?.());
  bestEffortCleanup('session listener', () => removeSessionListener?.());
  bestEffortCleanup('inspection service', () => inspectionService?.close());
  bestEffortCleanup('preview window', () => closeOnce(mainWindow));
}

app.whenReady()
  .then(runAcceptance)
  .catch((error) => {
    primaryError = error;
    bestEffortCleanup('memory sampler', () => stopElectronMemorySampling());
    process.stderr.write(`F1-02 Electron acceptance failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    if (OUTPUT_DIRECTORY && fs.existsSync(OUTPUT_DIRECTORY)) {
      try {
        writeNewFile(
          path.join(OUTPUT_DIRECTORY, 'failure.json'),
          Buffer.from(JSON.stringify({
            format: 'panda-stage-issue906-f1-02-electron-acceptance-failure',
            recordedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            sourceHashBefore: sourceHashBefore?.toUpperCase() || null,
          }, null, 2), 'utf8'),
        );
      } catch (writeError) {
        process.stderr.write(`Could not write F1-02 failure receipt: ${writeError instanceof Error ? writeError.message : String(writeError)}\n`);
      }
    }
  })
  .finally(() => {
    cleanup();
    app.exit(primaryError ? 1 : 0);
  });
