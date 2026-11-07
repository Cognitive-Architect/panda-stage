const { app, BrowserWindow, dialog } = require('electron');
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { ShotService } = require('../dist-electron/domain/services/ShotService.js');

process.env.VITE_DEV_SERVER_URL = '';

const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue860-ui01';
const initialShotCount = Number(process.env.PANDA_ISSUE860_INITIAL_SHOTS ?? 0);
if (![0, 2].includes(initialShotCount)) {
  throw new Error('PANDA_ISSUE860_INITIAL_SHOTS must be 0 or 2.');
}
const scenarioName = initialShotCount === 0 ? 'empty-project' : 'multi-shot-project';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `${scenarioName}-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const projectRoot = path.join(runRoot, `${scenarioName}.pandastage`);
const userDataRoot = path.join(runRoot, 'electron-user-data');
const receiptPath = path.join(runRoot, 'issue860-ui01-receipt.json');
let windowRef = null;

function configureElectronPaths() {
  for (const [name, directory] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron path keys are immutable after readiness.
    }
  }
}

mkdirSync(runRoot, { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });
configureElectronPaths();
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
require('../dist-electron/main/index.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserWait(expression, message, timeout = 25_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(browserWait(expression, message, timeout));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
}

async function setSceneDraftText(window, value) {
  await window.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('[data-testid="scene-creation-input"]');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('The Auto Scene input is missing.');
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(value)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function capture(window, fileName) {
  await delay(250);
  const image = await window.webContents.capturePage();
  const filePath = path.join(evidenceRoot, fileName);
  writeFileSync(filePath, image.toPNG());
  return path.relative(runRoot, filePath).replaceAll('\\', '/');
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed(),
    );
    if (window) {
      window.webContents.on('console-message', (...details) => {
        console.error('[issue860 renderer console]', ...details.slice(1));
      });
      window.webContents.on('render-process-gone', (_event, details) => {
        console.error('[issue860 renderer process gone]', details);
      });
      return window;
    }
    await delay(50);
  }
  throw new Error('The Electron main window did not open.');
}

async function createSampleProject() {
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, {
    name: `Issue 860 UI01 ${scenarioName}`,
  });
  let project = created.project;
  const shotService = new ShotService();
  for (let index = 0; index < initialShotCount; index += 1) {
    project = shotService.create(project, {
      name: `已有镜头 ${index + 1}`,
      durationMs: 3_000,
    });
  }
  if (initialShotCount > 0) {
    await projectService.save(projectRoot, project);
  }
  return project;
}

async function openQuickActions(window) {
  await window.webContents.executeJavaScript(
    "(() => { const drawer = document.querySelector('[data-testid=\"quick-action-drawer\"]'); if (drawer?.dataset.expanded !== 'true') drawer?.querySelector('[data-testid=\"quick-action-drawer-handle\"]')?.click(); })()",
  );
  await waitForDom(
    window,
    "document.querySelector('[data-testid=\"quick-action-drawer\"]')?.dataset.expanded === 'true'",
    'The Quick Action Drawer did not open.',
  );
}

async function saveCurrentProject(window) {
  await openQuickActions(window);
  const needsSave = await window.webContents.executeJavaScript(
    "document.querySelector('[data-testid=\"quick-action-save\"]')?.disabled === false",
  );
  if (!needsSave) return;
  await click(window, '[data-testid="quick-action-save"]');
  await waitForDom(
    window,
    "document.querySelector('[data-testid=\"quick-action-drawer\"]')?.dataset.saveState === 'saved'",
    'The Project did not finish saving before the project switch.',
  );
}

async function openProjectCenter(window) {
  await openQuickActions(window);
  await click(window, '[data-testid="quick-action-home"]');
  await waitForDom(
    window,
    "document.querySelector('[data-editor-page=\"project-center\"]')",
    'Project Center did not open from the Quick Action Drawer.',
  );
}

async function openProject(window, targetProjectRoot = projectRoot) {
  const nextProjectRoot = targetProjectRoot;
  if (await window.webContents.executeJavaScript(
    "Boolean(document.querySelector('[data-editor-page=\"editor\"]'))",
  )) {
    await openProjectCenter(window);
  }
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its open-project input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(nextProjectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="editor-layout"]')`,
    'The synthetic project did not open in the editor.',
  );
  await openShotsWorkspace(window);
}

async function openShotsWorkspace(window) {
  await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    if (dock?.dataset.activeActivity !== 'shots' || dock?.dataset.resourceDrawerOpen !== 'true') {
      const button = document.querySelector('[data-testid="resource-activity-rail-shots"]')
        ?? document.querySelector('[data-testid="resource-activity-tabs"] [data-activity="shots"]');
      button?.click();
    }
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="shot-manager"]')`,
    'The Shots workspace did not open.',
  );
}

async function readShotState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.editor-shell');
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const manager = document.querySelector('[data-testid="shot-manager"]');
    const summary = manager?.querySelector('[data-project-duration-ms]')?.textContent ?? '';
    const primary = document.querySelector('[data-testid="resource-primary-action"]');
    return {
      deviceMode: shell?.dataset.editorDeviceMode ?? null,
      layout: shell?.dataset.editorShellLayout ?? null,
      activity: dock?.dataset.activeActivity ?? null,
      drawerOpen: dock?.dataset.resourceDrawerOpen ?? null,
      shotView: dock?.dataset.resourceShotView ?? null,
      shotCount: Number(summary.split('个镜头')[0]?.trim() ?? NaN),
      revision: Number(manager?.querySelector('[data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
      primaryLabel: primary?.textContent?.trim() ?? null,
      leftAutoSceneEntry: Boolean(document.querySelector('[data-testid="resource-auto-scene-action"]')),
      leftAutoSceneAction: Boolean(document.querySelector('[data-resource-action="shots-auto-scene"]')),
      manualCreate: Boolean(document.querySelector('[data-resource-action="shots-新建镜头"]')),
    };
  })()`);
}

async function readToolsState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="project-tools-drawer"]');
    const panel = document.querySelector('[data-testid="scene-creation-panel"]');
    return {
      surfaceOpen: document.querySelector('[data-testid="right-workspace"]')?.dataset.surfaceOpen ?? null,
      activeActivity: document.querySelector('[data-testid="right-workspace"]')?.dataset.activeActivity ?? null,
      view: drawer?.dataset.projectToolsView ?? null,
      homeEntries: {
        autoScene: Boolean(document.querySelector('[data-testid="project-tools-auto-scene"]')),
        autoSubtitles: Boolean(document.querySelector('[data-testid="project-tools-auto-subtitles"]')),
        actionPresets: Boolean(document.querySelector('[data-testid="project-tools-action-presets"]')),
        viewMode: Boolean(document.querySelector('[data-testid="project-tools-view-mode-card"]')),
      },
      panelPresent: Boolean(panel),
      panelCount: document.querySelectorAll('[data-testid="scene-creation-panel"]').length,
      textareaCount: document.querySelectorAll('[data-testid="scene-creation-input"]').length,
      canvasCount: document.querySelectorAll('.project-canvas').length,
      draft: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
      confirmDisabled: document.querySelector('[data-testid="scene-creation-confirm"]')?.disabled ?? null,
      backPresent: Boolean(document.querySelector('[data-testid="project-tools-auto-scene-back"]')),
      closePresent: Boolean(document.querySelector('[data-testid="project-tools-close"]')),
      headerText: document.querySelector('.project-tools-auto-scene-header')?.textContent?.trim() ?? null,
    };
  })()`);
}

async function openAutoScene(window) {
  await click(window, '[data-testid="right-activity-rail-tools"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-tools-home"]')`,
    'Project Tools did not open from the right rail.',
  );
  await click(window, '[data-testid="project-tools-auto-scene"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Auto Scene did not open inside Project Tools.',
  );
}

async function run() {
  await app.whenReady();
  const project = await createSampleProject();
  windowRef = await waitForMainWindow();
  windowRef.setSize(1600, 1050);
  windowRef.show();
  windowRef.focus();
  await openProject(windowRef);

  const shotState = await readShotState(windowRef);
  assert(shotState.layout === 'landscape', `Expected the landscape layout, got ${shotState.layout}.`);
  assert(shotState.activity === 'shots' && shotState.drawerOpen === 'true', 'The Shots drawer is not open.');
  assert(shotState.shotCount === project.shots.length, `Expected ${project.shots.length} Shots, got ${shotState.shotCount}.`);
  assert(shotState.primaryLabel === '新建镜头', `Unexpected manual entry: ${shotState.primaryLabel}.`);
  assert(shotState.manualCreate, 'The manual New Shot action is missing from the Shot list.');
  assert(!shotState.leftAutoSceneEntry, 'The retired left Auto Scene entry is still rendered.');
  assert(!shotState.leftAutoSceneAction, 'The retired shots-auto-scene action is still wired.');
  const shotListScreenshot = await capture(windowRef, 'landscape-shot-list-single-manual-entry.png');

  await click(windowRef, '[data-testid="right-activity-rail-tools"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="project-tools-home"]')`,
    'Project Tools home did not open.',
  );
  const homeState = await readToolsState(windowRef);
  assert(homeState.homeEntries.autoScene, 'Auto Scene is missing from the tools home.');
  assert(homeState.homeEntries.autoSubtitles, 'Auto Subtitles is missing from the tools home.');
  assert(homeState.homeEntries.actionPresets, 'Action Presets is missing from the tools home.');
  assert(homeState.homeEntries.viewMode, 'The canvas view modes are missing from the tools home.');
  const toolsHomeScreenshot = await capture(windowRef, 'tools-home-auto-scene-entry.png');

  await click(windowRef, '[data-testid="project-tools-auto-scene"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Auto Scene did not open inside Project Tools.',
  );
  const sceneState = await readToolsState(windowRef);
  assert(sceneState.activeActivity === 'tools', `Auto Scene left the tools drawer: ${sceneState.activeActivity}.`);
  assert(sceneState.view === 'auto-scene', `Unexpected tools view: ${sceneState.view}.`);
  assert(sceneState.panelCount === 1, 'Auto Scene rendered more than one panel.');
  assert(sceneState.textareaCount === 1, 'Auto Scene rendered a duplicate input.');
  assert(sceneState.backPresent && sceneState.closePresent, 'The single-row tool navigation is incomplete.');
  assert(sceneState.headerText?.includes('自动布景'), 'The Auto Scene header lost its title.');
  assert(sceneState.confirmDisabled === true, 'Create Shot must stay disabled without a draft.');
  assert(sceneState.canvasCount <= 1, 'Auto Scene must not build a second canvas.');
  const sceneScreenshot = await capture(windowRef, 'tools-auto-scene-panel.png');

  const draft = `镜头：布景入口示例\n背景：花园\n出场：张三`;
  await setSceneDraftText(windowRef, draft);
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-input"]')?.value.length > 0`,
    'The Auto Scene draft did not accept input.',
  );
  await delay(400);
  const afterDraftShotState = await readShotState(windowRef);
  assert(
    afterDraftShotState.shotCount === project.shots.length &&
      afterDraftShotState.revision === shotState.revision,
    `Typing a draft must not change Project state: ${JSON.stringify(afterDraftShotState)}.`,
  );

  await click(windowRef, '[data-testid="project-tools-auto-scene-back"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="project-tools-home"]')`,
    'The Auto Scene back control did not return to the tools home.',
  );
  const afterBackShotState = await readShotState(windowRef);
  assert(
    afterBackShotState.shotCount === project.shots.length &&
      afterBackShotState.revision === shotState.revision,
    'Leaving Auto Scene without confirming must not create a Shot.',
  );

  await click(windowRef, '[data-testid="project-tools-close"]');
  await waitForDom(
    windowRef,
    `!document.querySelector('[data-testid="project-tools-drawer"]') && !document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Closing the tools drawer left the Auto Scene surface mounted.',
  );
  await openAutoScene(windowRef);
  const reenteredState = await readToolsState(windowRef);
  assert(
    reenteredState.draft === draft,
    `The unconfirmed draft was not preserved for the same project: ${JSON.stringify(reenteredState.draft)}.`,
  );
  assert(reenteredState.confirmDisabled === true, 'Create Shot must stay disabled while no match is confirmed.');
  const reenteredScreenshot = await capture(windowRef, 'tools-auto-scene-draft-preserved.png');

  windowRef.setSize(800, 1_100);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'portrait'`,
    'The narrow Cloud Touch window did not select the portrait layout.',
  );
  const portraitState = await readShotState(windowRef);
  assert(portraitState.layout === 'portrait', `Expected portrait, got ${portraitState.layout}.`);
  assert(!portraitState.leftAutoSceneEntry, 'Portrait still renders the retired left Auto Scene entry.');
  assert(portraitState.manualCreate, 'Portrait lost the manual New Shot action.');
  const portraitScreenshot = await capture(windowRef, 'portrait-shot-list-single-manual-entry.png');

  windowRef.setSize(1600, 1050);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'landscape'`,
    'The window did not return to the landscape layout.',
  );
  await openShotsWorkspace(windowRef);
  await saveCurrentProject(windowRef);
  const finalShotState = await readShotState(windowRef);
  assert(
    finalShotState.shotCount === project.shots.length &&
      finalShotState.revision === shotState.revision,
    `The entry smoke changed Project state: ${JSON.stringify(finalShotState)}.`,
  );

  return {
    issue: 860,
    acceptance: 'UI01_ENTRY_AND_SCENE_INPUT',
    passed: true,
    codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    scope: 'Project Tools owns the single Auto Scene entry; the left Shot list keeps only the manual route.',
    syntheticProject: true,
    initialShotCount: project.shots.length,
    finalShotCount: finalShotState.shotCount,
    finalRevision: finalShotState.revision,
    shotState,
    homeState,
    sceneState,
    reenteredState,
    portraitState,
    screenshots: {
      shotList: shotListScreenshot,
      toolsHome: toolsHomeScreenshot,
      autoScene: sceneScreenshot,
      draftPreserved: reenteredScreenshot,
      portrait: portraitScreenshot,
    },
    notCovered: {
      liveMatchAndCanvasPreview: 'Covered by verify:issue853-scene-creation and verify:issue854-v0-acceptance.',
      crossProjectDraftIsolation: 'Not covered by this entry smoke.',
      portraitToolsDrawer: 'Project Tools is landscape-only, same as Auto Subtitles.',
    },
    sourceProjectPathsOmitted: true,
    humanAcceptance: false,
    receiptPath: '<isolated acceptance receipt>',
  };
}

async function main() {
  let output;
  try {
    await app.whenReady();
    output = await run();
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output = {
      issue: 860,
      acceptance: 'UI01_ENTRY_AND_SCENE_INPUT',
      passed: false,
      codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      humanAcceptance: false,
    };
    console.error(`[issue860] ${output.error}`);
    process.exitCode = 1;
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
}

main().finally(() => app.exit(process.exitCode ?? 0));
