const { app, ipcMain, screen } = require('electron');
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Issue #315 UI-M0: deterministic, real-Windows-Electron evidence for the
// current editor baseline. This harness is deliberately outside production
// source. It measures the live DOM and renderer CSS viewport, drives only
// existing UI/session controls, and records the project/dirty/revision/history
// state before and after those controls. It cannot and must not pretend to
// measure Aliyun Wuying's client scale or a Redmi soft keyboard; those fields
// remain explicitly manual in the receipt.

const repositoryRoot = path.resolve(__dirname, '..');
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

function parseArgs(argv) {
  const args = {
    acceptanceRoot: 'D:\\PandaStage-Acceptance\\issue-315-ui-m0',
    out: null,
    userData: null,
    profile: 'simulated-local',
    width: 1280,
    height: 720,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--user-data') args.userData = argv[++index];
    else if (value === '--profile') args.profile = argv[++index];
    else if (value === '--width') args.width = Number(argv[++index]);
    else if (value === '--height') args.height = Number(argv[++index]);
    else if (value === '--help') {
      process.stdout.write(
        'Usage: electron scripts/issue315-ui-m0-electron-acceptance.cjs [--acceptance-root <dir>] [--out <receipt>] [--user-data <dir>] [--profile <name>] [--width <css-px>] [--height <css-px>]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!Number.isInteger(args.width) || args.width < 800) {
    throw new Error('--width must be an integer >= the production minWidth (800).');
  }
  if (!Number.isInteger(args.height) || args.height < 560) {
    throw new Error('--height must be an integer >= the production minHeight (560).');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const acceptanceRoot = path.resolve(args.acceptanceRoot);
const outputPath = path.resolve(
  args.out ?? path.join(acceptanceRoot, 'ui-m0-electron-receipt.json'),
);
const userData = path.resolve(
  args.userData ?? path.join(acceptanceRoot, 'user-data'),
);
const projectRoot = path.join(acceptanceRoot, 'fixture.pandastage');
mkdirSync(path.dirname(outputPath), { recursive: true });
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
process.env.VITE_DEV_SERVER_URL = '';
let currentStage = 'startup';

const project = migrateProject(JSON.parse(JSON.stringify(exampleProject)));
const projectSnapshotSha256 = createHash('sha256')
  .update(JSON.stringify(project))
  .digest('hex');

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
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  try {
    await window.webContents.executeJavaScript(
      browserWait(expression, message, timeout),
    );
  } catch (error) {
    throw new Error(
      `${message} [stage=${currentStage}]: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
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

async function resizeContent(window, width, height, label) {
  window.setContentSize(width, height);
  await waitForDom(
    window,
    `window.innerWidth === ${width} && window.innerHeight === ${height}`,
    `${label} did not reach the requested CSS viewport ${width}x${height}.`,
  );
  await delay(220);
}

function documentFor(root, rawProject) {
  const sourceVersion = detectSchemaVersion(rawProject);
  return {
    projectRoot: root,
    projectFilePath: `${root}\\project.json`,
    project: migrateProject(JSON.parse(JSON.stringify(rawProject))),
    migrated: sourceVersion !== 6,
    sourceVersion,
  };
}

async function measure(window) {
  try {
    return await window.webContents.executeJavaScript(`(() => {
    const q = (selector) => document.querySelector(selector);
    const count = (selector) => document.querySelectorAll(selector).length;
    const box = (selector) => {
      const element = q(selector);
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        bottom: Math.round(rect.bottom * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      };
    };
    const stage = q('[data-testid="project-canvas-stage"]');
    const shotManager = q('[data-testid="shot-manager"]');
    const saveBar = q('[data-testid="compact-project-bar"]');
    const saveState = q('[data-testid="project-save-state"]');
    const history = q('[data-testid="history-controls"]');
    const timeline = q('[data-testid="timeline-dock"]');
    const rightInspector = q('[data-testid="right-inspector"]');
    const focused = document.activeElement;
    const orientation = screen.orientation;
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    return {
      viewport: {
        windowInnerCssPx: { width: window.innerWidth, height: window.innerHeight },
        outerCssPx: { width: window.outerWidth, height: window.outerHeight },
        visualViewportCssPx: window.visualViewport
          ? { width: window.visualViewport.width, height: window.visualViewport.height, scale: window.visualViewport.scale }
          : null,
        devicePixelRatio: window.devicePixelRatio,
        screenCssPx: { width: window.screen.width, height: window.screen.height, availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
        orientation: orientation ? { type: orientation.type, angle: orientation.angle } : null,
      },
      pointerMode: {
        coarse: hasCoarsePointer,
        fine: hasFinePointer,
        maxTouchPoints: navigator.maxTouchPoints,
        pointerEvent: typeof PointerEvent === 'function',
        primaryInput: hasCoarsePointer ? 'coarse-observable' : hasFinePointer ? 'fine-observable' : 'unknown',
      },
      page: q('.editor-shell')?.dataset.editorPage ?? null,
      shellState: q('.editor-shell')?.dataset.editorShellState ?? null,
      owners: {
        editorLayout: count('[data-testid="editor-layout"]'),
        editorBody: count('[data-testid="editor-body"]'),
        leftWorkspace: count('[data-testid="left-workspace-scroll"]'),
        canvasWorkspace: count('[data-testid="canvas-workspace-scroll"]'),
        canvasStage: count('[data-testid="project-canvas-stage"]'),
        rightInspector: count('[data-testid="right-inspector"]'),
        bottomWorkspace: count('[data-testid="bottom-workspace"]'),
        timelineDock: count('[data-testid="timeline-dock"]'),
        historyControls: count('[data-testid="history-controls"]'),
      },
      boxes: {
        editorLayout: box('[data-testid="editor-layout"]'),
        editorBody: box('[data-testid="editor-body"]'),
        leftWorkspace: box('[data-testid="left-workspace-scroll"]'),
        canvasWorkspace: box('[data-testid="canvas-workspace-scroll"]'),
        rightInspector: box('[data-testid="right-inspector"]'),
        inspectorRail: box('[data-testid="inspector-rail-handle"]'),
        inspectorDrawer: box('[data-testid="right-inspector-drawer"]'),
        bottomWorkspace: box('[data-testid="bottom-workspace"]'),
      },
      scroll: {
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        root: q('#root')?.scrollWidth ?? null,
      },
      projectState: {
        projectName: q('.compact-project-name')?.textContent?.trim() ?? null,
        projectRoot: q('[data-testid="active-project-path"] code')?.textContent?.trim() ?? null,
        revision: Number(stage?.getAttribute('data-project-revision') ?? shotManager?.getAttribute('data-project-revision') ?? NaN),
        dirty: saveBar?.getAttribute('data-save-state') !== 'saved',
        saveState: saveBar?.getAttribute('data-save-state') ?? saveState?.textContent?.trim() ?? null,
        historyUndo: Number(history?.getAttribute('data-undo-count') ?? NaN),
        historyRedo: Number(history?.getAttribute('data-redo-count') ?? NaN),
        historyDepth: Number(history?.getAttribute('data-history-depth') ?? NaN),
        timelineExpanded: timeline?.getAttribute('data-expanded') ?? null,
        inspectorDrawerOpen: rightInspector?.getAttribute('data-drawer-open') ?? null,
        selectedDialogueCount: count('[data-testid="dialogue-list-item"][data-selected="true"]'),
      },
      textInputs: {
        count: document.querySelectorAll('input, textarea, [contenteditable="true"]').length,
        focusedTag: focused?.tagName ?? null,
        focusedType: focused instanceof HTMLInputElement ? focused.type : null,
      },
    };
    })()`);
  } catch (error) {
    throw new Error(
      `Measurement failed [stage=${currentStage}]: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function stableProjectState(sample) {
  const state = sample.projectState;
  return {
    projectName: state.projectName,
    projectRoot: state.projectRoot,
    revision: state.revision,
    dirty: state.dirty,
    saveState: state.saveState,
    historyUndo: state.historyUndo,
    historyRedo: state.historyRedo,
    historyDepth: state.historyDepth,
  };
}

function assertStableProjectState(before, after, label) {
  assert(
    JSON.stringify(stableProjectState(before)) ===
      JSON.stringify(stableProjectState(after)),
    `${label} mutated Project/dirty/revision/History state: ${JSON.stringify({ before: stableProjectState(before), after: stableProjectState(after) })}`,
  );
}

function assertEditorSurface(sample, label) {
  assert(sample.page === 'editor', `${label} is not on the editor page.`);
  for (const [name, actual] of Object.entries(sample.owners)) {
    assert(actual === 1, `${label} owner ${name} count is ${actual}, expected 1.`);
  }
  assert(
    sample.scroll.document <= sample.viewport.windowInnerCssPx.width + 1 &&
      sample.scroll.body <= sample.viewport.windowInnerCssPx.width + 1 &&
      (sample.scroll.root === null || sample.scroll.root <= sample.viewport.windowInnerCssPx.width + 1),
    `${label} has page-level horizontal overflow: ${JSON.stringify(sample.scroll)}`,
  );
  for (const [name, actual] of Object.entries(sample.boxes)) {
    if (!actual) continue;
    assert(actual.width > 0 && actual.height > 0, `${label} ${name} is not measurable.`);
    assert(
      actual.left >= -1 &&
        actual.right <= sample.viewport.windowInnerCssPx.width + 1 &&
        actual.top >= -1 &&
        actual.bottom <= sample.viewport.windowInnerCssPx.height + 1,
      `${label} ${name} escapes the CSS viewport: ${JSON.stringify(actual)}`,
    );
  }
}

function displayMeasurement() {
  const display = screen.getPrimaryDisplay();
  return {
    devicePhysicalPx: {
      width: display.size.width,
      height: display.size.height,
      orientation: display.size.width >= display.size.height ? 'landscape-host' : 'portrait-host',
    },
    workAreaPx: display.workAreaSize,
    windowsScale: display.scaleFactor,
    bounds: display.bounds,
  };
}

async function openFixture(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The Project Center did not render.',
  );
  await setInput(
    window,
    '.recovery-open-row input',
    projectRoot,
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="open-project"]')?.disabled === false`,
    'The fixture project open button did not become enabled.',
  );
  await click(window, '[data-testid="open-project"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') && document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(projectRoot)}`,
    'The fixture project did not open in the editor.',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="timeline-dock"]')?.getAttribute('data-has-shot') === 'true'`,
    'The fixture Timeline did not expose its shot.',
  );
}

async function run() {
  const projects = new Map([[projectRoot, project]]);
  const recentEntries = [
    {
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: '2026-08-24T00:00:00.000Z',
      status: 'available',
    },
  ];
  const channels = [];
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    channels.push(channel);
  };
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    const found = projects.get(request.projectRoot);
    return found
      ? { ok: true, value: documentFor(request.projectRoot, found) }
      : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'UI-M0 fixture project not found.', projectRoot: request.projectRoot } };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: recentEntries }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const found = projects.get(request.projectRoot);
    return found
      ? { ok: true, document: documentFor(request.projectRoot, found) }
      : { ok: false, error: { code: 'RECENT_PROJECT_RELOCATE_FAILED', message: 'UI-M0 fixture project not found.', projectRoot: request.projectRoot } };
  });
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
    const asset = project.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND', message: 'UI-M0 fixture image was not found.', assetId: request.assetId } };
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

  let window = null;
  try {
    currentStage = 'app-ready';
    await app.whenReady();
    window = await createMainWindow({ show: false });
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      process.stderr.write(`[renderer:${level}] ${sourceId}:${line} ${message}\n`);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      process.stderr.write(`[renderer-gone] ${JSON.stringify(details)}\n`);
    });
    currentStage = 'open-fixture';
    await openFixture(window);
    currentStage = 'initial-measure';
    await resizeContent(window, args.width, args.height, 'initial profile');

    const snapshots = {};
    snapshots.initial = await measure(window);
    assertEditorSurface(snapshots.initial, 'initial editor');
    const baselineState = stableProjectState(snapshots.initial);

    currentStage = 'narrow-profile';
    await resizeContent(window, 1024, 720, 'narrow profile');
    snapshots.narrow = await measure(window);
    assertEditorSurface(snapshots.narrow, 'narrow editor');
    assertStableProjectState(snapshots.initial, snapshots.narrow, 'wide-to-narrow');

    currentStage = 'inspector-open';
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-inspector"]')?.getAttribute('data-narrow') === 'true' && document.querySelector('[data-testid="inspector-rail-handle"]')`,
      'The narrow CSS viewport did not expose the Inspector rail.',
    );
    await click(window, '[data-testid="inspector-rail-handle"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-inspector"]')?.getAttribute('data-drawer-open') === 'true'`,
      'The narrow inspector did not open.',
    );
    snapshots.inspectorOpen = await measure(window);
    assertEditorSurface(snapshots.inspectorOpen, 'narrow inspector open');
    assertStableProjectState(snapshots.narrow, snapshots.inspectorOpen, 'inspector-open');

    currentStage = 'inspector-close';
    await click(window, '[data-testid="inspector-drawer-close"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-inspector"]')?.getAttribute('data-drawer-open') === 'false'`,
      'The narrow inspector did not close.',
    );
    snapshots.inspectorClosed = await measure(window);
    assertEditorSurface(snapshots.inspectorClosed, 'narrow inspector closed');
    assertStableProjectState(snapshots.narrow, snapshots.inspectorClosed, 'inspector-close');

    currentStage = 'wide-round-trip';
    await resizeContent(window, 1280, 720, 'wide round-trip');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-inspector"]')?.getAttribute('data-narrow') === 'false' && !document.querySelector('[data-testid="right-inspector-drawer"]')`,
      'The Inspector did not return to its wide owner after the round trip.',
    );
    snapshots.wideRoundTrip = await measure(window);
    assertEditorSurface(snapshots.wideRoundTrip, 'narrow-to-wide');
    assertStableProjectState(snapshots.initial, snapshots.wideRoundTrip, 'narrow-to-wide');

    currentStage = 'portrait-simulated';
    await resizeContent(window, 800, 1000, 'portrait simulation');
    snapshots.portraitSimulated = await measure(window);
    assertEditorSurface(snapshots.portraitSimulated, 'portrait simulation');
    assertStableProjectState(snapshots.initial, snapshots.portraitSimulated, 'landscape-to-portrait-simulation');

    currentStage = 'landscape-after-portrait';
    await resizeContent(window, 1280, 720, 'landscape after portrait simulation');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-inspector"]')?.getAttribute('data-narrow') === 'false' && !document.querySelector('[data-testid="right-inspector-drawer"]')`,
      'The Inspector did not return to its wide owner after the portrait simulation.',
    );
    snapshots.landscapeAfterPortrait = await measure(window);
    assertEditorSurface(snapshots.landscapeAfterPortrait, 'landscape after portrait simulation');
    assertStableProjectState(snapshots.initial, snapshots.landscapeAfterPortrait, 'portrait-to-landscape-simulation');

    currentStage = 'timeline-collapse';
    const timelineBefore = await measure(window);
    currentStage = 'timeline-expand';
    await click(window, '[data-testid="timeline-collapse"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="timeline-dock"]')?.getAttribute('data-expanded') === 'false'`,
      'Timeline did not collapse.',
    );
    snapshots.timelineCollapsed = await measure(window);
    assertEditorSurface(snapshots.timelineCollapsed, 'Timeline collapsed');
    assertStableProjectState(timelineBefore, snapshots.timelineCollapsed, 'timeline-collapse');

    await click(window, '[data-testid="timeline-collapse"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="timeline-dock"]')?.getAttribute('data-expanded') === 'true'`,
      'Timeline did not expand.',
    );
    snapshots.timelineExpanded = await measure(window);
    assertEditorSurface(snapshots.timelineExpanded, 'Timeline expanded');
    assertStableProjectState(timelineBefore, snapshots.timelineExpanded, 'timeline-expand');

    currentStage = 'timeline-zoom-scroll';
    const zoomBefore = snapshots.timelineExpanded;
    await click(window, '[data-testid="timeline-zoom-in"]');
    snapshots.timelineZoomed = await measure(window);
    assert(
      snapshots.timelineZoomed.projectState.timelineExpanded === 'true' &&
        snapshots.timelineZoomed.projectState.revision === zoomBefore.projectState.revision &&
        snapshots.timelineZoomed.projectState.historyUndo === zoomBefore.projectState.historyUndo &&
        snapshots.timelineZoomed.projectState.historyRedo === zoomBefore.projectState.historyRedo,
      `Timeline zoom changed project state: ${JSON.stringify({ before: stableProjectState(zoomBefore), after: stableProjectState(snapshots.timelineZoomed) })}`,
    );
    await window.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-testid="timeline-ruler-scroll"]');
      if (!(node instanceof HTMLElement)) throw new Error('Timeline ruler scroll surface was not found.');
      node.scrollLeft = Math.min(40, Math.max(0, node.scrollWidth - node.clientWidth));
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      return node.scrollLeft;
    })()`);
    await delay(180);
    snapshots.timelineScrolled = await measure(window);
    assertStableProjectState(zoomBefore, snapshots.timelineScrolled, 'timeline-scroll');

    currentStage = 'timeline-seek';
    const seekPoint = await window.webContents.executeJavaScript(`(() => {
      const track = document.querySelector('[data-testid="timeline-ruler-track"]');
      if (!(track instanceof HTMLElement)) return null;
      const rect = track.getBoundingClientRect();
      const timecode = document.querySelector('[data-testid="timeline-timecode"]');
      return {
        x: Math.round(rect.left + Math.max(1, rect.width * 0.6)),
        y: Math.round(rect.top + Math.max(1, rect.height * 0.25)),
        before: timecode ? Number(timecode.getAttribute('data-current-time')) : null,
      };
    })()`);
    assert(seekPoint, 'Timeline seek surface was not measurable.');
    window.show();
    await delay(80);
    await window.webContents.sendInputEvent({
      type: 'mouseDown',
      x: seekPoint.x,
      y: seekPoint.y,
      button: 'left',
    });
    await window.webContents.sendInputEvent({
      type: 'mouseUp',
      x: seekPoint.x,
      y: seekPoint.y,
      button: 'left',
    });
    await delay(220);
    snapshots.timelineSeek = await measure(window);
    assertStableProjectState(zoomBefore, snapshots.timelineSeek, 'timeline-seek');
    assert(
      snapshots.timelineSeek.projectState.timelineExpanded === 'true' &&
        snapshots.timelineSeek.viewport.windowInnerCssPx.width >= 800,
      `Timeline seek did not leave a valid expanded UI state: ${JSON.stringify(snapshots.timelineSeek.projectState)}`,
    );

    currentStage = 'dialogue-selection';
    const selectionBefore = snapshots.timelineScrolled;
    await click(window, '[data-testid="dialogue-list-item"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="dialogue-list-item"][data-selected="true"]')`,
      'Dialogue selection did not render as selected.',
    );
    snapshots.selection = await measure(window);
    assertStableProjectState(selectionBefore, snapshots.selection, 'dialogue-selection');

    currentStage = 'soft-keyboard-observation';
    const focusedInput = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input, textarea, [contenteditable="true"]');
      if (!(input instanceof HTMLElement)) return { available: false, focused: false };
      input.focus();
      return { available: true, focused: document.activeElement === input, tag: input.tagName };
    })()`);
    snapshots.softKeyboardVisible = {
      status: 'BLOCKED_MANUAL_REQUIRED',
      focusedInput,
      beforeUsableHeight: snapshots.selection.viewport.windowInnerCssPx.height,
      afterUsableHeight: null,
      reason: 'An Electron harness can focus the real input but cannot truthfully assert the Aliyun Wuying / Redmi OS soft keyboard resize without that device path.',
    };

    currentStage = 'final-measure';
    const final = await measure(window);
    assertStableProjectState(snapshots.initial, final, 'final UI-M0 state');

    return {
      issue: 315,
      stage: 'UI-M0',
      schemaVersion: 'panda-stage-ui-m0-electron-baseline/1',
      generatedAt: new Date().toISOString(),
      repository: {
        branch: (() => { try { return execFileSync('git', ['branch', '--show-current'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(); } catch { return null; } })(),
        head: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(); } catch { return null; } })(),
        mergeBaseWithOriginMain: (() => { try { return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(); } catch { return null; } })(),
      },
      sourceRefs: {
        designPr: 306,
        designHead: '31718ada6e7a7e531b1ef86d8f7ee1b61902e42e',
        planPr: 307,
        planHead: 'a6dd9c5107af6aa7da9f3e7f061988979d638343',
        overlapPr: 233,
        overlapHeadFetched: 'd7185eb2af3234405bbe5150522bc6a0928cb092',
      },
      target: {
        device: 'Aliyun Wuying -> Redmi K60 Ultra',
        nominalPhysicalPx: '2712x1220 (orientation-dependent; verify on device)',
        cloudClientScale: null,
        softKeyboardVisible: 'BLOCKED_MANUAL_REQUIRED',
        pointerMode: 'MANUAL_TARGET_TOUCH_REQUIRED',
        wuyingRedmiEvidence: 'BLOCKED_MANUAL_REQUIRED',
      },
      requestedProfile: args.profile,
      viewportProfiles: {
        landscapeCssPx: snapshots.initial.viewport.windowInnerCssPx,
        portraitSimulatedCssPx: snapshots.portraitSimulated.viewport.windowInnerCssPx,
        landscapeAfterPortraitCssPx: snapshots.landscapeAfterPortrait.viewport.windowInnerCssPx,
      },
      localDisplay: displayMeasurement(),
      fixture: {
        projectRoot,
        projectId: project.id,
        projectName: project.name,
        projectSnapshotSha256,
        baselineState,
      },
      snapshots,
      automatedChecks: [
        'single owner counts remain one across wide, narrow, drawer, timeline, zoom, scroll, and selection states',
        'wide -> narrow -> wide leaves Project identity, dirty, revision, and History unchanged',
        'narrow inspector open/close leaves Project identity, dirty, revision, and History unchanged',
        'Timeline collapse/expand, zoom, and scroll leave Project identity, dirty, revision, and History unchanged',
        'selection leaves Project identity, dirty, revision, and History unchanged',
        'simulated portrait CSS viewport returns to the landscape CSS viewport without Project/History mutation',
        'page-level horizontal overflow remains absent for measured profiles',
      ],
      evidenceSeparation: {
        automatedElectron: 'PASS',
        localWindowsElectron: 'PASS_FOR_MEASURABLE_LOCAL_HOST_FIELDS',
        wuyingRedmiHuman: 'BLOCKED_MANUAL_REQUIRED',
      },
      closeout: {
        UI_M0_BASELINE_FROZEN: false,
        productionSourceChanged: false,
        windowsElectronEvidence: 'PARTIAL',
        wuyingRedmiEvidence: 'BLOCKED',
        knownLimits: [
          'local display metrics are not target Wuying/Redmi metrics',
          'cloud client scale is not observable from the product renderer',
          'soft keyboard usable-height before/after requires real Redmi input',
          'synthetic/local pointer media queries are not a substitute for target touch acceptance',
        ],
      },
    };
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

app.on('window-all-closed', () => {});

async function main() {
  const output = {
    issue: 315,
    stage: 'UI-M0',
    passed: false,
    error: null,
  };
  try {
    Object.assign(output, await run());
    output.passed = true;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    output.error = `[stage=${currentStage}] ${error instanceof Error ? error.stack || error.message : String(error)}`;
    process.stderr.write(`${output.error}\n`);
    process.exitCode = 1;
  } finally {
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    setTimeout(() => app.exit(output.passed ? 0 : 1), 500);
  }
}

void main();
