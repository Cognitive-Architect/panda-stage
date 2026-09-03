/* Issue #253 Slice 2: real Windows Electron review/selection probe. */
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const samplePath = 'D:\\表情合集\\文件.fla';
const evidenceRoot = 'D:\\PandaStage-Acceptance\\issue-253-slice2';
const evidencePath = path.join(evidenceRoot, 'real-electron-review.json');
const isolatedUserData = path.join(evidenceRoot, 'electron-user-data');

fs.mkdirSync(isolatedUserData, { recursive: true });
app.setPath('userData', isolatedUserData);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          `Boolean(window.pandaStage && window.pandaStage.project && window.pandaStage.fla)`,
        );
        if (ready) return window;
      } catch {
        // The renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the project/FLA APIs');
}

async function waitForSelector(window, selector, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

const FLA_IMPORT_SELECTOR =
  '[data-testid="asset-import-fla"], [data-testid="resource-asset-import-fla"]';

async function selectAssetsActivity(window) {
  const selected = await window.webContents.executeJavaScript(`(() => {
    const control = document.querySelector(
      '[data-testid="resource-activity-tabs"] [data-activity="assets"], ' +
      '[data-testid="resource-activity-rail-assets"]',
    );
    control?.click();
    return Boolean(control);
  })()`);
  if (!selected) throw new Error('Could not select the Assets activity');
}

async function clickFlaImport(window) {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const control = document.querySelector(${JSON.stringify(FLA_IMPORT_SELECTOR)});
    control?.click();
    return Boolean(control);
  })()`);
  if (!clicked) throw new Error('Could not find the FLA import action');
}

async function waitForExpression(window, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Input value setter is unavailable');
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function readRasterState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
    const firstNumber = (value) => Number(value.match(/\\d+/)?.[0] || 0);
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const grid = document.querySelector('[data-testid="fla-review-media-grid"]');
    const body = document.querySelector('[data-testid="fla-review-body"]');
    const detail = document.querySelector('[data-testid="fla-raster-detail"]');
    const pageSize = document.querySelector('[data-testid="fla-review-page-size"]');
    return {
      totalCount: firstNumber(text('[data-testid="fla-review-media-count"]')),
      visibleCardCount: cards.length,
      visibleThumbnailCount: document.querySelectorAll('[data-testid="fla-review-media-grid"] img').length,
      selectedCount: firstNumber(text('[data-testid="fla-review-selected-count"]')),
      selectedIds: cards.filter((card) => card.querySelector('input[type="checkbox"]')?.checked)
        .map((card) => card.getAttribute('data-fla-media-id')),
      pageStatus: text('[data-testid="fla-review-page-status"]'),
      pageSize: pageSize?.value || '',
      pageSizeOptions: pageSize ? [...pageSize.options].map((option) => option.value) : [],
      cardIds: cards.map((card) => card.getAttribute('data-fla-media-id')),
      cardNames: cards.map((card) => card.querySelector('strong')?.textContent?.trim() || ''),
      cardText: cards[0]?.textContent?.trim() || '',
      cardHasDimensions: cards.some((card) => /\\d+\\s*[×x]\\s*\\d+/u.test(card.textContent || '')),
      transparentCount: cards.filter((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0).length,
      jpegCount: cards.filter((card) => /^(jpg|jpeg)$/i.test(card.getAttribute('data-source-format') || '')).length,
      a1Present: cards.some((card) => card.querySelector('strong')?.textContent === 'a1.png'),
      focusedMediaId: detail?.querySelector('[data-focused-media-id]')?.getAttribute('data-focused-media-id') || '',
      fileDetailsCollapsed: !document.querySelector('[data-testid="fla-raster-file-details"]')?.open,
      structureDetailsCollapsed: !document.querySelector('[data-testid="fla-raster-structure"]')?.open,
      compatibilityDetailsCollapsed: !document.querySelector('[data-testid="fla-compatibility-notes"]')?.open,
      compatibilityWarningSummary: text('[data-testid="fla-raster-compatibility-summary"]'),
      filters: Object.fromEntries(['all', 'selected', 'unselected'].map((filter) => [
        filter,
        document.querySelector('[data-testid="fla-review-filter-' + filter + '"]')?.getAttribute('aria-pressed') === 'true',
      ])),
      primaryActionCount: [...document.querySelectorAll('.fla-review-primary-action')]
        .filter((button) => !button.disabled && button.getBoundingClientRect().height > 0).length,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
      bodyScrollHeight: body?.scrollHeight || 0,
      bodyClientHeight: body?.clientHeight || 0,
      gridOverflowY: grid ? getComputedStyle(grid).overflowY : '',
      gridScrollHeight: grid?.scrollHeight || 0,
      gridClientHeight: grid?.clientHeight || 0,
    };
  })()`);
}

async function run() {
  if (!fs.existsSync(samplePath)) throw new Error(`Sample is missing: ${samplePath}`);
  const sourceBefore = sha256(samplePath);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = samplePath;
  require('../dist-electron/main/index.js');

  const mainWindow = await waitForMainWindow();
  const projectName = `slice2-review-${Date.now()}`;
  const createResult = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('[data-testid="new-project-button"]')?.click();
      return true;
    })()
  `);
  if (!createResult) throw new Error('Could not open the new-project dialog');
  await waitForSelector(mainWindow, '[data-testid="new-project-dialog"]');
  await setInput(mainWindow, '[data-testid="new-project-parent-directory"]', evidenceRoot);
  await setInput(mainWindow, '[data-testid="new-project-name"]', projectName);
  await waitForSelector(mainWindow, '[data-testid="new-project-confirm"]:not([disabled])');
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="new-project-confirm"]')?.click()`,
  );
  await waitForSelector(mainWindow, '[data-testid="editor-layout"]');

  const projectRoot = path.join(evidenceRoot, `${projectName}.pandastage`);
  const initialDocument = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} })`,
  );
  if (!initialDocument.ok) throw new Error(`Could not read acceptance project: ${JSON.stringify(initialDocument)}`);
  const assetCountBefore = initialDocument.value.project.assets.length;

  await selectAssetsActivity(mainWindow);
  await waitForSelector(mainWindow, FLA_IMPORT_SELECTOR);
  const assetCountTextBefore = await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="asset-library"] .asset-library-heading output')?.textContent || ''`,
  );
  await clickFlaImport(mainWindow);
  await waitForSelector(mainWindow, '[data-testid="fla-review-summary"]');

  await waitForSelector(mainWindow, '[data-testid="fla-review-media-grid"] img', 60_000);
  const initialRasterState = await readRasterState(mainWindow);
  const review = await mainWindow.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const count = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
    const session = document.querySelector('[data-testid="fla-review-session"]');
    const portal = document.querySelector('[data-testid="fla-review-portal"]');
    const reviewBody = document.querySelector('[data-testid="fla-review-body"]');
    const mediaGrid = document.querySelector('[data-testid="fla-review-media-grid"]');
    const overview = document.querySelector('[data-testid="fla-raster-overview"]');
    const selection = document.querySelector('[data-testid="fla-raster-selection"]');
    const detail = document.querySelector('[data-testid="fla-raster-detail"]');
    const sessionRect = session?.getBoundingClientRect();
    const overviewRect = overview?.getBoundingClientRect();
    const selectionRect = selection?.getBoundingClientRect();
    const detailRect = detail?.getBoundingClientRect();
    const portalStyle = portal ? getComputedStyle(portal) : null;
    const reviewBodyStyle = reviewBody ? getComputedStyle(reviewBody) : null;
    const mediaGridStyle = mediaGrid ? getComputedStyle(mediaGrid) : null;
    const toolbar = document.querySelector('[data-testid="fla-review-selection-toolbar"]');
    const firstCard = cards[0];
    const firstCardRect = firstCard?.getBoundingClientRect();
    const toolbarRect = toolbar?.getBoundingClientRect();
    const reviewBodyRect = reviewBody?.getBoundingClientRect();
    const visibleReviewText = session?.textContent || '';
    const contentClearOfToolbar = Boolean(
      firstCardRect && toolbarRect && reviewBodyRect && (
        firstCardRect.top >= toolbarRect.bottom ||
        toolbarRect.top >= reviewBodyRect.bottom - 1
      ),
    );
    const root = document.getElementById('root');
    const compatibilityNotes = document.querySelector('[data-testid="fla-compatibility-notes"]');
    if (reviewBody) reviewBody.scrollTop = reviewBody.scrollHeight;
    const lastCard = cards[cards.length - 1];
    const lastCardRect = lastCard?.getBoundingClientRect();
    const actionSelectors = [
      '[data-testid="fla-review-selected-count"]',
      '[data-testid="fla-review-select-all"]',
      '[data-testid="fla-review-clear-all"]',
      '[data-testid="fla-review-confirm"]',
      '[data-testid="fla-review-cancel"]',
    ];
    return {
      mediaCount: count('[data-testid="fla-review-media-count"]'),
      placedText: [...document.querySelectorAll('[data-testid="fla-review-summary"] dd')].map((node) => node.textContent?.trim() || ''),
      cardCount: cards.length,
      thumbnailCount: document.querySelectorAll('[data-testid="fla-review-media-grid"] img').length,
      transparentCardCount: cards.filter((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0).length,
      jpegOriginCardCount: cards.filter((card) => /^(jpg|jpeg)$/i.test(card.getAttribute('data-source-format') || '')).length,
      a1Present: cards.some((card) => card.querySelector('strong')?.textContent === 'a1.png'),
      statusCounts: Object.fromEntries([...document.querySelectorAll('[data-testid="fla-compatibility-summary"] li')].map((node) => [node.getAttribute('data-status'), node.textContent?.trim() || ''])),
      selectedText: count('[data-testid="fla-review-selected-count"]'),
      compatibilityLabels: [...document.querySelectorAll('[data-testid="fla-compatibility-summary"] strong')].map((node) => node.textContent?.trim() || ''),
      diagnosticsVisible: visibleReviewText.includes('SHA-256') || /fla-media-[a-z0-9-]+/i.test(visibleReviewText),
      compatibilityNotes: {
        present: Boolean(compatibilityNotes),
        collapsedByDefault: compatibilityNotes ? !compatibilityNotes.open : false,
      },
      workbench: {
        route: session?.getAttribute('data-workbench-route') || '',
        threeZonesPresent: Boolean(overview && selection && detail),
        gridDominant: Boolean(
          overviewRect && selectionRect && detailRect &&
          selectionRect.width > overviewRect.width &&
          selectionRect.width > detailRect.width
        ),
        detailPreviewPresent: Boolean(detail?.querySelector('.fla-review-detail-preview img')),
        detailTargetFilenamePresent: (detail?.textContent || '').includes('目标文件名') || (detail?.textContent || '').includes('来源与目标'),
        progressText: document.querySelector('.fla-workbench-progress')?.textContent?.trim() || '',
        currentStep: document.querySelector('.fla-workbench-progress [aria-current="step"]')?.textContent?.trim() || '',
        primaryActionCount: [...document.querySelectorAll('.fla-review-primary-action')]
          .filter((button) => !button.disabled && button.getBoundingClientRect().height > 0).length,
      },
      overlay: {
        width: sessionRect?.width ?? 0,
        viewportWidth: window.innerWidth,
        layout: session?.getAttribute('data-review-layout') || '',
      },
      foreground: {
        portalInBody: Boolean(portal && portal.parentElement === document.body),
        rootInert: Boolean(root?.inert),
        portalPosition: portalStyle?.position || '',
        portalZIndex: portalStyle?.zIndex || '',
        backdropPresent: Boolean(document.querySelector('[data-testid="fla-review-backdrop"]')),
      },
      scrollRegion: {
        overflowY: reviewBodyStyle?.overflowY || '',
        clientHeight: reviewBody?.clientHeight || 0,
        scrollHeight: reviewBody?.scrollHeight || 0,
        scrollTop: reviewBody?.scrollTop || 0,
        primary: Boolean(reviewBody && reviewBodyStyle && ['auto', 'scroll'].includes(reviewBodyStyle.overflowY) && reviewBody.scrollHeight > reviewBody.clientHeight),
        mediaOverflowY: mediaGridStyle?.overflowY || '',
        mediaSecondScroll: Boolean(mediaGrid && mediaGridStyle && ['auto', 'scroll'].includes(mediaGridStyle.overflowY) && mediaGrid.scrollHeight > mediaGrid.clientHeight),
        bodyTop: reviewBodyRect?.top ?? 0,
        bodyBottom: reviewBodyRect?.bottom ?? 0,
        lastCardTop: lastCardRect?.top ?? 0,
        lastCardBottom: lastCardRect?.bottom ?? 0,
        lateItemReachable: Boolean(lastCardRect && reviewBodyRect && lastCardRect.top >= reviewBodyRect.top - 1 && lastCardRect.bottom <= reviewBodyRect.bottom + 1),
        contentClearOfToolbar,
      },
      actionsReachable: actionSelectors.every((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return Boolean(rect && rect.width > 0 && rect.height > 0);
      }),
    };
  })()`);

  const paginationEvidence = await mainWindow.webContents.executeJavaScript(`(async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
    const read = () => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
      const firstNumber = (value) => Number(value.match(/\\d+/)?.[0] || 0);
      const cards = [...document.querySelectorAll('[data-fla-media-id]')];
      return {
        pageStatus: text('[data-testid="fla-review-page-status"]'),
        pageSize: document.querySelector('[data-testid="fla-review-page-size"]')?.value || '',
        filteredCount: firstNumber(text('[data-testid="fla-raster-grid-count"]')),
        selectedCount: firstNumber(text('[data-testid="fla-review-selected-count"]')),
        visibleCardCount: cards.length,
        selectedIds: cards.filter((card) => card.querySelector('input[type="checkbox"]')?.checked)
          .map((card) => card.getAttribute('data-fla-media-id')),
        cardIds: cards.map((card) => card.getAttribute('data-fla-media-id')),
        cardNames: cards.map((card) => card.querySelector('strong')?.textContent?.trim() || ''),
        transparentCount: cards.filter((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0).length,
        jpegCount: cards.filter((card) => /^(jpg|jpeg)$/i.test(card.getAttribute('data-source-format') || '')).length,
        a1Present: cards.some((card) => card.querySelector('strong')?.textContent === 'a1.png'),
        focusedMediaId: document.querySelector('[data-focused-media-id]')?.getAttribute('data-focused-media-id') || '',
        filter: ['all', 'selected', 'unselected'].find((filter) =>
          document.querySelector('[data-testid="fla-review-filter-' + filter + '"]')?.getAttribute('aria-pressed') === 'true',
        ) || '',
        search: document.querySelector('[data-testid="fla-review-search"]')?.value || '',
      };
    };
    const waitFor = async (predicate) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await tick();
      }
      throw new Error('Timed out while changing the raster review view');
    };
    const clickPage = async (direction) => {
      const buttons = [...document.querySelectorAll('[data-testid="fla-review-pagination"] button')];
      const button = direction > 0 ? buttons[1] : buttons[0];
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      const before = read().pageStatus;
      button.click();
      await waitFor(() => read().pageStatus !== before);
      return true;
    };
    const setInputValue = (selector, value) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) throw new Error('Search input is missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Search input setter is unavailable');
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setPageSize = async (value) => {
      const select = document.querySelector('[data-testid="fla-review-page-size"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Page-size select is missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Page-size setter is unavailable');
      setter.call(select, String(value));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => read().pageSize === String(value));
    };
    const body = document.querySelector('[data-testid="fla-review-body"]');
    if (body) body.scrollTop = 0;
    await tick();

    const initial = read();
    const pageSizeOptions = [...document.querySelectorAll('[data-testid="fla-review-page-size"] option')]
      .map((option) => option.value);
    const pages = [];
    while (true) {
      const state = read();
      pages.push({
        pageStatus: state.pageStatus,
        cardIds: state.cardIds,
        cardNames: state.cardNames,
        transparentCount: state.transparentCount,
        jpegCount: state.jpegCount,
        a1Present: state.a1Present,
      });
      if (!(await clickPage(1))) break;
    }
    while (await clickPage(-1)) {
      // Return to the first page before exercising mutations.
    }
    const afterPageTraversal = read();

    await clickPage(1);
    const pageTwoBeforeToggle = read();
    const targetCard = document.querySelector('[data-testid="fla-review-media-grid"] [data-fla-media-id]');
    const targetId = targetCard?.getAttribute('data-fla-media-id') || '';
    const targetName = targetCard?.querySelector('strong')?.textContent?.trim() || '';
    targetCard?.click();
    await tick();
    const pageTwoAfterToggle = read();

    document.querySelector('[data-testid="fla-review-filter-unselected"]')?.click();
    await waitFor(() => read().filter === 'unselected');
    const unselectedFilter = read();
    setInputValue('[data-testid="fla-review-search"]', targetName);
    await waitFor(() => read().search === targetName);
    const searchResult = read();
    setInputValue('[data-testid="fla-review-search"]', '');
    await waitFor(() => read().search === '');
    document.querySelector('[data-testid="fla-review-filter-selected"]')?.click();
    await waitFor(() => read().filter === 'selected');
    const selectedFilter = read();
    document.querySelector('[data-testid="fla-review-filter-all"]')?.click();
    await waitFor(() => read().filter === 'all');

    await setPageSize(32);
    const pageSize32 = read();
    await setPageSize(64);
    const pageSize64 = read();
    await setPageSize(16);
    const pageSize16 = read();

    document.querySelector('[data-testid="fla-review-select-all"]')?.click();
    await tick();
    const afterGlobalSelectAll = read();
    document.querySelector('[data-testid="fla-review-clear-all"]')?.click();
    await tick();
    const afterGlobalClearAll = read();
    document.querySelector('[data-testid="fla-review-select-all"]')?.click();
    await tick();
    const afterGlobalRestore = read();

    await clickPage(1);
    const focusTarget = document.querySelector('[data-testid="fla-review-media-grid"] [data-fla-media-id]');
    const focusTargetId = focusTarget?.getAttribute('data-fla-media-id') || '';
    focusTarget?.focus();
    await tick();
    const afterKeyboardFocus = read();
    while (await clickPage(-1)) {
      // Return to page one for the remaining selection-path checks.
    }
    const allIds = pages.flatMap((page) => page.cardIds);
    return {
      initial,
      afterPageTraversal,
      pageSizeOptions,
      pages,
      pageCount: pages.length,
      uniqueIdCount: new Set(allIds).size,
      thumbnailCoverage: allIds.length,
      transparentTotal: pages.reduce((sum, page) => sum + page.transparentCount, 0),
      jpegTotal: pages.reduce((sum, page) => sum + page.jpegCount, 0),
      a1Present: pages.some((page) => page.a1Present),
      pageTwoBeforeToggle,
      pageTwoAfterToggle,
      targetId,
      targetName,
      unselectedFilter,
      selectedFilter,
      searchResult,
      pageSize32,
      pageSize64,
      pageSize16,
      afterGlobalSelectAll,
      afterGlobalClearAll,
      afterGlobalRestore,
      focusTargetId,
      afterKeyboardFocus,
    };
  })()`);

  const focusEvidence = await mainWindow.webContents.executeJavaScript(`(async () => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const target = cards[1];
    target?.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      expectedMediaId: target?.getAttribute('data-fla-media-id') || '',
      focusedMediaId: document.querySelector('[data-focused-media-id]')?.getAttribute('data-focused-media-id') || '',
      focusedCardMatches: target?.classList.contains('fla-review-media-card-focused') || false,
    };
  })()`);

  const scrollStability = await mainWindow.webContents.executeJavaScript(`(async () => {
    const body = document.querySelector('[data-testid="fla-review-body"]');
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const summary = document.querySelector('[data-testid="fla-compatibility-notes"] summary');
    if (!body || !summary || cards.length < 3) throw new Error('Scroll stability targets are missing');
    const mediaIdsBefore = cards.map((card) => card.getAttribute('data-fla-media-id'));
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const deepTarget = Math.max(1, Math.floor(maxScrollTop * 0.72));
    body.scrollTop = deepTarget;
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    const beforeSelection = body.scrollTop;
    cards[Math.floor(cards.length / 2)]?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterSelection = body.scrollTop;
    const beforeExpand = body.scrollTop;
    summary.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterExpand = body.scrollTop;
    summary.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterCollapse = body.scrollTop;
    const mediaIdsAfter = [...document.querySelectorAll('[data-fla-media-id]')]
      .map((card) => card.getAttribute('data-fla-media-id'));
    return {
      deepTarget,
      beforeSelection,
      afterSelection,
      beforeExpand,
      afterExpand,
      afterCollapse,
      mediaOrderStable: JSON.stringify(mediaIdsBefore) === JSON.stringify(mediaIdsAfter),
      selectionPreserved: Math.abs(afterSelection - beforeSelection) <= 1,
      disclosureDidNotReset: afterExpand > 0 && afterCollapse > 0,
    };
  })()`);

  const selectAllText = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-testid="fla-review-select-all"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '';
  })()`);
  const clearAllText = await mainWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-testid="fla-review-clear-all"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '';
  })()`);
  const interactionText = await mainWindow.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('[data-fla-media-id]');
    const thumbnail = card?.querySelector('[data-selection-target="thumbnail"]');
    const checkbox = card?.querySelector('[data-selection-target="checkbox"]');
    const body = card?.querySelector('strong');
    const read = () => document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '';
    card?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterCard = read();
    thumbnail?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterThumbnail = read();
    checkbox?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterCheckbox = read();
    body?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      afterCard,
      afterThumbnail,
      afterCheckbox,
      afterBody: read(),
      cardTargetPresent: Boolean(card),
      thumbnailTargetPresent: Boolean(thumbnail),
      checkboxTargetPresent: Boolean(checkbox),
    };
  })()`);
  const subsetText = await mainWindow.webContents.executeJavaScript(`(async () => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const representative = cards.slice(0, 3);
    representative.forEach((card) => card.querySelector('input[type="checkbox"]')?.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      text: document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '',
      representativeCount: representative.length,
      thumbnailIdentityCount: cards.filter((card) => card.querySelector('img')?.alt === card.querySelector('strong')?.textContent).length,
    };
  })()`);
  await waitForSelector(mainWindow, '[data-testid="fla-review-confirm"]:not([disabled])');
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="fla-review-confirm"]')?.click()`,
  );
  await waitForSelector(mainWindow, '[data-testid="fla-review-intent-status"]');
  const afterConfirm = await mainWindow.webContents.executeJavaScript(`({
    intentText: document.querySelector('[data-testid="fla-review-intent-status"]')?.textContent?.trim() || '',
    selectedText: document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '',
    assetCountText: document.querySelector('[data-testid="asset-library"] .asset-library-heading output')?.textContent || '',
    commitPresent: Boolean(document.querySelector('[data-testid="fla-review-commit"]')),
    primaryActionCount: [...document.querySelectorAll('.fla-review-primary-action')]
      .filter((button) => !button.disabled && button.getBoundingClientRect().height > 0).length,
  })`);
  const afterDocument = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} })`,
  );

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="fla-review-cancel"]')?.click()`,
  );
  await waitForExpression(
    mainWindow,
    `!document.querySelector('[data-testid="fla-review-session"]') && Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`,
  );

  await clickFlaImport(mainWindow);
  await waitForSelector(mainWindow, '[data-testid="fla-review-session"]');
  const cancelBeforeReadyStatus = await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="fla-review-status"]')?.textContent?.trim() || ''`,
  );
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="fla-review-cancel"]')?.click()`,
  );
  await waitForExpression(
    mainWindow,
    `!document.querySelector('[data-testid="fla-review-session"]') && Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`,
  );

  await clickFlaImport(mainWindow);
  await waitForSelector(mainWindow, '[data-testid="fla-review-session"]');
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="resource-activity-close"]')?.click()`,
  );
  await waitForExpression(
    mainWindow,
    `!document.querySelector('[data-testid="fla-review-session"]') && document.querySelector('[data-testid="resource-activity-dock"]')?.getAttribute('data-resource-drawer-open') === 'false'`,
  );
  const sourceAfter = sha256(samplePath);
  const result = {
    issue: 253,
    slice: 'V1 Slice 2',
    passed: true,
    electron: process.versions.electron,
    node: process.versions.node,
    samplePath,
    sourceBefore,
    sourceAfter,
    sourceUnchanged: sourceBefore === sourceAfter,
    projectRoot,
    assetCountBefore,
    assetCountAfter: afterDocument.ok ? afterDocument.value.project.assets.length : null,
    assetCountTextBefore,
    assetCountTextAfter: afterConfirm.assetCountText,
    initialRasterState,
    review,
    paginationEvidence,
    issue256: {
      chineseFirstReview: review.compatibilityLabels.length === 5 && !review.diagnosticsVisible,
      diagnosticsVisible: review.diagnosticsVisible,
      scrollStability,
    },
    issue390: {
      focusEvidence,
      businessRoute: 'media.length > 0 -> v1-raster-review',
    },
    issue392: {
      scope: 'Stage B v1.1 pagination and information distillation',
      defaultPageSize: 16,
      pageSizes: [16, 32, 64],
      selectionIsPresentationOnly: true,
      globalSelectClear: true,
    },
    selectAllText,
    clearAllText,
    interactionText,
    subsetText,
    afterConfirm,
    cancelledBackToAssetBrowser: true,
    cancelBeforeReadyStatus,
    closePanelReleasedReview: true,
    mutationContract: 'Continue/Confirm produced only a read-only selection intent; no Asset/Project mutation API was called by the review component.',
  };
  if (!result.sourceUnchanged) throw new Error('The real FLA sample changed during Slice 2 review');
  if (Number.parseInt(result.review.mediaCount, 10) !== 158 || result.review.cardCount !== result.review.thumbnailCount) {
    throw new Error(`Unexpected review media evidence: ${JSON.stringify(result.review)}`);
  }
  if (
    result.initialRasterState.totalCount !== 158 ||
    result.initialRasterState.visibleCardCount !== 16 ||
    result.initialRasterState.visibleThumbnailCount !== 16 ||
    result.initialRasterState.selectedCount !== 158 ||
    result.initialRasterState.pageStatus !== '1 / 10' ||
    result.initialRasterState.pageSizeOptions.join(',') !== '16,32,64' ||
    result.initialRasterState.cardHasDimensions ||
    !result.initialRasterState.fileDetailsCollapsed ||
    !result.initialRasterState.structureDetailsCollapsed ||
    !result.initialRasterState.compatibilityDetailsCollapsed ||
    !result.initialRasterState.compatibilityWarningSummary.includes('3') ||
    result.initialRasterState.primaryActionCount !== 1 ||
    result.initialRasterState.bodyOverflowY !== 'auto' ||
    result.initialRasterState.gridOverflowY !== 'visible' ||
    result.initialRasterState.gridScrollHeight !== result.initialRasterState.gridClientHeight ||
    result.paginationEvidence.pageCount !== 10 ||
    result.paginationEvidence.initial.pageSize !== '16' ||
    result.paginationEvidence.initial.visibleCardCount !== 16 ||
    result.paginationEvidence.uniqueIdCount !== 158 ||
    result.paginationEvidence.thumbnailCoverage !== 158 ||
    result.paginationEvidence.transparentTotal < 1 ||
    result.paginationEvidence.jpegTotal < 1 ||
    !result.paginationEvidence.a1Present ||
    result.paginationEvidence.pageSizeOptions.join(',') !== '16,32,64' ||
    result.paginationEvidence.pageTwoAfterToggle.selectedCount !== 157 ||
    result.paginationEvidence.pageTwoAfterToggle.selectedIds.includes(result.paginationEvidence.targetId) ||
    result.paginationEvidence.unselectedFilter.visibleCardCount !== 1 ||
    result.paginationEvidence.unselectedFilter.filteredCount !== 1 ||
    result.paginationEvidence.unselectedFilter.selectedCount !== 157 ||
    result.paginationEvidence.searchResult.filteredCount !== 1 ||
    result.paginationEvidence.searchResult.visibleCardCount !== 1 ||
    result.paginationEvidence.searchResult.selectedCount !== 157 ||
    result.paginationEvidence.selectedFilter.filteredCount !== 157 ||
    result.paginationEvidence.selectedFilter.visibleCardCount !== 16 ||
    result.paginationEvidence.selectedFilter.selectedCount !== 157 ||
    result.paginationEvidence.pageSize32.visibleCardCount !== 32 ||
    result.paginationEvidence.pageSize32.pageStatus !== '1 / 5' ||
    result.paginationEvidence.pageSize32.selectedCount !== 157 ||
    result.paginationEvidence.pageSize64.visibleCardCount !== 64 ||
    result.paginationEvidence.pageSize64.pageStatus !== '1 / 3' ||
    result.paginationEvidence.pageSize64.selectedCount !== 157 ||
    result.paginationEvidence.pageSize16.visibleCardCount !== 16 ||
    result.paginationEvidence.pageSize16.pageStatus !== '1 / 10' ||
    result.paginationEvidence.pageSize16.selectedCount !== 157 ||
    result.paginationEvidence.afterGlobalSelectAll.selectedCount !== 158 ||
    result.paginationEvidence.afterGlobalClearAll.selectedCount !== 0 ||
    result.paginationEvidence.afterGlobalRestore.selectedCount !== 158 ||
    result.paginationEvidence.afterPageTraversal.selectedCount !== 158 ||
    result.paginationEvidence.afterKeyboardFocus.focusedMediaId !== result.paginationEvidence.focusTargetId
  ) {
    throw new Error(`Pagination/filter/selection evidence is incomplete: ${JSON.stringify(result.paginationEvidence)}`);
  }
  if (
    result.review.overlay.layout !== 'portal' ||
    result.review.overlay.width < Math.min(640, result.review.overlay.viewportWidth - 32) - 1 ||
    !result.review.foreground.portalInBody ||
    !result.review.foreground.rootInert ||
    result.review.foreground.portalPosition !== 'fixed' ||
    result.review.foreground.portalZIndex !== '1000' ||
    !result.review.foreground.backdropPresent ||
    !result.review.scrollRegion.primary ||
    result.review.scrollRegion.mediaSecondScroll ||
    !result.review.scrollRegion.lateItemReachable ||
    !result.review.scrollRegion.contentClearOfToolbar ||
    !result.review.actionsReachable ||
    !result.review.compatibilityNotes.present ||
    !result.review.compatibilityNotes.collapsedByDefault ||
    result.review.workbench.route !== 'raster' ||
    !result.review.workbench.threeZonesPresent ||
    !result.review.workbench.gridDominant ||
    !result.review.workbench.detailPreviewPresent ||
    !result.review.workbench.detailTargetFilenamePresent ||
    result.review.workbench.currentStep !== '选择素材' ||
    result.review.workbench.primaryActionCount !== 1 ||
    !['完全兼容', '部分兼容', '暂不支持', '未知', '未出现'].every((label) => result.review.compatibilityLabels.includes(label)) ||
    result.review.diagnosticsVisible
  ) {
    throw new Error(`Review workspace UX evidence is incomplete: ${JSON.stringify(result.review)}`);
  }
  if (
    !scrollStability.mediaOrderStable ||
    !scrollStability.selectionPreserved ||
    !scrollStability.disclosureDidNotReset ||
    scrollStability.deepTarget < 1
  ) {
    throw new Error(`Review scroll position was not preserved: ${JSON.stringify(scrollStability)}`);
  }
  if (
    focusEvidence.expectedMediaId === '' ||
    focusEvidence.focusedMediaId !== focusEvidence.expectedMediaId ||
    !focusEvidence.focusedCardMatches
  ) {
    throw new Error(`Contextual detail did not follow keyboard focus: ${JSON.stringify(focusEvidence)}`);
  }
  if (
    !result.interactionText.cardTargetPresent ||
    !result.interactionText.thumbnailTargetPresent ||
    !result.interactionText.checkboxTargetPresent ||
    !result.interactionText.afterCard.includes('1') ||
    !result.interactionText.afterThumbnail.includes('0') ||
    !result.interactionText.afterCheckbox.includes('1') ||
    !result.interactionText.afterBody.includes('0')
  ) {
    throw new Error(`Card/thumbnail/checkbox selection evidence is incomplete: ${JSON.stringify(result.interactionText)}`);
  }
  if (!result.selectAllText.includes('158') || !result.clearAllText.includes('0') || !result.subsetText.text.includes('3')) {
    throw new Error(`Selection controls did not produce expected counts: ${JSON.stringify(result)}`);
  }
  if (
    result.subsetText.representativeCount !== 3 ||
    result.subsetText.thumbnailIdentityCount !== result.review.cardCount
  ) {
    throw new Error(`Representative selection or thumbnail identity evidence is incomplete: ${JSON.stringify(result)}`);
  }
  if (!afterConfirm.intentText || !afterConfirm.selectedText.includes('3') || !afterConfirm.commitPresent || afterConfirm.primaryActionCount !== 1) {
    throw new Error(`Read-only selection intent was not confirmed: ${JSON.stringify(afterConfirm)}`);
  }
  if (result.assetCountBefore !== result.assetCountAfter || result.assetCountTextBefore !== result.assetCountTextAfter) {
    throw new Error(`Review changed the project asset count: ${JSON.stringify(result)}`);
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

app.on('window-all-closed', () => {});

app.whenReady()
  .then(run)
  .then(() => setTimeout(() => app.exit(0), 500))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    setTimeout(() => app.exit(1), 500);
  });
