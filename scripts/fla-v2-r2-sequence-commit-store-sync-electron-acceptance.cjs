#!/usr/bin/env node
/**
 * Issue #311 real Windows/Electron corrective smoke.
 *
 * Drives the production renderer UI against one approved recovered FLA:
 * create a fresh Project, render and commit frames 0..1, verify the normal
 * AssetLibrary and Project revision update before closing the review, then
 * perform a second valid sequence operation to exercise the refreshed state
 * and duplicate path. Private FLA bytes and rendered PNG bytes never enter
 * the receipt.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
  }
  return args;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.frameSequenceCommit)',
        );
        if (ready) return mainWindow;
      } catch {
        // The production renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the Issue #311 APIs');
}

async function runCorrectivePath(mainWindow, acceptanceRoot, projectName) {
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};

      const waitFor = async (selector, predicate = () => true, timeoutMs = 30_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element && predicate(element)) return element;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        throw new Error('Timed out waiting for ' + selector);
      };

      const setControlledInput = (selector, value) => {
        const input = document.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + selector);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Input value setter is unavailable');
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const readState = () => {
        const heading = document.querySelector('.asset-library-heading output')?.textContent?.trim() ?? '';
        const countMatch = heading.match(/(\\d+)/u);
        return {
          heading,
          assetCount: countMatch ? Number(countMatch[1]) : null,
          gridCount: Number(document.querySelector('[data-grid-count]')?.getAttribute('data-grid-count') ?? -1),
          status: document.querySelector('.asset-library-status')?.textContent?.trim() ?? '',
          revisions: [...document.querySelectorAll('[data-project-revision]')]
            .map((element) => Number(element.getAttribute('data-project-revision')))
            .filter((revision) => Number.isFinite(revision)),
        };
      };

      const createProjectThroughUi = async () => {
        await waitFor('[data-testid="new-project-button"]');
        document.querySelector('[data-testid="new-project-button"]').click();
        await waitFor('[data-testid="new-project-dialog"]');
        setControlledInput('[data-testid="new-project-parent-directory"]', acceptanceRoot);
        setControlledInput('[data-testid="new-project-name"]', projectName);
        const confirm = await waitFor(
          '[data-testid="new-project-confirm"]',
          (element) => !element.disabled,
        );
        confirm.click();
        await waitFor('[data-testid="editor-layout"]');
        const assetsTab = await waitFor('[data-activity="assets"]');
        assetsTab.click();
        await waitFor('[data-testid="asset-library"]');
        await waitFor('[data-testid="asset-browser-view"]');
      };

      const prepareSequenceReview = async () => {
        await waitFor('[data-testid="asset-import-fla"]');
        document.querySelector('[data-testid="asset-import-fla"]').click();
        await waitFor('[data-testid="fla-frame-sequence-review"]', () => true, 60_000);
        await waitFor('[data-testid="fla-frame-sequence-range"]', () => true, 60_000);

        const radios = [...document.querySelectorAll('input[data-testid^="fla-frame-sequence-target-"]')];
        let endInput = null;
        for (const radio of radios) {
          if (radio.disabled) continue;
          radio.click();
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
          const candidate = document.querySelector('[data-testid="fla-frame-sequence-end"]');
          if (candidate && Number(candidate.max) >= 1) {
            endInput = candidate;
            break;
          }
        }
        if (!endInput || Number(endInput.max) < 1) {
          throw new Error('No supported R2 target with at least two frames was exposed');
        }
        setControlledInput('[data-testid="fla-frame-sequence-start"]', '0');
        setControlledInput('[data-testid="fla-frame-sequence-end"]', '1');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        const render = await waitFor(
          '[data-testid="fla-frame-sequence-render"]',
          (element) => !element.disabled,
        );
        render.click();
        await waitFor('[data-testid="fla-frame-sequence-import"]', () => true, 60_000);
      };

      const commitFromUi = async (before) => {
        const importButton = await waitFor('[data-testid="fla-frame-sequence-import"]');
        importButton.click();
        await waitFor('[data-testid="fla-frame-sequence-committed"]', () => true, 60_000);
        const status = await waitFor(
          '.asset-library-status',
          (element) => element.textContent?.includes('asset') ?? false,
        );
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
        const after = readState();
        return {
          before,
          after,
          committedText: document.querySelector('[data-testid="fla-frame-sequence-committed"]')?.textContent?.trim() ?? '',
          statusText: status.textContent?.trim() ?? '',
        };
      };

      const closeReview = async () => {
        const close = await waitFor('[data-testid="fla-frame-sequence-close"]');
        close.click();
        await waitFor('[data-testid="asset-browser-view"]');
      };

      await createProjectThroughUi();
      const initial = readState();
      await prepareSequenceReview();
      const first = await commitFromUi(initial);
      const firstImmediate = readState();
      await closeReview();
      const firstNormalLibrary = readState();

      await prepareSequenceReview();
      const second = await commitFromUi(firstNormalLibrary);
      const secondImmediate = readState();
      await closeReview();
      const secondNormalLibrary = readState();

      const expectedNewAssets = 2;
      const firstAddedAssets =
        initial.assetCount !== null && firstImmediate.assetCount !== null
          ? firstImmediate.assetCount - initial.assetCount
          : null;
      const secondAddedAssets =
        firstNormalLibrary.assetCount !== null && secondImmediate.assetCount !== null
          ? secondImmediate.assetCount - firstNormalLibrary.assetCount
          : null;
      const firstRevisionAdvanced = firstImmediate.revisions.includes(1);
      const secondRevisionAdvanced = secondImmediate.revisions.includes(2);
      const noStaleRevisionText = !/stale|revision.*changed|刷新并重试/iu.test(
        first.statusText + ' ' + second.statusText + ' ' + document.body.innerText,
      );

      return {
        ok:
          firstAddedAssets === expectedNewAssets &&
          secondAddedAssets === 0 &&
          firstRevisionAdvanced &&
          secondRevisionAdvanced &&
          firstNormalLibrary.gridCount === expectedNewAssets &&
          secondNormalLibrary.gridCount === expectedNewAssets &&
          noStaleRevisionText,
        projectName,
        initial,
        first,
        firstImmediate,
        firstNormalLibrary,
        second,
        secondImmediate,
        secondNormalLibrary,
        firstAddedAssets,
        secondAddedAssets,
        firstRevisionAdvanced,
        secondRevisionAdvanced,
        noStaleRevisionText,
        projectMutation: 'COMMIT: two UI-confirmed sequence commits; no reopen between first commit and library observation',
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (!args.source || !args.out || !args.acceptanceRoot) {
    throw new Error('Usage: electron scripts/fla-v2-r2-sequence-commit-store-sync-electron-acceptance.cjs --source "D:\\approved\\sample.fla" --acceptance-root "D:\\PandaStage-Acceptance\\issue311" --out "D:\\receipt.json" --user-data "D:\\userdata"');
  }
  const sourcePath = resolve(args.source);
  const outPath = resolve(args.out);
  const acceptanceRoot = resolve(args.acceptanceRoot);
  const userData = resolve(args.userData || `${outPath}.user-data`);
  const projectName = 'Issue311 Sequence Commit Store Sync';
  if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(userData, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  app.setPath('userData', userData);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  require('../dist-electron/main/index.js');

  const sourceSha256Before = sha256(sourcePath);
  const mainWindow = await waitForMainWindow();
  const response = await runCorrectivePath(mainWindow, acceptanceRoot, projectName);
  const sourceSha256After = sha256(sourcePath);
  const projectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
  const projectFile = join(projectRoot, 'project.json');
  const persistedProject = existsSync(projectFile)
    ? JSON.parse(readFileSync(projectFile, 'utf8'))
    : null;
  const receipt = {
    schemaVersion: 'fla-v2-r2-sequence-commit-store-sync-electron-acceptance/1',
    source: {
      basename: sourcePath.split(/[\\/]/u).pop(),
      sha256Before: sourceSha256Before,
      sha256After: sourceSha256After,
      hashInvariant: sourceSha256Before === sourceSha256After,
    },
    project: {
      projectRoot,
      persistedAssetCount: Array.isArray(persistedProject?.assets)
        ? persistedProject.assets.length
        : null,
      privateVisualBytesRecorded: false,
    },
    parserPath: 'real Windows Electron Main + production Renderer UI -> C3/C4 inspection -> V2-R catalog -> R2 render/commit -> AssetLibrary store bridge',
    response,
  };
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.source.hashInvariant || !response?.ok) process.exitCode = 1;
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
