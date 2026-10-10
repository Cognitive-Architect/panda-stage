#!/usr/bin/env node
'use strict';

// Assemble Issue #744's source/Panda/Animate ledgers from the frozen #743
// archives, fresh current-production Panda receipts, and repeated JSFL captures.
// This script only reads source FLAs and emits sanitized JSON evidence.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue743-authored-close-minimization-20261009';
const DEFAULT_PANDA_ROOT = 'D:\\PandaStage-Acceptance\\issue744-endpoint-provenance-run01';
const SHAPE_ID = 'fla-shape-196ba2d2358441409a8b4dce';
const FILL_STYLE = 1;
const TARGET_FILL_COLORS = ['#594F45', '#D7DFD5', '#A4A79E', '#FCFDFA'];
const EXPECTED = Object.freeze({
  'D-A': {
    fileName: 'D-A-authentic-close-M2.fla',
    sha256: '5A501D1F787707A3965BECC31E2E5B8F5DDC519B25369E16EF68E72AF674EB5D',
    pandaFileName: 'panda-DA-byte-identical-M2.json',
    pandaSourceAlias: 'M2-remove-unused-fillstyle4.fla',
    animateRuns: ['issue743-animate-M2.json', 'issue743-animate-D-A-M2-run02.json'],
    targetContourIndex: 1,
  },
  'D-B': {
    fileName: 'D-B-explicit-close-M2.fla',
    sha256: '2ADC8598EE0B4747E95E48F83BA8FE57617E2B189F922B90943EB72C5BAC50A0',
    pandaFileName: 'panda-DB-current.json',
    pandaSourceAlias: null,
    animateRuns: ['issue743-animate-D-B-M2-run01.json', 'issue743-animate-D-B-M2-run02.json'],
    targetContourIndex: 4,
  },
});
const OUTPUT_FILES = [
  'receipt.json',
  'endpoint-ledger-D-A.json',
  'endpoint-ledger-D-B.json',
  'topology-D-A.json',
  'topology-D-B.json',
  'unmatched-segments.json',
];

function parseArgs(argv) {
  const args = {
    acceptanceRoot: DEFAULT_ACCEPTANCE_ROOT,
    pandaRoot: DEFAULT_PANDA_ROOT,
    outDir: path.join(ROOT, 'docs', 'evidence', 'issue-744'),
    overwrite: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--acceptance-root') args.acceptanceRoot = argv[++i];
    else if (key === '--panda-root') args.pandaRoot = argv[++i];
    else if (key === '--out-dir') args.outDir = argv[++i];
    else if (key === '--overwrite') args.overwrite = true;
    else if (key === '--help' || key === '-h') args.help = true;
  }
  return args;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalPoint(point) {
  const normalize = value => Object.is(value, -0) ? '0' : String(value);
  return `${normalize(point.x)},${normalize(point.y)}`;
}

function pointEquals(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function unorderedPairEquals(a0, a1, b0, b1) {
  return (pointEquals(a0, b0) && pointEquals(a1, b1)) ||
    (pointEquals(a0, b1) && pointEquals(a1, b0));
}

function scanEncodedTokens(text) {
  const tokens = [];
  const operators = ['(;', ');', '!', '|', '[', '/', 'S', 'q', 'Q', '(', ')', ';'];
  let i = 0;
  while (i < text.length) {
    if (/\s/u.test(text[i])) {
      i += 1;
      continue;
    }
    const operator = operators.find(candidate => text.startsWith(candidate, i));
    if (operator) {
      tokens.push({ kind: 'operator', value: operator, offset: i });
      i += operator.length;
      continue;
    }
    const start = i;
    while (i < text.length && !/\s/u.test(text[i]) && !operators.some(candidate => text.startsWith(candidate, i))) i += 1;
    if (i === start) {
      tokens.push({ kind: 'unknown', value: text[i], offset: i });
      i += 1;
    } else {
      tokens.push({ kind: 'value', value: text.slice(start, i), offset: start });
    }
  }
  return tokens;
}

function exactTwips(raw) {
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const dot = hex.indexOf('.');
    let intHex = dot < 0 ? hex : hex.slice(0, dot);
    const fracHex = dot < 0 ? '' : hex.slice(dot + 1);
    if (intHex.length === 0) intHex = '0';
    assert.match(intHex, /^[0-9A-Fa-f]+$/u, `invalid XFL integer fixed-point token ${raw}`);
    assert.match(fracHex, /^[0-9A-Fa-f]*$/u, `invalid XFL fractional fixed-point token ${raw}`);
    const width = intHex.length * 4;
    let integer = BigInt(`0x${intHex}`);
    if (intHex.length >= 6 && integer >= (1n << BigInt(width - 1))) integer -= 1n << BigInt(width);
    const denominator = 1n << BigInt(fracHex.length * 4);
    const fraction = fracHex ? BigInt(`0x${fracHex}`) : 0n;
    const numerator = integer * denominator + fraction;
    return {
      raw,
      numerator: numerator.toString(),
      denominator: denominator.toString(),
      value: Number(numerator) / Number(denominator),
      pixel: Number(numerator) / Number(denominator) / 20,
      encoding: 'signed-integer-plus-unsigned-fraction',
    };
  }

  assert.match(raw, /^[-+]?(?:\d+\.?\d*|\.\d+)$/u, `invalid decimal XFL coordinate ${raw}`);
  const sign = raw.startsWith('-') ? -1n : 1n;
  const unsigned = raw.replace(/^[-+]/u, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = sign * (BigInt(whole || '0') * denominator + BigInt(fraction || '0'));
  return {
    raw,
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    value: Number(numerator) / Number(denominator),
    pixel: Number(numerator) / Number(denominator) / 20,
    encoding: 'decimal-twips',
  };
}

function isCoordinateToken(token) {
  if (!token || token.kind !== 'value') return false;
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/u.test(token.value) ||
    /^#[0-9A-Fa-f]*(?:\.[0-9A-Fa-f]*)?$/u.test(token.value);
}

function parseRawEdgeCommands(edge) {
  const encoded = edge.encodedEdges || edge.encodedCubics || '';
  const tokens = scanEncodedTokens(encoded);
  const commands = [];
  const unknownTokens = [];
  let current = null;
  let subpathStart = null;
  let closeOrdinal = 0;
  let subsegmentOrdinal = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length;) {
    const token = tokens[tokenIndex];
    if (token.kind !== 'operator') {
      if (token.kind === 'value' && isCoordinateToken(token)) {
        unknownTokens.push({ tokenIndex, rawToken: token.value, reason: 'coordinate-without-recognized-command' });
      } else if (token.kind !== 'value' || !['q', 'Q', 'S'].includes(token.value)) {
        unknownTokens.push({ tokenIndex, rawToken: token.value, reason: 'unrecognized-token' });
      }
      tokenIndex += 1;
      continue;
    }

    const commandIndex = commands.length;
    const marker = token.value;
    const rawCoordinateTokens = [];
    let next = tokenIndex + 1;
    const expected = marker === '!' || marker === '|' ? 2 : marker === '[' ? 4 : null;
    if (marker === '/') {
      while (next < tokens.length && isCoordinateToken(tokens[next])) {
        rawCoordinateTokens.push(tokens[next].value);
        next += 1;
      }
      closeOrdinal += 1;
    } else if (expected !== null) {
      for (let count = 0; count < expected && next < tokens.length && isCoordinateToken(tokens[next]); count += 1) {
        rawCoordinateTokens.push(tokens[next].value);
        next += 1;
      }
    }

    const coordinates = rawCoordinateTokens.map(exactTwips);
    const command = {
      sourceCommandIndex: commandIndex,
      sourceTokenIndex: tokenIndex,
      rawCommandToken: marker,
      rawTokens: [marker, ...rawCoordinateTokens],
      rawCommandText: [marker, ...rawCoordinateTokens].join(' '),
      coordinateArity: rawCoordinateTokens.length,
      rawCoordinatesTwips: coordinates,
      rawCoordinateEncoding: coordinates.map(value => value.encoding),
      sourceSubsegmentOrdinal: null,
      sourceAuthoredCloseMarkerOrdinal: marker === '/' ? closeOrdinal : null,
      fromTwips: null,
      controlTwips: null,
      toTwips: null,
      fromPx: null,
      controlPx: null,
      toPx: null,
      currentPointBeforeCommandPx: current,
      subpathStartBeforeCommandPx: subpathStart,
    };

    if (marker === '!') {
      if (coordinates.length === 2) {
        command.commandType = 'move';
        command.toTwips = coordinates;
        command.toPx = { x: coordinates[0].pixel, y: coordinates[1].pixel };
        current = command.toPx;
        subpathStart = current;
      } else {
        command.commandType = 'move';
        command.decodeStatus = 'UNOBSERVABLE_MALFORMED_ARITY';
      }
    } else if (marker === '|') {
      command.commandType = 'line';
      subsegmentOrdinal += 1;
      command.sourceSubsegmentOrdinal = subsegmentOrdinal;
      if (coordinates.length === 2 && current) {
        command.fromPx = current;
        command.fromTwips = null;
        command.toTwips = coordinates;
        command.toPx = { x: coordinates[0].pixel, y: coordinates[1].pixel };
        current = command.toPx;
      } else {
        command.decodeStatus = 'UNOBSERVABLE_MALFORMED_ARITY_OR_MISSING_START';
      }
    } else if (marker === '[') {
      command.commandType = 'quadratic';
      subsegmentOrdinal += 1;
      command.sourceSubsegmentOrdinal = subsegmentOrdinal;
      if (coordinates.length === 4 && current) {
        command.fromPx = current;
        command.controlTwips = coordinates.slice(0, 2);
        command.controlPx = { x: coordinates[0].pixel, y: coordinates[1].pixel };
        command.toTwips = coordinates.slice(2, 4);
        command.toPx = { x: coordinates[2].pixel, y: coordinates[3].pixel };
        current = command.toPx;
      } else {
        command.decodeStatus = 'UNOBSERVABLE_MALFORMED_ARITY_OR_MISSING_START';
      }
    } else if (marker === '/') {
      command.commandType = 'slash-marker';
      command.slashPayloadPx = coordinates.length === 2
        ? { x: coordinates[0].pixel, y: coordinates[1].pixel }
        : null;
      command.rawPayloadIsGeometry = 'UNRESOLVED_FROM_XFL_TOKEN_ALONE';
      // Keep both the source point and subpath start. The current Panda decoder
      // interprets '/' as Z and ignores subsequent numeric tokens.
      current = subpathStart;
      subpathStart = null;
    } else {
      command.commandType = `other:${marker}`;
      unknownTokens.push({ tokenIndex, rawToken: marker, reason: 'non-edge-geometry-command' });
    }
    commands.push(command);
    tokenIndex = marker === '/' || expected !== null ? next : tokenIndex + 1;
  }

  return { encoded, commands, unknownTokens };
}

function readMatrixAttributes(xml, beforeFills = false) {
  const candidate = beforeFills ? xml.split(/<fills\b/u, 1)[0] : xml;
  const match = candidate.match(/<Matrix\b([^>]*)\/?\s*>/u);
  if (!match) return null;
  const attributes = Object.fromEntries([...match[1].matchAll(/([A-Za-z][\w]*)="([^"]*)"/gu)]
    .map(attribute => [attribute[1], Number(attribute[2])]));
  return { a: attributes.a ?? 1, b: attributes.b ?? 0, c: attributes.c ?? 0, d: attributes.d ?? 1, tx: attributes.tx ?? 0, ty: attributes.ty ?? 0 };
}

function parseFillSignature(fillXml) {
  const colors = [...fillXml.matchAll(/<GradientEntry\b[^>]*\bcolor="([^"]+)"/gu)].map(match => match[1]);
  const ratios = [...fillXml.matchAll(/<GradientEntry\b[^>]*\bratio="([^"]+)"/gu)].map(match => Number(match[1]));
  const matrix = readMatrixAttributes(fillXml);
  return {
    type: /<LinearGradient\b/u.test(fillXml) ? 'linearGradient' : /<RadialGradient\b/u.test(fillXml) ? 'radialGradient' : 'other',
    spreadMethod: fillXml.match(/\bspreadMethod="([^"]+)"/u)?.[1] ?? null,
    colors,
    ratios,
    matrix,
  };
}

function normalizedShapeForRepeat(shape) {
  return {
    matrix: shape.matrix,
    edges: shape.edges.map(edge => ({ isLine: Boolean(edge.isLine), cubicSegmentIndex: edge.cubicSegmentIndex })),
    vertices: shape.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })),
    contours: shape.contours.map(contour => ({
      interior: contour.interior,
      orientation: contour.orientation,
      fill: {
        style: contour.fill.style,
        color: contour.fill.color,
        colorArray: contour.fill.colorArray,
        posArray: contour.fill.posArray,
        matrix: contour.fill.matrix,
      },
      closedAtStart: contour.closedAtStart,
      stopReason: contour.stopReason,
      halfEdges: contour.halfEdges.map(edge => ({
        edgeIsLine: edge.edgeIsLine,
        cubicSegmentIndex: edge.cubicSegmentIndex,
        from: edge.from,
        to: edge.to,
        controlPoints0To2: edge.edgeGeometry?.controlPoints0To2 ?? null,
      })),
    })),
  };
}

function describeCapture(receiptPath, receipt, target, shape) {
  const screenshotPath = target.stageScreenshotPath;
  return {
    receiptPath,
    receiptSha256: sha256(fs.readFileSync(receiptPath)),
    activeDocumentPathBefore: receipt.invocation?.activeDocumentPathBefore ?? null,
    status: receipt.status,
    hostVersion: receipt.host.animateVersion,
    hostPath: receipt.host.executablePath,
    expectedSourceSha256: target.expectedSourceSha256,
    shapeId: target.shapeId,
    fillStyleIndex: target.fillStyleIndex,
    sourceAddress: target.sourceAddress,
    xflMemberPath: target.xflMemberPath,
    animateDomMemberPath: target.animateDomMemberPath,
    pathMappingRule: target.pathMappingRule,
    targetStatus: target.status,
    saveApiCalled: target.saveApiCalled,
    fileModificationDateBefore: target.fileModificationDateBefore,
    fileModificationDateAfter: target.fileModificationDateAfter,
    fileModificationDateUnchanged: target.fileModificationDateUnchanged,
    expectedCopyPathMatches: target.expectedCopyPathMatches,
    candidateShapeCount: target.candidateShapeCount,
    candidatePath: target.candidatePaths?.[0] ?? null,
    screenshotPath,
    screenshotSha256: screenshotPath && fs.existsSync(screenshotPath) ? sha256(fs.readFileSync(screenshotPath)) : null,
    normalizedTopologySha256: sha256(Buffer.from(JSON.stringify(normalizedShapeForRepeat(shape)), 'utf8')),
  };
}

function validateAnimateCapture(receipt, target, expectedSha) {
  assert.equal(receipt.status, 'CAPTURE_FINISHED_READ_ONLY');
  assert.equal(target.status, 'CAPTURED');
  assert.equal(target.shapeId, SHAPE_ID);
  assert.equal(target.fillStyleIndex, FILL_STYLE);
  assert.equal(target.expectedSourceSha256, expectedSha);
  assert.equal(target.saveApiCalled, false);
  assert.equal(receipt.invocation.saveApiCalled, false);
  assert.equal(receipt.invocation.activeDocumentRestored, true);
  assert.equal(receipt.invocation.documentCountUnchanged, true);
  assert.equal(receipt.invocation.activeDocumentModifiedStateUnchanged, true);
  assert.equal(target.expectedCopyPathMatches, true);
  assert.equal(target.fileModificationDateUnchanged, true);
  assert.equal(target.candidateShapeCount, 1);
  assert.equal(target.candidatePaths?.length, 1);
  assert.equal(target.xflMemberPath, '0/2/1/1/0');
  assert.equal(target.animateDomMemberPath, '0/2/1/1');
}

function validatePanda(report, expectedSha, expectedEdges, expectedSubsegments) {
  assert.equal(report.baseline.gitHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim());
  assert.equal(report.allSourceHashesUnchanged, true);
  assert.equal(report.allPandaRunsDeterministic, true);
  assert.equal(report.results.length, 1);
  const result = report.results[0];
  assert.equal(result.source.sourceSha256Before, expectedSha);
  assert.equal(result.source.sourceSha256After, expectedSha);
  assert.equal(result.source.unchanged, true);
  assert.equal(result.selected.shapeId, SHAPE_ID);
  assert.equal(result.selected.fillStyleIndex, FILL_STYLE);
  assert.equal(result.rawXfl.targetFillEdgeRecordCount, 9);
    assert.equal(result.rawXfl.fullShapeEdgeRecordCount, 9);
  assert.equal(result.rawXfl.edgeRecords.length, 9);
  assert.equal(result.rawXfl.targetFillStyle, FILL_STYLE);
  assert.equal(result.pandaCurrentInterpretation.renderAttempt.status, 'BLOCKED');
  assert.equal(result.pandaCurrentInterpretation.renderAttempt.code, 'TARGET_UNSUPPORTED');
  assert.equal(result.pandaCurrentInterpretation.determinism.stable, true);
  assert.equal(result.pandaCurrentInterpretation.determinism.repeatCount, 2);
  assert.equal(result.rawXfl.rawSubsegmentCount, expectedSubsegments);
  return result;
}

async function locateRawMember(fixtureBytes, rawEdges) {
  const zip = await JSZip.loadAsync(fixtureBytes);
  const candidates = [];
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir || !name.startsWith('LIBRARY/') || !name.toLowerCase().endsWith('.xml')) continue;
    const bytes = await entry.async('nodebuffer');
    const xml = bytes.toString('utf8');
    if (rawEdges.every(edge => xml.includes(edge.rawXml))) candidates.push({ name, bytes, xml });
  }
  assert.equal(candidates.length, 1, `expected exactly one raw XFL member containing all nine Edge records, found ${candidates.length}`);
  return candidates[0];
}

function parsePandaMatrixAndFill(result) {
  const fullShapeXml = result.selected.fullShapeXml;
  const shapeMatrix = readMatrixAttributes(fullShapeXml, true);
  const fillSignature = parseFillSignature(result.selected.fillStyleXml);
  assert.ok(shapeMatrix);
  assert.equal(fillSignature.type, 'linearGradient');
  assert.deepEqual(fillSignature.colors, TARGET_FILL_COLORS);
  return { shapeMatrix, fillSignature };
}

function pointToTwips(point) {
  const convert = value => {
    const scaled = value * 20;
    return Number.isInteger(scaled) ? String(scaled) : null;
  };
  return { x: convert(point.x), y: convert(point.y) };
}

function pandaGeometryMatchesAnimate(mapping, halfEdge) {
  const command = mapping.command;
  if (command.type === 'L') {
    return Boolean(halfEdge.edgeIsLine) && unorderedPairEquals(mapping.from, mapping.to, halfEdge.from, halfEdge.to);
  }
  if (command.type !== 'Q' || halfEdge.edgeIsLine) return false;
  const points = halfEdge.edgeGeometry?.controlPoints0To2 ?? [];
  return points.length === 3 &&
    unorderedPairEquals(mapping.from, mapping.to, points[0], points[2]) &&
    command.cx === points[1].x && command.cy === points[1].y;
}

function relationToHalfEdge(mapping, halfEdge) {
  return pointEquals(mapping.from, halfEdge.from) && pointEquals(mapping.to, halfEdge.to)
    ? 'same-directed'
    : pointEquals(mapping.from, halfEdge.to) && pointEquals(mapping.to, halfEdge.from)
      ? 'reverse-directed'
      : 'geometry-exact-direction-unobservable';
}

function buildAnimateMap(shape, pandaMappings, parsedEdges, targetContourIndex) {
  const rawGeometry = parsedEdges.flatMap(edge => edge.commands
    .filter(command => ['line', 'quadratic'].includes(command.commandType) && command.fromPx && command.toPx)
    .map(command => ({
      edgeOrdinal: edge.edgeIndex,
      command,
      sourceStyle: edge,
    })));
  const slashPayloads = parsedEdges.flatMap(edge => edge.commands
    .filter(command => command.commandType === 'slash-marker' && command.slashPayloadPx && command.currentPointBeforeCommandPx)
    .map(command => ({ edgeOrdinal: edge.edgeIndex, command })));

  const allHalfEdges = [];
  shape.contours.forEach((contour, contourIndex) => {
    contour.halfEdges.forEach(halfEdge => allHalfEdges.push({ contourIndex, contour, halfEdge }));
  });

  const animateRows = allHalfEdges.map(({ contourIndex, contour, halfEdge }) => {
    const pandaMatches = pandaMappings
      .filter(mapping => pandaGeometryMatchesAnimate(mapping, halfEdge))
      .map(mapping => ({
        boundarySegmentId: mapping.__boundarySegmentId,
        sourceEdgeOrdinal: mapping.sourceEdgeIndex,
        sourceSubsegmentOrdinal: mapping.sourceSubsegmentOrdinal,
        originKind: mapping.originKind,
        directedRelation: relationToHalfEdge(mapping, halfEdge),
      }));
    const rawMatches = rawGeometry
      .filter(({ command }) => command.commandType === (halfEdge.edgeIsLine ? 'line' : 'quadratic') &&
        unorderedPairEquals(command.fromPx, command.toPx, halfEdge.from, halfEdge.to) &&
        (command.commandType === 'line' || (
          command.controlPx?.x === halfEdge.edgeGeometry?.controlPoints0To2?.[1]?.x &&
          command.controlPx?.y === halfEdge.edgeGeometry?.controlPoints0To2?.[1]?.y
        )))
      .map(({ edgeOrdinal, command, sourceStyle }) => ({
        sourceEdgeOrdinal: edgeOrdinal,
        sourceCommandIndex: command.sourceCommandIndex,
        sourceSubsegmentOrdinal: command.sourceSubsegmentOrdinal,
        fillStyle0: sourceStyle.fillStyle0,
        fillStyle1: sourceStyle.fillStyle1,
      }));
    const slashMatches = slashPayloads
      .filter(({ command }) => unorderedPairEquals(
        command.currentPointBeforeCommandPx,
        command.slashPayloadPx,
        halfEdge.from,
        halfEdge.to,
      ))
      .map(({ edgeOrdinal, command }) => ({
        sourceEdgeOrdinal: edgeOrdinal,
        sourceCommandIndex: command.sourceCommandIndex,
        sourceAuthoredCloseMarkerOrdinal: command.sourceAuthoredCloseMarkerOrdinal,
        rawCommandText: command.rawCommandText,
        observedAsUnorderedEndpointPair: true,
        semanticConclusion: 'OBSERVED_FOR_THIS_CAPTURE_ONLY; NOT A UNIVERSAL_SLASH_RULE',
      }));
    const endpointAnchors = rawGeometry
      .filter(({ command }) => pointEquals(command.fromPx, halfEdge.from) || pointEquals(command.fromPx, halfEdge.to) ||
        pointEquals(command.toPx, halfEdge.from) || pointEquals(command.toPx, halfEdge.to))
      .map(({ edgeOrdinal, command }) => ({
        sourceEdgeOrdinal: edgeOrdinal,
        sourceCommandIndex: command.sourceCommandIndex,
        sourceSubsegmentOrdinal: command.sourceSubsegmentOrdinal,
        exactEndpointOnly: true,
      }));
    return {
      contourIndex,
      contourFillStyle: contour.fill.style,
      contourInterior: contour.interior,
      contourOrientation: contour.orientation,
      walkIndex: halfEdge.walkIndex,
      halfEdgeId: halfEdge.id,
      nextHalfEdgeId: halfEdge.nextId,
      prevHalfEdgeId: halfEdge.prevId,
      oppositeHalfEdgeId: halfEdge.oppositeId,
      edgeId: halfEdge.edgeId,
      edgeIsLine: Boolean(halfEdge.edgeIsLine),
      geometryType: halfEdge.edgeIsLine ? 'line' : 'quadratic-or-curve-unclassified',
      from: halfEdge.from,
      to: halfEdge.to,
      fromTwipsIfExact: pointToTwips(halfEdge.from),
      toTwipsIfExact: pointToTwips(halfEdge.to),
      edgeGeometry: {
        cubicSegmentIndex: halfEdge.edgeGeometry?.cubicSegmentIndex ?? null,
        controlPoints0To2: halfEdge.edgeGeometry?.controlPoints0To2 ?? null,
      },
      pandaExactMatches: pandaMatches,
      rawXflExactMatches: rawMatches,
      rawSlashPayloadPairMatches: slashMatches,
      rawXflEndpointOnlyAnchors: endpointAnchors,
      sourceEdgeRelation: pandaMatches.length || rawMatches.length || slashMatches.length
        ? 'MAPPED_BY_EXACT_GEOMETRY_OR_CAPTURED_SLASH_ENDPOINT_PAIR'
        : 'UNOBSERVABLE_FROM_JSFL_RELATION_FIELDS; NO EXACT SOURCE GEOMETRY MATCH',
      isTargetContour: contourIndex === targetContourIndex,
    };
  });
  return { allHalfEdges, animateRows };
}

function incidenceFingerprint(segments) {
  const normalized = segments.map(segment => ({
    geometryType: segment.geometryType,
    fillStyle: segment.fillStyle,
    sourceFillSide: segment.sourceFillSide ?? null,
    from: segment.from,
    control: segment.control ?? null,
    to: segment.to,
  }));
  normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    algorithm: 'exact directed endpoints + geometry + fill side; sorted JSON; no tolerance',
    segmentCount: normalized.length,
    sha256: sha256(Buffer.from(JSON.stringify(normalized), 'utf8')),
    normalized,
  };
}

function topologyFingerprint(contours) {
  const normalized = contours.map((contour, index) => ({
    contourIndex: index,
    fillStyle: contour.fill.style,
    colors: contour.fill.colorArray,
    positions: contour.fill.posArray,
    interior: contour.interior,
    orientation: contour.orientation,
    closedAtStart: contour.closedAtStart,
    stopReason: contour.stopReason,
    halfEdges: contour.halfEdges.map(edge => ({
      line: Boolean(edge.edgeIsLine),
      from: edge.from,
      to: edge.to,
      controlPoints0To2: edge.edgeGeometry?.controlPoints0To2 ?? null,
    })),
  }));
  return {
    algorithm: 'ordered contour membership + fill/interior/orientation + exact directed half-edge geometry',
    sha256: sha256(Buffer.from(JSON.stringify(normalized), 'utf8')),
    contourCount: normalized.length,
    normalized,
  };
}

function buildContourRecords(shape, targetContourIndex, fillSignature) {
  const contours = shape.contours.map((contour, contourIndex) => ({
    contourIndex,
    fill: contour.fill,
    interior: contour.interior,
    orientation: contour.orientation,
    startingHalfEdgeId: contour.startingHalfEdgeId,
    closedAtStart: contour.closedAtStart,
    stopReason: contour.stopReason,
    halfEdgeCount: contour.halfEdges.length,
    lineHalfEdgeCount: contour.halfEdges.filter(edge => edge.edgeIsLine).length,
    curvedHalfEdgeCount: contour.halfEdges.filter(edge => !edge.edgeIsLine).length,
    halfEdges: contour.halfEdges.map(edge => ({
      walkIndex: edge.walkIndex,
      id: edge.id,
      nextId: edge.nextId,
      prevId: edge.prevId,
      oppositeId: edge.oppositeId,
      edgeId: edge.edgeId,
      edgeIsLine: Boolean(edge.edgeIsLine),
      cubicSegmentIndex: edge.cubicSegmentIndex,
      from: edge.from,
      to: edge.to,
      geometry: edge.edgeGeometry,
    })),
  }));
  const styleCandidates = contours.filter(contour => contour.fill.style === fillSignature.type &&
    JSON.stringify(contour.fill.colorArray) === JSON.stringify(fillSignature.colors));
  const interiorCandidates = styleCandidates.filter(contour => contour.interior === true);
  assert.ok(interiorCandidates.some(contour => contour.contourIndex === targetContourIndex));
  assert.equal(interiorCandidates.length, 1, 'target FillStyle contour must be uniquely identified by exact fill colors plus interior status');
  return { contours, styleCandidates, interiorCandidates };
}

function buildEndpointLedger(caseKey, config, pandaResult, member, archiveSha, capturePair) {
  const rawEdges = pandaResult.rawXfl.edgeRecords.map(edge => ({
    edgeIndex: edge.edgeIndex,
    fillStyle0: edge.fillStyle0,
    fillStyle1: edge.fillStyle1,
    strokeStyle: edge.strokeStyle,
    encodedEdges: edge.encodedEdges,
    encodedCubics: edge.encodedCubics,
    rawXml: edge.rawXml,
    rawXmlSha256: sha256(Buffer.from(edge.rawXml, 'utf8')),
    counts: edge.counts,
    rawSegmentCount: edge.rawSegmentCount,
    sourceCommands: [],
    targetFillStyle1ContributionIds: [],
  }));
  const parsedEdges = rawEdges.map(edge => ({ ...edge, ...parseRawEdgeCommands(edge) }));
  assert.equal(parsedEdges.length, 9);
  assert.ok(parsedEdges.every(edge => edge.rawXml && member.xml.includes(edge.rawXml)), 'raw Edge excerpts must be present verbatim in the frozen XFL member');
  for (const edge of parsedEdges) {
    assert.ok(edge.fillStyle0 === FILL_STYLE || edge.fillStyle1 === FILL_STYLE, `Edge ${edge.edgeIndex} does not contribute to FillStyle ${FILL_STYLE}`);
    assert.equal(edge.unknownTokens.length, 0, `Edge ${edge.edgeIndex} contains an unparsed command token`);
    edge.sourceCommands = edge.commands;
  }

  const panda = pandaResult.pandaCurrentInterpretation;
  const rawMappings = panda.rawToPandaSegmentMap.filter(mapping => mapping.fillStyleIndex === FILL_STYLE);
  const boundaryMappings = panda.fillBoundaryByStyle[String(FILL_STYLE)].boundarySegmentMapping;
  assert.equal(rawMappings.length, 23);
  assert.equal(boundaryMappings.length, rawMappings.length);
  const contributionRows = rawMappings.map((mapping, mapIndex) => {
    const sourceEdge = parsedEdges.find(edge => edge.edgeIndex === mapping.sourceEdgeIndex);
    assert.ok(sourceEdge, `missing source Edge ${mapping.sourceEdgeIndex}`);
    const boundaryId = boundaryMappings.findIndex(candidate =>
      candidate.sourceEdgeIndex === mapping.sourceEdgeIndex &&
      candidate.sourceSubsegmentOrdinal === mapping.sourceSubsegmentOrdinal &&
      candidate.pandaCommandIndex === mapping.pandaCommandIndex &&
      candidate.fillStyleIndex === mapping.fillStyleIndex &&
      candidate.sourceFillSide === mapping.sourceFillSide &&
      candidate.reversed === mapping.reversed &&
      candidate.originKind === mapping.originKind &&
      candidate.sourceAuthoredCloseMarkerOrdinal === mapping.sourceAuthoredCloseMarkerOrdinal &&
      pointEquals(candidate.from, mapping.orientedFrom) && pointEquals(candidate.to, mapping.orientedTo) &&
      JSON.stringify(candidate.command) === JSON.stringify(mapping.orientedCommand));
    assert.ok(boundaryId >= 0, `no fill boundary id for Panda map row ${mapIndex}`);
    const sourceCommand = mapping.originKind === 'raw-edge-subsegment'
      ? sourceEdge.commands.find(command => command.sourceSubsegmentOrdinal === mapping.sourceSubsegmentOrdinal)
      : sourceEdge.commands.find(command => command.commandType === 'slash-marker' &&
        command.sourceAuthoredCloseMarkerOrdinal === mapping.sourceAuthoredCloseMarkerOrdinal);
    assert.ok(sourceCommand, `no raw source command for Panda mapping edge ${mapping.sourceEdgeIndex} ordinal ${mapping.sourceSubsegmentOrdinal}`);

    if (mapping.originKind === 'raw-edge-subsegment') {
      assert.equal(sourceCommand.commandType === 'quadratic' ? 'Q' : 'L', mapping.orientedCommand.type);
      assert.ok(pointEquals(sourceCommand.fromPx, mapping.sourceFrom));
      assert.ok(pointEquals(sourceCommand.toPx, mapping.sourceTo));
    }

    const graph = panda.fillBoundaryByStyle[String(FILL_STYLE)].endpointGraph.endpoints;
    const getDegree = point => {
      const node = graph.find(candidate => pointEquals(candidate.point, point));
      return node ? { inDegree: node.inDegree, outDegree: node.outDegree } : null;
    };
    const row = {
      contributionId: `${caseKey}:FillStyle1:boundary-${boundaryId}`,
      fixture: caseKey,
      sourceEdgeOrdinal: mapping.sourceEdgeIndex,
      sourceEdgeXmlSha256: sourceEdge.rawXmlSha256,
      sourceCommandIndex: sourceCommand.sourceCommandIndex,
      rawCommand: {
        token: sourceCommand.rawCommandToken,
        tokens: sourceCommand.rawTokens,
        text: sourceCommand.rawCommandText,
        coordinateArity: sourceCommand.coordinateArity,
        coordinatesTwips: sourceCommand.rawCoordinatesTwips.map(value => ({ raw: value.raw, numerator: value.numerator, denominator: value.denominator, canonicalTwips: value.value })),
        sourceSubsegmentOrdinal: sourceCommand.sourceSubsegmentOrdinal,
        sourceAuthoredCloseMarkerOrdinal: sourceCommand.sourceAuthoredCloseMarkerOrdinal,
      },
      rawGeometry: mapping.originKind === 'raw-edge-subsegment' ? {
        type: sourceCommand.commandType,
        fromTwips: sourceCommand.fromPx ? pointToTwips(sourceCommand.fromPx) : null,
        controlTwips: sourceCommand.controlPx ? pointToTwips(sourceCommand.controlPx) : null,
        toTwips: sourceCommand.toPx ? pointToTwips(sourceCommand.toPx) : null,
        fromPx: sourceCommand.fromPx,
        controlPx: sourceCommand.controlPx,
        toPx: sourceCommand.toPx,
      } : {
        type: 'slash-marker-payload-not-assumed-to-be-geometry',
        currentPointBeforeMarkerPx: sourceCommand.currentPointBeforeCommandPx,
        subpathStartBeforeMarkerPx: sourceCommand.subpathStartBeforeCommandPx,
        payloadPx: sourceCommand.slashPayloadPx,
        semanticStatus: 'UNRESOLVED_FROM_TOKEN_ALONE',
      },
      sourceStyles: {
        fillStyle0: sourceEdge.fillStyle0,
        fillStyle1: sourceEdge.fillStyle1,
        strokeStyle: sourceEdge.strokeStyle,
        scope: 'XFL Edge-record attributes; no mid-edge style change was identified in this 9-record target subset',
      },
      sourceFillSide: mapping.sourceFillSide,
      sideNormalization: {
        reversed: mapping.reversed,
        rule: mapping.sourceFillSide === 'fillStyle0' ? 'current Panda observation maps FillStyle0 contribution in reverse source direction' : 'current Panda observation preserves FillStyle1 source direction',
      },
      pandaDecodedSegment: {
        pandaCommandIndex: mapping.pandaCommandIndex,
        originKind: mapping.originKind,
        from: mapping.sourceFrom,
        to: mapping.sourceTo,
        command: mapping.orientedCommand,
        rawSubsegmentCountMatch: mapping.rawSubsegmentCountMatch,
        authoredCloseMarkerOrdinal: mapping.sourceAuthoredCloseMarkerOrdinal,
      },
      pandaOrientedFillContribution: {
        from: mapping.orientedFrom,
        to: mapping.orientedTo,
        geometryType: mapping.orientedCommand.type,
        command: mapping.orientedCommand,
      },
      pandaBoundarySegmentId: `FillStyle${FILL_STYLE}:boundary-${boundaryId}`,
      pandaBoundaryIndex: boundaryId,
      endpointDegrees: {
        from: getDegree(mapping.orientedFrom),
        to: getDegree(mapping.orientedTo),
      },
      provenanceConfidence: mapping.originKind === 'raw-edge-subsegment'
        ? 'EXACT_RAW_SUBSEGMENT_TO_PRODUCTION_MAP'
        : 'EXACT_PRODUCTION_AUTHORED_CLOSE_MAPPING; RAW SLASH PAYLOAD SEMANTICS NOT ASSUMED',
    };
    sourceEdge.targetFillStyle1ContributionIds.push(row.contributionId);
    return row;
  });

  const criticalEndpoints = [
    { x: 935.25, y: 659.15 },
    { x: 960.85, y: 643.6 },
  ];
  const endpointTrace = criticalEndpoints.map(point => {
    const node = panda.fillBoundaryByStyle[String(FILL_STYLE)].endpointGraph.imbalancedEndpoints
      .find(candidate => pointEquals(candidate.point, point));
    assert.ok(node, `expected named open endpoint ${canonicalPoint(point)}`);
    const adjacent = contributionRows.filter(row => pointEquals(row.pandaOrientedFillContribution.from, point) ||
      pointEquals(row.pandaOrientedFillContribution.to, point));
    const rawOccurrences = [];
    for (const edge of parsedEdges) {
      for (const command of edge.commands) {
        const points = [command.fromPx, command.toPx, command.currentPointBeforeCommandPx, command.subpathStartBeforeCommandPx, command.slashPayloadPx].filter(Boolean);
        if (points.some(candidate => pointEquals(candidate, point))) {
          const occurrenceKinds = [
            pointEquals(command.fromPx, point) ? 'segment-start' : null,
            pointEquals(command.toPx, point) ? (command.commandType === 'move' ? 'move-to' : 'segment-end') : null,
            command.commandType === 'slash-marker' && pointEquals(command.currentPointBeforeCommandPx, point) ? 'slash-current-point' : null,
            command.commandType === 'slash-marker' && pointEquals(command.subpathStartBeforeCommandPx, point) ? 'slash-subpath-start' : null,
            pointEquals(command.slashPayloadPx, point) ? 'slash-coordinate-payload' : null,
          ].filter(Boolean);
          if (occurrenceKinds.length === 0) continue;
          rawOccurrences.push({
          sourceEdgeOrdinal: edge.edgeIndex,
          sourceCommandIndex: command.sourceCommandIndex,
          sourceCommandToken: command.rawCommandToken,
          sourceSubsegmentOrdinal: command.sourceSubsegmentOrdinal,
          sourceAuthoredCloseMarkerOrdinal: command.sourceAuthoredCloseMarkerOrdinal,
          rawCommandText: command.rawCommandText,
          occurrenceKinds,
          });
        }
      }
    }
    return {
      endpoint: point,
      graphDegree: { inDegree: node.inDegree, outDegree: node.outDegree },
      adjacentPandaBoundarySegments: adjacent.map(row => ({ contributionId: row.contributionId, sourceEdgeOrdinal: row.sourceEdgeOrdinal, sourceCommandIndex: row.sourceCommandIndex, sourceFillSide: row.sourceFillSide, from: row.pandaOrientedFillContribution.from, to: row.pandaOrientedFillContribution.to })),
      rawXflOccurrences: rawOccurrences,
    };
  });

  const allStyleEdges = parsedEdges.map(edge => ({
    sourceEdgeOrdinal: edge.edgeIndex,
    sourceEdgeXmlSha256: edge.rawXmlSha256,
    encodedEdges: edge.encodedEdges,
    encodedCubics: edge.encodedCubics,
    fillStyle0: edge.fillStyle0,
    fillStyle1: edge.fillStyle1,
    strokeStyle: edge.strokeStyle,
    rawSegmentCount: edge.rawSegmentCount,
    rawCommandTokens: edge.commands.map(command => ({
      sourceCommandIndex: command.sourceCommandIndex,
      sourceTokenIndex: command.sourceTokenIndex,
      token: command.rawCommandToken,
      text: command.rawCommandText,
      type: command.commandType,
      coordinateArity: command.coordinateArity,
      coordinatesTwips: command.rawCoordinatesTwips.map(value => value.raw),
      sourceSubsegmentOrdinal: command.sourceSubsegmentOrdinal,
      sourceAuthoredCloseMarkerOrdinal: command.sourceAuthoredCloseMarkerOrdinal,
      fromPx: command.fromPx,
      controlPx: command.controlPx,
      toPx: command.toPx,
      currentPointBeforeCommandPx: command.currentPointBeforeCommandPx,
      subpathStartBeforeCommandPx: command.subpathStartBeforeCommandPx,
      slashPayloadPx: command.slashPayloadPx,
      rawPayloadIsGeometry: command.rawPayloadIsGeometry,
    })),
    targetFillStyle1ContributionIds: edge.targetFillStyle1ContributionIds,
  }));

  const rawExplicitSegments = parsedEdges.flatMap(edge => edge.commands
    .filter(command => ['line', 'quadratic'].includes(command.commandType) && command.fromPx && command.toPx)
    .filter(() => edge.fillStyle0 === FILL_STYLE || edge.fillStyle1 === FILL_STYLE)
    .map(command => ({
      geometryType: command.commandType,
      fillStyle: FILL_STYLE,
      sourceFillSide: edge.fillStyle0 === FILL_STYLE ? 'fillStyle0' : 'fillStyle1',
      from: command.fromPx,
      control: command.controlPx,
      to: command.toPx,
    })));
  const pandaRowsForFingerprint = contributionRows.map(row => ({
    geometryType: row.pandaOrientedFillContribution.geometryType,
    fillStyle: FILL_STYLE,
    sourceFillSide: row.sourceFillSide,
    from: row.pandaOrientedFillContribution.from,
    control: row.pandaOrientedFillContribution.command.type === 'Q'
      ? { x: row.pandaOrientedFillContribution.command.cx, y: row.pandaOrientedFillContribution.command.cy }
      : null,
    to: row.pandaOrientedFillContribution.to,
  }));

  return {
    schemaVersion: 'issue744-endpoint-ledger/1',
    fixture: caseKey,
    frozenInput: {
      path: path.join(path.dirname(config.fixturePath), config.fileName),
      bytes: archiveSha.bytes,
      sha256: archiveSha.sha256,
      xflMember: member.name,
      xflMemberByteLength: member.bytes.length,
      xflMemberSha256: sha256(member.bytes),
      shapeId: SHAPE_ID,
      targetFillStyle: FILL_STYLE,
      xflShapeBlockSha256: pandaResult.selected.shapeBlockSha256,
      fillStyleXmlSha256: sha256(Buffer.from(pandaResult.selected.fillStyleXml, 'utf8')),
    },
    pandaCurrentInterpretation: {
      baselineGitHead: capturePair.pandaBaseline,
      status: panda.renderAttempt.status,
      code: panda.renderAttempt.code,
      message: panda.renderAttempt.message,
      targetBoundarySegmentCount: boundaryMappings.length,
      rawSourceTargetSubsegmentCount: pandaResult.rawXfl.targetFillRawSubsegmentCountsByType.line + pandaResult.rawXfl.targetFillRawSubsegmentCountsByType.quadratic + pandaResult.rawXfl.targetFillRawSubsegmentCountsByType.cubic,
      authoredCloseBoundaryMappingCount: panda.fillBoundaryByStyle[String(FILL_STYLE)].authoredCloseBoundaryMappingCount,
      deterministic: panda.determinism,
      boundaryGraph: panda.fillBoundaryByStyle[String(FILL_STYLE)].endpointGraph,
      sourceOrderCycleDecomposition: panda.fillBoundaryByStyle[String(FILL_STYLE)].exactSourceOrderCycleDecomposition,
      sideMappingMatchesBoundaryCount: panda.fillBoundaryByStyle[String(FILL_STYLE)].sourceSideMappingMatchesBoundaryCount,
      boundaryInputHash: panda.fillBoundaryByStyle[String(FILL_STYLE)].boundaryInputHash,
      mappedBoundaryHash: panda.fillBoundaryByStyle[String(FILL_STYLE)].mappedBoundaryHash,
      normalizedInputEqualsMappedSourceSides: panda.fillBoundaryByStyle[String(FILL_STYLE)].normalizedInputEqualsMappedSourceSides,
    },
    sourceStyleAndCommandInventory: {
      targetFillStyle: FILL_STYLE,
      targetEdgeRecordCount: rawEdges.filter(edge => edge.fillStyle0 === FILL_STYLE || edge.fillStyle1 === FILL_STYLE).length,
      fillStyle0OwnershipEdgeCount: rawEdges.filter(edge => edge.fillStyle0 === FILL_STYLE).length,
      fillStyle1OwnershipEdgeCount: rawEdges.filter(edge => edge.fillStyle1 === FILL_STYLE).length,
      fillStyle0OwnershipSubsegmentCount: rawEdges.filter(edge => edge.fillStyle0 === FILL_STYLE).reduce((sum, edge) => sum + edge.rawSegmentCount, 0),
      fillStyle1OwnershipSubsegmentCount: rawEdges.filter(edge => edge.fillStyle1 === FILL_STYLE).reduce((sum, edge) => sum + edge.rawSegmentCount, 0),
      noMidEdgeStyleChangeCount: pandaResult.rawXfl.rawMidEdgeStyleChangeCount,
      styleRunChangeCount: panda.retainedStyleChangeCount,
      edgeRecords: allStyleEdges,
    },
    fillStyle1Contributions: contributionRows,
    rawCommandsWithoutPandaFillContribution: allStyleEdges.flatMap(edge => edge.rawCommandTokens
      .filter(command => command.token === '/')
      .filter(command => !contributionRows.some(row => row.sourceEdgeOrdinal === edge.sourceEdgeOrdinal &&
        row.rawCommand.sourceAuthoredCloseMarkerOrdinal === command.sourceAuthoredCloseMarkerOrdinal))
      .map(command => ({
        sourceEdgeOrdinal: edge.sourceEdgeOrdinal,
        sourceCommandIndex: command.sourceCommandIndex,
        sourceAuthoredCloseMarkerOrdinal: command.sourceAuthoredCloseMarkerOrdinal,
        rawCommandText: command.text,
        rawTokenArity: command.coordinateArity,
        payloadCoordinatesTwips: command.coordinatesTwips,
        currentPandaDecodeObservation: 'The production decoder emits Z for / and advances past only that token; the following numeric payload is not consumed as line geometry.',
      }))),
    endpointTrace,
    incidenceFingerprints: {
      rawXflExplicitSegments: incidenceFingerprint(rawExplicitSegments),
      pandaFillOwnedSegments: incidenceFingerprint(pandaRowsForFingerprint),
    },
    coordinateAndTransformProvenance: {
      rawXflCoordinateSpace: 'selected XFL DOMShape local twips; exact conversion to CSS px is twips / 20',
      pandaCoordinateSpace: 'direct selected Shape probe with identity worldTransform; current Main decoder outputs local px from XFL twips / 20',
      animateCoordinateSpace: 'selected Animate DOM Shape HalfEdge local coordinates returned by JSFL in px',
      endpointMatching: 'exact numeric equality only; no epsilon, snapping, or transform was applied to endpoint coordinates',
      rawShapeMatrix: capturePair.rawShapeMatrix,
      animateShapeMatrix: capturePair.animateShapeMatrix,
      shapeMatrixExactMatch: JSON.stringify(capturePair.rawShapeMatrix) === JSON.stringify(capturePair.animateShapeMatrix),
      shapeMatrixTranslationExactMatch: capturePair.rawShapeMatrix.tx === capturePair.animateShapeMatrix.tx && capturePair.rawShapeMatrix.ty === capturePair.animateShapeMatrix.ty,
      jsflElementInventory: capturePair.elementInventory,
      transformComposition: 'UNOBSERVABLE: JSFL receipt records nested element matrices but does not prove whether each is relative or already composed; matrices are preserved as observations and were not multiplied.',
      targetFillMatrixRawXfl: capturePair.fillSignature.matrix,
      targetFillMatrixAnimateJsfl: capturePair.animateFillMatrix,
      targetFillMatrixExactMatch: JSON.stringify(capturePair.fillSignature.matrix) === JSON.stringify(capturePair.animateFillMatrix),
      sourceMemberStyleIdentity: 'exact ordered GradientEntry colors plus unique interior contour within the selected Shape; Animate JSFL does not expose source FillStyle index directly',
    },
    evidenceLevel: {
      endpointA: '(935.25,659.15): Panda source is Edge 4 command 1; D-A Animate contains an exact slash-payload HalfEdge at this vertex; D-B target gradient contour no longer contains the vertex. The D-B cross-stage ancestry of its replacement contour segments is UNOBSERVABLE.',
      endpointB: '(960.85,643.6): Panda source is Edge 1 command 1; D-A Animate closes this local junction with an exact Edge 0 slash-payload HalfEdge; D-B target gradient contour moves this edge out of the selected interior contour. The D-B region-membership relation is not an exact source-edge match.',
      firstDivergence: caseKey === 'D-A'
        ? 'COMMAND_DECODE is the smallest supported local divergence: each raw / token is followed by two coordinate tokens, while current Panda emits Z and skips those coordinates. The exact two Animate HalfEdges use the corresponding slash current-point/payload endpoint pairs; one Panda close-derived line instead returns to the previous subpath start.'
        : 'MIXED: current Panda decodes the first / as Z and skips its two-coordinate payload; however, Animate assigns several raw/Panda segments to different contours and the four target-gradient HalfEdges do not have exact source geometry matches. The first causal seam for the full target region is not proven.',
      confidence: caseKey === 'D-A' ? 'HIGH_LOCAL_OBSERVATION; NOT UNIVERSAL SEMANTICS' : 'INSUFFICIENT_FOR_CAUSAL_CLASSIFICATION',
    },
  };
}

function buildTopology(caseKey, config, capturePair, pandaResult, member, endpointLedger) {
  const shape = capturePair.primaryShape;
  const { contours, styleCandidates, interiorCandidates } = buildContourRecords(shape, config.targetContourIndex, capturePair.fillSignature);
  const mappings = pandaResult.pandaCurrentInterpretation.fillBoundaryByStyle[String(FILL_STYLE)].boundarySegmentMapping.map((mapping, index) => ({
    ...mapping,
    __boundarySegmentId: `FillStyle${FILL_STYLE}:boundary-${index}`,
  }));
  const parsedEdges = endpointLedger.sourceStyleAndCommandInventory.edgeRecords.map(edge => ({
    ...edge,
    commands: edge.rawCommandTokens.map(command => ({
      sourceCommandIndex: command.sourceCommandIndex,
      sourceSubsegmentOrdinal: command.sourceSubsegmentOrdinal,
      sourceAuthoredCloseMarkerOrdinal: command.sourceAuthoredCloseMarkerOrdinal,
      rawCommandToken: command.token,
      rawCommandText: command.text,
      commandType: command.type,
      fromPx: command.fromPx,
      toPx: command.toPx,
      controlPx: command.controlPx,
      currentPointBeforeCommandPx: command.currentPointBeforeCommandPx,
      subpathStartBeforeCommandPx: command.subpathStartBeforeCommandPx,
      slashPayloadPx: command.slashPayloadPx,
    })),
  }));
  const { allHalfEdges, animateRows } = buildAnimateMap(shape, mappings, parsedEdges, config.targetContourIndex);
  const targetRows = animateRows.filter(row => row.isTargetContour);
  const targetContour = shape.contours[config.targetContourIndex];
  const targetPandaExact = targetRows.filter(row => row.pandaExactMatches.length > 0);
  const targetRawSlash = targetRows.filter(row => row.rawSlashPayloadPairMatches.length > 0);
  const targetUnmatched = targetRows.filter(row => row.pandaExactMatches.length === 0 && row.rawXflExactMatches.length === 0 && row.rawSlashPayloadPairMatches.length === 0);
  const pandaTargetExact = mappings.map(mapping => ({ mapping, matches: allHalfEdges.filter(({ halfEdge }) => pandaGeometryMatchesAnimate(mapping, halfEdge)) }))
    .filter(entry => entry.matches.some(({ contourIndex }) => contourIndex === config.targetContourIndex));

  const targetAnimateSegments = targetRows.map(row => ({
    geometryType: row.geometryType,
    fillStyle: FILL_STYLE,
    sourceFillSide: null,
    from: row.from,
    control: row.edgeGeometry.controlPoints0To2?.length === 3 ? row.edgeGeometry.controlPoints0To2[1] : null,
    to: row.to,
  }));

  return {
    schemaVersion: 'issue744-topology-map/1',
    fixture: caseKey,
    animateCapture: capturePair.captureSummary,
    targetMapping: {
      shapeId: SHAPE_ID,
      xflMemberPath: capturePair.primaryTarget.xflMemberPath,
      animateDomMemberPath: capturePair.primaryTarget.animateDomMemberPath,
      fillStyleIndex: FILL_STYLE,
      fillSignature: capturePair.fillSignature,
      sameSignatureContours: styleCandidates.map(contour => ({ contourIndex: contour.contourIndex, interior: contour.interior, orientation: contour.orientation, halfEdgeCount: contour.halfEdgeCount })),
      interiorCandidateContours: interiorCandidates.map(contour => contour.contourIndex),
      targetContourIndex: config.targetContourIndex,
      targetContourIdentityConfidence: 'EXACT ORDERED GRADIENT COLOR SIGNATURE + UNIQUE INTERIOR CONTOUR; source FillStyle index is not directly exposed by JSFL',
      targetContour: contours[config.targetContourIndex],
    },
    contourInventory: contours.map(({ contourIndex, fill, interior, orientation, closedAtStart, stopReason, halfEdgeCount, lineHalfEdgeCount, curvedHalfEdgeCount }) => ({
      contourIndex, fill, interior, orientation, closedAtStart, stopReason, halfEdgeCount, lineHalfEdgeCount, curvedHalfEdgeCount,
    })),
    allContours: contours,
    sourceToAnimateExactMap: animateRows,
    incidenceAndTopologyFingerprints: {
      rawXflExplicitSegments: endpointLedger.incidenceFingerprints.rawXflExplicitSegments,
      pandaFillOwnedSegments: endpointLedger.incidenceFingerprints.pandaFillOwnedSegments,
      animateTargetContourSegments: incidenceFingerprint(targetAnimateSegments),
      animateOrderedContourTopology: topologyFingerprint(shape.contours),
      exactMatchingRules: {
        lines: 'exact unordered endpoint pair; report direction separately',
        quadratics: 'exact unordered endpoint pair plus exact single control-point equality',
        coordinates: 'strict numeric equality after XFL twips / 20; no tolerance',
        subdivision: 'not inferred from partial endpoint overlap; only exact primitive matches are claimed',
      },
    },
    animateTargetContourAccounting: {
      halfEdgeCount: targetContour.halfEdges.length,
      lineHalfEdgeCount: targetContour.halfEdges.filter(edge => edge.edgeIsLine).length,
      curvedHalfEdgeCount: targetContour.halfEdges.filter(edge => !edge.edgeIsLine).length,
      pandaExactHalfEdgeMatchCount: targetPandaExact.length,
      slashPayloadPairHalfEdgeCount: targetRawSlash.length,
      exactUnmatchedHalfEdgeCount: targetUnmatched.length,
      matchingPandaBoundarySegmentCount: pandaTargetExact.length,
      repeatedCaptureTopologyStable: capturePair.repeatedTopologyStable,
    },
    mappingLimitations: {
      sourceEdgeRelationsNotExposedByJsfl: true,
      unmatchedGeometryRelation: 'UNOBSERVABLE unless exact geometry or a specific raw slash current-point/payload pair is present',
      animateShapeMatrix: capturePair.animateShapeMatrix,
      rawShapeMatrix: capturePair.rawShapeMatrix,
      matrixComposition: 'UNOBSERVABLE; nested matrices are preserved but not multiplied',
    rawExplicitToPandaMapping: endpointLedger.fillStyle1Contributions
      .filter(contribution => contribution.pandaDecodedSegment.originKind === 'raw-edge-subsegment')
      .map(contribution => ({
        sourceEdgeOrdinal: contribution.sourceEdgeOrdinal,
        sourceCommandIndex: contribution.sourceCommandIndex,
        sourceSubsegmentOrdinal: contribution.rawCommand.sourceSubsegmentOrdinal,
        pandaBoundarySegmentId: contribution.pandaBoundarySegmentId,
        sourceGeometryMatchesProductionDecodeExactly: true,
      })),
    rawExplicitSourceSegmentCount: endpointLedger.incidenceFingerprints.rawXflExplicitSegments.segmentCount,
    rawExplicitUnmappedCount: endpointLedger.incidenceFingerprints.rawXflExplicitSegments.segmentCount -
      endpointLedger.fillStyle1Contributions.filter(contribution => contribution.pandaDecodedSegment.originKind === 'raw-edge-subsegment').length,
    },
  };
}

function buildUnmatchedSegments(topologies, ledgers) {
  return {
    schemaVersion: 'issue744-unmatched-segments/1',
    matchingRules: {
      endpointEquality: 'exact numeric equality; no epsilon or snapping',
      lines: 'unordered endpoint pair, directed relationship recorded separately',
      quadratics: 'unordered endpoint pair plus exact control point',
      partialEndpointOverlap: 'recorded as an anchor only; never treated as a match or subdivision proof',
    },
    fixtures: Object.fromEntries(['D-A', 'D-B'].map(key => {
      const topology = topologies[key];
      const ledger = ledgers[key];
      return [key, {
        pandaBoundarySegmentsWithNoExactHalfEdgeInTargetInteriorContour: ledger.fillStyle1Contributions
          .filter(contribution => !topology.sourceToAnimateExactMap.some(row => row.isTargetContour &&
            row.pandaExactMatches.some(match => match.boundarySegmentId === contribution.pandaBoundarySegmentId)))
          .map(contribution => ({
            pandaBoundarySegmentId: contribution.pandaBoundarySegmentId,
            sourceEdgeOrdinal: contribution.sourceEdgeOrdinal,
            sourceCommandIndex: contribution.sourceCommandIndex,
            sourceSubsegmentOrdinal: contribution.rawCommand.sourceSubsegmentOrdinal,
            originKind: contribution.pandaDecodedSegment.originKind,
            geometryType: contribution.pandaOrientedFillContribution.geometryType,
            from: contribution.pandaOrientedFillContribution.from,
            to: contribution.pandaOrientedFillContribution.to,
            command: contribution.pandaOrientedFillContribution.command,
          })),
        animateTargetHalfEdgesWithNoExactPandaOrRawCommandMatch: topology.sourceToAnimateExactMap
          .filter(row => row.isTargetContour && row.pandaExactMatches.length === 0 && row.rawXflExactMatches.length === 0 && row.rawSlashPayloadPairMatches.length === 0)
          .map(row => ({
            contourIndex: row.contourIndex,
            walkIndex: row.walkIndex,
            geometryType: row.geometryType,
            from: row.from,
            to: row.to,
            controlPoints0To2: row.edgeGeometry.controlPoints0To2,
            sourceEdgeRelation: row.sourceEdgeRelation,
            endpointOnlyAnchors: row.rawXflEndpointOnlyAnchors,
          })),
        animateTargetHalfEdgesMatchedOnlyToRawSlashPayload: topology.sourceToAnimateExactMap
          .filter(row => row.isTargetContour && row.rawSlashPayloadPairMatches.length > 0)
          .map(row => ({ walkIndex: row.walkIndex, from: row.from, to: row.to, rawSlashPayloadPairMatches: row.rawSlashPayloadPairMatches })),
        unmappedRawSlashCommands: ledger.rawCommandsWithoutPandaFillContribution,
        endpointEvidence: ledger.endpointTrace,
      }];
    })),
  };
}

function captureTarget(receiptPath, expectedSha) {
  const receipt = readJson(receiptPath);
  const target = receipt.targets.find(candidate => candidate.shapeId === SHAPE_ID);
  assert.ok(target, `target ${SHAPE_ID} missing from ${receiptPath}`);
  validateAnimateCapture(receipt, target, expectedSha);
  const shape = target.targetLibraryTimelineCapture.shapes.find(candidate => candidate.memberPath === target.animateDomMemberPath)?.shape;
  assert.ok(shape);
  return { receiptPath, receipt, target, shape };
}

function buildCapturePair(caseKey, config, acceptanceRoot, pandaReport, pandaResult) {
  const receiptRoot = path.join(acceptanceRoot, 'minimization-run01', 'receipts');
  const captureRecords = config.animateRuns.map(name => captureTarget(path.join(receiptRoot, name), config.sha256));
  const [first, second] = captureRecords;
  const firstTopologyHash = sha256(Buffer.from(JSON.stringify(normalizedShapeForRepeat(first.shape)), 'utf8'));
  const secondTopologyHash = sha256(Buffer.from(JSON.stringify(normalizedShapeForRepeat(second.shape)), 'utf8'));
  assert.equal(firstTopologyHash, secondTopologyHash, `${caseKey} repeated Animate topology differs`);
  const primary = second;
  const { shapeMatrix: rawShapeMatrix, fillSignature } = parsePandaMatrixAndFill(pandaResult);
  const targetContour = primary.shape.contours[config.targetContourIndex];
  assert.ok(targetContour);
  const animateFillMatrix = targetContour.fill.matrix;
  assert.deepEqual(targetContour.fill.colorArray, TARGET_FILL_COLORS);
  const files = captureRecords.map(({ receiptPath, receipt, target, shape }) => describeCapture(receiptPath, receipt, target, shape));
  assert.ok(files.every(record => record.screenshotSha256), `${caseKey} missing a controlled stage screenshot`);
  assert.equal(files[0].screenshotSha256, files[1].screenshotSha256, `${caseKey} repeated stage screenshot hash differs`);
  const inventory = primary.target.targetLibraryTimelineCapture.elementInventory.map(entry => ({
    memberPath: entry.memberPath,
    elementType: entry.elementType,
    matrix: entry.matrix,
    edgeCount: entry.edgeCount,
  }));
  return {
    primaryTarget: primary.target,
    primaryShape: primary.shape,
    rawShapeMatrix,
    animateShapeMatrix: primary.shape.matrix,
    fillSignature,
    animateFillMatrix,
    elementInventory: inventory,
    repeatedTopologyStable: true,
    pandaBaseline: pandaReport.baseline.gitHead,
    captureSummary: {
      captureCount: files.length,
      stableNormalizedTopologySha256: firstTopologyHash,
      stableStagePngSha256: files[0].screenshotSha256,
      captures: files,
      targetContourHalfEdgeCounts: primary.shape.contours.map((contour, index) => ({
        contourIndex: index,
        fillStyle: contour.fill.style,
        colors: contour.fill.colorArray,
        interior: contour.interior,
        orientation: contour.orientation,
        halfEdgeCount: contour.halfEdges.length,
      })),
    },
  };
}

async function buildCase(caseKey, config, acceptanceRoot, pandaRoot) {
  const fixturePath = path.join(acceptanceRoot, 'minimization-run01', 'fixtures', config.fileName);
  const fixtureBytes = fs.readFileSync(fixturePath);
  const archiveSha = { bytes: fixtureBytes.length, sha256: sha256(fixtureBytes) };
  assert.equal(archiveSha.sha256, config.sha256, `${caseKey} frozen archive SHA-256 mismatch`);
  const pandaPath = path.join(pandaRoot, config.pandaFileName);
  const pandaReport = readJson(pandaPath);
  const expectedSubsegments = caseKey === 'D-A' ? 22 : 23;
  const pandaResult = validatePanda(pandaReport, config.sha256, 9, expectedSubsegments);
  if (config.pandaSourceAlias) assert.equal(pandaResult.source.fileName, config.pandaSourceAlias);
  else assert.equal(pandaResult.source.fileName, config.fileName);
  const member = await locateRawMember(fixtureBytes, pandaResult.rawXfl.edgeRecords);
  const capturePair = buildCapturePair(caseKey, { ...config, fixturePath }, acceptanceRoot, pandaReport, pandaResult);
  const endpointLedger = buildEndpointLedger(caseKey, { ...config, fixturePath }, pandaResult, member, archiveSha, capturePair);
  endpointLedger.pandaRunReceipt = {
    path: pandaPath,
    sha256: sha256(fs.readFileSync(pandaPath)),
    exactFixtureAlias: config.pandaSourceAlias
      ? `Fresh Panda receipt used the byte-identical #743 M2 archive; D-A archive SHA and byte length are independently verified equal.`
      : 'Fresh Panda receipt uses the exact frozen D-B archive.',
  };
  endpointLedger.animateCapture = capturePair.captureSummary;
  endpointLedger.coordinateAndTransformProvenance.rawShapeMatrix = capturePair.rawShapeMatrix;
  endpointLedger.coordinateAndTransformProvenance.animateShapeMatrix = capturePair.animateShapeMatrix;
  endpointLedger.coordinateAndTransformProvenance.jsflElementInventory = capturePair.elementInventory;
  endpointLedger.coordinateAndTransformProvenance.targetFillMatrixAnimateJsfl = capturePair.animateFillMatrix;
  endpointLedger.coordinateAndTransformProvenance.targetFillMatrixExactMatch =
    JSON.stringify(capturePair.fillSignature.matrix) === JSON.stringify(capturePair.animateFillMatrix);
  const topology = buildTopology(caseKey, { ...config, fixturePath }, capturePair, pandaResult, member, endpointLedger);
  return { endpointLedger, topology, capturePair, pandaReport, pandaResult, fixturePath, fixtureBytes, archiveSha, member };
}

function buildControls(acceptanceRoot, pandaRoot) {
  const receiptRoot = path.join(acceptanceRoot, 'receipts');
  const runPaths = ['issue743-animate-census-run01.json', 'issue743-animate-census-run02.json']
    .map(name => path.join(receiptRoot, name));
  const runs = runPaths.map(filePath => ({ path: filePath, sha256: sha256(fs.readFileSync(filePath)), receipt: readJson(filePath) }));
  const controls = ['issue737-historical-oracle', 'issue737-closed-fill-control'].map(key => {
    const targetPairs = runs.map(run => {
      const target = run.receipt.targets.find(candidate => candidate.key === key);
      assert.ok(target, `missing control ${key}`);
      assert.equal(target.status, 'CAPTURED');
      assert.equal(target.saveApiCalled, false);
      assert.equal(target.shapeId, key === 'issue737-historical-oracle' ? 'fla-shape-f715af380bb888b2571345e2' : 'fla-shape-289bd154caee9595b4c5ddef');
      assert.equal(target.expectedSourceSha256, 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA');
      const shape = target.targetLibraryTimelineCapture.shapes.find(candidate => candidate.memberPath === target.animateDomMemberPath)?.shape;
      assert.ok(shape, `missing captured Shape for control ${key}`);
      const sourceCopyPath = target.sourceCopyPath;
      const sourceCopySha256 = sourceCopyPath && fs.existsSync(sourceCopyPath) ? sha256(fs.readFileSync(sourceCopyPath)) : null;
      const imagePath = target.stageScreenshotPath;
      return {
        receiptPath: run.path,
        receiptSha256: run.sha256,
        status: target.status,
        sourceSha256: target.expectedSourceSha256,
        shapeId: target.shapeId,
        fillStyleIndex: target.fillStyleIndex,
        sourceAddress: target.sourceAddress,
        xflMemberPath: target.xflMemberPath,
        animateDomMemberPath: target.animateDomMemberPath,
        candidateShapeCount: target.candidateShapeCount,
        saveApiCalled: target.saveApiCalled,
        sourceCopyPath,
        sourceCopySha256,
        normalizedTopologySha256: sha256(Buffer.from(JSON.stringify(normalizedShapeForRepeat(shape)), 'utf8')),
        contourCount: shape.contours.length,
        closedContourCount: shape.contours.filter(contour => contour.closedAtStart === true).length,
        contourHalfEdgeCounts: shape.contours.map(contour => contour.halfEdges.length),
        documentCountBefore: run.receipt.invocation.existingDocumentCountBefore,
        documentCountAfter: run.receipt.invocation.existingDocumentCountAfter,
        documentCountUnchanged: run.receipt.invocation.documentCountUnchanged,
        activeDocumentRestored: run.receipt.invocation.activeDocumentRestored,
        activeDocumentModifiedStateUnchanged: run.receipt.invocation.activeDocumentModifiedStateUnchanged,
        screenshotPath: imagePath,
        screenshotSha256: imagePath && fs.existsSync(imagePath) ? sha256(fs.readFileSync(imagePath)) : null,
      };
    });
    assert.ok(targetPairs.every(pair => pair.screenshotSha256));
    assert.equal(targetPairs[0].screenshotSha256, targetPairs[1].screenshotSha256);
    assert.equal(targetPairs[0].normalizedTopologySha256, targetPairs[1].normalizedTopologySha256);
    return {
      key,
      captures: targetPairs,
      repeatedTopologyStable: true,
      stableNormalizedTopologySha256: targetPairs[0].normalizedTopologySha256,
      stableStagePngSha256: targetPairs[0].screenshotSha256,
    };
  });

  const pandaControlFiles = {
    'issue737-historical-oracle': 'panda-issue737-historical-control.json',
    'issue737-closed-fill-control': 'panda-issue737-closed-fill-control.json',
  };
  const pandaControlReceipts = controls.map(control => {
    const reportPath = path.join(pandaRoot, pandaControlFiles[control.key]);
    const report = readJson(reportPath);
    assert.equal(report.baseline.gitHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim());
    assert.equal(report.allSourceHashesUnchanged, true);
    assert.equal(report.allPandaRunsDeterministic, true);
    assert.equal(report.results.length, 1);
    const result = report.results[0];
    assert.equal(result.fixtureKey, control.key);
    assert.equal(result.source.sourceSha256Before, 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA');
    assert.equal(result.source.sourceSha256After, result.source.sourceSha256Before);
    assert.equal(result.pandaCurrentInterpretation.renderAttempt.status, 'RENDERED');
    assert.equal(result.pandaCurrentInterpretation.determinism.stable, true);
    return {
      key: control.key,
      receiptPath: reportPath,
      receiptSha256: sha256(fs.readFileSync(reportPath)),
      baselineGitHead: report.baseline.gitHead,
      sourcePath: result.source.path,
      sourceSha256: result.source.sourceSha256Before,
      shapeId: result.selected.shapeId,
      fillStyleIndex: result.selected.fillStyleIndex,
      recovery: result.source.recovery,
      status: result.pandaCurrentInterpretation.renderAttempt.status,
      svgSha256: result.pandaCurrentInterpretation.renderAttempt.svgSha256,
      boundarySegmentCount: result.pandaCurrentInterpretation.fillBoundaryByStyle[String(FILL_STYLE)]?.boundarySegmentCount ?? null,
      repeatCount: result.pandaCurrentInterpretation.determinism.repeatCount,
      runHashes: result.pandaCurrentInterpretation.determinism.runHashes,
      stable: result.pandaCurrentInterpretation.determinism.stable,
    };
  });
  const hostBeforePath = path.join(acceptanceRoot, 'animate-host-before.json');
  const hostAfterPath = path.join(acceptanceRoot, 'animate-host-after.json');
  const hostBefore = readJson(hostBeforePath);
  const hostAfter = readJson(hostAfterPath);
  assert.equal(hostBefore.sha256, hostAfter.sha256);
  assert.equal(hostBefore.authenticodeStatus, 'HashMismatch');
  const currentHostSha256 = sha256(fs.readFileSync(hostBefore.executablePath));
  assert.equal(currentHostSha256, hostBefore.sha256);
  return {
    animateHost: {
      executablePath: hostBefore.executablePath,
      fileVersion: hostBefore.fileVersion,
      sha256: hostBefore.sha256,
      currentFileSha256: currentHostSha256,
      authenticodeStatus: hostBefore.authenticodeStatus,
      provenance: hostBefore.provenance,
      stableDuringPriorExperiment: hostAfter.stableDuringExperiment,
      beforeReceiptSha256: sha256(fs.readFileSync(hostBeforePath)),
      afterReceiptSha256: sha256(fs.readFileSync(hostAfterPath)),
    },
    controls,
    pandaControlReceipts,
    repeatedControlsStable: controls.every(control => control.repeatedTopologyStable && control.stableStagePngSha256) &&
      pandaControlReceipts.every(control => control.stable),
    lifecycleNote: 'Issue #743 Animate census run01 left four additional source-copy documents open (documentCountUnchanged=false); it did not call save and target geometry was captured. Run02 restored the original document count. Both control runs have exact matching normalized Shape topology and unchanged source hashes; the run01 document-count variance is retained here rather than hidden.',
  };
}

function sourceCodeEvidence() {
  const sourcePath = path.join(ROOT, 'src', 'main', 'services', 'fla-static-snapshot-svg-builder.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const slash = source.indexOf("      case '/': {");
  assert.ok(slash >= 0, 'current production slash decoder case not found');
  const prefix = source.slice(0, slash);
  const line = prefix.split(/\r?\n/u).length;
  const excerpt = source.slice(slash, source.indexOf("      default: i++;", slash));
  return {
    file: path.relative(ROOT, sourcePath).replaceAll(path.sep, '/'),
    sha256: sha256(fs.readFileSync(sourcePath)),
    slashCaseLine: line,
    exactDecoderExcerpt: excerpt.trimEnd(),
    behavior: 'The Main decoder maps / to Z, advances over only /, then resumes token processing; following numeric payload tokens are skipped by default handling.',
  };
}

function prepareOutputDirectory(outDir, overwrite) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    return;
  }
  const existing = fs.readdirSync(outDir);
  assert.ok(existing.every(name => OUTPUT_FILES.includes(name) || name === 'README.md'), 'output directory contains files outside the Issue #744 evidence allowlist');
  if (!overwrite) assert.equal(existing.length, 0, `output directory is not empty; pass --overwrite to replace only the listed generated files: ${outDir}`);
}

function writeOutput(outDir, name, value) {
  assert.ok(OUTPUT_FILES.includes(name));
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: fs.existsSync(path.join(outDir, name)) ? 'w' : 'wx' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue744-build-ledgers.cjs [--acceptance-root <#743 frozen receipt root>] [--panda-root <fresh Panda receipts>] [--out-dir <docs/evidence/issue-744>] [--overwrite]\n');
    return;
  }

  const acceptanceRoot = path.resolve(args.acceptanceRoot);
  const pandaRoot = path.resolve(args.pandaRoot);
  const outDir = path.resolve(args.outDir);
  const fixturesDir = path.join(acceptanceRoot, 'minimization-run01', 'fixtures');
  const [da, db] = await Promise.all([
    buildCase('D-A', { ...EXPECTED['D-A'], fixturePath: path.join(fixturesDir, EXPECTED['D-A'].fileName) }, acceptanceRoot, pandaRoot),
    buildCase('D-B', { ...EXPECTED['D-B'], fixturePath: path.join(fixturesDir, EXPECTED['D-B'].fileName) }, acceptanceRoot, pandaRoot),
  ]);

  // M2 and D-A are byte-identical. Hash both external files; no source FLA is copied into the repository.
  const m2Path = path.join(fixturesDir, EXPECTED['D-A'].pandaSourceAlias);
  const m2Bytes = fs.readFileSync(m2Path);
  assert.equal(sha256(m2Bytes), da.archiveSha.sha256);
  assert.equal(m2Bytes.length, da.fixtureBytes.length);
  assert.deepEqual(m2Bytes, da.fixtureBytes);
  assert.equal(sha256(fs.readFileSync(da.fixturePath)), da.archiveSha.sha256, 'D-A source archive changed during read-only inspection');
  assert.equal(sha256(fs.readFileSync(db.fixturePath)), db.archiveSha.sha256, 'D-B source archive changed during read-only inspection');

  const controls = buildControls(acceptanceRoot, pandaRoot);
  const unmatched = buildUnmatchedSegments({ 'D-A': da.topology, 'D-B': db.topology }, { 'D-A': da.endpointLedger, 'D-B': db.endpointLedger });
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const codeEvidence = sourceCodeEvidence();
  const receipt = {
    schemaVersion: 'issue744-receipt/1',
    issue: 744,
    baseline: { repository: 'panda-stage', branch: currentBranch, gitHead: currentHead },
    authorization: { productionBehaviorChanges: false, newPullRequest: false, parentPullRequest: 677, expectedParentState: 'OPEN / DRAFT' },
    inputs: {
      D_A: { path: da.fixturePath, bytes: da.archiveSha.bytes, sha256: da.archiveSha.sha256, equalsM2ByteForByte: true },
      D_B: { path: db.fixturePath, bytes: db.archiveSha.bytes, sha256: db.archiveSha.sha256, equalsM2ByteForByte: false },
      sameTarget: { shapeId: SHAPE_ID, xflMember: da.member.name, targetFillStyle: FILL_STYLE, exactTargetShapeAddress: da.capturePair.primaryTarget.sourceAddress },
    },
    currentProductionDecoder: codeEvidence,
    animateControls: controls,
    fixtures: {
      'D-A': {
        path: da.fixturePath,
        xflMemberPath: da.member.name,
        sourceSha256: da.archiveSha.sha256,
        xflMemberSha256: sha256(da.member.bytes),
        freshPandaReceiptSha256: da.endpointLedger.pandaRunReceipt.sha256,
        pandaRunHashes: da.pandaResult.pandaCurrentInterpretation.determinism.runHashes,
        animateCaptureCount: da.capturePair.captureSummary.captureCount,
        animateTopologyFingerprint: da.topology.incidenceAndTopologyFingerprints.animateOrderedContourTopology.sha256,
        animateScreenshotHashes: da.capturePair.captureSummary.captures.map(capture => capture.screenshotSha256),
      },
      'D-B': {
        path: db.fixturePath,
        xflMemberPath: db.member.name,
        sourceSha256: db.archiveSha.sha256,
        xflMemberSha256: sha256(db.member.bytes),
        freshPandaReceiptSha256: db.endpointLedger.pandaRunReceipt.sha256,
        pandaRunHashes: db.pandaResult.pandaCurrentInterpretation.determinism.runHashes,
        animateCaptureCount: db.capturePair.captureSummary.captureCount,
        animateTopologyFingerprint: db.topology.incidenceAndTopologyFingerprints.animateOrderedContourTopology.sha256,
        animateScreenshotHashes: db.capturePair.captureSummary.captures.map(capture => capture.screenshotSha256),
      },
    },
    classification: {
      taxonomy: 'H — MIXED / INSUFFICIENT',
      reason: 'D-A has an exact local command-decode discrepancy with two matching Animate slash-payload HalfEdges, while D-B changes target contour membership and has four target-gradient HalfEdges without exact raw/Panda geometry correspondence. One shared first divergence is not established.',
      implementationAuthorization: 'NO — research/prototype only',
      proposedSingleNextAction: 'Open one bounded research follow-up to map D-B target-gradient contour HalfEdges 3–6 to exact source Shape edges and establish whether the new contour is a split/reassembled region or a distinct fill-side ownership result.',
    },
  };

  prepareOutputDirectory(outDir, args.overwrite);
  writeOutput(outDir, 'endpoint-ledger-D-A.json', da.endpointLedger);
  writeOutput(outDir, 'endpoint-ledger-D-B.json', db.endpointLedger);
  writeOutput(outDir, 'topology-D-A.json', da.topology);
  writeOutput(outDir, 'topology-D-B.json', db.topology);
  writeOutput(outDir, 'unmatched-segments.json', unmatched);
  writeOutput(outDir, 'receipt.json', receipt);

  process.stdout.write(`Issue #744 ledgers written: ${outDir}\n`);
  process.stdout.write(`D-A: edges=9 raw=22 Panda boundary=23 Animate target contour=${da.capturePair.primaryShape.contours[EXPECTED['D-A'].targetContourIndex].halfEdges.length}, exact target HE matches=${da.topology.animateTargetContourAccounting.pandaExactHalfEdgeMatchCount}, slash payload HEs=${da.topology.animateTargetContourAccounting.slashPayloadPairHalfEdgeCount}\n`);
  process.stdout.write(`D-B: edges=9 raw=23 Panda boundary=23 Animate target contour=${db.capturePair.primaryShape.contours[EXPECTED['D-B'].targetContourIndex].halfEdges.length}, exact target HE matches=${db.topology.animateTargetContourAccounting.pandaExactHalfEdgeMatchCount}, exact unmatched HEs=${db.topology.animateTargetContourAccounting.exactUnmatchedHalfEdgeCount}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
