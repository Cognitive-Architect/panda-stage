const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const fixtureRoot = path.resolve(
  process.env.PANDA_STAGE_O2_FIXTURE_ROOT ||
    'D:\\PandaStage-Acceptance\\issue849-o2',
);
const fixtureProjectRoot = path.join(fixtureRoot, 'project');
const OUTPUT_PATH = path.resolve(
  process.env.PANDA_STAGE_O2_COMPARISON_RECEIPT ||
    path.join(fixtureRoot, 'comparison-receipt.json'),
);
const REPO_EVIDENCE_JSON = path.resolve(__dirname, '../docs/test-receipts/issue849-o2-comparison.json');
const REPO_EVIDENCE_MARKDOWN = path.resolve(__dirname, '../docs/test-receipts/issue849-o2.md');
const LEGACY_RUN_NAME = process.env.PANDA_STAGE_O2_LEGACY_RUN_ID || 'legacy-blob';
const WORKER_RUN_NAME = process.env.PANDA_STAGE_O2_WORKER_RUN_ID || 'worker-png';
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

function summarizeDurations(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return { count: 0, p50Ms: null, medianMs: null, p95Ms: null, maxMs: null };
  }
  const p50Ms = sorted[Math.floor((sorted.length - 1) / 2)];
  return {
    count: sorted.length,
    p50Ms,
    medianMs: p50Ms,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    maxMs: sorted.at(-1),
  };
}

async function readReceipt(mode, runName) {
  const receiptPath = path.join(fixtureRoot, 'runs', runName, 'receipt.json');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert(receipt.status === 'PASS', `${mode}: verifier receipt status is ${receipt.status}.`);
  assert(receipt.drawMode === 'explicit-sync', `${mode}: receipt used draw mode ${receipt.drawMode}.`);
  assert(receipt.pngMode === mode, `${mode}: receipt used PNG mode ${receipt.pngMode}.`);
  assert(receipt.runName === runName, `${mode}: expected run ${runName}, got ${receipt.runName}.`);
  assert(receipt.frameCount === EXPECTED_FRAME_COUNT, `${mode}: receipt did not complete 108 frames.`);
  assert(receipt.projectInputUnchanged === true, `${mode}: project or source media changed during export.`);
  assert(receipt.cleanup?.frameJobDirectoriesRemoved === true, `${mode}: temporary frame jobs were not cleaned.`);
  assert(receipt.cleanup?.frozenMediaCandidateRemoved === true, `${mode}: frozen media was not cleaned.`);
  assert(receipt.cleanup?.outputStagingFilesRemoved === true, `${mode}: output staging files were not cleaned.`);
  assert(receipt.cleanup?.hiddenRenderWindowClosed === true, `${mode}: hidden render window remained open.`);
  assert(receipt.cleanup?.primaryWorkerReleasedWithHiddenWindow === true,
    `${mode}: the primary hidden renderer did not close after the formal Job.`);
  assert(receipt.cleanup?.noClobberRejected === true, `${mode}: no-clobber check did not reject an existing target.`);
  assert(receipt.cleanup?.outputUnchangedAfterNoClobber === true, `${mode}: no-clobber check changed output bytes.`);
  assert(receipt.cleanup?.cancelledJobAccepted === true, `${mode}: active formal Job cancellation was not accepted.`);
  assert(receipt.cleanup?.cancelledJobStatus === 'cancelled', `${mode}: cancellation Job did not reach cancelled status.`);
  assert(receipt.cleanup?.cancelledOutputAbsent === true, `${mode}: cancellation produced a final output.`);
  assert(receipt.cleanup?.cancelledHiddenWindowClosed === true,
    `${mode}: cancellation left its hidden render window open.`);
  assert(receipt.cleanup?.ffmpegActiveProcessCount === 0,
    `${mode}: FFmpeg left an active child process after cleanup.`);
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
  assert(receipt.hiddenRendererMemory?.sampleCount > 0,
    `${mode}: hidden renderer memory was not sampled.`);
  assert(receipt.hiddenMemorySamplingErrors?.length === 0,
    `${mode}: hidden renderer memory sampling reported an error.`);
  assert(receipt.hiddenRendererStages.readyGateMs.count === EXPECTED_FRAME_COUNT,
    `${mode}: readiness timing sample is incomplete.`);
  assert(receipt.hiddenRendererStages.requestToPngMs.count === EXPECTED_FRAME_COUNT,
    `${mode}: request-to-PNG timing sample is incomplete.`);
  assert(receipt.hiddenRendererStages.synchronousDrawMs.count === EXPECTED_FRAME_COUNT,
    `${mode}: synchronous draw timing sample is incomplete.`);
  assert(receipt.hiddenFrameTimings.every((frame) => frame.pngMode === mode),
    `${mode}: frame timing data recorded a different PNG mode.`);
  if (mode === 'worker-png') {
    assert(receipt.workerLifecycle.filter((entry) => entry.jobId === receipt.jobId && entry.event === 'created').length === 1,
      `${mode}: the primary Job did not use exactly one Worker.`);
    assert(receipt.cleanup.cancelledJobWorkerLifecycle.filter((entry) => entry.event === 'created').length === 1,
      `${mode}: cancellation did not create exactly one Worker.`);
    assert(receipt.cleanup.cancelledWorkerStopped === true,
      `${mode}: cancellation did not stop its Worker.`);
    assert(['worker-terminated-event', 'hidden-renderer-destroyed'].includes(
      receipt.cleanup.cancelledWorkerStopEvidence,
    ), `${mode}: cancellation Worker stop evidence is missing.`);
    for (const field of [
      'pngSnapshotMs',
      'pngTransferDispatchMs',
      'workerDrawMs',
      'workerConvertToBlobMs',
      'workerArrayBufferMs',
      'workerEncodeMs',
      'workerReturnMs',
      'workerRoundTripMs',
    ]) {
      assert(receipt.hiddenRendererStages[field].count === EXPECTED_FRAME_COUNT,
        `${mode}: ${field} timing sample is incomplete.`);
    }
  }
  assert(receipt.selectedJobModes?.some((entry) =>
    entry.jobId === receipt.jobId && entry.drawMode === 'explicit-sync' && entry.pngMode === mode),
  `${mode}: the primary formal Job did not record its actual draw and PNG modes.`);
  return receipt;
}

async function main() {
  const legacy = await readReceipt('legacy-blob', LEGACY_RUN_NAME);
  const worker = await readReceipt('worker-png', WORKER_RUN_NAME);
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
  assert(stableJson(stableInputs(legacy)) === stableJson(stableInputs(worker)),
    'A/B runs did not use identical frozen Project, media, font, camera, and render inputs.');
  assert(legacy.codeSha === worker.codeSha && legacy.branch === worker.branch,
    'A/B runs were not performed from the same committed O2 source and branch.');
  assert(legacy.projectInputBefore.projectFileSha256 === worker.projectInputBefore.projectFileSha256,
    'Project file hash differs between the A/B runs.');
  assert(legacy.outputPath !== worker.outputPath, 'A/B runs must write to separate formal output paths.');

  const ffmpegPath = legacy.mediaTools?.ffmpegPath;
  const ffprobePath = legacy.mediaTools?.ffprobePath;
  assert(ffmpegPath && ffprobePath, 'FFmpeg tool paths are missing from the formal receipts.');
  assert(stableJson(legacy.mediaTools) === stableJson(worker.mediaTools), 'A/B runs used different media tools.');
  const legacyRawProbe = await probeOutput(ffprobePath, legacy.outputPath);
  const workerRawProbe = await probeOutput(ffprobePath, worker.outputPath);
  const legacyProbe = validateProbe(legacyRawProbe, 'legacy-blob');
  const workerProbe = validateProbe(workerRawProbe, 'worker-png');
  assert(legacyProbe.audio.channels === workerProbe.audio.channels,
    'A/B outputs contain different audio channel counts.');
  const legacyMp4Sha256 = sha256(await fs.readFile(legacy.outputPath));
  const workerMp4Sha256 = sha256(await fs.readFile(worker.outputPath));

  const legacyFrames = await decodedFrameHashes(ffmpegPath, legacy.frameDirectory);
  const workerFrames = await decodedFrameHashes(ffmpegPath, worker.frameDirectory);
  const frameMismatches = [];
  for (let index = 0; index < EXPECTED_FRAME_COUNT; index += 1) {
    if (legacyFrames[index] !== workerFrames[index]) {
      frameMismatches.push({ frameIndex: index, legacyHash: legacyFrames[index], workerHash: workerFrames[index] });
    }
  }
  assert(frameMismatches.length === 0,
    `Decoded Stage pixels differ at ${frameMismatches.length} frames; first mismatch ${frameMismatches[0]?.frameIndex}.`);
  const distinctShotIds = [...new Set(legacy.frameHashes.map((frame) => frame.shotId))];
  assert(distinctShotIds.length === 3, `Expected rendered frames from three shots, got ${distinctShotIds.length}.`);
  const frameIdentity = (receipt) => receipt.frameHashes.map(({ frameIndex, timeMs, shotId, shotLocalTimeMs }) =>
    ({ frameIndex, timeMs, shotId, shotLocalTimeMs }));
  assert(stableJson(frameIdentity(legacy)) === stableJson(frameIdentity(worker)),
    'A/B frame identity, order, Shot, or Shot-local timing differs.');

  const channels = legacyProbe.audio.channels;
  const legacyPcm = await decodedPcm(ffmpegPath, legacy.outputPath, channels);
  const workerPcm = await decodedPcm(ffmpegPath, worker.outputPath, channels);
  const pcmHashes = { legacyBlob: sha256(legacyPcm), workerPng: sha256(workerPcm) };
  assert(legacyPcm.equals(workerPcm), 'Decoded 48 kHz PCM differs between the A/B MP4 outputs.');

  const legacyJobMs = legacy.exportServiceElapsedMs;
  const workerJobMs = worker.exportServiceElapsedMs;
  const savedMs = legacyJobMs - workerJobMs;
  const savedPercent = legacyJobMs > 0 ? savedMs / legacyJobMs * 100 : Number.NaN;
  const legacyRequestPng = legacy.hiddenRendererStages.requestToPngMs;
  const workerRequestPng = worker.hiddenRendererStages.requestToPngMs;
  const requestPngImproved = workerRequestPng.medianMs < legacyRequestPng.medianMs &&
    workerRequestPng.p95Ms <= legacyRequestPng.p95Ms;
  const performanceDecision = savedPercent >= 10 && requestPngImproved
    ? 'O2_PASS'
    : 'ROLLBACK_NO_VALUE';
  const legacyReadyGateMedian = legacy.hiddenRendererStages.readyGateMs.medianMs;
  const workerReadyGateMedian = worker.hiddenRendererStages.readyGateMs.medianMs;
  const readyGateSavedPercent = Number.isFinite(legacyReadyGateMedian) && legacyReadyGateMedian > 0
    ? Math.round((legacyReadyGateMedian - workerReadyGateMedian) / legacyReadyGateMedian * 10_000) / 100
    : null;
  const transitionFrames = (frames) => {
    const sorted = [...frames].sort((left, right) => left.frameIndex - right.frameIndex);
    return sorted.filter((frame, index) => index > 0 && frame.shotId !== sorted[index - 1]?.shotId);
  };
  const summarizeFrameSubset = (frames) => ({
    frameIndexes: frames.map((frame) => frame.frameIndex),
    requestToPngMs: summarizeDurations(frames.map((frame) => frame.requestToPngMs).filter(Number.isFinite)),
    pngEncodeMs: summarizeDurations(frames.map((frame) => frame.pngEncodeMs).filter(Number.isFinite)),
  });
  const legacyTransitions = transitionFrames(legacy.hiddenFrameTimings);
  const workerTransitions = transitionFrames(worker.hiddenFrameTimings);
  assert(legacyTransitions.length === 2 && workerTransitions.length === 2,
    'A/B timing data did not include both Shot transitions.');
  const result = {
    status: 'PASS',
    issue: 849,
    fixtureRoot,
    runs: {
      legacyBlob: { name: LEGACY_RUN_NAME, jobId: legacy.jobId, drawMode: legacy.drawMode, pngMode: legacy.pngMode },
      workerPng: { name: WORKER_RUN_NAME, jobId: worker.jobId, drawMode: worker.drawMode, pngMode: worker.pngMode },
    },
    inputsIdentical: true,
    inputs: {
      projectFileSha256: legacy.projectInputBefore.projectFileSha256,
      codeSha: legacy.codeSha,
      branch: legacy.branch,
      projectSnapshotSha256: legacy.frozenCandidate.projectSha256,
      frozenCandidateSha256: legacy.frozenCandidate.frozenInputSha256,
      revision: legacy.frozenCandidate.revision,
      dirtyAtCapture: legacy.frozenCandidate.dirtyAtCapture,
      cameraMode: legacy.cameraMode,
      renderSettings: legacy.renderSettings,
      mediaManifest: legacy.frozenCandidate.mediaManifest,
      fontFiles: legacy.fontFiles,
      projectInputUnchanged: {
        legacyBlob: legacy.projectInputUnchanged,
        workerPng: worker.projectInputUnchanged,
      },
    },
    frameCount: EXPECTED_FRAME_COUNT,
    decodedFramePixelHashesIdentical: true,
    decodedFrameHashes: { legacyBlob: legacyFrames, workerPng: workerFrames },
    artifactSha256: {
      legacyMp4: legacyMp4Sha256,
      workerMp4: workerMp4Sha256,
      legacyPngFrames: legacy.frameHashes.map((frame) => frame.pngSha256),
      workerPngFrames: worker.frameHashes.map((frame) => frame.pngSha256),
    },
    frameMismatchCount: frameMismatches.length,
    mp4: {
      legacyBlob: {
        path: legacy.outputPath,
        sha256: legacyMp4Sha256,
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
      workerPng: {
        path: worker.outputPath,
        sha256: workerMp4Sha256,
        videoCodec: workerProbe.video.codec_name,
        pixelFormat: workerProbe.video.pix_fmt,
        dimensions: `${workerProbe.video.width}x${workerProbe.video.height}`,
        fps: parseRational(workerProbe.video.avg_frame_rate ?? workerProbe.video.r_frame_rate),
        frameCount: Number(workerProbe.video.nb_read_frames ?? workerProbe.video.nb_frames),
        durationSeconds: workerProbe.videoDuration,
        audioCodec: workerProbe.audio.codec_name,
        audioSampleRate: Number(workerProbe.audio.sample_rate),
        audioChannels: Number(workerProbe.audio.channels),
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
      legacyBlob: {
        exportServiceElapsedMs: legacyJobMs,
        mainJobWallMs: legacy.mainJobWallMs,
        apiStartToCompleteMs: legacy.apiStartToCompleteMs ?? legacy.uiInvokeToCompleteMs,
        uiClickToCompleteMs: null,
        mainFrameReady: legacy.mainFrameReady,
        hiddenRendererStages: legacy.hiddenRendererStages,
        firstFrame: summarizeFrameSubset(legacy.hiddenFrameTimings.slice(0, 1)),
        shotTransitions: summarizeFrameSubset(legacyTransitions),
        exportPhases: summarizeExportPhases(legacy.outputUpdates),
        peakMemory: legacy.peakMemory,
        hiddenRendererMemory: legacy.hiddenRendererMemory,
      },
      workerPng: {
        exportServiceElapsedMs: workerJobMs,
        mainJobWallMs: worker.mainJobWallMs,
        apiStartToCompleteMs: worker.apiStartToCompleteMs ?? worker.uiInvokeToCompleteMs,
        uiClickToCompleteMs: null,
        mainFrameReady: worker.mainFrameReady,
        hiddenRendererStages: worker.hiddenRendererStages,
        firstFrame: summarizeFrameSubset(worker.hiddenFrameTimings.slice(0, 1)),
        shotTransitions: summarizeFrameSubset(workerTransitions),
        exportPhases: summarizeExportPhases(worker.outputUpdates),
        peakMemory: worker.peakMemory,
        hiddenRendererMemory: worker.hiddenRendererMemory,
      },
      elapsedSavedMs: savedMs,
      elapsedSavedPercent: Number.isFinite(savedPercent) ? Math.round(savedPercent * 100) / 100 : null,
      faster: workerJobMs < legacyJobMs,
      meets10PercentNetTarget: savedPercent >= 10,
      meetsStableRequestToPngTarget: requestPngImproved,
      legacyReadyGateMedianMs: legacyReadyGateMedian,
      workerReadyGateMedianMs: workerReadyGateMedian,
      readyGateSavedPercent,
      hiddenRendererPeakPrivateMemoryDeltaBytes:
        worker.hiddenRendererMemory.privateBytes.maxMs - legacy.hiddenRendererMemory.privateBytes.maxMs,
      decision: performanceDecision,
      entryPoint: 'Formal export was initiated through the official Preload API; editor UI click latency was not measured.',
      manualVisualAcceptance: 'NOT_RUN',
      uiClickToComplete: 'NOT_MEASURED',
      ci: 'CI_NOT_REPORTED',
    },
    safety: {
      legacy: legacy.cleanup,
      workerPng: worker.cleanup,
    },
    receiptHashes: {
      legacyBlob: sha256(await fs.readFile(path.join(fixtureRoot, 'runs', LEGACY_RUN_NAME, 'receipt.json'))),
      workerPng: sha256(await fs.readFile(path.join(fixtureRoot, 'runs', WORKER_RUN_NAME, 'receipt.json'))),
    },
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const repoEvidence = JSON.parse(JSON.stringify(result));
  delete repoEvidence.fixtureRoot;
  for (const run of Object.values(repoEvidence.mp4)) {
    run.path = path.basename(run.path);
  }
  await fs.writeFile(REPO_EVIDENCE_JSON, JSON.stringify(repoEvidence, null, 2) + '\n', { flag: 'wx' });
  const formatStats = (stats) =>
    `n=${stats.count}, p50=${stats.p50Ms ?? 'n/a'} ms, p95=${stats.p95Ms ?? 'n/a'} ms, max=${stats.maxMs ?? 'n/a'} ms`;
  const markdown = [
    '# Issue #849 O2 PNG worker comparison',
    '',
    `Decision: **${result.timing.decision}**`,
    '',
    `- Base O1: \`${legacy.baseO1Sha}\``,
    `- Candidate: \`${legacy.codeSha}\` on \`${legacy.branch}\``,
    `- Modes: A \`${legacy.drawMode} + ${legacy.pngMode}\`; B \`${worker.drawMode} + ${worker.pngMode}\``,
    `- Frozen Project SHA-256: \`${result.inputs.projectFileSha256}\``,
    `- Frozen candidate SHA-256: \`${result.inputs.frozenCandidateSha256}\``,
    `- Media/font/render inputs identical: ${result.inputsIdentical}`,
    `- MP4 SHA-256: A \`${legacyMp4Sha256}\`; B \`${workerMp4Sha256}\``,
    `- Frames: ${EXPECTED_FRAME_COUNT}/${EXPECTED_FRAME_COUNT}; decoded RGBA hashes identical: ${result.decodedFramePixelHashesIdentical}`,
    `- MP4: both H.264/yuv420p 1920×1080 @ 24 fps, ${EXPECTED_FRAME_COUNT} frames, AAC 48 kHz`,
    `- Decoded PCM identical: ${result.decodedPcm.identical} (SHA-256 A \`${pcmHashes.legacyBlob}\`, B \`${pcmHashes.workerPng}\`)`,
    '',
    '## Performance',
    '',
    `- Job wall: A ${legacyJobMs} ms; B ${workerJobMs} ms; net change ${Number.isFinite(savedPercent) ? `${savedPercent.toFixed(2)}% faster` : 'n/a'}`,
    `- Request to PNG: A ${formatStats(legacy.hiddenRendererStages.requestToPngMs)}; B ${formatStats(worker.hiddenRendererStages.requestToPngMs)}`,
    `- PNG encode: A ${formatStats(legacy.hiddenRendererStages.pngEncodeMs)}; B ${formatStats(worker.hiddenRendererStages.workerEncodeMs)}`,
    `- Snapshot: B ${formatStats(worker.hiddenRendererStages.pngSnapshotMs)}`,
    `- Transfer dispatch: B ${formatStats(worker.hiddenRendererStages.pngTransferDispatchMs)}`,
    `- Worker return: B ${formatStats(worker.hiddenRendererStages.workerReturnMs)} (round trip ${formatStats(worker.hiddenRendererStages.workerRoundTripMs)})`,
    `- First frame request to PNG: A ${result.timing.legacyBlob.firstFrame.requestToPngMs.maxMs} ms; B ${result.timing.workerPng.firstFrame.requestToPngMs.maxMs} ms`,
    `- Shot transition request to PNG peak: A ${result.timing.legacyBlob.shotTransitions.requestToPngMs.maxMs} ms; B ${result.timing.workerPng.shotTransitions.requestToPngMs.maxMs} ms`,
    `- Main frame-ready: A ${formatStats(legacy.mainFrameReady)}; B ${formatStats(worker.mainFrameReady)}`,
    `- Rendering phase: A ${legacy.exportPhases.rendering ?? 'n/a'} ms; B ${worker.exportPhases.rendering ?? 'n/a'} ms`,
    `- Hidden renderer private-memory peak: A ${legacy.hiddenRendererMemory.privateBytes.maxMs} bytes; B ${worker.hiddenRendererMemory.privateBytes.maxMs} bytes (delta ${result.timing.hiddenRendererPeakPrivateMemoryDeltaBytes} bytes)`,
    `- Hidden renderer working-set peak: A ${legacy.hiddenRendererMemory.workingSetBytes.maxMs} bytes; B ${worker.hiddenRendererMemory.workingSetBytes.maxMs} bytes`,
    '',
    '## Safety and limits',
    '',
    `- No-clobber, cancellation, source immutability, staging cleanup, and hidden window cleanup: pass for both runs.`,
    `- Worker: one per formal Job, one frame in flight; cancellation Worker stopped via ${worker.cleanup.cancelledWorkerStopEvidence}.`,
    '- Human visual acceptance: NOT_RUN; editor UI click-to-complete: NOT_MEASURED; GitHub CI: CI_NOT_REPORTED.',
    '- Raw MP4 and synthetic fixture assets remain under the external acceptance directory and are not committed.',
    '',
    'See the companion JSON for per-frame hashes, stage timing distributions, memory samples, and cleanup receipts.',
    '',
  ].join('\n');
  await fs.writeFile(REPO_EVIDENCE_MARKDOWN, markdown, { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: result.status,
    frameCount: result.frameCount,
    decodedFramesIdentical: result.decodedFramePixelHashesIdentical,
    pcmIdentical: result.decodedPcm.identical,
    legacyExportMs: legacyJobMs,
    workerPngExportMs: workerJobMs,
    savedMs,
    savedPercent: result.timing.elapsedSavedPercent,
    readyGateSavedPercent: result.timing.readyGateSavedPercent,
    meets10PercentNetTarget: result.timing.meets10PercentNetTarget,
    performanceDecision: result.timing.decision,
    faster: result.timing.faster,
    output: OUTPUT_PATH,
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
