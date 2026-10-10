#!/usr/bin/env node
'use strict';

// Verifies the modified-Animate compensating controls required by Issue #742.
// All inputs and the resulting receipt live outside the repository.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ROOT = 'D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03';
const DEFAULT_BASELINE = 'D:\\PandaStage-Acceptance\\issue739-open-fill-differential-20261008\\issue739-animate-oracle-run01-1.json';
const DEFAULT_CONTROL_SOURCE = 'D:\\PandaStage-Acceptance\\issue742-repair-contract-20261009-attempt03\\animate-controls\\inputs\\historical.fla';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    run1: null,
    run2: null,
    baseline: DEFAULT_BASELINE,
    source: DEFAULT_CONTROL_SOURCE,
    panda: null,
    hostBefore: null,
    hostAfter: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') args.root = argv[++index];
    else if (value === '--run1') args.run1 = argv[++index];
    else if (value === '--run2') args.run2 = argv[++index];
    else if (value === '--baseline') args.baseline = argv[++index];
    else if (value === '--source') args.source = argv[++index];
    else if (value === '--panda') args.panda = argv[++index];
    else if (value === '--host-before') args.hostBefore = argv[++index];
    else if (value === '--host-after') args.hostAfter = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--help' || value === '-h') args.help = true;
  }
  return args;
}

function isOutsideRepo(candidate) {
  const relative = path.relative(ROOT, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function readJson(filePath, label) {
  assert.ok(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableAnimateTopology(capture) {
  return {
    timelineName: capture.timelineName,
    frameCount: capture.frameCount,
    layerCount: capture.layerCount,
    shapes: capture.shapes.map(item => ({
      memberPath: item.memberPath,
      scope: item.scope,
      shape: {
        elementType: item.shape.elementType,
        matrix: item.shape.matrix,
        x: item.shape.x,
        y: item.shape.y,
        edgeCount: item.shape.edgeCount,
        vertexCount: item.shape.vertexCount,
        contourCount: item.shape.contourCount,
        edges: item.shape.edges.map(edge => ({
          isLine: edge.isLine,
          from: edge.from,
          to: edge.to,
          controlPoints0To2: edge.controlPoints0To2,
        })),
        vertices: item.shape.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })),
        contours: item.shape.contours.map(contour => ({
          interior: contour.interior,
          orientation: contour.orientation,
          fill: contour.fill,
          closedAtStart: contour.closedAtStart,
          stopReason: contour.stopReason,
          halfEdges: contour.halfEdges.map(edge => ({
            walkIndex: edge.walkIndex,
            edgeIsLine: edge.edgeIsLine,
            from: edge.from,
            to: edge.to,
            edgeGeometry: edge.edgeGeometry ? {
              isLine: edge.edgeGeometry.isLine,
              from: edge.edgeGeometry.from,
              to: edge.edgeGeometry.to,
              controlPoints0To2: edge.edgeGeometry.controlPoints0To2,
            } : null,
          })),
        })),
      },
    })),
  };
}

function targetByKey(receipt, key, { requireNewDocument = true } = {}) {
  const target = (receipt.targets || []).find(entry => entry.key === key);
  assert.ok(target, `Animate control receipt is missing ${key}`);
  assert.equal(target.status, 'CAPTURED', `${key} capture status is ${target.status}`);
  assert.equal(target.saveApiCalled, false, `${key} capture called a save API`);
  assert.equal(target.expectedCopyPathMatches, true, `${key} did not open its frozen copy`);
  if (requireNewDocument) assert.equal(target.isPreExistingDocument, false, `${key} was already open before this capture`);
  assert.equal(target.expectedSourceSha256, 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA', `${key} source SHA differs from frozen #737 input`);
  const sourceTimestampUnchanged = target.fileModificationDateUnchanged === true ||
    target.fileModificationDateBefore === target.fileModificationDateAfter;
  assert.equal(sourceTimestampUnchanged, true, `${key} frozen FLA changed during Animate capture`);
  if (requireNewDocument) {
    assert.notEqual(target.documentModifiedBeforeCapture, true, `${key} document was already modified on open`);
    assert.notEqual(target.documentModifiedAfterCapture, true, `${key} document became modified during capture`);
    if (target.documentModifiedStateObservableBeforeCapture === true && target.documentModifiedStateObservableAfterCapture === true) {
      assert.equal(target.documentModifiedBeforeCapture, false, `${key} document was already modified on open`);
      assert.equal(target.documentModifiedAfterCapture, false, `${key} document became modified during capture`);
      assert.equal(target.documentModifiedStateUnchanged, true, `${key} document modified state changed during capture`);
    } else {
      assert.equal(target.documentModifiedBeforeCapture, null, `${key} unavailable modified state must be null on open`);
      assert.equal(target.documentModifiedAfterCapture, null, `${key} unavailable modified state must be null`);
      assert.equal(target.documentModifiedStateUnchanged, null, `${key} unavailable modified state must be reported as unknown`);
    }
  } else {
    assert.notEqual(target.documentModifiedAfterCapture, true, `${key} baseline modified state reports unexpected changes`);
  }
  assert.equal(target.candidateShapeCount, 1, `${key} did not resolve exactly one Animate DOM Shape`);
  return target;
}

function topologySummary(target) {
  const capture = target.targetLibraryTimelineCapture;
  assert.ok(capture && Array.isArray(capture.shapes), `${target.key} has no captured library timeline`);
  const stable = stableAnimateTopology(capture);
  const shape = capture.shapes[0]?.shape;
  assert.ok(shape, `${target.key} has no Shape data`);
  return {
    sha256: sha256(Buffer.from(JSON.stringify(stable), 'utf8')),
    edgeCount: shape.edgeCount,
    vertexCount: shape.vertexCount,
    contourCount: shape.contourCount,
    closedContourCount: shape.contours.filter(contour => contour.closedAtStart === true).length,
    halfEdgeCounts: shape.contours.map(contour => contour.halfEdges.length).sort((a, b) => a - b),
  };
}

function validateHost(receipt, before, after) {
  assert.equal(receipt.issue, 742, 'Animate control receipt belongs to a different Issue');
  assert.equal(receipt.status, 'CAPTURE_FINISHED_READ_ONLY', `Animate control status is ${receipt.status}`);
  assert.equal(receipt.invocation?.saveApiCalled, false, 'Historical control capture called a save API');
  assert.equal(receipt.invocation?.activeDocumentRestored, true, 'Historical control capture did not restore the original document');
  if (receipt.invocation?.activeDocumentModifiedStateObservableBefore === true &&
      receipt.invocation?.activeDocumentModifiedStateObservableAfter === true) {
    assert.equal(receipt.invocation?.activeDocumentModifiedStateUnchanged, true, 'Historical control capture changed the original document modified state');
  } else {
    assert.equal(receipt.invocation?.activeDocumentModifiedStateUnchanged, null, 'Unavailable original modified state must be reported as unknown');
    assert.equal(receipt.invocation?.activeDocumentModifiedBefore, null, 'Unavailable original modified state must be null before capture');
    assert.equal(receipt.invocation?.activeDocumentModifiedAfter, null, 'Unavailable original modified state must be null after capture');
  }
  assert.equal(receipt.invocation?.activeDocumentModificationDateUnchanged, true, 'Historical control capture changed the original document file timestamp');
  const host = receipt.host || {};
  for (const key of ['executablePath', 'fileVersion', 'sha256', 'authenticodeStatus', 'provenance']) {
    assert.equal(host[key], before[key], `Animate control receipt ${key} differs from before-run provenance`);
    assert.equal(after[key], before[key], `Animate ${key} changed during capture`);
  }
  assert.equal(host.provenance, host.authenticodeStatus === 'Valid' ? 'VALID_SIGNED' : 'UNTRUSTED / MODIFIED');
  assert.match(host.sha256 || '', /^[A-F0-9]{64}$/u, 'Animate executable SHA-256 is malformed');
  return host;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue742-verify-controls.cjs --run1 <json> --run2 <json> --panda <json> --host-before <json> --host-after <json> --out <external-json> [--baseline <json>] [--source <fla>] [--root <external-dir>]\n');
    return;
  }
  for (const key of ['run1', 'run2', 'panda', 'hostBefore', 'hostAfter', 'out']) assert.ok(args[key], `missing --${key}`);
  const resolved = Object.fromEntries(Object.entries(args).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, path.resolve(value)]));
  for (const key of ['run1', 'run2', 'baseline', 'source', 'panda', 'hostBefore', 'hostAfter', 'out']) {
    assert.ok(isOutsideRepo(resolved[key]), `${key} must remain outside the repository`);
  }
  assert.ok(!fs.existsSync(resolved.out), `Refusing to overwrite control verification receipt: ${resolved.out}`);

  const before = readJson(resolved.hostBefore, 'Animate host before-run provenance');
  const after = readJson(resolved.hostAfter, 'Animate host after-run provenance');
  assert.equal(before.issue, 742);
  assert.equal(after.issue, 742);
  assert.equal(before.phase, 'before');
  assert.equal(after.phase, 'after');
  assert.equal(after.stableDuringExperiment, true, 'Animate build changed during the experiment');
  assert.equal(after.processesStableDuringExperiment, true, 'Animate process/window state changed during the experiment');

  const run1 = readJson(resolved.run1, 'First Animate historical-control capture');
  const run2 = readJson(resolved.run2, 'Second Animate historical-control capture');
  const host1 = validateHost(run1, before, after);
  const host2 = validateHost(run2, before, after);
  assert.deepEqual(host1, host2, 'Animate executable provenance differs between control runs');
  assert.equal(run1.invocation.activeDocumentPathBefore, run2.invocation.activeDocumentPathBefore);

  const baseline = readJson(resolved.baseline, 'Accepted #737 Animate baseline');
  assert.equal(baseline.issue, 739, 'Selected historical Animate baseline is not the accepted #739 capture');
  const currentControls = {};
  const comparisons = {};
  for (const key of ['issue737-historical-oracle', 'issue737-closed-fill-control']) {
    const first = targetByKey(run1, key);
    const second = targetByKey(run2, key);
    const accepted = targetByKey(baseline, key, { requireNewDocument: false });
    assert.equal(first.sourceCopyPath, resolved.source, `${key} first run used a different frozen source`);
    assert.equal(second.sourceCopyPath, resolved.source, `${key} second run used a different frozen source`);
    const sourceHash = sha256(fs.readFileSync(resolved.source));
    assert.equal(sourceHash, first.expectedSourceSha256, `${key} frozen source hash differs from its manifest`);
    const firstTopology = topologySummary(first);
    const secondTopology = topologySummary(second);
    const acceptedTopology = topologySummary(accepted);
    assert.deepEqual(firstTopology, secondTopology, `${key} Contour/HalfEdge topology changed between repeated captures`);
    assert.deepEqual(firstTopology, acceptedTopology, `${key} current modified-Animate capture materially disagrees with accepted #737 control`);
    currentControls[key] = firstTopology;
    comparisons[key] = {
      repeatedTopologyStable: true,
      agreesWithAcceptedBaseline: true,
      firstRunReceipt: resolved.run1,
      secondRunReceipt: resolved.run2,
      acceptedBaselineReceipt: resolved.baseline,
      topology: firstTopology,
    };
  }

  const panda = readJson(resolved.panda, 'Current Panda #737 historical-control receipt');
  assert.equal(panda.issue, 739, 'Panda historical-control helper returned an unexpected schema/version');
  assert.equal(panda.allSourceHashesUnchanged, true, 'Panda #737 control did not preserve its source hash');
  assert.equal(panda.allPandaRunsDeterministic, true, 'Panda #737 control was not deterministic');
  assert.equal(panda.results?.length, 1, 'Panda historical-control receipt must contain only the #737 historical target');
  const pandaTarget = panda.results[0];
  assert.equal(pandaTarget.fixtureKey, 'issue737-historical-oracle');
  assert.equal(pandaTarget.source?.expectedSha256, 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA');
  assert.equal(pandaTarget.source?.unchanged, true);
  assert.equal(pandaTarget.pandaCurrentInterpretation.determinism.stable, true);
  assert.equal(pandaTarget.pandaCurrentInterpretation.renderAttempt.status, 'RENDERED');
  const boundary = pandaTarget.pandaCurrentInterpretation.fillBoundaryByStyle['1'];
  assert.equal(boundary.boundarySegmentCount, 98);
  assert.equal(boundary.endpointGraph.balanced, true);
  assert.equal(boundary.exactSourceOrderCycleDecomposition.ok, true);
  assert.equal(boundary.exactSourceOrderCycleDecomposition.consumedSegmentCount, 98);
  assert.equal(boundary.exactSourceOrderCycleDecomposition.openRemainderSegmentCount, 0);
  assert.equal(boundary.stitcherStatus, 'RENDERED');

  const report = {
    schemaVersion: 'issue742-modified-animate-controls/1',
    issue: 742,
    status: 'COMPENSATING_CONTROLS_PASS',
    animateHost: { before, after, captureReceipt: host1 },
    frozenControlSource: {
      path: resolved.source,
      sha256: sha256(fs.readFileSync(resolved.source)),
      expectedSha256: 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA',
    },
    historicalAnimateControl: comparisons,
    pandaHistoricalControl: {
      receiptPath: resolved.panda,
      sourceHashUnchanged: pandaTarget.source.unchanged,
      deterministic: pandaTarget.pandaCurrentInterpretation.determinism.stable,
      renderStatus: pandaTarget.pandaCurrentInterpretation.renderAttempt.status,
      fillStyle1BoundarySegments: boundary.boundarySegmentCount,
      balancedEndpointGraph: boundary.endpointGraph.balanced,
      closedCyclesConsumeAllSegments: boundary.exactSourceOrderCycleDecomposition.ok,
      stitcherStatus: boundary.stitcherStatus,
      differentialSha256: pandaTarget.differentialSha256,
    },
  };
  fs.mkdirSync(path.dirname(resolved.out), { recursive: true });
  fs.writeFileSync(resolved.out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Issue #742 compensating-control receipt: ${resolved.out}\n`);
  process.stdout.write('Modified Animate #737 control and Panda cross-stage control: PASS\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
}
