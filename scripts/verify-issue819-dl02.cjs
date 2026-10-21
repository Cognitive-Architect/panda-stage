const { app, dialog, ipcMain, shell } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { registerIpcHandlers } = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const { registerProjectIpcHandlers } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { registerExportPreparationIpcHandlers } = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const { FileSystemService } = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const { HiddenWindowManager } = require('../dist-electron/main/windows/hidden-window-manager.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');
const { generateIssue819Fixture } = require('./issue819-fixtures.cjs');

const baseDirectory =
  process.env.PANDA_STAGE_ISSUE819_ROOT ??
  'D:\\PandaStage-Acceptance\\issue819-dl02';
process.env.VITE_DEV_SERVER_URL = '';
app.setPath('userData', path.join(path.resolve(baseDirectory), 'electron-user-data'));
app.on('window-all-closed', () => {});

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const registerMock = (name, handler) => ipcMain.handle(IPC_CHANNELS[name], handler);

let mainWindow = null;
let fixture = null;
let fixtureProject = null;
let trackedSnapshot = null;
let exportPreparationService = null;
let exportService = null;
let hiddenWindowManager = null;
let removeExportPreparationHandlers = null;
let removeProjectIpcHandlers = null;
let removeExportHandlers = null;
let assetBytesById = new Map();
const formalStarts = [];
const jobUpdates = [];
const mediaFailures = [];

function defaultExportFileName(projectName) {
  let baseName = Array.from(projectName.trim(), (character) =>
    /[<>:"/\\|?*]/u.test(character) || character.charCodeAt(0) <= 0x1f
      ? '_'
      : character,
  )
    .join('')
    .replace(/[. ]+$/gu, '')
    .trim();
  baseName = Array.from(baseName).slice(0, 240).join('').replace(/[. ]+$/gu, '');
  if (!baseName || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(baseName)) {
    baseName = 'Panda Stage export';
  }
  return baseName + '.mp4';
}

function installProjectFixtureIpc() {
  const projectService = new ProjectService({
    getCurrentProjectSnapshot: (projectRoot) => {
      if (!trackedSnapshot || path.resolve(projectRoot) !== path.resolve(fixture.projectRoot)) return null;
      return { project: trackedSnapshot.project, revision: trackedSnapshot.revision };
    },
    onProjectSaved: (projectRoot, project, revision) => {
      if (
        trackedSnapshot &&
        path.resolve(projectRoot) === path.resolve(fixture.projectRoot) &&
        trackedSnapshot.revision === revision
      ) {
        trackedSnapshot = { ...trackedSnapshot, project: structuredClone(project), dirty: false };
      }
    },
  });
  removeProjectIpcHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
  });
  ipcMain.removeHandler(IPC_CHANNELS.PROJECT_OPEN);

  const document = () => ({
    projectRoot: fixture.projectRoot,
    projectFilePath: path.join(fixture.projectRoot, 'project.json'),
    project: fixtureProject,
    migrated: false,
    sourceVersion: fixtureProject.schemaVersion,
  });
  registerMock('PROJECT_OPEN', async () => ({ ok: true, value: document() }));
  registerMock('RECENT_PROJECTS_LIST', async () => ({
    ok: true,
    entries: [{
      projectId: fixtureProject.id,
      projectName: fixtureProject.name,
      projectRoot: fixture.projectRoot,
      lastOpenedAt: new Date().toISOString(),
      status: 'available',
    }],
  }));
  registerMock('RECENT_PROJECTS_OPEN', async () => ({ ok: true, document: document() }));
  registerMock('AUTOSAVE_TRACK', async (_event, request) => {
    trackedSnapshot = structuredClone(request);
    return { ok: true };
  });
  registerMock('AUTOSAVE_UPDATE', async (_event, request) => {
    trackedSnapshot = structuredClone(request);
    return { ok: true };
  });
  registerMock('AUTOSAVE_STOP', async () => {
    trackedSnapshot = null;
    return { ok: true };
  });
  registerMock('RECOVERY_DETECT', async () => ({ ok: true, candidate: null }));
  registerMock('ASSET_THUMBNAIL_READ', async (_event, request) => {
    const bytes = assetBytesById.get(request.assetId);
    if (!bytes) return { ok: true, status: 'missing', assetId: request.assetId };
    return {
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    };
  });
  registerMock('ASSET_CANVAS_IMAGE_READ', async (_event, request) => {
    const asset = fixtureProject.assets.find((candidate) => candidate.id === request.assetId);
    const bytes = assetBytesById.get(request.assetId);
    if (!asset || !bytes) {
      return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Unknown fixture image.' } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: bytes.length,
      bytes: new Uint8Array(bytes),
    };
  });
}

function createRendererService() {
  const verifiedReader = new MainProjectAssetReader();
  const mediaReader = {
    getByteLength: (...args) => verifiedReader.getByteLength(...args),
    read: (...args) => verifiedReader.read(...args),
  };
  exportPreparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (projectRoot) => {
      if (!trackedSnapshot || path.resolve(projectRoot) !== path.resolve(fixture.projectRoot)) return null;
      return {
        project: trackedSnapshot.project,
        revision: trackedSnapshot.revision,
        dirty: trackedSnapshot.dirty,
        openInstanceId: trackedSnapshot.openInstanceId ?? null,
      };
    },
    confirmOverwrite: async ({ fileName }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '\u786e\u8ba4\u8986\u76d6\u73b0\u6709\u89c6\u9891',
        message: `\u201c${fileName}\u201d\u5df2\u5b58\u5728\u3002\u5141\u8bb8\u540e\u7eed\u5bfc\u51fa\u66ff\u6362\u8fd9\u4e2a\u6587\u4ef6\u5417\uff1f`,
        detail: '\u672c\u6b21\u53ea\u51c6\u5907\u5e76\u6821\u9a8c\u7d20\u6750\uff0c\u4e0d\u4f1a\u5199\u5165 MP4\u3002\u6b63\u5f0f\u63d0\u4ea4\u524d\u4f1a\u518d\u6b21\u6838\u5bf9\u76ee\u6807\u6587\u4ef6\u8eab\u4efd\u3002',
        buttons: ['\u786e\u8ba4\u5141\u8bb8\u8986\u76d6', '\u53d6\u6d88'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      return result.response === 0;
    },
    fileStore: new NodeExportPreparationFileStore(path.join(fixture.root, 'frozen-media')),
    mediaReader,
  });
  removeExportPreparationHandlers = registerExportPreparationIpcHandlers({
    getMainWindow: () => mainWindow,
    service: exportPreparationService,
    selectOutputPath: async (window, request) => {
      const selected = await dialog.showSaveDialog(window, {
        title: 'Export MP4',
        buttonLabel: 'Save',
        defaultPath: path.join(request.projectRoot, defaultExportFileName(request.projectName)),
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        properties: [],
      });
      return selected.canceled ? null : (selected.filePath ?? null);
    },
  });
}

function createExportService() {
  hiddenWindowManager = new HiddenWindowManager();
  const mediaTools = resolveMediaToolPaths({
    isPackaged: false,
    resourcesPath: process.resourcesPath,
  });
  const mediaAdapter = new FFmpegAdapter({ ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath });
  const encodePngSequence = mediaAdapter.encodePngSequence.bind(mediaAdapter);
  mediaAdapter.encodePngSequence = async (request, signal) => {
    try {
      return await encodePngSequence(request, signal);
    } catch (error) {
      const frameNames = await fsp.readdir(request.framesDirectory).catch(() => []);
      const diagnostic = {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
        stderr: error?.diagnostics?.stderr ?? null,
        args: error?.diagnostics?.args ?? null,
        executable: error?.diagnostics?.executable ?? null,
        framesDirectory: request.framesDirectory,
        frameCount: frameNames.length,
        firstFrames: frameNames.slice(0, 3),
        lastFrames: frameNames.slice(-3),
      };
      mediaFailures.push(diagnostic);
      await fsp.cp(request.framesDirectory, path.join(fixture.evidenceRoot, 'failed-frames'), { recursive: true }).catch(() => undefined);
      await fsp.writeFile(path.join(fixture.evidenceRoot, 'encode-failure.json'), JSON.stringify(diagnostic, null, 2), 'utf8').catch(() => undefined);
      throw error;
    }
  };
  exportService = new ExportService(
    hiddenWindowManager,
    new FileSystemService(path.join(fixture.root, 'frame-jobs')),
    mediaAdapter,
  );
  exportService.subscribe((update) => {
    jobUpdates.push(update);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
    }
  });
  removeExportHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, payload) => hiddenWindowManager.markProbeLoaded(senderId, payload),
    markFormalLoaded: (senderId, payload) => hiddenWindowManager.markFormalLoaded(senderId, payload),
    markFrameReady: (senderId, payload) => hiddenWindowManager.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) => hiddenWindowManager.markFrameFailed(senderId, payload),
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
      formalStarts.push({
        jobId: null,
        snapshotId: request.snapshotId,
        reuseSnapshot: request.reuseSnapshot,
        cameraMode: input.candidate.cameraMode,
        revision: input.candidate.revision,
        dirtyAtCapture: input.candidate.dirtyAtCapture,
        mediaCount: input.candidate.mediaManifest.length,
      });
      let handle;
      try {
        handle = exportService.startFormalExport(
          input,
          () => exportPreparationService.assertOutputTargetUnchanged(request.snapshotId),
        );
      } catch (error) {
        exportPreparationService.releaseCandidateExport(request.snapshotId);
        throw error;
      }
      formalStarts.at(-1).jobId = handle.jobId;
      void handle.completion.then(
        async () => {
          exportPreparationService.releaseCandidateExport(request.snapshotId);
          await exportPreparationService.discard(undefined, request.snapshotId).catch(() => undefined);
        },
        () => exportPreparationService.releaseCandidateExport(request.snapshotId),
      );
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => {
      const accepted = exportService.cancelJob(jobId);
      return { jobId, accepted, status: exportService.getJob(jobId)?.status ?? 'cancelled' };
    },
    revealExportOutput: async (jobId) => {
      const outputPath = exportService.getCompletedOutputPath(jobId);
      if (!outputPath) return false;
      shell.showItemInFolder(outputPath);
      return true;
    },
  });
}

function rendererJs(code) {
  return mainWindow.webContents.executeJavaScript(code, true);
}

async function waitForRenderer(expression, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await rendererJs(`(async () => Boolean(${expression}))()`)) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for renderer condition: ${expression}`);
}

async function clickSelector(selector) {
  const point = await rendererJs(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing selector ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  mainWindow.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  mainWindow.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(150);
}

function clickNativeSaveDialog(action, screenshotPath, overwritePromptScreenshotPath = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'issue816-native-dialog.ps1'),
      action,
      screenshotPath,
      '',
      '',
      overwritePromptScreenshotPath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Native Save As ${action} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function clickNativeOverwriteConfirmation(action, screenshotPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'issue816-native-dialog.ps1'),
      action,
      screenshotPath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Overwrite confirmation ${action} failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${path.basename(executable)} exited ${code}: ${stderr.trim() || stdout.trim()}`)));
  });
}

async function exportEvidence(outputPath, evidenceDirectory, label, mediaTools) {
  const rawProbe = await runProcess(mediaTools.ffprobePath, [
    '-v', 'error',
    '-count_frames',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    outputPath,
  ]);
  const probe = JSON.parse(rawProbe.stdout);
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
  const frameCount = Number(video?.nb_read_frames ?? video?.nb_frames);
  const fpsParts = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? '0/1').split('/');
  const fps = Number(fpsParts[0]) / Number(fpsParts[1] || 1);
  const durationSeconds = Number(video?.duration ?? probe.format?.duration);
  assert(video?.codec_name === 'h264', `${label}: FFprobe did not report H.264.`);
  assert(video?.pix_fmt === 'yuv420p', `${label}: FFprobe did not report yuv420p.`);
  assert(video?.width === 1920 && video?.height === 1080, `${label}: FFprobe frame size is not 1920x1080.`);
  assert(Math.abs(fps - 24) < 0.001, `${label}: FFprobe frame rate is not 24 fps (${fps}).`);
  assert(audio.length === 0, `${label}: the silent export contains an audio stream.`);
  assert(frameCount === 157, `${label}: export frame count differs from the 6.501 second Shot (${frameCount} frames).`);
  assert(Math.abs(durationSeconds - frameCount / 24) < 0.08, `${label}: encoded duration does not match the frame schedule.`);

  await fsp.mkdir(evidenceDirectory, { recursive: true });
  const probePath = path.join(evidenceDirectory, 'ffprobe.json');
  await fsp.writeFile(probePath, JSON.stringify(probe, null, 2), 'utf8');
  const firstFramePath = path.join(evidenceDirectory, 'boundary-first.png');
  const lastFramePath = path.join(evidenceDirectory, 'boundary-last.png');
  await runProcess(mediaTools.ffmpegPath, ['-y', '-v', 'error', '-i', outputPath, '-frames:v', '1', firstFramePath]);
  await runProcess(mediaTools.ffmpegPath, [
    '-y', '-v', 'error', '-i', outputPath,
    '-vf', 'select=eq(n\\,156)', '-vsync', '0', '-frames:v', '1', lastFramePath,
  ]);
  const firstFrame = await fsp.readFile(firstFramePath);
  const lastFrame = await fsp.readFile(lastFramePath);
  assert(firstFrame.length > 1_000 && lastFrame.length > 1_000, `${label}: boundary frame evidence is empty.`);
  const frameEvidence = {};
  for (const [name, index] of [
    ['backgroundAfterFade', 10],
    ['eventBoundaryBefore', 47],
    ['eventBoundaryAt', 48],
    ['subtitleLastVisible', 147],
    ['subtitleEnded', 148],
  ]) {
    const samplePath = path.join(evidenceDirectory, `frame-${String(index).padStart(3, '0')}.png`);
    await runProcess(mediaTools.ffmpegPath, [
      '-y', '-v', 'error', '-i', outputPath,
      '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1', samplePath,
    ]);
    const sample = await fsp.readFile(samplePath);
    assert(sample.length > 1_000, `${label}: ${name} frame ${index} evidence is empty.`);
    frameEvidence[name] = samplePath;
  }
  const videoBytes = await fsp.readFile(outputPath);
  const mp4EvidencePath = path.join(evidenceDirectory, `${label}.mp4`);
  await fsp.copyFile(outputPath, mp4EvidencePath);
  return {
    outputPath,
    evidenceVideoPath: mp4EvidencePath,
    sha256: hash(videoBytes),
    byteLength: videoBytes.length,
    frameCount,
    durationSeconds,
    fps,
    codec: video.codec_name,
    pixelFormat: video.pix_fmt,
    width: video.width,
    height: video.height,
    audioStreams: audio.length,
    ffprobePath: mediaTools.ffprobePath,
    firstFramePath,
    lastFramePath,
    lastNormalSampleIndex: 156,
    frameEvidence,
    projectState: null,
  };
}

async function startFromCreatorUi(evidenceRoot, label, options = {}) {
  const before = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const priorJobCount = formalStarts.length;
  await clickSelector('[data-testid="quick-action-export"]');
  const nativeSavePath = path.join(evidenceRoot, `${label}-save-as.png`);
  const overwritePromptPath = path.join(evidenceRoot, `${label}-windows-overwrite.png`);
  const applicationOverwriteScreenshotPath = options.cancelApplicationOverwrite || options.confirmApplicationOverwrite
    ? path.join(evidenceRoot, `${label}-${options.cancelApplicationOverwrite ? 'overwrite-cancel' : 'overwrite-confirm'}.png`)
    : null;
  await clickNativeSaveDialog('save', nativeSavePath, options.captureOverwritePrompt ? overwritePromptPath : '');
  if (options.cancelApplicationOverwrite || options.confirmApplicationOverwrite) {
    const overwriteAction = options.cancelApplicationOverwrite ? 'overwrite-cancel' : 'overwrite-confirm';
    await clickNativeOverwriteConfirmation(overwriteAction, applicationOverwriteScreenshotPath);
  }
  if (options.cancelApplicationOverwrite) {
    await waitForRenderer(`!document.querySelector('[data-testid="export-task-surface"]')`, 20_000);
    return {
      before,
      after: await rendererJs('window.__pandaStageIssue816Acceptance.inspect()'),
      fileSha256: options.targetPath && existsSync(options.targetPath)
        ? hash(readFileSync(options.targetPath))
        : null,
      cancelled: true,
      nativeSaveAsScreenshotPath: nativeSavePath,
      windowsOverwriteScreenshotPath: options.captureOverwritePrompt ? overwritePromptPath : null,
      applicationOverwriteScreenshotPath,
    };
  }

  await waitForRenderer(`document.querySelector('[data-testid="export-task-surface"][data-task-status="running"]')`, 30_000);
  let progressCaptured = false;
  try {
    await waitForRenderer(`Number(document.querySelector('[data-testid="export-task-surface"] progress')?.value ?? 0) > 0`, 45_000);
    const image = await mainWindow.webContents.capturePage();
    await fsp.writeFile(path.join(evidenceRoot, `${label}-progress.png`), image.toPNG());
    progressCaptured = true;
  } catch {
    // Export may finish before a frame-progress screenshot is sampled.
  }
  const completionTimeoutMs = options.completionTimeoutMs ?? (label === 'speaker-focus' ? 360_000 : 180_000);
  await waitForRenderer(`['completed', 'failed'].includes(document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus)`, completionTimeoutMs);
  const taskStatus = await rendererJs(`document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus`);
  if (taskStatus !== 'completed') {
    const starts = formalStarts.slice(priorJobCount);
    const failedJobId = starts.at(-1)?.jobId;
    const failedJob = failedJobId ? exportService.getJob(failedJobId) : null;
    const taskText = await rendererJs(`document.querySelector('[data-testid="export-task-surface"]')?.innerText ?? ''`);
    const image = await mainWindow.webContents.capturePage();
    await fsp.writeFile(path.join(evidenceRoot, `${label}-failed.png`), image.toPNG());
    throw new Error(`${label}: formal export ended as ${taskStatus}. ${JSON.stringify({ failedJob, latestUpdate: jobUpdates.at(-1), taskText })}`);
  }
  const after = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const taskImage = await mainWindow.webContents.capturePage();
  const completedScreenshotPath = path.join(evidenceRoot, `${label}-completed.png`);
  await fsp.writeFile(completedScreenshotPath, taskImage.toPNG());
  const starts = formalStarts.slice(priorJobCount);
  assert(starts.length === 1, `${label}: expected one formal Main export start, got ${starts.length}.`);
  return {
    before,
    after,
    start: starts[0],
    progressCaptured,
    nativeSaveAsScreenshotPath: nativeSavePath,
    windowsOverwriteScreenshotPath: options.captureOverwritePrompt ? overwritePromptPath : null,
    applicationOverwriteScreenshotPath,
    progressScreenshotPath: progressCaptured ? path.join(evidenceRoot, `${label}-progress.png`) : null,
    completedScreenshotPath,
  };
}

async function run() {
  fixture = await generateIssue819Fixture(path.resolve(baseDirectory));
  fixtureProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixture.projectRoot, 'project.json'), 'utf8')));
  const projectFilePath = path.join(fixture.projectRoot, 'project.json');
  const initialProjectBytes = await fsp.readFile(projectFilePath);
  for (const asset of fixtureProject.assets) {
    assetBytesById.set(asset.id, await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath)));
  }
  const evidenceRoot = fixture.evidenceRoot;
  await fsp.mkdir(evidenceRoot, { recursive: true });
  installProjectFixtureIpc();
  createRendererService();
  createExportService();
  const mediaTools = resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath });
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.setContentSize(1280, 800);
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const result = {
    issue: 819,
    workOrder: 'DL-02 formal MP4 export acceptance',
    root: fixture.root,
    projectRoot: fixture.projectRoot,
    platform: process.platform,
    electronVersion: process.versions.electron,
    startedAt: new Date().toISOString(),
    auto: 'RUNNING',
    owner: 'NOT_ATTESTED',
    source: {
      projectPath: projectFilePath,
      projectSha256: hash(initialProjectBytes),
      media: fixtureProject.assets.map((asset) => ({
        assetId: asset.id,
        relativePath: asset.relativePath,
        sha256: asset.sha256,
        byteLength: assetBytesById.get(asset.id)?.length ?? null,
      })),
    },
  };

  try {
    assert(fixtureProject.shots.length === 1, 'Fixture must contain exactly one Shot.');
    assert(fixtureProject.shots[0].audioClips.length === 0, 'Fixture must contain no audio clips.');
    assert(fixtureProject.shots[0].durationMs > 5_000, 'Fixture must exceed the old five-second probe ceiling.');
    await waitForRenderer(`document.querySelector('[data-task4-core="recent-open"]')`);
    await clickSelector('[data-task4-core="recent-open"]');
    await waitForRenderer("window.__pandaStageIssue816Acceptance && (await window.__pandaStageIssue816Acceptance.inspect())?.project");
    const opened = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(opened.project.id === fixtureProject.id, 'Creator UI opened a different Project.');

    const edited = await rendererJs('window.__pandaStageIssue816Acceptance.editUnsavedFixture()');
    assert(edited.dirty === true && edited.revision === opened.revision + 1, 'Unsaved fixture edit did not enter the formal Project revision.');
    assert(edited.undoCount === opened.undoCount + 1, 'Unsaved fixture edit did not create exactly one History entry.');
    const editorSnapshotPath = path.join(evidenceRoot, 'editor-snapshot.json');
    const editorSnapshotBytes = Buffer.from(JSON.stringify(edited.project, null, 2), 'utf8');
    await fsp.writeFile(editorSnapshotPath, editorSnapshotBytes);
    const beforeCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    await clickSelector('[data-testid="quick-action-drawer-handle"]');
    await clickSelector('[data-testid="quick-action-export"]');
    const nativeSaveAsCancelScreenshotPath = path.join(evidenceRoot, 'native-save-as-cancel.png');
    await clickNativeSaveDialog('cancel', nativeSaveAsCancelScreenshotPath);
    await waitForRenderer(`!document.querySelector('[data-testid="export-task-surface"]')`);
    const afterCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(
      afterCancel.revision === beforeCancel.revision &&
      afterCancel.dirty === beforeCancel.dirty &&
      afterCancel.undoCount === beforeCancel.undoCount,
      'Native Save As cancellation changed Project revision, dirty state, or History.',
    );

    const outputPath = path.join(fixture.projectRoot, defaultExportFileName(fixtureProject.name));
    assert(!existsSync(outputPath), 'The unique fixture output target unexpectedly exists.');
    const staticRun = await startFromCreatorUi(evidenceRoot, 'static');
    assert(staticRun.start.cameraMode === 'static', 'First Creator UI export did not capture static camera mode.');
    assert(staticRun.start.revision === staticRun.before.revision && staticRun.start.dirtyAtCapture === true, 'Static candidate did not capture the current dirty Project revision.');
    assert(
      staticRun.after.revision === staticRun.before.revision &&
      staticRun.after.dirty === staticRun.before.dirty &&
      staticRun.after.undoCount === staticRun.before.undoCount,
      'Static export changed Project revision, dirty state, or History.',
    );
    assert((await fsp.readFile(projectFilePath)).equals(initialProjectBytes), 'Static export wrote the unsaved editor revision into project.json.');
    const staticEvidence = await exportEvidence(outputPath, path.join(evidenceRoot, 'static'), 'static', mediaTools);
    staticEvidence.cameraMode = staticRun.start.cameraMode;
    staticEvidence.progressScreenshotCaptured = staticRun.progressCaptured;
    staticEvidence.creatorUiEvidence = {
      nativeSaveAs: staticRun.nativeSaveAsScreenshotPath,
      progress: staticRun.progressScreenshotPath,
      completed: staticRun.completedScreenshotPath,
    };
    staticEvidence.capturedCandidate = {
      snapshotId: staticRun.start.snapshotId,
      revision: staticRun.start.revision,
      dirtyAtCapture: staticRun.start.dirtyAtCapture,
    };

    const staticHashBeforeConflict = hash(await fsp.readFile(outputPath));
    await clickSelector('[data-testid="right-mode-auto-camera"]');
    await waitForRenderer(`document.querySelector('[data-testid="right-mode-auto-camera"]')?.getAttribute('aria-pressed') === 'true'`);
    const conflictCancel = await startFromCreatorUi(evidenceRoot, 'speaker-focus-conflict', {
      cancelApplicationOverwrite: true,
      captureOverwritePrompt: true,
      targetPath: outputPath,
    });
    assert(conflictCancel.cancelled, 'Existing-target overwrite cancellation did not cancel the UI task.');
    assert(conflictCancel.fileSha256 === staticHashBeforeConflict, 'Overwrite cancellation changed the existing MP4.');
    assert(
      conflictCancel.after.revision === conflictCancel.before.revision &&
      conflictCancel.after.dirty === conflictCancel.before.dirty &&
      conflictCancel.after.undoCount === conflictCancel.before.undoCount,
      'Overwrite cancellation changed Project revision, dirty state, or History.',
    );

    const speakerRun = await startFromCreatorUi(evidenceRoot, 'speaker-focus', {
      captureOverwritePrompt: true,
      confirmApplicationOverwrite: true,
    });
    assert(speakerRun.start.cameraMode === 'speaker-focus', 'Speaker Focus export did not capture the existing resolver mode.');
    assert(speakerRun.start.dirtyAtCapture === true, 'Speaker Focus candidate lost the unsaved Project revision.');
    assert(
      speakerRun.after.revision === speakerRun.before.revision &&
      speakerRun.after.dirty === speakerRun.before.dirty &&
      speakerRun.after.undoCount === speakerRun.before.undoCount,
      'Speaker Focus export changed Project revision, dirty state, or History.',
    );
    assert((await fsp.readFile(projectFilePath)).equals(initialProjectBytes), 'Speaker Focus export wrote the unsaved editor revision into project.json.');
    const speakerEvidence = await exportEvidence(outputPath, path.join(evidenceRoot, 'speaker-focus'), 'speaker-focus', mediaTools);
    speakerEvidence.cameraMode = speakerRun.start.cameraMode;
    speakerEvidence.progressScreenshotCaptured = speakerRun.progressCaptured;
    speakerEvidence.creatorUiEvidence = {
      nativeSaveAs: speakerRun.nativeSaveAsScreenshotPath,
      overwritePrompt: speakerRun.windowsOverwriteScreenshotPath,
      overwriteConfirmation: speakerRun.applicationOverwriteScreenshotPath,
      progress: speakerRun.progressScreenshotPath,
      completed: speakerRun.completedScreenshotPath,
    };
    speakerEvidence.capturedCandidate = {
      snapshotId: speakerRun.start.snapshotId,
      revision: speakerRun.start.revision,
      dirtyAtCapture: speakerRun.start.dirtyAtCapture,
    };

    const externalPlayerScript = path.join(__dirname, 'issue819-external-player.ps1');
    let externalPlayer = { launch: 'NOT_ATTEMPTED', screenshotPath: null };
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        externalPlayerScript,
        outputPath,
        path.join(evidenceRoot, 'external-player.png'),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const launched = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => code === 0
          ? resolve(stdout.trim())
          : reject(new Error(stderr.trim() || stdout.trim())));
      });
      externalPlayer = JSON.parse(launched);
    } catch (error) {
      externalPlayer = { launch: 'FAILED', error: String(error) };
    }
    assert(externalPlayer.launch === 'STARTED', 'External player did not open the formal MP4.');

    const latestEditorState = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    result.fixture = {
      projectId: fixtureProject.id,
      shotCount: fixtureProject.shots.length,
      durationMs: fixtureProject.shots[0].durationMs,
      audioClipCount: fixtureProject.shots[0].audioClips.length,
      layerNames: fixtureProject.shots[0].layers.map((layer) => layer.name),
      timelineEventTypes: [...new Set(fixtureProject.shots[0].timelineEvents.map((event) => event.type))],
      timelineEvents: fixtureProject.shots[0].timelineEvents.map((event) => ({
        type: event.type,
        layerId: event.layerId,
        startMs: event.startMs,
        endMs: event.endMs,
      })),
      sourceDialogueText: fixtureProject.shots[0].dialogues[0]?.text,
    };
    result.editorSnapshot = {
      path: editorSnapshotPath,
      sha256: hash(editorSnapshotBytes),
      revision: edited.revision,
      dirty: edited.dirty,
      undoCount: edited.undoCount,
      renderedDialogueText: edited.project.shots[0]?.dialogues[0]?.text ?? null,
    };
    result.nativeSaveAsCancel = {
      stateUnchanged: true,
      screenshotPath: nativeSaveAsCancelScreenshotPath,
    };
    result.existingTargetCancel = {
      existingOutputSha256: staticHashBeforeConflict,
      afterCancelSha256: conflictCancel.fileSha256,
      stateUnchanged: true,
      nativeSaveAsScreenshotPath: conflictCancel.nativeSaveAsScreenshotPath,
      windowsOverwriteScreenshotPath: conflictCancel.windowsOverwriteScreenshotPath,
      applicationOverwriteScreenshotPath: conflictCancel.applicationOverwriteScreenshotPath,
    };
    result.outputs = { static: staticEvidence, speakerFocus: speakerEvidence };
    result.editorState = {
      revision: latestEditorState.revision,
      dirty: latestEditorState.dirty,
      undoCount: latestEditorState.undoCount,
      historyUnchangedAcrossExports:
        latestEditorState.revision === edited.revision &&
        latestEditorState.dirty === edited.dirty &&
        latestEditorState.undoCount === edited.undoCount,
    };
    result.exportJobs = jobUpdates.map((update) => ({
      jobId: update.jobId,
      status: update.status,
      phase: update.phase,
      completedFrames: update.completedFrames,
      totalFrames: update.totalFrames,
    }));
    result.externalPlayer = externalPlayer;
    result.auto = 'PASS';
    result.completedAt = new Date().toISOString();
    result.owner = {
      status: 'NOT_ATTESTED',
      note: 'Owner must visually review the MP4 in an external player and accept the output separately.',
    };
    await fsp.writeFile(path.join(evidenceRoot, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
    await fsp.writeFile(path.join(fixture.root, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(`PASS #819 DL-02 formal MP4 export acceptance: ${fixture.root}`);
    mainWindow.destroy();
    hiddenWindowManager.close();
    app.exit(0);
  } catch (error) {
    result.auto = 'FAIL';
    result.error = String(error.stack ?? error);
    result.diagnostics = {
      formalStarts,
      mediaFailures,
      latestExportUpdate: jobUpdates.at(-1) ?? null,
      visibleTask: mainWindow && !mainWindow.isDestroyed()
        ? await rendererJs(`document.querySelector('[data-testid="export-task-surface"]')?.innerText ?? ''`).catch(() => null)
        : null,
    };
    result.completedAt = new Date().toISOString();
    await fsp.writeFile(path.join(evidenceRoot, 'electron-failure.json'), JSON.stringify(result, null, 2), 'utf8').catch(() => undefined);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const failureImage = await mainWindow.webContents.capturePage().catch(() => null);
      if (failureImage) await fsp.writeFile(path.join(evidenceRoot, 'electron-failure.png'), failureImage.toPNG()).catch(() => undefined);
      mainWindow.destroy();
    }
    hiddenWindowManager?.close();
    console.error(result.error);
    app.exit(1);
  } finally {
    removeExportHandlers?.();
    removeExportPreparationHandlers?.();
    removeProjectIpcHandlers?.();
    exportPreparationService?.disposeSync();
  }
}

run().catch((error) => {
  console.error(error.stack ?? error);
  app.exit(1);
});
