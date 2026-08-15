const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// Issue #207 / NEG-002 real Windows Electron gate.
//
// NEG-002 requires that "duration = 0 / no current shot" neither crashes nor
// fabricates time. The `durationMs = 0` half already has geometry + store unit
// coverage; what was missing was real Electron evidence for the *empty* half:
// a project with no locatable shot at all.
//
// The zero-shot state is produced by the product itself, through the normal UI:
// `ProjectService.createAt` writes every new project with `shots: []`
// (src/main/services/ProjectService.ts), and `ShotStore.reconcileSelection`
// then resolves `shots[0]?.id ?? null` to `null`, so `TimelineDock.hasShot`
// is false. This gate therefore registers the *real*
// `registerProjectIpcHandlers` + a *real* `ProjectService` and drives the real
// "新建项目" dialog. Nothing here edits project JSON, pokes a store, or hides
// DOM to manufacture the state — the project file on disk is written by
// production code and is re-read afterwards as evidence.
const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-207-neg002';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-207',
);
const projectsParentDirectory = path.join(acceptanceRoot, 'projects');
const newProjectName = 'issue207-neg002-empty';
const expectedProjectRoot = path.join(
  projectsParentDirectory,
  `${newProjectName}.pandastage`,
);

rmSync(acceptanceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(projectsParentDirectory, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

const EMPTY_TIMELINE_TEXT = '当前没有可定位的镜头或时长为 0。';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function browserWait(expression, message, timeout = 20_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {
        // React may be between Project Center and the editor page.
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
}

async function click(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    element.click();
    return true;
  })()`);
  await delay(180);
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Input not found: ' + ${JSON.stringify(selector)});
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await delay(140);
}

async function capture(window, fileName) {
  await delay(220);
  const image = (await window.webContents.capturePage()).toPNG();
  writeFileSync(path.join(evidenceRoot, fileName), image);
  writeFileSync(path.join(repositoryEvidenceRoot, fileName), image);
  return fileName;
}

// Only JSON-clonable primitives are returned. A template that evaluates to a
// function or a DOM node makes `executeJavaScript` reject with "An object could
// not be cloned" (the Issue #206 harness defect), so every snippet below is an
// invoked IIFE returning a plain object.
async function measure(window) {
  return window.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const dock = q('[data-testid="timeline-dock"]');
    const empty = q('[data-testid="timeline-empty"]');
    const tc = q('[data-testid="timeline-timecode"]');
    const bar = q('[data-testid="compact-project-bar"]');
    const history = q('[data-testid="history-controls"]');
    return {
      editorPage: q('.editor-shell')?.dataset.editorPage ?? null,
      shellState: q('.editor-shell')?.dataset.editorShellState ?? null,
      dockPresent: !!dock,
      dockExpanded: dock?.dataset.expanded ?? null,
      dockHasShot: dock?.dataset.hasShot ?? null,
      emptyPresent: !!empty,
      emptyText: empty?.textContent?.trim() ?? null,
      rulerScrollPresent: !!q('[data-testid="timeline-ruler-scroll"]'),
      rulerTrackPresent: !!q('[data-testid="timeline-ruler-track"]'),
      playheadPresent: !!q('[data-testid="timeline-playhead"]'),
      ticksCount: document.querySelectorAll('[data-testid="timeline-tick"]').length,
      timecodeText: tc?.textContent?.trim() ?? null,
      currentTimeMs: tc ? Number(tc.dataset.currentTime) : null,
      durationMs: tc ? Number(tc.dataset.duration) : null,
      saveState: bar?.dataset.saveState ?? null,
      dirtyIndicator: !!q('.dirty-state'),
      undoCount: history?.dataset.undoCount ?? null,
      redoCount: history?.dataset.redoCount ?? null,
      historyDepth: history?.dataset.historyDepth ?? null,
      shotCount: document.querySelectorAll('.shot-list-item').length,
      rendererErrors: Array.isArray(window.__issue207Errors)
        ? window.__issue207Errors.slice(0, 5)
        : [],
    };
  })()`);
}

// Records renderer-side uncaught errors so "no crash" is asserted on evidence
// instead of on the absence of a main-process signal alone.
async function installErrorCapture(window) {
  await window.webContents.executeJavaScript(`(() => {
    if (window.__issue207Errors) return true;
    window.__issue207Errors = [];
    window.addEventListener('error', (event) => {
      window.__issue207Errors.push(
        'error: ' + String((event.error && event.error.message) || event.message),
      );
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      window.__issue207Errors.push(
        'unhandledrejection: ' +
          String((reason && reason.message) || reason),
      );
    });
    return true;
  })()`);
}

// Real pointer interaction on the collapsed-ruler area. NEG-002 must prove the
// empty Timeline exposes nothing seekable: there is no ruler track to hit, and
// pressing where it would be must not fabricate a playhead time.
async function attemptSeekOnEmptyTimeline(window) {
  return window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    const empty = document.querySelector('[data-testid="timeline-empty"]');
    const target = empty || dock;
    if (!target) {
      throw new Error('Timeline dock/empty state was not found.');
    }
    const rect = target.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const dispatch = (type) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
        }),
      );
    };
    let dispatchError = null;
    try {
      dispatch('pointerdown');
      dispatch('pointermove');
      dispatch('pointerup');
      target.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
    } catch (error) {
      dispatchError = String((error && error.message) || error);
    }
    const tc = document.querySelector('[data-testid="timeline-timecode"]');
    return {
      pressedAt: { x, y },
      targetTestId: target.dataset.testid ?? null,
      dispatchError,
      currentTimeMs: tc ? Number(tc.dataset.currentTime) : null,
      durationMs: tc ? Number(tc.dataset.duration) : null,
      rulerTrackPresent: !!document.querySelector('[data-testid="timeline-ruler-track"]'),
    };
  })()`);
}

function assertEmptyState(sample, label) {
  assert(
    sample.dockPresent,
    `${label}: the Timeline dock did not render: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.dockHasShot === 'false',
    `${label}: the Timeline reported a shot for a project with no shots: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.emptyPresent,
    `${label}: the Timeline empty state was not rendered: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.emptyText === EMPTY_TIMELINE_TEXT,
    `${label}: unexpected empty-state copy: ${JSON.stringify(sample)}`,
  );
  // No fake ruler: the seekable surface must not exist at all.
  assert(
    !sample.rulerTrackPresent && !sample.rulerScrollPresent,
    `${label}: a seekable ruler was mounted without a shot: ${JSON.stringify(sample)}`,
  );
  assert(
    !sample.playheadPresent && sample.ticksCount === 0,
    `${label}: the empty Timeline rendered a playhead or ticks: ${JSON.stringify(sample)}`,
  );
  // No fake time: both the readout and its data attributes must stay at zero.
  assert(
    sample.durationMs === 0 && sample.currentTimeMs === 0,
    `${label}: the empty Timeline fabricated a time: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.timecodeText === '00:00.000 / 00:00.000',
    `${label}: unexpected timecode readout: ${JSON.stringify(sample)}`,
  );
  // UI-only invariant: observing the empty Timeline must not dirty the project
  // nor add History.
  assert(
    sample.saveState === 'saved' && !sample.dirtyIndicator,
    `${label}: the empty Timeline dirtied the project: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.undoCount === '0' && sample.redoCount === '0',
    `${label}: History changed on the empty Timeline: ${JSON.stringify(sample)}`,
  );
  assert(
    sample.rendererErrors.length === 0,
    `${label}: the renderer reported uncaught errors: ${JSON.stringify(sample.rendererErrors)}`,
  );
}

async function waitForMainWindow(rendererEvents) {
  await app.whenReady();
  const window = await createMainWindow({ show: false });
  const wc = window.webContents;
  wc.on('render-process-gone', (_event, details) => {
    const line = `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`;
    rendererEvents.push(line);
    console.error(`[issue207] ${line}`);
  });
  wc.on('unresponsive', () => {
    rendererEvents.push('renderer unresponsive');
    console.error('[issue207] renderer unresponsive');
  });
  wc.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[issue207] renderer console[${level}]: ${message}`);
  });
  return window;
}

async function run() {
  const rendererEvents = [];
  const stubbed = [];
  const stub = (channel, handler) => {
    ipcMain.handle(channel, handler);
    stubbed.push(channel);
  };

  // Ancillary channels the Project Center / editor shell needs. The project
  // lifecycle itself is deliberately NOT stubbed: it runs through the real
  // ProjectService below, so `shots: []` is produced by production code.
  stub(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  stub(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  stub(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  stub(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  stub(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  stub(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));

  const projectService = new ProjectService();
  let mainWindow = null;
  const removeProjectHandlers = registerProjectIpcHandlers({
    getMainWindow: () => mainWindow,
    projectService,
    selectProjectDirectory: async () => projectsParentDirectory,
    confirmProjectSwitch: async () => 'saved',
  });

  const window = await waitForMainWindow(rendererEvents);
  mainWindow = window;
  const result = {
    issue: 207,
    requirement: 'NEG-002',
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: [],
    rendererEvents,
    projectRoot: expectedProjectRoot,
  };

  try {
    window.setContentSize(1280, 800);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="start-screen"]')`,
      'The Project Center start screen did not render.',
    );
    await installErrorCapture(window);
    result.screenshots.push(await capture(window, 'issue207-neg002-01-start-screen.png'));

    // Real UI path: 新建项目 → 存放文件夹 + 项目名称 → 创建项目.
    await click(window, '[data-testid="new-project-button"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="new-project-dialog"]')`,
      'The new-project dialog did not open.',
    );
    await setInput(
      window,
      '[data-testid="new-project-parent-directory"]',
      projectsParentDirectory,
    );
    await setInput(window, '[data-testid="new-project-name"]', newProjectName);
    result.screenshots.push(await capture(window, 'issue207-neg002-02-new-project-dialog.png'));
    await click(window, '[data-testid="new-project-confirm"]');
    console.error('[issue207] confirmed new project, waiting for editor');

    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]')`,
      'The newly created project did not open in the editor.',
      30_000,
    );
    await installErrorCapture(window);
    await delay(400);

    // The zero-shot state must come from production code, not from this gate.
    const onDisk = JSON.parse(
      readFileSync(path.join(expectedProjectRoot, 'project.json'), 'utf8'),
    );
    assert(
      Array.isArray(onDisk.shots) && onDisk.shots.length === 0,
      `The project written by ProjectService was expected to have zero shots: ${JSON.stringify({ shots: onDisk.shots })}`,
    );
    result.snapshots.onDiskProject = {
      name: onDisk.name,
      schemaVersion: onDisk.schemaVersion,
      shotCount: onDisk.shots.length,
      assetCount: Array.isArray(onDisk.assets) ? onDisk.assets.length : null,
    };
    result.checks.push(
      `ProjectService.createAt wrote ${expectedProjectRoot} with shots: [] ` +
        '(zero-shot state produced by production code, not by the gate)',
    );

    // 1) Expanded empty state on a freshly created zero-shot project.
    const opened = await measure(window);
    assert(
      opened.dockExpanded === 'true',
      `The Timeline was not expanded on open: ${JSON.stringify(opened)}`,
    );
    assertEmptyState(opened, 'fresh zero-shot project');
    result.snapshots.opened = opened;
    result.screenshots.push(await capture(window, 'issue207-neg002-03-empty-timeline.png'));
    result.checks.push(
      'Fresh zero-shot project: empty state rendered, no ruler/track/ticks/playhead, ' +
        `timecode '${opened.timecodeText}', saveState '${opened.saveState}', ` +
        `undo/redo ${opened.undoCount}/${opened.redoCount}`,
    );

    // 2) Real pointer press where the ruler would be must not fabricate time.
    const seekAttempt = await attemptSeekOnEmptyTimeline(window);
    assert(
      !seekAttempt.dispatchError,
      `Pointer interaction on the empty Timeline threw: ${JSON.stringify(seekAttempt)}`,
    );
    assert(
      !seekAttempt.rulerTrackPresent,
      `A ruler track appeared after pressing the empty Timeline: ${JSON.stringify(seekAttempt)}`,
    );
    assert(
      seekAttempt.currentTimeMs === 0 && seekAttempt.durationMs === 0,
      `Pressing the empty Timeline produced a playhead time: ${JSON.stringify(seekAttempt)}`,
    );
    const afterSeekAttempt = await measure(window);
    assertEmptyState(afterSeekAttempt, 'after pointer press on empty Timeline');
    result.snapshots.seekAttempt = seekAttempt;
    result.checks.push(
      `Pointer down/move/up + click at (${seekAttempt.pressedAt.x},${seekAttempt.pressedAt.y}) ` +
        'on the empty Timeline: no seekable ruler appeared, currentTime stayed 0, no crash',
    );

    // 3) Collapse → expand must keep the empty state (the #197/#199 lifecycle
    //    that previously froze the ruler measurement).
    await click(window, '[data-testid="timeline-collapse"]');
    await delay(260);
    const collapsed = await measure(window);
    assert(
      collapsed.dockExpanded === 'false',
      `The Timeline did not collapse: ${JSON.stringify(collapsed)}`,
    );
    assert(
      !collapsed.rulerTrackPresent && !collapsed.emptyPresent,
      `Collapsed Timeline still rendered body content: ${JSON.stringify(collapsed)}`,
    );
    await click(window, '[data-testid="timeline-collapse"]');
    await delay(320);
    const reexpanded = await measure(window);
    assert(
      reexpanded.dockExpanded === 'true',
      `The Timeline did not re-expand: ${JSON.stringify(reexpanded)}`,
    );
    assertEmptyState(reexpanded, 'after collapse→expand on empty Timeline');
    result.snapshots.collapsed = collapsed;
    result.snapshots.reexpanded = reexpanded;
    result.screenshots.push(await capture(window, 'issue207-neg002-04-collapse-expand.png'));
    result.checks.push(
      'collapse→expand on the zero-shot project: empty state restored, still no ruler, ' +
        'currentTime/duration stayed 0, no crash',
    );

    // 4) Zoom controls are reachable while empty; they must not fabricate time.
    await click(window, '[data-testid="timeline-zoom-in"]');
    await delay(200);
    await click(window, '[data-testid="timeline-zoom-in"]');
    await delay(200);
    const zoomed = await measure(window);
    assertEmptyState(zoomed, 'after zoom on empty Timeline');
    result.snapshots.zoomed = zoomed;
    result.checks.push(
      'zoom 1×→4× on the zero-shot project: still empty, no ruler, currentTime/duration 0',
    );

    // 5) Window resize (the Issue #199 re-measure lifecycle) on the empty path.
    window.setContentSize(900, 620);
    await delay(360);
    const resized = await measure(window);
    assertEmptyState(resized, 'after resize on empty Timeline');
    result.snapshots.resized = resized;
    result.screenshots.push(await capture(window, 'issue207-neg002-05-resized-empty.png'));
    result.checks.push(
      '900x620 resize on the zero-shot project: empty state held, no ruler, no fake time',
    );

    assert(
      rendererEvents.length === 0,
      `The renderer crashed or hung during the empty-state run: ${JSON.stringify(rendererEvents)}`,
    );
    assert(
      !window.webContents.isCrashed(),
      'The renderer process was crashed at the end of the empty-state run.',
    );
    result.checks.push(
      'No render-process-gone / unresponsive / renderer uncaught errors during the run',
    );

    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    removeProjectHandlers();
    for (const channel of stubbed) ipcMain.removeHandler(channel);
  }
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  registerProjectIpcHandlers,
} = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const {
  ProjectService,
} = require('../dist-electron/main/services/ProjectService.js');

app.on('window-all-closed', () => {});

async function main() {
  const output = {
    issue: 207,
    requirement: 'NEG-002',
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: [],
    evidenceRoot,
    repositoryEvidenceRoot,
    error: null,
  };
  try {
    Object.assign(output, await run());
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error =
      error instanceof Error ? error.stack || error.message : String(error);
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    writeFileSync(
      path.join(repositoryEvidenceRoot, 'neg002-results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    const exitCode = output.passed ? 0 : 1;
    setTimeout(() => app.exit(exitCode), 1_000);
  }
}

void main();
