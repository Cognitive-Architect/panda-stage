const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\project-center-v1';
const evidenceRoot = path.join(acceptanceRoot, 'evidence', 'task4');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-102/task4',
);
const projectARoot = path.join(
  acceptanceRoot,
  'projects-task4',
  'issue102-responsive-a.pandastage',
);
const projectBRoot = path.join(
  acceptanceRoot,
  'projects-task4',
  'issue102-responsive-b.pandastage',
);
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
        // React may be between Project Center and editor pages.
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

async function measure(window) {
  return window.webContents.executeJavaScript(`(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        bottom: Math.round(rect.bottom * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      };
    };
    const metrics = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      return {
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const cards = [...document.querySelectorAll(
      '[data-testid="recent-projects-list"] [data-project-status]',
    )].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      };
    });
    const coreButtons = [...document.querySelectorAll('button[data-task4-core]')]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute('data-task4-core'),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          disabled: element instanceof HTMLButtonElement && element.disabled,
        };
      });
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: {
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        root: document.querySelector('#root')?.scrollWidth ?? null,
      },
      page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
      topBar: box('[data-testid="compact-project-bar"]'),
      editorBody: box('[data-testid="editor-body"]'),
      canvas: box('[data-testid="canvas-workspace-scroll"]'),
      inspector: box('[data-testid="right-inspector-placeholder"]'),
      bottom: box('[data-testid="bottom-workspace"]'),
      bottomMetrics: metrics('[data-testid="bottom-workspace"]'),
      historyMetrics: metrics('[data-testid="history-controls"]'),
      menu: box('[data-testid="compact-project-menu"]'),
      projectCenter: box('[data-testid="project-center-screen"]'),
      recentList: box('[data-testid="recent-projects-list"]'),
      cards,
      coreButtons,
    };
  })()`);
}

function assertNoHorizontalOverflow(sample, label) {
  const { viewport, scroll } = sample;
  assert(
    scroll.document <= viewport.width + 1 &&
      scroll.body <= viewport.width + 1 &&
      (scroll.root === null || scroll.root <= viewport.width + 1),
    `${label} has page-level horizontal overflow: ${JSON.stringify({ viewport, scroll })}`,
  );
}

function assertCoreButtons(sample, label) {
  assert(sample.coreButtons.length > 0, `${label} exposed no Task 4 core buttons.`);
  const undersized = sample.coreButtons.filter(
    (button) => button.width < 44 || button.height < 44,
  );
  assert(
    undersized.length === 0,
    `${label} has undersized core buttons: ${JSON.stringify(undersized)}`,
  );
  const outside = sample.coreButtons.filter(
    (button) => button.left < -1 || button.right > sample.viewport.width + 1,
  );
  assert(
    outside.length === 0,
    `${label} has core buttons outside the viewport: ${JSON.stringify(outside)}`,
  );
}

function assertRecentCards(sample, label) {
  assert(sample.cards.length >= 2, `${label} did not render the recent project cards.`);
  const columns = new Set(sample.cards.map((card) => Math.round(card.left)));
  assert(
    columns.size <= 2,
    `${label} recent cards used more than two columns: ${JSON.stringify(sample.cards)}`,
  );
  assert(
    sample.cards.every(
      (card) => card.width > 0 && card.right <= sample.viewport.width + 1,
    ),
    `${label} recent cards are not contained in the viewport: ${JSON.stringify(sample.cards)}`,
  );
}

function assertCompactBottom(sample, label, maxHeight = 96) {
  assert(
    sample.bottom && sample.bottomMetrics && sample.historyMetrics,
    `${label} does not expose the live BottomWorkspace and HistoryControls surfaces.`,
  );
  assert(
    sample.bottom.height >= 52 && sample.bottom.height <= maxHeight,
    `${label} bottom workspace is not compact: ${JSON.stringify(sample.bottom)}`,
  );
  assert(
    sample.bottomMetrics.overflow === 'hidden' &&
      sample.bottomMetrics.overflowX === 'hidden' &&
      sample.bottomMetrics.overflowY === 'hidden',
    `${label} bottom workspace uses an unexpected overflow mode: ${JSON.stringify(sample.bottomMetrics)}`,
  );
  assert(
    sample.bottomMetrics.scrollWidth <= sample.bottomMetrics.clientWidth + 1 &&
      sample.historyMetrics.scrollWidth <= sample.historyMetrics.clientWidth + 1 &&
      sample.bottomMetrics.scrollHeight <= sample.bottomMetrics.clientHeight + 1 &&
      sample.historyMetrics.scrollHeight <= sample.historyMetrics.clientHeight + 1,
    `${label} bottom history content is clipped inside its compact surface: ${JSON.stringify({ bottom: sample.bottomMetrics, history: sample.historyMetrics })}`,
  );
}

function assertEditorRegions(sample, label) {
  assert(sample.page === 'editor', `${label} is not on the editor page.`);
  assert(sample.topBar && sample.topBar.height <= 56.5, `${label} top bar exceeded 56px.`);
  for (const [name, region] of [
    ['editor body', sample.editorBody],
    ['canvas', sample.canvas],
    ['right inspector', sample.inspector],
    ['bottom workspace', sample.bottom],
  ]) {
    assert(region && region.width > 0 && region.height > 0, `${label} ${name} is not visible.`);
    assert(
      region.right <= sample.viewport.width + 1 &&
        region.bottom <= sample.viewport.height + 1,
      `${label} ${name} escaped the viewport: ${JSON.stringify(region)}`,
    );
  }
  assertCompactBottom(sample, label);
}

function assertMenuContained(sample, label) {
  assert(sample.menu, `${label} more menu did not render.`);
  assert(
    sample.menu.left >= -1 &&
      sample.menu.right <= sample.viewport.width + 1 &&
      sample.menu.bottom <= sample.viewport.height + 1,
    `${label} more menu was clipped: ${JSON.stringify(sample.menu)}`,
  );
}

function documentFor(projectRoot, project) {
  return {
    projectRoot,
    projectFilePath: `${projectRoot}\\project.json`,
    project,
    migrated: false,
    sourceVersion: 5,
  };
}

function projectFixture(id, name) {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.id = id;
  project.name = name;
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
  );
  return project;
}

async function waitForMainWindow() {
  await app.whenReady();
  const window = await createMainWindow({ show: false });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The real Electron Project Center did not render.',
  );
  return window;
}

async function run() {
  const projectA = projectFixture(
    'a0400000-0000-4000-8000-000000000001',
    'Issue 102 Responsive Project A',
  );
  const projectB = projectFixture(
    'b0400000-0000-4000-8000-000000000001',
    'Issue 102 Responsive Project B',
  );
  const projects = new Map([
    [projectARoot, projectA],
    [projectBRoot, projectB],
  ]);
  const recentEntries = [
    {
      projectId: projectA.id,
      projectName: projectA.name,
      projectRoot: projectARoot,
      lastOpenedAt: '2026-08-06T00:00:00.000Z',
      status: 'available',
    },
    {
      projectId: projectB.id,
      projectName: projectB.name,
      projectRoot: projectBRoot,
      lastOpenedAt: '2026-08-06T00:01:00.000Z',
      status: 'available',
    },
  ];
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
    const project = projects.get(request.projectRoot);
    return project
      ? { ok: true, value: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Responsive gate project not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({
    outcome: 'saved',
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: recentEntries,
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const project = projects.get(request.projectRoot);
    return project
      ? { ok: true, document: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_RELOCATE_FAILED',
            message: 'Responsive gate recent project not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
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
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = [...projects.values()]
      .flatMap((project) => project.assets)
      .find((candidate) => candidate.id === request.assetId);
    if (!asset || asset.kind !== 'image') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Task 4 fixture image asset was not found.',
          assetId: request.assetId,
        },
      };
    }
    const bytes = Buffer.from(probePng, 'base64');
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
  });

  const window = await waitForMainWindow();
  const result = {
    issue: 102,
    task: 4,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
  };

  try {
    window.setContentSize(1280, 720);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="recent-projects-list"]')`,
      'The 1280px Project Center recent-project list did not render.',
    );
    const center1280 = await measure(window);
    assertNoHorizontalOverflow(center1280, '1280px Project Center');
    assertCoreButtons(center1280, '1280px Project Center');
    assertRecentCards(center1280, '1280px Project Center');
    result.snapshots.projectCenter1280 = center1280;
    result.checks.push('1280x720 Project Center has contained recent cards, no page overflow, and 44px core targets');
    result.screenshots.projectCenter1280 = path.join(
      evidenceRoot,
      'task4-project-center-1280.png',
    );
    await capture(window, 'task4-project-center-1280.png');

    await click(
      window,
      '[data-project-status="available"] [data-task4-core="recent-open"]',
    );
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]') &&
        document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(projectARoot)}`,
      'The recent project did not open in the editor at 1280x720.',
    );
    const editor1280 = await measure(window);
    assertNoHorizontalOverflow(editor1280, '1280px editor');
    assertCoreButtons(editor1280, '1280px editor');
    assertEditorRegions(editor1280, '1280px editor');
    result.snapshots.editor1280 = editor1280;
    result.checks.push('1280x720 editor keeps the compact bar, canvas, inspector, and bottom workspace visible');
    result.screenshots.editor1280 = path.join(
      evidenceRoot,
      'task4-editor-1280.png',
    );
    await capture(window, 'task4-editor-1280.png');

    await click(window, '[data-testid="compact-project-more"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="compact-project-menu"]')`,
      'The 1280px more menu did not render.',
    );
    const menu1280 = await measure(window);
    assertNoHorizontalOverflow(menu1280, '1280px editor menu');
    assertCoreButtons(menu1280, '1280px editor menu');
    assertMenuContained(menu1280, '1280px editor menu');
    result.snapshots.menu1280 = menu1280;
    result.checks.push('1280x720 more menu stays fully inside the window');
    result.screenshots.menu1280 = path.join(
      evidenceRoot,
      'task4-menu-1280.png',
    );
    await capture(window, 'task4-menu-1280.png');
    await click(window, '[data-testid="compact-project-more"]');

    window.setContentSize(1024, 720);
    await delay(260);
    const editor1024 = await measure(window);
    assertNoHorizontalOverflow(editor1024, '1024px editor');
    assertCoreButtons(editor1024, '1024px editor');
    assertEditorRegions(editor1024, '1024px editor');
    result.snapshots.editor1024 = editor1024;
    result.checks.push('1024px narrow editor remains contained and keeps all three work regions visible');
    result.screenshots.editor1024 = path.join(
      evidenceRoot,
      'task4-editor-1024.png',
    );
    await capture(window, 'task4-editor-1024.png');

    await click(window, '[data-testid="compact-project-more"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="compact-project-menu"]')`,
      'The 1024px more menu did not render.',
    );
    const menu1024 = await measure(window);
    assertNoHorizontalOverflow(menu1024, '1024px editor menu');
    assertCoreButtons(menu1024, '1024px editor menu');
    assertMenuContained(menu1024, '1024px editor menu');
    result.snapshots.menu1024 = menu1024;
    result.checks.push('1024px narrow more menu is not clipped at the window edge');
    result.screenshots.menu1024 = path.join(
      evidenceRoot,
      'task4-menu-1024.png',
    );
    await capture(window, 'task4-menu-1024.png');
    await click(window, '[data-testid="compact-project-more"]');

    await click(window, '[data-testid="open-project-center"]');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="project-center"]')`,
      'The 1024px Project Center did not open from the compact bar.',
    );
    const center1024 = await measure(window);
    assertNoHorizontalOverflow(center1024, '1024px Project Center');
    assertCoreButtons(center1024, '1024px Project Center');
    assertRecentCards(center1024, '1024px Project Center');
    result.snapshots.projectCenter1024 = center1024;
    result.checks.push('1024px Project Center keeps recent cards in a stable single/two-column layout');
    result.screenshots.projectCenter1024 = path.join(
      evidenceRoot,
      'task4-project-center-1024.png',
    );
    await capture(window, 'task4-project-center-1024.png');

    await click(
      window,
      '[data-project-status="available"] [data-task4-core="recent-open"]',
    );
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]') &&
        document.querySelector('[data-testid="active-project-path"] code')?.textContent?.trim() === ${JSON.stringify(projectARoot)}`,
      'The recent project did not reopen in the editor for the minimum-width check.',
    );
    window.setContentSize(800, 720);
    await delay(260);
    const editorMinimum = await measure(window);
    assertNoHorizontalOverflow(editorMinimum, 'minimum-width editor');
    assertCoreButtons(editorMinimum, 'minimum-width editor');
    assertEditorRegions(editorMinimum, 'minimum-width editor');
    result.snapshots.editorMinimum = editorMinimum;
    result.checks.push('Minimum-width editor keeps the compact bottom history within the viewport');
    result.screenshots.editorMinimum = path.join(
      evidenceRoot,
      'task4-editor-minimum-width.png',
    );
    await capture(window, 'task4-editor-minimum-width.png');

    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');

app.on('window-all-closed', () => {});

async function main() {
  const output = {
    issue: 102,
    task: 4,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
    evidenceRoot,
    repositoryEvidenceRoot,
    error: null,
  };
  try {
    Object.assign(output, await run());
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
    const exitCode = output.passed ? 0 : 1;
    setTimeout(() => app.exit(exitCode), 1_000);
  }
}

void main();
