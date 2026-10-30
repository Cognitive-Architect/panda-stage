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

const sourceDir = process.env.PANDA_STAGE_ISSUE899_SOURCE_DIR;
const acceptanceRoot = process.env.PANDA_STAGE_ISSUE899_ROOT ?? 'D:\\PandaStage-Acceptance\\issue899-c3';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const cropRoot = path.join(runRoot, 'source-crops');
const projectRoot = path.join(runRoot, 'projects', 'c0-adaptive-parts.pandastage');
const outputPath = path.join(runRoot, 'c0-adaptive-parts-edited-6s.mp4');
const resultPath = path.join(runRoot, 'issue899-c3-v0-receipt.json');
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
const assetBytes = new Map();
const assetCanvasImageReadCounts = new Map();

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

async function captureWhole(window, fileName) {
  await page(window, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
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
  const selector = `[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="${partId}"] .adaptive-parts-assembly-scale-handle`;
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

async function clickPoint(window, selector, label = selector) {
  await waitFor(window, "document.querySelector(" + JSON.stringify(selector) + ")", label + " did not appear.");
  const target = await page(window,
    "(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); " +
    "const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); " +
    "return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, " +
    "width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility, " +
    "disabled: Boolean(element.disabled) }; })()");
  assert(target.width > 0 && target.height > 0 && target.display !== 'none' &&
    target.visibility === 'visible' && !target.disabled,
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
  return { cssPoint: { x: target.x, y: target.y }, inputFactor: factor };
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
    "rows: rows.map((row) => { const bounds = row.getBoundingClientRect(); const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); " +
    "const style = getComputedStyle(row); return { partId: row.dataset.partId, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, " +
    "visible: style.display !== 'none' && style.visibility === 'visible', hitTestedWithinRow: Boolean(target && row.contains(target)), " +
    "insideWindow: bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight }; }), " +
    "footerButtons: [...(footer?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText.trim(), ...rect(button) })) }; })()");
}

async function touchDragPart(window, partId, dx, dy) {
  const selector = '[data-testid="adaptive-parts-assembly-canvas-part"][data-part-id="' + partId + '"]';
  const target = await page(window,
    "(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) return null; " +
    "const bounds = element.getBoundingClientRect(); const x = bounds.left + bounds.width / 2; const y = bounds.top + bounds.height / 2; " +
    "const hit = document.elementFromPoint(x, y); return { x, y, width: bounds.width, height: bounds.height, " +
    "hitPartId: hit?.closest('[data-testid=\"adaptive-parts-assembly-canvas-part\"]')?.dataset.partId ?? null }; })()");
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
  const created = await setupProjectService.create(projectRoot, { name: 'Issue 899 C3 C0 Adaptive Parts' });
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
  const mediaTools = registerExportServices();
  await app.whenReady();
  mainWindow = await createMainWindow({ show: true, issue816Acceptance: true });
  mainWindow.setSize(1660, 1100);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();

  const receipt = {
    issue: 899,
    checkpoint: 'C3 V0',
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
    await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'C0 Adaptive Parts Character');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-open"]')`, 'Adaptive Character detail has no normal assembly entry.');

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
      await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Open Adaptive Parts assembly with a missing source image');
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
      await captureWhole(mainWindow, 'c3-missing-asset-fallback.png');
      await click(mainWindow, `${missingRowSelector} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the Part whose source image is missing');
      await waitFor(mainWindow, `document.querySelector(${JSON.stringify(missingRowSelector)} + ' [data-testid="adaptive-parts-assembly-row-select"]')?.getAttribute('aria-pressed') === 'true'`, 'A Part with a missing source could not be selected from its row.');
      const afterMissingSelection = await inspect(mainWindow);
      assert(afterMissingSelection.revision === beforeMissingAsset.revision && afterMissingSelection.dirty === beforeMissingAsset.dirty && afterMissingSelection.undoCount === beforeMissingAsset.undoCount,
        'Showing/selecting a missing source wrote a Project revision, dirty state, or History entry.');
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
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Reopen Adaptive Parts assembly after restoring the source image');
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
    await waitFor(mainWindow, `(() => {
      const dock = document.querySelector('[data-testid="resource-activity-dock"]');
      const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
      const style = surface ? getComputedStyle(surface) : null;
      return dock?.dataset.resourceDrawerOpen === 'true' && style?.visibility === 'hidden' && Number(style.opacity) < 0.01;
    })()`, 'The resource drawer is not visually hidden while preserving its mounted Character owner.');
    receipt.ac01 = { result: 'PASS', path: 'Characters list → C0 detail → assembly' };
    ac09Checks.permanentCanvasInstructions = 'PASS: no persistent drag/scale helper copy';

    const rows = await page(mainWindow, `([...document.querySelectorAll('.adaptive-parts-assembly-row')]).map((row) => ({ partId: row.dataset.partId, drawOrder: Number(row.dataset.drawOrder), name: row.querySelector('.adaptive-parts-assembly-name')?.innerText?.trim() ?? '', visible: row.querySelector('[data-part-visible]')?.dataset.partVisible ?? null }))`);
    assert(rows.length === 5, `C0 Part list shows ${rows.length} rows; expected 5.`);
    const visibleRows = await page(mainWindow, `(() => [...document.querySelectorAll('.adaptive-parts-assembly-row')].map((row) => {
      const bounds = row.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      const style = getComputedStyle(row);
      return { partId: row.dataset.partId, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility, hitTestedWithinRow: Boolean(target && row.contains(target)) };
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
    assert(narrowViewport.rows.length === 5 &&
      narrowViewport.rows.every((row) => row.visible && row.hitTestedWithinRow && row.insideWindow),
    'Narrow assembly Part rows are clipped or cannot receive pointer input: ' + JSON.stringify(narrowViewport));
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
    const narrowClick = await clickPoint(mainWindow, narrowSelectedRow, 'Select C0 com6 in the narrow Part list');
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
    assert(narrowInspectorLayout.inspector?.width <= 182 && !narrowInspectorOverlapsArt,
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
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Close the narrow Part inspector before orientation change');
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
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-reset"]', 'Reset the preserved portrait touch draft');
    await waitFor(mainWindow,
      "document.querySelector('[data-testid=\"adaptive-parts-offset-x\"]')?.value === '0' && document.querySelector('[data-testid=\"adaptive-parts-offset-y\"]')?.value === '0' && document.querySelector('[data-testid=\"adaptive-parts-scale-percent\"]')?.value === '100'",
      'Reset did not discard the preserved portrait touch draft.');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Close the Part inspector after portrait orientation');
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
    await click(mainWindow, `${com2Row} summary`, 'Open com2 Part menu');
    await click(mainWindow, `${com2Row} [data-adaptive-part-action="visibility"]`, 'Hide com2');
    assert(await page(mainWindow, `Boolean(document.querySelector(${JSON.stringify(com2Row)}))`), 'Hidden Part was removed from the Part list.');
    await click(mainWindow, `${com2Row} [data-testid="adaptive-parts-assembly-row-select"]`, 'Select the hidden com2 Part');
    await click(mainWindow, `${com2Row} [data-adaptive-part-action="visibility"]`, 'Show com2');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value === '100'`, 'Selecting the second source Part did not load its independent source-relative controls.');
    const secondPartDrag = await dragPart(mainWindow, com2, 12, 8);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value) > 0`, 'Dragging the second source Part did not update its own offset.');
    const secondPartScale = await scalePart(mainWindow, com2, 10, 8);
    await waitFor(mainWindow, `Number(document.querySelector('[data-testid="adaptive-parts-scale-percent"]')?.value) > 100`, 'Scaling the second source Part did not update its own scale.');

    await page(mainWindow, `window.prompt = () => 'com6 edited'; true;`);
    const com6Row = `.adaptive-parts-assembly-row[data-part-id="${partId}"]`;
    await click(mainWindow, `${com6Row} summary`, 'Open com6 Part menu');
    await click(mainWindow, `${com6Row} [data-adaptive-part-action="rename"]`, 'Rename com6');
    await waitFor(mainWindow, `document.querySelector(${JSON.stringify(com6Row)})?.innerText.includes('com6 edited')`, 'Part rename did not update its displayed name.');
    await captureWhole(mainWindow, 'c3-assembly-edited-draft.png');

    const historyBeforeApply = await inspect(mainWindow);
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-apply"]', 'Apply the C0 Part edits');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]') && document.querySelector('[data-testid="adaptive-parts-assembly-apply"]') && document.querySelector('[data-testid="adaptive-parts-assembly-cancel"]')`, 'Apply did not keep the committed assembly available for further edits.');
    const afterApply = await inspect(mainWindow);
    assert(afterApply.revision === historyBeforeApply.revision + 1 && afterApply.dirty && afterApply.undoCount === historyBeforeApply.undoCount + 1, 'One Apply did not produce exactly one dirty project revision and History entry.');
    const savedCharacterAfterApply = afterApply.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    const editedPart = savedCharacterAfterApply?.mode === 'adaptive-parts' ? savedCharacterAfterApply.parts.find((part) => part.partId === partId) : null;
    const editedSecondPart = savedCharacterAfterApply?.mode === 'adaptive-parts' ? savedCharacterAfterApply.parts.find((part) => part.partId === com2) : null;
    assert(editedPart?.displayName === 'com6 edited' && editedPart.staticAdjustment?.offsetX > 0 && editedPart.staticAdjustment?.scale > 1 && editedPart.staticAdjustment?.rotationDeg === 6, 'Apply did not persist the renamed and transformed C0 Part.');
    assert(editedSecondPart?.staticAdjustment?.offsetX > 0 && editedSecondPart.staticAdjustment?.scale > 1, 'Apply did not persist the independent drag and scale of the second C0 Part.');
    assert(JSON.stringify(editedPart.sourceRestTransform) === JSON.stringify(sourceRestTransform), 'Apply changed the saved source-rest baseline.');
    const originalPart = prepared.parts.find((part) => part.partId === partId);
    assert(originalPart && editedPart.assetId === originalPart.assetId && editedPart.drawOrder === originalPart.drawOrder && JSON.stringify(editedPart.imageMapping) === JSON.stringify(originalPart.imageMapping), 'Part edit changed source identity, crop, asset, or draw order.');
    receipt.ac03 = {
      result: 'PASS',
      coverage: 'Windows Electron mouse drag/scale plus touch PointerEvents at an 880 CSS-pixel viewport; resized canvas fit exercised.',
      interactiveParts: [
        { sourceId: 'c0/com6', drag, scale },
        { sourceId: 'c0/com2', drag: secondPartDrag, scale: secondPartScale },
      ],
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
    receipt.ac05 = { result: 'PASS', before: { revision: beforeDraft.revision, dirty: beforeDraft.dirty, undoCount: beforeDraft.undoCount }, draft: { revision: afterDraft.revision, dirty: afterDraft.dirty, undoCount: afterDraft.undoCount }, apply: { revision: afterApply.revision, dirty: afterApply.dirty, undoCount: afterApply.undoCount } };
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Return to Character detail after clean Apply');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Committed assembly did not return to Character detail.');

    await expandProjectActions(mainWindow);
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:first-of-type', 'Undo C0 assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 1`, 'Undo did not create a Redo entry.');
    const afterUndo = await inspect(mainWindow);
    const undoneCharacter = afterUndo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(undoneCharacter?.mode === 'adaptive-parts' && undoneCharacter.parts.find((part) => part.partId === partId)?.displayName !== 'com6 edited', 'Undo did not restore the prior Part definition.');
    await click(mainWindow, '[data-testid="quick-action-history"] .history-actions button:last-of-type', 'Redo C0 assembly Apply');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.undoCount === 1 && window.__pandaStageIssue816Acceptance?.inspect?.()?.redoCount === 0`, 'Redo did not restore the assembly Apply.');
    const afterRedo = await inspect(mainWindow);
    assert(afterRedo.project.characters.find((candidate) => candidate.id === adaptiveCharacterId)?.mode === 'adaptive-parts', 'Redo lost the Adaptive Parts Character.');
    await click(mainWindow, '[data-testid="quick-action-save"]', 'Save the edited C0 Project');
    await waitFor(mainWindow, `window.__pandaStageIssue816Acceptance?.inspect?.()?.dirty === false`, 'Edited C0 Project did not save.');
    const persistedEdited = await projectService.open(projectRoot);
    const persistedEditedCharacter = persistedEdited.project.characters.find((candidate) => candidate.id === adaptiveCharacterId);
    assert(persistedEditedCharacter?.mode === 'adaptive-parts' && persistedEditedCharacter.parts.find((part) => part.partId === partId)?.staticAdjustment?.scale > 1, 'Save/reopen did not persist the edited Part transform.');
    receipt.applyUndoRedoSave = { undo: 'PASS', redo: 'PASS', save: 'PASS', sourceRestSurvives: 'PASS', savedProjectSha256: sha256(await fsp.readFile(path.join(projectRoot, 'project.json'))) };

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
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Reopen C0 assembly');
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
      await click(mainWindow, `${characterList} [data-character-id="${adaptiveCharacterId}"]`, 'Return to C0 detail for source reset');
    }
    await waitFor(mainWindow, `(() => {
      const button = document.querySelector('[data-testid="adaptive-parts-assembly-open"]');
      const style = button ? getComputedStyle(button) : null;
      return Boolean(button?.getClientRects().length && style?.visibility !== 'hidden');
    })()`, 'C0 detail did not expose assembly before source reset.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Reopen C0 assembly for source reset');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'C0 assembly did not reopen for source reset.');
    await click(mainWindow, `.adaptive-parts-assembly-row[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`, 'Select edited com6 for source reset');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-toggle"]', 'Open inspector for source reset');
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-reset"]', 'Reset edited com6 to its source pose');
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
    assert(!(await page(mainWindow, `Boolean(document.querySelector('[data-testid="adaptive-parts-assembly-open"]'))`)), 'Legacy single-image Character incorrectly exposes the Adaptive assembly entry.');
    await click(mainWindow, '[data-testid="character-detail-back"]', 'Return to Character list after single-image compatibility');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Synthetic Body+Arm control');
    await click(mainWindow, `${characterList} [data-character-id="${prepared.bodyArmCharacterId}"]`, 'Open the synthetic Body+Arm Adaptive Part control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-open"]')`, 'Synthetic Body+Arm detail did not expose the Adaptive assembly entry.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Open the synthetic Body+Arm assembly');
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
    await click(mainWindow, '[data-testid="adaptive-parts-inspector-reset"]', 'Restore the Body+Arm Part source pose');
    assert(await page(mainWindow, `document.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]').length === 1 && document.querySelector('[data-testid="adaptive-parts-offset-x"]')?.value === '0' && document.querySelector('[data-testid="adaptive-parts-offset-y"]')?.value === '0'`), 'Body+Arm source reset split the Part or changed its source-pose controls.');
    await captureWhole(mainWindow, 'synthetic-body-arm-single-part.png');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-cancel"]', 'Cancel the synthetic Body+Arm draft');
    await waitFor(mainWindow, `!document.querySelector('[data-testid="adaptive-parts-assembly-workbench"]')`, 'Synthetic Body+Arm draft did not cancel.');
    const bodyArmAfter = await inspect(mainWindow);
    assert(bodyArmAfter.revision === bodyArmBefore.revision && bodyArmAfter.undoCount === bodyArmBefore.undoCount, 'Synthetic Body+Arm selection/drag/reset wrote a Project revision or History entry before Apply.');
    await ensureCharacterListReady(mainWindow, characterRail, characterList, 'Repeated-image long-list control');
    receipt.syntheticBodyArm = { result: 'PASS', partCount: bodyArmList.length, partId: prepared.bodyArmPartId, sourceId: 'synthetic/body-arm-composite', displayName: bodyArmList[0].name, canvasPartCount: bodyArmCanvasParts, drag: bodyArmDrag, sourceReset: 'PASS', canceledWithoutProjectWrite: true, assetPath: prepared.bodyArmPath };

    await click(mainWindow, `${characterList} [data-character-id="${prepared.longListCharacterId}"]`, 'Open repeated-image long-list compatibility control');
    await waitFor(mainWindow, `document.querySelector('[data-testid="adaptive-parts-assembly-open"]')`, 'Long-list Adaptive Character detail did not expose the assembly entry.');
    await click(mainWindow, '[data-testid="adaptive-parts-assembly-open"]', 'Open the repeated-image long list');
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
    const longListViewport = await page(mainWindow, `(() => { const list = document.querySelector('.adaptive-parts-assembly-list'); const row = document.querySelector(${JSON.stringify(lastLongListRow)}); const canvas = document.querySelector('[data-testid="adaptive-parts-assembly-canvas-part"].is-selected'); return { clientHeight: list?.clientHeight ?? 0, scrollHeight: list?.scrollHeight ?? 0, scrollTop: list?.scrollTop ?? 0, lastRowSelected: row?.querySelector('[data-testid="adaptive-parts-assembly-row-select"]')?.getAttribute('aria-pressed') === 'true', selectedCanvasPart: canvas?.dataset.partId ?? null }; })()`);
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
    receipt.status = 'C3_PARTIAL';
    receipt.failedAt = new Date().toISOString();
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
    process.stdout.write(`${JSON.stringify({ status: receipt.status, evidenceRoot, outputPath, resultPath }, null, 2)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[issue899-c3] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  });
