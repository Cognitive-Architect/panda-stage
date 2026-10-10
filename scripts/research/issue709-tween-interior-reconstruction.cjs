#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const TARGET_INTERVAL = Object.freeze({ start: 20, end: 22, interior: 21 });
const ACCEPTED_B5B_CONTROL_HASHES = Object.freeze({
  20: '61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6',
  22: '95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2',
});
const UNSUPPORTED_TWEEN_TAGS = Object.freeze([
  'MotionObject',
  'MotionPath',
  'Ease',
  'DOMTween',
  'AnimationCore',
  'PropertyContainer',
]);
const DISALLOWED_TWEEN_ATTRIBUTES = new Set([
  'acceleration',
  'easeIn',
  'easeOut',
  'motionPath',
  'orientToPath',
  'rotate',
  'rotateDirection',
  'rotateTimes',
  'rotationDirection',
  'rotationTimes',
  'tweenEasing',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--root-symbol-name') args.rootSymbolName = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'rootSymbolName', 'out']) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(
    path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`),
    'Issue #709 raster artifacts must remain outside the repository',
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
  const { adaptFlaXflDisplaySource, getFlaXflDirectChildren } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'),
  );
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the normalized archive');
  return {
    source: adapted.source,
    documentXml,
    libraryXmlEntries,
    getFlaXflDirectChildren,
  };
}

function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}

function applySceneRootTransform(frameContext, rootInstance) {
  const transform = rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, layerIndex) => {
      if (!layer.visible) return layer;
      return {
        ...layer,
        elements: [{
          kind: 'group',
          groupId: `issue709-scene-root-${crypto.createHash('sha256')
            .update(`${rootInstance.sourceAddress ?? ''}:${layerIndex}`, 'utf8').digest('hex').slice(0, 24)}`,
          localTransform: transform,
          elements: layer.elements,
        }],
      };
    }),
  };
}

function directChildren(xml, parentName, getFlaXflDirectChildren) {
  return getFlaXflDirectChildren(xml, parentName);
}

function matrixForSourceElement(element, getFlaXflDirectChildren) {
  const children = directChildren(element.xml, element.name, getFlaXflDirectChildren);
  const matrixWrapper = children.find((child) => child.name === 'matrix');
  assert.ok(matrixWrapper, `${element.name} is missing its XFL matrix`);
  const matrixElement = directChildren(matrixWrapper.xml, 'matrix', getFlaXflDirectChildren)
    .find((child) => child.name === 'Matrix');
  assert.ok(matrixElement, `${element.name} has no Matrix value`);
  const matrix = Object.fromEntries(['a', 'b', 'c', 'd', 'tx', 'ty'].map((key) => {
    const raw = matrixElement.attributes[key];
    assert.ok(raw !== undefined, `Matrix is missing ${key}`);
    return [key, Number(raw)];
  }));
  assert.ok(Object.values(matrix).every(Number.isFinite), `${element.name} has a non-finite Matrix value`);
  return matrix;
}

function sourceElements(span, getFlaXflDirectChildren) {
  if (!span) return [];
  const wrapper = directChildren(span.sourceFrame.xml, 'DOMFrame', getFlaXflDirectChildren)
    .find((child) => child.name === 'elements');
  return wrapper ? directChildren(wrapper.xml, 'elements', getFlaXflDirectChildren) : [];
}

function spanAt(layer, frameIndex) {
  return layer.spans.find((span) => frameIndex >= span.index && frameIndex < span.endExclusive) ?? null;
}

function collectCensus(descriptor, getFlaXflDirectChildren) {
  const layers = descriptor.frameSpanIndex.layers.map((layer, layerIndex) => {
    const start = spanAt(layer, TARGET_INTERVAL.start);
    const end = layer.spans.find((span) => span.index === TARGET_INTERVAL.end) ?? null;
    if (!start && !end) return null;
    const summarize = (span) => span ? {
      index: span.index,
      duration: span.duration,
      endExclusive: span.endExclusive,
      tweenType: span.tweenType,
      frameAttributes: span.sourceFrame.attributes,
      elements: sourceElements(span, getFlaXflDirectChildren).map((element) => ({
        kind: element.name,
        attributes: element.attributes,
        matrix: element.name === 'DOMSymbolInstance'
          ? matrixForSourceElement(element, getFlaXflDirectChildren)
          : null,
      })),
    } : null;
    return { layerIndex, visible: layer.visible, start: summarize(start), end: summarize(end) };
  }).filter(Boolean);
  return layers;
}

function countTag(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b`, 'gu'))].length;
}

function scanArchiveEvidence(documentXml, libraryXmlEntries) {
  const xml = [documentXml, ...libraryXmlEntries.map((entry) => entry.xml)].join('\n');
  const tagCounts = Object.fromEntries(UNSUPPORTED_TWEEN_TAGS.map((name) => [name, countTag(xml, name)]));
  const attributeNames = new Set();
  for (const match of xml.matchAll(/<[^!?/][^>\s/]*([^>]*)>/gu)) {
    for (const attribute of match[1].matchAll(/([A-Za-z_][\w:.-]*)\s*=/gu)) {
      if (attribute[1]) attributeNames.add(attribute[1]);
    }
  }
  const disallowedAttributes = [...attributeNames].filter((name) => DISALLOWED_TWEEN_ATTRIBUTES.has(name)).sort();
  return {
    libraryXmlCount: libraryXmlEntries.length,
    domFrameCount: countTag(xml, 'DOMFrame'),
    unsupportedTweenTagCounts: tagCounts,
    disallowedTweenAttributes: disallowedAttributes,
  };
}

function assertGate0(descriptor, census, archiveEvidence, interpolateTransform) {
  const { start, end, interior } = TARGET_INTERVAL;
  assert.ok(interior > start && interior < end, 'frame 21 must be interior to the authored 20 → 22 interval');
  assert.equal(descriptor.frameCount, 47, 'primary root Graphic frame count changed from accepted #708 census');
  assert.equal(descriptor.frameSpanIndex.layers.length, 12, 'primary root visible-layer census changed');
  assert.ok(archiveEvidence.unsupportedTweenTagCounts, 'archive tween-tag census is missing');
  for (const [tag, count] of Object.entries(archiveEvidence.unsupportedTweenTagCounts)) {
    assert.equal(count, 0, `bounded Gate 0 does not support ${tag} metadata`);
  }
  assert.deepEqual(archiveEvidence.disallowedTweenAttributes, [], 'bounded Gate 0 found a disallowed motion attribute');

  const byLayer = new Map(census.map((layer) => [layer.layerIndex, layer]));
  const heldLayer = byLayer.get(0);
  assert.equal(heldLayer?.visible, true);
  assert.deepEqual(
    [heldLayer?.start?.index, heldLayer?.start?.endExclusive, heldLayer?.start?.tweenType],
    [20, 47, 'none'],
    'root layer 0 must remain held across the interval',
  );
  assert.equal(heldLayer?.end, null, 'root layer 0 should not add a keyframe at frame 22');

  for (let layerIndex = 1; layerIndex <= 11; layerIndex += 1) {
    const layer = byLayer.get(layerIndex);
    assert.ok(layer?.visible, `root tween layer ${layerIndex} must be visible`);
    assert.deepEqual(
      [layer.start?.index, layer.start?.duration, layer.start?.endExclusive, layer.start?.tweenType],
      [start, 2, end, 'motion'],
      `root layer ${layerIndex} is outside the bounded 20 → 22 motion span`,
    );
    assert.deepEqual(
      [layer.end?.index, layer.end?.duration, layer.end?.tweenType],
      [end, 3, 'motion'],
      `root layer ${layerIndex} has no authored end state at frame 22`,
    );
    assert.equal(layer.start?.frameAttributes.motionTweenSnap, 'true');
    assert.equal(layer.end?.frameAttributes.motionTweenSnap, 'true');
    assert.equal(layer.start?.frameAttributes.keyMode, '22017');
    assert.equal(layer.end?.frameAttributes.keyMode, '22017');
    const startElement = layer.start?.elements[0];
    const endElement = layer.end?.elements[0];
    assert.equal(layer.start?.elements.length, 1);
    assert.equal(layer.end?.elements.length, 1);
    assert.equal(startElement?.kind, 'DOMSymbolInstance');
    assert.equal(endElement?.kind, 'DOMSymbolInstance');
    assert.equal(startElement?.attributes.symbolType, 'graphic');
    assert.equal(endElement?.attributes.symbolType, 'graphic');
    assert.equal(startElement?.attributes.libraryItemName, endElement?.attributes.libraryItemName);
    assert.equal(startElement?.matrix && endElement?.matrix && true, true);
    const result = interpolateTransform(startElement.matrix, endElement.matrix, 0.5);
    assert.equal(result.ok, true, result.ok ? '' : result.message);
  }

  assert.equal(census.length, 12, 'active census must include held root layer 0 and 11 motion targets');
}

function requireFrameContext(source, descriptor, frameIndex, scope, index = descriptor.frameSpanIndex) {
  const result = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    index,
    frameIndex,
    scope,
  );
  assert.equal(result.ok, true, result.message || `root Graphic frame ${frameIndex} could not be built`);
  return result.value;
}

function buildProbe(source, descriptor, rootInstance, frameContext, frameIndex) {
  const root = {
    kind: 'graphic',
    name: descriptor.sourceLibraryItemName,
    frameContext: applySceneRootTransform(frameContext, rootInstance),
  };
  const { prepareFlaNestedGraphicFrameSelections } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'),
  );
  const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
  assert.equal(prepared.ok, true, prepared.message || `nested Graphic state selection failed at frame ${frameIndex}`);
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const resolved = resolveFlaDisplayList(prepared.resolverInput);
  assert.equal(resolved.ok, true, resolved.message || `display-list composition failed at frame ${frameIndex}`);
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: `issue709:${descriptor.sourceLibraryItemName}@${frameIndex}`,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  assert.equal(composed.ok, true, composed.message || `SVG composition failed at frame ${frameIndex}`);
  assert.ok(composed.composition.shapeCount > 0, `frame ${frameIndex} resolved no visible source shapes`);
  return { prepared, resolved, composed, root };
}

function findSceneRoot(source, expectedRootSymbolName) {
  const timeline = source.sceneTimelines[0];
  assert.ok(timeline, 'normalized archive has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(timeline.xml, 0, `issue709-scene:${timeline.name}@0`);
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol instance, found ${symbols.length}`);
  const rootInstance = symbols[0];
  assert.equal(rootInstance.symbolType, 'graphic', 'Issue #709 Scene root must be a Graphic instance');
  const descriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === rootInstance.libraryItemName);
  assert.ok(descriptor, `Scene root Graphic definition not found: ${rootInstance.libraryItemName}`);
  assert.equal(descriptor.sourceLibraryItemName, expectedRootSymbolName, 'Scene root does not match --root-symbol-name');
  return { timeline, rootInstance, descriptor };
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

  const archive = await buildSource(normalizedBytes);
  const { source } = archive;
  const { timeline, rootInstance, descriptor } = findSceneRoot(source, args.rootSymbolName);
  const census = collectCensus(descriptor, archive.getFlaXflDirectChildren);
  const archiveEvidence = scanArchiveEvidence(archive.documentXml, archive.libraryXmlEntries);
  const { interpolateFlaLinearMotionTransform } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-motion-tween-transform-interpolator.js'),
  );
  const interpolateTransform = interpolateFlaLinearMotionTransform;
  assertGate0(descriptor, census, archiveEvidence, interpolateTransform);

  const productionFrame21 = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    TARGET_INTERVAL.interior,
    `issue709-root:${descriptor.sourceLibraryItemName}@${TARGET_INTERVAL.interior}`,
  );
  assert.equal(productionFrame21.ok, true,
    productionFrame21.ok ? '' : `production Graphic timeline resolver rejected frame 21: ${productionFrame21.message}`);

  const frame20Context = requireFrameContext(source, descriptor, TARGET_INTERVAL.start,
    `issue709-root:${descriptor.sourceLibraryItemName}@${TARGET_INTERVAL.start}`);
  const frame22Context = requireFrameContext(source, descriptor, TARGET_INTERVAL.end,
    `issue709-root:${descriptor.sourceLibraryItemName}@${TARGET_INTERVAL.end}`);
  if (!productionFrame21.ok) throw new Error(productionFrame21.message);
  const frame21Context = productionFrame21.value;

  const contexts = [
    { frameIndex: TARGET_INTERVAL.start, frameContext: frame20Context },
    { frameIndex: TARGET_INTERVAL.interior, frameContext: frame21Context },
    { frameIndex: TARGET_INTERVAL.end, frameContext: frame22Context },
  ];
  const rasterizer = createResearchRasterizer();
  const probes = [];
  try {
    for (const { frameIndex, frameContext } of contexts) {
      const built = buildProbe(source, descriptor, rootInstance, frameContext, frameIndex);
      const firstRaster = await rasterizer.render(built.composed.svg, built.composed.width, built.composed.height);
      const repeatedRaster = await rasterizer.render(built.composed.svg, built.composed.width, built.composed.height);
      const svgBytes = Buffer.from(built.composed.svg, 'utf8');
      const pngBytes = Buffer.from(firstRaster.pngBytes);
      assert.equal(HASH(repeatedRaster.pngBytes), HASH(pngBytes), `repeated PNG render differs at frame ${frameIndex}`);
      assert.equal(firstRaster.width, repeatedRaster.width);
      assert.equal(firstRaster.height, repeatedRaster.height);
      const basename = `frame-${String(frameIndex).padStart(2, '0')}`;
      const artifacts = {
        svg: await writeVerified(args.out, path.join(args.out, `${basename}.svg`), svgBytes),
        png: await writeVerified(args.out, path.join(args.out, `${basename}.png`), pngBytes),
      };
      const baselineHash = ACCEPTED_B5B_CONTROL_HASHES[frameIndex];
      if (baselineHash) {
        assert.equal(HASH(pngBytes), baselineHash,
          `accepted #708 frame ${frameIndex} control changed under the Issue #709 build`);
      }
      probes.push({
        requestedRootGraphicFrame: frameIndex,
        authoredSpanCensus: census.map((layer) => ({
          layerIndex: layer.layerIndex,
          visible: layer.visible,
          selectedSpan: frameIndex === TARGET_INTERVAL.end ? layer.end : layer.start,
        })),
        nestedSelections: built.prepared.selections,
        composition: {
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
          repeatPngSha256: HASH(repeatedRaster.pngBytes),
          repeatedPngIdentical: HASH(repeatedRaster.pngBytes) === HASH(pngBytes),
          acceptedB5BControlSha256: baselineHash ?? null,
        },
        artifacts,
      });
    }
  } finally {
    rasterizer.close();
  }

  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, originalSha256, 'source FLA changed during reconstruction');
  assert.equal(new Set(probes.map((probe) => probe.determinism.pngSha256)).size, probes.length,
    'frames 20, 21, and 22 did not produce three distinct PNG states');

  const rootSummary = {
    sceneTimelineName: timeline.name,
    sceneFrameCount: timeline.frameCount,
    sceneRootSymbolName: descriptor.sourceLibraryItemName,
    sceneRootSourceAddress: rootInstance.sourceAddress,
    sceneRootTransform: rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    frameCount: descriptor.frameCount,
    visibleLayerCount: descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length,
    activeSpanCensus: census,
  };
  const receipt = {
    schemaVersion: 'issue709-tween-interior-reconstruction/1',
    source: {
      path: args.source,
      originalSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariant: sourceSha256After === originalSha256,
      normalizedArchiveSha256: HASH(normalizedBytes),
      normalization,
      productionParserResult: inspected.trace?.parserResult,
      postNormalizationStrictResult: inspected.trace?.postNormalizationStrictResult ?? 'not-required',
    },
    gate0: {
      decision: 'GO_BOUNDED_TRANSFORM_ONLY',
      interval: TARGET_INTERVAL,
      archiveEvidence,
      rule: 'Linear interpolation of translation, 2D rotation, and positive no-skew scale at source-derived progress 0.5.',
      inference: 'No easing/path/rotation-direction metadata was found. Adobe documentation supports default un-eased property interpolation; Gate B visual comparison is still required.',
      productionResolverFrame21: 'resolved through the bounded source-semantic motion subset',
    },
    hierarchy: rootSummary,
    probes,
    controls: {
      frame20MatchesAcceptedB5B: probes.find((probe) => probe.requestedRootGraphicFrame === 20)
        ?.determinism.pngSha256 === ACCEPTED_B5B_CONTROL_HASHES[20],
      frame22MatchesAcceptedB5B: probes.find((probe) => probe.requestedRootGraphicFrame === 22)
        ?.determinism.pngSha256 === ACCEPTED_B5B_CONTROL_HASHES[22],
    },
    sourceMutation: 'NO',
    projectMutation: 'NONE: Main/Preload inspect only; no project commit API was called',
    manualInterpolationConstants: 'NO: transform values are derived from source keyframe matrices',
    manualPoseOrImageRepair: 'NO',
    movieClipRuntimeAdded: 'NO',
    scriptExecutionAdded: 'NO',
    playbackUiAdded: 'NO',
    humanVisualReview: 'PENDING_MAINTAINER',
    result: 'FRAME21_PRODUCTION_ADAPTER_READY_FOR_GATE_B_REVIEW',
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
