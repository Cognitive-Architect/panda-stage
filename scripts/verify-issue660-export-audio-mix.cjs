const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildExportAudioMixPlan } = require('../dist-electron/domain/export-audio-mix-plan');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter');

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(executable)} exited ${code}: ${output.stderr}`));
    });
  });
}

async function createSine(ffmpegPath, outputPath, frequency, durationSeconds) {
  await run(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:sample_rate=48000:duration=${durationSeconds}`,
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
}

function decodeMonoPcm(ffmpegPath, inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      'f32le',
      'pipe:1',
    ], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new Error(
          `${path.basename(ffmpegPath)} PCM decode exited ${code ?? signal}: ${Buffer.concat(stderr).toString('utf8')}`,
        ));
      }
    });
  });
}

function sineAmplitude(pcm, frequency, startSeconds, durationSeconds) {
  const sampleRate = 48_000;
  const firstSample = Math.floor(startSeconds * sampleRate);
  const endSample = Math.floor((startSeconds + durationSeconds) * sampleRate);
  if (endSample * 4 > pcm.length || endSample <= firstSample) {
    throw new Error('Requested PCM measurement window is outside the decoded audio.');
  }
  let cosine = 0;
  let sine = 0;
  const count = endSample - firstSample;
  for (let index = firstSample; index < endSample; index += 1) {
    const sample = pcm.readFloatLE(index * 4);
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    cosine += sample * Math.cos(phase);
    sine += sample * Math.sin(phase);
  }
  return (2 * Math.hypot(cosine, sine)) / count;
}

function segmentRms(pcm, startSeconds, durationSeconds) {
  const sampleRate = 48_000;
  const firstSample = Math.floor(startSeconds * sampleRate);
  const endSample = Math.floor((startSeconds + durationSeconds) * sampleRate);
  if (endSample * 4 > pcm.length || endSample <= firstSample) {
    throw new Error('Requested PCM RMS window is outside the decoded audio.');
  }
  let sumSquares = 0;
  for (let index = firstSample; index < endSample; index += 1) {
    const sample = pcm.readFloatLE(index * 4);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / (endSample - firstSample));
}

function assertNear(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} was ${actual}; expected ${expected} ± ${tolerance}.`);
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const ffmpegPath = process.env.PANDA_STAGE_FFMPEG_PATH || path.join(
    root,
    'node_modules',
    '@ffmpeg-installer',
    'win32-x64',
    'ffmpeg.exe',
  );
  const ffprobePath = process.env.PANDA_STAGE_FFPROBE_PATH || path.join(
    root,
    'node_modules',
    '@ffprobe-installer',
    'win32-x64',
    'ffprobe.exe',
  );
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-issue660-mix-'),
  );

  try {
    const videoPath = path.join(temporaryRoot, 'silent-video.mp4');
    const dialoguePath = path.join(temporaryRoot, 'dialogue.wav');
    const bgmPath = path.join(temporaryRoot, 'bgm.wav');
    const firstSfxPath = path.join(temporaryRoot, 'sfx-one.wav');
    const secondSfxPath = path.join(temporaryRoot, 'sfx-two.wav');
    const outputPath = path.join(temporaryRoot, 'mixed-output.mp4');
    await run(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1920x1080:r=24:d=6.5',
      '-frames:v',
      '156',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    await Promise.all([
      createSine(ffmpegPath, dialoguePath, 440, 6),
      createSine(ffmpegPath, bgmPath, 220, 7),
      createSine(ffmpegPath, firstSfxPath, 880, 3),
      createSine(ffmpegPath, secondSfxPath, 1_320, 3),
    ]);

    const gainSweep = [0, 0.5, 1, 1.5, 2];
    const audioMixPlan = buildExportAudioMixPlan(6_500, [
      ...gainSweep.map((volume, index) => ({
        clipId: `70000000-0000-4000-8000-00000000066${index}`,
        assetId: '10000000-0000-4000-8000-000000000660',
        role: 'dialogue',
        sourcePath: dialoguePath,
        startMs: index * 1_000,
        endMs: (index + 1) * 1_000,
        offsetMs: index * 100,
        volume,
      })),
      {
        clipId: '70000000-0000-4000-8000-000000000665',
        assetId: '10000000-0000-4000-8000-000000000661',
        role: 'bgm',
        sourcePath: bgmPath,
        startMs: 200,
        endMs: 4_500,
        offsetMs: 100,
        volume: 0.5,
      },
      {
        clipId: '70000000-0000-4000-8000-000000000666',
        assetId: '10000000-0000-4000-8000-000000000661',
        role: 'bgm',
        sourcePath: bgmPath,
        startMs: 6_000,
        endMs: 6_500,
        offsetMs: 4_400,
        volume: 0.5,
      },
      {
        clipId: '70000000-0000-4000-8000-000000000667',
        assetId: '10000000-0000-4000-8000-000000000662',
        role: 'sfx',
        sourcePath: firstSfxPath,
        startMs: 1_500,
        endMs: 2_500,
        offsetMs: 250,
        volume: 1.5,
      },
      {
        clipId: '70000000-0000-4000-8000-000000000668',
        assetId: '10000000-0000-4000-8000-000000000663',
        role: 'sfx',
        sourcePath: secondSfxPath,
        startMs: 2_000,
        endMs: 3_000,
        offsetMs: 500,
        volume: 2,
      },
    ]);
    if (audioMixPlan.clips.length !== 9) {
      throw new Error(`Expected nine audio clips, got ${audioMixPlan.clips.length}.`);
    }
    let invalidGainRejected = false;
    try {
      buildExportAudioMixPlan(6_500, [{
        clipId: '70000000-0000-4000-8000-000000000699',
        assetId: '10000000-0000-4000-8000-000000000663',
        role: 'sfx',
        sourcePath: firstSfxPath,
        startMs: 0,
        endMs: 500,
        offsetMs: 0,
        volume: 2.01,
      }]);
    } catch {
      invalidGainRejected = true;
    }
    if (!invalidGainRejected) throw new Error('Gain above 2 was not rejected.');
    const adapter = new FFmpegAdapter({ ffmpegPath, ffprobePath });
    await adapter.muxAudioMix({ videoPath, audioMixPlan, outputPath });

    const probe = await adapter.probeVideo(outputPath);
    const streams = probe.raw.streams;
    const audioStreams = streams.filter(
      (stream) => stream.codec_type === 'audio',
    );
    if (!probe.hasAudio || audioStreams.length !== 1) {
      throw new Error(`Expected one final audio stream, got ${audioStreams.length}.`);
    }
    if (
      probe.audioStreamCount !== 1 ||
      probe.audioCodecName !== 'aac' ||
      probe.audioSampleRate !== 48_000 ||
      !probe.audioChannels ||
      probe.audioChannels < 1
    ) {
      throw new Error(`Audio parameters did not match AAC single-track output: ${JSON.stringify({
        streamCount: probe.audioStreamCount,
        codec: probe.audioCodecName,
        sampleRate: probe.audioSampleRate,
        channels: probe.audioChannels,
      })}`);
    }
    if (
      probe.codecName !== 'h264' ||
      probe.pixelFormat !== 'yuv420p' ||
      probe.width !== 1_920 ||
      probe.height !== 1_080 ||
      probe.fps !== 24 ||
      probe.frameCount !== 156
    ) {
      throw new Error(`Video parameters did not survive mux: ${JSON.stringify({
        codec: probe.codecName,
        pixelFormat: probe.pixelFormat,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        frameCount: probe.frameCount,
      })}`);
    }
    if (Math.abs(probe.durationSeconds - 6.5) > 0.05) {
      throw new Error(`Mixed video duration was ${probe.durationSeconds}s.`);
    }
    if (
      probe.audioDurationSeconds === null ||
      Math.abs(probe.audioDurationSeconds - 6.5) > 0.08
    ) {
      throw new Error(`Mixed audio duration was ${probe.audioDurationSeconds}s.`);
    }

    const pcm = await decodeMonoPcm(ffmpegPath, outputPath);
    if (pcm.length % 4 !== 0) throw new Error('Decoded PCM is not float32-aligned.');
    const measuredGains = gainSweep.map((volume, index) => {
      const measuredAmplitude = sineAmplitude(pcm, 440, index, 1);
      assertNear(
        measuredAmplitude,
        0.125 * volume,
        0.012,
        `Dialogue gain ${volume} amplitude`,
      );
      return { volume, measuredAmplitude };
    });
    const sfxLevels = {
      firstOnly: sineAmplitude(pcm, 880, 1.6, 0.4),
      firstDuringOverlap: sineAmplitude(pcm, 880, 2.1, 0.4),
      secondDuringOverlap: sineAmplitude(pcm, 1_320, 2.1, 0.4),
      secondOnly: sineAmplitude(pcm, 1_320, 2.6, 0.4),
    };
    assertNear(sfxLevels.firstOnly, 0.125 * 1.5, 0.015, 'First SFX level');
    assertNear(sfxLevels.firstDuringOverlap, 0.125 * 1.5, 0.015, 'First SFX overlap level');
    assertNear(sfxLevels.secondDuringOverlap, 0.125 * 2, 0.015, 'Second SFX overlap level');
    assertNear(sfxLevels.secondOnly, 0.125 * 2, 0.015, 'Second SFX level');
    const silentGapRms = segmentRms(pcm, 5.2, 0.6);
    if (silentGapRms > 0.003) {
      throw new Error(`Expected a silent timeline gap; measured RMS ${silentGapRms}.`);
    }

    const invalidRangePath = path.join(temporaryRoot, 'invalid-range.mp4');
    let sourceRangeError = null;
    try {
      await adapter.muxAudioMix({
        videoPath,
        outputPath: invalidRangePath,
        audioMixPlan: {
          durationMs: 6_500,
          clips: [{
            clipId: '70000000-0000-4000-8000-000000000669',
            assetId: '10000000-0000-4000-8000-000000000661',
            role: 'bgm',
            sourcePath: bgmPath,
            startMs: 6_000,
            endMs: 6_500,
            sourceOffsetMs: 7_000,
            volume: 1,
          }],
        },
      });
    } catch (error) {
      sourceRangeError = error?.code ?? null;
    }
    if (sourceRangeError !== 'AUDIO_INPUT_INVALID') {
      throw new Error(`Expected source-range BLOCK, got ${sourceRangeError ?? 'no error'}.`);
    }
    if (await fs.stat(invalidRangePath).then(() => true, () => false)) {
      throw new Error('Out-of-range source unexpectedly created an MP4.');
    }

    const timing = await adapter.analyzeAudioTiming(outputPath);
    if (Math.abs(timing.leadingSilenceEndSeconds - 0.2) > 0.04) {
      throw new Error(
        `Mixed audio began at ${timing.leadingSilenceEndSeconds}s instead of 0.2s.`,
      );
    }
    console.log(JSON.stringify({
      status: 'PASS',
      clipCount: audioMixPlan.clips.length,
      roles: [...new Set(audioMixPlan.clips.map((clip) => clip.role))],
      overlappingSfxMs: 500,
      gainSweep: measuredGains,
      sfxLevels,
      silentGapRms,
      invalidGainRejected,
      audioStreams: audioStreams.length,
      videoDurationSeconds: probe.durationSeconds,
      audioDurationSeconds: probe.audioDurationSeconds,
      leadingSilenceEndSeconds: timing.leadingSilenceEndSeconds,
      invalidSourceRange: sourceRangeError,
    }, null, 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
