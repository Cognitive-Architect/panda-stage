const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\project-center-v1';
const evidenceRoot = path.join(acceptanceRoot, 'evidence', 'task3');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-102/task3',
);
const projectARoot = path.join(
  acceptanceRoot,
  'projects-task3',
  'issue102-safety-a.pandastage',
);
const projectBRoot = path.join(
  acceptanceRoot,
  'projects-task3',
  'issue102-safety-b.pandastage',
);
const projectAId = 'a0200000-0000-4000-8000-000000000001';
const projectBId = 'b0200000-0000-4000-8000-000000000001';
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

rmSync(evidenceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

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
        // React may be between the Project Center and editor pages.
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
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
    ).set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function click(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    }
    element.click();
  })()`);
  await delay(140);
}

async function capture(window, fileName) {
  await delay(220);
  const image = (await window.webContents.capturePage()).toPNG();
  writeFileSync(path.join(evidenceRoot, fileName), image);
  writeFileSync(path.join(repositoryEvidenceRoot, fileName), image);
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.editor-shell');
    const bar = document.querySelector('[data-testid="compact-project-bar"]');
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const current = document.querySelector(
      '[data-testid="project-center-current-project"]',
    );
    return {
      page: shell?.dataset.editorPage ?? null,
      shellState: shell?.dataset.editorShellState ?? null,
      activeRoot: bar?.querySelector('[data-testid="active-project-path"] code')
        ?.textContent?.trim() ?? null,
      currentRoot: current?.querySelector('.project-center-current-path')
        ?.textContent?.trim() ?? null,
      currentName: current?.querySelector('h3')?.textContent?.trim() ?? null,
      currentDirty: Boolean(current?.querySelector('.dirty-state')),
      shotId: document.querySelector('.shot-list-item-selected')
        ?.getAttribute('data-shot-id') ?? null,
      selectedLayerId: stage?.dataset.selectedLayerId ?? null,
      revision: stage ? Number(stage.dataset.projectRevision) : null,
      undoCount: history ? Number(history.dataset.undoCount) : null,
      redoCount: history ? Number(history.dataset.redoCount) : null,
      dirty: Boolean(document.querySelector('.dirty-state')),
      saveStateCode: bar?.dataset.saveState ?? null,
      saveState: bar?.querySelector('[data-testid="project-save-state"]')
        ?.textContent?.trim() ?? null,
      closeDialogOpen: Boolean(
        document.querySelector('[data-testid="close-confirm-dialog"]'),
      ),
      closeDialogStatus: document.querySelector(
        '[data-testid="close-confirm-status"]',
      )?.textContent?.trim() ?? '',
      hasEditorLayout: Boolean(document.querySelector('[data-testid="editor-layout"]')),
    };
  })()`);
}

async function openProjectCenter(window) {
  await click(window, '[data-testid="open-project-center"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]')`,
    'Project Center did not open from the compact project bar.',
  );
}

async function returnToEditor(window, root) {
  await click(window, '[data-testid="return-to-editor"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(root)}`,
    'Returning from Project Center did not restore the active editor.',
  );
}

async function openProject(window, root) {
  if (await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('[data-editor-page="editor"]'))`,
  )) {
    await openProjectCenter(window);
  }
  await setInput(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row input',
    root,
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button')?.disabled === false`,
    'Project Center did not enable the requested project open action.',
  );
  await click(
    window,
    '[data-testid="project-center-screen"] .recovery-open-row button',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(root)}`,
    `Project did not become active: ${root}`,
  );
}

async function applyShotName(window, name) {
  await setInput(window, '.shot-fields label:nth-of-type(1) input', name);
  await click(window, '.shot-fields label:nth-of-type(1) button');
  await waitForDom(
    window,
    `Boolean(document.querySelector('[data-testid="project-canvas-stage"]')) &&
      Boolean(document.querySelector('.dirty-state')) &&
      Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision) > 0`,
    'The shot edit did not produce a dirty revision.',
  );
}

async function selectContentLayer(window) {
  try {
    await waitForDom(
      window,
      `(() => {
        const stage = document.querySelector('[data-testid="project-canvas-stage"]');
        const layer = stage && JSON.parse(stage.dataset.layerJson).find((candidate) => candidate.zIndex > 0);
        return Boolean(layer) &&
          JSON.parse(stage.dataset.renderedAssetIds ?? '[]').length > 1;
      })()`,
      'The editor canvas did not render the Task 3 layer fixture.',
    );
  } catch (error) {
    const debug = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      return {
        stage: Boolean(stage),
        layerJson: stage?.dataset.layerJson ?? null,
        renderedAssetIds: stage?.dataset.renderedAssetIds ?? null,
        assetRequests: window.__issue102Task3AssetRequests ?? null,
      };
    })()`);
    throw new Error(`${error.message} ${JSON.stringify(debug)}`);
  }
  let target = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    target = await window.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const layer = JSON.parse(stage.dataset.layerJson).find((candidate) => candidate.zIndex > 0);
      const logicalStage = document.querySelector('[data-testid="canvas-logical-stage"]');
      const rect = logicalStage.getBoundingClientRect();
      const scale = Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale);
      return {
        layerId: layer.id,
        x: Math.round(rect.left + layer.x * scale),
        y: Math.round(rect.top + layer.y * scale),
      };
    })()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      window.webContents.sendInputEvent({
        type,
        ...(type === 'mouseMove'
          ? {}
          : { button: 'left', clickCount: 1 }),
        x: target.x,
        y: target.y,
      });
    }
    try {
      await waitForDom(
        window,
        `document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId === ${JSON.stringify(target.layerId)}`,
        'The content layer could not be selected in the real Electron canvas.',
        2_000,
      );
      return target.layerId;
    } catch {
      await delay(250);
    }
  }
  const debug = await window.webContents.executeJavaScript(`(() => ({
    target: ${JSON.stringify(target)},
    selectedLayerId: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.selectedLayerId ?? null,
    renderedAssetIds: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.renderedAssetIds ?? null,
    viewport: document.querySelector('[data-testid="project-canvas-viewport"]')?.getBoundingClientRect().toJSON() ?? null,
    logicalStage: document.querySelector('[data-testid="canvas-logical-stage"]')?.getBoundingClientRect().toJSON() ?? null,
    displayScale: document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale ?? null,
  }))()`);
  throw new Error(`The content layer could not be selected in the real Electron canvas: ${JSON.stringify(debug)}`);
}

function documentFor(projectRoot, project) {
  return {
    projectRoot,
    projectFilePath: `${projectRoot}\\project.json`,
    project,
    migrated: false,
    sourceVersion: 1,
  };
}

function projectFixture(id, name) {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.id = id;
  project.name = name;
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image'
      ? { ...asset, sha256: 'a'.repeat(64) }
      : asset,
  );
  return project;
}

async function waitForMainWindow() {
  await app.whenReady();
  await createMainWindow({ show: false });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      return !candidate.webContents.getURL().includes('hidden.html');
    });
    if (window) {
      window.setContentSize(1280, 720);
      window.showInactive();
      await waitForDom(
        window,
        `document.querySelector('[data-testid="project-center-screen"]')`,
        'The real Electron Project Center did not render.',
      );
      return window;
    }
    await delay(40);
  }
  throw new Error('The real Electron main window did not become ready.');
}

async function run() {
  const projectA = projectFixture(projectAId, 'Issue 102 Safety Project A');
  const projectB = projectFixture(projectBId, 'Issue 102 Safety Project B');
  const projects = new Map([
    [projectARoot, projectA],
    [projectBRoot, projectB],
  ]);
  const guardOutcomes = [];
  const observedGuards = [];
  const guardRequests = [];
  const openRequests = [];
  const saveRequests = [];
  const stopRequests = [];
  let failOpenRoot = null;
  let failSave = false;
  const channels = [];
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    channels.push(channel);
  };

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    openRequests.push(request.projectRoot);
    if (request.projectRoot === failOpenRoot) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Injected Task 3 open failure.',
          projectRoot: request.projectRoot,
        },
      };
    }
    const project = projects.get(request.projectRoot);
    if (!project) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_NOT_FOUND',
          message: 'Unknown Task 3 project.',
          projectRoot: request.projectRoot,
        },
      };
    }
    return { ok: true, value: documentFor(request.projectRoot, project) };
  });
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [
      {
        projectId: projectA.id,
        projectName: projectA.name,
        projectRoot: projectARoot,
        lastOpenedAt: '2026-08-05T00:00:00.000Z',
        status: 'available',
      },
      {
        projectId: projectB.id,
        projectName: projectB.name,
        projectRoot: projectBRoot,
        lastOpenedAt: '2026-08-05T00:01:00.000Z',
        status: 'available',
      },
    ],
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const project = projects.get(request.projectRoot);
    return project
      ? { ok: true, document: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_RELOCATE_FAILED',
            message: 'Unknown Task 3 recent project.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequests.push(request);
    if (failSave) {
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: 'Injected Task 3 save failure.',
          projectRoot: request.projectRoot,
        },
      };
    }
    return { ok: true, value: documentFor(request.projectRoot, request.project) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, (_event, request) => {
    guardRequests.push(request);
    const outcome = guardOutcomes.shift() ?? 'cancelled';
    observedGuards.push(outcome);
    return { outcome };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, (_event, request) => {
    stopRequests.push(
      typeof request === 'string' ? request : request?.projectRoot ?? null,
    );
    return { ok: true };
  });
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({
    ok: true,
    retained: true,
  }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => ({
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    dataUrl: `data:image/png;base64,${probePng}`,
  }));

  const window = await waitForMainWindow();
  try {
    const result = {
      issue: 102,
      task: 3,
      window: { width: 1280, height: 720 },
      checks: [],
      snapshots: {},
      guardOutcomes: observedGuards,
      requests: {
        open: openRequests,
        save: saveRequests,
        stop: stopRequests,
      },
      screenshots: {
        roundtrip: path.join(evidenceRoot, 'task3-roundtrip-center.png'),
        switchCancel: path.join(evidenceRoot, 'task3-switch-cancel.png'),
        saveFailure: path.join(evidenceRoot, 'task3-save-failure.png'),
        closed: path.join(evidenceRoot, 'task3-closed-project-center.png'),
      },
    };

    await openProject(window, projectARoot);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="project-canvas-stage"]')`,
      'Project A editor did not render.',
    );
    const selectedLayerId = await selectContentLayer(window);
    await applyShotName(window, 'Task 3 roundtrip dirty shot');
    const beforeRoundtrip = await snapshot(window);
    assert(beforeRoundtrip.dirty, 'Project A did not become dirty for the roundtrip gate.');
    assert(beforeRoundtrip.revision > 0, 'Project A revision did not advance.');
    assert(beforeRoundtrip.undoCount > 0, 'Project A history did not record the edit.');
    assert(beforeRoundtrip.selectedLayerId === selectedLayerId, 'Layer selection was not established.');

    await openProjectCenter(window);
    const centerRoundtrip = await snapshot(window);
    assert(centerRoundtrip.shellState === 'editor', 'Entering Project Center cleared Project A.');
    assert(centerRoundtrip.currentRoot === projectARoot, 'Project Center lost Project A identity.');
    assert(centerRoundtrip.currentDirty, 'Project Center lost Project A dirty state.');
    await capture(window, 'task3-roundtrip-center.png');
    await returnToEditor(window, projectARoot);
    const afterRoundtrip = await snapshot(window);
    result.snapshots.roundtrip = {
      before: beforeRoundtrip,
      center: centerRoundtrip,
      after: afterRoundtrip,
    };
    assert(afterRoundtrip.shotId === beforeRoundtrip.shotId, 'Current shot changed across Project Center roundtrip.');
    assert(afterRoundtrip.selectedLayerId === beforeRoundtrip.selectedLayerId, 'Layer selection changed across Project Center roundtrip.');
    assert(afterRoundtrip.revision === beforeRoundtrip.revision, 'Revision changed across Project Center roundtrip.');
    assert(afterRoundtrip.undoCount === beforeRoundtrip.undoCount && afterRoundtrip.redoCount === beforeRoundtrip.redoCount, 'History changed across Project Center roundtrip.');
    result.checks.push('Project Center roundtrip preserves project, shot, layer selection, revision, and History');

    guardOutcomes.push('cancelled');
    await openProjectCenter(window);
    await setInput(window, '[data-testid="project-center-screen"] .recovery-open-row input', projectBRoot);
    await click(window, '[data-testid="project-center-screen"] .recovery-open-row button');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="project-center"]') &&
        document.querySelector('[data-testid="project-center-current-project"] .project-center-current-path')?.textContent?.trim() === ${JSON.stringify(projectARoot)} &&
        Boolean(document.querySelector('[data-testid="project-center-current-project"] .dirty-state'))`,
      'Canceling a dirty project switch did not keep Project A intact.',
    );
    result.snapshots.switchCancelled = await snapshot(window);
    await capture(window, 'task3-switch-cancel.png');
    assert(result.snapshots.switchCancelled.shellState === 'editor', 'Canceling switch changed shell state.');
    assert(result.snapshots.switchCancelled.currentRoot === projectARoot, 'Canceling switch lost Project A.');
    result.checks.push('Dirty Project A switch cancel keeps the current project and dirty state');

    guardOutcomes.push('discarded');
    await setInput(window, '[data-testid="project-center-screen"] .recovery-open-row input', projectBRoot);
    await click(window, '[data-testid="project-center-screen"] .recovery-open-row button');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]') &&
        document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(projectBRoot)}`,
      'Discarding Project A did not open Project B.',
    );
    result.snapshots.switchDiscarded = await snapshot(window);
    assert(!result.snapshots.switchDiscarded.dirty, 'Project B opened dirty after discard switch.');
    assert(result.snapshots.switchDiscarded.selectedLayerId !== selectedLayerId, 'Project A layer selection leaked into Project B.');
    result.checks.push('Dirty switch discard opens Project B with isolated editor selection');

    await applyShotName(window, 'Task 3 save branch');
    guardOutcomes.push('saved');
    await openProject(window, projectARoot);
    result.snapshots.switchSaved = await snapshot(window);
    assert(result.snapshots.switchSaved.activeRoot === projectARoot, 'Saving before switch did not open Project A.');
    assert(!result.snapshots.switchSaved.dirty, 'Project A was not clean after save-before-switch.');
    result.checks.push('Dirty switch save path saves the current revision before opening the next project');

    await applyShotName(window, 'Task 3 failed-open recovery');
    failOpenRoot = projectBRoot;
    await openProjectCenter(window);
    await setInput(window, '[data-testid="project-center-screen"] .recovery-open-row input', projectBRoot);
    await click(window, '[data-testid="project-center-screen"] .recovery-open-row button');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="project-center"]') &&
        document.querySelector('[data-testid="project-center-current-project"] .project-center-current-path')?.textContent?.trim() === ${JSON.stringify(projectARoot)} &&
        Boolean(document.querySelector('[data-testid="project-center-current-project"] .dirty-state'))`,
      'A failed Project B open cleared or replaced Project A.',
    );
    result.snapshots.failedOpen = await snapshot(window);
    assert(result.snapshots.failedOpen.currentName === projectA.name, 'Failed Project B open changed Project A identity.');
    result.checks.push('Failed Project B open leaves Project A complete and editable');
    failOpenRoot = null;
    await returnToEditor(window, projectARoot);

    await click(window, '[data-testid="compact-project-more"]');
    await click(window, '[data-testid="menu-close-project"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="close-confirm-dialog"]')`,
      'Dirty close did not open the in-app confirmation.',
    );
    const closePrompt = await snapshot(window);
    assert(closePrompt.closeDialogOpen && closePrompt.dirty, 'Dirty close confirmation did not preserve the current project.');
    await click(window, '[data-testid="close-confirm-cancel"]');
    await waitForDom(
      window,
      `!document.querySelector('[data-testid="close-confirm-dialog"]') &&
        document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(projectARoot)} &&
        Boolean(document.querySelector('.dirty-state'))`,
      'Canceling close did not keep Project A open.',
    );
    result.snapshots.closeCancelled = await snapshot(window);
    result.checks.push('Dirty close cancel keeps Project A open and dirty');

    failSave = true;
    await click(window, '[data-testid="compact-project-more"]');
    await click(window, '[data-testid="menu-close-project"]');
    await click(window, '[data-testid="close-confirm-save"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="close-confirm-dialog"]') &&
        document.querySelector('[data-testid="compact-project-bar"]')?.dataset.saveState === 'failed'`,
      'Failed close save did not retain the editor or expose the failed save state.',
    );
    result.snapshots.closeSaveFailed = await snapshot(window);
    await capture(window, 'task3-save-failure.png');
    assert(result.snapshots.closeSaveFailed.saveState !== '已保存', 'Failed save displayed 已保存.');
    assert(result.snapshots.closeSaveFailed.dirty, 'Failed save cleared dirty state.');
    result.checks.push('Failed close save keeps the project dirty and never presents 已保存');

    failSave = false;
    await click(window, '[data-testid="close-confirm-save"]');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="project-center"]') &&
        document.querySelector('.editor-shell')?.dataset.editorShellState === 'no-project' &&
        !document.querySelector('[data-testid="editor-layout"]')`,
      'Successful close did not return to a clean Project Center state.',
    );
    result.snapshots.closeSucceeded = await snapshot(window);
    await capture(window, 'task3-closed-project-center.png');
    assert(result.snapshots.closeSucceeded.currentRoot === null, 'Successful close left a current project card.');
    result.checks.push('Successful close returns to Project Center with editor state safely cleared');

    assert(
      observedGuards.join(',') === 'cancelled,discarded,saved',
      `Dirty switch choices were not all exercised: ${observedGuards.join(',')}`,
    );
    assert(
      guardRequests.every((request) => request.dirty === true),
      'Project switch confirmation received a non-dirty request.',
    );
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

async function main() {
  const output = {
    issue: 102,
    task: 3,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    error: null,
    evidenceRoot,
    repositoryEvidenceRoot,
  };
  try {
    Object.assign(output, await run(), { passed: true });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    writeFileSync(
      path.join(repositoryEvidenceRoot, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    app.quit();
    const exitCode = process.exitCode ?? (output.passed ? 0 : 1);
    setTimeout(() => process.exit(exitCode), 1_000);
  }
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');

app.on('window-all-closed', () => {});
void main();
