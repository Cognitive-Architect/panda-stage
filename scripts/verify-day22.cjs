const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/day-22',
);
const projectRoot = 'D:\\Projects\\Day 22 placement.pandastage';
const stickerAssetId = 'd2200000-0000-4000-8000-000000000010';
const assetDragMime = 'application/x-panda-stage-asset';

app.on('window-all-closed', () => {});

function waitFor(expression, failureMessage) {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        if (${expression}) return resolve();
        if (Date.now() >= deadline) {
          return reject(new Error(${JSON.stringify(failureMessage)}));
        }
        setTimeout(poll, 25);
      };
      poll();
    })
  `;
}

async function selectResourceActivity(window, activity) {
  const selector =
    `[data-testid="resource-activity-tabs"] [data-activity="${activity}"]`;
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector(${JSON.stringify(selector)})`,
      `Resource activity did not render: ${activity}`,
    ),
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="resource-activity-panel"]')` +
        `?.dataset.activeActivity === ${JSON.stringify(activity)}`,
      `Resource activity did not activate: ${activity}`,
    ),
  );
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Input not found: ${selector}');
    }
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function openProject(window) {
  await window.webContents.executeJavaScript(`(() => {
    if (document.querySelector('[data-editor-page="editor"]')) {
      document.querySelector('[data-testid="open-project-center"]').click();
    }
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-editor-page="project-center"]')`,
      'Project Center did not open for a project switch.',
    ),
  );
  await setInput(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row input',
    projectRoot,
  );
  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('.project-canvas-heading > span')` +
        `?.textContent?.trim() === 'Opening'`,
      'Day 22 project did not open.',
    ),
  );
}

async function scrollTargetIntoActiveViewport(
  window,
  selector,
  topOffset,
) {
  return window.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) {
      throw new Error('Scroll target was not found: ${selector}');
    }
    const canvasViewport = document.querySelector(
      '[data-testid="canvas-workspace-scroll"]'
    );
    if (canvasViewport instanceof HTMLElement) {
      const beforeTarget = target.getBoundingClientRect();
      const beforeViewport = canvasViewport.getBoundingClientRect();
      canvasViewport.scrollTop +=
        beforeTarget.top - beforeViewport.top - ${topOffset};
    } else {
      window.scrollTo(
        0,
        target.getBoundingClientRect().top + window.scrollY - ${topOffset}
      );
    }
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const targetBounds = target.getBoundingClientRect();
    const viewportBounds =
      canvasViewport instanceof HTMLElement
        ? canvasViewport.getBoundingClientRect()
        : {
            top: 0,
            right: innerWidth,
            bottom: innerHeight,
            left: 0
          };
    const visible =
      targetBounds.bottom > viewportBounds.top &&
      targetBounds.top < viewportBounds.bottom &&
      targetBounds.right > viewportBounds.left &&
      targetBounds.left < viewportBounds.right;
    if (!visible) {
      throw new Error(
        'Scroll target did not enter the active viewport: ${selector}'
      );
    }
    return {
      mode:
        canvasViewport instanceof HTMLElement
          ? 'canvas-workspace'
          : 'window',
      targetTop: targetBounds.top,
      viewportTop: viewportBounds.top
    };
  })()`);
}

async function scrollCanvasIntoView(window) {
  await scrollTargetIntoActiveViewport(window, '.project-canvas', 8);
}

async function captureElement(window, selector) {
  const rect = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const bounds = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(bounds.left)),
      y: Math.max(0, Math.floor(bounds.top)),
      width: Math.max(1, Math.ceil(
        Math.min(innerWidth, bounds.right) - Math.max(0, bounds.left)
      )),
      height: Math.max(1, Math.ceil(
        Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top)
      ))
    };
  })()`);
  return window.webContents.capturePage(rect);
}

async function selectCategory(window, index, assetId) {
  await selectResourceActivity(window, 'assets');
  await window.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.asset-category-tabs button')[${index}].click();
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-asset-id="${assetId}"]')`,
      `Asset card did not appear: ${assetId}`,
    ),
  );
}

async function dispatchAssetDrop(
  window,
  assetId,
  point,
  captureGhost = false,
) {
  const setup = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(
      '[data-asset-id="${assetId}"]'
    );
    const viewport = document.querySelector(
      '[data-testid="project-canvas-viewport"]'
    );
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
    const rect = viewport.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    const offsetX = Number(viewport.dataset.offsetX);
    const offsetY = Number(viewport.dataset.offsetY);
    const clientX =
      rect.left + offsetX + ${point.x} * scale - viewport.scrollLeft;
    const clientY =
      rect.top + offsetY + ${point.y} * scale - viewport.scrollTop;
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX,
      clientY
    };
    viewport.dispatchEvent(new DragEvent('dragenter', eventOptions));
    viewport.dispatchEvent(new DragEvent('dragover', eventOptions));
    window.__day22Drop = {
      card,
      viewport,
      transfer,
      eventOptions
    };
    return {
      scale,
      payload: transfer.getData(${JSON.stringify(assetDragMime)}),
      clientX,
      clientY
    };
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="canvas-drop-ghost"]')`,
      'Drop ghost did not render.',
    ),
  );
  const preview = await window.webContents.executeJavaScript(`(() => ({
    ghost: document.querySelector(
      '[data-testid="canvas-drop-ghost"]'
    ).textContent.replace(/\\s+/g, ' ').trim(),
    highlighted: document.querySelector(
      '[data-testid="project-canvas-viewport"]'
    ).classList.contains('canvas-viewport-drag-over')
  }))()`);
  const ghostScreenshot = captureGhost
    ? await captureElement(window, '.project-canvas')
    : null;
  await window.webContents.executeJavaScript(`(() => {
    const state = window.__day22Drop;
    state.viewport.dispatchEvent(
      new DragEvent('drop', state.eventOptions)
    );
    state.card.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: state.transfer
    }));
    delete window.__day22Drop;
  })()`);
  return { ...setup, ...preview, ghostScreenshot };
}

async function stageSnapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector(
      '[data-testid="project-canvas-stage"]'
    );
    return {
      layers: JSON.parse(stage.dataset.layerJson),
      renderedAssetIds: JSON.parse(stage.dataset.renderedAssetIds),
      selectedLayerId: stage.dataset.selectedLayerId,
      interactionStatus: document.querySelector(
        '[data-testid="canvas-interaction-status"]'
      ).textContent.trim(),
      revision: Number(stage.dataset.projectRevision),
      dirty: document.querySelector('.dirty-state') !== null
    };
  })()`);
}

async function logicalClientPoint(window, point, setScroll) {
  return window.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector(
      '[data-testid="project-canvas-viewport"]'
    );
    if (${setScroll ? 'true' : 'false'}) {
      viewport.scrollLeft = Math.max(0, ${point.x} - 420);
      viewport.scrollTop = Math.max(0, ${point.y} - 280);
    }
    const stage = document.querySelector(
      '[data-testid="project-canvas-stage"]'
    );
    const rect = stage.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    return {
      x: Math.round(
        rect.left + ${point.x} * scale
      ),
      y: Math.round(
        rect.top + ${point.y} * scale
      ),
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop
    };
  })()`);
}

async function verifyDay22() {
  const sha256 = 'b'.repeat(64);
  const project = {
    ...exampleProject,
    schemaVersion: 5,
    assets: [
      ...exampleProject.assets.map((asset) =>
        asset.kind === 'image' ? { ...asset, sha256 } : asset,
      ),
      {
        id: stickerAssetId,
        name: 'Placement sticker',
        relativePath: 'assets/placement-sticker.png',
        mimeType: 'image/png',
        kind: 'image',
        width: 200,
        height: 100,
        sha256,
      },
    ],
    characters: exampleProject.characters.map((character) => ({
      ...character,
      defaultExpressionId: character.expressions[0].id,
      defaultScale: 1,
      defaultFlipX: false,
    })),
    shots: exampleProject.shots.map((shot) => ({
      ...shot,
      backgroundLayerId: shot.layers[0]?.id ?? null,
      layers: shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      })),
    })),
  };
  let savedProject = null;
  let saveRequest = null;
  const autosaveUpdates = [];
  const thumbnailBytes = await readFile(
    path.join(
      repositoryRoot,
      'tests/fixtures/characters/熊猫 normal.png',
    ),
  );
  const thumbnailDataUrl =
    `data:image/png;base64,${thumbnailBytes.toString('base64')}`;

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: {
      projectRoot: request.projectRoot,
      projectFilePath: `${request.projectRoot}\\project.json`,
      project: savedProject ?? project,
      migrated: false,
      sourceVersion: 5,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequest = request;
    savedProject = request.project;
    return {
      ok: true,
      value: {
        projectRoot: request.projectRoot,
        projectFilePath: `${request.projectRoot}\\project.json`,
        project: request.project,
        migrated: false,
        sourceVersion: 5,
      },
    };
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, (_event, request) => {
    autosaveUpdates.push(request);
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
  }));
  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    (_event, request) => ({
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl: thumbnailDataUrl,
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    (_event, request) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === request.assetId,
      );
      if (!asset || asset.kind !== 'image') {
        return {
          ok: false,
          error: {
            code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
            message: 'Day 22 fixture image asset was not found.',
            assetId: request.assetId,
          },
        };
      }
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: 'image/png',
        width: asset.width,
        height: asset.height,
        byteLength: thumbnailBytes.byteLength,
        bytes: new Uint8Array(thumbnailBytes),
      };
    },
  );

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render.',
      ),
    );
    await openProject(window);
    await scrollCanvasIntoView(window);
    const initial = await stageSnapshot(window);

    await selectCategory(window, 1, stickerAssetId);
    const fitPreview = await dispatchAssetDrop(
      window,
      stickerAssetId,
      { x: 1200, y: 300 },
      true,
    );
    const ghostScreenshot = fitPreview.ghostScreenshot;
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.layerJson).length === 3`,
        'Fit drop did not create a layer.',
      ),
    );
    const fitDrop = await stageSnapshot(window);
    const fitLayer = fitDrop.layers.at(-1);

    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="canvas-mode-half"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(` +
          `'[data-testid="project-canvas-viewport"]'` +
          `).dataset.displayScale === '0.500000'`,
        '50% mode did not activate.',
      ),
    );
    const characterAssetId =
      project.characters[0].expressions[0].assetId;
    await selectCategory(window, 0, characterAssetId);
    const halfPreview = await dispatchAssetDrop(
      window,
      characterAssetId,
      { x: 500, y: 700 },
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.layerJson).length === 4`,
        '50% drop did not create a layer.',
      ),
    );
    const halfDrop = await stageSnapshot(window);
    const halfLayer = halfDrop.layers.at(-1);

    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="canvas-mode-actual"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(` +
          `'[data-testid="project-canvas-viewport"]'` +
          `).dataset.displayScale === '1.000000'`,
        'Actual mode did not activate.',
      ),
    );
    await selectCategory(window, 1, stickerAssetId);
    await logicalClientPoint(window, { x: 1400, y: 700 }, true);
    const actualPreview = await dispatchAssetDrop(
      window,
      stickerAssetId,
      { x: 1400, y: 700 },
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.layerJson).length === 5`,
        'Actual drop did not create a layer.',
      ),
    );
    const actualDrop = await stageSnapshot(window);
    const actualLayer = actualDrop.layers.at(-1);
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 400))',
    );

    const dragStart = await logicalClientPoint(
      window,
      { x: actualLayer.x, y: actualLayer.y },
      true,
    );
    const dragTarget = { x: 1100, y: 620 };
    const dragEnd = await logicalClientPoint(window, dragTarget, false);
    const actualPlacementScreenshot = await captureElement(
      window,
      '.project-canvas',
    );
    const autosaveBeforeDrag = autosaveUpdates.length;
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: dragStart.x,
      y: dragStart.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: dragStart.x,
      y: dragStart.y,
    });
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 50))',
    );
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        button: 'left',
        x: Math.round(
          dragStart.x + (dragEnd.x - dragStart.x) * fraction,
        ),
        y: Math.round(
          dragStart.y + (dragEnd.y - dragStart.y) * fraction,
        ),
      });
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 30))',
      );
    }
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 100))',
    );
    const dragDuring = await stageSnapshot(window);
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: dragEnd.x,
      y: dragEnd.y,
    });
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 250))',
    );
    const dragAfter = await stageSnapshot(window);
    const draggedLayer = dragAfter.layers.find(
      (layer) => layer.id === actualLayer.id,
    );
    if (
      Math.abs(draggedLayer.x - dragTarget.x) > 1 ||
      Math.abs(draggedLayer.y - dragTarget.y) > 1
    ) {
      throw new Error(
        `Drag end did not commit: ${JSON.stringify({
          dragStart,
          dragEnd,
          selected: dragAfter.selectedLayerId,
          selectedBefore: actualDrop.selectedLayerId,
          renderedAssetIds: dragAfter.renderedAssetIds,
          layer: draggedLayer,
          revisionBefore: actualDrop.revision,
          revisionAfter: dragAfter.revision,
        })}`,
      );
    }
    const autosaveAfterDrag = autosaveUpdates.length;

    await setInput(
      window,
      '[data-testid="layer-transform-panel"] label:nth-of-type(1) input',
      900,
    );
    await setInput(
      window,
      '[data-testid="layer-transform-panel"] label:nth-of-type(2) input',
      500,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="layer-transform-panel"] form')` +
        `.requestSubmit()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `(() => { const layer = JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.layerJson).find((item) => item.id === ` +
          `${JSON.stringify(actualLayer.id)});` +
          ` return layer.x === 900 && layer.y === 500; })()`,
        'Property panel did not commit center coordinates.',
      ),
    );
    const propertyAfter = await stageSnapshot(window);

    await window.webContents.executeJavaScript(`(() => {
      document.querySelector(
        '[data-testid="layer-transform-panel"] .layer-lock-control input'
      ).click();
    })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.layerJson).find((item) => item.id === ` +
          `${JSON.stringify(actualLayer.id)}).locked === true`,
        'Layer did not lock.',
      ),
    );
    const lockedBefore = await stageSnapshot(window);
    const lockedStart = await logicalClientPoint(
      window,
      { x: 900, y: 500 },
      true,
    );
    const lockedEnd = await logicalClientPoint(
      window,
      { x: 1000, y: 550 },
      false,
    );
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: lockedStart.x,
      y: lockedStart.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: lockedStart.x,
      y: lockedStart.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      button: 'left',
      x: lockedEnd.x,
      y: lockedEnd.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: lockedEnd.x,
      y: lockedEnd.y,
    });
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 100))',
    );
    const lockedAfter = await stageSnapshot(window);

    const backgroundHit = await logicalClientPoint(
      window,
      { x: 50, y: 50 },
      true,
    );
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: backgroundHit.x,
      y: backgroundHit.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: backgroundHit.x,
      y: backgroundHit.y,
    });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: backgroundHit.x,
      y: backgroundHit.y,
    });
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.selectedLayerId === ${JSON.stringify(
            project.shots[0].backgroundLayerId,
          )}`,
        'Formal background click did not preserve background selection.',
      ),
    );
    const backgroundAfter = await stageSnapshot(window);

    const beforeInvalid = await stageSnapshot(window);
    await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      );
      const rect = viewport.getBoundingClientRect();
      const transfer = new DataTransfer();
      transfer.setData(${JSON.stringify(assetDragMime)}, JSON.stringify({
        version: 2,
        assetId: 'd2200000-0000-4000-8000-000000000099',
        type: 'asset-image'
      }));
      const options = {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + 100,
        clientY: rect.top + 100
      };
      viewport.dispatchEvent(new DragEvent('dragenter', options));
      viewport.dispatchEvent(new DragEvent('dragover', options));
      viewport.dispatchEvent(new DragEvent('drop', options));
    })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="canvas-interaction-status"]')` +
          `.textContent.includes('找不到素材')`,
        'Invalid asset ID did not show a rejection.',
      ),
    );
    const invalidAfter = await stageSnapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelector('.recovery-status-row button').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.clean-state')`,
        'Day 22 project did not save cleanly.',
      ),
    );
    await window.webContents.reload();
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render after reload.',
      ),
    );
    await openProject(window);
    await scrollCanvasIntoView(window);
    const reopened = await stageSnapshot(window);
    const reopenedScreenshot = await captureElement(
      window,
      '.project-canvas',
    );
    const reopenedLayer = reopened.layers.find(
      (layer) => layer.id === actualLayer.id,
    );

    const evidence = {
      day: 22,
      workOrder: 'B-22/45',
      result: 'PASS',
      branch: 'feat/day-22-layer-placement',
      executedAt: new Date().toISOString(),
      baselineSha: '27ba25a3287c421aa1c26041d5bc41ec86daca65',
      contract: {
        dropPayload:
          'v2 controlled IDs; character-expression includes characterId + expressionId',
        coordinates: 'client + scroll -> screenToStage -> clamp',
        outsidePolicy: 'clamp center to 1920x1080 logical stage',
        selectionSerialized: false,
        dragMoveProjectCommits: 0,
        dragEndProjectCommits: 1,
      },
      drops: {
        fit: {
          scale: fitPreview.scale,
          requested: { x: 1200, y: 300 },
          actual: { x: fitLayer.x, y: fitLayer.y },
          ghost: fitPreview.ghost,
          highlighted: fitPreview.highlighted,
        },
        half: {
          scale: halfPreview.scale,
          requested: { x: 500, y: 700 },
          actual: { x: halfLayer.x, y: halfLayer.y },
          source: halfLayer.source,
        },
        actual: {
          scale: actualPreview.scale,
          requested: { x: 1400, y: 700 },
          actual: { x: actualLayer.x, y: actualLayer.y },
        },
      },
      selection: {
        createdLayerSelected:
          actualDrop.selectedLayerId === actualLayer.id,
        backgroundSelected:
          backgroundAfter.selectedLayerId ===
          project.shots[0].backgroundLayerId,
        backgroundId: project.shots[0].backgroundLayerId,
      },
      drag: {
        beforeRevision: actualDrop.revision,
        duringRevision: dragDuring.revision,
        afterRevision: dragAfter.revision,
        before: { x: actualLayer.x, y: actualLayer.y },
        requested: dragTarget,
        actual: {
          x: dragAfter.layers.find(
            (layer) => layer.id === actualLayer.id,
          ).x,
          y: dragAfter.layers.find(
            (layer) => layer.id === actualLayer.id,
          ).y,
        },
        autosaveUpdateDelta:
          autosaveAfterDrag - autosaveBeforeDrag,
      },
      properties: {
        revision: propertyAfter.revision,
        x: propertyAfter.layers.find(
          (layer) => layer.id === actualLayer.id,
        ).x,
        y: propertyAfter.layers.find(
          (layer) => layer.id === actualLayer.id,
        ).y,
      },
      locked: {
        beforeRevision: lockedBefore.revision,
        afterRevision: lockedAfter.revision,
        unchanged:
          JSON.stringify(lockedBefore.layers) ===
          JSON.stringify(lockedAfter.layers),
      },
      invalidAsset: {
        rejected:
          invalidAfter.interactionStatus.includes('找不到素材'),
        layerCountUnchanged:
          invalidAfter.layers.length === beforeInvalid.layers.length,
        revisionUnchanged:
          invalidAfter.revision === beforeInvalid.revision,
      },
      persistence: {
        schemaVersion: savedProject?.schemaVersion,
        saveRevision: saveRequest?.revision,
        savedLayerCount: savedProject?.shots[0]?.layers.length,
        reopenedLayer,
        selectionAfterReopen: reopened.selectedLayerId,
      },
      screenshots: [
        'docs/evidence/day-22/drop-ghost.png',
        'docs/evidence/day-22/actual-placement.png',
        'docs/evidence/day-22/reopened.png',
      ],
    };

    const closeAtScale = (left, right, scale) =>
      Math.abs(left - right) * scale <= 1;
    if (
      initial.layers.length !== 2 ||
      fitPreview.payload.includes('relativePath') ||
      fitPreview.payload.includes('D:\\\\') ||
      !fitPreview.highlighted ||
      !fitPreview.ghost.includes('放置图层') ||
      fitPreview.scale === 1 ||
      !closeAtScale(fitLayer.x, 1200, fitPreview.scale) ||
      !closeAtScale(fitLayer.y, 300, fitPreview.scale) ||
      halfPreview.scale !== 0.5 ||
      !closeAtScale(halfLayer.x, 500, halfPreview.scale) ||
      !closeAtScale(halfLayer.y, 700, halfPreview.scale) ||
      halfLayer.source.kind !== 'character' ||
      actualPreview.scale !== 1 ||
      !closeAtScale(actualLayer.x, 1400, actualPreview.scale) ||
      !closeAtScale(actualLayer.y, 700, actualPreview.scale) ||
      actualDrop.selectedLayerId !== actualLayer.id ||
      dragDuring.revision !== actualDrop.revision ||
      JSON.stringify(dragDuring.layers) !==
        JSON.stringify(actualDrop.layers) ||
      dragAfter.revision !== actualDrop.revision + 1 ||
      !closeAtScale(evidence.drag.actual.x, dragTarget.x, 1) ||
      !closeAtScale(evidence.drag.actual.y, dragTarget.y, 1) ||
      evidence.drag.autosaveUpdateDelta !== 1 ||
      evidence.properties.x !== 900 ||
      evidence.properties.y !== 500 ||
      !evidence.locked.unchanged ||
      lockedAfter.revision !== lockedBefore.revision ||
      !evidence.selection.backgroundSelected ||
      !evidence.invalidAsset.rejected ||
      !evidence.invalidAsset.layerCountUnchanged ||
      !evidence.invalidAsset.revisionUnchanged ||
      !saveRequest ||
      evidence.persistence.schemaVersion !== 5 ||
      reopenedLayer?.x !== 900 ||
      reopenedLayer?.y !== 500 ||
      reopenedLayer?.locked !== true ||
      reopened.selectedLayerId !== ''
    ) {
      throw new Error(
        `Day 22 verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'drop-ghost.png'),
        ghostScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'actual-placement.png'),
        actualPlacementScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reopened.png'),
        reopenedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'results.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
      IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay22)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
