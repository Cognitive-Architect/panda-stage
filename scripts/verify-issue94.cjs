const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const projectRoot = 'D:\\Projects\\Issue 94 redo selection.pandastage';
const assetDragMime = 'application/x-panda-stage-asset';
const thumbnailDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const canvasImageBytes = Buffer.from(
  thumbnailDataUrl.slice(thumbnailDataUrl.indexOf(',') + 1),
  'base64',
);

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
  await setInput(window, '.recovery-open-row input', projectRoot);
  await window.webContents.executeJavaScript(
    `document.querySelector('.recovery-open-row button').click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="active-project-path"] code')` +
        `?.textContent === ${JSON.stringify(projectRoot)}`,
      'Issue #94 project did not open.',
    ),
  );
}

async function selectBackgroundCategory(window, assetId) {
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="assets"]').click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="resource-activity-panel"]')` +
        `?.dataset.activeActivity === 'assets'`,
      'Asset activity did not activate.',
    ),
  );
  await window.webContents.executeJavaScript(
    `document.querySelectorAll('.asset-category-tabs button')[1].click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-asset-id="${assetId}"]')`,
      `Background asset card did not appear: ${assetId}`,
    ),
  );
}

async function dispatchAssetDrop(window, assetId, point) {
  await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-asset-id="${assetId}"]');
    const viewport = document.querySelector(
      '[data-testid="project-canvas-viewport"]'
    );
    if (!card || !viewport) throw new Error('Drop surface did not render.');
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
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + offsetX + ${point.x} * scale - viewport.scrollLeft,
      clientY: rect.top + offsetY + ${point.y} * scale - viewport.scrollTop
    };
    viewport.dispatchEvent(new DragEvent('dragenter', eventOptions));
    viewport.dispatchEvent(new DragEvent('dragover', eventOptions));
    viewport.dispatchEvent(new DragEvent('drop', eventOptions));
    card.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: transfer
    }));
    if (!transfer.getData(${JSON.stringify(assetDragMime)})) {
      throw new Error('Asset drag payload was empty.');
    }
  })()`);
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const inspector = document.querySelector('[data-testid="right-inspector"]');
    const background = document.querySelector(
      '[data-testid="layer-background-control"]'
    );
    const backgroundButton = document.querySelector(
      '[data-testid="set-current-shot-background"]'
    );
    return {
      layers: JSON.parse(stage.dataset.layerJson),
      selectedLayerId: stage.dataset.selectedLayerId,
      revision: Number(stage.dataset.projectRevision),
      undoCount: Number(history.dataset.undoCount),
      redoCount: Number(history.dataset.redoCount),
      inspectorState: inspector.dataset.selectionState,
      inspectorSelectedLayerId: inspector.dataset.selectedLayerId,
      backgroundState: background.dataset.backgroundControlState,
      backgroundDisabled: backgroundButton.disabled
    };
  })()`);
}

async function verifyIssue94() {
  const sha256 = '9'.repeat(64);
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
      layers: shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      })),
    })),
  };
  const backgroundAssetId = project.assets.find(
    (asset) => asset.kind === 'image' && asset.id === project.shots[0].layers[0].source.assetId,
  ).id;
  const handlers = [
    IPC_CHANNELS.PROJECT_OPEN,
    IPC_CHANNELS.AUTOSAVE_TRACK,
    IPC_CHANNELS.AUTOSAVE_UPDATE,
    IPC_CHANNELS.AUTOSAVE_STOP,
    IPC_CHANNELS.RECOVERY_DETECT,
    IPC_CHANNELS.RECENT_PROJECTS_LIST,
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
  ];

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: {
      projectRoot: request.projectRoot,
      projectFilePath: `${request.projectRoot}\\project.json`,
      project,
      migrated: false,
      sourceVersion: 5,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
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
            message: 'Issue 94 fixture image asset was not found.',
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
        byteLength: canvasImageBytes.byteLength,
        bytes: new Uint8Array(canvasImageBytes),
      };
    },
  );

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.recovery-open-row input')`,
        'Start screen did not render.',
      ),
    );
    await openProject(window);
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).length === 2`,
        'Initial shot did not render two layers.',
      ),
    );
    await selectBackgroundCategory(window, backgroundAssetId);
    await dispatchAssetDrop(window, backgroundAssetId, { x: 1_200, y: 300 });
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).length === 3`,
        'Create layer did not add exactly one layer.',
      ),
    );
    const created = await snapshot(window);
    const createdLayerId = created.layers.at(-1).id;
    if (
      created.selectedLayerId !== createdLayerId ||
      created.inspectorState !== 'selected' ||
      created.inspectorSelectedLayerId !== createdLayerId ||
      created.backgroundState !== 'available' ||
      created.backgroundDisabled ||
      created.undoCount !== 1 ||
      created.redoCount !== 0
    ) {
      throw new Error(`T1/T5 failed after create: ${JSON.stringify(created)}`);
    }

    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="history-controls"] button').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson).length === 2 && document.querySelector('[data-testid="history-controls"]').dataset.redoCount === '1'`,
        'Undo did not remove the created layer.',
      ),
    );
    const undone = await snapshot(window);
    if (
      undone.selectedLayerId ||
      undone.inspectorState !== 'empty' ||
      !undone.backgroundDisabled ||
      undone.undoCount !== 0 ||
      undone.redoCount !== 1
    ) {
      throw new Error(`T2 failed after undo: ${JSON.stringify(undone)}`);
    }

    await window.webContents.executeJavaScript(
      `document.querySelectorAll('[data-testid="history-controls"] button')[1].click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="project-canvas-stage"]').dataset.selectedLayerId === ${JSON.stringify(createdLayerId)}`,
        'Redo did not restore the created layer selection.',
      ),
    );
    const redone = await snapshot(window);
    if (
      redone.layers.filter((layer) => layer.id === createdLayerId).length !== 1 ||
      redone.selectedLayerId !== createdLayerId ||
      redone.inspectorState !== 'selected' ||
      redone.inspectorSelectedLayerId !== createdLayerId ||
      redone.backgroundState !== 'available' ||
      redone.backgroundDisabled ||
      redone.undoCount !== 1 ||
      redone.redoCount !== 0 ||
      redone.revision !== undone.revision + 1
    ) {
      throw new Error(`T3/T6 failed after redo: ${JSON.stringify(redone)}`);
    }

    console.log(JSON.stringify({
      issue: 94,
      projectRoot,
      createdLayerId,
      created,
      undone,
      redone,
      safety: 'selection restored only for the matching project and shot',
    }, null, 2));
  } finally {
    window.destroy();
    for (const channel of handlers) ipcMain.removeHandler(channel);
  }
}

app
  .whenReady()
  .then(verifyIssue94)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
