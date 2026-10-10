#!/usr/bin/env node
'use strict';

/**
 * Issue #717 — Stage B5-I, phase I0 (read-only Blue source-state census).
 *
 * I0 inspects one real FLA (蓝衣修仙男（补面需求）.fla) through the shared
 * production dist-electron seam and decides whether a SAFE_STATIC_REASSEMBLY
 * complete-character target exists for coherent reassembly.
 *
 * This phase is observation-only: it changes no production behavior, widens no
 * check, and repairs no source. It records, for every candidate state:
 *   - the source reference graph and full parent/nested chain;
 *   - authored vs held vs tween-interior frame structure;
 *   - nested playback/timing attributes;
 *   - source-authored transform components;
 *   - the production resolve + compose outcome (the exact blocker when blocked);
 * and classifies each candidate:
 *   SAFE_STATIC_REASSEMBLY | TEMPORAL_DEPENDENT | UNSUPPORTED_SEMANTIC |
 *   COMPONENT_ONLY | UNKNOWN
 *
 * All evidence is written outside the repository. The runner refuses to
 * overwrite existing evidence and never mutates the source FLA.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  for (const name of ['source', 'expectedSha256', 'out']) {
    assert.ok(args[name] !== undefined && args[name] !== '', `missing --${name}`);
  }
  assert.match(args.expectedSha256, /^[a-f0-9]{64}$/iu, '--expected-sha256 must be SHA-256 hex');
  return { ...args, source: path.resolve(args.source), out: path.resolve(args.out) };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative),
    'Issue #717 evidence must remain outside the repository');
}

async function writeExclusive(filePath, bytes) {
  const value = Buffer.from(bytes);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  assert.ok(!fs.existsSync(filePath), `refusing to overwrite existing evidence: ${filePath}`);
  await fs.promises.writeFile(filePath, value, { flag: 'wx' });
  return { file: path.basename(filePath), sha256: HASH(value), byteLength: value.length };
}

// ---------------------------------------------------------------------------
// Source load + production adapter
// ---------------------------------------------------------------------------

async function buildSource(bytes) {
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(bytes);
  let normalizedBytes = bytes;
  let normalization = { applied: false, mode: 'strict-source-bytes' };
  if (classification.state === 'RECOVERY_CANDIDATE') {
    const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
    assert.equal(normalized.applied, true, 'production recovery helper did not normalize the classified archive');
    assert.equal(normalized.originalBytesWritten, false, 'source normalization must remain in memory');
    normalizedBytes = Buffer.from(normalized.bytes);
    normalization = {
      applied: true,
      mode: normalized.mode,
      field: normalized.field,
      deltaBytes: normalized.deltaBytes,
      originalBytesWritten: normalized.originalBytesWritten,
      normalizedArchiveSha256: HASH(normalizedBytes),
    };
  } else {
    assert.equal(classification.state, 'STRICT_VALID', `source classifier failed closed: ${classification.state}`);
  }

  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(normalizedBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    libraries.push({ name, xml: await zip.file(name).async('string') });
  }
  const { adaptFlaXflDisplaySource } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the normalized archive');
  return { normalizedBytes, classification, normalization, documentXml, libraries, source: adapted.source };
}

function buildReferenceGraph(documentXml, libraries) {
  const refs = new Map();
  const add = (from, to) => {
    if (!refs.has(from)) refs.set(from, new Set());
    refs.get(from).add(to);
  };
  for (const { name, xml } of libraries) {
    const from = name.replace(/^LIBRARY\//u, '').replace(/\.xml$/u, '');
    for (const match of xml.matchAll(/<DOMSymbolInstance\b[^>]*libraryItemName="([^"]*)"/gu)) add(from, match[1]);
  }
  for (const match of documentXml.matchAll(/<DOMSymbolInstance\b[^>]*libraryItemName="([^"]*)"/gu)) add('(SCENE)', match[1]);
  const graph = {};
  for (const [from, to] of [...refs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    graph[from] = [...to].sort();
  }
  const referenced = new Set();
  for (const targets of refs.values()) for (const target of targets) referenced.add(target);
  return { graph, referenced };
}

// ---------------------------------------------------------------------------
// Candidate inspection
// ---------------------------------------------------------------------------

function transformOf(element) {
  const matrix = element?.localTransform;
  if (!matrix || typeof matrix !== 'object') return null;
  return ['a', 'b', 'c', 'd', 'tx', 'ty'].reduce((acc, key) => {
    const value = matrix[key];
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});
}

function nestedInstancesOfRoot(source, descriptor, frameIndex) {
  const context = descriptor.kind === 'scene'
    ? { ok: true, value: descriptor.frameContext }
    : source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, frameIndex, 'census');
  if (!context.ok) return { ok: false, message: context.message, instances: [] };
  const instances = [];
  for (const [layerIndex, layer] of context.value.layers.entries()) {
    for (const element of layer.elements) {
      if (element.kind !== 'symbol') continue;
      instances.push({
        layerIndex,
        visible: layer.visible,
        libraryItemName: element.libraryItemName,
        symbolType: element.symbolType,
        playbackMode: element.playbackMode ?? null,
        firstFrame: element.firstFrame ?? null,
        lastFrame: element.lastFrame ?? null,
        transform: transformOf(element),
      });
    }
  }
  return { ok: true, instances };
}

function frameSpanClassification(descriptor, frameIndex) {
  const layers = descriptor.frameSpanIndex?.layers ?? [];
  const active = [];
  for (const [layerIndex, layer] of layers.entries()) {
    const span = layer.spans.find((candidate) => frameIndex >= candidate.index && frameIndex < candidate.endExclusive);
    if (!span) continue;
    active.push({
      layerIndex,
      visible: layer.visible,
      spanIndex: span.index,
      duration: span.duration,
      tweenType: span.tweenType,
      startOfSpan: span.index === frameIndex,
    });
  }
  const tweenSpans = active.filter((span) => span.tweenType !== 'none');
  const interiorTween = tweenSpans.filter((span) => !span.startOfSpan);
  return {
    active,
    tweenSpanCount: tweenSpans.length,
    interiorTweenCount: interiorTween.length,
    classification: interiorTween.length > 0 ? 'TWEEN_INTERIOR' : (tweenSpans.length > 0 ? 'TWEEN_START_AUTHORED' : 'HELD_OR_AUTHORED'),
  };
}

function classifyRoot(source, name, kind) {
  const descriptor = kind === 'scene'
    ? source.sceneTimelines[0]
    : source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === name);
  assert.ok(descriptor, `root not found: ${name}`);

  const frameIndex = 0;
  const frameCount = kind === 'scene' ? source.sceneTimelines[0].frameCount : descriptor.frameCount;
  const timing = frameSpanClassification(
    kind === 'scene'
      ? { frameSpanIndex: { layers: source.sceneTimelines[0].frameSpanIndex?.layers ?? [] } }
      : descriptor,
    frameIndex,
  );
  const nested = nestedInstancesOfRoot(source, { ...descriptor, kind }, frameIndex);

  // Production resolve + compose.
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const frameContext = kind === 'scene'
    ? { ok: true, value: source.sceneTimelines[0].frameContext }
    : source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, frameIndex, 'census-compose');
  let resolveOutcome;
  let composeOutcome;
  if (!frameContext.ok) {
    resolveOutcome = { ok: false, message: frameContext.message };
    composeOutcome = { ok: false, code: 'FRAME_CONTEXT_FAILED', message: frameContext.message };
  } else {
    const resolved = resolveFlaDisplayList({
      root: { kind, name: kind === 'scene' ? source.sceneTimelines[0].name : name, frameContext: frameContext.value },
      symbols: source.symbols,
    });
    if (!resolved.ok) {
      resolveOutcome = { ok: false, message: resolved.message };
      composeOutcome = { ok: false, code: 'RESOLVE_FAILED', message: resolved.message };
    } else {
      resolveOutcome = { ok: true, resolvedNodeCount: resolved.displayList.resolvedNodeCount };
      const composed = buildSvgForResolvedDisplayList({
        displayList: resolved.displayList,
        renderTargetId: `issue717-census:${kind}:${name}`,
        stageWidth: source.stageWidth,
        stageHeight: source.stageHeight,
        shapeBlocks: source.shapeBlocks,
        resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
      });
      composeOutcome = composed.ok
        ? {
            ok: true,
            shapeCount: composed.composition.shapeCount,
            resolvedNodeCount: composed.composition.resolvedNodeCount,
            outputWidth: composed.composition.framing.outputWidth,
            outputHeight: composed.composition.framing.outputHeight,
          }
        : { ok: false, code: composed.code, message: composed.message };
    }
  }

  // Nested timing support verdict for the selected frame (default Loop, span start 0).
  const nestedTimingSupported = nested.ok && nested.instances.every((instance) => {
    const mode = (instance.playbackMode ?? '').trim().toLowerCase();
    return (mode === 'loop' || mode === 'play once' || mode === 'single frame')
      && instance.firstFrame === null && instance.lastFrame === null;
  });

  return {
    name,
    kind,
    frameIndex,
    frameCount,
    timing,
    nestedTimingSupported,
    nestedInstances: nested.ok ? nested.instances : [],
    nestedError: nested.ok ? null : nested.message,
    resolve: resolveOutcome,
    compose: composeOutcome,
  };
}

function classifyCandidate(candidate, isCompleteCharacterRoot) {
  if (!candidate.compose.ok) {
    const message = candidate.compose.message || '';
    const family = /open fill boundary/u.test(message) ? 'SHAPE_FILL_TOPOLOGY'
      : /gradient matrix/u.test(message) ? 'GRADIENT_MATRIX'
        : /ambiguous fill topology/u.test(message) ? 'SHAPE_FILL_TOPOLOGY'
          : 'OTHER';
    return { classification: 'UNSUPPORTED_SEMANTIC', blockerFamily: family };
  }
  if (!isCompleteCharacterRoot) return { classification: 'COMPONENT_ONLY', blockerFamily: null };
  if (!candidate.nestedTimingSupported) return { classification: 'TEMPORAL_DEPENDENT', blockerFamily: 'NESTED_GRAPHIC_TIMING' };
  return { classification: 'SAFE_STATIC_REASSEMBLY', blockerFamily: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(args) {
  assertExternalDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });

  const originalBytes = await fs.promises.readFile(args.source);
  const originalSha256 = HASH(originalBytes);
  assert.equal(originalSha256, args.expectedSha256.toLowerCase(), 'source bytes do not match the expected SHA-256');

  const loaded = await buildSource(originalBytes);
  const source = loaded.source;
  const { graph, referenced } = buildReferenceGraph(loaded.documentXml, loaded.libraries);

  const sceneRoots = new Set((graph['(SCENE)'] ?? []));
  const candidates = [];
  candidates.push(classifyRoot(source, '(SCENE)', 'scene'));
  for (const symbol of source.graphicSymbols) {
    candidates.push(classifyRoot(source, symbol.sourceLibraryItemName, 'graphic'));
  }

  for (const candidate of candidates) {
    const isCompleteRoot = candidate.kind === 'scene' || sceneRoots.has(candidate.name);
    const verdict = classifyCandidate(candidate, isCompleteRoot);
    candidate.isCompleteCharacterRoot = isCompleteRoot;
    candidate.classification = verdict.classification;
    candidate.blockerFamily = verdict.blockerFamily;
  }

  const componentCandidates = candidates.filter((candidate) => candidate.classification === 'COMPONENT_ONLY');
  const completeRoots = candidates.filter((candidate) => candidate.isCompleteCharacterRoot);
  const safeCompleteRoots = completeRoots.filter((candidate) => candidate.classification === 'SAFE_STATIC_REASSEMBLY');

  const selection = safeCompleteRoots.length > 0
    ? {
        result: 'SELECTED',
        primaryTarget: safeCompleteRoots[0].name,
        reason: null,
      }
    : {
        result: 'BLOCKED',
        primaryTarget: null,
        reason: 'NO_SAFE_STATIC_COMPLETE_STATE',
      };

  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, originalSha256, 'source FLA changed during census');

  const report = {
    schemaVersion: 'issue717-blue-reassembly-census/1',
    issue: 717,
    phase: 'I0',
    generatedNote: 'research-only; no production behavior changed; no source mutation',
    source: {
      path: args.source,
      originalSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariance: originalSha256 === sourceSha256After,
      classifierState: loaded.classification.state,
      normalization: loaded.normalization,
      stage: { width: source.stageWidth, height: source.stageHeight },
      librarySymbolCount: source.graphicSymbols.length,
      sceneTimelineCount: source.sceneTimelines.length,
    },
    referenceGraph: graph,
    sceneRoots: [...sceneRoots].sort(),
    orphanSymbols: source.graphicSymbols
      .map((symbol) => symbol.sourceLibraryItemName)
      .filter((name) => !referenced.has(name)),
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      kind: candidate.kind,
      isCompleteCharacterRoot: candidate.isCompleteCharacterRoot,
      frameIndex: candidate.frameIndex,
      frameCount: candidate.frameCount,
      timing: candidate.timing,
      nestedTimingSupported: candidate.nestedTimingSupported,
      nestedInstanceCount: candidate.nestedInstances.length,
      nestedInstances: candidate.nestedInstances,
      resolve: candidate.resolve,
      compose: candidate.compose,
      classification: candidate.classification,
      blockerFamily: candidate.blockerFamily,
    })),
    summary: {
      candidateCount: candidates.length,
      completeCharacterRootCount: completeRoots.length,
      safeStaticCompleteRootCount: safeCompleteRoots.length,
      componentOnlyCount: componentCandidates.length,
      unsupportedSemanticCount: candidates.filter((candidate) => candidate.classification === 'UNSUPPORTED_SEMANTIC').length,
      temporalDependentCount: candidates.filter((candidate) => candidate.classification === 'TEMPORAL_DEPENDENT').length,
      blockerFamilyCounts: candidates.reduce((acc, candidate) => {
        if (candidate.blockerFamily) acc[candidate.blockerFamily] = (acc[candidate.blockerFamily] ?? 0) + 1;
        return acc;
      }, {}),
    },
    selection,
    productionChanges: 'NONE',
    sourceMutation: 'NO',
    tweenInterpolationAdded: 'NO',
    movieClipRuntimeAdded: 'NO',
    actionScriptAdded: 'NO',
    productUiAdded: 'NO',
  };

  const artifacts = [];
  artifacts.push(await writeExclusive(path.join(args.out, 'i0-census.json'), `${JSON.stringify(report, null, 2)}\n`));

  const receiptLines = [
    'Issue #717 Stage B5-I Coherent Character Reassembly — I0 census receipt',
    `source: ${args.source}`,
    `sha256 before: ${originalSha256}`,
    `sha256 after:  ${sourceSha256After}`,
    `source mutation: NO`,
    '',
    `candidates: ${report.summary.candidateCount}`,
    `complete-character roots: ${report.summary.completeCharacterRootCount} (${[...sceneRoots].sort().join(', ') || 'none'})`,
    `safe static complete roots: ${report.summary.safeStaticCompleteRootCount}`,
    `component-only: ${report.summary.componentOnlyCount}`,
    `unsupported-semantic: ${report.summary.unsupportedSemanticCount}`,
    `temporal-dependent: ${report.summary.temporalDependentCount}`,
    `blocker families: ${JSON.stringify(report.summary.blockerFamilyCounts)}`,
    '',
    ...completeRoots.map((candidate) => `root ${candidate.name}: ${candidate.classification}` +
      (candidate.compose.ok ? '' : ` [${candidate.compose.code}] ${candidate.compose.message}`)),
    '',
    `I0 selection: ${selection.result}${selection.reason ? ' — ' + selection.reason : ''}`,
    `primary target: ${selection.primaryTarget ?? '(none)'}`,
    '',
    'production changes: NONE',
    'I1..I5: NOT_STARTED',
  ];
  artifacts.push(await writeExclusive(path.join(args.out, 'completion-receipt.txt'), receiptLines.join('\n') + '\n'));
  artifacts.push(await writeExclusive(path.join(args.out, 'completion-receipt.json'), `${JSON.stringify({
    schemaVersion: 'issue717-i0-receipt/1',
    source: { path: args.source, sha256Before: originalSha256, sha256After: sourceSha256After, sourceMutation: 'NO' },
    summary: report.summary,
    selection,
    gate: 'H0..I0 complete; I1 NOT_STARTED',
    artifacts,
  }, null, 2)}\n`));

  process.stdout.write(JSON.stringify({ ...report.summary, selection, artifacts }, null, 2) + '\n');
}

const args = parseArgs(process.argv.slice(2));
run(args).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
