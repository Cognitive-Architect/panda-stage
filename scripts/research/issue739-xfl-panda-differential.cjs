#!/usr/bin/env node
'use strict';

// Read-only Issue #739 differential at the current production XFL adapter and
// fill-boundary stitching seam. Receipts are written outside the repository.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '../..');
const CORPUS = Object.freeze([
  {
    key: 'hanfu-open-fill',
    role: 'V0 first-failing Shape',
    sourcePath: 'D:\\表情合集\\新人物\\汉服修仙女.fla',
    sourceSha256: '6AF14990029D4CED2C4E305721321835180C1BF041178A8799E1D14A1F62E535',
    shapeId: 'fla-shape-9420f0fcb052d77956ea920f',
    fillStyleIndex: 1,
  },
  {
    key: 'qingling-open-fill',
    role: 'V0 first-failing Shape',
    sourcePath: 'D:\\表情合集\\新人物\\青绫修仙女（四视角）.fla',
    sourceSha256: 'D0958D4432DECBF6C54566BA15A2F5E97BD88C82D75DCB2F84603E9B2273F0E4',
    shapeId: 'fla-shape-944dedeb2bb14b160532f675',
    fillStyleIndex: 1,
  },
  {
    key: 'xiuxian-male-open-fill',
    role: 'V0 first-failing Shape',
    sourcePath: 'D:\\表情合集\\新人物\\修仙男.fla',
    sourceSha256: '565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5',
    shapeId: 'fla-shape-196ba2d2358441409a8b4dce',
    fillStyleIndex: 1,
  },
  {
    key: 'issue737-historical-oracle',
    role: 'Issue #737 historical cross-stage control',
    sourcePath: 'D:\\表情合集\\黑衣修仙男.fla',
    sourceSha256: 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA',
    shapeId: 'fla-shape-f715af380bb888b2571345e2',
    fillStyleIndex: 1,
  },
  {
    key: 'issue737-closed-fill-control',
    role: 'Known-working closed-fill positive control in character FLA',
    sourcePath: 'D:\\表情合集\\黑衣修仙男.fla',
    sourceSha256: 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA',
    shapeId: 'fla-shape-289bd154caee9595b4c5ddef',
    fillStyleIndex: 1,
  },
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const args = { target: 'all', out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--target') args.target = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
  }
  return args;
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
    'global.__issue739ShapeAddresses.push({ shapeId, scope: context.scope, path, sourceAddress: `${context.scope}/${path}` });',
    needle,
  ].join('\n');
  return compileInstrumented(modulePath, source, [[needle, replacement]]);
}

function instrumentBuilder() {
  const modulePath = path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const captureRuns = [
    'function reconstructFills(representation, shapeId, renderTargetId, frameIndex) {',
    '    global.__issue739StyleRuns[shapeId] = representation.styleRuns.map(run => ({',
    '        edgeIndex: run.edgeIndex, commandStart: run.commandStart, commandEnd: run.commandEnd,',
    '        fillStyle0: run.fillStyle0, fillStyle1: run.fillStyle1, strokeStyle: run.strokeStyle,',
    '        commands: run.commands,',
    '    }));',
    '    global.__issue739StyleChanges[shapeId] = representation.styleChanges.map(change => ({ ...change }));',
  ].join('\n');
  const captureBoundary = [
    'function stitchFillBoundary(segments, shapeId, fillStyleIndex) {',
    '    global.__issue739BoundaryInputs[shapeId] = global.__issue739BoundaryInputs[shapeId] || {};',
    '    global.__issue739BoundaryInputs[shapeId][fillStyleIndex] = segments.map(segment => ({',
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
    lowerQMarker: countPattern(text, /\bq\b/gu),
    upperQMarker: countPattern(text, /\bQ\b/gu),
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
  let deadEnd = null;
  let partialTrail = [];
  for (const seed of ordered) {
    if (used.has(seed.order)) continue;
    const start = pointKey(seed.from);
    let current = start;
    const cycle = [];
    for (;;) {
      const next = (outgoing.get(current) || []).find(segment => !used.has(segment.order));
      if (!next) {
        deadEnd = current;
        partialTrail = cycle;
        const remainder = ordered.filter(segment => !used.has(segment.order));
        return {
          ok: false,
          cycles,
          consumedSegmentCount: used.size,
          totalSegmentCount: ordered.length,
          deadEnd,
          partialTrail,
          openRemainderSegmentCount: remainder.length,
          openRemainder: remainder.map(segment => segment.order),
        };
      }
      used.add(next.order);
      cycle.push(next.order);
      current = pointKey(next.to);
      if (current === start) break;
      if (cycle.length > ordered.length) {
        return {
          ok: false,
          cycles,
          consumedSegmentCount: used.size,
          totalSegmentCount: ordered.length,
          reason: 'walk exceeded source segment count',
          openRemainderSegmentCount: ordered.length - used.size,
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
    deadEnd,
    partialTrail,
    openRemainderSegmentCount: ordered.length - used.size,
    openRemainder: ordered.filter(segment => !used.has(segment.order)).map(segment => segment.order),
  };
}

function sourceSideMappings(styleRuns, rawEdgeRecords) {
  const rawCounts = new Map(rawEdgeRecords.map(edge => [edge.edgeIndex, edge.counts || rawEdgeCounts(edge)]));
  const perEdgeDrawOrdinal = new Map();
  const mapped = [];
  let currentEdgeIndex = -1;
  let current = null;
  let subpathStart = null;
  let closeOrdinal = 0;

  const append = (run, edgeIndex, commandIndex, rawSubsegmentOrdinal, from, to, command, fillStyleIndex, side, reverse, originKind) => {
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
    mapped.push({
      sourceEdgeIndex: edgeIndex,
      sourceSubsegmentOrdinal: rawSubsegmentOrdinal,
      pandaCommandIndex: commandIndex,
      fillStyleIndex,
      sourceFillSide: side,
      reversed: reverse,
      originKind,
      sourceAuthoredCloseMarkerOrdinal: originKind === 'authored-close-semantics' &&
        closeOrdinal <= (rawCounts.get(edgeIndex)?.closeMarker || 0) ? closeOrdinal : null,
      sourceFrom: from,
      sourceTo: to,
      orientedFrom,
      orientedTo,
      orientedCommand,
      rawSubsegmentCountForEdge: rawCounts.get(edgeIndex)?.line + rawCounts.get(edgeIndex)?.quadratic + rawCounts.get(edgeIndex)?.cubic,
      rawSubsegmentCountMatch: null,
    });
  };

  for (const run of styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) {
      currentEdgeIndex = run.edgeIndex;
      current = null;
      subpathStart = null;
      closeOrdinal = 0;
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
          if (run.fillStyle1 !== null) append(run, run.edgeIndex, commandIndex, null, current, subpathStart, close, run.fillStyle1, 'fillStyle1', false, 'authored-close-semantics');
          if (run.fillStyle0 !== null) append(run, run.edgeIndex, commandIndex, null, current, subpathStart, close, run.fillStyle0, 'fillStyle0', true, 'authored-close-semantics');
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
        if (run.fillStyle1 !== null) append(run, run.edgeIndex, commandIndex, ordinal, current, end, command, run.fillStyle1, 'fillStyle1', false, 'raw-edge-subsegment');
        if (run.fillStyle0 !== null) append(run, run.edgeIndex, commandIndex, ordinal, current, end, command, run.fillStyle0, 'fillStyle0', true, 'raw-edge-subsegment');
      }
      current = end;
    }
  }
  return mapped.map(mapping => {
    const counts = rawCounts.get(mapping.sourceEdgeIndex);
    const rawCount = counts ? counts.line + counts.quadratic + counts.cubic : null;
    return {
      ...mapping,
      rawSubsegmentCountForEdge: rawCount,
      decodedSubsegmentCountForEdge: perEdgeDrawOrdinal.get(mapping.sourceEdgeIndex) || 0,
      rawSubsegmentCountMatch: rawCount !== null && rawCount === (perEdgeDrawOrdinal.get(mapping.sourceEdgeIndex) || 0),
    };
  });
}

function directShapeDisplayList(shapeId) {
  return {
    kind: 'graphic',
    sourceName: `issue739-direct:${shapeId}`,
    frameIndex: 0,
    layers: [{
      name: `issue739-direct:${shapeId}`,
      children: [{
        kind: 'shape',
        shapeId,
        worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      }],
    }],
    resolvedNodeCount: 1,
  };
}

async function readAndAdapt(entry, adapter) {
  const originalBytes = fs.readFileSync(entry.sourcePath);
  const sourceShaBefore = sha256(originalBytes);
  assert.equal(sourceShaBefore, entry.sourceSha256, `${entry.key} source SHA-256 differs from frozen #732/#737 control`);
  const recovery = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = recovery.classifyForFlaRecovery(originalBytes);
  const normalized = recovery.normalizeRecoveryCandidate(originalBytes, classification);
  const sourceBytes = normalized.applied ? normalized.bytes : originalBytes;
  const normalizedSha256 = sha256(sourceBytes);
  const zip = await JSZip.loadAsync(sourceBytes);
  const documentFile = zip.file('DOMDocument.xml');
  assert.ok(documentFile, `${entry.key} is missing DOMDocument.xml`);
  const documentXml = await documentFile.async('string');
  const libraryXmlEntries = await Promise.all(Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && name.startsWith('LIBRARY/') && name.toLocaleLowerCase('en-US').endsWith('.xml'))
    .sort()
    .map(async name => ({ name, xml: await zip.file(name).async('string') })));
  global.__issue739ShapeAddresses = [];
  const adapted = adapter.adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || `${entry.key} XFL adapter failed`);
  const sourceShaAfter = sha256(fs.readFileSync(entry.sourcePath));
  assert.equal(sourceShaAfter, sourceShaBefore, `${entry.key} source changed during inspection`);
  return {
    originalBytes,
    sourceShaBefore,
    sourceShaAfter,
    sourceBytes,
    normalizedSha256,
    recovery: {
      state: classification.state,
      applied: normalized.applied,
      field: normalized.field || null,
      deltaBytes: normalized.deltaBytes || 0,
      mode: normalized.mode || 'none',
      originalBytesWritten: false,
    },
    adapted: adapted.source,
    shapeAddresses: global.__issue739ShapeAddresses.filter(address => address.shapeId === entry.shapeId),
  };
}

function parseShape(adapter, shapeXml, fillStyleIndex) {
  const shapeChildren = adapter.getFlaXflDirectChildren(shapeXml, 'DOMShape');
  const fillsBlock = shapeChildren.find(child => child.name === 'fills');
  const fillStyles = fillsBlock
    ? adapter.getFlaXflDirectChildren(fillsBlock.xml, 'fills').filter(child => child.name === 'FillStyle')
      .map((style, index) => ({ ...style, index: Number(style.attributes.index || index + 1) }))
    : [];
  const targetFill = fillStyles.find(style => style.index === fillStyleIndex);
  assert.ok(targetFill, `FillStyle ${fillStyleIndex} missing from selected Shape`);
  const edgesBlock = shapeChildren.find(child => child.name === 'edges');
  const edgeRecords = edgesBlock
    ? adapter.getFlaXflDirectChildren(edgesBlock.xml, 'edges')
      .filter(child => child.name === 'Edge')
      .map((edge, edgeIndex) => ({ ...edge, edgeIndex }))
    : [];
  return { shapeChildren, fillStyles, targetFill, edgeRecords };
}

async function runBuilderTwice(entry, adapted, builder) {
  const runs = [];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    global.__issue739StyleRuns = Object.create(null);
    global.__issue739StyleChanges = Object.create(null);
    global.__issue739BoundaryInputs = Object.create(null);
    const result = await builder.buildSvgForResolvedDisplayList({
      displayList: directShapeDisplayList(entry.shapeId),
      renderTargetId: `issue739:${entry.key}`,
      stageWidth: adapted.stageWidth,
      stageHeight: adapted.stageHeight,
      shapeBlocks: adapted.shapeBlocks,
      resolveBitmapMedia: () => ({ ok: false, reason: 'not used by direct Shape capture' }),
    });
    const styleRuns = global.__issue739StyleRuns[entry.shapeId] || [];
    const styleChanges = global.__issue739StyleChanges[entry.shapeId] || [];
    const boundaries = global.__issue739BoundaryInputs[entry.shapeId] || {};
    const stableFacts = { result, styleRuns, styleChanges, boundaries };
    runs.push({
      status: result.ok ? 'RENDERED' : 'BLOCKED',
      code: result.ok ? null : result.code,
      message: result.ok ? null : result.message,
      composition: result.ok ? result.composition : null,
      svgSha256: result.ok ? sha256(Buffer.from(result.svg, 'utf8')) : null,
      styleRuns,
      styleChanges,
      boundaryInputs: boundaries,
      stableSha256: sha256(Buffer.from(JSON.stringify(stableFacts), 'utf8')),
    });
  }
  assert.equal(runs[0].stableSha256, runs[1].stableSha256, `${entry.key} Panda runs were not stable`);
  return runs;
}

async function analyze(entry, adapter, builder) {
  const read = await readAndAdapt(entry, adapter);
  const shapeXml = read.adapted.shapeBlocks.get(entry.shapeId);
  assert.ok(shapeXml, `${entry.key} Shape ${entry.shapeId} not found in current XFL adapter output`);
  const parsed = parseShape(adapter, shapeXml, entry.fillStyleIndex);
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
      rawSegmentCount: counts.line + counts.quadratic + counts.cubic,
    };
  });
  const runs = await runBuilderTwice(entry, read.adapted, builder);
  const styleRuns = runs[0].styleRuns;
  const boundaryInputs = runs[0].boundaryInputs;
  const sourceMappings = sourceSideMappings(styleRuns, rawEdges.map(edge => ({
    edgeIndex: edge.edgeIndex,
    attributes: { fillStyle0: edge.fillStyle0, fillStyle1: edge.fillStyle1, strokeStyle: edge.strokeStyle, edges: edge.encodedEdges, cubics: edge.encodedCubics },
    counts: edge.counts,
  })));
  const fills = Object.fromEntries(Object.entries(boundaryInputs).map(([styleIndex, segments]) => {
    const subset = sourceMappings.filter(mapping => mapping.fillStyleIndex === Number(styleIndex));
    const rawSubsegmentMappings = subset.filter(mapping => mapping.originKind === 'raw-edge-subsegment');
    const closeMappings = subset.filter(mapping => mapping.originKind === 'authored-close-semantics');
    const graph = graphReport(segments);
    const cycles = exactCycleDecomposition(segments);
    const mappedBoundary = subset.map(mapping => ({
      sourceEdgeIndex: mapping.sourceEdgeIndex,
      sourceSubsegmentOrdinal: mapping.sourceSubsegmentOrdinal,
      pandaCommandIndex: mapping.pandaCommandIndex,
      fillStyleIndex: mapping.fillStyleIndex,
      sourceFillSide: mapping.sourceFillSide,
      reversed: mapping.reversed,
      originKind: mapping.originKind,
      sourceAuthoredCloseMarkerOrdinal: mapping.sourceAuthoredCloseMarkerOrdinal,
      from: mapping.orientedFrom,
      to: mapping.orientedTo,
      command: mapping.orientedCommand,
    }));
    const actual = segments.map(segment => ({ from: segment.from, to: segment.to, command: segment.command }));
    return [styleIndex, {
      boundarySegmentCount: segments.length,
      sourceSideMappingCount: subset.length,
      sourceSideMappingMatchesBoundaryCount: subset.length === segments.length,
      rawSubsegmentMappingCount: rawSubsegmentMappings.length,
      authoredCloseBoundaryMappingCount: closeMappings.length,
      boundarySegmentMapping: mappedBoundary,
      endpointGraph: graph,
      exactSourceOrderCycleDecomposition: cycles,
      stitcherStatus: runs[0].status,
      stitcherFailureCode: runs[0].code,
      stitcherFailureMessage: runs[0].message,
      boundaryInputHash: sha256(Buffer.from(JSON.stringify(segments), 'utf8')),
      mappedBoundaryHash: sha256(Buffer.from(JSON.stringify(actual), 'utf8')),
      normalizedInputEqualsMappedSourceSides: JSON.stringify(actual) === JSON.stringify(mappedBoundary.map(({ from, to, command }) => ({ from, to, command }))),
    }];
  }));
  const relevantEdges = rawEdges.filter(edge => edge.fillStyle0 === entry.fillStyleIndex || edge.fillStyle1 === entry.fillStyleIndex);
  const targetSubsegmentCounts = relevantEdges.reduce((counts, edge) => ({
    line: counts.line + edge.counts.line,
    quadratic: counts.quadratic + edge.counts.quadratic,
    cubic: counts.cubic + edge.counts.cubic,
  }), { line: 0, quadratic: 0, cubic: 0 });
  const targetFill0Records = relevantEdges.filter(edge => edge.fillStyle0 === entry.fillStyleIndex);
  const targetFill1Records = relevantEdges.filter(edge => edge.fillStyle1 === entry.fillStyleIndex);
  const targetStyleRuns = styleRuns.filter(run => run.fillStyle0 === entry.fillStyleIndex || run.fillStyle1 === entry.fillStyleIndex);
  const totalPandaCommands = styleRuns.reduce((sum, run) => sum + run.commands.length, 0);
  const decodedDrawSubsegments = styleRuns.reduce((sum, run) => sum + run.commands.filter(command => ['L', 'Q', 'C'].includes(command.type)).length, 0);
  const pandaTargetDrawSubsegments = targetStyleRuns.reduce((sum, run) => sum + run.commands.filter(command => ['L', 'Q', 'C'].includes(command.type)).length, 0);
  const reversedSideSegments = sourceMappings.filter(mapping => mapping.fillStyleIndex === entry.fillStyleIndex && mapping.reversed);
  const rawEdgeStyleTupleTransitionCount = rawEdges.slice(1).reduce((count, edge, index) => {
    const previous = rawEdges[index];
    return count + (previous.fillStyle0 !== edge.fillStyle0 || previous.fillStyle1 !== edge.fillStyle1 || previous.strokeStyle !== edge.strokeStyle ? 1 : 0);
  }, 0);
  const rawSummary = {
    fullShapeEdgeRecordCount: rawEdges.length,
    rawSubsegmentCount: rawEdges.reduce((sum, edge) => sum + edge.rawSegmentCount, 0),
    rawSubsegmentCountsByType: rawEdges.reduce((counts, edge) => ({
      line: counts.line + edge.counts.line,
      quadratic: counts.quadratic + edge.counts.quadratic,
      cubic: counts.cubic + edge.counts.cubic,
    }), { line: 0, quadratic: 0, cubic: 0 }),
    rawAuthoredCloseMarkerCount: rawEdges.reduce((sum, edge) => sum + edge.counts.closeMarker, 0),
    rawSelectionMarkerCount: rawEdges.reduce((sum, edge) => sum + edge.counts.selectionMarker, 0),
    rawQMarkerCount: rawEdges.reduce((sum, edge) => sum + edge.counts.lowerQMarker + edge.counts.upperQMarker, 0),
    rawMidEdgeStyleChangeCount: 0,
    rawMidEdgeStyleChangeCountNote: 'Each source Edge record carries one fillStyle0/fillStyle1/strokeStyle tuple. No mid-edge fill-side directive was identified; S tokens are counted separately as selection markers by the production decoder.',
    rawEdgeStyleTupleTransitionCount,
    targetFillStyle: entry.fillStyleIndex,
    targetFillEdgeRecordCount: relevantEdges.length,
    targetFillStyle0OwnershipEdgeRecordCount: targetFill0Records.length,
    targetFillStyle1OwnershipEdgeRecordCount: targetFill1Records.length,
    targetFillStyle0OwnershipSubsegmentCount: targetFill0Records.reduce((sum, edge) => sum + edge.rawSegmentCount, 0),
    targetFillStyle1OwnershipSubsegmentCount: targetFill1Records.reduce((sum, edge) => sum + edge.rawSegmentCount, 0),
    targetFillRawSubsegmentCountsByType: targetSubsegmentCounts,
    edgeRecords: rawEdges,
  };
  const panda = {
    renderAttempt: { status: runs[0].status, code: runs[0].code, message: runs[0].message, svgSha256: runs[0].svgSha256 },
    decodedCommandCount: totalPandaCommands,
    decodedDrawSubsegmentCount: decodedDrawSubsegments,
    retainedStyleRunCount: styleRuns.length,
    retainedStyleChangeCount: runs[0].styleChanges.length,
    retainedStyleChanges: runs[0].styleChanges,
    targetFillStyleRunCount: targetStyleRuns.length,
    targetFillDrawSubsegmentCount: pandaTargetDrawSubsegments,
    rawToPandaDrawSubsegmentCountMatch: targetSubsegmentCounts.line + targetSubsegmentCounts.quadratic + targetSubsegmentCounts.cubic === pandaTargetDrawSubsegments,
    reversedFillStyle0SegmentCount: reversedSideSegments.length,
    fillBoundaryByStyle: fills,
    rawToPandaSegmentMap: sourceMappings,
    determinism: {
      repeatCount: runs.length,
      runHashes: runs.map(run => run.stableSha256),
      stable: runs[0].stableSha256 === runs[1].stableSha256,
    },
  };
  const receipt = {
    schemaVersion: 'issue739-xfl-panda-differential/1',
    issue: 739,
    role: entry.role,
    fixtureKey: entry.key,
    source: {
      path: entry.sourcePath,
      fileName: path.basename(entry.sourcePath),
      expectedSha256: entry.sourceSha256,
      sourceSha256Before: read.sourceShaBefore,
      sourceSha256After: read.sourceShaAfter,
      unchanged: read.sourceShaBefore === read.sourceShaAfter,
      normalizedSha256: read.normalizedSha256,
      recovery: read.recovery,
    },
    selected: {
      shapeId: entry.shapeId,
      fillStyleIndex: entry.fillStyleIndex,
      shapeBlockSha256: sha256(Buffer.from(shapeXml, 'utf8')),
      sourceAddresses: read.shapeAddresses,
      sourceAddressCount: read.shapeAddresses.length,
      allShapeAddresses: read.shapeAddresses,
      fillStyleXml: parsed.targetFill.xml,
      fullShapeXml: shapeXml,
    },
    rawXfl: rawSummary,
    pandaCurrentInterpretation: panda,
    adobeAnimateJsfl: { status: 'NOT_CAPTURED', reason: 'awaiting Issue #739 JSFL receipt and exact source mapping' },
  };
  receipt.differentialSha256 = sha256(Buffer.from(JSON.stringify({
    source: receipt.source,
    selected: { shapeId: receipt.selected.shapeId, fillStyleIndex: receipt.selected.fillStyleIndex, shapeBlockSha256: receipt.selected.shapeBlockSha256 },
    rawXfl: receipt.rawXfl,
    pandaCurrentInterpretation: receipt.pandaCurrentInterpretation,
  }), 'utf8'));
  return receipt;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue739-xfl-panda-differential.cjs [--target all|<fixture-key>] --out <external-json-path>\n');
    return;
  }
  assert.ok(args.out, 'missing --out');
  const selected = args.target === 'all' ? CORPUS : CORPUS.filter(entry => entry.key === args.target);
  assert.ok(selected.length > 0, `unknown --target ${args.target}`);
  const outputPath = path.resolve(args.out);
  const relative = path.relative(ROOT, outputPath);
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Issue #739 evidence must remain outside the repository until reviewed');
  assert.ok(!fs.existsSync(outputPath), `refusing to overwrite existing evidence file: ${outputPath}`);
  const adapter = instrumentAdapter();
  const builder = instrumentBuilder();
  const receipts = [];
  for (const entry of selected) {
    const receipt = await analyze(entry, adapter, builder);
    receipts.push(receipt);
    process.stdout.write(`${entry.key}: edges=${receipt.rawXfl.fullShapeEdgeRecordCount} subsegments=${receipt.rawXfl.rawSubsegmentCount} fillBoundary=${receipt.pandaCurrentInterpretation.fillBoundaryByStyle[entry.fillStyleIndex]?.boundarySegmentCount ?? 0} panda=${receipt.pandaCurrentInterpretation.renderAttempt.status} stable=${receipt.pandaCurrentInterpretation.determinism.stable}\n`);
  }
  const report = {
    schemaVersion: 'issue739-xfl-panda-corpus-differential/1',
    issue: 739,
    baseline: { gitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() },
    differentialCount: receipts.length,
    allSourceHashesUnchanged: receipts.every(receipt => receipt.source.unchanged),
    allPandaRunsDeterministic: receipts.every(receipt => receipt.pandaCurrentInterpretation.determinism.stable),
    results: receipts,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Issue #739 XFL/Panda receipts: ${outputPath}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
