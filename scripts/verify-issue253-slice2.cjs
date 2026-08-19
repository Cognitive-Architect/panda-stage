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

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-activity="assets"]')?.click()`,
  );
  await waitForSelector(mainWindow, '[data-testid="asset-import-fla"]');
  const assetCountTextBefore = await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="asset-library"] .asset-library-heading output')?.textContent || ''`,
  );
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="asset-import-fla"]')?.click()`,
  );
  await waitForSelector(mainWindow, '[data-testid="fla-review-summary"]');

  await waitForSelector(mainWindow, '[data-testid="fla-review-media-grid"] img', 60_000);
  const review = await mainWindow.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const count = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
    return {
      mediaCount: count('[data-testid="fla-review-media-count"]'),
      placedText: [...document.querySelectorAll('[data-testid="fla-review-summary"] dd')].map((node) => node.textContent?.trim() || ''),
      cardCount: cards.length,
      thumbnailCount: document.querySelectorAll('[data-testid="fla-review-media-grid"] img').length,
      transparentCardCount: cards.filter((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0).length,
      jpegOriginCardCount: cards.filter((card) => card.textContent?.includes('source jpg') || card.textContent?.includes('source jpeg')).length,
      a1Present: cards.some((card) => card.querySelector('strong')?.textContent === 'a1.png'),
      statusCounts: Object.fromEntries([...document.querySelectorAll('[data-testid="fla-compatibility-summary"] li')].map((node) => [node.getAttribute('data-status'), node.textContent?.trim() || ''])),
      selectedText: count('[data-testid="fla-review-selected-count"]'),
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
  const subsetText = await mainWindow.webContents.executeJavaScript(`(async () => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const transparent = cards.find((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0);
    const non350 = cards.find((card) => card.querySelector('strong')?.textContent === 'a1.png');
    const jpeg = cards.find((card) => card.textContent?.includes('source jpg') || card.textContent?.includes('source jpeg'));
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

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="asset-import-fla"]')?.click()`,
  );
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

  await mainWindow.webContents.executeJavaScript(
    `document.querySelector('[data-testid="asset-import-fla"]')?.click()`,
  );
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
    selectAllText,
    clearAllText,
    subsetText,
    afterConfirm,
    cancelledBackToAssetBrowser: true,
    cancelBeforeReadyStatus,
    closePanelReleasedReview: true,
    mutationContract: 'Continue/Confirm produced only a read-only selection intent; no Asset/Project mutation API was called by the review component.',
  };
  if (!result.sourceUnchanged) throw new Error('The real FLA sample changed during Slice 2 review');
  if (result.review.mediaCount !== '158' || result.review.cardCount !== 158 || result.review.thumbnailCount !== 158) {
    throw new Error(`Unexpected review media evidence: ${JSON.stringify(result.review)}`);
  }
  if (result.review.transparentCardCount < 1 || result.review.jpegOriginCardCount < 1) {
    throw new Error(`Representative raster review evidence is missing: ${JSON.stringify(result.review)}`);
  }
  if (!result.selectAllText.includes('158') || !result.clearAllText.includes('0') || !result.subsetText.text.includes('3')) {
    throw new Error(`Selection controls did not produce expected counts: ${JSON.stringify(result)}`);
  }
  if (result.subsetText.representativeCount !== 3 || result.subsetText.thumbnailIdentityCount !== 158) {
    throw new Error(`Representative selection or thumbnail identity evidence is incomplete: ${JSON.stringify(result)}`);
  }
  if (!afterConfirm.intentText || !afterConfirm.selectedText.includes('3')) {
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
