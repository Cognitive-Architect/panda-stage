const { app, ipcMain } = require('electron');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

// Native Web Audio + the real sandboxed renderer/Preload. This is L1 graph
// evidence, not speaker-output or OWNER listening acceptance.
const acceptanceRoot = process.env.PANDA_STAGE_ISSUE884_AU02_ROOT ?? 'D:\\PandaStage-Acceptance\\issue884-au02-native';
const fixtureParent = process.env.PANDA_STAGE_ISSUE884_FIXTURE_PARENT ??
  'D:\\PandaStage-Acceptance\\issue884-au02-c01';
mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = mkdtempSync(path.join(acceptanceRoot, 'run-'));
const resultPath = path.join(runRoot, 'receipt.json');
const readDelayMs = Number(process.env.PANDA_STAGE_ISSUE884_AUDIO_READ_DELAY_MS ?? 180);
const STARTUP_READ_TARGETS = 2;
const SHORT_CUE_START_MS = 350;
const SHORT_CUE_END_MS = 430;
const CANCEL_CUE_START_MS = 900;
const SHOT_BOUNDARY_MS = 1_000;

app.on('window-all-closed', () => {});
process.env.VITE_DEV_SERVER_URL = '';
try { app.setPath('userData', path.join(runRoot, 'electron-user-data')); } catch { /* Electron may initialize this path early. */ }

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function findFixtureRoot() {
  const explicitRoot = process.env.PANDA_STAGE_ISSUE884_SOURCE_PROJECT_ROOT;
  if (explicitRoot) return path.resolve(explicitRoot);
  if (!existsSync(fixtureParent)) throw new Error(`Synthetic C01 fixture parent is missing: ${fixtureParent}`);
  const candidates = readdirSync(fixtureParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(fixtureParent, entry.name, 'Issue 867 diagonal dialogue.pandastage'))
    .filter((root) => existsSync(path.join(root, 'project.json')))
    .sort((left, right) => statSync(path.join(right, 'project.json')).mtimeMs -
      statSync(path.join(left, 'project.json')).mtimeMs);
  if (!candidates.length) throw new Error('No generated synthetic v14 C01 Project was found.');
  return candidates[0];
}

function syntheticWav(frequencyHz = 880, durationMs = 1_200) {
  const sampleRate = 48_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1_000);
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 480, (sampleCount - index) / 480);
    const sample = Math.round(0.035 * envelope * 32_767 * Math.sin(2 * Math.PI * frequencyHz * index / sampleRate));
    bytes.writeInt16LE(sample, 44 + index * 2);
  }
  return bytes;
}

function createFixture(projectRoot) {
  const original = ProjectSchema.parse(JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')));
  assert(original.schemaVersion === 14, `Expected C01 schema v14; received v${original.schemaVersion}.`);
  const project = structuredClone(original);
  const firstShot = project.shots[0];
  const firstDialogue = firstShot?.dialogues[0];
  const sourceClip = firstShot?.audioClips[0];
  const dialogueAsset = project.assets.find((asset) => asset.id === sourceClip?.assetId);
  assert(firstShot && firstDialogue && sourceClip && dialogueAsset?.kind === 'audio',
    'C01 fixture needs its original synthetic dialogue asset.');

  const cueBytes = syntheticWav();
  const cueAssetId = randomUUID();
  project.assets.push({
    ...dialogueAsset,
    id: cueAssetId,
    name: 'AU-02 synthetic cue',
    relativePath: 'assets/au02-synthetic-cue.wav',
    sha256: sha256(cueBytes),
    durationMs: 1_200,
    metadata: { status: 'ready', warnings: [] },
  });

  const dialogueClip = {
    ...sourceClip,
    id: randomUUID(),
    name: 'AU-02 first line',
    role: 'dialogue',
    startMs: 0,
    endMs: 800,
    offsetMs: 150,
    volume: 0.75,
  };
  const firstShortCue = {
    ...sourceClip,
    id: randomUUID(),
    name: 'AU-02 80ms short cue',
    role: 'sfx',
    assetId: cueAssetId,
    startMs: SHORT_CUE_START_MS,
    endMs: SHORT_CUE_END_MS,
    offsetMs: 120,
    volume: 0.5,
  };
  const cancelCue = {
    ...firstShortCue,
    id: randomUUID(),
    name: 'AU-02 future cue to cancel',
    startMs: CANCEL_CUE_START_MS,
    endMs: CANCEL_CUE_START_MS + 80,
    offsetMs: 220,
  };
  firstShot.durationMs = SHOT_BOUNDARY_MS;
  firstShot.audioClips = [dialogueClip, firstShortCue, cancelCue];
  firstShot.dialogues = [{
    ...firstDialogue,
    audioClipId: dialogueClip.id,
    startMs: 0,
    endMs: 800,
    text: 'AU-02 synthetic first line',
  }];
  firstShot.timelineEvents = [];

  const nextShot = structuredClone(firstShot);
  const layerIds = new Map(nextShot.layers.map((layer) => [layer.id, randomUUID()]));
  nextShot.id = randomUUID();
  nextShot.name = 'AU-02 next Shot';
  nextShot.durationMs = SHOT_BOUNDARY_MS;
  nextShot.dialogues = [];
  nextShot.timelineEvents = [];
  nextShot.layers = nextShot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id) }));
  nextShot.backgroundLayerId = nextShot.backgroundLayerId
    ? layerIds.get(nextShot.backgroundLayerId) ?? null
    : null;
  nextShot.audioClips = [{
    ...firstShortCue,
    id: randomUUID(),
    name: 'AU-02 next-Shot boundary cue',
    startMs: 0,
    endMs: 200,
    offsetMs: 320,
    volume: 0.8,
  }];
  project.shots.push(nextShot);

  const parsedProject = ProjectSchema.parse(project);
  const media = new Map();
  for (const asset of original.assets) {
    const absolutePath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(path.resolve(projectRoot), absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture asset escaped its Project root.');
    const bytes = readFileSync(absolutePath);
    assert(sha256(bytes) === asset.sha256, `Synthetic asset hash mismatch: ${asset.id}.`);
    media.set(asset.id, bytes);
  }
  media.set(cueAssetId, cueBytes);
  return { project: parsedProject, media, cueAssetId, originalAudioAssetId: dialogueAsset.id, nextShotId: nextShot.id };
}

function registerFixtureIpc(projectRoot, project, media, audioReads) {
  const resolvedRoot = path.resolve(projectRoot);
  const document = {
    projectRoot: resolvedRoot,
    projectFilePath: path.join(resolvedRoot, 'project.json'),
    project,
    migrated: false,
    sourceVersion: project.schemaVersion,
  };
  const assetFor = (id) => project.assets.find((asset) => asset.id === id);
  const register = (channel, handler) => ipcMain.handle(channel, handler);
  const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => path.resolve(request.projectRoot) === resolvedRoot
    ? { ok: true, value: document }
    : fail('PROJECT_NOT_FOUND', 'Unexpected Project root.', { projectRoot: request.projectRoot }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => path.resolve(request.projectRoot) === resolvedRoot
    ? { ok: true, document }
    : fail('RECENT_PROJECT_NOT_FOUND', 'Unexpected Project root.', { projectRoot: request.projectRoot }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    if (path.resolve(request.projectRoot) !== resolvedRoot) throw new Error('Unexpected Project write outside fixture.');
    return { ok: true, value: { ...document, project: request.project } };
  });
  for (const channel of [IPC_CHANNELS.AUTOSAVE_TRACK, IPC_CHANNELS.AUTOSAVE_UPDATE, IPC_CHANNELS.AUTOSAVE_STOP]) {
    register(channel, () => ({ ok: true }));
  }
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const asset = assetFor(request.assetId);
    const bytes = media.get(request.assetId);
    if (!asset || !bytes) return fail('ASSET_THUMBNAIL_READ_FAILED', 'Unknown fixture asset.', { assetId: request.assetId });
    return { ok: true, status: 'ready', assetId: asset.id, dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}` };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = assetFor(request.assetId);
    const bytes = media.get(request.assetId);
    if (!asset || asset.kind !== 'image' || !bytes || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return fail('ASSET_CANVAS_IMAGE_READ_FAILED', 'Fixture image integrity check failed.', { assetId: request.assetId });
    }
    return { ok: true, status: 'ready', assetId: asset.id, mimeType: asset.mimeType,
      width: asset.width, height: asset.height, byteLength: bytes.byteLength, bytes: new Uint8Array(bytes) };
  });
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, async (_event, request) => {
    const asset = assetFor(request.assetId);
    const bytes = media.get(request.assetId);
    const record = { assetId: request.assetId, startedAtMs: Date.now(), completedAtMs: null };
    audioReads.records.push(record);
    audioReads.active += 1;
    audioReads.maxActive = Math.max(audioReads.maxActive, audioReads.active);
    if (readDelayMs > 0) await delay(readDelayMs);
    audioReads.active -= 1;
    record.completedAtMs = Date.now();
    if (path.resolve(request.projectRoot) !== resolvedRoot || !asset || asset.kind !== 'audio' || !bytes ||
        asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return fail('ASSET_PREVIEW_AUDIO_READ_FAILED', 'Fixture audio integrity check failed.', { assetId: request.assetId });
    }
    return { ok: true, status: 'ready', assetId: asset.id, mimeType: asset.mimeType,
      byteLength: bytes.byteLength, bytes: new Uint8Array(bytes) };
  });
}

function browserWait(expression, message, timeoutMs = 30_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() < deadline) {
      try { if (${expression}) return true; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitFor(window, expression, message, timeoutMs) {
  return window.webContents.executeJavaScript(browserWait(expression, message, timeoutMs), true);
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source, true);
}

async function waitForMain(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(message);
}

async function openProject(window, projectRoot) {
  await waitFor(window,
    `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Project Center path input did not appear.');
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button')?.click();
  })()`);
  await waitFor(window,
    `Boolean(document.querySelector('[data-testid="editor-layout"]') && document.querySelector('[data-testid="project-canvas-stage"]'))`,
    'Synthetic v14 Project did not open in the real Editor.');
}

async function installNativeProbe(window) {
  await evaluate(window, `(() => {
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) throw new Error('Native AudioContext is unavailable.');
    const probe = window.__issue884Au02 = { contexts: [], sources: [], decodes: [], playbackStartedAtMs: null, rafCount: 0 };
    const readOverlay = () => document.querySelector('[data-testid="product-preview-overlay"]');
    const recordPlayback = () => {
      const overlay = readOverlay();
      if (overlay?.dataset.previewPlaying === 'true' && probe.playbackStartedAtMs === null) {
        probe.playbackStartedAtMs = Date.now();
      }
    };
    new MutationObserver(recordPlayback).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-preview-playing'] });
    const raf = () => { probe.rafCount += 1; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    window.AudioContext = class Issue884AudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const contextInfo = { context: this, analyser: null };
        this.__issue884ContextInfo = contextInfo;
        contextInfo.analyser = this.createAnalyser();
        contextInfo.analyser.fftSize = 2048;
        contextInfo.analyser.smoothingTimeConstant = 0;
        contextInfo.analyser.connect(this.destination);
        probe.contexts.push(contextInfo);
      }
      decodeAudioData(data, ...callbacks) {
        const startedAtMs = performance.now();
        const startedAtWallMs = Date.now();
        return super.decodeAudioData(data, ...callbacks).then((buffer) => {
          probe.decodes.push({ startedAtWallMs, durationMs: performance.now() - startedAtMs,
            decodedBytes: buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
            sampleRate: buffer.sampleRate, durationSeconds: buffer.duration });
          return buffer;
        });
      }
      createGain() {
        const gain = super.createGain();
        const connect = gain.connect.bind(gain);
        gain.connect = (destination) => connect(destination === this.destination
          ? this.__issue884ContextInfo.analyser
          : destination);
        return gain;
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const contextInfo = this.__issue884ContextInfo;
        const record = { contextInfo, startCount: 0, stopCount: 0, startArgs: null,
          contextTimeAtStartCall: null, previewTimeAtStartCallMs: null, wallTimeAtStartCallMs: null,
          stoppedBeforeScheduledStart: false, contextTimeAtStopMs: null, ended: false, endedAtContextTime: null };
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        source.start = (...args) => {
          const overlay = readOverlay();
          record.startCount += 1;
          record.startArgs = args;
          record.contextTimeAtStartCall = this.currentTime;
          record.previewTimeAtStartCallMs = Number(overlay?.dataset.previewTime ?? 0);
          record.wallTimeAtStartCallMs = Date.now();
          return start(...args);
        };
        source.stop = (...args) => {
          record.stopCount += 1;
          record.contextTimeAtStopMs = this.currentTime;
          record.stoppedBeforeScheduledStart = record.startArgs !== null &&
            this.currentTime < Number(record.startArgs[0]);
          return stop(...args);
        };
        source.addEventListener('ended', () => {
          record.ended = true;
          record.endedAtContextTime = this.currentTime;
        });
        probe.sources.push(record);
        return source;
      }
    };
  })()`);
}

async function readState(window) {
  return evaluate(window, `(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const probe = window.__issue884Au02;
    return {
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1),
      playing: overlay?.dataset.previewPlaying === 'true',
      range: overlay?.dataset.previewRange ?? null,
      shotId: overlay?.dataset.previewShotId ?? null,
      projectRevision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null,
      playbackStartedAtMs: probe?.playbackStartedAtMs ?? null,
      rafCount: probe?.rafCount ?? 0,
      contexts: probe?.contexts.map((item) => ({ state: item.context.state, currentTime: item.context.currentTime,
        sampleRate: item.context.sampleRate, rms: (() => { const samples = new Float32Array(item.analyser.fftSize);
          item.analyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); })() })) ?? [],
      sources: probe?.sources.map((item) => ({ startCount: item.startCount, stopCount: item.stopCount,
        startArgs: item.startArgs, contextTimeAtStartCall: item.contextTimeAtStartCall,
        previewTimeAtStartCallMs: item.previewTimeAtStartCallMs, wallTimeAtStartCallMs: item.wallTimeAtStartCallMs,
        stoppedBeforeScheduledStart: item.stoppedBeforeScheduledStart, contextTimeAtStopMs: item.contextTimeAtStopMs,
        ended: item.ended, endedAtContextTime: item.endedAtContextTime })) ?? [],
      decodeCount: probe?.decodes.length ?? 0,
      decodes: probe?.decodes ?? [],
      warning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null,
    };
  })()`);
}

async function click(window, selector) {
  await evaluate(window, `document.querySelector(${JSON.stringify(selector)})?.click()`);
  await delay(40);
}

async function seek(window, timeMs) {
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!input) throw new Error('Product Preview scrubber is missing.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false' &&
      Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) === ${timeMs}`,
    `Product Preview did not seek to ${timeMs}ms.`);
}

async function openPreview(window, expectedShotId) {
  await evaluate(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.');
  await click(window, '[data-testid="quick-action-play"]');
  await waitFor(window, `Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`,
    'Product Preview overlay did not mount.');
  await waitFor(window,
    `document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageShotId === ${JSON.stringify(expectedShotId)}`,
    'Product Preview did not become display-ready.');
}

async function pauseRenderer(debuggerSession) {
  let removeListener = () => {};
  const pausedEvent = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      removeListener();
      reject(new Error('Renderer did not enter the controlled audio scheduling pause.'));
    }, 5_000);
    const listener = (_event, method) => {
      if (method !== 'Debugger.paused') return;
      clearTimeout(timeout);
      removeListener();
      resolve();
    };
    removeListener = () => debuggerSession.removeListener('message', listener);
    debuggerSession.on('message', listener);
  });
  await debuggerSession.sendCommand('Debugger.pause');
  await pausedEvent;
}

async function attachRendererDebugger(window) {
  const debuggerSession = window.webContents.debugger;
  debuggerSession.attach('1.3');
  await debuggerSession.sendCommand('Debugger.enable');
  return debuggerSession;
}

async function pausedSnapshot(debuggerSession) {
  const response = await debuggerSession.sendCommand('Runtime.evaluate', {
    expression: `JSON.stringify({ previewTimeMs: Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1),
      rafCount: window.__issue884Au02?.rafCount ?? -1,
      contexts: window.__issue884Au02?.contexts.map(item => ({ currentTime: item.context.currentTime, state: item.context.state })) ?? [],
      sources: window.__issue884Au02?.sources.map(item => ({ startArgs: item.startArgs, stopCount: item.stopCount, ended: item.ended })) ?? [] })`,
    returnByValue: true,
  });
  return JSON.parse(response.result.value);
}

async function resumeRenderer(debuggerSession) {
  await debuggerSession.sendCommand('Debugger.resume');
  debuggerSession.detach();
}

async function run() {
  const projectRoot = findFixtureRoot();
  const { project, media, cueAssetId, originalAudioAssetId, nextShotId } = createFixture(projectRoot);
  const audioReads = { records: [], active: 0, maxActive: 0 };
  registerFixtureIpc(projectRoot, project, media, audioReads);
  const originalHash = sha256(readFileSync(path.join(projectRoot, 'project.json')));
  const receipt = {
    issue: 884,
    check: 'AU-02 L1 native Web Audio startup, short cue scheduling, cancellation, and Shot handoff',
    passed: false,
    classification: 'L1 native AudioContext graph; not physical speaker output or human listening acceptance',
    environment: { platform: process.platform, osRelease: os.release(), electron: process.versions.electron,
      chromium: process.versions.chrome, readDelayMs },
    fixture: { root: projectRoot, schemaVersion: project.schemaVersion, sourceProjectSha256: originalHash,
      shots: project.shots.map(({ id, durationMs }) => ({ id, durationMs })),
      originalAudioAssetId, syntheticCueAssetId: cueAssetId, nextShotId },
    startupGate: {},
    shortCueGap: {},
    futureCancellation: {},
    nextShotHandoff: {},
    resources: {},
    projectUnchanged: {},
  };
  let window = null;
  let debuggerSession = null;
  let failure = null;

  try {
    await app.whenReady();
    window = await createMainWindow({ show: true });
    window.setSize(1600, 1000);
    window.show();
    window.focus();
    window.webContents.focus();
    await openProject(window, projectRoot);
    const before = await evaluate(window, `({ revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undo: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null })`);
    await installNativeProbe(window);
    debuggerSession = await attachRendererDebugger(window);
    await openPreview(window, project.shots[0].id);

    await waitForMain(() => audioReads.records.length >= STARTUP_READ_TARGETS,
      'Startup preparation did not request both the first Dialogue and the first SFX assets.');
    const pending = await readState(window);
    receipt.startupGate.pendingReadCount = audioReads.records.filter((record) => record.completedAtMs === null).length;
    receipt.startupGate.previewWasPlayingBeforeAudioReady = pending.playing;
    receipt.startupGate.sourcesBeforeAudioReady = pending.sources.filter((source) => source.startCount > 0).length;
    assert(receipt.startupGate.pendingReadCount === STARTUP_READ_TARGETS, 'The bounded startup gate did not wait for both required audio assets.');
    assert(!pending.playing && receipt.startupGate.sourcesBeforeAudioReady === 0,
      'Preview clock or an audio source started before required audio preparation finished.');

    await waitFor(window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
        window.__issue884Au02?.sources.filter(source => source.startCount > 0).length === 2`,
      'Prepared first line and short SFX did not start after the audio gate.');
    const afterGate = await readState(window);
    const startupStartedAtMs = afterGate.playbackStartedAtMs;
    const firstReadAtMs = Math.min(...audioReads.records.map((record) => record.startedAtMs));
    receipt.startupGate = {
      ...receipt.startupGate,
      waitedMs: startupStartedAtMs - firstReadAtMs,
      readMs: audioReads.records.map((record) => ({ assetId: record.assetId,
        durationMs: record.completedAtMs - record.startedAtMs })),
      decodeMs: afterGate.decodes.map((decode) => ({ durationMs: decode.durationMs,
        decodedBytes: decode.decodedBytes, sampleRate: decode.sampleRate })),
      startedAtPreviewTimeMs: afterGate.previewTimeMs,
      sourceCountAfterReady: afterGate.sources.filter((source) => source.startCount > 0).length,
    };
    assert(receipt.startupGate.waitedMs >= readDelayMs - 15 && receipt.startupGate.waitedMs < 1_000,
      `Startup wait ${receipt.startupGate.waitedMs}ms did not reflect the bounded cold-read delay.`);
    assert(afterGate.warning === null, `Unexpected Preview warning after successful startup: ${afterGate.warning}.`);

    await waitFor(window,
      `window.__issue884Au02?.sources.some(source => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs < ${SHORT_CUE_START_MS})`,
      'The prepared 80ms short SFX was not scheduled at startup.');
    const initialState = await readState(window);
    const shortCue = initialState.sources.find((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs < SHORT_CUE_START_MS);
    assert(shortCue, 'Could not identify the startup short cue source.');
    const shortLeadMs = (Number(shortCue.startArgs[0]) - shortCue.contextTimeAtStartCall) * 1_000;
    receipt.shortCueGap = { cueStartMs: SHORT_CUE_START_MS, cueEndMs: SHORT_CUE_END_MS,
      sourceStartCount: shortCue.startCount, scheduledLeadMs: shortLeadMs,
      startArgs: shortCue.startArgs, contextTimeAtSchedule: shortCue.contextTimeAtStartCall,
      previewTimeAtScheduleMs: shortCue.previewTimeAtStartCallMs,
      stopCountAtObservation: shortCue.stopCount, stoppedBeforeScheduledStart: shortCue.stoppedBeforeScheduledStart };
    assert(shortCue.startCount === 1 && !shortCue.stoppedBeforeScheduledStart && shortLeadMs > 20 && shortLeadMs < 400,
      `Short cue was not accepted as one future native schedule (lead ${shortLeadMs}ms).`);

    const beforeGap = await readState(window);
    await pauseRenderer(debuggerSession);
    const pausedAtStart = await pausedSnapshot(debuggerSession);
    const pauseStartedAtMs = Date.now();
    await delay(500);
    const pausedAtEnd = await pausedSnapshot(debuggerSession);
    const rendererPauseMs = Date.now() - pauseStartedAtMs;
    const audioContextAdvanceMs = (pausedAtEnd.contexts[0].currentTime - pausedAtStart.contexts[0].currentTime) * 1_000;
    await resumeRenderer(debuggerSession);
    debuggerSession = null;
    await waitFor(window,
      `(() => { const cue = window.__issue884Au02?.sources.find(source => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs < ${SHORT_CUE_START_MS});
        return cue?.ended === true && Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= ${SHORT_CUE_END_MS}; })()`,
      'Native short cue did not finish through the controlled renderer update gap.');
    const afterGap = await readState(window);
    const resumedShortCue = afterGap.sources.find((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs < SHORT_CUE_START_MS);
    const previewGapMs = afterGap.previewTimeMs - pausedAtStart.previewTimeMs;
    receipt.shortCueGap = { ...receipt.shortCueGap, rendererPauseMs, audioContextAdvanceMs,
      rafCallbacksDuringPause: pausedAtEnd.rafCount - pausedAtStart.rafCount,
      previewTimeBeforePauseAttemptMs: beforeGap.previewTimeMs,
      previewTimeBeforeGapMs: pausedAtStart.previewTimeMs, previewTimeAfterGapMs: afterGap.previewTimeMs,
      previewGapMs, nativeEnded: resumedShortCue?.ended ?? false,
      nativeEndTimeSeconds: resumedShortCue?.endedAtContextTime ?? null,
      stopCount: resumedShortCue?.stopCount ?? null, startCount: resumedShortCue?.startCount ?? null,
      missed: false, duplicates: Math.max(0, afterGap.sources.filter((source) => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 &&
        source.previewTimeAtStartCallMs < SHORT_CUE_START_MS).length - 1) };
    assert(rendererPauseMs >= 400 && audioContextAdvanceMs >= 400 && previewGapMs >= 350 && pausedAtStart.previewTimeMs < SHORT_CUE_END_MS &&
      afterGap.previewTimeMs >= SHORT_CUE_END_MS, 'Controlled rAF/render gap did not cross the complete short cue window.');
    assert(pausedAtEnd.rafCount === pausedAtStart.rafCount,
      'Renderer rAF callback ran while the controlled debugger pause was active.');
    assert(resumedShortCue?.ended && !resumedShortCue.stoppedBeforeScheduledStart && resumedShortCue.startCount === 1,
      'Native short cue was stopped, missed, or scheduled more than once during the renderer gap.');

    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'Preview did not pause before future-source cancellation.');
    await seek(window, 600);
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window,
      `window.__issue884Au02?.sources.some(source => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[1]) - 0.22) < 0.001 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs >= 500)`,
      'The future Shot-local cue was not scheduled before its 900ms boundary.');
    const beforeCancel = await readState(window);
    const cancelSource = beforeCancel.sources.find((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[1]) - 0.22) < 0.001 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs >= 500);
    assert(cancelSource, 'Could not identify the future source targeted for cancellation.');
    const cancelLeadMs = (Number(cancelSource.startArgs[0]) - cancelSource.contextTimeAtStartCall) * 1_000;
    assert(cancelLeadMs > 80, `Cancellation cue was not still in the future (${cancelLeadMs}ms lead).`);
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'Preview did not pause to cancel a future AudioBufferSourceNode.');
    const afterCancel = await readState(window);
    const cancelledSource = afterCancel.sources.find((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[1]) - 0.22) < 0.001 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.08) < 0.001 && source.previewTimeAtStartCallMs >= 500);
    assert(cancelledSource?.stopCount === 1 && cancelledSource.stoppedBeforeScheduledStart,
      'Pause did not stop the future source before its scheduled start.');
    await waitFor(window,
      `window.__issue884Au02?.contexts[0]?.context?.currentTime >= ${Number(cancelSource.startArgs[0]) + 0.18}`,
      'Native AudioContext did not pass the cancelled cue boundary.');
    const afterCancelledBoundary = await readState(window);
    receipt.futureCancellation = { clipStartMs: CANCEL_CUE_START_MS,
      sourceScheduledWhen: cancelSource.startArgs[0], contextTimeAtStartCall: cancelSource.contextTimeAtStartCall,
      leadMsAtSchedule: cancelLeadMs, contextTimeAtStop: cancelledSource.contextTimeAtStopMs,
      stoppedBeforeScheduledStart: cancelledSource.stoppedBeforeScheduledStart,
      stopCount: cancelledSource.stopCount, ended: cancelledSource.ended,
      contextPassedScheduledEnd: afterCancelledBoundary.contexts[0].currentTime >= Number(cancelSource.startArgs[0]) + 0.18,
      activeSourcesAfterPause: afterCancelledBoundary.sources.filter((source) => source.startCount > 0 &&
        source.stopCount === 0 && !source.ended).length,
      rmsAfterCancelledBoundary: afterCancelledBoundary.contexts[0].rms,
      readCountBefore: audioReads.records.length };
    assert(receipt.futureCancellation.activeSourcesAfterPause === 0 && receipt.futureCancellation.rmsAfterCancelledBoundary < 0.0001,
      'A future source produced native output after pause/cancellation.');

    await seek(window, 900);
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window,
      `window.__issue884Au02?.sources.some(source => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[1]) - 0.32) < 0.001 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.2) < 0.001 &&
        source.previewTimeAtStartCallMs >= 800 && source.previewTimeAtStartCallMs < ${SHOT_BOUNDARY_MS})`,
      'Next-Shot boundary cue was not scheduled while the previous Shot was current.');
    const beforeHandoff = await readState(window);
    const boundarySource = beforeHandoff.sources.find((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[1]) - 0.32) < 0.001 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.2) < 0.001 &&
      source.previewTimeAtStartCallMs >= 800 && source.previewTimeAtStartCallMs < SHOT_BOUNDARY_MS);
    assert(boundarySource, 'Could not identify the next-Shot source before handoff.');
    const boundaryLeadMs = (Number(boundarySource.startArgs[0]) - boundarySource.contextTimeAtStartCall) * 1_000;
    await waitFor(window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewShotId === ${JSON.stringify(nextShotId)}`,
      'Product Preview did not cross into the next Shot.');
    await waitFor(window,
      `window.__issue884Au02?.sources.some(source => source.startCount === 1 &&
        Math.abs(Number(source.startArgs?.[1]) - 0.32) < 0.001 &&
        Math.abs(Number(source.startArgs?.[2]) - 0.2) < 0.001 &&
        source.previewTimeAtStartCallMs >= 800 && source.previewTimeAtStartCallMs < ${SHOT_BOUNDARY_MS} &&
        source.ended === true)`,
      'Scheduled next-Shot cue did not finish naturally after the Shot boundary.');
    const afterHandoff = await readState(window);
    const endedBoundarySource = afterHandoff.sources.filter((source) => source.startCount === 1 &&
      Math.abs(Number(source.startArgs?.[1]) - 0.32) < 0.001 &&
      Math.abs(Number(source.startArgs?.[2]) - 0.2) < 0.001 &&
      source.previewTimeAtStartCallMs >= 800 && source.previewTimeAtStartCallMs < SHOT_BOUNDARY_MS).at(-1);
    const boundaryExpectedEnd = endedBoundarySource
      ? Number(endedBoundarySource.startArgs[0]) + Number(endedBoundarySource.startArgs[2])
      : Number.NaN;
    const boundaryEndErrorMs = endedBoundarySource?.endedAtContextTime === null || endedBoundarySource?.endedAtContextTime === undefined
      ? null
      : (endedBoundarySource.endedAtContextTime - boundaryExpectedEnd) * 1_000;
    receipt.nextShotHandoff = { shotBoundaryMs: SHOT_BOUNDARY_MS,
      scheduledAtPreviewTimeMs: boundarySource.previewTimeAtStartCallMs,
      scheduledLeadMs: boundaryLeadMs, startArgs: boundarySource.startArgs,
      startCount: endedBoundarySource?.startCount ?? null, stopCount: endedBoundarySource?.stopCount ?? null,
      stoppedBeforeScheduledStart: endedBoundarySource?.stoppedBeforeScheduledStart ?? null,
      endedNaturally: endedBoundarySource?.ended ?? false, endTimingErrorMs: boundaryEndErrorMs,
      audioReadsAfterWarmup: audioReads.records.length };
    assert(boundarySource.previewTimeAtStartCallMs < SHOT_BOUNDARY_MS && boundaryLeadMs > 0 && boundaryLeadMs <= 400,
      'Next-Shot source was not scheduled within the 400ms lookahead before the boundary.');
    assert(endedBoundarySource?.startCount === 1 && !endedBoundarySource.stoppedBeforeScheduledStart &&
      endedBoundarySource.ended && boundaryEndErrorMs !== null && boundaryEndErrorMs >= -30 && boundaryEndErrorMs <= 60,
      'Next-Shot source was interrupted or duplicated at handoff.');
    assert(audioReads.records.length === STARTUP_READ_TARGETS,
      'Warm replay or next-Shot handoff performed an unexpected duplicate source read.');

    await click(window, '[data-testid="product-preview-close"]');
    await waitFor(window, '!document.querySelector(\'[data-testid="product-preview-overlay"]\')',
      'Close did not unmount Product Preview.');
    await waitFor(window,
      'window.__issue884Au02.sources.filter(source => source.startCount > 0 && source.stopCount === 0 && !source.ended).length === 0 && window.__issue884Au02.contexts.every(item => item.context.state === "closed")',
      'Closing Preview leaked a native source or AudioContext.');
    const after = await evaluate(window, `({ revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undo: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null })`);
    receipt.projectUnchanged = { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) };
    assert(receipt.projectUnchanged.unchanged, 'Preview changed Project revision or History state.');

    const finalState = await readState(window);
    receipt.resources = {
      actualConcurrentAudioReadsMax: audioReads.maxActive,
      audioReadCount: audioReads.records.length,
      audioReads: audioReads.records.map((record) => ({ assetId: record.assetId,
        durationMs: record.completedAtMs - record.startedAtMs })),
      decodeCount: finalState.decodeCount,
      decodedBytes: finalState.decodes.reduce((total, decode) => total + decode.decodedBytes, 0),
      nativeContexts: finalState.contexts.length,
      contextsClosed: finalState.contexts.every((context) => context.state === 'closed'),
      nativeNodesCreated: finalState.sources.length,
      maximumScheduledOrActiveNodes: 0,
      futureSourcesStoppedBeforeStart: finalState.sources.filter((source) => source.stoppedBeforeScheduledStart).length,
      maximumDecodedCacheBudgetBytes: 64 * 1024 * 1024,
    };
    receipt.resources.maximumScheduledOrActiveNodes = Math.max(
      ...[afterGate, afterGap, beforeCancel, afterCancelledBoundary, beforeHandoff, afterHandoff]
        .map((state) => state.sources.filter((source) => source.startCount > 0 && source.stopCount === 0 && !source.ended).length),
    );
    assert(receipt.resources.actualConcurrentAudioReadsMax <= 4, 'Audio reads exceeded the four-task bound.');
    assert(receipt.resources.decodedBytes <= receipt.resources.maximumDecodedCacheBudgetBytes,
      'Synthetic decoded PCM exceeded the existing decoded-cache budget.');
    receipt.passed = true;
  } catch (error) {
    failure = error;
    receipt.failure = { message: error.message, stack: error.stack };
    if (window && !window.isDestroyed()) {
      try { receipt.runtimeSnapshot = await readState(window); } catch { /* Renderer may be unavailable after a failure. */ }
    }
  } finally {
    if (debuggerSession && window && !window.isDestroyed()) {
      try { debuggerSession.detach(); } catch { /* Window destruction also detaches its debugger. */ }
    }
    if (window && !window.isDestroyed()) window.destroy();
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resultPath, JSON.stringify({ ...receipt, generatedAt: new Date().toISOString(), resultPath }, null, 2));
  }

  console.log(`RESULT_PATH=${resultPath}`);
  if (failure) {
    console.error(failure.stack ?? failure.message);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ passed: receipt.passed, startupWaitMs: receipt.startupGate.waitedMs,
      shortCueStartCount: receipt.shortCueGap.startCount, rendererGapMs: receipt.shortCueGap.previewGapMs,
      cancelledFutureNode: receipt.futureCancellation.stoppedBeforeScheduledStart,
      nextShotLeadMs: receipt.nextShotHandoff.scheduledLeadMs, contextsClosed: receipt.resources.contextsClosed }));
  }
  app.exit(failure ? 1 : 0);
}

run().catch((error) => {
  console.error(error.stack ?? error.message);
  app.exit(1);
});
