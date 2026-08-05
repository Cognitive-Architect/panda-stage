const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
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
  'docs/evidence/day-21',
);
const projectRoot = 'D:\\Projects\\Day 21 canvas.pandastage';
const missingRoot = 'D:\\Projects\\Day 21 missing background.pandastage';
const emptyRoot = 'D:\\Projects\\Day 21 empty shot.pandastage';

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

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

async function openProject(window, root, expectedName) {
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
    root,
  );
  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('.project-canvas-heading > span')` +
        `?.textContent?.trim() === ${JSON.stringify(expectedName)}`,
      `Canvas did not open shot ${expectedName}.`,
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
  await scrollTargetIntoActiveViewport(window, '.project-canvas', 12);
}

async function captureCanvasSection(window) {
  const payload = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('.project-canvas');
    const clone = element.cloneNode(true);
    const sourceCanvases = [...element.querySelectorAll('canvas')];
    const clonedCanvases = [...clone.querySelectorAll('canvas')];
    clonedCanvases.forEach((canvas, index) => {
      const source = sourceCanvases[index];
      const image = document.createElement('img');
      image.src = source.toDataURL('image/png');
      image.width = source.width;
      image.height = source.height;
      image.style.display = 'block';
      canvas.replaceWith(image);
    });
    return {
      markup: clone.outerHTML,
      styles: [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .map((rule) => rule.cssText)
        .join('\\n')
    };
  })()`);
  const evidenceWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    backgroundColor: '#080c0a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    const html =
      '<!doctype html><html><head><meta charset="UTF-8">' +
      `<style>${payload.styles}</style></head>` +
      `<body><main class="app-shell">${payload.markup}</main></body></html>`;
    await evidenceWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    await evidenceWindow.webContents.executeJavaScript(`
      document.fonts.ready.then(() =>
        new Promise((resolve) => setTimeout(resolve, 150))
      )
    `);
    return await evidenceWindow.webContents.capturePage();
  } finally {
    evidenceWindow.destroy();
  }
}

async function verifyDay21() {
  const sha256 = 'a'.repeat(64);
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
      layers: shot.layers.map((layer) => ({
        ...layer,
        locked: false,
        flipX: false,
      })),
      backgroundLayerId: shot.layers[0]?.id ?? null,
    })),
  };
  const missingProject = {
    ...project,
    id: 'd2100000-0000-4000-8000-000000000002',
    name: 'Missing background canvas',
    shots: [
      {
        ...project.shots[0],
        id: 'd2100000-0000-4000-8000-000000000012',
        name: 'Missing background',
        layers: project.shots[0].layers.filter(
          (layer) => layer.zIndex !== 0,
        ),
        backgroundLayerId: null,
        dialogues: [],
        audioClips: [],
        timelineEvents: [],
      },
    ],
  };
  const emptyProject = {
    ...project,
    id: 'd2100000-0000-4000-8000-000000000003',
    name: 'Empty canvas',
    shots: [
      {
        ...project.shots[0],
        id: 'd2100000-0000-4000-8000-000000000013',
        name: 'Empty shot',
        layers: [],
        backgroundLayerId: null,
        dialogues: [],
        audioClips: [],
        timelineEvents: [],
      },
    ],
  };
  let savedProject = null;
  let saveRequest = null;
  let openCount = 0;
  const autosaveUpdates = [];
  const thumbnailBytes = await readFile(
    path.join(
      repositoryRoot,
      'tests/fixtures/characters/熊猫 normal.png',
    ),
  );
  const thumbnailDataUrl =
    `data:image/png;base64,${thumbnailBytes.toString('base64')}`;

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    openCount += 1;
    const selected =
      request.projectRoot === missingRoot
        ? missingProject
        : request.projectRoot === emptyRoot
          ? emptyProject
          : savedProject ?? project;
    return {
      ok: true,
      value: {
        projectRoot: request.projectRoot,
        projectFilePath: `${request.projectRoot}\\project.json`,
        project: selected,
        migrated: false,
        sourceVersion: 5,
      },
    };
  });
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

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render.',
      ),
    );
    await openProject(window, projectRoot, 'Opening');
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"project-canvas-stage\"]')" +
          "?.dataset.backgroundReady === 'true'",
        'Background thumbnail did not render.',
      ),
    );
    await scrollCanvasIntoView(window);

    const autosaveBeforeResize = autosaveUpdates.length;
    const centerScreenPoint =
      await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      );
      const rect = viewport.getBoundingClientRect();
      const scale = Number(viewport.dataset.displayScale);
      const offsetX = Number(viewport.dataset.offsetX);
      const offsetY = Number(viewport.dataset.offsetY);
      return {
        x: Math.round(rect.left + offsetX + 960 * scale),
        y: Math.round(rect.top + offsetY + 540 * scale)
      };
    })()`);
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: centerScreenPoint.x,
      y: centerScreenPoint.y,
    });
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"canvas-pointer-coordinate\"]')" +
          "?.textContent?.startsWith('x ')",
        'Real pointer input did not map to logical center.',
      ),
    );
    const fit = await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      );
      const stage = document.querySelector(
        '[data-testid="project-canvas-stage"]'
      );
      const scale = Number(viewport.dataset.displayScale);
      const offsetX = Number(viewport.dataset.offsetX);
      const offsetY = Number(viewport.dataset.offsetY);
      const expectedScale = Math.min(
        viewport.clientWidth / 1920,
        viewport.clientHeight / 1080
      );
      return {
        logicalWidth: Number(viewport.dataset.logicalWidth),
        logicalHeight: Number(viewport.dataset.logicalHeight),
        scale,
        expectedScale,
        offsetX,
        offsetY,
        centeredX:
          Math.abs(offsetX + 960 * scale - viewport.clientWidth / 2) < 0.01,
        centeredY:
          Math.abs(offsetY + 540 * scale - viewport.clientHeight / 2) < 0.01,
        pointer: document.querySelector(
          '[data-testid="canvas-pointer-coordinate"]'
        ).textContent.trim(),
        layerJson: stage.dataset.layerJson,
        backgroundPolicy: stage.dataset.backgroundPolicy,
        backgroundListening: stage.dataset.backgroundListening,
        backgroundScaleX: Number(stage.dataset.backgroundScaleX),
        backgroundScaleY: Number(stage.dataset.backgroundScaleY),
        backgroundLayerId: stage.dataset.backgroundLayerId,
        backgroundOpacity: Number(stage.dataset.backgroundOpacity),
        renderContract: stage.dataset.renderContract,
        centerGuides: stage.dataset.centerGuides,
        modeFeedback: document.querySelector(
          '[data-testid="canvas-mode-feedback"]'
        ).textContent.replace(/\\s+/g, ' ').trim(),
        clean: document.querySelector('.clean-state')
          ?.textContent?.trim() === '已保存',
        revisionZero: document.querySelector(
          '.shot-manager-heading span'
        )?.textContent?.includes('修订 0')
      };
    })()`);
    const fitScreenshot = await captureCanvasSection(window);
    const pointerMatch = /^x ([\d.]+) · y ([\d.]+)$/u.exec(
      fit.pointer,
    );

    window.setSize(1000, 700);
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 200))',
    );
    const resized = await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      );
      const stage = document.querySelector(
        '[data-testid="project-canvas-stage"]'
      );
      return {
        scale: Number(viewport.dataset.displayScale),
        expectedScale: Math.min(
          viewport.clientWidth / 1920,
          viewport.clientHeight / 1080
        ),
        layerJson: stage.dataset.layerJson,
        clean: document.querySelector('.clean-state')
          ?.textContent?.trim() === '已保存',
        revisionZero: document.querySelector(
          '.shot-manager-heading span'
        )?.textContent?.includes('修订 0')
      };
    })()`);
    const autosaveResizeDelta =
      autosaveUpdates.length - autosaveBeforeResize;

    window.setSize(1440, 1000);
    await scrollCanvasIntoView(window);
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-testid="canvas-mode-actual"]').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"project-canvas-viewport\"]')" +
          "?.dataset.displayScale === '1.000000'",
        'Actual-size mode did not become 1:1.',
      ),
    );
    const autosaveBeforeActualPointer = autosaveUpdates.length;
    const actualPointerTarget =
      await window.webContents.executeJavaScript(`(() => {
        const viewport = document.querySelector(
          '[data-testid="project-canvas-viewport"]'
        );
        viewport.scrollLeft = 321;
        viewport.scrollTop = 187;
        const rect = viewport.getBoundingClientRect();
        const visibleX = 400;
        const visibleY = 300;
        return {
          x: Math.round(rect.left + visibleX),
          y: Math.round(rect.top + visibleY),
          expectedX: viewport.scrollLeft + visibleX,
          expectedY: viewport.scrollTop + visibleY
        };
      })()`);
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: actualPointerTarget.x,
      y: actualPointerTarget.y,
    });
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"canvas-pointer-coordinate\"]')" +
          `?.textContent?.trim() !== ${JSON.stringify(fit.pointer)}`,
        'Actual-size scrolled pointer did not update.',
      ),
    );
    const actual = await window.webContents.executeJavaScript(`(() => {
      const viewport = document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      );
      const content = viewport.querySelector('.canvas-viewport-content');
      const stage = document.querySelector(
        '[data-testid="project-canvas-stage"]'
      );
      return {
        scale: Number(viewport.dataset.displayScale),
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        scrollWidth: viewport.scrollWidth,
        scrollHeight: viewport.scrollHeight,
        contentWidth: content.getBoundingClientRect().width,
        contentHeight: content.getBoundingClientRect().height,
        pointer: document.querySelector(
          '[data-testid="canvas-pointer-coordinate"]'
        ).textContent.trim(),
        layerJson: stage.dataset.layerJson,
        clean: document.querySelector('.clean-state')
          ?.textContent?.trim() === '已保存',
        revisionZero: document.querySelector(
          '.shot-manager-heading span'
        )?.textContent?.includes('修订 0'),
        modeFeedback: document.querySelector(
          '[data-testid="canvas-mode-feedback"]'
        ).textContent.replace(/\\s+/g, ' ').trim()
      };
    })()`);
    actual.autosaveUpdateDelta =
      autosaveUpdates.length - autosaveBeforeActualPointer;
    actual.expectedPointer = {
      x: actualPointerTarget.expectedX,
      y: actualPointerTarget.expectedY,
    };
    const actualPointerMatch = /^x ([\d.]+) · y ([\d.]+)$/u.exec(
      actual.pointer,
    );
    const actualScreenshot = await captureCanvasSection(window);

    const saveResponse =
      await window.webContents.executeJavaScript(
        `window.pandaStage.project.save(${JSON.stringify({
          projectRoot,
          project,
          revision: 0,
        })})`,
      );
    await window.webContents.reload();
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render after reload.',
      ),
    );
    await openProject(window, projectRoot, 'Opening');
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"project-canvas-stage\"]')" +
          "?.dataset.backgroundReady === 'true'",
        'Reopened canvas did not render.',
      ),
    );
    const reopened = await window.webContents.executeJavaScript(`(() => ({
      layerJson: document.querySelector(
        '[data-testid="project-canvas-stage"]'
      ).dataset.layerJson,
      logicalWidth: Number(document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      ).dataset.logicalWidth),
      logicalHeight: Number(document.querySelector(
        '[data-testid="project-canvas-viewport"]'
      ).dataset.logicalHeight),
      clean: document.querySelector('.clean-state')
        ?.textContent?.trim() === '已保存'
    }))()`);

    await openProject(window, missingRoot, 'Missing background');
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"canvas-background-warning\"]')",
        'Missing background did not show a readable warning.',
      ),
    );
    const missingMessage = await window.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"canvas-background-warning\"]')" +
        ".textContent.replace(/\\s+/g, ' ').trim()",
    );

    await openProject(window, emptyRoot, 'Empty shot');
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"canvas-empty-guidance\"]')",
        'Empty shot did not show guidance.',
      ),
    );
    const emptyMessage = await window.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"canvas-empty-guidance\"]')" +
        ".textContent.replace(/\\s+/g, ' ').trim()",
    );

    const dpiWindow = await createMainWindow({ show: false });
    let highDpi;
    try {
      dpiWindow.setSize(1280, 900);
      dpiWindow.webContents.debugger.attach('1.3');
      await dpiWindow.webContents.debugger.sendCommand(
        'Emulation.setDeviceMetricsOverride',
        {
          width: 1280,
          height: 800,
          deviceScaleFactor: 1.5,
          mobile: false,
        },
      );
      await dpiWindow.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('.recovery-open-row input')",
          'High-DPI StartScreen did not render.',
        ),
      );
      await openProject(dpiWindow, projectRoot, 'Opening');
      await dpiWindow.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\"project-canvas-stage\"]')" +
            "?.dataset.backgroundReady === 'true'",
          'High-DPI background did not render.',
        ),
      );
      await scrollCanvasIntoView(dpiWindow);
      const autosaveBeforeDpiPointers = autosaveUpdates.length;
      const dpiFitTarget =
        await dpiWindow.webContents.executeJavaScript(`(() => {
          const viewport = document.querySelector(
            '[data-testid="project-canvas-viewport"]'
          );
          const rect = viewport.getBoundingClientRect();
          const scale = Number(viewport.dataset.displayScale);
          const offsetX = Number(viewport.dataset.offsetX);
          const offsetY = Number(viewport.dataset.offsetY);
          return {
            x: Math.round(rect.left + offsetX + 960 * scale),
            y: Math.round(rect.top + offsetY + 540 * scale)
          };
        })()`);
      dpiWindow.webContents.sendInputEvent({
        type: 'mouseMove',
        x: dpiFitTarget.x,
        y: dpiFitTarget.y,
      });
      await dpiWindow.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\"canvas-pointer-coordinate\"]')" +
            "?.textContent?.startsWith('x ')",
          'High-DPI fit pointer did not update.',
        ),
      );
      const dpiFit = await dpiWindow.webContents.executeJavaScript(`(() => ({
        devicePixelRatio: window.devicePixelRatio,
        pointer: document.querySelector(
          '[data-testid="canvas-pointer-coordinate"]'
        ).textContent.trim(),
        layerJson: document.querySelector(
          '[data-testid="project-canvas-stage"]'
        ).dataset.layerJson
      }))()`);
      await dpiWindow.webContents.executeJavaScript(`
        document.querySelector('[data-testid="canvas-mode-actual"]').click()
      `);
      await dpiWindow.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\"project-canvas-viewport\"]')" +
            "?.dataset.displayScale === '1.000000'",
          'High-DPI actual-size mode did not become 1:1.',
        ),
      );
      const dpiActualTarget =
        await dpiWindow.webContents.executeJavaScript(`(() => {
          const viewport = document.querySelector(
            '[data-testid="project-canvas-viewport"]'
          );
          viewport.scrollLeft = 211;
          viewport.scrollTop = 133;
          const rect = viewport.getBoundingClientRect();
          const visibleX = 250;
          const visibleY = 200;
          return {
            x: Math.round(rect.left + visibleX),
            y: Math.round(rect.top + visibleY),
            expectedX: viewport.scrollLeft + visibleX,
            expectedY: viewport.scrollTop + visibleY
          };
        })()`);
      dpiWindow.webContents.sendInputEvent({
        type: 'mouseMove',
        x: dpiActualTarget.x,
        y: dpiActualTarget.y,
      });
      await dpiWindow.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\"canvas-pointer-coordinate\"]')" +
            `?.textContent?.trim() !== ${JSON.stringify(dpiFit.pointer)}`,
          'High-DPI actual pointer did not update.',
        ),
      );
      const dpiActual =
        await dpiWindow.webContents.executeJavaScript(`(() => ({
          pointer: document.querySelector(
            '[data-testid="canvas-pointer-coordinate"]'
          ).textContent.trim(),
          scrollLeft: document.querySelector(
            '[data-testid="project-canvas-viewport"]'
          ).scrollLeft,
          scrollTop: document.querySelector(
            '[data-testid="project-canvas-viewport"]'
          ).scrollTop,
          layerJson: document.querySelector(
            '[data-testid="project-canvas-stage"]'
          ).dataset.layerJson,
          clean: document.querySelector('.clean-state')
            ?.textContent?.trim() === '已保存',
          revisionZero: document.querySelector(
            '.shot-manager-heading span'
          )?.textContent?.includes('修订 0')
        }))()`);
      const dpiFitPointer = /^x ([\d.]+) · y ([\d.]+)$/u.exec(
        dpiFit.pointer,
      );
      const dpiActualPointer = /^x ([\d.]+) · y ([\d.]+)$/u.exec(
        dpiActual.pointer,
      );
      highDpi = {
        devicePixelRatio: dpiFit.devicePixelRatio,
        fit: dpiFit,
        actual: {
          ...dpiActual,
          expectedPointer: {
            x: dpiActualTarget.expectedX,
            y: dpiActualTarget.expectedY,
          },
        },
        autosaveUpdateDelta:
          autosaveUpdates.length - autosaveBeforeDpiPointers,
      };
      if (
        highDpi.devicePixelRatio !== 1.5 ||
        !dpiFitPointer ||
        Math.abs(Number(dpiFitPointer[1]) - 960) > 2 ||
        Math.abs(Number(dpiFitPointer[2]) - 540) > 2 ||
        !dpiActualPointer ||
        Math.abs(
          Number(dpiActualPointer[1]) - dpiActualTarget.expectedX,
        ) > 1 ||
        Math.abs(
          Number(dpiActualPointer[2]) - dpiActualTarget.expectedY,
        ) > 1 ||
        dpiFit.layerJson !== dpiActual.layerJson ||
        highDpi.autosaveUpdateDelta !== 0 ||
        !dpiActual.clean ||
        !dpiActual.revisionZero
      ) {
        throw new Error(
          `High-DPI mapping verification failed: ${JSON.stringify(highDpi)}`,
        );
      }
    } finally {
      if (dpiWindow.webContents.debugger.isAttached()) {
        dpiWindow.webContents.debugger.detach();
      }
      dpiWindow.destroy();
    }

    const evidence = {
      day: 21,
      workOrder: 'B-21/45',
      result: 'PASS',
      branch: 'feat/day-21-canvas-stage',
      executedAt: new Date().toISOString(),
      contract: {
        projectSchemaVersion: 5,
        logicalCanvas: { width: 1920, height: 1080, center: [960, 540] },
        fitFormula: 'min(containerWidth / 1920, containerHeight / 1080)',
        actualSizeScale: 1,
        pointerMapping: 'screenToStage inverse transform',
        background: 'equal-axis cover, centered crop, listening=false',
        backgroundIdentity: 'shot.backgroundLayerId',
        renderContract: 'shared-stage-layer-v1',
        viewportStateSerialized: false,
      },
      fit,
      resize: {
        ...resized,
        layerJsonUnchanged: resized.layerJson === fit.layerJson,
        autosaveUpdateDelta: autosaveResizeDelta,
      },
      actual,
      highDpi,
      persistence: {
        saveOk: saveResponse.ok,
        saveRevision: saveRequest?.revision,
        exactProjectSaved:
          canonicalJson(saveRequest?.project) === canonicalJson(project),
        openCount,
        reopened,
        layerJsonUnchanged:
          reopened.layerJson === JSON.stringify(project.shots[0].layers),
      },
      negativeStates: {
        missingBackground: missingMessage,
        emptyShot: emptyMessage,
      },
      screenshots: [
        'docs/evidence/day-21/canvas-fit.png',
        'docs/evidence/day-21/canvas-actual.png',
      ],
    };

    if (
      fit.logicalWidth !== 1920 ||
      fit.logicalHeight !== 1080 ||
      Math.abs(fit.scale - fit.expectedScale) > 0.00001 ||
      !fit.centeredX ||
      !fit.centeredY ||
      !pointerMatch ||
      Math.abs(Number(pointerMatch[1]) - 960) > 2 ||
      Math.abs(Number(pointerMatch[2]) - 540) > 2 ||
      fit.backgroundPolicy !== 'cover-centered-no-stretch' ||
      fit.backgroundListening !== 'false' ||
      fit.backgroundScaleX !== fit.backgroundScaleY ||
      fit.backgroundLayerId !== project.shots[0].backgroundLayerId ||
      fit.backgroundOpacity !== 1 ||
      fit.renderContract !== 'shared-stage-layer-v1' ||
      fit.centerGuides !== 'vertical,horizontal' ||
      !fit.modeFeedback.includes('适应窗口') ||
      !fit.clean ||
      !fit.revisionZero ||
      Math.abs(resized.scale - resized.expectedScale) > 0.00001 ||
      !evidence.resize.layerJsonUnchanged ||
      evidence.resize.autosaveUpdateDelta !== 0 ||
      !resized.clean ||
      !resized.revisionZero ||
      actual.scale !== 1 ||
      actual.scrollLeft <= 0 ||
      actual.scrollTop <= 0 ||
      actual.scrollWidth < 1920 ||
      actual.scrollHeight < 1080 ||
      !actualPointerMatch ||
      Math.abs(
        Number(actualPointerMatch[1]) - actualPointerTarget.expectedX,
      ) > 1 ||
      Math.abs(
        Number(actualPointerMatch[2]) - actualPointerTarget.expectedY,
      ) > 1 ||
      actual.layerJson !== fit.layerJson ||
      actual.autosaveUpdateDelta !== 0 ||
      !actual.clean ||
      !actual.revisionZero ||
      !actual.modeFeedback.includes('1:1 像素') ||
      !saveResponse.ok ||
      saveRequest?.revision !== 0 ||
      !evidence.persistence.exactProjectSaved ||
      !evidence.persistence.layerJsonUnchanged ||
      reopened.logicalWidth !== 1920 ||
      reopened.logicalHeight !== 1080 ||
      !reopened.clean ||
      !missingMessage.includes('背景预览不可用') ||
      !emptyMessage.includes('当前镜头还没有图层')
    ) {
      throw new Error(
        `Day 21 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'canvas-fit.png'),
        fitScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'canvas-actual.png'),
        actualScreenshot.toPNG(),
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
  .then(verifyDay21)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
