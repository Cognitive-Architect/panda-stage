'use strict';

const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { migrateProject, ProjectSchema } = require('../dist-electron/domain/index.js');
const { registerProjectIpcHandlers } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const { registerExportPreparationIpcHandlers } = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const { registerIpcHandlers } = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const { AssetPreviewAudioService } = require('../dist-electron/main/services/AssetPreviewAudioService.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const { FileSystemService } = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const { HiddenWindowManager } = require('../dist-electron/main/windows/hidden-window-manager.js');

const execFileAsync = promisify(execFile);
const acceptanceRoot = process.env.PANDA_STAGE_ISSUE950_ROOT
  || 'D:\\PandaStage-Acceptance\\issue-950-as02-phase-b-evidence';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, 'run-' + runId);
const evidenceRoot = path.join(runRoot, 'evidence');
const projectRoot = path.join(runRoot, 'fixture.pandastage');
const outputPath = path.join(runRoot, 'issue950-synthetic-audio.mp4');
const receiptPath = path.join(runRoot, 'issue950-receipt.json');
const projectFilePath = path.join(projectRoot, 'project.json');
const registeredHandlers = [];
const rendererErrors = [];
const rendererWarnings = [];

fs.mkdirSync(evidenceRoot, { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
app.setPath('userData', path.join(runRoot, 'user-data'));
process.env.VITE_DEV_SERVER_URL = '';
app.on('window-all-closed', () => {});

const project = migrateProject(require('../demo-project/project-v1.example.json'));
project.name = 'Issue 950 AS-02 Phase B synthetic audio acceptance';
project.shots = [project.shots[0]];
const shot = project.shots[0];
shot.durationMs = 10000;
shot.dialogues = [];
shot.audioClips = [];
shot.timelineEvents = [];

const panda = project.characters[0];
const tigerId = '95000000-0000-4000-8000-000000000901';
const tigerVoiceId = '95000000-0000-4000-8000-000000000902';
const tiger = {
  ...structuredClone(panda),
  id: tigerId,
  name: 'Tiger',
  defaultVoiceProfileId: tigerVoiceId,
  expressions: panda.expressions.map((expression, index) => ({
    ...expression,
    id: '95100000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
  })),
};
tiger.defaultExpressionId = tiger.expressions[0].id;
project.characters.push(tiger);
project.voiceProfiles.push({
  ...structuredClone(project.voiceProfiles[0]),
  id: tigerVoiceId,
  name: 'Tiger Mandarin',
  characterId: tigerId,
});

const secondShot = structuredClone(shot);
secondShot.id = '95200000-0000-4000-8000-000000000001';
secondShot.name = 'Overlap blocker shot';
secondShot.layers = secondShot.layers.map((layer, index) => ({
  ...layer,
  id: '95300000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
}));
secondShot.backgroundLayerId = secondShot.layers[0].id;
secondShot.dialogues = [{
  id: '95400000-0000-4000-8000-000000000001',
  characterId: panda.id,
  voiceProfileId: project.voiceProfiles.find((voice) => voice.characterId === panda.id).id,
  subtitleStyleId: secondShot.defaultSubtitleStyleId,
  startMs: 0,
  endMs: 6000,
  text: 'Existing overlap blocker',
}];
project.shots.push(secondShot);

const png = fs.readFileSync(path.join(__dirname, '../public/probe/panda-character.png'));
project.assets = project.assets.filter((asset) => asset.kind === 'image');
for (const asset of project.assets) {
  asset.width = png.readUInt32BE(16);
  asset.height = png.readUInt32BE(20);
  asset.sha256 = createHash('sha256').update(png).digest('hex');
  const target = path.join(projectRoot, asset.relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png);
}

function makeWave(durationMs, frequency) {
  const sampleRate = 8000;
  const sampleCount = Math.floor(durationMs * sampleRate / 1000);
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    bytes.writeInt16LE(
      Math.round(2500 * Math.sin(2 * Math.PI * frequency * index / sampleRate)),
      44 + index * 2,
    );
  }
  return bytes;
}

const sequenceAssets = [];
for (let index = 0; index < 10; index += 1) {
  const sequence = index + 1;
  const characterName = index % 2 === 0 ? 'Panda' : 'Tiger';
  const durationMs = 1200 + index * 20;
  const bytes = makeWave(durationMs, 190 + index * 19);
  const sourceStem = String(sequence).padStart(3, '0') + '_' + characterName;
  const fileName = sourceStem + '.wav';
  const asset = {
    id: '95500000-0000-4000-8000-' + String(sequence).padStart(12, '0'),
    kind: 'audio',
    name: sourceStem,
    relativePath: 'assets/' + fileName,
    mimeType: 'audio/wav',
    durationMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    metadata: { status: 'ready', warnings: [] },
  };
  project.assets.push(asset);
  sequenceAssets.push(asset);
  fs.writeFileSync(path.join(projectRoot, asset.relativePath), bytes);
}
ProjectSchema.parse(project);
fs.writeFileSync(projectFilePath, JSON.stringify(project, null, 2));

let mainWindow = null;
let trackedSnapshot = null;
let projectService = null;
let unregisterProjectIpcHandlers = null;
let unregisterIpcHandlers = null;
let unregisterExportPreparationIpcHandlers = null;
let activeExportPromise = null;
let exportService = null;
let exportPreparationService = null;
let hiddenWindowManager = null;
let mediaTools = null;
let activeStep = 'launch';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameProjectRoot(candidate) {
  return path.resolve(candidate).toLowerCase() === path.resolve(projectRoot).toLowerCase();
}

function register(channelName, handler) {
  const channel = IPC_CHANNELS[channelName];
  ipcMain.handle(channel, handler);
  registeredHandlers.push(channel);
}

function removeRegisteredIpc() {
  unregisterProjectIpcHandlers?.();
  unregisterIpcHandlers?.();
  unregisterExportPreparationIpcHandlers?.();
  for (const channel of registeredHandlers) ipcMain.removeHandler(channel);
}

function setupProjectServices() {
  projectService = new ProjectService({
    getCurrentProjectSnapshot: (root) => sameProjectRoot(root) ? trackedSnapshot : null,
    onProjectOpened: (root, openedProject) => {
      if (sameProjectRoot(root) && trackedSnapshot === null) {
        trackedSnapshot = { project: openedProject, revision: 0 };
      }
    },
    onProjectSaved: (root, savedProject, revision) => {
      if (sameProjectRoot(root)) {
        trackedSnapshot = {
          project: savedProject,
          revision: revision ?? trackedSnapshot?.revision ?? 0,
          dirty: false,
          ...(trackedSnapshot?.openInstanceId === undefined
            ? {}
            : { openInstanceId: trackedSnapshot.openInstanceId }),
        };
      }
    },
  });
  unregisterProjectIpcHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
  });

  register('RECENT_PROJECTS_LIST', () => ({
    ok: true,
    entries: [{
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: new Date().toISOString(),
      status: 'available',
    }],
  }));
  register('RECENT_PROJECTS_OPEN', async (_event, request) => {
    if (request.expectedProjectId !== project.id) {
      return { ok: false, error: { code: 'PROJECT_ID_MISMATCH', message: 'Fixture project ID changed.' } };
    }
    return { ok: true, document: await projectService.open(projectRoot) };
  });
  for (const channelName of ['AUTOSAVE_TRACK', 'AUTOSAVE_UPDATE']) {
    register(channelName, (_event, request) => {
      if (!sameProjectRoot(request.projectRoot)) {
        return { ok: false, error: { code: 'PROJECT_NOT_TRACKED', message: 'Unexpected project root.' } };
      }
      trackedSnapshot = {
        project: request.project,
        revision: request.revision,
        dirty: request.dirty,
        openInstanceId: request.openInstanceId,
      };
      return { ok: true };
    });
  }
  register('AUTOSAVE_STOP', () => ({ ok: true }));
  register('RECOVERY_DETECT', () => ({ ok: true, candidate: null }));

  register('ASSET_THUMBNAIL_READ', (_event, request) => ({
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    dataUrl: 'data:image/png;base64,' + png.toString('base64'),
  }));
  register('ASSET_CANVAS_IMAGE_READ', (_event, request) => {
    const asset = project.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND', message: 'Image asset not found.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: png.length,
      bytes: new Uint8Array(png),
    };
  });

  const audioPreviewService = new AssetPreviewAudioService({
    getCurrentProjectSnapshot: (root) => sameProjectRoot(root) ? trackedSnapshot : null,
  });
  register('ASSET_PREVIEW_AUDIO_READ', (_event, request) => audioPreviewService.read(request));
  register('ASSET_PREVIEW_AUDIO_INFO', (_event, request) => audioPreviewService.getInfo(request));
}

function setupExportServices() {
  mediaTools = resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath });
  const exportFileSystem = new FileSystemService(path.join(runRoot, 'frame-jobs'));
  hiddenWindowManager = new HiddenWindowManager();
  const mediaAdapter = new FFmpegAdapter({
    ffmpegPath: mediaTools.ffmpegPath,
    ffprobePath: mediaTools.ffprobePath,
  });
  const fileStore = new NodeExportPreparationFileStore(path.join(runRoot, 'frozen-media'));
  exportPreparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (root) => sameProjectRoot(root) ? trackedSnapshot : null,
    assertFormalOutputLocation: (target) => exportFileSystem.assertFormalOutputLocation(target),
    fileStore,
    mediaReader: new MainProjectAssetReader(),
  });
  exportService = new ExportService(hiddenWindowManager, exportFileSystem, mediaAdapter);
  exportService.subscribe((update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
    }
  });
  unregisterExportPreparationIpcHandlers = registerExportPreparationIpcHandlers({
    getMainWindow: () => mainWindow,
    service: exportPreparationService,
    selectOutputPath: async () => outputPath,
  });
  unregisterIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, request) => hiddenWindowManager.markProbeLoaded(senderId, request),
    markFormalLoaded: (senderId, request) => hiddenWindowManager.markFormalLoaded(senderId, request),
    markFrameReady: (senderId, request) => hiddenWindowManager.markFrameReady(senderId, request),
    markFrameFailed: (senderId, request) => hiddenWindowManager.markFrameFailed(senderId, request),
    startFullProbe: (request) => {
      const handle = exportService.startFullProbe(request);
      void handle.completion.catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    startFormalExport: async (request) => {
      const input = await exportPreparationService.acquireCandidateForExport(
        request.snapshotId,
        request.reuseSnapshot,
      );
      let handle;
      try {
        handle = exportService.startFormalExport(
          input,
          () => exportPreparationService.assertOutputTargetUnchanged(request.snapshotId),
        );
      } catch (error) {
        await exportPreparationService.retainCandidateForRetry(request.snapshotId);
        throw error;
      }
      activeExportPromise = handle.completion;
      void handle.completion.then(
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
        () => exportPreparationService.retainCandidateForRetry(request.snapshotId),
      ).catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => ({
      jobId,
      accepted: exportService.cancelJob(jobId),
      status: exportService.getJob(jobId)?.status ?? 'cancelled',
    }),
    revealExportOutput: async (jobId) => Boolean(exportService.getCompletedOutputPath(jobId)),
  });
}

function js(code) {
  return mainWindow.webContents.executeJavaScript(code, true);
}

async function wait(expression, message, timeoutMs) {
  const timeout = timeoutMs ?? 30000;
  await js(
    '(async () => { const deadline = Date.now() + ' + timeout
      + '; while (Date.now() < deadline) { try { if (' + expression + ') return true; } catch {}'
      + ' await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('
      + JSON.stringify(message) + '); })()',
  );
}

async function activate(selector) {
  const point = await js(
    '(() => { const element = document.querySelector(' + JSON.stringify(selector) + ');'
      + ' if (!element) throw new Error("Missing control: " + ' + JSON.stringify(selector) + ');'
      + ' element.scrollIntoView({ block: "nearest" });'
      + ' if ("disabled" in element && element.disabled) throw new Error("Disabled control: " + ' + JSON.stringify(selector) + ');'
      + ' const rect = element.getBoundingClientRect();'
      + ' return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()',
  );
  mainWindow.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  mainWindow.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    ...point,
  });
  await pause(180);
}

async function setText(selector, value) {
  await js(
    '(() => { const input = document.querySelector(' + JSON.stringify(selector) + ');'
      + ' if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) throw new Error("Missing text input.");'
      + ' const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;'
      + ' const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;'
      + ' setter.call(input, ' + JSON.stringify(value) + ');'
      + ' input.dispatchEvent(new Event("input", { bubbles: true }));'
      + ' input.dispatchEvent(new Event("change", { bubbles: true })); })()',
  );
  await wait('document.querySelector(' + JSON.stringify(selector) + ')?.value === ' + JSON.stringify(value), 'Text input did not update.');
}

async function setAudio(rowNumber, selectedValue, expectedAssetId) {
  const editSelector = '[data-testid="auto-subtitle-row-edit-' + rowNumber + '"]';
  const isExpanded = await js(
    'document.querySelector(' + JSON.stringify(editSelector) + ')?.getAttribute("aria-expanded") === "true"',
  );
  if (!isExpanded) await activate(editSelector);
  const selector = '[data-testid="dialogue-batch-audio-' + rowNumber + '"]';
  await js(
    '(() => { const select = document.querySelector(' + JSON.stringify(selector) + ');'
      + ' if (!(select instanceof HTMLSelectElement)) throw new Error("Missing audio selector.");'
      + ' const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;'
      + ' setter.call(select, ' + JSON.stringify(selectedValue) + ');'
      + ' select.dispatchEvent(new Event("change", { bubbles: true })); })()',
  );
  const rowIndex = rowNumber - 1;
  await wait(
    'document.querySelectorAll(\'[data-testid="dialogue-batch-line"]\')[' + rowIndex + ']?.dataset.audioAssetId === ' + JSON.stringify(expectedAssetId ?? selectedValue),
    'Audio choice did not update row ' + rowNumber + '.',
  );
}

async function inspect() {
  return js('window.__pandaStageIssue816Acceptance.inspect()');
}

async function screenshot(fileName) {
  const target = path.join(evidenceRoot, fileName);
  const image = await mainWindow.webContents.capturePage();
  await fsp.writeFile(target, image.toPNG());
  return target;
}

async function openAutoSubtitles() {
  const autoButton = '[data-testid="project-tools-auto-subtitles"]';
  const hasAutoButton = await js('Boolean(document.querySelector(' + JSON.stringify(autoButton) + '))');
  if (!hasAutoButton) await activate('[data-testid="right-activity-rail-tools"]');
  await wait('document.querySelector(\'[data-testid="project-tools-home"]\')', 'Project Tools home did not open.');
  await activate(autoButton);
  await wait('document.querySelector(\'[data-testid="auto-subtitle-batch"]\')', 'Auto Subtitles did not open.');
}

async function setBatchSourceText() {
  const lines = sequenceAssets.map((asset, index) => {
    const name = index % 2 === 0 ? 'Panda' : 'Tiger';
    return name + ': Phase B dialogue row ' + String(index + 1).padStart(2, '0');
  });
  const sourceText = lines.join('\n');
  await setText('[data-testid="dialogue-batch-input"]', sourceText);
  await wait('document.querySelectorAll(\'[data-testid="dialogue-batch-line"]\').length === 10', 'Ten dialogue rows did not parse.');
  await wait(
    '[...document.querySelectorAll(\'[data-testid="dialogue-batch-line"]\')].every((row) => row.dataset.audioAssetId && Number(row.dataset.clipDurationMs) > 0)',
    'Ten dialogue rows did not resolve to ready audio and durations.',
  );
  return { lines, sourceText };
}

async function seekDrag(fromFraction, toFraction) {
  await js(
    '(() => {'
      + ' if (!Element.prototype.__issue950PointerCapturePatched) {'
      + ' Element.prototype.setPointerCapture = function () {};'
      + ' Element.prototype.releasePointerCapture = function () {};'
      + ' Element.prototype.hasPointerCapture = function () { return false; };'
      + ' Element.prototype.__issue950PointerCapturePatched = true; }'
      + ' const track = document.querySelector(\'[data-testid="timeline-ruler-track"]\');'
      + ' if (!(track instanceof HTMLElement)) throw new Error("Timeline ruler is unavailable.");'
      + ' const rect = track.getBoundingClientRect();'
      + ' const at = (fraction) => ({ x: rect.left + rect.width * fraction, y: rect.top + rect.height / 2 });'
      + ' const a = at(' + JSON.stringify(fromFraction) + '); const b = at(' + JSON.stringify(toFraction) + ');'
      + ' const base = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0 };'
      + ' track.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: a.x, clientY: a.y, buttons: 1 }));'
      + ' track.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: b.x, clientY: b.y, buttons: 1 }));'
      + ' track.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: b.x, clientY: b.y, buttons: 0 }));'
      + ' return true; })()',
  );
  await pause(120);
  return Number(await js('document.querySelector(\'[data-testid="timeline-timecode"]\')?.dataset.currentTime ?? 0'));
}

async function runProcess(file, args) {
  const { stdout } = await execFileAsync(file, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function decodeAudioAndCountNonZero(ffmpegPath, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-v', 'error',
      '-i', filePath,
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', '8000',
      '-f', 's16le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let decodedBytes = 0;
    let nonZeroSamples = 0;
    const stderr = [];
    child.stdout.on('data', (chunk) => {
      decodedBytes += chunk.length;
      for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
        if (chunk.readInt16LE(offset) !== 0) nonZeroSamples += 1;
      }
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Audio decode failed: ' + Buffer.concat(stderr).toString('utf8')));
        return;
      }
      resolve({ decodedBytes, nonZeroSamples });
    });
  });
}

async function run() {
  projectService = null;
  setupProjectServices();
  setupExportServices();
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.setSize(1600, 1000);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('Each child in a list should have a unique "key" prop.')) {
      rendererWarnings.push(message);
    } else if (level >= 3) rendererErrors.push(message);
    else if (level >= 2) rendererWarnings.push(message);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push('Renderer process exited: ' + JSON.stringify(details));
  });

  const result = {
    issue: 950,
    phase: 'AS-02 Phase B technical Electron and MP4 verification',
    runId,
    branch: require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    headAtRun: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    projectRoot,
    outputPath,
    fixture: {
      provenance: 'Ten generated 8 kHz PCM sine-wave WAV files copied into the fixture project with byte hashes and durations validated by the production audio reader.',
      syntheticAudioOnly: true,
      humanVoiceAcceptance: 'NOT_ATTESTED',
      clipCount: sequenceAssets.length,
    },
    ownerAcceptance: 'NOT_ATTESTED',
    passed: false,
    evidence: [],
  };

  try {
    activeStep = 'open-project';
    await wait('document.querySelector(\'[data-task4-core="recent-open"]\')', 'Project Center recent row did not render.');
    await activate('[data-task4-core="recent-open"]');
    await wait('document.querySelector(\'[data-testid="history-controls"]\')', 'Editor did not open.');
    await wait('window.__pandaStageIssue816Acceptance?.inspect()?.project?.id === ' + JSON.stringify(project.id), 'Opened Project ID does not match fixture.');

    activeStep = 'canvas-fit-actual';
    await openAutoSubtitles();
    await activate('[data-testid="project-tools-auto-subtitles-back"]');
    await wait('document.querySelector(\'[data-testid="project-tools-home"]\')', 'Project Tools home did not return.');
    await activate('[data-testid="canvas-mode-fit"]');
    const fitPressed = await js('document.querySelector(\'[data-testid="canvas-mode-fit"]\')?.getAttribute("aria-pressed")');
    await activate('[data-testid="canvas-mode-actual"]');
    const actualPressed = await js('document.querySelector(\'[data-testid="canvas-mode-actual"]\')?.getAttribute("aria-pressed")');
    await activate('[data-testid="canvas-mode-fit"]');
    assert(fitPressed === 'true' && actualPressed === 'true', 'Canvas Fit and Actual modes did not switch.');
    result.canvasModes = { fitSelected: true, actualSelected: true, returnedToFit: true };
    result.evidence.push(await screenshot('canvas-fit-actual.png'));

    activeStep = 'timeline-playhead-drag';
    const collapse = await js('document.querySelector(\'[data-testid="timeline-collapse"]\')?.dataset.expanded');
    if (collapse === 'false') await activate('[data-testid="timeline-collapse"]');
    const dragStart = await seekDrag(0.22, 0.68);
    const dragEnd = await seekDrag(0.68, 0.04);
    assert(dragStart > 0 && dragEnd < dragStart, 'Timeline playhead drag did not move and return toward the start.');
    result.timelineDrag = { draggedToMs: dragStart, returnedToMs: dragEnd };
    result.evidence.push(await screenshot('timeline-playhead-drag.png'));

    activeStep = 'duplicate-audio-block';
    await activate('[data-testid="resource-activity-rail-shots"]');
    await wait('document.querySelector(\'[data-testid="shot-list-view"]\')', 'Shot list did not reopen.');
    await activate('li[data-shot-id="' + shot.id + '"] button');
    await wait('document.querySelector(\'.shot-list-item-selected\')?.dataset.shotId === ' + JSON.stringify(shot.id), 'Generation Shot was not selected.');
    await openAutoSubtitles();
    await setBatchSourceText();
    await setAudio(2, sequenceAssets[0].id);
    await wait('document.querySelector(\'[data-testid="auto-subtitle-generate"]\')?.disabled === true', 'Duplicate audio did not block the batch.');
    const duplicateNotice = await js('document.querySelector(\'[data-testid="dialogue-batch-issue-2"]\')?.textContent ?? ""');
    assert(duplicateNotice.length > 0, 'Duplicate audio blocker was not visible on its row.');
    const beforeDraftChecks = await inspect();
    assert(beforeDraftChecks.project.shots.find((candidate) => candidate.id === shot.id).dialogues.length === 0, 'Duplicate check partially generated Dialogues.');
    await setAudio(2, '__automatic__', sequenceAssets[1].id);
    await wait('document.querySelector(\'[data-testid="auto-subtitle-generate"]\')?.disabled === false', 'Restoring a unique audio file did not unblock the batch.');

    activeStep = 'extension-confirmation-cancel';
    const beforeGeneration = await inspect();
    const beforeFingerprint = JSON.stringify(beforeGeneration.project);
    const generationStartMs = Number(await js('document.querySelector(\'[data-testid="project-canvas-stage"]\')?.dataset.currentTimeMs ?? 0'));
    const batchDurationMs = sequenceAssets.reduce((sum, asset) => sum + asset.durationMs, 0);
    const expectedEndMs = generationStartMs + batchDurationMs;
    await activate('[data-testid="auto-subtitle-generate"]');
    await wait('document.querySelector(\'[data-testid="auto-subtitle-extension-prompt"]\')', 'Shot extension did not request explicit confirmation.');
    const extensionPrompt = await js('document.querySelector(\'[data-testid="auto-subtitle-extension-prompt"]\')?.textContent ?? ""');
    assert(extensionPrompt.includes('12.9'), 'Extension prompt did not show the exact required batch duration.');
    await activate('[data-testid="auto-subtitle-extension-cancel"]');
    const afterCancel = await inspect();
    assert(afterCancel.revision === beforeGeneration.revision, 'Cancelling extension changed project revision.');
    assert(afterCancel.undoCount === beforeGeneration.undoCount, 'Cancelling extension created history.');
    assert(JSON.stringify(afterCancel.project) === beforeFingerprint, 'Cancelling extension changed project data.');

    activeStep = 'generate-ten-dialogue-audio-pairs';
    await activate('[data-testid="auto-subtitle-generate"]');
    await activate('[data-testid="auto-subtitle-extension-confirm"]');
    await wait('document.querySelector(\'[data-testid="auto-subtitle-generated-notice"]\')?.textContent === "已生成 10 条字幕与配音"', 'Generation success notice was not shown.', 60000);
    await wait('document.querySelector(\'[data-testid="dialogue-sheet"]\')', 'Successful generation did not switch to Subtitle workspace.');
    const generated = await inspect();
    const generatedShot = generated.project.shots.find((candidate) => candidate.id === shot.id);
    assert(generatedShot.dialogues.length === 10, 'Generation did not create ten Dialogues.');
    assert(generatedShot.audioClips.length === 10, 'Generation did not create ten AudioClips.');
    assert(generatedShot.durationMs === expectedEndMs, 'Generation did not extend Shot to the exact batch end.');
    assert(generated.revision === beforeGeneration.revision + 1, 'Generation did not create exactly one Project revision.');
    assert(generated.undoCount === beforeGeneration.undoCount + 1, 'Generation did not create exactly one History entry.');
    const pairs = generatedShot.dialogues.map((dialogue, index) => {
      const clip = generatedShot.audioClips.find((candidate) => candidate.id === dialogue.audioClipId);
      const expectedStartMs = index === 0 ? generationStartMs : generatedShot.dialogues[index - 1].endMs;
      assert(dialogue.startMs === expectedStartMs, 'Dialogue timing is not contiguous at row ' + (index + 1) + '.');
      assert(dialogue.endMs - dialogue.startMs === sequenceAssets[index].durationMs, 'Dialogue duration does not match source WAV.');
      assert(clip && clip.role === 'dialogue', 'Dialogue ' + (index + 1) + ' has no role=dialogue AudioClip.');
      assert(clip.assetId === sequenceAssets[index].id, 'Dialogue is bound to the wrong audio asset at row ' + (index + 1) + '.');
      assert(clip.startMs === dialogue.startMs && clip.endMs === dialogue.endMs, 'Dialogue and AudioClip timings diverged.');
      assert(dialogue.characterId === (index % 2 === 0 ? panda.id : tigerId), 'Dialogue character mapping changed at row ' + (index + 1) + '.');
      return {
        dialogueId: dialogue.id,
        audioClipId: clip.id,
        assetId: clip.assetId,
        startMs: dialogue.startMs,
        endMs: dialogue.endMs,
        durationMs: clip.endMs - clip.startMs,
        role: clip.role,
      };
    });
    assert(generatedShot.audioClips.every((clip) => clip.role === 'dialogue'), 'Generated batch contains a non-dialogue AudioClip.');
    result.generation = {
      revision: generated.revision,
      undoCount: generated.undoCount,
      redoCount: generated.redoCount,
      previousShotDurationMs: 10000,
      nextShotDurationMs: generatedShot.durationMs,
      startMs: generationStartMs,
      pairs,
      successNotice: '已生成 10 条字幕与配音',
      draftCleared: true,
      switchedToSubtitleWorkspace: true,
    };
    result.evidence.push(await screenshot('generated-subtitles-notice.png'));

    activeStep = 'undo-redo-single-transaction';
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] });
    await wait('window.__pandaStageIssue816Acceptance.inspect()?.project?.shots?.find((candidate) => candidate.id === ' + JSON.stringify(shot.id) + ')?.dialogues?.length === 0', 'Undo did not remove all generated Dialogue rows.');
    const undone = await inspect();
    assert(undone.project.shots.find((candidate) => candidate.id === shot.id).durationMs === 10000, 'Undo did not restore original Shot duration.');
    assert(undone.redoCount === 1, 'Undo did not leave one Redo command.');
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Y', modifiers: ['control'] });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Y', modifiers: ['control'] });
    await wait('window.__pandaStageIssue816Acceptance.inspect()?.project?.shots?.find((candidate) => candidate.id === ' + JSON.stringify(shot.id) + ')?.audioClips?.length === 10', 'Redo did not restore generated Dialogue audio.');
    const redone = await inspect();
    assert(redone.project.shots.find((candidate) => candidate.id === shot.id).durationMs === expectedEndMs, 'Redo did not restore Shot extension.');
    assert(redone.undoCount === beforeGeneration.undoCount + 1 && redone.redoCount === 0, 'Redo did not restore one History command.');
    result.history = { undoRemovedWholeBatchAndExtension: true, redoRestoredWholeBatchAndExtension: true, undoCount: redone.undoCount, redoCount: redone.redoCount };

    activeStep = 'save-project';
    const saveResult = await js('window.__pandaStageIssue816Acceptance.saveCurrentProject()');
    assert(saveResult?.ok === true, 'Formal Project Save failed: ' + JSON.stringify(saveResult));
    const savedProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(projectFilePath, 'utf8')));
    const savedShot = savedProject.shots.find((candidate) => candidate.id === shot.id);
    assert(savedShot.dialogues.length === 10 && savedShot.audioClips.length === 10, 'Saved project.json did not persist the complete batch.');
    assert(!Object.hasOwn(savedProject, 'history'), 'History was serialized into project.json.');
    result.persistence = { savedRevision: saveResult.savedRevision, saved: true, dialogueCount: savedShot.dialogues.length, audioClipCount: savedShot.audioClips.length, projectHistorySerialized: false };

    activeStep = 'product-preview-play-stop';
    await wait('document.querySelector(\'[data-testid="quick-action-drawer"]\')', 'Quick actions drawer is unavailable.');
    await js('(() => { const drawer = document.querySelector(\'[data-testid="quick-action-drawer"]\'); if (drawer?.dataset.expanded !== "true") drawer?.querySelector(\'[data-testid="quick-action-drawer-handle"]\')?.click(); })()');
    await wait('document.querySelector(\'[data-testid="quick-action-drawer"]\')?.dataset.expanded === "true"', 'Quick actions drawer did not expand.');
    await activate('[data-testid="quick-action-play"]');
    await wait('document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewSurface === "active"', 'Product Preview did not activate.');
    await wait('document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewReadiness === "ready"', 'Product Preview did not become ready.', 60000);
    const wasPlaying = await js('document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying === "true"');
    if (!wasPlaying) await activate('[data-testid="product-preview-play-pause"]');
    await wait('document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying === "true"', 'Product Preview did not start playback.');
    await pause(350);
    await activate('[data-testid="product-preview-stop"]');
    await wait('document.querySelector(\'[data-testid="product-preview-overlay"]\')?.dataset.previewPlaying === "false"', 'Product Preview did not stop.');
    result.preview = { started: true, stopped: true, readiness: 'ready' };
    result.evidence.push(await screenshot('product-preview-stopped.png'));
    await activate('[data-testid="product-preview-close"]');
    await wait('!document.querySelector(\'[data-testid="product-preview-overlay"]\')', 'Product Preview did not close.');

    activeStep = 'formal-mp4-export';
    const exportPreflight = await inspect();
    result.exportPreflight = {
      projectRoot: exportPreflight.projectRoot,
      projectId: exportPreflight.project.id,
      revision: exportPreflight.revision,
      dirty: exportPreflight.dirty,
      openInstanceId: exportPreflight.openInstanceId,
    };
    await js('(() => { const drawer = document.querySelector(\'[data-testid="quick-action-drawer"]\'); if (drawer?.dataset.expanded !== "true") drawer?.querySelector(\'[data-testid="quick-action-drawer-handle"]\')?.click(); })()');
    await activate('[data-testid="quick-action-export"]');
    await wait('document.querySelector(\'[data-testid="export-task-surface"]\')', 'Export task surface did not open.');
    await wait(
      '["running", "completed", "failed"].includes(document.querySelector(\'[data-testid="export-task-surface"]\')?.dataset.taskStatus)',
      'Formal export left the selecting state without a result.',
      60000,
    );
    const taskStatus = await js('document.querySelector(\'[data-testid="export-task-surface"]\')?.dataset.taskStatus');
    if (taskStatus === 'failed') {
      result.exportFailure = await js('window.__pandaStageIssue816Acceptance.inspectExportTask()');
      result.exportAfterFailure = await inspect();
      throw new Error('Formal export failed before rendering: ' + JSON.stringify(result.exportFailure));
    }
    const exportDeadline = Date.now() + 20 * 60 * 1000;
    while (!activeExportPromise && Date.now() < exportDeadline) await pause(100);
    assert(activeExportPromise, 'Formal export IPC did not reach ExportService.');
    const exportResult = await Promise.race([
      activeExportPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Formal MP4 export exceeded verifier timeout.')), 20 * 60 * 1000)),
    ]);
    assert(exportResult.status === 'completed', 'Formal MP4 export status is ' + exportResult.status + '.');
    assert(path.resolve(exportResult.outputPath) === path.resolve(outputPath), 'Formal MP4 output path differs from selected path.');
    const outputStat = await fsp.stat(outputPath);
    assert(outputStat.isFile() && outputStat.size > 10000, 'Formal MP4 output is absent or too small.');
    const probe = JSON.parse(await runProcess(mediaTools.ffprobePath, [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      outputPath,
    ]));
    const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
    const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
    assert(videoStream && audioStream, 'Formal MP4 does not contain video and audio streams.');
    const decodedAudio = await decodeAudioAndCountNonZero(mediaTools.ffmpegPath, outputPath);
    assert(decodedAudio.decodedBytes > 0 && decodedAudio.nonZeroSamples > 0, 'Formal MP4 audio decoded to silence or no samples.');
    result.export = {
      status: exportResult.status,
      jobId: exportResult.jobId,
      outputPath,
      byteLength: outputStat.size,
      video: { codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height, duration: videoStream.duration },
      audio: { codec: audioStream.codec_name, sampleRate: audioStream.sample_rate, channels: audioStream.channels, duration: audioStream.duration },
      decodedAudio,
      ffprobePath: mediaTools.ffprobePath,
      ffmpegPath: mediaTools.ffmpegPath,
    };
    result.evidence.push(await screenshot('formal-export-completed.png'));

    activeStep = 'same-path-reopen';
    const reopened = await js('window.__pandaStageIssue816Acceptance.reopenSamePath()');
    const reopenedShot = reopened.project.shots.find((candidate) => candidate.id === shot.id);
    assert(reopenedShot.dialogues.length === 10 && reopenedShot.audioClips.length === 10, 'Same-path reopen lost generated pairs.');
    assert(reopenedShot.durationMs === expectedEndMs && reopened.dirty === false, 'Same-path reopen lost extension or reopened dirty.');
    result.persistence = { ...result.persistence, reopened: true, reopenedDialogueCount: reopenedShot.dialogues.length, reopenedAudioClipCount: reopenedShot.audioClips.length };

    activeStep = 'shot-conflict-block';
    const conflictBaseline = await inspect();
    await activate('[data-testid="resource-activity-rail-shots"]');
    await wait('document.querySelector(\'[data-testid="shot-list-view"]\')', 'Shot list did not open.');
    await activate('li[data-shot-id="' + secondShot.id + '"] button');
    await wait('document.querySelector(\'.shot-list-item-selected\')?.dataset.shotId === ' + JSON.stringify(secondShot.id), 'Overlap blocker Shot was not selected.');
    await openAutoSubtitles();
    await setBatchSourceText();
    await wait('document.querySelector(\'[data-testid="auto-subtitle-generate"]\')?.disabled === true', 'Existing Dialogue overlap did not block the whole batch.');
    const conflictState = await inspect();
    assert(conflictState.project.shots.find((candidate) => candidate.id === secondShot.id).dialogues.length === 1, 'Conflict setup changed the existing Dialogue.');
    assert(conflictState.undoCount === conflictBaseline.undoCount && conflictState.revision === conflictBaseline.revision, 'Blocked overlap changed project history or revision.');
    assert(JSON.stringify(conflictState.project) === JSON.stringify(conflictBaseline.project), 'Blocked overlap changed project data.');
    result.conflictBlock = { generated: false, revision: conflictState.revision, undoCount: conflictState.undoCount };
    result.evidence.push(await screenshot('overlap-conflict-blocked.png'));

    activeStep = 'renderer-health';
    assert(rendererErrors.length === 0, 'Renderer logged errors: ' + rendererErrors.join(' | '));
    result.rendererErrors = rendererErrors;
    result.rendererWarnings = rendererWarnings;
    result.passed = true;
    result.completedAt = new Date().toISOString();
    await fsp.writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    result.evidence.push(receiptPath);
    console.log('PASS #950 AS-02 Phase B synthetic-audio Electron verification: ' + runRoot);
    console.log('Human voice listening and owner acceptance remain NOT_ATTESTED.');
    removeRegisteredIpc();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    app.exit(0);
  } catch (error) {
    result.step = activeStep;
    result.error = String(error.stack ?? error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      result.runtimeState = await js('(() => { const api = window.__pandaStageIssue816Acceptance; return { snapshot: api?.inspect(), export: api?.inspectExportTask?.(), lastMainResponse: api?.lastMainResponse }; })()').catch(() => null);
    }
    result.completedAt = new Date().toISOString();
    await fsp.writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    if (mainWindow && !mainWindow.isDestroyed()) await screenshot('failure.png');
    console.error(result.error);
    removeRegisteredIpc();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    app.exit(1);
  }
}

run().catch(async (error) => {
  console.error(String(error.stack ?? error));
  removeRegisteredIpc();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.exit(1);
});
