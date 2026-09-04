const { app, BrowserWindow } = require('electron');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const forceFailure = process.argv.includes('--force-failure');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\project-center-v1';
const projectsRoot = path.join(acceptanceRoot, 'projects-task2');
const logsRoot = path.join(acceptanceRoot, 'logs-task2');
const tempRoot = path.join(acceptanceRoot, 'temp-task2');
const electronUserDataRoot = path.join(
  acceptanceRoot,
  'electron-user-data-task2',
);
const evidenceRoot = path.join(acceptanceRoot, 'evidence', 'task2');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-102/task2',
);
const baselinePath = path.join(repositoryEvidenceRoot, 'baseline.json');
const projectRoot = path.join(
  projectsRoot,
  'issue102-compact-project.pandastage',
);
const projectName =
  'Issue 102 Compact Project — a deliberately long project name for ellipsis verification — Issue 102 Compact Project — a deliberately long project name for ellipsis verification — ellipsis proof';

rmSync(projectsRoot, { recursive: true, force: true });
rmSync(electronUserDataRoot, { recursive: true, force: true });
rmSync(evidenceRoot, { recursive: true, force: true });
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
    // Some Electron path keys are only available after app readiness.
  }
}

const { ProjectService } = require(
  '../dist-electron/main/services/ProjectService.js',
);
const exampleProject = require('../demo-project/project-v1.example.json');
const { migrateProject } = require(
  '../dist-electron/domain/migrations/index.js',
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
  await delay(140);
}

async function capture(window, fileName) {
  await delay(220);
  writeFileSync(
    path.join(evidenceRoot, fileName),
    (await window.webContents.capturePage()).toPNG(),
  );
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value
        ? {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
          }
        : null;
    };
    const bar = document.querySelector('[data-testid="compact-project-bar"]');
    const topRegion = document.querySelector('[data-testid="editor-top-region"]');
    const body = document.querySelector('[data-testid="editor-body"]');
    const layout = document.querySelector('[data-testid="editor-layout"]');
    const bottomWorkspace = document.querySelector('[data-testid="bottom-workspace"]');
    const name = bar?.querySelector('.compact-project-name');
    const controls = bar?.querySelector('.compact-project-controls');
    const save = bar?.querySelector('[data-testid="compact-project-save"]');
    const menu = document.querySelector('[data-testid="compact-project-menu"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
      shellState:
        document.querySelector('.editor-shell')?.dataset.editorShellState ?? null,
      projectName: name?.textContent?.trim() ?? null,
      projectPath:
        bar?.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() ?? null,
      // The saved pill is intentionally hidden; data-save-state remains the truth.
      saveState: bar?.querySelector('[data-testid="project-save-state"]')?.textContent?.trim() ?? null,
      saveStateCode: bar?.getAttribute('data-save-state') ?? null,
      saveDisabled: save instanceof HTMLButtonElement ? save.disabled : null,
      pathInputs: bar?.querySelectorAll('input').length ?? 0,
      nameEllipsis: name
        ? {
            clientWidth: name.clientWidth,
            scrollWidth: name.scrollWidth,
            overflow: getComputedStyle(name).overflow,
            textOverflow: getComputedStyle(name).textOverflow,
            whiteSpace: getComputedStyle(name).whiteSpace,
          }
        : null,
      compactBar: rect(bar),
      topRegion: rect(topRegion),
      editorBody: rect(body),
      editorLayout: rect(layout),
      bottomWorkspace: rect(bottomWorkspace),
      controls: rect(controls),
      save: rect(save),
      menu: rect(menu),
      menuItems: menu
        ? [...menu.querySelectorAll('[role="menuitem"]')].map((item) => ({
            testId: item.getAttribute('data-testid'),
            text: item.textContent?.trim() ?? '',
            disabled: item instanceof HTMLButtonElement ? item.disabled : false,
          }))
        : [],
    };
  })()`);
}

function overlaps(first, second) {
  if (!first || !second) return false;
  return !(
    first.right <= second.x ||
    second.right <= first.x ||
    first.bottom <= second.y ||
    second.bottom <= first.y
  );
}

async function waitForMainWindow() {
  await app.whenReady();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      return !candidate.webContents.getURL().includes('hidden.html');
    });
    if (window) {
      window.setContentSize(1280, 720);
      await waitForDom(
        window,
        `document.querySelector('[data-testid="start-screen"]')`,
        'Project Center did not render in the real Electron window.',
      );
      return window;
    }
    await delay(40);
  }
  throw new Error('Real Electron main window did not become ready.');
}

async function createFixture() {
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, { name: projectName });
  const seededProject = migrateProject({
    ...exampleProject,
    id: created.project.id,
    name: projectName,
  });
  await projectService.save(projectRoot, seededProject);
  return {
    ...created,
    project: seededProject,
  };
}

async function run(window, fixture) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const oldScreenshot = path.join(evidenceRoot, 'old-editor-layout.png');
  if (existsSync(baseline.screenshot)) {
    copyFileSync(baseline.screenshot, oldScreenshot);
  }
  const source = readFileSync(
    path.join(repositoryRoot, 'src/renderer/shell/CompactProjectBar.tsx'),
    'utf8',
  );
  const result = {
    issue: 102,
    task: 2,
    window: { width: 1280, height: 720 },
    checks: [],
    baseline,
    snapshots: {},
    screenshots: {
      old: oldScreenshot,
      oldBaselineCapture: baseline.screenshot,
      new: path.join(evidenceRoot, 'new-editor-layout.png'),
      newMenu: path.join(evidenceRoot, 'new-editor-menu.png'),
    },
    disk: {
      acceptanceRoot,
      projectRoot,
      evidenceRoot,
      repositoryEvidenceRoot,
    },
  };

  assert(
    source.includes("saved: '已保存'") &&
      source.includes("dirty: '有未保存更改'") &&
      source.includes("saving: '保存中'") &&
      source.includes("failed: '保存失败'"),
    'CompactProjectBar does not declare all four required save-state labels.',
  );
  result.checks.push('Source contract declares 已保存 / 有未保存更改 / 保存中 / 保存失败');

  await setInput(
    window,
    '[data-testid="start-screen"] .recovery-open-row input',
    fixture.projectRoot,
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="start-screen"] .recovery-open-row button')?.disabled === false`,
    'Project Center open button did not become enabled.',
  );
  await clickSelector(
    window,
    '[data-testid="start-screen"] .recovery-open-row button',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(fixture.projectRoot)}`,
    'Opening the Task 2 fixture did not enter the editor.',
  );

  const clean = await snapshot(window);
  assert(clean.page === 'editor', 'Clean snapshot is not on the editor page.');
  assert(clean.projectName === projectName, 'Current project name is not visible.');
  assert(clean.projectPath === fixture.projectRoot, 'Current project path is not visible.');
  assert(
    clean.saveState === null,
    'Clean save-state pill should be absent from the compact bar.',
  );
  assert(clean.saveStateCode === 'saved', 'Clean save-state code is not saved.');
  assert(clean.saveDisabled === true, 'Save button must be disabled when clean.');
  assert(clean.pathInputs === 0, 'Editor top project area still contains a path input.');
  assert(clean.compactBar && clean.compactBar.height <= 56.5, 'Compact project bar exceeds 56px.');
  assert(clean.topRegion && clean.topRegion.height <= 56.5, 'Editor top project region exceeds 56px.');
  assert(
    clean.viewport.width === 1280 && clean.viewport.height === 720,
    'Task 2 measurement did not run at the required 1280x720 window size.',
  );
  assert(
    clean.nameEllipsis?.overflow === 'hidden' &&
      clean.nameEllipsis?.textOverflow === 'ellipsis' &&
      clean.nameEllipsis?.whiteSpace === 'nowrap' &&
      clean.nameEllipsis.scrollWidth > clean.nameEllipsis.clientWidth,
    'Long project names do not have the required ellipsis CSS contract.',
  );
  const reclaimedTopChrome =
    (baseline.oldProjectArea?.height ?? 0) - (clean.topRegion?.height ?? 0);
  const editorBodyNetGain =
    (clean.editorBody?.height ?? 0) - (baseline.oldEditorBody?.height ?? 0);
  assert(
    reclaimedTopChrome >= 140,
    `Editor top-chrome reclamation is only ${reclaimedTopChrome.toFixed(2)}px.`,
  );
  clean.verticalGainComparedWithOld = reclaimedTopChrome;
  clean.editorBodyNetGainComparedWithOld = editorBodyNetGain;
  result.snapshots.clean = clean;
  result.checks.push(
    'Compact bar is <=56px, saved truth stays on the bar, and old editor input is gone',
  );
  result.checks.push(
    `Compact project chrome reclaims ${reclaimedTopChrome.toFixed(2)}px at the same 1280x720 window size`,
  );
  result.checks.push(
    `Editor body net gain is ${editorBodyNetGain.toFixed(2)}px after the separately owned BottomWorkspace allocation`,
  );
  await capture(window, 'new-editor-layout.png');

  await setInput(window, '.shot-fields label:nth-of-type(1) input', 'Task 2 dirty state');
  await clickSelector(window, '.shot-fields label:nth-of-type(1) button');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-save-state"]')?.textContent?.trim() === '有未保存更改' &&
      document.querySelector('[data-testid="compact-project-save"]')?.disabled === false`,
    'Dirty state did not expose the required label and enabled save button.',
  );
  const dirty = await snapshot(window);
  assert(dirty.saveState === '有未保存更改', 'Dirty save state is not 有未保存更改.');
  assert(dirty.saveStateCode === 'dirty', 'Dirty save-state code is not dirty.');
  assert(dirty.saveDisabled === false, 'Save button must be enabled when dirty.');
  result.snapshots.dirty = dirty;
  result.checks.push('Dirty project shows 有未保存更改 and enables 保存');

  await clickSelector(window, '[data-testid="compact-project-save"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-save-state"]') === null &&
      document.querySelector('[data-testid="compact-project-bar"]')?.getAttribute('data-save-state') === 'saved' &&
      document.querySelector('[data-testid="compact-project-save"]')?.disabled === true`,
    'Save action did not restore saved truth while keeping the saved-state pill hidden.',
  );
  const saved = await snapshot(window);
  assert(saved.saveState === null, 'Saved save-state pill should remain absent.');
  assert(saved.saveStateCode === 'saved', 'Saved save-state code is not saved.');
  assert(saved.saveDisabled === true, 'Save button must be disabled after saving.');
  result.snapshots.saved = saved;
  result.checks.push(
    'Save action restores saved truth, keeps the saved-state pill hidden, and disables 保存',
  );

  await clickSelector(window, '[data-testid="compact-project-more"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="compact-project-menu"]')`,
    'Compact project menu did not open.',
  );
  const menu = await snapshot(window);
  const menuIds = new Set(menu.menuItems.map((item) => item.testId));
  for (const requiredId of [
    'menu-open-project-center',
    'menu-open-project-folder',
    'menu-close-project',
  ]) {
    assert(menuIds.has(requiredId), `Project menu is missing ${requiredId}.`);
  }
  assert(
    menu.menuItems.some((item) => item.text === '打开项目中心') &&
      menu.menuItems.some((item) => item.text === '打开项目文件夹') &&
      menu.menuItems.some((item) => item.text === '关闭当前项目'),
    'Project menu labels do not match the Task 2 requirements.',
  );
  assert(menu.menu && menu.menu.right <= menu.viewport.width + 1, 'Project menu overflows the right edge.');
  assert(menu.menu && !overlaps(menu.menu, menu.controls), 'Project menu blocks the save/identity controls.');
  result.snapshots.menu = menu;
  result.checks.push('更多 menu exposes Project Center / folder / close actions without covering bar controls');
  await capture(window, 'new-editor-menu.png');

  await clickSelector(window, '[data-testid="menu-open-project-center"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="project-center"]') &&
      document.querySelector('[data-testid="project-center-current-project"]')`,
    'Menu Project Center entry did not retain the current project.',
  );
  result.snapshots.projectCenter = await window.webContents.executeJavaScript(`(() => ({
    page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
    projectName: document.querySelector('[data-testid="project-center-current-project"] h3')?.textContent?.trim() ?? null,
    projectRoot: document.querySelector('[data-testid="project-center-current-project"] .project-center-current-path')?.textContent?.trim() ?? null,
  }))()`);
  assert(result.snapshots.projectCenter.projectName === projectName, 'Project Center entry lost the current project name.');
  assert(result.snapshots.projectCenter.projectRoot === fixture.projectRoot, 'Project Center entry lost the current project root.');
  await clickSelector(window, '[data-testid="return-to-editor"]');
  await waitForDom(
    window,
    `document.querySelector('[data-editor-page="editor"]') &&
      document.querySelector('[data-testid="compact-project-bar"]')`,
    'Returning from Project Center did not restore the compact editor bar.',
  );
  result.checks.push('打开项目中心 returns to editor with the same project identity');
  return result;
}

async function main() {
  const output = {
    issue: 102,
    task: 2,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    baseline: null,
    snapshots: {},
    screenshots: {},
    disk: {
      acceptanceRoot,
      projectsRoot,
      evidenceRoot,
      repositoryEvidenceRoot,
    },
    error: null,
  };
  try {
    const fixture = await createFixture();
    const window = await waitForMainWindow();
    const result = await run(window, fixture);
    assert(!forceFailure, 'Forced Issue #228 verifier failure.');
    Object.assign(output, result, { passed: true });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    output.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(output.error);
    process.exitCode = 1;
  } finally {
    mkdirSync(repositoryEvidenceRoot, { recursive: true });
    writeFileSync(
      path.join(repositoryEvidenceRoot, 'results.json'),
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8',
    );
    const exitCode = process.exitCode ?? (output.passed ? 0 : 1);
    app.exit(exitCode);
  }
}

require('../dist-electron/main/index.js');
void main();
