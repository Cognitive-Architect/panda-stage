/*
 * Issue #257 / FLA V1 Slice 3: real Windows Electron commit probe.
 *
 * This verifier drives the accepted Slice 2 surface, commits three
 * representative rasters through the explicit Slice 3 action, and then
 * verifies the ordinary Project/Asset files and thumbnail IPC after reopen.
 * Failure injection and restart-recovery coverage lives in the focused unit
 * suite so this probe remains a bounded, repeatable real-sample run.
 */
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');

const stressRun = process.env.PANDA_STAGE_FLA_STRESS === '1';
const samplePath = 'D:\\表情合集\\文件.fla';
const evidenceRoot = stressRun
  ? 'D:\\PandaStage-Acceptance\\issue-260-slice4'
  : 'D:\\PandaStage-Acceptance\\issue-257-slice3';
const evidencePath = path.join(evidenceRoot, 'real-electron-asset-commit.json');
const expectedAssetCount = stressRun ? 158 : 3;
const useAcceptanceWorkaround =
  process.env.PANDA_STAGE_ACCEPTANCE_NO_SANDBOX === '1';
const isolatedUserData = path.join(
  evidenceRoot,
  `electron-user-data-verifier-${Date.now()}`,
);

fs.mkdirSync(evidenceRoot, { recursive: true });
fs.mkdirSync(isolatedUserData, { recursive: true });
app.setPath('userData', isolatedUserData);

if (useAcceptanceWorkaround) {
  // This is an acceptance-environment workaround only. It does not alter the
  // product or the parser worker policy. The local Electron 43 installation
  // intermittently hangs the hidden renderer with its normal GPU/sandbox
  // launch; the normal path remains the default when this flag is absent.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  const originalLoadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function acceptanceLoadFile(
    filePath,
    options,
  ) {
    const normalized = String(filePath).replaceAll('/', '\\').toLowerCase();
    if (
      normalized.endsWith('dist\\renderer\\hidden.html') ||
      normalized.endsWith('dist\\renderer\\fla-parser.html')
    ) {
      return this.loadURL(pathToFileURL(String(filePath)).toString()).then(
        () => undefined,
      );
    }
    return originalLoadFile.call(this, filePath, options);
  };
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForMainWindow() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) =>
        !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          'Boolean(window.pandaStage && window.pandaStage.project && window.pandaStage.fla)',
        );
        if (ready) return window;
      } catch {
        // The renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage did not expose the project/FLA APIs.');
}

async function waitForSelector(
  window,
  selector,
  timeoutMs = 60_000,
) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const selector = ${JSON.stringify(selector)};
    const timeoutMs = ${timeoutMs};
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(true);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for ' + selector));
    }, timeoutMs);
  })`);
}

async function waitForExpression(window, expression, timeoutMs = 15_000) {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const check = () => {
      try {
        if (${expression}) {
          resolve(true);
          return;
        }
      } catch {
        // Retry until the renderer has the expected surface.
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

function waitForConsoleSignal(window, token, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const onConsoleMessage = (_event, _level, message) => {
      if (String(message) !== token) return;
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for renderer signal: ${token}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      window.webContents.removeListener('console-message', onConsoleMessage);
    };
    window.webContents.on('console-message', onConsoleMessage);
  });
}

async function installSelectorConsoleSignal(window, selector, token) {
  await window.webContents.executeJavaScript(`(() => {
    const selector = ${JSON.stringify(selector)};
    const token = ${JSON.stringify(token)};
    const emit = () => {
      if (!document.querySelector(selector)) return false;
      console.log(token);
      return true;
    };
    if (emit()) return;
    const observer = new MutationObserver(() => {
      if (!emit()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  })()`);
}

async function setInput(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Input not found: ' + ${JSON.stringify(selector)});
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('Input value setter is unavailable');
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

function click(window, selector) {
  return window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('Clickable element not found: ' + ${JSON.stringify(selector)});
    }
    // Let this executeJavaScript call return before the React handler invokes
    // an IPC operation.  Synchronous element.click() would re-enter Main
    // while Main is still completing the script evaluation.
    setTimeout(() => element.click(), 0);
    return true;
  })()`);
}

function readProject(projectRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8'),
  );
}

function readPngInfo(fileBytes) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (fileBytes.length < signature.length || !fileBytes.subarray(0, 8).equals(signature)) {
    throw new Error('Imported Asset is not a PNG.');
  }
  let offset = signature.length;
  let ihdr = null;
  const idat = [];
  let transparency = null;
  while (offset + 12 <= fileBytes.length) {
    const length = fileBytes.readUInt32BE(offset);
    const type = fileBytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > fileBytes.length) throw new Error('Truncated PNG chunk.');
    const data = fileBytes.subarray(start, end);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    if (type === 'tRNS') transparency = data;
    offset = end + 4;
    if (type === 'IEND') break;
  }
  assert(ihdr && ihdr.length === 13, 'PNG is missing a valid IHDR.');
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    interlace: ihdr[12],
    idat: Buffer.concat(idat),
    transparency,
  };
}

function pngAlphaSummary(fileBytes) {
  const info = readPngInfo(fileBytes);
  const channels = { 4: 2, 6: 4 }[info.colorType];
  if (info.bitDepth !== 8 || !channels || info.interlace !== 0) {
    return {
      supported: false,
      zeroAlphaPixels: null,
      partialAlphaPixels: null,
    };
  }
  const raw = inflateSync(info.idat);
  const rowBytes = info.width * channels;
  const stride = rowBytes + 1;
  assert(raw.length >= stride * info.height, 'PNG scanline data is truncated.');
  const recon = Buffer.alloc(rowBytes * info.height);
  let zeroAlphaPixels = 0;
  let partialAlphaPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    const sourceStart = y * stride;
    const targetStart = y * rowBytes;
    const filter = raw[sourceStart];
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? recon[targetStart + x - channels] : 0;
      const up = y > 0 ? recon[targetStart - rowBytes + x] : 0;
      const upLeft =
        y > 0 && x >= channels
          ? recon[targetStart - rowBytes + x - channels]
          : 0;
      const value = raw[sourceStart + 1 + x];
      let decoded;
      if (filter === 0) decoded = value;
      else if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        decoded = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else {
        throw new Error(`Unsupported PNG filter ${filter}.`);
      }
      recon[targetStart + x] = decoded & 0xff;
    }
    for (let x = 0; x < info.width; x += 1) {
      const alpha = recon[targetStart + x * channels + channels - 1];
      if (alpha === 0) zeroAlphaPixels += 1;
      else if (alpha !== 255) partialAlphaPixels += 1;
    }
  }
  return { supported: true, zeroAlphaPixels, partialAlphaPixels };
}

function assetFileEvidence(projectRoot, asset) {
  const filePath = path.join(projectRoot, asset.relativePath);
  assert(fs.existsSync(filePath), `Missing imported Asset file: ${asset.relativePath}`);
  const bytes = fs.readFileSync(filePath);
  const png = readPngInfo(bytes);
  assert(hashBytes(bytes) === asset.sha256, `Hash mismatch: ${asset.relativePath}`);
  assert(png.width === asset.width && png.height === asset.height, `Dimension mismatch: ${asset.relativePath}`);
  return {
    id: asset.id,
    name: asset.name,
    relativePath: asset.relativePath,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    byteLength: bytes.length,
    width: png.width,
    height: png.height,
    alpha: pngAlphaSummary(bytes),
  };
}

async function run() {
  assert(fs.existsSync(samplePath), `Sample is missing: ${samplePath}`);
  const sourceBefore = sha256(samplePath);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = samplePath;
  require('../dist-electron/main/index.js');

  const mainWindow = await waitForMainWindow();
  const projectName = `${stressRun ? 'slice4-stress' : 'slice3-commit'}-${Date.now()}`;
  await click(mainWindow, '[data-testid="new-project-button"]');
  await waitForSelector(mainWindow, '[data-testid="new-project-dialog"]');
  await setInput(
    mainWindow,
    '[data-testid="new-project-parent-directory"]',
    evidenceRoot,
  );
  await setInput(
    mainWindow,
    '[data-testid="new-project-name"]',
    projectName,
  );
  await waitForSelector(
    mainWindow,
    '[data-testid="new-project-confirm"]:not([disabled])',
  );
  await click(mainWindow, '[data-testid="new-project-confirm"]');
  await waitForSelector(mainWindow, '[data-testid="editor-layout"]');

  const projectRoot = path.join(evidenceRoot, `${projectName}.pandastage`);
  const initialDocument = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} })`,
  );
  assert(initialDocument.ok, `Could not open acceptance Project: ${JSON.stringify(initialDocument)}`);
  const assetCountBefore = initialDocument.value.project.assets.length;
  assert(assetCountBefore === 0, 'Acceptance Project was not empty before commit.');

  await click(mainWindow, '[data-activity="assets"]');
  await waitForSelector(mainWindow, '[data-testid="asset-import-fla"]');
  const reviewSummaryToken = `__issue257_fla_summary_${Date.now()}`;
  const reviewSummaryReady = waitForConsoleSignal(mainWindow, reviewSummaryToken);
  await installSelectorConsoleSignal(
    mainWindow,
    '[data-testid="fla-review-summary"]',
    reviewSummaryToken,
  );
  await click(mainWindow, '[data-testid="asset-import-fla"]');
  await reviewSummaryReady;
  await waitForSelector(mainWindow, '[data-testid="fla-review-media-grid"] img', 90_000);

  const review = await mainWindow.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    return {
      mediaCount: Number(document.querySelector('[data-testid="fla-review-media-count"]')?.textContent || 0),
      cardCount: cards.length,
      thumbnailCount: document.querySelectorAll('[data-testid="fla-review-media-grid"] img').length,
      transparentCardCount: cards.filter((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0).length,
      jpegOriginCardCount: cards.filter((card) =>
        /^jpe?g$/i.test(card.getAttribute('data-source-format') || '') ||
        /\\.jpe?g\\b|格式\\s+(?:JPG|JPEG)|\\b(?:JPG|JPEG)\\b/i.test(card.textContent || ''),
      ).length,
      jpegCandidateTexts: cards
        .map((card) => card.textContent || '')
        .filter((text) => /jpe?g|格式|source/i.test(text))
        .slice(0, 5),
      sourceFormatCounts: cards.reduce((counts, card) => {
        const format = card.getAttribute('data-source-format') || 'missing';
        counts[format] = (counts[format] || 0) + 1;
        return counts;
      }, {}),
      jpegNamedTexts: cards
        .map((card) => card.textContent || '')
        .filter((text, index) =>
          cards[index]?.getAttribute('data-source-format')?.match(/^jpe?g$/i) ||
          /\\.jpe?g\\b/i.test(text),
        ),
      a1Present: cards.some((card) => card.querySelector('strong')?.textContent === 'a1.png'),
      selectedCount: document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length,
    };
  })()`);
  assert(review.mediaCount === 158 && review.cardCount === 158 && review.thumbnailCount === 158, `Unexpected 158-item review: ${JSON.stringify(review)}`);
  assert(review.transparentCardCount > 0, 'The review did not expose a transparent raster.');
  assert(review.jpegOriginCardCount > 0, 'The review did not expose a JPEG-origin raster: ' + JSON.stringify(review));
  assert(review.a1Present, 'The review did not expose a1.png.');

  await click(mainWindow, '[data-testid="fla-review-clear-all"]');
  await waitForExpression(
    mainWindow,
    `document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length === 0`,
  );
  let selectedCards;
  if (stressRun) {
    await click(mainWindow, '[data-testid="fla-review-select-all"]');
    await waitForExpression(
      mainWindow,
      `document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length === ${expectedAssetCount}`,
      30_000,
    );
    selectedCards = await mainWindow.webContents.executeJavaScript(`(() => {
      const cards = [...document.querySelectorAll('[data-fla-media-id]')];
      const transparent = cards.find((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0);
      const jpeg = cards.find((card) => /^jpe?g$/i.test(card.getAttribute('data-source-format') || ''));
      return {
        ids: cards.map((card) => card.getAttribute('data-fla-media-id')),
        names: cards.map((card) => card.querySelector('strong')?.textContent || ''),
        targetFileNames: cards.map((card) => card.getAttribute('data-target-file-name') || ''),
        transparentId: transparent?.getAttribute('data-fla-media-id') || '',
        jpegId: jpeg?.getAttribute('data-fla-media-id') || '',
      };
    })()`);
  } else {
    selectedCards = await mainWindow.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-fla-media-id]')];
    const transparent = cards.find((card) => Number(card.getAttribute('data-zero-alpha-pixels') || 0) > 0);
    const nonDefault = cards.find((card) => card.querySelector('strong')?.textContent === 'a1.png');
    const jpeg = cards.find((card) =>
      /^jpe?g$/i.test(card.getAttribute('data-source-format') || '') ||
      /\\.jpe?g\\b|格式\\s+(?:JPG|JPEG)|\\b(?:JPG|JPEG)\\b/i.test(card.textContent || ''),
    );
    const chosen = [transparent, nonDefault, jpeg].filter((card, index, values) => card && values.indexOf(card) === index);
    if (chosen.length !== 3) throw new Error('Could not choose three distinct representative media cards.');
    for (const card of chosen) card.querySelector('input[type="checkbox"]')?.click();
    return {
      ids: chosen.map((card) => card.getAttribute('data-fla-media-id')),
      names: chosen.map((card) => card.querySelector('strong')?.textContent || ''),
      targetFileNames: chosen.map((card) => card.getAttribute('data-target-file-name') || ''),
      transparentId: transparent?.getAttribute('data-fla-media-id') || '',
      jpegId: jpeg?.getAttribute('data-fla-media-id') || '',
    };
    })()`);
  }
  await waitForExpression(
    mainWindow,
    `document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length === ${expectedAssetCount}`,
  );
  const selectedState = await mainWindow.webContents.executeJavaScript(`({
    count: document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length,
    commitButtonBeforeConfirm: Boolean(document.querySelector('[data-testid="fla-review-commit"]')),
  })`);
  assert(selectedState.count === expectedAssetCount, `Selection failed: ${JSON.stringify(selectedState)}`);
  assert(!selectedState.commitButtonBeforeConfirm, 'Commit action appeared before explicit confirmation.');

  await click(mainWindow, '[data-testid="fla-review-confirm"]');
  await waitForSelector(mainWindow, '[data-testid="fla-review-intent-status"]');
  const diskBeforeCommit = readProject(projectRoot);
  assert(diskBeforeCommit.assets.length === 0, 'Confirm selection mutated project assets before commit.');
  const afterConfirm = await mainWindow.webContents.executeJavaScript(`({
    selectedCount: document.querySelectorAll('[data-fla-media-id] input[type="checkbox"]:checked').length,
    commitButtonVisible: Boolean(document.querySelector('[data-testid="fla-review-commit"]')),
    commitButtonEnabled: !document.querySelector('[data-testid="fla-review-commit"]')?.disabled,
  })`);
  assert(afterConfirm.selectedCount === expectedAssetCount && afterConfirm.commitButtonVisible && afterConfirm.commitButtonEnabled, `Explicit commit boundary is incomplete: ${JSON.stringify(afterConfirm)}`);

  const commitSuccessToken = `__issue257_fla_commit_${Date.now()}`;
  const commitSuccessReady = waitForConsoleSignal(mainWindow, commitSuccessToken);
  await installSelectorConsoleSignal(
    mainWindow,
    '[data-testid="fla-review-commit-success"]',
    commitSuccessToken,
  );
  const commitStartedAt = Date.now();
  await click(mainWindow, '[data-testid="fla-review-commit"]');
  await commitSuccessReady;
  const commitWallTimeMs = Date.now() - commitStartedAt;
  const commitUi = await mainWindow.webContents.executeJavaScript(`({
    successText: document.querySelector('[data-testid="fla-review-commit-success"]')?.textContent?.trim() || '',
    importedCount: Number(document.querySelector('[data-testid="fla-review-commit-success"]')?.getAttribute('data-imported-count') || 0),
    duplicateCount: Number(document.querySelector('[data-testid="fla-review-commit-success"]')?.getAttribute('data-duplicate-count') || 0),
    renamedCollisionCount: Number(document.querySelector('[data-testid="fla-review-commit-success"]')?.getAttribute('data-renamed-count') || 0),
    cancelDisabled: Boolean(document.querySelector('[data-testid="fla-review-cancel"]')?.disabled),
    selectionControlsDisabled: [...document.querySelectorAll('[data-testid="fla-review-select-all"], [data-testid="fla-review-clear-all"]')].every((element) => element.disabled),
  })`);
  const committedDocument = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} })`,
  );
  assert(committedDocument.ok, `Committed Project could not be reopened: ${JSON.stringify(committedDocument)}`);
  const committedProject = committedDocument.value.project;
  const projectOnDisk = readProject(projectRoot);
  assert(projectOnDisk.assets.length === expectedAssetCount && committedProject.assets.length === expectedAssetCount, `Commit did not create exactly ${expectedAssetCount} Assets.`);
  assert(committedProject.assets.every((asset) => asset.kind === 'image' && asset.mimeType === 'image/png'), 'FLA commit did not produce ordinary PNG ImageAssets.');
  const selectedTargetNames = new Set(selectedCards.targetFileNames);
  const allReviewTargetNames = await mainWindow.webContents.executeJavaScript(`[
    ...document.querySelectorAll('[data-fla-media-id]'),
  ].map((card) => card.getAttribute('data-target-file-name') || '')`);
  const importedTargetNames = committedProject.assets.map((asset) => path.basename(asset.relativePath));
  const unselectedTargetNames = allReviewTargetNames.filter((name) => !selectedTargetNames.has(name));
  const unselectedAbsent =
    importedTargetNames.length === selectedTargetNames.size &&
    importedTargetNames.every((name) => selectedTargetNames.has(name)) &&
    unselectedTargetNames.every((name) => !importedTargetNames.includes(name));
  assert(unselectedAbsent, `Unselected FLA media were materialized: ${JSON.stringify({ importedTargetNames, selectedTargetNames: [...selectedTargetNames] })}`);
  assert(!importedTargetNames.some((name) => name.toLowerCase().endsWith('.fla')), 'The source FLA was copied as an Asset.');

  const assetFiles = committedProject.assets.map((asset) => assetFileEvidence(projectRoot, asset));
  const transparentTargetName =
    selectedCards.targetFileNames[
      selectedCards.ids.indexOf(selectedCards.transparentId)
    ];
  const transparentAsset = assetFiles.find(
    (asset) => path.basename(asset.relativePath) === transparentTargetName,
  );
  assert(transparentAsset, 'The transparent representative was not imported.');
  assert(
    transparentAsset.alpha.supported &&
      (transparentAsset.alpha.zeroAlphaPixels > 0 || transparentAsset.alpha.partialAlphaPixels > 0),
    `Imported transparent PNG did not retain alpha evidence: ${JSON.stringify(transparentAsset)}`,
  );
  const jpegAsset = committedProject.assets.find(
    (asset) => path.basename(asset.relativePath) === selectedCards.targetFileNames.find((_, index) => selectedCards.ids[index] === selectedCards.jpegId),
  );
  assert(jpegAsset && jpegAsset.mimeType === 'image/png' && path.extname(jpegAsset.relativePath).toLowerCase() === '.png', 'JPEG-origin media was not committed as PNG.');
  const journalPath = path.join(projectRoot, 'recovery', '.fla-asset-commit-journal.json');
  assert(!fs.existsSync(journalPath), 'The FLA commit recovery journal was not cleared after success.');

  await click(mainWindow, '[data-testid="fla-review-cancel"]');
  await waitForExpression(
    mainWindow,
    `!document.querySelector('[data-testid="fla-review-session"]') && Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`,
  );
  const saveResponse = await mainWindow.webContents.executeJavaScript(`window.pandaStage.project.save(${JSON.stringify({
    projectRoot,
    project: committedProject,
    revision: committedDocument.value.project.assets.length === expectedAssetCount ? 1 : 0,
  })})`);
  assert(saveResponse.ok, `Explicit Project save failed: ${JSON.stringify(saveResponse)}`);

  await click(mainWindow, '[data-testid="compact-project-more"]');
  await waitForSelector(mainWindow, '[data-testid="compact-project-menu"]');
  await click(mainWindow, '[data-testid="menu-close-project"]');
  await waitForExpression(
    mainWindow,
    `Boolean(document.querySelector('[data-testid="project-center-screen"][data-project-open="false"]')) || Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`,
  );
  if (await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector('[data-testid="close-confirm-dialog"]'))`)) {
    await click(mainWindow, '[data-testid="close-confirm-save"]');
  }
  await waitForSelector(mainWindow, '[data-testid="project-center-screen"][data-project-open="false"]');
  await waitForExpression(
    mainWindow,
    `Boolean([...document.querySelectorAll('[data-testid="recent-projects-path"]')].find((node) => node.textContent?.trim() === ${JSON.stringify(projectRoot)}))`,
  );
  await mainWindow.webContents.executeJavaScript(`(() => {
    const pathNode = [...document.querySelectorAll('[data-testid="recent-projects-path"]')]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(projectRoot)});
    const card = pathNode?.closest('.recent-project-card');
    const open = card?.querySelector('[data-task4-core="recent-open"]');
    if (!(open instanceof HTMLElement)) throw new Error('Recent project open action is missing.');
    open.click();
  })()`);
  await waitForSelector(mainWindow, '[data-testid="editor-layout"]', 30_000);
  await click(mainWindow, '[data-activity="assets"]');
  await waitForExpression(
    mainWindow,
    `document.querySelectorAll('.asset-card').length === ${expectedAssetCount}`,
    30_000,
  );
  const reopenedDocument = await mainWindow.webContents.executeJavaScript(
    `window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} })`,
  );
  assert(reopenedDocument.ok && reopenedDocument.value.project.assets.length === expectedAssetCount, 'Imported Assets did not survive Save/Close/Reopen.');
  const thumbnails = await mainWindow.webContents.executeJavaScript(`(async () => {
    const documentResponse = await window.pandaStage.project.open({ projectRoot: ${JSON.stringify(projectRoot)} });
    if (!documentResponse.ok) return { ok: false, results: [] };
    const results = await Promise.all(documentResponse.value.project.assets.map((asset) =>
      window.pandaStage.assets.readThumbnail({
        projectRoot: ${JSON.stringify(projectRoot)},
        assetId: asset.id,
        sha256: asset.sha256,
      }),
    ));
    return {
      ok: true,
      results: results.map((result) => ({ ok: result.ok, status: result.ok ? result.status : result.error.code })),
    };
  })()`);
  assert(thumbnails.ok && thumbnails.results.length === expectedAssetCount && thumbnails.results.every((result) => result.ok && result.status === 'ready'), `Reopened Asset thumbnails were not readable: ${JSON.stringify(thumbnails)}`);

  const sourceAfter = sha256(samplePath);
  const result = {
    issue: stressRun ? 260 : 257,
    slice: stressRun ? 'FLA V1 Slice 4 all-158 stress' : 'FLA V1 Slice 3',
    passed: true,
    electron: process.versions.electron,
    node: process.versions.node,
    samplePath,
    sourceBefore,
    sourceAfter,
    sourceUnchanged: sourceBefore === sourceAfter,
    projectRoot,
    assetCountBefore,
    assetCountAfter: committedProject.assets.length,
    stressClassification: stressRun ? 'STRESS_PASS' : null,
    stressMetrics: stressRun
      ? {
          selectedCount: expectedAssetCount,
          importedCount: commitUi.importedCount,
          reusedDuplicateCount: commitUi.duplicateCount,
          renamedCollisionCount: commitUi.renamedCollisionCount,
          wallTimeMs: commitWallTimeMs,
          peakObservableFailure: null,
          projectAssetCount: committedProject.assets.length,
          saveCloseReopen: true,
        }
      : null,
    review,
    selectedCards,
    selectedState,
    afterConfirm,
    commitUi,
    importedAssets: assetFiles,
    unselectedAbsent,
    sourceFlaNotImported: !importedTargetNames.some((name) => name.toLowerCase().endsWith('.fla')),
    journalCleared: !fs.existsSync(journalPath),
    explicitSave: { ok: saveResponse.ok, savedRevision: 1 },
    saveCloseReopen: true,
    reopenedThumbnails: thumbnails,
    ordinaryPngJpgRegression: 'covered by focused ordinary Asset import tests',
    failureInjection: 'covered by focused rollback and journal-recovery tests',
    environmentWorkaround: useAcceptanceWorkaround,
  };
  assert(result.sourceUnchanged, 'The real FLA source changed during Slice 3 commit.');
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

app.on('window-all-closed', () => {});

app.whenReady()
  .then(run)
  .then(() => setTimeout(() => app.exit(0), 500))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    setTimeout(() => app.exit(1), 500);
  });
