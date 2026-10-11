#!/usr/bin/env node
/**
 * Issue #398 real Windows/Electron Stage D deletion-first acceptance.
 *
 * The verifier creates an external zero-raster FLA/XFL sample with a long
 * render-target list and drives the production renderer through the shared
 * R1/R2 workbench. The receipt records bounded UI/project metadata only;
 * source and rendered visual bytes remain outside the repository. Layout
 * screenshots are written to the caller-provided acceptance directory.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue398-stage-d';
const SYNTHETIC_TARGET_COUNT = 25;
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
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
  const frames = [0].map((frameIndex) => `
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
                    <edges><Edge fillStyle1="1" cubics="${SIMPLE_RECT_CUBICS}"/></edges>
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
  const targetNames = Array.from({ length: SYNTHETIC_TARGET_COUNT }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return index === SYNTHETIC_TARGET_COUNT - 1
      ? `issue398-target-${ordinal}-long-readable-name`
      : `issue398-target-${ordinal}`;
  });
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
 <DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
   <timelines>
     <DOMTimeline name="scene1">
       <layers>
         <DOMLayer name="scene-layer">
           <frames>
             <DOMFrame index="0">
               <elements/>
             </DOMFrame>
           </frames>
         </DOMLayer>
       </layers>
     </DOMTimeline>
   </timelines>
 </DOMDocument>`);
  targetNames.forEach((targetName, index) => {
    zip.file(
      `LIBRARY/${targetName}.xml`,
      buildSymbolXml(targetName, index % 2 === 0 ? '#3d9b62' : '#4d82c4', index * 3),
    );
  });
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

async function captureScreenshotAtMarker(mainWindow, marker, outputPath, pathState) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const currentMarker = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue398CaptureMarker || ""',
    );
    if (currentMarker === marker) {
      const image = await mainWindow.capturePage();
      writeFileSync(outputPath, image.toPNG());
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue398CaptureDone = ${JSON.stringify(marker)}; true;`,
      );
      const size = image.getSize();
      return { path: outputPath, width: size.width, height: size.height };
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Stage D screenshot marker ${marker}`);
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

      const waitForCapture = async (marker) => {
        document.documentElement.dataset.issue398CaptureMarker = marker;
        while (document.documentElement.dataset.issue398CaptureDone !== marker) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
        delete document.documentElement.dataset.issue398CaptureMarker;
        delete document.documentElement.dataset.issue398CaptureDone;
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
        await waitFor('[data-testid="fla-snapshot-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'ready',
        );
        await waitFor('[data-testid="fla-snapshot-targets"]', (element) =>
          element.querySelectorAll('input[type="checkbox"]').length > 0,
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

      const selectTwoCandidates = async () => {
        const candidates = [...document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] li[data-duplicate="true"] input[type="checkbox"]:not(:disabled)',
        )];
        if (candidates.length < 2) {
          throw new Error('Expected at least two source identities in an exact-duplicate group, got ' + candidates.length);
        }
        candidates[0].click();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
        candidates[1].click();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
        const selectedCount = document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] input[type="checkbox"]:checked',
        ).length;
        return {
          selectedCount,
          supportedCandidateCount: candidates.length,
        };
      };

      const reviewState = () => document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') ?? '';
      const importButton = () => document.querySelector('[data-testid="fla-snapshot-import"]');
      const importEnabled = () => {
        const button = importButton();
        return button instanceof HTMLButtonElement && !button.disabled;
      };
      const previewImage = () => document.querySelector('[data-testid="fla-snapshot-preview-image"]');

      await createProjectThroughUi();
      const initial = readProjectState();
      await openStageDReview();

      const rectData = (element) => {
        if (!(element instanceof Element)) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const isViewportVisible = (rect) => Boolean(
        rect && rect.top >= -1 && rect.bottom <= window.innerHeight + 1 &&
        rect.left >= -1 && rect.right <= window.innerWidth + 1,
      );
      const isInside = (child, parent) => Boolean(
        child && parent && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1,
      );
      const readLayout = () => {
        const targetList = document.querySelector('[data-testid="fla-snapshot-targets"]');
        const targetRows = targetList
          ? [...targetList.querySelectorAll('input[type="checkbox"]')]
            .map((input) => input.closest('.fla-snapshot-candidate-row'))
            .filter(Boolean)
          : [];
        const firstTarget = targetRows[0] ?? null;
        const lastTarget = targetRows[targetRows.length - 1] ?? null;
        const reviewBody = document.querySelector('[data-testid="fla-review-body"]');
        const listStyle = targetList ? getComputedStyle(targetList) : null;
        const bodyStyle = reviewBody ? getComputedStyle(reviewBody) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          session: rectData(document.querySelector('[data-testid="fla-review-session"]')),
          workbench: rectData(document.querySelector('[data-testid="fla-render-workbench"]')),
          header: rectData(document.querySelector('[data-testid="fla-render-workbench-header"]')),
          preview: rectData(document.querySelector('[data-testid="fla-snapshot-preview-area"]')),
          actionBar: rectData(document.querySelector('[data-testid="fla-snapshot-action-bar"]')),
          targetList: {
            rect: rectData(targetList),
            scrollHeight: targetList?.scrollHeight ?? 0,
            clientHeight: targetList?.clientHeight ?? 0,
            scrollTop: targetList?.scrollTop ?? 0,
            overflowY: listStyle?.overflowY ?? '',
            firstTarget: rectData(firstTarget),
            lastTarget: rectData(lastTarget),
            rowCount: targetRows.length,
          },
          reviewBody: {
            rect: rectData(reviewBody),
            scrollHeight: reviewBody?.scrollHeight ?? 0,
            clientHeight: reviewBody?.clientHeight ?? 0,
            overflowY: bodyStyle?.overflowY ?? '',
          },
          documentScrollHeight: document.documentElement.scrollHeight,
          documentClientHeight: document.documentElement.clientHeight,
          primaryActionCount: document.querySelectorAll(
            '.fla-snapshot-action-bar .fla-render-primary-action',
          ).length,
        };
      };

      const workbenchText = document.querySelector('[data-testid="fla-render-workbench"]')?.textContent ?? '';
      const stageFactsText = document.querySelector('[data-testid="fla-snapshot-source-facts"]')?.textContent ?? '';
      const targetCount = Number((document.querySelector('[data-testid="fla-snapshot-target-count"]')?.textContent ?? '').match(/\\d+/u)?.[0] ?? 0);
      const candidateSourceRowCount = document.querySelectorAll(
        '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row',
      ).length;
      const duplicateGroupSourceCount = [...document.querySelectorAll(
        '[data-testid="fla-snapshot-targets"] .fla-snapshot-duplicate-label',
      )].reduce((total, label) => total + Number(label.textContent?.match(/[0-9]+/u)?.[0] ?? 0), 0);
      const duplicateGroupPreservesSourceIdentity = duplicateGroupSourceCount > 0 &&
        duplicateGroupSourceCount === candidateSourceRowCount && candidateSourceRowCount === targetCount;
      const reviewBodyText = document.querySelector('[data-testid="fla-review-body"]')?.textContent ?? '';
      const sourceBasename = document.querySelector('[data-testid="fla-render-workbench-source"] strong')?.textContent?.trim() ?? '';
      const countOccurrences = (value, needle) => needle ? value.split(needle).length - 1 : 0;
      const noRasterChrome = document.querySelectorAll(
        '[data-testid="fla-review-select-all"], [data-testid="fla-review-clear-all"], [data-testid="fla-review-selection-toolbar"]',
      ).length === 0;
      const zeroRasterRoute = document.querySelector('[data-workbench-route="render"]') !== null &&
        document.querySelector('[data-testid="fla-render-workbench"]') !== null &&
        document.querySelector('[data-testid="fla-review-zero-raster-summary"]') === null;
      const deletionChecks = {
        renderHeaderRemoved: document.querySelector('[data-workbench-route="render"] [data-testid="fla-review-header"]') === null,
        genericRecoveryNoticeRemoved: document.querySelector('[data-testid="fla-review-recovery-notice"]') === null,
        zeroRasterSummaryRemoved: document.querySelector('[data-testid="fla-review-zero-raster-summary"]') === null,
        sourceFilenameSingle: sourceBasename.length > 0 && countOccurrences(reviewBodyText, sourceBasename) === 1,
        readOnlySafetySingle: countOccurrences(reviewBodyText, '只读') === 1 && !reviewBodyText.includes('源 FLA 保持不变'),
        targetCountSingle: document.querySelectorAll('[data-testid="fla-snapshot-target-count"]').length === 1 &&
          document.querySelectorAll('[data-testid="fla-snapshot-visible-target-count"]').length === 0,
        candidateSummaryVisible: document.querySelectorAll('[data-testid="fla-snapshot-candidate-summary"] dd').length === 4 &&
          document.querySelector('[data-testid="fla-snapshot-details"]') !== null,
        moreDetailsCollapsed: document.querySelector('[data-testid="fla-snapshot-compatibility-details"]')?.hasAttribute('open') === false,
        defaultExplanatoryBlocksRemoved: document.querySelectorAll(
          '[data-testid="fla-review-zero-raster-summary"], [data-testid="fla-snapshot-zero-raster"], [data-testid="fla-snapshot-readonly-note"], [data-testid="fla-snapshot-fidelity"]',
        ).length === 0,
        footerGuidanceMerged: document.querySelector('[data-testid="fla-snapshot-action-guidance"]') === null,
      };
      const shellFacts = {
        mode: document.querySelector('[data-testid="fla-render-workbench"]')?.getAttribute('data-render-mode') ?? '',
        snapshotTabSelected: document.querySelector('[data-testid="fla-render-mode-snapshot"]')?.getAttribute('aria-selected') === 'true',
        targetCount,
        noRasterChrome,
        sourceHasReadOnlyIdentity: /只读/u.test(workbenchText),
        stageFactsVisible: /\\d+\\s*[×x]\\s*\\d+[\\s\\S]*\\d+\\s*fps/iu.test(stageFactsText),
        stageFactsText: stageFactsText.trim(),
      };

      const topLayout = readLayout();
      const targetLabels = [...document.querySelectorAll('[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-copy strong')]
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean);
      await waitForCapture('top');

      const targetList = document.querySelector('[data-testid="fla-snapshot-targets"]');
      if (!(targetList instanceof HTMLElement)) throw new Error('Stage D target list is not scrollable');
      targetList.scrollTop = targetList.scrollHeight;
      targetList.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const bottomLayout = readLayout();
      await waitForCapture('bottom');

      const targetSearch = document.querySelector('[data-testid="fla-snapshot-target-search"]');
      const searchQuery = targetLabels[targetLabels.length - 1] ?? '';
      let searchMatches = false;
      if (targetSearch instanceof HTMLInputElement && searchQuery) {
        setControlledInput('[data-testid="fla-snapshot-target-search"]', searchQuery);
        await waitFor('[data-testid="fla-snapshot-targets"]', (element) =>
          element.querySelectorAll('input[type="checkbox"]').length === 1,
        );
        searchMatches = document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] input[type="checkbox"]',
        ).length === 1;
        setControlledInput('[data-testid="fla-snapshot-target-search"]', '');
        await waitFor('[data-testid="fla-snapshot-targets"]', (element) =>
          element.querySelectorAll('input[type="checkbox"]').length === targetCount,
        );
      }

      const topListRect = topLayout.targetList.rect;
      const bottomListRect = bottomLayout.targetList.rect;
      const layoutChecks = {
        targetCountAtLeast25: targetCount >= 25,
        workbenchBounded: Boolean(
          topLayout.session && topLayout.workbench &&
          topLayout.workbench.height <= topLayout.session.height + 1 &&
          topLayout.workbench.bottom <= topLayout.session.bottom + 1,
        ),
        pageNotStretched: topLayout.reviewBody.overflowY === 'hidden' &&
          topLayout.reviewBody.scrollHeight <= topLayout.reviewBody.clientHeight + 1 &&
          topLayout.documentScrollHeight <= topLayout.documentClientHeight + 1,
        targetListOwnsScroll: topLayout.targetList.overflowY === 'auto' &&
          topLayout.targetList.scrollHeight > topLayout.targetList.clientHeight + 1,
        headerPreviewActionVisibleAtTop: isViewportVisible(topLayout.header) &&
          isViewportVisible(topLayout.preview) && isViewportVisible(topLayout.actionBar),
        headerPreviewActionVisibleAtBottom: isViewportVisible(bottomLayout.header) &&
          isViewportVisible(bottomLayout.preview) && isViewportVisible(bottomLayout.actionBar),
        firstTargetReachable: isInside(topLayout.targetList.firstTarget, topListRect),
        lastTargetReachable: isInside(bottomLayout.targetList.lastTarget, bottomListRect),
        previewStableWhileListScrolls: Boolean(
          topLayout.preview && bottomLayout.preview &&
          Math.abs(topLayout.preview.top - bottomLayout.preview.top) <= 1 &&
          Math.abs(topLayout.preview.bottom - bottomLayout.preview.bottom) <= 1,
        ),
        footerStableWhileListScrolls: Boolean(
          topLayout.actionBar && bottomLayout.actionBar &&
          Math.abs(topLayout.actionBar.top - bottomLayout.actionBar.top) <= 1 &&
          Math.abs(topLayout.actionBar.bottom - bottomLayout.actionBar.bottom) <= 1,
        ),
        onePrimaryActionAtTop: topLayout.primaryActionCount === 1,
        onePrimaryActionAtBottom: bottomLayout.primaryActionCount === 1,
        targetSearchWorks: searchMatches,
      };

      const modeSwitchPassed = await switchModeAndBack();
      const beforeCancel = readProjectState();
      click('[data-testid="fla-snapshot-close"]');
      await waitFor('[data-testid="asset-browser-view"]');
      const afterCancel = readProjectState();
      const cancellationNoMutation = afterCancel.assetCount === beforeCancel.assetCount &&
        afterCancel.maxRevision === beforeCancel.maxRevision &&
        afterCancel.assetCount === initial.assetCount && afterCancel.maxRevision === initial.maxRevision;

      await openStageDReview();
      const beforeSelection = readProjectState();
      const importUnavailableBeforeSelection = reviewState() === 'ready' && !importEnabled();
      await waitFor(
        '[data-testid="fla-snapshot-preview-image"]',
        (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
      );
      const previewReady = Boolean(previewImage());
      const selectedCandidates = await selectTwoCandidates();
      const afterSelection = readProjectState();
      const selectionNoMutation = afterSelection.assetCount === initial.assetCount &&
        afterSelection.maxRevision === initial.maxRevision;
      const importEnabledAfterSelection = importEnabled();
      const detailsVisible = document.querySelector('[data-testid="fla-snapshot-details-region"]') !== null &&
        document.querySelector('[data-testid="fla-snapshot-action-bar"]') !== null;

      const beforeImport = readProjectState();
      click('[data-testid="fla-snapshot-import"]');
      const receiptCounts = await waitFor('[data-testid="fla-snapshot-import-counts"]');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      const afterImport = readProjectState();
      const committedAssetCount = beforeImport.assetCount !== null && afterImport.assetCount !== null
        ? afterImport.assetCount - beforeImport.assetCount
        : null;
      const revisionAdvanced = afterImport.maxRevision !== null &&
        (beforeImport.maxRevision === null || afterImport.maxRevision > beforeImport.maxRevision);
      const committedText = receiptCounts.textContent?.trim() ?? '';
      const receiptCount = (pattern) => Number(committedText.match(pattern)?.[1] ?? -1);
      const processedCount = receiptCount(/共处理\\s*(\\d+)/u);
      const importedCount = receiptCount(/新导入\\s*(\\d+)/u);
      const duplicateCount = receiptCount(/复用已有素材\\s*(\\d+)/u);
      const failedCount = receiptCount(/失败\\s*(\\d+)/u);
      const notAttemptedCount = receiptCount(/未尝试\\s*(\\d+)/u);
      click('[data-testid="fla-snapshot-close"]');
      await waitFor('[data-testid="asset-browser-view"]');
      const libraryAfterClose = readProjectState();

      const checks = {
        zeroRasterRoute,
        stageDSourcePreviewDetails: detailsVisible,
        stageDv11Layout: Object.values(layoutChecks).every(Boolean),
        stageDv12Deletion: Object.values(deletionChecks).every(Boolean),
        shellSnapshotMode: shellFacts.mode === 'snapshot' && shellFacts.snapshotTabSelected,
        stageTargetFacts: shellFacts.targetCount >= 2 && shellFacts.stageFactsVisible,
        duplicateGroupPreservesSourceIdentity,
        noRasterChrome: shellFacts.noRasterChrome,
        modeSwitchPassed,
        cancellationNoMutation,
        importUnavailableBeforeSelection,
        previewReady,
        multiSelectionWorks: selectedCandidates.selectedCount === 2,
        selectionNoMutation,
        importEnabledAfterSelection,
        accurateBatchReceipt: processedCount === selectedCandidates.selectedCount &&
          importedCount + duplicateCount === selectedCandidates.selectedCount &&
          failedCount === 0 && notAttemptedCount === 0,
        exactDuplicateReused: duplicateCount > 0,
        committedSelectedAssets: committedAssetCount === importedCount,
        revisionAdvanced,
        libraryUpdated: libraryAfterClose.assetCount === afterImport.assetCount,
      };

      return {
        ok: Object.values(checks).every(Boolean),
        projectName,
        projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
        route: 'v2r-target-discovery',
        targetCount: shellFacts.targetCount,
        supportedTargetCount: selectedCandidates.supportedCandidateCount,
        selectedCandidateCount: selectedCandidates.selectedCount,
        candidateSourceRowCount,
        duplicateGroupSourceCount,
        stageFacts: shellFacts.stageFactsText,
        checks,
        deletionChecks,
        initial,
        beforeCancel,
        afterCancel,
        beforeSelection,
        afterSelection,
        beforeImport,
        afterImport,
        libraryAfterClose,
        layout: {
          checks: layoutChecks,
          top: topLayout,
          bottom: bottomLayout,
          targetCount,
          searchQuery,
        },
        committedAssetCount,
        revisionAdvanced,
        committedText,
        projectMutation: 'CANDIDATE_PREVIEWS_AND_SELECTION_NO_PROJECT_MUTATION; CANCEL_NO_MUTATION; ONE_CONFIRM; COMMIT_SELECTED_STATIC_SNAPSHOT_IMAGE_ASSETS',
      };
    })()
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
   const outPath = resolve(args.out || join(acceptanceRoot, 'issue398-stage-d-receipt.json'));
  const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'layout-evidence'));
  const userData = resolve(args.userData || join(acceptanceRoot, 'electron-user-data'));
   const sourcePath = resolve(args.source || join(acceptanceRoot, 'issue398-stage-d-zero-raster.fla'));
   const projectName = `Issue398 Stage D UI ${Date.now()}`;
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
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
    const pathState = { error: null };
    const pathPromise = runStageDPath(mainWindow, acceptanceRoot, projectName).catch((error) => {
      pathState.error = error;
      throw error;
    });
    const layoutEvidence = {
      top: await captureScreenshotAtMarker(
        mainWindow,
        'top',
        join(evidenceDir, 'stage-d-top-target.png'),
        pathState,
      ),
      bottom: await captureScreenshotAtMarker(
        mainWindow,
        'bottom',
        join(evidenceDir, 'stage-d-bottom-target.png'),
        pathState,
      ),
    };
    response = await pathPromise;
    response.layoutEvidence = layoutEvidence;
    const sourceSha256After = sha256(sourcePath);
    const projectFile = join(acceptanceRoot, `${projectName}.pandastage`, 'project.json');
    const persistedProject = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf8'))
      : null;
    const receipt = {
      schemaVersion: 'issue398-stage-d-electron-acceptance/1',
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
      parserPath: 'real Windows Electron Main + production Renderer UI -> V2-R catalog -> bounded v1.2 deletion-first R1/R2 workbench -> static preview/explicit ImageAsset commit',
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
      schemaVersion: 'issue398-stage-d-electron-acceptance/1',
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
