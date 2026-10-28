const { app, ipcMain } = require('electron');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

const acceptanceRoot = 'D:\\PandaStage-Acceptance';
const fixtureParent = process.env.PANDA_STAGE_ISSUE880_SOURCE_PROJECT_ROOT ??
  process.env.PANDA_STAGE_ISSUE872_SOURCE_PROJECT_ROOT ??
  path.join(acceptanceRoot, 'issue867-thm01');
mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = mkdtempSync(path.join(acceptanceRoot, 'issue880-r5-clock-'));
const userDataRoot = path.join(runRoot, 'electron-user-data');
const resultPath = path.join(runRoot, 'receipt.json');
const TARGET_TIME_MS = 1_000;

app.on('window-all-closed', () => {});
process.env.VITE_DEV_SERVER_URL = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findSyntheticProjectRoot() {
  const explicitRoot = process.env.PANDA_STAGE_ISSUE880_SOURCE_PROJECT_ROOT ??
    process.env.PANDA_STAGE_ISSUE872_SOURCE_PROJECT_ROOT;
  if (explicitRoot) return path.resolve(explicitRoot);
  if (!existsSync(fixtureParent)) {
    throw new Error(`Synthetic Issue 867 fixture parent is missing: ${fixtureParent}`);
  }
  const candidates = readdirSync(fixtureParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(fixtureParent, entry.name, 'Issue 867 diagonal dialogue.pandastage'))
    .filter((candidate) => existsSync(path.join(candidate, 'project.json')))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (!candidates.length) throw new Error('No generated synthetic Issue 867 project was found.');
  return candidates[0];
}

function loadFixture(projectRoot) {
  const sourceProject = ProjectSchema.parse(JSON.parse(
    readFileSync(path.join(projectRoot, 'project.json'), 'utf8'),
  ));
  assert(sourceProject.schemaVersion === 14, `Expected v14 fixture, received v${sourceProject.schemaVersion}.`);
  const project = createIssue882Fixture(sourceProject);
  const shot = project.shots[0];
  assert(shot, 'Synthetic fixture has no Shot.');
  const activeClips = shot.audioClips.filter(
    (clip) => clip.startMs <= TARGET_TIME_MS && TARGET_TIME_MS < clip.endMs,
  );
  assert(activeClips.length > 0, `No audio clip is active at ${TARGET_TIME_MS}ms.`);
  return { project, shot, activeClips };
}

function createIssue882Fixture(sourceProject) {
  const project = structuredClone(sourceProject);
  const shot = project.shots[0];
  assert(shot, 'Synthetic Issue 867 fixture has no Shot to augment.');
  const sourceDialogue = shot.dialogues[0];
  const sourceClip = shot.audioClips[0];
  assert(sourceDialogue && sourceClip, 'Synthetic fixture needs one dialogue and audio clip.');

  const expiredClipId = randomUUID();
  const currentClipId = randomUUID();
  shot.audioClips = [
    { ...sourceClip, id: expiredClipId, name: 'Expired dialogue', startMs: 300, endMs: 1_200 },
    { ...sourceClip, id: currentClipId, name: 'Current dialogue', startMs: 1_300, endMs: 2_700 },
  ];
  shot.dialogues = [
    { ...sourceDialogue, id: randomUUID(), audioClipId: expiredClipId, startMs: 300, endMs: 1_200, text: 'Expired dialogue' },
    { ...sourceDialogue, id: randomUUID(), audioClipId: currentClipId, startMs: 1_300, endMs: 2_700, text: 'Current dialogue' },
  ];

  if (process.env.PANDA_STAGE_ISSUE882_SINGLE_SHOT !== '1') {
    const nextShot = structuredClone(shot);
    const layerIds = new Map(nextShot.layers.map((layer) => [layer.id, randomUUID()]));
    nextShot.id = randomUUID();
    nextShot.name = 'Short second shot';
    nextShot.durationMs = 1_800;
    nextShot.dialogues = [];
    nextShot.audioClips = [];
    nextShot.timelineEvents = [];
    nextShot.layers = nextShot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id) }));
    nextShot.backgroundLayerId = nextShot.backgroundLayerId
      ? layerIds.get(nextShot.backgroundLayerId) ?? null
      : null;
    project.shots.push(nextShot);
  }

  return ProjectSchema.parse(project);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function registerFixtureIpc(projectRoot, project) {
  const resolvedRoot = path.resolve(projectRoot);
  const projectFilePath = path.join(resolvedRoot, 'project.json');
  const assetBytes = new Map(project.assets.map((asset) => [
    asset.id,
    readFileSync(path.resolve(resolvedRoot, asset.relativePath)),
  ]));
  const document = {
    projectRoot: resolvedRoot,
    projectFilePath,
    project,
    migrated: false,
    sourceVersion: project.schemaVersion,
  };
  const assetFor = (request) => project.assets.find((asset) => asset.id === request.assetId);
  const register = (channel, handler) => ipcMain.handle(channel, handler);

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) =>
    path.resolve(request.projectRoot) === resolvedRoot
      ? { ok: true, value: document }
      : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Unexpected project root.', projectRoot: request.projectRoot } });
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    path.resolve(request.projectRoot) === resolvedRoot
      ? { ok: true, document }
      : { ok: false, error: { code: 'RECENT_PROJECT_NOT_FOUND', message: 'Unexpected project root.', projectRoot: request.projectRoot } });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    if (path.resolve(request.projectRoot) !== resolvedRoot) throw new Error('Unexpected project write outside the fixture.');
    return { ok: true, value: { ...document, project: request.project } };
  });
  for (const channel of [IPC_CHANNELS.AUTOSAVE_TRACK, IPC_CHANNELS.AUTOSAVE_UPDATE, IPC_CHANNELS.AUTOSAVE_STOP]) {
    register(channel, () => ({ ok: true }));
  }
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const asset = assetFor(request);
    const bytes = assetBytes.get(request.assetId);
    return {
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl: `data:${asset?.mimeType ?? 'image/png'};base64,${bytes?.toString('base64') ?? ''}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = assetFor(request);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'image' || !bytes || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', message: 'Fixture image integrity check failed.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, (_event, request) => {
    const asset = assetFor(request);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || asset.kind !== 'audio' || !bytes || asset.sha256 !== request.sha256 || sha256(bytes) !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED', message: 'Fixture audio integrity check failed.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
}
function browserWait(expression, message, timeout = 30_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitFor(window, expression, message, timeout) {
  return window.webContents.executeJavaScript(browserWait(expression, message, timeout), true);
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source, true);
}

async function openProject(window, projectRoot) {
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'))`,
    'Project Center path input did not appear.',
  );
  await evaluate(window, `(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="editor-layout"]') &&
      document.querySelector('[data-testid="project-canvas-stage"]'))`,
    'Synthetic v14 project did not open in the real Editor.',
  );
}

async function installAudioProbe(window) {
  await evaluate(window, `(() => {
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) throw new Error('Native AudioContext is unavailable.');
    const probe = window.__issue880AudioProbe = { contexts: [], sources: [], starts: 0, stops: 0 };
    window.AudioContext = class Issue880AudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        probe.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const record = { active: false, startCount: 0, stopCount: 0, startArgs: null };
        probe.sources.push(record);
        const nativeStart = source.start.bind(source);
        const nativeStop = source.stop.bind(source);
        source.start = (...args) => {
          record.active = true;
          record.startCount += 1;
          record.startArgs = args;
          probe.starts += 1;
          return nativeStart(...args);
        };
        source.stop = (...args) => {
          record.active = false;
          record.stopCount += 1;
          probe.stops += 1;
          return nativeStop(...args);
        };
        source.addEventListener('ended', () => { record.active = false; });
        return source;
      }
    };
  })()`);
}

async function installPreviewClockProbe(window) {
  await evaluate(window, `(() => {
    const events = [];
    window.__pandaPreviewDiagnostics = {
      events,
      record(event, atMs, detail) {
        if (event !== 'raf') return;
        events.push({ event, atMs, ...detail });
        if (events.length > 256) events.shift();
      },
    };
  })()`);
}

async function openPreview(window, expectedShotId) {
  await evaluate(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.',
  );
  await evaluate(window, `(() => {
    const trigger = document.querySelector('[data-testid="quick-action-play"]');
    trigger?.focus({ preventScroll: true });
    trigger?.click();
  })()`);
  await waitFor(
    window,
    `Boolean(document.querySelector('[data-testid="product-preview-overlay"]'))`,
    'Product Preview overlay did not mount.',
  );
  await waitFor(
    window,
    `document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' &&
      document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageShotId === ${JSON.stringify(expectedShotId)}`,
    'Product Preview did not become display-ready.',
  );
}

async function readState(window) {
  return evaluate(window, `(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
    const probe = window.__issue880AudioProbe ?? { contexts: [], sources: [], starts: 0, stops: 0 };
    let layerVisuals = [];
    try { layerVisuals = JSON.parse(stage?.dataset.layerVisualStateJson ?? '[]'); } catch {}
    return {
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1),
      playing: overlay?.dataset.previewPlaying === 'true',
      range: overlay?.dataset.previewRange ?? null,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      stageTimeMs: Number(stage?.dataset.stageTime ?? -1),
      stageShotId: stage?.dataset.stageShotId ?? null,
      captionText: stage?.dataset.captionText ?? '',
      layerVisuals,
      starts: probe.starts,
      stops: probe.stops,
      startedSources: probe.sources.filter((source) => source.startCount > 0).map((source) => ({ ...source })),
      activeSources: probe.sources.filter((source) => source.active).length,
      contextStates: probe.contexts.map((context) => context.state),
      audioWarning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null,
    };
  })()`);
}

async function runFrontstageStall(window) {
  await evaluate(window, `(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    if (!overlay || overlay.dataset.previewPlaying !== 'true' || document.visibilityState !== 'visible') {
      throw new Error('The 500ms stall requires a visible, playing Product Preview.');
    }
    const record = window.__issue882Stall = {
      baselineTimeMs: Number(overlay.dataset.previewTime ?? -1),
      startedAtMs: null,
      releasedAtMs: null,
      blockedMs: null,
      maxRafGapMs: 0,
      lastRafTimestamp: null,
      rafSamples: 0,
      firstPostStallMaster: null,
      firstPostStallStage: null,
    };
    const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
    const recordCommit = () => {
      if (record.releasedAtMs === null) return;
      const nextTimeMs = Number(overlay.dataset.previewTime ?? -1);
      if (nextTimeMs > record.baselineTimeMs && record.firstPostStallMaster === null) {
        record.firstPostStallMaster = {
          committedAtMs: performance.now(),
          previewTimeMs: nextTimeMs,
          playing: overlay.dataset.previewPlaying === 'true',
          range: overlay.dataset.previewRange ?? null,
          visibility: document.visibilityState,
        };
      }
      if (record.firstPostStallStage !== null) return;
      const stageTimeMs = Number(stage?.dataset.stageTime ?? -1);
      if (stageTimeMs <= record.baselineTimeMs || Math.abs(stageTimeMs - nextTimeMs) > 50) return;
      let layerVisuals = [];
      try { layerVisuals = JSON.parse(stage?.dataset.layerVisualStateJson ?? '[]'); } catch {}
      record.firstPostStallStage = {
        committedAtMs: performance.now(),
        previewTimeMs: nextTimeMs,
        stageTimeMs,
        playing: overlay.dataset.previewPlaying === 'true',
        range: overlay.dataset.previewRange ?? null,
        visibility: document.visibilityState,
        stageShotId: stage?.dataset.stageShotId ?? null,
        captionText: stage?.dataset.captionText ?? '',
        layerVisuals,
      };
    };
    const observer = new MutationObserver(recordCommit);
    observer.observe(overlay, { attributes: true, attributeFilter: ['data-preview-time', 'data-preview-playing'] });
    if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['data-stage-time', 'data-caption-text', 'data-layer-visual-state-json'] });
    const trackRaf = (timestamp) => {
      if (record.lastRafTimestamp !== null) record.maxRafGapMs = Math.max(record.maxRafGapMs, timestamp - record.lastRafTimestamp);
      record.lastRafTimestamp = timestamp;
      record.rafSamples += 1;
      requestAnimationFrame(trackRaf);
    };
    requestAnimationFrame(trackRaf);
    return { baselineTimeMs: record.baselineTimeMs, visibility: document.visibilityState };
  })()`);

  // Pause JavaScript execution in the actual Electron renderer target. This
  // produces a real frontstage rAF gap while the BrowserWindow remains visible.
  const debuggerSession = window.webContents.debugger;
  let attached = false;
  let paused = false;
  let rendererPauseMs;
  let pauseBaseline;
  try {
    debuggerSession.attach('1.3');
    attached = true;
    await debuggerSession.sendCommand('Debugger.enable');
    await debuggerSession.sendCommand('Runtime.enable');
    await evaluate(window, `new Promise((resolve) => {
      requestAnimationFrame((timestamp) => {
        const record = window.__issue882Stall;
        const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
        record.baselineTimeMs = Number(overlay?.dataset.previewTime ?? -1);
        record.startedAtMs = timestamp;
        record.lastRafTimestamp = timestamp;
        record.maxRafGapMs = 0;
        record.rafSamples = 0;
        resolve(true);
      });
    })`);
    const pausedEvent = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        debuggerSession.removeListener('message', onMessage);
        reject(new Error('Electron renderer did not enter the requested debugger pause.'));
      }, 5_000);
      const onMessage = (_event, method) => {
        if (method !== 'Debugger.paused') return;
        clearTimeout(timeout);
        debuggerSession.removeListener('message', onMessage);
        resolve();
      };
      debuggerSession.on('message', onMessage);
    });
    await debuggerSession.sendCommand('Debugger.pause');
    await pausedEvent;
    paused = true;
    const pausedSnapshot = await debuggerSession.sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
        const rafs = window.__pandaPreviewDiagnostics?.events ?? [];
        const latestRaf = [...rafs].reverse().find((item) => Number.isFinite(item.requestedTimeMs));
        const audio = window.__issue880AudioProbe;
        return {
          domTimeMs: Number(overlay?.dataset.previewTime ?? -1),
          masterTimeMs: latestRaf?.requestedTimeMs ?? Number(overlay?.dataset.previewTime ?? -1),
          latestRafAtMs: latestRaf?.atMs ?? null,
          startsAtPause: audio?.starts ?? 0,
          sourceStartArgsAtPause: audio?.sources.filter((source) => source.startCount > 0).map((source) => source.startArgs) ?? [],
        };
      })()`,
      returnByValue: true,
    });
    pauseBaseline = pausedSnapshot.result?.value ?? null;
    const pauseStartedAt = Date.now();
    await delay(500);
    rendererPauseMs = Date.now() - pauseStartedAt;
    await debuggerSession.sendCommand('Debugger.resume');
    paused = false;
    await evaluate(window, `(() => {
      const record = window.__issue882Stall;
      if (!record) return;
      record.releasedAtMs = performance.now();
      record.blockedMs = ${rendererPauseMs};
    })()`);
  } finally {
    if (paused) {
      try { await debuggerSession.sendCommand('Debugger.resume'); } catch { /* The target may have resumed during failure cleanup. */ }
    }
    if (attached) {
      try { debuggerSession.detach(); } catch { /* The renderer may already be closing. */ }
    }
  }

  await waitFor(
    window,
    'Boolean(window.__issue882Stall?.firstPostStallMaster && window.__issue882Stall?.firstPostStallStage)',
    'The Preview and Stage did not commit a coherent time update after the foreground renderer stall.',
  );
  const stallRecord = await evaluate(window, 'window.__issue882Stall');
  await waitFor(
    window,
    'window.__issue880AudioProbe?.sources.filter((source) => source.active).length === 1 && window.__issue880AudioProbe.starts >= 2',
    'Audio did not reconcile to the one dialogue active after the renderer stall.',
  );
  const afterAudio = await readState(window);
  const startedSources = afterAudio.startedSources;
  const latestOffsetSeconds = startedSources.at(-1)?.startArgs?.[1] ?? null;
  return {
    baselineTimeMs: stallRecord.baselineTimeMs,
    baselineDomTimeMs: pauseBaseline?.domTimeMs ?? stallRecord.baselineTimeMs,
    baselineMasterTimeMs: pauseBaseline?.masterTimeMs ?? stallRecord.baselineTimeMs,
    latestRafAtPauseMs: pauseBaseline?.latestRafAtMs ?? null,
    startsAtPause: pauseBaseline?.startsAtPause ?? 0,
    sourceStartArgsAtPause: pauseBaseline?.sourceStartArgsAtPause ?? [],
    visibilityBeforeStall: 'visible',
    rendererPauseMs,
    maxRafGapMs: stallRecord.maxRafGapMs,
    rafSamples: stallRecord.rafSamples,
    firstPostStallMaster: stallRecord.firstPostStallMaster,
    firstPostStallStage: stallRecord.firstPostStallStage,
    audioAfterCommit: {
      starts: afterAudio.starts,
      stops: afterAudio.stops,
      activeSources: afterAudio.activeSources,
      latestOffsetSeconds,
      sourceStartArgs: startedSources.map((source) => source.startArgs),
    },
  };
}

async function runPausedRangeLifecycle(window, secondShotId) {
  await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
    'Explicit pause did not stop Product Preview before the range-switch check.',
  );
  await waitFor(
    window,
    'window.__issue880AudioProbe?.sources.filter((source) => source.active).length === 0',
    'Explicit pause left a native audio voice active before the range-switch check.',
  );
  const afterPause = await readState(window);
  const transitions = [];
  for (const [range, tabIndex] of [['shot', 1], ['project', 0]]) {
    await evaluate(window, `document.querySelectorAll('[data-testid="product-preview-range"] [role="tab"]')[${tabIndex}]?.click()`);
    await waitFor(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewRange === ${JSON.stringify(range)}`,
      `Product Preview did not switch to the ${range} range.`,
    );
    await delay(260);
    const state = await readState(window);
    transitions.push({ range, state });
    if (range === 'shot' && secondShotId) {
      await evaluate(window, `document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]')?.click()`);
      await waitFor(window,
        `Boolean(document.querySelector('[data-testid="shot-list-view"] [data-shot-id="${secondShotId}"] button'))`,
        'Shot List did not expose the second synthetic Shot while Preview was open.');
      await evaluate(window,
        `document.querySelector('[data-testid="shot-list-view"] [data-shot-id="${secondShotId}"] button')?.click()`);
      await waitFor(
        window,
        `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewShotId === ${JSON.stringify(secondShotId)}`,
        'Product Preview did not follow the current Shot selection while the Shot range was active.',
      );
      await delay(260);
      const afterShotSelection = await readState(window);
      transitions.push({ range: 'shot-selection', state: afterShotSelection });
    }
  }
  return {
    afterPause,
    transitions,
    stayedPaused: transitions.every(({ state }) => !state.playing && state.activeSources === 0 && state.previewTimeMs === 0),
    noAudioStarts: transitions.every(({ state }) => state.starts === afterPause.starts),
  };
}

async function runEndOfRangeLifecycle(window, durationMs) {
  await evaluate(window, `document.querySelectorAll('[data-testid="product-preview-range"] [role="tab"]')[1]?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewRange === 'shot'`,
    'Product Preview did not enter Shot range for the end-of-playback check.',
  );
  await evaluate(window, `document.querySelector('[data-testid="product-preview-replay"]')?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
    'Explicit Replay did not start the selected Shot range.',
  );
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false' &&
      Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= ${durationMs}`,
    'Product Preview did not stop at the selected Shot end.',
    durationMs + 10_000,
  );
  const atEnd = await readState(window);
  await delay(260);
  const afterEndWait = await readState(window);
  await evaluate(window, `document.querySelectorAll('[data-testid="product-preview-range"] [role="tab"]')[0]?.click()`);
  await waitFor(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewRange === 'project' &&
      document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
    'Returning to Project range after playback end restarted Product Preview.',
  );
  return {
    atEnd: { timeMs: atEnd.previewTimeMs, playing: atEnd.playing, starts: atEnd.starts, activeSources: atEnd.activeSources },
    after260ms: { timeMs: afterEndWait.previewTimeMs, playing: afterEndWait.playing, starts: afterEndWait.starts, activeSources: afterEndWait.activeSources },
    didNotRestart: !afterEndWait.playing && afterEndWait.previewTimeMs === atEnd.previewTimeMs && afterEndWait.starts === atEnd.starts && afterEndWait.activeSources === 0,
  };
}

async function configureElectronPaths() {
  for (const [name, location] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(location, { recursive: true });
    try { app.setPath(name, location); } catch { /* A path may be immutable after readiness. */ }
  }
}

async function run() {
  const projectRoot = findSyntheticProjectRoot();
  const { project, shot, activeClips } = loadFixture(projectRoot);
  registerFixtureIpc(projectRoot, project);
  const baselineCase = process.env.PANDA_STAGE_ISSUE882_BASELINE_CASE ?? null;
  const receipt = {
    issue: 882,
    parentVerifierIssue: 880,
    check: 'Issue 882 real Electron autoplay lifecycle and 500ms foreground renderer stall',
    passed: false,
    fixture: {
      schemaVersion: project.schemaVersion,
      projectId: project.id,
      shotId: shot.id,
      shots: project.shots.map(({ id, name, durationMs }) => ({ id, name, durationMs })),
      projectDurationMs: project.shots.reduce((total, item) => total + item.durationMs, 0),
      activeClipsAtTargetTime: activeClips.length,
      targetTimeMs: TARGET_TIME_MS,
      splitDialogue: shot.dialogues.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text })),
    },
    baselineCase,
  };
  let window = null;
  let failure = null;
  try {
    await app.whenReady();
    await configureElectronPaths();
    window = await createMainWindow({ show: true });
    window.setSize(1600, 1000);
    window.show();
    window.focus();
    window.webContents.focus();
    await openProject(window, projectRoot);
    await installAudioProbe(window);
    await installPreviewClockProbe(window);
    await openPreview(window, shot.id);
    await waitFor(
      window,
      `document.visibilityState === 'visible' &&
        document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
        Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= ${TARGET_TIME_MS}`,
      'Product Preview did not autoplay to the audio checkpoint.',
    );
    await waitFor(
      window,
      `(() => {
        const probe = window.__issue880AudioProbe;
        return probe?.sources.filter((source) => source.active).length === ${activeClips.length};
      })()`,
      'Native audio voices did not match the clips active at the checkpoint.',
    );

    if (baselineCase !== 'range') {
      const frontstageStall = await runFrontstageStall(window);
      const startsBeforeStall = frontstageStall.startsAtPause;
      const stallDeltaMs = frontstageStall.firstPostStallMaster.previewTimeMs - frontstageStall.baselineMasterTimeMs;
      const committedDeltaMs = frontstageStall.firstPostStallMaster.previewTimeMs - frontstageStall.baselineDomTimeMs;
      const secondDialogue = shot.dialogues[1];
      const secondClip = secondDialogue
        ? shot.audioClips.find((clip) => clip.id === secondDialogue.audioClipId)
        : null;
      const speaker = secondDialogue
        ? project.characters.find((character) => character.id === secondDialogue.characterId)
        : null;
      const characterLayer = shot.layers.find((layer) => layer.source.kind === 'character' && layer.source.characterId === secondDialogue?.characterId);
      const activeFace = frontstageStall.firstPostStallStage.layerVisuals.find((layer) => layer.layerId === characterLayer?.id)?.activeFace;
      const mouthOpen = Boolean(secondClip &&
        (frontstageStall.firstPostStallStage.stageTimeMs - secondClip.startMs) % 320 < 160);
      const expectedFaceAssetId = mouthOpen
        ? speaker?.mouthOpenAssetId
        : speaker?.expressions.find((expression) => expression.id === speaker.defaultExpressionId)?.assetId;
      receipt.frontstageStall = {
        ...frontstageStall,
        stallDeltaMs,
        committedDeltaMs,
        expectedCaption: secondDialogue?.text ?? null,
        expectedActiveFace: {
          source: mouthOpen ? 'mouth' : 'expression',
          assetId: expectedFaceAssetId ?? null,
        },
        startsBeforeStall,
      };
      assert(frontstageStall.rendererPauseMs >= 490 && frontstageStall.rendererPauseMs <= 700,
        `Foreground renderer pause was ${frontstageStall.rendererPauseMs}ms, expected approximately 500ms.`);
      assert(stallDeltaMs >= 450 && stallDeltaMs <= 900,
        `Preview caught up ${stallDeltaMs}ms after the 500ms frontstage stall; expected a catch-up near 500ms, not a 250ms clamp.`);
      assert(frontstageStall.maxRafGapMs >= 450 && frontstageStall.maxRafGapMs <= 900,
        `The measured frontstage rAF gap was ${frontstageStall.maxRafGapMs}ms, expected approximately 500ms.`);
      assert(frontstageStall.firstPostStallMaster.visibility === 'visible' && frontstageStall.firstPostStallMaster.playing,
        'Preview was not visibly playing at the first post-stall commit.');
      assert(Math.abs(frontstageStall.firstPostStallStage.previewTimeMs - frontstageStall.firstPostStallStage.stageTimeMs) <= 50,
        'Stage time did not follow the first coherent post-stall Preview master time.');
      assert(frontstageStall.firstPostStallStage.stageShotId === shot.id,
        'Stage selected a different Shot after the renderer stall.');
      assert(frontstageStall.firstPostStallStage.captionText === secondDialogue?.text,
        `Subtitle did not follow the post-stall master time: ${JSON.stringify(frontstageStall.firstPostStallStage.captionText)}.`);
      assert(activeFace?.source === receipt.frontstageStall.expectedActiveFace.source &&
        activeFace?.assetId === receipt.frontstageStall.expectedActiveFace.assetId,
      `Mouth projection did not follow master time: received ${JSON.stringify(activeFace)}.`);
      assert(frontstageStall.audioAfterCommit.starts > startsBeforeStall &&
        frontstageStall.audioAfterCommit.activeSources === 1,
      'Audio did not reconcile to one current voice after the renderer stall.');
      const postStallSources = frontstageStall.audioAfterCommit.sourceStartArgs.slice(startsBeforeStall);
      const expectedAudioOffsetSeconds = (frontstageStall.firstPostStallMaster.previewTimeMs - secondClip.startMs + secondClip.offsetMs) / 1_000;
      receipt.frontstageStall.postStallSourceStartArgs = postStallSources;
      receipt.frontstageStall.expectedAudioOffsetSeconds = expectedAudioOffsetSeconds;
      assert(postStallSources.length > 0 && postStallSources.every((source) =>
        Number.isFinite(Number(source?.[1])) &&
        Math.abs(Number(source?.[1]) - expectedAudioOffsetSeconds) <= 0.15 &&
        Number(source?.[1]) + Number(source?.[2]) >= 1.3 &&
        Number(source?.[1]) + Number(source?.[2]) <= 1.5),
      'A stale or expired dialogue source restarted after the renderer stall.');
      assert(Number.isFinite(frontstageStall.audioAfterCommit.latestOffsetSeconds) &&
        Math.abs(frontstageStall.audioAfterCommit.latestOffsetSeconds - expectedAudioOffsetSeconds) <= 0.15,
      `Current dialogue audio started at offset ${frontstageStall.audioAfterCommit.latestOffsetSeconds}s instead of the post-stall master position near ${expectedAudioOffsetSeconds}s.`);
    }

    if (baselineCase !== 'stall') {
      const rangeLifecycle = await runPausedRangeLifecycle(window, project.shots[1]?.id);
      receipt.rangeLifecycle = {
        ...rangeLifecycle,
        durationRelationship: {
          projectDurationMs: receipt.fixture.projectDurationMs,
          shotDurationMs: shot.durationMs,
          sameDuration: receipt.fixture.projectDurationMs === shot.durationMs,
        },
      };
      assert(rangeLifecycle.stayedPaused && rangeLifecycle.noAudioStarts,
        'Changing Project/Shot range restarted autoplay or audio after the user paused Preview.');
      const endOfRange = await runEndOfRangeLifecycle(window, project.shots[1]?.durationMs ?? shot.durationMs);
      receipt.endOfRange = endOfRange;
      assert(endOfRange.didNotRestart,
        'Product Preview restarted after reaching the selected Shot end.');
    }

    if (!baselineCase) {
      const beforeRapidClicks = await readState(window);
      await evaluate(window, `(() => {
        const control = document.querySelector('[data-testid="product-preview-play-pause"]');
        control?.click();
        control?.click();
      })()`);
      await delay(180);
      const afterRapidClicks = await readState(window);
      receipt.rapidClicks = {
        before: beforeRapidClicks,
        after: afterRapidClicks,
        stayedPaused: !afterRapidClicks.playing && afterRapidClicks.activeSources === 0,
      };
      assert(receipt.rapidClicks.stayedPaused,
        'A rapid Play/Pause click pair left Preview playing or left a native voice active.');
    }

    // Re-enable playback through the explicit Play control so visibility and
    // audio lifecycle checks below continue from the user's chosen action.
    if (!(await readState(window)).playing) {
      await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
    }
    await waitFor(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
        Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= ${TARGET_TIME_MS}`,
      'Explicit Play did not restart Preview after the paused range-switch checks.',
    );

    if (!baselineCase) {
      await evaluate(window, `document.querySelector('[data-testid="product-preview-stop"]')?.click()`);
      await waitFor(
        window,
        `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false' &&
          Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) === 0`,
        'Stop did not pause Preview at zero.',
      );
      await waitFor(window,
        'window.__issue880AudioProbe?.sources.filter((source) => source.active).length === 0',
        'Stop left a native audio voice active.');
      await evaluate(window, `(() => {
        const input = document.querySelector('[data-testid="product-preview-scrubber"]');
        if (!input) throw new Error('Product Preview scrubber is missing.');
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setValue.call(input, '500');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await waitFor(
        window,
        `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false' &&
          Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) === 500`,
        'Seeking while paused did not commit the requested Preview time.',
      );
      const afterSeek = await readState(window);
      await evaluate(window, `document.querySelector('[data-testid="product-preview-replay"]')?.click()`);
      await waitFor(
        window,
        `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
          Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= ${TARGET_TIME_MS}`,
        'Replay did not explicitly restart Product Preview from its beginning.',
      );
      const afterReplay = await readState(window);
      receipt.stopSeekReplay = {
        stoppedAtZero: true,
        seekTimeMs: afterSeek.previewTimeMs,
        replayPlaying: afterReplay.playing,
        replayTimeMs: afterReplay.previewTimeMs,
      };
    }

    const beforeBlur = await readState(window);
    window.blur();
    await waitFor(
      window,
      `document.visibilityState === 'visible' && !document.hasFocus() &&
        document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
      'Blur did not leave a playing, still-visible Preview.',
    );
    await delay(180);
    const afterBlur = await readState(window);
    assert(afterBlur.visibility === 'visible' && afterBlur.playing, 'Blur paused Preview while the page remained visible.');
    assert(afterBlur.previewTimeMs > beforeBlur.previewTimeMs, 'Preview time did not advance during visible blur.');
    window.focus();
    window.webContents.focus();
    await waitFor(window, 'document.visibilityState === "visible"', 'Window did not return to visible state.');

    const beforeHide = await readState(window);
    window.hide();
    await waitFor(
      window,
      `document.visibilityState === 'hidden' &&
        document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'Hiding the Electron window did not pause Product Preview.',
    );
    const afterHide = await readState(window);
    assert(afterHide.previewTimeMs >= beforeHide.previewTimeMs, 'Hidden pause moved Preview time backward.');
    assert(afterHide.previewTimeMs - beforeHide.previewTimeMs <= 150, 'Hidden pause did not freeze at the current visible position.');
    assert(afterHide.activeSources === 0, `Hidden pause retained ${afterHide.activeSources} audio source(s).`);
    const pausedStartCount = afterHide.starts;
    await delay(2_100);
    const afterHiddenWait = await readState(window);
    assert(afterHiddenWait.visibility === 'hidden', 'The page became visible during the hidden wait.');
    assert(!afterHiddenWait.playing, 'Product Preview resumed while the Electron window was hidden.');
    assert(afterHiddenWait.previewTimeMs === afterHide.previewTimeMs, `Hidden time advanced: ${afterHide.previewTimeMs} -> ${afterHiddenWait.previewTimeMs}ms.`);
    assert(afterHiddenWait.activeSources === 0, 'Native audio source remained active while the window was hidden.');
    assert(afterHiddenWait.starts === pausedStartCount, 'An obsolete async audio task started a source while hidden.');

    window.show();
    window.focus();
    window.webContents.focus();
    await waitFor(
      window,
      `document.visibilityState === 'visible' &&
        document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`,
      'Product Preview resumed automatically when the Electron window became visible.',
    );
    await delay(250);
    const afterVisibleWait = await readState(window);
    assert(afterVisibleWait.previewTimeMs === afterHide.previewTimeMs, 'Visible restore advanced without an explicit Play action.');
    assert(afterVisibleWait.activeSources === 0, 'Audio restarted before an explicit Play action.');
    assert(afterVisibleWait.starts === pausedStartCount, 'Audio source was duplicated on visibility restore.');

    const clipWindows = shot.audioClips.map(({ startMs, endMs }) => ({ startMs, endMs }));
    const startsBeforeResume = afterVisibleWait.starts;
    await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
    await waitFor(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
      'Explicit Play did not resume Product Preview.',
    );
    await delay(120);
    await waitFor(
      window,
      `(() => {
        const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
        const timeMs = Number(overlay?.dataset.previewTime ?? -1);
        const activeClipCount = ${JSON.stringify(clipWindows)}.filter((clip) => clip.startMs <= timeMs && timeMs < clip.endMs).length;
        const probe = window.__issue880AudioProbe;
        return overlay?.dataset.previewPlaying === 'true' &&
          timeMs >= ${afterHide.previewTimeMs + 50} &&
          probe?.sources.filter((source) => source.active).length === activeClipCount;
      })()`,
      'Explicit resume did not reconcile one native voice per clip active at the current master time.',
    );
    const afterResume = await readState(window);
    const clipsAtResume = shot.audioClips.filter(
      (clip) => clip.startMs <= afterResume.previewTimeMs && afterResume.previewTimeMs < clip.endMs,
    );
    assert(afterResume.previewTimeMs > afterHide.previewTimeMs, 'Explicit Play did not advance from the saved position.');
    assert(afterResume.previewTimeMs - afterHide.previewTimeMs < 500, 'Explicit Play included hidden wall time.');
    assert(afterResume.activeSources === clipsAtResume.length, 'Explicit Play created duplicate native audio voices.');
    receipt.blur = { before: beforeBlur, after: afterBlur, stayedPlayingWhileVisible: true };
    receipt.hidden = {
      before: beforeHide,
      pause: afterHide,
      afterTwoSeconds: afterHiddenWait,
      restoredAfter250ms: afterVisibleWait,
      timePreserved: afterHiddenWait.previewTimeMs === afterHide.previewTimeMs,
      audioStoppedAndStayedStopped: afterHiddenWait.activeSources === 0,
      noAutomaticResume: !afterVisibleWait.playing,
    };
    receipt.resume = {
      pauseTimeMs: afterHide.previewTimeMs,
      after120ms: afterResume.previewTimeMs,
      elapsedMs: afterResume.previewTimeMs - afterHide.previewTimeMs,
      activeClipCount: clipsAtResume.length,
      newSourceCount: afterResume.starts - startsBeforeResume,
      activeSourceCount: afterResume.activeSources,
      noDoubleAudio: afterResume.activeSources === clipsAtResume.length,
    };

    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await delay(60);
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(
      window,
      `!document.querySelector('[data-testid="product-preview-overlay"]')`,
      'Escape did not close Product Preview.',
    );
    await waitFor(
      window,
      `window.__issue880AudioProbe.sources.filter((source) => source.active).length === 0 &&
        window.__issue880AudioProbe.contexts.every((context) => context.state === 'closed')`,
      'Closing Product Preview leaked a native audio source or AudioContext.',
    );
    receipt.escapeClose = { closed: true, activeSources: 0, audioContextsClosed: true };

    if (!baselineCase) {
      const startsBeforeReopen = (await readState(window)).starts;
      await openPreview(window, shot.id);
      await waitFor(
        window,
        `document.visibilityState === 'visible' &&
          document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true' &&
          Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? -1) >= 500 &&
          window.__issue880AudioProbe.starts > ${startsBeforeReopen}`,
        'Reopening Product Preview did not create a fresh initial autoplay session.',
      );
      const reopened = await readState(window);
      receipt.reopen = {
        autoPlayed: reopened.playing,
        previewTimeMs: reopened.previewTimeMs,
        newSourceCount: reopened.starts - startsBeforeReopen,
      };
      await evaluate(window, `document.querySelector('[data-testid="product-preview-close"]')?.click()`);
      await waitFor(window, '!document.querySelector(\'[data-testid="product-preview-overlay"]\')',
        'Close did not unmount the reopened Product Preview.');
      await waitFor(
        window,
        'window.__issue880AudioProbe.sources.filter((source) => source.active).length === 0 && window.__issue880AudioProbe.contexts.every((context) => context.state === "closed")',
        'Closing the reopened Preview leaked a native audio source or AudioContext.',
      );
      receipt.reopen.closedCleanly = true;
    }
    receipt.passed = true;
  } catch (error) {
    failure = error;
    receipt.failure = { message: error.message, stack: error.stack };
    if (window && !window.isDestroyed()) {
      try { receipt.runtimeSnapshot = await evaluate(window, 'window.__issue882Stall ?? null'); } catch { /* Renderer may be unavailable after a failed pause. */ }
    }
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      ...receipt,
      generatedAt: new Date().toISOString(),
      fixtureRoot: projectRoot,
      resultPath,
    }, null, 2));
    app.quit();
  }
  console.log(`RESULT_PATH=${resultPath}`);
  if (failure) {
    console.error(failure.stack ?? failure.message);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      passed: receipt.passed,
      blurStayedPlaying: receipt.blur.stayedPlayingWhileVisible,
      hiddenDurationMs: receipt.hidden.afterTwoSeconds.previewTimeMs - receipt.hidden.pause.previewTimeMs,
      restoredPaused: receipt.hidden.noAutomaticResume,
      resumeElapsedMs: receipt.resume.elapsedMs,
      activeSources: receipt.resume.activeSourceCount,
      noDoubleAudio: receipt.resume.noDoubleAudio,
      escapeClosedAudioContext: receipt.escapeClose.audioContextsClosed,
    }));
  }
}

run().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
