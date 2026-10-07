#!/usr/bin/env node
'use strict';

/**
 * Issue #727 research-only audit of the real 向右走 F1 motion span against the
 * current adapter gate and accepted #713 motion-span controls.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const FRAME_ATTRIBUTES = new Set(['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode']);
const SPAN_DURATIONS = new Set([2, 3, 5, 6, 14]);
const INSTANCE_ATTRIBUTES = new Set([
  'libraryItemName', 'selected', 'symbolType', 'centerPoint3DX', 'centerPoint3DY',
  'loop', 'firstFrame', 'lastFrame',
]);
const UNSUPPORTED_TAGS = new Set([
  'motionobject', 'motionpath', 'ease', 'customease', 'domtween', 'animationcore',
  'propertycontainer', 'motionobjectxml',
]);
const UNSUPPORTED_ATTRIBUTES = new Set([
  'acceleration', 'easein', 'easeout', 'motionpath', 'orienttopath', 'rotate',
  'rotatedirection', 'rotatetimes', 'rotationdirection', 'rotationtimes',
  'tweeneasing', 'motiontweenrotate',
]);
const MATRIX_ATTRIBUTES = new Set(['a', 'b', 'c', 'd', 'tx', 'ty']);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--walk-source') args.walkSource = argv[++index];
    else if (argv[index] === '--walk-sha256') args.walkSha256 = argv[++index];
    else if (argv[index] === '--control-source') args.controlSource = argv[++index];
    else if (argv[index] === '--control-sha256') args.controlSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['walkSource', 'walkSha256', 'controlSource', 'controlSha256', 'out']) {
    assert.ok(args[name], `missing --${name}`);
  }
  assert.match(args.walkSha256, /^[a-f0-9]{64}$/iu);
  assert.match(args.controlSha256, /^[a-f0-9]{64}$/iu);
  return {
    ...args,
    walkSource: path.resolve(args.walkSource),
    controlSource: path.resolve(args.controlSource),
    out: path.resolve(args.out),
  };
}

function assertExternalNewDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep),
    'evidence must stay outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite existing evidence directory: ${directory}`);
}

function directChild(getChildren, xml, parentName, childName) {
  return getChildren(xml, parentName).find((child) => child.name === childName) ?? null;
}

function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}

function collectBlocks(getChildren, block, output = []) {
  output.push(block);
  for (const child of getChildren(block.xml, block.name)) collectBlocks(getChildren, child, output);
  return output;
}

function flattenXml(getChildren, block, pathParts = [], output = []) {
  const currentPath = [...pathParts, block.name];
  output.push({ path: currentPath.join('/'), name: block.name, attributes: block.attributes });
  for (const child of getChildren(block.xml, block.name)) flattenXml(getChildren, child, currentPath, output);
  return output;
}

function layersForTimeline(getChildren, timelineXml) {
  const wrapper = directChild(getChildren, timelineXml, 'DOMTimeline', 'layers');
  return wrapper ? getChildren(wrapper.xml, 'layers').filter((block) => block.name === 'DOMLayer') : [];
}

function framesForLayer(getChildren, layerXml) {
  const wrapper = directChild(getChildren, layerXml, 'DOMLayer', 'frames');
  return wrapper ? getChildren(wrapper.xml, 'frames').filter((block) => block.name === 'DOMFrame') : [];
}

function frameElements(getChildren, frameBlock) {
  const wrapper = directChild(getChildren, frameBlock.xml, 'DOMFrame', 'elements');
  return wrapper ? getChildren(wrapper.xml, wrapper.name) : [];
}

function visible(attributes) {
  return attributes.isVisible !== 'false' && attributes.visible !== 'false';
}

function parseMatrix(getChildren, target) {
  const children = getChildren(target.xml, target.name);
  const wrappers = children.filter((child) => child.name === 'matrix');
  const wrapperChildren = wrappers.length === 1 ? getChildren(wrappers[0].xml, 'matrix') : [];
  const values = wrapperChildren.filter((child) => child.name === 'Matrix');
  const attrs = values[0]?.attributes ?? {};
  const parsed = {
    a: attrs.a === undefined ? 1 : Number(attrs.a),
    b: attrs.b === undefined ? 0 : Number(attrs.b),
    c: attrs.c === undefined ? 0 : Number(attrs.c),
    d: attrs.d === undefined ? 1 : Number(attrs.d),
    tx: attrs.tx === undefined ? 0 : Number(attrs.tx),
    ty: attrs.ty === undefined ? 0 : Number(attrs.ty),
  };
  return {
    wrapperCount: wrappers.length,
    wrapperChildNames: wrapperChildren.map((child) => child.name),
    wrapperShapeSupported: wrappers.length === 1 && wrapperChildren.length === 1 &&
      wrapperChildren[0]?.name === 'Matrix',
    matrixElementCount: values.length,
    authoredAttributes: attrs,
    parsedWithProductionDefaults: parsed,
    authoredAttributesAllowed: Object.keys(attrs).every((name) => MATRIX_ATTRIBUTES.has(name)),
    finite: Object.values(parsed).every(Number.isFinite),
  };
}

function transformPoint(getChildren, target) {
  const children = getChildren(target.xml, target.name);
  const wrappers = children.filter((child) => child.name === 'transformationPoint');
  const wrapperChildren = wrappers.length === 1
    ? getChildren(wrappers[0].xml, 'transformationPoint') : [];
  const values = wrapperChildren.filter((child) => child.name === 'Point');
  const attrs = values[0]?.attributes ?? {};
  return {
    wrapperCount: wrappers.length,
    wrapperChildNames: wrapperChildren.map((child) => child.name),
    pointCount: values.length,
    authoredAttributes: attrs,
    supportedShape: wrappers.length <= 1 && (wrappers.length === 0 ||
      (wrapperChildren.length === 1 && values.length === 1 &&
       wrapperChildren[0]?.name === 'Point' &&
       Object.keys(attrs).every((name) => name === 'x' || name === 'y') &&
       Object.values(attrs).every((value) => Number.isFinite(Number(value))))),
  };
}

function unsupportedMetadata(getChildren, frameBlock) {
  const flattened = flattenXml(getChildren, frameBlock);
  const matchedTags = flattened.filter((entry) => UNSUPPORTED_TAGS.has(entry.name.toLocaleLowerCase('en-US')));
  const matchedAttributes = flattened.flatMap((entry) => Object.keys(entry.attributes)
    .filter((name) => UNSUPPORTED_ATTRIBUTES.has(name.toLocaleLowerCase('en-US')))
    .map((name) => ({ path: entry.path, name, value: entry.attributes[name] })));
  return { detected: matchedTags.length > 0 || matchedAttributes.length > 0, matchedTags, matchedAttributes };
}

function frameEndpoint(getChildren, frameBlock) {
  const frameChildren = getChildren(frameBlock.xml, 'DOMFrame');
  const elementsContainer = frameChildren.length === 1 && frameChildren[0]?.name === 'elements'
    ? frameChildren[0] : null;
  const elements = frameElements(getChildren, frameBlock);
  const frameNodes = flattenXml(getChildren, frameBlock);
  const target = elements[0] ?? null;
  return {
    frameAttributes: frameBlock.attributes,
    frameContainerChildNames: frameChildren.map((child) => child.name),
    frameContainerShapeSupported: frameChildren.length === 1 && frameChildren[0]?.name === 'elements',
    frameSha256: HASH(Buffer.from(frameBlock.xml, 'utf8')),
    authoredElementCount: elements.length,
    elements: elements.map((element) => ({ name: element.name, attributes: element.attributes, visible: visible(element.attributes) })),
    elementsContainerChildNames: elementsContainer
      ? getChildren(elementsContainer.xml, elementsContainer.name).map((child) => child.name) : [],
    target: target ? {
      name: target.name,
      attributes: target.attributes,
      visible: visible(target.attributes),
      matrix: parseMatrix(getChildren, target),
      transformationPoint: transformPoint(getChildren, target),
      childTags: getChildren(target.xml, target.name).map((child) => child.name),
    } : null,
    tagsAndAttributes: frameNodes,
    unsupportedMotionMetadata: unsupportedMetadata(getChildren, frameBlock),
  };
}

function expectedEndState(frame) {
  if (frame.attributes.tweenType === 'motion') {
    return frame.attributes.motionTweenSnap === 'true' && frame.attributes.keyMode === '22017';
  }
  return (frame.attributes.tweenType === undefined || frame.attributes.tweenType === 'none') &&
    frame.attributes.motionTweenSnap === undefined && frame.attributes.keyMode === '15872';
}

function finiteCenterPoints(target) {
  return ['centerPoint3DX', 'centerPoint3DY'].every((name) =>
    target.attributes[name] === undefined || Number.isFinite(Number(target.attributes[name])));
}

function endpointAttributesMatch(start, end) {
  const ignored = new Set(['selected', 'centerPoint3DX', 'centerPoint3DY']);
  const names = new Set([...Object.keys(start.attributes), ...Object.keys(end.attributes)]);
  const differences = [...names]
    .filter((name) => !ignored.has(name) && start.attributes[name] !== end.attributes[name])
    .map((name) => ({ name, start: start.attributes[name] ?? null, end: end.attributes[name] ?? null }));
  return { pass: differences.length === 0, ignoredAuthoringMetadata: [...ignored], differences };
}

function findEndpointProductionSymbol(source, descriptor, frameIndex, layerIndex, targetName) {
  const built = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `issue727-endpoint:${descriptor.sourceLibraryItemName}@${frameIndex}`,
  );
  if (!built.ok) return { ok: false, reason: built.message, sourceAddress: null, localTransform: null };
  const candidates = collectVisibleSymbols(built.value.layers.flatMap((layer) => layer.elements))
    .filter((element) => element.libraryItemName === targetName &&
      element.sourceAddress?.includes(`/layer-${layerIndex}-frame-${frameIndex}/`));
  if (candidates.length !== 1) {
    return { ok: false, reason: `expected one production endpoint symbol, found ${candidates.length}`, sourceAddress: null, localTransform: null };
  }
  return {
    ok: true,
    reason: null,
    sourceAddress: candidates[0].sourceAddress ?? null,
    localTransform: candidates[0].localTransform ?? null,
  };
}

function buildPredicateTable(startSpan, endSpan, start, end, startEndpoint, endEndpoint) {
  const startTarget = start.target;
  const endTarget = end.target;
  const hasTargets = Boolean(startTarget && endTarget);
  const instanceAttributesAllowed = hasTargets &&
    [...Object.keys(startTarget.attributes), ...Object.keys(endTarget.attributes)]
      .every((name) => INSTANCE_ATTRIBUTES.has(name));
  const instanceIdentitySame = hasTargets &&
    startTarget.attributes.libraryItemName === endTarget.attributes.libraryItemName;
  const symbolTypesGraphic = hasTargets && startTarget.attributes.symbolType === 'graphic' &&
    endTarget.attributes.symbolType === 'graphic';
  const centerPointsFinite = hasTargets && finiteCenterPoints(startTarget) && finiteCenterPoints(endTarget);
  const attributesMatch = hasTargets ? endpointAttributesMatch(startTarget, endTarget) : { pass: false, differences: [] };
  const transformsStructurallySupported = hasTargets &&
    startTarget.matrix.wrapperCount === 1 && startTarget.matrix.matrixElementCount === 1 &&
    startTarget.matrix.wrapperShapeSupported &&
    startTarget.matrix.authoredAttributesAllowed && startTarget.matrix.finite &&
    endTarget.matrix.wrapperCount === 1 && endTarget.matrix.matrixElementCount === 1 &&
    endTarget.matrix.wrapperShapeSupported &&
    endTarget.matrix.authoredAttributesAllowed && endTarget.matrix.finite &&
    startTarget.transformationPoint.supportedShape && endTarget.transformationPoint.supportedShape &&
    startTarget.childTags.every((name) => name === 'matrix' || name === 'transformationPoint') &&
    endTarget.childTags.every((name) => name === 'matrix' || name === 'transformationPoint');
  const startFrameAttrAllowed = Object.keys(start.frameAttributes).every((name) => FRAME_ATTRIBUTES.has(name));
  const endFrameAttrAllowed = Object.keys(end.frameAttributes).every((name) => FRAME_ATTRIBUTES.has(name));
  const endTweenTypeAcceptable = end.frameAttributes.tweenType === undefined ||
    end.frameAttributes.tweenType === 'none' || end.frameAttributes.tweenType === 'motion';
  const predicates = [
    ['start frame attributes are allowlisted', startFrameAttrAllowed],
    ['end frame attributes are allowlisted', endFrameAttrAllowed],
    ['start frame has exactly one elements container', start.frameContainerShapeSupported],
    ['end frame has exactly one elements container', end.frameContainerShapeSupported],
    ['span duration belongs to accepted set {2,3,5,6,14}', SPAN_DURATIONS.has(startSpan.duration)],
    ['start index equals span start', Number(start.frameAttributes.index) === startSpan.index],
    ['end index equals start plus duration', Number(end.frameAttributes.index) === startSpan.index + startSpan.duration],
    ['start tweenType is motion', start.frameAttributes.tweenType === 'motion'],
    ['start motionTweenSnap is true', start.frameAttributes.motionTweenSnap === 'true'],
    ['start keyMode is 22017', start.frameAttributes.keyMode === '22017'],
    ['end tweenType is none/missing or motion', endTweenTypeAcceptable],
    ['end motionTweenSnap/keyMode matches its outgoing-state family', expectedEndState({ attributes: end.frameAttributes })],
    ['unsupported motion metadata detector is clear on start', !start.unsupportedMotionMetadata.detected],
    ['unsupported motion metadata detector is clear on end', !end.unsupportedMotionMetadata.detected],
    ['start endpoint has exactly one display element', start.authoredElementCount === 1],
    ['end endpoint has exactly one display element', end.authoredElementCount === 1],
    ['start endpoint is DOMSymbolInstance', startTarget?.name === 'DOMSymbolInstance'],
    ['end endpoint is DOMSymbolInstance', endTarget?.name === 'DOMSymbolInstance'],
    ['both endpoint instances are visible', Boolean(startTarget?.visible && endTarget?.visible)],
    ['endpoint instance attributes are allowlisted', instanceAttributesAllowed],
    ['endpoint symbol/library identity matches', instanceIdentitySame],
    ['both endpoint symbolType values are explicit graphic', symbolTypesGraphic],
    ['centerPoint3D values are finite when present', centerPointsFinite],
    ['endpoint instance attributes match except selected/centerPoint3D', attributesMatch.pass],
    ['matrix and transformationPoint endpoint structures are supported', transformsStructurallySupported],
    ['production endpoint source parsing succeeds', startEndpoint.ok && endEndpoint.ok],
    ['production endpoint transforms are available', Boolean(startEndpoint.localTransform && endEndpoint.localTransform)],
  ];
  return predicates.map(([predicate, pass]) => ({
    predicate,
    pass: Boolean(pass),
    decisive: !pass,
  }));
}

function timelineRows(getChildren, timelineXml, sourceEntry) {
  const layers = layersForTimeline(getChildren, timelineXml);
  return layers.map((layer, layerIndex) => ({
    layerIndex,
    layerName: layer.attributes.name ?? null,
    frames: framesForLayer(getChildren, layer.xml).map((frame, authoredPosition) => ({
      authoredPosition,
      frame,
    })),
  })).flatMap((layer) => layer.frames.map(({ authoredPosition, frame }) => ({
    sourceEntry,
    layerIndex: layer.layerIndex,
    layerName: layer.layerName,
    authoredPosition,
    frameIndex: frame.attributes.index ?? null,
    duration: frame.attributes.duration ?? null,
    tweenType: frame.attributes.tweenType ?? null,
    motionTweenSnap: frame.attributes.motionTweenSnap ?? null,
    keyMode: frame.attributes.keyMode ?? null,
  })));
}

function collectTimelines(getChildren, xml, rootName) {
  const timelines = [];
  const visit = (block, pathParts) => {
    if (block.name === 'DOMTimeline') timelines.push({ block, path: [...pathParts, block.name].join('/') });
    for (const child of getChildren(block.xml, block.name)) visit(child, [...pathParts, block.name]);
  };
  for (const root of getChildren(xml, rootName)) visit(root, [rootName]);
  return timelines;
}

function allKeyMode9728Locations(loaded) {
  const rows = [];
  const documents = [{ sourceEntry: 'DOMDocument.xml', xml: loaded.documentXml, rootName: 'DOMDocument' },
    ...loaded.libraries.map((item) => ({ sourceEntry: item.name, xml: item.xml, rootName: 'DOMSymbolItem' }))];
  for (const document of documents) {
    for (const timeline of collectTimelines(loaded.getDirectChildren, document.xml, document.rootName)) {
      for (const row of timelineRows(loaded.getDirectChildren, timeline.block.xml, document.sourceEntry)) {
        if (row.keyMode === '9728') rows.push({ ...row, timelinePath: timeline.path });
      }
    }
  }
  return rows;
}

function rootDescriptor(loaded) {
  const scene = loaded.source.sceneTimelines[0];
  assert.ok(scene, 'Scene timeline missing');
  const context = loaded.source.buildSceneFrameContext(scene.xml, 0, 'issue727-root-discovery@0');
  assert.equal(context.ok, true, context.message || 'Scene frame 0 could not be built');
  const symbols = collectVisibleSymbols(context.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected exactly one visible Scene Graphic, found ${symbols.length}`);
  const descriptor = loaded.source.graphicSymbols.find((item) =>
    item.sourceLibraryItemName === symbols[0].libraryItemName);
  assert.ok(descriptor, `Scene root Graphic descriptor missing: ${symbols[0].libraryItemName}`);
  return descriptor;
}

async function loadProductionSource(sourcePath, expectedSha256) {
  const bytes = await fs.promises.readFile(sourcePath);
  const sha256Before = HASH(bytes);
  assert.equal(sha256Before, expectedSha256, `source SHA differs from expected fixture: ${sourcePath}`);
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(bytes);
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    libraries.push({ name, xml: await zip.file(name).async('string') });
  }
  const adapter = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adapter.adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the archive');
  return {
    sourcePath,
    sha256Before,
    classifierState: classification.state,
    normalizationApplied: normalized.applied,
    documentXml,
    libraries,
    zip,
    source: adapted.source,
    getDirectChildren: adapter.getFlaXflDirectChildren,
  };
}

function findRawLibraryEntry(loaded, libraryItemName) {
  const entryName = `LIBRARY/${libraryItemName}.xml`;
  const entry = loaded.libraries.find((item) => item.name === entryName);
  assert.ok(entry, `raw XFL library entry not found: ${entryName}`);
  return entry;
}

function spanAudit(loaded, descriptor, requestedFrame, knownFailure) {
  const { getDirectChildren } = loaded;
  const layers = layersForTimeline(getDirectChildren, descriptor.timelineXml);
  const spanLayers = descriptor.frameSpanIndex.layers;
  assert.equal(layers.length, spanLayers.length, 'raw/production layer count differs');
  const containing = [];
  for (let layerIndex = 0; layerIndex < spanLayers.length; layerIndex += 1) {
    const layer = spanLayers[layerIndex];
    const span = layer.spans.find((item) => requestedFrame >= item.index && requestedFrame < item.endExclusive);
    if (span) containing.push({ layerIndex, span, layer: layers[layerIndex], visible: layer.visible });
  }
  const failures = containing.filter((item) => item.layerIndex === 0 && item.span.tweenType === 'motion');
  assert.equal(failures.length, 1, 'expected one layer-0 motion span for requested F1');
  const selected = failures[0];
  const startSpan = selected.span;
  const endSpan = spanLayers[selected.layerIndex].spans.find((item) => item.index === startSpan.endExclusive);
  assert.ok(endSpan, 'adjacent authored end keyframe is missing');
  const start = startSpan.sourceFrame;
  const end = endSpan.sourceFrame;
  const rawLayerFrames = framesForLayer(getDirectChildren, selected.layer.xml);
  const authoredStart = rawLayerFrames.find((frame, index) =>
    Number(frame.attributes.index ?? index) === startSpan.index);
  const authoredEnd = rawLayerFrames.find((frame, index) =>
    Number(frame.attributes.index ?? index) === endSpan.index);
  assert.ok(authoredStart && authoredEnd, 'production span source frames did not map to raw XFL DOMFrame nodes');
  assert.equal(authoredStart.xml, start.xml, 'production start span differs from raw XFL start frame');
  assert.equal(authoredEnd.xml, end.xml, 'production end span differs from raw XFL end frame');

  const startRecord = frameEndpoint(getDirectChildren, start);
  const endRecord = frameEndpoint(getDirectChildren, end);
  const startTargetName = startRecord.target?.attributes.libraryItemName ?? '';
  const endTargetName = endRecord.target?.attributes.libraryItemName ?? '';
  const startEndpoint = findEndpointProductionSymbol(loaded.source, descriptor, startSpan.index,
    selected.layerIndex, startTargetName);
  const endEndpoint = findEndpointProductionSymbol(loaded.source, descriptor, endSpan.index,
    selected.layerIndex, endTargetName);
  const predicates = buildPredicateTable(startSpan, endSpan, startRecord, endRecord, startEndpoint, endEndpoint);
  const failPredicates = predicates.filter((entry) => !entry.pass).map((entry) => entry.predicate);
  const request = loaded.source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    requestedFrame,
    `issue727-request:${descriptor.sourceLibraryItemName}@${requestedFrame}`,
  );
  assert.equal(request.ok, false, 'expected the current production adapter to reproduce F1 rejection');
  assert.match(request.message, /source metadata falls outside the bounded transform-only subset/iu);
  assert.equal(request.message, knownFailure, 'production F1 rejection differs from the #726 baseline blocker');

  const sourceEntry = findRawLibraryEntry(loaded, descriptor.sourceLibraryItemName);
  const intervalRows = timelineRows(getDirectChildren, descriptor.timelineXml, sourceEntry.name);
  const keyMode9728InRoot = intervalRows.filter((row) => row.keyMode === '9728');
  const walkKeyMode9728All = allKeyMode9728Locations(loaded);
  const mapSource = (frameIndex) => {
    const endpointContext = loaded.source.buildGraphicFrameContext(
      descriptor.timelineXml,
      descriptor.frameSpanIndex,
      frameIndex,
      `issue727-source-address:${descriptor.sourceLibraryItemName}@${frameIndex}`,
    );
    if (!endpointContext.ok) return { ok: false, reason: endpointContext.message, sourceAddress: null };
    const symbols = collectVisibleSymbols(endpointContext.value.layers.flatMap((layer) => layer.elements))
      .filter((element) => element.sourceAddress?.includes(`/layer-${selected.layerIndex}-frame-${frameIndex}/`));
    return { ok: symbols.length === 1, sourceAddress: symbols.length === 1 ? symbols[0].sourceAddress : null,
      symbolCount: symbols.length };
  };

  const interpolation = [];
  if (startEndpoint.localTransform && endEndpoint.localTransform) {
    const interpolate = require(path.join(ROOT, 'dist-electron/main/services/fla-motion-tween-transform-interpolator.js'))
      .interpolateFlaLinearMotionTransform;
    const checkpoints = [0, 1, 14, 28, 29].map((frameIndex) => ({
      frameIndex,
      t: (frameIndex - startSpan.index) / startSpan.duration,
    }));
    for (const checkpoint of checkpoints) {
      const result = interpolate(startEndpoint.localTransform, endEndpoint.localTransform, checkpoint.t);
      interpolation.push({ ...checkpoint, result });
    }
  }

  const allTags = [...startRecord.tagsAndAttributes, ...endRecord.tagsAndAttributes];
  const allTagNames = new Set(allTags.map((entry) => entry.name.toLocaleLowerCase('en-US')));
  const allAttributeNames = new Set(allTags.flatMap((entry) => Object.keys(entry.attributes)
    .map((name) => name.toLocaleLowerCase('en-US'))));
  const allMetadataNames = new Set([...allTagNames, ...allAttributeNames]);
  const unsupportedNames = [...UNSUPPORTED_TAGS, ...UNSUPPORTED_ATTRIBUTES];
  const documentElements = collectBlocks(getDirectChildren,
    { name: 'DOMDocument', attributes: {}, xml: loaded.documentXml });
  const allSourceElements = [...documentElements];
  for (const library of loaded.libraries) {
    for (const root of getDirectChildren(library.xml, 'DOMSymbolItem')) {
      allSourceElements.push(...collectBlocks(getDirectChildren, root));
    }
  }
  const scriptElements = allSourceElements.filter((entry) =>
    /script|actionscript/iu.test(entry.name));

  return {
    fixture: {
      path: loaded.sourcePath,
      sha256Before: loaded.sha256Before,
      classifierState: loaded.classifierState,
      recoveryNormalizationAppliedInMemory: loaded.normalizationApplied,
    },
    root: {
      libraryItemName: descriptor.sourceLibraryItemName,
      frameCount: descriptor.frameCount,
      timelineEntry: sourceEntry.name,
      timelinePath: 'DOMSymbolItem/timeline/DOMTimeline',
      requestedFrame: requestedFrame,
      productionFailure: request.message,
      productionFailureSourceAddress: null,
    },
    exactSpan: {
      layerIndex: selected.layerIndex,
      layerName: selected.layer.attributes.name ?? null,
      layerVisibleInProduction: selected.visible,
      startIndex: startSpan.index,
      endKeyframeIndex: endSpan.index,
      endExclusive: startSpan.endExclusive,
      duration: startSpan.duration,
      requestedFrameIsInterior: requestedFrame > startSpan.index && requestedFrame < endSpan.index,
      startSourceAddress: mapSource(startSpan.index),
      endSourceAddress: mapSource(endSpan.index),
      start: startRecord,
      end: endRecord,
    },
    gatePredicates: predicates,
    decisiveFailPredicates: failPredicates,
    manuallyEvaluatedPairGateWouldPass: failPredicates.length === 0,
    keyMode9728: {
      presentOnStart: startRecord.frameAttributes.keyMode === '9728',
      presentOnEnd: endRecord.frameAttributes.keyMode === '9728',
      rootTimelineOccurrences: keyMode9728InRoot,
      wholeArchiveOccurrences: walkKeyMode9728All,
      currentInterpolatorConsumesKeyMode: false,
      currentAdapterChecksKeyModeAsGateMetadata: true,
      currentExpectedStartKeyMode: '22017',
      currentExpectedNonMotionEndKeyMode: '15872',
    },
    fullEndpointMetadataCensus: {
      motionObjectOrPathTags: [...allTagNames].filter((name) =>
        ['motionobject', 'motionpath', 'motionobjectxml'].includes(name)),
      easingTags: [...allTagNames].filter((name) => ['ease', 'customease'].includes(name)),
      rotationOrOrientAttributes: [...allAttributeNames].filter((name) =>
        ['orienttopath', 'rotate', 'rotatedirection', 'rotatetimes', 'rotationdirection', 'rotationtimes', 'motiontweenrotate'].includes(name)),
      colorTransformTagsOrAttributes: [...allMetadataNames].filter((name) => /colortransform|coloreffect/u.test(name)),
      blendOrFilterTagsOrAttributes: [...allMetadataNames].filter((name) => /filter|blendmode/u.test(name)),
      shapeTweenTagsOrAttributes: [...allMetadataNames].filter((name) => /shapetween|domshapetween/u.test(name)),
      scriptElementsInSource: scriptElements.map((element) => ({ name: element.name, attributes: element.attributes })),
      unsupportedDetectorRelevantNames: unsupportedNames,
      unknownEndpointTags: [...allTagNames].filter((name) => ![
        'domframe', 'elements', 'domsymbolinstance', 'matrix', 'transformationpoint', 'point',
      ].includes(name)),
    },
    productionEndpointParse: { start: startEndpoint, end: endEndpoint },
    interpolationCheckpoints: interpolation,
  };
}

function acceptedControlAudit(loaded) {
  const descriptor = rootDescriptor(loaded);
  const { getDirectChildren } = loaded;
  const rawLayers = layersForTimeline(getDirectChildren, descriptor.timelineXml);
  const durations = [2, 3, 5, 6, 14];
  const controls = [];
  for (const duration of durations) {
    let selected = null;
    for (let layerIndex = 0; layerIndex < descriptor.frameSpanIndex.layers.length && !selected; layerIndex += 1) {
      const layer = descriptor.frameSpanIndex.layers[layerIndex];
      if (!layer.visible) continue;
      for (const span of layer.spans) {
        if (span.tweenType !== 'motion' || span.duration !== duration) continue;
        const endSpan = layer.spans.find((candidate) => candidate.index === span.endExclusive);
        if (!endSpan) continue;
        const startElements = frameElements(getDirectChildren, span.sourceFrame);
        const endElements = frameElements(getDirectChildren, endSpan.sourceFrame);
        if (startElements.length !== 1 || endElements.length !== 1 ||
            startElements[0]?.name !== 'DOMSymbolInstance' || endElements[0]?.name !== 'DOMSymbolInstance') continue;
        selected = { layerIndex, span, endSpan, startElements, endElements };
        break;
      }
    }
    assert.ok(selected, `no accepted #713 representative span found for duration ${duration}`);
    const interiorFrame = selected.span.index + 1;
    const productionInterior = loaded.source.buildGraphicFrameContext(
      descriptor.timelineXml,
      descriptor.frameSpanIndex,
      interiorFrame,
      `issue727-713-control:${duration}@${interiorFrame}`,
    );
    const start = frameEndpoint(getDirectChildren, selected.span.sourceFrame);
    const end = frameEndpoint(getDirectChildren, selected.endSpan.sourceFrame);
    const startEndpoint = findEndpointProductionSymbol(loaded.source, descriptor, selected.span.index,
      selected.layerIndex, selected.startElements[0].attributes.libraryItemName);
    const endEndpoint = findEndpointProductionSymbol(loaded.source, descriptor, selected.endSpan.index,
      selected.layerIndex, selected.endElements[0].attributes.libraryItemName);
    const predicates = buildPredicateTable(selected.span, selected.endSpan, start, end, startEndpoint, endEndpoint);
    controls.push({
      duration,
      layerIndex: selected.layerIndex,
      layerName: rawLayers[selected.layerIndex]?.attributes.name ?? null,
      startIndex: selected.span.index,
      endIndex: selected.endSpan.index,
      startFrameAttributes: start.frameAttributes,
      endFrameAttributes: end.frameAttributes,
      startInstanceAttributes: start.target?.attributes ?? null,
      endInstanceAttributes: end.target?.attributes ?? null,
      startMatrix: startEndpoint.localTransform,
      endMatrix: endEndpoint.localTransform,
      unsupportedMetadataStart: start.unsupportedMotionMetadata,
      unsupportedMetadataEnd: end.unsupportedMotionMetadata,
      endpointIdentityMatches: start.target?.attributes.libraryItemName === end.target?.attributes.libraryItemName,
      endpointMatricesParse: Boolean(startEndpoint.localTransform && endEndpoint.localTransform),
      manualPairGatePass: predicates.every((predicate) => predicate.pass),
      productionInteriorBuildPass: productionInterior.ok,
      productionInteriorFailure: productionInterior.ok ? null : productionInterior.message,
    });
  }
  return {
    fixture: {
      path: loaded.sourcePath,
      sha256Before: loaded.sha256Before,
      rootLibraryItemName: descriptor.sourceLibraryItemName,
      frameCount: descriptor.frameCount,
    },
    keyMode9728WholeArchive: allKeyMode9728Locations(loaded),
    controls,
  };
}

async function oneRun(args) {
  const walkLoaded = await loadProductionSource(args.walkSource, args.walkSha256);
  const walkRoot = rootDescriptor(walkLoaded);
  const walkFailure = walkLoaded.source.buildGraphicFrameContext(
    walkRoot.timelineXml,
    walkRoot.frameSpanIndex,
    1,
    `issue726-n0-baseline:${walkRoot.sourceLibraryItemName}@1`,
  );
  assert.equal(walkFailure.ok, false, 'the current baseline unexpectedly resolved F1');
  const f1Audit = spanAudit(walkLoaded, walkRoot, 1, walkFailure.message);

  const controlLoaded = await loadProductionSource(args.controlSource, args.controlSha256);
  const controls = acceptedControlAudit(controlLoaded);

  const walkSha256After = HASH(await fs.promises.readFile(args.walkSource));
  const controlSha256After = HASH(await fs.promises.readFile(args.controlSource));
  assert.equal(walkSha256After, walkLoaded.sha256Before, '向右走.fla was modified during forensic census');
  assert.equal(controlSha256After, controlLoaded.sha256Before, '人物倒地.fla was modified during control census');
  return {
    schemaVersion: 'issue727-f1-motion-gate-forensics/1',
    baseline: '608db0240e3170c9981c21ae60579ad6eca15da3',
    sourceAdapterPath: 'src/main/services/fla-static-snapshot-display-list-adapter.ts',
    currentGateConstants: {
      allowedFrameAttributes: [...FRAME_ATTRIBUTES],
      acceptedSpanDurations: [...SPAN_DURATIONS],
      allowedInstanceAttributes: [...INSTANCE_ATTRIBUTES],
      unsupportedMetadataTags: [...UNSUPPORTED_TAGS],
      unsupportedMetadataAttributes: [...UNSUPPORTED_ATTRIBUTES],
    },
    realF1: f1Audit,
    acceptedIssue713Controls: controls,
    sourceSha256After: { walkRight: walkSha256After, acceptedControl: controlSha256After },
    productionCodeChanges: 'NONE',
    sourceMutation: 'NO',
  };
}

function classify(report) {
  const f1 = report.realF1;
  if (!f1.root.timelineEntry || !f1.exactSpan.start || !f1.exactSpan.end ||
      !f1.productionEndpointParse?.start || !f1.productionEndpointParse?.end ||
      !f1.exactSpan.startSourceAddress?.sourceAddress || !f1.exactSpan.endSourceAddress?.sourceAddress) {
    return 'DESCRIPTOR_OR_IDENTITY_UNRESOLVED';
  }
  const failNames = new Set(f1.decisiveFailPredicates);
  const semanticFail = f1.exactSpan.start.unsupportedMotionMetadata.detected ||
    f1.exactSpan.end.unsupportedMotionMetadata.detected ||
    failNames.has('endpoint instance attributes match except selected/centerPoint3D') ||
    failNames.has('endpoint symbol/library identity matches') ||
    failNames.has('both endpoint symbolType values are explicit graphic') ||
    failNames.has('matrix and transformationPoint endpoint structures are supported') ||
    !f1.interpolationCheckpoints.every((checkpoint) => checkpoint.result.ok);
  if (semanticFail) return 'DIFFERENT_MOTION_SEMANTICS';
  const durationFail = failNames.has('span duration belongs to accepted set {2,3,5,6,14}');
  const keyModeFail = failNames.has('start keyMode is 22017') ||
    failNames.has('end motionTweenSnap/keyMode matches its outgoing-state family');
  const otherFails = [...failNames].filter((name) =>
    name !== 'span duration belongs to accepted set {2,3,5,6,14}' &&
    name !== 'start keyMode is 22017' &&
    name !== 'end motionTweenSnap/keyMode matches its outgoing-state family');
  if (durationFail && keyModeFail && otherFails.length === 0) return 'BOUNDED_EXTENSION_CANDIDATE_WITH_KEYMODE';
  if (durationFail && !keyModeFail && otherFails.length === 0) return 'SAME_TRANSFORM_ONLY_FAMILY_DURATION_ONLY';
  if (keyModeFail && otherFails.length === 0) return 'BOUNDED_EXTENSION_CANDIDATE_WITH_KEYMODE';
  if (otherFails.length > 0) return 'DIFFERENT_MOTION_SEMANTICS';
  return 'SAME_TRANSFORM_ONLY_FAMILY_DURATION_ONLY';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalNewDirectory(args.out);
  const first = await oneRun(args);
  const second = await oneRun(args);
  const deterministicRepeat = JSON.stringify(first) === JSON.stringify(second);
  assert.equal(deterministicRepeat, true, 'consecutive forensic censuses differ structurally');
  const classification = classify(first);
  const report = {
    ...first,
    repeat: {
      count: 2,
      deterministic: deterministicRepeat,
      firstRunSha256: HASH(Buffer.from(JSON.stringify(first), 'utf8')),
      secondRunSha256: HASH(Buffer.from(JSON.stringify(second), 'utf8')),
    },
    classification,
    nextSingleAction: classification === 'SAME_TRANSFORM_ONLY_FAMILY_DURATION_ONLY'
      ? 'Open a separately scoped duration-29 implementation issue; this research issue does not authorize production changes.'
      : classification === 'BOUNDED_EXTENSION_CANDIDATE_WITH_KEYMODE'
        ? 'Resolve the exact keyMode distinction with bounded source/serializer evidence before any implementation.'
        : classification === 'DIFFERENT_MOTION_SEMANTICS'
          ? 'Keep duration 29 outside the allowlist and scope a separate semantic research path.'
          : 'Resolve the exact source span or production descriptor mapping before drawing a semantic conclusion.',
  };
  await fs.promises.mkdir(args.out, { recursive: false });
  await fs.promises.writeFile(path.join(args.out, 'issue727-f1-motion-gate-forensics.json'),
    JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const receipt = [
    'Issue: Stage B5-P F1 Root Motion Forensic Investigation',
    'parent implementation: #726',
    'roadmap parent: #715',
    'accepted control: #713',
    'mother PR: #677',
    `baseline: ${report.baseline}`,
    '',
    'fixture: ' + report.realF1.fixture.path,
    'SHA before: ' + report.realF1.fixture.sha256Before,
    'SHA after:  ' + report.sourceSha256After.walkRight,
    'accepted control SHA before: ' + report.acceptedIssue713Controls.fixture.sha256Before,
    'accepted control SHA after:  ' + report.sourceSha256After.acceptedControl,
    '',
    'R0 exact span:',
    'timeline/library item: ' + report.realF1.root.libraryItemName,
    'source entry: ' + report.realF1.root.timelineEntry,
    'layer: ' + report.realF1.exactSpan.layerIndex + ' (' + report.realF1.exactSpan.layerName + ')',
    'requested frame: F' + report.realF1.root.requestedFrame,
    'span start: F' + report.realF1.exactSpan.startIndex,
    'end keyframe: F' + report.realF1.exactSpan.endKeyframeIndex,
    'duration: ' + report.realF1.exactSpan.duration,
    'start sourceAddress: ' + (report.realF1.exactSpan.startSourceAddress.sourceAddress ?? 'UNAVAILABLE'),
    'end sourceAddress: ' + (report.realF1.exactSpan.endSourceAddress.sourceAddress ?? 'UNAVAILABLE'),
    '',
    'R1 decisive fail predicates: ' + JSON.stringify(report.realF1.decisiveFailPredicates),
    'R3 control gate/interior results: ' + JSON.stringify(report.acceptedIssue713Controls.controls.map((control) => ({
      duration: control.duration,
      layerIndex: control.layerIndex,
      startKeyMode: control.startFrameAttributes.keyMode,
      endKeyMode: control.endFrameAttributes.keyMode,
      manualPairGatePass: control.manualPairGatePass,
      productionInteriorBuildPass: control.productionInteriorBuildPass,
    }))),
    'R4 keyMode9728 in failing pair: ' + JSON.stringify(report.realF1.keyMode9728),
    'R5 classification: ' + classification,
    'R6 checkpoint interpolation: ' + JSON.stringify(report.realF1.interpolationCheckpoints),
    'deterministic repeat: ' + (deterministicRepeat ? 'PASS (2 complete censuses)' : 'FAIL'),
    'production files changed: NO',
    'source mutation: NO',
    'Full CI manually triggered: NO',
    'PR #677 remains Draft: YES',
    'next single action: ' + report.nextSingleAction,
  ].join('\n') + '\n';
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receipt, { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    classification,
    deterministicRepeat,
    root: report.realF1.root,
    span: {
      layerIndex: report.realF1.exactSpan.layerIndex,
      layerName: report.realF1.exactSpan.layerName,
      startIndex: report.realF1.exactSpan.startIndex,
      endKeyframeIndex: report.realF1.exactSpan.endKeyframeIndex,
      duration: report.realF1.exactSpan.duration,
    },
    startAttributes: report.realF1.exactSpan.start.frameAttributes,
    endAttributes: report.realF1.exactSpan.end.frameAttributes,
    startInstance: report.realF1.exactSpan.start.target,
    endInstance: report.realF1.exactSpan.end.target,
    decisiveFailPredicates: report.realF1.decisiveFailPredicates,
    keyMode9728: {
      presentOnStart: report.realF1.keyMode9728.presentOnStart,
      presentOnEnd: report.realF1.keyMode9728.presentOnEnd,
      rootTimelineOccurrences: report.realF1.keyMode9728.rootTimelineOccurrences,
      wholeArchiveOccurrenceCount: report.realF1.keyMode9728.wholeArchiveOccurrences.length,
      controlArchiveOccurrenceCount: report.acceptedIssue713Controls.keyMode9728WholeArchive.length,
      currentInterpolatorConsumesKeyMode: report.realF1.keyMode9728.currentInterpolatorConsumesKeyMode,
    },
    controls: report.acceptedIssue713Controls.controls.map((control) => ({
      duration: control.duration,
      layerIndex: control.layerIndex,
      startKeyMode: control.startFrameAttributes.keyMode,
      endKeyMode: control.endFrameAttributes.keyMode,
      manualPairGatePass: control.manualPairGatePass,
      productionInteriorBuildPass: control.productionInteriorBuildPass,
    })),
    checkpoints: report.realF1.interpolationCheckpoints,
    nextSingleAction: report.nextSingleAction,
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
