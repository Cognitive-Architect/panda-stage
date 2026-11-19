'use strict';

/* global document:readonly, HTMLInputElement:readonly */

// Windows Electron regression for repeated single-image imports in one FLA review.
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');
const JSZip = require('jszip');

const acceptanceRoot = process.env.PANDA_STAGE_ACCEPTANCE_ROOT ||
  'D:\\PandaStage-Acceptance';
mkdirSync(acceptanceRoot, { recursive: true });
const runRoot = mkdtempSync(join(acceptanceRoot, 'issue-1160-'));
const sample = process.env.PANDA_STAGE_FLA_PERF_SAMPLE;
const mediaCount = Number(process.env.PANDA_STAGE_FLA_PERF_MEDIA_COUNT || 2);
const sourcePath = sample ? resolve(sample) : join(runRoot, 'generated-bitmaps.fla');
const wantedNames = (process.env.PANDA_STAGE_FLA_PERF_CANDIDATES || '787.png,788.png').split(',');
const projectName = 'Raster Review';
const dist = join(__dirname, '..', 'dist-electron', 'main');
const { IPC_CHANNELS } = require(join(dist, '..', 'shared', 'ipc', 'channels.js'));
const { FlaImportService } = require(join(dist, 'services', 'FlaImportService.js'));

app.setPath('userData', join(runRoot, 'profile'));
delete process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE;
delete process.env.VITE_DEV_SERVER_URL;

async function writeSource(filePath, count = 2) {
  const zip = new JSZip();
  const bitmaps = [
    { name: '787.png', bgra: [20, 60, 230, 255] },
    { name: '788.png', bgra: [230, 120, 40, 255] },
  ];
  for (let index = bitmaps.length; index < count; index += 1) {
    bitmaps.push({ name: 'extra/bitmap-' + index + '.png', bgra: [index % 256, 90, 140, 255] });
  }
  const media = bitmaps.map(({ name }) =>
    '<DOMBitmapItem name="' + name + '" href="' + name + '" frameRight="160" frameBottom="160"/>',
  ).join('');
  zip.file('DOMDocument.xml',
    '<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="320" height="240" frameRate="24">' +
    '<media>' + media + '</media>' +
    '<timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Layer"><frames><DOMFrame index="0">' +
    '<elements/></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>',
  );
  for (const { name, bgra } of bitmaps) {
    const pixels = Buffer.alloc(8 * 8 * 4, Buffer.from(bgra));
    const image = nativeImage.createFromBitmap(pixels, { width: 8, height: 8, scaleFactor: 1 });
    zip.file('LIBRARY/' + name, image.toPNG());
  }
  writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

const inspections = [];
const commits = [];
let pngEncodeAttempts = 0;
const markWorkerProgress = FlaImportService.prototype.markWorkerProgress;
FlaImportService.prototype.markWorkerProgress = function (senderId, payload) {
  if (payload?.message?.startsWith('Encoding bitmap ')) pngEncodeAttempts += 1;
  return markWorkerProgress.call(this, senderId, payload);
};
let pickerCancelled = false;
let selectedSource = sourcePath;
let pickerCalls = 0;

// Replace the native picker only. Observe the production IPC results and session store.
dialog.showOpenDialog = async () => {
  pickerCalls += 1;
  return { canceled: selectedSource === null, filePaths: selectedSource ? [selectedSource] : [] };
};
const inspectSource = FlaImportService.prototype.inspectSource;
FlaImportService.prototype.inspectSource = async function (...args) {
  const startedAt = performance.now();
  const response = await inspectSource.apply(this, args);
  inspections.push({ service: this, response, milliseconds: Math.round(performance.now() - startedAt) });
  return response;
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === IPC_CHANNELS.FLA_INSPECT_CHOOSE) {
    return handle(channel, async (event, request) => {
      const response = await handler(event, request);
      pickerCancelled = response.error?.code === 'USER_CANCELLED';
      return response;
    });
  }
  if (channel !== IPC_CHANNELS.FLA_COMMIT_SELECTED) return handle(channel, handler);
  return handle(channel, async (event, request) => {
    const response = await handler(event, request);
    commits.push({ request, response });
    return response;
  });
};

async function waitFor(probe, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function run() {
  if (!sample) await writeSource(sourcePath, mediaCount);
  require(join(dist, 'index.js'));
  const window = await waitFor(
    () => BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Panda Stage'),
    'Panda Stage',
  );
  const evaluate = (fn, ...args) => window.webContents.executeJavaScript(
    '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')',
  );
  const exists = (selector) => evaluate((query) => Boolean(document.querySelector(query)), selector);
  const click = async (selector) => {
    await waitFor(() => exists(selector), selector);
    await evaluate((query) => document.querySelector(query).click(), selector);
  };

  await click('[data-testid="new-project-button"]');
  await waitFor(() => exists('[data-testid="new-project-dialog"]'), 'new project dialog');
  await evaluate((values) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of Object.entries(values)) {
      const input = document.querySelector('[data-testid="' + id + '"]');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { 'new-project-parent-directory': runRoot, 'new-project-name': projectName });
  await click('[data-testid="new-project-confirm"]:enabled');
  await click('[data-activity="assets"]');

  const openReview = '[data-testid="asset-import-fla"]:enabled, [data-testid="resource-asset-import-fla"]:enabled';
  const review = '[data-testid="fla-review-session"]';
  const closeReview = '[data-testid="fla-review-cancel"]:enabled';
  const rasterPrefix = 'fla-c03-focus-raster-';
  await click(openReview);
  const inspection = await waitFor(() => inspections[0], 'first FLA inspection');
  assert.equal(inspection.response.ok, true, JSON.stringify(inspection.response.error));
  const { service, response: { sessionId } } = inspection;
  assert.equal(inspection.response.ir.media.length, mediaCount);
  assert.ok(inspection.response.ir.media.every((entry) => !entry.payload));
  const candidates = await waitFor(async () => {
    const ids = await evaluate((prefix) =>
      [...document.querySelectorAll('[data-testid^="' + prefix + '"]')].map((button) => button.dataset.testid),
    rasterPrefix);
    return ids.length === mediaCount ? new Set(ids) : null;
  }, 'complete raster catalog');
  const chosen = wantedNames.map((name) => {
    const matches = inspection.response.ir.media.filter((entry) => entry.name.endsWith(name));
    assert.equal(matches.length, 1, 'Expected one bitmap matching ' + name);
    const id = rasterPrefix + matches[0].id;
    assert.ok(candidates.has(id));
    return id;
  });
  await waitFor(() => exists('[data-testid="fla-c03-catalog-progress"][data-phase="ready"]'), 'catalog ready');
  const encodesBeforeSelection = pngEncodeAttempts;
  assert.equal(encodesBeforeSelection, 0, 'Opening the review started bitmap encoding');

  async function importRaster(candidate, index) {
    await click('[data-testid="' + candidate + '"]');
    const mediaId = candidate.slice(rasterPrefix.length);
    await waitFor(() => evaluate((id) => {
      const image = document.querySelector('[data-testid="fla-c03-focused-raster-preview"]');
      return image?.dataset.previewTargetId === id && image.complete && image.naturalWidth > 0;
    }, mediaId), 'focused bitmap preview');
    await click('[data-testid="fla-single-import"]:enabled, [data-testid="fla-c03-import"]:enabled');
    const { request, response } = await waitFor(() => commits[index], 'raster commit ' + (index + 1));
    assert.equal(request.sessionId, sessionId);
    assert.deepEqual(request.selectedMediaIds, [candidate.slice(rasterPrefix.length)]);
    assert.equal(response.ok, true, JSON.stringify(response.error));
    assert.equal(response.status, 'completed');
    await waitFor(() => exists(closeReview), 'review unlocked after commit');
    return response;
  }

  const first = await importRaster(chosen[0], 0);
  const second = await importRaster(chosen[1], 1);
  assert.equal(inspections.length, 1);
  assert.equal(pngEncodeAttempts, mediaCount, 'Compatibility processing should run once per review');
  assert.equal(pickerCalls, 1);
  assert.equal(first.summary.importedCount, 1);
  assert.equal(second.summary.importedCount, 1);
  assert.notEqual(first.results[0].sha256, second.results[0].sha256);
  assert.equal(commits[1].request.baseRevision, first.savedRevision);

  const duplicate = await importRaster(chosen[0], 2);
  assert.equal(duplicate.summary.duplicateCount, 1);
  assert.equal(duplicate.results[0].duplicateOfAssetId, first.results[0].asset.id);
  assert.equal(duplicate.projectChanged, false);
  assert.ok(service.getSession(sessionId), 'Duplicate-only commit ended the review session');

  await click(closeReview);
  await waitFor(() => !service.getSession(sessionId), 'review close releasing its Main session');
  const assetIds = [first.results[0].asset.id, second.results[0].asset.id];
  for (const assetId of assetIds) {
    await waitFor(() => exists('[data-testid="asset-browser-view"] [data-asset-id="' + assetId + '"]'), 'imported Asset Library card');
  }
  const project = JSON.parse(readFileSync(join(runRoot, projectName + '.pandastage', 'project.json'), 'utf8'));
  assert.deepEqual(project.assets.map(({ id }) => id).sort(), assetIds.sort());

  selectedSource = join(runRoot, 'replacement.fla');
  await writeSource(selectedSource);
  await click(openReview);
  const replacement = await waitFor(() => inspections[1], 'replacement FLA inspection');
  assert.equal(replacement.response.ok, true);
  assert.equal(replacement.response.ir.source.basename, 'replacement.fla');
  assert.notEqual(replacement.response.sessionId, sessionId);
  assert.equal(service.getSession(sessionId), null);
  await click(closeReview);
  await waitFor(() => !service.getSession(replacement.response.sessionId), 'replacement session released');
  await waitFor(async () => !(await exists(review)), 'replacement review closed');

  selectedSource = null;
  await click(openReview);
  await waitFor(async () => pickerCancelled && await exists(openReview), 'native picker cancellation returning to Asset Library');
  assert.equal(inspections.length, 2);
  assert.equal(pickerCalls, 3);
  assert.equal(await exists(review), false);
  console.log(JSON.stringify({
    status: 'PASS', runRoot, assetIds, mediaCount, encodesBeforeSelection,
    inspectMs: inspection.milliseconds, compatibilityEncodeAttempts: pngEncodeAttempts,
  }));
}

app.whenReady().then(run).then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    console.error('Acceptance directory:', runRoot);
    app.exit(1);
  },
);
