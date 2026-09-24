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
const exampleProject = require('../demo-project/project-v1.example.json');

// Focused S05 proof: the real Product Preview uses the shared Stage renderer
// for one complete Body + Face Character, does not expose a half-decoded pair,
// degrades only failed Mouth resources to the current Expression, and keeps a
// Body failure fatal. This is rendered-pixel evidence, not human acceptance.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue607-s05-review';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const userDataRoot = path.join(acceptanceRoot, 'electron-user-data');
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue607-s05-review.pandastage',
);
const resultPath = path.join(acceptanceRoot, 'results.json');

const IDS = Object.freeze({
  project: 'a0606000-0000-4000-8000-000000000001',
  backgroundAsset: 'a0606000-0000-4000-8000-000000000002',
  bodyAsset: 'a0606000-0000-4000-8000-000000000003',
  faceNormalAsset: 'a0606000-0000-4000-8000-000000000004',
  faceAngryAsset: 'a0606000-0000-4000-8000-000000000005',
  mouthAsset: 'a0606000-0000-4000-8000-000000000006',
  audioAsset: 'a0606000-0000-4000-8000-000000000007',
  character: 'a0606000-0000-4000-8000-000000000008',
  expressionNormal: 'a0606000-0000-4000-8000-000000000009',
  expressionAngry: 'a0606000-0000-4000-8000-00000000000a',
  backgroundLayer: 'a0606000-0000-4000-8000-00000000000b',
  characterLayer: 'a0606000-0000-4000-8000-00000000000c',
  shot: 'a0606000-0000-4000-8000-00000000000d',
  dialogue: 'a0606000-0000-4000-8000-00000000000e',
  audioClip: 'a0606000-0000-4000-8000-00000000000f',
  subtitle: 'a0606000-0000-4000-8000-000000000010',
  voiceProfile: 'a0606000-0000-4000-8000-000000000011',
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
let previewMode = false;
let readMode = 'pending';
let releasePendingAssetRead = () => undefined;
let pendingAssetReadPromise = null;
const pendingAssetReadIds = new Set();
const assetReadEvidence = [];

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
    name: 'Issue 607 Product Preview review proof',
  });
  const baseShot = base.shots[0];
  const baseSubtitle = base.subtitleStyles[0];
  const character = {
    ...base.characters[0],
    id: IDS.character,
    mode: 'composite',
    name: 'S05 Proof Character',
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
    name: 'S05 Product Preview proof',
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
        text: 'S05 composite proof',
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
        id: 'a0606000-0000-4000-8000-000000000012',
        type: 'expression',
        layerId: IDS.characterLayer,
        startMs: 1_000,
        endMs: 1_000,
        expressionId: IDS.expressionAngry,
      },
    ],
  };

  return migrateProject({
    ...base,
    schemaVersion: 7,
    id: IDS.project,
    name: 'Issue 607 Product Preview review proof',
    assets: [
      imageAsset(IDS.backgroundAsset, 'background', 1_920, 1_080),
      imageAsset(IDS.bodyAsset, 'body', 800, 1_000),
      imageAsset(IDS.faceNormalAsset, 'face-normal', 200, 100),
      imageAsset(IDS.faceAngryAsset, 'face-angry', 300, 200),
      imageAsset(IDS.mouthAsset, 'mouth', 400, 300),
      {
        id: IDS.audioAsset,
        kind: 'audio',
        name: 'proof voice',
        relativePath: 'assets/proof.wav',
        mimeType: 'audio/wav',
        durationMs: 1_000,
        sha256: hashFor(IDS.audioAsset),
      },
    ],
    characters: [character],
    voiceProfiles: [
      {
        ...base.voiceProfiles[0],
        id: IDS.voiceProfile,
        characterId: IDS.character,
      },
    ],
    subtitleStyles: [{ ...baseSubtitle, id: IDS.subtitle }],
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

function configureReadMode(mode) {
  readMode = mode;
  pendingAssetReadIds.clear();
  if (
    !['pending', 'mouth-decode-failed', 'face-decode-failed'].includes(mode)
  ) {
    pendingAssetReadPromise = null;
    releasePendingAssetRead = () => undefined;
    return;
  }
  pendingAssetReadPromise = new Promise((resolve) => {
    releasePendingAssetRead = resolve;
  });
}

async function waitForPendingAssetRead(assetId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (pendingAssetReadIds.has(assetId)) return;
    await delay(20);
  }
  throw new Error(`Asset image read did not pause for ${assetId}.`);
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
            message: 'Issue #607 fixture project was not found.',
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
            message: 'Issue #607 fixture project was not found.',
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
  register(IPC_CHANNELS.ASSET_PREVIEW_AUDIO_READ, (_event, request) => ({
    ok: false,
    error: {
      code: 'ASSET_PREVIEW_AUDIO_READ_FAILED',
      message: 'Synthetic audio is intentionally not decoded by this image gate.',
      assetId: request.assetId,
    },
  }));
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const asset = project.assets.find((candidate) => candidate.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #607 fixture image asset was not found.',
          assetId: request.assetId,
        },
      };
    }
    const requestMode = readMode;
    if (previewMode && asset.id === IDS.bodyAsset && requestMode === 'body-failed') {
      assetReadEvidence.push({ mode: requestMode, assetId: asset.id, ok: false });
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
          message: 'Synthetic Body decode failure for S05 fatal proof.',
          assetId: asset.id,
        },
      };
    }
    const holdMouthRead =
      previewMode &&
      asset.id === IDS.mouthAsset &&
      ['pending', 'mouth-decode-failed'].includes(requestMode);
    const holdFaceRead =
      previewMode &&
      asset.id === IDS.faceAngryAsset &&
      requestMode === 'face-decode-failed';
    if (holdMouthRead || holdFaceRead) {
      pendingAssetReadIds.add(asset.id);
      await pendingAssetReadPromise;
      pendingAssetReadIds.delete(asset.id);
    }
    if (previewMode && asset.id === IDS.mouthAsset && requestMode === 'mouth-failed') {
      assetReadEvidence.push({ mode: requestMode, assetId: asset.id, ok: false });
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
          message: 'Synthetic Mouth decode failure for S05 fallback proof.',
          assetId: asset.id,
        },
      };
    }
    const decodeTarget =
      previewMode &&
      ((requestMode === 'mouth-decode-failed' && asset.id === IDS.mouthAsset) ||
        (requestMode === 'body-decode-failed' && asset.id === IDS.bodyAsset) ||
        (requestMode === 'face-decode-failed' &&
          asset.id === IDS.faceAngryAsset));
    const bytes = decodeTarget
      ? Buffer.from('intentionally invalid image/png bytes')
      : (assetBytes.get(asset.id) ??
        solidPng(
          asset.width,
          asset.height,
          COLORS_BY_ASSET.get(asset.id) ?? [128, 128, 128],
        ));
    if (!decodeTarget) assetBytes.set(asset.id, bytes);
    assetReadEvidence.push({
      mode: requestMode,
      assetId: asset.id,
      ok: true,
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      payload: decodeTarget ? 'intentionally-invalid-image/png' : 'valid-png',
    });
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
    'Issue #607 fixture did not open the real editor.',
  );
}

async function openPreview(window, mode) {
  configureReadMode(mode);
  previewMode = true;
  await window.webContents.executeJavaScript(`(() => {
    window.__issue607ObjectUrls = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = createObjectURL(blob);
      window.__issue607ObjectUrls.push({ url, type: blob.type, size: blob.size });
      return url;
    };
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
    'Quick Action Drawer did not open.',
  );
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="quick-action-play"]')?.click()`,
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')`,
    'Product Preview overlay did not mount.',
  );
}

async function pausePreview(window) {
  await window.webContents.executeJavaScript(`(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    if (overlay?.dataset.previewPlaying === 'true') {
      document.querySelector('[data-testid="product-preview-play-pause"]')?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying !== 'true'`,
    'Product Preview did not pause.',
  );
}

async function seekPreview(window, timeMs) {
  await pausePreview(window);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Preview scrubber missing.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(timeMs))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTime ?? 0) >= ${timeMs - 20}`,
    `Preview did not seek to ${timeMs}ms.`,
  );
}

async function readPreview(window, points) {
  return window.webContents.executeJavaScript(`(() => {
    const overlay = document.querySelector('[data-testid="product-preview-overlay"]');
    const stage = document.querySelector('.product-preview-stage [data-testid="stage-renderer"]');
    const canvas = stage?.querySelector('canvas');
    const mouthWarning = document.querySelector('[data-testid="product-preview-mouth-degraded-warning"]');
    const mouthWarningStyle = mouthWarning ? getComputedStyle(mouthWarning) : null;
    const mouthWarningRect = mouthWarning?.getBoundingClientRect();
    const result = {
      preview: overlay ? {
        readiness: overlay.dataset.previewReadiness ?? '',
        degraded: overlay.dataset.previewDegraded === 'true',
        failedAssetIds: JSON.parse(overlay.dataset.previewFailedAssetIds ?? '[]'),
        visualState: document.querySelector('.product-preview-stage')?.dataset.previewVisualState ?? '',
        handoff: overlay.dataset.previewHandoff ?? '',
        surface: overlay.dataset.previewSurface ?? '',
        stageFailures: JSON.parse(overlay.dataset.previewStageFailures ?? '[]'),
      } : null,
      stage: stage ? {
        ready: stage.dataset.stageReady === 'true',
        displayReady: stage.dataset.stageDisplayReady === 'true',
        degraded: stage.dataset.stageDegraded === 'true',
        error: stage.dataset.stageError ?? '',
        time: stage.dataset.stageTime ?? '',
      } : null,
      canvasPresent: canvas instanceof HTMLCanvasElement,
      mouthWarning: mouthWarning?.textContent ?? '',
      mouthWarningVisible: Boolean(
        mouthWarning &&
        mouthWarningStyle?.display !== 'none' &&
        mouthWarningStyle?.visibility === 'visible' &&
        Number(mouthWarningStyle?.opacity) > 0 &&
        mouthWarningRect &&
        mouthWarningRect.width > 0 &&
        mouthWarningRect.height > 0,
      ),
      stageWarning: document.querySelector('[data-testid="product-preview-stage-warning"]')?.textContent ?? '',
      objectUrls: Array.isArray(window.__issue607ObjectUrls) ? window.__issue607ObjectUrls : [],
      stageErrorText: document.querySelector('[data-testid="stage-error"]')?.textContent ?? '',
      pixels: {},
    };
    if (!(canvas instanceof HTMLCanvasElement)) return result;
    const context = canvas.getContext('2d');
    if (!context) return result;
    const scaleX = canvas.width / 1920;
    const scaleY = canvas.height / 1080;
    const sample = (x, y) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * scaleX)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * scaleY)));
      return [...context.getImageData(px, py, 1, 1).data];
    };
    for (const point of ${JSON.stringify(points)}) {
      result.pixels[point.name] = sample(point.x, point.y);
    }
    return result;
  })()`);
}

async function capture(window, name) {
  writeFileSync(path.join(evidenceRoot, name), (await window.webContents.capturePage()).toPNG());
}

async function newWindow() {
  const window = await createMainWindow({ show: true });
  window.setSize(1600, 1_050);
  window.show();
  window.focus();
  window.webContents.focus();
  return window;
}

function closeWindow(window) {
  if (window && !window.isDestroyed()) window.destroy();
}

function near(actual, expected, tolerance = 18) {
  return actual?.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

async function waitForPreviewPixels(window, points, expectedPixels, message) {
  const deadline = Date.now() + 8_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await readPreview(window, points);
    const pixelsReady = Object.entries(expectedPixels).every(([name, color]) =>
      near(state.pixels[name], color),
    );
    if (pixelsReady) return state;
    await delay(40);
  }
  throw new Error(`${message} state=${JSON.stringify(state)}`);
}

async function waitExactPreview(window) {
  try {
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'ready' && document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'true'`,
      'Product Preview did not reach exact current-frame readiness.',
    );
  } catch (error) {
    const state = await readPreview(window, []);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  await pausePreview(window);
}

function assertRealDecodeEvidence(preview, mode, assetId, partId) {
  const read = assetReadEvidence.find(
    (item) => item.mode === mode && item.assetId === assetId && item.ok,
  );
  assert(
    read?.payload === 'intentionally-invalid-image/png',
    `Decode scenario did not return successful invalid PNG bytes: ${JSON.stringify(read)}`,
  );
  const failure = preview.preview?.stageFailures.find(
    (item) => item.partId === partId && item.assetId === assetId,
  );
  assert(
    failure?.reason === 'decode',
    `Shared Stage did not report the real image.onerror decode failure: ${JSON.stringify(preview)}`,
  );
  const objectUrl = preview.objectUrls.find(
    (item) => item.url === failure.sourceUrl,
  );
  assert(
    objectUrl?.type === read.mimeType && objectUrl.size === read.byteLength,
    `The failed Stage source was not created as an object URL from the successful bytes: ${JSON.stringify({ read, failure, objectUrl })}`,
  );
  return { read, failure, objectUrl };
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
    // Pending Mouth: no Body-only half frame is allowed before the required
    // Face resource is available.
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'pending');
    await waitForPendingAssetRead(IDS.mouthAsset);
    await delay(300);
    const pending = await readPreview(window, []);
    assert(
      !pending.stage || !pending.stage.ready,
      `Pending Mouth exposed a ready half-frame: ${JSON.stringify(pending)}`,
    );
    await capture(window, 'preview-mouth-pending.png');
    screenshots.push('preview-mouth-pending.png');
    releasePendingAssetRead();
    await waitExactPreview(window);
    const normal = await readPreview(window, [
      { name: 'bodyOnly', x: 1_000, y: 540 },
      { name: 'mouthOnly', x: 1_180, y: 536 },
      { name: 'overlap', x: 1_152, y: 536 },
    ]);
    assert(normal.preview?.degraded === false, `Ready Preview was degraded: ${JSON.stringify(normal)}`);
    assert(normal.stage?.ready === true, `Ready Stage was not exact: ${JSON.stringify(normal)}`);
    assert(near(normal.pixels.bodyOnly, [130, 54, 52, 255]), `Body pixel mismatch: ${JSON.stringify(normal)}`);
    assert(near(normal.pixels.mouthOnly, [145, 114, 42, 255]), `Mouth pixel mismatch: ${JSON.stringify(normal)}`);
    assert(near(normal.pixels.overlap, normal.pixels.mouthOnly), `Overlap retained a separate Body alpha: ${JSON.stringify(normal)}`);
    await capture(window, 'preview-mouth-ready.png');
    screenshots.push('preview-mouth-ready.png');

    await seekPreview(window, 1_500);
    const expression = await waitForPreviewPixels(
      window,
      [{ name: 'expressionOnly', x: 1_180, y: 536 }],
      { expressionOnly: [40, 129, 82, 255] },
      'Expression replacement pixels did not become drawable after seek.',
    );
    assert(near(expression.pixels.expressionOnly, [40, 129, 82, 255]), `Expression replacement pixel mismatch: ${JSON.stringify(expression)}`);
    await capture(window, 'preview-expression-replaced.png');
    screenshots.push('preview-expression-replaced.png');
    closeWindow(window);
    window = null;

    // Mouth failure: the current Expression is an intentional display
    // fallback, while Stage exact readiness remains false.
    savedProject = null;
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'mouth-failed');
    await pausePreview(window);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'ready' && document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewDegraded === 'true' && document.querySelector('[data-testid="product-preview-mouth-degraded-warning"]') && document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true'`,
      'Failed Mouth did not produce the visible Expression fallback.',
    );
    const fallback = await waitForPreviewPixels(
      window,
      [{ name: 'fallbackFace', x: 1_180, y: 536 }],
      { fallbackFace: [40, 84, 142, 255] },
      'Mouth read-failure fallback pixels did not become drawable.',
    );
    assert(fallback.preview?.degraded === true, `Mouth fallback was not degraded: ${JSON.stringify(fallback)}`);
    assert(fallback.stage?.ready === false, `Degraded fallback claimed exact readiness: ${JSON.stringify(fallback)}`);
    assert(near(fallback.pixels.fallbackFace, [40, 84, 142, 255]), `Mouth fallback pixel mismatch: ${JSON.stringify(fallback)}`);
    await capture(window, 'preview-mouth-fallback.png');
    screenshots.push('preview-mouth-fallback.png');
    closeWindow(window);
    window = null;

    // True browser decode failure: the read succeeds, Stage receives a Blob
    // object URL, then the browser fires HTMLImageElement.onerror. The initial
    // 0ms frame is inside the active dialogue and must fall back to its current
    // S03 Expression before Preview can complete its first-frame handoff.
    savedProject = null;
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'mouth-decode-failed');
    await waitForPendingAssetRead(IDS.mouthAsset);
    releasePendingAssetRead();
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'ready' && document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewDegraded === 'true' && document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active' && document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewHandoff === 'active' && document.querySelector('[data-testid="product-preview-mouth-degraded-warning"]') && document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageDisplayReady === 'true' && document.querySelector('.product-preview-stage [data-testid="stage-renderer"]')?.dataset.stageReady === 'false'`,
      'True Mouth decode failure did not reach a drawable, non-exact Expression fallback.',
    );
    await pausePreview(window);
    const mouthDecode = await waitForPreviewPixels(
      window,
      [
        { name: 'body', x: 1_000, y: 540 },
        { name: 'currentExpression', x: 1_180, y: 536 },
      ],
      {
        body: [130, 54, 52, 255],
        currentExpression: [40, 84, 142, 255],
      },
      'True Mouth decode fallback pixels did not become drawable.',
    );
    assert(mouthDecode.preview?.degraded === true, `Mouth decode did not remain degraded: ${JSON.stringify(mouthDecode)}`);
    assert(mouthDecode.stage?.time === '0', `Mouth fallback did not preserve the requested initial time: ${JSON.stringify(mouthDecode)}`);
    assert(mouthDecode.preview?.surface === 'active' && mouthDecode.preview?.handoff === 'active', `Mouth fallback did not complete the visible Preview handoff: ${JSON.stringify(mouthDecode)}`);
    assert(mouthDecode.mouthWarningVisible, `Existing Mouth fallback warning was not visibly rendered: ${JSON.stringify(mouthDecode)}`);
    assert(mouthDecode.stage?.displayReady === true, `Mouth fallback was not display-ready: ${JSON.stringify(mouthDecode)}`);
    assert(mouthDecode.stage?.ready === false, `Mouth decode fallback claimed exact readiness: ${JSON.stringify(mouthDecode)}`);
    assert(near(mouthDecode.pixels.body, [130, 54, 52, 255]), `Mouth decode fallback lost Body: ${JSON.stringify(mouthDecode)}`);
    assert(near(mouthDecode.pixels.currentExpression, [40, 84, 142, 255]), `Mouth decode did not use the current Expression at 0ms: ${JSON.stringify(mouthDecode)}`);
    const mouthDecodeEvidence = assertRealDecodeEvidence(
      mouthDecode,
      'mouth-decode-failed',
      IDS.mouthAsset,
      `${IDS.characterLayer}:face`,
    );
    await capture(window, 'preview-mouth-decode-fallback.png');
    screenshots.push('preview-mouth-decode-fallback.png');
    closeWindow(window);
    window = null;

    // Body failure: no optional fallback is legal, so Product Preview reports
    // an explicit fatal asset state and does not show a successful Stage.
    savedProject = null;
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'body-failed');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'error' && document.querySelector('[data-testid="product-preview-asset-warning"]')`,
      'Body failure did not produce the explicit Product Preview error.',
    );
    const fatal = await readPreview(window, []);
    assert(fatal.preview?.failedAssetIds.includes(IDS.bodyAsset), `Body failure was not classified as fatal: ${JSON.stringify(fatal)}`);
    assert(!fatal.stage || !fatal.stage.ready, `Body failure exposed a ready Stage: ${JSON.stringify(fatal)}`);
    await capture(window, 'preview-body-failure.png');
    screenshots.push('preview-body-failure.png');
    closeWindow(window);
    window = null;

    // A successful read containing invalid PNG bytes for required Body must
    // reach Stage image.onerror and remain a fatal Product Preview error.
    savedProject = null;
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'body-decode-failed');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'error' && document.querySelector('[data-testid="product-preview-stage-warning"]')`,
      'True Body decode failure did not produce a fatal Preview error.',
    );
    const bodyDecode = await readPreview(window, []);
    assert(bodyDecode.preview?.failedAssetIds.includes(IDS.bodyAsset), `Body decode was not classified fatal: ${JSON.stringify(bodyDecode)}`);
    assert(!bodyDecode.canvasPresent, `Body decode failure exposed a half Character canvas: ${JSON.stringify(bodyDecode)}`);
    assert(!bodyDecode.stage || !bodyDecode.stage.ready, `Body decode failure exposed an exact-ready Stage: ${JSON.stringify(bodyDecode)}`);
    const bodyDecodeEvidence = assertRealDecodeEvidence(
      bodyDecode,
      'body-decode-failed',
      IDS.bodyAsset,
      `${IDS.characterLayer}:body`,
    );
    await capture(window, 'preview-body-decode-failure.png');
    screenshots.push('preview-body-decode-failure.png');
    closeWindow(window);
    window = null;

    // A required current Expression/Face with no S03 Mouth fallback is also
    // fatal; do not retain the previous Mouth frame as successful output.
    savedProject = null;
    previewMode = false;
    window = await newWindow();
    await openProject(window);
    await openPreview(window, 'face-decode-failed');
    await seekPreview(window, 1_500);
    await waitForPendingAssetRead(IDS.faceAngryAsset);
    releasePendingAssetRead();
    await waitForDom(
      window,
      `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'error' && document.querySelector('[data-testid="product-preview-stage-warning"]')`,
      'True current Face decode failure did not produce a fatal Preview error.',
    );
    const faceDecode = await readPreview(window, []);
    assert(faceDecode.preview?.failedAssetIds.includes(IDS.faceAngryAsset), `Current Face decode was not classified fatal: ${JSON.stringify(faceDecode)}`);
    assert(!faceDecode.canvasPresent, `Current Face decode failure exposed a previous-frame canvas: ${JSON.stringify(faceDecode)}`);
    assert(!faceDecode.stage || !faceDecode.stage.ready, `Current Face decode failure exposed exact readiness: ${JSON.stringify(faceDecode)}`);
    const faceDecodeEvidence = assertRealDecodeEvidence(
      faceDecode,
      'face-decode-failed',
      IDS.faceAngryAsset,
      `${IDS.characterLayer}:face`,
    );
    await capture(window, 'preview-face-decode-failure.png');
    screenshots.push('preview-face-decode-failure.png');

    return {
      issue: 607,
      passed: true,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      projectRoot,
      syntheticInput: true,
      renderedPixelEvidence: { normal, expression, readFailureFallback: fallback, decodeFallback: mouthDecode },
      browserDecodeEvidence: {
        mouth: mouthDecodeEvidence,
        body: bodyDecodeEvidence,
        face: faceDecodeEvidence,
      },
      assetReadEvidence,
      states: { pending, fatalReadFailure: fatal, mouthDecode, bodyDecode, faceDecode },
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
      issue: 607,
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
    console.error(`[issue607] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
