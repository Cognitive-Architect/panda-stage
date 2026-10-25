const { app, BrowserWindow, clipboard } = require('electron');
const { execFileSync } = require('node:child_process');
const {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

process.env.VITE_DEV_SERVER_URL = '';

const repositoryRoot = path.resolve(__dirname, '..');
const sampleProjectSource = process.env.PANDA_ISSUE854_SAMPLE_PROJECT
  ? path.resolve(process.env.PANDA_ISSUE854_SAMPLE_PROJECT)
  : null;
const thumbnailCacheProjectSource = process.env.PANDA_ISSUE854_THUMBNAIL_CACHE_PROJECT
  ? path.resolve(process.env.PANDA_ISSUE854_THUMBNAIL_CACHE_PROJECT)
  : null;
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue854-v0-acceptance';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const primaryProjectRoot = path.join(runRoot, 'AC03 isolated project.pandastage');
let activeProjectRoot = primaryProjectRoot;
const userDataRoot = path.join(runRoot, 'electron-user-data');
const receiptPath = path.join(runRoot, 'issue854-ac03-receipt.json');
const elapsedStart = Date.now();
const packageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
let windowRef = null;

function configureElectronPaths() {
  for (const [name, directory] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron path keys are immutable after readiness.
    }
  }
}

function seedThumbnailCache(targetProjectRoot, project) {
  if (!thumbnailCacheProjectSource) {
    return { seeded: false, assetHashes: [] };
  }
  const cacheSourceDirectory = path.join(
    thumbnailCacheProjectSource,
    'cache',
    'asset-thumbnails',
  );
  const referenceProject = JSON.parse(
    readFileSync(path.join(thumbnailCacheProjectSource, 'project.json'), 'utf8'),
  );
  const imageAssets = project.assets.filter(
    (asset) => asset.kind === 'image' && asset.sha256,
  );
  const assetHashes = [];
  for (const asset of imageAssets) {
    const referenceAsset = referenceProject.assets.find(
      (candidate) => candidate.id === asset.id,
    );
    if (!referenceAsset || referenceAsset.sha256 !== asset.sha256) {
      throw new Error(`The thumbnail cache does not match sample Asset ${asset.id}.`);
    }
    const cacheFileName = `v1-max256-${asset.sha256}.png`;
    const sourcePath = path.join(cacheSourceDirectory, cacheFileName);
    if (!existsSync(sourcePath)) {
      throw new Error(`The validated thumbnail cache is missing ${cacheFileName}.`);
    }
    const targetDirectory = path.join(
      targetProjectRoot,
      'cache',
      'asset-thumbnails',
    );
    mkdirSync(targetDirectory, { recursive: true });
    copyFileSync(sourcePath, path.join(targetDirectory, cacheFileName));
    assetHashes.push(asset.sha256);
  }
  return { seeded: true, assetHashes };
}

mkdirSync(runRoot, { recursive: true });
configureElectronPaths();
require('../dist-electron/main/index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserWait(expression, message, timeout = 25_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
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
      `${message} Renderer wait failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function captureClipboardState() {
  const formats = clipboard.availableFormats();
  return {
    formats,
    buffers: formats.map((format) => [format, clipboard.readBuffer(format)]),
    text: clipboard.readText(),
  };
}

function restoreClipboardState(state) {
  let formatsRestored = false;
  try {
    clipboard.clear();
    for (const [format, buffer] of state.buffers) {
      clipboard.writeBuffer(format, buffer);
    }
    const restoredFormats = clipboard.availableFormats();
    formatsRestored = (
      state.formats.length === restoredFormats.length &&
      state.formats.every((format) => restoredFormats.includes(format)) &&
      state.buffers.every(([format, buffer]) =>
        clipboard.readBuffer(format).equals(buffer),
      )
    );
  } catch {
    // Continue with plain text if Windows rejects restoring a clipboard format.
  }
  if (clipboard.readText() !== state.text) {
    clipboard.clear();
    clipboard.writeText(state.text);
    formatsRestored = false;
  }
  return {
    textRestored: clipboard.readText() === state.text,
    formatsRestored,
  };
}

function normalizeClipboardText(text) {
  return text.replace(/\r\n?/gu, '\n');
}

async function click(window, selector) {
  try {
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
  } catch (error) {
    let state;
    try {
      state = await window.webContents.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
        return {
          elementFound: Boolean(element),
          elementTag: element?.tagName ?? null,
          disabled: element instanceof HTMLButtonElement ? element.disabled : null,
          elementText: element?.textContent?.trim() ?? null,
          drawerExpanded: drawer?.dataset.expanded ?? null,
          editorPage: Boolean(document.querySelector('[data-editor-page="editor"]')),
          bodyTextStart: document.body.innerText.slice(0, 240),
        };
      })()`);
    } catch (diagnosticError) {
      state = {
        diagnosticError: diagnosticError instanceof Error
          ? diagnosticError.message
          : String(diagnosticError),
      };
    }
    throw new Error(
      `Click failed for ${selector}: ${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

async function clickWithMouseInput(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Element is not visibly clickable: ' + ${JSON.stringify(selector)});
    }
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  await delay(30);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  await delay(40);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
}

async function doubleClickWithMouseInput(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Element is not visibly clickable: ' + ${JSON.stringify(selector)});
    }
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  for (const clickCount of [1, 2]) {
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount,
      x: point.x,
      y: point.y,
    });
    await delay(35);
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount,
      x: point.x,
      y: point.y,
    });
    await delay(35);
  }
}

async function capture(window, fileName) {
  await delay(220);
  const filePath = path.join(evidenceRoot, fileName);
  writeFileSync(filePath, (await window.webContents.capturePage()).toPNG());
  return path.relative(runRoot, filePath).replaceAll('\\', '/');
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) =>
        !candidate.isDestroyed() &&
        !candidate.webContents.getURL().includes('hidden.html'),
    );
    if (window) return window;
    await delay(50);
  }
  throw new Error('The production Electron window did not open.');
}

function prepareSampleProject(
  targetProjectRoot = activeProjectRoot,
  shotNamePrefix = 'AC03 真实验收',
) {
  if (!sampleProjectSource) {
    throw new Error(
      'Set PANDA_ISSUE854_SAMPLE_PROJECT to the existing frozen AC-01 sample Project.',
    );
  }
  if (!existsSync(path.join(sampleProjectSource, 'project.json'))) {
    throw new Error('The requested frozen sample Project is not readable.');
  }
  if (path.resolve(sampleProjectSource) === path.resolve(targetProjectRoot)) {
    throw new Error('Refusing to copy the sample Project onto itself.');
  }
  const sourceProjectJson = path.join(sampleProjectSource, 'project.json');
  const sourceProjectHashBefore = createHash('sha256')
    .update(readFileSync(sourceProjectJson))
    .digest('hex');
  cpSync(sampleProjectSource, targetProjectRoot, {
    recursive: true,
    errorOnExist: true,
  });
  const project = JSON.parse(
    readFileSync(path.join(targetProjectRoot, 'project.json'), 'utf8'),
  );
  const thumbnailCache = seedThumbnailCache(targetProjectRoot, project);
  const backgrounds = project.assets.filter(
    (asset) =>
      asset.name === 'Garden' &&
      asset.kind === 'image' &&
      asset.usage === 'background' &&
      asset.metadata?.status !== 'error',
  );
  const characters = project.characters.filter(
    (character) => character.mode === 'composite',
  );
  if (backgrounds.length !== 1 || characters.length !== 1) {
    throw new Error(
      `Expected one legal Garden background and one composite Character; found ${backgrounds.length} backgrounds and ${characters.length} Characters.`,
    );
  }
  const background = backgrounds[0];
  const character = characters[0];
  const characterAssetIds = [
    character.bodyAssetId,
    ...character.expressions.map((expression) => expression.assetId),
    ...(character.head ? [character.head.assetId] : []),
    ...(character.mouthOpenAssetId ? [character.mouthOpenAssetId] : []),
  ];
  if (
    characterAssetIds.some((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      return !asset || asset.kind !== 'image' || asset.metadata?.status === 'error';
    })
  ) {
    throw new Error('The frozen composite Character references an unavailable image Asset.');
  }
  const sourceProjectHashAfter = createHash('sha256')
    .update(readFileSync(sourceProjectJson))
    .digest('hex');
  if (sourceProjectHashBefore !== sourceProjectHashAfter) {
    throw new Error('The original frozen sample Project changed during preparation.');
  }
  return {
    project,
    background,
    character,
    sourceProjectHashBefore,
    thumbnailCache,
    targetProjectRoot,
    shotName: `${shotNamePrefix} ${runId}`,
  };
}

async function ensureShotsActivity(window) {
  await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    if (dock?.dataset.activeActivity !== 'shots' || dock?.dataset.resourceDrawerOpen !== 'true') {
      const button = document.querySelector('[data-testid="resource-activity-rail-shots"]')
        ?? document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]');
      button?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="shot-manager"]')`,
    'The production Shots workspace did not open.',
  );
}

async function setSceneInput(window, input) {
  console.log('[issue854] Filling structured scene input.');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-input"]') instanceof HTMLTextAreaElement`,
    'Structured scene input was not ready to receive the request.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('[data-testid="scene-creation-input"]');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Structured scene input did not render.');
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(input)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  })()`);
  console.log('[issue854] Structured scene input event dispatched.');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-input"]')?.value === ${JSON.stringify(input)}`,
    'The structured scene request did not fill the production input.',
  );
}
async function readUiState(window, characterLayerId = null) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layers = stage ? JSON.parse(stage.dataset.layerJson || '[]') : [];
    const requestedCharacterLayerId = ${JSON.stringify(characterLayerId)};
    const character = requestedCharacterLayerId
      ? layers.find((layer) => layer.id === requestedCharacterLayerId)
      : layers.find((layer) => layer.source?.kind === 'character');
    const history = document.querySelector('[data-testid="history-controls"]');
    const actions = document.querySelector('[data-testid="quick-action-drawer"]');
    return {
      revision: stage ? Number(stage.dataset.projectRevision) : null,
      layers: layers.map((layer) => ({
        id: layer.id,
        x: layer.x,
        y: layer.y,
        scale: layer.scale,
        source: layer.source,
      })),
      character: character ? {
        id: character.id,
        x: character.x,
        y: character.y,
        scale: character.scale,
        source: character.source,
      } : null,
      selectedLayerId: stage?.dataset.selectedLayerId ?? null,
      selectedShot: document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() ?? null,
      shotCount: document.querySelectorAll('.shot-list-item').length,
      undoCount: history ? Number(history.dataset.undoCount) : null,
      redoCount: history ? Number(history.dataset.redoCount) : null,
      saveState: actions?.dataset.saveState ?? null,
      imageIds: stage ? JSON.parse(stage.dataset.renderedAssetIds || '[]') : [],
      backgroundReady: stage?.dataset.backgroundReady === 'true',
    };
  })()`);
}

async function selectCharacterLayer(window, expectedLayerId) {
  const target = await window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layer = JSON.parse(stage?.dataset.layerJson || '[]')
      .find((candidate) => candidate.id === ${JSON.stringify(expectedLayerId)});
    const logicalStage = document.querySelector('[data-testid="canvas-logical-stage"]');
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    if (!layer || !logicalStage || !viewport) {
      throw new Error('The generated Character layer is not available on the canvas.');
    }
    const rect = logicalStage.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    return {
      x: Math.round(rect.left + layer.x * scale),
      y: Math.round(rect.top + layer.y * scale),
    };
  })()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    window.webContents.sendInputEvent({
      type,
      ...(type === 'mouseMove'
        ? {}
        : { button: 'left', clickCount: 1 }),
      x: target.x,
      y: target.y,
    });
  }
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId === ${JSON.stringify(expectedLayerId)}`,
    'The Character layer could not be selected through the production canvas.',
    4_000,
  );
  return target;
}

async function dragCharacter(window, layerId, logicalDx) {
  const target = await selectCharacterLayer(window, layerId);
  const scale = await window.webContents.executeJavaScript(
    `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale)`,
  );
  const end = { x: target.x + Math.max(8, Math.round(logicalDx * scale)), y: target.y };
  window.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
  await delay(50);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: target.x,
    y: target.y,
  });
  await delay(60);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: end.x, y: end.y });
  await delay(120);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: end.x,
    y: end.y,
  });
}

async function openQuickActions(window) {
  await window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'The Quick Action Drawer did not open.',
  );
}

async function saveProject(window) {
  await openQuickActions(window);
  const state = await readUiState(window);
  if (state.saveState === 'saved') return;
  if (state.saveState === 'saving') {
    await waitForDom(
      window,
      `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState === 'saved'`,
      'The Project did not finish its current save.',
    );
    return;
  }
  await click(window, '[data-testid="quick-action-save"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState === 'saved'`,
    'The Project did not reach its saved state.',
  );
}

async function openProjectCenter(window) {
  await openQuickActions(window);
  await click(window, '[data-testid="quick-action-home"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]')`,
    'Project Center did not open from the Quick Action Drawer.',
  );
}

async function openProject(window, targetProjectRoot = activeProjectRoot) {
  if (
    await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-editor-page="editor"]'))`,
    )
  ) {
    await openProjectCenter(window);
  }
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its open-project input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(targetProjectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') && document.querySelector('[data-testid="editor-layout"]')`,
    'The isolated sample Project did not reopen in the editor.',
  );
  await ensureShotsActivity(window);
}

async function closeCleanProject(window) {
  await openQuickActions(window);
  await click(window, '[data-testid="quick-action-close"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]') || document.querySelector('[data-testid="close-confirm-dialog"]')`,
    'The close action did not leave the editor or show its confirmation.',
  );
  if (
    await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`,
    )
  ) {
    await click(window, '[data-testid="close-confirm-save"]');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="project-center"]')`,
      'Saving and closing did not return to Project Center.',
    );
  }
}

async function selectShot(window, name) {
  await window.webContents.executeJavaScript(`(() => {
    const row = [...document.querySelectorAll('.shot-list-item')]
      .find((item) => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(name)});
    const button = row?.querySelector('button');
    if (!button) throw new Error('Shot list item not found: ' + ${JSON.stringify(name)});
    button.click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() === ${JSON.stringify(name)}`,
    'The generated Shot could not be selected after reopening.',
  );
}

function layerPositionExpression(layerId, expectedX) {
  return "(() => { const stage = document.querySelector('[data-testid=\"project-canvas-stage\"]'); const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === " +
    JSON.stringify(layerId) +
    "); return Boolean(layer && Math.abs(layer.x - " +
    expectedX +
    ") < 0.01); })()";
}

async function verifyExistingManualShot(window, sample) {
  const existingShot = sample.project.shots.find((shot) =>
    shot.layers.some((layer) => layer.source?.kind === 'character'),
  );
  assert(
    existingShot,
    'The frozen sample Project has no existing manually editable Character Shot.',
  );
  const existingCharacterLayer = existingShot.layers.find(
    (layer) => layer.source?.kind === 'character',
  );
  assert(existingCharacterLayer, 'The existing Character layer is missing.');
  await selectShot(window, existingShot.name);
  await waitForDom(
    window,
    "document.querySelector('[data-testid=\"project-canvas-stage\"]')?.dataset.backgroundReady === 'true'",
    'The existing sample Shot did not render its background.',
  );
  const baseline = await readUiState(window, existingCharacterLayer.id);
  assert(baseline.character, 'The existing Shot Character is not on the canvas.');
  const beforeScreenshot = await capture(window, 'existing-shot-before-manual-edit.png');

  await dragCharacter(window, existingCharacterLayer.id, 32);
  await waitForDom(
    window,
    "(() => { const stage = document.querySelector('[data-testid=\"project-canvas-stage\"]'); const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === " +
      JSON.stringify(existingCharacterLayer.id) +
      "); return Boolean(layer && Math.abs(layer.x - " +
      baseline.character.x +
      ") >= 16 && Number(stage.dataset.projectRevision) > 0); })()",
    'The existing manually authored Character Shot could not be adjusted.',
  );
  const moved = await readUiState(window, existingCharacterLayer.id);
  assert(moved.character?.x !== baseline.character.x, 'The existing Shot edit did not change its Character position.');
  const adjustedScreenshot = await capture(window, 'existing-shot-manual-edit.png');

  await openQuickActions(window);
  await click(window, '[data-testid="history-controls"] button[aria-label="撤销"]');
  await waitForDom(
    window,
    layerPositionExpression(existingCharacterLayer.id, baseline.character.x),
    'Undo did not restore the existing Shot Character position.',
  );
  await click(window, '[data-testid="history-controls"] button[aria-label="重做"]');
  await waitForDom(
    window,
    layerPositionExpression(existingCharacterLayer.id, moved.character.x),
    'Redo did not restore the existing Shot manual edit.',
  );

  await saveProject(window);
  const savedProject = readProjectFile();
  const savedShot = savedProject.shots.find((shot) => shot.id === existingShot.id);
  const savedCharacterLayer = savedShot?.layers.find(
    (layer) => layer.id === existingCharacterLayer.id,
  );
  assert(savedCharacterLayer, 'Saving the existing Shot removed its Character layer.');
  assert(
      savedCharacterLayer.x === moved.character.x &&
      savedCharacterLayer.y === moved.character.y &&
      savedCharacterLayer.scale === moved.character.scale,
    'Saving the existing Shot did not preserve its redone manual edit.',
  );
  await closeCleanProject(window);
  await openProject(window);
  await selectShot(window, existingShot.name);
  await waitForDom(
    window,
    "document.querySelector('[data-testid=\"project-canvas-stage\"]')?.dataset.backgroundReady === 'true'",
    'The existing Shot did not render after the saved Project reopened.',
  );
  const reopened = await readUiState(window, existingCharacterLayer.id);
  assert(reopened.revision === 0, 'The reopened existing Project inherited a renderer revision.');
  assert(
    reopened.character?.x === moved.character.x &&
      reopened.character?.y === moved.character.y &&
      reopened.character?.scale === moved.character.scale,
    'The existing Shot manual edit changed after save and reopen.',
  );
  const reopenedScreenshot = await capture(window, 'existing-shot-saved-reopened.png');

  return {
    shotId: existingShot.id,
    characterLayerId: existingCharacterLayer.id,
    baselinePosition: {
      x: baseline.character.x,
      y: baseline.character.y,
      scale: baseline.character.scale,
    },
    manuallyAdjustedPosition: {
      x: moved.character.x,
      y: moved.character.y,
      scale: moved.character.scale,
    },
    undoRestoredBaseline: true,
    redoSavedAndReopenedManualEdit: true,
    reopenedRevision: reopened.revision,
    screenshots: {
      before: beforeScreenshot,
      adjusted: adjustedScreenshot,
      reopened: reopenedScreenshot,
    },
  };
}

function readProjectFile(targetProjectRoot = activeProjectRoot) {
  return JSON.parse(
    readFileSync(path.join(targetProjectRoot, 'project.json'), 'utf8'),
  );
}

function projectShotAndCharacter(project, shotName, characterLayerId) {
  const shot = project.shots.find((candidate) => candidate.name === shotName);
  if (!shot) return null;
  const layer = shot.layers.find((candidate) => candidate.id === characterLayerId);
  return layer ? { shot, layer } : null;
}

function sceneInput(sample, shotName = sample.shotName) {
  return [
    `镜头：${shotName}`,
    `背景：${sample.background.name}`,
    `出场：${sample.character.name}`,
  ].join('\n');
}

async function openStructuredCreation(window) {
  await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    if (dock?.dataset.activeActivity !== 'shots' || dock.dataset.resourceDrawerOpen !== 'true') {
      const button = document.querySelector('[data-testid="resource-activity-rail-shots"]')
        ?? document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]');
      button?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`,
    'The Shots workspace did not open.',
  );
  const shotView = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView ?? null`,
  );
  if (shotView !== 'list') {
    await click(window, '[data-testid="resource-primary-action"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'list'`,
      'The active Shot flow did not return to its list.',
    );
  }
  await click(window, '[data-testid="resource-auto-scene-action"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Automatic scene creation did not open from the Shot list.',
  );
}

async function inspectRealSample(window, sample, shotName = sample.shotName) {
  await setSceneInput(window, sceneInput(sample, shotName));
  await click(window, '[data-testid="scene-creation-inspect"]');
  await waitForDom(
    window,
    `document.querySelectorAll('[data-testid="scene-creation-background-candidate"]').length === 1 && document.querySelectorAll('[data-testid="scene-creation-character-candidate"]').length === 1`,
    'The exact-name real background and composite Character candidates did not render.',
  );
  try {
    await waitForDom(
      window,
      `![...document.querySelectorAll('[data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].some((button) => button.disabled)`,
      'The real sample candidate thumbnails did not become ready.',
    );
  } catch (error) {
    const characterAssetIds = [
      sample.character.bodyAssetId,
      sample.character.head?.assetId,
      ...sample.character.expressions.map((expression) => expression.assetId),
    ].filter(Boolean);
    const probeAssets = [
      sample.background,
      ...characterAssetIds
        .map((assetId) => sample.project.assets.find((asset) => asset.id === assetId))
        .filter(Boolean),
    ];
    const thumbnailReads = await window.webContents.executeJavaScript(
      `Promise.all(${JSON.stringify(probeAssets.map((asset) => ({
        projectRoot: sample.targetProjectRoot,
        assetId: asset.id,
        sha256: asset.sha256 ?? null,
      })))}.map((request) => window.pandaStage.assets.readThumbnail(request)))`,
    );
    const diagnostics = await window.webContents.executeJavaScript(`(() => ({
      activeActivity: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity ?? null,
      scenePanelVisible: Boolean(document.querySelector('[data-testid="scene-creation-panel"]')),
      input: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
      errorMessages: [...document.querySelectorAll('.scene-creation-error')].map((node) => node.textContent?.trim() ?? ''),
      candidates: [...document.querySelectorAll('[data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].map((button) => ({
        kind: button.dataset.candidateKind ?? null,
        id: button.dataset.candidateId ?? null,
        disabled: button.disabled,
        reason: button.querySelector('.scene-creation-candidate-reason')?.textContent?.trim() ?? null,
        thumbnails: [...button.querySelectorAll('[data-thumbnail-status]')].map((node) => ({
          status: node.dataset.thumbnailStatus ?? null,
          label: node.textContent?.trim() ?? '',
        })),
      })),
    }))()`);
    await capture(window, 'candidate-thumbnail-read-failure.png');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} UI=${JSON.stringify(diagnostics)} THUMBNAIL_READS=${JSON.stringify(thumbnailReads).replaceAll(sample.targetProjectRoot, '<isolated project>')}`,
      { cause: error },
    );
  }
}

async function prepareRealPreview(window, sample, shotName = sample.shotName) {
  await inspectRealSample(window, sample, shotName);
  await clickWithMouseInput(window, '[data-testid="scene-creation-preview-action"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-preview"]')?.dataset.previewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-preview-image"]')?.naturalWidth > 0`,
    'The real background and Character preview did not become ready.',
  );
}

function projectResourceIdentity(project) {
  return {
    projectId: project.id,
    assets: project.assets.map((asset) => asset.id).sort(),
    characters: project.characters.map((character) => character.id).sort(),
    shots: project.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      backgroundLayerId: shot.backgroundLayerId,
      layers: shot.layers.map((layer) => ({
        id: layer.id,
        source: layer.source,
      })),
    })),
  };
}

async function verifyCopyFeedback(window, sample) {
  const previousClipboard = captureClipboardState();
  let result;
  let flowError;
  try {
    result = await verifyCopyFeedbackFlow(window, sample);
  } catch (error) {
    flowError = error;
  }
  const clipboardRestore = restoreClipboardState(previousClipboard);
  if (flowError) throw flowError;
  assert(clipboardRestore.textRestored, 'The verifier could not restore the prior system clipboard text.');
  return {
    ...result,
    previousClipboardTextRestored: clipboardRestore.textRestored,
    previousClipboardFormatsRestored: clipboardRestore.formatsRestored,
  };
}

async function verifyCopyFeedbackFlow(window, sample) {
  await openStructuredCreation(window);
  await click(window, '.scene-creation-prompt-details > summary');
  await waitForDom(
    window,
    `document.querySelector('.scene-creation-prompt-details')?.open === true`,
    'The external-AI helper did not expand before copy feedback checks.',
  );
  const initialLayout = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-testid="scene-creation-panel"]');
    const button = document.querySelector('[data-testid="scene-creation-copy-prompt"]');
    return {
      panelHeight: panel?.getBoundingClientRect().height ?? null,
      buttonTop: button?.getBoundingClientRect().top ?? null,
    };
  })()`);

  const failureOverrideInstalled = await window.webContents.executeJavaScript(`(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(clipboard, 'writeText');
    const ownDescriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
    try {
      Object.defineProperty(clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new Error('测试剪贴板拒绝访问。')),
      });
    } catch {
      return false;
    }
    window.__issue858ClipboardRestore = () => {
      if (hadOwnProperty && ownDescriptor) {
        Object.defineProperty(clipboard, 'writeText', ownDescriptor);
      } else {
        delete clipboard.writeText;
      }
      delete window.__issue858ClipboardRestore;
    };
    return true;
  })()`);
  assert(failureOverrideInstalled, 'Could not install the isolated clipboard failure probe.');
  let failedFeedbackScreenshot;
  try {
    await click(window, '[data-testid="scene-creation-copy-prompt"]');
    try {
      await waitForDom(
        window,
        `(() => { const alert = document.querySelector('[data-testid="scene-creation-panel"] output[role="alert"]'); const prompt = document.querySelector('.scene-creation-prompt-details pre'); return Boolean(alert?.textContent?.trim() && alert.getAttribute('aria-live') === 'assertive' && prompt?.textContent?.trim()); })()`,
        'Clipboard failure did not show a persistent manual-copy recovery message.',
      );
    } catch (error) {
      const diagnostics = await window.webContents.executeJavaScript(`(() => ({
        panel: Boolean(document.querySelector('[data-testid="scene-creation-panel"]')),
        alertText: document.querySelector('[data-testid="scene-creation-panel"] output[role="alert"]')?.textContent?.trim() ?? null,
        statusText: document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]')?.textContent?.trim() ?? null,
        promptVisible: Boolean(document.querySelector('.scene-creation-prompt-details pre')?.textContent?.trim()),
        activeElement: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
        buttonRect: (() => { const rect = document.querySelector('[data-testid="scene-creation-copy-prompt"]')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
      }))()`);
      const failureScreenshot = await capture(window, 'copy-feedback-failure-probe-missing.png');
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} failureProbe=${JSON.stringify(diagnostics)} screenshot=${failureScreenshot}`,
        { cause: error },
      );
    }
    failedFeedbackScreenshot = await capture(window, 'copy-feedback-failure.png');
    await delay(3_200);
    const failurePersists = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-testid="scene-creation-panel"] output[role="alert"]'))`,
    );
    assert(failurePersists, 'The clipboard failure recovery message disappeared before a user action.');
  } finally {
    await window.webContents.executeJavaScript(
      `window.__issue858ClipboardRestore?.()`,
    );
  }

  const promptText = await window.webContents.executeJavaScript(
    `document.querySelector('.scene-creation-prompt-details pre')?.textContent ?? null`,
  );
  await click(window, '[data-testid="scene-creation-copy-prompt"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]')?.textContent?.trim())`,
    'Successful prompt copy did not show its transient confirmation.',
  );
  const rendererClipboardText = await window.webContents.executeJavaScript(
    `navigator.clipboard.readText()`,
  );
  const electronClipboardText = clipboard.readText();
  assert(
    normalizeClipboardText(rendererClipboardText) === normalizeClipboardText(promptText) &&
      normalizeClipboardText(electronClipboardText) === normalizeClipboardText(promptText),
    `The real clipboard did not contain the original prompt text (prompt=${promptText.length}, renderer=${rendererClipboardText.length}, Electron=${electronClipboardText.length}).`,
  );
  const visibleFeedbackScreenshot = await capture(window, 'copy-feedback-visible.png');
  const layoutWithFeedback = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-testid="scene-creation-panel"]');
    const button = document.querySelector('[data-testid="scene-creation-copy-prompt"]');
    const feedback = document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]');
    const feedbackStyle = feedback ? getComputedStyle(feedback) : null;
    return {
      panelHeight: panel?.getBoundingClientRect().height ?? null,
      buttonTop: button?.getBoundingClientRect().top ?? null,
      position: feedbackStyle?.position ?? null,
    };
  })()`);
  assert(
    layoutWithFeedback.panelHeight === initialLayout.panelHeight &&
      layoutWithFeedback.buttonTop === initialLayout.buttonTop &&
      layoutWithFeedback.position === 'fixed',
    'Transient copy feedback changed the panel or button layout instead of floating above it.',
  );

  await delay(1_450);
  await click(window, '[data-testid="scene-creation-copy-prompt"]');
  await delay(1_750);
  const repeatedFeedbackRemains = await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]'))`,
  );
  assert(repeatedFeedbackRemains, 'The previous copy timer cleared feedback after a rapid repeated click.');
  await delay(1_450);
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]')`,
    'Successful copy feedback did not disappear about three seconds after the latest click.',
    2_000,
  );

  await click(window, '[data-testid="scene-creation-copy-prompt"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="scene-creation-panel"] output[role="status"]')?.textContent?.trim())`,
    'The copy feedback did not reappear for a new copy action.',
  );
  await closeCleanProject(window);
  await delay(3_200);
  await openProject(window, sample.targetProjectRoot);
  await openStructuredCreation(window);
  const afterReopen = await window.webContents.executeJavaScript(`(() => ({
    panel: Boolean(document.querySelector('[data-testid="scene-creation-panel"]')),
    staleFeedback: Boolean(document.querySelector('[data-testid="scene-creation-panel"] output')),
  }))()`);
  assert(afterReopen.panel && !afterReopen.staleFeedback, 'Copy feedback resurfaced after leaving and reopening the editor page.');
  const reopenedScreenshot = await capture(window, 'copy-feedback-after-reopen.png');
  await closeCleanProject(window);

  return {
    failureVisibleAndPersistent: true,
    recoveryTextOffersManualCopy: true,
    promptCopiedVerbatimToRealClipboard: true,
    successDisappearsAfterLatestClick: true,
    repeatedClickResetsTimer: true,
    panelLayoutUnchanged: true,
    feedbackFloats: true,
    leavingPageClearsFeedback: true,
    screenshots: {
      failure: failedFeedbackScreenshot,
      visible: visibleFeedbackScreenshot,
      reopened: reopenedScreenshot,
    },
  };
}

async function verifyStalePreview(window) {
  const targetProjectRoot = path.join(runRoot, 'RF04 isolated stale preview.pandastage');
  const sample = prepareSampleProject(targetProjectRoot, 'RF04 过期预览');
  const existingShot = sample.project.shots.find((shot) =>
    shot.layers.some((layer) => layer.source?.kind === 'character'),
  );
  const characterLayer = existingShot?.layers.find((layer) => layer.source?.kind === 'character');
  assert(existingShot && characterLayer, 'The isolated sample has no existing editable Character Shot.');
  await openProject(window, targetProjectRoot);
  await selectShot(window, existingShot.name);
  const beforeProjectEdit = await readUiState(window, characterLayer.id);
  assert(
    beforeProjectEdit.revision === 0 &&
      beforeProjectEdit.shotCount === sample.project.shots.length &&
      beforeProjectEdit.character,
    `The stale-preview baseline is not a clean, read-only Project: ${JSON.stringify({
      revision: beforeProjectEdit.revision,
      shotCount: beforeProjectEdit.shotCount,
      expectedShotCount: sample.project.shots.length,
      selectedShot: beforeProjectEdit.selectedShot,
    })}`,
  );
  await openStructuredCreation(window);
  await prepareRealPreview(window, sample);
  const previewState = await readUiState(window, characterLayer.id);
  assert(
    previewState.revision === beforeProjectEdit.revision &&
      previewState.character?.x === beforeProjectEdit.character.x &&
      previewState.undoCount === beforeProjectEdit.undoCount &&
      previewState.saveState === beforeProjectEdit.saveState,
    'Preparing the stale-preview scenario changed the Project or History.',
  );
  const previewScreenshot = await capture(window, 'rf04-stale-preview-before-edit.png');

  await dragCharacter(window, characterLayer.id, 24);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"] [role="alert"]')?.textContent?.includes('预览已失效') && !document.querySelector('[data-testid="scene-creation-confirm"]')`,
    'A formal canvas edit did not invalidate and remove the old preview confirmation.',
  );
  const afterProjectEdit = await readUiState(window, characterLayer.id);
  assert(
    afterProjectEdit.revision === beforeProjectEdit.revision + 1 &&
      afterProjectEdit.character?.x !== beforeProjectEdit.character?.x &&
      afterProjectEdit.saveState === 'dirty' &&
      afterProjectEdit.undoCount === beforeProjectEdit.undoCount + 1,
    `The formal canvas edit did not produce the expected single dirty History step: ${JSON.stringify({
      before: {
        revision: beforeProjectEdit.revision,
        shotCount: beforeProjectEdit.shotCount,
        characterX: beforeProjectEdit.character?.x,
        saveState: beforeProjectEdit.saveState,
        undoCount: beforeProjectEdit.undoCount,
      },
      after: {
        revision: afterProjectEdit.revision,
        shotCount: afterProjectEdit.shotCount,
        characterX: afterProjectEdit.character?.x,
        saveState: afterProjectEdit.saveState,
        undoCount: afterProjectEdit.undoCount,
      },
    })}`,
  );
  const staleScreenshot = await capture(window, 'rf04-stale-preview-invalidated.png');
  const beforeRecovery = await readUiState(window, characterLayer.id);
  assert(
    beforeRecovery.revision === afterProjectEdit.revision &&
      beforeRecovery.undoCount === afterProjectEdit.undoCount &&
      beforeRecovery.redoCount === afterProjectEdit.redoCount &&
      beforeRecovery.saveState === afterProjectEdit.saveState,
    'The unavailable stale confirm changed the Project after the real edit.',
  );

  await clickWithMouseInput(window, '[data-testid="scene-creation-panel"] .scene-creation-stale button');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"] .scene-creation-stale') === null && document.querySelector('[data-testid="scene-creation-preview-action"]')`,
    'Rechecking the current Project did not recover from the stale preview.',
  );
  await waitForDom(
    window,
    `![...document.querySelectorAll('[data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].some((button) => button.disabled)`,
    'Rechecked candidates did not become available.',
  );
  await clickWithMouseInput(window, '[data-testid="scene-creation-preview-action"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-preview"]')?.dataset.previewStatus === 'ready'`,
    'A new preview could not be prepared after rechecking.',
  );
  const afterRecovery = await readUiState(window, characterLayer.id);
  assert(
    afterRecovery.revision === afterProjectEdit.revision &&
      afterRecovery.undoCount === afterProjectEdit.undoCount &&
      afterRecovery.redoCount === afterProjectEdit.redoCount &&
      afterRecovery.saveState === afterProjectEdit.saveState,
    'Rechecking or preparing a replacement preview changed the Project or History.',
  );
  const recoveredScreenshot = await capture(window, 'rf04-stale-preview-recovered.png');
  await saveProject(window);
  const savedProject = readProjectFile(targetProjectRoot);
  assert(
    JSON.stringify(projectResourceIdentity(savedProject)) ===
      JSON.stringify(projectResourceIdentity(sample.project)),
    'Stale-preview handling changed existing Shot, Asset, or Character identities.',
  );
  assert(savedProject.shots.length === sample.project.shots.length, 'Stale confirmation created a Shot.');
  await closeCleanProject(window);

  return {
    oldPreviewInvalidatedByFormalCanvasEdit: true,
    staleConfirmUnavailable: true,
    staleConfirmDidNotChangePostEditRevisionDirtyHistoryOrShotCount: true,
    assetAndCharacterIdentitiesPreserved: true,
    persistedShotCountAfterSave: savedProject.shots.length,
    recheckAndReplacementPreviewRemainReadOnly: true,
    thumbnailCacheSeeded: sample.thumbnailCache.seeded,
    thumbnailCacheAssetHashes: sample.thumbnailCache.assetHashes,
    screenshots: {
      preview: previewScreenshot,
      invalidated: staleScreenshot,
      recovered: recoveredScreenshot,
    },
    beforeEdit: beforeProjectEdit,
    afterEdit: afterProjectEdit,
    afterStaleConfirmationCheck: beforeRecovery,
    afterRecovery: afterRecovery,
  };
}

async function verifyDoubleConfirm(window) {
  console.log('[issue854] Starting RF04 double-confirm project.');
  const targetProjectRoot = path.join(runRoot, 'RF04 isolated double confirm.pandastage');
  const sample = prepareSampleProject(targetProjectRoot, 'RF04 连续确认');
  await openProject(window, targetProjectRoot);
  console.log('[issue854] RF04 double-confirm project opened.');
  const beforeConfirm = await readUiState(window);
  assert(
    beforeConfirm.revision === 0 &&
      beforeConfirm.shotCount === sample.project.shots.length,
    `The double-confirm baseline is not a clean, read-only Project: ${JSON.stringify({
      revision: beforeConfirm.revision,
      shotCount: beforeConfirm.shotCount,
      expectedShotCount: sample.project.shots.length,
    })}`,
  );
  await openStructuredCreation(window);
  console.log('[issue854] RF04 double-confirm panel opened.');
  await prepareRealPreview(window, sample);
  console.log('[issue854] RF04 double-confirm preview prepared.');
  const preparedPreview = await readUiState(window);
  assert(
    preparedPreview.revision === beforeConfirm.revision &&
      preparedPreview.undoCount === beforeConfirm.undoCount &&
      preparedPreview.saveState === beforeConfirm.saveState,
    'Preparing the double-confirm preview changed the Project or History.',
  );
  assert(beforeConfirm.revision === 0 && beforeConfirm.shotCount === sample.project.shots.length, 'The double-confirm baseline is not a clean, read-only Project.');
  const beforeScreenshot = await capture(window, 'rf04-double-confirm-before.png');

  await doubleClickWithMouseInput(window, '[data-testid="scene-creation-confirm"]');
  console.log('[issue854] RF04 double-confirm input delivered.');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="scene-creation-panel"]') && document.querySelectorAll('.shot-list-item').length === ${sample.project.shots.length + 1} && document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() === ${JSON.stringify(sample.shotName)}`,
    'Rapid real Electron confirmation did not create and select exactly one Shot.',
  );
  const afterConfirm = await readUiState(window);
  assert(
    afterConfirm.revision === beforeConfirm.revision + 1 &&
      afterConfirm.shotCount === beforeConfirm.shotCount + 1 &&
      afterConfirm.undoCount === beforeConfirm.undoCount + 1 &&
      afterConfirm.redoCount === beforeConfirm.redoCount,
    'Repeated confirmation did not produce exactly one revision and formal History step.',
  );
  const createdScreenshot = await capture(window, 'rf04-double-confirm-created-once.png');
  await saveProject(window);
  const createdProject = readProjectFile(targetProjectRoot);
  const createdScene = createdProject.shots.find((shot) => shot.name === sample.shotName);
  assert(createdScene, 'The one confirmed Shot was not present in the project snapshot.');
  assert(
    createdScene.layers.length === 2 &&
      createdScene.backgroundLayerId !== null &&
      createdScene.layers.some((layer) =>
        layer.id === createdScene.backgroundLayerId &&
        layer.source?.kind === 'asset' &&
        layer.source.assetId === sample.background.id,
      ) &&
      createdScene.layers.filter((layer) =>
        layer.source?.kind === 'character' &&
        layer.source.characterId === sample.character.id,
      ).length === 1,
    'Repeated confirmation did not create exactly the expected background and Character layers.',
  );

  await openQuickActions(window);
  await clickWithMouseInput(window, '[data-testid="history-controls"] button[aria-label="撤销"]');
  await waitForDom(
    window,
    `document.querySelectorAll('.shot-list-item').length === ${sample.project.shots.length} && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '1'`,
    'One Undo did not remove the entire single generated scene.',
  );
  const undone = await readUiState(window);
  assert(undone.revision === afterConfirm.revision + 1, 'Undo after repeated confirmation had an unexpected revision.');
  const undoScreenshot = await capture(window, 'rf04-double-confirm-undo.png');
  await clickWithMouseInput(window, '[data-testid="history-controls"] button[aria-label="重做"]');
  await waitForDom(
    window,
    `document.querySelectorAll('.shot-list-item').length === ${sample.project.shots.length + 1} && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '0'`,
    'One Redo did not restore the single generated scene.',
  );
  const redone = await readUiState(window);
  assert(redone.shotCount === sample.project.shots.length + 1, 'Redo restored more than one Shot.');
  const redoScreenshot = await capture(window, 'rf04-double-confirm-redo.png');
  await saveProject(window);
  const savedProject = readProjectFile(targetProjectRoot);
  const savedScene = savedProject.shots.find((shot) => shot.name === sample.shotName);
  assert(savedProject.shots.length === sample.project.shots.length + 1 && savedScene, 'The confirmed scene did not persist exactly once.');
  await closeCleanProject(window);

  return {
    realElectronDoubleClick: true,
    oneShotOneBackgroundLayerOneCharacterLayer: true,
    oneRevisionAndOneHistoryStep: true,
    singleUndoRemovesScene: true,
    singleRedoRestoresScene: true,
    saveAfterRedoPreservesOneScene: true,
    thumbnailCacheSeeded: sample.thumbnailCache.seeded,
    thumbnailCacheAssetHashes: sample.thumbnailCache.assetHashes,
    screenshots: {
      before: beforeScreenshot,
      createdOnce: createdScreenshot,
      undo: undoScreenshot,
      redo: redoScreenshot,
    },
    beforeConfirm,
    afterConfirm,
    afterUndo: undone,
    afterRedo: redone,
  };
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  activeProjectRoot = primaryProjectRoot;
  const sample = prepareSampleProject(primaryProjectRoot, 'AC03 真实验收');
  assert(!sample.project.shots.some((shot) => shot.name === sample.shotName), 'The generated Shot name already exists.');
  windowRef = await waitForMainWindow();
  windowRef.setSize(1600, 1050);
  windowRef.show();
  windowRef.focus();
  windowRef.webContents.focus();
  await openProject(windowRef, sample.targetProjectRoot);
  const copyFeedback = await verifyCopyFeedback(windowRef, sample);
  console.log('[issue854] RF02 copy feedback passed.');
  const stalePreview = await verifyStalePreview(windowRef);
  console.log('[issue854] RF04 stale-preview path passed.');
  const doubleConfirm = await verifyDoubleConfirm(windowRef);
  console.log('[issue854] RF04 double-confirm and History path passed.');
  activeProjectRoot = sample.targetProjectRoot;
  await openProject(windowRef, sample.targetProjectRoot);
  const existingManualFlow = await verifyExistingManualShot(windowRef, sample);
  console.log('[issue854] Existing Shot manual edit path passed.');

  console.log('[issue854] Starting original AC03 structured-creation path.');
  await openStructuredCreation(windowRef);
  const structuredInput = [
    `镜头：${sample.shotName}`,
    `背景：${sample.background.name}`,
    `出场：${sample.character.name}`,
  ].join('\n');
  await setSceneInput(windowRef, structuredInput);
  await click(windowRef, '[data-testid="scene-creation-inspect"]');
  await waitForDom(
    windowRef,
    `document.querySelectorAll('[data-testid="scene-creation-background-candidate"]').length === 1 && document.querySelectorAll('[data-testid="scene-creation-character-candidate"]').length === 1`,
    'The exact-name real background and composite Character candidates did not render.',
  );
  await waitForDom(
    windowRef,
    `![...document.querySelectorAll('[data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].some((button) => button.disabled)`,
    'The real sample candidate thumbnails did not become ready.',
  );
  const beforePreview = await readUiState(windowRef);
  assert(beforePreview.revision === 0, 'Candidate inspection changed the Project revision.');
  await capture(windowRef, 'scene-input-candidates.png');
  await click(windowRef, '[data-testid="scene-creation-preview-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-preview"]')?.dataset.previewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-preview-image"]')?.naturalWidth > 0`,
    'The real background and Character preview did not become ready.',
  );
  await windowRef.webContents.executeJavaScript(
    `document.querySelector('[data-testid="scene-creation-preview"]')?.scrollIntoView({ block: 'end', behavior: 'instant' })`,
  );
  await capture(windowRef, 'read-only-preview.png');
  const beforeConfirm = await readUiState(windowRef);
  assert(beforeConfirm.revision === 0, 'The prepared preview changed the Project revision.');
  await click(windowRef, '[data-testid="scene-creation-confirm"]');
  await waitForDom(
    windowRef,
    `!document.querySelector('[data-testid="scene-creation-panel"]') && document.querySelectorAll('.shot-list-item').length === ${sample.project.shots.length + 1} && document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() === ${JSON.stringify(sample.shotName)}`,
    'Explicit confirmation did not create and select the new Shot.',
  );
  const created = await readUiState(windowRef);
  assert(created.revision === 1, 'Confirmation did not create exactly one Project revision.');
  assert(created.character, 'The new Shot does not expose its Character layer on the canvas.');
  const generatedCharacterLayerId = created.character.id;
  const initialCharacterPosition = {
    x: created.character.x,
    y: created.character.y,
    scale: created.character.scale,
  };
  const generatedScreenshot = await capture(windowRef, 'created-shot.png');

  await dragCharacter(windowRef, generatedCharacterLayerId, 40);
  await waitForDom(
    windowRef,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === ${JSON.stringify(generatedCharacterLayerId)});
      return Boolean(layer && Math.abs(layer.x - ${initialCharacterPosition.x}) >= 20 && Number(stage.dataset.projectRevision) > 1);
    })()`,
    'Dragging the real Character on the canvas did not commit a position edit.',
  );
  const moved = await readUiState(windowRef, generatedCharacterLayerId);
  assert(moved.character && moved.character.x !== initialCharacterPosition.x, 'The canvas drag did not change the Character position.');
  assert(moved.shotCount === sample.project.shots.length + 1, 'Canvas editing changed the Shot count.');
  const adjustedScreenshot = await capture(windowRef, 'canvas-adjustment.png');

  await openQuickActions(windowRef);
  await click(windowRef, '[data-testid="history-controls"] button[aria-label="撤销"]');
  await waitForDom(
    windowRef,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === ${JSON.stringify(generatedCharacterLayerId)});
      const history = document.querySelector('[data-testid="history-controls"]');
      return Boolean(layer && Math.abs(layer.x - ${initialCharacterPosition.x}) < 0.01 && history?.dataset.redoCount === '1');
    })()`,
    'Undo did not restore the generated Character position.',
  );
  const undone = await readUiState(windowRef, generatedCharacterLayerId);
  const undoScreenshot = await capture(windowRef, 'undo-position.png');
  await click(windowRef, '[data-testid="history-controls"] button[aria-label="重做"]');
  await waitForDom(
    windowRef,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === ${JSON.stringify(generatedCharacterLayerId)});
      const history = document.querySelector('[data-testid="history-controls"]');
      return Boolean(layer && Math.abs(layer.x - ${moved.character.x}) < 0.01 && history?.dataset.redoCount === '0');
    })()`,
    'Redo did not restore the canvas adjustment.',
  );
  const redone = await readUiState(windowRef, generatedCharacterLayerId);
  const redoScreenshot = await capture(windowRef, 'redo-position.png');
  assert(undone.shotCount === created.shotCount, 'Undo removed the generated Shot instead of only its position edit.');
  assert(redone.character?.x === moved.character.x, 'Redo restored a different Character position.');

  await saveProject(windowRef);
  const savedProject = readProjectFile();
  const savedScene = projectShotAndCharacter(
    savedProject,
    sample.shotName,
    generatedCharacterLayerId,
  );
  assert(savedScene, 'The generated Shot and Character layer were not persisted to project.json.');
  assert(savedScene.layer.x === moved.character.x, 'The saved Character position differs from the Redo result.');
  assert(!Object.hasOwn(savedProject, 'history'), 'Renderer History leaked into project.json.');

  await closeCleanProject(windowRef);
  await openProject(windowRef);
  await selectShot(windowRef, sample.shotName);
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`,
    'The reopened Shot did not render its real background.',
  );
  const reopened = await readUiState(windowRef, generatedCharacterLayerId);
  assert(reopened.revision === 0, 'A reopened Project inherited the prior session revision.');
  assert(reopened.character?.x === moved.character.x, 'The reopened Shot lost the saved Character position.');
  assert(reopened.imageIds.includes(sample.background.id), 'The reopened canvas did not render the selected background Asset.');
  const bodyAssetId = sample.character.bodyAssetId;
  assert(reopened.imageIds.includes(bodyAssetId), 'The reopened canvas did not render the composite Character body Asset.');
  const reopenedScreenshot = await capture(windowRef, 'reopened-shot.png');

  await dragCharacter(windowRef, generatedCharacterLayerId, 24);
  await waitForDom(
    windowRef,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((candidate) => candidate.id === ${JSON.stringify(generatedCharacterLayerId)});
      return Boolean(layer && Math.abs(layer.x - ${moved.character.x}) >= 12 && Number(stage.dataset.projectRevision) > 0);
    })()`,
    'The reopened Character could not be edited on the canvas.',
  );
  const editedAfterReopen = await readUiState(windowRef, generatedCharacterLayerId);
  assert(editedAfterReopen.character?.x !== moved.character.x, 'The reopened canvas edit did not change the Character position.');
  const reopenedEditScreenshot = await capture(windowRef, 'reopened-editable.png');
  await saveProject(windowRef);
  const finalProject = readProjectFile();
  const finalScene = projectShotAndCharacter(
    finalProject,
    sample.shotName,
    generatedCharacterLayerId,
  );
  assert(finalScene, 'The reopened edit could not be saved.');
  assert(finalScene.layer.x === editedAfterReopen.character.x, 'The second edit did not persist.');

  const sourceProjectHashAfter = createHash('sha256')
    .update(readFileSync(path.join(sampleProjectSource, 'project.json')))
    .digest('hex');
  assert(
    sample.sourceProjectHashBefore === sourceProjectHashAfter,
    'The frozen source Project was modified by the acceptance run.',
  );

  return {
    issue: 854,
    reviewFixIssue: 858,
    acceptance: 'AC03_REAL_WINDOWS_ELECTRON_HAPPY_UNDO_REDO_REOPEN_EDIT',
    additionalAcceptance: 'ISSUE858_RF01_RF02_RF04_CURRENT_HEAD',
    inputMethod: 'Deterministic renderer textarea input event; browser and Electron clipboard contents are checked after copying, while native Electron mouse input drives canvas edits and scene confirmation.',
    passed: true,
    codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    appVersion: packageJson.version,
    electronVersion: process.versions.electron,
    environment: {
      platform: process.platform,
      osRelease: os.release(),
      architecture: os.arch(),
      productionBuild: true,
    },
    humanAcceptance: false,
    sourcePathsOmitted: true,
    sourceProjectUnchanged: sample.sourceProjectHashBefore === sourceProjectHashAfter,
    frozenFixture: {
      projectId: sample.project.id,
      projectJsonSha256: sample.sourceProjectHashBefore,
      thumbnailCacheSeeded: sample.thumbnailCache.seeded,
      thumbnailCacheAssetHashes: sample.thumbnailCache.assetHashes,
    },
    reviewFix: {
      copyFeedback,
      stalePreview,
      doubleConfirm,
    },
    project: {
      id: sample.project.id,
      root: '<isolated acceptance project>',
      sourceProjectJsonSha256: sample.sourceProjectHashBefore,
      backgroundAssetId: sample.background.id,
      characterId: sample.character.id,
      characterBodyAssetId: bodyAssetId,
      initialShotCount: sample.project.shots.length,
      committedShotCount: finalProject.shots.length,
      generatedShotName: sample.shotName,
      generatedShotId: savedScene.shot.id,
      backgroundLayerId: savedScene.shot.backgroundLayerId,
      characterLayerId: generatedCharacterLayerId,
      initialCharacterPosition,
      afterCanvasAdjustment: {
        x: moved.character.x,
        y: moved.character.y,
        scale: moved.character.scale,
        revision: moved.revision,
      },
      undoRestoredPosition: {
        x: undone.character.x,
        y: undone.character.y,
        revision: undone.revision,
        undoCount: undone.undoCount,
        redoCount: undone.redoCount,
      },
      redoRestoredPosition: {
        x: redone.character.x,
        y: redone.character.y,
        revision: redone.revision,
        undoCount: redone.undoCount,
        redoCount: redone.redoCount,
      },
      firstSaveAndReopenSucceeded: true,
      reopenedCharacterPosition: reopened.character.x,
      editableAfterReopen: editedAfterReopen.character.x !== reopened.character.x,
      secondEditSavedPosition: finalScene.layer.x,
      renderedBackgroundAfterReopen: reopened.imageIds.includes(sample.background.id),
      renderedCharacterBodyAfterReopen: reopened.imageIds.includes(bodyAssetId),
      existingManualFlow,
    },
    regressionCases: [
      {
        case: 'malformed, duplicate, unknown, empty, missing fields and line locations',
        evidence: 'tests/unit/scene-creation-service.test.ts — rejects malformed, duplicate, unknown, empty, and missing fields',
      },
      {
        case: 'missing, ambiguous, wrong-usage and unavailable background Assets',
        evidence: 'tests/unit/scene-creation-service.test.ts — reports unusable named candidates; rejects missing, ambiguous, misclassified, and invalid assets',
      },
      {
        case: 'missing, unassembled and invalid-resource Characters',
        evidence: 'tests/unit/scene-creation-service.test.ts — rejects missing, unassembled, and invalid-resource Characters',
      },
      {
        case: 'repeat confirm, resource edit, same-path reopen, project switch, failed build and stale commit',
        evidence: 'tests/integration/scene-creation-lifecycle.test.ts — repeated confirmation, stale preview invalidation, and failed build/stale commit preserve project and history',
      },
      {
        case: 'ambiguous candidates are visible and require an explicit choice before commit',
        evidence: 'scripts/verify-issue853-scene-creation.cjs synthetic ambiguous-candidate Electron mode',
      },
    ],
    timing: {
      manualEndToEndSeconds: 'NOT_MEASURED',
      automatedAuthoringSeconds: 'NOT_MEASURED',
      verifierElapsedSeconds: Number(((Date.now() - elapsedStart) / 1000).toFixed(1)),
      comparison: 'Harness runtime is not a comparable creator workflow measurement.',
    },
    screenshots: {
      candidates: 'evidence/scene-input-candidates.png',
      readOnlyPreview: 'evidence/read-only-preview.png',
      createdShot: generatedScreenshot,
      canvasAdjustment: adjustedScreenshot,
      undo: undoScreenshot,
      redo: redoScreenshot,
      reopened: reopenedScreenshot,
      reopenedEdit: reopenedEditScreenshot,
      existingShotBeforeManualEdit: existingManualFlow.screenshots.before,
      existingShotManualEdit: existingManualFlow.screenshots.adjusted,
      existingShotSavedReopened: existingManualFlow.screenshots.reopened,
      copyFailure: copyFeedback.screenshots.failure,
      copySuccess: copyFeedback.screenshots.visible,
      copyAfterReopen: copyFeedback.screenshots.reopened,
      stalePreview: stalePreview.screenshots.preview,
      stalePreviewInvalidated: stalePreview.screenshots.invalidated,
      stalePreviewRecovered: stalePreview.screenshots.recovered,
      doubleConfirmBefore: doubleConfirm.screenshots.before,
      doubleConfirmCreatedOnce: doubleConfirm.screenshots.createdOnce,
      doubleConfirmUndo: doubleConfirm.screenshots.undo,
      doubleConfirmRedo: doubleConfirm.screenshots.redo,
    },
    receiptPath: '<isolated acceptance receipt>',
  };
}

async function main() {
  mkdirSync(runRoot, { recursive: true });
  let output;
  try {
    await app.whenReady();
    output = await run();
  } catch (error) {
    output = {
      issue: 854,
      reviewFixIssue: 858,
      acceptance: 'AC03_REAL_WINDOWS_ELECTRON_HAPPY_UNDO_REDO_REOPEN_EDIT',
      additionalAcceptance: 'ISSUE858_RF01_RF02_RF04_CURRENT_HEAD',
      passed: false,
      codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      humanAcceptance: false,
      sourcePathsOmitted: true,
    };
    throw error;
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[issue854] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
