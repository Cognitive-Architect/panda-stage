#!/usr/bin/env node
'use strict';

// Read-only Issue #736 XFL/current-Panda audit for the already-localized
// #693 Black / FillStyle 1 source. It writes only the requested JSON receipt.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '../..');
const TARGET = Object.freeze({
  sourcePath: 'D:\\表情合集\\黑衣修仙男.fla',
  sourceSha256: 'A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA',
  normalizedSha256: '681237ABB7B32E79CE89FF8E283B0573B4BF170C6B85830828C7A10911BC7A33',
  renderTargetId: 'fla-render-target-680581b05cd778ce0f05f78b9b4e31fdfcc938d10ccb84a40f4d035074cd48f1',
  shapeId: 'fla-shape-f715af380bb888b2571345e2',
  fillStyleIndex: 1,
});
const CONTROL = Object.freeze({
  shapeId: 'fla-shape-289bd154caee9595b4c5ddef',
  sourceAddress: 'graphic:补间 1/layer-0-frame-0/0/4/0',
  shapeBlockSha256: 'ACBC9D4A2B1AA9477F4D631BA052BB195020975679D24333BED8177849B5CFAA',
  fillStyleIndex: 1,
  edgeRecordCount: 33,
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const result = { source: TARGET.sourcePath, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') result.source = argv[++index];
    else if (argv[index] === '--out') result.out = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') result.help = true;
  }
  return result;
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
    'global.__issue736ShapeAddresses.push({ shapeId, scope: context.scope, path, sourceAddress: `${context.scope}/${path}` });',
    `if (shapeId === '${TARGET.shapeId}') global.__issue736ShapeAddress = {`,
    '  shapeId, scope: context.scope, path, sourceAddress: `${context.scope}/${path}`,',
    '};',
    needle,
  ].join('\n');
  return compileInstrumented(modulePath, source, [[needle, replacement]]);
}

function instrumentBuilder() {
  const modulePath = path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const captureRuns = [
    'function reconstructFills(representation, shapeId, renderTargetId, frameIndex) {',
    `    if (shapeId === '${TARGET.shapeId}') {`,
    '        global.__issue736StyleRuns = representation.styleRuns.map(run => ({',
    '            edgeIndex: run.edgeIndex, commandStart: run.commandStart, commandEnd: run.commandEnd,',
    '            fillStyle0: run.fillStyle0, fillStyle1: run.fillStyle1, strokeStyle: run.strokeStyle,',
    '            commands: run.commands,',
    '        }));',
    '    }',
    `    if (shapeId === '${CONTROL.shapeId}') {`,
    '        global.__issue736ControlStyleRuns = representation.styleRuns.map(run => ({',
    '            edgeIndex: run.edgeIndex, commandStart: run.commandStart, commandEnd: run.commandEnd,',
    '            fillStyle0: run.fillStyle0, fillStyle1: run.fillStyle1, strokeStyle: run.strokeStyle,',
    '            commands: run.commands,',
    '        }));',
    '    }',
  ].join('\n');
  const captureBoundary = [
    'function stitchFillBoundary(segments, shapeId, fillStyleIndex) {',
    `    if (shapeId === '${TARGET.shapeId}' && fillStyleIndex === ${TARGET.fillStyleIndex}) {`,
    '        global.__issue736BoundarySegments = segments.map(segment => ({',
    '            from: segment.from, to: segment.to, command: segment.command, order: segment.order,',
    '        }));',
    '    }',
    `    if (shapeId === '${CONTROL.shapeId}') {`,
    '        global.__issue736ControlBoundariesByStyle = global.__issue736ControlBoundariesByStyle || {};',
    '        global.__issue736ControlBoundariesByStyle[fillStyleIndex] = segments.map(segment => ({',
    '            from: segment.from, to: segment.to, command: segment.command, order: segment.order,',
    '        }));',
    '    }',
  ].join('\n');
  return compileInstrumented(modulePath, source, [
    ['function reconstructFills(representation, shapeId, renderTargetId, frameIndex) {', captureRuns],
    ['function stitchFillBoundary(segments, shapeId, fillStyleIndex) {', captureBoundary],
  ]);
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
  const sorted = [...nodes.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => left.point.x - right.point.x || left.point.y - right.point.y);
  return {
    endpointCount: sorted.length,
    balanced: sorted.every(node => node.inDegree === node.outDegree),
    imbalancedEndpoints: sorted.filter(node => node.inDegree !== node.outDegree),
    endpoints: sorted,
  };
}

function sourceOrderCycleDecomposition(segments) {
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
  let states = 0;
  const stateBudget = Math.max(10_000, ordered.length * 20);
  for (const seed of ordered) {
    if (used.has(seed.order)) continue;
    const start = pointKey(seed.from);
    let current = start;
    const cycle = [];
    for (;;) {
      states += 1;
      if (states > stateBudget) return { ok: false, reason: 'state budget exceeded', states, stateBudget, cycles, consumedSegmentCount: used.size };
      const next = (outgoing.get(current) || []).find(segment => !used.has(segment.order));
      if (!next) return { ok: false, reason: 'no unused authored outgoing segment before return to cycle start', states, stateBudget, cycles, consumedSegmentCount: used.size, deadEnd: current, partialCycle: cycle };
      used.add(next.order);
      cycle.push(next.order);
      current = pointKey(next.to);
      if (current === start) break;
      if (cycle.length > ordered.length) return { ok: false, reason: 'walk exceeded source segment count', states, stateBudget, cycles, consumedSegmentCount: used.size };
    }
    cycles.push(cycle);
  }
  return { ok: used.size === ordered.length, states, stateBudget, cycles, consumedSegmentCount: used.size, totalSegmentCount: ordered.length };
}

function countMarkers(value) {
  const text = value || '';
  return {
    move: (text.match(/!/gu) || []).length,
    line: (text.match(/\|/gu) || []).length,
    quadratic: (text.match(/\[/gu) || []).length,
    cubicOpen: (text.match(/\(;|\(/gu) || []).length,
    explicitClose: (text.match(/\//gu) || []).length,
    selection: (text.match(/S\d+/gu) || []).length,
  };
}

function plainEdge(edge, runs) {
  const attributes = edge.attributes;
  const currentRuns = runs.filter(run => run.edgeIndex === edge.edgeIndex);
  const commandCounts = currentRuns.reduce((counts, run) => {
    for (const command of run.commands) counts[command.type] = (counts[command.type] || 0) + 1;
    return counts;
  }, {});
  const edgesText = attributes.edges || '';
  const cubicsText = attributes.cubics || '';
  return {
    edgeIndex: edge.edgeIndex,
    fillStyle0: attributes.fillStyle0 === undefined ? null : Number(attributes.fillStyle0),
    fillStyle1: attributes.fillStyle1 === undefined ? null : Number(attributes.fillStyle1),
    strokeStyle: attributes.strokeStyle === undefined ? null : Number(attributes.strokeStyle),
    edges: attributes.edges || null,
    cubics: attributes.cubics || null,
    rawXml: edge.xml,
    rawCommandMarkers: { edges: countMarkers(edgesText), cubics: countMarkers(cubicsText) },
    currentPandaRuns: currentRuns,
    currentPandaCommandCounts: commandCounts,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/research/issue736-xfl-panda-oracle.cjs [--source <fla>] [--out <json>]\n');
    return;
  }
  const sourcePath = args.source;
  const originalBytes = fs.readFileSync(sourcePath);
  const sourceShaBefore = sha256(originalBytes);
  if (sourceShaBefore !== TARGET.sourceSha256) throw new Error(`Frozen source hash mismatch: ${sourceShaBefore}`);

  const recovery = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = recovery.classifyForFlaRecovery(originalBytes);
  const normalized = recovery.normalizeRecoveryCandidate(originalBytes, classification);
  const sourceBytes = normalized.applied ? normalized.bytes : originalBytes;
  const normalizedSha256 = sha256(sourceBytes);
  if (normalizedSha256 !== TARGET.normalizedSha256) throw new Error(`Normalized source hash mismatch: ${normalizedSha256}`);

  const zip = await JSZip.loadAsync(sourceBytes);
  const docEntry = zip.file('DOMDocument.xml');
  if (!docEntry) throw new Error('DOMDocument.xml is missing');
  const docXml = await docEntry.async('string');
  const libraryNames = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && name.startsWith('LIBRARY/') && name.toLocaleLowerCase('en-US').endsWith('.xml'))
    .sort();
  const libraryXmlEntries = await Promise.all(libraryNames.map(async name => ({ name, xml: await zip.file(name).async('string') })));

  delete global.__issue736ShapeAddress;
  global.__issue736ShapeAddresses = [];
  const adapter = instrumentAdapter();
  const adapted = adapter.adaptFlaXflDisplaySource(docXml, libraryXmlEntries);
  if (!adapted.ok) throw new Error(`XFL adapter failed: ${adapted.message}`);
  const sourceAddress = global.__issue736ShapeAddress;
  const shapeXml = adapted.source.shapeBlocks.get(TARGET.shapeId);
  if (!sourceAddress || !shapeXml) throw new Error('Frozen #693 Shape identity could not be recovered from the current adapter');

  const shapeChildren = adapter.getFlaXflDirectChildren(shapeXml, 'DOMShape');
  const fillsBlock = shapeChildren.find(child => child.name === 'fills');
  const fillStyles = fillsBlock
    ? adapter.getFlaXflDirectChildren(fillsBlock.xml, 'fills').filter(child => child.name === 'FillStyle')
    : [];
  const targetFill = fillStyles.find(style => Number(style.attributes.index || 1) === TARGET.fillStyleIndex);
  if (!targetFill) throw new Error('Frozen #693 FillStyle 1 is missing from the recovered Shape');
  const edgesBlock = shapeChildren.find(child => child.name === 'edges');
  const edgeRecords = edgesBlock
    ? adapter.getFlaXflDirectChildren(edgesBlock.xml, 'edges')
      .filter(child => child.name === 'Edge')
      .map((edge, edgeIndex) => ({ ...edge, edgeIndex }))
    : [];
  if (edgeRecords.length !== 160) throw new Error(`Shape Edge count changed: ${edgeRecords.length}`);

  const controlAddressMatches = global.__issue736ShapeAddresses.filter(address =>
    address.shapeId === CONTROL.shapeId && address.sourceAddress === CONTROL.sourceAddress);
  if (controlAddressMatches.length !== 1) {
    throw new Error(`Frozen naturally closed control address count changed: ${controlAddressMatches.length}`);
  }
  const controlShapeXml = adapted.source.shapeBlocks.get(CONTROL.shapeId);
  if (!controlShapeXml || sha256(Buffer.from(controlShapeXml, 'utf8')) !== CONTROL.shapeBlockSha256) {
    throw new Error('Frozen naturally closed control shape identity/hash changed');
  }
  const controlShapeChildren = adapter.getFlaXflDirectChildren(controlShapeXml, 'DOMShape');
  const controlFillsBlock = controlShapeChildren.find(child => child.name === 'fills');
  const controlFillStyles = controlFillsBlock
    ? adapter.getFlaXflDirectChildren(controlFillsBlock.xml, 'fills').filter(child => child.name === 'FillStyle')
    : [];
  const controlFill = controlFillStyles.find(style => Number(style.attributes.index || 1) === CONTROL.fillStyleIndex);
  if (!controlFill) throw new Error('Frozen naturally closed control FillStyle 1 is missing');
  const controlEdgesBlock = controlShapeChildren.find(child => child.name === 'edges');
  const controlEdgeRecords = controlEdgesBlock
    ? adapter.getFlaXflDirectChildren(controlEdgesBlock.xml, 'edges')
      .filter(child => child.name === 'Edge')
      .map((edge, edgeIndex) => ({ ...edge, edgeIndex }))
    : [];
  if (controlEdgeRecords.length !== CONTROL.edgeRecordCount) {
    throw new Error(`Frozen naturally closed control Edge count changed: ${controlEdgeRecords.length}`);
  }

  delete global.__issue736StyleRuns;
  delete global.__issue736BoundarySegments;
  delete global.__issue736AllFillBoundaries;
  const builder = instrumentBuilder();
  const catalog = await builder.buildRenderableTargetCatalog(sourceBytes);
  if (!catalog.ok) throw new Error(`Current target catalog failed: ${catalog.message}`);
  const targetEntry = catalog.entries.find(entry => entry.target.renderTargetId === TARGET.renderTargetId);
  if (!targetEntry) throw new Error(`Current catalog is missing frozen target ${TARGET.renderTargetId}`);
  const rendered = await builder.buildSvgForRenderTarget(sourceBytes, targetEntry.target);
  if (!rendered.ok) throw new Error(`Current Panda render failed before target capture: ${rendered.message}`);
  const styleRuns = global.__issue736StyleRuns;
  const boundarySegments = global.__issue736BoundarySegments;
  if (!styleRuns || !boundarySegments) throw new Error('Current Panda interpretation capture is incomplete');

  delete global.__issue736ControlStyleRuns;
  delete global.__issue736ControlBoundariesByStyle;
  const controlDisplayList = {
    kind: 'graphic',
    sourceName: `issue736-control:${CONTROL.shapeId}`,
    frameIndex: 0,
    layers: [{
      name: 'issue736-control',
      children: [{
        kind: 'shape',
        shapeId: CONTROL.shapeId,
        worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      }],
    }],
    resolvedNodeCount: 1,
  };
  const controlRendered = await builder.buildSvgForResolvedDisplayList({
    displayList: controlDisplayList,
    renderTargetId: `issue736-control:${CONTROL.shapeId}`,
    stageWidth: adapted.source.stageWidth,
    stageHeight: adapted.source.stageHeight,
    shapeBlocks: adapted.source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'not used by a direct Shape control' }),
  });
  if (!controlRendered.ok) throw new Error(`Naturally closed control Shape failed the Panda render: ${controlRendered.message}`);
  const controlStyleRuns = global.__issue736ControlStyleRuns;
  const controlBoundarySegments = global.__issue736ControlBoundariesByStyle?.[CONTROL.fillStyleIndex];
  if (!controlStyleRuns || !controlBoundarySegments) throw new Error('Naturally closed control interpretation capture is incomplete');

  const fillEdges = edgeRecords.filter(edge =>
    Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex ||
    Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex);
  const subsegmentAudit = fillEdges.map(edge => {
    const currentRuns = styleRuns.filter(run => run.edgeIndex === edge.edgeIndex);
    const decoded = currentRuns.reduce((counts, run) => {
      for (const command of run.commands) counts[command.type] = (counts[command.type] || 0) + 1;
      return counts;
    }, {});
    const markers = countMarkers(edge.attributes.edges || '');
    const cubicMarkers = countMarkers(edge.attributes.cubics || '');
    const rawGeometry = {
      line: markers.line + cubicMarkers.line,
      quadratic: markers.quadratic + cubicMarkers.quadratic,
      cubic: markers.cubicOpen + cubicMarkers.cubicOpen,
    };
    const decodedGeometry = {
      line: decoded.L || 0,
      quadratic: decoded.Q || 0,
      cubic: decoded.C || 0,
    };
    return {
      edgeIndex: edge.edgeIndex,
      rawGeometrySubsegmentCounts: rawGeometry,
      currentPandaDecodedGeometryCounts: decodedGeometry,
      exactDrawSubsegmentCountsMatch: Object.keys(rawGeometry).every(key => rawGeometry[key] === decodedGeometry[key]),
    };
  });
  const subsegmentsByEdge = new Map(subsegmentAudit.map(edge => [edge.edgeIndex,
    edge.currentPandaDecodedGeometryCounts.line +
      edge.currentPandaDecodedGeometryCounts.quadratic +
      edge.currentPandaDecodedGeometryCounts.cubic]));
  const sameFillInteriorEdges = fillEdges.filter(edge =>
    Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex &&
    Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex);
  const targetFillStyle1Edges = fillEdges.filter(edge =>
    Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex &&
    Number(edge.attributes.fillStyle0 || 0) !== TARGET.fillStyleIndex);
  const targetFillStyle0Edges = fillEdges.filter(edge =>
    Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex &&
    Number(edge.attributes.fillStyle1 || 0) !== TARGET.fillStyleIndex);
  const targetSharedFillEdges = fillEdges.filter(edge =>
    Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex &&
    Number(edge.attributes.fillStyle1 || 0) > 0 &&
    Number(edge.attributes.fillStyle1 || 0) !== TARGET.fillStyleIndex ||
    Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex &&
    Number(edge.attributes.fillStyle0 || 0) > 0 &&
    Number(edge.attributes.fillStyle0 || 0) !== TARGET.fillStyleIndex);
  const targetFillStyle1SegmentCount = targetFillStyle1Edges.reduce((sum, edge) => sum + (subsegmentsByEdge.get(edge.edgeIndex) || 0), 0);
  const targetFillStyle0SegmentCount = targetFillStyle0Edges.reduce((sum, edge) => sum + (subsegmentsByEdge.get(edge.edgeIndex) || 0), 0);
  const sameFillInteriorSubsegmentCount = sameFillInteriorEdges.reduce((sum, edge) => sum + (subsegmentsByEdge.get(edge.edgeIndex) || 0), 0);
  const targetStyleRuns = styleRuns.filter(run => run.fillStyle0 === TARGET.fillStyleIndex || run.fillStyle1 === TARGET.fillStyleIndex);
  const targetRunOrderPreserved = targetStyleRuns.every((run, index) => index === 0 ||
    targetStyleRuns[index - 1].edgeIndex < run.edgeIndex ||
    (targetStyleRuns[index - 1].edgeIndex === run.edgeIndex && targetStyleRuns[index - 1].commandStart <= run.commandStart));
  const fillGraph = graphReport(boundarySegments);
  const sourceOrderCycles = sourceOrderCycleDecomposition(boundarySegments);
  const targetBoundaryOrderPreserved = targetRunOrderPreserved &&
    [...new Set(targetStyleRuns.map(run => run.edgeIndex))].every((edgeIndex, index, edgeIndices) =>
      index === 0 || edgeIndices[index - 1] <= edgeIndex);

  const controlFillEdges = controlEdgeRecords.filter(edge =>
    Number(edge.attributes.fillStyle0 || 0) === CONTROL.fillStyleIndex ||
    Number(edge.attributes.fillStyle1 || 0) === CONTROL.fillStyleIndex);
  const controlSubsegmentAudit = controlFillEdges.map(edge => {
    const currentRuns = controlStyleRuns.filter(run => run.edgeIndex === edge.edgeIndex);
    const decoded = currentRuns.reduce((counts, run) => {
      for (const command of run.commands) counts[command.type] = (counts[command.type] || 0) + 1;
      return counts;
    }, {});
    const markers = countMarkers(edge.attributes.edges || '');
    const cubicMarkers = countMarkers(edge.attributes.cubics || '');
    const rawGeometry = {
      line: markers.line + cubicMarkers.line,
      quadratic: markers.quadratic + cubicMarkers.quadratic,
      cubic: markers.cubicOpen + cubicMarkers.cubicOpen,
    };
    const decodedGeometry = {
      line: decoded.L || 0,
      quadratic: decoded.Q || 0,
      cubic: decoded.C || 0,
    };
    return {
      edgeIndex: edge.edgeIndex,
      rawGeometrySubsegmentCounts: rawGeometry,
      currentPandaDecodedGeometryCounts: decodedGeometry,
      exactDrawSubsegmentCountsMatch: Object.keys(rawGeometry).every(key => rawGeometry[key] === decodedGeometry[key]),
    };
  });
  const controlFillGraph = graphReport(controlBoundarySegments);
  const controlSourceOrderCycles = sourceOrderCycleDecomposition(controlBoundarySegments);
  if (!controlFillGraph.balanced || controlFillGraph.imbalancedEndpoints.length !== 0 ||
      !controlFillGraph.endpoints.every(endpoint => endpoint.inDegree === 1 && endpoint.outDegree === 1)) {
    throw new Error('Naturally closed control fill boundary is no longer exactly balanced');
  }
  if (!controlSourceOrderCycles.ok || controlFillGraph.endpointCount === 0) {
    throw new Error('Naturally closed control no longer decomposes into exact source-order cycles');
  }
  const controlSubsegmentsPreserved = controlSubsegmentAudit.every(edge => edge.exactDrawSubsegmentCountsMatch);
  if (!controlSubsegmentsPreserved) throw new Error('Naturally closed control decoded draw subsegments do not match raw XFL markers');
  const sourceShaAfter = sha256(fs.readFileSync(sourcePath));
  if (sourceShaAfter !== sourceShaBefore) throw new Error('Frozen source bytes changed during read-only inspection');

  const receipt = {
    schemaVersion: 'issue736-xfl-panda-oracle/1',
    issue: 736,
    parentIssue: 733,
    historicalIssue: 693,
    source: {
      fileName: '黑衣修仙男.fla',
      sourceSha256Before: sourceShaBefore,
      sourceSha256After: sourceShaAfter,
      normalizedSourceSha256: normalizedSha256,
      recovery: {
        state: classification.state,
        field: normalized.field || null,
        deltaBytes: normalized.deltaBytes || 0,
        mode: normalized.mode || 'none',
        originalBytesWritten: false,
      },
    },
    selected: {
      priorIssue693TargetId: TARGET.renderTargetId,
      selectedFrameIndex: 0,
      sourceAddress,
      shapeId: TARGET.shapeId,
      shapeBlockSha256: sha256(Buffer.from(shapeXml, 'utf8')),
      fillStyleIndex: TARGET.fillStyleIndex,
      fillStyleXml: targetFill.xml,
      fullShapeEdgeCount: edgeRecords.length,
      targetFillEdgeRecordCount: fillEdges.length,
    },
    rawXfl: {
      shapeXml,
      edgeRecords: edgeRecords.map(edge => ({
        edgeIndex: edge.edgeIndex,
        fillStyle0: edge.attributes.fillStyle0 === undefined ? null : Number(edge.attributes.fillStyle0),
        fillStyle1: edge.attributes.fillStyle1 === undefined ? null : Number(edge.attributes.fillStyle1),
        strokeStyle: edge.attributes.strokeStyle === undefined ? null : Number(edge.attributes.strokeStyle),
        edges: edge.attributes.edges || null,
        cubics: edge.attributes.cubics || null,
        rawXml: edge.xml,
      })),
    },
    pandaCurrentInterpretation: {
      currentSceneCatalogSupported: targetEntry.previewSupported,
      currentSceneUnsupportedReason: targetEntry.unsupportedReason || null,
      currentRender: {
        ok: true,
        svgSha256: sha256(Buffer.from(rendered.svg, 'utf8')),
        composition: rendered.composition,
      },
      decodedStyleRuns: edgeRecords.map(edge => plainEdge(edge, styleRuns)),
      targetFillEdgeReferences: {
        fillStyle0: fillEdges.filter(edge => Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex).length,
        fillStyle1: fillEdges.filter(edge => Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex).length,
        bothSidesSameFill: fillEdges.filter(edge =>
          Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex &&
          Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex).length,
        skippedAsInteriorSameFillBoundary: fillEdges.filter(edge =>
          Number(edge.attributes.fillStyle0 || 0) === TARGET.fillStyleIndex &&
          Number(edge.attributes.fillStyle1 || 0) === TARGET.fillStyleIndex).map(edge => edge.edgeIndex),
      },
      interpretationAudit: {
        targetFillSubsegments: subsegmentAudit,
        allTargetFillDrawSubsegmentCountsMatch: subsegmentAudit.every(edge => edge.exactDrawSubsegmentCountsMatch),
        rawTargetFillDrawSubsegmentCount: subsegmentAudit.reduce((sum, edge) =>
          sum + edge.rawGeometrySubsegmentCounts.line + edge.rawGeometrySubsegmentCounts.quadratic + edge.rawGeometrySubsegmentCounts.cubic, 0),
        decodedTargetFillDrawSubsegmentCount: subsegmentAudit.reduce((sum, edge) =>
          sum + edge.currentPandaDecodedGeometryCounts.line + edge.currentPandaDecodedGeometryCounts.quadratic + edge.currentPandaDecodedGeometryCounts.cubic, 0),
        sameFillAggregation: {
          targetFillBoundarySegmentCount: boundarySegments.length,
          contributingSourceEdgeIndices: fillEdges.filter(edge => !sameFillInteriorEdges.includes(edge)).map(edge => edge.edgeIndex),
          targetFillStyleIsAggregatedAcrossSourceEdges: fillEdges.filter(edge => !sameFillInteriorEdges.includes(edge)).length > 1,
          boundarySegmentsEqualNonInteriorDecodedSubsegments: boundarySegments.length ===
            fillEdges.filter(edge => !sameFillInteriorEdges.includes(edge)).reduce((sum, edge) => sum + (subsegmentsByEdge.get(edge.edgeIndex) || 0), 0),
        },
        fillSideNormalization: {
          fillStyle1ForwardSegments: targetFillStyle1SegmentCount,
          fillStyle0ReversedSegments: targetFillStyle0SegmentCount,
          currentBuilderRule: 'fillStyle1 contributions retain Edge direction; fillStyle0 contributions reverse Edge direction',
          currentBuilderRuleSource: 'dist-electron/main/services/fla-static-snapshot-svg-builder.js :: reconstructFills/addBoundary',
        },
        sharedEdgeHandling: {
          differentFillStylesOnOppositeSides: targetSharedFillEdges.map(edge => ({
            edgeIndex: edge.edgeIndex,
            fillStyle0: Number(edge.attributes.fillStyle0),
            fillStyle1: Number(edge.attributes.fillStyle1),
            decodedSubsegmentCount: subsegmentsByEdge.get(edge.edgeIndex) || 0,
          })),
          currentBuilderRule: 'when fillStyle0 differs from fillStyle1, add each side under its own style; fillStyle1 is forward and fillStyle0 is reversed',
          sameFillOnBothSidesSkippedAsInterior: sameFillInteriorEdges.map(edge => ({
            edgeIndex: edge.edgeIndex,
            decodedSubsegmentCount: subsegmentsByEdge.get(edge.edgeIndex) || 0,
          })),
          sameFillInteriorSubsegmentCount,
        },
        authoredStyleRunOrderPreservedBySourceEdge: targetBoundaryOrderPreserved,
      },
      fillBoundarySegments: boundarySegments,
      endpointGraph: fillGraph,
      exactSourceOrderCycleDecomposition: sourceOrderCycles,
    },
    adobeAnimateJsfl: { status: 'NOT_RUN', reason: 'Adobe Animate is not installed or discoverable in the current Windows environment' },
    adobePublishedSwf: { status: 'NOT_RUN', reason: 'Publishing the frozen FLA through Adobe Animate is unavailable in the current Windows environment' },
    noOpControl: {
      status: 'XFL_AND_PANDA_CLOSED_CONTROL_CAPTURED_AWAITING_ADOBE_ORACLE',
      purpose: 'Known naturally closed same-source control for the selected #693 failure',
      selected: {
        sourceAddress: CONTROL.sourceAddress,
        shapeId: CONTROL.shapeId,
        shapeBlockSha256: CONTROL.shapeBlockSha256,
        fillStyleIndex: CONTROL.fillStyleIndex,
        fillStyleXml: controlFill.xml,
        fullShapeEdgeCount: controlEdgeRecords.length,
        targetFillEdgeRecordCount: controlFillEdges.length,
      },
      rawXfl: {
        shapeXml: controlShapeXml,
        edgeRecords: controlEdgeRecords.map(edge => ({
          edgeIndex: edge.edgeIndex,
          fillStyle0: edge.attributes.fillStyle0 === undefined ? null : Number(edge.attributes.fillStyle0),
          fillStyle1: edge.attributes.fillStyle1 === undefined ? null : Number(edge.attributes.fillStyle1),
          strokeStyle: edge.attributes.strokeStyle === undefined ? null : Number(edge.attributes.strokeStyle),
          edges: edge.attributes.edges || null,
          cubics: edge.attributes.cubics || null,
          rawXml: edge.xml,
        })),
      },
      pandaCurrentInterpretation: {
        renderOk: controlRendered.ok,
        svgSha256: sha256(Buffer.from(controlRendered.svg, 'utf8')),
        decodedStyleRuns: controlEdgeRecords.map(edge => plainEdge(edge, controlStyleRuns)),
        fillEdgeReferences: {
          fillStyle0: controlFillEdges.filter(edge => Number(edge.attributes.fillStyle0 || 0) === CONTROL.fillStyleIndex).length,
          fillStyle1: controlFillEdges.filter(edge => Number(edge.attributes.fillStyle1 || 0) === CONTROL.fillStyleIndex).length,
          bothSidesSameFill: controlFillEdges.filter(edge =>
            Number(edge.attributes.fillStyle0 || 0) === CONTROL.fillStyleIndex &&
            Number(edge.attributes.fillStyle1 || 0) === CONTROL.fillStyleIndex).length,
        },
        interpretationAudit: {
          allFillDrawSubsegmentCountsMatch: controlSubsegmentsPreserved,
          rawFillDrawSubsegmentCount: controlSubsegmentAudit.reduce((sum, edge) =>
            sum + edge.rawGeometrySubsegmentCounts.line + edge.rawGeometrySubsegmentCounts.quadratic + edge.rawGeometrySubsegmentCounts.cubic, 0),
          decodedFillDrawSubsegmentCount: controlSubsegmentAudit.reduce((sum, edge) =>
            sum + edge.currentPandaDecodedGeometryCounts.line + edge.currentPandaDecodedGeometryCounts.quadratic + edge.currentPandaDecodedGeometryCounts.cubic, 0),
          fillSubsegments: controlSubsegmentAudit,
          exactEndpointGraphIsOneInOneOut: controlFillGraph.endpoints.every(endpoint =>
            endpoint.inDegree === 1 && endpoint.outDegree === 1),
          noSyntheticClosureOrEndpointToleranceUsed: true,
        },
        fillBoundarySegments: controlBoundarySegments,
        endpointGraph: controlFillGraph,
        exactSourceOrderCycleDecomposition: controlSourceOrderCycles,
      },
      adobeAnimateJsfl: { status: 'NOT_RUN', reason: 'Adobe Animate is not installed or discoverable in the current Windows environment' },
      adobePublishedSwf: { status: 'NOT_RUN', reason: 'Publishing the frozen FLA through Adobe Animate is unavailable in the current Windows environment' },
    },
    conclusion: {
      status: 'XFL_AND_PANDA_WITH_CLOSED_CONTROL_CAPTURED_ADOBE_ORACLE_PENDING',
      finalAtoDClassification: null,
      productionImplementationGate: 'REMAIN_NO_GO_PENDING_ADOBE_ORACLE',
    },
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    sourceSha256: sourceShaAfter,
    normalizedSourceSha256: normalizedSha256,
    sourceAddress,
    shapeId: TARGET.shapeId,
    fillStyleIndex: TARGET.fillStyleIndex,
    fullShapeEdgeCount: edgeRecords.length,
    targetFillEdgeRecordCount: fillEdges.length,
    rawTargetFillDrawSubsegmentCount: subsegmentAudit.reduce((sum, edge) =>
      sum + edge.rawGeometrySubsegmentCounts.line + edge.rawGeometrySubsegmentCounts.quadratic + edge.rawGeometrySubsegmentCounts.cubic, 0),
    decodedTargetFillDrawSubsegmentCount: subsegmentAudit.reduce((sum, edge) =>
      sum + edge.currentPandaDecodedGeometryCounts.line + edge.currentPandaDecodedGeometryCounts.quadratic + edge.currentPandaDecodedGeometryCounts.cubic, 0),
    allTargetFillDrawSubsegmentCountsMatch: subsegmentAudit.every(edge => edge.exactDrawSubsegmentCountsMatch),
    currentRenderOk: rendered.ok,
    currentFillBoundarySegmentCount: boundarySegments.length,
    endpointCount: fillGraph.endpointCount,
    balanced: fillGraph.balanced,
    cycles: sourceOrderCycles.cycles.length,
    cycleDecompositionOk: sourceOrderCycles.ok,
    control: {
      sourceAddress: CONTROL.sourceAddress,
      shapeId: CONTROL.shapeId,
      edgeRecordCount: controlEdgeRecords.length,
      fillBoundarySegmentCount: controlBoundarySegments.length,
      endpointCount: controlFillGraph.endpointCount,
      allEndpointsOneInOneOut: controlFillGraph.endpoints.every(endpoint => endpoint.inDegree === 1 && endpoint.outDegree === 1),
      cycles: controlSourceOrderCycles.cycles.length,
      subsegmentsPreserved: controlSubsegmentsPreserved,
      renderOk: controlRendered.ok,
    },
    svgSha256: receipt.pandaCurrentInterpretation.currentRender.svgSha256,
    outputPath: args.out ? path.resolve(args.out) : null,
  }, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
