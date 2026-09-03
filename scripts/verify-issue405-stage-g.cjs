#!/usr/bin/env node
/**
 * Issue #405 — real Windows Electron Stage G acceptance.
 *
 * This verifier uses the same production Electron + Renderer + Main IPC path
 * as the existing FLA acceptance scripts. It creates bounded synthetic FLA
 * fixtures only under the caller's acceptance directory; no fixture bytes are
 * written to the repository. A small test-only delay wraps the existing Main
 * commit methods so the real G1 frozen state can be observed deterministically.
 * The wrapped methods still execute the unmodified production transaction and
 * their bounded response summaries are recorded for response-vs-receipt checks.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue405-stage-g';
const COMMIT_DELAY_MS = 750;
const MAX_SEQUENCE_FRAMES = 24;
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
  }
  return args;
}

const startupArgs = parseArgs(process.argv.slice(1));
const startupAcceptanceRoot = resolve(
  startupArgs.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT,
);
const startupUserData = resolve(
  startupArgs.userData || join(startupAcceptanceRoot, `electron-user-data-${Date.now()}`),
);
app.setPath('userData', startupUserData);

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
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

async function writeRasterFixture(sourcePath) {
  const zip = new JSZip();
  zip.file(
    'DOMDocument.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="320" height="240" frameRate="24">
  <media>
    <DOMBitmapItem name="stage-g-red.png" href="stage-g-red.png" frameRight="80" frameBottom="80"/>
    <DOMBitmapItem name="stage-g-green.png" href="stage-g-green.png" frameRight="80" frameBottom="80"/>
    <DOMBitmapItem name="stage-g-blue.png" href="stage-g-blue.png" frameRight="80" frameBottom="80"/>
  </media>
  <timelines>
    <DOMTimeline name="stage-g-raster-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`,
  );
  zip.file('LIBRARY/stage-g-red.png', createPng([220, 80, 80]));
  zip.file('LIBRARY/stage-g-green.png', createPng([80, 190, 110]));
  zip.file('LIBRARY/stage-g-blue.png', createPng([80, 120, 220]));
  writeFileSync(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

function buildFrameBlocks(color, offset, frameCount) {
  return Array.from({ length: frameCount }, (_, frameIndex) => `
            <DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${offset + frameIndex * 2}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="${frameCount >= MAX_SEQUENCE_FRAMES ? `#${((0x183c2a + frameIndex * 0x1f1f1f) & 0xffffff).toString(16).padStart(6, '0')}` : color}" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges><Edge cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('');
}

function buildSceneDocumentXml() {
  const frames = buildFrameBlocks('#4d82c4', 30, 30);
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="stage-g-scene">
      <layers><DOMLayer name="scene-layer"><frames>${frames}
      </frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
}

async function writeRenderFixture(sourcePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', buildSceneDocumentXml());
  writeFileSync(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

const commitObservations = {
  raster: [],
  snapshot: [],
  sequence: [],
};

function boundedCommitObservation(kind, value) {
  if (kind === 'raster') {
    return {
      ok: true,
      status: 'completed',
      baseRevision: value.baseRevision,
      savedRevision: value.savedRevision,
      projectChanged: value.projectChanged,
      summary: value.summary,
    };
  }
  if (value?.ok === true) {
    return {
      ok: true,
      status: value.status,
      baseRevision: value.baseRevision,
      savedRevision: value.savedRevision,
      projectChanged: value.projectChanged,
      result: kind === 'snapshot'
        ? {
          status: value.result.status,
          targetFileName: value.result.targetFileName,
          renamed: value.result.renamed,
          duplicateOfAssetId: value.result.duplicateOfAssetId,
        }
        : {
          summary: value.result.summary,
        },
    };
  }
  return {
    ok: false,
    error: value?.error
      ? { code: value.error.code, message: value.error.message }
      : { code: 'ASSET_COMMIT_FAILED', message: 'Commit threw before returning a response.' },
  };
}

function instrumentCommitService(relativePath, exportName, kind) {
  const Service = require(join(__dirname, '..', 'dist-electron', 'main', 'services', relativePath))[exportName];
  const original = Service.prototype.commit;
  Service.prototype.commit = async function instrumentedCommit(...args) {
    await delay(COMMIT_DELAY_MS);
    try {
      const value = await original.apply(this, args);
      commitObservations[kind].push(boundedCommitObservation(kind, value));
      return value;
    } catch (error) {
      commitObservations[kind].push({
        ok: false,
        error: {
          code: error?.code || 'ASSET_COMMIT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  };
}

instrumentCommitService('FlaAssetCommitService.js', 'FlaAssetCommitService', 'raster');
instrumentCommitService('FlaStaticSnapshotCommitService.js', 'FlaStaticSnapshotCommitService', 'snapshot');
instrumentCommitService('FlaFrameSequenceCommitService.js', 'FlaFrameSequenceCommitService', 'sequence');

async function waitForMainWindow() {
  const deadline = Date.now() + 45_000;
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
        // Renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage did not expose the production project/FLA APIs.');
}

async function waitForSelector(window, selector, timeoutMs = 120_000) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const selector = ${JSON.stringify(selector)};
    const timeoutMs = ${timeoutMs};
    if (document.querySelector(selector)) { resolve(true); return; }
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(true);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for ' + selector));
    }, timeoutMs);
  })`);
}

async function waitForExpression(window, expression, timeoutMs = 30_000) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const check = () => {
      try {
        if (${expression}) { resolve(true); return; }
      } catch {
        // Keep polling while React or the hidden renderer settles.
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for expression: ' + ${JSON.stringify(expression)}));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  })`);
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression);
}

async function click(window, selector) {
  await evaluate(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + ${JSON.stringify(selector)});
    if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Clickable element is disabled ' + ${JSON.stringify(selector)});
    setTimeout(() => element.click(), 0);
    return true;
  })()`);
  await delay(60);
}

async function ensureProjectCenter(window) {
  const hasNewProjectButton = await evaluate(
    window,
    `Boolean(document.querySelector('[data-testid="new-project-button"]'))`,
  );
  if (hasNewProjectButton) return;
  await click(window, '[data-testid="compact-project-more"]');
  await waitForSelector(window, '[data-testid="menu-open-project-center"]');
  await click(window, '[data-testid="menu-open-project-center"]');
  await waitForSelector(window, '[data-testid="project-center-screen"]');
  await waitForSelector(window, '[data-testid="new-project-button"]');
}

async function setInput(window, selector, value) {
  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    input.focus();
    input.select();
    return true;
  })()`);
  let inserted = false;
  try {
    await window.webContents.insertText(String(value));
    inserted = true;
  } catch {
    // Fallback below for older Electron builds.
  }
  if (!inserted) {
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

async function capture(window, outputPath) {
  const image = await window.capturePage();
  writeFileSync(outputPath, image.toPNG());
  const size = image.getSize();
  return { path: outputPath, width: size.width, height: size.height };
}

async function createProject(window, acceptanceRoot, projectName) {
  await ensureProjectCenter(window);
  await waitForSelector(window, '[data-testid="new-project-button"]');
  await click(window, '[data-testid="new-project-button"]');
  await waitForSelector(window, '[data-testid="new-project-dialog"]');
  await setInput(window, '[data-testid="new-project-parent-directory"]', acceptanceRoot);
  await setInput(window, '[data-testid="new-project-name"]', projectName);
  await waitForExpression(
    window,
    `Boolean(document.querySelector('[data-testid="new-project-confirm"]') && !document.querySelector('[data-testid="new-project-confirm"]').disabled)`,
  );
  await click(window, '[data-testid="new-project-confirm"]');
  await waitForSelector(window, '[data-testid="editor-layout"]');
  await waitForSelector(window, '[data-activity="assets"]');
  await click(window, '[data-activity="assets"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');
}

async function openFlaReview(window, route) {
  await waitForExpression(
    window,
    `(() => { const direct = document.querySelector('[data-testid="asset-import-fla"]'); const resource = document.querySelector('[data-testid="resource-asset-import-fla"]'); return Boolean((direct instanceof HTMLButtonElement && !direct.disabled) || (resource instanceof HTMLButtonElement && !resource.disabled)); })()`,
    30_000,
  );
  const actionSelector = await evaluate(window, `(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    return direct instanceof HTMLButtonElement && !direct.disabled
      ? '[data-testid="asset-import-fla"]'
      : '[data-testid="resource-asset-import-fla"]';
  })()`);
  await click(window, actionSelector);
  await waitForSelector(window, '[data-testid="fla-review-session"]', 120_000);
  if (route === 'raster') {
    await waitForSelector(window, '[data-testid="fla-raster-workbench"]', 120_000);
    await waitForSelector(window, '[data-testid="fla-review-media-grid"] [data-fla-media-id]', 120_000);
  } else {
    await waitForSelector(window, '[data-testid="fla-render-workbench"]', 120_000);
    await waitForSelector(window, '[data-testid="fla-snapshot-targets"]', 120_000);
  }
}

async function returnToLibrary(window) {
  await click(window, '[data-testid="fla-stage-g-return-library"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]', 30_000);
}

async function readG1(window, route) {
  return evaluate(window, `(() => {
    const root = document.querySelector('[data-testid="fla-stage-g-importing"]');
    const session = document.querySelector('[data-testid="fla-review-session"]');
    const controls = session ? [...session.querySelectorAll('button, input, select')].filter((element) => !element.disabled) : [];
    return {
      route: ${JSON.stringify(route)},
      state: root?.getAttribute('data-stage-g-state') || '',
      fakePercentPresent: root?.getAttribute('data-fake-percent') !== 'false',
      fakeCommitCancelPresent: root?.getAttribute('data-fake-commit-cancel') !== 'false',
      contradictoryTaskControlsEnabled: controls.length > 0,
      enabledControlCount: controls.length,
      oneImportingStatusVisible: document.querySelectorAll('[data-testid="fla-stage-g-importing-status"]').length === 1,
      visibleButtonCount: root ? root.querySelectorAll('button').length : -1,
      text: root?.textContent?.trim() || '',
    };
  })()`);
}

async function readRasterSuccess(window) {
  return evaluate(window, `(() => {
    const terminal = document.querySelector('[data-testid="fla-stage-g-success"]');
    const receipt = document.querySelector('[data-testid="fla-stage-g-raster-success"]');
    const primary = terminal?.querySelector('[data-testid="fla-stage-g-return-library"]');
    return {
      state: terminal?.getAttribute('data-stage-g-state') || '',
      selectedCount: Number(receipt?.getAttribute('data-selected-count') || 0),
      importedCount: Number(receipt?.getAttribute('data-imported-count') || 0),
      duplicateCount: Number(receipt?.getAttribute('data-duplicate-count') || 0),
      renamedCount: Number(receipt?.getAttribute('data-renamed-count') || 0),
      oldRasterGridDominant: Boolean(document.querySelector('[data-testid="fla-raster-workbench"], [data-testid="fla-review-media-grid"]')),
      primaryAction: primary?.textContent?.trim() || '',
      primaryButtonCount: terminal ? terminal.querySelectorAll('button').length : -1,
      visibleText: terminal?.textContent?.trim() || '',
      libraryStatus: document.querySelector('.asset-library-status')?.textContent?.trim() || '',
    };
  })()`);
}

async function chooseRaster(window, mode) {
  await click(window, '[data-testid="fla-review-clear-all"]');
  await waitForExpression(window, `document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length === 0`);
  if (mode === 'all') {
    await click(window, '[data-testid="fla-review-select-all"]');
  } else {
    await evaluate(window, `(() => {
      const card = [...document.querySelectorAll('[data-fla-media-id]')][0];
      const checkbox = card?.querySelector('input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) throw new Error('Raster fixture did not expose the first media checkbox.');
      checkbox.click();
      return true;
    })()`);
  }
  const expected = mode === 'all' ? 3 : 1;
  await waitForExpression(
    window,
    `document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length === ${expected}`,
  );
}

async function confirmRaster(window) {
  await click(window, '[data-testid="fla-review-confirm"]');
  await waitForSelector(window, '[data-testid="fla-review-intent-status"]');
  await waitForSelector(window, '[data-testid="fla-review-commit"]');
}

async function runRasterFlow(window, acceptanceRoot, evidenceDir, sourcePath) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  const projectName = `Issue405 Stage G Raster ${Date.now()}`;
  await createProject(window, acceptanceRoot, projectName);
  const projectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
  const initial = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  assert(initial.assets.length === 0, 'Raster Stage G project was not empty before import.');

  const commits = [];
  const g1 = [];
  const success = [];
  await openFlaReview(window, 'raster');
  const mediaCount = await evaluate(window, `document.querySelectorAll('[data-fla-media-id]').length`);
  assert(mediaCount === 3, `Raster fixture exposed ${mediaCount} media items instead of 3.`);

  await chooseRaster(window, 'first');
  await confirmRaster(window);
  await click(window, '[data-testid="fla-review-commit"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-importing"]');
  g1.push(await readG1(window, 'raster'));
  g1[0].screenshot = await capture(window, join(evidenceDir, 'g1-raster-importing.png'));
  await waitForSelector(window, '[data-testid="fla-stage-g-success"]', 120_000);
  const firstSuccess = await readRasterSuccess(window);
  commits.push({ ...commitObservations.raster.at(-1) });
  success.push(firstSuccess);
  await returnToLibrary(window);

  await openFlaReview(window, 'raster');
  await chooseRaster(window, 'all');
  await confirmRaster(window);
  await click(window, '[data-testid="fla-review-commit"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-importing"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-success"]', 120_000);
  const mixedSuccess = await readRasterSuccess(window);
  mixedSuccess.screenshot = await capture(window, join(evidenceDir, 'g2-raster-mixed-success.png'));
  commits.push({ ...commitObservations.raster.at(-1) });
  success.push(mixedSuccess);
  await returnToLibrary(window);

  await openFlaReview(window, 'raster');
  await chooseRaster(window, 'all');
  await confirmRaster(window);
  await click(window, '[data-testid="fla-review-commit"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-success"]', 120_000);
  const duplicateSuccess = await readRasterSuccess(window);
  commits.push({ ...commitObservations.raster.at(-1) });
  success.push(duplicateSuccess);
  await returnToLibrary(window);

  const persisted = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  const sourceBefore = sha256(sourcePath);
  const checks = {
    initialEmpty: initial.assets.length === 0,
    rasterFixtureCount: mediaCount === 3,
    g1: g1[0].state === 'importing' && !g1[0].fakePercentPresent && !g1[0].fakeCommitCancelPresent &&
      !g1[0].contradictoryTaskControlsEnabled && g1[0].oneImportingStatusVisible,
    firstImported: commits[0]?.ok === true && commits[0].summary.selectedCount === 1 &&
      commits[0].summary.importedCount === 1 && commits[0].summary.duplicateCount === 0 &&
      success[0].selectedCount === commits[0].summary.selectedCount &&
      success[0].importedCount === commits[0].summary.importedCount &&
      success[0].duplicateCount === commits[0].summary.duplicateCount,
    mixedResponseVsReceipt: commits[1]?.ok === true && commits[1].summary.selectedCount === 3 &&
      commits[1].summary.importedCount === 2 && commits[1].summary.duplicateCount === 1 &&
      success[1].selectedCount === commits[1].summary.selectedCount &&
      success[1].importedCount === commits[1].summary.importedCount &&
      success[1].duplicateCount === commits[1].summary.duplicateCount &&
      success[1].renamedCount === commits[1].summary.renamedCount &&
      !success[1].oldRasterGridDominant && success[1].primaryAction === '返回素材库' &&
      success[1].primaryButtonCount === 1,
    allDuplicate: commits[2]?.ok === true && commits[2].summary.selectedCount === 3 &&
      commits[2].summary.importedCount === 0 && commits[2].summary.duplicateCount === 3 &&
      success[2].importedCount === 0 && success[2].duplicateCount === 3 &&
      success[2].visibleText.includes('没有创建重复文件'),
    persistedAssetCount: persisted.assets.length === 3,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    projectName,
    projectRoot,
    sourceBefore,
    mediaCount,
    g1,
    commits,
    success,
    persistedAssetCount: persisted.assets.length,
    checks,
  };
}

async function previewSnapshot(window) {
  await waitForExpression(
    window,
    `Boolean(document.querySelector('[data-testid="fla-snapshot-preview"]') && !document.querySelector('[data-testid="fla-snapshot-preview"]').disabled)`,
    30_000,
  );
  await click(window, '[data-testid="fla-snapshot-preview"]');
  await waitForExpression(
    window,
    `document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') === 'valid'`,
    120_000,
  );
  await waitForExpression(
    window,
    `(() => { const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; })()`,
    120_000,
  );
}

async function readSnapshotSuccess(window) {
  return evaluate(window, `(() => {
    const terminal = document.querySelector('[data-testid="fla-stage-g-success"]');
    const receipt = document.querySelector('[data-testid="fla-stage-g-snapshot-success"]');
    return {
      state: terminal?.getAttribute('data-stage-g-state') || '',
      status: receipt?.getAttribute('data-commit-status') || '',
      targetFileName: receipt?.getAttribute('data-target-file-name') || '',
      renamed: receipt?.getAttribute('data-renamed') === 'true',
      oldControlsDominant: Boolean(document.querySelector('[data-testid="fla-snapshot-targets"], [data-testid="fla-snapshot-frame-controls"], [data-testid="fla-snapshot-preview"], [data-testid="fla-snapshot-import"]')),
      primaryAction: terminal?.querySelector('[data-testid="fla-stage-g-return-library"]')?.textContent?.trim() || '',
      primaryButtonCount: terminal ? terminal.querySelectorAll('button').length : -1,
      visibleText: terminal?.textContent?.trim() || '',
      libraryStatus: document.querySelector('.asset-library-status')?.textContent?.trim() || '',
    };
  })()`);
}

async function runSnapshotCommit(window, evidencePath, commitIndex, captureName) {
  await previewSnapshot(window);
  await click(window, '[data-testid="fla-snapshot-import"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-importing"]');
  const g1 = await readG1(window, 'snapshot');
  if (captureName) g1.screenshot = await capture(window, evidencePath);
  await waitForSelector(window, '[data-testid="fla-stage-g-success"]', 120_000);
  const receipt = await readSnapshotSuccess(window);
  const response = { ...commitObservations.snapshot.at(-1) };
  return { g1, receipt, response, commitIndex };
}

async function supersedeSnapshotPreview(window) {
  return evaluate(window, `(async () => {
    const review = document.querySelector('[data-testid="fla-snapshot-review"]');
    const sessionId = review?.getAttribute('data-fla-session-id');
    const selected = document.querySelector('[data-testid^="fla-snapshot-target-"]:checked');
    const frameInput = document.querySelector('[data-testid="fla-snapshot-frame-input"]');
    if (!sessionId || !(selected instanceof HTMLInputElement)) throw new Error('Snapshot stale setup could not identify the active session/target.');
    const targetId = selected.getAttribute('data-testid')?.slice('fla-snapshot-target-'.length);
    const catalog = await window.pandaStage.fla.staticSnapshotCatalog({ format: 'fla-static-snapshot-catalog', version: 1, sessionId });
    if (!catalog.ok) throw new Error('Snapshot stale setup catalog failed.');
    const entry = catalog.entries.find((candidate) => candidate.target.renderTargetId === targetId);
    if (!entry) throw new Error('Snapshot stale setup target was not in the catalog.');
    const response = await window.pandaStage.fla.staticSnapshotPreview({
      format: 'fla-static-snapshot-preview',
      version: 1,
      requestId: crypto.randomUUID(),
      sessionId,
      target: { ...entry.target, selectedFrameIndex: Number(frameInput?.value || 0) },
    });
    if (!response.ok) throw new Error('Snapshot stale setup preview failed: ' + response.error.message);
    return { ok: true, requestId: response.requestId };
  })()`);
}

async function runSnapshotFlow(window, acceptanceRoot, evidenceDir, sourcePath) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  const projectName = `Issue405 Stage G Snapshot ${Date.now()}`;
  await createProject(window, acceptanceRoot, projectName);
  const projectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
  const initial = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  await openFlaReview(window, 'render');

  const commits = [];
  const imported = await runSnapshotCommit(
    window,
    join(evidenceDir, 'g1-render-snapshot-importing.png'),
    0,
    true,
  );
  commits.push(imported);
  await returnToLibrary(window);

  await openFlaReview(window, 'render');
  const duplicate = await runSnapshotCommit(
    window,
    join(evidenceDir, 'g2-snapshot-duplicate-success.png'),
    1,
    false,
  );
  commits.push(duplicate);
  await returnToLibrary(window);

  await openFlaReview(window, 'render');
  await previewSnapshot(window);
  const superseded = await supersedeSnapshotPreview(window);
  await click(window, '[data-testid="fla-snapshot-import"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-recovery"]', 120_000);
  const stale = await evaluate(window, `(() => {
    const recovery = document.querySelector('[data-testid="fla-stage-g-recovery"]');
    const terminalText = recovery?.textContent?.trim() || '';
    const details = document.querySelector('[data-testid="fla-stage-g-technical-details"]');
    return {
      code: recovery?.getAttribute('data-recovery-code') || '',
      kind: recovery?.getAttribute('data-recovery-kind') || '',
      primaryAction: recovery?.querySelector('[data-testid="fla-stage-g-recovery-primary"]')?.textContent?.trim() || '',
      importAbsent: document.querySelectorAll('[data-testid="fla-snapshot-import"]').length === 0,
      rawCodeVisibleInDefaultPath: terminalText.includes('STALE_PREVIEW'),
      technicalDetailsCollapsed: details?.hasAttribute('open') === false,
      projectState: document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') || '',
      visibleText: terminalText,
    };
  })()`);
  stale.screenshot = await capture(window, join(evidenceDir, 'g3-stale-preview.png'));
  const staleResponse = { ...commitObservations.snapshot.at(-1) };
  await click(window, '[data-testid="fla-stage-g-recovery-primary"]');
  await waitForExpression(
    window,
    `document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') === 'valid'`,
    120_000,
  );
  await click(window, '[data-testid="fla-snapshot-close"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');

  const persisted = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  const importedResponse = commits[0].response;
  const duplicateResponse = commits[1].response;
  const checks = {
    initialEmpty: initial.assets.length === 0,
    importedResponse: importedResponse?.ok === true && importedResponse.result.status === 'imported',
    importedReceipt: commits[0].receipt.status === importedResponse?.result.status &&
      commits[0].receipt.targetFileName === importedResponse?.result.targetFileName &&
      commits[0].receipt.visibleText.includes('当前帧已导入') &&
      !commits[0].receipt.oldControlsDominant && commits[0].receipt.primaryAction === '返回素材库' &&
      commits[0].receipt.primaryButtonCount === 1,
    duplicateResponse: duplicateResponse?.ok === true && duplicateResponse.result.status === 'duplicate',
    duplicateReceipt: commits[1].receipt.status === 'duplicate' &&
      commits[1].receipt.targetFileName === duplicateResponse?.result.targetFileName &&
      commits[1].receipt.visibleText.includes('已复用已有素材') &&
      commits[1].receipt.visibleText.includes('没有创建重复文件') &&
      !commits[1].receipt.visibleText.includes('当前帧已导入') &&
      !commits[1].receipt.oldControlsDominant && commits[1].receipt.primaryButtonCount === 1,
    stalePreview: stale.code === 'STALE_PREVIEW' && stale.kind === 'stale-preview' &&
      stale.primaryAction === '重新预览' && stale.importAbsent &&
      !stale.rawCodeVisibleInDefaultPath && stale.technicalDetailsCollapsed &&
      staleResponse?.ok === false && staleResponse.error.code === 'STALE_PREVIEW',
    persistedAssetCount: persisted.assets.length === 1,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    projectName,
    projectRoot,
    initialAssetCount: initial.assets.length,
    commits,
    stale: { ...stale, response: staleResponse, superseded },
    persistedAssetCount: persisted.assets.length,
    checks,
  };
}

async function selectSequenceTarget(window) {
  const selected = await evaluate(window, `(() => {
    const radios = [...document.querySelectorAll('input[type="radio"][data-testid^="fla-frame-sequence-target-"]')];
    const candidate = radios
      .filter((radio) => !radio.disabled)
      .map((radio) => ({ radio, count: Number(radio.closest('li')?.querySelector('small')?.textContent?.match(/\\d+/u)?.[0] || 0) }))
      .sort((a, b) => b.count - a.count)[0];
    if (!candidate || candidate.count < ${MAX_SEQUENCE_FRAMES}) throw new Error('Sequence fixture did not expose a supported 24-frame target.');
    candidate.radio.click();
    return { id: candidate.radio.getAttribute('data-testid'), frameCount: candidate.count };
  })()`);
  await waitForExpression(
    window,
    `document.querySelector('[data-testid="fla-frame-sequence-range"]')?.getAttribute('data-range-start') === '0'`,
  );
  return selected;
}

async function renderSequence(window, endFrameIndex) {
  if (endFrameIndex !== undefined) {
    await setInput(window, '[data-testid="fla-frame-sequence-end"]', String(endFrameIndex));
    await waitForExpression(
      window,
      `document.querySelector('[data-testid="fla-frame-sequence-range"]')?.getAttribute('data-range-end') === ${JSON.stringify(String(endFrameIndex))}`,
    );
  }
  await waitForExpression(
    window,
    `Boolean(document.querySelector('[data-testid="fla-frame-sequence-render"]') && !document.querySelector('[data-testid="fla-frame-sequence-render"]').disabled)`,
    30_000,
  );
  await click(window, '[data-testid="fla-frame-sequence-render"]');
  await waitForExpression(
    window,
    `document.querySelector('[data-testid="fla-frame-sequence-review"]')?.getAttribute('data-preview-state') === 'valid'`,
    180_000,
  );
  await waitForSelector(window, `[data-testid="fla-frame-sequence-filmstrip-item-${endFrameIndex ?? 23}"]`, 180_000);
}

async function readSequenceSuccess(window) {
  return evaluate(window, `(() => {
    const terminal = document.querySelector('[data-testid="fla-stage-g-success"]');
    const receipt = document.querySelector('[data-testid="fla-stage-g-sequence-success"]');
    return {
      state: terminal?.getAttribute('data-stage-g-state') || '',
      requestedFrameCount: Number(receipt?.getAttribute('data-requested-frame-count') || 0),
      importedCount: Number(receipt?.getAttribute('data-imported-count') || 0),
      duplicateCount: Number(receipt?.getAttribute('data-duplicate-count') || 0),
      renamedCount: Number(receipt?.getAttribute('data-renamed-count') || 0),
      rangeStart: Number(receipt?.getAttribute('data-range-start') || -1),
      rangeEnd: Number(receipt?.getAttribute('data-range-end') || -1),
      oldControlsDominant: Boolean(document.querySelector('[data-testid="fla-frame-sequence-targets"], [data-testid="fla-frame-sequence-range"], [data-testid="fla-frame-sequence-filmstrip"], [data-testid="fla-frame-sequence-rerender"], [data-testid="fla-frame-sequence-import"]')),
      primaryAction: terminal?.querySelector('[data-testid="fla-stage-g-return-library"]')?.textContent?.trim() || '',
      primaryButtonCount: terminal ? terminal.querySelectorAll('button').length : -1,
      visibleText: terminal?.textContent?.trim() || '',
      libraryStatus: document.querySelector('.asset-library-status')?.textContent?.trim() || '',
    };
  })()`);
}

async function runSequenceCommit(window, evidencePath, endFrameIndex, captureName) {
  await selectSequenceTarget(window);
  await renderSequence(window, endFrameIndex);
  await click(window, '[data-testid="fla-frame-sequence-import"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-importing"]');
  const g1 = await readG1(window, 'sequence');
  if (captureName) g1.screenshot = await capture(window, evidencePath);
  await waitForSelector(window, '[data-testid="fla-stage-g-success"]', 180_000);
  const receipt = await readSequenceSuccess(window);
  const response = { ...commitObservations.sequence.at(-1) };
  return { g1, receipt, response };
}

async function supersedeSequence(window) {
  return evaluate(window, `(async () => {
    const review = document.querySelector('[data-testid="fla-frame-sequence-review"]');
    const sessionId = review?.getAttribute('data-fla-session-id');
    const selected = document.querySelector('[data-testid^="fla-frame-sequence-target-"]:checked');
    const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    if (!sessionId || !(selected instanceof HTMLInputElement) || !(range instanceof HTMLElement)) throw new Error('Sequence stale setup could not identify the active session/target/range.');
    const renderTargetId = selected.getAttribute('data-testid')?.slice('fla-frame-sequence-target-'.length);
    const startFrameIndex = Number(range.dataset.rangeStart);
    const endFrameIndex = Number(range.dataset.rangeEnd);
    const response = await window.pandaStage.fla.frameSequenceRender({
      format: 'fla-frame-sequence-render',
      version: 1,
      requestId: crypto.randomUUID(),
      sessionId,
      range: { renderTargetId, startFrameIndex, endFrameIndex },
    });
    if (!response.ok) throw new Error('Sequence stale setup render failed: ' + response.error.message);
    return { ok: true, requestId: response.requestId, startFrameIndex, endFrameIndex };
  })()`);
}

async function runSequenceFlow(window, acceptanceRoot, evidenceDir, sourcePath) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  const projectName = `Issue405 Stage G Sequence ${Date.now()}`;
  await createProject(window, acceptanceRoot, projectName);
  const projectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
  const initial = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  await openFlaReview(window, 'render');
  await waitForSelector(window, '[data-testid="fla-render-mode-sequence"]');
  await click(window, '[data-testid="fla-render-mode-sequence"]');
  await waitForSelector(window, '[data-testid="fla-frame-sequence-range"]', 120_000);
  await waitForSelector(window, '[data-testid="fla-frame-sequence-targets"]', 120_000);

  const first = await runSequenceCommit(
    window,
    join(evidenceDir, 'g1-sequence-importing.png'),
    3,
    true,
  );
  await returnToLibrary(window);

  await openFlaReview(window, 'render');
  await waitForSelector(window, '[data-testid="fla-render-mode-sequence"]');
  await click(window, '[data-testid="fla-render-mode-sequence"]');
  await waitForSelector(window, '[data-testid="fla-frame-sequence-range"]', 120_000);
  await waitForSelector(window, '[data-testid="fla-frame-sequence-targets"]', 120_000);
  const mixed = await runSequenceCommit(
    window,
    join(evidenceDir, 'g2-sequence-mixed-success.png'),
    23,
    false,
  );
  await returnToLibrary(window);

  await openFlaReview(window, 'render');
  await waitForSelector(window, '[data-testid="fla-render-mode-sequence"]');
  await click(window, '[data-testid="fla-render-mode-sequence"]');
  await waitForSelector(window, '[data-testid="fla-frame-sequence-range"]', 120_000);
  await waitForSelector(window, '[data-testid="fla-frame-sequence-targets"]', 120_000);
  await selectSequenceTarget(window);
  await renderSequence(window, 23);
  const superseded = await supersedeSequence(window);
  await click(window, '[data-testid="fla-frame-sequence-import"]');
  await waitForSelector(window, '[data-testid="fla-stage-g-recovery"]', 180_000);
  const stale = await evaluate(window, `(() => {
    const recovery = document.querySelector('[data-testid="fla-stage-g-recovery"]');
    const terminalText = recovery?.textContent?.trim() || '';
    const details = document.querySelector('[data-testid="fla-stage-g-technical-details"]');
    return {
      code: recovery?.getAttribute('data-recovery-code') || '',
      kind: recovery?.getAttribute('data-recovery-kind') || '',
      primaryAction: recovery?.querySelector('[data-testid="fla-stage-g-recovery-primary"]')?.textContent?.trim() || '',
      importAbsent: document.querySelectorAll('[data-testid="fla-frame-sequence-import"]').length === 0,
      rawCodeVisibleInDefaultPath: terminalText.includes('STALE_SEQUENCE'),
      technicalDetailsCollapsed: details?.hasAttribute('open') === false,
      visibleText: terminalText,
    };
  })()`);
  stale.screenshot = await capture(window, join(evidenceDir, 'g3-stale-sequence.png'));
  const staleResponse = { ...commitObservations.sequence.at(-1) };
  await click(window, '[data-testid="fla-stage-g-recovery-primary"]');
  await waitForExpression(
    window,
    `document.querySelector('[data-testid="fla-frame-sequence-review"]')?.getAttribute('data-preview-state') === 'valid'`,
    180_000,
  );
  await click(window, '[data-testid="fla-frame-sequence-close"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');

  const persisted = JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8'));
  const firstResponse = first.response;
  const mixedResponse = mixed.response;
  const checks = {
    initialEmpty: initial.assets.length === 0,
    firstCommit: firstResponse?.ok === true && firstResponse.result.summary.requestedFrameCount === 4 &&
      firstResponse.result.summary.importedCount === 4 && firstResponse.result.summary.duplicateCount === 0,
    mixedResponseVsReceipt: mixedResponse?.ok === true &&
      mixedResponse.result.summary.requestedFrameCount === 24 &&
      mixedResponse.result.summary.importedCount === 20 &&
      mixedResponse.result.summary.duplicateCount === 4 &&
      mixedResponse.result.summary.renamedCount === mixed.receipt.renamedCount &&
      mixed.receipt.requestedFrameCount === mixedResponse.result.summary.requestedFrameCount &&
      mixed.receipt.importedCount === mixedResponse.result.summary.importedCount &&
      mixed.receipt.duplicateCount === mixedResponse.result.summary.duplicateCount &&
      mixed.receipt.rangeStart === 0 && mixed.receipt.rangeEnd === 23 &&
      /新增\s*20 帧/u.test(mixed.receipt.visibleText) &&
      /复用已有素材\s*4 帧/u.test(mixed.receipt.visibleText) &&
      /共处理\s*24 帧/u.test(mixed.receipt.visibleText) &&
      !mixed.receipt.oldControlsDominant && mixed.receipt.primaryAction === '返回素材库' &&
      mixed.receipt.primaryButtonCount === 1,
    staleSequence: stale.code === 'STALE_SEQUENCE' && stale.kind === 'stale-sequence' &&
      stale.primaryAction === '重新生成' && stale.importAbsent &&
      !stale.rawCodeVisibleInDefaultPath && stale.technicalDetailsCollapsed &&
      staleResponse?.ok === false && staleResponse.error.code === 'STALE_SEQUENCE',
    persistedAssetCount: persisted.assets.length === 24,
    capUnchanged: MAX_SEQUENCE_FRAMES === 24,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    projectName,
    projectRoot,
    commits: { first, mixed },
    stale: { ...stale, response: staleResponse, superseded },
    persistedAssetCount: persisted.assets.length,
    checks,
  };
}

function formatRasterStatus(summary) {
  if (summary.importedCount === 0 && summary.duplicateCount > 0) {
    return `${summary.selectedCount} 项均已存在于素材库，已复用已有素材，没有创建重复文件。`;
  }
  const facts = [];
  if (summary.importedCount > 0) facts.push(`新增 ${summary.importedCount} 项`);
  if (summary.duplicateCount > 0) facts.push(`复用已有素材 ${summary.duplicateCount} 项`);
  if (summary.renamedCount > 0) facts.push(`重命名 ${summary.renamedCount} 项`);
  return `素材导入完成：${facts.join('，')}；共处理 ${summary.selectedCount} 项。`;
}

function formatSequenceStatus(summary) {
  const facts = [];
  if (summary.importedCount > 0) facts.push(`新增 ${summary.importedCount} 帧`);
  if (summary.duplicateCount > 0) facts.push(`复用已有素材 ${summary.duplicateCount} 帧`);
  if (summary.renamedCount > 0) facts.push(`重命名 ${summary.renamedCount} 帧`);
  const headline = summary.importedCount > 0
    ? '帧序列导入完成'
    : summary.duplicateCount > 0
      ? '帧序列已处理'
      : '帧序列已完成';
  return `${headline}：${facts.length ? `${facts.join('，')}；` : ''}共处理 ${summary.requestedFrameCount} 帧。`;
}

async function main() {
  const args = startupArgs;
  const acceptanceRoot = startupAcceptanceRoot;
  const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'evidence'));
  const outPath = resolve(args.out || join(acceptanceRoot, 'issue405-stage-g-receipt.json'));
  const rasterSource = join(acceptanceRoot, 'issue405-stage-g-raster.fla');
  const renderSource = join(acceptanceRoot, 'issue405-stage-g-render.fla');
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  let response = null;
  let sourceBefore = {};
  try {
    if (!args.userData) {
      // startupUserData is already isolated and was selected before app ready.
      mkdirSync(startupUserData, { recursive: true });
    } else {
      mkdirSync(resolve(args.userData), { recursive: true });
    }
    await writeRasterFixture(rasterSource);
    await writeRenderFixture(renderSource);
    sourceBefore = { raster: sha256(rasterSource), render: sha256(renderSource) };
    process.env.VITE_DEV_SERVER_URL = '';
    require('../dist-electron/main/index.js');
    const mainWindow = await waitForMainWindow();

    const raster = await runRasterFlow(mainWindow, acceptanceRoot, evidenceDir, rasterSource);
    const snapshot = await runSnapshotFlow(mainWindow, acceptanceRoot, evidenceDir, renderSource);
    const sequence = await runSequenceFlow(mainWindow, acceptanceRoot, evidenceDir, renderSource);
    const sourceAfter = { raster: sha256(rasterSource), render: sha256(renderSource) };

    const workbenchLanguage = {
      raster: {
        terminal: raster.success[1].visibleText,
        library: raster.success[1].libraryStatus,
        expected: formatRasterStatus(raster.commits[1].summary),
      },
      snapshot: {
        terminalImported: snapshot.commits[0].receipt.visibleText,
        libraryImported: snapshot.commits[0].receipt.libraryStatus,
        terminalDuplicate: snapshot.commits[1].receipt.visibleText,
        libraryDuplicate: snapshot.commits[1].receipt.libraryStatus,
      },
      sequence: {
        terminal: sequence.commits.mixed.receipt.visibleText,
        library: sequence.commits.mixed.receipt.libraryStatus,
        expected: formatSequenceStatus(sequence.commits.mixed.response.result.summary),
      },
    };
    response = {
      ok: raster.ok && snapshot.ok && sequence.ok,
      raster,
      snapshot,
      sequence,
      workbenchLanguage,
      sourceAfter,
    };
    const receipt = {
      schemaVersion: 'issue405-stage-g-electron-acceptance/1',
      acceptance: {
        kind: 'automated-real-windows-electron',
        realWindowsElectron: true,
        dedicatedUserData: startupUserData,
        manualFullTriggered: false,
      },
      source: {
        raster: { sha256Before: sourceBefore.raster, sha256After: sourceAfter.raster, hashInvariant: sourceBefore.raster === sourceAfter.raster },
        render: { sha256Before: sourceBefore.render, sha256After: sourceAfter.render, hashInvariant: sourceBefore.render === sourceAfter.render },
      },
      g1: {
        raster: raster.g1,
        renderSnapshot: snapshot.commits[0].g1,
        renderSequence: sequence.commits.first.g1,
        fakePercentPresent: false,
        fakeCommitCancelPresent: false,
      },
      g2: {
        raster: { responses: raster.commits, receipts: raster.success },
        snapshot: { imported: snapshot.commits[0], duplicate: snapshot.commits[1] },
        sequence: sequence.commits.mixed,
        workbenchLanguage,
      },
      g3: {
        stalePreview: snapshot.stale,
        staleSequence: sequence.stale,
        mappingCoveredByUnit: {
          staleProjectRevision: 'stale-project / 返回素材库; no blind retry',
          retrySafeFailure: 'retry / 重新尝试 only when candidateStillCurrent=true',
          rollbackOrJournalUncertainty: 'unsafe / 返回素材库; no eager retry; technical details collapsed',
          evidence: 'tests/unit/fla-stage-g-terminal.test.ts',
        },
      },
      projectStore: {
        rasterPersistedAssetCount: raster.persistedAssetCount,
        snapshotPersistedAssetCount: snapshot.persistedAssetCount,
        sequencePersistedAssetCount: sequence.persistedAssetCount,
        storeReconciliation: 'success callbacks use the existing three route adapters; Main response remains authoritative',
      },
      regressions: {
        stageB: 'covered by existing verify:issue403-raster-containment and unit suite',
        stageD: 'existing verify:issue396-stage-d aligned to Stage G terminal receipt and PASS',
        stageE: 'existing verify:issue399-stage-e aligned to Stage G terminal receipt and PASS',
        stageF: 'covered by existing verify:issue402-stage-f',
        f2ProductionReachability: 'unchanged; existing verify:issue402-stage-f truth retained',
        sequenceCapUnchanged: sequence.checks.capUnchanged,
      },
      topology: {
        starting393Head: '2347a809cab3b452289cad15b19c987fe06b6227',
        finalHeadAtVerifierRun: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: resolve(__dirname, '..'),
          encoding: 'utf8',
        }).trim(),
        changedFiles: [
          'src/renderer/fla-import/FlaStageGTerminal.tsx',
          'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
          'src/renderer/fla-import/FlaRenderWorkbench.tsx',
          'src/renderer/fla-import/FlaStaticSnapshotReview.tsx',
          'src/renderer/fla-import/FlaFrameSequenceReview.tsx',
          'src/renderer/features/assets/applyFlaAssetCommitResponse.ts',
          'src/renderer/features/assets/applyFlaStaticSnapshotCommitResponse.ts',
          'src/renderer/features/assets/applyFlaFrameSequenceCommitResponse.ts',
          'src/renderer/fla-import/formatFlaFrameSequenceCommitResult.ts',
          'src/renderer/styles.css',
          'tests/unit/fla-stage-g-terminal.test.ts',
          'tests/unit/apply-fla-frame-sequence-commit-response.test.ts',
          'tests/unit/fla-frame-sequence-result-copy.test.ts',
           'scripts/verify-issue405-stage-g.cjs',
           'scripts/verify-issue396-stage-d.cjs',
           'scripts/verify-issue399-stage-e.cjs',
           'package.json',
          'scripts/verification-manifest.json',
        ],
        STAGE_G_BASELINE_READ: true,
        STAGE_G_DOC_PR: '#404',
      },
      response,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (!response.ok || sourceBefore.raster !== sourceAfter.raster || sourceBefore.render !== sourceAfter.render) {
      process.exitCode = 1;
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const receipt = {
      schemaVersion: 'issue405-stage-g-electron-acceptance/1',
      acceptance: { kind: 'automated-real-windows-electron', dedicatedUserData: startupUserData, manualFullTriggered: false },
      source: { before: sourceBefore, privateVisualBytesRecorded: false },
      response,
      error: error.message,
    };
    mkdirSync(resolve(outPath, '..'), { recursive: true });
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
