const { app, ipcMain } = require('electron');
const { deflateSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
} = require('../dist-electron/domain/index.js');
const {
  detectSchemaVersion,
  migrateProject,
} = require('../dist-electron/domain/migrations/index.js');
const exampleProject = require('../demo-project/project-v1.example.json');

// Bounded S07 proof: use the production Character drawer, Assembly workbench,
// Asset Library drag source, Canvas drop target, and Project Save boundary in
// a real Windows Electron renderer. Synthetic fixture bytes are kept outside
// the repository, and the receipt does not claim human visual acceptance.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue609-character-assembly';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const projectRoot = path.join(runRoot, 'projects', 'issue609-assembly.pandastage');
const resultPath = path.join(runRoot, 'results.json');
const assetDragMime = 'application/x-panda-stage-asset';

const IDS = Object.freeze({
  project: 'a0609000-0000-4000-8000-000000000001',
  body: 'a0609000-0000-4000-8000-000000000002',
  bodyAlt: 'a0609000-0000-4000-8000-000000000003',
  face: 'a0609000-0000-4000-8000-000000000004',
  mouth: 'a0609000-0000-4000-8000-000000000005',
  shot: 'a0609000-0000-4000-8000-000000000006',
  legacyCharacter: 'a0609000-0000-4000-8000-000000000007',
  legacyNormalExpression: 'a0609000-0000-4000-8000-000000000008',
  legacyAngryExpression: 'a0609000-0000-4000-8000-000000000009',
  legacyVoiceProfile: 'a0609000-0000-4000-8000-00000000000a',
});

const COLORS = new Map([
  [IDS.body, [62, 132, 76]],
  [IDS.bodyAlt, [94, 104, 162]],
  [IDS.face, [231, 194, 112]],
  [IDS.mouth, [184, 90, 78]],
]);

const channels = [];
const canvasReadEvidence = [];
const thumbnailReadEvidence = [];
let activeProject = null;
let savedProject = null;
let windowRef = null;
let inProgressEvidence = {};

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function click(window, selector, label = selector) {
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(selector)})`,
    `${label} did not appear.`,
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
}

async function capture(window, fileName) {
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, fileName);
  writeFileSync(target, image.toPNG());
  return path.relative(runRoot, target).replaceAll('\\', '/');
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

function createFixture() {
  const base = migrateProject(exampleProject);
  const shot = base.shots[0];
  const legacyCharacter = {
    id: IDS.legacyCharacter,
    mode: 'single-image',
    name: 'Existing Single-image Panda',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.legacyVoiceProfile,
    expressions: [
      {
        id: IDS.legacyNormalExpression,
        name: 'normal',
        assetId: IDS.face,
      },
      {
        id: IDS.legacyAngryExpression,
        name: 'angry',
        assetId: IDS.mouth,
      },
    ],
    defaultExpressionId: IDS.legacyNormalExpression,
    defaultScale: 1,
    defaultFlipX: false,
  };
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: IDS.project,
    name: 'Issue 609 Composite Character Assembly Proof',
    assets: [
      imageAsset(IDS.body, 'Assembly Body', 720, 920),
      imageAsset(IDS.bodyAlt, 'Assembly Body Alternate', 720, 920),
      imageAsset(IDS.face, 'Assembly Default Face', 320, 280),
      imageAsset(IDS.mouth, 'Assembly Mouth', 320, 280),
    ],
    characters: [legacyCharacter],
    voiceProfiles: [
      {
        id: IDS.legacyVoiceProfile,
        name: 'Existing Single-image Panda voice',
        characterId: IDS.legacyCharacter,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    shots: [
      {
        ...shot,
        id: IDS.shot,
        name: 'Assembly acceptance Shot',
        backgroundLayerId: null,
        dialogues: [],
        audioClips: [],
        timelineEvents: [],
        layers: [],
      },
    ],
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

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  channels.push(channel);
}

function projectForRoot(root) {
  return path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase()
    ? activeProject
    : null;
}

function currentImageAsset(assetId, root) {
  return projectForRoot(root)?.assets.find(
    (asset) => asset.id === assetId && asset.kind === 'image',
  ) ?? null;
}

function registerAcceptanceHandlers() {
  const assetBytes = new Map();
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    const project = projectForRoot(request.projectRoot);
    return project
      ? { ok: true, value: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Issue #609 synthetic project was not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    savedProject = request.project;
    activeProject = request.project;
    return { ok: true, value: documentFor(request.projectRoot, request.project) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const project = projectForRoot(request.projectRoot);
    return project
      ? { ok: true, document: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_NOT_FOUND',
            message: 'Issue #609 synthetic project was not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const asset = currentImageAsset(request.assetId, request.projectRoot);
    if (!asset || asset.sha256 !== request.sha256) {
      return {
        ok: false,
        error: {
          code: asset ? 'ASSET_THUMBNAIL_HASH_MISMATCH' : 'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
          message: 'Issue #609 thumbnail fixture could not be read.',
          assetId: request.assetId,
          ...(asset ? { relativePath: asset.relativePath } : {}),
        },
      };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    thumbnailReadEvidence.push({ assetId: asset.id, status: 'ready' });
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = currentImageAsset(request.assetId, request.projectRoot);
    if (!asset || asset.sha256 !== request.sha256) {
      return {
        ok: false,
        error: {
          code: asset ? 'ASSET_CANVAS_IMAGE_HASH_MISMATCH' : 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #609 Canvas fixture could not be read.',
          assetId: request.assetId,
        },
      };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    canvasReadEvidence.push({ assetId: asset.id, sha256: request.sha256 });
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
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron paths become immutable after readiness.
    }
  }
}

async function openProject(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its project path input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode === 'landscape'`,
    'Synthetic project did not open in the landscape production editor.',
  );
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`,
    'Initial Canvas viewport did not receive its measured display scale.',
  );
  await click(window, '[data-testid="resource-activity-rail-characters"]', 'Characters activity');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'characters' && document.querySelector('[data-testid="character-list-view"]')`,
    'Character list did not open in the production resource drawer.',
  );
}

async function openCreate(window) {
  await click(window, '[data-testid="resource-primary-action"]', 'New Character action');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-create-view"]')`,
    'Character creation form did not open.',
  );
}

async function chooseImage(window, pickerTestId, assetId) {
  await click(window, `[data-testid="${pickerTestId}-selected"]`, `${pickerTestId} picker`);
  const candidates = `[data-testid="${pickerTestId}-candidates"] [data-asset-id="${assetId}"]`;
  await click(window, candidates, `${pickerTestId} asset ${assetId}`);
}

async function setCharacterName(window, value) {
  const selector = '[data-testid="character-create-view"] form input:not([type="radio"])';
  await waitForDom(window, `document.querySelector(${JSON.stringify(selector)})`, 'Character name field did not appear.');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function dragFaceWithNativeInput(window) {
  await waitForDom(
    window,
    `(() => {
      const target = document.querySelector('[data-testid="character-assembly-face-drag-target"]');
      const images = [...document.querySelectorAll('.character-assembly-part')];
      return target && target.getBoundingClientRect().width > 24 && images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0);
    })()`,
    'The Body + Face assembly preview did not become drawable.',
  );
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-testid="character-assembly-face-drag-target"]').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x + 32,
    y: point.y + 18,
    button: 'left',
  });
  await wait(80);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: point.x + 32,
    y: point.y + 18,
    button: 'left',
    clickCount: 1,
  });
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.faceOffsetX) !== 0 && Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.faceOffsetY) !== 0`,
    'Native pointer input did not adjust the temporary Face Placement.',
  );
  return window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
    return {
      bodyAssetId: workbench.dataset.bodyAssetId,
      faceAssetId: workbench.dataset.previewFaceAssetId,
      faceOffsetX: Number(workbench.dataset.faceOffsetX),
      faceOffsetY: Number(workbench.dataset.faceOffsetY),
      faceScale: Number(workbench.dataset.faceScale),
      history: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      rightInactive: document.querySelector('[data-workspace-owner="properties"]')?.dataset.characterAssemblyInactive ?? '',
      timelineInactive: document.querySelector('[data-testid="bottom-workspace"]')?.dataset.characterAssemblyInactive ?? '',
      canvasOwners: document.querySelectorAll('[data-workspace-owner="canvas"]').length,
    };
  })()`);
}

async function dispatchAssetDrop(window, sourceSelector, sourceContext) {
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`,
    'Canvas viewport did not recover a valid scale after leaving Assembly.',
  );
  const setup = await window.webContents.executeJavaScript(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(sourceSelector)})];
    const source = ${JSON.stringify(sourceContext)}
      ? candidates.find((candidate) => candidate.querySelector('.asset-card-context')?.textContent.includes(${JSON.stringify(sourceContext)}))
      : candidates[0];
    const target = document.querySelector('[data-testid="project-canvas-viewport"]');
    const stage = target?.querySelector('[data-testid="canvas-logical-stage"]');
    if (!source || !target || !stage) throw new Error('Asset card or Canvas drop target is missing.');
    const rect = target.getBoundingClientRect();
    const scale = Number(target.dataset.displayScale);
    const logicalX = Number(target.dataset.logicalWidth) / 2;
    const logicalY = Number(target.dataset.logicalHeight) / 2;
    const x = rect.left + Number(target.dataset.offsetX) + logicalX * scale - target.scrollLeft;
    const y = rect.top + Number(target.dataset.offsetY) + logicalY * scale - target.scrollTop;
    const dataTransfer = new DataTransfer();
    const event = (type) => new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: x,
      clientY: y,
    });
    source.dispatchEvent(event('dragstart'));
    target.dispatchEvent(event('dragenter'));
    target.dispatchEvent(event('dragover'));
    window.__issue609AssetDrop = { source, target, dataTransfer, x, y };
    return {
      x,
      y,
      types: [...dataTransfer.types],
      payload: dataTransfer.getData(${JSON.stringify(assetDragMime)}),
      dropDisabled: target.dataset.dropDisabled ?? '',
      viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      transform: {
        scale,
        offsetX: target.dataset.offsetX,
        offsetY: target.dataset.offsetY,
        logicalWidth: target.dataset.logicalWidth,
        logicalHeight: target.dataset.logicalHeight,
        scrollLeft: target.scrollLeft,
        scrollTop: target.scrollTop,
      },
    };
  })()`);
  const diagnostics = () => window.webContents.executeJavaScript(`(() => {
    const state = window.__issue609AssetDrop;
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    return {
      dragTypes: state ? [...state.dataTransfer.types] : [],
      dragPayload: state?.dataTransfer.getData(${JSON.stringify(assetDragMime)}) ?? '',
      canvasDropDisabled: state?.target.dataset.dropDisabled ?? '',
      canvasClass: state?.target.className ?? '',
      ghost: document.querySelector('[data-testid="canvas-drop-ghost"]')?.textContent?.trim() ?? '',
      interactionStatus: stage?.dataset.interactionStatus ?? '',
      layers: JSON.parse(stage?.dataset.layerJson ?? '[]').length,
      shellMode: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode ?? '',
    };
  })()`);
  try {
    await waitForDom(
      window,
      `document.querySelector('[data-testid="canvas-drop-ghost"]')`,
      'Canvas did not produce its production Drop Preview.',
    );
  } catch (error) {
    const state = await diagnostics();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; drag=${JSON.stringify(setup)}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  const preview = await diagnostics();
  await window.webContents.executeJavaScript(`(() => {
    const state = window.__issue609AssetDrop;
    if (!state) throw new Error('Asset drag state was lost before drop.');
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: state.dataTransfer,
      clientX: state.x,
      clientY: state.y,
    };
    state.target.dispatchEvent(new DragEvent('drop', options));
    state.source.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: state.dataTransfer,
    }));
  })()`);
  await wait(250);
  const afterDrop = await diagnostics();
  await window.webContents.executeJavaScript('delete window.__issue609AssetDrop');
  return { ...setup, preview, afterDrop };
}

async function readCanvasLayerState(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')`,
    'Canvas Stage did not render the placed visual.',
  );
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layers = JSON.parse(stage.dataset.layerJson ?? '[]');
    return {
      revision: Number(stage.dataset.projectRevision),
      layers,
      renderedAssetIds: JSON.parse(stage.dataset.renderedAssetIds ?? '[]'),
      incompleteVisualLayerIds: JSON.parse(stage.dataset.incompleteVisualLayerIds ?? '[]'),
      failureWarning: Boolean(document.querySelector('[data-testid="canvas-visual-failure-warning"]')),
    };
  })()`);
}

async function expandProjectActions(window) {
  await window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitForDom(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`, 'Project actions drawer did not expand.');
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  activeProject = createFixture();
  registerAcceptanceHandlers();
  await app.whenReady();
  configureElectronPaths();
  const screenshots = [];
  const evidence = {};
  inProgressEvidence = evidence;
  try {
    windowRef = await createMainWindow({ show: true });
    windowRef.setSize(1660, 1100);
    windowRef.show();
    windowRef.focus();
    windowRef.webContents.focus();
    await openProject(windowRef);

    await click(
      windowRef,
      `[data-testid="character-list-view"] [data-character-id="${IDS.legacyCharacter}"]`,
      'Existing single-image Character',
    );
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.legacyCharacter)}`,
      'The existing single-image Character did not open in Character detail.',
    );
    const existingSingleImage = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail?.dataset.characterEditorId ?? '',
        assemblyTab: Boolean(document.querySelector('[data-testid="character-workspace-assembly-tab"]')),
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
        tabs,
      };
    })()`);
    assert(existingSingleImage.characterId === IDS.legacyCharacter, 'The existing single-image Character identity changed.');
    assert(!existingSingleImage.assemblyTab, 'An existing single-image Character was incorrectly promoted to composite assembly.');
    assert(existingSingleImage.expressionCount === 2, 'The existing single-image Character lost its Expressions.');
    assert(existingSingleImage.tabs.length === 2 && existingSingleImage.tabs[0].pressed === 'true', 'The existing single-image Character no longer opens in its legacy Expressions workspace.');
    evidence.existingSingleImageCharacter = existingSingleImage;
    screenshots.push(await capture(windowRef, 'existing-single-image-character.png'));
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return from existing single-image Character');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-list-view"]')`,
      'The existing single-image Character did not return to the Character list.',
    );

    evidence.preflightProjectRevision = await windowRef.webContents.executeJavaScript(
      `document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? ''`,
    );
    await openCreate(windowRef);
    await click(windowRef, '[data-testid="character-create-mode-switch"] input[value="composite"]', 'Composite Character choice');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="create"]')`, 'Composite creation did not activate the Assembly workbench.');
    await click(windowRef, '[data-testid="character-create-back"]', 'Cancel composite creation');
    await waitForDom(windowRef, `document.querySelector('main.editor-shell')?.dataset.characterAssemblyActive === 'false'`, 'Cancel did not exit the non-persisted creation session.');
    const cancelled = await windowRef.webContents.executeJavaScript(`(() => ({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      characterCount: document.querySelector('[data-testid="character-manager"] .character-manager-heading [data-project-revision]')?.textContent ?? '',
    }))()`);
    assert(cancelled.revision === '0', 'Canceling composite creation changed the Project revision.');
    assert(cancelled.undoCount === '0', 'Canceling composite creation created a History entry.');
    evidence.createCancel = cancelled;

    await openCreate(windowRef);
    await click(windowRef, '[data-testid="character-create-mode-switch"] input[value="composite"]', 'Composite Character choice');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="create"]')`, 'Composite creation workbench did not reopen.');
    await setCharacterName(windowRef, 'S07 Composite Panda');
    await chooseImage(windowRef, 'character-create-body-picker', IDS.body);
    await chooseImage(windowRef, 'character-create-face-picker', IDS.face);
    await chooseImage(windowRef, 'character-create-mouth-picker', IDS.mouth);
    const dragEvidence = await dragFaceWithNativeInput(windowRef);
    assert(dragEvidence.bodyAssetId === IDS.body, 'Create preview did not use the explicitly selected Body.');
    assert(dragEvidence.faceAssetId === IDS.face, 'Create preview did not use the selected default Face.');
    assert(dragEvidence.revision === '0' && dragEvidence.history === '0', 'Assembly interactions wrote Project or History before Create.');
    assert(dragEvidence.rightInactive === 'true', 'The right Inspector remained active during Assembly.');
    assert(dragEvidence.timelineInactive === 'true', 'The Timeline remained active during Assembly.');
    assert(dragEvidence.canvasOwners === 1, 'Assembly introduced a second Canvas owner.');
    evidence.createAssembly = dragEvidence;
    screenshots.push(await capture(windowRef, 'create-composite-assembly.png'));
    await click(windowRef, '[data-testid="character-assembly-create"]', 'Create composite Character');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]') && document.querySelector('[data-testid="character-assembly-workbench"]') === null`, 'Create did not commit once and open Character detail.');
    const created = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const managerRevision = document.querySelector('[data-testid="character-manager"] [data-project-revision]');
      const history = document.querySelector('[data-testid="history-controls"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail.dataset.characterEditorId,
        revision: managerRevision?.dataset.projectRevision ?? '',
        undoCount: history?.dataset.undoCount ?? '',
        tabs,
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
      };
    })()`);
    assert(created.characterId, 'Created Character did not reach its existing Detail workflow.');
    assert(created.revision === '1' && created.undoCount === '1', 'Create did not produce exactly one Project/History operation.');
    assert(created.tabs.length === 3 && created.tabs[0].label === '装配', 'Composite detail did not expose Assembly, Expressions, and Settings.');
    assert(created.tabs.find((tab) => tab.label.includes('表情'))?.pressed === 'true', 'Composite detail did not open on Expressions by default.');
    assert(created.expressionCount === 1, 'Composite creation imposed or created extra Expressions.');
    evidence.createdCharacter = created;

    await click(windowRef, '[data-testid="character-workspace-assembly-tab"]', 'Assembly workspace tab');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]')`, 'Existing composite did not enter its Assembly workspace.');
    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.bodyAlt);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'Body replacement did not become a pending Assembly draft.');
    await click(windowRef, '[data-testid="character-assembly-pending"] button:first-of-type', 'Revert Assembly draft');
    await waitForDom(windowRef, `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.body)}`, 'Revert did not restore the persisted Body without writing.');
    const reverted = await windowRef.webContents.executeJavaScript(`({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
    })`);
    assert(reverted.revision === '1' && reverted.undoCount === '1', 'Reverting Assembly changed Project or History.');
    evidence.editCancel = reverted;

    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.bodyAlt);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'Second Body replacement did not become pending.');
    await click(windowRef, '[data-testid="character-assembly-pending"] button:last-child', 'Apply Assembly draft');
    await waitForDom(windowRef, `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.bodyAlt)}`, 'Apply did not commit the Body replacement.');
    const applied = await windowRef.webContents.executeJavaScript(`({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
    })`);
    assert(applied.revision === '2' && applied.undoCount === '2', 'Assembly Apply did not produce exactly one Project/History operation.');
    evidence.editApply = applied;
    await click(windowRef, '[data-testid="character-workspace-expressions-tab"]', 'Expressions workspace tab');
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return to Character list');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-list-view"] [data-character-id="${created.characterId}"]')`, 'Created Character did not remain in the authoritative Character list.');
    await click(windowRef, `[data-testid="character-list-view"] [data-character-id="${created.characterId}"]`, 'Reopen Character detail');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')`, 'Character Detail did not reopen from the resource list.');

    await click(windowRef, '[data-testid="resource-activity-rail-assets"]', 'Asset Library activity');
    await waitForDom(windowRef, `document.querySelector('[data-testid="asset-library"]')`, 'Asset Library did not open.');
    await windowRef.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('[aria-label="素材分类"] button')]
        .find((candidate) => candidate.textContent.includes('角色'));
      if (!button) throw new Error('Character category filter was not found.');
      button.click();
    })()`);
    await waitForDom(windowRef, `document.querySelector('.asset-card[data-asset-id="${IDS.bodyAlt}"] .asset-card-context')`, 'Composite Body did not appear in the Character Asset Library category.');
    const bodyEntry = await windowRef.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.asset-card[data-asset-id="${IDS.bodyAlt}"]');
      return {
        category: card?.dataset.category ?? '',
        context: card?.querySelector('.asset-card-context')?.textContent?.trim() ?? '',
        draggable: card?.draggable ?? false,
      };
    })()`);
    assert(bodyEntry.category === 'character', 'Body asset was not categorized as Character-related.');
    assert(bodyEntry.context === '身体素材 · 作为普通图片放置', 'Body-only Asset Library action inferred formal Character identity.');
    assert(bodyEntry.draggable, 'Body raw-image action was not available.');
    evidence.bodyAssetLibrary = bodyEntry;

    const rawDrop = await dispatchAssetDrop(
      windowRef,
      `.asset-card[data-asset-id="${IDS.bodyAlt}"]`,
    );
    evidence.bodyRawDropAttempt = rawDrop;
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1`, 'Raw Body image action did not place one ordinary Image Layer.');
    const rawLayer = await windowRef.webContents.executeJavaScript(`JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson)`);
    assert(rawLayer[0].source.kind === 'asset' && rawLayer[0].source.assetId === IDS.bodyAlt, 'Body drop guessed a formal Character identity instead of using the explicit raw-image action.');
    evidence.bodyRawImageDrop = { drag: rawDrop, source: rawLayer[0].source };

    await expandProjectActions(windowRef);
    await click(windowRef, '[data-testid="quick-action-history"] button[aria-label="撤销"]', 'Undo raw Body image placement');
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 0`, 'Undo did not remove the raw Body Image Layer.');
    const expressionCardSelector = `.asset-card[data-asset-id="${IDS.face}"]`;
    const formalDrop = await dispatchAssetDrop(
      windowRef,
      expressionCardSelector,
      'S07 Composite Panda',
    );
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1 && JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson)[0].source.kind === 'character'`, 'Formal Expression drop did not place a Character Layer.');
    await waitForDom(windowRef, `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const assets = JSON.parse(stage?.dataset.renderedAssetIds ?? '[]');
      const incomplete = JSON.parse(stage?.dataset.incompleteVisualLayerIds ?? '[]');
      return assets.includes(${JSON.stringify(IDS.bodyAlt)}) && assets.includes(${JSON.stringify(IDS.face)}) && incomplete.length === 0;
    })()`, 'The complete Body + Face visual did not render on the Shot Canvas.');
    const canvasState = await readCanvasLayerState(windowRef);
    assert(canvasState.layers.length === 1, 'Formal Character placement produced more than one logical Shot Layer.');
    assert(canvasState.layers[0].source.characterId === created.characterId, 'Formal Shot Layer lost its explicit Character identity.');
    assert(canvasState.layers[0].source.expressionId, 'Formal Shot Layer lost its explicit Expression identity.');
    const formalPayload = JSON.parse(formalDrop.afterDrop.payload);
    assert(formalPayload.type === 'character-expression' && formalPayload.characterId === created.characterId, 'The shared Face asset drop did not carry the explicitly selected composite Character identity.');
    assert(canvasState.layers[0].source.expressionId === formalPayload.expressionId, 'Formal Shot Layer did not retain the explicitly selected Expression identity.');
    assert(canvasState.renderedAssetIds.includes(IDS.bodyAlt) && canvasState.renderedAssetIds.includes(IDS.face), 'Canvas did not render both composite visual parts.');
    assert(canvasState.incompleteVisualLayerIds.length === 0 && !canvasState.failureWarning, 'Canvas displayed an incomplete composite Character.');
    evidence.formalShotPlacement = { drag: formalDrop, canvas: canvasState };
    screenshots.push(await capture(windowRef, 'shot-single-character-layer.png'));

    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Characters activity for legacy creation');
    await windowRef.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-testid="character-detail-back"]')?.click();
    })()`);
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-list-view"]')`,
      'Character list did not reopen for the legacy single-image creation check.',
    );
    await openCreate(windowRef);
    await waitForDom(
      windowRef,
      `document.querySelector('form.character-create-form')?.dataset.creationMode === 'single-image'`,
      'The existing Create Character entry did not default to its single-image workflow.',
    );
    await setCharacterName(windowRef, 'S07 Legacy Panda');
    await chooseImage(windowRef, 'character-create-normal-picker', IDS.face);
    await chooseImage(windowRef, 'character-create-angry-picker', IDS.mouth);
    const legacyDraft = await windowRef.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('form.character-create-form');
      return {
        mode: form?.dataset.creationMode ?? '',
        normalAssetId: document.querySelector('[data-testid="character-create-normal-picker"]')?.dataset.selectedAssetId ?? '',
        angryAssetId: document.querySelector('[data-testid="character-create-angry-picker"]')?.dataset.selectedAssetId ?? '',
        mouthAssetId: document.querySelector('[data-testid="character-create-mouth-picker"]')?.dataset.selectedAssetId ?? '',
        createEnabled: !form?.querySelector('button[type="submit"]')?.disabled,
        revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
        undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      };
    })()`);
    assert(legacyDraft.mode === 'single-image', 'The legacy creator changed to composite mode without an explicit choice.');
    assert(legacyDraft.normalAssetId === IDS.face && legacyDraft.angryAssetId === IDS.mouth, 'The legacy creator did not retain its two explicitly selected images.');
    assert(legacyDraft.normalAssetId !== legacyDraft.angryAssetId, 'The legacy creator no longer enforces distinct Normal and Angry images.');
    assert(!legacyDraft.mouthAssetId, 'The legacy creator unexpectedly required or selected an optional Mouth image.');
    assert(legacyDraft.createEnabled, 'The valid legacy single-image creation path could not be submitted.');
    assert(legacyDraft.revision === '5' && legacyDraft.undoCount === '5', 'Preparing a legacy Character wrote to Project or History before Create.');
    await click(windowRef, '[data-testid="character-create-view"] button[type="submit"]', 'Create legacy single-image Character');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-detail-view"]') && document.querySelector('[data-testid="character-detail-view"]').dataset.characterEditorId !== ${JSON.stringify(IDS.legacyCharacter)}`,
      'The legacy single-image Character did not open in its existing Character detail workflow.',
    );
    const legacyCreated = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail?.dataset.characterEditorId ?? '',
        assemblyTab: Boolean(document.querySelector('[data-testid="character-workspace-assembly-tab"]')),
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
        tabs,
        revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
        undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      };
    })()`);
    assert(legacyCreated.characterId && legacyCreated.characterId !== IDS.legacyCharacter, 'The legacy creator did not create a new Character.');
    assert(!legacyCreated.assemblyTab && legacyCreated.expressionCount === 2, 'The newly created single-image Character did not use the legacy Expression detail.');
    assert(legacyCreated.tabs.length === 2 && legacyCreated.tabs[0].pressed === 'true', 'The single-image Character opened in the wrong Character workspace.');
    assert(legacyCreated.revision === '6' && legacyCreated.undoCount === '6', 'Legacy Character Create did not produce exactly one Project/History operation.');
    evidence.legacySingleImageCreate = { draft: legacyDraft, created: legacyCreated };
    screenshots.push(await capture(windowRef, 'legacy-single-image-created.png'));

    await click(windowRef, '[data-testid="quick-action-save"]', 'Save Project');
    await waitForDom(windowRef, `document.querySelector('[data-testid="quick-action-save"]')?.dataset.saveState === 'saved'`, 'Project Save did not complete through the production save action.');
    assert(savedProject, 'Project Save boundary did not receive a Project snapshot.');
    const savedComposite = savedProject.characters.find(
      (character) => character.id === created.characterId,
    );
    const savedExistingSingleImage = savedProject.characters.find(
      (character) => character.id === IDS.legacyCharacter,
    );
    const savedCreatedSingleImage = savedProject.characters.find(
      (character) => character.id === legacyCreated.characterId,
    );
    assert(savedProject.characters.length === 3, 'Saved Project did not preserve both single-image Characters and the new composite Character.');
    assert(savedComposite?.mode === 'composite', 'Saved Character was not composite.');
    assert(savedComposite.bodyAssetId === IDS.bodyAlt, 'Applied Body replacement was not persisted.');
    assert(savedComposite.mouthOpenAssetId === IDS.mouth, 'Optional Mouth was not persisted.');
    assert(savedExistingSingleImage?.mode === 'single-image', 'The pre-existing single-image Character was migrated or changed.');
    assert(savedExistingSingleImage.expressions.map((expression) => expression.id).join(',') === `${IDS.legacyNormalExpression},${IDS.legacyAngryExpression}`, 'The pre-existing single-image Character Expression identities changed.');
    assert(savedCreatedSingleImage?.mode === 'single-image', 'The legacy creation path did not persist a single-image Character.');
    assert(savedCreatedSingleImage.expressions.map((expression) => expression.assetId).join(',') === `${IDS.face},${IDS.mouth}`, 'The legacy creator did not persist its Normal and Angry images.');
    assert(savedProject.shots[0].layers.length === 1, 'Saved Shot did not contain exactly one logical Layer.');
    assert(savedProject.shots[0].layers[0].source.kind === 'character', 'Saved Shot Layer was not a formal Character Layer.');
    assert(savedProject.shots[0].layers[0].source.characterId === created.characterId, 'Saved Shot Layer points at the wrong Character.');

    return {
      issue: 609,
      passed: true,
      commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: 'verify:issue609-character-assembly',
      projectRoot,
      syntheticInput: true,
      humanAcceptance: false,
      evidenceKind: 'real-electron-production-ui-pointer-input-and-project-save-boundary',
      preflightAcknowledgement: {
        issueBody: true,
        creationAssemblyDesignComment5790040443: true,
        existingCompositeDetailDesignComment5790470746: true,
        designMdAndCurrentCharacterUiInspected: true,
      },
      evidence,
      savedProject: {
        shotPlacementRevision: canvasState.revision,
        characterId: savedComposite.id,
        characterMode: savedComposite.mode,
        expressionCount: savedComposite.expressions.length,
        mouthAssetId: savedComposite.mouthOpenAssetId,
        existingSingleImageCharacterId: savedExistingSingleImage.id,
        createdSingleImageCharacterId: savedCreatedSingleImage.id,
        shotLayerCount: savedProject.shots[0].layers.length,
        shotLayerSource: savedProject.shots[0].layers[0].source,
      },
      imageReadEvidence: canvasReadEvidence,
      thumbnailReadEvidence,
      screenshots,
    };
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    windowRef = null;
  }
}

async function main() {
  mkdirSync(runRoot, { recursive: true });
  let output;
  try {
    output = await run();
  } catch (error) {
    output = {
      issue: 609,
      passed: false,
      commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: 'verify:issue609-character-assembly',
      projectRoot,
      syntheticInput: true,
      humanAcceptance: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      evidence: { ...inProgressEvidence, savedProject: Boolean(savedProject) },
      imageReadEvidence: canvasReadEvidence,
      thumbnailReadEvidence,
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
    console.error(`[issue609] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
