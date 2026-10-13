#!/usr/bin/env node
/**
 * Issue #767 U3 real Windows/Electron import, placement, and persistence proof.
 *
 * The verifier drives the normal Project Center and FLA import UI. All test
 * projects, generated control FLAs, and the Electron profile stay under the
 * external acceptance root. Bounded receipts and screenshots are written to
 * the repository evidence directory.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { deflateSync } = require('node:zlib');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const { basename, join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue767-u3';
const DEFAULT_SOURCE_ROOT = 'D:\\表情合集\\新人物';
const BLUEHAIR_TARGET = '神女-cilisucai.com/神女-cilisucai.com809';
const BLUEHAIR_TARGET_ID = 'fla-render-target-71289be86ab338b9c728b476f628b5708ec035560586326cc48e6af8eacfe8dd';
const BLUEHAIR_SOURCE_SHA256 = '86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2';
const BLUEHAIR_PREVIEW_SHA256 = 'd9e423464791a179de7766c7eb9b5aec0845bf0b64bd898c749f0f0dd8a25ed5';
const CATALOG_CHANNEL = 'fla:snapshot-catalog';
const PREVIEW_CHANNEL = 'fla:snapshot-preview';
const SNAPSHOT_COMMIT_CHANNEL = 'fla:snapshot-commit';
const SNAPSHOT_CANCEL_CHANNEL = 'fla:snapshot-cancel';
const RASTER_COMMIT_CHANNEL = 'fla:commit-selected';
const ASSET_THUMBNAIL_CHANNEL = 'asset-thumbnail:read';
const ASSET_DRAG_MIME = 'application/x-panda-stage-asset';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const runtime = {
  runId: new Date().toISOString().replace(/[:.]/gu, '-'),
  repositoryRoot: resolve(__dirname, '..'),
  acceptanceRoot: null,
  runRoot: null,
  userData: null,
  projectParent: null,
  repoEvidenceDir: null,
  sourcePaths: {},
  sourceHashesBefore: {},
  projects: {},
  mainWindowId: null,
  inspections: [],
  catalogs: [],
  previews: [],
  snapshotCommits: [],
  rasterCommits: [],
  snapshotCancels: [],
  thumbnailReads: [],
  scenarios: [],
  assertions: {},
  screenshots: {},
  failure: null,
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
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
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
  const width = 8;
  const height = 8;
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
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function writeBitmapOnlyFla(filePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="320" height="240" frameRate="24">
  <media>
    <DOMBitmapItem name="issue767-u3-bitmap-a.png" href="issue767-u3-bitmap-a.png" frameRight="80" frameBottom="80"/>
    <DOMBitmapItem name="issue767-u3-bitmap-b.png" href="issue767-u3-bitmap-b.png" frameRight="80" frameBottom="80"/>
  </media>
  <timelines>
    <DOMTimeline name="issue767-u3-bitmap-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  const identicalImage = createPng([220, 80, 80]);
  zip.file('LIBRARY/issue767-u3-bitmap-a.png', identicalImage);
  zip.file('LIBRARY/issue767-u3-bitmap-b.png', identicalImage);
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

async function writeUnsupportedFla(filePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="issue767-u3-unsupported-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="issue767-u3-unsupported-symbol"><matrix a="1" d="1" tx="0" ty="0"/></DOMSymbolInstance>
      </elements></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  zip.file('LIBRARY/issue767-u3-unsupported-symbol.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="issue767-u3-unsupported-symbol" symbolType="graphic">
  <timeline><DOMTimeline name="unsupported-timeline"><layers><DOMLayer name="symbol-layer"><frames>
    <DOMFrame index="0"><elements>
      <DOMBitmapInstance libraryItemName="missing-library-bitmap.png"><matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix></DOMBitmapInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`);
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function findSample(sourceRoot, fileName) {
  const directPath = join(sourceRoot, fileName);
  if (existsSync(directPath)) return directPath;
  const normalizedName = fileName.normalize('NFC');
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const candidate = join(current, name.name);
      if (name.isDirectory()) pending.push(candidate);
      else if (name.name.normalize('NFC') === normalizedName) return candidate;
    }
  }
  throw new Error(`Required real FLA sample was not found: ${fileName}`);
}

function captureWindowFacts() {
  return BrowserWindow.getAllWindows().map((window) => {
    const bounds = window.getBounds();
    let url = '';
    try {
      url = window.webContents.getURL();
    } catch {
      // A closing window may no longer expose its URL.
    }
    return {
      id: window.id,
      main: window.id === runtime.mainWindowId,
      width: bounds.width,
      height: bounds.height,
      visible: window.isVisible(),
      destroyed: window.isDestroyed(),
      url: url.slice(0, 500),
    };
  });
}

function installMainProbes() {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (channel === CATALOG_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.catalogs.push({
          sessionId: request?.sessionId ?? null,
          includeAuthoredStates: request?.includeAuthoredStates === true,
          outcome: response?.ok === true ? 'success' : response?.error?.code ?? 'unknown',
          entries: response?.ok === true
            ? (response.entries ?? []).map((entry) => ({
                renderTargetId: entry.target?.renderTargetId ?? null,
                kind: entry.target?.kind ?? null,
                userLabel: entry.target?.userLabel ?? null,
                sourceLibraryItemName: entry.target?.sourceLibraryItemName ?? null,
                selectedFrameIndex: entry.target?.selectedFrameIndex ?? 0,
                previewSupported: entry.previewSupported === true,
                isBlank: entry.isBlank === true,
                unsupportedReason: entry.unsupportedReason ?? null,
              }))
            : [],
        });
        return response;
      });
    }
    if (channel === PREVIEW_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.previews.push({
          requestId: request?.requestId ?? null,
          sessionId: request?.sessionId ?? null,
          target: {
            renderTargetId: request?.target?.renderTargetId ?? null,
            sourceLibraryItemName: request?.target?.sourceLibraryItemName ?? null,
            selectedFrameIndex: request?.target?.selectedFrameIndex ?? 0,
          },
          ok: response?.ok === true,
          responseRequestId: response?.requestId ?? response?.error?.requestId ?? null,
          targetRenderTargetId: response?.targetRenderTargetId ?? null,
          targetSelectedFrameIndex: response?.targetSelectedFrameIndex ?? null,
          width: response?.width ?? null,
          height: response?.height ?? null,
          sha256: response?.sha256 ?? null,
          bytesSha256: response?.ok === true && response.bytes
            ? sha256(Buffer.from(response.bytes))
            : null,
          errorCode: response?.ok === false ? response.error?.code ?? null : null,
        });
        return response;
      });
    }
    if (channel === SNAPSHOT_COMMIT_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.snapshotCommits.push({
          projectRoot: request?.projectRoot ?? null,
          baseRevision: request?.baseRevision ?? null,
          sessionId: request?.sessionId ?? null,
          confirmedPreviewRequestId: request?.confirmedPreviewRequestId ?? null,
          source: request?.source ?? null,
          target: request?.target ? {
            renderTargetId: request.target.renderTargetId,
            userLabel: request.target.userLabel,
            sourceLibraryItemName: request.target.sourceLibraryItemName ?? null,
            selectedFrameIndex: request.target.selectedFrameIndex ?? null,
          } : null,
          preview: request?.preview ?? null,
          confirmed: request?.confirmed === true,
          ok: response?.ok === true,
          projectChanged: response?.projectChanged ?? null,
          baseRevisionResponse: response?.baseRevision ?? null,
          savedRevision: response?.savedRevision ?? null,
          result: response?.ok === true ? {
            assetId: response.result.assetId,
            status: response.result.status,
            sha256: response.result.sha256,
            duplicateOfAssetId: response.result.duplicateOfAssetId,
            asset: response.result.asset,
          } : null,
          errorCode: response?.ok === false ? response.error?.code ?? null : null,
        });
        return response;
      });
    }
    if (channel === SNAPSHOT_CANCEL_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.snapshotCancels.push({
          request: {
            requestId: request?.requestId ?? null,
            sessionId: request?.sessionId ?? null,
          },
          accepted: response?.accepted === true,
          cancelledRequestId: response?.cancelledRequestId ?? null,
        });
        return response;
      });
    }
    if (channel === RASTER_COMMIT_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.rasterCommits.push({
          projectRoot: request?.projectRoot ?? null,
          baseRevision: request?.baseRevision ?? null,
          sessionId: request?.sessionId ?? null,
          source: request?.source ?? null,
          selectedMediaIds: request?.selectedMediaIds ?? [],
          selectedCount: request?.selectedCount ?? null,
          confirmed: request?.confirmed === true,
          ok: response?.ok === true,
          projectChanged: response?.projectChanged ?? null,
          baseRevisionResponse: response?.baseRevision ?? null,
          savedRevision: response?.savedRevision ?? null,
          summary: response?.ok === true && response.status === 'completed'
            ? response.summary
            : null,
          results: response?.ok === true && response.status === 'completed'
            ? response.results.map((result) => ({
                mediaId: result.mediaId,
                status: result.status,
                sha256: result.sha256,
                asset: result.asset,
              }))
            : [],
          errorCode: response?.ok === false ? response.error?.code ?? null : null,
        });
        return response;
      });
    }
    if (channel === ASSET_THUMBNAIL_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const read = {
          projectRoot: request?.projectRoot ?? null,
          assetId: request?.assetId ?? null,
          sha256: request?.sha256 ?? null,
          startedAt: Date.now(),
          outcome: 'pending',
        };
        runtime.thumbnailReads.push(read);
        try {
          const response = await handler(event, request, ...rest);
          Object.assign(read, {
            finishedAt: Date.now(),
            ok: response?.ok === true,
            status: response?.ok === true ? response.status : null,
            dataUrlSha256: response?.ok === true && response.status === 'ready'
              ? sha256(Buffer.from(response.dataUrl.slice('data:image/png;base64,'.length), 'base64'))
              : null,
            errorCode: response?.ok === false ? response.error?.code ?? null : null,
            errorMessage: response?.ok === false ? response.error?.message ?? null : null,
          });
          return response;
        } catch (error) {
          Object.assign(read, {
            finishedAt: Date.now(),
            outcome: 'threw',
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });
    }
    return originalHandle(channel, handler);
  };

  const servicePath = join(__dirname, '..', 'dist-electron', 'main', 'services', 'FlaImportService.js');
  const { FlaImportService } = require(servicePath);
  const originalInspect = FlaImportService.prototype.inspectSource;
  FlaImportService.prototype.inspectSource = async function recordInspection(sourcePath, requestId) {
    const record = { basename: basename(sourcePath), requestId, startedAt: Date.now() };
    runtime.inspections.push(record);
    const response = await originalInspect.call(this, sourcePath, requestId);
    record.sessionId = response?.ok === true ? response.sessionId : null;
    const source = response?.ok === true ? response.ir?.source ?? response.source ?? null : null;
    record.sessionSourceSha256 = typeof source?.sha256 === 'string' ? source.sha256 : null;
    record.originalSourceSha256 = typeof response?.trace?.originalSourceSha256 === 'string'
      ? response.trace.originalSourceSha256
      : null;
    record.outcome = response?.ok === true ? 'success' : response?.error?.code ?? 'unknown';
    record.finishedAt = Date.now();
    return response;
  };
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
        if (ready) {
          runtime.mainWindowId = window.id;
          return window;
        }
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
      // Continue while the current React surface is mounting.
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

async function createProject(window, label) {
  await ensureProjectCenter(window);
  await click(window, '[data-testid="new-project-button"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-dialog"]'))`);
  const projectName = `U3 ${label} ${runtime.runId}`;
  await setInput(window, '[data-testid="new-project-parent-directory"]', runtime.projectParent);
  await setInput(window, '[data-testid="new-project-name"]', projectName);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-confirm"]') && !document.querySelector('[data-testid="new-project-confirm"]').disabled)`);
  await click(window, '[data-testid="new-project-confirm"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="editor-layout"]'))`);
  await switchActivity(window, 'assets');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  return {
    projectName,
    projectRoot: join(runtime.projectParent, `${projectName}.pandastage`),
  };
}

async function switchActivity(window, activity) {
  await evaluate(window, `(() => {
    const button = document.querySelector('[data-activity="${activity}"]');
    if (!(button instanceof HTMLElement)) throw new Error('Missing activity ' + ${JSON.stringify(activity)});
    button.click();
    return true;
  })()`);
  await delay(80);
}

function readProjectState(projectRoot) {
  const json = readFileSync(join(projectRoot, 'project.json'), 'utf8');
  const project = JSON.parse(json);
  return {
    jsonSha256: sha256(Buffer.from(json, 'utf8')),
    assetCount: Array.isArray(project.assets) ? project.assets.length : null,
    revision: project.revision ?? null,
    assets: (project.assets ?? []).map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      relativePath: asset.relativePath,
      sha256: asset.sha256,
      width: asset.width ?? null,
      height: asset.height ?? null,
      flaSnapshot: asset.flaSnapshot ?? null,
    })),
    shots: (project.shots ?? []).map((shot) => ({
      id: shot.id,
      name: shot.name,
      layers: (shot.layers ?? []).map((layer) => ({
        id: layer.id,
        name: layer.name,
        source: layer.source,
        x: layer.x,
        y: layer.y,
        zIndex: layer.zIndex,
      })),
    })),
  };
}

async function readUiRevision(window) {
  return evaluate(window, `(() => {
    const value = Number(document.querySelector('[data-testid="project-canvas-stage"]')?.getAttribute('data-project-revision'));
    return Number.isFinite(value) ? value : null;
  })()`);
}

async function saveProject(window) {
  await click(window, '[data-testid="quick-action-save"]');
  await waitForExpression(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.getAttribute('data-save-state') === 'saved' && !document.querySelector('[data-testid="project-save-state"]')`, 90_000);
}

async function closeProject(window) {
  await click(window, '[data-testid="quick-action-close"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-button"]'))`, 90_000);
}

async function openRecentProject(window, projectName) {
  await waitForExpression(window, `(() => [...document.querySelectorAll('li.recent-project-card')].some((card) => card.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(projectName)}))()`, 90_000);
  await evaluate(window, `(() => {
    const card = [...document.querySelectorAll('li.recent-project-card')]
      .find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(projectName)});
    const button = card?.querySelector('button[data-task4-core="recent-open"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) throw new Error('Recent project is not openable: ' + ${JSON.stringify(projectName)});
    button.click();
  })()`);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="editor-layout"]'))`, 90_000);
  await switchActivity(window, 'assets');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
}

async function capture(window, filePath) {
  await delay(200);
  const image = await window.capturePage();
  writeFileSync(filePath, image.toPNG());
  const size = image.getSize();
  return { path: filePath, width: size.width, height: size.height, sha256: sha256(image.toPNG()) };
}

async function trackRendererObjectUrls(window) {
  await evaluate(window, `(() => {
    if (window.__issue767U3ObjectUrls) return true;
    const active = new Set();
    const created = [];
    const revoked = [];
    const nativeCreate = URL.createObjectURL.bind(URL);
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = nativeCreate(value);
      active.add(url);
      created.push({ url, type: value?.type ?? '', size: value?.size ?? null });
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (active.delete(url)) revoked.push(url);
      nativeRevoke(url);
    };
    window.__issue767U3ObjectUrls = { active, created, revoked };
    return true;
  })()`);
}

async function readObjectUrlFacts(window) {
  return evaluate(window, `(() => {
    const probe = window.__issue767U3ObjectUrls;
    return probe ? {
      createdCount: probe.created.length,
      revokedCount: probe.revoked.length,
      activeCount: probe.active.size,
      active: [...probe.active].map((url) => String(url).slice(0, 200)),
    } : null;
  })()`);
}

function sameActiveObjectUrls(before, after) {
  return Boolean(
    before && after &&
      before.activeCount === after.activeCount &&
      JSON.stringify([...before.active].sort()) === JSON.stringify([...after.active].sort()),
  );
}

async function readAlphaFacts(window) {
  return evaluate(window, `(() => {
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context is unavailable for alpha verification.');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    let visible = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] === 0) transparent += 1;
      else visible += 1;
    }
    return { width: canvas.width, height: canvas.height, transparentPixels: transparent, visiblePixels: visible };
  })()`);
}

async function triggerFlaReview(window, sourcePath, sourceName) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  const priorInspectionCount = runtime.inspections.length;
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
  await click(window, selector);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-review-session"]') && document.querySelector('[data-testid="fla-import-workbench-tabs"]'))`, 180_000);
  const inspectionDeadline = Date.now() + 180_000;
  while (runtime.inspections.length < priorInspectionCount + 1 && Date.now() < inspectionDeadline) await delay(50);
  assert(runtime.inspections.length === priorInspectionCount + 1, `${sourceName}: expected exactly one Main-owned source inspection.`);
  const inspection = runtime.inspections.at(-1);
  assert(inspection.basename === basename(sourcePath), `${sourceName}: Main inspected a different source basename.`);
  return inspection;
}

async function readWorkbenchFacts(window) {
  return evaluate(window, `(() => {
    const root = document.querySelector('[data-testid="fla-review-session"]');
    const tabs = [...(root?.querySelectorAll('[data-testid="fla-import-workbench-tabs"] [role="tab"]') ?? [])];
    const selectedTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const sourcePanel = document.querySelector('#fla-source-assets-panel');
    const sourceCards = [...(sourcePanel?.querySelectorAll('[data-fla-media-id]') ?? [])];
    const sourceChecks = [...(sourcePanel?.querySelectorAll('input[type="checkbox"]') ?? [])];
    const countText = document.querySelector('[data-testid="fla-review-media-count"]')?.textContent?.trim() ?? '';
    const selectedText = document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() ?? '';
    return {
      title: root?.querySelector('[data-testid="fla-review-header"] h2')?.textContent?.trim() ?? '',
      tabCount: tabs.length,
      selectedTab: selectedTab?.getAttribute('data-testid') ?? null,
      sourcePanelVisible: Boolean(sourcePanel && !sourcePanel.hidden),
      sourceBitmapCount: Number(countText.match(/[0-9]+/u)?.[0] ?? 0),
      selectedSourceItems: sourceChecks.filter((input) => input.checked).length,
      sourceMediaIds: sourceCards.map((card) => card.getAttribute('data-fla-media-id')),
      selectedCount: Number(selectedText.match(/[0-9]+/u)?.[0] ?? 0),
    };
  })()`);
}

async function openSnapshotCatalog(window, sessionId) {
  assert(sessionId, 'Cannot correlate the render-target catalog without the active FLA session ID.');
  const selected = await evaluate(window, `document.querySelector('[data-testid="fla-workbench-tab-compositions"]')?.getAttribute('aria-selected') === 'true'`);
  if (!selected) await click(window, '[data-testid="fla-workbench-tab-compositions"]');
  await waitForExpression(window, `Boolean(document.querySelector('#fla-composition-panel') && !document.querySelector('#fla-composition-panel').hidden && document.querySelector('[data-testid="fla-render-workbench"]'))`, 90_000);
  const catalogDeadline = Date.now() + 180_000;
  while (!runtime.catalogs.some((catalog) => catalog.sessionId === sessionId && catalog.outcome === 'success') && Date.now() < catalogDeadline) await delay(100);
  const catalog = runtime.catalogs.findLast((entry) => entry.sessionId === sessionId && entry.outcome === 'success');
  assert(catalog, `Timed out waiting for a successful Main-owned render-target catalog for session ${sessionId}.`);
  await waitForExpression(window, `(() => {
    const root = document.querySelector('[data-testid="fla-snapshot-review"]');
    const state = root?.getAttribute('data-preview-state');
    return state === 'ready' || state === 'error' || Boolean(document.querySelector('[data-testid="fla-snapshot-empty"]'));
  })()`, 180_000);
  return catalog;
}

async function focusBluehairTarget(window) {
  const rowSelector = `[data-testid="fla-snapshot-targets"] [data-render-target-id="${BLUEHAIR_TARGET_ID}"]`;
  await waitForExpression(window, `Boolean(document.querySelector(${JSON.stringify(rowSelector)}))`, 60_000);
  const rowFacts = await evaluate(window, `(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)});
    return {
      focused: row?.getAttribute('data-focused') === 'true',
      selectable: row?.getAttribute('data-preview-supported') === 'true',
      sourceLibraryItemName: row?.getAttribute('data-source-library-item-name') ?? null,
      selectedFrameIndex: Number(row?.getAttribute('data-source-frame-index') ?? -1),
      selected: row?.querySelector('input[type="checkbox"]')?.checked ?? false,
      disabled: row?.querySelector('input[type="checkbox"]')?.disabled ?? true,
    };
  })()`);
  if (!rowFacts.focused) await click(window, `${rowSelector} .fla-snapshot-candidate-focus`);
  await waitForExpression(window, `(() => {
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 &&
      image.getAttribute('data-render-target-id') === ${JSON.stringify(BLUEHAIR_TARGET_ID)};
  })()`, 180_000);
  return rowFacts;
}

async function readPreviewBytes(window) {
  const base64 = await evaluate(window, `(() => {
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) return null;
    return fetch(image.src).then(async (response) => {
      if (!response.ok) throw new Error('Unable to read the selected full preview bytes.');
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

async function readSnapshotSelection(window) {
  return evaluate(window, `(() => {
    const row = document.querySelector('[data-testid="fla-snapshot-targets"] [data-render-target-id="${BLUEHAIR_TARGET_ID}"]');
    const preview = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    const facts = [...(document.querySelector('[data-testid="fla-snapshot-details-region"]')?.querySelectorAll('dl.fla-snapshot-detail-more > div') ?? [])];
    const detail = (label) => facts.find((fact) => fact.querySelector('dt')?.textContent?.trim() === label)?.querySelector('dd')?.textContent?.trim() ?? null;
    return {
      selectedCount: Number(document.querySelector('[data-testid="fla-snapshot-candidate-summary"] > div:last-child dd')?.textContent?.trim() ?? 0),
      rowSelected: row?.querySelector('input[type="checkbox"]')?.checked ?? false,
      rowSelectable: row?.getAttribute('data-preview-supported') === 'true',
      renderTargetId: preview?.getAttribute('data-render-target-id') ?? null,
      previewFrameIndex: Number(preview?.getAttribute('data-source-frame-index') ?? -1),
      previewWidth: Number(preview?.getAttribute('data-preview-width') ?? 0),
      previewHeight: Number(preview?.getAttribute('data-preview-height') ?? 0),
      sourceLibraryItemName: detail('源元件'),
      sourceFrame: detail('源帧'),
      targetIdDetail: detail('目标标识'),
    };
  })()`);
}

async function cancelSnapshotReview(window) {
  await click(window, '[data-testid="fla-snapshot-close"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]') && !document.querySelector('[data-testid="fla-review-session"]'))`, 90_000);
  await delay(250);
}

async function selectOneRawBitmap(window, expectedCount = null) {
  const facts = await readWorkbenchFacts(window);
  assert(facts.sourcePanelVisible, 'The raw bitmap panel is not active.');
  assert(facts.selectedSourceItems === 0, 'Raw bitmap selection was not empty before explicit user selection.');
  if (expectedCount !== null) assert(facts.sourceBitmapCount === expectedCount, `Expected ${expectedCount} raw bitmaps, got ${facts.sourceBitmapCount}.`);
  const mediaId = facts.sourceMediaIds[0];
  assert(mediaId, 'The raw bitmap list has no selectable item.');
  await click(window, `[data-fla-media-id="${mediaId}"] input[type="checkbox"]`);
  await waitForExpression(window, `Number(document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.match(/[0-9]+/)?.[0] ?? 0) === 1`);
  const beforeConfirmRevision = await readUiRevision(window);
  await click(window, '[data-testid="fla-review-confirm"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-review-commit"]'))`);
  const selected = await evaluate(window, `(() => ({
    mediaId: ${JSON.stringify(mediaId)},
    selectedCount: Number(document.querySelector('[data-testid="fla-review-commit-copy"]')?.textContent?.match(/[0-9]+/)?.[0] ?? 0),
  }))()`);
  assert(selected.selectedCount === 1, 'Raster confirmation did not pin exactly one chosen bitmap.');
  assert((await readUiRevision(window)) === beforeConfirmRevision, 'Confirming a raw bitmap changed the Project before commit.');
  return { ...facts, selectedMediaId: mediaId, confirmedCount: selected.selectedCount };
}

async function commitOneRawBitmap(window, projectRoot, expectedSourceSha256) {
  const before = readProjectState(projectRoot);
  const beforeRevision = await readUiRevision(window);
  await click(window, '[data-testid="fla-review-commit"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-stage-g-raster-success"]'))`, 180_000);
  const after = readProjectState(projectRoot);
  const commit = runtime.rasterCommits.at(-1);
  assert(commit?.ok && commit.selectedCount === 1 && commit.selectedMediaIds.length === 1, 'Main raster commit did not receive exactly one selected media ID.');
  assert(commit.source?.sha256 === expectedSourceSha256, 'Main raster commit source SHA did not match the inspected FLA.');
  assert(commit.summary?.selectedCount === 1 && commit.summary.importedCount === 1, 'Raster-only or mixed-source bitmap did not create exactly one ImageAsset.');
  assert(after.assetCount === before.assetCount + 1, 'Raster commit did not add exactly one project asset.');
  assert((await readUiRevision(window)) > beforeRevision, 'Raster commit did not advance the Project revision.');
  await click(window, '[data-testid="fla-stage-g-return-library"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  return { before, after, commit };
}

async function openReview(window, sourcePath, sourceName) {
  const inspection = await triggerFlaReview(window, sourcePath, sourceName);
  const workbench = await readWorkbenchFacts(window);
  assert(workbench.title === 'FLA 导入工作台', `${sourceName}: expected the unified FLA import workbench.`);
  assert(workbench.tabCount === 2, `${sourceName}: expected the composed and raw bitmap sections.`);
  assert(workbench.selectedSourceItems === 0, `${sourceName}: raw bitmap items were selected on initial open.`);
  return { inspection, workbench };
}

async function verifyBrowseCancelAndPreviewCleanup(window, project) {
  const projectBefore = readProjectState(project.projectRoot);
  const revisionBefore = await readUiRevision(window);
  const windowsBefore = captureWindowFacts();
  const objectUrlsBefore = await readObjectUrlFacts(window);
  const inspection = await openReview(window, runtime.sourcePaths.bluehair, 'bluehair-cancel');
  const catalog = await openSnapshotCatalog(window, inspection.inspection.sessionId);
  const target = catalog.entries.find((entry) =>
    entry.renderTargetId === BLUEHAIR_TARGET_ID &&
    entry.sourceLibraryItemName === BLUEHAIR_TARGET &&
    entry.selectedFrameIndex === 0,
  );
  assert(target?.previewSupported && !target.isBlank, 'Cancel scenario did not reach the exact supported Bluehair candidate.');
  await focusBluehairTarget(window);
  const preview = await readPreviewBytes(window);
  assert(preview && sha256(preview) === BLUEHAIR_PREVIEW_SHA256, 'Cancel scenario full preview differs from the approved #757 image.');
  const alpha = await readAlphaFacts(window);
  assert(alpha?.transparentPixels > 0 && alpha.visiblePixels > 0, 'Bluehair preview did not retain both transparent and visible pixels.');
  const windowsDuring = captureWindowFacts();
  await cancelSnapshotReview(window);
  await delay(300);
  const objectUrlsAfter = await readObjectUrlFacts(window);
  const windowsAfter = captureWindowFacts();
  const projectAfter = readProjectState(project.projectRoot);
  const revisionAfter = await readUiRevision(window);
  const cancellation = runtime.snapshotCancels.findLast((entry) =>
    entry.request.sessionId === inspection.inspection.sessionId,
  );
  assert(cancellation?.accepted, 'Closing the browsed snapshot session did not cancel/invalidate it in Main.');
  assert(projectBefore.jsonSha256 === projectAfter.jsonSha256 && projectBefore.assetCount === projectAfter.assetCount, 'Browsing/cancelling the snapshot changed project.json.');
  assert(revisionBefore === revisionAfter, 'Browsing/cancelling the snapshot changed the in-memory Project revision.');
  assert(objectUrlsAfter?.activeCount === objectUrlsBefore?.activeCount, 'Closing the FLA preview left newly created renderer object URLs active.');
  const snapshotWindowCount = (windows) => windows.filter((entry) => !entry.main && (entry.width === 2 && entry.height === 2 || entry.url.endsWith('fla-static-snapshot.html'))).length;
  assert(snapshotWindowCount(windowsDuring) <= 1 && snapshotWindowCount(windowsAfter) <= 1, 'Snapshot browsing left more than one reusable hidden renderer window.');
  assert(sha256File(runtime.sourcePaths.bluehair) === runtime.sourceHashesBefore.bluehair, 'Browsing/cancelling modified the original FLA.');
  return {
    projectBefore,
    projectAfter,
    projectRevisionBefore: revisionBefore,
    projectRevisionAfter: revisionAfter,
    sourceBasename: basename(runtime.sourcePaths.bluehair),
    sourceSha256: runtime.sourceHashesBefore.bluehair,
    sessionId: inspection.inspection.sessionId,
    catalogCandidateCount: catalog.entries.length,
    targetId: target.renderTargetId,
    previewSha256: sha256(preview),
    alpha,
    objectUrlsBefore,
    objectUrlsAfter,
    cancellation,
    backgroundWindows: { before: windowsBefore, duringPreview: windowsDuring, afterCancel: windowsAfter },
    noProjectMutation: true,
    sourceUnchanged: true,
  };
}

async function verifyCharacterImport(window, project) {
  const projectBefore = readProjectState(project.projectRoot);
  const objectUrlsBefore = await readObjectUrlFacts(window);
  const revisionBefore = await readUiRevision(window);
  const inspection = await openReview(window, runtime.sourcePaths.bluehair, 'bluehair-character-import');
  assert(inspection.inspection.sessionId, 'Bluehair inspection did not return a source session ID.');
  assert(inspection.workbench.sourceBitmapCount === 336, `Bluehair must retain 336 raw bitmap parts; got ${inspection.workbench.sourceBitmapCount}.`);
  const catalog = await openSnapshotCatalog(window, inspection.inspection.sessionId);
  assert(catalog.includeAuthoredStates, 'Normal U3 catalog did not request authored-state targets.');
  const entries = catalog.entries;
  const index = entries.findIndex((entry) =>
    entry.renderTargetId === BLUEHAIR_TARGET_ID &&
    entry.sourceLibraryItemName === BLUEHAIR_TARGET &&
    entry.selectedFrameIndex === 0,
  );
  const candidate = entries[index];
  assert(index >= 0 && index < 64, 'Exact com809 frame-0 candidate was outside the actual UI catalog.');
  assert(candidate.previewSupported && !candidate.isBlank, 'Exact com809 frame-0 candidate was not supported and nonblank.');
  const row = await focusBluehairTarget(window);
  assert(row.sourceLibraryItemName === BLUEHAIR_TARGET && row.selectedFrameIndex === 0 && row.selectable, 'Focused target identity did not match com809 frame 0.');
  const previewBytes = await readPreviewBytes(window);
  assert(previewBytes, 'The focused full-resolution preview bytes were unavailable.');
  const previewSha256 = sha256(previewBytes);
  assert(previewSha256 === BLUEHAIR_PREVIEW_SHA256, `Focused preview does not match the #757-approved reference: ${previewSha256}.`);
  const alpha = await readAlphaFacts(window);
  assert(alpha?.transparentPixels > 0 && alpha.visiblePixels > 0, 'The whole-character PNG preview is not transparently rendered.');
  const beforeSelection = await readSnapshotSelection(window);
  assert(beforeSelection.selectedCount === 0, 'Snapshot candidates were selected automatically before user action.');
  assert(beforeSelection.renderTargetId === BLUEHAIR_TARGET_ID && beforeSelection.previewFrameIndex === 0, 'The displayed preview was not the exact selected target/frame.');
  assert(beforeSelection.sourceLibraryItemName === BLUEHAIR_TARGET && beforeSelection.sourceFrame === '1' && beforeSelection.targetIdDetail === BLUEHAIR_TARGET_ID, 'The UI did not show source item, one-based frame, and exact target identity.');
  runtime.screenshots.preview = await capture(window, join(runtime.repoEvidenceDir, 'bluehair-com809-preview.png'));

  await click(window, `[data-testid="fla-snapshot-targets"] [data-render-target-id="${BLUEHAIR_TARGET_ID}"] input[type="checkbox"]`);
  await waitForExpression(window, `document.querySelector('[data-testid="fla-snapshot-targets"] [data-render-target-id="${BLUEHAIR_TARGET_ID}"] input[type="checkbox"]')?.checked === true && Number(document.querySelector('[data-testid="fla-snapshot-candidate-summary"] > div:last-child dd')?.textContent?.trim() ?? 0) === 1`);
  const selection = await readSnapshotSelection(window);
  assert(selection.selectedCount === 1 && selection.rowSelected && selection.rowSelectable, 'Explicit selection did not pin exactly one supported candidate.');
  assert((await readUiRevision(window)) === revisionBefore, 'Selecting/previewing the character changed the Project revision before commit.');
  runtime.screenshots.importPreview = await capture(window, join(runtime.repoEvidenceDir, 'bluehair-com809-selected-one-before-import.png'));
  const displayedPreviewEvent = runtime.previews.findLast((event) =>
    event.sessionId === inspection.inspection.sessionId &&
    event.target.renderTargetId === BLUEHAIR_TARGET_ID &&
    event.target.selectedFrameIndex === 0 &&
    event.ok &&
    event.bytesSha256 === previewSha256,
  );
  assert(displayedPreviewEvent, 'The Main preview event did not match the PNG currently displayed to the user.');
  const previewCountBeforeCommit = runtime.previews.length;
  await click(window, '[data-testid="fla-snapshot-import"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-snapshot-import-counts"]'))`, 180_000);
  const commit = runtime.snapshotCommits.at(-1);
  const commitPreviewIndex = runtime.previews.findLastIndex((event) =>
    event.requestId === commit?.confirmedPreviewRequestId,
  );
  const commitPreviewEvent = commitPreviewIndex >= 0 ? runtime.previews[commitPreviewIndex] : null;
  assert(commit?.ok && commit.confirmed, 'Main did not complete the explicit snapshot commit.');
  assert(commit.projectRoot === project.projectRoot, 'Snapshot was committed to a different project root.');
  assert(commit.sessionId === inspection.inspection.sessionId, 'Snapshot commit was not bound to the inspected session.');
  assert(
    commit.source?.basename === basename(runtime.sourcePaths.bluehair) &&
      commit.source?.sha256 === inspection.inspection.sessionSourceSha256,
    'Snapshot commit source name/SHA differs from the inspected FLA session.',
  );
  assert(
    inspection.inspection.originalSourceSha256 === runtime.sourceHashesBefore.bluehair,
    'Main preflight did not preserve the original FLA SHA alongside the normalized session identity.',
  );
  assert(commit.target?.renderTargetId === BLUEHAIR_TARGET_ID && commit.target?.selectedFrameIndex === 0 && commit.target.sourceLibraryItemName === BLUEHAIR_TARGET, 'Snapshot commit target/frame differs from the selected com809 candidate.');
  assert(
    commitPreviewEvent &&
      commitPreviewIndex >= previewCountBeforeCommit &&
      commitPreviewEvent.sessionId === inspection.inspection.sessionId &&
      commitPreviewEvent.target.renderTargetId === BLUEHAIR_TARGET_ID &&
      commitPreviewEvent.target.selectedFrameIndex === 0 &&
      commitPreviewEvent.bytesSha256 === previewSha256,
    'The Main commit-time confirmed preview did not match the displayed PNG source/session/target/frame.',
  );
  assert(commit.preview?.sha256 === previewSha256 && commit.preview.sha256 === commitPreviewEvent.sha256, 'Snapshot commit preview SHA differs from the rendered PNG.');
  assert(commit.result?.status === 'imported' && commit.projectChanged === true, 'The chosen character was not committed as a new asset.');
  const projectAfterImport = readProjectState(project.projectRoot);
  assert(projectAfterImport.assetCount === 1, `Expected exactly one character asset, got ${projectAfterImport.assetCount}.`);
  const asset = projectAfterImport.assets[0];
  assert(
    asset.kind === 'image' &&
      asset.flaSnapshot?.sourceSha256 === inspection.inspection.sessionSourceSha256,
    'Committed image asset is missing the inspected FLA session identity.',
  );
  assert(asset.flaSnapshot?.renderTargetId === BLUEHAIR_TARGET_ID && asset.flaSnapshot?.selectedFrameIndex === 0 && asset.flaSnapshot?.previewSha256 === previewSha256, 'Committed image asset target/frame/preview metadata is incorrect.');
  assert(asset.name.includes('蓝发修仙女') && asset.name.includes('神女-cilisucai.com809') && asset.name.includes('第 1 帧'), 'Asset Library name does not identify source, composed target, and frame.');
  const imagePath = join(project.projectRoot, asset.relativePath);
  assert(sha256File(imagePath) === previewSha256, 'Committed image file bytes differ from the confirmed preview.');

  await click(window, '[data-testid="fla-snapshot-close"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  const cardSelector = `.asset-card[data-asset-id="${asset.id}"]`;
  await waitForExpression(window, `Boolean(document.querySelector(${JSON.stringify(cardSelector)}))`);
  await evaluate(window, `document.querySelector(${JSON.stringify(cardSelector)})?.scrollIntoView({ block: 'center' })`);
  runtime.screenshots.assetLibraryInitial = await capture(window, join(runtime.repoEvidenceDir, 'asset-library-bluehair-thumbnail-state.png'));
  try {
    await waitForExpression(window, `(() => {
    const image = document.querySelector(${JSON.stringify(`${cardSelector} .asset-card-preview img`)});
    const placeholder = document.querySelector(${JSON.stringify(`${cardSelector} .asset-thumbnail-placeholder`)});
    return (image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) || placeholder?.getAttribute('data-thumbnail-status') === 'missing';
  })()`, 30_000);
  } catch {
    const uiState = await evaluate(window, `(() => {
      const card = document.querySelector(${JSON.stringify(cardSelector)});
      const image = card?.querySelector('.asset-card-preview img');
      const placeholder = card?.querySelector('.asset-thumbnail-placeholder');
      return {
        cardPresent: Boolean(card),
        imagePresent: image instanceof HTMLImageElement,
        imageComplete: image instanceof HTMLImageElement && image.complete,
        naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
        thumbnailStatus: placeholder?.getAttribute('data-thumbnail-status') ?? null,
      };
    })()`);
    const reads = runtime.thumbnailReads.filter((read) => read.assetId === asset.id);
    throw new Error(`Asset Library thumbnail did not settle: ${JSON.stringify({ uiState, reads })}`);
  }
  await click(window, cardSelector);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-fla-snapshot-origin"]'))`);
  const libraryFacts = await evaluate(window, `(() => {
    const card = document.querySelector(${JSON.stringify(cardSelector)});
    const image = card?.querySelector('.asset-card-preview img');
    const origin = document.querySelector('[data-testid="asset-fla-snapshot-origin"]');
    return {
      name: card?.querySelector('.asset-card-name')?.textContent?.trim() ?? '',
      thumbnailLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      thumbnailWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      thumbnailHeight: image instanceof HTMLImageElement ? image.naturalHeight : 0,
      thumbnailStatus: card?.querySelector('.asset-thumbnail-placeholder')?.getAttribute('data-thumbnail-status') ?? null,
      originText: origin?.textContent?.replace(/\\s+/gu, ' ').trim() ?? '',
      detailsText: document.querySelector('[id^="asset-details-dialog-body-"], [data-testid="asset-details-view"]')?.textContent?.replace(/\\s+/gu, ' ').trim() ?? '',
    };
  })()`);
  const sourceAspectRatio = asset.width / asset.height;
  const thumbnailAspectRatio = libraryFacts.thumbnailWidth / libraryFacts.thumbnailHeight;
  assert(
    libraryFacts.thumbnailLoaded &&
      libraryFacts.thumbnailWidth > 0 && libraryFacts.thumbnailHeight > 0 &&
      libraryFacts.thumbnailWidth <= asset.width && libraryFacts.thumbnailHeight <= asset.height &&
      Math.abs(sourceAspectRatio - thumbnailAspectRatio) < 0.01,
    'Asset Library did not show the real, correctly proportioned imported preview thumbnail.',
  );
  assert(libraryFacts.originText.includes('蓝发修仙女.fla') && libraryFacts.originText.includes(BLUEHAIR_TARGET) && libraryFacts.originText.includes('1'), 'Asset Library details do not show source FLA, source item, and frame.');
  runtime.screenshots.assetLibrary = await capture(window, join(runtime.repoEvidenceDir, 'asset-library-bluehair-character.png'));
  const detailsCloseSelector = await evaluate(window, `document.querySelector('[data-testid="asset-details-back"]') ? '[data-testid="asset-details-back"]' : '[data-testid="asset-details-close"]'`);
  await click(window, detailsCloseSelector);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  const objectUrlsAfter = await readObjectUrlFacts(window);
  assert(sameActiveObjectUrls(objectUrlsBefore, objectUrlsAfter), 'The initial snapshot import left new renderer object URLs active after closing the FLA workbench.');
  return {
    projectBefore,
    projectAfterImport,
    objectUrlsBefore,
    objectUrlsAfter,
    source: {
      basename: basename(runtime.sourcePaths.bluehair),
      sha256: runtime.sourceHashesBefore.bluehair,
      originalSourceSha256: inspection.inspection.originalSourceSha256,
      sessionSourceSha256: inspection.inspection.sessionSourceSha256,
    },
    candidate: {
      index,
      candidate,
      row,
      initialSelectedCount: beforeSelection.selectedCount,
      selection,
      previewSha256,
      previewBytes: previewBytes.length,
      displayedPreviewRequestId: displayedPreviewEvent.requestId,
      commitPreviewRequestId: commitPreviewEvent.requestId,
      alpha,
    },
    commit,
    asset,
    libraryFacts,
    projectRoot: project.projectRoot,
  };
}

async function createShot(window) {
  await switchActivity(window, 'shots');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="shot-manager"]'))`);
  await click(window, '[data-testid="resource-primary-action"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="shot-create-view"]'))`);
  const shotName = `Issue767 U3 Character ${runtime.runId}`;
  await setInput(window, '[data-testid="shot-create-name"]', shotName);
  await click(window, '[data-testid="shot-create-submit"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="shot-manager"]') && !document.querySelector('[data-testid="shot-create-view"]'))`);
  await switchActivity(window, 'assets');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  return shotName;
}

async function dispatchAssetDrop(window, assetId, point) {
  const setup = await evaluate(window, `(() => {
    const card = document.querySelector('[data-testid="asset-library"] [data-asset-id="${assetId}"]');
    const viewport = document.querySelector('[data-testid="project-canvas-viewport"]');
    if (!(card instanceof HTMLElement) || !(viewport instanceof HTMLElement)) throw new Error('Asset card or project canvas viewport is missing.');
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = viewport.getBoundingClientRect();
    const scale = Number(viewport.dataset.displayScale);
    const offsetX = Number(viewport.dataset.offsetX);
    const offsetY = Number(viewport.dataset.offsetY);
    if (!(scale > 0) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new Error('Canvas viewport transform is not ready.');
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: rect.left + offsetX + ${point.x} * scale - viewport.scrollLeft,
      clientY: rect.top + offsetY + ${point.y} * scale - viewport.scrollTop,
    };
    viewport.dispatchEvent(new DragEvent('dragenter', eventOptions));
    viewport.dispatchEvent(new DragEvent('dragover', eventOptions));
    window.__issue767U3Drop = { card, viewport, transfer, eventOptions };
    return { payload: transfer.getData(${JSON.stringify(ASSET_DRAG_MIME)}), scale };
  })()`);
  assert(setup.payload.includes(assetId), 'Asset drag payload did not contain the selected character asset ID.');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="canvas-drop-ghost"]'))`);
  await evaluate(window, `(() => {
    const state = window.__issue767U3Drop;
    if (!state) throw new Error('Asset drop state was lost.');
    state.viewport.dispatchEvent(new DragEvent('drop', state.eventOptions));
    state.card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: state.transfer }));
    delete window.__issue767U3Drop;
  })()`);
  await waitForExpression(window, `(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layers = JSON.parse(stage?.getAttribute('data-layer-json') ?? '[]');
    return layers.some((layer) => layer.source?.kind === 'asset' && layer.source.assetId === ${JSON.stringify(assetId)});
  })()`, 60_000);
  return evaluate(window, `(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layers = JSON.parse(stage?.getAttribute('data-layer-json') ?? '[]');
    const layer = layers.find((candidate) => candidate.source?.kind === 'asset' && candidate.source.assetId === ${JSON.stringify(assetId)});
    return { layer, layers, projectRevision: Number(stage?.getAttribute('data-project-revision') ?? -1) };
  })()`);
}

async function verifySaveCloseReopenAndDuplicate(window, project, importFacts, shotName) {
  await switchActivity(window, 'assets');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  const placement = await dispatchAssetDrop(window, importFacts.asset.id, { x: 960, y: 540 });
  assert(placement.layer.source.assetId === importFacts.asset.id, 'Shot layer does not reference the imported character asset.');
  assert(placement.layer.name.includes('蓝发修仙女'), 'Placed shot layer lost the imported character identity.');
  runtime.screenshots.shotPlacement = await capture(window, join(runtime.repoEvidenceDir, 'shot-bluehair-character-placement.png'));
  await saveProject(window);
  const saved = readProjectState(project.projectRoot);
  assert(saved.assetCount === 1, 'Saved character project contains phantom or partial assets.');
  const savedShot = saved.shots.find((shot) => shot.name === shotName);
  assert(savedShot?.layers.some((layer) => layer.id === placement.layer.id && layer.source?.assetId === importFacts.asset.id), 'Saved project.json did not persist the character placement in the created shot.');
  const beforeCloseRevision = await readUiRevision(window);
  await closeProject(window);
  await openRecentProject(window, project.projectName);
  const reopened = readProjectState(project.projectRoot);
  assert(reopened.jsonSha256 === saved.jsonSha256 && reopened.assetCount === 1, 'Project asset content changed or disappeared after save, close, and reopen.');
  const reopenedShot = reopened.shots.find((shot) => shot.name === shotName);
  assert(reopenedShot?.layers.some((layer) => layer.id === placement.layer.id && layer.source?.assetId === importFacts.asset.id), 'Shot placement did not survive project reopen.');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="project-canvas-stage"]')?.getAttribute('data-layer-json')?.includes(${JSON.stringify(importFacts.asset.id)}))`, 60_000);
  runtime.screenshots.reopenedProject = await capture(window, join(runtime.repoEvidenceDir, 'project-reopened-bluehair-character.png'));

  const objectUrlsBeforeDuplicate = await readObjectUrlFacts(window);
  const beforeDuplicate = readProjectState(project.projectRoot);
  const revisionBeforeDuplicate = await readUiRevision(window);
  const duplicateInspection = await openReview(window, runtime.sourcePaths.bluehair, 'bluehair-duplicate');
  const duplicateCatalog = await openSnapshotCatalog(window, duplicateInspection.inspection.sessionId);
  assert(duplicateCatalog.entries.some((entry) => entry.renderTargetId === BLUEHAIR_TARGET_ID && entry.sourceLibraryItemName === BLUEHAIR_TARGET && entry.selectedFrameIndex === 0), 'Duplicate retry could not locate the exact com809 frame-0 candidate.');
  await focusBluehairTarget(window);
  const duplicatePreview = await readPreviewBytes(window);
  assert(duplicatePreview && sha256(duplicatePreview) === BLUEHAIR_PREVIEW_SHA256, 'Duplicate retry preview differed from the original confirmed PNG.');
  await click(window, `[data-testid="fla-snapshot-targets"] [data-render-target-id="${BLUEHAIR_TARGET_ID}"] input[type="checkbox"]`);
  await waitForExpression(window, `Number(document.querySelector('[data-testid="fla-snapshot-candidate-summary"] > div:last-child dd')?.textContent?.trim() ?? 0) === 1`);
  await click(window, '[data-testid="fla-snapshot-import"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="fla-snapshot-import-counts"]'))`, 180_000);
  const duplicateCommit = runtime.snapshotCommits.at(-1);
  assert(duplicateCommit?.ok && duplicateCommit.result?.status === 'duplicate' && duplicateCommit.projectChanged === false, 'Repeated Bluehair snapshot did not reuse the existing image as a no-op.');
  assert(duplicateCommit.baseRevisionResponse === revisionBeforeDuplicate && duplicateCommit.savedRevision === revisionBeforeDuplicate, 'Duplicate snapshot response drifted the project revision.');
  assert(duplicateCommit.result.assetId === importFacts.asset.id && duplicateCommit.result.duplicateOfAssetId === importFacts.asset.id, 'Duplicate snapshot did not point to the existing asset.');
  const afterDuplicate = readProjectState(project.projectRoot);
  assert(afterDuplicate.jsonSha256 === beforeDuplicate.jsonSha256 && afterDuplicate.assetCount === 1, 'Duplicate retry wrote a phantom asset or changed project.json.');
  assert((await readUiRevision(window)) === revisionBeforeDuplicate, 'Duplicate retry changed the in-memory project revision.');
  await click(window, '[data-testid="fla-snapshot-close"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  const objectUrlsAfterDuplicate = await readObjectUrlFacts(window);
  assert(sameActiveObjectUrls(objectUrlsBeforeDuplicate, objectUrlsAfterDuplicate), 'Duplicate retry left new renderer object URLs active after closing the FLA workbench.');
  assert(sha256File(runtime.sourcePaths.bluehair) === runtime.sourceHashesBefore.bluehair, 'Character import or retry changed the original FLA.');
  return {
    shotName,
    placement,
    saved,
    reopened,
    beforeCloseRevision,
    duplicate: {
      commit: duplicateCommit,
      previewSha256: sha256(duplicatePreview),
      objectUrlsBefore: objectUrlsBeforeDuplicate,
      objectUrlsAfter: objectUrlsAfterDuplicate,
      before: beforeDuplicate,
      after: afterDuplicate,
      revisionBefore: revisionBeforeDuplicate,
      revisionAfter: await readUiRevision(window),
    },
  };
}

async function verifyRasterOnlyImport(window, project) {
  const sourcePath = runtime.sourcePaths.rasterOnly;
  const beforeBrowse = readProjectState(project.projectRoot);
  const inspection = await openReview(window, sourcePath, 'bitmap-only');
  assert(inspection.workbench.sourcePanelVisible && inspection.workbench.sourceBitmapCount === 2, 'Bitmap-only FLA did not expose its two raw images.');
  const selection = await selectOneRawBitmap(window, 2);
  const result = await commitOneRawBitmap(
    window,
    project.projectRoot,
    inspection.inspection.sessionSourceSha256,
  );
  assert(result.before.assetCount === 0 && result.after.assetCount === 1, 'Bitmap-only path did not import exactly one selected bitmap.');
  const noBrowseMutation = beforeBrowse.jsonSha256 === result.before.jsonSha256 &&
    beforeBrowse.assetCount === 0 && result.before.assetCount === 0;
  assert(noBrowseMutation, 'Bitmap-only browse/selection changed the project before the explicit commit.');
  return {
    sourceBasename: basename(sourcePath),
    sourceSha256: runtime.sourceHashesBefore.rasterOnly,
    sessionSourceSha256: inspection.inspection.sessionSourceSha256,
    initialWorkbench: inspection.workbench,
    selection,
    commit: result.commit,
    projectBefore: result.before,
    projectAfter: result.after,
    exactlyOneImported: result.after.assetCount === 1,
    noProjectMutationBeforeCommit: noBrowseMutation,
    sourceUnchanged: sha256File(sourcePath) === runtime.sourceHashesBefore.rasterOnly,
  };
}

async function verifyMixedBitmapImport(window, project) {
  const sourcePath = runtime.sourcePaths.bluehair;
  const beforeBrowse = readProjectState(project.projectRoot);
  const inspection = await openReview(window, sourcePath, 'bluehair-raw-bitmap');
  assert(inspection.workbench.sourceBitmapCount === 336 && inspection.workbench.selectedSourceItems === 0, 'Mixed FLA did not retain its 336 initially unselected raw bitmap parts.');
  const selection = await selectOneRawBitmap(window, 336);
  const result = await commitOneRawBitmap(
    window,
    project.projectRoot,
    inspection.inspection.sessionSourceSha256,
  );
  assert(result.before.assetCount === 0 && result.after.assetCount === 1, 'Mixed-source raw-bitmap path did not import exactly one selected bitmap.');
  assert(beforeBrowse.jsonSha256 === result.before.jsonSha256, 'Mixed-source raw-bitmap browse/selection changed the project before commit.');
  assert(runtime.rasterCommits.at(-1)?.source?.basename === basename(sourcePath), 'Mixed raw-bitmap commit source basename was incorrect.');
  return {
    sourceBasename: basename(sourcePath),
    sourceSha256: runtime.sourceHashesBefore.bluehair,
    sessionSourceSha256: inspection.inspection.sessionSourceSha256,
    initialWorkbench: inspection.workbench,
    selection,
    commit: result.commit,
    projectBeforeBrowse: beforeBrowse,
    projectAfter: result.after,
    exactlyOneImported: result.after.assetCount === 1,
    noAutoSelection: inspection.workbench.selectedSourceItems === 0,
    sourceUnchanged: sha256File(sourcePath) === runtime.sourceHashesBefore.bluehair,
  };
}

async function verifyUnsupportedTarget(window, project) {
  const sourcePath = runtime.sourcePaths.unsupported;
  const before = readProjectState(project.projectRoot);
  const revisionBefore = await readUiRevision(window);
  const inspection = await openReview(window, sourcePath, 'unsupported-vector');
  const catalog = await openSnapshotCatalog(window, inspection.inspection.sessionId);
  const unsupported = catalog.entries.find((entry) => entry.previewSupported === false);
  assert(unsupported?.unsupportedReason, 'Unsupported vector target did not fail closed with a reason.');
  const uiState = await evaluate(window, `(() => {
    const row = document.querySelector('[data-testid="fla-snapshot-targets"] [data-render-target-id="${unsupported.renderTargetId}"]');
    const placeholder = document.querySelector('[data-testid="fla-snapshot-preview-placeholder"]');
    return {
      selectable: row?.getAttribute('data-preview-supported') === 'true',
      checked: row?.querySelector('input[type="checkbox"]')?.checked ?? false,
      reason: placeholder?.textContent?.replace(/\\s+/gu, ' ').trim() ?? '',
      previewState: document.querySelector('[data-testid="fla-snapshot-preview-status"]')?.getAttribute('data-preview-state') ?? null,
      importDisabled: document.querySelector('[data-testid="fla-snapshot-import"]')?.disabled ?? true,
    };
  })()`);
  assert(!uiState.selectable && !uiState.checked && uiState.importDisabled && uiState.previewState === 'unsupported', 'Unsupported target was selectable, importable, or not visibly rejected.');
  assert(uiState.reason.length > 0, 'Unsupported target did not show a clear visible reason.');
  await cancelSnapshotReview(window);
  const after = readProjectState(project.projectRoot);
  assert(before.jsonSha256 === after.jsonSha256 && before.assetCount === after.assetCount, 'Unsupported browse/cancel changed the project.');
  assert(revisionBefore === await readUiRevision(window), 'Unsupported browse/cancel changed the in-memory revision.');
  assert(sha256File(sourcePath) === runtime.sourceHashesBefore.unsupported, 'Unsupported source file was modified.');
  return {
    sourceBasename: basename(sourcePath),
    sourceSha256: runtime.sourceHashesBefore.unsupported,
    sessionId: inspection.inspection.sessionId,
    target: unsupported,
    uiState,
    projectBefore: before,
    projectAfter: after,
    noProjectMutation: true,
    sourceUnchanged: true,
  };
}

function writeReceipt(status, extra = {}) {
  const receipt = {
    schemaVersion: 'issue767-u3-real-ui-import/1',
    status,
    runId: runtime.runId,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
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
    originalBluehair: runtime.sourcePaths.bluehair ? {
      path: runtime.sourcePaths.bluehair,
      sizeBytes: readFileSync(runtime.sourcePaths.bluehair).byteLength,
      sha256Before: runtime.sourceHashesBefore.bluehair,
      sha256After: sha256File(runtime.sourcePaths.bluehair),
      unchanged: runtime.sourceHashesBefore.bluehair === sha256File(runtime.sourcePaths.bluehair),
    } : null,
    sourceHashes: runtime.sourceHashesBefore,
    projects: runtime.projects,
    screenshots: runtime.screenshots,
    inspections: runtime.inspections,
    catalogs: runtime.catalogs,
    previews: runtime.previews,
    snapshotCommits: runtime.snapshotCommits,
    rasterCommits: runtime.rasterCommits,
    snapshotCancels: runtime.snapshotCancels,
    thumbnailReads: runtime.thumbnailReads,
    scenarios: runtime.scenarios,
    assertions: runtime.assertions,
    finalWindows: captureWindowFacts(),
    ...extra,
  };
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(join(runtime.runRoot, 'issue767-u3-receipt.json'), json, 'utf8');
  writeFileSync(join(runtime.repoEvidenceDir, 'receipt.json'), json, 'utf8');
  process.stdout.write(`${JSON.stringify({ status, receiptPath: join(runtime.runRoot, 'issue767-u3-receipt.json'), repoReceiptPath: join(runtime.repoEvidenceDir, 'receipt.json'), scenarios: runtime.scenarios.length })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  runtime.acceptanceRoot = resolve(args.acceptanceRoot ?? DEFAULT_ACCEPTANCE_ROOT);
  const sourceRoot = resolve(args.sourcesRoot ?? DEFAULT_SOURCE_ROOT);
  runtime.runRoot = join(runtime.acceptanceRoot, `run-${runtime.runId}`);
  runtime.userData = join(runtime.runRoot, 'electron-user-data');
  runtime.projectParent = join(runtime.acceptanceRoot, 'projects');
  runtime.repoEvidenceDir = join(runtime.repositoryRoot, 'docs', 'evidence', 'issue-767-u3', `run-${runtime.runId}`);
  for (const directory of [runtime.runRoot, runtime.userData, runtime.projectParent, runtime.repoEvidenceDir]) mkdirSync(directory, { recursive: true });
  runtime.sourcePaths = {
    bluehair: findSample(sourceRoot, '蓝发修仙女.fla'),
    rasterOnly: join(runtime.runRoot, 'bitmap-only.fla'),
    unsupported: join(runtime.runRoot, 'unsupported-vector.fla'),
  };
  await writeBitmapOnlyFla(runtime.sourcePaths.rasterOnly);
  await writeUnsupportedFla(runtime.sourcePaths.unsupported);
  runtime.sourceHashesBefore = Object.fromEntries(
    Object.entries(runtime.sourcePaths).map(([key, sourcePath]) => [key, sha256File(sourcePath)]),
  );
  assert(runtime.sourceHashesBefore.bluehair === BLUEHAIR_SOURCE_SHA256, 'The Bluehair source SHA differs from the owner-approved U2 source.');

  app.setPath('userData', runtime.userData);
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  installMainProbes();
  process.env.VITE_DEV_SERVER_URL = '';
  require(join(runtime.repositoryRoot, 'dist-electron', 'main', 'index.js'));
  const window = await waitForMainWindow();
  const project = await createProject(window, 'character');
  runtime.projects.character = { ...project, initial: readProjectState(project.projectRoot) };
  assert(runtime.projects.character.initial.assetCount === 0, 'Primary isolated project did not start without assets.');
  runtime.projects.character.shotName = await createShot(window);
  await saveProject(window);
  const persistedShotProject = readProjectState(project.projectRoot);
  assert(persistedShotProject.shots.some((shot) => shot.name === runtime.projects.character.shotName), 'Shot setup was not saved before read-only browse/cancel checks.');
  await trackRendererObjectUrls(window);

  const cancelFacts = await verifyBrowseCancelAndPreviewCleanup(window, project);
  runtime.scenarios.push({ name: 'browse-cancel-preview-cleanup', ...cancelFacts });
  const importFacts = await verifyCharacterImport(window, project);
  runtime.scenarios.push({ name: 'bluehair-com809-single-asset-import', ...importFacts });
  const persistence = await verifySaveCloseReopenAndDuplicate(window, project, importFacts, runtime.projects.character.shotName);
  runtime.scenarios.push({ name: 'shot-save-close-reopen-and-duplicate', ...persistence });
  const objectUrlFacts = await readObjectUrlFacts(window);
  assert(sameActiveObjectUrls(persistence.duplicate.objectUrlsAfter, objectUrlFacts), 'Renderer object URLs changed after the duplicate FLA workbench closed.');
  runtime.scenarios.push({ name: 'preview-resource-release', objectUrls: objectUrlFacts });

  await closeProject(window);
  const rasterProject = await createProject(window, 'bitmap-only');
  runtime.projects.bitmapOnly = { ...rasterProject, initial: readProjectState(rasterProject.projectRoot) };
  const rasterOnly = await verifyRasterOnlyImport(window, rasterProject);
  runtime.scenarios.push({ name: 'bitmap-only-selected-image-import', ...rasterOnly });

  await closeProject(window);
  const mixedProject = await createProject(window, 'mixed-bitmap');
  runtime.projects.mixedBitmap = { ...mixedProject, initial: readProjectState(mixedProject.projectRoot) };
  const mixedBitmap = await verifyMixedBitmapImport(window, mixedProject);
  runtime.scenarios.push({ name: 'mixed-source-selected-bitmap-import', ...mixedBitmap });
  const unsupported = await verifyUnsupportedTarget(window, mixedProject);
  runtime.scenarios.push({ name: 'unsupported-vector-fail-closed', ...unsupported });

  const sourceUnchanged = Object.entries(runtime.sourcePaths).every(([key, sourcePath]) =>
    runtime.sourceHashesBefore[key] === sha256File(sourcePath),
  );
  assert(sourceUnchanged, 'At least one original or generated FLA source changed during U3 acceptance.');
  const snapshotWindowCount = (windows) => windows.filter((entry) => !entry.main && (entry.width === 2 && entry.height === 2 || entry.url.endsWith('fla-static-snapshot.html'))).length;
  const finalWindows = captureWindowFacts();
  runtime.assertions = {
    primaryCharacterExactlyOneAsset: importFacts.projectAfterImport.assetCount === 1,
    exactCom809Frame0MatchesApprovedPreview: importFacts.candidate.candidate.renderTargetId === BLUEHAIR_TARGET_ID && importFacts.candidate.previewSha256 === BLUEHAIR_PREVIEW_SHA256,
    initialCompositionSelectionEmptyAndOneExplicitlyImported: importFacts.candidate.initialSelectedCount === 0 && importFacts.candidate.selection.selectedCount === 1 && importFacts.commit.result.status === 'imported',
    confirmedPreviewSessionSourceAndTargetBound: runtime.previews.some((event) => event.sessionId === importFacts.commit.sessionId && event.requestId === importFacts.commit.confirmedPreviewRequestId && event.target.renderTargetId === BLUEHAIR_TARGET_ID && event.target.selectedFrameIndex === 0) && importFacts.commit.source.sha256 === importFacts.source.sessionSourceSha256 && importFacts.source.sha256 === BLUEHAIR_SOURCE_SHA256 && importFacts.source.originalSourceSha256 === BLUEHAIR_SOURCE_SHA256,
    transparentPngAndRealAssetLibraryThumbnail: importFacts.candidate.alpha.transparentPixels > 0 && importFacts.libraryFacts.thumbnailLoaded,
    sourceMetadataPersistsInProjectAndLibrary: Boolean(importFacts.asset.flaSnapshot?.sourceBasename && importFacts.libraryFacts.originText.includes(BLUEHAIR_TARGET)),
    shotPlacementPersistsAfterSaveCloseReopen: persistence.reopened.shots.some((shot) => shot.name === persistence.shotName && shot.layers.some((layer) => layer.source?.assetId === importFacts.asset.id)),
    duplicateIsNoOpWithoutRevisionDrift: persistence.duplicate.commit.result.status === 'duplicate' && persistence.duplicate.commit.projectChanged === false && persistence.duplicate.before.jsonSha256 === persistence.duplicate.after.jsonSha256,
    bitmapOnlySingleSelectionCommit: rasterOnly.commit.selectedCount === 1 && rasterOnly.projectAfter.assetCount === 1,
    mixedSourceSingleBitmapCommit: mixedBitmap.commit.selectedCount === 1 && mixedBitmap.projectAfter.assetCount === 1,
    unsupportedVectorFailsClosedWithReason: !unsupported.uiState.selectable && unsupported.uiState.importDisabled && Boolean(unsupported.target.unsupportedReason),
    browseCancelLeavesProjectAndSourceUnchanged: cancelFacts.noProjectMutation && sourceUnchanged,
    rendererObjectUrlsReleased: sameActiveObjectUrls(cancelFacts.objectUrlsBefore, cancelFacts.objectUrlsAfter) && sameActiveObjectUrls(importFacts.objectUrlsBefore, importFacts.objectUrlsAfter) && sameActiveObjectUrls(persistence.duplicate.objectUrlsBefore, persistence.duplicate.objectUrlsAfter),
    snapshotBackgroundRendererDoesNotAccumulate: snapshotWindowCount(finalWindows) <= 1,
    originalBluehairShaUnchanged: runtime.sourceHashesBefore.bluehair === sha256File(runtime.sourcePaths.bluehair),
  };
  assert(Object.values(runtime.assertions).every(Boolean), 'One or more Issue #767 U3 assertions failed.');
  writeReceipt('PASS', {
    productAcceptance: 'OWNER_HANDS_ON_REQUIRED',
    limitations: [
      'This is isolated Windows Electron engineering evidence. The owner still performs the required hands-on product acceptance.',
      'Rollback and transaction fault handling are covered by the focused static-snapshot commit unit tests and the existing Stage D verifier.',
    ],
  });
}

app.whenReady()
  .then(main)
  .catch((error) => {
    runtime.failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', error: runtime.failure })}\n`);
    try {
      if (runtime.runRoot && runtime.repoEvidenceDir) writeReceipt('FAIL', { error: runtime.failure });
    } catch {
      // Preserve the original verifier failure when receipt writing also fails.
    }
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => app.quit(), 100);
  });
