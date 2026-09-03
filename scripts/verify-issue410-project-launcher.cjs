#!/usr/bin/env node
/**
 * Issue #410 real Windows Electron acceptance for Project Launcher v1.
 *
 * The verifier drives the production renderer and Main/Preload project
 * lifecycle through an isolated Electron profile. Fixtures, screenshots, and
 * the JSON receipt are written below D:\\PandaStage-Acceptance only.
 */

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { execFileSync } = require('node:child_process');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} = require('node:fs');
const { join, relative, resolve } = require('node:path');

const STARTING_MAIN_HEAD =
  '861809002fc6d1ba30fc829dde0f2f07937ba3d3';
const DEFAULT_ACCEPTANCE_ROOT =
  'D:\\PandaStage-Acceptance\\issue410-project-launcher';
const FIXTURE_PROJECT_ID = {
  available: '11000000-0000-4000-8000-000000000001',
  missing: '11000000-0000-4000-8000-000000000002',
  mismatchStored: '11000000-0000-4000-8000-000000000003',
  mismatchActual: '11000000-0000-4000-8000-000000000004',
  invalid: '11000000-0000-4000-8000-000000000005',
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--acceptance-root') {
      args.acceptanceRoot = argv[++index];
    } else if (argv[index] === '--evidence-dir') {
      args.evidenceDir = argv[++index];
    } else if (argv[index] === '--user-data') {
      args.userData = argv[++index];
    }
  }
  return args;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertInsideAcceptanceRoot(candidate, acceptanceRoot, label) {
  const rootKey = resolve(acceptanceRoot).toLowerCase();
  const candidatePath = resolve(candidate);
  const candidateKey = candidatePath.toLowerCase();
  const relativePath = relative(rootKey, candidateKey);
  assert(
    relativePath === '' || (!relativePath.startsWith('..') && relativePath !== '..'),
    `${label} must remain below the acceptance root: ${candidatePath}`,
  );
}

function writeRecentConfig(userData, entries) {
  writeFileSync(
    join(userData, 'recent-projects.json'),
    `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
    'utf8',
  );
}

function recentEntry(projectRoot, projectId, projectName, ageMs) {
  return {
    projectId,
    projectName,
    projectRoot,
    lastOpenedAt: new Date(Date.now() - ageMs).toISOString(),
  };
}

function createProjectFixture(repositoryRoot, fixturesRoot, key, projectId, name) {
  const projectRoot = join(fixturesRoot, `${key}.pandastage`);
  const assetsRoot = join(projectRoot, 'assets');
  mkdirSync(assetsRoot, { recursive: true });
  const sourceAssetsRoot = join(repositoryRoot, 'demo-project', 'assets');
  for (const assetName of [
    'bamboo-background.png',
    'opening-dialogue.wav',
    'panda-happy.png',
    'panda-neutral.png',
  ]) {
    copyFileSync(join(sourceAssetsRoot, assetName), join(assetsRoot, assetName));
  }
  const project = JSON.parse(
    readFileSync(
      join(repositoryRoot, 'demo-project', 'project-v1.example.json'),
      'utf8',
    ),
  );
  project.id = projectId;
  project.name = name;
  writeFileSync(join(projectRoot, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  const oldTime = new Date(Date.now() - 120_000);
  utimesSync(join(projectRoot, 'project.json'), oldTime, oldTime);
  return { key, name, projectId, projectRoot };
}

function createInvalidFixture(fixturesRoot, key, projectId, name) {
  const projectRoot = join(fixturesRoot, `${key}.pandastage`);
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'project.json'), '{"invalid":', 'utf8');
  return { key, name, projectId, projectRoot };
}

function waitForMainWindow() {
  const deadline = Date.now() + 45_000;
  return (async () => {
    while (Date.now() < deadline) {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (candidate) =>
          !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
      );
      if (mainWindow) {
        try {
          const ready = await mainWindow.webContents.executeJavaScript(
            'Boolean(window.pandaStage?.project?.chooseDirectory && window.pandaStage?.recentProjects?.list && window.pandaStage?.recovery?.detect)',
          );
          if (ready) return mainWindow;
        } catch {
          // The renderer can still be loading its preload/React tree.
        }
      }
      await delay(100);
    }
    throw new Error('Panda Stage did not expose the production launcher APIs.');
  })();
}

async function evaluate(mainWindow, expression) {
  return mainWindow.webContents.executeJavaScript(expression);
}

async function waitForExpression(mainWindow, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(mainWindow, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`,
  );
}

async function click(mainWindow, selector) {
  const result = await evaluate(
    mainWindow,
    `(() => {
      try {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) return { ok: false, error: 'Missing clickable element: ' + ${JSON.stringify(selector)} };
        if (element instanceof HTMLButtonElement && element.disabled) return { ok: false, error: 'Clickable element is disabled: ' + ${JSON.stringify(selector)} };
        element.click();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })()`,
  );
  assert(result?.ok === true, result?.error || `Could not click ${selector}`);
}

async function clickRecentAction(mainWindow, projectName, actionSelector) {
  const result = await evaluate(
    mainWindow,
    `(() => {
      try {
        const row = [...document.querySelectorAll('li.recent-project-card')].find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(projectName)});
        if (!row) return { ok: false, error: 'Missing recent-project row: ' + ${JSON.stringify(projectName)} };
        const element = row.querySelector(${JSON.stringify(actionSelector)});
        if (!(element instanceof HTMLElement)) return { ok: false, error: 'Missing recent action ' + ${JSON.stringify(actionSelector)} + ' for ' + ${JSON.stringify(projectName)} };
        if (element instanceof HTMLButtonElement && element.disabled) return { ok: false, error: 'Recent action is disabled for ' + ${JSON.stringify(projectName)} };
        element.click();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })()`,
  );
  assert(result?.ok === true, result?.error || `Could not click recent action for ${projectName}`);
}

async function capture(mainWindow, evidenceDir, fileName) {
  // React route transitions are observable through executeJavaScript before
  // Chromium has necessarily presented the new compositor frame.
  await delay(350);
  const image = await mainWindow.capturePage();
  const outputPath = join(evidenceDir, fileName);
  writeFileSync(outputPath, image.toPNG());
  const size = image.getSize();
  return { path: outputPath, width: size.width, height: size.height };
}

async function launcherSnapshot(mainWindow) {
  return evaluate(
    mainWindow,
    `(() => {
      const panel = document.querySelector('[data-project-launcher-panel="true"]');
      const rows = [...document.querySelectorAll('li.recent-project-card')].map((row) => ({
        name: row.querySelector('strong')?.textContent?.trim() || '',
        status: row.dataset.projectStatus || '',
        text: row.textContent?.trim() || '',
        actions: [...row.querySelectorAll('button[data-task4-core]')].map((button) => button.dataset.task4Core || ''),
      }));
      const advanced = document.querySelector('[data-testid="launcher-advanced-open"]');
      const advancedInput = advanced?.querySelector('input');
      const advancedInputRect = advancedInput?.getBoundingClientRect();
      return {
        state: panel?.dataset.projectLauncherState || null,
        panelText: panel?.textContent?.trim() || '',
        recentPanelText: document.querySelector('[data-testid="recent-projects-panel"]')?.textContent?.trim() || '',
        currentName: document.querySelector('[data-testid="project-center-current-project"] h3')?.textContent?.trim() || null,
        saveStateClass: document.querySelector('[data-testid="project-center-save-state"]')?.className || null,
        saveStateText: document.querySelector('[data-testid="project-center-save-state"]')?.textContent?.trim() || null,
        visibleButtons: [...document.querySelectorAll('[data-testid="project-center-screen"] button')]
          .filter((button) => button.getClientRects().length > 0)
          .map((button) => ({ testId: button.dataset.testid || '', task: button.dataset.task4Core || '', text: button.textContent?.trim() || '' })),
        advancedOpen: advanced instanceof HTMLDetailsElement ? advanced.open : null,
        advancedInputVisible: Boolean(advanced instanceof HTMLDetailsElement && advanced.open && advancedInputRect && advancedInputRect.width > 0 && advancedInputRect.height > 0),
        rows,
      };
    })()`,
  );
}

async function editorSnapshot(mainWindow) {
  return evaluate(
    mainWindow,
    `(() => ({
      page: document.querySelector('.app-shell')?.dataset.editorPage || null,
      shellState: document.querySelector('.app-shell')?.dataset.editorShellState || null,
      projectRoot: document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() || null,
      saveState: document.querySelector('[data-testid="project-save-state"]')?.textContent?.trim() || null,
      editorLayout: Boolean(document.querySelector('[data-testid="editor-layout"]')),
    }))()`,
  );
}

async function openProjectCenter(mainWindow) {
  await click(mainWindow, '[data-testid="compact-project-more"]');
  await waitForExpression(
    mainWindow,
    'Boolean(document.querySelector("[data-testid=compact-project-menu]"))',
    'the editor project menu',
  );
  await click(mainWindow, '[data-testid="menu-open-project-center"]');
  await waitForExpression(
    mainWindow,
    'document.querySelector(".app-shell")?.dataset.editorPage === "project-center"',
    'Project Center page',
  );
}

async function closeCurrentProject(mainWindow) {
  await click(mainWindow, '[data-testid="compact-project-more"]');
  await waitForExpression(
    mainWindow,
    'Boolean(document.querySelector("[data-testid=compact-project-menu]"))',
    'the editor close menu',
  );
  await click(mainWindow, '[data-testid="menu-close-project"]');
  await waitForExpression(
    mainWindow,
    'document.querySelector(".app-shell")?.dataset.editorShellState === "no-project" && document.querySelector(".app-shell")?.dataset.editorPage === "project-center"',
    'closed Project Center state',
  );
  await delay(250);
}

function recoveryFilePath(projectRoot, projectId, savedAtMs) {
  return join(
    projectRoot,
    'recovery',
    `${projectId}.${savedAtMs}.recovery.json`,
  );
}

function writeRecovery(projectRoot, project, savedAtMs) {
  const filePath = recoveryFilePath(projectRoot, project.id, savedAtMs);
  mkdirSync(join(projectRoot, 'recovery'), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId: project.id,
        savedAtMs,
        project,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return filePath;
}

const startupArgs = parseArgs(process.argv.slice(1));
const startupAcceptanceRoot = resolve(
  startupArgs.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT,
);
const startupEvidenceDir = resolve(
  startupArgs.evidenceDir || join(startupAcceptanceRoot, `evidence-${Date.now()}`),
);
const startupUserData = resolve(
  startupArgs.userData || join(startupAcceptanceRoot, `electron-user-data-${Date.now()}`),
);
assertInsideAcceptanceRoot(startupEvidenceDir, startupAcceptanceRoot, 'Evidence directory');
assertInsideAcceptanceRoot(startupUserData, startupAcceptanceRoot, 'Electron user-data directory');
mkdirSync(startupAcceptanceRoot, { recursive: true });
mkdirSync(startupEvidenceDir, { recursive: true });
mkdirSync(startupUserData, { recursive: true });
app.setPath('userData', startupUserData);
process.env.VITE_DEV_SERVER_URL = '';

const repositoryRoot = resolve(__dirname, '..');
const fixturesRoot = join(startupAcceptanceRoot, `fixtures-${Date.now()}`);
mkdirSync(fixturesRoot, { recursive: true });
const fixtures = {
  available: createProjectFixture(
    repositoryRoot,
    fixturesRoot,
    'launcher-available',
    FIXTURE_PROJECT_ID.available,
    'Launcher Available',
  ),
  missing: {
    key: 'launcher-missing',
    name: 'Launcher Missing',
    projectId: FIXTURE_PROJECT_ID.missing,
    projectRoot: join(fixturesRoot, 'launcher-missing.pandastage'),
  },
  mismatch: createProjectFixture(
    repositoryRoot,
    fixturesRoot,
    'launcher-mismatch',
    FIXTURE_PROJECT_ID.mismatchActual,
    'Launcher Mismatch',
  ),
  invalid: createInvalidFixture(
    fixturesRoot,
    'launcher-invalid',
    FIXTURE_PROJECT_ID.invalid,
    'Launcher Invalid',
  ),
  missingRelocation: createProjectFixture(
    repositoryRoot,
    fixturesRoot,
    'launcher-missing-relocated',
    FIXTURE_PROJECT_ID.missing,
    'Launcher Missing Relocated',
  ),
  mismatchRelocation: createProjectFixture(
    repositoryRoot,
    fixturesRoot,
    'launcher-mismatch-relocated',
    FIXTURE_PROJECT_ID.mismatchStored,
    'Launcher Mismatch Relocated',
  ),
};

writeRecentConfig(startupUserData, []);

const chooserQueue = [];
const chooserRequests = [];
const originalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (...args) => {
  const options = args[1] && typeof args[1] === 'object' ? args[1] : {};
  chooserRequests.push({ title: String(options.title || '') });
  const nextRoot = chooserQueue.shift();
  if (nextRoot) return { canceled: false, filePaths: [nextRoot] };
  return { canceled: true, filePaths: [] };
};

const receipt = {
  issue: 410,
  startingMainHead: STARTING_MAIN_HEAD,
  finalHead: null,
  acceptanceRoot: startupAcceptanceRoot,
  evidenceDirectory: startupEvidenceDir,
  userDataDirectory: startupUserData,
  window: null,
  screenshots: {},
  checks: {},
  chooserRequests,
  projectSchemaChanged: false,
  rendererDirectFsAccessAdded: false,
  projectSessionOwnershipChanged: false,
  manualFullTriggered: false,
  manualMaintainerVerdict: 'pending',
};

let mainWindow = null;

async function run() {
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  require('../dist-electron/main/index.js');
  mainWindow = await waitForMainWindow();
  mainWindow.setSize(1280, 820);
  mainWindow.center();
  mainWindow.show();
  const ping = await evaluate(mainWindow, 'window.pandaStage.app.ping()');
  assert(ping?.message === 'pong', 'Panda Stage window did not respond to the production ping.');
  receipt.window = {
    title: mainWindow.getTitle(),
    respondingAtStart: true,
    size: mainWindow.getSize(),
  };

  await waitForExpression(
    mainWindow,
    'document.readyState === "complete" && document.querySelector("[data-project-launcher-panel=\\"true\\"]")?.dataset.projectLauncherState === "no-project"',
    'fresh no-project Launcher',
  );
  const phase2 = await launcherSnapshot(mainWindow);
  receipt.checks.phase2NoProject = phase2;
  receipt.screenshots.phase2NoProject = await capture(mainWindow, startupEvidenceDir, 'phase-2-no-project.png');
  assert(phase2.state === 'no-project', 'Phase 2 did not render the no-project Launcher state.');
  assert(phase2.currentName === null, 'Phase 2 rendered a fake current-project card.');
  assert(!phase2.panelText.includes('继续创作'), 'Phase 2 exposed Continue without a current session.');
  assert(phase2.visibleButtons.some((button) => button.testId === 'new-project-button'), 'Phase 2 did not expose New Project.');
  assert(phase2.visibleButtons.some((button) => button.testId === 'open-project'), 'Phase 2 did not expose Open Project.');
  assert(phase2.advancedOpen === false, 'Raw path entry is not demoted behind the closed advanced section.');
  assert(phase2.recentPanelText.includes('还没有最近项目'), 'Phase 2 empty recent copy is missing.');
  assert(phase2.recentPanelText.includes('新建或打开项目后，会显示在这里。'), 'Phase 2 empty recent supporting copy is missing.');

  await click(mainWindow, '[data-testid="new-project-button"]');
  await waitForExpression(mainWindow, 'Boolean(document.querySelector("[data-testid=new-project-dialog]"))', 'New Project dialog');
  receipt.checks.newProjectFlow = { dialogOpened: true };
  await click(mainWindow, '[data-testid="new-project-cancel"]');
  await waitForExpression(mainWindow, '!document.querySelector("[data-testid=new-project-dialog]")', 'New Project dialog cancellation');

  chooserQueue.push(fixtures.available.projectRoot);
  const chooserCountBeforeOpen = chooserRequests.length;
  await click(mainWindow, '[data-testid="open-project"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('.app-shell')?.dataset.editorPage === 'editor' && document.querySelector('[data-testid=active-project-path] code')?.textContent?.trim() === ${JSON.stringify(fixtures.available.projectRoot)}`,
    'primary native chooser project open',
  );
  assert(chooserRequests.length === chooserCountBeforeOpen + 1, 'Primary Open did not invoke the native/system chooser.');
  const firstEditor = await editorSnapshot(mainWindow);
  assert(firstEditor.shellState === 'editor' && firstEditor.editorLayout, 'Native chooser did not enter the editor session.');
  receipt.checks.openProjectChooser = {
    invoked: true,
    selectedRoot: firstEditor.projectRoot,
    chooserTitle: chooserRequests[chooserRequests.length - 1]?.title || '',
  };

  const beforeContinue = await editorSnapshot(mainWindow);
  await openProjectCenter(mainWindow);
  const phase1 = await launcherSnapshot(mainWindow);
  assert(phase1.state === 'current-project', 'Phase 1 did not render the current-project Launcher state.');
  assert(phase1.currentName === fixtures.available.name, 'Phase 1 current project name is not truthful.');
  assert(phase1.saveStateClass?.includes('clean-state'), 'Phase 1 clean save state is not truthful.');
  assert(phase1.visibleButtons.some((button) => button.testId === 'return-to-editor'), 'Phase 1 is missing Continue Creating.');
  assert(phase1.visibleButtons.some((button) => button.testId === 'new-project-button'), 'Phase 1 is missing New Project.');
  assert(phase1.visibleButtons.some((button) => button.testId === 'open-project'), 'Phase 1 is missing Open Project.');
  assert(phase1.advancedOpen === false, 'Phase 1 raw path entry remains visually dominant.');
  assert(!phase1.panelText.includes('当前项目仍保持打开'), 'Phase 1 contains duplicated always-on open-status copy.');
  receipt.checks.phase1CurrentProject = phase1;
  receipt.screenshots.phase1CurrentProject = await capture(mainWindow, startupEvidenceDir, 'phase-1-current-project.png');
  await click(mainWindow, '[data-testid="return-to-editor"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorPage === "editor" && Boolean(document.querySelector("[data-testid=editor-layout]"))', 'return to the same editor session');
  const afterContinue = await editorSnapshot(mainWindow);
  assert(afterContinue.projectRoot === beforeContinue.projectRoot, 'Continue changed project identity.');
  assert(afterContinue.saveState === beforeContinue.saveState, 'Continue changed the clean/dirty state.');
  assert(afterContinue.shellState === 'editor', 'Continue did not return to the editor.');
  receipt.checks.continueSameSession = { before: beforeContinue, after: afterContinue, identityUnchanged: true, dirtyStateUnchanged: true };

  await closeCurrentProject(mainWindow);
  writeRecentConfig(startupUserData, [
    recentEntry(fixtures.available.projectRoot, fixtures.available.projectId, fixtures.available.name, 1_000),
    recentEntry(fixtures.missing.projectRoot, fixtures.missing.projectId, fixtures.missing.name, 2_000),
    recentEntry(fixtures.mismatch.projectRoot, FIXTURE_PROJECT_ID.mismatchStored, fixtures.mismatch.name, 3_000),
    recentEntry(fixtures.invalid.projectRoot, fixtures.invalid.projectId, fixtures.invalid.name, 4_000),
  ]);
  // Opening the still-visible available row bumps the production refresh token;
  // closing it then renders the freshly seeded exception list through the real
  // RecentProjectsService IPC path.
  await clickRecentAction(mainWindow, fixtures.available.name, '[data-task4-core="recent-open"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorShellState === "editor"', 'available recent project open');
  await closeCurrentProject(mainWindow);
  await waitForExpression(mainWindow, 'document.querySelector("li.recent-project-card[data-project-status=missing]") && document.querySelector("li.recent-project-card[data-project-status=mismatched]") && document.querySelector("li.recent-project-card[data-project-status=invalid]")', 'recent exception rows');
  const phase3Exceptions = await launcherSnapshot(mainWindow);
  const missingRow = phase3Exceptions.rows.find((row) => row.name === fixtures.missing.name);
  const mismatchRow = phase3Exceptions.rows.find((row) => row.name === fixtures.mismatch.name);
  const invalidRow = phase3Exceptions.rows.find((row) => row.name === fixtures.invalid.name);
  assert(missingRow?.status === 'missing' && missingRow.actions.includes('recent-relocate'), 'Missing recent project lacks truthful Relocate.');
  assert(mismatchRow?.status === 'mismatched' && mismatchRow.actions.includes('recent-relocate'), 'Mismatched recent project lacks truthful Relocate.');
  assert(invalidRow?.status === 'invalid' && !invalidRow.actions.includes('recent-open') && !invalidRow.actions.includes('recent-relocate'), 'Invalid recent project exposed a fake Open/Retry path.');
  assert(phase3Exceptions.recentPanelText.includes('找不到项目'), 'Missing status copy is missing.');
  assert(phase3Exceptions.recentPanelText.includes('项目身份不匹配'), 'Mismatched status copy is missing.');
  assert(phase3Exceptions.recentPanelText.includes('项目文件无效'), 'Invalid status copy is missing.');
  receipt.checks.phase3RecentExceptions = phase3Exceptions;
  receipt.screenshots.phase3RecentExceptions = await capture(mainWindow, startupEvidenceDir, 'phase-3-recent-exceptions.png');
  await evaluate(mainWindow, '(() => { const scroller = document.querySelector(".project-center-screen"); if (scroller) scroller.scrollTop = scroller.scrollHeight; return true; })()');
  receipt.screenshots.phase3RecentExceptionsBottom = await capture(mainWindow, startupEvidenceDir, 'phase-3-recent-exceptions-bottom.png');
  await evaluate(mainWindow, '(() => { const scroller = document.querySelector(".project-center-screen"); if (scroller) scroller.scrollTop = 0; return true; })()');

  await clickRecentAction(mainWindow, fixtures.invalid.name, '[data-testid="recent-project-more"]');
  await waitForExpression(mainWindow, 'Boolean(document.querySelector("[data-testid=recent-project-maintenance-menu]"))', 'recent maintenance menu');
  const maintenanceCopy = await evaluate(mainWindow, 'document.querySelector("[data-testid=recent-project-maintenance-menu]")?.textContent?.trim() || ""');
  assert(maintenanceCopy.includes('不会删除磁盘上的项目'), 'Recent maintenance menu omitted disk-safety copy.');
  await click(mainWindow, '[data-testid="recent-project-maintenance-menu"] [data-task4-core="recent-remove"]');
  await waitForExpression(mainWindow, `![...document.querySelectorAll('li.recent-project-card')].some((row) => row.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fixtures.invalid.name)})`, 'record-only recent removal');
  assert(existsSync(join(fixtures.invalid.projectRoot, 'project.json')), 'Record removal deleted the project file from disk.');
  receipt.checks.removeRecordDiskSafety = { rowRemoved: true, invalidProjectFileStillExists: true };

  chooserQueue.push(fixtures.missingRelocation.projectRoot);
  await clickRecentAction(mainWindow, fixtures.missing.name, '[data-task4-core="recent-relocate"]');
  await waitForExpression(mainWindow, `document.querySelector('.app-shell')?.dataset.editorShellState === 'editor' && document.querySelector('[data-testid=active-project-path] code')?.textContent?.trim() === ${JSON.stringify(fixtures.missingRelocation.projectRoot)}`, 'missing-project relocation');
  receipt.checks.missingRelocate = { selectedRoot: fixtures.missingRelocation.projectRoot, identityPreserved: true };
  await closeCurrentProject(mainWindow);

  writeRecentConfig(startupUserData, [
    recentEntry(fixtures.available.projectRoot, fixtures.available.projectId, fixtures.available.name, 1_000),
    recentEntry(fixtures.mismatch.projectRoot, FIXTURE_PROJECT_ID.mismatchStored, fixtures.mismatch.name, 2_000),
  ]);
  await waitForExpression(mainWindow, `Boolean([...document.querySelectorAll('li.recent-project-card')].find((row) => row.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fixtures.mismatch.name)}))`, 'reloaded mismatch recent row');
  await clickRecentAction(mainWindow, fixtures.available.name, '[data-task4-core="recent-open"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorShellState === "editor"', 'refresh recent list before mismatch relocation');
  await closeCurrentProject(mainWindow);
  await waitForExpression(mainWindow, 'document.querySelector("li.recent-project-card[data-project-status=mismatched]")', 'mismatched recent row after refresh');
  chooserQueue.push(fixtures.available.projectRoot);
  await clickRecentAction(mainWindow, fixtures.mismatch.name, '[data-task4-core="recent-relocate"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorShellState === "no-project" && Boolean(document.querySelector("li.recent-project-card[data-project-status=mismatched]"))', 'identity-safe mismatch rejection', 10_000);
  await waitForExpression(mainWindow, `(() => { const row = [...document.querySelectorAll('li.recent-project-card')].find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(fixtures.mismatch.name)}); const button = row?.querySelector('[data-task4-core="recent-relocate"]'); return Boolean(button && !button.disabled); })()`, 'mismatch relocation action reset');
  const mismatchAfterWrongSelection = await launcherSnapshot(mainWindow);
  assert(mismatchAfterWrongSelection.state === 'no-project', 'Mismatched relocation opened a wrong-identity project.');
  assert(mismatchAfterWrongSelection.rows.some((row) => row.name === fixtures.mismatch.name && row.status === 'mismatched'), 'Mismatched row disappeared after wrong-identity selection.');
  chooserQueue.push(fixtures.mismatchRelocation.projectRoot);
  await clickRecentAction(mainWindow, fixtures.mismatch.name, '[data-task4-core="recent-relocate"]');
  await waitForExpression(mainWindow, `document.querySelector('.app-shell')?.dataset.editorShellState === 'editor' && document.querySelector('[data-testid=active-project-path] code')?.textContent?.trim() === ${JSON.stringify(fixtures.mismatchRelocation.projectRoot)}`, 'matching-identity mismatch relocation');
  receipt.checks.mismatchedRelocate = { wrongIdentityRejected: true, matchingIdentityOpened: true, selectedRoot: fixtures.mismatchRelocation.projectRoot };
  await closeCurrentProject(mainWindow);

  writeRecentConfig(startupUserData, [
    recentEntry(fixtures.available.projectRoot, fixtures.available.projectId, fixtures.available.name, 1_000),
  ]);
  await clickRecentAction(mainWindow, fixtures.available.name, '[data-task4-core="recent-open"]');
  await waitForExpression(mainWindow, `document.querySelector('.app-shell')?.dataset.editorShellState === 'editor' && document.querySelector('[data-testid=active-project-path] code')?.textContent?.trim() === ${JSON.stringify(fixtures.available.projectRoot)}`, 'available recent project proof');
  const canonicalResponse = await evaluate(mainWindow, `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(fixtures.available.projectRoot)} })`);
  assert(canonicalResponse?.ok === true, 'Could not obtain canonical project data for recovery fixture.');
  const canonicalProject = canonicalResponse.value.project;
  await closeCurrentProject(mainWindow);

  const recoveryA = writeRecovery(fixtures.available.projectRoot, canonicalProject, Date.now() + 10_000);
  await clickRecentAction(mainWindow, fixtures.available.name, '[data-task4-core="recent-open"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorShellState === "editor"', 'reopen with Recovery candidate');
  await openProjectCenter(mainWindow);
  await waitForExpression(mainWindow, 'Boolean(document.querySelector("[data-testid=recovery-candidate-banner]"))', 'localized Recovery notice');
  const recoveryPresentation = await launcherSnapshot(mainWindow);
  const recoveryDetails = await evaluate(mainWindow, 'document.querySelector("[data-testid=recovery-candidate-banner]")?.textContent?.trim() || ""');
  assert(recoveryDetails.includes('检测到未保存的恢复内容'), 'Recovery notice copy is missing.');
  receipt.checks.recoveryPresentation = { launcher: recoveryPresentation, detailsVisible: recoveryDetails.includes('查看详情') };
  receipt.screenshots.phase3Recovery = await capture(mainWindow, startupEvidenceDir, 'phase-3-recovery.png');
  await click(mainWindow, '[data-task4-core="recovery-ignore"]');
  await waitForExpression(mainWindow, '!document.querySelector("[data-testid=recovery-candidate-banner]")', 'Recovery Ignore');
  assert(existsSync(recoveryA), 'Recovery Ignore unexpectedly deleted the recovery file.');
  receipt.checks.recoveryIgnore = { bannerCleared: true, recoveryFileRetained: true };

  await click(mainWindow, '[data-testid="return-to-editor"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorPage === "editor"', 'return to editor after Recovery Ignore');
  await closeCurrentProject(mainWindow);
  const recoveredProject = { ...canonicalProject, name: 'Launcher Recovered' };
  const recoveryB = writeRecovery(fixtures.available.projectRoot, recoveredProject, Date.now() + 20_000);
  await clickRecentAction(mainWindow, fixtures.available.name, '[data-task4-core="recent-open"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorShellState === "editor"', 'reopen with second Recovery candidate');
  await openProjectCenter(mainWindow);
  await waitForExpression(mainWindow, 'Boolean(document.querySelector("[data-testid=recovery-candidate-banner]"))', 'second Recovery notice');
  await click(mainWindow, '[data-task4-core="recovery-restore"]');
  await waitForExpression(mainWindow, '!document.querySelector("[data-testid=recovery-candidate-banner]") && document.querySelector("[data-testid=project-center-save-state]")?.classList.contains("dirty-state")', 'Recovery Restore');
  const restoredLauncher = await launcherSnapshot(mainWindow);
  assert(restoredLauncher.currentName === recoveredProject.name, 'Recovery Restore did not load the recovery project into the editor store.');
  assert(restoredLauncher.saveStateClass?.includes('dirty-state'), 'Recovery Restore did not preserve dirty truth.');
  receipt.checks.recoveryRestore = { bannerCleared: true, recoveredProjectName: restoredLauncher.currentName, dirtyState: restoredLauncher.saveStateClass };
  receipt.screenshots.phase3RecoveryRestored = await capture(mainWindow, startupEvidenceDir, 'phase-3-recovery-restored.png');
  receipt.checks.recoveryFiles = { ignored: recoveryA, restored: recoveryB, ignoredFileStillExists: existsSync(recoveryA), restoredCandidateFileStillExists: existsSync(recoveryB) };
  receipt.finalHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  receipt.status = 'PASS_AUTOMATED_PENDING_HUMAN';
}

async function finish(exitCode, error) {
  if (error) {
    receipt.status = 'FAIL';
    receipt.error = error instanceof Error ? error.stack || error.message : String(error);
    try {
      receipt.finalHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
    } catch {
      // Preserve the failure receipt even if git is unavailable.
    }
  }
  writeFileSync(
    join(startupEvidenceDir, 'issue-410-project-launcher-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  dialog.showOpenDialog = originalShowOpenDialog;
  setTimeout(() => app.exit(exitCode), 300);
}

run().then(() => finish(0)).catch((error) => finish(1, error));
