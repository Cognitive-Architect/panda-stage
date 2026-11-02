const { app, BrowserWindow, dialog } = require('electron');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
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
const importedBackgroundSource = path.resolve(
  __dirname,
  '../demo-project/assets/bamboo-background.png',
);
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
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [importedBackgroundSource],
});
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

async function readSceneNavigation(window) {
  return window.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    const panel = document.querySelector('[data-testid="scene-creation-panel"]');
    const navigation = dock?.querySelector('[data-testid="scene-creation-navigation"]');
    const back = navigation?.querySelector('[data-testid="scene-creation-back"]');
    const close = navigation?.querySelector('[data-testid="resource-activity-close"]');
    const arrow = back?.querySelector('svg');
    const label = panel?.querySelector('label[for="scene-creation-input"]');
    return {
      backLabel: back?.getAttribute('aria-label') ?? null,
      backTitle: back?.getAttribute('title') ?? null,
      backText: back?.textContent?.trim() ?? null,
      arrowClasses: arrow ? [...arrow.classList] : [],
      arrowBounds: rect(arrow),
      arrowHidden: arrow?.getAttribute('aria-hidden') === 'true',
      closeLabel: close?.getAttribute('aria-label') ?? null,
      navigationBounds: rect(navigation),
      backBounds: rect(back),
      closeBounds: rect(close),
      labelBounds: rect(label),
      backCount: dock?.querySelectorAll('[data-testid="scene-creation-back"]').length ?? 0,
      panelBackCount: panel?.querySelectorAll('[data-testid="scene-creation-back"]').length ?? 0,
      closeCount: navigation?.querySelectorAll('[data-testid="resource-activity-close"]').length ?? 0,
      drawerOpen: dock?.dataset.resourceDrawerOpen ?? null,
      shotView: dock?.dataset.resourceShotView ?? null,
    };
  })()`);
}

function assertSceneNavigation(state, context) {
  assert(
    state.backLabel === '返回镜头列表' &&
      state.backTitle === '返回镜头列表' &&
      state.backText === '' &&
      state.arrowClasses.includes('lucide-arrow-left') &&
      state.arrowHidden &&
      state.closeLabel === '关闭资源工作区' &&
      state.backCount === 1 &&
      state.panelBackCount === 0 &&
      state.closeCount === 1,
    `${context} does not use one accessible Lucide return control in the outer resource header: ${JSON.stringify(state)}.`,
  );
  const back = state.backBounds;
  const close = state.closeBounds;
  const navigation = state.navigationBounds;
  const label = state.labelBounds;
  const arrow = state.arrowBounds;
  assert(
    back && close && navigation && label &&
      arrow &&
      back.width >= 44 && back.height >= 44 &&
      close.width >= 44 && close.height >= 44 &&
      back.left < close.left &&
      Math.abs((back.top + back.height / 2) - (close.top + close.height / 2)) <= 8 &&
      Math.abs((arrow.left + arrow.width / 2) - (back.left + back.width / 2)) <= 2 &&
      Math.abs((arrow.top + arrow.height / 2) - (back.top + back.height / 2)) <= 2 &&
      label.top >= navigation.bottom - 1 &&
      label.top - navigation.bottom <= 36,
    `${context} does not place the 44px return and close controls on one row with the input label immediately below: ${JSON.stringify(state)}.`,
  );
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
  const projectRoot = targetProjectRoot;
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

function assertListState(
  state,
  expectedLayout,
  expectedShotCount,
  expectedRevision = 0,
) {
  assert(state.deviceMode === 'cloud-touch', `Unexpected device mode: ${state.deviceMode}`);
  assert(state.layout === expectedLayout, `Expected ${expectedLayout} layout, got ${state.layout}.`);
  assert(state.activity === 'shots' && state.drawerOpen === 'true', 'The Shots drawer is not open.');
  assert(state.shotView === 'list', `Expected the list view, got ${state.shotView}.`);
  assert(state.shotCount === expectedShotCount, `Expected ${expectedShotCount} Shots, got ${state.shotCount}.`);
  assert(state.revision === expectedRevision, `Expected project revision ${expectedRevision}, got ${state.revision}.`);
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
    const match = panel?.querySelector('[data-testid="scene-creation-inspect"]');
    return {
      accessibleName: panel?.getAttribute('aria-label') ?? null,
      visibleHeading: panel?.querySelector('h2, h3')?.textContent?.trim() ?? null,
      label: label?.childNodes?.[0]?.textContent?.trim() ?? null,
      placeholder: input?.getAttribute('placeholder') ?? null,
      inputValue: input?.value ?? null,
      inputRows: input?.rows ?? null,
      matchLabel: match?.textContent?.trim() ?? null,
      sharedPrimaryActionPresent: Boolean(document.querySelector('[data-testid="resource-primary-action"]')),
      removedHelperMarkupPresent: Boolean(panel?.querySelector('details, output, pre, [data-testid="scene-creation-copy-prompt"]')),
      shotCount: Number(managerSummary.split('个镜头')[0]?.trim() ?? NaN),
      revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
    };
  })()`);
  sceneState.navigation = await readSceneNavigation(windowRef);
  assertSceneNavigation(sceneState.navigation, 'Wide scene header');
  assert(sceneState.accessibleName === '自动布景', 'The scene panel lost its accessible name.');
  assert(sceneState.visibleHeading === null, 'The scene panel still renders a duplicate visible heading.');
  assert(sceneState.label === '粘贴布景信息', 'The scene input label is unclear.');
  assert(
    sceneState.placeholder === '格式示例\n镜头：花园相遇\n背景：花园\n出场：张三' &&
      sceneState.inputValue === '' && sceneState.inputRows === 5,
    `The empty input does not show the four-line placeholder at the expected height: ${JSON.stringify(sceneState)}.`,
  );
  assert(
    sceneState.matchLabel === '重新匹配',
    `Unexpected recovery match action: ${sceneState.matchLabel}.`,
  );
  assert(
    !sceneState.sharedPrimaryActionPresent,
    `The scene view unexpectedly renders the shared primary action: ${JSON.stringify(sceneState)}.`,
  );
  assert(
    !sceneState.removedHelperMarkupPresent,
    'The deleted format or external-AI helper markup is still present.',
  );
  assert(
    sceneState.shotCount === initialShotCount && sceneState.revision === 0,
    `Opening automatic scene creation changed project state: ${JSON.stringify(sceneState)}.`,
  );

  const sceneScreenshot = await capture(
    windowRef,
    initialShotCount === 0 ? 'empty-project-automatic-scene.png' : 'multi-shot-automatic-scene.png',
  );

  const missingResourceInput = [
    `镜头：${initialShotCount === 2 ? '已有镜头 1' : '花园相遇'}`,
    '背景：花园',
    '出场：张三',
  ].join('\n');
  await windowRef.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="scene-creation-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(missingResourceInput)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-candidates"]') && document.querySelector('[aria-label="背景素材"] .scene-creation-resource-error')?.textContent?.includes('没找到『花园』背景') && document.querySelector('[aria-label="出场角色"] .scene-creation-resource-error')?.textContent?.includes('没找到『张三』这个角色')`,
    'Missing background and Character errors were not shown beside their resource rows.',
  );
  let expectedDraft;
  if (initialShotCount === 2) {
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="scene-creation-name-conflict"]')?.textContent?.includes('『已有镜头 1』已经存在') && document.querySelector('[data-testid="scene-creation-use-suggested-name"]')?.textContent?.includes('使用『已有镜头 1 2』')`,
      'The duplicate Shot did not offer the next formal unique name.',
    );
    await click(windowRef, '[data-testid="scene-creation-use-suggested-name"]');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="scene-creation-input"]')?.value?.includes('镜头：已有镜头 1 2') && !document.querySelector('[data-testid="scene-creation-name-conflict"]')`,
      'Selecting the suggested Shot name did not update only the pasted Shot field.',
    );
  }
  await waitForDom(
    windowRef,
    `document.querySelector('[aria-label="背景素材"] .scene-creation-resource-error')?.textContent?.includes('没找到『花园』背景') && document.querySelector('[aria-label="出场角色"] .scene-creation-resource-error')?.textContent?.includes('没找到『张三』这个角色')`,
    'The delayed automatic resource match did not refresh after the Shot name correction.',
  );

  expectedDraft = await windowRef.webContents.executeJavaScript(
    "document.querySelector('[data-testid=\"scene-creation-input\"]')?.value ?? null",
  );
  assert(expectedDraft, 'The recovery scenario requires a non-empty scene draft.');
  await click(windowRef, '[aria-label="背景素材"] .scene-creation-resource-error button');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-background-picker"]')?.textContent?.includes('没有可用的背景图片素材')`,
    'The existing-background action did not open a truthful empty picker.',
  );
  await windowRef.webContents.executeJavaScript(`document.querySelector('[data-testid="scene-creation-background-picker"] .scene-creation-picker-heading button')?.click()`);
  await click(
    windowRef,
    '[aria-label="背景素材"] .scene-creation-resource-error button:nth-of-type(2)',
  );
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="scene-creation-panel"]') && document.querySelector('[data-testid="scene-creation-background-match"]')`,
    'Importing a background did not return to the scene draft with a usable background selected.',
  );
  try {
    await waitForDom(
      windowRef,
      `(() => { const image = document.querySelector('[data-testid="scene-creation-background-match"] .scene-creation-match-thumbnail img'); return Boolean(image?.complete && image.naturalWidth > 0); })()`,
      'The imported background thumbnail did not finish loading as the selected match.',
    );
  } catch (error) {
    const candidateId = await windowRef.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"scene-creation-background-match\"]')?.dataset.candidateId ?? null",
    );
    const projectOnDisk = JSON.parse(
      readFileSync(path.join(projectRoot, 'project.json'), 'utf8'),
    );
    const candidateAsset = projectOnDisk.assets.find(
      (asset) => asset.id === candidateId,
    );
    const thumbnailResponse = candidateAsset
      ? await windowRef.webContents.executeJavaScript(
          `window.pandaStage.assets.readThumbnail({ projectRoot: ${JSON.stringify(projectRoot)}, assetId: ${JSON.stringify(candidateId)}, sha256: ${JSON.stringify(candidateAsset.sha256)} })`,
        )
      : null;
    const diagnostic = await windowRef.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-testid="scene-creation-background-match"]');
      const image = row?.querySelector('.scene-creation-match-thumbnail img');
      return {
        rowText: row?.textContent?.trim() ?? null,
        candidateId: row?.dataset.candidateId ?? null,
        selectable: row?.dataset.candidateSelectable === 'true',
        imageComplete: image?.complete ?? null,
        imageWidth: image?.naturalWidth ?? null,
        imageSourcePrefix: image?.currentSrc?.slice(0, 48) ?? null,
      };
    })()`);
    diagnostic.thumbnailResponse = thumbnailResponse;
    const screenshot = await capture(windowRef, 'background-thumbnail-not-ready.png');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Diagnostic: ${JSON.stringify(diagnostic)} Screenshot: ${screenshot}`,
      { cause: error },
    );
  }
  const backgroundImportRecovery = await windowRef.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-testid="scene-creation-background-match"]');
    return {
      input: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
      assetId: row?.dataset.candidateId ?? null,
      selectable: row?.dataset.candidateSelectable === 'true',
      matched: row?.dataset.candidateMatched === 'true',
      revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
      shotCount: Number((document.querySelector('[data-testid="shot-manager"] [data-project-duration-ms]')?.textContent ?? '').split('个镜头')[0]?.trim() ?? NaN),
    };
  })()`);
  assert(
    backgroundImportRecovery.input === expectedDraft &&
      backgroundImportRecovery.assetId &&
      backgroundImportRecovery.selectable &&
      backgroundImportRecovery.matched &&
      backgroundImportRecovery.revision > 0 &&
      backgroundImportRecovery.shotCount === initialShotCount,
    `The imported image was not classified and retained as a selected background: ${JSON.stringify(backgroundImportRecovery)}.`,
  );
  await click(windowRef, '[aria-label="出场角色"] .scene-creation-resource-error button:nth-of-type(2)');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'characters' && document.querySelector('[data-testid="character-manager"]')`,
    'The Character library action did not navigate to the existing Character owner.',
  );
  await click(windowRef, '[data-testid="resource-activity-rail-shots"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'shots' && document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Returning from the Character library did not restore the scene workflow.',
  );
  expectedDraft = initialShotCount === 2
    ? missingResourceInput.replace('镜头：已有镜头 1', '镜头：已有镜头 1 2')
    : missingResourceInput;
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-input"]')?.value === ${JSON.stringify(expectedDraft)} && document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateSelectable === 'true'`,
    'Returning from the Character library did not preserve the input and imported background selection.',
  );
  const recoveryState = await windowRef.webContents.executeJavaScript(`(() => ({
    shotCount: Number((document.querySelector('[data-testid="shot-manager"] [data-project-duration-ms]')?.textContent ?? '').split('个镜头')[0]?.trim() ?? NaN),
    revision: Number(document.querySelector('[data-testid="shot-manager"] [data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
    input: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
    backgroundError: document.querySelector('[aria-label="背景素材"] .scene-creation-resource-error')?.textContent?.trim() ?? null,
    backgroundMatchId: document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateId ?? null,
    backgroundMatchSelectable: document.querySelector('[data-testid="scene-creation-background-match"]')?.dataset.candidateSelectable === 'true',
    characterError: document.querySelector('[aria-label="出场角色"] .scene-creation-resource-error')?.textContent?.trim() ?? null,
  }))()`);
  assert(
    recoveryState.shotCount === initialShotCount && recoveryState.revision > 0 &&
      recoveryState.backgroundMatchId === backgroundImportRecovery.assetId &&
      recoveryState.backgroundMatchSelectable &&
      recoveryState.characterError?.includes('没找到『张三』这个角色'),
    `Scene recovery lost the imported background selection or inline Character error: ${JSON.stringify(recoveryState)}.`,
  );
  const recoveryScreenshot = await capture(windowRef, 'missing-resource-recovery-after-character-library.png');
  await click(windowRef, '[data-testid="resource-activity-close"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false' && document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'scene'`,
    'The scene header X did not close the resource drawer while preserving the scene view.',
  );
  await click(windowRef, '[data-testid="resource-activity-rail-shots"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true' && document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Reopening the resource drawer did not restore the current scene view.',
  );
  const headerAfterCloseReopen = await readSceneNavigation(windowRef);
  assertSceneNavigation(headerAfterCloseReopen, 'Reopened scene header');
  await click(windowRef, '[data-testid="scene-creation-back"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'list'`,
    'The square back control did not return to the Shot list.',
  );
  await click(windowRef, '[data-testid="resource-auto-scene-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Re-entering automatic scene creation from the Shot list failed.',
  );
  const headerAfterReentry = await readSceneNavigation(windowRef);
  assertSceneNavigation(headerAfterReentry, 'Re-entered scene header');
  await click(windowRef, '[data-testid="scene-creation-back"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceShotView === 'list'`,
    'The scene header return control did not remain functional after re-entry.',
  );

  windowRef.setSize(800, 1_100);
  await waitForDom(
    windowRef,
    `document.querySelector('.editor-shell')?.dataset.editorShellLayout === 'portrait'`,
    'The narrow Cloud Touch window did not select the portrait layout.',
  );
  await openShotsWorkspace(windowRef);
  const portraitEntry = await readEntryState(windowRef);
  assertListState(portraitEntry, 'portrait', initialShotCount, recoveryState.revision);
  const portraitScreenshot = await capture(
    windowRef,
    'cloud-touch-portrait-shot-entries.png',
  );
  await click(windowRef, '[data-testid="resource-auto-scene-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'The portrait automatic scene flow did not open from the Shot list.',
  );
  const portraitSceneState = await windowRef.webContents.executeJavaScript(`(() => {
    const manager = document.querySelector('[data-testid="shot-manager"]');
    const confirm = document.querySelector('[data-testid="scene-creation-confirm"]');
    const bounds = confirm?.getBoundingClientRect();
    const style = confirm ? getComputedStyle(confirm) : null;
    const summary = manager?.querySelector('[data-project-duration-ms]')?.textContent ?? '';
    return {
      input: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
      confirmVisible: Boolean(confirm && bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'),
      confirmHeight: bounds?.height ?? 0,
      confirmWithinWindow: Boolean(bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1),
      createDisabled: confirm?.disabled ?? null,
      shotCount: Number(summary.match(/^[0-9]+/u)?.[0] ?? NaN),
      revision: Number(manager?.querySelector('[data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
    };
  })()`);
  portraitSceneState.navigation = await readSceneNavigation(windowRef);
  assertSceneNavigation(portraitSceneState.navigation, 'Portrait scene header');
  assert(
    portraitSceneState.input === recoveryState.input &&
      portraitSceneState.confirmVisible &&
      portraitSceneState.confirmWithinWindow &&
      portraitSceneState.confirmHeight >= 48 &&
      portraitSceneState.createDisabled === true &&
      portraitSceneState.shotCount === initialShotCount &&
      portraitSceneState.revision === recoveryState.revision,
    `The portrait scene panel lost its draft, hid the stable Create Shot action or changed Project state: ${JSON.stringify(portraitSceneState)}.`,
  );
  const portraitSceneScreenshot = await capture(
    windowRef,
    'cloud-touch-portrait-automatic-scene.png',
  );

  const isolatedProjectRoot = path.join(runRoot, 'isolated-project.pandastage');
  await new ProjectService().create(isolatedProjectRoot, {
    name: 'Issue 860 UI01 isolated project',
  });
  await saveCurrentProject(windowRef);
  await openProject(windowRef, isolatedProjectRoot);
  await click(windowRef, '[data-testid="resource-auto-scene-action"]');
  await waitForDom(
    windowRef,
    `document.querySelector('[data-testid="scene-creation-panel"]')`,
    'Automatic scene creation did not open in the second project.',
  );
  const crossProjectState = await windowRef.webContents.executeJavaScript(`(() => {
    const manager = document.querySelector('[data-testid="shot-manager"]');
    const canvas = document.querySelector('.project-canvas');
    const summary = manager?.querySelector('[data-project-duration-ms]')?.textContent ?? '';
    return {
      input: document.querySelector('[data-testid="scene-creation-input"]')?.value ?? null,
      candidateCount: document.querySelectorAll('.scene-creation-match-row').length,
      previewMode: canvas?.dataset.scenePreview ?? null,
      previewShotId: canvas?.dataset.scenePreviewShotId ?? null,
      shotCount: Number(summary.match(/^[0-9]+/u)?.[0] ?? NaN),
      revision: Number(manager?.querySelector('[data-project-revision]')?.getAttribute('data-project-revision') ?? 0),
    };
  })()`);
  assert(
    crossProjectState.input === '' && crossProjectState.candidateCount === 0 &&
      crossProjectState.previewMode === 'false' && crossProjectState.previewShotId === '' &&
      crossProjectState.shotCount === 0 && crossProjectState.revision === 0,
    `The first project's draft, candidate or preview leaked into the second project: ${JSON.stringify(crossProjectState)}.`,
  );
  const crossProjectScreenshot = await capture(
    windowRef,
    'automatic-scene-isolated-after-project-switch.png',
  );

  return {
    issue: 860,
    acceptance: 'UI01_ENTRY_AND_SCENE_INPUT',
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
    automaticScene: sceneState,
    automaticSceneScreenshot: sceneScreenshot,
    recoveryState,
    backgroundImportRecovery,
    headerAfterCloseReopen,
    headerAfterReentry,
    recoveryScreenshot,
    portraitLayout: portraitEntry,
    portraitSceneState,
    crossProjectState,
    screenshots: {
      wideEntry: wideScreenshot,
      automaticScene: sceneScreenshot,
      recovery: recoveryScreenshot,
      portraitEntries: portraitScreenshot,
      portraitAutomaticScene: portraitSceneScreenshot,
      crossProjectIsolation: crossProjectScreenshot,
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
