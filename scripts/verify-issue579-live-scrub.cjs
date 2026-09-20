const { app, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const { createMainWindow } = require(
  '../dist-electron/main/windows/main-window.js',
);
const { IPC_CHANNELS } = require(
  '../dist-electron/shared/ipc/channels.js',
);
const { detectSchemaVersion, migrateProject } = require(
  '../dist-electron/domain/migrations/index.js',
);

// Issue #579 focused Electron proof. This deliberately drives the production
// Timeline pointer handlers and the real Canvas/Inspector DOM contracts. It
// uses an in-memory IPC fixture so no project data is written to the repo.
const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue579-live-scrub';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const userDataRoot = path.join(acceptanceRoot, 'electron-user-data');
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue579-base-edit-view.pandastage',
);
const resultPath = path.join(acceptanceRoot, 'results.json');
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

const IDS = Object.freeze({
  background: '60000000-0000-4000-8000-000000000001',
  character: '60000000-0000-4000-8000-000000000002',
  angryExpression: '20000000-0000-4000-8000-000000000003',
});

const channels = [];
let savedProject = null;
let saveRequestCount = 0;

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
  const migrated = migrateProject({
    ...exampleProject,
    schemaVersion: 5,
    id: 'c5790000-0000-4000-8000-000000000001',
    name: 'Issue 579 Base Edit View',
    assets: exampleProject.assets.map((asset) =>
      asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
    ),
    characters: exampleProject.characters.map((character) => ({
      ...character,
      defaultExpressionId: character.expressions[0].id,
      defaultScale: 1,
      defaultFlipX: false,
    })),
    shots: exampleProject.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      })),
      backgroundLayerId: IDS.background,
    })),
  });
  const shot = migrated.shots[0];
  assert(shot, 'Issue #579 fixture shot was not created.');

  return {
    ...migrated,
    shots: migrated.shots.map((candidate) =>
      candidate.id !== shot.id
        ? candidate
        : {
            ...candidate,
            timelineEvents: [
              {
                id: '90000000-0000-4000-8000-000000000101',
                type: 'move',
                layerId: IDS.character,
                startMs: 0,
                endMs: 3000,
                from: { x: 1200, y: 690 },
                to: { x: 1490, y: 690 },
                easing: 'linear',
              },
              {
                id: '90000000-0000-4000-8000-000000000102',
                type: 'scale',
                layerId: IDS.character,
                startMs: 0,
                endMs: 3000,
                from: { x: 0.9, y: 0.9 },
                to: { x: 1.2, y: 1.2 },
                easing: 'linear',
              },
              {
                id: '90000000-0000-4000-8000-000000000103',
                type: 'opacity',
                layerId: IDS.background,
                startMs: 0,
                endMs: 400,
                from: 0,
                to: 1,
                easing: 'linear',
              },
              {
                id: '90000000-0000-4000-8000-000000000104',
                type: 'expression',
                layerId: IDS.character,
                startMs: 0,
                endMs: 3000,
                expressionId: IDS.angryExpression,
              },
              {
                id: '90000000-0000-4000-8000-000000000105',
                type: 'flip',
                layerId: IDS.character,
                startMs: 0,
                endMs: 3000,
                axis: 'horizontal',
                flipped: true,
              },
            ],
          },
    ),
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  channels.push(channel);
}

function registerAcceptanceHandlers(project) {
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, value: documentFor(projectRoot, savedProject ?? project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Issue #579 fixture project was not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequestCount += 1;
    savedProject = request.project;
    return {
      ok: true,
      value: documentFor(request.projectRoot, request.project),
    };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({
    outcome: 'saved',
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, savedProject ?? project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_NOT_FOUND',
            message: 'Issue #579 fixture project was not found.',
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
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({
    ok: true,
    retained: true,
  }));
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
          message: 'Issue #579 fixture image asset was not found.',
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
}

async function clickPhysically(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
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
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
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
  await delay(180);
}

async function setInputValue(window, selector, value, { physical = true } = {}) {
  if (!physical) {
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  } else {
    await clickPhysically(window, selector);
  }
  if (physical) {
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      }
      input.focus();
      input.select();
    })()`);
    await window.webContents.insertText(String(value));
  }
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(String(value))}`,
    `Input did not receive value ${String(value)}: ${selector}`,
  );
}

function timelinePointScript(fraction) {
  return `(() => {
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    if (!(track instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      throw new Error('Timeline ruler is not mounted.');
    }
    const rect = track.getBoundingClientRect();
    const laneWidth = Number(dock.dataset.laneLabelWidth ?? 0);
    const durationWidth = Math.max(1, rect.width - laneWidth);
    return {
      x: Math.round(rect.left + durationWidth * ${fraction}),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`;
}

async function seekFraction(window, fraction) {
  const point = await window.webContents.executeJavaScript(
    timelinePointScript(fraction),
  );
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
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
  await delay(220);
}

async function dragTimeline(window, fromFraction, toFraction) {
  const from = await window.webContents.executeJavaScript(
    timelinePointScript(fromFraction),
  );
  const to = await window.webContents.executeJavaScript(
    timelinePointScript(toFraction),
  );
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: from.x,
    y: from.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: from.x,
    y: from.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: to.x,
    y: to.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: to.x,
    y: to.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(220);
}

// Keep the seek and the blur ordered: dispatching the production Timeline
// pointer handler does not steal focus, so the following explicit blur
// reproduces the 0ms draft -> non-zero seek -> blur race deterministically.
async function seekWithoutStealingFocus(window, fraction) {
  await window.webContents.executeJavaScript(`(() => {
    if (!Element.prototype.__issue579CapturePatched) {
      Element.prototype.setPointerCapture = function () {};
      Element.prototype.releasePointerCapture = function () {};
      Element.prototype.hasPointerCapture = function () { return false; };
      Element.prototype.__issue579CapturePatched = true;
    }
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    if (!(track instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      throw new Error('Timeline ruler is not mounted for the blur race.');
    }
    const rect = track.getBoundingClientRect();
    const laneWidth = Number(dock.dataset.laneLabelWidth ?? 0);
    const durationWidth = Math.max(1, rect.width - laneWidth);
    const x = rect.left + durationWidth * ${fraction};
    const y = rect.top + rect.height / 2;
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 579,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
    };
    track.dispatchEvent(new PointerEvent('pointerdown', init));
    track.dispatchEvent(new PointerEvent('pointerup', {
      ...init,
      buttons: 0,
    }));
  })()`);
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime) > 0`,
    'Blur-race seek did not move the real Timeline store.',
  );
}

async function selectCanvasLayer(window, logicalX, logicalY, layerId) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    if (!(viewport instanceof HTMLElement)) throw new Error('Canvas viewport missing.');
    const rect = viewport.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    const offsetX = Number(viewport.dataset.offsetX);
    const offsetY = Number(viewport.dataset.offsetY);
    return {
      x: Math.round(rect.left + offsetX + ${logicalX} * scale),
      y: Math.round(rect.top + offsetY + ${logicalY} * scale),
    };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
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
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId === ${JSON.stringify(layerId)}`,
    'Real Canvas pointer did not select the target layer.',
  );
}

async function readState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const panel = document.querySelector('[data-testid="layer-transform-panel"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    const parse = (value) => {
      try { return JSON.parse(value ?? 'null'); } catch { return null; }
    };
    const findLayer = (layers, id) =>
      Array.isArray(layers) ? layers.find((layer) => layer?.id === ${JSON.stringify(IDS.character)}) ?? null : null;
    const baseLayers = parse(stage?.dataset.layerJson);
    const evaluatedLayers = parse(stage?.dataset.evaluatedLayerJson);
    const controls = panel ? {
      temporalInspection: panel.dataset.temporalInspection ?? null,
      inputs: [...panel.querySelectorAll('input')].map((input) => ({
        type: input.type,
        value: input.value,
        disabled: input.disabled,
      })),
      buttons: [...panel.querySelectorAll('button')].map((button) => ({
        type: button.type,
        disabled: button.disabled,
      })),
      status: panel.querySelector('[data-testid="layer-transform-status"]')?.textContent?.trim() ?? '',
    } : null;
    const opacity = document.querySelector('[data-testid="layer-opacity-range"]');
    return {
      currentTimeMs: Number(stage?.dataset.currentTimeMs ?? NaN),
      directEditingEnabled: stage?.dataset.directCanvasEditing === 'true',
      temporalInspection: stage?.dataset.temporalInspection === 'true',
      selectedLayerId: stage?.dataset.selectedLayerId ?? '',
      backgroundOpacity: Number(stage?.dataset.backgroundOpacity ?? NaN),
      baseLayer: findLayer(baseLayers, ${JSON.stringify(IDS.character)}),
      evaluatedLayer: findLayer(evaluatedLayers, ${JSON.stringify(IDS.character)}),
      baseLayers,
      evaluatedLayers,
      revision: Number(stage?.dataset.projectRevision ?? NaN),
      saveState: drawer?.dataset.saveState ?? null,
      history: history ? {
        undoCount: Number(history.dataset.undoCount ?? NaN),
        redoCount: Number(history.dataset.redoCount ?? NaN),
        depth: Number(history.dataset.historyDepth ?? NaN),
      } : null,
      controls,
      opacityDisabled: opacity instanceof HTMLInputElement ? opacity.disabled : null,
      selectedInspectorLayerId: panel?.dataset.selectedLayerId ?? '',
    };
  })()`);
}

async function capture(window, name) {
  const image = (await window.webContents.capturePage()).toPNG();
  writeFileSync(path.join(evidenceRoot, name), image);
}

function configureElectronPaths() {
  for (const [name, directory] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(acceptanceRoot, 'temp')],
    ['logs', path.join(acceptanceRoot, 'logs')],
    ['crashDumps', path.join(acceptanceRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron path keys can only be changed after readiness.
    }
  }
}

async function openProject(window, targetAssetId) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render.',
  );
  await setInputValue(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row input',
    projectRoot,
    { physical: false },
  );
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click()`,
  );
  await waitForDom(
    window,
    `document.querySelector('.editor-shell')?.dataset.editorPage === 'editor' && document.querySelector('[data-testid="project-canvas-stage"]')`,
    'Issue #579 fixture did not open the real editor.',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`,
    'Issue #579 fixture background did not become ready.',
  );
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      if (!stage) return false;
      try {
        return JSON.parse(stage.dataset.renderedAssetIds ?? '[]').includes(${JSON.stringify(targetAssetId)});
      } catch {
        return false;
      }
    })()`,
    'Issue #579 target Canvas layer image did not become ready.',
  );
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  const project = createFixture();
  const baseCharacterAssetId = project.characters
    .find((character) => character.id === '20000000-0000-4000-8000-000000000001')
    ?.expressions.find(
      (expression) => expression.id === '20000000-0000-4000-8000-000000000002',
    )?.assetId;
  assert(baseCharacterAssetId, 'Issue #579 fixture base character asset was not resolved.');
  registerAcceptanceHandlers(project);
  await app.whenReady();
  configureElectronPaths();
  const window = await createMainWindow({ show: true });
  window.setSize(1440, 1000);
  window.show();
  window.focus();
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[issue579] renderer console[${level}]: ${message}`);
  });

  try {
    await openProject(window, baseCharacterAssetId);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="timeline-tick"]') || document.querySelector('[data-testid="timeline-ruler-track"]')`,
      'Issue #579 Timeline ruler did not render.',
    );
    await selectCanvasLayer(window, 430, 690, IDS.character);
    await clickPhysically(window, '[data-testid="right-activity-rail-properties"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="right-workspace"]')?.dataset.activeActivity === 'properties' && document.querySelector('[data-testid="layer-transform-panel"]')`,
      'Properties workspace did not open for the selected layer.',
    );

    const atZero = await readState(window);
    assert(atZero.currentTimeMs === 0, `Expected initial 0ms, got ${JSON.stringify(atZero)}`);
    assert(atZero.directEditingEnabled, '0ms Canvas direct editing is not enabled.');
    assert(!atZero.temporalInspection, '0ms Canvas is incorrectly marked temporal.');
    assert(atZero.backgroundOpacity === 1, `0ms background is not base opacity 1: ${JSON.stringify(atZero)}`);
    assert(atZero.baseLayer?.x === 430, `Unexpected base character x: ${JSON.stringify(atZero.baseLayer)}`);
    assert(atZero.evaluatedLayer?.x === 430, `0ms Canvas does not show base x: ${JSON.stringify(atZero.evaluatedLayer)}`);
    assert(atZero.evaluatedLayer?.assetId === baseCharacterAssetId, `0ms Canvas asset differs from the base character source: ${JSON.stringify(atZero)}`);
    assert(atZero.evaluatedLayer?.flipX === atZero.baseLayer?.flipX, '0ms Canvas flip differs from base source.');
    assert(atZero.controls?.temporalInspection === 'false', '0ms Inspector reports temporal inspection.');
    assert(atZero.controls?.inputs.every((control) => !control.disabled), `0ms Inspector inputs are disabled: ${JSON.stringify(atZero.controls)}`);
    assert(atZero.controls?.buttons.every((control) => !control.disabled), `0ms Inspector actions are disabled: ${JSON.stringify(atZero.controls)}`);
    assert(atZero.opacityDisabled === false, '0ms opacity control is disabled.');
    await capture(window, 'base-edit-view-0ms.png');

    await dragTimeline(window, 0, 0.1);
    await waitForDom(
      window,
      `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.currentTimeMs) > 0`,
      'Real Timeline drag did not change current time.',
    );
    const atTemporal = await readState(window);
    assert(atTemporal.currentTimeMs > 0, `Temporal seek stayed at 0: ${JSON.stringify(atTemporal)}`);
    assert(!atTemporal.directEditingEnabled, 'Non-zero Canvas direct editing remains enabled.');
    assert(atTemporal.temporalInspection, 'Non-zero Canvas is not marked temporal.');
    assert(atTemporal.evaluatedLayer?.x !== atTemporal.baseLayer?.x, 'Non-zero Canvas did not show evaluated movement.');
    assert(atTemporal.evaluatedLayer?.assetId !== atZero.evaluatedLayer?.assetId, 'Non-zero Canvas did not show evaluated source.');
    assert(atTemporal.backgroundOpacity < 1, `Non-zero Canvas did not show the 0ms opacity event: ${JSON.stringify(atTemporal)}`);
    assert(atTemporal.controls?.temporalInspection === 'true', 'Non-zero Inspector is not marked temporal.');
    assert(atTemporal.controls?.inputs.every((control) => control.disabled), `Non-zero Inspector input is writable: ${JSON.stringify(atTemporal.controls)}`);
    assert(atTemporal.controls?.buttons.every((control) => control.disabled), `Non-zero Inspector action is writable: ${JSON.stringify(atTemporal.controls)}`);
    assert(atTemporal.opacityDisabled === true, 'Non-zero opacity control is writable.');
    await capture(window, 'temporal-read-only-nonzero.png');

    await seekFraction(window, 0);
    await waitForDom(
      window,
      `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.currentTimeMs) === 0 && document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.directCanvasEditing === 'true'`,
      'Returning to 0ms did not restore Base Edit View.',
    );
    const raceBefore = await readState(window);
    const baseJsonBeforeRace = JSON.stringify(raceBefore.baseLayers);
    await setInputValue(window, '[data-testid="layer-transform-x"]', 431);
    await seekWithoutStealingFocus(window, 0.1);
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="layer-transform-x"]')?.blur()`,
    );
    await delay(260);
    const raceAfter = await readState(window);
    assert(JSON.stringify(raceAfter.baseLayers) === baseJsonBeforeRace, 'Blur race mutated base Layer data.');
    assert(raceAfter.revision === raceBefore.revision, `Blur race changed revision: ${JSON.stringify({ raceBefore, raceAfter })}`);
    assert(raceAfter.saveState === raceBefore.saveState, `Blur race changed save state: ${JSON.stringify({ raceBefore, raceAfter })}`);
    assert(JSON.stringify(raceAfter.history) === JSON.stringify(raceBefore.history), `Blur race changed History: ${JSON.stringify({ raceBefore, raceAfter })}`);
    assert(saveRequestCount === 0, `Blur race triggered a save request: ${saveRequestCount}`);

    await seekFraction(window, 0);
    await waitForDom(
      window,
      `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.currentTimeMs) === 0 && document.querySelector('[data-testid="layer-transform-panel"]')?.dataset.temporalInspection === 'false'`,
      'Second return to 0ms did not restore editable Inspector state.',
    );
    const returned = await readState(window);
    assert(returned.evaluatedLayer?.x === returned.baseLayer?.x, 'Temporal x leaked into 0ms Base Edit View.');
    assert(returned.evaluatedLayer?.assetId === atZero.evaluatedLayer?.assetId, 'Temporal asset leaked into 0ms Base Edit View.');
    assert(returned.evaluatedLayer?.flipX === returned.baseLayer?.flipX, 'Temporal flip leaked into 0ms Base Edit View.');
    assert(returned.backgroundOpacity === 1, `Returned 0ms background is not base opacity 1: ${JSON.stringify(returned)}`);
    assert(returned.controls?.inputs.every((control) => !control.disabled), 'Inspector did not become editable at 0ms.');
    assert(returned.opacityDisabled === false, 'Opacity did not become editable at 0ms.');
    await capture(window, 'base-edit-view-returned-0ms.png');

    const revisionBeforeCommit = returned.revision;
    const historyBeforeCommit = returned.history;
    await setInputValue(window, '[data-testid="layer-transform-x"]', 431);
    await clickPhysically(window, '[data-testid="layer-transform-panel"] button[type="submit"]');
    await waitForDom(
      window,
      `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision) === ${revisionBeforeCommit + 1}`,
      'A normal 0ms Inspector edit did not commit to the project.',
    );
    const committed = await readState(window);
    assert(committed.baseLayer?.x === 431, `0ms base edit did not persist x=431: ${JSON.stringify(committed)}`);
    assert(committed.evaluatedLayer?.x === 431, '0ms Canvas did not continue showing the committed base x.');
    assert(committed.revision === revisionBeforeCommit + 1, '0ms edit revision did not increment once.');
    assert(committed.saveState === 'dirty', `0ms edit did not mark the project dirty: ${JSON.stringify(committed)}`);
    assert(committed.history?.undoCount === (historyBeforeCommit?.undoCount ?? 0) + 1, `0ms edit did not create one History entry: ${JSON.stringify({ historyBeforeCommit, committed })}`);

    return {
      issue: 579,
      passed: true,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      projectRoot,
      saveRequestCount,
      baseEdit: {
        atZero,
        atTemporal,
        returned,
        committed,
      },
      blurRace: {
        before: raceBefore,
        after: raceAfter,
      },
      screenshots: [
        'base-edit-view-0ms.png',
        'temporal-read-only-nonzero.png',
        'base-edit-view-returned-0ms.png',
      ],
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function main() {
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(evidenceRoot, { recursive: true });
  let output;
  try {
    output = await run();
  } catch (error) {
    output = {
      issue: 579,
      passed: false,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      saveRequestCount,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
    throw error;
  } finally {
    writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[issue579] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
