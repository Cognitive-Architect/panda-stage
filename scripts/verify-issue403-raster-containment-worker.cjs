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
    return {
      sourceBasename: sourceText,
      sourceTitle,
      sourceRect,
      overviewRect,
      selectionRect,
      detailRect: rect(detail),
      compatibilityRect,
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
