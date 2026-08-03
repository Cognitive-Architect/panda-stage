const { mkdir, writeFile } = require('node:fs/promises');
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
  'docs/evidence/day-20',
);
const projectRoot = 'D:\\项目\\Day 20 五镜头 M2 🐼.pandastage';
const alternateProjectRoot =
  'D:\\项目\\Day 20 空镜头切换 🐼.pandastage';

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

async function captureSection(window, selector) {
  const payload = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Screenshot target was not found.');
    return {
      markup: element.outerHTML,
      styles: [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .map((rule) => rule.cssText)
        .join('\\n')
    };
  })()`);
  const evidenceWindow = new BrowserWindow({
    show: false,
    width: 1_800,
    height: 1_200,
    backgroundColor: '#080c0a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    const html = `<!doctype html><html><head><meta charset="UTF-8">` +
      `<style>${payload.styles}` +
      `.day20-evidence{width:125%;transform:scale(.8);` +
      `transform-origin:top left}</style></head>` +
      `<body><main class="app-shell"><div class="day20-evidence">` +
      `${payload.markup}</div></main></body></html>`;
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

async function openProject(window, root = projectRoot) {
  await setInput(window, '.recovery-open-row input', root);
  await window.webContents.executeJavaScript(`
    document.querySelector('.recovery-open-row button').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      "document.querySelector('.shot-manager') && " +
        "document.querySelector('.shot-manager-heading span')" +
        "?.textContent?.includes('修订 0')",
      'Day 20 project did not open.',
    ),
  );
}

async function assertStage2CComposition(window) {
  const defaultComposition = await window.webContents.executeJavaScript(`(() => ({
    leftWorkspace: document.querySelectorAll(
      '[data-testid="left-workspace-scroll"]'
    ).length,
    recentProjects: document.querySelectorAll(
      '[data-testid="recent-projects-panel"]'
    ).length,
    recentList: document.querySelectorAll(
      '[data-testid="recent-projects-list"]'
    ).length,
    recentPath: document.querySelectorAll(
      '[data-testid="recent-projects-path"]'
    ).length,
    recentActions: document.querySelectorAll(
      '[data-testid="recent-projects-actions"]'
    ).length,
    recentStatus: document.querySelectorAll(
      '[data-testid="recent-projects-status"]'
    ).length,
    resourceDock: document.querySelectorAll(
      '[data-testid="resource-activity-dock"]'
    ).length,
    canvasWorkspace: document.querySelectorAll(
      '[data-testid="canvas-workspace-scroll"]'
    ).length,
    canvasStage: document.querySelectorAll(
      '[data-testid="project-canvas-stage"]'
    ).length,
    canvasViewport: document.querySelectorAll(
      '[data-testid="project-canvas-viewport"]'
    ).length,
    logicalStage: document.querySelectorAll(
      '[data-testid="canvas-logical-stage"]'
    ).length,
    historyControls: document.querySelectorAll(
      '[data-testid="history-controls"]'
    ).length,
    shotManager: document.querySelectorAll(
      '[data-testid="shot-manager"]'
    ).length,
    assetLibrary: document.querySelectorAll(
      '[data-testid="asset-library"]'
    ).length,
    characterManager: document.querySelectorAll(
      '[data-testid="character-manager"]'
    ).length,
    legacyWorkspace: document.querySelectorAll(
      '[data-testid="legacy-workspace-scroll"]'
    ).length,
    actionPresetPanel: document.querySelectorAll(
      '[data-testid="action-preset-panel"]'
    ).length
  }))()`);
  const expectedDefault = {
    leftWorkspace: 1,
    recentProjects: 1,
    recentList: 1,
    recentPath: 1,
    recentActions: 1,
    recentStatus: 1,
    resourceDock: 1,
    canvasWorkspace: 1,
    canvasStage: 1,
    canvasViewport: 1,
    logicalStage: 1,
    historyControls: 1,
    shotManager: 1,
    assetLibrary: 0,
    characterManager: 0,
    legacyWorkspace: 0,
    actionPresetPanel: 0
  };
  if (JSON.stringify(defaultComposition) !== JSON.stringify(expectedDefault)) {
    throw new Error(
      `Stage 2-C default composition failed: ${JSON.stringify({
        expected: expectedDefault,
        actual: defaultComposition
      })}`
    );
  }

  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="legacy-compatibility-toggle"]').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('[data-testid="legacy-workspace-scroll"]') && ` +
        `document.querySelector('[data-testid="action-preset-panel"]')`,
      'Stage 2-C compatibility workspace did not mount.',
    ),
  );
  const compatibilityComposition =
    await window.webContents.executeJavaScript(`(() => ({
      canvasStage: document.querySelectorAll(
        '[data-testid="project-canvas-stage"]'
      ).length,
      historyControls: document.querySelectorAll(
        '[data-testid="history-controls"]'
      ).length,
      legacyWorkspace: document.querySelectorAll(
        '[data-testid="legacy-workspace-scroll"]'
      ).length,
      actionPresetPanel: document.querySelectorAll(
        '[data-testid="action-preset-panel"]'
      ).length
    }))()`);
  if (
    JSON.stringify(compatibilityComposition) !==
    JSON.stringify({
      canvasStage: 1,
      historyControls: 1,
      legacyWorkspace: 1,
      actionPresetPanel: 1
    })
  ) {
    throw new Error(
      `Stage 2-C compatibility composition failed: ${JSON.stringify(
        compatibilityComposition,
      )}`,
    );
  }

  await window.webContents.executeJavaScript(`
    document.querySelector('[data-testid="legacy-compatibility-toggle"]').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      `!document.querySelector('[data-testid="legacy-workspace-scroll"]') && ` +
        `!document.querySelector('[data-testid="action-preset-panel"]')`,
      'Stage 2-C compatibility workspace did not unmount.',
    ),
  );
}

async function createShot(window, name, durationMs, expectedCount) {
  await setInput(
    window,
    '.shot-create-form label:nth-of-type(1) input',
    name,
  );
  await setInput(
    window,
    '.shot-create-form label:nth-of-type(2) input',
    durationMs,
  );
  await window.webContents.executeJavaScript(`
    document.querySelector('.shot-create-form button').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelectorAll('.shot-list-item').length === ${expectedCount} && ` +
        `document.querySelector('.shot-editor-heading h3')?.textContent?.trim() === ${JSON.stringify(name)}`,
      `Could not create ${name}.`,
    ),
  );
}

async function selectShot(window, name) {
  await window.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.shot-list-item')]
      .find((candidate) =>
        candidate.querySelector('strong')?.textContent?.trim() ===
          ${JSON.stringify(name)}
      );
    if (!item) throw new Error('Shot not found: ${name}');
    item.querySelector('button').click();
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelector('.shot-editor-heading h3')?.textContent?.trim() === ${JSON.stringify(name)}`,
      `Could not select ${name}.`,
    ),
  );
}

async function dragShot(window, sourceName, targetIndex) {
  await window.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('.shot-list-item')];
    const source = items.find((candidate) =>
      candidate.querySelector('strong')?.textContent?.trim() ===
        ${JSON.stringify(sourceName)}
    );
    const target = items[${targetIndex}];
    if (!source || !target) throw new Error('Drag endpoints not found.');
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }));
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }));
  })()`);
  await window.webContents.executeJavaScript(
    waitFor(
      `document.querySelectorAll('.shot-list-item')[${targetIndex}]` +
        `?.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(sourceName)}`,
      `Could not drag ${sourceName} to ${targetIndex}.`,
    ),
  );
}

function shotEntityIds(shot) {
  return [
    shot.id,
    ...shot.layers.map((layer) => layer.id),
    ...shot.audioClips.map((clip) => clip.id),
    ...shot.dialogues.map((dialogue) => dialogue.id),
    ...shot.timelineEvents.map((event) => event.id),
  ];
}

async function verifyDay20() {
  const initialProject = {
    ...exampleProject,
    schemaVersion: 5,
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
  const alternateProject = {
    ...initialProject,
    id: 'd2070000-0000-4000-8000-000000000001',
    name: 'Day 20 empty switch project',
    shots: [],
  };
  let savedProject = null;
  let saveRequest = null;
  let openCount = 0;
  const autosaveUpdates = [];

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    openCount += 1;
    const openingAlternate =
      request.projectRoot === alternateProjectRoot;
    const openedRoot = openingAlternate
      ? alternateProjectRoot
      : projectRoot;
    return {
      ok: true,
      value: {
        projectRoot: openedRoot,
        projectFilePath: `${openedRoot}\\project.json`,
        project: openingAlternate
          ? alternateProject
          : savedProject ?? initialProject,
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
        projectRoot,
        projectFilePath: `${projectRoot}\\project.json`,
        project: savedProject,
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
    entries: [{
      projectId: initialProject.id,
      projectName: initialProject.name,
      projectRoot,
      lastOpenedAt: '2026-08-03T00:00:00.000Z',
      status: 'available'
    }],
  }));
  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    (_event, request) => ({
      ok: true,
      status: 'missing',
      assetId: request.assetId,
    }),
  );

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1_050);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-open-row input')",
        'StartScreen did not render.',
      ),
    );
    await openProject(window);
    await assertStage2CComposition(window);

    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 150))',
    );
    const noOpBefore =
      await window.webContents.executeJavaScript(`(() => ({
        names: [...document.querySelectorAll('.shot-list-item strong')]
          .map((node) => node.textContent.trim()),
        revisionText: document.querySelector(
          '.shot-manager-heading span'
        ).textContent.trim(),
        saveDisabled: document.querySelector(
          '.editor-save-button'
        ).disabled
      }))()`);
    const noOpAutosaveBefore = autosaveUpdates.length;
    await dragShot(window, 'Opening', 0);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.shot-manager-status')" +
          "?.textContent?.includes('位置未变化')",
        'No-op drag did not report an unchanged position.',
      ),
    );
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(resolve, 150))',
    );
    const noOpAfter =
      await window.webContents.executeJavaScript(`(() => ({
        names: [...document.querySelectorAll('.shot-list-item strong')]
          .map((node) => node.textContent.trim()),
        revisionText: document.querySelector(
          '.shot-manager-heading span'
        ).textContent.trim(),
        saveDisabled: document.querySelector(
          '.editor-save-button'
        ).disabled,
        status: document.querySelector(
          '.shot-manager-status'
        ).textContent.trim()
      }))()`);
    const noOpMove = {
      before: noOpBefore,
      after: noOpAfter,
      autosaveUpdateDelta:
        autosaveUpdates.length - noOpAutosaveBefore,
    };

    const failedCreateCountBefore =
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.shot-list-item').length",
      );
    await setInput(
      window,
      '.shot-create-form label:nth-of-type(1) input',
      'Rejected draft',
    );
    await setInput(
      window,
      '.shot-create-form label:nth-of-type(2) input',
      499,
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.shot-create-form button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.shot-manager-status')" +
          "?.textContent?.includes('不少于 500ms')",
        'Failed shot creation did not show a clear error.',
      ),
    );
    const failedCreate =
      await window.webContents.executeJavaScript(`(() => ({
        shotCountBefore: ${failedCreateCountBefore},
        shotCountAfter:
          document.querySelectorAll('.shot-list-item').length,
        name: document.querySelector(
          '.shot-create-form label:nth-of-type(1) input'
        ).value,
        durationMs: Number(document.querySelector(
          '.shot-create-form label:nth-of-type(2) input'
        ).value),
        status: document.querySelector(
          '.shot-manager-status'
        ).textContent.trim()
      }))()`);

    await window.webContents.executeJavaScript(`
      document.querySelector('.shot-editor-actions button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.shot-list-item').length === 2 && " +
          "document.querySelector('.shot-editor-heading h3')" +
          "?.textContent?.trim() === 'Opening 副本'",
        'Populated shot was not duplicated.',
      )
    );
    await setInput(
      window,
      '.shot-fields label:nth-of-type(1) input',
      'Bridge',
    );
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '.shot-fields label:nth-of-type(1) button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.shot-editor-heading h3')" +
          "?.textContent?.trim() === 'Bridge'",
        'Duplicated shot was not renamed.',
      ),
    );
    await setInput(
      window,
      '.shot-fields label:nth-of-type(2) input',
      3_500,
    );
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '.shot-fields label:nth-of-type(2) button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.shot-editor-body input[type=number]')" +
          "?.value === '3500' && " +
          "document.querySelector('.shot-manager-status')" +
          "?.textContent?.includes('3500ms')",
        'Duplicated shot duration was not updated.',
      ),
    );

    await createShot(window, 'Scene 3', 1_000, 3);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector(" +
          "'.shot-create-form label:nth-of-type(1) input'" +
          ")?.value === '镜头 4'",
        'Successful create did not advance to an available default name.',
      ),
    );
    const successfulCreate =
      await window.webContents.executeJavaScript(`(() => ({
        shotCount: document.querySelectorAll('.shot-list-item').length,
        selectedName: document.querySelector(
          '.shot-editor-heading h3'
        ).textContent.trim(),
        nextDefaultName: document.querySelector(
          '.shot-create-form label:nth-of-type(1) input'
        ).value
      }))()`);
    await createShot(window, 'Scene 4', 1_500, 4);
    await createShot(window, 'Scene 5', 2_000, 5);

    await selectShot(window, 'Scene 3');
    await setInput(
      window,
      '.shot-fields label:nth-of-type(2) input',
      499,
    );
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '.shot-fields label:nth-of-type(2) button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.shot-manager-status')" +
          "?.textContent?.includes('不少于 500ms')",
        'Invalid duration did not produce a clear error.',
      ),
    );
    const invalidDurationStatus =
      await window.webContents.executeJavaScript(`
        document.querySelector('.shot-manager-status').textContent.trim()
      `);

    await selectShot(window, 'Scene 5');
    await dragShot(window, 'Scene 5', 0);
    await window.webContents.executeJavaScript(`
      window.confirm = () => true;
      document.querySelector(
        '.shot-editor-actions .shot-delete-button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.shot-list-item').length === 4 && " +
          "document.querySelector('.shot-editor-heading h3')" +
          "?.textContent?.trim() === 'Opening'",
        'Removing the selected shot did not choose the next stable shot.',
      ),
    );
    const selectionAfterRemoval =
      await window.webContents.executeJavaScript(`
        document.querySelector('.shot-editor-heading h3').textContent.trim()
      `);

    await createShot(window, 'Finale', 2_500, 5);
    await dragShot(window, 'Finale', 0);

    const configuredUi =
      await window.webContents.executeJavaScript(`(() => ({
        names: [...document.querySelectorAll('.shot-list-item strong')]
          .map((node) => node.textContent.trim()),
        durations: [...document.querySelectorAll(
          '.shot-list-item > button > span:nth-child(2) small'
        )].map((node) => Number.parseInt(node.textContent, 10)),
        currentName: document.querySelector(
          '.shot-editor-heading h3'
        ).textContent.trim(),
        currentShotId: document.querySelector(
          '.shot-editor'
        ).dataset.currentShotId,
        totalDurationMs: Number(
          document.querySelector(
            '.shot-manager-heading span'
          ).dataset.projectDurationMs
        ),
        placeholderCount: document.querySelectorAll(
          '.shot-thumbnail-placeholder'
        ).length,
        revisionText: document.querySelector(
          '.shot-manager-heading span'
        ).textContent.replace(/\\s+/g, ' ').trim(),
        rendererHasNodeRequire: typeof window.require !== 'undefined',
        hasCanvasEditor: Boolean(document.querySelector(
          '.canvas-editor, .timeline-editor, .transition-editor'
        )),
        resourceOwner: Boolean(document.querySelector(
          '.shot-manager'
        )?.closest('[data-testid="left-workspace-scroll"]')),
        legacyResourceOwner: Boolean(document.querySelector(
          '.shot-manager'
        )?.closest('[data-testid="legacy-workspace-scroll"]'))
      }))()`);
    const configuredScreenshot =
      await captureSection(window, '.shot-manager');

    await window.webContents.executeJavaScript(`
      document.querySelector('.editor-save-button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.recovery-status-row output')" +
          "?.textContent?.includes('项目已保存')",
        'Five-shot project did not save.',
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
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.shot-list-item').length === 5 && " +
          "document.querySelector('.shot-list-item strong')" +
          "?.textContent?.trim() === 'Finale'",
        'Saved shot order did not reopen.',
      ),
    );
    const reopenedUi =
      await window.webContents.executeJavaScript(`(() => ({
        names: [...document.querySelectorAll('.shot-list-item strong')]
          .map((node) => node.textContent.trim()),
        durations: [...document.querySelectorAll(
          '.shot-list-item > button > span:nth-child(2) small'
        )].map((node) => Number.parseInt(node.textContent, 10)),
        currentName: document.querySelector(
          '.shot-editor-heading h3'
        ).textContent.trim(),
        totalDurationMs: Number(
          document.querySelector(
            '.shot-manager-heading span'
          ).dataset.projectDurationMs
        ),
        clean: document.querySelector('.clean-state')
          ?.textContent?.trim() === '暂无未保存更改'
      }))()`);
    const reopenedScreenshot =
      await captureSection(window, '.shot-manager');

    await setInput(
      window,
      '.shot-create-form label:nth-of-type(1) input',
      '旧项目手工草稿',
    );
    await openProject(window, alternateProjectRoot);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.shot-list-item').length === 0 && " +
          "document.querySelector(" +
          "'.shot-create-form label:nth-of-type(1) input'" +
          ")?.value === '镜头 1'",
        'Project switch retained the previous project draft name.',
      ),
    );
    const projectSwitch =
      await window.webContents.executeJavaScript(`(() => ({
        previousDraft: '旧项目手工草稿',
        openedProjectId: ${JSON.stringify(alternateProject.id)},
        shotCount: document.querySelectorAll('.shot-list-item').length,
        defaultName: document.querySelector(
          '.shot-create-form label:nth-of-type(1) input'
        ).value,
        durationMs: Number(document.querySelector(
          '.shot-create-form label:nth-of-type(2) input'
        ).value)
      }))()`);

    const source = savedProject.shots.find(
      (shot) => shot.name === 'Opening',
    );
    const copy = savedProject.shots.find((shot) => shot.name === 'Bridge');
    const sourceIds = shotEntityIds(source);
    const copyIds = shotEntityIds(copy);
    const evidence = {
      day: 20,
      workOrder: 'B-20/45',
      gate: 'M2 Assets, Characters and Shots',
      result: 'PASS',
      branch: 'feat/day-20-shot-management',
      baselineSha: 'c5c94beeacb7a458d9bca33acdc9766e041b3cb5',
      executedAt: new Date().toISOString(),
      configuredUi,
      noOpMove,
      failedCreate,
      successfulCreate,
      projectSwitch,
      invalidDuration: {
        attemptedMs: 499,
        rejected: true,
        status: invalidDurationStatus,
      },
      selectionAfterRemoval,
      copyIdSafety: {
        sourceShotId: source.id,
        copyShotId: copy.id,
        sourceEntityIds: sourceIds,
        copyEntityIds: copyIds,
        allIdsDifferent: copyIds.every((id) => !sourceIds.includes(id)),
        timelineLayerReferencesRemapped: copy.timelineEvents.every(
          (event) => copy.layers.some((layer) => layer.id === event.layerId),
        ),
        dialogueAudioReferencesRemapped: copy.dialogues.every(
          (dialogue) =>
            copy.audioClips.some(
              (clip) => clip.id === dialogue.audioClipId,
            ),
        ),
      },
      persistence: {
        openCount,
        saveRevision: saveRequest?.revision,
        autosaveUpdateCount: autosaveUpdates.length,
        savedNames: savedProject.shots.map((shot) => shot.name),
        savedDurations: savedProject.shots.map((shot) => shot.durationMs),
        savedTotalDurationMs: savedProject.shots.reduce(
          (total, shot) => total + shot.durationMs,
          0,
        ),
        savedShotIds: savedProject.shots.map((shot) => shot.id),
        uniqueShotIds:
          new Set(savedProject.shots.map((shot) => shot.id)).size === 5,
        containsCurrentShot:
          JSON.stringify(savedProject).includes('currentShot'),
        reopenedUi,
      },
      inheritedM2Evidence: {
        assetImport: 'docs/test-receipts/DAY-16.md',
        assetMetadata: 'docs/test-receipts/DAY-17.md',
        assetLibraryAndReferences: 'docs/test-receipts/DAY-18.md',
        characters: 'docs/test-receipts/DAY-19.md',
      },
      automatedEvidence: {
        service: 'tests/unit/shot-service.test.ts',
        store: 'tests/unit/shot-store.test.ts',
        components: 'tests/unit/shot-components.test.ts',
        durationSelector: 'tests/unit/project-duration.test.ts',
        saveReopen: 'tests/integration/shot-lifecycle.test.ts',
      },
      screenshots: [
        'docs/evidence/day-20/shots-configured.png',
        'docs/evidence/day-20/shots-reopened.png',
      ],
    };

    const expectedNames = [
      'Finale',
      'Opening',
      'Bridge',
      'Scene 3',
      'Scene 4',
    ];
    const expectedDurations = [2_500, 3_000, 3_500, 1_000, 1_500];
    if (
      configuredUi.names.join(',') !== expectedNames.join(',') ||
      configuredUi.durations.join(',') !== expectedDurations.join(',') ||
      configuredUi.currentName !== 'Finale' ||
      configuredUi.totalDurationMs !== 11_500 ||
      configuredUi.placeholderCount < 6 ||
      !configuredUi.resourceOwner ||
      configuredUi.legacyResourceOwner ||
      configuredUi.rendererHasNodeRequire ||
      configuredUi.hasCanvasEditor ||
      noOpMove.before.names.join(',') !==
        noOpMove.after.names.join(',') ||
      noOpMove.before.revisionText !==
        noOpMove.after.revisionText ||
      !noOpMove.before.saveDisabled ||
      !noOpMove.after.saveDisabled ||
      noOpMove.autosaveUpdateDelta !== 0 ||
      failedCreate.shotCountBefore !==
        failedCreate.shotCountAfter ||
      failedCreate.name !== 'Rejected draft' ||
      failedCreate.durationMs !== 499 ||
      !failedCreate.status.includes('不少于 500ms') ||
      successfulCreate.shotCount !== 3 ||
      successfulCreate.selectedName !== 'Scene 3' ||
      successfulCreate.nextDefaultName !== '镜头 4' ||
      projectSwitch.openedProjectId !== alternateProject.id ||
      projectSwitch.shotCount !== 0 ||
      projectSwitch.defaultName !== '镜头 1' ||
      projectSwitch.durationMs !== 3_000 ||
      selectionAfterRemoval !== 'Opening' ||
      saveRequest?.revision !== 10 ||
      !evidence.copyIdSafety.allIdsDifferent ||
      !evidence.copyIdSafety.timelineLayerReferencesRemapped ||
      !evidence.copyIdSafety.dialogueAudioReferencesRemapped ||
      evidence.persistence.savedNames.join(',') !==
        expectedNames.join(',') ||
      evidence.persistence.savedDurations.join(',') !==
        expectedDurations.join(',') ||
      evidence.persistence.savedTotalDurationMs !== 11_500 ||
      !evidence.persistence.uniqueShotIds ||
      evidence.persistence.containsCurrentShot ||
      reopenedUi.names.join(',') !== expectedNames.join(',') ||
      reopenedUi.durations.join(',') !== expectedDurations.join(',') ||
      reopenedUi.currentName !== 'Finale' ||
      reopenedUi.totalDurationMs !== 11_500 ||
      !reopenedUi.clean
    ) {
      throw new Error(
        `Day 20 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'shots-configured.png'),
        configuredScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'shots-reopened.png'),
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
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay20)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
