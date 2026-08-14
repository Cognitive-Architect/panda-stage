// Issue #204 A/B causal comparison gate.
//
// Question: does the Electron IPC `An object could not be cloned` error exist
// BEFORE the Issue #199 / PR #200 Timeline seek fix (SHA A = b42947d), or was
// it introduced by the #199 branch?
//
// This is a PURE OBSERVATION gate. It does NOT wrap ipcRenderer, does NOT add
// any Proxy / uncaughtException instrumentation (that was the prior FINAL DIAG
// round, now stopped). It only drives the app the same way the #199 gate does
// and records (a) whether the clone error appears and (b) at which phase:
//   Phase 1 — open + wait only (enter editor, no Timeline interaction)
//   Phase 2 — Timeline interaction (seek 10/50/90%, drag, zoom 1->2->4,
//             collapse->expand, wait 1s)
//
// The SAME script file is used for SHA A and SHA B; only the built app differs.
// If Phase 2 triggers the clone error at B but not A -> #199-correlated.
// If Phase 1 or Phase 2 triggers it at A too -> pre-existing / independent.
const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-204-ab';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-204',
);
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue204-ab.pandastage',
);
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

rmSync(evidenceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

const CLONE_ERR = 'An object could not be cloned';

// Phase marker: updated as the gate progresses so the final clone-error report
// can attribute the crash to open+wait vs interaction.
let currentPhase = 'launch';

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
      ticksByClass: document.querySelectorAll('.timeline-tick').length,
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

async function seek(window, fraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue204CapturePatched) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue204CapturePatched = true;
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

async function seekDrag(window, fromFraction, toFraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue204CapturePatched) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue204CapturePatched = true;
      }
    };
    patch();
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    if (!(track instanceof HTMLElement)) {
      resolve({ error: 'timeline-ruler-track missing for drag' });
      return;
    }
    const rect = track.getBoundingClientRect();
    const at = (f) => ({ x: rect.left + rect.width * f, y: rect.top + rect.height / 2 });
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

// Interaction steps are performed but NOT asserted for correct seek behavior:
// at SHA A the ruler has width 0 (no #199 fix) so the playhead cannot move,
// which is expected and must not abort the phase before the clone error (if
// any) is given a chance to fire. We only record observations + clone errors.
async function interactStep(window, label, fn) {
  const step = { label, cloneError: false, error: null, sample: null };
  try {
    const res = await fn();
    step.sample = res ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    step.error = msg;
    if (msg.includes(CLONE_ERR)) {
      step.cloneError = true;
      step.clonePhase = currentPhase;
    }
  }
  return step;
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
  project.id = 'c2040000-0000-4000-8000-000000000001';
  project.name = 'Issue 204 A/B Comparison Project';
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
  );
  // Deterministic 4321ms shot so the seek geometry is predictable.
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
  const wc = window.webContents;
  wc.on('console-message', (_event, level, message) => {
    console.error(`[issue204] renderer console[${level}]: ${message}`);
  });
  wc.on('render-process-gone', (_event, details) => {
    console.error(
      `[issue204] renderer gone: reason=${details.reason} exitCode=${details.exitCode} phase=${currentPhase}`,
    );
  });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The real Electron Project Center did not render.',
  );
  console.error('[issue204] project center rendered');
  return window;
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
            message: 'Issue 204 gate project not found.',
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
            message: 'Issue 204 gate recent project not found.',
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
          message: 'Issue 204 fixture image asset was not found.',
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
  const report = {
    issue: 204,
    electron: process.versions.electron,
    node: process.versions.node,
    openWaitCloneError: null,
    interactionCloneError: null,
    firstFailingStep: null,
    openWait: null,
    interaction: [],
    rendererGone: null,
  };

  try {
    window.setContentSize(1280, 800);
    console.error('[issue204] sized 1280x800, waiting for recent-projects-list');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="recent-projects-list"]')`,
      'The Issue 204 Project Center recent-project list did not render.',
    );
    console.error('[issue204] recent-projects-list rendered, clicking recent-open');
    await click(
      window,
      '[data-project-status="available"] [data-task4-core="recent-open"]',
    );
    console.error('[issue204] clicked recent-open, waiting for editor page');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]')`,
      'The Issue 204 gate project did not open in the editor.',
    );
    console.error('[issue204] editor opened');

    // ---- PHASE 1: open + wait only (no Timeline interaction) ----
    currentPhase = 'open-wait';
    console.error('[issue204] PHASE 1 open+wait: entering, waiting >=3s');
    await delay(3000);
    const openSample = await measure(window);
    report.openWait = openSample;
    console.error(
      `[issue204] PHASE 1 done: ${JSON.stringify(openSample)}`,
    );

    // ---- PHASE 2: Timeline interaction (identical for A and B) ----
    currentPhase = 'interaction';
    console.error('[issue204] PHASE 2 interaction: starting');

    report.interaction.push(
      await interactStep(window, 'seek 10%', () => seek(window, 0.1)),
    );
    report.interaction.push(
      await interactStep(window, 'seek 50%', () => seek(window, 0.5)),
    );
    report.interaction.push(
      await interactStep(window, 'seek 90%', () => seek(window, 0.9)),
    );
    report.interaction.push(
      await interactStep(window, 'drag 5%->95%', () =>
        seekDrag(window, 0.05, 0.95),
      ),
    );
    for (let level = 1; level < 4; level *= 2) {
      report.interaction.push(
        await interactStep(window, `zoom ${level}x->${level * 2}x`, async () => {
          await click(window, '[data-testid="timeline-zoom-in"]');
          await delay(120);
          return seek(window, 0.5);
        }),
      );
    }
    report.interaction.push(
      await interactStep(window, 'collapse', async () => {
        await click(window, '[data-testid="timeline-collapse"]');
        await delay(200);
        return measure(window);
      }),
    );
    report.interaction.push(
      await interactStep(window, 'expand', async () => {
        await click(window, '[data-testid="timeline-collapse"]');
        await delay(200);
        return measure(window);
      }),
    );
    currentPhase = 'interaction-wait';
    await delay(1000);
    console.error('[issue204] PHASE 2 done');

    const interactionClone = report.interaction.find((s) => s.cloneError);
    if (interactionClone) {
      report.interactionCloneError = {
        step: interactionClone.label,
        phase: interactionClone.clonePhase,
      };
      report.firstFailingStep = interactionClone.label;
    }
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    const stack = fatal instanceof Error ? fatal.stack || msg : msg;
    if (msg.includes(CLONE_ERR)) {
      console.error(
        `[issue204] FATAL clone error during phase=${currentPhase}: ${stack}`,
      );
      if (currentPhase === 'open-wait') {
        report.openWaitCloneError = { phase: currentPhase, stack };
      } else {
        report.interactionCloneError = { phase: currentPhase, stack };
        if (!report.firstFailingStep) report.firstFailingStep = currentPhase;
      }
    } else {
      console.error(`[issue204] FATAL (non-clone) during phase=${currentPhase}: ${stack}`);
      if (!report.firstFailingStep) report.firstFailingStep = `non-clone:${currentPhase}`;
    }
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }

  const cloneAtAll =
    !!report.openWaitCloneError || !!report.interactionCloneError;
  console.error(
    `[issue204-result] cloneError=${cloneAtAll} ` +
      `openWaitClone=${!!report.openWaitCloneError} ` +
      `interactionClone=${!!report.interactionCloneError} ` +
      `firstFailingStep=${report.firstFailingStep ?? 'none'} ` +
      `openTicks=${report.openWait?.ticksCount ?? '?'} ` +
      `openTrackWidth=${report.openWait?.trackWidth ?? '?'}`,
  );
  writeFileSync(
    path.join(repositoryEvidenceRoot, 'ab-compare.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return report;
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');

app.on('window-all-closed', () => {});

async function main() {
  try {
    const report = await run();
    const cloneAtAll =
      !!report.openWaitCloneError || !!report.interactionCloneError;
    console.log(JSON.stringify({ ...report, passed: !cloneAtAll }, null, 2));
    // Exit non-zero ONLY when the clone error reproduced, so a red CI step
    // means "clone error present". A green step means no clone error (a
    // width=0 seek-math failure at SHA A is expected and is NOT a clone error).
    setTimeout(() => app.exit(cloneAtAll ? 1 : 0), 1_000);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[issue204] UNCAUGHT: ${msg.includes(CLONE_ERR) ? msg : (error.stack || msg)}`);
    setTimeout(() => app.exit(msg.includes(CLONE_ERR) ? 1 : 0), 1_000);
  }
}

void main();
