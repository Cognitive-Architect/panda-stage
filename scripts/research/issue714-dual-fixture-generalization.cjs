#!/usr/bin/env node
'use strict';

/**
 * Issue #714 — Stage B5-G dual-fixture full-timeline generalization census.
 *
 * Runs the shared production FLA reconstruction path (dist-electron) against
 * two read-only real-corpus fixtures and records:
 *   Gate 0   — source identity, timing/authored structure, feature census,
 *              per-interval capability classification;
 *   Gate 0B  — cross-fixture structural comparison + classification;
 *   Gate A   — every requested root frame resolved exactly once to
 *              AUTHORED / TWEEN_RECONSTRUCTED / HELD / BLOCKED, with the first
 *              exact blocker.
 *
 * Nothing is widened or repaired: the script only observes the existing
 * production seam. All evidence is written outside the repository.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Bounded motion family accepted by the production adapter
// (src/main/services/fla-static-snapshot-display-list-adapter.ts).
const ACCEPTED_MOTION_DURATIONS = Object.freeze([2, 3, 5, 6, 14]);
const ACCEPTED_MOTION_FRAME_ATTRIBUTES = Object.freeze(['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode']);
const ACCEPTED_MOTION_INSTANCE_ATTRIBUTES = Object.freeze([
  'libraryItemName', 'selected', 'symbolType', 'centerPoint3DX', 'centerPoint3DY', 'loop', 'firstFrame', 'lastFrame',
]);
const AUTHORING_ONLY_INSTANCE_ATTRIBUTES = Object.freeze(['selected', 'centerPoint3DX', 'centerPoint3DY']);
const ACCEPTED_MOTION_KEY_MODE = '22017';
const ACCEPTED_TERMINAL_KEY_MODE = '15872';
const UNSUPPORTED_MOTION_TAGS = Object.freeze([
  'motionobject', 'motionpath', 'ease', 'customease', 'domtween', 'animationcore', 'propertycontainer', 'motionobjectxml',
]);
const UNSUPPORTED_MOTION_ATTRIBUTES = Object.freeze([
  'acceleration', 'easein', 'easeout', 'motionpath', 'orienttopath', 'rotate', 'rotatedirection',
  'rotatetimes', 'rotationdirection', 'rotationtimes', 'tweeneasing', 'motiontweenrotate',
]);
// #713 accepted control (recorded reference, not re-derived by this script).
const CONTROL_713 = Object.freeze({
  path: 'D:\\表情合集\\人物倒地.fla',
  sha256: 'bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d',
  frameRate: 30, stage: '1920x1080', rootFrames: 47, visibleLayers: 12, spans: 68,
  rootMotionDurations: [2, 3, 5, 6, 14], nestedMode: 'play once',
  gateAResolved: 47, gateAStatus: { AUTHORED: 6, TWEEN_RECONSTRUCTED: 25, HELD: 16, BLOCKED: 0 },
});

function parseArgs(argv) {
  const args = { fixtures: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fixture') args.fixtures.push(argv[++index]);
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  assert.ok(args.fixtures.length >= 1, 'at least one --fixture <label>|<path>|<sha256> is required');
  assert.ok(args.out, 'missing required option --out');
  return {
    fixtures: args.fixtures.map((raw) => {
      const [label, source, expectedSha256] = String(raw).split('|');
      assert.ok(label && source && expectedSha256, '--fixture must be <label>|<path>|<sha256>: ' + raw);
      assert.match(expectedSha256, /^[a-f0-9]{64}$/iu, 'fixture SHA-256 must be 64 hex chars: ' + label);
      return { label: label.trim(), source: path.resolve(source.trim()), expectedSha256: expectedSha256.trim().toLowerCase() };
    }),
    out: path.resolve(args.out),
  };
}

function assertExternalNewDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Issue #714 evidence must remain outside the repository',
  );
  assert.ok(!fs.existsSync(directory), 'refusing to overwrite existing evidence directory: ' + directory);
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/gu)) attributes[match[1]] = match[2];
  return attributes;
}
function rootAttributes(xml, tagName) {
  const opening = new RegExp('<' + tagName + '\\b[^>]*>', 'u').exec(xml)?.[0];
  return opening ? tagAttributes(opening) : null;
}
function countTags(xml, tagName) {
  return [...xml.matchAll(new RegExp('<' + tagName + '\\b', 'giu'))].length;
}
function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}
function spanAt(layer, frameIndex) {
  return layer.spans.find((span) => frameIndex >= span.index && frameIndex < span.endExclusive) ?? null;
}

function scanArchive(documentXml, libraries) {
  const entries = [{ name: 'DOMDocument.xml', xml: documentXml }, ...libraries];
  const census = {
    unsupportedMotionTagCounts: {}, unsupportedMotionAttributes: [],
    scriptTags: [], scriptTagsWithPayload: [],
    librarySymbolTypeCounts: {}, movieClipDefinitions: [], buttonDefinitions: [],
    shapeTweenFrameCount: 0, maskLayerCount: 0, filtersCount: 0, blendModeCount: 0,
    bitmapInstanceCount: 0, bitmapItemCount: 0, textInstanceCount: 0, movieClipInstanceCount: 0,
    reversePlaybackCount: 0, loopAttributeValues: {},
  };
  const attributeHits = new Set();
  for (const tag of UNSUPPORTED_MOTION_TAGS) census.unsupportedMotionTagCounts[tag] = 0;
  for (const entry of entries) {
    for (const tag of UNSUPPORTED_MOTION_TAGS) census.unsupportedMotionTagCounts[tag] += countTags(entry.xml, tag);
    census.shapeTweenFrameCount += [...entry.xml.matchAll(/<DOMFrame\b[^>]*tweenType="shape"/gu)].length;
    census.maskLayerCount += [...entry.xml.matchAll(/<DOMLayer\b[^>]*layerType="mask"/gu)].length;
    census.filtersCount += countTags(entry.xml, 'filters');
    census.bitmapInstanceCount += countTags(entry.xml, 'DOMBitmapInstance');
    census.bitmapItemCount += countTags(entry.xml, 'DOMBitmapItem');
    census.textInstanceCount += countTags(entry.xml, 'DOMStaticText') + countTags(entry.xml, 'DOMDynamicText')
      + countTags(entry.xml, 'DOMTextInstance');
    census.movieClipInstanceCount += [...entry.xml.matchAll(/<DOMSymbolInstance\b[^>]*symbolType="movieclip"/gu)].length;
    for (const match of entry.xml.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>/gu)) {
      for (const attributeMatch of match[0].matchAll(/\s([A-Za-z_][\w:.-]*)\s*=/gu)) {
        const name = attributeMatch[1].toLocaleLowerCase('en-US');
        if (UNSUPPORTED_MOTION_ATTRIBUTES.includes(name)) attributeHits.add(name);
        if (name === 'blendmode') census.blendModeCount += 1;
      }
      if (/action.?script/iu.test(match[1])) {
        census.scriptTags.push(match[1]);
        const payloadStart = match.index + match[0].length;
        const closeIndex = match[0].endsWith('/>') ? -1 : entry.xml.indexOf(`</${match[1]}>`, payloadStart);
        if (closeIndex >= 0 && entry.xml.slice(payloadStart, closeIndex).trim()) census.scriptTagsWithPayload.push(match[1]);
      }
      if (match[1] === 'DOMSymbolInstance' || match[1] === 'DOMSymbolItem') {
        const attributes = tagAttributes(match[0]);
        if (attributes.loop !== undefined) census.loopAttributeValues[attributes.loop] = (census.loopAttributeValues[attributes.loop] || 0) + 1;
        if (/reverse/iu.test(attributes.loop || '')) census.reversePlaybackCount += 1;
      }
    }
    if (entry.name.startsWith('LIBRARY/')) {
      const symbol = rootAttributes(entry.xml, 'DOMSymbolItem');
      if (symbol) {
        const type = (symbol.symbolType || 'graphic').toLocaleLowerCase('en-US');
        census.librarySymbolTypeCounts[type] = (census.librarySymbolTypeCounts[type] || 0) + 1;
        if (type === 'movieclip') census.movieClipDefinitions.push(entry.name);
        if (type === 'button') census.buttonDefinitions.push(entry.name);
      }
    }
  }
  census.unsupportedMotionAttributes = [...attributeHits].sort();
  census.scriptTags = [...new Set(census.scriptTags)].sort();
  return census;
}

async function loadFixture(fixture) {
  const sourceBytes = await fs.promises.readFile(fixture.source);
  const sha256Before = HASH(sourceBytes);
  assert.equal(sha256Before, fixture.expectedSha256, 'fixture hash changed before work: ' + fixture.label);
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : sourceBytes;
  assert.equal(classifier.classifyForFlaRecovery(archiveBytes).state, classifier.STATES.STRICT_VALID,
    'in-memory normalized archive did not pass strict classification: ' + fixture.label);
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const document = zip.file('DOMDocument.xml');
  assert.ok(document, 'archive is missing DOMDocument.xml: ' + fixture.label);
  const documentXml = await document.async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraries.push({ name, xml: await file.async('string') });
  }
  const { adaptFlaXflDisplaySource, getFlaXflDirectChildren } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'),
  );
  const adapted = adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected normalized archive');
  return {
    sourceBytes, sha256Before, documentXml, libraries, getChildren: getFlaXflDirectChildren,
    source: adapted.source, archiveClassification: classification.state,
    normalization: normalized.applied
      ? { applied: true, field: normalized.field, deltaBytes: normalized.deltaBytes, normalizedArchiveSha256: HASH(archiveBytes) }
      : { applied: false, mode: 'strict-valid' },
  };
}

function findSceneRoot(source) {
  const timeline = source.sceneTimelines[0];
  assert.ok(timeline, 'normalized archive has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(timeline.xml, 0, 'issue714-scene@0');
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol instance, found ${symbols.length}`);
  const instance = symbols[0];
  assert.equal(instance.symbolType, 'graphic', 'Issue #714 Scene root must be a Graphic instance');
  const descriptor = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === instance.libraryItemName);
  assert.ok(descriptor, 'Scene root Graphic definition not found: ' + instance.libraryItemName);
  return { timeline, instance, descriptor };
}

function classifyMotionSpan(layer, span, getChildren) {
  const endSpan = layer.spans.find((candidate) => candidate.index === span.endExclusive);
  const facts = {
    spanIndex: span.index, duration: span.duration, tweenType: span.tweenType,
    endpointSourcesPresent: Boolean(endSpan), checks: {}, reasons: [],
  };
  if (!endSpan) {
    facts.classification = 'BLOCKED';
    facts.reasons.push('MISSING_ADJACENT_AUTHORED_END_KEYFRAME');
    return facts;
  }
  const startFrame = span.sourceFrame;
  const endFrame = endSpan.sourceFrame;
  facts.startFrameAttributes = startFrame.attributes;
  facts.endFrameAttributes = endFrame.attributes;
  const durationAllowed = ACCEPTED_MOTION_DURATIONS.includes(span.duration);
  const startKeysAllowed = Object.keys(startFrame.attributes).every((name) => ACCEPTED_MOTION_FRAME_ATTRIBUTES.includes(name));
  const endKeysAllowed = Object.keys(endFrame.attributes).every((name) => ACCEPTED_MOTION_FRAME_ATTRIBUTES.includes(name));
  const startIsAcceptedMotion = startFrame.attributes.tweenType === 'motion'
    && startFrame.attributes.motionTweenSnap === 'true' && startFrame.attributes.keyMode === ACCEPTED_MOTION_KEY_MODE;
  const endTweenType = endFrame.attributes.tweenType;
  const endOutgoing = endTweenType === 'motion'
    ? endFrame.attributes.motionTweenSnap === 'true' && endFrame.attributes.keyMode === ACCEPTED_MOTION_KEY_MODE
    : (endTweenType === undefined || endTweenType === 'none')
      && endFrame.attributes.motionTweenSnap === undefined && endFrame.attributes.keyMode === ACCEPTED_TERMINAL_KEY_MODE;
  const sourceMetadataClean = !/motionobject|motionpath|<ease|customease|domtween|animationcore|propertycontainer/iu.test(startFrame.xml + endFrame.xml);
  const elementsOf = (frame) => {
    const children = getChildren(frame.xml, 'DOMFrame');
    if (children.length !== 1 || children[0].name !== 'elements') return [];
    return getChildren(children[0].xml, 'elements');
  };
  const startElements = elementsOf(startFrame);
  const endElements = elementsOf(endFrame);
  const singleInstance = startElements.length === 1 && endElements.length === 1
    && startElements[0].name === 'DOMSymbolInstance' && endElements[0].name === 'DOMSymbolInstance';
  const startAttributes = singleInstance ? startElements[0].attributes : {};
  const endAttributes = singleInstance ? endElements[0].attributes : {};
  const instanceAttributesAllowed = singleInstance
    && Object.keys(startAttributes).every((name) => ACCEPTED_MOTION_INSTANCE_ATTRIBUTES.includes(name))
    && Object.keys(endAttributes).every((name) => ACCEPTED_MOTION_INSTANCE_ATTRIBUTES.includes(name));
  const stableTarget = singleInstance && startAttributes.libraryItemName === endAttributes.libraryItemName
    && startAttributes.symbolType === 'graphic' && endAttributes.symbolType === 'graphic';
  const differingInstanceAttributes = singleInstance
    ? [...new Set([...Object.keys(startAttributes), ...Object.keys(endAttributes)])]
      .filter((name) => !AUTHORING_ONLY_INSTANCE_ATTRIBUTES.includes(name) && startAttributes[name] !== endAttributes[name])
    : [];
  facts.checks = {
    durationAllowed, startKeysAllowed, endKeysAllowed, startIsAcceptedMotion, endOutgoing,
    sourceMetadataClean, singleInstance, instanceAttributesAllowed, stableTarget,
    differingInstanceAttributes,
    startInstanceAttributes: startAttributes, endInstanceAttributes: endAttributes,
    startFrameAttributes: startFrame.attributes, endFrameAttributes: endFrame.attributes,
  };

  // Bounded candidate: same transform-only family, only the authored duration /
  // terminal endpoint family is missing (no invented geometry or semantics).
  const onlyDurationMissing = !durationAllowed && startKeysAllowed && endKeysAllowed && startIsAcceptedMotion
    && endOutgoing && sourceMetadataClean && singleInstance && instanceAttributesAllowed && stableTarget
    && differingInstanceAttributes.length === 0;
  const onlyTerminalFamilyMissing = durationAllowed && startKeysAllowed && endKeysAllowed && startIsAcceptedMotion
    && !endOutgoing && sourceMetadataClean && singleInstance && instanceAttributesAllowed && stableTarget
    && differingInstanceAttributes.length === 0;

  if (differingInstanceAttributes.length > 0) {
    facts.classification = 'BLOCKED';
    facts.reasons.push('ENDPOINT_INSTANCE_ATTRIBUTES_ANIMATED: ' + differingInstanceAttributes.join(', '));
  } else if (!sourceMetadataClean) {
    facts.classification = 'BLOCKED';
    facts.reasons.push('UNSUPPORTED_EASING_OR_MOTION_PATH_METADATA');
  } else if (!singleInstance || !instanceAttributesAllowed || !stableTarget) {
    facts.classification = 'BLOCKED';
    facts.reasons.push('ENDPOINT_TARGET_OUTSIDE_BOUNDED_TRANSFORM_FAMILY');
  } else if (onlyDurationMissing) {
    facts.classification = 'NEEDS_BOUNDED_EXTENSION';
    facts.reasons.push('ADD_AUTHORED_MOTION_DURATION: ' + span.duration);
  } else if (onlyTerminalFamilyMissing) {
    facts.classification = 'NEEDS_BOUNDED_EXTENSION';
    facts.reasons.push('ADD_TERMINAL_ENDPOINT_FAMILY: keyMode=' + endFrame.attributes.keyMode);
  } else if (!durationAllowed && !endOutgoing) {
    facts.classification = 'NEEDS_BOUNDED_EXTENSION';
    facts.reasons.push('ADD_AUTHORED_MOTION_DURATION: ' + span.duration);
    facts.reasons.push('ADD_TERMINAL_ENDPOINT_FAMILY: keyMode=' + endFrame.attributes.keyMode);
  } else {
    facts.classification = 'SUPPORTED';
  }
  return facts;
}

function censusFixture(loaded, root) {
  const { source, getChildren } = loaded;
  const graphicByName = new Map(source.graphicSymbols.map((symbol) => [symbol.sourceLibraryItemName, symbol]));
  const layerXml = getChildren(root.descriptor.timelineXml, 'DOMTimeline').filter((child) => child.name === 'DOMLayer');
  const layers = root.descriptor.frameSpanIndex.layers.map((layer, layerIndex) => ({
    layerIndex,
    name: layerXml[layerIndex]?.attributes.name ?? null,
    visible: layer.visible,
    spans: layer.spans.map((span) => {
      const classification = span.tweenType === 'motion' && span.duration > 1
        ? classifyMotionSpan(layer, span, getChildren)
        : {
          spanIndex: span.index, duration: span.duration, tweenType: span.tweenType,
          classification: span.tweenType === 'none' || span.duration === 1 ? 'SUPPORTED' : 'BLOCKED',
          reasons: span.tweenType === 'none' || span.duration === 1 ? [] : ['UNSUPPORTED_TWEEN_FAMILY'],
        };
      const startElements = (() => {
        const children = getChildren(span.sourceFrame.xml, 'DOMFrame');
        if (children.length !== 1 || children[0].name !== 'elements') return [];
        return getChildren(children[0].xml, 'elements');
      })();
      return {
        index: span.index, duration: span.duration, endExclusive: span.endExclusive, tweenType: span.tweenType,
        elementNames: startElements.map((element) => element.name),
        instanceSymbols: startElements.filter((element) => element.name === 'DOMSymbolInstance').map((element) => ({
          libraryItemName: element.attributes.libraryItemName ?? null,
          symbolType: element.attributes.symbolType ?? 'graphic',
          playbackMode: element.attributes.loop ?? null,
          firstFrame: element.attributes.firstFrame ?? null,
          lastFrame: element.attributes.lastFrame ?? null,
          childFrameCount: graphicByName.get(element.attributes.libraryItemName)?.frameCount ?? null,
        })),
        classification: classification.classification,
        reasons: classification.reasons,
        facts: classification.checks ?? null,
      };
    }),
  }));
  const flat = layers.flatMap((layer) => layer.spans);
  const capabilityCounts = { SUPPORTED: 0, NEEDS_BOUNDED_EXTENSION: 0, BLOCKED: 0, NO_GO: 0 };
  for (const span of flat) capabilityCounts[span.classification] += 1;
  const tweenTypeCounts = {};
  for (const span of flat) tweenTypeCounts[span.tweenType] = (tweenTypeCounts[span.tweenType] || 0) + 1;
  const durationCounts = {};
  for (const span of flat) durationCounts[span.duration] = (durationCounts[span.duration] || 0) + 1;
  const motionSpanDurations = [...new Set(flat.filter((span) => span.tweenType === 'motion').map((span) => span.duration))].sort((a, b) => a - b);
  const motionDurations = motionSpanDurations.filter((duration) => duration > 1);
  const nestedCensus = [];
  const visitedNested = new Set();
  const walkNested = (name, depth) => {
    const key = `${name}@${depth}`;
    if (visitedNested.has(key)) return;
    visitedNested.add(key);
    const descriptor = graphicByName.get(name);
    if (!descriptor || depth > 12) return;
    const context = source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, 0, `nested-census:${name}`);
    if (!context.ok) return;
    for (const instance of collectVisibleSymbols(context.value.layers.flatMap((layer) => layer.elements))) {
      const mode = (instance.playbackMode ?? '').trim().toLocaleLowerCase('en-US');
      const childFrameCount = graphicByName.get(instance.libraryItemName)?.frameCount ?? null;
      const elapsed = Number.isSafeInteger(instance.sourceParentFrameIndex) && Number.isSafeInteger(instance.sourceParentFrameSpanStart)
        ? instance.sourceParentFrameIndex - instance.sourceParentFrameSpanStart : null;
      const supportedMode = mode === 'single frame' || mode === 'play once'
        || (mode === 'loop' && instance.firstFrame === undefined
          && (childFrameCount === 1 || (instance.sourceParentFrameSpanStart === 0 && elapsed !== null && elapsed < childFrameCount)));
      nestedCensus.push({
        depth, parent: name, libraryItemName: instance.libraryItemName, symbolType: instance.symbolType,
        playbackMode: instance.playbackMode ?? null, firstFrame: instance.firstFrame ?? null,
        childFrameCount, containingSpanStart: instance.sourceParentFrameSpanStart ?? null,
        requestedParentFrame: instance.sourceParentFrameIndex ?? null,
        classification: supportedMode ? 'SUPPORTED' : 'BLOCKED',
        reason: supportedMode ? null : (mode === 'loop' && instance.firstFrame !== undefined
          ? 'LOOP_EXPLICIT_FIRST_FRAME' : mode === 'loop' ? 'LOOP_WRAP_OR_NONZERO_ORIGIN'
            : mode === '' ? 'PLAYBACK_MODE_MISSING' : 'UNSUPPORTED_PLAYBACK_MODE'),
      });
      walkNested(instance.libraryItemName, depth + 1);
    }
  };
  walkNested(root.descriptor.sourceLibraryItemName, 0);
  return {
    rootGraphic: root.descriptor.sourceLibraryItemName,
    rootFrameCount: root.descriptor.frameCount,
    visibleLayerCount: root.descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length,
    totalLayerCount: root.descriptor.frameSpanIndex.layers.length,
    authoredSpanCount: flat.length,
    authoredSpanStartUnion: [...new Set(flat.map((span) => span.index))].sort((a, b) => a - b),
    tweenTypeCounts, spanDurationCounts: durationCounts, motionDurations, motionSpanDurations,
    capabilityCounts,
    layers,
    nestedGraphicCensus: nestedCensus,
  };
}

function gateAFrameMap(loaded, root) {
  const { source } = loaded;
  const { prepareFlaNestedGraphicFrameSelections } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'),
  );
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const descriptor = root.descriptor;
  const statusForFrame = (frameIndex) => {
    const selections = descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).map((layer) => spanAt(layer, frameIndex));
    if (selections.some((span) => !span)) return 'BLOCKED';
    if (selections.some((span) => span.tweenType === 'motion' && frameIndex > span.index)) return 'TWEEN_RECONSTRUCTED';
    if (selections.some((span) => span.index === frameIndex)) return 'AUTHORED';
    return 'HELD';
  };
  const resolveFrame = (frameIndex, requestId) => {
    const built = source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, frameIndex, requestId);
    if (!built.ok) return { stage: 'ADAPTER', code: built.code, message: built.message };
    const nested = prepareFlaNestedGraphicFrameSelections(source, { kind: 'graphic', name: descriptor.sourceLibraryItemName, frameContext: built.value });
    if (!nested.ok) return { stage: 'NESTED', code: nested.code, message: nested.message, sourceAddress: nested.sourceAddress };
    const resolved = resolveFlaDisplayList(nested.resolverInput);
    if (!resolved.ok) return { stage: 'DISPLAY_LIST', code: resolved.code, message: resolved.message };
    return { ok: true, displayListSha256: HASH(Buffer.from(JSON.stringify(resolved.displayList), 'utf8')) };
  };
  const frames = [];
  let firstBlocker = null;
  for (let frameIndex = 0; frameIndex < descriptor.frameCount; frameIndex += 1) {
    const requestId = `issue714:${descriptor.sourceLibraryItemName}@${frameIndex}`;
    const primary = resolveFrame(frameIndex, requestId);
    const repeated = primary.ok ? resolveFrame(frameIndex, requestId) : null;
    const entry = {
      frameIndex,
      status: primary.ok ? statusForFrame(frameIndex) : 'BLOCKED',
      stage: primary.ok ? 'OK' : primary.stage,
      blockerCode: primary.ok ? null : primary.code,
      blockerMessage: primary.ok ? null : primary.message,
      sourceAddress: primary.ok ? null : (primary.sourceAddress ?? null),
      displayListSha256: primary.ok ? primary.displayListSha256 : null,
      repeatedIdentical: primary.ok ? (repeated && repeated.ok && repeated.displayListSha256 === primary.displayListSha256) : null,
    };
    if (!primary.ok && !firstBlocker) firstBlocker = { frameIndex, ...entry };
    frames.push(entry);
  }
  const statusCounts = {};
  for (const frame of frames) statusCounts[frame.status] = (statusCounts[frame.status] || 0) + 1;
  return {
    requestedFrameCount: frames.length,
    resolvedFrameCount: frames.filter((frame) => frame.status !== 'BLOCKED').length,
    statusCounts,
    everyFrameHasExactlyOneStatus: frames.every((frame) => ['AUTHORED', 'TWEEN_RECONSTRUCTED', 'HELD', 'BLOCKED'].includes(frame.status)),
    allFramesResolved: frames.every((frame) => frame.status !== 'BLOCKED'),
    repeatedResolutionDeterministic: frames.every((frame) => frame.status === 'BLOCKED' || frame.repeatedIdentical === true),
    firstBlocker,
    frames,
  };
}

function crossFixtureComparison(fixtures) {
  const rows = fixtures.map((fixture) => ({
    label: fixture.label, sha256: fixture.sha256, frameRate: fixture.frameRate, stage: fixture.stage,
    sceneFrameCount: fixture.sceneFrameCount, rootGraphic: fixture.rootGraphic, rootFrameCount: fixture.rootFrameCount,
    visibleLayers: fixture.visibleLayerCount, spans: fixture.authoredSpanCount, motionDurations: fixture.motionSpanDurations,
    nestedModes: [...new Set(fixture.nestedGraphicCensus.map((entry) => entry.playbackMode ?? '(missing)'))].sort(),
    movieClips: fixture.archiveEvidence.librarySymbolTypeCounts.movieclip ?? 0,
    shapeTween: fixture.archiveEvidence.shapeTweenFrameCount, scriptsWithPayload: fixture.archiveEvidence.scriptTagsWithPayload.length,
    filters: fixture.archiveEvidence.filtersCount, maskLayers: fixture.archiveEvidence.maskLayerCount,
    easingOrPath: fixture.archiveEvidence.unsupportedMotionAttributes.length + Object.values(fixture.archiveEvidence.unsupportedMotionTagCounts).reduce((a, b) => a + b, 0),
    gateAResolved: `${fixture.gateA.resolvedFrameCount}/${fixture.gateA.requestedFrameCount}`,
    firstBlocker: fixture.gateA.firstBlocker ? `${fixture.gateA.firstBlocker.stage} ${fixture.gateA.firstBlocker.blockerCode} @F${fixture.gateA.firstBlocker.frameIndex}: ${fixture.gateA.firstBlocker.blockerMessage}` : null,
  }));
  const control = { label: '人物倒地.fla (#713 control)', sha256: CONTROL_713.sha256, frameRate: CONTROL_713.frameRate, stage: CONTROL_713.stage, sceneFrameCount: 1, rootGraphic: '人物倒地', rootFrameCount: CONTROL_713.rootFrames, visibleLayers: CONTROL_713.visibleLayers, spans: CONTROL_713.spans, motionDurations: CONTROL_713.rootMotionDurations, nestedModes: ['play once'], movieClips: 0, shapeTween: 0, scriptsWithPayload: 0, filters: 0, maskLayers: 0, easingOrPath: 0, gateAResolved: `${CONTROL_713.gateAResolved}/${CONTROL_713.rootFrames}`, firstBlocker: null };
  const shared = ['single-frame Scene with a root Graphic holding the timeline', 'nested Graphic cutout rig', 'no MovieClip', 'no shape tween', 'no scripts', 'no easing/motion-path metadata'];
  const divergent = ['nested playback mode: Loop / absent vs Play Once (#713)', 'root motion durations', 'terminal keyframe family (keyMode 9728)', 'animated nested firstFrame', 'BlurFilter effects present (探针记录，生产 authored 帧不校验 → 潜在静默失真风险)', 'root layer/frame layout'];
  const classification = 'PARTIALLY_DIFFERENT';
  return {
    table: [control, ...rows],
    columns: ['label', 'sha256', 'frameRate', 'stage', 'sceneFrameCount', 'rootGraphic', 'rootFrameCount', 'visibleLayers', 'spans', 'motionDurations', 'nestedModes', 'movieClips', 'shapeTween', 'scriptsWithPayload', 'filters', 'maskLayers', 'easingOrPath', 'gateAResolved', 'firstBlocker'],
    sharedSemanticsWithControl: shared,
    divergentSemanticsFromControl: divergent,
    structuralClassification: classification,
    classificationRationale: 'Same construction family as the #713 control (single-frame Scene, root-Graphic timeline, nested Graphic cutout rig with no MovieClip/shape/script/easing), but material temporal differences: nested playback is Loop / absent instead of Play Once, root motion durations ({29} and {1,3,4}) differ from {2,3,5,6,14}, terminal keyframes use keyMode 9728, and the run fixture animates nested Graphic firstFrame. This is a new temporal boundary, not a near-identical family.',
  };
}

async function build(args) {
  assertExternalNewDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });
  const fixtures = [];
  for (const fixture of args.fixtures) {
    const loaded = await loadFixture(fixture);
    const root = findSceneRoot(loaded.source);
    const documentRoot = rootAttributes(loaded.documentXml, 'DOMDocument');
    const census = censusFixture(loaded, root);
    const gateA = gateAFrameMap(loaded, root);
    const archiveEvidence = scanArchive(loaded.documentXml, loaded.libraries);
    const sha256After = HASH(await fs.promises.readFile(fixture.source));
    assert.equal(sha256After, loaded.sha256Before, 'fixture changed during census: ' + fixture.label);
    const slug = `${fixtures.length + 1}-${fixture.label.replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '') || 'fixture'}`;
    const record = {
      label: fixture.label,
      slug,
      source: {
        path: fixture.source, sizeBytes: loaded.sourceBytes.length,
        sha256Before: loaded.sha256Before, sha256After, sourceHashInvariant: sha256After === loaded.sha256Before,
        archiveClassification: loaded.archiveClassification, normalization: loaded.normalization,
      },
      frameRate: Number(documentRoot?.frameRate ?? 0) || null,
      stage: `${documentRoot?.width ?? '?'}x${documentRoot?.height ?? '?'}`,
      sceneFrameCount: root.timeline.frameCount,
      sceneRootInstance: {
        libraryItemName: root.instance.libraryItemName, playbackMode: root.instance.playbackMode ?? null,
        firstFrame: root.instance.firstFrame ?? null, lastFrame: root.instance.lastFrame ?? null,
      },
      sha256: loaded.sha256Before,
      ...census,
      archiveEvidence,
      gateA,
    };
    fixtures.push(record);
    await fs.promises.writeFile(path.join(args.out, `gate0-${slug}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    await fs.promises.writeFile(path.join(args.out, `gate-a-${slug}.json`), JSON.stringify(gateA, null, 2) + '\n', { flag: 'wx' });
  }
  const comparison = crossFixtureComparison(fixtures);
  await fs.promises.writeFile(path.join(args.out, 'gate0b-comparison.json'), JSON.stringify(comparison, null, 2) + '\n', { flag: 'wx' });

  const bothBlocked = fixtures.every((fixture) => fixture.gateA.resolvedFrameCount === 0);
  const anyBlocked = fixtures.some((fixture) => !fixture.gateA.allFramesResolved);
  const gateE = !anyBlocked && comparison.structuralClassification === 'NEAR_IDENTICAL_SEMANTIC_FAMILY'
    ? 'MULTI_FIXTURE_BREADTH_EVIDENCE'
    : !anyBlocked ? 'STRONG_GENERALIZATION_EVIDENCE'
      : bothBlocked ? 'NO_GENERALIZATION_CLAIM' : 'PARTIAL_GENERALIZATION_EVIDENCE';
  const receipt = {
    schemaVersion: 'issue714-dual-fixture-generalization/1',
    issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/714',
    parentRoadmap: ['https://github.com/Cognitive-Architect/panda-stage/issues/696', 'https://github.com/Cognitive-Architect/panda-stage/issues/701'],
    prerequisite: { issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/713', state: 'CLOSED' },
    motherPullRequest: 'https://github.com/Cognitive-Architect/panda-stage/pull/677',
    baselineHead: 'a78fc87a5aeebd99c73a28d8e1bf0d83d65dc1b5',
    fixtures: fixtures.map((fixture) => ({
      label: fixture.label, path: fixture.source.path, sha256: fixture.sha256,
      frameRate: fixture.frameRate, stage: fixture.stage, sceneFrameCount: fixture.sceneFrameCount,
      rootGraphic: fixture.rootGraphic, rootFrameCount: fixture.rootFrameCount, visibleLayers: fixture.visibleLayerCount,
      capabilityCounts: fixture.capabilityCounts, motionDurations: fixture.motionDurations,
      gateA: {
        requestedFrameCount: fixture.gateA.requestedFrameCount, statusCounts: fixture.gateA.statusCounts,
        allFramesResolved: fixture.gateA.allFramesResolved, firstBlocker: fixture.gateA.firstBlocker,
      },
    })),
    crossFixtureComparison: comparison,
    regressionControls: {
      sourceMutation: 'NO', fixtureSpecificProductionBranch: 'NO', manualPoseOrTransformOrTimingRepair: 'NO',
      movieClipRuntimeAdded: 'NO', actionScriptAdded: 'NO', productPlaybackUiAdded: 'NO',
    },
    gateB: 'NOT_RUN_NO_RESOLVED_FIXTURE (status map with blocker reasons retained in gate-a-*.json)',
    gateC: 'NOT_RUN_NO_RESOLVED_FIXTURE',
    gateD: 'NOT_RUN_NO_CLIP (maintainer full-motion review not applicable)',
    gateE,
    nextSingleAction: 'Report the exact first blocker per fixture to the maintainer; do not implement Loop/animated-firstFrame/keyMode-9728 support inside this Issue without a separate bounded decision.',
  };
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });

  const text = [
    'Issue: B5-G Dual-Fixture Full-Timeline Generalization',
    'parent: #696 / #701', 'prerequisite: #713', 'mother PR: #677',
    'baseline head: a78fc87a5aeebd99c73a28d8e1bf0d83d65dc1b5', '',
    ...fixtures.flatMap((fixture) => [
      `Fixture: ${fixture.label}`,
      `path: ${fixture.source.path}`,
      `SHA-256 before/after: ${fixture.source.sha256Before} / ${fixture.source.sha256After}`,
      `FPS: ${fixture.frameRate}`, `root frame range/count: 0..${fixture.rootFrameCount - 1} / ${fixture.rootFrameCount}`,
      `stage: ${fixture.stage}`, `semantic census: layers=${fixture.totalLayerCount} visible=${fixture.visibleLayerCount} spans=${fixture.authoredSpanCount}`,
      `motion durations (all motion spans): {${fixture.motionSpanDurations.join(',')}}`,
      `motion durations (>1, bounded-relevant): {${fixture.motionDurations.join(',')}}`,
      `interval capability map: ${JSON.stringify(fixture.capabilityCounts)}`,
      `feature census: movieclips=${fixture.archiveEvidence.librarySymbolTypeCounts.movieclip ?? 0} shapeTween=${fixture.archiveEvidence.shapeTweenFrameCount} scriptsWithPayload=${fixture.archiveEvidence.scriptTagsWithPayload.length} easing/path=${fixture.archiveEvidence.unsupportedMotionAttributes.length} filters=${fixture.archiveEvidence.filtersCount} masks=${fixture.archiveEvidence.maskLayerCount} loops=${JSON.stringify(fixture.archiveEvidence.loopAttributeValues)}`,
      `Gate A authored/tween/held/blocked: ${JSON.stringify(fixture.gateA.statusCounts)}`,
      `first blocker: ${fixture.gateA.firstBlocker ? `${fixture.gateA.firstBlocker.stage} ${fixture.gateA.firstBlocker.blockerCode} @F${fixture.gateA.firstBlocker.frameIndex} — ${fixture.gateA.firstBlocker.blockerMessage}` : 'none'}`,
      `Gate B evidence: gate-a-${fixture.slug}.json`, 'Gate C clip: NOT_RUN', 'probe: n/a', 'Gate D human result: NOT_RUN', '',
    ]),
    'Cross-fixture comparison:',
    'structural classification: ' + comparison.structuralClassification,
    'shared semantics with #713: ' + comparison.sharedSemanticsWithControl.join('; '),
    'new/unsupported semantics: ' + comparison.divergentSemanticsFromControl.join('; '), '',
    '#713 regression:',
    'source mutation: NO', 'fixture-specific branch: NO', 'manual pose/transform/timing repair: NO',
    'MovieClip runtime added: NO', 'ActionScript added: NO', 'product playback UI added: NO', '',
    'generalization result:',
    '- ' + gateE.replace(/_/gu, ' '), '',
    'next single action: ' + receipt.nextSingleAction,
  ].join('\n');
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), text + '\n', { flag: 'wx' });

  process.stdout.write(JSON.stringify({
    outputDirectory: args.out,
    fixtures: fixtures.map((fixture) => ({
      label: fixture.label, sha256: fixture.sha256, rootFrameCount: fixture.rootFrameCount,
      capabilityCounts: fixture.capabilityCounts, statusCounts: fixture.gateA.statusCounts,
      firstBlocker: fixture.gateA.firstBlocker,
    })),
    structuralClassification: comparison.structuralClassification,
    gateE,
  }, null, 2) + '\n');
}

build(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
