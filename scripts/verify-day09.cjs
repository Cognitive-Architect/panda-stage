const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const {
  registerIpcHandlers,
} = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const {
  ExportService,
} = require('../dist-electron/main/services/ExportService.js');
const {
  FFmpegAdapter,
} = require('../dist-electron/main/services/FFmpegAdapter.js');
const {
  FileSystemService,
} = require('../dist-electron/main/services/FileSystemService.js');
const {
  HiddenWindowManager,
} = require('../dist-electron/main/windows/hidden-window-manager.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');

const AUDIO_START_MS = 400;
const CANCEL_TIMEOUT_MS = 30_000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

function requireEnvironmentPath(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must point to a verified development executable.`);
  }
  return path.resolve(value);
}

async function waitUntil(predicate, description, timeoutMs = CANCEL_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function capturePlayback(videoPath, screenshotPath) {
  const harnessPath = path.join(
    os.tmpdir(),
    `panda-stage-day09-playback-${process.pid}-${Date.now()}.html`,
  );
  await fs.writeFile(
    harnessPath,
    `<!doctype html><meta charset="UTF-8"><style>html,body{margin:0;background:#111;width:100%;height:100%;overflow:hidden}video{width:100%;height:100%;object-fit:contain}</style><video src="${pathToFileURL(videoPath)}"></video>`,
    'utf8',
  );
  const window = new BrowserWindow({
    width: 960,
    height: 540,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadFile(harnessPath);
    const state = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.querySelector('video');
        const timeout = setTimeout(() => reject(new Error('Day 09 playback timed out')), 10000);
        video.addEventListener('error', () => reject(new Error('Chromium could not decode Day 09 output')), { once: true });
        const inspect = async () => {
          video.muted = false;
          video.volume = 0.25;
          video.currentTime = 0.65;
          await new Promise((done) => video.addEventListener('seeked', done, { once: true }));
          await video.play();
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          video.pause();
          clearTimeout(timeout);
          resolve({
            currentTime: video.currentTime,
            duration: video.duration,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            muted: video.muted,
            paused: video.paused
          });
        };
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void inspect();
        else video.addEventListener('loadedmetadata', () => void inspect(), { once: true });
      })
    `);
    const image = await window.webContents.capturePage();
    await fs.writeFile(screenshotPath, image.toPNG());
    return state;
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fs.rm(harnessPath, { force: true });
  }
}

async function verifyUiRecovery(window, jobId, inputValues, screenshotPath) {
  window.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, {
    jobId,
    status: 'cancelled',
    phase: 'finished',
    completedFrames: 72,
    totalFrames: 72,
    error: '导出已取消并完成资源清理；可以立即重新导出。',
  });
  const uiRecovery = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const values = ${JSON.stringify(inputValues)};
      const inputs = [...document.querySelectorAll('.export-probe input')];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      inputs.forEach((input, index) => {
        setter.call(input, values[index]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      setTimeout(() => {
        const buttons = [...document.querySelectorAll('.export-probe button')];
        resolve({
          statusText: document.querySelector('[data-testid="export-status"]')?.textContent,
          startDisabled: buttons[0]?.disabled,
          cancelDisabled: buttons[1]?.disabled,
          inputValues: inputs.map((input) => input.value)
        });
      }, 100);
    })
  `);
  if (
    !uiRecovery.statusText.includes('cancelled') ||
    uiRecovery.startDisabled ||
    !uiRecovery.cancelDisabled
  ) {
    throw new Error(
      `UI did not recover after cancellation: ${JSON.stringify(uiRecovery)}`,
    );
  }
  const redactedInputValues = [
    '<project-directory: Unicode path verified>',
    '<probe-wav>',
    '<output-path: Unicode path verified>',
  ];
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const values = ${JSON.stringify(redactedInputValues)};
      const inputs = [...document.querySelectorAll('.export-probe input')];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      inputs.forEach((input, index) => {
        setter.call(input, values[index]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      setTimeout(resolve, 50);
    })
  `);
  const uiImage = await window.webContents.capturePage();
  await fs.writeFile(screenshotPath, uiImage.toPNG());
  return { ...uiRecovery, inputValues: redactedInputValues };
}

class SwitchingRenderer {
  constructor(hidden, fastPngBytes) {
    this.hidden = hidden;
    this.fastPngBytes = fastPngBytes;
    this.mode = 'hidden';
    this.fastLoadedJobId = null;
  }

  async prepareJob() {
    if (this.mode === 'hidden') await this.hidden.prepareJob();
  }

  async loadProbe(request) {
    if (this.mode === 'hidden') return this.hidden.loadProbe(request);
    this.fastLoadedJobId = request.jobId;
    return { jobId: request.jobId, acknowledged: true };
  }

  async renderFrame(request) {
    if (this.mode === 'hidden') return this.hidden.renderFrame(request);
    if (this.fastLoadedJobId !== request.jobId) {
      throw new Error(`Fast renderer has not loaded Job ${request.jobId}.`);
    }
    return {
      ...request,
      width: 1_920,
      height: 1_080,
      pngBytes: this.fastPngBytes,
    };
  }

  cancelJob(jobId) {
    if (this.mode === 'hidden') return this.hidden.cancelJob(jobId);
    const matched = this.fastLoadedJobId === jobId;
    if (matched) this.fastLoadedJobId = null;
    return matched;
  }

  releaseJob(jobId) {
    if (this.mode === 'hidden') this.hidden.releaseJob(jobId);
    this.fastLoadedJobId = null;
  }
}

class ControlledFileSystem {
  constructor(realFileSystem) {
    this.real = realFileSystem;
    this.blockNextWrite = false;
    this.writeStarted = null;
    this.releaseWrite = null;
    this.inFlightWrites = 0;
  }

  createJobDirectory(jobId) {
    return this.real.createJobDirectory(jobId);
  }

  listFrameFiles(directory) {
    return this.real.listFrameFiles(directory);
  }

  cleanupJobDirectory(directory) {
    return this.real.cleanupJobDirectory(directory);
  }

  assertReadableProjectDirectory(directory) {
    return this.real.assertReadableProjectDirectory(directory);
  }

  prepareFinalOutput(outputPath, overwrite) {
    return this.real.prepareFinalOutput(outputPath, overwrite);
  }

  createFinalOutputStagingPath(jobId, outputPath) {
    return this.real.createFinalOutputStagingPath(jobId, outputPath);
  }

  commitFinalOutput(stagingPath, outputPath, overwrite) {
    return this.real.commitFinalOutput(stagingPath, outputPath, overwrite);
  }

  cleanupFinalOutputStaging(stagingPath) {
    return this.real.cleanupFinalOutputStaging(stagingPath);
  }

  armWriteBlock() {
    this.blockNextWrite = true;
    this.writeStarted = new Promise((resolve) => {
      this.signalWriteStarted = resolve;
    });
    this.writeRelease = new Promise((resolve) => {
      this.releaseWrite = resolve;
    });
  }

  async writeFrame(directory, fileName, bytes) {
    this.inFlightWrites += 1;
    try {
      if (this.blockNextWrite) {
        this.blockNextWrite = false;
        this.signalWriteStarted();
        await this.writeRelease;
      }
      await this.real.writeFrame(directory, fileName, bytes);
    } finally {
      this.inFlightWrites -= 1;
    }
  }
}

async function runVerification() {
  const ffmpegPath = requireEnvironmentPath('PANDA_STAGE_FFMPEG_PATH');
  const ffprobePath = requireEnvironmentPath('PANDA_STAGE_FFPROBE_PATH');
  const verificationRoot = path.join(
    os.tmpdir(),
    'panda stage day 09 中文 空格 🐼',
    `${process.pid}-${Date.now()}`,
  );
  const projectDirectory = path.join(verificationRoot, '项目 源文件 🎬');
  const outputDirectory = path.join(verificationRoot, '输出 成片 🐼');
  const frameRoot = path.join(verificationRoot, '临时 帧任务 🧹');
  const audioPath = path.resolve(__dirname, '../public/probe/preview-tone.wav');
  const evidenceDirectory = path.resolve(__dirname, '../docs/evidence/day-09');
  const evidenceVideoPath = path.join(evidenceDirectory, 'unicode-recovered.mp4');
  const evidenceScreenshotPath = path.join(
    evidenceDirectory,
    'unicode-recovered-playback.png',
  );
  const evidenceUiPath = path.join(
    evidenceDirectory,
    'cancelled-ui-ready.png',
  );
  const samplePng = await fs.readFile(
    path.resolve(__dirname, '../docs/evidence/day-06/frame_000000.png'),
  );
  const hidden = new HiddenWindowManager();
  const renderer = new SwitchingRenderer(hidden, samplePng);
  const realFileSystem = new FileSystemService(frameRoot);
  const fileSystem = new ControlledFileSystem(realFileSystem);
  const adapter = new FFmpegAdapter({ ffmpegPath, ffprobePath });
  const service = new ExportService(renderer, fileSystem, adapter);
  let mainWindow = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hidden.getWindow(),
    markHiddenReady: (senderId) => hidden.markReady(senderId),
    markProbeLoaded: (senderId, payload) => hidden.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) => hidden.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) => hidden.markFrameFailed(senderId, payload),
    startFullProbe: (request) => {
      const handle = service.startFullProbe(request);
      void handle.completion.catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => ({
      jobId,
      accepted: service.cancelJob(jobId),
      status: service.getJob(jobId)?.status ?? 'cancelled',
    }),
  });
  const sentinel = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => process.exit(0), 600000)'],
    { shell: false, windowsHide: true, stdio: 'ignore' },
  );
  const cancellations = [];

  const requestFor = (name) => ({
    projectDirectory,
    audioPath,
    outputPath: path.join(outputDirectory, `${name}.mp4`),
    durationMs: 3_000,
    fps: 24,
    audioStartMs: AUDIO_START_MS,
    overwrite: true,
  });

  const assertCleanAfterCancellation = async (handle, phase, startedAt, pid) => {
    let error = null;
    try {
      await handle.completion;
    } catch (caught) {
      error = caught;
    }
    if (!error || !error.message.includes(handle.jobId)) {
      throw new Error(`Cancelled ${phase} Job did not report its Job ID.`);
    }
    if (!error.message.includes('可以立即重新导出')) {
      throw new Error(`Cancelled ${phase} Job did not provide a recovery action.`);
    }
    await waitUntil(
      () => adapter.getActiveProcessCount() === 0,
      `${phase} FFmpeg process cleanup`,
    );
    if (fileSystem.inFlightWrites !== 0) {
      throw new Error(`${phase} cancellation left frame writes in flight.`);
    }
    const frameEntries = await fs.readdir(frameRoot).catch((caught) => {
      if (caught.code === 'ENOENT') return [];
      throw caught;
    });
    if (frameEntries.length !== 0) {
      throw new Error(`${phase} cancellation left a Job directory.`);
    }
    const stagingEntries = (await fs.readdir(outputDirectory)).filter(
      (entry) => /\.panda-stage-.*\.mp4$/iu.test(entry),
    );
    if (stagingEntries.length !== 0) {
      throw new Error(
        `${phase} cancellation left final-output staging: ${stagingEntries.join(', ')}.`,
      );
    }
    if (hidden.getDiagnostics().windowOpen) {
      throw new Error(`${phase} cancellation left a hidden window open.`);
    }
    if (sentinel.exitCode !== null) {
      throw new Error(`${phase} cancellation affected an unrelated child process.`);
    }
    const record = service.getJob(handle.jobId);
    if (record?.status !== 'cancelled' || service.getActiveJobId() !== null) {
      throw new Error(`${phase} cancellation did not restore the idle state.`);
    }
    cancellations.push({
      index: cancellations.length + 1,
      phase,
      jobId: handle.jobId,
      elapsedMs: Date.now() - startedAt,
      encodedProcessPid: pid,
      status: record.status,
      activeProcessesAfter: adapter.getActiveProcessCount(),
      hiddenWindowsAfter: hidden.getDiagnostics().windowOpen ? 1 : 0,
      frameDirectoriesAfter: frameEntries.length,
      finalOutputStagingFilesAfter: stagingEntries.length,
      inFlightWritesAfter: fileSystem.inFlightWrites,
      unrelatedProcessAlive: sentinel.exitCode === null,
      message: error.message,
    });
    console.log(
      `Day 09 cancellation ${cancellations.length}/5: ${phase} Job ${handle.jobId} cleaned.`,
    );
  };

  try {
    await fs.mkdir(projectDirectory, { recursive: true });
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.mkdir(evidenceDirectory, { recursive: true });
    const projectFile = path.join(projectDirectory, '探针 项目 🐼.json');
    await fs.writeFile(
      projectFile,
      `${JSON.stringify({ name: '熊猫片场 Day 09', fps: 24, durationMs: 3000 }, null, 2)}\n`,
      'utf8',
    );
    const parsedProject = JSON.parse(await fs.readFile(projectFile, 'utf8'));
    if (parsedProject.name !== '熊猫片场 Day 09') {
      throw new Error('Unicode project file could not be read back.');
    }

    if (process.env.DAY09_UI_ONLY === '1') {
      mainWindow = await createMainWindow();
      const uiRecovery = await verifyUiRecovery(
        mainWindow,
        '00000000-0000-4000-8000-000000000009',
        [projectDirectory, audioPath, path.join(outputDirectory, 'UI 检查.mp4')],
        evidenceUiPath,
      );
      console.log(JSON.stringify({ uiRecovery }, null, 2));
      return;
    }

    for (let index = 1; index <= 2; index += 1) {
      renderer.mode = 'hidden';
      const startedAt = Date.now();
      const handle = service.startFullProbe(requestFor(`取消-渲染-${index}`));
      await waitUntil(
        () => hidden.getDiagnostics().pendingFrameJobId === handle.jobId,
        `render request for Job ${handle.jobId}`,
      );
      if (!service.cancelJob(handle.jobId)) {
        throw new Error(`Rendering Job ${handle.jobId} rejected cancellation.`);
      }
      await assertCleanAfterCancellation(handle, 'rendering', startedAt, null);
    }

    renderer.mode = 'fast';
    fileSystem.armWriteBlock();
    const writeStartedAt = Date.now();
    const writeHandle = service.startFullProbe(requestFor('取消-写盘-3'));
    await fileSystem.writeStarted;
    if (!service.cancelJob(writeHandle.jobId)) {
      throw new Error(`Writing Job ${writeHandle.jobId} rejected cancellation.`);
    }
    fileSystem.releaseWrite();
    await assertCleanAfterCancellation(
      writeHandle,
      'writing',
      writeStartedAt,
      null,
    );

    renderer.mode = 'fast';
    const encodeStartedAt = Date.now();
    const encodeHandle = service.startFullProbe(requestFor('取消-编码-4'));
    await waitUntil(
      () =>
        adapter
          .getProcessDiagnostics()
          .active.some((process) => process.args.includes('-framerate')),
      `real FFmpeg encoding process for Job ${encodeHandle.jobId}`,
    );
    const encodeProcess = adapter
      .getProcessDiagnostics()
      .active.find((process) => process.args.includes('-framerate'));
    if (!service.cancelJob(encodeHandle.jobId)) {
      throw new Error(`Encoding Job ${encodeHandle.jobId} rejected cancellation.`);
    }
    await assertCleanAfterCancellation(
      encodeHandle,
      'encoding',
      encodeStartedAt,
      encodeProcess?.pid ?? null,
    );

    const protectedOutputPath = path.join(
      outputDirectory,
      '取消-mux-5-旧正式输出.mp4',
    );
    const protectedOutputBytes = Buffer.from(
      'Panda Stage Day 09 protected formal output',
      'utf8',
    );
    const protectedOutputHash = crypto
      .createHash('sha256')
      .update(protectedOutputBytes)
      .digest('hex');
    await fs.writeFile(protectedOutputPath, protectedOutputBytes);
    renderer.mode = 'fast';
    const muxStartedAt = Date.now();
    const muxHandle = service.startFullProbe({
      ...requestFor('取消-mux-5-旧正式输出'),
      outputPath: protectedOutputPath,
    });
    await waitUntil(
      () =>
        adapter
          .getProcessDiagnostics()
          .active.some((process) => process.args.includes('-filter_complex')),
      `real FFmpeg mux process for Job ${muxHandle.jobId}`,
    );
    const muxProcess = adapter
      .getProcessDiagnostics()
      .active.find((process) => process.args.includes('-filter_complex'));
    if (!service.cancelJob(muxHandle.jobId)) {
      throw new Error(`Mux Job ${muxHandle.jobId} rejected cancellation.`);
    }
    await assertCleanAfterCancellation(
      muxHandle,
      'muxing',
      muxStartedAt,
      muxProcess?.pid ?? null,
    );
    const protectedOutputAfter = await fs.readFile(protectedOutputPath);
    const protectedOutputHashAfter = crypto
      .createHash('sha256')
      .update(protectedOutputAfter)
      .digest('hex');
    if (protectedOutputHashAfter !== protectedOutputHash) {
      throw new Error('Mux cancellation changed the pre-existing formal output.');
    }
    Object.assign(cancellations.at(-1), {
      formalOutputExistedBefore: true,
      formalOutputPreserved: true,
      formalOutputSha256Before: protectedOutputHash,
      formalOutputSha256After: protectedOutputHashAfter,
    });
    await fs.rm(protectedOutputPath, { force: true });

    if (cancellations.length !== 5) {
      throw new Error(`Expected five cancellations, received ${cancellations.length}.`);
    }
    const outputEntriesAfterCancellation = await fs.readdir(outputDirectory);
    if (outputEntriesAfterCancellation.length !== 0) {
      throw new Error('Cancelled Jobs left partial output media files.');
    }

    renderer.mode = 'hidden';
    const recoveryOutputPath = path.join(outputDirectory, '恢复 导出成功 🐼.mp4');
    const recovery = await service.runFullProbe({
      ...requestFor('恢复 导出成功 🐼'),
      outputPath: recoveryOutputPath,
    });
    adapter.assertMuxProbeMatches(recovery.probe, {
      videoCodecName: 'h264',
      pixelFormat: 'yuv420p',
      width: 1_920,
      height: 1_080,
      fps: 24,
      frameCount: 72,
      audioCodecName: 'aac',
      audioSampleRate: 48_000,
      audioChannels: 1,
      videoDurationSeconds: 3,
      audioDurationSeconds: 3.4,
      formatDurationSeconds: 3.4,
      durationToleranceSeconds: 0.05,
    });
    const timing = await adapter.analyzeAudioTiming(recoveryOutputPath);
    if (Math.abs(timing.leadingSilenceEndSeconds - 0.4) > 0.02) {
      throw new Error(
        `Recovered export audio onset mismatch: ${timing.leadingSilenceEndSeconds}.`,
      );
    }
    const playback = await capturePlayback(
      recoveryOutputPath,
      evidenceScreenshotPath,
    );
    if (
      playback.videoWidth !== 1_920 ||
      playback.videoHeight !== 1_080 ||
      playback.muted ||
      Math.abs(playback.duration - 3.4) > 0.08
    ) {
      throw new Error(`Recovered playback mismatch: ${JSON.stringify(playback)}`);
    }
    mainWindow = await createMainWindow();
    const uiRecovery = await verifyUiRecovery(
      mainWindow,
      cancellations.at(-1).jobId,
      [projectDirectory, audioPath, recoveryOutputPath],
      evidenceUiPath,
    );
    mainWindow.destroy();
    mainWindow = null;
    const recoveryBytes = await fs.readFile(recoveryOutputPath);
    await fs.copyFile(recoveryOutputPath, evidenceVideoPath);
    const frameEntriesAfterRecovery = await fs.readdir(frameRoot);
    const stagingEntriesAfterRecovery = (
      await fs.readdir(outputDirectory)
    ).filter((entry) => /\.panda-stage-.*\.mp4$/iu.test(entry));
    if (
      frameEntriesAfterRecovery.length !== 0 ||
      stagingEntriesAfterRecovery.length !== 0 ||
      adapter.getActiveProcessCount() !== 0 ||
      hidden.getDiagnostics().windowOpen ||
      service.getActiveJobId() !== null
    ) {
      throw new Error('Recovery export left Job resources active.');
    }

    const result = {
      gitBaseline: process.env.DAY09_BASELINE_SHA ?? '<recorded-by-runner>',
      pathEvidence: {
        verificationRoot: `<os-temp>${path.sep}panda stage day 09 中文 空格 🐼${path.sep}<run-id>`,
        projectDirectory: '<verification-root>\\项目 源文件 🎬',
        projectFile: '<project-directory>\\探针 项目 🐼.json',
        outputPath: '<verification-root>\\输出 成片 🐼\\恢复 导出成功 🐼.mp4',
        projectReadBack: parsedProject,
      },
      cancellationProtocol: {
        signalScope: 'one AbortController per Export Job',
        childTermination: 'Node child.kill(SIGTERM) on the signal-owning child only',
        cleanupRetries: { maxRetries: 3, retryDelayMs: 75 },
        finalOutputCommit:
          'same-directory Job staging -> probe -> cancellation point-of-no-return -> rename',
      },
      cancellations,
      recovery: {
        jobId: recovery.jobId,
        status: recovery.status,
        outputBytes: recoveryBytes.byteLength,
        sha256: crypto.createHash('sha256').update(recoveryBytes).digest('hex'),
        renderElapsedMs: recovery.render.elapsedMs,
        totalElapsedMs: recovery.elapsedMs,
        probe: {
          codecName: recovery.probe.codecName,
          pixelFormat: recovery.probe.pixelFormat,
          width: recovery.probe.width,
          height: recovery.probe.height,
          fps: recovery.probe.fps,
          frameCount: recovery.probe.frameCount,
          videoDurationSeconds: recovery.probe.durationSeconds,
          audioCodecName: recovery.probe.audioCodecName,
          audioSampleRate: recovery.probe.audioSampleRate,
          audioChannels: recovery.probe.audioChannels,
          audioDurationSeconds: recovery.probe.audioDurationSeconds,
          formatDurationSeconds: recovery.probe.formatDurationSeconds,
        },
        leadingSilenceEndSeconds: timing.leadingSilenceEndSeconds,
        playback,
        uiRecovery,
      },
      resourcesAfterRecovery: {
        activeJobId: service.getActiveJobId(),
        activeEncodingProcesses: adapter.getActiveProcessCount(),
        hiddenWindows: hidden.getDiagnostics().windowOpen ? 1 : 0,
        frameDirectories: frameEntriesAfterRecovery.length,
        finalOutputStagingFiles: stagingEntriesAfterRecovery.length,
        inFlightWrites: fileSystem.inFlightWrites,
        unrelatedProcessAlive: sentinel.exitCode === null,
      },
    };
    await fs.writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    removeIpcHandlers();
    hidden.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    if (sentinel.exitCode === null) sentinel.kill('SIGTERM');
    await fs.rm(verificationRoot, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (BrowserWindow.getAllWindows().length !== 0) {
    throw new Error('Day 09 verification left BrowserWindows open.');
  }
}

app
  .whenReady()
  .then(runVerification)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
