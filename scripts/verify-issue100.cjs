const { mkdir, rm, writeFile } = require('node:fs/promises');
const { appendFileSync, unlinkSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');

app.commandLine.appendSwitch('enable-precise-memory-info');

const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/issue-100',
);
const progressLogPath = path.join(
  os.tmpdir(),
  'panda-stage-issue100-progress.log',
);
const temporaryDirectories = [];
const imageWidth = 1_536;
const imageHeight = 864;

try {
  unlinkSync(progressLogPath);
} catch {
  // No previous progress log is required.
}

function progress(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(progressLogPath, line, 'utf8');
  console.log(line.trim());
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
  await delay(60);
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
  })()`);
  await delay(60);
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
  await setInput(window, '.recovery-open-row input', projectRoot);
  await clickElement(window, '.recovery-open-row button');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="active-project-path"] code')?.textContent === ${JSON.stringify(projectRoot)}`,
    `Project did not become active: ${projectRoot}`,
  );
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="project-canvas-stage"]'))`,
    `Canvas did not render for: ${projectRoot}`,
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const background = document.querySelector('[data-testid="layer-background-control"]');
    const inspector = document.querySelector('[data-testid="right-inspector"]');
    const transform = document.querySelector('[data-testid="layer-transform-panel"]');
    const order = document.querySelector('[data-testid="layer-order-controls"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const saveButton = document.querySelector('.editor-save-button');
    return {
      activeProjectRoot: document.querySelector('[data-testid="active-project-path"] code')?.textContent ?? null,
      activeShotId: document.querySelector('.shot-editor')?.dataset.currentShotId ?? null,
      layers: stage ? JSON.parse(stage.dataset.layerJson || '[]') : [],
      backgroundLayerId: stage?.dataset.backgroundLayerId ?? '',
      backgroundReady: stage?.dataset.backgroundReady === 'true',
      backgroundWarning: Boolean(document.querySelector('[data-testid="canvas-background-warning"]')),
      backgroundListening: stage?.dataset.backgroundListening === 'true',
      backgroundEditing: stage?.dataset.backgroundEditing === 'true',
      backgroundLocked: stage?.dataset.backgroundLocked === 'true',
      selectedLayerId: stage?.dataset.selectedLayerId ?? '',
      inspectorState: inspector?.dataset.selectionState ?? null,
      backgroundControlState: background?.dataset.backgroundControlState ?? null,
      backgroundControlLayerId: background?.dataset.backgroundLayerId ?? '',
      backgroundControlLocked: background?.dataset.backgroundLocked === 'true',
      transformInputsDisabled: transform ? [...transform.querySelectorAll('input[inputmode="decimal"]')].every((input) => input.disabled) : null,
      transformLockChecked: transform?.querySelector('input[type="checkbox"]')?.checked ?? null,
      transformBackgroundProtected: transform?.dataset.backgroundProtected === 'true',
      orderButtonsDisabled: order ? [...order.querySelectorAll('button')].every((button) => button.disabled) : null,
      orderBackgroundProtected: order?.dataset.backgroundProtected === 'true',
      renderedAssetIntrinsicSizes: stage ? JSON.parse(stage.dataset.renderedAssetIntrinsicSizes || '[]') : [],
      projectRevision: Number(stage?.dataset.projectRevision ?? -1),
      dirty: Boolean(saveButton && !saveButton.disabled),
      undoCount: Number(history?.dataset.undoCount ?? -1),
      redoCount: Number(history?.dataset.redoCount ?? -1),
      stageError: document.querySelector('[data-testid="stage-error"]')?.textContent ?? null,
    };
  })()`);
}

async function captureLogicalStage(window) {
  const rect = await window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="canvas-logical-stage"]');
    if (!stage) throw new Error('Logical canvas stage did not render.');
    const bounds = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(bounds.left)),
      y: Math.max(0, Math.floor(bounds.top)),
      width: Math.max(1, Math.ceil(bounds.width)),
      height: Math.max(1, Math.ceil(bounds.height)),
    };
  })()`);
  return {
    rect,
    png: (await window.webContents.capturePage(rect)).toPNG(),
  };
}

function compareStageCaptures(before, after) {
  const beforeImage = nativeImage.createFromBuffer(before.png);
  const afterImage = nativeImage.createFromBuffer(after.png);
  const beforeSize = beforeImage.getSize();
  const afterSize = afterImage.getSize();
  if (
    beforeSize.width !== afterSize.width ||
    beforeSize.height !== afterSize.height
  ) {
    return {
      sameSize: false,
      comparedPixels: 0,
      differentPixels: null,
      differenceRatio: 1,
      beforeSize,
      afterSize,
    };
  }

  const beforeBitmap = beforeImage.toBitmap();
  const afterBitmap = afterImage.toBitmap();
  const border = Math.min(
    24,
    Math.floor(beforeSize.width / 8),
    Math.floor(beforeSize.height / 8),
  );
  let comparedPixels = 0;
  let differentPixels = 0;
  for (let y = border; y < beforeSize.height - border; y += 1) {
    for (let x = border; x < beforeSize.width - border; x += 1) {
      const offset = (y * beforeSize.width + x) * 4;
      comparedPixels += 1;
      if (
        beforeBitmap[offset] !== afterBitmap[offset] ||
        beforeBitmap[offset + 1] !== afterBitmap[offset + 1] ||
        beforeBitmap[offset + 2] !== afterBitmap[offset + 2] ||
        beforeBitmap[offset + 3] !== afterBitmap[offset + 3]
      ) {
        differentPixels += 1;
      }
    }
  }
  return {
    sameSize: true,
    comparedPixels,
    differentPixels,
    differenceRatio: comparedPixels ? differentPixels / comparedPixels : 1,
    beforeSize,
    afterSize,
  };
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
  window.webContents.sendInputEvent({ type: 'mouseMove', x: client.x, y: client.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: client.x, y: client.y });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: client.x, y: client.y });
  await delay(220);
}

async function dragLogicalPoint(window, from, to) {
  const start = await logicalClientPoint(window, from);
  const end = await logicalClientPoint(window, to);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: start.x, y: start.y });
  await delay(80);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: end.x, y: end.y, movementX: end.x - start.x, movementY: end.y - start.y });
  await delay(80);
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: end.x, y: end.y });
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

async function selectShot(window, shotId) {
  await clickElement(window, `[data-shot-id="${shotId}"] button`);
  await waitForDom(
    window,
    `document.querySelector('.shot-editor')?.dataset.currentShotId === ${JSON.stringify(shotId)}`,
    `Shot did not become active: ${shotId}`,
  );
}

async function createFixture(parent, label) {
  const root = path.join(parent, `issue100-${label}.pandastage`);
  const projectService = new ProjectService();
  const created = await projectService.create(root, { name: `Issue 100 ${label}` });
  const assetDirectory = path.join(root, 'assets');
  await mkdir(assetDirectory, { recursive: true });

  const assetABytes = createDetailedPng(imageWidth, imageHeight, 1);
  const assetBBytes = createDetailedPng(imageWidth, imageHeight, 2);
  const assetAPath = path.join(assetDirectory, 'background-a.png');
  const assetBPath = path.join(assetDirectory, 'background-b.png');
  await writeFile(assetAPath, assetABytes);
  await writeFile(assetBPath, assetBBytes);
  const assetA = {
    id: randomUUID(),
    kind: 'image',
    name: `Background A ${label}`,
    relativePath: 'assets/background-a.png',
    mimeType: 'image/png',
    width: imageWidth,
    height: imageHeight,
    sha256: createHash('sha256').update(assetABytes).digest('hex'),
  };
  const assetB = {
    id: randomUUID(),
    kind: 'image',
    name: `Background B ${label}`,
    relativePath: 'assets/background-b.png',
    mimeType: 'image/png',
    width: imageWidth,
    height: imageHeight,
    sha256: createHash('sha256').update(assetBBytes).digest('hex'),
  };
  const layerA = {
    id: randomUUID(),
    name: `Layer A ${label}`,
    source: { kind: 'asset', assetId: assetA.id },
    anchor: 'center',
    x: 600,
    y: 400,
    scaleX: 0.72,
    scaleY: 0.72,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 0,
  };
  const layerB = {
    id: randomUUID(),
    name: `Layer B ${label}`,
    source: { kind: 'asset', assetId: assetB.id },
    anchor: 'center',
    x: 1_300,
    y: 650,
    scaleX: 0.48,
    scaleY: 0.48,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 1,
  };
  const shotA = {
    id: randomUUID(),
    name: 'Shot A',
    durationMs: 3_000,
    defaultSubtitleStyleId: created.project.subtitleStyles[0].id,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
    backgroundLayerId: null,
    layers: [layerA, layerB],
  };
  const shotB = {
    id: randomUUID(),
    name: 'Shot B',
    durationMs: 3_000,
    defaultSubtitleStyleId: created.project.subtitleStyles[0].id,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
    backgroundLayerId: null,
    layers: [
      { ...layerA, id: randomUUID(), name: 'Shot B A', x: 500, y: 300, zIndex: 0 },
      { ...layerB, id: randomUUID(), name: 'Shot B B', x: 1_400, y: 700, zIndex: 1 },
    ],
  };
  const project = ProjectSchema.parse({
    ...created.project,
    assets: [assetA, assetB],
    shots: [shotA, shotB],
  });
  await projectService.save(root, project, 1);
  return {
    root,
    projectFilePath: path.join(root, 'project.json'),
    assetA,
    assetB,
    assetAPath,
    assetBPath,
    shotA,
    shotB,
    layerA,
    layerB,
  };
}

async function run(window) {
  const result = { checks: [], snapshots: {} };
  const parent = await require('node:fs/promises').mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-issue100-'),
  );
  temporaryDirectories.push(parent);
  const fixtureA = await createFixture(parent, 'a');
  const fixtureB = await createFixture(parent, 'b');
  window.setSize(1_600, 1_000);

  await openProject(window, fixtureA.root);
  await waitForAssets(window, [fixtureA.assetA.id, fixtureA.assetB.id]);
  const initial = await snapshot(window);
  assert(initial.activeProjectRoot === fixtureA.root, 'Project A did not open.');
  assert(initial.backgroundLayerId === '', 'Fixture unexpectedly has a background.');
  assert(initial.renderedAssetIntrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Initial canvas did not use original high-resolution assets.');
  result.checks.push('T1/T17 initial original sources');

  await selectLayer(window, fixtureA.layerA.id, { x: 600, y: 400 });
  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixtureA.layerA.id)}`,
    'Setting an ordinary image as the formal background failed.',
  );
  const boundA = await snapshot(window);
  assert(boundA.backgroundLocked && boundA.inspectorState === 'background', 'Bound background was not selected and locked.');
  assert(boundA.orderButtonsDisabled && boundA.orderBackgroundProtected, 'Background order controls were not protected.');
  result.snapshots.boundA = boundA;
  result.checks.push('T1/T5/T11 bind, lock, and background order semantics');

  await selectLayer(window, fixtureA.layerB.id, { x: 1_300, y: 650 });
  await clickLogicalPoint(window, { x: 960, y: 540 });
  const protectedHit = await snapshot(window);
  assert(!protectedHit.backgroundListening && protectedHit.selectedLayerId === fixtureA.layerB.id, 'Locked background remained an ordinary canvas hit target.');
  result.checks.push('T2 default background hit protection');

  await clickLogicalPoint(window, { x: 1_800, y: 1_000 });
  const unselectedBackground = await snapshot(window);
  assert(unselectedBackground.selectedLayerId === '', 'Could not clear the ordinary layer selection before the background geometry check.');
  const beforeBackgroundSelection = await captureLogicalStage(window);
  await clickElement(window, '[data-testid="select-current-shot-background"]');
  const managedLocked = await snapshot(window);
  assert(managedLocked.selectedLayerId === fixtureA.layerA.id && managedLocked.inspectorState === 'background', 'Explicit background management entry did not select the formal background.');
  assert(managedLocked.transformInputsDisabled && managedLocked.transformLockChecked, 'Background management entry did not expose the locked state.');
  const afterBackgroundSelection = await captureLogicalStage(window);
  const backgroundSelectionPixels = compareStageCaptures(
    beforeBackgroundSelection,
    afterBackgroundSelection,
  );
  assert(
    backgroundSelectionPixels.sameSize &&
      backgroundSelectionPixels.differentPixels === 0,
    `Selecting the formal background changed its canvas pixels: ${JSON.stringify(backgroundSelectionPixels)}`,
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, 'background-before-selection.png'),
    beforeBackgroundSelection.png,
  );
  await writeFile(
    path.join(evidenceDirectory, 'background-after-selection.png'),
    afterBackgroundSelection.png,
  );
  result.snapshots.backgroundSelectionPixels = backgroundSelectionPixels;
  result.checks.push('T3/T4 explicit background management entry');
  result.checks.push('T2/T5-T8 selection preserves background pixels and geometry');

  const lockedBeforeDrag = managedLocked.layers.find((layer) => layer.id === fixtureA.layerA.id);
  await dragLogicalPoint(window, { x: 960, y: 540 }, { x: 1_100, y: 700 });
  const lockedAfterDrag = await snapshot(window);
  const lockedAfterLayer = lockedAfterDrag.layers.find((layer) => layer.id === fixtureA.layerA.id);
  assert(lockedAfterLayer.x === lockedBeforeDrag.x && lockedAfterLayer.y === lockedBeforeDrag.y, 'Locked background moved during a canvas drag.');
  result.checks.push('T6 locked drag protection');

  await setCheckbox(window, '[data-testid="layer-transform-panel"] input[type="checkbox"]', false);
  await waitForDom(window, `document.querySelector('[data-testid="layer-transform-panel"] input[type="checkbox"]')?.checked === false`, 'Background did not unlock through the inspector.');
  for (const [index, value] of [810, 450, 1.25, 27, 0.65].entries()) {
    await setTransformInput(window, index, value);
  }
  await clickElement(window, '[data-testid="layer-transform-panel"] form button[type="submit"]');
  await waitForDom(
    window,
    `(() => { const layer = JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(fixtureA.layerA.id)}); return layer?.x === 810 && layer?.y === 450 && layer?.scaleX === 1.25 && layer?.rotationDeg === 27 && layer?.opacity === 0.65; })()`,
    'Unlocked background transform did not commit.',
  );
  await clickElement(window, '[data-testid="layer-transform-panel"] form button[type="button"]');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(fixtureA.layerA.id)})?.flipX === true`,
    'Unlocked background flip did not commit.',
  );
  const editedBackground = await snapshot(window);
  assert(!editedBackground.transformInputsDisabled && editedBackground.backgroundLocked === false, 'Unlocked background controls stayed disabled.');
  result.snapshots.editedBackground = editedBackground;
  result.checks.push('T7 unlocked X/Y scale rotation flip opacity editing');

  await setCheckbox(window, '[data-testid="layer-transform-panel"] input[type="checkbox"]', true);
  const relocked = await snapshot(window);
  assert(relocked.backgroundLocked && relocked.transformInputsDisabled, 'Background did not re-lock after editing.');
  result.checks.push('T8 re-lock protection');

  await selectLayer(window, fixtureA.layerB.id, { x: 1_300, y: 650 });
  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixtureA.layerB.id)}`,
    'Replacing the formal background failed.',
  );
  const replaced = await snapshot(window);
  assert(replaced.backgroundLocked && replaced.layers.some((layer) => layer.id === fixtureA.layerA.id && layer.zIndex === 1), 'Replacement did not preserve the former background as content.');
  result.snapshots.replaced = replaced;
  result.checks.push('T9 replacement');

  await clickElement(window, '[data-testid="clear-current-shot-background"]');
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ''`, 'Cancelling formal background identity failed.');
  const cancelled = await snapshot(window);
  assert(cancelled.layers.some((layer) => layer.id === fixtureA.layerB.id) && cancelled.backgroundControlLayerId === '', 'Cancelling background identity deleted or lost the layer.');
  result.checks.push('T10 cancel identity keeps ordinary layer');

  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixtureA.layerB.id)}`, 'Rebinding the replacement background failed.');
  await clickElement(window, '[data-testid="history-controls"] button:first-child');
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ''`, 'Undo did not clear the background identity.');
  const undone = await snapshot(window);
  assert(undone.selectedLayerId === fixtureA.layerB.id && undone.inspectorState === 'selected', 'Undo left a stale or incorrect background selection.');
  await clickElement(window, '[data-testid="history-controls"] button:nth-child(2)');
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundLayerId === ${JSON.stringify(fixtureA.layerB.id)}`, 'Redo did not restore the background identity.');
  const redone = await snapshot(window);
  assert(redone.selectedLayerId === fixtureA.layerB.id && redone.inspectorState === 'background', 'Redo did not restore the explicit background selection.');
  result.checks.push('T12 undo/redo identity and selection consistency');

  await clickElement(window, '.editor-save-button');
  await waitForDom(window, `Boolean(document.querySelector('.editor-save-button')?.disabled) && Boolean(document.querySelector('.clean-state'))`, 'Project did not save cleanly.');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path.join(evidenceDirectory, 'canvas-a.png'), (await window.webContents.capturePage()).toPNG());
  await clickElement(window, '[data-testid="close-project-open"]');
  await waitForDom(window, `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`, 'Close confirmation did not render.');
  await clickElement(window, '[data-testid="close-confirm-discard"]');
  await waitForDom(window, `Boolean(document.querySelector('[data-testid="start-screen"]'))`, 'Project did not close to the start screen.');
  await openProject(window, fixtureA.root);
  await waitForAssets(window, [fixtureA.assetA.id, fixtureA.assetB.id]);
  const reopened = await snapshot(window);
  assert(reopened.backgroundLayerId === fixtureA.layerB.id && reopened.backgroundLocked, 'Save/reopen did not restore the formal background lock and identity.');
  assert(reopened.selectedLayerId === '', 'Save/reopen restored a stale selection.');
  await clickElement(window, '[data-testid="select-current-shot-background"]');
  const reopenedManaged = await snapshot(window);
  assert(reopenedManaged.inspectorState === 'background' && reopenedManaged.backgroundControlLayerId === fixtureA.layerB.id, 'The same background management entry did not work after reopen.');
  result.checks.push('T13 save/reopen');

  await selectShot(window, fixtureA.shotB.id);
  const shotB = await snapshot(window);
  assert(shotB.activeShotId === fixtureA.shotB.id && shotB.backgroundLayerId === '' && shotB.selectedLayerId === '', 'Shot switch leaked background or selection state.');
  await selectShot(window, fixtureA.shotA.id);
  const shotAAgain = await snapshot(window);
  assert(shotAAgain.backgroundLayerId === fixtureA.layerB.id && shotAAgain.selectedLayerId === '', 'Returning to shot A did not restore its own background without stale selection.');
  await openProject(window, fixtureB.root);
  await waitForAssets(window, [fixtureB.assetA.id, fixtureB.assetB.id]);
  const projectB = await snapshot(window);
  assert(projectB.activeProjectRoot === fixtureB.root && projectB.backgroundLayerId === '' && projectB.selectedLayerId === '', 'Project B inherited project A background or selection state.');
  await openProject(window, fixtureA.root);
  await waitForAssets(window, [fixtureA.assetA.id, fixtureA.assetB.id]);
  const projectAAgain = await snapshot(window);
  assert(projectAAgain.backgroundLayerId === fixtureA.layerB.id && projectAAgain.selectedLayerId === '', 'Project A did not restore its own background after project switching.');
  result.checks.push('T14 shot/project switching');

  await rm(fixtureA.assetBPath, { force: true });
  await openProject(window, fixtureB.root);
  await waitForAssets(window, [fixtureB.assetA.id, fixtureB.assetB.id]);
  await openProject(window, fixtureA.root);
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'false' && Boolean(document.querySelector('[data-testid="canvas-background-warning"]'))`, 'Missing background source did not produce a non-crashing warning.');
  const missing = await snapshot(window);
  assert(missing.stageError === null && missing.selectedLayerId === '', 'Missing background left a renderer error or stale selection.');
  result.checks.push('T15 missing source is structured and non-crashing');
  result.checks.push('T16 existing ordinary selection history contract covered by integration suite');
  result.checks.push('T18 existing Stage 3-A gates covered by full verification suite');
  result.snapshots.final = missing;

  return result;
}

async function main() {
  progress('starting Issue 100 verifier');
  const output = {
    issue: 100,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    error: null,
  };
  let window = null;
  try {
    window = await waitForEditorWindow();
    progress('editor window ready');
    const result = await run(window);
    Object.assign(output, result, { passed: true });
    progress(`checks passed: ${result.checks.length}`);
    await mkdir(evidenceDirectory, { recursive: true });
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
    for (const directory of temporaryDirectories) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
    if (window && !window.isDestroyed()) window.close();
    app.quit();
  }
}

void main();
