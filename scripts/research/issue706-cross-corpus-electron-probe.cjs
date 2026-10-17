#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const B4_SECTION_DEFINITIONS = [
  { id: 'SCENE_STATES', title: 'SCENE STATES' },
  { id: 'GRAPHIC_ASSETS', title: 'DIRECT GRAPHIC ASSETS' },
  { id: 'TEMPORAL_ANCHORS', title: 'TEMPORAL ACTION ANCHORS' },
  { id: 'PROP_ASSETS', title: 'PROP ASSETS' },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--fixture-id') args.fixtureId = argv[++index];
    else if (argv[index] === '--wave') args.wave = argv[++index];
    else if (argv[index] === '--asset-family-hint') args.assetFamilyHint = argv[++index];
    else if (argv[index] === '--action-intent-hint') args.actionIntentHint = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'out', 'fixtureId']) assert.ok(args[name], `missing --${name}`);
  args.assetFamilyHint ??= 'NONE';
  args.actionIntentHint ??= 'false';
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Issue #706 visual artifacts must remain outside the repository');
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
  return { file: path.basename(filePath), sha256, byteLength: value.length };
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
          'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog && window.pandaStage?.fla?.staticSnapshotPreview)',
        );
        if (ready) return window;
      } catch {
        // Wait for the renderer bridge to finish loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage renderer APIs did not become ready');
}

function makeCatalogTargetIndex(catalogEntries) {
  return new Map(catalogEntries.map((entry) => {
    const target = entry.target;
    const key = target.kind === 'graphic-symbol'
      ? `graphic-symbol\u0000${target.sourceLibraryItemName}`
      : `scene\u0000${target.sourceTimelineIndex ?? 0}`;
    return [key, entry];
  }));
}

function visitElements(elements, callback) {
  for (const element of elements ?? []) {
    callback(element);
    if (element.kind === 'group') visitElements(element.elements, callback);
  }
}

function contextForAddress(source, owner, ownerKind, frameIndex) {
  if (ownerKind === 'graphic-symbol') {
    return source.buildGraphicFrameContext(
      owner.timelineXml,
      owner.frameSpanIndex,
      frameIndex,
      `issue706:${owner.sourceLibraryItemName}:${frameIndex}`,
    );
  }
  return source.buildSceneFrameContext(owner.xml, frameIndex, `issue706:scene:${owner.index}:${frameIndex}`);
}

function nestedTimingBlockers(frameContext, source) {
  const symbols = new Map(source.graphicSymbols.map((symbol) => [symbol.sourceLibraryItemName, symbol]));
  const blockers = new Set();
  const visited = new Set();
  const visitContext = (context) => {
    for (const layer of context.layers) {
      if (!layer.visible) continue;
      visitElements(layer.elements, (element) => {
        if (element.visible === false || element.kind !== 'symbol') return;
        if (element.symbolType === 'movieclip') {
          blockers.add('MOVIECLIP_RUNTIME');
          return;
        }
        if (element.symbolType !== 'graphic') {
          blockers.add('UNKNOWN_SEMANTIC');
          return;
        }
        const child = symbols.get(element.libraryItemName);
        if (!child) {
          blockers.add('UNKNOWN_SEMANTIC');
          return;
        }
        if (child.frameCount > 1) {
          blockers.add('NESTED_GRAPHIC_TIMING');
          return;
        }
        if (visited.has(child.sourceLibraryItemName)) return;
        visited.add(child.sourceLibraryItemName);
        visitContext(child.frameContext);
      });
    }
  };
  visitContext(frameContext);
  return [...blockers].sort();
}

async function readAdaptedSource(normalizedBytes) {
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const { adaptFlaXflDisplaySource } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const zip = await JSZip.loadAsync(normalizedBytes);
  const documentFile = zip.file('DOMDocument.xml');
  assert.ok(documentFile, 'normalized archive is missing DOMDocument.xml');
  const documentXml = await documentFile.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraryXmlEntries.push({ name, xml: await file.async('string') });
  }
  const result = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(result.ok, true, result.message || 'production XFL display adapter rejected the normalized archive');
  return result.source;
}

function collectCandidates(source, catalogEntries, sourceSha256, blockerClassifier) {
  const targetIndex = makeCatalogTargetIndex(catalogEntries);
  const candidates = [];
  const timelineFacts = [];

  const addOwner = (owner, ownerKind, ownerName, frameSpanIndex) => {
    const starts = blockerClassifier.enumerateVisibleAuthoredStarts(frameSpanIndex);
    const tweenSpanCount = frameSpanIndex.layers
      .filter((layer) => layer.visible)
      .flatMap((layer) => layer.spans)
      .filter((span) => span.tweenType !== 'none').length;
    timelineFacts.push({
      ownerKind,
      ownerName,
      sourceIndex: owner.index ?? null,
      frameCount: frameSpanIndex.frameCount,
      visibleLayerCount: frameSpanIndex.layers.filter((layer) => layer.visible).length,
      authoredStartCount: starts.length,
      authoredStarts: starts.map((start) => ({
        frameIndex: start.frameIndex,
        visibleLayerIndexes: start.layerIndexes,
        spans: start.spans,
      })),
      tweenSpanCount,
    });

    const targetKey = ownerKind === 'graphic-symbol'
      ? `graphic-symbol\u0000${owner.sourceLibraryItemName}`
      : `scene\u0000${owner.index}`;
    const catalogEntry = targetIndex.get(targetKey) ?? null;
    for (const authored of starts) {
      const candidateId = blockerClassifier.makeCandidateId(sourceSha256, ownerKind, ownerName, authored.frameIndex);
      const sourceAddress = {
        sourceSha256,
        ownerKind,
        ownerName,
        frameIndex: authored.frameIndex,
        visibleLayerIndexes: authored.layerIndexes,
        authoredSpans: authored.spans,
      };
      let contextResult;
      try {
        contextResult = contextForAddress(source, owner, ownerKind, authored.frameIndex);
      } catch (error) {
        contextResult = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      const blockers = contextResult?.ok
        ? nestedTimingBlockers(contextResult.value, source)
        : [blockerClassifier.classifyBlockerFamily(contextResult?.message)];
      const catalogBlocker = !catalogEntry
        ? 'UNKNOWN_SEMANTIC'
        : !catalogEntry.previewSupported
          ? blockerClassifier.classifyBlockerFamily(catalogEntry.unsupportedReason)
          : null;
      if (catalogBlocker) blockers.push(catalogBlocker);
      const uniqueBlockers = [...new Set(blockers)].sort();
      const baseTarget = catalogEntry?.target;
      const renderTarget = baseTarget && authored.frameIndex < baseTarget.frameCount
        ? { ...baseTarget, selectedFrameIndex: authored.frameIndex }
        : null;
      const status = !renderTarget
        ? 'DISCOVERED_UNSUPPORTED'
        : uniqueBlockers.length > 0
          ? 'DISCOVERED_UNSUPPORTED'
          : 'RENDER_PENDING';
      candidates.push({
        candidateId,
        discoveryDisposition: status === 'DISCOVERED_UNSUPPORTED' ? 'BLOCKED' : 'CANDIDATE_DISCOVERED',
        discoveryBlockerFamilies: uniqueBlockers,
        sourceAddress,
        sourceAddressLabel: `${ownerName}@${authored.frameIndex}`,
        displayLabel: candidateId,
        sourceStateClasses: [ownerKind === 'scene' ? 'AUTHORED_SCENE_STATE' : 'DIRECT_GRAPHIC_ASSET'],
        renderAddressClass: ownerKind === 'scene' ? 'DIRECT_SCENE_FRAME' : 'DIRECT_GRAPHIC_FRAME',
        renderAddress: renderTarget
          ? { target: renderTarget, catalogPreviewSupported: catalogEntry.previewSupported }
          : { ownerKind, ownerName, frameIndex: authored.frameIndex, catalogTarget: null },
        status,
        blockerFamilies: uniqueBlockers,
        artifactSection: ownerKind === 'scene' ? 'SCENE_STATES' : 'GRAPHIC_ASSETS',
        _rootName: ownerKind === 'scene' ? owner.name : owner.sourceLibraryItemName,
        ...(contextResult?.ok ? { _frameContext: contextResult.value } : {}),
        ...(renderTarget ? { target: renderTarget } : {}),
      });
    }
  };

  for (const scene of source.sceneTimelines) {
    const ownerName = `scene:${scene.index}:${scene.name}`;
    if (scene.frameSpanIndex) {
      addOwner(scene, 'scene', ownerName, scene.frameSpanIndex);
      continue;
    }

    // C02's accepted Scene adapter does not expose a frame-span index. Keep
    // its catalog's initial Scene state visible as one bounded discovery row,
    // and report that no later Scene spans were enumerated through this seam.
    const catalogEntry = targetIndex.get(`scene\u0000${scene.index}`) ?? null;
    const visibleLayerIndexes = scene.frameContext.layers
      .map((layer, index) => layer.visible && layer.elements.length > 0 ? index : -1)
      .filter((index) => index >= 0);
    timelineFacts.push({
      ownerKind: 'scene',
      ownerName,
      sourceIndex: scene.index,
      frameCount: scene.frameCount,
      visibleLayerCount: scene.frameContext.layers.filter((layer) => layer.visible).length,
      authoredStartCount: 0,
      authoredStarts: [],
      tweenSpanCount: 0,
      sceneAdapterSpanIndexExposed: false,
      catalogInitialFrameCandidateCount: visibleLayerIndexes.length > 0 && catalogEntry ? 1 : 0,
    });
    if (visibleLayerIndexes.length === 0 || !catalogEntry) continue;
    const candidateId = blockerClassifier.makeCandidateId(sourceSha256, 'scene', ownerName, 0);
    const blockers = nestedTimingBlockers(scene.frameContext, source);
    if (!catalogEntry.previewSupported) blockers.push(blockerClassifier.classifyBlockerFamily(catalogEntry.unsupportedReason));
    const uniqueBlockers = [...new Set(blockers)].sort();
    const target = scene.frameCount > 0 ? { ...catalogEntry.target, selectedFrameIndex: 0 } : null;
    candidates.push({
      candidateId,
      discoveryDisposition: !target || uniqueBlockers.length > 0 ? 'BLOCKED' : 'CANDIDATE_DISCOVERED',
      discoveryBlockerFamilies: uniqueBlockers,
      sourceAddress: {
        sourceSha256,
        ownerKind: 'scene',
        ownerName,
        frameIndex: 0,
        visibleLayerIndexes,
        authoredSpans: [],
        addressBasis: 'catalog-initial-frame; Scene span index is not exposed by the current adapter',
      },
      sourceAddressLabel: `${ownerName}@0`,
      displayLabel: candidateId,
      sourceStateClasses: ['AUTHORED_SCENE_STATE'],
      renderAddressClass: 'DIRECT_SCENE_FRAME',
      renderAddress: target ? { target, catalogPreviewSupported: catalogEntry.previewSupported } : { ownerKind: 'scene', ownerName, frameIndex: 0 },
      status: !target || uniqueBlockers.length > 0 ? 'DISCOVERED_UNSUPPORTED' : 'RENDER_PENDING',
      blockerFamilies: uniqueBlockers,
      artifactSection: 'SCENE_STATES',
      _rootName: scene.name,
      _frameContext: scene.frameContext,
      ...(target ? { target } : {}),
    });
  }
  for (const symbol of source.graphicSymbols) {
    addOwner(symbol, 'graphic-symbol', symbol.sourceLibraryItemName, symbol.frameSpanIndex);
  }
  candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'));
  return { candidates, timelineFacts };
}

function serializeInspectionExpression() {
  return `
    (async () => {
      const api = window.pandaStage.fla;
      const response = await api.chooseAndInspect(${JSON.stringify(crypto.randomUUID())});
      if (!response.ok) return { ok: false, error: response.error, diagnostics: response.diagnostics, trace: response.trace };
      const catalogResponse = await api.staticSnapshotCatalog({
        format: 'fla-static-snapshot-catalog', version: 1, sessionId: response.sessionId,
      });
      if (!catalogResponse.ok) {
        await api.cancel(response.sessionId);
        return { ok: false, error: catalogResponse.error, trace: response.trace };
      }
      const ir = response.ir;
      return {
        ok: true,
        sessionId: response.sessionId,
        source: ir.source,
        document: ir.document,
        structure: ir.structure ?? null,
        compatibility: ir.compatibility,
        summary: ir.summary,
        media: ir.media.map((item) => ({
          id: item.id, name: item.name, sourceReference: item.sourceReference,
          bitmapDataReference: item.bitmapDataReference, width: item.width, height: item.height,
          payload: { bytes: Array.from(item.payload.bytes) },
        })),
        trace: response.trace ?? null,
        catalog: catalogResponse.entries,
        diagnostics: response.diagnostics ?? [],
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
        assert.equal(options.webPreferences?.sandbox, true, 'contact sheet rasterizer must keep sandbox enabled');
        assert.equal(options.webPreferences?.contextIsolation, true, 'contact sheet rasterizer must keep context isolation enabled');
        assert.equal(options.webPreferences?.nodeIntegration, false, 'contact sheet rasterizer must keep Node integration disabled');
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
    async render(svg, width, height) {
      return manager.rasterize({ requestId: crypto.randomUUID(), svg, width, height, pixelCount: width * height });
    },
    close() {
      for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
      manager.close();
    },
  };
}

function artifactSectionForCandidate(args, candidate) {
  if (args.assetFamilyHint === 'PROP') return 'PROP_ASSETS';
  if (args.actionIntentHint === 'true' && candidate.sourceAddress.ownerKind === 'scene') return 'TEMPORAL_ANCHORS';
  return candidate.sourceAddress.ownerKind === 'scene' ? 'SCENE_STATES' : 'GRAPHIC_ASSETS';
}

function hasForbiddenSvgControlCharacter(svg) {
  for (let index = 0; index < svg.length; index += 1) {
    const code = svg.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

async function buildCandidateSvg(source, candidate, resolveFlaDisplayList, buildSvgForResolvedDisplayList, resolveBitmapMedia) {
  const root = {
    kind: candidate.sourceAddress.ownerKind === 'scene' ? 'scene' : 'graphic',
    name: candidate._rootName,
    frameContext: candidate._frameContext,
  };
  const resolved = resolveFlaDisplayList({ root, symbols: source.symbols });
  if (!resolved.ok) return resolved;
  return buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: candidate.target.renderTargetId,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia,
  });
}

async function run(args) {
  assertExternalDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });
  const sourceBytes = await fs.promises.readFile(args.source);
  const sourceSha256Before = HASH(sourceBytes);
  assert.equal(sourceSha256Before, args.expectedSha256.toLowerCase(), 'source bytes do not match the approved C3 corpus hash');

  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  let normalizedBytes = sourceBytes;
  let normalization = { applied: false, mode: 'strict-source-bytes' };
  if (classification.state === 'RECOVERY_CANDIDATE') {
    const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
    assert.equal(normalized.applied, true, 'production recovery candidate could not be normalized in memory');
    assert.equal(normalized.originalBytesWritten, false, 'recovery helper must not write original source bytes');
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

  require(path.join(ROOT, 'dist-electron/main/index.js'));

  const mainWindow = await waitForMainWindow();
  const inspected = await mainWindow.webContents.executeJavaScript(serializeInspectionExpression(), true);
  if (!inspected?.ok) throw new Error(`production inspection failed: ${JSON.stringify(inspected)}`);
  const sourceSha256AfterInspection = await fs.promises.readFile(args.source).then(HASH);
  assert.equal(sourceSha256AfterInspection, sourceSha256Before, 'source FLA changed during inspection');
  assert.equal(inspected.source.basename, path.basename(args.source), 'production inspector opened a different source basename');
  assert.equal(inspected.trace?.originalSourceSha256, sourceSha256Before, 'Main trace source hash differs from the original bytes');
  assert.equal(inspected.trace?.parserResult, 'success', 'production parser did not complete');
  assert.equal(inspected.source.sha256, HASH(normalizedBytes), 'production parser did not inspect the expected normalized archive bytes');
  if (normalization.applied) {
    assert.equal(inspected.trace?.recoveryApplied, true, 'production inspection did not apply the expected safe recovery');
    assert.equal(inspected.trace?.postNormalizationStrictResult, 'pass', 'production post-normalization strict preflight did not pass');
  } else {
    assert.equal(inspected.trace?.recoveryApplied, false, 'strict source unexpectedly entered recovery');
  }

  const blockerCore = require('./issue706-cross-corpus-core.cjs');
  const batchCore = require('./issue705-black-asset-batch-core.cjs');
  const displaySource = await readAdaptedSource(normalizedBytes);
  const discovery = collectCandidates(displaySource, inspected.catalog, inspected.source.sha256, blockerCore);
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const { createFlaStaticSnapshotBitmapMediaLookup } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'));
  const media = inspected.media.map((item) => ({
    ...item,
    payload: { bytes: Uint8Array.from(item.payload.bytes) },
  }));
  const resolveBitmapMedia = createFlaStaticSnapshotBitmapMediaLookup(media);
  const rasterizer = createResearchRasterizer();
  let finalized;
  let contactSheet = { status: 'NOT_PRODUCED', reason: 'no nonblank supported render was available' };
  try {
    for (const candidate of discovery.candidates) {
      if (candidate.status !== 'RENDER_PENDING') continue;
      try {
        const svgResult = await buildCandidateSvg(displaySource, candidate, resolveFlaDisplayList, buildSvgForResolvedDisplayList, resolveBitmapMedia);
        if (!svgResult.ok) {
          candidate.status = 'UNSUPPORTED';
          candidate.blockerFamilies = [...new Set([
            ...candidate.blockerFamilies,
            blockerCore.classifyBlockerFamily(svgResult.message),
          ])].sort();
          candidate.renderFailure = { code: svgResult.code, message: svgResult.message };
          continue;
        }
        if (hasForbiddenSvgControlCharacter(svgResult.svg) || /\bhref="(?!data:image\/png;base64,|#)/iu.test(svgResult.svg)) {
          candidate.status = 'UNSUPPORTED';
          candidate.blockerFamilies = ['UNKNOWN_SEMANTIC'];
          candidate.renderFailure = { code: 'SVG_SECURITY_BOUNDARY', message: 'SVG output contains a control character or external resource reference' };
          continue;
        }
        const svgBytes = Buffer.from(svgResult.svg, 'utf8');
        const raster = await rasterizer.render(svgResult.svg, svgResult.width, svgResult.height);
        const pngBytes = Buffer.from(raster.pngBytes);
        const svgArtifact = await writeVerified(path.join(args.out, 'renders', `${candidate.candidateId}.svg`), svgBytes);
        const pngArtifact = await writeVerified(path.join(args.out, 'renders', `${candidate.candidateId}.png`), pngBytes);
        candidate.status = 'RENDER_PENDING';
        candidate.artifactSection = artifactSectionForCandidate(args, candidate);
        candidate.svgSha256 = svgArtifact.sha256;
        candidate.pngSha256 = pngArtifact.sha256;
        candidate.output = {
          svg: { path: `renders/${svgArtifact.file}`, sha256: svgArtifact.sha256, byteLength: svgArtifact.byteLength },
          png: { path: `renders/${pngArtifact.file}`, sha256: pngArtifact.sha256, byteLength: pngArtifact.byteLength, width: raster.width, height: raster.height },
        };
        candidate.pngBytes = pngBytes;
        candidate.pngInfo = batchCore.analyzePng(pngBytes);
        candidate.isBlank = candidate.pngInfo.isBlank;
      } catch (error) {
        candidate.status = 'RENDER_FAILED';
        candidate.blockerFamilies = [...new Set([
          ...candidate.blockerFamilies,
          blockerCore.classifyBlockerFamily(error instanceof Error ? error.message : error),
        ])].sort();
        candidate.renderFailure = { code: 'CANDIDATE_RENDER_FAILED', message: error instanceof Error ? error.message : String(error) };
      }
    }

    finalized = batchCore.finalizeBatchResults(discovery.candidates, { sectionDefinitions: B4_SECTION_DEFINITIONS });
    const finalizedById = new Map(finalized.results.map((candidate) => [candidate.candidateId, candidate]));
    for (const candidate of discovery.candidates) {
      candidate.artifactBatchStatus = finalizedById.get(candidate.candidateId)?.status ?? candidate.status;
      candidate.status = candidate.artifactBatchStatus;
    }
    if (finalized.previewTiles.length > 0) {
      const layout = batchCore.buildContactSheetLayout(finalized.previewTiles, {
        sheetWidth: 1740,
        columns: 4,
        margin: 40,
        gap: 20,
        tileHeight: 280,
        sectionDefinitions: B4_SECTION_DEFINITIONS,
      });
      if (layout.width > 4096 || layout.height > 4096 || layout.width * layout.height > 16_777_216) {
        contactSheet = { status: 'BLOCKED_RENDER_BUDGET', width: layout.width, height: layout.height, tileCount: layout.order.length };
      } else {
        const contactSvg = batchCore.buildContactSheetSvg(layout, finalized.previewTiles);
        const svgArtifact = await writeVerified(path.join(args.out, 'contact-sheet.svg'), Buffer.from(contactSvg, 'utf8'));
        const raster = await rasterizer.render(contactSvg, layout.width, layout.height);
        const pngBytes = Buffer.from(raster.pngBytes);
        const pngInfo = batchCore.analyzePng(pngBytes);
        const pngArtifact = await writeVerified(path.join(args.out, 'contact-sheet.png'), pngBytes);
        contactSheet = {
          status: 'PRODUCED',
          tileCount: layout.order.length,
          sectionIds: layout.sections.map((section) => section.id),
          width: raster.width,
          height: raster.height,
          visiblePixelCount: pngInfo.visiblePixelCount,
          svg: { path: 'contact-sheet.svg', sha256: svgArtifact.sha256, byteLength: svgArtifact.byteLength },
          png: { path: 'contact-sheet.png', sha256: pngArtifact.sha256, byteLength: pngArtifact.byteLength },
          layout,
        };
      }
    }
  } finally {
    rasterizer.close();
  }

  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(inspected.sessionId)} })`, true);
  await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true);

  const sourceSha256After = await fs.promises.readFile(args.source).then(HASH);
  const candidates = finalized.results.map((candidate) => {
    const receipt = { ...candidate };
    delete receipt.target;
    delete receipt.pngBytes;
    delete receipt._rootName;
    delete receipt._frameContext;
    return receipt;
  });
  const output = {
    schemaVersion: 'issue706-electron-probe/1',
    fixtureId: args.fixtureId,
    source: {
      basename: path.basename(args.source),
      originalSha256: sourceSha256Before,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: sourceSha256Before === sourceSha256After,
      normalizedSha256: inspected.source.sha256,
      normalization,
      recoveryTrace: inspected.trace,
    },
    productionInspection: {
      parserResult: inspected.trace?.parserResult ?? 'unreported',
      postNormalizationStrictResult: inspected.trace?.postNormalizationStrictResult ?? 'not-run',
      mediaCount: inspected.media.length,
      compatibility: inspected.compatibility,
      structure: inspected.structure,
      document: inspected.document,
      diagnostics: inspected.diagnostics,
      catalog: inspected.catalog.map((entry) => ({
        target: entry.target,
        previewSupported: entry.previewSupported,
        unsupportedReason: entry.unsupportedReason ?? null,
      })),
    },
    discovery: {
      method: 'Production XFL display-list adapter visible span-start union for Graphic timelines; the Scene initial catalog frame is recorded separately where Scene spans are not exposed; held ranges are not expanded.',
      timelineFacts: discovery.timelineFacts,
      candidateCount: candidates.length,
      discoveredCount: candidates.filter((candidate) => candidate.discoveryDisposition === 'CANDIDATE_DISCOVERED').length,
      blockedCount: candidates.filter((candidate) => candidate.discoveryDisposition === 'BLOCKED').length,
      candidates,
    },
    artifactBatch: {
      attemptedCount: candidates.filter((candidate) => candidate.output).length,
      blankCount: finalized.results.filter((candidate) => candidate.status === 'BLANK').length,
      exactDuplicateGroupCount: finalized.duplicateGroups.length,
      exactDuplicateMemberCount: finalized.duplicateGroups.reduce((sum, group) => sum + group.memberCandidateIds.length, 0),
      renderFailureCount: candidates.filter((candidate) => candidate.status === 'RENDER_FAILED').length,
      unsupportedCount: candidates.filter((candidate) => candidate.status === 'UNSUPPORTED' || candidate.status === 'DISCOVERED_UNSUPPORTED').length,
      projectMutation: 'NONE: inspect/catalog/preview/cancel only; no commit API called',
      contactSheet,
      duplicateGroups: finalized.duplicateGroups,
    },
    sourcePathPolicy: 'explicit named top-level source only; original bytes were read-only',
    evidenceDirectory: args.out,
  };
  assert.equal(output.source.sourceHashInvariance, true, 'original source hash changed during the probe');
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

app.on('window-all-closed', () => {});
const args = parseArgs(process.argv.slice(1));
fs.mkdirSync(path.join(args.out, 'electron-user-data'), { recursive: true });
app.setPath('userData', path.join(args.out, 'electron-user-data'));
process.env.VITE_DEV_SERVER_URL = '';
process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = args.source;
app.whenReady()
  .then(() => run(args))
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
