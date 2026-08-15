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
  'docs/evidence/day-23',
);
const projectRoot = 'D:\\Projects\\Day 23 transform.pandastage';
const extraLayerId = 'd2300000-0000-4000-8000-000000000020';
const keyboardDeleteLayerId =
  'd2300000-0000-4000-8000-000000000021';

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
  const managerCounts = await window.webContents.executeJavaScript(`(() => ({
    shots: document.querySelectorAll('[data-testid="shot-manager"]').length,
    assets: document.querySelectorAll('[data-testid="asset-library"]').length,
    characters: document.querySelectorAll(
      '[data-testid="character-manager"]'
    ).length
  }))()`);
  const expected = {
    shots: activity === 'shots' ? 1 : 0,
    assets: activity === 'assets' ? 1 : 0,
    characters: activity === 'characters' ? 1 : 0
  };
  if (JSON.stringify(managerCounts) !== JSON.stringify(expected)) {
    throw new Error(
      `Resource manager cardinality failed for ${activity}: ${JSON.stringify({
        expected,
        actual: managerCounts
      })}`
    );
  }
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
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('.project-canvas-heading > span')` +
        `?.textContent?.trim() === 'Opening'`,
      'Day 23 project did not open.',
    ),
  );
}

async function scrollCanvasIntoView(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const canvas = document.querySelector('.project-canvas');
    canvas.scrollIntoView({ block: 'start' });
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const bounds = canvas.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: innerHeight
    };
  })()`);
}

async function captureCanvas(window) {
  window.showInactive();
  await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.project-canvas');
    window.__day23CanvasStyle = canvas.getAttribute('style');
    Object.assign(canvas.style, {
      position: 'fixed',
      zIndex: '99999',
      top: '0',
      left: '0',
      width: '100vw',
      maxWidth: 'none',
      maxHeight: '100vh',
      overflow: 'auto',
      margin: '0',
      background: '#121a15'
    });
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await window.webContents.capturePage();
  await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.project-canvas');
    const original = window.__day23CanvasStyle;
    if (original === null) canvas.removeAttribute('style');
    else canvas.setAttribute('style', original);
    delete window.__day23CanvasStyle;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return image.toPNG();
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector(
      '[data-testid="project-canvas-stage"]'
    );
    return {
      layers: JSON.parse(stage.dataset.layerJson),
      selectedLayerId: stage.dataset.selectedLayerId,
      transformerVisible: stage.dataset.transformerVisible === 'true',
      revision: Number(stage.dataset.projectRevision),
      dirty: document.querySelector('.dirty-state') !== null
    };
  })()`);
}

async function logicalClientPoint(window, point, setScroll = false) {
  return window.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector(
      '[data-testid="project-canvas-viewport"]'
    );
    if (${setScroll ? 'true' : 'false'}) {
      viewport.scrollLeft = Math.max(0, ${point.x} - 500);
      viewport.scrollTop = Math.max(0, ${point.y} - 330);
    }
    const stage = document.querySelector(
      '[data-testid="project-canvas-stage"]'
    );
    const rect = stage.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    return {
      x: Math.round(rect.left + ${point.x} * scale),
      y: Math.round(rect.top + ${point.y} * scale)
    };
  })()`);
}

async function clickLogicalPoint(window, point) {
  const client = await logicalClientPoint(window, point, true);
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
  await new Promise((resolve) => setTimeout(resolve, 60));
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: client.x,
    y: client.y,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  return client;
}

async function selectLayerAtPoint(window, layerId, point) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickLogicalPoint(window, point);
    const state = await snapshot(window);
    if (state.selectedLayerId === layerId) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Layer could not be selected: ${layerId}`);
}

async function dragLogicalPoint(window, from, to) {
  const start = await logicalClientPoint(window, from, true);
  const end = await logicalClientPoint(window, to, false);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: start.x,
    y: start.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: start.x,
    y: start.y,
  });
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      button: 'left',
      x: Math.round(start.x + (end.x - start.x) * fraction),
      y: Math.round(start.y + (end.y - start.y) * fraction),
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: end.x,
    y: end.y,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function createSelectedCharacterLayer(window, point) {
  const assetId = exampleProject.characters[0].expressions[0].assetId;
  await selectResourceActivity(window, 'assets');
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('.asset-category-tabs button')[0].click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-asset-id="${assetId}"]')`,
      'Character asset card did not appear.',
    ),
  );
  await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-asset-id="${assetId}"]');
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
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + offsetX + ${point.x} * scale,
      clientY: rect.top + offsetY + ${point.y} * scale
    };
    viewport.dispatchEvent(new DragEvent('dragenter', options));
    viewport.dispatchEvent(new DragEvent('dragover', options));
    viewport.dispatchEvent(new DragEvent('drop', options));
    card.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: transfer
    }));
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="project-canvas-stage"]')` +
        `.dataset.selectedLayerId !== ''`,
      'Dropped character layer was not selected.',
    ),
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="project-canvas-stage"]')` +
        `.dataset.transformerVisible === 'true'`,
      'Dropped character layer Transformer did not attach.',
    ),
  );
  return snapshot(window);
}

async function verifyDay23() {
  const sha256 = 'c'.repeat(64);
  const ordinary = exampleProject.shots[0].layers[1];
  const project = {
    ...exampleProject,
    schemaVersion: 5,
    assets: exampleProject.assets.map((asset) =>
      asset.kind === 'image' ? { ...asset, sha256 } : asset,
    ),
    characters: exampleProject.characters.map((character) => ({
      ...character,
      defaultExpressionId: character.expressions[0].id,
      defaultScale: 1,
      defaultFlipX: false,
    })),
    shots: exampleProject.shots.map((shot) => ({
      ...shot,
      backgroundLayerId: shot.layers[0]?.id ?? null,
      layers: [
        ...shot.layers.map((layer) => ({
          ...layer,
          locked: false,
          flipX: false,
        })),
        {
          ...ordinary,
          id: extraLayerId,
          name: 'Second panda',
          x: 1500,
          y: 850,
          locked: false,
          flipX: false,
          zIndex: 2,
        },
        {
          ...ordinary,
          id: keyboardDeleteLayerId,
          name: 'Keyboard delete panda',
          x: 1500,
          y: 250,
          locked: false,
          flipX: false,
          zIndex: 3,
        },
      ],
    })),
  };
  let savedProject = null;
  let saveRequest = null;
  const autosaveUpdates = [];
  const backgroundThumbnailBytes = await readFile(
    path.join(
      repositoryRoot,
      'tests/fixtures/characters/熊猫 normal.png',
    ),
  );
  const characterThumbnailBytes = await readFile(
    path.join(repositoryRoot, 'public/probe/panda-character.png'),
  );
  const backgroundThumbnailDataUrl =
    `data:image/png;base64,${backgroundThumbnailBytes.toString('base64')}`;
  const characterThumbnailDataUrl =
    `data:image/png;base64,${characterThumbnailBytes.toString('base64')}`;

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
      dataUrl:
        request.assetId === exampleProject.assets[0].id
          ? backgroundThumbnailDataUrl
          : characterThumbnailDataUrl,
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
            message: 'Day 23 fixture image asset was not found.',
            assetId: request.assetId,
          },
        };
      }
      const bytes =
        request.assetId === exampleProject.assets[0].id
          ? backgroundThumbnailBytes
          : characterThumbnailBytes;
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: 'image/png',
        width: asset.width,
        height: asset.height,
        byteLength: bytes.byteLength,
        bytes: new Uint8Array(bytes),
      };
    },
  );

  const window = await createMainWindow({ show: false });
  try {
    let targetLayerId = null;
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render.',
      ),
    );
    await openProject(window);
    await scrollCanvasIntoView(window);
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="canvas-mode-actual"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="project-canvas-viewport"]')` +
          `.dataset.displayScale === '1.000000'`,
        'Actual mode did not activate.',
      ),
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]'` +
          `).dataset.renderedAssetIds).includes(` +
          `${JSON.stringify(exampleProject.assets[1].id)})`,
        'Character image did not render.',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const selectionProbe = await createSelectedCharacterLayer(
      window,
      { x: ordinary.x, y: ordinary.y },
    );
    targetLayerId = selectionProbe.selectedLayerId;
    if (
      !selectionProbe.transformerVisible
    ) {
      throw new Error(
        `Transformer did not attach: ${JSON.stringify({
          selectionProbe,
        })}`,
      );
    }
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(` +
        `'[data-testid="layer-order-controls"] button'` +
        `)[3].click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.find((item) => item.id === ${JSON.stringify(targetLayerId)})` +
          `.zIndex === 1`,
        'Selected layer did not move behind overlapping content.',
      ),
    );
    await scrollCanvasIntoView(window);
    const selected = await snapshot(window);
    const overlayProbe = await window.webContents.executeJavaScript(
      `(() => {
        const stage = document.querySelector(
          '[data-testid="project-canvas-stage"]'
        );
        return {
          mode: stage.dataset.transformerOverlay,
          konvaCanvasCount: stage.querySelectorAll('canvas').length
        };
      })()`,
    );
    const transformerScreenshot = await captureCanvas(window);

    const selectedLayer = selected.layers.find(
      (layer) => layer.id === targetLayerId,
    );
    const coveringLayer = selected.layers.find(
      (layer) => layer.id === ordinary.id,
    );
    const halfSize = (640 * selectedLayer.scaleX) / 2;
    await dragLogicalPoint(
      window,
      {
        x: selectedLayer.x + halfSize,
        y: selectedLayer.y - halfSize,
      },
      {
        x: selectedLayer.x + halfSize + 100,
        y: selectedLayer.y - halfSize - 100,
      },
    );
    const scaleAfter = await snapshot(window);
    const scaledLayer = scaleAfter.layers.find(
      (layer) => layer.id === targetLayerId,
    );
    const scaledHalfSize = (640 * scaledLayer.scaleX) / 2;
    await dragLogicalPoint(
      window,
      {
        x: scaledLayer.x,
        y: scaledLayer.y - scaledHalfSize - 42,
      },
      {
        x: scaledLayer.x + 150,
        y: scaledLayer.y - scaledHalfSize + 35,
      },
    );
    const transformerAfter = await snapshot(window);
    const mouseLayer = transformerAfter.layers.find(
      (layer) => layer.id === targetLayerId,
    );
    const coveringLayerAfter = transformerAfter.layers.find(
      (layer) => layer.id === ordinary.id,
    );

    const inputSelectors = [
      '[data-testid="layer-transform-panel"] label:nth-of-type(1) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(2) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(3) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(4) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(5) input',
    ];
    for (const [index, value] of [800, 450, 1.25, 450, 0.6].entries()) {
      await setInput(window, inputSelectors[index], value);
    }
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="layer-transform-panel"] form')` +
        `.requestSubmit()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `(() => { const layer = JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.find((item) => item.id === ${JSON.stringify(targetLayerId)});` +
          ` return layer.x === 800 && layer.y === 450 &&` +
          ` layer.scaleX === 1.25 && layer.rotationDeg === 90 &&` +
          ` layer.opacity === 0.6; })()`,
        'Property transform did not commit.',
      ),
    );
    const propertyAfter = await snapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelector(` +
        `'[data-testid="layer-transform-panel"] button[type="button"]'` +
        `).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.find((item) => item.id === ${JSON.stringify(targetLayerId)})` +
          `.flipX === true`,
        'Horizontal flip did not commit.',
      ),
    );
    const flipped = await snapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelectorAll(` +
        `'[data-testid="layer-order-controls"] button'` +
        `)[3].click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.find((item) => item.id === ${JSON.stringify(targetLayerId)})` +
          `.zIndex === 1`,
        'Move-to-back did not commit.',
      ),
    );
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(` +
        `'[data-testid="layer-order-controls"] button'` +
        `)[2].click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.find((item) => item.id === ${JSON.stringify(targetLayerId)})` +
          `.zIndex === 4`,
        'Move-to-front did not commit.',
      ),
    );
    const ordered = await snapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelector(` +
        `'[data-testid="layer-transform-panel"] .layer-lock-control input'` +
        `).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="project-canvas-stage"]')` +
          `.dataset.transformerVisible === 'false'`,
        'Lock did not detach the Transformer.',
      ),
    );
    const locked = await snapshot(window);
    const lockUi = await window.webContents.executeJavaScript(`(() => ({
      transformInputsDisabled: [...document.querySelectorAll(
        '[data-testid="layer-transform-panel"] input'
      )].slice(0, 5).every((input) => input.disabled),
      orderButtonsDisabled: [...document.querySelectorAll(
        '[data-testid="layer-order-controls"] button'
      )].every((button) => button.disabled)
    }))()`);
    const lockedScreenshot = await captureCanvas(window);

    await window.webContents.executeJavaScript(
      `document.querySelector(` +
        `'[data-testid="layer-transform-panel"] .layer-lock-control input'` +
        `).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="project-canvas-stage"]')` +
          `.dataset.transformerVisible === 'true'`,
        'Unlock did not restore the Transformer.',
      ),
    );

    await window.webContents.executeJavaScript(
      `document.querySelector('.recovery-status-row button').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.clean-state')`,
        'Day 23 project did not save cleanly.',
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
    const reopened = await snapshot(window);
    const reopenedLayer = reopened.layers.find(
      (layer) => layer.id === targetLayerId,
    );

    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="canvas-mode-actual"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="project-canvas-viewport"]')` +
          `.dataset.displayScale === '1.000000'`,
        'Actual mode did not reactivate.',
      ),
    );
    await selectLayerAtPoint(
      window,
      extraLayerId,
      { x: 1500, y: 850 },
    );
    const beforeButtonDelete = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelector(` +
        `'[data-testid="layer-order-controls"] .layer-delete-button'` +
        `).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.every((item) => item.id !== ${JSON.stringify(extraLayerId)})`,
        'Delete button did not remove the selected layer.',
      ),
    );
    const buttonDeleted = await snapshot(window);
    await selectLayerAtPoint(
      window,
      keyboardDeleteLayerId,
      { x: 1500, y: 250 },
    );
    const beforeDelete = await snapshot(window);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(` +
          `'[data-testid="project-canvas-stage"]').dataset.layerJson)` +
          `.every((item) => item.id !== ` +
          `${JSON.stringify(keyboardDeleteLayerId)})`,
        'Delete shortcut did not remove the selected layer.',
      ),
    );
    const deleted = await snapshot(window);
    const revisionAfterDelete = deleted.revision;
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const emptyDelete = await snapshot(window);
    const deletedScreenshot = await captureCanvas(window);

    const evidence = {
      day: 23,
      workOrder: 'B-23/45',
      result: 'PASS',
      branch: 'feat/day-23-layer-transform',
      executedAt: new Date().toISOString(),
      baselineSha: '4a5266c',
      contract: {
        schemaVersion: 5,
        flipModel: 'explicit flipX boolean; positive uniform scale',
        centerAnchor: 'x/y remain the visual center',
        orderModel: 'continuous zIndex; background pinned at zero',
        selectionSerialized: false,
      },
      transformer: {
        visibleOnSelection: selected.transformerVisible,
        overlay: overlayProbe,
        selectedZIndex: selectedLayer.zIndex,
        coveringLayerId: coveringLayer.id,
        coveringZIndex: coveringLayer.zIndex,
        coveringLayerUnchanged:
          JSON.stringify(coveringLayerAfter) ===
          JSON.stringify(coveringLayer),
        revisionBefore: selected.revision,
        scaleRevisionAfter: scaleAfter.revision,
        rotationRevisionAfter: transformerAfter.revision,
        scaleBefore: selectedLayer.scaleX,
        scaleAfter: mouseLayer.scaleX,
        rotationAfter: mouseLayer.rotationDeg,
      },
      properties: propertyAfter.layers.find(
        (layer) => layer.id === targetLayerId,
      ),
      flip: {
        centerBefore: { x: 800, y: 450 },
        centerAfter: {
          x: flipped.layers.find(
            (layer) => layer.id === targetLayerId,
          ).x,
          y: flipped.layers.find(
            (layer) => layer.id === targetLayerId,
          ).y,
        },
        flipX: flipped.layers.find(
          (layer) => layer.id === targetLayerId,
        ).flipX,
      },
      order: ordered.layers.map((layer) => ({
        id: layer.id,
        zIndex: layer.zIndex,
      })),
      lock: {
        locked: locked.layers.find(
          (layer) => layer.id === targetLayerId,
        ).locked,
        transformerVisible: locked.transformerVisible,
        ...lockUi,
      },
      persistence: {
        saveRevision: saveRequest?.revision,
        schemaVersion: savedProject?.schemaVersion,
        reopenedLayer,
        selectedAfterReopen: reopened.selectedLayerId,
      },
      deletion: {
        beforeRevision: beforeDelete.revision,
        afterRevision: deleted.revision,
        selectedAfter: deleted.selectedLayerId,
        buttonLayerRemoved: buttonDeleted.layers.every(
          (layer) => layer.id !== extraLayerId,
        ),
        buttonRevisionDelta:
          buttonDeleted.revision - beforeButtonDelete.revision,
        keyboardLayerRemoved: deleted.layers.every(
          (layer) => layer.id !== keyboardDeleteLayerId,
        ),
        emptyDeleteRevisionUnchanged:
          emptyDelete.revision === revisionAfterDelete,
      },
      autosaveUpdates: autosaveUpdates.length,
      screenshots: [
        'docs/evidence/day-23/transformer-overlay.png',
        'docs/evidence/day-23/locked.png',
        'docs/evidence/day-23/deleted.png',
      ],
    };

    if (
      !evidence.transformer.visibleOnSelection ||
      evidence.transformer.overlay.mode !==
        'separate-konva-layer-after-content' ||
      evidence.transformer.overlay.konvaCanvasCount < 2 ||
      !(evidence.transformer.selectedZIndex <
        evidence.transformer.coveringZIndex) ||
      !evidence.transformer.coveringLayerUnchanged ||
      evidence.transformer.scaleRevisionAfter !==
        evidence.transformer.revisionBefore + 1 ||
      evidence.transformer.rotationRevisionAfter !==
        evidence.transformer.scaleRevisionAfter + 1 ||
      !(evidence.transformer.scaleAfter > evidence.transformer.scaleBefore) ||
      Math.abs(evidence.transformer.rotationAfter) < 1 ||
      evidence.properties.x !== 800 ||
      evidence.properties.y !== 450 ||
      evidence.properties.scaleX !== 1.25 ||
      evidence.properties.scaleY !== 1.25 ||
      evidence.properties.rotationDeg !== 90 ||
      evidence.properties.opacity !== 0.6 ||
      !evidence.flip.flipX ||
      evidence.flip.centerAfter.x !== evidence.flip.centerBefore.x ||
      evidence.flip.centerAfter.y !== evidence.flip.centerBefore.y ||
      evidence.order.at(-1)?.id !== targetLayerId ||
      !evidence.order.every((layer, index) => layer.zIndex === index) ||
      !evidence.lock.locked ||
      evidence.lock.transformerVisible ||
      !evidence.lock.transformInputsDisabled ||
      !evidence.lock.orderButtonsDisabled ||
      // schema version is 6 after Day 27 v5->v6 migration (PROJECT_SCHEMA_VERSION in src/domain/constants.ts)
      evidence.persistence.schemaVersion !== 6 ||
      evidence.persistence.reopenedLayer?.flipX !== true ||
      evidence.persistence.reopenedLayer?.rotationDeg !== 90 ||
      evidence.persistence.reopenedLayer?.scaleX !== 1.25 ||
      evidence.persistence.selectedAfterReopen !== '' ||
      !evidence.deletion.buttonLayerRemoved ||
      evidence.deletion.buttonRevisionDelta !== 1 ||
      !evidence.deletion.keyboardLayerRemoved ||
      evidence.deletion.selectedAfter !== '' ||
      evidence.deletion.afterRevision !==
        evidence.deletion.beforeRevision + 1 ||
      !evidence.deletion.emptyDeleteRevisionUnchanged
    ) {
      throw new Error(
        `Day 23 verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'transformer-overlay.png'),
        transformerScreenshot,
      ),
      writeFile(
        path.join(evidenceDirectory, 'locked.png'),
        lockedScreenshot,
      ),
      writeFile(
        path.join(evidenceDirectory, 'deleted.png'),
        deletedScreenshot,
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
  .then(verifyDay23)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
