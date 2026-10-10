#!/usr/bin/env node
/*
 * Issue #705 bounded Black-only Stage B3 artifact pipeline.
 *
 * The accepted #704 manifest is the sole candidate/classification input.
 * This runner dispatches its supported render addresses through the current
 * production display-list resolver, SVG compositor, and sandboxed snapshot
 * rasterizer, then produces a deterministic batch manifest and contact sheet.
 * It does not change product UI, project data, source files, or render rules.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require(path.join(__dirname, '..', '..', 'node_modules', 'jszip'));
const { app, BrowserWindow, ipcMain } = require('electron');
const core = require('./issue705-black-asset-batch-core.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const PIPELINE_VERSION = 'issue705-black-asset-batch/1';

const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
const {
  adaptFlaXflDisplaySource,
} = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
const { FlaStaticSnapshotWindowManager } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') args.manifest = argv[++index];
    else if (argv[index] === '--archive') args.archive = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['manifest', 'archive', 'out']) assert.ok(args[name], `missing required --${name} argument`);
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, path.resolve(value)]));
}

async function sha256File(filePath) {
  return HASH(await fs.promises.readFile(filePath));
}

function assertExternalOutputDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'B3 binary artifacts must remain outside the repository');
}

async function writeVerified(filePath, bytes) {
  const expectedHash = HASH(bytes);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    assert.equal(await sha256File(filePath), expectedHash, `refusing to overwrite different evidence: ${filePath}`);
  } else {
    await fs.promises.writeFile(filePath, bytes, { flag: 'wx' });
  }
  assert.equal(await sha256File(filePath), expectedHash, `artifact write hash mismatch: ${filePath}`);
  return { path: path.relative(path.dirname(path.dirname(filePath)), filePath).replaceAll('\\', '/'), sha256: expectedHash, byteLength: bytes.length };
}

function relativePath(outputDirectory, filePath) {
  return path.relative(outputDirectory, filePath).replaceAll('\\', '/');
}

function findGraphic(source, name) {
  const matches = source.graphicSymbols.filter((symbol) => symbol.sourceLibraryItemName === name);
  assert.equal(matches.length, 1, `B2 source address resolves to ${matches.length} Graphic definitions: ${name}`);
  return matches[0];
}

function buildGraphicContext(source, symbol, frameIndex) {
  assert.ok(Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex < symbol.frameCount,
    `B2 frame address is outside ${symbol.sourceLibraryItemName}: ${frameIndex}`);
  const context = source.buildGraphicFrameContext(
    symbol.timelineXml,
    symbol.frameSpanIndex,
    frameIndex,
    `issue705:${symbol.sourceLibraryItemName}:${frameIndex}`,
  );
  assert.equal(context.ok, true, context.message || `could not select ${symbol.sourceLibraryItemName}@${frameIndex}`);
  return context.value;
}

function defaultLoopFrame(instance, parentFrame, childFrameCount) {
  const span = instance.containingSpan ?? instance.parentSpan;
  const mode = String(instance.playbackMode ?? 'loop').trim().toLocaleLowerCase('en-US');
  const firstFrame = instance.firstFrame ?? null;
  const lastFrame = instance.lastFrame ?? null;
  assert.ok(span && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.endExclusive), 'B2 nested span is incomplete');
  assert.equal(instance.symbolType ?? 'graphic', 'graphic', `B2 nested instance is not a Graphic: ${instance.libraryItemName}`);
  assert.equal(mode, 'loop', `B2 nested playback is outside the #703 boundary: ${instance.libraryItemName}`);
  assert.equal(firstFrame, null, `B2 nested firstFrame is outside the #703 boundary: ${instance.libraryItemName}`);
  assert.equal(lastFrame, null, `B2 nested lastFrame is outside the #703 boundary: ${instance.libraryItemName}`);
  assert.equal(span.start, 0, `B2 nested span origin is outside the #703 boundary: ${instance.libraryItemName}`);
  assert.ok(parentFrame >= span.start && parentFrame < span.endExclusive, `B2 parent frame is outside nested span: ${instance.libraryItemName}`);
  const elapsed = parentFrame - span.start;
  if (childFrameCount === 1) return 0;
  assert.ok(elapsed < childFrameCount, `B2 nested Graphic would cross an untested wrap: ${instance.libraryItemName}`);
  return elapsed;
}

function installChildFrames(source, symbols, selectionRows, syncInputs, parentFrame) {
  assert.ok(Array.isArray(selectionRows), 'B2 render address lacks nested selections');
  assert.ok(Array.isArray(syncInputs), 'B2 source provenance lacks nested synchronization inputs');
  assert.equal(selectionRows.length, syncInputs.length, 'B2 nested route/provenance lengths differ');
  const resolved = [];
  for (let index = 0; index < selectionRows.length; index += 1) {
    const selection = selectionRows[index];
    const sync = syncInputs[index];
    const libraryItemName = selection.libraryItemName ?? selection.sourceLibraryItemName;
    assert.equal(libraryItemName, sync.libraryItemName, 'B2 nested route and provenance order differ');
    const child = findGraphic(source, libraryItemName);
    const expectedFrame = defaultLoopFrame({ ...sync, ...selection, symbolType: selection.symbolType ?? sync.symbolType }, parentFrame, child.frameCount);
    const suppliedFrame = selection.frameIndex ?? sync.resolvedChildFrame ?? sync.frameIndex;
    if (suppliedFrame !== undefined && suppliedFrame !== null) {
      assert.equal(suppliedFrame, expectedFrame, `B2 nested frame disagrees with #703 at ${libraryItemName}`);
    }
    const frameContext = buildGraphicContext(source, child, expectedFrame);
    symbols.set(libraryItemName, { kind: 'graphic', libraryItemName, frameContext });
    resolved.push({ libraryItemName, frameIndex: expectedFrame });
  }
  return resolved;
}

function buildRenderInput(source, candidate) {
  const address = candidate.renderAddress;
  const symbols = new Map(source.symbols);
  let root;

  if (address.rootKind === 'scene') {
    const scenes = source.sceneTimelines.filter((scene) => scene.name === address.sceneName);
    assert.equal(scenes.length, 1, `B2 Scene target is ambiguous or missing: ${address.sceneName}`);
    const scene = scenes[0];
    assert.equal(address.documentFrameIndex, 0, 'B2 Scene frame is outside the accepted one-frame Black wrapper');
    const rootGraphic = address.parentGraphic;
    assert.ok(rootGraphic && Number.isSafeInteger(rootGraphic.frameIndex), 'B2 Scene render address lacks a parent Graphic frame');
    const parent = findGraphic(source, rootGraphic.sourceLibraryItemName);
    const parentContext = buildGraphicContext(source, parent, rootGraphic.frameIndex);
    symbols.set(parent.sourceLibraryItemName, {
      kind: 'graphic',
      libraryItemName: parent.sourceLibraryItemName,
      frameContext: parentContext,
    });
    const selections = rootGraphic.nestedSelections ?? address.nestedSelections ?? [];
    const syncInputs = candidate.sourceProvenance.nestedSynchronizationInputs ?? [];
    const selectedChildren = installChildFrames(source, symbols, selections, syncInputs, rootGraphic.frameIndex);
    root = { kind: 'scene', name: scene.name, frameContext: scene.frameContext };
    return {
      root,
      symbols,
      targetId: candidate.sourceProvenance.targetIdentity.targetId,
      selectedChildren,
      selectedParent: { sourceLibraryItemName: parent.sourceLibraryItemName, frameIndex: rootGraphic.frameIndex },
    };
  }

  assert.equal(address.rootKind, 'graphic', `unknown B2 root kind: ${address.rootKind}`);
  const rootSymbol = findGraphic(source, address.sourceLibraryItemName);
  const frameIndex = address.frameIndex;
  const frameContext = buildGraphicContext(source, rootSymbol, frameIndex);
  symbols.set(rootSymbol.sourceLibraryItemName, {
    kind: 'graphic',
    libraryItemName: rootSymbol.sourceLibraryItemName,
    frameContext,
  });

  const selections = address.nestedSelections ?? [];
  const syncInputs = candidate.sourceProvenance.nestedSynchronizationInputs ?? [];
  const selectedChildren = selections.length > 0
    ? installChildFrames(source, symbols, selections, syncInputs, frameIndex)
    : [];
  return {
    root: { kind: 'graphic', name: rootSymbol.sourceLibraryItemName, frameContext },
    symbols,
    targetId: candidate.sourceProvenance.targetIdentity.targetId,
    selectedChildren,
    selectedParent: { sourceLibraryItemName: rootSymbol.sourceLibraryItemName, frameIndex },
  };
}

function secureSvg(svg) {
  const references = [...svg.matchAll(/\bhref="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(references.every((href) => href.startsWith('data:image/png;base64,') || href.startsWith('#')),
    'rendered SVG contains an external or non-embedded resource');
}

function resultSourceAddress(candidate) {
  return {
    ownerKind: candidate.sourceProvenance.sourceOwner.kind,
    sourceName: candidate.sourceProvenance.sourceOwner.name,
    authoredFrameIndex: candidate.sourceProvenance.authoredState.frameIndex,
    heldFrameRange: candidate.sourceProvenance.authoredState.heldFrameRange ?? null,
  };
}

function routeLabel(candidate, selectedPlan = null) {
  if (candidate.renderAddress.rootKind === 'scene') {
    const parent = candidate.renderAddress.parentGraphic;
    const children = selectedPlan?.selectedChildren ?? [];
    return `Scene@${candidate.renderAddress.documentFrameIndex} → ${parent.sourceLibraryItemName}@${parent.frameIndex}` +
      children.map((child) => ` → ${child.libraryItemName}@${child.frameIndex}`).join('');
  }
  const root = `${candidate.renderAddress.sourceLibraryItemName}@${candidate.renderAddress.frameIndex}`;
  return selectedPlan?.selectedChildren?.length
    ? root + selectedPlan.selectedChildren.map((child) => ` → ${child.libraryItemName}@${child.frameIndex}`).join('')
    : root;
}

function makeSkippedResult(candidate) {
  const common = {
    candidateId: candidate.candidateId,
    sourceProvenance: candidate.sourceProvenance,
    sourceAddress: resultSourceAddress(candidate),
    sourceAddressLabel: `${candidate.sourceProvenance.sourceOwner.name}@${candidate.sourceProvenance.authoredState.frameIndex}`,
    displayLabel: candidate.candidateId,
    sourceStateClasses: candidate.sourceStateClasses,
    renderAddressClass: candidate.renderAddressClass,
    renderAddress: candidate.renderAddress,
    b2Disposition: candidate.disposition,
    b2ReasonCode: candidate.reasonCode,
    b2Evidence: candidate.evidence?.render ? {
      svgSha256: candidate.evidence.render.svgSha256,
      pngSha256: candidate.evidence.render.pngSha256,
    } : null,
    output: null,
    pngInfo: null,
    pngBytes: null,
    svgSha256: null,
    pngSha256: null,
  };
  if (candidate.renderAddressClass === 'TEMPORAL_ONLY') {
    return { ...common, status: 'SKIPPED_BY_CLASS', skipReason: 'TEMPORAL_ONLY_STATIC_PREVIEW_NOT_AUTHORIZED' };
  }
  return { ...common, status: 'UNSUPPORTED', skipReason: candidate.reasonCode };
}

function makeRenderedRow(candidate, outputDirectory, render, plan, svgBytes, pngBytes, pngInfo) {
  const prior = candidate.evidence.render;
  return {
    candidateId: candidate.candidateId,
    sourceProvenance: candidate.sourceProvenance,
    sourceAddress: resultSourceAddress(candidate),
    sourceAddressLabel: `${candidate.sourceProvenance.sourceOwner.name}@${candidate.sourceProvenance.authoredState.frameIndex}`,
    displayLabel: candidate.candidateId,
    sourceStateClasses: candidate.sourceStateClasses,
    renderAddressClass: candidate.renderAddressClass,
    renderAddress: candidate.renderAddress,
    b2Disposition: candidate.disposition,
    b2ReasonCode: candidate.reasonCode,
    b2Evidence: { svgSha256: prior.svgSha256, pngSha256: prior.pngSha256 },
    status: 'RENDER_PENDING',
    isBlank: pngInfo.isBlank,
    pngInfo,
    svgSha256: HASH(svgBytes),
    pngSha256: HASH(pngBytes),
    pngBytes,
    composition: render.composition,
    routeLabel: routeLabel(candidate, plan),
    output: {
      svg: {
        path: relativePath(outputDirectory, path.join(outputDirectory, 'renders', `${candidate.candidateId}.svg`)),
        sha256: HASH(svgBytes),
        byteLength: svgBytes.length,
      },
      png: {
        path: relativePath(outputDirectory, path.join(outputDirectory, 'renders', `${candidate.candidateId}.png`)),
        sha256: HASH(pngBytes),
        byteLength: pngBytes.length,
        width: render.width,
        height: render.height,
      },
    },
    priorB2EvidenceComparison: {
      svgHashMatches: HASH(svgBytes) === prior.svgSha256.toLowerCase(),
      pngHashMatches: HASH(pngBytes) === prior.pngSha256.toLowerCase(),
    },
    previewIncluded: false,
  };
}

async function parseNormalizedArchive(archiveBytes) {
  const zip = await JSZip.loadAsync(archiveBytes);
  const docFile = zip.file('DOMDocument.xml');
  assert.ok(docFile, 'normalized B2 archive has no DOMDocument.xml');
  const docXml = await docFile.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraryXmlEntries.push({ name, xml: await file.async('string') });
  }
  const adapted = adaptFlaXflDisplaySource(docXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL display adapter failed');
  return adapted.source;
}

function makeRasterizer(outputDirectory) {
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
  fs.mkdirSync(path.join(outputDirectory, 'electron-user-data'), { recursive: true });
  app.setPath('userData', path.join(outputDirectory, 'electron-user-data'));
  return {
    manager,
    security,
    handlers,
    async render(svg, width, height) {
      return manager.rasterize({
        requestId: crypto.randomUUID(),
        svg,
        width,
        height,
        pixelCount: width * height,
      });
    },
    close() {
      for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
      manager.close();
    },
  };
}

async function runSyntheticControls(rasterizer, outputDirectory, realRows) {
  const blankSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"></svg>';
  const blankRaster = await rasterizer.render(blankSvg, 32, 32);
  const blankPngBytes = Buffer.from(blankRaster.pngBytes);
  const blankPngInfo = core.analyzePng(blankPngBytes);
  assert.equal(blankPngInfo.isBlank, true, 'synthetic transparent raster did not trigger blank detection');
  const blankSvgPath = path.join(outputDirectory, 'controls', 'blank-control.svg');
  const blankPngPath = path.join(outputDirectory, 'controls', 'blank-control.png');
  await writeVerified(blankSvgPath, Buffer.from(blankSvg, 'utf8'));
  await writeVerified(blankPngPath, blankPngBytes);

  const base = realRows.find((row) => row.status === 'RENDER_PENDING' && !row.isBlank);
  assert.ok(base, 'no nonblank render is available for the synthetic duplicate control');
  const duplicateFixture = core.finalizeBatchResults([
    {
      candidateId: 'B3-CONTROL-DUP-A',
      sourceAddress: { fixture: 'distinct-source-address-a' },
      sourceStateClasses: ['COMPONENT_ASSET'],
      renderAddressClass: 'DIRECT_COMPONENT_STATE',
      sourceAddressLabel: 'fixture-a@0',
      displayLabel: 'B3-CONTROL-DUP-A',
      status: 'RENDER_PENDING',
      isBlank: false,
      pngSha256: base.pngSha256,
      svgSha256: base.svgSha256,
      pngBytes: base.pngBytes,
      pngInfo: base.pngInfo,
    },
    {
      candidateId: 'B3-CONTROL-DUP-B',
      sourceAddress: { fixture: 'distinct-source-address-b' },
      sourceStateClasses: ['COMPONENT_ASSET'],
      renderAddressClass: 'DIRECT_COMPONENT_STATE',
      sourceAddressLabel: 'fixture-b@0',
      displayLabel: 'B3-CONTROL-DUP-B',
      status: 'RENDER_PENDING',
      isBlank: false,
      pngSha256: base.pngSha256,
      svgSha256: base.svgSha256,
      pngBytes: base.pngBytes,
      pngInfo: base.pngInfo,
    },
  ]);
  assert.equal(duplicateFixture.duplicateGroups.length, 1, 'exact PNG duplicate control did not group');
  assert.deepEqual(duplicateFixture.duplicateGroups[0].memberCandidateIds, ['B3-CONTROL-DUP-A', 'B3-CONTROL-DUP-B']);
  assert.equal(duplicateFixture.duplicateGroups[0].representativeCandidateId, 'B3-CONTROL-DUP-A');
  assert.equal(duplicateFixture.previewTiles.length, 1, 'duplicate control did not select exactly one preview representative');
  assert.equal(duplicateFixture.duplicateGroups[0].members.length, 2, 'duplicate control lost member provenance');

  const attempted = [];
  const isolated = await core.isolateCandidateFailures(
    [{ candidateId: 'B3-CONTROL-PARTIAL-A' }, { candidateId: 'B3-CONTROL-PARTIAL-FAIL' }, { candidateId: 'B3-CONTROL-PARTIAL-C' }],
    async (candidate) => {
      attempted.push(candidate.candidateId);
      if (candidate.candidateId.endsWith('FAIL')) throw new Error('synthetic per-candidate failure');
      return { candidateId: candidate.candidateId, status: 'RENDER_PENDING' };
    },
  );
  assert.equal(attempted.length, 3, 'one synthetic candidate failure aborted the rest of the batch');
  assert.equal(isolated[1].status, 'RENDER_FAILED');
  assert.equal(isolated[0].status, 'RENDER_PENDING');
  assert.equal(isolated[2].status, 'RENDER_PENDING');

  return {
    blankControl: {
      candidateId: 'B3-CONTROL-BLANK',
      synthetic: true,
      sourceStateAdded: false,
      status: 'BLANK',
      previewIncluded: false,
      svg: { path: relativePath(outputDirectory, blankSvgPath), sha256: HASH(Buffer.from(blankSvg, 'utf8')) },
      png: { path: relativePath(outputDirectory, blankPngPath), sha256: HASH(blankPngBytes), width: blankRaster.width, height: blankRaster.height },
      pixelAnalysis: blankPngInfo,
    },
    duplicateControl: {
      synthetic: true,
      includedInBlackCandidates: false,
      exactEvidence: 'Two separate synthetic source-address records intentionally reference one byte-identical B3 render output.',
      duplicateGroups: duplicateFixture.duplicateGroups,
      previewTileCount: duplicateFixture.previewTiles.length,
      memberCandidateIdsPreserved: true,
    },
    partialFailureControl: {
      synthetic: true,
      attemptedCandidateIds: attempted,
      statuses: isolated.map((row) => ({ candidateId: row.candidateId, status: row.status, error: row.error ?? null })),
      subsequentCandidatesCompleted: isolated[2].status === 'RENDER_PENDING',
    },
  };
}

function serializableCandidate(row) {
  const serializable = { ...row };
  delete serializable.pngBytes;
  delete serializable.pngInfo;
  return {
    ...serializable,
    pixelAnalysis: row.pngInfo,
    visibleBounds: row.pngInfo?.visibleBounds ?? null,
    blank: row.pngInfo?.isBlank ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalOutputDirectory(args.out);
  const [manifestBytes, archiveBytes] = await Promise.all([
    fs.promises.readFile(args.manifest),
    fs.promises.readFile(args.archive),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const manifestSha256 = HASH(core.normalizeManifestLineEndings(manifestBytes));
  const { candidatesById } = core.validateB2Manifest(manifest, manifestSha256);
  const originalSourcePath = path.resolve(manifest.source.localPath);
  const sourceSha256Before = await sha256File(originalSourcePath);
  const normalizedArchiveSha256 = HASH(archiveBytes);
  assert.equal(sourceSha256Before, manifest.source.sha256.toLowerCase(), 'original source FLA hash differs from B2');
  assert.equal(normalizedArchiveSha256, manifest.source.normalizedArchiveSha256.toLowerCase(), 'normalized archive hash differs from B2');
  const source = await parseNormalizedArchive(archiveBytes);
  assert.equal(source.sceneTimelines.length, manifest.enumeration.sceneTimelineCount, 'B2 Scene count differs from the production adapter');
  assert.equal(source.graphicSymbols.length, manifest.enumeration.graphicTimelineCount, 'B2 Graphic count differs from the production adapter');

  const outputDirectory = args.out;
  const rasterizer = makeRasterizer(outputDirectory);
  const sortedCandidates = [...candidatesById.values()].sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0);
  const renderableCandidates = sortedCandidates.filter((candidate) =>
    candidate.renderAddressClass === 'PARENT_COMPOSITE' ||
    candidate.renderAddressClass === 'DIRECT_FULL_CHARACTER_STATE' ||
    candidate.renderAddressClass === 'DIRECT_COMPONENT_STATE',
  );
  const preclassifiedRows = sortedCandidates.filter((candidate) => !renderableCandidates.includes(candidate)).map(makeSkippedResult);

  try {
    const batchRows = await core.isolateCandidateFailures(renderableCandidates, async (candidate) => {
      const plan = buildRenderInput(source, candidate);
      const resolved = resolveFlaDisplayList({ root: plan.root, symbols: plan.symbols });
      assert.equal(resolved.ok, true, resolved.message || `production resolver failed for ${candidate.candidateId}`);
      const composed = buildSvgForResolvedDisplayList({
        displayList: resolved.displayList,
        renderTargetId: plan.targetId,
        stageWidth: source.stageWidth,
        stageHeight: source.stageHeight,
        shapeBlocks: source.shapeBlocks,
        resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
      });
      assert.equal(composed.ok, true, composed.message || `production SVG builder failed for ${candidate.candidateId}`);
      secureSvg(composed.svg);
      const svgBytes = Buffer.from(composed.svg, 'utf8');
      const raster = await rasterizer.render(composed.svg, composed.width, composed.height);
      const pngBytes = Buffer.from(raster.pngBytes);
      const pngInfo = core.analyzePng(pngBytes);
      const svgPath = path.join(outputDirectory, 'renders', `${candidate.candidateId}.svg`);
      const pngPath = path.join(outputDirectory, 'renders', `${candidate.candidateId}.png`);
      await writeVerified(svgPath, svgBytes);
      await writeVerified(pngPath, pngBytes);
      return makeRenderedRow(candidate, outputDirectory, raster, plan, svgBytes, pngBytes, pngInfo);
    });

    const candidatesByIdMap = new Map(renderableCandidates.map((candidate) => [candidate.candidateId, candidate]));
    const completeBatchRows = batchRows.map((row) => {
      if (row.status !== 'RENDER_FAILED') return row;
      const sourceCandidate = candidatesByIdMap.get(row.candidateId);
      assert.ok(sourceCandidate, `failed render lost its source candidate: ${row.candidateId}`);
      return {
        ...makeSkippedResult(sourceCandidate),
        status: 'RENDER_FAILED',
        error: row.error ?? 'unknown candidate render failure',
      };
    });
    const controls = await runSyntheticControls(rasterizer, outputDirectory, batchRows);
    const finalized = core.finalizeBatchResults([...completeBatchRows, ...preclassifiedRows]);
    const previewLayout = core.buildContactSheetLayout(finalized.previewTiles);
    const contactSheetSvg = core.buildContactSheetSvg(previewLayout, finalized.previewTiles);
    secureSvg(contactSheetSvg);
    const sheetRaster = await rasterizer.render(contactSheetSvg, previewLayout.width, previewLayout.height);
    const contactSheetSvgBytes = Buffer.from(contactSheetSvg, 'utf8');
    const contactSheetPngBytes = Buffer.from(sheetRaster.pngBytes);
    const contactSheetSvgFile = path.join(outputDirectory, 'contact-sheet.svg');
    const contactSheetPngFile = path.join(outputDirectory, 'contact-sheet.png');
    await writeVerified(contactSheetSvgFile, contactSheetSvgBytes);
    await writeVerified(contactSheetPngFile, contactSheetPngBytes);

    const sourceSha256After = await sha256File(originalSourcePath);
    const archiveSha256After = HASH(await fs.promises.readFile(args.archive));
    assert.equal(sourceSha256After, sourceSha256Before, 'source FLA changed during B3 processing');
    assert.equal(archiveSha256After, normalizedArchiveSha256, 'normalized archive changed during B3 processing');
    assert.deepEqual(rasterizer.security, { sandbox: true, contextIsolation: true, nodeIntegration: false },
      'production snapshot renderer isolation changed');

    const resultRows = finalized.results.sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0);
    const statusCounts = {};
    for (const row of resultRows) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    const b2EvidenceComparison = resultRows.filter((row) => row.priorB2EvidenceComparison).map((row) => ({
      candidateId: row.candidateId,
      ...row.priorB2EvidenceComparison,
    }));
    const contactSheetTiles = previewLayout.tiles.map((tile) => ({ ...tile }));
    const manifestOutput = {
      schemaVersion: PIPELINE_VERSION,
      issue: 705,
      motherPullRequest: 677,
      input: {
        issue: 704,
        b2ManifestSchemaVersion: manifest.schemaVersion,
        b2ManifestSha256: manifestSha256,
        b2ManifestHashNormalization: 'CRLF pairs are normalized to LF before hashing; all other input bytes remain significant.',
        sourceFileName: manifest.source.fileName,
        sourceSha256Before: sourceSha256Before,
        sourceSha256After,
        sourceUnchanged: sourceSha256Before === sourceSha256After,
        normalizedArchiveSha256: normalizedArchiveSha256,
      },
      dispatchPolicy: {
        eligibleClasses: ['PARENT_COMPOSITE', 'DIRECT_FULL_CHARACTER_STATE', 'DIRECT_COMPONENT_STATE'],
        parentCompositeBoundary: 'Issue #703 default-loop, omitted firstFrame/lastFrame, start-zero, no-wrap slice only.',
        directFullCharacterBypassesParent: true,
        componentStatesRemainComponents: true,
        temporalOnlyPromotion: false,
        candidateOrdering: 'Ascending B2 candidate ID; filesystem order is not used.',
      },
      summary: {
        inputCandidateCount: resultRows.length,
        supportedStaticCandidates: renderableCandidates.length,
        svgSuccessCount: resultRows.filter((row) => row.output?.svg).length,
        pngSuccessCount: resultRows.filter((row) => row.output?.png).length,
        blankCount: statusCounts.BLANK ?? 0,
        renderFailureCount: statusCounts.RENDER_FAILED ?? 0,
        unsupportedCount: statusCounts.UNSUPPORTED ?? 0,
        temporalSkippedCount: statusCounts.SKIPPED_BY_CLASS ?? 0,
        exactDuplicateGroupCount: finalized.duplicateGroups.length,
        exactDuplicateMemberCount: finalized.duplicateGroups.reduce((sum, group) => sum + group.memberCandidateIds.length, 0),
        uniquePreviewRepresentativeCount: finalized.previewTiles.length,
        componentPreviewCount: finalized.previewTiles.filter((tile) => tile.section === 'COMPONENT_ASSETS').length,
        fullCharacterPreviewCount: finalized.previewTiles.filter((tile) => tile.section === 'FULL_CHARACTER_ASSETS').length,
        statusCounts,
      },
      candidates: resultRows.map(serializableCandidate),
      duplicateGroups: finalized.duplicateGroups,
      testControls: controls,
      rejectedParentRoutesExcludedFromPreview: manifest.parentRouteProbes
        .filter((probe) => probe.status === 'REJECTED_NON_PREFERRED')
        .map((probe) => ({ parentFrame: probe.parentFrame, status: probe.status, reasonCode: probe.reasonCode, previewIncluded: false })),
      unsupportedParentTimingProbes: manifest.parentRouteProbes
        .filter((probe) => probe.status === 'FAIL_CLOSED')
        .map((probe) => ({ parentFrame: probe.parentFrame, status: probe.status, reasonCode: probe.reasonCode, previewIncluded: false })),
      b2OutputHashComparison: b2EvidenceComparison,
      contactSheet: {
        svg: { path: 'contact-sheet.svg', sha256: HASH(contactSheetSvgBytes), byteLength: contactSheetSvgBytes.length },
        png: { path: 'contact-sheet.png', sha256: HASH(contactSheetPngBytes), byteLength: contactSheetPngBytes.length, width: sheetRaster.width, height: sheetRaster.height },
        tileCount: contactSheetTiles.length,
        tileOrder: contactSheetTiles.map((tile) => tile.candidateId),
        sections: previewLayout.sections,
        presentationLayoutOnly: true,
        tiles: contactSheetTiles,
      },
      verification: {
        sandbox: rasterizer.security.sandbox,
        contextIsolation: rasterizer.security.contextIsolation,
        nodeIntegration: rasterizer.security.nodeIntegration,
        externalSvgReferences: false,
        sourceMutation: false,
        productUiChanged: false,
        projectSchemaChanged: false,
        aiOrPerceptualDedupe: false,
      },
      notes: [
        'Individual SVG/PNG outputs are canonical. Visible-bounds cropping and scaling exist only in contact-sheet presentationLayout.',
        'Duplicate membership is based on exact B3 PNG SHA-256. All source candidate records and provenance remain in candidates and duplicateGroups.',
        'Synthetic blank, exact-duplicate, and per-candidate-failure controls are not Black source candidates and are excluded from contactSheet.tiles.',
      ],
    };
    const manifestJson = `${JSON.stringify(manifestOutput, null, 2)}\n`;
    const manifestFile = path.join(outputDirectory, 'batch-manifest.json');
    await writeVerified(manifestFile, Buffer.from(manifestJson, 'utf8'));
    const receipt = {
      schemaVersion: 'issue705-black-asset-batch-receipt/1',
      issue: 705,
      motherPullRequest: 677,
      inputManifestSha256: manifestSha256,
      outputManifest: { path: 'batch-manifest.json', sha256: HASH(Buffer.from(manifestJson, 'utf8')) },
      summary: manifestOutput.summary,
      sourceSha256Before: sourceSha256Before,
      sourceSha256After,
      sourceMutation: false,
      contactSheet: manifestOutput.contactSheet,
      batchManifestSha256: HASH(Buffer.from(manifestJson, 'utf8')),
      statusCounts,
    };
    const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeVerified(path.join(outputDirectory, 'receipt.json'), Buffer.from(receiptJson, 'utf8'));
    process.stdout.write(`${JSON.stringify({
      issue: 705,
      inputCandidateCount: resultRows.length,
      supportedStaticCandidates: renderableCandidates.length,
      statusCounts,
      duplicateGroupCount: finalized.duplicateGroups.length,
      previewTileCount: contactSheetTiles.length,
      batchManifestSha256: receipt.batchManifestSha256,
      contactSheetPngSha256: manifestOutput.contactSheet.png.sha256,
      outputDirectory,
    })}\n`);
  } finally {
    rasterizer.close();
  }
}

app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  }
});
