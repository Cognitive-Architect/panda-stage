#!/usr/bin/env node
/**
 * P1-C03 real-corpus acceptance for Issue #680.
 *
 * Uses one approved real FLA to prove that concrete Graphic source states at
 * frames 0 and 2 resolve differently through the accepted P1/P0 Main path,
 * produce visibly different PNGs, and remain byte-identical when rendered by
 * the bounded three-frame sequence service (0..2), with no tween interpolation.
 *
 * The input FLA is read-only. All PNGs and the metadata receipt are written to
 * the caller-provided external acceptance directory. No Project is opened and
 * no commit API is called.
 */

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const { IPC_CHANNELS } = require(path.join(root, 'dist-electron/shared/ipc/channels.js'));
const { FlaImportService } = require(path.join(root, 'dist-electron/main/services/FlaImportService.js'));
const {
  FlaFrameSequenceService,
} = require(path.join(root, 'dist-electron/main/services/fla-frame-sequence-service.js'));
const {
  FlaStaticSnapshotRenderSession,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-render-session.js'));
const {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
const {
  adaptFlaXflDisplaySource,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
const {
  resolveFlaTimelineFrameSpan,
} = require(path.join(root, 'dist-electron/main/services/fla-timeline-frame-span-resolver.js'));
const {
  createFlaStaticSnapshotBitmapMediaLookup,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'));
const {
  FlaParserWindowManager,
} = require(path.join(root, 'dist-electron/main/windows/fla-parser-window-manager.js'));
const {
  FlaStaticSnapshotWindowManager,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));

const SOURCE_BASENAME = '\u4eba\u7269\u5012\u5730.fla';
const SOURCE_SHA256 = 'BAD5F00CC1E4937FA8190E570CE7C5A8951A32D611D2B87DFC6910172B01FD9D';
const TARGET_LIBRARY_ITEM = '\u808c\u8089\u7537-cilisucai.com11 1/\u808c\u8089\u7537-cilisucai.com11 2';
const FRAME_A = 0;
const FRAME_B = 2;
const SEQUENCE_START = FRAME_A;
const SEQUENCE_END = FRAME_B;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--source' || key === '--out') {
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

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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
    pixels,
    pixelSha256: sha256(pixels),
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

async function inspectSource(importService, sourcePath) {
  const originalBytes = readFileSync(sourcePath);
  const originalSha256 = sha256(originalBytes);
  assert.equal(originalSha256, SOURCE_SHA256, `approved corpus hash mismatch: ${path.basename(sourcePath)}`);
  const response = await importService.inspectSource(sourcePath, crypto.randomUUID());
  assert.equal(response.ok, true, `production FLA inspection failed: ${response.error?.message ?? 'unknown error'}`);
  assert.equal(response.trace?.recoveryApplied, true, 'fixture must use the existing in-memory-only FLA recovery path');
  assert.equal(sha256(readFileSync(sourcePath)), originalSha256, 'source FLA changed during production inspection');
  const session = importService.getSession(response.sessionId);
  assert.ok(session, 'production inspection session was not retained');
  assert.equal(session.ir.source.basename, SOURCE_BASENAME);
  assert.equal(session.ir.source.sha256.toUpperCase(), sha256(session.sourceBytes), 'retained parser source hash does not match session bytes');
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

async function loadDisplaySource(session) {
  const zip = await JSZip.loadAsync(session.sourceBytes);
  const documentEntry = zip.file('DOMDocument.xml');
  assert.ok(documentEntry, 'retained production session has no DOMDocument.xml');
  const documentXml = await documentEntry.async('string');
  const libraryXmlEntries = [];
  const names = Object.keys(zip.files)
    .filter((name) => name.startsWith('LIBRARY/') && name.toLowerCase().endsWith('.xml'))
    .sort();
  for (const name of names) {
    const entry = zip.file(name);
    if (entry && !entry.dir) libraryXmlEntries.push({ name, xml: await entry.async('string') });
  }
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, `production XFL display adapter failed: ${adapted.message ?? ''}`);
  return adapted.source;
}

function sourceFrameEvidence(displaySource, descriptor, frameIndex) {
  const resolution = resolveFlaTimelineFrameSpan(descriptor.frameSpanIndex, frameIndex);
  assert.equal(resolution.ok, true, `frame ${frameIndex} is outside the corrected Graphic frameCount`);
  const unsupported = resolution.layers.find((layer) => layer.kind === 'unsupported-tween-interior' && layer.visible);
  assert.equal(unsupported, undefined, `frame ${frameIndex} requires tween interpolation`);
  for (const layer of resolution.layers) {
    if (!layer.visible || layer.kind === 'uncovered') continue;
    assert.equal(layer.kind, 'authored-frame', `frame ${frameIndex} did not resolve to a concrete source frame`);
    assert.equal(layer.span.tweenType, 'none', `frame ${frameIndex} has a tween-dependent visible source span`);
  }
  const context = displaySource.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `graphic:${descriptor.sourceLibraryItemName}`,
  );
  assert.equal(context.ok, true, `production frame context failed at ${frameIndex}: ${context.message ?? ''}`);
  const frameState = context.value.layers.map((layer) => ({
    name: layer.name,
    visible: layer.visible,
    elements: layer.elements,
  }));
  const serializedState = JSON.stringify(frameState);
  return {
    frameIndex,
    sourceStateSha256: sha256(Buffer.from(serializedState, 'utf8')),
    visibleElementCount: context.value.layers
      .filter((layer) => layer.visible)
      .reduce((total, layer) => total + layer.elements.length, 0),
    coveringSpans: resolution.layers.map((layer) => ({
      layerIndex: layer.layerIndex,
      visible: layer.visible,
      kind: layer.kind,
      state: 'state' in layer ? layer.state : null,
      span: layer.span ?? null,
    })),
  };
}

async function renderStaticFrame(renderSession, session, baseTarget, frameIndex, capture, outDir, suffix) {
  const target = { ...baseTarget, selectedFrameIndex: frameIndex };
  const requestId = crypto.randomUUID();
  const captureStart = capture.rasterizations.length;
  capture.phase = `static-${suffix}`;
  const preview = await renderSession.preview({
    format: 'fla-static-snapshot-preview',
    version: 1,
    requestId,
    sessionId: session.sessionId,
    target,
  });
  assert.equal(preview.ok, true, `static frame ${frameIndex} failed: ${preview.error?.message ?? 'unknown error'}`);
  assert.equal(preview.targetSelectedFrameIndex, frameIndex, `static preview did not preserve frame ${frameIndex}`);
  assert.equal(renderSession.isLatestAcceptedPreview(session.sessionId, requestId), true);
  const captured = capture.rasterizations.slice(captureStart).find((item) => item.requestId === requestId);
  assert.ok(captured, `static frame ${frameIndex} did not reach the production sandbox rasterizer`);
  const svgDiagnostics = parseSvgDiagnostics(captured.svg);
  assert.equal(svgDiagnostics.externalResourceCount, 0, 'Main-built SVG contains an external resource');

  const pngBytes = Buffer.from(preview.bytes);
  const png = decodeRgbaPng(pngBytes);
  assert.ok(png.visiblePixelCount > 0, `static frame ${frameIndex} has no visible pixels`);
  assert.ok(png.visibleBounds, `static frame ${frameIndex} has no visible bounds`);
  assert.equal(preview.width, png.width);
  assert.equal(preview.height, png.height);
  const filename = `static-frame-${frameIndex}.png`;
  writeFileSync(path.join(outDir, filename), pngBytes, { flag: 'wx' });
  renderSession.releasePreview(requestId);
  return {
    frameIndex,
    targetRenderTargetId: target.renderTargetId,
    svgSha256: sha256(Buffer.from(captured.svg, 'utf8')),
    svgDiagnostics,
    width: png.width,
    height: png.height,
    pixelCount: preview.pixelCount,
    pngByteLength: pngBytes.byteLength,
    pngSha256: sha256(pngBytes),
    rgbaPixelSha256: png.pixelSha256,
    visiblePixelCount: png.visiblePixelCount,
    visibleBounds: png.visibleBounds,
    distinctVisibleColors: png.distinctVisibleColors,
    file: filename,
  };
}

async function* buildProductionSequenceSource(source, range, sequenceSvgEvidence) {
  const resolveBitmapMedia = createFlaStaticSnapshotBitmapMediaLookup(source.media ?? []);
  const catalog = await buildRenderableTargetCatalog(source.bytes, resolveBitmapMedia);
  if (!catalog.ok) throw new Error(`R2 catalog failed: ${catalog.message}`);
  const baseTarget = catalog.entries.find(
    (entry) => entry.target.renderTargetId === range.renderTargetId,
  )?.target;
  if (!baseTarget) throw new Error(`R2 target ${range.renderTargetId} not found in production session catalog`);
  for (let frameIndex = range.startFrameIndex; frameIndex <= range.endFrameIndex; frameIndex += 1) {
    const target = { ...baseTarget, selectedFrameIndex: frameIndex };
    const built = await buildSvgForRenderTarget(source.bytes, target, resolveBitmapMedia);
    if (!built.ok) throw new Error(`R2 SVG build failed for frame ${frameIndex}: ${built.message}`);
    sequenceSvgEvidence.push({ frameIndex, svgSha256: sha256(Buffer.from(built.svg, 'utf8')) });
    yield { frameIndex, svg: built.svg };
  }
}

function writeSequencePngs(outDir, items) {
  return items.map((item) => {
    const filename = `sequence-frame-${item.frameIndex}.png`;
    const pngBytes = Buffer.from(item.preview.bytes);
    const png = decodeRgbaPng(pngBytes);
    assert.ok(png.visiblePixelCount > 0, `sequence frame ${item.frameIndex} has no visible pixels`);
    assert.ok(png.visibleBounds, `sequence frame ${item.frameIndex} has no visible bounds`);
    assert.equal(item.preview.width, png.width);
    assert.equal(item.preview.height, png.height);
    writeFileSync(path.join(outDir, filename), pngBytes, { flag: 'wx' });
    return {
      frameIndex: item.frameIndex,
      sequenceOrdinal: item.sequenceOrdinal,
      width: png.width,
      height: png.height,
      pixelCount: item.preview.pixelCount,
      pngByteLength: pngBytes.byteLength,
      pngSha256: sha256(pngBytes),
      rgbaPixelSha256: png.pixelSha256,
      visiblePixelCount: png.visiblePixelCount,
      visibleBounds: png.visibleBounds,
      distinctVisibleColors: png.distinctVisibleColors,
      file: filename,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source || !args.out) {
    process.stderr.write('Usage: electron scripts/verify-issue680-p1-c03.cjs --source "<approved 人物倒地.fla>" --out "<external-acceptance-dir>"\n');
    process.exit(args.help ? 0 : 2);
    return;
  }

  const sourcePath = path.resolve(args.source);
  const outDir = path.resolve(args.out);
  assert.ok(existsSync(sourcePath), 'approved source FLA must exist');
  assert.equal(path.basename(sourcePath), SOURCE_BASENAME, 'source must be the selected approved C03 corpus fixture');
  assert.notEqual(path.parse(outDir).root.toLowerCase(), outDir.toLowerCase(), 'output directory cannot be a drive root');
  assert.equal(isPathWithin(root, outDir), false, 'acceptance output must be outside the repository');
  assert.equal(isPathWithin(path.dirname(sourcePath), outDir), false, 'acceptance output must be outside the source corpus directory');
  mkdirSync(outDir, { recursive: true });
  const receiptPath = path.join(outDir, 'receipt.json');
  assert.equal(existsSync(receiptPath), false, 'refusing to overwrite an existing P1-C03 receipt');
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
  const capture = { phase: 'idle', rasterizations: [] };
  const rasterizer = {
    rasterize(input) {
      capture.rasterizations.push({ phase: capture.phase, requestId: input.requestId, svg: input.svg });
      return snapshotWindowManager.rasterize(input);
    },
    cancel(requestId) { return snapshotWindowManager.cancel(requestId); },
    close() { snapshotWindowManager.close(); },
  };
  const sourceLookup = sourceLookupFor(importService);
  const renderSession = new FlaStaticSnapshotRenderSession({ rasterizer, sourceLookup });
  const sequenceService = new FlaFrameSequenceService({ rasterizer });

  try {
    const { response: inspection, session, originalSha256 } = await inspectSource(importService, sourcePath);
    const catalog = await renderSession.catalog(session.sessionId);
    assert.equal(catalog.ok, true, `production Graphic catalog failed: ${catalog.message ?? 'unknown error'}`);
    const catalogEntry = catalog.entries.find(
      (entry) => entry.target.kind === 'graphic-symbol' &&
        entry.target.sourceLibraryItemName === TARGET_LIBRARY_ITEM,
    );
    assert.ok(catalogEntry, 'approved Graphic target is missing from the production catalog');
    assert.equal(catalogEntry.previewSupported, true, `approved Graphic target is unsupported: ${catalogEntry.unsupportedReason ?? ''}`);
    assert.equal(catalogEntry.target.frameCount, 11, 'corrected authored frameCount changed for the selected C03 fixture');

    const displaySource = await loadDisplaySource(session);
    const descriptor = displaySource.graphicSymbols.find(
      (symbol) => symbol.sourceLibraryItemName === TARGET_LIBRARY_ITEM,
    );
    assert.ok(descriptor, 'approved Graphic target has no production frame-span descriptor');
    assert.equal(descriptor.frameCount, catalogEntry.target.frameCount);
    const frameEvidence = [FRAME_A, 1, FRAME_B].map(
      (frameIndex) => sourceFrameEvidence(displaySource, descriptor, frameIndex),
    );
    const frameAState = frameEvidence.find((frame) => frame.frameIndex === FRAME_A);
    const frameBState = frameEvidence.find((frame) => frame.frameIndex === FRAME_B);
    assert.ok(frameAState && frameBState);
    assert.notEqual(frameAState.sourceStateSha256, frameBState.sourceStateSha256, 'selected indexes did not resolve to different concrete source display states');

    const staticA = await renderStaticFrame(
      renderSession, session, catalogEntry.target, FRAME_A, capture, outDir, 'a',
    );
    const staticB = await renderStaticFrame(
      renderSession, session, catalogEntry.target, FRAME_B, capture, outDir, 'b',
    );
    assert.notEqual(staticA.pngSha256, staticB.pngSha256, 'static PNG hashes are identical across visibly different authored source states');
    assert.notEqual(staticA.rgbaPixelSha256, staticB.rgbaPixelSha256, 'static RGBA pixels are identical across visibly different authored source states');

    const retainedSource = sourceLookup.getSource(session.sessionId);
    assert.ok(retainedSource, 'production frame-sequence source lookup lost the inspection session');
    const sequenceSvgEvidence = [];
    const sequenceRequestId = crypto.randomUUID();
    const sequenceRange = {
      renderTargetId: catalogEntry.target.renderTargetId,
      startFrameIndex: SEQUENCE_START,
      endFrameIndex: SEQUENCE_END,
    };
    capture.phase = 'sequence';
    const sequence = await sequenceService.renderSequence(
      session.sessionId,
      sequenceRange,
      buildProductionSequenceSource(retainedSource, sequenceRange, sequenceSvgEvidence),
      { sequenceRequestId },
    );
    assert.equal(sequence.ok, true, `production bounded frame sequence failed: ${sequence.error?.message ?? 'unknown error'}`);
    assert.deepEqual(sequence.items.map((item) => item.frameIndex), [0, 1, 2]);
    assert.equal(sequence.items.length, 3, 'Gate B must remain a short three-frame inclusive range');
    assert.equal(sequenceSvgEvidence.length, sequence.items.length);

    const sequenceCapture = capture.rasterizations.filter((item) => item.phase === 'sequence');
    assert.equal(sequenceCapture.length, sequence.items.length, 'sequence did not rasterize each requested frame exactly once');
    const sequenceSvgHashes = sequenceCapture.map((item) => ({
      requestId: item.requestId,
      svgSha256: sha256(Buffer.from(item.svg, 'utf8')),
    }));
    assert.deepEqual(
      sequenceSvgHashes.map((item) => item.svgSha256),
      sequenceSvgEvidence.map((item) => item.svgSha256),
      'sequence rasterizer did not receive the Main-built SVG from its bounded frame source',
    );
    const sequenceA = sequence.items.find((item) => item.frameIndex === FRAME_A);
    const sequenceB = sequence.items.find((item) => item.frameIndex === FRAME_B);
    assert.ok(sequenceA && sequenceB);
    assert.equal(sequenceA.preview.sha256.toUpperCase(), staticA.pngSha256, 'sequence frame A PNG differs from static A');
    assert.equal(sequenceB.preview.sha256.toUpperCase(), staticB.pngSha256, 'sequence frame B PNG differs from static B');
    assert.equal(sequenceSvgEvidence.find((frame) => frame.frameIndex === FRAME_A)?.svgSha256, staticA.svgSha256);
    assert.equal(sequenceSvgEvidence.find((frame) => frame.frameIndex === FRAME_B)?.svgSha256, staticB.svgSha256);
    const sequenceFrames = writeSequencePngs(outDir, sequence.items);

    assert.deepEqual(parserSecurity, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.deepEqual(snapshotSecurity, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(sha256(readFileSync(sourcePath)), originalSha256, 'source FLA changed during Gate A or Gate B rendering');
    assert.equal(sha256(readFileSync(sourcePath)), SOURCE_SHA256);

    const receipt = {
      verifier: 'Issue #680 P1-C03 / real Graphic true-frame selection + static/sequence parity',
      executedAt: new Date().toISOString(),
      source: {
        basename: SOURCE_BASENAME,
        originalSha256,
        retainedInMemorySha256: session.ir.source.sha256,
        bytes: session.ir.source.byteLength,
        recoveryApplied: inspection.trace?.recoveryApplied ?? false,
        originalFileRecheckedAfterRendering: true,
      },
      productionPaths: {
        inspect: 'FlaImportService.inspectSource -> bounded in-memory recovery -> isolated production parser window',
        catalogAndStatic: 'FlaStaticSnapshotRenderSession.catalog/preview -> shared Main frame-span/display-list/compositor path -> production sandbox snapshot window',
        sequence: 'FlaFrameSequenceService.renderSequence -> production catalog + buildSvgForRenderTarget for each inclusive index -> same production sandbox snapshot window',
      },
      fixture: {
        target: catalogEntry.target,
        previewSupported: catalogEntry.previewSupported,
        correctedFrameCount: descriptor.frameCount,
        requestedStaticIndexes: [FRAME_A, FRAME_B],
        gateBInclusiveSequence: { startFrameIndex: SEQUENCE_START, endFrameIndex: SEQUENCE_END, frameCount: sequence.items.length },
        sourceFrames: frameEvidence,
        sourceStateDiffers: frameAState.sourceStateSha256 !== frameBState.sourceStateSha256,
        tweenInterpolationRequired: false,
      },
      gates: {
        gateA: {
          staticFrames: [staticA, staticB],
          sourceStateHashesDiffer: frameAState.sourceStateSha256 !== frameBState.sourceStateSha256,
          svgHashesDiffer: staticA.svgSha256 !== staticB.svgSha256,
          pngHashesDiffer: staticA.pngSha256 !== staticB.pngSha256,
          visiblePixelHashesDiffer: staticA.rgbaPixelSha256 !== staticB.rgbaPixelSha256,
        },
        gateB: {
          sequenceFrames,
          sequenceSvgFrames: sequenceSvgEvidence,
          staticSequenceParity: {
            frameA: sequenceA.preview.sha256.toUpperCase() === staticA.pngSha256,
            frameB: sequenceB.preview.sha256.toUpperCase() === staticB.pngSha256,
          },
          sequenceServiceRequestId: sequence.requestId,
          sequenceTotalMs: sequence.sequenceTotalMs,
          totalPixelCount: sequence.totalPixelCount,
        },
      },
      sandbox: { parser: parserSecurity, snapshot: snapshotSecurity },
      externalSvgResources: 0,
      projectMutation: 'none: no Project was opened and no Project/sequence commit API was called',
      p2Limitations: [
        'Stroke, multi-fill, gradient, and exact Animate vector-style fidelity remain P2 and were not judged by this gate.',
        'Tween interpolation, MovieClip runtime, nested autonomous clocks, and ActionScript execution remain unsupported.',
      ],
      manualWindowsAcceptance: 'pending maintainer visual review; this verifier records automated Windows Electron render evidence only',
    };
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    sequenceService.close();
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
