const { app, dialog, ipcMain, shell } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
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
const { UnsavedCloseGuard } = require('../dist-electron/main/windows/unsaved-close-guard.js');
const { confirmPendingExportWork } = require('../dist-electron/main/windows/export-close-confirmation.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');
const { evaluateSpeakerFocusCamera, prepareSpeakerFocusCamera } = require('../dist-electron/domain/resolve-speaker-focus-camera.js');
const { buildExportAudioMixPlan } = require('../dist-electron/domain/export-audio-mix-plan.js');
const { iterateFormalProjectFrameSchedule } = require('../dist-electron/shared/export-types.js');
const { mapProjectTime } = require('../dist-electron/domain/selectors/projectTime.js');
const { generateIssue819Fixture, generateIssue827Fixture } = require('./issue819-fixtures.cjs');

const dl03Mode = process.env.PANDA_STAGE_ISSUE823_DL03 === '1';
const dl04Mode = process.env.PANDA_STAGE_ISSUE827_DL04 === '1';
const dl05FollowupMode = process.env.PANDA_STAGE_ISSUE834_FOLLOWUP === '1';
const dl06R0Mode = process.env.PANDA_STAGE_ISSUE836_DL06_R0 === '1';
const dl05Mode = process.env.PANDA_STAGE_ISSUE832_DL05 === '1' || dl05FollowupMode;
const dl04SampleId = Number(process.env.PANDA_STAGE_ISSUE827_SAMPLE ?? '1');
const baseDirectory =
  process.env.PANDA_STAGE_ISSUE834_ROOT ??
  process.env.PANDA_STAGE_ISSUE832_ROOT ??
  process.env.PANDA_STAGE_ISSUE827_ROOT ??
  process.env.PANDA_STAGE_ISSUE819_ROOT ??
  (dl05FollowupMode
    ? 'D:\\PandaStage-Acceptance\\issue834-dl05-followup'
    : dl05Mode
    ? 'D:\\PandaStage-Acceptance\\issue832-dl05'
    : dl04Mode
    ? `D:\\PandaStage-Acceptance\\issue827-dl04\\sample-${dl04SampleId}`
    : dl03Mode
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
function frameJobsRoot() {
  // DL-06 path probes can isolate project/output paths from the transient frame path.
  const issue836PathProbeRoot = process.env.PANDA_STAGE_ISSUE836_FRAME_ROOT;
  return issue836PathProbeRoot
    ? path.resolve(issue836PathProbeRoot)
    : path.join(fixture.root, 'frame-jobs');
}
function shortIssue834Project(project) {
  const shortProject = structuredClone(project);
  shortProject.shots = shortProject.shots.map((shot, index) => {
    const firstDialogue = shot.dialogues[0];
    const dialogues = index === 0 && firstDialogue
      ? (() => {
          const dialogue = {
            ...firstDialogue,
            startMs: 50,
            endMs: 450,
            text: 'DL05 original visible subtitle',
          };
          delete dialogue.audioClipId;
          return [dialogue];
        })()
      : [];
    return {
      ...shot,
      durationMs: 500,
      dialogues,
      timelineEvents: [],
      audioClips: [],
    };
  });
  return ProjectSchema.parse(shortProject);
}

function controlledGate() {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  return { started, markStarted, wait, release };
}

const closePromptEvidence = [];
const saveDialogEvidence = [];
function installIssue834CloseGuard(window) {
  const guard = new UnsavedCloseGuard({
    controller: {
      hasDirtyProject: () => false,
      requestClose: async () => 'allow-close',
    },
    confirmPendingWork: () => confirmPendingExportWork(window, {
      getPreparation: () => exportPreparationService,
      getExportService: () => exportService,
      showMessageBox: async (_target, options) => {
        closePromptEvidence.push({
          title: options.title,
          message: options.message,
          buttons: options.buttons,
        });
        return { response: 0 };
      },
    }),
    synchronizeRenderer: async () => ({ ok: true }),
    reportRendererSyncFailure: (error) => {
      closePromptEvidence.push({ synchronizationError: error });
    },
    closeWindow: () => {
      if (!window.isDestroyed()) window.close();
    },
    quitApplication: () => app.quit(),
  });
  window.on('close', (event) => guard.handleWindowClose(event));
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
    hiddenWindowManager?.close();
  });
  return guard;
}

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
const audioMixPlans = [];
const jobUpdates = [];
const mediaFailures = [];
const injectedCommitConflicts = [];
const formalCommitRecords = [];
const revealedOutputs = [];
const diskRecentProjectOpens = [];
let conflictAtCommitPath = null;
let failNextEncoderRun = false;
let requireEncoderProcessError = false;
let replaceDialogueSourceBeforeNextMix = false;
let failNextAudioMixProcess = false;
let failNextOutputValidation = false;
let pauseNextIssue834Encode = null;
let pauseIssue834Commit = null;
let issue834Stage = 'startup';
const audioSourceReplacementEvidence = [];
const audioMixProcessFailures = [];

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

async function projectPersistenceFingerprint(project, projectRoot) {
  const backgroundByShot = project.shots.map((shot, shotIndex) => {
    const layer = shot.layers.find((candidate) => candidate.id === shot.backgroundLayerId);
    const assetId = layer?.source.kind === 'asset' ? layer.source.assetId : null;
    const asset = assetId ? project.assets.find((candidate) => candidate.id === assetId) : null;
    if (!asset || asset.kind !== 'image') {
      throw new Error(`Shot ${shotIndex} has no persisted image background asset.`);
    }
    return { shotIndex, shotId: shot.id, backgroundLayerId: shot.backgroundLayerId, assetId, relativePath: asset.relativePath };
  });
  const usedAssetIds = new Set([
    ...backgroundByShot.map((background) => background.assetId),
    ...project.shots.flatMap((shot) => shot.audioClips.map((clip) => clip.assetId)),
  ]);
  const assets = [];
  for (const assetId of [...usedAssetIds].sort()) {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error(`Persisted Project references missing asset ${assetId}.`);
    const bytes = await fsp.readFile(path.join(projectRoot, asset.relativePath));
    const actualSha256 = hash(bytes);
    assert(actualSha256 === asset.sha256, `Persisted asset ${assetId} does not match its Project SHA-256.`);
    assets.push({ assetId, relativePath: asset.relativePath, expectedSha256: asset.sha256, actualSha256 });
  }
  return {
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    shotOrder: project.shots.map((shot) => shot.id),
    shots: project.shots.map((shot, shotIndex) => ({
      shotIndex,
      shotId: shot.id,
      name: shot.name,
      durationMs: shot.durationMs,
      backgroundLayerId: shot.backgroundLayerId,
      backgroundAssetId: backgroundByShot[shotIndex].assetId,
      dialogues: shot.dialogues.map((dialogue) => ({
        id: dialogue.id,
        startMs: dialogue.startMs,
        endMs: dialogue.endMs,
        audioClipId: dialogue.audioClipId ?? null,
        text: dialogue.text,
      })),
      audioClips: shot.audioClips.map((clip) => ({
        id: clip.id,
        assetId: clip.assetId,
        role: clip.role,
        startMs: clip.startMs,
        endMs: clip.endMs,
        sourceOffsetMs: clip.offsetMs,
        volume: clip.volume,
      })),
    })),
    backgrounds: backgroundByShot.map((background) => ({
      ...background,
      sha256: assets.find((asset) => asset.assetId === background.assetId)?.actualSha256 ?? null,
    })),
    assets,
  };
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

  const document = (project = fixtureProject) => ({
    projectRoot: fixture.projectRoot,
    projectFilePath: path.join(fixture.projectRoot, 'project.json'),
    project,
    migrated: false,
    sourceVersion: project.schemaVersion,
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
  registerMock('RECENT_PROJECTS_OPEN', async (_event, request) => {
    assert(path.resolve(request.projectRoot) === path.resolve(fixture.projectRoot), 'Reopen request did not target the fixture Project root.');
    if (dl05FollowupMode) {
      const reopenedProject = ProjectSchema.parse(
        JSON.parse(await fsp.readFile(path.join(fixture.projectRoot, 'project.json'), 'utf8')),
      );
      return { ok: true, document: document(reopenedProject) };
    }
    if (!dl04Mode) return { ok: true, document: document() };
    const reopenedDocument = await projectService.open(request.projectRoot);
    assert(reopenedDocument.project.id === request.expectedProjectId, 'Reopened Project ID differs from the selected recent-project entry.');
    diskRecentProjectOpens.push({
      projectRoot: reopenedDocument.projectRoot,
      projectId: reopenedDocument.project.id,
      projectFileSha256: hash(await fsp.readFile(reopenedDocument.projectFilePath)),
      openSource: 'ProjectService.open(projectRoot)',
    });
    return { ok: true, document: reopenedDocument };
  });
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
      saveDialogEvidence.push({
        phase: 'opened',
        defaultPath: path.join(request.projectRoot, defaultExportFileName(request.projectName)),
        at: new Date().toISOString(),
      });
      const selected = await dialog.showSaveDialog(window, {
        title: 'Export MP4',
        buttonLabel: 'Save',
        defaultPath: path.join(request.projectRoot, defaultExportFileName(request.projectName)),
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        properties: [],
      });
      saveDialogEvidence.at(-1).result = selected.canceled ? 'cancelled' : 'selected';
      saveDialogEvidence.at(-1).selectedPath = selected.filePath ?? null;
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
    if (failNextAudioMixProcess && args.includes('-filter_complex')) {
      failNextAudioMixProcess = false;
      const partialOutputPath = args.at(-1) ?? '';
      const partialBytes = Buffer.from('controlled partial audio mix');
      return fsp.writeFile(partialOutputPath, partialBytes).then(() => {
        audioMixProcessFailures.push({
          executable,
          args,
          partialOutputPath,
          partialSha256: hash(partialBytes),
          returnedExitCode: 1,
        });
        return {
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'Controlled DL-03 mid-mix process failure after partial output.',
        };
      });
    }
    return runMediaProcess(executable, args, options);
  };
  const muxAudioMix = mediaAdapter.muxAudioMix.bind(mediaAdapter);
  mediaAdapter.muxAudioMix = async (request, signal) => {
    if (dl04Mode || dl05Mode) audioMixPlans.push(structuredClone(request.audioMixPlan));
    if (!replaceDialogueSourceBeforeNextMix) return muxAudioMix(request, signal);
    replaceDialogueSourceBeforeNextMix = false;
    const dialogueAsset = fixtureProject.assets.find(
      (asset) => asset.id === fixture.audioMixFixture?.dialogueAssetId,
    );
    const replacementAsset = fixtureProject.assets.find(
      (asset) => asset.relativePath === 'assets/dl03-sfx-one.wav',
    );
    assert(dialogueAsset?.kind === 'audio' && replacementAsset?.kind === 'audio', 'Source-replacement assets are missing.');
    const sourcePath = path.join(fixture.projectRoot, dialogueAsset.relativePath);
    const replacementPath = path.join(fixture.projectRoot, replacementAsset.relativePath);
    const frozenDialoguePath = request.audioMixPlan.clips.find(
      (clip) => clip.assetId === dialogueAsset.id,
    )?.sourcePath;
    assert(frozenDialoguePath, 'Frozen dialogue source was not included in the audio mix plan.');
    const originalBytes = await fsp.readFile(sourcePath);
    const replacementBytes = await fsp.readFile(replacementPath);
    const frozenBytes = await fsp.readFile(frozenDialoguePath);
    assert(hash(originalBytes) === dialogueAsset.sha256, 'Dialogue source differs before replacement injection.');
    assert(hash(frozenBytes) === dialogueAsset.sha256, 'Frozen dialogue media does not match the validated source.');
    assert(hash(replacementBytes) !== dialogueAsset.sha256, 'Replacement source unexpectedly matches the original dialogue.');
    const record = {
      assetId: dialogueAsset.id,
      sourcePath,
      originalSha256: hash(originalBytes),
      replacementSha256: hash(replacementBytes),
      frozenSourcePath: frozenDialoguePath,
      frozenSha256BeforeMix: hash(frozenBytes),
      outputPath: request.outputPath,
      muxCompleted: false,
      restoredSha256: null,
    };
    await fsp.writeFile(sourcePath, replacementBytes);
    try {
      const result = await muxAudioMix(request, signal);
      record.muxCompleted = true;
      record.mixedOutputSha256 = hash(await fsp.readFile(request.outputPath));
      return result;
    } finally {
      await fsp.writeFile(sourcePath, originalBytes);
      record.restoredSha256 = hash(await fsp.readFile(sourcePath));
      audioSourceReplacementEvidence.push(record);
    }
  };
  mediaAdapter.encodePngSequence = async (request, signal) => {
    try {
      if (dl05FollowupMode && pauseNextIssue834Encode) {
        const gate = pauseNextIssue834Encode;
        pauseNextIssue834Encode = null;
        gate.markStarted();
        await gate.wait;
      }
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
      if (dl05FollowupMode && pauseIssue834Commit) {
        const gate = pauseIssue834Commit;
        pauseIssue834Commit = null;
        gate.markStarted();
        await gate.wait;
      }
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
  }(frameJobsRoot());
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
        attemptId: input.candidate.attemptId,
        snapshotId: request.snapshotId,
        reuseSnapshot: request.reuseSnapshot,
        cameraMode: input.candidate.cameraMode,
        revision: input.candidate.revision,
        dirtyAtCapture: input.candidate.dirtyAtCapture,
        mediaCount: input.candidate.mediaManifest.length,
        projectContentSha256: hash(Buffer.from(JSON.stringify(input.candidate.project), 'utf8')),
        mediaManifest: input.candidate.mediaManifest.map((entry) => ({
          assetId: entry.assetId,
          sha256: entry.sha256,
        })),
        frozenPayloadSha256: hash(Buffer.from(JSON.stringify({
          project: input.candidate.project,
          media: input.candidate.mediaManifest.map((entry) => ({
            assetId: entry.assetId,
            sha256: entry.sha256,
          })),
        }), 'utf8')),
      });
      let handle;
      try {
        handle = exportService.startFormalExport(
          input,
          async () => {
            if (failNextOutputValidation) {
              failNextOutputValidation = false;
              throw new Error('Controlled DL-05 output identity validation failure.');
            }
            return exportPreparationService.assertOutputTargetUnchanged(request.snapshotId);
          },
        );
      } catch (error) {
        if (dl05Mode) {
          await exportPreparationService.retainCandidateForRetry(request.snapshotId);
        } else {
          await exportPreparationService.finalizeCandidateExport(request.snapshotId);
        }
        throw error;
      }
      formalStarts.at(-1).jobId = handle.jobId;
      void handle.completion.then(
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
        () => dl05Mode
          ? exportPreparationService.retainCandidateForRetry(request.snapshotId)
          : exportPreparationService.finalizeCandidateExport(request.snapshotId),
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
      if (dl05FollowupMode) revealedOutputs.push(outputPath);
      else shell.showItemInFolder(outputPath);
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

function verifyMovedAudioClipContract(mixFixture) {
  const shot = fixtureProject.shots[0];
  const clip = shot?.audioClips.find((item) => item.id === mixFixture.sfxOnly?.clipId);
  const asset = clip && fixtureProject.assets.find((item) => item.id === clip.assetId);
  assert(shot && clip && asset?.kind === 'audio', 'DL-03 moved-clip contract fixture is missing its SFX asset.');
  const planAt = (startMs, endMs) => buildExportAudioMixPlan(shot.durationMs, [{
    clipId: clip.id,
    assetId: clip.assetId,
    role: clip.role,
    sourcePath: path.join(fixture.projectRoot, asset.relativePath),
    startMs,
    endMs,
    offsetMs: clip.offsetMs,
    volume: clip.volume,
  }]);
  const beforeMovePlan = planAt(mixFixture.sfxOnly.movedFromStartMs, mixFixture.sfxOnly.movedFromEndMs);
  const movedPlan = planAt(clip.startMs, clip.endMs);
  const beforeMove = beforeMovePlan.clips[0];
  const moved = movedPlan.clips[0];
  assert(moved?.startMs === clip.startMs, 'Moving the clip did not update its timeline start.');
  assert(beforeMove?.sourceOffsetMs === clip.offsetMs, 'The source offset before move differs from the clip offset.');
  assert(moved?.sourceOffsetMs === beforeMove.sourceOffsetMs, 'Moving the clip changed its source offset.');
  return {
    clipId: clip.id,
    originalStartMs: mixFixture.sfxOnly.movedFromStartMs,
    movedStartMs: moved.startMs,
    originalEndMs: mixFixture.sfxOnly.movedFromEndMs,
    movedEndMs: moved.endMs,
    sourceOffsetBeforeMs: beforeMove.sourceOffsetMs,
    sourceOffsetAfterMs: moved.sourceOffsetMs,
    beforeMovePlanSha256: hash(Buffer.from(JSON.stringify(beforeMovePlan), 'utf8')),
    movedPlanSha256: hash(Buffer.from(JSON.stringify(movedPlan), 'utf8')),
  };
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
    sfxOnlyAfterDialogueAt3600ms: {
      expectedHz: 880,
      wrongZeroOffsetMarkerHz: 600,
      expectedAmplitude: measure(3.6, 880),
      wrongMarkerAmplitude: measure(3.6, 600),
    },
    zeroGainSfxAt4200ms: measure(4.2, 880),
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
  assert(measurements.sfxOnlyAfterDialogueAt3600ms.expectedAmplitude > 0.06, 'The moved SFX-only clip is missing after Dialogue ended.');
  assert(measurements.sfxOnlyAfterDialogueAt3600ms.wrongMarkerAmplitude < 0.025, 'The moved SFX-only clip did not preserve its source offset.');
  assert(measurements.zeroGainSfxAt4200ms < 0.025, 'The zero-gain SFX clip is audible.');
  assert(measurements.bgmNearShotTailAt6250ms > 0.02, 'BGM does not reach the Shot tail.');

  const result = {
    pcmPath,
    sampleRate: 48_000,
    sampleFormat: 'f32le mono',
    decodedDurationSeconds: pcm.length / (4 * 48_000),
    projectMixFixture: mixFixture,
    measurements,
    movedClipContract: verifyMovedAudioClipContract(mixFixture),
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
      ['mouthSfxOnlyWithSubtitle', 84],
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
      sfxOnly: path.join(evidenceDirectory, 'mouth-sfx-only.rgb'),
    };
    for (const [name, index] of [
      ['dialogueOpen', 71],
      ['dialogueEnded', 72],
      ['bgmOnly', 74],
      ['sfxOnly', 84],
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
      sfxOnly: await fsp.readFile(mouthFrames.sfxOnly),
    };
    assert(
      raw.dialogueOpen.length > 0 &&
      raw.dialogueOpen.length === raw.dialogueEnded.length &&
      raw.dialogueEnded.length === raw.bgmOnly.length &&
      raw.bgmOnly.length === raw.sfxOnly.length,
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
    const endedToSfxOnly = compareFrames(raw.dialogueEnded, raw.sfxOnly);
    assert(activeToEnded.pixelsWithDeltaOver24 > 500, `${label}: Simple Mouth did not change between open dialogue and ended dialogue.`);
    assert(endedToBgmOnly.pixelsWithDeltaOver24 < 1_000, `${label}: BGM changed the closed mouth after dialogue audio ended.`);
    assert(endedToBgmOnly.meanAbsoluteChannelDelta < 0.1, `${label}: visual output changed during BGM-only subtitle tail.`);
    assert(endedToSfxOnly.pixelsWithDeltaOver24 < 1_000, `${label}: SFX triggered a mouth change after dialogue ended.`);
    assert(endedToSfxOnly.meanAbsoluteChannelDelta < 0.1, `${label}: visual output changed during SFX-only subtitle tail.`);
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
      closedDuringSfxOnly: endedToSfxOnly,
      framePaths: {
        dialogueOpen: frameEvidence.mouthDialogueOpen,
        dialogueEndedWithSubtitle: frameEvidence.mouthDialogueEndedWithSubtitle,
        bgmOnlyWithSubtitle: frameEvidence.mouthBgmOnlyWithSubtitle,
        sfxOnlyWithSubtitle: frameEvidence.mouthSfxOnlyWithSubtitle,
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
      directoryEntriesOrEmpty(frameJobsRoot()),
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

async function verifyUndecodableAudioSource(initialProjectBytes) {
  const originalSnapshot = trackedSnapshot;
  const invalidProject = structuredClone(originalSnapshot.project);
  const dialogueAsset = invalidProject.assets.find(
    (asset) => asset.id === fixture.audioMixFixture?.dialogueAssetId,
  );
  assert(dialogueAsset?.kind === 'audio', 'Undecodable-source scenario has no dialogue Audio asset.');
  const sourcePath = path.join(fixture.projectRoot, dialogueAsset.relativePath);
  const originalBytes = await fsp.readFile(sourcePath);
  const originalSourceSha256 = hash(originalBytes);
  const invalidBytes = Buffer.from('invalid audio source bytes for DL-03 preflight failure');
  dialogueAsset.sha256 = hash(invalidBytes);
  const validatedProject = ProjectSchema.parse(invalidProject);
  const targetPath = path.join(fixture.root, 'undecodable-audio-source.mp4');
  assert(!existsSync(targetPath), 'Undecodable-source target must start absent.');
  const workingSnapshot = { ...originalSnapshot, project: validatedProject };
  let response;

  try {
    trackedSnapshot = workingSnapshot;
    await fsp.writeFile(sourcePath, invalidBytes);
    const selected = await exportPreparationService.selectOutput({
      projectRoot: fixture.projectRoot,
      projectId: validatedProject.id,
      projectName: validatedProject.name,
      openInstanceId: workingSnapshot.openInstanceId,
    }, targetPath);
    assert(selected.status === 'selected', 'Undecodable-source output selection was not accepted.');
    response = await exportPreparationService.prepare({
      selectionId: selected.selectionId,
      attemptId: randomUUID(),
      projectRoot: fixture.projectRoot,
      projectId: validatedProject.id,
      openInstanceId: workingSnapshot.openInstanceId,
      revision: workingSnapshot.revision,
      dirty: workingSnapshot.dirty,
      cameraMode: 'static',
      project: validatedProject,
    });
    assert(response.status === 'BLOCK', 'Undecodable source incorrectly produced a frozen export candidate.');
    assert(response.issues.some((issue) => issue.code === 'REQUIRED_MEDIA_UNAVAILABLE'), 'Undecodable source did not return the required-media block.');
  } finally {
    await fsp.writeFile(sourcePath, originalBytes);
    trackedSnapshot = originalSnapshot;
  }

  assert(!existsSync(targetPath), 'Undecodable source created an MP4 output.');
  assert(hash(await fsp.readFile(sourcePath)) === originalSourceSha256, 'Dialogue source was not restored after invalid-source preflight.');
  const cleanup = await assertNoExportTemporaries('undecodable audio source preflight');
  const diagnostics = response?.status === 'BLOCK'
    ? exportPreparationService.getDiagnostics(response.diagnosticId)
    : [];
  return {
    status: response?.status,
    issueCodes: response?.status === 'BLOCK' ? response.issues.map((issue) => issue.code) : [],
    diagnostics,
    sourceAssetId: dialogueAsset.id,
    sourcePath,
    originalSourceSha256,
    invalidSourceSha256: hash(invalidBytes),
    targetPath,
    targetExists: existsSync(targetPath),
    projectFileUnchanged: (await fsp.readFile(path.join(fixture.projectRoot, 'project.json'))).equals(initialProjectBytes),
    temporaryCleanup: cleanup,
  };
}

async function startFromCreatorUi(evidenceRoot, label, options = {}) {
  const before = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const priorJobCount = formalStarts.length;
  const priorTaskStatus = await rendererJs(
    'window.__pandaStageIssue816Acceptance.inspectExportTask()?.task?.status ?? "idle"',
  );
  let startAction;
  if (priorTaskStatus === 'idle') {
    startAction = 'quick-action-export';
    await clickSelector('[data-testid="quick-action-export"]');
  } else if (['completed', 'failed', 'cancelled'].includes(priorTaskStatus)) {
    await clickSelector('[data-testid="quick-action-export"]');
    const taskSelector = "document.querySelector('[data-testid=\"export-task-surface\"]')";
    await waitForRenderer(
      `${taskSelector}?.dataset.taskStatus === ${JSON.stringify(priorTaskStatus)}`,
    );
    const actionText = priorTaskStatus === 'completed'
      ? '\u5bfc\u51fa\u65b0\u7248\u672c'
      : '\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa';
    startAction = priorTaskStatus === 'completed'
      ? 'completed-new-version'
      : 'failed-or-cancelled-current-content-retry';
    await clickButtonContainingText(actionText);
  } else {
    throw new Error(`${label}: cannot start a new export while prior task is ${priorTaskStatus}.`);
  }
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
      startAction,
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
      startAction,
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
      startAction,
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
    throw new Error(`${label}: formal export ended as ${finalStatus}. ${JSON.stringify({ startAction, failedJob, latestUpdate: jobUpdates.at(-1), taskText })}`);
  }
  const after = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const taskImage = await mainWindow.webContents.capturePage();
  const completedScreenshotPath = path.join(evidenceRoot, `${label}-completed.png`);
  await fsp.writeFile(completedScreenshotPath, taskImage.toPNG());
  assert(starts.length === 1, `${label}: expected one formal Main export start, got ${starts.length}.`);
  return {
    before,
    after,
    startAction,
    start: starts[0],
    progressCaptured,
    nativeSaveAsScreenshotPath: nativeSavePath,
    windowsOverwriteScreenshotPath: options.captureOverwritePrompt ? overwritePromptPath : null,
    progressScreenshotPath: progressCaptured ? path.join(evidenceRoot, `${label}-progress.png`) : null,
    completedScreenshotPath,
  };
}

function pcmWindow(bytes, startMs, durationMs) {
  const sampleRate = 48_000;
  const start = Math.max(0, Math.floor((startMs * sampleRate) / 1_000));
  const count = Math.floor((durationMs * sampleRate) / 1_000);
  const end = Math.min(count, Math.floor(bytes.length / 4) - start);
  if (end <= 0) throw new Error(`PCM window is outside the decoded stream at ${startMs} ms.`);
  let squareSum = 0;
  for (let index = 0; index < end; index += 1) {
    const sample = bytes.readFloatLE((start + index) * 4);
    squareSum += sample * sample;
  }
  return { startSample: start, sampleCount: end, rms: Math.sqrt(squareSum / end) };
}

function goertzelAmplitude(bytes, startMs, durationMs, frequencyHz) {
  const { startSample, sampleCount } = pcmWindow(bytes, startMs, durationMs);
  const coefficient = 2 * Math.cos((2 * Math.PI * frequencyHz) / 48_000);
  let previous = 0;
  let previousPrevious = 0;
  for (let offset = 0; offset < sampleCount; offset += 1) {
    const sample = bytes.readFloatLE((startSample + offset) * 4);
    const current = sample + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }
  const power = Math.max(
    0,
    previous * previous + previousPrevious * previousPrevious -
      coefficient * previous * previousPrevious,
  );
  return (2 * Math.sqrt(power)) / sampleCount;
}

function compareRawFrames(left, right) {
  assert(left.length === right.length && left.length > 0, 'Decoded RGB frame sizes differ.');
  let changedPixels = 0;
  let absoluteDelta = 0;
  let lumaSum = 0;
  for (let offset = 0; offset < left.length; offset += 3) {
    const redDelta = Math.abs(left[offset] - right[offset]);
    const greenDelta = Math.abs(left[offset + 1] - right[offset + 1]);
    const blueDelta = Math.abs(left[offset + 2] - right[offset + 2]);
    if (redDelta + greenDelta + blueDelta > 24) changedPixels += 1;
    absoluteDelta += redDelta + greenDelta + blueDelta;
    lumaSum += left[offset] * 0.299 + left[offset + 1] * 0.587 + left[offset + 2] * 0.114;
  }
  return {
    changedPixels,
    meanAbsoluteChannelDelta: absoluteDelta / left.length,
    meanLuma: lumaSum / (left.length / 3),
  };
}

function sampleBackgroundRgb(rawBytes) {
  const width = 1_920;
  const rectangles = [
    { x: 16, y: 16, size: 32 },
    { x: width - 48, y: 16, size: 32 },
  ];
  const channels = [[], [], []];
  for (const rectangle of rectangles) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.size; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.size; x += 1) {
        const offset = (y * width + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          channels[channel].push(rawBytes[offset + channel]);
        }
      }
    }
  }
  return channels.map((values) => {
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  });
}

function backgroundRgbDistance(left, right) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0));
}

function assertEncodedBackground(sample, expected, backgrounds, label) {
  const observedRgb = sampleBackgroundRgb(sample.rawBytes);
  const matches = backgrounds
    .map((background) => ({
      shotIndex: background.shotIndex,
      shotId: background.shotId,
      assetId: background.assetId,
      sha256: background.sha256,
      distance: backgroundRgbDistance(observedRgb, background.expectedRgb),
    }))
    .sort((left, right) => left.distance - right.distance);
  const nearest = matches[0];
  const target = matches.find((entry) => entry.shotIndex === expected.shotIndex);
  assert(target, `${label}: expected background Shot ${expected.shotIndex + 1} is missing.`);
  assert(
    target.distance <= 36 && nearest?.shotIndex === expected.shotIndex,
    `${label}: encoded frame background did not match Shot ${expected.shotIndex + 1}. ${JSON.stringify({ observedRgb, target, nearest })}`,
  );
  return { observedRgb, expectedRgb: expected.expectedRgb, expectedAssetId: expected.assetId, expectedSha256: expected.sha256, nearestBackground: nearest };
}

function frameAtOrAfter(schedule, timeMs) {
  const entry = schedule.find((frame) => frame.timeMs >= timeMs);
  if (!entry) throw new Error(`No formal frame at or after ${timeMs} ms.`);
  return entry;
}

async function extractFormalFrame(outputPath, evidenceDirectory, mediaTools, frameIndex, label) {
  const pngPath = path.join(evidenceDirectory, `${label}.png`);
  const rawPath = path.join(evidenceDirectory, `${label}.rgb24`);
  const filter = `select=eq(n\\,${frameIndex})`;
  await runProcess(mediaTools.ffmpegPath, [
    '-y', '-v', 'error', '-i', outputPath, '-vf', filter, '-vsync', '0',
    '-frames:v', '1', pngPath,
  ]);
  await runProcess(mediaTools.ffmpegPath, [
    '-y', '-v', 'error', '-i', outputPath, '-vf', filter, '-vsync', '0',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath,
  ]);
  const [pngBytes, rawBytes] = await Promise.all([
    fsp.readFile(pngPath),
    fsp.readFile(rawPath),
  ]);
  await fsp.rm(rawPath, { force: true });
  assert(pngBytes.length > 1_000, `${label}: extracted PNG frame is empty.`);
  assert(rawBytes.length === 1_920 * 1_080 * 3, `${label}: decoded RGB frame size is invalid.`);
  return { frameIndex, pngPath, rawBytes };
}

async function issue827ExportEvidence(outputPath, evidenceDirectory, project, cameraMode, mediaTools, backgroundEvidence) {
  await fsp.mkdir(evidenceDirectory, { recursive: true });
  const durationMs = project.shots.reduce((total, shot) => total + shot.durationMs, 0);
  const schedule = Array.from(iterateFormalProjectFrameSchedule(project));
  const totalFrames = Math.ceil((durationMs * 24) / 1_000);
  assert(schedule.length === totalFrames, 'Project frame schedule did not use one global frame count.');
  assert(durationMs === 30_000 && totalFrames === 720, 'The Issue #827 long sample must be 30 seconds / 720 frames.');
  assert(schedule.at(-1)?.timeMs === 29_958, 'The final frame must be the last normal 24 fps sample.');
  assert(backgroundEvidence.length === project.shots.length, 'The Issue #827 sample requires one independently identified background per Shot.');
  assert(new Set(backgroundEvidence.map((entry) => entry.assetId)).size === project.shots.length, 'Issue #827 Shot background asset IDs are not distinct.');
  assert(new Set(backgroundEvidence.map((entry) => entry.sha256)).size === project.shots.length, 'Issue #827 Shot background hashes are not distinct.');
  for (const [shotIndex, shot] of project.shots.entries()) {
    const background = backgroundEvidence[shotIndex];
    assert(background.shotIndex === shotIndex && background.shotId === shot.id, `Issue #827 background evidence does not map to Shot ${shotIndex + 1}.`);
    const layer = shot.layers.find((candidate) => candidate.id === shot.backgroundLayerId);
    assert(layer?.source.kind === 'asset' && layer.source.assetId === background.assetId, `Issue #827 Shot ${shotIndex + 1} does not reference its distinct background asset.`);
  }

  const shotPrefixes = [];
  let prefixMs = 0;
  for (const [shotIndex, shot] of project.shots.entries()) {
    shotPrefixes.push({ shotIndex, shotId: shot.id, name: shot.name, startMs: prefixMs, durationMs: shot.durationMs, endMs: prefixMs + shot.durationMs });
    prefixMs += shot.durationMs;
  }
  const schedulePath = path.join(evidenceDirectory, 'global-frame-schedule.json');
  await fsp.writeFile(schedulePath, JSON.stringify({ durationMs, fps: 24, totalFrames, shotPrefixes, frames: schedule }, null, 2), 'utf8');

  const rawProbe = await runProcess(mediaTools.ffprobePath, [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', outputPath,
  ]);
  const probe = JSON.parse(rawProbe.stdout);
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
  const frameCount = Number(video?.nb_read_frames ?? video?.nb_frames);
  const fpsParts = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? '0/1').split('/');
  const fps = Number(fpsParts[0]) / Number(fpsParts[1] || 1);
  const durationSeconds = Number(video?.duration ?? probe.format?.duration);
  assert(video?.codec_name === 'h264' && video?.pix_fmt === 'yuv420p', 'FFprobe video codec or pixel format differs from the formal contract.');
  assert(video?.width === 1_920 && video?.height === 1_080, 'FFprobe video dimensions differ from 1920x1080.');
  assert(Math.abs(fps - 24) < 0.001 && frameCount === totalFrames, 'FFprobe frame rate or frame count differs from the global schedule.');
  assert(Math.abs(durationSeconds - totalFrames / 24) < 0.08, 'FFprobe video duration differs from the global frame schedule.');
  assert(audio.length === 1 && audio[0]?.codec_name === 'aac' && audio[0]?.sample_rate === '48000', 'The audio Project must produce one 48 kHz AAC track.');
  assert(Math.abs(Number(audio[0]?.duration) - durationMs / 1_000) < 0.08, 'AAC duration does not cover the complete Project including its silent tail.');
  const ffprobePath = path.join(evidenceDirectory, 'ffprobe.json');
  await fsp.writeFile(ffprobePath, JSON.stringify(probe, null, 2), 'utf8');

  const samples = new Map();
  const ensureSample = async (name, frameIndex) => {
    if (!samples.has(frameIndex)) {
      samples.set(frameIndex, await extractFormalFrame(outputPath, evidenceDirectory, mediaTools, frameIndex, name));
    }
    return samples.get(frameIndex);
  };
  const boundaries = [];
  for (let shotIndex = 1; shotIndex < project.shots.length; shotIndex += 1) {
    const current = shotPrefixes[shotIndex];
    const beforeFrame = schedule.filter((frame) => frame.timeMs < current.startMs).at(-1);
    const afterFrame = schedule.find((frame) => frame.timeMs >= current.startMs);
    assert(beforeFrame && afterFrame, `Shot ${shotIndex + 1} has no encoded boundary samples.`);
    const before = await ensureSample(`boundary-${shotIndex}-before`, beforeFrame.frameIndex);
    const after = await ensureSample(`boundary-${shotIndex}-after`, afterFrame.frameIndex);
    const contrast = compareRawFrames(before.rawBytes, after.rawBytes);
    assert(contrast.meanLuma > 5 && contrast.changedPixels > 500, `Shot ${shotIndex + 1} boundary did not show a complete changed frame.`);
    const beforeBackground = assertEncodedBackground(before, backgroundEvidence[shotIndex - 1], backgroundEvidence, `Shot ${shotIndex} pre-boundary frame ${before.frameIndex}`);
    const afterBackground = assertEncodedBackground(after, backgroundEvidence[shotIndex], backgroundEvidence, `Shot ${shotIndex + 1} post-boundary frame ${after.frameIndex}`);
    const logical = [-1, 0, 1].map((deltaMs) => {
      const position = mapProjectTime(project, current.startMs + deltaMs);
      return {
        requestedGlobalTimeMs: current.startMs + deltaMs,
        shotId: position.shot?.id ?? null,
        shotIndex: position.shotIndex,
        shotStartMs: position.shotStartMs,
        shotLocalTimeMs: position.shotLocalTimeMs,
      };
    });
    assert(logical[0].shotIndex === shotIndex - 1 && logical[1].shotIndex === shotIndex && logical[2].shotIndex === shotIndex, `Shot ${shotIndex + 1} does not follow the half-open Project boundary contract.`);
    boundaries.push({
      shotIndex,
      shotId: current.shotId,
      boundaryGlobalMs: current.startMs,
      beforeFrameIndex: before.frameIndex,
      beforeGlobalTimeMs: beforeFrame.timeMs,
      afterFrameIndex: after.frameIndex,
      afterGlobalTimeMs: afterFrame.timeMs,
      logical,
      pixelContrast: contrast,
      encodedBackgrounds: { before: beforeBackground, after: afterBackground },
      beforePngPath: before.pngPath,
      afterPngPath: after.pngPath,
    });
  }

  const visualTimes = [
    ['dialogue-open', 1_000],
    ['dialogue-closed-subtitle', 3_500],
    ['bgm-only-a', 4_500],
    ['bgm-only-b', 5_500],
    ['shot2-dialogue-open', shotPrefixes[1].startMs + 2_080],
    ['shot2-dialogue-closed-subtitle', shotPrefixes[1].startMs + 4_000],
    ['shot3-sfx-active', shotPrefixes[2].startMs + 4_500],
    ['shot3-sfx-ended', shotPrefixes[2].startMs + 6_000],
    ['last-normal-frame', schedule.at(-1).timeMs],
  ];
  const visualFrames = {};
  for (const [name, timeMs] of visualTimes) {
    const frame = frameAtOrAfter(schedule, timeMs);
    const sample = await ensureSample(name, frame.frameIndex);
    visualFrames[name] = { requestedTimeMs: timeMs, frameIndex: sample.frameIndex, globalTimeMs: frame.timeMs, shotId: frame.shotId, shotLocalTimeMs: frame.shotLocalTimeMs, pngPath: sample.pngPath };
  }
  const mouthComparison = compareRawFrames(
    samples.get(visualFrames['dialogue-open'].frameIndex).rawBytes,
    samples.get(visualFrames['dialogue-closed-subtitle'].frameIndex).rawBytes,
  );
  assert(mouthComparison.changedPixels > 500, 'Dialogue playback did not change the mouth/visual frame while the subtitle remained visible.');
  const bgmOnlyComparison = compareRawFrames(
    samples.get(visualFrames['bgm-only-a'].frameIndex).rawBytes,
    samples.get(visualFrames['bgm-only-b'].frameIndex).rawBytes,
  );
  assert(bgmOnlyComparison.changedPixels < 20, 'BGM-only playback changed the static dialogue mouth frame.');
  const sfxOnlyComparison = compareRawFrames(
    samples.get(visualFrames['shot3-sfx-active'].frameIndex).rawBytes,
    samples.get(visualFrames['shot3-sfx-ended'].frameIndex).rawBytes,
  );
  assert(sfxOnlyComparison.changedPixels < 20, 'SFX-only playback changed the dialogue mouth frame.');
  await fsp.writeFile(path.join(evidenceDirectory, 'boundary-and-mouth-evidence.json'), JSON.stringify({ cameraMode, boundaries, visualFrames, mouthComparison, bgmOnlyComparison, sfxOnlyComparison }, null, 2), 'utf8');

  const pcmPath = path.join(evidenceDirectory, 'decoded-audio-48k-mono.f32le');
  await runProcess(mediaTools.ffmpegPath, ['-y', '-v', 'error', '-i', outputPath, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcmPath]);
  const pcm = await fsp.readFile(pcmPath);
  assert(pcm.length >= (durationMs / 1_000) * 48_000 * 4 * 0.99, 'Decoded AAC PCM is shorter than the complete Project.');
  const audioMarkers = [
    { name: 'firstShotBgm220', timeMs: 500, frequencyHz: 220 },
    { name: 'firstShotDialogue440', timeMs: 500, frequencyHz: 440 },
    { name: 'firstShotDialogue660', timeMs: 1_100, frequencyHz: 660 },
    { name: 'firstShotBgm260', timeMs: 5_000, frequencyHz: 260 },
    { name: 'delayedSecondShotDialogue440', timeMs: shotPrefixes[1].startMs + 2_500, frequencyHz: 440 },
    { name: 'thirdShotSfx880', timeMs: shotPrefixes[2].startMs + 4_500, frequencyHz: 880 },
  ].map((marker) => ({
    ...marker,
    amplitude: goertzelAmplitude(pcm, marker.timeMs, 400, marker.frequencyHz),
    rms: pcmWindow(pcm, marker.timeMs, 400).rms,
  }));
  assert(audioMarkers.every((marker) => marker.amplitude > 0.005), 'A decoded global audio tone marker is missing or moved.');
  const gaps = [
    { name: 'interShotSilentGap', startMs: fixture.audioMixFixture.mappedClips[0].globalEndMs, endMs: fixture.audioMixFixture.mappedClips[2].globalStartMs },
    { name: 'dialogueToThirdShotSfxGap', startMs: fixture.audioMixFixture.mappedClips[2].globalEndMs, endMs: fixture.audioMixFixture.mappedClips[3].globalStartMs },
    { name: 'trailingSilentTail', startMs: fixture.audioMixFixture.mappedClips[3].globalEndMs, endMs: durationMs },
  ].map((gap) => {
    const timeMs = Math.floor((gap.startMs + gap.endMs) / 2);
    return { ...gap, sampleTimeMs: timeMs, rms: pcmWindow(pcm, timeMs, 300).rms };
  });
  assert(gaps.every((gap) => gap.endMs - gap.startMs >= 600 && gap.rms < 0.01), 'A Project silence gap or trailing silent tail was removed or shifted.');
  await fsp.writeFile(path.join(evidenceDirectory, 'audio-pcm-markers.json'), JSON.stringify({ sampleRate: 48_000, channels: 1, pcmPath, pcmSha256: hash(pcm), markers: audioMarkers, silentGaps: gaps }, null, 2), 'utf8');

  const plan = audioMixPlans.at(-1);
  assert(plan && plan.durationMs === durationMs, 'Main did not mix audio against the full Project duration.');
  const audioPlanEvidence = fixture.audioMixFixture.mappedClips.map((expected) => {
    const actual = plan.clips.find((clip) => clip.clipId === expected.clipId);
    assert(actual, `Audio plan omitted ${expected.clipId}.`);
    assert(actual.startMs === expected.globalStartMs && actual.endMs === expected.globalEndMs, `Audio clip ${expected.clipId} is not mapped to its Shot prefix.`);
    assert(actual.sourceOffsetMs === expected.sourceOffsetMs, `Audio clip ${expected.clipId} had its source offset changed.`);
    return { ...expected, actual: { startMs: actual.startMs, endMs: actual.endMs, sourceOffsetMs: actual.sourceOffsetMs, role: actual.role, volume: actual.volume } };
  });
  const planPath = path.join(evidenceDirectory, 'global-audio-plan.json');
  await fsp.writeFile(planPath, JSON.stringify({ durationMs: plan.durationMs, clips: audioPlanEvidence, fullPlan: plan }, null, 2), 'utf8');
  const copiedOutputPath = path.join(evidenceDirectory, 'formal-output.mp4');
  await fsp.copyFile(outputPath, copiedOutputPath);
  const outputBytes = await fsp.readFile(outputPath);
  return {
    outputPath,
    evidenceVideoPath: copiedOutputPath,
    sha256: hash(outputBytes),
    byteLength: outputBytes.length,
    audioPcmPath: pcmPath,
    audioPcmSha256: hash(pcm),
    durationMs,
    frameCount,
    fps,
    durationSeconds,
    codec: video.codec_name,
    pixelFormat: video.pix_fmt,
    width: video.width,
    height: video.height,
    audioStreams: audio.length,
    audioCodec: audio[0].codec_name,
    audioDurationSeconds: Number(audio[0].duration),
    shotPrefixes,
    backgrounds: backgroundEvidence,
    boundaries,
    schedulePath,
    ffprobePath,
    ffprobeJsonPath: ffprobePath,
    boundaryEvidencePath: path.join(evidenceDirectory, 'boundary-and-mouth-evidence.json'),
    audioPlanPath: planPath,
    audioPcmEvidencePath: path.join(evidenceDirectory, 'audio-pcm-markers.json'),
    pcmPath,
    audioMarkers,
    silentGaps: gaps,
    visualFrames,
    mouthComparison,
    bgmOnlyComparison,
    sfxOnlyComparison,
    cameraMode,
  };
}

async function ensureQuickActionDrawerOpen() {
  const expanded = await rendererJs(`document.querySelector('[data-testid="quick-action-drawer"]')?.getAttribute('data-expanded') === 'true'`);
  if (!expanded) await clickSelector('[data-testid="quick-action-drawer-handle"]');
  await waitForRenderer(`document.querySelector('[data-testid="quick-action-drawer"]')?.getAttribute('data-expanded') === 'true'`);
}

async function beginIssue832CreatorExport(label, selectedFileName, retryAction = null) {
  const priorStartCount = formalStarts.length;
  await ensureQuickActionDrawerOpen();
  if (retryAction) {
    await clickButtonContainingText(retryAction);
  } else {
    await clickSelector('[data-testid="quick-action-export"]');
  }
  const saveAsScreenshotPath = path.join(fixture.evidenceRoot, `${label}-save-as.png`);
  await clickNativeSaveDialog(
    'save',
    saveAsScreenshotPath,
    '',
    selectedFileName,
  );
  const deadline = Date.now() + 30_000;
  while (formalStarts.length <= priorStartCount || !formalStarts[priorStartCount]?.jobId) {
    if (Date.now() >= deadline) {
      throw new Error(`${label}: Creator UI did not start a Main Job.`);
    }
    await pause(25);
  }
  const start = formalStarts[priorStartCount];
  await waitForRenderer(
    `window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ${JSON.stringify(start.jobId)}`,
    30_000,
  );
  return { start, saveAsScreenshotPath };
}

async function waitForIssue832Terminal(start, timeoutMs = 1_200_000) {
  await waitForRenderer(
    `(() => {
      const task = window.__pandaStageIssue816Acceptance.inspectExportTask()?.task;
      return task?.jobId === ${JSON.stringify(start.jobId)} &&
        ['completed', 'failed', 'cancelled'].includes(task.status);
    })()`,
    timeoutMs,
  );
  return rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
}

async function captureIssue832Progress(start, label) {
  await waitForRenderer(
    `(() => {
      const task = window.__pandaStageIssue816Acceptance.inspectExportTask()?.task;
      const progress = document.querySelector('[data-testid="export-task-surface"] progress');
      return task?.jobId === ${JSON.stringify(start.jobId)} &&
        task.status === 'running' && progress && Number(progress.value) > 0;
    })()`,
    180_000,
  );
  const state = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  const screenshotPath = path.join(fixture.evidenceRoot, `${label}-progress.png`);
  const image = await mainWindow.webContents.capturePage();
  await fsp.writeFile(screenshotPath, image.toPNG());
  return { state, screenshotPath };
}

async function captureIssue832EncodingState(start, label) {
  await waitForRenderer(
    `window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ${JSON.stringify(start.jobId)} && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.phase === 'encoding'`,
    1_200_000,
  );
  const state = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  const progressVisible = await rendererJs(
    `Boolean(document.querySelector('[data-testid="export-task-surface"] progress'))`,
  );
  assert(!progressVisible, `${label}: frame percentage remained visible during encoding.`);
  const screenshotPath = path.join(fixture.evidenceRoot, `${label}-encoding.png`);
  const image = await mainWindow.webContents.capturePage();
  await fsp.writeFile(screenshotPath, image.toPNG());
  return { state, screenshotPath, progressVisible };
}

async function waitForIssue832ResourceState(expectedSnapshotIds, label) {
  const expected = [...expectedSnapshotIds].sort();
  const deadline = Date.now() + 15_000;
  let actual;
  do {
    const [projectEntries, frameEntries, snapshotEntries] = await Promise.all([
      directoryEntriesOrEmpty(fixture.projectRoot),
      directoryEntriesOrEmpty(frameJobsRoot()),
      directoryEntriesOrEmpty(path.join(fixture.root, 'frozen-media')),
    ]);
    actual = {
      outputTemporaries: projectEntries.filter((entry) => entry.startsWith('.panda-stage-')),
      frameJobDirectories: frameEntries,
      snapshots: snapshotEntries.sort(),
    };
    if (
      actual.outputTemporaries.length === 0 &&
      actual.frameJobDirectories.length === 0 &&
      JSON.stringify(actual.snapshots) === JSON.stringify(expected)
    ) {
      return actual;
    }
    if (Date.now() < deadline) await pause(100);
  } while (Date.now() < deadline);
  assert(actual.outputTemporaries.length === 0, `${label}: formal output staging remains.`);
  assert(actual.frameJobDirectories.length === 0, `${label}: frame-job directories remain.`);
  assert(
    JSON.stringify(actual.snapshots) === JSON.stringify(expected),
    `${label}: retained snapshots differ from the expected bounded set. ${JSON.stringify(actual.snapshots)}`,
  );
  return actual;
}

async function runIssue832Acceptance({ result, editorSnapshotPath, editorSnapshotBytes, initialProjectBytes, projectFilePath, mediaTools, originalContentProject }) {
  const evidenceRoot = fixture.evidenceRoot;
  const project = ProjectSchema.parse(originalContentProject);
  const originalProjectContentSha256 = hash(Buffer.from(JSON.stringify(project), 'utf8'));
  const projectBytesBeforeJob = await fsp.readFile(projectFilePath);
  assert(projectBytesBeforeJob.equals(initialProjectBytes), 'The DL-05 fixture should begin from its unchanged on-disk Project.');
  const initialTargetPath = path.join(fixture.projectRoot, 'issue832-cancelled-first-attempt.mp4');
  const initial = await beginIssue832CreatorExport(
    'initial-cancelled-attempt',
    path.basename(initialTargetPath),
  );
  assert(initial.start.reuseSnapshot === false, 'The first DL-05 export must freeze a new snapshot.');
  assert(initial.start.projectContentSha256 === originalProjectContentSha256, 'The first Main Job did not freeze the editor Project captured before the parallel edit.');
  assert(initial.start.revision === (await rendererJs('window.__pandaStageIssue816Acceptance.inspect()')).revision, 'The initial Main Job captured a different Project revision.');
  const firstTask = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(firstTask.task.durationMs === 30_000, 'The export task UI did not use the complete Project duration.');
  assert(firstTask.latestUpdate?.totalFrames === 720, 'The Main Job did not report the 30-second 24 fps frame denominator.');

  const initialProgress = await captureIssue832Progress(initial.start, 'initial-cancelled-attempt');
  const startCountDuringHide = formalStarts.length;
  await clickSelector('[data-testid="export-task-surface"] [aria-label="隐藏导出任务"]');
  await waitForRenderer(`!document.querySelector('[data-testid="export-task-surface"]')`);
  const hiddenTask = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(hiddenTask.task.jobId === initial.start.jobId && hiddenTask.task.status === 'running', 'Hiding the task surface changed the Main Job.');

  await ensureQuickActionDrawerOpen();
  await clickSelector('[data-testid="quick-action-export"]');
  await waitForRenderer(`Boolean(document.querySelector('[data-testid="export-task-surface"]'))`);
  const firstReopen = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(firstReopen.task.jobId === initial.start.jobId, 'Reopening Export started a second Main Job.');
  assert(formalStarts.length === startCountDuringHide, 'The quick action created another Main Job while one was active.');

  await clickSelector('[data-testid="export-task-surface"] [aria-label="隐藏导出任务"]');
  await waitForRenderer(`!document.querySelector('[data-testid="export-task-surface"]')`);
  const stateBeforeEdit = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const editText = 'DL05 CURRENT CONTENT RETRY • 字幕更新';
  const edit = await rendererJs(
    `window.__pandaStageIssue816Acceptance.editSubtitleAndAddAudioFixture(${JSON.stringify(editText)})`,
  );
  assert(edit.revision === stateBeforeEdit.revision + 1, 'The concurrent subtitle/audio edit did not create one formal Project revision.');
  assert(edit.undoCount === stateBeforeEdit.undoCount + 1, 'The concurrent edit did not create one History entry.');
  assert(edit.dirty === true, 'The concurrent edit did not mark the Project dirty before Save.');
  const currentProject = ProjectSchema.parse(edit.project);
  const currentProjectContentSha256 = hash(Buffer.from(JSON.stringify(currentProject), 'utf8'));

  await ensureQuickActionDrawerOpen();
  await waitForRenderer(`document.querySelector('[data-testid="quick-action-save"]') && !document.querySelector('[data-testid="quick-action-save"]').disabled`);
  await clickSelector('[data-testid="quick-action-save"]');
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspect()?.dirty === false', 30_000);
  const savedState = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const savedProjectBytes = await fsp.readFile(projectFilePath);
  const savedProject = ProjectSchema.parse(JSON.parse(savedProjectBytes.toString('utf8')));
  assert(savedState.revision === edit.revision && savedState.undoCount === edit.undoCount, 'Saving during export changed the Project revision or History.');
  assert(JSON.stringify(savedProject) === JSON.stringify(currentProject), 'Creator Save did not persist the concurrent edit.');
  const taskAfterSave = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(taskAfterSave.task.jobId === initial.start.jobId && taskAfterSave.task.status === 'running', 'Project Save was blocked by, or completed, the active export Job.');

  await clickSelector('[data-testid="quick-action-play"]');
  await waitForRenderer(`Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`);
  await waitForRenderer(`(() => { const button = document.querySelector('[data-testid="product-preview-play-pause"]'); return button && !button.disabled; })()`, 60_000);
  const previewInitiallyPlaying = await rendererJs(
    `document.querySelector('[data-testid="product-preview-play-pause"]')?.getAttribute('aria-pressed') === 'true'`,
  );
  const previewScreenshot = await mainWindow.webContents.capturePage();
  const previewScreenshotPath = path.join(evidenceRoot, 'preview-during-export.png');
  await fsp.writeFile(previewScreenshotPath, previewScreenshot.toPNG());
  if (!previewInitiallyPlaying) {
    await clickSelector('[data-testid="product-preview-play-pause"]');
    await waitForRenderer(`document.querySelector('[data-testid="product-preview-play-pause"]')?.getAttribute('aria-pressed') === 'true'`, 10_000);
  }
  await clickSelector('[data-testid="product-preview-play-pause"]');
  await waitForRenderer(`document.querySelector('[data-testid="product-preview-play-pause"]')?.getAttribute('aria-pressed') === 'false'`, 10_000);
  await pause(250);
  await clickSelector('[data-testid="product-preview-play-pause"]');
  await waitForRenderer(`document.querySelector('[data-testid="product-preview-play-pause"]')?.getAttribute('aria-pressed') === 'true'`, 10_000);
  await clickSelector('[data-testid="product-preview-close"]');
  await waitForRenderer(`!document.querySelector('[data-testid="product-preview-overlay"]')`);
  const taskAfterPreview = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(taskAfterPreview.task.jobId === initial.start.jobId && taskAfterPreview.task.status === 'running', 'Product Preview was blocked by, or completed, the active export Job.');

  await ensureQuickActionDrawerOpen();
  await clickSelector('[data-testid="quick-action-export"]');
  await waitForRenderer(`Boolean(document.querySelector('[data-testid="export-task-surface"]'))`);
  const reopened = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(reopened.task.jobId === initial.start.jobId && reopened.task.status === 'running', 'The reopened task did not show the same running Main Job.');
  assert(reopened.latestUpdate?.jobId === initial.start.jobId, 'The reopened panel did not use the latest event for its current Job.');
  assert(reopened.task.completedFrames === reopened.latestUpdate.completedFrames && reopened.task.phase === reopened.latestUpdate.phase, 'The reopened task state is stale relative to the latest Main update.');
  assert(formalStarts.length === 1, 'Hide, edit, Save, Preview, or reopen started another export.');
  assert(reopened.task.durationMs === 30_000 && reopened.task.totalFrames === 720, 'The reopened task lost full-Project duration or frame denominator.');
  const reopenScreenshot = await mainWindow.webContents.capturePage();
  const reopenScreenshotPath = path.join(evidenceRoot, 'task-reopened-after-edit.png');
  await fsp.writeFile(reopenScreenshotPath, reopenScreenshot.toPNG());
  const duplicateStartCount = formalStarts.length - startCountDuringHide;

  assert(reopened.task.phase !== 'committing', 'The deterministic cancellation sample reached the non-cancellable commit phase too early.');
  await clickButtonContainingText('取消导出');
  const cancelled = await waitForIssue832Terminal(initial.start);
  assert(cancelled.task.status === 'cancelled', 'Creator UI cancellation did not reach the cancelled terminal state.');
  assert(exportService.getJob(initial.start.jobId)?.status === 'cancelled', 'Main did not record cancellation as the final Job status.');
  const cancelledTargetAbsent = !existsSync(initialTargetPath);
  assert(cancelledTargetAbsent, 'Cancelled export published a final output.');
  const cancellationScreenshot = await mainWindow.webContents.capturePage();
  const cancellationScreenshotPath = path.join(evidenceRoot, 'initial-cancelled-attempt-cancelled.png');
  await fsp.writeFile(cancellationScreenshotPath, cancellationScreenshot.toPNG());
  const retainedAfterCancellation = await waitForIssue832ResourceState(
    [initial.start.snapshotId],
    'cancelled original-content candidate',
  );

  const sentinelBytes = Buffer.from('DL-05 third-party target protected during old-content retry selection.');
  await fsp.writeFile(initialTargetPath, sentinelBytes, { flag: 'wx' });
  const oldOutputPath = path.join(fixture.projectRoot, 'issue832-original-content-retry.mp4');
  const oldRetry = await beginIssue832CreatorExport(
    'retry-original-content',
    path.basename(oldOutputPath),
    '选择位置，重试原内容',
  );
  assert(oldRetry.start.reuseSnapshot === true, 'The original-content retry did not request reuse of its frozen candidate.');
  assert(oldRetry.start.jobId !== initial.start.jobId, 'The original-content retry reused the cancelled Main jobId.');
  assert(oldRetry.start.snapshotId === initial.start.snapshotId, 'The original-content retry did not reuse the original snapshotId.');
  assert(oldRetry.start.attemptId === initial.start.attemptId, 'The original-content retry changed the frozen attempt identity.');
  assert(oldRetry.start.frozenPayloadSha256 === initial.start.frozenPayloadSha256, 'The original-content retry changed its frozen Project/media identity.');
  assert(JSON.stringify(oldRetry.start.mediaManifest) === JSON.stringify(initial.start.mediaManifest), 'The original-content retry changed its frozen media hashes.');
  const oldProgress = await captureIssue832Progress(oldRetry.start, 'retry-original-content');
  const oldEncoding = await captureIssue832EncodingState(oldRetry.start, 'retry-original-content');
  const oldTerminal = await waitForIssue832Terminal(oldRetry.start);
  assert(oldTerminal.task.status === 'completed', 'The original frozen-content retry did not complete.');
  assert(exportService.getJob(oldRetry.start.jobId)?.status === 'completed', 'Main did not record the old-content retry as complete.');
  assert(existsSync(oldOutputPath), 'The original-content retry did not publish its selected output.');
  assert(hash(await fsp.readFile(initialTargetPath)) === hash(sentinelBytes), 'The retry modified a pre-existing third-party file.');
  const oldExportEvidence = await issue827ExportEvidence(
    oldOutputPath,
    path.join(evidenceRoot, 'original-content-output'),
    project,
    oldRetry.start.cameraMode,
    mediaTools,
    fixture.backgroundEvidence,
  );
  const oldFrameIndex = 48;
  const subtitleEvidenceDirectory = path.join(evidenceRoot, 'subtitle-content-diff');
  await fsp.mkdir(subtitleEvidenceDirectory, { recursive: true });
  const oldSubtitleFrame = await extractFormalFrame(
    oldOutputPath,
    subtitleEvidenceDirectory,
    mediaTools,
    oldFrameIndex,
    'original-content-frame-048',
  );
  const retainedAfterOldSuccess = await waitForIssue832ResourceState([], 'completed original-content retry');
  assert(JSON.stringify(savedProject) === JSON.stringify(ProjectSchema.parse(JSON.parse((await fsp.readFile(projectFilePath)).toString('utf8')))), 'The old-content retry changed the newly saved Project.');

  failNextOutputValidation = true;
  const currentSeedPath = path.join(fixture.projectRoot, 'issue832-current-content-seed-failure.mp4');
  const currentSeed = await beginIssue832CreatorExport(
    'current-content-seed-failure',
    path.basename(currentSeedPath),
  );
  const currentSeedTerminal = await waitForIssue832Terminal(currentSeed.start, 60_000);
  assert(currentSeedTerminal.task.status === 'failed', 'The controlled current-content seed did not fail.');
  assert(exportService.getJob(currentSeed.start.jobId)?.status === 'failed', 'Main did not record the controlled current-content seed failure.');
  const currentSeedJob = exportService.getJob(currentSeed.start.jobId);
  assert(currentSeedJob?.originalError?.includes('Controlled DL-05 output identity validation failure.'), 'The controlled failure did not retain its original Main error.');
  assert(currentSeedJob.cleanupError === null, 'The controlled failure unexpectedly reported a cleanup error.');
  assert(!existsSync(currentSeedPath), 'The controlled current-content seed published an output.');
  assert(currentSeed.start.snapshotId !== initial.start.snapshotId, 'The current-content seed reused the old snapshot.');
  assert(currentSeed.start.projectContentSha256 === currentProjectContentSha256, 'The current-content seed did not freeze the saved Project.');
  const retainedAfterCurrentFailure = await waitForIssue832ResourceState(
    [currentSeed.start.snapshotId],
    'failed current-content candidate',
  );

  const currentOutputPath = path.join(fixture.projectRoot, 'issue832-current-content-retry.mp4');
  const currentRetry = await beginIssue832CreatorExport(
    'retry-current-content',
    path.basename(currentOutputPath),
    '按当前内容重新导出',
  );
  assert(currentRetry.start.reuseSnapshot === false, 'The current-content retry reused a previous snapshot.');
  assert(currentRetry.start.jobId !== currentSeed.start.jobId, 'The current-content retry reused the failed Main jobId.');
  assert(currentRetry.start.snapshotId !== currentSeed.start.snapshotId && currentRetry.start.snapshotId !== initial.start.snapshotId, 'The current-content retry did not create a fresh snapshotId.');
  assert(currentRetry.start.attemptId !== currentSeed.start.attemptId && currentRetry.start.attemptId !== initial.start.attemptId, 'The current-content retry did not create a fresh attemptId.');
  assert(currentRetry.start.projectContentSha256 === currentProjectContentSha256, 'The current-content retry did not use the saved, edited Project.');
  assert(currentRetry.start.frozenPayloadSha256 !== initial.start.frozenPayloadSha256, 'The current-content retry did not create a different frozen content identity.');
  assert(currentRetry.start.mediaManifest.some((entry) => entry.assetId === edit.addedAudioAssetId && entry.sha256 === edit.addedAudioAssetSha256), 'The current-content retry did not freeze the newly referenced audio asset and hash.');
  assert(!initial.start.mediaManifest.some((entry) => entry.assetId === edit.addedAudioAssetId), 'The original snapshot unexpectedly included the later-added audio source.');
  const currentProgress = await captureIssue832Progress(currentRetry.start, 'retry-current-content');
  const currentEncoding = await captureIssue832EncodingState(currentRetry.start, 'retry-current-content');
  const currentTerminal = await waitForIssue832Terminal(currentRetry.start);
  assert(currentTerminal.task.status === 'completed', 'The current-content retry did not complete.');
  assert(exportService.getJob(currentRetry.start.jobId)?.status === 'completed', 'Main did not record the current-content retry as complete.');
  assert(existsSync(currentOutputPath), 'The current-content retry did not publish its selected output.');
  const currentExportEvidence = await issue827ExportEvidence(
    currentOutputPath,
    path.join(evidenceRoot, 'current-content-output'),
    currentProject,
    currentRetry.start.cameraMode,
    mediaTools,
    fixture.backgroundEvidence,
  );
  const currentSubtitleFrame = await extractFormalFrame(
    currentOutputPath,
    subtitleEvidenceDirectory,
    mediaTools,
    oldFrameIndex,
    'current-content-frame-048',
  );
  const subtitleFrameDifference = compareRawFrames(
    oldSubtitleFrame.rawBytes,
    currentSubtitleFrame.rawBytes,
  );
  assert(subtitleFrameDifference.changedPixels > 100, 'The old and current retry outputs did not visibly differ at the edited subtitle time.');
  assert(oldExportEvidence.sha256 !== currentExportEvidence.sha256, 'The old and current content MP4 files are byte-identical.');
  const oldPcm = await fsp.readFile(oldExportEvidence.audioPcmPath);
  const currentPcm = await fsp.readFile(currentExportEvidence.audioPcmPath);
  const oldSfxTwoTone = goertzelAmplitude(oldPcm, 7_500, 300, 1_320);
  const currentSfxTwoTone = goertzelAmplitude(currentPcm, 7_500, 300, 1_320);
  assert(currentSfxTwoTone > 0.02 && currentSfxTwoTone > oldSfxTwoTone + 0.015, 'The current-content AAC track does not contain the newly frozen SFX tone.');
  assert(hash(await fsp.readFile(initialTargetPath)) === hash(sentinelBytes), 'The current-content retry changed the protected third-party target.');
  const finalSavedState = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  assert(finalSavedState.revision === savedState.revision && finalSavedState.dirty === false && finalSavedState.undoCount === savedState.undoCount, 'An export retry changed the saved Project revision, dirty state, or History.');
  assert((await fsp.readFile(projectFilePath)).equals(savedProjectBytes), 'An export retry wrote to project.json.');
  const finalSnapshotsBeforeCleanup = await waitForIssue832ResourceState(
    [currentSeed.start.snapshotId],
    'completed current-content retry and unselected failed candidate',
  );
  const discardedUnselectedCandidate = await exportPreparationService.discard(undefined, currentSeed.start.snapshotId);
  assert(discardedUnselectedCandidate, 'The bounded failed candidate could not be explicitly discarded after the current-content choice.');
  const finalResources = await waitForIssue832ResourceState([], 'DL-05 completed retry lifecycle');

  const projectContentEvidence = {
    originalSnapshot: {
      attemptId: initial.start.attemptId,
      snapshotId: initial.start.snapshotId,
      contentSha256: initial.start.frozenPayloadSha256,
      projectSha256: initial.start.projectContentSha256,
      mediaManifest: initial.start.mediaManifest,
    },
    editedSnapshot: {
      attemptId: currentRetry.start.attemptId,
      snapshotId: currentRetry.start.snapshotId,
      contentSha256: currentRetry.start.frozenPayloadSha256,
      projectSha256: currentRetry.start.projectContentSha256,
      mediaManifest: currentRetry.start.mediaManifest,
    },
    editedProjectText: edit.text,
    addedAudioAssetId: edit.addedAudioAssetId,
    addedAudioAssetSha256: edit.addedAudioAssetSha256,
    subtitleFrameDifference,
    audioToneAt7_5Seconds: { frequencyHz: 1_320, oldSnapshotAmplitude: oldSfxTwoTone, currentSnapshotAmplitude: currentSfxTwoTone },
  };
  const jobIds = [initial.start.jobId, oldRetry.start.jobId, currentSeed.start.jobId, currentRetry.start.jobId];
  assert(new Set(jobIds).size === jobIds.length, 'A new export attempt reused a previous jobId.');
  result.fixture = {
    projectId: project.id,
    projectRoot: fixture.projectRoot,
    projectDurationMs: 30_000,
    shotCount: 3,
    audioClipCounts: project.shots.map((shot) => shot.audioClips.length),
    originalEditorSnapshotPath: editorSnapshotPath,
    originalEditorSnapshotSha256: hash(editorSnapshotBytes),
    originalProjectContentSha256,
    editedProjectContentSha256: currentProjectContentSha256,
    savedProjectSha256: hash(savedProjectBytes),
    sourceAssetHashes: await Promise.all(fixtureProject.assets.filter((asset) => asset.kind === 'audio').map(async (asset) => ({
      assetId: asset.id,
      expectedSha256: asset.sha256,
      initialBytesSha256: hash(assetBytesById.get(asset.id)),
      finalBytesSha256: hash(await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath))),
      unchanged: hash(await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath))) === asset.sha256,
    }))),
  };
  result.lifecycle = {
    jobs: [
      { start: initial.start, terminal: exportService.getJob(initial.start.jobId), progressScreenshotPath: initialProgress.screenshotPath, progressSnapshot: initialProgress.state, cancelledStatus: cancelled.task.status },
      { start: oldRetry.start, terminal: exportService.getJob(oldRetry.start.jobId), progressScreenshotPath: oldProgress.screenshotPath, encoding: oldEncoding, completedStatus: oldTerminal.task.status },
      { start: currentSeed.start, terminal: currentSeedJob, failedStatus: currentSeedTerminal.task.status },
      { start: currentRetry.start, terminal: exportService.getJob(currentRetry.start.jobId), progressScreenshotPath: currentProgress.screenshotPath, encoding: currentEncoding, completedStatus: currentTerminal.task.status },
    ],
    hideReopen: {
      sameJobId: reopened.task.jobId === initial.start.jobId,
      latestCompletedFrames: reopened.latestUpdate.completedFrames,
      phase: reopened.latestUpdate.phase,
      duplicateStartCount,
      hideScreenshot: path.join(evidenceRoot, 'task-reopened-after-edit.png'),
    },
    parallelEditing: {
      changedRevision: edit.revision,
      savedRevision: savedState.revision,
      savedDirty: savedState.dirty,
      undoCount: savedState.undoCount,
      editedText: edit.text,
      saveDuringJob: true,
      previewScreenshotPath,
      previewPlaybackCompleted: true,
    },
    cancellation: {
      targetPath: initialTargetPath,
      targetAbsent: cancelledTargetAbsent,
      mainStatus: exportService.getJob(initial.start.jobId)?.status,
      retainedSnapshot: initial.start.snapshotId,
      retainedSnapshotCount: retainedAfterCancellation.snapshots.length,
      cancellationScreenshotPath,
    },
    oldContentRetry: {
      outputPath: oldOutputPath,
      output: oldExportEvidence,
      sentinelTargetPath: initialTargetPath,
      sentinelSha256: hash(sentinelBytes),
      sentinelUnchanged: hash(await fsp.readFile(initialTargetPath)) === hash(sentinelBytes),
      retainedCandidateCleanup: retainedAfterOldSuccess,
    },
    currentContentRetry: {
      outputPath: currentOutputPath,
      output: currentExportEvidence,
      failedSeed: currentSeed.start,
      retainedFailedSeedSnapshot: retainedAfterCurrentFailure,
      explicitlyDiscardedUnselectedSnapshot: discardedUnselectedCandidate,
      boundedCandidateBeforeDiscard: finalSnapshotsBeforeCleanup,
    },
    contentIdentity: projectContentEvidence,
    resourceCleanup: finalResources,
  };
  result.outputs = {
    originalContent: { ...oldExportEvidence, outputSha256: oldExportEvidence.sha256 },
    currentContent: { ...currentExportEvidence, outputSha256: currentExportEvidence.sha256 },
  };
  result.source = {
    ...result.source,
    outputFiles: [
      { path: oldOutputPath, sha256: oldExportEvidence.sha256, bytes: oldExportEvidence.byteLength },
      { path: currentOutputPath, sha256: currentExportEvidence.sha256, bytes: currentExportEvidence.byteLength },
    ],
    protectedSentinel: { path: initialTargetPath, sha256: hash(sentinelBytes) },
  };
  result.exportJobs = jobUpdates.map((update) => ({
    jobId: update.jobId,
    attemptId: update.attemptId ?? null,
    snapshotId: update.snapshotId ?? null,
    status: update.status,
    phase: update.phase,
    completedFrames: update.completedFrames,
    totalFrames: update.totalFrames,
    originalError: update.originalError ?? null,
    cleanupError: update.cleanupError ?? null,
  }));
  result.auto = 'PASS';
  result.completedAt = new Date().toISOString();
  result.owner = {
    status: 'FOLLOWUP_REVIEW_READY',
    ownerManual: 'DEFERRED_TO_DL07',
    techReview: 'PENDING',
    multiShotAvAccepted: false,
  };
  await fsp.writeFile(path.join(evidenceRoot, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  await fsp.writeFile(path.join(fixture.root, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`PASS #832 DL-05 task lifecycle acceptance: ${fixture.root}`);
  mainWindow.destroy();
  hiddenWindowManager.close();
  app.exit(0);
}

async function waitForGate(gate, label, timeoutMs = 60_000) {
  let timer;
  try {
    await Promise.race([
      gate.started,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ': timed out waiting for the controlled gate.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForWindowClosed(window, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (window.isDestroyed()) return;
    await pause(50);
  }
  throw new Error(label + ': BrowserWindow remained open after its pending work settled.');
}

async function restoreIssue834TerminalTask(start, expectedStatus, label) {
  const priorStarts = formalStarts.length;
  const priorSaveDialogs = saveDialogEvidence.length;
  await ensureQuickActionDrawerOpen();
  await clickSelector('[data-testid="quick-action-export"]');
  await clickSelector('[data-testid="quick-action-export"]');
  await waitForRenderer('Boolean(document.querySelector("[data-testid=\\"export-task-surface\\"]"))');
  const state = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(state.task.jobId === start.jobId, label + ': toolbar Export did not restore the original Job.');
  assert(state.task.attemptId === start.attemptId && state.task.snapshotId === start.snapshotId, label + ': restored task identity does not match its original attempt and snapshot.');
  assert(state.task.status === expectedStatus, label + ': restored task status was ' + state.task.status + '.');
  assert(state.latestUpdate?.jobId === start.jobId && state.latestUpdate?.status === expectedStatus, label + ': a stale or unrelated Main update replaced the terminal Job identity.');
  assert(formalStarts.length === priorStarts, label + ': restoring the terminal task started another Main Job.');
  assert(saveDialogEvidence.length === priorSaveDialogs, label + ': restoring the terminal task opened another Save As dialog.');
  return state;
}

async function createIssue834WindowAndOpenProject() {
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  installIssue834CloseGuard(mainWindow);
  mainWindow.setContentSize(1024, 768);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  await waitForRenderer('document.querySelector("[data-task4-core=\\"recent-open\\"]")');
  await clickSelector('[data-task4-core="recent-open"]');
  await waitForRenderer('window.__pandaStageIssue816Acceptance && (await window.__pandaStageIssue816Acceptance.inspect())?.project?.id === ' + JSON.stringify(fixtureProject.id));
  return rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
}

async function runIssue836R0CleanupRecovery({ originalOutputPath, originalOutputSha256, projectFilePath }) {
  const service = exportPreparationService;
  const fileStore = service?.fileStore;
  assert(service && fileStore?.getOwnedPath, 'DL-06 R0 requires the existing Main cleanup owner and owned-path API.');

  const originalDelete = fileStore.delete.bind(fileStore);
  const originalNow = service.now;
  const originalConsoleError = console.error;
  const lockedSnapshotIds = new Set();
  const deleteAttempts = new Map();
  const machineErrors = [];
  fileStore.delete = async (snapshotId) => {
    deleteAttempts.set(snapshotId, (deleteAttempts.get(snapshotId) ?? 0) + 1);
    if (lockedSnapshotIds.has(snapshotId)) {
      throw new Error('controlled Issue #836 Windows file lock');
    }
    await originalDelete(snapshotId);
  };
  console.error = (...args) => machineErrors.push(args.map(String).join(' '));

  const createCandidate = async (fileName) => {
    const current = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const selection = await service.selectOutput({
      projectRoot: current.projectRoot,
      projectId: current.project.id,
      projectName: current.project.name,
      openInstanceId: current.openInstanceId,
    }, path.join(fixture.projectRoot, fileName));
    assert(selection.status === 'selected', `DL-06 R0 could not select ${fileName}: ${JSON.stringify(selection)}`);
    const prepared = await service.prepare({
      selectionId: selection.selectionId,
      attemptId: randomUUID(),
      projectRoot: current.projectRoot,
      projectId: current.project.id,
      openInstanceId: current.openInstanceId,
      revision: current.revision,
      dirty: current.dirty,
      cameraMode: 'static',
      project: current.project,
    });
    assert(prepared.status === 'PREPARATION_READY', `DL-06 R0 could not create ${fileName}: ${JSON.stringify(prepared)}`);
    return prepared.candidate;
  };

  const expectUnavailable = async (snapshotId, label) => {
    let failure = null;
    try {
      await service.acquireCandidateForExport(snapshotId);
    } catch (error) {
      failure = error;
    }
    assert(String(failure?.message ?? failure).includes('EXPORT_SNAPSHOT_UNAVAILABLE'), `${label}: expired snapshot became available again.`);
  };

  try {
    const projectBytesBefore = await fsp.readFile(projectFilePath);
    const projectSha256Before = hash(projectBytesBefore);
    const first = await createCandidate('issue836-r0-expired-first.mp4');
    const second = await createCandidate('issue836-r0-expired-second.mp4');
    const expired = [first, second];
    const expiredSnapshotIds = expired.map((candidate) => candidate.snapshotId);
    const expiredOwnedPaths = Object.fromEntries(expired.map((candidate) => [
      candidate.snapshotId,
      fileStore.getOwnedPath(candidate.snapshotId),
    ]));
    assert(expired.every((candidate) => expiredOwnedPaths[candidate.snapshotId]), 'DL-06 R0 did not retain both exact owned paths.');
    expiredSnapshotIds.forEach((snapshotId) => lockedSnapshotIds.add(snapshotId));

    service.now = () => new Date(originalNow().getTime() + 31 * 60 * 1_000);
    await expectUnavailable(expiredSnapshotIds[0], 'first expiry');
    const cleanupDeadline = Date.now() + 15_000;
    while (
      expiredSnapshotIds.some((snapshotId) => deleteAttempts.get(snapshotId) < 4) &&
      Date.now() < cleanupDeadline
    ) {
      await pause(25);
    }
    assert(expiredSnapshotIds.every((snapshotId) => deleteAttempts.get(snapshotId) === 4), 'Both R0 expired snapshots did not exhaust exactly four bounded cleanup attempts.');
    const automaticDeleteAttempts = Object.fromEntries(
      expiredSnapshotIds.map((snapshotId) => [snapshotId, deleteAttempts.get(snapshotId)]),
    );
    const ownedEntriesAfterExhaustion = await fsp.readdir(path.join(fixture.root, 'frozen-media'));
    assert(expiredSnapshotIds.every((snapshotId) => ownedEntriesAfterExhaustion.includes(snapshotId)), 'A locked expired snapshot disappeared before recovery.');
    for (const snapshotId of expiredSnapshotIds) {
      assert(fileStore.getOwnedPath(snapshotId) === expiredOwnedPaths[snapshotId], `Owned path changed for ${snapshotId}.`);
      await expectUnavailable(snapshotId, 'post-exhaustion check');
    }

    const startsBeforeBlockedAction = formalStarts.length;
    const blockedSaveAsScreenshotPath = path.join(fixture.evidenceRoot, 'issue836-r0-still-locked-save-as.png');
    await clickButtonContainingText('按当前内容重新导出');
    await clickNativeSaveDialog('save', blockedSaveAsScreenshotPath, '', 'issue836-r0-still-locked.mp4');
    await waitForRenderer(`(() => {
      const task = window.__pandaStageIssue816Acceptance.inspectExportTask()?.task;
      return task?.status === 'failed' && task.issues?.some((issue) => issue.code === 'PREPARATION_BUSY');
    })()`, 30_000);
    const blockedTask = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
    const busyIssue = blockedTask.task.issues.find((issue) => issue.code === 'PREPARATION_BUSY');
    assert(busyIssue?.problem === '旧导出临时文件还未清理，当前导出已安全停止。', 'Locked cleanup did not show the concise safe-stop message.');
    assert(busyIssue?.nextStep.includes('解除文件占用后重试导出'), 'Locked cleanup did not explain the explicit recovery action.');
    const visibleIssueText = JSON.stringify(blockedTask.task.issues);
    assert(!expiredSnapshotIds.some((snapshotId) => visibleIssueText.includes(snapshotId)), 'Internal snapshot IDs leaked into the Creator surface.');
    assert(!Object.values(expiredOwnedPaths).some((ownedPath) => visibleIssueText.includes(ownedPath)), 'Internal owned paths leaked into the Creator surface.');
    assert(!visibleIssueText.includes('controlled Issue #836 Windows file lock'), 'Internal filesystem errors leaked into the Creator surface.');
    const noJobCreatedWhileLocked = formalStarts.length === startsBeforeBlockedAction;
    assert(noJobCreatedWhileLocked, 'The locked recovery action created an Export Job.');
    assert((await fsp.readdir(path.join(fixture.root, 'frozen-media'))).length === 2, 'A blocked retry exceeded the two-snapshot ownership cap.');
    await fsp.writeFile(path.join(fixture.evidenceRoot, 'issue836-r0-still-locked.png'), (await mainWindow.webContents.capturePage()).toPNG());

    const exhaustedLogs = machineErrors.filter((line) => line.includes('attempt 4/4'));
    const explicitRecoveryLogs = machineErrors.filter((line) => line.includes('explicit recovery 1'));
    for (const snapshotId of expiredSnapshotIds) {
      assert(exhaustedLogs.some((line) => line.includes(snapshotId) && line.includes(expiredOwnedPaths[snapshotId]) && line.includes('Takeover action')), `Main log omitted exhausted cleanup ownership for ${snapshotId}.`);
      assert(explicitRecoveryLogs.some((line) => line.includes(snapshotId) && line.includes(expiredOwnedPaths[snapshotId])), `Main log omitted explicit recovery failure for ${snapshotId}.`);
    }

    service.now = originalNow;
    expiredSnapshotIds.forEach((snapshotId) => lockedSnapshotIds.delete(snapshotId));
    const recoveredGate = controlledGate();
    pauseNextIssue834Encode = recoveredGate;
    const recoveredOutputPath = path.join(fixture.projectRoot, 'issue836-r0-recovered.mp4');
    const recoveredRun = await beginIssue832CreatorExport(
      'issue836-r0-recovered',
      path.basename(recoveredOutputPath),
      '按当前内容重新导出',
    );
    assert(exportPreparationService === service, 'DL-06 R0 replaced the single Main cleanup owner.');
    assert(!expiredSnapshotIds.includes(recoveredRun.start.snapshotId), 'An expired snapshot was revived for the new Job.');
    assert(expiredSnapshotIds.every((snapshotId) => fileStore.getOwnedPath(snapshotId) === null), 'Explicit recovery did not remove both original owned paths.');
    await waitForGate(recoveredGate, 'DL-06 R0 same-session recovered Job encoding');
    await waitForRenderer('window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ' + JSON.stringify(recoveredRun.start.jobId) + ' && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.phase === "encoding"');
    assert(exportService.getJob(recoveredRun.start.jobId)?.status === 'running', 'The recovered candidate did not start a new Main Export Job.');

    recoveredGate.release();
    const recoveredTerminal = await waitForIssue832Terminal(recoveredRun.start, 120_000);
    assert(recoveredTerminal.task.status === 'completed', 'The post-recovery Export Job did not complete.');
    assert(exportService.getJob(recoveredRun.start.jobId)?.status === 'completed' && existsSync(recoveredOutputPath), 'The same-session recovered Job did not publish its selected output.');
    const recoveredOutputSha256 = hash(await fsp.readFile(recoveredOutputPath));
    const candidateCleanupDeadline = Date.now() + 5_000;
    while (fileStore.getOwnedPath(recoveredRun.start.snapshotId) !== null && Date.now() < candidateCleanupDeadline) await pause(25);
    assert(fileStore.getOwnedPath(recoveredRun.start.snapshotId) === null, 'The recovered Job candidate was not cleaned after completion.');
    assert((await fsp.readFile(projectFilePath)).equals(projectBytesBefore), 'R0 cleanup recovery changed the saved Project.');
    assert(hash(await fsp.readFile(originalOutputPath)) === originalOutputSha256, 'R0 cleanup recovery changed the prior completed MP4.');

    return {
      status: 'PASS',
      exhaustedSnapshots: expired.map((candidate) => ({
        snapshotId: candidate.snapshotId,
        ownedPath: expiredOwnedPaths[candidate.snapshotId],
        automaticDeleteAttempts: automaticDeleteAttempts[candidate.snapshotId],
        explicitRecoveryDeleteAttempts: deleteAttempts.get(candidate.snapshotId) - automaticDeleteAttempts[candidate.snapshotId],
        totalDeleteAttempts: deleteAttempts.get(candidate.snapshotId),
        directoryRetainedWhileLocked: ownedEntriesAfterExhaustion.includes(candidate.snapshotId),
        unavailableAfterExpiry: true,
        removedAfterExplicitRecovery: fileStore.getOwnedPath(candidate.snapshotId) === null,
      })),
      blockedRetry: {
        status: blockedTask.task.status,
        issue: busyIssue,
        noJobCreated: noJobCreatedWhileLocked,
        snapshotsStillOwned: true,
        diagnosticLogs: explicitRecoveryLogs,
      },
      recoveredJob: {
        jobId: recoveredRun.start.jobId,
        attemptId: recoveredRun.start.attemptId,
        snapshotId: recoveredRun.start.snapshotId,
        status: recoveredTerminal.task.status,
        outputPath: recoveredOutputPath,
        outputSha256: recoveredOutputSha256,
        sameServiceInstance: exportPreparationService === service,
      },
      projectSha256Before: projectSha256Before,
      projectSha256After: hash(await fsp.readFile(projectFilePath)),
      priorOutputSha256: originalOutputSha256,
      priorOutputSha256After: hash(await fsp.readFile(originalOutputPath)),
      userSurfaceScreenshotPath: path.join(fixture.evidenceRoot, 'issue836-r0-still-locked.png'),
    };
  } finally {
    fileStore.delete = originalDelete;
    service.now = originalNow;
    console.error = originalConsoleError;
  }
}

async function runIssue834FollowupAcceptance({ result, opened, initialProjectBytes, projectFilePath }) {
  issue834Stage = 'initial-export';
  const evidenceRoot = fixture.evidenceRoot;
  const project = ProjectSchema.parse(opened.project);
  const originalProjectContentSha256 = hash(Buffer.from(JSON.stringify(project), 'utf8'));
  assert((await fsp.readFile(projectFilePath)).equals(initialProjectBytes), 'Issue #834 fixture must start from its exact shortened on-disk Project.');

  const originalOutputPath = path.join(fixture.projectRoot, 'issue834-hidden-completed.mp4');
  const originalGate = controlledGate();
  pauseNextIssue834Encode = originalGate;
  const original = await beginIssue832CreatorExport('issue834-hidden-completed', path.basename(originalOutputPath));
  assert(original.start.projectContentSha256 === originalProjectContentSha256, 'The first Job did not freeze the original fixture Project.');
  assert(original.start.revision === opened.revision, 'The first Job captured a different Project revision.');
  await waitForGate(originalGate, 'original export encoding');
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ' + JSON.stringify(original.start.jobId) + ' && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.phase === "encoding"');

  issue834Stage = 'visible-subtitle-edit';
  await clickSelector('[data-testid="export-task-surface"] .export-task-hide');
  await waitForRenderer('!document.querySelector("[data-testid=\\"export-task-surface\\"]")');
  await clickSelector('[data-testid="right-activity-rail-subtitles"]');
  await clickSelector('[data-testid="dialogue-clip"]');
  await waitForRenderer('document.querySelector("[data-testid=\\"dialogue-clip\\"]")?.dataset.selected === "true"');
  await clickSelector('[data-testid="right-activity-rail-properties"]');
  await waitForRenderer('Boolean(document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]"))');
  const originalSubtitle = project.shots[0].dialogues[0]?.text;
  const nextSubtitle = 'Issue 834 subtitle changed through the visible editor';
  const inputBefore = await rendererJs('document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]")?.value ?? null');
  assert(inputBefore === originalSubtitle, 'The visible subtitle input did not show the expected fixture dialogue.');
  await rendererJs('(() => { const input = document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]"); if (!input) throw new Error("Visible subtitle editor is missing."); input.focus(); input.select(); return true; })()');
  mainWindow.webContents.insertText(nextSubtitle);
  await waitForRenderer('document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]")?.value === ' + JSON.stringify(nextSubtitle));
  mainWindow.setContentSize(1024, 768);
  await pause(200);
  const subtitleControl = await rendererJs('(() => { const input = document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]"); if (!input) return null; const rect = input.getBoundingClientRect(); const style = getComputedStyle(input); return { value: input.value, width: rect.width, height: rect.height, display: style.display, visibility: style.visibility }; })()');
  assert(subtitleControl?.value === nextSubtitle && subtitleControl.width > 0 && subtitleControl.height > 0 && subtitleControl.display !== 'none' && subtitleControl.visibility !== 'hidden', 'The changed subtitle input was not visible in the Windows renderer.');
  const subtitleScreenshotPath = path.join(evidenceRoot, 'subtitle-editor-during-export-narrow.png');
  const subtitleImage = await mainWindow.webContents.capturePage();
  const subtitleImageSize = subtitleImage.getSize();
  await fsp.writeFile(subtitleScreenshotPath, subtitleImage.toPNG());
  await rendererJs('document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]")?.blur()');
  const editedExpression = '(() => { const state = window.__pandaStageIssue816Acceptance.inspect(); return state?.revision === ' + String(opened.revision + 1) + ' && state.project.shots[0].dialogues[0].text === ' + JSON.stringify(nextSubtitle) + '; })()';
  await waitForRenderer(editedExpression);
  const edited = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  assert(edited.dirty && edited.undoCount === opened.undoCount + 1, 'The real subtitle input edit did not create exactly one dirty Project revision and History entry.');
  const editedProjectContentSha256 = hash(Buffer.from(JSON.stringify(edited.project), 'utf8'));

  await ensureQuickActionDrawerOpen();
  await clickSelector('[data-testid="quick-action-save"]');
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspect()?.dirty === false', 30_000);
  const saved = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  const savedProjectBytes = await fsp.readFile(projectFilePath);
  const savedProject = ProjectSchema.parse(JSON.parse(savedProjectBytes.toString('utf8')));
  assert(saved.revision === edited.revision && saved.undoCount === edited.undoCount, 'Saving the visible subtitle edit changed its revision or History.');
  assert(JSON.stringify(savedProject) === JSON.stringify(edited.project), 'The real subtitle edit was not saved to the formal project file.');
  assert(exportService.getJob(original.start.jobId)?.status === 'running', 'The initial Main Job did not remain active while editing and saving.');

  issue834Stage = 'preview-during-export';
  await clickSelector('[data-testid="quick-action-play"]');
  await waitForRenderer('Boolean(document.querySelector("[data-testid=\\"product-preview-overlay\\"]"))');
  await waitForRenderer('(() => { const button = document.querySelector("[data-testid=\\"product-preview-play-pause\\"]"); return button && !button.disabled; })()', 60_000);
  const previewInitiallyPlaying = await rendererJs('document.querySelector("[data-testid=\\"product-preview-play-pause\\"]")?.getAttribute("aria-pressed") === "true"');
  if (!previewInitiallyPlaying) {
    await clickSelector('[data-testid="product-preview-play-pause"]');
    await waitForRenderer('document.querySelector("[data-testid=\\"product-preview-play-pause\\"]")?.getAttribute("aria-pressed") === "true"');
  }
  await clickSelector('[data-testid="product-preview-close"]');
  await waitForRenderer('!document.querySelector("[data-testid=\\"product-preview-overlay\\"]")');
  assert(exportService.getJob(original.start.jobId)?.status === 'running', 'Product Preview blocked or completed the gated Main Job.');

  originalGate.release();
  issue834Stage = 'completed-terminal-restore';
  const originalTerminal = await waitForIssue832Terminal(original.start, 120_000);
  assert(originalTerminal.task.status === 'completed', 'Hidden original export did not complete.');
  assert(exportService.getJob(original.start.jobId)?.status === 'completed' && existsSync(originalOutputPath), 'The original output did not complete while its task surface was hidden.');
  const originalOutputSha256 = hash(await fsp.readFile(originalOutputPath));
  assert(original.start.projectContentSha256 === originalProjectContentSha256, 'The Main Job lost its captured original Project identity.');
  assert(JSON.stringify(ProjectSchema.parse(JSON.parse((await fsp.readFile(projectFilePath)).toString('utf8')))) === JSON.stringify(savedProject), 'The frozen original export changed the newly saved subtitle Project.');
  const hiddenCompletedTask = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(hiddenCompletedTask.task.jobId === original.start.jobId && hiddenCompletedTask.task.status === 'completed', 'The terminal result was not retained while the surface was hidden.');

  mainWindow.setContentSize(1024, 768);
  const completedState = await restoreIssue834TerminalTask(original.start, 'completed', 'hidden completed terminal');
  const completedScreenshotPath = path.join(evidenceRoot, 'completed-terminal-restored-narrow.png');
  await fsp.writeFile(completedScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  const formalStartCountAtCompletedRestore = formalStarts.length;
  const revealStartCount = revealedOutputs.length;
  await clickButtonContainingText('\u663e\u793a\u89c6\u9891');
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ' + JSON.stringify(original.start.jobId) + ' && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.status === "completed"');
  assert(revealedOutputs.length === revealStartCount + 1 && revealedOutputs.at(-1) === originalOutputPath, 'The restored completed task did not request reveal of its own output location.');
  assert(exportService.getCompletedOutputPath(original.start.jobId) === originalOutputPath, 'The completed Job output location no longer belongs to the restored task.');
  const dialogCountBeforeNewVersionCancel = saveDialogEvidence.length;
  const startsBeforeNewVersionCancel = formalStarts.length;
  await clickButtonContainingText('\u5bfc\u51fa\u65b0\u7248\u672c');
  const newVersionCancelScreenshotPath = path.join(evidenceRoot, 'new-version-save-as-cancelled.png');
  await clickNativeSaveDialog('cancel', newVersionCancelScreenshotPath);
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ' + JSON.stringify(original.start.jobId) + ' && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.status === "completed"');
  assert(formalStarts.length === startsBeforeNewVersionCancel, 'Cancelling explicit new-version Save As started another Job.');
  assert(saveDialogEvidence.length === dialogCountBeforeNewVersionCancel + 1 && saveDialogEvidence.at(-1).result === 'cancelled', 'Explicit new-version cancellation did not cancel its native Save As dialog.');
  const originalAfterNewVersionCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspectExportTask()');
  assert(originalAfterNewVersionCancel.task.jobId === completedState.task.jobId && originalAfterNewVersionCancel.task.status === 'completed', 'Save As cancellation did not restore the completed result.');

  const cancelledOutputPath = path.join(fixture.projectRoot, 'issue834-hidden-cancelled.mp4');
  const cancelledGate = controlledGate();
  pauseNextIssue834Encode = cancelledGate;
  const cancelledRun = await beginIssue832CreatorExport(
    'issue834-hidden-cancelled',
    path.basename(cancelledOutputPath),
    '\u5bfc\u51fa\u65b0\u7248\u672c',
  );
  await waitForGate(cancelledGate, 'hidden cancellation export encoding');
  await clickSelector('[data-testid="export-task-surface"] .export-task-hide');
  await waitForRenderer('!document.querySelector("[data-testid=\\"export-task-surface\\"]")');
  assert(exportService.cancelJob(cancelledRun.start.jobId), 'Main did not accept cancellation for the hidden running Job.');
  cancelledGate.release();
  const cancelledTerminal = await waitForIssue832Terminal(cancelledRun.start, 120_000);
  assert(cancelledTerminal.task.status === 'cancelled' && exportService.getJob(cancelledRun.start.jobId)?.status === 'cancelled', 'The hidden Main cancellation did not reach the cancelled terminal state.');
  assert(!existsSync(cancelledOutputPath), 'The hidden cancelled Job published an output.');
  const cancelledRestored = await restoreIssue834TerminalTask(cancelledRun.start, 'cancelled', 'hidden cancelled terminal');

  const failedOutputPath = path.join(fixture.projectRoot, 'issue834-hidden-failed.mp4');
  const failedGate = controlledGate();
  pauseNextIssue834Encode = failedGate;
  failNextEncoderRun = true;
  const failedRun = await beginIssue832CreatorExport(
    'issue834-hidden-failed',
    path.basename(failedOutputPath),
    '\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa',
  );
  assert(failedRun.start.projectContentSha256 === editedProjectContentSha256, 'Current-content retry did not freeze the actual subtitle edit.');
  await waitForGate(failedGate, 'hidden failure export encoding');
  await clickSelector('[data-testid="export-task-surface"] .export-task-hide');
  await waitForRenderer('!document.querySelector("[data-testid=\\"export-task-surface\\"]")');
  failedGate.release();
  const failedTerminal = await waitForIssue832Terminal(failedRun.start, 120_000);
  const failedJob = exportService.getJob(failedRun.start.jobId);
  assert(failedTerminal.task.status === 'failed' && failedJob?.status === 'failed', 'The controlled hidden encoder failure did not reach the failed terminal state.');
  assert(!existsSync(failedOutputPath), 'The hidden failed Job published an output.');
  const failedRestored = await restoreIssue834TerminalTask(failedRun.start, 'failed', 'hidden failed terminal');
  const failedActions = await rendererJs('Array.from(document.querySelectorAll("[data-testid=\\"export-task-surface\\"] button")).map((button) => button.innerText)');
  assert(failedActions.some((label) => label.includes('\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa')), 'The restored failed task lost its current-content retry action.');
  assert(failedActions.some((label) => label.includes('\u9009\u62e9\u4f4d\u7f6e') && label.includes('\u91cd\u8bd5')), 'The restored failed task lost its frozen-snapshot retry action.');

  assert(await exportPreparationService.discard(undefined, cancelledRun.start.snapshotId), 'Cancelled terminal snapshot could not be discarded after identity checks.');
  assert(await exportPreparationService.discard(undefined, failedRun.start.snapshotId), 'Failed terminal snapshot could not be discarded after retry-action checks.');

  const issue836R0Evidence = dl06R0Mode
    ? await runIssue836R0CleanupRecovery({ originalOutputPath, originalOutputSha256, projectFilePath })
    : null;

  if (issue836R0Evidence) {
    const resetOutputPath = path.join(fixture.projectRoot, 'issue836-r0-harness-reset.mp4');
    const resetGate = controlledGate();
    pauseNextIssue834Encode = resetGate;
    failNextEncoderRun = true;
    const resetRun = await beginIssue832CreatorExport(
      'issue836-r0-harness-reset',
      path.basename(resetOutputPath),
      '\u5bfc\u51fa\u65b0\u7248\u672c',
    );
    await waitForGate(resetGate, 'DL-06 R0 verifier state restoration');
    resetGate.release();
    const resetTerminal = await waitForIssue832Terminal(resetRun.start, 120_000);
    assert(resetTerminal.task.status === 'failed', 'DL-06 R0 verifier state restoration did not leave the expected failed-task retry surface.');
    assert(!existsSync(resetOutputPath), 'DL-06 R0 verifier state restoration unexpectedly published an MP4.');
    assert(await exportPreparationService.discard(undefined, resetRun.start.snapshotId), 'DL-06 R0 verifier state-restoration snapshot could not be discarded.');
    issue836R0Evidence.verifierStateRestoration = {
      jobId: resetRun.start.jobId,
      status: resetTerminal.task.status,
      outputAbsent: !existsSync(resetOutputPath),
      snapshotDiscarded: true,
    };
  }

  const runningCloseTargetPath = path.join(fixture.projectRoot, 'issue834-browser-close-running.mp4');
  const runningCloseGate = controlledGate();
  pauseNextIssue834Encode = runningCloseGate;
  const runningCloseRun = await beginIssue832CreatorExport(
    'issue834-browser-close-running',
    path.basename(runningCloseTargetPath),
    '\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa',
  );
  await waitForGate(runningCloseGate, 'BrowserWindow running-close export encoding');
  const runningCloseWindow = mainWindow;
  const runningCloseWindowWebContentsId = runningCloseWindow.webContents.id;
  const runningPromptCount = closePromptEvidence.length;
  runningCloseWindow.close();
  while (closePromptEvidence.length === runningPromptCount) await pause(25);
  assert(!runningCloseWindow.isDestroyed(), 'BrowserWindow closed before its running Job was cancelled and cleaned.');
  assert(closePromptEvidence.at(-1).buttons.length === 2, 'Running export close prompt did not offer cancel-and-close and keep-open choices.');
  runningCloseGate.release();
  await waitForWindowClosed(runningCloseWindow, 'running Job close');
  const runningCloseJob = exportService.getJob(runningCloseRun.start.jobId);
  assert(runningCloseJob?.status === 'cancelled', 'Closing during encoding did not cancel and wait for the Main Job.');
  assert(!existsSync(runningCloseTargetPath), 'Closing during encoding published an MP4.');
  assert(!hiddenWindowManager.getDiagnostics().windowOpen, 'The hidden renderer remained open after running-close cleanup.');
  const runningCloseHiddenWindowClosed = !hiddenWindowManager.getDiagnostics().windowOpen;

  const reopenedAfterRunningClose = await createIssue834WindowAndOpenProject();
  assert(hash(Buffer.from(JSON.stringify(reopenedAfterRunningClose.project), 'utf8')) === editedProjectContentSha256, 'Project reopen after BrowserWindow close lost the saved subtitle edit.');

  const commitTargetPath = path.join(fixture.projectRoot, 'issue834-browser-close-committing.mp4');
  assert(!existsSync(commitTargetPath), 'The committing-close target must begin absent.');
  const commitGate = controlledGate();
  pauseIssue834Commit = commitGate;
  conflictAtCommitPath = commitTargetPath;
  const committingRun = await beginIssue832CreatorExport('issue834-browser-close-committing', path.basename(commitTargetPath));
  await waitForGate(commitGate, 'BrowserWindow committing-close export commit');
  await waitForRenderer('window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.jobId === ' + JSON.stringify(committingRun.start.jobId) + ' && window.__pandaStageIssue816Acceptance.inspectExportTask()?.task.phase === "committing"');
  assert(!exportService.canCancelJob(committingRun.start.jobId), 'The commit-boundary Job remained cancellable.');
  const committingWindow = mainWindow;
  const committingWindowWebContentsId = committingWindow.webContents.id;
  const committingPromptCount = closePromptEvidence.length;
  committingWindow.close();
  while (closePromptEvidence.length === committingPromptCount) await pause(25);
  assert(!committingWindow.isDestroyed(), 'BrowserWindow closed before the non-cancellable commit settled.');
  assert(!existsSync(commitTargetPath), 'Commit test target appeared before the controlled commit gate was released.');
  assert(closePromptEvidence.at(-1).buttons.length === 2, 'Committing close prompt did not offer wait-and-close and keep-open choices.');
  commitGate.release();
  await waitForWindowClosed(committingWindow, 'committing Job close');
  const committingJob = exportService.getJob(committingRun.start.jobId);
  const conflict = injectedCommitConflicts.at(-1);
  assert(committingJob?.status === 'failed', 'The no-clobber race did not fail the committing Job.');
  assert(conflict?.outputPath === commitTargetPath && conflict.insertedAfterOutputCheck, 'The test sentinel was not inserted at the final commit boundary.');
  const sentinelSha256 = hash(await fsp.readFile(commitTargetPath));
  assert(sentinelSha256 === conflict.sha256, 'No-replace commit changed the third-party sentinel.');
  assert(committingJob.cleanupError === null, 'Commit failure reported an unrelated cleanup failure.');
  assert(!hiddenWindowManager.getDiagnostics().windowOpen, 'The hidden renderer remained open after committing-close cleanup.');

  assert(await exportPreparationService.discard(undefined, runningCloseRun.start.snapshotId), 'Running-close snapshot could not be discarded after cancellation.');
  assert(await exportPreparationService.discard(undefined, committingRun.start.snapshotId), 'Commit-race snapshot could not be discarded after no-clobber verification.');
  const resourceCleanup = await assertNoExportTemporaries('Issue #834 terminal and BrowserWindow close scenarios');
  assert((await fsp.readFile(projectFilePath)).equals(savedProjectBytes), 'Terminal restore or BrowserWindow close changed the saved Project file.');
  assert(hash(await fsp.readFile(originalOutputPath)) === originalOutputSha256, 'Later export outcomes changed the completed original MP4.');

  result.fixture = {
    projectId: project.id,
    projectRoot: fixture.projectRoot,
    projectDurationMs: 1_500,
    shotCount: 3,
    audioClipCounts: fixtureProject.shots.map((shot) => shot.audioClips.length),
    originalProjectContentSha256,
    editedProjectContentSha256,
    savedProjectSha256: hash(savedProjectBytes),
    originalSubtitle,
    editedSubtitle: nextSubtitle,
  };
  result.acceptance = {
    AC01_hiddenCompletedRestore: {
      status: 'PASS',
      jobId: original.start.jobId,
      attemptId: original.start.attemptId,
      snapshotId: original.start.snapshotId,
      mainStatus: exportService.getJob(original.start.jobId)?.status,
      restoredStatus: completedState.task.status,
      formalStartCount: formalStartCountAtCompletedRestore,
      outputPath: originalOutputPath,
      outputSha256: originalOutputSha256,
      revealRequestedForSameOutput: revealedOutputs.at(-1) === originalOutputPath,
      revealPath: revealedOutputs.at(-1),
      screenshotPath: completedScreenshotPath,
    },
    AC02_explicitNewVersionAndSaveAsCancellation: {
      status: 'PASS',
      newVersionAction: '\u5bfc\u51fa\u65b0\u7248\u672c',
      cancelledDialog: saveDialogEvidence.at(dialogCountBeforeNewVersionCancel),
      oldJobId: original.start.jobId,
      oldStatusAfterCancel: originalAfterNewVersionCancel.task.status,
      noNewJobStarted: true,
      cancelledOutputPath,
    },
    AC03_hiddenCancelledAndFailedRestore: {
      status: 'PASS',
      cancelled: { start: cancelledRun.start, status: cancelledRestored.task.status, targetAbsent: !existsSync(cancelledOutputPath) },
      failed: { start: failedRun.start, status: failedRestored.task.status, targetAbsent: !existsSync(failedOutputPath), originalError: failedJob?.originalError },
      failedRetryActions: failedActions,
    },
    AC04_visibleSubtitleEditDuringExport: {
      status: 'PASS',
      inputSelector: '[data-testid="dialogue-inspector-text"]',
      revisionBefore: opened.revision,
      revisionAfter: edited.revision,
      undoCountAfter: edited.undoCount,
      originalJobCapturedProjectSha256: original.start.projectContentSha256,
      editedProjectContentSha256,
      screenshotPath: subtitleScreenshotPath,
      screenshotSize: subtitleImageSize,
      viewportDip: { width: 1024, height: 768 },
      inputBounds: subtitleControl,
      savedWhileJobRunning: true,
      previewOpenedAndClosedWhileJobRunning: true,
    },
    AC05_runningBrowserWindowClose: {
      status: 'PASS',
      windowWebContentsId: runningCloseWindowWebContentsId,
      jobId: runningCloseRun.start.jobId,
      prompt: closePromptEvidence[runningPromptCount],
      mainStatus: runningCloseJob?.status,
      outputAbsent: !existsSync(runningCloseTargetPath),
      hiddenWindowClosed: runningCloseHiddenWindowClosed,
    },
    AC06_committingBrowserWindowCloseAndNoClobber: {
      status: 'PASS',
      windowWebContentsId: committingWindowWebContentsId,
      jobId: committingRun.start.jobId,
      prompt: closePromptEvidence[committingPromptCount],
      mainStatus: committingJob?.status,
      conflict,
      sentinelSha256After: sentinelSha256,
      sentinelUnchanged: sentinelSha256 === conflict.sha256,
      hiddenWindowClosed: !hiddenWindowManager.getDiagnostics().windowOpen,
    },
    AC07_resourceCleanup: {
      status: 'PASS',
      resourceCleanup,
      closePrompts: closePromptEvidence,
    },
    ...(issue836R0Evidence
      ? { AC08_issue836R0CleanupRecovery: issue836R0Evidence }
      : {}),
  };
  result.exportJobs = formalStarts.map((start) => ({
    ...start,
    terminal: exportService.getJob(start.jobId),
  }));
  result.saveDialogEvidence = saveDialogEvidence;
  result.resourceCleanup = resourceCleanup;
  result.auto = 'PASS';
  result.owner = {
    status: 'FOLLOWUP_REVIEW_READY',
    ownerManual: 'DEFERRED_TO_DL07',
    techReview: 'PENDING',
    dl06: 'NO GO',
    multiShotAvAccepted: false,
    humanWindowsElectronAcceptance: 'NOT_CLAIMED',
  };
  result.completedAt = new Date().toISOString();
  await fsp.writeFile(path.join(evidenceRoot, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  await fsp.writeFile(path.join(fixture.root, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('PASS #834 DL-05 follow-up acceptance: ' + fixture.root);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  hiddenWindowManager.close();
  app.exit(0);
}

function acceptanceSessionFingerprint(snapshot) {
  return {
    projectId: snapshot.project?.id ?? null,
    projectSha256: snapshot.project ? hash(Buffer.from(JSON.stringify(snapshot.project), 'utf8')) : null,
    revision: snapshot.revision ?? null,
    dirty: snapshot.dirty ?? null,
    openInstanceId: snapshot.openInstanceId ?? null,
    currentShotId: snapshot.currentShotId ?? null,
    undoCount: snapshot.undoCount ?? null,
    redoCount: snapshot.redoCount ?? null,
  };
}

async function runIssue827Acceptance({ result, editorSnapshotPath, editorSnapshotBytes, initialProjectBytes, projectFilePath, mediaTools }) {
  const evidenceRoot = fixture.evidenceRoot;
  let projectSnapshot = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  let project = projectSnapshot.project;
  let saveReopenEvidence = null;
  let persistedProjectBytesBeforeExport = initialProjectBytes;
  if (dl04SampleId === 1) {
    const preSaveFingerprint = await projectPersistenceFingerprint(project, fixture.projectRoot);
    const originalInstanceId = projectSnapshot.openInstanceId;
    await ensureQuickActionDrawerOpen();
    await clickSelector('[data-testid="quick-action-save"]');
    await waitForRenderer('window.__pandaStageIssue816Acceptance.inspect()?.dirty === false');
    const savedSnapshot = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const savedProjectBytes = await fsp.readFile(projectFilePath);
    const savedProject = ProjectSchema.parse(JSON.parse(savedProjectBytes.toString('utf8')));
    const savedFingerprint = await projectPersistenceFingerprint(savedProject, fixture.projectRoot);
    assert(JSON.stringify(preSaveFingerprint) === JSON.stringify(savedFingerprint), 'Creator Save did not persist the edited Shot, timing, background, dialogue, and audio references.');
    const savedProjectSha256 = hash(savedProjectBytes);

    await clickSelector('[data-testid="quick-action-close"]');
    await waitForRenderer("!window.__pandaStageIssue816Acceptance.inspect()?.project && Array.from(document.querySelectorAll('[data-task4-core]')).some((element) => element.getAttribute('data-task4-core') === 'recent-open')");
    await clickSelector('[data-task4-core="recent-open"]');
    await waitForRenderer(`window.__pandaStageIssue816Acceptance.inspect()?.project?.id === ${JSON.stringify(savedProject.id)}`);
    projectSnapshot = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    project = projectSnapshot.project;
    const reopenedBytes = await fsp.readFile(projectFilePath);
    const reopenedFingerprint = await projectPersistenceFingerprint(project, fixture.projectRoot);
    const diskOpenEvidence = diskRecentProjectOpens.at(-1);
    assert(projectSnapshot.openInstanceId !== originalInstanceId, 'Recent Project open did not create a new Editor Project instance after close.');
    assert(projectSnapshot.dirty === false, 'Project reopened from disk with an unexpected dirty state.');
    assert(reopenedBytes.equals(savedProjectBytes), 'Reopened Project bytes differ from the Creator UI save.');
    assert(JSON.stringify(savedFingerprint) === JSON.stringify(reopenedFingerprint), 'Reopened Project changed Shot order, durations, clip timing, background references, or asset hashes.');
    assert(diskOpenEvidence?.projectId === savedProject.id && diskOpenEvidence.projectFileSha256 === savedProjectSha256, 'Recent Project Open did not read the saved project.json from disk.');
    persistedProjectBytesBeforeExport = savedProjectBytes;
    saveReopenEvidence = {
      path: 'Creator quick-action Save, Close, then Recent Projects Open',
      projectId: project.id,
      originalOpenInstanceId: originalInstanceId,
      reopenedOpenInstanceId: projectSnapshot.openInstanceId,
      savedRevision: savedSnapshot.revision,
      reopenedRevision: projectSnapshot.revision,
      savedProjectSha256,
      reopenedProjectSha256: hash(reopenedBytes),
      diskOpenEvidence,
      diskBytesUnchanged: reopenedBytes.equals(savedProjectBytes),
      beforeReopen: savedFingerprint,
      afterReopen: reopenedFingerprint,
      reopenedDirty: projectSnapshot.dirty,
    };
  } else {
    assert(projectSnapshot.dirty === true, 'The second Issue #827 sample must retain an unsaved editor snapshot.');
  }
  const preExportPersistenceFingerprint = await projectPersistenceFingerprint(project, fixture.projectRoot);
  assert(JSON.stringify(preExportPersistenceFingerprint.backgrounds.map((entry) => ({ shotId: entry.shotId, assetId: entry.assetId, sha256: entry.sha256 }))) === JSON.stringify(fixture.backgroundEvidence.map((entry) => ({ shotId: entry.shotId, assetId: entry.assetId, sha256: entry.sha256 }))), 'Project background references or bytes changed before formal export.');
  await ensureQuickActionDrawerOpen();
  const totalDurationMs = project.shots.reduce((total, shot) => total + shot.durationMs, 0);
  const desiredCameraMode = dl04SampleId === 1 ? 'static' : 'speaker-focus';
  const currentCameraMode = await rendererJs(`document.querySelector('[data-testid="right-mode-auto-camera"]')?.getAttribute('aria-pressed') === 'true'`);
  const wantsSpeakerFocus = desiredCameraMode === 'speaker-focus';
  if (currentCameraMode !== wantsSpeakerFocus) {
    await clickSelector('[data-testid="right-mode-auto-camera"]');
  }
  await waitForRenderer(`document.querySelector('[data-testid="right-mode-auto-camera"]')?.getAttribute('aria-pressed') === '${String(wantsSpeakerFocus)}'`);

  await rendererJs(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const alreadyOpen = dock?.getAttribute('data-resource-drawer-open') === 'true' &&
      dock.getAttribute('data-active-activity') === 'shots';
    if (alreadyOpen) return true;
    const rail = dock?.querySelector('[data-testid="resource-activity-rail-shots"]');
    if (rail) {
      rail.click();
      return true;
    }
    const handle = dock?.querySelector('[data-testid="resource-workspace-handle"]');
    if (dock?.getAttribute('data-resource-drawer-open') !== 'true') handle?.click();
    if (dock?.getAttribute('data-active-activity') !== 'shots') {
      dock?.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]')?.click();
    }
    return true;
  })()`);
  await waitForRenderer(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    return dock?.getAttribute('data-resource-drawer-open') === 'true' &&
      dock.getAttribute('data-active-activity') === 'shots' &&
      document.querySelector('[data-testid="shot-list-view"]');
  })()`);
  const selectedShotId = project.shots.at(-1).id;
  const selectedShotButton = `[data-testid="resource-activity-dock"][data-resource-drawer-open="true"] [data-shot-id="${selectedShotId}"] button`;
  await clickSelector(selectedShotButton);
  let shotSelectionMethod = 'electron-pointer';
  const selectionAppliedByPointer = await rendererJs(
    `document.querySelector(${JSON.stringify(selectedShotButton)})?.getAttribute('aria-current') === 'true'`,
  );
  if (!selectionAppliedByPointer) {
    await rendererJs(`document.querySelector(${JSON.stringify(selectedShotButton)})?.click()`);
    shotSelectionMethod = 'creator-button-click-fallback';
  }
  await waitForRenderer(`document.querySelector(${JSON.stringify(selectedShotButton)})?.getAttribute('aria-current') === 'true'`);
  const selectedState = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  assert(selectedState.currentShotId === selectedShotId, 'Creator UI did not select the final Shot before full-Project export.');

  const cancelPath = path.join(fixture.projectRoot, `issue827-cancelled-${dl04SampleId}.mp4`);
  const cancelRun = await startFromCreatorUi(evidenceRoot, 'cancelled-before-full-export', {
    selectedFileName: path.basename(cancelPath),
    cancelAfterProgress: true,
    duplicateClickDuringRun: true,
    completionTimeoutMs: 1_200_000,
  });
  assert(cancelRun.status === 'cancelled' && !existsSync(cancelPath), 'Cancelled formal Job published an MP4.');
  const cancellationCleanup = await assertNoExportTemporaries('Issue #827 formal cancellation');

  if (dl04SampleId === 2) replaceDialogueSourceBeforeNextMix = true;
  const outputPath = path.join(fixture.projectRoot, `issue827-sample-${dl04SampleId}.mp4`);
  const exportRun = await startFromCreatorUi(evidenceRoot, `issue827-sample-${dl04SampleId}`, {
    selectedFileName: path.basename(outputPath),
    completionTimeoutMs: 1_200_000,
  });
  assert(exportRun.start.cameraMode === desiredCameraMode, 'Formal candidate did not capture the requested camera mode.');
  const expectedDirtyAtCapture = dl04SampleId === 2;
  assert(exportRun.start.dirtyAtCapture === expectedDirtyAtCapture, `Formal candidate dirtyAtCapture must be ${expectedDirtyAtCapture} for sample ${dl04SampleId}.`);
  assert(exportRun.after.revision === exportRun.before.revision && exportRun.after.dirty === exportRun.before.dirty && exportRun.after.undoCount === exportRun.before.undoCount, 'Export changed Project revision, dirty state, or History.');
  assert((await fsp.readFile(projectFilePath)).equals(persistedProjectBytesBeforeExport), 'Export changed the persisted Project while capturing the editor snapshot.');
  const exportEvidence = await issue827ExportEvidence(outputPath, path.join(evidenceRoot, `sample-${dl04SampleId}-output`), project, desiredCameraMode, mediaTools, fixture.backgroundEvidence);

  const beforeExistingTargetHash = hash(await fsp.readFile(outputPath));
  const existingTarget = await startFromCreatorUi(evidenceRoot, 'existing-target-no-clobber', {
    captureOverwritePrompt: true,
    selectedFileName: path.basename(outputPath),
    expectedFailureText: '\u8f93\u51fa\u6587\u4ef6\u5df2\u5b58\u5728',
  });
  const afterExistingTargetHash = hash(await fsp.readFile(outputPath));
  assert(existingTarget.starts.length === 0 && beforeExistingTargetHash === afterExistingTargetHash, 'Existing target was overwritten or started a render Job.');
  const existingTargetCleanup = await assertNoExportTemporaries('Issue #827 existing target no-clobber');

  let runtimeRenderFailure = null;
  if (dl04SampleId === 1) {
    const failedOutputPath = path.join(fixture.projectRoot, 'issue827-late-shot-render-failure.mp4');
    assert(!existsSync(failedOutputPath), 'Controlled late-shot failure target already exists.');
    const priorOutputSha256 = hash(await fsp.readFile(outputPath));
    const failureSessionBefore = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const projectBytesBeforeFailure = await fsp.readFile(projectFilePath);
    const sourceHashesBeforeFailure = await Promise.all(fixtureProject.assets.map(async (asset) => ({
      assetId: asset.id,
      sha256: hash(await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath))),
    })));
    const injectionRecords = [];
    const originalRenderFrame = hiddenWindowManager.renderFrame.bind(hiddenWindowManager);
    hiddenWindowManager.renderFrame = (request) => {
      const position = mapProjectTime(project, request.timeMs);
      if (position.shotIndex === 1 && injectionRecords.length === 0) {
        const injectedRequest = { ...request, shotLocalTimeMs: request.shotLocalTimeMs + 1 };
        injectionRecords.push({
          injection: 'test-only hidden-renderer formal frame-map mismatch',
          jobId: request.jobId,
          shotIndex: position.shotIndex,
          shotId: position.shot.id,
          frameIndex: request.frameIndex,
          globalTimeMs: request.timeMs,
          expectedShotLocalTimeMs: position.shotLocalTimeMs,
          requestShotLocalTimeMs: request.shotLocalTimeMs,
          injectedShotLocalTimeMs: injectedRequest.shotLocalTimeMs,
        });
        return originalRenderFrame(injectedRequest);
      }
      return originalRenderFrame(request);
    };
    let failureRun;
    try {
      failureRun = await startFromCreatorUi(evidenceRoot, 'issue827-late-shot-render-failure', {
        selectedFileName: path.basename(failedOutputPath),
        expectJobFailure: true,
        completionTimeoutMs: 1_200_000,
      });
    } finally {
      delete hiddenWindowManager.renderFrame;
    }
    assert(injectionRecords.length === 1 && injectionRecords[0].shotIndex === 1, 'Controlled failure did not target exactly one frame in the second Shot.');
    assert(failureRun.status === 'failed' && failureRun.start.jobId === injectionRecords[0].jobId, 'The formal Job did not fail after the controlled second-Shot request.');
    assert(String(failureRun.failedJob?.error ?? '').includes('Formal export frame did not match the Project Shot map.'), 'The hidden renderer did not report the deterministic Shot-map failure.');
    assert(!existsSync(failedOutputPath), 'The failed late-Shot Job published an MP4.');
    const failureCleanup = await assertNoExportTemporaries('Issue #830 deterministic late-Shot render failure');
    const hiddenDiagnostics = hiddenWindowManager.getDiagnostics();
    assert(!hiddenDiagnostics.windowOpen && hiddenDiagnostics.loadedJobId === null && hiddenDiagnostics.pendingLoadJobId === null && hiddenDiagnostics.pendingFrameJobId === null, 'Hidden renderer Job state was not released after the late-Shot failure.');
    const failureSessionAfter = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    const sessionBeforeFingerprint = acceptanceSessionFingerprint(failureSessionBefore);
    const sessionAfterFingerprint = acceptanceSessionFingerprint(failureSessionAfter);
    assert(JSON.stringify(sessionBeforeFingerprint) === JSON.stringify(sessionAfterFingerprint), 'The failed formal Job changed the Project, revision, dirty state, history, or selection.');
    const projectBytesAfterFailure = await fsp.readFile(projectFilePath);
    assert(projectBytesAfterFailure.equals(projectBytesBeforeFailure), 'The failed formal Job changed project.json.');
    const sourceHashesAfterFailure = await Promise.all(fixtureProject.assets.map(async (asset) => ({
      assetId: asset.id,
      sha256: hash(await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath))),
    })));
    assert(JSON.stringify(sourceHashesAfterFailure) === JSON.stringify(sourceHashesBeforeFailure), 'The failed formal Job changed source assets.');
    const outputSha256After = hash(await fsp.readFile(outputPath));
    assert(outputSha256After === priorOutputSha256, 'The late-Shot failure changed the previously completed MP4.');
    runtimeRenderFailure = {
      startAction: failureRun.startAction,
      targetPath: failedOutputPath,
      injection: injectionRecords[0],
      job: { jobId: failureRun.failedJob.jobId, status: failureRun.failedJob.status, phase: failureRun.failedJob.phase, error: failureRun.failedJob.error },
      failedScreenshotPath: failureRun.failureScreenshotPath,
      outputAbsent: !existsSync(failedOutputPath),
      stagingCleanup: failureCleanup,
      hiddenWindowDiagnosticsAfterFailure: hiddenDiagnostics,
      editorStateBefore: sessionBeforeFingerprint,
      editorStateAfter: sessionAfterFingerprint,
      editorStateUnchanged: JSON.stringify(sessionBeforeFingerprint) === JSON.stringify(sessionAfterFingerprint),
      projectFileSha256Before: hash(projectBytesBeforeFailure),
      projectFileSha256After: hash(projectBytesAfterFailure),
      projectFileUnchanged: projectBytesAfterFailure.equals(projectBytesBeforeFailure),
      sourceAssetHashesBefore: sourceHashesBeforeFailure,
      sourceAssetHashesAfter: sourceHashesAfterFailure,
      sourceAssetsUnchanged: JSON.stringify(sourceHashesAfterFailure) === JSON.stringify(sourceHashesBeforeFailure),
      priorSuccessfulOutputSha256Before: priorOutputSha256,
      priorSuccessfulOutputSha256After: outputSha256After,
      priorSuccessfulOutputUnchanged: outputSha256After === priorOutputSha256,
    };
  }

  const restoredSourceHashes = await Promise.all(fixtureProject.assets.map(async (asset) => {
    const bytes = await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath));
    return { assetId: asset.id, expected: asset.sha256, actual: hash(bytes), matches: hash(bytes) === asset.sha256 };
  }));
  assert(restoredSourceHashes.every((entry) => entry.matches), 'A fixture source asset did not match its frozen hash after export.');
  const sourceReplacement = audioSourceReplacementEvidence.at(-1) ?? null;
  if (dl04SampleId === 2) {
    assert(sourceReplacement?.muxCompleted && sourceReplacement.frozenSha256BeforeMix === sourceReplacement.originalSha256, 'Frozen source replacement evidence is missing for the speaker-focus Project.');
  }

  const externalPlayerScript = path.join(__dirname, 'issue819-external-player.ps1');
  const externalPlayer = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', externalPlayerScript, outputPath, path.join(evidenceRoot, 'external-player.png')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr.trim() || stdout.trim())));
  });
  assert(externalPlayer.launch === 'STARTED', 'Windows external player did not launch the formal MP4.');

  const prefixRows = exportEvidence.shotPrefixes;
  const frameMapEvidence = Array.from(iterateFormalProjectFrameSchedule(project));
  const frameMapByShot = project.shots.map((shot, index) => ({
    shotId: shot.id,
    shotIndex: index,
    shotStartMs: prefixRows[index].startMs,
    frameCount: frameMapEvidence.filter((frame) => frame.shotIndex === index).length,
    firstFrame: frameMapEvidence.find((frame) => frame.shotIndex === index) ?? null,
    lastFrame: frameMapEvidence.filter((frame) => frame.shotIndex === index).at(-1) ?? null,
  }));
  const cameraEvidence = project.shots.map((shot) => {
    const plan = prepareSpeakerFocusCamera(project, shot);
    return {
      shotId: shot.id,
      duringDialogue: evaluateSpeakerFocusCamera(plan, shot.dialogues[0]?.startMs ?? 0),
      afterDialogue: evaluateSpeakerFocusCamera(plan, shot.dialogues[0]?.endMs ?? shot.durationMs),
    };
  });
  const finalEditorState = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
  result.fixture = {
    sampleId: dl04SampleId,
    projectId: project.id,
    projectName: project.name,
    projectPath: projectFilePath,
    projectFileSha256: hash(persistedProjectBytesBeforeExport),
    editorSnapshotPath,
    editorSnapshotSha256: hash(editorSnapshotBytes),
    editorSnapshotRevision: exportRun.start.revision,
    dirtyAtCapture: exportRun.start.dirtyAtCapture,
    saveReopen: saveReopenEvidence,
    persistenceFingerprint: preExportPersistenceFingerprint,
    shotCount: project.shots.length,
    totalDurationMs,
    shots: project.shots.map((shot) => ({ shotId: shot.id, name: shot.name, durationMs: shot.durationMs, dialogueCount: shot.dialogues.length, audioClipCount: shot.audioClips.length })),
    assets: restoredSourceHashes,
  };
  result.selectionIndependence = { selectedShotBeforeExport: selectedShotId, selectionMethod: shotSelectionMethod, outputShotOrder: prefixRows.map((row) => row.shotId), fullProjectCaptured: exportRun.start.mediaCount > 0 };
  result.cancellation = { startAction: cancelRun.startAction, jobStatus: exportService.getJob(cancelRun.start.jobId)?.status, targetPath: cancelPath, targetAbsent: !existsSync(cancelPath), duplicateClickStartedSecondJob: false, progressScreenshotPath: cancelRun.progressScreenshotPath, temporaryCleanup: cancellationCleanup };
  result.existingTargetNoClobber = { startAction: existingTarget.startAction, path: outputPath, beforeSha256: beforeExistingTargetHash, afterSha256: afterExistingTargetHash, unchanged: beforeExistingTargetHash === afterExistingTargetHash, formalJobsStarted: existingTarget.starts.length, blockedScreenshotPath: existingTarget.failureScreenshotPath, temporaryCleanup: existingTargetCleanup };
  result.sourceMediaReplacement = sourceReplacement;
  result.sourceHashesAfterExport = restoredSourceHashes;
  result.shotPrefixTable = prefixRows;
  result.globalFrameMapByShot = frameMapByShot;
  result.audioMap = fixture.audioMixFixture.mappedClips;
  result.cameraResolverEvidence = cameraEvidence;
  result.outputs = { [desiredCameraMode]: { ...exportEvidence, creatorUiEvidence: { startAction: exportRun.startAction, nativeSaveAs: exportRun.nativeSaveAsScreenshotPath, progress: exportRun.progressScreenshotPath, completed: exportRun.completedScreenshotPath }, externalPlayer } };
  result.runtimeRenderFailure = runtimeRenderFailure;
  result.editorState = {
    revision: finalEditorState.revision,
    dirty: finalEditorState.dirty,
    undoCount: finalEditorState.undoCount,
    selectedShotId: finalEditorState.currentShotId,
    exportPreservedRevision: exportRun.after.revision === exportRun.before.revision,
    exportPreservedDirty: exportRun.after.dirty === exportRun.before.dirty,
    exportPreservedHistory: exportRun.after.undoCount === exportRun.before.undoCount,
    projectFileUnchanged: (await fsp.readFile(projectFilePath)).equals(persistedProjectBytesBeforeExport),
  };
  result.exportJobs = jobUpdates.map((update) => ({ jobId: update.jobId, status: update.status, phase: update.phase, completedFrames: update.completedFrames, totalFrames: update.totalFrames }));
  result.auto = 'PASS';
  result.owner = { status: 'NOT_ATTESTED', note: 'Human audiovisual review and MULTI_SHOT_AV_ACCEPTED are deferred to DL-07.' };
  result.completedAt = new Date().toISOString();
  await fsp.writeFile(path.join(evidenceRoot, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  await fsp.writeFile(path.join(fixture.root, 'acceptance-receipt.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`PASS #827 DL-04 sample ${dl04SampleId}: ${fixture.root}`);
  mainWindow.destroy();
  hiddenWindowManager.close();
  app.exit(0);
}

async function run() {
  fixture = dl04Mode || dl05Mode
    ? await generateIssue827Fixture(path.resolve(baseDirectory), dl04SampleId)
    : await generateIssue819Fixture(path.resolve(baseDirectory), {
        includeAudioMix: dl03Mode,
      });
  fixtureProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixture.projectRoot, 'project.json'), 'utf8')));
  if (dl05FollowupMode) {
    fixtureProject = shortIssue834Project(fixtureProject);
    await fsp.writeFile(
      path.join(fixture.projectRoot, 'project.json'),
      JSON.stringify(fixtureProject, null, 2),
      'utf8',
    );
  }
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
  if (dl05FollowupMode) installIssue834CloseGuard(mainWindow);
  mainWindow.setContentSize(1280, 800);
  // Keep the owning window below native Save As dialogs during the automated
  // DL-04 and DL-05 flows.
  mainWindow.setAlwaysOnTop(!dl04Mode && !dl05Mode);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const result = {
    issue: dl06R0Mode ? 836 : dl05FollowupMode ? 834 : dl05Mode ? 832 : dl04Mode ? 827 : dl03Mode ? 823 : 819,
    wrapperRunId: process.env.PANDA_STAGE_ISSUE836_RUN_ID ?? process.env.PANDA_STAGE_ISSUE834_RUN_ID ?? process.env.PANDA_STAGE_ISSUE832_RUN_ID ?? process.env.PANDA_STAGE_ISSUE827_WRAPPER_RUN_ID ?? null,
    sourceCommitSha: process.env.PANDA_STAGE_ISSUE836_SOURCE_SHA ?? process.env.PANDA_STAGE_ISSUE834_SOURCE_SHA ?? process.env.PANDA_STAGE_ISSUE832_SOURCE_SHA ?? process.env.PANDA_STAGE_ISSUE827_WRAPPER_COMMIT_SHA ?? null,
    sampleId: dl04Mode || dl05Mode ? dl04SampleId : null,
    workOrder: dl06R0Mode
      ? 'Issue #836 DL-06 R0: same-session recovery after two bounded snapshot cleanup failures'
      : dl05FollowupMode
      ? 'Issue #834 DL-05 follow-up: terminal task restoration, retryable snapshot cleanup, and close confirmation'
      : dl05Mode
      ? 'DL-05 export task lifecycle, frozen/current retries, and editing during a multi-shot job'
      : dl04Mode
      ? 'DL-04 formal whole-Project multi-shot export acceptance'
      : dl03Mode
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
    if (dl05FollowupMode) {
      assert(fixtureProject.shots.length === 3, 'Issue #834 fixture must contain three Shots.');
      assert(fixtureProject.shots.every((shot) => shot.durationMs === 500), 'Issue #834 fixture Shots must each be 500 ms.');
      assert(fixtureProject.shots.reduce((total, shot) => total + shot.durationMs, 0) === 1_500, 'Issue #834 fixture must be 1.5 seconds long.');
      assert(fixtureProject.shots.every((shot) => shot.audioClips.length === 0), 'Issue #834 fixture must omit audio.');
      assert(fixtureProject.shots[0].dialogues.length === 1, 'Issue #834 fixture must contain a visible first-Shot subtitle.');
    } else if (dl04Mode || dl05Mode) {
      assert(fixtureProject.shots.length === 3, 'Issue #827/832 fixture must contain three Shots.');
      assert(fixtureProject.shots.reduce((total, shot) => total + shot.durationMs, 0) === 30_000, 'Issue #827/832 fixture must be 30 seconds long.');
      assert(fixtureProject.shots.every((shot) => shot.durationMs >= 9_000), 'Issue #827/832 fixture Shots must each be long enough to cross a global frame boundary.');
      assert(fixtureProject.shots[0].audioClips.length === 2 && fixtureProject.shots[1].audioClips.length === 1 && fixtureProject.shots[2].audioClips.length === 1, 'Issue #827/832 fixture must place audio across all three Shots.');
    } else {
      assert(fixtureProject.shots.length === 1, 'Fixture must contain exactly one Shot.');
      assert(
        fixtureProject.shots[0].audioClips.length === (dl03Mode ? 6 : 0),
        `Fixture must contain ${dl03Mode ? 'six valid audio clips' : 'no audio clips'}.`,
      );
      assert(fixtureProject.shots[0].durationMs > 5_000, 'Fixture must exceed the old five-second probe ceiling.');
    }
    const expressionHashes = Object.values(fixture.expressionAssetHashes);
    assert(expressionHashes.length === 2 && expressionHashes[0] !== expressionHashes[1], 'Neutral and happy fixture PNGs must have different SHA-256 hashes.');
    await waitForRenderer(`document.querySelector('[data-task4-core="recent-open"]')`);
    await clickSelector('[data-task4-core="recent-open"]');
    await waitForRenderer("window.__pandaStageIssue816Acceptance && (await window.__pandaStageIssue816Acceptance.inspect())?.project");
    const opened = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
    assert(opened.project.id === fixtureProject.id, 'Creator UI opened a different Project.');

    if (dl05FollowupMode) {
      await runIssue834FollowupAcceptance({ result, opened, initialProjectBytes, projectFilePath });
      return;
    }

    const edited = await rendererJs('window.__pandaStageIssue816Acceptance.editUnsavedFixture()');
    assert(edited.dirty === true && edited.revision === opened.revision + 1, 'Unsaved fixture edit did not enter the formal Project revision.');
    assert(edited.undoCount === opened.undoCount + 1, 'Unsaved fixture edit did not create exactly one History entry.');
    const editorSnapshotPath = path.join(evidenceRoot, 'editor-snapshot.json');
    const editorSnapshotBytes = Buffer.from(JSON.stringify(edited.project, null, 2), 'utf8');
    await fsp.writeFile(editorSnapshotPath, editorSnapshotBytes);
    await clickSelector('[data-testid="quick-action-drawer-handle"]');
    if (dl05Mode) {
      await runIssue832Acceptance({
        result,
        editorSnapshotPath,
        editorSnapshotBytes,
        initialProjectBytes,
        projectFilePath,
        mediaTools,
        originalContentProject: edited.project,
      });
      return;
    }
    if (dl04Mode) {
      await runIssue827Acceptance({ result, editorSnapshotPath, editorSnapshotBytes, initialProjectBytes, projectFilePath, mediaTools });
      return;
    }
    const beforeCancel = await rendererJs('window.__pandaStageIssue816Acceptance.inspect()');
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
    if (dl03Mode) replaceDialogueSourceBeforeNextMix = true;
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

    let audioMixFailure = null;
    if (dl03Mode) {
      const audioMixFailureTargetPath = path.join(fixture.projectRoot, 'audio-mix-failure.mp4');
      failNextAudioMixProcess = true;
      const audioMixFailureRun = await startFromCreatorUi(evidenceRoot, 'audio-mix-failure', {
        selectedFileName: path.basename(audioMixFailureTargetPath),
        expectJobFailure: true,
      });
      assert(!existsSync(audioMixFailureTargetPath), 'A partial audio mix created the final output target.');
      assert(audioMixFailureRun.failedJob?.status === 'failed', 'The injected mid-mix process failure did not fail the formal Job.');
      assert(audioMixProcessFailures.length === 1, 'The controlled mid-mix process failure did not execute exactly once.');
      const audioMixFailureCleanup = await assertNoExportTemporaries('mid-mix FFmpeg failure');
      assert(hash(await fsp.readFile(staticOutputPath)) === staticHashBeforeConflict, 'The mid-mix failure changed the existing static MP4.');
      assert(hash(await fsp.readFile(speakerOutputPath)) === speakerEvidence.sha256, 'The mid-mix failure changed the existing speaker-focus MP4.');
      audioMixFailure = {
        targetPath: audioMixFailureTargetPath,
        targetExists: existsSync(audioMixFailureTargetPath),
        jobStatus: audioMixFailureRun.failedJob.status,
        failure: audioMixProcessFailures[0],
        failureScreenshotPath: audioMixFailureRun.failureScreenshotPath,
        temporaryCleanup: audioMixFailureCleanup,
      };
    }

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

    const undecodableAudioSource = dl03Mode
      ? await verifyUndecodableAudioSource(initialProjectBytes)
      : null;
    const restoredAudioSourceHashes = await Promise.all(
      fixtureProject.assets
        .filter((asset) => asset.kind === 'audio')
        .map(async (asset) => ({
          assetId: asset.id,
          restored: hash(await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath))) === asset.sha256,
        })),
    );
    assert(restoredAudioSourceHashes.every((entry) => entry.restored), 'A project Audio source was not restored to its frozen fixture hash.');
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
    result.audioMixFailure = audioMixFailure;
    result.sourceMediaReplacement = audioSourceReplacementEvidence[0] ?? null;
    result.undecodableAudioSource = undecodableAudioSource;
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
      sourceAudioAssetsUnchanged: restoredAudioSourceHashes.every((entry) => entry.restored),
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
      issue834Stage,
      dialogueUi: mainWindow && !mainWindow.isDestroyed()
        ? await rendererJs('({ activity: document.querySelector("[data-testid=\\"right-workspace\\"]")?.dataset.activeActivity ?? null, clipSelected: document.querySelector("[data-testid=\\"dialogue-clip\\"]")?.dataset.selected ?? null, inspectorText: document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]")?.value ?? null, inspectorPresent: Boolean(document.querySelector("[data-testid=\\"dialogue-inspector-text\\"]")) })').catch((error) => String(error))
        : null,
      formalStarts,
      saveDialogEvidence,
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
