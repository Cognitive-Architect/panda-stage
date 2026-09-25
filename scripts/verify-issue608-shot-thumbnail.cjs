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

// Bounded S06 proof: exercise the production ShotThumbnail component through
// the real Electron renderer and read pixels back from its actual DOM <img>.
// All fixture inputs and screenshots remain outside the repository.
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue608-shot-thumbnail';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const projectRoot = path.join(runRoot, 'projects', 'issue608-shot-thumbnail.pandastage');
const bridgeProjectRoot = path.join(runRoot, 'projects', 'issue608-bridge.pandastage');
const resultPath = path.join(runRoot, 'results.json');

const IDS = Object.freeze({
  project: 'a0608000-0000-4000-8000-000000000001',
  backgroundAsset: 'a0608000-0000-4000-8000-000000000002',
  bodyA: 'a0608000-0000-4000-8000-000000000003',
  bodyB: 'a0608000-0000-4000-8000-000000000004',
  bodyMissing: 'a0608000-0000-4000-8000-000000000005',
  faceBase: 'a0608000-0000-4000-8000-000000000006',
  faceMissing: 'a0608000-0000-4000-8000-000000000007',
  faceAlternate: 'a0608000-0000-4000-8000-000000000008',
  character: 'a0608000-0000-4000-8000-000000000009',
  expressionBase: 'a0608000-0000-4000-8000-00000000000a',
  expressionAlternate: 'a0608000-0000-4000-8000-00000000000b',
  backgroundLayer: 'a0608000-0000-4000-8000-00000000000c',
  characterLayer: 'a0608000-0000-4000-8000-00000000000d',
  shot: 'a0608000-0000-4000-8000-00000000000e',
  voiceProfile: 'a0608000-0000-4000-8000-00000000000f',
});

const COLORS = Object.freeze({
  background: [40, 48, 44],
  bodyA: [220, 60, 60],
  bodyB: [60, 210, 80],
  bodyMissing: [200, 60, 220],
  faceBase: [40, 120, 240],
  faceMissing: [240, 200, 20],
  faceAlternate: [50, 220, 180],
});

const channels = [];
const thumbnailReadEvidence = [];
const canvasReadEvidence = [];
let activeProject = null;
let bridgeProject = null;
let lastOpenedRoot = null;
let missingThumbnailAssetId = null;
let windowRef = null;

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  [IDS.bodyA, COLORS.bodyA],
  [IDS.bodyB, COLORS.bodyB],
  [IDS.bodyMissing, COLORS.bodyMissing],
  [IDS.faceBase, COLORS.faceBase],
  [IDS.faceMissing, COLORS.faceMissing],
  [IDS.faceAlternate, COLORS.faceAlternate],
]);

function createFixture() {
  const base = migrateProject({
    ...exampleProject,
    id: IDS.project,
    name: 'Issue 608 Shot thumbnail rendered-pixel proof',
  });
  const baseShot = base.shots[0];
  const baseCharacter = base.characters[0];
  const baseSubtitle = base.subtitleStyles[0];
  const character = {
    ...baseCharacter,
    id: IDS.character,
    mode: 'composite',
    name: 'S06 proof Character',
    baseAssetId: IDS.faceBase,
    defaultVoiceProfileId: IDS.voiceProfile,
    expressions: [
      { id: IDS.expressionBase, name: 'Base face', assetId: IDS.faceBase },
      {
        id: IDS.expressionAlternate,
        name: 'Unused alternate face',
        assetId: IDS.faceAlternate,
      },
    ],
    defaultExpressionId: IDS.expressionBase,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.bodyA,
    facePlacement: { offsetX: 100, offsetY: -120, scale: 0.5 },
  };
  const shot = {
    ...baseShot,
    id: IDS.shot,
    name: 'Body + base Face',
    backgroundLayerId: IDS.backgroundLayer,
    defaultSubtitleStyleId: baseSubtitle.id,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
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
        name: 'Composite proof Character',
        source: {
          kind: 'character',
          characterId: IDS.character,
          expressionId: IDS.expressionBase,
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
  };
  return migrateProject({
    ...base,
    schemaVersion: 7,
    id: IDS.project,
    name: 'Issue 608 Shot thumbnail rendered-pixel proof',
    assets: [
      imageAsset(IDS.backgroundAsset, 'background', 1_920, 1_080),
      imageAsset(IDS.bodyA, 'body-a', 800, 1_000),
      imageAsset(IDS.bodyB, 'body-b', 800, 1_000),
      imageAsset(IDS.bodyMissing, 'body-missing', 800, 1_000),
      imageAsset(IDS.faceBase, 'face-base', 200, 100),
      imageAsset(IDS.faceMissing, 'face-missing', 200, 100),
      imageAsset(IDS.faceAlternate, 'face-alternate', 240, 120),
    ],
    characters: [character],
    voiceProfiles: [
      {
        ...base.voiceProfiles[0],
        id: IDS.voiceProfile,
        characterId: IDS.character,
      },
    ],
    subtitleStyles: [baseSubtitle],
    shots: [shot],
  });
}

function withBody(project, bodyAssetId) {
  return {
    ...project,
    characters: project.characters.map((character) =>
      character.id === IDS.character
        ? { ...character, bodyAssetId }
        : character,
    ),
  };
}

function withMissingFace(project) {
  return {
    ...project,
    characters: project.characters.map((character) =>
      character.id === IDS.character
        ? {
            ...character,
            baseAssetId: IDS.faceMissing,
            expressions: character.expressions.map((expression) =>
              expression.id === IDS.expressionBase
                ? { ...expression, assetId: IDS.faceMissing }
                : expression,
            ),
          }
        : character,
    ),
  };
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
  const normalized = path.resolve(root).toLowerCase();
  if (normalized === path.resolve(projectRoot).toLowerCase()) return activeProject;
  if (normalized === path.resolve(bridgeProjectRoot).toLowerCase()) return bridgeProject;
  return null;
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
            message: 'Issue #608 synthetic project was not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
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
            message: 'Issue #608 synthetic project was not found.',
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
    if (!asset) {
      return {
        ok: false,
        error: {
          code: 'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
          message: 'Issue #608 thumbnail image fixture was not found.',
          assetId: request.assetId,
        },
      };
    }
    if (request.sha256 !== asset.sha256) {
      return {
        ok: false,
        error: {
          code: 'ASSET_THUMBNAIL_HASH_MISMATCH',
          message: 'Issue #608 fixture hash did not match its image.',
          assetId: asset.id,
          relativePath: asset.relativePath,
        },
      };
    }
    if (asset.id === missingThumbnailAssetId) {
      thumbnailReadEvidence.push({
        projectRoot: request.projectRoot,
        assetId: asset.id,
        sha256: request.sha256,
        status: 'missing',
      });
      return { ok: true, status: 'missing', assetId: asset.id };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS_BY_ASSET.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    thumbnailReadEvidence.push({
      projectRoot: request.projectRoot,
      assetId: asset.id,
      sha256: request.sha256,
      status: 'ready',
      byteLength: bytes.byteLength,
    });
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = currentImageAsset(request.assetId, request.projectRoot);
    if (!asset) {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #608 Canvas image fixture was not found.',
          assetId: request.assetId,
        },
      };
    }
    if (request.sha256 !== asset.sha256) {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
          message: 'Issue #608 Canvas fixture hash did not match its image.',
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
      // Some Electron path keys are immutable after readiness.
    }
  }
}

async function newWindow() {
  const window = await createMainWindow({ show: true });
  window.setSize(1600, 1050);
  window.show();
  window.focus();
  window.webContents.focus();
  return window;
}

async function setProjectRootInput(window, root) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its open-project input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(root)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="editor-layout"]')`,
    'Synthetic project did not open in the real editor.',
  );
}

async function ensureShotsActivity(window) {
  await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const open = dock?.dataset.resourceDrawerOpen === 'true';
    if (dock?.dataset.activeActivity !== 'shots' || !open) {
      const shotsRail = document.querySelector('[data-testid="resource-activity-rail-shots"]');
      const shotsTab = document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]');
      (shotsRail ?? shotsTab)?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true' && document.querySelector('[data-testid="shot-manager"]')`,
    'Shots activity did not visibly open its production Shot manager.',
  );
}

async function openProject(window) {
  const openAtRoot = async (root) => {
    const editorOpen = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-testid="editor-layout"]'))`,
    );
    if (editorOpen) {
      await window.webContents.executeJavaScript(`(() => {
        const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
        if (drawer?.dataset.expanded !== 'true') {
          drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
        }
      })()`);
      await waitForDom(
        window,
        `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`,
        'Quick Action Drawer did not open for the project refresh.',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[data-testid="quick-action-home"]')?.click()`,
      );
      await waitForDom(
        window,
        `document.querySelector('[data-testid="project-center-screen"]')`,
        'Project Center did not open for the project refresh.',
      );
    }
    await setProjectRootInput(window, root);
    await ensureShotsActivity(window);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="shot-manager"] .shot-manager-heading span')?.dataset.projectRevision === '0'`,
      'Synthetic project unexpectedly acquired a persisted edit while opening Shots.',
    );
    lastOpenedRoot = root;
  };

  if (
    lastOpenedRoot &&
    path.resolve(lastOpenedRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase()
  ) {
    await openAtRoot(bridgeProjectRoot);
  }
  await openAtRoot(projectRoot);
}

function thumbnailSelector() {
  return `[data-shot-thumbnail="true"][data-thumbnail-shot-id=${JSON.stringify(IDS.shot)}]`;
}

async function waitForThumbnailStatus(window, status) {
  const selector = thumbnailSelector();
  const visible = `nodes.every((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0; })`;
  const predicate = status === 'ready'
    ? `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]; return nodes.length > 0 && ${visible} && nodes.every((node) => node.dataset.thumbnailStatus === 'ready' && node.querySelector('img')?.complete && node.querySelector('img')?.naturalWidth === 256 && node.querySelector('img')?.naturalHeight === 144); })()`
    : `(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]; return nodes.length > 0 && ${visible} && nodes.every((node) => node.dataset.thumbnailStatus === ${JSON.stringify(status)} && !node.querySelector('img')); })()`;
  await waitForDom(
    window,
    predicate,
    `Production Shot thumbnail did not settle to ${status}.`,
  );
}

async function readThumbnailState(window) {
  const selector = thumbnailSelector();
  return window.webContents.executeJavaScript(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const read = (node) => {
      const image = node.querySelector('img');
      const common = {
        status: node.dataset.thumbnailStatus ?? '',
        fingerprint: node.dataset.thumbnailFingerprint ?? '',
        hasImage: image instanceof HTMLImageElement,
        width: image?.naturalWidth ?? 0,
        height: image?.naturalHeight ?? 0,
        bounds: (() => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            width: rect.width,
            height: rect.height,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            ancestry: (() => {
              const chain = [];
              let element = node;
              while (element && chain.length < 18) {
                const ancestorStyle = getComputedStyle(element);
                const ancestorRect = element.getBoundingClientRect();
                chain.push({
                  tag: element.tagName,
                  className: String(element.className ?? ''),
                  hidden: element.hidden,
                  display: ancestorStyle.display,
                  visibility: ancestorStyle.visibility,
                  opacity: ancestorStyle.opacity,
                  width: ancestorRect.width,
                  height: ancestorRect.height,
                });
                element = element.parentElement;
              }
              return chain;
            })(),
          };
        })(),
      };
      if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) return common;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not read the production Shot <img> pixels.');
      context.drawImage(image, 0, 0);
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      return {
        ...common,
        pixels: {
          bodyOnly: pixel(110, 72),
          faceAndBody: pixel(134, 64),
        },
      };
    };
    return {
      nodes: nodes.map(read),
      revision: Number(document.querySelector('[data-testid="shot-manager"] .shot-manager-heading span')?.dataset.projectRevision ?? NaN),
      shell: {
        mode: document.querySelector('.editor-layout')?.dataset.shellMode ?? '',
        workspace: document.querySelector('.editor-layout')?.dataset.activeWorkspace ?? '',
        resourceSlotHidden: document.querySelector('[data-workspace-owner="resources"]')?.hidden ?? null,
        dock: (() => {
          const dock = document.querySelector('[data-testid="resource-activity-dock"]');
          const surface = dock?.querySelector('.resource-activity-surface');
          const style = surface ? getComputedStyle(surface) : null;
          return {
            activity: dock?.dataset.activeActivity ?? '',
            drawerOpen: dock?.dataset.resourceDrawerOpen ?? '',
            className: dock?.className ?? '',
            surfaceVisibility: style?.visibility ?? '',
            surfaceDisplay: style?.display ?? '',
          };
        })(),
      },
    };
  })()`);
}

function near(actual, expected, tolerance = 3) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

function assertReady(
  state,
  bodyPixel,
  label,
  facePixel = [40, 84, 142, 255],
) {
  assert(state.nodes.length > 0, `${label}: no production Shot thumbnail consumers were mounted.`);
  assert(state.revision === 0, `${label}: read-only thumbnail generation changed project revision.`);
  for (const node of state.nodes) {
    assert(node.status === 'ready' && node.hasImage, `${label}: thumbnail was not ready: ${JSON.stringify(node)}`);
    assert(node.bounds.visible, `${label}: product thumbnail was not visible in the Shot workspace: ${JSON.stringify(node.bounds)}`);
    assert(node.width === 256 && node.height === 144, `${label}: thumbnail dimensions were not bounded: ${JSON.stringify(node)}`);
    assert(near(node.pixels.bodyOnly, bodyPixel), `${label}: Body pixel mismatch: ${JSON.stringify(node.pixels)}`);
    assert(near(node.pixels.faceAndBody, facePixel), `${label}: Face/Body overlap did not use one owner opacity: ${JSON.stringify(node.pixels)}`);
  }
}

async function capture(window, fileName) {
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, fileName);
  writeFileSync(target, image.toPNG());
  return path.relative(runRoot, target).replaceAll('\\', '/');
}

function closeWindow(window) {
  if (window && !window.isDestroyed()) window.destroy();
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(bridgeProjectRoot, { recursive: true });
  activeProject = createFixture();
  bridgeProject = {
    ...activeProject,
    shots: activeProject.shots.map((shot) => ({
      ...shot,
      backgroundLayerId: null,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      layers: [],
    })),
  };
  const initialProject = activeProject;
  const bodyReplacementProject = withBody(initialProject, IDS.bodyB);
  const missingBodyProject = withBody(initialProject, IDS.bodyMissing);
  const missingFaceProject = withMissingFace(initialProject);
  registerAcceptanceHandlers();
  await app.whenReady();
  configureElectronPaths();
  const screenshots = [];
  try {
    windowRef = await newWindow();
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'ready');
    const initial = await readThumbnailState(windowRef);
    screenshots.push(await capture(windowRef, 'base-body-face.png'));
    assertReady(initial, [130, 54, 52, 255], 'base Body + Face');

    activeProject = bodyReplacementProject;
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'ready');
    const bodyReplacement = await readThumbnailState(windowRef);
    assertReady(bodyReplacement, [50, 129, 62, 255], 'replaced Body');
    assert(
      initial.nodes[0].fingerprint !== bodyReplacement.nodes[0].fingerprint,
      'Body identity replacement did not change the visual fingerprint.',
    );
    screenshots.push(await capture(windowRef, 'body-replaced.png'));

    activeProject = missingBodyProject;
    missingThumbnailAssetId = IDS.bodyMissing;
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'missing');
    const missingBody = await readThumbnailState(windowRef);
    assert(missingBody.nodes.length > 0, 'Missing Body did not retain a product placeholder.');
    assert(missingBody.nodes.every((node) => node.status === 'missing' && !node.hasImage), `Missing Body exposed a partial image: ${JSON.stringify(missingBody)}`);
    assert(missingBody.nodes.every((node) => node.bounds.visible), 'Missing Body placeholder was not visible in the Shot workspace.');
    assert(missingBody.revision === 0, 'Missing Body inspection changed project revision.');
    screenshots.push(await capture(windowRef, 'body-missing-placeholder.png'));

    const missingBodyFingerprint = missingBody.nodes[0].fingerprint;
    missingThumbnailAssetId = null;
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'ready');
    const bodyRetry = await readThumbnailState(windowRef);
    assertReady(bodyRetry, [120, 54, 132, 255], 'Body retry');
    assert(bodyRetry.nodes[0].fingerprint === missingBodyFingerprint, 'Body retry changed the failed visual input fingerprint.');
    screenshots.push(await capture(windowRef, 'body-retry-ready.png'));

    activeProject = missingFaceProject;
    missingThumbnailAssetId = IDS.faceMissing;
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'missing');
    const missingFace = await readThumbnailState(windowRef);
    assert(missingFace.nodes.length > 0, 'Missing Face did not retain a product placeholder.');
    assert(missingFace.nodes.every((node) => node.status === 'missing' && !node.hasImage), `Missing Face exposed a partial image: ${JSON.stringify(missingFace)}`);
    assert(missingFace.nodes.every((node) => node.bounds.visible), 'Missing Face placeholder was not visible in the Shot workspace.');
    assert(missingFace.revision === 0, 'Missing Face inspection changed project revision.');
    screenshots.push(await capture(windowRef, 'face-missing-placeholder.png'));

    const missingFaceFingerprint = missingFace.nodes[0].fingerprint;
    missingThumbnailAssetId = null;
    await openProject(windowRef);
    await waitForThumbnailStatus(windowRef, 'ready');
    const faceRetry = await readThumbnailState(windowRef);
    assertReady(
      faceRetry,
      [130, 54, 52, 255],
      'Face retry',
      [140, 124, 32, 255],
    );
    assert(faceRetry.nodes[0].fingerprint === missingFaceFingerprint, 'Face retry changed the failed visual input fingerprint.');
    screenshots.push(await capture(windowRef, 'face-retry-ready.png'));

    const countFor = (assetId, status) => thumbnailReadEvidence.filter(
      (entry) => entry.assetId === assetId && entry.status === status,
    ).length;
    assert(countFor(IDS.bodyA, 'ready') === 1, 'Base Body thumbnail was not deduplicated by the shared product cache.');
    assert(countFor(IDS.bodyB, 'ready') === 1, 'Replacement Body thumbnail was not read exactly once.');
    assert(countFor(IDS.bodyMissing, 'missing') === 1 && countFor(IDS.bodyMissing, 'ready') === 1, 'Failed Body was cached as ready or did not retry the same asset.');
    assert(countFor(IDS.faceMissing, 'missing') === 1 && countFor(IDS.faceMissing, 'ready') === 1, 'Failed Face was cached as ready or did not retry the same asset.');
    assert(thumbnailReadEvidence.every((entry) => entry.projectRoot === projectRoot), 'Thumbnail cache evidence crossed project roots.');
    assert(canvasReadEvidence.some((entry) => entry.assetId === IDS.bodyA), 'The actual editor did not load the fixture through the Main canvas-image boundary.');

    return {
      issue: 608,
      passed: true,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: 'verify:issue608-shot-thumbnail',
      projectRoot,
      syntheticInput: true,
      humanAcceptance: false,
      evidenceKind: 'real-electron-product-dom-image-pixels',
      renderedPixelEvidence: {
        base: initial,
        bodyReplacement,
        missingBody,
        bodyRetry,
        missingFace,
        faceRetry,
      },
      cacheEvidence: thumbnailReadEvidence,
      canvasImageBoundaryEvidence: canvasReadEvidence,
      screenshots,
    };
  } finally {
    closeWindow(windowRef);
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
      issue: 608,
      passed: false,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: 'verify:issue608-shot-thumbnail',
      projectRoot,
      syntheticInput: true,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      thumbnailReadEvidence,
      canvasImageBoundaryEvidence: canvasReadEvidence,
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
    console.error(`[issue608] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
