'use strict';

const { app, ipcMain, nativeImage, screen } = require('electron');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  CharacterService,
  LayerService,
  ProjectSchema,
  ShotService,
  PROJECT_SCHEMA_VERSION,
} = require('../dist-electron/domain/index.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { AssetImportService } = require('../dist-electron/main/services/AssetImportService.js');
const { ExportPreparationService, MainProjectAssetReader } = require('../dist-electron/main/services/ExportPreparationService.js');
const { NodeExportPreparationFileStore } = require('../dist-electron/main/services/ExportPreparationFileStore.js');
const { ExportService } = require('../dist-electron/main/services/ExportService.js');
const { FileSystemService } = require('../dist-electron/main/services/FileSystemService.js');
const { FFmpegAdapter } = require('../dist-electron/main/services/FFmpegAdapter.js');
const { resolveMediaToolPaths } = require('../dist-electron/main/services/production-resources.js');
const { HiddenWindowManager } = require('../dist-electron/main/windows/hidden-window-manager.js');
const { registerIpcHandlers } = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const { registerExportPreparationIpcHandlers } = require('../dist-electron/main/ipc/register-export-preparation-ipc-handlers.js');
const {
  bodyArmOverlayArgs,
  orderedBodyArmRecords,
} = require('./issue899-c0-body-arm-overlay.cjs');

const issue901UiA = process.argv.includes('--issue901-ui-a');
const issue903BackProbe = process.env.PANDA_STAGE_ISSUE903_BACK_PROBE === '1';
const issue903BackProbeBaseline = process.env.PANDA_STAGE_ISSUE903_BACK_BASELINE === '1';
const issue903BackBaselineReceiptPath = process.env.PANDA_STAGE_ISSUE903_BACK_BASELINE_RECEIPT;
const sourceDir = process.env.PANDA_STAGE_ISSUE901_SOURCE_DIR ?? process.env.PANDA_STAGE_ISSUE899_SOURCE_DIR;
const acceptanceRoot = issue903BackProbe
  ? process.env.PANDA_STAGE_ISSUE903_ROOT ?? 'D:\\PandaStage-Acceptance\\issue903-back-probe'
  : issue901UiA
    ? process.env.PANDA_STAGE_ISSUE901_ROOT ?? 'D:\\PandaStage-Acceptance\\issue901-ui-a'
    : process.env.PANDA_STAGE_ISSUE899_ROOT ?? 'D:\\PandaStage-Acceptance\\issue899-c3';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const cropRoot = path.join(runRoot, 'source-crops');
const projectRoot = path.join(runRoot, 'projects', 'c0-adaptive-parts.pandastage');
const outputPath = path.join(runRoot, 'c0-adaptive-parts-edited-6s.mp4');
const resultPath = path.join(
  runRoot,
  issue903BackProbe
    ? 'issue903-back-probe-receipt.json'
    : issue901UiA
      ? 'issue901-ui-a-receipt.json'
      : 'issue899-c3-v0-receipt.json',
);
const sourceRootTransform = { a: 1, b: 0, c: 0, d: 1, tx: 790, ty: 47.6 };
const sourceRestTransform = { a: 1, b: 0, c: 0, d: 1, tx: -790, ty: -47.6 };
const sampleTimes = [
  { name: 'start', timeMs: 0, frame: 0 },
  { name: 'middle', timeMs: 3_000, frame: 72 },
  { name: 'end', timeMs: 5_900, frame: 142 },
];
const sourceRecords = [
  {
    sourceId: 'c0/com6', sourceName: 'com6', fileName: 'layer-04-com6.png', drawOrder: 0,
    sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 191.1, ty: 424.75 },
  },
  {
    sourceId: 'c0/com2', sourceName: 'com2', fileName: 'layer-03-com2.png', drawOrder: 1,
    sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 396.3 },
  },
  {
    sourceId: 'c0/com5', sourceName: 'com5', fileName: 'layer-02-com5.png', drawOrder: 2,
    sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 167.05, ty: 665.2 },
  },
  {
    sourceId: 'c0/com4', sourceName: 'com4', fileName: 'layer-01-com4.png', drawOrder: 3,
    sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 151.7, ty: 191.1 },
  },
  {
    sourceId: 'c0/com3', sourceName: 'com3', fileName: 'layer-00-com3.png', drawOrder: 4,
    sourceMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 230.2, ty: 669.7 },
  },
];

let mainWindow = null;
let currentVerifierAction = null;
const rendererDiagnostics = [];
let hiddenWindowManager = null;
let exportService = null;
let exportPreparationService = null;
let exportFileSystem = null;
let activeExportPromise = null;
let trackedSnapshot = null;
let activeProject = null;
let adaptiveCharacterId = null;
let singleImageCharacterId = null;
let bodyArmCharacterId = null;
let bodyArmPartId = null;
let longListCharacterId = null;
const registeredChannels = [];
const jobUpdates = [];
const electronAppDiagnostics = [];
const assetBytes = new Map();
const assetCanvasImageReadCounts = new Map();

process.env.VITE_DEV_SERVER_URL = '';
app.setPath('userData', path.join(runRoot, 'electron-user-data'));
app.on('window-all-closed', () => {});
app.on('before-quit', () => electronAppDiagnostics.push({ kind: 'app-before-quit' }));
app.on('will-quit', () => electronAppDiagnostics.push({ kind: 'app-will-quit' }));

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
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
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

function encodeSolidPng(width, height, color) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
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

function encodeMaskedOverlayPng(width, height, color, opaquePixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const opaque = new Set(opaquePixels.map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = opaque.has(`${x},${y}`) ? color[3] : 0;
    }
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

function encodeSyntheticBodyArmPng() {
  const width = 320;
  const height = 440;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const torso = [[92, 42], [221, 42], [268, 420], [49, 420]];
  const arm = [[102, 122], [166, 143], [34, 318], [8, 284]];
  const inside = (polygon, x, y) => {
    let included = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
      const [currentX, currentY] = polygon[current];
      const [previousX, previousY] = polygon[previous];
      const intersects = ((currentY > y) !== (previousY > y)) &&
        (x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX);
      if (intersects) included = !included;
    }
    return included;
  };
  const silhouette = (x, y) => inside(torso, x, y) || inside(arm, x, y);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      if (!silhouette(x, y)) continue;
      const offset = rowOffset + 1 + x * 4;
      const edge = !silhouette(x - 3, y) || !silhouette(x + 3, y) ||
        !silhouette(x, y - 3) || !silhouette(x, y + 3);
      const sleeve = inside(arm, x, y) && !inside(torso, x, y);
      const color = edge ? [28, 37, 52] : sleeve ? [49, 76, 124] : [78, 108, 163];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
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

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function page(window, script) {
  return window.webContents.executeJavaScript(script, true);
}

function browserWait(expression, message, timeout = 30_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try { if (${expression}) return true; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitFor(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(browserWait(expression, message, timeout));
}

async function click(window, selector, label = selector) {
  currentVerifierAction = label;
  await waitFor(window, `document.querySelector(${JSON.stringify(selector)})`, `${label} did not appear.`);
  const point = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', disabled: Boolean(element.disabled) };
  })()`);
  assert(point.visible && !point.disabled, `${label} is not available for input: ${JSON.stringify(point)}`);
  await page(window, `document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(80);
}

async function expandProjectActions(window) {
  await page(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`, 'Project actions drawer did not expand.');
}

async function collapseProjectActions(window) {
  await page(window, `(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded === 'true') drawer.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'false'`, 'Project actions drawer did not collapse.');
}

async function ensureCharacterListReady(window, characterRail, characterList, label) {
  if (!(await page(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`))) {
    await click(window, characterRail, `${label}: open Character drawer`);
    await waitFor(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`, `${label}: Character drawer did not open.`);
  }
  const isVisible = (selector) => page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element?.getBoundingClientRect();
    const style = element ? getComputedStyle(element) : null;
    return Boolean(rect?.width && rect.height && style?.display !== 'none' && style?.visibility !== 'hidden');
  })()`);
  const activeSubview = await page(window, `document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview ?? null`);
  if (activeSubview !== 'list' && await isVisible('[data-testid="adaptive-parts-back-to-list"]')) {
    await click(window, '[data-testid="adaptive-parts-back-to-list"]', `${label}: return to Character list`);
    await waitFor(window, `document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview === 'list'`, `${label}: Character detail did not return to the list.`);
  }
  await waitFor(window, `(() => {
    const list = document.querySelector(${JSON.stringify(characterList)});
    const rect = list?.getBoundingClientRect();
    const style = list ? getComputedStyle(list) : null;
    return Boolean(rect?.width && rect.height && style?.display !== 'none' && style?.visibility !== 'hidden');
  })()`, `${label}: Character list is not visible.`);
}

async function waitForAdaptiveAssemblyDrawerHidden(window, label) {
  await waitFor(window, `(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
    const style = surface ? getComputedStyle(surface) : null;
    return dock?.dataset.resourceDrawerOpen === 'true' &&
      style?.visibility === 'hidden' && Number(style.opacity) < 0.01;
  })()`, label);
}

async function captureWhole(window, fileName) {
  await page(window, 'Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), new Promise((resolve) => setTimeout(resolve, 300))])');
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, fileName);
  await fsp.writeFile(target, image.toPNG());
  return target;
}

async function captureCanvas(window, selector, fileName) {
  await page(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const capture = await page(window, `(() => {
    const host = document.querySelector(${JSON.stringify(selector)});
    if (!host) throw new Error('Rendered surface is missing.');
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Rendered surface has no visible area.');
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      stageData: {
        renderedAssetIds: JSON.parse(host.dataset.renderedAssetIds ?? '[]'),
        incompleteVisualLayerIds: JSON.parse(host.dataset.incompleteVisualLayerIds ?? '[]'),
        layerJson: JSON.parse(host.dataset.layerJson ?? '[]'),
        currentTimeMs: Number(host.dataset.currentTimeMs ?? host.dataset.stageTime ?? 0),
        stageReady: host.dataset.stageReady ?? null,
        displayReady: host.dataset.stageDisplayReady ?? null,
        stageError: host.dataset.stageError ?? null,
      },
    };
  })()`);
  if (!capture?.rect) throw new Error(`Rendered surface capture failed for ${selector}.`);
  const fullImage = await window.webContents.capturePage();
  const fullImageSize = fullImage.getSize();
  const scaleX = fullImageSize.width / capture.viewport.width;
  const scaleY = fullImageSize.height / capture.viewport.height;
  const cropRect = {
    x: Math.max(0, Math.floor(capture.rect.x * scaleX)),
    y: Math.max(0, Math.floor(capture.rect.y * scaleY)),
    width: Math.ceil(capture.rect.width * scaleX),
    height: Math.ceil(capture.rect.height * scaleY),
  };
  const image = fullImage.crop(cropRect);
  const imageSize = image.getSize();
  const target = path.join(evidenceRoot, fileName);
  await fsp.writeFile(target, image.toPNG());
  return {
    width: imageSize.width,
    height: imageSize.height,
    cssRect: capture.rect,
    cropRect,
    fullImageSize,
    path: target,
    stageData: capture.stageData,
  };
}

async function setInputValue(window, selector, value) {
  await page(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(window, `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(String(value))}`, `Input did not accept ${value}: ${selector}`);
}

async function dragPart(window, partId, dx, dy) {
  const selector = `[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${partId}"]`;
  const rect = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Selected Part canvas target is unavailable.');
    const rect = element.getBoundingClientRect();
    const fractions = [0.15, 0.3, 0.5, 0.7, 0.85];
    for (const fy of fractions) for (const fx of fractions) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit === element || element.contains(hit)) return { x, y, width: rect.width, height: rect.height };
    }
    throw new Error('Selected Part has no exposed canvas pixel for dragging.');
  })()`);
  assert(rect.width > 12 && rect.height > 12, `Part canvas bounds are too small for a real drag: ${JSON.stringify(rect)}.`);
  const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const dpr = await page(window, 'window.devicePixelRatio');
  const factor = dpr / displayScale;
  const from = { x: Math.round(rect.x * factor), y: Math.round(rect.y * factor) };
  const to = { x: Math.round((rect.x + dx) * factor), y: Math.round((rect.y + dy) * factor) };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...from });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'mouseMove', ...to });
  await pause(80);
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to });
  await pause(120);
  return { cssStart: { x: rect.x, y: rect.y }, cssDelta: { x: dx, y: dy }, inputFactor: factor };
}

async function scalePart(window, partId, dx, dy) {
  const selector = `[data-testid="adaptive-parts-assembly-selection-outline"][data-part-id="${partId}"] .adaptive-parts-assembly-scale-handle`;
  const rect = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Selected Part scale handle is unavailable.');
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const dpr = await page(window, 'window.devicePixelRatio');
  const factor = dpr / displayScale;
  const from = { x: Math.round(rect.x * factor), y: Math.round(rect.y * factor) };
  const to = { x: Math.round((rect.x + dx) * factor), y: Math.round((rect.y + dy) * factor) };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...from });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'mouseMove', ...to });
  await pause(80);
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to });
  await pause(120);
  return { cssStart: { x: rect.x, y: rect.y }, cssDelta: { x: dx, y: dy }, inputFactor: factor };
}

async function verifyAssemblyOcclusionPixel(window, character) {
  await page(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const geometry = await page(window, `(() => {
    const stage = document.querySelector('.adaptive-parts-assembly-viewport .character-assembly-preview-stage');
    if (!stage) throw new Error('Adaptive assembly Stage is unavailable.');
    const stageRect = stage.getBoundingClientRect();
    const stageScale = Number(stage.style.transform.match(/^scale\\(([^)]+)\\)$/)?.[1] ?? 0);
    const order = new Map([...document.querySelectorAll('.adaptive-parts-assembly-row')]
      .map((row) => [row.dataset.partId, Number(row.dataset.drawOrder)]));
    const parts = [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')]
      .map((element) => ({ element, id: element.dataset.partId, drawOrder: order.get(element.dataset.partId), rect: element.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) {
      const first = parts[i]; const second = parts[j];
      const left = Math.max(first.rect.left, second.rect.left) + 8;
      const top = Math.max(first.rect.top, second.rect.top) + 8;
      const right = Math.min(first.rect.right, second.rect.right) - 8;
      const bottom = Math.min(first.rect.bottom, second.rect.bottom) - 8;
      const area = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (area < 64) continue;
      const rear = first.drawOrder < second.drawOrder ? first : second;
      const front = rear === first ? second : first;
      const inversePoint = (part, x, y) => {
        const matrix = new DOMMatrix(part.element.style.transform).inverse();
        const stagePoint = new DOMPoint((x - stageRect.left) / stageScale, (y - stageRect.top) / stageScale);
        const local = matrix.transformPoint(stagePoint);
        return { x: local.x, y: local.y, width: part.element.clientWidth, height: part.element.clientHeight };
      };
      const samples = [];
      for (let y = top; y < bottom && samples.length < 160; y += 7) for (let x = left; x < right && samples.length < 160; x += 7) {
        const rearPoint = inversePoint(rear, x, y);
        const frontPoint = inversePoint(front, x, y);
        if ([rearPoint, frontPoint].every((point) => point.x > 5 && point.y > 5 && point.x < point.width - 8 && point.y < point.height - 8)) {
          samples.push({ x, y, rearPoint, frontPoint });
        }
      }
      if (samples.length) overlaps.push({ area, rearPartId: rear.id, frontPartId: front.id, samples });
    }
    overlaps.sort((left, right) => right.area - left.area);
    return { viewport: { width: window.innerWidth, height: window.innerHeight }, overlaps };
  })()`);
  const overlap = geometry.overlaps[0];
  assert(overlap, 'The source C0 assembly has no two-Part image overlap to verify.');
  const sourceByPartId = new Map(character.parts.map((part) => [part.partId, part]));
  const alphaAt = (assetId, point) => {
    const bytes = assetBytes.get(assetId);
    assert(bytes, `Source image bytes are unavailable for Asset ${assetId}.`);
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const x = Math.max(0, Math.min(size.width - 1, Math.floor((point.x / point.width) * size.width)));
    const y = Math.max(0, Math.min(size.height - 1, Math.floor((point.y / point.height) * size.height)));
    return bitmap[(y * size.width + x) * 4 + 3];
  };
  const opaqueSample = overlap.samples.find((sample) =>
    alphaAt(sourceByPartId.get(overlap.rearPartId).assetId, sample.rearPoint) > 245 &&
    alphaAt(sourceByPartId.get(overlap.frontPartId).assetId, sample.frontPoint) > 245,
  );
  assert(opaqueSample, `No opaque source-pixel overlap was found for Parts ${overlap.rearPartId} and ${overlap.frontPartId}.`);

  const frontRow = `.adaptive-parts-assembly-row[data-part-id="${overlap.frontPartId}"] [data-testid="adaptive-parts-assembly-row-select"]`;
  const rearRow = `.adaptive-parts-assembly-row[data-part-id="${overlap.rearPartId}"] [data-testid="adaptive-parts-assembly-row-select"]`;
  await click(window, frontRow, 'Select the front overlapping C0 Part');
  const frontSelected = await page(window,
    `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${overlap.frontPartId}"]')?.classList.contains('is-selected')`);
  assert(frontSelected, 'The front overlapping C0 Part did not become selected.');
  const before = await window.webContents.capturePage();
  await fsp.writeFile(path.join(evidenceRoot, 'c3-overlap-front-selected.png'), before.toPNG());
  await click(window, rearRow, 'Select the rear overlapping C0 Part');
  const rearSelected = await page(window,
    `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${overlap.rearPartId}"]')?.classList.contains('is-selected')`);
  assert(rearSelected, 'The rear overlapping C0 Part did not become selected.');
  const after = await window.webContents.capturePage();
  await fsp.writeFile(path.join(evidenceRoot, 'c3-overlap-rear-selected.png'), after.toPNG());
  const pixel = (image, point) => {
    const size = image.getSize();
    const scaleX = size.width / geometry.viewport.width;
    const scaleY = size.height / geometry.viewport.height;
    const x = Math.max(0, Math.min(size.width - 1, Math.floor(point.x * scaleX)));
    const y = Math.max(0, Math.min(size.height - 1, Math.floor(point.y * scaleY)));
    const bitmap = image.toBitmap();
    const offset = (y * size.width + x) * 4;
    return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset], bitmap[offset + 3]];
  };
  const beforeRgba = pixel(before, opaqueSample);
  const afterRgba = pixel(after, opaqueSample);
  assert(JSON.stringify(beforeRgba) === JSON.stringify(afterRgba),
    `Selecting rear Part ${overlap.rearPartId} changed the overlapping front pixel: ${JSON.stringify({ beforeRgba, afterRgba })}.`);
  return {
    result: 'PASS',
    rearPartId: overlap.rearPartId,
    frontPartId: overlap.frontPartId,
    sampleCssPoint: { x: opaqueSample.x, y: opaqueSample.y },
    sourceAlpha: {
      rear: alphaAt(sourceByPartId.get(overlap.rearPartId).assetId, opaqueSample.rearPoint),
      front: alphaAt(sourceByPartId.get(overlap.frontPartId).assetId, opaqueSample.frontPoint),
    },
    pixelBefore: beforeRgba,
    pixelAfter: afterRgba,
    screenshots: ['c3-overlap-front-selected.png', 'c3-overlap-rear-selected.png'],
  };
}

async function clickPoint(window, selector, label = selector) {
  currentVerifierAction = label;
  await waitFor(window, "document.querySelector(" + JSON.stringify(selector) + ")", label + " did not appear.");
  const target = await page(window,
    "(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); " +
    "const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); " +
    "const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); " +
    "return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, " +
    "width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility, " +
    "disabled: Boolean(element.disabled), hitTestedWithinTarget: Boolean(hit && (hit === element || element.contains(hit))) }; })()");
  assert(target.width > 0 && target.height > 0 && target.display !== 'none' &&
    target.visibility === 'visible' && !target.disabled && target.hitTestedWithinTarget,
  label + " has no usable pointer target: " + JSON.stringify(target));
  const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const dpr = await page(window, 'window.devicePixelRatio');
  const factor = dpr / displayScale;
  const point = { x: Math.round(target.x * factor), y: Math.round(target.y * factor) };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  await pause(30);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(100);
  return {
    cssPoint: { x: target.x, y: target.y },
    targetSize: { width: target.width, height: target.height },
    hitTestedWithinTarget: target.hitTestedWithinTarget,
    inputFactor: factor,
  };
}

async function inspectAssemblyViewport(window) {
  return page(window,
    "(() => { const rect = (node) => { if (!node) return null; const bounds = node.getBoundingClientRect(); " +
    "return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }; }; " +
    "const root = document.querySelector('[data-testid=\"adaptive-parts-assembly-workbench\"]'); " +
    "const list = document.querySelector('.adaptive-parts-assembly-list'); " +
    "const viewport = document.querySelector('[data-testid=\"adaptive-parts-assembly-canvas\"]'); " +
    "const stage = viewport?.querySelector('.character-assembly-preview-stage'); " +
    "const rows = [...document.querySelectorAll('.adaptive-parts-assembly-row')]; " +
    "const footer = document.querySelector('.adaptive-parts-assembly-footer'); " +
    "const inspector = document.querySelector('.adaptive-parts-assembly-inspector'); " +
    "const scale = Number(stage?.style.transform.match(/^scale\\(([^)]+)\\)$/)?.[1] ?? 0); " +
    "return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio, " +
    "shellMode: document.querySelector('[data-testid=\"editor-layout\"]')?.dataset.shellMode ?? null, " +
    "workbench: rect(root), list: rect(list), viewport: rect(viewport), footer: rect(footer), inspector: rect(inspector), stageScale: scale, " +
    "parts: [...(viewport?.querySelectorAll('[data-testid=\"adaptive-parts-assembly-canvas-part\"]') ?? [])].map((part) => ({ partId: part.dataset.partId, ...rect(part) })), " +
    "rows: rows.map((row) => { const bounds = row.getBoundingClientRect(); const hitTarget = row.querySelector('[data-testid=\"adaptive-parts-assembly-row-select\"]') ?? row; " +
    "const hitBounds = hitTarget.getBoundingClientRect(); const target = document.elementFromPoint(hitBounds.left + hitBounds.width / 2, hitBounds.top + hitBounds.height / 2); " +
    "const style = getComputedStyle(row); return { partId: row.dataset.partId, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, " +
    "visible: style.display !== 'none' && style.visibility === 'visible', hitTestedWithinRow: Boolean(target && row.contains(target)), " +
    "insideWindow: bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight }; }), " +
    "footerButtons: [...(footer?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText.trim(), ...rect(button) })) }; })()");
}

async function touchDragPart(window, partId, dx, dy) {
  const selector = '[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="' + partId + '"]';
  const target = await page(window,
    "(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) return null; " +
    "const bounds = element.getBoundingClientRect(); const fractions = [0.15, 0.3, 0.5, 0.7, 0.85]; " +
    "for (const fy of fractions) for (const fx of fractions) { const x = bounds.left + bounds.width * fx; const y = bounds.top + bounds.height * fy; " +
    "const hit = document.elementFromPoint(x, y); const hitPartId = hit?.closest('[data-testid=\"adaptive-parts-assembly-canvas-part\"]')?.dataset.partId ?? null; " +
    "if (hitPartId === element.dataset.partId) return { x, y, width: bounds.width, height: bounds.height, hitPartId }; } " +
    "return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, width: bounds.width, height: bounds.height, hitPartId: null }; })()");
  assert(target && target.width > 12 && target.height > 12 && target.hitPartId === partId,
    "Touch drag target is clipped or covered: " + JSON.stringify(target));
  await page(window,
    "(() => { window.__pandaStageIssue899TouchTrace = []; const host = document.querySelector('[data-testid=\"adaptive-parts-assembly-canvas\"]'); " +
    "for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) host?.addEventListener(type, (event) => { " +
    "window.__pandaStageIssue899TouchTrace.push({ type: event.type, pointerType: event.pointerType, x: event.clientX, y: event.clientY, " +
    "partId: event.target?.closest('[data-testid=\"adaptive-parts-assembly-canvas-part\"]')?.dataset.partId ?? null }); }, true); })()");
  const debuggerApi = window.webContents.debugger;
  const attachedBefore = debuggerApi.isAttached();
  let disableTouchError = null;
  if (!attachedBefore) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: target.x, y: target.y, id: 1, force: 1 }],
    });
    await pause(70);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: target.x + dx, y: target.y + dy, id: 1, force: 1 }],
    });
    await pause(100);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(140);
  } finally {
    try {
      await debuggerApi.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    } catch (error) {
      disableTouchError = error;
    }
    if (!attachedBefore && debuggerApi.isAttached()) debuggerApi.detach();
  }
  if (disableTouchError && debuggerApi.isAttached()) throw disableTouchError;
  const events = await page(window, 'window.__pandaStageIssue899TouchTrace ?? []');
  return { cssStart: { x: target.x, y: target.y }, cssDelta: { x: dx, y: dy }, events };
}

async function inspect(window) {
  return page(window, 'window.__pandaStageIssue816Acceptance?.inspect?.() ?? null');
}

async function inspectAdaptivePartsDraft(window) {
  return page(window, `(() => {
    const rows = [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')].map((row) => ({
      partId: row.dataset.partId ?? null,
      name: row.querySelector('.adaptive-parts-assembly-name')?.textContent?.trim() ?? '',
      visible: row.querySelector('[data-testid="adaptive-parts-visibility-toggle"]')?.getAttribute('aria-pressed') === 'true',
    }));
    const fieldIds = ['adaptive-parts-offset-x','adaptive-parts-offset-y','adaptive-parts-scale-percent','adaptive-parts-rotation-deg'];
    return {
      rows,
      selectedPartId: document.querySelector('[data-testid="adaptive-parts-assembly-row-select"][aria-pressed="true"]')?.closest('[data-testid="adaptive-parts-assembly-row"]')?.dataset.partId ?? null,
      values: Object.fromEntries(fieldIds.map((id) => [id, document.querySelector('[data-testid="' + id + '"]')?.value ?? null])),
      applyDisabled: document.querySelector('[data-testid="adaptive-parts-assembly-apply"]')?.disabled ?? null,
    };
  })()`);
}

async function openProject(window) {
  const selector = '[data-testid="project-center-screen"] .recovery-open-row input';
  await waitFor(window, `document.querySelector(${JSON.stringify(selector)})`, 'Project Center did not render its project path input.');
  await page(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitFor(window, `document.querySelector('[data-testid="editor-layout"]')`, 'The local C0 Project did not open in the production editor.');
  await waitFor(window, `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`, 'The editor Canvas viewport did not finish measuring.');
  await waitFor(window, `window.__pandaStageIssue816Acceptance?.inspect?.()?.project?.id`, 'The editor did not expose its active Project snapshot.');
}

async function sendKey(window, keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  await pause(35);
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(80);
}

async function replaceInputText(window, selector, text) {
  await page(window, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); input?.focus(); input?.select(); })()`);
  await sendKey(window, 'A', ['control']);
  if (text) window.webContents.insertText(text);
  else await sendKey(window, 'Backspace');
  await pause(120);
}

async function renameAdaptivePart(window, rowSelector, nextName, screenshotName) {
  const pointer = await clickPoint(window, `${rowSelector} [data-testid="adaptive-parts-rename-button"]`, 'Start inline Part rename');
  const input = '[data-testid="adaptive-parts-rename-input"]';
  await waitFor(window, `document.querySelector(${JSON.stringify(input)})`, 'Inline Part rename input did not appear.');
  await replaceInputText(window, input, nextName);
  if (screenshotName) await captureWhole(window, screenshotName);
  await sendKey(window, 'Return');
  await waitFor(window, `(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)});
    return row?.querySelector('.adaptive-parts-assembly-name')?.textContent?.trim() === ${JSON.stringify(nextName)};
  })()`, 'Inline Part rename did not commit with Enter.');
  return pointer;
}

async function verifyIssue903BackProbe(window) {
  const characterRail = '[data-testid="resource-activity-rail-characters"]';
  const characterList = '[data-testid="character-list-view"]';
  const adaptiveCard = `[data-character-id="${adaptiveCharacterId}"]`;
  const backSelector = '[data-testid="adaptive-parts-back-to-list"]';
  const originalWindowSize = window.getSize();
  window.setSize(880, 760);
  await pause(450);
  await waitFor(window, 'window.innerWidth <= 900 && window.innerWidth >= 800', 'The Back probe did not enter the narrow 880px viewport.');
  const viewport = await page(window, '({ width: window.innerWidth, height: window.innerHeight })');

  await clickPoint(window, characterRail, 'Open Characters for top-Back diagnosis');
  await waitFor(window, `(() => {
    const list = document.querySelector(${JSON.stringify(characterList)});
    const rect = list?.getBoundingClientRect();
    const style = list ? getComputedStyle(list) : null;
    return Boolean(rect?.width && rect.height && style?.display !== 'none' && style?.visibility !== 'hidden');
  })()`, 'Character list did not become visible before the Back probe.');

  const beforeOpen = await inspect(window);
  const drawerAtList = await page(window, `(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const panel = document.querySelector('[data-testid="resource-activity-panel"]');
    return { drawerOpen: dock?.dataset.resourceDrawerOpen ?? null, activeActivity: dock?.dataset.activeActivity ?? null, activeSubview: panel?.dataset.activeSubview ?? null };
  })()`);
  assert(drawerAtList.drawerOpen === 'true' && drawerAtList.activeActivity === 'characters' && drawerAtList.activeSubview === 'list', `The Character list was not open in the narrow Back-probe baseline: ${JSON.stringify(drawerAtList)}.`);
  await captureWhole(window, 'issue903-back-probe-before-open.png');
  const adaptiveCardPointer = await clickPoint(window, adaptiveCard, 'Open C0 Character for top-Back diagnosis');
  await waitFor(window, `(() => {
    const element = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]');
    const rect = element?.getBoundingClientRect();
    const style = element ? getComputedStyle(element) : null;
    return Boolean(rect?.width && rect.height && style?.display !== 'none' && style?.visibility !== 'hidden' && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
  })()`, 'The C0 Adaptive Parts workbench did not become visible for the Back probe.');
  await captureWhole(window, 'issue903-back-probe-workbench-at-880.png');
  const beforeBack = await inspect(window);
  const drawerAtWorkbench = await page(window, `(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const panel = document.querySelector('[data-testid="resource-activity-panel"]');
    return { drawerOpen: dock?.dataset.resourceDrawerOpen ?? null, activeActivity: dock?.dataset.activeActivity ?? null, activeSubview: panel?.dataset.activeSubview ?? null };
  })()`);
  assert(drawerAtWorkbench.drawerOpen === 'true' && drawerAtWorkbench.activeActivity === 'characters', `The assembly did not retain the narrow Character drawer: ${JSON.stringify(drawerAtWorkbench)}.`);
  const beforeControl = await page(window, `(() => {
    const element = document.querySelector(${JSON.stringify(backSelector)});
    const bounds = element?.getBoundingClientRect();
    const style = element ? getComputedStyle(element) : null;
    const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
    return {
      exists: Boolean(element),
      visible: Boolean(bounds?.width && bounds.height && style?.visibility === 'visible' && style?.display !== 'none'),
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
      hitTag: hit?.tagName ?? null,
      hitTestStack: bounds ? document.elementsFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2).slice(0, 6).map((node) => ({ tag: node.tagName, className: typeof node.className === 'string' ? node.className : '', testId: node.getAttribute('data-testid'), zIndex: getComputedStyle(node).zIndex })) : [],
      hitTestedWithinControl: Boolean(hit && element?.contains(hit)),
      workbenchBounds: (() => { const rect = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')?.getBoundingClientRect(); return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null; })(),
      headerBounds: (() => { const rect = document.querySelector('[data-testid="adaptive-parts-assembly-header"]')?.getBoundingClientRect(); return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null; })(),
      listBounds: (() => { const rect = document.querySelector('.adaptive-parts-assembly-list')?.getBoundingClientRect(); return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null; })(),
      activeActivity: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity ?? null,
      activeSubview: document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview ?? null,
      drawerOpen: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen ?? null,
    };
  })()`);
  assert(beforeControl.visible && beforeControl.width >= 44 && beforeControl.height >= 44 && beforeControl.hitTestedWithinControl, `Top Back was not a visible 44px hit target before the narrow probe: ${JSON.stringify(beforeControl)}.`);
  await captureWhole(window, 'issue903-back-probe-before-click.png');
  await page(window, `(() => {
    window.__pandaStageIssue903CleanConfirmCalls = [];
    window.confirm = (message) => {
      window.__pandaStageIssue903CleanConfirmCalls.push(String(message));
      return false;
    };
    window.__pandaStageIssue903RuntimeEvents = [];
    window.__pandaStageIssue903BackInteractions = [];
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const record = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      window.__pandaStageIssue903BackInteractions.push({
        kind: event.type,
        targetTestId: target?.dataset.testid ?? null,
        trusted: event.isTrusted,
        drawerOpen: dock?.dataset.resourceDrawerOpen ?? null,
      });
    };
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, record, true);
    if (dock && !window.__pandaStageIssue903DrawerObserver) {
      window.__pandaStageIssue903DrawerObserver = new MutationObserver((records) => {
        for (const entry of records) window.__pandaStageIssue903BackInteractions.push({
          kind: 'drawer-state-change',
          drawerOpen: dock.dataset.resourceDrawerOpen ?? null,
          oldValue: entry.oldValue,
        });
      });
      window.__pandaStageIssue903DrawerObserver.observe(dock, { attributes: true, attributeOldValue: true, attributeFilter: ['data-resource-drawer-open'] });
    }
    if (!window.__pandaStageIssue903RuntimeEventsInstalled) {
      window.__pandaStageIssue903RuntimeEventsInstalled = true;
      window.addEventListener('error', (event) => window.__pandaStageIssue903RuntimeEvents.push({ kind: 'error', message: event.message, filename: event.filename, line: event.lineno }));
      window.addEventListener('unhandledrejection', (event) => window.__pandaStageIssue903RuntimeEvents.push({ kind: 'unhandledrejection', reason: String(event.reason) }));
    }
    return true;
  })()`);
  const diagnosticsStart = rendererDiagnostics.length;
  const pointer = await clickPoint(window, backSelector, 'Coordinate-click top Back in a clean Adaptive Parts session at 880px');
  await pause(350);
  const returnListSettle = await page(window, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return Boolean(rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden' && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
    };
    return new Promise((resolve) => {
      const started = performance.now();
      const poll = () => {
        const lists = [...document.querySelectorAll(${JSON.stringify(characterList)})];
        const result = { elapsedMs: Math.round(performance.now() - started), visible: lists.some(visible), lists: lists.map((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { visible: visible(element), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility, opacity: style.opacity }; }) };
        if (result.visible || result.elapsedMs >= 2500) { resolve(result); return; }
        setTimeout(poll, 40);
      };
      poll();
    });
  })()`);

  const windowState = {
    destroyed: window.isDestroyed(),
    visible: window.isDestroyed() ? false : window.isVisible(),
    focused: window.isDestroyed() ? false : window.isFocused(),
    title: window.isDestroyed() ? null : window.getTitle(),
    webContentsDestroyed: window.isDestroyed() ? true : window.webContents.isDestroyed(),
  };
  let afterUi = null;
  let afterProject = null;
  let runtimeEvents = [];
  if (!windowState.destroyed && !windowState.webContentsDestroyed) {
    afterUi = await page(window, `(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return Boolean(rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden' && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight);
      };
      const listInstances = [...document.querySelectorAll(${JSON.stringify(characterList)})];
      const list = listInstances.find(visible) ?? listInstances[0] ?? null;
      const workbench = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]');
      const dock = document.querySelector('[data-testid="resource-activity-dock"]');
      const panel = document.querySelector('[data-testid="resource-activity-panel"]');
      const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
      const editorShell = document.querySelector('.editor-shell');
      const describe = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility, opacity: style.opacity };
      };
      const matchedVisibilityRules = (element) => {
        const matches = [];
        const visit = (rules) => {
          for (const rule of rules) {
            if (rule.cssRules) { visit(rule.cssRules); continue; }
            if (!rule.selectorText || !rule.style) continue;
            try {
              if (!element.matches(rule.selectorText)) continue;
              if (rule.style.visibility || rule.style.opacity || rule.style.pointerEvents) matches.push({ selector: rule.selectorText, visibility: rule.style.visibility || null, opacity: rule.style.opacity || null, pointerEvents: rule.style.pointerEvents || null });
            } catch {}
          }
        };
        for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
        return matches;
      };
      return {
        title: document.title,
        editorAssemblyState: { active: editorShell?.dataset.characterAssemblyActive ?? null, kind: editorShell?.dataset.characterAssemblyKind ?? null },
        editorAssemblySelectorMatch: Boolean(editorShell?.matches('.editor-shell[data-character-assembly-active="true"]')),
        editorShellLayout: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode ?? null,
        activeActivity: dock?.dataset.activeActivity ?? null,
        activeSubview: panel?.dataset.activeSubview ?? null,
        drawerOpen: dock?.dataset.resourceDrawerOpen ?? null,
        dockInstances: [...document.querySelectorAll('[data-testid="resource-activity-dock"]')].map((element) => ({ className: element.className, drawerOpen: element.dataset.resourceDrawerOpen, mode: element.dataset.resourceMode, hidden: element.closest('[hidden]') !== null, surfaceVisibility: element.querySelector('[data-testid="resource-activity-drawer"]') ? getComputedStyle(element.querySelector('[data-testid="resource-activity-drawer"]')).visibility : null })),
        visibleCharacterList: visible(list),
        characterListInstances: listInstances.map(describe),
        resourceSurface: describe(surface),
        resourceSurfaceInlineStyle: surface?.getAttribute('style') ?? null,
        resourceSurfaceComputedTransitions: surface ? { transition: getComputedStyle(surface).transition, animation: getComputedStyle(surface).animation, visibility: getComputedStyle(surface).visibility, opacity: getComputedStyle(surface).opacity, pointerEvents: getComputedStyle(surface).pointerEvents } : null,
        resourceSurfaceMatchedVisibilityRules: surface ? matchedVisibilityRules(surface) : [],
        resourceSurfaceAncestors: (() => { const chain = []; let node = surface; while (node && chain.length < 7) { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); chain.push({ tag: node.tagName, className: typeof node.className === 'string' ? node.className : '', testId: node.getAttribute('data-testid'), hidden: node.hidden, display: style.display, visibility: style.visibility, opacity: style.opacity, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } }); node = node.parentElement; } return chain; })(),
        workbenchPresent: Boolean(workbench),
        visibleAdaptiveWorkbench: visible(workbench),
        characterRows: list?.querySelectorAll('[data-character-id]').length ?? 0,
        bodyText: document.body.innerText.slice(0, 900),
        confirmCalls: window.__pandaStageIssue903CleanConfirmCalls ?? [],
        runtimeEvents: window.__pandaStageIssue903RuntimeEvents ?? [],
        interactions: window.__pandaStageIssue903BackInteractions ?? [],
      };
    })()`);
    afterUi.returnListSettle = returnListSettle;
    afterProject = await inspect(window);
    runtimeEvents = afterUi.runtimeEvents;
    afterUi.afterPaint = await page(window, `Promise.race([new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
      const list = document.querySelector(${JSON.stringify(characterList)});
      const style = (element) => element ? { visibility: getComputedStyle(element).visibility, opacity: getComputedStyle(element).opacity, pointerEvents: getComputedStyle(element).pointerEvents } : null;
      resolve({ framesReceived: true, surface: style(surface), list: style(list), animations: surface?.getAnimations().map((animation) => ({ playState: animation.playState, currentTime: animation.currentTime, transitionProperty: animation.transitionProperty ?? null })) ?? [] });
    }))), new Promise((resolve) => setTimeout(() => resolve({ framesReceived: false }), 400))])`);
    await captureWhole(window, 'issue903-back-probe-after-click.png');
  }
  let cssCascadeDiagnostics = null;
  if (!windowState.destroyed && !windowState.webContentsDestroyed) {
    const debuggerApi = window.webContents.debugger;
    const attachedBefore = debuggerApi.isAttached();
    try {
      if (!attachedBefore) debuggerApi.attach('1.3');
      await debuggerApi.sendCommand('DOM.enable');
      await debuggerApi.sendCommand('CSS.enable');
      const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const [{ nodeId: surfaceNodeId }, { nodeId: listNodeId }] = await Promise.all([
        debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-testid="resource-activity-drawer"]' }),
        debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-testid="character-list-view"]' }),
      ]);
      const [matched, computed, listComputed] = await Promise.all([
        debuggerApi.sendCommand('CSS.getMatchedStylesForNode', { nodeId: surfaceNodeId }),
        debuggerApi.sendCommand('CSS.getComputedStyleForNode', { nodeId: surfaceNodeId }),
        debuggerApi.sendCommand('CSS.getComputedStyleForNode', { nodeId: listNodeId }),
      ]);
      cssCascadeDiagnostics = {
        matchedRules: (matched.matchedCSSRules ?? []).map(({ rule, matchingSelectors }) => ({
          selectors: rule.selectorList?.selectors?.map((selector) => selector.text) ?? [],
          matchingSelectors,
          visibility: rule.style?.cssProperties?.find((property) => property.name === 'visibility')?.value ?? null,
          opacity: rule.style?.cssProperties?.find((property) => property.name === 'opacity')?.value ?? null,
          pointerEvents: rule.style?.cssProperties?.find((property) => property.name === 'pointer-events')?.value ?? null,
        })).filter((rule) => rule.visibility !== null || rule.opacity !== null || rule.pointerEvents !== null),
        computed: (computed.computedStyle ?? []).filter((property) => ['visibility', 'opacity', 'pointer-events'].includes(property.name)),
        listComputed: (listComputed.computedStyle ?? []).filter((property) => ['visibility', 'opacity', 'pointer-events'].includes(property.name)),
      };
    } catch (error) {
      cssCascadeDiagnostics = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (!attachedBefore && debuggerApi.isAttached()) debuggerApi.detach();
    }
    cssCascadeDiagnostics.postDebuggerRendererComputed = await page(window, `(() => {
      const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
      const list = document.querySelector(${JSON.stringify(characterList)});
      return { surface: surface ? { visibility: getComputedStyle(surface).visibility, opacity: getComputedStyle(surface).opacity, pointerEvents: getComputedStyle(surface).pointerEvents } : null, list: list ? { visibility: getComputedStyle(list).visibility, opacity: getComputedStyle(list).opacity } : null };
    })()`);
    await captureWhole(window, 'issue903-back-probe-after-click-final.png');
  }
  const electronDiagnostics = rendererDiagnostics.slice(diagnosticsStart);
  const appDiagnostics = [...electronAppDiagnostics];
  const fatalRendererDiagnostic = electronDiagnostics.some((entry) =>
    entry.kind === 'render-process-gone' ||
    (entry.kind === 'did-fail-load' && entry.errorCode !== 0) ||
    entry.kind === 'unresponsive' ||
    entry.level === 'error' ||
    entry.level === 3,
  ) || runtimeEvents.some((entry) => entry.kind === 'error' || entry.kind === 'unhandledrejection');
  const appQuitRequested = appDiagnostics.some((entry) => entry.kind === 'app-before-quit' || entry.kind === 'app-will-quit');
  const cleanTrustedClick = Boolean(afterUi?.interactions.some((entry) =>
    entry.kind === 'click' && entry.targetTestId === 'adaptive-parts-back-to-list' && entry.trusted,
  ));
  let classification;
  if (windowState.destroyed) classification = 'ELECTRON_WINDOW_DESTROYED';
  else if (appQuitRequested) classification = 'ELECTRON_APP_QUIT_REQUESTED';
  else if (!windowState.visible) classification = 'ELECTRON_WINDOW_HIDDEN';
  else if (electronDiagnostics.some((entry) => entry.kind === 'render-process-gone')) classification = 'RENDERER_PROCESS_GONE';
  else if (fatalRendererDiagnostic) classification = 'RENDERER_ERROR_OR_LOAD_FAILURE';
  else if (afterUi?.confirmCalls.length) classification = 'BACK_BLOCKED_BY_CONFIRMATION';
  else if (!afterUi?.bodyText.trim()) classification = 'BLANK_RENDERER';
  else if (afterUi?.visibleCharacterList && afterUi?.activeActivity === 'characters' && afterUi?.activeSubview === 'list' && afterUi?.drawerOpen === 'true') classification = 'RETURNED_TO_VISIBLE_CHARACTER_LIST';
  else if (afterUi?.drawerOpen !== 'true') classification = 'CHARACTER_DRAWER_HIDDEN';
  else if (afterUi?.visibleAdaptiveWorkbench) classification = 'WORKBENCH_REMAINS_VISIBLE';
  else classification = 'NO_VISIBLE_CHARACTER_LIST';

  const cleanProjectPreserved = afterProject?.revision === beforeOpen.revision &&
    afterProject?.dirty === beforeOpen.dirty &&
    afterProject?.undoCount === beforeOpen.undoCount &&
    JSON.stringify(afterProject?.project) === JSON.stringify(beforeOpen.project);
  const cleanBackPassed = classification === 'RETURNED_TO_VISIBLE_CHARACTER_LIST' &&
    cleanTrustedClick && !afterUi?.workbenchPresent && beforeControl.visible &&
    beforeControl.hitTestedWithinControl && afterUi?.confirmCalls.length === 0 &&
    cleanProjectPreserved && drawerAtList.drawerOpen === 'true' &&
    drawerAtWorkbench.drawerOpen === 'true';
  const cleanBack = {
    result: cleanBackPassed ? 'PASS' : classification,
    classification,
    beforeOpen: { revision: beforeOpen.revision, dirty: beforeOpen.dirty, undoCount: beforeOpen.undoCount },
    drawerAtList,
    drawerAtWorkbench,
    beforeControl,
    beforeBack: { revision: beforeBack.revision, dirty: beforeBack.dirty, undoCount: beforeBack.undoCount },
    viewport,
    adaptiveCardPointer,
    pointer,
    trustedClick: cleanTrustedClick,
    windowState,
    afterUi,
    afterProject: afterProject && { revision: afterProject.revision, dirty: afterProject.dirty, undoCount: afterProject.undoCount },
  };
  let dirtyBack = { result: 'NOT_RUN', reason: `Clean Back classification was ${classification}.` };
  if (cleanBackPassed) {
    await clickPoint(window, adaptiveCard, 'Reopen C0 for dirty Back decline and accept checks');
    await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]').length === 5`, 'The C0 workbench did not reopen for dirty Back checks.');
    const beforeDirtyEdit = await inspect(window);
    const cleanDraft = await inspectAdaptivePartsDraft(window);
    const firstVisibility = '[data-testid="adaptive-parts-assembly-row"] [data-testid="adaptive-parts-visibility-toggle"]';
    await clickPoint(window, firstVisibility, 'Change the first Part visibility to create a dirty Back draft');
    await waitFor(window, `document.querySelector(${JSON.stringify(firstVisibility)})?.getAttribute('aria-pressed') === 'false'`, 'The Part visibility draft did not change before Back.');
    const dirtyDraftBeforeDecline = await inspectAdaptivePartsDraft(window);
    const dirtyProjectBeforeDecline = await inspect(window);
    await page(window, `(() => { window.__pandaStageIssue903DirtyBackConfirmCalls = []; window.confirm = (message) => { window.__pandaStageIssue903DirtyBackConfirmCalls.push(String(message)); return false; }; })()`);
    const declinePointer = await clickPoint(window, backSelector, 'Decline dirty Back and preserve the exact C0 draft');
    await waitFor(window, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]'))`, 'Declining dirty Back closed the assembly workbench.');
    const afterDirtyDecline = await inspect(window);
    const draftAfterDecline = await inspectAdaptivePartsDraft(window);
    const promptsAfterDecline = await page(window, 'window.__pandaStageIssue903DirtyBackConfirmCalls ?? []');
    const declinePreservedDraft = JSON.stringify(draftAfterDecline) === JSON.stringify(dirtyDraftBeforeDecline);
    const declinePreservedProject = afterDirtyDecline.revision === dirtyProjectBeforeDecline.revision &&
      afterDirtyDecline.dirty === dirtyProjectBeforeDecline.dirty &&
      afterDirtyDecline.undoCount === dirtyProjectBeforeDecline.undoCount &&
      JSON.stringify(afterDirtyDecline.project) === JSON.stringify(dirtyProjectBeforeDecline.project);
    await captureWhole(window, 'issue903-back-probe-dirty-decline.png');

    await page(window, `(() => { window.confirm = (message) => { window.__pandaStageIssue903DirtyBackConfirmCalls.push(String(message)); return true; }; })()`);
    const acceptPointer = await clickPoint(window, backSelector, 'Accept dirty Back and discard only the local assembly draft');
    await waitFor(window, `(() => {
      const list = document.querySelector(${JSON.stringify(characterList)});
      const rect = list?.getBoundingClientRect();
      const style = list ? getComputedStyle(list) : null;
      return !document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && Boolean(rect?.width && rect.height && style?.display !== 'none' && style?.visibility !== 'hidden');
    })()`, 'Accepting dirty Back did not return to the visible Character list.');
    const afterDirtyAccept = await inspect(window);
    const dirtyAcceptUi = await page(window, `(() => {
      const dock = document.querySelector('[data-testid="resource-activity-dock"]');
      const panel = document.querySelector('[data-testid="resource-activity-panel"]');
      return { drawerOpen: dock?.dataset.resourceDrawerOpen ?? null, activeActivity: dock?.dataset.activeActivity ?? null, activeSubview: panel?.dataset.activeSubview ?? null, workbenchPresent: Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')) };
    })()`);
    const promptsAfterAccept = await page(window, 'window.__pandaStageIssue903DirtyBackConfirmCalls ?? []');
    const acceptPreservedProject = afterDirtyAccept.revision === dirtyProjectBeforeDecline.revision &&
      afterDirtyAccept.dirty === dirtyProjectBeforeDecline.dirty &&
      afterDirtyAccept.undoCount === dirtyProjectBeforeDecline.undoCount &&
      JSON.stringify(afterDirtyAccept.project) === JSON.stringify(dirtyProjectBeforeDecline.project);
    await captureWhole(window, 'issue903-back-probe-dirty-accept.png');

    await clickPoint(window, adaptiveCard, 'Reopen C0 after accepting dirty Back');
    await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'The same Character did not reopen after accepting dirty Back.');
    const reopenedDraft = await inspectAdaptivePartsDraft(window);
    const reopenedProject = await inspect(window);
    const reopenedOriginalDraft = JSON.stringify(reopenedDraft) === JSON.stringify(cleanDraft);
    const finalCleanPointer = await clickPoint(window, backSelector, 'Return to the Character list after clean reopen');
    await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector(${JSON.stringify(characterList)})`, 'Clean Back after reopen did not return to the list.');
    const finalConfirmCalls = await page(window, 'window.__pandaStageIssue903DirtyBackConfirmCalls ?? []');
    const finalProject = await inspect(window);
    const dirtyBackPassed = promptsAfterDecline.length === 1 && promptsAfterAccept.length === 2 &&
      declinePreservedDraft && declinePreservedProject && acceptPreservedProject &&
      dirtyAcceptUi.drawerOpen === 'true' && dirtyAcceptUi.activeActivity === 'characters' && dirtyAcceptUi.activeSubview === 'list' && !dirtyAcceptUi.workbenchPresent &&
      reopenedOriginalDraft && reopenedProject.revision === beforeDirtyEdit.revision &&
      reopenedProject.undoCount === beforeDirtyEdit.undoCount && JSON.stringify(reopenedProject.project) === JSON.stringify(beforeDirtyEdit.project) &&
      finalConfirmCalls.length === 2 && finalProject.revision === beforeDirtyEdit.revision &&
      finalProject.undoCount === beforeDirtyEdit.undoCount && JSON.stringify(finalProject.project) === JSON.stringify(beforeDirtyEdit.project);
    dirtyBack = {
      result: dirtyBackPassed ? 'PASS' : 'DIRTY_BACK_ASSERTION_FAILED',
      declinePointer,
      acceptPointer,
      finalCleanPointer,
      confirmationPrompts: finalConfirmCalls.length,
      draftBeforeDecline: dirtyDraftBeforeDecline,
      draftAfterDecline,
      declinePreservedDraft,
      declinePreservedProject,
      dirtyAcceptUi,
      acceptPreservedProject,
      reopenedDraft,
      reopenedOriginalDraft,
      projectPreserved: acceptPreservedProject && finalProject.revision === beforeDirtyEdit.revision && finalProject.undoCount === beforeDirtyEdit.undoCount,
      cleanDraft,
    };
  }

  if (!window.isDestroyed()) window.setSize(...originalWindowSize);
  const overallResult = cleanBack.result === 'PASS' && dirtyBack.result === 'PASS'
    ? 'PASS'
    : cleanBack.result !== 'PASS' ? cleanBack.result : dirtyBack.result;
  let baselineComparison = null;
  if (!issue903BackProbeBaseline && issue903BackBaselineReceiptPath) {
    try {
      const baselineReceipt = JSON.parse(await fsp.readFile(issue903BackBaselineReceiptPath, 'utf8'));
      const baselineBack = baselineReceipt.issue903NavBack01?.cleanBack;
      const baselineProjectPreserved = baselineBack?.afterProject?.revision === baselineBack?.beforeOpen?.revision &&
        baselineBack?.afterProject?.dirty === baselineBack?.beforeOpen?.dirty &&
        baselineBack?.afterProject?.undoCount === baselineBack?.beforeOpen?.undoCount;
      baselineComparison = {
        receiptPath: issue903BackBaselineReceiptPath,
        status: baselineReceipt.status,
        classification: baselineBack?.classification ?? null,
        appWindowStayedVisible: baselineBack?.windowState?.visible === true && baselineBack?.windowState?.destroyed === false,
        rendererStayedAlive: baselineBack?.windowState?.webContentsDestroyed === false && !(baselineReceipt.issue903NavBack01?.rendererDiagnostics ?? []).some((entry) => entry.kind === 'render-process-gone'),
        drawerAtList: baselineBack?.drawerAtList?.drawerOpen ?? null,
        drawerAtWorkbench: baselineBack?.drawerAtWorkbench?.drawerOpen ?? null,
        drawerAfterBack: baselineBack?.afterUi?.drawerOpen ?? null,
        activeSubviewAfterBack: baselineBack?.afterUi?.activeSubview ?? null,
        listVisibleAfterBack: baselineBack?.afterUi?.visibleCharacterList ?? false,
        workbenchGoneAfterBack: baselineBack?.afterUi?.workbenchPresent === false,
        projectAndHistoryPreserved: baselineProjectPreserved,
        reproduced: baselineReceipt.status === 'CHARACTER_DRAWER_HIDDEN' &&
          baselineBack?.classification === 'CHARACTER_DRAWER_HIDDEN' &&
          baselineBack?.drawerAtList?.drawerOpen === 'true' && baselineBack?.drawerAtWorkbench?.drawerOpen === 'true' &&
          baselineBack?.afterUi?.drawerOpen === 'false' && baselineBack?.afterUi?.activeActivity === 'characters' &&
          baselineBack?.afterUi?.activeSubview === 'list' && baselineBack?.afterUi?.visibleCharacterList === false &&
          baselineBack?.afterUi?.workbenchPresent === false && baselineBack?.windowState?.visible === true &&
          baselineBack?.windowState?.destroyed === false && baselineProjectPreserved,
      };
    } catch (error) {
      baselineComparison = {
        receiptPath: issue903BackBaselineReceiptPath,
        error: error instanceof Error ? error.message : String(error),
        reproduced: false,
      };
    }
  }
  const rootCauseConfirmed = Boolean(baselineComparison?.reproduced && overallResult === 'PASS');

  return {
    result: overallResult,
    cleanBack,
    dirtyBack,
    diagnosis: {
      rootCauseStatus: issue903BackProbeBaseline ? 'PRE_FIX_BASELINE' : rootCauseConfirmed ? 'CONFIRMED_BY_PRE_FIX_BASELINE_AND_POST_FIX_REGRESSION' : 'NOT_CONFIRMED',
      candidate: 'At a narrow viewport, releasing EditorShell’s temporary drawerOpen=true override let ResourceActivityDock apply its default-narrow closed state, leaving the Character list hidden after Back.',
      runMode: issue903BackProbeBaseline ? 'PRE_FIX_BASELINE' : 'POST_FIX_REGRESSION',
      ownerReportedFailure: 'NOT_REPRODUCED_AS_AN_ELECTRON_OR_RENDERER_EXIT; THE_PRE_FIX_BASELINE_REPRODUCED_A_HIDDEN_CHARACTER_DRAWER',
      baselineComparison,
    },
    viewport: { requested: { width: 880, height: 760 }, measured: viewport },
    windowState,
    rendererDiagnostics: electronDiagnostics,
    runtimeEvents,
    cssCascadeDiagnostics,
    electronAppDiagnostics: appDiagnostics,
    screenshots: [
      'issue903-back-probe-before-open.png',
      'issue903-back-probe-workbench-at-880.png',
      'issue903-back-probe-before-click.png',
      'issue903-back-probe-after-click.png',
      'issue903-back-probe-after-click-final.png',
      ...(cleanBackPassed ? ['issue903-back-probe-dirty-decline.png', 'issue903-back-probe-dirty-accept.png'] : []),
    ],
  };
}

async function verifyIssue901UiA(window, prepared, receipt) {
  const checks = {};
  const issue903 = {};
  const progress = (message) => process.stdout.write(`[issue901-ui-a] ${message}\n`);
  const characterRail = '[data-testid="resource-activity-rail-characters"]';
  const characterList = '[data-testid="character-list-view"]';
  const listRows = '.adaptive-parts-assembly-rows';
  const adaptiveCard = `[data-character-id="${adaptiveCharacterId}"]`;
  const longListCard = `[data-character-id="${prepared.longListCharacterId}"]`;

  await clickPoint(window, characterRail, 'Open Characters');
  await waitFor(window, `document.querySelector(${JSON.stringify(characterList)})`, 'Character list did not open.');
  const cardCopy = await page(window, `document.querySelector(${JSON.stringify(adaptiveCard)})?.querySelector('.character-list-copy small')?.textContent?.trim() ?? ''`);
  assert(cardCopy === '5 个零件', `Adaptive Parts list copy is ${JSON.stringify(cardCopy)}.`);
  await captureWhole(window, 'issue901-ui01-character-list.png');
  const beforeOpen = await inspect(window);
  await clickPoint(window, adaptiveCard, 'Open the five-Part C0 Character');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]').length === 5`, 'The Adaptive Character list row did not open its Part list and canvas.');
  const header = await page(window, `(() => {
    const header = document.querySelector('[data-testid="adaptive-parts-assembly-header"]');
    const back = header?.querySelector('[data-testid="adaptive-parts-back-to-list"]');
    const title = header?.querySelector('strong');
    const join = header?.querySelector('[data-testid="adaptive-parts-join-current-shot"]');
    const headerBounds = header?.getBoundingClientRect();
    const titleBounds = title?.getBoundingClientRect();
    const backBounds = back?.getBoundingClientRect();
    const joinBounds = join?.getBoundingClientRect();
    return {
      present: Boolean(header),
      name: title?.textContent?.trim() ?? '',
      back: back?.getAttribute('aria-label') ?? '',
      backText: back?.innerText?.trim() ?? '',
      backWidth: backBounds?.width ?? 0,
      backHeight: backBounds?.height ?? 0,
      titleCenterX: titleBounds ? titleBounds.left + titleBounds.width / 2 : 0,
      headerCenterX: headerBounds ? headerBounds.left + headerBounds.width / 2 : 0,
      join: join?.innerText?.trim() ?? '',
      joinCount: document.querySelectorAll('[data-testid="adaptive-parts-join-current-shot"]').length,
      listJoinCount: document.querySelectorAll('.adaptive-parts-assembly-list [data-testid="adaptive-parts-join-current-shot"]').length,
      joinWidth: joinBounds?.width ?? 0,
      joinHeight: joinBounds?.height ?? 0,
      selectedRows: document.querySelectorAll('[data-testid="adaptive-parts-assembly-row-select"][aria-pressed="true"]').length,
      inspectorFields: Boolean(document.querySelector('[data-testid="adaptive-parts-inspector-fields"]')),
      inspectorDisabled: document.querySelector('[data-testid="adaptive-parts-inspector-toggle"]')?.disabled ?? false,
    };
  })()`);
  assert(header.present && header.name === 'C0 五部件角色' && header.back === '返回角色列表' && !header.backText && header.backWidth >= 44 && header.backHeight >= 44, `Adaptive workbench header is not compact and navigable: ${JSON.stringify(header)}.`);
  assert(Math.abs(header.titleCenterX - header.headerCenterX) <= 2 && header.joinCount === 1 && header.listJoinCount === 0 && header.joinWidth >= 80 && header.joinHeight >= 44, `Adaptive header title or compact Shot CTA geometry is incorrect: ${JSON.stringify(header)}.`);
  issue903.header = { result: 'PASS', ...header };
  assert(header.join.includes('加入镜头') && header.selectedRows === 0 && !header.inspectorFields && header.inspectorDisabled, `Adaptive workbench did not start with the source pose and no selected Part: ${JSON.stringify(header)}.`);
  const afterOpen = await inspect(window);
  assert(afterOpen.revision === beforeOpen.revision && afterOpen.dirty === beforeOpen.dirty && afterOpen.undoCount === beforeOpen.undoCount, 'Opening the Adaptive workbench wrote a Project revision, dirty state, or History entry.');
  const bodyCopy = await page(window, `document.body.innerText`);
  assert(!/Static Parts|static Parts|静态 Parts/.test(bodyCopy), `Adaptive Parts fallback copy is inconsistent: ${bodyCopy.match(/Static Parts|static Parts|静态 Parts/)?.[0]}.`);
  await captureWhole(window, 'issue901-ui05-adaptive-workbench-header.png');
  await captureWhole(window, 'issue903-header-centered-cta.png');
  checks.ui05 = { result: 'PASS', header, directEntry: true, openingCreatedNoProjectHistory: true, fallbackCopyUsesChinese: true };

  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"] .adaptive-parts-assembly-canvas-toolbar button')?.textContent?.trim() === '查看全貌'`, 'The assembly canvas has no 查看全貌 action.');
  const viewAllSelector = '[data-testid="adaptive-parts-assembly-workbench"] .adaptive-parts-assembly-canvas-toolbar button';
  const viewAllBefore = await page(window, `(() => {
    const button = document.querySelector(${JSON.stringify(viewAllSelector)});
    const rect = button?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0, pointerEvents: button ? getComputedStyle(button).pointerEvents : null };
  })()`);
  assert(viewAllBefore.height >= 44 && viewAllBefore.pointerEvents === 'auto', `The 查看全貌 target is not touchable: ${JSON.stringify(viewAllBefore)}.`);
  await page(window, `(() => {
    const button = document.querySelector(${JSON.stringify(viewAllSelector)});
    window.__pandaStageIssue903ViewAllClick = null;
    button?.addEventListener('click', (event) => {
      const stage = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"] .character-assembly-preview-stage');
      window.__pandaStageIssue903ViewAllClick = { trusted: event.isTrusted, transform: stage?.style.transform ?? '' };
    }, { once: true });
  })()`);
  const viewAllPointer = await clickPoint(window, viewAllSelector, 'Click 查看全貌 with an Electron pointer coordinate');
  const viewAllAfter = await page(window, `(() => {
    const viewport = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]');
    const stage = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"] .character-assembly-preview-stage');
    const scale = Number(stage?.style.transform.match(/^scale\\(([^)]+)\\)$/)?.[1] ?? 0);
    const expectedScale = viewport ? Math.min(viewport.clientWidth / 1920, viewport.clientHeight / 1080) : 0;
    return { click: window.__pandaStageIssue903ViewAllClick ?? null, transform: stage?.style.transform ?? '', scale, expectedScale };
  })()`);
  assert(viewAllAfter.click?.trusted && viewAllAfter.scale > 0 && Math.abs(viewAllAfter.scale - viewAllAfter.expectedScale) < 0.002, `查看全貌 did not receive a trusted coordinate click with the canvas in fit scale: ${JSON.stringify({ pointer: viewAllPointer, before: viewAllBefore, after: viewAllAfter })}.`);
  await captureWhole(window, 'issue903-view-all-pointer.png');
  issue903.viewAll = { result: 'PASS', pointer: viewAllPointer, click: viewAllAfter.click, after: viewAllAfter, target: viewAllBefore };
  const c0Rows = await page(window, `([...document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')]).map((row) => ({
    partId: row.dataset.partId,
    name: row.querySelector('.adaptive-parts-assembly-name')?.textContent?.trim() ?? '',
    visible: row.querySelector('[data-testid="adaptive-parts-visibility-toggle"]')?.getAttribute('aria-pressed') === 'true',
  }))`);
  assert(c0Rows.length === 5 && new Set(c0Rows.map((row) => row.partId)).size === 5, `C0 row identities are not unique: ${JSON.stringify(c0Rows)}.`);
  assert(['com6', 'com2', 'com5', 'com4', 'com3'].every((name) => c0Rows.some((row) => row.name === name)), `The C0 row list lost source names: ${JSON.stringify(c0Rows)}.`);
  await captureWhole(window, 'issue901-ui01-assembly-list.png');
  progress('captured direct-entry workbench');

  const firstPartId = c0Rows[0].partId;
  assert(c0Rows[0].name === 'com3', `The top C0 row is ${JSON.stringify(c0Rows[0])}; expected com3.`);
  const firstRow = `[data-testid="adaptive-parts-assembly-row"][data-part-id="${firstPartId}"]`;
  const firstSelect = `${firstRow} [data-testid="adaptive-parts-assembly-row-select"]`;
  const firstEye = `${firstRow} [data-testid="adaptive-parts-visibility-toggle"]`;
  const wideRowGeometry = await page(window, `(() => {
    const list = document.querySelector('.adaptive-parts-assembly-list')?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')].filter((row) => ['com3', 'com4'].includes(row.querySelector('.adaptive-parts-assembly-name')?.textContent?.trim()));
    return { listWidth: list?.width ?? 0, rows: rows.map((row) => {
      const name = row.querySelector('.adaptive-parts-assembly-name');
      const nameRect = name?.getBoundingClientRect();
      const controls = ['adaptive-parts-visibility-toggle', 'adaptive-parts-rename-button', 'adaptive-parts-restore-button'].map((id) => {
        const rect = row.querySelector('[data-testid="' + id + '"]')?.getBoundingClientRect();
        return { id, width: rect?.width ?? 0, height: rect?.height ?? 0 };
      });
      return { name: name?.textContent?.trim() ?? '', nameWidth: nameRect?.width ?? 0, controls };
    }) };
  })()`);
  progress(`measured desktop row controls: ${JSON.stringify(wideRowGeometry)}`);
  assert(wideRowGeometry.listWidth >= 270 && wideRowGeometry.listWidth <= 290, `Desktop Part list width is outside 270–290 CSS pixels: ${JSON.stringify(wideRowGeometry)}.`);
  assert(wideRowGeometry.rows.length === 2 && wideRowGeometry.rows.every((row) => row.nameWidth > 0 && row.controls.every((control) => control.width >= 44 && control.height >= 44)), `com3/com4 names or 44px direct row controls are unavailable: ${JSON.stringify(wideRowGeometry)}.`);
  const originalWindowSize = window.getSize();
  progress(`resizing from ${JSON.stringify(originalWindowSize)} to 880x760`);
  window.setSize(880, 760);
  await pause(450);
  progress(`Electron size is ${JSON.stringify(window.getSize())}; renderer size is ${JSON.stringify(await page(window, '({ width: window.innerWidth, height: window.innerHeight })'))}`);
  await waitFor(window, 'window.innerWidth <= 900 && window.innerWidth >= 800', 'The workbench window did not enter the 880px compact breakpoint.');
  progress('checking row geometry at 880px');
  const narrowRowGeometry = await page(window, `(() => {
    const row = document.querySelector(${JSON.stringify(firstRow)});
    const name = row?.querySelector('.adaptive-parts-assembly-name')?.getBoundingClientRect();
    const controls = ['adaptive-parts-visibility-toggle', 'adaptive-parts-rename-button', 'adaptive-parts-restore-button'].map((id) => {
      const rect = row?.querySelector('[data-testid="' + id + '"]')?.getBoundingClientRect();
      return { id, width: rect?.width ?? 0, height: rect?.height ?? 0, top: rect?.top ?? 0 };
    });
    return { nameTop: name?.top ?? 0, nameBottom: name?.bottom ?? 0, controls };
  })()`);
  progress(`measured 880px row geometry: ${JSON.stringify(narrowRowGeometry)}`);
  assert(narrowRowGeometry && narrowRowGeometry.controls.every((control) => control.width >= 44 && control.height >= 44) && narrowRowGeometry.nameBottom <= Math.min(...narrowRowGeometry.controls.map((control) => control.top)) + 2, `At 880px the name does not wrap above three 44px direct controls: ${JSON.stringify(narrowRowGeometry)}.`);
  const narrowHeader = await page(window, `(() => {
    const header = document.querySelector('[data-testid="adaptive-parts-assembly-header"]')?.getBoundingClientRect();
    const back = document.querySelector('[data-testid="adaptive-parts-back-to-list"]')?.getBoundingClientRect();
    const title = document.querySelector('[data-testid="adaptive-parts-assembly-header"] strong')?.getBoundingClientRect();
    const join = document.querySelector('[data-testid="adaptive-parts-join-current-shot"]')?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: header ? { left: header.left, right: header.right, top: header.top, bottom: header.bottom, centerX: header.left + header.width / 2 } : null,
      back: back ? { left: back.left, right: back.right, width: back.width, height: back.height } : null,
      title: title ? { left: title.left, right: title.right, width: title.width, centerX: title.left + title.width / 2 } : null,
      join: join ? { left: join.left, right: join.right, width: join.width, height: join.height } : null,
    };
  })()`);
  assert(narrowHeader.header && narrowHeader.back && narrowHeader.title && narrowHeader.join && narrowHeader.back.width >= 44 && narrowHeader.back.height >= 44 && narrowHeader.join.width >= 80 && narrowHeader.join.height >= 44 && narrowHeader.back.left >= 0 && narrowHeader.join.right <= narrowHeader.viewport.width && Math.abs(narrowHeader.header.centerX - narrowHeader.title.centerX) <= 2, `The compact 880px header has clipped controls or an off-center title: ${JSON.stringify(narrowHeader)}.`);
  issue903.header880 = { result: 'PASS', ...narrowHeader };

  await page(window, `(() => {
    const button = document.querySelector(${JSON.stringify(viewAllSelector)});
    window.__pandaStageIssue903ViewAllNarrowClick = null;
    button?.addEventListener('click', (event) => {
      const stage = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"] .character-assembly-preview-stage');
      window.__pandaStageIssue903ViewAllNarrowClick = { trusted: event.isTrusted, transform: stage?.style.transform ?? '' };
    }, { once: true });
  })()`);
  const viewAllNarrowPointer = await clickPoint(window, viewAllSelector, 'Click 查看全貌 with a pointer coordinate at 880px');
  const viewAllNarrowAfter = await page(window, `(() => {
    const button = document.querySelector(${JSON.stringify(viewAllSelector)});
    const rect = button?.getBoundingClientRect();
    const viewport = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]');
    const stage = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"] .character-assembly-preview-stage');
    const scale = Number(stage?.style.transform.match(/^scale\\(([^)]+)\\)$/)?.[1] ?? 0);
    const expectedScale = viewport ? Math.min(viewport.clientWidth / 1920, viewport.clientHeight / 1080) : 0;
    return { width: rect?.width ?? 0, height: rect?.height ?? 0, pointerEvents: button ? getComputedStyle(button).pointerEvents : null, click: window.__pandaStageIssue903ViewAllNarrowClick ?? null, scale, expectedScale };
  })()`);
  assert(viewAllNarrowAfter.width >= 44 && viewAllNarrowAfter.height >= 44 && viewAllNarrowAfter.pointerEvents === 'auto' && viewAllNarrowAfter.click?.trusted && viewAllNarrowAfter.scale > 0 && Math.abs(viewAllNarrowAfter.scale - viewAllNarrowAfter.expectedScale) < 0.002, `The 880px 查看全貌 control did not receive a trusted hit or fit the canvas: ${JSON.stringify({ pointer: viewAllNarrowPointer, after: viewAllNarrowAfter })}.`);
  await captureWhole(window, 'issue903-view-all-pointer-narrow-880.png');
  issue903.viewAllNarrow880 = { result: 'PASS', pointer: viewAllNarrowPointer, ...viewAllNarrowAfter };

  window.setSize(820, 980);
  await pause(450);
  await waitFor(window, 'window.innerWidth >= 780 && window.innerWidth <= 840', 'The header probe did not enter an 820px portrait viewport.');
  const portraitHeader = await page(window, `(() => {
    const header = document.querySelector('[data-testid="adaptive-parts-assembly-header"]')?.getBoundingClientRect();
    const back = document.querySelector('[data-testid="adaptive-parts-back-to-list"]')?.getBoundingClientRect();
    const titleElement = document.querySelector('[data-testid="adaptive-parts-assembly-header"] strong');
    const title = titleElement?.getBoundingClientRect();
    const join = document.querySelector('[data-testid="adaptive-parts-join-current-shot"]')?.getBoundingClientRect();
    const originalText = titleElement?.textContent ?? '';
    const originalTitle = titleElement?.getAttribute('title');
    const longName = 'C0 超长名称用于验证窄屏居中标题不会挤出顶栏与触控按钮';
    if (titleElement) { titleElement.textContent = longName; titleElement.setAttribute('title', longName); }
    const longNameStyle = titleElement ? getComputedStyle(titleElement) : null;
    const longNameContract = titleElement ? { clientWidth: titleElement.clientWidth, scrollWidth: titleElement.scrollWidth, whiteSpace: longNameStyle?.whiteSpace, overflow: longNameStyle?.overflow, textOverflow: longNameStyle?.textOverflow } : null;
    if (titleElement) { titleElement.textContent = originalText; if (originalTitle === null) titleElement.removeAttribute('title'); else titleElement.setAttribute('title', originalTitle); }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: header ? { left: header.left, right: header.right, centerX: header.left + header.width / 2 } : null,
      back: back ? { left: back.left, right: back.right, width: back.width, height: back.height } : null,
      title: title ? { left: title.left, right: title.right, centerX: title.left + title.width / 2 } : null,
      join: join ? { left: join.left, right: join.right, width: join.width, height: join.height } : null,
      longNameContract,
    };
  })()`);
  assert(portraitHeader.header && portraitHeader.back && portraitHeader.title && portraitHeader.join && portraitHeader.back.width >= 44 && portraitHeader.back.height >= 44 && portraitHeader.join.width >= 80 && portraitHeader.join.height >= 44 && portraitHeader.back.left >= 0 && portraitHeader.join.right <= portraitHeader.viewport.width && Math.abs(portraitHeader.header.centerX - portraitHeader.title.centerX) <= 2 && portraitHeader.longNameContract?.scrollWidth > portraitHeader.longNameContract?.clientWidth && portraitHeader.longNameContract.whiteSpace === 'nowrap' && portraitHeader.longNameContract.overflow === 'hidden' && portraitHeader.longNameContract.textOverflow === 'ellipsis', `The portrait header clipped controls, lost title centering, or lacks long-name ellipsis: ${JSON.stringify(portraitHeader)}.`);
  await captureWhole(window, 'issue903-header-portrait-820.png');
  issue903.headerPortrait820 = { result: 'PASS', ...portraitHeader };
  window.setSize(originalWindowSize[0], originalWindowSize[1]);
  await pause(350);

  progress('capturing 880px evidence');
  await captureWhole(window, 'issue901-ui02-narrow-880.png');
  progress('captured 880px evidence');
  window.setSize(originalWindowSize[0], originalWindowSize[1]);
  await pause(350);
  progress(`measured 880px row layout: ${JSON.stringify(narrowRowGeometry)}`);

  const selectionBeforeEye = await page(window, `document.querySelector(${JSON.stringify(firstSelect)})?.getAttribute('aria-pressed')`);
  const beforeEye = await inspect(window);
  progress(`clicking visibility; initially pressed=${selectionBeforeEye}`);
  const eyePointer = await clickPoint(window, firstEye, 'Toggle the first Part visibility');
  progress('visibility click returned');
  await waitFor(window, `document.querySelector(${JSON.stringify(firstEye)})?.getAttribute('aria-pressed') === 'false'`, `The direct visibility control did not hide the Part: ${JSON.stringify(await page(window, `(() => { const row = document.querySelector(${JSON.stringify(firstRow)}); return { pressed: row?.querySelector('[data-testid="adaptive-parts-visibility-toggle"]')?.getAttribute('aria-pressed') ?? null, selected: row?.querySelector('[data-testid="adaptive-parts-assembly-row-select"]')?.getAttribute('aria-pressed') ?? null, canvasPart: Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${firstPartId}"]')), status: document.querySelector('.adaptive-parts-assembly-footer [role="status"]')?.textContent?.trim() ?? '' }; })()`))}.`);
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${firstPartId}"]')`, 'A hidden Part is still rendered on the assembly canvas.');
  const hiddenSelection = await page(window, `document.querySelector(${JSON.stringify(firstSelect)})?.getAttribute('aria-pressed')`);
  const afterEye = await inspect(window);
  assert(selectionBeforeEye === 'false' && hiddenSelection === 'false', 'Hiding a Part changed its list selection.');
  assert(afterEye.revision === beforeEye.revision && afterEye.undoCount === beforeEye.undoCount, 'Direct visibility toggle wrote a Project revision or History entry before Apply.');
  await captureWhole(window, 'issue901-ui01-direct-eye-hidden.png');
  await clickPoint(window, firstEye, 'Show the first Part again');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${firstPartId}"]')`, 'The direct visibility control did not restore the Part.');

  const renamePointer = await renameAdaptivePart(window, firstRow, 'C0 临时重命名', 'issue901-ui01-row-rename-inline.png');
  await clickPoint(window, `${firstRow} [data-testid="adaptive-parts-rename-button"]`, 'Start a rename to cancel with Escape');
  await replaceInputText(window, '[data-testid="adaptive-parts-rename-input"]', '不应提交');
  await sendKey(window, 'Escape');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-rename-input"]')`, 'Escape did not cancel inline rename.');
  assert(await page(window, `document.querySelector(${JSON.stringify(firstRow + ' .adaptive-parts-assembly-name')})?.textContent?.trim() === 'C0 临时重命名'`), 'Escape changed the existing Part name.');
  await clickPoint(window, `${firstRow} [data-testid="adaptive-parts-rename-button"]`, 'Start blank-name validation');
  await replaceInputText(window, '[data-testid="adaptive-parts-rename-input"]', '');
  await page(window, `document.querySelector('[data-testid="adaptive-parts-rename-input"]')?.blur()`);
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-rename-input"]')?.getAttribute('aria-invalid') === 'true'`, 'Blank inline names were not rejected.');
  const renameFailureVisible = await page(window, `(() => { const input = document.querySelector('[data-testid="adaptive-parts-rename-input"]'); const errorId = input?.getAttribute('aria-describedby'); return Boolean(input && input.value === '' && errorId && document.getElementById(errorId)?.textContent?.trim()); })()`);
  assert(renameFailureVisible, 'A rejected inline rename did not keep its input and visible error.');
  await page(window, `document.querySelector('[data-testid="adaptive-parts-rename-input"]')?.focus()`);
  await sendKey(window, 'Escape');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-rename-input"]')`, 'Escape did not close blank-name validation.');

  const rowSelectPointer = await clickPoint(window, firstSelect, 'Select com3 for compact Part inspector checks');
  await clickPoint(window, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open compact Part inspector');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')`, 'Compact inspector fields did not open.');
  const inspectorFieldIds = await page(window, `['adaptive-parts-offset-x','adaptive-parts-offset-y','adaptive-parts-scale-percent','adaptive-parts-rotation-deg'].map((id) => Boolean(document.querySelector('[data-testid="' + id + '"]')))`);
  assert(inspectorFieldIds.every(Boolean), `Compact inspector does not show exactly the four transform fields: ${JSON.stringify(inspectorFieldIds)}.`);
  const inspectorClosePointer = await clickPoint(window, '[data-testid="adaptive-parts-inspector-close"]', 'Close the inspector with its X button');
  assert(inspectorClosePointer.targetSize.width >= 44 && inspectorClosePointer.targetSize.height >= 44, 'The inspector close button is below the 44px touch target.');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-inspector-fields"]') && document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Inspector X closed the workbench instead of only the inspector.');
  await clickPoint(window, '[data-testid="adaptive-parts-inspector-toggle"]', 'Reopen compact Part inspector');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')`, 'Compact inspector did not reopen.');
  const xInputSelector = JSON.stringify('[data-testid="adaptive-parts-offset-x"]');
  const inspectorStepDownPointer = await clickPoint(window, '[data-testid="adaptive-parts-offset-x-step-down"]', 'Decrement X by one');
  assert(inspectorStepDownPointer.targetSize.width >= 44 && inspectorStepDownPointer.targetSize.height >= 44, 'The inspector minus stepper is below the 44px touch target.');
  await waitFor(window, 'document.querySelector(' + xInputSelector + ')?.value === "-1"', 'X minus stepper did not decrement by one.');
  const inspectorStepUpPointer = await clickPoint(window, '[data-testid="adaptive-parts-offset-x-step-up"]', 'Restore X with the plus stepper');
  assert(inspectorStepUpPointer.targetSize.width >= 44 && inspectorStepUpPointer.targetSize.height >= 44, 'The inspector plus stepper is below the 44px touch target.');
  await waitFor(window, 'document.querySelector(' + xInputSelector + ')?.value === "0"', 'X plus stepper did not restore the value after decrement.');
  const inspectorStepUpAfterDownPointer = await clickPoint(window, '[data-testid="adaptive-parts-offset-x-step-up"]', 'Increment X by one');
  assert(inspectorStepUpAfterDownPointer.targetSize.width >= 44 && inspectorStepUpAfterDownPointer.targetSize.height >= 44, 'The inspector plus stepper is below the 44px touch target.');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '1'`, 'X stepper did not increment by one.');
  await page(window, `document.querySelector('[data-testid="adaptive-parts-offset-x-step-up"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '11'`, 'Shift+X stepper did not increment by ten.');
  await replaceInputText(window, '[data-testid="adaptive-parts-offset-x"]', '12.345');
  await page(window, `document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.focus()`);
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '12.3'`, 'Blur did not return X offset to concise one-decimal display.');
  await replaceInputText(window, '[data-testid="adaptive-parts-offset-x"]', '');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.getAttribute('aria-invalid') === 'true'`, 'An empty numeric draft was not marked invalid.');
  assert(await page(window, `document.querySelector('[data-testid="adaptive-parts-assembly-apply"]')?.disabled === true`), 'Apply stayed enabled for an invalid numeric draft.');
  await sendKey(window, 'Escape');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '12.3'`, 'Escape did not restore the previous high-precision X offset.');
  const restorePointer = await clickPoint(window, `${firstRow} [data-testid="adaptive-parts-restore-button"]`, 'Restore only the selected Part to its source pose');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.value === '0'`, 'Direct source restore did not reset the current Part draft.');
  assert(await page(window, `document.querySelector(${JSON.stringify(firstRow + ' .adaptive-parts-assembly-name')})?.textContent?.trim() === 'C0 临时重命名'`), 'Source restore changed the Part name while restoring its pose.');
  const wideInspectorGeometry = await page(window, `(() => {
    const panel = document.querySelector('.adaptive-parts-assembly-inspector');
    const bounds = panel?.getBoundingClientRect();
    const input = panel?.querySelector('.adaptive-parts-inspector-input-wrap');
    const inputBounds = input?.getBoundingClientRect();
    const stepper = panel?.querySelector('[data-testid="adaptive-parts-offset-x-step-down"]')?.getBoundingClientRect();
    return { width: bounds?.width ?? 0, inputBarWidth: inputBounds?.width ?? 0, stepperWidth: stepper?.width ?? 0 };
  })()`);
  assert(wideInspectorGeometry.width >= 252 && wideInspectorGeometry.width <= 260 && wideInspectorGeometry.inputBarWidth >= 84 && wideInspectorGeometry.inputBarWidth <= 110 && wideInspectorGeometry.stepperWidth >= 44, `The compact inspector or numeric field bars have unexpected sizing: ${JSON.stringify(wideInspectorGeometry)}.`);
  await captureWhole(window, 'issue903-inspector-256.png');
  issue903.inspectorWide = wideInspectorGeometry;
  const inspectNumericField = async (testId) => {
    const selector = JSON.stringify('[data-testid="' + testId + '"]');
    const applySelector = JSON.stringify('[data-testid="adaptive-parts-assembly-apply"]');
    const expression =
      '(() => {' +
      'const input = document.querySelector(' + selector + ');' +
      'const wrapper = input?.closest(".adaptive-parts-inspector-input-wrap");' +
      'const panel = input?.closest(".adaptive-parts-assembly-inspector");' +
      'const panelBounds = panel?.getBoundingClientRect();' +
      'const wrapperBounds = wrapper?.getBoundingClientRect();' +
      'const suffix = wrapper && wrapper.lastElementChild !== input ? wrapper.lastElementChild : null;' +
      'const suffixBounds = suffix?.getBoundingClientRect();' +
      'const errorId = input?.getAttribute("aria-describedby");' +
      'const error = errorId ? document.getElementById(errorId) : null;' +
      'const errorBounds = error?.getBoundingClientRect();' +
      'const errorStyle = error ? getComputedStyle(error) : null;' +
      'const suffixStyle = suffix ? getComputedStyle(suffix) : null;' +
      'return {' +
      'value: input?.value ?? null,' +
      'invalid: input?.getAttribute("aria-invalid") === "true",' +
      'focused: document.activeElement === input,' +
      'caretAtEnd: Boolean(input && input.selectionStart === input.value.length),' +
      'scrollLeft: input?.scrollLeft ?? 0,' +
      'inputWidth: input?.getBoundingClientRect().width ?? 0,' +
      'fieldWithinPanel: Boolean(wrapperBounds && panelBounds && wrapperBounds.left >= panelBounds.left - 1 && wrapperBounds.right <= panelBounds.right + 1),' +
      'suffix: suffix?.textContent ?? "",' +
      'suffixWithinPanel: !suffix || Boolean(suffixBounds && panelBounds && suffixBounds.width > 0 && suffixBounds.height > 0 && suffixBounds.left >= wrapperBounds.left - 1 && suffixBounds.right <= wrapperBounds.right + 1 && suffixBounds.left >= panelBounds.left - 1 && suffixBounds.right <= panelBounds.right + 1 && suffixStyle.visibility === "visible"),' +
      'errorText: error?.textContent?.trim() ?? "",' +
      'errorVisible: !errorId || Boolean(error && errorBounds && errorBounds.width > 0 && errorBounds.height > 0 && errorStyle.display !== "none" && errorStyle.visibility === "visible"),' +
      'errorWithinPanel: !error || Boolean(errorBounds && panelBounds && errorBounds.left >= panelBounds.left - 1 && errorBounds.right <= panelBounds.right + 1),' +
      'footerMessage: document.querySelector(".adaptive-parts-assembly-footer [role=\\"status\\"]")?.textContent?.trim() ?? "",' +
      'applyDisabled: document.querySelector(' + applySelector + ')?.disabled ?? null' +
      '};' +
      '})()';
    return page(window, expression);
  };
  const waitForNumericValue = async (testId, value, label) => {
    const selector = JSON.stringify('[data-testid="' + testId + '"]');
    await waitFor(window, 'document.querySelector(' + selector + ')?.value === ' + JSON.stringify(value), label);
  };
  const waitForNumericError = async (testId, label) => {
    const selector = JSON.stringify('[data-testid="' + testId + '"]');
    await waitFor(window, 'document.querySelector(' + selector + ')?.getAttribute("aria-invalid") === "true"', label);
  };
  const offsetInputId = 'adaptive-parts-offset-x';
  const scaleInputId = 'adaptive-parts-scale-percent';
  const rotationInputId = 'adaptive-parts-rotation-deg';
  await replaceInputText(window, '[data-testid="adaptive-parts-offset-x"]', '-1000000');
  await waitForNumericValue(offsetInputId, '-1000000', 'The -1,000,000 offset was not editable.');
  const offsetExtremeAllowed = await inspectNumericField(offsetInputId);
  assert(offsetExtremeAllowed.focused && offsetExtremeAllowed.caretAtEnd && offsetExtremeAllowed.fieldWithinPanel && !offsetExtremeAllowed.invalid && offsetExtremeAllowed.value === '-1000000', 'The allowed extreme offset was not fully inspectable in the focused input: ' + JSON.stringify(offsetExtremeAllowed) + '.');
  const boundaryCharacter = activeProject.characters.find((character) => character.id === adaptiveCharacterId);
  const boundaryPart = boundaryCharacter?.mode === 'adaptive-parts'
    ? boundaryCharacter.parts.find((part) => part.partId === firstPartId)
    : null;
  const boundaryRoot = boundaryCharacter?.mode === 'adaptive-parts' ? boundaryCharacter.sourceRootTransform : null;
  const boundaryRest = boundaryPart?.sourceRestTransform ?? boundaryPart?.restTransform ?? null;
  const boundarySourcePose = boundaryRoot && boundaryRest
    ? {
      tx: boundaryRoot.a * boundaryRest.tx + boundaryRoot.c * boundaryRest.ty + boundaryRoot.tx,
      ty: boundaryRoot.b * boundaryRest.tx + boundaryRoot.d * boundaryRest.ty + boundaryRoot.ty,
    }
    : null;
  const boundarySourcePoseIsIdentity = Boolean(boundaryRoot && boundarySourcePose &&
    boundaryRoot.a === 1 && boundaryRoot.b === 0 && boundaryRoot.c === 0 && boundaryRoot.d === 1 &&
    boundarySourcePose.tx === 0 && boundarySourcePose.ty === 0);
  const requiredRestTransformTx = boundarySourcePoseIsIdentity && boundaryRoot
    ? -1_000_000 - boundaryRoot.tx
    : null;
  const offsetLimitBoundaryResult = {
    result: offsetExtremeAllowed.applyDisabled || offsetExtremeAllowed.footerMessage ? 'FAIL' : 'PASS',
    valueAcceptedByField: offsetExtremeAllowed.value === '-1000000' && !offsetExtremeAllowed.invalid,
    applyDisabled: offsetExtremeAllowed.applyDisabled,
    footerMessage: offsetExtremeAllowed.footerMessage,
    sourceRootTransform: boundaryRoot,
    sourceRestTransform: boundaryRest,
    sourcePose: boundarySourcePose,
    requiredRestTransformTx,
    restTransformRange: [-1_000_000, 1_000_000],
    reason: offsetExtremeAllowed.applyDisabled
      ? 'The input accepts -1,000,000 but this C0 source root requires a derived restTransform tx outside the existing CharacterPartTransformSchema range. Fixing that requires out-of-scope schema/geometry changes.'
      : null,
  };
  await captureWhole(window, 'issue903-inspector-offset-minus-million.png');
  await clickPoint(window, '[data-testid="adaptive-parts-scale-percent"]', 'Blur the extreme offset while retaining the selected Part');
  const offsetExtremeAfterBlur = await inspectNumericField(offsetInputId);
  assert(offsetExtremeAfterBlur.value === '-1000000' && !offsetExtremeAfterBlur.invalid && offsetExtremeAfterBlur.fieldWithinPanel, 'Blurring changed the allowed extreme offset: ' + JSON.stringify(offsetExtremeAfterBlur) + '.');
  const rowRestoreSelector = firstRow + ' [data-testid="adaptive-parts-restore-button"]';
  const offsetExtremeRestorePointer = await clickPoint(window, rowRestoreSelector, 'Restore the Part after the extreme offset check');
  await waitForNumericValue(offsetInputId, '0', 'Source restore did not reset the extreme offset draft.');

  await replaceInputText(window, '[data-testid="adaptive-parts-offset-x"]', '1000001');
  await waitForNumericError(offsetInputId, 'The over-limit offset was not rejected.');
  const offsetOutOfRange = await inspectNumericField(offsetInputId);
  assert(offsetOutOfRange.value === '1000001' && offsetOutOfRange.invalid && offsetOutOfRange.errorVisible && offsetOutOfRange.errorWithinPanel && offsetOutOfRange.errorText && offsetOutOfRange.applyDisabled, 'The over-limit offset error was missing or hidden: ' + JSON.stringify(offsetOutOfRange) + '.');
  await captureWhole(window, 'issue903-inspector-offset-out-of-range.png');
  await sendKey(window, 'Escape');
  await waitForNumericValue(offsetInputId, '0', 'Escape did not restore the valid offset after the range error.');
  assert(!(await inspectNumericField(offsetInputId)).invalid, 'Escape did not clear the offset range error.');

  await replaceInputText(window, '[data-testid="adaptive-parts-scale-percent"]', '100');
  await waitForNumericValue(scaleInputId, '100', 'The 100% scale value was not editable.');
  const scaleExtremeAllowed = await inspectNumericField(scaleInputId);
  assert(scaleExtremeAllowed.value === '100' && scaleExtremeAllowed.focused && scaleExtremeAllowed.caretAtEnd && !scaleExtremeAllowed.invalid && scaleExtremeAllowed.suffix === '%' && scaleExtremeAllowed.suffixWithinPanel, 'The 100% value or suffix was not inspectable: ' + JSON.stringify(scaleExtremeAllowed) + '.');
  await replaceInputText(window, '[data-testid="adaptive-parts-scale-percent"]', '0');
  await waitForNumericError(scaleInputId, 'The invalid scale was not rejected.');
  const scaleOutOfRange = await inspectNumericField(scaleInputId);
  assert(scaleOutOfRange.invalid && scaleOutOfRange.errorVisible && scaleOutOfRange.errorWithinPanel && scaleOutOfRange.errorText && scaleOutOfRange.applyDisabled, 'The scale range error was missing or hidden: ' + JSON.stringify(scaleOutOfRange) + '.');
  await captureWhole(window, 'issue903-inspector-scale-out-of-range.png');
  await sendKey(window, 'Escape');
  await waitForNumericValue(scaleInputId, '100', 'Escape did not restore the valid 100% scale after the range error.');

  await replaceInputText(window, '[data-testid="adaptive-parts-rotation-deg"]', '-180');
  await waitForNumericValue(rotationInputId, '-180', 'The -180 degree rotation was not editable.');
  const rotationExtremeAllowed = await inspectNumericField(rotationInputId);
  assert(rotationExtremeAllowed.value === '-180' && rotationExtremeAllowed.focused && rotationExtremeAllowed.caretAtEnd && !rotationExtremeAllowed.invalid && rotationExtremeAllowed.suffix === '°' && rotationExtremeAllowed.suffixWithinPanel, 'The -180° value or suffix was not inspectable: ' + JSON.stringify(rotationExtremeAllowed) + '.');
  const rotationCommitPointer = await clickPoint(window, '[data-testid="adaptive-parts-offset-x"]', 'Commit the -180 degree value before testing Escape on a new edit');
  const rotationAfterBlur = await inspectNumericField(rotationInputId);
  assert(rotationAfterBlur.value === '-180' && !rotationAfterBlur.invalid, 'Blurring changed the allowed -180 degree rotation: ' + JSON.stringify(rotationAfterBlur) + '.');
  await replaceInputText(window, '[data-testid="adaptive-parts-rotation-deg"]', '-181');
  await waitForNumericError(rotationInputId, 'The out-of-range rotation was not rejected.');
  const rotationOutOfRange = await inspectNumericField(rotationInputId);
  assert(rotationOutOfRange.invalid && rotationOutOfRange.errorVisible && rotationOutOfRange.errorWithinPanel && rotationOutOfRange.errorText && rotationOutOfRange.applyDisabled, 'The rotation range error was missing or hidden: ' + JSON.stringify(rotationOutOfRange) + '.');
  await captureWhole(window, 'issue903-inspector-rotation-out-of-range.png');
  await sendKey(window, 'Escape');
  await waitForNumericValue(rotationInputId, '-180', 'Escape did not restore the valid -180 degree rotation after the range error.');
  const rotationExtremeRestorePointer = await clickPoint(window, rowRestoreSelector, 'Restore the Part after numeric boundary checks');
  await waitFor(window, 'document.querySelector("[data-testid=\\"adaptive-parts-offset-x\\"]")?.value === "0" && document.querySelector("[data-testid=\\"adaptive-parts-offset-y\\"]")?.value === "0" && document.querySelector("[data-testid=\\"adaptive-parts-scale-percent\\"]")?.value === "100" && document.querySelector("[data-testid=\\"adaptive-parts-rotation-deg\\"]")?.value === "0"', 'Source restore did not clear the numeric boundary drafts.');
  issue903.inspectorBoundaries = {
    result: offsetLimitBoundaryResult.result,
    offsetLimit: offsetLimitBoundaryResult,
    allowed: {
      offsetX: offsetExtremeAllowed,
      offsetXAfterBlur: offsetExtremeAfterBlur,
      scalePercent: scaleExtremeAllowed,
      rotationDeg: rotationExtremeAllowed,
      rotationDegAfterBlur: rotationAfterBlur,
    },
    rejected: { offsetX: offsetOutOfRange, scalePercent: scaleOutOfRange, rotationDeg: rotationOutOfRange },
    restorePointers: { afterOffset: offsetExtremeRestorePointer, afterRotation: rotationExtremeRestorePointer, rotationCommit: rotationCommitPointer },
    restoredToSource: true,
  };
  issue903.inspectorControls = {
    close: inspectorClosePointer,
    stepDown: inspectorStepDownPointer,
    stepUpFromMinus: inspectorStepUpPointer,
    stepUp: inspectorStepUpAfterDownPointer,
  };
  issue903.rowButtons = {
    select: rowSelectPointer,
    visibility: eyePointer,
    rename: renamePointer,
    restore: restorePointer,
  };

  const inspectorTestSize = window.getSize();
  window.setSize(820, 980);
  await pause(450);
  await waitFor(window, 'window.innerWidth <= 900 && window.innerHeight > window.innerWidth', 'The inspector did not enter the portrait 820x980 viewport.');
  const portraitInspectorGeometry = await page(window, `(() => {
    const panel = document.querySelector('.adaptive-parts-assembly-inspector')?.getBoundingClientRect();
    const part = document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected')?.getBoundingClientRect();
    const canvas = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]')?.getBoundingClientRect();
    const workbench = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')?.getBoundingClientRect();
    if (!panel || !part || !canvas || !workbench) return null;
    const overlapWidth = Math.max(0, Math.min(panel.right, part.right) - Math.max(panel.left, part.left));
    const overlapHeight = Math.max(0, Math.min(panel.bottom, part.bottom) - Math.max(panel.top, part.top));
    return {
      width: panel.width,
      insideWorkbench: panel.left >= workbench.left && panel.top >= workbench.top && panel.right <= workbench.right && panel.bottom <= workbench.bottom,
      insideCanvas: panel.left >= canvas.left && panel.top >= canvas.top && panel.right <= canvas.right && panel.bottom <= canvas.bottom,
      overlapArea: overlapWidth * overlapHeight,
      placement: document.querySelector('.adaptive-parts-assembly-inspector')?.dataset.position ?? '',
      closeHeight: document.querySelector('[data-testid="adaptive-parts-inspector-close"]')?.getBoundingClientRect().height ?? 0,
    };
  })()`);
  assert(portraitInspectorGeometry?.insideWorkbench && portraitInspectorGeometry.overlapArea === 0 && portraitInspectorGeometry.width <= 256 && portraitInspectorGeometry.closeHeight >= 44, `The portrait inspector escaped the workbench or covered its selected Part: ${JSON.stringify(portraitInspectorGeometry)}.`);
  await captureWhole(window, 'issue903-inspector-portrait-820x980.png');
  window.setSize(inspectorTestSize[0], inspectorTestSize[1]);
  await pause(350);

  const beforeDirtyBack = await inspect(window);
  await page(window, `(() => { window.__pandaStageIssue903BackConfirmCalls = []; window.confirm = (message) => { window.__pandaStageIssue903BackConfirmCalls.push(String(message)); return false; }; })()`);
  const dirtyBackDeclinePointer = await clickPoint(window, '[data-testid="adaptive-parts-back-to-list"]', 'Decline dirty top-Back and keep editing');
  await waitFor(window, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]'))`, 'Declining dirty top-Back closed the assembly workbench.');
  const afterDirtyBackDecline = await inspect(window);
  const declinedBackPrompts = await page(window, 'window.__pandaStageIssue903BackConfirmCalls ?? []');
  assert(declinedBackPrompts.length === 1 && afterDirtyBackDecline.revision === beforeDirtyBack.revision && afterDirtyBackDecline.dirty === beforeDirtyBack.dirty && afterDirtyBackDecline.undoCount === beforeDirtyBack.undoCount, 'Declining dirty top-Back changed the Project or History.');
  await page(window, `(() => { window.confirm = (message) => { window.__pandaStageIssue903BackConfirmCalls.push(String(message)); return true; }; })()`);
  const dirtyBackAcceptPointer = await clickPoint(window, '[data-testid="adaptive-parts-back-to-list"]', 'Accept dirty top-Back and return to Characters');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="character-list-view"]')`, 'Accepting dirty top-Back did not return to the Character list.');
  const afterDirtyBackAccept = await inspect(window);
  const drawerAfterDirtyBack = await page(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen ?? null`);
  const acceptedBackPrompts = await page(window, 'window.__pandaStageIssue903BackConfirmCalls ?? []');
  const dirtyBackObserved = {
    declinedPrompts: declinedBackPrompts.length,
    acceptedPrompts: acceptedBackPrompts.length,
    drawer: drawerAfterDirtyBack,
    before: { revision: beforeDirtyBack.revision, dirty: beforeDirtyBack.dirty, undoCount: beforeDirtyBack.undoCount },
    after: { revision: afterDirtyBackAccept.revision, dirty: afterDirtyBackAccept.dirty, undoCount: afterDirtyBackAccept.undoCount },
  };
  issue903.dirtyBack = { result: 'OBSERVED', declinePointer: dirtyBackDeclinePointer, acceptPointer: dirtyBackAcceptPointer, ...dirtyBackObserved };
  receipt.issue903 = issue903;
  assert(acceptedBackPrompts.length === 2 && drawerAfterDirtyBack === 'true' && afterDirtyBackAccept.revision === beforeDirtyBack.revision && afterDirtyBackAccept.dirty === beforeDirtyBack.dirty && afterDirtyBackAccept.undoCount === beforeDirtyBack.undoCount, `Accepting dirty top-Back did not preserve the Project, History, and visible Character list: ${JSON.stringify(dirtyBackObserved)}.`);
  await captureWhole(window, 'issue903-dirty-back-decline-accept.png');
  issue903.dirtyBack = { result: 'PASS', declinePointer: dirtyBackDeclinePointer, acceptPointer: dirtyBackAcceptPointer, ...dirtyBackObserved, projectAndHistoryPreserved: true };
  receipt.issue903 = issue903;
  checks.ui01 = { result: 'PASS', parts: c0Rows.length, directVisibilityCreatedNoProjectHistory: true, inlineRenameEnterEscapeAndBlankValidation: 'PASS', rejectedRenameRetainedInputAndError: true, sourceRestoreWasPartLocal: true, dirtyBackDeclineAndAccept: 'PASS' };
  checks.ui02 = { result: 'PASS', wideListWidth: wideRowGeometry.listWidth, com3AndCom4: wideRowGeometry.rows, direct44pxControls: true };

  await ensureCharacterListReady(window, characterRail, characterList, 'C0 after cancel');
  await click(window, adaptiveCard, 'Open a fresh C0 assembly draft');
  await waitFor(window, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]').length === 5`, 'Fresh C0 assembly did not reopen.');
  const applyPartId = c0Rows[0].partId;
  const applyRow = `[data-testid="adaptive-parts-assembly-row"][data-part-id="${applyPartId}"]`;
  await click(window, `${applyRow} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select a Part for precision Apply');
  await click(window, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open precision inspector');
  for (const [testId, value, nextTestId] of [
    ['adaptive-parts-offset-x', '12.345', 'adaptive-parts-offset-y'],
    ['adaptive-parts-offset-y', '7.891', 'adaptive-parts-scale-percent'],
    ['adaptive-parts-scale-percent', '110.25', 'adaptive-parts-rotation-deg'],
    ['adaptive-parts-rotation-deg', '12.375', 'adaptive-parts-inspector-close'],
  ]) {
    await replaceInputText(window, `[data-testid="${testId}"]`, value);
    if (testId === 'adaptive-parts-rotation-deg') {
      await page(window, `document.querySelector('[data-testid="adaptive-parts-rotation-deg"]')?.blur()`);
    }
    await click(window, `[data-testid="${nextTestId}"]`, `Commit ${testId} and continue`);
  }
  await click(window, '[data-testid="adaptive-parts-inspector-toggle"]', 'Reopen precision inspector');
  const conciseValues = await page(window, `Object.fromEntries(['adaptive-parts-offset-x','adaptive-parts-offset-y','adaptive-parts-scale-percent','adaptive-parts-rotation-deg'].map((id) => [id, document.querySelector('[data-testid="' + id + '"]')?.value ?? null]))`);
  assert(JSON.stringify(Object.values(conciseValues)) === JSON.stringify(['12.3', '7.9', '110.3', '12.4']), `Inspector rounded display is unexpected: ${JSON.stringify(conciseValues)}.`);
  await renameAdaptivePart(window, applyRow, 'C0 精确微调部件');
  const actionGeometry = await page(window, `(() => {
    const footer = document.querySelector('.adaptive-parts-assembly-footer');
    const cancel = footer?.querySelector('[data-testid="adaptive-parts-assembly-cancel"]')?.getBoundingClientRect();
    const apply = footer?.querySelector('[data-testid="adaptive-parts-assembly-apply"]')?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return { footer: footerRect ? { x: footerRect.x, y: footerRect.y, right: footerRect.right, bottom: footerRect.bottom } : null, cancel: cancel ? { x: cancel.x, y: cancel.y, right: cancel.right, bottom: cancel.bottom } : null, apply: apply ? { x: apply.x, y: apply.y, right: apply.right, bottom: apply.bottom } : null, disabled: Boolean(footer?.querySelector('[data-testid="adaptive-parts-assembly-apply"]')?.disabled) };
  })()`);
  assert(actionGeometry.cancel && actionGeometry.apply && !actionGeometry.disabled && actionGeometry.apply.right <= actionGeometry.footer.right + 1 && actionGeometry.apply.right >= actionGeometry.footer.right - 24, `Apply/Cancel are not available at the workbench lower-right: ${JSON.stringify(actionGeometry)}.`);
  await captureWhole(window, 'issue901-ui04-bottom-right-actions.png');
  const beforeApply = await inspect(window);
  await click(window, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply precise Adaptive Parts edits');
  await waitFor(window, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="adaptive-parts-assembly-apply"]')`, 'Apply did not keep the committed assembly available for further edits.');
  const afterApply = await inspect(window);
  const appliedCharacter = afterApply.project.characters.find((character) => character.id === adaptiveCharacterId);
  const appliedPart = appliedCharacter?.mode === 'adaptive-parts' ? appliedCharacter.parts.find((part) => part.partId === applyPartId) : null;
  assert(afterApply.revision === beforeApply.revision + 1 && afterApply.undoCount === beforeApply.undoCount + 1, 'Apply did not create exactly one Project revision and History entry.');
  assert(appliedPart?.displayName === 'C0 精确微调部件' && appliedPart.staticAdjustment?.offsetX === 12.345 && appliedPart.staticAdjustment?.offsetY === 7.891 && appliedPart.staticAdjustment?.scale === 1.1025 && appliedPart.staticAdjustment?.rotationDeg === 12.375, `Apply lost the exact inline name or numeric precision: ${JSON.stringify(appliedPart)}.`);
  await expandProjectActions(window);
  await click(window, '[data-testid="quick-action-history"] [aria-label="撤销"]', 'Undo applied Adaptive Parts edits');
  const afterUndo = await inspect(window);
  const undoneCharacter = afterUndo.project.characters.find((character) => character.id === adaptiveCharacterId);
  const undonePart = undoneCharacter?.mode === 'adaptive-parts' ? undoneCharacter.parts.find((part) => part.partId === applyPartId) : null;
  assert(undonePart?.displayName === 'com3' && undonePart.staticAdjustment?.offsetX === 0, 'Undo did not restore the original Adaptive Part name and adjustment.');
  await click(window, '[data-testid="quick-action-history"] [aria-label="重做"]', 'Redo applied Adaptive Parts edits');
  const afterRedo = await inspect(window);
  const redoneCharacter = afterRedo.project.characters.find((character) => character.id === adaptiveCharacterId);
  const redonePart = redoneCharacter?.mode === 'adaptive-parts' ? redoneCharacter.parts.find((part) => part.partId === applyPartId) : null;
  assert(redonePart?.displayName === 'C0 精确微调部件' && redonePart.staticAdjustment?.offsetX === 12.345 && redonePart.staticAdjustment?.rotationDeg === 12.375, 'Redo did not restore the exact Adaptive Part edit.');
  checks.ui03 = { result: 'PASS', displayedValues: conciseValues, exactAppliedValues: appliedPart.staticAdjustment, undoRedo: 'PASS' };
  checks.ui04 = { result: 'PASS', lowerRightActions: actionGeometry, applyCreatedOneRevisionAndHistoryEntry: true, cancelPreservedProjectAndHistory: true, viewAllLabel: '查看全貌' };

  const beforeCleanJoin = await inspect(window);
  const cleanJoinShot = beforeCleanJoin.project.shots[0];
  const cleanJoinLayerIds = new Set(cleanJoinShot.layers.map((layer) => layer.id));
  await page(window, `(() => { window.__pandaStageIssue903CleanJoinConfirmCalls = []; window.confirm = (message) => { window.__pandaStageIssue903CleanJoinConfirmCalls.push(String(message)); return true; }; })()`);
  const cleanJoinPointer = await clickPoint(window, '[data-testid="adaptive-parts-join-current-shot"]', 'Join the clean Adaptive Parts Character to the current Shot');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="character-list-view"]')`, 'A clean Shot join did not return to the Character list.');
  const afterCleanJoin = await inspect(window);
  const cleanJoinShotAfter = afterCleanJoin.project.shots.find((shot) => shot.id === cleanJoinShot.id);
  const cleanJoinedLayer = cleanJoinShotAfter?.layers.find((layer) => !cleanJoinLayerIds.has(layer.id));
  const cleanJoinPrompts = await page(window, 'window.__pandaStageIssue903CleanJoinConfirmCalls ?? []');
  assert(cleanJoinPrompts.length === 0 && afterCleanJoin.revision === beforeCleanJoin.revision + 1 && afterCleanJoin.undoCount === beforeCleanJoin.undoCount + 1 && cleanJoinShotAfter?.layers.length === cleanJoinShot.layers.length + 1 && cleanJoinedLayer?.source.kind === 'character' && cleanJoinedLayer.source.characterId === adaptiveCharacterId, `A clean coordinate-click Shot join did not add exactly one Character Layer: ${JSON.stringify({ cleanJoinPrompts, before: { revision: beforeCleanJoin.revision, undoCount: beforeCleanJoin.undoCount, layerCount: cleanJoinShot.layers.length }, after: { revision: afterCleanJoin.revision, undoCount: afterCleanJoin.undoCount, layerCount: cleanJoinShotAfter?.layers.length }, joinedSource: cleanJoinedLayer?.source })}.`);
  await captureWhole(window, 'issue903-clean-shot-join.png');
  issue903.cleanJoin = { result: 'PASS', pointer: cleanJoinPointer, confirmationPrompts: cleanJoinPrompts.length, revisionDelta: 1, historyDelta: 1, joinedSource: cleanJoinedLayer.source };

  await ensureCharacterListReady(window, characterRail, characterList, 'Character list before dirty Shot join');
  await clickPoint(window, adaptiveCard, 'Open C0 for dirty Shot join confirmation');
  await waitFor(window, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]').length === 5`, 'C0 did not reopen for dirty Shot join.');
  const beforeDirtyJoinEdit = await inspect(window);
  await clickPoint(window, firstEye, 'Make the C0 draft dirty before Shot join');
  await waitFor(window, `document.querySelector(${JSON.stringify(firstEye)})?.getAttribute('aria-pressed') === 'false'`, 'The C0 draft did not become dirty before Shot join.');
  const beforeDirtyJoin = await inspect(window);
  const dirtyJoinShot = beforeDirtyJoin.project.shots.find((shot) => shot.id === beforeDirtyJoinEdit.currentShotId) ?? beforeDirtyJoin.project.shots[0];
  const dirtyJoinLayerIds = new Set(dirtyJoinShot.layers.map((layer) => layer.id));
  await page(window, `(() => { window.__pandaStageIssue903JoinConfirmCalls = []; window.confirm = (message) => { window.__pandaStageIssue903JoinConfirmCalls.push(String(message)); return false; }; })()`);
  const dirtyJoinDeclinePointer = await clickPoint(window, '[data-testid="adaptive-parts-join-current-shot"]', 'Decline dirty Shot join and keep the C0 draft');
  await waitFor(window, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]'))`, 'Declining dirty Shot join closed the assembly workbench.');
  const afterDirtyJoinDecline = await inspect(window);
  const declinedJoinPrompts = await page(window, 'window.__pandaStageIssue903JoinConfirmCalls ?? []');
  const declinedJoinShot = afterDirtyJoinDecline.project.shots.find((shot) => shot.id === dirtyJoinShot.id);
  assert(declinedJoinPrompts.length === 1 && afterDirtyJoinDecline.revision === beforeDirtyJoin.revision && afterDirtyJoinDecline.dirty === beforeDirtyJoin.dirty && afterDirtyJoinDecline.undoCount === beforeDirtyJoin.undoCount && declinedJoinShot?.layers.length === dirtyJoinShot.layers.length, 'Declining dirty Shot join changed the Project, History, or Shot Layers.');
  await page(window, `(() => { window.confirm = (message) => { window.__pandaStageIssue903JoinConfirmCalls.push(String(message)); return true; }; })()`);
  const dirtyJoinAcceptPointer = await clickPoint(window, '[data-testid="adaptive-parts-join-current-shot"]', 'Accept dirty Shot join and place the Character');
  await waitFor(window, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="character-list-view"]')`, 'Accepting dirty Shot join did not return to the Character list.');
  const afterDirtyJoinAccept = await inspect(window);
  const acceptedJoinShot = afterDirtyJoinAccept.project.shots.find((shot) => shot.id === dirtyJoinShot.id);
  const acceptedJoinedLayer = acceptedJoinShot?.layers.find((layer) => !dirtyJoinLayerIds.has(layer.id));
  const acceptedJoinPrompts = await page(window, 'window.__pandaStageIssue903JoinConfirmCalls ?? []');
  assert(acceptedJoinPrompts.length === 2 && afterDirtyJoinAccept.revision === beforeDirtyJoin.revision + 1 && afterDirtyJoinAccept.undoCount === beforeDirtyJoin.undoCount + 1 && acceptedJoinShot?.layers.length === dirtyJoinShot.layers.length + 1 && acceptedJoinedLayer?.source.kind === 'character' && acceptedJoinedLayer.source.characterId === adaptiveCharacterId, `Accepting dirty Shot join did not place exactly one Character Layer: ${JSON.stringify({ acceptedJoinPrompts, before: { revision: beforeDirtyJoin.revision, undoCount: beforeDirtyJoin.undoCount, layerCount: dirtyJoinShot.layers.length }, after: { revision: afterDirtyJoinAccept.revision, undoCount: afterDirtyJoinAccept.undoCount, layerCount: acceptedJoinShot?.layers.length }, joinedSource: acceptedJoinedLayer?.source })}.`);
  await captureWhole(window, 'issue903-dirty-shot-join-decline-accept.png');
  issue903.dirtyJoin = { result: 'PASS', declinePointer: dirtyJoinDeclinePointer, acceptPointer: dirtyJoinAcceptPointer, declinedPrompts: 1, acceptedPrompts: acceptedJoinPrompts.length, declinePreservedDraftAndProject: true, acceptedRevisionDelta: 1, acceptedHistoryDelta: 1, joinedSource: acceptedJoinedLayer.source };

  await ensureCharacterListReady(window, characterRail, characterList, 'Character list before long-list checks');
  await clickPoint(window, longListCard, 'Open repeated-image long-list control');
  await waitFor(window, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]').length === 24`, 'Long-list workbench did not render 24 rows.');
  await page(window, `(() => { const rows = document.querySelector(${JSON.stringify(listRows)}); if (rows) rows.scrollTop = rows.scrollHeight; })()`);
  await waitFor(window, `(() => { const rows = document.querySelector(${JSON.stringify(listRows)}); return Boolean(rows && rows.scrollHeight > rows.clientHeight && rows.scrollTop > 0); })()`, 'The internal Part list did not scroll independently.');
  const longListLastPartId = await page(window, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-row"]')[23]?.dataset.partId ?? null`);
  assert(longListLastPartId, 'The repeated-image list has no last row.');
  const longListLastRow = `[data-testid="adaptive-parts-assembly-row"][data-part-id="${longListLastPartId}"]`;
  await click(window, `${longListLastRow} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select last long-list Part');
  await click(window, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open floating inspector for selected long-list Part');
  const inspectorGeometry = await page(window, `(() => {
    const panel = document.querySelector('.adaptive-parts-assembly-inspector')?.getBoundingClientRect();
    const part = document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected')?.getBoundingClientRect();
    const canvas = document.querySelector('[data-testid="adaptive-parts-assembly-canvas"]')?.getBoundingClientRect();
    if (!panel || !part || !canvas) return null;
    const width = Math.max(0, Math.min(panel.right, part.right) - Math.max(panel.left, part.left));
    const height = Math.max(0, Math.min(panel.bottom, part.bottom) - Math.max(panel.top, part.top));
    return { overlapArea: width * height, insideCanvas: panel.left >= canvas.left && panel.top >= canvas.top && panel.right <= canvas.right && panel.bottom <= canvas.bottom, placement: document.querySelector('.adaptive-parts-assembly-inspector')?.dataset.position ?? '' };
  })()`);
  assert(inspectorGeometry?.insideCanvas && inspectorGeometry.overlapArea === 0, `Floating inspector covers the selected Part or escapes the canvas: ${JSON.stringify(inspectorGeometry)}.`);
  await captureWhole(window, 'issue901-ui02-long-list-inspector.png');
  checks.ui02.narrow880 = narrowRowGeometry;
  checks.ui02.longList = { rows: 24, scrollable: true, selectedLastPartId: longListLastPartId, inspector: inspectorGeometry };
  checks.issue903 = issue903;
  checks.screenshots = (await fsp.readdir(evidenceRoot)).filter((file) => /^issue(?:901|903)-.*\.png$/u.test(file)).map((file) => path.join(evidenceRoot, file));
  receipt.uiA = checks;
  receipt.issue903 = issue903;
  receipt.ownerAcceptance = 'NOT_ATTESTED: physical Cloud Touch input and Owner review were not performed.';
  receipt.auto = 'AUTO_PASS';
  receipt.status = 'UI_A_AUTO_PASS_OWNER_REVIEW_PENDING';
  receipt.completedAt = new Date().toISOString();
  await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

function alphaBounds(bitmap, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bitmap[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  assert(right >= left && bottom >= top, 'C0 source layer contains no opaque pixels.');
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function prepareImportedProject() {
  assert(sourceDir, 'Set PANDA_STAGE_ISSUE899_SOURCE_DIR to the local Issue #893 isolated-layers directory.');
  await fsp.access(sourceDir);
  await fsp.mkdir(path.dirname(projectRoot), { recursive: true });
  await fsp.mkdir(cropRoot, { recursive: true });
  const candidateRecords = [];
  const cropEvidence = [];
  for (const record of sourceRecords) {
    const sourcePath = path.join(sourceDir, record.fileName);
    const sourceImage = nativeImage.createFromPath(sourcePath);
    const size = sourceImage.getSize();
    assert(size.width === 1920 && size.height === 1080, `${record.fileName} is ${size.width}x${size.height}; expected the C0 full-stage layer frame.`);
    const bounds = alphaBounds(sourceImage.toBitmap(), size.width, size.height);
    const croppedImage = sourceImage.crop(bounds);
    const cropPath = path.join(cropRoot, `${record.sourceName}-crop.png`);
    await fsp.writeFile(cropPath, croppedImage.toPNG());
    const cropSize = croppedImage.getSize();
    assert(cropSize.width === bounds.width && cropSize.height === bounds.height, `${record.sourceName} alpha crop dimensions changed.`);
    candidateRecords.push({ ...record, sourcePath, cropPath, bounds });
    cropEvidence.push({ sourceId: record.sourceId, fileName: record.fileName, size, alphaCrop: bounds, cropPath });
  }
  const backgroundPath = path.join(cropRoot, 'synthetic-canvas-background.png');
  await fsp.writeFile(backgroundPath, encodeSolidPng(1920, 1080, [34, 42, 54, 255]));
  const bodyArmPath = path.join(cropRoot, 'synthetic-body-arm-composite.png');
  await fsp.writeFile(bodyArmPath, encodeSyntheticBodyArmPng());

  const setupProjectService = new ProjectService();
  const created = await setupProjectService.create(projectRoot, {
    name: issue901UiA ? 'Issue 901 UI C0 Adaptive Parts' : 'Issue 899 C3 C0 Adaptive Parts',
  });
  let importSnapshot = { project: created.project, revision: 0 };
  const importService = new AssetImportService({
    projectService: setupProjectService,
    getCurrentProjectSnapshot: (root) =>
      path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase()
        ? structuredClone(importSnapshot)
        : null,
  });
  const operation = await importService.importCandidates({
    projectRoot,
    project: created.project,
    baseRevision: 0,
    candidates: [
      ...candidateRecords.map((record) => ({ sourcePath: record.cropPath, declaredMimeType: 'image/png' })),
      { sourcePath: backgroundPath, declaredMimeType: 'image/png' },
      { sourcePath: bodyArmPath, declaredMimeType: 'image/png' },
    ],
  });
  assert(operation.projectChanged && operation.savedRevision === 1, 'Production AssetImportService did not commit the five source PNG crops and local synthetic assets.');
  assert(operation.results.length === 7 && operation.results.every((result) => result.asset && ['imported', 'duplicate'].includes(result.status)), 'Production AssetImportService did not resolve every C0 source image and synthetic asset.');
  importSnapshot = { project: operation.project, revision: operation.savedRevision };

  const assetBySourceId = new Map(candidateRecords.map((record, index) => [record.sourceId, operation.results[index].asset]));
  const backgroundAsset = operation.results[5]?.asset;
  assert(backgroundAsset?.kind === 'image', 'The local synthetic background did not enter through AssetImportService.');
  const bodyArmAsset = operation.results[6]?.asset;
  assert(bodyArmAsset?.kind === 'image' && bodyArmAsset.width === 320 && bodyArmAsset.height === 440, 'The local Body+Arm fixture did not enter through AssetImportService at its authored dimensions.');
  const parts = candidateRecords.map((record) => {
    const asset = assetBySourceId.get(record.sourceId);
    assert(asset?.kind === 'image', `Imported source ${record.sourceId} is not a project image asset.`);
    return {
      partId: require('node:crypto').randomUUID(),
      assetId: asset.id,
      source: { kind: 'source-instance', sourceId: record.sourceId, sourcePoseFrame: 0, effectiveFrame: 0 },
      restTransform: { ...sourceRestTransform },
      sourceRestTransform: { ...sourceRestTransform },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: 1920,
        sourceHeight: 1080,
        crop: { ...record.bounds },
        exportScale: 1,
      },
      drawOrder: record.drawOrder,
      visible: true,
      displayName: record.sourceName,
    };
  });
  const characterService = new CharacterService();
  let project = characterService.createAdaptiveParts(operation.project, {
    name: 'C0 五部件角色',
    sourceRootTransform: { ...sourceRootTransform },
    parts,
  });
  const adaptive = project.characters.find((candidate) => candidate.name === 'C0 五部件角色');
  assert(adaptive?.mode === 'adaptive-parts', 'CharacterService did not create the imported Adaptive Parts Character.');
  adaptiveCharacterId = adaptive.id;
  project = characterService.create(project, {
    name: 'C0 单图兼容控制',
    expressions: [{ name: 'Neutral', assetId: parts[0].assetId }],
  });
  singleImageCharacterId = project.characters.at(-1)?.id ?? null;
  project = characterService.createComposite(project, {
    name: 'C0 composite compatibility control',
    expressions: [{ name: 'Neutral', assetId: parts[3].assetId }],
    bodyAssetId: parts[0].assetId,
    facePlacement: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false },
    head: {
      assetId: parts[1].assetId,
      placement: { offsetX: 0, offsetY: -40, scale: 1, rotationDeg: 0, flipX: false },
      pivot: { x: 144, y: 322 },
    },
  });
  const compositeCharacterId = project.characters.at(-1)?.id ?? null;
  bodyArmPartId = require('node:crypto').randomUUID();
  project = characterService.createAdaptiveParts(project, {
    name: 'Synthetic Body+Arm Part control',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [{
      partId: bodyArmPartId,
      assetId: bodyArmAsset.id,
      source: { kind: 'manual', sourceId: 'synthetic/body-arm-composite' },
      restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 800, ty: 320 },
      sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 800, ty: 320 },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: bodyArmAsset.width,
        sourceHeight: bodyArmAsset.height,
        crop: { x: 0, y: 0, width: bodyArmAsset.width, height: bodyArmAsset.height },
        exportScale: 1,
      },
      drawOrder: 0,
      visible: true,
      displayName: 'Body+Arm',
    }],
  });
  const bodyArmCharacter = project.characters.at(-1);
  assert(bodyArmCharacter?.mode === 'adaptive-parts' && bodyArmCharacter.parts.length === 1, 'CharacterService did not create the synthetic Body+Arm as one Adaptive Part.');
  bodyArmCharacterId = bodyArmCharacter.id;

  const longListParts = Array.from({ length: 24 }, (_, index) => {
    const partId = require('node:crypto').randomUUID();
    const transform = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 680 + (index % 6) * 8,
      ty: 260 + Math.floor(index / 6) * 8,
    };
    return {
      partId,
      assetId: bodyArmAsset.id,
      source: { kind: 'manual', sourceId: `synthetic/repeated-image/${index + 1}` },
      restTransform: transform,
      sourceRestTransform: { ...transform },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: bodyArmAsset.width,
        sourceHeight: bodyArmAsset.height,
        crop: { x: 0, y: 0, width: bodyArmAsset.width, height: bodyArmAsset.height },
        exportScale: 1,
      },
      drawOrder: index,
      visible: true,
      displayName: `Repeated image Part ${String(index + 1).padStart(2, '0')}`,
    };
  });
  project = characterService.createAdaptiveParts(project, {
    name: 'Synthetic repeated-image long-list control',
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: longListParts,
  });
  const longListCharacter = project.characters.at(-1);
  assert(longListCharacter?.mode === 'adaptive-parts' && longListCharacter.parts.length === 24, 'CharacterService did not create the 24-Part repeated-image control.');
  longListCharacterId = longListCharacter.id;

  const shotService = new ShotService();
  project = shotService.create(project, { name: 'C0 C3 static assembly export', durationMs: 6_000 });
  const shot = project.shots.at(-1);
  assert(shot, 'ShotService did not create the six-second acceptance Shot.');
  const layerService = new LayerService();
  const backgroundLayer = layerService.createFromAsset(project, shot.id, {
    version: 2,
    type: 'asset-image',
    assetId: backgroundAsset.id,
    position: { x: 960, y: 540 },
  });
  project = layerService.setBackground(backgroundLayer.project, shot.id, backgroundLayer.layer.id);
  project = layerService.createFromAdaptiveCharacter(project, shot.id, adaptiveCharacterId, { x: 960, y: 540 }).project;
  await setupProjectService.save(projectRoot, ProjectSchema.parse(project));
  const persisted = await setupProjectService.open(projectRoot);
  const persistedCharacter = persisted.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
  assert(persistedCharacter?.mode === 'adaptive-parts' && persistedCharacter.parts.length === 5, 'Formal project save/reopen lost the five C0 source Parts.');

  return {
    project: persisted.project,
    projectService: setupProjectService,
    cropEvidence,
    backgroundPath,
    backgroundAssetId: backgroundAsset.id,
    bodyArmPath,
    bodyArmAssetId: bodyArmAsset.id,
    bodyArmCharacterId,
    bodyArmPartId,
    longListCharacterId,
    longListPartCount: longListParts.length,
    longListAssetId: bodyArmAsset.id,
    assetImport: {
      baseRevision: operation.baseRevision,
      savedRevision: operation.savedRevision,
      statuses: operation.results.map(({ sourceName, status, asset }) => ({ sourceName, status, assetId: asset?.id, width: asset?.width, height: asset?.height, sha256: asset?.sha256 })),
    },
    shotId: shot.id,
    compositeCharacterId,
    parts: persistedCharacter.parts,
  };
}

function registerProjectHandlers(projectService) {
  const rootMatches = (root) => path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase();
  register(IPC_CHANNELS.PROJECT_OPEN, async (_event, request) => {
    if (!rootMatches(request.projectRoot)) return { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'C0 evidence Project was not found.', projectRoot: request.projectRoot } };
    const document = await projectService.open(projectRoot);
    activeProject = document.project;
    trackedSnapshot = { project: activeProject, revision: 0, dirty: false, openInstanceId: null };
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, async (_event, request) => {
    assert(rootMatches(request.projectRoot), 'Project Save targeted an unexpected root.');
    const document = await projectService.save(projectRoot, ProjectSchema.parse(request.project), request.revision);
    activeProject = document.project;
    trackedSnapshot = { project: activeProject, revision: request.revision, dirty: false, openInstanceId: trackedSnapshot?.openInstanceId ?? null };
    return { ok: true, value: document };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, async () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, async () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN_FOLDER, async () => ({ ok: true }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, async () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, async (_event, request) => {
    assert(rootMatches(request.projectRoot), 'Recent Project open targeted an unexpected root.');
    const document = await projectService.open(projectRoot);
    assert(document.project.id === request.expectedProjectId, 'Reopened Project identity changed.');
    activeProject = document.project;
    trackedSnapshot = { project: activeProject, revision: 0, dirty: false, openInstanceId: null };
    return { ok: true, document };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, async (_event, request) => {
    if (rootMatches(request.projectRoot)) trackedSnapshot = { project: ProjectSchema.parse(request.project), revision: request.revision, dirty: request.dirty, openInstanceId: request.openInstanceId };
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, async (_event, request) => {
    if (rootMatches(request.projectRoot)) trackedSnapshot = { project: ProjectSchema.parse(request.project), revision: request.revision, dirty: request.dirty, openInstanceId: request.openInstanceId };
    return { ok: true };
  });
  register(IPC_CHANNELS.AUTOSAVE_STOP, async () => { trackedSnapshot = null; return { ok: true }; });
  register(IPC_CHANNELS.RECOVERY_DETECT, async () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, async () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, async (_event, request) => {
    const asset = activeProject?.assets.find((candidate) => candidate.id === request.assetId && candidate.sha256 === request.sha256);
    if (!asset) return { ok: true, status: 'missing', assetId: request.assetId };
    const bytes = await fsp.readFile(path.join(projectRoot, asset.relativePath));
    return { ok: true, status: 'ready', assetId: asset.id, dataUrl: `data:${asset.mimeType};base64,${bytes.toString('base64')}` };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, async (_event, request) => {
    const asset = activeProject?.assets.find((candidate) => candidate.id === request.assetId && candidate.kind === 'image' && candidate.sha256 === request.sha256);
    if (!asset) return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'Local C0 image asset is unavailable.', assetId: request.assetId } };
    assetCanvasImageReadCounts.set(asset.id, (assetCanvasImageReadCounts.get(asset.id) ?? 0) + 1);
    let bytes;
    try {
      bytes = await fsp.readFile(path.join(projectRoot, asset.relativePath));
    } catch {
      return { ok: false, error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED', message: 'The local image source could not be read.', assetId: asset.id } };
    }
    assetBytes.set(asset.id, bytes);
    return { ok: true, status: 'ready', assetId: asset.id, mimeType: asset.mimeType, width: asset.width, height: asset.height, byteLength: bytes.length, bytes: new Uint8Array(bytes) };
  });
}

function registerExportServices() {
  const mediaTools = resolveMediaToolPaths({ isPackaged: false, resourcesPath: process.resourcesPath });
  exportFileSystem = new FileSystemService(path.join(runRoot, 'frame-jobs'));
  hiddenWindowManager = new HiddenWindowManager();
  const mediaAdapter = new FFmpegAdapter({ ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath });
  const fileStore = new NodeExportPreparationFileStore(path.join(runRoot, 'frozen-media'));
  exportPreparationService = new ExportPreparationService({
    getCurrentProjectSnapshot: (root) => trackedSnapshot && path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase() ? structuredClone(trackedSnapshot) : null,
    assertFormalOutputLocation: (target) => exportFileSystem.assertFormalOutputLocation(target),
    fileStore,
    mediaReader: new MainProjectAssetReader(),
  });
  exportService = new ExportService(hiddenWindowManager, exportFileSystem, mediaAdapter);
  exportService.subscribe((update) => {
    jobUpdates.push(update);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.EXPORT_JOB_UPDATE, update);
  });
  registerExportPreparationIpcHandlers({ getMainWindow: () => mainWindow, service: exportPreparationService, selectOutputPath: async () => outputPath });
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getHiddenWindow: () => hiddenWindowManager.getWindow(),
    markHiddenReady: (senderId) => hiddenWindowManager.markReady(senderId),
    markProbeLoaded: (senderId, request) => hiddenWindowManager.markProbeLoaded(senderId, request),
    markFormalLoaded: (senderId, request) => hiddenWindowManager.markFormalLoaded(senderId, request),
    markFrameReady: (senderId, request) => hiddenWindowManager.markFrameReady(senderId, request),
    markFrameFailed: (senderId, request) => hiddenWindowManager.markFrameFailed(senderId, request),
    startFullProbe: (request) => {
      const handle = exportService.startFullProbe(request);
      void handle.completion.catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    startFormalExport: async (request) => {
      const input = await exportPreparationService.acquireCandidateForExport(request.snapshotId, request.reuseSnapshot);
      let handle;
      try {
        handle = exportService.startFormalExport(input, () => exportPreparationService.assertOutputTargetUnchanged(request.snapshotId));
      } catch (error) {
        await exportPreparationService.retainCandidateForRetry(request.snapshotId);
        throw error;
      }
      activeExportPromise = handle.completion;
      void handle.completion.then(
        () => exportPreparationService.finalizeCandidateExport(request.snapshotId),
        () => exportPreparationService.retainCandidateForRetry(request.snapshotId),
      ).catch(() => undefined);
      return { jobId: handle.jobId, status: 'running' };
    },
    cancelExport: (jobId) => ({ jobId, accepted: exportService.cancelJob(jobId), status: exportService.getJob(jobId)?.status ?? 'cancelled' }),
    revealExportOutput: async (jobId) => Boolean(exportService.getCompletedOutputPath(jobId)),
  });
  return mediaTools;
}

async function runProcess(executable, args, maxBuffer = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    child.stdout.on('data', (chunk) => { bytes += chunk.length; stdout.push(chunk); if (bytes > maxBuffer) child.kill(); });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      if (bytes > maxBuffer) reject(new Error(`${path.basename(executable)} output exceeded ${maxBuffer} bytes.`));
      else if (code !== 0) reject(new Error(`${path.basename(executable)} exited ${code}: ${result.stderr.toString('utf8').slice(-4_000)}`));
      else resolve(result);
    });
  });
}

async function seekEditor(window, requestedTimeMs) {
  const state = await page(window, `(() => {
    const scroll = document.querySelector('[data-testid="timeline-ruler-scroll"]');
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    if (!scroll || !track) throw new Error('Shot Timeline ruler is unavailable.');
    const duration = Number(track.dataset.duration);
    const pixelsPerMs = (track.getBoundingClientRect().width - 82) / duration;
    const targetPx = pixelsPerMs * ${requestedTimeMs};
    scroll.scrollLeft = Math.max(0, Math.min(targetPx - 80, scroll.scrollWidth - scroll.clientWidth));
    scroll.dispatchEvent(new Event('scroll'));
    return { pixelsPerMs };
  })()`);
  await pause(70);
  const point = await page(window, `(() => {
    const scroll = document.querySelector('[data-testid="timeline-ruler-scroll"]');
    const track = document.querySelector('[data-testid="timeline-ruler-track"]');
    const rect = track.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    return { x: rect.left + 2 + ${requestedTimeMs} * ${state.pixelsPerMs}, y: rect.top + 30, left: scrollRect.left, right: scrollRect.right };
  })()`);
  assert(point.x >= point.left + 2 && point.x <= point.right - 2, `Timeline seek point is outside the ruler: ${JSON.stringify(point)}.`);
  const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  const dpr = await page(window, 'window.devicePixelRatio');
  const inputScale = dpr / displayScale;
  const inputPoint = { x: Math.round(point.x * inputScale), y: Math.round(point.y * inputScale) };
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...inputPoint });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...inputPoint });
  await waitFor(window, `Math.abs(Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime) - ${requestedTimeMs}) <= 45`, `Timeline did not seek to ${requestedTimeMs}ms.`, 8_000);
  return page(window, `Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime ?? -1)`);
}

async function seekPreview(window, requestedTimeMs) {
  await page(window, `(() => {
    const input = document.querySelector('[data-testid="product-preview-scrubber"]');
    if (!input) throw new Error('Product Preview scrubber is unavailable.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(${requestedTimeMs}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(window, `Math.abs(Number(document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewTimeMs ?? document.querySelector('[data-testid="product-preview-scrubber"]')?.value) - ${requestedTimeMs}) <= 60`, `Product Preview did not seek to ${requestedTimeMs}ms.`, 8_000);
  return page(window, `Number(document.querySelector('[data-testid="product-preview-scrubber"]')?.value ?? -1)`);
}

async function decodeRgb(ffmpegPath, imagePath) {
  const result = await runProcess(ffmpegPath, ['-v', 'error', '-i', imagePath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  return result.stdout;
}

async function verifyBodyArmOverlayOrdering(ffmpegPath) {
  const fixtureRoot = path.join(cropRoot, 'body-arm-overlay-pixel-fixture');
  await fsp.mkdir(fixtureRoot, { recursive: true });
  const backPath = path.join(fixtureRoot, 'com2-back.png');
  const frontPath = path.join(fixtureRoot, 'com5-front.png');
  const outputPath = path.join(fixtureRoot, 'com2-back-com5-front.png');
  const bodyPixels = [];
  const armPixels = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x <= 2 && y <= 2) bodyPixels.push([x, y]);
      if (x >= 1 && y >= 1) armPixels.push([x, y]);
    }
  }
  await fsp.writeFile(backPath, encodeMaskedOverlayPng(4, 4, [230, 30, 20, 255], bodyPixels));
  await fsp.writeFile(frontPath, encodeMaskedOverlayPng(4, 4, [15, 70, 240, 255], armPixels));
  const byName = new Map([
    ['com2', { sourceName: 'com2', drawOrder: 1, sourcePath: backPath }],
    ['com5', { sourceName: 'com5', drawOrder: 2, sourcePath: frontPath }],
  ]);
  const [back, front] = orderedBodyArmRecords(byName);
  assert(back.sourceName === 'com2' && front.sourceName === 'com5',
    `Body+Arm Parts are not ordered by drawOrder: ${back.sourceName}, ${front.sourceName}.`);
  await runProcess(ffmpegPath, bodyArmOverlayArgs(back.sourcePath, front.sourcePath, outputPath));
  const decoded = await runProcess(ffmpegPath, [
    '-v', 'error', '-i', outputPath, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ]);
  const pixel = (x, y) => [...decoded.stdout.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  const overlap = pixel(1, 1);
  const backOnly = pixel(0, 0);
  const transparent = pixel(3, 0);
  assert(JSON.stringify(overlap) === JSON.stringify([15, 70, 240, 255]),
    `The higher-drawOrder com5 PNG is not in front at overlap: ${JSON.stringify(overlap)}.`);
  assert(JSON.stringify(backOnly) === JSON.stringify([230, 30, 20, 255]),
    `The back com2 PNG did not remain visible through transparent com5 pixels: ${JSON.stringify(backOnly)}.`);
  assert(transparent[3] === 0,
    `The synthetic Body+Arm output did not preserve fully transparent pixels: ${JSON.stringify(transparent)}.`);
  return {
    result: 'PASS',
    order: [{ sourceName: back.sourceName, drawOrder: back.drawOrder }, { sourceName: front.sourceName, drawOrder: front.drawOrder }],
    overlapRgba: overlap,
    backOnlyRgba: backOnly,
    transparentRgba: transparent,
    fixturePaths: { backPath, frontPath, outputPath },
  };
}

async function comparePngs(ffmpegPath, referencePath, candidatePath) {
  const [reference, candidate] = await Promise.all([decodeRgb(ffmpegPath, referencePath), decodeRgb(ffmpegPath, candidatePath)]);
  assert(reference.length === candidate.length && reference.length > 0, `Pixel comparison dimensions differ: ${referencePath} vs ${candidatePath}.`);
  let total = 0;
  let maximum = 0;
  let pixelsAboveFive = 0;
  for (let offset = 0; offset < reference.length; offset += 3) {
    let pixelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(reference[offset + channel] - candidate[offset + channel]);
      total += difference;
      pixelDifference += difference;
      maximum = Math.max(maximum, difference);
    }
    if (pixelDifference / 3 > 5) pixelsAboveFive += 1;
  }
  const pixels = reference.length / 3;
  return {
    referencePath,
    candidatePath,
    width: 1920,
    height: 1080,
    meanAbsoluteChannelDifference: Number((total / reference.length).toFixed(3)),
    maxChannelDifference: maximum,
    pixelsOver5DifferencePercent: Number((pixelsAboveFive * 100 / pixels).toFixed(3)),
  };
}

async function normalizePng(ffmpegPath, sourcePath, fileName) {
  const target = path.join(evidenceRoot, fileName);
  await runProcess(ffmpegPath, ['-y', '-v', 'error', '-i', sourcePath, '-vf', 'scale=1920:1080:flags=bilinear', '-frames:v', '1', target]);
  return target;
}

async function captureExportFrames(ffmpegPath, ffprobePath) {
  const rawProbe = await runProcess(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', outputPath]);
  const probe = JSON.parse(rawProbe.stdout.toString('utf8'));
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  assert(video, 'FFprobe found no video stream in the formal MP4.');
  const frameCount = Number(video.nb_read_frames ?? video.nb_frames);
  const fpsParts = String(video.avg_frame_rate ?? '0/1').split('/');
  const fps = Number(fpsParts[0]) / Number(fpsParts[1] || 1);
  assert(video.codec_name === 'h264' && video.width === 1920 && video.height === 1080, 'Formal export is not a 1920x1080 H.264 MP4.');
  assert(Math.abs(fps - 24) < 0.001 && frameCount === 144, `Formal MP4 has ${fps}fps and ${frameCount} frames; expected 24fps and 144 frames.`);
  const frames = {};
  for (const sample of sampleTimes) {
    const framePath = path.join(evidenceRoot, `export-${sample.name}-frame-${String(sample.frame).padStart(3, '0')}.png`);
    await runProcess(ffmpegPath, ['-y', '-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${sample.frame})`, '-vsync', '0', '-frames:v', '1', framePath]);
    assert((await fsp.stat(framePath)).size > 1_000, `Export ${sample.name} frame is empty.`);
    frames[sample.name] = framePath;
  }
  return { probe, frameCount, fps, frames };
}

async function main() {
  await fsp.mkdir(evidenceRoot, { recursive: true });
  const prepared = await prepareImportedProject();
  activeProject = prepared.project;
  const adaptive = activeProject.characters.find((candidate) => candidate.id === adaptiveCharacterId);
  assert(adaptive?.mode === 'adaptive-parts', 'The prepared C0 Character is unavailable.');
  const sourcePartIds = Object.fromEntries(adaptive.parts.map((part) => [part.source.sourceId, part.partId]));
  const projectService = new ProjectService({
    getCurrentProjectSnapshot: (root) => trackedSnapshot && path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase() ? structuredClone(trackedSnapshot) : null,
    onProjectSaved: (root, project, revision) => {
      if (revision !== undefined && path.resolve(root).toLowerCase() === path.resolve(projectRoot).toLowerCase()) trackedSnapshot = { ...(trackedSnapshot ?? {}), project, revision, dirty: false };
    },
  });
  registerProjectHandlers(projectService);
  const mediaTools = issue901UiA ? null : registerExportServices();
  const bodyArmOverlayPixelFixture = mediaTools
    ? await verifyBodyArmOverlayOrdering(mediaTools.ffmpegPath)
    : null;
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.webContents.on('console-message', (...args) => {
    const details = args[1];
    rendererDiagnostics.push({
      level: typeof details === 'object' ? details?.level : details,
      message: typeof details === 'object' ? details?.message : args[2],
      lineNumber: typeof details === 'object' ? details?.lineNumber : args[3],
      sourceId: typeof details === 'object' ? details?.sourceId : args[4],
    });
    if (rendererDiagnostics.length > 150) rendererDiagnostics.shift();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererDiagnostics.push({ kind: 'render-process-gone', details });
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    rendererDiagnostics.push({ kind: 'did-fail-load', errorCode, errorDescription, validatedURL, isMainFrame });
  });
  mainWindow.on('close', (event) => {
    rendererDiagnostics.push({ kind: 'window-close', defaultPrevented: event.defaultPrevented });
  });
  mainWindow.on('closed', () => {
    rendererDiagnostics.push({ kind: 'window-closed' });
  });
  mainWindow.on('unresponsive', () => {
    rendererDiagnostics.push({ kind: 'unresponsive' });
  });
  mainWindow.setSize(1660, 1100);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const receipt = {
    issue: issue903BackProbe ? 903 : issue901UiA ? 901 : 899,
    checkpoint: issue903BackProbe
      ? issue903BackProbeBaseline ? 'NAV-BACK pre-fix baseline' : 'NAV-BACK post-fix 880px regression'
      : issue901UiA ? 'UI-A' : 'C3 V0',
    startedAt: new Date().toISOString(),
    runId,
    branch: require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    headAtRun: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    sample: {
      provenance: 'Local Issue #893 C0 same-frame frame-0 isolated layer PNGs; crops are produced locally and are not copied to the repository or GitHub.',
      sourceDir,
      projectPath: path.join(projectRoot, 'project.json'),
      projectId: activeProject.id,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      durationMs: activeProject.shots.find((shot) => shot.id === prepared.shotId)?.durationMs,
      sourceRootTransform,
      c0SourcePartOrder: ['c0/com6', 'c0/com2', 'c0/com5', 'c0/com4', 'c0/com3'],
      c0SourceMatricesByInstance: sourceRecords.map(({ sourceId, sourceMatrix, drawOrder }) => ({ sourceId, drawOrder, sourceMatrix })),
      cropEvidence: prepared.cropEvidence,
      syntheticBackgroundAssetId: prepared.backgroundAssetId,
      syntheticBackgroundPath: prepared.backgroundPath,
      syntheticBodyArmAssetId: prepared.bodyArmAssetId,
      syntheticBodyArmPath: prepared.bodyArmPath,
      syntheticBodyArmCharacterId: prepared.bodyArmCharacterId,
      syntheticBodyArmPartId: prepared.bodyArmPartId,
      assetImport: prepared.assetImport,
      adaptiveCharacterId,
      singleImageCharacterId,
      compositeCharacterId: prepared.compositeCharacterId,
      partIdsBySourceId: sourcePartIds,
      parts: adaptive.parts,
    },
    ...(bodyArmOverlayPixelFixture ? { bodyArmOverlayPixelFixture } : {}),
    evidenceRoot,
    outputPath,
    owner: 'NOT_ATTESTED',
    auto: 'RUNNING',
  };
  const ac09Checks = {};

  try {
    await openProject(mainWindow);
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.project?.id === ${JSON.stringify(activeProject.id)}`, 'The active editor Project differs from the imported C0 Project.');
    const initial = await inspect(mainWindow);
    assert(initial.revision === 0 && !initial.dirty && initial.undoCount === 0, 'Opening the C0 Project created unexpected dirty or history state.');
    const stageSelector = '[data-testid="project-canvas-stage"]';
    try {
      await waitFor(mainWindow, `(() => {
        const host = document.querySelector(${JSON.stringify(stageSelector)});
        return host && JSON.parse(host.dataset.renderedAssetIds ?? '[]').length >= 6 && JSON.parse(host.dataset.incompleteVisualLayerIds ?? '[]').length === 0 && [...host.querySelectorAll('canvas')].some((canvas) => canvas.width > 0 && canvas.height > 0);
      })()`, 'Initial C0 Stage did not finish loading its source Parts.', 10_000);
    } catch {
      const stageState = await page(mainWindow, `(() => {
        const host = document.querySelector(${JSON.stringify(stageSelector)});
        return host ? {
          dataset: { ...host.dataset },
          canvases: [...host.querySelectorAll('canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height })),
          text: host.innerText.slice(0, 800),
        } : null;
      })()`);
      throw new Error(`Initial C0 Stage did not finish loading its source Parts: ${JSON.stringify(stageState)}.`);
    }
    if (issue903BackProbe) {
      receipt.initialProjectState = {
        revision: initial.revision,
        dirty: initial.dirty,
        undoCount: initial.undoCount,
      };
      receipt.issue903NavBack01 = await verifyIssue903BackProbe(mainWindow);
      receipt.auto = 'PROBE_COMPLETE';
      receipt.status = receipt.issue903NavBack01.result;
      receipt.completedAt = new Date().toISOString();
      await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      return receipt;
    }
    if (issue901UiA) {
      receipt.initialProjectState = {
        revision: initial.revision,
        dirty: initial.dirty,
        undoCount: initial.undoCount,
      };
      await captureWhole(mainWindow, 'issue901-ui00-project-open.png');
      return await verifyIssue901UiA(mainWindow, prepared, receipt);
    }
    const initialStage = await captureCanvas(mainWindow, stageSelector, 'c0-stage-source-pose.png');
    const initialStageNormalized = await normalizePng(mediaTools.ffmpegPath, initialStage.path, 'c0-stage-source-pose-1920x1080.png');
    const c0ReferencePath = path.join(sourceDir, '..', 'same-frame-reconstructed.png');
    const c0ReferenceCompositedPath = path.join(evidenceRoot, 'c0-reference-on-test-background.png');
    await runProcess(mediaTools.ffmpegPath, [
      '-y', '-v', 'error', '-i', c0ReferencePath, '-i', prepared.backgroundPath,
      '-filter_complex', '[1:v][0:v]overlay=shortest=1:format=auto[out]',
      '-map', '[out]', '-frames:v', '1', c0ReferenceCompositedPath,
    ]);
    const c0BaselineComparison = await comparePngs(mediaTools.ffmpegPath, c0ReferenceCompositedPath, initialStageNormalized);
    assert(c0BaselineComparison.meanAbsoluteChannelDifference <= 4, `C0 source pose differs from the local same-frame reconstruction by mean ${c0BaselineComparison.meanAbsoluteChannelDifference}.`);
    receipt.c0BaselineComparison = { referencePath: c0ReferencePath, compositedReferencePath: c0ReferenceCompositedPath, canvas: initialStage.path, normalized: initialStageNormalized, ...c0BaselineComparison };

    const characterRail = '[data-testid="resource-activity-rail-characters"]';
    const characterList = '[data-testid="character-list-view"]';
    await click(mainWindow, characterRail, 'Characters activity');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(characterList)})`, 'Character list did not open.');
    const missingPartId = sourcePartIds['c0/com4'];
    const missingPart = adaptive.parts.find((part) => part.partId === missingPartId);
    const missingAsset = activeProject.assets.find((asset) => asset.id === missingPart?.assetId);
    assert(missingPart && missingAsset, 'C0 com4 source Asset was not available for the missing-source recovery check.');
    const missingAssetPath = path.join(projectRoot, missingAsset.relativePath);
    const unavailableAssetPath = `${missingAssetPath}.issue899-unavailable`;
    const priorMissingAssetReads = assetCanvasImageReadCounts.get(missingAsset.id) ?? 0;
    const beforeMissingAsset = await inspect(mainWindow);
    await fsp.rename(missingAssetPath, unavailableAssetPath);
    let missingAssetEvidence;
    try {
      await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'Open C0 Adaptive Parts with a missing source image');
      await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Adaptive Parts assembly workbench did not open for missing-source coverage.');
      const missingRowSelector = `.adaptive-parts-assembly-row[data-part-id="${missingPartId}"]`;
      const missingCanvasPartSelector = `[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${missingPartId}"]`;
      await waitFor(mainWindow, `(() => {
        const thumbnail = document.querySelector(${JSON.stringify(missingRowSelector)} + ' .adaptive-parts-assembly-thumbnail');
        return thumbnail?.dataset.thumbnailStatus === 'missing' &&
          thumbnail.querySelector('[data-thumbnail-icon="error"]') &&
          document.querySelectorAll('.adaptive-parts-assembly-row').length === 5 &&
          document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length === 4 &&
          !document.querySelector(${JSON.stringify(missingCanvasPartSelector)});
      })()`, 'A missing C0 source did not leave a visible error thumbnail and the other four rendered Parts.');
      const missingReadCount = assetCanvasImageReadCounts.get(missingAsset.id) ?? 0;
      assert(missingReadCount > priorMissingAssetReads, 'Adaptive assembly did not request the missing C0 source from the local project.');
      const missingThumbnail = await page(mainWindow, `(() => {
        const row = document.querySelector(${JSON.stringify(missingRowSelector)});
        const thumbnail = row?.querySelector('.adaptive-parts-assembly-thumbnail');
        const button = row?.querySelector('[data-testid="adaptive-parts-assembly-row-select"]');
        return {
          status: thumbnail?.dataset.thumbnailStatus ?? null,
          accessibleLabel: thumbnail?.getAttribute('aria-label') ?? null,
          errorIcon: Boolean(thumbnail?.querySelector('[data-thumbnail-icon="error"]')),
          rowVisible: Boolean(row?.getClientRects().length),
          selectable: Boolean(button && !button.disabled),
          canvasPartCount: document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length,
        };
      })()`);
      assert(missingThumbnail.status === 'missing' && missingThumbnail.accessibleLabel === '素材不可用' && missingThumbnail.errorIcon && missingThumbnail.rowVisible && missingThumbnail.selectable && missingThumbnail.canvasPartCount === 4,
        `Missing-source fallback did not preserve a clear, selectable Part row: ${JSON.stringify(missingThumbnail)}.`);
      await click(mainWindow, `${missingRowSelector} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the Part whose source image is missing');
      await waitFor(mainWindow, `document.querySelector(${JSON.stringify(missingRowSelector)} + ' [data-testid="adaptive-parts-assembly-row-select"]')?.getAttribute('aria-pressed') === 'true'`, 'A Part with a missing source could not be selected from its row.');
      const afterMissingSelection = await inspect(mainWindow);
      assert(afterMissingSelection.revision === beforeMissingAsset.revision && afterMissingSelection.dirty === beforeMissingAsset.dirty && afterMissingSelection.undoCount === beforeMissingAsset.undoCount,
        'Showing/selecting a missing source wrote a Project revision, dirty state, or History entry.');
      await waitForAdaptiveAssemblyDrawerHidden(mainWindow, 'The Character drawer did not hide before capturing the missing-source fallback.');
      await captureWhole(mainWindow, 'c3-missing-asset-fallback.png');
      missingAssetEvidence = {
        result: 'PASS',
        partId: missingPartId,
        assetId: missingAsset.id,
        missingReadCount,
        thumbnail: missingThumbnail,
        selectableWhileMissing: true,
        otherCanvasPartCount: missingThumbnail.canvasPartCount,
        selectionDidNotWriteProject: true,
        screenshot: 'c3-missing-asset-fallback.png',
      };
    } finally {
      await fsp.rename(unavailableAssetPath, missingAssetPath);
    }
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Close assembly after missing-source fallback check');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Assembly did not close after the missing-source fallback check.');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Character list after missing-source fallback');
    await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'Reopen C0 after restoring its source image');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Adaptive Parts assembly did not reopen after restoring its source image.');
    await waitFor(mainWindow, `(() => {
      const row = document.querySelector('.adaptive-parts-assembly-row[data-part-id="${missingPartId}"]');
      return row?.querySelector('.adaptive-parts-assembly-thumbnail')?.dataset.thumbnailStatus === 'ready' &&
        document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length === 5;
    })()`, 'Reopening the assembly did not retry and render the restored source image.');
    await waitFor(mainWindow, `(() => {
      const workbench = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]');
      const style = workbench ? getComputedStyle(workbench) : null;
      const bounds = workbench?.getBoundingClientRect();
      return Boolean(bounds?.width && bounds.height) && style?.visibility === 'visible' && Number(style.opacity) >= 0.99;
    })()`, 'The recovered assembly did not become visible for its evidence capture.');
    await waitForAdaptiveAssemblyDrawerHidden(mainWindow, 'The Character drawer did not hide before capturing the recovered source image.');
    const recoveredAssetReads = assetCanvasImageReadCounts.get(missingAsset.id) ?? 0;
    const afterMissingRecovery = await inspect(mainWindow);
    assert(recoveredAssetReads > missingAssetEvidence.missingReadCount, 'A new assembly session did not retry the restored source image.');
    assert(afterMissingRecovery.revision === beforeMissingAsset.revision && afterMissingRecovery.dirty === beforeMissingAsset.dirty && afterMissingRecovery.undoCount === beforeMissingAsset.undoCount,
      'Missing-source recovery wrote a Project revision, dirty state, or History entry.');
    await captureWhole(mainWindow, 'c3-missing-asset-recovered.png');
    receipt.missingAssetRecovery = {
      ...missingAssetEvidence,
      result: 'PASS',
      restoredReadCount: recoveredAssetReads,
      retriedOnReopen: true,
      canvasPartCountAfterRecovery: 5,
      recoveryDidNotWriteProject: true,
      recoveryScreenshot: 'c3-missing-asset-recovered.png',
    };
    const assemblyToolbarText = await page(mainWindow,
      `document.querySelector('.adaptive-parts-assembly-canvas-toolbar')?.innerText?.trim() ?? ''`);
    assert(!assemblyToolbarText.includes('拖动部件移动') && !assemblyToolbarText.includes('拖动角点缩放'),
      `Assembly canvas contains permanent interaction instructions: ${assemblyToolbarText}.`);
    await waitForAdaptiveAssemblyDrawerHidden(mainWindow, 'The resource drawer is not visually hidden while preserving its mounted Character owner.');
    receipt.ac01 = { result: 'PASS', path: 'Characters list → Adaptive Parts workbench' };
    ac09Checks.permanentCanvasInstructions = 'PASS: no persistent drag/scale helper copy';

    const rows = await page(mainWindow, `([...document.querySelectorAll('.adaptive-parts-assembly-row')]).map((row) => ({ partId: row.dataset.partId, drawOrder: Number(row.dataset.drawOrder), name: row.querySelector('.adaptive-parts-assembly-name')?.innerText?.trim() ?? '', visible: row.querySelector('[data-part-visible]')?.dataset.partVisible ?? null }))`);
    assert(rows.length === 5, `C0 Part list shows ${rows.length} rows; expected 5.`);
    const visibleRows = await page(mainWindow, `(() => [...document.querySelectorAll('.adaptive-parts-assembly-row')].map((row) => {
      const bounds = row.getBoundingClientRect();
      const hitTarget = row.querySelector('[data-testid="adaptive-parts-assembly-row-select"]') ?? row;
      const hitBounds = hitTarget.getBoundingClientRect();
      const target = document.elementFromPoint(hitBounds.left + hitBounds.width / 2, hitBounds.top + hitBounds.height / 2);
      const style = getComputedStyle(row);
      return { partId: row.dataset.partId, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility, hitTestedWithinRow: Boolean(target && row.contains(target)), hitTarget: target ? { tag: target.tagName, className: typeof target.className === 'string' ? target.className : '', testId: target.getAttribute('data-testid') } : null };
    }))()`);
    assert(visibleRows.length === rows.length && visibleRows.every((row) => row.width > 0 && row.height > 0 && row.display !== 'none' && row.visibility === 'visible' && row.hitTestedWithinRow), `Part rows are not visibly available: ${JSON.stringify(visibleRows)}.`);
    await captureWhole(mainWindow, 'c3-assembly-initial.png');
    assert(JSON.stringify(rows.map((row) => row.drawOrder)) === JSON.stringify([4, 3, 2, 1, 0]), `Part rows do not present descending drawOrder: ${JSON.stringify(rows)}.`);
    assert(JSON.stringify(rows.map((row) => row.name)) === JSON.stringify(['com3', 'com4', 'com5', 'com2', 'com6']), `Part rows do not retain the C0 source names: ${JSON.stringify(rows)}.`);
    assert(Number(await page(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-assembly-count"]')?.innerText?.match(/\\d+/)?.[0] ?? 0)`)) === 5, 'Part count display is not 5.');
    assert(await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-inspector-toggle"]')?.getAttribute('aria-expanded') === 'false'`), 'Inspector did not start collapsed.');
    receipt.ac02 = { result: 'PASS', count: rows.length, displayedOrder: rows.map(({ drawOrder, name, partId }) => ({ drawOrder, name, partId })), visibleRows };

    const timelineToggleSelector = '[data-testid="timeline-collapse"]';
    if (!await page(mainWindow, `document.querySelector(${JSON.stringify(timelineToggleSelector)})?.dataset.expanded === 'true'`)) {
      await click(mainWindow, timelineToggleSelector, 'Expand Timeline for assembly layout review');
      await waitFor(mainWindow, `document.querySelector(${JSON.stringify(timelineToggleSelector)})?.dataset.expanded === 'true'`, 'Timeline did not expand for the assembly layout review.');
    }
    const expandedTimelineLayout = await inspectAssemblyViewport(mainWindow);
    await click(mainWindow, timelineToggleSelector, 'Collapse Timeline for assembly layout review');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(timelineToggleSelector)})?.dataset.expanded === 'false'`, 'Timeline did not collapse for the assembly layout review.');
    const collapsedTimelineLayout = await inspectAssemblyViewport(mainWindow);
    const assemblyFitsWindow = (layout) => Boolean(
      layout.workbench?.width > 0 && layout.workbench?.height > 0 &&
      layout.viewport?.width > 100 && layout.viewport?.height > 100,
    ) && layout.rows.length === 5 &&
      layout.rows.every((row) => row.visible && row.hitTestedWithinRow && row.insideWindow) &&
      layout.footerButtons.length >= 2 && layout.footerButtons.every((button) =>
        button.x >= 0 && button.right <= layout.innerWidth && button.y >= 0 && button.bottom <= layout.innerHeight,
      );
    assert(assemblyFitsWindow(expandedTimelineLayout) && assemblyFitsWindow(collapsedTimelineLayout),
      'Assembly list or Apply/Cancel controls clipped when timeline height changed: ' +
      JSON.stringify({ expandedTimelineLayout, collapsedTimelineLayout }));
    await captureWhole(mainWindow, 'c3-assembly-timeline-collapsed.png');
    await click(mainWindow, timelineToggleSelector, 'Restore Timeline after assembly layout review');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(timelineToggleSelector)})?.dataset.expanded === 'true'`, 'Timeline did not restore after the assembly layout review.');
    ac09Checks.timelineHeightReview = {
      result: 'PASS',
      expanded: { workbench: expandedTimelineLayout.workbench, viewport: expandedTimelineLayout.viewport, footer: expandedTimelineLayout.footer },
      collapsed: { workbench: collapsedTimelineLayout.workbench, viewport: collapsedTimelineLayout.viewport, footer: collapsedTimelineLayout.footer },
      screenshot: 'c3-assembly-timeline-collapsed.png',
    };

    const partId = sourcePartIds['c0/com6'];
    const wideViewport = await inspectAssemblyViewport(mainWindow);
    mainWindow.setSize(880, 760);
    await pause(450);
    await waitFor(mainWindow, 'window.innerWidth <= 900 && window.innerWidth >= 800', 'The assembly window did not enter the narrow landscape breakpoint.');
    const narrowViewport = await inspectAssemblyViewport(mainWindow);
    const narrowRowsInListViewport = narrowViewport.rows.filter((row) =>
      narrowViewport.list && row.y < narrowViewport.list.bottom &&
      row.y + row.height > narrowViewport.list.y,
    );
    assert(narrowViewport.rows.length === 5 && narrowRowsInListViewport.length >= 3 &&
      narrowRowsInListViewport.every((row) => row.visible && row.hitTestedWithinRow && row.insideWindow),
    'Narrow assembly Part rows do not expose a scrollable, hit-tested visible range: ' + JSON.stringify({ narrowViewport, narrowRowsInListViewport }));
    assert(narrowViewport.viewport?.width > 100 && narrowViewport.viewport?.height > 100 &&
      narrowViewport.footerButtons.length >= 2 &&
      narrowViewport.footerButtons.every((button) => button.width > 0 && button.height > 0 &&
        button.x >= 0 && button.right <= narrowViewport.innerWidth &&
        button.y >= 0 && button.bottom <= narrowViewport.innerHeight),
    'Narrow assembly canvas or Apply/Cancel controls are clipped: ' + JSON.stringify(narrowViewport));
    assert(narrowViewport.stageScale > 0 && narrowViewport.stageScale < wideViewport.stageScale,
      'The adaptive canvas did not refit to the narrower viewport: ' +
      JSON.stringify({ wideScale: wideViewport.stageScale, narrowScale: narrowViewport.stageScale }));
    await captureWhole(mainWindow, 'c3-assembly-narrow-before-touch.png');
    const narrowSelectedRow = '.adaptive-parts-assembly-row[data-part-id="' + partId + '"] [data-testid="adaptive-parts-assembly-row-select"]';
    await click(mainWindow, narrowSelectedRow, 'Select C0 com6 in the narrow Part list');
    const narrowScrolledLayout = await inspectAssemblyViewport(mainWindow);
    const narrowSelectedRowLayout = narrowScrolledLayout.rows.find((row) => row.partId === partId);
    assert(narrowSelectedRowLayout?.hitTestedWithinRow && narrowSelectedRowLayout.visible &&
      narrowScrolledLayout.list && narrowSelectedRowLayout.y < narrowScrolledLayout.list.bottom &&
      narrowSelectedRowLayout.y + narrowSelectedRowLayout.height > narrowScrolledLayout.list.y,
    'Scrolling to com6 did not make its row directly hit-testable: ' + JSON.stringify({ narrowSelectedRowLayout, list: narrowScrolledLayout.list }));
    const narrowClick = { method: 'DOM click after automatic scroll-into-view', partId };
    const narrowPartSelector = '[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="' + partId + '"]';
    await waitFor(mainWindow, "document.querySelector(" + JSON.stringify(narrowPartSelector) + ")?.classList.contains('is-selected')", 'Narrow Part-list selection did not reach the canvas.');
    const partRectBeforeTouch = await page(mainWindow,
      "(() => { const bounds = document.querySelector(" + JSON.stringify(narrowPartSelector) + ").getBoundingClientRect(); return { x: bounds.x, y: bounds.y }; })()");
    const partGeometryBeforeTouch = await page(mainWindow,
      "(() => { const part = document.querySelector(" + JSON.stringify(narrowPartSelector) + "); const stage = document.querySelector('.adaptive-parts-assembly-viewport .character-assembly-preview-stage'); " +
      "const viewport = document.querySelector('[data-testid=\"adaptive-parts-assembly-canvas\"]'); const bounds = part.getBoundingClientRect(); " +
      "return { rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, partTransform: part.style.transform, " +
      "computedPartTransform: getComputedStyle(part).transform, stageTransform: stage?.style.transform ?? null, " +
      "computedStageTransform: stage ? getComputedStyle(stage).transform : null, viewport: { width: viewport?.clientWidth ?? 0, height: viewport?.clientHeight ?? 0 } }; })()");
    const untouchedPartId = sourcePartIds['c0/com5'];
    const untouchedPartSelector = '[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="' + untouchedPartId + '"]';
    const untouchedPartRectBefore = await page(mainWindow,
      "(() => { const bounds = document.querySelector(" + JSON.stringify(untouchedPartSelector) + ").getBoundingClientRect(); return { x: bounds.x, y: bounds.y }; })()");
    const touchDrag = await touchDragPart(mainWindow, partId, 18, 12);
    const partRectAfterTouch = await page(mainWindow,
      "(() => { const bounds = document.querySelector(" + JSON.stringify(narrowPartSelector) + ").getBoundingClientRect(); return { x: bounds.x, y: bounds.y }; })()");
    const untouchedPartRectAfter = await page(mainWindow,
      "(() => { const bounds = document.querySelector(" + JSON.stringify(untouchedPartSelector) + ").getBoundingClientRect(); return { x: bounds.x, y: bounds.y }; })()");
    const touchDelta = {
      x: partRectAfterTouch.x - partRectBeforeTouch.x,
      y: partRectAfterTouch.y - partRectBeforeTouch.y,
    };
    const partGeometryAfterTouch = await page(mainWindow,
      "(() => { const part = document.querySelector(" + JSON.stringify(narrowPartSelector) + "); const stage = document.querySelector('.adaptive-parts-assembly-viewport .character-assembly-preview-stage'); " +
      "const viewport = document.querySelector('[data-testid=\"adaptive-parts-assembly-canvas\"]'); const bounds = part.getBoundingClientRect(); " +
      "return { rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, partTransform: part.style.transform, " +
      "computedPartTransform: getComputedStyle(part).transform, stageTransform: stage?.style.transform ?? null, " +
      "computedStageTransform: stage ? getComputedStyle(stage).transform : null, viewport: { width: viewport?.clientWidth ?? 0, height: viewport?.clientHeight ?? 0 } }; })()");
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open the narrow Part inspector after touch');
    const touchAdjustment = await page(mainWindow,
      "(() => ({ offsetX: Number(document.querySelector('[data-testid=\"adaptive-parts-offset-x\"]')?.value ?? NaN), " +
      "offsetY: Number(document.querySelector('[data-testid=\"adaptive-parts-offset-y\"]')?.value ?? NaN), " +
      "scalePercent: Number(document.querySelector('[data-testid=\"adaptive-parts-scale-percent\"]')?.value ?? NaN) }))()");
    const narrowInspectorLayout = await inspectAssemblyViewport(mainWindow);
    const narrowInspectorOverlapsArt = narrowInspectorLayout.parts.some((part) =>
      narrowInspectorLayout.inspector &&
      part.x < narrowInspectorLayout.inspector.right &&
      part.right > narrowInspectorLayout.inspector.x &&
      part.y < narrowInspectorLayout.inspector.bottom &&
      part.bottom > narrowInspectorLayout.inspector.y,
    );
    assert(narrowInspectorLayout.inspector?.width <= 264 && !narrowInspectorOverlapsArt,
      'The narrow Part inspector covers the assembled character: ' +
      JSON.stringify({ inspector: narrowInspectorLayout.inspector, parts: narrowInspectorLayout.parts }));
    const fiberSnapshot = await page(mainWindow,
      "(() => { const element = document.querySelector(" + JSON.stringify(narrowPartSelector) + "); " +
      "const fiberKey = Object.keys(element ?? {}).find((key) => key.startsWith('__reactFiber$')); let fiber = fiberKey ? element[fiberKey] : null; " +
      "const snapshots = []; while (fiber && snapshots.length < 32) { const props = fiber.memoizedProps; " +
      "if (props?.session?.draft) { const part = props.session.draft.parts.find((candidate) => candidate.partId === " + JSON.stringify(partId) + "); " +
      "snapshots.push({ component: fiber.type?.name ?? fiber.elementType?.name ?? null, sourceRootTransform: props.session.draft.sourceRootTransform, " +
      "part: part ? { restTransform: part.restTransform, sourceRestTransform: part.sourceRestTransform, staticAdjustment: part.staticAdjustment, imageMapping: part.imageMapping } : null }); } " +
      "fiber = fiber.return; } return snapshots; })()");
    receipt.narrowTouchDebug = { touchDrag, touchDelta, touchAdjustment, partGeometryBeforeTouch, partGeometryAfterTouch, fiberSnapshot };
    assert(touchDrag.events.some((event) => event.type === 'pointerdown' && event.pointerType === 'touch' && event.partId === partId) &&
      touchDrag.events.some((event) => event.type === 'pointerup' && event.pointerType === 'touch'),
    'Chrome touch emulation did not produce a complete touch PointerEvent sequence: ' + JSON.stringify(touchDrag.events));
    assert(Math.abs(touchDelta.x - touchDrag.cssDelta.x) <= 3 && Math.abs(touchDelta.y - touchDrag.cssDelta.y) <= 3,
      'Narrow touch drag drifted from the pointer by more than 3 CSS pixels: ' + JSON.stringify(receipt.narrowTouchDebug));
    assert(Math.abs(untouchedPartRectAfter.x - untouchedPartRectBefore.x) <= 1 &&
      Math.abs(untouchedPartRectAfter.y - untouchedPartRectBefore.y) <= 1,
    'Touch dragging one Part moved another Part: ' + JSON.stringify({ untouchedPartRectBefore, untouchedPartRectAfter }));
    await waitFor(mainWindow,
      "Number(document.querySelector('[data-testid=\"adaptive-parts-offset-x\"]')?.value) > 0 && Number(document.querySelector('[data-testid=\"adaptive-parts-offset-y\"]')?.value) > 0",
      'Emulated touch drag did not update the selected Part in the narrow viewport.');
    await captureWhole(mainWindow, 'c3-assembly-narrow-touch-draft.png');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-close"]', 'Close the narrow Part inspector before orientation change');
    mainWindow.setSize(820, 980);
    await pause(450);
    await waitFor(mainWindow, 'window.innerWidth <= 900 && window.innerHeight > window.innerWidth', 'The assembly window did not enter the portrait Cloud Touch viewport.');
    await waitFor(mainWindow, `document.querySelector('.app-shell')?.dataset.characterAssemblyActive === 'true'`, 'Cloud Touch portrait orientation ended the active assembly session.');
    const portraitViewport = await inspectAssemblyViewport(mainWindow);
    assert(assemblyFitsWindow(portraitViewport),
      'Assembly list or Apply/Cancel controls clipped in the portrait Cloud Touch viewport: ' + JSON.stringify(portraitViewport));
    const portraitPropertiesHidden = await page(mainWindow, `(() => {
      const properties = document.querySelector('.editor-workspace-slot-properties.is-character-assembly-inactive');
      return Boolean(properties?.hidden && getComputedStyle(properties).display === 'none');
    })()`);
    assert(portraitPropertiesHidden,
      'The inactive Properties workspace is visible behind the Adaptive Parts assembly in portrait orientation.');
    const portraitResourcesHidden = await page(mainWindow, `(() => {
      const resources = document.querySelector('.editor-workspace-slot-resources');
      return Boolean(resources?.hidden && getComputedStyle(resources).display === 'none');
    })()`);
    assert(portraitResourcesHidden,
      'The inactive resource workspace reserves visible space behind the Adaptive Parts assembly in portrait orientation.');
    await captureWhole(mainWindow, 'c3-assembly-portrait-orientation.png');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Reopen the Part inspector after portrait orientation');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')`, 'Portrait orientation did not preserve the assembly inspector.');
    const portraitTouchAdjustment = await page(mainWindow,
      "(() => ({ offsetX: Number(document.querySelector('[data-testid=\"adaptive-parts-offset-x\"]')?.value ?? NaN), " +
      "offsetY: Number(document.querySelector('[data-testid=\"adaptive-parts-offset-y\"]')?.value ?? NaN), " +
      "scalePercent: Number(document.querySelector('[data-testid=\"adaptive-parts-scale-percent\"]')?.value ?? NaN) }))()");
    assert(Math.abs(portraitTouchAdjustment.offsetX - touchAdjustment.offsetX) <= 0.01 &&
      Math.abs(portraitTouchAdjustment.offsetY - touchAdjustment.offsetY) <= 0.01 &&
      portraitTouchAdjustment.scalePercent === touchAdjustment.scalePercent,
    'Portrait orientation did not preserve the pending touch draft: ' +
      JSON.stringify({ before: touchAdjustment, after: portraitTouchAdjustment }));
    await click(mainWindow, `.adaptive-parts-assembly-row[data-part-id="${partId}"] [data-testid="adaptive-parts-restore-button"]`, 'Reset the preserved portrait touch draft');
    await waitFor(mainWindow,
      "document.querySelector('[data-testid=\"adaptive-parts-offset-x\"]')?.value === '0' && document.querySelector('[data-testid=\"adaptive-parts-offset-y\"]')?.value === '0' && document.querySelector('[data-testid=\"adaptive-parts-scale-percent\"]')?.value === '100'",
      'Reset did not discard the preserved portrait touch draft.');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-close"]', 'Close the Part inspector after portrait orientation');
    const afterNarrowReset = await inspect(mainWindow);
    assert(afterNarrowReset.revision === 0 && !afterNarrowReset.dirty && afterNarrowReset.undoCount === 0,
      'Orientation change or touch-draft reset changed the formal Project state.');
    ac09Checks.cloudTouchOrientationReview = {
      result: 'PASS',
      viewport: { width: portraitViewport.innerWidth, height: portraitViewport.innerHeight },
      partRows: portraitViewport.rows.length,
      applyCancelVisible: true,
      assemblySessionPreserved: true,
      inactivePropertiesHidden: portraitPropertiesHidden,
      inactiveResourcesHidden: portraitResourcesHidden,
      pendingDraftPreserved: portraitTouchAdjustment,
      resetProjectState: { revision: afterNarrowReset.revision, dirty: afterNarrowReset.dirty, undoCount: afterNarrowReset.undoCount },
      physicalTouchHardware: 'NOT_RUN',
      screenshot: 'c3-assembly-portrait-orientation.png',
    };
    mainWindow.setSize(1660, 1100);
    await pause(450);
    await waitFor(mainWindow, 'window.innerWidth > 900', 'The assembly window did not restore to its wide layout.');
    receipt.narrowViewport = {
      result: 'PASS',
      wide: { innerWidth: wideViewport.innerWidth, innerHeight: wideViewport.innerHeight, stageScale: wideViewport.stageScale },
      narrow: narrowViewport,
      inspectorLayout: narrowInspectorLayout,
      inspectorAvoidsPartBounds: !narrowInspectorOverlapsArt,
      partListPointer: narrowClick,
      touchEmulation: { drag: touchDrag, screenDelta: touchDelta, otherPartUnchanged: true },
      resetProjectState: { revision: afterNarrowReset.revision, dirty: afterNarrowReset.dirty, undoCount: afterNarrowReset.undoCount },
      screenshots: ['c3-assembly-narrow-before-touch.png', 'c3-assembly-narrow-touch-draft.png'],
      physicalTouchHardware: 'NOT_RUN',
      cloudTouchDeviceMode: 'VIEWPORT_SIMULATED; physical hardware NOT_RUN',
    };
    const beforeOcclusionReview = await inspect(mainWindow);
    receipt.adaptiveOcclusion = await verifyAssemblyOcclusionPixel(mainWindow, adaptive);
    const afterOcclusionReview = await inspect(mainWindow);
    assert(afterOcclusionReview.revision === beforeOcclusionReview.revision &&
      afterOcclusionReview.dirty === beforeOcclusionReview.dirty &&
      afterOcclusionReview.undoCount === beforeOcclusionReview.undoCount,
    'Selecting overlapping Parts wrote a Project revision, dirty state, or History entry.');
    const selectedRow = `.adaptive-parts-assembly-row[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`;
    await click(mainWindow, selectedRow, 'Select C0 com6 from the Part list');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${partId}"].is-selected')`, 'List selection did not synchronize to the canvas.');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open the Part inspector');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')`, 'Part inspector inputs did not open.');
    assert(await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value === '100' && document.querySelector('[data-testid="adaptive-parts-rotation-deg"]')?.value === '0'`), 'Source-relative inspector did not start at 0 / 0 / 100 / 0.');
    const beforeDraft = await inspect(mainWindow);
    const drag = await dragPart(mainWindow, partId, 24, 14);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value) > 0`, 'Canvas drag did not change the source-relative X offset.');
    const scale = await scalePart(mainWindow, partId, 16, 12);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value) > 100`, 'Canvas scale handle did not change Part scale.');
    await setInputValue(mainWindow, '[data-testid="adaptive-parts-rotation-deg"]', 6);
    const afterDraft = await inspect(mainWindow);
    assert(afterDraft.revision === beforeDraft.revision && afterDraft.dirty === beforeDraft.dirty && afterDraft.undoCount === beforeDraft.undoCount, 'Part selection/drag/scale mutated the formal Project before Apply.');

    const com2 = sourcePartIds['c0/com2'];
    const com2Row = `.adaptive-parts-assembly-row[data-part-id="${com2}"]`;
    const com2VisibilityToggle = `${com2Row} [data-testid="adaptive-parts-visibility-toggle"]`;
    const assemblyRectsBeforeHide = await page(mainWindow, `(() => Object.fromEntries(
      [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')]
        .map((part) => { const rect = part.getBoundingClientRect(); return [part.dataset.partId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]; }),
    ))()`);
    await click(mainWindow, com2VisibilityToggle, 'Hide com2 directly');
    assert(await page(mainWindow, `Boolean(document.querySelector(${JSON.stringify(com2Row)}))`), 'Hidden Part was removed from the Part list.');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${com2}"]')`, 'Hiding com2 did not remove only its rendered image.');
    const assemblyRectsWhileHidden = await page(mainWindow, `(() => Object.fromEntries(
      [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')]
        .map((part) => { const rect = part.getBoundingClientRect(); return [part.dataset.partId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]; }),
    ))()`);
    for (const [visiblePartId, beforeRect] of Object.entries(assemblyRectsBeforeHide)) {
      if (visiblePartId === com2) continue;
      const hiddenRect = assemblyRectsWhileHidden[visiblePartId];
      assert(hiddenRect && ['x', 'y', 'width', 'height'].every((key) => Math.abs(hiddenRect[key] - beforeRect[key]) <= 0.75),
        `Hiding edge com2 moved ${visiblePartId}: ${JSON.stringify({ beforeRect, hiddenRect })}.`);
    }
    await click(mainWindow, `${com2Row} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the hidden com2 Part');
    await click(mainWindow, com2VisibilityToggle, 'Show com2 directly');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${com2}"]')`, 'Showing com2 did not restore its canvas image.');
    const assemblyRectsAfterReveal = await page(mainWindow, `(() => Object.fromEntries(
      [...document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')]
        .map((part) => { const rect = part.getBoundingClientRect(); return [part.dataset.partId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]; }),
    ))()`);
    for (const [visiblePartId, beforeRect] of Object.entries(assemblyRectsBeforeHide)) {
      const revealedRect = assemblyRectsAfterReveal[visiblePartId];
      assert(revealedRect && ['x', 'y', 'width', 'height'].every((key) => Math.abs(revealedRect[key] - beforeRect[key]) <= 0.75),
        `Revealing edge com2 changed ${visiblePartId} world bounds: ${JSON.stringify({ beforeRect, revealedRect })}.`);
    }
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value === '100'`, 'Selecting the second source Part did not load its independent source-relative controls.');
    const secondPartOffsetX = 18;
    await setInputValue(mainWindow, '[data-testid="adaptive-parts-offset-x"]', secondPartOffsetX);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '${secondPartOffsetX}'`, 'The second source Part inspector did not update its own offset.');
    const secondPartScalePercent = 110;
    await setInputValue(mainWindow, '[data-testid="adaptive-parts-scale-percent"]', secondPartScalePercent);
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value === '${secondPartScalePercent}'`, 'The second source Part inspector did not update its own scale.');

    const com6Row = `.adaptive-parts-assembly-row[data-part-id="${partId}"]`;
    await renameAdaptivePart(mainWindow, com6Row, 'com6 edited');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(com6Row)})?.innerText.includes('com6 edited')`, 'Part rename did not update its displayed name.');
    await captureWhole(mainWindow, 'c3-assembly-edited-draft.png');

    await click(mainWindow, com2VisibilityToggle, 'Hide com2 for Apply and History coverage');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${com2}"]')`, 'The final com2 hide did not remove its canvas image.');

    const historyBeforeApply = await inspect(mainWindow);
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply the C0 Part edits');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="adaptive-parts-assembly-apply"]') && document.querySelector('[data-testid="adaptive-parts-assembly-cancel"]')`, 'Apply did not keep the committed assembly available for further edits.');
    const afterFirstApply = await inspect(mainWindow);
    assert(afterFirstApply.revision === historyBeforeApply.revision + 1 && afterFirstApply.dirty && afterFirstApply.undoCount === historyBeforeApply.undoCount + 1, 'The first Apply did not produce exactly one dirty project revision and History entry.');
    const firstApplyStatus = await page(mainWindow, `document.querySelector('.adaptive-parts-assembly-footer [role="status"]')?.textContent?.trim() ?? null`);
    assert(!firstApplyStatus, `Successful Apply left persistent status copy: ${firstApplyStatus}.`);
    const beforeNoOpApply = await inspect(mainWindow);
    const noOpApplyDisabled = await page(mainWindow,
      `document.querySelector('[data-testid="adaptive-parts-assembly-apply"]')?.disabled === true`);
    const afterNoOpApply = await inspect(mainWindow);
    const noOpApplyStatus = await page(mainWindow, `document.querySelector('.adaptive-parts-assembly-footer [role="status"]')?.textContent?.trim() ?? null`);
    assert(noOpApplyDisabled &&
      afterNoOpApply.revision === beforeNoOpApply.revision &&
      afterNoOpApply.dirty === beforeNoOpApply.dirty &&
      afterNoOpApply.undoCount === beforeNoOpApply.undoCount &&
      !noOpApplyStatus,
    'Clean Apply was not disabled or changed project/history state or left persistent status copy.');

    await click(mainWindow, `${com6Row} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select com6 for a second same-page Apply');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${partId}"]')?.classList.contains('is-selected')`, 'com6 did not select for the second same-page Apply.');
    const secondApplyInputBefore = await page(mainWindow, `(() => ({
      offsetX: Number(document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value ?? NaN),
      scalePercent: Number(document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value ?? NaN),
    }))()`);
    const secondApplyBefore = await inspect(mainWindow);
    const secondDrag = await dragPart(mainWindow, partId, 13, 7);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value) > ${secondApplyInputBefore.offsetX + 1}`, 'Pointer drag after the first Apply used a stale session callback.');
    const secondScale = await scalePart(mainWindow, partId, 11, 8);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value) > ${secondApplyInputBefore.scalePercent + 1}`, 'Pointer scale after the first Apply used a stale session callback.');
    const afterSecondDraft = await inspect(mainWindow);
    assert(afterSecondDraft.revision === secondApplyBefore.revision &&
      afterSecondDraft.dirty === secondApplyBefore.dirty &&
      afterSecondDraft.undoCount === secondApplyBefore.undoCount,
    'The second same-page drag/scale changed the formal Project before Apply.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply the second C0 Part edit in the same page');
    const afterApply = await inspect(mainWindow);
    assert(afterApply.revision === secondApplyBefore.revision + 1 &&
      afterApply.dirty && afterApply.undoCount === secondApplyBefore.undoCount + 1,
    'The second Apply did not produce exactly one dirty project revision and History entry.');
    const secondApplyStatus = await page(mainWindow, `document.querySelector('.adaptive-parts-assembly-footer [role="status"]')?.textContent?.trim() ?? null`);
    assert(!secondApplyStatus, `Second successful Apply left persistent status copy: ${secondApplyStatus}.`);
    const savedCharacterAfterApply = afterApply.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    const editedPart = savedCharacterAfterApply?.mode === 'adaptive-parts' ? savedCharacterAfterApply.parts.find((part) => part.partId === partId) : null;
    const editedSecondPart = savedCharacterAfterApply?.mode === 'adaptive-parts' ? savedCharacterAfterApply.parts.find((part) => part.partId === com2) : null;
    assert(editedPart?.displayName === 'com6 edited' && editedPart.staticAdjustment?.offsetX > 0 && editedPart.staticAdjustment?.scale > 1 && editedPart.staticAdjustment?.rotationDeg === 6, 'Apply did not persist the renamed and transformed C0 Part.');
    assert(editedSecondPart?.staticAdjustment?.offsetX > 0 && editedSecondPart.staticAdjustment?.scale > 1 && editedSecondPart.visible === false, 'Apply did not persist the independent drag, scale, and hidden state of the second C0 Part.');
    assert(JSON.stringify(editedPart.sourceRestTransform) === JSON.stringify(sourceRestTransform), 'Apply changed the saved source-rest baseline.');
    const originalPart = prepared.parts.find((part) => part.partId === partId);
    assert(originalPart && editedPart.assetId === originalPart.assetId && editedPart.drawOrder === originalPart.drawOrder && JSON.stringify(editedPart.imageMapping) === JSON.stringify(originalPart.imageMapping), 'Part edit changed source identity, crop, asset, or draw order.');
    receipt.ac03 = {
      result: 'PASS',
      coverage: 'Windows Electron two same-page Applies, including drag/scale after the first commit, plus touch PointerEvents at an 880 CSS-pixel viewport; resized canvas fit exercised.',
      interactiveParts: [
        { sourceId: 'c0/com6', drag, scale },
        { sourceId: 'c0/com2', inspectorOffsetX: secondPartOffsetX, inspectorScalePercent: secondPartScalePercent },
        { sourceId: 'c0/com6', drag: secondDrag, scale: secondScale, afterFirstApply: true },
      ],
      applyStates: {
        first: { before: { revision: historyBeforeApply.revision, undoCount: historyBeforeApply.undoCount }, after: { revision: afterFirstApply.revision, undoCount: afterFirstApply.undoCount } },
        noOp: { before: { revision: beforeNoOpApply.revision, undoCount: beforeNoOpApply.undoCount }, after: { revision: afterNoOpApply.revision, undoCount: afterNoOpApply.undoCount }, status: noOpApplyStatus },
        second: { before: { revision: secondApplyBefore.revision, undoCount: secondApplyBefore.undoCount }, draft: { revision: afterSecondDraft.revision, undoCount: afterSecondDraft.undoCount }, after: { revision: afterApply.revision, undoCount: afterApply.undoCount } },
      },
      listAndCanvasSelection: 'PASS',
      inspector: {
        com6: { offsetX: editedPart.staticAdjustment.offsetX, offsetY: editedPart.staticAdjustment.offsetY, scale: editedPart.staticAdjustment.scale, rotationDeg: editedPart.staticAdjustment.rotationDeg },
        com2: { offsetX: editedSecondPart.staticAdjustment.offsetX, offsetY: editedSecondPart.staticAdjustment.offsetY, scale: editedSecondPart.staticAdjustment.scale, rotationDeg: editedSecondPart.staticAdjustment.rotationDeg },
      },
      unchangedOtherPartIds: adaptive.parts.filter((part) => part.partId !== partId && part.partId !== com2).map((part) => part.partId),
      notRun: ['physical touchscreen hardware acceptance'],
      narrowViewport: receipt.narrowViewport,
    };
    receipt.ac04 = { result: 'PASS', sourceRestTransform: editedPart.sourceRestTransform, currentRestTransform: editedPart.restTransform, crop: editedPart.imageMapping.crop, c0RootTransform: sourceRootTransform };
    receipt.ac05 = { result: 'PASS', before: { revision: beforeDraft.revision, dirty: beforeDraft.dirty, undoCount: beforeDraft.undoCount }, draft: { revision: afterDraft.revision, dirty: afterDraft.dirty, undoCount: afterDraft.undoCount }, firstApply: { revision: afterFirstApply.revision, dirty: afterFirstApply.dirty, undoCount: afterFirstApply.undoCount }, noOpApply: { revision: afterNoOpApply.revision, dirty: afterNoOpApply.dirty, undoCount: afterNoOpApply.undoCount }, secondDraft: { revision: afterSecondDraft.revision, dirty: afterSecondDraft.dirty, undoCount: afterSecondDraft.undoCount }, secondApply: { revision: afterApply.revision, dirty: afterApply.dirty, undoCount: afterApply.undoCount } };
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Return to Character detail after clean Apply');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Committed assembly did not return to Character detail.');

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:first-of-type', 'Undo the second same-page assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 1`, 'Undo of the second Apply did not create a Redo entry.');
    const afterSecondUndo = await inspect(mainWindow);
    const secondUndoCharacter = afterSecondUndo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    const firstAppliedCom2 = afterFirstApply.project.characters.find((candidate) => candidate.id === adaptiveCharacterId)?.mode === 'adaptive-parts'
      ? afterFirstApply.project.characters.find((candidate) => candidate.id === adaptiveCharacterId).parts.find((part) => part.partId === com2)
      : null;
    const secondUndoCom2 = secondUndoCharacter?.mode === 'adaptive-parts' ? secondUndoCharacter.parts.find((part) => part.partId === com2) : null;
    assert(secondUndoCharacter?.mode === 'adaptive-parts' &&
      secondUndoCharacter.parts.find((part) => part.partId === partId)?.displayName === 'com6 edited' &&
      secondUndoCom2?.visible === false &&
      JSON.stringify(secondUndoCom2.staticAdjustment) === JSON.stringify(firstAppliedCom2?.staticAdjustment),
    'Undo of the second Apply did not restore the first Apply while keeping com2 hidden.');
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:first-of-type', 'Undo the first same-page assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 2`, 'Undo of the first Apply did not preserve both Redo entries.');
    const afterFirstUndo = await inspect(mainWindow);
    const firstUndoCharacter = afterFirstUndo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(firstUndoCharacter?.mode === 'adaptive-parts' &&
      firstUndoCharacter.parts.find((part) => part.partId === partId)?.displayName !== 'com6 edited' &&
      firstUndoCharacter.parts.find((part) => part.partId === com2)?.visible === true,
    'Undo of the first Apply did not restore the original name and com2 visibility.');
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:last-of-type', 'Redo the first same-page assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.undoCount === ${historyBeforeApply.undoCount + 1} && window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 1`, 'First Redo did not restore exactly the first assembly Apply.');
    const afterFirstRedo = await inspect(mainWindow);
    const firstRedoCharacter = afterFirstRedo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(firstRedoCharacter?.mode === 'adaptive-parts' &&
      firstRedoCharacter.parts.find((part) => part.partId === partId)?.displayName === 'com6 edited' &&
      firstRedoCharacter.parts.find((part) => part.partId === com2)?.visible === false,
    'First Redo did not restore com6 edits and the hidden com2 state.');
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:last-of-type', 'Redo the second same-page assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.undoCount === ${historyBeforeApply.undoCount + 2} && window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 0`, 'Second Redo did not restore exactly the second assembly Apply.');
    const afterRedo = await inspect(mainWindow);
    const redoneCharacter = afterRedo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(redoneCharacter?.mode === 'adaptive-parts' &&
      redoneCharacter.parts.find((part) => part.partId === partId)?.displayName === 'com6 edited' &&
      redoneCharacter.parts.find((part) => part.partId === com2)?.visible === false,
    'Second Redo lost the Adaptive Parts Character, edits, or hidden state.');
    await click(mainWindow, '[data-testid="quick-action-save"]', 'Save the edited C0 Project');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.dirty === false`, 'Edited C0 Project did not save.');
    const persistedEdited = await projectService.open(projectRoot);
    const persistedEditedCharacter = persistedEdited.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(persistedEditedCharacter?.mode === 'adaptive-parts' && persistedEditedCharacter.parts.find((part) => part.partId === partId)?.staticAdjustment?.scale > 1, 'Save/reopen did not persist the edited Part transform.');
    receipt.applyUndoRedoSave = { undo: 'PASS', redo: 'PASS', visibilityUndoRedo: 'PASS', samePageApplyCount: 2, save: 'PASS', sourceRestSurvives: 'PASS', savedProjectSha256: sha256(await fsp.readFile(path.join(projectRoot, 'project.json'))) };

    await collapseProjectActions(mainWindow);
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Character list before Stage samples');
    await click(mainWindow, '[data-testid="resource-activity-close"]', 'Close Character drawer before Stage samples');
    await waitFor(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`, 'Character drawer did not close before Stage samples.');
    await waitFor(mainWindow, `(() => {
      const drawer = document.querySelector('[data-testid="resource-activity-drawer"]');
      const style = drawer ? getComputedStyle(drawer) : null;
      return style?.visibility === 'hidden' && Number(style.opacity) < 0.01;
    })()`, 'Character drawer hide transition did not finish before Stage samples.');

    if (await page(mainWindow, `document.querySelector('[data-testid="timeline-collapse"]')?.dataset.expanded === 'false'`)) await click(mainWindow, '[data-testid="timeline-collapse"]', 'Expand Timeline ruler');
    receipt.stageSamples = {};
    for (const sample of sampleTimes) {
      const actualTime = await seekEditor(mainWindow, sample.timeMs);
      await waitFor(mainWindow, `document.querySelector(${JSON.stringify(stageSelector)})?.dataset.currentTimeMs === ${JSON.stringify(String(actualTime))}`, `Editor Stage did not settle at ${sample.name}.`);
      await page(mainWindow, `(() => {
        for (const selector of ['[data-testid="resource-activity-dock"]', '[data-testid="quick-action-drawer"]']) {
          const element = document.querySelector(selector);
          if (element) element.style.display = 'none';
        }
        return true;
      })()`);
      let rendered;
      try {
        rendered = await captureCanvas(mainWindow, stageSelector, `stage-${sample.name}-canvas.png`);
      } finally {
        await page(mainWindow, `(() => {
          for (const selector of ['[data-testid="resource-activity-dock"]', '[data-testid="quick-action-drawer"]']) {
            const element = document.querySelector(selector);
            if (element) element.style.display = '';
          }
          return true;
        })()`);
      }
      const screenPath = await captureWhole(mainWindow, `stage-${sample.name}-screen.png`);
      assert(rendered.stageData.incompleteVisualLayerIds.length === 0, `Stage ${sample.name} reports incomplete visual Layers.`);
      const normalized = await normalizePng(mediaTools.ffmpegPath, rendered.path, `stage-${sample.name}-1920x1080.png`);
      receipt.stageSamples[sample.name] = { requestedTimeMs: sample.timeMs, actualTimeMs: actualTime, screenshot: screenPath, canvas: rendered.path, canvasCapture: { cssRect: rendered.cssRect, cropRect: rendered.cropRect, fullImageSize: rendered.fullImageSize }, normalized, stageReady: rendered.stageData.stageReady, displayReady: rendered.stageData.displayReady, currentTimeMs: rendered.stageData.currentTimeMs };
    }

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-play"]', 'Open Product Preview');
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewSurface === 'active'`, 'Product Preview did not become active.');
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness === 'ready'`, 'Product Preview did not finish loading.');
    if (await page(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'true'`)) await click(mainWindow, '[data-testid="product-preview-play-pause"]', 'Pause Product Preview');
    await waitFor(mainWindow, `document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewPlaying === 'false'`, 'Product Preview did not pause.');
    receipt.previewSamples = {};
    const previewSelector = '[data-testid="product-preview-overlay"] .product-preview-stage [data-testid="stage-renderer"]';
    for (const sample of sampleTimes) {
      const actualTime = await seekPreview(mainWindow, sample.timeMs);
      const rendered = await captureCanvas(mainWindow, previewSelector, `preview-${sample.name}-canvas.png`);
      const screenPath = await captureWhole(mainWindow, `preview-${sample.name}-screen.png`);
      const normalized = await normalizePng(mediaTools.ffmpegPath, rendered.path, `preview-${sample.name}-1920x1080.png`);
      receipt.previewSamples[sample.name] = { requestedTimeMs: sample.timeMs, actualTimeMs: actualTime, screenshot: screenPath, canvas: rendered.path, canvasCapture: { cssRect: rendered.cssRect, cropRect: rendered.cropRect, fullImageSize: rendered.fullImageSize }, normalized };
    }
    await click(mainWindow, '[data-testid="product-preview-close"]', 'Close Product Preview');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="product-preview-overlay"]')`, 'Product Preview did not close.');

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-export"]', 'Start formal MP4 export');
    await waitFor(mainWindow, `Boolean(document.querySelector('[data-testid="export-task-surface"]'))`, 'Formal export task surface did not open.');
    await waitFor(mainWindow, `['running','completed'].includes(document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus)`, 'Formal export did not start.', 60_000);
    const exportDeadline = Date.now() + 20 * 60_000;
    while (!activeExportPromise && Date.now() < exportDeadline) await pause(100);
    assert(activeExportPromise, 'The formal export handler did not receive the C0 Project export request.');
    const exportResult = await Promise.race([activeExportPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Formal MP4 export exceeded the 20-minute evidence timeout.')), 20 * 60_000))]);
    assert(exportResult.status === 'completed' && exportResult.outputPath === outputPath, `Formal export did not complete at the expected local path: ${JSON.stringify(exportResult)}.`);
    const outputStat = await fsp.stat(outputPath);
    assert(outputStat.isFile() && outputStat.size > 10_000, 'Formal MP4 output is absent or unexpectedly small.');
    const decoded = await captureExportFrames(mediaTools.ffmpegPath, mediaTools.ffprobePath);
    receipt.export = { status: exportResult.status, jobId: exportResult.jobId, outputPath, byteLength: outputStat.size, render: exportResult.render, probe: decoded.probe, frameCount: decoded.frameCount, fps: decoded.fps, frames: decoded.frames, updates: jobUpdates, mediaTools: { ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath } };
    receipt.comparisons = {};
    for (const sample of sampleTimes) {
      const stageToPreview = await comparePngs(mediaTools.ffmpegPath, receipt.stageSamples[sample.name].normalized, receipt.previewSamples[sample.name].normalized);
      const stageToExport = await comparePngs(mediaTools.ffmpegPath, receipt.stageSamples[sample.name].normalized, decoded.frames[sample.name]);
      const previewToExport = await comparePngs(mediaTools.ffmpegPath, receipt.previewSamples[sample.name].normalized, decoded.frames[sample.name]);
      assert(stageToPreview.meanAbsoluteChannelDifference <= 1.5, `${sample.name}: Stage and Product Preview differ by more than 1.5 mean channel values.`);
      assert(stageToExport.meanAbsoluteChannelDifference <= 18, `${sample.name}: Stage and formal MP4 differ by more than 18 mean channel values.`);
      assert(previewToExport.meanAbsoluteChannelDifference <= 18, `${sample.name}: Preview and formal MP4 differ by more than 18 mean channel values.`);
      receipt.comparisons[sample.name] = { actualTimeMs: receipt.stageSamples[sample.name].actualTimeMs, exportFrameIndex: sample.frame, stageToPreview, stageToExport, previewToExport };
    }
    await waitFor(mainWindow, `document.querySelector('[data-testid="export-task-surface"]')?.dataset.taskStatus === 'completed'`, 'Formal export task surface did not reach completed state.');
    receipt.ac07 = { result: 'PASS', durationMs: 6_000, actualMp4: outputPath, samples: Object.keys(receipt.comparisons) };

    const samePathReopen = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.reopenSamePath()');
    assert(samePathReopen?.project?.id === activeProject.id, 'Same-path close/reopen changed the Project identity.');
    const reopenedCharacter = samePathReopen.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    const reopenedPart = reopenedCharacter?.mode === 'adaptive-parts' ? reopenedCharacter.parts.find((part) => part.partId === partId) : null;
    assert(reopenedPart?.staticAdjustment?.scale > 1 && JSON.stringify(reopenedPart.sourceRestTransform) === JSON.stringify(sourceRestTransform), 'Saved source-rest baseline or edited transform did not survive UI close/reopen.');

    await click(mainWindow, characterRail, 'Open Characters after reopen');
    await waitFor(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`, 'Character drawer did not open after reopen.');
    if (await page(mainWindow, `(() => {
      const back = document.querySelector('[data-testid="adaptive-parts-back-to-list"]');
      const style = back ? getComputedStyle(back) : null;
      return Boolean(back?.getClientRects().length && style?.visibility !== 'hidden');
    })()`)) {
      await click(mainWindow, '[data-testid="adaptive-parts-back-to-list"]', 'Return to Character list after reopen');
    }
    await waitFor(mainWindow, `(() => {
      const list = document.querySelector(${JSON.stringify(characterList)});
      const style = list ? getComputedStyle(list) : null;
      return Boolean(list?.getClientRects().length && style?.visibility !== 'hidden');
    })()`, 'Character list did not return after reopen.');
    await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'Reopen C0 Adaptive Parts Character');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'C0 assembly did not reopen.');
    const cancelPartId = sourcePartIds['c0/com4'];
    await click(mainWindow, `.adaptive-parts-assembly-row[data-part-id="${cancelPartId}"] [data-testid="adaptive-parts-assembly-row-select"]`, 'Select com4 for Cancel check');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open inspector for Cancel check');
    const beforeCancel = await inspect(mainWindow);
    await setInputValue(mainWindow, '[data-testid="adaptive-parts-offset-x"]', 45);
    await page(mainWindow, 'window.confirm = () => true; true;');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Cancel the uncommitted assembly draft');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Cancel did not leave assembly.');
    const afterCancel = await inspect(mainWindow);
    assert(afterCancel.revision === beforeCancel.revision && afterCancel.dirty === beforeCancel.dirty && afterCancel.undoCount === beforeCancel.undoCount, 'Cancel wrote a Project revision, dirty state, or History entry.');
    const canceledProject = await projectService.open(projectRoot);
    const canceledCharacter = canceledProject.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(canceledCharacter?.mode === 'adaptive-parts' && canceledCharacter.parts.find((part) => part.partId === cancelPartId)?.staticAdjustment?.offsetX === 0, 'Cancel wrote the uncommitted Part offset to disk.');
    receipt.cancel = { result: 'PASS', before: { revision: beforeCancel.revision, dirty: beforeCancel.dirty, undoCount: beforeCancel.undoCount }, after: { revision: afterCancel.revision, dirty: afterCancel.dirty, undoCount: afterCancel.undoCount } };

    if (!(await page(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`))) {
      await click(mainWindow, characterRail, 'Reopen Character drawer for source reset');
      await waitFor(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`, 'Character drawer did not reopen for source reset.');
    }
    if (await page(mainWindow, `(() => {
      const list = document.querySelector(${JSON.stringify(characterList)});
      const style = list ? getComputedStyle(list) : null;
      return Boolean(list?.getClientRects().length && style?.visibility !== 'hidden');
    })()`)) {
      await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'Open C0 for source reset');
    }
    await waitFor(mainWindow, `(() => {
      const workbench = document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]');
      const style = workbench ? getComputedStyle(workbench) : null;
      return Boolean(workbench?.getClientRects().length && style?.visibility !== 'hidden');
    })()`, 'C0 workbench did not open before source reset.');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'C0 assembly did not reopen for source reset.');
    await click(mainWindow, `.adaptive-parts-assembly-row[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`, 'Select edited com6 for source reset');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open inspector for source reset');
    await click(mainWindow, `.adaptive-parts-assembly-row[data-part-id="${partId}"] [data-testid="adaptive-parts-restore-button"]`, 'Reset edited com6 to its source pose');
    assert(await page(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value === '100' && document.querySelector('[data-testid="adaptive-parts-rotation-deg"]')?.value === '0'`), 'Reset Source Position did not restore 0 / 0 / 100 / 0.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply source-pose reset');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="adaptive-parts-assembly-apply"]') && document.querySelector('[data-testid="adaptive-parts-assembly-cancel"]')`, 'Source-pose reset did not remain available after Apply.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Return to Character detail after source-pose reset');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Source-pose reset did not return to Character detail.');
    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-save"]', 'Save the source-pose reset');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.dirty === false`, 'Source-pose reset did not save.');
    const resetReopen = await page(mainWindow, 'window.__pandaStageIssue816Acceptance.reopenSamePath()');
    const resetCharacter = resetReopen?.project?.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    const resetPart = resetCharacter?.mode === 'adaptive-parts' ? resetCharacter.parts.find((part) => part.partId === partId) : null;
    assert(resetPart && JSON.stringify(resetPart.restTransform) === JSON.stringify(resetPart.sourceRestTransform) && resetPart.staticAdjustment?.offsetX === 0 && resetPart.staticAdjustment?.offsetY === 0 && resetPart.staticAdjustment?.scale === 1 && resetPart.staticAdjustment?.rotationDeg === 0, 'Source pose did not survive Apply, save, and close/reopen.');
    receipt.resetReopen = { result: 'PASS', sourceRestTransform: resetPart.sourceRestTransform, persistedRestTransform: resetPart.restTransform, staticAdjustment: resetPart.staticAdjustment };

    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Legacy regression controls after reset/reopen');
    await click(mainWindow, `${characterList} [data-character-id="${prepared.compositeCharacterId}"]`, 'Open the legacy composite control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(prepared.compositeCharacterId)}`, 'Legacy composite Character detail did not open.');
    await click(mainWindow, '[data-testid="character-workspace-assembly-tab"]', 'Open existing composite assembly tab');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-assembly-workbench"]')`, 'Existing composite assembly workbench did not open.');
    assert(!(await page(mainWindow, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]'))`)), 'Composite Character was routed into the Adaptive Parts workbench.');
    const legacyCompositeBefore = await page(mainWindow, `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return {
        headAssetId: workbench?.dataset.headAssetId ?? '',
        pivotX: Number(workbench?.dataset.headPivotX),
        pivotY: Number(workbench?.dataset.headPivotY),
        bodyPlacement: [workbench?.dataset.bodyOffsetX, workbench?.dataset.bodyOffsetY, workbench?.dataset.bodyScale],
        headPlacement: [workbench?.dataset.headOffsetX, workbench?.dataset.headOffsetY, workbench?.dataset.headScale],
        facePlacement: [workbench?.dataset.faceOffsetX, workbench?.dataset.faceOffsetY, workbench?.dataset.faceScale],
        projectRevision: workbench?.dataset.projectRevision ?? '',
        projectDirty: workbench?.dataset.projectDirty ?? '',
        headMotionRunning: workbench?.dataset.headMotionTestRunning ?? '',
      };
    })()`);
    assert(legacyCompositeBefore.headAssetId && Number.isFinite(legacyCompositeBefore.pivotX) && Number.isFinite(legacyCompositeBefore.pivotY), 'Legacy composite compatibility control did not load a Head with a neck pivot.');
    const legacyPivotToggle = '[data-testid="character-assembly-pivot-mode-toggle"]';
    const legacyPivotHandle = '[data-testid="character-assembly-head-pivot"]';
    await clickPoint(mainWindow, legacyPivotToggle, 'Enter the legacy composite neck-pivot tool');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.neckPivotEditing === 'true'`, 'Legacy composite neck-pivot tool did not activate.');
    await page(mainWindow, `document.querySelector(${JSON.stringify(legacyPivotHandle)})?.focus()`);
    mainWindow.focus();
    mainWindow.webContents.focus();
    await pause(40);
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await pause(40);
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headPivotX) === ${legacyCompositeBefore.pivotX + 1}`, 'Native ArrowRight did not nudge the legacy composite neck pivot by one local unit.');
    const legacyPivotNudged = await page(mainWindow, `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return {
        pivotX: Number(workbench?.dataset.headPivotX),
        pivotY: Number(workbench?.dataset.headPivotY),
        bodyPlacement: [workbench?.dataset.bodyOffsetX, workbench?.dataset.bodyOffsetY, workbench?.dataset.bodyScale],
        headPlacement: [workbench?.dataset.headOffsetX, workbench?.dataset.headOffsetY, workbench?.dataset.headScale],
        facePlacement: [workbench?.dataset.faceOffsetX, workbench?.dataset.faceOffsetY, workbench?.dataset.faceScale],
        projectRevision: workbench?.dataset.projectRevision ?? '',
        projectDirty: workbench?.dataset.projectDirty ?? '',
      };
    })()`);
    assert(legacyPivotNudged.pivotX === legacyCompositeBefore.pivotX + 1 && legacyPivotNudged.pivotY === legacyCompositeBefore.pivotY, 'Legacy composite pivot nudge changed an unexpected pivot coordinate.');
    assert(JSON.stringify(legacyPivotNudged.bodyPlacement) === JSON.stringify(legacyCompositeBefore.bodyPlacement)
      && JSON.stringify(legacyPivotNudged.headPlacement) === JSON.stringify(legacyCompositeBefore.headPlacement)
      && JSON.stringify(legacyPivotNudged.facePlacement) === JSON.stringify(legacyCompositeBefore.facePlacement), 'Legacy composite pivot nudge changed Body, Head, or Face placement.');
    assert(legacyPivotNudged.projectRevision === legacyCompositeBefore.projectRevision && legacyPivotNudged.projectDirty === legacyCompositeBefore.projectDirty, 'Legacy composite pivot draft wrote the Project before Apply.');
    await captureWhole(mainWindow, 'c3-legacy-composite-neck-pivot.png');
    await page(mainWindow, `document.querySelector(${JSON.stringify(legacyPivotHandle)})?.focus()`);
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    await pause(40);
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headPivotX) === ${legacyCompositeBefore.pivotX}`, 'Legacy composite pivot could not return to its original value.');
    await clickPoint(mainWindow, legacyPivotToggle, 'Leave the legacy composite neck-pivot tool');
    const legacyMotionToggle = '[data-testid="character-assembly-test-head-motion"]';
    await clickPoint(mainWindow, legacyMotionToggle, 'Preview legacy composite nod');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'true'`, 'Legacy composite nod preview did not start.');
    await pause(280);
    const legacyNodRunning = await page(mainWindow, `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      const group = document.querySelector('.character-assembly-head-group');
      const body = document.querySelector('.character-assembly-part-body');
      const head = document.querySelector('.character-assembly-part-head');
      const face = document.querySelector('.character-assembly-part-face');
      return {
        running: workbench?.dataset.headMotionTestRunning ?? '',
        animationName: group ? getComputedStyle(group).animationName : '',
        animationDuration: group ? getComputedStyle(group).animationDuration : '',
        headAndFaceShareMotionGroup: Boolean(group?.contains(head) && group?.contains(face)),
        bodyOutsideMotionGroup: Boolean(body && !group?.contains(body)),
        projectRevision: workbench?.dataset.projectRevision ?? '',
        projectDirty: workbench?.dataset.projectDirty ?? '',
      };
    })()`);
    assert(legacyNodRunning.animationName === 'character-assembly-head-motion-test' && legacyNodRunning.animationDuration === '0.5s', `Legacy composite nod preview did not use the existing 2 Hz motion: ${JSON.stringify(legacyNodRunning)}.`);
    assert(legacyNodRunning.headAndFaceShareMotionGroup && legacyNodRunning.bodyOutsideMotionGroup, 'Legacy composite nod preview moved the wrong parts.');
    assert(legacyNodRunning.projectRevision === legacyCompositeBefore.projectRevision && legacyNodRunning.projectDirty === legacyCompositeBefore.projectDirty, 'Legacy composite nod preview wrote the Project.');
    await captureWhole(mainWindow, 'c3-legacy-composite-nod.png');
    await clickPoint(mainWindow, legacyMotionToggle, 'Stop legacy composite nod preview');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'false'`, 'Legacy composite nod preview did not stop.');
    const legacyNodStopped = await page(mainWindow, `(() => {
      const group = document.querySelector('.character-assembly-head-group');
      return group ? getComputedStyle(group).animationName : '';
    })()`);
    assert(legacyNodStopped === 'none', `Legacy composite nod preview did not reset after stopping: ${legacyNodStopped}.`);
    receipt.legacyCompositeNeckPivotAndNod = {
      result: 'PASS',
      pivotBefore: { x: legacyCompositeBefore.pivotX, y: legacyCompositeBefore.pivotY },
      pivotNudged: { x: legacyPivotNudged.pivotX, y: legacyPivotNudged.pivotY },
      pivotRestored: true,
      unchangedPlacements: true,
      nodPreview: legacyNodRunning,
      nodStoppedAnimationName: legacyNodStopped,
      screenshots: ['c3-legacy-composite-neck-pivot.png', 'c3-legacy-composite-nod.png'],
    };
    if (!(await page(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`))) {
      await clickPoint(mainWindow, characterRail, 'Reopen Characters drawer after legacy composite assembly');
      await waitFor(mainWindow, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`, 'Characters drawer did not reopen after legacy composite assembly.');
    }
    await waitFor(mainWindow, `(() => {
      const button = document.querySelector('[data-testid="character-detail-back"]');
      const rect = button?.getBoundingClientRect();
      const style = button ? getComputedStyle(button) : null;
      return Boolean(rect?.width && rect.height && style?.visibility === 'visible' && style.display !== 'none');
    })()`, 'Legacy composite detail navigation did not return after reopening the Characters drawer.');
    await click(mainWindow, '[data-testid="character-detail-back"]', 'Return to Character list after composite compatibility');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Single-image compatibility control');
    await click(mainWindow, `${characterList} [data-character-id="${singleImageCharacterId}"]`, 'Open the legacy single-image control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(singleImageCharacterId)}`, 'Legacy single-image detail did not open.');
    assert(!(await page(mainWindow, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]'))`)), 'Legacy single-image Character incorrectly opened the Adaptive Parts workbench.');
    await click(mainWindow, '[data-testid="character-detail-back"]', 'Return to Character list after single-image compatibility');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Synthetic Body+Arm control');
    await click(mainWindow, `${characterList} [data-character-id="${prepared.bodyArmCharacterId}"]`, 'Open the synthetic Body+Arm Adaptive Part control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Synthetic Body+Arm assembly did not open.');
    const bodyArmRow = `.adaptive-parts-assembly-row[data-part-id="${prepared.bodyArmPartId}"]`;
    const bodyArmList = await page(mainWindow, `([...document.querySelectorAll('.adaptive-parts-assembly-row')]).map((row) => ({ partId: row.dataset.partId, name: row.querySelector('.adaptive-parts-assembly-name')?.innerText?.trim() ?? '' }))`);
    const bodyArmCanvasParts = await page(mainWindow, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length`);
    assert(bodyArmList.length === 1 && bodyArmList[0].partId === prepared.bodyArmPartId && bodyArmList[0].name === 'Body+Arm' && bodyArmCanvasParts === 1, 'Synthetic Body+Arm did not remain one named Part in both the list and canvas.');
    await click(mainWindow, `${bodyArmRow} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the combined Body+Arm Part');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open Body+Arm Part inspector');
    const bodyArmBefore = await inspect(mainWindow);
    const bodyArmDrag = await dragPart(mainWindow, prepared.bodyArmPartId, 14, 10);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value) > 0`, 'Dragging the combined Body+Arm Part did not adjust the single Part.');
    await click(mainWindow, `${bodyArmRow} [data-testid="adaptive-parts-restore-button"]`, 'Restore the Body+Arm Part source pose');
    assert(await page(mainWindow, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length === 1 && document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.value === '0'`), 'Body+Arm source reset split the Part or changed its source-pose controls.');
    await captureWhole(mainWindow, 'synthetic-body-arm-single-part.png');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Cancel the synthetic Body+Arm draft');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Synthetic Body+Arm draft did not cancel.');
    const bodyArmAfter = await inspect(mainWindow);
    assert(bodyArmAfter.revision === bodyArmBefore.revision && bodyArmAfter.undoCount === bodyArmBefore.undoCount, 'Synthetic Body+Arm selection/drag/reset wrote a Project revision or History entry before Apply.');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Repeated-image long-list control');
    receipt.syntheticBodyArm = { result: 'PASS', partCount: bodyArmList.length, partId: prepared.bodyArmPartId, sourceId: 'synthetic/body-arm-composite', displayName: bodyArmList[0].name, canvasPartCount: bodyArmCanvasParts, drag: bodyArmDrag, sourceReset: 'PASS', canceledWithoutProjectWrite: true, assetPath: prepared.bodyArmPath };

    await click(mainWindow, `${characterList} [data-character-id="${prepared.longListCharacterId}"]`, 'Open repeated-image long-list compatibility control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Repeated-image long-list workbench did not open.');
    const longListRows = await page(mainWindow, `([...document.querySelectorAll('.adaptive-parts-assembly-row')]).map((row) => ({ partId: row.dataset.partId, name: row.querySelector('.adaptive-parts-assembly-name')?.innerText?.trim() ?? '' }))`);
    const longListProjectCharacter = await page(mainWindow, `(() => { const state = window.__pandaStageIssue816Acceptance?.inspect?.(); const character = state?.project?.characters?.find((item) => item.id === ${JSON.stringify(prepared.longListCharacterId)}); return character?.mode === 'adaptive-parts' ? { partCount: character.parts.length, assetIds: [...new Set(character.parts.map((part) => part.assetId))], partIds: character.parts.map((part) => part.partId) } : null; })()`);
    assert(longListRows.length === prepared.longListPartCount && longListProjectCharacter?.partCount === prepared.longListPartCount, `Long list displayed ${longListRows.length} rows; expected ${prepared.longListPartCount}.`);
    assert(new Set(longListRows.map((row) => row.partId)).size === prepared.longListPartCount && new Set(longListRows.map((row) => row.name)).size === prepared.longListPartCount, 'Repeated-image Part rows lost unique identities or names.');
    assert(longListProjectCharacter.assetIds.length === 1 && longListProjectCharacter.partIds.length === prepared.longListPartCount, 'Repeated-image control did not retain one shared Asset across distinct Part identities.');
    const lastLongListPartId = longListRows.at(-1)?.partId;
    assert(lastLongListPartId, 'Long-list control has no last Part to select.');
    const lastLongListRow = `.adaptive-parts-assembly-row[data-part-id="${lastLongListPartId}"]`;
    await click(mainWindow, `${lastLongListRow} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the last Part in the repeated-image long list');
    const longListViewport = await page(mainWindow, `(() => { const list = document.querySelector('.adaptive-parts-assembly-rows'); const row = document.querySelector(${JSON.stringify(lastLongListRow)}); const canvas = document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected'); return { clientHeight: list?.clientHeight ?? 0, scrollHeight: list?.scrollHeight ?? 0, scrollTop: list?.scrollTop ?? 0, lastRowSelected: row?.querySelector('[data-testid="adaptive-parts-assembly-row-select"]')?.getAttribute('aria-pressed') === 'true', selectedCanvasPart: canvas?.dataset.partId ?? null }; })()`);
    assert(longListViewport.scrollHeight > longListViewport.clientHeight && longListViewport.scrollTop > 0, `Long-list scrolling did not reach the bottom row: ${JSON.stringify(longListViewport)}.`);
    assert(longListViewport.lastRowSelected && longListViewport.selectedCanvasPart === lastLongListPartId, 'Selecting the last repeated-image Part did not synchronize list and canvas selection.');
    const longListBeforeCancel = await inspect(mainWindow);
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Cancel repeated-image long-list inspection');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Long-list inspection did not cancel.');
    const longListAfterCancel = await inspect(mainWindow);
    assert(longListAfterCancel.revision === longListBeforeCancel.revision && longListAfterCancel.undoCount === longListBeforeCancel.undoCount, 'Long-list selection wrote a Project revision or History entry.');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Character list after long-list compatibility');
    receipt.syntheticLongList = {
      result: 'PASS',
      partCount: longListRows.length,
      uniquePartIds: new Set(longListRows.map((row) => row.partId)).size,
      uniqueNames: new Set(longListRows.map((row) => row.name)).size,
      distinctSharedAssetCount: longListProjectCharacter.assetIds.length,
      selectedLastPartId: lastLongListPartId,
      viewport: longListViewport,
      canceledWithoutProjectWrite: true,
    };
    receipt.ac08 = {
      result: 'PASS',
      coverage: 'PASS: missing source renders an error thumbnail, keeps its row selectable, omits only its canvas image, and retries after the restored source is reopened.',
      legacySingleImageDetail: 'PASS',
      legacyCompositeAssemblyWorkbenchEntry: 'PASS',
      legacyCompositeNeckPivotAndNod: receipt.legacyCompositeNeckPivotAndNod.result,
      missingAssetThumbnailAndRecovery: receipt.missingAssetRecovery.result,
      syntheticBodyArmSinglePart: 'PASS',
      repeatedImageLongList: 'PASS',
      hiddenPartRemainsInListAndCanBeReselected: 'PASS',
      domainNegativeCases: {
        duplicatePartIdentity: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts',
        repeatedImageAsset: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts and syntheticLongList',
        missingAssetReferenceRejected: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts',
        invalidAssetDimensions: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts',
        invalidMatrix: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts',
        staleCrossProjectDraft: 'PASS: tests/integration/adaptive-parts-lifecycle.test.ts',
      },
      legacyVerifier: {
        command: 'pnpm verify:issue609-character-assembly',
        result: 'FAILED_BEFORE_UI',
        reason: 'Historical fixture assets omit schema-required usage and keywords; UI behavior was not reached.',
      },
      syntheticCompatibilityControlUsesImportedLocalAssets: true,
    };
    receipt.ac06 = { result: 'PASS', sharedCharacterDefinition: 'Shot Layer references the same Character ID after Apply; no per-Shot Character copy was created.' };
    receipt.ac09 = {
      result: 'AUTO_PASS',
      coverage: 'PASS: reviewed wide, narrow landscape, portrait viewport, and collapsed/expanded Timeline heights; touch PointerEvents tested in narrow landscape.',
      inspectorCollapsedAndFloating: 'PASS',
      narrowLandscape: 'PASS: 880 CSS-pixel window, five Part rows and Apply/Cancel visible, touch PointerEvents tracked, inspector avoids Part bounds.',
      permanentCanvasInstructions: ac09Checks.permanentCanvasInstructions,
      timelineHeights: ac09Checks.timelineHeightReview,
      cloudTouchOrientation: ac09Checks.cloudTouchOrientationReview,
      visualDesignReview: 'CODEX_REVIEW_PASS: screenshots reviewed for compact layout, tokenized controls, focus state, and visible feedback; permanent drag/scale copy removed.',
      notRun: ['physical Cloud Touch touchscreen acceptance'],
    };
    receipt.ac10 = { result: 'AUTO_PASS', command: 'PANDA_STAGE_ISSUE899_SOURCE_DIR=<local Issue 893 isolated-layers> electron scripts/verify-issue899-c3-v0.cjs', screenshots: path.join(evidenceRoot, '*.png'), receiptPath: resultPath };
    receipt.ac11 = { result: 'NOT_ATTESTED', ownerWindowsRealMaterialSignOff: 'OWNER must personally review the actual source sample and Body+Arm composite on Windows.' };
    receipt.schemaCollision = 'DEFERRED_BY_OWNER / MERGE_BLOCKED';
    receipt.auto = 'PARTIAL';
    receipt.status = 'C3_PARTIAL_OWNER_GATE_PENDING';
    receipt.completedAt = new Date().toISOString();
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  } catch (error) {
    receipt.auto = 'AUTO_FAIL';
    receipt.status = issue903BackProbe ? 'ISSUE903_BACK_PROBE_FAILED' : issue901UiA ? 'UI_A_AUTO_FAIL' : 'C3_PARTIAL';
    receipt.failedAt = new Date().toISOString();
    receipt.failedAtAction = currentVerifierAction;
    receipt.rendererDiagnostics = rendererDiagnostics;
    receipt.error = error instanceof Error ? error.stack ?? error.message : String(error);
    receipt.trackedSnapshot = trackedSnapshot;
    receipt.jobUpdates = jobUpdates;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        receipt.failureUi = await page(mainWindow, `(() => ({
          title: document.title,
          activeActivity: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity ?? null,
          activeSubview: document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview ?? null,
          assembly: Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')),
          characterList: Boolean(document.querySelector('[data-testid="character-list-view"]')),
          stage: (() => {
            const host = document.querySelector('[data-testid="project-canvas-stage"]');
            return host ? { dataset: { ...host.dataset }, canvases: [...host.querySelectorAll('canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height })) } : null;
          })(),
          bodyText: document.body.innerText.slice(0, 1800),
        }))()`);
        receipt.failureScreenshot = await captureWhole(mainWindow, 'failure-screen.png');
      } catch (diagnosticError) {
        receipt.failureDiagnosticsError = diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
      }
    }
    await fsp.writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    hiddenWindowManager?.close();
    await exportPreparationService?.dispose().catch(() => undefined);
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }
}

main()
  .then((receipt) => {
    process.stdout.write(`${JSON.stringify({ status: receipt.status, evidenceRoot, ...(issue901UiA ? {} : { outputPath }), resultPath }, null, 2)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[${issue903BackProbe ? 'issue903-back-probe' : issue901UiA ? 'issue901-ui-a' : 'issue899-c3'}] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  });
