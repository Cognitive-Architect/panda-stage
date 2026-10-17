#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_SEQUENCE_FRAMES = require(path.join(ROOT, 'dist-electron/shared/fla-frame-sequence-api.js'))
  .FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES;

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
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Issue #732 temporal evidence must remain outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite existing evidence directory: ${directory}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function writeVerified(filePath, bytes) {
  const value = Buffer.from(bytes);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { flag: 'wx' });
  const written = fs.readFileSync(filePath);
  assert.equal(HASH(written), HASH(value), `artifact write verification failed: ${filePath}`);
  return { path: path.relative(path.dirname(filePath), filePath), sha256: HASH(written), byteLength: written.length };
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
          'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog && window.pandaStage?.fla?.frameSequenceRender)',
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

function temporalFactsForTarget(source, target) {
  if (target.kind !== 'graphic-symbol') {
    return { frameSpanIndexAvailable: false, authoredStartIndexes: [], tweenSpans: [], heldSpanCount: 0 };
  }
  const owner = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === target.sourceLibraryItemName);
  if (!owner?.frameSpanIndex) {
    return { frameSpanIndexAvailable: false, authoredStartIndexes: [], tweenSpans: [], heldSpanCount: 0 };
  }
  const { enumerateVisibleAuthoredStarts } = require('./issue706-cross-corpus-core.cjs');
  const authoredStarts = enumerateVisibleAuthoredStarts(owner.frameSpanIndex);
  const spans = owner.frameSpanIndex.layers
    .filter((layer) => layer.visible)
    .flatMap((layer) => layer.spans.map((span) => ({
      layerIndex: layer.index,
      start: span.index,
      endExclusive: span.endExclusive,
      duration: span.duration,
      tweenType: span.tweenType,
    })));
  return {
    frameSpanIndexAvailable: true,
    authoredStartIndexes: authoredStarts.map((entry) => entry.frameIndex),
    tweenSpans: spans.filter((span) => span.tweenType !== 'none'),
    heldSpanCount: spans.filter((span) => span.tweenType === 'none' && span.duration > 1).length,
    spans,
  };
}

function classifyRenderedFrame(frameIndex, frameFacts) {
  if (frameFacts.authoredStartIndexes.includes(frameIndex)) return 'AUTHORED';
  if (frameFacts.tweenSpans.some((span) => frameIndex >= span.start && frameIndex < span.endExclusive)) return 'TWEEN_RECONSTRUCTED';
  if (frameFacts.spans?.some((span) => frameIndex >= span.start && frameIndex < span.endExclusive)) return 'HELD';
  return 'BLOCKED';
}

function createReviewClip(timelineDirectory, frameCount, sourceFrameRate) {
  const outputPath = path.join(timelineDirectory, 'review.mp4');
  const inputPattern = path.join(timelineDirectory, 'frame-%06d.png');
  const ffmpegPath = process.env.PANDA_STAGE_FFMPEG_PATH || 'ffmpeg.exe';
  const fps = Number(sourceFrameRate);
  assert.ok(Number.isFinite(fps) && fps > 0, `source frame rate is invalid: ${sourceFrameRate}`);
  const command = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-framerate', String(fps), '-start_number', '0', '-i', inputPattern,
    '-map', '0:v:0', '-frames:v', String(frameCount), '-an',
    '-vf', 'scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '1', '-bf', '0',
    '-g', String(frameCount), '-movflags', '+faststart', '-map_metadata', '-1',
    '-metadata', 'creation_time=1970-01-01T00:00:00Z', outputPath,
  ], { cwd: timelineDirectory, encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
  if (command.error || command.status !== 0) {
    return {
      status: 'UNAVAILABLE',
      reason: command.error?.message ?? String(command.stderr || command.stdout || `ffmpeg exited ${command.status}`),
    };
  }
  const verify = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', outputPath, '-f', 'null', '-',
  ], { cwd: timelineDirectory, encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
  if (verify.error || verify.status !== 0) {
    return {
      status: 'DECODE_FAILED',
      reason: verify.error?.message ?? String(verify.stderr || verify.stdout || `ffmpeg verification exited ${verify.status}`),
    };
  }
  const bytes = fs.readFileSync(outputPath);
  return {
    status: 'PRODUCED',
    path: path.basename(outputPath),
    sha256: HASH(bytes),
    byteLength: bytes.length,
    frameCount,
    sourceFrameRate: fps,
    durationSeconds: frameCount / fps,
    decodedByFfmpeg: true,
    presentation: '640x640 contain + white pad for review only; source frames remain unchanged',
  };
}

async function inspect(window) {
  const result = await window.webContents.executeJavaScript(`
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
        compatibility: response.ir.compatibility,
        summary: response.ir.summary,
        trace: response.trace ?? null,
        catalog: catalog.entries,
      };
    })()
  `, true);
  assert.ok(result?.ok, `production inspection/catalog failed: ${JSON.stringify(result)}`);
  return result;
}

async function renderSequenceRange(window, sessionId, target, startFrameIndex, endFrameIndex) {
  const request = {
    format: 'fla-frame-sequence-render',
    version: 1,
    requestId: crypto.randomUUID(),
    sessionId,
    range: {
      renderTargetId: target.renderTargetId,
      startFrameIndex,
      endFrameIndex,
    },
  };
  return window.webContents.executeJavaScript(`
    (async () => {
      const response = await window.pandaStage.fla.frameSequenceRender(${JSON.stringify(request)});
      if (!response.ok) return response;
      return {
        ok: true,
        requestId: response.requestId,
        renderTargetId: response.renderTargetId,
        sequenceTotalMs: response.sequenceTotalMs,
        cancelledFrames: response.cancelledFrames,
        totalPixelCount: response.totalPixelCount,
        items: response.items.map((item) => ({
          frameIndex: item.frameIndex,
          sequenceOrdinal: item.sequenceOrdinal,
          preview: {
            targetSelectedFrameIndex: item.preview.targetSelectedFrameIndex,
            width: item.preview.width,
            height: item.preview.height,
            pixelCount: item.preview.pixelCount,
            bytes: Array.from(item.preview.bytes),
            sha256: item.preview.sha256,
            wallClockMs: item.preview.wallClockMs,
          },
        })),
      };
    })()
  `, true);
}

async function renderTimeline(window, inspected, source, target, targetIndex, out) {
  const frameCount = target.frameCount;
  const frameFacts = temporalFactsForTarget(source, target);
  const timelineDirectory = path.join(out, 'timelines', String(targetIndex).padStart(2, '0'));
  fs.mkdirSync(timelineDirectory, { recursive: true });
  const frames = [];
  const chunks = [];
  let firstBlocker = null;
  for (let startFrameIndex = 0; startFrameIndex < frameCount; startFrameIndex += MAX_SEQUENCE_FRAMES) {
    const endFrameIndex = Math.min(frameCount - 1, startFrameIndex + MAX_SEQUENCE_FRAMES - 1);
    const response = await renderSequenceRange(window, inspected.sessionId, target, startFrameIndex, endFrameIndex);
    if (!response?.ok) {
      const error = response?.error ?? { code: 'UNKNOWN_SEQUENCE_ERROR', message: 'frameSequenceRender returned no response' };
      const completed = Number(error.completedFrameCount ?? 0);
      const firstBlockedFrameIndex = Math.min(endFrameIndex, startFrameIndex + completed);
      const chunkReceipt = {
        startFrameIndex,
        endFrameIndex,
        status: 'BLOCKED',
        error,
        firstBlockedFrameIndex,
      };
      chunks.push(chunkReceipt);
      firstBlocker ??= { frameIndex: firstBlockedFrameIndex, code: error.code, message: error.message };
      // The production sequence contract discards partial outputs. Stop after the first failed
      // contiguous range so the first blocking point remains the authoritative result.
      break;
    }
    assert.equal(response.items.length, endFrameIndex - startFrameIndex + 1, 'successful product sequence returned a partial range');
    const chunkReceipt = {
      startFrameIndex,
      endFrameIndex,
      status: 'PASS',
      sequenceTotalMs: response.sequenceTotalMs,
      totalPixelCount: response.totalPixelCount,
      requestId: response.requestId,
    };
    chunks.push(chunkReceipt);
    for (const item of response.items) {
      const bytes = Buffer.from(item.preview.bytes);
      const fileName = `frame-${String(item.frameIndex).padStart(6, '0')}.png`;
      const artifact = writeVerified(path.join(timelineDirectory, fileName), bytes);
      const status = classifyRenderedFrame(item.frameIndex, frameFacts);
      frames.push({
        frameIndex: item.frameIndex,
        status,
        artifact: { path: path.join('timelines', String(targetIndex).padStart(2, '0'), fileName), sha256: artifact.sha256, byteLength: artifact.byteLength },
        preview: {
          width: item.preview.width,
          height: item.preview.height,
          pixelCount: item.preview.pixelCount,
          sha256: item.preview.sha256,
          wallClockMs: item.preview.wallClockMs,
        },
      });
    }
  }
  const statusCounts = frames.reduce((counts, frame) => ({ ...counts, [frame.status]: (counts[frame.status] ?? 0) + 1 }), {});
  const resolvedFrameCount = frames.length;
  const complete = resolvedFrameCount === frameCount && !firstBlocker;
  const blockedFrameCount = frameCount - resolvedFrameCount;
  const allStatusCounts = {
    AUTHORED: statusCounts.AUTHORED ?? 0,
    TWEEN_RECONSTRUCTED: statusCounts.TWEEN_RECONSTRUCTED ?? 0,
    HELD: statusCounts.HELD ?? 0,
    BLOCKED: blockedFrameCount,
  };
  const reviewClip = complete
    ? createReviewClip(timelineDirectory, frameCount, inspected.document.frameRate)
    : null;
  const timeline = {
    target,
    sourceFrameCount: frameCount,
    frameSpanFacts: frameFacts,
    requestedFrameCount: frameCount,
    resolvedFrameCount,
    statusCounts: allStatusCounts,
    blockedFrameCount,
    firstBlocker,
    sequenceChunks: chunks,
    complete,
    completeReviewClip: reviewClip,
    frameArtifacts: frames,
  };
  writeJson(path.join(timelineDirectory, 'timeline-receipt.json'), timeline);
  return timeline;
}

async function run(args) {
  assertExternalDirectory(args.out);
  fs.mkdirSync(args.out, { recursive: true });
  const sourceBytes = fs.readFileSync(args.source);
  const sourceSha256Before = HASH(sourceBytes);
  assert.equal(sourceSha256Before, args.expectedSha256.toLowerCase(), 'source hash differs from the frozen #732 manifest');

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

  process.env.VITE_DEV_SERVER_URL = '';
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = args.source;
  fs.mkdirSync(path.join(args.out, 'electron-user-data'), { recursive: true });
  app.setPath('userData', path.join(args.out, 'electron-user-data'));
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  const mainWindow = await waitForMainWindow();
  const inspected = await inspect(mainWindow);
  assert.equal(inspected.source.basename, path.basename(args.source), 'production inspector opened a different file');
  assert.equal(inspected.trace?.originalSourceSha256, sourceSha256Before, 'Main trace source hash differs from original bytes');
  assert.equal(inspected.trace?.parserResult, 'success', 'production parser did not complete');
  assert.equal(inspected.source.sha256, HASH(normalizedBytes), 'production parser did not inspect expected normalized archive bytes');

  const source = await readAdaptedSource(normalizedBytes);
  const entriesByName = new Map(inspected.catalog
    .filter((entry) => entry.target.kind === 'graphic-symbol')
    .map((entry) => [entry.target.sourceLibraryItemName, entry]));
  const roots = [];
  for (const scene of source.sceneTimelines) {
    const symbols = visitSymbols(scene.frameContext.layers.flatMap((layer) => layer.visible ? layer.elements : []));
    for (const symbol of symbols) {
      const catalogEntry = entriesByName.get(symbol.libraryItemName);
      if (!catalogEntry) {
        roots.push({ sceneIndex: scene.index, libraryItemName: symbol.libraryItemName, symbolType: symbol.symbolType, status: 'NO_CATALOG_TARGET' });
        continue;
      }
      roots.push({
        sceneIndex: scene.index,
        libraryItemName: symbol.libraryItemName,
        symbolType: symbol.symbolType,
        target: catalogEntry.target,
        previewSupported: catalogEntry.previewSupported,
        status: catalogEntry.target.frameCount > 1 ? 'TEMPORAL_ROOT' : 'STATIC_ROOT',
      });
    }
  }

  const temporalRootByTargetId = new Map();
  for (const root of roots) {
    if (root.status === 'TEMPORAL_ROOT' && root.previewSupported) {
      temporalRootByTargetId.set(root.target.renderTargetId, root);
    }
  }
  const temporalRoots = [...temporalRootByTargetId.values()];
  const sourceHasTemporalFacts = source.graphicSymbols.some((symbol) => symbol.frameCount > 1 ||
      symbol.frameSpanIndex.layers.some((layer) => layer.visible && layer.spans.some((span) => span.tweenType !== 'none')))
    || source.sceneTimelines.some((scene) => scene.frameCount > 1);
  const timelines = [];
  try {
    for (const [index, root] of temporalRoots.entries()) {
      timelines.push(await renderTimeline(mainWindow, inspected, source, root.target, index + 1, args.out));
    }
  } finally {
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(inspected.sessionId)} })`, true).catch(() => {});
    await mainWindow.webContents.executeJavaScript(`window.pandaStage.fla.cancel(${JSON.stringify(inspected.sessionId)})`, true).catch(() => {});
  }

  const sourceSha256After = HASH(fs.readFileSync(args.source));
  assert.equal(sourceSha256After, sourceSha256Before, 'source FLA changed during temporal product probe');
  const receipt = {
    schemaVersion: 'issue732-temporal-product-probe/1',
    fixtureId: args.fixtureId,
    source: {
      basename: path.basename(args.source),
      originalSha256Before: sourceSha256Before,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: sourceSha256Before === sourceSha256After,
      normalizedSha256: inspected.source.sha256,
      normalization,
      recoveryTrace: inspected.trace,
    },
    productionInspection: {
      parserResult: inspected.trace?.parserResult ?? 'unreported',
      postNormalizationStrictResult: inspected.trace?.postNormalizationStrictResult ?? 'not-run',
      document: inspected.document,
      structure: inspected.structure,
      compatibility: inspected.compatibility,
      catalog: inspected.catalog,
    },
    sceneRootDiscovery: {
      method: 'visible Scene frame-0 Graphic instances from the production XFL display-list adapter matched to the production render-target catalog',
      roots,
      temporalRootInstanceCount: roots.filter((root) => root.status === 'TEMPORAL_ROOT' && root.previewSupported).length,
      temporalRootCount: temporalRoots.length,
      sourceHasTemporalFacts,
    },
    gate5: {
      status: timelines.length === 0
        ? sourceHasTemporalFacts ? 'BLOCKED_NO_TEMPORAL_PRODUCT_ROOT' : 'NOT_APPLICABLE_STATIC'
        : timelines.every((timeline) => timeline.complete) ? 'COMPLETE' : 'PARTIAL_BLOCKED',
      requestedFrameCount: timelines.reduce((sum, timeline) => sum + timeline.requestedFrameCount, 0),
      resolvedFrameCount: timelines.reduce((sum, timeline) => sum + timeline.resolvedFrameCount, 0),
      statusCounts: timelines.reduce((counts, timeline) => {
        for (const [status, count] of Object.entries(timeline.statusCounts)) counts[status] = (counts[status] ?? 0) + count;
        return counts;
      }, {}),
      timelines,
    },
    projectMutation: 'NONE: chooseAndInspect, staticSnapshotCatalog, frameSequenceRender, cancel only; no commit API called',
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'temporal-receipt.json'), receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

app.on('window-all-closed', () => {});
const args = parseArgs(process.argv.slice(1));
run(args)
  .then(() => setTimeout(() => app.exit(0), 300))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });
