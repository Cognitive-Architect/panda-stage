/* Issue #403 Problem 2: one real Electron Raster/F1 containment sample. */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--sample-key') args.sampleKey = argv[++index];
  }
  return args;
}

const args = parseArgs(process.argv.slice(1));
const sourcePath = resolve(args.source);
const acceptanceRoot = resolve(args.acceptanceRoot);
const userData = resolve(args.userData);
const evidenceDir = resolve(args.evidenceDir);
const outPath = resolve(args.out);
const sampleKey = args.sampleKey || 'sample';

mkdirSync(userData, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
app.setPath('userData', userData);

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (mainWindow) {
      try {
        const ready = await mainWindow.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect)',
        );
        if (ready) return mainWindow;
      } catch {
        // The renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the acceptance APIs');
}

async function waitForSelector(mainWindow, selector, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mainWindow.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForExpression(mainWindow, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await mainWindow.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function setControlledInput(mainWindow, selector, value) {
  await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Input value setter is unavailable');
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function click(mainWindow, selector) {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click ${selector}`);
}

async function createProject(mainWindow) {
  const projectName = `Issue403 Raster ${sampleKey} ${Date.now()}`;
  await click(mainWindow, '[data-testid="new-project-button"]');
  await waitForSelector(mainWindow, '[data-testid="new-project-dialog"]');
  await setControlledInput(mainWindow, '[data-testid="new-project-parent-directory"]', acceptanceRoot);
  await setControlledInput(mainWindow, '[data-testid="new-project-name"]', projectName);
  await waitForSelector(mainWindow, '[data-testid="new-project-confirm"]:not([disabled])');
  await click(mainWindow, '[data-testid="new-project-confirm"]');
  await waitForSelector(mainWindow, '[data-testid="editor-layout"]');
  await waitForSelector(mainWindow, '[data-testid="resource-activity-tabs"]');
  await click(mainWindow, '[data-testid="resource-activity-tabs"] [data-activity="assets"]');
  await waitForSelector(mainWindow, '[data-testid="asset-browser-view"]');
  return {
    projectName,
    projectRoot: join(acceptanceRoot, `${projectName}.pandastage`),
  };
}

async function openRasterReview(mainWindow) {
  await waitForSelector(
    mainWindow,
    '[data-testid="asset-import-fla"], [data-testid="resource-asset-import-fla"]',
  );
  const opened = await mainWindow.webContents.executeJavaScript(`(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
    const action = direct instanceof HTMLButtonElement && !direct.disabled ? direct : resource;
    if (!(action instanceof HTMLButtonElement) || action.disabled) return false;
    action.click();
    return true;
  })()`);
  if (!opened) throw new Error('No enabled FLA import action');
  await waitForSelector(mainWindow, '[data-testid="fla-review-summary"]');
  await waitForSelector(mainWindow, '[data-testid="fla-review-media-grid"]');
}

async function readContainmentState(mainWindow) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const session = document.querySelector('[data-testid="fla-review-session"]');
    const body = document.querySelector('[data-testid="fla-review-body"]');
    const workbench = document.querySelector('[data-testid="fla-raster-workbench"]');
    const overview = document.querySelector('[data-testid="fla-raster-overview"]');
    const selection = document.querySelector('[data-testid="fla-raster-selection"]');
    const detail = document.querySelector('[data-testid="fla-raster-detail"]');
    const header = document.querySelector('[data-testid="fla-review-header"]');
    const headingCopy = header?.querySelector('.fla-review-heading-copy');
    const progress = header?.querySelector('.fla-workbench-progress');
    const sourceName = overview?.querySelector('h3');
    const compatibility = overview?.querySelector('[data-testid="fla-stage-f1-raster-warning"]');
    const compatibilityDetails = overview?.querySelector('[data-testid="fla-compatibility-notes"]');
    const sourceRect = rect(sourceName);
    const overviewRect = rect(overview);
    const selectionRect = rect(selection);
    const compatibilityRect = rect(compatibility);
    const horizontalOverflow = [document.documentElement, document.body, session, workbench]
      .some((element) => Boolean(element && element.scrollWidth > element.clientWidth + 1));
    const workbenchHorizontalOverflow = Boolean(
      workbench && workbench.scrollWidth > workbench.clientWidth + 1,
    );
    const sourceText = sourceName?.textContent?.trim() || '';
    const sourceTitle = sourceName?.getAttribute('title') || '';
    const sourceEllipsized = Boolean(
      sourceName && sourceName.scrollWidth > sourceName.clientWidth + 1,
    );
    const headerRect = rect(header);
    const progressRect = rect(progress);
    const progressCenterOffset = headerRect && progressRect
      ? Math.abs((progressRect.left + progressRect.width / 2) - (headerRect.left + headerRect.width / 2))
      : Number.POSITIVE_INFINITY;
    const compatibilityDirectChildren = compatibility
      ? Array.from(compatibility.children)
      : [];
    const compatibilitySummary = compatibility?.querySelector(
      'details > summary.fla-raster-compatibility-summary',
    );
    const readOnlyMarkers = [
      header?.textContent?.includes('只读') || false,
      Boolean(overview?.querySelector('.fla-raster-readonly-badge')),
      overview?.querySelector('.fla-raster-panel-kicker')?.textContent?.includes('只读') || false,
      Array.from(overview?.querySelectorAll('p') || []).some(
        (paragraph) => paragraph.textContent?.includes('在确认导入前，不会修改项目或原文件。'),
      ),
    ];
    return {
      sourceBasename: sourceText,
      sourceTitle,
      headerRect,
      progressRect,
      sourceRect,
      overviewRect,
      selectionRect,
      detailRect: rect(detail),
      compatibilityRect,
      headerDirectChildCount: header?.children.length || 0,
      progressParentIsHeader: Boolean(progress && progress.parentElement === header),
      progressCenterOffset,
      progressCentered: progressCenterOffset <= 4,
      persistentHeaderCopyCount: [
        headingCopy?.querySelector('h2'),
        progress,
        header?.querySelector(':scope > button'),
      ].filter(Boolean).length,
      overviewPermanentBlockCount: overview?.children.length || 0,
      readOnlyImmutabilityCopyCount: readOnlyMarkers.filter(Boolean).length,
      compatibilityVisibleLayerCount: [
        ...compatibilityDirectChildren.filter((element) =>
          element.matches('h3, .fla-stage-f1-copy, .fla-raster-compatibility-summary'),
        ),
        compatibilitySummary,
      ].filter(Boolean).length,
      compatibilitySummaryRowCount: compatibility
        ? compatibility.querySelectorAll('details > summary.fla-raster-compatibility-summary').length
        : 0,
      compatibilityHasLegacyHeading: compatibilityDirectChildren.some((element) => element.matches('h3')),
      compatibilityHasLegacyCopy: compatibilityDirectChildren.some((element) => element.classList.contains('fla-stage-f1-copy')),
      compatibilityHasLegacySummary: compatibilityDirectChildren.some((element) => element.classList.contains('fla-raster-compatibility-summary')),
      readOnlyMarkers,
      sourceNameContained: Boolean(sourceRect && overviewRect && sourceRect.right <= overviewRect.right + 1),
      compatibilityContained: Boolean(compatibilityRect && overviewRect && compatibilityRect.right <= overviewRect.right + 1),
      overviewBeforeCenter: Boolean(overviewRect && selectionRect && overviewRect.right < selectionRect.left),
      horizontalOverflow,
      workbenchHorizontalOverflow,
      sourceEllipsized,
      fullBasenameAvailable: sourceText.length > 0 && sourceTitle === sourceText,
      compatibilityCollapsedByDefault: compatibilityDetails instanceof HTMLDetailsElement && !compatibilityDetails.open,
      compatibilitySummaryText: overview?.querySelector('[data-testid="fla-raster-compatibility-summary"]')?.textContent?.trim() || '',
      visibleCardCount: document.querySelectorAll('[data-fla-media-id]').length,
      selectedCount: document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '',
      bodyOverflowX: body ? getComputedStyle(body).overflowX : '',
      bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
      overviewScrollWidth: overview?.scrollWidth || 0,
      overviewClientWidth: overview?.clientWidth || 0,
      sourceScrollWidth: sourceName?.scrollWidth || 0,
      sourceClientWidth: sourceName?.clientWidth || 0,
    };
  })()`);
}

async function readBrowseState(mainWindow) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const selectedText = document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '';
    const gridCountText = document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim() || '';
    const pageStatus = document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() || '';
    const selectedMatch = selectedText.match(/\\d+/u);
    const gridMatch = gridCountText.match(/^(\\d+)\\s*\\/\\s*(\\d+)/u);
    const activeFilter = Array.from(document.querySelectorAll('[data-testid^="fla-review-filter-"]'))
      .find((element) => element.getAttribute('aria-pressed') === 'true')
      ?.getAttribute('data-testid')?.replace('fla-review-filter-', '') || '';
    return {
      selectedCount: selectedMatch ? Number(selectedMatch[0]) : -1,
      filteredCount: gridMatch ? Number(gridMatch[1]) : -1,
      totalCount: gridMatch ? Number(gridMatch[2]) : -1,
      pageStatus,
      pageSize: document.querySelector('[data-testid="fla-review-page-size"]')?.value || '',
      activeFilter,
      search: document.querySelector('[data-testid="fla-review-search"]')?.value || '',
      visibleCardCount: document.querySelectorAll('[data-fla-media-id]').length,
    };
  })()`);
}

async function clickFirstCard(mainWindow) {
  const card = await mainWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('[data-fla-media-id]');
    if (!(element instanceof HTMLElement)) return null;
    const name = element.querySelector('strong[title]')?.getAttribute('title') || '';
    const id = element.getAttribute('data-fla-media-id') || '';
    element.click();
    return { id, name };
  })()`);
  if (!card) throw new Error('Could not click the first visible raster card');
  return card;
}

async function selectPageSize(mainWindow, pageSize) {
  const changed = await mainWindow.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[data-testid="fla-review-page-size"]');
    if (!(select instanceof HTMLSelectElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(select, ${JSON.stringify(String(pageSize))});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Could not set raster page size to ${pageSize}`);
}

async function runStageBBusinessProbe(mainWindow) {
  const initial = await readBrowseState(mainWindow);
  if (initial.totalCount < 32) {
    throw new Error(`Stage B business probe needs a multi-page raster catalog: ${JSON.stringify(initial)}`);
  }
  const firstPageCardCount = initial.visibleCardCount;
  const firstPage = initial.pageStatus;

  await click(mainWindow, '[data-testid="fla-review-pagination"] button[aria-label="下一页"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() !== ${JSON.stringify(firstPage)}`,
  );
  const secondPage = await readBrowseState(mainWindow);
  const toggledCard = await clickFirstCard(mainWindow);
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim().startsWith(${JSON.stringify(`${initial.selectedCount - 1}`)})`,
  );
  const afterToggle = await readBrowseState(mainWindow);

  await click(mainWindow, '[data-testid="fla-review-filter-unselected"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim().startsWith('1 /')`,
  );
  const unselected = await readBrowseState(mainWindow);

  await setControlledInput(mainWindow, '[data-testid="fla-review-search"]', toggledCard.name);
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim().startsWith('1 /') && document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() === '1 / 1'`,
  );
  const searched = await readBrowseState(mainWindow);

  await setControlledInput(mainWindow, '[data-testid="fla-review-search"]', '');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim().startsWith('1 /')`,
  );

  await click(mainWindow, '[data-testid="fla-review-filter-selected"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim().startsWith(${JSON.stringify(`${initial.selectedCount - 1} /`)})`,
  );
  const selectedOnly = await readBrowseState(mainWindow);

  await selectPageSize(mainWindow, 32);
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() === '1 / 5'`,
  );
  const pageSize32 = await readBrowseState(mainWindow);
  await selectPageSize(mainWindow, 64);
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() === '1 / 3'`,
  );
  const pageSize64 = await readBrowseState(mainWindow);
  await selectPageSize(mainWindow, 16);
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-page-status"]')?.textContent?.trim() === '1 / 10'`,
  );
  const pageSize16 = await readBrowseState(mainWindow);

  await click(mainWindow, '[data-testid="fla-review-filter-all"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-raster-grid-count"] strong')?.textContent?.trim().startsWith(${JSON.stringify(`${initial.totalCount} /`)})`,
  );
  await click(mainWindow, '[data-testid="fla-review-select-all"]');
  await waitForExpression(
    mainWindow,
    `document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim().startsWith(${JSON.stringify(`${initial.totalCount}`)})`,
  );
  const restored = await readBrowseState(mainWindow);

  await click(mainWindow, '[data-testid="fla-review-confirm"]');
  await waitForSelector(mainWindow, '[data-testid="fla-review-intent-status"]');
  const confirmed = await mainWindow.webContents.executeJavaScript(`(() => ({
    progressStep: document.querySelector('[data-testid="fla-review-header"] .fla-workbench-progress')?.getAttribute('data-current-step') || '',
    progressText: document.querySelector('[data-testid="fla-review-header"] .fla-workbench-progress')?.textContent?.trim() || '',
    commitActionVisible: Boolean(document.querySelector('[data-testid="fla-review-commit-action"]')),
    intentText: document.querySelector('[data-testid="fla-review-intent-status"]')?.textContent?.trim() || '',
  }))()`);

  const checks = {
    initialPageUsesSixteenCards: firstPageCardCount === 16,
    paginationAdvanced: secondPage.pageStatus !== firstPage && secondPage.visibleCardCount === 16,
    individualToggleGlobalCount: afterToggle.selectedCount === initial.selectedCount - 1,
    unselectedFilter: unselected.activeFilter === 'unselected' && unselected.filteredCount === 1,
    searchFilter: searched.search === toggledCard.name && searched.filteredCount === 1 && searched.pageStatus === '1 / 1',
    selectedFilter: selectedOnly.activeFilter === 'selected' && selectedOnly.filteredCount === initial.selectedCount - 1,
    pageSize32: pageSize32.pageSize === '32' && pageSize32.pageStatus === '1 / 5' && pageSize32.visibleCardCount === 32,
    pageSize64: pageSize64.pageSize === '64' && pageSize64.pageStatus === '1 / 3' && pageSize64.visibleCardCount === 64,
    pageSize16: pageSize16.pageSize === '16' && pageSize16.pageStatus === '1 / 10' && pageSize16.visibleCardCount === 16,
    selectAllRestoresGlobalSelection: restored.activeFilter === 'all' && restored.selectedCount === initial.totalCount,
    confirmOnlyCreatesIntent: confirmed.progressStep === 'confirm' && confirmed.commitActionVisible && confirmed.intentText.includes('尚未创建素材'),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Stage B business checks failed: ${JSON.stringify({ checks, initial, secondPage, afterToggle, unselected, searched, selectedOnly, pageSize32, pageSize64, pageSize16, restored, confirmed })}`);
  }
  return {
    checks,
    initial,
    secondPage,
    toggledCard,
    afterToggle,
    unselected,
    searched,
    selectedOnly,
    pageSize32,
    pageSize64,
    pageSize16,
    restored,
    confirmed,
  };
}

async function run() {
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  const sourceBefore = sha256(sourcePath);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');

  const mainWindow = await waitForMainWindow();
  const project = await createProject(mainWindow);
  const initialProject = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(project.projectRoot)} })`,
  );
  if (!initialProject.ok) throw new Error(`Could not open acceptance project: ${JSON.stringify(initialProject)}`);

  await openRasterReview(mainWindow);
  const layout = await readContainmentState(mainWindow);
  const screenshot = await mainWindow.capturePage();
  const screenshotPath = join(evidenceDir, `${sampleKey}-raster-containment.png`);
  writeFileSync(screenshotPath, screenshot.toPNG());
  const business = sampleKey === 'short'
    ? await runStageBBusinessProbe(mainWindow)
    : null;

  await click(mainWindow, '[data-testid="fla-review-cancel"]');
  await waitForExpression(
    mainWindow,
    `!document.querySelector('[data-testid="fla-review-session"]') && Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`,
  );
  const afterCloseProject = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(project.projectRoot)} })`,
  );
  const sourceAfter = sha256(sourcePath);
  const checks = {
    sourceNameContained: layout.sourceNameContained,
    compatibilityContained: layout.compatibilityContained,
    overviewBeforeCenter: layout.overviewBeforeCenter,
    horizontalOverflow: !layout.horizontalOverflow && !layout.workbenchHorizontalOverflow,
    fullBasenameAvailable: layout.fullBasenameAvailable,
    threeZonesPresent: Boolean(layout.overviewRect && layout.selectionRect && layout.detailRect),
    compatibilityCollapsedByDefault: layout.compatibilityCollapsedByDefault,
    bodyHorizontalOverflowHidden: layout.bodyOverflowX === 'hidden',
    sourceHashInvariant: sourceBefore === sourceAfter,
    projectAssetCountUnchanged: afterCloseProject.ok && afterCloseProject.value.project.assets.length === initialProject.value.project.assets.length,
    stageBRegression: sampleKey !== 'short' || Boolean(business && Object.values(business.checks).every(Boolean)),
    p3HeaderHierarchy: layout.headerDirectChildCount === 3 && layout.progressParentIsHeader && layout.progressCentered,
    p3ReadOnlyCopyReduction: layout.readOnlyImmutabilityCopyCount === 1,
    p3CompatibilitySummary: layout.compatibilityVisibleLayerCount === 1 && layout.compatibilitySummaryRowCount === 1 && !layout.compatibilityHasLegacyHeading && !layout.compatibilityHasLegacyCopy && !layout.compatibilityHasLegacySummary,
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Raster containment checks failed: ${JSON.stringify({ checks, layout })}`);
  }
  const receipt = {
    schemaVersion: 'issue403-raster-containment-electron-sample/1',
    acceptance: { kind: 'automated-real-windows-electron', realWindowsElectron: true },
    sampleKey,
    source: {
      path: sourcePath,
      basename: sourcePath.split(/[\\/]/u).pop(),
      sha256Before: sourceBefore,
      sha256After: sourceAfter,
      hashInvariant: sourceBefore === sourceAfter,
    },
    project,
    layout,
    business,
    checks,
    screenshot: { path: screenshotPath, width: screenshot.getSize().width, height: screenshot.getSize().height },
  };
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
}

app.on('window-all-closed', () => {});

app.whenReady()
  .then(run)
  .then(() => setTimeout(() => app.exit(0), 500))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    setTimeout(() => app.exit(1), 500);
  });
