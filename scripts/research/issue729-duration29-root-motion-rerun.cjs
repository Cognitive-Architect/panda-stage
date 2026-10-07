#!/usr/bin/env node
'use strict';

/**
 * Issue #729 — Stage B5-R production revalidation of 向右走 F0..F29.
 *
 * Re-runs every requested root frame (F0..F(N-1)) through the SHARED production
 * reconstruction path (dist-electron): buildGraphicFrameContext ->
 * prepareFlaNestedGraphicFrameSelections -> resolveFlaDisplayList, and classifies
 * each frame as AUTHORED | TWEEN_RECONSTRUCTED | HELD | BLOCKED.
 *
 * This runner applies the same production reconstruction path used by #726 after
 * the #728-authorized duration29 and #720-authorized terminal9728 changes. It
 * classifies any first remaining blocker without widening the source contract.
 *
 * The first blocker's `sourceAddress` encodes every successfully-selected ancestor
 * (`...-><symbol>@<selectedChildFrame>`), so the real chain 图层转元件_278 -> com22
 * -> com18 -> com26 -> com15 remains observable: the address only reaches a deeper
 * node once the shallower one resolved to its child frame.
 *
 * Source FLA is read-only: the runner verifies its hash before/after, writes
 * evidence outside the repository, refuses to overwrite, and repeats each frame.
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
  const ctx = source.buildSceneFrameContext(timeline.xml, 0, 'issue729-r4-scene@0');
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

function inspectFirstNestedMotionBlocker(source, blocker) {
  if (!blocker?.sourceAddress) return null;
  const locations = [...blocker.sourceAddress.matchAll(
    /->(.+?)@(\d+)\/layer-(\d+)-frame-(\d+)\/(\d+)/gu,
  )];
  const parentLocation = locations.at(-1);
  const reasonMatch = String(blocker.reason).match(
    /Graphic frame (\d+) requires unsupported motion tween interpolation on layer (\d+)/iu,
  );
  if (!parentLocation || !reasonMatch) return null;

  const parentName = parentLocation[1];
  const parentFrameIndex = Number(parentLocation[2]);
  const parentLayerIndex = Number(parentLocation[3]);
  const parentSourceFrameIndex = Number(parentLocation[4]);
  const parentElementIndex = Number(parentLocation[5]);
  const blockingFrameIndex = Number(reasonMatch[1]);
  const blockingLayerIndex = Number(reasonMatch[2]);
  const parentDescriptor = source.graphicSymbols.find((item) => item.sourceLibraryItemName === parentName);
  if (!parentDescriptor) return { parentName, inspectionFailure: 'parent Graphic definition is missing' };

  const parentContext = source.buildGraphicFrameContext(
    parentDescriptor.timelineXml,
    parentDescriptor.frameSpanIndex,
    parentFrameIndex,
    'issue729-blocker-source-inspection',
  );
  if (!parentContext.ok) return { parentName, inspectionFailure: parentContext.message };
  const parentLayer = parentContext.value.layers[parentLayerIndex];
  const blockingInstance = parentLayer?.elements[parentElementIndex];
  if (!blockingInstance || blockingInstance.kind !== 'symbol') {
    return { parentName, inspectionFailure: 'source address does not point to a Graphic symbol instance' };
  }

  const blockingDescriptor = source.graphicSymbols.find((item) =>
    item.sourceLibraryItemName === blockingInstance.libraryItemName);
  if (!blockingDescriptor) return {
    parentName,
    blockingLibraryItemName: blockingInstance.libraryItemName,
    inspectionFailure: 'blocking Graphic definition is missing',
  };
  const blockingLayer = blockingDescriptor.frameSpanIndex.layers[blockingLayerIndex];
  const span = blockingLayer?.spans.find((item) =>
    blockingFrameIndex >= item.index && blockingFrameIndex < item.endExclusive);
  const endSpan = span && blockingLayer?.spans.find((item) => item.index === span.endExclusive);
  const allowedFrameAttributes = new Set(['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode']);
  const directResult = source.buildGraphicFrameContext(
    blockingDescriptor.timelineXml,
    blockingDescriptor.frameSpanIndex,
    blockingFrameIndex,
    'issue729-blocker-frame-reproduction',
  );

  return {
    parent: {
      libraryItemName: parentName,
      selectedFrameIndex: parentFrameIndex,
      sourceLayerIndex: parentLayerIndex,
      sourceFrameIndex: parentSourceFrameIndex,
      sourceElementIndex: parentElementIndex,
    },
    blockingInstance: {
      libraryItemName: blockingInstance.libraryItemName,
      symbolType: blockingInstance.symbolType,
      playbackMode: blockingInstance.playbackMode ?? null,
      firstFrame: blockingInstance.firstFrame ?? null,
      sourceParentFrameIndex: blockingInstance.sourceParentFrameIndex ?? null,
      sourceParentFrameSpanStart: blockingInstance.sourceParentFrameSpanStart ?? null,
      sourceParentSpanTweenType: blockingInstance.sourceParentSpanTweenType ?? null,
      sourceAddress: blockingInstance.sourceAddress ?? null,
    },
    selectedChildFrameIndex: blockingFrameIndex,
    blockingLayerIndex,
    activeSpan: span ? {
      index: span.index,
      duration: span.duration,
      endExclusive: span.endExclusive,
      tweenType: span.tweenType,
      startFrameAttributes: span.sourceFrame.attributes,
      endFrameAttributes: endSpan?.sourceFrame.attributes ?? null,
      disallowedStartFrameAttributes: Object.keys(span.sourceFrame.attributes)
        .filter((name) => !allowedFrameAttributes.has(name)),
      disallowedEndFrameAttributes: endSpan
        ? Object.keys(endSpan.sourceFrame.attributes).filter((name) => !allowedFrameAttributes.has(name))
        : null,
    } : null,
    directAdapterResult: directResult.ok ? 'PASS' : directResult.message,
  };
}

/** Ancestor symbols named in a selector source address (`... -> <name>@<frame>`). */
function ancestorsFromAddress(sourceAddress) {
  if (!sourceAddress) return [];
  const root = sourceAddress.match(/issue729-r4:([^@/]+@\d+)/u)?.[1];
  const nested = [...sourceAddress.matchAll(/->(.+?@\d+)(?=\/layer-\d+-frame|$)/gu)].map((match) => match[1]);
  return [...(root ? [root] : []), ...nested];
}

function run(args) {
  assertExternalNewDirectory(args.out);
  return fs.promises.mkdir(args.out, { recursive: true }).then(async () => {
    const loaded = await loadSource(args.source, args.expectedSha256);
    const source = loaded.source;
    const descriptor = findRootDescriptor(source, args.rootSymbol);
    assert.equal(descriptor.sourceLibraryItemName, '图层转元件_278', 'unexpected discovered root Graphic');
    assert.equal(descriptor.frameCount, 30, 'expected the real root timeline F0..F29');
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
      const requestId = `issue729-r4:${descriptor.sourceLibraryItemName}@${frameIndex}`;
      const primary = buildAndResolve(frameIndex, requestId);
      const entry = { frameIndex, status: 'BLOCKED', stage: null, reason: null };
      if (primary.built.ok) {
        entry.rootTransforms = collectVisibleSymbols(primary.built.value.layers.flatMap((layer) => layer.elements))
          .map((element) => ({
            libraryItemName: element.libraryItemName,
            symbolType: element.symbolType,
            sourceAddress: element.sourceAddress ?? null,
            localTransform: element.localTransform ?? null,
          }));
      }

      if (!primary.built.ok) {
        entry.stage = 'ADAPTER';
        entry.reason = primary.built.message;
      } else if (!primary.nested.ok) {
        entry.stage = 'NESTED_SELECTOR';
        entry.reason = primary.nested.message;
        entry.sourceAddress = primary.nested.sourceAddress ?? null;
        entry.resolvedAncestors = ancestorsFromAddress(entry.sourceAddress);
      } else if (!primary.resolved.ok) {
        entry.stage = 'DISPLAY_LIST';
        entry.reason = primary.resolved.message;
        entry.selections = primary.nested.selections.map((selection) => ({
          sourceAddress: selection.sourceAddress,
          selectedChildFrameIndex: selection.selectedChildFrameIndex,
          selectionRule: selection.selectionRule,
        }));
      } else {
        entry.status = statusForFrame(descriptor, frameIndex);
        entry.displayListSha256 = HASH(Buffer.from(JSON.stringify(primary.resolved.displayList), 'utf8'));
        entry.selections = primary.nested.selections.map((selection) => ({
          sourceAddress: selection.sourceAddress,
          playbackMode: selection.playbackMode,
          firstFrame: selection.firstFrame ?? null,
          firstFrameWasExplicit: selection.firstFrameWasExplicit ?? null,
          effectiveFirstFrame: selection.effectiveFirstFrame ?? null,
          childFrameCount: selection.childFrameCount,
          selectedChildFrameIndex: selection.selectedChildFrameIndex,
          selectionRule: selection.selectionRule,
        }));
      }

      // Repeat the full structural result; include root transforms, descendant
      // selections, and the resolved display-list hash in the equality check.
      const repeated = buildAndResolve(frameIndex, requestId);
      const signature = (value) => JSON.stringify({
        built: value.built.ok
          ? collectVisibleSymbols(value.built.value.layers.flatMap((layer) => layer.elements))
            .map((element) => [element.libraryItemName, element.sourceAddress, element.localTransform])
          : (value.built.message ?? 'fail'),
        nested: value.nested
          ? (value.nested.ok
            ? value.nested.selections.map((s) => [s.sourceAddress, s.selectedChildFrameIndex, s.selectionRule])
            : (value.nested.message ?? 'fail'))
          : null,
        resolved: value.resolved
          ? (value.resolved.ok
            ? HASH(Buffer.from(JSON.stringify(value.resolved.displayList), 'utf8'))
            : (value.resolved.message ?? 'fail'))
          : null,
      });
      const same = signature(primary) === signature(repeated);
      entry.deterministic = same;
      if (!same) deterministic = false;

      if (entry.status === 'BLOCKED' && !firstBlocker) {
        firstBlocker = {
          frameIndex,
          stage: entry.stage,
          reason: entry.reason,
          sourceAddress: entry.sourceAddress ?? null,
          resolvedAncestors: entry.resolvedAncestors ?? ancestorsFromAddress(entry.sourceAddress),
        };
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

    const frameOne = frames.find((frame) => frame.frameIndex === 1);
    const sameBoundedMotionFailure = frameOne?.status === 'BLOCKED' &&
      frameOne.stage === 'ADAPTER' &&
      String(frameOne.reason).includes('source metadata falls outside the bounded transform-only subset');
    let outcome;
    if (blockedCount === 0) outcome = 'ROOT_MOTION_DURATION29_FULLY_RESOLVED';
    else if (!sameBoundedMotionFailure) outcome = 'ROOT_MOTION_DURATION29_PARTIAL_ADVANCE';
    else outcome = 'ROOT_MOTION_DURATION29_NOT_CLEARED';
    const firstNestedMotionBlocker = inspectFirstNestedMotionBlocker(source, firstBlocker);

    const sourceSha256After = HASH(await fs.promises.readFile(args.source));
    assert.equal(sourceSha256After, loaded.sha256Before, 'source FLA changed during the rerun');
    assert.equal(deterministic, true, 'production frame reconstruction was not deterministic');

    const report = {
      schemaVersion: 'issue729-duration29-root-motion-rerun/1',
      issue: 729,
      phase: 'R4',
      label: args.label ?? null,
      generatedNote: 'production revalidation through the shared adapter, nested selector, and display-list resolver; source FLA was read only',
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
      firstNestedMotionBlocker,
      deterministicRepeat: deterministic,
      outcome,
      representativeFrames: frames.filter((frame) => [1, 14, 28].includes(frame.frameIndex)),
      frames,
    };

    await fs.promises.writeFile(path.join(args.out, 'issue729-walk-right-f0-f29.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const receiptLines = [
      'Issue #729 Stage B5-R — production revalidation of 向右走 F0..F29',
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
      `first blocker resolved ancestors: ${firstBlocker && firstBlocker.resolvedAncestors.length ? firstBlocker.resolvedAncestors.join(' -> ') : 'NONE'}`,
      `first blocker source audit: ${JSON.stringify(firstNestedMotionBlocker)}`,
      `representative F1/F14/F28 checkpoints: ${JSON.stringify(report.representativeFrames.map((frame) => ({ frameIndex: frame.frameIndex, status: frame.status, rootTransforms: frame.rootTransforms, selections: frame.selections, blocker: frame.reason })))}`,
      `deterministic repeat: ${deterministic ? 'PASS' : 'FAIL'}`,
      `outcome: ${outcome}`,
      'source FLA mutation: NO (harness is read-only with respect to source)',
    ];
    await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receiptLines.join('\n') + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ requestedCount, resolvedCount, blockedCount, statusCounts, firstBlocker, firstNestedMotionBlocker, deterministicRepeat: deterministic, outcome, representativeFrames: report.representativeFrames }, null, 2) + '\n');
  });
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
