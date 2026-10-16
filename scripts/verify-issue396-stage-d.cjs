#!/usr/bin/env node
/**
 * Issue #398 real Windows/Electron Stage D deletion-first acceptance.
 *
 * The verifier creates an external zero-raster FLA/XFL sample with a long
 * render-target list and drives the production renderer through the C03
 * unified workbench. The receipt records bounded UI/project metadata only;
 * source and rendered visual bytes remain outside the repository. Layout
 * screenshots are written to the caller-provided acceptance directory.
 */

'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue398-stage-d';
const SYNTHETIC_TARGET_COUNT = 25;
const MAX_SEQUENCE_NARROW_TOUCH_SCROLLS = 6;
const SIMPLE_RECT_CUBICS = '!0 0|1660 0|1660 3365|0 3365|0 0';
const ISSUE766_CATALOG_CHANNEL = 'fla:snapshot-catalog';
const issue766Runtime = {
  enabled: false,
  mainSamples: [],
  timer: null,
  lastTickAtMs: null,
};

function startIssue766MainHeartbeat() {
  if (!issue766Runtime.enabled || issue766Runtime.timer !== null) return;
  issue766Runtime.lastTickAtMs = performance.now();
  issue766Runtime.timer = setInterval(() => {
    const atMs = performance.now();
    const gapMs = issue766Runtime.lastTickAtMs === null ? null : atMs - issue766Runtime.lastTickAtMs;
    issue766Runtime.lastTickAtMs = atMs;
    const cpu = process.cpuUsage();
    issue766Runtime.mainSamples.push({
      atMs,
      wallTimeMs: Date.now(),
      gapMs,
      userCpuMicros: cpu.user,
      systemCpuMicros: cpu.system,
      rssBytes: process.memoryUsage().rss,
    });
  }, 100);
}

function stopIssue766MainHeartbeat() {
  if (issue766Runtime.timer !== null) clearInterval(issue766Runtime.timer);
  issue766Runtime.timer = null;
  issue766Runtime.lastTickAtMs = null;
}

function summarizeIssue766MainHeartbeat(rendererMarks) {
  const start = rendererMarks.find((mark) => mark.name === 'workbench-open-action-click');
  const firstPreview = rendererMarks.find((mark) => mark.name === 'first-focused-preview-visible') ??
    rendererMarks.find((mark) => mark.name === 'first-candidate-thumbnail-visible');
  if (!start || !firstPreview) {
    return {
      status: 'INCOMPLETE',
      reason: !start ? 'workbench-open-action-click was not observed' : 'first preview was not observed',
      sampleCount: 0,
      maxGapMs: null,
      gapsAbove1500ms: null,
      peakRssBytes: null,
      mainCpuMs: null,
    };
  }

  const windowSamples = issue766Runtime.mainSamples.filter((sample) =>
    sample.wallTimeMs >= start.wallTimeMs && sample.wallTimeMs <= firstPreview.wallTimeMs,
  );
  const priorSample = [...issue766Runtime.mainSamples]
    .reverse()
    .find((sample) => sample.wallTimeMs < start.wallTimeMs);
  const afterSample = issue766Runtime.mainSamples.find((sample) =>
    sample.wallTimeMs >= firstPreview.wallTimeMs,
  );
  const gaps = windowSamples.map((sample) => sample.gapMs).filter(Number.isFinite);
  const cpuBefore = priorSample ?? windowSamples[0];
  const cpuAfter = afterSample ?? windowSamples.at(-1);
  const mainCpuMs = cpuBefore && cpuAfter
    ? ((cpuAfter.userCpuMicros + cpuAfter.systemCpuMicros) -
      (cpuBefore.userCpuMicros + cpuBefore.systemCpuMicros)) / 1_000
    : null;
  return {
    status: windowSamples.length > 0 ? 'MEASURED' : 'INCOMPLETE',
    startedAtWallTimeMs: start.wallTimeMs,
    endedAtWallTimeMs: firstPreview.wallTimeMs,
    sampleCount: windowSamples.length,
    maxGapMs: gaps.length > 0 ? Math.max(...gaps) : null,
    gapsAbove1500ms: gaps.filter((gap) => gap > 1_500).length,
    peakRssBytes: windowSamples.length > 0
      ? Math.max(...windowSamples.map((sample) => sample.rssBytes))
      : null,
    mainCpuMs,
  };
}

function summarizeIssue766RendererHeartbeat(firstLoad) {
  const marks = firstLoad?.marks ?? [];
  const start = marks.find((mark) => mark.name === 'workbench-open-action-click');
  const firstPreview = marks.find((mark) => mark.name === 'first-focused-preview-visible') ??
    marks.find((mark) => mark.name === 'first-candidate-thumbnail-visible');
  if (!start || !firstPreview) {
    return {
      status: 'INCOMPLETE',
      reason: !start ? 'workbench-open-action-click was not observed' : 'first preview was not observed',
      sampleCount: 0,
      maxGapMs: null,
      gapsAbove1500ms: null,
    };
  }
  const samples = (firstLoad.rendererHeartbeat ?? []).filter((sample) =>
    sample.wallTimeMs >= start.wallTimeMs && sample.wallTimeMs <= firstPreview.wallTimeMs,
  );
  const gaps = samples.map((sample) => sample.gapMs).filter(Number.isFinite);
  return {
    status: samples.length > 0 ? 'MEASURED' : 'INCOMPLETE',
    startedAtWallTimeMs: start.wallTimeMs,
    endedAtWallTimeMs: firstPreview.wallTimeMs,
    sampleCount: samples.length,
    maxGapMs: gaps.length > 0 ? Math.max(...gaps) : null,
    gapsAbove1500ms: gaps.filter((gap) => gap > 1_500).length,
  };
}

function installIssue766CatalogIpcProbe(events) {
  if (!issue766Runtime.enabled) return;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (channel !== ISSUE766_CATALOG_CHANNEL) return originalHandle(channel, handler);
    return originalHandle(channel, async (event, request, ...rest) => {
      const startedAtMs = performance.now();
      const startedAtWallTimeMs = Date.now();
      const invocation = events.filter((entry) =>
        entry.stage === 'issue766.catalog-ipc' && entry.phase === 'complete',
      ).length + 1;
      const common = {
        stage: 'issue766.catalog-ipc',
        invocation,
        sessionId: typeof request?.sessionId === 'string' ? request.sessionId : null,
        includeAuthoredStates: request?.includeAuthoredStates === true,
      };
      events.push({
        ...common,
        phase: 'start',
        startedAtWallTimeMs,
        realm: 'electron-main',
      });
      try {
        const response = await handler(event, request, ...rest);
        events.push({
          ...common,
          phase: 'complete',
          startedAtWallTimeMs,
          completedAtWallTimeMs: Date.now(),
          durationMs: performance.now() - startedAtMs,
          outcome: response?.ok === true ? 'success' : response?.code ?? response?.error?.code ?? 'unknown',
          candidateCount: response?.ok === true ? response.entries?.length ?? 0 : 0,
          realm: 'electron-main',
        });
        return response;
      } catch (error) {
        events.push({
          ...common,
          phase: 'error',
          startedAtWallTimeMs,
          completedAtWallTimeMs: Date.now(),
          durationMs: performance.now() - startedAtMs,
          error: error instanceof Error ? error.message : String(error),
          realm: 'electron-main',
        });
        throw error;
      }
    });
  };
}

function summarizeIssue766FirstLoad(firstLoad) {
  const marks = firstLoad?.marks ?? [];
  const markTime = (name) => marks.find((mark) => mark.name === name)?.wallTimeMs ?? null;
  const openAt = markTime('workbench-open-action-click');
  const firstCatalogStart = firstLoad?.catalogIpcEvents?.find((event) => event.phase === 'start') ?? null;
  const firstCatalogComplete = firstCatalogStart
    ? firstLoad.catalogIpcEvents.find((event) =>
      event.phase === 'complete' && event.invocation === firstCatalogStart.invocation,
    ) ?? null
    : null;
  const delta = (end, start) => Number.isFinite(end) && Number.isFinite(start) ? end - start : null;
  const sessionGroups = new Map();
  for (const event of firstLoad?.catalogIpcEvents ?? []) {
    if (event.phase !== 'complete' && event.phase !== 'error') continue;
    const sessionId = event.sessionId ?? '(missing session id)';
    const existing = sessionGroups.get(sessionId) ?? [];
    existing.push({
      invocation: event.invocation,
      phase: event.phase,
      durationMs: event.durationMs,
      candidateCount: event.candidateCount ?? null,
      outcome: event.outcome ?? null,
      includeAuthoredStates: event.includeAuthoredStates,
    });
    sessionGroups.set(sessionId, existing);
  }
  return {
    workbenchOpenAtWallTimeMs: openAt,
    firstCatalogRequest: firstCatalogStart ? {
      invocation: firstCatalogStart.invocation,
      sessionId: firstCatalogStart.sessionId,
      startedAtWallTimeMs: firstCatalogStart.startedAtWallTimeMs,
      completedAtWallTimeMs: firstCatalogComplete?.completedAtWallTimeMs ?? null,
      durationMs: firstCatalogComplete?.durationMs ?? null,
      candidateCount: firstCatalogComplete?.candidateCount ?? null,
      outcome: firstCatalogComplete?.outcome ?? (firstCatalogComplete ? 'unknown' : 'incomplete'),
    } : null,
    phaseTimingsMs: {
      openToLoadingDom: delta(markTime('first-loading-dom'), openAt),
      openToLoadingTwoAnimationFrames: delta(markTime('first-loading-two-animation-frames'), openAt),
      openToFirstCatalogRequest: delta(firstCatalogStart?.startedAtWallTimeMs, openAt),
      openToFirstCatalogCompletion: delta(firstCatalogComplete?.completedAtWallTimeMs, openAt),
      catalogCompletionToFirstScanProgress: delta(
        markTime('first-scan-progress-visible'),
        firstCatalogComplete?.completedAtWallTimeMs,
      ),
      openToFirstCandidateList: delta(markTime('first-candidate-list-visible'), openAt),
      openToFirstCandidateThumbnail: delta(markTime('first-candidate-thumbnail-visible'), openAt),
      openToFirstFocusedPreview: delta(markTime('first-focused-preview-visible'), openAt),
    },
    catalogInvocationCount: firstLoad?.catalogRequestCount ?? 0,
    catalogSessions: [...sessionGroups.entries()].map(([sessionId, invocations]) => ({
      sessionId,
      invocationCount: invocations.length,
      invocations,
    })),
    rendererHeartbeat: summarizeIssue766RendererHeartbeat(firstLoad),
    mainHeartbeat: firstLoad?.mainHeartbeat ?? { status: 'NOT MEASURED' },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--sequence-target') args.sequenceTarget = argv[++index];
    else if (argv[index] === '--capture-sequence-preview-before-render') args.captureSequencePreviewBeforeRender = true;
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--measure-scan-only') args.measureScanOnly = true;
    else if (argv[index] === '--issue762-profile') args.issue762Profile = true;
    else if (argv[index] === '--issue766-first-load') args.issue766FirstLoad = true;
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
    native150Percent: Math.abs(primaryDisplay.scaleFactor - 1.5) < 0.01 ? 'PASS' : 'NOT RUN',
    displayWorkArea: primaryDisplay.workAreaSize,
  };
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function buildSymbolXml(symbolName, color, offset, frameCount = 1) {
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => `
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
      buildSymbolXml(
        targetName,
        index % 2 === 0 ? '#3d9b62' : '#4d82c4',
        index * 3,
        index === SYNTHETIC_TARGET_COUNT - 1 ? 3 : 1,
      ),
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

async function resizeWindowToExactViewport(mainWindow, targetViewport) {
  let viewport = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    viewport = await mainWindow.webContents.executeJavaScript(
      '({ width: window.innerWidth, height: window.innerHeight })',
    );
    if (viewport.width === targetViewport.width && viewport.height === targetViewport.height) return viewport;

    const bounds = mainWindow.getBounds();
    const width = bounds.width + targetViewport.width - viewport.width;
    const height = bounds.height + targetViewport.height - viewport.height;
    if (width === bounds.width && height === bounds.height) break;
    mainWindow.setSize(width, height);
    mainWindow.center();
    await delay(100);
  }
  throw new Error(
    `Stage D could not reach the exact logical viewport ${JSON.stringify(targetViewport)}; observed ${JSON.stringify(viewport)}`,
  );
}

async function captureScreenshotAtMarker(mainWindow, marker, outputPath, pathState, {
  resizeTo = null,
  restoreBoundsAfterCapture = null,
} = {}) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const currentMarker = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue398CaptureMarker || ""',
    );
    if (currentMarker === marker) {
      if (resizeTo) {
        mainWindow.setSize(resizeTo.width, resizeTo.height);
        mainWindow.center();
        await delay(250);
        if (resizeTo.targetViewport) {
          await resizeWindowToExactViewport(mainWindow, resizeTo.targetViewport);
        }
        const viewport = await mainWindow.webContents.executeJavaScript(
          '({ width: window.innerWidth, height: window.innerHeight })',
        );
        if (viewport.width > resizeTo.maxViewportWidth) {
          throw new Error(`Stage D native resize did not reach a narrow viewport: ${JSON.stringify(viewport)}`);
        }
      }
      const image = await mainWindow.capturePage();
      writeFileSync(outputPath, image.toPNG());
      const viewport = await mainWindow.webContents.executeJavaScript(
        '({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })',
      );
      const windowBounds = mainWindow.getBounds();
      if (restoreBoundsAfterCapture) {
        mainWindow.setBounds(restoreBoundsAfterCapture);
        await delay(250);
      }
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue398CaptureDone = ${JSON.stringify(marker)}; true;`,
      );
      const size = image.getSize();
      return { path: outputPath, width: size.width, height: size.height, viewport, windowBounds };
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Stage D screenshot marker ${marker}`);
}

async function driveKeyboardAtMarker(mainWindow, marker, keyCode, pathState) {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const currentMarker = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue398KeyboardMarker || ""',
    );
    if (currentMarker === marker) {
      mainWindow.focus();
      const focusDeadline = Date.now() + 3_000;
      while (!mainWindow.isFocused() && Date.now() < focusDeadline) await delay(25);
      if (!mainWindow.isFocused()) {
        throw new Error(`Stage D Electron window did not receive focus for native key ${keyCode}`);
      }
      mainWindow.webContents.focus();
      const rendererFocusDeadline = Date.now() + 3_000;
      let documentFocused = false;
      while (!documentFocused && Date.now() < rendererFocusDeadline) {
        documentFocused = await mainWindow.webContents.executeJavaScript('document.hasFocus()');
        if (!documentFocused) await delay(25);
      }
      if (!documentFocused) {
        throw new Error(`Stage D renderer did not receive focus for native key ${keyCode}`);
      }
      mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await delay(50);
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue398KeyboardDone = ${JSON.stringify(marker)}; true;`,
      );
      return { marker, keyCode, dispatched: true };
    }
    await delay(50);
  }
  const diagnostics = await mainWindow.webContents.executeJavaScript(`({
    keyboardMarker: document.documentElement.dataset.issue398KeyboardMarker || '',
    captureMarker: document.documentElement.dataset.issue398CaptureMarker || '',
    focusedLabel: document.querySelector('[data-testid="fla-c03-focused-label"]')?.textContent?.trim() ?? '',
    focusedKind: document.querySelector('[data-testid="fla-c03-preview"]')?.getAttribute('data-candidate-kind') ?? '',
    sequenceStates: [...document.querySelectorAll('[data-testid="fla-frame-sequence-review"]')]
      .map((panel) => panel.getAttribute('data-preview-state')),
    readyState: document.readyState,
  })`).catch((error) => ({ inspectionError: error instanceof Error ? error.message : String(error) }));
  throw new Error(`Timed out waiting for Stage D native keyboard marker ${marker}: ${JSON.stringify(diagnostics)}`);
}

async function driveTouchScrollAtMarker(mainWindow, marker, pathState) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const request = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue398TouchMarker || ""',
    );
    if (request) {
      const touch = JSON.parse(request);
      if (touch.marker !== marker) {
        await delay(50);
        continue;
      }
      await dispatchNativeTouchScroll(mainWindow, touch);
      await delay(100);
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue398TouchDone = ${JSON.stringify(marker)}; true;`,
      );
      return { marker, dispatched: true, input: 'CDP Input.dispatchTouchEvent' };
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for Stage D touch marker ${marker}`);
}

async function driveBoundedNativeTouchScrollsAtMarker(mainWindow, markerPrefix, pathState) {
  const gestures = [];
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const request = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue398TouchMarker || ""',
    );
    if (request) {
      const touch = JSON.parse(request);
      if (touch.marker === `${markerPrefix}-complete`) {
        await mainWindow.webContents.executeJavaScript(
          `document.documentElement.dataset.issue398TouchDone = ${JSON.stringify(touch.marker)}; true;`,
        );
        return {
          markerPrefix,
          maxGestures: MAX_SEQUENCE_NARROW_TOUCH_SCROLLS,
          gestureCount: gestures.length,
          gestures,
          completed: true,
        };
      }
      const expectedMarker = `${markerPrefix}-${gestures.length + 1}`;
      if (touch.marker !== expectedMarker) {
        await delay(50);
        continue;
      }
      if (gestures.length >= MAX_SEQUENCE_NARROW_TOUCH_SCROLLS) {
        throw new Error(`Stage D exceeded the bounded native touch-scroll limit for ${markerPrefix}`);
      }
      const dispatched = await dispatchNativeTouchScroll(mainWindow, touch);
      await delay(100);
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue398TouchDone = ${JSON.stringify(touch.marker)}; true;`,
      );
      gestures.push({ marker: touch.marker, ...dispatched });
      continue;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for bounded Stage D touch-scroll sequence ${markerPrefix}`);
}

async function dispatchNativeTouchScroll(mainWindow, touch) {
  const debuggerApi = mainWindow.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  if (attachedHere) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: touch.x, y: touch.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(40);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: touch.x, y: touch.y - touch.deltaY, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(80);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  return { input: 'CDP Input.dispatchTouchEvent', x: touch.x, y: touch.y, deltaY: touch.deltaY };
}

async function runStageDPath(mainWindow, acceptanceRoot, projectName, {
  measureScanOnly = false,
  issue762Profile = false,
  issue766FirstLoad = false,
  profileCommit = false,
  displayScaleFactor = 1,
  sequenceTargetSubstring = '',
  captureSequencePreviewBeforeRender = false,
  profileScanTimeoutMs = 300_000,
} = {}) {
  return mainWindow.webContents.executeJavaScript(`
    const issue762Profile = ${JSON.stringify(issue762Profile)};
    const issue766FirstLoad = ${JSON.stringify(issue766FirstLoad)};
    const issue762ProfileEvents = [];
    const issue762RunState = {};
    const issue766Probe = { marks: [], rendererHeartbeat: [], catalogRoundTrips: [] };
    let issue766HeartbeatHandle = null;
    let issue766MutationObserver = null;
    const stopIssue766Probe = () => {
      if (issue766HeartbeatHandle !== null) window.clearInterval(issue766HeartbeatHandle);
      if (issue766MutationObserver) issue766MutationObserver.disconnect();
      issue766HeartbeatHandle = null;
      issue766MutationObserver = null;
      if (issue762Profile) issue762RunState.issue766FirstLoad = issue766Probe;
    };
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};
      const measureScanOnly = ${JSON.stringify(measureScanOnly)};
      const profileCommit = ${JSON.stringify(profileCommit)};
      const expectedDisplayScaleFactor = ${JSON.stringify(displayScaleFactor)};
      const sequenceTargetSubstring = ${JSON.stringify(sequenceTargetSubstring)};
      const captureSequencePreviewBeforeRender = ${JSON.stringify(captureSequencePreviewBeforeRender)};
      const profileScanTimeoutMs = ${JSON.stringify(profileScanTimeoutMs)};
      let issue766HeartbeatLastAt = null;
      const issue766SeenMarks = new Set();
      const issue766ObservedImages = new WeakSet();
      const recordIssue766Mark = (name, details = {}) => {
        if (!issue766FirstLoad || issue766SeenMarks.has(name)) return;
        issue766SeenMarks.add(name);
        issue766Probe.marks.push({ name, atMs: performance.now(), wallTimeMs: Date.now(), details });
      };
      if (issue766FirstLoad) issue762RunState.issue766FirstLoad = issue766Probe;
      if (issue762Profile) window.__pandaStageIssue762RunState = issue762RunState;
      const recordIssue762Profile = (stage, durationMs, details = {}) => {
        if (!issue762Profile) return;
        issue762ProfileEvents.push({
          stage,
          durationMs: Math.max(0, durationMs),
          details,
          realm: 'renderer-main',
          atMs: performance.now(),
          wallTimeMs: Date.now(),
        });
      };
      if (issue762Profile) {
        window.__pandaStageIssue762ProfileSink = (event) => {
          if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) return;
          issue762ProfileEvents.push({
            ...event,
            realm: 'renderer-main',
            atMs: performance.now(),
            wallTimeMs: Date.now(),
          });
          if (issue766FirstLoad && event.stage === 'ui.catalog.main-roundtrip') {
            const completedAtWallTimeMs = Date.now();
            issue766Probe.catalogRoundTrips.push({
              invocation: issue766Probe.catalogRoundTrips.length + 1,
              startedAtWallTimeMs: completedAtWallTimeMs - event.durationMs,
              completedAtWallTimeMs,
              durationMs: event.durationMs,
              outcome: event.details?.outcome ?? null,
              candidateCount: event.details?.candidateCount ?? null,
            });
          }
        };
      }
      const uiTimerGaps = [];
      let uiTimerHandle = null;
      let uiTimerLastAt = null;
      const startUiResponsivenessTimer = () => {
        if (!issue762Profile) return;
        uiTimerLastAt = performance.now();
        if (issue766FirstLoad) {
          issue766HeartbeatLastAt = uiTimerLastAt;
          issue766HeartbeatHandle = window.setInterval(() => {
            const now = performance.now();
            issue766Probe.rendererHeartbeat.push({
              atMs: now,
              wallTimeMs: Date.now(),
              gapMs: now - issue766HeartbeatLastAt,
            });
            issue766HeartbeatLastAt = now;
          }, 100);
          const inspectFirstLoadDom = () => {
            const loading = document.querySelector('[data-testid="fla-snapshot-loading"]');
            if (loading) {
              recordIssue766Mark('first-loading-dom', { text: loading.textContent?.trim() ?? '' });
          if (!issue766SeenMarks.has('first-loading-two-animation-frames') &&
            !issue766SeenMarks.has('first-loading-two-frames-scheduled')) {
            issue766SeenMarks.add('first-loading-two-frames-scheduled');
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                  recordIssue766Mark('first-loading-two-animation-frames', {
                    text: loading.isConnected ? loading.textContent?.trim() ?? '' : null,
                  });
                }));
              }
            }
            const review = document.querySelector('[data-testid="fla-snapshot-review"]');
            const actionState = document.querySelector('[data-testid="fla-snapshot-action-state"]');
            const progressText = actionState?.textContent?.trim() ?? '';
            const scanMatch = progressText.match(/检查候选\\s+([0-9]+)\\s*\\/\\s*([0-9]+)/u);
            if (scanMatch) {
              recordIssue766Mark('first-scan-progress-visible', {
                progress: Number(scanMatch[1]),
                candidateCount: Number(scanMatch[2]),
                text: progressText,
              });
            }
            if (review?.getAttribute('data-preview-state') === 'scanning') {
              recordIssue766Mark('first-scanning-state', {
                candidateCount: document.querySelectorAll('[data-testid="fla-snapshot-targets"] input[type="checkbox"]').length,
              });
            }
            const candidates = document.querySelectorAll('[data-testid="fla-snapshot-targets"] input[type="checkbox"]');
            if (candidates.length > 0) {
              recordIssue766Mark('first-candidate-list-visible', { candidateCount: candidates.length });
            }
            const candidateImages = document.querySelectorAll('[data-testid="fla-snapshot-targets"] img');
            candidateImages.forEach((image) => {
              if (issue766ObservedImages.has(image)) return;
              issue766ObservedImages.add(image);
              const markLoaded = () => {
                if (image.naturalWidth > 0) {
                  recordIssue766Mark('first-candidate-thumbnail-visible', {
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                  });
                }
              };
              image.addEventListener('load', markLoaded, { once: true });
              if (image.complete) markLoaded();
            });
            const focusedPreview = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
            if (focusedPreview instanceof HTMLImageElement) {
              const markFocusedPreview = () => {
                if (focusedPreview.naturalWidth > 0) {
                  recordIssue766Mark('first-focused-preview-visible', {
                    naturalWidth: focusedPreview.naturalWidth,
                    naturalHeight: focusedPreview.naturalHeight,
                  });
                }
              };
              if (!issue766ObservedImages.has(focusedPreview)) {
                issue766ObservedImages.add(focusedPreview);
                focusedPreview.addEventListener('load', markFocusedPreview, { once: true });
              }
              if (focusedPreview.complete) markFocusedPreview();
            }
          };
          issue766MutationObserver = new MutationObserver(inspectFirstLoadDom);
          issue766MutationObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-preview-state', 'src'],
            childList: true,
            characterData: true,
            subtree: true,
          });
          inspectFirstLoadDom();
        }
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

      const waitForNativeKeyboard = async (marker) => {
        document.documentElement.dataset.issue398KeyboardMarker = marker;
        while (document.documentElement.dataset.issue398KeyboardDone !== marker) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
        delete document.documentElement.dataset.issue398KeyboardMarker;
        delete document.documentElement.dataset.issue398KeyboardDone;
      };

      const waitForNativeTouch = async (marker, point) => {
        document.documentElement.dataset.issue398TouchMarker = JSON.stringify({ marker, ...point });
        while (document.documentElement.dataset.issue398TouchDone !== marker) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
        delete document.documentElement.dataset.issue398TouchMarker;
        delete document.documentElement.dataset.issue398TouchDone;
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
        await waitFor('[data-testid="fla-c03-workbench"]', () => true, timeoutMs);
        const startedAt = performance.now();
        const deadline = startedAt + timeoutMs;
        let lastProgressText = null;
        const progressSamples = [];
        while (performance.now() < deadline) {
          const review = document.querySelector('[data-testid="fla-snapshot-review"]');
          const reviewState = review?.getAttribute('data-preview-state') ?? '';
          const progressText = document.querySelector('[data-testid="fla-c03-catalog-progress"]')?.textContent?.trim() ?? '';
          const candidates = [...document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
          )];
          const candidateCount = candidates.length;
          const selectableCount = candidates.filter((candidate) => candidate.getAttribute('data-selectable') === 'true').length;
          if (progressText && progressText !== lastProgressText) {
            const match = progressText.match(/[0-9]+/gu);
            const sample = {
              elapsedMs: performance.now() - startedAt,
              progress: match ? Number(match[0]) : null,
              candidateCount,
              text: progressText,
            };
            progressSamples.push(sample);
            recordIssue762Profile('ui.scan.progress', 0, sample);
            lastProgressText = progressText;
          }
          if (reviewState === 'error') {
            const message = document.querySelector('[data-testid="fla-snapshot-error"]')?.textContent?.trim() ?? 'unknown scan error';
            const error = new Error('Snapshot review entered error state: ' + message);
            error.issue762ScanMeasurement = {
              failureKind: 'review-error',
              scanDurationMs: Math.round(performance.now() - startedAt),
              candidateCount,
              progressSamples,
            };
            throw error;
          }
          if (reviewState === 'ready' && candidateCount >= 25 && selectableCount >= 25) {
            const durationMs = performance.now() - startedAt;
            recordIssue762Profile('ui.scan.ready-state', durationMs, { candidateCount, selectableCount });
            return { candidateCount, durationMs, progressSamples };
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
        const error = new Error('Timed out waiting for snapshot review ready state after ' + timeoutMs + ' ms');
        error.issue762ScanMeasurement = {
          failureKind: 'ready-timeout',
          scanDurationMs: Math.round(performance.now() - startedAt),
          candidateCount: document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
          ).length,
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
        recordIssue766Mark('workbench-open-action-click');
        action.click();
        await waitFor('[data-testid="fla-c03-workbench"]', () => true, timeoutMs);
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
          const candidates = document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
          );
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
          const candidates = document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
          );
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
        await waitFor('[data-testid="fla-snapshot-review"]', (element) => {
          const progressText = element.querySelector('[data-testid="fla-snapshot-scan-progress"]')?.textContent ?? '';
          const progressValues = progressText.match(/[0-9]+/gu) ?? [];
          return element.getAttribute('data-preview-state') === 'rendering' &&
            progressValues.length >= 2 && Number(progressValues[1]) > 0 && Number(progressValues[0]) < Number(progressValues[1]);
        });
        const review = document.querySelector('[data-testid="fla-snapshot-review"]');
        const scanReviewState = review?.getAttribute('data-preview-state') ?? '';
        const scanProgressText = review?.querySelector('[data-testid="fla-snapshot-scan-progress"]')?.textContent?.trim() ?? '';
        const scanProgressValues = scanProgressText.match(/[0-9]+/gu) ?? [];
        if (scanProgressValues.length < 2) throw new Error('Stage D scan progress did not expose completed/total counts before cancellation.');
        const scanProgress = Number(scanProgressValues[0]);
        const scanTotal = Number(scanProgressValues[1]);
        const scanInProgress = scanReviewState === 'rendering' && scanTotal > 0 && scanProgress < scanTotal;
        const candidateCount = document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
        ).length;
        click('[data-testid="fla-review-cancel"]');
        const assetBrowser = await waitFor('[data-testid="asset-browser-view"]');
        const exitedToAssetBrowser = Boolean(assetBrowser);
        const after = readProjectState();
        return {
          exitedBeforeScanCompleted: scanInProgress && exitedToAssetBrowser,
          scanReviewState,
          scanInProgress,
          scanProgress,
          scanTotal,
          scanProgressText,
          candidateCount,
          exitedToAssetBrowser,
          noProjectMutation: after.assetCount === before.assetCount && after.maxRevision === before.maxRevision,
          before,
          after,
        };
      };

      const readFullPreview = (image) => ({
        alt: image.alt,
        renderTargetId: image.getAttribute('data-render-target-id'),
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
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"][data-selectable="true"] .fla-c03-candidate-focus',
        )].slice(0, 3);
        if (buttons.length < 3) return { ok: false, focusedCount: buttons.length, preview: null };
        const expectedIdentity = buttons[2].closest('li')?.getAttribute('data-candidate-identity') ?? '';
        const sourceRow = [...document.querySelectorAll('[data-fla-candidate-id]')]
          .find((row) => row.getAttribute('data-fla-candidate-id') === expectedIdentity);
        const expectedRenderTargetId = sourceRow?.getAttribute('data-render-target-id') ?? '';
        const expectedAlt = candidateDisplayLabel(buttons[2]);
        for (const button of buttons) {
          button.click();
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 8));
        }
        const image = await waitForFullPreview(expectedAlt);
        const focusedRow = document.querySelector(
          '[data-testid="fla-c03-candidate-grid"] li.is-focused[data-candidate-kind="snapshot"]',
        );
        const focusedLabel = document.querySelector('[data-testid="fla-c03-focused-label"]')?.textContent?.trim() ?? '';
        const metrics = readFullPreview(image);
        return {
          ok: Boolean(focusedRow) && focusedRow.getAttribute('data-candidate-identity') === expectedIdentity &&
            image.alt === expectedAlt && image.getAttribute('data-render-target-id') === expectedRenderTargetId &&
            focusedLabel === expectedAlt &&
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

      const candidateDisplayLabel = (button) => {
        const strong = button.querySelector('strong');
        return strong?.getAttribute('title')?.trim() ||
          strong?.textContent?.trim() ||
          button.getAttribute('aria-label') ||
          '';
      };

      const exerciseSequenceCandidate = async () => {
        const sequenceSelector = '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"] .fla-c03-candidate-focus';
        await waitFor('[data-testid="fla-c03-candidate-grid"]', (grid) =>
          [...grid.querySelectorAll(sequenceSelector)].some((button) =>
            !sequenceTargetSubstring || candidateDisplayLabel(button).includes(sequenceTargetSubstring),
          ),
        );
        const sequenceButton = [...document.querySelectorAll(sequenceSelector)].find((button) =>
          !sequenceTargetSubstring || candidateDisplayLabel(button).includes(sequenceTargetSubstring),
        );
        if (!(sequenceButton instanceof HTMLButtonElement)) {
          throw new Error('No visible sequence candidate matched ' + (sequenceTargetSubstring || '(first candidate)'));
        }
        const sequenceRow = sequenceButton.closest('li[data-candidate-kind="sequence"]');
        const sequenceIdentity = sequenceRow?.getAttribute('data-candidate-identity') ?? '';
        if (!sequenceRow || !sequenceIdentity) throw new Error('Stage D sequence candidate has no stable identity');
        sequenceButton.click();
        const sequenceRange = await waitFor(
          '[data-testid="fla-frame-sequence-range"]',
          (element) => element.getClientRects().length > 0,
        );
        const startInput = sequenceRange.querySelector('[data-testid="fla-frame-sequence-start"]');
        if (!(startInput instanceof HTMLInputElement)) throw new Error('Stage D sequence start input is missing');
        setControlledInput('[data-testid="fla-frame-sequence-start"]', '1');
        startInput.focus();
        const keyboardEvents = [];
        const recordSequenceInteraction = (event) => keyboardEvents.push({
          type: event.type,
          key: event.key,
          code: event.code,
          isTrusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
          detail: event instanceof MouseEvent ? event.detail : null,
          targetTestId: event.target instanceof HTMLElement ? event.target.getAttribute('data-testid') : null,
        });
        document.addEventListener('keydown', recordSequenceInteraction);
        document.addEventListener('keyup', recordSequenceInteraction);
        document.addEventListener('click', recordSequenceInteraction);
        await waitForNativeKeyboard('sequence-generate-tab');
        const generateButton = sequenceRange.querySelector('[data-testid="fla-frame-sequence-render"]');
        const keyboardFocusedGenerate = generateButton instanceof HTMLButtonElement &&
          document.activeElement === generateButton && generateButton.getClientRects().length > 0 &&
          keyboardEvents.some((event) => event.type === 'keydown' && event.key === 'Tab' && event.isTrusted);
        if (!keyboardFocusedGenerate) {
          const active = document.activeElement instanceof HTMLElement
            ? { testId: document.activeElement.getAttribute('data-testid'), tagName: document.activeElement.tagName, ariaLabel: document.activeElement.getAttribute('aria-label') }
            : null;
          throw new Error('Native Tab did not focus the visible sequence Generate action: ' + JSON.stringify({ active, buttonVisible: generateButton instanceof HTMLElement && generateButton.getClientRects().length > 0 }));
        }
        await waitForNativeKeyboard('sequence-generate-space');
        let sequencePanel = null;
        try {
          sequencePanel = await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
            ['rendering', 'valid'].includes(element.getAttribute('data-preview-state') ?? ''),
            5_000,
          );
        } catch {
          const active = document.activeElement instanceof HTMLElement
            ? { testId: document.activeElement.getAttribute('data-testid'), tagName: document.activeElement.tagName, ariaLabel: document.activeElement.getAttribute('aria-label') }
            : null;
          const panels = [...document.querySelectorAll('[data-testid="fla-frame-sequence-review"]')]
            .map((panel) => panel.getAttribute('data-preview-state'));
          document.removeEventListener('keydown', recordSequenceInteraction);
          document.removeEventListener('keyup', recordSequenceInteraction);
          document.removeEventListener('click', recordSequenceInteraction);
          throw new Error('Native Space did not start sequence generation: ' + JSON.stringify({
            keyboardEvents,
            active,
            sequenceStates: panels,
            startValue: startInput.value,
            actionDisabled: generateButton instanceof HTMLButtonElement ? generateButton.disabled : null,
          }));
        }
        const keyboardActivatedGenerate = keyboardEvents.some((event) =>
          event.type === 'click' && event.isTrusted && event.detail === 0 &&
          event.targetTestId === 'fla-frame-sequence-render',
        );
        document.removeEventListener('keydown', recordSequenceInteraction);
        document.removeEventListener('keyup', recordSequenceInteraction);
        document.removeEventListener('click', recordSequenceInteraction);
        if (!keyboardActivatedGenerate) {
          throw new Error('Sequence generation started without a trusted keyboard activation: ' + JSON.stringify(keyboardEvents));
        }
        await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-2"]', (element) =>
          element.getClientRects().length > 0,
          60_000,
        );
        const sequenceEnd = sequenceRange.querySelector('[data-testid="fla-frame-sequence-end"]')?.textContent?.trim() ?? '';
        const sequenceCount = sequenceRange.querySelector('[data-testid="fla-frame-sequence-count"]')?.textContent?.trim() ?? '';
        const generatedItems = [...document.querySelectorAll('[data-testid^="fla-frame-sequence-filmstrip-item-"]')];
        const selectedSequenceRow = [...document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"][data-selectable="true"]',
        )].find((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity);
        const sequenceCheckbox = selectedSequenceRow?.querySelector('input[type="checkbox"]');
        if (!(sequenceCheckbox instanceof HTMLInputElement)) {
          throw new Error('Generated sequence did not produce a selectable C03 candidate');
        }
        if (!sequenceCheckbox.checked) sequenceCheckbox.click();
        const selectedCount = await waitFor('[data-testid="fla-unified-import-selected-count"]', (element) =>
          element.textContent?.includes('已选择 1 项') === true,
        );
        const checkedAfterGenerate = sequenceCheckbox.checked && selectedCount.textContent?.includes('1 项') === true;

        const snapshotButton = await waitFor(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"][data-selectable="true"] .fla-c03-candidate-focus',
        );
        const snapshotRow = snapshotButton.closest('li[data-candidate-kind="snapshot"]');
        const expectedAlt = candidateDisplayLabel(snapshotButton);
        const snapshotIdentity = snapshotRow?.getAttribute('data-candidate-identity') ?? '';
        snapshotButton.click();
        const snapshotImage = await waitForFullPreview(expectedAlt);
        const snapshotSlot = snapshotImage.closest('.fla-c03-preview-controller-slot');
        const sequenceRowAfterSnapshot = [...document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"]',
        )].find((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity);
        const sequenceCheckboxAfterSnapshot = sequenceRowAfterSnapshot?.querySelector('input[type="checkbox"]');
        const focusBrowsePreserved = Boolean(snapshotSlot && !snapshotSlot.hidden) &&
          sequenceCheckboxAfterSnapshot instanceof HTMLInputElement && sequenceCheckboxAfterSnapshot.checked &&
          document.querySelector('[data-testid="fla-unified-import-selected-count"]')?.textContent?.includes('1 项') === true;

        const searchInput = document.querySelector('[data-testid="fla-c03-search"]');
        if (!(searchInput instanceof HTMLInputElement) || !expectedAlt || !snapshotIdentity) {
          throw new Error('Stage D snapshot candidate could not be used for the sequence focus regression');
        }
        setControlledInput('[data-testid="fla-c03-search"]', expectedAlt);
        await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.querySelectorAll('li[data-candidate-kind]').length === 1,
        );
        const selectedViewButton = await waitFor('[data-testid="fla-c03-selected-view"]');
        selectedViewButton.click();
        const selectedView = await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.getAttribute('data-view') === 'selected',
        );
        const selectedSequenceVisible = [...selectedView.querySelectorAll('li[data-candidate-kind="sequence"]')]
          .some((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity &&
            row.querySelector('input[type="checkbox"]')?.checked === true);
        selectedViewButton.click();
        const browseView = await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.getAttribute('data-view') === 'browse',
        );
        const searchRetainedOnBrowse = searchInput.value === expectedAlt &&
          browseView.querySelectorAll('li[data-candidate-kind]').length === 1;
        setControlledInput('[data-testid="fla-c03-search"]', '');
        await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.querySelectorAll('li[data-candidate-kind]').length === candidateGridCount,
        );
        const sequenceRowBeforeReturn = [...document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"]',
        )].find((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity);
        const sequenceReturnButton = sequenceRowBeforeReturn?.querySelector('.fla-c03-candidate-focus');
        if (!(sequenceReturnButton instanceof HTMLButtonElement)) throw new Error('Sequence candidate disappeared after browse return');
        sequenceReturnButton.click();
        await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-2"]', (element) =>
          element.getClientRects().length > 0,
        );
        const sequenceRowAfterReturn = [...document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"]',
        )].find((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity);
        const returnedCheckbox = sequenceRowAfterReturn?.querySelector('input[type="checkbox"]');
        const selectionPreservedThroughAtoBtoA = returnedCheckbox instanceof HTMLInputElement &&
          returnedCheckbox.checked &&
          document.querySelector('[data-testid="fla-unified-import-selected-count"]')?.textContent?.includes('1 项') === true &&
          selectedSequenceVisible && searchRetainedOnBrowse && focusBrowsePreserved;

        const rect = (element) => {
          if (!(element instanceof Element)) return null;
          const value = element.getBoundingClientRect();
          return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
        };
        const fullyVisible = (element) => {
          const value = rect(element);
          return Boolean(value && value.width > 0 && value.height > 0 && value.top >= -1 &&
            value.bottom <= window.innerHeight + 1 && value.left >= -1 && value.right <= window.innerWidth + 1);
        };
        const readSequenceReachability = () => {
          const currentRange = document.querySelector('[data-testid="fla-frame-sequence-range"]');
          const currentStart = currentRange?.querySelector('[data-testid="fla-frame-sequence-start"]');
          const currentAction = currentRange?.querySelector('[data-testid="fla-frame-sequence-render"], [data-testid="fla-frame-sequence-rerender"]');
          const currentStrip = document.querySelector('[data-testid="fla-frame-sequence-filmstrip-region"]');
          const firstFrame = currentStrip?.querySelector('[data-testid="fla-frame-sequence-filmstrip-item-0"]');
          const firstFrameRect = rect(firstFrame);
          const stripRect = rect(currentStrip);
          const firstFrameInsideStrip = Boolean(firstFrameRect && stripRect &&
            firstFrameRect.top >= stripRect.top - 1 && firstFrameRect.bottom <= stripRect.bottom + 1 &&
            firstFrameRect.left >= stripRect.left - 1 && firstFrameRect.right <= stripRect.right + 1);
          const firstFrameVisible = fullyVisible(firstFrame);
          const firstFrameFullyVisible = firstFrameVisible && firstFrameInsideStrip;
          const firstFrameCenterTarget = firstFrameRect
            ? document.elementFromPoint(
              firstFrameRect.left + firstFrameRect.width / 2,
              firstFrameRect.top + firstFrameRect.height / 2,
            )
            : null;
          const firstFrameActionable = firstFrame instanceof HTMLButtonElement && !firstFrame.disabled &&
            getComputedStyle(firstFrame).pointerEvents !== 'none' && firstFrameFullyVisible &&
            (firstFrameCenterTarget === firstFrame || firstFrame.contains(firstFrameCenterTarget));
          const previewStage = document.querySelector('.fla-frame-sequence-review-unified-preview .fla-frame-sequence-preview-stage');
          const previewImage = previewStage?.querySelector('img');
          const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
          const importAction = footer?.querySelector('[data-testid="fla-unified-import"]');
          const sequenceCandidate = [...document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="sequence"]',
          )].find((row) => row.getAttribute('data-candidate-identity') === sequenceIdentity);
          const checkboxHitbox = sequenceCandidate?.querySelector('.fla-c03-checkbox-hitbox');
          const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
          const workbenchStyle = workbench ? getComputedStyle(workbench) : null;
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
            start: { rect: rect(currentStart), visible: fullyVisible(currentStart), height: rect(currentStart)?.height ?? 0, value: currentStart instanceof HTMLInputElement ? currentStart.value : null },
            action: { testId: currentAction?.getAttribute('data-testid') ?? null, rect: rect(currentAction), visible: fullyVisible(currentAction), height: rect(currentAction)?.height ?? 0, disabled: currentAction instanceof HTMLButtonElement ? currentAction.disabled : null },
            filmstrip: {
              rect: stripRect,
              visible: fullyVisible(currentStrip),
              firstFrameVisible,
              firstFrameFullyVisible,
              firstFrameActionable,
              firstFrameRect,
              frameCount: currentStrip?.querySelectorAll('[role="listitem"]')?.length ?? 0,
            },
            preview: { stage: rect(previewStage), stageVisible: fullyVisible(previewStage), image: rect(previewImage), imageVisible: fullyVisible(previewImage) },
            footer: { rect: rect(footer), visible: fullyVisible(footer) },
            importAction: { rect: rect(importAction), visible: fullyVisible(importAction), height: rect(importAction)?.height ?? 0 },
            checkboxHitbox: { rect: rect(checkboxHitbox), width: rect(checkboxHitbox)?.width ?? 0, height: rect(checkboxHitbox)?.height ?? 0 },
            workbench: { rect: rect(workbench), scrollTop: workbench instanceof HTMLElement ? workbench.scrollTop : 0, scrollHeight: workbench instanceof HTMLElement ? workbench.scrollHeight : 0, clientHeight: workbench instanceof HTMLElement ? workbench.clientHeight : 0, overflowY: workbenchStyle?.overflowY ?? '' },
          };
        };
        const normalReachability = readSequenceReachability();
        await waitForCapture('sequence-wide');
        await waitForCapture('sequence-short-wide');
        const shortWideReachability = readSequenceReachability();
        await waitForCapture('sequence-narrow-top');
        const narrowAtTop = readSequenceReachability();
        const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
        if (!(workbench instanceof HTMLElement)) throw new Error('Narrow Stage D workbench is missing');
        const workbenchRect = workbench.getBoundingClientRect();
        const touchX = Math.max(1, Math.min(window.innerWidth - 1, workbenchRect.left + workbenchRect.width / 2));
        const touchY = Math.max(1, Math.min(window.innerHeight - 1, workbenchRect.top + Math.min(130, workbenchRect.height / 2)));
        const scrollTopBeforeTouch = workbench.scrollTop;
        let touchStartCount = 0;
        let touchMoveCount = 0;
        const onTouchStart = () => { touchStartCount += 1; };
        const onTouchMove = () => { touchMoveCount += 1; };
        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: true });
        const touchScrollAttempts = [];
        let narrowAfterTouch = readSequenceReachability();
        const maxNativeTouchScrolls = ${MAX_SEQUENCE_NARROW_TOUCH_SCROLLS};
        try {
          for (let attempt = 1; attempt <= maxNativeTouchScrolls; attempt += 1) {
            if (narrowAfterTouch.filmstrip.firstFrameActionable) break;
            const scrollTopBeforeAttempt = workbench.scrollTop;
            await waitForNativeTouch('sequence-narrow-touch-scroll-' + attempt, {
              x: touchX,
              y: touchY,
              deltaY: 110,
            });
            const touchDeadline = Date.now() + 3_000;
            while (Date.now() < touchDeadline &&
              workbench.scrollTop <= scrollTopBeforeAttempt + 1 &&
              workbench.scrollHeight > workbench.clientHeight + 1) {
              await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
            }
            narrowAfterTouch = readSequenceReachability();
            touchScrollAttempts.push({
              attempt,
              scrollTopBefore: scrollTopBeforeAttempt,
              scrollTopAfter: workbench.scrollTop,
              firstFrameVisible: narrowAfterTouch.filmstrip.firstFrameVisible,
              firstFrameActionable: narrowAfterTouch.filmstrip.firstFrameActionable,
            });
            if (narrowAfterTouch.filmstrip.firstFrameActionable) break;
          }
        } finally {
          document.removeEventListener('touchstart', onTouchStart);
          document.removeEventListener('touchmove', onTouchMove);
        }
        await waitForNativeTouch('sequence-narrow-touch-scroll-complete', {
          x: touchX,
          y: touchY,
          deltaY: 110,
          complete: true,
        });
        const touchScroll = {
          dispatchedBy: 'Electron CDP Input.dispatchTouchEvent',
          maxGestures: maxNativeTouchScrolls,
          gestureCount: touchScrollAttempts.length,
          touchStartCount,
          touchMoveCount,
          scrollTopBefore: scrollTopBeforeTouch,
          scrollTopAfter: workbench.scrollTop,
          scrollHeight: workbench.scrollHeight,
          clientHeight: workbench.clientHeight,
          firstFrameFullyVisible: narrowAfterTouch.filmstrip.firstFrameFullyVisible,
          firstFrameActionable: narrowAfterTouch.filmstrip.firstFrameActionable,
          attempts: touchScrollAttempts,
        };
        const narrowStart = sequenceRange.querySelector('[data-testid="fla-frame-sequence-start"]');
        if (!(narrowStart instanceof HTMLInputElement)) throw new Error('Narrow Stage D sequence start input disappeared');
        narrowStart.focus();
        await waitForNativeKeyboard('sequence-narrow-tab-action');
        const narrowRange = document.querySelector('[data-testid="fla-frame-sequence-range"]');
        const narrowAction = narrowRange?.querySelector('[data-testid="fla-frame-sequence-render"], [data-testid="fla-frame-sequence-rerender"]');
        const keyboardReachedAction = narrowAction instanceof HTMLButtonElement && document.activeElement === narrowAction;
        await waitForNativeKeyboard('sequence-narrow-tab-playback');
        const playbackButton = document.querySelector('[data-testid="fla-frame-sequence-playback"]');
        const keyboardReachedPlayback = playbackButton instanceof HTMLButtonElement &&
          !playbackButton.disabled && document.activeElement === playbackButton;
        await waitForNativeKeyboard('sequence-narrow-tab-frame');
        const narrowFirstFrame = document.querySelector('[data-testid="fla-frame-sequence-filmstrip-item-0"]');
        const keyboardReachedFrameStrip = narrowFirstFrame instanceof HTMLButtonElement && document.activeElement === narrowFirstFrame;
        const narrowAfterKeyboard = readSequenceReachability();
        const narrowFooterPinned = narrowAtTop.footer.rect && narrowAfterTouch.footer.rect &&
          Math.abs(narrowAtTop.footer.rect.top - narrowAfterTouch.footer.rect.top) <= 1;
        await waitForCapture('sequence-narrow-scrolled');
        return {
          identity: sequenceIdentity,
          sequenceEnd,
          sequenceCount,
          generatedFrameCount: generatedItems.length,
          checkedAfterGenerate,
          selectionPreservedThroughAtoBtoA,
          keyboardFocusedGenerate,
          selectedOnlyShowsSequence: selectedSequenceVisible,
          searchRetainedOnBrowse,
          focusBrowsePreserved,
          normalReachability,
          shortWideReachability,
          narrowAtTop,
          touchScroll,
          narrowAfterTouch,
          keyboardReachedAction,
          keyboardReachedPlayback,
          keyboardReachedFrameStrip,
          narrowAfterKeyboard,
          narrowFooterPinned,
          nativeSequence: true,
        };
      };

      const selectTwoCandidates = async () => {
        const duplicateRows = [...document.querySelectorAll(
          '[data-testid="fla-snapshot-targets"] li[data-duplicate="true"] .fla-snapshot-candidate-row',
        )];
        const duplicateIdentities = duplicateRows
          .map((row) => row.getAttribute('data-fla-candidate-id'))
          .filter(Boolean);
        const candidates = duplicateIdentities.map((identity) => {
          const row = [...document.querySelectorAll(
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
          )].find((candidate) => candidate.getAttribute('data-candidate-identity') === identity);
          return row?.querySelector('input[type="checkbox"]');
        }).filter((input) => input instanceof HTMLInputElement && !input.disabled);
        if (candidates.length < 2) {
          throw new Error('Expected two selectable C03 candidates from an exact-duplicate source group, got ' + candidates.length);
        }
        candidates[0].click();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
        candidates[1].click();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
        const selectedCount = document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] input[type="checkbox"]:checked',
        ).length;
        return {
          selectedCount,
          supportedCandidateCount: candidates.length,
        };
      };

      const reviewState = () => document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') ?? '';
      const importButton = () => document.querySelector('[data-testid="fla-unified-import"]');
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
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"][data-selectable="true"] .fla-c03-candidate-focus',
        )];
        const unfocusedFocusButton = supportedFocusButtons.find((button) =>
          !button.closest('li')?.classList.contains('is-focused'),
        );
        const previewButtons = issue762Profile
          ? [unfocusedFocusButton ?? supportedFocusButtons[0]].filter(Boolean)
          : supportedFocusButtons.slice(0, 16);
        const previewMeasurements = [];
        if (issue762Profile) issue762RunState.previewMeasurements = previewMeasurements;
        for (let candidateIndex = 0; candidateIndex < previewButtons.length; candidateIndex += 1) {
          const button = previewButtons[candidateIndex];
          if (!(button instanceof HTMLElement)) continue;
          const expectedAlt = candidateDisplayLabel(button);
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
            candidateRowTestId: button.getAttribute('data-testid'),
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
            '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"][data-selectable="true"]',
          );
          const firstSupportedCheckbox = firstSupportedRow?.querySelector('input[type="checkbox"]');
          if (!(firstSupportedCheckbox instanceof HTMLInputElement) || firstSupportedCheckbox.disabled) {
            throw new Error('No supported candidate is selectable for the profile commit sample');
          }
          const selectionStartedAt = performance.now();
          firstSupportedCheckbox.click();
          await waitFor('[data-testid="fla-unified-import"]', (element) =>
            element instanceof HTMLButtonElement && !element.disabled,
          );
          const beforeImport = readProjectState();
          const selectionNoMutation = beforeImport.assetCount === initial.assetCount &&
            beforeImport.maxRevision === initial.maxRevision;
          const importStartedAt = performance.now();
          click('[data-testid="fla-unified-import"]');
          const receiptCounts = await waitFor('[data-testid="fla-unified-import-counts"]', () => true, 120_000);
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
        click('[data-testid="fla-review-cancel"]');
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
        stopIssue766Probe();
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
          ...(issue766FirstLoad ? { issue766FirstLoad: issue766Probe } : {}),
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
        const targetList = document.querySelector('[data-testid="fla-c03-candidate-grid"]');
        const targetRows = targetList
          ? [...targetList.querySelectorAll('li[data-candidate-kind]')]
          : [];
        const firstTarget = targetRows[0] ?? null;
        const lastTarget = targetRows[targetRows.length - 1] ?? null;
        const listStyle = targetList ? getComputedStyle(targetList) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          session: rectData(document.querySelector('[data-testid="fla-review-session"]')),
          workbench: rectData(document.querySelector('[data-testid="fla-c03-workbench"]')),
          header: rectData(document.querySelector('[data-testid="fla-review-header"]')),
          preview: rectData(document.querySelector('[data-testid="fla-c03-preview"]')),
          actionBar: rectData(document.querySelector('[data-testid="fla-c03-import-footer"]')),
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
          documentScrollHeight: document.documentElement.scrollHeight,
          documentClientHeight: document.documentElement.clientHeight,
          primaryActionCount: document.querySelectorAll(
            '[data-testid="fla-c03-import-footer"] [data-testid="fla-unified-import"]',
          ).length,
        };
      };

      const stageFactsText = document.querySelector('[data-testid="fla-snapshot-source-facts"]')?.textContent ?? '';
      const targetCount = document.querySelectorAll(
        '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"]',
      ).length;
      const candidateGridCount = document.querySelectorAll(
        '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind]',
      ).length;
      const candidateSourceRowCount = document.querySelectorAll(
        '[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row',
      ).length;
      const duplicateGroupSourceCount = [...document.querySelectorAll(
        '[data-testid="fla-snapshot-targets"] .fla-snapshot-duplicate-label',
      )].reduce((total, label) => total + Number(label.textContent?.match(/[0-9]+/u)?.[0] ?? 0), 0);
      const duplicateGroupPreservesSourceIdentity = duplicateGroupSourceCount > 0 &&
        duplicateGroupSourceCount === candidateSourceRowCount && candidateSourceRowCount === targetCount;
      const reviewBodyText = document.querySelector('[data-testid="fla-review-session"]')?.textContent ?? '';
      const defaultDetailsText = [
        document.querySelector('[data-testid="fla-snapshot-details"]')?.textContent ?? '',
        document.querySelector('[data-testid="fla-snapshot-candidate-summary"]')?.textContent ?? '',
      ].join(' ');
      const defaultHashHidden = !defaultDetailsText.includes('预览去重') &&
        !/SHA[- ]?256/iu.test(defaultDetailsText) && !/[0-9a-f]{12}/iu.test(defaultDetailsText);
      const sourceBasename = document.querySelector('[data-testid="fla-review-header"] h1')?.textContent?.trim() ?? '';
      const countOccurrences = (value, needle) => needle ? value.split(needle).length - 1 : 0;
      const noRasterChrome = document.querySelectorAll(
        '[data-testid="fla-review-select-all"], [data-testid="fla-review-clear-all"], [data-testid="fla-review-selection-toolbar"]',
      ).length === 0;
      const zeroRasterRoute = document.querySelector('[data-workbench-route="unified"]') !== null &&
        document.querySelector('[data-testid="fla-c03-workbench"]') !== null &&
        document.querySelector('[data-testid="fla-review-zero-raster-summary"]') === null;
      const deletionChecks = {
        unifiedImportShellVisible: document.querySelector('[data-workbench-route="unified"] [data-testid="fla-review-header"]') !== null &&
          document.querySelector('[data-testid="fla-c03-workbench"]') !== null &&
          document.querySelector('[data-testid="fla-c03-candidate-grid"]') !== null &&
          document.querySelector('[data-testid="fla-c03-import-footer"]') !== null,
        retiredRenderTabsRemoved: document.querySelectorAll(
          '[data-testid^="fla-render-mode-"], [data-testid="fla-import-workbench-tabs"] [role="tab"]',
        ).length === 0,
        genericRecoveryNoticeRemoved: document.querySelector('[data-testid="fla-review-recovery-notice"]') === null,
        zeroRasterSummaryRemoved: document.querySelector('[data-testid="fla-review-zero-raster-summary"]') === null,
        sourceFilenameSingle: sourceBasename.length > 0 && countOccurrences(reviewBodyText, sourceBasename) === 1,
        targetCountSingle: document.querySelectorAll('[data-testid="fla-snapshot-target-count"]').length === 1 &&
          document.querySelectorAll('[data-testid="fla-snapshot-visible-target-count"]').length === 0,
        candidateSummaryVisible: document.querySelector('[data-testid="fla-unified-import-selected-count"]') !== null &&
          document.querySelector('[data-testid="fla-c03-focused-label"]') !== null,
        moreDetailsCollapsed: document.querySelector('[data-testid="fla-snapshot-compatibility-details"]')?.hasAttribute('open') === false,
        defaultExplanatoryBlocksRemoved: document.querySelectorAll(
          '[data-testid="fla-review-zero-raster-summary"], [data-testid="fla-snapshot-zero-raster"], [data-testid="fla-snapshot-readonly-note"], [data-testid="fla-snapshot-fidelity"]',
        ).length === 0,
        footerGuidanceMerged: document.querySelector('[data-testid="fla-snapshot-action-guidance"]') === null,
      };
      const snapshotPreviewImage = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
      const snapshotPreviewSlot = snapshotPreviewImage?.closest('.fla-c03-preview-controller-slot');
      const shellFacts = {
        mode: document.querySelector('[data-testid="fla-review-session"]')?.getAttribute('data-workbench-route') ?? '',
        snapshotPreviewVisible: Boolean(snapshotPreviewSlot && !snapshotPreviewSlot.hidden),
        targetCount,
        candidateGridCount,
        noRasterChrome,
        stageFactsVisible: stageFactsText.includes('640') && stageFactsText.includes('360') && stageFactsText.includes('30'),
        stageFactsText: stageFactsText.trim(),
      };

      const topLayout = readLayout();
      const targetLabels = [...document.querySelectorAll(
        '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind="snapshot"] .fla-c03-candidate-copy strong',
      )]
        .map((element) => element.getAttribute('title')?.trim() || element.textContent?.trim() || '')
        .filter(Boolean);
      await waitForCapture('top');

      if (captureSequencePreviewBeforeRender) {
        const focusedLabel = document.querySelector('[data-testid="fla-c03-focused-label"]')?.textContent?.trim() ?? '';
        const previewImage = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
        const sequenceRange = document.querySelector('[data-testid="fla-frame-sequence-range"]');
        const startInput = sequenceRange?.querySelector('[data-testid="fla-frame-sequence-start"]');
        const generateButton = sequenceRange?.querySelector(
          '[data-testid="fla-frame-sequence-render"], [data-testid="fla-frame-sequence-rerender"]',
        );
        const visible = (element) => {
          if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight &&
            getComputedStyle(element).visibility !== 'hidden';
        };
        const previewReady = previewImage instanceof HTMLImageElement && previewImage.complete && previewImage.naturalWidth > 0;
        const generateActionVisible = generateButton instanceof HTMLButtonElement &&
          !generateButton.disabled && visible(generateButton);
        const rangeVisible = visible(sequenceRange) && visible(startInput);
        if (sequenceTargetSubstring && !focusedLabel.includes(sequenceTargetSubstring)) {
          throw new Error('Focused preview label did not match the requested capture target: ' + focusedLabel);
        }
        if (!previewReady || !rangeVisible || !generateActionVisible) {
          throw new Error('R4 preview capture state is incomplete: ' + JSON.stringify({
            focusedLabel,
            previewReady,
            rangeVisible,
            generateActionVisible,
          }));
        }
        const focusedRow = document.querySelector('[data-testid="fla-c03-candidate-grid"] li.is-focused');
        const focusedIdentity = focusedRow?.getAttribute('data-candidate-identity') ?? '';
        await waitForCapture('sequence-pre-render-wide');
        await waitForCapture('sequence-pre-render-narrow');
        return {
          ok: true,
          projectName,
          projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
          route: 'v2r-target-discovery',
          targetCount: shellFacts.targetCount,
          candidateGridCount,
          sourceBasename,
          sequenceInteraction: {
            identity: focusedIdentity,
            focusedLabel,
            generateActionVisible,
            rangeVisible,
            previewOnly: true,
            preview: {
              alt: previewImage.alt,
              naturalWidth: previewImage.naturalWidth,
              naturalHeight: previewImage.naturalHeight,
            },
          },
          projectMutation: 'CANDIDATE_PREVIEWS_ONLY; NO_SELECTION; NO_IMPORT',
        };
      }

      const targetList = document.querySelector('[data-testid="fla-c03-candidate-grid"]');
      if (!(targetList instanceof HTMLElement)) throw new Error('Stage D C03 candidate list is not scrollable');
      targetList.scrollTop = targetList.scrollHeight;
      targetList.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const bottomLayout = readLayout();
      await waitForCapture('bottom');

      const targetSearch = document.querySelector('[data-testid="fla-c03-search"]');
      const searchQuery = targetLabels[0] ?? '';
      let searchMatches = false;
      if (targetSearch instanceof HTMLInputElement && searchQuery) {
        setControlledInput('[data-testid="fla-c03-search"]', searchQuery);
        await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.querySelectorAll('li[data-candidate-kind]').length === 1,
        );
        searchMatches = document.querySelectorAll(
          '[data-testid="fla-c03-candidate-grid"] li[data-candidate-kind]',
        ).length === 1;
        setControlledInput('[data-testid="fla-c03-search"]', '');
        await waitFor('[data-testid="fla-c03-candidate-grid"]', (element) =>
          element.querySelectorAll('li[data-candidate-kind]').length === candidateGridCount,
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
        pageNotStretched: Boolean(topLayout.session && isViewportVisible(topLayout.session)) &&
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
      const sequenceInteraction = await exerciseSequenceCandidate();
      if (captureSequencePreviewBeforeRender) {
        return {
          ok: true,
          projectName,
          projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
          route: 'v2r-target-discovery',
          targetCount: shellFacts.targetCount,
          candidateGridCount,
          sourceBasename,
          sequenceInteraction,
          projectMutation: 'CANDIDATE_PREVIEWS_ONLY; NO_SELECTION; NO_IMPORT',
        };
      }
      const sequenceWideReachable = sequenceInteraction.normalReachability.start.visible &&
        sequenceInteraction.normalReachability.action.visible &&
        sequenceInteraction.normalReachability.filmstrip.visible &&
        sequenceInteraction.normalReachability.filmstrip.firstFrameVisible &&
        sequenceInteraction.normalReachability.footer.visible &&
        sequenceInteraction.normalReachability.importAction.visible;
      const sequenceNarrowReachable = (
        sequenceInteraction.narrowAtTop.start.visible || sequenceInteraction.narrowAfterTouch.start.visible
      ) && (
        sequenceInteraction.narrowAtTop.action.visible || sequenceInteraction.narrowAfterTouch.action.visible ||
        sequenceInteraction.keyboardReachedAction
      ) && (
        sequenceInteraction.narrowAtTop.filmstrip.firstFrameActionable ||
        sequenceInteraction.narrowAfterTouch.filmstrip.firstFrameActionable
      ) && sequenceInteraction.narrowAtTop.footer.visible &&
        sequenceInteraction.narrowAtTop.importAction.visible && sequenceInteraction.narrowFooterPinned;
      const sequenceShortWideReachable = sequenceInteraction.shortWideReachability.viewport.width === 1008 &&
        sequenceInteraction.shortWideReachability.viewport.height === 580 &&
        sequenceInteraction.shortWideReachability.start.visible &&
        sequenceInteraction.shortWideReachability.start.height >= 44 &&
        sequenceInteraction.shortWideReachability.action.visible &&
        sequenceInteraction.shortWideReachability.action.height >= 48 &&
        sequenceInteraction.shortWideReachability.filmstrip.firstFrameVisible &&
        sequenceInteraction.shortWideReachability.preview.stageVisible &&
        sequenceInteraction.shortWideReachability.preview.imageVisible &&
        sequenceInteraction.shortWideReachability.preview.stage.height >= 120 &&
        sequenceInteraction.shortWideReachability.footer.visible &&
        sequenceInteraction.shortWideReachability.importAction.visible &&
        sequenceInteraction.shortWideReachability.importAction.height >= 56;
      const sequenceTouchWorks = sequenceInteraction.narrowAtTop.filmstrip.firstFrameActionable || (
        sequenceInteraction.touchScroll.gestureCount > 0 &&
        sequenceInteraction.touchScroll.gestureCount <= sequenceInteraction.touchScroll.maxGestures &&
        sequenceInteraction.touchScroll.touchStartCount >= sequenceInteraction.touchScroll.gestureCount &&
        sequenceInteraction.touchScroll.touchMoveCount >= sequenceInteraction.touchScroll.gestureCount &&
        sequenceInteraction.touchScroll.firstFrameFullyVisible &&
        sequenceInteraction.touchScroll.firstFrameActionable &&
        (sequenceInteraction.touchScroll.scrollHeight <= sequenceInteraction.touchScroll.clientHeight + 1 ||
          sequenceInteraction.touchScroll.scrollTopAfter > sequenceInteraction.touchScroll.scrollTopBefore + 1)
      );
      const sequenceKeyboardWorks = sequenceInteraction.keyboardFocusedGenerate &&
        sequenceInteraction.keyboardReachedAction && sequenceInteraction.keyboardReachedPlayback &&
        sequenceInteraction.keyboardReachedFrameStrip;
      const sequenceHitTargetsRespectDesign = sequenceInteraction.normalReachability.start.height >= 44 &&
        sequenceInteraction.normalReachability.action.height >= 48 &&
        sequenceInteraction.normalReachability.importAction.height >= 56 &&
        sequenceInteraction.normalReachability.checkboxHitbox.width >= 48 &&
        sequenceInteraction.normalReachability.checkboxHitbox.height >= 48;
      const contextualSequenceReachable = sequenceWideReachable && sequenceShortWideReachable && sequenceNarrowReachable &&
        sequenceInteraction.generatedFrameCount === 3 && sequenceInteraction.sequenceEnd.includes('第 3 帧') &&
        sequenceInteraction.sequenceCount.includes('3 帧') && sequenceInteraction.selectionPreservedThroughAtoBtoA &&
        sequenceTouchWorks && sequenceKeyboardWorks && sequenceHitTargetsRespectDesign &&
        sequenceInteraction.narrowAtTop.viewport.devicePixelRatio === expectedDisplayScaleFactor;
      const beforeCancel = readProjectState();
      click('[data-testid="fla-review-cancel"]');
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
      await waitFor('[data-testid="fla-unified-import"]', (element) =>
        element instanceof HTMLButtonElement && !element.disabled,
      );
      const importEnabledAfterSelection = importEnabled();
      const detailsVisible = document.querySelector('[data-testid="fla-c03-focused-label"]') !== null &&
        document.querySelector('[data-testid="fla-c03-import-footer"]') !== null;

      const beforeImport = readProjectState();
      click('[data-testid="fla-unified-import"]');
      const receiptCounts = await waitFor('[data-testid="fla-unified-import-counts"]');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      const afterImport = readProjectState();
      const committedAssetCount = beforeImport.assetCount !== null && afterImport.assetCount !== null
        ? afterImport.assetCount - beforeImport.assetCount
        : null;
      const revisionAdvanced = afterImport.maxRevision !== null &&
        (beforeImport.maxRevision === null || afterImport.maxRevision > beforeImport.maxRevision);
      const committedText = receiptCounts.textContent?.trim() ?? '';
      const receiptItems = [...document.querySelectorAll('[data-testid="fla-unified-import-items"] li')]
        .map((item) => item.getAttribute('data-status'));
      const processedCount = receiptItems.length;
      const importedCount = receiptItems.filter((status) => status === 'imported').length;
      const duplicateCount = receiptItems.filter((status) => status === 'duplicate').length;
      const failedCount = receiptItems.filter((status) => status === 'failed').length;
      const notAttemptedCount = receiptItems.filter((status) => status === 'not-attempted').length;
      const receiptElement = document.querySelector('[data-testid="fla-unified-import-receipt"]');
      const receiptSummary = receiptElement?.querySelector('summary');
      const importFooter = document.querySelector('[data-testid="fla-c03-import-footer"]');
      const importAction = importFooter?.querySelector('[data-testid="fla-unified-import"]');
      if (!(receiptElement instanceof HTMLDetailsElement) || !(receiptSummary instanceof HTMLElement) ||
        !(importFooter instanceof HTMLElement) || !(importAction instanceof HTMLElement)) {
        throw new Error('Stage D import receipt/footer is missing after the real import');
      }
      if (!receiptElement.open) receiptSummary.click();
      const receiptRect = (element) => {
        if (!(element instanceof Element)) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
      };
      const receiptFullyVisible = (element) => {
        const value = receiptRect(element);
        return Boolean(value && value.width > 0 && value.height > 0 && value.top >= -1 &&
          value.bottom <= window.innerHeight + 1 && value.left >= -1 && value.right <= window.innerWidth + 1);
      };
      const receiptVisibleInsideFooter = (element) => {
        const item = receiptRect(element);
        const footer = receiptRect(importFooter);
        return Boolean(item && footer && receiptFullyVisible(element) && item.top >= footer.top - 1 &&
          item.bottom <= footer.bottom + 1 && item.left >= footer.left - 1 && item.right <= footer.right + 1);
      };
      const readReceiptReachability = () => {
        const receiptItems = [...receiptElement.querySelectorAll('[data-testid="fla-unified-import-items"] li')];
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
          expanded: receiptElement.open,
          footerVisible: receiptFullyVisible(importFooter),
          importActionVisible: receiptVisibleInsideFooter(importAction),
          summaryVisible: receiptVisibleInsideFooter(receiptSummary),
          firstItemVisible: receiptVisibleInsideFooter(receiptItems[0]),
          lastItemVisible: receiptVisibleInsideFooter(receiptItems.at(-1)),
          footerScrollTop: importFooter.scrollTop,
          footerScrollHeight: importFooter.scrollHeight,
          footerClientHeight: importFooter.clientHeight,
        };
      };
      const receiptTouchScroll = async (marker) => {
        const content = receiptElement.querySelector('[data-testid="fla-unified-import-items"]');
        const contentRect = receiptRect(content);
        const footerBounds = receiptRect(importFooter);
        if (!contentRect || !footerBounds) throw new Error('Stage D receipt content bounds are missing');
        const point = {
          x: Math.max(1, Math.min(window.innerWidth - 1, footerBounds.left + footerBounds.width / 2)),
          y: Math.max(footerBounds.top + 8, Math.min(footerBounds.bottom - 8, contentRect.top + Math.min(24, contentRect.height / 2))),
          deltaY: 110,
        };
        const before = importFooter.scrollTop;
        let touchStartCount = 0;
        let touchMoveCount = 0;
        const onTouchStart = (event) => { if (importFooter.contains(event.target)) touchStartCount += 1; };
        const onTouchMove = (event) => { if (importFooter.contains(event.target)) touchMoveCount += 1; };
        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: true });
        await waitForNativeTouch(marker, point);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        document.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchmove', onTouchMove);
        return {
          dispatchedBy: 'Electron CDP Input.dispatchTouchEvent',
          touchStartCount,
          touchMoveCount,
          scrollTopBefore: before,
          scrollTopAfter: importFooter.scrollTop,
          scrollHeight: importFooter.scrollHeight,
          clientHeight: importFooter.clientHeight,
        };
      };

      importFooter.scrollTop = 0;
      await waitForCapture('receipt-846-top');
      const receipt846Top = readReceiptReachability();
      const receipt846Touch = await receiptTouchScroll('receipt-846-touch-scroll');
      importFooter.scrollTop = importFooter.scrollHeight;
      importFooter.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      await waitForCapture('receipt-846-scrolled');
      const receipt846Bottom = readReceiptReachability();

      importFooter.scrollTop = 0;
      await waitForCapture('receipt-narrow-top');
      const receiptNarrowTop = readReceiptReachability();
      const receiptNarrowTouch = await receiptTouchScroll('receipt-narrow-touch-scroll');
      importFooter.scrollTop = importFooter.scrollHeight;
      importFooter.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      await waitForCapture('receipt-narrow-scrolled');
      const receiptNarrowBottom = readReceiptReachability();
      const receiptReachability = {
        viewport846x653: { top: receipt846Top, touchScroll: receipt846Touch, bottom: receipt846Bottom },
        narrowNative: { top: receiptNarrowTop, touchScroll: receiptNarrowTouch, bottom: receiptNarrowBottom },
      };
      click('[data-testid="fla-review-cancel"]');
      await waitFor('[data-testid="asset-browser-view"]');
      const libraryAfterClose = readProjectState();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const releasedPreviewResources = previewUrlState();
      stopIssue766Probe();

      const checks = {
        zeroRasterRoute,
        unifiedPreviewAndImportRegionsVisible: detailsVisible,
        stageDv11Layout: Object.values(layoutChecks).every(Boolean),
        stageDv12Deletion: Object.values(deletionChecks).every(Boolean),
        c03SnapshotPreviewVisible: shellFacts.mode === 'unified' && shellFacts.snapshotPreviewVisible,
        stageTargetFacts: shellFacts.targetCount >= 2 && shellFacts.stageFactsVisible,
        duplicateGroupPreservesSourceIdentity,
        noRasterChrome: shellFacts.noRasterChrome,
        contextualSequenceReachable,
        sequencePreviewSelectionPreserved: sequenceInteraction.selectionPreservedThroughAtoBtoA,
        sequenceWideReachable,
        sequenceShortWideReachable,
        sequenceNarrowReachable,
        sequenceTouchWorks,
        sequenceKeyboardWorks,
        sequenceHitTargetsRespectDesign,
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
        receiptReachableAt846x653: receiptReachability.viewport846x653.top.footerVisible &&
          receiptReachability.viewport846x653.top.viewport.width === 846 &&
          receiptReachability.viewport846x653.top.viewport.height === 653 &&
          receiptReachability.viewport846x653.top.viewport.devicePixelRatio === expectedDisplayScaleFactor &&
          receiptReachability.viewport846x653.top.importActionVisible &&
          receiptReachability.viewport846x653.top.summaryVisible &&
          receiptReachability.viewport846x653.bottom.importActionVisible &&
          receiptReachability.viewport846x653.bottom.viewport.width === 846 &&
          receiptReachability.viewport846x653.bottom.viewport.height === 653 &&
          receiptReachability.viewport846x653.bottom.lastItemVisible,
        receiptReachableAtNarrowNative: receiptReachability.narrowNative.top.footerVisible &&
          receiptReachability.narrowNative.top.viewport.width < 846 &&
          receiptReachability.narrowNative.top.viewport.height < 653 &&
          receiptReachability.narrowNative.top.viewport.devicePixelRatio === expectedDisplayScaleFactor &&
          receiptReachability.narrowNative.top.importActionVisible &&
          receiptReachability.narrowNative.top.summaryVisible &&
          receiptReachability.narrowNative.bottom.importActionVisible &&
          receiptReachability.narrowNative.bottom.viewport.width === receiptReachability.narrowNative.top.viewport.width &&
          receiptReachability.narrowNative.bottom.viewport.height === receiptReachability.narrowNative.top.viewport.height &&
          receiptReachability.narrowNative.bottom.lastItemVisible,
        receiptTouchWorks: [receiptReachability.viewport846x653.touchScroll, receiptReachability.narrowNative.touchScroll]
          .every((scroll) => scroll.touchStartCount > 0 && scroll.touchMoveCount > 0 &&
            (scroll.scrollHeight <= scroll.clientHeight + 1 || scroll.scrollTopAfter > scroll.scrollTopBefore + 1)),
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
        sequenceInteraction,
        receiptReachability,
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
        ...(issue766FirstLoad ? { issue766FirstLoad: issue766Probe } : {}),
        projectMutation: 'CANDIDATE_PREVIEWS_AND_SELECTION_NO_PROJECT_MUTATION; CANCEL_NO_MUTATION; ONE_CONFIRM; COMMIT_SELECTED_STATIC_SNAPSHOT_IMAGE_ASSETS',
      };
    })().catch((error) => {
      if (issue766FirstLoad) console.error('[issue766-first-load] renderer probe failed', error);
      let verifierCleanupError = null;
      try {
        stopIssue766Probe();
      } catch (cleanupError) {
        verifierCleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      }
      return {
      verifierError: error instanceof Error ? error.message : String(error),
      verifierStack: error instanceof Error ? error.stack : String(error),
      verifierCleanupError,
      issue762ProfileEvents,
      issue762ScanMeasurement: error?.issue762ScanMeasurement ?? null,
      issue762RunState: issue762Profile ? window.__pandaStageIssue762RunState ?? null : null,
      };
    })
  `).then((result) => {
    if (result?.verifierError) {
      const error = new Error(`${result.verifierError}\n${result.verifierStack ?? ''}`);
      error.issue762ProfileEvents = result.issue762ProfileEvents ?? [];
      error.issue762ScanMeasurement = result.issue762ScanMeasurement ?? null;
      error.issue762RunState = result.issue762RunState ?? null;
      error.verifierCleanupError = result.verifierCleanupError ?? null;
      throw error;
    }
    return result;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.issue766FirstLoad) {
    if (!args.measureScanOnly) {
      throw new Error('--issue766-first-load requires --measure-scan-only');
    }
    args.issue762Profile = true;
    issue766Runtime.enabled = true;
  }
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
        wallTimeMs: Date.now(),
      });
    };
  }
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
  const outPath = resolve(args.out || join(
    acceptanceRoot,
    args.issue766FirstLoad
      ? 'issue766-first-load.json'
      : args.measureScanOnly ? 'issue761-fla-scan-measurement.json' : 'issue398-stage-d-receipt.json',
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
    if (args.issue766FirstLoad) {
      startIssue766MainHeartbeat();
      installIssue766CatalogIpcProbe(mainProfileEvents);
    }
    require('../dist-electron/main/index.js');
    sourceSha256Before = sha256(sourcePath);
    const mainWindow = await waitForMainWindow();
    const normalWindowBounds = mainWindow.getBounds();
    if (args.issue766FirstLoad) {
      mainWindow.webContents.on('console-message', (_event, ...details) => {
        process.stderr.write(`[issue766 renderer console] ${details.map(String).join(' ')}\n`);
      });
      mainWindow.webContents.on('render-process-gone', (_event, details) => {
        process.stderr.write(`[issue766 renderer gone] ${JSON.stringify(details)}\n`);
      });
    }
    if (args.issue762Profile) mainWindow.showInactive();
    const pathState = { error: null };
    const pathPromise = runStageDPath(mainWindow, acceptanceRoot, projectName, {
      measureScanOnly: Boolean(args.measureScanOnly),
      issue762Profile: Boolean(args.issue762Profile),
      issue766FirstLoad: Boolean(args.issue766FirstLoad),
      profileCommit: Boolean(args.profileCommit),
      displayScaleFactor: screen.getPrimaryDisplay().scaleFactor,
      sequenceTargetSubstring: typeof args.sequenceTarget === 'string' ? args.sequenceTarget : '',
      captureSequencePreviewBeforeRender: Boolean(args.captureSequencePreviewBeforeRender),
      profileScanTimeoutMs: Number.isFinite(args.scanTimeoutMs) && args.scanTimeoutMs > 0
        ? args.scanTimeoutMs
        : 900_000,
    }).catch((error) => {
      pathState.error = error;
      throw error;
    });
    let layoutEvidence = null;
    if (!args.measureScanOnly) {
      layoutEvidence = {};
      layoutEvidence.top = await captureScreenshotAtMarker(
          mainWindow,
          'top',
          join(evidenceDir, 'stage-d-top-target.png'),
          pathState,
        );
      if (args.captureSequencePreviewBeforeRender) {
        layoutEvidence.sequencePreGenerateWide = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-pre-render-wide',
          join(evidenceDir, 'stage-d-sequence-pre-generate-wide.png'),
          pathState,
        );
        layoutEvidence.sequencePreGenerateNarrow = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-pre-render-narrow',
          join(evidenceDir, 'stage-d-sequence-pre-generate-narrow.png'),
          pathState,
          {
            resizeTo: { width: 800, height: 560, maxViewportWidth: 900 },
            restoreBoundsAfterCapture: normalWindowBounds,
          },
        );
      } else {
        layoutEvidence.bottom = await captureScreenshotAtMarker(
          mainWindow,
          'bottom',
          join(evidenceDir, 'stage-d-bottom-target.png'),
          pathState,
        );
        layoutEvidence.nativeKeyboardGenerateFocus = await driveKeyboardAtMarker(
          mainWindow,
          'sequence-generate-tab',
          'Tab',
          pathState,
        );
        layoutEvidence.nativeKeyboardGenerateAction = await driveKeyboardAtMarker(
          mainWindow,
          'sequence-generate-space',
          'Space',
          pathState,
        );
        layoutEvidence.sequenceWide = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-wide',
          join(evidenceDir, 'stage-d-sequence-wide.png'),
          pathState,
        );
        layoutEvidence.sequenceShortWide = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-short-wide',
          join(evidenceDir, 'stage-d-sequence-short-wide.png'),
          pathState,
          {
            resizeTo: { width: 1020, height: 620, targetViewport: { width: 1008, height: 580 } },
          },
        );
        layoutEvidence.sequenceNarrowTop = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-narrow-top',
          join(evidenceDir, 'stage-d-sequence-narrow-top.png'),
          pathState,
          { resizeTo: { width: 800, height: 560, maxViewportWidth: 900 } },
        );
        layoutEvidence.nativeTouchScroll = await driveBoundedNativeTouchScrollsAtMarker(
          mainWindow,
          'sequence-narrow-touch-scroll',
          pathState,
        );
        layoutEvidence.nativeKeyboardNarrowAction = await driveKeyboardAtMarker(
          mainWindow,
          'sequence-narrow-tab-action',
          'Tab',
          pathState,
        );
        layoutEvidence.nativeKeyboardNarrowPlayback = await driveKeyboardAtMarker(
          mainWindow,
          'sequence-narrow-tab-playback',
          'Tab',
          pathState,
        );
        layoutEvidence.nativeKeyboardNarrowFrame = await driveKeyboardAtMarker(
          mainWindow,
          'sequence-narrow-tab-frame',
          'Tab',
          pathState,
        );
        layoutEvidence.sequenceNarrowScrolled = await captureScreenshotAtMarker(
          mainWindow,
          'sequence-narrow-scrolled',
          join(evidenceDir, 'stage-d-sequence-narrow-scrolled.png'),
          pathState,
          { restoreBoundsAfterCapture: normalWindowBounds },
        );
        layoutEvidence.receipt846x653Top = await captureScreenshotAtMarker(
          mainWindow,
          'receipt-846-top',
          join(evidenceDir, 'stage-d-receipt-846x653-top.png'),
          pathState,
          {
            resizeTo: {
              width: 859,
              height: 689,
              maxViewportWidth: 900,
              targetViewport: { width: 846, height: 653 },
            },
          },
        );
        layoutEvidence.receipt846x653TouchScroll = await driveTouchScrollAtMarker(
          mainWindow,
          'receipt-846-touch-scroll',
          pathState,
        );
        layoutEvidence.receipt846x653Scrolled = await captureScreenshotAtMarker(
          mainWindow,
          'receipt-846-scrolled',
          join(evidenceDir, 'stage-d-receipt-846x653-scrolled.png'),
          pathState,
        );
        layoutEvidence.receiptNarrowTop = await captureScreenshotAtMarker(
          mainWindow,
          'receipt-narrow-top',
          join(evidenceDir, 'stage-d-receipt-narrow-top.png'),
          pathState,
          { resizeTo: { width: 800, height: 560, maxViewportWidth: 850 } },
        );
        layoutEvidence.receiptNarrowTouchScroll = await driveTouchScrollAtMarker(
          mainWindow,
          'receipt-narrow-touch-scroll',
          pathState,
        );
        layoutEvidence.receiptNarrowScrolled = await captureScreenshotAtMarker(
          mainWindow,
          'receipt-narrow-scrolled',
          join(evidenceDir, 'stage-d-receipt-narrow-scrolled.png'),
          pathState,
        );
      }
    }
    response = await pathPromise;
    if (args.issue766FirstLoad) {
      stopIssue766MainHeartbeat();
      const firstLoad = response.issue766FirstLoad ?? { marks: [], rendererHeartbeat: [], catalogRoundTrips: [] };
      firstLoad.mainHeartbeat = summarizeIssue766MainHeartbeat(firstLoad.marks ?? []);
      firstLoad.catalogIpcEvents = mainProfileEvents.filter((event) => event.stage === 'issue766.catalog-ipc');
      firstLoad.catalogRequestCount = firstLoad.catalogIpcEvents
        .filter((event) => event.phase === 'complete' || event.phase === 'error').length;
      firstLoad.summary = summarizeIssue766FirstLoad(firstLoad);
      response.issue766FirstLoad = firstLoad;
    }
    if (layoutEvidence) {
      const displayScaleFactor = screen.getPrimaryDisplay().scaleFactor;
      layoutEvidence.displayScaleFactor = displayScaleFactor;
      layoutEvidence.native150Percent = Math.abs(displayScaleFactor - 1.5) < 0.01 ? 'PASS' : 'NOT RUN';
      response.layoutEvidence = layoutEvidence;
    }
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
      schemaVersion: args.issue766FirstLoad
        ? 'issue766-first-load/1'
        : args.issue762Profile
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
      ...(args.issue766FirstLoad ? { issue766FirstLoad: response?.issue766FirstLoad ?? null } : {}),
      parserPath: 'real Windows Electron Main + production Renderer UI -> V2-R catalog -> bounded v1.2 deletion-first R1/R2 workbench -> static preview/explicit ImageAsset commit',
      response: responseForReceipt,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(args.issue762Profile
      ? `${JSON.stringify({ outPath, source: receipt.source, scanMeasurement: receipt.scanMeasurement, project: receipt.project, issue766FirstLoad: receipt.issue766FirstLoad ?? null, profileSummary: receipt.profile.stageSummary })}\n`
      : `${JSON.stringify(receipt)}\n`);
    const expectedPersistedAssetCount = args.captureSequencePreviewBeforeRender ||
      args.measureScanOnly && !args.profileCommit ? 0 : 1;
    if (
      !receipt.source.hashInvariant || !response?.ok ||
      receipt.project.persistedAssetCount !== expectedPersistedAssetCount ||
      args.measureScanOnly && receipt.scanMeasurement?.status !== 'VERIFIED' ||
      args.profileCommit && receipt.project.reopenValidation?.status !== 'PASS'
    ) {
      process.exitCode = 1;
    }
  } catch (caught) {
    stopIssue766MainHeartbeat();
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
      schemaVersion: args.issue766FirstLoad
        ? 'issue766-first-load/1'
        : args.issue762Profile
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
      ...(args.issue766FirstLoad ? {
        issue766FirstLoad: (() => {
          const firstLoad = error.issue762RunState?.issue766FirstLoad ?? {
            marks: [],
            rendererHeartbeat: [],
            catalogRoundTrips: [],
          };
          firstLoad.mainHeartbeat = summarizeIssue766MainHeartbeat(firstLoad.marks ?? []);
          firstLoad.catalogIpcEvents = mainProfileEvents.filter((event) => event.stage === 'issue766.catalog-ipc');
          firstLoad.catalogRequestCount = firstLoad.catalogIpcEvents
            .filter((event) => event.phase === 'complete' || event.phase === 'error').length;
          firstLoad.summary = summarizeIssue766FirstLoad(firstLoad);
          return firstLoad;
        })(),
      } : {}),
      partialRun: error.issue762RunState ?? null,
      verifierCleanupError: error.verifierCleanupError ?? null,
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
