const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  FFmpegAdapter,
} = require('../dist-electron/main/services/FFmpegAdapter.js');

const AUDIO_START_MS = 400;
const VIDEO_DURATION_SECONDS = 3;
const AUDIO_DURATION_SECONDS = 3;
const TIMING_TOLERANCE_SECONDS = 0.02;

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

async function verifyChromiumPlayback(videoPath, screenshotPath) {
  const harnessPath = path.join(
    os.tmpdir(),
    `panda-stage-day08-playback-${process.pid}-${Date.now()}.html`,
  );
  const videoUrl = pathToFileURL(videoPath).toString();
  await fs.writeFile(
    harnessPath,
    `<!doctype html>
<html><head><meta charset="UTF-8"><style>
html,body{margin:0;background:#111;width:100%;height:100%;overflow:hidden}
video{display:block;width:100%;height:100%;object-fit:contain}
</style></head><body><video src="${videoUrl}"></video></body></html>`,
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
    const midpoint = await playbackWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.querySelector('video');
        const timeout = setTimeout(() => reject(new Error('audio MP4 midpoint timed out')), 10000);
        video.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Chromium could not decode the audio MP4'));
        }, { once: true });
        const start = async () => {
          try {
            video.muted = false;
            video.volume = 0.25;
            await video.play();
            const poll = setInterval(() => {
              if (video.currentTime >= 0.65) {
                clearInterval(poll);
                clearTimeout(timeout);
                video.pause();
                resolve({
                  currentTime: video.currentTime,
                  duration: video.duration,
                  videoWidth: video.videoWidth,
                  videoHeight: video.videoHeight,
                  muted: video.muted,
                  volume: video.volume,
                  paused: video.paused
                });
              }
            }, 20);
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
    const ending = await playbackWindow.webContents.executeJavaScript(`
      new Promise(async (resolve, reject) => {
        const video = document.querySelector('video');
        const timeout = setTimeout(() => reject(new Error('audio MP4 ending timed out')), 10000);
        video.addEventListener('ended', () => {
          clearTimeout(timeout);
          resolve({
            currentTime: video.currentTime,
            duration: video.duration,
            ended: video.ended,
            paused: video.paused
          });
        }, { once: true });
        try {
          await video.play();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      })
    `);
    return { midpoint, ending };
  } finally {
    if (!playbackWindow.isDestroyed()) playbackWindow.destroy();
    await fs.rm(harnessPath, { force: true });
  }
}

async function runVerification() {
  const ffmpegPath = requireEnvironmentPath('PANDA_STAGE_FFMPEG_PATH');
  const ffprobePath = requireEnvironmentPath('PANDA_STAGE_FFPROBE_PATH');
  const sourceVideoPath = path.resolve(
    __dirname,
    '../docs/evidence/day-07/probe-silent.mp4',
  );
  const sourceAudioPath = path.resolve(
    __dirname,
    '../public/probe/preview-tone.wav',
  );
  const verificationRoot = path.join(
    os.tmpdir(),
    'panda stage day 08 音频 verification',
    `${process.pid}-${Date.now()}`,
  );
  const outputDirectory = path.join(verificationRoot, 'mux output with spaces');
  const evidenceDirectory = path.resolve(__dirname, '../docs/evidence/day-08');
  const evidenceVideoPath = path.join(evidenceDirectory, 'probe-with-audio.mp4');
  const evidenceScreenshotPath = path.join(
    evidenceDirectory,
    'probe-with-audio-playback.png',
  );
  const adapter = new FFmpegAdapter({ ffmpegPath, ffprobePath });

  try {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.mkdir(evidenceDirectory, { recursive: true });

    const validation = await adapter.validateAudioMuxExecutable();
    const sourceVideoProbe = await adapter.probeVideo(sourceVideoPath);
    adapter.assertProbeMatches(sourceVideoProbe, {
      codecName: 'h264',
      pixelFormat: 'yuv420p',
      width: 1_920,
      height: 1_080,
      fps: 24,
      frameCount: 72,
      durationSeconds: VIDEO_DURATION_SECONDS,
      durationToleranceSeconds: 0.08,
      requireSilent: true,
    });
    const sourceAudioProbe = await adapter.probeAudioFile(sourceAudioPath);
    if (
      sourceAudioProbe.codecName !== 'pcm_s16le' ||
      sourceAudioProbe.sampleRate !== 48_000 ||
      sourceAudioProbe.channels !== 1 ||
      Math.abs(sourceAudioProbe.durationSeconds - AUDIO_DURATION_SECONDS) > 0.001
    ) {
      throw new Error(
        `Unexpected source WAV metadata: ${JSON.stringify(sourceAudioProbe)}`,
      );
    }

    const repeated = [];
    for (let index = 0; index < 3; index += 1) {
      const outputPath = path.join(
        outputDirectory,
        `熊猫音画同步-${index + 1}.mp4`,
      );
      const muxed = await adapter.muxSingleAudio({
        videoPath: sourceVideoPath,
        audioPath: sourceAudioPath,
        startMs: AUDIO_START_MS,
        outputPath,
        overwrite: true,
      });
      const forbiddenArgument = muxed.args.find((argument) =>
        /atempo|amix|-shortest/iu.test(argument),
      );
      if (forbiddenArgument) {
        throw new Error(`Forbidden mux argument: ${forbiddenArgument}`);
      }
      const probe = await adapter.probeVideo(outputPath);
      adapter.assertMuxProbeMatches(probe, {
        videoCodecName: 'h264',
        pixelFormat: 'yuv420p',
        width: 1_920,
        height: 1_080,
        fps: 24,
        audioCodecName: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 1,
        videoDurationSeconds: VIDEO_DURATION_SECONDS,
        audioDurationSeconds:
          AUDIO_DURATION_SECONDS + AUDIO_START_MS / 1_000,
        formatDurationSeconds:
          AUDIO_DURATION_SECONDS + AUDIO_START_MS / 1_000,
        durationToleranceSeconds: 0.05,
      });
      const timing = await adapter.analyzeAudioTiming(outputPath);
      const expectedOnsetSeconds = AUDIO_START_MS / 1_000;
      if (
        Math.abs(timing.leadingSilenceEndSeconds - expectedOnsetSeconds) >
        TIMING_TOLERANCE_SECONDS
      ) {
        throw new Error(
          `Audio onset mismatch: expected ${expectedOnsetSeconds}, received ${timing.leadingSilenceEndSeconds}.`,
        );
      }
      const bytes = await fs.readFile(outputPath);
      repeated.push({
        index: index + 1,
        outputPath,
        muxed,
        probe,
        timing,
        outputBytes: bytes.byteLength,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
    }

    const onsets = repeated.map(
      (entry) => entry.timing.leadingSilenceEndSeconds,
    );
    const onsetSpreadSeconds = Math.max(...onsets) - Math.min(...onsets);
    if (onsetSpreadSeconds > 0.001) {
      throw new Error(
        `Repeated audio onset spread ${onsetSpreadSeconds}s exceeds 1ms.`,
      );
    }

    const zeroStartOutputPath = path.join(outputDirectory, 'zero-start.mp4');
    const zeroStartMux = await adapter.muxSingleAudio({
      videoPath: sourceVideoPath,
      audioPath: sourceAudioPath,
      startMs: 0,
      outputPath: zeroStartOutputPath,
      overwrite: true,
    });
    const zeroStartProbe = await adapter.probeVideo(zeroStartOutputPath);
    adapter.assertMuxProbeMatches(zeroStartProbe, {
      videoCodecName: 'h264',
      pixelFormat: 'yuv420p',
      width: 1_920,
      height: 1_080,
      fps: 24,
      audioCodecName: 'aac',
      audioSampleRate: 48_000,
      audioChannels: 1,
      videoDurationSeconds: VIDEO_DURATION_SECONDS,
      audioDurationSeconds: AUDIO_DURATION_SECONDS,
      formatDurationSeconds: VIDEO_DURATION_SECONDS,
      durationToleranceSeconds: 0.05,
    });
    const zeroStartTiming = await adapter.analyzeAudioTiming(zeroStartOutputPath);
    if (zeroStartTiming.leadingSilenceEndSeconds > TIMING_TOLERANCE_SECONDS) {
      throw new Error(
        `startMs=0 unexpectedly delayed audio to ${zeroStartTiming.leadingSilenceEndSeconds}s.`,
      );
    }

    const missingAudio = await expectAdapterError(
      () =>
        adapter.muxSingleAudio({
          videoPath: sourceVideoPath,
          audioPath: path.join(verificationRoot, '缺失音频.wav'),
          startMs: AUDIO_START_MS,
          outputPath: path.join(outputDirectory, 'missing-audio.mp4'),
        }),
      'AUDIO_INPUT_INVALID',
    );
    const missingVideo = await expectAdapterError(
      () =>
        adapter.muxSingleAudio({
          videoPath: path.join(verificationRoot, 'missing-video.mp4'),
          audioPath: sourceAudioPath,
          startMs: AUDIO_START_MS,
          outputPath: path.join(outputDirectory, 'missing-video.mp4'),
        }),
      'VIDEO_INPUT_INVALID',
    );
    const corruptAudioPath = path.join(verificationRoot, '损坏 audio.wav');
    await fs.writeFile(corruptAudioPath, 'this is not a WAV file', 'utf8');
    const corruptAudio = await expectAdapterError(
      () =>
        adapter.muxSingleAudio({
          videoPath: sourceVideoPath,
          audioPath: corruptAudioPath,
          startMs: AUDIO_START_MS,
          outputPath: path.join(outputDirectory, 'corrupt-audio.mp4'),
        }),
      'AUDIO_INPUT_INVALID',
    );
    const outputParentFile = path.join(verificationRoot, 'not a directory.txt');
    await fs.writeFile(outputParentFile, 'controlled failure', 'utf8');
    const unwritableOutput = await expectAdapterError(
      () =>
        adapter.muxSingleAudio({
          videoPath: sourceVideoPath,
          audioPath: sourceAudioPath,
          startMs: AUDIO_START_MS,
          outputPath: path.join(outputParentFile, 'output.mp4'),
        }),
      'OUTPUT_NOT_WRITABLE',
    );

    const recoveryOutputPath = path.join(outputDirectory, 'recovered.mp4');
    await adapter.muxSingleAudio({
      videoPath: sourceVideoPath,
      audioPath: sourceAudioPath,
      startMs: AUDIO_START_MS,
      outputPath: recoveryOutputPath,
      overwrite: true,
    });
    const recoveryProbe = await adapter.probeVideo(recoveryOutputPath);
    if (recoveryProbe.audioCodecName !== 'aac') {
      throw new Error('A valid mux did not recover after the corrupt WAV failure.');
    }

    await fs.copyFile(repeated[0].outputPath, evidenceVideoPath);
    const playback = await verifyChromiumPlayback(
      evidenceVideoPath,
      evidenceScreenshotPath,
    );
    if (
      playback.midpoint.videoWidth !== 1_920 ||
      playback.midpoint.videoHeight !== 1_080 ||
      playback.midpoint.muted ||
      !playback.ending.ended ||
      Math.abs(playback.ending.duration - 3.4) > 0.08
    ) {
      throw new Error(`Chromium playback mismatch: ${JSON.stringify(playback)}`);
    }

    const replacements = [
      [verificationRoot, '<verification-root>'],
      [sourceVideoPath, '<day-07-silent-video>'],
      [sourceAudioPath, '<probe-wav>'],
      [ffmpegPath, '<ffmpeg-path>'],
      [ffprobePath, '<ffprobe-path>'],
      [evidenceVideoPath, '<evidence-video>'],
    ];
    const summarizeProbe = (probe) => ({
      videoCodecName: probe.codecName,
      pixelFormat: probe.pixelFormat,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      frameCount: probe.frameCount,
      videoDurationSeconds: probe.durationSeconds,
      audioCodecName: probe.audioCodecName,
      audioSampleRate: probe.audioSampleRate,
      audioChannels: probe.audioChannels,
      audioStartSeconds: probe.audioStartSeconds,
      audioDurationSeconds: probe.audioDurationSeconds,
      formatDurationSeconds: probe.formatDurationSeconds,
    });
    const result = {
      source: {
        video: summarizeProbe(sourceVideoProbe),
        audio: {
          codecName: sourceAudioProbe.codecName,
          sampleRate: sourceAudioProbe.sampleRate,
          channels: sourceAudioProbe.channels,
          durationSeconds: sourceAudioProbe.durationSeconds,
          origin: 'Repository-generated PCM16 probe WAV; see scripts/generate-probe-audio.cjs.',
        },
      },
      ffmpeg: {
        versionLine: validation.versionLine,
        hasAac: validation.hasAac,
        executable: '<ffmpeg-path>',
      },
      delayedStartMs: AUDIO_START_MS,
      repeats: repeated.map((entry) => ({
        index: entry.index,
        elapsedMs: entry.muxed.elapsedMs,
        args: entry.muxed.args.map((argument) =>
          redact(argument, replacements),
        ),
        probe: summarizeProbe(entry.probe),
        leadingSilenceEndSeconds: entry.timing.leadingSilenceEndSeconds,
        outputBytes: entry.outputBytes,
        sha256: entry.sha256,
      })),
      onsetSpreadSeconds,
      zeroStart: {
        args: zeroStartMux.args.map((argument) =>
          redact(argument, replacements),
        ),
        probe: summarizeProbe(zeroStartProbe),
        leadingSilenceEndSeconds: zeroStartTiming.leadingSilenceEndSeconds,
      },
      playback,
      negativePaths: {
        missingAudio,
        corruptAudio,
        missingVideo,
        unwritableOutput,
        recoveredAfterFailure: recoveryProbe.audioCodecName === 'aac',
      },
    };
    const evidenceProbe = await adapter.probeVideo(evidenceVideoPath);
    const rawProbe = evidenceProbe.raw ?? {};
    const sanitizedRawProbe = JSON.stringify(
      {
        ...rawProbe,
        format: {
          ...(rawProbe.format ?? {}),
          filename: '<evidence-video>',
        },
      },
      null,
      2,
    );
    await fs.writeFile(
      path.join(evidenceDirectory, 'ffprobe.json'),
      `${sanitizedRawProbe}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await fs.rm(verificationRoot, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (BrowserWindow.getAllWindows().length !== 0) {
    throw new Error('Day 08 verification left BrowserWindows open.');
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
