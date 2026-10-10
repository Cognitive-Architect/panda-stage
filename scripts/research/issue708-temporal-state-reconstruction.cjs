#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const DEFAULT_FRAMES = [20, 22, 25];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--root-symbol-name') args.rootSymbolName = argv[++index];
    else if (argv[index] === '--probe-frames') args.frames = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'out']) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  const frameIndices = args.frames === undefined
    ? DEFAULT_FRAMES
    : args.frames.split(',').map((value) => Number(value.trim()));
  assert.ok(frameIndices.length >= 3, '--probe-frames must contain at least three frame indices');
  assert.ok(frameIndices.every((value) => Number.isSafeInteger(value) && value >= 0), '--probe-frames must be non-negative integer indices');
  assert.equal(new Set(frameIndices).size, frameIndices.length, '--probe-frames must not contain duplicates');
  return {
    ...args,
    source: path.resolve(args.source),
    out: path.resolve(args.out),
    frames: frameIndices,
  };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(
    path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`),
    'Issue #708 raster artifacts must remain outside the repository',
  );
}

async function writeVerified(outputDirectory, filePath, bytes) {
  const value = Buffer.from(bytes);
  const sha256 = HASH(value);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    assert.equal(HASH(await fs.promises.readFile(filePath)), sha256, `refusing to overwrite changed evidence: ${filePath}`);
  } else {
    await fs.promises.writeFile(filePath, value, { flag: 'wx' });
  }
  assert.equal(HASH(await fs.promises.readFile(filePath)), sha256, `artifact write verification failed: ${filePath}`);
  return { path: path.relative(outputDirectory, filePath), sha256, byteLength: value.length };
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

function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}

function shaId(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
}

function applySceneRootTransform(frameContext, rootInstance) {
  const transform = rootInstance.localTransform ?? {
    a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0,
  };
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, layerIndex) => {
      if (!layer.visible) return layer;
      return {
        ...layer,
        elements: [{
          kind: 'group',
          groupId: `issue708-scene-root-${shaId(`${rootInstance.sourceAddress ?? ''}:${layerIndex}`)}`,
          localTransform: transform,
          elements: layer.elements,
        }],
      };
    }),
  };
}

function spanAt(layer, frameIndex) {
  return layer.spans.find((span) => frameIndex >= span.index && frameIndex < span.endExclusive) ?? null;
}

function countTags(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b`, 'gu'))].length;
}

function readMatrixAttributes(xml) {
  const matrices = [];
  for (const match of xml.matchAll(/<Matrix\b([^>]*)\/?\s*>/gu)) {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/gu)) {
      attributes[attribute[1]] = attribute[2];
    }
    const matrix = ['a', 'b', 'c', 'd', 'tx', 'ty'].map((key) => Number(attributes[key] ?? (key === 'a' || key === 'd' ? 1 : 0)));
    if (matrix.every(Number.isFinite)) matrices.push(matrix);
  }
  return matrices;
}

function describeRootSpans(descriptor, frames) {
  const tweenTypes = { none: 0, motion: 0, shape: 0 };
  const allSpans = [];
  for (let layerIndex = 0; layerIndex < descriptor.frameSpanIndex.layers.length; layerIndex += 1) {
    const layer = descriptor.frameSpanIndex.layers[layerIndex];
    if (!layer) continue;
    for (const span of layer.spans) {
      tweenTypes[span.tweenType] += 1;
      allSpans.push({ layerIndex, visible: layer.visible, span });
    }
  }
  const perProbe = frames.map((frameIndex) => ({
    frameIndex,
    layers: descriptor.frameSpanIndex.layers.map((layer, layerIndex) => {
      const span = spanAt(layer, frameIndex);
      return span
        ? {
            layerIndex,
            visible: layer.visible,
            state: frameIndex === span.index ? 'keyframe' : 'held',
            spanStart: span.index,
            spanEndExclusive: span.endExclusive,
            duration: span.duration,
            tweenType: span.tweenType,
            sourceMatrices: readMatrixAttributes(span.sourceFrame.xml).length,
          }
        : { layerIndex, visible: layer.visible, state: 'uncovered' };
    }),
    authoredMatrixCount: descriptor.frameSpanIndex.layers
      .map((layer) => spanAt(layer, frameIndex))
      .filter(Boolean)
      .flatMap((span) => readMatrixAttributes(span.sourceFrame.xml)).length,
    authoredDistinctMatrixCount: new Set(descriptor.frameSpanIndex.layers
      .map((layer) => spanAt(layer, frameIndex))
      .filter(Boolean)
      .flatMap((span) => readMatrixAttributes(span.sourceFrame.xml))
      .map((matrix) => JSON.stringify(matrix))).size,
  }));
  const tagEvidence = allSpans.map(({ span }) => span.sourceFrame.xml).join('\n');
  return {
    frameCount: descriptor.frameCount,
    visibleLayerCount: descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length,
    layerCount: descriptor.frameSpanIndex.layers.length,
    spanCount: allSpans.length,
    tweenTypeCounts: tweenTypes,
    motionMetadata: {
      motionObjectTags: countTags(tagEvidence, 'MotionObject'),
      motionPathTags: countTags(tagEvidence, 'MotionPath'),
      easeTags: countTags(tagEvidence, 'Ease'),
    },
    keyframeBoundaries: [...new Set(allSpans.map(({ span }) => span.index))].sort((left, right) => left - right),
    perProbe,
  };
}

function findSceneRoot(source, expectedRootSymbolName) {
  const timeline = source.sceneTimelines[0];
  assert.ok(timeline, 'normalized archive has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(timeline.xml, 0, `issue708-scene:${timeline.name}@0`);
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol instance, found ${symbols.length}`);
  const rootInstance = symbols[0];
  assert.equal(rootInstance.symbolType, 'graphic', 'Issue #708 primary Scene root must be a Graphic instance');
  const descriptor = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === rootInstance.libraryItemName);
  assert.ok(descriptor, `Scene root Graphic definition not found: ${rootInstance.libraryItemName}`);
  if (expectedRootSymbolName !== undefined) {
    assert.equal(descriptor.sourceLibraryItemName, expectedRootSymbolName, 'Scene root does not match --root-symbol-name');
  }
  return { timeline, rootInstance, descriptor };
}

function buildProbe(source, descriptor, rootInstance, frameIndex) {
  assert.ok(frameIndex < descriptor.frameCount, `requested root frame ${frameIndex} is outside frameCount ${descriptor.frameCount}`);
  const frameContext = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `issue708-root:${descriptor.sourceLibraryItemName}@${frameIndex}`,
  );
  assert.equal(frameContext.ok, true, frameContext.message || `root Graphic frame ${frameIndex} is not renderable`);
  const root = {
    kind: 'graphic',
    name: descriptor.sourceLibraryItemName,
    frameContext: applySceneRootTransform(frameContext.value, rootInstance),
  };
  const { prepareFlaNestedGraphicFrameSelections } = require(path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'));
  const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
  assert.equal(prepared.ok, true, prepared.message || `nested Graphic state selection failed at root frame ${frameIndex}`);
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const resolved = resolveFlaDisplayList(prepared.resolverInput);
  assert.equal(resolved.ok, true, resolved.message || `display-list composition failed at root frame ${frameIndex}`);
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: `issue708:${descriptor.sourceLibraryItemName}@${frameIndex}`,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  assert.equal(composed.ok, true, composed.message || `SVG composition failed at root frame ${frameIndex}`);
  assert.ok(composed.composition.shapeCount > 0, `root frame ${frameIndex} resolved no visible source shapes`);
  return { prepared, resolved, composed, root };
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

  const source = await buildSource(normalizedBytes);
  const { timeline, rootInstance, descriptor } = findSceneRoot(source, args.rootSymbolName);
  const hierarchy = describeRootSpans(descriptor, args.frames);
  const probes = [];
  const rasterizer = createResearchRasterizer();
  try {
    for (const frameIndex of args.frames) {
      const built = buildProbe(source, descriptor, rootInstance, frameIndex);
      const firstRaster = await rasterizer.render(built.composed.svg, built.composed.width, built.composed.height);
      const secondRaster = await rasterizer.render(built.composed.svg, built.composed.width, built.composed.height);
      const svgBytes = Buffer.from(built.composed.svg, 'utf8');
      const pngBytes = Buffer.from(firstRaster.pngBytes);
      assert.equal(HASH(secondRaster.pngBytes), HASH(pngBytes), `repeated PNG render differs at root frame ${frameIndex}`);
      assert.equal(firstRaster.width, secondRaster.width);
      assert.equal(firstRaster.height, secondRaster.height);
      const basename = `frame-${String(frameIndex).padStart(2, '0')}`;
      const artifacts = {
        svg: await writeVerified(args.out, path.join(args.out, `${basename}.svg`), svgBytes),
        png: await writeVerified(args.out, path.join(args.out, `${basename}.png`), pngBytes),
      };
      probes.push({
        requestedRootGraphicFrame: frameIndex,
        selectedRootLayerSpans: hierarchy.perProbe.find((probe) => probe.frameIndex === frameIndex)?.layers,
        sceneRootInstance: {
          sourceAddress: rootInstance.sourceAddress,
          libraryItemName: rootInstance.libraryItemName,
          playbackMode: rootInstance.playbackMode ?? null,
          firstFrame: rootInstance.firstFrame ?? null,
          sourceTransform: rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        },
        nestedSelections: built.prepared.selections,
        composition: {
          kind: built.resolved.displayList.kind,
          sourceName: built.resolved.displayList.sourceName,
          frameIndex: built.resolved.displayList.frameIndex,
          shapeCount: built.composed.composition.shapeCount,
          bitmapInstanceCount: built.composed.composition.bitmapInstanceCount,
          expandedSymbolCount: built.composed.composition.expandedSymbolCount,
          resolvedNodeCount: built.composed.composition.resolvedNodeCount,
          framing: built.composed.composition.framing,
          width: firstRaster.width,
          height: firstRaster.height,
        },
        determinism: {
          svgSha256: HASH(svgBytes),
          pngSha256: HASH(pngBytes),
          secondPngSha256: HASH(secondRaster.pngBytes),
          identicalRepeatedPng: HASH(secondRaster.pngBytes) === HASH(pngBytes),
        },
        artifacts,
      });
    }
  } finally {
    rasterizer.close();
  }

  assert.equal(new Set(probes.map((probe) => probe.determinism.pngSha256)).size, probes.length,
    'distinct requested frames collapsed to identical PNG output');
  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, originalSha256, 'source FLA changed during reconstruction');

  const rootSummary = {
    sceneTimelineName: timeline.name,
    sceneFrameCount: timeline.frameCount,
    sceneRootSymbolName: descriptor.sourceLibraryItemName,
    sceneRootSourceAddress: rootInstance.sourceAddress,
    rootSceneTransform: rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    ...hierarchy,
  };
  const receipt = {
    schemaVersion: 'issue708-temporal-state-reconstruction/1',
    source: {
      path: args.source,
      originalSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: originalSha256 === sourceSha256After,
      normalizedArchiveSha256: HASH(normalizedBytes),
      normalization,
      productionParserResult: inspected.trace?.parserResult,
      postNormalizationStrictResult: inspected.trace?.postNormalizationStrictResult ?? 'not-required',
      stageWidth: source.stageWidth,
      stageHeight: source.stageHeight,
    },
    hierarchy: rootSummary,
    probes,
    semantics: {
      sourceAuthoredMatrices: 'Used directly from each selected source span and instance; no hand-tuned pose or transform value.',
      interpolation: 'NONE. All three requested root frames are authored span starts; tween interiors fail closed in the shared timeline resolver.',
      timingRulesUsed: [...new Set(probes.flatMap((probe) => probe.nestedSelections.map((selection) => selection.selectionRule)))],
      defaultFrameSemantics: 'Play Once and Single Frame with omitted firstFrame use candidate frame 0 for this prototype. Animate-visible or independent reference confirmation is still required.',
      unprovenBoundaries: [
        'Play Once behavior after the selected child timeline ends remains unsupported.',
        'Loop wrap, explicit Loop bounds, and nonzero-origin Loop for multi-frame children remain fail-closed.',
        'Tween-interior interpolation, shape tween, MovieClip runtime, and ActionScript execution remain unsupported.',
      ],
    },
    controlRegressions: {
      identicalRequestedFrameRendersMatch: probes.every((probe) => probe.determinism.identicalRepeatedPng),
      distinctRequestedFramesRemainDistinct: new Set(probes.map((probe) => probe.determinism.pngSha256)).size === probes.length,
      comparedFrameIndices: probes.map((probe) => probe.requestedRootGraphicFrame),
    },
    sourceMutation: 'NO',
    projectMutation: 'NONE: production inspection/catalog only; no project commit API was called',
    manualIntermediateRepair: 'NO',
    movieClipRuntimeAdded: 'NO',
    scriptExecutionAdded: 'NO',
    productPlaybackUiAdded: 'NO',
    humanVisualReview: 'PENDING_MAINTAINER',
    result: 'READY_FOR_MAINTAINER_VISUAL_REVIEW',
  };
  const receiptArtifact = await writeVerified(
    args.out,
    path.join(args.out, 'completion-receipt.json'),
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  );
  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true);
  console.log(JSON.stringify({ ...receipt, receiptArtifact }, null, 2));
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
