#!/usr/bin/env node
'use strict';

/**
 * Issue #721 — Stage B5-L, phase L3 (research-only revalidation of 向右走).
 *
 * Re-runs every requested root frame (F0..F(N-1)) through the SHARED production
 * reconstruction path (dist-electron): buildGraphicFrameContext ->
 * prepareFlaNestedGraphicFrameSelections -> resolveFlaDisplayList, and classifies
 * each frame as AUTHORED | TWEEN_RECONSTRUCTED | HELD | BLOCKED.
 *
 * Read-only: no production behavior change, no source mutation, evidence written
 * outside the repository, refuses to overwrite, deterministic repeat.
 *
 * The root Graphic is discovered from the Scene (never hard-coded): the single
 * visible Scene symbol at frame 0 identifies the root timeline to enumerate.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--expected-sha256') args.expectedSha256 = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--root-symbol') args.rootSymbol = argv[++i];
    else if (argv[i] === '--label') args.label = argv[++i];
  }
  for (const name of ['source', 'expectedSha256', 'out']) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalNewDirectory(directory) {
  const rel = path.relative(ROOT, directory);
  assert.ok(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel),
    'evidence must stay outside the repository');
  assert.ok(!fs.existsSync(directory), 'refusing to overwrite existing evidence directory: ' + directory);
}

function collectVisibleSymbols(elements, acc = []) {
  for (const el of elements) {
    if (el.visible === false) continue;
    if (el.kind === 'symbol') acc.push(el);
    else if (el.kind === 'group') collectVisibleSymbols(el.elements, acc);
  }
  return acc;
}

async function loadSource(sourcePath, expectedSha256) {
  const bytes = await fs.promises.readFile(sourcePath);
  const sha256Before = HASH(bytes);
  assert.equal(sha256Before, expectedSha256, 'source SHA-256 does not match --expected-sha256');
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classifier.classifyForFlaRecovery(bytes));
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((e) => /^LIBRARY\/.*\.xml$/iu.test(e)).sort()) {
    libraries.push({ name, xml: await zip.file(name).async('string') });
  }
  const { adaptFlaXflDisplaySource } =
    require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the normalized archive');
  return { source: adapted.source, sha256Before, classifierState: normalized.classification?.state ?? null, normalized: normalized.applied };
}

function findRootDescriptor(source, explicitName) {
  if (explicitName) {
    const descriptor = source.graphicSymbols.find((s) => s.sourceLibraryItemName === explicitName);
    assert.ok(descriptor, 'requested root symbol not found: ' + explicitName);
    return descriptor;
  }
  const timeline = source.sceneTimelines[0];
  assert.ok(timeline, 'source has no Scene timeline');
  const ctx = source.buildSceneFrameContext(timeline.xml, 0, 'issue721-l3-scene@0');
  assert.equal(ctx.ok, true, ctx.message || 'scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(ctx.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected exactly one visible Scene symbol, found ${symbols.length}`);
  const descriptor = source.graphicSymbols.find((s) => s.sourceLibraryItemName === symbols[0].libraryItemName);
  assert.ok(descriptor, 'Scene root symbol has no Graphic descriptor: ' + symbols[0].libraryItemName);
  return descriptor;
}

function spanAt(layer, frameIndex) {
  return layer.spans.find((span) => frameIndex >= span.index && frameIndex < span.endExclusive) ?? null;
}

/** Frame state derived from the authored span structure (same model as the #713 control). */
function statusForFrame(descriptor, frameIndex) {
  const selections = descriptor.frameSpanIndex.layers
    .filter((layer) => layer.visible)
    .map((layer) => spanAt(layer, frameIndex));
  if (selections.some((span) => !span)) return 'BLOCKED';
  if (selections.some((span) => span.tweenType === 'motion' && frameIndex > span.index)) return 'TWEEN_RECONSTRUCTED';
  if (selections.some((span) => span.index === frameIndex)) return 'AUTHORED';
  return 'HELD';
}

function run(args) {
  assertExternalNewDirectory(args.out);
  return fs.promises.mkdir(args.out, { recursive: true }).then(async () => {
    const loaded = await loadSource(args.source, args.expectedSha256);
    const source = loaded.source;
    const descriptor = findRootDescriptor(source, args.rootSymbol);
    const { prepareFlaNestedGraphicFrameSelections } =
      require(path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'));
    const { resolveFlaDisplayList } =
      require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));

    const buildAndResolve = (frameIndex, requestId) => {
      const built = source.buildGraphicFrameContext(
        descriptor.timelineXml,
        descriptor.frameSpanIndex,
        frameIndex,
        requestId,
      );
      if (!built.ok) return { built, nested: null, resolved: null };
      const nested = prepareFlaNestedGraphicFrameSelections(source, {
        kind: 'graphic',
        name: descriptor.sourceLibraryItemName,
        frameContext: built.value,
      });
      if (!nested.ok) return { built, nested, resolved: null };
      return { built, nested, resolved: resolveFlaDisplayList(nested.resolverInput) };
    };

    const frames = [];
    let firstBlocker = null;
    let deterministic = true;
    for (let frameIndex = 0; frameIndex < descriptor.frameCount; frameIndex += 1) {
      const requestId = `issue721-l3:${descriptor.sourceLibraryItemName}@${frameIndex}`;
      const primary = buildAndResolve(frameIndex, requestId);
      const entry = { frameIndex, status: 'BLOCKED', stage: null, reason: null };

      if (!primary.built.ok) {
        entry.stage = 'ADAPTER';
        entry.reason = primary.built.message;
      } else if (!primary.nested.ok) {
        entry.stage = 'NESTED_SELECTOR';
        entry.reason = primary.nested.message;
        entry.sourceAddress = primary.nested.sourceAddress ?? null;
      } else if (!primary.resolved.ok) {
        entry.stage = 'DISPLAY_LIST';
        entry.reason = primary.resolved.message;
      } else {
        entry.status = statusForFrame(descriptor, frameIndex);
        entry.selections = primary.nested.selections.map((selection) => ({
          sourceAddress: selection.sourceAddress,
          playbackMode: selection.playbackMode,
          firstFrame: selection.firstFrame ?? null,
          childFrameCount: selection.childFrameCount,
          selectedChildFrameIndex: selection.selectedChildFrameIndex,
          selectionRule: selection.selectionRule,
        }));
      }

      // Deterministic repeat: for resolved frames compare selections; for blocked
      // frames compare the exact failure identity so the boundary is stable.
      const repeated = buildAndResolve(frameIndex, requestId);
      const signature = (value) => JSON.stringify({
        built: value.built.ok ? 'ok' : (value.built.message ?? 'fail'),
        nested: value.nested
          ? (value.nested.ok
            ? value.nested.selections.map((s) => [s.sourceAddress, s.selectedChildFrameIndex, s.selectionRule])
            : (value.nested.message ?? 'fail'))
          : null,
        resolved: value.resolved ? (value.resolved.ok ? 'ok' : (value.resolved.message ?? 'fail')) : null,
      });
      const same = signature(primary) === signature(repeated);
      entry.deterministic = same;
      if (!same) deterministic = false;

      if (entry.status === 'BLOCKED' && !firstBlocker) {
        firstBlocker = { frameIndex, stage: entry.stage, reason: entry.reason, sourceAddress: entry.sourceAddress ?? null };
      }
      frames.push(entry);
    }

    const statusCounts = frames.reduce((acc, frame) => {
      acc[frame.status] = (acc[frame.status] ?? 0) + 1;
      return acc;
    }, {});
    const resolvedCount = frames.filter((frame) => frame.status !== 'BLOCKED').length;
    const requestedCount = frames.length;
    const blockedCount = requestedCount - resolvedCount;

    // The #721 target boundary: the previously unsupported "explicit Loop +
    // explicit firstFrame" selector failure. If it no longer appears anywhere, the
    // bounded Loop blocker is cleared even if a deeper boundary immediately follows.
    const targetBlocker = (reason) => /playback mode or bounds are outside the proven boundary \(loop=/iu.test(reason ?? '');
    const targetBlockerFrames = frames
      .filter((frame) => frame.status === 'BLOCKED' && targetBlocker(frame.reason))
      .map((frame) => frame.frameIndex);
    const explicitLoopBlockerCleared = targetBlockerFrames.length === 0;

    let outcome;
    if (blockedCount === 0) outcome = 'LOOP_BLOCKER_CLEARED_FULL';
    else if (explicitLoopBlockerCleared) outcome = 'LOOP_BLOCKER_CLEARED_PARTIAL_ADVANCE';
    else outcome = 'LOOP_BLOCKER_NOT_CLEARED';

    const sourceSha256After = HASH(await fs.promises.readFile(args.source));
    assert.equal(sourceSha256After, loaded.sha256Before, 'source FLA changed during the rerun');

    const report = {
      schemaVersion: 'issue721-l3-walk-right/1',
      issue: 721,
      phase: 'L3',
      label: args.label ?? null,
      generatedNote: 'research-only rerun through the shared production reconstruction path; no production behavior changed; no source mutation',
      source: {
        path: args.source,
        sha256Before: loaded.sha256Before,
        sha256After: sourceSha256After,
        sourceMutation: 'NO',
        classifierState: loaded.classifierState,
      },
      root: {
        libraryItemName: descriptor.sourceLibraryItemName,
        frameCount: descriptor.frameCount,
        spans: descriptor.frameSpanIndex.layers.map((layer) => ({
          visible: layer.visible,
          spans: layer.spans.map((span) => ({ index: span.index, duration: span.duration, endExclusive: span.endExclusive, tweenType: span.tweenType })),
        })),
      },
      requestedCount,
      resolvedCount,
      blockedCount,
      statusCounts,
      firstBlocker,
      explicitLoopBlockerCleared,
      targetBlockerFrames,
      deterministicRepeat: deterministic,
      outcome,
      frames,
    };

    await fs.promises.writeFile(path.join(args.out, 'l3-walk-right-rerun.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const receiptLines = [
      'Issue #721 Stage B5-L — L3 revalidation of 向右走 (research-only)',
      `source: ${args.source}`,
      `sha256 before: ${loaded.sha256Before}`,
      `sha256 after:  ${sourceSha256After}`,
      'source mutation: NO',
      `root graphic: ${descriptor.sourceLibraryItemName} (frames=${descriptor.frameCount})`,
      `requested frames: ${requestedCount}`,
      `resolved: ${resolvedCount}`,
      `blocked: ${requestedCount - resolvedCount}`,
      `status counts: ${JSON.stringify(statusCounts)}`,
      `first blocker: ${firstBlocker ? `F${firstBlocker.frameIndex} [${firstBlocker.stage}] ${firstBlocker.reason}${firstBlocker.sourceAddress ? ` @ ${firstBlocker.sourceAddress}` : ''}` : 'NONE'}`,
      `explicit Loop + firstFrame blocker cleared: ${explicitLoopBlockerCleared ? 'YES' : 'NO'}${targetBlockerFrames.length ? ` (still at F${targetBlockerFrames.join(', F')})` : ''}`,
      `deterministic repeat: ${deterministic ? 'PASS' : 'FAIL'}`,
      `outcome: ${outcome}`,
      'production changes: NONE (this script is read-only evidence)',
    ];
    await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receiptLines.join('\n') + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ requestedCount, resolvedCount, blockedCount, statusCounts, firstBlocker, explicitLoopBlockerCleared, deterministicRepeat: deterministic, outcome }, null, 2) + '\n');
  });
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
