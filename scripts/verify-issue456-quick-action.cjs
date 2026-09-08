const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const isIssue457 = process.env.PANDA_STAGE_VERIFY_ISSUE457 === '1';
const verificationIssue = isIssue457 ? 457 : 456;

// Issue #456 real Electron geometry gate. The drawer must remain a live
// overlay while its surrounding editor body and Canvas keep the same rect in
// both UI states. The receipt is intentionally kept outside the repository so
// this gate does not create or remove product evidence during validation.
const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = isIssue457
  ? 'D:\\PandaStage-Acceptance\\issue-457-canvas-first'
  : 'D:\\PandaStage-Acceptance\\issue-456-quick-action';
const userDataRoot = path.join(acceptanceRoot, 'electron-user-data');
const tempRoot = path.join(acceptanceRoot, 'temp');
const outputPath = path.join(acceptanceRoot, 'geometry-results.json');
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  `issue${verificationIssue}-canvas-first.pandastage`,
);
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');
const { migrateProject, detectSchemaVersion } = require(
  '../dist-electron/domain/migrations/index.js',
);
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { createMainWindow } = require(
  '../dist-electron/main/windows/main-window.js',
);

for (const directory of [userDataRoot, tempRoot]) {
  mkdirSync(directory, { recursive: true });
}

for (const [name, directory] of [
  ['userData', userDataRoot],
  ['sessionData', path.join(userDataRoot, 'session-data')],
  ['temp', tempRoot],
  ['logs', path.join(acceptanceRoot, 'logs')],
  ['crashDumps', path.join(acceptanceRoot, 'crash-dumps')],
]) {
  mkdirSync(directory, { recursive: true });
  try {
    app.setPath(name, directory);
  } catch {
    // Electron only exposes some path keys after app readiness.
  }
}

delete process.env.VITE_DEV_SERVER_URL;
app.on('window-all-closed', () => {});

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

async function clickPhysically(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Element has no hit area: ' + ${JSON.stringify(selector)});
    }
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const target = document.elementFromPoint(x, y);
    if (!(target instanceof Element) || !element.contains(target)) {
      throw new Error(
        'Element is not physically clickable: ' +
          ${JSON.stringify(selector)} +
          ' target=' +
          String(target?.className ?? 'null'),
      );
    }
    return { x, y };
  })()`);

  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(260);
}

async function movePointerTo(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Element has no pointer area: ' + ${JSON.stringify(selector)});
    }
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`);

  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
  await delay(260);
}

async function movePointerOutside(window) {
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: 1,
    y: 1,
  });
  await delay(260);
}

function documentFor(root, candidate) {
  const project = migrateProject(candidate);
  return {
    projectRoot: root,
    projectFilePath: path.join(root, 'project.json'),
    project,
    migrated: false,
    sourceVersion: detectSchemaVersion(project),
  };
}

function createFixture() {
  return migrateProject({
    ...exampleProject,
    id: isIssue457
      ? 'c4570000-0000-4000-8000-000000000001'
      : 'c4560000-0000-4000-8000-000000000001',
    name: isIssue457
      ? 'Issue 457 Canvas First Geometry'
      : 'Issue 456 Quick Action Geometry',
  });
}

function registerAcceptanceHandlers(project) {
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
            message: 'Issue 456 fixture project was not found.',
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
    entries: [
      {
        projectId: project.id,
        projectName: project.name,
        projectRoot,
        lastOpenedAt: '2026-09-08T00:00:00.000Z',
        status: 'available',
      },
    ],
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_RELOCATE_FAILED',
            message: 'Issue 456 fixture project was not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
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
          message: 'Issue 456 fixture image asset was not found.',
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

  return channels;
}

async function measure(window) {
  return window.webContents.executeJavaScript(`(() => {
    const query = (selector) => document.querySelector(selector);
    const rect = (selector) => {
      const element = query(selector);
      if (!(element instanceof HTMLElement)) return null;
      const value = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: Math.round(value.left * 100) / 100,
        top: Math.round(value.top * 100) / 100,
        right: Math.round(value.right * 100) / 100,
        bottom: Math.round(value.bottom * 100) / 100,
        width: Math.round(value.width * 100) / 100,
        height: Math.round(value.height * 100) / 100,
        display: style.display,
        position: style.position,
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
      };
    };
    const layout = query('[data-testid="editor-layout"]');
    const topRegion = query('[data-testid="editor-top-region"]');
    const drawer = query('[data-testid="quick-action-drawer"]');
    const canvasViewport = query('[data-testid="project-canvas-viewport"]');
    const canvasChrome = query('[data-testid="canvas-toolbar-feedback"]');
    const pointerFeedback = query('[data-testid="canvas-pointer-coordinate"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: query('.editor-shell')?.dataset.editorPage ?? null,
      shellMode: query('.editor-shell')?.dataset.editorShellLayout ?? null,
      topRegionLayout: layout?.dataset.topRegionLayout ?? null,
      gridRows: layout ? getComputedStyle(layout).gridTemplateRows : null,
      layout: rect('[data-testid="editor-layout"]'),
      topRegion: rect('[data-testid="editor-top-region"]'),
      editorBody: rect('[data-testid="editor-body"]'),
      canvas: rect('[data-testid="canvas-workspace-scroll"]'),
      projectCanvas: rect('.project-canvas'),
      canvasViewport: rect('[data-testid="project-canvas-viewport"]'),
      timeline: rect('[data-testid="bottom-workspace"]'),
      timelineDock: rect('[data-testid="timeline-dock"]'),
      canvasTransform: {
        mode: canvasViewport?.dataset.displayScale
          ? query('[data-testid="canvas-transform-contract"]')?.dataset.transformMode ?? null
          : null,
        displayScale: canvasViewport?.dataset.displayScale ?? null,
      },
      canvasChromeInViewport: Boolean(canvasViewport && canvasChrome && canvasViewport.contains(canvasChrome)),
      canvasChromeStyle: canvasChrome
        ? {
            position: getComputedStyle(canvasChrome).position,
            pointerEvents: getComputedStyle(canvasChrome).pointerEvents,
          }
        : null,
      pointerFeedback: pointerFeedback
        ? {
            hidden: pointerFeedback.hidden,
            text: pointerFeedback.textContent?.trim() ?? '',
            display: getComputedStyle(pointerFeedback).display,
          }
        : null,
      drawer: rect('[data-testid="quick-action-drawer"]'),
      surface: rect('[data-testid="quick-action-drawer-surface"]'),
      handle: rect('[data-testid="quick-action-drawer-handle"]'),
      drawerExpanded: drawer?.dataset.expanded ?? null,
      actionOrder: (() => {
        let historyIndex = 0;
        return [...document.querySelectorAll(
          '[data-testid="quick-action-drawer-surface"] .quick-action-drawer-actions button',
        )].map((element) => {
          if (element.closest('[data-testid="quick-action-history"]')) {
            const action = historyIndex === 0 ? 'undo' : 'redo';
            historyIndex += 1;
            return action;
          }
          return element.dataset.testid ?? null;
        });
      })(),
      documentScroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      },
    };
  })()`);
}

function assertNoRootScroll(sample, label) {
  assert(
    sample.documentScroll.width <= sample.viewport.width + 1,
    `${label} introduced root horizontal scrolling: ${JSON.stringify(sample.documentScroll)}`,
  );
  assert(
    sample.documentScroll.height <= sample.documentScroll.clientHeight + 1,
    `${label} introduced root vertical scrolling: ${JSON.stringify(sample.documentScroll)}`,
  );
}

function assertClose(actual, expected, label, tolerance = 1) {
  assert(
    actual && expected && Math.abs(actual - expected) <= tolerance,
    `${label} changed by more than ${tolerance}px: ${JSON.stringify({ actual, expected })}`,
  );
}

function assertCanvasStable(collapsed, expanded, label) {
  assertClose(expanded.canvas?.top, collapsed.canvas?.top, `${label} Canvas top`);
  assertClose(
    expanded.canvas?.height,
    collapsed.canvas?.height,
    `${label} Canvas height`,
  );
  assertClose(expanded.editorBody?.top, collapsed.editorBody?.top, `${label} editor body top`);
  assertClose(
    expanded.editorBody?.height,
    collapsed.editorBody?.height,
    `${label} editor body height`,
  );
  assertClose(
    expanded.timeline?.height,
    collapsed.timeline?.height,
    `${label} Timeline height`,
  );
}

function assertCanvasFirst(sample, label) {
  assert(
    sample.canvas &&
      sample.projectCanvas &&
      sample.canvasViewport &&
      sample.timeline &&
      sample.canvasViewport.height > 0,
    `${label} lost the production Canvas viewport or Timeline.`,
  );
  assertClose(
    sample.canvasViewport.top,
    sample.canvas.top,
    `${label} Canvas viewport top`,
  );
  assertClose(
    sample.canvasViewport.height,
    sample.canvas.height,
    `${label} Canvas viewport height`,
  );
  assertClose(
    sample.canvasViewport.bottom,
    sample.editorBody.bottom,
    `${label} Canvas did not reach the editor-body bottom`,
  );
  assert(
    sample.timeline.top >= sample.canvasViewport.bottom &&
      sample.timeline.top - sample.canvasViewport.bottom <= 12,
    `${label} retained a blank strip before the Timeline: ${JSON.stringify({
      canvasViewport: sample.canvasViewport,
      timeline: sample.timeline,
    })}`,
  );
  assert(
    sample.canvasChromeInViewport === true,
    `${label} Canvas feedback is not mounted inside the viewport.`,
  );
  assert(
    sample.canvasChromeStyle?.position === 'absolute' &&
      sample.canvasChromeStyle.pointerEvents === 'none',
    `${label} Canvas feedback is not non-flow/non-blocking: ${JSON.stringify(
      sample.canvasChromeStyle,
    )}`,
  );
  assert(
    sample.canvasTransform.mode === 'fit' &&
      Number(sample.canvasTransform.displayScale) > 0,
    `${label} lost the live fit transform contract: ${JSON.stringify(
      sample.canvasTransform,
    )}`,
  );
}

function assertPointerFeedback(sample, visible, label) {
  assert(sample.pointerFeedback, `${label} pointer feedback is missing.`);
  if (visible) {
    assert(
      sample.pointerFeedback.hidden === false &&
        sample.pointerFeedback.text.includes('x ') &&
        sample.pointerFeedback.text.includes('y '),
      `${label} pointer coordinates did not update: ${JSON.stringify(
        sample.pointerFeedback,
      )}`,
    );
  } else {
    assert(
      sample.pointerFeedback.hidden === true &&
        sample.pointerFeedback.text === '' &&
        sample.pointerFeedback.display === 'none',
      `${label} no-pointer state is not quiet: ${JSON.stringify(
        sample.pointerFeedback,
      )}`,
    );
  }
}

function assertCollapsedLandscape(sample, label) {
  assert(sample.page === 'editor', `${label} is not on the editor page.`);
  assert(sample.shellMode === 'landscape', `${label} is not landscape.`);
  assert(sample.topRegionLayout === 'overlay', `${label} did not select overlay top-region layout.`);
  assert(sample.topRegion && sample.topRegion.height <= 1, `${label} retained a top layout row: ${JSON.stringify(sample.topRegion)}`);
  assert(sample.editorBody && sample.canvas && sample.canvas.height > 0, `${label} lost the Canvas body.`);
  assert(
    sample.layout && sample.editorBody.top - sample.layout.top <= 14,
    `${label} retained a blank top cavity before the editor body: ${JSON.stringify({ layout: sample.layout, editorBody: sample.editorBody })}`,
  );
  assert(sample.drawerExpanded === 'false', `${label} did not start collapsed.`);
  assert(sample.drawer && sample.drawer.height > 0, `${label} lost the visible drawer handle.`);
  assertNoRootScroll(sample, `${label} collapsed`);
}

function assertExpanded(sample, label) {
  assert(sample.drawerExpanded === 'true', `${label} did not expand.`);
  assert(sample.surface && sample.surface.visibility === 'visible' && sample.surface.height > 0, `${label} action surface is not visible.`);
  assert(
    JSON.stringify(sample.actionOrder) ===
      JSON.stringify([
        'quick-action-home',
        'quick-action-folder',
        'quick-action-save',
        'quick-action-play',
        'undo',
        'redo',
        'quick-action-close',
      ]),
    `${label} action order changed: ${JSON.stringify(sample.actionOrder)}`,
  );
  assertNoRootScroll(sample, `${label} expanded`);
}

async function runAtSize(window, width, height) {
  window.setContentSize(width, height);
  await delay(360);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"][data-expanded="false"]')`,
    `${width}x${height} did not settle in the collapsed drawer state.`,
  );

  await movePointerOutside(window);
  const collapsed = await measure(window);
  assert(
    collapsed.viewport.width === width && collapsed.viewport.height === height,
    `Electron viewport did not reach ${width}x${height}: ${JSON.stringify(collapsed.viewport)}`,
  );
  assertCollapsedLandscape(collapsed, `${width}x${height}`);
  if (isIssue457) {
    assertCanvasFirst(collapsed, `${width}x${height} collapsed`);
    assertPointerFeedback(
      collapsed,
      false,
      `${width}x${height} collapsed no-pointer`,
    );

    await movePointerTo(window, '[data-testid="project-canvas-viewport"]');
    const pointerInside = await measure(window);
    assertCanvasFirst(pointerInside, `${width}x${height} pointer-inside`);
    assertPointerFeedback(
      pointerInside,
      true,
      `${width}x${height} pointer-inside`,
    );
    await movePointerOutside(window);
  }

  await clickPhysically(window, '[data-testid="quick-action-drawer-handle"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"][data-expanded="true"]')`,
    `${width}x${height} drawer did not expand.`,
  );
  await movePointerOutside(window);
  await delay(260);
  const expanded = await measure(window);
  assertExpanded(expanded, `${width}x${height}`);
  if (isIssue457) {
    assertCanvasFirst(expanded, `${width}x${height} expanded`);
    assertPointerFeedback(
      expanded,
      false,
      `${width}x${height} expanded no-pointer`,
    );
  }
  assertCanvasStable(collapsed, expanded, `${width}x${height}`);

  await clickPhysically(window, '[data-testid="quick-action-drawer-handle"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"][data-expanded="false"]')`,
    `${width}x${height} drawer did not collapse again.`,
  );
  await movePointerOutside(window);
  await delay(260);
  const collapsedAgain = await measure(window);
  assertCollapsedLandscape(collapsedAgain, `${width}x${height} repeated`);
  if (isIssue457) {
    assertCanvasFirst(collapsedAgain, `${width}x${height} repeated`);
    assertPointerFeedback(
      collapsedAgain,
      false,
      `${width}x${height} repeated no-pointer`,
    );
  }
  assertCanvasStable(collapsed, collapsedAgain, `${width}x${height} repeated`);

  return { collapsed, expanded, collapsedAgain };
}

async function openFixture(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'Issue 456 Project Center did not render.',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-project-status="available"] [data-task4-core="recent-open"]')`,
    'Issue 456 recent project did not render.',
  );
  await clickPhysically(
    window,
    '[data-project-status="available"] [data-task4-core="recent-open"]',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="quick-action-drawer"]')`,
    'Issue 456 fixture did not open in the editor.',
  );
}

async function run() {
  const project = createFixture();
  const channels = registerAcceptanceHandlers(project);
  let window = null;
  const result = {
    issue: verificationIssue,
    passed: false,
    electron: process.versions.electron,
    node: process.versions.node,
    snapshots: {},
    outputPath,
    error: null,
  };

  try {
    await app.whenReady();
    window = await createMainWindow({ show: false });
    if (isIssue457) {
      // Chromium does not dispatch native mouse-move/pointer events to a
      // hidden BrowserWindow. The focused Issue #457 seam is intentionally a
      // visible real Electron window so the pointer-coordinate assertion is
      // an actual input path rather than a DOM-dispatched substitute.
      window.show();
      window.focus();
    }
    await openFixture(window);
    result.snapshots['1366x768'] = await runAtSize(window, 1366, 768);
    result.snapshots['1920x1080'] = await runAtSize(window, 1920, 1080);
    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

async function main() {
  const output = {
    issue: verificationIssue,
    passed: false,
    electron: process.versions.electron,
    node: process.versions.node,
    snapshots: {},
    outputPath,
    error: null,
  };
  try {
    Object.assign(output, await run());
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    mkdirSync(acceptanceRoot, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    const exitCode = output.passed ? 0 : 1;
    setTimeout(() => app.exit(exitCode), 300);
  }
}

if (require.main === module || isIssue457) {
  void main();
}
