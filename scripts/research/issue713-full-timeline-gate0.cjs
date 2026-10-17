#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ACCEPTED_MOTION_FRAME_KEYS = Object.freeze([
  'duration', 'index', 'keyMode', 'motionTweenSnap', 'tweenType',
]);
const ALLOWED_MOTION_FRAME_KEYS = new Set(ACCEPTED_MOTION_FRAME_KEYS);
const ALLOWED_MOTION_INSTANCE_KEYS = new Set([
  'centerPoint3DX', 'centerPoint3DY', 'firstFrame', 'lastFrame', 'libraryItemName', 'loop', 'selected', 'symbolType',
]);
const AUTHORING_ONLY_INSTANCE_KEYS = new Set(['centerPoint3DX', 'centerPoint3DY', 'selected']);
const UNSUPPORTED_MOTION_TAGS = new Set([
  'motionobject', 'motionpath', 'ease', 'customease', 'domtween', 'animationcore', 'propertycontainer',
  'motionobjectxml',
]);
const UNSUPPORTED_MOTION_ATTRIBUTES = new Set([
  'acceleration', 'easein', 'easeout', 'motionpath', 'orienttopath', 'rotate', 'rotatedirection',
  'rotatetimes', 'rotationdirection', 'rotationtimes', 'tweeneasing', 'motiontweenrotate',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--root-symbol-name') args.rootSymbolName = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'rootSymbolName', 'out']) {
    assert.ok(args[name], 'missing required option --' + name.replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase()));
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be a SHA-256 hex string');
  return {
    ...args,
    source: path.resolve(args.source),
    out: path.resolve(args.out),
  };
}

function assertExternalNewDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(
    relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Issue #713 acceptance evidence must remain outside the repository',
  );
  assert.ok(!fs.existsSync(directory), 'refusing to overwrite existing evidence directory: ' + directory);
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/gu)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function rootAttributes(xml, tagName) {
  const opening = new RegExp('<' + tagName + '\\b[^>]*>', 'u').exec(xml)?.[0];
  return opening ? tagAttributes(opening) : null;
}

function countTags(xml, tagName) {
  return [...xml.matchAll(new RegExp('<' + tagName + '\\b', 'giu'))].length;
}

function scanArchive(documentXml, libraries) {
  const xmlEntries = [{ name: 'DOMDocument.xml', xml: documentXml }, ...libraries];
  const tagCounts = Object.fromEntries([...UNSUPPORTED_MOTION_TAGS].map((tag) => [tag, 0]));
  const disallowedAttributes = new Set();
  const scriptLikeTags = new Set();
  const scriptLikeOccurrences = [];
  let domFrameCount = 0;
  const symbolTypes = [];

  for (const entry of xmlEntries) {
    domFrameCount += countTags(entry.xml, 'DOMFrame');
    for (const [tag] of Object.entries(tagCounts)) tagCounts[tag] += countTags(entry.xml, tag);
    for (const match of entry.xml.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>/gu)) {
      const tagName = match[1];
      if (/action.?script|^scripts?$/iu.test(tagName)) {
        scriptLikeTags.add(tagName);
        let payload = '';
        if (!match[0].endsWith('/>')) {
          const payloadStart = match.index + match[0].length;
          const closeTagIndex = entry.xml.indexOf(`</${tagName}>`, payloadStart);
          if (closeTagIndex >= 0) payload = entry.xml.slice(payloadStart, closeTagIndex);
        }
        scriptLikeOccurrences.push({
          library: entry.name,
          tag: tagName,
          hasNonWhitespacePayload: Boolean(payload.trim()),
        });
      }
      for (const attributeMatch of match[0].matchAll(/\s([A-Za-z_][\w:.-]*)\s*=/gu)) {
        const attributeName = attributeMatch[1].toLocaleLowerCase('en-US');
        if (UNSUPPORTED_MOTION_ATTRIBUTES.has(attributeName)) disallowedAttributes.add(attributeName);
      }
    }
    if (entry.name.startsWith('LIBRARY/')) {
      const symbol = rootAttributes(entry.xml, 'DOMSymbolItem');
      if (symbol) {
        const rawType = (symbol.symbolType || 'graphic').toLocaleLowerCase('en-US');
        symbolTypes.push({ library: entry.name, symbolType: rawType === 'movieclip' ? 'movie clip' : rawType });
      }
    }
  }

  return {
    libraryXmlCount: libraries.length,
    domFrameCount,
    unsupportedMotionTagCounts: tagCounts,
    disallowedMotionAttributes: [...disallowedAttributes].sort(),
    librarySymbolCount: symbolTypes.length,
    graphicSymbolCount: symbolTypes.filter((entry) => entry.symbolType === 'graphic').length,
    movieClipSymbolCount: symbolTypes.filter((entry) => entry.symbolType === 'movie clip').length,
    otherSymbolTypes: symbolTypes.filter((entry) => !['graphic', 'movie clip'].includes(entry.symbolType)),
    scriptLikeTags: [...scriptLikeTags].sort(),
    scriptLikeOccurrences,
  };
}

function directChildren(xml, parentName, getChildren) {
  return getChildren(xml, parentName);
}

function sourceElements(frame, getChildren) {
  const frameChildren = directChildren(frame.xml, 'DOMFrame', getChildren);
  const wrapper = frameChildren.find((child) => child.name === 'elements');
  return wrapper ? directChildren(wrapper.xml, 'elements', getChildren) : [];
}

function sourceMatrix(element, getChildren) {
  const children = directChildren(element.xml, element.name, getChildren);
  const wrapper = children.find((child) => child.name === 'matrix');
  const matrix = wrapper && directChildren(wrapper.xml, 'matrix', getChildren).find((child) => child.name === 'Matrix');
  if (!matrix) return null;
  const defaults = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    matrix.attributes[key] === undefined ? fallback : Number(matrix.attributes[key]),
  ]));
}

function sourceTransformationPoints(element, getChildren) {
  return directChildren(element.xml, element.name, getChildren)
    .filter((child) => child.name === 'transformationPoint')
    .flatMap((wrapper) => directChildren(wrapper.xml, 'transformationPoint', getChildren)
      .filter((child) => child.name === 'Point')
      .map((point) => point.attributes));
}

function summarizeElement(element, getChildren, graphicByName) {
  const attributes = element.attributes;
  const graphic = attributes.symbolType === 'graphic'
    ? graphicByName.get(attributes.libraryItemName)
    : null;
  const directSourceChildren = directChildren(element.xml, element.name, getChildren);
  return {
    kind: element.name,
    visible: attributes.visible !== 'false' && attributes.isVisible !== 'false',
    attributes,
    matrix: element.name === 'DOMSymbolInstance' ? sourceMatrix(element, getChildren) : null,
    matrixAttributes: directSourceChildren.filter((child) => child.name === 'matrix')
      .flatMap((wrapper) => directChildren(wrapper.xml, 'matrix', getChildren)
        .filter((child) => child.name === 'Matrix').map((child) => child.attributes)),
    sourceChildNames: directSourceChildren.map((child) => child.name),
    sourceChildDetails: directSourceChildren.map((child) => ({
      name: child.name,
      attributes: child.attributes,
      grandchildren: directChildren(child.xml, child.name, getChildren).map((grandchild) => ({
        name: grandchild.name,
        attributes: grandchild.attributes,
      })),
    })),
    transformationPoints: sourceTransformationPoints(element, getChildren),
    childGraphic: graphic ? {
      frameCount: graphic.frameCount,
      timelineName: graphic.userLabel,
    } : null,
  };
}

function spanAt(layer, frameIndex) {
  return layer.spans.find((span) => frameIndex >= span.index && frameIndex < span.endExclusive) ?? null;
}

function unsupportedMetadataIn(xml) {
  const tags = [...xml.matchAll(/<([A-Za-z_][\w:.-]*)\b/gu)].map((match) => match[1].toLocaleLowerCase('en-US'));
  const attributes = [...xml.matchAll(/\s([A-Za-z_][\w:.-]*)\s*=\s*"[^"]*"/gu)]
    .map((match) => match[1].toLocaleLowerCase('en-US'));
  return {
    tags: [...new Set(tags.filter((tag) => UNSUPPORTED_MOTION_TAGS.has(tag)))],
    attributes: [...new Set(attributes.filter((name) => UNSUPPORTED_MOTION_ATTRIBUTES.has(name)))],
  };
}

function inspectMotionPair(layerIndex, span, endSpan, getChildren, graphicByName, interpolate) {
  const result = {
    duration: span.duration,
    endFrameIndex: span.endExclusive,
    endpointPresent: Boolean(endSpan && endSpan.index === span.endExclusive),
    endpointFrames: null,
    metadataChecks: {},
    targetChecks: {},
    metadataScan: null,
    transformInterpolation: null,
    classification: 'BLOCKED',
    reason: null,
  };
  if (!endSpan || endSpan.index !== span.endExclusive) {
    result.reason = 'MISSING_ADJACENT_AUTHORED_END_KEYFRAME';
    return result;
  }

  const startFrame = span.sourceFrame;
  const endFrame = endSpan.sourceFrame;
  result.endpointFrames = {
    start: startFrame.attributes,
    end: endFrame.attributes,
  };
  const startKeys = Object.keys(startFrame.attributes).sort();
  const endKeys = Object.keys(endFrame.attributes).sort();
  const endpointOutgoingTweenType = endFrame.attributes.tweenType;
  const endpointOutgoingMotionMetadataSupported = endpointOutgoingTweenType === 'motion'
    ? endFrame.attributes.motionTweenSnap === 'true' && endFrame.attributes.keyMode === '22017'
    : (endpointOutgoingTweenType === undefined || endpointOutgoingTweenType === 'none') &&
      endFrame.attributes.motionTweenSnap === undefined &&
      (endFrame.attributes.keyMode === undefined || endFrame.attributes.keyMode === '15872');
  result.metadataChecks = {
    startKeySetMatchesAccepted: JSON.stringify(startKeys) === JSON.stringify(ACCEPTED_MOTION_FRAME_KEYS),
    endpointKeySetSupported: endKeys.every((name) => ALLOWED_MOTION_FRAME_KEYS.has(name)),
    startDefinesAcceptedMotion: startFrame.attributes.tweenType === 'motion' &&
      startFrame.attributes.motionTweenSnap === 'true' && startFrame.attributes.keyMode === '22017',
    startIndexAndDurationMatchSpan: Number(startFrame.attributes.index) === span.index &&
      Number(startFrame.attributes.duration) === span.duration,
    endIndexMatchesSpanEnd: Number(endFrame.attributes.index) === span.endExclusive,
    endpointOutgoingMetadataIsKnown: endpointOutgoingMotionMetadataSupported,
  };

  const startElements = sourceElements(startFrame, getChildren);
  const endElements = sourceElements(endFrame, getChildren);
  const startTarget = startElements.length === 1 && startElements[0].name === 'DOMSymbolInstance'
    ? startElements[0]
    : null;
  const endTarget = endElements.length === 1 && endElements[0].name === 'DOMSymbolInstance'
    ? endElements[0]
    : null;
  const startAttrs = startTarget?.attributes ?? {};
  const endAttrs = endTarget?.attributes ?? {};
  const allowedInstanceAttributes = (attributes) => Object.keys(attributes)
    .every((name) => ALLOWED_MOTION_INSTANCE_KEYS.has(name));
  const sameNonCenterAttributes = [...new Set([...Object.keys(startAttrs), ...Object.keys(endAttrs)])]
    .filter((name) => !AUTHORING_ONLY_INSTANCE_KEYS.has(name))
    .every((name) => startAttrs[name] === endAttrs[name]);
  const authoringOnlyInstanceMetadata = {
    differingAttributes: [...new Set([...Object.keys(startAttrs), ...Object.keys(endAttrs)])]
      .filter((name) => AUTHORING_ONLY_INSTANCE_KEYS.has(name) && startAttrs[name] !== endAttrs[name]),
    ignoredForDisplayListEquality: [...AUTHORING_ONLY_INSTANCE_KEYS],
  };
  const startElementChildren = startTarget ? directChildren(startTarget.xml, startTarget.name, getChildren) : [];
  const endElementChildren = endTarget ? directChildren(endTarget.xml, endTarget.name, getChildren) : [];
  const startMatrices = startElementChildren.filter((child) => child.name === 'matrix');
  const endMatrices = endElementChildren.filter((child) => child.name === 'matrix');
  const startPoints = startElementChildren.filter((child) => child.name === 'transformationPoint');
  const endPoints = endElementChildren.filter((child) => child.name === 'transformationPoint');
  const structuralChildrenSupported = (children, matrices, points) =>
    matrices.length === 1 && points.length <= 1 &&
    children.every((child) => child.name === 'matrix' || child.name === 'transformationPoint') &&
    (!points.length || directChildren(points[0].xml, 'transformationPoint', getChildren).length === 1);
  const transformationPointValuesFinite = (points) => points.flatMap((wrapper) =>
    directChildren(wrapper.xml, 'transformationPoint', getChildren)
      .filter((child) => child.name === 'Point')
      .flatMap((child) => Object.values(child.attributes)))
    .every((value) => Number.isFinite(Number(value)));
  const startMatrix = startTarget ? sourceMatrix(startTarget, getChildren) : null;
  const endMatrix = endTarget ? sourceMatrix(endTarget, getChildren) : null;
  const matrixValuesSupported = (target, wrappers) => {
    if (!target || wrappers.length !== 1) return false;
    const values = directChildren(wrappers[0].xml, 'matrix', getChildren);
    if (values.length !== 1 || values[0].name !== 'Matrix') return false;
    return Object.entries(values[0].attributes).every(([name, value]) =>
      ['a', 'b', 'c', 'd', 'tx', 'ty'].includes(name) && Number.isFinite(Number(value))) &&
      Object.values(sourceMatrix(target, getChildren) || {}).every(Number.isFinite);
  };
  const centersFinite = (attributes) => ['centerPoint3DX', 'centerPoint3DY']
    .every((name) => attributes[name] === undefined || Number.isFinite(Number(attributes[name])));
  const transformationPointStructureSupported = (points) => points.length <= 1 && points.every((wrapper) => {
    const pointValues = directChildren(wrapper.xml, 'transformationPoint', getChildren);
    return pointValues.length === 1 && pointValues[0].name === 'Point' &&
      Object.entries(pointValues[0].attributes).every(([name, value]) =>
        ['x', 'y'].includes(name) && Number.isFinite(Number(value)));
  });
  result.targetChecks = {
    exactlyOneElementAtEachEndpoint: startElements.length === 1 && endElements.length === 1,
    bothElementsVisible: Boolean(startTarget && endTarget &&
      startAttrs.visible !== 'false' && startAttrs.isVisible !== 'false' &&
      endAttrs.visible !== 'false' && endAttrs.isVisible !== 'false'),
    bothGraphicSymbols: startAttrs.symbolType === 'graphic' && endAttrs.symbolType === 'graphic',
    targetIdentityStable: Boolean(startAttrs.libraryItemName &&
      startAttrs.libraryItemName === endAttrs.libraryItemName),
    bothInstanceAttributeSetsAllowed: Boolean(startTarget && endTarget &&
      allowedInstanceAttributes(startAttrs) && allowedInstanceAttributes(endAttrs)),
    renderableInstanceAttributesStable: Boolean(startTarget && endTarget && sameNonCenterAttributes),
    authoringOnlyInstanceMetadata,
    centerPointsFinite: Boolean(startTarget && endTarget && centersFinite(startAttrs) && centersFinite(endAttrs)),
    directChildrenRemainMatrixAndOptionalTransformationPoint: Boolean(startTarget && endTarget &&
      structuralChildrenSupported(startElementChildren, startMatrices, startPoints) &&
      structuralChildrenSupported(endElementChildren, endMatrices, endPoints) &&
      matrixValuesSupported(startTarget, startMatrices) && matrixValuesSupported(endTarget, endMatrices) &&
      transformationPointStructureSupported(startPoints) && transformationPointStructureSupported(endPoints)),
    transformationPointsFinite: Boolean(startTarget && endTarget &&
      transformationPointValuesFinite(startPoints) && transformationPointValuesFinite(endPoints)),
    startMatrix,
    endMatrix,
    startInstanceAttributes: startAttrs,
    endInstanceAttributes: endAttrs,
    targetLibraryItemName: startAttrs.libraryItemName ?? null,
    targetNestedPlayback: startAttrs.loop ?? null,
    targetNestedFirstFrame: startAttrs.firstFrame ?? null,
    targetNestedLastFrame: startAttrs.lastFrame ?? null,
    targetNestedChildFrameCount: graphicByName.get(startAttrs.libraryItemName)?.frameCount ?? null,
    endpointElements: {
      start: startTarget ? summarizeElement(startTarget, getChildren, graphicByName) : null,
      end: endTarget ? summarizeElement(endTarget, getChildren, graphicByName) : null,
    },
  };

  const metadataScan = {
    start: unsupportedMetadataIn(startFrame.xml),
    end: unsupportedMetadataIn(endFrame.xml),
  };
  result.metadataScan = metadataScan;
  const noUnsupportedMetadata = [...metadataScan.start.tags, ...metadataScan.end.tags,
    ...metadataScan.start.attributes, ...metadataScan.end.attributes].length === 0;
  const allChecks = [
    ...Object.values(result.metadataChecks),
    ...Object.entries(result.targetChecks).filter(([key]) => key !== 'authoringOnlyInstanceMetadata')
      .map(([, value]) => value).filter((value) => typeof value === 'boolean'),
    noUnsupportedMetadata,
  ];
  if (!allChecks.every(Boolean)) {
    const failedChecks = Object.entries(result.metadataChecks)
      .filter(([, passed]) => !passed).map(([name]) => name)
      .concat(Object.entries(result.targetChecks)
        .filter(([key, value]) => key !== 'authoringOnlyInstanceMetadata' && typeof value === 'boolean' && !value)
        .map(([name]) => name));
    if (!noUnsupportedMetadata) failedChecks.push('unsupported easing/path metadata');
    result.reason = failedChecks.join(', ') || 'SOURCE_PAIR_OUTSIDE_BOUNDED_TRANSFORM_FAMILY';
    return result;
  }

  const duration = span.duration;
  const interpolationProofs = [];
  if (!startMatrix || !endMatrix || Object.values(startMatrix).some((value) => !Number.isFinite(value)) ||
      Object.values(endMatrix).some((value) => !Number.isFinite(value))) {
    result.reason = 'INVALID_OR_MISSING_ENDPOINT_MATRIX';
    return result;
  }
  for (let frameIndex = span.index + 1; frameIndex < span.endExclusive; frameIndex += 1) {
    const progress = (frameIndex - span.index) / duration;
    const interpolated = interpolate(startMatrix, endMatrix, progress);
    if (!interpolated.ok) {
      result.transformInterpolation = { ok: false, frameIndex, progress, code: interpolated.code, message: interpolated.message };
      result.reason = 'TRANSFORM_INTERPOLATION_FAILED_AT_F' + frameIndex + ': ' + interpolated.message;
      return result;
    }
    interpolationProofs.push({ frameIndex, progress, matrix: interpolated.matrix });
  }
  result.transformInterpolation = {
    ok: true,
    interiorFrameCount: interpolationProofs.length,
    allInteriorProgressValuesAccepted: true,
    proofs: interpolationProofs,
  };
  if ([2, 3].includes(duration)) {
    result.classification = 'SUPPORTED';
  } else {
    result.classification = 'NEEDS_BOUNDED_EXTENSION';
    result.reason = 'same transform-only source family; authorize authored duration ' + duration;
  }
  result.authorizedFamilyCandidate = true;
  result.layerIndex = layerIndex;
  return result;
}

function playbackSequence(instance, span, parentStart, frameCount, childFrameCount) {
  const mode = (instance.loop || '').trim().toLocaleLowerCase('en-US');
  const firstFrame = instance.firstFrame === undefined ? 0 : Number(instance.firstFrame);
  const lastFrame = instance.lastFrame === undefined ? childFrameCount - 1 : Number(instance.lastFrame);
  if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) ||
      firstFrame < 0 || lastFrame < firstFrame || lastFrame >= childFrameCount) {
    return { mode, firstFrame, lastFrame, status: 'BLOCKED_INVALID_FRAME_BOUNDS', selections: [] };
  }
  const selections = [];
  const start = Math.max(span.index, parentStart);
  const end = Math.min(span.endExclusive, parentStart + frameCount);
  for (let frame = start; frame < end; frame += 1) {
    const elapsed = frame - span.index;
    let selectedFrame;
    if (mode === 'single frame') selectedFrame = firstFrame;
    else if (mode === 'play once') selectedFrame = Math.min(firstFrame + elapsed, lastFrame);
    else if (mode === 'loop') {
      const length = lastFrame - firstFrame + 1;
      selectedFrame = firstFrame + (elapsed % length);
    } else {
      return { mode, firstFrame, lastFrame, status: 'BLOCKED_UNSUPPORTED_PLAYBACK_MODE', selections: [] };
    }
    selections.push({ parentFrame: frame, elapsedFromContainingSpan: elapsed, childFrame: selectedFrame });
  }
  return { mode, firstFrame, lastFrame, status: 'SOURCE_MODE_SEQUENCE', selections };
}

function produceFrameMap(source, descriptor, rootName, graphicByName) {
  const frames = [];
  let firstAdapterFailure = null;
  let firstNestedFailure = null;
  let firstDisplayListFailure = null;
  const { prepareFlaNestedGraphicFrameSelections } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'),
  );
  const { resolveFlaDisplayList } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'),
  );
  const statusForFrame = (frameIndex) => {
    const selections = descriptor.frameSpanIndex.layers
      .filter((layer) => layer.visible)
      .map((layer) => spanAt(layer, frameIndex));
    if (selections.some((span) => !span)) return 'BLOCKED';
    if (selections.some((span) => span.tweenType === 'motion' && frameIndex > span.index)) {
      return 'TWEEN_RECONSTRUCTED';
    }
    if (selections.some((span) => span.index === frameIndex)) return 'AUTHORED';
    return 'HELD';
  };
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
  const hashValue = (value) => HASH(Buffer.from(JSON.stringify(value), 'utf8'));
  for (let frameIndex = 0; frameIndex < descriptor.frameCount; frameIndex += 1) {
    const primary = buildAndResolve(frameIndex, 'issue713-gate0:' + rootName + '@' + frameIndex);
    const entry = { frameIndex, status: 'BLOCKED', adapter: { ok: primary.built.ok } };
    if (!primary.built.ok) {
      entry.adapter.reason = primary.built.message;
      if (!firstAdapterFailure) firstAdapterFailure = { frameIndex, message: primary.built.message };
    } else {
      const nested = primary.nested;
      entry.nested = { ok: nested.ok };
      if (nested.ok) {
        entry.nested.selections = nested.selections.map((selection) => ({
          sourceAddress: selection.sourceAddress,
          playbackMode: selection.playbackMode,
          childFrameCount: selection.childFrameCount,
          selectedChildFrameIndex: selection.selectedChildFrameIndex,
          selectionRule: selection.selectionRule,
        }));
      } else {
        entry.nested.reason = nested.message;
        if (!firstNestedFailure) firstNestedFailure = { frameIndex, message: nested.message };
      }

      if (!primary.resolved) {
        entry.displayList = { ok: false, reason: 'nested Graphic selection did not resolve' };
      } else {
        entry.displayList = { ok: primary.resolved.ok };
        if (!primary.resolved.ok) {
          entry.displayList.reason = primary.resolved.message;
          if (!firstDisplayListFailure) firstDisplayListFailure = {
            frameIndex,
            message: primary.resolved.message,
          };
        }
      }

      if (nested.ok && primary.resolved?.ok) {
        const repeated = buildAndResolve(frameIndex, 'issue713-gate0:' + rootName + '@' + frameIndex);
        const repeatedFrameContextSha256 = repeated.built.ok ? hashValue(repeated.built.value) : null;
        const primaryFrameContextSha256 = hashValue(primary.built.value);
        const selectionProjection = (value) => value?.ok ? value.selections.map((selection) => ({
          sourceAddress: selection.sourceAddress,
          playbackMode: selection.playbackMode,
          childFrameCount: selection.childFrameCount,
          selectedChildFrameIndex: selection.selectedChildFrameIndex,
          selectionRule: selection.selectionRule,
        })) : value;
        const primarySelectionSha256 = hashValue(selectionProjection(nested));
        const repeatedSelectionSha256 = repeated.nested
          ? hashValue(selectionProjection(repeated.nested))
          : null;
        const primaryDisplayListSha256 = hashValue(primary.resolved.displayList);
        const repeatedDisplayListSha256 = repeated.resolved?.ok
          ? hashValue(repeated.resolved.displayList)
          : null;
        entry.determinism = {
          repeatedAdapterOk: repeated.built.ok,
          repeatedNestedOk: Boolean(repeated.nested?.ok),
          repeatedDisplayListOk: Boolean(repeated.resolved?.ok),
          frameContextSha256: primaryFrameContextSha256,
          repeatedFrameContextSha256,
          selectionsSha256: primarySelectionSha256,
          repeatedSelectionsSha256: repeatedSelectionSha256,
          displayListSha256: primaryDisplayListSha256,
          repeatedDisplayListSha256,
          repeatedIdentical: repeated.built.ok && repeated.nested?.ok === true &&
            repeated.resolved?.ok === true &&
            repeatedFrameContextSha256 === primaryFrameContextSha256 &&
            repeatedSelectionSha256 === primarySelectionSha256 &&
            repeatedDisplayListSha256 === primaryDisplayListSha256,
        };
        entry.status = statusForFrame(frameIndex);
      }
    }
    frames.push(entry);
  }
  return {
    frames,
    firstAdapterFailure,
    firstNestedFailure,
    firstDisplayListFailure,
    graphicSymbolCount: graphicByName.size,
    statusCounts: frames.reduce((counts, frame) => ({
      ...counts,
      [frame.status]: (counts[frame.status] || 0) + 1,
    }), {}),
    repeatedDeterminismPass: frames.every((frame) => frame.determinism?.repeatedIdentical === true),
  };
}

async function buildCensus(args) {
  assertExternalNewDirectory(args.out);
  const sourceBytes = await fs.promises.readFile(args.source);
  const sourceSha256 = HASH(sourceBytes);
  assert.equal(sourceSha256, args.expectedSha256.toLowerCase(), 'primary FLA source hash changed');

  const classifier = require(path.join(ROOT, 'src/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : sourceBytes;
  const normalizedClassification = classifier.classifyForFlaRecovery(archiveBytes);
  assert.equal(normalizedClassification.state, classifier.STATES.STRICT_VALID,
    'in-memory normalized archive did not pass the strict source classifier');
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const document = zip.file('DOMDocument.xml');
  assert.ok(document, 'source archive is missing DOMDocument.xml');
  const documentXml = await document.async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraries.push({ name, xml: await file.async('string') });
  }
  const { adaptFlaXflDisplaySource, getFlaXflDirectChildren } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'),
  );
  const { interpolateFlaLinearMotionTransform } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-motion-tween-transform-interpolator.js'),
  );
  const adapted = adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the normalized archive');
  const source = adapted.source;
  const descriptor = source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === args.rootSymbolName);
  assert.ok(descriptor, 'locked root Graphic was not found in the adapted source');
  assert.equal(descriptor.frameCount, 47, 'locked root Graphic frame count changed');
  const graphicByName = new Map(source.graphicSymbols.map((symbol) => [symbol.sourceLibraryItemName, symbol]));
  const archiveEvidence = scanArchive(documentXml, libraries);
  const layerXml = getFlaXflDirectChildren(descriptor.timelineXml, 'DOMTimeline')
    .filter((child) => child.name === 'DOMLayer');
  const layers = descriptor.frameSpanIndex.layers.map((layer, layerIndex) => {
    const layerBlock = layerXml[layerIndex];
    const spans = layer.spans.map((span) => {
      const startElements = sourceElements(span.sourceFrame, getFlaXflDirectChildren);
      const summarizedStartElements = startElements.map((element) => summarizeElement(element, getFlaXflDirectChildren, graphicByName));
      const endSpan = layer.spans.find((candidate) => candidate.index === span.endExclusive);
      const pair = span.tweenType === 'motion'
        ? inspectMotionPair(layerIndex, span, endSpan, getFlaXflDirectChildren, graphicByName, interpolateFlaLinearMotionTransform)
        : null;
      const classificationForSpan = span.tweenType === 'motion'
        ? pair.classification
        : span.tweenType === 'none' ? 'SUPPORTED' : 'BLOCKED';
      const blocker = span.tweenType === 'shape'
        ? 'SHAPE_TWEEN_NOT_SUPPORTED'
        : pair?.classification === 'BLOCKED' ? pair.reason : null;
      const playOnceInstances = summarizedStartElements
        .filter((element) => element.attributes.symbolType === 'graphic' &&
          String(element.attributes.loop || '').toLocaleLowerCase('en-US') === 'play once')
        .map((element) => ({
          libraryItemName: element.attributes.libraryItemName,
          playback: playbackSequence(element.attributes, span, span.index, span.duration,
            element.childGraphic?.frameCount ?? 0),
          childFrameCount: element.childGraphic?.frameCount ?? null,
        }));
      return {
        index: span.index,
        duration: span.duration,
        endExclusive: span.endExclusive,
        tweenType: span.tweenType,
        held: span.tweenType === 'none' && span.duration > 1,
        frameAttributes: span.sourceFrame.attributes,
        startElements: summarizedStartElements,
        endpointElements: pair?.endpointFrames ? pair.endpointFrames : null,
        motionPair: pair,
        playOnceInstances,
        classification: classificationForSpan,
        blocker,
      };
    });
    return {
      layerIndex,
      name: layerBlock?.attributes.name ?? null,
      layerType: layerBlock?.attributes.layerType ?? null,
      visible: layer.visible,
      spanCount: spans.length,
      spans,
    };
  });
  const rootStartUnion = [...new Set(layers.flatMap((layer) => layer.spans.map((span) => span.index)))].sort((a, b) => a - b);
  const tweenTypeCounts = layers.flatMap((layer) => layer.spans)
    .reduce((counts, span) => ({ ...counts, [span.tweenType]: (counts[span.tweenType] || 0) + 1 }), {});
  const intervalClasses = Object.fromEntries(['SUPPORTED', 'NEEDS_BOUNDED_EXTENSION', 'BLOCKED', 'NO_GO']
    .map((classificationName) => [classificationName, layers.flatMap((layer) => layer.spans)
      .filter((span) => span.classification === classificationName).length]));
  const requiredIntervals = [[0, 14], [14, 20], [20, 22], [22, 25], [25, 30], [30, 47]];
  const intervalCapabilityMap = requiredIntervals.map(([start, end]) => ({
    interval: `[${start},${end})`,
    frameCount: end - start,
    layers: layers.map((layer) => {
      const span = spanAt(layer, start);
      const coversInterval = Boolean(span && span.endExclusive >= end);
      return {
        layerIndex: layer.layerIndex,
        spanStart: span?.index ?? null,
        spanEndExclusive: span?.endExclusive ?? null,
        tweenType: span?.tweenType ?? null,
        classification: coversInterval ? span.classification : 'BLOCKED',
        blocker: coversInterval ? span.blocker : 'SPAN_DOES_NOT_COVER_REQUIRED_INTERVAL',
        elements: span?.startElements.map((element) => ({
          kind: element.kind,
          libraryItemName: element.attributes.libraryItemName ?? null,
          playbackMode: element.attributes.loop ?? null,
          firstFrame: element.attributes.firstFrame ?? null,
          childFrameCount: element.childGraphic?.frameCount ?? null,
        })) ?? [],
      };
    }),
  }));
  const nestedGraphicModes = layers.flatMap((layer) => layer.spans.flatMap((span) => span.startElements
    .filter((element) => element.attributes.symbolType === 'graphic' && element.childGraphic)
    .map((element) => ({
      layerIndex: layer.layerIndex,
      spanStart: span.index,
      spanEndExclusive: span.endExclusive,
      libraryItemName: element.attributes.libraryItemName,
      playbackMode: element.attributes.loop ?? null,
      firstFrame: element.attributes.firstFrame ?? null,
      lastFrame: element.attributes.lastFrame ?? null,
      childFrameCount: element.childGraphic.frameCount,
    }))));
  const bodySpan = layers.flatMap((layer) => layer.spans.map((span) => ({ layer, span })))
    .find(({ span }) => span.index === 20 && span.startElements.some((element) =>
      element.attributes.symbolType === 'graphic' && element.attributes.loop === 'play once'));
  let playOncePostEnd = null;
  if (bodySpan) {
    const element = bodySpan.span.startElements.find((candidate) => candidate.attributes.loop === 'play once');
    const childCount = element.childGraphic?.frameCount ?? null;
    playOncePostEnd = {
      layerIndex: bodySpan.layer.layerIndex,
      parentSpan: { index: bodySpan.span.index, duration: bodySpan.span.duration, endExclusive: bodySpan.span.endExclusive },
      libraryItemName: element.attributes.libraryItemName,
      playbackMode: element.attributes.loop,
      firstFrame: element.attributes.firstFrame === undefined ? 0 : Number(element.attributes.firstFrame),
      childFrameCount: childCount,
      rootFrameToChildFrame: childCount === null ? [] : playbackSequence(
        element.attributes,
        bodySpan.span,
        bodySpan.span.index,
        bodySpan.span.duration,
        childCount,
      ).selections.map((selection) => ({ parentFrame: selection.parentFrame, childFrame: selection.childFrame })),
      authoringSemanticsReference: 'Adobe Animate Graphic Looping documentation: Play Once remains on its last frame for the rest of the parent timeline span.',
      authoringSemanticsUrl: 'https://helpx.adobe.com/animate/desktop/using/elements.html',
      currentProductionPolicy: 'The bounded selector holds the default-bound Play Once Graphic on child frameCount - 1 after one traversal.',
      boundedExtension: 'For this source, default firstFrame 0 and absent lastFrame resolve F31-F46 to child frame 10 after F30 reaches child frame 10.',
    };
  }

  const frameResolution = produceFrameMap(source, descriptor, args.rootSymbolName, graphicByName);
  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, sourceSha256, 'source FLA changed during census');
  const spanCount = layers.reduce((total, layer) => total + layer.spanCount, 0);
  const totalMotionDurationNeeds = [...new Set(layers.flatMap((layer) => layer.spans)
    .filter((span) => span.classification === 'NEEDS_BOUNDED_EXTENSION')
    .map((span) => span.duration))].sort((a, b) => a - b);
  const blockedIntervals = layers.flatMap((layer) => layer.spans
    .filter((span) => span.classification === 'BLOCKED')
    .map((span) => ({ layerIndex: layer.layerIndex, index: span.index, duration: span.duration, reason: span.blocker })));

  return {
    schemaVersion: 'issue713-full-timeline-gate0/2',
    issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/713',
    motherPullRequest: 'https://github.com/Cognitive-Architect/panda-stage/pull/677',
    prerequisite: {
      issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/712',
      state: 'CLOSED',
    },
    source: {
      path: args.source,
      originalSha256: sourceSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariant: sourceSha256After === sourceSha256,
      archiveClassification: classification.state,
      normalization: normalized.applied ? {
        applied: true,
        field: normalized.field,
        deltaBytes: normalized.deltaBytes,
        mode: normalized.mode,
        originalBytesWritten: normalized.originalBytesWritten,
        normalizedArchiveSha256: HASH(archiveBytes),
      } : { applied: false, mode: 'strict-valid' },
      postNormalizationStrictResult: normalizedClassification.state,
    },
    rootGraphic: {
      name: descriptor.sourceLibraryItemName,
      frameCount: descriptor.frameCount,
      visibleLayerCount: descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length,
      stageWidth: source.stageWidth,
      stageHeight: source.stageHeight,
      sourceFrameRate: rootAttributes(documentXml, 'DOMDocument')?.frameRate ?? null,
      expectedDuration: '47/30 seconds',
      authoredSpanStartUnion: rootStartUnion,
      authoredSpanCount: spanCount,
      authoredSpanTypeCounts: tweenTypeCounts,
      archiveEvidence,
      requiredIntervalCapabilityMap: intervalCapabilityMap,
      nestedGraphicModes,
      layerIntervalMap: layers,
    },
    gate0: {
      classification: blockedIntervals.length ? 'BLOCKED' : 'GO-WITH-BOUNDED-EXTENSION',
      intervalClassificationCounts: intervalClasses,
      longerMotionDurationsNeedingExtension: totalMotionDurationNeeds,
      blockedIntervals,
      nestedGraphicPostEnd: playOncePostEnd,
      existingProductionResolution: frameResolution,
      gateA: {
        requestedFrameCount: frameResolution.frames.length,
        requestedFrames: frameResolution.frames.map((frame) => frame.frameIndex),
        statusCounts: frameResolution.statusCounts,
        everyFrameHasExactlyOneStatus: frameResolution.frames.every((frame) =>
          ['AUTHORED', 'TWEEN_RECONSTRUCTED', 'HELD', 'BLOCKED'].includes(frame.status)),
        allFramesResolved: frameResolution.frames.length === descriptor.frameCount &&
          frameResolution.frames.every((frame) => frame.status !== 'BLOCKED' &&
            frame.adapter.ok && frame.nested?.ok === true && frame.displayList?.ok === true),
        repeatedProductionResolutionDeterministic: frameResolution.repeatedDeterminismPass,
        firstAdapterFailure: frameResolution.firstAdapterFailure,
        firstNestedFailure: frameResolution.firstNestedFailure,
        firstDisplayListFailure: frameResolution.firstDisplayListFailure,
      },
      sourceMutation: 'NO',
      projectMutation: 'NONE',
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const receipt = await buildCensus(args);
  await fs.promises.mkdir(args.out, { recursive: true });
  const outputPath = path.join(args.out, 'gate0-receipt.json');
  await fs.promises.writeFile(outputPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    outputPath,
    sourceSha256: receipt.source.originalSha256,
    frameCount: receipt.rootGraphic.frameCount,
    visibleLayerCount: receipt.rootGraphic.visibleLayerCount,
    spanCount: receipt.rootGraphic.authoredSpanCount,
    spanTypeCounts: receipt.rootGraphic.authoredSpanTypeCounts,
    spanStarts: receipt.rootGraphic.authoredSpanStartUnion,
    intervalClassificationCounts: receipt.gate0.intervalClassificationCounts,
    longerMotionDurationsNeedingExtension: receipt.gate0.longerMotionDurationsNeedingExtension,
    blockedIntervals: receipt.gate0.blockedIntervals,
    gateA: receipt.gate0.gateA,
    firstAdapterFailure: receipt.gate0.existingProductionResolution.firstAdapterFailure,
    firstNestedFailure: receipt.gate0.existingProductionResolution.firstNestedFailure,
    playOncePostEnd: receipt.gate0.nestedGraphicPostEnd,
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
