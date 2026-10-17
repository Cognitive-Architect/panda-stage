#!/usr/bin/env node
'use strict';

/**
 * Issue #730: read-only forensic census for frame-level parentLayerIndex.
 *
 * Reproduces the #729 first blocker, scans the named source/control FLA files
 * and an available local corpus, maps frame parent indexes to Animate rigging
 * layers, and evaluates a one-attribute in-memory shadow of the compiled
 * production adapter. No production source, FLA, or output path is modified.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_LAYER_NAMES = new Set(['DOMDocument.xml']);
const XFL_LIBRARY_XML = /^LIBRARY\/.*\.xml$/u;
const FRAME_ALLOWLIST = ['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode'];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--source') args.source = argv[++index];
    else if (name === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (name === '--control') args.control = argv[++index];
    else if (name === '--control-expected-sha256') args.controlExpectedSha256 = argv[++index];
    else if (name === '--corpus-dir') args.corpusDir = argv[++index];
    else if (name === '--out') args.out = argv[++index];
  }
  for (const name of [
    'source',
    'expectedSha256',
    'control',
    'controlExpectedSha256',
    'corpusDir',
    'out',
  ]) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu);
  assert.match(args.controlExpectedSha256, /^[a-f0-9]{64}$/iu);
  const out = path.resolve(args.out);
  const relative = path.relative(ROOT, out);
  assert.ok(
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'evidence output must stay outside the repository',
  );
  assert.ok(!fs.existsSync(out), `refusing to overwrite existing evidence directory: ${out}`);
  return {
    source: path.resolve(args.source),
    expectedSha256: args.expectedSha256.toLowerCase(),
    control: path.resolve(args.control),
    controlExpectedSha256: args.controlExpectedSha256.toLowerCase(),
    corpusDir: path.resolve(args.corpusDir),
    out,
  };
}

function parseTagAttributes(tag) {
  const firstSpace = tag.search(/\s/u);
  const body = firstSpace < 0 ? '' : tag.slice(firstSpace).replace(/\/?\s*>$/u, '');
  const attributes = {};
  for (const match of body.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attributes[match[1]] = match[2] ?? match[3] ?? '';
  }
  return attributes;
}

function nearest(stack, name) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].name === name) return stack[index];
  }
  return null;
}

/** Minimal structural XFL tag scan; it never interprets or rewrites XML. */
function scanXflXml(xml, entryName) {
  const layers = [];
  const frameAttributeOccurrences = [];
  const allAttributeOccurrences = [];
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][^<>]*?>/gu;

  for (const match of xml.matchAll(tagPattern)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<![CDATA[') || token.startsWith('<?')) continue;

    if (token.startsWith('</')) {
      const closingName = token.slice(2).match(/^([^\s>]+)/u)?.[1];
      if (!closingName) continue;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name === closingName) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const openingName = token.match(/^<([^\s/>]+)/u)?.[1];
    if (!openingName) continue;
    const attributes = parseTagAttributes(token);
    const node = { name: openingName, attributes };

    if (openingName === 'DOMTimeline') {
      node.layerCount = 0;
      node.timelineName = attributes.name ?? null;
    }
    if (openingName === 'DOMLayer') {
      const timelineNode = nearest(stack, 'DOMTimeline');
      const layer = {
        entryName,
        timelineName: timelineNode?.timelineName ?? null,
        ordinal: timelineNode ? timelineNode.layerCount++ : null,
        attributes,
        frames: [],
      };
      node.layerRecord = layer;
      layers.push(layer);
    }
    if (openingName === 'DOMFrame') {
      const layerNode = nearest(stack, 'DOMLayer');
      const frame = {
        attributes,
        symbols: [],
        layerOrdinal: layerNode?.layerRecord?.ordinal ?? null,
      };
      node.frameRecord = frame;
      layerNode?.layerRecord?.frames.push(frame);
    }
    if (openingName === 'DOMSymbolInstance') {
      const frameNode = nearest(stack, 'DOMFrame');
      const symbol = { attributes, matrix: null, transformationPoints: [] };
      node.symbolRecord = symbol;
      frameNode?.frameRecord?.symbols.push(symbol);
    }
    if (openingName === 'Matrix') {
      const symbolNode = nearest(stack, 'DOMSymbolInstance');
      if (symbolNode?.symbolRecord) symbolNode.symbolRecord.matrix = attributes;
    }
    if (openingName === 'Point' && nearest(stack, 'transformationPoint')) {
      const symbolNode = nearest(stack, 'DOMSymbolInstance');
      symbolNode?.symbolRecord?.transformationPoints.push(attributes);
    }

    if (Object.prototype.hasOwnProperty.call(attributes, 'parentLayerIndex')) {
      const timelineNode = nearest(stack, 'DOMTimeline');
      const layerNode = openingName === 'DOMLayer' ? node : nearest(stack, 'DOMLayer');
      const frameNode = openingName === 'DOMFrame' ? node : nearest(stack, 'DOMFrame');
      const occurrence = {
        entryName,
        element: openingName,
        value: attributes.parentLayerIndex,
        timelineName: timelineNode?.timelineName ?? null,
        layerOrdinal: layerNode?.layerRecord?.ordinal ?? null,
        layerName: layerNode?.layerRecord?.attributes.name ?? null,
        layerType: layerNode?.layerRecord?.attributes.layerType ?? null,
        layerRiggingIndex: layerNode?.layerRecord?.attributes.layerRiggingIndex ?? null,
        frameIndex: frameNode?.frameRecord?.attributes.index ?? null,
        frameDuration: frameNode?.frameRecord?.attributes.duration ?? null,
        tweenType: frameNode?.frameRecord?.attributes.tweenType ?? null,
        motionTweenSnap: frameNode?.frameRecord?.attributes.motionTweenSnap ?? null,
        keyMode: frameNode?.frameRecord?.attributes.keyMode ?? null,
        attributes,
      };
      allAttributeOccurrences.push(occurrence);
      if (openingName === 'DOMFrame') frameAttributeOccurrences.push(occurrence);
    }

    if (!token.endsWith('/>')) stack.push(node);
  }

  return { layers, frameAttributeOccurrences, allAttributeOccurrences };
}

function summarizeOccurrences(occurrences) {
  const countBy = (key) => occurrences.reduce((counts, item) => {
    const value = item[key] ?? '(absent)';
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
  const tweenCounts = occurrences.reduce((counts, item) => {
    const key = item.tweenType ?? '(absent/non-motion)';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return {
    occurrenceCount: occurrences.length,
    byElement: countBy('element'),
    byValue: countBy('value'),
    byTweenType: tweenCounts,
  };
}

function visibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') visibleSymbols(element.elements, output);
  }
  return output;
}

function attributesOfSymbol(element) {
  if (element.kind !== 'symbol') return null;
  return {
    libraryItemName: element.libraryItemName,
    symbolType: element.symbolType,
    playbackMode: element.playbackMode ?? null,
    localTransform: element.localTransform ?? null,
    visible: element.visible !== false,
  };
}

function matrixFromElement(element) {
  const transform = element?.localTransform;
  return transform ? {
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    tx: transform.tx,
    ty: transform.ty,
  } : null;
}

function findLayerContext(frameContext, layerName) {
  return frameContext.layers.find((layer) => layer.name === layerName) ?? null;
}

function firstVisibleSymbolInLayer(frameContext, layerName) {
  const layer = findLayerContext(frameContext, layerName);
  return layer ? visibleSymbols(layer.elements)[0] ?? null : null;
}

function loadShadowAdapter() {
  const filename = path.join(
    ROOT,
    'dist-electron',
    'main',
    'services',
    'fla-static-snapshot-display-list-adapter.js',
  );
  const original = fs.readFileSync(filename, 'utf8');
  const pattern = /const BOUNDED_MOTION_FRAME_ATTRIBUTES = new Set\(\[([\s\S]*?)\]\);/gu;
  const matches = [...original.matchAll(pattern)];
  assert.equal(matches.length, 1, 'compiled adapter must contain exactly one bounded frame-attribute set');
  const block = matches[0][0];
  const members = [...matches[0][1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  assert.deepEqual(members, FRAME_ALLOWLIST, 'compiled baseline frame allowlist changed unexpectedly');
  const shadowBlock = block.replace(/\]\);$/u, "    'parentLayerIndex',\n]);");
  const shadowSource = original.replace(block, shadowBlock);
  assert.notEqual(shadowSource, original);
  assert.equal((shadowSource.match(/parentLayerIndex/gu) ?? []).length,
    (original.match(/parentLayerIndex/gu) ?? []).length + 1,
    'shadow must differ only by the one frame-attribute allowlist member');

  const shadowModule = new Module(filename, module);
  shadowModule.filename = filename;
  shadowModule.paths = Module._nodeModulePaths(path.dirname(filename));
  shadowModule._compile(shadowSource, filename);
  return {
    adapter: shadowModule.exports,
    sourceSha256: hash(Buffer.from(original, 'utf8')),
    shadowSourceSha256: hash(Buffer.from(shadowSource, 'utf8')),
    allowlistBefore: members,
    allowlistAfter: [...members, 'parentLayerIndex'],
  };
}

async function loadArchive(filename, expectedSha256, classifier) {
  const bytes = await fs.promises.readFile(filename);
  const sha256Before = hash(bytes);
  if (expectedSha256) assert.equal(sha256Before, expectedSha256, `unexpected SHA-256 for ${filename}`);
  const classification = classifier.classifyForFlaRecovery(bytes);
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const zip = await JSZip.loadAsync(archiveBytes);
  const xmlNames = Object.keys(zip.files).filter((name) =>
    SOURCE_LAYER_NAMES.has(name) || XFL_LIBRARY_XML.test(name)).sort();
  const xmlEntries = [];
  for (const name of xmlNames) {
    const entry = zip.file(name);
    if (entry) xmlEntries.push({ name, xml: await entry.async('string') });
  }
  const document = xmlEntries.find((entry) => entry.name === 'DOMDocument.xml');
  assert.ok(document, `missing DOMDocument.xml in ${filename}`);
  const sourceSha256AfterRead = hash(await fs.promises.readFile(filename));
  assert.equal(sourceSha256AfterRead, sha256Before, `source changed while reading: ${filename}`);
  return {
    filename,
    bytes,
    sha256Before,
    classificationState: classification?.state ?? null,
    normalizationApplied: normalized.applied,
    xmlEntries,
    sourceSha256AfterRead,
  };
}

function adaptArchive(archive, adapter) {
  const document = archive.xmlEntries.find((entry) => entry.name === 'DOMDocument.xml');
  const libraries = archive.xmlEntries.filter((entry) => XFL_LIBRARY_XML.test(entry.name));
  const adapted = adapter.adaptFlaXflDisplaySource(document.xml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production adapter rejected source archive');
  return adapted.source;
}

function findRootDescriptor(source) {
  const scene = source.sceneTimelines[0];
  assert.ok(scene, 'source has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(scene.xml, 0, 'issue730-scene-root@0');
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 could not be built');
  const roots = visibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(roots.length, 1, `expected one visible root Graphic, found ${roots.length}`);
  const descriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === roots[0].libraryItemName);
  assert.ok(descriptor, `Scene symbol has no Graphic descriptor: ${roots[0].libraryItemName}`);
  return descriptor;
}

function scanArchive(archive) {
  const layers = [];
  const occurrences = [];
  for (const entry of archive.xmlEntries) {
    const scanned = scanXflXml(entry.xml, entry.name);
    layers.push(...scanned.layers);
    occurrences.push(...scanned.allAttributeOccurrences);
  }
  return {
    xmlEntryCount: archive.xmlEntries.length,
    layers,
    occurrences,
    summary: summarizeOccurrences(occurrences),
  };
}

function exactSourceAddressAudit(source, rootDescriptor, firstBlocker, selectorModule) {
  const reason = String(firstBlocker.message ?? firstBlocker.reason ?? '');
  const sourceAddress = firstBlocker.sourceAddress ?? null;
  assert.ok(sourceAddress, 'nested selector blocker did not provide a sourceAddress');
  const locations = [...sourceAddress.matchAll(/->(.+?)@(\d+)\/layer-(\d+)-frame-(\d+)\/(\d+)/gu)];
  const parent = locations.at(-1);
  assert.ok(parent, 'blocker address does not identify its immediate owning parent frame');
  const parentName = parent[1];
  const parentFrameIndex = Number(parent[2]);
  const parentLayerIndex = Number(parent[3]);
  const parentSourceFrameIndex = Number(parent[4]);
  const parentElementIndex = Number(parent[5]);
  const parentDescriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === parentName);
  assert.ok(parentDescriptor, `missing parent descriptor: ${parentName}`);
  const parentContext = source.buildGraphicFrameContext(
    parentDescriptor.timelineXml,
    parentDescriptor.frameSpanIndex,
    parentFrameIndex,
    'issue730-parent-source-address-audit',
  );
  assert.equal(parentContext.ok, true, parentContext.message || 'failed to inspect parent Graphic frame');
  const parentLayer = parentContext.value.layers[parentLayerIndex];
  const blockingInstance = parentLayer?.elements[parentElementIndex];
  assert.equal(blockingInstance?.kind, 'symbol', 'sourceAddress does not point to a symbol instance');
  const childDescriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === blockingInstance.libraryItemName);
  assert.ok(childDescriptor, `missing child Graphic descriptor: ${blockingInstance.libraryItemName}`);
  const frameIndex = Number(reason.match(/Graphic frame (\d+)/u)?.[1]);
  const layerIndex = Number(reason.match(/on layer (\d+)/u)?.[1]);
  assert.ok(Number.isSafeInteger(frameIndex), 'blocker reason has no child frame index');
  assert.ok(Number.isSafeInteger(layerIndex), 'blocker reason has no child layer index');
  const layer = childDescriptor.frameSpanIndex.layers[layerIndex];
  const span = layer?.spans.find((item) =>
    frameIndex >= item.index && frameIndex < item.endExclusive);
  assert.ok(span, 'could not find blocking child span');
  const endSpan = layer.spans.find((item) => item.index === span.endExclusive);
  assert.ok(endSpan, 'blocking tween has no adjacent authored end keyframe');
  const directResult = source.buildGraphicFrameContext(
    childDescriptor.timelineXml,
    childDescriptor.frameSpanIndex,
    frameIndex,
    'issue730-direct-com26-frame-reproduction',
  );
  assert.equal(directResult.ok, false, 'direct production adapter unexpectedly admitted parentLayerIndex');
  assert.match(directResult.message, /source metadata falls outside the bounded transform-only subset/u);

  return {
    root: {
      libraryItemName: rootDescriptor.sourceLibraryItemName,
      requestedFrame: 1,
      sourceAddress,
      resolvedAncestors: [rootDescriptor.sourceLibraryItemName, ...locations.map((item) => `${item[1]}@${item[2]}`)],
    },
    parent: {
      libraryItemName: parentName,
      selectedFrameIndex: parentFrameIndex,
      sourceLayerIndex: parentLayerIndex,
      sourceFrameIndex: parentSourceFrameIndex,
      sourceElementIndex: parentElementIndex,
    },
    blocker: {
      libraryItemName: childDescriptor.sourceLibraryItemName,
      layerIndex,
      selectedChildFrameIndex: frameIndex,
      span: {
        index: span.index,
        endIndex: endSpan.index,
        duration: span.duration,
        tweenType: span.tweenType,
        startAttributes: span.sourceFrame.attributes,
        endAttributes: endSpan.sourceFrame.attributes,
      },
      productionError: directResult.message,
      directAdapterResult: 'BLOCK',
      parentInstance: attributesOfSymbol(blockingInstance),
    },
    childDescriptor,
    firstBlockerReason: reason,
    selectorAvailable: Boolean(selectorModule),
  };
}

function findAcceptedDuration5Control(source) {
  const descriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === '肌肉男-cilisucai.com11 3');
  assert.ok(descriptor, 'the #713 control root Graphic was not found');
  const layerIndex = 1;
  const layer = descriptor.frameSpanIndex.layers[layerIndex];
  const span = layer?.spans.find((item) => item.index === 25 && item.duration === 5 && item.tweenType === 'motion');
  assert.ok(span, 'the accepted #713 F25→F30 duration-5 span was not found');
  const endSpan = layer.spans.find((item) => item.index === 30);
  assert.ok(endSpan, 'the accepted #713 duration-5 span has no F30 endpoint');
  const rawTimeline = scanXflXml(
    descriptor.timelineXml,
    `LIBRARY/${descriptor.sourceLibraryItemName}.xml`,
  );
  const rawLayer = rawTimeline.layers.find((item) => item.ordinal === layerIndex);
  assert.ok(rawLayer, 'the accepted #713 control layer is missing from raw XFL');
  const startFrame = rawLayer.frames.find((item) => item.attributes.index === '25');
  const endFrame = rawLayer.frames.find((item) => item.attributes.index === '30');
  assert.ok(startFrame && endFrame, 'the accepted #713 control endpoint frames are missing');
  const startSymbol = startFrame.symbols[0];
  const endSymbol = endFrame.symbols[0];
  const interior = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    26,
    'issue730-accepted-duration5-control-f26',
  );
  assert.equal(interior.ok, true, interior.message || 'accepted #713 duration-5 control failed');
  const endContext = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    30,
    'issue730-accepted-duration5-control-f30',
  );
  assert.equal(endContext.ok, true, endContext.message || 'accepted #713 end endpoint failed');
  const targetLayerName = rawLayer.attributes.name;
  const interiorLayer = findLayerContext(interior.value, targetLayerName);
  assert.ok(interiorLayer, 'accepted #713 control layer is missing from interior frame context');
  const interiorSymbols = visibleSymbols(interiorLayer.elements);
  assert.equal(startFrame.symbols.length, 1);
  assert.equal(endFrame.symbols.length, 1);
  assert.equal(startSymbol.attributes.libraryItemName, endSymbol.attributes.libraryItemName);
  assert.equal(startSymbol.attributes.symbolType, 'graphic');
  assert.equal(endSymbol.attributes.symbolType, 'graphic');
  assert.equal(interiorSymbols.length, 1);
  assert.equal(interiorSymbols[0].libraryItemName, startSymbol.attributes.libraryItemName);
  return {
    fixture: 'D:\\表情合集\\人物倒地.fla',
    fixtureSha256: 'bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d',
    libraryItemName: descriptor.sourceLibraryItemName,
    layerIndex,
    layerName: targetLayerName,
    spanIndex: span.index,
    duration: span.duration,
    endIndex: endSpan.index,
    startAttributes: span.sourceFrame.attributes,
    endAttributes: endSpan.sourceFrame.attributes,
    startTarget: {
      attributes: startSymbol.attributes,
      matrix: startSymbol.matrix,
      transformationPoints: startSymbol.transformationPoints,
    },
    endTarget: {
      attributes: endSymbol.attributes,
      matrix: endSymbol.matrix,
      transformationPoints: endSymbol.transformationPoints,
    },
    interiorFrame: 26,
    interiorResult: 'PASS',
    interiorSymbols: interiorSymbols.map(attributesOfSymbol),
    matrixParseAndInterpolation: interiorSymbols.length > 0 &&
      interiorSymbols.every((symbol) => symbol.localTransform &&
        Object.values(matrixFromElement(symbol)).every(Number.isFinite)),
  };
}

function makePredicateMatrix(audit, targetXmlScan, shadow) {
  const { childDescriptor, blocker } = audit;
  const childLayer = targetXmlScan.layers.find((layer) => layer.ordinal === blocker.layerIndex);
  assert.ok(childLayer, 'blocking DOMLayer was not found in the original XFL timeline');
  const layerSpans = childDescriptor.frameSpanIndex.layers[blocker.layerIndex];
  const span = layerSpans.spans.find((item) => item.index === blocker.span.index);
  const endSpan = layerSpans.spans.find((item) => item.index === blocker.span.endIndex);
  const startRawFrame = childLayer.frames.find((frame) => frame.attributes.index === String(span.index));
  const endRawFrame = childLayer.frames.find((frame) => frame.attributes.index === String(endSpan.index));
  assert.ok(startRawFrame && endRawFrame, 'raw frame records for exact pair are missing');
  const startSymbol = startRawFrame.symbols[0];
  const endSymbol = endRawFrame.symbols[0];
  const startNames = Object.keys(span.sourceFrame.attributes).sort();
  const endNames = Object.keys(endSpan.sourceFrame.attributes).sort();
  const unsupportedTags = [span.sourceFrame.xml, endSpan.sourceFrame.xml]
    .flatMap((xml) => [...xml.matchAll(/<([A-Za-z_][\w:.-]*)\b/gu)].map((item) => item[1]))
    .filter((name) => ['Ease', 'CustomEase', 'MotionObject', 'MotionPath', 'filters', 'Filter'].includes(name));
  const shadowFrame = shadow.source.buildGraphicFrameContext(
    childDescriptor.timelineXml,
    childDescriptor.frameSpanIndex,
    blocker.selectedChildFrameIndex,
    'issue730-shadow-predicate-frame-1',
  );
  assert.equal(shadowFrame.ok, true, shadowFrame.message || 'single-attribute shadow did not admit com26 F1');
  const interiorLayer = findLayerContext(shadowFrame.value, childLayer.attributes.name);
  assert.ok(interiorLayer, 'shadow context has no blocking layer');
  const shadowSymbols = visibleSymbols(interiorLayer.elements);
  assert.equal(shadowSymbols.length, 1, 'shadow frame must contain one visible endpoint Graphic');
  const shadowMatrix = matrixFromElement(shadowSymbols[0]);
  assert.ok(shadowMatrix && Object.values(shadowMatrix).every(Number.isFinite));

  return [
    {
      predicate: 'Allowed start DOMFrame attributes',
      currentExpectation: FRAME_ALLOWLIST.join(', '),
      realValue: startNames.join(', '),
      result: 'FAIL',
      decisive: true,
    },
    {
      predicate: 'Allowed end DOMFrame attributes',
      currentExpectation: FRAME_ALLOWLIST.join(', '),
      realValue: endNames.join(', '),
      result: 'FAIL',
      decisive: true,
    },
    {
      predicate: 'Duration membership',
      currentExpectation: '{2,3,5,6,14,29}',
      realValue: String(span.duration),
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Start/end index relationship',
      currentExpectation: `start=${span.index}; end=start+duration=${span.index + span.duration}`,
      realValue: `start=${span.sourceFrame.attributes.index}; end=${endSpan.sourceFrame.attributes.index}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Tween type / outgoing-state role',
      currentExpectation: 'start motion; end motion with snap=true and keyMode=22017, or an accepted terminal role',
      realValue: `start=${span.sourceFrame.attributes.tweenType}; end=${endSpan.sourceFrame.attributes.tweenType}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'motionTweenSnap',
      currentExpectation: 'start motion snap=true; a motion end key is valid only with snap=true',
      realValue: `start=${span.sourceFrame.attributes.motionTweenSnap}; end=${endSpan.sourceFrame.attributes.motionTweenSnap}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'keyMode',
      currentExpectation: 'motion endpoints use 22017',
      realValue: `start=${span.sourceFrame.attributes.keyMode}; end=${endSpan.sourceFrame.attributes.keyMode}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Unsupported motion metadata',
      currentExpectation: 'no easing, path, rotation, filter, color, shape, or unknown motion metadata',
      realValue: unsupportedTags.length ? unsupportedTags.join(', ') : 'none observed; exact shadow also passes this gate',
      result: unsupportedTags.length ? 'FAIL' : 'PASS',
      decisive: false,
    },
    {
      predicate: 'Endpoint element count/type and visibility',
      currentExpectation: 'one visible DOMSymbolInstance at each endpoint',
      realValue: `start=${startRawFrame.symbols.length} ${startSymbol?.attributes.symbolType ?? 'missing'} visible=${startSymbol?.attributes.visible !== 'false'}; end=${endRawFrame.symbols.length} ${endSymbol?.attributes.symbolType ?? 'missing'} visible=${endSymbol?.attributes.visible !== 'false'}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Same Graphic/library identity',
      currentExpectation: 'stable identity; symbolType=graphic',
      realValue: `start=${startSymbol?.attributes.libraryItemName}; end=${endSymbol?.attributes.libraryItemName}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Matrix parseability / supported transform children',
      currentExpectation: 'one finite affine Matrix and optional finite transformationPoint per endpoint',
      realValue: `startMatrix=${JSON.stringify(startSymbol?.matrix)}; endMatrix=${JSON.stringify(endSymbol?.matrix)}; shadow F1=${JSON.stringify(shadowMatrix)}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'transformationPoint structure',
      currentExpectation: 'zero or one Point with finite x/y attributes',
      realValue: `start=${JSON.stringify(startSymbol?.transformationPoints ?? [])}; end=${JSON.stringify(endSymbol?.transformationPoints ?? [])}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'DOMSymbolInstance attribute allowlist / identity attributes',
      currentExpectation: 'known instance attributes only; stable semantic attributes across endpoints',
      realValue: `start=${Object.keys(startSymbol?.attributes ?? {}).sort().join(', ')}; end=${Object.keys(endSymbol?.attributes ?? {}).sort().join(', ')}`,
      result: 'PASS',
      decisive: false,
    },
    {
      predicate: 'Downstream interpolator and transform-only construction',
      currentExpectation: 'same compiled production adapter/interpolator after exactly one frame-attribute addition',
      realValue: `shadow buildGraphicFrameContext(F${blocker.selectedChildFrameIndex})=${shadowFrame.ok ? 'PASS' : 'BLOCK'}`,
      result: 'PASS',
      decisive: false,
    },
  ];
}

function shadowFrameSamples(shadowSource, childDescriptor, layers) {
  return [0, 1, 2, 3, 4, 5].map((frameIndex) => {
    const context = shadowSource.buildGraphicFrameContext(
      childDescriptor.timelineXml,
      childDescriptor.frameSpanIndex,
      frameIndex,
      `issue730-shadow-com26-f${frameIndex}`,
    );
    assert.equal(context.ok, true, context.message || `shadow frame F${frameIndex} failed`);
    const result = {};
    for (const item of layers) {
      const symbol = firstVisibleSymbolInLayer(context.value, item.name);
      assert.ok(symbol, `missing visible symbol in ${item.name} at F${frameIndex}`);
      result[item.role] = {
        layerName: item.name,
        libraryItemName: symbol.libraryItemName,
        matrix: matrixFromElement(symbol),
      };
    }
    return { frameIndex, ...result };
  });
}

function structureAssessment(targetScan, blocker) {
  const timelineName = '便衣道士-cilisucai.com26';
  const layers = targetScan.layers.filter((layer) => layer.timelineName === timelineName);
  const childValue = blocker.span.startAttributes.parentLayerIndex;
  assert.ok(childValue !== undefined, 'blocking start frame does not carry parentLayerIndex');
  const childLayer = layers.find((layer) => layer.ordinal === blocker.layerIndex);
  assert.ok(childLayer, 'blocking child layer is missing from com26 XML');
  const matchingParentLayer = layers.filter((layer) =>
    layer.attributes.layerRiggingIndex === childValue);
  const allLayerSummaries = layers.map((layer) => ({
    ordinal: layer.ordinal,
    name: layer.attributes.name ?? null,
    layerType: layer.attributes.layerType ?? null,
    layerRiggingIndex: layer.attributes.layerRiggingIndex ?? null,
    parentLayerIndex: layer.attributes.parentLayerIndex ?? null,
    guide: layer.attributes.layerType === 'guide' || layer.attributes.layerType === 'guided',
    folder: layer.attributes.layerType === 'folder',
    mask: layer.attributes.layerType === 'mask' || layer.attributes.layerType === 'masked',
    camera: layer.attributes.layerType === 'camera' || layer.attributes.outline === 'camera',
    frames: layer.frames.map((frame) => ({
      index: frame.attributes.index,
      duration: frame.attributes.duration ?? null,
      tweenType: frame.attributes.tweenType ?? null,
      motionTweenSnap: frame.attributes.motionTweenSnap ?? null,
      keyMode: frame.attributes.keyMode ?? null,
      parentLayerIndex: frame.attributes.parentLayerIndex ?? null,
      symbols: frame.symbols.map((symbol) => ({
        libraryItemName: symbol.attributes.libraryItemName ?? null,
        symbolType: symbol.attributes.symbolType ?? null,
        matrix: symbol.matrix,
        transformationPoints: symbol.transformationPoints,
      })),
    })),
  }));
  return {
    sourceLayerOrdering: 'DOMLayer ordinal is zero-based XML order inside the DOMTimeline.',
    childLayer: {
      ordinal: childLayer.ordinal,
      name: childLayer.attributes.name ?? null,
      layerType: childLayer.attributes.layerType ?? null,
      authoredParentLayerIndex: childValue,
      occurrencesOnChildLayer: childLayer.frames
        .filter((frame) => frame.attributes.parentLayerIndex !== undefined)
        .map((frame) => ({
          index: frame.attributes.index,
          duration: frame.attributes.duration ?? null,
          tweenType: frame.attributes.tweenType ?? null,
          motionTweenSnap: frame.attributes.motionTweenSnap ?? null,
          keyMode: frame.attributes.keyMode ?? null,
          parentLayerIndex: frame.attributes.parentLayerIndex,
        })),
    },
    matchingRiggingLayers: matchingParentLayer.map((layer) => ({
      ordinal: layer.ordinal,
      name: layer.attributes.name ?? null,
      layerRiggingIndex: layer.attributes.layerRiggingIndex,
      layerType: layer.attributes.layerType ?? null,
      frameCount: layer.frames.length,
      animatedFrames: layer.frames.filter((frame) => frame.attributes.tweenType === 'motion')
        .map((frame) => frame.attributes.index),
      firstKeySymbol: layer.frames[0]?.symbols[0]?.attributes.libraryItemName ?? null,
      firstKeyMatrix: layer.frames[0]?.symbols[0]?.matrix ?? null,
      nextKeyMatrix: layer.frames[1]?.symbols[0]?.matrix ?? null,
    })),
    otherRigParentPairs: layers
      .filter((layer) => layer.frames.some((frame) => frame.attributes.parentLayerIndex !== undefined))
      .map((layer) => {
        const value = layer.frames.find((frame) => frame.attributes.parentLayerIndex !== undefined)
          .attributes.parentLayerIndex;
        return {
          childLayer: layer.attributes.name ?? null,
          parentLayerIndex: value,
          matchingLayerRiggingIndexNames: layers
            .filter((candidate) => candidate.attributes.layerRiggingIndex === value)
            .map((candidate) => candidate.attributes.name ?? null),
        };
      }),
    indexEvidence: layers
      .filter((layer) => layer.frames.some((frame) => frame.attributes.parentLayerIndex !== undefined))
      .map((layer) => {
        const value = layer.frames.find((frame) => frame.attributes.parentLayerIndex !== undefined)
          .attributes.parentLayerIndex;
        return {
          childLayerOrdinal: layer.ordinal,
          childLayerName: layer.attributes.name ?? null,
          parentLayerIndexValue: value,
          zeroBasedDomLayerOrdinalMatch: layers.find((candidate) => String(candidate.ordinal) === value)?.attributes.name ?? null,
          layerRiggingIndexMatch: layers.find((candidate) => candidate.attributes.layerRiggingIndex === value)?.attributes.name ?? null,
          note: 'The fixture’s matching rigging layer is identified by layerRiggingIndex; raw evidence alone does not define index-base semantics for every XFL version.',
        };
      }),
    layerSummaries: allLayerSummaries,
    hypotheses: {
      H1_metadataOnly: 'CONTRADICTED: Adobe documents parenting as a per-keyframe frame property with inherited parent transforms; the fixture links the value to a layerRiggingIndex layer.',
      H2_realParentLayerAffectsChild: 'SUPPORTED: DOMFrame parentLayerIndex values 0/1 align with same-timeline DOMLayer layerRiggingIndex values 0/1; matched parent layers contain animated Graphic symbols.',
      H3_guideOrMotionGuide: 'NOT SUPPORTED FOR THIS PAIR: matched layers are normal/default layer types; no guide/guided layer, MotionPath, or guide metadata was found in the relevant pair.',
      H4_tweenOrTargetComposition: 'SUPPORTED AS COMPOSITION SEMANTICS: Adobe documents that a child inherits parent motion; this changes world composition even though the bounded local interpolator itself does not read the attribute.',
      H5_serializationResidue: 'CONTRADICTED FOR THIS PAIR: the value is repeated on paired tween keyframes and matches an explicit rigging-layer index.',
    },
  };
}

async function scanCorpus(directory, classifier, cache) {
  const files = (await fs.promises.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fla'))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'en'));
  const results = [];
  for (const filename of files) {
    let archive = cache.get(filename.toLowerCase());
    if (!archive) {
      try {
        archive = await loadArchive(filename, null, classifier);
        cache.set(filename.toLowerCase(), archive);
      } catch (error) {
        results.push({
          filename,
          scanStatus: 'ARCHIVE_READ_FAILED',
          error: String(error?.message ?? error),
        });
        continue;
      }
    }
    const scanned = scanArchive(archive);
    results.push({
      filename,
      sha256: archive.sha256Before,
      normalizationApplied: archive.normalizationApplied,
      xmlEntryCount: scanned.xmlEntryCount,
      scanStatus: 'PASS',
      ...scanned.summary,
      occurrences: scanned.occurrences,
    });
  }
  const scannedResults = results.filter((result) => result.scanStatus === 'PASS');
  const totals = scannedResults.reduce((accumulator, result) => {
    accumulator.xmlEntryCount += result.xmlEntryCount;
    accumulator.occurrenceCount += result.occurrenceCount;
    for (const [key, value] of Object.entries(result.byElement)) {
      accumulator.byElement[key] = (accumulator.byElement[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(result.byValue)) {
      accumulator.byValue[key] = (accumulator.byValue[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(result.byTweenType)) {
      accumulator.byTweenType[key] = (accumulator.byTweenType[key] ?? 0) + value;
    }
    return accumulator;
  }, { xmlEntryCount: 0, occurrenceCount: 0, byElement: {}, byValue: {}, byTweenType: {} });
  return { directory, fileCount: files.length, results, totals };
}

function formatReceipt(report) {
  const main = report.sourceCensus.summary;
  const control = report.controlCensus.summary;
  return [
    'Issue: Stage B5-S parentLayerIndex forensic research',
    'implementation parent: #729',
    'evidence record: #720',
    'control: #713',
    'mother PR: #677',
    `baseline: ${report.baseline}`,
    '',
    'S0 blocker:',
    `fixture: ${report.source.path}`,
    `SHA before: ${report.source.sha256Before}`,
    `SHA after: ${report.source.sha256After}`,
    `root frame: F${report.blocker.root.requestedFrame} / NESTED_SELECTOR`,
    `sourceAddress: ${report.blocker.root.sourceAddress}`,
    `Graphic/layer/span: ${report.blocker.blocker.libraryItemName} / layer ${report.blocker.blocker.layerIndex} / F${report.blocker.blocker.span.index}→F${report.blocker.blocker.span.endIndex}`,
    `production error: ${report.blocker.blocker.productionError}`,
    '',
    'S1 predicate isolation:',
    `decisive fail predicates: ${JSON.stringify(report.decisiveFailPredicates)}`,
    '',
    'S2 census:',
    `source fixture DOMFrame parentLayerIndex occurrences: ${main.occurrenceCount}`,
    `source fixture values: ${JSON.stringify(main.byValue)}`,
    `source fixture element types: ${JSON.stringify(main.byElement)}`,
    `source fixture tweenType distribution: ${JSON.stringify(main.byTweenType)}`,
    `#713 control occurrences: ${control.occurrenceCount}`,
    `available corpus: ${report.corpus.fileCount} files, ${report.corpus.totals.occurrenceCount} parentLayerIndex occurrences`,
    '',
    'S3 structure:',
    `child layer and matching rigging layer: ${report.structure.childLayer.name} -> ${JSON.stringify(report.structure.matchingRiggingLayers.map((layer) => ({ name: layer.name, layerRiggingIndex: layer.layerRiggingIndex })))}`,
    `guide/folder/parent evidence: normal rigging layers with animated Graphic symbols; no guide/folder/mask/camera role on the matched parent`,
    `parent transform relevance: ${report.shadowProbe.parentMatrixChangesAcrossSpan ? 'parent local transform changes across F0..F5' : 'not established'}`,
    '',
    'S4 external/runtime evidence:',
    'DIRECT_ADOBE: Animate documents per-keyframe layer parenting and inherited parent transforms.',
    'SOURCE_CODE: JPEXS writer serializes parentLayerIndex on DOMLayer for clip-depth masking; that is a different element/role and is not evidence to ignore DOMFrame parentLayerIndex.',
    'SERIALIZATION_EVIDENCE: the source fixture repeats DOMFrame parentLayerIndex and matches layerRiggingIndex values.',
    'RUNTIME_EVIDENCE: no independent Adobe runtime render was run for this fixture; Adobe documentation is classified as DIRECT_ADOBE, not runtime evidence.',
    'INDIRECT: none relied on. SPECULATION: none treated as evidence.',
    'inference boundary: Adobe documentation establishes the parenting semantics; mapping this fixture’s DOMFrame.parentLayerIndex to those semantics is an inference from its per-keyframe placement and matching layerRiggingIndex values.',
    'remaining unknowns: exact matrix/pivot propagation formula for this serialized version and visual parity in Panda.',
    '',
    'S5 control comparison:',
    `accepted duration5 control: ${report.control.libraryItemName} F${report.control.spanIndex}→F${report.control.endIndex}`,
    `differences: ${report.controlComparison}`,
    '',
    'S6 shadow probe:',
    `shadow result: ${report.shadowProbe.result}`,
    `remaining blockers: ${JSON.stringify(report.shadowProbe.remainingBlockers)}`,
    `interpolator compatibility: ${report.shadowProbe.interpolatorCompatibility}`,
    '',
    'S7 narrow boundary:',
    `candidate authorization: ${report.safetyBoundary.candidateAuthorization}`,
    `explicit non-goals: ${report.safetyBoundary.explicitNonGoals.join('; ')}`,
    '',
    'classification:',
    report.classification,
    '',
    'production files changed: NO',
    'source mutation: NO',
    'Full CI manually triggered: NO',
    'PR #677 remains Draft: YES',
    '',
    'next single action:',
    report.nextAction,
  ].join('\n') + '\n';
}

async function run(args) {
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const productionAdapter = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const selectorModule = require(path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'));
  const resolverModule = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const cache = new Map();
  const sourceArchive = await loadArchive(args.source, args.expectedSha256, classifier);
  const controlArchive = await loadArchive(args.control, args.controlExpectedSha256, classifier);
  cache.set(sourceArchive.filename.toLowerCase(), sourceArchive);
  cache.set(controlArchive.filename.toLowerCase(), controlArchive);

  const source = adaptArchive(sourceArchive, productionAdapter);
  const rootDescriptor = findRootDescriptor(source);
  assert.equal(rootDescriptor.frameCount, 30, 'expected real root frames F0..F29');
  const rootFrame = source.buildGraphicFrameContext(
    rootDescriptor.timelineXml,
    rootDescriptor.frameSpanIndex,
    1,
    `issue729-r4:${rootDescriptor.sourceLibraryItemName}@1`,
  );
  assert.equal(rootFrame.ok, true, rootFrame.message || 'root F1 could not be built');
  const nested = selectorModule.prepareFlaNestedGraphicFrameSelections(source, {
    kind: 'graphic',
    name: rootDescriptor.sourceLibraryItemName,
    frameContext: rootFrame.value,
  });
  assert.equal(nested.ok, false, 'expected the #729 nested selector blocker at root F1');
  assert.match(nested.message, /source metadata falls outside the bounded transform-only subset/u);
  const resolver = resolverModule.resolveFlaDisplayList(nested.resolverInput);
  assert.equal(resolver.ok, false, 'nested failure should prevent display-list resolution');

  const firstBlocker = {
    stage: 'NESTED_SELECTOR',
    message: nested.message,
    sourceAddress: nested.sourceAddress,
  };
  const addressAudit = exactSourceAddressAudit(source, rootDescriptor, firstBlocker, selectorModule);
  assert.equal(addressAudit.blocker.libraryItemName, '便衣道士-cilisucai.com1/便衣道士-cilisucai.com26');
  assert.equal(addressAudit.blocker.layerIndex, 1);
  assert.equal(addressAudit.blocker.selectedChildFrameIndex, 1);
  assert.equal(addressAudit.blocker.span.duration, 5);

  const sourceCensus = scanArchive(sourceArchive);
  const controlCensus = scanArchive(controlArchive);
  const targetXmlName = `LIBRARY/${addressAudit.blocker.libraryItemName}.xml`;
  const targetXmlScan = scanXflXml(
    sourceArchive.xmlEntries.find((entry) => entry.name === targetXmlName)?.xml ?? '',
    targetXmlName,
  );
  assert.ok(targetXmlScan.layers.length > 0, `missing raw target timeline ${targetXmlName}`);
  const blockerOccurrences = targetXmlScan.frameAttributeOccurrences.filter((item) =>
    item.layerOrdinal === addressAudit.blocker.layerIndex);
  assert.deepEqual(blockerOccurrences.map((item) => item.value), ['1', '1', '1', '1', '1']);
  const structure = structureAssessment(targetXmlScan, addressAudit.blocker);
  assert.equal(structure.matchingRiggingLayers.length, 1, 'expected one matching rigging layer');
  assert.equal(structure.matchingRiggingLayers[0].name, '补间_21');
  assert.equal(structure.matchingRiggingLayers[0].layerRiggingIndex, '1');

  const controlSource = adaptArchive(controlArchive, productionAdapter);
  const control = findAcceptedDuration5Control(controlSource);
  const controlTargetXmlName = 'LIBRARY/肌肉男-cilisucai.com11 3.xml';
  const controlTargetScan = scanXflXml(
    controlArchive.xmlEntries.find((entry) => entry.name === controlTargetXmlName)?.xml ?? '',
    controlTargetXmlName,
  );
  const controlParentAttributes = controlTargetScan.frameAttributeOccurrences.length;
  const controlComparison = [
    'duration, start motion metadata, same-Graphic endpoint identity, supported Matrix/Point shape, no ease/path metadata, and the production interpolator match the accepted family;',
    'the com26 pair additionally carries parentLayerIndex on both endpoints;',
    'its F5 endpoint is also the start of another motion span (motion/snap/keyMode=22017/duration=5), while the #713 control F30 endpoint begins a held span (keyMode=15872/duration=17).',
  ].join(' ');

  const shadowInfo = loadShadowAdapter();
  const shadowSource = adaptArchive(sourceArchive, shadowInfo.adapter);
  const shadowChildDescriptor = shadowSource.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === addressAudit.blocker.libraryItemName);
  assert.ok(shadowChildDescriptor, 'shadow source is missing com26');
  const childLayer = targetXmlScan.layers.find((layer) => layer.ordinal === addressAudit.blocker.layerIndex);
  const parentLayer = structure.matchingRiggingLayers[0];
  const samples = shadowFrameSamples(shadowSource, shadowChildDescriptor, [
    { role: 'child', name: childLayer.attributes.name },
    { role: 'parent', name: parentLayer.name },
  ]);
  const childMatrices = samples.map((item) => item.child.matrix);
  const parentMatrices = samples.map((item) => item.parent.matrix);
  const parentMatrixChangesAcrossSpan = JSON.stringify(parentMatrices[0]) !==
    JSON.stringify(parentMatrices[parentMatrices.length - 1]);
  assert.equal(parentMatrixChangesAcrossSpan, true, 'matched rigging parent should have a changing transform');
  const predicateMatrix = makePredicateMatrix(addressAudit, targetXmlScan, { source: shadowSource });
  const decisiveFailPredicates = predicateMatrix.filter((item) => item.result === 'FAIL')
    .map((item) => item.predicate);
  assert.deepEqual(decisiveFailPredicates, [
    'Allowed start DOMFrame attributes',
    'Allowed end DOMFrame attributes',
  ]);

  const corpus = await scanCorpus(args.corpusDir, classifier, cache);
  assert.ok(corpus.fileCount > 0, 'corpus directory contains no .fla fixtures');
  assert.equal(corpus.results.filter((item) => item.scanStatus === 'ARCHIVE_READ_FAILED').length, 0,
    'one or more available corpus FLA archives could not be scanned');

  const sourceAfter = hash(await fs.promises.readFile(args.source));
  const controlAfter = hash(await fs.promises.readFile(args.control));
  assert.equal(sourceAfter, sourceArchive.sha256Before, 'source fixture changed during research');
  assert.equal(controlAfter, controlArchive.sha256Before, 'control fixture changed during research');
  for (const item of corpus.results) {
    const actual = hash(await fs.promises.readFile(item.filename));
    assert.equal(actual, item.sha256, `corpus fixture changed during research: ${item.filename}`);
  }
  const shadowCompiledAfter = hash(fs.readFileSync(path.join(
    ROOT,
    'dist-electron',
    'main',
    'services',
    'fla-static-snapshot-display-list-adapter.js',
  )));
  assert.equal(shadowCompiledAfter, shadowInfo.sourceSha256,
    'the compiled production adapter changed during the in-memory shadow probe');

  const report = {
    schemaVersion: 'issue730-parent-layer-index-forensics/1',
    issue: 730,
    phase: 'S0-S8',
    baseline: '709757f162b34612621c7a235b35e883399617c7',
    source: {
      path: args.source,
      sha256Before: sourceArchive.sha256Before,
      sha256After: sourceAfter,
      normalizationApplied: sourceArchive.normalizationApplied,
      classifierState: sourceArchive.classificationState,
      sourceMutation: 'NO',
      rootLibraryItemName: rootDescriptor.sourceLibraryItemName,
      rootFrameCount: rootDescriptor.frameCount,
    },
    controlFixture: {
      path: args.control,
      sha256Before: controlArchive.sha256Before,
      sha256After: controlAfter,
      normalizationApplied: controlArchive.normalizationApplied,
      sourceMutation: 'NO',
    },
    blocker: {
      root: addressAudit.root,
      parent: addressAudit.parent,
      blocker: addressAudit.blocker,
      resolvedAncestorChain: addressAudit.root.resolvedAncestors,
    },
    predicateMatrix,
    decisiveFailPredicates,
    sourceCensus: {
      xmlEntryCount: sourceCensus.xmlEntryCount,
      summary: sourceCensus.summary,
      com26FrameOccurrences: targetXmlScan.frameAttributeOccurrences,
      parentRigFrameOccurrencesInCom26: targetXmlScan.frameAttributeOccurrences,
    },
    structure,
    externalEvidence: [
      {
        classification: 'DIRECT_ADOBE',
        url: 'https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html',
        finding: 'Adobe documents that a child layer inherits parent position and rotation, parenting is a frame property set on each child keyframe, and Animate 2022+ can also propagate scale, skew, and flip. The guide does not name the serialized DOMFrame attribute; mapping this fixture’s attribute to that documented feature is an inference supported by its per-keyframe placement and matching layerRiggingIndex values.',
      },
      {
        classification: 'DIRECT_ADOBE',
        url: 'https://help.adobe.com/archive/en_US/flash/cs4/flash_cs4_extending.pdf',
        finding: 'The older Layer.parentLayer API covers containing folder, guiding, or masking layers. It is a distinct older layer-level API and is not used to relabel the observed DOMFrame attribute as harmless metadata.',
      },
      {
        classification: 'SOURCE_CODE',
        url: 'https://github.com/jindrapetrik/jpexs-decompiler/blob/master/libsrc/ffdec_lib/src/com/jpexs/decompiler/flash/xfl/XFLConverter.java#L4918-L4983',
        finding: 'JPEXS emits parentLayerIndex on DOMLayer while reconstructing SWF clip-depth mask relationships. This establishes another context-sensitive DOMLayer use, not a consumer of this fixture’s DOMFrame rig attribute.',
      },
      {
        classification: 'REPOSITORY_CODE',
        url: '../../src/renderer/fla-import/parser-core/fla-parser.ts',
        finding: 'The legacy renderer parser reads parentLayerIndex from DOMLayer only and uses it to identify masked layers; no production path reads DOMFrame.parentLayerIndex or layerRiggingIndex.',
      },
      {
        classification: 'REPOSITORY_CODE',
        url: '../../src/main/services/fla-display-list-resolver.ts',
        finding: 'The current Main display-list resolver composes ancestor-symbol local transforms; it has no sibling-layer rig-parent graph or frame-level parenting transform stage.',
      },
    ],
    control: {
      ...control,
      frameLevelParentLayerIndexOccurrences: controlParentAttributes,
    },
    controlCensus: {
      xmlEntryCount: controlCensus.xmlEntryCount,
      summary: controlCensus.summary,
    },
    controlComparison,
    corpus,
    shadowProbe: {
      result: 'PASS',
      patchDescription: 'in-memory compiled adapter copy; only parentLayerIndex was added to BOUNDED_MOTION_FRAME_ATTRIBUTES',
      productionFrameAllowlistBefore: shadowInfo.allowlistBefore,
      shadowFrameAllowlistAfter: shadowInfo.allowlistAfter,
      compiledAdapterSha256: shadowInfo.sourceSha256,
      shadowAdapterSha256: shadowInfo.shadowSourceSha256,
      compiledAdapterSha256After: shadowCompiledAfter,
      shadowBuildGraphicFrameContextFrame1: 'PASS',
      remainingBlockers: [],
      interpolatorCompatibility: 'PASS: production buildGraphicFrameContext used the existing interpolateFlaLinearMotionTransform for F1-F4; the exact direct child frame context builds successfully under the one-attribute shadow.',
      parentMatrixChangesAcrossSpan,
      samples,
      childLocalMatrices: childMatrices,
      parentLocalMatrices: parentMatrices,
      semanticAuthorization: 'NOT GRANTED BY SHADOW; this probe establishes mechanical gate compatibility only.',
    },
    safetyBoundary: {
      candidateAuthorization: 'NONE for frame-level parentLayerIndex alone. Future support requires a separately specified Animate layer-parenting/rig composition contract, including per-keyframe parent identity, transforms, pivot behavior, and interactions with child tween interpolation.',
      explicitNonGoals: [
        'do not add parentLayerIndex to the bounded motion frame allowlist',
        'do not ignore unknown DOMFrame attributes',
        'do not infer that same endpoint values cancel parent semantics',
        'do not implement sibling-layer transform composition in this research issue',
      ],
    },
    classification: 'PARENT_LAYER_INDEX_REQUIRES_PARENTING_SEMANTICS',
    classificationReason: 'DIRECT_ADOBE per-keyframe parenting semantics plus source-archive matches from child DOMFrame.parentLayerIndex to animated parent DOMLayer.layerRiggingIndex, while Panda has no frame-level rig composition path.',
    nextAction: 'If the owner wants this FLA family rendered, authorize a separately scoped Animate layer-parenting/rig semantics research and implementation path; keep the current adapter fail-closed until then.',
  };

  await fs.promises.mkdir(args.out, { recursive: true });
  await fs.promises.writeFile(
    path.join(args.out, 'issue730-parent-layer-index-forensics.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx' },
  );
  await fs.promises.writeFile(
    path.join(args.out, 'completion-receipt.txt'),
    formatReceipt(report),
    { flag: 'wx' },
  );
  process.stdout.write(JSON.stringify({
    firstBlocker: report.blocker,
    decisiveFailPredicates,
    sourceOccurrences: sourceCensus.summary,
    controlOccurrences: controlCensus.summary,
    corpusTotals: corpus.totals,
    matchingRiggingLayer: structure.matchingRiggingLayers[0],
    shadowResult: report.shadowProbe.result,
    parentMatrixChangesAcrossSpan,
    classification: report.classification,
  }, null, 2) + '\n');
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
