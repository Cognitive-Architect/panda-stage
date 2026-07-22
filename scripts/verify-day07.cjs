const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

function requireEnvironmentPath(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must point to a verified development executable.`);
  }
  return path.resolve(value);
}

function redact(value, replacements) {
  return replacements.reduce(
    (result, [raw, replacement]) => result.split(raw).join(replacement),
    value,
  );
}

async function capturePlaybackFrame(videoPath, screenshotPath) {
  const harnessPath = path.join(
    os.tmpdir(),
    `panda-stage-day07-playback-${process.pid}-${Date.now()}.html`,
  );
  const videoUrl = pathToFileURL(videoPath).toString();
  await fs.writeFile(
    harnessPath,
    `<!doctype html>
<html><head><meta charset="UTF-8"><style>
html,body{margin:0;background:#111;width:100%;height:100%;overflow:hidden}
video{display:block;width:100%;height:100%;object-fit:contain}
</style></head><body><video muted src="${videoUrl}"></video></body></html>`,
    'utf8',
  );
  const playbackWindow = new BrowserWindow({
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
    await playbackWindow.loadFile(harnessPath);
    const playbackState = await playbackWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.querySelector('video');
        const timeout = setTimeout(() => reject(new Error('video playback timed out')), 10000);
        video.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Chromium could not decode the MP4'));
        }, { once: true });
        const start = async () => {
          try {
            video.currentTime = 1.5;
            await new Promise((seekResolve) => {
              video.addEventListener('seeked', seekResolve, { once: true });
            });
            await video.play();
            await new Promise((frameResolve) => {
              requestAnimationFrame(() => requestAnimationFrame(frameResolve));
            });
            video.pause();
            clearTimeout(timeout);
            resolve({
              currentTime: video.currentTime,
              duration: video.duration,
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              paused: video.paused
            });
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) start();
        else video.addEventListener('loadedmetadata', start, { once: true });
      })
    `);
    const image = await playbackWindow.webContents.capturePage();
    await fs.writeFile(screenshotPath, image.toPNG());
    return playbackState;
  } finally {
    if (!playbackWindow.isDestroyed()) playbackWindow.destroy();
    await fs.rm(harnessPath, { force: true });
  }
}

async function expectAdapterError(operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    if (error?.code === expectedCode) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error(`Expected FFmpegAdapterError ${expectedCode}.`);
}

async function runVerification() {
  const ffmpegPath = requireEnvironmentPath('PANDA_STAGE_FFMPEG_PATH');
  const ffprobePath = requireEnvironmentPath('PANDA_STAGE_FFPROBE_PATH');
  const verificationRoot = path.join(
    os.tmpdir(),
    'panda stage day 07 verification',
    `${process.pid}-${Date.now()}`,
  );
  const outputDirectory = path.join(verificationRoot, 'encoded output with spaces');
  const outputPath = path.join(outputDirectory, 'panda stage silent probe.mp4');
  const evidenceDirectory = path.resolve(__dirname, '../docs/evidence/day-07');
  const evidenceVideoPath = path.join(evidenceDirectory, 'probe-silent.mp4');
  const evidenceScreenshotPath = path.join(
    evidenceDirectory,
    'probe-playback-midpoint.png',
  );
  const hidden = new HiddenWindowManager();
  let mainWindow = null;
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hidden.getWindow(),
    markHiddenReady: (senderId) => hidden.markReady(senderId),
    markProbeLoaded: (senderId, payload) => hidden.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) => hidden.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) => hidden.markFrameFailed(senderId, payload),
  });
  const fileSystem = new FileSystemService(path.join(verificationRoot, 'frame jobs'));
  const exportService = new ExportService(hidden, fileSystem);
  const adapter = new FFmpegAdapter({ ffmpegPath, ffprobePath });
  let frameDirectory = null;

  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.mkdir(evidenceDirectory, { recursive: true });

    if (process.env.DAY07_PLAYBACK_ONLY === '1') {
      const playback = await capturePlaybackFrame(
        evidenceVideoPath,
        evidenceScreenshotPath,
      );
      console.log(JSON.stringify({ playback }, null, 2));
      return;
    }

    await hidden.create();

    const frameResult = await exportService.runProbe({ durationMs: 3_000, fps: 24 });
    frameDirectory = frameResult.outputDirectory;
    const frameFiles = await fileSystem.listFrameFiles(frameDirectory);
    if (frameFiles.length !== 72) {
      throw new Error(`Expected 72 source frames, received ${frameFiles.length}.`);
    }

    const validation = await adapter.validateExecutable();
    const encoded = await adapter.encodePngSequence({
      framesDirectory: frameDirectory,
      outputPath,
      fps: 24,
      overwrite: true,
    });
    const probe = await adapter.probeVideo(outputPath);
    adapter.assertProbeMatches(probe, {
      codecName: 'h264',
      pixelFormat: 'yuv420p',
      width: 1_920,
      height: 1_080,
      fps: 24,
      frameCount: 72,
      durationSeconds: 3,
      durationToleranceSeconds: 0.08,
      requireSilent: true,
    });

    await fs.copyFile(outputPath, evidenceVideoPath);
    const playback = await capturePlaybackFrame(
      outputPath,
      evidenceScreenshotPath,
    );
    if (
      playback.videoWidth !== 1_920 ||
      playback.videoHeight !== 1_080 ||
      Math.abs(playback.duration - 3) > 0.08
    ) {
      throw new Error(`Chromium playback metadata mismatch: ${JSON.stringify(playback)}`);
    }

    const missingExecutable = await expectAdapterError(
      () =>
        new FFmpegAdapter({
          ffmpegPath: path.join(verificationRoot, 'missing tool', 'ffmpeg.exe'),
          ffprobePath,
        }).getVersion(),
      'EXECUTABLE_NOT_FOUND',
    );

    const missingFramePath = path.join(frameDirectory, 'frame_000036.png');
    const movedFramePath = `${missingFramePath}.missing`;
    await fs.rename(missingFramePath, movedFramePath);
    const missingFrame = await expectAdapterError(
      () =>
        adapter.encodePngSequence({
          framesDirectory: frameDirectory,
          outputPath: path.join(outputDirectory, 'missing-frame.mp4'),
          fps: 24,
        }),
      'FRAME_SEQUENCE_INVALID',
    );
    await fs.rename(movedFramePath, missingFramePath);

    const parentFile = path.join(verificationRoot, 'not a directory.txt');
    await fs.writeFile(parentFile, 'controlled output failure', 'utf8');
    const unwritableOutput = await expectAdapterError(
      () =>
        adapter.encodePngSequence({
          framesDirectory: frameDirectory,
          outputPath: path.join(parentFile, 'video.mp4'),
          fps: 24,
        }),
      'OUTPUT_NOT_WRITABLE',
    );

    const videoBytes = await fs.readFile(outputPath);
    const replacements = [
      [verificationRoot, '<verification-root>'],
      [ffmpegPath, '<ffmpeg-path>'],
      [ffprobePath, '<ffprobe-path>'],
    ];
    const result = {
      sourceFrames: {
        count: frameFiles.length,
        first: frameFiles[0],
        last: frameFiles.at(-1),
        renderElapsedMs: frameResult.elapsedMs,
      },
      ffmpeg: {
        versionLine: validation.versionLine,
        hasLibx264: validation.hasLibx264,
        executable: '<ffmpeg-path>',
      },
      encode: {
        elapsedMs: encoded.elapsedMs,
        frameCount: encoded.frameCount,
        args: encoded.args.map((argument) => redact(argument, replacements)),
        outputBytes: videoBytes.byteLength,
        sha256: crypto.createHash('sha256').update(videoBytes).digest('hex'),
      },
      ffprobe: {
        codecName: probe.codecName,
        pixelFormat: probe.pixelFormat,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        frameCount: probe.frameCount,
        durationSeconds: probe.durationSeconds,
        hasAudio: probe.hasAudio,
      },
      playback,
      negativePaths: {
        missingExecutable,
        missingFrame,
        unwritableOutput,
      },
    };
    await fs.writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (frameDirectory) await fileSystem.cleanupJobDirectory(frameDirectory);
    removeIpcHandlers();
    hidden.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    await fs.rm(verificationRoot, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (BrowserWindow.getAllWindows().length !== 0) {
    throw new Error('Day 07 verification left BrowserWindows open.');
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
