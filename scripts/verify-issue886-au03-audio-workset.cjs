const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { AssetPreviewAudioService } = require('../dist-electron/main/services/AssetPreviewAudioService.js');
const { MediaInspectionService } = require('../dist-electron/main/services/MediaInspectionService.js');
const { resolveProjectAssetPath } = require('../dist-electron/main/services/project-asset-path.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

const acceptanceRoot = process.env.PANDA_STAGE_ISSUE886_ROOT ?? 'D:\\PandaStage-Acceptance\\issue886-au03';
const expectReuse = process.env.PANDA_STAGE_ISSUE886_EXPECT_REUSE === '1';
const useCase = process.env.PANDA_STAGE_ISSUE886_USE_CASE ?? 'C01';
const runRoot = mkdtempSync(path.join(acceptanceRoot, expectReuse ? 'native-candidate-' : 'native-baseline-'));
const resultPath = path.join(runRoot, expectReuse ? 'C01-L1-candidate.json' : 'C01-L1-baseline.json');

app.on('window-all-closed', () => {});
process.env.VITE_DEV_SERVER_URL = '';
try { app.setPath('userData', path.join(runRoot, 'electron-user-data')); } catch { /* Initialized early by Electron. */ }

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function measureValidatedReadComponents(projectRoot, project, asset) {
  const times = {};
  let startedAt = performance.now();
  ProjectSchema.parse(project);
  times.projectSchemaValidationMs = performance.now() - startedAt;

  startedAt = performance.now();
  const sourcePath = await resolveProjectAssetPath(projectRoot, asset.relativePath, { preservePermissionErrors: true });
  times.pathContainmentRealpathMs = performance.now() - startedAt;
  assert(sourcePath, 'C05 component measurement could not resolve the in-project audio path.');

  startedAt = performance.now();
  const sourceStats = await stat(sourcePath);
  times.fileStatMs = performance.now() - startedAt;
  assert(sourceStats.isFile() && sourceStats.size > 0, 'C05 component measurement did not find a regular source file.');

  startedAt = performance.now();
  const inspected = await new MediaInspectionService().inspect(sourcePath, asset.mimeType);
  times.mediaSignatureInspectionMs = performance.now() - startedAt;
  assert(inspected.kind === 'audio' && inspected.mimeType === asset.mimeType,
    'C05 component measurement found a media type mismatch.');

  startedAt = performance.now();
  const bytes = await readFile(sourcePath);
  times.fileReadMs = performance.now() - startedAt;

  startedAt = performance.now();
  const actualHash = sha256(bytes);
  times.sha256Ms = performance.now() - startedAt;
  assert(actualHash === asset.sha256, 'C05 component measurement hash did not match the Project.');

  startedAt = performance.now();
  const copiedBytes = structuredClone(new Uint8Array(bytes));
  times.structuredCloneCopyProxyMs = performance.now() - startedAt;
  times.ipcPayloadByteLength = copiedBytes.byteLength;
  times.componentTotalMs = times.projectSchemaValidationMs + times.pathContainmentRealpathMs +
    times.fileStatMs + times.mediaSignatureInspectionMs + times.fileReadMs + times.sha256Ms +
    times.structuredCloneCopyProxyMs;
  times.note = 'Separate warm-path component samples; structuredClone is a copy proxy, not an isolated Electron IPC measurement.';
  return times;
}

function findFixture() {
  const explicit = process.env.PANDA_STAGE_ISSUE886_PROJECT_ROOT;
  if (explicit) return { projectRoot: path.resolve(explicit), manifestPath: null };
  const candidates = readdirSync(acceptanceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(acceptanceRoot, entry.name, 'manifest.json'))
    .filter((manifestPath) => existsSync(manifestPath))
    .map((manifestPath) => ({ manifestPath, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }))
    .filter(({ manifest }) => existsSync(path.join(manifest.projectPath, 'project.json')))
    .sort((left, right) => statSync(right.manifestPath).mtimeMs - statSync(left.manifestPath).mtimeMs);
  if (!candidates.length) throw new Error('No generated Issue #886 AU-03 fixture found. Run evidence:issue886-au03-fixture first.');
  return { projectRoot: path.resolve(candidates[0].manifest.projectPath), manifestPath: candidates[0].manifestPath };
}

function loadFixture(projectRoot) {
  const projectPath = path.join(projectRoot, 'project.json');
  const projectBytes = readFileSync(projectPath);
  const project = ProjectSchema.parse(JSON.parse(projectBytes.toString('utf8')));
  assert(project.schemaVersion === 14, `Expected schema v14; received v${project.schemaVersion}.`);
  const imageMedia = new Map();
  for (const asset of project.assets) {
    if (asset.kind !== 'image') continue;
    const absolutePath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(path.resolve(projectRoot), absolutePath);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), `Synthetic image escaped fixture root: ${asset.id}.`);
    const bytes = readFileSync(absolutePath);
    assert(sha256(bytes) === asset.sha256, `Synthetic image hash mismatch: ${asset.id}.`);
    imageMedia.set(asset.id, bytes);
  }
  const largeAsset = project.assets.find((asset) => asset.kind === 'audio' && asset.name.includes('48 kHz stereo'));
  const controlAsset = project.assets.find((asset) => asset.kind === 'audio' && asset.name.includes('44.1 kHz stereo'));
  assert(largeAsset && controlAsset, 'Fixture is missing either long BGM or the 44.1 kHz control.');
  assert(project.shots.filter((shot) => shot.audioClips.some((clip) => clip.assetId === largeAsset.id)).length >= 2,
    'The same 48 kHz BGM must be referenced from at least two Shots.');
  return { project, projectBytes, imageMedia, largeAsset, controlAsset };
}

function registerFixtureIpc(projectRoot, project, imageMedia, service, readMetrics) {
  const resolvedRoot = path.resolve(projectRoot);
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
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, async (_event, request) => {
    const key = `${request.projectRoot}\\u0000${request.assetId}\\u0000${request.sha256}`;
    const startedAt = performance.now();
    const record = { assetId: request.assetId, sha256: request.sha256, startedAtMs: Date.now(), completedAtMs: null,
      durationMs: null, byteLength: null, shared: activeReads.has(key), status: null };
    readMetrics.requests.push(record);
    let read = activeReads.get(key);
    if (!read) {
      readMetrics.actualReadTasks += 1;
      readMetrics.active += 1;
      readMetrics.maxActive = Math.max(readMetrics.maxActive, readMetrics.active);
      read = service.read(request);
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

async function waitForQuiet(window, readMetrics, message, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = null;
  while (Date.now() < deadline) {
    const state = await readState(window);
    if (readMetrics.active === 0 && state.decodeInFlight === 0) {
      if (quietSince === null) quietSince = Date.now();
      if (Date.now() - quietSince >= 350) return state;
    } else {
      quietSince = null;
    }
    await delay(50);
  }
  throw new Error(message);
}

async function click(window, selector) {
  await evaluate(window, `document.querySelector(${JSON.stringify(selector)})?.click()`);
  await delay(60);
}

async function openProject(window, projectRoot) {
  await waitFor(window, `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Project Center path input did not appear.');
  await evaluate(window, `(() => { const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(projectRoot)}); input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button')?.click(); })()`);
  await waitFor(window, `Boolean(document.querySelector('[data-testid="editor-layout"]') && document.querySelector('[data-testid="project-canvas-stage"]'))`,
    'The synthetic v14 Project did not open in the Editor.');
}

async function installProbe(window) {
  await evaluate(window, `(() => {
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) throw new Error('Native AudioContext is unavailable.');
    const probe = window.__issue886Au03 = { contexts: [], sources: [], decodes: [], bufferInfo: new WeakMap(),
      nextContextId: 1, nextBufferId: 1, decodeInFlight: 0, readRoundTrips: [], readWrapperInstalled: false,
      playbackStartedAtMs: null };
    const overlay = () => document.querySelector('[data-testid="product-preview-overlay"]');
    new MutationObserver(() => { if (overlay()?.dataset.previewPlaying === 'true' && probe.playbackStartedAtMs === null) {
      probe.playbackStartedAtMs = Date.now(); } }).observe(document.body, { subtree: true, attributes: true,
      attributeFilter: ['data-preview-playing'] });
    window.AudioContext = class Issue886AudioContext extends NativeAudioContext {
      constructor(...args) { super(...args); this.__issue886Id = probe.nextContextId++;
        probe.contexts.push({ id: this.__issue886Id, ref: new WeakRef(this), sampleRate: this.sampleRate }); }
      decodeAudioData(data, ...callbacks) {
        const startedAt = performance.now(); const record = { contextId: this.__issue886Id, inputByteLength: data.byteLength,
          startedAtMs: Date.now(), durationMs: null, sampleRate: null, channels: null, length: null, pcmBytes: null,
          bufferId: null, status: 'running' }; probe.decodeInFlight += 1;
        return super.decodeAudioData(data, ...callbacks).then(buffer => {
          const info = { bufferId: probe.nextBufferId++, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels,
            length: buffer.length, durationSeconds: buffer.duration,
            pcmBytes: buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT };
          probe.bufferInfo.set(buffer, info); Object.assign(record, info, { durationMs: performance.now() - startedAt,
            status: 'ready' }); probe.decodes.push(record); return buffer;
        }, error => { record.durationMs = performance.now() - startedAt; record.status = 'failed';
          record.errorName = error?.name ?? 'Error'; probe.decodes.push(record); throw error;
        }).finally(() => { probe.decodeInFlight -= 1; });
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const record = { contextId: this.__issue886Id, startCount: 0, stopCount: 0, startArgs: null,
          previewTimeAtStartCallMs: null, projectTimeAtStartCallMs: null, bufferId: null, sampleRate: null, channels: null, pcmBytes: null,
          active: false, ended: false };
        const nativeStart = source.start.bind(source); const nativeStop = source.stop.bind(source);
        source.start = (...args) => { const info = probe.bufferInfo.get(source.buffer); record.startCount += 1;
          record.startArgs = args; record.previewTimeAtStartCallMs = Number(overlay()?.dataset.previewTime ?? -1);
          record.projectTimeAtStartCallMs = Number(overlay()?.dataset.previewProjectTime ?? -1);
          if (info) Object.assign(record, info); record.active = true; return nativeStart(...args); };
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

async function openPreview(window, shotId) {
  await evaluate(window, `(() => { const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click(); })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.');
  await click(window, '[data-testid="quick-action-play"]');
  await waitFor(window, `Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`, 'Product Preview did not mount.');
  await waitFor(window, `document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true' &&
    document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' &&
    document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageShotId === ${JSON.stringify(shotId)}`,
    'Product Preview was not display-ready for the expected Shot.');
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

async function readState(window) {
  return evaluate(window, `(() => { const probe = window.__issue886Au03; const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const decoded = probe?.decodes.filter(item => item.status === 'ready') ?? [];
    const unique = new Map(decoded.map(item => [item.bufferId, item.pcmBytes]));
    const active = (probe?.sources ?? []).filter(item => item.active && item.startCount > 0);
    const activeUnique = new Map(active.map(item => [item.bufferId, item.pcmBytes]));
    return { previewRange: overlay?.dataset.previewRange ?? null,
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1), projectTimeMs: Number(overlay?.dataset.previewProjectTime ?? -1),
      playing: overlay?.dataset.previewPlaying === 'true',
      projectRevision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null,
      playbackStartedAtMs: probe?.playbackStartedAtMs ?? null, decodeInFlight: probe?.decodeInFlight ?? 0,
      decodeCount: probe?.decodes.length ?? 0, decodes: probe?.decodes ?? [],
      reads: probe?.readRoundTrips ?? [], readWrapperInstalled: probe?.readWrapperInstalled ?? false,
      contexts: probe?.contexts.map(item => ({ id: item.id, state: item.ref.deref()?.state ?? 'collected',
        sampleRate: item.sampleRate, currentTime: item.ref.deref()?.currentTime ?? null })) ?? [],
      sources: probe?.sources ?? [], activeSourceCount: active.length,
      activeUniquePcmBytes: [...activeUnique.values()].reduce((sum, value) => sum + value, 0),
      uniqueDecodedPcmBytes: [...unique.values()].reduce((sum, value) => sum + value, 0),
      uniqueDecodedBufferCount: unique.size,
      warning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null };
  })()`);
}

async function stopIfPlaying(window) {
  const state = await readState(window);
  if (state.playing) await click(window, '[data-testid="product-preview-play-pause"]');
  await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
    'Preview did not pause.');
}

async function run() {
  const { projectRoot, manifestPath } = findFixture();
  const { project, projectBytes, imageMedia, largeAsset, controlAsset } = loadFixture(projectRoot);
  const firstShot = project.shots[0];
  const boundaryTimeMs = firstShot?.durationMs ?? 0;
  const controlShotStartMs = project.shots.slice(0, 2).reduce((total, shot) => total + shot.durationMs, 0);
  const firstLargeClip = firstShot?.audioClips.find((clip) => clip.assetId === largeAsset.id) ?? null;
  const largeAssetFileByteLength = statSync(path.join(projectRoot, largeAsset.relativePath)).size;
  const firstLargeClipDurationMs = firstLargeClip ? firstLargeClip.endMs - firstLargeClip.startMs : null;
  const targetSourceDurationPredicate = useCase === 'C04-short-use' && firstLargeClipDurationMs !== null
    ? `item.durationSeconds > 0 && item.durationSeconds <= ${firstLargeClipDurationMs / 1_000 + 0.01}`
    : 'item.durationSeconds > 179';
  const isTargetLargeBgmDecode = (item) => item.status === 'ready' && item.channels === 2 &&
    ((item.durationSeconds > 179 && item.inputByteLength === largeAssetFileByteLength) ||
      (useCase === 'C04-short-use' && firstLargeClipDurationMs !== null &&
        item.durationSeconds <= firstLargeClipDurationMs / 1_000 + 0.01 &&
        item.inputByteLength < largeAssetFileByteLength));
  if (useCase === 'C04-short-use') {
    assert(firstShot && firstLargeClip, 'C04 short-use sample must place the long source in the first Shot.');
    assert(firstLargeClip.endMs - firstLargeClip.startMs <= 10_000,
      'C04 short-use sample must limit the first long-source clip to at most 10 seconds.');
  }
  const resolvedRoot = path.resolve(projectRoot);
  const service = new AssetPreviewAudioService({
    getCurrentProjectSnapshot: (root) => path.resolve(root) === resolvedRoot ? { project } : null,
    enableValidatedHashIndex: true,
  });
  const readMetrics = { requests: [], actualReadTasks: 0, active: 0, maxActive: 0 };
  registerFixtureIpc(projectRoot, project, imageMedia, service, readMetrics);
  const initialProjectHash = sha256(projectBytes);
  const receipt = {
    issue: 886,
    check: useCase === 'C04-short-use'
      ? 'C04 L1 native AudioContext: 10-second clip from original v14 180-second synthetic BGM'
      : expectReuse
      ? 'C01 L1 native AudioContext candidate on original v14 180s synthetic BGM fixture'
      : 'C01 L1 native AudioContext baseline on original v14 180s synthetic BGM fixture',
    classification: 'L1 native Electron AudioContext/source graph and production AssetPreviewAudioService; not physical speaker output',
    baselineHead: 'b4e8a0260f9428d39216462a4355f4a732353d91',
    observedAt: new Date().toISOString(),
    environment: { platform: process.platform, release: os.release(), electron: process.versions.electron,
      chromium: process.versions.chrome, expectReuse },
    fixture: { projectRoot, schemaVersion: project.schemaVersion, projectSha256: initialProjectHash,
      generatedManifest: manifestPath,
      largeAsset: { id: largeAsset.id, sha256: largeAsset.sha256, sampleRateFromFileHz: 48_000,
        channelsInFile: 2, durationMs: largeAsset.durationMs },
      controlAsset: { id: controlAsset.id, sha256: controlAsset.sha256, sampleRateFromFileHz: 44_100,
        channelsInFile: 2, durationMs: controlAsset.durationMs },
      shots: project.shots.map((shot) => ({ id: shot.id, durationMs: shot.durationMs,
        audioAssetIds: shot.audioClips.map((clip) => clip.assetId),
        audioClips: shot.audioClips.map(({ assetId, role, startMs, endMs, offsetMs }) =>
          ({ assetId, role, startMs, endMs, offsetMs })) })) },
    phases: {},
    mainAudioRead: {},
    c04ShortUse: null,
    resourceShutdown: {},
    projectUnchanged: false,
    resultPath,
    redBaselineReproduction: null,
  };
  let window = null;
  try {
    await app.whenReady();
    window = await createMainWindow({ show: true });
    window.setSize(1600, 1000);
    window.show(); window.focus(); window.webContents.focus();
    await openProject(window, projectRoot);
    const before = await evaluate(window, `({ revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null,
      undo: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null })`);
    await installProbe(window);
    await openPreview(window, project.shots[0].id);
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
      window.__issue886Au03?.sources.some(item => item.startCount > 0 && item.channels === 2 && ${targetSourceDurationPredicate})`,
      'Startup did not start the long 48 kHz synthetic BGM source.');
    const startup = await waitForQuiet(window, readMetrics, 'Startup reads or native decodes did not settle.');
    receipt.phases.startup = startup;
    receipt.mainAudioRead = { ipcRequests: readMetrics.requests.length, actualValidatedReadTasks: readMetrics.actualReadTasks,
      maximumConcurrentTasks: readMetrics.maxActive, requests: readMetrics.requests,
      rendererRoundTripWrapperInstalled: startup.readWrapperInstalled, rendererRoundTrips: startup.reads };
    receipt.phases.startup.largeBgmDecodeCount = startup.decodes.filter(isTargetLargeBgmDecode).length;
    receipt.phases.startup.largeBgmDecodedPcmBytesPerObject = startup.decodes.find(isTargetLargeBgmDecode)?.pcmBytes ?? null;
    if (useCase === 'C04-short-use' && firstLargeClip) {
      const decode = startup.decodes.find(isTargetLargeBgmDecode);
      const source = decode && startup.sources.find((item) => item.bufferId === decode.bufferId);
      const clipDurationMs = firstLargeClip.endMs - firstLargeClip.startMs;
      const selectedRangePcmBytes = decode
        ? Math.round(decode.sampleRate * decode.channels * 4 * clipDurationMs / 1_000)
        : null;
      receipt.c04ShortUse = {
        assetId: largeAsset.id,
        assetSha256: largeAsset.sha256,
        sourceDurationMs: largeAsset.durationMs,
        sourceSampleRateHz: decode?.sampleRate ?? null,
        sourceChannels: decode?.channels ?? null,
        decodeInputByteLength: decode?.inputByteLength ?? null,
        sourceClipStartMs: firstLargeClip.offsetMs,
        clipDurationMs,
        decodeDurationMs: decode?.durationMs ?? null,
        decodedDurationSeconds: decode?.durationSeconds ?? null,
        decodedPcmBytes: decode?.pcmBytes ?? null,
        fullSourcePcmBytesAtDecodeRate: decode
          ? Math.round(decode.sampleRate * decode.channels * largeAsset.durationMs / 1_000 * 4) : null,
        selectedRangePcmEquivalentBytes: selectedRangePcmBytes,
        fullDecodeToSelectedRangePcmRatio: selectedRangePcmBytes && decode
          ? decode.pcmBytes / selectedRangePcmBytes : null,
        sourceStartArgs: source?.startArgs ?? null,
        classification: 'L1 native AudioBuffer and scheduled source duration; selected-range PCM is a sample-count estimate, not an observed allocation.',
      };
    }
    receipt.phases.startup.firstReadToPlaybackMs = startup.playbackStartedAtMs === null || readMetrics.requests.length === 0
      ? null : startup.playbackStartedAtMs - readMetrics.requests[0].startedAtMs;
    receipt.phases.startup.warningObserved = startup.warning;
    receipt.phases.startup.warningIsConsistentWithTimeout = startup.warning !== null &&
      receipt.phases.startup.firstReadToPlaybackMs !== null &&
      receipt.phases.startup.firstReadToPlaybackMs >= 500;

    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'Preview did not pause after startup.');
    const beforeResume = await readState(window);
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
      window.__issue886Au03?.sources.some(item => item.active && item.startCount > 0 && item.channels === 2 && ${targetSourceDurationPredicate})`,
      'Pause/resume did not restart the long BGM.');
    receipt.phases.pauseResume = { before: beforeResume,
      after: await waitForQuiet(window, readMetrics, 'Pause/resume reads or decodes did not settle.') };

    const beforeReplay = await readState(window);
    await click(window, '[data-testid="product-preview-replay"]');
    await waitFor(window, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
      Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewProjectTime ?? 999999) < 150 &&
      window.__issue886Au03?.sources.some(item => item.active && item.startCount > 0 && item.channels === 2 && ${targetSourceDurationPredicate})`,
      'Replay did not reset to the opening and restart the long BGM.');
    receipt.phases.replay = { before: beforeReplay,
      after: await waitForQuiet(window, readMetrics, 'Replay reads or decodes did not settle.') };

    await stopIfPlaying(window);
    const boundarySeekMs = Math.max(0, boundaryTimeMs - 200);
    await seek(window, boundarySeekMs);
    const beforeBoundary = await readState(window);
    receipt.phases.sameSourceShotBoundary = { before: beforeBoundary };
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `window.__issue886Au03?.sources.filter(item => item.startCount > 0 && item.channels === 2 &&
      ${targetSourceDurationPredicate} &&
      item.projectTimeAtStartCallMs >= ${Math.max(0, boundaryTimeMs - 300)} &&
      item.projectTimeAtStartCallMs <= ${boundaryTimeMs}).length >= 2`,
      'The same-source next-Shot boundary did not schedule both native sources.', 12_000);
    const afterBoundary = await readState(window);
    const boundarySources = afterBoundary.sources.filter((item) => item.startCount > 0 && item.channels === 2 &&
      (useCase === 'C04-short-use' ? item.durationSeconds <= firstLargeClipDurationMs / 1_000 + 0.01 : item.durationSeconds > 179) &&
      item.projectTimeAtStartCallMs >= Math.max(0, boundaryTimeMs - 300) &&
      item.projectTimeAtStartCallMs <= boundaryTimeMs);
    receipt.phases.sameSourceShotBoundary = { before: beforeBoundary, after: afterBoundary,
      sourceBufferIds: boundarySources.map((item) => item.bufferId), uniqueSourceBufferCount: new Set(boundarySources.map((item) => item.bufferId)).size,
      addedLargeBgmDecodes: afterBoundary.decodes.filter(isTargetLargeBgmDecode).length -
        beforeBoundary.decodes.filter(isTargetLargeBgmDecode).length };

    await stopIfPlaying(window);
    const beforeControl = await readState(window);
    await seek(window, controlShotStartMs);
    await click(window, '[data-testid="product-preview-play-pause"]');
    await waitFor(window, `window.__issue886Au03?.sources.some(item => item.startCount > 0 &&
      item.projectTimeAtStartCallMs >= ${controlShotStartMs} &&
      item.projectTimeAtStartCallMs < ${controlShotStartMs + 1_000} && item.durationSeconds > 179)`,
      'The 44.1 kHz control BGM did not start.');
    const afterControl = await waitForQuiet(window, readMetrics, 'The control source reads or decodes did not settle.');
    receipt.phases.control44100 = { before: beforeControl, after: afterControl,
      decodeRecords: afterControl.decodes.filter((item) => item.inputByteLength === 31_752_044) };

    await stopIfPlaying(window);
    const hashIndexTrialService = new AssetPreviewAudioService({
      getCurrentProjectSnapshot: (root) => path.resolve(root) === resolvedRoot ? { project } : null,
      enableValidatedHashIndex: true,
    });
    const hashIndexRequest = { projectRoot, assetId: largeAsset.id, sha256: largeAsset.sha256 };
    const hashIndexColdStartedAt = performance.now();
    const hashIndexColdResponse = await hashIndexTrialService.read(hashIndexRequest);
    const hashIndexColdDurationMs = performance.now() - hashIndexColdStartedAt;
    assert(hashIndexColdResponse.ok, 'C05 cold hash-index trial did not return validated source bytes.');
    const hashIndexAfterCold = hashIndexTrialService.getHashValidationIndexSnapshot();
    const hashIndexWarmStartedAt = performance.now();
    const hashIndexWarmResponse = await hashIndexTrialService.read(hashIndexRequest);
    const hashIndexWarmDurationMs = performance.now() - hashIndexWarmStartedAt;
    assert(hashIndexWarmResponse.ok, 'C05 warm hash-index trial did not return validated source bytes.');
    const hashIndexAfterWarm = hashIndexTrialService.getHashValidationIndexSnapshot();
    receipt.s09 = {
      componentSamples: await measureValidatedReadComponents(projectRoot, project, largeAsset),
      hashIndexTrial: {
        classification: 'L1 Main AssetPreviewAudioService direct-call comparison; excludes Electron IPC and renderer scheduling.',
        coldDurationMs: hashIndexColdDurationMs,
        warmDurationMs: hashIndexWarmDurationMs,
        sourceByteLength: hashIndexColdResponse.byteLength,
        coldIndex: hashIndexAfterCold,
        warmIndex: hashIndexAfterWarm,
      },
      validatedLargeReadServiceMs: readMetrics.requests
        .filter((item) => item.assetId === largeAsset.id && item.status === 'ready')
        .map((item) => item.durationMs),
      largeDecodeMs: afterControl.decodes
        .filter(isTargetLargeBgmDecode)
        .map((item) => item.durationMs),
    };
    const largeReadMs = receipt.s09.validatedLargeReadServiceMs;
    const largeDecodeMs = receipt.s09.largeDecodeMs;
    const readMedianMs = largeReadMs.length
      ? [...largeReadMs].sort((left, right) => left - right)[Math.floor(largeReadMs.length / 2)]
      : null;
    const decodeMedianMs = largeDecodeMs.length
      ? [...largeDecodeMs].sort((left, right) => left - right)[Math.floor(largeDecodeMs.length / 2)]
      : null;
    receipt.s09.coldPathReadShare = readMedianMs === null || decodeMedianMs === null
      ? null : readMedianMs / (readMedianMs + decodeMedianMs);
    receipt.s09.decision = readMedianMs !== null && decodeMedianMs !== null && readMedianMs > decodeMedianMs
      ? 'TRIGGERED'
      : 'NOT_TRIGGERED';
    receipt.s09.decisionReason = receipt.s09.decision === 'TRIGGERED'
      ? 'The validated cold read path took longer than native decode in the same candidate run.'
      : 'The validated cold read path did not exceed native decode, and repeat same-source reads were removed by the decoded-buffer reuse.';

    const largeDecodeRecords = afterControl.decodes.filter(isTargetLargeBgmDecode);
    receipt.ipcHandoff = largeDecodeRecords.map((decode) => {
      const read = readMetrics.requests
        .filter((item) => item.assetId === largeAsset.id && item.status === 'ready' &&
          item.completedAtMs <= decode.startedAtMs)
        .sort((left, right) => right.completedAtMs - left.completedAtMs)[0];
      return { sourceReadByteLength: read?.byteLength ?? null, decodeInputByteLength: decode.inputByteLength,
        mainReadCompletedAtMs: read?.completedAtMs ?? null,
        nativeDecodeStartedAtMs: decode.startedAtMs,
        serviceCompletionToDecodeStartMs: read ? decode.startedAtMs - read.completedAtMs : null,
        note: 'Includes IPC payload transfer and renderer scheduling; not a pure structured-clone measurement.' };
    });

    const beforeClose = await readState(window);
    const contextIdsBeforeClose = beforeClose.contexts.map((item) => item.id);
    await click(window, '[data-testid="product-preview-close"]');
    await waitFor(window, `!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Preview did not close.');
    await delay(150);
    const shutdown = await evaluate(window, `window.__issue886Au03.contexts.filter(item => ${JSON.stringify(contextIdsBeforeClose)}.includes(item.id))
      .map(item => ({ id: item.id, state: item.ref.deref()?.state ?? 'collected' }))`);
    receipt.resourceShutdown = { contextIds: contextIdsBeforeClose, contextsAfterClose: shutdown,
      sourceCount: beforeClose.sources.length, activeSourceCountBeforeClose: beforeClose.activeSourceCount,
      activeSourceCountAfterPause: beforeClose.activeSourceCount };
    receipt.mainAudioRead = { ipcRequests: readMetrics.requests.length, actualValidatedReadTasks: readMetrics.actualReadTasks,
      maximumConcurrentTasks: readMetrics.maxActive, requests: readMetrics.requests,
      hashValidationIndex: service.getHashValidationIndexSnapshot(),
      rendererRoundTripWrapperInstalled: afterControl.readWrapperInstalled,
      rendererRoundTrips: afterControl.reads };
    receipt.projectUnchanged = sha256(readFileSync(path.join(projectRoot, 'project.json'))) === initialProjectHash &&
      before.revision === (await evaluate(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? null`)) &&
      before.undo === (await evaluate(window, `document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? null`));
    receipt.redBaselineReproduction = { largeSourceOverBudgetOnDevice:
        (receipt.phases.startup.largeBgmDecodedPcmBytesPerObject ?? 0) > 64 * 1024 * 1024,
      duplicatedStartupReadOrDecode: receipt.phases.startup.largeBgmDecodeCount > 1,
      extraPauseResumeDecode: receipt.phases.pauseResume.after.decodes.filter((item) => item.status === 'ready' &&
        item.channels === 2 && item.durationSeconds > 179).length > receipt.phases.startup.largeBgmDecodeCount,
      immediateBoundaryCoalesced: receipt.phases.sameSourceShotBoundary.uniqueSourceBufferCount === 1 };
    if (!receipt.projectUnchanged) throw new Error('The synthetic fixture project revision, history, or bytes changed during playback.');
    if (expectReuse) {
      if (useCase === 'C04-short-use') {
        assert(receipt.c04ShortUse?.decodedDurationSeconds <= firstLargeClipDurationMs / 1_000 + 0.01 &&
          receipt.c04ShortUse?.decodeInputByteLength < largeAssetFileByteLength &&
          receipt.c04ShortUse?.fullDecodeToSelectedRangePcmRatio <= 1.01,
        'The bounded WAV proxy did not decode only the selected long-BGM interval.');
        assert(receipt.phases.pauseResume.after.decodes.filter(isTargetLargeBgmDecode).length === 1,
          'The short WAV proxy was decoded again after pause/resume.');
        assert(receipt.phases.replay.after.decodes.filter(isTargetLargeBgmDecode).length === 1,
          'The short WAV proxy was decoded again after Replay.');
        assert(receipt.phases.sameSourceShotBoundary.uniqueSourceBufferCount === 1 &&
          receipt.phases.sameSourceShotBoundary.addedLargeBgmDecodes === 0,
        'The same short WAV proxy was not reused across matching Shot intervals.');
      } else {
        assert(receipt.phases.startup.largeBgmDecodeCount === 1,
          'Candidate decoded the large BGM more than once during warmup/start.');
        assert(receipt.phases.pauseResume.after.decodes.filter(isTargetLargeBgmDecode).length === 1,
          'Candidate re-decoded the recent large BGM after pause/resume.');
        assert(receipt.phases.replay.after.decodes.filter(isTargetLargeBgmDecode).length === 1,
          'Candidate re-decoded the recent large BGM after Replay.');
        assert(receipt.phases.sameSourceShotBoundary.uniqueSourceBufferCount === 1 &&
          receipt.phases.sameSourceShotBoundary.addedLargeBgmDecodes === 0,
        'Candidate did not reuse the current large buffer across the same-source Shot boundary.');
        assert(receipt.s09.decision === 'NOT_TRIGGERED',
          'The C05 data indicates the read path is the dominant cold-start stage and requires S09 review.');
      }
    }
    receipt.passed = true;
  } catch (error) {
    receipt.passed = false;
    receipt.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try { if (window) receipt.lastState = await readState(window); } catch { /* Renderer may already be gone. */ }
    receipt.mainAudioRead = { ipcRequests: readMetrics.requests.length, actualValidatedReadTasks: readMetrics.actualReadTasks,
      maximumConcurrentTasks: readMetrics.maxActive, requests: readMetrics.requests };
  } finally {
    try { writeFileSync(resultPath, JSON.stringify(receipt, null, 2) + '\n'); }
    catch { /* Preserve the verifier result when a receipt path is unavailable. */ }
    try { window?.destroy(); } catch { /* The verifier window may already be closed. */ }
    app.quit();
  }
  console.log(JSON.stringify({ passed: receipt.passed, resultPath, redBaselineReproduction: receipt.redBaselineReproduction,
    audioReadRequests: receipt.mainAudioRead?.requests?.map(({ assetId, status, byteLength, durationMs, shared }) =>
      ({ assetId, status, byteLength, durationMs, shared })) ?? [], error: receipt.error ?? null }, null, 2));
  app.exit(receipt.passed ? 0 : 1);
}

run().catch((error) => {
  console.error(error.stack ?? error);
  app.quit();
  process.exitCode = 1;
});
