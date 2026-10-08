#!/usr/bin/env node
'use strict';

// Issue #741 research only. Reads Animate-authored minimal FLA fixtures and
// observes the current production XFL adapter/fill reconstruction seam.
// All locks and receipts are written outside the repository.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const zlib = require('node:zlib');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FIXTURE_ROOT = 'D:\\PandaStage-Acceptance\\issue741-repair-contract-20261009';
const REQUIRED_FIXTURES = Object.freeze([
  'D-A-authored-close',
  'D-B-explicit-close',
  'B-A-clockwise-explicit',
  'B-B-counterclockwise-explicit',
  'control-explicit-closed',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const args = { root: DEFAULT_FIXTURE_ROOT, mode: null, lock: null, manifest: null, out: null, animateRun: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') args.root = argv[++index];
    else if (value === '--freeze') args.mode = 'freeze';
    else if (value === '--analyze') args.mode = 'analyze';
    else if (value === '--lock') args.lock = argv[++index];
    else if (value === '--manifest') args.manifest = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--animate-run') args.animateRun = argv[++index];
    else if (value === '--help' || value === '-h') args.help = true;
  }
  return args;
}

function isOutsideRepo(candidatePath) {
  const relative = path.relative(ROOT, candidatePath);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function assertOutsideRepo(candidatePath, label) {
  assert.ok(isOutsideRepo(candidatePath), `${label} must remain outside the repository: ${candidatePath}`);
}

function readJson(filePath, label) {
  assert.ok(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compileInstrumented(modulePath, source, replacements) {
  let instrumented = source;
  for (const [needle, replacement] of replacements) {
    if (!instrumented.includes(needle)) throw new Error(`Instrumentation seam not found: ${needle}`);
    instrumented = instrumented.replace(needle, replacement);
  }
  const compiled = new Module(modulePath, module);
  compiled.filename = modulePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(modulePath));
  compiled._compile(instrumented, modulePath);
  return compiled.exports;
}

function instrumentAdapter() {
  const modulePath = path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const needle = 'context.state.shapeBlocks.set(shapeId, child.xml);';
  const replacement = [
    'global.__issue741ShapeAddresses.push({ shapeId, scope: context.scope, path, sourceAddress: `${context.scope}/${path}` });',
    needle,
  ].join('\n');
  return compileInstrumented(modulePath, source, [[needle, replacement]]);
}

function instrumentBuilder() {
  const modulePath = path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const captureRuns = [
    'function reconstructFills(representation, shapeId, renderTargetId, frameIndex) {',
    '    global.__issue741StyleRuns[shapeId] = representation.styleRuns.map(run => ({',
    '        edgeIndex: run.edgeIndex, commandStart: run.commandStart, commandEnd: run.commandEnd,',
    '        fillStyle0: run.fillStyle0, fillStyle1: run.fillStyle1, strokeStyle: run.strokeStyle,',
    '        commands: run.commands,',
    '    }));',
    '    global.__issue741StyleChanges[shapeId] = representation.styleChanges.map(change => ({ ...change }));',
  ].join('\n');
  const captureBoundary = [
    'function stitchFillBoundary(segments, shapeId, fillStyleIndex) {',
    '    global.__issue741BoundaryInputs[shapeId] = global.__issue741BoundaryInputs[shapeId] || {};',
    '    global.__issue741BoundaryInputs[shapeId][fillStyleIndex] = segments.map(segment => ({',
    '        from: segment.from, to: segment.to, command: segment.command, order: segment.order,',
    '    }));',
  ].join('\n');
  return compileInstrumented(modulePath, source, [
    ['function reconstructFills(representation, shapeId, renderTargetId, frameIndex) {', captureRuns],
    ['function stitchFillBoundary(segments, shapeId, fillStyleIndex) {', captureBoundary],
  ]);
}

function countPattern(text, pattern) {
  return [...String(text || '').matchAll(pattern)].length;
}

function rawEdgeCounts(edge) {
  const text = edge.attributes.cubics || edge.attributes.edges || '';
  return {
    line: countPattern(text, /\|/gu),
    quadratic: countPattern(text, /\[/gu),
    cubic: countPattern(text, /\(;|\(/gu),
    closeMarker: countPattern(text, /\//gu),
    selectionMarker: countPattern(text, /S\s*\d+/gu),
  };
}

function pointKey(point) {
  const part = value => Object.is(value, -0) ? '0' : String(value);
  return `${part(point.x)},${part(point.y)}`;
}

function graphReport(segments) {
  const nodes = new Map();
  for (const segment of segments) {
    const fromKey = pointKey(segment.from);
    const toKey = pointKey(segment.to);
    const from = nodes.get(fromKey) || { point: segment.from, inDegree: 0, outDegree: 0 };
    from.outDegree += 1;
    nodes.set(fromKey, from);
    const to = nodes.get(toKey) || { point: segment.to, inDegree: 0, outDegree: 0 };
    to.inDegree += 1;
    nodes.set(toKey, to);
  }
  const endpoints = [...nodes.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => left.point.x - right.point.x || left.point.y - right.point.y);
  return {
    endpointCount: endpoints.length,
    balanced: endpoints.every(node => node.inDegree === node.outDegree),
    imbalancedEndpoints: endpoints.filter(node => node.inDegree !== node.outDegree),
    endpoints,
  };
}

function exactCycleDecomposition(segments) {
  const ordered = [...segments].sort((left, right) => left.order - right.order);
  const outgoing = new Map();
  for (const segment of ordered) {
    const key = pointKey(segment.from);
    const list = outgoing.get(key) || [];
    list.push(segment);
    outgoing.set(key, list);
  }
  const used = new Set();
  const cycles = [];
  for (const seed of ordered) {
    if (used.has(seed.order)) continue;
    const start = pointKey(seed.from);
    let current = start;
    const cycle = [];
    for (;;) {
      const next = (outgoing.get(current) || []).find(segment => !used.has(segment.order));
      if (!next) {
        return {
          ok: false, cycles, consumedSegmentCount: used.size,
          totalSegmentCount: ordered.length, deadEnd: current,
          openRemainder: ordered.filter(segment => !used.has(segment.order)).map(segment => segment.order),
        };
      }
      used.add(next.order);
      cycle.push(next.order);
      current = pointKey(next.to);
      if (current === start) break;
      if (cycle.length > ordered.length) {
        return {
          ok: false, cycles, consumedSegmentCount: used.size,
          totalSegmentCount: ordered.length, reason: 'walk exceeded source segment count',
          openRemainder: ordered.filter(segment => !used.has(segment.order)).map(segment => segment.order),
        };
      }
    }
    cycles.push(cycle);
  }
  return {
    ok: used.size === ordered.length,
    cycles,
    consumedSegmentCount: used.size,
    totalSegmentCount: ordered.length,
    openRemainder: ordered.filter(segment => !used.has(segment.order)).map(segment => segment.order),
  };
}

function sourceSideMappings(styleRuns, rawEdgeRecords) {
  const rawCounts = new Map(rawEdgeRecords.map(edge => [edge.edgeIndex, edge.counts]));
  const perEdgeDrawOrdinal = new Map();
  const mapped = [];
  let currentEdgeIndex = -1;
  let closeOrdinal = 0;
  let current = null;
  let subpathStart = null;

  const append = (run, commandIndex, ordinal, from, to, command, fillStyleIndex, side, reverse, originKind, subpathStart) => {
    const orientedFrom = reverse ? to : from;
    const orientedTo = reverse ? from : to;
    let orientedCommand = command;
    if (reverse) {
      if (command.type === 'Q') orientedCommand = { type: 'Q', cx: command.cx, cy: command.cy, x: from.x, y: from.y };
      else if (command.type === 'C') orientedCommand = {
        type: 'C', c1x: command.c2x, c1y: command.c2y,
        c2x: command.c1x, c2y: command.c1y, x: from.x, y: from.y,
      };
      else orientedCommand = { type: 'L', x: from.x, y: from.y };
    }
    const closeCount = rawCounts.get(run.edgeIndex)?.closeMarker || 0;
    mapped.push({
      sourceEdgeIndex: run.edgeIndex,
      sourceSubsegmentOrdinal: ordinal,
      pandaCommandIndex: commandIndex,
      fillStyleIndex,
      sourceFillSide: side,
      reversed: reverse,
      originKind,
      sourceAuthoredCloseMarkerOrdinal: originKind === 'authored-close-semantics' && closeOrdinal <= closeCount ? closeOrdinal : null,
      sourceFrom: from,
      sourceTo: to,
      sourceSubpathStart: subpathStart,
      orientedFrom,
      orientedTo,
      orientedCommand,
    });
  };

  for (const run of styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) {
      currentEdgeIndex = run.edgeIndex;
      closeOrdinal = 0;
      current = null;
      subpathStart = null;
    }
    for (let localIndex = 0; localIndex < run.commands.length; localIndex += 1) {
      const command = run.commands[localIndex];
      const commandIndex = run.commandStart + localIndex;
      if (command.type === 'M') {
        current = { x: command.x, y: command.y };
        subpathStart = current;
        continue;
      }
      if (command.type === 'Z') {
        closeOrdinal += 1;
        if (current && subpathStart && pointKey(current) !== pointKey(subpathStart) && run.fillStyle0 !== run.fillStyle1) {
          const close = { type: 'L', x: subpathStart.x, y: subpathStart.y };
          if (run.fillStyle1 !== null) append(run, commandIndex, null, current, subpathStart, close, run.fillStyle1, 'fillStyle1', false, 'authored-close-semantics', subpathStart);
          if (run.fillStyle0 !== null) append(run, commandIndex, null, current, subpathStart, close, run.fillStyle0, 'fillStyle0', true, 'authored-close-semantics', subpathStart);
        }
        current = subpathStart;
        continue;
      }
      const end = { x: command.x, y: command.y };
      if (!current) {
        current = end;
        continue;
      }
      const ordinal = (perEdgeDrawOrdinal.get(run.edgeIndex) || 0) + 1;
      perEdgeDrawOrdinal.set(run.edgeIndex, ordinal);
      if (run.fillStyle0 !== run.fillStyle1) {
        if (run.fillStyle1 !== null) append(run, commandIndex, ordinal, current, end, command, run.fillStyle1, 'fillStyle1', false, 'raw-edge-subsegment', subpathStart);
        if (run.fillStyle0 !== null) append(run, commandIndex, ordinal, current, end, command, run.fillStyle0, 'fillStyle0', true, 'raw-edge-subsegment', subpathStart);
      }
      current = end;
    }
  }
  return mapped.map(mapping => ({
    ...mapping,
    rawSubsegmentCountForEdge: rawCounts.get(mapping.sourceEdgeIndex)
      ? rawCounts.get(mapping.sourceEdgeIndex).line + rawCounts.get(mapping.sourceEdgeIndex).quadratic + rawCounts.get(mapping.sourceEdgeIndex).cubic
      : null,
    decodedSubsegmentCountForEdge: perEdgeDrawOrdinal.get(mapping.sourceEdgeIndex) || 0,
  }));
}

function directShapeDisplayList(shapeId) {
  return {
    kind: 'graphic',
    sourceName: `issue741-direct:${shapeId}`,
    frameIndex: 0,
    layers: [{
      name: `issue741-direct:${shapeId}`,
      children: [{ kind: 'shape', shapeId, worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }],
    }],
    resolvedNodeCount: 1,
  };
}

async function readAndAdapt(entry, adapter, recovery) {
  const originalBytes = fs.readFileSync(entry.path);
  const sourceSha256Before = sha256(originalBytes);
  assert.equal(sourceSha256Before, entry.sha256, `${entry.key} source hash differs from the frozen source lock`);
  const classification = recovery.classifyForFlaRecovery(originalBytes);
  const normalized = recovery.normalizeRecoveryCandidate(originalBytes, classification);
  const sourceBytes = normalized.applied ? normalized.bytes : originalBytes;
  const zip = await JSZip.loadAsync(sourceBytes);
  const documentFile = zip.file('DOMDocument.xml');
  assert.ok(documentFile, `${entry.key} is missing DOMDocument.xml`);
  const documentXml = await documentFile.async('string');
  const libraryXmlEntries = await Promise.all(Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && name.startsWith('LIBRARY/') && name.toLocaleLowerCase('en-US').endsWith('.xml'))
    .sort()
    .map(async name => ({ name, xml: await zip.file(name).async('string') })));
  global.__issue741ShapeAddresses = [];
  const adapted = adapter.adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || `${entry.key} XFL adapter failed`);
  const sourceSha256After = sha256(fs.readFileSync(entry.path));
  assert.equal(sourceSha256After, sourceSha256Before, `${entry.key} source changed during inspection`);
  return {
    sourceSha256Before,
    sourceSha256After,
    normalizedSha256: sha256(sourceBytes),
    recovery: {
      state: classification.state,
      applied: normalized.applied,
      field: normalized.field || null,
      deltaBytes: normalized.deltaBytes || 0,
      mode: normalized.mode || 'none',
      originalBytesWritten: false,
    },
    adapted: adapted.source,
    shapeAddresses: global.__issue741ShapeAddresses,
  };
}

function parseShape(adapter, shapeXml) {
  const shapeChildren = adapter.getFlaXflDirectChildren(shapeXml, 'DOMShape');
  const fillsBlock = shapeChildren.find(child => child.name === 'fills');
  const fillStyles = fillsBlock
    ? adapter.getFlaXflDirectChildren(fillsBlock.xml, 'fills')
      .filter(child => child.name === 'FillStyle')
      .map((style, index) => ({ ...style, index: Number(style.attributes.index || index + 1) }))
    : [];
  const edgesBlock = shapeChildren.find(child => child.name === 'edges');
  const edgeRecords = edgesBlock
    ? adapter.getFlaXflDirectChildren(edgesBlock.xml, 'edges')
      .filter(child => child.name === 'Edge')
      .map((edge, edgeIndex) => ({ ...edge, edgeIndex }))
    : [];
  return { shapeChildren, fillStyles, edgeRecords };
}

function analyzeSourceGeometry(styleRuns) {
  let edgeIndex = -1;
  let subpathStart = null;
  let current = null;
  const closes = [];
  for (const run of styleRuns) {
    if (run.edgeIndex !== edgeIndex) {
      edgeIndex = run.edgeIndex;
      subpathStart = null;
      current = null;
    }
    for (const command of run.commands) {
      if (command.type === 'M') {
        current = { x: command.x, y: command.y };
        subpathStart = current;
      } else if (command.type === 'Z') {
        current = subpathStart;
      } else {
        const end = { x: command.x, y: command.y };
        if (current && subpathStart && pointKey(end) === pointKey(subpathStart)) {
          closes.push({ edgeIndex: run.edgeIndex, from: current, to: end, type: command.type });
        }
        current = end;
      }
    }
  }
  return closes;
}

async function runBuilderTwice(entry, adapted, shapeId, builder) {
  const runs = [];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    global.__issue741StyleRuns = Object.create(null);
    global.__issue741StyleChanges = Object.create(null);
    global.__issue741BoundaryInputs = Object.create(null);
    const result = await builder.buildSvgForResolvedDisplayList({
      displayList: directShapeDisplayList(shapeId),
      renderTargetId: `issue741:${entry.key}`,
      stageWidth: adapted.stageWidth,
      stageHeight: adapted.stageHeight,
      shapeBlocks: adapted.shapeBlocks,
      resolveBitmapMedia: () => ({ ok: false, reason: 'not used by the direct solid-color Shape capture' }),
    });
    const styleRuns = global.__issue741StyleRuns[shapeId] || [];
    const styleChanges = global.__issue741StyleChanges[shapeId] || [];
    const boundaryInputs = global.__issue741BoundaryInputs[shapeId] || {};
    const svgSha256 = result.ok ? sha256(Buffer.from(result.svg, 'utf8')) : null;
    const stableFacts = { result, styleRuns, styleChanges, boundaryInputs, svgSha256 };
    runs.push({
      status: result.ok ? 'RENDERED' : 'BLOCKED',
      code: result.ok ? null : result.code,
      message: result.ok ? null : result.message,
      composition: result.ok ? result.composition : null,
      svgSha256,
      styleRuns,
      styleChanges,
      boundaryInputs,
      stableSha256: sha256(Buffer.from(JSON.stringify(stableFacts), 'utf8')),
    });
  }
  return runs;
}

function summarizeFillBoundary(styleIndex, segments, mappings, run) {
  const subset = mappings.filter(mapping => mapping.fillStyleIndex === Number(styleIndex));
  const rawSegments = subset.filter(mapping => mapping.originKind === 'raw-edge-subsegment');
  const closeSegments = subset.filter(mapping => mapping.originKind === 'authored-close-semantics');
  const actual = segments.map(segment => ({ from: segment.from, to: segment.to, command: segment.command }));
  const mapped = subset.map(mapping => ({
    from: mapping.orientedFrom,
    to: mapping.orientedTo,
    command: mapping.orientedCommand,
    sourceEdgeIndex: mapping.sourceEdgeIndex,
    sourceSubsegmentOrdinal: mapping.sourceSubsegmentOrdinal,
    fillStyleIndex: mapping.fillStyleIndex,
    sourceFillSide: mapping.sourceFillSide,
    reversed: mapping.reversed,
    originKind: mapping.originKind,
    sourceAuthoredCloseMarkerOrdinal: mapping.sourceAuthoredCloseMarkerOrdinal,
  }));
  return {
    boundarySegmentCount: segments.length,
    sourceSideMappingCount: subset.length,
    sourceSideMappingMatchesBoundaryCount: subset.length === segments.length,
    rawSubsegmentMappingCount: rawSegments.length,
    authoredCloseBoundaryMappingCount: closeSegments.length,
    fillStyle0SourceMappingCount: subset.filter(mapping => mapping.sourceFillSide === 'fillStyle0').length,
    fillStyle1SourceMappingCount: subset.filter(mapping => mapping.sourceFillSide === 'fillStyle1').length,
    reversedMappingCount: subset.filter(mapping => mapping.reversed).length,
    orientedBoundary: mapped,
    endpointGraph: graphReport(segments),
    exactCycleDecomposition: exactCycleDecomposition(segments),
    stitcherStatus: run.status,
    stitcherFailureCode: run.code,
    stitcherFailureMessage: run.message,
    boundaryInputSha256: sha256(Buffer.from(JSON.stringify(segments), 'utf8')),
    mappedBoundarySha256: sha256(Buffer.from(JSON.stringify(actual), 'utf8')),
    productionBoundaryEqualsMappedSourceSides: JSON.stringify(actual) === JSON.stringify(mapped.map(({ from, to, command }) => ({ from, to, command }))),
  };
}

async function analyzeFixture(entry, adapter, builder, recovery) {
  const read = await readAndAdapt(entry, adapter, recovery);
  const shapeBlocks = [...read.adapted.shapeBlocks.entries()];
  assert.equal(shapeBlocks.length, 1, `${entry.key} must adapt to exactly one production Shape; found ${shapeBlocks.length}`);
  const [shapeId, shapeXml] = shapeBlocks[0];
  const parsed = parseShape(adapter, shapeXml);
  assert.equal(parsed.fillStyles.length, 1, `${entry.key} must contain exactly one FillStyle`);
  const targetFill = parsed.fillStyles[0];
  const rawEdges = parsed.edgeRecords.map(edge => {
    const counts = rawEdgeCounts(edge);
    const fillStyle0 = edge.attributes.fillStyle0 === undefined ? null : Number(edge.attributes.fillStyle0);
    const fillStyle1 = edge.attributes.fillStyle1 === undefined ? null : Number(edge.attributes.fillStyle1);
    const strokeStyle = edge.attributes.strokeStyle === undefined ? null : Number(edge.attributes.strokeStyle);
    return {
      edgeIndex: edge.edgeIndex,
      fillStyle0,
      fillStyle1,
      strokeStyle,
      encodedEdges: edge.attributes.edges || null,
      encodedCubics: edge.attributes.cubics || null,
      rawXml: edge.xml,
      counts,
      rawSubsegmentCount: counts.line + counts.quadratic + counts.cubic,
    };
  });
  const runs = await runBuilderTwice(entry, read.adapted, shapeId, builder);
  const first = runs[0];
  const styleRuns = first.styleRuns;
  const sourceMappings = sourceSideMappings(styleRuns, rawEdges);
  const boundaries = Object.fromEntries(Object.entries(first.boundaryInputs).map(([styleIndex, segments]) => [
    styleIndex,
    summarizeFillBoundary(styleIndex, segments, sourceMappings, first),
  ]));
  const relevantRawEdges = rawEdges.filter(edge => edge.fillStyle0 === targetFill.index || edge.fillStyle1 === targetFill.index);
  const targetMappings = sourceMappings.filter(mapping => mapping.fillStyleIndex === targetFill.index);
  const rawCloseMarkerCount = rawEdges.reduce((sum, edge) => sum + edge.counts.closeMarker, 0);
  const rawDrawSegmentCount = relevantRawEdges.reduce((sum, edge) => sum + edge.rawSubsegmentCount, 0);
  const explicitClosingGeometry = analyzeSourceGeometry(styleRuns);
  const fill0Edges = relevantRawEdges.filter(edge => edge.fillStyle0 === targetFill.index);
  const fill1Edges = relevantRawEdges.filter(edge => edge.fillStyle1 === targetFill.index);
  const drawCommands = styleRuns.flatMap(run => run.commands.filter(command => ['L', 'Q', 'C'].includes(command.type)));
  const targetStyleRuns = styleRuns.filter(run => run.fillStyle0 === targetFill.index || run.fillStyle1 === targetFill.index);
  const targetDrawCount = targetStyleRuns.reduce((sum, run) => sum + run.commands.filter(command => ['L', 'Q', 'C'].includes(command.type)).length, 0);
  const rawSummary = {
    shapeBlockSha256: sha256(Buffer.from(shapeXml, 'utf8')),
    fullShapeEdgeRecordCount: rawEdges.length,
    rawSubsegmentCount: rawEdges.reduce((sum, edge) => sum + edge.rawSubsegmentCount, 0),
    rawDrawSubsegmentCountForTargetFill: rawDrawSegmentCount,
    rawAuthoredCloseMarkerCount: rawCloseMarkerCount,
    explicitClosingGeometryCommandCount: explicitClosingGeometry.length,
    explicitClosingGeometry,
    targetFillStyleIndex: targetFill.index,
    targetFillSourceFillStyle0EdgeCount: fill0Edges.length,
    targetFillSourceFillStyle1EdgeCount: fill1Edges.length,
    targetFillSourceFillStyle0SubsegmentCount: fill0Edges.reduce((sum, edge) => sum + edge.rawSubsegmentCount, 0),
    targetFillSourceFillStyle1SubsegmentCount: fill1Edges.reduce((sum, edge) => sum + edge.rawSubsegmentCount, 0),
    edgeRecords: rawEdges,
  };
  const panda = {
    renderAttempt: {
      status: first.status, code: first.code, message: first.message,
      svgSha256: first.svgSha256, composition: first.composition,
    },
    decodedCommandCount: styleRuns.reduce((sum, run) => sum + run.commands.length, 0),
    decodedDrawSubsegmentCount: drawCommands.length,
    targetFillDrawSubsegmentCount: targetDrawCount,
    rawToDecodedDrawSubsegmentCountMatches: rawDrawSegmentCount === targetDrawCount,
    retainedStyleRunCount: styleRuns.length,
    retainedStyleChangeCount: first.styleChanges.length,
    retainedStyleChanges: first.styleChanges,
    sourceFillStyle0MappingCount: targetMappings.filter(mapping => mapping.sourceFillSide === 'fillStyle0').length,
    sourceFillStyle1MappingCount: targetMappings.filter(mapping => mapping.sourceFillSide === 'fillStyle1').length,
    reversedFillStyle0MappingCount: targetMappings.filter(mapping => mapping.sourceFillSide === 'fillStyle0' && mapping.reversed).length,
    fillBoundaryByStyle: boundaries,
    rawToPandaSegmentMap: targetMappings,
    determinism: {
      repeatCount: runs.length,
      runHashes: runs.map(run => run.stableSha256),
      stable: runs[0].stableSha256 === runs[1].stableSha256,
    },
  };
  return {
    fixtureKey: entry.key,
    family: entry.family,
    variant: entry.variant,
    source: {
      path: entry.path,
      fileName: path.basename(entry.path),
      expectedSha256: entry.sha256,
      sourceSha256Before: read.sourceSha256Before,
      sourceSha256After: read.sourceSha256After,
      unchanged: read.sourceSha256Before === read.sourceSha256After,
      normalizedSha256: read.normalizedSha256,
      recovery: read.recovery,
    },
    selected: {
      shapeId,
      shapeBlockSha256: rawSummary.shapeBlockSha256,
      sourceAddresses: read.shapeAddresses.filter(address => address.shapeId === shapeId),
      targetFillStyleIndex: targetFill.index,
      fillStyleXml: targetFill.xml,
      fullShapeXml: shapeXml,
    },
    rawXfl: rawSummary,
    pandaCurrentInterpretation: panda,
  };
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(buffer.subarray(0, 8).equals(signature), 'Animate capture is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  assert.ok(width > 0 && height > 0, 'PNG dimensions are missing');
  assert.equal(bitDepth, 8, `Unsupported PNG bit depth ${bitDepth}`);
  assert.equal(interlace, 0, 'Interlaced Animate PNG capture is not supported by the pixel comparator');
  const channelCounts = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelCounts[colorType];
  assert.ok(channels, `Unsupported PNG color type ${colorType}`);
  if (colorType === 3) assert.ok(palette && palette.length % 3 === 0, 'Indexed PNG palette is missing or invalid');
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(compressed));
  assert.equal(inflated.length, (stride + 1) * height, 'PNG inflated data has an unexpected length');
  const raw = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let row = 0; row < height; row += 1) {
    const inputStart = row * (stride + 1);
    const filter = inflated[inputStart];
    const outputStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const value = inflated[inputStart + 1 + column];
      const left = column >= channels ? raw[outputStart + column - channels] : 0;
      const up = row > 0 ? raw[outputStart + column - stride] : 0;
      const upperLeft = row > 0 && column >= channels ? raw[outputStart + column - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else assert.equal(filter, 0, `Unsupported PNG row filter ${filter}`);
      raw[outputStart + column] = (value + predictor) & 0xFF;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  const colors = new Set();
  let nonTransparentPixels = 0;
  let nonWhitePixels = 0;
  let exactFixtureColorPixels = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const source = pixelIndex * channels;
    const target = pixelIndex * 4;
    let r; let g; let b; let a = 255;
    if (colorType === 0) r = g = b = raw[source];
    else if (colorType === 2) { r = raw[source]; g = raw[source + 1]; b = raw[source + 2]; }
    else if (colorType === 3) {
      const paletteOffset = raw[source] * 3;
      assert.ok(paletteOffset + 2 < palette.length, 'PNG palette index is out of range');
      r = palette[paletteOffset]; g = palette[paletteOffset + 1]; b = palette[paletteOffset + 2];
      if (transparency && raw[source] < transparency.length) a = transparency[raw[source]];
    } else if (colorType === 4) { r = g = b = raw[source]; a = raw[source + 1]; }
    else { r = raw[source]; g = raw[source + 1]; b = raw[source + 2]; a = raw[source + 3]; }
    rgba[target] = r; rgba[target + 1] = g; rgba[target + 2] = b; rgba[target + 3] = a;
    if (a > 0) nonTransparentPixels += 1;
    if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) nonWhitePixels += 1;
    if (a > 0 && r === 214 && g === 66 && b === 66) exactFixtureColorPixels += 1;
    if (colors.size <= 4096) colors.add(`${r},${g},${b},${a}`);
  }
  return {
    width,
    height,
    rgba,
    pixelSha256: sha256(Buffer.concat([Buffer.from(`${width}x${height}:`, 'utf8'), rgba])),
    uniqueRgbaColorCount: colors.size,
    nonTransparentPixelCount: nonTransparentPixels,
    nonWhitePixelCount: nonWhitePixels,
    exactFixtureColorPixelCount: exactFixtureColorPixels,
  };
}

function safeScreenshotPath(root, screenshotPath) {
  const resolved = path.resolve(screenshotPath);
  const relative = path.relative(path.resolve(root), resolved);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `Screenshot path escapes the fixture root: ${screenshotPath}`);
  return resolved;
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

function loadAnimateRun(args, root) {
  if (args.animateRun) {
    const runPath = path.resolve(args.animateRun);
    assertOutsideRepo(runPath, 'Animate capture receipt');
    const receipt = readJson(runPath, 'Animate capture receipt');
    return { latest: receipt, pair: null, path: runPath, runCount: 1 };
  }
  const captureRoot = path.join(root, 'animate-captures');
  if (!fs.existsSync(captureRoot)) return { latest: null, pair: null, path: null, runCount: 0 };
  const runDirectories = fs.readdirSync(captureRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^run\d{2}$/u.test(entry.name))
    .map(entry => ({ name: entry.name, number: Number(entry.name.slice(3)), path: path.join(captureRoot, entry.name) }))
    .sort((left, right) => left.number - right.number);
  const receipts = [];
  for (const directory of runDirectories) {
    const filePath = path.join(directory.path, `animate-run${String(directory.number).padStart(2, '0')}.json`);
    if (fs.existsSync(filePath)) receipts.push({ number: directory.number, filePath, receipt: readJson(filePath, `Animate run ${directory.number} receipt`) });
  }
  if (receipts.length === 0) return { latest: null, pair: null, path: null, runCount: 0 };
  const latest = receipts[receipts.length - 1];
  const pair = receipts.length >= 2 ? [receipts[receipts.length - 2], latest] : null;
  return { latest: latest.receipt, pair, path: latest.filePath, runCount: receipts.length };
}

function animateEvidence(runInfo, root, entries) {
  if (!runInfo.latest) {
    return {
      status: 'NOT_CAPTURED',
      runsAvailable: 0,
      repeatability: { status: 'NOT_CAPTURED', runCount: 0, fixtures: [] },
      fixtures: [],
    };
  }
  const receipt = runInfo.latest;
  const expectedByKey = new Map(entries.map(entry => [entry.key, entry]));
  const assertFrozenSource = (target, key) => {
    const expected = expectedByKey.get(key);
    assert.ok(expected, `Frozen source lock is missing ${key}`);
    assert.equal(path.resolve(target.sourcePath), path.resolve(expected.path), `${key} Animate source path differs from the frozen source`);
    assert.equal(sha256(fs.readFileSync(expected.path)), expected.sha256, `${key} Animate source no longer matches the frozen SHA-256`);
  };
  assert.equal(receipt.issue, 741, 'Animate capture receipt is for a different Issue');
  assert.equal(receipt.status, 'CAPTURED_READ_ONLY', `Animate capture receipt status is ${receipt.status}`);
  assert.equal(receipt.invocation?.originalDocumentSaveApiCalled, false, 'Animate oracle called a save API on the original user document');
  assert.equal(receipt.invocation?.oracleSaveApiCalled, false, 'Animate oracle called a save API while collecting evidence');
  assert.equal(receipt.invocation?.activeDocumentRestored, true, 'Animate oracle did not restore the original active document');
  assert.equal(receipt.invocation?.activeDocumentModifiedStateUnchanged, true, 'Animate oracle changed the original active document modified state');
  assert.equal(receipt.invocation?.activeDocumentModificationDateUnchanged, true, 'Animate oracle changed the original active document file timestamp');
  const targetsByKey = new Map((receipt.fixtures || []).map(target => [target.key, target]));
  const fixtures = REQUIRED_FIXTURES.map(key => {
    const target = targetsByKey.get(key);
    assert.ok(target, `Animate capture is missing fixture ${key}`);
    assert.equal(target.status, 'CAPTURED_READ_ONLY', `${key} Animate capture status is ${target.status}`);
    assert.equal(target.saveApiCalled, false, `${key} Animate oracle save API was called`);
    assert.equal(target.documentPathMatches, true, `${key} Animate document path mismatch`);
    assert.equal(target.isPreExistingDocument, false, `${key} was already open before Animate capture`);
    assert.equal(target.documentModifiedBeforeCapture, false, `${key} source document was already modified on open`);
    assert.equal(target.documentModifiedAfterCapture, false, `${key} source document became modified during capture`);
    assert.equal(target.sourceFileModificationDateUnchanged, true, `${key} FLA changed during read-only Animate capture`);
    assert.equal(target.candidateShapeCount, 1, `${key} did not contain one captured stage Shape`);
    assertFrozenSource(target, key);
    const screenshotPath = safeScreenshotPath(root, target.screenshotPath);
    assert.ok(fs.existsSync(screenshotPath), `${key} Animate screenshot is missing: ${screenshotPath}`);
    const screenshotBytes = fs.readFileSync(screenshotPath);
    const decoded = decodePng(screenshotBytes);
    assert.ok(decoded.nonTransparentPixelCount > 0, `${key} Animate screenshot is empty`);
    assert.ok(decoded.uniqueRgbaColorCount > 1, `${key} Animate screenshot contains only one color`);
    assert.ok(decoded.exactFixtureColorPixelCount > 0, `${key} screenshot does not contain the authored fill color #D64242`);
    const topology = stableAnimateTopology(target.timelineCapture);
    return {
      key,
      status: target.status,
      sourcePath: target.sourcePath,
      sourceFileModificationDateBefore: target.sourceFileModificationDateBefore,
      sourceFileModificationDateAfter: target.sourceFileModificationDateAfter,
      timelineCapture: target.timelineCapture,
      stableTopologySha256: sha256(Buffer.from(JSON.stringify(topology), 'utf8')),
      screenshot: {
        path: screenshotPath,
        fileSha256: sha256(screenshotBytes),
        pixelSha256: decoded.pixelSha256,
        width: decoded.width,
        height: decoded.height,
        uniqueRgbaColorCount: decoded.uniqueRgbaColorCount,
        nonTransparentPixelCount: decoded.nonTransparentPixelCount,
        nonWhitePixelCount: decoded.nonWhitePixelCount,
        exactFixtureColorPixelCount: decoded.exactFixtureColorPixelCount,
      },
    };
  });
  let repeatability = { status: 'PENDING_SECOND_RUN', runCount: runInfo.runCount, fixtures: [] };
  if (runInfo.pair) {
    const [firstRun, secondRun] = runInfo.pair;
    const firstByKey = new Map((firstRun.receipt.fixtures || []).map(target => [target.key, target]));
    const secondByKey = new Map((secondRun.receipt.fixtures || []).map(target => [target.key, target]));
    const comparison = REQUIRED_FIXTURES.map(key => {
      const first = firstByKey.get(key);
      const second = secondByKey.get(key);
      assert.ok(first && second, `Animate repeat capture is missing fixture ${key}`);
      assertFrozenSource(first, key);
      assertFrozenSource(second, key);
      const firstTopology = stableAnimateTopology(first.timelineCapture);
      const secondTopology = stableAnimateTopology(second.timelineCapture);
      const firstScreenshot = decodePng(fs.readFileSync(safeScreenshotPath(root, first.screenshotPath)));
      const secondScreenshot = decodePng(fs.readFileSync(safeScreenshotPath(root, second.screenshotPath)));
      return {
        key,
        firstRun: firstRun.number,
        secondRun: secondRun.number,
        topologyStable: JSON.stringify(firstTopology) === JSON.stringify(secondTopology),
        firstTopologySha256: sha256(Buffer.from(JSON.stringify(firstTopology), 'utf8')),
        secondTopologySha256: sha256(Buffer.from(JSON.stringify(secondTopology), 'utf8')),
        screenshotPixelsStable: firstScreenshot.pixelSha256 === secondScreenshot.pixelSha256,
        firstScreenshotPixelSha256: firstScreenshot.pixelSha256,
        secondScreenshotPixelSha256: secondScreenshot.pixelSha256,
      };
    });
    repeatability = {
      status: comparison.every(item => item.topologyStable && item.screenshotPixelsStable) ? 'STABLE' : 'UNSTABLE',
      runCount: runInfo.runCount,
      fixtures: comparison,
    };
  }
  return {
    status: 'CAPTURED_READ_ONLY',
    receiptPath: runInfo.path,
    receiptSha256: sha256(Buffer.from(JSON.stringify(receipt), 'utf8')),
    runCount: runInfo.runCount,
    latestRunNumber: receipt.runNumber,
    repeatability,
    fixtures,
  };
}

function comparePixels(left, right) {
  return left.screenshot.width === right.screenshot.width &&
    left.screenshot.height === right.screenshot.height &&
    left.screenshot.pixelSha256 === right.screenshot.pixelSha256;
}

function canonicalSourceSegments(fixture) {
  const targetStyle = fixture.rawXfl.targetFillStyleIndex;
  const segments = fixture.pandaCurrentInterpretation.rawToPandaSegmentMap
    .filter(mapping => mapping.fillStyleIndex === targetStyle && mapping.originKind === 'raw-edge-subsegment')
    .map(mapping => {
      const ends = [pointKey(mapping.sourceFrom), pointKey(mapping.sourceTo)].sort();
      return `${ends[0]}|${ends[1]}`;
    })
    .sort();
  return segments;
}

function assessExperiments(results, animate) {
  const byKey = new Map(results.map(result => [result.fixtureKey, result]));
  const animateByKey = new Map(animate.fixtures.map(fixture => [fixture.key, fixture]));
  const dA = byKey.get('D-A-authored-close');
  const dB = byKey.get('D-B-explicit-close');
  const bA = byKey.get('B-A-clockwise-explicit');
  const bB = byKey.get('B-B-counterclockwise-explicit');
  const control = byKey.get('control-explicit-closed');
  const animateRepeatStable = animate.repeatability.status === 'STABLE';
  const pandaRepeatStable = results.every(result => result.pandaCurrentInterpretation.determinism.stable);
  const visualPair = (leftKey, rightKey) => {
    const left = animateByKey.get(leftKey);
    const right = animateByKey.get(rightKey);
    if (!left || !right) return { status: 'PENDING_ANIMATE_CAPTURE' };
    return { status: comparePixels(left, right) ? 'PIXEL_IDENTICAL' : 'PIXELS_DIFFER' };
  };
  const closeVisual = visualPair(dA.fixtureKey, dB.fixtureKey);
  const sideVisual = visualPair(bA.fixtureKey, bB.fixtureKey);
  const controlVisual = visualPair(dB.fixtureKey, control.fixtureKey);
  const closeContrastSurvived = dA.rawXfl.rawAuthoredCloseMarkerCount > 0 &&
    dB.rawXfl.rawAuthoredCloseMarkerCount === 0 &&
    dB.rawXfl.explicitClosingGeometryCommandCount > 0 &&
    dA.selected.shapeBlockSha256 !== dB.selected.shapeBlockSha256;
  const fillSideContrastSurvived = (
    bA.rawXfl.targetFillSourceFillStyle0EdgeCount > 0 && bA.rawXfl.targetFillSourceFillStyle1EdgeCount === 0 &&
    bB.rawXfl.targetFillSourceFillStyle1EdgeCount > 0 && bB.rawXfl.targetFillSourceFillStyle0EdgeCount === 0
  );
  const sameUndirectedBoundary = JSON.stringify(canonicalSourceSegments(bA)) === JSON.stringify(canonicalSourceSegments(bB));
  const render = fixture => fixture.pandaCurrentInterpretation.renderAttempt.status;
  return {
    closePath: {
      fixtureKeys: [dA.fixtureKey, dB.fixtureKey],
      rawSemanticContrastSurvived: closeContrastSurvived,
      visualEquivalence: closeVisual,
      repeatability: {
        animate: animateRepeatStable ? 'STABLE' : animate.repeatability.status,
        panda: dA.pandaCurrentInterpretation.determinism.stable && dB.pandaCurrentInterpretation.determinism.stable ? 'STABLE' : 'UNSTABLE',
      },
      authoredClose: {
        rawAuthoredCloseMarkerCount: dA.rawXfl.rawAuthoredCloseMarkerCount,
        explicitClosingGeometryCommandCount: dA.rawXfl.explicitClosingGeometryCommandCount,
        pandaStatus: render(dA),
        animateContourCount: animateByKey.get(dA.fixtureKey)?.timelineCapture.shapes[0].shape.contourCount ?? null,
      },
      explicitClosingEdge: {
        rawAuthoredCloseMarkerCount: dB.rawXfl.rawAuthoredCloseMarkerCount,
        explicitClosingGeometryCommandCount: dB.rawXfl.explicitClosingGeometryCommandCount,
        pandaStatus: render(dB),
        animateContourCount: animateByKey.get(dB.fixtureKey)?.timelineCapture.shapes[0].shape.contourCount ?? null,
      },
      decision: !pandaRepeatStable || !animateRepeatStable
        ? 'PENDING_OR_UNSTABLE_REPEATABILITY'
        : !closeContrastSurvived
        ? 'REDESIGN_REQUIRED_RAW_CONTRAST_NOT_PRESERVED'
        : closeVisual.status !== 'PIXEL_IDENTICAL'
          ? 'REDESIGN_REQUIRED_VISUALS_NOT_EQUIVALENT'
          : render(dA) === 'BLOCKED' && render(dB) === 'RENDERED'
            ? 'D_STRONGLY_SUPPORTED'
            : render(dA) === render(dB)
              ? 'D_WEAKENED_FOR_THIS_MINIMAL_MECHANISM'
              : 'D_DIVERGES_REQUIRES_TOPOLOGY_REVIEW',
    },
    fillSide: {
      fixtureKeys: [bA.fixtureKey, bB.fixtureKey],
      rawOwnershipContrastSurvived: fillSideContrastSurvived,
      sameUndirectedRawBoundary: sameUndirectedBoundary,
      visualEquivalence: sideVisual,
      repeatability: {
        animate: animateRepeatStable ? 'STABLE' : animate.repeatability.status,
        panda: bA.pandaCurrentInterpretation.determinism.stable && bB.pandaCurrentInterpretation.determinism.stable ? 'STABLE' : 'UNSTABLE',
      },
      clockwise: {
        fillStyle0EdgeCount: bA.rawXfl.targetFillSourceFillStyle0EdgeCount,
        fillStyle1EdgeCount: bA.rawXfl.targetFillSourceFillStyle1EdgeCount,
        pandaStatus: render(bA),
        pandaReversedFillStyle0MappingCount: bA.pandaCurrentInterpretation.reversedFillStyle0MappingCount,
        animateContourOrientations: animateByKey.get(bA.fixtureKey)?.timelineCapture.shapes[0].shape.contours.map(contour => contour.orientation) ?? null,
      },
      counterclockwise: {
        fillStyle0EdgeCount: bB.rawXfl.targetFillSourceFillStyle0EdgeCount,
        fillStyle1EdgeCount: bB.rawXfl.targetFillSourceFillStyle1EdgeCount,
        pandaStatus: render(bB),
        pandaReversedFillStyle0MappingCount: bB.pandaCurrentInterpretation.reversedFillStyle0MappingCount,
        animateContourOrientations: animateByKey.get(bB.fixtureKey)?.timelineCapture.shapes[0].shape.contours.map(contour => contour.orientation) ?? null,
      },
      decision: !pandaRepeatStable || !animateRepeatStable
        ? 'PENDING_OR_UNSTABLE_REPEATABILITY'
        : !fillSideContrastSurvived
        ? 'REDESIGN_REQUIRED_OWNERSHIP_CONTRAST_NOT_PRESERVED'
        : !sameUndirectedBoundary || sideVisual.status !== 'PIXEL_IDENTICAL'
          ? 'REDESIGN_REQUIRED_GEOMETRY_OR_VISUALS_DIFFER'
          : render(bA) !== render(bB)
            ? 'B_STRONGLY_SUPPORTED'
            : 'B_WEAKENED_FOR_THIS_MINIMAL_MECHANISM',
    },
    positiveControl: {
      fixtureKey: control.fixtureKey,
      pandaStatus: render(control),
      closedBoundary: Object.values(control.pandaCurrentInterpretation.fillBoundaryByStyle).length > 0 &&
        Object.values(control.pandaCurrentInterpretation.fillBoundaryByStyle).every(fill =>
          fill.endpointGraph.balanced && fill.exactCycleDecomposition.ok && fill.stitcherStatus === 'RENDERED'),
      pixelIdenticalToD_B: controlVisual.status === 'PIXEL_IDENTICAL',
    },
    fCandidate: {
      evaluated: false,
      reason: 'Evaluate F only after both valid D and B A/B families behave correctly; extra Animate interior edges alone do not establish F.',
    },
    provisionalVerdict: 'H — INSUFFICIENT / STOP_PENDING_REPEATABILITY_AND_ORACLE_REVIEW',
  };
}

async function freezeSourceLock(root, manifestPath, lockPath) {
  assertOutsideRepo(lockPath, 'Source lock');
  assert.ok(!fs.existsSync(lockPath), `Refusing to overwrite existing source lock: ${lockPath}`);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.issue, 741, 'Authoring manifest is not for Issue #741');
  const fixtures = manifest.fixtures || [];
  assert.deepEqual(fixtures.map(fixture => fixture.key).sort(), [...REQUIRED_FIXTURES].sort(), 'Authoring manifest fixture set differs from Issue #741 suite');
  const lockedFixtures = fixtures.map(fixture => {
    assert.equal(fixture.authoring?.status, 'CREATED_BY_ANIMATE', `${fixture.key} was not reported as authored by Animate`);
    const filePath = path.join(root, 'fixtures', fixture.fileName);
    const resolved = path.resolve(filePath);
    assert.ok(path.dirname(resolved) === path.resolve(root, 'fixtures'), `${fixture.key} path escapes the external fixture folder`);
    assert.ok(fs.existsSync(resolved), `${fixture.key} FLA is missing: ${resolved}`);
    const bytes = fs.readFileSync(resolved);
    return {
      key: fixture.key,
      family: fixture.family,
      variant: fixture.variant,
      closeMode: fixture.closeMode,
      fileName: fixture.fileName,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
  const lock = {
    schemaVersion: 'issue741-source-lock/1',
    issue: 741,
    authoringManifestPath: manifestPath,
    authoringManifestSha256: sha256(manifestBytes),
    baselineGitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    fixtures: lockedFixtures,
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Issue #741 source lock written: ${lockPath}\n`);
  for (const fixture of lockedFixtures) process.stdout.write(`${fixture.key}: ${fixture.sha256}\n`);
}

async function analyze(args, root, manifestPath, lockPath) {
  assert.ok(args.out, 'missing --out');
  assert.ok(lockPath, 'missing --lock');
  const outputPath = path.resolve(args.out);
  assertOutsideRepo(outputPath, 'Differential receipt');
  assert.ok(!fs.existsSync(outputPath), `Refusing to overwrite existing differential receipt: ${outputPath}`);
  const lock = readJson(lockPath, 'Issue #741 frozen source lock');
  const manifestBytes = fs.readFileSync(manifestPath);
  assert.equal(lock.issue, 741, 'Source lock is not for Issue #741');
  assert.equal(lock.authoringManifestSha256, sha256(manifestBytes), 'Authoring manifest differs from frozen source lock');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(manifest.fixtures.map(fixture => fixture.key).sort(), [...REQUIRED_FIXTURES].sort(), 'Authoring manifest fixture set differs from Issue #741 suite');
  const manifestByKey = new Map(manifest.fixtures.map(fixture => [fixture.key, fixture]));
  const lockByKey = new Map(lock.fixtures.map(fixture => [fixture.key, fixture]));
  assert.deepEqual([...lockByKey.keys()].sort(), [...REQUIRED_FIXTURES].sort(), 'Source lock fixture set differs from Issue #741 suite');
  const entries = REQUIRED_FIXTURES.map(key => {
    const meta = manifestByKey.get(key);
    const frozen = lockByKey.get(key);
    assert.ok(meta && frozen, `Missing source metadata for ${key}`);
    assert.equal(meta.authoring?.status, 'CREATED_BY_ANIMATE', `${key} was not created by Animate`);
    assert.equal(meta.fileName, frozen.fileName, `${key} file name differs between manifest and source lock`);
    const filePath = path.join(root, 'fixtures', frozen.fileName);
    assert.ok(path.dirname(path.resolve(filePath)) === path.resolve(root, 'fixtures'), `${key} path escapes fixture root`);
    return { ...frozen, family: frozen.family || meta.family, variant: frozen.variant || meta.variant, path: filePath };
  });
  const adapter = instrumentAdapter();
  const builder = instrumentBuilder();
  const recovery = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const results = [];
  for (const entry of entries) {
    const result = await analyzeFixture(entry, adapter, builder, recovery);
    results.push(result);
    const targetBoundary = result.pandaCurrentInterpretation.fillBoundaryByStyle[result.rawXfl.targetFillStyleIndex];
    process.stdout.write(`${entry.key}: xflEdges=${result.rawXfl.fullShapeEdgeRecordCount} closeMarkers=${result.rawXfl.rawAuthoredCloseMarkerCount} boundary=${targetBoundary?.boundarySegmentCount ?? 0} panda=${result.pandaCurrentInterpretation.renderAttempt.status} stable=${result.pandaCurrentInterpretation.determinism.stable}\n`);
  }
  const runInfo = loadAnimateRun(args, root);
  const animate = animateEvidence(runInfo, root, entries);
  const visualEvidence = animate.fixtures.length > 0 ? animate.fixtures : [];
  const experimentAssessment = assessExperiments(results, { ...animate, fixtures: visualEvidence });
  const report = {
    schemaVersion: 'issue741-xfl-panda-animate-differential/1',
    issue: 741,
    baseline: { gitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() },
    sourceLockPath: lockPath,
    sourceLockSha256: sha256(fs.readFileSync(lockPath)),
    authoringManifestPath: manifestPath,
    authoringManifestSha256: sha256(manifestBytes),
    allSourceHashesUnchanged: results.every(result => result.source.unchanged),
    allPandaRunsDeterministic: results.every(result => result.pandaCurrentInterpretation.determinism.stable),
    animateOracle: animate,
    decisionAssessment: experimentAssessment,
    historicalControlReference: {
      issue737AndIssue739Evidence: 'docs/evidence/issue-739/issue739-open-fill-corpus-differential.json',
      retained: fs.existsSync(path.join(ROOT, 'docs/evidence/issue-739/issue739-open-fill-corpus-differential.json')),
      currentRealFailingShapeConfirmation: 'DEFERRED_UNTIL_A_MINIMAL_MECHANISM_IS_PROVEN',
    },
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Issue #741 differential receipt written: ${outputPath}\n`);
  process.stdout.write(`Decision: D=${experimentAssessment.closePath.decision}; B=${experimentAssessment.fillSide.decision}; F=${experimentAssessment.fCandidate.evaluated ? 'EVALUATED' : 'DEFERRED'}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write([
      'Usage:',
      '  node scripts/research/issue741-xfl-panda-differential.cjs --freeze [--root <external-dir>] [--manifest <path>] [--lock <path>]',
      '  node scripts/research/issue741-xfl-panda-differential.cjs --analyze --lock <path> --out <external-json> [--root <external-dir>] [--manifest <path>] [--animate-run <receipt-json>]',
      '',
      'The Animate JSFL authoring/oracle helper writes its FLA fixtures and capture receipts under the external root.',
    ].join('\n') + '\n');
    return;
  }
  assert.ok(args.mode === 'freeze' || args.mode === 'analyze', 'choose exactly one of --freeze or --analyze');
  const root = path.resolve(args.root);
  assertOutsideRepo(root, 'Fixture root');
  const manifestPath = path.resolve(args.manifest || path.join(root, 'authoring-manifest.json'));
  const lockPath = path.resolve(args.lock || path.join(root, 'fixture-lock.json'));
  assertOutsideRepo(manifestPath, 'Authoring manifest');
  assertOutsideRepo(lockPath, 'Source lock');
  if (args.mode === 'freeze') await freezeSourceLock(root, manifestPath, lockPath);
  else await analyze(args, root, manifestPath, lockPath);
}

main().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
