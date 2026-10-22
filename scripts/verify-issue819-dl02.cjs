const { app, dialog, ipcMain, shell } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
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

const dl03Mode = process.env.PANDA_STAGE_ISSUE823_DL03 === '1';
const baseDirectory =
  process.env.PANDA_STAGE_ISSUE819_ROOT ??
  (dl03Mode
    ? 'D:\\PandaStage-Acceptance\\issue823-dl03'
    : 'D:\\PandaStage-Acceptance\\issue819-dl02');
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
let exportFileSystem = null;
let hiddenWindowManager = null;
let removeExportPreparationHandlers = null;
let removeProjectIpcHandlers = null;
let removeExportHandlers = null;
let assetBytesById = new Map();
const formalStarts = [];
const jobUpdates = [];
const mediaFailures = [];
const injectedCommitConflicts = [];
const formalCommitRecords = [];
let conflictAtCommitPath = null;
let failNextEncoderRun = false;
let requireEncoderProcessError = false;

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
    assertFormalOutputLocation: (outputPath) => {
      if (!exportFileSystem) throw new Error('Verifier formal filesystem is unavailable.');
      return exportFileSystem.assertFormalOutputLocation(outputPath);
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
  const runMediaProcess = mediaAdapter.runProcess.bind(mediaAdapter);
  mediaAdapter.runProcess = (executable, args, options) => {
    if (requireEncoderProcessError && args.includes('libx264')) {
      requireEncoderProcessError = false;
      return runMediaProcess(executable, ['-xerror', ...args], options);
    }
    return runMediaProcess(executable, args, options);
  };
  mediaAdapter.encodePngSequence = async (request, signal) => {
    try {
      if (failNextEncoderRun) {
        failNextEncoderRun = false;
        requireEncoderProcessError = true;
        await fsp.writeFile(path.join(request.framesDirectory, 'frame_000000.png'), Buffer.from('deliberately invalid PNG for encoder failure acceptance'));
      }
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
  exportFileSystem = new class extends FileSystemService {
    async commitFormalOutputNoReplace(stagingPath, outputPath) {
      if (conflictAtCommitPath && path.resolve(outputPath) === path.resolve(conflictAtCommitPath)) {
        const sentinel = Buffer.from('third-party file inserted at the final commit boundary');
        await fsp.writeFile(outputPath, sentinel, { flag: 'wx' });
        injectedCommitConflicts.push({
          outputPath,
          sha256: hash(sentinel),
          byteLength: sentinel.length,
          insertedAfterOutputCheck: true,
        });
        conflictAtCommitPath = null;
      }
      await super.commitFormalOutputNoReplace(stagingPath, outputPath);
      formalCommitRecords.push({
        stagingPath,
        outputPath,
        sha256: hash(await fsp.readFile(outputPath)),
        stagingRemoved: !existsSync(stagingPath),
      });
    }
  }(path.join(fixture.root, 'frame-jobs'));
  exportService = new ExportService(
    hiddenWindowManager,
    exportFileSystem,
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
        await exportPreparationService.finalizeCandidateExport(request.snapshotId);
        throw error;
      }
      formalStarts.at(-1).jobId = handle.jobId;
      void handle.completion.then(
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
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

async function clickButtonContainingText(text) {
  const point = await rendererJs(`(() => {
    const target = [...document.querySelectorAll('[data-testid="export-task-surface"] button')]
      .find((button) => button.innerText.includes(${JSON.stringify(text)}));
    if (!target) throw new Error('Missing export action ' + ${JSON.stringify(text)});
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  mainWindow.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  mainWindow.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(150);
}

function clickNativeSaveDialog(action, screenshotPath, overwritePromptScreenshotPath = '', selectedFileName = '') {
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
      selectedFileName,
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

function measureToneAmplitude(samples, startSeconds, frequencyHz, sampleRate = 48_000) {
  const start = Math.floor(startSeconds * sampleRate);
  const count = Math.floor(0.12 * sampleRate);
  if ((start + count) * 4 > samples.length || count <= 0) return 0;
  let sine = 0;
  let cosine = 0;
  for (let index = 0; index < count; index += 1) {
    const value = samples.readFloatLE((start + index) * 4);
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    sine += value * Math.sin(phase);
    cosine += value * Math.cos(phase);
  }
  return (2 * Math.hypot(sine, cosine)) / count;
}

async function captureAudioMixEvidence(outputPath, evidenceDirectory, mediaTools, mixFixture) {
  const pcmPath = path.join(evidenceDirectory, 'decoded-audio.f32le');
  await runProcess(mediaTools.ffmpegPath, [
    '-y', '-v', 'error', '-i', outputPath,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '48000',
    '-c:a', 'pcm_f32le', '-f', 'f32le', pcmPath,
  ]);
  const pcm = await fsp.readFile(pcmPath);
  assert(pcm.length >= 6 * 48_000 * 4, 'DL-03 AAC decode is shorter than six seconds.');

  const measure = (timeSeconds, frequencyHz) =>
    measureToneAmplitude(pcm, timeSeconds, frequencyHz);
  const measurements = {
    dialogueOffsetMarkerAt100ms: {
      expectedHz: 440,
      wrongZeroOffsetMarkerHz: 330,
      expectedAmplitude: measure(0.1, 440),
      wrongMarkerAmplitude: measure(0.1, 330),
    },
    dialogueOffsetMarkerAt600ms: {
      expectedHz: 660,
      expectedAmplitude: measure(0.6, 660),
    },
    bgmAt500ms: measure(0.5, 220),
    bgmAt1200ms: measure(1.2, 260),
    sfxOneOffsetMarkerAt1600ms: {
      expectedHz: 880,
      wrongZeroOffsetMarkerHz: 600,
      expectedAmplitude: measure(1.6, 880),
      wrongMarkerAmplitude: measure(1.6, 600),
    },
    sfxTwoOffsetMarkerAt2050ms: {
      expectedHz: 1_320,
      wrongZeroOffsetMarkerHz: 600,
      expectedAmplitude: measure(2.05, 1_320),
      wrongMarkerAmplitude: measure(2.05, 600),
    },
    overlappingSfxAt2250ms: {
      sfxOne880Hz: measure(2.25, 880),
      sfxTwo1320Hz: measure(2.25, 1_320),
    },
    sfxOneAfterEndAt2750ms: measure(2.75, 880),
    sfxTwoAfterOverlapAt2750ms: measure(2.75, 1_320),
    dialogueAfterEndAt3200ms: measure(3.2, 660),
    bgmNearShotTailAt6250ms: measure(6.25, 260),
  };

  assert(measurements.dialogueOffsetMarkerAt100ms.expectedAmplitude > 0.05, 'Dialogue source offset marker is absent from the output.');
  assert(measurements.dialogueOffsetMarkerAt100ms.wrongMarkerAmplitude < 0.025, 'Dialogue source offset was not applied.');
  assert(measurements.dialogueOffsetMarkerAt600ms.expectedAmplitude > 0.05, 'Dialogue source-time transition is absent.');
  assert(measurements.bgmAt500ms > 0.02 && measurements.bgmAt1200ms > 0.02, 'BGM did not span its expected source segments.');
  assert(measurements.sfxOneOffsetMarkerAt1600ms.expectedAmplitude > 0.06, 'First SFX source offset marker is absent.');
  assert(measurements.sfxOneOffsetMarkerAt1600ms.wrongMarkerAmplitude < 0.025, 'First SFX source offset was not applied.');
  assert(measurements.sfxTwoOffsetMarkerAt2050ms.expectedAmplitude > 0.08, 'Second SFX source offset marker is absent.');
  assert(measurements.sfxTwoOffsetMarkerAt2050ms.wrongMarkerAmplitude < 0.025, 'Second SFX source offset was not applied.');
  assert(measurements.overlappingSfxAt2250ms.sfxOne880Hz > 0.06, 'First overlapping SFX is missing.');
  assert(measurements.overlappingSfxAt2250ms.sfxTwo1320Hz > 0.08, 'Second overlapping SFX is missing.');
  assert(measurements.sfxOneAfterEndAt2750ms < 0.025, 'First SFX continues past its clip end.');
  assert(measurements.sfxTwoAfterOverlapAt2750ms > 0.08, 'Second SFX does not continue after the overlap.');
  assert(measurements.dialogueAfterEndAt3200ms < 0.025, 'Dialogue continues after its audio clip ends.');
  assert(measurements.bgmNearShotTailAt6250ms > 0.02, 'BGM does not reach the Shot tail.');

  const result = {
    pcmPath,
    sampleRate: 48_000,
    sampleFormat: 'f32le mono',
    decodedDurationSeconds: pcm.length / (4 * 48_000),
    projectMixFixture: mixFixture,
    measurements,
    subtitleContinuesPastDialogueAudio: mixFixture.subtitleEndMs > mixFixture.dialogueEndMs,
  };
  await fsp.writeFile(path.join(evidenceDirectory, 'audio-mix-samples.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

async function exportEvidence(outputPath, evidenceDirectory, label, mediaTools, options = {}) {
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
  const expectAudioMix = options.expectAudioMix === true;
  assert(video?.codec_name === 'h264', `${label}: FFprobe did not report H.264.`);
  assert(video?.pix_fmt === 'yuv420p', `${label}: FFprobe did not report yuv420p.`);
  assert(video?.width === 1920 && video?.height === 1080, `${label}: FFprobe frame size is not 1920x1080.`);
  assert(Math.abs(fps - 24) < 0.001, `${label}: FFprobe frame rate is not 24 fps (${fps}).`);
  assert(audio.length === (expectAudioMix ? 1 : 0), `${label}: expected ${expectAudioMix ? 'one' : 'zero'} audio stream(s), received ${audio.length}.`);
  if (expectAudioMix) {
    assert(audio[0]?.codec_name === 'aac', `${label}: FFprobe did not report AAC.`);
    assert(audio[0]?.sample_rate === '48000', `${label}: AAC sample rate is not 48000 Hz.`);
    assert(Math.abs(Number(audio[0]?.duration) - 6.501) < 0.08, `${label}: AAC duration is not aligned to the 6.501 second Shot.`);
  }
  assert(frameCount === 157, `${label}: export frame count differs from the 6.501 second Shot (${frameCount} frames).`);
  assert(Math.abs(durationSeconds - frameCount / 24) < 0.08, `${label}: encoded duration does not match the frame schedule.`);

  await fsp.mkdir(evidenceDirectory, { recursive: true });
  const audioMixEvidence = expectAudioMix
    ? await captureAudioMixEvidence(outputPath, evidenceDirectory, mediaTools, options.mixFixture)
    : null;
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
  const frameSamples = [
    ['backgroundAfterFade', 10],
    ['eventBoundaryBefore', 47],
    ['eventBoundaryAt', 48],
    ['visibilityBefore', 66],
    ['visibilityAt', 68],
    ['visibilityAfter', 70],
    ['expressionBefore', 95],
    ['expressionAt', 96],
    ['subtitleLastVisible', 147],
    ['subtitleEnded', 148],
  ];
  if (expectAudioMix) {
    frameSamples.push(
      ['mouthDialogueOpen', 71],
      ['mouthDialogueEndedWithSubtitle', 72],
      ['mouthBgmOnlyWithSubtitle', 74],
    );
  }
  for (const [name, index] of frameSamples) {
    const samplePath = path.join(evidenceDirectory, `frame-${String(index).padStart(3, '0')}.png`);
    await runProcess(mediaTools.ffmpegPath, [
      '-y', '-v', 'error', '-i', outputPath,
      '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1', samplePath,
    ]);
    const sample = await fsp.readFile(samplePath);
    assert(sample.length > 1_000, `${label}: ${name} frame ${index} evidence is empty.`);
    frameEvidence[name] = samplePath;
  }
  const expressionRawPaths = {
    before: path.join(evidenceDirectory, 'expression-before.rgb'),
    at: path.join(evidenceDirectory, 'expression-at.rgb'),
  };
  for (const [name, index] of [['before', 95], ['at', 96]]) {
    await runProcess(mediaTools.ffmpegPath, [
      '-y', '-v', 'error', '-i', outputPath,
      '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', expressionRawPaths[name],
    ]);
  }
  const expressionBefore = await fsp.readFile(expressionRawPaths.before);
  const expressionAt = await fsp.readFile(expressionRawPaths.at);
  assert(expressionBefore.length === expressionAt.length && expressionBefore.length > 0, `${label}: expression boundary samples are invalid.`);
  let expressionChangedPixels = 0;
  let expressionAbsoluteDelta = 0;
  for (let offset = 0; offset < expressionBefore.length; offset += 3) {
    const delta = Math.abs(expressionBefore[offset] - expressionAt[offset]) +
      Math.abs(expressionBefore[offset + 1] - expressionAt[offset + 1]) +
      Math.abs(expressionBefore[offset + 2] - expressionAt[offset + 2]);
    if (delta > 0) expressionChangedPixels += 1;
    expressionAbsoluteDelta += delta;
  }
  assert(expressionChangedPixels > 100, `${label}: expression event did not change the decoded video frame.`);
  const expressionContrast = {
    beforeFrameIndex: 95,
    atFrameIndex: 96,
    beforePngPath: frameEvidence.expressionBefore,
    atPngPath: frameEvidence.expressionAt,
    beforeRawSha256: hash(expressionBefore),
    atRawSha256: hash(expressionAt),
    changedPixels: expressionChangedPixels,
    meanAbsoluteChannelDelta: expressionAbsoluteDelta / expressionBefore.length,
  };
  let mouthEvidence = null;
  if (expectAudioMix) {
    assert(options.mixFixture?.mouthOpenAssetId, `${label}: DL-03 fixture has no mouth-open image.`);
    const mouthFrames = {
      dialogueOpen: path.join(evidenceDirectory, 'mouth-dialogue-open.rgb'),
      dialogueEnded: path.join(evidenceDirectory, 'mouth-dialogue-ended.rgb'),
      bgmOnly: path.join(evidenceDirectory, 'mouth-bgm-only.rgb'),
    };
    for (const [name, index] of [
      ['dialogueOpen', 71],
      ['dialogueEnded', 72],
      ['bgmOnly', 74],
    ]) {
      await runProcess(mediaTools.ffmpegPath, [
        '-y', '-v', 'error', '-i', outputPath,
        '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', mouthFrames[name],
      ]);
    }
    const raw = {
      dialogueOpen: await fsp.readFile(mouthFrames.dialogueOpen),
      dialogueEnded: await fsp.readFile(mouthFrames.dialogueEnded),
      bgmOnly: await fsp.readFile(mouthFrames.bgmOnly),
    };
    assert(
      raw.dialogueOpen.length > 0 &&
      raw.dialogueOpen.length === raw.dialogueEnded.length &&
      raw.dialogueEnded.length === raw.bgmOnly.length,
      `${label}: mouth projection boundary frames are invalid.`,
    );
    const compareFrames = (left, right) => {
      let changedPixels = 0;
      let absoluteChannelDelta = 0;
      for (let offset = 0; offset < left.length; offset += 3) {
        const delta = Math.abs(left[offset] - right[offset]) +
          Math.abs(left[offset + 1] - right[offset + 1]) +
          Math.abs(left[offset + 2] - right[offset + 2]);
        if (delta > 24) changedPixels += 1;
        absoluteChannelDelta += delta;
      }
      return {
        pixelsWithDeltaOver24: changedPixels,
        meanAbsoluteChannelDelta: absoluteChannelDelta / left.length,
      };
    };
    const activeToEnded = compareFrames(raw.dialogueOpen, raw.dialogueEnded);
    const endedToBgmOnly = compareFrames(raw.dialogueEnded, raw.bgmOnly);
    assert(activeToEnded.pixelsWithDeltaOver24 > 500, `${label}: Simple Mouth did not change between open dialogue and ended dialogue.`);
    assert(endedToBgmOnly.pixelsWithDeltaOver24 < 1_000, `${label}: BGM changed the closed mouth after dialogue audio ended.`);
    assert(endedToBgmOnly.meanAbsoluteChannelDelta < 0.1, `${label}: visual output changed during BGM-only subtitle tail.`);
    mouthEvidence = {
      mouthOpenAssetId: options.mixFixture.mouthOpenAssetId,
      mouthOpenAssetSha256: options.mixFixture.mouthOpenAssetSha256,
      dialogueClipEndMs: options.mixFixture.dialogueEndMs,
      subtitleEndMs: options.mixFixture.subtitleEndMs,
      dialogueOpenFrameIndex: 71,
      dialogueEndClosedFrameIndex: 72,
      bgmOnlyClosedFrameIndex: 74,
      dialogueOpenToClosed: activeToEnded,
      closedDuringBgmTail: endedToBgmOnly,
      framePaths: {
        dialogueOpen: frameEvidence.mouthDialogueOpen,
        dialogueEndedWithSubtitle: frameEvidence.mouthDialogueEndedWithSubtitle,
        bgmOnlyWithSubtitle: frameEvidence.mouthBgmOnlyWithSubtitle,
      },
    };
    await fsp.writeFile(path.join(evidenceDirectory, 'mouth-projection.json'), JSON.stringify(mouthEvidence, null, 2), 'utf8');
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
    audioMixEvidence,
    ffprobePath: mediaTools.ffprobePath,
    firstFramePath,
    lastFramePath,
    lastNormalSampleIndex: 156,
    frameEvidence,
    expressionContrast,
    mouthEvidence,
    stageLabelContract: {
      formalRendererProp: 'showStageLabel=false',
      previewDefault: 'showStageLabel=true',
      fixedStageLabel: 'PANDA STAGE · 1920 × 1080',
    },
    projectState: null,
  };
}

async function directoryEntriesOrEmpty(directory) {
  return fsp.readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
}

async function assertNoExportTemporaries(label) {
  const deadline = Date.now() + 10_000;
  let remaining;
  do {
    const [projectEntries, frameEntries, preparationEntries] = await Promise.all([
      directoryEntriesOrEmpty(fixture.projectRoot),
      directoryEntriesOrEmpty(path.join(fixture.root, 'frame-jobs')),
      directoryEntriesOrEmpty(path.join(fixture.root, 'frozen-media')),
    ]);
    remaining = {
      outputTemporaries: projectEntries.filter((entry) => entry.startsWith('.panda-stage-')),
      frameJobDirectories: frameEntries,
      preparationSnapshots: preparationEntries,
    };
    if (
      remaining.outputTemporaries.length === 0 &&
      remaining.frameJobDirectories.length === 0 &&
      remaining.preparationSnapshots.length === 0
    ) {
      return remaining;
    }
    if (Date.now() < deadline) await pause(100);
  } while (Date.now() < deadline);

  assert(remaining.outputTemporaries.length === 0, `${label}: formal output staging remains: ${remaining.outputTemporaries.join(', ')}`);
  assert(remaining.frameJobDirectories.length === 0, `${label}: frame-job directories remain: ${remaining.frameJobDirectories.join(', ')}`);
  assert(remaining.preparationSnapshots.length === 0, `${label}: frozen-media snapshots remain: ${remaining.preparationSnapshots.join(', ')}`);
  return remaining;
}

async function startFromCreatorUi(evidenceRoot, label, options = {}) {
  const before = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const priorJobCount = formalStarts.length;
  await clickSelector('[data-testid="quick-action-export"]');
  const nativeSavePath = path.join(evidenceRoot, `${label}-save-as.png`);
  const overwritePromptPath = path.join(evidenceRoot, `${label}-windows-overwrite.png`);
  await clickNativeSaveDialog(
    'save',
    nativeSavePath,
    options.captureOverwritePrompt ? overwritePromptPath : '',
    options.selectedFileName ?? '',
  );
  const taskSelector = "document.querySelector('[data-testid=\"export-task-surface\"]')";
  const taskStatus = `${taskSelector}?.dataset.taskStatus`;
  if (options.expectedFailureText) {
    await waitForRenderer(
      `${taskStatus} === 'failed' && ${taskSelector}?.innerText.includes(${JSON.stringify(options.expectedFailureText)})`,
      30_000,
    );
    const image = await mainWindow.webContents.capturePage();
    const failureScreenshotPath = path.join(evidenceRoot, `${label}-blocked.png`);
    await fsp.writeFile(failureScreenshotPath, image.toPNG());
    const starts = formalStarts.slice(priorJobCount);
    assert(starts.length === 0, `${label}: unsupported output unexpectedly started a Main export.`);
    return {
      before,
      after: await rendererJs('window.__pandaStageIssue816Acceptance.inspect()'),
      status: 'failed',
      taskText: await rendererJs(`${taskSelector}?.innerText ?? ''`),
      starts,
      nativeSaveAsScreenshotPath: nativeSavePath,
      windowsOverwriteScreenshotPath: options.captureOverwritePrompt ? overwritePromptPath : null,
      failureScreenshotPath,
    };
  }

  await waitForRenderer(`${taskStatus} === 'running'`, 30_000);
  let progressCaptured = false;
  try {
    await waitForRenderer(`Number(document.querySelector('[data-testid="export-task-surface"] progress')?.value ?? 0) > 0`, 45_000);
    const image = await mainWindow.webContents.capturePage();
    await fsp.writeFile(path.join(evidenceRoot, `${label}-progress.png`), image.toPNG());
    progressCaptured = true;
  } catch {
    // Export may finish before a frame-progress screenshot is sampled.
  }
  if (options.cancelAfterProgress) {
    assert(progressCaptured, `${label}: export completed before cancellation could be exercised.`);
    if (options.duplicateClickDuringRun) {
      const startCount = formalStarts.length;
      await clickSelector('[data-testid="quick-action-export"]');
      assert(formalStarts.length === startCount, `${label}: repeating Export started a second Main Job.`);
    }
    await clickButtonContainingText('取消导出');
    await waitForRenderer(`${taskStatus} === 'cancelled'`, 60_000);
    const starts = formalStarts.slice(priorJobCount);
    assert(starts.length === 1, `${label}: expected one cancelled Main export.`);
    const image = await mainWindow.webContents.capturePage();
    const cancelledScreenshotPath = path.join(evidenceRoot, `${label}-cancelled.png`);
    await fsp.writeFile(cancelledScreenshotPath, image.toPNG());
    return {
      before,
      after: await rendererJs('window.__pandaStageIssue816Acceptance.inspect()'),
      start: starts[0],
      status: 'cancelled',
      progressCaptured,
      nativeSaveAsScreenshotPath: nativeSavePath,
      progressScreenshotPath: path.join(evidenceRoot, `${label}-progress.png`),
      cancelledScreenshotPath,
    };
  }
  const completionTimeoutMs = options.completionTimeoutMs ?? 360_000;
  await waitForRenderer(`['completed', 'failed'].includes(${taskStatus})`, completionTimeoutMs);
  const finalStatus = await rendererJs(taskStatus);
  const starts = formalStarts.slice(priorJobCount);
  if (options.expectJobFailure && finalStatus === 'failed') {
    assert(starts.length === 1, `${label}: expected one failed Main export.`);
    const failedJob = exportService.getJob(starts[0].jobId);
    const taskText = await rendererJs(`${taskSelector}?.innerText ?? ''`);
    const image = await mainWindow.webContents.capturePage();
    const failureScreenshotPath = path.join(evidenceRoot, `${label}-failed.png`);
    await fsp.writeFile(failureScreenshotPath, image.toPNG());
    return {
      before,
      after: await rendererJs('window.__pandaStageIssue816Acceptance.inspect()'),
      start: starts[0],
      failedJob,
      taskText,
      status: finalStatus,
      progressCaptured,
      nativeSaveAsScreenshotPath: nativeSavePath,
      progressScreenshotPath: progressCaptured ? path.join(evidenceRoot, `${label}-progress.png`) : null,
      failureScreenshotPath,
    };
  }
  if (finalStatus !== 'completed') {
    const failedJobId = starts.at(-1)?.jobId;
    const failedJob = failedJobId ? exportService.getJob(failedJobId) : null;
    const taskText = await rendererJs(`document.querySelector('[data-testid="export-task-surface"]')?.innerText ?? ''`);
    const image = await mainWindow.webContents.capturePage();
    await fsp.writeFile(path.join(evidenceRoot, `${label}-failed.png`), image.toPNG());
    throw new Error(`${label}: formal export ended as ${finalStatus}. ${JSON.stringify({ failedJob, latestUpdate: jobUpdates.at(-1), taskText })}`);
  }
  const after = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const taskImage = await mainWindow.webContents.capturePage();
  const completedScreenshotPath = path.join(evidenceRoot, `${label}-completed.png`);
  await fsp.writeFile(completedScreenshotPath, taskImage.toPNG());
  assert(starts.length === 1, `${label}: expected one formal Main export start, got ${starts.length}.`);
  return {
    before,
    after,
    start: starts[0],
    progressCaptured,
    nativeSaveAsScreenshotPath: nativeSavePath,
    windowsOverwriteScreenshotPath: options.captureOverwritePrompt ? overwritePromptPath : null,
    progressScreenshotPath: progressCaptured ? path.join(evidenceRoot, `${label}-progress.png`) : null,
    completedScreenshotPath,
  };
}

async function run() {
  fixture = await generateIssue819Fixture(path.resolve(baseDirectory), {
    includeAudioMix: dl03Mode,
  });
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
    issue: dl03Mode ? 823 : 819,
    workOrder: dl03Mode
      ? 'DL-03 formal single-Shot audio/video export acceptance'
      : 'DL-02 formal MP4 export acceptance',
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
      expressionAssetHashes: fixture.expressionAssetHashes,
      mouthOpenAssetSha256: fixture.mouthOpenAssetSha256,
    },
  };

  try {
    assert(fixtureProject.shots.length === 1, 'Fixture must contain exactly one Shot.');
    assert(
      fixtureProject.shots[0].audioClips.length === (dl03Mode ? 4 : 0),
      `Fixture must contain ${dl03Mode ? 'four valid audio clips' : 'no audio clips'}.`,
    );
    assert(fixtureProject.shots[0].durationMs > 5_000, 'Fixture must exceed the old five-second probe ceiling.');
    const expressionHashes = Object.values(fixture.expressionAssetHashes);
    assert(expressionHashes.length === 2 && expressionHashes[0] !== expressionHashes[1], 'Neutral and happy fixture PNGs must have different SHA-256 hashes.');
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

    const staticOutputPath = path.join(fixture.projectRoot, 'static.mp4');
    assert(!existsSync(staticOutputPath), 'The unique fixture output target unexpectedly exists.');
    const staticRun = await startFromCreatorUi(evidenceRoot, 'static', {
      selectedFileName: path.basename(staticOutputPath),
    });
    assert(staticRun.start.cameraMode === 'static', 'First Creator UI export did not capture static camera mode.');
    assert(staticRun.start.revision === staticRun.before.revision && staticRun.start.dirtyAtCapture === true, 'Static candidate did not capture the current dirty Project revision.');
    assert(
      staticRun.after.revision === staticRun.before.revision &&
      staticRun.after.dirty === staticRun.before.dirty &&
      staticRun.after.undoCount === staticRun.before.undoCount,
      'Static export changed Project revision, dirty state, or History.',
    );
    assert((await fsp.readFile(projectFilePath)).equals(initialProjectBytes), 'Static export wrote the unsaved editor revision into project.json.');
    const staticEvidence = await exportEvidence(
      staticOutputPath,
      path.join(evidenceRoot, 'static'),
      'static',
      mediaTools,
      { expectAudioMix: dl03Mode, mixFixture: fixture.audioMixFixture },
    );
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

    const staticHashBeforeConflict = hash(await fsp.readFile(staticOutputPath));
    await clickSelector('[data-testid="right-mode-auto-camera"]');
    await waitForRenderer(`document.querySelector('[data-testid="right-mode-auto-camera"]')?.getAttribute('aria-pressed') === 'true'`);
    const existingTargetReject = await startFromCreatorUi(evidenceRoot, 'existing-target-rejected', {
      captureOverwritePrompt: true,
      selectedFileName: path.basename(staticOutputPath),
      expectedFailureText: '输出文件已存在',
    });
    assert(existingTargetReject.status === 'failed', 'Existing target was not blocked after native Save As confirmation.');
    assert(existingTargetReject.starts.length === 0, 'Existing-target rejection started an export Job.');
    const staticHashAfterReject = hash(await fsp.readFile(staticOutputPath));
    assert(staticHashAfterReject === staticHashBeforeConflict, 'Existing-target rejection changed the existing MP4.');
    assert(
      existingTargetReject.after.revision === existingTargetReject.before.revision &&
      existingTargetReject.after.dirty === existingTargetReject.before.dirty &&
      existingTargetReject.after.undoCount === existingTargetReject.before.undoCount,
      'Existing-target rejection changed Project revision, dirty state, or History.',
    );
    const existingTargetCleanup = await assertNoExportTemporaries('existing target rejection');

    const speakerOutputPath = path.join(fixture.projectRoot, 'speaker-focus.mp4');
    const speakerRun = await startFromCreatorUi(evidenceRoot, 'speaker-focus', {
      selectedFileName: path.basename(speakerOutputPath),
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
    const speakerEvidence = await exportEvidence(
      speakerOutputPath,
      path.join(evidenceRoot, 'speaker-focus'),
      'speaker-focus',
      mediaTools,
      { expectAudioMix: dl03Mode, mixFixture: fixture.audioMixFixture },
    );
    speakerEvidence.cameraMode = speakerRun.start.cameraMode;
    speakerEvidence.progressScreenshotCaptured = speakerRun.progressCaptured;
    speakerEvidence.creatorUiEvidence = {
      nativeSaveAs: speakerRun.nativeSaveAsScreenshotPath,
      progress: speakerRun.progressScreenshotPath,
      completed: speakerRun.completedScreenshotPath,
    };
    speakerEvidence.capturedCandidate = {
      snapshotId: speakerRun.start.snapshotId,
      revision: speakerRun.start.revision,
      dirtyAtCapture: speakerRun.start.dirtyAtCapture,
    };

    const unsupportedUiCases = [];
    if (!dl03Mode) {
    for (const scenario of [
      { id: 'multi-shot', expectedText: '只支持单镜头工程', fileName: 'unsupported-multi-shot.mp4' },
      { id: 'no-background', expectedText: '需要可见的图像背景', fileName: 'unsupported-no-background.mp4' },
    ]) {
      const scenarioState = await rendererJs(
        `window.__pandaStageIssue816Acceptance.setExportScenario(${JSON.stringify(scenario.id)})`,
      );
      const targetPath = path.join(fixture.projectRoot, scenario.fileName);
      assert(!existsSync(targetPath), `${scenario.id}: blocked target must start absent.`);
      const blocked = await startFromCreatorUi(evidenceRoot, `unsupported-${scenario.id}`, {
        selectedFileName: scenario.fileName,
        expectedFailureText: scenario.expectedText,
      });
      assert(!existsSync(targetPath), `${scenario.id}: blocked preparation created an MP4.`);
      assert(
        blocked.after.revision === blocked.before.revision &&
        blocked.after.dirty === blocked.before.dirty &&
        blocked.after.undoCount === blocked.before.undoCount,
        `${scenario.id}: blocked export changed Project revision, dirty state, or History.`,
      );
      unsupportedUiCases.push({
        scenario: scenario.id,
        inputProjectSha256: hash(Buffer.from(JSON.stringify(scenarioState.project), 'utf8')),
        targetPath,
        targetAbsent: true,
        formalJobsStarted: blocked.starts.length,
        taskText: blocked.taskText,
        screenshotPath: blocked.failureScreenshotPath,
        projectRevision: scenarioState.revision,
        temporaryCleanup: await assertNoExportTemporaries(`${scenario.id} blocked preparation`),
      });
    }
    await rendererJs("window.__pandaStageIssue816Acceptance.setExportScenario('baseline')");
    }

    const raceTargetPath = path.join(fixture.projectRoot, 'target-created-at-commit.mp4');
    conflictAtCommitPath = raceTargetPath;
    const raceRun = await startFromCreatorUi(evidenceRoot, 'target-created-at-commit', {
      selectedFileName: path.basename(raceTargetPath),
      expectJobFailure: true,
    });
    const raceReceipt = injectedCommitConflicts.at(-1);
    assert(raceReceipt?.outputPath === raceTargetPath, 'The deterministic commit-boundary conflict did not run.');
    const raceTargetSha256 = hash(await fsp.readFile(raceTargetPath));
    assert(raceTargetSha256 === raceReceipt.sha256, 'The no-clobber commit changed the third-party target.');
    assert(raceRun.failedJob?.status === 'failed', 'The race-conflicted Main Job was not failed.');
    const raceCleanup = await assertNoExportTemporaries('commit-boundary target conflict');

    const cancellationTargetPath = path.join(fixture.projectRoot, 'cancelled-export.mp4');
    const cancellationRun = await startFromCreatorUi(evidenceRoot, 'cancelled-export', {
      selectedFileName: path.basename(cancellationTargetPath),
      cancelAfterProgress: true,
      duplicateClickDuringRun: true,
    });
    assert(cancellationRun.status === 'cancelled', 'Formal UI cancellation did not finish as cancelled.');
    assert(!existsSync(cancellationTargetPath), 'Cancelled export created a formal MP4.');
    const cancellationJob = exportService.getJob(cancellationRun.start.jobId);
    assert(cancellationJob?.status === 'cancelled', 'Main did not record the cancelled export.');
    const cancellationCleanup = await assertNoExportTemporaries('formal UI cancellation');

    const encoderFailureTargetPath = path.join(fixture.projectRoot, 'encoder-failure.mp4');
    failNextEncoderRun = true;
    const encoderFailureRun = await startFromCreatorUi(evidenceRoot, 'encoder-failure', {
      selectedFileName: path.basename(encoderFailureTargetPath),
      expectJobFailure: true,
    });
    assert(!existsSync(encoderFailureTargetPath), 'Encoder failure created a formal MP4.');
    const encoderDiagnostic = mediaFailures.at(-1);
    assert(encoderDiagnostic?.code === 'PROCESS_FAILED', 'The controlled encoder failure did not reach FFmpeg as a process error.');
    const encoderFailureCleanup = await assertNoExportTemporaries('FFmpeg encoding failure');
    assert(hash(await fsp.readFile(staticOutputPath)) === staticHashBeforeConflict, 'A failure path changed the existing static MP4.');

    const externalPlayerScript = path.join(__dirname, 'issue819-external-player.ps1');
    let externalPlayer = { launch: 'NOT_ATTEMPTED', screenshotPath: null };
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        externalPlayerScript,
        speakerOutputPath,
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
      audioMixFixture: fixture.audioMixFixture,
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
    result.existingTargetRejection = {
      existingOutputSha256: staticHashBeforeConflict,
      afterRejectSha256: staticHashAfterReject,
      exportJobStarted: existingTargetReject.starts.length > 0,
      nativeSaveAsScreenshotPath: existingTargetReject.nativeSaveAsScreenshotPath,
      windowsOverwriteScreenshotPath: existingTargetReject.windowsOverwriteScreenshotPath,
      blockedScreenshotPath: existingTargetReject.failureScreenshotPath,
      temporaryCleanup: existingTargetCleanup,
    };
    result.commitRace = {
      ...raceReceipt,
      thirdPartySha256After: raceTargetSha256,
      jobStatus: raceRun.failedJob.status,
      visibleTask: raceRun.taskText,
      failureScreenshotPath: raceRun.failureScreenshotPath,
      temporaryCleanup: raceCleanup,
    };
    result.unsupportedUiCases = unsupportedUiCases;
    result.cancellation = {
      targetPath: cancellationTargetPath,
      targetExists: existsSync(cancellationTargetPath),
      jobStatus: cancellationJob.status,
      duplicateClickStartedSecondJob: false,
      screenshotPath: cancellationRun.cancelledScreenshotPath,
      temporaryCleanup: cancellationCleanup,
    };
    result.encoderFailure = {
      targetPath: encoderFailureTargetPath,
      targetExists: existsSync(encoderFailureTargetPath),
      jobStatus: encoderFailureRun.failedJob.status,
      executable: encoderDiagnostic.executable,
      args: encoderDiagnostic.args,
      stderr: encoderDiagnostic.stderr,
      failureScreenshotPath: encoderFailureRun.failureScreenshotPath,
      temporaryCleanup: encoderFailureCleanup,
    };
    result.existingStaticOutput = {
      path: staticOutputPath,
      sha256BeforeFailures: staticHashBeforeConflict,
      sha256AfterFailures: hash(await fsp.readFile(staticOutputPath)),
      unchanged: hash(await fsp.readFile(staticOutputPath)) === staticHashBeforeConflict,
    };
    result.outputs = { static: staticEvidence, speakerFocus: speakerEvidence };
    result.editorState = {
      revision: latestEditorState.revision,
      dirty: latestEditorState.dirty,
      undoCount: latestEditorState.undoCount,
      positiveExportsPreservedProjectState:
        staticRun.after.revision === staticRun.before.revision &&
        staticRun.after.dirty === staticRun.before.dirty &&
        staticRun.after.undoCount === staticRun.before.undoCount &&
        speakerRun.after.revision === speakerRun.before.revision &&
        speakerRun.after.dirty === speakerRun.before.dirty &&
        speakerRun.after.undoCount === speakerRun.before.undoCount,
      projectFileUnchanged: (await fsp.readFile(projectFilePath)).equals(initialProjectBytes),
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
    console.log(
      `PASS #${dl03Mode ? '823 DL-03 formal A/V' : '819 DL-02 formal MP4'} export acceptance: ${fixture.root}`,
    );
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
