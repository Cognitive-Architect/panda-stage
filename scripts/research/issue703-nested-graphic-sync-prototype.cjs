#!/usr/bin/env node
/*
 * Issue #703 bounded research prototype.
 *
 * This runner derives candidate nested Graphic frame selections in memory,
 * then feeds the selected contexts to the existing production display-list
 * resolver, SVG compositor, and sandboxed PNG rasterizer. It never writes to
 * the source FLA or reference image and does not change production semantics.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require(path.join(__dirname, '..', '..', 'node_modules', 'jszip'));
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
const {
  adaptFlaXflDisplaySource,
  getFlaXflDirectChildren,
} = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
const {
  buildSvgForResolvedDisplayList,
} = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
const {
  resolveFlaTimelineFrameSpan,
} = require(path.join(ROOT, 'dist-electron/main/services/fla-timeline-frame-span-resolver.js'));
const {
  FlaStaticSnapshotWindowManager,
} = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));

const EXPECTED_SOURCE_SHA256 = 'a328a163dd212f0369e27b30e5078178fd42744954203fdad6a9cd06f3b171fa';
const EXPECTED_NORMALIZED_ARCHIVE_SHA256 = '681237abb7b32e79ce89ff8e283b0573b4bf170c6b85830828c7a10911bc7a33';
const EXPECTED_REFERENCE_SHA256 = '7c53292222edcd183bb0d40ee647435ef860f9894cd4203150317364ca679eac';
const PROBE_PARENT_FRAMES = [0, 5, 6, 7, 8, 9, 10, 11];
const FULL_COMPOSITE_FRAMES = [0, 6, 7, 8, 9, 10];
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--archive') args.archive = argv[++i];
    else if (argv[i] === '--reference') args.reference = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function selectionForInstance(instance, parentFrame, childFrameCount, hypothesis) {
  const firstFrame = instance.firstFrame === undefined ? 0 : Number(instance.firstFrame);
  assert.ok(Number.isSafeInteger(firstFrame) && firstFrame >= 0, 'invalid authored firstFrame');
  assert.ok(childFrameCount > 0, 'child Graphic has no frames');
  if (hypothesis === 'fixed-default-frame') return Math.min(firstFrame, childFrameCount - 1);

  const elapsed = parentFrame - instance.spanStart;
  assert.ok(elapsed >= 0 && elapsed < instance.spanDuration, 'parent frame is outside instance span');
  const mode = (instance.loop || 'loop').trim().toLocaleLowerCase('en-US');
  if (mode === 'loop') return (firstFrame + elapsed) % childFrameCount;
  if (mode === 'play once') return Math.min(firstFrame + elapsed, childFrameCount - 1);
  if (mode === 'single frame') return Math.min(firstFrame, childFrameCount - 1);
  throw new Error(`Unsupported playback mode in this bounded prototype: ${mode}`);
}

function timelineSelections(descriptor, frameIndex) {
  const selected = resolveFlaTimelineFrameSpan(descriptor.frameSpanIndex, frameIndex);
  assert.equal(selected.ok, true, selected.message || 'could not select source timeline frame');
  return selected.layers;
}

function rawInstancesInFrame(frame) {
  const frameChildren = getFlaXflDirectChildren(frame.xml, 'DOMFrame');
  const elements = frameChildren.find((child) => child.name === 'elements');
  if (!elements) return [];
  return getFlaXflDirectChildren(elements.xml, 'elements')
    .filter((child) => child.name === 'DOMSymbolInstance')
    .filter((child) => child.attributes.isVisible !== 'false' && child.attributes.visible !== 'false');
}

function rawInstancesAtTimelineFrame(timelineXml, frameIndex) {
  const layersWrapper = getFlaXflDirectChildren(timelineXml, 'DOMTimeline')
    .find((child) => child.name === 'layers');
  if (!layersWrapper) return [];
  const layers = getFlaXflDirectChildren(layersWrapper.xml, 'layers')
    .filter((child) => child.name === 'DOMLayer');
  const instances = [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const framesWrapper = getFlaXflDirectChildren(layers[layerIndex].xml, 'DOMLayer')
      .find((child) => child.name === 'frames');
    if (!framesWrapper) continue;
    const frames = getFlaXflDirectChildren(framesWrapper.xml, 'frames')
      .filter((child) => child.name === 'DOMFrame');
    for (const frame of frames) {
      const spanStart = Number(frame.attributes.index ?? 0);
      const spanDuration = Number(frame.attributes.duration ?? 1);
      if (frameIndex < spanStart || frameIndex >= spanStart + spanDuration) continue;
      for (const element of rawInstancesInFrame(frame)) {
        instances.push({
          libraryItemName: element.attributes.libraryItemName?.trim(),
          symbolType: (element.attributes.symbolType || 'graphic').trim().toLocaleLowerCase('en-US'),
          loop: element.attributes.loop,
          firstFrame: element.attributes.firstFrame,
          lastFrame: element.attributes.lastFrame,
          spanStart,
          spanDuration,
          spanEndExclusive: spanStart + spanDuration,
          parentLayerIndex: layerIndex,
          visible: true,
          transform: rawTransform(element),
        });
      }
    }
  }
  return instances;
}

function instancesAtFrame(descriptor, frameIndex) {
  const instances = [];
  for (const selected of timelineSelections(descriptor, frameIndex)) {
    if (selected.kind !== 'authored-frame' || !selected.visible) continue;
    for (const element of rawInstancesInFrame(selected.sourceFrame)) {
      instances.push({
        libraryItemName: element.attributes.libraryItemName?.trim(),
        symbolType: (element.attributes.symbolType || 'graphic').trim().toLocaleLowerCase('en-US'),
        loop: element.attributes.loop,
        firstFrame: element.attributes.firstFrame,
        lastFrame: element.attributes.lastFrame,
        spanStart: selected.span.index,
        spanDuration: selected.span.duration,
        spanEndExclusive: selected.span.endExclusive,
        parentLayerIndex: selected.layerIndex,
        visible: true,
        transform: rawTransform(element),
      });
    }
  }
  return instances;
}

function rawTransform(instance) {
  const transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const matrixWrapper = getFlaXflDirectChildren(instance.xml, 'DOMSymbolInstance')
    .find((child) => child.name === 'matrix');
  if (!matrixWrapper) return transform;
  const matrix = getFlaXflDirectChildren(matrixWrapper.xml, 'matrix')
    .find((child) => child.name === 'Matrix');
  const attributes = matrix?.attributes ?? matrixWrapper.attributes;
  for (const [key, value] of Object.entries(attributes)) {
    if (key in transform) transform[key] = Number(value);
  }
  return transform;
}

function timelineStateAtFrame(descriptor, frameIndex) {
  return timelineSelections(descriptor, frameIndex).map((selected) => ({
    layerIndex: selected.layerIndex,
    visible: selected.visible,
    kind: selected.kind,
    ...(selected.kind === 'authored-frame' ? {
      state: selected.state,
      spanStart: selected.span.index,
      spanDuration: selected.span.duration,
      spanEndExclusive: selected.span.endExclusive,
      tweenType: selected.span.tweenType,
    } : selected.kind === 'unsupported-tween-interior' ? {
      spanStart: selected.span.index,
      spanDuration: selected.span.duration,
      spanEndExclusive: selected.span.endExclusive,
      tweenType: selected.span.tweenType,
    } : {}),
  }));
}

function findSymbol(source, rawName) {
  const normalized = String(rawName || '').replaceAll('\\', '/').replace(/^LIBRARY\//iu, '').replace(/\.xml$/iu, '');
  return source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === normalized || symbol.userLabel === normalized,
  );
}

function buildFrameContext(source, descriptor, frameIndex) {
  if (frameIndex === 0 && descriptor.frameContext.frameIndex === 0) {
    return { ok: true, value: descriptor.frameContext };
  }
  return source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `graphic:${descriptor.sourceLibraryItemName}`,
  );
}

function deriveSelection(source, rootSymbol, parentFrame, hypothesis) {
  const rootContext = buildFrameContext(source, rootSymbol, parentFrame);
  assert.equal(rootContext.ok, true, rootContext.message || 'root Graphic frame selection failed');
  const rootInstances = instancesAtFrame(rootSymbol, parentFrame);
  assert.equal(rootInstances.length, 3, `expected three authored nested Graphics, found ${rootInstances.length}`);
  const symbols = new Map(source.symbols);
  const childRows = [];
  const childFrameByName = new Map();

  for (const instance of rootInstances) {
    assert.equal(instance.symbolType, 'graphic', `non-Graphic child in bounded probe: ${instance.libraryItemName}`);
    const descriptor = findSymbol(source, instance.libraryItemName);
    assert.ok(descriptor, `child definition missing: ${instance.libraryItemName}`);
    const childFrame = selectionForInstance(instance, parentFrame, descriptor.frameCount, hypothesis);
    const frameContext = buildFrameContext(source, descriptor, childFrame);
    assert.equal(frameContext.ok, true, frameContext.message || 'child Graphic frame selection failed');
    symbols.set(descriptor.sourceLibraryItemName, {
      kind: 'graphic',
      libraryItemName: descriptor.sourceLibraryItemName,
      frameContext: frameContext.value,
    });
    const nestedInputs = instancesAtFrame(descriptor, childFrame);
    childRows.push({
      parentFrame,
      parentSpanStart: instance.spanStart,
      parentSpanDuration: instance.spanDuration,
      relativeElapsed: parentFrame - instance.spanStart,
      childLibraryItem: descriptor.sourceLibraryItemName,
      childFrameCount: descriptor.frameCount,
      playbackMode: instance.loop || 'default/loop',
      firstFrame: instance.firstFrame ?? null,
      lastFrame: instance.lastFrame ?? null,
      transform: instance.transform,
      visible: instance.visible,
      resolvedChildFrame: childFrame,
      selectedChildTimelineState: timelineStateAtFrame(descriptor, childFrame),
      nestedInputs,
    });
    const existing = childFrameByName.get(descriptor.sourceLibraryItemName);
    assert.ok(existing === undefined || existing === childFrame, 'shared child symbol has conflicting per-instance selections');
    childFrameByName.set(descriptor.sourceLibraryItemName, childFrame);
  }

  symbols.set(rootSymbol.sourceLibraryItemName, {
    kind: 'graphic',
    libraryItemName: rootSymbol.sourceLibraryItemName,
    frameContext: rootContext.value,
  });
  return { symbols, rootContext: rootContext.value, childRows, childFrameByName };
}

function composeScene(source, scene, renderTargetId, selected) {
  const resolved = resolveFlaDisplayList({
    root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext },
    symbols: selected.symbols,
  });
  assert.equal(resolved.ok, true, resolved.message || 'production display-list resolution failed');
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  assert.equal(composed.ok, true, composed.message || 'production SVG composition failed');
  const hrefs = [...composed.svg.matchAll(/\bhref="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(hrefs.every((href) => href.startsWith('data:image/png;base64,') || href.startsWith('#')),
    'SVG contains a non-embedded or external resource');
  return { resolved: resolved.displayList, composed };
}

function resultFileName(hypothesis, frameIndex, ext) {
  const suffix = hypothesis === 'graphic-loop' ? 'H1' : 'H2';
  return `${suffix}-parent-${String(frameIndex).padStart(2, '0')}.${ext}`;
}

async function rasterize(manager, svg, width, height) {
  return manager.rasterize({
    requestId: crypto.randomUUID(),
    svg,
    width,
    height,
    pixelCount: width * height,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert.ok(args.source && args.reference && args.out, 'usage: --source <fla> --archive <normalized-fla> --reference <image> --out <directory>');
  fs.mkdirSync(args.out, { recursive: true });
  const userData = path.join(args.out, 'electron-user-data');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);

  const sourceBefore = fs.readFileSync(args.source);
  const referenceBefore = fs.readFileSync(args.reference);
  const archivePath = args.archive || args.source;
  const archiveBefore = fs.readFileSync(archivePath);
  const sourceHashBefore = HASH(sourceBefore);
  const referenceHashBefore = HASH(referenceBefore);
  const archiveHashBefore = HASH(archiveBefore);
  assert.equal(sourceHashBefore, EXPECTED_SOURCE_SHA256, 'source FLA is not the Issue #702 source');
  assert.equal(referenceHashBefore, EXPECTED_REFERENCE_SHA256, 'reference image is not the exact Issue #702 reference');
  if (args.archive) {
    assert.equal(archiveHashBefore, EXPECTED_NORMALIZED_ARCHIVE_SHA256, 'archive copy is not the Issue #702 normalized archive');
  }

  const zip = await JSZip.loadAsync(archiveBefore);
  const docFile = zip.file('DOMDocument.xml');
  assert.ok(docFile, 'source archive has no DOMDocument.xml');
  const docXml = await docFile.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const entry = zip.file(name);
    if (entry) libraryXmlEntries.push({ name, xml: await entry.async('string') });
  }
  const adapted = adaptFlaXflDisplaySource(docXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL display adapter failed');
  const source = adapted.source;
  const rootCandidates = source.graphicSymbols.filter((symbol) => symbol.frameCount === 30 && symbol.hasNestedSymbol);
  assert.equal(rootCandidates.length, 1, `expected one 30-frame parent Graphic, found ${rootCandidates.length}`);
  const rootSymbol = rootCandidates[0];
  const scene = source.sceneTimelines[0];
  assert.ok(scene, 'source has no Scene timeline');
  const sceneParentInstances = rawInstancesAtTimelineFrame(scene.xml, 0);
  assert.equal(sceneParentInstances.length, 1, `expected one parent Graphic instance on the Scene, found ${sceneParentInstances.length}`);
  const sceneParentInstance = sceneParentInstances[0];
  assert.equal(findSymbol(source, sceneParentInstance.libraryItemName)?.sourceLibraryItemName,
    rootSymbol.sourceLibraryItemName, 'Scene instance does not point to the probed parent Graphic');
  const renderTargetId = `fla-render-target-${crypto.createHash('sha256')
    .update(archiveBefore).update('\u0000', 'utf8').update(`scene\u0000timeline\u0000${scene.index}`, 'utf8').digest('hex')}`;

  const bodyRows = [];
  const baselineRows = deriveSelection(source, rootSymbol, 0, 'graphic-loop').childRows;
  const bodyCandidate = baselineRows.map((row) => findSymbol(source, row.childLibraryItem))
    .find((symbol) => symbol && symbol.frameCount === 1927);
  assert.ok(bodyCandidate, 'the 1927-frame body Graphic was not found in the parent instances');
  const instanceSpanEvidence = [];
  for (const frame of PROBE_PARENT_FRAMES) {
    const h1 = deriveSelection(source, rootSymbol, frame, 'graphic-loop');
    const h2 = deriveSelection(source, rootSymbol, frame, 'fixed-default-frame');
    const h1Body = h1.childRows.find((row) => row.childLibraryItem === bodyCandidate.sourceLibraryItemName);
    const h2Body = h2.childRows.find((row) => row.childLibraryItem === bodyCandidate.sourceLibraryItemName);
    assert.ok(h1Body && h2Body, 'body nested Graphic instance missing at a tested parent frame');
    if (frame === 6 || frame === 7) {
      assert.equal(h1Body.nestedInputs.length, 0, `B/C body frame ${frame} unexpectedly contains a deeper symbol instance`);
    }
    const h3Rows = h1.childRows.map((row) => {
      const firstFrame = row.firstFrame === null ? 0 : Number(row.firstFrame);
      return {
        libraryItem: row.childLibraryItem,
        frame: (firstFrame + frame) % row.childFrameCount,
      };
    });
    const h1Rows = h1.childRows.map((row) => ({ libraryItem: row.childLibraryItem, frame: row.resolvedChildFrame }));
    bodyRows.push({
      documentFrame: 0,
      parentFrame: frame,
      parentTimelineState: timelineStateAtFrame(rootSymbol, frame),
      pandaLayerOrder: h1.rootContext.layers.map((layer) => layer.name),
      h1ResolvedBodyFrame: h1Body.resolvedChildFrame,
      h2ResolvedBodyFrame: h2Body.resolvedChildFrame,
      h3AbsoluteBodyFrame: h3Rows.find((row) => row.libraryItem === bodyCandidate.sourceLibraryItemName)?.frame,
      h3MatchesH1: JSON.stringify(h3Rows) === JSON.stringify(h1Rows),
      h1NestedInputs: h1Body.nestedInputs,
      h1AllResolvedFrames: h1Rows,
      h2AllResolvedFrames: h2.childRows.map((row) => ({ libraryItem: row.childLibraryItem, frame: row.resolvedChildFrame })),
    });
    if (frame === 0) instanceSpanEvidence.push(...h1.childRows);
  }

  const security = { sandbox: false, contextIsolation: false, nodeIntegration: true };
  const manager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    {
      create(options) {
        security.sandbox = options.webPreferences?.sandbox === true;
        security.contextIsolation = options.webPreferences?.contextIsolation === true;
        security.nodeIntegration = options.webPreferences?.nodeIntegration === true;
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

  const outputs = [];
  const builtByHypothesis = new Map();
  try {
    for (const frame of FULL_COMPOSITE_FRAMES) {
      const selected = deriveSelection(source, rootSymbol, frame, 'graphic-loop');
      assert.ok(selected.childRows.every((row) => row.nestedInputs.length === 0),
        `full composite parent frame ${frame} contains a deeper symbol instance outside this bounded prototype`);
      assert.ok(selected.childRows.every((row) => row.selectedChildTimelineState.every((state) =>
        state.kind === 'authored-frame' && state.tweenType === 'none')),
      `full composite parent frame ${frame} crosses an unsupported tween state`);
      assert.ok(timelineStateAtFrame(rootSymbol, frame).every((state) =>
        state.kind === 'authored-frame' && state.tweenType === 'none'),
      `full composite parent frame ${frame} crosses an unsupported parent tween state`);
      const { resolved, composed } = composeScene(source, scene, renderTargetId, selected);
      const svgBytes = Buffer.from(composed.svg, 'utf8');
      const raster = await rasterize(manager, composed.svg, composed.width, composed.height);
      const stem = resultFileName('graphic-loop', frame, '');
      const svgPath = path.join(args.out, stem.replace(/\.$/u, '.svg'));
      const pngPath = path.join(args.out, stem.replace(/\.$/u, '.png'));
      fs.writeFileSync(svgPath, svgBytes);
      fs.writeFileSync(pngPath, Buffer.from(raster.pngBytes));
      const output = {
        hypothesis: 'H1 Graphic loop follows parent span time',
        parentFrame: frame,
        selectedNestedFrames: selected.childRows.map((row) => ({
          libraryItem: row.childLibraryItem,
          frame: row.resolvedChildFrame,
          frameCount: row.childFrameCount,
          parentSpan: [row.parentSpanStart, row.parentSpanStart + row.parentSpanDuration],
          relativeElapsed: row.relativeElapsed,
          playbackMode: row.playbackMode,
          firstFrame: row.firstFrame,
          lastFrame: row.lastFrame,
          transform: row.transform,
          visible: row.visible,
          selectedChildTimelineState: row.selectedChildTimelineState,
        })),
        resolvedNodeCount: resolved.resolvedNodeCount,
        composition: composed.composition,
        svg: { path: svgPath, byteLength: svgBytes.byteLength, sha256: HASH(svgBytes) },
        png: { path: pngPath, width: raster.width, height: raster.height, byteLength: raster.pngBytes.byteLength,
          sha256: HASH(Buffer.from(raster.pngBytes)) },
      };
      outputs.push(output);
      builtByHypothesis.set(frame, { selected, composed, output });
    }

    for (const frame of [6, 7]) {
      const selected = deriveSelection(source, rootSymbol, frame, 'fixed-default-frame');
      const { resolved, composed } = composeScene(source, scene, renderTargetId, selected);
      const svgBytes = Buffer.from(composed.svg, 'utf8');
      const raster = await rasterize(manager, composed.svg, composed.width, composed.height);
      const svgPath = path.join(args.out, resultFileName('fixed-default-frame', frame, 'svg'));
      const pngPath = path.join(args.out, resultFileName('fixed-default-frame', frame, 'png'));
      fs.writeFileSync(svgPath, svgBytes);
      fs.writeFileSync(pngPath, Buffer.from(raster.pngBytes));
      outputs.push({
        hypothesis: 'H2 nested Graphics stay on fixed/default first frame',
        parentFrame: frame,
        selectedNestedFrames: selected.childRows.map((row) => ({ libraryItem: row.childLibraryItem, frame: row.resolvedChildFrame })),
        resolvedNodeCount: resolved.resolvedNodeCount,
        composition: composed.composition,
        svg: { path: svgPath, byteLength: svgBytes.byteLength, sha256: HASH(svgBytes) },
        png: { path: pngPath, width: raster.width, height: raster.height, byteLength: raster.pngBytes.byteLength,
          sha256: HASH(Buffer.from(raster.pngBytes)) },
      });
    }

    const repeatability = [];
    for (const frame of [0, 6, 7]) {
      const selected = deriveSelection(source, rootSymbol, frame, 'graphic-loop');
      const rebuilt = composeScene(source, scene, renderTargetId, selected);
      const raster = await rasterize(manager, rebuilt.composed.svg, rebuilt.composed.width, rebuilt.composed.height);
      const first = builtByHypothesis.get(frame).output;
      const svgHash = HASH(Buffer.from(rebuilt.composed.svg, 'utf8'));
      const pngHash = HASH(Buffer.from(raster.pngBytes));
      repeatability.push({
        parentFrame: frame,
        firstSvgSha256: first.svg.sha256,
        repeatSvgSha256: svgHash,
        svgIdentical: first.svg.sha256 === svgHash,
        firstPngSha256: first.png.sha256,
        repeatPngSha256: pngHash,
        pngIdentical: first.png.sha256 === pngHash,
      });
    }
    assert.ok(repeatability.every((entry) => entry.svgIdentical && entry.pngIdentical), 'repeated prototype output is not byte-identical');
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });

    const sourceAfter = fs.readFileSync(args.source);
    const referenceAfter = fs.readFileSync(args.reference);
    const archiveAfter = fs.readFileSync(archivePath);
    const sourceHashAfter = HASH(sourceAfter);
    const referenceHashAfter = HASH(referenceAfter);
    const archiveHashAfter = HASH(archiveAfter);
    assert.equal(sourceHashAfter, sourceHashBefore, 'source FLA changed while the prototype was running');
    assert.equal(referenceHashAfter, referenceHashBefore, 'reference image changed while the prototype was running');
    assert.equal(archiveHashAfter, archiveHashBefore, 'normalized archive copy changed while the prototype was running');

    const receipt = {
      schemaVersion: 'issue703-nested-graphic-sync-prototype/1',
      issue: 703,
      motherPullRequest: 677,
      source: { sha256Before: sourceHashBefore, sha256After: sourceHashAfter, unchanged: true, byteLength: sourceBefore.byteLength },
      archiveInput: {
        path: archivePath,
        sha256Before: archiveHashBefore,
        sha256After: archiveHashAfter,
        unchanged: true,
        derivedFromIssue702NormalizedCopy: Boolean(args.archive),
        byteLength: archiveBefore.byteLength,
      },
      reference: { sha256Before: referenceHashBefore, sha256After: referenceHashAfter, unchanged: true, byteLength: referenceBefore.byteLength },
      parent: {
        documentTarget: {
          kind: 'scene',
          name: scene.name,
          documentFrame: 0,
          frameCount: scene.frameCount,
          sceneInstance: sceneParentInstance,
          renderTargetId,
        },
        libraryItem: rootSymbol.sourceLibraryItemName,
        label: rootSymbol.userLabel,
        rootTimelineStateByFrame: PROBE_PARENT_FRAMES.map((frame) => ({
          documentFrame: 0,
          parentFrame: frame,
          layers: timelineStateAtFrame(rootSymbol, frame),
        })),
        selectedFrames: PROBE_PARENT_FRAMES,
        childInstancesAtFrame0: instanceSpanEvidence,
      },
      childFrameHypothesisResults: bodyRows,
      renders: outputs,
      repeatability,
      sandbox: security,
      noExternalResourcesInSvg: true,
      sourceMutation: 'NO',
      productionResolverChanged: 'NO',
      tweenOrRuntimeImplemented: 'NO',
      visualReferenceReview: 'PENDING MAINTAINER REVIEW',
    };
    fs.writeFileSync(path.join(args.out, 'issue703-prototype-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
    manager.close();
  }
}

app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    app.exit(1);
  }
});
