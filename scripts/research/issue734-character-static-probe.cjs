#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_REVIEW_TILES = 16;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--fixture-id') args.fixtureId = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'out', 'fixtureId']) assert.ok(args[name], `missing --${name}`);
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #734 evidence must remain outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite existing evidence directory: ${directory}`);
}

function writeVerified(filePath, bytes) {
  const value = Buffer.from(bytes);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { flag: 'wx' });
  const written = fs.readFileSync(filePath);
  assert.equal(HASH(written), HASH(value), `artifact write verification failed: ${filePath}`);
  return { path: filePath, sha256: HASH(written), byteLength: written.length };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
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
  throw new Error('Panda Stage static snapshot APIs did not become ready');
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

function visitSymbols(elements, output = []) {
  for (const element of elements ?? []) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') visitSymbols(element.elements, output);
  }
  return output;
}

function countElements(elements) {
  const counts = { shape: 0, bitmap: 0, symbol: 0, group: 0 };
  for (const element of elements ?? []) {
    if (element.visible === false) continue;
    if (element.kind === 'group') {
      counts.group += 1;
      const nested = countElements(element.elements);
      for (const [key, value] of Object.entries(nested)) counts[key] += value;
    } else if (Object.hasOwn(counts, element.kind)) counts[element.kind] += 1;
  }
  return counts;
}

function frameFacts(source, owner, frameIndex, ownerKind) {
  if (ownerKind === 'scene') {
    const elements = owner.frameContext.layers.filter((layer) => layer.visible).flatMap((layer) => layer.elements);
    return { frameIndex: 0, layers: owner.frameContext.layers.length, ...countElements(elements) };
  }
  const context = owner.frameSpanIndex
    ? source.buildGraphicFrameContext(owner.timelineXml, owner.frameSpanIndex, frameIndex, `issue734:${owner.sourceLibraryItemName}:${frameIndex}`)
    : { ok: true, value: owner.frameContext };
  if (!context?.ok) return { frameIndex, contextFailure: context?.message ?? 'frame context unavailable' };
  const elements = context.value.layers.filter((layer) => layer.visible).flatMap((layer) => layer.elements);
  return { frameIndex, layers: context.value.layers.length, ...countElements(elements) };
}

function authoredStarts(owner, helper) {
  if (!owner.frameSpanIndex) return [0];
  const starts = helper.enumerateVisibleAuthoredStarts(owner.frameSpanIndex).map((entry) => entry.frameIndex);
  return starts.length > 0 ? [...new Set(starts)].sort((left, right) => left - right) : [0];
}

function collectCandidateOwners(source, catalogEntries, helper) {
  const catalogByName = new Map(catalogEntries
    .filter((entry) => entry.target.kind === 'graphic-symbol')
    .map((entry) => [entry.target.sourceLibraryItemName, entry]));
  const symbolByName = new Map(source.graphicSymbols.map((symbol) => [symbol.sourceLibraryItemName, symbol]));
  const owners = new Map();
  const roots = [];
  const nearRoot = new Map();

  const addOwner = (ownerKind, owner, depth, rootName, discoveredThrough) => {
    const name = ownerKind === 'scene' ? `scene:${owner.index}:${owner.name}` : owner.sourceLibraryItemName;
    const key = `${ownerKind}\u0000${name}`;
    const existing = owners.get(key);
    if (existing) {
      existing.depth = Math.min(existing.depth, depth);
      if (!existing.discoveredThrough.includes(discoveredThrough)) existing.discoveredThrough.push(discoveredThrough);
      if (rootName && !existing.rootNames.includes(rootName)) existing.rootNames.push(rootName);
      return existing;
    }
    const entry = ownerKind === 'scene'
      ? catalogEntries.find((candidate) => candidate.target.kind === 'scene' && candidate.target.sourceTimelineIndex === owner.index)
      : catalogByName.get(owner.sourceLibraryItemName);
    const candidateOwner = {
      ownerKind,
      name,
      sourceLibraryItemName: ownerKind === 'graphic-symbol' ? owner.sourceLibraryItemName : null,
      userLabel: entry?.target.userLabel ?? name,
      target: entry?.target ?? null,
      catalogPreviewSupported: entry?.previewSupported ?? false,
      catalogUnsupportedReason: entry?.unsupportedReason ?? null,
      catalogExposed: Boolean(entry),
      depth,
      rootNames: rootName ? [rootName] : [],
      discoveredThrough: [discoveredThrough],
      frameCount: ownerKind === 'scene' ? owner.frameCount : owner.frameCount,
      authoredFrameIndexes: ownerKind === 'scene' ? [0] : authoredStarts(owner, helper),
      owner,
      compositionEvidence: null,
    };
    owners.set(key, candidateOwner);
    return candidateOwner;
  };

  for (const scene of source.sceneTimelines) {
    addOwner('scene', scene, 0, null, 'Scene frame 0');
    const rootSymbols = visitSymbols(scene.frameContext.layers.filter((layer) => layer.visible).flatMap((layer) => layer.elements));
    for (const [rootIndex, reference] of rootSymbols.entries()) {
      const rootName = reference.libraryItemName;
      const rootRecord = {
        sceneIndex: scene.index,
        rootIndex,
        libraryItemName: rootName,
        symbolType: reference.symbolType,
        sourceAddress: reference.sourceAddress ?? null,
        catalogExposed: catalogByName.has(rootName),
        renderTargetId: catalogByName.get(rootName)?.target.renderTargetId ?? null,
        status: catalogByName.has(rootName) ? 'CATALOG_TARGET_AVAILABLE' : 'NO_CATALOG_TARGET',
      };
      roots.push(rootRecord);
      const owner = symbolByName.get(rootName);
      if (reference.symbolType !== 'graphic' || !owner) continue;
      const rootCandidateOwner = addOwner('graphic-symbol', owner, 0, rootName, 'visible Scene frame-0 root Graphic');
      rootCandidateOwner.compositionEvidence = frameFacts(source, owner, 0, 'graphic-symbol');
      for (const frameIndex of rootCandidateOwner.authoredFrameIndexes) {
        const context = owner.frameSpanIndex
          ? source.buildGraphicFrameContext(owner.timelineXml, owner.frameSpanIndex, frameIndex, `issue734:near-root:${owner.sourceLibraryItemName}:${frameIndex}`)
          : { ok: true, value: owner.frameContext };
        if (!context?.ok) continue;
        const childSymbols = visitSymbols(context.value.layers.filter((layer) => layer.visible).flatMap((layer) => layer.elements));
        for (const childReference of childSymbols) {
          if (childReference.symbolType !== 'graphic') continue;
          const childOwner = symbolByName.get(childReference.libraryItemName);
          if (!childOwner) continue;
          const childKey = childOwner.sourceLibraryItemName;
          const facts = frameFacts(source, childOwner, 0, 'graphic-symbol');
          const visiblePrimitiveCount = (facts.shape ?? 0) + (facts.bitmap ?? 0);
          const isCompositionCandidate = (facts.symbol ?? 0) > 0 || visiblePrimitiveCount >= 4;
          const current = nearRoot.get(childKey) ?? {
            owner: childOwner,
            rootNames: new Set(),
            paths: new Set(),
            compositionEvidence: facts,
            eligible: isCompositionCandidate,
          };
          current.rootNames.add(rootName);
          current.paths.add(`${rootName}@${frameIndex} -> ${childReference.libraryItemName}`);
          current.eligible ||= isCompositionCandidate;
          nearRoot.set(childKey, current);
        }
      }
    }
  }

  for (const found of nearRoot.values()) {
    if (!found.eligible) continue;
    const owner = addOwner('graphic-symbol', found.owner, 1, [...found.rootNames][0] ?? null, 'near-root nested Graphic composition');
    for (const rootName of found.rootNames) if (!owner.rootNames.includes(rootName)) owner.rootNames.push(rootName);
    owner.discoveredThrough = [...new Set([...owner.discoveredThrough, ...found.paths])];
    owner.compositionEvidence ??= found.compositionEvidence;
  }

  const sceneCandidates = [...owners.values()].filter((owner) => owner.ownerKind === 'scene');
  const graphicCandidates = [...owners.values()].filter((owner) => owner.ownerKind === 'graphic-symbol');
  const ordered = [...sceneCandidates, ...graphicCandidates].sort((left, right) =>
    left.depth - right.depth || left.name.localeCompare(right.name, 'en'));
  const omittedNearRootFragments = [...nearRoot.entries()]
    .filter(([, value]) => !value.eligible)
    .map(([name, value]) => ({
      sourceLibraryItemName: name,
      rootNames: [...value.rootNames].sort((left, right) => left.localeCompare(right, 'en')),
      compositionEvidence: value.compositionEvidence,
      reason: 'leaf-like near-root symbol with fewer than four visible vector/bitmap primitives and no nested Graphic; retained in source graph, omitted from prioritized preview sheet',
    }))
    .sort((left, right) => left.sourceLibraryItemName.localeCompare(right.sourceLibraryItemName, 'en'));

  return {
    roots,
    owners: ordered,
    omittedNearRootFragments,
  };
}

function inspectionExpression() {
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

async function preview(window, sessionId, target) {
  const request = {
    format: 'fla-static-snapshot-preview',
    version: 1,
    requestId: crypto.randomUUID(),
    sessionId,
    target,
  };
  return window.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.staticSnapshotPreview(${JSON.stringify(request)});
      if (!response.ok) return { ok: false, error: response.error };
      return {
        ok: true,
        requestId: response.requestId,
        targetRenderTargetId: response.targetRenderTargetId,
        targetSelectedFrameIndex: response.targetSelectedFrameIndex,
        width: response.width,
        height: response.height,
        pixelCount: response.pixelCount,
        sha256: response.sha256,
        wallClockMs: response.wallClockMs,
        isFirstPreviewForSession: response.isFirstPreviewForSession,
        bytes: Array.from(response.bytes),
      };
    })()
  `, true);
}

function createSandboxRasterizer() {
  const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
  const { FlaStaticSnapshotWindowManager } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'));
  const manager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    {
      create(options) {
        assert.equal(options.webPreferences?.sandbox, true, 'review sheet rasterizer must keep sandbox enabled');
        assert.equal(options.webPreferences?.contextIsolation, true, 'review sheet rasterizer must keep context isolation enabled');
        assert.equal(options.webPreferences?.nodeIntegration, false, 'review sheet rasterizer must keep Node integration disabled');
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

function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function reviewSheetSvg(tiles, pageIndex, pageCount) {
  const columns = 4;
  const tileWidth = 420;
  const tileHeight = 340;
  const margin = 24;
  const gap = 16;
  const width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
  const rows = Math.ceil(tiles.length / columns);
  const header = 56;
  const height = header + margin + rows * tileHeight + Math.max(0, rows - 1) * gap + margin;
  const images = tiles.map((tile, index) => {
    const x = margin + (index % columns) * (tileWidth + gap);
    const y = header + margin + Math.floor(index / columns) * (tileHeight + gap);
    const base64 = Buffer.from(tile.bytes).toString('base64');
    return `<g><rect x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" rx="8" fill="#ffffff" stroke="#d0d7de"/><text x="${x + 10}" y="${y + 22}" font-family="Segoe UI, Arial" font-size="13" fill="#24292f">${escapeXml(tile.label.slice(0, 60))}</text><image x="${x + 8}" y="${y + 32}" width="${tileWidth - 16}" height="${tileHeight - 42}" href="data:image/png;base64,${base64}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }).join('');
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f8fa"/><text x="${margin}" y="36" font-family="Segoe UI, Arial" font-size="20" font-weight="600" fill="#24292f">Issue #734 character candidates — page ${pageIndex + 1}/${pageCount}</text>${images}</svg>`,
  };
}

async function readSourceAndNormalize(sourcePath, expectedSha256) {
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceSha256Before = HASH(sourceBytes);
  assert.equal(sourceSha256Before, expectedSha256.toLowerCase(), 'source bytes differ from frozen Issue #732 corpus SHA-256');
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
  return { sourceBytes, sourceSha256Before, normalizedBytes, normalization, classification };
}

async function run(args) {
  assertExternalDirectory(args.out);
  fs.mkdirSync(args.out, { recursive: false });
  const file = await readSourceAndNormalize(args.source, args.expectedSha256);
  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = args.source;
  fs.mkdirSync(path.join(args.out, 'electron-user-data'), { recursive: true });
  app.setPath('userData', path.join(args.out, 'electron-user-data'));
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  const mainWindow = await waitForMainWindow();
  const inspected = await mainWindow.webContents.executeJavaScript(inspectionExpression(), true);
  assert.ok(inspected?.ok, `production inspection/catalog failed: ${JSON.stringify(inspected)}`);
  assert.equal(inspected.source.basename, path.basename(args.source), 'production inspector opened a different FLA');
  assert.equal(inspected.trace?.originalSourceSha256, file.sourceSha256Before, 'Main trace source SHA-256 differs from source bytes');
  assert.equal(inspected.trace?.parserResult, 'success', 'production parser did not complete');
  assert.equal(inspected.source.sha256, HASH(file.normalizedBytes), 'production parser inspected unexpected normalized bytes');

  const source = await readAdaptedSource(file.normalizedBytes);
  const helper = require('./issue706-cross-corpus-core.cjs');
  const discovery = collectCandidateOwners(source, inspected.catalog, helper);
  const { buildSvgForRenderTarget } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const { createFlaStaticSnapshotBitmapMediaLookup } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'));
  const media = inspected.media.map((item) => ({ ...item, payload: { bytes: Uint8Array.from(item.payload.bytes) } }));
  const resolveBitmapMedia = createFlaStaticSnapshotBitmapMediaLookup(media);
  const rasterizer = createSandboxRasterizer();
  const outputs = [];
  const reviewTiles = [];
  const reviewArtifacts = [];
  const outputRoot = path.join(args.out, 'renders');
  fs.mkdirSync(outputRoot, { recursive: true });

  try {
    for (const owner of discovery.owners) {
      const starts = owner.authoredFrameIndexes;
      for (const frameIndex of starts) {
        const candidateId = `C734-${HASH(Buffer.from(`${file.sourceSha256Before}\u0000${owner.ownerKind}\u0000${owner.name}\u0000${frameIndex}`)).slice(0, 24).toUpperCase()}`;
        const catalogTarget = owner.target;
        const record = {
          candidateId,
          sourceAddress: {
            ownerKind: owner.ownerKind,
            ownerName: owner.name,
            sourceLibraryItemName: owner.sourceLibraryItemName,
            frameIndex,
            depthFromScene: owner.depth,
            rootNames: owner.rootNames,
            discoveredThrough: owner.discoveredThrough,
            authoredFrameIndexes: starts,
          },
          productIdentity: {
            catalogExposed: owner.catalogExposed,
            renderTargetId: catalogTarget?.renderTargetId ?? null,
            userLabel: owner.userLabel,
            previewSupported: owner.catalogPreviewSupported,
            unsupportedReason: owner.catalogUnsupportedReason,
          },
          sourceFrameFacts: frameFacts(source, owner.owner, frameIndex, owner.ownerKind),
          composition: null,
          renderer: { status: 'NOT_ATTEMPTED', firstBlocker: null },
          artifacts: { svg: null, png: null },
          deterministicRepeat: { status: 'PENDING_SELECTED_CANDIDATE' },
          visualAssessment: 'REVIEW_PENDING',
        };
        if (!catalogTarget) {
          record.renderer = { status: 'CATALOG_IDENTITY_GAP', firstBlocker: 'No production catalog target is exposed for this authored source identity; no target was forged.' };
          outputs.push(record);
          continue;
        }
        if (frameIndex >= catalogTarget.frameCount) {
          record.renderer = { status: 'BLOCKED', firstBlocker: `Authored frame ${frameIndex} is outside catalog frameCount ${catalogTarget.frameCount}.` };
          outputs.push(record);
          continue;
        }
        const target = { ...catalogTarget, selectedFrameIndex: frameIndex };
        if (!owner.catalogPreviewSupported) {
          record.renderer = { status: 'BLOCKED', firstBlocker: owner.catalogUnsupportedReason ?? 'Catalog marks this target as preview unsupported.' };
          outputs.push(record);
          continue;
        }
        let response;
        try {
          response = await preview(mainWindow, inspected.sessionId, target);
        } catch (error) {
          record.renderer = {
            status: 'RENDER_FAILED',
            firstBlocker: { code: 'PRELOAD_OR_IPC_EXCEPTION', message: error instanceof Error ? error.message : String(error) },
          };
          outputs.push(record);
          continue;
        }
        if (!response?.ok) {
          record.renderer = { status: 'BLOCKED', firstBlocker: response?.error ?? { code: 'UNKNOWN_PREVIEW_ERROR', message: 'No preview response returned' } };
          outputs.push(record);
          continue;
        }
        assert.equal(response.targetRenderTargetId, target.renderTargetId, 'preview returned a different render-target identity');
        assert.equal(response.targetSelectedFrameIndex, frameIndex, 'preview returned a different selected authored frame');
        const pngBytes = Buffer.from(response.bytes);
        const pngPath = path.join(outputRoot, `${candidateId}.png`);
        const png = writeVerified(pngPath, pngBytes);
        assert.equal(HASH(pngBytes), response.sha256, 'production preview PNG bytes differ from the reported preview hash');
        record.artifacts.png = {
          path: path.relative(args.out, pngPath),
          sha256: png.sha256,
          byteLength: png.byteLength,
          width: response.width,
          height: response.height,
        };
        record.renderer = {
          status: 'RENDERED',
          targetSelectedFrameIndex: response.targetSelectedFrameIndex,
          targetRenderTargetId: response.targetRenderTargetId,
          wallClockMs: response.wallClockMs,
          isFirstPreviewForSession: response.isFirstPreviewForSession,
          pngSha256: response.sha256,
        };
        try {
          const svgResult = await buildSvgForRenderTarget(file.normalizedBytes, target, resolveBitmapMedia);
          if (svgResult.ok) {
            const svgPath = path.join(outputRoot, `${candidateId}.svg`);
            const svg = writeVerified(svgPath, Buffer.from(svgResult.svg, 'utf8'));
            record.artifacts.svg = {
              path: path.relative(args.out, svgPath),
              sha256: svg.sha256,
              byteLength: svg.byteLength,
              width: svgResult.width,
              height: svgResult.height,
            };
            record.composition = svgResult.composition;
          } else {
            record.renderer.svgBuildFailure = { code: svgResult.code, message: svgResult.message };
          }
        } catch (error) {
          record.renderer.svgBuildException = error instanceof Error ? error.message : String(error);
        }
        if (owner.ownerKind === 'scene' || owner.depth === 0 || (owner.depth === 1 && (owner.compositionEvidence?.symbol ?? 0) > 0)) {
          reviewTiles.push({
            candidateId,
            label: `${owner.ownerKind === 'scene' ? 'SCENE' : owner.depth === 0 ? 'ROOT' : 'NEAR-ROOT'} ${owner.name}@${frameIndex}`,
            bytes: pngBytes,
            priority: owner.ownerKind === 'scene' ? 0 : owner.depth,
            nestedCount: record.composition?.expandedSymbolCount ?? owner.compositionEvidence?.symbol ?? 0,
            shapeCount: record.composition?.shapeCount ?? owner.compositionEvidence?.shape ?? 0,
            frameIndex,
          });
        }
        outputs.push(record);
      }
      process.stdout.write(`${args.fixtureId}: ${owner.name} depth=${owner.depth} authored=${starts.length} rendered=${outputs.filter((record) => record.sourceAddress.ownerName === owner.name && record.renderer.status === 'RENDERED').length}\n`);
    }

    reviewTiles.sort((left, right) => left.priority - right.priority || right.nestedCount - left.nestedCount || right.shapeCount - left.shapeCount || left.frameIndex - right.frameIndex || left.candidateId.localeCompare(right.candidateId, 'en'));
    const pageCount = Math.max(1, Math.ceil(reviewTiles.length / MAX_REVIEW_TILES));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const tiles = reviewTiles.slice(pageIndex * MAX_REVIEW_TILES, (pageIndex + 1) * MAX_REVIEW_TILES);
      if (tiles.length === 0) continue;
      const sheet = reviewSheetSvg(tiles, pageIndex, pageCount);
      const svgPath = path.join(args.out, `review-sheet-${String(pageIndex + 1).padStart(2, '0')}.svg`);
      const pngPath = path.join(args.out, `review-sheet-${String(pageIndex + 1).padStart(2, '0')}.png`);
      const svgArtifact = writeVerified(svgPath, Buffer.from(sheet.svg, 'utf8'));
      const raster = await rasterizer.render(sheet.svg, sheet.width, sheet.height);
      const pngArtifact = writeVerified(pngPath, raster.pngBytes);
      reviewArtifacts.push({
        svg: { path: path.relative(args.out, svgPath), sha256: svgArtifact.sha256, byteLength: svgArtifact.byteLength },
        png: { path: path.relative(args.out, pngPath), sha256: pngArtifact.sha256, byteLength: pngArtifact.byteLength, width: raster.width, height: raster.height },
        candidateIds: tiles.map((tile) => tile.candidateId),
        selection: 'Scene, root Graphic, and nested near-root compositions only; leaf-like fragments excluded from the prioritized sheet.',
      });
    }
  } finally {
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(inspected.sessionId)} })`, true).catch(() => {});
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true).catch(() => {});
    rasterizer.close();
  }

  const sourceSha256After = HASH(fs.readFileSync(args.source));
  assert.equal(sourceSha256After, file.sourceSha256Before, 'source FLA changed during static character probe');
  const receipt = {
    schemaVersion: 'issue734-character-static-probe/1',
    issue: 734,
    baseline: '93fe7fac21c6c0872eb92efba079c81abf611116',
    fixtureId: args.fixtureId,
    source: {
      basename: path.basename(args.source),
      originalSha256Before: file.sourceSha256Before,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: sourceSha256After === file.sourceSha256Before,
      normalizedSha256: inspected.source.sha256,
      normalization: file.normalization,
      recoveryTrace: inspected.trace,
    },
    productionInspection: {
      parserResult: inspected.trace?.parserResult ?? 'unreported',
      document: inspected.document,
      structure: inspected.structure,
      summary: inspected.summary,
      compatibility: inspected.compatibility,
      catalogTargetCount: inspected.catalog.length,
      catalogEntries: inspected.catalog.map((entry) => ({
        target: entry.target,
        previewSupported: entry.previewSupported,
        unsupportedReason: entry.unsupportedReason ?? null,
      })),
    },
    sourceComposition: {
      method: 'production XFL display-list adapter; visible Scene frame-0 references; recursively inspected authored starts of direct Scene root Graphics for near-root candidates',
      sceneRoots: discovery.roots,
      candidateOwnerCount: discovery.owners.length,
      omittedNearRootFragments: discovery.omittedNearRootFragments,
    },
    candidates: outputs,
    reviewArtifacts,
    projectMutation: 'NONE: chooseAndInspect, staticSnapshotCatalog, staticSnapshotPreview, staticSnapshotCancel, cancel only; no commit API called',
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'static-truth-probe.json'), receipt);
  process.stdout.write(`${JSON.stringify({ fixtureId: args.fixtureId, source: path.basename(args.source), candidateCount: outputs.length, renderedCount: outputs.filter((item) => item.renderer.status === 'RENDERED').length, reviewArtifacts, evidenceDirectory: args.out })}\n`);
}

app.on('window-all-closed', () => {});
const args = parseArgs(process.argv.slice(1));
run(args)
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });
