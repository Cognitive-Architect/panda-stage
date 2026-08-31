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
        detailTargetFilenamePresent: (detail?.textContent || '').includes('目标文件名'),
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
      actionsReachable: Boolean(sessionRect && actionSelectors.every((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.top >= sessionRect.top && rect.bottom <= sessionRect.bottom);
      })),
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
    const transparent = cards.find((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0);
    const non350 = cards.find((card) => card.querySelector('strong')?.textContent === 'a1.png');
    const jpeg = cards.find((card) => /^(jpg|jpeg)$/i.test(card.getAttribute('data-source-format') || ''));
    [transparent, non350, jpeg]
      .filter((card, index, selected) => card && selected.indexOf(card) === index)
      .forEach((card) => card.querySelector('input[type="checkbox"]')?.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      text: document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() || '',
      representativeCount: [transparent, non350, jpeg].filter(Boolean).length,
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
    review,
    issue256: {
      chineseFirstReview: review.compatibilityLabels.length === 5 && !review.diagnosticsVisible,
      diagnosticsVisible: review.diagnosticsVisible,
      scrollStability,
    },
    issue390: {
      focusEvidence,
      businessRoute: 'media.length > 0 -> v1-raster-review',
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
  if (Number.parseInt(result.review.mediaCount, 10) !== 158 || result.review.cardCount !== 158 || result.review.thumbnailCount !== 158) {
    throw new Error(`Unexpected review media evidence: ${JSON.stringify(result.review)}`);
  }
  if (result.review.transparentCardCount < 1 || result.review.jpegOriginCardCount < 1) {
    throw new Error(`Representative raster review evidence is missing: ${JSON.stringify(result.review)}`);
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
  if (result.subsetText.representativeCount !== 3 || result.subsetText.thumbnailIdentityCount !== 158) {
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
