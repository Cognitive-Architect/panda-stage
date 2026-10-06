#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const TARGET_SEQUENCE = Object.freeze([20, 21, 22, 23, 24, 25]);
const AUTHORED_BOUNDARIES = Object.freeze([20, 22, 25]);
const ACCEPTED_CONTROL_HASHES = Object.freeze({
  20: '61547c34bf3e5ccb234bf3b315a8c80bf7524f605ee60fb6e580699870b366d6',
  21: 'fcbbf077a1097144a0a0f757c84f0a5ffcbc7664c4ed949b1c9ff8066605f827',
  22: '95ef1f30a4ce5c2c545a9863449e5452b14203cf5469d78ec5d51054ea65afb2',
  25: '5bddf50266c5445c41d9937e8e62601057de1d230a9f85244d174cf60d1e22c7',
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
    else if (argv[index] === '--gate0-only') args.gate0Only = true;
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
    'Issue #711 acceptance artifacts must remain outside the repository',
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
          groupId: `issue711-scene-root-${crypto.createHash('sha256')
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
  const summarize = (span) => span ? {
    index: span.index,
    duration: span.duration,
    endExclusive: span.endExclusive,
    tweenType: span.tweenType,
    frameAttributes: span.sourceFrame.attributes,
    elements: sourceElements(span, getFlaXflDirectChildren).map((element) => {
      const children = directChildren(element.xml, element.name, getFlaXflDirectChildren);
      const transformationPoints = children
        .filter((child) => child.name === 'transformationPoint')
        .flatMap((wrapper) => directChildren(wrapper.xml, 'transformationPoint', getFlaXflDirectChildren)
          .filter((child) => child.name === 'Point')
          .map((point) => point.attributes));
      return {
        kind: element.name,
        attributes: element.attributes,
        matrix: element.name === 'DOMSymbolInstance'
          ? matrixForSourceElement(element, getFlaXflDirectChildren)
          : null,
        transformationPoints,
      };
    }),
  } : null;
  const layers = descriptor.frameSpanIndex.layers.map((layer, layerIndex) => {
    const spansAtBoundaries = Object.fromEntries(AUTHORED_BOUNDARIES.map((frameIndex) => [
      frameIndex,
      summarize(spanAt(layer, frameIndex)),
    ]));
    if (Object.values(spansAtBoundaries).every((span) => span === null)) return null;
    return { layerIndex, visible: layer.visible, spansAtBoundaries };
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
  const heldSpans = AUTHORED_BOUNDARIES.map((frameIndex) => heldLayer?.spansAtBoundaries[frameIndex]);
  for (const heldSpan of heldSpans) {
    assert.deepEqual(
      [heldSpan?.index, heldSpan?.duration, heldSpan?.endExclusive, heldSpan?.tweenType],
      [20, 27, 47, 'none'],
      'root layer 0 must remain held across frames 20–25',
    );
  }

  const interpolationProofs = [];
  for (let layerIndex = 1; layerIndex <= 11; layerIndex += 1) {
    const layer = byLayer.get(layerIndex);
    assert.ok(layer?.visible, `root tween layer ${layerIndex} must be visible`);
    const spans = AUTHORED_BOUNDARIES.map((frameIndex) => layer?.spansAtBoundaries[frameIndex]);
    const expectedSpans = [
      [20, 2, 22, 'motion'],
      [22, 3, 25, 'motion'],
      [25, 5, 30, 'motion'],
    ];
    spans.forEach((span, index) => {
      const expected = expectedSpans[index];
      assert.deepEqual(
        [span?.index, span?.duration, span?.endExclusive, span?.tweenType],
        expected,
        `root layer ${layerIndex} has an unexpected authored span at frame ${AUTHORED_BOUNDARIES[index]}`,
      );
      assert.deepEqual(
        Object.keys(span?.frameAttributes ?? {}).sort(),
        ['duration', 'index', 'keyMode', 'motionTweenSnap', 'tweenType'].sort(),
        `root layer ${layerIndex} has unsupported frame attributes at ${AUTHORED_BOUNDARIES[index]}`,
      );
      assert.equal(span?.frameAttributes.motionTweenSnap, 'true');
      assert.equal(span?.frameAttributes.keyMode, '22017');
      assert.equal(span?.elements.length, 1);
      assert.equal(span?.elements[0]?.kind, 'DOMSymbolInstance');
      assert.equal(span?.elements[0]?.attributes.symbolType, 'graphic');
    });
    const targets = spans.map((span) => span?.elements[0]);
    assert.equal(new Set(targets.map((target) => target?.attributes.libraryItemName)).size, 1,
      `root layer ${layerIndex} changes Graphic target identity across frames 20–25`);
    assert.ok(targets.every((target) => target?.matrix), `root layer ${layerIndex} is missing an endpoint matrix`);

    const matrixPairs = [
      { start: targets[0]?.matrix, end: targets[1]?.matrix, fromFrame: 20, toFrame: 22, requestedFrame: 21, progress: 0.5 },
      { start: targets[1]?.matrix, end: targets[2]?.matrix, fromFrame: 22, toFrame: 25, requestedFrame: 23, progress: 1 / 3 },
      { start: targets[1]?.matrix, end: targets[2]?.matrix, fromFrame: 22, toFrame: 25, requestedFrame: 24, progress: 2 / 3 },
    ];
    for (const pair of matrixPairs) {
      assert.ok(pair.start && pair.end);
      const result = interpolateTransform(pair.start, pair.end, pair.progress);
      assert.equal(result.ok, true,
        result.ok ? '' : `root layer ${layerIndex} F${pair.requestedFrame}: ${result.message}`);
      if (result.ok) {
        interpolationProofs.push({
          layerIndex,
          target: targets[1]?.attributes.libraryItemName,
          fromFrame: pair.fromFrame,
          toFrame: pair.toFrame,
          requestedFrame: pair.requestedFrame,
          progress: pair.progress,
          startMatrix: pair.start,
          endMatrix: pair.end,
          derivedMatrix: result.matrix,
        });
      }
    }
  }

  assert.equal(census.length, 12, 'census must include held layer 0 and all 11 visible tween targets');
  return {
    classification: 'GO-WITH-BOUNDED-EXTENSION',
    extension: 'Permit the already bounded transform-only interpolation for source-authored duration-3 spans, using exact frame progress 1/3 and 2/3.',
    knownInterval: '20→22 uses duration 2; 22→25 uses duration 3 with matching Graphic targets and the same accepted frame metadata.',
    archiveEvidence,
    interpolationProofs,
  };
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
    renderTargetId: `issue711:${descriptor.sourceLibraryItemName}@${frameIndex}`,
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
  const sceneContext = source.buildSceneFrameContext(timeline.xml, 0, `issue711-scene:${timeline.name}@0`);
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol instance, found ${symbols.length}`);
  const rootInstance = symbols[0];
  assert.equal(rootInstance.symbolType, 'graphic', 'Issue #711 Scene root must be a Graphic instance');
  const descriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === rootInstance.libraryItemName);
  assert.ok(descriptor, `Scene root Graphic definition not found: ${rootInstance.libraryItemName}`);
  assert.equal(descriptor.sourceLibraryItemName, expectedRootSymbolName, 'Scene root does not match --root-symbol-name');
  return { timeline, rootInstance, descriptor };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function contactSheetSvg(probes) {
  const sheetWidth = 1440;
  const tileWidth = 480;
  const tileHeight = 300;
  const headerHeight = 48;
  const sheetHeight = headerHeight + tileHeight * 2;
  const imageBox = { x: 14, y: 72, width: 452, height: 210 };
  const cells = probes.map((probe, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = column * tileWidth;
    const y = headerHeight + row * tileHeight;
    const statusColor = probe.status === 'BLOCKED' ? '#a61b1b' : '#245b3a';
    const image = probe.pngBytes
      ? `<image x="${x + imageBox.x}" y="${y + imageBox.y}" width="${imageBox.width}" height="${imageBox.height}" href="data:image/png;base64,${probe.pngBytes.toString('base64')}" preserveAspectRatio="xMidYMid meet"/>`
      : '';
    const reasonLines = probe.status === 'BLOCKED'
      ? (probe.blockerReason.match(/.{1,68}/gu) ?? [probe.blockerReason]).slice(0, 3)
      : [];
    const reason = reasonLines.map((line, lineIndex) =>
      `<text x="${x + 18}" y="${y + 154 + lineIndex * 20}" font-size="14" fill="#7f1d1d">${escapeXml(line)}</text>`).join('');
    return `<g>
      <rect x="${x + 4}" y="${y + 4}" width="${tileWidth - 8}" height="${tileHeight - 8}" rx="8" fill="${probe.status === 'BLOCKED' ? '#fff7f7' : '#ffffff'}" stroke="#aeb8c2"/>
      <text x="${x + 18}" y="${y + 30}" font-size="20" font-weight="700" fill="#152536">Frame ${probe.requestedRootGraphicFrame}</text>
      <text x="${x + tileWidth - 18}" y="${y + 30}" text-anchor="end" font-size="14" font-weight="700" fill="${statusColor}">${probe.status}</text>
      ${image}
      ${reason}
    </g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">
    <rect width="100%" height="100%" fill="#edf1f5"/>
    <text x="18" y="${headerHeight - 12}" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#152536">Issue #711 · Root Graphic · F20 → F25</text>
    <g font-family="Arial, sans-serif">${cells}</g>
  </svg>`;
}

function selectCensusSpanForFrame(layer, frameIndex) {
  const boundary = AUTHORED_BOUNDARIES.filter((candidate) => candidate <= frameIndex).at(-1);
  return boundary === undefined ? null : layer.spansAtBoundaries[boundary];
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
  const gate0 = assertGate0(descriptor, census, archiveEvidence, interpolateTransform);
  const preExtensionResolverResults = [21, 23, 24].map((frameIndex) => {
    const result = source.buildGraphicFrameContext(
      descriptor.timelineXml,
      descriptor.frameSpanIndex,
      frameIndex,
      `issue711-baseline:${descriptor.sourceLibraryItemName}@${frameIndex}`,
    );
    return {
      frameIndex,
      ok: result.ok,
      reason: result.ok ? null : result.message,
    };
  });

  if (args.gate0Only) {
    const sourceSha256After = HASH(await fs.promises.readFile(args.source));
    assert.equal(sourceSha256After, originalSha256, 'source FLA changed during Gate 0 census');
    const receipt = {
      schemaVersion: 'issue711-continuous-state-gate0/1',
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
      rootGraphic: {
        name: descriptor.sourceLibraryItemName,
        frameCount: descriptor.frameCount,
        visibleLayerCount: descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length,
      },
      gate0,
      activeSpanCensus: census,
      currentProductionResolutionAtGate0Run: preExtensionResolverResults,
      sourceMutation: 'NO',
      projectMutation: 'NONE',
    };
    const receiptArtifact = await writeVerified(
      args.out,
      path.join(args.out, 'gate0-receipt.json'),
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
    );
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true);
    console.log(JSON.stringify({ ...receipt, receiptArtifact }, null, 2));
    return;
  }

  const rasterizer = createResearchRasterizer();
  const probes = [];
  try {
    for (const frameIndex of TARGET_SEQUENCE) {
      const expectedStatus = AUTHORED_BOUNDARIES.includes(frameIndex) ? 'AUTHORED' : 'TWEEN_RECONSTRUCTED';
      const frameContextResult = source.buildGraphicFrameContext(
        descriptor.timelineXml,
        descriptor.frameSpanIndex,
        frameIndex,
        `issue711-root:${descriptor.sourceLibraryItemName}@${frameIndex}`,
      );
      if (!frameContextResult.ok) {
        probes.push({
          requestedRootGraphicFrame: frameIndex,
          status: 'BLOCKED',
          blockerReason: frameContextResult.message,
          authoredSpanCensus: census.map((layer) => ({
            layerIndex: layer.layerIndex,
            visible: layer.visible,
            selectedSpan: selectCensusSpanForFrame(layer, frameIndex),
          })),
        });
        continue;
      }

      try {
        const built = buildProbe(source, descriptor, rootInstance, frameContextResult.value, frameIndex);
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
        const acceptedHash = ACCEPTED_CONTROL_HASHES[frameIndex] ?? null;
        if (acceptedHash) {
          assert.equal(HASH(pngBytes), acceptedHash,
            `accepted frame ${frameIndex} control changed under the Issue #711 run`);
        }
        probes.push({
          requestedRootGraphicFrame: frameIndex,
          status: expectedStatus,
          authoredSpanCensus: census.map((layer) => ({
            layerIndex: layer.layerIndex,
            visible: layer.visible,
            selectedSpan: selectCensusSpanForFrame(layer, frameIndex),
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
            acceptedControlSha256: acceptedHash,
          },
          artifacts,
          pngBytes,
        });
      } catch (error) {
        if (ACCEPTED_CONTROL_HASHES[frameIndex]) throw error;
        probes.push({
          requestedRootGraphicFrame: frameIndex,
          status: 'BLOCKED',
          blockerReason: error instanceof Error ? error.message : String(error),
          authoredSpanCensus: census.map((layer) => ({
            layerIndex: layer.layerIndex,
            visible: layer.visible,
            selectedSpan: selectCensusSpanForFrame(layer, frameIndex),
          })),
        });
      }
    }

    assert.deepEqual(probes.map((probe) => probe.requestedRootGraphicFrame), TARGET_SEQUENCE);
    for (const frameIndex of [20, 21, 22, 25]) {
      const control = probes.find((probe) => probe.requestedRootGraphicFrame === frameIndex);
      assert.equal(control?.status, AUTHORED_BOUNDARIES.includes(frameIndex) ? 'AUTHORED' : 'TWEEN_RECONSTRUCTED',
        `accepted control frame ${frameIndex} did not resolve`);
    }
    const resolvedProbes = probes.filter((probe) => probe.pngBytes);
    const sheetSvg = contactSheetSvg(probes);
    const firstSheetRaster = await rasterizer.render(sheetSvg, 1440, 648);
    const repeatedSheetRaster = await rasterizer.render(sheetSvg, 1440, 648);
    const sheetSvgBytes = Buffer.from(sheetSvg, 'utf8');
    const sheetPngBytes = Buffer.from(firstSheetRaster.pngBytes);
    assert.equal(HASH(repeatedSheetRaster.pngBytes), HASH(sheetPngBytes), 'repeated contact sheet render differs');
    const contactSheetArtifacts = {
      svg: await writeVerified(args.out, path.join(args.out, 'temporal-contact-sheet.svg'), sheetSvgBytes),
      png: await writeVerified(args.out, path.join(args.out, 'temporal-contact-sheet.png'), sheetPngBytes),
    };
    for (const probe of probes) delete probe.pngBytes;

    const sourceSha256After = HASH(await fs.promises.readFile(args.source));
    assert.equal(sourceSha256After, originalSha256, 'source FLA changed during reconstruction');
    if (resolvedProbes.length === TARGET_SEQUENCE.length) {
      assert.equal(new Set(resolvedProbes.map((probe) => probe.determinism.pngSha256)).size, TARGET_SEQUENCE.length,
        'one or more requested frames collapsed to an identical PNG state');
    }

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
    const controls = Object.fromEntries([20, 21, 22, 25].map((frameIndex) => {
      const probe = probes.find((candidate) => candidate.requestedRootGraphicFrame === frameIndex);
      return [frameIndex, {
        status: probe?.status ?? 'MISSING',
        expectedPngSha256: ACCEPTED_CONTROL_HASHES[frameIndex],
        actualPngSha256: probe?.determinism?.pngSha256 ?? null,
        matchesAcceptedOutput: probe?.determinism?.pngSha256 === ACCEPTED_CONTROL_HASHES[frameIndex],
      }];
    }));
    const receipt = {
      schemaVersion: 'issue711-continuous-state-reconstruction/1',
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
      gate0,
      currentProductionResolutionAfterExtension: preExtensionResolverResults,
      hierarchy: rootSummary,
      probes,
      controls,
      temporalContactSheet: {
        layout: '3×2, row-major chronological: F20 → F21 → F22 / F23 → F24 → F25',
        allCellsLabeled: probes.every((probe) => probe.status),
        blockedCellsHaveReason: probes.filter((probe) => probe.status === 'BLOCKED')
          .every((probe) => typeof probe.blockerReason === 'string' && probe.blockerReason.length > 0),
        repeatedPngIdentical: HASH(repeatedSheetRaster.pngBytes) === HASH(sheetPngBytes),
        artifacts: contactSheetArtifacts,
      },
      gateC: {
        referenceSource: 'No approved Issue #711 source-video or Animate frame reference is present in the existing #707–#710 evidence or the primary fixture folder.',
        maintainerContinuityResult: 'PENDING_MAINTAINER',
        frame23Visual: 'PENDING_MAINTAINER',
        frame24Visual: 'PENDING_MAINTAINER',
      },
      sourceMutation: 'NO',
      projectMutation: 'NONE: production inspection/catalog only; no project commit API was called',
      manualPoseOrImageRepair: 'NO',
      fixtureSpecificBranch: 'NO',
      movieClipRuntimeAdded: 'NO',
      scriptExecutionAdded: 'NO',
      playbackUiAdded: 'NO',
      humanVisualReview: 'PENDING_MAINTAINER',
      result: probes.every((probe) => probe.status !== 'BLOCKED')
        ? 'RECONSTRUCTED_READY_FOR_HUMAN_CONTINUITY_REVIEW'
        : 'PARTIAL_BLOCKED_WITH_TEMPORAL_CONTACT_SHEET',
    };
    const receiptArtifact = await writeVerified(
      args.out,
      path.join(args.out, 'completion-receipt.json'),
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
    );
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true);
    console.log(JSON.stringify({ ...receipt, receiptArtifact }, null, 2));
  } finally {
    rasterizer.close();
  }
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
