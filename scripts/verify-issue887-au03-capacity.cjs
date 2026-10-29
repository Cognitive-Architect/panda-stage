const { app, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { AssetPreviewAudioService } = require('../dist-electron/main/services/AssetPreviewAudioService.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

const issueCase = process.env.PANDA_STAGE_ISSUE887_CASE;
const configuredProjectRoot = process.env.PANDA_STAGE_ISSUE887_PROJECT_ROOT;
if (!configuredProjectRoot) throw new Error('PANDA_STAGE_ISSUE887_PROJECT_ROOT is required.');
const isIssue888Case = issueCase === 'F01' || issueCase === 'F02';
const issueNumber = isIssue888Case ? 888 : 887;
const issue888Phase = process.env.PANDA_STAGE_ISSUE888_PHASE ?? 'baseline';
const issue888ReadDelayMs = Math.max(0, Number(process.env.PANDA_STAGE_ISSUE888_READ_DELAY_MS ?? 0));
const issue888DecodeDelayMs = Math.max(0, Number(process.env.PANDA_STAGE_ISSUE888_DECODE_DELAY_MS ?? 0));
if (isIssue888Case && !['baseline', 'candidate'].includes(issue888Phase)) {
  throw new Error('PANDA_STAGE_ISSUE888_PHASE must be baseline or candidate.');
}
if (!Number.isFinite(issue888ReadDelayMs) || !Number.isFinite(issue888DecodeDelayMs)) {
  throw new Error('Issue #888 injected delays must be finite millisecond values.');
}
const projectRoot = path.resolve(configuredProjectRoot);
const fixtureRunRoot = path.dirname(projectRoot);
const caseRunRoot = mkdtempSync(path.join(fixtureRunRoot, `native-${issueCase ?? 'missing'}-`));
const delayProfile = isIssue888Case ? `-read${issue888ReadDelayMs}-decode${issue888DecodeDelayMs}` : '';
const resultPath = path.join(caseRunRoot, `issue${issueNumber}-${issueCase ?? 'missing'}${delayProfile}-L1-${isIssue888Case ? issue888Phase : 'current'}.json`);
const workingSetLimitBytes = 128 * 1024 * 1024;

app.on('window-all-closed', () => {});
process.env.VITE_DEV_SERVER_URL = '';
try { app.setPath('userData', path.join(caseRunRoot, 'electron-user-data')); } catch { /* Electron may initialize this first. */ }

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadFixture() {
  assert(['A-full', 'A-offset', 'A-proxy-control', 'B-overlap', 'C-mp3', 'F01', 'F02'].includes(issueCase),
    'PANDA_STAGE_ISSUE887_CASE must select an Issue #887 or Issue #888 fixture case.');
  const projectPath = path.join(projectRoot, 'project.json');
  const projectBytes = readFileSync(projectPath);
  const project = ProjectSchema.parse(JSON.parse(projectBytes.toString('utf8')));
  assert(project.schemaVersion === 14, `Expected schema v14; received v${project.schemaVersion}.`);
  const imageMedia = new Map();
  for (const asset of project.assets) {
    if (asset.kind !== 'image') continue;
    const absolutePath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(projectRoot, absolutePath);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), `Synthetic image escaped fixture root: ${asset.id}.`);
    const bytes = readFileSync(absolutePath);
    assert(sha256(bytes) === asset.sha256, `Synthetic image hash mismatch: ${asset.id}.`);
    imageMedia.set(asset.id, bytes);
  }
  const audioAssets = project.assets.filter((asset) => asset.kind === 'audio');
  assert(audioAssets.length > 0, 'Fixture has no audio assets.');
  const manifestPath = path.join(fixtureRunRoot, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const caseManifest = manifest.cases.find((entry) => entry.caseId === issueCase);
  assert(caseManifest && path.resolve(caseManifest.projectRoot) === projectRoot,
    'Fixture manifest does not match the selected project root.');
  const projectSha256 = sha256(projectBytes);
  assert(projectSha256 === caseManifest.projectSha256, 'Project hash does not match the generated fixture manifest.');
  const sourceRecords = audioAssets.map((asset) => {
    const filePath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(projectRoot, filePath);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), `Audio source escaped fixture root: ${asset.id}.`);
    const bytes = readFileSync(filePath);
    assert(sha256(bytes) === asset.sha256, `Audio source hash mismatch: ${asset.id}.`);
    const manifestAsset = manifest.assets.find((entry) => entry.id === asset.id ||
      entry.sha256 === asset.sha256 || entry.relativePath === asset.relativePath);
    const sampleBoundaries = [];
    if (asset.mimeType === 'audio/wav' && bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(34) === 16) {
      const sampleRate = bytes.readUInt32LE(24);
      const blockAlign = bytes.readUInt16LE(32);
      const clipOffsets = new Set();
      for (const shot of project.shots) {
        for (const clip of shot.audioClips.filter((entry) => entry.assetId === asset.id)) {
          for (let elapsedMs = 0; elapsedMs < clip.endMs - clip.startMs; elapsedMs += 10_000) {
            clipOffsets.add(clip.offsetMs + elapsedMs);
          }
        }
      }
      for (const offsetMs of [...clipOffsets].sort((left, right) => left - right)) {
        const position = 44 + Math.round(offsetMs * sampleRate / 1_000) * blockAlign;
        assert(position + 2 <= bytes.byteLength, `WAV sample offset is outside the source: ${offsetMs}ms.`);
        sampleBoundaries.push({ offsetMs, firstChannelSample: bytes.readInt16LE(position) / 32_768 });
      }
    }
    return { assetId: asset.id, name: asset.name, relativePath: asset.relativePath, filePath,
      mimeType: asset.mimeType, sha256: asset.sha256, durationMs: asset.durationMs,
      sourceFileBytes: bytes.byteLength, sampleRateFromFileHz: manifestAsset?.sampleRateFromFileHz ?? manifestAsset?.sampleRate ?? null,
      sourceChannels: manifestAsset?.channelsInFile ?? manifestAsset?.channels ?? null,
      sampleBoundaries,
      estimatedOutputPcmBytesAt48kHz: manifestAsset?.pcmBytesAt48kHz ?? null,
      estimatedPaddedReservationBytes: asset.durationMs && (manifestAsset?.channelsInFile ?? manifestAsset?.channels)
        ? Math.ceil((asset.durationMs / 1_000 + 1) * 48_000) *
          (manifestAsset.channelsInFile ?? manifestAsset.channels) * Float32Array.BYTES_PER_ELEMENT
        : null };
  });
  return { project, projectBytes, projectSha256, imageMedia, audioAssets, sourceRecords, manifestPath,
    caseManifest, baselineSourceRevision: manifest.sourceRevision };
}

function registerFixtureIpc(projectRootValue, project, imageMedia, service, readMetrics) {
  const resolvedRoot = path.resolve(projectRootValue);
  const document = { projectRoot: resolvedRoot, projectFilePath: path.join(resolvedRoot, 'project.json'),
    project, migrated: false, sourceVersion: project.schemaVersion };
  const assetFor = (id) => project.assets.find((asset) => asset.id === id);
  const register = (channel, handler) => ipcMain.handle(channel, handler);
  const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => path.resolve(request.projectRoot) === resolvedRoot
    ? { ok: true, value: document }
    : fail('PROJECT_NOT_FOUND', 'Unexpected fixture Project root.', { projectRoot: request.projectRoot }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => path.resolve(request.projectRoot) === resolvedRoot
    ? { ok: true, document }
    : fail('RECENT_PROJECT_NOT_FOUND', 'Unexpected fixture Project root.', { projectRoot: request.projectRoot }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => path.resolve(request.projectRoot) === resolvedRoot
    ? { ok: true, value: { ...document, project: request.project } }
    : fail('PROJECT_SAVE_FAILED', 'Unexpected fixture Project write.', { projectRoot: request.projectRoot }));
  for (const channel of [IPC_CHANNELS.AUTOSAVE_TRACK, IPC_CHANNELS.AUTOSAVE_UPDATE, IPC_CHANNELS.AUTOSAVE_STOP]) {
    register(channel, () => ({ ok: true }));
  }
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const asset = assetFor(request.assetId);
    const bytes = imageMedia.get(request.assetId);
    if (!asset || !bytes) return fail('ASSET_THUMBNAIL_READ_FAILED', 'Unknown synthetic image.', { assetId: request.assetId });
    return { ok: true, status: 'ready', assetId: asset.id, dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}` };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = assetFor(request.assetId);
    const bytes = imageMedia.get(request.assetId);
    if (!asset || !bytes || asset.kind !== 'image' || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return fail('ASSET_CANVAS_IMAGE_READ_FAILED', 'Synthetic image integrity check failed.', { assetId: request.assetId });
    }
    return { ok: true, status: 'ready', assetId: asset.id, mimeType: asset.mimeType,
      width: asset.width, height: asset.height, byteLength: bytes.byteLength, bytes: new Uint8Array(bytes) };
  });

  const activeReads = new Map();
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_INFO, async (_event, request) => {
    const startedAt = performance.now();
    const record = { assetId: request.assetId, sha256: request.sha256, startedAtMs: Date.now(),
      completedAtMs: null, durationMs: null, byteLength: null, status: null };
    readMetrics.infoRequests.push(record);
    readMetrics.infoActive += 1;
    try {
      const result = await service.getInfo(request);
      record.completedAtMs = Date.now();
      record.durationMs = performance.now() - startedAt;
      record.status = result.status ?? result.error?.code ?? 'unknown';
      record.byteLength = result.byteLength ?? null;
      return result;
    } finally {
      readMetrics.infoActive -= 1;
    }
  });
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, async (_event, request) => {
    const key = `${request.projectRoot}\u0000${request.assetId}\u0000${request.sha256}`;
    const startedAt = performance.now();
    const record = { assetId: request.assetId, sha256: request.sha256, startedAtMs: Date.now(),
      completedAtMs: null, durationMs: null, byteLength: null, shared: activeReads.has(key), status: null };
    readMetrics.requests.push(record);
    let read = activeReads.get(key);
    if (!read) {
      readMetrics.actualValidatedReadTasks += 1;
      readMetrics.active += 1;
      readMetrics.maxActive = Math.max(readMetrics.maxActive, readMetrics.active);
      read = (async () => {
        if (readMetrics.injectedReadDelayMs > 0) await delay(readMetrics.injectedReadDelayMs);
        return service.read(request);
      })();
      activeReads.set(key, read);
    }
    try {
      const result = await read;
      record.completedAtMs = Date.now();
      record.durationMs = performance.now() - startedAt;
      record.status = result.status ?? result.error?.code ?? 'unknown';
      record.byteLength = result.byteLength ?? null;
      return result;
    } finally {
      if (!record.shared) {
        readMetrics.active -= 1;
        if (activeReads.get(key) === read) activeReads.delete(key);
      }
    }
  });
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source, true);
}

async function waitFor(window, expression, message, timeoutMs = 90_000) {
  const code = `(async () => { const deadline = Date.now() + ${timeoutMs}; while (Date.now() < deadline) {
    try { if (${expression}) return true; } catch {} await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error(${JSON.stringify(message)}); })()`;
  return evaluate(window, code);
}

async function readState(window) {
  return evaluate(window, `(() => { const probe = window.__issue887Au03; const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const decoded = probe?.decodes.filter(item => item.status === 'ready') ?? [];
    const active = (probe?.sources ?? []).filter(item => item.active && item.startCount > 0);
    return { previewRange: overlay?.dataset.previewRange ?? null,
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1), projectTimeMs: Number(overlay?.dataset.previewProjectTime ?? -1),
      playing: overlay?.dataset.previewPlaying === 'true',
      projectRevision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null,
      playbackStartedAtMs: probe?.playbackStartedAtMs ?? null, decodeInFlight: probe?.decodeInFlight ?? 0,
      decodes: probe?.decodes ?? [], reads: probe?.readRoundTrips ?? [], readWrapperInstalled: probe?.readWrapperInstalled ?? false,
      contexts: probe?.contexts.map(item => ({ id: item.id, state: item.ref.deref()?.state ?? 'collected', sampleRate: item.sampleRate })) ?? [],
      sources: probe?.sources ?? [], timelineSamples: probe?.timelineSamples ?? [], activeSourceCount: active.length,
      activeUniquePcmBytes: [...new Map(active.map(item => [item.bufferId, item.pcmBytes])).values()].reduce((sum, value) => sum + (value ?? 0), 0),
      warning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null };
  })()`);
}

async function waitForQuiet(window, readMetrics, message, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = null;
  while (Date.now() < deadline) {
    const state = await readState(window);
    if (readMetrics.active === 0 && readMetrics.infoActive === 0 && state.decodeInFlight === 0) {
      if (quietSince === null) quietSince = Date.now();
      if (Date.now() - quietSince >= 350) return state;
    } else quietSince = null;
    await delay(50);
  }
  throw new Error(message);
}

function deriveWorkingSetPeak(fixture, readMetrics, decodes, observedAtMs) {
  const events = [];
  const totals = { sourceReadReservationBytes: 0, actualSourceBytes: 0, decodeInputCopyBytes: 0,
    decodePcmReservationBytes: 0, retainedPcmBytes: 0, retainedWaveSourceBytes: 0 };
  const addInterval = (field, startAtMs, endAtMs, bytes, assetId) => {
    if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs || bytes <= 0) return;
    events.push({ atMs: startAtMs, delta: bytes, field, assetId });
    events.push({ atMs: endAtMs, delta: -bytes, field, assetId });
  };
  const sourceForDecode = (decode) => fixture.sourceRecords.find((source) => source.sampleBoundaries.some((sample) =>
    Math.abs(sample.firstChannelSample - (decode.firstChannelSample ?? NaN)) <= 0.00002));
  const perSource = [];
  for (const source of fixture.sourceRecords) {
    const read = readMetrics.requests.find((entry) => entry.assetId === source.assetId && !entry.shared);
    if (!read) continue;
    const sourceDecode = decodes.find((entry) => entry.status === 'ready' &&
      sourceForDecode(entry)?.assetId === source.assetId);
    const info = readMetrics.infoRequests.find((entry) => entry.assetId === source.assetId && entry.status === 'ready');
    const sourceBytes = info?.byteLength ?? read.byteLength ?? source.sourceFileBytes;
    const decodeDoneAtMs = sourceDecode?.completedAtMs ?? read.completedAtMs;
    const isSegmented = Boolean(sourceDecode && source.durationMs &&
      sourceDecode.durationSeconds < source.durationMs / 1_000 - 0.01);
    const pcmReservationBytes = source.estimatedPaddedReservationBytes ?? 0;
    const retainedPcmBytes = sourceDecode?.pcmBytes ?? 0;
    addInterval('sourceReadReservationBytes', read.startedAtMs, read.completedAtMs, sourceBytes, source.assetId);
    if (isSegmented) {
      addInterval('retainedWaveSourceBytes', read.completedAtMs, observedAtMs, sourceBytes, source.assetId);
      addInterval('decodePcmReservationBytes', read.startedAtMs, decodeDoneAtMs,
        sourceDecode ? Math.ceil((sourceDecode.durationSeconds + 1) * sourceDecode.sampleRate) *
          sourceDecode.channels * Float32Array.BYTES_PER_ELEMENT : 0, source.assetId);
      addInterval('decodeInputCopyBytes', sourceDecode?.startedAtMs, decodeDoneAtMs,
        sourceDecode?.inputByteLength ?? 0, source.assetId);
    } else {
      addInterval('actualSourceBytes', read.completedAtMs, decodeDoneAtMs, sourceBytes, source.assetId);
      addInterval('decodePcmReservationBytes', read.startedAtMs, decodeDoneAtMs,
        pcmReservationBytes, source.assetId);
    }
    addInterval('retainedPcmBytes', decodeDoneAtMs, observedAtMs, retainedPcmBytes, source.assetId);
    perSource.push({ assetId: source.assetId, sourceBytes, pcmReservationBytes, retainedPcmBytes,
      segmented: isSegmented, readStartedAtMs: read.startedAtMs, readCompletedAtMs: read.completedAtMs,
      decodeStartedAtMs: sourceDecode?.startedAtMs ?? null, decodeCompletedAtMs: sourceDecode?.completedAtMs ?? null });
  }
  events.sort((left, right) => left.atMs - right.atMs || left.delta - right.delta);
  let peakBytes = 0;
  let peakAtMs = null;
  let peakByCategory = null;
  for (const event of events) {
    totals[event.field] += event.delta;
    const currentBytes = Object.values(totals).reduce((sum, value) => sum + value, 0);
    if (currentBytes > peakBytes) {
      peakBytes = currentBytes;
      peakAtMs = event.atMs;
      peakByCategory = { ...totals };
    }
  }
  return { method: 'Event-derived renderer budget model; source reservation, actual full-source input, segmented source cache, proxy input copy, decode reservation, and retained PCM are separate intervals. Unit tests exercise the production transport snapshot directly; this native L1 interval estimate is not OS RSS.',
    limitBytes: workingSetLimitBytes, peakEstimatedWorkingSetBytes: peakBytes, peakAtMs, peakByCategory, perSource };
}

async function click(window, selector) {
  await evaluate(window, `document.querySelector(${JSON.stringify(selector)})?.click()`);
  await delay(60);
}

async function openProject(window, projectRootValue) {
  await waitFor(window, `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Project Center path input did not appear.');
  await evaluate(window, `(() => { const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(projectRootValue)}); input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button')?.click(); })()`);
  await waitFor(window, `Boolean(document.querySelector('[data-testid="editor-layout"]') && document.querySelector('[data-testid="project-canvas-stage"]'))`,
    'The synthetic v14 Project did not open in the Editor.');
}

async function installProbe(window, decodeDelayMs = 0) {
  await evaluate(window, `(() => {
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) throw new Error('Native AudioContext is unavailable.');
    window.__issue887NativeAudioContext = NativeAudioContext;
    const probe = window.__issue887Au03 = { contexts: [], sources: [], decodes: [], bufferInfo: new WeakMap(),
      nextContextId: 1, nextBufferId: 1, decodeInFlight: 0, readRoundTrips: [], readWrapperInstalled: false,
      playbackStartedAtMs: null, timelineSamples: [] };
    const injectedDecodeDelayMs = ${decodeDelayMs};
    const overlay = () => document.querySelector('[data-testid="product-preview-overlay"]');
    setInterval(() => { const current = overlay(); if (!current) return;
      probe.timelineSamples.push({ atMs: Date.now(), previewTimeMs: Number(current.dataset.previewTime ?? -1),
        projectTimeMs: Number(current.dataset.previewProjectTime ?? -1), playing: current.dataset.previewPlaying === 'true' });
      if (probe.timelineSamples.length > 3_000) probe.timelineSamples.splice(0, probe.timelineSamples.length - 3_000);
    }, 20);
    new MutationObserver(() => { if (overlay()?.dataset.previewPlaying === 'true' && probe.playbackStartedAtMs === null) {
      probe.playbackStartedAtMs = Date.now(); } }).observe(document.body, { subtree: true, attributes: true,
      attributeFilter: ['data-preview-playing'] });
    window.AudioContext = class Issue887AudioContext extends NativeAudioContext {
      constructor(...args) { super(...args); this.__issue887Id = probe.nextContextId++;
        probe.contexts.push({ id: this.__issue887Id, ref: new WeakRef(this), sampleRate: this.sampleRate }); }
      decodeAudioData(data, ...callbacks) {
        const inputBytes = new Uint8Array(data);
        const isWaveInput = inputBytes.length >= 28 && inputBytes[0] === 0x52 && inputBytes[1] === 0x49 &&
          inputBytes[2] === 0x46 && inputBytes[3] === 0x46 && inputBytes[8] === 0x57 && inputBytes[9] === 0x41 &&
          inputBytes[10] === 0x56 && inputBytes[11] === 0x45;
        const inputView = new DataView(data);
        const startedAt = performance.now(); const record = { contextId: this.__issue887Id, inputByteLength: data.byteLength,
          inputSampleRateHz: isWaveInput ? inputView.getUint32(24, true) : null,
          inputChannels: isWaveInput ? inputView.getUint16(22, true) : null,
          startedAtMs: Date.now(), durationMs: null, sampleRate: null, channels: null, length: null, durationSeconds: null,
          pcmBytes: null, bufferId: null, status: 'running' }; probe.decodeInFlight += 1;
        const decodePromise = injectedDecodeDelayMs > 0
          ? new Promise((resolve, reject) => setTimeout(() => {
            try { Promise.resolve(super.decodeAudioData(data, ...callbacks)).then(resolve, reject); }
            catch (error) { reject(error); }
          }, injectedDecodeDelayMs))
          : super.decodeAudioData(data, ...callbacks);
        return Promise.resolve(decodePromise).then(buffer => {
          const info = { bufferId: probe.nextBufferId++, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
            length: buffer.length, durationSeconds: buffer.duration,
            pcmBytes: buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
            firstChannelSample: buffer.numberOfChannels > 0 && buffer.length > 0 ? buffer.getChannelData(0)[0] : null };
          probe.bufferInfo.set(buffer, info); Object.assign(record, info, { durationMs: performance.now() - startedAt,
            completedAtMs: Date.now(), status: 'ready' }); probe.decodes.push(record); return buffer;
        }, error => { record.durationMs = performance.now() - startedAt; record.completedAtMs = Date.now(); record.status = 'failed';
          record.errorName = error?.name ?? 'Error'; probe.decodes.push(record); throw error;
        }).finally(() => { probe.decodeInFlight -= 1; });
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const record = { contextId: this.__issue887Id, startCount: 0, stopCount: 0, startArgs: null,
          previewTimeAtStartCallMs: null, projectTimeAtStartCallMs: null, bufferId: null, sampleRate: null,
          channels: null, durationSeconds: null, pcmBytes: null, gain: null, contextTimeAtStartCall: null,
          scheduledProjectTimeMs: null, sampleAtStartOffset: null, active: false, ended: false };
        const nativeStart = source.start.bind(source); const nativeStop = source.stop.bind(source);
        const nativeConnect = source.connect.bind(source);
        source.connect = (destination, ...args) => {
          if (destination?.gain) record.gain = destination.gain.value;
          return nativeConnect(destination, ...args);
        };
        source.start = (...args) => { const info = probe.bufferInfo.get(source.buffer); record.startCount += 1;
          record.startArgs = args; record.previewTimeAtStartCallMs = Number(overlay()?.dataset.previewTime ?? -1);
          record.projectTimeAtStartCallMs = Number(overlay()?.dataset.previewProjectTime ?? -1);
          record.contextTimeAtStartCall = this.currentTime;
          record.scheduledProjectTimeMs = record.projectTimeAtStartCallMs < 0 ? null :
            record.projectTimeAtStartCallMs + Math.max(0, ((args[0] ?? this.currentTime) - this.currentTime) * 1_000);
          if (info) {
            Object.assign(record, info);
            const offsetFrames = Math.round((args[1] ?? 0) * info.sampleRate);
            record.sampleAtStartOffset = source.buffer.numberOfChannels > 0 && offsetFrames < source.buffer.length
              ? source.buffer.getChannelData(0)[offsetFrames] : null;
          }
          record.active = true; return nativeStart(...args); };
        source.stop = (...args) => { record.stopCount += 1; record.active = false; return nativeStop(...args); };
        source.addEventListener('ended', () => { record.ended = true; record.active = false; });
        probe.sources.push(record); return source;
      }
    };
    const readAudio = window.pandaStage?.assets?.readAudio;
    if (typeof readAudio === 'function') { try { window.pandaStage.assets.readAudio = async request => {
      const startedAt = performance.now(); const response = await readAudio(request);
      probe.readRoundTrips.push({ assetId: request.assetId, durationMs: performance.now() - startedAt,
        byteLength: response?.byteLength ?? null, status: response?.status ?? response?.error?.code ?? 'unknown' });
      return response; }; probe.readWrapperInstalled = window.pandaStage.assets.readAudio !== readAudio; } catch {} }
  })()`);
}

async function openPreview(window, shotId, pauseAtProjectTimeMs = null) {
  await evaluate(window, `(() => { const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click(); })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.');
  if (pauseAtProjectTimeMs === null) {
    await click(window, '[data-testid="quick-action-play"]');
  } else {
    await evaluate(window, `document.querySelector('[data-testid="quick-action-play"]')?.click()`);
  }
  await waitFor(window, `Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`, 'Product Preview did not mount.');
  if (pauseAtProjectTimeMs !== null) {
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
      'Product Preview did not start before the F02 cold prewarm seek.');
    await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'F02 preview did not pause before positioning the future clip.');
    await seek(window, pauseAtProjectTimeMs);
  }
  await waitFor(window, `document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true' &&
    document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' &&
    document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageShotId === ${JSON.stringify(shotId)}`,
    'Product Preview was not display-ready for the expected Shot.');
}

async function stopIfPlaying(window) {
  const state = await readState(window);
  if (state.playing) await click(window, '[data-testid="product-preview-play-pause"]');
  await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
    'Preview did not pause.');
}

async function seek(window, timeMs) {
  await evaluate(window, `(() => { const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!input) throw new Error('Product Preview scrubber is missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false' &&
    Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewProjectTime ?? -1) === ${timeMs}`,
    `Preview did not seek to ${timeMs}ms.`);
}

async function measureMp3Decode(window, asset, root) {
  return evaluate(window, `(async () => {
    const response = await window.pandaStage.assets.readAudio({ projectRoot: ${JSON.stringify(root)},
      assetId: ${JSON.stringify(asset.id)}, sha256: ${JSON.stringify(asset.sha256)} });
    if (!response.ok || response.status !== 'ready') throw new Error('Validated MP3 read failed: ' + (response.error?.code ?? 'unknown'));
    let webCodecsMp3Support = { available: typeof window.AudioDecoder === 'function', supported: false };
    if (typeof window.AudioDecoder === 'function') {
      try {
        const support = await window.AudioDecoder.isConfigSupported({ codec: 'mp3', sampleRate: 48000, numberOfChannels: 2 });
        webCodecsMp3Support = { available: true, supported: support.supported,
          config: support.config ?? null };
      } catch (error) {
        webCodecsMp3Support = { available: true, supported: false,
          errorName: error?.name ?? 'Error', errorMessage: String(error?.message ?? error) };
      }
    }
    const bytes = response.bytes;
    let webCodecsFrameProbe = null;
    if (webCodecsMp3Support.supported && typeof window.EncodedAudioChunk === 'function') {
      const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const rates = [44100, 48000, 32000];
      const frames = [];
      let offset = 0;
      if (data.length >= 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
        const tagSize = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) |
          ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
        offset = 10 + tagSize + ((data[5] & 0x10) !== 0 ? 10 : 0);
      }
      let sampleCursor = 0;
      let parserError = null;
      while (offset + 4 <= data.length) {
        const header = ((data[offset] << 24) | (data[offset + 1] << 16) |
          (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
        if (((header & 0xffe00000) >>> 0) !== 0xffe00000) { offset += 1; continue; }
        const version = (header >>> 19) & 3;
        const layer = (header >>> 17) & 3;
        const bitrateIndex = (header >>> 12) & 15;
        const rateIndex = (header >>> 10) & 3;
        if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
          offset += 1; continue;
        }
        const sampleRate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const bitrate = (version === 3 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex] * 1000;
        const frameSamples = version === 3 ? 1152 : 576;
        const frameLength = Math.floor((version === 3 ? 144 : 72) * bitrate / sampleRate) + ((header >>> 9) & 1);
        const channels = ((header >>> 6) & 3) === 3 ? 1 : 2;
        if (offset + frameLength > data.length) break;
        if (frames.length > 0 && (frames[0].sampleRate !== sampleRate || frames[0].channels !== channels)) {
          parserError = 'MP3 sample rate or channel layout changes within this sample.'; break;
        }
        frames.push({ offset, frameLength, sampleRate, channels, frameSamples, sampleCursor });
        sampleCursor += frameSamples;
        offset += frameLength;
      }
      if (parserError || frames.length < 4) {
        webCodecsFrameProbe = { parsedFrames: frames.length, parserError: parserError ?? 'Could not parse enough MPEG Layer III frames.' };
      } else {
        let decodedFrames = 0;
        let outputCount = 0;
        let firstOutput = null;
        let decoderError = null;
        const config = { codec: 'mp3', sampleRate: frames[0].sampleRate, numberOfChannels: frames[0].channels };
        const decoder = new window.AudioDecoder({
          output: audioData => {
            outputCount += 1;
            decodedFrames += audioData.numberOfFrames;
            if (firstOutput === null) firstOutput = { timestamp: audioData.timestamp,
              duration: audioData.duration, sampleRate: audioData.sampleRate,
              channels: audioData.numberOfChannels, format: audioData.format };
            audioData.close();
          },
          error: error => { decoderError = { name: error?.name ?? 'Error', message: String(error?.message ?? error) }; },
        });
        try {
          decoder.configure(config);
          const probeEndSample = frames[0].sampleRate * 5;
          for (const frame of frames) {
            if (frame.sampleCursor >= probeEndSample) break;
            const frameBytes = data.subarray(frame.offset, frame.offset + frame.frameLength);
            decoder.decode(new window.EncodedAudioChunk({ type: 'key',
              timestamp: Math.round(frame.sampleCursor * 1_000_000 / frame.sampleRate),
              duration: Math.round(frame.frameSamples * 1_000_000 / frame.sampleRate), data: frameBytes }));
          }
          await decoder.flush();
          webCodecsFrameProbe = { parsedFrames: frames.length, inputBytesQueuedForFirstFiveSeconds:
            frames.filter(frame => frame.sampleCursor < probeEndSample).reduce((sum, frame) => sum + frame.frameLength, 0),
            decodedFrames, decodedSeconds: decodedFrames / frames[0].sampleRate, outputCount,
            firstOutput, decoderError };
        } catch (error) {
          webCodecsFrameProbe = { parsedFrames: frames.length, decoderError: decoderError ??
            { name: error?.name ?? 'Error', message: String(error?.message ?? error) } };
        } finally { try { decoder.close(); } catch {} }
      }
    }
    const decodeInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decodeInputByteLength = decodeInput.byteLength;
    const context = new window.AudioContext({ sampleRate: 48000 });
    try {
      const buffer = await context.decodeAudioData(decodeInput);
      return { readStatus: response.status, sourceByteLength: response.byteLength, decodeInputByteLength,
        contextSampleRateHz: context.sampleRate, decodedSampleRateHz: buffer.sampleRate, channels: buffer.numberOfChannels,
        framesPerChannel: buffer.length, durationSeconds: buffer.duration,
        decodedPcmBytes: buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
        webCodecsMp3Support, webCodecsFrameProbe,
        classification: 'L1 native AudioContext.decodeAudioData of the complete production-validated MP3 bytes.' };
    } finally { await context.close(); }
  })()`);
}

function classifyCurrentBehavior(id, playback, reads) {
  const playbackRequests = reads.requests.filter((entry) => entry.completedAtMs !== null);
  const readyReads = playbackRequests.filter((entry) => entry.status === 'ready');
  const readyDecodes = playback.decodes.filter((entry) => entry.status === 'ready');
  const startedSources = playback.sources.filter((entry) => entry.startCount > 0);
  if (id === 'A-proxy-control') return startedSources.length > 0 && readyDecodes.length > 0
    ? 'CONTROL_PLAYED' : 'CONTROL_NOT_PLAYED';
  if (id === 'A-full' || id === 'A-offset') {
    if (readyReads.length > 0 && readyDecodes.length === 0 && startedSources.length === 0) {
      return 'REPRODUCED_POST_READ_PRE_DECODE_CAPACITY_REJECTION';
    }
    if (startedSources.length > 0) return 'NOT_REPRODUCED_AUDIO_PLAYED';
    return 'NOT_REPRODUCED_OTHER_REJECTION_LAYER';
  }
  if (id === 'B-overlap') {
    if (readyReads.length === 1 && readyDecodes.length === 1 && startedSources.length === 1) {
      return 'REPRODUCED_SECOND_CURRENT_SOURCE_REJECTED_BEFORE_READ';
    }
    if (readyReads.length === 2 && readyDecodes.length === 1 && startedSources.length === 1) {
      return 'REPRODUCED_SECOND_CURRENT_SOURCE_REJECTED_AFTER_READ_BEFORE_DECODE';
    }
    if (startedSources.length >= 2) return 'NOT_REPRODUCED_BOTH_CURRENT_SOURCES_PLAYED';
    return 'NOT_REPRODUCED_OTHER_REJECTION_LAYER';
  }
  if (id === 'C-mp3') {
    if (playbackRequests.length === 0 && readyDecodes.length === 0 && startedSources.length === 0) {
      return 'REPRODUCED_INITIAL_RESERVATION_REJECTION_BEFORE_READ';
    }
    if (playbackRequests.length > 0 && readyDecodes.length === 0 && startedSources.length === 0) {
      return 'REPRODUCED_POST_READ_PRE_DECODE_REJECTION';
    }
    if (startedSources.length > 0) return 'NOT_REPRODUCED_AUDIO_PLAYED';
    return 'NOT_REPRODUCED_OTHER_REJECTION_LAYER';
  }
  return 'UNCLASSIFIED';
}

async function run() {
  const fixture = loadFixture();
  const resolvedProjectRoot = path.resolve(projectRoot);
  const service = new AssetPreviewAudioService({
    getCurrentProjectSnapshot: (root) => path.resolve(root) === resolvedProjectRoot ? { project: fixture.project } : null,
    enableValidatedHashIndex: true,
  });
  const readMetrics = { requests: [], infoRequests: [], actualValidatedReadTasks: 0,
    active: 0, maxActive: 0, infoActive: 0, injectedReadDelayMs: isIssue888Case ? issue888ReadDelayMs : 0 };
  registerFixtureIpc(projectRoot, fixture.project, fixture.imageMedia, service, readMetrics);
  const repositoryRoot = path.resolve(__dirname, '..');
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const candidatePatch = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repositoryRoot });
  const candidateWorkingTreeStatus = execFileSync('git', ['status', '--short'],
    { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const initialProjectSha256 = sha256(fixture.projectBytes);
  const receipt = {
    issue: issueNumber,
    parentIssue: isIssue888Case ? 887 : 886,
    caseId: issueCase,
    ...(isIssue888Case ? { phase: issue888Phase,
      injectedDelays: { readMs: issue888ReadDelayMs, decodeMs: issue888DecodeDelayMs } } : {}),
    classification: 'L1 native Windows Electron AudioContext/source graph plus production AssetPreviewAudioService IPC; this is not physical speaker acceptance.',
    baselineSourceRevision: fixture.baselineSourceRevision,
    candidateSourceRevision: sourceRevision,
    candidateWorkingTree: { trackedDiffSha256: sha256(candidatePatch), status: candidateWorkingTreeStatus },
    observedAt: new Date().toISOString(),
    environment: { platform: process.platform, release: os.release(), electron: process.versions.electron,
      chromium: process.versions.chrome, node: process.versions.node },
    fixture: { projectRoot, projectSha256: fixture.projectSha256, manifestPath: fixture.manifestPath,
      schemaVersion: fixture.project.schemaVersion,
      shots: fixture.project.shots.map((shot) => ({ id: shot.id, name: shot.name, durationMs: shot.durationMs,
        audioClips: shot.audioClips.map(({ id, name, assetId, role, startMs, endMs, offsetMs }) =>
          ({ id, name, assetId, role, startMs, endMs, offsetMs })) })),
      sources: fixture.sourceRecords },
    budgets: { workingSetLimitBytes, workingSetLimitMiB: 128,
      individualSourceLimitBytes: 64 * 1024 * 1024,
      combinedCurrentDecodedPcmBytes: fixture.sourceRecords.reduce((sum, source) => sum + (source.estimatedOutputPcmBytesAt48kHz ?? 0), 0) },
    playback: {},
    mainAudioRead: {},
    mp3NativeDecodeMeasurement: null,
    projectUnchanged: false,
    resultPath,
  };
  let window = null;
  let f02PrewarmStartSnapshot = null;
  let f02PlaybackResumeRequestedAtMs = null;
  try {
    assert(existsSync(projectRoot), `Fixture Project root does not exist: ${projectRoot}`);
    await app.whenReady();
    window = await createMainWindow({ show: true });
    window.setSize(1600, 1000);
    window.show(); window.focus(); window.webContents.focus();
    await openProject(window, projectRoot);
    const before = await evaluate(window, `({ revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undo: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null })`);
    await installProbe(window, isIssue888Case ? issue888DecodeDelayMs : 0);
    await openPreview(window, fixture.project.shots[0].id,
      isIssue888Case && issueCase === 'F02' ? 200 : null);
    if (isIssue888Case && issueCase === 'F02') {
      f02PrewarmStartSnapshot = await readState(window);
      assert(!f02PrewarmStartSnapshot.playing && f02PrewarmStartSnapshot.projectTimeMs === 200,
        `F02 cold fixture did not position the R5 master at 200ms: ${f02PrewarmStartSnapshot.projectTimeMs}.`);
      assert(readMetrics.infoRequests.length === 0 && readMetrics.requests.length === 0,
        'F02 fixture warmed source metadata or media before the 300ms-future cold playback measurement.');
      await evaluate(window, `window.__issue887Au03.playbackStartedAtMs = null`);
      f02PlaybackResumeRequestedAtMs = Date.now();
      await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
    }
    if (isIssue888Case && issueCase === 'F01') {
      await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' ||
        Boolean(document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent)`,
      'F01 did not reach playback or expose an audio warning.', 15_000);
    } else {
      await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
        'Product Preview did not enter playback.', isIssue888Case ? 15_000 : 90_000);
    }
    const firstShot = await waitForQuiet(window, readMetrics, 'Playback reads or native decodes did not settle.',
      isIssue888Case ? 20_000 : 90_000);
    receipt.playback.firstShot = firstShot;

    if (isIssue888Case) {
      if (issueCase === 'F02') {
        await waitFor(window, `Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewProjectTime ?? -1) >= 1_200 ||
          document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
        'F02 did not cross the future clip start while Product Preview was playing.', 20_000);
      }
      const playbackAtClassification = await readState(window);
      const startedSources = playbackAtClassification.sources.filter((source) => source.startCount > 0);
      const sourceByBufferId = new Map(playbackAtClassification.decodes.map((decode) => [decode.bufferId, decode]));
      const targetSourceRecords = fixture.sourceRecords;
      const nearestTimelineSample = (timestampMs) => playbackAtClassification.timelineSamples
        .reduce((best, item) => !best || Math.abs(item.atMs - timestampMs) < Math.abs(best.atMs - timestampMs) ? item : best, null);
      const prewarmEvents = [
        ...readMetrics.infoRequests.map((entry) => ({ kind: 'source-info', atMs: entry.startedAtMs,
          assetId: entry.assetId, status: entry.status, byteLength: entry.byteLength })),
        ...readMetrics.requests.map((entry) => ({ kind: 'source-read', atMs: entry.startedAtMs,
          assetId: entry.assetId, status: entry.status, byteLength: entry.byteLength })),
        ...playbackAtClassification.decodes.map((entry) => ({ kind: 'decode', atMs: entry.startedAtMs,
          bufferId: entry.bufferId, status: entry.status, inputByteLength: entry.inputByteLength,
          pcmBytes: entry.pcmBytes })),
      ].sort((left, right) => left.atMs - right.atMs).map((event) => ({ ...event,
        timeline: nearestTimelineSample(event.atMs) }));
      if (issueCase === 'F01') {
        const distinctIdentities = new Set(startedSources.map((source) => {
          const decode = sourceByBufferId.get(source.bufferId);
          const matched = targetSourceRecords.find((record) => record.sampleBoundaries.some((sample) =>
            sample.offsetMs === 0 && Math.abs(sample.firstChannelSample - (decode?.firstChannelSample ?? NaN)) <= 0.02));
          return matched?.sha256 ?? null;
        }).filter(Boolean));
        const byAsset = Object.fromEntries(fixture.sourceRecords.map((source) => [source.assetId, {
          sourceBytes: source.sourceFileBytes, pcmReservationBytes: source.estimatedPaddedReservationBytes,
          expectedGain: fixture.project.shots.flatMap((shot) => shot.audioClips)
            .find((clip) => clip.assetId === source.assetId)?.volume ?? null,
          info: readMetrics.infoRequests.filter((entry) => entry.assetId === source.assetId),
          reads: readMetrics.requests.filter((entry) => entry.assetId === source.assetId),
          decodes: playbackAtClassification.decodes.filter((entry) => {
            const sourceSample = source.sampleBoundaries.find((sample) => sample.offsetMs === 0)?.firstChannelSample;
            return typeof sourceSample === 'number' && Math.abs(entry.firstChannelSample - sourceSample) <= 0.02;
          }),
          starts: startedSources.filter((entry) => {
            const decode = sourceByBufferId.get(entry.bufferId);
            const sourceSample = source.sampleBoundaries.find((sample) => sample.offsetMs === 0)?.firstChannelSample;
            return typeof sourceSample === 'number' && Math.abs((decode?.firstChannelSample ?? NaN) - sourceSample) <= 0.02;
          }),
        }]));
        const oneReadOnly = readMetrics.actualValidatedReadTasks === 1 &&
          playbackAtClassification.decodes.filter((entry) => entry.status === 'ready').length === 1;
        const classification = startedSources.length >= 2 && distinctIdentities.size >= 2
          ? 'NOT_REPRODUCED_BOTH_150S_SOURCES_PLAYED'
          : startedSources.length === 1 && oneReadOnly
            ? 'REPRODUCED_ONLY_ONE_150S_SOURCE_STARTED_AFTER_OTHER_FAILED_CAPACITY'
            : readMetrics.infoRequests.length > 0 && readMetrics.actualValidatedReadTasks === 0 &&
              playbackAtClassification.decodes.filter((entry) => entry.status === 'ready').length < 2
              ? 'REPRODUCED_CAPACITY_REJECTION_AFTER_SOURCE_PREFLIGHT_BEFORE_READ'
              : startedSources.length === 1
                ? 'REPRODUCED_OR_PARTIAL_ONLY_ONE_150S_SOURCE_STARTED'
                : 'NOT_REPRODUCED_OTHER_REJECTION_LAYER';
        receipt.playback = { ...receipt.playback, ...playbackAtClassification,
          rejectionClassification: classification, sourceStarts: startedSources, distinctStartedSourceHashes: [...distinctIdentities],
          sourcesByAssetId: byAsset, observedPrewarmEvents: prewarmEvents,
          capacityWarning: playbackAtClassification.warning,
          expectedBaselineClassification: 'REPRODUCED_ONLY_ONE_150S_SOURCE_STARTED_AFTER_OTHER_FAILED_CAPACITY' };
      } else {
        const targetMasterStartMs = fixture.project.shots[0].durationMs;
        const firstTargetStart = startedSources.find((source) => Math.abs((source.scheduledProjectTimeMs ?? -1) - targetMasterStartMs) <= 30) ??
          startedSources[0] ?? null;
        const firstAsset = fixture.sourceRecords[0];
        const firstAssetStart = fixture.project.shots[1]?.audioClips[0]?.startMs ?? 0;
        const sourceOffsetMs = firstTargetStart ? (firstTargetStart.startArgs?.[1] ?? 0) * 1_000 : null;
        const expectedOffsetMs = firstTargetStart
          ? Math.max(0, firstTargetStart.projectTimeAtStartCallMs - targetMasterStartMs) : null;
        const onTime = Boolean(firstTargetStart && Math.abs(sourceOffsetMs ?? -1) <= 1 &&
          Math.abs((firstTargetStart.scheduledProjectTimeMs ?? -1) - targetMasterStartMs) <= 30);
        const sourceDecode = firstTargetStart ? sourceByBufferId.get(firstTargetStart.bufferId) : null;
        const sampleAtStartMatchesSource = Boolean(firstTargetStart && sourceDecode &&
          typeof firstTargetStart.sampleAtStartOffset === 'number' && firstAsset && (() => {
            const wav = readFileSync(firstAsset.filePath);
            const sampleRate = wav.readUInt32LE(24);
            const blockAlign = wav.readUInt16LE(32);
            const sourceOffsetSeconds = firstTargetStart.startArgs?.[1] ?? -1;
            if (sourceOffsetSeconds < 0) return false;
            const sourceFrame = Math.round(sourceOffsetSeconds * sampleRate);
            const firstSourceSample = wav.readInt16LE(44) / 32_768;
            const expectedSampleAtOffset = wav.readInt16LE(44 + sourceFrame * blockAlign) / 32_768;
            return firstAsset.sampleBoundaries.some((sample) => sample.offsetMs === 0 &&
              Math.abs(sample.firstChannelSample - sourceDecode.firstChannelSample) <= 0.00002) &&
              Math.abs(firstSourceSample - sourceDecode.firstChannelSample) <= 0.00002 &&
              Math.abs(expectedSampleAtOffset - firstTargetStart.sampleAtStartOffset) <= 0.0001;
          })());
        const classification = onTime && startedSources.length === 1
          ? 'NOT_REPRODUCED_FUTURE_WAV_STARTED_ON_TIME_ONCE'
          : firstTargetStart && sourceOffsetMs !== null && sourceOffsetMs > 0
            ? 'REPRODUCED_FUTURE_WAV_STARTED_LATE_WITH_ADVANCED_OFFSET'
            : firstTargetStart
              ? 'NOT_REPRODUCED_FUTURE_WAV_STARTED_WITH_OTHER_TIMING'
              : 'REPRODUCED_FUTURE_WAV_DID_NOT_START';
        receipt.playback = { ...receipt.playback, ...playbackAtClassification,
          rejectionClassification: classification, sourceStarts: startedSources,
          observedPrewarmEvents: prewarmEvents,
          targetClip: { masterStartMs: targetMasterStartMs, shotLocalStartMs: firstAssetStart,
            prewarmStartProjectTimeMs: f02PrewarmStartSnapshot?.projectTimeMs ?? null,
            prewarmLeadMs: f02PrewarmStartSnapshot
              ? targetMasterStartMs - f02PrewarmStartSnapshot.projectTimeMs : null,
            observedPreviewProjectTimeMs: playbackAtClassification.projectTimeMs },
          firstTargetStart, targetSourceOffsetMs: sourceOffsetMs, expectedOffsetFromLatenessMs: expectedOffsetMs,
          sourceSampleMatchesGeneratedWav: sampleAtStartMatchesSource, onTime,
          startupWaitMs: f02PlaybackResumeRequestedAtMs !== null &&
            typeof playbackAtClassification.playbackStartedAtMs === 'number'
            ? Math.max(0, playbackAtClassification.playbackStartedAtMs - f02PlaybackResumeRequestedAtMs) : null,
          injectedDelayMs: { read: issue888ReadDelayMs, decode: issue888DecodeDelayMs },
          capacityWarning: playbackAtClassification.warning,
          expectedOnTimeClassification: 'NOT_REPRODUCED_FUTURE_WAV_STARTED_ON_TIME_ONCE' };
      }

      receipt.mainAudioRead = { ipcRequests: readMetrics.requests.length,
        infoRequests: readMetrics.infoRequests.map((entry) => ({ ...entry })),
        actualValidatedReadTasks: readMetrics.actualValidatedReadTasks, maximumConcurrentTasks: readMetrics.maxActive,
        requests: readMetrics.requests.map((entry) => ({ ...entry })),
        hashValidationIndex: service.getHashValidationIndexSnapshot(),
        rendererRoundTripWrapperInstalled: playbackAtClassification.readWrapperInstalled,
        rendererRoundTrips: playbackAtClassification.reads };
      receipt.memoryEvidence = { limitBytes: workingSetLimitBytes,
        sourceReadReservationsObserved: readMetrics.infoRequests.map((entry) => ({ assetId: entry.assetId,
          reservedOrExpectedBytes: entry.byteLength, status: entry.status })),
        actualReadBytes: readMetrics.requests.map((entry) => ({ assetId: entry.assetId, byteLength: entry.byteLength,
          status: entry.status })),
        decodeInputsAndPcm: playbackAtClassification.decodes.map(({ inputByteLength, pcmBytes, status, durationSeconds }) =>
          ({ inputByteLength, pcmBytes, status, durationSeconds })),
        activeNativePcmBytes: playbackAtClassification.activeUniquePcmBytes,
        workingSetLedgerEstimate: deriveWorkingSetPeak(fixture, readMetrics,
          playbackAtClassification.decodes, Date.now()),
        sourceFileBytesHeldByFixture: fixture.sourceRecords.map(({ assetId, sourceFileBytes }) => ({ assetId, sourceFileBytes })),
        workingSetIsNotOperatingSystemRss: true };
      receipt.playback.projectRevisionAfter = playbackAtClassification.projectRevision;
      receipt.playback.undoCountAfter = playbackAtClassification.undoCount;
      receipt.playback.projectRevisionBefore = before.revision;
      receipt.playback.undoCountBefore = before.undo;
      receipt.playback.finalState = playbackAtClassification;
      receipt.projectUnchanged = sha256(readFileSync(path.join(projectRoot, 'project.json'))) === initialProjectSha256 &&
        before.revision === playbackAtClassification.projectRevision && before.undo === playbackAtClassification.undoCount;
      assert(receipt.projectUnchanged, 'Fixture Project revision, history, or bytes changed during Issue #888 native playback measurement.');

      if (issue888Phase === 'candidate' && issueCase === 'F01') {
        assert(startedSources.length === 2 && receipt.playback.distinctStartedSourceHashes.length === 2,
          'F01 candidate did not start both distinct 150s source WAVs.');
        const expectedGains = fixture.sourceRecords.map((source) => fixture.project.shots.flatMap((shot) => shot.audioClips)
          .find((clip) => clip.assetId === source.assetId)?.volume);
        const actualGains = startedSources.map((source) => source.gain).sort((left, right) => left - right);
        assert(actualGains.length === 2 && expectedGains.every((gain) => actualGains.some((actual) => Math.abs(actual - gain) < 0.001)),
          `F01 candidate gains ${actualGains.join(', ')} do not match the two clip gains.`);
        assert(playbackAtClassification.warning === null, 'F01 candidate retained a preview capacity warning.');
        const scheduledProjectTimes = startedSources.map((source) => source.scheduledProjectTimeMs ?? -10_000);
        const audioStartTimes = startedSources.map((source) => source.startArgs?.[0] ?? -10_000);
        const firstSampleMatchesGeneratedSources = startedSources.every((source) => {
          const decode = sourceByBufferId.get(source.bufferId);
          const matchingAsset = targetSourceRecords.find((record) => record.sampleBoundaries.some((sample) =>
            sample.offsetMs === 0 && Math.abs(sample.firstChannelSample - (decode?.firstChannelSample ?? NaN)) <= 0.00002));
          if (!matchingAsset || !decode || typeof source.sampleAtStartOffset !== 'number') return false;
          const wav = readFileSync(matchingAsset.filePath);
          const sampleRate = wav.readUInt32LE(24);
          const blockAlign = wav.readUInt16LE(32);
          const sourceOffsetSeconds = source.startArgs?.[1] ?? -1;
          if (sourceOffsetSeconds < 0) return false;
          const sampleFrame = Math.round(sourceOffsetSeconds * sampleRate);
          const expectedSample = wav.readInt16LE(44 + sampleFrame * blockAlign) / 32_768;
          return sampleFrame >= 0 && Math.abs(expectedSample - source.sampleAtStartOffset) <= 0.0001;
        });
        const ledgerEstimate = receipt.memoryEvidence.workingSetLedgerEstimate;
        assert(firstSampleMatchesGeneratedSources && startedSources.every((source) => source.startCount === 1 &&
          (source.startArgs?.[1] ?? Infinity) >= 0 && (source.startArgs?.[1] ?? Infinity) <= 0.01) &&
          Math.max(...scheduledProjectTimes) - Math.min(...scheduledProjectTimes) <= 2 &&
          Math.abs(scheduledProjectTimes[0] ?? -10_000) <= 2 &&
          Math.max(...audioStartTimes) - Math.min(...audioStartTimes) <= 0.002,
        'F01 candidate sources did not start once at the shared master time with matching first samples.');
        assert(ledgerEstimate.peakEstimatedWorkingSetBytes <= workingSetLimitBytes,
          `F01 candidate event-derived working-set peak ${ledgerEstimate.peakEstimatedWorkingSetBytes} exceeded 128 MiB.`);
      }
      if (issue888Phase === 'candidate' && issueCase === 'F02') {
        assert(startedSources.length === 1, `F02 candidate expected exactly one first-chunk start; observed ${startedSources.length}.`);
        assert(playbackAtClassification.warning === null, 'F02 candidate retained a preview audio warning.');
        assert(readMetrics.actualValidatedReadTasks === 1, `F02 candidate expected one validated source read; observed ${readMetrics.actualValidatedReadTasks}.`);
        if (issue888ReadDelayMs + issue888DecodeDelayMs < 300) {
          assert(receipt.playback.onTime, 'F02 candidate inside-window delay did not schedule the first sample on time.');
          assert(playbackAtClassification.decodes.length === 1, 'F02 on-time prewarm decoded the first chunk more than once.');
          assert(receipt.playback.sourceSampleMatchesGeneratedWav, 'F02 on-time start did not preserve the generated WAV first sample.');
        } else {
          assert(receipt.playback.targetSourceOffsetMs !== null && receipt.playback.targetSourceOffsetMs > 0 &&
            receipt.playback.expectedOffsetFromLatenessMs !== null &&
            Math.abs(receipt.playback.targetSourceOffsetMs - receipt.playback.expectedOffsetFromLatenessMs) <= 100,
          'F02 over-window delay did not report a late start with a matching advanced source offset.');
          assert(receipt.playback.sourceSampleMatchesGeneratedWav, 'F02 late start did not retain the generated WAV source identity at its offset.');
        }
      }
      receipt.measurementCompleted = true;
    } else if (issueCase === 'A-full') {
      await waitFor(window,
        `Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= 10_100`,
        'The four-minute WAV preview did not reach its first streamed chunk boundary.', 30_000);
      const boundaryState = await readState(window);
      const chunks = boundaryState.sources.filter((source) => source.startCount > 0 &&
        source.startArgs && Math.abs((source.startArgs[2] ?? 0) - 10) < 0.02)
        .sort((left, right) => left.startArgs[0] - right.startArgs[0]);
      assert(chunks.length >= 2, 'Four-minute WAV did not schedule the first two 10-second PCM chunks.');
      const boundaryGapMs = Math.abs((chunks[1].startArgs[0] - chunks[0].startArgs[0] - 10) * 1_000);
      assert(boundaryGapMs <= 80, `Streamed WAV chunk starts differ from a continuous boundary by ${boundaryGapMs} ms.`);
      const source = receipt.fixture.sources.find((entry) => entry.mimeType === 'audio/wav');
      const decodeByBufferId = new Map(boundaryState.decodes.map((decode) => [decode.bufferId, decode]));
      const sampleBoundaryChecks = chunks.slice(0, 2).map((startedSource, index) => {
        const offsetMs = index * 10_000;
        const expected = source?.sampleBoundaries.find((entry) => entry.offsetMs === offsetMs)?.firstChannelSample;
        const decode = decodeByBufferId.get(startedSource.bufferId);
        assert(typeof expected === 'number' && typeof decode?.firstChannelSample === 'number',
          `Missing native source-sample measurement at ${offsetMs}ms.`);
        const delta = Math.abs(decode.firstChannelSample - expected);
        assert(delta <= 0.00003, `Streamed WAV chunk at ${offsetMs}ms starts on the wrong source sample.`);
        return { sourceOffsetMs: offsetMs, expectedFirstChannelSample: expected,
          actualFirstChannelSample: decode.firstChannelSample, absoluteDelta: delta,
          scheduledAudioContextTime: startedSource.startArgs[0], durationSeconds: startedSource.startArgs[2] };
      });
      receipt.playback.streamingBoundary = { observedAtPreviewTimeMs: boundaryState.previewTimeMs,
        chunkStartArgs: chunks.slice(0, 2).map((source) => source.startArgs), boundaryGapMs,
        sampleBoundaryChecks, activeSources: boundaryState.activeSourceCount };
    }

    if (!isIssue888Case) {
    if ((issueCase === 'A-offset' || issueCase === 'A-proxy-control') && fixture.project.shots.length > 1) {
      await stopIfPlaying(window);
      const nextShotStartMs = fixture.project.shots[0].durationMs;
      await seek(window, nextShotStartMs);
      await click(window, '[data-testid="product-preview-play-pause"]');
      await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
        'Product Preview did not resume in the next Shot.');
      receipt.playback.nextShot = await waitForQuiet(window, readMetrics,
        'Next-Shot offset playback reads or native decodes did not settle.');
    }

    const playbackAtClassification = await readState(window);
    const playbackReadMetrics = { ...readMetrics, requests: readMetrics.requests.map((entry) => ({ ...entry })) };
    receipt.playback.rejectionClassification = classifyCurrentBehavior(issueCase, playbackAtClassification, playbackReadMetrics);
    const expectedClassification = {
      'A-full': 'NOT_REPRODUCED_AUDIO_PLAYED',
      'A-offset': 'NOT_REPRODUCED_AUDIO_PLAYED',
      'A-proxy-control': 'CONTROL_PLAYED',
      'B-overlap': 'NOT_REPRODUCED_BOTH_CURRENT_SOURCES_PLAYED',
      'C-mp3': 'REPRODUCED_INITIAL_RESERVATION_REJECTION_BEFORE_READ',
    }[issueCase];
    receipt.playback.expectedCurrentClassification = expectedClassification;
    assert(receipt.playback.rejectionClassification === expectedClassification,
      `Unexpected ${issueCase} candidate classification: ${receipt.playback.rejectionClassification}.`);
    receipt.playback.sourceStarts = playbackAtClassification.sources.filter((source) => source.startCount > 0);
    receipt.playback.audioWarning = playbackAtClassification.warning;
    if (issueCase === 'A-full') {
      assert(readMetrics.actualValidatedReadTasks === 1 && readMetrics.infoRequests.length === 1,
        'A-full WAV did not use one validated source read and one size preflight.');
      assert(playbackAtClassification.decodes.length >= 2 && receipt.playback.sourceStarts.length >= 2,
        'A-full WAV did not decode and start consecutive chunks.');
    } else if (issueCase === 'A-offset') {
      assert(readMetrics.actualValidatedReadTasks === 1 && readMetrics.infoRequests.length === 1,
        'A-offset WAV did not reuse one validated source read across different offsets.');
      const source = receipt.fixture.sources.find((entry) => entry.mimeType === 'audio/wav');
      const expectedSamples = [0, 60_000].map((offsetMs) => source?.sampleBoundaries
        .find((entry) => entry.offsetMs === offsetMs)?.firstChannelSample);
      const nativeDecodes = playbackAtClassification.decodes.filter((decode) => decode.status === 'ready')
        .sort((left, right) => left.bufferId - right.bufferId);
      assert(nativeDecodes.length === 2 && expectedSamples.every((sample) => typeof sample === 'number'),
        'A-offset WAV did not produce two native decodes and source-sample references.');
      const sampleBoundaryChecks = nativeDecodes.map((decode, index) => {
        const expected = expectedSamples[index];
        const delta = Math.abs(decode.firstChannelSample - expected);
        assert(delta <= 0.00003, `A-offset WAV did not start from the requested ${index === 0 ? 0 : 60_000}ms sample.`);
        return { requestedOffsetMs: index === 0 ? 0 : 60_000, expectedFirstChannelSample: expected,
          actualFirstChannelSample: decode.firstChannelSample, absoluteDelta: delta };
      });
      assert(receipt.playback.sourceStarts.length === 2, 'A-offset WAV did not start both Shot voices.');
      receipt.playback.sampleBoundaryChecks = sampleBoundaryChecks;
    } else if (issueCase === 'A-proxy-control') {
      assert(readMetrics.actualValidatedReadTasks === 1 && playbackAtClassification.decodes.length === 1 &&
        receipt.playback.sourceStarts.length === 2,
      'Same-offset proxy control did not reuse one validated read and decode for both voices.');
    } else if (issueCase === 'B-overlap') {
      assert(readMetrics.actualValidatedReadTasks === 2 && readMetrics.infoRequests.length === 2 &&
        playbackAtClassification.decodes.length === 2 && receipt.playback.sourceStarts.length === 2,
      'Both current overlapping BGM sources did not read, decode, and start.');
      assert(playbackAtClassification.warning === null,
        'The successful B-overlap startup retained a false audio-preview failure warning.');
      assert(playbackAtClassification.decodes.every((decode) => decode.sampleRate === 48_000 && decode.channels === 2),
        'B-overlap did not keep a 48 kHz stereo AudioContext output.');
      assert(playbackAtClassification.decodes.some((decode) => decode.inputSampleRateHz === 44_100 &&
        decode.sampleRate === 48_000), 'The 44.1 kHz BGM was not natively resampled to the 48 kHz master context.');
    } else if (issueCase === 'C-mp3') {
      assert(playbackAtClassification.warning === '预览容量不足，部分音轨未播放；请缩短或拆分音频后重试。',
        'The unsupported long MP3 did not expose an actionable capacity warning.');
    }
    receipt.playback.projectRevisionBefore = before.revision;
    receipt.playback.projectRevisionAfter = playbackAtClassification.projectRevision;
    receipt.playback.undoCountBefore = before.undo;
    receipt.playback.undoCountAfter = playbackAtClassification.undoCount;
    receipt.mainAudioRead = { ipcRequests: readMetrics.requests.length,
      infoRequests: readMetrics.infoRequests.map((entry) => ({ ...entry })),
      actualValidatedReadTasks: readMetrics.actualValidatedReadTasks, maximumConcurrentTasks: readMetrics.maxActive,
      requests: readMetrics.requests.map((entry) => ({ ...entry })),
      hashValidationIndex: service.getHashValidationIndexSnapshot(),
      rendererRoundTripWrapperInstalled: playbackAtClassification.readWrapperInstalled,
      rendererRoundTrips: playbackAtClassification.reads };

    if (issueCase === 'C-mp3') {
      const mp3Asset = fixture.audioAssets.find((asset) => asset.mimeType === 'audio/mpeg');
      assert(mp3Asset, 'C-mp3 fixture has no MP3 asset.');
      receipt.mp3NativeDecodeMeasurement = await measureMp3Decode(window, mp3Asset, projectRoot);
      assert(receipt.mp3NativeDecodeMeasurement.contextSampleRateHz === 48_000 &&
        receipt.mp3NativeDecodeMeasurement.decodedSampleRateHz === 48_000 &&
        receipt.mp3NativeDecodeMeasurement.channels === 2 &&
        receipt.mp3NativeDecodeMeasurement.decodedPcmBytes > workingSetLimitBytes,
      'C-mp3 did not produce the expected over-budget 48 kHz stereo PCM measurement.');
      receipt.mainAudioRead.afterMp3DecodeMeasurement = readMetrics.requests.map((entry) => ({ ...entry }));
    }

    const afterMeasurement = await readState(window);
    receipt.playback.finalState = afterMeasurement;
    receipt.projectUnchanged = sha256(readFileSync(path.join(projectRoot, 'project.json'))) === initialProjectSha256 &&
      before.revision === afterMeasurement.projectRevision && before.undo === afterMeasurement.undoCount;
    assert(receipt.projectUnchanged, 'Fixture Project revision, history, or bytes changed during native playback measurement.');
    receipt.measurementCompleted = true;
    }
  } catch (error) {
    receipt.measurementCompleted = false;
    receipt.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try { if (window) receipt.playback.lastState = await readState(window); } catch { /* Renderer may already be gone. */ }
    receipt.mainAudioRead ??= { ipcRequests: readMetrics.requests.length,
      infoRequests: readMetrics.infoRequests.map((entry) => ({ ...entry })),
      actualValidatedReadTasks: readMetrics.actualValidatedReadTasks, maximumConcurrentTasks: readMetrics.maxActive,
      requests: readMetrics.requests.map((entry) => ({ ...entry })) };
  } finally {
    try { writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`); }
    catch { /* Preserve console output if the receipt path cannot be written. */ }
    try { window?.destroy(); } catch { /* The verifier window may already be closed. */ }
    app.quit();
  }
  console.log(JSON.stringify({ measurementCompleted: receipt.measurementCompleted, issueCase, resultPath,
    rejectionClassification: receipt.playback?.rejectionClassification ?? null,
    reads: receipt.mainAudioRead?.requests?.map(({ assetId, status, byteLength }) => ({ assetId, status, byteLength })) ?? [],
    playbackDecodes: receipt.playback?.firstShot?.decodes?.map(({ status, inputByteLength, sampleRate, channels, durationSeconds, pcmBytes }) =>
      ({ status, inputByteLength, sampleRate, channels, durationSeconds, pcmBytes })) ?? [],
    startedSources: receipt.playback?.sourceStarts?.length ?? 0,
    mp3NativeDecodeMeasurement: receipt.mp3NativeDecodeMeasurement,
    error: receipt.error ?? null }, null, 2));
  app.exit(receipt.measurementCompleted ? 0 : 1);
}

run().catch((error) => {
  console.error(error.stack ?? error);
  app.quit();
  process.exitCode = 1;
});
