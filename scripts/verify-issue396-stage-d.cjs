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

const { app, BrowserWindow, screen } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue398-stage-d';
const SYNTHETIC_TARGET_COUNT = 25;
const SIMPLE_RECT_CUBICS = '!0 0|1660 0|1660 3365|0 3365|0 0';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--measure-scan-only') args.measureScanOnly = true;
    else if (argv[index] === '--issue762-profile') args.issue762Profile = true;
    else if (argv[index] === '--profile-commit') args.profileCommit = true;
    else if (argv[index] === '--scan-timeout-ms') args.scanTimeoutMs = Number(argv[++index]);
  }
  return args;
}

function summarizeDurations(values) {
  if (values.length === 0) {
    return { count: 0, totalMs: 0, minMs: null, medianMs: null, p90Ms: null, maxMs: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    count: sorted.length,
    totalMs: values.reduce((total, value) => total + value, 0),
    minMs: sorted[0],
    medianMs,
    p90Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)],
    maxMs: sorted[sorted.length - 1],
  };
}

function summarizeProfileEvents(events) {
  const byStage = new Map();
  const byCandidateStage = new Map();
  for (const event of events) {
    if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) continue;
    const stageDurations = byStage.get(event.stage) || [];
    stageDurations.push(event.durationMs);
    byStage.set(event.stage, stageDurations);
    const candidateIndex = event.details?.candidateIndex;
    if (!Number.isInteger(candidateIndex)) continue;
    const candidateKey = `${candidateIndex}:${event.stage}`;
    const candidateDurations = byCandidateStage.get(candidateKey) || [];
    candidateDurations.push(event.durationMs);
    byCandidateStage.set(candidateKey, candidateDurations);
  }
  return {
    stages: Object.fromEntries([...byStage.entries()].map(([stage, durations]) => [
      stage,
      summarizeDurations(durations),
    ])),
    perCandidateStages: Object.fromEntries([...byCandidateStage.entries()].map(([key, durations]) => [
      key,
      summarizeDurations(durations),
    ])),
  };
}

function getGitWorkingTreeDetails() {
  const gitStatus = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });
  const dirtyPaths = gitStatus.split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3));
  const trackedDiff = execFileSync('git', ['diff', '--binary', 'HEAD'], { encoding: null });
  const untrackedPaths = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  ).split('\0').filter(Boolean).sort();
  const fingerprint = createHash('sha256').update(trackedDiff);
  for (const relativePath of untrackedPaths) {
    fingerprint.update(Buffer.from(`\0${relativePath}\0`, 'utf8'));
    fingerprint.update(readFileSync(relativePath));
  }
  const refsContainingHead = execFileSync(
    'git',
    ['branch', '--all', '--contains', 'HEAD', '--format=%(refname:short)'],
    { encoding: 'utf8' },
  ).split(/\r?\n/u).filter((ref) => ref && !ref.startsWith('('));
  return {
    gitBranch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() || '(detached worktree)',
    gitRefsContainingHead: refsContainingHead,
    gitDirty: dirtyPaths.length > 0,
    gitDirtyPaths: dirtyPaths,
    gitWorkingTreeSha256: fingerprint.digest('hex'),
  };
}

function getRuntimeEnvironment() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const cpus = os.cpus();
  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ...getGitWorkingTreeDetails(),
    cpuModel: cpus[0]?.model ?? null,
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    displayScaleFactor: primaryDisplay.scaleFactor,
    displayWorkArea: primaryDisplay.workAreaSize,
  };
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

async function runStageDPath(mainWindow, acceptanceRoot, projectName, {
  measureScanOnly = false,
  issue762Profile = false,
  profileCommit = false,
  profileScanTimeoutMs = 300_000,
} = {}) {
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};
      const measureScanOnly = ${JSON.stringify(measureScanOnly)};
      const issue762Profile = ${JSON.stringify(issue762Profile)};
      const profileCommit = ${JSON.stringify(profileCommit)};
      const profileScanTimeoutMs = ${JSON.stringify(profileScanTimeoutMs)};
      const issue762ProfileEvents = [];
      const issue762RunState = {};
      if (issue762Profile) window.__pandaStageIssue762RunState = issue762RunState;
      const recordIssue762Profile = (stage, durationMs, details = {}) => {
        if (!issue762Profile) return;
        issue762ProfileEvents.push({
          stage,
          durationMs: Math.max(0, durationMs),
          details,
          realm: 'renderer-main',
          atMs: performance.now(),
        });
      };
      if (issue762Profile) {
        window.__pandaStageIssue762ProfileSink = (event) => {
          if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) return;
          issue762ProfileEvents.push({
            ...event,
            realm: 'renderer-main',
            atMs: performance.now(),
          });
        };
      }
      const uiTimerGaps = [];
      let uiTimerHandle = null;
      let uiTimerLastAt = null;
      const startUiResponsivenessTimer = () => {
        if (!issue762Profile) return;
        uiTimerLastAt = performance.now();
        uiTimerHandle = window.setInterval(() => {
          const now = performance.now();
          uiTimerGaps.push(now - uiTimerLastAt);
          uiTimerLastAt = now;
        }, 1_000);
      };
      const stopUiResponsivenessTimer = () => {
        if (uiTimerHandle !== null) window.clearInterval(uiTimerHandle);
        uiTimerHandle = null;
        const maxGapMs = uiTimerGaps.length > 0 ? Math.max(...uiTimerGaps) : null;
        recordIssue762Profile('ui.scan.event-loop-timer-gap-summary', 0, {
          sampleCount: uiTimerGaps.length,
          maxGapMs,
          gapsAbove1500ms: uiTimerGaps.filter((gap) => gap > 1_500).length,
        });
        return { sampleCount: uiTimerGaps.length, maxGapMs, gapsAbove1500ms: uiTimerGaps.filter((gap) => gap > 1_500).length };
      };
      const observedFlaPreviewUrls = new Set();
      const revokedObjectUrls = new Set();
      const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
      const previewUrlObserver = new MutationObserver(() => {
        document.querySelectorAll('[data-testid="fla-snapshot-review"] img[src^="blob:"]').forEach((image) => {
          observedFlaPreviewUrls.add(image.src);
        });
      });
      previewUrlObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['src'],
        childList: true,
        subtree: true,
      });
      URL.revokeObjectURL = (url) => {
        revokedObjectUrls.add(url);
        nativeRevokeObjectUrl(url);
      };

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

      const waitForSnapshotTargets = async (timeoutMs = 60_000) => {
        await waitFor('[data-testid="fla-render-workbench"]', () => true, timeoutMs);
        const startedAt = performance.now();
        const deadline = startedAt + timeoutMs;
        let lastProgressText = null;
        const progressSamples = [];
        while (performance.now() < deadline) {
          const review = document.querySelector('[data-testid="fla-snapshot-review"]');
          const reviewState = review?.getAttribute('data-preview-state') ?? '';
          const progressText = document.querySelector('[data-testid="fla-snapshot-action-state"]')?.textContent?.trim() ?? '';
          if (progressText && progressText !== lastProgressText) {
            const match = progressText.match(/[0-9]+/gu);
            const sample = {
              elapsedMs: performance.now() - startedAt,
              progress: match ? Number(match[0]) : null,
              candidateCount: match && match.length > 1 ? Number(match[1]) : null,
              text: progressText,
            };
            progressSamples.push(sample);
            recordIssue762Profile('ui.scan.progress', 0, sample);
            lastProgressText = progressText;
          }
          if (reviewState === 'error') {
            const message = document.querySelector('[data-testid="fla-snapshot-error"]')?.textContent?.trim() ?? 'unknown scan error';
            const targetList = document.querySelector('[data-testid="fla-snapshot-targets"]');
            const error = new Error('Snapshot review entered error state: ' + message);
            error.issue762ScanMeasurement = {
              failureKind: 'review-error',
              scanDurationMs: Math.round(performance.now() - startedAt),
              candidateCount: targetList?.querySelectorAll('input[type="checkbox"]').length ?? 0,
              progressSamples,
            };
            throw error;
          }
          const targetList = document.querySelector('[data-testid="fla-snapshot-targets"]');
          const candidateCount = targetList?.querySelectorAll('input[type="checkbox"]').length ?? 0;
          if (reviewState === 'ready' && candidateCount > 0) {
            const durationMs = performance.now() - startedAt;
            recordIssue762Profile('ui.scan.ready-state', durationMs, { candidateCount });
            return { candidateCount, durationMs, progressSamples };
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
        const targetList = document.querySelector('[data-testid="fla-snapshot-targets"]');
        const error = new Error('Timed out waiting for snapshot review ready state after ' + timeoutMs + ' ms');
        error.issue762ScanMeasurement = {
          failureKind: 'ready-timeout',
          scanDurationMs: Math.round(performance.now() - startedAt),
          candidateCount: targetList?.querySelectorAll('input[type="checkbox"]').length ?? 0,
          progressSamples,
        };
        throw error;
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

      const clickStageDAction = async (timeoutMs = 60_000) => {
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
          timeoutMs,
        );
        const directAction = document.querySelector('[data-testid="asset-import-fla"]');
        const resourceAction = document.querySelector('[data-testid="resource-asset-import-fla"]');
        const action = directAction instanceof HTMLButtonElement && !directAction.disabled
          ? directAction
          : resourceAction;
        if (!(action instanceof HTMLButtonElement) || action.disabled) {
          throw new Error('No enabled FLA import action is available');
        }
        const sourceOpenStartedAt = performance.now();
        action.click();
        await waitFor('[data-testid="fla-review-zero-raster"]', () => true, timeoutMs);
        recordIssue762Profile('ui.source.open-action-to-review', performance.now() - sourceOpenStartedAt, {
          sourceSelection: 'PANDA_STAGE_FLA_ACCEPTANCE_SOURCE',
        });
        return performance.now();
      };

      const openStageDReview = async (timeoutMs = 60_000) => {
        const actionStartedAt = performance.now();
        let scanStartedAt = null;
        try {
          scanStartedAt = await clickStageDAction(timeoutMs);
          const scanReadiness = await waitForSnapshotTargets(timeoutMs);
          const scanDurationMs = Math.round(performance.now() - scanStartedAt);
          const candidates = document.querySelectorAll('[data-testid="fla-snapshot-targets"] input[type="checkbox"]');
          recordIssue762Profile('ui.scan.total', scanDurationMs, {
            candidateCount: candidates.length,
            progressSampleCount: scanReadiness.progressSamples.length,
          });
          return {
            status: 'VERIFIED',
            scanDurationMs,
            candidateCount: candidates.length,
            progressSamples: scanReadiness.progressSamples,
            scannedAt: new Date().toISOString(),
          };
        } catch (caught) {
          const error = caught instanceof Error ? caught : new Error(String(caught));
          const partial = error.issue762ScanMeasurement ?? {};
          const candidates = document.querySelectorAll('[data-testid="fla-snapshot-targets"] input[type="checkbox"]');
          const candidateCount = Number.isInteger(partial.candidateCount) ? partial.candidateCount : candidates.length;
          const elapsedFromActionMs = Math.round(performance.now() - actionStartedAt);
          const issue762ScanMeasurement = {
            status: 'FAILED',
            failureKind: partial.failureKind ?? (error.message.includes('Timed out') ? 'open-or-ready-timeout' : 'scan-error'),
            failureMessage: error.message,
            elapsedFromActionMs,
            scanDurationMs: Number.isFinite(partial.scanDurationMs)
              ? partial.scanDurationMs
              : scanStartedAt === null ? null : Math.round(performance.now() - scanStartedAt),
            candidateCount,
            progressSamples: Array.isArray(partial.progressSamples) ? partial.progressSamples : [],
          };
          recordIssue762Profile('ui.scan.failure-total', elapsedFromActionMs, {
            failureKind: issue762ScanMeasurement.failureKind,
            candidateCount,
            phase: scanStartedAt === null ? 'open-review' : 'candidate-scan',
          });
          error.issue762ScanMeasurement = issue762ScanMeasurement;
          throw error;
        }
      };

      const cancelDuringScan = async () => {
        const before = readProjectState();
        await clickStageDAction();
        await waitFor('[data-testid="fla-snapshot-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'rendering',
        );
        const scanProgress = Number(
          document.querySelector('[data-testid="fla-snapshot-scan-progress"]')?.textContent?.match(/[0-9]+/u)?.[0] ?? 0,
        );
        const candidateCount = document.querySelectorAll('[data-testid="fla-snapshot-targets"] input[type="checkbox"]').length;
        click('[data-testid="fla-snapshot-close"]');
        await waitFor('[data-testid="asset-browser-view"]');
        const after = readProjectState();
        return {
          exitedBeforeScanCompleted: candidateCount > 0 && scanProgress < candidateCount,
          candidateCount,
          scanProgress,
          noProjectMutation: after.assetCount === before.assetCount && after.maxRevision === before.maxRevision,
          before,
          after,
        };
      };

      const readFullPreview = (image) => ({
        alt: image.alt,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        generatedWidth: Number(image.getAttribute('data-preview-width')),
        generatedHeight: Number(image.getAttribute('data-preview-height')),
        resolution: image.getAttribute('data-preview-resolution'),
      });

      const waitForFullPreview = async (expectedAlt, previousSrc = null) => await waitFor(
        '[data-testid="fla-snapshot-preview-image"]',
        (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0 &&
          (!expectedAlt || element.alt === expectedAlt) &&
          (!previousSrc || element.getAttribute('src') !== previousSrc) &&
          element.getAttribute('data-preview-resolution') === 'full',
      );

      const rapidFocusAndCheck = async () => {
        const buttons = [...document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row[data-preview-supported="true"] .fla-snapshot-candidate-focus',
        )].slice(0, 3);
        if (buttons.length < 3) return { ok: false, focusedCount: buttons.length, preview: null };
        const expectedAlt = buttons[2].querySelector('strong')?.textContent?.trim() ?? '';
        for (const button of buttons) {
          button.click();
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 8));
        }
        const image = await waitForFullPreview(expectedAlt);
        const focusedRow = document.querySelector(
          '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row[data-focused="true"]',
        );
        const focusedLabel = focusedRow?.querySelector('strong')?.textContent?.trim() ?? '';
        const metrics = readFullPreview(image);
        return {
          ok: image.alt === expectedAlt && focusedLabel === expectedAlt &&
            metrics.naturalWidth === metrics.generatedWidth && metrics.naturalHeight === metrics.generatedHeight,
          focusedCount: buttons.length,
          preview: metrics,
        };
      };

      const previewUrlState = () => ({
        observed: observedFlaPreviewUrls.size,
        revoked: [...observedFlaPreviewUrls].filter((url) => revokedObjectUrls.has(url)).length,
        remaining: [...observedFlaPreviewUrls].filter((url) => !revokedObjectUrls.has(url)).length,
      });

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
      if (issue762Profile) issue762RunState.projectStateBeforeScan = initial;
      if (measureScanOnly) {
        let scanMeasurement;
        let uiResponsiveness;
        startUiResponsivenessTimer();
        let scanFailure = null;
        try {
          scanMeasurement = await openStageDReview(
            issue762Profile ? profileScanTimeoutMs : 300_000,
          );
        } catch (caught) {
          scanFailure = caught instanceof Error ? caught : new Error(String(caught));
        } finally {
          uiResponsiveness = stopUiResponsivenessTimer();
        }
        if (scanFailure) {
          scanFailure.issue762ScanMeasurement = {
            ...(scanFailure.issue762ScanMeasurement ?? {}),
            projectStateBeforeScan: initial,
            uiResponsiveness,
          };
          if (issue762Profile) {
            issue762RunState.scanMeasurement = scanFailure.issue762ScanMeasurement;
            issue762RunState.uiResponsiveness = uiResponsiveness;
          }
          throw scanFailure;
        }
        if (issue762Profile) {
          issue762RunState.scanMeasurement = scanMeasurement;
          issue762RunState.uiResponsiveness = uiResponsiveness;
        }
        const supportedFocusButtons = [...document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row[data-preview-supported="true"] .fla-snapshot-candidate-focus',
        )];
        const unfocusedFocusButton = supportedFocusButtons.find((button) =>
          button.closest('.fla-snapshot-candidate-row')?.getAttribute('data-focused') !== 'true',
        );
        const previewButtons = issue762Profile
          ? [unfocusedFocusButton ?? supportedFocusButtons[0]].filter(Boolean)
          : supportedFocusButtons.slice(0, 16);
        const previewMeasurements = [];
        if (issue762Profile) issue762RunState.previewMeasurements = previewMeasurements;
        for (let candidateIndex = 0; candidateIndex < previewButtons.length; candidateIndex += 1) {
          const button = previewButtons[candidateIndex];
          if (!(button instanceof HTMLElement)) continue;
          const expectedAlt = button.querySelector('strong')?.textContent?.trim() ?? '';
          const previousPreviewSrc = previewImage()?.getAttribute('src') ?? null;
          const focusedPreviewStartedAt = performance.now();
          button.click();
          const image = await waitForFullPreview(
            expectedAlt,
            issue762Profile ? previousPreviewSrc : null,
          );
          const preview = readFullPreview(image);
          previewMeasurements.push(preview);
          recordIssue762Profile('ui.focused.full-resolution-preview', performance.now() - focusedPreviewStartedAt, {
            candidateRowTestId: button.closest('.fla-snapshot-candidate-row')?.getAttribute('data-testid') ?? null,
            previousPreviewSrcPresent: previousPreviewSrc !== null,
            previewSourceChanged: previousPreviewSrc === null || image.getAttribute('src') !== previousPreviewSrc,
            width: preview.naturalWidth,
            height: preview.naturalHeight,
            resolution: preview.resolution,
          });
        }
        const beforeCommit = readProjectState();
        const noProjectMutationDuringScan = beforeCommit.assetCount === initial.assetCount &&
          beforeCommit.maxRevision === initial.maxRevision;
        let commitMeasurement = null;
        if (profileCommit) {
          const firstSupportedRow = document.querySelector(
            '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row[data-preview-supported="true"]',
          );
          const firstSupportedCheckbox = firstSupportedRow?.querySelector('input[type="checkbox"]');
          if (!(firstSupportedCheckbox instanceof HTMLInputElement) || firstSupportedCheckbox.disabled) {
            throw new Error('No supported candidate is selectable for the profile commit sample');
          }
          const selectionStartedAt = performance.now();
          firstSupportedCheckbox.click();
          await waitFor('[data-testid="fla-snapshot-import"]', (element) =>
            element instanceof HTMLButtonElement && !element.disabled,
          );
          const beforeImport = readProjectState();
          const selectionNoMutation = beforeImport.assetCount === initial.assetCount &&
            beforeImport.maxRevision === initial.maxRevision;
          const importStartedAt = performance.now();
          click('[data-testid="fla-snapshot-import"]');
          const receiptCounts = await waitFor('[data-testid="fla-snapshot-import-counts"]', () => true, 120_000);
          const receiptReadyAt = performance.now();
          const libraryDeadline = receiptReadyAt + 60_000;
          let afterImport = readProjectState();
          while (
            afterImport.assetCount === null || beforeImport.assetCount === null ||
            afterImport.assetCount <= beforeImport.assetCount
          ) {
            if (performance.now() >= libraryDeadline) break;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            afterImport = readProjectState();
          }
          const librarySynced = afterImport.assetCount !== null && beforeImport.assetCount !== null &&
            afterImport.assetCount > beforeImport.assetCount;
          const revisionAdvanced = afterImport.maxRevision !== null &&
            (beforeImport.maxRevision === null || afterImport.maxRevision > beforeImport.maxRevision);
          commitMeasurement = {
            selectionDurationMs: performance.now() - selectionStartedAt,
            clickToReceiptMs: receiptReadyAt - importStartedAt,
            clickToAssetLibrarySyncMs: librarySynced ? performance.now() - importStartedAt : null,
            selectionNoMutation,
            librarySynced,
            revisionAdvanced,
            beforeImport,
            afterImport,
            receiptText: receiptCounts.textContent?.trim() ?? '',
          };
          if (issue762Profile) issue762RunState.commitMeasurement = commitMeasurement;
          recordIssue762Profile('ui.commit.click-to-receipt', commitMeasurement.clickToReceiptMs, {
            selectedCount: 1,
            librarySynced,
          });
          if (commitMeasurement.clickToAssetLibrarySyncMs !== null) {
            recordIssue762Profile('ui.commit.click-to-asset-library-sync', commitMeasurement.clickToAssetLibrarySyncMs, {
              selectedCount: 1,
              assetCount: afterImport.assetCount,
              revisionAdvanced,
            });
          }
        }
        const beforeClose = readProjectState();
        click('[data-testid="fla-snapshot-close"]');
        await waitFor('[data-testid="asset-browser-view"]');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        const afterClose = readProjectState();
        const noProjectMutation = profileCommit
          ? noProjectMutationDuringScan
          : afterClose.assetCount === initial.assetCount && afterClose.maxRevision === initial.maxRevision;
        const previewResourcesReleased = previewUrlState().remaining === 0;
        const highResolutionVerified = previewMeasurements.some((preview) =>
          preview.resolution === 'full' && preview.naturalWidth === preview.generatedWidth &&
          preview.naturalHeight === preview.generatedHeight &&
          Math.max(preview.naturalWidth, preview.naturalHeight) > 160,
        );
        return {
          ok: scanMeasurement.candidateCount > 0 && noProjectMutation && previewResourcesReleased &&
            highResolutionVerified && (!profileCommit || Boolean(
              commitMeasurement?.librarySynced && commitMeasurement.revisionAdvanced,
            )),
          projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
          scanMeasurement,
          previewMeasurements,
          uiResponsiveness,
          noProjectMutationDuringScan,
          commitMeasurement,
          ...(issue762Profile ? { issue762ProfileEvents } : {}),
          highResolutionVerified,
          noProjectMutation,
          previewResourcesReleased,
          previewUrlState: previewUrlState(),
          initial,
          beforeClose,
          afterClose,
        };
      }

      const scanExit = await cancelDuringScan();
      const scanMeasurement = await openStageDReview();

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
      const defaultDetailsText = [
        document.querySelector('[data-testid="fla-snapshot-details"]')?.textContent ?? '',
        document.querySelector('[data-testid="fla-snapshot-candidate-summary"]')?.textContent ?? '',
      ].join(' ');
      const defaultHashHidden = !defaultDetailsText.includes('预览去重') &&
        !/SHA[- ]?256/iu.test(defaultDetailsText) && !/[0-9a-f]{12}/iu.test(defaultDetailsText);
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

      const focusedPreviewRace = await rapidFocusAndCheck();
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
      await waitFor('[data-testid="fla-snapshot-import"]', (element) =>
        element instanceof HTMLButtonElement && !element.disabled,
      );
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
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const releasedPreviewResources = previewUrlState();

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
        scanCancellationExitsWithoutMutation: scanExit.exitedBeforeScanCompleted && scanExit.noProjectMutation,
        cancellationNoMutation,
        focusedPreviewRaceHasFullResolution: focusedPreviewRace.ok,
        focusedPreviewExceedsThumbnailResolution: Boolean(
          focusedPreviewRace.preview &&
          Math.max(focusedPreviewRace.preview.naturalWidth, focusedPreviewRace.preview.naturalHeight) > 160,
        ),
        defaultHashHidden,
        previewResourcesReleased: releasedPreviewResources.remaining === 0,
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
        scanMeasurement,
        scanExit,
        focusedPreviewRace,
        defaultHashHidden,
        releasedPreviewResources,
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
        ...(issue762Profile ? { issue762ProfileEvents } : {}),
        projectMutation: 'CANDIDATE_PREVIEWS_AND_SELECTION_NO_PROJECT_MUTATION; CANCEL_NO_MUTATION; ONE_CONFIRM; COMMIT_SELECTED_STATIC_SNAPSHOT_IMAGE_ASSETS',
      };
    })().catch((error) => ({
      verifierError: error instanceof Error ? error.message : String(error),
      verifierStack: error instanceof Error ? error.stack : String(error),
      issue762ProfileEvents,
      issue762ScanMeasurement: error?.issue762ScanMeasurement ?? null,
      issue762RunState: issue762Profile ? window.__pandaStageIssue762RunState ?? null : null,
    }))
  `).then((result) => {
    if (result?.verifierError) {
      const error = new Error(`${result.verifierError}\n${result.verifierStack ?? ''}`);
      error.issue762ProfileEvents = result.issue762ProfileEvents ?? [];
      error.issue762ScanMeasurement = result.issue762ScanMeasurement ?? null;
      error.issue762RunState = result.issue762RunState ?? null;
      throw error;
    }
    return result;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.profileCommit && (!args.measureScanOnly || !args.issue762Profile)) {
    throw new Error('--profile-commit requires --measure-scan-only and --issue762-profile');
  }
  const mainProfileEvents = [];
  if (args.issue762Profile) {
    process.env.PANDA_STAGE_ISSUE762_PROFILE = '1';
    globalThis.__pandaStageIssue762ProfileSink = (event) => {
      if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) return;
      mainProfileEvents.push({
        ...event,
        realm: 'electron-main',
        atMs: performance.now(),
      });
    };
  }
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
  const outPath = resolve(args.out || join(
    acceptanceRoot,
    args.measureScanOnly ? 'issue761-fla-scan-measurement.json' : 'issue398-stage-d-receipt.json',
  ));
  const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'layout-evidence'));
  const userData = resolve(args.userData || join(acceptanceRoot, 'electron-user-data'));
  const sourcePath = resolve(args.source || join(acceptanceRoot, 'issue398-stage-d-zero-raster.fla'));
  const projectName = `${args.measureScanOnly ? 'Issue761 FLA scan measurement' : 'Issue398 Stage D UI'} ${Date.now()}`;
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(userData, { recursive: true });

  let sourceWasGenerated = false;
  let sourceSha256Before = null;
  let sourceSha256After = null;
  let response = null;
  try {
    if (args.measureScanOnly && !args.source) {
      throw new Error('Real FLA scan measurement requires --source with an existing FLA file.');
    }
    if (!args.source) {
      await writeSyntheticZeroRasterFla(sourcePath);
      sourceWasGenerated = true;
    }
    if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
    app.setPath('userData', userData);
    process.env.VITE_DEV_SERVER_URL = '';
    process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
    require('../dist-electron/main/index.js');
    sourceSha256Before = sha256(sourcePath);
    const mainWindow = await waitForMainWindow();
    if (args.issue762Profile) mainWindow.showInactive();
    const pathState = { error: null };
    const pathPromise = runStageDPath(mainWindow, acceptanceRoot, projectName, {
      measureScanOnly: Boolean(args.measureScanOnly),
      issue762Profile: Boolean(args.issue762Profile),
      profileCommit: Boolean(args.profileCommit),
      profileScanTimeoutMs: Number.isFinite(args.scanTimeoutMs) && args.scanTimeoutMs > 0
        ? args.scanTimeoutMs
        : 900_000,
    }).catch((error) => {
      pathState.error = error;
      throw error;
    });
    let layoutEvidence = null;
    if (!args.measureScanOnly) {
      layoutEvidence = {
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
    }
    response = await pathPromise;
    if (layoutEvidence) response.layoutEvidence = layoutEvidence;
    sourceSha256After = sha256(sourcePath);
    const projectFile = join(acceptanceRoot, `${projectName}.pandastage`, 'project.json');
    const persistedProject = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf8'))
      : null;
    let projectReopenValidation = null;
    if (args.measureScanOnly && args.profileCommit) {
      try {
        const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
        const reopened = await new ProjectService().open(join(acceptanceRoot, `${projectName}.pandastage`));
        projectReopenValidation = {
          status: reopened.project.assets.length === 1 ? 'PASS' : 'FAIL',
          assetCount: reopened.project.assets.length,
          projectId: reopened.project.id,
          sourceVersion: reopened.sourceVersion,
          migrated: reopened.migrated,
        };
      } catch (caught) {
        projectReopenValidation = {
          status: 'FAIL',
          error: caught instanceof Error ? caught.message : String(caught),
        };
      }
    }
    const profileEvents = [
      ...mainProfileEvents,
      ...(Array.isArray(response?.issue762ProfileEvents) ? response.issue762ProfileEvents : []),
    ];
    const responseForReceipt = response ? { ...response } : response;
    if (responseForReceipt) delete responseForReceipt.issue762ProfileEvents;
    const receipt = {
      schemaVersion: args.issue762Profile
        ? 'issue762-fla-performance-profile/1'
        : args.measureScanOnly
          ? 'issue761-fla-scan-measurement/1'
          : 'issue398-stage-d-electron-acceptance/1',
      ...(args.issue762Profile ? {
        environment: getRuntimeEnvironment(),
        reproductionCommand: process.argv.join(' '),
        profile: {
          stageSummary: summarizeProfileEvents(profileEvents),
          events: profileEvents,
        },
      } : {}),
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
        reopenValidation: projectReopenValidation,
        privateVisualBytesRecorded: false,
      },
      scanMeasurement: args.measureScanOnly ? {
        status: response?.scanMeasurement?.candidateCount > 0 ? 'VERIFIED' : 'NOT VERIFIED',
        candidateCount: response?.scanMeasurement?.candidateCount ?? null,
        scanDurationMs: response?.scanMeasurement?.scanDurationMs ?? null,
        scannedAt: response?.scanMeasurement?.scannedAt ?? null,
        progressSamples: response?.scanMeasurement?.progressSamples ?? [],
        uiResponsiveness: response?.uiResponsiveness ?? null,
      } : null,
      parserPath: 'real Windows Electron Main + production Renderer UI -> V2-R catalog -> bounded v1.2 deletion-first R1/R2 workbench -> static preview/explicit ImageAsset commit',
      response: responseForReceipt,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(args.issue762Profile
      ? `${JSON.stringify({ outPath, source: receipt.source, scanMeasurement: receipt.scanMeasurement, project: receipt.project, profileSummary: receipt.profile.stageSummary })}\n`
      : `${JSON.stringify(receipt)}\n`);
    const expectedPersistedAssetCount = args.measureScanOnly && !args.profileCommit ? 0 : 1;
    if (
      !receipt.source.hashInvariant || !response?.ok ||
      receipt.project.persistedAssetCount !== expectedPersistedAssetCount ||
      args.measureScanOnly && receipt.scanMeasurement?.status !== 'VERIFIED' ||
      args.profileCommit && receipt.project.reopenValidation?.status !== 'PASS'
    ) {
      process.exitCode = 1;
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    if (sourceSha256After === null && existsSync(sourcePath)) {
      try {
        sourceSha256After = sha256(sourcePath);
      } catch {
        sourceSha256After = null;
      }
    }
    const failureProjectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
    let failurePersistedProject = null;
    try {
      const failureProjectFile = join(failureProjectRoot, 'project.json');
      if (existsSync(failureProjectFile)) {
        failurePersistedProject = JSON.parse(readFileSync(failureProjectFile, 'utf8'));
      }
    } catch {
      failurePersistedProject = null;
    }
    const profileEvents = [
      ...mainProfileEvents,
      ...(Array.isArray(error.issue762ProfileEvents) ? error.issue762ProfileEvents : []),
    ];
    const receipt = {
      schemaVersion: args.issue762Profile
        ? 'issue762-fla-performance-profile/1'
        : args.measureScanOnly
          ? 'issue761-fla-scan-measurement/1'
          : 'issue398-stage-d-electron-acceptance/1',
      ...(args.issue762Profile ? {
        environment: getRuntimeEnvironment(),
        reproductionCommand: process.argv.join(' '),
        profile: {
          stageSummary: summarizeProfileEvents(profileEvents),
          events: profileEvents,
        },
      } : {}),
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier: sourceWasGenerated,
        sha256Before: sourceSha256Before,
        sha256After: sourceSha256After,
        hashInvariant: sourceSha256Before !== null && sourceSha256After !== null
          ? sourceSha256Before === sourceSha256After
          : null,
        privateVisualBytesRecorded: false,
      },
      project: {
        projectRoot: failureProjectRoot,
        persistedAssetCount: Array.isArray(failurePersistedProject?.assets)
          ? failurePersistedProject.assets.length
          : null,
        projectStateBeforeScan: error.issue762ScanMeasurement?.projectStateBeforeScan ??
          error.issue762RunState?.projectStateBeforeScan ?? null,
        privateVisualBytesRecorded: false,
      },
      scanMeasurement: args.measureScanOnly ? {
        status: error.issue762ScanMeasurement?.status ?? error.issue762RunState?.scanMeasurement?.status ?? 'FAILED',
        candidateCount: error.issue762ScanMeasurement?.candidateCount ?? error.issue762RunState?.scanMeasurement?.candidateCount ?? null,
        scanDurationMs: error.issue762ScanMeasurement?.scanDurationMs ?? error.issue762RunState?.scanMeasurement?.scanDurationMs ?? null,
        elapsedFromActionMs: error.issue762ScanMeasurement?.elapsedFromActionMs ?? null,
        scannedAt: error.issue762RunState?.scanMeasurement?.scannedAt ?? null,
        progressSamples: error.issue762ScanMeasurement?.progressSamples ?? error.issue762RunState?.scanMeasurement?.progressSamples ?? [],
        uiResponsiveness: error.issue762ScanMeasurement?.uiResponsiveness ?? error.issue762RunState?.uiResponsiveness ?? null,
        failureKind: error.issue762ScanMeasurement?.failureKind ??
          (error.issue762RunState?.scanMeasurement ? null : 'pre-scan-error'),
        failureMessage: error.issue762ScanMeasurement?.failureMessage ??
          (error.issue762ScanMeasurement ? error.message : null),
      } : null,
      partialRun: error.issue762RunState ?? null,
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
