const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const fixtureRoot = path.resolve(
  process.env.PANDA_STAGE_O1_FIXTURE_ROOT ||
    'D:\\PandaStage-Acceptance\\issue848-o1',
);
const fixtureProjectRoot = path.join(fixtureRoot, 'project');
const OUTPUT_PATH = path.resolve(
  process.env.PANDA_STAGE_O1_COMPARISON_RECEIPT ||
    path.join(fixtureRoot, 'comparison-receipt.json'),
);
const LEGACY_RUN_NAME = process.env.PANDA_STAGE_O1_LEGACY_RUN_ID || 'legacy-raf';
const SYNC_RUN_NAME = process.env.PANDA_STAGE_O1_SYNC_RUN_ID || 'explicit-sync';
const EXPECTED_FRAME_COUNT = 108;
const EXPECTED_DURATION_SECONDS = 4.5;
const EXPECTED_FPS = 24;
const EXPECTED_WIDTH = 1_920;
const EXPECTED_HEIGHT = 1_080;
const EXPECTED_SAMPLE_RATE = 48_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function runBinary(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = Buffer.concat(stdout);
      const errors = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(`${path.basename(executable)} exited ${code ?? signal}: ${errors}`));
        return;
      }
      resolve({ output, stderr: errors });
    });
  });
}

function parseRational(value) {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }
  return numerator / denominator;
}

function parseFrameMd5(output) {
  return output
    .toString('utf8')
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1).trim());
}

async function probeOutput(ffprobePath, outputPath) {
  const { output } = await runBinary(ffprobePath, [
    '-v', 'error',
    '-count_frames',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    outputPath,
  ]);
  return JSON.parse(output.toString('utf8'));
}

function validateProbe(probe, label) {
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  assert(video, `${label}: MP4 is missing a video stream.`);
  assert(video.codec_name === 'h264', `${label}: expected H.264, got ${video.codec_name}.`);
  assert(video.pix_fmt === 'yuv420p', `${label}: expected yuv420p, got ${video.pix_fmt}.`);
  assert(video.width === EXPECTED_WIDTH && video.height === EXPECTED_HEIGHT,
    `${label}: expected 1920x1080, got ${video.width}x${video.height}.`);
  assert(Math.abs(parseRational(video.avg_frame_rate ?? video.r_frame_rate) - EXPECTED_FPS) < 0.001,
    `${label}: expected 24 fps, got ${video.avg_frame_rate ?? video.r_frame_rate}.`);
  assert(Number(video.nb_read_frames ?? video.nb_frames) === EXPECTED_FRAME_COUNT,
    `${label}: expected 108 video frames, got ${video.nb_read_frames ?? video.nb_frames}.`);
  const videoDuration = Number(video.duration ?? probe.format?.duration);
  assert(Number.isFinite(videoDuration) && Math.abs(videoDuration - EXPECTED_DURATION_SECONDS) <= 0.08,
    `${label}: expected 4.5 seconds, got ${videoDuration}.`);
  assert(audioStreams.length === 1, `${label}: expected exactly one audio stream, got ${audioStreams.length}.`);
  const audio = audioStreams[0];
  assert(audio.codec_name === 'aac', `${label}: expected AAC, got ${audio.codec_name}.`);
  assert(Number(audio.sample_rate) === EXPECTED_SAMPLE_RATE,
    `${label}: expected 48 kHz audio, got ${audio.sample_rate}.`);
  assert(Number.isInteger(Number(audio.channels)) && Number(audio.channels) > 0,
    `${label}: audio channel count is invalid.`);
  return { video, audio, videoDuration };
}

async function decodedFrameHashes(ffmpegPath, framesRoot) {
  const inputPattern = path.join(framesRoot, 'frame_%06d.png');
  const { output } = await runBinary(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2',
    '-framerate', String(EXPECTED_FPS),
    '-start_number', '0',
    '-i', inputPattern,
    '-frames:v', String(EXPECTED_FRAME_COUNT),
    '-pix_fmt', 'rgba',
    '-f', 'framemd5',
    'pipe:1',
  ]);
  const hashes = parseFrameMd5(output);
  assert(hashes.length === EXPECTED_FRAME_COUNT,
    `Expected 108 decoded PNG frame hashes at ${framesRoot}, got ${hashes.length}.`);
  return hashes;
}

async function decodedPcm(ffmpegPath, outputPath, channels) {
  const { output } = await runBinary(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', outputPath,
    '-map', '0:a:0',
    '-vn',
    '-t', String(EXPECTED_DURATION_SECONDS),
    '-ar', String(EXPECTED_SAMPLE_RATE),
    '-ac', String(channels),
    '-c:a', 'pcm_s32le',
    '-f', 's32le',
    'pipe:1',
  ]);
  const expectedBytes = EXPECTED_SAMPLE_RATE * EXPECTED_DURATION_SECONDS * channels * 4;
  assert(output.byteLength === expectedBytes,
    `Decoded PCM length is ${output.byteLength} bytes; expected ${expectedBytes}.`);
  return output;
}

function summarizeExportPhases(updates) {
  const sorted = [...updates].sort((left, right) => left.at - right.at);
  if (sorted.length === 0) return { eventWallMs: null, durationsMs: {} };
  const durationsMs = {};
  let phase = sorted[0].phase;
  let phaseStartedAt = sorted[0].at;
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current.phase === phase) continue;
    durationsMs[phase] = (durationsMs[phase] ?? 0) + current.at - phaseStartedAt;
    phase = current.phase;
    phaseStartedAt = current.at;
  }
  const last = sorted.at(-1);
  durationsMs[phase] = (durationsMs[phase] ?? 0) + last.at - phaseStartedAt;
  return {
    eventWallMs: last.at - sorted[0].at,
    durationsMs,
    sampleCount: sorted.length,
  };
}

async function readReceipt(mode, runName) {
  const receiptPath = path.join(fixtureRoot, 'runs', runName, 'receipt.json');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert(receipt.status === 'PASS', `${mode}: verifier receipt status is ${receipt.status}.`);
  assert(receipt.drawMode === mode, `${mode}: receipt used draw mode ${receipt.drawMode}.`);
  assert(receipt.runName === runName, `${mode}: expected run ${runName}, got ${receipt.runName}.`);
  assert(receipt.frameCount === EXPECTED_FRAME_COUNT, `${mode}: receipt did not complete 108 frames.`);
  assert(receipt.projectInputUnchanged === true, `${mode}: project or source media changed during export.`);
  assert(receipt.cleanup?.frameJobDirectoriesRemoved === true, `${mode}: temporary frame jobs were not cleaned.`);
  assert(receipt.cleanup?.frozenMediaCandidateRemoved === true, `${mode}: frozen media was not cleaned.`);
  assert(receipt.cleanup?.outputStagingFilesRemoved === true, `${mode}: output staging files were not cleaned.`);
  assert(receipt.cleanup?.hiddenRenderWindowClosed === true, `${mode}: hidden render window remained open.`);
  assert(receipt.cleanup?.noClobberRejected === true, `${mode}: no-clobber check did not reject an existing target.`);
  assert(receipt.cleanup?.outputUnchangedAfterNoClobber === true, `${mode}: no-clobber check changed output bytes.`);
  assert(receipt.cleanup?.cancelledJobAccepted === true, `${mode}: active formal Job cancellation was not accepted.`);
  assert(receipt.cleanup?.cancelledJobStatus === 'cancelled', `${mode}: cancellation Job did not reach cancelled status.`);
  assert(receipt.cleanup?.cancelledOutputAbsent === true, `${mode}: cancellation produced a final output.`);
  assert(receipt.cleanup?.cancellationElapsedMs < 30_000, `${mode}: cancellation exceeded 30 seconds.`);
  assert(receipt.frozenCandidate?.mediaManifest?.length === 6, `${mode}: expected six frozen media assets.`);
  assert(receipt.cameraMode === 'speaker-focus', `${mode}: camera mode was ${receipt.cameraMode}.`);
  assert(receipt.probe?.codecName === 'h264', `${mode}: ExportService probe did not report H.264.`);
  assert(receipt.probe?.pixelFormat === 'yuv420p', `${mode}: ExportService probe did not report yuv420p.`);
  assert(receipt.probe?.fps === EXPECTED_FPS, `${mode}: ExportService probe did not report 24 fps.`);
  assert(receipt.probe?.frameCount === EXPECTED_FRAME_COUNT, `${mode}: ExportService probe did not report 108 frames.`);
  assert(receipt.probe?.hasAudio === true && receipt.probe?.audioCodecName === 'aac', `${mode}: ExportService probe did not report AAC audio.`);
  assert(receipt.probe?.audioSampleRate === EXPECTED_SAMPLE_RATE, `${mode}: ExportService probe did not report 48 kHz audio.`);
  assert(receipt.probe?.audioDurationSeconds !== null &&
    Math.abs(receipt.probe.audioDurationSeconds - EXPECTED_DURATION_SECONDS) <= 0.08,
  `${mode}: ExportService probe reported a misaligned audio duration.`);
  assert(receipt.exportServiceElapsedMs <= 300_000, `${mode}: formal Job exceeded five minutes.`);
  assert(receipt.frameHashes.length === EXPECTED_FRAME_COUNT, `${mode}: frame receipt is incomplete.`);
  assert(receipt.frameHashes.every((frame, index) => frame.frameIndex === index),
    `${mode}: frame receipt is missing, duplicating, or reordering an index.`);
  assert(receipt.hiddenFrameTimings.length === EXPECTED_FRAME_COUNT,
    `${mode}: hidden renderer timing receipt is incomplete.`);
  assert(receipt.hiddenFrameTimings.every((frame, index) =>
    frame.frameIndex === index && frame.captureStrategy === 'drawn-output-layer'),
  `${mode}: timing evidence did not capture the already drawn single output layer.`);
  assert(receipt.hiddenRendererStages.readyGateMs.count === EXPECTED_FRAME_COUNT,
    `${mode}: readiness timing sample is incomplete.`);
  assert(receipt.hiddenRendererStages.requestToPngMs.count === EXPECTED_FRAME_COUNT,
    `${mode}: request-to-PNG timing sample is incomplete.`);
  if (mode === 'explicit-sync') {
    assert(receipt.hiddenRendererStages.synchronousDrawMs.count === EXPECTED_FRAME_COUNT,
      `${mode}: synchronous draw timing sample is incomplete.`);
  }
  assert(receipt.selectedJobModes?.some((entry) => entry.jobId === receipt.jobId && entry.drawMode === mode),
    `${mode}: the primary formal Job did not record its actual selected draw mode.`);
  return receipt;
}

async function main() {
  const legacy = await readReceipt('legacy-raf', LEGACY_RUN_NAME);
  const sync = await readReceipt('explicit-sync', SYNC_RUN_NAME);
  const fixture = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture-manifest.json'), 'utf8'));
  const project = JSON.parse(await fs.readFile(path.join(fixtureProjectRoot, 'project.json'), 'utf8'));
  assert(fixture.sample.durationMs === EXPECTED_DURATION_SECONDS * 1_000,
    `Fixture duration is ${fixture.sample.durationMs} ms.`);
  assert(fixture.sample.shotCount === 3 && project.shots.length === 3,
    'The comparison fixture must contain three shots.');
  assert(fixture.sample.expectedFrames === EXPECTED_FRAME_COUNT && fixture.sample.fps === EXPECTED_FPS,
    'Fixture manifest does not describe the expected 108-frame schedule.');
  assert(project.width === EXPECTED_WIDTH && project.height === EXPECTED_HEIGHT && project.fps === EXPECTED_FPS,
    'Fixture render dimensions or frame rate drifted.');
  assert(project.characters.some((character) => character.mode === 'composite' && character.mouthOpenAssetId),
    'Fixture no longer exercises a composite character and mouth asset.');
  assert(project.shots.every((shot) => shot.dialogues.length > 0 && shot.audioClips.length > 0),
    'Fixture no longer exercises dialogue audio and subtitles in every shot.');
  assert(project.shots.every((shot) => shot.timelineEvents.some((event) => event.type === 'move') &&
    shot.timelineEvents.some((event) => event.type === 'opacity') &&
    shot.timelineEvents.some((event) => event.type === 'expression')),
  'Fixture no longer exercises movement, opacity, and expression changes in every shot.');

  const stableInputs = (receipt) => ({
    projectInputBefore: receipt.projectInputBefore,
    projectInputAfter: receipt.projectInputAfter,
    frozenInputSha256: receipt.frozenCandidate.frozenInputSha256,
    mediaManifest: receipt.frozenCandidate.mediaManifest,
    cameraMode: receipt.cameraMode,
    renderSettings: receipt.renderSettings,
    fontFiles: receipt.fontFiles,
  });
  assert(stableJson(stableInputs(legacy)) === stableJson(stableInputs(sync)),
    'A/B runs did not use identical frozen Project, media, font, camera, and render inputs.');
  assert(legacy.projectInputBefore.projectFileSha256 === sync.projectInputBefore.projectFileSha256,
    'Project file hash differs between the A/B runs.');
  assert(legacy.outputPath !== sync.outputPath, 'A/B runs must write to separate formal output paths.');

  const ffmpegPath = legacy.mediaTools?.ffmpegPath;
  const ffprobePath = legacy.mediaTools?.ffprobePath;
  assert(ffmpegPath && ffprobePath, 'FFmpeg tool paths are missing from the formal receipts.');
  assert(stableJson(legacy.mediaTools) === stableJson(sync.mediaTools), 'A/B runs used different media tools.');
  const legacyRawProbe = await probeOutput(ffprobePath, legacy.outputPath);
  const syncRawProbe = await probeOutput(ffprobePath, sync.outputPath);
  const legacyProbe = validateProbe(legacyRawProbe, 'legacy-raf');
  const syncProbe = validateProbe(syncRawProbe, 'explicit-sync');
  assert(legacyProbe.audio.channels === syncProbe.audio.channels,
    'A/B outputs contain different audio channel counts.');

  const legacyFrames = await decodedFrameHashes(ffmpegPath, legacy.frameDirectory);
  const syncFrames = await decodedFrameHashes(ffmpegPath, sync.frameDirectory);
  const frameMismatches = [];
  for (let index = 0; index < EXPECTED_FRAME_COUNT; index += 1) {
    if (legacyFrames[index] !== syncFrames[index]) {
      frameMismatches.push({ frameIndex: index, legacyHash: legacyFrames[index], syncHash: syncFrames[index] });
    }
  }
  assert(frameMismatches.length === 0,
    `Decoded Stage pixels differ at ${frameMismatches.length} frames; first mismatch ${frameMismatches[0]?.frameIndex}.`);
  const distinctShotIds = [...new Set(legacy.frameHashes.map((frame) => frame.shotId))];
  assert(distinctShotIds.length === 3, `Expected rendered frames from three shots, got ${distinctShotIds.length}.`);

  const channels = legacyProbe.audio.channels;
  const legacyPcm = await decodedPcm(ffmpegPath, legacy.outputPath, channels);
  const syncPcm = await decodedPcm(ffmpegPath, sync.outputPath, channels);
  const pcmHashes = { legacyRaf: sha256(legacyPcm), explicitSync: sha256(syncPcm) };
  assert(legacyPcm.equals(syncPcm), 'Decoded 48 kHz PCM differs between the A/B MP4 outputs.');

  const legacyJobMs = legacy.exportServiceElapsedMs;
  const syncJobMs = sync.exportServiceElapsedMs;
  const savedMs = legacyJobMs - syncJobMs;
  const savedPercent = legacyJobMs > 0 ? savedMs / legacyJobMs * 100 : Number.NaN;
  const performanceDecision = savedPercent < 10
    ? 'ROLLBACK_BELOW_10_PERCENT'
    : savedPercent < 50
      ? 'PARTIAL_OWNER_DECISION'
      : 'MEETS_50_PERCENT_TARGET';
  const legacyReadyGateMedian = legacy.hiddenRendererStages.readyGateMs.medianMs;
  const syncReadyGateMedian = sync.hiddenRendererStages.readyGateMs.medianMs;
  const readyGateSavedPercent = Number.isFinite(legacyReadyGateMedian) && legacyReadyGateMedian > 0
    ? Math.round((legacyReadyGateMedian - syncReadyGateMedian) / legacyReadyGateMedian * 10_000) / 100
    : null;
  const result = {
    status: 'PASS',
    issue: 848,
    fixtureRoot,
    runs: {
      legacyRaf: { name: LEGACY_RUN_NAME, jobId: legacy.jobId, drawMode: legacy.drawMode },
      explicitSync: { name: SYNC_RUN_NAME, jobId: sync.jobId, drawMode: sync.drawMode },
    },
    inputsIdentical: true,
    inputs: {
      projectFileSha256: legacy.projectInputBefore.projectFileSha256,
      projectSnapshotSha256: legacy.frozenCandidate.projectSha256,
      frozenCandidateSha256: legacy.frozenCandidate.frozenInputSha256,
      revision: legacy.frozenCandidate.revision,
      dirtyAtCapture: legacy.frozenCandidate.dirtyAtCapture,
      cameraMode: legacy.cameraMode,
      renderSettings: legacy.renderSettings,
      mediaManifest: legacy.frozenCandidate.mediaManifest,
      fontFiles: legacy.fontFiles,
      projectInputUnchanged: {
        legacyRaf: legacy.projectInputUnchanged,
        explicitSync: sync.projectInputUnchanged,
      },
    },
    frameCount: EXPECTED_FRAME_COUNT,
    decodedFramePixelHashesIdentical: true,
    decodedFrameHashes: { legacyRaf: legacyFrames, explicitSync: syncFrames },
    frameMismatchCount: frameMismatches.length,
    mp4: {
      legacyRaf: {
        path: legacy.outputPath,
        videoCodec: legacyProbe.video.codec_name,
        pixelFormat: legacyProbe.video.pix_fmt,
        dimensions: `${legacyProbe.video.width}x${legacyProbe.video.height}`,
        fps: parseRational(legacyProbe.video.avg_frame_rate ?? legacyProbe.video.r_frame_rate),
        frameCount: Number(legacyProbe.video.nb_read_frames ?? legacyProbe.video.nb_frames),
        durationSeconds: legacyProbe.videoDuration,
        audioCodec: legacyProbe.audio.codec_name,
        audioSampleRate: Number(legacyProbe.audio.sample_rate),
        audioChannels: channels,
      },
      explicitSync: {
        path: sync.outputPath,
        videoCodec: syncProbe.video.codec_name,
        pixelFormat: syncProbe.video.pix_fmt,
        dimensions: `${syncProbe.video.width}x${syncProbe.video.height}`,
        fps: parseRational(syncProbe.video.avg_frame_rate ?? syncProbe.video.r_frame_rate),
        frameCount: Number(syncProbe.video.nb_read_frames ?? syncProbe.video.nb_frames),
        durationSeconds: syncProbe.videoDuration,
        audioCodec: syncProbe.audio.codec_name,
        audioSampleRate: Number(syncProbe.audio.sample_rate),
        audioChannels: Number(syncProbe.audio.channels),
      },
    },
    decodedPcm: {
      sampleRate: EXPECTED_SAMPLE_RATE,
      channels,
      bytesPerSample: 4,
      sampleCountPerChannel: EXPECTED_SAMPLE_RATE * EXPECTED_DURATION_SECONDS,
      byteLength: legacyPcm.byteLength,
      identical: true,
      sha256: pcmHashes,
    },
    timing: {
      legacyRaf: {
        exportServiceElapsedMs: legacyJobMs,
        mainJobWallMs: legacy.mainJobWallMs,
        apiStartToCompleteMs: legacy.apiStartToCompleteMs ?? legacy.uiInvokeToCompleteMs,
        uiClickToCompleteMs: null,
        mainFrameReady: legacy.mainFrameReady,
        hiddenRendererStages: legacy.hiddenRendererStages,
        exportPhases: summarizeExportPhases(legacy.outputUpdates),
      },
      explicitSync: {
        exportServiceElapsedMs: syncJobMs,
        mainJobWallMs: sync.mainJobWallMs,
        apiStartToCompleteMs: sync.apiStartToCompleteMs ?? sync.uiInvokeToCompleteMs,
        uiClickToCompleteMs: null,
        mainFrameReady: sync.mainFrameReady,
        hiddenRendererStages: sync.hiddenRendererStages,
        exportPhases: summarizeExportPhases(sync.outputUpdates),
      },
      elapsedSavedMs: savedMs,
      elapsedSavedPercent: Number.isFinite(savedPercent) ? Math.round(savedPercent * 100) / 100 : null,
      faster: syncJobMs < legacyJobMs,
      meets50PercentTarget: savedPercent >= 50,
      meets30SecondJobWish: syncJobMs <= 30_000,
      legacyReadyGateMedianMs: legacyReadyGateMedian,
      explicitSyncReadyGateMedianMs: syncReadyGateMedian,
      readyGateSavedPercent,
      decision: performanceDecision,
      entryPoint: 'Formal export was initiated through the official Preload API; editor UI click latency was not measured.',
    },
    safety: {
      legacy: legacy.cleanup,
      explicitSync: sync.cleanup,
    },
    receiptHashes: {
      legacyRaf: sha256(await fs.readFile(path.join(fixtureRoot, 'runs', LEGACY_RUN_NAME, 'receipt.json'))),
      explicitSync: sha256(await fs.readFile(path.join(fixtureRoot, 'runs', SYNC_RUN_NAME, 'receipt.json'))),
    },
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: result.status,
    frameCount: result.frameCount,
    decodedFramesIdentical: result.decodedFramePixelHashesIdentical,
    pcmIdentical: result.decodedPcm.identical,
    legacyExportMs: legacyJobMs,
    explicitSyncExportMs: syncJobMs,
    savedMs,
    savedPercent: result.timing.elapsedSavedPercent,
    readyGateSavedPercent: result.timing.readyGateSavedPercent,
    meets30SecondJobWish: result.timing.meets30SecondJobWish,
    performanceDecision: result.timing.decision,
    faster: result.timing.faster,
    output: OUTPUT_PATH,
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
