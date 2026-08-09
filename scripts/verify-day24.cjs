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
  await new Promise((resolve) => setTimeout(resolve, 60));
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

async function clickElement(window, selector) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ${selector}');
    }
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  })()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    window.webContents.sendInputEvent({
      type,
      ...(type === 'mouseMove'
        ? {}
        : { button: 'left', clickCount: 1 }),
      x: point.x,
      y: point.y,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function openProject(window, projectRoot) {
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
      `document.querySelector('[data-testid="active-project-path"] code')` +
        `?.textContent === ${JSON.stringify(projectRoot)}`,
      `Project did not become active: ${projectRoot}`,
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
    const activeProjectPath = document.querySelector(
      '[data-testid="active-project-path"] code'
    );
    const projectName = document.querySelector(
      '[data-testid="compact-project-bar"] .compact-project-name'
    );
    return {
      layers: JSON.parse(stage.dataset.layerJson),
      projectRevision: Number(stage.dataset.projectRevision),
      activeProjectRoot: activeProjectPath?.textContent,
      projectName: projectName?.textContent,
      // Task 2 deliberately removes the always-present editor path input;
      // the compact bar's visible active root is the retained identity.
      openCandidatePath: activeProjectPath?.textContent,
      selectedLayerId: stage.dataset.selectedLayerId,
      undoCount: Number(history.dataset.undoCount),
      redoCount: Number(history.dataset.redoCount),
      maxDepth: Number(history.dataset.historyDepth),
      undoDisabled: history.querySelectorAll('button')[0].disabled,
      redoDisabled: history.querySelectorAll('button')[1].disabled,
      transformStatus: document.querySelector(
        '[data-testid="layer-transform-status"]'
      ).textContent,
      transformDraft: Array.from(document.querySelectorAll(
        '[data-testid="layer-transform-panel"] form input[type="text"], ' +
        '[data-testid="layer-transform-panel"] form input[inputmode="decimal"]'
      )).map((input) => input.value),
      shotNameDraft: document.querySelector(
        '.shot-fields label:nth-of-type(1) input'
      )?.value,
      shotDurationDraft: Number(document.querySelector(
        '.shot-fields label:nth-of-type(2) input'
      )?.value)
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

async function blurWithoutChangingSelection(window, expectedLayerId) {
  const before = await snapshot(window);
  if (before.selectedLayerId !== expectedLayerId) {
    throw new Error(
      `Neutral blur started from the wrong selection: ${JSON.stringify({
        expectedLayerId,
        selectedLayerId: before.selectedLayerId,
      })}`,
    );
  }
  const point = await window.webContents.executeJavaScript(`(() => {
    const target = document.querySelector('.project-canvas-heading h2');
    const form = document.querySelector(
      '[data-testid="layer-transform-panel"] form'
    );
    if (!(target instanceof HTMLElement) || !(form instanceof HTMLElement)) {
      throw new Error('Neutral blur target or transform form was missing.');
    }
    if (form.contains(target)) {
      throw new Error('Neutral blur target unexpectedly belongs to the form.');
    }
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  })()`);
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
    window.webContents.sendInputEvent({
      type,
      ...(type === 'mouseMove'
        ? {}
        : { button: 'left', clickCount: 1 }),
      x: point.x,
      y: point.y,
    });
  }
  await window.webContents.executeJavaScript(
    `document.querySelector('.project-canvas-heading h2')` +
      `.focus({ preventScroll: true })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await snapshot(window);
  if (after.selectedLayerId !== expectedLayerId) {
    throw new Error(
      `Neutral blur changed layer selection: ${JSON.stringify({
        expectedLayerId,
        before: before.selectedLayerId,
        after: after.selectedLayerId,
      })}`,
    );
  }
  return {
    before: before.selectedLayerId,
    after: after.selectedLayerId,
  };
}

async function focusCanvasStage(window) {
  await window.webContents.executeJavaScript(
    `document.querySelector(
      '[data-testid="project-canvas-stage"]'
    ).focus()`,
  );
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
    shots: firstProject.shots.map((shot) => ({
      ...shot,
      name: 'Second project shot',
      durationMs: 4_321,
    })),
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
  ipcMain.handle(
    IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    (_event, request) => {
      const asset = firstProject.assets.find(
        (candidate) => candidate.id === request.assetId,
      );
      if (!asset || asset.kind !== 'image') {
        return {
          ok: false,
          error: {
            code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
            message: 'Day 24 fixture image asset was not found.',
            assetId: request.assetId,
          },
        };
      }
      const bytes =
        request.assetId === exampleProject.assets[0].id
          ? backgroundBytes
          : characterBytes;
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
    const flipButton =
      '[data-testid="layer-transform-panel"] button[type="button"]';
    const lockCheckbox =
      '[data-testid="layer-transform-panel"] .layer-lock-control input';

    const historyBeforeBlur = (await snapshot(window)).undoCount;
    await focusInput(window, transformInputs[0]);
    await setInput(window, transformInputs[0], '600');
    await focusInput(window, transformInputs[1]);
    const historyAfterInternalFocusMove =
      (await snapshot(window)).undoCount;
    await setInput(window, transformInputs[1], '740');
    const historyAfterBlurTyping = (await snapshot(window)).undoCount;
    const blurCommitSelection = await blurWithoutChangingSelection(
      window,
      target.id,
    );
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
    const submitThenBlurSelection =
      await blurWithoutChangingSelection(window, target.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const submitThenBlur = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    const historyBeforeNoChange = (await snapshot(window)).undoCount;
    await focusInput(window, transformInputs[0]);
    const noChangeBlurSelection =
      await blurWithoutChangingSelection(window, target.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const noChangeBlur = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    await focusInput(window, transformInputs[2]);
    await setInput(window, transformInputs[2], '0');
    const invalidBefore = await snapshot(window);
    const invalidBlurSelection =
      await blurWithoutChangingSelection(window, target.id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const invalidAfter = await snapshot(window);

    // The old canvas-click blur cleared selection and a later re-selection
    // incidentally reset this invalid draft. Selection now stays on the
    // ordinary layer, so restore the verifier draft explicitly from the
    // unchanged model before starting the independent action tests.
    await setInput(
      window,
      transformInputs[2],
      String(
        invalidAfter.layers.find((layer) => layer.id === target.id)
          .scaleX,
      ),
    );

    await selectLayerAtPoint(window, target.id, { x: 620, y: 750 });
    await focusInput(window, transformInputs[0]);
    await setInput(window, transformInputs[0], '700');
    const pendingFlipBefore = await snapshot(window);
    await clickElement(window, flipButton);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '${
            pendingFlipBefore.undoCount + 2
          }'`,
        'Pending X and flip did not create two history commands.',
      ),
    );
    const pendingFlipAfter = await snapshot(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingFlipUndoAction = await snapshot(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingFlipUndoDraft = await snapshot(window);
    await shortcut(window, 'Z', ['control', 'shift']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shortcut(window, 'Z', ['control', 'shift']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingFlipRedone = await snapshot(window);

    await focusInput(window, transformInputs[2]);
    await setInput(window, transformInputs[2], '1.2');
    const pendingLockBefore = await snapshot(window);
    await clickElement(window, lockCheckbox);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '${
            pendingLockBefore.undoCount + 2
          }'`,
        'Pending scale and lock did not create two history commands.',
      ),
    );
    const pendingLockAfter = await snapshot(window);
    await focusCanvasStage(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingLockUndoAction = await snapshot(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingLockUndoDraft = await snapshot(window);
    await shortcut(window, 'Z', ['control', 'shift']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shortcut(window, 'Z', ['control', 'shift']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pendingLockRedone = await snapshot(window);
    await focusCanvasStage(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));

    await focusInput(window, transformInputs[2]);
    await setInput(window, transformInputs[2], '0');
    const invalidInternalBefore = await snapshot(window);
    await clickElement(window, flipButton);
    const invalidFlipAfter = await snapshot(window);
    await focusInput(window, transformInputs[2]);
    await setInput(window, transformInputs[2], '0.8');
    await focusInput(window, transformInputs[4]);
    await setInput(window, transformInputs[4], '2');
    const invalidLockBefore = await snapshot(window);
    await clickElement(window, lockCheckbox);
    const invalidLockAfter = await snapshot(window);

    await focusInput(window, transformInputs[4]);
    await setInput(window, transformInputs[4], '0.9');
    await focusInput(window, transformInputs[3]);
    await setInput(window, transformInputs[3], '16');
    const submitActionBefore = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] form'
      ).requestSubmit()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const submitActionAfterSubmit = await snapshot(window);
    await clickElement(window, flipButton);
    const submitActionAfterFlip = await snapshot(window);
    await focusCanvasStage(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const submitActionUndone = await snapshot(window);
    await window.webContents.executeJavaScript(
      `document.querySelector(
        '[data-testid="layer-transform-panel"] form'
      ).requestSubmit()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const noChangeSubmit = await snapshot(window);
    await clickElement(window, flipButton);
    const noChangeFlipAfter = await snapshot(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const noChangeFlipUndone = await snapshot(window);
    await clickElement(window, lockCheckbox);
    const noChangeLockAfter = await snapshot(window);
    await focusCanvasStage(window);
    await shortcut(window, 'Z', ['control']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const noChangeLockUndone = await snapshot(window);

    await selectLayerAtPoint(window, target.id, { x: 700, y: 750 });
    const historyBeforeOrder = (await snapshot(window)).undoCount;
    await window.webContents.executeJavaScript(
      `document.querySelectorAll(
        '[data-testid="layer-order-controls"] button'
      )[2].click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const orderChanged = await snapshot(window);
    if (orderChanged.undoCount !== historyBeforeOrder + 1) {
      throw new Error(
        `Real front reorder did not create one history entry: ${JSON.stringify(
          { historyBeforeOrder, orderChanged },
        )}`,
      );
    }
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
          `.dataset.undoCount === '${
            orderRedone.undoCount + 1
          }'`,
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
          `.dataset.undoCount === '${
            lockedAfterSubmit.undoCount + 1
          }'`,
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
    await openProject(window, firstRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector('[data-testid="history-controls"]')` +
          `.dataset.undoCount === '0'`,
        'Returning to the first project did not clear history.',
      ),
    );
    const returned = await snapshot(window);
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
        neutralBlur: {
          expectedLayerId: target.id,
          transitions: [
            blurCommitSelection,
            submitThenBlurSelection,
            noChangeBlurSelection,
            invalidBlurSelection,
          ],
          selectionPreserved: [
            blurCommitSelection,
            submitThenBlurSelection,
            noChangeBlurSelection,
            invalidBlurSelection,
          ].every(
            (transition) =>
              transition.before === target.id &&
              transition.after === target.id,
          ),
        },
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
        internalActions: {
          flip: {
            before: {
              history: pendingFlipBefore.undoCount,
              revision: pendingFlipBefore.projectRevision,
              layer: layerAt(pendingFlipBefore),
            },
            after: {
              history: pendingFlipAfter.undoCount,
              revision: pendingFlipAfter.projectRevision,
              layer: layerAt(pendingFlipAfter),
            },
            undoAction: layerAt(pendingFlipUndoAction),
            undoDraft: layerAt(pendingFlipUndoDraft),
            redone: layerAt(pendingFlipRedone),
          },
          lock: {
            before: {
              history: pendingLockBefore.undoCount,
              revision: pendingLockBefore.projectRevision,
              layer: layerAt(pendingLockBefore),
            },
            after: {
              history: pendingLockAfter.undoCount,
              revision: pendingLockAfter.projectRevision,
              layer: layerAt(pendingLockAfter),
            },
            undoAction: layerAt(pendingLockUndoAction),
            undoDraft: layerAt(pendingLockUndoDraft),
            redone: layerAt(pendingLockRedone),
          },
          invalid: {
            beforeFlip: {
              history: invalidInternalBefore.undoCount,
              revision: invalidInternalBefore.projectRevision,
              layer: layerAt(invalidInternalBefore),
            },
            afterFlip: {
              history: invalidFlipAfter.undoCount,
              revision: invalidFlipAfter.projectRevision,
              layer: layerAt(invalidFlipAfter),
              draft: invalidFlipAfter.transformDraft,
              status: invalidFlipAfter.transformStatus,
            },
            beforeLock: {
              history: invalidLockBefore.undoCount,
              revision: invalidLockBefore.projectRevision,
              layer: layerAt(invalidLockBefore),
            },
            afterLock: {
              history: invalidLockAfter.undoCount,
              revision: invalidLockAfter.projectRevision,
              layer: layerAt(invalidLockAfter),
              draft: invalidLockAfter.transformDraft,
              status: invalidLockAfter.transformStatus,
            },
          },
          submitActionDedupe: {
            beforeHistory: submitActionBefore.undoCount,
            afterSubmitHistory: submitActionAfterSubmit.undoCount,
            afterActionHistory: submitActionAfterFlip.undoCount,
            afterAction: layerAt(submitActionAfterFlip),
            undone: layerAt(submitActionUndone),
          },
          noChange: {
            afterSubmitHistory: noChangeSubmit.undoCount,
            afterFlipHistory: noChangeFlipAfter.undoCount,
            flipUndoneHistory: noChangeFlipUndone.undoCount,
            afterLockHistory: noChangeLockAfter.undoCount,
            lockUndoneHistory: noChangeLockUndone.undoCount,
          },
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
        savedToActiveRoot: saveRequest?.projectRoot === firstRoot,
        historyExcluded:
          saveRequest &&
          !JSON.stringify(saveRequest.project).includes('history') &&
          !JSON.stringify(saveRequest.project).includes('undoStack') &&
          !JSON.stringify(saveRequest.project).includes('redoStack'),
        uiStateExcluded:
          saveRequest &&
          !JSON.stringify(saveRequest.project).includes(
            'selectedLayerId',
          ) &&
          !JSON.stringify(saveRequest.project).includes(
            'transformDraft',
          ) &&
          !JSON.stringify(saveRequest.project).includes('draftVersion'),
      },
      projectSwitch: {
        second: {
          activeProjectRoot: switched.activeProjectRoot,
          openCandidatePath: switched.openCandidatePath,
          projectName: switched.projectName,
          shotNameDraft: switched.shotNameDraft,
          shotDurationDraft: switched.shotDurationDraft,
          undoCount: switched.undoCount,
          redoCount: switched.redoCount,
        },
        returned: {
          activeProjectRoot: returned.activeProjectRoot,
          openCandidatePath: returned.openCandidatePath,
          projectName: returned.projectName,
          shotNameDraft: returned.shotNameDraft,
          shotDurationDraft: returned.shotDurationDraft,
          undoCount: returned.undoCount,
          redoCount: returned.redoCount,
        },
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
      !evidence.propertyForm.neutralBlur.selectionPreserved ||
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
      evidence.propertyForm.locked.layer.x !== 700 ||
      !evidence.propertyForm.locked.status.includes('已锁定') ||
      evidence.propertyForm.internalActions.flip.after.history !==
        evidence.propertyForm.internalActions.flip.before.history + 2 ||
      evidence.propertyForm.internalActions.flip.after.revision !==
        evidence.propertyForm.internalActions.flip.before.revision + 2 ||
      evidence.propertyForm.internalActions.flip.after.layer.x !== 700 ||
      !evidence.propertyForm.internalActions.flip.after.layer.flipX ||
      evidence.propertyForm.internalActions.flip.undoAction.x !== 700 ||
      evidence.propertyForm.internalActions.flip.undoAction.flipX ||
      evidence.propertyForm.internalActions.flip.undoDraft.x !== 620 ||
      evidence.propertyForm.internalActions.flip.undoDraft.flipX ||
      evidence.propertyForm.internalActions.flip.redone.x !== 700 ||
      !evidence.propertyForm.internalActions.flip.redone.flipX ||
      evidence.propertyForm.internalActions.lock.after.history !==
        evidence.propertyForm.internalActions.lock.before.history + 2 ||
      evidence.propertyForm.internalActions.lock.after.revision !==
        evidence.propertyForm.internalActions.lock.before.revision + 2 ||
      evidence.propertyForm.internalActions.lock.after.layer.scaleX !==
        1.2 ||
      !evidence.propertyForm.internalActions.lock.after.layer.locked ||
      evidence.propertyForm.internalActions.lock.undoAction.scaleX !==
        1.2 ||
      evidence.propertyForm.internalActions.lock.undoAction.locked ||
      evidence.propertyForm.internalActions.lock.undoDraft.scaleX !==
        0.8 ||
      evidence.propertyForm.internalActions.lock.undoDraft.locked ||
      evidence.propertyForm.internalActions.lock.redone.scaleX !== 1.2 ||
      !evidence.propertyForm.internalActions.lock.redone.locked ||
      evidence.propertyForm.internalActions.invalid.afterFlip.history !==
        evidence.propertyForm.internalActions.invalid.beforeFlip.history ||
      evidence.propertyForm.internalActions.invalid.afterFlip.revision !==
        evidence.propertyForm.internalActions.invalid.beforeFlip.revision ||
      evidence.propertyForm.internalActions.invalid.afterLock.history !==
        evidence.propertyForm.internalActions.invalid.beforeLock.history ||
      evidence.propertyForm.internalActions.invalid.afterLock.revision !==
        evidence.propertyForm.internalActions.invalid.beforeLock.revision ||
      JSON.stringify(
        evidence.propertyForm.internalActions.invalid.afterFlip.layer,
      ) !==
        JSON.stringify(
          evidence.propertyForm.internalActions.invalid.beforeFlip.layer,
        ) ||
      evidence.propertyForm.internalActions.invalid.afterFlip.draft[2] !==
        '0' ||
      !evidence.propertyForm.internalActions.invalid.afterFlip.status.includes(
        '缩放必须在',
      ) ||
      JSON.stringify(
        evidence.propertyForm.internalActions.invalid.afterLock.layer,
      ) !==
        JSON.stringify(
          evidence.propertyForm.internalActions.invalid.beforeLock.layer,
        ) ||
      evidence.propertyForm.internalActions.invalid.afterLock.draft[4] !==
        '2' ||
      !evidence.propertyForm.internalActions.invalid.afterLock.status.includes(
        '不透明度必须在',
      ) ||
      evidence.propertyForm.internalActions.submitActionDedupe
        .afterSubmitHistory !==
        evidence.propertyForm.internalActions.submitActionDedupe
          .beforeHistory +
          1 ||
      evidence.propertyForm.internalActions.submitActionDedupe
        .afterActionHistory !==
        evidence.propertyForm.internalActions.submitActionDedupe
          .afterSubmitHistory +
          1 ||
      evidence.propertyForm.internalActions.submitActionDedupe.afterAction
        .rotationDeg !== 16 ||
      evidence.propertyForm.internalActions.submitActionDedupe.afterAction
        .flipX ||
      evidence.propertyForm.internalActions.submitActionDedupe.undone
        .rotationDeg !== 15 ||
      !evidence.propertyForm.internalActions.submitActionDedupe.undone
        .flipX ||
      evidence.propertyForm.internalActions.noChange.afterFlipHistory !==
        evidence.propertyForm.internalActions.noChange.afterSubmitHistory +
          1 ||
      evidence.propertyForm.internalActions.noChange.flipUndoneHistory !==
        evidence.propertyForm.internalActions.noChange.afterSubmitHistory ||
      evidence.propertyForm.internalActions.noChange.afterLockHistory !==
        evidence.propertyForm.internalActions.noChange.flipUndoneHistory +
          1 ||
      evidence.propertyForm.internalActions.noChange.lockUndoneHistory !==
        evidence.propertyForm.internalActions.noChange
          .flipUndoneHistory ||
      evidence.zOrder.historyAfter !==
        evidence.zOrder.historyBefore + 1 ||
      evidence.zOrder.changed.at(-1)?.id !== target.id ||
      evidence.zOrder.changed.at(-1)?.zIndex !== 2 ||
      evidence.zOrder.undone[1]?.id !== target.id ||
      evidence.zOrder.undone[1]?.zIndex !== 1 ||
      evidence.zOrder.redone.at(-1)?.id !== target.id ||
      evidence.zOrder.redone.at(-1)?.zIndex !== 2 ||
      !evidence.persistence.saved ||
      !evidence.persistence.savedToActiveRoot ||
      !evidence.persistence.historyExcluded ||
      !evidence.persistence.uiStateExcluded ||
      evidence.projectSwitch.second.activeProjectRoot !== secondRoot ||
      evidence.projectSwitch.second.openCandidatePath !== secondRoot ||
      evidence.projectSwitch.second.projectName !== secondProject.name ||
      evidence.projectSwitch.second.shotNameDraft !==
        secondProject.shots[0].name ||
      evidence.projectSwitch.second.shotDurationDraft !==
        secondProject.shots[0].durationMs ||
      evidence.projectSwitch.second.undoCount !== 0 ||
      evidence.projectSwitch.second.redoCount !== 0 ||
      evidence.projectSwitch.returned.activeProjectRoot !== firstRoot ||
      evidence.projectSwitch.returned.openCandidatePath !== firstRoot ||
      evidence.projectSwitch.returned.projectName !== firstProject.name ||
      evidence.projectSwitch.returned.shotNameDraft !==
        firstProject.shots[0].name ||
      evidence.projectSwitch.returned.shotDurationDraft !==
        firstProject.shots[0].durationMs ||
      evidence.projectSwitch.returned.undoCount !== 0 ||
      evidence.projectSwitch.returned.redoCount !== 0
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
      IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay24)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
