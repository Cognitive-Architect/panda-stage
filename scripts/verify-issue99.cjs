const {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} = require('node:fs/promises');
const { appendFileSync, unlinkSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('enable-precise-memory-info');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/issue-99',
);
const temporaryDirectories = [];
const assetDragMime = 'application/x-panda-stage-asset';
const imageWidth = 1_536;
const imageHeight = 864;
const progressLogPath = path.join(
  os.tmpdir(),
  'panda-stage-issue99-progress.log',
);

try {
  unlinkSync(progressLogPath);
} catch {
  // No prior progress log is required.
}

function progress(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(progressLogPath, line, 'utf8');
  console.log(line.trim());
}

progress('module evaluated');

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
progress('media tool environment prepared');

const { ProjectSchema } = require('../dist-electron/domain/index.js');
const { AssetImportService } = require(
  '../dist-electron/main/services/AssetImportService.js',
);
const { CacheService } = require(
  '../dist-electron/main/services/CacheService.js',
);
const { ProjectService } = require(
  '../dist-electron/main/services/ProjectService.js',
);
progress('production services loaded');

// Load the actual application entry point. This verifier crosses the real
// Main -> preload -> renderer boundary and does not mock the canvas IPC.
require('../dist-electron/main/index.js');
progress('application entry loaded');

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
        // Renderer may be between commits; keep polling.
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

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function fileSha256(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function cachePathFor(projectRoot, sha256) {
  const cache = new CacheService();
  return cache.thumbnailPath(projectRoot, cache.thumbnailKey(sha256));
}

function isPng(bytes) {
  return bytes.length >= 24 && Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]).equals(bytes.subarray(0, 8));
}

async function pngReceipt(filePath) {
  if (!(await fileExists(filePath))) {
    return { exists: false, validPng: false, bytes: 0 };
  }
  const bytes = await readFile(filePath);
  return {
    exists: true,
    validPng: isPng(bytes),
    bytes: bytes.length,
    width: isPng(bytes) && bytes.length >= 24 ? bytes.readUInt32BE(16) : 0,
    height: isPng(bytes) && bytes.length >= 24 ? bytes.readUInt32BE(20) : 0,
  };
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

function createDetailedPng(width, height) {
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
      scanlines[offset] = grid ? 255 : (x * 13 + y * 7) & 0xff;
      scanlines[offset + 1] = grid ? 255 : (x * 3 + y * 19) & 0xff;
      scanlines[offset + 2] = grid ? 255 : (x * 23 + y * 5) & 0xff;
      offset += 3;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', require('node:zlib').deflateSync(scanlines, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function convertPngToJpeg(sourcePath, targetPath) {
  await execFileAsync(
    process.env.PANDA_STAGE_FFMPEG_PATH,
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      targetPath,
    ],
    { windowsHide: true },
  );
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
  await delay(50);
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

async function clickElement(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    element.click();
  })()`);
  await delay(150);
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

async function activateAssetLibrary(window) {
  await clickElement(
    window,
    '[data-testid="resource-activity-tabs"] [data-activity="assets"]',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeActivity === 'assets'`,
    'Asset activity did not activate.',
  );
  await clickElement(
    window,
    '[data-testid="asset-library"] .asset-category-tabs button:nth-child(2)',
  );
}

async function snapshot(window, fixture) {
  const assetIds = [fixture.backgroundAsset.id, fixture.contentAsset.id];
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const saveButton = document.querySelector('.editor-save-button');
    const canvas = stage?.querySelector('canvas');
    const assetIds = ${JSON.stringify(assetIds)};
    const cards = Object.fromEntries(assetIds.map((assetId) => {
      const card = document.querySelector('[data-asset-id="' + assetId + '"]');
      const image = card?.querySelector('.asset-card-preview img');
      return [assetId, {
        srcPrefix: image?.getAttribute('src')?.slice(0, 22) ?? null,
        placeholder: card?.querySelector('[data-thumbnail-status]')?.getAttribute('data-thumbnail-status') ?? null,
      }];
    }));
    return {
      activeProjectRoot: document.querySelector('[data-testid="active-project-path"] code')?.textContent ?? null,
      layers: stage ? JSON.parse(stage.dataset.layerJson || '[]') : [],
      renderedAssetIds: stage ? JSON.parse(stage.dataset.renderedAssetIds || '[]') : [],
      intrinsicSizes: stage ? JSON.parse(stage.dataset.renderedAssetIntrinsicSizes || '[]') : [],
      renderSource: stage?.dataset.renderSource ?? null,
      transformMode: document.querySelector('[data-testid="canvas-transform-contract"]')?.dataset.transformMode ?? null,
      backgroundLayerId: stage?.dataset.backgroundLayerId ?? '',
      backgroundReady: stage?.dataset.backgroundReady === 'true',
      backgroundWarning: Boolean(document.querySelector('[data-testid="canvas-background-warning"]')),
      selectedLayerId: stage?.dataset.selectedLayerId ?? '',
      projectRevision: Number(stage?.dataset.projectRevision ?? -1),
      dirty: Boolean(saveButton && !saveButton.disabled),
      undoCount: Number(history?.dataset.undoCount ?? -1),
      redoCount: Number(history?.dataset.redoCount ?? -1),
      devicePixelRatio: window.devicePixelRatio,
      canvasBackingSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      cards,
      stageError: document.querySelector('[data-testid="stage-error"]')?.textContent ?? null,
    };
  })()`);
}

async function readCanvasImageSummary(window, fixture, asset) {
  return window.webContents.executeJavaScript(`(async () => {
    const response = await window.pandaStage.assets.readCanvasImage(${JSON.stringify({
      projectRoot: fixture.root,
      assetId: asset.id,
      sha256: asset.sha256,
    })});
    return response.ok
      ? {
          ok: true,
          status: response.status,
          mimeType: response.mimeType,
          width: response.width,
          height: response.height,
          byteLength: response.bytes.byteLength,
          isTypedArray: ArrayBuffer.isView(response.bytes),
        }
      : response;
  })()`);
}

async function waitForRenderedAssets(window, expectedIds) {
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      if (!stage) return false;
      const rendered = JSON.parse(stage.dataset.renderedAssetIds || '[]');
      return ${JSON.stringify(expectedIds)}.every((assetId) => rendered.includes(assetId));
    })()`,
    `Canvas did not load assets: ${expectedIds.join(', ')}`,
  );
}

async function dispatchAssetDrop(window, assetId, point) {
  await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-asset-id="${assetId}"]');
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    if (!card || !viewport) throw new Error('Asset drop surface did not render.');
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    const rect = viewport.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    const offsetX = Number(viewport.dataset.offsetX);
    const offsetY = Number(viewport.dataset.offsetY);
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + offsetX + ${point.x} * scale - viewport.scrollLeft,
      clientY: rect.top + offsetY + ${point.y} * scale - viewport.scrollTop,
    };
    viewport.dispatchEvent(new DragEvent('dragenter', eventOptions));
    viewport.dispatchEvent(new DragEvent('dragover', eventOptions));
    viewport.dispatchEvent(new DragEvent('drop', eventOptions));
    card.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: transfer,
    }));
    if (!transfer.getData(${JSON.stringify(assetDragMime)})) {
      throw new Error('Asset drag payload was empty.');
    }
  })()`);
  await delay(250);
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
  await delay(200);
}

async function selectLayer(window, layerId, point) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickLogicalPoint(window, point);
    const current = await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId ?? ''`,
    );
    if (current === layerId) return;
    await delay(200);
  }
  throw new Error(`Canvas did not select ordinary layer: ${layerId}`);
}

async function applyTransform(window, expected) {
  const values = [
    expected.x,
    expected.y,
    expected.scale,
    expected.rotationDeg,
    expected.opacity,
  ];
  for (let index = 0; index < values.length; index += 1) {
    await setTransformInput(window, index, values[index]);
  }
  await clickElement(
    window,
    '[data-testid="layer-transform-panel"] form button[type="submit"]',
  );
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(expected.layerId)});
      return layer && layer.x === ${expected.x} && layer.y === ${expected.y} && layer.scaleX === ${expected.scale} && layer.scaleY === ${expected.scale} && layer.rotationDeg === ${expected.rotationDeg} && layer.opacity === ${expected.opacity};
    })()`,
    'Ordinary image transform did not commit to project data.',
  );
}

async function createImportedProject(tempRoot, label) {
  const root = path.join(tempRoot, `issue99-${label}.pandastage`);
  const sourceDirectory = path.join(tempRoot, `sources-${label}`);
  await mkdir(sourceDirectory, { recursive: true });
  const pngSource = path.join(sourceDirectory, 'issue99-detail.png');
  const jpgSource = path.join(sourceDirectory, 'issue99-detail.jpg');
  await writeFile(pngSource, createDetailedPng(imageWidth, imageHeight));
  await convertPngToJpeg(pngSource, jpgSource);

  const projectService = new ProjectService();
  const created = await projectService.create(root, {
    name: `Issue 99 ${label}`,
  });
  let current = { project: created.project, revision: 0 };
  const importService = new AssetImportService({
    projectService,
    getCurrentProjectSnapshot: (projectRoot) =>
      projectRoot === root ? current : null,
  });
  const imported = await importService.importCandidates({
    projectRoot: root,
    project: current.project,
    baseRevision: current.revision,
    candidates: [
      { sourcePath: jpgSource, declaredMimeType: 'image/jpeg' },
      { sourcePath: pngSource, declaredMimeType: 'image/png' },
    ],
  });
  assert(
    imported.results.every((result) => result.status === 'imported' && result.asset),
    `PNG/JPG import failed for ${label}: ${JSON.stringify(imported.results)}`,
  );
  current = { project: imported.project, revision: imported.savedRevision };
  const backgroundAsset = imported.results[0].asset;
  const contentAsset = imported.results[1].asset;
  const backgroundLayer = {
    id: randomUUID(),
    name: 'High resolution JPG background',
    source: { kind: 'asset', assetId: backgroundAsset.id },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 0,
  };
  const contentLayer = {
    id: randomUUID(),
    name: 'High resolution PNG content',
    source: { kind: 'asset', assetId: contentAsset.id },
    anchor: 'center',
    x: 1_200,
    y: 600,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 1,
  };
  const project = ProjectSchema.parse({
    ...current.project,
    shots: [{
      id: randomUUID(),
      name: 'High resolution image canvas',
      durationMs: 1_000,
      defaultSubtitleStyleId: current.project.subtitleStyles[0].id,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      backgroundLayerId: backgroundLayer.id,
      layers: [backgroundLayer, contentLayer],
    }],
    updatedAt: new Date().toISOString(),
  });
  await projectService.save(root, project);

  const backgroundPath = path.resolve(root, backgroundAsset.relativePath);
  const contentPath = path.resolve(root, contentAsset.relativePath);
  const backgroundCachePath = cachePathFor(root, backgroundAsset.sha256);
  const contentCachePath = cachePathFor(root, contentAsset.sha256);
  assert(await fileExists(backgroundPath), `Imported JPG is missing: ${backgroundPath}`);
  assert(await fileExists(contentPath), `Imported PNG is missing: ${contentPath}`);
  assert(!(await fileExists(backgroundCachePath)), `Unexpected JPG cache before read: ${backgroundCachePath}`);
  assert(!(await fileExists(contentCachePath)), `Unexpected PNG cache before read: ${contentCachePath}`);
  return {
    label,
    root,
    project,
    backgroundAsset,
    contentAsset,
    backgroundPath,
    contentPath,
    backgroundCachePath,
    contentCachePath,
    projectFilePath: path.join(root, 'project.json'),
    sourcePaths: [pngSource, jpgSource],
    importResults: imported.results,
    cacheBeforeOpen: { background: false, content: false },
  };
}

async function rendererPrivateBytes(window) {
  try {
    const memory = await window.webContents.getProcessMemoryInfo();
    if (Number.isFinite(memory.private) && memory.private > 0) {
      return memory.private * 1024;
    }
  } catch {
    // Fall through to the renderer's precise JS heap counter.
  }
  try {
    const memory = await window.webContents.executeJavaScript(
      `(() => {
        const value = window.performance.memory;
        return value ? value.usedJSHeapSize : null;
      })()`,
    );
    return typeof memory === 'number' && Number.isFinite(memory)
      ? memory
      : null;
  } catch {
    return null;
  }
}

async function waitForCanvasPair(window, fixture) {
  await waitForRenderedAssets(window, [
    fixture.backgroundAsset.id,
    fixture.contentAsset.id,
  ]);
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const sizes = JSON.parse(stage?.dataset.renderedAssetIntrinsicSizes || '[]');
      return sizes.length === 2 && sizes.every((entry) => entry.width === ${imageWidth} && entry.height === ${imageHeight});
    })()`,
    'Canvas did not retain the imported high-resolution intrinsic dimensions.',
  );
}

async function run(window) {
  progress('creating temporary projects');
  const temporaryParent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-issue99-'),
  );
  temporaryDirectories.push(temporaryParent);
  const projectA = await createImportedProject(temporaryParent, 'a');
  const projectB = await createImportedProject(temporaryParent, 'b');
  progress('temporary PNG/JPG projects prepared');

  window.setSize(1600, 1000);
  await openProject(window, projectA.root);
  progress('project A opened through real Electron');
  await waitForCanvasPair(window, projectA);

  const canvasApiA = await readCanvasImageSummary(
    window,
    projectA,
    projectA.contentAsset,
  );
  assert(
    canvasApiA.ok &&
      canvasApiA.status === 'ready' &&
      canvasApiA.mimeType === 'image/png' &&
      canvasApiA.width === imageWidth &&
      canvasApiA.height === imageHeight &&
      canvasApiA.isTypedArray,
    `Canvas API did not return original PNG bytes: ${JSON.stringify(canvasApiA)}`,
  );
  const contentBytes = (await stat(projectA.contentPath)).size;
  assert(canvasApiA.byteLength === contentBytes, 'Canvas API byte length differs from the imported source.');
  const initialA = await snapshot(window, projectA);
  assert(initialA.renderSource === 'project-assets-original', 'Canvas did not advertise the original asset source.');
  assert(initialA.transformMode === 'fit', `Canvas did not start in fit mode: ${initialA.transformMode}`);
  assert(initialA.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Initial canvas intrinsic dimensions were not high resolution.');

  await activateAssetLibrary(window);
  await waitForDom(
    window,
    `document.querySelectorAll('[data-testid="asset-library"] [data-asset-id]').length === 2 && [...document.querySelectorAll('.asset-card-preview img')].length === 2 && [...document.querySelectorAll('.asset-card-preview img')].every((image) => image.getAttribute('src')?.startsWith('data:image/png;base64,'))`,
    'Imported PNG/JPG thumbnail cards did not render.',
  );
  const libraryA = await snapshot(window, projectA);
  const cacheAfterLibraryA = {
    background: await pngReceipt(projectA.backgroundCachePath),
    content: await pngReceipt(projectA.contentCachePath),
  };
  const thumbnailSizes = [
    cacheAfterLibraryA.background,
    cacheAfterLibraryA.content,
  ];
  assert(
    thumbnailSizes.every((size) => Math.max(size.width, size.height) > 0 && Math.max(size.width, size.height) <= 256),
    `Asset cards are no longer bounded thumbnails: ${JSON.stringify(thumbnailSizes)}`,
  );
  assert(
    Object.values(libraryA.cards).every((card) => card.srcPrefix === 'data:image/png;base64,'),
    'Asset cards did not continue to use PNG thumbnail data URLs.',
  );
  assert(cacheAfterLibraryA.background.validPng && cacheAfterLibraryA.content.validPng, 'Thumbnail cache was not generated for the asset library.');
  const afterLibraryA = await snapshot(window, projectA);
  assert(afterLibraryA.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Opening the asset library replaced canvas sources with thumbnails.');
  progress('thumbnail cards and original canvas sources separated');

  await clickElement(window, '[data-testid="canvas-mode-actual"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="canvas-transform-contract"]')?.dataset.transformMode === 'actual'`,
    'Canvas did not enter actual-size mode before the ordinary-layer interaction.',
  );
  const actualSizeA = await snapshot(window, projectA);
  assert(actualSizeA.transformMode === 'actual', 'Actual-size mode was not recorded in the canvas contract.');
  await dispatchAssetDrop(window, projectA.contentAsset.id, { x: 1_200, y: 600 });
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').length === 3`,
    'Dragging the imported PNG did not create an ordinary image layer.',
  );
  await waitForCanvasPair(window, projectA);
  const createdSnapshot = await snapshot(window, projectA);
  const createdLayer = createdSnapshot.layers.find(
    (layer) => layer.source?.assetId === projectA.contentAsset.id && layer.zIndex === 2,
  );
  assert(createdLayer, 'The dropped high-resolution PNG layer was not present in project data.');
  assert(createdSnapshot.selectedLayerId === createdLayer.id, 'The dropped PNG layer was not selected.');
  assert(createdSnapshot.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Ordinary layer rendering fell back to a thumbnail.');

  await selectLayer(window, createdLayer.id, { x: 1_200, y: 600 });
  const transform = {
    layerId: createdLayer.id,
    x: 800,
    y: 450,
    scale: 1.25,
    rotationDeg: 90,
    opacity: 0.6,
  };
  await applyTransform(window, transform);
  const transformed = await snapshot(window, projectA);
  assert(transformed.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Transforming the layer changed its source resolution.');

  await clickElement(window, '[data-testid="layer-transform-panel"] form button[type="button"]');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(createdLayer.id)})?.flipX === true`,
    'Horizontal flip did not commit for the ordinary image layer.',
  );
  const flipped = await snapshot(window, projectA);
  assert(flipped.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Flip changed the canvas resource.');

  await clickElement(window, '[data-testid="history-controls"] button:first-child');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.renderedAssetIntrinsicSizes || '[]').every((entry) => entry.width === ${imageWidth} && entry.height === ${imageHeight})`,
    'Undo did not preserve the high-resolution canvas source.',
  );
  const undone = await snapshot(window, projectA);
  await clickElement(window, '[data-testid="history-controls"] button:nth-child(2)');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(createdLayer.id)})?.flipX === true`,
    'Redo did not restore the ordinary image transform.',
  );
  const redone = await snapshot(window, projectA);

  await clickElement(window, '[data-testid="set-current-shot-background"]');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      return stage?.dataset.backgroundLayerId === ${JSON.stringify(createdLayer.id)} && stage?.dataset.backgroundReady === 'true' && !document.querySelector('[data-testid="canvas-background-warning"]');
    })()`,
    'Formal background cover binding did not retain the original image source.',
  );
  const formalBackground = await snapshot(window, projectA);
  assert(formalBackground.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Formal background rendering fell back to a thumbnail.');
  progress('ordinary, transformed, undo/redo, and formal background paths checked');

  const beforeSaveHash = await fileSha256(projectA.projectFilePath);
  await clickElement(window, '.editor-save-button');
  await waitForDom(
    window,
    `Boolean(document.querySelector('.editor-save-button')?.disabled) && Boolean(document.querySelector('.clean-state'))`,
    'Project did not save cleanly.',
  );
  const afterSaveHash = await fileSha256(projectA.projectFilePath);
  assert(beforeSaveHash !== afterSaveHash, 'The image/background edit was not saved.');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, 'canvas-a.png'),
    (await window.webContents.capturePage()).toPNG(),
  );

  await clickElement(window, '[data-testid="close-project-open"]');
  await waitForDom(window, `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`, 'Close confirmation did not render.');
  await clickElement(window, '[data-testid="close-confirm-discard"]');
  await waitForDom(window, `Boolean(document.querySelector('[data-testid="start-screen"]'))`, 'Project did not close to the start screen.');
  await openProject(window, projectA.root);
  await waitForCanvasPair(window, projectA);
  const reopenedA = await snapshot(window, projectA);
  assert(reopenedA.backgroundLayerId === createdLayer.id && reopenedA.backgroundReady, 'Save/reopen did not restore the high-resolution formal background.');
  assert(reopenedA.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Save/reopen caused a source resolution regression.');
  progress('save, close, reopen checked');

  await openProject(window, projectB.root);
  await waitForCanvasPair(window, projectB);
  const switchedB = await snapshot(window, projectB);
  assert(switchedB.activeProjectRoot === projectB.root, 'Project B did not become active.');
  assert(!switchedB.renderedAssetIds.some((id) => [projectA.backgroundAsset.id, projectA.contentAsset.id].includes(id)), 'Project switch reused project A asset ids.');
  assert(switchedB.intrinsicSizes.every((entry) => entry.width === imageWidth && entry.height === imageHeight), 'Project B did not load its original image dimensions.');

  const memorySamples = [await rendererPrivateBytes(window)];
  for (let index = 0; index < 3; index += 1) {
    await openProject(window, projectA.root);
    await waitForCanvasPair(window, projectA);
    await openProject(window, projectB.root);
    await waitForCanvasPair(window, projectB);
    memorySamples.push(await rendererPrivateBytes(window));
  }
  const numericMemorySamples = memorySamples.filter((value) => typeof value === 'number');
  const memoryGrowth = numericMemorySamples.length > 1
    ? numericMemorySamples[numericMemorySamples.length - 1] - numericMemorySamples[0]
    : null;
  assert(memoryGrowth === null || memoryGrowth < 256 * 1024 * 1024, `Repeated project switching grew renderer memory unexpectedly: ${memorySamples}`);
  progress('project A/B switching and resource lifecycle checked');

  await writeFile(projectB.contentPath, Buffer.from('corrupt source bytes', 'utf8'));
  const corruptProjectHash = await fileSha256(projectB.projectFilePath);
  await openProject(window, projectA.root);
  await waitForCanvasPair(window, projectA);
  await openProject(window, projectB.root);
  await waitForDom(window, `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.backgroundReady === 'true'`, 'Corrupt ordinary source removed the valid background.');
  const corruptApi = await readCanvasImageSummary(window, projectB, projectB.contentAsset);
  const corruptSnapshot = await snapshot(window, projectB);
  const corruptCode = corruptApi.ok ? null : corruptApi.error?.code;
  assert(corruptCode === 'ASSET_CANVAS_IMAGE_READ_FAILED' || corruptCode === 'ASSET_CANVAS_IMAGE_HASH_MISMATCH', `Corrupt source did not return a structured canvas error: ${JSON.stringify(corruptApi)}`);
  assert(!corruptSnapshot.dirty && !corruptSnapshot.stageError, 'Corrupt source changed project state or crashed the renderer.');
  assert((await fileSha256(projectB.projectFilePath)) === corruptProjectHash, 'Corrupt source handling modified project.json.');

  await rm(projectA.contentPath, { force: true });
  const missingProjectHash = await fileSha256(projectA.projectFilePath);
  await openProject(window, projectA.root);
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      return stage?.dataset.backgroundReady === 'false' && Boolean(document.querySelector('[data-testid="canvas-background-warning"]'));
    })()`,
    'Missing formal background did not produce the clear canvas warning.',
  );
  const missingApi = await readCanvasImageSummary(window, projectA, projectA.contentAsset);
  const missingSnapshot = await snapshot(window, projectA);
  assert(!missingApi.ok && missingApi.error?.code === 'ASSET_CANVAS_IMAGE_READ_FAILED', `Missing source did not return a structured canvas error: ${JSON.stringify(missingApi)}`);
  assert(!missingSnapshot.dirty && !missingSnapshot.stageError, 'Missing source changed project state or crashed the renderer.');
  assert((await fileSha256(projectA.projectFilePath)) === missingProjectHash, 'Missing source handling modified project.json.');
  await writeFile(
    path.join(evidenceDirectory, 'canvas-missing-background.png'),
    (await window.webContents.capturePage()).toPNG(),
  );

  const result = {
    issue: 99,
    status: 'PASS',
    electron: process.versions.electron,
    node: process.versions.node,
    projectRoots: {
      a: projectA.root,
      b: projectB.root,
      acceptancePathsTouched: false,
      temporaryParent,
    },
    source: {
      width: imageWidth,
      height: imageHeight,
      pngPath: projectA.contentPath,
      jpgPath: projectA.backgroundPath,
      pngBytes: contentBytes,
      canvasApi: canvasApiA,
      sourceAndCanvasDimensionsMatch: true,
      thumbnailMaxEdge: 256,
    },
    canvas: {
      initialA,
      actualSizeA,
      afterLibraryA,
      created: createdSnapshot,
      transformed,
      flipped,
      undone,
      redone,
      formalBackground,
      reopenedA,
      switchedB,
    },
    thumbnails: {
      cacheBeforeOpen: {
        a: projectA.cacheBeforeOpen,
        b: projectB.cacheBeforeOpen,
      },
      cacheAfterAssetLibraryA: cacheAfterLibraryA,
      cardsRemain256Bounded: true,
    },
    lifecycle: {
      loadPolicy: 'active-shot-only, deduplicated in-flight reads',
      cleanupPolicy: 'renderer revokes object URLs and clears Image.src on shot/project/component cleanup',
      memorySamples,
      memoryGrowth,
      repeatedProjectSwitches: 3,
    },
    errors: {
      corruptSource: { response: corruptApi, snapshot: corruptSnapshot },
      missingFormalBackground: { response: missingApi, snapshot: missingSnapshot },
    },
    diagnosis: {
      firstFailureBeforeFix: 'CanvasStage called readThumbnail; ThumbnailService generated v1-max256 PNG data for the formal canvas, so a 1536x864 source was decoded from a 256px-or-smaller resource before Konva scaling.',
      ordinaryAndFormalBackgroundSharedThumbnailBeforeFix: true,
      originMainHadSameBehavior: true,
      pixelRatioImpact: 'Konva.pixelRatio=1 was a secondary Windows high-DPI backing-store limitation; editor now clamps devicePixelRatio to 1..2 while hidden export keeps its fixed 1x contract.',
      minimalFixBoundary: [
        'src/shared/asset-canvas-image-api.ts',
        'src/main/services/AssetCanvasImageService.ts',
        'src/main/ipc/register-asset-library-ipc-handlers.ts',
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/renderer/global.d.ts',
        'src/renderer/features/canvas/CanvasStage.tsx',
      ],
      evidence: [
        'docs/evidence/issue-99/canvas-a.png',
        'docs/evidence/issue-99/canvas-missing-background.png',
      ],
    },
  };
  await writeFile(
    path.join(evidenceDirectory, 'results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  progress('results written');
  return result;
}

async function main() {
  let editorWindow = null;
  try {
    await app.whenReady();
    editorWindow = await waitForEditorWindow();
    progress('editor window ready');
    const result = await run(editorWindow);
    console.log(JSON.stringify(result, null, 2));
    editorWindow = null;
    app.exit(0);
  } catch (error) {
    const failure = {
      issue: 99,
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    await mkdir(evidenceDirectory, { recursive: true }).catch(() => undefined);
    await writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(failure, null, 2)}\n`,
      'utf8',
    ).catch(() => undefined);
    console.error(JSON.stringify(failure, null, 2));
    if (editorWindow && !editorWindow.isDestroyed()) editorWindow.destroy();
    app.exit(1);
  } finally {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}

progress('starting verifier main');
void main();
