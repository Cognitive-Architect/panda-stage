const { createHash, randomUUID } = require('node:crypto');
const {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} = require('node:fs/promises');
const { appendFileSync, unlinkSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/issue-95',
);
const assetFixturesDirectory = path.join(
  repositoryRoot,
  'tests/fixtures/assets',
);
const tempDirectories = [];
const assetDragMime = 'application/x-panda-stage-asset';
const progressLogPath = path.join(
  os.tmpdir(),
  'panda-stage-issue95-progress.log',
);
try {
  unlinkSync(progressLogPath);
} catch {
  // No prior progress log is expected on the first run.
}

function progress(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(progressLogPath, line, 'utf8');
  console.log(line.trim());
}

progress('module evaluated');

// Use the repository's verified sidecars for this real Electron run. The
// normal development contract still allows explicit environment overrides;
// this keeps the acceptance command self-contained on Windows.
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
progress('domain loaded');
const { AssetImportService } = require(
  '../dist-electron/main/services/AssetImportService.js',
);
progress('asset import service loaded');
const { CacheService } = require(
  '../dist-electron/main/services/CacheService.js',
);
progress('cache service loaded');
const { ProjectService } = require(
  '../dist-electron/main/services/ProjectService.js',
);
progress('project service loaded');

// Load the real application entry point so the test exercises the production
// Main Process IPC registrations and renderer/preload boundary.
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
        // The DOM can still be between renderer commits; keep polling.
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
  return { exists: true, validPng: isPng(bytes), bytes: bytes.length };
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
        // The hidden export window may still be loading; keep polling the
        // main editor window.
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
    const assetIds = ${JSON.stringify(assetIds)};
    const cardInfo = Object.fromEntries(assetIds.map((assetId) => {
      const card = document.querySelector('[data-asset-id="' + assetId + '"]');
      return [assetId, {
        src: card?.querySelector('.asset-card-preview img')?.getAttribute('src') ?? null,
        placeholder: card?.querySelector('[data-thumbnail-status]')?.getAttribute('data-thumbnail-status') ?? null,
      }];
    }));
    return {
      activeProjectRoot: document.querySelector('[data-testid="active-project-path"] code')?.textContent ?? null,
      layers: stage ? JSON.parse(stage.dataset.layerJson || '[]') : [],
      renderedAssetIds: stage ? JSON.parse(stage.dataset.renderedAssetIds || '[]') : [],
      backgroundLayerId: stage?.dataset.backgroundLayerId ?? '',
      backgroundReady: stage?.dataset.backgroundReady === 'true',
      backgroundWarning: Boolean(document.querySelector('[data-testid="canvas-background-warning"]')),
      selectedLayerId: stage?.dataset.selectedLayerId ?? '',
      projectRevision: Number(stage?.dataset.projectRevision ?? -1),
      dirty: Boolean(saveButton && !saveButton.disabled),
      undoCount: Number(history?.dataset.undoCount ?? -1),
      redoCount: Number(history?.dataset.redoCount ?? -1),
      cardInfo,
      stageError: document.querySelector('[data-testid="stage-error"]')?.textContent ?? null,
    };
  })()`);
}

async function readThumbnailFromRenderer(window, fixture, asset) {
  return window.webContents.executeJavaScript(`window.pandaStage.assets.readThumbnail(${JSON.stringify({
    projectRoot: fixture.root,
    assetId: asset.id,
    sha256: asset.sha256,
  })})`);
}

async function waitForRenderedAssets(window, fixture, expectedIds) {
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
    'Ordinary image transform did not commit to the project data.',
  );
}

async function createImportedProject(tempRoot, label) {
  const root = path.join(tempRoot, `issue95-${label}.pandastage`);
  const sourceDirectory = path.join(tempRoot, `sources-${label}`);
  await mkdir(sourceDirectory, { recursive: true });
  const backgroundSource = path.join(sourceDirectory, 'issue95-background.jpg');
  const contentSource = path.join(sourceDirectory, 'issue95-content.png');
  await copyFile(
    path.join(assetFixturesDirectory, '熊猫 照片.jpg'),
    backgroundSource,
  );
  await copyFile(
    path.join(assetFixturesDirectory, '另一张 图片.png'),
    contentSource,
  );

  const projectService = new ProjectService();
  const created = await projectService.create(root, {
    name: `Issue 95 ${label}`,
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
      { sourcePath: backgroundSource, declaredMimeType: 'image/jpeg' },
      { sourcePath: contentSource, declaredMimeType: 'image/png' },
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
    name: 'Imported JPG background',
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
  const project = ProjectSchema.parse({
    ...current.project,
    shots: [{
      id: randomUUID(),
      name: 'Imported image canvas',
      durationMs: 1000,
      defaultSubtitleStyleId: current.project.subtitleStyles[0].id,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      backgroundLayerId: backgroundLayer.id,
      layers: [backgroundLayer],
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
    backgroundLayer,
    backgroundPath,
    contentPath,
    backgroundCachePath,
    contentCachePath,
    projectFilePath: path.join(root, 'project.json'),
    sourcePaths: [backgroundSource, contentSource],
    importResults: imported.results,
    cacheBeforeOpen: {
      background: false,
      content: false,
    },
  };
}

async function run(window) {
  progress('creating temporary projects');
  const temporaryParent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-stage-issue95-'),
  );
  tempDirectories.push(temporaryParent);
  const projectA = await createImportedProject(temporaryParent, 'a');
  progress('project A prepared');
  const projectB = await createImportedProject(temporaryParent, 'b');
  progress('project B prepared');
  window.setSize(1600, 1000);

  progress('opening project A');
  await openProject(window, projectA.root);
  progress('project A opened');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const ids = JSON.parse(stage?.dataset.renderedAssetIds || '[]');
      return ids.length === 1 && ids.includes(${JSON.stringify(projectA.backgroundAsset.id)}) && stage?.dataset.backgroundReady === 'true';
    })()`,
    'Initial JPG background did not load through the real Electron path.',
  );
  await activateAssetLibrary(window);
  progress('asset library A activated');
  await waitForDom(
    window,
    `document.querySelectorAll('[data-testid="asset-library"] [data-asset-id]').length === 2 && document.querySelectorAll('.asset-card-preview img').length === 2`,
    'Imported PNG/JPG thumbnails did not become readable in the asset library.',
  );
  const assetLibraryA = await snapshot(window, projectA);
  const apiA = await readThumbnailFromRenderer(
    window,
    projectA,
    projectA.contentAsset,
  );
  assert(apiA.ok && apiA.status === 'ready', `PNG thumbnail IPC was not ready: ${JSON.stringify(apiA)}`);
  assert(apiA.dataUrl.startsWith('data:image/png;base64,'), 'Renderer thumbnail source is not a PNG data URL.');
  const postLibraryCacheA = {
    background: await pngReceipt(projectA.backgroundCachePath),
    content: await pngReceipt(projectA.contentCachePath),
  };
  assert(postLibraryCacheA.background.validPng && postLibraryCacheA.content.validPng, 'Real FFmpeg thumbnail cache was not valid PNG.');
  progress('asset thumbnails A ready');

  await clickElement(window, '[data-testid="canvas-mode-actual"]');
  await dispatchAssetDrop(window, projectA.contentAsset.id, { x: 1200, y: 600 });
  progress('ordinary layer dropped');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').length === 2`,
    'Dragging the imported image did not create an ordinary canvas layer.',
  );
  await waitForRenderedAssets(window, projectA, [
    projectA.backgroundAsset.id,
    projectA.contentAsset.id,
  ]);
  const createdSnapshot = await snapshot(window, projectA);
  const createdLayer = createdSnapshot.layers.find(
    (layer) => layer.source?.assetId === projectA.contentAsset.id,
  );
  assert(createdLayer, 'The dropped PNG layer was not present in project data.');
  assert(createdSnapshot.selectedLayerId === createdLayer.id, 'The dropped PNG layer was not selected.');
  assert(createdSnapshot.backgroundReady && !createdSnapshot.backgroundWarning, 'JPG background disappeared when the PNG layer was dropped.');

  await selectLayer(window, createdLayer.id, { x: 1200, y: 600 });
  const transform = {
    layerId: createdLayer.id,
    x: 800,
    y: 450,
    scale: 1.25,
    rotationDeg: 90,
    opacity: 0.6,
  };
  await applyTransform(window, transform);
  progress('ordinary transform committed');
  const transformed = await snapshot(window, projectA);
  assert(transformed.renderedAssetIds.includes(projectA.contentAsset.id), 'Canvas image disappeared after transform.');
  await clickElement(window, '[data-testid="history-controls"] button:first-child');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(createdLayer.id)});
      return layer && layer.x === ${createdLayer.x} && layer.y === ${createdLayer.y} && layer.rotationDeg === ${createdLayer.rotationDeg} && JSON.parse(stage.dataset.renderedAssetIds || '[]').includes(${JSON.stringify(projectA.contentAsset.id)});
    })()`,
    'Undo did not keep the ordinary image data and canvas rendering synchronized.',
  );
  const undone = await snapshot(window, projectA);
  await clickElement(window, '[data-testid="history-controls"] button:nth-child(2)');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(createdLayer.id)})?.rotationDeg === ${transform.rotationDeg}`,
    'Redo did not restore the ordinary image transform.',
  );
  const redone = await snapshot(window, projectA);
  await clickElement(window, '[data-testid="layer-transform-panel"] form button[type="button"]');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson || '[]').find((item) => item.id === ${JSON.stringify(createdLayer.id)})?.flipX === true`,
    'Horizontal flip did not commit for the ordinary image layer.',
  );
  const flipped = await snapshot(window, projectA);

  await clickElement(window, '[data-testid="set-current-shot-background"]');
  progress('formal background bound');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      return stage?.dataset.backgroundLayerId === ${JSON.stringify(createdLayer.id)} && stage?.dataset.backgroundReady === 'true' && !document.querySelector('[data-testid="canvas-background-warning"]');
    })()`,
    'Formal background binding did not keep the imported PNG visible.',
  );
  const formalBackground = await snapshot(window, projectA);
  assert(formalBackground.renderedAssetIds.includes(projectA.backgroundAsset.id) && formalBackground.renderedAssetIds.includes(projectA.contentAsset.id), 'Formal background binding dropped one of the image resources.');

  const beforeSaveHash = await fileSha256(projectA.projectFilePath);
  await clickElement(window, '.editor-save-button');
  await waitForDom(
    window,
    `Boolean(document.querySelector('.editor-save-button')?.disabled) && Boolean(document.querySelector('.clean-state'))`,
    'Project did not save cleanly after the image/background edits.',
  );
  const afterSaveHash = await fileSha256(projectA.projectFilePath);
  assert(beforeSaveHash !== afterSaveHash, 'The image/background edit was not written to project.json.');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, 'canvas-a.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  progress('project A saved and captured');

  await clickElement(window, '[data-testid="close-project-open"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`,
    'Clean project close confirmation did not render.',
  );
  await clickElement(window, '[data-testid="close-confirm-discard"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="start-screen"]'))`,
    'Saved project did not close to the start screen.',
  );
  await openProject(window, projectA.root);
  progress('project A reopened');
  await waitForRenderedAssets(window, projectA, [
    projectA.backgroundAsset.id,
    projectA.contentAsset.id,
  ]);
  const reopenedA = await snapshot(window, projectA);
  assert(reopenedA.backgroundLayerId === createdLayer.id && reopenedA.backgroundReady && !reopenedA.backgroundWarning, 'Save/reopen did not restore the formal image background.');
  assert(reopenedA.layers.some((layer) => layer.id === createdLayer.id && layer.flipX === true && layer.rotationDeg === transform.rotationDeg), 'Save/reopen lost the ordinary image transform contract.');

  await openProject(window, projectB.root);
  progress('project B opened');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const rendered = JSON.parse(stage?.dataset.renderedAssetIds || '[]');
      return rendered.length === 1 && rendered[0] === ${JSON.stringify(projectB.backgroundAsset.id)} && stage?.dataset.backgroundReady === 'true';
    })()`,
    'Project switch did not render only project B resources.',
  );
  await activateAssetLibrary(window);
  await waitForDom(
    window,
    `document.querySelectorAll('.asset-card-preview img').length === 2`,
    'Project B thumbnails did not load.',
  );
  const switchedB = await snapshot(window, projectB);
  progress('project switch checked');
  assert(!switchedB.renderedAssetIds.some((assetId) => [projectA.backgroundAsset.id, projectA.contentAsset.id].includes(assetId)), 'Project switch reused a project A resource URL.');
  await writeFile(projectB.contentPath, Buffer.from('corrupt image bytes', 'utf8'));
  await rm(projectB.contentCachePath, { force: true });
  const bHashBeforeError = await fileSha256(projectB.projectFilePath);
  await clickElement(window, '[data-testid="close-project-open"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`,
    'Project B close confirmation did not render before corrupt-source reopen.',
  );
  await clickElement(window, '[data-testid="close-confirm-discard"]');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="start-screen"]'))`,
    'Project B did not close before corrupt-source reopen.',
  );
  await openProject(window, projectB.root);
  progress('project B corrupt-source check opened');
  await activateAssetLibrary(window);
  await waitForDom(
    window,
    `document.querySelector('[data-asset-id="${projectB.contentAsset.id}"] [data-thumbnail-status]')?.getAttribute('data-thumbnail-status') === 'missing'`,
    'Corrupt source did not produce a clear missing thumbnail state.',
  );
  const corruptApi = await readThumbnailFromRenderer(window, projectB, projectB.contentAsset);
  const corruptSnapshot = await snapshot(window, projectB);
  assert(!corruptApi.ok && corruptApi.error?.code === 'ASSET_THUMBNAIL_READ_FAILED', `Corrupt source did not return a structured read error: ${JSON.stringify(corruptApi)}`);
  assert(!corruptSnapshot.dirty && !corruptSnapshot.stageError, 'Corrupt source changed project state or crashed the renderer.');
  assert((await fileSha256(projectB.projectFilePath)) === bHashBeforeError, 'Corrupt source handling modified project.json.');

  await rm(projectA.contentPath, { force: true });
  await rm(projectA.contentCachePath, { force: true });
  const aHashBeforeError = await fileSha256(projectA.projectFilePath);
  await openProject(window, projectA.root);
  progress('project A missing-source check opened');
  await waitForDom(
    window,
    `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      return stage?.dataset.backgroundReady === 'false' && Boolean(document.querySelector('[data-testid="canvas-background-warning"]'));
    })()`,
    'Missing formal background did not produce the clear canvas warning.',
  );
  const missingApi = await readThumbnailFromRenderer(window, projectA, projectA.contentAsset);
  const missingSnapshot = await snapshot(window, projectA);
  assert(!missingApi.ok && missingApi.error?.code === 'ASSET_THUMBNAIL_READ_FAILED', `Missing source did not return a structured read error: ${JSON.stringify(missingApi)}`);
  assert(!missingSnapshot.dirty && !missingSnapshot.stageError, 'Missing source changed project state or crashed the renderer.');
  assert((await fileSha256(projectA.projectFilePath)) === aHashBeforeError, 'Missing source handling modified project.json.');
  await writeFile(
    path.join(evidenceDirectory, 'canvas-missing-background.png'),
    (await window.webContents.capturePage()).toPNG(),
  );

  const result = {
    issue: 95,
    status: 'PASS',
    electron: process.versions.electron,
    node: process.versions.node,
    mediaTools: {
      ffmpegPath: process.env.PANDA_STAGE_FFMPEG_PATH,
      ffprobePath: process.env.PANDA_STAGE_FFPROBE_PATH,
    },
    projectRoots: {
      a: projectA.root,
      b: projectB.root,
      acceptancePathsTouched: false,
      temporaryParent,
    },
    import: {
      a: projectA.importResults,
      b: projectB.importResults,
      pngAndJpgAssetsExist: true,
      cacheBeforeOpen: {
        a: projectA.cacheBeforeOpen,
        b: projectB.cacheBeforeOpen,
      },
      cacheAfterAssetLibrary: postLibraryCacheA,
    },
    resources: {
      ordinaryImageLayer: {
        createdLayerId: createdLayer.id,
        assetLibrary: assetLibraryA,
        created: createdSnapshot,
        transformed,
        undone,
        redone,
        flipped,
      },
      formalBackground,
      reopenedA,
      switchedB,
      thumbnailApi: {
        projectRoot: projectA.root,
        assetId: projectA.contentAsset.id,
        response: {
          ok: apiA.ok,
          status: apiA.status,
          dataUrlPrefix: apiA.dataUrl.slice(0, 22),
        },
        sourcePath: projectA.contentPath,
        cachePath: projectA.contentCachePath,
        sourceInsideProjectAssets: projectA.contentPath.toLowerCase().startsWith(`${path.resolve(projectA.root, 'assets')}${path.sep}`.toLowerCase()),
        cacheInsideProject: projectA.contentCachePath.toLowerCase().startsWith(path.resolve(projectA.root).toLowerCase()),
        rendererAndThumbnailUseSameProjectRoot: true,
      },
      corruptSource: {
        response: corruptApi,
        snapshot: corruptSnapshot,
      },
      missingFormalBackground: {
        response: missingApi,
        snapshot: missingSnapshot,
      },
    },
    diagnosis: {
      firstFailureBeforeFix: 'AssetThumbnailService.read returned status=missing when cache/asset-thumbnails/v1-max256-<sha256>.png was absent; AssetLibrary and CanvasStage then had no data URL to load.',
      ordinaryAndFormalBackgroundShareReadThumbnail: true,
      originMainHadSameAssetPathBeforeFix: true,
      minimalFixBoundary: [
        'src/main/services/AssetThumbnailService.ts',
        'src/main/index.ts',
      ],
      evidence: [
        'docs/evidence/issue-95/canvas-a.png',
        'docs/evidence/issue-95/canvas-missing-background.png',
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
    progress('waiting for Electron ready');
    await app.whenReady();
    progress('waiting for editor window');
    editorWindow = await waitForEditorWindow();
    progress('editor window ready');
    const result = await run(editorWindow);
    console.log(JSON.stringify(result, null, 2));
    editorWindow = null;
    app.exit(0);
  } catch (error) {
    const failure = {
      issue: 95,
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
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
}

progress('starting verifier main');
void main();
