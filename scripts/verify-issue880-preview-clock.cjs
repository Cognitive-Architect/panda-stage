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
const { createHash } = require('node:crypto');
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
  const project = ProjectSchema.parse(JSON.parse(
    readFileSync(path.join(projectRoot, 'project.json'), 'utf8'),
  ));
  assert(project.schemaVersion === 14, `Expected v14 fixture, received v${project.schemaVersion}.`);
  const shot = project.shots[0];
  assert(shot, 'Synthetic fixture has no Shot.');
  const activeClips = shot.audioClips.filter(
    (clip) => clip.startMs <= TARGET_TIME_MS && TARGET_TIME_MS < clip.endMs,
  );
  assert(activeClips.length > 0, `No audio clip is active at ${TARGET_TIME_MS}ms.`);
  return { project, shot, activeClips };
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
    const probe = window.__issue880AudioProbe ?? { contexts: [], sources: [], starts: 0, stops: 0 };
    return {
      previewTimeMs: Number(overlay?.dataset.previewTime ?? -1),
      playing: overlay?.dataset.previewPlaying === 'true',
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      starts: probe.starts,
      stops: probe.stops,
      activeSources: probe.sources.filter((source) => source.active).length,
      contextStates: probe.contexts.map((context) => context.state),
      audioWarning: document.querySelector('[data-testid="product-preview-audio-warning"]')?.textContent ?? null,
    };
  })()`);
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
  const receipt = {
    issue: 880,
    check: 'R5 real Electron visibility pause/resume and native audio source lifecycle',
    passed: false,
    fixture: {
      schemaVersion: project.schemaVersion,
      projectId: project.id,
      shotId: shot.id,
      activeClipsAtTargetTime: activeClips.length,
      targetTimeMs: TARGET_TIME_MS,
    },
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

    const clipsAtResume = shot.audioClips.filter(
      (clip) => clip.startMs <= afterHide.previewTimeMs && afterHide.previewTimeMs < clip.endMs,
    );
    const startsBeforeResume = afterVisibleWait.starts;
    await evaluate(window, `document.querySelector('[data-testid="product-preview-play-pause"]')?.click()`);
    await waitFor(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`,
      'Explicit Play did not resume Product Preview.',
    );
    await waitFor(
      window,
      `(() => {
        const probe = window.__issue880AudioProbe;
        return probe?.sources.filter((source) => source.active).length === ${clipsAtResume.length} &&
          probe.starts === ${startsBeforeResume + clipsAtResume.length};
      })()`,
      'Explicit resume did not create exactly one current native voice per active clip.',
    );
    await delay(120);
    const afterResume = await readState(window);
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
    receipt.passed = true;
  } catch (error) {
    failure = error;
    receipt.failure = { message: error.message, stack: error.stack };
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
