#!/usr/bin/env node
/**
 * Issue #396 real Windows/Electron Stage D acceptance.
 *
 * The verifier creates a small, external zero-raster FLA/XFL sample and
 * drives the production renderer through the shared R1/R2 workbench. The
 * receipt records bounded UI/project metadata only; source and rendered
 * visual bytes remain outside the repository and are never serialized.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue396-stage-d';
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

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

function buildSymbolXml(symbolName, color, offset) {
  const frames = [0, 1, 2].map((frameIndex) => `
            <DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${offset + frameIndex * 8}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="${color}" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges><Edge cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${symbolName}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="${symbolName}-timeline">
      <layers>
        <DOMLayer name="${symbolName}-layer">
          <frames>${frames}
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
}

async function writeSyntheticZeroRasterFla(sourcePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="scene1">
      <layers>
        <DOMLayer name="scene-layer">
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMSymbolInstance libraryItemName="issue396-stage-d-target-a">
                  <matrix a="1" d="1" tx="30" ty="40"/>
                </DOMSymbolInstance>
                <DOMSymbolInstance libraryItemName="issue396-stage-d-target-b">
                  <matrix a="1" d="1" tx="180" ty="40"/>
                </DOMSymbolInstance>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  zip.file(
    'LIBRARY/issue396-stage-d-target-a.xml',
    buildSymbolXml('issue396-stage-d-target-a', '#3d9b62', 0),
  );
  zip.file(
    'LIBRARY/issue396-stage-d-target-b.xml',
    buildSymbolXml('issue396-stage-d-target-b', '#4d82c4', 12),
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(sourcePath, bytes);
  return sha256(sourcePath);
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
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog && window.pandaStage?.fla?.staticSnapshotPreview && window.pandaStage?.fla?.staticSnapshotCommit)',
        );
        if (ready) return mainWindow;
      } catch {
        // The production renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the Stage D APIs');
}

async function runStageDPath(mainWindow, acceptanceRoot, projectName) {
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};

      const waitFor = async (selector, predicate = () => true, timeoutMs = 60_000) => {
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

      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + selector);
        if (element instanceof HTMLButtonElement && element.disabled) {
          throw new Error('Clickable element is disabled ' + selector);
        }
        element.click();
      };

      const readProjectState = () => {
        const heading = document.querySelector('.asset-library-heading output')?.textContent?.trim() ?? '';
        const countMatch = heading.match(/(\\d+)/u);
        const revisions = [...document.querySelectorAll('[data-project-revision]')]
          .map((element) => Number(element.getAttribute('data-project-revision')))
          .filter((revision) => Number.isFinite(revision));
        return {
          heading,
          assetCount: countMatch ? Number(countMatch[1]) : null,
          gridCount: Number(document.querySelector('[data-grid-count]')?.getAttribute('data-grid-count') ?? -1),
          maxRevision: revisions.length > 0 ? Math.max(...revisions) : null,
          revisions,
        };
      };

      const waitForSnapshotTargets = async () => {
        await waitFor('[data-testid="fla-render-workbench"]');
        await waitFor('[data-testid="fla-snapshot-targets"]', (element) =>
          element.querySelectorAll('input[data-testid^="fla-snapshot-target-"]').length > 0,
        );
      };

      const createProjectThroughUi = async () => {
        await waitFor('[data-testid="new-project-button"]');
        click('[data-testid="new-project-button"]');
        await waitFor('[data-testid="new-project-dialog"]');
        setControlledInput('[data-testid="new-project-parent-directory"]', acceptanceRoot);
        setControlledInput('[data-testid="new-project-name"]', projectName);
        await waitFor('[data-testid="new-project-confirm"]', (element) => !element.disabled);
        click('[data-testid="new-project-confirm"]');
        await waitFor('[data-testid="editor-layout"]');
        await waitFor('[data-activity="assets"]');
        click('[data-activity="assets"]');
        await waitFor('[data-testid="asset-library"]');
        await waitFor('[data-testid="asset-browser-view"]');
      };

      const openStageDReview = async () => {
        await waitFor(
          '[data-testid="asset-import-fla"], [data-testid="resource-asset-import-fla"]',
          (element) => {
            const directAction = document.querySelector('[data-testid="asset-import-fla"]');
            const resourceAction = document.querySelector('[data-testid="resource-asset-import-fla"]');
            return Boolean(
              (directAction instanceof HTMLButtonElement && !directAction.disabled) ||
              (resourceAction instanceof HTMLButtonElement && !resourceAction.disabled),
            );
          },
        );
        const directAction = document.querySelector('[data-testid="asset-import-fla"]');
        const resourceAction = document.querySelector('[data-testid="resource-asset-import-fla"]');
        const action = directAction instanceof HTMLButtonElement && !directAction.disabled
          ? directAction
          : resourceAction;
        if (!(action instanceof HTMLButtonElement) || action.disabled) {
          throw new Error('No enabled FLA import action is available');
        }
        action.click();
        await waitFor('[data-testid="fla-review-zero-raster"]');
        await waitForSnapshotTargets();
      };

      const switchModeAndBack = async () => {
        const sequenceTab = await waitFor('[data-testid="fla-render-mode-sequence"]', (element) => !element.disabled);
        sequenceTab.click();
        await waitFor('[data-testid="fla-frame-sequence-review"]');
        await waitFor('[data-testid="fla-frame-sequence-range"]');
        const sequenceOnly = document.querySelectorAll('[data-testid="fla-frame-sequence-review"]').length === 1 &&
          document.querySelectorAll('[data-testid="fla-snapshot-review"]').length === 0;
        click('[data-testid="fla-render-mode-snapshot"]');
        await waitForSnapshotTargets();
        return sequenceOnly;
      };

      const chooseTwoFrameTarget = async () => {
        const radios = [...document.querySelectorAll('input[data-testid^="fla-snapshot-target-"]')];
        for (const radio of radios) {
          if (radio.disabled) continue;
          radio.click();
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
          const frameInput = document.querySelector('[data-testid="fla-snapshot-frame-input"]');
          if (frameInput && Number(frameInput.max) >= 1) {
            return {
              id: radio.getAttribute('data-testid'),
              supportedTargetCount: radios.filter((candidate) => !candidate.disabled).length,
            };
          }
        }
        throw new Error('No supported Stage D target with at least two frames was exposed');
      };

      const reviewState = () => document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') ?? '';
      const importButtonCount = () => document.querySelectorAll('[data-testid="fla-snapshot-import"]').length;
      const previewImage = () => document.querySelector('[data-testid="fla-snapshot-preview-image"]');

      const previewCurrentFrame = async () => {
        await waitFor('[data-testid="fla-snapshot-preview"]', (element) => !element.disabled);
        click('[data-testid="fla-snapshot-preview"]');
        await waitFor('[data-testid="fla-snapshot-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'valid',
        );
        await waitFor(
          '[data-testid="fla-snapshot-preview-image"]',
          (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        );
        await waitFor('[data-testid="fla-snapshot-import"]', (element) => !element.disabled);
      };

      await createProjectThroughUi();
      const initial = readProjectState();
      await openStageDReview();

      const workbenchText = document.querySelector('[data-testid="fla-render-workbench"]')?.textContent ?? '';
      const stageFactsText = document.querySelector('[data-testid="fla-snapshot-source-facts"]')?.textContent ?? '';
      const targetCount = Number((document.querySelector('[data-testid="fla-snapshot-target-count"]')?.textContent ?? '').match(/\\d+/u)?.[0] ?? 0);
      const noRasterChrome = document.querySelectorAll(
        '[data-testid="fla-review-select-all"], [data-testid="fla-review-clear-all"], [data-testid="fla-review-selection-toolbar"]',
      ).length === 0;
      const zeroRasterRoute = document.querySelector('[data-workbench-route="render"]') !== null &&
        document.querySelector('[data-testid="fla-review-zero-raster-summary"]') !== null;
      const shellFacts = {
        mode: document.querySelector('[data-testid="fla-render-workbench"]')?.getAttribute('data-render-mode') ?? '',
        snapshotTabSelected: document.querySelector('[data-testid="fla-render-mode-snapshot"]')?.getAttribute('aria-selected') === 'true',
        targetCount,
        noRasterChrome,
        sourceMentionsNoBitmap: /位图|bitmap/iu.test(workbenchText),
        stageFactsVisible: /\\d+\\s*[×x]\\s*\\d+[\\s\\S]*\\d+\\s*fps/iu.test(stageFactsText),
        stageFactsText: stageFactsText.trim(),
      };

      const modeSwitchPassed = await switchModeAndBack();
      const targetChoice = await chooseTwoFrameTarget();
      const beforePreview = readProjectState();
      const previewAbsentBefore = importButtonCount() === 0 && reviewState() === 'needs-preview';
      await previewCurrentFrame();
      const afterFirstPreview = readProjectState();
      const validPreviewVisible = reviewState() === 'valid' && Boolean(previewImage());
      const noMutationBeforePreview =
        beforePreview.assetCount === initial.assetCount &&
        beforePreview.maxRevision === initial.maxRevision &&
        afterFirstPreview.assetCount === initial.assetCount &&
        afterFirstPreview.maxRevision === initial.maxRevision;

      click('[data-testid="fla-snapshot-frame-next"]');
      await waitFor('[data-testid="fla-snapshot-review"]', (element) =>
        element.getAttribute('data-preview-state') === 'needs-preview',
      );
      const frameInvalidation = {
        state: reviewState(),
        importAbsent: importButtonCount() === 0,
        projectUnchanged: readProjectState().assetCount === initial.assetCount &&
          readProjectState().maxRevision === initial.maxRevision,
      };
      await previewCurrentFrame();

      const radiosAfterFrame = [...document.querySelectorAll('input[data-testid^="fla-snapshot-target-"]')]
        .filter((radio) => !radio.disabled);
      const otherTarget = radiosAfterFrame.find(
        (radio) => radio.getAttribute('data-testid') !== targetChoice.id,
      );
      let targetInvalidation = {
        applicable: Boolean(otherTarget),
        state: 'not-applicable',
        importAbsent: true,
        projectUnchanged: true,
      };
      if (otherTarget) {
        otherTarget.click();
        await waitFor('[data-testid="fla-snapshot-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'needs-preview',
        );
        const unchanged = readProjectState();
        targetInvalidation = {
          applicable: true,
          state: reviewState(),
          importAbsent: importButtonCount() === 0,
          projectUnchanged: unchanged.assetCount === initial.assetCount &&
            unchanged.maxRevision === initial.maxRevision,
        };
        await previewCurrentFrame();
      }

      const beforeImport = readProjectState();
      const validLatestPreview = reviewState() === 'valid' && importButtonCount() === 1;
      const detailsVisible = document.querySelector('[data-testid="fla-snapshot-details-region"]') !== null &&
        document.querySelector('[data-testid="fla-snapshot-action-bar"]') !== null;
      click('[data-testid="fla-snapshot-import"]');
      await waitFor('[data-testid="fla-snapshot-committed"]');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      const afterImport = readProjectState();
      const committedAssetCount = beforeImport.assetCount !== null && afterImport.assetCount !== null
        ? afterImport.assetCount - beforeImport.assetCount
        : null;
      const revisionAdvanced = afterImport.maxRevision !== null &&
        (beforeImport.maxRevision === null || afterImport.maxRevision > beforeImport.maxRevision);
      const committedText = document.querySelector('[data-testid="fla-snapshot-committed"]')?.textContent?.trim() ?? '';
      click('[data-testid="fla-snapshot-close"]');
      await waitFor('[data-testid="asset-browser-view"]');
      const libraryAfterClose = readProjectState();

      const checks = {
        zeroRasterRoute,
        stageDSourcePreviewDetails: detailsVisible,
        shellSnapshotMode: shellFacts.mode === 'snapshot' && shellFacts.snapshotTabSelected,
        stageTargetFacts: shellFacts.targetCount >= 2 && shellFacts.stageFactsVisible,
        noRasterChrome: shellFacts.noRasterChrome,
        modeSwitchPassed,
        previewAbsentBefore,
        validPreviewVisible,
        noMutationBeforePreview,
        frameInvalidation: frameInvalidation.state === 'needs-preview' &&
          frameInvalidation.importAbsent && frameInvalidation.projectUnchanged,
        targetInvalidation: targetInvalidation.applicable && (
          targetInvalidation.state === 'needs-preview' &&
          targetInvalidation.importAbsent && targetInvalidation.projectUnchanged
        ),
        validLatestPreview,
        committedOneAsset: committedAssetCount === 1,
        revisionAdvanced,
        libraryUpdated: libraryAfterClose.assetCount === afterImport.assetCount,
      };

      return {
        ok: Object.values(checks).every(Boolean),
        projectName,
        projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
        route: 'v2r-target-discovery',
        targetCount: shellFacts.targetCount,
        supportedTargetCount: targetChoice.supportedTargetCount,
        stageFacts: shellFacts.stageFactsText,
        checks,
        initial,
        beforePreview,
        afterFirstPreview,
        beforeImport,
        afterImport,
        libraryAfterClose,
        frameInvalidation,
        targetInvalidation,
        committedAssetCount,
        revisionAdvanced,
        committedText,
        projectMutation: 'PREVIEW_NONE; COMMIT_ONE_STATIC_SNAPSHOT_IMAGE_ASSET',
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
  const outPath = resolve(args.out || join(acceptanceRoot, 'issue396-stage-d-receipt.json'));
  const userData = resolve(args.userData || join(acceptanceRoot, 'electron-user-data'));
  const sourcePath = resolve(args.source || join(acceptanceRoot, 'issue396-stage-d-zero-raster.fla'));
  const projectName = `Issue396 Stage D UI ${Date.now()}`;
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  mkdirSync(userData, { recursive: true });

  let sourceWasGenerated = false;
  let response = null;
  try {
    if (!args.source) {
      await writeSyntheticZeroRasterFla(sourcePath);
      sourceWasGenerated = true;
    }
    if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
    app.setPath('userData', userData);
    process.env.VITE_DEV_SERVER_URL = '';
    process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
    require('../dist-electron/main/index.js');
    const sourceSha256Before = sha256(sourcePath);
    const mainWindow = await waitForMainWindow();
    response = await runStageDPath(mainWindow, acceptanceRoot, projectName);
    const sourceSha256After = sha256(sourcePath);
    const projectFile = join(acceptanceRoot, `${projectName}.pandastage`, 'project.json');
    const persistedProject = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf8'))
      : null;
    const receipt = {
      schemaVersion: 'issue396-stage-d-electron-acceptance/1',
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier: sourceWasGenerated,
        sha256Before: sourceSha256Before,
        sha256After: sourceSha256After,
        hashInvariant: sourceSha256Before === sourceSha256After,
      },
      project: {
        projectRoot: response?.projectRoot ?? join(acceptanceRoot, `${projectName}.pandastage`),
        persistedAssetCount: Array.isArray(persistedProject?.assets)
          ? persistedProject.assets.length
          : null,
        privateVisualBytesRecorded: false,
      },
      parserPath: 'real Windows Electron Main + production Renderer UI -> V2-R catalog -> shared R1/R2 workbench -> static preview/explicit ImageAsset commit',
      response,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (!receipt.source.hashInvariant || !response?.ok || receipt.project.persistedAssetCount !== 1) {
      process.exitCode = 1;
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const receipt = {
      schemaVersion: 'issue396-stage-d-electron-acceptance/1',
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier: sourceWasGenerated,
        privateVisualBytesRecorded: false,
      },
      project: { projectRoot: null, persistedAssetCount: null, privateVisualBytesRecorded: false },
      response,
      error: error.message,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((caught) => {
    process.stderr.write(`${caught.stack || caught.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
