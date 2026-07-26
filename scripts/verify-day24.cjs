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
  'docs/evidence/day-24',
);
const firstRoot = 'D:\\Projects\\Day 24 history.pandastage';
const secondRoot = 'D:\\Projects\\Day 24 second.pandastage';
const secondContentLayerId =
  'd2400000-0000-4000-8000-000000000010';

app.on('window-all-closed', () => {});

function waitFor(expression, message) {
  return `new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () => {
      if (${expression}) return resolve();
      if (Date.now() >= deadline) {
        return reject(new Error(${JSON.stringify(message)}));
      }
      setTimeout(poll, 25);
    };
    poll();
  })`;
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function focusInput(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Input not found: ${selector}');
    }
    input.scrollIntoView({ block: 'center' });
    const rect = input.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x,
    y: point.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function openProject(window, projectRoot) {
  await setInput(window, '.recovery-open-row input', projectRoot);
  await window.webContents.executeJavaScript(
    `document.querySelector('.recovery-open-row button').click()`,
  );
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="history-controls"]')`,
      'History controls did not render.',
    ),
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector(
      '[data-testid="project-canvas-stage"]'
    );
    const history = document.querySelector(
      '[data-testid="history-controls"]'
    );
    return {
      layers: JSON.parse(stage.dataset.layerJson),
      selectedLayerId: stage.dataset.selectedLayerId,
      undoCount: Number(history.dataset.undoCount),
      redoCount: Number(history.dataset.redoCount),
      maxDepth: Number(history.dataset.historyDepth),
      undoDisabled: history.querySelectorAll('button')[0].disabled,
      redoDisabled: history.querySelectorAll('button')[1].disabled,
      transformStatus: document.querySelector(
        '[data-testid="layer-transform-status"]'
      ).textContent
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

async function dragWithTenMoves(window, from, to) {
  const start = await logicalClientPoint(window, from, true);
  const end = await logicalClientPoint(window, to);
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
  for (let step = 1; step <= 10; step += 1) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      button: 'left',
      x: Math.round(start.x + ((end.x - start.x) * step) / 10),
      y: Math.round(start.y + ((end.y - start.y) * step) / 10),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: end.x,
    y: end.y,
  });
  return { start, end };
}

async function clickLogicalPoint(window, point) {
  const client = await logicalClientPoint(window, point, true);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: client.x,
    y: client.y,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
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
}

async function selectLayerAtPoint(window, layerId, point) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickLogicalPoint(window, point);
    const state = await snapshot(window);
    if (state.selectedLayerId === layerId) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Moved layer could not be selected: ${layerId}`);
}

async function blurToCanvas(window, point) {
  await window.webContents.executeJavaScript(
    `document.querySelector('.project-canvas').scrollIntoView({
      block: 'start'
    })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  await clickLogicalPoint(window, point);
}

async function shortcut(window, key, modifiers) {
  window.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: key,
    modifiers,
  });
  window.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: key,
    modifiers,
  });
}

async function verifyDay24() {
  const sha256 = 'd'.repeat(64);
  const firstProject = {
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
    shots: exampleProject.shots.map((shot) => {
      const layers = shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      }));
      const ordinary = layers[1];
      return {
        ...shot,
        backgroundLayerId: layers[0]?.id ?? null,
        layers: [
          ...layers,
          {
            ...ordinary,
            id: secondContentLayerId,
            name: 'Second content layer',
            x: 1_200,
            zIndex: 2,
          },
        ],
      };
    }),
  };
  const secondProject = {
    ...firstProject,
    id: 'd2400000-0000-4000-8000-000000000002',
    name: 'Day 24 second project',
  };
  let saveRequest = null;
  const backgroundBytes = await readFile(
    path.join(
      repositoryRoot,
      'tests/fixtures/characters/熊猫 normal.png',
    ),
  );
  const characterBytes = await readFile(
    path.join(repositoryRoot, 'public/probe/panda-character.png'),
  );
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: {
      projectRoot: request.projectRoot,
      projectFilePath: `${request.projectRoot}\\project.json`,
      project:
        request.projectRoot === secondRoot ? secondProject : firstProject,
      migrated: false,
      sourceVersion: 5,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequest = request;
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
      dataUrl: `data:image/png;base64,${
        request.assetId === exampleProject.assets[0].id
          ? backgroundBytes.toString('base64')
          : characterBytes.toString('base64')
      }`,
    }),
  );

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('.recovery-open-row input')`,
        'Editor did not render.',
      ),
    );
    await openProject(window, firstRoot);
    window.showInactive();
    await window.webContents.executeJavaScript(
      waitFor(
        `JSON.parse(document.querySelector(
          '[data-testid="project-canvas-stage"]'
        ).dataset.renderedAssetIds).length >= 2`,
        'Canvas images did not render.',
      ),
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('.project-canvas').scrollIntoView()`,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="canvas-mode-actual"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(
          '[data-testid="project-canvas-viewport"]'
        ).dataset.displayScale === '1.000000'`,
        'Actual-size canvas mode did not activate.',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const target = firstProject.shots[0].layers[1];
    const origin = { x: target.x, y: target.y };
    const destination = { x: target.x + 120, y: target.y + 40 };
    const dragCoordinates = await dragWithTenMoves(
      window,
      origin,
      destination,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const dragged = await snapshot(window);
    if (dragged.undoCount !== 1) {
      throw new Error(
        `Ten-step drag did not commit one history entry: ${JSON.stringify(
          { dragged, dragCoordinates },
        )}`,
      );
    }

    await shortcut(window, 'Z', ['control']);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.redoCount === '1'`,
        'Ctrl+Z did not undo.',
      ),
    );
    const undone = await snapshot(window);
    await shortcut(window, 'Z', ['control', 'shift']);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '1'`,
        'Ctrl+Shift+Z did not redo.',
      ),
    );
    const redone = await snapshot(window);
    const redoneLayer = redone.layers.find(
      (layer) => layer.id === target.id,
    );
    await selectLayerAtPoint(window, target.id, {
      x: redoneLayer.x,
      y: redoneLayer.y,
    });
    const transformInputs = [
      '[data-testid="layer-transform-panel"] label:nth-of-type(1) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(2) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(3) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(4) input',
      '[data-testid="layer-transform-panel"] label:nth-of-type(5) input',
    ];

    const historyBeforeBlur = (await snapshot(window)).undoCount;
    await focusInput(window, transformInputs[0]);
    await setInput(window, transformInputs[0], '600');
    await focusInput(window, transformInputs[1]);
    const historyAfterInternalFocusMove =
      (await snapshot(window)).undoCount;
    await setInput(window, transformInputs[1], '740');
    const historyAfterBlurTyping = (await snapshot(window)).undoCount;
    await blurToCanvas(window, { x: 1_700, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const blurCommitted = await snapshot(window);
    if (blurCommitted.undoCount !== 2) {
      throw new Error(
        `Blur did not commit exactly one transform command: ${JSON.stringify(
          {
            historyBeforeBlur,
            historyAfterInternalFocusMove,
            historyAfterBlurTyping,
            blurCommitted,
          },
        )}`,
      );
    }

    await selectLayerAtPoint(window, target.id, { x: 600, y: 740 });
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector(
        '[data-testid="layer-transform-panel"]'
      ).scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    })()`);
    const propertyBlurScreenshot =
      await window.webContents.capturePage();
    const historyBeforeSubmit = (await snapshot(window)).undoCount;
    await focusInput(window, transformInputs[0]);
    for (const [index, value] of [620, 750, 0.8, 15, 0.9].entries()) {
      await setInput(window, transformInputs[index], String(value));
    }
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] form'
      ).requestSubmit()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '3'`,
        'Property form did not commit exactly one history entry.',
      ),
    );
    await blurToCanvas(window, { x: 1_700, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const submitThenBlur = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    const historyBeforeNoChange = (await snapshot(window)).undoCount;
    await focusInput(window, transformInputs[0]);
    await blurToCanvas(window, { x: 1_700, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const noChangeBlur = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    await focusInput(window, transformInputs[2]);
    await setInput(window, transformInputs[2], '0');
    const invalidBefore = await snapshot(window);
    await blurToCanvas(window, { x: 1_700, y: 100 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const invalidAfter = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    const historyBeforeOrder = (await snapshot(window)).undoCount;
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="layer-order-controls"] button'
      )[2].click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '4'`,
        'Real front reorder did not create one history entry.',
      ),
    );
    const orderChanged = await snapshot(window);
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector(
        '[data-testid="layer-order-controls"]'
      ).scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    })()`);
    const zOrderScreenshot = await window.webContents.capturePage();
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="history-controls"] button'
      )[0].click()`,
    );
    const orderUndone = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="history-controls"] button'
      )[1].click()`,
    );
    const orderRedone = await snapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] .layer-lock-control input'
      ).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '5'`,
        'Layer lock did not commit.',
      ),
    );
    const lockedBeforeSubmit = await snapshot(window);
    await setInput(window, transformInputs[0], '999');
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] form'
      ).requestSubmit()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const lockedAfterSubmit = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] .layer-lock-control input'
      ).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '6'`,
        'Layer unlock did not commit.',
      ),
    );

    const deleteProbe = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(
        '[data-testid="layer-order-controls"] .layer-delete-button'
      );
      return {
        selectedLayerId: document.querySelector(
          '[data-testid="project-canvas-stage"]'
        ).dataset.selectedLayerId,
        disabled: button.disabled
      };
    })()`);
    if (deleteProbe.disabled) {
      throw new Error(
        `Delete button unexpectedly disabled: ${JSON.stringify(deleteProbe)}`,
      );
    }
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-order-controls"] .layer-delete-button'
      ).click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        `!JSON.parse(document.querySelector(
          '[data-testid="project-canvas-stage"]'
        ).dataset.layerJson).some((layer) => layer.id === ${
          JSON.stringify(target.id)
        })`,
        'Delete did not remove the selected layer.',
      ),
    );
    const deleted = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="history-controls"] button'
      )[0].click()`,
    );
    const deleteUndone = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="history-controls"] button'
      )[1].click()`,
    );
    const deleteRedone = await snapshot(window);

    await window.webContents.executeJavaScript(
      `document.querySelector('.recovery-status-row button').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(`Boolean(${() => saveRequest})`, 'Save did not complete.'),
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await openProject(window, secondRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '0'`,
        'Project switch did not clear history.',
      ),
    );
    const switched = await snapshot(window);
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector(
        '[data-testid="history-controls"]'
      ).scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 150));
    })()`);
    const screenshot = await window.webContents.capturePage();

    const layerAt = (state) =>
      state.layers.find((layer) => layer.id === target.id);
    const evidence = {
      maxDepth: dragged.maxDepth,
      drag: {
        pointerMoveCount: 10,
        historyEntries: dragged.undoCount,
        origin,
        result: {
          x: layerAt(dragged).x,
          y: layerAt(dragged).y,
        },
      },
      shortcuts: {
        undoRestoredOrigin:
          layerAt(undone).x === origin.x &&
          layerAt(undone).y === origin.y,
        redoRestoredResult:
          layerAt(redone).x === layerAt(dragged).x &&
          layerAt(redone).y === layerAt(dragged).y,
      },
      deletion: {
        deleted: !layerAt(deleted),
        undoRestored: Boolean(layerAt(deleteUndone)),
        redoDeleted: !layerAt(deleteRedone),
      },
      buttons: {
        initialUndoEnabled: !dragged.undoDisabled,
        afterUndoRedoEnabled: !undone.redoDisabled,
      },
      propertyForm: {
        blur: {
          historyBefore: historyBeforeBlur,
          historyAfterInternalFocusMove,
          historyAfterTyping: historyAfterBlurTyping,
          historyAfter: blurCommitted.undoCount,
          layer: layerAt(blurCommitted),
        },
        submitThenBlur: {
          historyBefore: historyBeforeSubmit,
          historyAfter: submitThenBlur.undoCount,
          layer: layerAt(submitThenBlur),
        },
        noChange: {
          historyBefore: historyBeforeNoChange,
          historyAfter: noChangeBlur.undoCount,
        },
        invalid: {
          historyBefore: invalidBefore.undoCount,
          historyAfter: invalidAfter.undoCount,
          status: invalidAfter.transformStatus,
          layer: layerAt(invalidAfter),
        },
        locked: {
          historyBefore: lockedBeforeSubmit.undoCount,
          historyAfter: lockedAfterSubmit.undoCount,
          status: lockedAfterSubmit.transformStatus,
          layer: layerAt(lockedAfterSubmit),
        },
      },
      zOrder: {
        historyBefore: historyBeforeOrder,
        historyAfter: orderChanged.undoCount,
        changed: orderChanged.layers.map(({ id, zIndex }) => ({
          id,
          zIndex,
        })),
        undone: orderUndone.layers.map(({ id, zIndex }) => ({
          id,
          zIndex,
        })),
        redone: orderRedone.layers.map(({ id, zIndex }) => ({
          id,
          zIndex,
        })),
      },
      persistence: {
        saved: Boolean(saveRequest),
        historyExcluded:
          saveRequest &&
          !JSON.stringify(saveRequest.project).includes('history') &&
          !JSON.stringify(saveRequest.project).includes('undoStack') &&
          !JSON.stringify(saveRequest.project).includes('redoStack'),
      },
      projectSwitch: {
        undoCount: switched.undoCount,
        redoCount: switched.redoCount,
      },
    };
    if (
      evidence.maxDepth < 20 ||
      evidence.drag.historyEntries !== 1 ||
      !evidence.shortcuts.undoRestoredOrigin ||
      !evidence.shortcuts.redoRestoredResult ||
      !evidence.deletion.deleted ||
      !evidence.deletion.undoRestored ||
      !evidence.deletion.redoDeleted ||
      !evidence.buttons.initialUndoEnabled ||
      !evidence.buttons.afterUndoRedoEnabled ||
      evidence.propertyForm.blur.historyAfterTyping !==
        evidence.propertyForm.blur.historyBefore ||
      evidence.propertyForm.blur.historyAfterInternalFocusMove !==
        evidence.propertyForm.blur.historyBefore ||
      evidence.propertyForm.blur.historyAfter !==
        evidence.propertyForm.blur.historyBefore + 1 ||
      evidence.propertyForm.blur.layer.x !== 600 ||
      evidence.propertyForm.blur.layer.y !== 740 ||
      evidence.propertyForm.submitThenBlur.historyAfter !==
        evidence.propertyForm.submitThenBlur.historyBefore + 1 ||
      evidence.propertyForm.submitThenBlur.layer.x !== 620 ||
      evidence.propertyForm.submitThenBlur.layer.y !== 750 ||
      evidence.propertyForm.noChange.historyAfter !==
        evidence.propertyForm.noChange.historyBefore ||
      evidence.propertyForm.invalid.historyAfter !==
        evidence.propertyForm.invalid.historyBefore ||
      evidence.propertyForm.invalid.layer.scaleX !== 0.8 ||
      !evidence.propertyForm.invalid.status.includes('缩放必须在') ||
      evidence.propertyForm.locked.historyAfter !==
        evidence.propertyForm.locked.historyBefore ||
      evidence.propertyForm.locked.layer.x !== 620 ||
      !evidence.propertyForm.locked.status.includes('已锁定') ||
      evidence.zOrder.historyAfter !==
        evidence.zOrder.historyBefore + 1 ||
      evidence.zOrder.changed.at(-1)?.id !== target.id ||
      evidence.zOrder.changed.at(-1)?.zIndex !== 2 ||
      evidence.zOrder.undone[1]?.id !== target.id ||
      evidence.zOrder.undone[1]?.zIndex !== 1 ||
      evidence.zOrder.redone.at(-1)?.id !== target.id ||
      evidence.zOrder.redone.at(-1)?.zIndex !== 2 ||
      !evidence.persistence.saved ||
      !evidence.persistence.historyExcluded ||
      evidence.projectSwitch.undoCount !== 0 ||
      evidence.projectSwitch.redoCount !== 0
    ) {
      throw new Error(
        `Day 24 verification failed: ${JSON.stringify(evidence)}`,
      );
    }
    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'history-controls.png'),
        screenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'property-blur.png'),
        propertyBlurScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'z-order-history.png'),
        zOrderScreenshot.toPNG(),
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
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay24)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
