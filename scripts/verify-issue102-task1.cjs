const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\project-center-v1';
const projectsRoot = path.join(acceptanceRoot, 'projects');
const logsRoot = path.join(acceptanceRoot, 'logs');
const tempRoot = path.join(acceptanceRoot, 'temp');
const electronUserDataRoot = path.join(
  acceptanceRoot,
  'electron-user-data',
);
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-102/task1',
);
const projectARoot = path.join(projectsRoot, 'issue102-project-a.pandastage');
const missingProjectRoot = path.join(
  projectsRoot,
  'issue102-missing-project.pandastage',
);
const missingProjectSentinel = path.join(missingProjectRoot, 'keep-me.txt');

rmSync(projectsRoot, { recursive: true, force: true });
rmSync(electronUserDataRoot, { recursive: true, force: true });
for (const directory of [
  projectsRoot,
  logsRoot,
  tempRoot,
  electronUserDataRoot,
  evidenceRoot,
  repositoryEvidenceRoot,
]) {
  mkdirSync(directory, { recursive: true });
}

process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
process.env.TMPDIR = tempRoot;
delete process.env.VITE_DEV_SERVER_URL;

for (const [name, directory] of [
  ['temp', tempRoot],
  ['userData', electronUserDataRoot],
  ['sessionData', path.join(electronUserDataRoot, 'session-data')],
  ['logs', logsRoot],
  ['crashDumps', path.join(logsRoot, 'crash-dumps')],
]) {
  mkdirSync(directory, { recursive: true });
  try {
    app.setPath(name, directory);
  } catch {
    // Electron exposes some path keys only after app readiness.
  }
}

const { ProjectService } = require(
  '../dist-electron/main/services/ProjectService.js',
);
const { PathService } = require('../dist-electron/main/services/PathService.js');
const { RecentProjectsService } = require(
  '../dist-electron/main/services/RecentProjectsService.js',
);

app.on('window-all-closed', () => {});

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
        // The renderer may be between page transitions.
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

async function clickSelector(window, selector) {
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
  await delay(160);
}

async function clickCardButton(window, status, label) {
  await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(
      '[data-testid="recent-projects-list"] [data-project-status="${status}"]'
    );
    if (!(card instanceof HTMLElement)) {
      throw new Error('Recent project card not found: ${status}');
    }
    const button = [...card.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)},
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Recent project action not found: ${label}');
    }
    if (button.disabled) {
      throw new Error('Recent project action is disabled: ${label}');
    }
    button.click();
  })()`);
  await delay(180);
}

async function openProjectCenter(window) {
  await clickSelector(window, '[data-testid="compact-project-more"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="compact-project-menu"]')`,
    'Compact project menu did not open.',
  );
  await clickSelector(window, '[data-testid="menu-open-project-center"]');
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => ({
    page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
    shellState: document.querySelector('.editor-shell')?.dataset.editorShellState ?? null,
    hasProjectCenter: Boolean(document.querySelector('[data-testid="project-center-screen"]')),
    hasEditorLayout: Boolean(document.querySelector('[data-testid="editor-layout"]')),
    activeRoot: document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() ?? null,
    currentProjectRoot: document.querySelector('.project-center-current-path')?.textContent?.trim() ?? null,
    currentProjectName: document.querySelector('[data-testid="project-center-current-project"] h3')?.textContent?.trim() ?? null,
    recentCards: [...document.querySelectorAll('[data-testid="recent-projects-list"] [data-project-status]')].map((card) => ({
      status: card.getAttribute('data-project-status'),
      text: card.textContent?.trim() ?? '',
    })),
    missingStatus: [...document.querySelectorAll('[data-testid="recent-projects-list"] [data-project-status="missing"]')]
      .map((card) => card.textContent?.trim() ?? '')
      .join(' | '),
  }))()`);
}

async function capture(window, fileName) {
  await delay(300);
  await writeFile(
    path.join(evidenceRoot, fileName),
    (await window.webContents.capturePage()).toPNG(),
  );
}

async function waitForMainWindow() {
  await app.whenReady();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      const url = candidate.webContents.getURL();
      return !url.includes('hidden.html');
    });
    if (window) {
      await waitForDom(
        window,
        `document.querySelector('[data-testid="project-center-screen"]')`,
        'Project Center did not render in the real Electron window.',
      );
      return window;
    }
    await delay(40);
  }
  throw new Error('Real Electron main window did not become ready.');
}

async function createFixtures() {
  const projectService = new ProjectService();
  const projectA = await projectService.create(projectARoot, {
    name: 'Issue 102 Project A',
  });

  mkdirSync(missingProjectRoot, { recursive: true });
  writeFileSync(missingProjectSentinel, 'must-survive-remove-record\n', 'utf8');
  const missingProject = {
    ...projectA.project,
    id: randomUUID(),
    name: 'Issue 102 Missing Project',
  };
  const missingDocument = {
    ...projectA,
    projectRoot: missingProjectRoot,
    projectFilePath: path.join(missingProjectRoot, 'project.json'),
    project: missingProject,
  };
  const recentProjects = new RecentProjectsService({
    configurationFilePath: path.join(
      electronUserDataRoot,
      'recent-projects.json',
    ),
    pathService: new PathService(),
  });
  await recentProjects.record(projectA);
  await recentProjects.record(missingDocument);
  return { projectA, missingDocument };
}

async function run(window, fixture) {
  const result = {
    issue: 102,
    task: 1,
    checks: [],
    snapshots: {},
    disk: {
      acceptanceRoot,
      projectsRoot,
      electronUserDataRoot,
      tempRoot,
      evidenceRoot,
      missingProjectSentinel,
    },
  };

  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]') &&
      !document.querySelector('[data-testid="editor-layout"]') &&
      document.querySelector('[data-testid="new-project-button"]')`,
    'Startup did not land on the Project Center page.',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-project-status="available"]') &&
      document.querySelector('[data-project-status="missing"]')`,
    'Recent project cards did not show available and invalid-path states.',
  );
  const startup = await snapshot(window);
  assert(startup.page === 'project-center', 'Startup page is not project-center.');
  assert(!startup.hasEditorLayout, 'Editor layout mounted before a project opened.');
  assert(
    startup.missingStatus.includes('路径已失效'),
    'Missing recent project did not show an understandable invalid-path status.',
  );
  await capture(window, 'project-center-start.png');
  result.snapshots.startup = startup;
  result.checks.push('Startup opens Project Center with recent status cards');

  await clickCardButton(window, 'available', '打开');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(fixture.projectA.projectRoot)}`,
    'Opening a recent available project did not enter the editor.',
  );
  const opened = await snapshot(window);
  assert(opened.shellState === 'editor', 'Recent project did not become the active project.');
  assert(opened.activeRoot === fixture.projectA.projectRoot, 'Recent project root was not preserved.');
  result.snapshots.opened = opened;
  result.checks.push('Recent available project opens through the existing session flow');

  await openProjectCenter(window);
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]') &&
      document.querySelector('[data-editor-shell-state="editor"]') &&
      document.querySelector('[data-testid="project-center-current-project"]')`,
    'Opening Project Center cleared the current project or failed to render the current card.',
  );
  const centerWithCurrent = await snapshot(window);
  assert(
    centerWithCurrent.currentProjectRoot === fixture.projectA.projectRoot,
    'Project Center did not retain the current project root.',
  );
  assert(
    centerWithCurrent.currentProjectName === fixture.projectA.project.name,
    'Project Center did not retain the current project name.',
  );
  await capture(window, 'project-center-current-project.png');
  result.snapshots.centerWithCurrent = centerWithCurrent;
  result.checks.push('Current project stays open while Project Center is visible');

  assert(
    centerWithCurrent.missingStatus.includes('路径已失效'),
    'Invalid recent path status disappeared while a current project was open.',
  );
  await clickSelector(
    window,
    '[data-project-status="missing"] [data-testid="recent-project-more"]',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-project-status="missing"] ` +
      `[data-testid="recent-project-maintenance-menu"]')`,
    'Missing recent project maintenance menu did not open.',
  );
  await clickSelector(
    window,
    '[data-project-status="missing"] [data-task4-core="recent-remove"]',
  );
  await waitForDom(
    window,
    `!document.querySelector('[data-project-status="missing"]')`,
    'Removing an invalid recent record did not update the Project Center list.',
  );
  const afterRemove = await snapshot(window);
  assert(
    existsSync(missingProjectSentinel),
    'Removing a recent record deleted a file from the project directory.',
  );
  assert(
    afterRemove.currentProjectRoot === fixture.projectA.projectRoot,
    'Removing an invalid recent record cleared the current project.',
  );
  result.snapshots.afterRemove = afterRemove;
  result.disk.sentinelAfterRemove = readFileSync(
    missingProjectSentinel,
    'utf8',
  );
  result.checks.push('Invalid recent record is removable without deleting its disk project or clearing current state');

  await clickSelector(window, '[data-testid="return-to-editor"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(fixture.projectA.projectRoot)}`,
    'Returning from Project Center did not restore the editor page.',
  );
  const returned = await snapshot(window);
  assert(returned.activeRoot === fixture.projectA.projectRoot, 'Return to editor changed the active project.');
  result.snapshots.returned = returned;
  result.checks.push('Returning to editor keeps the same active project');
  return result;
}

async function main() {
  const output = {
    issue: 102,
    task: 1,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    disk: {
      acceptanceRoot,
      projectsRoot,
      electronUserDataRoot,
      tempRoot,
      evidenceRoot,
      repositoryEvidenceRoot,
    },
    error: null,
  };
  let window = null;
  try {
    const fixture = await createFixtures();
    window = await waitForMainWindow();
    const result = await run(window, fixture);
    Object.assign(output, result, { passed: true });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    await mkdir(repositoryEvidenceRoot, { recursive: true });
    await writeFile(
      path.join(repositoryEvidenceRoot, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    if (window && !window.isDestroyed()) window.close();
    app.quit();
    const exitCode = process.exitCode ?? (output.passed ? 0 : 1);
    setTimeout(() => process.exit(exitCode), 1_000);
  }
}

require('../dist-electron/main/index.js');
void main();
