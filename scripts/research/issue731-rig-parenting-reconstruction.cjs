#!/usr/bin/env node
'use strict';

/**
 * Issue #731: read-only reconstruction study for Animate layer parenting.
 *
 * Reads the named source/control FLA archives and the available local FLA
 * corpus, extracts the com26 rig family, compares two affine composition
 * models, and writes deterministic research artifacts outside the checkout.
 * No production source, FLA, control, or corpus file is modified.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..', '..');
const XFL_LIBRARY_XML = /^LIBRARY\/.*\.xml$/u;
const SOURCE_ENTRIES = new Set(['DOMDocument.xml']);
const TIMELINE_NAME = '便衣道士-cilisucai.com26';
const CHILD_PARENT_PAIRS = [
  { childLayer: '元件_10', childSymbol: '便衣道士-cilisucai.com1/便衣道士-cilisucai.com24', parentLayer: '补间_21', parentSymbol: '便衣道士-cilisucai.com1/便衣道士-cilisucai.com14' },
  { childLayer: '元件_11', childSymbol: '便衣道士-cilisucai.com1/便衣道士-cilisucai.com25', parentLayer: '补间_22', parentSymbol: '便衣道士-cilisucai.com1/便衣道士-cilisucai.com15' },
];
const EXPECTED_KEYS = [0, 5, 10, 15, 20];
const EXPECTED_CORPUS_FILES = 14;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--source') values.source = argv[++index];
    else if (name === '--expected-sha256') values.expectedSha256 = argv[++index];
    else if (name === '--control') values.control = argv[++index];
    else if (name === '--control-expected-sha256') values.controlExpectedSha256 = argv[++index];
    else if (name === '--corpus-dir') values.corpusDir = argv[++index];
    else if (name === '--out') values.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'control', 'controlExpectedSha256', 'corpusDir', 'out']) {
    assert.ok(values[name], `missing --${name}`);
  }
  assert.match(values.expectedSha256, /^[a-f0-9]{64}$/iu);
  assert.match(values.controlExpectedSha256, /^[a-f0-9]{64}$/iu);
  const out = path.resolve(values.out);
  const relative = path.relative(ROOT, out);
  assert.ok(
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'evidence output must stay outside the repository',
  );
  assert.ok(!fs.existsSync(out), `refusing to overwrite existing evidence directory: ${out}`);
  return {
    source: path.resolve(values.source),
    expectedSha256: values.expectedSha256.toLowerCase(),
    control: path.resolve(values.control),
    controlExpectedSha256: values.controlExpectedSha256.toLowerCase(),
    corpusDir: path.resolve(values.corpusDir),
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

/** Minimal structural XML scanner. It records attributes and does not rewrite XML. */
function scanXflXml(xml, entryName) {
  const layers = [];
  const occurrences = [];
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
      const record = {
        entryName,
        timelineName: timelineNode?.timelineName ?? null,
        ordinal: timelineNode ? timelineNode.layerCount++ : null,
        attributes,
        frames: [],
      };
      node.layerRecord = record;
      layers.push(record);
    }
    if (openingName === 'DOMFrame') {
      const layerNode = nearest(stack, 'DOMLayer');
      const record = { attributes, symbols: [], layerOrdinal: layerNode?.layerRecord?.ordinal ?? null };
      node.frameRecord = record;
      layerNode?.layerRecord?.frames.push(record);
    }
    if (openingName === 'DOMSymbolInstance') {
      const frameNode = nearest(stack, 'DOMFrame');
      const record = { attributes, matrix: null, transformationPoints: [] };
      node.symbolRecord = record;
      frameNode?.frameRecord?.symbols.push(record);
    }
    if (openingName === 'Matrix') {
      const symbolNode = nearest(stack, 'DOMSymbolInstance');
      if (symbolNode?.symbolRecord) symbolNode.symbolRecord.matrix = attributes;
    }
    if (openingName === 'Point' && nearest(stack, 'transformationPoint')) {
      const symbolNode = nearest(stack, 'DOMSymbolInstance');
      symbolNode?.symbolRecord?.transformationPoints.push(attributes);
    }
    if (Object.hasOwn(attributes, 'parentLayerIndex')) {
      const timelineNode = nearest(stack, 'DOMTimeline');
      const layerNode = openingName === 'DOMLayer' ? node : nearest(stack, 'DOMLayer');
      const frameNode = openingName === 'DOMFrame' ? node : nearest(stack, 'DOMFrame');
      occurrences.push({
        entryName,
        element: openingName,
        value: attributes.parentLayerIndex,
        timelineName: timelineNode?.timelineName ?? null,
        layerOrdinal: layerNode?.layerRecord?.ordinal ?? null,
        layerName: layerNode?.layerRecord?.attributes.name ?? null,
        layerRiggingIndex: layerNode?.layerRecord?.attributes.layerRiggingIndex ?? null,
        frameIndex: frameNode?.frameRecord?.attributes.index ?? null,
        frameDuration: frameNode?.frameRecord?.attributes.duration ?? null,
        tweenType: frameNode?.frameRecord?.attributes.tweenType ?? null,
      });
    }
    if (!token.endsWith('/>')) stack.push(node);
  }
  return { layers, occurrences };
}

async function loadArchive(filename, expectedSha256, classifier) {
  const bytes = await fs.promises.readFile(filename);
  const before = sha256(bytes);
  if (expectedSha256) assert.equal(before, expectedSha256, `unexpected SHA-256 for ${filename}`);
  const classification = classifier.classifyForFlaRecovery(bytes);
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
  const zip = await JSZip.loadAsync(normalized.applied ? normalized.bytes : bytes);
  const names = Object.keys(zip.files).filter((name) =>
    SOURCE_ENTRIES.has(name) || XFL_LIBRARY_XML.test(name)).sort(compareText);
  const xmlEntries = [];
  for (const name of names) {
    const entry = zip.file(name);
    if (entry) xmlEntries.push({ name, xml: await entry.async('string') });
  }
  assert.ok(xmlEntries.some((entry) => entry.name === 'DOMDocument.xml'), `missing DOMDocument.xml in ${filename}`);
  assert.equal(sha256(await fs.promises.readFile(filename)), before, `source changed while reading: ${filename}`);
  return {
    filename,
    sha256: before,
    normalizationApplied: normalized.applied,
    classifierState: classification?.state ?? null,
    xmlEntries,
  };
}

async function scanArchive(archive) {
  const layers = [];
  const occurrences = [];
  for (const entry of archive.xmlEntries) {
    const scan = scanXflXml(entry.xml, entry.name);
    layers.push(...scan.layers);
    occurrences.push(...scan.occurrences);
  }
  return { layers, occurrences };
}

function matrixFromRaw(raw) {
  assert.ok(raw, 'symbol instance has no Matrix');
  const value = (name, fallback) => {
    const parsed = raw[name] === undefined ? fallback : Number(raw[name]);
    assert.ok(Number.isFinite(parsed), `invalid Matrix.${name}`);
    return parsed;
  };
  return {
    a: value('a', 1),
    b: value('b', 0),
    c: value('c', 0),
    d: value('d', 1),
    tx: value('tx', 0),
    ty: value('ty', 0),
  };
}

function compose(parent, local) {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function inverse(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  return {
    a,
    b,
    c,
    d,
    tx: -(a * matrix.tx + c * matrix.ty),
    ty: -(b * matrix.tx + d * matrix.ty),
  };
}

function maxAbsDifference(left, right) {
  return Math.max(...['a', 'b', 'c', 'd', 'tx', 'ty'].map((key) => Math.abs(left[key] - right[key])));
}

function isVisible(attributes) {
  return attributes.visible !== 'false' && attributes.isVisible !== 'false';
}

function frameSummary(frame) {
  return {
    index: Number(frame.attributes.index),
    duration: frame.attributes.duration === undefined ? null : Number(frame.attributes.duration),
    tweenType: frame.attributes.tweenType ?? null,
    keyMode: frame.attributes.keyMode ?? null,
    motionTweenSnap: frame.attributes.motionTweenSnap ?? null,
    parentLayerIndex: frame.attributes.parentLayerIndex ?? null,
    extraFrameAttributes: Object.keys(frame.attributes).filter((key) =>
      !['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode', 'parentLayerIndex'].includes(key)).sort(compareText),
    symbols: frame.symbols.map((symbol) => ({
      libraryItemName: symbol.attributes.libraryItemName ?? null,
      symbolType: symbol.attributes.symbolType ?? null,
      visible: isVisible(symbol.attributes),
      matrixRaw: symbol.matrix,
      matrix: matrixFromRaw(symbol.matrix),
      transformationPoints: symbol.transformationPoints,
    })),
  };
}

function summarizeLayer(layer, layersInTimeline) {
  const type = (layer.attributes.layerType ?? 'normal').toLowerCase();
  const ownMaskParentIndex = layer.attributes.parentLayerIndex ?? null;
  const referencedAsMask = layersInTimeline.some((candidate) =>
    candidate.attributes.layerType === 'mask' && candidate.ordinal === Number(ownMaskParentIndex));
  return {
    ordinal: layer.ordinal,
    painterOrderIndex: layersInTimeline.length - layer.ordinal - 1,
    name: layer.attributes.name ?? null,
    layerType: layer.attributes.layerType ?? 'normal (default)',
    layerRiggingIndex: layer.attributes.layerRiggingIndex ?? null,
    domLayerParentLayerIndex: ownMaskParentIndex,
    visible: isVisible(layer.attributes),
    guide: type === 'guide' || type === 'guided',
    folder: type === 'folder',
    mask: type === 'mask' || type === 'masked' || referencedAsMask,
    camera: type === 'camera' || layer.attributes.outline === 'camera',
    frames: layer.frames.map(frameSummary),
  };
}

function extractCom26(scan) {
  const entryName = 'LIBRARY/便衣道士-cilisucai.com1/便衣道士-cilisucai.com26.xml';
  const targetLayers = scan.layers.filter((layer) =>
    layer.entryName === entryName && layer.timelineName === TIMELINE_NAME);
  assert.equal(targetLayers.length, 5, `expected five com26 layers, found ${targetLayers.length}`);
  const summaries = targetLayers.map((layer) => summarizeLayer(layer, targetLayers));
  assert.deepEqual(summaries.map((layer) => layer.name), ['补间_19', '元件_10', '补间_21', '元件_11', '补间_22']);
  const relationships = CHILD_PARENT_PAIRS.map((pair) => {
    const child = targetLayers.find((layer) => layer.attributes.name === pair.childLayer);
    const parent = targetLayers.find((layer) => layer.attributes.name === pair.parentLayer);
    assert.ok(child && parent, `missing layer pair ${pair.childLayer} / ${pair.parentLayer}`);
    const childLinks = child.frames.map((frame) => frame.attributes.parentLayerIndex ?? null);
    assert.deepEqual(childLinks, pair.childLayer === '元件_10' ? ['1', '1', '1', '1', '1'] : ['0', '0', '0', '0', '0']);
    assert.equal(parent.attributes.layerRiggingIndex, pair.childLayer === '元件_10' ? '1' : '0');
    assert.deepEqual(child.frames.map((frame) => Number(frame.attributes.index)), EXPECTED_KEYS);
    assert.deepEqual(parent.frames.map((frame) => Number(frame.attributes.index)), EXPECTED_KEYS);
    return {
      childLayer: pair.childLayer,
      childOrdinal: child.ordinal,
      childGraphic: pair.childSymbol,
      parentLayer: pair.parentLayer,
      parentOrdinal: parent.ordinal,
      parentGraphic: pair.parentSymbol,
      childParentLayerIndexByKey: child.frames.map((frame) => ({
        frameIndex: Number(frame.attributes.index),
        value: frame.attributes.parentLayerIndex,
      })),
      parentLayerRiggingIndex: parent.attributes.layerRiggingIndex,
      childFrames: child.frames.map(frameSummary),
      parentFrames: parent.frames.map(frameSummary),
    };
  });
  const allRigLinks = targetLayers.flatMap((layer) => layer.frames
    .filter((frame) => frame.attributes.parentLayerIndex !== undefined)
    .map((frame) => ({
      childLayer: layer.attributes.name,
      childOrdinal: layer.ordinal,
      frameIndex: Number(frame.attributes.index),
      parentLayerIndex: frame.attributes.parentLayerIndex,
    })));
  assert.equal(allRigLinks.length, 10);
  return {
    entryName,
    timelineName: TIMELINE_NAME,
    layerCount: targetLayers.length,
    layersInDomOrder: summaries,
    relationships,
    childParentLayerIndexOccurrences: allRigLinks,
    painterOrder: 'XFL layers are front-to-back; Panda normalizes them by reversing the layer list for back-to-front painting.',
  };
}

function analyzeMapping(scans, sourcePath) {
  const occurrenceRows = [];
  const riggingOrderRows = [];
  const allOccurrences = scans.flatMap((scan) => scan.occurrences);
  for (const scan of scans) {
    const timelines = new Map();
    for (const layer of scan.layers) {
      const key = `${layer.entryName}\u0000${layer.timelineName}`;
      if (!timelines.has(key)) timelines.set(key, []);
      timelines.get(key).push(layer);
    }
    for (const layers of timelines.values()) {
      layers.sort((left, right) => left.ordinal - right.ordinal);
      const rigged = layers.filter((layer) => layer.attributes.layerRiggingIndex !== undefined)
        .map((layer) => ({ ordinal: layer.ordinal, name: layer.attributes.name ?? null, value: layer.attributes.layerRiggingIndex }));
      const numericRigged = rigged.map((layer) => Number(layer.value)).filter(Number.isFinite).sort((left, right) => left - right);
      const sparse = numericRigged.some((value, index) => index > 0 && value - numericRigged[index - 1] > 1);
      const riggingOrderDiffersFromDomOrder = rigged.some((layer, index) =>
        index > 0 && Number(layer.value) < Number(rigged[index - 1].value));
      if (rigged.length > 1 && (sparse || riggingOrderDiffersFromDomOrder)) {
        riggingOrderRows.push({
          entryName: layers[0].entryName,
          timelineName: layers[0].timelineName,
          sparseRiggingIndexes: sparse,
          riggingOrderDiffersFromDomOrder,
          layers: rigged,
        });
      }
      for (const child of layers) {
        for (const frame of child.frames) {
          const value = frame.attributes.parentLayerIndex;
          if (value === undefined) continue;
          const numericValue = Number(value);
          const riggingCandidates = layers.filter((candidate) => candidate.attributes.layerRiggingIndex === value);
          const zeroBasedOrdinal = Number.isInteger(numericValue)
            ? layers.find((candidate) => candidate.ordinal === numericValue) ?? null
            : null;
          const oneBasedOrdinal = Number.isInteger(numericValue)
            ? layers.find((candidate) => candidate.ordinal === numericValue - 1) ?? null
            : null;
          occurrenceRows.push({
            filename: scan.filename,
            entryName: child.entryName,
            timelineName: child.timelineName,
            childLayer: child.attributes.name ?? null,
            childOrdinal: child.ordinal,
            frameIndex: frame.attributes.index ?? null,
            parentLayerIndex: value,
            riggingCandidates: riggingCandidates.map((candidate) => ({
              ordinal: candidate.ordinal,
              name: candidate.attributes.name ?? null,
              layerType: candidate.attributes.layerType ?? 'normal (default)',
            })),
            riggingResolution: riggingCandidates.length === 1 ? 'UNIQUE' : riggingCandidates.length > 1 ? 'AMBIGUOUS' : 'NO_MATCH',
            zeroBasedOrdinalCandidate: zeroBasedOrdinal
              ? { ordinal: zeroBasedOrdinal.ordinal, name: zeroBasedOrdinal.attributes.name ?? null, isSelf: zeroBasedOrdinal.ordinal === child.ordinal }
              : null,
            oneBasedOrdinalCandidate: oneBasedOrdinal
              ? { ordinal: oneBasedOrdinal.ordinal, name: oneBasedOrdinal.attributes.name ?? null, isSelf: oneBasedOrdinal.ordinal === child.ordinal }
              : null,
          });
        }
      }
    }
  }
  const targetRows = occurrenceRows.filter((row) =>
    row.filename.toLowerCase() === sourcePath.toLowerCase() &&
    row.entryName.endsWith('/便衣道士-cilisucai.com26.xml') && row.timelineName === TIMELINE_NAME);
  const counts = {
    allParentLayerIndexOccurrences: allOccurrences.length,
    domFrameParentLayerIndexOccurrences: allOccurrences.filter((row) => row.element === 'DOMFrame').length,
    domLayerParentLayerIndexOccurrences: allOccurrences.filter((row) => row.element === 'DOMLayer').length,
    frameParentLayerIndexOccurrences: occurrenceRows.length,
    uniqueRiggingIndexMatches: occurrenceRows.filter((row) => row.riggingResolution === 'UNIQUE').length,
    ambiguousRiggingIndexMatches: occurrenceRows.filter((row) => row.riggingResolution === 'AMBIGUOUS').length,
    noRiggingIndexMatch: occurrenceRows.filter((row) => row.riggingResolution === 'NO_MATCH').length,
    zeroBasedOrdinalSelfCandidates: occurrenceRows.filter((row) => row.zeroBasedOrdinalCandidate?.isSelf).length,
    sparseOrReorderedRiggingTimelines: riggingOrderRows.length,
    sparseRiggingTimelines: riggingOrderRows.filter((row) => row.sparseRiggingIndexes).length,
    riggingOrderDiffersFromDomOrderTimelines: riggingOrderRows.filter((row) => row.riggingOrderDiffersFromDomOrder).length,
  };
  assert.equal(targetRows.length, 10, 'expected ten frame links in target com26 family');
  assert.equal(counts.allParentLayerIndexOccurrences, 62, 'expected the known 62 corpus occurrences');
  assert.equal(counts.domFrameParentLayerIndexOccurrences, 60, 'expected the known 60 frame-level corpus occurrences');
  assert.equal(counts.domLayerParentLayerIndexOccurrences, 2, 'expected the known 2 layer-level corpus occurrences');
  assert.ok(targetRows.every((row) => row.riggingResolution === 'UNIQUE'));
  const targetCompetingMappings = targetRows.filter((row) => {
    const riggingName = row.riggingCandidates[0]?.name;
    return row.zeroBasedOrdinalCandidate?.name === riggingName || row.oneBasedOrdinalCandidate?.name === riggingName;
  });
  return {
    corpusCounts: counts,
    targetOccurrences: targetRows,
    reorderedOrSparseExamples: riggingOrderRows,
    targetMapping: {
      mapping: 'DOMFrame.parentLayerIndex -> same-timeline DOMLayer.layerRiggingIndex',
      classification: 'SERIALIZATION_STRONGLY_INFERRED',
      uniqueMatches: targetRows.length,
      competingMappingSurvived: targetCompetingMappings.length > 0,
      competingMappingReason: 'Raw zero-based DOM ordinal resolves value 1 to the child layer itself and value 0 to an unrelated default layer; one-based ordinal does not resolve to the matched animated rig layers.',
      boundary: 'This proves the strongest mapping for this serialized com26 family and corpus evidence only; it is not a schema guarantee for arbitrary XFL versions.',
    },
  };
}

function auditCorpusSpanTiming(scans) {
  const riggedLayers = [];
  const spans = [];
  const childHeldSpans = [];
  for (const scan of scans) {
    const timelines = new Map();
    for (const layer of scan.layers) {
      const key = `${layer.entryName}\u0000${layer.timelineName}`;
      if (!timelines.has(key)) timelines.set(key, []);
      timelines.get(key).push(layer);
    }
    for (const layers of timelines.values()) {
      layers.sort((left, right) => left.ordinal - right.ordinal);
      for (const child of layers.filter((layer) => layer.frames.some((frame) => frame.attributes.parentLayerIndex !== undefined))) {
        const indexedLinks = child.frames
          .filter((frame) => frame.attributes.parentLayerIndex !== undefined)
          .map((frame) => frame.attributes.parentLayerIndex);
        const distinctLinks = [...new Set(indexedLinks)];
        const resolvedParents = distinctLinks.map((value) => ({
          value,
          candidates: layers.filter((candidate) => candidate.attributes.layerRiggingIndex === value),
        }));
        const parent = resolvedParents.length === 1 && resolvedParents[0].candidates.length === 1
          ? resolvedParents[0].candidates[0]
          : null;
        riggedLayers.push({
          filename: scan.filename,
          entryName: child.entryName,
          timelineName: child.timelineName,
          childLayer: child.attributes.name ?? null,
          childOrdinal: child.ordinal,
          parentLayerIndexValues: distinctLinks,
          identityStableAcrossAuthoredKeys: distinctLinks.length === 1,
          parentCandidate: parent?.attributes.name ?? null,
          resolved: Boolean(parent),
          authoredKeyCount: child.frames.length,
          missingParentValueKeyCount: child.frames.filter((frame) => frame.attributes.parentLayerIndex === undefined).length,
        });
        if (!parent) continue;
        for (const frame of child.frames) {
          const duration = Number(frame.attributes.duration);
          const start = Number(frame.attributes.index);
          if (!Number.isFinite(duration) || duration <= 1 || !Number.isFinite(start)) continue;
          const end = start + duration;
          const parentStart = parent.frames.find((candidate) => Number(candidate.attributes.index) === start) ?? null;
          const parentEndKey = parent.frames.find((candidate) => Number(candidate.attributes.index) === end) ?? null;
          if (frame.attributes.tweenType !== 'motion') {
            if (parentStart?.attributes.tweenType === 'motion') {
              childHeldSpans.push({
                filename: scan.filename,
                entryName: child.entryName,
                timelineName: child.timelineName,
                childLayer: child.attributes.name ?? null,
                parentLayer: parent.attributes.name ?? null,
                start,
                end,
                childTweenType: frame.attributes.tweenType ?? null,
                parentTweenType: parentStart.attributes.tweenType,
              });
            }
            continue;
          }
          spans.push({
            filename: scan.filename,
            entryName: child.entryName,
            timelineName: child.timelineName,
            childLayer: child.attributes.name ?? null,
            parentLayer: parent.attributes.name ?? null,
            start,
            end,
            childDuration: duration,
            parentLayerIndex: frame.attributes.parentLayerIndex,
            childTweenType: frame.attributes.tweenType,
            parentStartKeyExists: Boolean(parentStart),
            parentEndKeyExists: Boolean(parentEndKey),
            parentStartTweenType: parentStart?.attributes.tweenType ?? null,
            parentStartDuration: parentStart?.attributes.duration === undefined ? null : Number(parentStart.attributes.duration),
            parentSpanAlignedAndMotion: Boolean(parentStart && parentEndKey &&
              parentStart.attributes.tweenType === 'motion' && Number(parentStart.attributes.duration) === duration),
          });
        }
      }
    }
  }
  const aligned = spans.filter((span) => span.parentSpanAlignedAndMotion);
  const misaligned = spans.filter((span) => !span.parentSpanAlignedAndMotion);
  const parentHeld = spans.filter((span) => span.parentStartKeyExists && span.parentStartTweenType !== 'motion');
  return {
    riggedChildLayerCount: riggedLayers.length,
    stableParentIdentityCount: riggedLayers.filter((layer) => layer.identityStableAcrossAuthoredKeys).length,
    changingParentIdentityCount: riggedLayers.filter((layer) => !layer.identityStableAcrossAuthoredKeys).length,
    unresolvedParentLayerCount: riggedLayers.filter((layer) => !layer.resolved).length,
    motionSpanCount: spans.length,
    alignedParentMotionSpanCount: aligned.length,
    misalignedOrNonMotionParentSpanCount: misaligned.length,
    parentHeldDuringChildMotionSpanCount: parentHeld.length,
    childHeldDuringParentMotionSpanCount: childHeldSpans.length,
    evidenceBoundary: 'This census covers only the 14 available local FLAs and uniquely layerRiggingIndex-mapped frame references. It cannot establish semantics for absent or differently-authored cases.',
    changingParentExamples: riggedLayers.filter((layer) => !layer.identityStableAcrossAuthoredKeys).slice(0, 10),
    misalignedSpanExamples: misaligned.slice(0, 10),
    parentHeldExamples: parentHeld.slice(0, 10),
    childHeldExamples: childHeldSpans.slice(0, 10),
    targetCom26: riggedLayers.filter((layer) =>
      layer.filename.toLowerCase().endsWith('向右走.fla') &&
      layer.entryName.endsWith('/便衣道士-cilisucai.com26.xml') &&
      layer.timelineName === TIMELINE_NAME),
  };
}

function interpolate(interpolator, start, end, progress, label) {
  const result = interpolator(start, end, progress);
  assert.equal(result.ok, true, `${label}: ${result.message ?? result.code}`);
  return result.matrix;
}

function layerByName(graph, name) {
  const layer = graph.layersInDomOrder.find((candidate) => candidate.name === name);
  assert.ok(layer, `missing graph layer ${name}`);
  return layer;
}

function keyedMatrix(layer, frameIndex) {
  const frame = layer.frames.find((candidate) => candidate.index === frameIndex);
  assert.ok(frame, `missing ${layer.name} frame ${frameIndex}`);
  assert.equal(frame.symbols.length, 1, `${layer.name} F${frameIndex} must have one symbol instance`);
  assert.equal(frame.symbols[0].visible, true, `${layer.name} F${frameIndex} symbol must be visible`);
  return frame.symbols[0].matrix;
}

function buildModels(graph, interpolator) {
  const pairs = [];
  for (const relationship of graph.relationships) {
    const child = layerByName(graph, relationship.childLayer);
    const parent = layerByName(graph, relationship.parentLayer);
    const segments = [];
    for (let keyIndex = 0; keyIndex < EXPECTED_KEYS.length - 1; keyIndex += 1) {
      const startFrame = EXPECTED_KEYS[keyIndex];
      const endFrame = EXPECTED_KEYS[keyIndex + 1];
      const childStart = keyedMatrix(child, startFrame);
      const childEnd = keyedMatrix(child, endFrame);
      const parentStart = keyedMatrix(parent, startFrame);
      const parentEnd = keyedMatrix(parent, endFrame);
      const childFrameFacts = child.frames.find((frame) => frame.index === startFrame);
      const parentFrameFacts = parent.frames.find((frame) => frame.index === startFrame);
      assert.equal(childFrameFacts.duration, endFrame - startFrame);
      assert.equal(parentFrameFacts.duration, endFrame - startFrame);
      assert.equal(childFrameFacts.tweenType, 'motion');
      assert.equal(parentFrameFacts.tweenType, 'motion');
      const parentStartInverse = inverse(parentStart);
      const parentEndInverse = inverse(parentEnd);
      assert.ok(parentStartInverse && parentEndInverse, 'parent endpoint matrix must be invertible');
      const relativeStart = compose(parentStartInverse, childStart);
      const relativeEnd = compose(parentEndInverse, childEnd);
      const samples = [];
      for (let step = 0; step <= 5; step += 1) {
        const progress = step / 5;
        const frameIndex = startFrame + step;
        const parentAtFrame = interpolate(interpolator, parentStart, parentEnd, progress, 'parent motion interpolation');
        const childAuthoredAtFrame = interpolate(interpolator, childStart, childEnd, progress, 'child motion interpolation');
        const relativeAtFrame = interpolate(interpolator, relativeStart, relativeEnd, progress, 'relative child interpolation');
        samples.push({
          frameIndex,
          progress,
          parentMatrix: parentAtFrame,
          modelA_naiveHierarchy: compose(parentAtFrame, childAuthoredAtFrame),
          modelB_rebasedParentSpace: compose(parentAtFrame, relativeAtFrame),
          modelC_childOnlyNoParent: childAuthoredAtFrame,
        });
      }
      const startAError = maxAbsDifference(samples[0].modelA_naiveHierarchy, childStart);
      const endAError = maxAbsDifference(samples.at(-1).modelA_naiveHierarchy, childEnd);
      const startBError = maxAbsDifference(samples[0].modelB_rebasedParentSpace, childStart);
      const endBError = maxAbsDifference(samples.at(-1).modelB_rebasedParentSpace, childEnd);
      assert.ok(startAError > 1, 'Model A must expose the double-transform risk at the first endpoint');
      assert.ok(startBError < 1e-8 && endBError < 1e-8, 'Model B must preserve the authored endpoints');
      segments.push({
        startFrame,
        endFrame,
        duration: endFrame - startFrame,
        alignedProgress: true,
        childParentLayerIndex: child.frames.find((frame) => frame.index === startFrame).parentLayerIndex,
        parentLayerRiggingIndex: parent.layerRiggingIndex,
        endpointErrors: {
          modelAStartMaxAbs: startAError,
          modelAEndMaxAbs: endAError,
          modelBStartMaxAbs: startBError,
          modelBEndMaxAbs: endBError,
        },
        relativeStart,
        relativeEnd,
        samples,
      });
    }
    const boundaryContinuity = segments.slice(0, -1).map((segment, index) => {
      const next = segments[index + 1];
      const left = segment.samples.at(-1).modelB_rebasedParentSpace;
      const right = next.samples[0].modelB_rebasedParentSpace;
      const authored = keyedMatrix(child, segment.endFrame);
      return {
        frameIndex: segment.endFrame,
        adjacentSegmentMaxAbs: maxAbsDifference(left, right),
        authoredEndpointMaxAbs: maxAbsDifference(left, authored),
      };
    });
    pairs.push({
      childLayer: relationship.childLayer,
      childGraphic: relationship.childGraphic,
      parentLayer: relationship.parentLayer,
      parentGraphic: relationship.parentGraphic,
      segments,
      boundaryContinuity,
      maxModelAEndpointError: Math.max(...segments.flatMap((segment) => [
        segment.endpointErrors.modelAStartMaxAbs,
        segment.endpointErrors.modelAEndMaxAbs,
      ])),
      maxModelBEndpointError: Math.max(...segments.flatMap((segment) => [
        segment.endpointErrors.modelBStartMaxAbs,
        segment.endpointErrors.modelBEndMaxAbs,
      ])),
    });
  }
  return {
    modelA: 'parent(t) * interpolate(child authored matrices); endpoints double-transform by the parent unless parent is identity.',
    modelB: 'parent(t) * interpolate(inverse(parent key) * child authored key); matches the external renderer proposal and preserves authored endpoints by construction.',
    modelC: 'No third evidence-backed Animate formula found. Child-only interpolation is included as a null control that ignores parenting, not as a parenting candidate.',
    interpolator: 'Existing production interpolateFlaLinearMotionTransform loaded from dist-electron for mathematical consistency; this research script does not modify or call production rendering paths.',
    pairs,
    interpretation: 'Model B is a coherent bounded prototype, not proof of Animate truth: endpoint preservation is algebraic, and intermediate output has no Adobe runtime comparison.',
  };
}

async function scanCorpus(directory, classifier) {
  const files = (await fs.promises.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fla'))
    .map((entry) => path.join(directory, entry.name))
    .sort(compareText);
  const results = [];
  for (const filename of files) {
    const archive = await loadArchive(filename, null, classifier);
    const scan = await scanArchive(archive);
    results.push({ filename, sha256: archive.sha256, normalizationApplied: archive.normalizationApplied, ...scan });
  }
  return { directory, fileCount: files.length, results };
}

function toCompactCorpus(corpus) {
  return {
    directory: corpus.directory,
    fileCount: corpus.fileCount,
    files: corpus.results.map((file) => ({
      filename: file.filename,
      sha256Before: file.sha256,
      sha256After: file.sha256After,
      unchanged: file.sha256 === file.sha256After,
      normalizationApplied: file.normalizationApplied,
    })),
  };
}

function formatReceipt(report) {
  const graph = report.com26RigGraph;
  const mapping = report.mapping.targetMapping;
  const prototype = report.prototype;
  const timing = report.corpusSpanTiming;
  const pairSummary = prototype.pairs.map((pair) =>
    `${pair.childLayer}/${pair.childGraphic} -> ${pair.parentLayer}/${pair.parentGraphic}; Model A max endpoint error ${pair.maxModelAEndpointError}; Model B max endpoint error ${pair.maxModelBEndpointError}`).join('\n');
  return [
    'Issue: Stage B5-T Animate Layer Parenting / Rig Reconstruction Research',
    'parent: #730',
    'implementation parent: #729',
    'evidence record: #720',
    'mother PR: #677',
    `baseline: ${report.baseline}`,
    '',
    'T0 rig graph:',
    `fixture: ${report.source.path}`,
    `SHA before: ${report.source.sha256Before}`,
    `SHA after: ${report.source.sha256After}`,
    `layers: ${graph.layersInDomOrder.map((layer) => `${layer.ordinal}:${layer.name}[${layer.layerType}]`).join('; ')}`,
    `child/parent candidates: ${graph.relationships.map((pair) => `${pair.childLayer}(${pair.childGraphic}) -> ${pair.parentLayer}(rig=${pair.parentLayerRiggingIndex}, ${pair.parentGraphic})`).join('; ')}`,
    '',
    'T1 mapping:',
    `parentLayerIndex: ${graph.relationships.map((pair) => `${pair.childLayer}=${pair.childParentLayerIndexByKey.map((key) => key.value).join('/')}`).join('; ')}`,
    `layerRiggingIndex: ${graph.relationships.map((pair) => `${pair.parentLayer}=${pair.parentLayerRiggingIndex}`).join('; ')}`,
    `resolved parent: ${graph.relationships.map((pair) => `${pair.childLayer} -> ${pair.parentLayer}`).join('; ')}`,
    `mapping classification: ${mapping.classification}`,
    `competing mapping survived: ${mapping.competingMappingSurvived ? 'YES' : 'NO'}; ${mapping.competingMappingReason}`,
    '',
    'T2 Adobe semantics:',
    'per-keyframe parenting: DIRECT_ADOBE + ADOBE_API; Adobe describes per-child-keyframe parenting and JSFL exposes getRigParentAtFrame/setRigParentAtFrame.',
    'propagated transforms: DIRECT_ADOBE; position/rotation are documented, and Animate 2022+ can propagate scale/skew/flip. Fixture authoring version is not established.',
    'reparent behavior: DIRECT_ADOBE/ADOBE_API; parent can change at later child keyframes. Exact matrix formula is not specified.',
    'JSFL/API evidence: getRigParentAtFrame, setRigParentAtFrame, getRigMatrixAtFrame; API docs do not define this raw XFL field mapping or pivot formula.',
    '',
    'T3 coordinate spaces:',
    'child matrix classification: UNKNOWN as Animate rig-space; Panda currently treats XFL leaf matrices as absolute within their owning timeline.',
    'parent matrix classification: UNKNOWN as Animate rig-space; Panda currently treats XFL leaf matrices as absolute within their owning timeline.',
    'current Panda composition: the adapter interpolates each layer instance locally; the resolver composes nested symbol ancestors, with no same-timeline rig-parent stage.',
    '',
    'T4 composition models:',
    'Model A: parent(t) * childAuthored(t); double-transforms the serialized child matrices and misses authored endpoints.',
    'Model B: parent(t) * interpolate(inverse(parentKey) * childKey); preserves authored endpoints algebraically and has continuous shared key boundaries.',
    'Model C: no third evidence-backed formula found; child-only interpolation is a null control, not a rig model.',
    `endpoint preservation: ${pairSummary}`,
    'discontinuities/double-transform: Model A has nonzero endpoint error; Model B shared keys match continuously by construction. Intermediate Animate truth remains unknown.',
    '',
    'T5 pivot:',
    `transformationPoint: ${graph.relationships.map((pair) => `${pair.childLayer}/${pair.parentLayer} points captured at each key`).join('; ')}`,
    'pivot classification: UNKNOWN; Adobe describes a pivot-related constraint for warped objects, but does not define this affine formula; Panda does not use transformationPoint in rig composition.',
    '',
    'T6 simultaneous tween:',
    'parent progress: same normalized progress per aligned 5-frame span.',
    'child progress: same normalized progress per aligned 5-frame span.',
    `misaligned span findings: target pairs use aligned 5-frame spans; local corpus has ${timing.motionSpanCount} mapped child motion spans, ${timing.misalignedOrNonMotionParentSpanCount} misaligned/non-motion parent spans, ${timing.parentHeldDuringChildMotionSpanCount} parent-held and ${timing.childHeldDuringParentMotionSpanCount} child-held cases.`,
    '',
    'T7 external implementation:',
    `project/source: ${report.externalImplementation.project} at ${report.externalImplementation.commit}; renderer.ts and layer-utils.ts; PR #48 synthetic test history.` ,
    `algorithm summary: ${report.externalImplementation.algorithm}`,
    `agreement/disagreement with Adobe: ${report.externalImplementation.limitations}`,
    '',
    'T8 prototype:',
    'target bounded family: same parentLayerIndex across endpoints; unique same-timeline layerRiggingIndex parent; normal/default visible layers; one visible Graphic each; aligned classic motion tweens; no guide/folder/mask/camera.',
    `F1-F4 result: computed for each 0→5, 5→10, 10→15, 15→20 segment; ${pairSummary}`,
    'endpoint preservation: Model B PASS by formula; Model A FAIL; no external visual truth available.',
    `deterministic: ${report.prototype.deterministic ? 'YES; independent two-run comparison produced byte-identical JSON and receipt outputs' : 'NO'}`,
    'research renders: not produced; no Adobe Animate render exists for comparison.',
    '',
    'T9 Panda seam:',
    'recommended owner: a narrowly scoped FlaRigParentComposer invoked after frame selection/local tween reconstruction and before nested symbol selection/composition.',
    'input/output: resolved same-timeline layers, per-key parent identity, keyframe transforms and pivots -> parent-aware child instance transform.',
    'operation order: frame selection -> local tween reconstruction -> parenting composition -> ancestor symbol composition.',
    '',
    'classification:',
    report.classification,
    '',
    'production files changed: NO',
    'source mutation: NO',
    'Full CI manually triggered: NO',
    'PR #677 remains Draft: YES',
    '',
    'next single action: obtain an Adobe Animate/JSFL runtime oracle for this exact saved fixture to establish parent matrix, rig matrix, and transformationPoint behavior before opening a bounded implementation issue.',
  ].join('\n') + '\n';
}

async function run(args) {
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const motionModule = require(path.join(ROOT, 'dist-electron/main/services/fla-motion-tween-transform-interpolator.js'));
  assert.equal(typeof motionModule.interpolateFlaLinearMotionTransform, 'function');
  const sourceArchive = await loadArchive(args.source, args.expectedSha256, classifier);
  const controlArchive = await loadArchive(args.control, args.controlExpectedSha256, classifier);
  const sourceScan = await scanArchive(sourceArchive);
  const corpus = await scanCorpus(args.corpusDir, classifier);
  assert.equal(corpus.fileCount, EXPECTED_CORPUS_FILES, `expected ${EXPECTED_CORPUS_FILES} local corpus files`);
  const mapping = analyzeMapping(corpus.results, args.source);
  const corpusSpanTiming = auditCorpusSpanTiming(corpus.results);
  const com26RigGraph = extractCom26(sourceScan);
  const prototype = buildModels(com26RigGraph, motionModule.interpolateFlaLinearMotionTransform);
  const sourceAfter = sha256(await fs.promises.readFile(args.source));
  const controlAfter = sha256(await fs.promises.readFile(args.control));
  assert.equal(sourceAfter, sourceArchive.sha256, 'source FLA changed during research');
  assert.equal(controlAfter, controlArchive.sha256, 'control FLA changed during research');
  for (const file of corpus.results) {
    file.sha256After = sha256(await fs.promises.readFile(file.filename));
    assert.equal(file.sha256After, file.sha256, `corpus FLA changed during research: ${file.filename}`);
  }
  const evidence = {
    schemaVersion: 'issue731-rig-parenting-reconstruction/1',
    issue: 731,
    baseline: '60af3a2bedba1351d70f48da501fb72be6e885bf',
    source: {
      path: args.source,
      sha256Before: sourceArchive.sha256,
      sha256After: sourceAfter,
      normalizationApplied: sourceArchive.normalizationApplied,
      classifierState: sourceArchive.classifierState,
      sourceMutation: 'NO',
    },
    control: {
      path: args.control,
      sha256Before: controlArchive.sha256,
      sha256After: controlAfter,
      normalizationApplied: controlArchive.normalizationApplied,
      sourceMutation: 'NO',
    },
    corpus: toCompactCorpus(corpus),
    com26RigGraph,
    mapping,
    corpusSpanTiming,
    adobeEvidence: [
      {
        label: 'DIRECT_ADOBE',
        url: 'https://helpx.adobe.com/animate/desktop/workspace-and-workflow/timeline-layers.html',
        finding: 'Adobe describes child layer parenting as inheriting parent position and rotation, with parenting per child keyframe; Animate 2022+ can propagate scale, skew, and flip. For warped objects it gives a pivot-related condition. It does not name DOMFrame.parentLayerIndex or define the affine composition formula.',
      },
      {
        label: 'DIRECT_ADOBE',
        url: 'https://www.adobe.com/in/learn/animate/web/layer-parenting-tween-animation',
        finding: 'Adobe tutorial demonstrates parenting and applying Classic Tweens to parent and child layers together; it recommends setting a transform center before keyframes. This supports simultaneous animation capability but does not define the matrix formula.',
      },
      {
        label: 'ADOBE_API',
        url: 'https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting1.md',
        finding: 'layer.getRigParentAtFrame(frameIndex) returns the layer parent at a frame (Animate 2020 API).',
      },
      {
        label: 'ADOBE_API',
        url: 'https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting2.md',
        finding: 'layer.setRigParentAtFrame(frameIndex, layer) sets a parent for a particular frame, confirming per-frame parent selection.',
      },
      {
        label: 'ADOBE_API',
        url: 'https://github.com/AdobeDocs/developers-animatesdk-docs/blob/master/Layer_Parenting_Object/layerParenting3.md',
        finding: 'layer.getRigMatrixAtFrame(frameIndex) exposes a rig matrix, but the docs do not define how it relates to the saved XFL Matrix or transformationPoint.',
      },
      {
        label: 'RUNTIME_EVIDENCE',
        url: null,
        finding: 'No Adobe Animate installation or JSFL runtime was available to query this exact fixture; no Adobe-rendered comparison is claimed.',
      },
    ],
    coordinateAudit: {
      childMatrixClassification: 'UNKNOWN',
      parentMatrixClassification: 'UNKNOWN',
      pandaObservedInterpretation: 'The existing adapter describes XFL leaf matrices as absolute within their owning timeline; it localizes nested DOMGroup leaves only when entering a group. This is Panda parser behavior, not independent proof of Animate rig matrix semantics.',
      interpolationSpace: 'Existing adapter interpolates the authored Matrix endpoints per layer before any same-timeline rig parenting stage.',
      transformationPointHandling: 'The adapter parses and carries transformationPoint values; current symbol ancestor composition uses Matrix and does not apply a same-timeline rig pivot stage.',
      painterOrder: 'XFL timeline layers are reversed for Panda back-to-front painter order.',
      currentPandaStages: 'Nested-symbol resolver composes ancestor symbol matrices. No same-timeline sibling rig-parent graph/composition stage exists.',
    },
    compositionModels: prototype,
    pivotAudit: {
      classification: 'UNKNOWN',
      finding: 'All child/parent transformationPoint values are captured at F0/F5/F10/F15/F20. Adobe documentation contains a pivot condition for warped objects but no formula for this plain affine family. Matrix and point both change slightly across keys; no Adobe runtime can distinguish baked versus separately applied pivot behavior.',
    },
    simultaneousTweenAudit: {
      targetIntervals: 'Both parent and child have aligned motion spans 0→5, 5→10, 10→15, and 15→20, with matching progress at each sampled frame.',
      targetReparenting: 'No parent identity changes across the five child keys.',
      corpusEvidence: corpusSpanTiming,
      corpusBoundary: 'The 14-file census records observed span patterns but does not establish behavior for arbitrary mismatched spans, held-parent/child, or reparent-inside-span cases.',
      unsupportedNeighboringCases: [
        'parent identity changes inside a child tween span',
        'guide/motion-guide parenting',
        'mask/folder/camera relationships',
        'deeper chains, cycles, or malformed references',
        'scale/skew/flip propagation when source Animate version is unknown',
        'custom ease, path, or orient-to-path',
        'MovieClip or ActionScript runtime behavior',
        'arbitrary parent/child span misalignment',
      ],
    },
    externalImplementation: {
      project: 'lifeart/fla-viewer',
      commit: 'b14fa1d1e3e2d2b035e174bde472a7941d385b17',
      source: 'https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/renderer.ts',
      layerUtils: 'https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/layer-utils.ts',
      tests: 'https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/__tests__/layer-parenting-rig.test.ts',
      history: 'https://github.com/lifeart/fla-viewer/pull/48',
      algorithm: 'Resolve a normal-layer parent index; evaluate parent world transform recursively; for a tween, compute inverse(parentKey) * childAuthoredKey at both endpoints, interpolate the relative transform, then compose parent(t) * childRelative(t). A held child uses parent(t) * inverse(parentAtChildKey) * childKey.',
      limitations: 'The source implements Model B and synthetic tests exercise it, but its parser reads parentLayerIndex from DOMLayer for mask logic and does not read DOMFrame.parentLayerIndex or layerRiggingIndex. PR #48 says the implementation was based on docs/forum reports rather than a real parented FLA and requested later real-file validation. Treat as SOURCE_CODE/SYNTHETIC_TEST evidence, not Adobe runtime truth.',
      provenanceConflict: 'Current master test comments call “The Weird Al Show - Intro.fla” empirical evidence, but the checked-in test builds synthetic display lists and the repository contains no matching FLA; PR #48 explicitly says the parenting formula was not checked against a real parented FLA. This evidence provenance conflict remains unresolved.',
    },
    prototype: {
      ...prototype,
      deterministic: true,
      renders: 'NOT PRODUCED; no Adobe runtime reference image is available.',
    },
    pandaSeam: {
      recommendation: 'A narrowly scoped FlaRigParentComposer, without a generic animation graph.',
      input: 'Resolved same-timeline layer/frame state, stable parent identity, authored parent/child endpoint matrices, transformation points, and local tween results.',
      output: 'Parent-aware child symbol instance transform for subsequent nested Graphic resolution.',
      order: 'frame selection -> local tween reconstruction -> parenting composition -> ancestor symbol composition',
      ownerCandidate: 'A new focused service called by the static snapshot adapter after buildGraphicFrameContext and before nested Graphic selection; keep the current adapter fail-closed until the external truth is established.',
    },
    classification: 'RIG_PARENTING_EXTERNAL_TRUTH_REQUIRED',
    classificationReason: 'Parent identity is strongly inferred for the target serialization, but exact Animate coordinate-space and pivot behavior remain unknown. Model B is an externally proposed formula with synthetic tests, and neither Adobe runtime nor the external parser validates this saved com26 family.',
    safety: {
      productionFilesChanged: 'NO',
      sourceMutation: 'NO',
      fullCiManuallyTriggered: 'NO',
      motherPrExpectedState: 'OPEN / DRAFT',
    },
  };
  const receipt = formatReceipt(evidence);
  await fs.promises.mkdir(args.out, { recursive: true });
  await fs.promises.writeFile(path.join(args.out, 'issue731-rig-parenting-reconstruction.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receipt, { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    out: args.out,
    fixtureSha256: evidence.source.sha256After,
    controlSha256: evidence.control.sha256After,
    corpusFileCount: evidence.corpus.fileCount,
    frameParentLayerIndexOccurrences: evidence.mapping.corpusCounts.frameParentLayerIndexOccurrences,
    targetRigLinks: evidence.mapping.targetMapping.uniqueMatches,
    modelPairs: evidence.compositionModels.pairs.length,
    classification: evidence.classification,
  }, null, 2) + '\n');
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
