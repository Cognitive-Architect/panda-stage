const { app, BrowserWindow } = require('electron');
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
configureElectronPaths();
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
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
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
    if (window) return window;
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

async function openProject(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its open-project input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
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

async function readEntryState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.editor-shell');
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const manager = document.querySelector('[data-testid="shot-manager"]');
    const managerSummary = manager?.querySelector('[data-project-duration-ms]')?.textContent ?? '';
    const managerShotCount = Number(managerSummary.split('个镜头')[0]?.trim() ?? NaN);
    const primary = document.querySelector('[data-testid="resource-primary-action"]');
    const automatic = document.querySelector('[data-testid="resource-auto-scene-action"]');
    const heading = primary?.closest('.resource-activity-heading') ?? automatic?.closest('.resource-activity-heading');
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    };
    const headingBounds = rect(heading);
    const primaryBounds = rect(primary);
    const automaticBounds = rect(automatic);
    return {
      deviceMode: shell?.dataset.editorDeviceMode ?? null,
      layout: shell?.dataset.editorShellLayout ?? null,
      drawerOpen: dock?.dataset.resourceDrawerOpen ?? null,
      activity: dock?.dataset.activeActivity ?? null,
      shotView: dock?.dataset.resourceShotView ?? null,
      actionGroup: document.querySelector('.resource-activity-header-actions')?.dataset.resourceActionGroup ?? null,
      shotCount: Number.isFinite(managerShotCount) ? managerShotCount : null,
      revision: Number(manager?.querySelector('[data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
      primaryLabel: primary?.textContent?.trim() ?? null,
      automaticLabel: automatic?.textContent?.trim() ?? null,
      headingBounds,
      primaryBounds,
      automaticBounds,
      actionsFitHeading: Boolean(
        headingBounds && primaryBounds && automaticBounds &&
        primaryBounds.left >= headingBounds.left - 1 &&
        automaticBounds.right <= headingBounds.right + 1,
      ),
      headingHasNoOverflow: Boolean(heading && heading.scrollWidth <= heading.clientWidth + 1),
    };
  })()`);
}

function assertListState(state, expectedLayout, expectedShotCount) {
  assert(state.deviceMode === 'cloud-touch', `Unexpected device mode: ${state.deviceMode}`);
  assert(state.layout === expectedLayout, `Expected ${expectedLayout} layout, got ${state.layout}.`);
  assert(state.activity === 'shots' && state.drawerOpen === 'true', 'The Shots drawer is not open.');
  assert(state.shotView === 'list', `Expected the list view, got ${state.shotView}.`);
  assert(state.shotCount === expectedShotCount, `Expected ${expectedShotCount} Shots, got ${state.shotCount}.`);
  assert(state.revision === 0, `Opening the entry changed project revision to ${state.revision}.`);
  assert(state.primaryLabel === '新建镜头', `Unexpected manual entry label: ${state.primaryLabel}.`);
  assert(state.automaticLabel === '自动布景', `Unexpected automatic entry label: ${state.automaticLabel}.`);
  assert(state.actionsFitHeading, `The Shot actions exceed their header bounds: ${JSON.stringify(state)}.`);
  assert(state.headingHasNoOverflow, `The Shot action header has horizontal overflow: ${JSON.stringify(state)}.`);
  const minimumActionHeight = expectedLayout === 'portrait' ? 48 : 44;
  assert(
    state.primaryBounds?.height >= minimumActionHeight &&
      state.automaticBounds?.height >= minimumActionHeight,
    `The Shot actions are below the ${minimumActionHeight}px target: ${JSON.stringify(state)}.`,
  );
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  const project = await createSampleProject();
  windowRef = await waitForMainWindow();
  windowRef.setSize(1_600, 1_000);
  windowRef.show();
  windowRef.focus();
  await openProject(windowRef);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'landscape'`,
    'The wide Windows window did not select the Cloud Touch landscape layout.',
  );

  const wideEntry = await readEntryState(windowRef);
  assertListState(wideEntry, 'landscape', initialShotCount);
  const wideScreenshot = await capture(
    windowRef,
    initialShotCount === 0 ? 'empty-project-entry-landscape.png' : 'multi-shot-entry-landscape.png',
  );

  await click(windowRef, '[data-testid="resource-primary-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="shot-create-view"]')`,
    'The manual Shot creation flow did not open.',
  );
  const manualState = await windowRef.webContents.executeJavaScript(`(() => ({
    shotCount: Number((document.querySelector('[data-testid="shot-manager"] [data-project-duration-ms]')?.textContent ?? '').split('个镜头')[0]?.trim() ?? NaN),
    revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
    hasName: Boolean(document.querySelector('[data-testid="shot-create-name"]')),
    hasSubmit: Boolean(document.querySelector('[data-testid="shot-create-submit"]')),
    hasOldAutomaticRoute: Boolean(document.querySelector('[data-testid="shot-create-structured-input"]')),
  }))()`);
  assert(
    manualState.shotCount === initialShotCount && manualState.revision === 0 &&
      manualState.hasName && manualState.hasSubmit && !manualState.hasOldAutomaticRoute,
    `Opening manual creation changed project state or lost its controls: ${JSON.stringify(manualState)}.`,
  );

  await click(windowRef, '[data-testid="resource-primary-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'list'`,
    'The manual flow did not return to the Shot list.',
  );
  await click(windowRef, '[data-testid="resource-auto-scene-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'The list-level automatic entry did not open the scene flow.',
  );
  const sceneState = await windowRef.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-testid="scene-creation-panel"]');
    const managerSummary = document.querySelector('[data-testid="shot-manager"] [data-project-duration-ms]')?.textContent ?? '';
    const label = panel?.querySelector('label[for="scene-creation-input"]');
    const input = panel?.querySelector('[data-testid="scene-creation-input"]');
    const format = panel?.querySelector('.scene-creation-format-details');
    const helper = panel?.querySelector('.scene-creation-prompt-details');
    return {
      title: panel?.querySelector('#scene-creation-heading')?.textContent?.trim() ?? null,
      label: label?.childNodes?.[0]?.textContent?.trim() ?? null,
      placeholder: input?.getAttribute('placeholder') ?? null,
      formatSummary: format?.querySelector('summary')?.textContent?.trim() ?? null,
      formatOpenByDefault: Boolean(format?.open),
      helperSummary: helper?.querySelector('summary')?.textContent?.trim() ?? null,
      helperOpenByDefault: Boolean(helper?.open),
      helperCopyCount: helper?.querySelectorAll('[data-testid="scene-creation-copy-prompt"]').length ?? 0,
      prompt: helper?.querySelector('pre')?.textContent ?? null,
      shotCount: Number(managerSummary.split('个镜头')[0]?.trim() ?? NaN),
      revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
      oldCopyLabelsPresent: [...panel?.querySelectorAll('button, summary') ?? []].some((element) => /复制整理提示词|查看整理提示词/.test(element.textContent ?? '')),
    };
  })()`);
  assert(sceneState.title === '自动布景', 'The scene panel title is not user-facing.');
  assert(sceneState.label === '粘贴布景信息', 'The scene input label is unclear.');
  assert(
    sceneState.placeholder === '镜头：花园相遇\n背景：花园\n出场：张三',
    `The input placeholder lost its three-line format: ${JSON.stringify(sceneState.placeholder)}.`,
  );
  assert(sceneState.formatSummary === '格式示例' && !sceneState.formatOpenByDefault, 'The format example is not progressively disclosed.');
  assert(
    sceneState.helperSummary === '用外部 AI 整理文本' && !sceneState.helperOpenByDefault &&
      sceneState.helperCopyCount === 1 && sceneState.prompt && !sceneState.oldCopyLabelsPresent,
    'The external prompt helper is duplicated or incomplete.',
  );
  assert(
    sceneState.shotCount === initialShotCount && sceneState.revision === 0,
    `Opening automatic scene creation changed project state: ${JSON.stringify(sceneState)}.`,
  );

  await click(windowRef, '.scene-creation-prompt-details > summary');
  await waitForDom(
    windowRef,
    `document.querySelector('.scene-creation-prompt-details')?.open === true`,
    'The external-AI helper did not expand.',
  );
  const helperScreenshot = await capture(
    windowRef,
    'external-ai-helper-expanded.png',
  );
  await click(windowRef, '[data-testid="resource-primary-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'list'`,
    'The scene flow did not return to the Shot list.',
  );

  windowRef.setSize(800, 1_100);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'portrait'`,
    'The narrow Cloud Touch window did not select the portrait layout.',
  );
  await openShotsWorkspace(windowRef);
  const portraitEntry = await readEntryState(windowRef);
  assertListState(portraitEntry, 'portrait', initialShotCount);
  const portraitScreenshot = await capture(
    windowRef,
    'cloud-touch-portrait-shot-entries.png',
  );

  return {
    issue: 860,
    acceptance: 'UI01_ENTRY_AND_COPY_DISCLOSURE',
    passed: true,
    codeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    syntheticProject: true,
    initialShotCount: project.shots.length,
    finalShotCount: portraitEntry.shotCount,
    finalRevision: portraitEntry.revision,
    manualRouteReturnedWithoutMutation: true,
    automaticRouteReturnedWithoutMutation: true,
    wideLayout: wideEntry,
    portraitLayout: portraitEntry,
    helper: {
      summary: sceneState.helperSummary,
      oneCopyAction: sceneState.helperCopyCount === 1,
      copiedPromptTextPresent: Boolean(sceneState.prompt),
      noBuiltinAiClaim: true,
    },
    screenshots: {
      wideEntry: wideScreenshot,
      helperExpanded: helperScreenshot,
      portraitEntries: portraitScreenshot,
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
      acceptance: 'UI01_ENTRY_AND_COPY_DISCLOSURE',
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
