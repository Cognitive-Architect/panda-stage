#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--root-symbol-name') args.rootSymbolName = argv[++index];
    else if (argv[index] === '--root-frame-index') args.rootFrameIndex = Number(argv[++index]);
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'rootSymbolName', 'rootFrameIndex', 'out']) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  assert.ok(Number.isSafeInteger(args.rootFrameIndex) && args.rootFrameIndex >= 0, '--root-frame-index must be a non-negative integer');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Issue #707 raster artifacts must remain outside the repository');
}

async function writeVerified(filePath, bytes) {
  const value = Buffer.from(bytes);
  const sha256 = HASH(value);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    assert.equal(HASH(await fs.promises.readFile(filePath)), sha256, `refusing to overwrite changed evidence: ${filePath}`);
  } else {
    await fs.promises.writeFile(filePath, value, { flag: 'wx' });
  }
  assert.equal(HASH(await fs.promises.readFile(filePath)), sha256, `artifact write verification failed: ${filePath}`);
  return { path: path.relative(outputDirectoryFor(filePath), filePath), sha256, byteLength: value.length };
}

function outputDirectoryFor(filePath) {
  return path.resolve(filePath, '..');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage');
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog)',
        );
        if (ready) return window;
      } catch {
        // Wait for the allowlisted renderer APIs to finish loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage renderer APIs did not become ready');
}

function serializeInspectionExpression() {
  return `
    (async () => {
      const api = window.pandaStage.fla;
      const response = await api.chooseAndInspect(${JSON.stringify(crypto.randomUUID())});
      if (!response.ok) return { ok: false, error: response.error, trace: response.trace };
      const catalog = await api.staticSnapshotCatalog({
        format: 'fla-static-snapshot-catalog', version: 1, sessionId: response.sessionId,
      });
      if (!catalog.ok) {
        await api.cancel(response.sessionId);
        return { ok: false, error: catalog.error, trace: response.trace };
      }
      return {
        ok: true,
        sessionId: response.sessionId,
        source: response.ir.source,
        document: response.ir.document,
        structure: response.ir.structure ?? null,
        trace: response.trace ?? null,
        catalog: catalog.entries,
      };
    })()
  `;
}

function createResearchRasterizer() {
  const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
  const { FlaStaticSnapshotWindowManager } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));
  const manager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    {
      create(options) {
        assert.equal(options.webPreferences?.sandbox, true, 'rasterizer must keep sandbox enabled');
        assert.equal(options.webPreferences?.contextIsolation, true, 'rasterizer must keep context isolation enabled');
        assert.equal(options.webPreferences?.nodeIntegration, false, 'rasterizer must keep Node integration disabled');
        const window = new BrowserWindow(options);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        return window;
      },
    },
  );
  const handlers = [
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, (event) => manager.markReady(event.sender.id)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, (event, payload) => manager.markResult(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, (event, payload) => manager.markError(event.sender.id, payload)],
  ];
  for (const [channel, handler] of handlers) ipcMain.on(channel, handler);
  return {
    render(svg, width, height) {
      return manager.rasterize({ requestId: crypto.randomUUID(), svg, width, height, pixelCount: width * height });
    },
    close() {
      for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
      manager.close();
    },
  };
}

async function buildSource(bytes) {
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(bytes);
  const document = zip.file('DOMDocument.xml');
  assert.ok(document, 'normalized archive is missing DOMDocument.xml');
  const documentXml = await document.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraryXmlEntries.push({ name, xml: await file.async('string') });
  }
  const { adaptFlaXflDisplaySource } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the normalized archive');
  return adapted.source;
}

async function run(args) {
  assertExternalDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });
  const originalBytes = await fs.promises.readFile(args.source);
  const originalSha256 = HASH(originalBytes);
  assert.equal(originalSha256, args.expectedSha256.toLowerCase(), 'source bytes do not match the expected SHA-256');

  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(originalBytes);
  let normalizedBytes = originalBytes;
  let normalization = { applied: false, mode: 'strict-source-bytes' };
  if (classification.state === 'RECOVERY_CANDIDATE') {
    const normalized = classifier.normalizeRecoveryCandidate(originalBytes, classification);
    assert.equal(normalized.applied, true, 'production recovery helper did not normalize the classified archive');
    assert.equal(normalized.originalBytesWritten, false, 'source normalization must remain in memory');
    normalizedBytes = Buffer.from(normalized.bytes);
    normalization = {
      applied: true,
      mode: normalized.mode,
      field: normalized.field,
      deltaBytes: normalized.deltaBytes,
      originalBytesWritten: normalized.originalBytesWritten,
      normalizedArchiveSha256: HASH(normalizedBytes),
    };
  } else {
    assert.equal(classification.state, 'STRICT_VALID', `source classifier failed closed: ${classification.state}`);
  }

  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = args.source;
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  const mainWindow = await waitForMainWindow();
  const inspected = await mainWindow.webContents.executeJavaScript(serializeInspectionExpression(), true);
  assert.equal(inspected?.ok, true, `production Main/Preload inspection failed: ${JSON.stringify(inspected)}`);
  assert.equal(inspected.source.sha256, HASH(normalizedBytes), 'Main inspection did not use the expected normalized archive');
  assert.equal(inspected.trace?.parserResult, 'success', 'production parser did not complete');
  if (normalization.applied) {
    assert.equal(inspected.trace?.recoveryApplied, true, 'Main inspection did not report its in-memory recovery');
    assert.equal(inspected.trace?.postNormalizationStrictResult, 'pass', 'Main post-normalization preflight did not pass');
  }

  const displaySource = await buildSource(normalizedBytes);
  const descriptor = displaySource.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === args.rootSymbolName);
  assert.ok(descriptor, `root Graphic not found: ${args.rootSymbolName}`);
  assert.ok(args.rootFrameIndex < descriptor.frameCount, 'root frame is outside its authored timeline');
  const rootFrame = displaySource.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    args.rootFrameIndex,
    `issue707-root:${descriptor.sourceLibraryItemName}@${args.rootFrameIndex}`,
  );
  assert.equal(rootFrame.ok, true, rootFrame.message || 'root authored Graphic frame is not renderable');

  const { prepareFlaNestedGraphicFrameSelections } = require(path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'));
  const prepared = prepareFlaNestedGraphicFrameSelections(displaySource, {
    kind: 'graphic',
    name: descriptor.sourceLibraryItemName,
    frameContext: rootFrame.value,
  });
  assert.equal(prepared.ok, true, prepared.message || 'nested Graphic state selection failed closed');
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const resolved = resolveFlaDisplayList(prepared.resolverInput);
  assert.equal(resolved.ok, true, resolved.message || 'nested display-list composition failed');
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: `issue707:${descriptor.sourceLibraryItemName}@${args.rootFrameIndex}`,
    stageWidth: displaySource.stageWidth,
    stageHeight: displaySource.stageHeight,
    shapeBlocks: displaySource.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  assert.equal(composed.ok, true, composed.message || 'source-authored vector composition failed');

  const rasterizer = createResearchRasterizer();
  let raster;
  try {
    raster = await rasterizer.render(composed.svg, composed.width, composed.height);
  } finally {
    rasterizer.close();
  }
  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, originalSha256, 'source FLA changed during reconstruction');

  const svgArtifact = await writeVerified(path.join(args.out, 'coherent-character.svg'), Buffer.from(composed.svg, 'utf8'));
  const pngArtifact = await writeVerified(path.join(args.out, 'coherent-character.png'), Buffer.from(raster.pngBytes));
  const receipt = {
    schemaVersion: 'issue707-coherent-nested-character/1',
    source: {
      path: args.source,
      originalSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: originalSha256 === sourceSha256After,
      normalizedArchiveSha256: HASH(normalizedBytes),
      normalization,
      productionParserResult: inspected.trace?.parserResult,
      postNormalizationStrictResult: inspected.trace?.postNormalizationStrictResult ?? 'not-required',
    },
    selectedParentState: {
      sourceLibraryItemName: descriptor.sourceLibraryItemName,
      frameIndex: args.rootFrameIndex,
      frameCount: descriptor.frameCount,
      authoredSpansByLayer: descriptor.frameSpanIndex.layers.map((layer, layerIndex) => ({
        layerIndex,
        visible: layer.visible,
        spans: layer.spans.filter((span) =>
          args.rootFrameIndex >= span.index && args.rootFrameIndex < span.endExclusive).map((span) => ({
            index: span.index,
            duration: span.duration,
            endExclusive: span.endExclusive,
            tweenType: span.tweenType,
          })),
      })),
    },
    nestedSelections: prepared.selections,
    composition: {
      shapeCount: composed.composition.shapeCount,
      bitmapInstanceCount: composed.composition.bitmapInstanceCount,
      expandedSymbolCount: composed.composition.expandedSymbolCount,
      resolvedNodeCount: composed.composition.resolvedNodeCount,
      viewBox: composed.composition.framing.viewBox,
      width: raster.width,
      height: raster.height,
    },
    artifacts: { svg: svgArtifact, png: pngArtifact },
    sourceMutation: 'NO',
    projectMutation: 'NONE: inspect/catalog only; no project commit API was called',
    uiOrSchemaChange: 'NONE',
    humanVisualReview: 'PENDING',
  };
  const receiptArtifact = await writeVerified(
    path.join(args.out, 'completion-receipt.json'),
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  );
  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true);
  console.log(JSON.stringify({ ...receipt, artifacts: { ...receipt.artifacts, receipt: receiptArtifact } }, null, 2));
}

const args = parseArgs(process.argv.slice(2));
run(args).then(
  () => app.quit(),
  (error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    app.quit();
    process.exitCode = 1;
  },
);
