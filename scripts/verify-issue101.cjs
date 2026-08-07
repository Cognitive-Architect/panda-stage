const { mkdir, rm, writeFile } = require('node:fs/promises');
const { appendFileSync, mkdirSync, rmSync, unlinkSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\formal-background-cover';
const projectsRoot = path.join(acceptanceRoot, 'projects');
const assetsRoot = path.join(acceptanceRoot, 'assets');
const tracesRoot = path.join(acceptanceRoot, 'traces');
const logsRoot = path.join(acceptanceRoot, 'logs');
const electronUserDataRoot = path.join(
  acceptanceRoot,
  'electron-user-data',
);
const tempRoot = path.join(acceptanceRoot, 'temp');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/issue-101',
);
const progressLogPath = path.join(logsRoot, 'verify-issue101.log');
const temporaryDirectories = [];
const canvasSize = { width: 1920, height: 1080 };

rmSync(electronUserDataRoot, { recursive: true, force: true });
for (const directory of [
  projectsRoot,
  assetsRoot,
  tracesRoot,
  logsRoot,
  electronUserDataRoot,
  tempRoot,
]) {
  mkdirSync(directory, { recursive: true });
}
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
process.env.TMPDIR = tempRoot;

for (const [name, directory] of [
  ['temp', tempRoot],
  ['userData', electronUserDataRoot],
  ['sessionData', path.join(electronUserDataRoot, 'session-data')],
  ['logs', logsRoot],
  ['crashDumps', path.join(logsRoot, 'crash-dumps')],
]) {
  mkdirSync(directory, { recursive: true });
  try {
    app.setPath(name, directory);
  } catch {
    // Some Electron path keys are not available until the app is ready.
  }
}
app.commandLine.appendSwitch('enable-precise-memory-info');

try {
  unlinkSync(progressLogPath);
} catch {
  // No previous progress log is required.
}

if (!process.env.PANDA_STAGE_FFMPEG_PATH) {
  process.env.PANDA_STAGE_FFMPEG_PATH = path.join(
    repositoryRoot,
    'node_modules',
    '@ffmpeg-installer',
    'win32-x64',
    'ffmpeg.exe',
  );
}
if (!process.env.PANDA_STAGE_FFPROBE_PATH) {
  process.env.PANDA_STAGE_FFPROBE_PATH = path.join(
    repositoryRoot,
    'node_modules',
    '@ffprobe-installer',
    'win32-x64',
    'ffprobe.exe',
  );
}

const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { ProjectService } = require(
  '../dist-electron/main/services/ProjectService.js',
);

require('../dist-electron/main/index.js');
app.on('window-all-closed', () => {});

function progress(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(progressLogPath, line, 'utf8');
  console.log(line.trim());
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(left, right, epsilon = 0.00001) {
  return Math.abs(left - right) <= epsilon;
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
        // Renderer may be between state transitions; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  return window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
}

async function clickElement(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    element.click();
  })()`);
  await delay(180);
}

async function requestCloseProject(window) {
  await clickElement(window, '[data-testid="compact-project-more"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="compact-project-menu"]'))`,
    'Compact project menu did not open.',
  );
  await clickElement(window, '[data-testid="menu-close-project"]');
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
    ).set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(80);
}

async function setCheckbox(window, selector, checked) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') {
      throw new Error('Checkbox not found: ' + ${JSON.stringify(selector)});
    }
    if (input.checked !== ${checked ? 'true' : 'false'}) input.click();
  })()`);
  await delay(220);
}

async function setTransformInput(window, index, value) {
  await window.webContents.executeJavaScript(`(() => {
    const inputs = document.querySelectorAll(
      '[data-testid="layer-transform-panel"] form input[inputmode="decimal"]',
    );
    const input = inputs[${index}];
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Transform input not found: ' + ${index});
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(80);
}

async function waitForEditorWindow() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (candidate.isDestroyed() || candidate.webContents.isLoading()) {
        continue;
      }
      const url = candidate.webContents.getURL();
      if (url && url.includes('hidden.html')) continue;
      try {
        const isEditor = await Promise.race([
          candidate.webContents.executeJavaScript(
            "Boolean(document.querySelector('.recovery-open-row input'))",
          ),
          delay(1_000).then(() => false),
        ]);
        if (isEditor) return candidate;
      } catch {
        // Keep polling while the window finishes loading.
      }
    }
    await delay(100);
  }
  throw new Error('Real Electron editor window did not become ready.');
}

async function openProject(window, projectRoot) {
  const projectCenterOpen = await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('.recovery-open-row input'))`,
  );
  if (!projectCenterOpen) {
    await clickElement(window, '[data-testid="open-project-center"]');
    await waitForDom(
      window,
      `Boolean(document.querySelector('.recovery-open-row input'))`,
      'Project Center did not open.',
    );
  }
  await setInput(window, '.recovery-open-row input', projectRoot);
  await clickElement(window, '.recovery-open-row button');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="active-project-path"] code')?.textContent === ${JSON.stringify(projectRoot)}`,
    `Project did not become active: ${projectRoot}`,
  );
  await delay(250);
}

async function selectShot(window, shotId) {
  await clickElement(window, `[data-shot-id="${shotId}"] button`);
  await waitForDom(
    window,
    `document.querySelector('.shot-editor')?.dataset.currentShotId === ${JSON.stringify(shotId)}`,
    `Shot did not become active: ${shotId}`,
  );
}

async function waitForAssets(window, ids) {
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const rendered = JSON.parse(stage?.dataset.renderedAssetIds || '[]');
      return ${JSON.stringify(ids)}.every((id) => rendered.includes(id));
    })()`,
    `Canvas did not load assets: ${ids.join(', ')}`,
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const inspector = document.querySelector('[data-testid="right-inspector"]');
    const background = document.querySelector('[data-testid="layer-background-control"]');
    const transform = document.querySelector('[data-testid="layer-transform-panel"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const layers = JSON.parse(stage?.dataset.layerJson || '[]');
    const backgroundLayerId = stage?.dataset.backgroundLayerId || '';
    const backgroundLayer = layers.find(
      (candidate) => candidate.id === backgroundLayerId,
    );
    const renderedAssetIntrinsicSizes = JSON.parse(
      stage?.dataset.renderedAssetIntrinsicSizes || '[]',
    );
    const backgroundIntrinsicSize = renderedAssetIntrinsicSizes.find(
      (entry) => entry.assetId === backgroundLayer?.source?.assetId,
    );
    return {
      layers,
      backgroundLayerId,
      backgroundLocked: stage?.dataset.backgroundLocked === 'true',
      selectedLayerId: stage?.dataset.selectedLayerId || '',
      activeShotId: document.querySelector('.shot-editor')?.dataset.currentShotId || '',
      inspectorState: inspector?.dataset.selectionState || '',
      backgroundControlState: background?.dataset.backgroundControlState || '',
      backgroundControlLayerId: background?.dataset.backgroundLayerId || '',
      backgroundReady: stage?.dataset.backgroundReady === 'true',
      backgroundWarning: Boolean(document.querySelector('[data-testid="canvas-background-warning"]')),
      stageError: document.querySelector('[data-testid="stage-error"]')?.textContent || null,
      backgroundRender: {
        x: Number(backgroundLayer?.x),
        y: Number(backgroundLayer?.y),
        width: Number(backgroundIntrinsicSize?.width),
        height: Number(backgroundIntrinsicSize?.height),
        offsetX: Number(backgroundIntrinsicSize?.width) / 2,
        offsetY: Number(backgroundIntrinsicSize?.height) / 2,
        scaleX: Number(stage?.dataset.backgroundScaleX),
        scaleY: Number(stage?.dataset.backgroundScaleY),
        policy: stage?.dataset.backgroundPolicy || null,
      },
      renderedAssetIntrinsicSizes,
      renderedAssetIds: JSON.parse(stage?.dataset.renderedAssetIds || '[]'),
      transformInputsDisabled: transform
        ? [...transform.querySelectorAll('input[inputmode="decimal"]')].every((input) => input.disabled)
        : null,
      fillButtonDisabled: document.querySelector('[data-testid="fill-current-shot-background"]')?.disabled ?? null,
      dirty: Boolean(document.querySelector('.editor-save-button:not([disabled])')),
      undoCount: Number(history?.dataset.undoCount || -1),
      redoCount: Number(history?.dataset.redoCount || -1),
    };
  })()`);
}

async function logicalClientPoint(window, point) {
  return window.webContents.executeJavaScript(`(() => {
    const projectCanvas = document.querySelector('.project-canvas');
    projectCanvas?.scrollIntoView({ block: 'center' });
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    const stage = document.querySelector('[data-testid="canvas-logical-stage"]');
    if (!viewport || !stage) throw new Error('Canvas point surface did not render.');
    viewport.scrollLeft = Math.max(0, ${point.x} - 500);
    viewport.scrollTop = Math.max(0, ${point.y} - 300);
    const rect = stage.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    return {
      x: Math.round(rect.left + ${point.x} * scale),
      y: Math.round(rect.top + ${point.y} * scale),
    };
  })()`);
}

async function clickLogicalPoint(window, point) {
  const client = await logicalClientPoint(window, point);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: client.x,
    y: client.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: client.x,
    y: client.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: client.x,
    y: client.y,
  });
  await delay(220);
}

async function selectLayer(window, layerId, point) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await clickLogicalPoint(window, point);
    const selected = await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId ?? ''`,
    );
    if (selected === layerId) return;
    await delay(180);
  }
  throw new Error(`Canvas did not select layer: ${layerId}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, data])),
    8 + data.length,
  );
  return output;
}

function createDetailedPng(width, height, variant) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    scanlines[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const grid = x % 64 < 2 || y % 64 < 2;
      scanlines[offset] = grid
        ? 255
        : (x * 13 + y * 7 + variant * 41) & 0xff;
      scanlines[offset + 1] = grid
        ? 255
        : (x * 3 + y * 19 + variant * 67) & 0xff;
      scanlines[offset + 2] = grid
        ? 255
        : (x * 23 + y * 5 + variant * 29) & 0xff;
      offset += 3;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function layerFor(assetId, name, id, x, y, zIndex, overrides = {}) {
  return {
    id,
    name,
    source: { kind: 'asset', assetId },
    anchor: 'center',
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex,
    ...overrides,
  };
}

function shotFor(id, name, layers, backgroundLayerId = null) {
  return {
    id,
    name,
    durationMs: 3_000,
    defaultSubtitleStyleId: null,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
    backgroundLayerId,
    layers,
  };
}

async function createFixture(root, label, includeOldProject) {
  await rm(root, { recursive: true, force: true });
  const projectService = new ProjectService();
  const created = await projectService.create(root, {
    name: `Issue 101 ${label}`,
  });
  const assetDirectory = path.join(root, 'assets');
  await mkdir(assetDirectory, { recursive: true });
  const specs = [
    { key: 'sixteenNine', name: '16:9 landscape', width: 1920, height: 1080, variant: 1 },
    { key: 'wide', name: 'non-16:9 landscape', width: 1600, height: 1000, variant: 2 },
    { key: 'portrait', name: 'portrait', width: 800, height: 1200, variant: 3 },
    { key: 'square', name: 'square', width: 1000, height: 1000, variant: 4 },
  ];
  const assets = [];
  const paths = {};
  for (const spec of specs) {
    const bytes = createDetailedPng(spec.width, spec.height, spec.variant);
    const filePath = path.join(assetDirectory, `${spec.key}.png`);
    await writeFile(filePath, bytes);
    const asset = {
      id: randomUUID(),
      kind: 'image',
      name: spec.name,
      relativePath: `assets/${spec.key}.png`,
      mimeType: 'image/png',
      width: spec.width,
      height: spec.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    assets.push(asset);
    paths[spec.key] = filePath;
  }
  const layers = {
    sixteenNine: layerFor(
      assets[0].id,
      '16:9 background candidate',
      randomUUID(),
      960,
      540,
      0,
    ),
    wide: layerFor(
      assets[1].id,
      'Wide replacement candidate',
      randomUUID(),
      1_500,
      700,
      1,
      { scaleX: 0.48, scaleY: 0.48 },
    ),
    wideStandalone: layerFor(
      assets[1].id,
      'Wide standalone candidate',
      randomUUID(),
      960,
      540,
      0,
    ),
    portrait: layerFor(
      assets[2].id,
      'Portrait candidate',
      randomUUID(),
      960,
      540,
      0,
    ),
    square: layerFor(
      assets[3].id,
      'Square candidate',
      randomUUID(),
      960,
      540,
      0,
    ),
  };
  const shotSixteenNine = shotFor(
    randomUUID(),
    'T1 16:9',
    [layers.sixteenNine, layers.wide],
  );
  const shotWide = shotFor(
    randomUUID(),
    'T2 wide',
    [layers.wideStandalone],
  );
  const shotPortrait = shotFor(
    randomUUID(),
    'T3 portrait',
    [layers.portrait],
  );
  const shotSquare = shotFor(
    randomUUID(),
    'T4 square',
    [layers.square],
  );
  const oldLayer = layerFor(
    assets[1].id,
    'Legacy background geometry',
    randomUUID(),
    260,
    180,
    0,
    {
      scaleX: 0.42,
      scaleY: 0.42,
      rotationDeg: 19,
      opacity: 0.8,
      locked: true,
    },
  );
  const shotOld = shotFor(
    randomUUID(),
    'T9 legacy fill',
    [oldLayer],
    oldLayer.id,
  );
  const project = ProjectSchema.parse({
    ...created.project,
    assets,
    shots: [
      shotSixteenNine,
      shotWide,
      shotPortrait,
      shotSquare,
      ...(includeOldProject ? [shotOld] : []),
    ].map((shot) => ({
      ...shot,
      defaultSubtitleStyleId: created.project.subtitleStyles[0].id,
    })),
  });
  await projectService.save(root, project, 1);
  return {
    root,
    assets,
    paths,
    shots: {
      sixteenNine: shotSixteenNine,
      wide: shotWide,
      portrait: shotPortrait,
      square: shotSquare,
      old: shotOld,
    },
    layers,
    oldLayer,
  };
}

function expectedCoverScale(asset) {
  return Math.max(
    canvasSize.width / asset.width,
    canvasSize.height / asset.height,
  );
}

function assertCover(snapshotValue, asset, label) {
  const layer = snapshotValue.layers.find(
    (candidate) => candidate.id === snapshotValue.backgroundLayerId,
  );
  assert(layer, `${label}: background layer is missing.`);
  const scale = expectedCoverScale(asset);
  assert(
    near(layer.x, 960) && near(layer.y, 540),
    `${label}: Cover center was not persisted.`,
  );
  assert(
    near(layer.scaleX, scale) && near(layer.scaleY, scale),
    `${label}: expected scale ${scale}, received ${layer.scaleX}/${layer.scaleY}.`,
  );
  assert(
    layer.rotationDeg === 0 && layer.flipX === false,
    `${label}: Cover initialization retained a non-Cover transform.`,
  );
  const render = snapshotValue.backgroundRender;
  assert(
    render.width === asset.width &&
      render.height === asset.height &&
      near(render.offsetX, asset.width / 2) &&
      near(render.offsetY, asset.height / 2) &&
      near(Math.abs(render.scaleX), scale) &&
      near(render.scaleY, scale),
    `${label}: renderer did not use the persisted Cover geometry.`,
  );
  const left = render.x - render.offsetX * Math.abs(render.scaleX);
  const top = render.y - render.offsetY * Math.abs(render.scaleY);
  const right =
    render.x + (render.width - render.offsetX) * Math.abs(render.scaleX);
  const bottom =
    render.y + (render.height - render.offsetY) * Math.abs(render.scaleY);
  assert(
    left <= 0.00001 &&
      top <= 0.00001 &&
      right >= canvasSize.width - 0.00001 &&
      bottom >= canvasSize.height - 0.00001,
    `${label}: rendered bounds do not cover the logical canvas.`,
  );
  assert(
    snapshotValue.renderedAssetIntrinsicSizes.some(
      (entry) =>
        entry.assetId === asset.id &&
        entry.width === asset.width &&
        entry.height === asset.height,
    ),
    `${label}: canvas did not use the original-resolution asset.`,
  );
}

async function run(window, fixture, projectB) {
  const result = { checks: [], snapshots: {}, disk: { acceptanceRoot } };
  await openProject(window, fixture.root);

  await selectShot(window, fixture.shots.sixteenNine.id);
  await waitForAssets(window, [fixture.assets[0].id, fixture.assets[1].id]);
  const originalSixteenNine = await snapshot(window);
  await selectLayer(window, fixture.layers.sixteenNine.id, { x: 960, y: 540 });
  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixture.layers.sixteenNine.id)}`,
    'T1 did not bind the 16:9 background.',
  );
  const sixteenNine = await snapshot(window);
  assertCover(sixteenNine, fixture.assets[0], 'T1 16:9');
  result.snapshots.sixteenNine = sixteenNine;
  result.checks.push('T1 16:9 initial background covers 1920x1080');
  assert(
    sixteenNine.renderedAssetIds.includes(fixture.assets[0].id),
    'T5 original asset was not rendered for the 16:9 background.',
  );
  result.checks.push('T5 original-resolution canvas source retained');

  await clickLogicalPoint(window, { x: 90, y: 90 });
  const unselected = await snapshot(window);
  await clickElement(window, '[data-testid="select-current-shot-background"]');
  const selected = await snapshot(window);
  assert(
    JSON.stringify(unselected.backgroundRender) ===
      JSON.stringify(selected.backgroundRender),
    'T10 selecting the background changed render geometry.',
  );
  result.checks.push('T10 selection preserves Cover render geometry');

  await clickElement(window, '[data-testid="history-controls"] button:first-child');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ''`,
    'T6 undo did not restore the ordinary layer.',
  );
  const undoneBind = await snapshot(window);
  assert(
    undoneBind.layers.find((layer) => layer.id === fixture.layers.sixteenNine.id)?.scaleX ===
      originalSixteenNine.layers.find((layer) => layer.id === fixture.layers.sixteenNine.id)?.scaleX,
    'T6 undo did not restore the original layer geometry.',
  );
  await clickElement(window, '[data-testid="history-controls"] button:nth-child(2)');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixture.layers.sixteenNine.id)}`,
    'T6 redo did not restore the formal background.',
  );
  assertCover(await snapshot(window), fixture.assets[0], 'T6 redo');
  result.checks.push('T6 set-background Undo/Redo restores ordinary and Cover geometry');

  await selectLayer(window, fixture.layers.wide.id, { x: 1_500, y: 700 });
  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixture.layers.wide.id)}`,
    'T7 replacement background did not bind.',
  );
  const replaced = await snapshot(window);
  assertCover(replaced, fixture.assets[1], 'T7 replacement');
  result.snapshots.replaced = replaced;
  result.checks.push('T7 replacement background reinitializes Cover geometry');

  await clickElement(window, '[data-testid="select-current-shot-background"]');
  await setCheckbox(
    window,
    '[data-testid="layer-transform-panel"] input[type="checkbox"]',
    false,
  );
  for (const [index, value] of [810, 450, 1.25, 27, 0.65].entries()) {
    await setTransformInput(window, index, value);
  }
  await clickElement(
    window,
    '[data-testid="layer-transform-panel"] button[type="submit"]',
  );
  const edited = await snapshot(window);
  const editedLayer = edited.layers.find(
    (layer) => layer.id === fixture.layers.wide.id,
  );
  assert(
    editedLayer &&
      near(editedLayer.x, 810) &&
      near(editedLayer.y, 450) &&
      near(editedLayer.scaleX, 1.25) &&
      editedLayer.rotationDeg === 27 &&
      near(editedLayer.opacity, 0.65),
    'T8 manual background adjustment did not commit.',
  );
  await clickElement(window, '.editor-save-button');
  await waitForDom(
    window,
    `Boolean(document.querySelector('.editor-save-button')?.disabled) && Boolean(document.querySelector('.clean-state'))`,
    'T8 manual background project did not save.',
  );
  await requestCloseProject(window);
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`,
    'T8 close confirmation did not render.',
  );
  await clickElement(window, '[data-testid="close-confirm-discard"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="start-screen"]'))`,
    'T8 project did not close.',
  );
  await openProject(window, fixture.root);
  await selectShot(window, fixture.shots.sixteenNine.id);
  await waitForAssets(window, [fixture.assets[0].id, fixture.assets[1].id]);
  const reopened = await snapshot(window);
  const reopenedLayer = reopened.layers.find(
    (layer) => layer.id === fixture.layers.wide.id,
  );
  assert(
    reopened.backgroundLayerId === fixture.layers.wide.id &&
      reopenedLayer &&
      near(reopenedLayer.x, 810) &&
      near(reopenedLayer.y, 450) &&
      near(reopenedLayer.scaleX, 1.25) &&
      reopenedLayer.rotationDeg === 27 &&
      near(reopenedLayer.opacity, 0.65),
    'T8 reopen silently re-applied Cover instead of preserving manual geometry.',
  );
  result.snapshots.reopenedManual = reopened;
  result.checks.push('T8 manual background geometry survives save/reopen');

  const typeCases = [
    ['wide', fixture.shots.wide, fixture.assets[1], fixture.layers.wideStandalone, { x: 960, y: 540 }],
    ['portrait', fixture.shots.portrait, fixture.assets[2], fixture.layers.portrait, { x: 960, y: 540 }],
    ['square', fixture.shots.square, fixture.assets[3], fixture.layers.square, { x: 960, y: 540 }],
  ];
  for (const [label, shot, asset, layer, point] of typeCases) {
    await selectShot(window, shot.id);
    await waitForAssets(window, [asset.id]);
    await selectLayer(window, layer.id, point);
    await clickElement(window, '[data-testid="set-current-shot-background"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(layer.id)}`,
      `${label} background did not bind.`,
    );
    const typed = await snapshot(window);
    assertCover(typed, asset, `T${label}`);
    result.snapshots[label] = typed;
    result.checks.push(
      `T${label === 'wide' ? 2 : label === 'portrait' ? 3 : 4} ${label} Cover geometry covers the canvas`,
    );
    await clickElement(window, '[data-testid="history-controls"] button:first-child');
  }

  await selectShot(window, fixture.shots.old.id);
  await waitForAssets(window, [fixture.assets[1].id]);
  const legacyBefore = await snapshot(window);
  const legacyLayerBefore = legacyBefore.layers.find(
    (layer) => layer.id === fixture.oldLayer.id,
  );
  assert(
    legacyBefore.backgroundLayerId === fixture.oldLayer.id &&
      legacyLayerBefore &&
      near(legacyLayerBefore.x, 260) &&
      near(legacyLayerBefore.scaleX, 0.42),
    'T9 fixture did not preserve legacy background geometry before Fill canvas.',
  );
  await clickElement(window, '[data-testid="fill-current-shot-background"]');
  const legacyFilled = await snapshot(window);
  assertCover(legacyFilled, fixture.assets[1], 'T9 fill canvas');
  assert(
    legacyFilled.undoCount > legacyBefore.undoCount,
    'T9 Fill canvas did not enter History.',
  );
  await clickElement(window, '[data-testid="history-controls"] button:first-child');
  const legacyUndone = await snapshot(window);
  assert(
    near(
      legacyUndone.layers.find((layer) => layer.id === fixture.oldLayer.id).x,
      260,
    ),
    'T9 Undo did not restore legacy background geometry.',
  );
  await clickElement(window, '[data-testid="history-controls"] button:nth-child(2)');
  assertCover(await snapshot(window), fixture.assets[1], 'T9 redo fill canvas');
  result.checks.push('T9 Fill canvas repairs legacy background and supports Undo/Redo');

  await selectShot(window, fixture.shots.wide.id);
  await waitForAssets(window, [fixture.assets[1].id]);
  await selectLayer(window, fixture.layers.wideStandalone.id, { x: 960, y: 540 });
  await clickElement(window, '[data-testid="set-current-shot-background"]');
  const shotWide = await snapshot(window);
  assertCover(shotWide, fixture.assets[1], 'T11 shot B');
  await selectShot(window, fixture.shots.sixteenNine.id);
  const shotAAgain = await snapshot(window);
  assert(
    shotAAgain.backgroundLayerId === fixture.layers.wide.id &&
      shotAAgain.activeShotId === fixture.shots.sixteenNine.id,
    'T11 returning to shot A lost or mixed its background geometry.',
  );
  await selectShot(window, fixture.shots.wide.id);
  const shotBAgain = await snapshot(window);
  assert(
    shotBAgain.backgroundLayerId === fixture.layers.wideStandalone.id &&
      shotBAgain.activeShotId === fixture.shots.wide.id,
    'T11 returning to shot B mixed shot state.',
  );
  await clickElement(window, '.editor-save-button');
  await waitForDom(
    window,
    `Boolean(document.querySelector('.editor-save-button')?.disabled) && Boolean(document.querySelector('.clean-state'))`,
    'T11 project A did not save before project switching.',
  );
  await openProject(window, projectB.root);
  await selectShot(window, projectB.shot.id);
  await waitForAssets(window, [projectB.asset.id]);
  const projectBSnapshot = await snapshot(window);
  assert(
    projectBSnapshot.backgroundLayerId === projectB.layer.id &&
      projectBSnapshot.activeShotId === projectB.shot.id,
    'T11 project B inherited project A background identity.',
  );
  result.checks.push('T11 shot and project switching keeps background geometry isolated');

  await rm(fixture.paths.wide, { force: true });
  await openProject(window, fixture.root);
  await selectShot(window, fixture.shots.old.id);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'false' && Boolean(document.querySelector('[data-testid="canvas-background-warning"]'))`,
    'T12 missing background source did not produce a clear warning.',
  );
  const missing = await snapshot(window);
  assert(
    missing.stageError === null && missing.backgroundWarning,
    'T12 missing background source caused an opaque renderer failure.',
  );
  result.checks.push('T12 missing source stays structured without NaN/Infinity or renderer crash');
  await writeFile(fixture.paths.wide, createDetailedPng(1600, 1000, 2));

  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, 'canvas-cover.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  result.snapshots.legacyBefore = legacyBefore;
  result.snapshots.legacyFilled = legacyFilled;
  result.snapshots.finalMissingSource = missing;
  return result;
}

async function createProjectB() {
  const root = path.join(projectsRoot, 'issue101-project-b.pandastage');
  await rm(root, { recursive: true, force: true });
  const projectService = new ProjectService();
  const created = await projectService.create(root, {
    name: 'Issue 101 Project B',
  });
  const bytes = createDetailedPng(1000, 1000, 9);
  const assetPath = path.join(root, 'assets', 'project-b.png');
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, bytes);
  const asset = {
    id: randomUUID(),
    kind: 'image',
    name: 'Project B background',
    relativePath: 'assets/project-b.png',
    mimeType: 'image/png',
    width: 1000,
    height: 1000,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const layer = layerFor(
    asset.id,
    'Project B background',
    randomUUID(),
    960,
    540,
    0,
    { scaleX: 1.92, scaleY: 1.92, locked: true },
  );
  const shot = {
    ...shotFor(randomUUID(), 'Project B shot', [layer], layer.id),
    defaultSubtitleStyleId: created.project.subtitleStyles[0].id,
  };
  const project = ProjectSchema.parse({
    ...created.project,
    assets: [asset],
    shots: [shot],
  });
  await projectService.save(root, project, 1);
  return { root, asset, assetPath, layer, shot };
}

async function main() {
  progress('starting Issue 101 verifier');
  const output = {
    issue: 101,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    disk: {
      acceptanceRoot,
      projectsRoot,
      assetsRoot,
      tracesRoot,
      logsRoot,
      electronUserDataRoot,
      tempRoot,
    },
    error: null,
  };
  let window = null;
  let fixture;
  let projectB;
  try {
    fixture = await createFixture(
      path.join(projectsRoot, 'issue101-formal-background.pandastage'),
      'formal-background',
      true,
    );
    projectB = await createProjectB();
    progress('D-drive fixtures created');
    window = await waitForEditorWindow();
    progress('editor window ready');
    const result = await run(window, fixture, projectB);
    Object.assign(output, result, { passed: true });
    progress(`checks passed: ${result.checks.length}`);
    await writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error = error instanceof Error ? error.stack || error.message : String(error);
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    const exitCode = process.exitCode ?? 0;
    if (window && !window.isDestroyed()) window.close();
    app.quit();
    for (const directory of temporaryDirectories) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
    setTimeout(() => process.exit(exitCode), 1_000);
  }
}

void main();
