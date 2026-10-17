#!/usr/bin/env node
'use strict';

/**
 * Issue #725: identify the depth-5 missing-loop blocker from the shared #724
 * production reconstruction path, then census its exact Graphic descriptor.
 * This is read-only with respect to the source FLA and production behavior.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'out']) {
    assert.ok(args[name], `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalNewDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'evidence must stay outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite existing evidence directory: ${directory}`);
}

function directChild(getDirectChildren, xml, parentName, childName) {
  return getDirectChildren(xml, parentName).find((child) => child.name === childName) ?? null;
}

function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}

function collectElements(elements, output = []) {
  for (const element of elements) {
    output.push(element);
    if (element.kind === 'group') collectElements(element.elements, output);
  }
  return output;
}

function ancestorsFromAddress(sourceAddress) {
  const ancestors = [];
  const framePath = /@(\d+)(?=\/layer-\d+-frame-\d+\/)/gu;
  for (const match of sourceAddress.matchAll(framePath)) {
    const atIndex = match.index + match[0].indexOf('@');
    const arrowIndex = sourceAddress.lastIndexOf('->', atIndex);
    const start = arrowIndex >= 0 ? arrowIndex + 2 : sourceAddress.lastIndexOf(':', atIndex) + 1;
    ancestors.push(`${sourceAddress.slice(start, atIndex)}@${match[1]}`);
  }
  return ancestors;
}

async function loadProductionSource(sourcePath, expectedSha256) {
  const bytes = await fs.promises.readFile(sourcePath);
  const sourceSha256Before = HASH(bytes);
  assert.equal(sourceSha256Before, expectedSha256, 'source SHA-256 differs from the Issue #725 fixture');

  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classifier.classifyForFlaRecovery(bytes));
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const libraries = [];
  for (const entryName of Object.keys(zip.files).filter((name) => /^LIBRARY\/.*\.xml$/iu.test(name)).sort()) {
    libraries.push({ name: entryName, xml: await zip.file(entryName).async('string') });
  }

  const adapter = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adapter.adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'shared production XFL descriptor path rejected the archive');

  return {
    source: adapted.source,
    zip,
    getDirectChildren: adapter.getFlaXflDirectChildren,
    sourceSha256Before,
    classifierState: normalized.classification?.state ?? null,
    normalized: normalized.applied,
  };
}

function findRootGraphic(source) {
  const scene = source.sceneTimelines[0];
  assert.ok(scene, 'source has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(scene.xml, 0, 'issue724-c5-scene@0');
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 could not be built');
  const visibleSymbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(visibleSymbols.length, 1, `expected one visible Scene symbol, found ${visibleSymbols.length}`);
  const root = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === visibleSymbols[0].libraryItemName);
  assert.ok(root, `Scene symbol has no production Graphic descriptor: ${visibleSymbols[0].libraryItemName}`);
  return root;
}

function rawSpanCensus(descriptor, getDirectChildren) {
  const rawLayersWrapper = directChild(getDirectChildren, descriptor.timelineXml, 'DOMTimeline', 'layers');
  assert.ok(rawLayersWrapper, 'exact child DOMTimeline has no layers element');
  const rawLayers = getDirectChildren(rawLayersWrapper.xml, 'layers')
    .filter((block) => block.name === 'DOMLayer');
  assert.equal(rawLayers.length, descriptor.frameSpanIndex.layers.length,
    'raw DOMLayer count differs from the production frame-span descriptor');

  let domFrameSpanCount = 0;
  const layers = rawLayers.map((rawLayer, layerIndex) => {
    const rawFramesWrapper = directChild(getDirectChildren, rawLayer.xml, 'DOMLayer', 'frames');
    assert.ok(rawFramesWrapper, `DOMLayer ${layerIndex} has no frames element`);
    const rawFrames = getDirectChildren(rawFramesWrapper.xml, 'frames')
      .filter((block) => block.name === 'DOMFrame');
    const productionLayer = descriptor.frameSpanIndex.layers[layerIndex];
    assert.equal(rawFrames.length, productionLayer.spans.length,
      `DOMFrame count differs from production spans on layer ${layerIndex}`);
    domFrameSpanCount += rawFrames.length;

    return {
      layerIndex,
      layerName: rawLayer.attributes.name ?? null,
      visibleInProductionDescriptor: productionLayer.visible,
      domFrameSpanCount: rawFrames.length,
      spans: rawFrames.map((rawFrame, spanIndex) => {
        const productionSpan = productionLayer.spans[spanIndex];
        assert.ok(productionSpan, `production span missing for layer ${layerIndex}, frame span ${spanIndex}`);
        return {
          authoredIndex: rawFrame.attributes.index ?? null,
          authoredDuration: rawFrame.attributes.duration ?? null,
          authoredTweenType: rawFrame.attributes.tweenType ?? null,
          productionIndex: productionSpan.index,
          productionDuration: productionSpan.duration,
          productionEndExclusive: productionSpan.endExclusive,
          productionTweenType: productionSpan.tweenType,
        };
      }),
    };
  });

  const derivedLength = Math.max(0, ...descriptor.frameSpanIndex.layers.flatMap((layer) =>
    layer.spans.map((span) => span.endExclusive)));
  assert.equal(derivedLength, descriptor.frameCount,
    'descriptor frameCount differs from the maximum production span end');
  assert.equal(descriptor.frameSpanIndex.frameCount, descriptor.frameCount,
    'descriptor and frame-span index childFrameCount differ');

  return { domFrameSpanCount, layers, derivedLength };
}

function findRawInstance(blocker, parentDescriptor, getDirectChildren) {
  const framePathStart = blocker.sourceAddress.lastIndexOf('/layer-');
  assert.ok(framePathStart >= 0, 'blocker sourceAddress has no authored layer/frame path');
  const framePath = blocker.sourceAddress.slice(framePathStart);
  const parsedPath = framePath.match(/^\/layer-(\d+)-frame-(\d+)\/(\d+(?:\/\d+)*)$/u);
  assert.ok(parsedPath, `could not parse authored layer/frame path: ${framePath}`);
  const layerIndex = Number(parsedPath[1]);
  const authoredFrameIndex = Number(parsedPath[2]);
  const elementIndexes = parsedPath[3].split('/').map(Number);

  const rawLayersWrapper = directChild(getDirectChildren, parentDescriptor.timelineXml, 'DOMTimeline', 'layers');
  assert.ok(rawLayersWrapper, 'parent DOMTimeline has no layers element');
  const rawLayers = getDirectChildren(rawLayersWrapper.xml, 'layers').filter((block) => block.name === 'DOMLayer');
  const rawLayer = rawLayers[layerIndex];
  assert.ok(rawLayer, `sourceAddress layer ${layerIndex} does not exist in parent XFL symbol`);
  const rawFramesWrapper = directChild(getDirectChildren, rawLayer.xml, 'DOMLayer', 'frames');
  assert.ok(rawFramesWrapper, `parent DOMLayer ${layerIndex} has no frames element`);
  const rawFrames = getDirectChildren(rawFramesWrapper.xml, 'frames').filter((block) => block.name === 'DOMFrame');
  const rawFrame = rawFrames.find((frame, index) =>
    Number(frame.attributes.index ?? index) === authoredFrameIndex);
  assert.ok(rawFrame, `sourceAddress frame ${authoredFrameIndex} does not exist on parent layer ${layerIndex}`);

  let container = directChild(getDirectChildren, rawFrame.xml, 'DOMFrame', 'elements') ?? rawFrame;
  let node = null;
  for (let pathIndex = 0; pathIndex < elementIndexes.length; pathIndex += 1) {
    const siblings = getDirectChildren(container.xml, container.name);
    node = siblings[elementIndexes[pathIndex]] ?? null;
    assert.ok(node, `sourceAddress element index ${elementIndexes[pathIndex]} is missing at path depth ${pathIndex}`);
    if (pathIndex < elementIndexes.length - 1) {
      assert.equal(node.name, 'DOMGroup', 'non-leaf sourceAddress path node is not a DOMGroup');
      container = directChild(getDirectChildren, node.xml, 'DOMGroup', 'members');
      assert.ok(container, 'DOMGroup path node has no members element');
    }
  }
  assert.ok(node, 'sourceAddress did not resolve to a source XFL element');
  assert.equal(node.name, 'DOMSymbolInstance', 'exact blocker source node is not a DOMSymbolInstance');
  return {
    sourceEntry: `LIBRARY/${parentDescriptor.sourceLibraryItemName}.xml`,
    sourceTimelinePath: 'DOMSymbolItem/timelines/DOMTimeline',
    layerIndex,
    authoredFrameIndex,
    pathIndexes: elementIndexes,
    rawNodeName: node.name,
    rawAttributes: node.attributes,
  };
}

async function censusOnce(args) {
  const loaded = await loadProductionSource(args.source, args.expectedSha256);
  const { source, getDirectChildren } = loaded;
  const root = findRootGraphic(source);
  const rootFrame = source.buildGraphicFrameContext(
    root.timelineXml,
    root.frameSpanIndex,
    0,
    `issue724-c5:${root.sourceLibraryItemName}@0`,
  );
  assert.equal(rootFrame.ok, true, rootFrame.message || 'root Graphic frame 0 could not be built');

  const selector = require(path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'));
  const nested = selector.prepareFlaNestedGraphicFrameSelections(source, {
    kind: 'graphic',
    name: root.sourceLibraryItemName,
    frameContext: rootFrame.value,
  });
  assert.equal(nested.ok, false, 'expected the existing #724 blocker to remain fail-closed');
  assert.match(nested.message, /playback mode or bounds are outside the proven boundary/iu);
  assert.ok(nested.sourceAddress, 'the #724 selector blocker has no sourceAddress');

  const resolvedAncestors = ancestorsFromAddress(nested.sourceAddress);
  assert.equal(resolvedAncestors.length, 5, `expected depth-5 blocker, got ${resolvedAncestors.length} ancestors`);
  const parentIdentity = resolvedAncestors.at(-1);
  const parentAt = parentIdentity.lastIndexOf('@');
  const parentName = parentIdentity.slice(0, parentAt);
  const parentFrameIndex = Number(parentIdentity.slice(parentAt + 1));
  const parent = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === parentName);
  assert.ok(parent, `resolved parent descriptor is missing: ${parentName}`);

  const sourceAddressMarker = `->${parentName}@${parentFrameIndex}`;
  const sourceAddressMarkerIndex = nested.sourceAddress.lastIndexOf(sourceAddressMarker);
  assert.ok(sourceAddressMarkerIndex >= 0, 'parent identity is not present in the blocker sourceAddress');
  const parentScope = nested.sourceAddress.slice(0, sourceAddressMarkerIndex + sourceAddressMarker.length);
  const parentContext = source.buildGraphicFrameContext(
    parent.timelineXml,
    parent.frameSpanIndex,
    parentFrameIndex,
    parentScope,
  );
  assert.equal(parentContext.ok, true, parentContext.message || 'blocked parent frame could not be rebuilt');
  const exactAddressMatches = collectElements(parentContext.value.layers.flatMap((layer) => layer.elements))
    .filter((element) => element.kind === 'symbol' && element.sourceAddress === nested.sourceAddress);
  assert.equal(exactAddressMatches.length, 1,
    `sourceAddress must resolve to exactly one production descriptor element, found ${exactAddressMatches.length}`);
  const instance = exactAddressMatches[0];
  assert.equal(instance.symbolType, 'graphic', 'the exact blocker instance is not a Graphic');

  const rawInstance = findRawInstance(nested, parent, getDirectChildren);
  const rawLibraryReference = rawInstance.rawAttributes.libraryItemName;
  assert.ok(rawLibraryReference, 'exact blocker XFL DOMSymbolInstance has no libraryItemName');
  assert.equal(rawInstance.rawNodeName, 'DOMSymbolInstance');

  const childDescriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === instance.libraryItemName);
  assert.ok(childDescriptor, `exact blocker instance has no production Graphic descriptor: ${instance.libraryItemName}`);
  const matchingEntries = Object.keys(loaded.zip.files).filter((entryName) =>
    /^LIBRARY\/.*\.xml$/iu.test(entryName) &&
    entryName.replaceAll('\\', '/').slice('LIBRARY/'.length, -'.xml'.length) === childDescriptor.sourceLibraryItemName);
  assert.equal(matchingEntries.length, 1,
    `expected one exact XFL library entry for ${childDescriptor.sourceLibraryItemName}, found ${matchingEntries.length}`);
  const sourceEntry = matchingEntries[0];
  const libraryXml = await loaded.zip.file(sourceEntry).async('string');
  const timelineBlocks = getDirectChildren(libraryXml, 'DOMSymbolItem')
    .filter((block) => block.name === 'timelines' || block.name === 'timeline')
    .flatMap((wrapper) => getDirectChildren(wrapper.xml, wrapper.name))
    .filter((block) => block.name === 'DOMTimeline');
  const exactTimelineMatches = timelineBlocks.filter((timeline) => timeline.xml === childDescriptor.timelineXml);
  assert.equal(exactTimelineMatches.length, 1,
    `production child timeline must map to exactly one DOMTimeline in ${sourceEntry}`);
  const spans = rawSpanCensus(childDescriptor, getDirectChildren);

  const rawAttributes = rawInstance.rawAttributes;
  const playback = {
    loop: Object.hasOwn(rawAttributes, 'loop') ? { state: 'explicit', value: rawAttributes.loop } : { state: 'missing' },
    firstFrame: Object.hasOwn(rawAttributes, 'firstFrame')
      ? { state: 'explicit', value: rawAttributes.firstFrame }
      : { state: 'missing' },
    lastFrame: Object.hasOwn(rawAttributes, 'lastFrame')
      ? { state: 'explicit', value: rawAttributes.lastFrame }
      : { state: 'missing' },
    symbolType: Object.hasOwn(rawAttributes, 'symbolType')
      ? { state: 'explicit', value: rawAttributes.symbolType, effective: instance.symbolType }
      : { state: 'missing', effective: instance.symbolType },
    owningSpanStart: instance.sourceParentFrameSpanStart,
    owningParentFrame: instance.sourceParentFrameIndex,
    owningSpanTweenType: instance.sourceParentSpanTweenType ?? null,
  };
  assert.equal(rawLibraryReference, instance.libraryItemName,
    'raw XFL libraryItemName differs from the shared production-resolved descriptor name');
  assert.deepEqual(playback.loop, { state: 'missing' }, 'the exact blocker is no longer missing loop');
  assert.deepEqual(playback.firstFrame, { state: 'missing' }, 'the exact blocker firstFrame state differs from #724');
  assert.deepEqual(playback.lastFrame, { state: 'missing' }, 'the exact blocker lastFrame state differs from #724');

  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, loaded.sourceSha256Before, 'source FLA changed during the census');

  return {
    fixtureSha256Before: loaded.sourceSha256Before,
    fixtureSha256After: sourceSha256After,
    sourceMutation: 'NO',
    sourceNormalization: loaded.normalized,
    sourceClassifierState: loaded.classifierState,
    rootGraphic: root.sourceLibraryItemName,
    blocker: {
      reason: nested.message,
      sourceAddress: nested.sourceAddress,
      resolvedAncestors,
      depth: resolvedAncestors.length,
      parentLibraryItemName: parent.sourceLibraryItemName,
      exactSourcePath: rawInstance,
      rawInstanceLibraryItemName: rawLibraryReference,
      resolvedLibraryItemName: instance.libraryItemName,
      symbolType: instance.symbolType,
      playback,
      childTimelineSourceEntry: sourceEntry,
      childTimelinePath: rawInstance.sourceTimelinePath,
    },
    childTimeline: {
      libraryItemName: childDescriptor.sourceLibraryItemName,
      userLabel: childDescriptor.userLabel,
      symbolType: 'graphic',
      domFrameSpanCount: spans.domFrameSpanCount,
      layers: spans.layers,
      totalEffectiveLengthFromSpans: spans.derivedLength,
      productionDescriptorFrameCount: childDescriptor.frameCount,
      productionFrameSpanIndexFrameCount: childDescriptor.frameSpanIndex.frameCount,
      productionChildFrameCount: childDescriptor.frameCount,
      descriptorPath: 'adaptFlaXflDisplaySource -> graphicSymbols -> frameSpanIndex.frameCount',
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalNewDirectory(args.out);
  const first = await censusOnce(args);
  const second = await censusOnce(args);
  const deterministicRepeat = JSON.stringify(first) === JSON.stringify(second);
  assert.equal(deterministicRepeat, true, 'repeated production-path census differs structurally');

  let classification;
  let nextSingleAction;
  if (first.childTimeline.productionChildFrameCount === 1) {
    classification = 'SINGLE_FRAME_SAFE_CASE';
    nextSingleAction = 'Record the mode-invariant one-frame safe case; consider a bounded tiny implementation only under a new scoped authorization.';
  } else if (first.childTimeline.productionChildFrameCount > 1) {
    classification = 'MULTIFRAME_EXTERNAL_TRUTH_REQUIRED';
    nextSingleAction = 'Keep the missing-loop blocker fail-closed and obtain bounded serializer/playback-default evidence before any production implementation.';
  } else {
    classification = 'IDENTITY_OR_DESCRIPTOR_UNRESOLVED';
    nextSingleAction = 'Resolve the exact blocker identity or production childFrameCount before making an A5 decision.';
  }

  const report = {
    schemaVersion: 'issue725-com2-childframe-census/1',
    issue: 725,
    fixturePath: args.source,
    repeatCount: 2,
    deterministicRepeat,
    classification,
    runs: [first, second],
    productionCodeChanges: 'NONE',
    a5Implemented: 'NO',
    sourceMutation: 'NO',
    fullCiManuallyTriggered: 'NO',
    motherPr: { number: 677, remainsDraft: true },
    nextSingleAction,
  };

  await fs.promises.mkdir(args.out, { recursive: false });
  await fs.promises.writeFile(path.join(args.out, 'com2-childframe-census.json'),
    JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const firstRun = first;
  const receipt = [
    'Issue: #725 A5 com2 childFrameCount investigation',
    'evidence parent: #720 A5',
    'latest chain evidence: #724',
    'mother PR: #677',
    `fixture: ${args.source}`,
    `SHA before: ${firstRun.fixtureSha256Before}`,
    `SHA after: ${firstRun.fixtureSha256After}`,
    '',
    `com2 identity: ${firstRun.blocker.resolvedLibraryItemName}`,
    `full library item name: ${firstRun.blocker.resolvedLibraryItemName}`,
    `sourceAddress: ${firstRun.blocker.sourceAddress}`,
    `resolvedAncestors: ${firstRun.blocker.resolvedAncestors.join(' -> ')}`,
    `symbol type: ${firstRun.blocker.symbolType}`,
    `source XFL entry: ${firstRun.blocker.childTimelineSourceEntry}`,
    `source timeline path: ${firstRun.blocker.childTimelinePath}`,
    '',
    `loop: ${firstRun.blocker.playback.loop.state}`,
    `firstFrame: ${firstRun.blocker.playback.firstFrame.state}`,
    `lastFrame: ${firstRun.blocker.playback.lastFrame.state}`,
    `owning span start: ${firstRun.blocker.playback.owningSpanStart}`,
    `owning span tweenType: ${firstRun.blocker.playback.owningSpanTweenType}`,
    `DOMFrame span count: ${firstRun.childTimeline.domFrameSpanCount}`,
    `DOMFrame indexes/durations: ${JSON.stringify(firstRun.childTimeline.layers.map((layer) => ({ layerIndex: layer.layerIndex, spans: layer.spans.map((span) => ({ index: span.authoredIndex, duration: span.authoredDuration })) })))}`,
    `production childFrameCount: ${firstRun.childTimeline.productionChildFrameCount}`,
    `deterministic repeat: ${deterministicRepeat ? 'PASS (2 structurally identical production-path censuses)' : 'FAIL'}`,
    'production files changed: NO',
    'source mutation: NO',
    'A5 implemented: NO',
    'Full CI manually triggered: NO',
    'PR #677 remains Draft: YES',
    '',
    `classification: ${classification}`,
    `next single action: ${nextSingleAction}`,
  ].join('\n') + '\n';
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receipt, { flag: 'wx' });

  process.stdout.write(JSON.stringify({
    classification,
    deterministicRepeat,
    sourceAddress: firstRun.blocker.sourceAddress,
    resolvedAncestors: firstRun.blocker.resolvedAncestors,
    fullLibraryItemName: firstRun.blocker.resolvedLibraryItemName,
    symbolType: firstRun.blocker.symbolType,
    loop: firstRun.blocker.playback.loop,
    firstFrame: firstRun.blocker.playback.firstFrame,
    lastFrame: firstRun.blocker.playback.lastFrame,
    owningSpanStart: firstRun.blocker.playback.owningSpanStart,
    owningSpanTweenType: firstRun.blocker.playback.owningSpanTweenType,
    sourceEntry: firstRun.blocker.childTimelineSourceEntry,
    domFrameSpanCount: firstRun.childTimeline.domFrameSpanCount,
    layers: firstRun.childTimeline.layers,
    productionChildFrameCount: firstRun.childTimeline.productionChildFrameCount,
    sourceSha256Before: firstRun.fixtureSha256Before,
    sourceSha256After: firstRun.fixtureSha256After,
    nextSingleAction,
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
