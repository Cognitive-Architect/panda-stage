const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-109-resource-workspace';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-109/resource-workspace',
);
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue109-resource-workspace.pandastage',
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
        // React may be between project center, editor, and drawer states.
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
  await delay(160);
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
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
    };
    const scroll = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    const drawer = document.querySelector('[data-testid="resource-activity-drawer"]');
    const buttons = [...document.querySelectorAll(
      '[data-testid="resource-activity-panel"] button',
    )].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? '',
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        writingMode: getComputedStyle(element).writingMode,
      };
    });
    const horizontalOverflow = [
      document.querySelector('[data-testid="resource-activity-panel"]'),
      ...document.querySelectorAll('[data-testid="resource-activity-panel"] *'),
    ].filter((element) => element instanceof HTMLElement &&
      element.scrollWidth > element.clientWidth + 1
    ).map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: element.className,
      testId: element.getAttribute('data-testid'),
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: element.textContent?.trim().slice(0, 80) ?? '',
    }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
      mode: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceMode ?? null,
      drawerOpen: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen ?? null,
      drawerVisible: visible(drawer),
      drawer: box('[data-testid="resource-activity-drawer"]'),
      handle: box('[data-testid="resource-workspace-handle"]'),
      left: box('[data-testid="left-workspace-scroll"]'),
      body: box('[data-testid="editor-body"]'),
      canvas: box('[data-testid="canvas-workspace-scroll"]'),
      inspector: box('[data-testid="right-inspector-placeholder"]'),
      inspectorRail: box('[data-testid="inspector-rail-handle"]'),
      bottom: box('[data-testid="bottom-workspace"]'),
      bottomMetrics: metrics('[data-testid="bottom-workspace"]'),
      historyMetrics: metrics('[data-testid="history-controls"]'),
      activeActivity: document.querySelector('[data-testid="resource-activity-panel"]')?.getAttribute('data-active-activity') ?? null,
      activeSubview: document.querySelector('[data-testid="resource-activity-panel"]')?.getAttribute('data-active-subview') ?? null,
      listView: visible(document.querySelector('[data-testid="shot-list-view"]')),
      shotCreateView: visible(document.querySelector('[data-testid="shot-create-view"]')),
      assetBrowserView: visible(document.querySelector('[data-testid="asset-browser-view"]')),
      assetDetailsView: visible(document.querySelector('[data-testid="asset-details-view"]')),
      characterListView: visible(document.querySelector('[data-testid="character-list-view"]')),
      characterCreateView: visible(document.querySelector('[data-testid="character-create-view"]')),
      characterDetailView: visible(document.querySelector('[data-testid="character-detail-view"]')),
      characterExpressionView: visible(document.querySelector('[data-testid="character-expression-view"]')),
      activePanelScroll: scroll('[data-testid="resource-activity-panel"]'),
      drawerBodyScroll: scroll('.resource-activity-body'),
      horizontalOverflow,
      pageScroll: {
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        root: document.querySelector('#root')?.scrollWidth ?? null,
      },
      dirty: Boolean(document.querySelector('.dirty-state')),
      revision: Number(document.querySelector('[data-testid="project-canvas-stage"]')?.getAttribute('data-project-revision') ?? NaN),
      buttons,
    };
  })()`);
}

function assertNoPageOverflow(sample, label) {
  assert(
    sample.pageScroll.document <= sample.viewport.width + 1 &&
      sample.pageScroll.body <= sample.viewport.width + 1 &&
      (sample.pageScroll.root === null || sample.pageScroll.root <= sample.viewport.width + 1),
    `${label} has page-level horizontal overflow: ${JSON.stringify(sample.pageScroll)}`,
  );
}

function assertCompactBottom(sample, label) {
  assert(
    sample.bottom && sample.bottomMetrics && sample.historyMetrics,
    `${label} does not expose the live BottomWorkspace and HistoryControls surfaces.`,
  );
  assert(
    sample.bottom.height >= 52 && sample.bottom.height <= 172,
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

// The right inspector collapses to a 56px rail below 1100px (Issue #192), at which
// point its full-panel measurement hook is display:none. Measure the visible rail
// handle at narrow widths; otherwise keep measuring the full-panel placeholder.
const NARROW_BREAKPOINT = 1100;
function pickInspectorRegion(sample) {
  if (sample.viewport.width <= NARROW_BREAKPOINT && sample.inspectorRail) {
    return sample.inspectorRail;
  }
  return sample.inspector;
}

function assertRegions(sample, label) {
  assert(sample.page === 'editor', `${label} is not on the editor page.`);
  for (const [name, region] of [
    ['canvas', sample.canvas],
    ['right inspector', pickInspectorRegion(sample)],
    ['bottom workspace', sample.bottom],
  ]) {
    assert(region && region.width > 0 && region.height > 0, `${label} ${name} is not visible.`);
    assert(
      region.left >= -1 &&
        region.right <= sample.viewport.width + 1 &&
        region.bottom <= sample.viewport.height + 1,
      `${label} ${name} escaped the viewport: ${JSON.stringify(region)}`,
    );
  }
  assertCompactBottom(sample, label);
}

function assertDrawer(sample, label) {
  assertCompactBottom(sample, label);
  assert(sample.drawerVisible && sample.drawer, `${label} drawer is not visible.`);
  assert(
    sample.drawer.left >= -1 &&
      sample.drawer.right <= sample.viewport.width + 1 &&
      sample.drawer.bottom <= sample.viewport.height + 1,
    `${label} drawer escaped the viewport: ${JSON.stringify(sample.drawer)}`,
  );
  if (sample.mode === 'narrow') {
    assert(
      sample.left && sample.drawer.height >= sample.left.height - 4,
      `${label} drawer is not full-height: ${JSON.stringify({ drawer: sample.drawer, left: sample.left })}`,
    );
  }
  for (const [name, scroll] of [
    ['active panel', sample.activePanelScroll],
    ['drawer body', sample.drawerBodyScroll],
  ]) {
    assert(scroll, `${label} ${name} did not render.`);
    assert(
      scroll.scrollWidth <= scroll.clientWidth + 1,
      `${label} ${name} has horizontal scrolling: ${JSON.stringify({ scroll, overflow: sample.horizontalOverflow })}`,
    );
  }
}

function assertButtons(sample, label) {
  assert(sample.buttons.length > 0, `${label} did not expose resource buttons.`);
  const undersized = sample.buttons.filter(
    (button) => button.width < 44 || button.height < 44,
  );
  assert(
    undersized.length === 0,
    `${label} has undersized resource targets: ${JSON.stringify(undersized)}`,
  );
  const vertical = sample.buttons.filter(
    (button) => button.writingMode !== 'horizontal-tb',
  );
  assert(
    vertical.length === 0,
    `${label} has vertically written button labels: ${JSON.stringify(vertical)}`,
  );
}

function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: `${root}\\project.json`,
    project,
    migrated: false,
    sourceVersion: 5,
  };
}

function projectFixture() {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.name = 'Issue 109 Resource Workspace';
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
  );
  return project;
}

async function waitForMainWindow() {
  await app.whenReady();
  const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
  const window = await createMainWindow({ show: false });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The real Electron Project Center did not render.',
  );
  return window;
}

async function run() {
  const project = projectFixture();
  const importCalls = [];
  const channels = [];
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    channels.push(channel);
  };
  const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');

  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, project),
  }));
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [{
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: '2026-08-06T00:00:00.000Z',
      status: 'available',
    }],
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, () => ({
    ok: true,
    document: documentFor(projectRoot, project),
  }));
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => ({
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    dataUrl: `data:image/png;base64,${probePng}`,
  }));
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset || asset.kind !== 'image') {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue 109 fixture image asset was not found.',
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
  register(IPC_CHANNELS.ASSET_IMPORT_CHOOSE, (_event, request) => {
    importCalls.push(request);
    return {
      ok: true,
      status: 'completed',
      project: request.project,
      baseRevision: request.baseRevision,
      savedRevision: request.baseRevision + 1,
      projectChanged: false,
      results: [],
    };
  });

  const window = await waitForMainWindow();
  const result = {
    issue: 109,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
    evidenceRoot,
    repositoryEvidenceRoot,
  };

  try {
    window.show();
    await delay(250);
    window.setContentSize(1280, 720);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="project-center-screen"]')`,
      'The Project Center did not render at 1280px.',
    );
    await click(window, '[data-project-status="available"] [data-task4-core="recent-open"]');
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]') &&
        document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceMode === 'wide'`,
      'The wide resource dock did not render.',
    );
    let sample = await measure(window);
    assertNoPageOverflow(sample, '1280px wide dock');
    assertDrawer(sample, '1280px wide dock');
    assertButtons(sample, '1280px wide dock');
    assert(sample.left && sample.left.width >= 319 && sample.left.width <= 361, '1280px dock is not 320–360px wide.');
    assert(sample.activeActivity === 'shots' && sample.listView && !sample.shotCreateView, 'Wide mode did not default to the shot list.');
    assert(!sample.dirty && sample.revision === 0, 'Opening the resource dock changed project state.');
    result.snapshots.wide1280 = sample;
    result.checks.push('1280x720 uses a 320–360px dock with no page overflow and visible canvas/inspector/bottom regions');
    result.screenshots.wide1280 = path.join(evidenceRoot, 'issue109-wide-dock-1280.png');
    await capture(window, 'issue109-wide-dock-1280.png');

    window.setContentSize(1024, 720);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceMode === 'narrow' &&
        document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`,
      'The narrow resource handle did not close the drawer by default.',
    );
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px closed drawer');
    assertRegions(sample, '1024px closed drawer');
    assert(sample.handle && sample.handle.width >= 48 && sample.handle.width <= 56, 'Narrow resource handle is not 48–56px wide.');
    result.snapshots.narrowClosed = sample;
    result.checks.push('1024x720 keeps a 48–56px resource handle while canvas, inspector, and bottom workspace remain available');

    await click(window, '[data-testid="resource-workspace-handle"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true' &&
        document.querySelector('[data-testid="resource-activity-drawer"]')`,
      'The narrow resource drawer did not open from its handle.',
    );
    await click(window, '[data-testid="resource-primary-action"]');
    await waitForDom(
      window,
      `document.querySelector('[data-testid="shot-create-view"]')`,
      'The shot create subview did not open from the contextual action.',
    );
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px shot create');
    assertDrawer(sample, '1024px shot create');
    assertButtons(sample, '1024px shot create');
    assert(sample.activeActivity === 'shots' && sample.shotCreateView && !sample.listView, 'Shot create view still shows the shot list.');
    assert(!sample.dirty && sample.revision === 0, 'Opening shot create changed project state.');
    result.snapshots.shotCreate1024 = sample;
    result.checks.push('1024px shot create is a dedicated single-column subview without list/form overlap');
    result.screenshots.shotCreate1024 = path.join(evidenceRoot, 'issue109-shot-create-1024.png');
    await capture(window, 'issue109-shot-create-1024.png');

    await click(window, '[data-testid="resource-primary-action"]');
    await waitForDom(window, `document.querySelector('[data-testid="shot-list-view"]')`, 'The shot list did not return.');
    sample = await measure(window);
    assert(sample.listView && !sample.shotCreateView, 'Returning from shot create did not restore the list.');
    result.snapshots.shotList1024 = sample;
    result.screenshots.shotList1024 = path.join(evidenceRoot, 'issue109-shot-list-1024.png');
    await capture(window, 'issue109-shot-list-1024.png');

    await click(window, '[data-testid="resource-activity-tabs"] button[data-activity="assets"]');
    await waitForDom(window, `document.querySelector('[data-testid="asset-browser-view"]')`, 'The asset browser did not open.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px asset browser');
    assertDrawer(sample, '1024px asset browser');
    assert(sample.assetBrowserView && !sample.assetDetailsView, 'Asset browser is not the default asset subview.');
    result.snapshots.assetBrowser1024 = sample;
    result.screenshots.assetBrowser1024 = path.join(evidenceRoot, 'issue109-asset-browser-1024.png');
    await capture(window, 'issue109-asset-browser-1024.png');

    await click(window, '.asset-card');
    await waitForDom(window, `document.querySelector('[data-testid="asset-details-view"]')`, 'Selecting an asset did not open its details subview.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px asset details');
    assertDrawer(sample, '1024px asset details');
    assert(sample.assetDetailsView && !sample.assetBrowserView, 'Asset details still overlaps the browser.');
    result.snapshots.assetDetails1024 = sample;
    result.screenshots.assetDetails1024 = path.join(evidenceRoot, 'issue109-asset-details-1024.png');
    await capture(window, 'issue109-asset-details-1024.png');

    await click(window, '[data-testid="asset-details-back"]');
    await click(window, '[data-testid="resource-primary-action"]');
    await delay(180);
    assert(importCalls.length === 1, 'The asset header import action did not reach the existing import owner.');
    sample = await measure(window);
    assert(!sample.dirty && sample.revision === 0, 'Asset tab, details, or import UI changed project dirty state.');
    result.checks.push('1024px asset browser/details states fit the drawer, use a two-column category/grid layout, and keep import in the sticky header');

    await click(window, '[data-testid="resource-activity-tabs"] button[data-activity="characters"]');
    await waitForDom(window, `document.querySelector('[data-testid="character-list-view"]')`, 'The character list did not open.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px character list');
    assertDrawer(sample, '1024px character list');
    assert(sample.characterListView && !sample.characterCreateView && !sample.characterDetailView, 'Character list is not an isolated default subview.');
    result.snapshots.characterList1024 = sample;
    result.screenshots.characterList1024 = path.join(evidenceRoot, 'issue109-character-list-1024.png');
    await capture(window, 'issue109-character-list-1024.png');

    await click(window, '[data-testid="resource-primary-action"]');
    await waitForDom(window, `document.querySelector('[data-testid="character-create-view"]')`, 'The character create subview did not open.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px character create');
    assertDrawer(sample, '1024px character create');
    assert(sample.characterCreateView && !sample.characterListView && !sample.characterDetailView, 'Character create view still renders the list or detail.');
    result.snapshots.characterCreate1024 = sample;
    result.screenshots.characterCreate1024 = path.join(evidenceRoot, 'issue109-character-create-1024.png');
    await capture(window, 'issue109-character-create-1024.png');

    await click(window, '[data-testid="character-create-back"]');
    await click(window, '.character-list-items button');
    await waitForDom(window, `document.querySelector('[data-testid="character-detail-view"]')`, 'The character detail subview did not open.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px character detail');
    assertDrawer(sample, '1024px character detail');
    assert(sample.characterDetailView && !sample.characterListView && !sample.characterCreateView, 'Character detail view still renders the list or create form.');
    result.snapshots.characterDetail1024 = sample;
    result.screenshots.characterDetail1024 = path.join(evidenceRoot, 'issue109-character-detail-1024.png');
    await capture(window, 'issue109-character-detail-1024.png');

    await click(window, '[data-testid="character-expression-open"]');
    await waitForDom(window, `document.querySelector('[data-testid="character-expression-view"]')`, 'The character expression subview did not open.');
    sample = await measure(window);
    assertNoPageOverflow(sample, '1024px character expression');
    assertDrawer(sample, '1024px character expression');
    assert(sample.characterExpressionView && !sample.characterDetailView, 'Expression view still overlaps character detail.');
    result.snapshots.characterExpression1024 = sample;
    result.screenshots.characterExpression1024 = path.join(evidenceRoot, 'issue109-character-expression-1024.png');
    await capture(window, 'issue109-character-expression-1024.png');

    const beforeClose = await measure(window);
    await click(window, '[data-testid="resource-activity-close"]');
    await waitForDom(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`, 'Close button did not close the drawer.');
    await click(window, '[data-testid="resource-workspace-handle"]');
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitForDom(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`, 'Escape did not close the drawer.');
    await click(window, '[data-testid="resource-workspace-handle"]');
    await click(window, '[data-testid="resource-activity-tabs"] button[data-activity="characters"]');
    await waitForDom(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`, 'Clicking the active narrow tab did not close the drawer.');
    const afterClose = await measure(window);
    assert(!afterClose.dirty && afterClose.revision === beforeClose.revision, 'Drawer open/close changed dirty or revision state.');
    result.checks.push('Drawer close button, Escape, and active-tab toggle close the narrow drawer without changing project state');

    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

async function main() {
  const output = {
    issue: 109,
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

app.on('window-all-closed', () => {});
void main();
