const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// Issue #199 real Electron gate: the Timeline playhead must be seekable by
// clicking / dragging the ruler. The root cause (Issue #199) was that the
// ruler width was measured only once on mount; when the ruler mounts *after*
// the dock (the active shot is selected once the project opens, or after a
// collapse→expand), viewportWidth stayed frozen at 0, which makes
// pixelsPerMs=0 → no ticks and a playhead that never moves. This gate proves
// the fix by asserting ticks actually render (the measurement succeeded) and
// that real pointer interaction moves the playhead, including the
// collapse→expand, window-resize and zoom lifecycles.
const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-199-timeline-seek';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-199',
);
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue199-timeline-seek.pandastage',
);
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

rmSync(evidenceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

const MAX_TIMELINE_ZOOM = 8;

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
        // React may be between Project Center and editor pages.
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
  })()`);
  await delay(180);
}

async function capture(window, fileName) {
  await delay(220);
  const image = (await window.webContents.capturePage()).toPNG();
  writeFileSync(path.join(evidenceRoot, fileName), image);
  writeFileSync(path.join(repositoryEvidenceRoot, fileName), image);
}

async function measure(window) {
  return window.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const tc = q('[data-testid="timeline-timecode"]');
    const track = q('[data-testid="timeline-ruler-track"]');
    const scroll = q('[data-testid="timeline-ruler-scroll"]');
    const dock = q('[data-testid="timeline-dock"]');
    const bar = q('[data-testid="compact-project-bar"]');
    const history = q('[data-testid="history-controls"]');
    return {
      page: q('.editor-shell')?.dataset.editorPage ?? null,
      expanded: dock?.dataset.expanded ?? null,
      currentTimeMs: tc ? Number(tc.dataset.currentTime) : null,
      durationMs: tc ? Number(tc.dataset.duration) : null,
      ticksCount: document.querySelectorAll('[data-testid="timeline-tick"]').length,
      trackWidth: track ? Math.round(track.getBoundingClientRect().width) : null,
      rulerScrollClientWidth: scroll ? scroll.clientWidth : null,
      rulerScrollPresent: !!scroll,
      saveState: bar?.dataset.saveState ?? null,
      historyState: history
        ? {
            undoCount: history.dataset.undoCount ?? null,
            redoCount: history.dataset.redoCount ?? null,
            depth: history.dataset.historyDepth ?? null,
          }
        : null,
    };
  })()`);
}

// Pointer capture is not available for synthetic dispatched events; patch it
// to a no-op so the real onPointerDown / onPointerMove seek handlers run. The
// capture mechanism itself is out of scope — we are testing the seek math and
// geometry that the Issue #199 fix restored.
async function diagnose(window) {
  return window.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const dock = q('[data-testid="timeline-dock"]');
    const scroll = q('[data-testid="timeline-ruler-scroll"]');
    const track = q('[data-testid="timeline-ruler-track"]');
    const empty = q('[data-testid="timeline-empty"]');
    const tc = q('[data-testid="timeline-timecode"]');
    const bottom = q('[data-testid="bottom-workspace"]');
    return {
      editorPage: q('.editor-shell')?.dataset.editorPage ?? null,
      dockExpanded: dock?.dataset.expanded ?? null,
      dockHasShot: dock?.dataset.hasShot ?? null,
      dockOuterHtml: dock ? dock.outerHTML.slice(0, 800) : null,
      scrollPresent: !!scroll,
      scrollClientWidth: scroll ? scroll.clientWidth : null,
      scrollOffsetWidth: scroll ? scroll.offsetWidth : null,
      trackPresent: !!track,
      trackRectWidth: track ? Math.round(track.getBoundingClientRect().width) : null,
      emptyPresent: !!empty,
      timecodeCurrent: tc ? Number(tc.dataset.currentTime) : null,
      timecodeDuration: tc ? Number(tc.dataset.duration) : null,
      ticksByTestid: document.querySelectorAll('[data-testid="timeline-tick"]').length,
      ticksByClass: document.querySelectorAll('.timeline-tick').length,
      bottomWidth: bottom ? Math.round(bottom.getBoundingClientRect().width) : null,
      bottomHeight: bottom ? Math.round(bottom.getBoundingClientRect().height) : null,
    };
  })()`);
}

async function seek(window, fraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue199CapturePatched) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue199CapturePatched = true;
      }
    };
    patch();
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    if (!(track instanceof HTMLElement)) {
      resolve({ error: 'timeline-ruler-track missing for seek' });
      return;
    }
    const rect = track.getBoundingClientRect();
    const x = rect.left + rect.width * ${fraction};
    const y = rect.top + rect.height / 2;
    const down = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
    });
    const up = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0,
    });
    track.dispatchEvent(down);
    track.dispatchEvent(up);
    const read = () => {
      const tc = document.querySelector('[data-testid="timeline-timecode"]');
      resolve({ currentTimeMs: tc ? Number(tc.dataset.currentTime) : null });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(read, 60)));
  }))`;
  return window.webContents.executeJavaScript(code);
}

// Drag the playhead: pointerdown at fromFraction, pointermove to toFraction,
// pointerup. The Timeline only seeks on a held pointer, so the final position
// reflects the pointermove target.
async function seekDrag(window, fromFraction, toFraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue199CapturePatched) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue199CapturePatched = true;
      }
    };
    patch();
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    if (!(track instanceof HTMLElement)) {
      resolve({ error: 'timeline-ruler-track missing for drag' });
      return;
    }
    const rect = track.getBoundingClientRect();
    const at = (f) => ({
      x: rect.left + rect.width * f,
      y: rect.top + rect.height / 2,
    });
    const a = at(${fromFraction});
    const b = at(${toFraction});
    const down = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: a.x, clientY: a.y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
    });
    const move = new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, clientX: b.x, clientY: b.y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
    });
    const up = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, clientX: b.x, clientY: b.y,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0,
    });
    track.dispatchEvent(down);
    track.dispatchEvent(move);
    track.dispatchEvent(up);
    const read = () => {
      const tc = document.querySelector('[data-testid="timeline-timecode"]');
      resolve({ currentTimeMs: tc ? Number(tc.dataset.currentTime) : null });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(read, 60)));
  }))`;
  return window.webContents.executeJavaScript(code);
}

function assertTicksPresent(sample, label) {
  // Ticks only render when pixelsPerMs > 0, i.e. when the ruler width was
  // actually measured. Their absence is the exact Issue #199 failure signature.
  assert(
    sample.ticksCount > 0,
    `${label} rendered no ruler ticks — viewportWidth stuck at 0 ` +
      `(Issue #199 root cause un-fixed): ${JSON.stringify(sample)}`,
  );
}

async function assertSeekBehavior(window, durationMs, label) {
  assert(durationMs > 0, `${label} has no positive shot duration to seek within.`);
  const t0 = (await seek(window, 0)).currentTimeMs;
  assert(
    t0 !== null && t0 <= durationMs,
    `${label} initial playhead is not within [0, duration]: ${JSON.stringify({ t0, durationMs })}`,
  );

  const mid = (await seek(window, 0.5)).currentTimeMs;
  assert(
    mid !== null && mid > 0 && mid <= durationMs,
    `${label} clicking the ruler middle did not move the playhead ` +
      `(viewportWidth=0?): ${JSON.stringify({ mid, durationMs })}`,
  );

  const t10 = (await seek(window, 0.1)).currentTimeMs;
  const t50 = (await seek(window, 0.5)).currentTimeMs;
  const t90 = (await seek(window, 0.9)).currentTimeMs;
  assert(
    t10 !== null && t50 !== null && t90 !== null &&
      t10 > 0 && t50 > t10 && t90 > t50 && t90 <= durationMs,
    `${label} seek positions are not ordered within [0, duration]: ` +
      `${JSON.stringify({ t10, t50, t90, durationMs })}`,
  );

  const dragged = (await seekDrag(window, 0.05, 0.95)).currentTimeMs;
  assert(
    dragged !== null && dragged > t10 && dragged <= durationMs,
    `${label} dragging the playhead did not move it rightward: ` +
      `${JSON.stringify({ t10, dragged, durationMs })}`,
  );
}

async function assertCollapseReopenSeek(window, durationMs, label) {
  await click(window, '[data-testid="timeline-collapse"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="timeline-dock"]')?.dataset.expanded === 'false'`,
    `${label} did not collapse the Timeline.`,
  );
  await delay(200);
  await click(window, '[data-testid="timeline-collapse"]');
  await waitForDom(
    window,
    `document.querySelectorAll('[data-testid="timeline-tick"]').length > 0`,
    `${label} ruler did not re-render ticks after re-expanding (measurement lifecycle regressed).`,
  );
  const reopened = (await seek(window, 0.5)).currentTimeMs;
  assert(
    reopened !== null && reopened > 0 && reopened <= durationMs,
    `${label} seek failed after collapse→expand (ruler re-measure regressed): ` +
      `${JSON.stringify({ reopened, durationMs })}`,
  );
}

async function assertResizeSeek(window, durationMs, label) {
  window.setContentSize(1120, 760);
  await delay(360);
  const resized = (await seek(window, 0.5)).currentTimeMs;
  assert(
    resized !== null && resized > 0 && resized <= durationMs,
    `${label} seek failed after a window resize: ${JSON.stringify({ resized, durationMs })}`,
  );
}

async function assertZoomSeek(window, durationMs, label) {
  // Default zoom is 1; walk up 1 → 2 → 4 → 8 and seek at each level.
  for (let level = 1; level <= MAX_TIMELINE_ZOOM; level *= 2) {
    const at = (await seek(window, 0.5)).currentTimeMs;
    assert(
      at !== null && at > 0 && at <= durationMs,
      `${label} seek failed at zoom ${level}×: ${JSON.stringify({ at, durationMs })}`,
    );
    if (level < MAX_TIMELINE_ZOOM) {
      await click(window, '[data-testid="timeline-zoom-in"]');
      await delay(120);
    }
  }
  // Restore zoom to 1 for any subsequent cycles.
  for (let i = 0; i < 3; i += 1) {
    await click(window, '[data-testid="timeline-zoom-out"]');
    await delay(80);
  }
}

function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: `${root}\\project.json`,
    project,
    migrated: false,
    sourceVersion: 5,
  };
}

function projectFixture() {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.id = 'c1990000-0000-4000-8000-000000000001';
  project.name = 'Issue 199 Timeline Seek Project';
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
  );
  // Deterministic 4321ms shot so the seek math is predictable (Issue #199).
  if (project.shots && project.shots[0]) {
    project.shots[0].durationMs = 4321;
  } else if (project.project && project.project.shots && project.project.shots[0]) {
    project.project.shots[0].durationMs = 4321;
  }
  return project;
}

async function waitForMainWindow() {
  await app.whenReady();
  const window = await createMainWindow({ show: false });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The real Electron Project Center did not render.',
  );
  return window;
}

async function runCycle(window, label, slug, result) {
  const opened = await measure(window);
  assert(
    opened.page === 'editor' && opened.expanded === 'true',
    `${label} did not open on the expanded editor Timeline: ${JSON.stringify(opened)}`,
  );
  try {
    await waitForDom(
      window,
      `document.querySelectorAll('[data-testid="timeline-tick"]').length > 0`,
      `${label} never rendered ruler ticks after opening (viewportWidth stuck at 0).`,
    );
  } catch (tickError) {
    const dump = await diagnose(window);
    await capture(window, `issue199-${slug}-diag.png`);
    throw new Error(
      `${tickError.message}\nDIAGNOSTIC: ${JSON.stringify(dump, null, 2)}`,
      { cause: tickError },
    );
  }
  const sample = await measure(window);
  assertTicksPresent(sample, label);
  assert(
    sample.currentTimeMs === 0,
    `${label} started with a non-zero playhead: ${JSON.stringify(sample)}`,
  );
  await capture(window, `issue199-${slug}-opened.png`);

  const before = sample.saveState;
  const beforeHistory = JSON.stringify(sample.historyState);

  await assertSeekBehavior(window, sample.durationMs, label);
  await assertCollapseReopenSeek(window, sample.durationMs, label);
  await assertResizeSeek(window, sample.durationMs, label);
  await assertZoomSeek(window, sample.durationMs, label);

  const after = await measure(window);
  assert(
    after.saveState === before,
    `${label} Timeline seeking changed the project save state: ${JSON.stringify({ before, after: after.saveState })}`,
  );
  assert(
    JSON.stringify(after.historyState) === beforeHistory,
    `${label} Timeline seeking changed History state: ${JSON.stringify({ beforeHistory, after: after.historyState })}`,
  );

  await capture(window, `issue199-${slug}-after-seek.png`);
  result.checks.push(
    `${label}: duration ${sample.durationMs}ms, ticks ${sample.ticksCount}, ` +
      `rulerScroll ${sample.rulerScrollClientWidth}px, seek (10%/50%/90%) ordered, ` +
      `collapse→expand / resize / zoom 1..8 seek OK, saveState '${after.saveState}' unchanged`,
  );
}

async function run() {
  const project = projectFixture();
  const recentEntries = [
    {
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: '2026-08-14T00:00:00.000Z',
      status: 'available',
    },
  ];
  const channels = [];
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    channels.push(channel);
  };

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, value: documentFor(projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Issue 199 gate project not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: recentEntries,
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_RELOCATE_FAILED',
            message: 'Issue 199 gate recent project not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => ({
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    dataUrl: `data:image/png;base64,${probePng}`,
  }));
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset || asset.kind !== 'image') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue 199 fixture image asset was not found.',
          assetId: request.assetId,
        },
      };
    }
    const bytes = Buffer.from(probePng, 'base64');
    return {
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });

  const window = await waitForMainWindow();
  const result = {
    issue: 199,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
  };

  try {
    window.setContentSize(1280, 800);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="recent-projects-list"]')`,
      'The Issue 199 Project Center recent-project list did not render.',
    );
    await click(
      window,
      '[data-project-status="available"] [data-task4-core="recent-open"]',
    );
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]')`,
      'The Issue 199 gate project did not open in the editor.',
    );

    await runCycle(window, '1280x800 wide editor', 'wide', result);

    window.setContentSize(900, 620);
    await delay(320);
    await runCycle(window, '900x620 narrow-short editor', 'narrowShort', result);

    window.setContentSize(700, 620);
    await delay(320);
    await runCycle(window, '700x620 compact editor', 'compact', result);

    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');

app.on('window-all-closed', () => {});

async function main() {
  const output = {
    issue: 199,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
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
      path.join(repositoryEvidenceRoot, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    const exitCode = output.passed ? 0 : 1;
    setTimeout(() => app.exit(exitCode), 1_000);
  }
}

void main();
