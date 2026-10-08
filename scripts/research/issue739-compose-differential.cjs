#!/usr/bin/env node
'use strict';

// Join the frozen Raw XFL/Panda receipts with Adobe Animate's read-only
// Contour/HalfEdge captures. Endpoint matching is exact; this script never
// snaps coordinates, edits a source FLA, or changes production code.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ACCEPTANCE = 'D:/PandaStage-Acceptance/issue739-open-fill-differential-20261008';
const DEFAULTS = Object.freeze({
  pandaRun1: path.join(ACCEPTANCE, 'panda-run-1-v2.json'),
  pandaRun2: path.join(ACCEPTANCE, 'panda-run-2-v2.json'),
  animateRun1: path.join(ACCEPTANCE, 'issue739-animate-oracle-run01-6.json'),
  animateRun2: path.join(ACCEPTANCE, 'issue739-animate-oracle-run01-7.json'),
  out: path.join(ROOT, 'docs/evidence/issue-739/issue739-open-fill-corpus-differential.json'),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/u, '');
    if (key === 'help' || key === 'h') args.help = true;
    else if (key === 'overwrite') args.overwrite = true;
    else if (Object.hasOwn(args, key)) args[key] = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseTargetFill(fillStyleXml) {
  const solidColor = fillStyleXml.match(/<SolidColor\b[^>]*\bcolor="([^"]+)"/u);
  if (solidColor) {
    return { kind: 'solid', color: solidColor[1] };
  }

  const gradientEntries = [...fillStyleXml.matchAll(/<GradientEntry\b([^>]*)\/?\s*>/gu)]
    .map((match) => {
      const color = match[1].match(/\bcolor="([^"]+)"/u)?.[1];
      const ratio = match[1].match(/\bratio="([^"]+)"/u)?.[1];
      assert.ok(color && ratio !== undefined, 'GradientEntry must include color and ratio');
      return { color, ratio: Number(ratio), position255: Math.round(Number(ratio) * 255) };
    });
  assert.ok(gradientEntries.length > 0, 'selected FillStyle has no supported solid color or gradient stops');
  const spreadMethod = fillStyleXml.match(/<(?:Linear|Radial)Gradient\b[^>]*\bspreadMethod="([^"]+)"/u)?.[1] ?? null;
  return {
    kind: 'linearGradient',
    colors: gradientEntries.map((entry) => entry.color),
    positions255: gradientEntries.map((entry) => entry.position255),
    ratios: gradientEntries.map((entry) => entry.ratio),
    spreadMethod,
  };
}

function contourMatchesTargetFill(contour, signature) {
  const fill = contour.fill || {};
  if (signature.kind === 'solid') {
    return fill.style === 'solid' && fill.color === signature.color;
  }
  return fill.style === 'linearGradient'
    && JSON.stringify(fill.colorArray || []) === JSON.stringify(signature.colors)
    && JSON.stringify(fill.posArray || []) === JSON.stringify(signature.positions255)
    && (signature.spreadMethod === null || String(fill.overflow || '').toLowerCase() === signature.spreadMethod.toLowerCase());
}

function samePoint(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function pointPairDirection(from, to, candidateFrom, candidateTo) {
  if (samePoint(from, candidateFrom) && samePoint(to, candidateTo)) return 'same';
  if (samePoint(from, candidateTo) && samePoint(to, candidateFrom)) return 'reverse';
  return null;
}

function stableEdgeKey(halfEdge) {
  if (halfEdge.edgeId !== null && halfEdge.edgeId !== undefined) return `edge:${halfEdge.edgeId}`;
  const points = [halfEdge.from, halfEdge.to]
    .map((point) => `${Object.is(point.x, -0) ? '0' : point.x},${Object.is(point.y, -0) ? '0' : point.y}`)
    .sort();
  return `endpoints:${points.join('|')}`;
}

function sourceMapEntriesForBoundary(panda, boundarySegment) {
  return panda.rawToPandaSegmentMap.filter((entry) => (
    entry.fillStyleIndex === boundarySegment.fillStyleIndex
    && entry.sourceEdgeIndex === boundarySegment.sourceEdgeIndex
    && entry.sourceSubsegmentOrdinal === boundarySegment.sourceSubsegmentOrdinal
    && entry.originKind === boundarySegment.originKind
    && entry.pandaCommandIndex === boundarySegment.pandaCommandIndex
  ));
}

function candidateGeometry(halfEdge, contourIndex, contour) {
  const edgeGeometry = halfEdge.edgeGeometry || null;
  return {
    contourIndex,
    interior: contour.interior,
    contourOrientation: contour.orientation,
    contourClosedAtStart: contour.closedAtStart,
    halfEdgeId: halfEdge.id,
    oppositeHalfEdgeId: halfEdge.oppositeId,
    edgeId: halfEdge.edgeId,
    edgeIsLine: halfEdge.edgeIsLine,
    cubicSegmentIndex: halfEdge.cubicSegmentIndex,
    from: halfEdge.from,
    to: halfEdge.to,
    controlPoints0To2: edgeGeometry?.controlPoints0To2 ?? null,
    stroke: edgeGeometry?.stroke ?? null,
  };
}

function compareCommandGeometry(command, match) {
  if (!command || !match) return 'NOT_COMPARABLE';
  if (command.type === 'L') {
    return match.edgeIsLine === 1 ? 'LINE_TYPE_AND_ENDPOINTS_MATCH' : 'ENDPOINTS_MATCH_LINE_TYPE_DIFFERS';
  }
  if (command.type === 'Q') {
    const control = { x: command.cx, y: command.cy };
    const points = match.controlPoints0To2 || [];
    return points.some((point) => samePoint(point, control))
      ? 'EXACT_QUADRATIC_CONTROL_POINT'
      : 'ENDPOINTS_MATCH_CONTROL_POINT_NOT_VERIFIED';
  }
  if (command.type === 'C') return 'CUBIC_CONTROL_SCHEMA_NOT_COMPARED';
  return 'UNSUPPORTED_COMMAND_TYPE';
}

function edgeRepresentative(group) {
  return group.halfEdges[0];
}

function analyzeTarget(pandaResult, pandaRepeat, animateResult, animateRepeat) {
  const targetKey = pandaResult.fixtureKey;
  assert.equal(pandaRepeat.fixtureKey, targetKey, `${targetKey}: Panda repeat target order/key differs`);
  assert.equal(animateResult.key, targetKey, `${targetKey}: Animate target key differs`);
  assert.equal(animateRepeat.key, targetKey, `${targetKey}: Animate repeat target key differs`);
  assert.equal(animateResult.status, 'CAPTURED', `${targetKey}: Animate first receipt is not CAPTURED`);
  assert.equal(animateRepeat.status, 'CAPTURED', `${targetKey}: Animate repeat receipt is not CAPTURED`);

  const panda = pandaResult.pandaCurrentInterpretation;
  const pandaSecond = pandaRepeat.pandaCurrentInterpretation;
  assert.equal(pandaResult.differentialSha256, pandaRepeat.differentialSha256, `${targetKey}: Panda receipts differ`);
  assert.equal(panda.determinism.stable, true, `${targetKey}: Panda first receipt is not deterministic`);
  assert.equal(pandaSecond.determinism.stable, true, `${targetKey}: Panda repeat receipt is not deterministic`);

  const firstCapture = animateResult.targetLibraryTimelineCapture;
  const secondCapture = animateRepeat.targetLibraryTimelineCapture;
  const firstEntry = firstCapture.shapes.find((entry) => entry.memberPath === animateResult.animateDomMemberPath);
  const secondEntry = secondCapture.shapes.find((entry) => entry.memberPath === animateRepeat.animateDomMemberPath);
  assert.ok(firstEntry && secondEntry, `${targetKey}: exact Animate DOM Shape member path was not captured`);
  const shape = firstEntry.shape;
  const repeatedShape = secondEntry.shape;
  const animateShapeSha256 = sha256(Buffer.from(JSON.stringify(shape), 'utf8'));
  const animateRepeatShapeSha256 = sha256(Buffer.from(JSON.stringify(repeatedShape), 'utf8'));
  assert.equal(animateShapeSha256, animateRepeatShapeSha256, `${targetKey}: Animate Shape hash changed between captures`);
  assert.equal(animateResult.saveApiCalled, false, `${targetKey}: Animate save API was called`);
  assert.equal(animateRepeat.saveApiCalled, false, `${targetKey}: Animate repeat save API was called`);
  assert.ok(animateResult.documentModifiedAfterCapture === false || animateResult.documentModifiedAfterCapture === null, `${targetKey}: Animate document modification state is unexpected`);
  assert.ok(animateRepeat.documentModifiedAfterCapture === false || animateRepeat.documentModifiedAfterCapture === null, `${targetKey}: Animate repeat document modification state is unexpected`);
  assert.equal(animateResult.fileModificationDateBefore, animateResult.fileModificationDateAfter, `${targetKey}: source copy mtime changed during capture`);
  assert.equal(animateRepeat.fileModificationDateBefore, animateRepeat.fileModificationDateAfter, `${targetKey}: repeat source copy mtime changed during capture`);

  const fillSignature = parseTargetFill(pandaResult.selected.fillStyleXml);
  const matchingContours = shape.contours
    .map((contour, contourIndex) => ({ contour, contourIndex }))
    .filter(({ contour }) => contourMatchesTargetFill(contour, fillSignature));
  assert.ok(matchingContours.length > 0, `${targetKey}: Animate did not expose contours with the selected FillStyle signature`);
  const boundary = panda.fillBoundaryByStyle[String(pandaResult.selected.fillStyleIndex)];
  assert.ok(boundary, `${targetKey}: Panda target fill boundary is missing`);

  const targetFillHalfEdges = matchingContours.flatMap(({ contour, contourIndex }) => contour.halfEdges.map((halfEdge) => ({
    contour,
    contourIndex,
    halfEdge,
  })));
  const segmentCrosswalk = boundary.boundarySegmentMapping.map((segment, pandaBoundaryIndex) => {
    const candidates = [];
    for (const { contour, contourIndex, halfEdge } of targetFillHalfEdges) {
      const direction = pointPairDirection(segment.from, segment.to, halfEdge.from, halfEdge.to);
      if (!direction) continue;
      const geometry = candidateGeometry(halfEdge, contourIndex, contour);
      candidates.push({
        ...geometry,
        direction,
        commandGeometryComparison: compareCommandGeometry(segment.command, geometry),
      });
    }
    const rawToPandaEntries = sourceMapEntriesForBoundary(panda, segment);
    return {
      pandaBoundaryIndex,
      sourceEdgeIndex: segment.sourceEdgeIndex,
      sourceSubsegmentOrdinal: segment.sourceSubsegmentOrdinal,
      rawEdgeRecordIndex: segment.sourceEdgeIndex,
      pandaCommandIndex: segment.pandaCommandIndex,
      fillStyleIndex: segment.fillStyleIndex,
      sourceFillSide: segment.sourceFillSide,
      reversed: segment.reversed,
      originKind: segment.originKind,
      sourceAuthoredCloseMarkerOrdinal: segment.sourceAuthoredCloseMarkerOrdinal,
      from: segment.from,
      to: segment.to,
      command: segment.command,
      rawToPandaSegmentMapEntryCount: rawToPandaEntries.length,
      rawToPandaSegmentMapEntries: rawToPandaEntries,
      endpointMatchRule: 'exact numeric endpoint equality; same or reverse direction; no tolerance/snapping',
      animateCandidates: candidates,
      exactEndpointCandidateCount: candidates.length,
      exactInteriorCandidateCount: candidates.filter((candidate) => candidate.interior === true).length,
    };
  });

  const interiorHalfEdges = targetFillHalfEdges.filter(({ contour }) => contour.interior === true);
  const uniqueInteriorEdges = new Map();
  for (const { halfEdge } of interiorHalfEdges) {
    const key = stableEdgeKey(halfEdge);
    const group = uniqueInteriorEdges.get(key) || { edgeKey: key, halfEdges: [] };
    group.halfEdges.push(halfEdge);
    uniqueInteriorEdges.set(key, group);
  }
  const mappedInteriorEdgeKeys = new Set(segmentCrosswalk.flatMap((segment) => segment.animateCandidates
    .filter((candidate) => candidate.interior === true)
    .map((candidate) => candidate.edgeId === null || candidate.edgeId === undefined ? null : `edge:${candidate.edgeId}`)
    .filter(Boolean)));
  const unmatchedInteriorEdges = [...uniqueInteriorEdges.values()]
    .filter((group) => !mappedInteriorEdgeKeys.has(group.edgeKey))
    .map((group) => {
      const halfEdge = edgeRepresentative(group);
      const geometry = halfEdge.edgeGeometry || null;
      return {
        edgeKey: group.edgeKey,
        edgeId: halfEdge.edgeId,
        representativeHalfEdgeId: halfEdge.id,
        from: halfEdge.from,
        to: halfEdge.to,
        edgeIsLine: halfEdge.edgeIsLine,
        cubicSegmentIndex: halfEdge.cubicSegmentIndex,
        controlPoints0To2: geometry?.controlPoints0To2 ?? null,
        halfEdgeCountInMatchingInteriorContours: group.halfEdges.length,
      };
    });

  const sourcePath = pandaResult.source.path;
  const expectedSourceSha256 = pandaResult.source.expectedSha256;
  const animateCopyPath = animateResult.sourceCopyPath;
  const sourceSha256AtCompose = sha256File(sourcePath);
  const animateCopySha256 = sha256File(animateCopyPath);
  assert.equal(sourceSha256AtCompose, expectedSourceSha256, `${targetKey}: original FLA hash no longer matches frozen source`);
  assert.equal(animateCopySha256, expectedSourceSha256, `${targetKey}: Animate copy is not byte-identical to the frozen source`);

  const isV0FailingShape = pandaResult.role === 'V0 first-failing Shape';
  const classification = isV0FailingShape ? 'F' : 'H';
  const evidenceConfidence = targetKey === 'xiuxian-male-open-fill'
    ? 'MEDIUM_HIGH_WITH_PROVENANCE_CAVEAT'
    : isV0FailingShape
      ? 'HIGH_WITH_PROVENANCE_CAVEAT'
      : 'HIGH_CONTROL_WITH_PROVENANCE_CAVEAT';
  const firstDivergence = isV0FailingShape
    ? 'Adobe Animate derived Contour/HalfEdge region topology: Raw XFL and Panda draw counts agree and Panda boundary segments map by exact endpoints, while the Panda target-fill graph remains open/blocked and Animate exposes closed target-fill contours plus interior edges absent from the Panda boundary.'
    : targetKey === 'issue737-historical-oracle'
      ? 'No blocking failure divergence: Panda renders and maps every boundary segment into Animate interior contours; Animate also contains extra interior edges, so this historical control does not isolate the open-fill failure class.'
      : 'No failure divergence observed: the closed-fill control renders in Panda and all Panda boundary segments map into Animate interior edges.';

  return {
    fixtureKey: targetKey,
    role: pandaResult.role,
    shapeId: pandaResult.selected.shapeId,
    fillStyleIndex: pandaResult.selected.fillStyleIndex,
    classification,
    classificationLabel: classification === 'F'
      ? 'ANIMATE_DERIVED_REGION_SEMANTIC'
      : 'MIXED_OR_INSUFFICIENT_CONTROL',
    classificationRationale: classification === 'F'
      ? 'Raw XFL and Panda agree materially on decoded subsegment retention and raw endpoints; Adobe Animate supplies a closed derived region whose interior topology cannot be reconstructed from the exact Panda boundary graph. Stop before implementation per Issue #739.'
      : 'This is a non-failing control. H records that the A-G failure causes do not apply to a successful control; the historical control also has additional Animate interior edges without a Panda render failure.',
    evidenceConfidence,
    confidenceLimits: [
      'Animate executable Authenticode status is captured in animateHost below; HashMismatch means this run does not prove an unmodified Adobe-signed binary.',
      'The selected target-fill boundary has a per-segment exact-endpoint map. Non-target-fill draws do not have an Animate crosswalk in this receipt.',
    ],
    recommendedNextAction: isV0FailingShape
      ? 'STOP before implementation. If further work is authorized, verify the Animate executable integrity and trace the Animate-only interior edge provenance for this Shape before proposing any shared repair.'
      : 'Keep as a successful control. Do not treat unmatched extra Animate interior edges alone as proof of a Panda failure.',
    firstDivergence,
    source: {
      originalPath: sourcePath,
      expectedSha256: expectedSourceSha256,
      sha256AtCompose: sourceSha256AtCompose,
      animateCopyPath,
      animateCopySha256,
      animateCopyByteIdentical: animateCopySha256 === expectedSourceSha256,
      sourceSha256Before: pandaResult.source.sourceSha256Before,
      sourceSha256After: pandaResult.source.sourceSha256After,
      originalUnchangedDuringPandaCapture: pandaResult.source.unchanged,
      selectedSourceAddress: pandaResult.selected.sourceAddresses[0]?.sourceAddress ?? null,
      animateDomMemberPath: animateResult.animateDomMemberPath,
      animatePathMappingRule: animateResult.pathMappingRule,
    },
    rawXfl: {
      summary: pandaResult.rawXfl,
      selected: pandaResult.selected,
      segmentMapCoverageNote: 'Full decoded draw-subsegment totals are compared to Raw XFL totals. Per-segment links are retained for Panda source-side and target-fill boundary mappings; non-boundary decoded draws do not have a separate segment crosswalk in the source receipt.',
    },
    panda: {
      renderAttempt: panda.renderAttempt,
      decodedCommandCount: panda.decodedCommandCount,
      decodedDrawSubsegmentCount: panda.decodedDrawSubsegmentCount,
      retainedStyleRunCount: panda.retainedStyleRunCount,
      retainedStyleChangeCount: panda.retainedStyleChangeCount,
      retainedStyleChanges: panda.retainedStyleChanges,
      targetFillStyleRunCount: panda.targetFillStyleRunCount,
      targetFillDrawSubsegmentCount: panda.targetFillDrawSubsegmentCount,
      rawToPandaDrawSubsegmentCountMatch: panda.rawToPandaDrawSubsegmentCountMatch,
      reversedFillStyle0SegmentCount: panda.reversedFillStyle0SegmentCount,
      rawToPandaSegmentMap: panda.rawToPandaSegmentMap,
      determinism: panda.determinism,
      boundary,
    },
    animate: {
      hostVersion: 'WIN 23,0,0,407',
      executablePath: 'D:\\AN2023\\Adobe Animate 2023\\Animate.exe',
      receiptTarget: {
        status: animateResult.status,
        sourceCopyPath: animateResult.sourceCopyPath,
        expectedCopyPathMatches: animateResult.expectedCopyPathMatches,
        saveApiCalled: animateResult.saveApiCalled,
        documentModifiedAfterCapture: animateResult.documentModifiedAfterCapture,
        fileModificationDateBefore: animateResult.fileModificationDateBefore,
        fileModificationDateAfter: animateResult.fileModificationDateAfter,
        animateDomMemberPath: animateResult.animateDomMemberPath,
      },
      shapeSha256: animateShapeSha256,
      repeatedShapeSha256: animateRepeatShapeSha256,
      repeatShapeStable: animateShapeSha256 === animateRepeatShapeSha256,
      targetFillSignature: fillSignature,
      fillSignatureRule: fillSignature.kind === 'solid'
        ? 'Exact Animate solid fill color equals Raw XFL selected SolidColor.'
        : 'Exact gradient stop colors, 0..255 stop positions, and spread method equal the Raw XFL selected gradient. Animate per-contour matrices are preserved as observed data and are not used as the fill selector.',
      targetFillContourIndices: matchingContours.map(({ contourIndex }) => contourIndex),
      targetFillContourCount: matchingContours.length,
      targetFillInteriorContourCount: matchingContours.filter(({ contour }) => contour.interior === true).length,
      targetFillExteriorContourCount: matchingContours.filter(({ contour }) => contour.interior === false).length,
      targetFillAllContoursClosed: matchingContours.every(({ contour }) => contour.closedAtStart === true),
      targetFillHalfEdgeCount: targetFillHalfEdges.length,
      targetFillInteriorHalfEdgeCount: interiorHalfEdges.length,
      targetFillInteriorUniqueEdgeCount: uniqueInteriorEdges.size,
      mappedTargetFillInteriorUniqueEdgeCount: mappedInteriorEdgeKeys.size,
      unmatchedTargetFillInteriorUniqueEdgeCount: unmatchedInteriorEdges.length,
      unmatchedTargetFillInteriorEdges: unmatchedInteriorEdges,
      contours: matchingContours.map(({ contour, contourIndex }) => ({ contourIndex, ...contour })),
      shape,
    },
    crosswalk: {
      endpointMatchPolicy: 'exact IEEE-754 numeric endpoint equality; compare both directions; no epsilon, snapping, connector insertion, or coordinate mutation',
      pandaBoundarySegmentCount: boundary.boundarySegmentCount,
      pandaRawSubsegmentSegmentCount: boundary.rawSubsegmentMappingCount,
      pandaAuthoredCloseSemanticSegmentCount: boundary.authoredCloseBoundaryMappingCount,
      exactEndpointMatchedPandaSegmentCount: segmentCrosswalk.filter((segment) => segment.exactEndpointCandidateCount > 0).length,
      exactEndpointMatchedInteriorPandaSegmentCount: segmentCrosswalk.filter((segment) => segment.exactInteriorCandidateCount > 0).length,
      exactEndpointUnmatchedPandaSegments: segmentCrosswalk.filter((segment) => segment.exactEndpointCandidateCount === 0),
      segmentCrosswalk,
      mappingLimitations: [
        'Exact endpoint pairs do not by themselves prove equivalent curve control geometry. The machine map preserves Panda commands and Animate control points; L/Q observations are annotated, while cubic control schema is not asserted equivalent.',
        'Unmatched Animate interior edges are listed explicitly. The crosswalk does not synthesize connector segments or infer missing Panda edges.',
      ],
    },
    repeatability: {
      pandaFirstRunDifferentialSha256: pandaResult.differentialSha256,
      pandaSecondRunDifferentialSha256: pandaRepeat.differentialSha256,
      pandaStable: pandaResult.differentialSha256 === pandaRepeat.differentialSha256,
      animateFirstRunShapeSha256: animateShapeSha256,
      animateSecondRunShapeSha256: animateRepeatShapeSha256,
      animateStable: animateShapeSha256 === animateRepeatShapeSha256,
      animateRepeatScope: 'Two captures in the same open Animate session; the JSFL receipts do not record a process ID, so this is not an independent-process repeat.',
    },
  };
}

function summarizeReceipt(filePath) {
  return { path: filePath, sha256: sha256File(filePath) };
}

function readAuthenticode(executablePath) {
  const quotedPath = `'${executablePath.replace(/'/gu, "''")}'`;
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath ${quotedPath}`,
    '[pscustomobject]@{ status = [string]$signature.Status; statusMessage = [string]$signature.StatusMessage; signerSubject = [string]$signature.SignerCertificate.Subject; thumbprint = [string]$signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress',
  ].join('; ');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue739-compose-differential.cjs [--pandaRun1 path] [--pandaRun2 path] [--animateRun1 path] [--animateRun2 path] [--out path] [--overwrite]\n');
    return;
  }

  const pandaRun1 = readJson(args.pandaRun1);
  const pandaRun2 = readJson(args.pandaRun2);
  const animateRun1 = readJson(args.animateRun1);
  const animateRun2 = readJson(args.animateRun2);
  assert.equal(pandaRun1.schemaVersion, 'issue739-xfl-panda-corpus-differential/1');
  assert.equal(pandaRun2.schemaVersion, 'issue739-xfl-panda-corpus-differential/1');
  assert.equal(animateRun1.schemaVersion, 'issue739-animate-oracle/1');
  assert.equal(animateRun2.schemaVersion, 'issue739-animate-oracle/1');
  assert.equal(pandaRun1.allSourceHashesUnchanged, true);
  assert.equal(pandaRun2.allSourceHashesUnchanged, true);
  assert.equal(pandaRun1.allPandaRunsDeterministic, true);
  assert.equal(pandaRun2.allPandaRunsDeterministic, true);
  assert.equal(animateRun1.host.animateVersion, animateRun2.host.animateVersion);
  assert.equal(animateRun1.host.executablePath, animateRun2.host.executablePath);
  assert.equal(animateRun1.status, 'CAPTURE_FINISHED_READ_ONLY');
  assert.equal(animateRun2.status, 'CAPTURE_FINISHED_READ_ONLY');
  assert.equal(pandaRun1.results.length, 5);
  assert.equal(pandaRun2.results.length, 5);
  assert.equal(animateRun1.targets.length, 5);
  assert.equal(animateRun2.targets.length, 5);

  const pandaRepeatByKey = new Map(pandaRun2.results.map((result) => [result.fixtureKey, result]));
  const animateByKey = new Map(animateRun1.targets.map((result) => [result.key, result]));
  const animateRepeatByKey = new Map(animateRun2.targets.map((result) => [result.key, result]));
  const executableAuthenticode = readAuthenticode(animateRun1.host.executablePath);
  const executableSha256 = sha256File(animateRun1.host.executablePath);
  const results = pandaRun1.results.map((result) => analyzeTarget(
    result,
    pandaRepeatByKey.get(result.fixtureKey),
    animateByKey.get(result.fixtureKey),
    animateRepeatByKey.get(result.fixtureKey),
  ));
  const report = {
    schemaVersion: 'issue739-three-stage-segment-differential/1',
    issue: 739,
    purpose: 'Research-only Raw XFL → Panda decode/style-owned boundary → Adobe Animate Contour/HalfEdge differential; implementation stop point before production changes.',
    baseline: pandaRun1.baseline,
    policy: {
      sourceMutation: 'forbidden; original source SHA-256 checked again at compose time',
      endpointComparison: 'exact numeric equality only',
      topologyRepair: 'none; no snapping, connector insertion, or inferred edge synthesis',
      productionChanges: 'none',
      controlCount: 'exactly 3 V0 first-failing Shapes + 1 Issue #737 historical control + 1 known-working closed-fill control',
    },
    receipts: {
      pandaRun1: summarizeReceipt(args.pandaRun1),
      pandaRun2: summarizeReceipt(args.pandaRun2),
      animateRun1: summarizeReceipt(args.animateRun1),
      animateRun2: summarizeReceipt(args.animateRun2),
    },
    animateHost: {
      ...animateRun1.host,
      executableSha256,
      authenticode: executableAuthenticode,
      provenanceAssessment: executableAuthenticode.status === 'Valid'
        ? 'The executable signature validated at compose time.'
        : 'Executable provenance is not verified as an unmodified Adobe-signed binary; preserve this caveat when interpreting Animate topology.',
    },
    animateInvocationRepeat: {
      firstActiveDocumentPath: animateRun1.invocation.activeDocumentPathBefore,
      secondActiveDocumentPath: animateRun2.invocation.activeDocumentPathBefore,
      firstSourceDocumentRestored: animateRun1.invocation.activeDocumentRestored,
      secondSourceDocumentRestored: animateRun2.invocation.activeDocumentRestored,
      saveApiCalled: animateRun1.invocation.saveApiCalled || animateRun2.invocation.saveApiCalled,
    },
    allSourceHashesUnchanged: results.every((result) => result.source.originalUnchangedDuringPandaCapture
      && result.source.sha256AtCompose === result.source.expectedSha256
      && result.source.animateCopyByteIdentical),
    allPandaAndAnimateRepeatsStable: results.every((result) => result.repeatability.pandaStable && result.repeatability.animateStable),
    results,
  };

  const outputPath = path.resolve(args.out);
  assert.ok(args.overwrite || !fs.existsSync(outputPath), `refusing to overwrite existing evidence file: ${outputPath} (pass --overwrite only for a reviewed generated receipt)`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const result of results) {
    process.stdout.write(`${result.fixtureKey}: class=${result.classification} Panda=${result.panda.renderAttempt.status} boundary=${result.crosswalk.pandaBoundarySegmentCount} exactMapped=${result.crosswalk.exactEndpointMatchedPandaSegmentCount} AnimateInteriorEdges=${result.animate.targetFillInteriorUniqueEdgeCount} extraInteriorEdges=${result.animate.unmatchedTargetFillInteriorUniqueEdgeCount}\n`);
  }
  process.stdout.write(`Issue #739 composed evidence: ${outputPath}\n`);
}

main();
