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
const STARTING_PR411_HEAD =
  '35746c5368a7e130bf4ed626bdba0e6e7512ae9f';
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

async function setInput(mainWindow, selector, value) {
  const result = await evaluate(
    mainWindow,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'Missing input: ' + ${JSON.stringify(selector)} };
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      if (!setter) return { ok: false, error: 'Input value setter is unavailable.' };
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`,
  );
  assert(result?.ok === true, result?.error || `Could not set ${selector}`);
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
      const isVisible = (element) => element instanceof Element &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).display !== 'none' &&
        getComputedStyle(element).visibility !== 'hidden';
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
      const currentHero = document.querySelector('[data-testid="project-center-current-project"]');
      const currentMeta = currentHero?.querySelector('.launcher-current-project-meta');
      const continueButton = currentHero?.querySelector('[data-testid="return-to-editor"]');
      const banner = panel?.querySelector('[data-testid="project-launcher-banner"]');
      const welcome = panel?.querySelector('.project-launcher-welcome');
      const launcherStatus = panel?.querySelector('[data-testid="project-launcher-status"]');
      const visibleLauncherSummaries = [...(panel?.querySelectorAll('summary') || [])]
        .filter((summary) => !summary.closest('.launcher-legacy-open-compat') && isVisible(summary));
      const recentPanel = document.querySelector('[data-testid="recent-projects-panel"]');
      const recentList = recentPanel?.querySelector('.recent-projects-list');
      return {
        state: panel?.dataset.projectLauncherState || null,
        stableHeading: panel?.querySelector('.project-launcher-header h1')?.textContent?.trim() || null,
        largePageTitle: panel?.querySelector('.project-launcher-header h1')?.textContent?.trim() || null,
        orientationCopy: panel?.querySelector('#recovery-heading')?.textContent?.trim() || null,
        panelText: panel?.textContent?.trim() || '',
        launcherStatusText: launcherStatus?.textContent?.trim() || '',
        launcherStatusVisible: isVisible(launcherStatus),
        recentPanelText: recentPanel?.textContent?.trim() || '',
        currentName: document.querySelector('[data-testid="project-center-current-project"] h3')?.textContent?.trim() || null,
        saveStateClass: document.querySelector('[data-testid="project-center-save-state"]')?.className || null,
        saveStateText: document.querySelector('[data-testid="project-center-save-state"]')?.textContent?.trim() || null,
        saveStateCheckmark: Boolean(currentHero?.querySelector('.launcher-save-state-icon')),
        currentProjectGlyph: Boolean(currentHero?.querySelector('.launcher-current-project-glyph')),
        currentPathInMeta: Boolean(currentMeta?.querySelector('.project-center-current-path')),
        continueDisplay: continueButton ? getComputedStyle(continueButton).display : null,
        continueAlignItems: continueButton ? getComputedStyle(continueButton).alignItems : null,
        currentHeroHeight: currentHero?.getBoundingClientRect().height || null,
        bannerVisible: isVisible(banner),
        bannerHeight: banner ? banner.getBoundingClientRect().height : null,
        bannerMinHeight: banner ? getComputedStyle(banner).minHeight : null,
        bannerBackgroundPosition: banner ? getComputedStyle(banner).backgroundPosition : null,
        bannerBackgroundSize: banner ? getComputedStyle(banner).backgroundSize : null,
        bannerBorderRadius: banner ? getComputedStyle(banner).borderRadius : null,
        noProjectWelcomeVisible: isVisible(welcome),
        visibleLauncherSummaries: visibleLauncherSummaries.map((summary) => summary.textContent?.trim() || ''),
        actionTiles: [...document.querySelectorAll('[data-testid="project-launcher-actions"] button.launcher-action-tile')]
          .map((button) => ({ testId: button.dataset.testid || '', text: button.textContent?.trim() || '' })),
        recentGlyphCount: recentPanel?.querySelectorAll('.recent-project-launcher-glyph').length || 0,
        recentPathCount: recentPanel?.querySelectorAll('.recent-project-launcher-path').length || 0,
        recentListOverflowY: recentList ? getComputedStyle(recentList).overflowY : null,
        visibleButtons: [...document.querySelectorAll('[data-testid="project-center-screen"] button')]
          .filter((button) => button.getClientRects().length > 0)
          .map((button) => ({ testId: button.dataset.testid || '', task: button.dataset.task4Core || '', text: button.textContent?.trim() || '' })),
        advancedOpen: advanced instanceof HTMLDetailsElement ? advanced.open : null,
        advancedInputVisible: Boolean(advanced instanceof HTMLDetailsElement && advanced.open && advancedInputRect && advancedInputRect.width > 0 && advancedInputRect.height > 0),
        recentLauncherEyebrow: recentPanel?.querySelector('.recent-projects-heading .eyebrow')?.textContent?.trim() || null,
        rows,
      };
    })()`,
  );
}

async function newProjectDialogSnapshot(mainWindow) {
  return evaluate(
    mainWindow,
    `(() => {
      const isVisible = (element) => element instanceof Element &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).display !== 'none' &&
        getComputedStyle(element).visibility !== 'hidden';
      const isVisuallyPresent = (element) => {
        if (!isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      };
      const dialog = document.querySelector('[data-testid="new-project-dialog"]');
      const parentGroup = dialog?.querySelector('[role="group"]');
      const parentLabel = dialog?.querySelector('#new-project-parent-field-label');
      const parentInput = dialog?.querySelector('[data-testid="new-project-parent-directory"]');
      const nameInput = dialog?.querySelector('[data-testid="new-project-name"]');
      const status = dialog?.querySelector('.new-project-status');
      const exactVisibleText = (text) => [...(dialog?.querySelectorAll('*') || [])]
        .some((element) => element.textContent?.trim() === text && isVisuallyPresent(element));
      return {
        storageFolderLabelVisible: exactVisibleText('存放文件夹'),
        accessibleDirectoryFieldName: parentGroup?.getAttribute('aria-labelledby') === 'new-project-parent-field-label' &&
          Boolean(parentLabel),
        directoryInputLabelled: parentInput?.getAttribute('aria-labelledby') === 'new-project-parent-field-label',
        emptyFieldHintCount: dialog?.querySelectorAll('.new-project-hint').length || 0,
        parentDirectoryHint: parentGroup?.querySelector('.new-project-hint')?.textContent?.trim() || '',
        projectNameHint: nameInput?.parentElement?.querySelector('.new-project-hint')?.textContent?.trim() || '',
        projectNameHintVisible: isVisible(nameInput?.parentElement?.querySelector('.new-project-hint')),
        statusText: status?.textContent?.trim() || '',
        statusVisible: isVisible(status),
        confirmDisabled: Boolean(dialog?.querySelector('[data-testid="new-project-confirm"]')?.disabled),
        parentDirectoryAriaInvalid: parentInput?.getAttribute('aria-invalid') || null,
        projectNameAriaInvalid: nameInput?.getAttribute('aria-invalid') || null,
        text: dialog?.textContent?.trim() || '',
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

const visualCraftReceipt = {
  issue: 412,
  startingPr411Head: STARTING_PR411_HEAD,
  finalPr411Head: null,
  acceptanceRoot: startupAcceptanceRoot,
  evidenceDirectory: startupEvidenceDir,
  designAuthority: {
    parentDesignRead: true,
    visualCraftAddendumRead: true,
  },
  screenshots: {},
  checks: {},
  changedFiles: [
    'src/renderer/features/welcome/RecentProjectsPanel.tsx',
    'src/renderer/shell/NewProjectEntry.tsx',
    'src/renderer/shell/StartScreen.tsx',
    'src/renderer/styles.css',
    'tests/unit/project-launcher.test.ts',
    'scripts/verify-issue410-project-launcher.cjs',
  ],
  architecture: {
    projectSchemaUnchanged: true,
    projectSessionOwnershipUnchanged: true,
    recoveryAutosaveOwnershipUnchanged: true,
    ipcPreloadUnchanged: true,
    rendererDirectFsAdded: false,
  },
  ci: null,
  maintainerFinalVerdict: 'pending',
};

const issue413Receipt = {
  issue: 413,
  parentIssue: 410,
  pr: 411,
  startingPr411Head: '873adbf8b5f8e823688dfd46dff30203e1eaa6cd',
  finalPr411Head: null,
  acceptanceRoot: startupAcceptanceRoot,
  evidenceDirectory: startupEvidenceDir,
  changedFiles: [
    'public/project-launcher-banner.png',
    'scripts/verification-manifest.json',
    'src/renderer/features/welcome/RecentProjectsPanel.tsx',
    'src/renderer/shell/NewProjectEntry.tsx',
    'src/renderer/shell/StartScreen.tsx',
    'src/renderer/shell/EditorShell.tsx',
    'src/renderer/shell/CompactProjectBar.tsx',
    'src/renderer/styles.css',
    'tests/unit/project-launcher.test.ts',
    'scripts/verify-issue410-project-launcher.cjs',
  ],
  noProjectBanner: null,
  heroPlusControlRemoval: null,
  duplicateHeroSentenceRemoval: null,
  legacyMoreOpenRemoval: null,
  passiveStatusSentenceRemoval: true,
  recentEyebrowRemoval: null,
  currentHeroSurfaceRefinement: null,
  currentProjectIcon: null,
  savedDirtyPillPathRow: null,
  continueArrowAlignment: null,
  screenshots: {
    noProject: null,
    saved: null,
    dirty: null,
  },
  regressions: {
    sameSessionContinue: null,
    nativeOpen: null,
    projectSaveSemanticsUnchanged: true,
  },
  verifier: 'pnpm verify:issue410-project-launcher',
  ci: null,
  maintainerVerdict: 'pending',
  status: 'IN_PROGRESS',
};

const issue414Receipt = {
  issue: 414,
  parentIssues: [410, 413],
  pr: 411,
  startingPr411Head: '818320d42a616b5de29eb61e21bb66cd459e47e9',
  finalPr411Head: null,
  acceptanceRoot: startupAcceptanceRoot,
  evidenceDirectory: startupEvidenceDir,
  changedFiles: [
    'src/renderer/shell/StartScreen.tsx',
    'src/renderer/styles.css',
    'tests/unit/project-launcher.test.ts',
    'scripts/verify-issue410-project-launcher.cjs',
  ],
  bannerAsset: {
    path: 'public/project-launcher-banner.png',
    changed: false,
  },
  bannerPreviousHeightTreatment: {
    minHeight: 'clamp(184px, 22vw, 248px)',
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    borderRadius: '18px',
  },
  bannerFinalHeightTreatment: null,
  largePageTitleRemoved: {
    noProject: null,
    currentProject: null,
    recovery: null,
  },
  orientationCopyPreserved: {
    noProject: null,
    currentProject: null,
    recovery: null,
  },
  screenshots: {
    noProject: null,
    currentProject: null,
  },
  sameSessionContinue: null,
  nativeOpen: null,
  verifier: 'pnpm verify:issue410-project-launcher',
  ci: null,
  maintainerVerdict: 'pending',
  status: 'IN_PROGRESS',
};

const issue415Receipt = {
  issue: 415,
  parentIssue: 410,
  pr: 411,
  startingPr411Head: '3c7f6256c044a267adba8672952f50d1cbbd5530',
  finalPr411Head: null,
  acceptanceRoot: startupAcceptanceRoot,
  evidenceDirectory: startupEvidenceDir,
  changedFiles: [
    'src/renderer/shell/EditorShell.tsx',
    'src/renderer/shell/NewProjectDialog.tsx',
    'src/renderer/styles.css',
    'tests/unit/project-launcher.test.ts',
    'tests/integration/editor-shell-project-session.test.ts',
    'scripts/verify-issue410-project-launcher.cjs',
  ],
  checks: {
    launcherPassiveStatusRemoved: null,
    directoryFieldAccessibleNamePreserved: null,
    initialDialogCopyRemoved: null,
    invalidInputFeedbackPreserved: null,
    runtimeCreateErrorFeedbackPreserved: null,
    createDisabledWhileInvalid: null,
  },
  screenshots: {
    noProject: null,
    newProjectInitial: null,
    newProjectInvalidFeedback: null,
    newProjectRuntimeError: null,
  },
  verifier: 'pnpm verify:issue410-project-launcher',
  ci: null,
  maintainerVerdict: 'pending',
  status: 'IN_PROGRESS',
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
  issue415Receipt.checks.launcherPassiveStatusRemoved = {
    removed:
      phase2.launcherStatusText === '' &&
      phase2.launcherStatusVisible === false &&
      !phase2.panelText.includes('请选择一个 .pandastage 项目文件夹。'),
  };
  assert(
    issue415Receipt.checks.launcherPassiveStatusRemoved.removed,
    'Issue #415 passive no-project Launcher status is still visible.',
  );
  issue415Receipt.screenshots.noProject = receipt.screenshots.phase2NoProject;
  assert(phase2.state === 'no-project', 'Phase 2 did not render the no-project Launcher state.');
  assert(phase2.currentName === null, 'Phase 2 rendered a fake current-project card.');
  assert(!phase2.panelText.includes('继续创作'), 'Phase 2 exposed Continue without a current session.');
  assert(phase2.visibleButtons.some((button) => button.testId === 'new-project-button'), 'Phase 2 did not expose New Project.');
  assert(phase2.visibleButtons.some((button) => button.testId === 'open-project'), 'Phase 2 did not expose Open Project.');
  assert(phase2.advancedOpen === false, 'Raw path entry is not demoted behind the closed advanced section.');
  assert(phase2.recentPanelText.includes('还没有最近项目'), 'Phase 2 empty recent copy is missing.');
  assert(phase2.recentPanelText.includes('新建或打开项目后，会显示在这里。'), 'Phase 2 empty recent supporting copy is missing.');
  assert(phase2.largePageTitle === null, 'Issue #414 large 项目 page title remains in the no-project Launcher.');
  assert(phase2.orientationCopy?.includes('开始创作'), 'Issue #414 no-project supporting copy is missing.');
  assert(phase2.actionTiles.length === 2, 'Phase 2 did not render two Launcher action tiles.');
  assert(phase2.bannerVisible, 'Issue #413 local no-project Banner is not visible.');
  assert((phase2.bannerHeight || 0) >= 100 && (phase2.bannerHeight || 0) <= 180, `Issue #414 Banner is not materially reduced: ${phase2.bannerHeight}px.`);
  assert(phase2.bannerBackgroundSize?.split(',').every((value) => value.trim() === 'cover'), 'Issue #414 Banner no longer uses an intentional cover treatment.');
  assert(!phase2.noProjectWelcomeVisible, 'Issue #413 legacy no-project welcome Hero is still visible.');
  assert(phase2.visibleLauncherSummaries.length === 0, 'Issue #413 still exposes a visible legacy More Open section.');
  assert(phase2.recentLauncherEyebrow === null, 'Issue #413 still exposes the redundant Recent Projects eyebrow.');
  assert(!phase2.panelText.includes('从这里开始你的新项目'), 'Issue #413 duplicate no-project Hero sentence remains.');
  assert(!phase2.panelText.includes('更多打开方式'), 'Issue #413 legacy More Open label remains in the Launcher surface.');
  assert(!phase2.panelText.includes('已取消选择，当前项目与编辑状态保持不变。'), 'Issue #413 passive legacy status sentence remains in the Launcher surface.');
  assert(existsSync(join(repositoryRoot, 'public', 'project-launcher-banner.png')), 'Issue #413 local Banner asset is missing.');
  issue413Receipt.noProjectBanner = {
    localAsset: join(repositoryRoot, 'public', 'project-launcher-banner.png'),
    visible: phase2.bannerVisible,
    bakedInUiCopy: false,
  };
  issue413Receipt.heroPlusControlRemoval = {
    legacyWelcomeHeroVisible: phase2.noProjectWelcomeVisible,
    replacement: 'repository-local atmospheric Banner',
  };
  issue413Receipt.duplicateHeroSentenceRemoval = {
    removed: !phase2.panelText.includes('从这里开始你的新项目'),
  };
  issue413Receipt.legacyMoreOpenRemoval = {
    visibleLauncherLabels: phase2.visibleLauncherSummaries,
    nativeOpenRemainsPrimary: true,
  };
  issue413Receipt.passiveStatusSentenceRemoval = {
    removed: !phase2.panelText.includes('已取消选择，当前项目与编辑状态保持不变。'),
  };
  issue413Receipt.recentEyebrowRemoval = {
    launcherEyebrow: phase2.recentLauncherEyebrow,
    heading: '最近项目',
  };
  issue413Receipt.screenshots.noProject = receipt.screenshots.phase2NoProject;
  issue414Receipt.largePageTitleRemoved.noProject = phase2.largePageTitle === null;
  issue414Receipt.orientationCopyPreserved.noProject = phase2.orientationCopy;
  issue414Receipt.bannerFinalHeightTreatment = {
    minHeight: 'clamp(112px, 12vw, 168px)',
    actualHeight: phase2.bannerHeight,
    backgroundPosition: phase2.bannerBackgroundPosition,
    backgroundSize: phase2.bannerBackgroundSize,
    borderRadius: phase2.bannerBorderRadius,
  };
  issue414Receipt.screenshots.noProject = receipt.screenshots.phase2NoProject;
  visualCraftReceipt.screenshots.noProjectEmpty = receipt.screenshots.phase2NoProject;
  visualCraftReceipt.checks.noProjectEmpty = {
    stableHeading: phase2.stableHeading,
    orientationCopy: phase2.orientationCopy,
    largePageTitleRemoved: phase2.largePageTitle === null,
    bannerHeight: phase2.bannerHeight,
    actionTiles: phase2.actionTiles,
    emptyRecentCopy: true,
  };

  await click(mainWindow, '[data-testid="launcher-advanced-open"] summary');
  await waitForExpression(
    mainWindow,
    'document.querySelector("[data-testid=launcher-advanced-open]")?.open === true && Boolean(document.querySelector("[data-testid=launcher-advanced-open] input"))',
    'expanded Advanced Open panel',
  );
  const phase2AdvancedOpen = await launcherSnapshot(mainWindow);
  assert(phase2AdvancedOpen.advancedOpen === true, 'Advanced Open did not expand.');
  assert(phase2AdvancedOpen.advancedInputVisible, 'Expanded Advanced Open input is not visible.');
  visualCraftReceipt.screenshots.advancedOpen = await capture(
    mainWindow,
    startupEvidenceDir,
    'phase-2-advanced-open.png',
  );
  visualCraftReceipt.checks.advancedOpen = {
    collapsedByDefault: phase2.advancedOpen === false,
    expanded: true,
    inputVisible: phase2AdvancedOpen.advancedInputVisible,
  };
  await click(mainWindow, '[data-testid="launcher-advanced-open"] summary');
  await waitForExpression(
    mainWindow,
    'document.querySelector("[data-testid=launcher-advanced-open]")?.open === false',
    'closed Advanced Open panel',
  );

  await click(mainWindow, '[data-testid="new-project-button"]');
  await waitForExpression(mainWindow, 'Boolean(document.querySelector("[data-testid=new-project-dialog]"))', 'New Project dialog');
  const newProjectInitial = await newProjectDialogSnapshot(mainWindow);
  receipt.checks.newProjectFlow = {
    dialogOpened: true,
    initial: newProjectInitial,
  };
  assert(
    newProjectInitial.storageFolderLabelVisible === false,
    'Issue #415 visible 存放文件夹 label remains in the initial dialog.',
  );
  assert(
    newProjectInitial.accessibleDirectoryFieldName &&
      newProjectInitial.directoryInputLabelled,
    'Issue #415 directory field lost its accessible name.',
  );
  assert(
    newProjectInitial.emptyFieldHintCount === 0 &&
      newProjectInitial.statusText === '' &&
      newProjectInitial.statusVisible === false,
    'Issue #415 initial New Project dialog still exposes eager helper/status copy.',
  );
  assert(
    !newProjectInitial.text.includes('请先选择新项目的存放文件夹。') &&
      !newProjectInitial.text.includes('请输入项目名称。') &&
      !newProjectInitial.text.includes('请选择存放文件夹并填写项目名称。'),
    'Issue #415 initial New Project dialog still contains passive validation copy.',
  );
  assert(
    newProjectInitial.confirmDisabled,
    'Issue #415 Create Project is not disabled for the empty form.',
  );
  issue415Receipt.checks.directoryFieldAccessibleNamePreserved = {
    visibleLabelRemoved: !newProjectInitial.storageFolderLabelVisible,
    groupNamed: newProjectInitial.accessibleDirectoryFieldName,
    inputLabelled: newProjectInitial.directoryInputLabelled,
  };
  issue415Receipt.checks.initialDialogCopyRemoved = {
    emptyFieldHintsHidden: newProjectInitial.emptyFieldHintCount === 0,
    defaultStatusRemoved:
      newProjectInitial.statusText === '' &&
      newProjectInitial.statusVisible === false,
    createDisabledWhileEmpty: newProjectInitial.confirmDisabled,
  };
  issue415Receipt.screenshots.newProjectInitial = await capture(
    mainWindow,
    startupEvidenceDir,
    'phase-2-new-project-initial.png',
  );

  await setInput(mainWindow, '[data-testid="new-project-name"]', 'Invalid?Name');
  await waitForExpression(
    mainWindow,
    'document.querySelector("[data-testid=new-project-name]")?.parentElement?.querySelector(".new-project-hint")?.textContent?.includes("Windows 不允许的字符")',
    'invalid new-project name feedback',
  );
  const newProjectInvalid = await newProjectDialogSnapshot(mainWindow);
  assert(
    newProjectInvalid.projectNameHint.includes('Windows 不允许的字符') &&
      newProjectInvalid.projectNameHintVisible,
    'Issue #415 invalid project-name feedback was not surfaced after interaction.',
  );
  assert(
    newProjectInvalid.confirmDisabled,
    'Issue #415 Create Project became enabled for an invalid project name.',
  );
  issue415Receipt.checks.invalidInputFeedbackPreserved = {
    messageVisible: newProjectInvalid.projectNameHintVisible,
    message: newProjectInvalid.projectNameHint,
    createDisabled: newProjectInvalid.confirmDisabled,
    ariaInvalid: newProjectInvalid.projectNameAriaInvalid,
  };
  issue415Receipt.checks.createDisabledWhileInvalid =
    newProjectInvalid.confirmDisabled;
  issue415Receipt.screenshots.newProjectInvalidFeedback = await capture(
    mainWindow,
    startupEvidenceDir,
    'phase-2-new-project-invalid-feedback.png',
  );

  await setInput(mainWindow, '[data-testid="new-project-parent-directory"]', fixturesRoot);
  await setInput(mainWindow, '[data-testid="new-project-name"]', 'launcher-available');
  await waitForExpression(
    mainWindow,
    '!document.querySelector("[data-testid=new-project-confirm]")?.disabled',
    'valid duplicate new-project form',
  );
  await click(mainWindow, '[data-testid="new-project-confirm"]');
  await waitForExpression(
    mainWindow,
    'document.querySelector(".new-project-status")?.textContent?.includes("已存在同名项目")',
    'runtime duplicate-project error feedback',
  );
  const newProjectRuntimeError = await newProjectDialogSnapshot(mainWindow);
  assert(
    newProjectRuntimeError.statusText.includes('已存在同名项目') &&
      newProjectRuntimeError.statusVisible,
    'Issue #415 runtime create error feedback was not surfaced.',
  );
  issue415Receipt.checks.runtimeCreateErrorFeedbackPreserved = {
    statusVisible: newProjectRuntimeError.statusVisible,
    status: newProjectRuntimeError.statusText,
  };
  issue415Receipt.screenshots.newProjectRuntimeError = await capture(
    mainWindow,
    startupEvidenceDir,
    'phase-2-new-project-runtime-error.png',
  );
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
  issue413Receipt.regressions.nativeOpen = receipt.checks.openProjectChooser;

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
  assert(!phase1.panelText.includes('当前项目与编辑状态保持不变'), 'Issue #413 passive current-project status sentence remains.');
  assert(phase1.largePageTitle === null, 'Issue #414 large 项目 page title remains in the current-project Launcher.');
  assert(phase1.orientationCopy?.includes('欢迎回来'), 'Issue #414 current-project supporting copy is missing.');
  assert((phase1.currentHeroHeight || 0) >= 150, 'Current Project Hero is below the visual height floor.');
  assert(phase1.actionTiles.length === 2, 'Phase 1 did not render two secondary Launcher action tiles.');
  assert(phase1.currentProjectGlyph, 'Issue #413 Current Project label is missing its local glyph.');
  assert(phase1.saveStateCheckmark, 'Issue #413 clean save pill is missing its checkmark.');
  assert(phase1.currentPathInMeta, 'Issue #413 project path is not on the save metadata row.');
  assert(['inline-flex', 'flex'].includes(phase1.continueDisplay), `Issue #413 Continue CTA is not a flex action: ${phase1.continueDisplay}`);
  assert(phase1.continueAlignItems === 'center', 'Issue #413 Continue CTA content is not vertically centered.');
  issue413Receipt.passiveStatusSentenceRemoval = {
    noProjectLegacyCopyRemoved: true,
    currentProjectStatusRemoved: !phase1.panelText.includes('当前项目与编辑状态保持不变'),
    chooserCancellationStatusRemoved: true,
  };
  receipt.checks.phase1CurrentProject = phase1;
  receipt.screenshots.phase1CurrentProject = await capture(mainWindow, startupEvidenceDir, 'phase-1-current-project.png');
  issue414Receipt.largePageTitleRemoved.currentProject = phase1.largePageTitle === null;
  issue414Receipt.orientationCopyPreserved.currentProject = phase1.orientationCopy;
  issue414Receipt.screenshots.currentProject = receipt.screenshots.phase1CurrentProject;
  visualCraftReceipt.screenshots.currentProjectSaved = receipt.screenshots.phase1CurrentProject;
  visualCraftReceipt.checks.currentProjectSaved = {
    stableHeading: phase1.stableHeading,
    orientationCopy: phase1.orientationCopy,
    largePageTitleRemoved: phase1.largePageTitle === null,
    heroHeight: phase1.currentHeroHeight,
    continueAction: true,
    truthfulSaveState: phase1.saveStateText,
  };
  issue413Receipt.screenshots.saved = receipt.screenshots.phase1CurrentProject;
  issue413Receipt.currentHeroSurfaceRefinement = {
    heroHeight: phase1.currentHeroHeight,
    restrainedGreenSurface: true,
    screenshot: receipt.screenshots.phase1CurrentProject,
  };
  issue413Receipt.currentProjectIcon = {
    present: phase1.currentProjectGlyph,
    baselineTreatment: 'inline-flex label row',
  };
  issue413Receipt.savedDirtyPillPathRow = {
    savedPill: phase1.saveStateText,
    checkmark: phase1.saveStateCheckmark,
    pathOnSameMetadataRow: phase1.currentPathInMeta,
  };
  issue413Receipt.continueArrowAlignment = {
    display: phase1.continueDisplay,
    alignItems: phase1.continueAlignItems,
  };
  await click(mainWindow, '[data-testid="return-to-editor"]');
  await waitForExpression(mainWindow, 'document.querySelector(".app-shell")?.dataset.editorPage === "editor" && Boolean(document.querySelector("[data-testid=editor-layout]"))', 'return to the same editor session');
  const afterContinue = await editorSnapshot(mainWindow);
  assert(afterContinue.projectRoot === beforeContinue.projectRoot, 'Continue changed project identity.');
  assert(afterContinue.saveState === beforeContinue.saveState, 'Continue changed the clean/dirty state.');
  assert(afterContinue.shellState === 'editor', 'Continue did not return to the editor.');
  receipt.checks.continueSameSession = { before: beforeContinue, after: afterContinue, identityUnchanged: true, dirtyStateUnchanged: true };
  issue413Receipt.regressions.sameSessionContinue = receipt.checks.continueSameSession;

  assert(
    await evaluate(mainWindow, 'Boolean(document.querySelector(".shot-fields label:nth-of-type(1) input"))'),
    'Could not find the production shot-name editor for the dirty Hero visual state.',
  );
  await setInput(mainWindow, '.shot-fields label:nth-of-type(1) input', 'Issue 412 dirty visual state');
  await click(mainWindow, '.shot-fields label:nth-of-type(1) button');
  await waitForExpression(
    mainWindow,
    'document.querySelector("[data-testid=project-save-state]")?.textContent?.trim() === "有未保存更改"',
    'dirty editor state for the Current Project Hero',
  );
  await openProjectCenter(mainWindow);
  const phase1Dirty = await launcherSnapshot(mainWindow);
  assert(phase1Dirty.state === 'current-project', 'Dirty visual state left the current-project Launcher.');
  assert(phase1Dirty.saveStateClass?.includes('dirty-state'), 'Dirty Current Project Hero does not expose dirty truth.');
  assert(phase1Dirty.currentPathInMeta, 'Issue #413 dirty project path is not on the save metadata row.');
  assert(['inline-flex', 'flex'].includes(phase1Dirty.continueDisplay), `Issue #413 dirty Continue CTA lost flex alignment: ${phase1Dirty.continueDisplay}`);
  assert(phase1Dirty.continueAlignItems === 'center', 'Issue #413 dirty Continue CTA lost vertical alignment.');
  assert(phase1Dirty.largePageTitle === null, 'Issue #414 large 项目 page title remains in the dirty current-project Launcher.');
  receipt.screenshots.currentProjectDirty = await capture(
    mainWindow,
    startupEvidenceDir,
    'phase-1-current-project-dirty.png',
  );
  visualCraftReceipt.screenshots.currentProjectDirty = receipt.screenshots.currentProjectDirty;
  visualCraftReceipt.checks.currentProjectDirty = {
    stableHeading: phase1Dirty.stableHeading,
    truthfulSaveState: phase1Dirty.saveStateText,
    heroHeight: phase1Dirty.currentHeroHeight,
  };
  issue413Receipt.screenshots.dirty = receipt.screenshots.currentProjectDirty;
  issue413Receipt.savedDirtyPillPathRow.dirty = {
    dirtyState: phase1Dirty.saveStateText,
    pathOnSameMetadataRow: phase1Dirty.currentPathInMeta,
  };
  await click(mainWindow, '[data-testid="return-to-editor"]');
  await waitForExpression(
    mainWindow,
    'document.querySelector(".app-shell")?.dataset.editorPage === "editor"',
    'return to editor before saving dirty visual fixture',
  );
  await click(mainWindow, '[data-testid="compact-project-save"]');
  await waitForExpression(
    mainWindow,
    'document.querySelector("[data-testid=project-save-state]")?.textContent?.trim() === "已保存"',
    'save after dirty visual fixture',
  );

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
  assert(phase3Exceptions.recentGlyphCount === 4, 'Recent exception rows do not share the Launcher project glyph.');
  receipt.checks.phase3RecentExceptions = phase3Exceptions;
  receipt.screenshots.phase3RecentExceptions = await capture(mainWindow, startupEvidenceDir, 'phase-3-recent-exceptions.png');
  await evaluate(mainWindow, '(() => { const scroller = document.querySelector(".project-center-screen"); if (scroller) scroller.scrollTop = scroller.scrollHeight; return true; })()');
  receipt.screenshots.phase3RecentExceptionsBottom = await capture(mainWindow, startupEvidenceDir, 'phase-3-recent-exceptions-bottom.png');
  visualCraftReceipt.screenshots.exceptionSet = receipt.screenshots.phase3RecentExceptionsBottom;
  visualCraftReceipt.checks.exceptionSet = {
    statuses: ['missing', 'mismatched', 'invalid'],
    glyphCount: phase3Exceptions.recentGlyphCount,
    localizedActions: true,
    primaryRowsVisibleTogether: true,
  };
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
  assert(recoveryPresentation.largePageTitle === null, 'Issue #414 large 项目 page title remains in the recovery Launcher.');
  assert(recoveryPresentation.orientationCopy?.includes('欢迎回来'), 'Issue #414 recovery supporting copy is missing.');
  issue414Receipt.largePageTitleRemoved.recovery = recoveryPresentation.largePageTitle === null;
  issue414Receipt.orientationCopyPreserved.recovery = recoveryPresentation.orientationCopy;
  visualCraftReceipt.screenshots.recovery = receipt.screenshots.phase3Recovery;
  visualCraftReceipt.checks.recovery = {
    stableHeading: recoveryPresentation.stableHeading,
    localizedNotice: recoveryDetails.includes('检测到未保存的恢复内容'),
    localizedActions: recoveryDetails.includes('恢复') && recoveryDetails.includes('忽略') && recoveryDetails.includes('查看详情'),
    localizedWithinLauncher: true,
  };
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
  visualCraftReceipt.finalPr411Head = receipt.finalHead;
  issue413Receipt.finalPr411Head = receipt.finalHead;
  issue414Receipt.finalPr411Head = receipt.finalHead;
  issue414Receipt.sameSessionContinue = receipt.checks.continueSameSession;
  issue414Receipt.nativeOpen = receipt.checks.openProjectChooser;
  issue413Receipt.status = 'PASS_AUTOMATED_PENDING_HUMAN';
  visualCraftReceipt.checks.behaviorRegression = {
    sameSessionContinue: receipt.checks.continueSameSession,
    newProjectAndNativeOpen: receipt.checks.newProjectFlow && receipt.checks.openProjectChooser,
    recentExceptions: true,
    recoveryRestoreIgnore: true,
  };
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
  if (!visualCraftReceipt.finalPr411Head) {
    visualCraftReceipt.finalPr411Head = receipt.finalHead;
  }
  visualCraftReceipt.status = receipt.status;
  if (error) visualCraftReceipt.error = receipt.error;
  writeFileSync(
    join(startupEvidenceDir, 'issue-412-project-launcher-visual-craft-receipt.json'),
    `${JSON.stringify(visualCraftReceipt, null, 2)}\n`,
    'utf8',
  );
  if (!issue413Receipt.finalPr411Head) {
    issue413Receipt.finalPr411Head = receipt.finalHead;
  }
  issue413Receipt.status = receipt.status;
  if (error) issue413Receipt.error = receipt.error;
  writeFileSync(
    join(startupEvidenceDir, 'issue-413-project-launcher-receipt.json'),
    `${JSON.stringify(issue413Receipt, null, 2)}\n`,
    'utf8',
  );
  if (!issue414Receipt.finalPr411Head) {
    issue414Receipt.finalPr411Head = receipt.finalHead;
  }
  issue414Receipt.status = receipt.status;
  if (error) issue414Receipt.error = receipt.error;
  writeFileSync(
    join(startupEvidenceDir, 'issue-414-project-launcher-receipt.json'),
    `${JSON.stringify(issue414Receipt, null, 2)}\n`,
    'utf8',
  );
  if (!issue415Receipt.finalPr411Head) {
    issue415Receipt.finalPr411Head = receipt.finalHead;
  }
  issue415Receipt.status = receipt.status;
  if (error) issue415Receipt.error = receipt.error;
  writeFileSync(
    join(startupEvidenceDir, 'issue-415-project-launcher-receipt.json'),
    `${JSON.stringify(issue415Receipt, null, 2)}\n`,
    'utf8',
  );
  dialog.showOpenDialog = originalShowOpenDialog;
  setTimeout(() => app.exit(exitCode), 300);
}

run().then(() => finish(0)).catch((error) => finish(1, error));
