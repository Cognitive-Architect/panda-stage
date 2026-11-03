'use strict';

const { app, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  CharacterService,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
} = require('../dist-electron/domain/index.js');

const acceptanceRoot = process.env.PANDA_STAGE_ISSUE963_ROOT
  ?? 'D:\\PandaStage-Acceptance\\issue963-c3-hit-camera';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const projectRoot = path.join(runRoot, 'projects', 'synthetic-hit-camera.pandastage');
const evidenceRoot = path.join(runRoot, 'evidence');
const resultPath = path.join(runRoot, 'issue963-c3-hit-camera-receipt.json');
const registeredChannels = [];
const assetBytes = new Map();
const ids = Object.freeze({
  project: '96300000-0000-4000-8000-000000000001',
  background: '96300000-0000-4000-8000-000000000002',
  rear: '96300000-0000-4000-8000-000000000003',
  front: '96300000-0000-4000-8000-000000000004',
  subtitle: '96300000-0000-4000-8000-000000000005',
  shot: '96300000-0000-4000-8000-000000000006',
  backgroundLayer: '96300000-0000-4000-8000-000000000007',
  rearPart: '96300000-0000-4000-8000-000000000008',
  frontPart: '96300000-0000-4000-8000-000000000009',
  character: '96300000-0000-4000-8000-00000000000a',
  voice: '96300000-0000-4000-8000-00000000000b',
});

let mainWindow = null;
let activeProject = null;
let trackedSnapshot = null;

process.env.VITE_DEV_SERVER_URL = '';
app.setPath('userData', path.join(runRoot, 'electron-user-data'));
app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, checksum]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride);
  }
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

function rectangle(rgba, width, height, x, y, rectWidth, rectHeight, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const offset = (py * width + px) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3] ?? 255;
    }
  }
}

function createPartPng(kind) {
  const width = 512;
  const height = 512;
  const rgba = Buffer.alloc(width * height * 4);
  if (kind === 'rear-sleeve') {
    rectangle(rgba, width, height, 20, 204, 472, 104, [39, 117, 177]);
    rectangle(rgba, width, height, 20, 224, 472, 22, [75, 158, 204]);
  } else if (kind === 'front-sleeve') {
    rectangle(rgba, width, height, 180, 100, 152, 312, [184, 83, 58]);
    rectangle(rgba, width, height, 198, 116, 116, 280, [218, 113, 77]);
  } else {
    rectangle(rgba, width, height, 0, 0, width, height, [38, 47, 54]);
  }
  return encodePng(width, height, rgba);
}

function makeAsset(id, name, bytes, width, height, usage) {
  assetBytes.set(id, bytes);
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}.png`,
    mimeType: 'image/png',
    width,
    height,
    sha256: sha256(bytes),
    usage,
    keywords: [],
  };
}

function makePart(partId, assetId, displayName, drawOrder) {
  return {
    partId,
    assetId,
    source: {
      kind: 'source-instance',
      sourceId: `synthetic:issue963:${partId}`,
      sourcePoseFrame: 0,
      effectiveFrame: 0,
    },
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx: -256, ty: -256 },
    imageMapping: {
      sourceWidth: 512,
      sourceHeight: 512,
      crop: { x: 0, y: 0, width: 512, height: 512 },
      exportScale: 1,
    },
    drawOrder,
    visible: true,
    displayName,
  };
}

function buildProject() {
  const backgroundBytes = createPartPng('background');
  const rearBytes = createPartPng('rear-sleeve');
  const frontBytes = createPartPng('front-sleeve');
  const background = makeAsset(ids.background, 'Fixture Background', backgroundBytes, 512, 512, 'background');
  const rear = makeAsset(ids.rear, 'Rear Sleeve With Wide Transparent Area', rearBytes, 512, 512, 'character');
  const front = makeAsset(ids.front, 'Front Sleeve With Wide Transparent Area', frontBytes, 512, 512, 'character');
  const project = ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: ids.project,
    name: 'Issue 963 Synthetic Hit Test Camera',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [background, rear, front],
    animations: [],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [{
      id: ids.subtitle,
      name: 'Synthetic Default',
      fontFamily: 'Arial',
      fontSize: 44,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      position: 'bottom',
      align: 'center',
      maxWidth: 1600,
    }],
    shots: [{
      id: ids.shot,
      name: 'Synthetic Transparent Part Hit Test',
      durationMs: 1000,
      defaultSubtitleStyleId: ids.subtitle,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      backgroundLayerId: ids.backgroundLayer,
      layers: [{
        id: ids.backgroundLayer,
        name: 'Background',
        source: { kind: 'asset', assetId: ids.background },
        anchor: 'center',
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
      }],
    }],
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
  });
  const generatedIds = [ids.character, ids.voice];
  const service = new CharacterService({
    createId: () => generatedIds.shift() ?? ids.character,
    now: () => new Date('2026-11-03T00:00:00.000Z'),
  });
  return ProjectSchema.parse(service.createAdaptiveParts(project, {
    name: 'Synthetic Two Sleeve Character',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      makePart(ids.rearPart, ids.rear, 'Rear sleeve', 0),
      makePart(ids.frontPart, ids.front, 'Front sleeve', 1),
    ],
  }));
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function projectDocument(project = activeProject) {
  return {
    projectRoot,
    projectFilePath: path.join(projectRoot, 'project.json'),
    project,
    migrated: false,
    sourceVersion: PROJECT_SCHEMA_VERSION,
  };
}

async function readPersistedProject() {
  return ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(projectRoot, 'project.json'), 'utf8')));
}

function registerProjectHandlers() {
  register(IPC_CHANNELS.PROJECT_OPEN, async (_event, request) => {
    if (path.resolve(request.projectRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) {
      return {
        ok: false,
        error: { code: 'PROJECT_NOT_FOUND', message: 'Issue 963 synthetic fixture not found.', projectRoot: request.projectRoot },
      };
    }
    activeProject = await readPersistedProject();
    return { ok: true, value: projectDocument(activeProject) };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, async (_event, request) => {
    assert(path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase(), 'Save targeted a different Issue 963 fixture root.');
    activeProject = ProjectSchema.parse(request.project);
    await fsp.writeFile(path.join(projectRoot, 'project.json'), `${JSON.stringify(activeProject, null, 2)}\n`, 'utf8');
    if (trackedSnapshot?.openInstanceId) {
      trackedSnapshot = {
        project: activeProject,
        revision: request.revision,
        dirty: false,
        openInstanceId: trackedSnapshot.openInstanceId,
      };
    }
    return { ok: true, value: projectDocument(activeProject) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, async () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, async () => ({
    ok: true,
    status: 'selected',
    projectRoot,
  }));
  register(IPC_CHANNELS.PROJECT_OPEN_FOLDER, async () => ({ ok: true }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, async () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, async (_event, request) => {
    assert(path.resolve(request.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase(), 'Reopen targeted a different Issue 963 fixture root.');
    activeProject = await readPersistedProject();
    assert(activeProject.id === request.expectedProjectId, 'Reopened Project ID does not match the Issue 963 fixture.');
    return { ok: true, document: projectDocument(activeProject) };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, async (_event, request) => {
    trackedSnapshot = {
      project: ProjectSchema.parse(request.project),
      revision: request.revision,
      dirty: request.dirty,
      openInstanceId: request.openInstanceId,
    };
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, async (_event, request) => {
    trackedSnapshot = {
      project: ProjectSchema.parse(request.project),
      revision: request.revision,
      dirty: request.dirty,
      openInstanceId: request.openInstanceId,
    };
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_STOP, async () => {
    trackedSnapshot = null;
    return { ok: true };
  });
  register(IPC_CHANNELS.RECOVERY_DETECT, async () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, async () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, async (_event, request) => {
    const asset = activeProject.assets.find((entry) => entry.id === request.assetId);
    const bytes = assetBytes.get(request.assetId);
    if (!asset || !bytes || asset.sha256 !== request.sha256) {
      return { ok: true, status: 'missing', assetId: request.assetId };
    }
    return { ok: true, status: 'ready', assetId: asset.id, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const asset = activeProject.assets.find((entry) => entry.id === request.assetId && entry.kind === 'image');
    const bytes = assetBytes.get(request.assetId);
    if (!asset || !bytes || asset.sha256 !== request.sha256) {
      return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Issue 963 synthetic image is unavailable.', assetId: request.assetId } };
    }
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: bytes.length,
      bytes: new Uint8Array(bytes),
    };
  });
}

function browserWait(expression, message, timeout = 20_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try { if (${expression}) return true; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function page(window, script) {
  return window.webContents.executeJavaScript(script, true);
}

async function waitFor(window, expression, message, timeout) {
  await page(window, browserWait(expression, message, timeout));
}

async function pause(ms = 80) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInputProtocol(window, run) {
  const devtools = window.webContents.debugger;
  const attachHere = !devtools.isAttached();
  if (attachHere) devtools.attach('1.3');
  try {
    return await run(devtools);
  } finally {
    if (attachHere && devtools.isAttached()) devtools.detach();
  }
}

async function pointerClick(window, point) {
  await withInputProtocol(window, async (devtools) => {
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
    await pause(25);
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await pause(25);
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  });
  await pause();
}

async function pointerDrag(window, start, end, withSpace = false) {
  await withInputProtocol(window, async (devtools) => {
    if (withSpace) {
      await devtools.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32,
      });
      await pause(30);
    }
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x,
      y: start.y,
    });
    await pause(30);
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    const distance = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    const steps = Math.max(1, Math.ceil(distance / 8));
    let previous = start;
    for (let step = 1; step <= steps; step += 1) {
      const point = {
        x: start.x + ((end.x - start.x) * step) / steps,
        y: start.y + ((end.y - start.y) * step) / steps,
      };
      await devtools.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1,
        deltaX: point.x - previous.x,
        deltaY: point.y - previous.y,
      });
      previous = point;
      await pause(15);
    }
    await devtools.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: end.x,
      y: end.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    if (withSpace) {
      await devtools.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32,
      });
    }
  });
  await pause(120);
}

async function pressEnter(window) {
  await withInputProtocol(window, async (devtools) => {
    const keyData = {
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    await devtools.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyData });
    await devtools.sendCommand('Input.dispatchKeyEvent', {
      type: 'char',
      ...keyData,
      text: '\r',
      unmodifiedText: '\r',
    });
    await devtools.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...keyData });
  });
  await pause();
}

async function wheel(window, point, deltaY) {
  await withInputProtocol(window, (devtools) => devtools.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
  }));
  await pause(160);
}

async function clickSelector(window, selector, label = selector) {
  const point = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none',
      disabled: Boolean(element.disabled),
    };
  })()`);
  assert(point?.visible && !point.disabled, `${label} is unavailable for pointer input: ${JSON.stringify(point)}`);
  await pointerClick(window, point);
  return point;
}

async function openProject(window) {
  await waitFor(window, `document.querySelector('[data-testid="open-project"]')`, 'Project Center did not render its Open Project tile.');
  await clickSelector(window, '[data-testid="open-project"]', 'Choose and open the synthetic Project');
  await waitFor(window, `document.querySelector('[data-testid="editor-layout"]')`, 'The synthetic Project did not open in the production editor.');
  await waitFor(window, `window.__pandaStageIssue816Acceptance?.inspect()?.project?.id === ${JSON.stringify(ids.project)}`, 'The editor did not load the expected Issue 963 fixture.');
}

async function capture(window, filename) {
  await page(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, filename);
  await fsp.writeFile(target, image.toPNG());
  return target;
}

async function readEditorState(window) {
  return page(window, `(() => {
    const state = window.__pandaStageIssue816Acceptance?.inspect?.();
    return state ? { revision: state.revision, dirty: state.dirty, undoCount: state.undoCount, redoCount: state.redoCount } : null;
  })()`);
}

async function readAdaptivePartAdjustment(window, characterId, partId) {
  return page(window, `(() => {
    const project = window.__pandaStageIssue816Acceptance?.inspect?.()?.project;
    const character = project?.characters.find((candidate) => candidate.id === ${JSON.stringify(characterId)});
    return character?.mode === 'adaptive-parts'
      ? character.parts.find((candidate) => candidate.partId === ${JSON.stringify(partId)})?.staticAdjustment ?? null
      : null;
  })()`);
}

async function readCamera(window) {
  return page(window, `(() => {
    const viewport = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]');
    const stage = viewport?.querySelector('.character-assembly-preview-stage');
    const rect = viewport?.getBoundingClientRect();
    if (!viewport || !stage || !rect) return null;
    return {
      scale: Number(new DOMMatrix(stage.style.transform).a),
      offsetX: Number.parseFloat(stage.style.left),
      offsetY: Number.parseFloat(stage.style.top),
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      left: rect.left + viewport.clientLeft,
      top: rect.top + viewport.clientTop,
      zoomLabel: document.querySelector('[data-testid="adaptive-parts-assembly-zoom-value"]')?.textContent?.trim() ?? null,
    };
  })()`);
}

async function sourcePixelPoint(window, partId, sourceX, sourceY) {
  return page(window, `(() => {
    const stage = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"] .character-assembly-preview-stage');
    const part = document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${partId}"]');
    if (!stage || !part) return null;
    const stageRect = stage.getBoundingClientRect();
    const matrix = new DOMMatrix(part.style.transform);
    const point = matrix.transformPoint(new DOMPoint(${sourceX}, ${sourceY}));
    const scale = stageRect.width / 1920;
    return { x: stageRect.left + point.x * scale, y: stageRect.top + point.y * scale };
  })()`);
}

async function selectedPartIds(window) {
  return page(window, `([...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected')]
    .map((element) => element.dataset.partId))`);
}

async function main() {
  await fsp.mkdir(evidenceRoot, { recursive: true });
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  activeProject = buildProject();
  for (const asset of activeProject.assets) {
    const bytes = assetBytes.get(asset.id);
    assert(bytes && sha256(bytes) === asset.sha256, `Synthetic PNG hash mismatch for Asset ${asset.id}.`);
    await fsp.writeFile(path.join(projectRoot, ...asset.relativePath.split('/')), bytes);
  }
  await fsp.writeFile(path.join(projectRoot, 'project.json'), `${JSON.stringify(activeProject, null, 2)}\n`, 'utf8');
  registerProjectHandlers();
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.setSize(1500, 960);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const receipt = {
    issue: 963,
    startedAt: new Date().toISOString(),
    runId,
    branch: require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    headAtRun: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    fixture: {
      provenance: 'Generated 512x512 transparent PNGs with broad empty regions; no private or third-party artwork.',
      projectPath: path.join(projectRoot, 'project.json'),
      projectId: ids.project,
      adaptiveCharacterId: ids.character,
      rearPartId: ids.rearPart,
      frontPartId: ids.frontPart,
      imageSize: '512x512',
    },
    evidenceRoot,
    checks: {},
    ownerPrivateFlaSmoke: 'NOT_RUN_PRIVATE_SOURCE_NOT_PROVIDED',
    ownerVisualAcceptance: 'NOT_ATTESTED',
    status: 'RUNNING',
  };

  try {
    await openProject(mainWindow);
    await page(mainWindow, `(() => {
      const prototype = CanvasRenderingContext2D.prototype;
      const original = prototype.getImageData;
      window.__issue963ImageDataReads = 0;
      prototype.getImageData = function (...args) {
        window.__issue963ImageDataReads += 1;
        return original.apply(this, args);
      };
    })()`);
    await clickSelector(mainWindow, '[data-testid="resource-activity-rail-characters"]', 'Open Characters');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-list-view"]')`, 'Character list did not open.');
    await clickSelector(mainWindow, `[data-testid="character-list-view"] [data-character-id="${ids.character}"]`, 'Open the synthetic Adaptive Parts assembly');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Adaptive Parts assembly did not open.');
    await waitFor(
      mainWindow,
      `(() => { const parts = [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')]; return parts.length === 2 && parts.every((part) => part.dataset.alphaHitTest === 'alpha'); })()`,
      'The synthetic PNG Alpha maps did not finish loading.',
    );
    const alphaReadsAtReady = await page(mainWindow, 'window.__issue963ImageDataReads');

    await clickSelector(
      mainWindow,
      `[data-testid="adaptive-parts-assembly-row"][data-part-id="${ids.rearPart}"] [data-testid="adaptive-parts-assembly-row-select"]`,
      'Select the rear Part from the left list',
    );
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.rearPart}"]')?.classList.contains('is-selected')`, 'The left Part list did not select the covered rear Part.');
    receipt.checks.leftListSelection = { result: 'PASS', selectedPartId: ids.rearPart };

    const beforeHitTests = await readEditorState(mainWindow);
    const transparentFrontPoint = await sourcePixelPoint(mainWindow, ids.frontPart, 50.5, 256.5);
    assert(transparentFrontPoint, 'Could not calculate the front sleeve transparent test point.');
    await pointerClick(mainWindow, transparentFrontPoint);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.rearPart}"]')?.classList.contains('is-selected')`, 'A click on the upper sleeve transparent pixel did not pass through to the rear visible sleeve.');
    const focusedPartAfterPointer = await page(mainWindow, 'document.activeElement?.dataset?.partId ?? null');
    assert(focusedPartAfterPointer === ids.rearPart, 'Pointer selection did not move keyboard focus to the selected Part.');
    receipt.checks.transparentPassThrough = {
      result: 'PASS',
      cssPoint: transparentFrontPoint,
      selectedPartId: ids.rearPart,
      focusedPartId: focusedPartAfterPointer,
    };

    const frontOpaquePoint = await sourcePixelPoint(mainWindow, ids.frontPart, 256.5, 256.5);
    await pointerClick(mainWindow, frontOpaquePoint);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.classList.contains('is-selected')`, 'The front opaque sleeve pixel did not select the front sleeve.');
    receipt.checks.frontOpaqueSelection = { result: 'PASS', cssPoint: frontOpaquePoint, selectedPartId: ids.frontPart };
    const frontOutlineBounds = await page(mainWindow, `(() => {
      const outline = document.querySelector('[data-testid="adaptive-parts-assembly-selection-outline"][data-part-id="${ids.frontPart}"]');
      if (!outline) return null;
      return {
        left: Number.parseFloat(outline.style.left),
        top: Number.parseFloat(outline.style.top),
        width: Number.parseFloat(outline.style.width),
        height: Number.parseFloat(outline.style.height),
      };
    })()`);
    assert(
      frontOutlineBounds &&
      Math.abs(frontOutlineBounds.left - 180) < 0.01 &&
      Math.abs(frontOutlineBounds.top - 100) < 0.01 &&
      Math.abs(frontOutlineBounds.width - 152) < 0.01 &&
      Math.abs(frontOutlineBounds.height - 312) < 0.01,
      `The front Part selection outline did not follow its Alpha visible bounds: ${JSON.stringify(frontOutlineBounds)}`,
    );
    receipt.checks.visibleSelectionOutline = {
      result: 'PASS',
      localVisibleRect: frontOutlineBounds,
      sourceVisibleRect: { x: 180, y: 100, width: 152, height: 312 },
    };

    const rearOpaquePoint = await sourcePixelPoint(mainWindow, ids.rearPart, 460.5, 256.5);
    await pointerClick(mainWindow, rearOpaquePoint);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.rearPart}"]')?.classList.contains('is-selected')`, 'The rear sleeve was not selectable at its exposed opaque pixel.');
    receipt.checks.rearOpaqueSelection = { result: 'PASS', cssPoint: rearOpaquePoint, selectedPartId: ids.rearPart };

    const blankPoint = await sourcePixelPoint(mainWindow, ids.frontPart, 50.5, 50.5);
    const rearTransformBeforeBlankDrag = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.rearPart}"]')?.style.transform ?? null`);
    await pointerDrag(mainWindow, blankPoint, { x: blankPoint.x + 24, y: blankPoint.y + 18 });
    const rearTransformAfterBlankDrag = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.rearPart}"]')?.style.transform ?? null`);
    const selectedAfterBlank = await selectedPartIds(mainWindow);
    const afterHitTests = await readEditorState(mainWindow);
    assert(
      rearTransformBeforeBlankDrag === rearTransformAfterBlankDrag &&
      JSON.stringify(selectedAfterBlank) === JSON.stringify([ids.rearPart]) &&
      JSON.stringify(afterHitTests) === JSON.stringify(beforeHitTests),
      `A blank transparent drag changed selection, draft, Project, Dirty, or History: ${JSON.stringify({ rearTransformBeforeBlankDrag, rearTransformAfterBlankDrag, selectedAfterBlank, beforeHitTests, afterHitTests })}`,
    );
    receipt.checks.blankDoesNotDrag = { result: 'PASS', cssPoint: blankPoint, editorStateUnchanged: true };

    await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.focus()`);
    await pressEnter(mainWindow);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.classList.contains('is-selected')`, 'Enter did not select the focused sleeve Part.');
    const alphaReadsAfterPointerInput = await page(mainWindow, 'window.__issue963ImageDataReads');
    assert(alphaReadsAtReady >= 2 && alphaReadsAfterPointerInput === alphaReadsAtReady, 'Alpha pixels were read again during pointer interaction instead of using the cached per-asset maps.');
    receipt.checks.keyboardFocusAndAlphaCache = {
      result: 'PASS',
      keyboardSelectedPartId: ids.frontPart,
      alphaReadsAtReady,
      alphaReadsAfterPointerInput,
    };
    receipt.screenshots = [await capture(mainWindow, 'ux01-alpha-hit-tests.png')];

    const initialCamera = await readCamera(mainWindow);
    assert(initialCamera, 'Adaptive Parts camera state could not be read.');
    const wheelPoint = { x: initialCamera.left + initialCamera.width * 0.38, y: initialCamera.top + initialCamera.height * 0.42 };
    const logicalUnderPointer = (camera) => ({
      x: (wheelPoint.x - camera.left - camera.offsetX) / camera.scale,
      y: (wheelPoint.y - camera.top - camera.offsetY) / camera.scale,
    });
    const logicalBeforeWheel = logicalUnderPointer(initialCamera);
    await wheel(mainWindow, wheelPoint, -120);
    const zoomedCamera = await readCamera(mainWindow);
    const logicalAfterWheel = logicalUnderPointer(zoomedCamera);
    assert(zoomedCamera.scale > initialCamera.scale, 'Cursor-centered wheel input did not zoom in.');
    assert(
      Math.abs(logicalAfterWheel.x - logicalBeforeWheel.x) < 1 &&
      Math.abs(logicalAfterWheel.y - logicalBeforeWheel.y) < 1,
      `Wheel zoom did not preserve the logical point below the cursor: ${JSON.stringify({ logicalBeforeWheel, logicalAfterWheel })}`,
    );
    assert(zoomedCamera.zoomLabel === `${Math.round(zoomedCamera.scale * 100)}%`, 'Zoom percentage does not match the actual camera scale.');
    receipt.checks.cursorWheelZoom = { result: 'PASS', before: initialCamera, after: zoomedCamera, logicalBeforeWheel, logicalAfterWheel };

    await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]')?.focus()`);
    const panStart = { x: initialCamera.left + 40, y: initialCamera.top + 40 };
    const cameraBeforePan = await readCamera(mainWindow);
    await pointerDrag(mainWindow, panStart, { x: panStart.x + 52, y: panStart.y + 31 }, true);
    const cameraAfterPan = await readCamera(mainWindow);
    assert(
      Math.abs(cameraAfterPan.offsetX - cameraBeforePan.offsetX - 52) < 1 &&
      Math.abs(cameraAfterPan.offsetY - cameraBeforePan.offsetY - 31) < 1,
      `Space+left drag did not pan the camera by the pointer delta: ${JSON.stringify({ cameraBeforePan, cameraAfterPan })}`,
    );
    receipt.checks.spaceLeftPan = { result: 'PASS', before: cameraBeforePan, after: cameraAfterPan, delta: { x: 52, y: 31 } };

    const stateBeforeCameraActions = await readEditorState(mainWindow);
    assert(JSON.stringify(stateBeforeCameraActions) === JSON.stringify(beforeHitTests), 'Wheel zoom or Space pan changed Project, Dirty, or History.');
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-show-all"]', 'View All visible parts');
    const cameraAfterViewAll = await readCamera(mainWindow);
    const stateAfterCameraActions = await readEditorState(mainWindow);
    assert(
      JSON.stringify(stateAfterCameraActions) === JSON.stringify(stateBeforeCameraActions),
      `Camera-only actions changed Project, Dirty, or History: ${JSON.stringify({ stateBeforeCameraActions, stateAfterCameraActions })}`,
    );
    assert(cameraAfterViewAll.scale > initialCamera.scale, 'View All did not fit the visible sleeve bounds above the frame-fit scale.');
    receipt.checks.viewAllIsContentFitAndSessionOnly = {
      result: 'PASS',
      before: cameraAfterPan,
      after: cameraAfterViewAll,
      editorStateUnchanged: true,
    };

    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-zoom-in"]', 'Zoom in with the plus control');
    const cameraAfterZoomInButton = await readCamera(mainWindow);
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-zoom-out"]', 'Zoom out with the minus control');
    const cameraAfterZoomOutButton = await readCamera(mainWindow);
    assert(cameraAfterZoomInButton.scale > cameraAfterViewAll.scale, 'The plus control did not increase camera zoom.');
    assert(Math.abs(cameraAfterZoomOutButton.scale - cameraAfterViewAll.scale) < 0.001, 'The minus control did not reverse one plus step.');
    receipt.checks.plusMinusControls = {
      result: 'PASS',
      afterViewAll: cameraAfterViewAll.zoomLabel,
      afterPlus: cameraAfterZoomInButton.zoomLabel,
      afterMinus: cameraAfterZoomOutButton.zoomLabel,
    };

    for (const part of [
      { id: ids.rearPart, x: 50.5, y: 256.5 },
      { id: ids.frontPart, x: 256.5, y: 256.5 },
    ]) {
      const point = await sourcePixelPoint(mainWindow, part.id, part.x, part.y);
      await pointerClick(mainWindow, point);
      await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${part.id}"]')?.classList.contains('is-selected')`, `Part ${part.id} could not be selected after camera navigation.`);
    }
    receipt.checks.selectionAfterZoomAndPan = { result: 'PASS', selectedPartIds: [ids.rearPart, ids.frontPart] };

    const cameraBeforeResize = await readCamera(mainWindow);
    const originalWindowSize = mainWindow.getSize();
    mainWindow.setSize(Math.max(1100, originalWindowSize[0] - 180), Math.max(760, originalWindowSize[1] - 100));
    await waitFor(mainWindow, `(() => { const viewport = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]'); return viewport && viewport.clientWidth > 0 && viewport.clientHeight > 0; })()`, 'The Adaptive Parts viewport did not resize.');
    await pause(250);
    const cameraAfterResize = await readCamera(mainWindow);
    assert(Math.abs(cameraAfterResize.scale - cameraBeforeResize.scale) < 0.0001, 'Window resizing discarded the manual camera zoom.');
    receipt.checks.resizePreservesCamera = { result: 'PASS', before: cameraBeforeResize, after: cameraAfterResize };

    await clickSelector(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open the compact Part inspector');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-inspector-fields"]')`, 'Part inspector did not open.');
    const cameraWithInspector = await readCamera(mainWindow);
    assert(Math.abs(cameraWithInspector.scale - cameraAfterResize.scale) < 0.0001, 'Opening the inspector changed the camera zoom.');
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-inspector-close"]', 'Close the compact Part inspector');
    receipt.checks.inspectorPreservesCamera = { result: 'PASS', scale: cameraWithInspector.scale };

    const timelineToggle = '[data-testid="timeline-collapse"]';
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(timelineToggle)})`, 'Timeline collapse control is unavailable.');
    const timelineBefore = await page(mainWindow, `document.querySelector(${JSON.stringify(timelineToggle)})?.dataset.expanded ?? null`);
    const timelineTarget = await page(mainWindow, `(() => {
      const button = document.querySelector(${JSON.stringify(timelineToggle)});
      const workspace = document.querySelector('[data-testid="bottom-workspace"]');
      if (!button || !workspace) return null;
      const style = getComputedStyle(workspace);
      return {
        expanded: button.dataset.expanded,
        inactive: workspace.dataset.characterAssemblyInactive === 'true',
        inert: workspace.inert,
        resizable: workspace.dataset.resizable === 'true',
        pointerEvents: style.pointerEvents,
        height: workspace.getBoundingClientRect().height,
        inlineHeight: workspace.style.height,
      };
    })()`);
    assert(
      timelineTarget?.inactive && timelineTarget.inert && timelineTarget.pointerEvents === 'none',
      `The Shot Timeline interactivity contract while Character Assembly is open changed: ${JSON.stringify(timelineTarget)}`,
    );
    assert(timelineTarget.resizable, 'The Shot Timeline geometry is not resizable in the synthetic editor layout.');
    const timelineHeightBefore = timelineTarget.height;
    const timelineInlineHeightBefore = timelineTarget.inlineHeight;
    const timelineHeightTarget = timelineHeightBefore <= 240 ? timelineHeightBefore + 36 : timelineHeightBefore - 36;
    const editorStateBeforeTimelineResize = await readEditorState(mainWindow);
    await page(mainWindow, `(() => {
      const workspace = document.querySelector('[data-testid="bottom-workspace"]');
      workspace.style.height = ${JSON.stringify(`${timelineHeightTarget}px`)};
    })()`);
    await pause(250);
    const timelineHeightAfter = await page(mainWindow, `document.querySelector('[data-testid="bottom-workspace"]')?.getBoundingClientRect().height ?? null`);
    const cameraWithTimelineChanged = await readCamera(mainWindow);
    assert(Math.abs(timelineHeightAfter - timelineHeightBefore) >= 24, `The timeline-area layout did not resize: ${JSON.stringify({ timelineHeightBefore, timelineHeightAfter })}`);
    const logicalCenterBeforeTimelineResize = {
      x: (cameraAfterResize.width / 2 - cameraAfterResize.offsetX) / cameraAfterResize.scale,
      y: (cameraAfterResize.height / 2 - cameraAfterResize.offsetY) / cameraAfterResize.scale,
    };
    const logicalCenterAfterTimelineResize = {
      x: (cameraWithTimelineChanged.width / 2 - cameraWithTimelineChanged.offsetX) / cameraWithTimelineChanged.scale,
      y: (cameraWithTimelineChanged.height / 2 - cameraWithTimelineChanged.offsetY) / cameraWithTimelineChanged.scale,
    };
    assert(
      Math.abs(cameraWithTimelineChanged.scale - cameraAfterResize.scale) < 0.0001 &&
      Math.abs(logicalCenterAfterTimelineResize.x - logicalCenterBeforeTimelineResize.x) < 1 &&
      Math.abs(logicalCenterAfterTimelineResize.y - logicalCenterBeforeTimelineResize.y) < 1,
      `Changing timeline-area geometry did not preserve the manual camera: ${JSON.stringify({ cameraAfterResize, cameraWithTimelineChanged, logicalCenterBeforeTimelineResize, logicalCenterAfterTimelineResize })}`,
    );
    const editorStateAfterTimelineResize = await readEditorState(mainWindow);
    assert(JSON.stringify(editorStateAfterTimelineResize) === JSON.stringify(editorStateBeforeTimelineResize), 'Changing timeline-area geometry changed Project, Dirty, or History state.');
    await page(mainWindow, `(() => {
      const workspace = document.querySelector('[data-testid="bottom-workspace"]');
      workspace.style.height = ${JSON.stringify(timelineInlineHeightBefore)};
    })()`);
    await pause(180);
    receipt.checks.timelinePreservesCamera = {
      result: 'PASS',
      timelineBefore,
      interactionContract: 'inert while Character Assembly is active',
      input: 'layout-height change to exercise the timeline-driven editor resize; the inert timeline was not clicked',
      heightBefore: timelineHeightBefore,
      heightAfter: timelineHeightAfter,
      before: cameraAfterResize,
      after: cameraWithTimelineChanged,
      logicalCenterBefore: logicalCenterBeforeTimelineResize,
      logicalCenterAfter: logicalCenterAfterTimelineResize,
      editorStateUnchanged: true,
    };

    await clickSelector(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open the compact Part inspector for the content-fit check');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-inspector-fields"]')`, 'Part inspector did not open for the content-fit check.');
    const editorStateBeforeInspectorFit = await readEditorState(mainWindow);
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-show-all"]', 'View all visible parts with the inspector open');
    const inspectorAwareFit = await page(mainWindow, `(() => {
      const viewport = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]');
      const stage = viewport?.querySelector('.character-assembly-preview-stage');
      const inspector = document.querySelector('.adaptive-parts-assembly-inspector');
      if (!viewport || !stage || !inspector) return null;
      const stageRect = stage.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const inspectorRect = inspector.getBoundingClientRect();
      const scale = stageRect.width / 1920;
      const sourceBounds = [
        { id: ${JSON.stringify(ids.rearPart)}, x: 20, y: 204, width: 472, height: 104 },
        { id: ${JSON.stringify(ids.frontPart)}, x: 180, y: 100, width: 152, height: 312 },
      ];
      const points = sourceBounds.flatMap((bounds) => {
        const part = viewport.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="' + bounds.id + '"]');
        if (!part) return [];
        const matrix = new DOMMatrix(part.style.transform);
        return [
          [bounds.x, bounds.y],
          [bounds.x + bounds.width, bounds.y],
          [bounds.x, bounds.y + bounds.height],
          [bounds.x + bounds.width, bounds.y + bounds.height],
        ].map(([x, y]) => {
          const point = matrix.transformPoint(new DOMPoint(x, y));
          return { x: stageRect.left + point.x * scale, y: stageRect.top + point.y * scale };
        });
      });
      if (points.length !== 8) return null;
      const visibleBounds = {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
      return {
        visibleBounds,
        viewport: {
          left: viewportRect.left + viewport.clientLeft,
          top: viewportRect.top + viewport.clientTop,
          right: viewportRect.left + viewport.clientLeft + viewport.clientWidth,
          bottom: viewportRect.top + viewport.clientTop + viewport.clientHeight,
        },
        inspector: { left: inspectorRect.left, top: inspectorRect.top, right: inspectorRect.right, bottom: inspectorRect.bottom },
      };
    })()`);
    assert(inspectorAwareFit, 'Could not calculate visible Part bounds with the expanded inspector.');
    const fittedVisible = inspectorAwareFit.visibleBounds;
    const fitViewport = inspectorAwareFit.viewport;
    const inspectorRect = inspectorAwareFit.inspector;
    const inspectorOverlapWidth = Math.max(0, Math.min(fittedVisible.right, inspectorRect.right) - Math.max(fittedVisible.left, inspectorRect.left));
    const inspectorOverlapHeight = Math.max(0, Math.min(fittedVisible.bottom, inspectorRect.bottom) - Math.max(fittedVisible.top, inspectorRect.top));
    assert(
      fittedVisible.left >= fitViewport.left - 1 &&
      fittedVisible.top >= fitViewport.top - 1 &&
      fittedVisible.right <= fitViewport.right + 1 &&
      fittedVisible.bottom <= fitViewport.bottom + 1 &&
      !(inspectorOverlapWidth > 1 && inspectorOverlapHeight > 1),
      `View All left visible Part content under the expanded inspector or outside the viewport: ${JSON.stringify(inspectorAwareFit)}`,
    );
    const editorStateAfterInspectorFit = await readEditorState(mainWindow);
    assert(
      JSON.stringify(editorStateAfterInspectorFit) === JSON.stringify(editorStateBeforeInspectorFit),
      'View All with the expanded inspector changed Project, Dirty, or History.',
    );
    receipt.checks.viewAllAvoidsExpandedInspector = {
      result: 'PASS',
      inspectorAwareFit,
      editorStateUnchanged: true,
    };
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-inspector-close"]', 'Close the compact Part inspector after the content-fit check');

    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-zoom-out"]', 'Move the selected Part away from the viewport edge');
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-zoom-out"]', 'Keep the scale handle inside the viewport');
    await pause(180);
    const cameraBeforeScaleHandle = await readCamera(mainWindow);
    const scaleHandlePoint = await page(mainWindow, `(() => {
      const handle = document.querySelector('[data-testid="adaptive-parts-assembly-selection-outline"][data-part-id="${ids.frontPart}"] .adaptive-parts-assembly-scale-handle');
      if (!handle) return null;
      window.__issue963ScalePointerDown = null;
      handle.addEventListener('pointerdown', (event) => {
        window.__issue963ScalePointerDown = { trusted: event.isTrusted, button: event.button, pointerId: event.pointerId };
      }, { once: true });
      const rect = handle.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return {
        x,
        y,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        hit: document.elementFromPoint(x, y)?.className ?? null,
        hitTestId: document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null,
        selectedPartIds: [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected')].map((element) => element.dataset.partId),
      };
    })()`);
    const frontTransformBeforeScaleHandle = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    assert(scaleHandlePoint, 'Selected Part scale handle was unavailable.');
    assert(scaleHandlePoint.hit?.includes('adaptive-parts-assembly-scale-handle'), `The scale handle was occluded at its test point: ${JSON.stringify(scaleHandlePoint)}`);
    await pointerDrag(mainWindow, scaleHandlePoint, { x: scaleHandlePoint.x + 12, y: scaleHandlePoint.y + 10 });
    const frontTransformAfterScaleHandle = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    const scalePointerResult = await page(mainWindow, 'window.__issue963ScalePointerDown');
    assert(frontTransformAfterScaleHandle !== frontTransformBeforeScaleHandle, `The lower-right scale handle did not resize the selected Part: ${JSON.stringify({ scaleHandlePoint, frontTransformBeforeScaleHandle, frontTransformAfterScaleHandle, scalePointerResult })}`);
    receipt.checks.scaleHandlePriority = { result: 'PASS', before: frontTransformBeforeScaleHandle, after: frontTransformAfterScaleHandle };

    const frontPartTransformBeforeCameraDrag = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    const editorStateBeforeCameraDrag = await readEditorState(mainWindow);
    const frontPartCameraDragPoint = await sourcePixelPoint(mainWindow, ids.frontPart, 256.5, 128.5);
    await pointerDrag(mainWindow, frontPartCameraDragPoint, { x: frontPartCameraDragPoint.x + 18, y: frontPartCameraDragPoint.y + 11 });
    const frontPartTransformAfterCameraDrag = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    const editorStateAfterCameraDrag = await readEditorState(mainWindow);
    assert(
      frontPartTransformAfterCameraDrag !== frontPartTransformBeforeCameraDrag &&
      JSON.stringify(editorStateAfterCameraDrag) === JSON.stringify(editorStateBeforeCameraDrag),
      `Dragging a Part after zoom and pan did not move the Part draft cleanly: ${JSON.stringify({ frontPartTransformBeforeCameraDrag, frontPartTransformAfterCameraDrag, editorStateBeforeCameraDrag, editorStateAfterCameraDrag })}`,
    );
    receipt.checks.dragAfterZoomAndPan = {
      result: 'PASS',
      cssPoint: frontPartCameraDragPoint,
      before: frontPartTransformBeforeCameraDrag,
      after: frontPartTransformAfterCameraDrag,
      projectStateUnchangedUntilApply: true,
    };
    receipt.screenshots.push(await capture(mainWindow, 'ux02-zoom-pan-inspector.png'));

    const stateBeforeApply = await readEditorState(mainWindow);
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply the selected sleeve scale draft');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect()?.revision === ${stateBeforeApply.revision + 1}`, 'Applying the Part scale draft did not create one Project revision.');
    const stateAfterApply = await readEditorState(mainWindow);
    const cameraAfterApply = await readCamera(mainWindow);
    assert(stateAfterApply.dirty && stateAfterApply.undoCount === stateBeforeApply.undoCount + 1, 'Apply did not create exactly one dirty Project History entry.');
    assert(Math.abs(cameraAfterApply.scale - cameraBeforeScaleHandle.scale) < 0.0001, 'Applying a Part edit discarded the current camera session.');
    receipt.checks.applyKeepsCamera = { result: 'PASS', stateBeforeApply, stateAfterApply, cameraBeforeScaleHandle, cameraAfterApply };

    const appliedPartAdjustment = await readAdaptivePartAdjustment(mainWindow, ids.character, ids.frontPart);
    assert(appliedPartAdjustment, 'The applied Adaptive Part adjustment was unavailable in the formal Project snapshot.');
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open the Part inspector for a pending Cancel draft');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-inspector-fields"]')`, 'Part inspector did not reopen for the pending Cancel draft.');
    const frontTransformBeforeCancelDraft = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-offset-x-step-up"]', 'Create an uncommitted offset draft');
    const frontTransformBeforeCancel = await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${ids.frontPart}"]')?.style.transform ?? null`);
    assert(frontTransformBeforeCancel !== frontTransformBeforeCancelDraft, 'The inspector step did not create a pending assembly draft for Cancel.');
    const stateBeforeCancel = await readEditorState(mainWindow);
    await page(mainWindow, 'window.confirm = () => true; true');
    await clickSelector(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Confirm discarding the pending Part draft');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Assembly Cancel did not close after confirming the pending draft discard.');
    const stateAfterCancel = await readEditorState(mainWindow);
    const partAdjustmentAfterCancel = await readAdaptivePartAdjustment(mainWindow, ids.character, ids.frontPart);
    assert(
      JSON.stringify(stateAfterCancel) === JSON.stringify(stateBeforeCancel) &&
      JSON.stringify(partAdjustmentAfterCancel) === JSON.stringify(appliedPartAdjustment),
      `Cancel changed the applied Project while discarding the later draft: ${JSON.stringify({ stateBeforeCancel, stateAfterCancel, appliedPartAdjustment, partAdjustmentAfterCancel })}`,
    );
    receipt.checks.cancelDiscardsPendingDraft = {
      result: 'PASS',
      stateAfterApply,
      stateBeforeCancel,
      stateAfterCancel,
      appliedPartAdjustment,
      partAdjustmentAfterCancel,
      draftTransformBeforeCancel: frontTransformBeforeCancel,
      projectStateUnchanged: true,
    };

    receipt.status = 'ISSUE963_SYNTHETIC_ELECTRON_PASS';
    receipt.completedAt = new Date().toISOString();
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  } catch (error) {
    receipt.status = 'ISSUE963_SYNTHETIC_ELECTRON_FAIL';
    receipt.failedAt = new Date().toISOString();
    receipt.error = error instanceof Error ? error.stack ?? error.message : String(error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        receipt.failureUi = await page(mainWindow, `(() => ({
          title: document.title,
          bodyText: document.body.innerText.slice(0, 2_000),
          projectCenterOpen: document.querySelector('[data-testid="project-center-screen"]')?.dataset.projectOpen ?? null,
          editorLayoutPresent: Boolean(document.querySelector('[data-testid="editor-layout"]')),
          editorStatus: document.querySelector('[role="status"]')?.textContent?.trim() ?? null,
        }))()`);
        receipt.failureScreen = await capture(mainWindow, 'failure-screen.png');
      } catch (captureError) {
        receipt.failureScreenshotError = captureError instanceof Error ? captureError.message : String(captureError);
      }
    }
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }
}

main()
  .then((receipt) => {
    process.stdout.write(`${JSON.stringify({ status: receipt.status, evidenceRoot, resultPath }, null, 2)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[issue963-c3-hit-camera] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  });
