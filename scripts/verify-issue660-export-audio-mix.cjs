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

async function createSine(ffmpegPath, outputPath, frequency) {
  await run(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:sample_rate=48000:duration=3`,
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
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
    const sfxPath = path.join(temporaryRoot, 'sfx.wav');
    const outputPath = path.join(temporaryRoot, 'mixed-output.mp4');
    await run(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=24:d=2',
      '-frames:v',
      '48',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    await Promise.all([
      createSine(ffmpegPath, dialoguePath, 440),
      createSine(ffmpegPath, sfxPath, 440),
    ]);

    const audioMixPlan = buildExportAudioMixPlan(2_000, [
      {
        clipId: '70000000-0000-4000-8000-000000000660',
        assetId: '10000000-0000-4000-8000-000000000660',
        role: 'dialogue',
        sourcePath: dialoguePath,
        startMs: 200,
        endMs: 1_500,
        offsetMs: 100,
        volume: 0.5,
      },
      {
        clipId: '70000000-0000-4000-8000-000000000661',
        assetId: '10000000-0000-4000-8000-000000000661',
        role: 'sfx',
        sourcePath: sfxPath,
        startMs: 500,
        endMs: 1_800,
        offsetMs: 250,
        volume: 1.8,
      },
    ]);
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
    if (Math.abs(probe.durationSeconds - 2) > 0.05) {
      throw new Error(`Mixed video duration was ${probe.durationSeconds}s.`);
    }
    if (
      probe.audioDurationSeconds === null ||
      probe.audioDurationSeconds < 1.75 ||
      probe.audioDurationSeconds > 1.9
    ) {
      throw new Error(`Mixed audio duration was ${probe.audioDurationSeconds}s.`);
    }

    const level = await run(ffmpegPath, [
      '-hide_banner',
      '-nostats',
      '-i',
      outputPath,
      '-af',
      'atrim=start=0.7:duration=0.5,volumedetect',
      '-f',
      'null',
      '-',
    ]);
    const meanVolumeMatch = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/u.exec(
      level.stderr,
    );
    const meanVolumeDb = meanVolumeMatch ? Number(meanVolumeMatch[1]) : Number.NaN;
    if (!Number.isFinite(meanVolumeDb) || meanVolumeDb < -17 || meanVolumeDb > -10) {
      throw new Error(`Overlap mean level was ${meanVolumeDb} dBFS.`);
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
      overlapMs: 1_000,
      volumeRange: audioMixPlan.clips.map((clip) => clip.volume),
      audioStreams: audioStreams.length,
      videoDurationSeconds: probe.durationSeconds,
      audioDurationSeconds: probe.audioDurationSeconds,
      overlapMeanVolumeDb: meanVolumeDb,
      leadingSilenceEndSeconds: timing.leadingSilenceEndSeconds,
    }, null, 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
