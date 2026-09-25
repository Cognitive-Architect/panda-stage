const { app, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const { deflateSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  detectSchemaVersion,
  migrateProject,
} = require('../dist-electron/domain/migrations/index.js');

// Focused S04 proof: the production Editor Canvas renders a composite
// Character as one complete visual, keeps Body/Face under one selection root,
// and retains a complete visual while a Mouth resource is pending.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue602-composite';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const userDataRoot = path.join(acceptanceRoot, 'electron-user-data');
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue602-composite.pandastage',
);
const resultPath = path.join(acceptanceRoot, 'results.json');
const exampleProject = require('../demo-project/project-v1.example.json');

const IDS = Object.freeze({
  project: 'a0200000-0000-4000-8000-000000000001',
  backgroundAsset: 'a0200000-0000-4000-8000-000000000002',
  bodyAsset: 'a0200000-0000-4000-8000-000000000003',
  faceNormalAsset: 'a0200000-0000-4000-8000-000000000004',
  faceAngryAsset: 'a0200000-0000-4000-8000-000000000005',
  mouthAsset: 'a0200000-0000-4000-8000-000000000006',
  audioAsset: 'a0200000-0000-4000-8000-000000000007',
  character: 'a0200000-0000-4000-8000-000000000008',
  expressionNormal: 'a0200000-0000-4000-8000-000000000009',
  expressionAngry: 'a0200000-0000-4000-8000-00000000000a',
  backgroundLayer: 'a0200000-0000-4000-8000-00000000000b',
  characterLayer: 'a0200000-0000-4000-8000-00000000000c',
  shot: 'a0200000-0000-4000-8000-00000000000d',
  dialogue: 'a0200000-0000-4000-8000-00000000000e',
  audioClip: 'a0200000-0000-4000-8000-00000000000f',
  subtitle: 'a0200000-0000-4000-8000-000000000010',
  voiceProfile: 'a0200000-0000-4000-8000-000000000011',
});

const COLORS = Object.freeze({
  background: [40, 48, 44],
  body: [220, 60, 60],
  faceNormal: [40, 120, 240],
  faceAngry: [40, 210, 120],
  mouth: [250, 180, 40],
});

const channels = [];
let savedProject = null;
let mouthMode = 'pending';
let releasePendingMouth = () => undefined;
let pendingMouthPromise = null;

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
      } catch {}
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

function hashFor(id) {
  return `${id.replace(/-/gu, '')}00000000000000000000000000000000`.slice(0, 64);
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

function pngChunk(type, bytes) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, bytes]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, payload, checksum]);
}

function solidPng(width, height, color) {
  const row = Buffer.alloc(width * 4 + 1);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = color[0];
    row[2 + x * 4] = color[1];
    row[3 + x * 4] = color[2];
    row[4 + x * 4] = 255;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageAsset(id, name, width, height) {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    sha256: hashFor(id),
  };
}

const COLORS_BY_ASSET = new Map([
  [IDS.backgroundAsset, COLORS.background],
  [IDS.bodyAsset, COLORS.body],
  [IDS.faceNormalAsset, COLORS.faceNormal],
  [IDS.faceAngryAsset, COLORS.faceAngry],
  [IDS.mouthAsset, COLORS.mouth],
]);

function createFixture() {
  const base = migrateProject({
    ...exampleProject,
    id: IDS.project,
    name: 'Issue 602 composite Canvas proof',
  });
  const baseShot = base.shots[0];
  const baseSubtitle = base.subtitleStyles[0];
  const imageAssets = [
    imageAsset(IDS.backgroundAsset, 'background', 1920, 1080),
    imageAsset(IDS.bodyAsset, 'body', 800, 1000),
    imageAsset(IDS.faceNormalAsset, 'face-normal', 200, 100),
    imageAsset(IDS.faceAngryAsset, 'face-angry', 300, 200),
    imageAsset(IDS.mouthAsset, 'mouth', 400, 300),
  ];
  const audioAsset = {
    id: IDS.audioAsset,
    kind: 'audio',
    name: 'proof voice',
    relativePath: 'assets/proof.wav',
    mimeType: 'audio/wav',
    durationMs: 1_000,
    sha256: hashFor(IDS.audioAsset),
  };
  const character = {
    ...base.characters[0],
    id: IDS.character,
    mode: 'composite',
    name: 'Proof Character',
    baseAssetId: IDS.faceNormalAsset,
    defaultVoiceProfileId: IDS.voiceProfile,
    expressions: [
      {
        id: IDS.expressionNormal,
        name: 'Normal face',
        assetId: IDS.faceNormalAsset,
      },
      {
        id: IDS.expressionAngry,
        name: 'Angry face',
        assetId: IDS.faceAngryAsset,
      },
    ],
    defaultExpressionId: IDS.expressionNormal,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.bodyAsset,
    facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
    mouthOpenAssetId: IDS.mouthAsset,
  };
  const shot = {
    ...baseShot,
    id: IDS.shot,
    name: 'Composite Canvas proof',
    durationMs: 2_000,
    backgroundLayerId: IDS.backgroundLayer,
    defaultSubtitleStyleId: IDS.subtitle,
    layers: [
      {
        ...baseShot.layers[0],
        id: IDS.backgroundLayer,
        name: 'Proof background',
        source: { kind: 'asset', assetId: IDS.backgroundAsset },
        x: 960,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 0,
        locked: true,
        flipX: false,
      },
      {
        ...baseShot.layers[1],
        id: IDS.characterLayer,
        name: 'Composite proof character',
        source: {
          kind: 'character',
          characterId: IDS.character,
          expressionId: IDS.expressionNormal,
        },
        x: 960,
        y: 540,
        scaleX: 0.5,
        scaleY: 0.5,
        rotationDeg: 0,
        opacity: 0.5,
        visible: true,
        zIndex: 1,
        locked: false,
        flipX: false,
      },
    ],
    dialogues: [
      {
        id: IDS.dialogue,
        characterId: IDS.character,
        voiceProfileId: IDS.voiceProfile,
        audioClipId: IDS.audioClip,
        subtitleStyleId: IDS.subtitle,
        startMs: 0,
        endMs: 1_000,
        text: 'Composite proof',
      },
    ],
    audioClips: [
      {
        id: IDS.audioClip,
        name: 'Proof dialogue',
        assetId: IDS.audioAsset,
        startMs: 0,
        endMs: 1_000,
        offsetMs: 0,
        volume: 1,
      },
    ],
    timelineEvents: [
      {
        id: 'a0200000-0000-4000-8000-000000000012',
        type: 'expression',
        layerId: IDS.characterLayer,
        startMs: 500,
        endMs: 500,
        expressionId: IDS.expressionAngry,
      },
    ],
  };

  return migrateProject({
    ...base,
    schemaVersion: 7,
    id: IDS.project,
    name: 'Issue 602 composite Canvas proof',
    assets: [...imageAssets, audioAsset],
    characters: [character],
    voiceProfiles: [
      {
        ...base.voiceProfiles[0],
        id: IDS.voiceProfile,
        characterId: IDS.character,
      },
    ],
    subtitleStyles: [
      {
        ...baseSubtitle,
        id: IDS.subtitle,
      },
    ],
    shots: [shot],
  });
}

function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: path.join(root, 'project.json'),
    project,
    migrated: false,
    sourceVersion: detectSchemaVersion(project),
  };
}

function configureMouthMode(mode) {
  mouthMode = mode;
  if (mode !== 'pending') {
    pendingMouthPromise = null;
    releasePendingMouth = () => undefined;
    return;
  }
  pendingMouthPromise = new Promise((resolve) => {
    releasePendingMouth = resolve;
  });
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  channels.push(channel);
}

function registerAcceptanceHandlers(project) {
  const assetBytes = new Map();
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
            message: 'Issue #602 fixture project was not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    savedProject = request.project;
    return { ok: true, value: documentFor(request.projectRoot, request.project) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, savedProject ?? project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_NOT_FOUND',
            message: 'Issue #602 fixture project was not found.',
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
    dataUrl: 'data:image/png;base64,',
  }));
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const asset = project.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #602 fixture image asset was not found.',
          assetId: request.assetId,
        },
      };
    }
    if (asset.id === IDS.mouthAsset && mouthMode === 'pending') {
      await pendingMouthPromise;
    }
    if (asset.id === IDS.mouthAsset && mouthMode === 'failed') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
          message: 'Synthetic Mouth decode failure for S04 fallback proof.',
          assetId: asset.id,
        },
      };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS_BY_ASSET.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
}

async function logicalPoint(window, x, y) {
  return window.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    if (!(viewport instanceof HTMLElement)) throw new Error('Canvas viewport missing.');
    const rect = viewport.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    const offsetX = Number(viewport.dataset.offsetX);
    const offsetY = Number(viewport.dataset.offsetY);
    return { x: Math.round(rect.left + offsetX + ${x} * scale), y: Math.round(rect.top + offsetY + ${y} * scale) };
  })()`);
}

async function clickLogical(window, x, y) {
  const point = await logicalPoint(window, x, y);
  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await delay(220);
}

async function dragLogical(window, fromX, fromY, toX, toY) {
  const from = await logicalPoint(window, fromX, fromY);
  const to = await logicalPoint(window, toX, toY);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: to.x, y: to.y });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await delay(260);
}

async function seekFraction(window, fraction) {
  await window.webContents.executeJavaScript(`(() => {
    if (!Element.prototype.__issue602CapturePatched) {
      Element.prototype.setPointerCapture = function () {};
      Element.prototype.releasePointerCapture = function () {};
      Element.prototype.hasPointerCapture = function () { return false; };
      Element.prototype.__issue602CapturePatched = true;
    }
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const dock = document.querySelector('[data-testid="timeline-dock"]');
    if (!(track instanceof HTMLElement) || !(dock instanceof HTMLElement)) throw new Error('Timeline ruler is not mounted.');
    const rect = track.getBoundingClientRect();
    const laneWidth = Number(dock.dataset.laneLabelWidth ?? 0);
    const durationWidth = Math.max(1, rect.width - laneWidth);
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + durationWidth * ${fraction},
      clientY: rect.top + rect.height / 2,
      pointerId: 602,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
    };
    track.dispatchEvent(new PointerEvent('pointerdown', init));
    track.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  })()`);
  await delay(260);
}

function readState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const parse = (value) => { try { return JSON.parse(value ?? 'null'); } catch { return null; } };
    const find = (layers) => Array.isArray(layers) ? layers.find((layer) => layer?.id === ${JSON.stringify(IDS.characterLayer)}) ?? null : null;
    return {
      currentTimeMs: Number(stage?.dataset.currentTimeMs ?? NaN),
      selectedLayerId: stage?.dataset.selectedLayerId ?? '',
      compositeLayerIds: parse(stage?.dataset.compositeLayerIds),
      incompleteVisualLayerIds: parse(stage?.dataset.incompleteVisualLayerIds),
      visualStatus: parse(stage?.dataset.visualStatusJson),
      targetReadyLayerIds: parse(stage?.dataset.targetReadyLayerIds),
      renderedAssetIds: parse(stage?.dataset.renderedAssetIds),
      evaluatedLayer: find(parse(stage?.dataset.evaluatedLayerJson)),
      baseLayer: find(parse(stage?.dataset.layerJson)),
      backgroundReady: stage?.dataset.backgroundReady === 'true',
      transformerVisible: stage?.dataset.transformerVisible === 'true',
    };
  })()`);
}

function readPixels(window, points) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const canvas = stage?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas backing surface missing.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context missing.');
    const scaleX = canvas.width / 1920;
    const scaleY = canvas.height / 1080;
    const sample = (x, y) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * scaleX)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * scaleY)));
      return [...context.getImageData(px, py, 1, 1).data];
    };
    return ${JSON.stringify(points)}.reduce((result, point) => {
      result[point.name] = sample(point.x, point.y);
      return result;
    }, {});
  })()`);
}

function findCanvasColor(window, point) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const canvas = stage?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const sx = canvas.width / 1920;
    const sy = canvas.height / 1080;
    for (let dx = -8; dx <= 8; dx += 1) {
      for (let dy = -8; dy <= 8; dy += 1) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.round((${point.x} + dx) * sx)));
        const y = Math.max(0, Math.min(canvas.height - 1, Math.round((${point.y} + dy) * sy)));
        const rgba = [...context.getImageData(x, y, 1, 1).data];
        if (rgba[1] > rgba[0] + 20 && rgba[1] > rgba[2] + 15) return true;
      }
    }
    return false;
  })()`);
}

function closeWindow(window) {
  if (window && !window.isDestroyed()) window.destroy();
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
      // Some Electron path keys are immutable after readiness.
    }
  }
}

async function openProject(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('.editor-shell')?.dataset.editorPage === 'editor' && document.querySelector('[data-testid="project-canvas-stage"]')`,
    'Issue #602 fixture did not open the real editor.',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`,
    'Issue #602 background did not become ready.',
  );
  await waitForDom(
    window,
    `(() => { const ids = JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.renderedAssetIds ?? '[]'); return ids.includes(${JSON.stringify(IDS.bodyAsset)}) && ids.includes(${JSON.stringify(IDS.faceNormalAsset)}); })()`,
    'Issue #602 Body and Base Face did not become ready.',
  );
  await delay(180);
}

async function newWindow() {
  const window = await createMainWindow({ show: true });
  window.setSize(1600, 1050);
  window.show();
  window.focus();
  window.webContents.focus();
  return window;
}

function near(actual, expected, tolerance = 18) {
  return actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  const project = createFixture();
  registerAcceptanceHandlers(project);
  await app.whenReady();
  configureElectronPaths();
  const screenshots = [];
  let window = null;
  try {
    configureMouthMode('pending');
    window = await newWindow();
    await openProject(window);
    const base = await readState(window);
    assert(base.compositeLayerIds.includes(IDS.characterLayer), `Canvas did not consume composite visual parts: ${JSON.stringify(base)}`);
    assert(base.backgroundReady, 'Base background is not ready.');

    await clickLogical(window, 960, 540);
    const bodySelected = await readState(window);
    await clickLogical(window, 1170, 536);
    const faceSelected = await readState(window);
    assert(bodySelected.selectedLayerId === IDS.characterLayer, `Body did not select logical Character Layer: ${JSON.stringify(bodySelected)}`);
    assert(faceSelected.selectedLayerId === IDS.characterLayer, `Face did not select the same logical Character Layer: ${JSON.stringify(faceSelected)}`);
    assert(faceSelected.transformerVisible, `Combined selection did not expose root Transformer: ${JSON.stringify(faceSelected)}`);

    const pixels = await readPixels(window, [
      { name: 'bodyOnly', x: 1_000, y: 540 },
      { name: 'faceOnly', x: 1_180, y: 536 },
      { name: 'overlap', x: 1_152, y: 536 },
    ]);
    // Body/Face are flattened in one Group and the 0.5 opacity is applied to
    // the flattened result. A separately-opacity'd child would retain a much
    // stronger red contribution at the overlap point.
    const expectedFaceOverBackground = [40, 84, 142, 255];
    assert(near(pixels.faceOnly, expectedFaceOverBackground), `Face pixel does not show one group opacity: ${JSON.stringify(pixels)}`);
    assert(near(pixels.overlap, expectedFaceOverBackground), `Body + Face overlap pixel is not the expected composite: ${JSON.stringify(pixels)}`);
    assert(pixels.overlap[0] < 70, `Overlap retained an unexpected Body red contribution: ${JSON.stringify(pixels)}`);
    const selectionGreen = await findCanvasColor(window, { x: 1_195, y: 536 });
    assert(selectionGreen, 'Combined selection outline was not found in rendered Canvas pixels.');
    const selectedScreenshot = 'composite-selected.png';
    writeFileSync(path.join(evidenceRoot, selectedScreenshot), (await window.webContents.capturePage()).toPNG());
    screenshots.push(selectedScreenshot);

    await dragLogical(window, 960, 540, 1_060, 540);
    try {
      await waitForDom(window, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').find((layer) => layer?.id === ${JSON.stringify(IDS.characterLayer)})?.x > 1050`, 'Whole Character drag did not move the logical root.');
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(await readState(window))}`,
        { cause: error },
      );
    }
    const moved = await readState(window);
    assert(moved.evaluatedLayer?.x > 1050, `Body + Face did not move together through the root: ${JSON.stringify(moved)}`);
    const movedScreenshot = 'composite-moved.png';
    writeFileSync(path.join(evidenceRoot, movedScreenshot), (await window.webContents.capturePage()).toPNG());
    screenshots.push(movedScreenshot);

    await seekFraction(window, 0.75);
    await waitForDom(window, `Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.currentTimeMs) > 1000`, 'Non-zero ready Expression state did not render.');
    await seekFraction(window, 0.375);
    try {
      await waitForDom(window, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.visualStatusJson ?? '[]').some((entry) => entry[0] === ${JSON.stringify(IDS.characterLayer)} && entry[1] === 'previous-complete')`, 'Pending Mouth did not retain the previous complete visual.');
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(await readState(window))}`,
        { cause: error },
      );
    }
    await waitForDom(window, `document.querySelector('[data-testid="canvas-visual-warning"]')?.dataset.visualWarningKind === 'pending'`, 'Pending Mouth did not expose the explicit pending Canvas warning.');
    const pending = await readState(window);
    assert(!pending.targetReadyLayerIds.includes(IDS.characterLayer), `Pending retained visual was incorrectly marked target-ready: ${JSON.stringify(pending)}`);
    const pendingScreenshot = 'composite-mouth-pending.png';
    writeFileSync(path.join(evidenceRoot, pendingScreenshot), (await window.webContents.capturePage()).toPNG());
    screenshots.push(pendingScreenshot);
    releasePendingMouth();
    await waitForDom(window, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.targetReadyLayerIds ?? '[]').includes(${JSON.stringify(IDS.characterLayer)})`, 'Released Mouth did not become the current complete target.');
    const readyScreenshot = 'composite-mouth-ready.png';
    writeFileSync(path.join(evidenceRoot, readyScreenshot), (await window.webContents.capturePage()).toPNG());
    screenshots.push(readyScreenshot);
    closeWindow(window);
    window = null;

    savedProject = null;
    configureMouthMode('failed');
    window = await newWindow();
    await openProject(window);
    await seekFraction(window, 0.375);
    await waitForDom(window, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.visualStatusJson ?? '[]').some((entry) => entry[0] === ${JSON.stringify(IDS.characterLayer)} && entry[1] === 'mouth-expression-fallback')`, 'Failed Mouth did not fall back to the current Expression.');
    await waitForDom(window, `document.querySelector('[data-testid="canvas-visual-failure-warning"]')?.dataset.visualWarningKind === 'degraded'`, 'Failed Mouth did not expose the explicit degraded Canvas warning.');
    const fallbackWarning = await window.webContents.executeJavaScript(`document.querySelector('[data-testid="canvas-visual-failure-warning"]')?.textContent ?? ''`);
    assert(fallbackWarning.includes('张嘴表情不可用') && fallbackWarning.includes('当前表情'), `Mouth degraded warning did not explain the fallback: ${fallbackWarning}`);
    const fallback = await readState(window);
    assert(fallback.evaluatedLayer?.assetId === IDS.faceAngryAsset, `Mouth fallback did not use the current Expression: ${JSON.stringify(fallback)}`);
    assert(fallback.evaluatedLayer?.mouthOverrideAssetId === null, `Mouth fallback retained the failed Mouth override: ${JSON.stringify(fallback)}`);
    const fallbackScreenshot = 'composite-mouth-fallback.png';
    writeFileSync(path.join(evidenceRoot, fallbackScreenshot), (await window.webContents.capturePage()).toPNG());
    screenshots.push(fallbackScreenshot);

    return {
      issue: 602,
      passed: true,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      projectRoot,
      syntheticInput: true,
      renderedPixelEvidence: {
        pixels,
        selectionGreen,
      },
      states: { base, bodySelected, faceSelected, moved, pending, fallback },
      screenshots,
    };
  } finally {
    closeWindow(window);
  }
}

async function main() {
  mkdirSync(acceptanceRoot, { recursive: true });
  let output;
  try {
    output = await run();
  } catch (error) {
    output = {
      issue: 602,
      passed: false,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
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
    console.error(`[issue602] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
