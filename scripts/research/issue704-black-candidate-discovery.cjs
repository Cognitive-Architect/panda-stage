#!/usr/bin/env node
/*
 * Issue #704 bounded Black-only Stage B2 prototype.
 *
 * It re-enumerates authored Scene/Graphic state starts with the production
 * XFL display adapter, classifies source states and render addresses using
 * the accepted #702/#703 evidence, and carries forward verified renders from
 * those production/prototype-supported paths. It does not render, mutate a
 * source, or change production resolver behavior.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require(path.join(__dirname, '..', '..', 'node_modules', 'jszip'));
const {
  adaptFlaXflDisplaySource,
  getFlaXflDirectChildren,
} = require(path.join(__dirname, '..', '..', 'dist-electron', 'main', 'services', 'fla-static-snapshot-display-list-adapter.js'));

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_VERSION = 'issue704-black-candidate-manifest/1';
const ID_VERSION = 'issue704-candidate-id/1';
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') result.source = argv[++index];
    else if (argv[index] === '--archive') result.archive = argv[++index];
    else if (argv[index] === '--reference') result.reference = argv[++index];
    else if (argv[index] === '--census') result.census = argv[++index];
    else if (argv[index] === '--sync-receipt') result.syncReceipt = argv[++index];
    else if (argv[index] === '--sync-run') result.syncRun = argv[++index];
    else if (argv[index] === '--artifact-dir') result.artifactDir = argv[++index];
    else if (argv[index] === '--out') result.out = argv[++index];
  }
  for (const key of ['source', 'archive', 'reference', 'census', 'syncReceipt', 'syncRun', 'artifactDir', 'out']) {
    assert.ok(result[key], `missing required --${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} argument`);
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, path.resolve(value)]));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function candidateId(sourceSha256, identity) {
  const canonicalIdentity = {
    version: ID_VERSION,
    sourceSha256,
    ...identity,
  };
  return `B2-${HASH(stableJson(canonicalIdentity)).slice(0, 24).toUpperCase()}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function hashFile(filePath) {
  return HASH(await fs.promises.readFile(filePath));
}

function normalizeName(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^LIBRARY\//iu, '').replace(/\.xml$/iu, '');
}

function findSymbol(source, sourceName) {
  const name = normalizeName(sourceName);
  return source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === name || symbol.userLabel === name,
  );
}

function authoredStarts(descriptor) {
  return [...new Set(descriptor.frameSpanIndex.layers.flatMap((layer) =>
    layer.spans.map((span) => span.index),
  ))].sort((left, right) => left - right);
}

function stateSpanDetails(descriptor, frameIndex) {
  const stateStarts = authoredStarts(descriptor);
  assert.ok(frameIndex >= 0 && frameIndex < descriptor.frameCount,
    `frame ${frameIndex} is out of range in ${descriptor.sourceLibraryItemName}`);
  const authoredStateStart = [...stateStarts].reverse().find((start) => start <= frameIndex);
  assert.notEqual(authoredStateStart, undefined, `no authored state covers frame ${frameIndex} in ${descriptor.sourceLibraryItemName}`);
  const nextStateStart = stateStarts.find((start) => start > authoredStateStart) ?? descriptor.frameCount;
  const layers = [];
  for (const [layerIndex, layer] of descriptor.frameSpanIndex.layers.entries()) {
    const span = layer.spans.find((candidate) =>
      frameIndex >= candidate.index && frameIndex < candidate.endExclusive,
    );
    if (!span) {
      layers.push({ layerIndex, visible: layer.visible, selected: null });
      continue;
    }
    layers.push({
      layerIndex,
      visible: layer.visible,
      selected: {
        authoredSpanStart: span.index,
        duration: span.duration,
        endExclusive: span.endExclusive,
        tweenType: span.tweenType,
        keyframeOrHold: span.index === frameIndex ? 'keyframe' : 'held',
      },
    });
  }
  return {
    frameIndex,
    authoredStateStart,
    nextStateStart,
    heldFrameRange: [authoredStateStart, nextStateStart],
    heldFrameCount: nextStateStart - authoredStateStart,
    layers,
  };
}

function matrixForSymbol(element) {
  const matrixWrapper = getFlaXflDirectChildren(element.xml, element.name)
    .find((child) => child.name === 'matrix');
  if (!matrixWrapper) return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const matrix = getFlaXflDirectChildren(matrixWrapper.xml, 'matrix')
    .find((child) => child.name === 'Matrix');
  const attributes = matrix?.attributes ?? matrixWrapper.attributes;
  return {
    a: Number(attributes.a ?? 1),
    b: Number(attributes.b ?? 0),
    c: Number(attributes.c ?? 0),
    d: Number(attributes.d ?? 1),
    tx: Number(attributes.tx ?? 0),
    ty: Number(attributes.ty ?? 0),
  };
}

function rawInstancesInSpan(span) {
  const frameChildren = getFlaXflDirectChildren(span.sourceFrame.xml, 'DOMFrame');
  const elements = frameChildren.find((child) => child.name === 'elements');
  if (!elements) return [];
  return getFlaXflDirectChildren(elements.xml, elements.name)
    .filter((element) => element.name === 'DOMSymbolInstance')
    .filter((element) => element.attributes.isVisible !== 'false' && element.attributes.visible !== 'false')
    .map((element) => ({
      libraryItemName: normalizeName(element.attributes.libraryItemName),
      symbolType: (element.attributes.symbolType || 'graphic').trim().toLocaleLowerCase('en-US'),
      playbackMode: element.attributes.loop?.trim().toLocaleLowerCase('en-US') ?? null,
      firstFrame: element.attributes.firstFrame ?? null,
      lastFrame: element.attributes.lastFrame ?? null,
      containingSpan: { start: span.index, duration: span.duration, endExclusive: span.endExclusive },
      transform: matrixForSymbol(element),
      visible: true,
    }));
}

function rawInstancesAtFrame(descriptor, frameIndex) {
  const instances = [];
  for (const [layerIndex, layer] of descriptor.frameSpanIndex.layers.entries()) {
    if (!layer.visible) continue;
    const span = layer.spans.find((candidate) =>
      frameIndex >= candidate.index && frameIndex < candidate.endExclusive,
    );
    if (!span) continue;
    for (const instance of rawInstancesInSpan(span)) instances.push({ ...instance, layerIndex });
  }
  return instances;
}

function displaySymbolNames(frameContext) {
  const result = [];
  for (const layer of frameContext.layers) {
    if (!layer.visible) continue;
    for (const element of layer.elements) {
      if (element.kind === 'symbol' && element.visible !== false) result.push(normalizeName(element.libraryItemName));
    }
  }
  return result.sort();
}

function rawSymbolNames(instances) {
  return instances.map((instance) => instance.libraryItemName).sort();
}

function censusStateIndex(census) {
  const graphics = new Map();
  for (const timeline of census.graphicTimelines) {
    const byFrame = new Map(timeline.states.map((state) => [state.frameIndex, state]));
    graphics.set(timeline.sourceLibraryItemName, { timeline, byFrame });
  }
  return graphics;
}

function sourceClassesFor(censusClasses, stateDetails) {
  const classes = [...new Set(censusClasses ?? [])];
  const pureHeldState = stateDetails.heldFrameCount > 1 &&
    stateDetails.layers.filter((layer) => layer.selected).every((layer) => layer.selected.tweenType === 'none');
  if (pureHeldState && !classes.includes('DUPLICATE_OR_HELD_STATE')) {
    classes.push('DUPLICATE_OR_HELD_STATE');
  }
  if (stateDetails.layers.some((layer) => layer.selected?.tweenType === 'motion' || layer.selected?.tweenType === 'shape') &&
      !classes.includes('TEMPORAL_ACTION_CANDIDATE')) {
    classes.push('TEMPORAL_ACTION_CANDIDATE');
  }
  if (classes.length === 0) classes.push('UNKNOWN');
  return classes;
}

function boundaryAssessment(instances, source, parentFrame) {
  const unsupported = [];
  for (const instance of instances) {
    if (instance.symbolType !== 'graphic') {
      unsupported.push({ reasonCode: 'NON_GRAPHIC_NESTED_SYMBOL', instance });
      continue;
    }
    const symbol = findSymbol(source, instance.libraryItemName);
    if (!symbol) {
      unsupported.push({ reasonCode: 'MISSING_GRAPHIC_DEFINITION', instance });
      continue;
    }
    const mode = instance.playbackMode;
    const spanStart = instance.containingSpan.start;
    if (mode !== 'loop' || instance.firstFrame !== null || instance.lastFrame !== null || spanStart !== 0) {
      unsupported.push({
        reasonCode: 'OUTSIDE_ISSUE703_PROVEN_SYNC_SLICE',
        instance,
        childFrameCount: symbol.frameCount,
        evidence: 'The #703 contract slice is Graphic/loop, omitted firstFrame and lastFrame, containing span start 0.',
      });
      continue;
    }
    const relativeElapsed = parentFrame - spanStart;
    if (relativeElapsed < 0 || (symbol.frameCount > 1 && relativeElapsed >= symbol.frameCount)) {
      unsupported.push({
        reasonCode: 'UNTESTED_LOOP_WRAP_OR_OUT_OF_RANGE',
        instance,
        childFrameCount: symbol.frameCount,
        relativeElapsed,
      });
    }
  }
  return { supported: unsupported.length === 0, unsupported };
}

function copyRecord(candidate, sourceHash, parentFrame = null) {
  return {
    candidateId: candidate,
    sourceSha256: sourceHash,
    ...(parentFrame === null ? {} : { parentFrame }),
  };
}

function makeIdentity(sourceSha256, sourceAddress, renderAddressClass, renderAddress) {
  return candidateId(sourceSha256, {
    sourceAddress,
    renderAddressClass,
    renderAddress,
  });
}

function expectedCensusClass(state) {
  return Array.isArray(state?.classification) ? state.classification : [];
}

function classifyGraphicAddress(symbol, state, sourceClasses, stateDetails, nestedInputs, source) {
  if (sourceClasses.includes('FULL_CHARACTER_STATE')) {
    if (nestedInputs.length > 0) {
      const assessment = boundaryAssessment(nestedInputs, source, state.frameIndex);
      return assessment.supported
        ? { renderAddressClass: 'PARENT_COMPOSITE', disposition: 'SUPPORTED', reasonCode: 'FULL_STATE_REQUIRES_PARENT_CHILD_COMPOSITION' }
        : { renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN', disposition: 'FAIL_CLOSED', reasonCode: 'FULL_STATE_HAS_UNPROVEN_NESTED_TIMING', unsupported: assessment.unsupported };
    }
    return { renderAddressClass: 'DIRECT_FULL_CHARACTER_STATE', disposition: 'SUPPORTED', reasonCode: 'SOURCE_STATE_IS_ALREADY_COMPLETE' };
  }

  if (stateDetails.layers.some((layer) => layer.selected?.tweenType === 'motion' || layer.selected?.tweenType === 'shape')) {
    return { renderAddressClass: 'TEMPORAL_ONLY', disposition: 'ROUTE_TO_ISSUE694', reasonCode: 'AUTHORED_STATE_SPAN_USES_TWEEN' };
  }

  const assessment = boundaryAssessment(nestedInputs, source, state.frameIndex);
  if (!assessment.supported) {
    return {
      renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN',
      disposition: 'FAIL_CLOSED',
      reasonCode: 'NESTED_TIMING_OUTSIDE_ISSUE703_PROVEN_SLICE',
      unsupported: assessment.unsupported,
    };
  }
  if (sourceClasses.includes('COMPONENT_ASSET')) {
    return { renderAddressClass: 'DIRECT_COMPONENT_STATE', disposition: 'SUPPORTED_COMPONENT', reasonCode: 'SOURCE_CENSUS_IDENTIFIES_COMPONENT_ASSET' };
  }
  return { renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN', disposition: 'FAIL_CLOSED', reasonCode: 'NO_SUPPORTED_SOURCE_STATE_CLASS' };
}

function renderEvidenceFromCensus(state, evidencePathForCandidate, sourceHash) {
  if (!state.svg?.path || !state.png?.path || !state.svg?.sha256 || !state.png?.sha256) return null;
  return {
    origin: 'Issue #702 production inspection/render receipt; exact authored state output',
    sourceSha256: sourceHash,
    svgSha256: state.svg.sha256.toLowerCase(),
    pngSha256: state.png.sha256.toLowerCase(),
    svgPath: evidencePathForCandidate.svg,
    pngPath: evidencePathForCandidate.png,
    evidenceOnlyWhenDispositionIsNotSupported: true,
  };
}

function makeGraphicCandidate(sourceHash, symbol, state, stateDetails, censusState, nestedInputs, target, source) {
  const classes = sourceClassesFor(expectedCensusClass(censusState), stateDetails);
  const address = classifyGraphicAddress(symbol, state, classes, stateDetails, nestedInputs, source);
  const sourceAddress = {
    ownerKind: 'graphic-symbol',
    sourceLibraryItemName: symbol.sourceLibraryItemName,
    authoredFrameIndex: state.frameIndex,
  };
  const renderAddress = {
    rootKind: 'graphic',
    sourceLibraryItemName: symbol.sourceLibraryItemName,
    frameIndex: state.frameIndex,
    nestedSelections: nestedInputs.map((instance) => ({
      libraryItemName: instance.libraryItemName,
      symbolType: instance.symbolType,
      playbackMode: instance.playbackMode,
      firstFrame: instance.firstFrame,
      lastFrame: instance.lastFrame,
      containingSpan: instance.containingSpan,
    })),
  };
  const id = makeIdentity(sourceHash, sourceAddress, address.renderAddressClass, renderAddress);
  const priorRender = censusState;
  return {
    candidateId: id,
    sourceStateClasses: classes,
    primarySourceStateClass: classes.includes('FULL_CHARACTER_STATE')
      ? 'FULL_CHARACTER_STATE'
      : classes.includes('TEMPORAL_ACTION_CANDIDATE') && !classes.includes('COMPONENT_ASSET')
        ? 'TEMPORAL_ACTION_CANDIDATE'
        : classes.includes('COMPONENT_ASSET')
          ? 'COMPONENT_ASSET'
          : 'UNKNOWN',
    renderAddressClass: address.renderAddressClass,
    disposition: address.disposition,
    reasonCode: address.reasonCode,
    ...(address.unsupported ? { unsupportedInputs: address.unsupported } : {}),
    sourceProvenance: {
      sourceSha256: sourceHash,
      targetIdentity: target,
      sourceOwner: { kind: 'graphic-symbol', name: symbol.sourceLibraryItemName },
      authoredState: stateDetails,
      frameCount: symbol.frameCount,
      authoredSpanCountAtState: stateDetails.layers.filter((layer) => layer.selected?.authoredSpanStart === state.frameIndex).length,
      nestedSynchronizationInputs: nestedInputs,
    },
    renderAddress,
    renderability: {
      priorStaticSnapshotAvailable: Boolean(priorRender.svg?.path && priorRender.png?.path),
      semanticRenderSupported: address.disposition === 'SUPPORTED' || address.disposition === 'SUPPORTED_COMPONENT',
      note: address.disposition === 'FAIL_CLOSED'
        ? 'Prior static snapshot is diagnostic evidence only; it is not promoted as a source-correct render address.'
        : address.disposition === 'ROUTE_TO_ISSUE694'
          ? 'Only the authored state start was snapshotted; tween playback/interpolation is not claimed.'
          : 'The address stays within the source and #703-supported boundary.' ,
    },
    evidence: {
      issue702CandidateId: priorRender.candidateId,
      sourceStateClassification: priorRender.classification,
      referenceValidation: priorRender.referenceMatch ?? null,
      exactDuplicateGroup: priorRender.exactDuplicateGroup ?? null,
      render: null,
    },
  };
}

function makeSceneCandidate(sourceHash, scene, censusScene, sceneTarget, selectedParent) {
  const sourceAddress = { ownerKind: 'scene', sceneName: scene.name, authoredFrameIndex: 0 };
  const renderAddress = {
    rootKind: 'scene',
    sceneName: scene.name,
    documentFrameIndex: 0,
    parentGraphic: selectedParent,
  };
  const id = makeIdentity(sourceHash, sourceAddress, 'PARENT_COMPOSITE', renderAddress);
  return {
    candidateId: id,
    sourceStateClasses: ['FULL_CHARACTER_STATE'],
    primarySourceStateClass: 'FULL_CHARACTER_STATE',
    renderAddressClass: 'PARENT_COMPOSITE',
    disposition: 'SUPPORTED',
    reasonCode: 'SCENE_ROOT_RESOLVES_SOURCE_PARENT_GRAPHIC',
    validationReferencePose: censusScene.referenceMatch?.pose ?? null,
    sourceProvenance: {
      sourceSha256: sourceHash,
      targetIdentity: sceneTarget,
      sourceOwner: { kind: 'scene', name: scene.name },
      authoredState: { frameIndex: 0, frameCount: scene.frameCount, heldFrameRange: [0, scene.frameCount] },
      parentChain: [{ kind: 'graphic-symbol', name: selectedParent.sourceLibraryItemName, frameIndex: 0 }],
      nestedSynchronizationInputs: selectedParent.nestedSelections,
    },
    renderAddress,
    renderability: { priorStaticSnapshotAvailable: true, semanticRenderSupported: true },
    evidence: {
      issue702CandidateId: censusScene.candidateId,
      sourceStateClassification: censusScene.classification,
      referenceValidation: censusScene.referenceMatch,
      exactDuplicateGroup: censusScene.exactDuplicateGroup ?? null,
      render: null,
    },
  };
}

function buildParentSelection(source, parentSymbol, parentFrame) {
  const parentState = stateSpanDetails(parentSymbol, parentFrame);
  const parentContext = source.buildGraphicFrameContext(
    parentSymbol.timelineXml,
    parentSymbol.frameSpanIndex,
    parentFrame,
    `issue704-parent-${parentFrame}`,
  );
  assert.equal(parentContext.ok, true, parentContext.message || 'could not resolve parent Graphic state');
  const parentInstances = rawInstancesAtFrame(parentSymbol, parentFrame);
  const children = parentInstances.map((instance) => {
    const symbol = findSymbol(source, instance.libraryItemName);
    assert.ok(symbol, `parent child Graphic is missing: ${instance.libraryItemName}`);
    const elapsed = parentFrame - instance.containingSpan.start;
    const supportedMode = instance.symbolType === 'graphic' && instance.playbackMode === 'loop' &&
      instance.firstFrame === null && instance.lastFrame === null && instance.containingSpan.start === 0;
    const resolvedFrame = supportedMode ? elapsed % symbol.frameCount : null;
    const frameContext = resolvedFrame === null ? null : source.buildGraphicFrameContext(
      symbol.timelineXml,
      symbol.frameSpanIndex,
      resolvedFrame,
      `issue704-child-${symbol.sourceLibraryItemName}-${resolvedFrame}`,
    );
    if (frameContext) assert.equal(frameContext.ok, true, frameContext.message || 'could not resolve child Graphic state');
    const childNestedInputs = resolvedFrame === null ? [] : rawInstancesAtFrame(symbol, resolvedFrame);
    return {
      libraryItemName: symbol.sourceLibraryItemName,
      symbolType: instance.symbolType,
      parentSpan: instance.containingSpan,
      playbackMode: instance.playbackMode,
      firstFrame: instance.firstFrame,
      lastFrame: instance.lastFrame,
      childFrameCount: symbol.frameCount,
      parentFrame,
      relativeElapsed: elapsed,
      resolvedChildFrame: resolvedFrame,
      selectedChildState: resolvedFrame === null ? null : stateSpanDetails(symbol, resolvedFrame),
      nestedInputs: childNestedInputs,
      frameContext,
      selectionSupported: supportedMode && (symbol.frameCount === 1 || elapsed < symbol.frameCount),
    };
  });
  assert.equal(children.length, 3, `expected three visible child Graphics at 元件 1@${parentFrame}`);
  return { parentState, parentContext: parentContext.value, children };
}

function parentRouteIdentity(sourceHash, parentSymbol, parentFrame, children, routeClass) {
  const sourceAddress = {
    ownerKind: 'graphic-symbol',
    sourceLibraryItemName: parentSymbol.sourceLibraryItemName,
    authoredFrameIndex: 0,
    selectedParentFrame: parentFrame,
  };
  const renderAddress = {
    rootKind: 'scene',
    sceneName: '场景 1',
    documentFrameIndex: 0,
    parentGraphic: { sourceLibraryItemName: parentSymbol.sourceLibraryItemName, frameIndex: parentFrame },
    nestedSelections: children.map((child) => ({
      libraryItemName: child.libraryItemName,
      frameIndex: child.resolvedChildFrame,
    })),
  };
  return {
    sourceAddress,
    renderAddress,
    candidateId: makeIdentity(sourceHash, sourceAddress, routeClass, renderAddress),
    routeId: `ROUTE-${HASH(stableJson({ sourceHash, sourceAddress, renderAddress, routeClass })).slice(0, 20).toUpperCase()}`,
  };
}

function parentRouteStatus(parentFrame, selection, bodyB1State, parentSiblingCount) {
  const failedSelections = selection.children.filter((child) => !child.selectionSupported);
  if (failedSelections.length > 0) {
    return {
      status: 'FAIL_CLOSED',
      attemptedRenderAddressClass: 'PARENT_COMPOSITE',
      renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN',
      reasonCode: 'ROOT_GRAPHIC_CHILD_SELECTION_OUTSIDE_ISSUE703_PROVEN_SLICE',
      unsupportedInputs: failedSelections.map((child) => ({ libraryItemName: child.libraryItemName, span: child.parentSpan, firstFrame: child.firstFrame, lastFrame: child.lastFrame, playbackMode: child.playbackMode, resolvedChildFrame: child.resolvedChildFrame })),
    };
  }
  const nested = selection.children.flatMap((child) => child.nestedInputs.map((instance) => ({
    childOwner: child.libraryItemName,
    selectedChildFrame: child.resolvedChildFrame,
    ...instance,
  })));
  if (nested.length > 0) {
    const hasOutOfSliceMode = nested.some((instance) =>
      instance.playbackMode !== 'loop' || instance.firstFrame !== null || instance.lastFrame !== null,
    );
    const hasNonzeroSpan = nested.some((instance) => instance.containingSpan.start !== 0);
    return {
      status: 'FAIL_CLOSED',
      attemptedRenderAddressClass: 'PARENT_COMPOSITE',
      renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN',
      reasonCode: hasOutOfSliceMode
        ? 'DESCENDANT_PLAYBACK_OUTSIDE_ISSUE703_PROVEN_SLICE'
        : hasNonzeroSpan
          ? 'DESCENDANT_HAS_NONZERO_SPAN_ORIGIN'
          : 'DESCENDANT_TIMING_REQUIRES_UNPROVEN_NESTED_RESOLUTION',
      unsupportedInputs: nested,
    };
  }
  if (bodyB1State.classification.includes('FULL_CHARACTER_STATE') && parentSiblingCount > 1) {
    return {
      status: 'REJECTED_NON_PREFERRED',
      attemptedRenderAddressClass: 'PARENT_COMPOSITE',
      renderAddressClass: 'UNSUPPORTED_OR_UNKNOWN',
      reasonCode: 'COMPLETE_CHILD_STATE_MIXED_WITH_OUTER_SIBLINGS',
      explanation: 'The selected child is already a complete character; keeping the visible outer head/hair siblings creates the known source-incompatible mixed composition. Use the direct full-character child state.',
    };
  }
  return {
    status: 'SUPPORTED_PARENT_COMPOSITE',
    attemptedRenderAddressClass: 'PARENT_COMPOSITE',
    renderAddressClass: 'PARENT_COMPOSITE',
    reasonCode: 'CHILD_STATES_RESOLVED_FROM_SUPPORTED_DEFAULT_LOOP_INPUTS',
  };
}

async function copyVerifiedArtifact(sourceFile, expectedSha256, targetFile) {
  const expected = String(expectedSha256).toLowerCase();
  assert.ok(fs.existsSync(sourceFile), `source evidence artifact is missing: ${sourceFile}`);
  const sourceHash = await hashFile(sourceFile);
  assert.equal(sourceHash, expected, `source evidence artifact hash changed: ${sourceFile}`);
  await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
  if (fs.existsSync(targetFile)) {
    assert.equal(await hashFile(targetFile), expected, `refusing to overwrite unrelated artifact: ${targetFile}`);
  } else {
    await fs.promises.copyFile(sourceFile, targetFile);
  }
  assert.equal(await hashFile(targetFile), expected, `copied evidence artifact hash mismatch: ${targetFile}`);
  return { sha256: expected, byteLength: (await fs.promises.stat(targetFile)).size };
}

function relativeArtifactPath(artifactRoot, filePath) {
  return path.relative(artifactRoot, filePath).replaceAll('\\', '/');
}

async function attachRenderEvidence(row, evidence, artifactRoot, identityStem, provenance) {
  if (!evidence?.svgPath || !evidence?.pngPath || !evidence.svgSha256 || !evidence.pngSha256) return null;
  const svgTarget = path.join(artifactRoot, 'artifacts', `${identityStem}.svg`);
  const pngTarget = path.join(artifactRoot, 'artifacts', `${identityStem}.png`);
  const [svg, png] = await Promise.all([
    copyVerifiedArtifact(evidence.svgPath, evidence.svgSha256, svgTarget),
    copyVerifiedArtifact(evidence.pngPath, evidence.pngSha256, pngTarget),
  ]);
  const attached = {
    origin: provenance,
    svgSha256: svg.sha256,
    pngSha256: png.sha256,
    svgPath: relativeArtifactPath(artifactRoot, svgTarget),
    pngPath: relativeArtifactPath(artifactRoot, pngTarget),
    outputDirectory: artifactRoot,
  };
  row.evidence.render = attached;
  return attached;
}

function syncRenderAt(syncRun, parentFrame) {
  const found = syncRun.renders.find((entry) =>
    entry.hypothesis.startsWith('H1') && entry.parentFrame === parentFrame,
  );
  assert.ok(found, `Issue #703 evidence has no H1 render for parent frame ${parentFrame}`);
  return {
    svgPath: found.svg.path,
    svgSha256: found.svg.sha256,
    pngPath: found.png.path,
    pngSha256: found.png.sha256,
  };
}

async function loadProductionSource(archiveBytes) {
  const zip = await JSZip.loadAsync(archiveBytes);
  const document = zip.file('DOMDocument.xml');
  assert.ok(document, 'normalized FLA has no DOMDocument.xml');
  const docXml = await document.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraryXmlEntries.push({ name, xml: await file.async('string') });
  }
  const adapted = adaptFlaXflDisplaySource(docXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL display adapter failed');
  return adapted.source;
}

function findTarget(census, kind, sourceName = null) {
  return census.targetCatalog.find((entry) => entry.kind === kind &&
    (sourceName === null ? entry.sourceLibraryItemName == null : entry.sourceLibraryItemName === sourceName));
}

async function buildAnalysis(source, census, syncReceipt, syncRun, sourceHash, referenceHash, artifactRoot, inputHashes) {
  assert.equal(census.issue, 702);
  assert.equal(census.source.sha256Before.toLowerCase(), sourceHash);
  assert.equal(census.issue703SupersedingResult.issue, 703);
  assert.equal(syncReceipt.issue, 703);
  assert.equal(syncReceipt.source.sha256Before.toLowerCase(), sourceHash);
  assert.equal(syncReceipt.reference.sha256Before.toLowerCase(), referenceHash);
  assert.equal(syncRun.issue, 703);

  const scene = source.sceneTimelines[0];
  assert.ok(scene, 'Black source has no Scene timeline');
  assert.equal(scene.frameCount, 1, 'this bounded report expects the one-frame Black Scene wrapper');
  const sceneInstance = census.sceneCandidateState.nestedStateInputs
    .flatMap((layer) => layer.instances).find((instance) => instance.symbolType === 'graphic');
  assert.ok(sceneInstance, 'Scene anchor has no root Graphic instance');
  const parentSymbol = findSymbol(source, sceneInstance.libraryItemName);
  assert.ok(parentSymbol, 'Scene root Graphic definition is missing');
  const parentTarget = findTarget(census, 'graphic-symbol', parentSymbol.sourceLibraryItemName);
  assert.ok(parentTarget, 'parent Graphic target is absent from the B1 target catalog');

  const graphicCensus = censusStateIndex(census);
  assert.equal(source.graphicSymbols.length, census.graphicTimelines.length, 'production adapter and B1 Graphic catalogs disagree');
  const authoredGraphicStateCount = source.graphicSymbols.reduce((sum, symbol) => {
    const censusTimeline = graphicCensus.get(symbol.sourceLibraryItemName);
    assert.ok(censusTimeline, `B1 census is missing ${symbol.sourceLibraryItemName}`);
    const starts = authoredStarts(symbol);
    assert.deepEqual(starts, censusTimeline.timeline.selectedAuthoredStateIndices,
      `authored state starts differ from B1 for ${symbol.sourceLibraryItemName}`);
    assert.equal(starts.length, censusTimeline.timeline.states.length,
      `authored state count differs from B1 for ${symbol.sourceLibraryItemName}`);
    return sum + starts.length;
  }, 0);
  assert.equal(authoredGraphicStateCount, 29, 'Black B1 evidence expects 29 distinct Graphic authored-state starts');
  assert.equal(census.candidateStateCount, authoredGraphicStateCount + 1, 'B1 census candidate count should be Scene anchor plus Graphic state starts');

  const candidates = [];
  const copiedRenders = [];
  const sceneTarget = findTarget(census, 'scene');
  assert.ok(sceneTarget, 'Scene target is absent from the B1 target catalog');
  // The Scene adapter does not expose span indexes; retain the exact Scene
  // instance input from the B1 receipt and assert it resolves to the source root.
  const rootNameFromDisplay = displaySymbolNames(scene.frameContext).find((name) => findSymbol(source, name));
  assert.equal(rootNameFromDisplay, parentSymbol.sourceLibraryItemName, 'Scene root differs between B1 and production adapter');
  const selectedParent = {
    sourceLibraryItemName: parentSymbol.sourceLibraryItemName,
    frameIndex: 0,
    nestedSelections: rawInstancesAtFrame(parentSymbol, 0).map((instance) => ({
      libraryItemName: instance.libraryItemName,
      frameIndex: 0,
      symbolType: instance.symbolType,
      playbackMode: instance.playbackMode,
      firstFrame: instance.firstFrame,
      lastFrame: instance.lastFrame,
      containingSpan: instance.containingSpan,
    })),
  };
  const sceneCandidate = makeSceneCandidate(sourceHash, scene, census.sceneCandidateState, sceneTarget, selectedParent);
  candidates.push(sceneCandidate);

  const sceneArtifact = census.sceneCandidateState.artifact;
  const sceneRender = await attachRenderEvidence(sceneCandidate, {
    svgPath: sceneArtifact.svgPath,
    svgSha256: sceneArtifact.svgSha256,
    pngPath: sceneArtifact.pngPath,
    pngSha256: sceneArtifact.pngSha256,
  }, artifactRoot, sceneCandidate.candidateId, '#702 Scene control production render');
  assert.ok(sceneRender, 'Scene A control render is missing');
  copiedRenders.push({ candidateId: sceneCandidate.candidateId, ...sceneRender });

  const graphicCandidatesByAddress = new Map();
  for (const symbol of source.graphicSymbols) {
    const evidenceTimeline = graphicCensus.get(symbol.sourceLibraryItemName);
    const target = findTarget(census, 'graphic-symbol', symbol.sourceLibraryItemName);
    assert.ok(target, `B1 target catalog is missing ${symbol.sourceLibraryItemName}`);
    for (const frameIndex of authoredStarts(symbol)) {
      const context = source.buildGraphicFrameContext(
        symbol.timelineXml,
        symbol.frameSpanIndex,
        frameIndex,
        `issue704:${symbol.sourceLibraryItemName}:${frameIndex}`,
      );
      assert.equal(context.ok, true, context.message || `production adapter failed at ${symbol.sourceLibraryItemName}@${frameIndex}`);
      const stateDetails = stateSpanDetails(symbol, frameIndex);
      const censusState = evidenceTimeline.byFrame.get(frameIndex);
      assert.ok(censusState, `B1 candidate missing for ${symbol.sourceLibraryItemName}@${frameIndex}`);
      assert.deepEqual(displaySymbolNames(context.value), rawSymbolNames(rawInstancesAtFrame(symbol, frameIndex)),
        `source instances differ between raw XFL and production adapter at ${symbol.sourceLibraryItemName}@${frameIndex}`);
      const nestedInputs = rawInstancesAtFrame(symbol, frameIndex);
      const candidate = makeGraphicCandidate(sourceHash, symbol, { frameIndex }, stateDetails, censusState, nestedInputs, target, source);
      const identityKey = `${symbol.sourceLibraryItemName}\u0000${frameIndex}`;
      assert.ok(!graphicCandidatesByAddress.has(identityKey), `duplicate authored state ${symbol.sourceLibraryItemName}@${frameIndex}`);
      graphicCandidatesByAddress.set(identityKey, candidate);
      candidates.push(candidate);

      const render = await attachRenderEvidence(candidate, {
        svgPath: censusState.svg.path,
        svgSha256: censusState.svg.sha256,
        pngPath: censusState.png.path,
        pngSha256: censusState.png.sha256,
      }, artifactRoot, candidate.candidateId, '#702 authored-state production render');
      if (render) copiedRenders.push({ candidateId: candidate.candidateId, ...render });
    }
  }

  const bodySymbol = parentSymbol.frameSpanIndex.layers.length > 0
    ? rawInstancesAtFrame(parentSymbol, 0)
      .map((instance) => findSymbol(source, instance.libraryItemName))
      .filter(Boolean)
      .find((symbol) => symbol.frameCount === 1927)
    : null;
  assert.ok(bodySymbol, 'could not identify the Black parent body Graphic through source structure');
  const parentSpan = rawInstancesAtFrame(parentSymbol, 0);
  assert.equal(parentSpan.length, 3, 'Black parent should contain three nested Graphic instances');
  const bodyEvidenceStates = graphicCensus.get(bodySymbol.sourceLibraryItemName);
  assert.ok(bodyEvidenceStates, 'B1 body timeline classification evidence is missing');
  const syncPoseChildren = new Map([
    ['B', syncReceipt.renders.poseB.resolvedNestedFrames],
    ['C', syncReceipt.renders.poseC.resolvedNestedFrames],
  ]);
  const poseLabelByBodyFrame = new Map();
  for (const [pose, children] of syncPoseChildren) {
    const bodyChild = children.find((child) => child.includes(`${bodySymbol.sourceLibraryItemName}@`));
    assert.ok(bodyChild, `#703 superseding result for ${pose} has no body child`);
    const frameIndex = Number(bodyChild.slice(bodyChild.lastIndexOf('@') + 1));
    poseLabelByBodyFrame.set(frameIndex, pose);
  }

  const routeProbes = [];
  const bodyStarts = authoredStarts(bodySymbol);
  const parentStateStarts = bodyStarts
    .map((bodyFrame) => ({ bodyFrame, parentFrame: bodyFrame + parentSpan.find((item) => item.libraryItemName === bodySymbol.sourceLibraryItemName).containingSpan.start }))
    .filter((entry) => entry.parentFrame < parentSymbol.frameCount);
  for (const entry of parentStateStarts) {
    const selection = buildParentSelection(source, parentSymbol, entry.parentFrame);
    const bodyState = bodyEvidenceStates.byFrame.get(entry.bodyFrame);
    assert.ok(bodyState, `B1 body state missing for frame ${entry.bodyFrame}`);
    const status = parentRouteStatus(entry.parentFrame, selection, bodyState, selection.children.length);
    const identity = parentRouteIdentity(sourceHash, parentSymbol, entry.parentFrame, selection.children, status.renderAddressClass);
    const pose = poseLabelByBodyFrame.get(entry.bodyFrame) ?? null;
    let representedCandidateId = null;
    let render = null;

    if (status.status === 'SUPPORTED_PARENT_COMPOSITE' && entry.parentFrame === 0) {
      representedCandidateId = sceneCandidate.candidateId;
      const renderReceipt = syncRenderAt(syncRun, 0);
      assert.equal(renderReceipt.svgSha256.toLowerCase(), sceneArtifact.svgSha256.toLowerCase(), 'A scene and #703 parent control SVG differ');
      assert.equal(renderReceipt.pngSha256.toLowerCase(), sceneArtifact.pngSha256.toLowerCase(), 'A scene and #703 parent control PNG differ');
    } else if (status.status === 'SUPPORTED_PARENT_COMPOSITE') {
      assert.ok(pose === 'B' || pose === 'C', `unexpected promotable parent-composite candidate at frame ${entry.parentFrame}`);
      const poseEvidence = syncReceipt.renders[pose === 'B' ? 'poseB' : 'poseC'];
      const renderReceipt = syncRenderAt(syncRun, entry.parentFrame);
      assert.equal(renderReceipt.svgSha256.toLowerCase(), poseEvidence.svgSha256.toLowerCase(), `#703 SVG receipt mismatch for Pose ${pose}`);
      assert.equal(renderReceipt.pngSha256.toLowerCase(), poseEvidence.pngSha256.toLowerCase(), `#703 PNG receipt mismatch for Pose ${pose}`);
      const parentCandidate = {
        candidateId: identity.candidateId,
        sourceStateClasses: ['FULL_CHARACTER_STATE'],
        primarySourceStateClass: 'FULL_CHARACTER_STATE',
        renderAddressClass: 'PARENT_COMPOSITE',
        disposition: 'SUPPORTED',
        reasonCode: 'SOURCE_DERIVED_COMPONENT_STATES_FORM_COMPLETE_PARENT_COMPOSITION',
        validationReferencePose: pose,
        sourceProvenance: {
          sourceSha256: sourceHash,
          targetIdentity: findTarget(census, 'scene'),
          sourceOwner: { kind: 'scene', name: scene.name },
          authoredState: { frameIndex: 0, frameCount: scene.frameCount, heldFrameRange: [0, scene.frameCount] },
          parentChain: [
            { kind: 'scene', name: scene.name, frameIndex: 0 },
            {
              kind: 'graphic-symbol',
              name: parentSymbol.sourceLibraryItemName,
              parentFrame: entry.parentFrame,
              authoredStateStart: 0,
              heldFrameRange: selection.parentState.heldFrameRange,
              tweenTypes: [...new Set(selection.parentState.layers.flatMap((layer) => layer.selected ? [layer.selected.tweenType] : []))],
            },
            {
              kind: 'graphic-symbol',
              name: bodySymbol.sourceLibraryItemName,
              childFrame: entry.bodyFrame,
              authoredState: bodyState.frameIndex,
              heldFrameRange: bodyState.heldFrameRange,
              sourceStateClasses: bodyState.classification,
            },
          ],
          nestedSynchronizationInputs: selection.children.map((child) => ({
            libraryItemName: child.libraryItemName,
            symbolType: child.symbolType,
            parentSpan: child.parentSpan,
            playbackMode: child.playbackMode,
            firstFrame: child.firstFrame,
            lastFrame: child.lastFrame,
            childFrameCount: child.childFrameCount,
            parentFrame: child.parentFrame,
            relativeElapsed: child.relativeElapsed,
            resolvedChildFrame: child.resolvedChildFrame,
            selectedChildState: child.selectedChildState,
          })),
        },
        renderAddress: identity.renderAddress,
        renderability: { priorStaticSnapshotAvailable: true, semanticRenderSupported: true },
        evidence: {
          issue703SyncRule: syncReceipt.verifiedSynchronizationRule,
          referenceValidation: { pose, status: syncReceipt.renders[pose === 'B' ? 'poseB' : 'poseC'].referenceStatus },
          render: null,
        },
      };
      candidates.push(parentCandidate);
      render = await attachRenderEvidence(parentCandidate, {
        svgPath: renderReceipt.svgPath,
        svgSha256: renderReceipt.svgSha256,
        pngPath: renderReceipt.pngPath,
        pngSha256: renderReceipt.pngSha256,
      }, artifactRoot, parentCandidate.candidateId, '#703 source-derived parent-composite render');
      copiedRenders.push({ candidateId: parentCandidate.candidateId, ...render });
      representedCandidateId = parentCandidate.candidateId;
    } else if (status.status === 'REJECTED_NON_PREFERRED') {
      const renderReceipt = syncRenderAt(syncRun, entry.parentFrame);
      const routeRender = {
        svgPath: renderReceipt.svgPath,
        svgSha256: renderReceipt.svgSha256,
        pngPath: renderReceipt.pngPath,
        pngSha256: renderReceipt.pngSha256,
      };
      const renderTargets = {
        svg: path.join(artifactRoot, 'artifacts', `${identity.routeId}.svg`),
        png: path.join(artifactRoot, 'artifacts', `${identity.routeId}.png`),
      };
      const [svg, png] = await Promise.all([
        copyVerifiedArtifact(routeRender.svgPath, routeRender.svgSha256, renderTargets.svg),
        copyVerifiedArtifact(routeRender.pngPath, routeRender.pngSha256, renderTargets.png),
      ]);
      render = {
        origin: '#703 diagnostic parent route render; evidence for rejection only',
        svgSha256: svg.sha256,
        pngSha256: png.sha256,
        svgPath: relativeArtifactPath(artifactRoot, renderTargets.svg),
        pngPath: relativeArtifactPath(artifactRoot, renderTargets.png),
      };
      copiedRenders.push({ routeId: identity.routeId, ...render });
    }

    routeProbes.push({
      routeId: identity.routeId,
      parentFrame: entry.parentFrame,
      representedParentFrameRange: entry.parentFrame === 11 ? [11, parentSymbol.frameCount] : [entry.parentFrame, entry.parentFrame + 1],
      bodyAuthoredFrame: entry.bodyFrame,
      candidateId: representedCandidateId,
      attemptedRenderAddressClass: status.attemptedRenderAddressClass,
      renderAddressClass: status.renderAddressClass,
      status: status.status,
      reasonCode: status.reasonCode,
      ...(status.explanation ? { explanation: status.explanation } : {}),
      ...(status.unsupportedInputs ? { unsupportedInputs: status.unsupportedInputs } : {}),
      resolvedChildren: selection.children.map((child) => ({
        libraryItemName: child.libraryItemName,
        frameIndex: child.resolvedChildFrame,
        span: child.parentSpan,
        playbackMode: child.playbackMode,
        firstFrame: child.firstFrame,
        lastFrame: child.lastFrame,
      })),
      ...(render ? status.status === 'REJECTED_NON_PREFERRED'
        ? { rejectionRender: render }
        : { supportedRenderEvidence: render }
        : {}),
    });
  }

  assert.equal(routeProbes.length, 12, 'expected one route probe per body authored start, with the long parent hold represented once');
  assert.deepEqual(routeProbes.filter((route) => route.status === 'SUPPORTED_PARENT_COMPOSITE').map((route) => route.parentFrame), [0, 6, 7]);
  assert.deepEqual(routeProbes.filter((route) => route.status === 'REJECTED_NON_PREFERRED').map((route) => route.parentFrame), [8, 9, 10]);
  assert.ok(routeProbes.some((route) => route.status === 'FAIL_CLOSED' && route.parentFrame === 5 &&
    route.unsupportedInputs?.some((item) => item.playbackMode === 'single frame' && item.firstFrame !== null)),
  'single-frame/explicit-firstFrame boundary probe did not fail closed');
  assert.ok(routeProbes.some((route) => route.status === 'FAIL_CLOSED' && route.parentFrame === 11 &&
    route.unsupportedInputs?.some((item) => item.containingSpan?.start === 11)),
  'nonzero descendant span-origin probe did not fail closed');

  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  assert.equal(new Set(candidateIds).size, candidates.length, 'candidate identity collision');
  candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  routeProbes.sort((left, right) => left.parentFrame - right.parentFrame);
  const sourceClassCounts = {};
  const addressClassCounts = {};
  for (const candidate of candidates) {
    for (const classification of candidate.sourceStateClasses) sourceClassCounts[classification] = (sourceClassCounts[classification] ?? 0) + 1;
    addressClassCounts[candidate.renderAddressClass] = (addressClassCounts[candidate.renderAddressClass] ?? 0) + 1;
  }

  const validationControls = {
    A: candidates.filter((candidate) => candidate.validationReferencePose === 'A').map((candidate) => candidate.candidateId),
    B: candidates.filter((candidate) => candidate.validationReferencePose === 'B').map((candidate) => candidate.candidateId),
    C: candidates.filter((candidate) => candidate.validationReferencePose === 'C').map((candidate) => candidate.candidateId),
    D: candidates.filter((candidate) => candidate.evidence.referenceValidation?.pose === 'D').map((candidate) => candidate.candidateId),
    E: candidates.filter((candidate) => candidate.evidence.referenceValidation?.pose === 'E').map((candidate) => candidate.candidateId),
    unmatchedFullCharacter: candidates.filter((candidate) =>
      candidate.primarySourceStateClass === 'FULL_CHARACTER_STATE' && candidate.validationReferencePose == null &&
      candidate.sourceProvenance.sourceOwner.kind === 'graphic-symbol' &&
      candidate.sourceProvenance.sourceOwner.name === bodySymbol.sourceLibraryItemName &&
      candidate.sourceProvenance.authoredState.frameIndex === 10,
    ).map((candidate) => candidate.candidateId),
  };

  assert.ok(validationControls.A.length >= 1, 'A parent-composite control is missing');
  assert.equal(validationControls.B.length, 1, 'B must map to exactly one derived parent-composite candidate');
  assert.equal(validationControls.C.length, 1, 'C must map to exactly one derived parent-composite candidate');
  assert.equal(validationControls.D.length, 1, 'D direct full-character control is missing');
  assert.equal(validationControls.E.length, 1, 'E direct full-character control is missing');
  assert.equal(validationControls.unmatchedFullCharacter.length, 1, 'unmatched @10 full-character control is missing');

  const componentControls = {
    head: candidates.find((candidate) =>
      candidate.sourceProvenance.sourceOwner.kind === 'graphic-symbol' &&
      candidate.sourceProvenance.sourceOwner.name === '补间 1' &&
      candidate.sourceProvenance.authoredState.frameIndex === 0 &&
      candidate.renderAddressClass === 'DIRECT_COMPONENT_STATE',
    )?.candidateId ?? null,
    body: candidates.find((candidate) =>
      candidate.sourceProvenance.sourceOwner.kind === 'graphic-symbol' &&
      candidate.sourceProvenance.sourceOwner.name === bodySymbol.sourceLibraryItemName &&
      candidate.sourceProvenance.authoredState.frameIndex === 6 &&
      candidate.renderAddressClass === 'DIRECT_COMPONENT_STATE',
    )?.candidateId ?? null,
  };
  assert.ok(componentControls.head && componentControls.body, 'head/body component controls must remain DIRECT_COMPONENT_STATE');
  assert.ok(candidates.some((candidate) => candidate.sourceStateClasses.includes('TEMPORAL_ACTION_CANDIDATE')),
    'temporal/action candidate class is absent');
  assert.ok(candidates.some((candidate) => candidate.sourceStateClasses.includes('DUPLICATE_OR_HELD_STATE')),
    'held state class is absent');
  assert.ok(candidates.some((candidate) => candidate.renderAddressClass === 'TEMPORAL_ONLY'), 'TEMPORAL_ONLY route class is absent');
  assert.ok(candidates.some((candidate) => candidate.renderAddressClass === 'UNSUPPORTED_OR_UNKNOWN'), 'unsupported/unknown class is absent');

  const sceneRootNames = rawSymbolNames(rawInstancesAtFrame(parentSymbol, 0));
  const stateStartTotals = source.graphicSymbols.reduce((sum, symbol) => sum + authoredStarts(symbol).length, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 704,
    evidenceParents: [702, 703],
    motherPullRequest: 677,
    source: {
      fileName: census.source.fileName,
      localPath: census.source.localPath,
      sha256: sourceHash,
      normalizedArchiveSha256: census.source.normalizedArchiveSha256,
      referenceFileName: census.reference.fileName,
      referenceLocalPath: census.reference.localPath,
      referenceSha256: referenceHash,
    },
    evidenceInputs: {
      censusIssue: 702,
      censusSha256: inputHashes.censusSha256,
      syncReceiptSha256: inputHashes.syncReceiptSha256,
      syncRunReceiptSha256: inputHashes.syncRunReceiptSha256,
      productionAdapter: 'adaptFlaXflDisplaySource from dist-electron/main/services/fla-static-snapshot-display-list-adapter.js',
      priorRenderEvidence: 'Exact SVG/PNG files from #702 and #703 were hash-verified and copied to the B2 acceptance directory; no renderer was added.',
    },
    enumeration: {
      sceneTimelineCount: source.sceneTimelines.length,
      sceneAuthoredStateCount: 1,
      graphicTimelineCount: source.graphicSymbols.length,
      graphicAuthoredStateStartCount: stateStartTotals,
      directSourceStateCandidateCount: stateStartTotals + 1,
      derivedParentCompositeCandidateCount: candidates.filter((candidate) =>
        candidate.validationReferencePose === 'B' || candidate.validationReferencePose === 'C',
      ).length,
      totalCandidateCount: candidates.length,
      policy: 'One state per distinct DOMFrame authored start (unioned across layers); held ranges are metadata on that state, not expanded frame candidates.',
      sourceClasses: sourceClassCounts,
      renderAddressClasses: addressClassCounts,
      sourceLibraryItemNameIsPartOfProvenance: true,
      displayLabelsUsedForIdentity: false,
      referenceLabelsUsedForIdentity: false,
      candidateIdMethod: 'SHA-256 of versioned source hash + source address + render-address class + concrete render address; no list order, random UUID, filename, or semantic pose label.',
    },
    candidates,
    parentRouteProbes: routeProbes,
    controls: {
      knownReferenceAddresses: validationControls,
      componentControls,
      rootChildNames: sceneRootNames,
      directFullStatesBypassParentComposition: true,
      heldSpansNotExpanded: true,
      incorrectParentRoutesRejected: [8, 9, 10],
      issue703BoundaryFailClosed: [5, 11],
      semanticPoseNamesInCandidateIdentity: false,
    },
    repeatability: {
      inProcessAnalysisPasses: 2,
      candidateIdsAndClassificationsIdentical: true,
      candidateCoreSha256: HASH(stableJson({ candidates, routeProbes, sourceClassCounts, addressClassCounts })),
      independentlyInvokedProcessRuns: 'Verified by comparing two separately invoked output manifests; recorded in the companion receipt.',
    },
    safety: {
      sourceSha256Before: sourceHash,
      referenceSha256Before: referenceHash,
      productionParserOrResolverChanged: false,
      rendererAdded: false,
      projectSchemaChanged: false,
      productUiChanged: false,
      sourceMutation: false,
      referenceMutation: false,
      tweenInterpolationImplemented: false,
      movieClipOrActionScriptRuntimeImplemented: false,
    },
    handoff: {
      b3MayAssume: [
        'Candidate identity is source-hash and source-address based, with render-address class and nested selections included.',
        'A/B/C are parent-composite routes within the #703 proven default-loop, omitted-bound, start-zero, non-wrap slice.',
        'D/E and the unmatched 补间 2@10 state are direct full-character Graphic states and bypass 元件 1.',
        'Each held authored state is emitted once with its half-open range.',
        'Component, temporal, and unsupported states remain separate from complete static character candidates.',
      ],
      b3MustNotAssume: [
        'Every frameCount value is a distinct useful pose.',
        'Every Graphic playback mode, explicit first/last frame, nonzero span origin, wrap, tween, or MovieClip route is supported.',
        'Direct full-character states should be wrapped in the outer parent composition.',
        'Reference labels or exact image hashes define source identity or semantic names.',
      ],
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [census, syncReceipt, syncRun] = await Promise.all([
    readJson(args.census),
    readJson(args.syncReceipt),
    readJson(args.syncRun),
  ]);
  const sourceBefore = await hashFile(args.source);
  const referenceBefore = await hashFile(args.reference);
  const inputHashes = {
    censusSha256: await hashFile(args.census),
    syncReceiptSha256: await hashFile(args.syncReceipt),
    syncRunReceiptSha256: await hashFile(args.syncRun),
  };
  const archiveBytes = await fs.promises.readFile(args.archive);
  const archiveHash = HASH(archiveBytes);
  assert.equal(sourceBefore, census.source.sha256Before.toLowerCase(), 'source FLA differs from #702');
  assert.equal(referenceBefore, census.reference.sha256Before.toLowerCase(), 'reference image differs from #702');
  assert.equal(archiveHash, census.source.normalizedArchiveSha256.toLowerCase(), '#702 normalized XFL archive differs');
  assert.equal(syncRun.source.sha256Before.toLowerCase(), sourceBefore, '#703 prototype used a different original source');
  assert.equal(syncRun.reference.sha256Before.toLowerCase(), referenceBefore, '#703 prototype used a different reference image');

  const source = await loadProductionSource(archiveBytes);
  const firstPass = await buildAnalysis(source, census, syncReceipt, syncRun, sourceBefore, referenceBefore, args.artifactDir, inputHashes);
  const secondPass = await buildAnalysis(source, census, syncReceipt, syncRun, sourceBefore, referenceBefore, args.artifactDir, inputHashes);
  assert.deepEqual(secondPass, firstPass, 'in-process discovery passes produced different manifests');

  const sourceAfter = await hashFile(args.source);
  const referenceAfter = await hashFile(args.reference);
  const archiveAfter = await hashFile(args.archive);
  assert.equal(sourceAfter, sourceBefore, 'source FLA changed during B2 analysis');
  assert.equal(referenceAfter, referenceBefore, 'reference image changed during B2 analysis');
  assert.equal(archiveAfter, archiveHash, 'normalized archive changed during B2 analysis');

  const manifest = {
    ...firstPass,
    evidenceDirectory: args.artifactDir,
    safety: {
      ...firstPass.safety,
      sourceSha256After: sourceAfter,
      referenceSha256After: referenceAfter,
      normalizedArchiveSha256After: archiveAfter,
    },
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.promises.mkdir(path.dirname(args.out), { recursive: true });
  await fs.promises.writeFile(args.out, serialized, { encoding: 'utf8', flag: 'w' });
  process.stdout.write(`${JSON.stringify({
    issue: 704,
    candidateCount: manifest.enumeration.totalCandidateCount,
    graphicAuthoredStates: manifest.enumeration.graphicAuthoredStateStartCount,
    sceneAuthoredStates: manifest.enumeration.sceneAuthoredStateCount,
    routeProbes: manifest.parentRouteProbes.length,
    candidateCoreSha256: manifest.repeatability.candidateCoreSha256,
    manifestSha256: HASH(serialized),
    out: args.out,
    evidenceDirectory: args.artifactDir,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
