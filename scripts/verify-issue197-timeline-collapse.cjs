const { app, ipcMain } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { migrateProject, detectSchemaVersion } = require(
  '../dist-electron/domain/migrations/index.js',
);

// Issue #197 real Electron gate: collapsing the Timeline must actually shrink
// the BottomWorkspace and hand the freed vertical space to the central Canvas.
// The height budget is asserted as a live *dual-state* contract (expanded vs
// collapsed measurements), never as a skipped or disabled check.
const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-197-timeline-collapse';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(
  repositoryRoot,
  'docs/evidence/issue-197',
);
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue197-timeline-collapse.pandastage',
);
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

rmSync(evidenceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

// A collapse that only trims a few pixels would satisfy "smaller" while failing
// the product goal, so the gate demands a clearly perceivable release.
const MIN_RELEASED_PX = 24;

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
  await delay(180);
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
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
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
    // Issue #197: the BottomWorkspace owner mirrors the single Timeline expand
    // flag onto the data-timeline-expanded attribute. Read it through the
    // dataset to know whether the collapsed < expanded height contract holds.
    const bottomElement = document.querySelector(
      '[data-testid="bottom-workspace"]',
    );
    const dockElement = document.querySelector('[data-testid="timeline-dock"]');
    const historyElement = document.querySelector(
      '[data-testid="history-controls"]',
    );
    const barElement = document.querySelector(
      '[data-testid="compact-project-bar"]',
    );
    const reopenElement = document.querySelector(
      '[data-testid="timeline-collapse"]',
    );
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: {
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        bodyWidth: document.body.scrollWidth,
      },
      page: document.querySelector('.editor-shell')?.dataset.editorPage ?? null,
      bottomExpanded: bottomElement?.dataset.timelineExpanded ?? null,
      dockExpanded: dockElement?.dataset.expanded ?? null,
      bottom: box('[data-testid="bottom-workspace"]'),
      bottomMetrics: metrics('[data-testid="bottom-workspace"]'),
      editorBody: box('[data-testid="editor-body"]'),
      canvas: box('[data-testid="canvas-workspace-scroll"]'),
      ruler: box('[data-testid="timeline-ruler-scroll"]'),
      timecode: box('[data-testid="timeline-timecode"]'),
      reopen: box('[data-testid="timeline-collapse"]'),
      reopenLabel: reopenElement?.textContent?.trim() ?? null,
      history: box('[data-testid="history-controls"]'),
      historyMetrics: metrics('[data-testid="history-controls"]'),
      historyState: historyElement
        ? {
            undoCount: historyElement.dataset.undoCount ?? null,
            redoCount: historyElement.dataset.redoCount ?? null,
            depth: historyElement.dataset.historyDepth ?? null,
          }
        : null,
      saveState: barElement?.dataset.saveState ?? null,
    };
  })()`);
}

function assertNoRootScroll(sample, label) {
  const { viewport, scroll } = sample;
  assert(
    scroll.documentWidth <= viewport.width + 1 &&
      scroll.bodyWidth <= viewport.width + 1,
    `${label} has page-level horizontal overflow: ${JSON.stringify({ viewport, scroll })}`,
  );
  assert(
    scroll.documentHeight <= scroll.clientHeight + 1,
    `${label} introduced root-level vertical business scrolling: ${JSON.stringify(scroll)}`,
  );
}

function assertExpandedState(sample, label) {
  assert(sample.page === 'editor', `${label} is not on the editor page.`);
  assert(
    sample.bottomExpanded === 'true' && sample.dockExpanded === 'true',
    `${label} did not report the expanded Timeline contract: ${JSON.stringify({
      bottomExpanded: sample.bottomExpanded,
      dockExpanded: sample.dockExpanded,
    })}`,
  );
  for (const [name, region] of [
    ['bottom workspace', sample.bottom],
    ['editor body', sample.editorBody],
    ['canvas', sample.canvas],
    ['timeline ruler', sample.ruler],
    ['timeline timecode', sample.timecode],
    ['history controls', sample.history],
  ]) {
    assert(
      region && region.width > 0 && region.height > 0,
      `${label} ${name} is not visible while expanded.`,
    );
  }
  assertNoRootScroll(sample, `${label} expanded`);
}

function assertNotClipped(sample, label) {
  assert(
    sample.bottomMetrics && sample.historyMetrics,
    `${label} does not expose the live BottomWorkspace and HistoryControls surfaces.`,
  );
  assert(
    sample.bottomMetrics.overflow === 'hidden',
    `${label} bottom workspace uses an unexpected overflow mode: ${JSON.stringify(sample.bottomMetrics)}`,
  );
  assert(
    sample.bottomMetrics.scrollHeight <= sample.bottomMetrics.clientHeight + 1 &&
      sample.bottomMetrics.scrollWidth <= sample.bottomMetrics.clientWidth + 1 &&
      sample.historyMetrics.scrollHeight <=
        sample.historyMetrics.clientHeight + 1 &&
      sample.historyMetrics.scrollWidth <=
        sample.historyMetrics.clientWidth + 1,
    `${label} clips its own collapsed content: ${JSON.stringify({
      bottom: sample.bottomMetrics,
      history: sample.historyMetrics,
    })}`,
  );
}

/**
 * The core Issue #197 contract: the collapsed bottom owner is measurably
 * shorter and the released pixels land in the editor body / Canvas rows.
 */
function assertCollapsedReleasesSpace(expanded, collapsed, label) {
  assert(
    collapsed.bottomExpanded === 'false' && collapsed.dockExpanded === 'false',
    `${label} did not report the collapsed Timeline contract: ${JSON.stringify({
      bottomExpanded: collapsed.bottomExpanded,
      dockExpanded: collapsed.dockExpanded,
    })}`,
  );
  assert(
    collapsed.bottom && expanded.bottom,
    `${label} lost the BottomWorkspace surface across the collapse.`,
  );
  assert(
    collapsed.bottom.height < expanded.bottom.height - MIN_RELEASED_PX,
    `${label} collapsed bottom workspace did not shrink perceivably: ${JSON.stringify({
      expanded: expanded.bottom.height,
      collapsed: collapsed.bottom.height,
      minReleasedPx: MIN_RELEASED_PX,
    })}`,
  );
  assert(
    collapsed.editorBody &&
      expanded.editorBody &&
      collapsed.editorBody.height > expanded.editorBody.height + MIN_RELEASED_PX,
    `${label} editor body did not reclaim the released height: ${JSON.stringify({
      expanded: expanded.editorBody,
      collapsed: collapsed.editorBody,
    })}`,
  );
  assert(
    collapsed.canvas &&
      expanded.canvas &&
      collapsed.canvas.height > expanded.canvas.height + MIN_RELEASED_PX,
    `${label} Canvas did not grow into the released height: ${JSON.stringify({
      expanded: expanded.canvas,
      collapsed: collapsed.canvas,
    })}`,
  );
  // The ruler body is gone, but the reopen entry, timecode and History stay.
  assert(
    collapsed.ruler === null,
    `${label} still renders the Timeline ruler while collapsed: ${JSON.stringify(collapsed.ruler)}`,
  );
  assert(
    collapsed.reopen && collapsed.reopen.width > 0 && collapsed.reopen.height > 0,
    `${label} lost the reopen entry while collapsed.`,
  );
  assert(
    collapsed.reopenLabel === '展开时间轴',
    `${label} reopen entry does not offer to expand the Timeline: ${JSON.stringify(collapsed.reopenLabel)}`,
  );
  assert(
    collapsed.timecode && collapsed.timecode.height > 0,
    `${label} hid the current time / total duration readout while collapsed.`,
  );
  assert(
    collapsed.history && collapsed.history.height > 0,
    `${label} hid the History controls while collapsed.`,
  );
  assertNotClipped(collapsed, `${label} collapsed`);
  assertNoRootScroll(collapsed, `${label} collapsed`);
  // UI-only: the open/close operation must not touch project or History state.
  assert(
    collapsed.saveState === expanded.saveState,
    `${label} collapse changed the project save state: ${JSON.stringify({
      expanded: expanded.saveState,
      collapsed: collapsed.saveState,
    })}`,
  );
  assert(
    JSON.stringify(collapsed.historyState) ===
      JSON.stringify(expanded.historyState),
    `${label} collapse changed History state: ${JSON.stringify({
      expanded: expanded.historyState,
      collapsed: collapsed.historyState,
    })}`,
  );
}

/** Reopening must restore the original Timeline working area exactly. */
function assertReopenRestores(expanded, reopened, label) {
  assert(
    reopened.bottomExpanded === 'true' && reopened.dockExpanded === 'true',
    `${label} did not return to the expanded contract: ${JSON.stringify(reopened.bottomExpanded)}`,
  );
  assert(
    reopened.bottom &&
      Math.abs(reopened.bottom.height - expanded.bottom.height) <= 1,
    `${label} did not restore the expanded bottom height: ${JSON.stringify({
      expanded: expanded.bottom,
      reopened: reopened.bottom,
    })}`,
  );
  assert(
    reopened.editorBody &&
      Math.abs(reopened.editorBody.height - expanded.editorBody.height) <= 1,
    `${label} did not restore the expanded editor body height: ${JSON.stringify({
      expanded: expanded.editorBody,
      reopened: reopened.editorBody,
    })}`,
  );
  assert(
    reopened.ruler && reopened.ruler.height > 0,
    `${label} did not restore the Timeline ruler after reopening.`,
  );
  assert(
    reopened.saveState === expanded.saveState &&
      JSON.stringify(reopened.historyState) ===
        JSON.stringify(expanded.historyState),
    `${label} reopen changed project or History state: ${JSON.stringify({
      expanded: { save: expanded.saveState, history: expanded.historyState },
      reopened: { save: reopened.saveState, history: reopened.historyState },
    })}`,
  );
}

function documentFor(root, project) {
  const sourceVersion = detectSchemaVersion(project);
  return {
    projectRoot: root,
    projectFilePath: `${root}\\project.json`,
    project: migrateProject(project),
    migrated: sourceVersion !== 5,
    sourceVersion,
  };
}

function projectFixture() {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.id = 'c1970000-0000-4000-8000-000000000001';
  project.name = 'Issue 197 Timeline Collapse Project';
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

/**
 * Runs the expanded → collapsed → reopened cycle at one window size and
 * records every live measurement as evidence.
 */
async function runCycle(window, label, slug, result) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="timeline-ruler-scroll"]')`,
    `${label} did not render the expanded Timeline ruler.`,
  );
  const expanded = await measure(window);
  assertExpandedState(expanded, label);
  assertNotClipped(expanded, `${label} expanded`);
  await capture(window, `issue197-${slug}-expanded.png`);

  await click(window, '[data-testid="timeline-collapse"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="bottom-workspace"]')?.dataset.timelineExpanded === 'false'`,
    `${label} did not reach the collapsed Timeline state.`,
  );
  await delay(240);
  const collapsed = await measure(window);
  assertCollapsedReleasesSpace(expanded, collapsed, label);
  await capture(window, `issue197-${slug}-collapsed.png`);

  await click(window, '[data-testid="timeline-collapse"]');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="bottom-workspace"]')?.dataset.timelineExpanded === 'true'`,
    `${label} did not return to the expanded Timeline state.`,
  );
  await delay(240);
  const reopened = await measure(window);
  assertReopenRestores(expanded, reopened, label);
  assertExpandedState(reopened, `${label} reopened`);
  await capture(window, `issue197-${slug}-reopened.png`);

  result.snapshots[slug] = { expanded, collapsed, reopened };
  result.checks.push(
    `${label}: bottom ${expanded.bottom.height}px → ${collapsed.bottom.height}px, canvas ${expanded.canvas.height}px → ${collapsed.canvas.height}px, reopen restored to ${reopened.bottom.height}px`,
  );
  result.screenshots[slug] = {
    expanded: path.join(evidenceRoot, `issue197-${slug}-expanded.png`),
    collapsed: path.join(evidenceRoot, `issue197-${slug}-collapsed.png`),
    reopened: path.join(evidenceRoot, `issue197-${slug}-reopened.png`),
  };
  return { expanded, collapsed, reopened };
}

async function run() {
  const project = projectFixture();
  const recentEntries = [
    {
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: '2026-08-14T00:00:00.000Z',
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
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, value: documentFor(projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Issue 197 gate project not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => ({
    ok: true,
    value: documentFor(request.projectRoot, request.project),
  }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: recentEntries,
  }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_RELOCATE_FAILED',
            message: 'Issue 197 gate recent project not found.',
            projectRoot: request.projectRoot,
          },
        },
  );
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
          message: 'Issue 197 fixture image asset was not found.',
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
    issue: 197,
    electron: process.versions.electron,
    node: process.versions.node,
    passed: false,
    checks: [],
    snapshots: {},
    screenshots: {},
  };

  try {
    window.setContentSize(1280, 800);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="recent-projects-list"]')`,
      'The Issue 197 Project Center recent-project list did not render.',
    );
    await click(
      window,
      '[data-project-status="available"] [data-task4-core="recent-open"]',
    );
    await waitForDom(
      window,
      `document.querySelector('[data-editor-page="editor"]')`,
      'The Issue 197 gate project did not open in the editor.',
    );

    // 1) Wide window: the primary Stage-first space release.
    await runCycle(window, '1280x800 wide editor', 'wide', result);

    // 2) Narrow + short window: the released height matters most here.
    window.setContentSize(900, 620);
    await delay(320);
    await runCycle(window, '900x620 narrow-short editor', 'narrowShort', result);

    // 3) Compact two-row history layout below the 720px seam.
    window.setContentSize(700, 620);
    await delay(320);
    await runCycle(window, '700x620 compact editor', 'compact', result);

    result.passed = true;
    return result;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');

app.on('window-all-closed', () => {});

async function main() {
  const output = {
    issue: 197,
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
    output.error =
      error instanceof Error ? error.stack || error.message : String(error);
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
