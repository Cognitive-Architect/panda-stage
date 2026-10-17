#!/usr/bin/env node
/**
 * Issue #767 U2 real Windows/Electron candidate-directory acceptance.
 *
 * Drives the normal Asset Library FLA action and the unified workbench. All
 * projects, generated control FLA files, and the Electron profile stay under
 * the supplied acceptance root. Only bounded receipts and review screenshots
 * are written into the repository evidence directory. No import is committed.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const { basename, join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue767-u2';
const DEFAULT_SOURCE_ROOT = 'D:\\表情合集\\新人物';
const CATALOG_CHANNEL = 'fla:snapshot-catalog';
const PREVIEW_CHANNEL = 'fla:snapshot-preview';
const BLUEHAIR_TARGET = '神女-cilisucai.com/神女-cilisucai.com809';
const BLUEHAIR_TARGET_ID = 'fla-render-target-71289be86ab338b9c728b476f628b5708ec035560586326cc48e6af8eacfe8dd';
const BLUEHAIR_PREVIEW_SHA256 = 'd9e423464791a179de7766c7eb9b5aec0845bf0b64bd898c749f0f0dd8a25ed5';
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

const mainHeartbeat = { samples: [], timer: null, lastAt: null };
const catalogEvents = [];
const inspectionEvents = [];
const mainProfileEvents = [];
const rendererConsoleErrors = [];
const runtime = {
  runId: new Date().toISOString().replace(/[:.]/gu, '-'),
  acceptanceRoot: null,
  runRoot: null,
  evidenceDir: null,
  userData: null,
  projectParent: null,
  project: null,
  projectInitial: null,
  repositoryRoot: resolve(__dirname, '..'),
  repoEvidenceRoot: null,
  repoEvidenceDir: null,
  sourcePaths: {},
  sourceHashesBefore: {},
  scenarios: [],
  assertions: {},
  respondingSamples: [],
  respondingProcess: null,
  delayNextPreviewResponse: false,
  delayedPreviewResponses: [],
  error: null,
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--sources-root') args.sourcesRoot = argv[++index];
  }
  return args;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const result = Buffer.allocUnsafe(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(payload), 8 + data.length);
  return result;
}

function createPng(color) {
  const width = 4;
  const height = 4;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3] ?? 255;
    }
  }
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildVectorFrames() {
  return Array.from({ length: 3 }, (_, frameIndex) => `
            <DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${20 + frameIndex * 2}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills><FillStyle index="1"><SolidColor color="#4d82c4" alpha="1"/></FillStyle></fills>
                    <strokes/>
                    <edges><Edge fillStyle1="1" cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('');
}

async function writeBitmapOnlyFla(filePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="320" height="240" frameRate="24">
  <media>
    <DOMBitmapItem name="issue767-duplicate-a.png" href="issue767-duplicate-a.png" frameRight="80" frameBottom="80"/>
    <DOMBitmapItem name="issue767-duplicate-b.png" href="issue767-duplicate-b.png" frameRight="80" frameBottom="80"/>
  </media>
  <timelines>
    <DOMTimeline name="issue767-bitmap-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  const identicalImage = createPng([220, 80, 80]);
  zip.file('LIBRARY/issue767-duplicate-a.png', identicalImage);
  zip.file('LIBRARY/issue767-duplicate-b.png', identicalImage);
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function writeVectorOnlyFla(filePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="issue767-vector-scene">
      <layers><DOMLayer name="scene-layer"><frames>${buildVectorFrames()}</frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function writeUnsupportedFla(filePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="issue767-unsupported-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="issue767-unsupported-symbol"><matrix a="1" d="1" tx="0" ty="0"/></DOMSymbolInstance>
      </elements></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  zip.file('LIBRARY/issue767-unsupported-symbol.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="issue767-unsupported-symbol" symbolType="graphic">
  <timeline><DOMTimeline name="unsupported-timeline"><layers><DOMLayer name="symbol-layer"><frames>
    <DOMFrame index="0"><elements>
      <DOMBitmapInstance libraryItemName="missing-library-bitmap.png"><matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix></DOMBitmapInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`);
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function findSample(sourceRoot, fileName) {
  const exactPath = join(sourceRoot, fileName);
  if (existsSync(exactPath)) return exactPath;
  const normalizedName = fileName.normalize('NFC');
  const found = readdirSync(sourceRoot).find((name) => name.normalize('NFC') === normalizedName);
  if (!found) throw new Error(`Required real FLA sample was not found: ${fileName}`);
  return join(sourceRoot, found);
}

function catalogEntryFacts(entry) {
  return {
    renderTargetId: entry.target.renderTargetId,
    targetKind: entry.target.kind,
    userLabel: entry.target.userLabel,
    sourceLibraryItemName: entry.target.sourceLibraryItemName ?? null,
    sourceTimelineIndex: entry.target.sourceTimelineIndex ?? null,
    frameCount: entry.target.frameCount,
    selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
    catalogRole: entry.catalogRole ?? null,
    previewSupported: entry.previewSupported,
    isBlank: entry.isBlank,
    unsupportedReason: entry.unsupportedReason ?? null,
  };
}

function installMainProbes() {
  globalThis.__pandaStageIssue762ProfileSink = (event) => {
    if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) return;
    mainProfileEvents.push({
      ...event,
      realm: 'electron-main',
      wallTimeMs: Date.now(),
      atMs: performance.now(),
    });
  };
  mainHeartbeat.lastAt = performance.now();
  mainHeartbeat.timer = setInterval(() => {
    const atMs = performance.now();
    const priorAt = mainHeartbeat.lastAt;
    mainHeartbeat.lastAt = atMs;
    mainHeartbeat.samples.push({
      atMs,
      wallTimeMs: Date.now(),
      gapMs: priorAt === null ? null : atMs - priorAt,
      rssBytes: process.memoryUsage().rss,
      cpu: process.cpuUsage(),
    });
  }, 100);

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (channel === PREVIEW_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        if (runtime.delayNextPreviewResponse && request?.target?.renderTargetId !== BLUEHAIR_TARGET_ID) {
          runtime.delayNextPreviewResponse = false;
          const delayed = {
            phase: 'started',
            requestId: request?.requestId ?? null,
            renderTargetId: request?.target?.renderTargetId ?? null,
            startedAtWallTimeMs: Date.now(),
          };
          runtime.delayedPreviewResponses.push(delayed);
          await delay(900);
          runtime.delayedPreviewResponses.push({
            ...delayed,
            phase: 'settled',
            completedAtWallTimeMs: Date.now(),
            delayMs: Date.now() - delayed.startedAtWallTimeMs,
          });
        }
        return response;
      });
    }
    if (channel !== CATALOG_CHANNEL) return originalHandle(channel, handler);
    return originalHandle(channel, async (event, request, ...rest) => {
      const invocation = catalogEvents.filter((item) => item.phase === 'start').length + 1;
      const common = {
        invocation,
        sessionId: typeof request?.sessionId === 'string' ? request.sessionId : null,
        includeAuthoredStates: request?.includeAuthoredStates === true,
        startedAtWallTimeMs: Date.now(),
      };
      catalogEvents.push({ ...common, phase: 'start' });
      const startedAt = performance.now();
      try {
        const response = await handler(event, request, ...rest);
        const result = {
          ...common,
          phase: 'complete',
          completedAtWallTimeMs: Date.now(),
          durationMs: performance.now() - startedAt,
          outcome: response?.ok === true ? 'success' : response?.error?.code ?? 'unknown',
          candidateCount: response?.ok === true ? response.entries?.length ?? 0 : 0,
          omittedCandidateCount: response?.ok === true ? response.omittedCandidateCount ?? 0 : null,
          summary: response?.ok === true ? response.summary : null,
          entries: response?.ok === true ? (response.entries ?? []).map(catalogEntryFacts) : [],
        };
        catalogEvents.push(result);
        return response;
      } catch (error) {
        catalogEvents.push({
          ...common,
          phase: 'error',
          completedAtWallTimeMs: Date.now(),
          durationMs: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  };

  const servicePath = join(__dirname, '..', 'dist-electron', 'main', 'services', 'FlaImportService.js');
  const { FlaImportService } = require(servicePath);
  const originalInspect = FlaImportService.prototype.inspectSource;
  FlaImportService.prototype.inspectSource = async function countInspection(sourcePath, requestId) {
    const startedAtWallTimeMs = Date.now();
    const record = { sourceBasename: basename(sourcePath), startedAtWallTimeMs };
    inspectionEvents.push(record);
    const response = await originalInspect.call(this, sourcePath, requestId);
    record.completedAtWallTimeMs = Date.now();
    record.sessionId = response?.ok ? response.sessionId : null;
    record.outcome = response?.ok ? 'success' : response?.error?.code ?? 'unknown';
    return response;
  };
}

function startRespondingSampler() {
  const command = '$targetId = ' + process.pid + '; while ($true) { try { $p = Get-Process -Id $targetId -ErrorAction Stop; [Console]::Out.WriteLine([string]$p.Responding) } catch { [Console]::Out.WriteLine("missing") }; Start-Sleep -Milliseconds 250 }';
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  runtime.respondingProcess = child;
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const value = line.trim().toLocaleLowerCase('en-US');
      if (value === 'true' || value === 'false') {
        runtime.respondingSamples.push({ wallTimeMs: Date.now(), responding: value === 'true' });
      }
    }
  });
}

function stopRespondingSampler() {
  if (runtime.respondingProcess) {
    runtime.respondingProcess.kill();
    runtime.respondingProcess = null;
  }
}

async function waitForMainWindow() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect)',
        );
        if (ready) return window;
      } catch {
        // The built renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the production Project and FLA APIs.');
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression);
}

async function waitForExpression(window, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(window, expression)) return;
    } catch {
      // Continue while React, IPC, and the hidden render window settle.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for UI expression: ${expression}`);
}

async function click(window, selector) {
  await evaluate(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + ${JSON.stringify(selector)});
    if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Clickable element is disabled ' + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`);
  await delay(60);
}

async function setInput(window, selector, value) {
  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    input.focus();
    input.select();
    return true;
  })()`);
  try {
    await window.webContents.insertText(String(value));
  } catch {
    await evaluate(window, `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Input value setter is unavailable');
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(String(value))} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return true;
    })()`);
  }
  await delay(100);
}

async function ensureProjectCenter(window) {
  if (await evaluate(window, `Boolean(document.querySelector('[data-testid="new-project-button"]'))`)) return;
  await click(window, '[data-testid="compact-project-more"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="menu-open-project-center"]'))`);
  await click(window, '[data-testid="menu-open-project-center"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-button"]'))`);
}

async function createProject(window) {
  await ensureProjectCenter(window);
  await click(window, '[data-testid="new-project-button"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-dialog"]'))`);
  const projectName = `Issue767 U2 ${runtime.runId}`;
  await setInput(window, '[data-testid="new-project-parent-directory"]', runtime.projectParent);
  await setInput(window, '[data-testid="new-project-name"]', projectName);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-confirm"]') && !document.querySelector('[data-testid="new-project-confirm"]').disabled)`);
  await click(window, '[data-testid="new-project-confirm"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="editor-layout"]'))`);
  await waitForExpression(window, `Boolean(document.querySelector('[data-activity="assets"]'))`);
  await click(window, '[data-activity="assets"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  return {
    projectName,
    projectRoot: join(runtime.projectParent, `${projectName}.pandastage`),
  };
}

function readProjectState(projectRoot) {
  const json = readFileSync(join(projectRoot, 'project.json'), 'utf8');
  const project = JSON.parse(json);
  return {
    jsonSha256: sha256(Buffer.from(json, 'utf8')),
    assetCount: Array.isArray(project.assets) ? project.assets.length : null,
    revision: project.revision ?? null,
  };
}

async function setupRendererProbe(window) {
  await evaluate(window, `(() => {
    const probe = window.__issue767U2Probe = { marks: [], heartbeats: [], profileEvents: [], seen: new Set(), observedImages: new WeakSet() };
    const mark = (name, details = {}) => {
      if (probe.seen.has(name)) return;
      probe.seen.add(name);
      probe.marks.push({ name, atMs: performance.now(), wallTimeMs: Date.now(), details });
    };
    window.__pandaStageIssue762ProfileSink = (event) => {
      if (!event || typeof event.stage !== 'string' || !Number.isFinite(event.durationMs)) return;
      probe.profileEvents.push({ ...event, realm: 'renderer', atMs: performance.now(), wallTimeMs: Date.now() });
    };
    let lastAt = performance.now();
    probe.timer = window.setInterval(() => {
      const now = performance.now();
      probe.heartbeats.push({ atMs: now, wallTimeMs: Date.now(), gapMs: now - lastAt });
      lastAt = now;
    }, 100);
    const inspect = () => {
      const review = document.querySelector('[data-testid="fla-snapshot-review"]');
      if (review) mark('first-catalog-review-dom', { state: review.getAttribute('data-preview-state') });
      const rows = document.querySelectorAll('[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row');
      if (rows.length > 0) mark('first-candidate-list-visible', { rowCount: rows.length });
      document.querySelectorAll('[data-testid="fla-snapshot-targets"] img').forEach((image) => {
        if (probe.observedImages.has(image)) return;
        probe.observedImages.add(image);
        const loaded = () => {
          if (image.naturalWidth > 0) mark('first-candidate-thumbnail-visible', {
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          });
        };
        image.addEventListener('load', loaded, { once: true });
        if (image.complete) loaded();
      });
      const full = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
      if (full instanceof HTMLImageElement) {
        const loaded = () => {
          if (full.naturalWidth > 0) mark('first-focused-preview-visible', {
            naturalWidth: full.naturalWidth,
            naturalHeight: full.naturalHeight,
            renderTargetId: full.getAttribute('data-render-target-id'),
            sourceLibraryItemName: full.getAttribute('data-source-library-item-name'),
            selectedFrameIndex: Number(full.getAttribute('data-source-frame-index') ?? 0),
          });
        };
        if (!probe.observedImages.has(full)) {
          probe.observedImages.add(full);
          full.addEventListener('load', loaded, { once: true });
        }
        if (full.complete) loaded();
      }
    };
    probe.observer = new MutationObserver(inspect);
    probe.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-preview-state', 'src'],
      childList: true,
      characterData: true,
      subtree: true,
    });
    probe.inspect = inspect;
  probe.begin = (name) => {
    probe.marks = [];
    probe.seen.clear();
    probe.currentStartName = name;
    probe.currentStartWallTimeMs = Date.now();
    mark(name);
      inspect();
    };
    return true;
  })()`);
}

async function triggerFlaReview(window, sourcePath, sourceName) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  await waitForExpression(window, `(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
    return Boolean((direct instanceof HTMLButtonElement && !direct.disabled) || (resource instanceof HTMLButtonElement && !resource.disabled));
  })()`);
  const selector = await evaluate(window, `(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    return direct instanceof HTMLButtonElement && !direct.disabled
      ? '[data-testid="asset-import-fla"]'
      : '[data-testid="resource-asset-import-fla"]';
  })()`);
  await evaluate(window, `window.__issue767U2Probe?.begin(${JSON.stringify(`${sourceName}-workbench-open`)});`);
  const startedAtWallTimeMs = Date.now();
  await click(window, selector);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-review-session"]') && document.querySelector('[data-testid="fla-import-workbench-tabs"]'))`, 180_000);
  return {
    startedAtWallTimeMs,
    workbenchReadyAtWallTimeMs: Date.now(),
    inspectEventsBefore: inspectionEvents.length - 1,
    catalogEventsBefore: catalogEvents.length,
  };
}

async function readWorkbenchFacts(window, sourcePath) {
  return evaluate(window, `(() => {
    const root = document.querySelector('[data-testid="fla-review-session"]');
    const tabs = [...(root?.querySelectorAll('[data-testid="fla-import-workbench-tabs"] [role="tab"]') ?? [])];
    const selectedTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const sourcePanel = document.querySelector('#fla-source-assets-panel');
    const compositionPanel = document.querySelector('#fla-composition-panel');
    const sourceCards = [...(sourcePanel?.querySelectorAll('[data-fla-media-id]') ?? [])];
    const sourceChecks = [...(sourcePanel?.querySelectorAll('input[type="checkbox"]') ?? [])];
    const mediaCountText = document.querySelector('[data-testid="fla-review-media-count"]')?.textContent?.trim() ?? '';
    const selectedText = document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() ?? '';
    return {
      sourceBasename: ${JSON.stringify(basename(sourcePath))},
      title: root?.querySelector('[data-testid="fla-review-header"] h2')?.textContent?.trim() ?? '',
      tabCount: tabs.length,
      selectedTabTestId: selectedTab?.getAttribute('data-testid') ?? '',
      sourceAssetsTabDisabled: document.querySelector('[data-testid="fla-workbench-tab-source-assets"]')?.disabled ?? true,
      sourcePanelVisible: Boolean(sourcePanel && !sourcePanel.hidden),
      compositionPanelVisible: Boolean(compositionPanel && !compositionPanel.hidden),
      sourceBitmapCountText: mediaCountText,
      sourceBitmapCount: Number(mediaCountText.match(/[0-9]+/u)?.[0] ?? 0),
      sourceGridImageCount: sourcePanel?.querySelectorAll('[data-testid="fla-review-media-grid"] img').length ?? 0,
      sourceGridLoadedImageCount: [...(sourcePanel?.querySelectorAll('[data-testid="fla-review-media-grid"] img') ?? [])]
        .filter((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length,
      initiallySelectedSourceItems: sourceChecks.filter((input) => input.checked).length,
      sourceMediaIds: sourceCards.map((card) => card.getAttribute('data-fla-media-id')),
      selectedCountText: selectedText,
      selectedCount: selectedText ? Number(selectedText.match(/[0-9]+/u)?.[0] ?? 0) : null,
      compositionSelected: selectedTab?.getAttribute('data-testid') === 'fla-workbench-tab-compositions',
      outerImportCount: root?.querySelectorAll('[data-testid="fla-review-commit-success"]').length ?? 0,
    };
  })()`);
}

async function selectCompositions(window) {
  const selected = await evaluate(window, `document.querySelector('[data-testid="fla-workbench-tab-compositions"]')?.getAttribute('aria-selected') === 'true'`);
  if (!selected) await click(window, '[data-testid="fla-workbench-tab-compositions"]');
  await waitForExpression(window, `Boolean(document.querySelector('#fla-composition-panel') && !document.querySelector('#fla-composition-panel').hidden && document.querySelector('[data-testid="fla-render-workbench"]'))`, 90_000);
}

async function waitForCatalogSettledAfter(index, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const complete = catalogEvents.slice(index).find((event) => event.phase === 'complete' || event.phase === 'error');
    if (complete) return complete;
    await delay(100);
  }
  throw new Error('Timed out waiting for the production catalog IPC response.');
}

async function waitForCatalogAfter(index, timeoutMs = 900_000) {
  const complete = await waitForCatalogSettledAfter(index, timeoutMs);
  if (complete.phase === 'error' || complete.outcome !== 'success') {
    throw new Error(`Catalog request failed: ${complete.error ?? complete.outcome}`);
  }
  return complete;
}

async function waitForCatalogStartAfter(index, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const started = catalogEvents.slice(index).find((event) => event.phase === 'start');
    if (started) return started;
    await delay(25);
  }
  throw new Error('Timed out waiting for the production catalog IPC request to start.');
}

async function waitForCatalogUiReady(window, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(window, `(() => {
      const empty = document.querySelector('[data-testid="fla-snapshot-empty"]');
      const review = document.querySelector('[data-testid="fla-snapshot-review"]');
      const error = document.querySelector('[data-testid="fla-snapshot-error"]');
      return {
        empty: Boolean(empty),
        ready: Boolean(review && review.getAttribute('data-preview-state') === 'ready'),
        rendering: Boolean(review && review.getAttribute('data-preview-state') === 'rendering'),
        error: error?.textContent?.trim() ?? '',
      };
    })()`);
    if (state.error) throw new Error(`Catalog UI failed closed: ${state.error}`);
    if (state.empty || state.ready) return state;
    await delay(150);
  }
  throw new Error('Timed out waiting for candidate preview scanning to finish.');
}

async function readCatalogUi(window) {
  return evaluate(window, `(() => {
    const rows = [...document.querySelectorAll('[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row')];
    const focused = rows.find((row) => row.getAttribute('data-focused') === 'true') ?? null;
    const full = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    const root = document.querySelector('[data-testid="fla-snapshot-review"]');
    const details = document.querySelector('[data-testid="fla-snapshot-details-region"]');
    const targetFact = [...(details?.querySelectorAll('dl.fla-snapshot-detail-more > div') ?? [])]
      .find((fact) => fact.querySelector('dt')?.textContent?.trim() === '目标标识');
    const summary = document.querySelector('[data-testid="fla-snapshot-candidate-summary"]');
    const selectedFact = [...(summary?.querySelectorAll(':scope > div') ?? [])]
      .find((fact) => fact.querySelector('dt')?.textContent?.trim() === '已选择');
    const reason = document.querySelector('[data-testid="fla-stage-f2-more-details"] p')?.textContent?.trim()
      ?? document.querySelector('[data-testid="fla-snapshot-preview-placeholder"] span')?.textContent?.trim()
      ?? document.querySelector('[data-testid="fla-snapshot-details"]')?.textContent?.trim()
      ?? '';
    return {
      previewState: root?.getAttribute('data-preview-state') ?? null,
      rows: rows.map((row) => ({
        renderTargetId: row.getAttribute('data-render-target-id'),
        sourceLibraryItemName: row.getAttribute('data-source-library-item-name'),
        selectedFrameIndex: Number(row.getAttribute('data-source-frame-index') ?? 0),
        catalogRole: row.getAttribute('data-catalog-role'),
        catalogPreviewSupported: row.getAttribute('data-catalog-preview-supported') === 'true',
        isBlank: row.getAttribute('data-is-blank') === 'true',
        selectable: row.getAttribute('data-preview-supported') === 'true',
        focused: row.getAttribute('data-focused') === 'true',
        selected: row.querySelector('input[type="checkbox"]')?.checked ?? false,
        label: row.querySelector('.fla-snapshot-candidate-copy strong')?.textContent?.trim() ?? '',
        kindLabel: row.querySelector('.fla-snapshot-candidate-copy small')?.textContent?.trim() ?? '',
        status: row.querySelector('.fla-snapshot-candidate-status')?.textContent?.trim() ?? '',
        thumbnailSrc: row.querySelector('img')?.getAttribute('src') ?? null,
        thumbnailWidth: row.querySelector('img') instanceof HTMLImageElement ? row.querySelector('img').naturalWidth : 0,
        thumbnailHeight: row.querySelector('img') instanceof HTMLImageElement ? row.querySelector('img').naturalHeight : 0,
      })),
      fullPreview: full instanceof HTMLImageElement ? {
        renderTargetId: full.getAttribute('data-render-target-id'),
        sourceLibraryItemName: full.getAttribute('data-source-library-item-name'),
        selectedFrameIndex: Number(full.getAttribute('data-source-frame-index') ?? 0),
        catalogRole: full.getAttribute('data-catalog-role'),
        resolution: full.getAttribute('data-preview-resolution'),
        generatedWidth: Number(full.getAttribute('data-preview-width')),
        generatedHeight: Number(full.getAttribute('data-preview-height')),
        naturalWidth: full.naturalWidth,
        naturalHeight: full.naturalHeight,
        src: full.getAttribute('src'),
      } : null,
      focusedCandidate: focused ? {
        renderTargetId: focused.getAttribute('data-render-target-id'),
        sourceLibraryItemName: focused.getAttribute('data-source-library-item-name'),
        selectedFrameIndex: Number(focused.getAttribute('data-source-frame-index') ?? 0),
        catalogRole: focused.getAttribute('data-catalog-role'),
      } : null,
      detailsTargetId: targetFact?.querySelector('dd')?.textContent?.trim() ?? null,
      previewPlaceholder: document.querySelector('[data-testid="fla-snapshot-preview-placeholder"]')?.textContent?.trim() ?? null,
      selectedTotal: Number(selectedFact?.querySelector('dd')?.textContent?.trim() ?? 0),
      actionState: document.querySelector('[data-testid="fla-snapshot-action-state"]')?.textContent?.trim() ?? '',
      selectedCandidateCount: rows.filter((row) => row.querySelector('input[type="checkbox"]')?.checked).length,
      targetCountText: document.querySelector('[data-testid="fla-snapshot-target-count"]')?.textContent?.trim() ?? '',
      omittedWarning: document.querySelector('[data-testid="fla-snapshot-catalog-limit"]')?.textContent?.trim() ?? '',
      summary: document.querySelector('[data-testid="fla-snapshot-catalog-summary"]')?.textContent?.trim() ?? '',
      visibleReason: reason,
      visibleFilter: document.querySelector('[data-testid="fla-snapshot-filter-all"]')?.getAttribute('aria-pressed') === 'true'
        ? 'all'
        : document.querySelector('[data-testid="fla-snapshot-filter-compositions"]')?.getAttribute('aria-pressed') === 'true'
          ? 'compositions'
          : document.querySelector('[data-testid="fla-snapshot-filter-graphic-states"]')?.getAttribute('aria-pressed') === 'true'
            ? 'graphic-states'
            : null,
    };
  })()`);
}

async function assertFocusedPreviewMatchesVisibleCandidate(window, expectedRole = null) {
  const ui = await readCatalogUi(window);
  const focused = ui.focusedCandidate;
  assert(
    !focused || ui.rows.some((row) => row.renderTargetId === focused.renderTargetId),
    'The focused candidate is not present in the filtered visible list.',
  );
  assert(
    ui.detailsTargetId === (focused?.renderTargetId ?? null),
    'Focused candidate details do not match the visible focus, or stale details remain without a focus.',
  );
  assert(
    !ui.fullPreview || ui.fullPreview.renderTargetId === focused?.renderTargetId,
    'The full preview does not match the visible focused candidate.',
  );
  if (expectedRole && focused) {
    assert(focused.catalogRole === expectedRole, `Expected ${expectedRole} focus, got ${focused.catalogRole}.`);
  }
  return ui;
}

async function waitForFocusedPreview(window, expectedTargetId) {
  await waitForExpression(window, `(() => {
    const row = [...document.querySelectorAll('[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row')]
      .find((candidate) => candidate.getAttribute('data-focused') === 'true');
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    return row?.getAttribute('data-render-target-id') === ${JSON.stringify(expectedTargetId)} &&
      image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 &&
      image.getAttribute('data-render-target-id') === ${JSON.stringify(expectedTargetId)};
  })()`, 180_000);
}

async function waitForDelayedPreviewResponseStart(afterCount, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const delayed = runtime.delayedPreviewResponses.slice(afterCount)
      .find((event) => event.phase === 'started');
    if (delayed) return delayed;
    await delay(20);
  }
  throw new Error('Timed out waiting for the deliberately delayed focused preview response.');
}

async function testCandidateFilters(window) {
  await click(window, `[data-render-target-id="${BLUEHAIR_TARGET_ID}"] input[type="checkbox"]`);
  const selectedBeforeFiltering = await readCatalogUi(window);
  assert(selectedBeforeFiltering.selectedTotal === 1, 'Selecting the known composition did not update the full selection count.');

  const delayedPreviewCount = runtime.delayedPreviewResponses.length;
  runtime.delayNextPreviewResponse = true;
  await click(window, '[data-testid="fla-snapshot-filter-graphic-states"]');
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-filter-graphic-states"]')?.getAttribute('aria-pressed') === 'true'`);
  const graphicUi = await assertFocusedPreviewMatchesVisibleCandidate(window, 'graphic-state');
  const graphicStateRows = graphicUi.rows.map((row) => row.catalogRole);
  const firstSupportedGraphic = graphicUi.rows.find((row) => row.selectable);
  assert(firstSupportedGraphic && graphicUi.focusedCandidate?.renderTargetId === firstSupportedGraphic.renderTargetId, 'Graphic-state filtering did not focus the first supported visible candidate.');
  assert(graphicUi.selectedTotal === 1 && graphicUi.actionState === '1 项已选', 'Filtering changed the hidden composition selection or its confirmation count.');
  assert(!graphicUi.rows.some((row) => row.renderTargetId === BLUEHAIR_TARGET_ID), 'The selected composition remained visible under the graphic-state filter.');
  const delayedGraphicResponse = await waitForDelayedPreviewResponseStart(delayedPreviewCount);
  assert(delayedGraphicResponse.renderTargetId === graphicUi.focusedCandidate.renderTargetId, 'The delayed response did not belong to the newly focused graphic state.');

  await click(window, '[data-testid="fla-snapshot-filter-compositions"]');
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-filter-compositions"]')?.getAttribute('aria-pressed') === 'true'`);
  const compositionUi = await assertFocusedPreviewMatchesVisibleCandidate(window);
  const compositionRows = compositionUi.rows.map((row) => row.catalogRole);
  const firstSupportedComposition = compositionUi.rows.find((row) => row.selectable);
  assert(firstSupportedComposition && compositionUi.focusedCandidate?.renderTargetId === firstSupportedComposition.renderTargetId, 'Composition filtering did not focus the first supported visible candidate.');
  await waitForFocusedPreview(window, compositionUi.focusedCandidate.renderTargetId);
  const compositionPreview = await assertFocusedPreviewMatchesVisibleCandidate(window);
  const delayedGraphicResponseSettled = runtime.delayedPreviewResponses.slice(delayedPreviewCount)
    .find((event) => event.phase === 'settled');
  assert(delayedGraphicResponseSettled, 'The deliberately delayed old preview response did not settle.');
  assert(compositionPreview.fullPreview?.renderTargetId === compositionPreview.focusedCandidate?.renderTargetId, 'A late old response replaced the newest focused composition preview.');

  await click(window, '[data-testid="fla-snapshot-filter-all"]');
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-filter-all"]')?.getAttribute('aria-pressed') === 'true'`);
  const allUi = await assertFocusedPreviewMatchesVisibleCandidate(window);
  assert(allUi.focusedCandidate?.renderTargetId === compositionPreview.focusedCandidate?.renderTargetId, 'Returning to all candidates changed a still-visible focus.');
  assert(allUi.fullPreview?.src === compositionPreview.fullPreview?.src, 'Returning to all candidates unnecessarily reloaded a still-visible preview.');
  assert(allUi.selectedTotal === 1 && allUi.rows.find((row) => row.renderTargetId === BLUEHAIR_TARGET_ID)?.selected, 'Filtering changed the selected composition or its checked state.');

  await click(window, `[data-render-target-id="${BLUEHAIR_TARGET_ID}"] input[type="checkbox"]`);
  const deselected = await readCatalogUi(window);
  assert(deselected.selectedTotal === 0, 'The filter regression scenario did not restore the initial empty selection.');

  const searchSelector = '[data-testid="fla-snapshot-target-search"]';
  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(searchSelector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing candidate search input.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'issue-772-no-match');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-target-search"]')?.value === 'issue-772-no-match'`);
  const noMatches = await assertFocusedPreviewMatchesVisibleCandidate(window);
  assert(noMatches.rows.length === 0 && noMatches.focusedCandidate === null && noMatches.fullPreview === null, 'A zero-result search retained a stale focus, preview, or candidate row.');
  assert(noMatches.previewPlaceholder?.includes('当前筛选无可预览素材'), 'A zero-result search did not show the explicit empty preview state.');

  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(searchSelector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing candidate search input.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-target-search"]')?.value === ''`);
  const searchRestored = await assertFocusedPreviewMatchesVisibleCandidate(window);
  assert(searchRestored.focusedCandidate?.renderTargetId === BLUEHAIR_TARGET_ID, 'Clearing search did not restore the deterministic first supported candidate.');
  await waitForFocusedPreview(window, BLUEHAIR_TARGET_ID);
  const restoredPreview = await assertFocusedPreviewMatchesVisibleCandidate(window);

  return {
    graphicStatesOnly: graphicStateRows.length === 0 || graphicStateRows.every((role) => role === 'graphic-state'),
    compositionsOnly: compositionRows.every((role) => role === 'scene' || role === 'scene-referenced-graphic'),
    allRestored: allUi.visibleFilter === 'all',
    graphicStateRowCount: graphicStateRows.length,
    compositionRowCount: compositionRows.length,
    graphicFocus: graphicUi.focusedCandidate,
    compositionFocus: compositionPreview.focusedCandidate,
    focusPreservedWhenVisible: allUi.focusedCandidate?.renderTargetId === compositionPreview.focusedCandidate?.renderTargetId,
    hiddenSelectionPreserved: deselected.selectedTotal === 0 && allUi.selectedTotal === 1,
    searchZeroResultsClearedPreview: noMatches.focusedCandidate === null && noMatches.fullPreview === null,
    searchClearRestoredPreview: restoredPreview.fullPreview?.renderTargetId === BLUEHAIR_TARGET_ID,
    latePreviewResponseIgnored: delayedGraphicResponseSettled.renderTargetId === graphicUi.focusedCandidate.renderTargetId &&
      compositionPreview.fullPreview?.renderTargetId === compositionPreview.focusedCandidate?.renderTargetId,
    delayedPreviewResponseMs: delayedGraphicResponseSettled.delayMs,
  };
}

async function capture(window, outputPath) {
  await delay(200);
  const image = await window.capturePage();
  writeFileSync(outputPath, image.toPNG());
  const size = image.getSize();
  return { path: outputPath, width: size.width, height: size.height, sha256: sha256(image.toPNG()) };
}

async function readFullPreviewBytes(window) {
  const base64 = await evaluate(window, `(() => {
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0 || !image.src) return null;
    return fetch(image.src).then(async (response) => {
      if (!response.ok) throw new Error('Unable to read the full preview image bytes');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
      }
      return btoa(binary);
    });
  })()`);
  return base64 ? Buffer.from(base64, 'base64') : null;
}

async function startCatalogFromComposition(window, priorCatalogEventCount = catalogEvents.length) {
  const alreadyStarted = catalogEvents.slice(priorCatalogEventCount).find((event) => event.phase === 'start');
  const requestedAtWallTimeMs = alreadyStarted?.startedAtWallTimeMs ?? Date.now();
  await evaluate(window, `window.__issue767U2Probe?.begin('composition-catalog-request')`);
  await selectCompositions(window);
  const response = await waitForCatalogAfter(priorCatalogEventCount);
  const readyState = await waitForCatalogUiReady(window);
  const ui = await readCatalogUi(window);
  const responseAtWallTimeMs = response.completedAtWallTimeMs;
  const firstPreviewMark = await evaluate(window, `window.__issue767U2Probe?.marks.find((mark) => mark.name === 'first-focused-preview-visible') ?? null`);
  const scanProfile = await evaluate(window, `window.__issue767U2Probe?.profileEvents ?? []`);
  const rendererHeartbeat = await evaluate(window, `window.__issue767U2Probe?.heartbeats ?? []`);
  const marks = await evaluate(window, `window.__issue767U2Probe?.marks ?? []`);
  const firstPreviewWallTimeMs = firstPreviewMark?.wallTimeMs ?? null;
  const mainSamples = mainHeartbeat.samples.filter((sample) =>
    sample.wallTimeMs >= requestedAtWallTimeMs &&
    (firstPreviewWallTimeMs === null || sample.wallTimeMs <= firstPreviewWallTimeMs),
  );
  const rendererSamples = rendererHeartbeat.filter((sample) =>
    sample.wallTimeMs >= requestedAtWallTimeMs &&
    (firstPreviewWallTimeMs === null || sample.wallTimeMs <= firstPreviewWallTimeMs),
  );
  const osSamples = runtime.respondingSamples.filter((sample) =>
    sample.wallTimeMs >= requestedAtWallTimeMs &&
    (firstPreviewWallTimeMs === null || sample.wallTimeMs <= firstPreviewWallTimeMs),
  );
  const maxGap = (samples) => samples.length > 0
    ? Math.max(...samples.map((sample) => sample.gapMs).filter(Number.isFinite))
    : null;
  const uniqueTargetIds = new Set(response.entries.map((entry) => entry.renderTargetId)).size;
  assert(response.includeAuthoredStates, 'The normal UI catalog request did not set includeAuthoredStates=true.');
  assert(response.candidateCount === response.entries.length, 'Catalog candidate count did not match its returned entries.');
  assert(response.candidateCount <= 64, 'Catalog exceeded the 64 render-target limit.');
  assert(uniqueTargetIds === response.entries.length, 'The catalog returned duplicate render-target IDs.');
  assert(ui.rows.length === response.entries.length, 'The visible candidate directory lost or duplicated catalog entries.');

  return {
    requestWallTimeMs: requestedAtWallTimeMs,
    catalogResponseWallTimeMs: responseAtWallTimeMs,
    catalogDurationMs: response.durationMs,
    catalogRequest: {
      invocation: response.invocation,
      sessionId: response.sessionId,
      includeAuthoredStates: response.includeAuthoredStates,
      candidateCount: response.candidateCount,
      omittedCandidateCount: response.omittedCandidateCount,
      summary: response.summary,
      entries: response.entries,
    },
    readyState,
    ui,
    filterFacts: null,
    firstPreview: firstPreviewMark,
    timingsMs: {
      clickToCatalog: responseAtWallTimeMs - requestedAtWallTimeMs,
      clickToFirstPreview: firstPreviewWallTimeMs === null ? null : firstPreviewWallTimeMs - requestedAtWallTimeMs,
      clickToReady: Date.now() - requestedAtWallTimeMs,
    },
    responsiveness: {
      mainHeartbeatSampleCount: mainSamples.length,
      mainHeartbeatMaxGapMs: maxGap(mainSamples),
      rendererHeartbeatSampleCount: rendererSamples.length,
      rendererHeartbeatMaxGapMs: maxGap(rendererSamples),
      windowsRespondingSampleCount: osSamples.length,
      windowsNotRespondingSampleCount: osSamples.filter((sample) => !sample.responding).length,
    },
    profileEvents: scanProfile.filter((event) =>
      event.wallTimeMs >= requestedAtWallTimeMs && event.wallTimeMs <= Date.now(),
    ),
    rendererMarks: marks.filter((mark) => mark.wallTimeMs >= requestedAtWallTimeMs),
    uniqueTargetIds: uniqueTargetIds === response.entries.length,
  };
}

async function openReview(window, sourcePath, sourceName) {
  const catalogEventsBefore = catalogEvents.length;
  const inspectionsBefore = inspectionEvents.length;
  const opened = await triggerFlaReview(window, sourcePath, sourceName);
  const facts = await readWorkbenchFacts(window, sourcePath);
  assert(facts.title === 'FLA 导入工作台', `${sourceName}: expected the unified FLA import workbench.`);
  assert(facts.tabCount === 2, `${sourceName}: expected both workbench sections.`);
  assert(facts.initiallySelectedSourceItems === 0, `${sourceName}: raster items were selected on first open.`);
  assert(inspectionEvents.length === inspectionsBefore + 1, `${sourceName}: expected exactly one source inspection.`);
  return {
    openedAtWallTimeMs: opened.startedAtWallTimeMs,
    workbenchReadyAtWallTimeMs: opened.workbenchReadyAtWallTimeMs,
    initialFacts: facts,
    catalogEventsBefore,
    inspectionsBefore,
    inspection: inspectionEvents.at(-1),
  };
}

async function closeReview(window) {
  await click(window, '[data-testid="fla-review-cancel"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]') && !document.querySelector('[data-testid="fla-review-session"]'))`, 90_000);
}

function unchangedProject(before, after) {
  return before.assetCount === after.assetCount &&
    before.revision === after.revision &&
    before.jsonSha256 === after.jsonSha256;
}

async function verifyBluehair(window) {
  const sourcePath = runtime.sourcePaths.bluehair;
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const opened = await openReview(window, sourcePath, 'bluehair');
  const initial = opened.initialFacts;
  assert(initial.sourcePanelVisible, 'Bluehair must initially open on its raw bitmap section.');
  assert(initial.sourceBitmapCount === 336, `Bluehair must retain 336 raster fragments; observed ${initial.sourceBitmapCount}.`);
  assert(initial.selectedCount === 0, `Bluehair raw bitmap selection count was not zero: ${initial.selectedCountText}.`);
  assert(initial.sourceGridImageCount <= 16, 'Bluehair eagerly rendered more than the current 16-item raster page.');
  assert(catalogEvents.length === opened.catalogEventsBefore, 'Bluehair requested the composition catalog before the user opened that section.');
  const sourceAssetsScreenshot = await capture(window, join(runtime.repoEvidenceDir, 'bluehair-raw-bitmaps.png'));

  const run = await startCatalogFromComposition(window, opened.catalogEventsBefore);
  const rootIndex = run.catalogRequest.entries.findIndex((entry) =>
    entry.targetKind === 'graphic-symbol' &&
    entry.sourceLibraryItemName === BLUEHAIR_TARGET &&
    entry.selectedFrameIndex === 0,
  );
  const rootEntry = run.catalogRequest.entries[rootIndex] ?? null;
  const rootRow = run.ui.rows.find((entry) =>
    entry.sourceLibraryItemName === BLUEHAIR_TARGET && entry.selectedFrameIndex === 0,
  ) ?? null;
  assert(rootIndex >= 0 && rootIndex < 64, 'The exact Bluehair com809 frame-0 target was not inside the actual UI catalog limit.');
  assert(rootEntry?.renderTargetId === BLUEHAIR_TARGET_ID, 'Bluehair com809 frame-0 target ID changed unexpectedly.');
  assert(rootEntry?.catalogRole === 'scene-referenced-graphic', 'Bluehair com809 was not classified as a Scene-referenced Graphic.');
  assert(rootEntry?.previewSupported === true && rootEntry?.isBlank === false, 'Bluehair com809 frame 0 did not have a genuine supported, nonblank catalog status.');
  assert(rootRow?.catalogRole === 'scene-referenced-graphic', 'Bluehair com809 is missing from the actual candidate directory.');
  assert(run.ui.rows[0]?.renderTargetId === BLUEHAIR_TARGET_ID, 'The supported Bluehair Scene-referenced target was not first in the visible candidate order.');
  assert(run.ui.fullPreview?.renderTargetId === BLUEHAIR_TARGET_ID, 'The focused full preview is not Bluehair com809.');
  assert(run.ui.fullPreview?.selectedFrameIndex === 0 && run.ui.fullPreview?.resolution === 'full', 'The focused Bluehair preview is not the exact frame-0 full-resolution preview.');
  assert(rootRow.thumbnailSrc && run.ui.fullPreview?.src && rootRow.thumbnailSrc !== run.ui.fullPreview.src, 'Bluehair does not expose separate thumbnail and full-preview image resources.');
  assert(run.ui.selectedCandidateCount === 0, 'Bluehair candidate directory selected an item by default.');
  assert(run.ui.rows.every((row) => !row.selected), 'Bluehair candidate rows are not all unselected by default.');

  const filters = await testCandidateFilters(window);
  assert(filters.graphicStatesOnly && filters.compositionsOnly && filters.allRestored, 'The candidate role filters did not isolate and restore their intended groups.');
  assert(filters.focusPreservedWhenVisible && filters.hiddenSelectionPreserved, 'Filtering changed a still-visible focus or hidden selection.');
  assert(filters.searchZeroResultsClearedPreview && filters.searchClearRestoredPreview, 'Search did not clear and restore the focused preview correctly.');
  assert(filters.latePreviewResponseIgnored, 'A delayed old focused preview response replaced the current visible focus.');
  run.filterFacts = filters;
  run.ui = await readCatalogUi(window);
  const compositionScreenshot = await capture(window, join(runtime.repoEvidenceDir, 'bluehair-composition-directory.png'));
  const previewBytes = await readFullPreviewBytes(window);
  assert(previewBytes && previewBytes.length > 0, 'The production UI full preview bytes could not be captured.');
  const previewSha256 = sha256(previewBytes);
  assert(previewSha256 === BLUEHAIR_PREVIEW_SHA256, `The exact com809 frame-0 preview changed: ${previewSha256}.`);
  const previewPath = join(runtime.repoEvidenceDir, 'bluehair-com809-frame-0.png');
  writeFileSync(previewPath, previewBytes);

  await closeReview(window);
  const projectAfter = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, projectAfter), 'Bluehair catalog inspection mutated project.json or the project revision.');
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore.bluehair, 'Bluehair FLA changed during catalog review.');
  return {
    source: 'bluehair',
    sourceBasename: basename(sourcePath),
    sourceSha256Before: runtime.sourceHashesBefore.bluehair,
    sourceSha256After: sha256File(sourcePath),
    initialWorkbench: initial,
    catalog: run,
    target: {
      sourceLibraryItemName: BLUEHAIR_TARGET,
      frameIndex: 0,
      renderTargetId: rootEntry.renderTargetId,
      candidateIndex: rootIndex,
      catalogRole: rootEntry.catalogRole,
      previewSupported: rootEntry.previewSupported,
      isBlank: rootEntry.isBlank,
      thumbnailNaturalSize: [rootRow.thumbnailWidth, rootRow.thumbnailHeight],
      fullPreviewNaturalSize: [run.ui.fullPreview.naturalWidth, run.ui.fullPreview.naturalHeight],
      fullPreviewSha256: previewSha256,
      fullPreviewPath: previewPath,
    },
    filters,
    projectBefore,
    projectAfter,
    projectUnchanged: true,
    screenshots: [sourceAssetsScreenshot, compositionScreenshot, { path: previewPath, sha256: previewSha256 }],
  };
}

async function verifyCancelAndReopen(window) {
  const sourcePath = runtime.sourcePaths.bluehair;
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const firstOpen = await openReview(window, sourcePath, 'bluehair-cancel');
  const firstSessionId = firstOpen.inspection?.sessionId ?? null;
  const priorEventCount = catalogEvents.length;
  await evaluate(window, `window.__issue767U2Probe?.begin('bluehair-cancel-catalog')`);
  await selectCompositions(window);
  const firstStarted = await waitForCatalogStartAfter(priorEventCount);
  assert(firstSessionId && firstStarted.sessionId === firstSessionId, 'The in-flight catalog request did not belong to the first inspection session.');
  const completedBeforeCancel = catalogEvents.slice(priorEventCount).some((event) => event.phase === 'complete');
  assert(!completedBeforeCancel, 'The first catalog request completed before cancellation could exercise the stale-response path.');
  const canceledAtWallTimeMs = Date.now();
  await closeReview(window);
  const afterCancel = readProjectState(runtime.project.projectRoot);
  const firstResponse = await waitForCatalogSettledAfter(priorEventCount);
  assert(firstResponse.completedAtWallTimeMs > canceledAtWallTimeMs, 'The catalog response did not arrive after the review was canceled.');
  assert(
    (firstResponse.phase === 'complete' && firstResponse.outcome === 'success') ||
      (firstResponse.phase === 'complete' && firstResponse.outcome === 'SESSION_NOT_FOUND'),
    `The canceled catalog request returned an unexpected result: ${firstResponse.error ?? firstResponse.outcome ?? firstResponse.phase}`,
  );
  assert(unchangedProject(projectBefore, afterCancel), 'Canceling the Bluehair scan changed the project.');
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore.bluehair, 'Canceling the Bluehair scan changed the source FLA.');

  const reopened = await openReview(window, sourcePath, 'bluehair-reopen');
  const reopenedSessionId = reopened.inspection?.sessionId ?? null;
  assert(!reopened.initialFacts.compositionPanelVisible && reopened.initialFacts.sourcePanelVisible, 'A stale catalog result populated the reopened workbench before its own catalog request.');
  const reopenedCatalogIndex = catalogEvents.length;
  await evaluate(window, `window.__issue767U2Probe?.begin('bluehair-reopen-catalog')`);
  await selectCompositions(window);
  const reopenedCatalog = await waitForCatalogAfter(reopenedCatalogIndex);
  await waitForExpression(window, `Boolean([...document.querySelectorAll('[data-testid="fla-snapshot-targets"] .fla-snapshot-candidate-row')].some((row) => row.getAttribute('data-source-library-item-name') === ${JSON.stringify(BLUEHAIR_TARGET)} && row.getAttribute('data-source-frame-index') === '0'))`, 180_000);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-snapshot-preview-image"][data-render-target-id="${BLUEHAIR_TARGET_ID}"]'))`, 180_000);
  const reopenedFacts = await readCatalogUi(window);
  const root = reopenedCatalog.entries.find((entry) => entry.sourceLibraryItemName === BLUEHAIR_TARGET && entry.selectedFrameIndex === 0);
  assert(firstSessionId && reopenedSessionId && firstSessionId !== reopenedSessionId, 'Cancel/reopen reused a stale inspection session identity.');
  assert(reopenedCatalog.sessionId === reopenedSessionId, 'The reopened UI catalog used a stale source session.');
  assert(root?.renderTargetId === BLUEHAIR_TARGET_ID && reopenedFacts.fullPreview?.renderTargetId === BLUEHAIR_TARGET_ID, 'Cancel/reopen did not restore the exact com809 frame-0 candidate and preview.');
  assert(reopenedFacts.selectedCandidateCount === 0, 'Reopened Bluehair candidate selection was not empty.');
  await closeReview(window);
  const afterReopen = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, afterReopen), 'Reopening Bluehair changed the project.');
  return {
    firstSessionId,
    reopenedSessionId,
    canceledCatalogSessionId: firstResponse.sessionId,
    reopenedCatalogSessionId: reopenedCatalog.sessionId,
    cancellation: {
      canceledAtWallTimeMs,
      responseAtWallTimeMs: firstResponse.completedAtWallTimeMs,
      responseArrivedAfterCancel: true,
      responseOutcome: firstResponse.outcome ?? firstResponse.error ?? firstResponse.phase,
      candidateCount: firstResponse.candidateCount,
    },
    canceledWithoutMutation: true,
    reopenedExactTarget: true,
    projectBefore,
    projectAfter: afterReopen,
  };
}

async function verifyRealComplexSource(window, key, evidenceShotName) {
  const sourcePath = runtime.sourcePaths[key];
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const opened = await openReview(window, sourcePath, key);
  const run = await startCatalogFromComposition(window, opened.catalogEventsBefore);
  const targetIds = run.catalogRequest.entries.map((entry) => entry.renderTargetId);
  const sourceFrameKeys = run.catalogRequest.entries.map((entry) =>
    `${entry.sourceLibraryItemName ?? `timeline:${entry.sourceTimelineIndex ?? -1}`}\u0000${entry.selectedFrameIndex}`,
  );
  assert(new Set(targetIds).size === targetIds.length, `${key}: catalog has duplicate render-target IDs.`);
  assert(new Set(sourceFrameKeys).size === sourceFrameKeys.length, `${key}: catalog has duplicate source/frame identities.`);
  assert(run.catalogRequest.omittedCandidateCount >= 0, `${key}: omitted candidate count is invalid.`);
  assert(run.ui.selectedCandidateCount === 0, `${key}: candidate selection was not empty by default.`);
  const screenshot = await capture(window, join(runtime.repoEvidenceDir, evidenceShotName));
  await closeReview(window);
  const projectAfter = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, projectAfter), `${key}: composition scan mutated the project.`);
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore[key], `${key}: source FLA changed during catalog review.`);
  return {
    source: key,
    sourceBasename: basename(sourcePath),
    sourceSha256Before: runtime.sourceHashesBefore[key],
    sourceSha256After: sha256File(sourcePath),
    initialWorkbench: opened.initialFacts,
    catalog: run,
    candidateRoles: Object.fromEntries(['scene', 'scene-referenced-graphic', 'graphic-state'].map((role) => [
      role,
      run.catalogRequest.entries.filter((entry) => entry.catalogRole === role).length,
    ])),
    supportedCount: run.catalogRequest.entries.filter((entry) => entry.previewSupported && !entry.isBlank).length,
    unsupportedCount: run.catalogRequest.entries.filter((entry) => !entry.previewSupported).length,
    blankCount: run.catalogRequest.entries.filter((entry) => entry.isBlank).length,
    uniqueTargetIds: true,
    uniqueSourceFrameIdentities: true,
    projectBefore,
    projectAfter,
    projectUnchanged: true,
    screenshot,
  };
}

async function verifyBitmapOnly(window, key, expectDuplicateIdentity) {
  const sourcePath = runtime.sourcePaths[key];
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const opened = await openReview(window, sourcePath, key);
  assert(opened.initialFacts.sourcePanelVisible, `${key}: raster-only FLA did not open the raw image section.`);
  assert(opened.initialFacts.initiallySelectedSourceItems === 0, `${key}: raster-only images were selected by default.`);
  assert(opened.initialFacts.selectedCount === 0, `${key}: raster-only selected count was not zero: ${opened.initialFacts.selectedCountText}.`);
  assert(opened.initialFacts.sourceBitmapCount === 2, `${key}: expected two raw bitmap items.`);
  assert(opened.initialFacts.sourceGridImageCount <= 16, `${key}: raw raster grid decoded more than the first 16-item page.`);
  assert(catalogEvents.length === opened.catalogEventsBefore, `${key}: opening the raw bitmap section eagerly requested a composition scan.`);
  if (expectDuplicateIdentity) {
    assert(opened.initialFacts.sourceMediaIds.length === 2, `${key}: duplicate bitmap source cards are missing.`);
    assert(new Set(opened.initialFacts.sourceMediaIds).size === 2, `${key}: identical bitmap bytes collapsed distinct source identities.`);
  }
  const catalog = await startCatalogFromComposition(window, opened.catalogEventsBefore);
  assert(catalog.catalogRequest.candidateCount === 0, `${key}: bitmap-only content produced a meaningless composition catalog.`);
  assert(catalog.catalogRequest.omittedCandidateCount === 0, `${key}: bitmap-only content reported omitted composition targets.`);
  await closeReview(window);
  const projectAfter = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, projectAfter), `${key}: browsing bitmap-only content mutated the project.`);
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore[key], `${key}: source FLA changed.`);
  return {
    source: key,
    sourceBasename: basename(sourcePath),
    sourceSha256Before: runtime.sourceHashesBefore[key],
    sourceSha256After: sha256File(sourcePath),
    initialWorkbench: opened.initialFacts,
    didNotScanUntilCompositionOpened: true,
    compositionCatalog: catalog.catalogRequest,
    duplicateBitmapIdentitiesDistinct: expectDuplicateIdentity ? new Set(opened.initialFacts.sourceMediaIds).size === 2 : null,
    projectBefore,
    projectAfter,
    projectUnchanged: true,
  };
}

async function verifyVectorOnly(window) {
  const sourcePath = runtime.sourcePaths.vectorOnly;
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const opened = await openReview(window, sourcePath, 'vector-only');
  assert(opened.initialFacts.compositionSelected, 'Vector-only content did not use the unified composition section.');
  const catalog = await startCatalogFromComposition(window, opened.catalogEventsBefore);
  assert(catalog.catalogRequest.candidateCount === 1, `Vector-only source should expose one visible Scene target, got ${catalog.catalogRequest.candidateCount}.`);
  assert(catalog.catalogRequest.entries[0]?.catalogRole === 'scene', 'Vector-only Scene candidate role was not truthful.');
  assert(catalog.catalogRequest.entries[0]?.previewSupported && !catalog.catalogRequest.entries[0]?.isBlank, 'Vector-only Scene preview was not supported and nonblank.');
  assert(catalog.ui.fullPreview?.naturalWidth > 0 && catalog.ui.fullPreview?.naturalHeight > 0, 'Vector-only full preview was not rendered.');
  await closeReview(window);
  const projectAfter = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, projectAfter), 'Vector-only directory inspection mutated the project.');
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore.vectorOnly, 'Vector-only FLA changed during inspection.');
  return {
    source: 'vector-only',
    sourceBasename: basename(sourcePath),
    sourceSha256Before: runtime.sourceHashesBefore.vectorOnly,
    sourceSha256After: sha256File(sourcePath),
    initialWorkbench: opened.initialFacts,
    catalog: catalog.catalogRequest,
    ui: catalog.ui,
    projectBefore,
    projectAfter,
    projectUnchanged: true,
  };
}

async function verifyUnsupported(window) {
  const sourcePath = runtime.sourcePaths.unsupported;
  const projectBefore = readProjectState(runtime.project.projectRoot);
  const opened = await openReview(window, sourcePath, 'unsupported');
  const run = await startCatalogFromComposition(window, opened.catalogEventsBefore);
  const unsupported = run.catalogRequest.entries.find((entry) => entry.previewSupported === false);
  assert(unsupported, 'Unsupported test source did not fail closed in the catalog.');
  assert(unsupported.unsupportedReason && unsupported.unsupportedReason.length > 0, 'Unsupported catalog entry omitted its reason.');
  assert(run.ui.rows.some((row) => row.renderTargetId === unsupported.renderTargetId && !row.selectable), 'Unsupported candidate appeared importable in the UI.');
  assert(run.ui.selectedCandidateCount === 0, 'Unsupported candidate was selected by default.');
  await click(window, '[data-testid="fla-stage-f2-more-details"] summary');
  const unsupportedReason = await readCatalogUi(window);
  assert(unsupportedReason.visibleReason.length > 0, 'Unsupported reason was not shown in the candidate details.');
  await closeReview(window);
  const projectAfter = readProjectState(runtime.project.projectRoot);
  assert(unchangedProject(projectBefore, projectAfter), 'Unsupported candidate handling mutated the project.');
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore.unsupported, 'Unsupported test FLA changed.');
  return {
    source: 'unsupported',
    sourceBasename: basename(sourcePath),
    sourceSha256Before: runtime.sourceHashesBefore.unsupported,
    sourceSha256After: sha256File(sourcePath),
    initialWorkbench: opened.initialFacts,
    catalog: run.catalogRequest,
    visibleReason: unsupportedReason.visibleReason,
    candidateNotSelectable: true,
    projectBefore,
    projectAfter,
    projectUnchanged: true,
  };
}

function summarizeSourceSamples() {
  const keys = ['bluehair', 'qingling', 'hanfu', 'rasterOnly', 'vectorOnly', 'unsupported'];
  return Object.fromEntries(keys.map((key) => [key, {
    basename: basename(runtime.sourcePaths[key]),
    lengthBytes: readFileSync(runtime.sourcePaths[key]).byteLength,
    sha256Before: runtime.sourceHashesBefore[key],
    sha256After: sha256File(runtime.sourcePaths[key]),
    unchanged: runtime.sourceHashesBefore[key] === sha256File(runtime.sourcePaths[key]),
  }]));
}

function writeReceipt(status, extra = {}) {
  const receipt = {
    schemaVersion: 'issue767-u2-real-ui-catalog/1',
    status,
    runId: runtime.runId,
    gitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    branch: require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    runtime: {
      platform: process.platform,
      release: require('node:os').release(),
      architecture: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      processId: process.pid,
    },
    acceptanceRoot: runtime.runRoot,
    repoEvidenceDirectory: runtime.repoEvidenceDir,
    project: runtime.project,
    projectInitial: runtime.projectInitial,
    projectFinal: runtime.project ? readProjectState(runtime.project.projectRoot) : null,
    sourceSamples: runtime.sourcePaths.bluehair ? summarizeSourceSamples() : {},
    inspectionEvents,
    catalogEvents,
    mainProfileEvents,
    rendererConsoleErrors,
    windowsRespondingSamples: runtime.respondingSamples,
    scenarios: runtime.scenarios,
    assertions: runtime.assertions,
    ...extra,
  };
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(join(runtime.evidenceDir, 'issue767-u2-receipt.json'), json, 'utf8');
  writeFileSync(join(runtime.repoEvidenceDir, 'receipt.json'), json, 'utf8');
  process.stdout.write(`${JSON.stringify({ status, receiptPath: join(runtime.evidenceDir, 'issue767-u2-receipt.json'), repoReceiptPath: join(runtime.repoEvidenceDir, 'receipt.json'), scenarioCount: runtime.scenarios.length })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  runtime.acceptanceRoot = resolve(args.acceptanceRoot ?? DEFAULT_ACCEPTANCE_ROOT);
  const sourceRoot = resolve(args.sourcesRoot ?? DEFAULT_SOURCE_ROOT);
  runtime.runRoot = join(runtime.acceptanceRoot, `run-${runtime.runId}`);
  runtime.evidenceDir = join(runtime.runRoot, 'evidence');
  runtime.userData = join(runtime.runRoot, 'electron-user-data');
  runtime.projectParent = join(runtime.runRoot, 'projects');
  runtime.repoEvidenceRoot = join(runtime.repositoryRoot, 'docs', 'evidence', 'issue-767-u2');
  runtime.repoEvidenceDir = join(runtime.repoEvidenceRoot, `run-${runtime.runId}`);
  for (const directory of [runtime.evidenceDir, runtime.userData, runtime.projectParent, runtime.repoEvidenceDir]) {
    mkdirSync(directory, { recursive: true });
  }
  runtime.sourcePaths = {
    bluehair: findSample(sourceRoot, '蓝发修仙女.fla'),
    qingling: findSample(sourceRoot, '青绫修仙女（四视角）.fla'),
    hanfu: findSample(sourceRoot, '汉服修仙女.fla'),
    rasterOnly: join(runtime.runRoot, 'raster-only-duplicate-pngs.fla'),
    vectorOnly: join(runtime.runRoot, 'vector-only.fla'),
    unsupported: join(runtime.runRoot, 'unsupported-missing-bitmap.fla'),
  };
  await writeBitmapOnlyFla(runtime.sourcePaths.rasterOnly);
  await writeVectorOnlyFla(runtime.sourcePaths.vectorOnly);
  await writeUnsupportedFla(runtime.sourcePaths.unsupported);
  runtime.sourceHashesBefore = Object.fromEntries(
    Object.entries(runtime.sourcePaths).map(([key, sourcePath]) => [key, sha256File(sourcePath)]),
  );
  app.setPath('userData', runtime.userData);
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  installMainProbes();
  startRespondingSampler();
  process.env.VITE_DEV_SERVER_URL = '';
  require(join(runtime.repositoryRoot, 'dist-electron', 'main', 'index.js'));
  const window = await waitForMainWindow();
  window.webContents.on('console-message', (_event, detailOrLevel, legacyMessage) => {
    const level = typeof detailOrLevel === 'object' && detailOrLevel !== null
      ? Number(detailOrLevel.level)
      : Number(detailOrLevel);
    const message = typeof detailOrLevel === 'object' && detailOrLevel !== null
      ? detailOrLevel.message
      : legacyMessage;
    if (level >= 2) {
      rendererConsoleErrors.push({ wallTimeMs: Date.now(), level, message: String(message ?? '').slice(0, 2_000) });
    }
  });
  await setupRendererProbe(window);
  runtime.project = await createProject(window);
  runtime.projectInitial = readProjectState(runtime.project.projectRoot);
  assert(runtime.projectInitial.assetCount === 0, 'The isolated project must start with no assets.');

  runtime.scenarios.push(await verifyBluehair(window));
  runtime.scenarios.push(await verifyCancelAndReopen(window));
  runtime.scenarios.push(await verifyRealComplexSource(window, 'qingling', 'qingling-candidate-directory.png'));
  runtime.scenarios.push(await verifyRealComplexSource(window, 'hanfu', 'hanfu-candidate-directory.png'));
  runtime.scenarios.push(await verifyBitmapOnly(window, 'rasterOnly', true));
  runtime.scenarios.push(await verifyVectorOnly(window));
  runtime.scenarios.push(await verifyUnsupported(window));

  const projectFinal = readProjectState(runtime.project.projectRoot);
  const sourceUnchanged = Object.entries(runtime.sourcePaths).every(([key, sourcePath]) =>
    runtime.sourceHashesBefore[key] === sha256File(sourcePath),
  );
  const noMutation = unchangedProject(runtime.projectInitial, projectFinal);
  const requestPath = catalogEvents.filter((event) => event.phase === 'start');
  const allAuthoredStateRequests = requestPath.length > 0 && requestPath.every((event) => event.includeAuthoredStates);
  const uniqueSessions = new Set(inspectionEvents.map((event) => event.sessionId).filter(Boolean)).size === inspectionEvents.length;
  const noImportCommitted = projectFinal.assetCount === 0;
  runtime.assertions = {
    bluehairExactCom809Frame0InActualUiCatalog: runtime.scenarios[0]?.target?.renderTargetId === BLUEHAIR_TARGET_ID,
    bluehairRawFragmentsRetainedAndUnselected: runtime.scenarios[0]?.initialWorkbench?.sourceBitmapCount === 336 &&
      runtime.scenarios[0]?.initialWorkbench?.initiallySelectedSourceItems === 0,
    bluehairFullPreviewMatchesAcceptedReference: runtime.scenarios[0]?.target?.fullPreviewSha256 === BLUEHAIR_PREVIEW_SHA256,
    candidateRoleFiltersWork: runtime.scenarios[0]?.filters?.graphicStatesOnly && runtime.scenarios[0]?.filters?.compositionsOnly,
    cancelReopenUsesFreshSessionAndExactIdentity: runtime.scenarios[1]?.firstSessionId !== runtime.scenarios[1]?.reopenedSessionId &&
      runtime.scenarios[1]?.reopenedExactTarget,
    qinglingAndHanfuRealSourceCatalogsMeasured: runtime.scenarios[2]?.catalog?.catalogRequest?.candidateCount > 0 &&
      runtime.scenarios[3]?.catalog?.catalogRequest?.candidateCount > 0,
    rasterOnlySkipsEagerCompositionScanAndKeepsDuplicateIds: runtime.scenarios[4]?.didNotScanUntilCompositionOpened &&
      runtime.scenarios[4]?.duplicateBitmapIdentitiesDistinct,
    vectorOnlyUsesSameCatalogAndPreviews: runtime.scenarios[5]?.catalog?.candidateCount === 1,
    unsupportedCandidateFailsClosedWithReason: runtime.scenarios[6]?.candidateNotSelectable &&
      Boolean(runtime.scenarios[6]?.catalog?.entries?.some((entry) => entry.unsupportedReason)),
    everyCatalogUsesAuthoredStatePath: allAuthoredStateRequests,
    sourceSwitchesUseFreshInspectionSessions: uniqueSessions,
    noProjectMutation: noMutation,
    noImportCommitted,
    everySourceHashUnchanged: sourceUnchanged,
    noRendererConsoleErrors: rendererConsoleErrors.length === 0,
  };
  assert(Object.values(runtime.assertions).every(Boolean), 'One or more Issue #767 U2 assertions failed.');
  stopRespondingSampler();
  writeReceipt('PASS', {
    targetId: BLUEHAIR_TARGET_ID,
    previewSha256: BLUEHAIR_PREVIEW_SHA256,
    limitations: [
      'Windows Get-Process.Responding samples are automated observations, not owner acceptance.',
      'Screenshots and source-derived previews are engineering evidence; U2 still requires owner review.',
      'No asset was committed; U3 remains unauthorized.',
    ],
  });
}

app.whenReady()
  .then(main)
  .catch((error) => {
    runtime.error = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', error: runtime.error })}\n`);
    try {
      stopRespondingSampler();
      if (runtime.evidenceDir && runtime.repoEvidenceDir) writeReceipt('FAIL', { error: runtime.error });
    } catch {
      // Preserve the original verifier failure when receipt writing also fails.
    }
    process.exitCode = 1;
  })
  .finally(() => {
    if (mainHeartbeat.timer) clearInterval(mainHeartbeat.timer);
    setTimeout(() => app.quit(), 100);
  });
