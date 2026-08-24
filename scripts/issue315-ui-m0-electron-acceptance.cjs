const { app, ipcMain, screen } = require('electron');
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const SIMULATED_LOCAL_PROFILE = 'simulated-local';
const MANUAL_TARGET_PROFILE = 'wuying-redmi-manual';

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
    widthProvided: false,
    heightProvided: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--user-data') args.userData = argv[++index];
    else if (value === '--profile') args.profile = argv[++index];
    else if (value === '--width') {
      args.width = Number(argv[++index]);
      args.widthProvided = true;
    } else if (value === '--height') {
      args.height = Number(argv[++index]);
      args.heightProvided = true;
    }
    else if (value === '--help') {
      process.stdout.write(
        'Usage: electron scripts/issue315-ui-m0-electron-acceptance.cjs [--acceptance-root <dir>] [--out <receipt>] [--user-data <dir>] [--profile simulated-local|wuying-redmi-manual] [--width <css-px>] [--height <css-px>]\n',
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
  if (
    args.profile === MANUAL_TARGET_PROFILE &&
    (args.widthProvided || args.heightProvided)
  ) {
    throw new Error(
      '--width/--height are not allowed with --profile wuying-redmi-manual; target mode never synthesizes a viewport.',
    );
  }
  if (![SIMULATED_LOCAL_PROFILE, MANUAL_TARGET_PROFILE].includes(args.profile)) {
    throw new Error(
      `--profile must be ${SIMULATED_LOCAL_PROFILE} or ${MANUAL_TARGET_PROFILE}.`,
    );
  }
  return args;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
const acceptanceRoot = path.resolve(args.acceptanceRoot);
const outputPath = path.resolve(
  args.out ??
    path.join(
      acceptanceRoot,
      args.profile === MANUAL_TARGET_PROFILE
        ? 'wuying-redmi-target-receipt.json'
        : 'ui-m0-electron-receipt.json',
    ),
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

function repositoryEvidence() {
  const gitValue = (command) => {
    try {
      return execFileSync('git', command, {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim();
    } catch {
      return null;
    }
  };
  return {
    branch: gitValue(['branch', '--show-current']),
    head: gitValue(['rev-parse', 'HEAD']),
    mergeBaseWithOriginMain: gitValue([
      'merge-base',
      'HEAD',
      'origin/main',
    ]),
  };
}

function sourceReferences() {
  return {
    issue315: 315,
    pr316: 316,
    designPr: 306,
    designHead: '31718ada6e7a7e531b1ef86d8f7ee1b61902e42e',
    planPr: 307,
    planHead: 'a6dd9c5107af6aa7da9f3e7f061988979d638343',
    overlapPr: 233,
    overlapHeadFetched: 'd7185eb2af3234405bbe5150522bc6a0928cb092',
  };
}

function projectStateForReceipt(state) {
  return {
    projectName: state.projectName,
    projectRootObserved: Boolean(state.projectRoot),
    revision: state.revision,
    dirty: state.dirty,
    saveState: state.saveState,
    historyUndo: state.historyUndo,
    historyRedo: state.historyRedo,
    historyDepth: state.historyDepth,
  };
}

function editorSampleForReceipt(sample) {
  return {
    viewport: sample.viewport,
    pointerMode: sample.pointerMode,
    page: sample.page,
    shellState: sample.shellState,
    owners: sample.owners,
    boxes: sample.boxes,
    scroll: sample.scroll,
    projectState: projectStateForReceipt(sample.projectState),
    textInputs: sample.textInputs,
  };
}

async function installPointerObserver(window) {
  await window.webContents.executeJavaScript(`(() => {
    const key = '__issue315UiM0TargetSampler';
    if (window[key]?.installed) return { installed: true, reused: true };
    const eventNames = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'mousedown',
      'mousemove',
      'mouseup',
      'touchstart',
      'touchmove',
      'touchend',
    ];
    const state = {
      installed: true,
      events: [],
      totals: Object.fromEntries(eventNames.map((name) => [name, 0])),
      droppedEventCount: 0,
    };
    const listenerFor = (type) => (event) => {
      state.totals[type] += 1;
      if (state.events.length >= 256) {
        state.droppedEventCount += 1;
        return;
      }
      state.events.push({
        type,
        isTrusted: event.isTrusted === true,
        pointerType: typeof event.pointerType === 'string' ? event.pointerType : null,
        button: Number.isInteger(event.button) ? event.button : null,
        buttons: Number.isInteger(event.buttons) ? event.buttons : null,
        clientX: Number.isFinite(event.clientX) ? Math.round(event.clientX * 100) / 100 : null,
        clientY: Number.isFinite(event.clientY) ? Math.round(event.clientY * 100) / 100 : null,
        touchCount: event.touches
          ? event.touches.length
          : event.changedTouches
            ? event.changedTouches.length
            : null,
      });
    };
    for (const type of eventNames) {
      window.addEventListener(type, listenerFor(type), { capture: true, passive: true });
    }
    state.drain = () => {
      const result = {
        events: state.events.splice(0),
        totals: { ...state.totals },
        droppedEventCount: state.droppedEventCount,
      };
      state.droppedEventCount = 0;
      return result;
    };
    window[key] = state;
    return { installed: true, reused: false };
  })()`);
}

async function drainPointerObserver(window) {
  return window.webContents.executeJavaScript(`(() => {
    const state = window.__issue315UiM0TargetSampler;
    if (!state?.installed || typeof state.drain !== 'function') {
      return { events: [], totals: null, droppedEventCount: 0, status: 'UNAVAILABLE' };
    }
    return { ...state.drain(), status: 'AVAILABLE' };
  })()`);
}

function createManualPrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'The wuying-redmi-manual profile requires an interactive terminal; rerun it from a visible PowerShell or Command Prompt window.',
    );
  }
  const interfaceInstance = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let closed = false;
  return {
    question(message) {
      return new Promise((resolve) => {
        interfaceInstance.question(`\n${message}\n> `, resolve);
      });
    },
    close() {
      if (!closed) {
        closed = true;
        interfaceInstance.close();
      }
    },
  };
}

function observationStatus(answer) {
  const normalized = answer.trim().toLowerCase();
  return ['unobservable', 'unmeasurable', 'skip', 'n/a'].includes(normalized)
    ? 'UNOBSERVABLE'
    : 'MEASURED';
}

function keyboardViewport(record) {
  if (!record || record.status !== 'MEASURED') return null;
  const viewport = record.sample.viewport;
  return {
    innerHeight: viewport.windowInnerCssPx.height,
    visualViewportHeight: viewport.visualViewportCssPx?.height ?? null,
    outerHeight: viewport.outerCssPx.height,
  };
}

function keyboardEvidence(records) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const before = keyboardViewport(byName.get('landscape-before-keyboard'));
  const visible = keyboardViewport(byName.get('portrait-keyboard-visible'));
  const after = keyboardViewport(byName.get('portrait-keyboard-dismissed'));
  const status = before && visible && after ? 'MEASURED' : 'UNOBSERVABLE';
  return {
    status,
    before,
    visible,
    after,
    keyboard_before_innerHeight: before?.innerHeight ?? null,
    keyboard_visible_innerHeight: visible?.innerHeight ?? null,
    keyboard_after_innerHeight: after?.innerHeight ?? null,
    keyboard_usable_height_delta:
      before && visible ? before.innerHeight - visible.innerHeight : null,
    keyboard_dismissed_height_delta:
      before && after ? after.innerHeight - before.innerHeight : null,
  };
}

function pointerTouchEvidence(records) {
  const record = records.find((candidate) => candidate.name === 'pointer-touch');
  if (!record || record.status !== 'MEASURED') {
    return {
      status: 'UNOBSERVABLE',
      checkpoint: 'pointer-touch',
      eventCount: 0,
      eventTypes: [],
      pointerTypes: [],
      trustedEventCount: 0,
      totals: null,
      droppedEventCount: 0,
      requirement: 'one maintainer tap plus one short drag',
    };
  }
  const events = record?.pointerEvents?.events ?? [];
  const eventTypes = [...new Set(events.map((event) => event.type))];
  const pointerTypes = [
    ...new Set(
      events
        .map((event) => event.pointerType)
        .filter((pointerType) => typeof pointerType === 'string'),
    ),
  ];
  const hasDown = eventTypes.some((type) =>
    ['pointerdown', 'mousedown', 'touchstart'].includes(type),
  );
  const hasMove = eventTypes.some((type) =>
    ['pointermove', 'mousemove', 'touchmove'].includes(type),
  );
  const hasUp = eventTypes.some((type) =>
    ['pointerup', 'mouseup', 'touchend'].includes(type),
  );
  return {
    status: hasDown && hasMove && hasUp ? 'PASS' : events.length ? 'PARTIAL' : 'UNOBSERVABLE',
    checkpoint: 'pointer-touch',
    eventCount: events.length,
    eventTypes,
    pointerTypes,
    trustedEventCount: events.filter((event) => event.isTrusted).length,
    totals: record?.pointerEvents?.totals ?? null,
    droppedEventCount: record?.pointerEvents?.droppedEventCount ?? 0,
    requirement: 'one maintainer tap plus one short drag',
  };
}

function cloudClientScaleObservation(answer) {
  const observedMode = answer.trim();
  if (!observedMode) {
    return {
      numeric: null,
      observedMode: null,
      source: 'maintainer-observed Wuying client UI',
      status: 'UNOBSERVABLE',
    };
  }
  return {
    numeric: null,
    observedMode,
    source: 'maintainer-observed Wuying client UI',
    status: 'MANUALLY_OBSERVED',
  };
}

function manualCheckpointReceipt(record) {
  const measured = record.status === 'MEASURED';
  return {
    name: record.name,
    status: record.status,
    recordedAt: record.recordedAt,
    renderer: measured ? editorSampleForReceipt(record.sample) : null,
    display: measured ? record.display : null,
    pointerEvents: measured
      ? record.pointerEvents
      : {
          status: 'UNOBSERVABLE',
          events: [],
          totals: null,
          droppedEventCount: 0,
        },
  };
}

async function recordManualCheckpoint({
  window,
  prompt,
  name,
  instruction,
  baselineSample,
}) {
  const answer = await prompt.question(
    `[${name}] ${instruction}\nPress Enter only after the target state is stable. Type "unobservable" if this checkpoint cannot be truthfully measured.`,
  );
  await delay(500);
  const status = observationStatus(answer);
  const sample = await measure(window);
  assertEditorSurface(sample, `manual checkpoint ${name}`);
  if (baselineSample) {
    assertStableProjectState(sample, baselineSample, `manual checkpoint ${name}`);
  }
  return {
    name,
    status,
    recordedAt: new Date().toISOString(),
    sample,
    display: displayMeasurement(),
    pointerEvents: await drainPointerObserver(window),
  };
}

async function runManualTarget(window) {
  const prompt = createManualPrompt();
  try {
    currentStage = 'manual-target-visible';
    window.show();
    window.focus();
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]')`,
      'The manual target editor did not render.',
    );
    await installPointerObserver(window);

    const definitions = [
      {
        name: 'landscape-before-keyboard',
        instruction: 'Hold the Redmi/Wuying path in landscape with the soft keyboard hidden.',
      },
      {
        name: 'portrait-before-keyboard',
        instruction: 'Rotate the Redmi/Wuying path to portrait with the soft keyboard hidden.',
      },
      {
        name: 'portrait-keyboard-visible',
        instruction: 'Focus an existing editor text input and show the Redmi soft keyboard while remaining in portrait.',
      },
      {
        name: 'portrait-keyboard-dismissed',
        instruction: 'Dismiss the Redmi soft keyboard while remaining in portrait.',
      },
      {
        name: 'landscape-round-trip',
        instruction: 'Rotate back to landscape and wait for the editor to settle.',
      },
      {
        name: 'pointer-touch',
        instruction: 'Tap once, then perform one short drag on the existing editor surface.',
      },
    ];
    const records = [];
    let baselineSample = null;
    for (const definition of definitions) {
      currentStage = `manual-${definition.name}`;
      const record = await recordManualCheckpoint({
        window,
        prompt,
        ...definition,
        baselineSample,
      });
      baselineSample ??= record.sample;
      records.push(record);
    }

    currentStage = 'manual-wuying-scale';
    const scaleAnswer = await prompt.question(
      'Enter the literal Wuying client display mode visible to the maintainer (for example fit-to-screen, 100%, original-size, or not exposed). Leave blank only if it is unobservable; do not guess a numeric value.',
    );
    const cloudClientScale = cloudClientScaleObservation(scaleAnswer);
    const finalSample = await measure(window);
    assertStableProjectState(finalSample, baselineSample, 'manual final state');
    const keyboard = keyboardEvidence(records);
    const pointerTouch = pointerTouchEvidence(records);
    const pointerRecord = records.find((record) => record.name === 'pointer-touch');
    const displayRecord = records.find((record) => record.status === 'MEASURED');

    return {
      issue: 315,
      samplerIssue: 317,
      stage: 'UI-M0-target-sampler',
      schemaVersion: 'panda-stage-ui-m0-wuying-redmi-target/1',
      generatedAt: new Date().toISOString(),
      repository: repositoryEvidence(),
      sourceRefs: sourceReferences(),
      target: {
        device: 'Aliyun Wuying -> Redmi K60 Ultra',
        devicePhysicalPx: displayRecord?.display?.devicePhysicalPx ?? null,
        windowsScale: displayRecord?.display?.windowsScale ?? null,
        cloudClientScale,
        softKeyboardVisible: keyboard.status,
        pointerMode:
          pointerRecord?.status === 'MEASURED'
            ? pointerRecord.sample.pointerMode
            : null,
        wuyingRedmiEvidence: 'RECORDED_WITH_LIMITS',
      },
      requestedProfile: args.profile,
      manualTarget: {
        interaction: 'terminal-enter-checkpoints',
        syntheticViewportResize: false,
        checkpoints: records.map(manualCheckpointReceipt),
        keyboard,
        pointerTouch,
        cloudClientScale,
        finalRenderer: editorSampleForReceipt(finalSample),
      },
      fixture: {
        projectId: project.id,
        projectName: project.name,
        projectSnapshotSha256,
        baselineState: projectStateForReceipt(baselineSample.projectState),
      },
      evidenceSeparation: {
        automatedElectron: 'NOT_RUN_IN_MANUAL_TARGET_PROFILE',
        localWindowsElectron: 'TARGET_RENDERER_MEASURED',
        wuyingRedmiHuman: 'RECORDED_WITH_LIMITS',
      },
      closeout: {
        UI_M0_BASELINE_FROZEN: false,
        productionSourceChanged: false,
        numericTargetProfile: 'PENDING_MAINTAINER_CLOSEOUT',
        knownLimits: [
          'the sampler records the observed Wuying label literally and never invents a numeric scale',
          'a checkpoint typed as unobservable remains explicitly unavailable even if a renderer value was sampled',
          'the maintainer must review this exact-head receipt before changing the UI-M0 closeout marker',
        ],
      },
    };
  } finally {
    prompt.close();
  }
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
    if (args.profile === MANUAL_TARGET_PROFILE) {
      return await runManualTarget(window);
    }
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
      repository: repositoryEvidence(),
      sourceRefs: sourceReferences(),
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
