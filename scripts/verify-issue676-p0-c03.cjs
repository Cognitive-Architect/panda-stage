#!/usr/bin/env node
/**
 * P0-C03 / Issue #679 real-corpus acceptance through the production Main-side
 * FLA inspection, catalog, preview session, and sandbox snapshot rasterizer.
 * Source FLA files are opened read-only. PNGs and the metadata-only receipt are
 * written only to the caller-provided external acceptance directory.
 */

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const { IPC_CHANNELS } = require(path.join(root, 'dist-electron/shared/ipc/channels.js'));
const { FlaImportService } = require(path.join(root, 'dist-electron/main/services/FlaImportService.js'));
const { FlaStaticSnapshotRenderSession } = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-render-session.js'));
const { buildSvgForRenderTarget } = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
const { createFlaStaticSnapshotBitmapMediaLookup } = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'));
const { FlaParserWindowManager } = require(path.join(root, 'dist-electron/main/windows/fla-parser-window-manager.js'));
const { FlaStaticSnapshotWindowManager } = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));

const EXPECTED = new Map([
  ['文件.fla', '84682EDCD49B8FCC072AE740188677BAE9D7D0FD603B8BED51A7AC4DDEB3119F'],
  ['沙雕表情大全（免费分享，短剧慎用）.fla', 'D7D92D3F38EAF3FBAC812F991B1A9E7239480AFAAFB4BDDF7E62A374355EBC59'],
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--source-a' || key === '--source-b' || key === '--out') {
      args[key.slice(2)] = argv[index + 1];
      index += 1;
    } else if (key === '--help' || key === '-h') {
      args.help = true;
    }
  }
  return args;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function decodeRgbaPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, 'snapshot renderer must return PNG bytes');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end + 4 <= bytes.length, `truncated ${type} PNG chunk`);
    const data = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  assert.equal(bitDepth, 8, 'snapshot must use 8-bit PNG output');
  assert.equal(colorType, 6, 'snapshot must preserve RGBA alpha');
  assert.equal(interlace, 0, 'snapshot must be non-interlaced');
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(imageData));
  assert.equal(inflated.length, height * (rowBytes + 1));
  const pixels = Buffer.alloc(height * rowBytes);
  let previousRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1);
    const filter = inflated[scanlineOffset];
    const row = Buffer.from(inflated.subarray(scanlineOffset + 1, scanlineOffset + 1 + rowBytes));
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previousRow[index];
      const upperLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
      if (filter === 1) row[index] = (row[index] + left) & 0xff;
      else if (filter === 2) row[index] = (row[index] + up) & 0xff;
      else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        const predictor = leftDistance <= upDistance && leftDistance <= upperLeftDistance
          ? left
          : upDistance <= upperLeftDistance ? up : upperLeft;
        row[index] = (row[index] + predictor) & 0xff;
      } else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * rowBytes);
    previousRow = row;
  }

  let visiblePixelCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = (y * width + x) * 4;
      const red = pixels[start];
      const green = pixels[start + 1];
      const blue = pixels[start + 2];
      const alpha = pixels[start + 3];
      if (alpha > 0) {
        visiblePixelCount += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (colors.size < 4096) colors.add(`${red},${green},${blue},${alpha}`);
      }
    }
  }
  return {
    width,
    height,
    visiblePixelCount,
    visibleBounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    distinctVisibleColors: colors.size,
  };
}

function captureSecurity(options) {
  const preferences = options.webPreferences || {};
  return {
    sandbox: preferences.sandbox === true,
    contextIsolation: preferences.contextIsolation === true,
    nodeIntegration: preferences.nodeIntegration === true,
  };
}

function parseSvgDiagnostics(svg) {
  const desc = svg.match(/<desc>([^<]*)<\/desc>/u)?.[1] ?? '';
  const fields = {};
  for (const key of ['resolvedNodes', 'drawableLeaves', 'groups', 'expandedSymbols', 'bitmapInstances', 'shapes']) {
    const value = desc.match(new RegExp(`(?:^|\\s)${key}=(\\d+)`, 'u'))?.[1];
    fields[key] = value === undefined ? null : Number(value);
  }
  const externalResourceCount = [...svg.matchAll(/(?:href|xlink:href)="(?:https?:|file:|\/\/)/giu)].length;
  return { desc, fields, externalResourceCount };
}

function attachParserChannels(manager) {
  const listeners = [
    [IPC_CHANNELS.FLA_WORKER_READY, (event) => manager.markReady(event.sender.id)],
    [IPC_CHANNELS.FLA_WORKER_PROGRESS, (event, payload) => manager.markProgress(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_WORKER_RESULT, (event, payload) => manager.markResult(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_WORKER_ERROR, (event, payload) => manager.markError(event.sender.id, payload)],
  ];
  for (const [channel, listener] of listeners) ipcMain.on(channel, listener);
  return () => listeners.forEach(([channel, listener]) => ipcMain.removeListener(channel, listener));
}

function attachSnapshotChannels(manager) {
  const listeners = [
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, (event) => manager.markReady(event.sender.id)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, (event, payload) => manager.markResult(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, (event, payload) => manager.markError(event.sender.id, payload)],
  ];
  for (const [channel, listener] of listeners) ipcMain.on(channel, listener);
  return () => listeners.forEach(([channel, listener]) => ipcMain.removeListener(channel, listener));
}

async function inspectSource(importService, sourcePath, expectedSha256) {
  const originalBytes = readFileSync(sourcePath);
  const originalSha256 = sha256(originalBytes);
  assert.equal(originalSha256, expectedSha256, `approved corpus hash mismatch: ${path.basename(sourcePath)}`);
  const response = await importService.inspectSource(sourcePath, crypto.randomUUID());
  assert.equal(response.ok, true, `production inspection failed for ${path.basename(sourcePath)}: ${response.error?.message ?? 'unknown error'}`);
  assert.equal(sha256(readFileSync(sourcePath)), originalSha256, 'source FLA changed during inspection');
  const session = importService.getSession(response.sessionId);
  assert.ok(session, 'production inspection session was not retained');
  return { response, session, originalSha256 };
}

function sourceLookupFor(importService) {
  return {
    getSource(sessionId) {
      const session = importService.getSession(sessionId);
      if (!session) return null;
      return {
        bytes: session.sourceBytes,
        basename: session.ir.source.basename,
        sha256: session.ir.source.sha256,
        media: session.ir.media,
      };
    },
  };
}

async function previewTarget(renderSession, importService, session, catalog, target, gate, outDir, capture) {
  assert.ok(target, `${gate}: no target selected`);
  const lookup = createFlaStaticSnapshotBitmapMediaLookup(session.ir.media);
  const built = await buildSvgForRenderTarget(session.sourceBytes, target, lookup);
  assert.equal(built.ok, true, `${gate}: production SVG build failed: ${built.message}`);
  const build = built;
  const diagnostics = parseSvgDiagnostics(build.svg);
  assert.equal(diagnostics.externalResourceCount, 0, `${gate}: SVG contains an external resource`);

  capture.svg = null;
  const requestId = crypto.randomUUID();
  const preview = await renderSession.preview({
    format: 'fla-static-snapshot-preview',
    version: 1,
    requestId,
    sessionId: session.sessionId,
    target,
  });
  assert.equal(preview.ok, true, `${gate}: production preview failed: ${preview.error?.message ?? 'unknown error'}`);
  assert.equal(capture.svg, build.svg, `${gate}: preview did not rasterize the deterministic Main-built SVG`);
  assert.equal(renderSession.isLatestAcceptedPreview(session.sessionId, requestId), true);

  const pngBytes = Buffer.from(preview.bytes);
  const png = decodeRgbaPng(pngBytes);
  const pngFile = path.join(outDir, gate + '.png');
  writeFileSync(pngFile, pngBytes, { flag: 'wx' });
  renderSession.releasePreview(requestId);

  return {
    target: { kind: target.kind, userLabel: target.userLabel, renderTargetId: target.renderTargetId },
    previewSupported: catalog.entries.find((entry) => entry.target.renderTargetId === target.renderTargetId)?.previewSupported ?? false,
    composition: build.composition,
    svgDiagnostics: diagnostics,
    svgSha256: crypto.createHash('sha256').update(build.svg, 'utf8').digest('hex'),
    preview: {
      width: preview.width,
      height: preview.height,
      pixelCount: preview.pixelCount,
      byteLength: pngBytes.byteLength,
      sha256: crypto.createHash('sha256').update(pngBytes).digest('hex'),
      visiblePixelCount: png.visiblePixelCount,
      visibleBounds: png.visibleBounds,
      distinctVisibleColors: png.distinctVisibleColors,
      file: path.basename(pngFile),
    },
    requestAndStaleGuard: 'latest accepted request matched; preview bytes released after evidence capture',
  };
}

async function runGateA(importService, renderSession, sourcePath, outDir, capture) {
  const expectedSha256 = EXPECTED.get(path.basename(sourcePath));
  assert.ok(expectedSha256, 'Gate A source basename is not in the approved corpus manifest');
  const { response, session, originalSha256 } = await inspectSource(importService, sourcePath, expectedSha256);
  assert.equal(session.ir.summary.placedInstanceCount, 156, 'Gate A parser baseline no longer reports 156 placements');
  assert.equal(session.ir.media.length, 158, 'Gate A parser baseline no longer reports 158 media entries');

  const catalog = await renderSession.catalog(session.sessionId);
  assert.equal(catalog.ok, true, `Gate A production catalog failed: ${catalog.message ?? 'unknown error'}`);
  const sceneEntry = catalog.entries.find((entry) => entry.target.kind === 'scene');
  assert.ok(sceneEntry, 'Gate A catalog has no main scene target');
  assert.equal(sceneEntry.previewSupported, true, `Gate A scene is marked unsupported: ${sceneEntry.unsupportedReason ?? ''}`);

  const preview = await previewTarget(renderSession, importService, session, catalog, sceneEntry.target, 'gate-a-file', outDir, capture);
  assert.ok(preview.composition.bitmapInstanceCount >= 2, 'Gate A composition did not include multiple bitmap instances');
  assert.equal(preview.composition.framing.mode, 'stage', 'Gate A Scene no longer uses authored-stage framing');
  assert.equal(preview.composition.framing.outputWidth, 1920, 'Gate A stage output width changed');
  assert.equal(preview.composition.framing.outputHeight, 1080, 'Gate A stage output height changed');
  assert.ok(preview.preview.width > 1 && preview.preview.height > 1, 'Gate A output is still 1×1');
  assert.ok(preview.preview.visiblePixelCount >= 100, 'Gate A output is not meaningfully visible');
  assert.ok(preview.preview.visibleBounds?.width >= 8 && preview.preview.visibleBounds?.height >= 8, 'Gate A visible result is only a tiny fragment');
  assert.ok(preview.preview.distinctVisibleColors >= 2, 'Gate A output does not contain multiple visible colors');
  assert.equal(sha256(readFileSync(sourcePath)), originalSha256, 'Gate A source FLA changed during preview');

  return {
    source: { basename: path.basename(sourcePath), originalSha256, retainedSessionSha256: session.ir.source.sha256 },
    parser: {
      placedInstanceCount: session.ir.summary.placedInstanceCount,
      mediaCount: session.ir.media.length,
      recoveryApplied: response.trace?.recoveryApplied ?? false,
    },
    catalog: { targetCount: catalog.entries.length, summary: catalog.summary },
    ...preview,
  };
}

async function runGateB(importService, renderSession, sourcePath, outDir, capture) {
  const expectedSha256 = EXPECTED.get(path.basename(sourcePath));
  assert.ok(expectedSha256, 'Gate B source basename is not in the approved corpus manifest');
  const { response, session, originalSha256 } = await inspectSource(importService, sourcePath, expectedSha256);
  assert.equal(response.trace?.recoveryApplied, true, 'Gate B did not exercise the existing in-memory recovery path');
  assert.ok(session.ir.media.length > 0, 'Gate B parser returned no media');

  const catalog = await renderSession.catalog(session.sessionId);
  assert.equal(catalog.ok, true, `Gate B production catalog failed: ${catalog.message ?? 'unknown error'}`);
  const candidates = catalog.entries.filter((entry) => entry.previewSupported && entry.target.kind === 'graphic-symbol');
  let chosen = null;
  let attempts = 0;
  for (const entry of candidates.slice(0, 12)) {
    attempts += 1;
    const lookup = createFlaStaticSnapshotBitmapMediaLookup(session.ir.media);
    const result = await buildSvgForRenderTarget(session.sourceBytes, entry.target, lookup);
    if (!result.ok) continue;
    if (result.composition.expandedSymbolCount >= 1 &&
        result.composition.bitmapInstanceCount + result.composition.shapeCount >= 2) {
      chosen = entry.target;
      break;
    }
  }
  assert.ok(chosen, 'Gate B found no bounded nested Graphic target with multiple drawable leaves');
  const preview = await previewTarget(renderSession, importService, session, catalog, chosen, 'gate-b-nested', outDir, capture);
  assert.ok(preview.composition.expandedSymbolCount >= 1, 'Gate B did not expand a nested Graphic symbol');
  assert.ok(preview.composition.resolvedNodeCount >= 3, 'Gate B diagnostics do not show multiple resolved display nodes');
  assert.ok(preview.composition.bitmapInstanceCount + preview.composition.shapeCount >= 2, 'Gate B output is still first-shape-only');
  assert.ok(preview.preview.visiblePixelCount > 0, 'Gate B snapshot has no visible pixels');
  const framing = preview.composition.framing;
  assert.equal(framing.mode, 'content', 'Gate B Graphic target was not content-framed');
  assert.ok(framing.contentBounds, 'Gate B receipt has no resolved content bounds');
  assert.equal(framing.padding, 4, 'Gate B framing padding changed');
  assert.ok(framing.contentBounds.x < 0 && framing.contentBounds.y < 0, 'Gate B corpus no longer exercises negative Graphic coordinates');
  assert.ok(
    framing.viewBox.x <= framing.contentBounds.x &&
    framing.viewBox.y <= framing.contentBounds.y &&
    framing.viewBox.x + framing.viewBox.width >= framing.contentBounds.x + framing.contentBounds.width &&
    framing.viewBox.y + framing.viewBox.height >= framing.contentBounds.y + framing.contentBounds.height,
    'Gate B viewBox does not fully contain resolved content bounds',
  );
  assert.ok(framing.outputWidth <= 512 && framing.outputHeight <= 512, 'Gate B output still uses a large document-stage canvas');
  assert.equal(framing.outputWidth, preview.preview.width, 'Gate B framed width differs from the raster output');
  assert.equal(framing.outputHeight, preview.preview.height, 'Gate B framed height differs from the raster output');
  assert.ok(preview.preview.visibleBounds.x > 0 && preview.preview.visibleBounds.y > 0, 'Gate B visible content touches the top or left edge');
  assert.ok(
    preview.preview.visibleBounds.x + preview.preview.visibleBounds.width < preview.preview.width &&
    preview.preview.visibleBounds.y + preview.preview.visibleBounds.height < preview.preview.height,
    'Gate B visible content touches the right or bottom edge',
  );
  assert.ok(preview.preview.visibleBounds.width >= framing.outputWidth * 0.5, 'Gate B content is too small within its framed viewport');
  assert.ok(preview.preview.visibleBounds.height >= framing.outputHeight * 0.5, 'Gate B content is too small within its framed viewport');
  assert.equal(sha256(readFileSync(sourcePath)), originalSha256, 'Gate B source FLA changed during preview');

  return {
    source: { basename: path.basename(sourcePath), originalSha256, retainedSessionSha256: session.ir.source.sha256 },
    parser: {
      placedInstanceCount: session.ir.summary.placedInstanceCount,
      mediaCount: session.ir.media.length,
      recoveryApplied: response.trace?.recoveryApplied ?? false,
    },
    catalog: { targetCount: catalog.entries.length, nestedGraphicCandidateCount: candidates.length, candidateBuildAttempts: attempts },
    ...preview,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args['source-a'] || !args['source-b'] || !args.out) {
    process.stderr.write('Usage: electron scripts/verify-issue676-p0-c03.cjs --source-a "<文件.fla>" --source-b "<沙雕表情大全（免费分享，短剧慎用）.fla>" --out "<external-acceptance-dir>"\n');
    process.exit(args.help ? 0 : 2);
    return;
  }

  const sourceA = path.resolve(args['source-a']);
  const sourceB = path.resolve(args['source-b']);
  const outDir = path.resolve(args.out);
  assert.ok(existsSync(sourceA) && existsSync(sourceB), 'approved Gate A and Gate B source files must exist');
  assert.notEqual(path.parse(outDir).root.toLowerCase(), outDir.toLowerCase(), 'output directory cannot be a drive root');
  mkdirSync(outDir, { recursive: true });
  const receiptPath = path.join(outDir, 'receipt.json');
  assert.equal(existsSync(receiptPath), false, 'refusing to overwrite an existing C03 receipt');
  app.setPath('userData', path.join(outDir, 'electron-user-data'));
  process.env.VITE_DEV_SERVER_URL = '';

  await app.whenReady();
  const parserSecurity = { sandbox: false, contextIsolation: false, nodeIntegration: true };
  const snapshotSecurity = { sandbox: false, contextIsolation: false, nodeIntegration: true };
  const parserWindowManager = new FlaParserWindowManager(
    { readyTimeoutMs: 15_000, parserWallTimeMs: 180_000, noProgressWatchdogMs: 60_000 },
    { create(options) { Object.assign(parserSecurity, captureSecurity(options)); return new BrowserWindow(options); } },
  );
  const snapshotWindowManager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    { create(options) { Object.assign(snapshotSecurity, captureSecurity(options)); return new BrowserWindow(options); } },
  );
  const removeParserListeners = attachParserChannels(parserWindowManager);
  const removeSnapshotListeners = attachSnapshotChannels(snapshotWindowManager);
  const importService = new FlaImportService(parserWindowManager);
  const capture = { svg: null };
  const rasterizer = {
    rasterize(input) {
      capture.svg = input.svg;
      return snapshotWindowManager.rasterize(input);
    },
    cancel(requestId) { return snapshotWindowManager.cancel(requestId); },
    close() { snapshotWindowManager.close(); },
  };
  const renderSession = new FlaStaticSnapshotRenderSession({
    rasterizer,
    sourceLookup: sourceLookupFor(importService),
  });

  try {
    const gateA = await runGateA(importService, renderSession, sourceA, outDir, capture);
    const gateB = await runGateB(importService, renderSession, sourceB, outDir, capture);
    assert.deepEqual(parserSecurity, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.deepEqual(snapshotSecurity, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    const receipt = {
      verifier: 'Issue #676 P0-C03 / #679 Graphic content-framing real-corpus acceptance',
      executedAt: new Date().toISOString(),
      parserPath: 'FlaImportService -> isolated production parser window -> retained inspection session',
      previewPath: 'production catalog/render session -> Main-built composed SVG -> production sandbox snapshot window',
      corrective: {
        rootCause: 'confirmed: Graphic snapshots used the authored DOMDocument stage viewport/output dimensions instead of resolved Graphic content bounds',
        strategy: 'bound transformed PNG corners and supported transformed Shape path geometry; retain negative world coordinates; add fixed 4-unit padding and fit output within the existing width/height/pixel limits',
        sceneRegression: 'Scene and timeline targets retain authored document-stage viewBox and output dimensions',
      },
      gates: { gateA, gateB },
      sandbox: { parser: parserSecurity, snapshot: snapshotSecurity },
      externalSvgResources: 0,
      projectMutation: 'none: no Project was opened and no commit API was called',
      sourceHashesRecheckedAfterPreview: true,
      manualWindowsAcceptance: 'not performed by this verifier; Issue #679 human-visible Gate B acceptance remains required',
    };
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    renderSession.close();
    importService.close();
    removeParserListeners();
    removeSnapshotListeners();
  }
}

app.on('window-all-closed', () => {});
main()
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
