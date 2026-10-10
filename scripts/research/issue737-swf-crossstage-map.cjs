#!/usr/bin/env node
'use strict';

// Issue #737 closeout mapper for the frozen Issue #736 target and control.
// It reports source/SWF coordinates side by side; it never changes geometry.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function args(argv) {
  const value = { xfl: null, jsfl: null, swfReceipt: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--xfl') value.xfl = argv[++index] ?? null;
    else if (argv[index] === '--jsfl') value.jsfl = argv[++index] ?? null;
    else if (argv[index] === '--swf-receipt') value.swfReceipt = argv[++index] ?? null;
    else if (argv[index] === '--out') value.out = argv[++index] ?? null;
    else if (argv[index] === '--help' || argv[index] === '-h') value.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return value;
}

function tokenize(text) {
  const tokens = [];
  let current = '';
  const flush = () => {
    if (current.trim()) tokens.push(current.trim());
    current = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if ('!|[/SqQ();'.includes(character)) {
      flush();
      tokens.push(character);
    } else if (character === ',' || /\s/u.test(character)) {
      flush();
    } else {
      current += character;
    }
  }
  flush();
  return tokens;
}

function decodeFixedTwips(token, mode = 'corrected-plus') {
  if (!token.startsWith('#')) {
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`Invalid XFL coordinate ${token}`);
    return value;
  }
  const [integerHex, fractionHex = ''] = token.slice(1).split('.');
  if (!/^[0-9a-f]+$/iu.test(integerHex) || (fractionHex && !/^[0-9a-f]+$/iu.test(fractionHex))) {
    throw new Error(`Invalid signed fixed-point XFL coordinate ${token}`);
  }
  const width = integerHex.length * 4;
  let integer = BigInt(`0x${integerHex}`);
  if (integerHex.length >= 6 && integer >= (1n << BigInt(width - 1))) integer -= 1n << BigInt(width);
  const fraction = fractionHex ? Number(BigInt(`0x${fractionHex}`)) / (2 ** (fractionHex.length * 4)) : 0;
  // XFL's fractional field is unsigned even when its integer field is signed.
  const fractionalSign = mode === 'old-minus' && integer < 0n ? -1 : 1;
  return Number(integer) + fractionalSign * fraction;
}

function decodeEdge(edge, mode = 'corrected-plus') {
  const sourceText = edge.edges || '';
  if (edge.cubics) throw new Error(`Edge ${edge.edgeIndex} uses cubics; this closeout fixture expects the audited quadratic/line stream`);
  const tokens = tokenize(sourceText);
  const segments = [];
  let current = null;
  let subpathStart = null;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === '!') {
      if (index + 2 >= tokens.length) throw new Error(`Edge ${edge.edgeIndex} has a truncated move`);
      current = { x: decodeFixedTwips(tokens[index + 1], mode), y: decodeFixedTwips(tokens[index + 2], mode) };
      subpathStart = current;
      index += 3;
      continue;
    }
    if (token === 'S') {
      index += 2;
      continue;
    }
    if (token === '/') {
      current = subpathStart;
      subpathStart = null;
      index += 1;
      continue;
    }
    if (token === '|' || token === '[') {
      if (!current) throw new Error(`Edge ${edge.edgeIndex} draws before a move`);
      const quadratic = token === '[';
      const control = quadratic
        ? { x: decodeFixedTwips(tokens[index + 1], mode), y: decodeFixedTwips(tokens[index + 2], mode) }
        : null;
      const to = quadratic
        ? { x: decodeFixedTwips(tokens[index + 3], mode), y: decodeFixedTwips(tokens[index + 4], mode) }
        : { x: decodeFixedTwips(tokens[index + 1], mode), y: decodeFixedTwips(tokens[index + 2], mode) };
      segments.push({
        sourceEdgeIndex: edge.edgeIndex,
        sourceSegmentIndex: segments.length,
        type: quadratic ? 'quadratic' : 'line',
        from: current,
        control,
        to,
        fillStyle0: edge.fillStyle0,
        fillStyle1: edge.fillStyle1,
      });
      current = to;
      index += quadratic ? 5 : 3;
      continue;
    }
    if (token === 'q' || token === 'Q' || token === '(' || token === '(;' || token === ')' || token === ');') {
      throw new Error(`Edge ${edge.edgeIndex} contains an unsupported in-stream style/cubic token ${token}`);
    }
    throw new Error(`Edge ${edge.edgeIndex} contains an unrecognized token ${JSON.stringify(token)}`);
  }
  return segments;
}

function selectedShapeMatrix(jsfl, memberPath) {
  const captured = jsfl.targetLibraryTimelineCapture?.shapes?.find(shape => shape.memberPath === memberPath);
  const matrix = captured?.shape?.matrix;
  if (!matrix || !['a', 'b', 'c', 'd', 'tx', 'ty'].every(key => Number.isFinite(matrix[key]))) {
    throw new Error(`JSFL receipt has no complete transform matrix for member ${memberPath}`);
  }
  if (matrix.a * matrix.d - matrix.b * matrix.c === 0) throw new Error(`JSFL matrix ${memberPath} is not invertible`);
  return matrix;
}

function xflToAnimateGeometryMap(jsfl, memberPath, color, sourceSegments) {
  const captured = jsfl.targetLibraryTimelineCapture?.shapes?.find(shape => shape.memberPath === memberPath);
  if (!captured) throw new Error(`JSFL capture is missing library member ${memberPath}`);
  const contours = (captured.shape.contours || [])
    .map((contour, contourIndex) => ({ contour, contourIndex }))
    .filter(item => item.contour.fill?.color === color);
  const uniqueHalfEdges = new Map();
  for (const { contour, contourIndex } of contours) {
    for (const halfEdge of contour.halfEdges || []) {
      if (!uniqueHalfEdges.has(halfEdge.edgeId)) uniqueHalfEdges.set(halfEdge.edgeId, { halfEdge, contourIndex });
    }
  }
  const canonical = segment => {
    // Compare the decoded coordinates as recorded. Do not round or apply an endpoint tolerance.
    const forward = JSON.stringify([segment.type, segment.from, segment.control, segment.to]);
    const reverse = JSON.stringify([segment.type, segment.to, segment.control, segment.from]);
    return forward <= reverse ? forward : reverse;
  };
  const jsflByGeometry = new Map();
  for (const { halfEdge, contourIndex } of uniqueHalfEdges.values()) {
    const points = halfEdge.edgeGeometry?.controlPoints0To2 || [];
    const segment = {
      type: halfEdge.edgeIsLine ? 'line' : 'quadratic',
      from: halfEdge.from,
      control: halfEdge.edgeIsLine ? null : points[1],
      to: halfEdge.to,
      edgeId: halfEdge.edgeId,
      halfEdgeId: halfEdge.id,
      contourIndex,
    };
    if (segment.type === 'quadratic' && !segment.control) throw new Error(`JSFL edge ${segment.edgeId} has no quadratic control point`);
    const key = canonical(segment);
    const list = jsflByGeometry.get(key) || [];
    list.push(segment);
    jsflByGeometry.set(key, list);
  }
  const animateMatches = [];
  const missing = [];
  const remaining = new Map([...jsflByGeometry].map(([key, list]) => [key, [...list]]));
  let directionSameCount = 0;
  let directionReversedCount = 0;
  for (const source of sourceSegments) {
    const local = {
      type: source.type,
      from: { x: source.from.x / 20, y: source.from.y / 20 },
      control: source.control ? { x: source.control.x / 20, y: source.control.y / 20 } : null,
      to: { x: source.to.x / 20, y: source.to.y / 20 },
    };
    const list = remaining.get(canonical(local)) || [];
    const match = list.shift();
    if (!match) {
      missing.push({ sourceEdgeIndex: source.sourceEdgeIndex, sourceSegmentIndex: source.sourceSegmentIndex, geometry: local });
      continue;
    }
    remaining.set(canonical(local), list);
    const sameDirection = JSON.stringify([local.from, local.control, local.to]) ===
      JSON.stringify([match.from, match.control, match.to]);
    if (sameDirection) directionSameCount += 1;
    else directionReversedCount += 1;
    animateMatches.push({
      sourceEdgeIndex: source.sourceEdgeIndex,
      sourceSegmentIndex: source.sourceSegmentIndex,
      jsflEdgeId: match.edgeId,
      jsflHalfEdgeId: match.halfEdgeId,
      jsflContourIndex: match.contourIndex,
      geometryDirectionSame: sameDirection,
      xflGeometryPx: local,
      jsflGeometryPx: {
        type: match.type,
        from: match.from,
        control: match.control,
        to: match.to,
      },
    });
  }
  const extra = [...remaining.values()].flat().map(segment => ({ edgeId: segment.edgeId, halfEdgeId: segment.halfEdgeId, contourIndex: segment.contourIndex }));
  return {
    selectedContourCount: contours.length,
    jsflUniqueEdgeCount: uniqueHalfEdges.size,
    xflSegmentCount: sourceSegments.length,
    matchedCount: animateMatches.length,
    missingCount: missing.length,
    extraCount: extra.length,
    exactGeometryMultisetMatch: missing.length === 0 && extra.length === 0,
    geometryDirectionSameCount: directionSameCount,
    geometryDirectionReversedCount: directionReversedCount,
    missing,
    extra,
    matches: animateMatches,
  };
}

function transformPoint(point, matrix) {
  const x = point.x / 20;
  const y = point.y / 20;
  return {
    x: Math.round((matrix.a * x + matrix.c * y + matrix.tx) * 20),
    y: Math.round((matrix.b * x + matrix.d * y + matrix.ty) * 20),
  };
}

function inverseTransformPoint(point, matrix) {
  const x = point.x / 20 - matrix.tx;
  const y = point.y / 20 - matrix.ty;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    x: ((matrix.d * x - matrix.c * y) / determinant) * 20,
    y: ((-matrix.b * x + matrix.a * y) / determinant) * 20,
  };
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function endpointBounds(segments) {
  if (!segments.length) return null;
  const points = segments.flatMap(segment => [segment.from, segment.to]);
  return {
    xMin: Math.min(...points.map(point => point.x)),
    xMax: Math.max(...points.map(point => point.x)),
    yMin: Math.min(...points.map(point => point.y)),
    yMax: Math.max(...points.map(point => point.y)),
  };
}

function summarizeGraph(segments) {
  const vertices = new Map();
  const outgoing = new Map();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const fromKey = pointKey(segment.from);
    const toKey = pointKey(segment.to);
    const from = vertices.get(fromKey) || { point: segment.from, in: 0, out: 0 };
    from.out += 1;
    vertices.set(fromKey, from);
    const to = vertices.get(toKey) || { point: segment.to, in: 0, out: 0 };
    to.in += 1;
    vertices.set(toKey, to);
    const list = outgoing.get(fromKey) || [];
    list.push(index);
    outgoing.set(fromKey, list);
  }
  const balanced = [...vertices.values()].every(vertex => vertex.in === vertex.out);
  const oneInOneOut = [...vertices.values()].every(vertex => vertex.in === 1 && vertex.out === 1);
  const used = new Set();
  const cycles = [];
  const openRemainders = [];
  if (oneInOneOut) {
    for (let first = 0; first < segments.length; first += 1) {
      if (used.has(first)) continue;
      const firstKey = pointKey(segments[first].from);
      let current = first;
      const path = [];
      while (current !== undefined && !used.has(current)) {
        used.add(current);
        path.push(current);
        const endKey = pointKey(segments[current].to);
        if (endKey === firstKey) {
          cycles.push(path);
          break;
        }
        current = (outgoing.get(endKey) || []).find(index => !used.has(index));
      }
      if (path.length && pointKey(segments[path[path.length - 1]].to) !== firstKey) openRemainders.push(path);
    }
  }
  return {
    segmentCount: segments.length,
    endpointCount: vertices.size,
    balanced,
    allEndpointsOneInOneOut: oneInOneOut,
    cycleLengths: cycles.map(cycle => cycle.length).sort((left, right) => left - right),
    consumedSegmentCount: used.size,
    openRemainderLengths: openRemainders.map(path => path.length),
  };
}

function summarizeRawBoundaryGraph(context, fillStyleIndex, decodeMode) {
  const segments = context.rawXfl.edgeRecords
    .filter(edge => edge.fillStyle0 === fillStyleIndex || edge.fillStyle1 === fillStyleIndex)
    .flatMap(edge => decodeEdge(edge, decodeMode));
  const boundary = segments
    .filter(segment => !(segment.fillStyle0 === fillStyleIndex && segment.fillStyle1 === fillStyleIndex))
    .map(segment => segment.fillStyle0 === fillStyleIndex
      ? { ...segment, from: segment.to, to: segment.from }
      : segment);
  return summarizeGraph(boundary);
}

function graphFingerprint(graph) {
  return JSON.stringify({
    segmentCount: graph.segmentCount,
    endpointCount: graph.endpointCount,
    balanced: graph.balanced,
    allEndpointsOneInOneOut: graph.allEndpointsOneInOneOut,
    cycleLengths: graph.cycleLengths,
    consumedSegmentCount: graph.consumedSegmentCount,
    openRemainderLengths: graph.openRemainderLengths,
  });
}

function histogram(values) {
  const output = {};
  for (const value of values) {
    const key = String(value);
    output[key] = (output[key] || 0) + 1;
  }
  return output;
}

function mapOne({ label, context, jsfl, swfReceipt, memberPath, candidatePredicate }) {
  const style = context.selected.fillStyleIndex;
  const colorMatch = String(context.selected.fillStyleXml || '').match(/\bcolor="(#[0-9a-f]{6})"/iu);
  if (!colorMatch) throw new Error(`${label}: target fill color is missing`);
  const color = colorMatch[1].toUpperCase();
  const allSegments = context.rawXfl.edgeRecords
    .filter(edge => edge.fillStyle0 === style || edge.fillStyle1 === style)
    .flatMap(edge => decodeEdge(edge));
  const animateMapping = xflToAnimateGeometryMap(jsfl, memberPath, color, allSegments);
  const boundarySegments = allSegments
    .filter(segment => !(segment.fillStyle0 === style && segment.fillStyle1 === style))
    .map(segment => segment.fillStyle0 === style
      ? { ...segment, from: segment.to, to: segment.from }
      : segment);
  const xflGraph = summarizeGraph(boundarySegments);
  const matrix = selectedShapeMatrix(jsfl, memberPath);
  const expected = allSegments.map(segment => ({
    ...segment,
    targetOnFillStyle0: segment.fillStyle0 === style,
    targetOnFillStyle1: segment.fillStyle1 === style,
    sourceGeometryTwips: { type: segment.type, from: segment.from, control: segment.control, to: segment.to },
    from: transformPoint(segment.from, matrix),
    control: segment.control ? transformPoint(segment.control, matrix) : null,
    to: transformPoint(segment.to, matrix),
  }));
  const candidates = swfReceipt.publishedSwf[label === 'target' ? 'target' : 'closedControl'].candidates || [];
  const matches = candidates.filter(candidate => candidatePredicate(candidate, color));
  if (matches.length !== 1) throw new Error(`${label}: expected one uniquely identified SWF DefineShape, found ${matches.length}`);
  const candidate = matches[0];
  const actual = (candidate.shapeRecords || []).filter(record => record.recordType === 'edge' &&
    (record.fillStyle0Color?.rgb === color || record.fillStyle1Color?.rgb === color));
  const swfBoundary = actual.filter(edge => !(edge.fillStyle0Color?.rgb === color && edge.fillStyle1Color?.rgb === color))
    .map(edge => edge.fillStyle0Color?.rgb === color
      ? { ...edge, from: edge.to, to: edge.from }
      : edge);
  const swfGraph = summarizeGraph(swfBoundary.map(edge => ({ from: edge.from, to: edge.to })));

  const uniquePoints = segments => {
    const points = new Map();
    for (const segment of segments) {
      points.set(pointKey(segment.from), segment.from);
      points.set(pointKey(segment.to), segment.to);
    }
    return [...points.values()];
  };
  const expectedPoints = uniquePoints(expected);
  const actualPoints = uniquePoints(actual);
  const pointCandidates = [];
  for (let expectedIndex = 0; expectedIndex < expectedPoints.length; expectedIndex += 1) {
    for (let actualIndex = 0; actualIndex < actualPoints.length; actualIndex += 1) {
      const expectedPoint = expectedPoints[expectedIndex];
      const actualPoint = actualPoints[actualIndex];
      pointCandidates.push({
        expectedIndex,
        actualIndex,
        residualL1Twips: Math.abs(expectedPoint.x - actualPoint.x) + Math.abs(expectedPoint.y - actualPoint.y),
      });
    }
  }
  pointCandidates.sort((left, right) => left.residualL1Twips - right.residualL1Twips ||
    left.expectedIndex - right.expectedIndex || left.actualIndex - right.actualIndex);
  const usedExpectedPoints = new Set();
  const usedActualPoints = new Set();
  const pointMap = new Map();
  const vertexResiduals = [];
  const endpointMapping = [];
  for (const pair of pointCandidates) {
    if (usedExpectedPoints.has(pair.expectedIndex) || usedActualPoints.has(pair.actualIndex)) continue;
    usedExpectedPoints.add(pair.expectedIndex);
    usedActualPoints.add(pair.actualIndex);
    const expectedPoint = expectedPoints[pair.expectedIndex];
    const actualPoint = actualPoints[pair.actualIndex];
    pointMap.set(pointKey(expectedPoint), actualPoint);
    vertexResiduals.push(pair.residualL1Twips);
    endpointMapping.push({ expectedSwfTwips: expectedPoint, actualSwfTwips: actualPoint, residualL1Twips: pair.residualL1Twips });
  }

  const edgeCandidates = [];
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const expectedSegment = expected[expectedIndex];
    const mappedFrom = pointMap.get(pointKey(expectedSegment.from));
    const mappedTo = pointMap.get(pointKey(expectedSegment.to));
    if (!mappedFrom || !mappedTo) continue;
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      const actualSegment = actual[actualIndex];
      const direct = actualSegment.from.x === mappedFrom.x && actualSegment.from.y === mappedFrom.y &&
        actualSegment.to.x === mappedTo.x && actualSegment.to.y === mappedTo.y;
      const reversed = actualSegment.from.x === mappedTo.x && actualSegment.from.y === mappedTo.y &&
        actualSegment.to.x === mappedFrom.x && actualSegment.to.y === mappedFrom.y;
      if (direct || reversed) edgeCandidates.push({ expectedIndex, actualIndex, direct, typePenalty: expectedSegment.type === actualSegment.type ? 0 : 1 });
    }
  }
  edgeCandidates.sort((left, right) => left.typePenalty - right.typePenalty ||
    left.expectedIndex - right.expectedIndex || left.actualIndex - right.actualIndex);
  const usedExpectedEdges = new Set();
  const usedActualEdges = new Set();
  const mappings = [];
  for (const pair of edgeCandidates) {
    if (usedExpectedEdges.has(pair.expectedIndex) || usedActualEdges.has(pair.actualIndex)) continue;
    usedExpectedEdges.add(pair.expectedIndex);
    usedActualEdges.add(pair.actualIndex);
    mappings.push(pair);
  }

  const typePairs = {};
  const endpointResiduals = [];
  const controlResiduals = [];
  const lineSagittae = [];
  let reversedCount = 0;
  let sideMatches = 0;
  let strictExactCount = 0;
  const animateBySourceSegment = new Map(animateMapping.matches.map(match =>
    [`${match.sourceEdgeIndex}:${match.sourceSegmentIndex}`, match]));
  const edgeMapping = mappings.map(pair => {
    const source = expected[pair.expectedIndex];
    const target = actual[pair.actualIndex];
    const reversed = !pair.direct;
    if (reversed) reversedCount += 1;
    const typeKey = `${source.type}->${target.type}`;
    typePairs[typeKey] = (typePairs[typeKey] || 0) + 1;
    const actualFrom = reversed ? target.to : target.from;
    const actualTo = reversed ? target.from : target.to;
    const endpointResidual = Math.abs(source.from.x - actualFrom.x) + Math.abs(source.from.y - actualFrom.y) +
      Math.abs(source.to.x - actualTo.x) + Math.abs(source.to.y - actualTo.y);
    endpointResiduals.push(endpointResidual);
    const sourceSides = [source.targetOnFillStyle0, source.targetOnFillStyle1];
    const actualSides = [target.fillStyle0Color?.rgb === color, target.fillStyle1Color?.rgb === color];
    if (reversed) actualSides.reverse();
    const sideMatchesThisEdge = sourceSides[0] === actualSides[0] && sourceSides[1] === actualSides[1];
    if (sideMatchesThisEdge) sideMatches += 1;
    const controlResidual = source.control && target.control
      ? Math.abs(source.control.x - target.control.x) + Math.abs(source.control.y - target.control.y)
      : null;
    if (controlResidual !== null) controlResiduals.push(controlResidual);
    let lineSagitta = null;
    if (source.control && !target.control) {
      const dx = source.to.x - source.from.x;
      const dy = source.to.y - source.from.y;
      const cx = source.control.x - source.from.x;
      const cy = source.control.y - source.from.y;
      const chordLength = Math.hypot(dx, dy);
      lineSagitta = chordLength ? Math.abs(dx * cy - dy * cx) / (2 * chordLength) : 0;
      lineSagittae.push(lineSagitta);
    }
    const exactRecord = source.type === target.type && endpointResidual === 0 &&
      (!source.control || controlResidual === 0);
    if (exactRecord) strictExactCount += 1;
    return {
      xflSourceEdgeIndex: source.sourceEdgeIndex,
      xflSourceSegmentIndex: source.sourceSegmentIndex,
      animateHalfEdgeMapping: animateBySourceSegment.get(`${source.sourceEdgeIndex}:${source.sourceSegmentIndex}`) || null,
      swfShapeEdgeIndex: target.edgeIndex,
      swfShapeRecordIndex: target.recordIndex,
      directionReversed: reversed,
      xflSourceGeometryTwips: source.sourceGeometryTwips,
      expectedTransformedGeometryTwips: { type: source.type, from: source.from, control: source.control, to: source.to },
      actualSwfGeometryTwips: { type: target.type, from: target.from, control: target.control, to: target.to },
      actualSwfGeometryInverseNormalizedToXflTwips: {
        type: target.type,
        from: inverseTransformPoint(target.from, matrix),
        control: target.control ? inverseTransformPoint(target.control, matrix) : null,
        to: inverseTransformPoint(target.to, matrix),
      },
      endpointResidualL1Twips: endpointResidual,
      controlResidualL1Twips: controlResidual,
      quadraticToLineSagittaTwips: lineSagitta,
      sourceTargetOnFillStyle0: source.targetOnFillStyle0,
      sourceTargetOnFillStyle1: source.targetOnFillStyle1,
      swfTargetOnFillStyle0AfterDirectionNormalization: actualSides[0],
      swfTargetOnFillStyle1AfterDirectionNormalization: actualSides[1],
      fillSideOwnershipMatches: sideMatchesThisEdge,
      strictExactRecordGeometryMatch: exactRecord,
    };
  });
  return {
    source: {
      fillStyleIndex: style,
      fillColor: color,
      rawTargetSegmentCount: allSegments.length,
      boundarySegmentCount: boundarySegments.length,
      sameFillInteriorSegmentCount: allSegments.length - boundarySegments.length,
      boundaryGraph: xflGraph,
      endpointBoundsTwips: endpointBounds(allSegments),
      animateGeometryMapping: animateMapping,
    },
    animateShape: {
      libraryMemberPath: memberPath,
      edgeCount: jsfl.targetLibraryTimelineCapture.shapes.find(shape => shape.memberPath === memberPath).shape.edgeCount,
      vertexCount: jsfl.targetLibraryTimelineCapture.shapes.find(shape => shape.memberPath === memberPath).shape.vertexCount,
      contourCount: jsfl.targetLibraryTimelineCapture.shapes.find(shape => shape.memberPath === memberPath).shape.contourCount,
      matrix,
    },
    swfShape: {
      shapeId: candidate.shapeId,
      tagName: candidate.tagName,
      totalShapeRecordEdgeCount: candidate.totalShapeRecordEdgeCount,
      targetColorEdgeCount: candidate.targetColorEdgeCount,
      targetBoundarySegmentCount: candidate.targetBoundarySegmentCount,
      targetInteriorEdgeCount: candidate.targetInteriorEdgeCount,
      exactBoundaryCycleLengths: candidate.exactBoundaryCycles?.cycles?.map(cycle => cycle.length).sort((left, right) => left - right) || [],
      boundaryGraph: swfGraph,
    },
    transformNormalization: {
      xflCoordinateUnit: 'fixed-point twips',
      animateMatrixCoordinateUnit: 'pixels',
      swfShapeRecordCoordinateUnit: 'integer twips',
      appliedOperation: 'XFL twips / 20 -> Animate Shape.matrix -> * 20 -> Math.round at SWF integer-twip encoding boundary',
      noEndpointToleranceForGraphTopology: true,
      mappingDoesNotMergeOrModifyCoordinates: true,
    },
    topologyMapping: {
      endpointMappingRule: 'One-to-one minimum-L1 correspondence over distinct projected XFL and SWF endpoint coordinates; retain each residual and original coordinate.',
      xflUniqueEndpointCount: expectedPoints.length,
      swfUniqueEndpointCount: actualPoints.length,
      mappedEndpointCount: pointMap.size,
      endpointResidualL1TwipsHistogram: histogram(vertexResiduals),
      endpointMapping,
      mappedEdgeCount: mappings.length,
      missingXflGeometryCount: expected.length - mappings.length,
      extraSwfGeometryCount: actual.length - mappings.length,
      edgeMappingCandidateCount: edgeCandidates.length,
      edgeTypePairCounts: typePairs,
      geometryDirectionReversedCount: reversedCount,
      fillSideOwnershipMatchCount: sideMatches,
      fillSideOwnershipMismatchCount: mappings.length - sideMatches,
      strictExactRecordMatchCount: strictExactCount,
      strictExactMissingXflCount: expected.length - strictExactCount,
      strictExactExtraSwfCount: actual.length - strictExactCount,
      endpointResidualL1TwipsHistogramByEdge: histogram(endpointResiduals),
      quadraticControlResidualL1TwipsHistogram: histogram(controlResiduals),
      quadraticToLineSagittaTwips: {
        count: lineSagittae.length,
        maximum: lineSagittae.length ? Math.max(...lineSagittae) : null,
        histogramRoundedTo001Twips: histogram(lineSagittae.map(value => Math.round(value * 100) / 100)),
      },
      edgeMapping,
    },
  };
}

function main() {
  const options = args(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/research/issue737-swf-crossstage-map.cjs --xfl <issue736-xfl-panda.json> --jsfl <issue736-animate.json> --swf-receipt <issue736-swf-oracle.json> [--out <receipt.json>]\n');
    return;
  }
  if (!options.xfl || !options.jsfl || !options.swfReceipt) throw new Error('All of --xfl, --jsfl, and --swf-receipt are required');
  const inputBytes = Object.fromEntries(['xfl', 'jsfl', 'swfReceipt'].map(key => [key, fs.readFileSync(options[key])]));
  const xfl = JSON.parse(inputBytes.xfl.toString('utf8'));
  const jsfl = JSON.parse(inputBytes.jsfl.toString('utf8'));
  const swfReceipt = JSON.parse(inputBytes.swfReceipt.toString('utf8'));
  if (xfl.issue !== 736 || jsfl.issue !== 736 || swfReceipt.issue !== 736) throw new Error('Inputs must all be Issue #736 receipts');
  const target = mapOne({
    label: 'target',
    context: xfl,
    jsfl,
    swfReceipt,
    memberPath: '0/0',
    candidatePredicate: candidate => candidate.totalShapeRecordEdgeCount === 139 &&
      candidate.targetColorEdgeCount === 118 && candidate.targetInteriorEdgeCount === 20,
  });
  const control = mapOne({
    label: 'control',
    context: xfl.noOpControl,
    jsfl,
    swfReceipt,
    memberPath: '0/4',
    candidatePredicate: candidate => candidate.totalShapeRecordEdgeCount === 34 &&
      candidate.targetColorEdgeCount === 33 && candidate.targetInteriorEdgeCount === 17,
  });
  const fixedPointToken = '#FFF086.FB';
  const targetStyle = xfl.selected.fillStyleIndex;
  const targetEdges = xfl.rawXfl.edgeRecords.filter(edge => edge.fillStyle0 === targetStyle || edge.fillStyle1 === targetStyle);
  const oldMinusGraph = summarizeRawBoundaryGraph(xfl, targetStyle, 'old-minus');
  const correctedPlusGraph = summarizeRawBoundaryGraph(xfl, targetStyle, 'corrected-plus');
  const receipt = {
    schemaVersion: 'issue737-swf-crossstage-map/1',
    issue: 737,
    parentIssue: 736,
    inputReceipts: {
      xfl: { path: path.resolve(options.xfl), sha256: sha256(inputBytes.xfl) },
      jsfl: { path: path.resolve(options.jsfl), sha256: sha256(inputBytes.jsfl) },
      swf: { path: path.resolve(options.swfReceipt), sha256: sha256(inputBytes.swfReceipt) },
    },
    source: {
      sha256Before: xfl.source.sourceSha256Before,
      sha256After: xfl.source.sourceSha256After,
      fileName: xfl.source.fileName,
    },
    animate: {
      version: jsfl.host?.animateVersion ?? null,
      sourcePath: jsfl.source?.documentPath ?? null,
      expectedPathMatches: jsfl.source?.expectedPathMatches ?? null,
      symbolLibraryItem: jsfl.targetLibraryItemInventory?.find(item => item.libraryIndex === 4) ?? null,
      symbolSwfPath: jsfl.targetSymbolSwf?.outputUri ?? null,
    },
    swf: {
      path: swfReceipt.input.swfPath,
      sha256: swfReceipt.input.swfSha256,
      defineShapeCount: swfReceipt.parse.defineShapeCount,
      shapeParseErrorCount: swfReceipt.parse.shapeParseErrors.length,
    },
    fixedPointDecodeComparison: {
      rawToken: fixedPointToken,
      targetOccurrenceCount: targetEdges.reduce((count, edge) => count + ((edge.edges || '').match(/#FFF086\.FB/gu) || []).length, 0),
      oldMinusDecodedTwips: decodeFixedTwips(fixedPointToken, 'old-minus'),
      correctedPlusDecodedTwips: decodeFixedTwips(fixedPointToken, 'corrected-plus'),
      oldMinusBoundaryGraph: oldMinusGraph,
      correctedPlusBoundaryGraph: correctedPlusGraph,
      boundaryTopologyUnchanged: graphFingerprint(oldMinusGraph) === graphFingerprint(correctedPlusGraph),
    },
    target,
    control,
    safety: {
      productionFilesChanged: false,
      sourceFlaMutated: false,
      endpointSnapping: false,
      epsilonClosure: false,
      syntheticGeometry: false,
    },
  };
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.out) {
    const outputPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    process.stdout.write(JSON.stringify({
      outputPath,
      sourceSha256: receipt.source.sha256Before,
      targetMapped: receipt.target.topologyMapping.mappedEdgeCount,
      targetMissing: receipt.target.topologyMapping.missingXflGeometryCount,
      targetExtra: receipt.target.topologyMapping.extraSwfGeometryCount,
      controlMapped: receipt.control.topologyMapping.mappedEdgeCount,
      controlMissing: receipt.control.topologyMapping.missingXflGeometryCount,
      controlExtra: receipt.control.topologyMapping.extraSwfGeometryCount,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(output);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Issue #737 SWF closeout mapper failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
}
