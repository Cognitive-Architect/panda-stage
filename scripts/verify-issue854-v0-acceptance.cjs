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
const { createHash, randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

process.env.VITE_DEV_SERVER_URL = '';

const repositoryRoot = path.resolve(__dirname, '..');
const issue916Phase = process.env.ISSUE916_PHASE?.toUpperCase() ?? 'C';
if (!['B', 'C'].includes(issue916Phase)) {
  throw new Error(`Unsupported ISSUE916_PHASE: ${issue916Phase}`);
}
const sampleProjectSource = process.env.PANDA_ISSUE854_SAMPLE_PROJECT
  ? path.resolve(process.env.PANDA_ISSUE854_SAMPLE_PROJECT)
  : null;
const thumbnailCacheProjectSource = process.env.PANDA_ISSUE854_THUMBNAIL_CACHE_PROJECT
  ? path.resolve(process.env.PANDA_ISSUE854_THUMBNAIL_CACHE_PROJECT)
  : null;
const acceptanceRoot = issue916Phase === 'B'
  ? 'D:\\PandaStage-Acceptance\\issue916-phase-b'
  : 'D:\\PandaStage-Acceptance\\issue854-v0-acceptance';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const primaryProjectRoot = path.join(runRoot, 'AC03 isolated project.pandastage');
let activeProjectRoot = primaryProjectRoot;
const userDataRoot = path.join(runRoot, 'electron-user-data');
const receiptPath = path.join(
  runRoot,
  issue916Phase === 'B'
    ? 'issue916-phase-b-receipt.json'
    : 'issue854-ac03-receipt.json',
);
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
    if (window) {
      window.webContents.on('console-message', (...details) => {
        console.error('[issue854 renderer console]', ...details.slice(1));
      });
      window.webContents.on('render-process-gone', (_event, details) => {
        console.error('[issue854 renderer process gone]', details);
      });
      return window;
    }
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

function addMatchReplacementCandidates(sample) {
  const alternateBackgroundSource = path.join(
    repositoryRoot,
    'demo-project',
    'assets',
    'bamboo-background.png',
  );
  const alternateBackgroundBytes = readFileSync(alternateBackgroundSource);
  const alternateBackgroundRelativePath =
    'assets/issue916-alternate-background.png';
  const alternateBackgroundPath = path.join(
    sample.targetProjectRoot,
    alternateBackgroundRelativePath,
  );
  mkdirSync(path.dirname(alternateBackgroundPath), { recursive: true });
  copyFileSync(alternateBackgroundSource, alternateBackgroundPath);
  const alternateBackground = {
    id: randomUUID(),
    name: 'Bamboo alternate',
    relativePath: alternateBackgroundRelativePath,
    mimeType: 'image/png',
    sha256: createHash('sha256').update(alternateBackgroundBytes).digest('hex'),
    kind: 'image',
    width: alternateBackgroundBytes.readUInt32BE(16),
    height: alternateBackgroundBytes.readUInt32BE(20),
    usage: 'background',
    keywords: ['issue916-alternate'],
  };
  const originalVoiceProfile = sample.project.voiceProfiles.find(
    (profile) => profile.id === sample.character.defaultVoiceProfileId,
  );
  if (!originalVoiceProfile) {
    throw new Error('The sample Character has no valid default voice profile.');
  }
  const alternateCharacterId = randomUUID();
  const alternateVoiceProfileId = randomUUID();
  const alternateCharacter = {
    ...sample.character,
    id: alternateCharacterId,
    name: '修仙男（备用测试样本）',
    defaultVoiceProfileId: alternateVoiceProfileId,
  };
  const alternateVoiceProfile = {
    ...originalVoiceProfile,
    id: alternateVoiceProfileId,
    name: '备用测试角色默认语音',
    characterId: alternateCharacterId,
  };
  sample.project.assets.push(alternateBackground);
  sample.project.characters.push(alternateCharacter);
  sample.project.voiceProfiles.push(alternateVoiceProfile);
  writeFileSync(
    path.join(sample.targetProjectRoot, 'project.json'),
    `${JSON.stringify(sample.project, null, 2)}\n`,
    'utf8',
  );
  return {
    background: alternateBackground,
    character: alternateCharacter,
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
        flipX: layer.flipX,
        source: layer.source,
      })),
      character: character ? {
        id: character.id,
        x: character.x,
        y: character.y,
        scale: character.scale,
        flipX: character.flipX,
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

async function readScenePreviewState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.project-canvas');
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    return {
      active: canvas?.dataset.scenePreview === 'true',
      status: canvas?.dataset.scenePreviewStatus ?? null,
      readOnly: stage?.dataset.scenePreviewReadOnly === 'true',
      layers: JSON.parse(stage?.dataset.layerJson || '[]'),
    };
  })()`);
}

async function readSceneMatchRowState(window, kind) {
  const rowSelector = `[data-testid="scene-creation-${kind}-match"]`;
  return window.webContents.executeJavaScript(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)});
    const action = row?.querySelector('.scene-creation-change-match');
    const bounds = action?.getBoundingClientRect();
    return {
      id: row?.dataset.candidateId ?? null,
      kind: row?.dataset.candidateKind ?? null,
      matched: row?.dataset.candidateMatched === 'true',
      selectable: row?.dataset.candidateSelectable === 'true',
      name: row?.querySelector('.scene-creation-match-name')?.textContent?.trim() ?? null,
      successCheck: Boolean(row?.querySelector('.scene-creation-match-indicator[data-matched="true"] .lucide-check')),
      status: row?.querySelector('.scene-creation-match-status')?.textContent?.trim() ?? null,
      actionLabel: action?.getAttribute('aria-label') ?? null,
      actionText: action?.textContent?.trim() ?? null,
      actionWidth: bounds?.width ?? 0,
      actionHeight: bounds?.height ?? 0,
    };
  })()`);
}

async function verifySceneMatchIconInteractions(
  window,
  sample,
  alternatives,
  { requireMainCanvasPreview = true } = {},
) {
  const baseline = await readUiState(window);
  const screenshotPaths = {};
  const assertNoFormalMutation = async (label) => {
    const current = await readUiState(window);
    assert(
      current.revision === baseline.revision &&
        current.shotCount === baseline.shotCount &&
        current.selectedShot === baseline.selectedShot &&
        current.undoCount === baseline.undoCount &&
        current.redoCount === baseline.redoCount &&
        current.saveState === baseline.saveState,
      `${label} changed the formal Project or History: ${JSON.stringify({ baseline, current })}.`,
    );
    return current;
  };
  const assertMatchRow = async (kind, id, name) => {
    const row = await readSceneMatchRowState(window, kind);
    const accessibleName = `更换${kind === 'background' ? '背景' : '角色'}：${name}`;
    assert(
      row.id === id &&
        row.kind === kind &&
        row.matched &&
        row.selectable &&
        row.name === name &&
        row.successCheck &&
        row.status === null &&
        row.actionLabel === accessibleName &&
        row.actionText === '' &&
        row.actionWidth >= 44 &&
        row.actionHeight >= 44,
      `The ${kind} match row does not expose the legal selection and 44px icon action: ${JSON.stringify(row)}.`,
    );
    return row;
  };
  const waitForSelectedPreview = async (backgroundId, characterId, label) => {
    if (!requireMainCanvasPreview) {
      await waitForDom(
        window,
        `document.querySelector('.project-canvas')?.dataset.scenePreview !== 'true'`,
        `${label} unexpectedly activated the Phase C main-canvas preview.`,
      );
      const preview = await readScenePreviewState(window);
      assert(!preview.active, `${label} unexpectedly activated the Phase C preview.`);
      await assertNoFormalMutation(label);
      return preview;
    }
    await waitForDom(
      window,
      `(() => {
        const canvas = document.querySelector('.project-canvas');
        const stage = document.querySelector('[data-testid="project-canvas-stage"]');
        const layers = JSON.parse(stage?.dataset.layerJson || '[]');
        return canvas?.dataset.scenePreview === 'true' &&
          canvas?.dataset.scenePreviewStatus === 'ready' &&
          stage?.dataset.scenePreviewReadOnly === 'true' &&
          layers.some((layer) => layer.source?.kind === 'asset' && layer.source.assetId === ${JSON.stringify(backgroundId)}) &&
          layers.some((layer) => layer.source?.kind === 'character' && layer.source.characterId === ${JSON.stringify(characterId)});
      })()`,
      `${label} did not refresh the read-only main-canvas preview with the chosen resource IDs.`,
    );
    const preview = await readScenePreviewState(window);
    assert(preview.active && preview.readOnly && preview.status === 'ready', `${label} made the main-canvas preview unavailable.`);
    return preview;
  };
  const openPicker = async (kind) => {
    const rowSelector = `[data-testid="scene-creation-${kind}-match"]`;
    const pickerSelector = `[data-testid="scene-creation-${kind}-picker"]`;
    const otherPickerSelector = `[data-testid="scene-creation-${kind === 'background' ? 'character' : 'background'}-picker"]`;
    await assertMatchRow(
      kind,
      kind === 'background' ? sample.background.id : sample.character.id,
      kind === 'background' ? sample.background.name : sample.character.name,
    );
    await clickWithMouseInput(window, `${rowSelector} .scene-creation-change-match`);
    await waitForDom(
      window,
      `document.querySelector(${JSON.stringify(pickerSelector)}) && !document.querySelector(${JSON.stringify(otherPickerSelector)})`,
      `The ${kind} refresh icon did not open only the matching resource selector.`,
    );
    await assertNoFormalMutation(`${kind} selector open`);
    screenshotPaths[`${kind}Picker`] = await capture(
      window,
      `issue916-${kind}-candidate-picker.png`,
    );
    return { pickerSelector, rowSelector };
  };
  const cancelPicker = async (
    kind,
    pickerSelector,
    expectedId,
    expectedName,
    expectedBackgroundId,
    expectedCharacterId,
  ) => {
    await clickWithMouseInput(
      window,
      `${pickerSelector} .scene-creation-picker-heading button`,
    );
    await waitForDom(
      window,
      `!document.querySelector(${JSON.stringify(pickerSelector)}) && document.querySelector('[data-testid="scene-creation-${kind}-match"]')?.dataset.candidateId === ${JSON.stringify(expectedId)}`,
      `Cancelling the ${kind} selector did not preserve its current resource.`,
    );
    await waitForSelectedPreview(
      expectedBackgroundId,
      expectedCharacterId,
      `${kind} selector cancellation`,
    );
    await assertMatchRow(kind, expectedId, expectedName);
    await assertNoFormalMutation(`${kind} selector cancellation`);
  };
  const selectCandidate = async (kind, pickerSelector, candidate) => {
    const candidateSelector = `${pickerSelector} .scene-creation-candidate[data-candidate-id="${candidate.id}"]`;
    await waitForDom(
      window,
      `(() => { const button = document.querySelector(${JSON.stringify(candidateSelector)}); return button instanceof HTMLButtonElement && !button.disabled; })()`,
      `The legal ${kind} candidate ${candidate.name} did not become selectable.`,
    );
    await clickWithMouseInput(window, candidateSelector);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="scene-creation-${kind}-match"]')?.dataset.candidateId === ${JSON.stringify(candidate.id)} && document.querySelector('[data-testid="scene-creation-${kind}-match"]')?.dataset.candidateMatched === 'true'`,
      `Selecting the ${kind} candidate did not update the matched resource ID.`,
    );
    await assertNoFormalMutation(`${kind} candidate selection`);
  };

  const initialBackground = await assertMatchRow(
    'background',
    sample.background.id,
    sample.background.name,
  );
  const initialCharacter = await assertMatchRow(
    'character',
    sample.character.id,
    sample.character.name,
  );
  assert(initialBackground.actionWidth >= 44 && initialCharacter.actionWidth >= 44, 'A match icon target is smaller than 44px.');

  const background = await openPicker('background');
  await cancelPicker(
    'background',
    background.pickerSelector,
    sample.background.id,
    sample.background.name,
    sample.background.id,
    sample.character.id,
  );
  const backgroundAgain = await openPicker('background');
  await selectCandidate('background', backgroundAgain.pickerSelector, alternatives.background);
  await assertMatchRow('background', alternatives.background.id, alternatives.background.name);
  await waitForSelectedPreview(
    alternatives.background.id,
    sample.character.id,
    'Background replacement',
  );
  screenshotPaths.backgroundReplacement = await capture(
    window,
    'issue916-background-replaced.png',
  );

  const character = await openPicker('character');
  await cancelPicker(
    'character',
    character.pickerSelector,
    sample.character.id,
    sample.character.name,
    alternatives.background.id,
    sample.character.id,
  );
  const characterAgain = await openPicker('character');
  await selectCandidate('character', characterAgain.pickerSelector, alternatives.character);
  await assertMatchRow('character', alternatives.character.id, alternatives.character.name);
  const preview = await waitForSelectedPreview(
    alternatives.background.id,
    alternatives.character.id,
    'Character replacement',
  );
  screenshotPaths.characterReplacement = await capture(
    window,
    'issue916-character-replaced.png',
  );
  await assertNoFormalMutation('Match icon replacement flow');
  return {
    background: {
      initialId: sample.background.id,
      replacementId: alternatives.background.id,
      cancelledAndRepeated: true,
    },
    character: {
      initialId: sample.character.id,
      replacementId: alternatives.character.id,
      cancelledAndRepeated: true,
    },
    preview: {
      active: preview.active,
      readOnly: preview.readOnly,
      status: preview.status,
      layerIds: preview.layers.map((layer) => layer.source),
    },
    formalProjectAndHistoryUnchanged: true,
    screenshots: screenshotPaths,
  };
}

async function selectCharacterLayer(window, expectedLayerId) {
  await waitForDom(
    window,
    `(() => {
      const canvas = document.querySelector('.project-canvas');
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const incomplete = JSON.parse(stage?.dataset.incompleteVisualLayerIds || '[]');
      return Boolean(canvas && canvas.dataset.scenePreview !== 'true' && stage && !incomplete.includes(${JSON.stringify(expectedLayerId)}));
    })()`,
    'The Character visual did not finish loading on the production canvas before selection.',
    12_000,
  );
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
  window.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y });
  await delay(30);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: target.x,
    y: target.y,
  });
  await delay(40);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: target.x,
    y: target.y,
  });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId === ${JSON.stringify(expectedLayerId)}`,
    'The Character layer could not be selected through the production canvas.',
    4_000,
  ).catch(async (error) => {
    let diagnostic;
    try {
      diagnostic = await window.webContents.executeJavaScript(`(() => {
        const stage = document.querySelector('[data-testid="project-canvas-stage"]');
        const logicalStage = document.querySelector('[data-testid="canvas-logical-stage"]');
        const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
        const canvas = document.querySelector('.project-canvas');
        const rect = logicalStage?.getBoundingClientRect();
        const hitStack = document.elementsFromPoint(${target.x}, ${target.y}).slice(0, 6).map((node) => ({
          tag: node.tagName,
          className: typeof node.className === 'string' ? node.className : '',
          testId: node.getAttribute('data-testid'),
          pointerEvents: getComputedStyle(node).pointerEvents,
        }));
        return {
          target: ${JSON.stringify(target)},
          activeElement: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
          hitStack,
          preview: canvas ? {
            mode: canvas.dataset.scenePreview,
            status: canvas.dataset.scenePreviewStatus,
          } : null,
          stage: stage ? {
            selectedLayerId: stage.dataset.selectedLayerId,
            previewReadOnly: stage.dataset.scenePreviewReadOnly,
            directCanvasEditing: stage.dataset.directCanvasEditing,
            interactionStatus: stage.dataset.interactionStatus,
            incompleteVisualLayerIds: stage.dataset.incompleteVisualLayerIds,
            renderedAssetIds: stage.dataset.renderedAssetIds,
            displayScale: viewport?.dataset.displayScale,
            temporalInspection: stage.dataset.temporalInspection,
            logicalStageRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
            canvasRects: [...stage.querySelectorAll('canvas')].map((node) => {
              const bounds = node.getBoundingClientRect();
              return { className: node.className, width: node.width, height: node.height, left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
            }),
          } : null,
        };
      })()`);
    } catch (diagnosticError) {
      diagnostic = { error: String(diagnosticError) };
    }
    console.error('[issue854] Character selection diagnostic', diagnostic);
    throw new Error(`${error.message} diagnostic=${JSON.stringify(diagnostic)}`);
  });
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

async function toggleLayerFlipInInspector(window, layerId) {
  const activeRightActivity = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="right-workspace"]')?.dataset.activeActivity ?? null`,
  );
  if (activeRightActivity !== 'properties') {
    await clickWithMouseInput(window, '[data-testid="right-activity-rail-properties"]');
  }
  await waitForDom(
    window,
    `document.querySelector('[data-testid="right-workspace"]')?.dataset.activeActivity === 'properties'`,
    'The Properties workspace did not open.',
  );
  await waitForDom(
    window,
    `(() => {
      const panel = document.querySelector('[data-testid="layer-transform-panel"]');
      const inputs = [...(panel?.querySelectorAll('form input:not([type="checkbox"])') ?? [])];
      return panel?.dataset.selectedLayerId === ${JSON.stringify(layerId)} &&
        document.querySelector('[data-testid="layer-transform-x"]')?.disabled === false &&
        inputs.length > 0 &&
        inputs.every((input) => input.value.trim().length > 0);
    })()`,
    'The selected Inspector layer did not finish initializing its transform draft.',
  );
  const beforeSubmit = await window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const flip = document.querySelector('[data-testid="layer-transform-panel"] .layer-transform-toggle-action');
    if (!stage || !(flip instanceof HTMLButtonElement) || flip.disabled) {
      throw new Error('The Inspector flip action is unavailable.');
    }
    const pressed = flip.getAttribute('aria-pressed');
    if (pressed !== 'true' && pressed !== 'false') {
      throw new Error('The Inspector flip action has no accessible pressed state.');
    }
    return { revision: Number(stage.dataset.projectRevision), flipX: pressed === 'true' };
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    const flip = document.querySelector('[data-testid="layer-transform-panel"] .layer-transform-toggle-action');
    if (!(flip instanceof HTMLButtonElement) || flip.disabled) {
      throw new Error('The Inspector flip action became unavailable.');
    }
    flip.click();
  })()`);
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision) === ${beforeSubmit.revision + 1} && document.querySelector('[data-testid="layer-transform-panel"] .layer-transform-toggle-action')?.getAttribute('aria-pressed') === ${JSON.stringify(String(!beforeSubmit.flipX))}`,
    'The formal Inspector flip did not commit one Project revision.',
  ).catch(async (error) => {
    const diagnostic = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const canvas = document.querySelector('.project-canvas');
      const flip = document.querySelector('[data-testid="layer-transform-panel"] .layer-transform-toggle-action');
      const panel = document.querySelector('[data-testid="layer-transform-panel"]');
      const history = document.querySelector('[data-testid="history-controls"]');
      return {
        revision: stage?.dataset.projectRevision ?? null,
        scenePreview: canvas?.dataset.scenePreview ?? null,
        scenePreviewStatus: canvas?.dataset.scenePreviewStatus ?? null,
        selectedLayerId: stage?.dataset.selectedLayerId ?? null,
        inspectorLayerId: panel?.dataset.selectedLayerId ?? null,
        flipPressed: flip?.getAttribute('aria-pressed') ?? null,
        flipDisabled: flip?.disabled ?? null,
        transformStatus: panel?.querySelector('[data-testid="layer-transform-status"]')?.textContent?.trim() ?? null,
        history: history ? { undoCount: history.dataset.undoCount, redoCount: history.dataset.redoCount } : null,
        saveState: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState ?? null,
      };
    })()`);
    const diagnosticScreenshot = await capture(window, 'rf04-stale-preview-flip-failure.png');
    throw new Error(
      `${error.message} before=${JSON.stringify(beforeSubmit)} state=${JSON.stringify(diagnostic)} screenshot=${diagnosticScreenshot}`,
      { cause: error },
    );
  });
  return { flipXBefore: beforeSubmit.flipX, flipXAfter: !beforeSubmit.flipX };
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
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-background-match"]') && document.querySelector('[data-testid="scene-creation-character-match"]')`,
    'The exact-name real background and composite Character did not auto-match.',
  );
  try {
    await waitForDom(
      window,
      `document.querySelector('.project-canvas')?.dataset.scenePreview === 'true' && document.querySelector('.project-canvas')?.dataset.scenePreviewStatus === 'ready' && document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.scenePreviewReadOnly === 'true' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === false`,
      'The real background and full composite Character did not render in the main Canvas.',
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
      canvas: (() => {
        const canvas = document.querySelector('.project-canvas');
        const stage = document.querySelector('[data-testid="project-canvas-stage"]');
        return {
          active: canvas?.dataset.scenePreview === 'true',
          status: canvas?.dataset.scenePreviewStatus ?? null,
          shotId: canvas?.dataset.scenePreviewShotId ?? null,
          readOnly: stage?.dataset.scenePreviewReadOnly === 'true',
          selectedLayerId: stage?.dataset.selectedLayerId ?? null,
          incompleteVisualLayerIds: stage?.dataset.incompleteVisualLayerIds ?? null,
          renderedAssetIds: stage?.dataset.renderedAssetIds ?? null,
        };
      })(),
      confirmDisabled: document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled ?? null,
      candidates: [...document.querySelectorAll('[data-testid="scene-creation-background-match"], [data-testid="scene-creation-character-match"], [data-testid="scene-creation-background-candidate"], [data-testid="scene-creation-character-candidate"]')].map((button) => ({
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
    const thumbnailReadSummary = thumbnailReads.map((response, index) => ({
      assetId: probeAssets[index]?.id ?? null,
      ok: response.ok,
      status: response.status,
      error: response.error ?? null,
      dataUrlLength: response.dataUrl?.length ?? null,
    }));
    await capture(window, 'candidate-thumbnail-read-failure.png');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} UI=${JSON.stringify(diagnostics)} THUMBNAIL_READS=${JSON.stringify(thumbnailReadSummary)}`,
      { cause: error },
    );
  }
}

async function prepareRealPreview(window, sample, shotName = sample.shotName) {
  await inspectRealSample(window, sample, shotName);
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

async function pasteSceneInput(window, input) {
  const previousClipboard = captureClipboardState();
  let screenshot;
  let flowError;
  try {
    clipboard.writeText(input);
    assert(
      normalizeClipboardText(clipboard.readText()) === normalizeClipboardText(input),
      'The system clipboard did not accept the structured scene text.',
    );
    await window.webContents.executeJavaScript(`(() => {
      const textarea = document.querySelector('[data-testid="scene-creation-input"]');
      if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error('Structured scene input did not render before paste.');
      }
      textarea.focus();
    })()`);
    await delay(100);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
    await waitForDom(
      window,
      `(() => { const value = document.querySelector('[data-testid="scene-creation-input"]')?.value; return typeof value === 'string' && value.split(String.fromCharCode(13)).join('') === ${JSON.stringify(input)}; })()`,
      'Windows Ctrl+V did not paste the structured scene text into the production input.',
    );
    const inputState = await window.webContents.executeJavaScript(`(() => {
      const textarea = document.querySelector('[data-testid="scene-creation-input"]');
      return {
        value: textarea?.value ?? null,
        focused: document.activeElement === textarea,
      };
    })()`);
    assert(
      typeof inputState.value === 'string' &&
        inputState.value.split(String.fromCharCode(13)).join('') === input &&
        inputState.focused,
      `The pasted structured text or focus changed: ${JSON.stringify(inputState)}.`,
    );
    assert(
      normalizeClipboardText(clipboard.readText()) === normalizeClipboardText(input),
      'The paste operation changed the system clipboard contents.',
    );
    screenshot = await capture(window, 'clipboard-pasted-scene-input.png');
  } catch (error) {
    flowError = error;
  }
  const clipboardRestore = restoreClipboardState(previousClipboard);
  if (flowError) throw flowError;
  assert(clipboardRestore.textRestored, 'The verifier could not restore the prior system clipboard text.');
  return {
    operatingSystemCtrlV: true,
    pastedTextPreserved: true,
    inputFocused: true,
    previousClipboardTextRestored: clipboardRestore.textRestored,
    previousClipboardFormatsRestored: clipboardRestore.formatsRestored,
    screenshot,
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
  await selectCharacterLayer(window, characterLayer.id);
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
      previewState.undoCount === beforeProjectEdit.undoCount &&
      previewState.redoCount === beforeProjectEdit.redoCount &&
      previewState.saveState === beforeProjectEdit.saveState,
    `Preparing the main-Canvas preview changed the Project or History: ${JSON.stringify({
      before: {
        revision: beforeProjectEdit.revision,
        shotCount: beforeProjectEdit.shotCount,
        undoCount: beforeProjectEdit.undoCount,
        redoCount: beforeProjectEdit.redoCount,
        saveState: beforeProjectEdit.saveState,
      },
      after: {
        revision: previewState.revision,
        undoCount: previewState.undoCount,
        redoCount: previewState.redoCount,
        saveState: previewState.saveState,
        character: previewState.character,
      },
    })}`,
  );
  const previewScreenshot = await capture(window, 'rf04-stale-preview-before-edit.png');

  const inspectorEdit = await toggleLayerFlipInInspector(window, characterLayer.id);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"] .scene-creation-stale')?.textContent?.includes('工程已变化') && document.querySelector('.project-canvas')?.dataset.scenePreview !== 'true' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === true`,
    'A formal Inspector edit did not invalidate the stale main-Canvas preview.',
  ).catch(async (error) => {
    const diagnostic = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const canvas = document.querySelector('.project-canvas');
      const scene = document.querySelector('[data-testid="scene-creation-panel"]');
      const transform = document.querySelector('[data-testid="layer-transform-panel"]');
      const xInput = document.querySelector('[data-testid="layer-transform-x"]');
      const history = document.querySelector('[data-testid="history-controls"]');
      return {
        revision: stage?.dataset.projectRevision ?? null,
        selectedLayerId: stage?.dataset.selectedLayerId ?? null,
        scenePreview: canvas?.dataset.scenePreview ?? null,
        scenePreviewStatus: canvas?.dataset.scenePreviewStatus ?? null,
        staleText: scene?.querySelector('.scene-creation-stale')?.textContent?.trim() ?? null,
        confirmDisabled: scene?.querySelector('[data-testid="scene-creation-confirm"]')?.disabled ?? null,
        rightActivity: document.querySelector('[data-testid="right-workspace"]')?.dataset.activeActivity ?? null,
        inspector: {
          selectedLayerId: transform?.dataset.selectedLayerId ?? null,
          xValue: xInput?.value ?? null,
          xDisabled: xInput?.disabled ?? null,
          status: transform?.querySelector('[role="status"]')?.textContent?.trim() ?? null,
        },
        history: history ? {
          undoCount: history.dataset.undoCount,
          redoCount: history.dataset.redoCount,
        } : null,
        saveState: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState ?? null,
      };
    })()`);
    const diagnosticScreenshot = await capture(window, 'rf04-stale-preview-invalidation-failure.png');
    throw new Error(
      `${error.message} state=${JSON.stringify(diagnostic)} screenshot=${diagnosticScreenshot}`,
      { cause: error },
    );
  });
  const afterProjectEdit = await readUiState(window, characterLayer.id);
  assert(
    afterProjectEdit.revision === beforeProjectEdit.revision + 1 &&
      afterProjectEdit.character?.flipX === inspectorEdit.flipXAfter &&
      afterProjectEdit.character?.flipX !== beforeProjectEdit.character?.flipX &&
      afterProjectEdit.saveState === 'dirty' &&
      afterProjectEdit.undoCount === beforeProjectEdit.undoCount + 1,
    `The formal canvas edit did not produce the expected single dirty History step: ${JSON.stringify({
      before: {
        revision: beforeProjectEdit.revision,
        shotCount: beforeProjectEdit.shotCount,
        characterFlipX: beforeProjectEdit.character?.flipX,
        saveState: beforeProjectEdit.saveState,
        undoCount: beforeProjectEdit.undoCount,
      },
      after: {
        revision: afterProjectEdit.revision,
        shotCount: afterProjectEdit.shotCount,
        characterFlipX: afterProjectEdit.character?.flipX,
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

  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"] .scene-creation-stale') === null && document.querySelector('[data-testid="scene-creation-background-match"]') && document.querySelector('[data-testid="scene-creation-character-match"]') && document.querySelector('.project-canvas')?.dataset.scenePreviewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === false`,
    'Automatic matching did not refresh the main Canvas after the Project revision changed.',
  );
  const afterRecovery = await readUiState(window, characterLayer.id);
  assert(
    afterRecovery.revision === afterProjectEdit.revision &&
      afterRecovery.undoCount === afterProjectEdit.undoCount &&
      afterRecovery.redoCount === afterProjectEdit.redoCount &&
      afterRecovery.saveState === afterProjectEdit.saveState,
    'Automatic rematching or preparing a replacement preview changed the Project or History.',
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
  const matchAlternatives = addMatchReplacementCandidates(sample);
  windowRef = await waitForMainWindow();
  windowRef.setSize(1600, 1050);
  windowRef.show();
  windowRef.focus();
  windowRef.webContents.focus();
  await openProject(windowRef, sample.targetProjectRoot);
  if (issue916Phase === 'B') {
    await openStructuredCreation(windowRef);
    const structuredInput = [
      `镜头：${sample.shotName}`,
      `背景：${sample.background.name}`,
      `出场：${sample.character.name}`,
    ].join('\n');
    await setSceneInput(windowRef, structuredInput);
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateId === ${JSON.stringify(sample.background.id)} && document.querySelector('[data-testid="scene-creation-character-match"]')?.dataset.candidateId === ${JSON.stringify(sample.character.id)}`,
      'Phase B did not automatically select the unique legal resources.',
    );
    const beforeReplacement = await readUiState(windowRef);
    assert(beforeReplacement.revision === 0, 'Phase B matching changed the Project revision.');
    await waitForDom(
      windowRef,
      `(() => {
        const images = [
          document.querySelector('[data-testid="scene-creation-background-match"] img'),
          document.querySelector('[data-testid="scene-creation-character-match"] img'),
        ];
        return images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
      })()`,
      'Phase B match thumbnails did not finish rendering before the screenshot.',
    );
    await windowRef.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const uniqueMatchScreenshot = await capture(
      windowRef,
      'issue916-phase-b-unique-match.png',
    );
    const matchIconInteractions = await verifySceneMatchIconInteractions(
      windowRef,
      sample,
      matchAlternatives,
      { requireMainCanvasPreview: false },
    );
    const afterReplacement = await readUiState(windowRef);
    assert(
      afterReplacement.revision === beforeReplacement.revision &&
        afterReplacement.shotCount === beforeReplacement.shotCount &&
        afterReplacement.undoCount === beforeReplacement.undoCount &&
        afterReplacement.redoCount === beforeReplacement.redoCount,
      'Phase B match selection changed the formal Project or History.',
    );
    return {
      issue: 916,
      phase: 'B',
      acceptance: 'ISSUE916_PHASE_B_AUTOMATCH_MATCH_REPLACEMENT_READ_ONLY',
      passed: true,
      codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      generatedAt: new Date().toISOString(),
      humanAcceptance: false,
      structuredInputEntered: true,
      matchIconInteractions,
      formalProjectAndHistoryUnchanged: true,
      screenshots: {
        uniqueMatch: uniqueMatchScreenshot,
        ...matchIconInteractions.screenshots,
      },
      receiptPath: '<isolated Phase B receipt>',
    };
  }
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
  const clipboardPaste = await pasteSceneInput(windowRef, structuredInput);
  console.log('[issue854] Windows Ctrl+V into the scene input passed.');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-background-match"]') && document.querySelector('[data-testid="scene-creation-character-match"]') && document.querySelector('.project-canvas')?.dataset.scenePreviewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === false`,
    'The exact-name resources did not auto-match and render in the main Canvas.',
  );
  const beforePreview = await readUiState(windowRef);
  assert(beforePreview.revision === 0, 'Candidate inspection changed the Project revision.');
  await capture(windowRef, 'scene-input-candidates.png');
  const canvasPreviewState = await windowRef.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.project-canvas');
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    return {
      active: canvas?.dataset.scenePreview === 'true',
      status: canvas?.dataset.scenePreviewStatus ?? null,
      previewShotId: canvas?.dataset.scenePreviewShotId ?? null,
      readOnly: stage?.dataset.scenePreviewReadOnly === 'true',
      directEditing: stage?.dataset.directCanvasEditing ?? null,
      renderedTime: Number(stage?.dataset.renderedTimeMs),
      timelineTime: Number(stage?.dataset.currentTimeMs),
      layers: JSON.parse(stage?.dataset.layerJson || '[]'),
    };
  })()`);
  assert(canvasPreviewState.active && canvasPreviewState.status === 'ready', 'The main Canvas does not show the automatic scene preview.');
  assert(canvasPreviewState.readOnly && canvasPreviewState.directEditing === 'false', 'The temporary scene Canvas is not read-only.');
  assert(canvasPreviewState.renderedTime === 0, 'The temporary scene Canvas is not rendered at the base shot time.');
  assert(canvasPreviewState.layers.length === 2, 'The temporary Canvas preview does not contain exactly the background and composite Character layers.');
  assert(canvasPreviewState.layers.some((layer) => layer.source?.kind === 'asset' && layer.source.assetId === sample.background.id), 'The main Canvas preview does not bind the selected background ID.');
  assert(canvasPreviewState.layers.some((layer) => layer.source?.kind === 'character' && layer.source.characterId === sample.character.id), 'The main Canvas preview does not bind the selected Character ID.');
  await capture(windowRef, 'read-only-preview.png');
  const matchIconInteractions = await verifySceneMatchIconInteractions(
    windowRef,
    sample,
    matchAlternatives,
  );
  const selectedBackgroundId = matchAlternatives.background.id;
  const selectedCharacterId = matchAlternatives.character.id;
  const replacedPreviewState = await readScenePreviewState(windowRef);
  assert(
    replacedPreviewState.layers.some((layer) =>
      layer.source?.kind === 'asset' && layer.source.assetId === selectedBackgroundId,
    ) && replacedPreviewState.layers.some((layer) =>
      layer.source?.kind === 'character' && layer.source.characterId === selectedCharacterId,
    ),
    'The replacement preview does not retain both explicitly chosen resource IDs.',
  );
  await capture(windowRef, 'read-only-preview-after-match-icon-replacement.png');
  const beforeConfirm = await readUiState(windowRef);
  assert(beforeConfirm.revision === 0, 'The prepared preview changed the Project revision.');
  await clickWithMouseInput(windowRef, '[data-testid="scene-creation-confirm"]');
  await waitForDom(
    windowRef,
    `!document.querySelector('[data-testid="scene-creation-panel"]') && document.querySelectorAll('.shot-list-item').length === ${sample.project.shots.length + 1} && document.querySelector('.shot-list-item-selected strong')?.textContent?.trim() === ${JSON.stringify(sample.shotName)}`,
    'Explicit confirmation did not create and select the new Shot.',
  );
  const created = await readUiState(windowRef);
  assert(created.revision === 1, 'Confirmation did not create exactly one Project revision.');
  assert(created.character, 'The new Shot does not expose its Character layer on the canvas.');
  assert(
    created.character.source?.kind === 'character' &&
      created.character.source.characterId === selectedCharacterId &&
      created.layers.some((layer) =>
        layer.source?.kind === 'asset' && layer.source.assetId === selectedBackgroundId,
      ),
    'Formal creation did not bind the two resources selected through the match icons.',
  );
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
  assert(reopened.imageIds.includes(selectedBackgroundId), 'The reopened canvas did not render the selected background Asset.');
  assert(
    reopened.character?.source?.kind === 'character' &&
      reopened.character.source.characterId === selectedCharacterId,
    'The reopened Shot did not retain the Character selected through its match icon.',
  );
  const bodyAssetId = matchAlternatives.character.bodyAssetId;
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

  const portraitPreviewShotName = `${sample.shotName} portrait preview`;
  const beforePortraitMatch = await readUiState(windowRef);
  const projectJsonPath = path.join(sample.targetProjectRoot, 'project.json');
  const projectHashBeforePortrait = createHash('sha256')
    .update(readFileSync(projectJsonPath))
    .digest('hex');
  await openStructuredCreation(windowRef);
  await setSceneInput(windowRef, [
    `镜头：${portraitPreviewShotName}`,
    `背景：${matchAlternatives.background.name}`,
    `出场：${matchAlternatives.character.name}`,
  ].join('\n'));
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateId === ${JSON.stringify(selectedBackgroundId)} && document.querySelector('[data-testid="scene-creation-character-match"]')?.dataset.candidateId === ${JSON.stringify(selectedCharacterId)} && document.querySelector('.project-canvas')?.dataset.scenePreviewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === false`,
    'The saved Project did not prepare the selected resources for the portrait match screenshot.',
  );
  windowRef.setSize(800, 1_100);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'portrait'`,
    'The narrow Cloud Touch window did not select the portrait layout for matched rows.',
  );
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateId === ${JSON.stringify(selectedBackgroundId)} && document.querySelector('[data-testid="scene-creation-character-match"]')?.dataset.candidateId === ${JSON.stringify(selectedCharacterId)} && document.querySelector('.project-canvas')?.dataset.scenePreviewStatus === 'ready' && document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled === false`,
    'The portrait layout did not retain the selected rows and read-only preview.',
  );
  const portraitBackgroundRow = await readSceneMatchRowState(windowRef, 'background');
  const portraitCharacterRow = await readSceneMatchRowState(windowRef, 'character');
  assert(
    portraitBackgroundRow.id === selectedBackgroundId &&
      portraitBackgroundRow.matched && portraitBackgroundRow.successCheck &&
      portraitBackgroundRow.status === null &&
      portraitBackgroundRow.actionWidth >= 44 && portraitBackgroundRow.actionHeight >= 44 &&
      portraitCharacterRow.id === selectedCharacterId &&
      portraitCharacterRow.matched && portraitCharacterRow.successCheck &&
      portraitCharacterRow.status === null &&
      portraitCharacterRow.actionWidth >= 44 && portraitCharacterRow.actionHeight >= 44,
    `The portrait match rows do not retain their compact success and replacement controls: ${JSON.stringify({ portraitBackgroundRow, portraitCharacterRow })}.`,
  );
  const portraitMatchScreenshot = await capture(
    windowRef,
    'cloud-touch-portrait-matched-preview.png',
  );
  const portraitPreviewState = await readScenePreviewState(windowRef);
  const afterPortraitMatch = await readUiState(windowRef);
  const projectHashAfterPortrait = createHash('sha256')
    .update(readFileSync(projectJsonPath))
    .digest('hex');
  assert(
    portraitPreviewState.active && portraitPreviewState.status === 'ready' &&
      portraitPreviewState.readOnly &&
      afterPortraitMatch.revision === beforePortraitMatch.revision &&
      afterPortraitMatch.undoCount === beforePortraitMatch.undoCount &&
      afterPortraitMatch.redoCount === beforePortraitMatch.redoCount &&
      projectHashAfterPortrait === projectHashBeforePortrait,
    'The portrait match screenshot state changed the Project, History, or read-only preview.',
  );

  return {
    issue: 854,
    reviewFixIssue: 858,
    acceptance: 'AC03_REAL_WINDOWS_ELECTRON_HAPPY_UNDO_REDO_REOPEN_EDIT',
    additionalAcceptance: 'ISSUE858_RF01_RF04_CURRENT_HEAD; RF02_COPY_UI_REMOVED_BY_ISSUE916',
    inputMethod: 'Windows Electron Ctrl+V from the system clipboard; native Electron mouse input drives canvas edits and scene confirmation.',
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
      clipboardPaste,
      stalePreview,
      doubleConfirm,
    },
    matchIconInteractions,
    project: {
      id: sample.project.id,
      root: '<isolated acceptance project>',
      sourceProjectJsonSha256: sample.sourceProjectHashBefore,
      backgroundAssetId: selectedBackgroundId,
      characterId: selectedCharacterId,
      originalBackgroundAssetId: sample.background.id,
      originalCharacterId: sample.character.id,
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
      renderedBackgroundAfterReopen: reopened.imageIds.includes(selectedBackgroundId),
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
      clipboardPaste: clipboardPaste.screenshot,
      portraitMatchedPreview: portraitMatchScreenshot,
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
      additionalAcceptance: 'ISSUE858_RF01_RF04_CURRENT_HEAD; RF02_COPY_UI_REMOVED_BY_ISSUE916',
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
