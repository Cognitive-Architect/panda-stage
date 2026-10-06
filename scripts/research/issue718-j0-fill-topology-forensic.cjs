#!/usr/bin/env node
'use strict';

/**
 * Issue #718 — Stage B5-J, phase J0 (research-only shape fill-topology forensic census).
 *
 * J0 inspects the exact vector-Shape records that blocked #717 and answers, per
 * failing shape: why the current fill reconstruction cannot close the contour.
 *
 * Contract (from the Issue):
 *   - research only, no production change, no source mutation;
 *   - evidence written outside the repository; refuse to overwrite; deterministic;
 *   - never auto-close an arbitrary contour; no invented connector geometry;
 *   - classify each failure as exactly one of
 *     MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED | CURRENT_IMPLEMENTATION_BUG |
 *     MALFORMED_SOURCE | AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH | UNKNOWN.
 *
 * The runner:
 *   1. reuses only the shared production `dist-electron` seam to load the source,
 *      resolve roots, and obtain the production per-shape compose verdict via a
 *      synthetic single-shape display list;
 *   2. independently mirrors the production edge decoder + fill-boundary builder
 *      to expose the exact open-boundary topology (segments, degrees, components,
 *      endpoints, orientation, shared/duplicated edges);
 *   3. asserts parity: the mirror verdict must equal the production verdict for
 *      every shape block in the fixture;
 *   4. evaluates bounded in-memory counterfactual rules and answers, for each:
 *      what source fact authorizes it / invented geometry YES-NO / accepted real
 *      controls regress YES-NO.
 *
 * Issue #719 corrective — classification semantics only (census data unchanged):
 *   C1. the gradient failure must use a frozen J0 enum value, never a workflow
 *       destination. It is now UNKNOWN, with deferredTo: "J3" as metadata only.
 *   C2. mixed topology is decided by conservative semantic precedence, never by a
 *       numerical majority vote:
 *         any unresolved open-chain ambiguity -> AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH
 *         else any non-manifold branch junction -> MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED
 *         else -> UNKNOWN
 *       Sub-reason counts (openChains / branchJunctions) are retained separately.
 *   C4. the J0 gate is recomputed from the rule sweep, never hard-coded.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--expected-sha256') args.expectedSha256 = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--control') {
      const [label, file, sha] = (argv[++index] ?? '').split('|');
      (args.controls ??= []).push({ label, file, sha });
    }
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
    'Issue #718 evidence must remain outside the repository');
}

async function writeExclusive(filePath, bytes) {
  const value = Buffer.from(bytes);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  assert.ok(!fs.existsSync(filePath), `refusing to overwrite existing evidence: ${filePath}`);
  await fs.promises.writeFile(filePath, value, { flag: 'wx' });
  return { file: path.basename(filePath), sha256: HASH(value), byteLength: value.length };
}

// ---------------------------------------------------------------------------
// Production seam (same contract as issue #717 buildSource)
// ---------------------------------------------------------------------------

async function loadSourceFromBytes(bytes) {
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(bytes);
  let normalizedBytes = bytes;
  let normalization = { applied: false, mode: 'strict-source-bytes' };
  if (classification.state === 'RECOVERY_CANDIDATE') {
    const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
    assert.equal(normalized.applied, true, 'recovery helper did not normalize the classified archive');
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
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected the archive');
  return { normalizedBytes, classification, normalization, documentXml, libraries, source: adapted.source };
}

function composeProduction(source, name, kind) {
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const descriptor = kind === 'scene'
    ? source.sceneTimelines[0]
    : source.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === name);
  if (!descriptor) return { ok: false, code: 'MISSING_ROOT', message: `root not found: ${name}` };
  const frameContext = kind === 'scene'
    ? { ok: true, value: source.sceneTimelines[0].frameContext }
    : source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, 0, 'census-compose');
  if (!frameContext.ok) return { ok: false, code: 'FRAME_CONTEXT_FAILED', message: frameContext.message };
  const resolved = resolveFlaDisplayList({
    root: { kind, name: kind === 'scene' ? descriptor.name : name, frameContext: frameContext.value },
    symbols: source.symbols,
  });
  if (!resolved.ok) return { ok: false, code: 'RESOLVE_FAILED', message: resolved.message };
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: `issue718-j0:${kind}:${name}`,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  return composed.ok
    ? { ok: true, shapeCount: composed.composition.shapeCount }
    : { ok: false, code: composed.code, message: composed.message };
}

const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** Production verdict for exactly one shape block, via a synthetic display list. */
function composeSingleShape(source, shapeId, blocks) {
  const { buildSvgForResolvedDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  const displayList = {
    kind: 'graphic',
    sourceName: shapeId,
    frameIndex: 0,
    layers: [{ name: 'j0', children: [{ kind: 'shape', shapeId, worldTransform: IDENTITY_MATRIX }] }],
    resolvedNodeCount: 1,
  };
  const composed = buildSvgForResolvedDisplayList({
    displayList,
    renderTargetId: `issue718-j0:shape:${shapeId}`,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: blocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  return composed.ok
    ? { ok: true, shapeCount: composed.composition.shapeCount }
    : { ok: false, code: composed.code, message: composed.message };
}

// ---------------------------------------------------------------------------
// Mirror of the production shape decoder + fill-boundary builder
// (copied verbatim from src/main/services/fla-static-snapshot-svg-builder.ts at
//  the baseline head; used only to expose topology the production builder
//  collapses into a single fail-closed message.)
// ---------------------------------------------------------------------------

const COORD_SCALE = 20;
const MAX_PATH_COMMANDS_PER_SHAPE = 1_000_000;
const MAX_STYLE_ENTRIES_PER_SHAPE = 4_096;
const MAX_STYLE_RUNS_PER_SHAPE = 16_384;

function nextTagIndex(xml, tag, from) {
  const needle = '<' + tag;
  let i = from;
  for (;;) {
    const idx = xml.indexOf(needle, i);
    if (idx === -1) return -1;
    if (idx === 0 || xml[idx - 1] !== '/') return idx;
    i = idx + needle.length;
  }
}

function extractBalancedBlocks(xml, tag) {
  const close = '</' + tag + '>';
  const blocks = [];
  const openStack = [];
  let i = 0;
  for (;;) {
    const oi = nextTagIndex(xml, tag, i);
    const ci = xml.indexOf(close, i);
    if (oi === -1 && ci === -1) break;
    if (ci !== -1 && (oi === -1 || ci < oi)) {
      const start = openStack.pop();
      if (start !== undefined) blocks.push(xml.slice(start, ci + close.length));
      i = ci + close.length;
    } else if (oi !== -1) {
      openStack.push(oi);
      i = oi + tag.length + 1;
    } else break;
  }
  return blocks;
}

function extractSelfClosingTags(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*\\/>`, 'g');
  return xml.match(re) ?? [];
}

function decodeCoord(value) {
  if (value.startsWith('#')) {
    const hex = value.substring(1);
    const dotIndex = hex.indexOf('.');
    let intHex;
    let fracHex = null;
    if (dotIndex !== -1) {
      intHex = hex.substring(0, dotIndex);
      fracHex = hex.substring(dotIndex + 1);
    } else intHex = hex;
    if (intHex.length === 0) intHex = '0';
    const intPart = parseInt(intHex, 16);
    if (Number.isNaN(intPart)) return NaN;
    const numChars = intHex.length;
    let signed = intPart;
    if (numChars >= 6) {
      const bitWidth = numChars * 4;
      const signBit = 1 << (bitWidth - 1);
      if (signed >= signBit) signed = signed - (1 << bitWidth);
    }
    let fracPart = 0;
    if (fracHex && fracHex.length > 0) {
      const fracValue = parseInt(fracHex, 16);
      if (!Number.isNaN(fracValue)) {
        const fracBits = fracHex.length * 4;
        fracPart = fracValue / (1 << fracBits);
      }
    }
    return (signed >= 0 ? signed + fracPart : signed - fracPart) / COORD_SCALE;
  }
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return NaN;
  return parsed / COORD_SCALE;
}

function tokenize(edgeStr) {
  const tokens = [];
  let current = '';
  let i = 0;
  const isCommandChar = (c) => c === '!' || c === '|' || c === '[' || c === '/' || c === 'S' || c === 'q' || c === 'Q';
  while (i < edgeStr.length) {
    const char = edgeStr[i];
    if (char === '(' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('(;'); current = ''; i += 2; continue;
    }
    if (char === ')' && i + 1 < edgeStr.length && edgeStr[i + 1] === ';') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(');'); current = ''; i += 2; continue;
    }
    if (char === '(') { if (current.trim()) tokens.push(current.trim()); tokens.push('('); current = ''; i++; continue; }
    if (char === ')') { if (current.trim()) tokens.push(current.trim()); tokens.push(')'); current = ''; i++; continue; }
    if (char === ';') { if (current.trim()) tokens.push(current.trim()); tokens.push(';'); current = ''; i++; continue; }
    if (isCommandChar(char)) { if (current.trim()) tokens.push(current.trim()); tokens.push(char); current = ''; i++; continue; }
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') { if (current.trim()) tokens.push(current.trim()); current = ''; i++; continue; }
    if (char === ',') { if (current.trim()) tokens.push(current.trim()); current = ''; i++; continue; }
    current += char; i++;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function decodeEdgesWithStyleChanges(edgeStr) {
  const commands = [];
  const styleChanges = [];
  let error = null;
  const pushCommand = (command) => {
    if (commands.length >= MAX_PATH_COMMANDS_PER_SHAPE) { error ??= 'Shape path-command budget exceeded'; return; }
    commands.push(command);
  };
  const tokens = tokenize(edgeStr);
  let i = 0;
  let currentX = NaN;
  let currentY = NaN;
  let startX = NaN;
  let startY = NaN;
  const MAX_COORD = 200_000;
  while (i < tokens.length && !error) {
    const token = tokens[i];
    switch (token) {
      case '!': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1]);
          const y = decodeCoord(tokens[i + 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          if (Number.isNaN(currentX) || Number.isNaN(startX) || x !== currentX || y !== currentY) {
            pushCommand({ type: 'M', x, y }); startX = x; startY = y;
          }
          currentX = x; currentY = y; i += 3;
        } else i++;
        break;
      }
      case '|': {
        if (i + 2 < tokens.length) {
          const x = decodeCoord(tokens[i + 1]);
          const y = decodeCoord(tokens[i + 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) { i += 3; break; }
          if (!Number.isNaN(currentX) && (x !== currentX || y !== currentY)) { pushCommand({ type: 'L', x, y }); currentX = x; currentY = y; }
          i += 3;
        } else i++;
        break;
      }
      case '[': {
        if (i + 4 < tokens.length) {
          const cx = decodeCoord(tokens[i + 1]);
          const cy = decodeCoord(tokens[i + 2]);
          const x = decodeCoord(tokens[i + 3]);
          const y = decodeCoord(tokens[i + 4]);
          if (![cx, cy, x, y].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORD)) { i += 5; break; }
          pushCommand({ type: 'Q', cx, cy, x, y }); currentX = x; currentY = y; i += 5;
        } else i++;
        break;
      }
      case '(;':
      case '(': {
        if (tokens[i] === '(') { i++; while (i < tokens.length && tokens[i] !== ';') i++; if (i < tokens.length && tokens[i] === ';') i++; }
        else i++;
        while (i < tokens.length && !error && tokens[i] !== 'q' && tokens[i] !== 'Q' && tokens[i] !== ');' && tokens[i] !== ')') {
          if (i + 5 < tokens.length) {
            const next = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3], tokens[i + 4], tokens[i + 5]];
            const allCoords = next.every((t) => !['!', '|', '[', '/', 'S', 'q', 'Q', '(;', ');', '(', ')', ';'].includes(t));
            if (allCoords) {
              const vals = next.map((t) => decodeCoord(t));
              if (vals.some((c) => !Number.isFinite(c) || Math.abs(c) > MAX_COORD)) { i += 6; continue; }
              pushCommand({ type: 'C', c1x: vals[0], c1y: vals[1], c2x: vals[2], c2y: vals[3], x: vals[4], y: vals[5] });
              currentX = vals[4]; currentY = vals[5]; i += 6;
            } else break;
          } else break;
        }
        break;
      }
      case ';': i++; break;
      case 'q':
      case 'Q': { i++; while (i < tokens.length && !error && tokens[i] !== ');' && tokens[i] !== ')' && tokens[i] !== '!' && tokens[i] !== '|' && tokens[i] !== '[') i++; break; }
      case ');':
      case ')': i++; break;
      case 'S': {
        if (i + 1 < tokens.length) {
          const selectionToken = tokens[i + 1];
          if (!/^\d+$/u.test(selectionToken)) { error ??= 'Malformed mid-edge selection marker'; i += 2; break; }
          const selectionMask = Number(selectionToken);
          if (!Number.isSafeInteger(selectionMask) || selectionMask < 1 || selectionMask > 7) {
            error ??= selectionMask === 0 ? 'Unsupported S0 edge marker' : 'Unsupported mid-edge selection marker'; i += 2; break;
          }
          i += 2;
        } else { error ??= 'Malformed mid-edge selection marker'; i++; }
        break;
      }
      case '/': {
        pushCommand({ type: 'Z' });
        if (!Number.isNaN(startX) && !Number.isNaN(startY)) { currentX = startX; currentY = startY; }
        startX = NaN; startY = NaN; i++;
        break;
      }
      default: i++;
    }
  }
  if (!error && currentX === startX && currentY === startY) {
    const last = commands[commands.length - 1];
    if (last && last.type !== 'Z') pushCommand({ type: 'Z' });
  }
  return { commands, styleChanges, error };
}

function attributeFromElement(block, tag, attribute) {
  const openTag = block.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
  if (!openTag) return null;
  return openTag.match(new RegExp(`\\b${attribute}="([^"]*)"`))?.[1] ?? null;
}

function parseNonNegativeInteger(value) {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseShapeStyle(block, tag) {
  const rawIndex = attributeFromElement(block, tag, 'index');
  const index = rawIndex === null ? 1 : parseNonNegativeInteger(rawIndex);
  if (index === null) return { code: 'RENDER_FAILED', message: `Malformed ${tag} index` };
  const explicitType = attributeFromElement(block, tag, 'type');
  const type = explicitType ?? (
    /<RadialGradient\b/u.test(block) ? 'radial'
      : /<LinearGradient\b/u.test(block) ? 'linear'
        : /<(?:BitmapFill|ClippedBitmapFill)\b/u.test(block) ? 'bitmap'
          : 'solid');
  const colorBlock = block.match(/<(?:SolidColor|GradientEntry)\b[^>]*>/u)?.[0];
  const rawColor = colorBlock?.match(/\bcolor="([^"]*)"/u)?.[1] ?? null;
  const color = rawColor === null && tag === 'FillStyle' && type === 'solid' && /<SolidColor\b/u.test(block) ? '#000000' : rawColor;
  const rawAlpha = colorBlock?.match(/\balpha="([^"]*)"/u)?.[1] ?? null;
  const parsedAlpha = rawAlpha === null ? null : Number(rawAlpha);
  return { index, type, color, alpha: parsedAlpha !== null && Number.isFinite(parsedAlpha) ? parsedAlpha : null, sourceXml: block };
}

function parseShapeAt(block) {
  const fillStyles = [];
  const strokeStyles = [];
  const edgeStrings = [];
  let issue = null;
  let matrix = null;
  const result = () => ({ matrix, fillStyles, strokeStyles, edgeStrings, issue });
  const matrixBlock = extractBalancedBlocks(block, 'matrix')[0];
  if (matrixBlock) {
    const m = matrixBlock.match(/<Matrix\b([^/>]*)\/?>/);
    if (m) {
      const attrs = m[1];
      const get = (k) => { const x = attrs.match(new RegExp('\\b' + k + '="([^"]*)"')); return x ? Number(x[1]) : 0; };
      matrix = { a: get('a'), b: get('b'), c: get('c'), d: get('d'), tx: get('tx'), ty: get('ty') };
    }
  }
  const fillsBlock = extractBalancedBlocks(block, 'fills')[0];
  if (fillsBlock) {
    const blocks = extractBalancedBlocks(fillsBlock, 'FillStyle');
    if (blocks.length > MAX_STYLE_ENTRIES_PER_SHAPE) { issue = { code: 'BUDGET_EXCEEDED', message: 'Shape fill-style entry budget exceeded' }; return result(); }
    for (const styleBlock of blocks) {
      const style = parseShapeStyle(styleBlock, 'FillStyle');
      if ('code' in style) { issue = style; return result(); }
      if (fillStyles.some((entry) => entry.index === style.index)) { issue = { code: 'RENDER_FAILED', message: `Duplicate FillStyle index: ${style.index}` }; return result(); }
      fillStyles.push(style);
    }
  }
  const strokesBlock = extractBalancedBlocks(block, 'strokes')[0];
  if (strokesBlock) {
    const blocks = extractBalancedBlocks(strokesBlock, 'StrokeStyle');
    if (blocks.length > MAX_STYLE_ENTRIES_PER_SHAPE) { issue = { code: 'BUDGET_EXCEEDED', message: 'Shape stroke-style entry budget exceeded' }; return result(); }
    for (const styleBlock of blocks) {
      const style = parseShapeStyle(styleBlock, 'StrokeStyle');
      if ('code' in style) { issue = style; return result(); }
      if (strokeStyles.some((entry) => entry.index === style.index)) { issue = { code: 'RENDER_FAILED', message: `Duplicate StrokeStyle index: ${style.index}` }; return result(); }
      strokeStyles.push(style);
    }
  }
  if (fillStyles.length + strokeStyles.length > MAX_STYLE_ENTRIES_PER_SHAPE) { issue = { code: 'BUDGET_EXCEEDED', message: 'Shape style-entry budget exceeded' }; return result(); }
  const edgesBlock = extractBalancedBlocks(block, 'edges')[0];
  if (edgesBlock) {
    for (const eb of extractSelfClosingTags(edgesBlock, 'Edge')) {
      const cubics = ((eb.match(/\bcubics="([^"]*)"/) ?? ['', ''])[1]);
      const edges = ((eb.match(/\bedges="([^"]*)"/) ?? ['', ''])[1]);
      const refs = { fillStyle0: null, fillStyle1: null, strokeStyle: null };
      for (const name of ['fillStyle0', 'fillStyle1', 'strokeStyle']) {
        const raw = attributeFromElement(eb, 'Edge', name);
        if (raw === null) continue;
        const parsed = parseNonNegativeInteger(raw);
        if (parsed === null) { issue = { code: 'RENDER_FAILED', message: `Malformed Edge ${name} reference` }; return result(); }
        refs[name] = parsed === 0 ? null : parsed;
      }
      edgeStrings.push({ cubics, edges, ...refs });
    }
  }
  return result();
}

function buildStyleRuns(shape, shapeId) {
  if (shape.issue) return { ok: false, code: shape.issue.code, message: `Shape ${shapeId}: ${shape.issue.message}` };
  const fillStyles = new Map(shape.fillStyles.map((style) => [style.index, style]));
  const strokeStyles = new Map(shape.strokeStyles.map((style) => [style.index, style]));
  const commands = [];
  const styleRuns = [];
  const edgeReferences = [];
  for (let edgeIndex = 0; edgeIndex < shape.edgeStrings.length; edgeIndex += 1) {
    const edge = shape.edgeStrings[edgeIndex];
    if (!edge) continue;
    edgeReferences.push({ fillStyle0: edge.fillStyle0, fillStyle1: edge.fillStyle1, strokeStyle: edge.strokeStyle });
    for (const [name, index, styles] of [['fillStyle0', edge.fillStyle0, fillStyles], ['fillStyle1', edge.fillStyle1, fillStyles], ['strokeStyle', edge.strokeStyle, strokeStyles]]) {
      if (index !== null && !styles.has(index)) {
        return { ok: false, code: 'RENDER_FAILED', message: `Shape ${shapeId} Edge ${edgeIndex} references missing ${name} ${index}` };
      }
    }
    const decoded = decodeEdgesWithStyleChanges(edge.cubics || edge.edges);
    if (decoded.error) return { ok: false, code: 'RENDER_FAILED', message: `Shape ${shapeId}: ${decoded.error}` };
    const commandOffset = commands.length;
    commands.push(...decoded.commands);
    const appendRun = (start, end) => {
      if (end <= start) return;
      if (styleRuns.length >= MAX_STYLE_RUNS_PER_SHAPE) return;
      styleRuns.push({
        edgeIndex,
        commandStart: commandOffset + start,
        commandEnd: commandOffset + end,
        commands: decoded.commands.slice(start, end),
        fillStyle0: edge.fillStyle0,
        fillStyle1: edge.fillStyle1,
        strokeStyle: edge.strokeStyle,
      });
    };
    // Mid-edge style changes are never produced by the current decoder
    // (decoded.styleChanges is always empty); one run per edge.
    appendRun(0, decoded.commands.length);
  }
  return { ok: true, representation: { fillStyles: shape.fillStyles, strokeStyles: shape.strokeStyles, edgeReferences, commands, styleRuns } };
}

function pointKey(point) {
  const part = (value) => (Object.is(value, -0) ? '0' : value.toString());
  return `${part(point.x)},${part(point.y)}`;
}

function reverseFillDrawCommand(command, start) {
  switch (command.type) {
    case 'L': return { type: 'L', x: start.x, y: start.y };
    case 'Q': return { type: 'Q', cx: command.cx, cy: command.cy, x: start.x, y: start.y };
    case 'C': return { type: 'C', c1x: command.c2x, c1y: command.c2y, c2x: command.c1x, c2y: command.c1y, x: start.x, y: start.y };
  }
}

function commandStartAngle(segment) {
  const { from, to, command } = segment;
  const vectors = command.type === 'Q'
    ? [{ x: command.cx - from.x, y: command.cy - from.y }, { x: to.x - from.x, y: to.y - from.y }]
    : command.type === 'C'
      ? [{ x: command.c1x - from.x, y: command.c1y - from.y }, { x: command.c2x - from.x, y: command.c2y - from.y }, { x: to.x - from.x, y: to.y - from.y }]
      : [{ x: to.x - from.x, y: to.y - from.y }];
  const vector = vectors.find((candidate) => candidate.x !== 0 || candidate.y !== 0);
  return vector ? Math.atan2(vector.y, vector.x) : Number.NaN;
}

function commandEndAngle(segment) {
  const { from, to, command } = segment;
  const vectors = command.type === 'Q'
    ? [{ x: to.x - command.cx, y: to.y - command.cy }, { x: to.x - from.x, y: to.y - from.y }]
    : command.type === 'C'
      ? [{ x: to.x - command.c2x, y: to.y - command.c2y }, { x: to.x - command.c1x, y: to.y - command.c1y }, { x: to.x - from.x, y: to.y - from.y }]
      : [{ x: to.x - from.x, y: to.y - from.y }];
  const vector = vectors.find((candidate) => candidate.x !== 0 || candidate.y !== 0);
  return vector ? Math.atan2(vector.y, vector.x) : Number.NaN;
}

function nextFillBoundarySegment(incoming, candidates) {
  if (candidates.length === 1) return candidates[0] ?? null;
  const endAngle = commandEndAngle(incoming);
  if (!Number.isFinite(endAngle)) return null;
  const reverseAngle = endAngle + Math.PI;
  const ranked = candidates.map((candidate) => {
    const angle = commandStartAngle(candidate);
    if (!Number.isFinite(angle)) return { candidate, delta: Number.NaN };
    let delta = reverseAngle - angle;
    while (delta <= 1e-9) delta += Math.PI * 2;
    while (delta > Math.PI * 2) delta -= Math.PI * 2;
    return { candidate, delta };
  }).sort((left, right) => left.delta - right.delta || left.candidate.order - right.candidate.order);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || !Number.isFinite(first.delta) || (second && Math.abs(first.delta - second.delta) <= 1e-9)) return null;
  return first.candidate;
}

/** Build the per-fill-style oriented segment sets exactly as production does. */
function buildFillBoundaries(representation) {
  const boundaryByStyle = new Map();
  const styleErrors = new Map();
  const skippedSameStyleEdges = [];
  let segmentCount = 0;
  let nextOrder = 0;
  let currentEdgeIndex = -1;
  let current = null;
  let subpathStart = null;
  const addBoundary = (fillStyleIndex, from, to, command, reverse) => {
    if (segmentCount >= MAX_PATH_COMMANDS_PER_SHAPE * 2) { styleErrors.set(fillStyleIndex, 'BUDGET_EXCEEDED'); return; }
    const styleSegments = boundaryByStyle.get(fillStyleIndex) ?? [];
    const orientedFrom = reverse ? to : from;
    const orientedTo = reverse ? from : to;
    const orientedCommand = reverse ? reverseFillDrawCommand(command, from) : command;
    styleSegments.push({ from: orientedFrom, to: orientedTo, command: orientedCommand, order: nextOrder });
    boundaryByStyle.set(fillStyleIndex, styleSegments);
    segmentCount += 1; nextOrder += 1;
  };
  for (const run of representation.styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) { currentEdgeIndex = run.edgeIndex; current = null; subpathStart = null; }
    if (run.fillStyle0 !== null && run.fillStyle0 === run.fillStyle1) {
      const pointOf = (command) => command.type === 'M' || command.type === 'L' ? { x: command.x, y: command.y }
        : command.type === 'Q' ? { x: command.x, y: command.y } : { x: command.x, y: command.y };
      const points = run.commands.filter((command) => command.type !== 'Z').map(pointOf);
      const drawnEdges = [];
      let previous = null;
      let subStart = null;
      for (const command of run.commands) {
        if (command.type === 'M') { previous = { x: command.x, y: command.y }; subStart = previous; continue; }
        if (command.type === 'Z') { previous = subStart; continue; }
        const to = pointOf(command);
        if (previous) drawnEdges.push({ from: previous, to });
        previous = to;
      }
      skippedSameStyleEdges.push({ edgeIndex: run.edgeIndex, style: run.fillStyle0, commandCount: run.commands.length, points, drawnEdges });
    }
    for (const command of run.commands) {
      if (command.type === 'M') { current = { x: command.x, y: command.y }; subpathStart = current; continue; }
      if (command.type === 'Z') {
        if (current && subpathStart && pointKey(current) !== pointKey(subpathStart)) {
          if (run.fillStyle0 !== run.fillStyle1) {
            if (run.fillStyle1 !== null) addBoundary(run.fillStyle1, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, false);
            if (run.fillStyle0 !== null) addBoundary(run.fillStyle0, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, true);
          }
        }
        current = subpathStart; continue;
      }
      const end = { x: command.x, y: command.y };
      if (!current) {
        if (run.fillStyle0 !== null || run.fillStyle1 !== null) { styleErrors.set('__NO_START__', `edge ${run.edgeIndex} styled fill edge without a start point`); return { boundaryByStyle, styleErrors, skippedSameStyleEdges, segmentCount }; }
        current = end; continue;
      }
      if (run.fillStyle0 !== run.fillStyle1) {
        if (run.fillStyle1 !== null) addBoundary(run.fillStyle1, current, end, command, false);
        if (run.fillStyle0 !== null) addBoundary(run.fillStyle0, current, end, command, true);
      }
      current = end;
    }
  }
  return { boundaryByStyle, styleErrors, skippedSameStyleEdges, segmentCount };
}

/** Production stitch verdict + full topology diagnostics for one style's segments. */
function stitchDiagnose(segments) {
  const outgoing = new Map();
  const incoming = new Map();
  const pointByKey = new Map();
  const undirectedDegree = new Map();
  const push = (map, key, value) => { const list = map.get(key) ?? []; list.push(value); map.set(key, list); };
  for (const segment of segments) {
    const fromKey = pointKey(segment.from);
    const toKey = pointKey(segment.to);
    pointByKey.set(fromKey, segment.from);
    pointByKey.set(toKey, segment.to);
    push(outgoing, fromKey, segment);
    push(incoming, toKey, segment);
    if (fromKey !== toKey) {
      undirectedDegree.set(fromKey, (undirectedDegree.get(fromKey) ?? 0) + 1);
      undirectedDegree.set(toKey, (undirectedDegree.get(toKey) ?? 0) + 1);
    }
  }
  // Production walk.
  const visited = new Set();
  let contourCount = 0;
  let failure = null;
  let deadEnd = null;
  for (const first of segments) {
    if (visited.has(first.order)) continue;
    const startKey = pointKey(first.from);
    let current = first;
    const walked = [];
    while (current && !visited.has(current.order)) {
      visited.add(current.order);
      walked.push(current);
      if (pointKey(current.to) === startKey) break;
      const nextCandidates = (outgoing.get(pointKey(current.to)) ?? []).filter((candidate) => !visited.has(candidate.order));
      if (nextCandidates.length === 0) {
        failure = 'OPEN_FILL_BOUNDARY';
        deadEnd = { point: current.to, outdegree: (outgoing.get(pointKey(current.to)) ?? []).length, indegree: (incoming.get(pointKey(current.to)) ?? []).length, undirectedDegree: undirectedDegree.get(pointKey(current.to)) ?? 0 };
        break;
      }
      current = nextFillBoundarySegment(current, nextCandidates);
      if (!current) { failure = 'AMBIGUOUS_FILL_TOPOLOGY'; deadEnd = { point: walked.length ? walked[walked.length - 1].to : first.from }; break; }
    }
    if (failure) break;
    const last = walked[walked.length - 1];
    const lastTo = pointKey(last.to);
    if (lastTo !== startKey) {
      failure = 'OPEN_FILL_BOUNDARY';
      deadEnd = { point: last.to, outdegree: (outgoing.get(lastTo) ?? []).length, indegree: (incoming.get(lastTo) ?? []).length, undirectedDegree: undirectedDegree.get(lastTo) ?? 0 };
      break;
    }
    contourCount += 1;
  }
  // Undirected components.
  const adjacency = new Map();
  const link = (a, b) => { const list = adjacency.get(a) ?? []; list.push(b); adjacency.set(a, list); };
  for (const segment of segments) {
    const fromKey = pointKey(segment.from);
    const toKey = pointKey(segment.to);
    link(fromKey, toKey); link(toKey, fromKey);
  }
  const seen = new Set();
  const components = [];
  for (const key of adjacency.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    const nodes = [];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      nodes.push(node);
      for (const neighbor of adjacency.get(node) ?? []) if (!seen.has(neighbor)) stack.push(neighbor);
    }
    const endpoints = nodes.filter((node) => (undirectedDegree.get(node) ?? 0) === 1);
    const closedUndirected = endpoints.length === 0;
    const oriented = nodes.every((node) => (outgoing.get(node) ?? []).length <= 1 && (incoming.get(node) ?? []).length <= 1);
    const balancedDirected = closedUndirected && nodes.every((node) => (outgoing.get(node) ?? []).length === (incoming.get(node) ?? []).length);
    components.push({
      nodeCount: nodes.length,
      endpoints: endpoints.map((k) => pointByKey.get(k)),
      closedUndirected,
      oriented,
      balancedDirected,
    });
  }
  return {
    segmentCount: segments.length,
    distinctPointCount: pointByKey.size,
    componentCount: components.length,
    components,
    openComponentCount: components.filter((component) => !component.closedUndirected).length,
    closedUndirectedComponentCount: components.filter((component) => component.closedUndirected).length,
    directedInconsistencyComponentCount: components.filter((component) => component.closedUndirected && !component.balancedDirected).length,
    productionFailure: failure,
    productionContourCount: failure ? null : contourCount,
    deadEnd,
  };
}

/** Duplicated / reverse-duplicated edge evidence across the whole shape. */
function duplicateEdgeEvidence(boundaryByStyle) {
  const byOriented = new Map();
  for (const [styleIndex, segments] of boundaryByStyle) {
    for (const segment of segments) {
      const key = `${pointKey(segment.from)}->${pointKey(segment.to)}`;
      const list = byOriented.get(key) ?? [];
      list.push(styleIndex);
      byOriented.set(key, list);
    }
  }
  const reversePairs = [];
  const duplicates = [];
  for (const [key, styles] of byOriented) {
    if (styles.length > 1) duplicates.push({ key, styles });
    const [from, to] = key.split('->');
    const reverse = `${to}->${from}`;
    if (byOriented.has(reverse) && key < reverse) reversePairs.push({ forward: key, reverse, forwardStyles: styles, reverseStyles: byOriented.get(reverse) });
  }
  return { duplicateOrientedEdges: duplicates.length, reversePairCount: reversePairs.length, reversePairs: reversePairs.slice(0, 20) };
}

/** For an open style component, test whether the gap is bridged by a same-style skipped edge. */
function closureEvidence(style, representation, skippedSameStyleEdges) {
  // Every authored draw segment in the shape, with its fill/stroke ownership,
  // regardless of whether production turned it into a boundary.
  const allSegments = [];
  for (const run of representation.styleRuns) {
    let previous = null;
    let subStart = null;
    for (const command of run.commands) {
      if (command.type === 'M') { previous = { x: command.x, y: command.y }; subStart = previous; continue; }
      if (command.type === 'Z') { previous = subStart; continue; }
      const to = { x: command.x, y: command.y };
      if (previous) {
        allSegments.push({
          from: previous, to,
          fillStyle0: run.fillStyle0, fillStyle1: run.fillStyle1, strokeStyle: run.strokeStyle, edgeIndex: run.edgeIndex,
        });
      }
      previous = to;
    }
  }
  const evidence = [];
  for (const component of style.components ?? []) {
    if (component.closedUndirected) continue;
    const endpoints = component.endpoints ?? [];
    if (endpoints.length !== 2) {
      // Branching component: report the branch nodes (undirected degree > 2).
      const branchNodes = (style.components ?? []).length ? [] : [];
      void branchNodes;
      evidence.push({ endpoints, bridged: 'NOT_SIMPLE_OPEN_CHAIN', endpointCount: endpoints.length, nodeCount: component.nodeCount, oriented: component.oriented });
      continue;
    }
    const [a, b] = endpoints;
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    const connect = (segment) => {
      const fromKey = pointKey(segment.from);
      const toKey = pointKey(segment.to);
      return (fromKey === aKey && toKey === bKey) || (fromKey === bKey && toKey === aKey);
    };
    const matches = allSegments.filter(connect).map((segment) => ({
      edgeIndex: segment.edgeIndex,
      fillStyle0: segment.fillStyle0,
      fillStyle1: segment.fillStyle1,
      strokeStyle: segment.strokeStyle,
      category: segment.fillStyle0 === null && segment.fillStyle1 === null ? 'NO_FILL_OWNERSHIP'
        : segment.fillStyle0 === segment.fillStyle1 ? 'SAME_STYLE_BOTH_SIDES'
          : segment.fillStyle0 === style.index || segment.fillStyle1 === style.index ? 'OWNED_BY_THIS_STYLE_BUT_NOT_CLOSING'
            : 'OWNED_BY_OTHER_STYLE',
    }));
    const incidentAtA = allSegments.filter((seg) => pointKey(seg.from) === aKey || pointKey(seg.to) === aKey).length;
    const incidentAtB = allSegments.filter((seg) => pointKey(seg.from) === bKey || pointKey(seg.to) === bKey).length;
    const describe = (segment) => ({
      edgeIndex: segment.edgeIndex, from: segment.from, to: segment.to,
      fillStyle0: segment.fillStyle0, fillStyle1: segment.fillStyle1, strokeStyle: segment.strokeStyle,
    });
    const incidentAtAEges = allSegments.filter((seg) => pointKey(seg.from) === aKey || pointKey(seg.to) === aKey).map(describe).slice(0, 8);
    const incidentAtBEdges = allSegments.filter((seg) => pointKey(seg.from) === bKey || pointKey(seg.to) === bKey).map(describe).slice(0, 8);
    const matchingSameStyle = skippedSameStyleEdges
      .filter((edge) => edge.style === style.index)
      .filter((edge) => { const keys = new Set(edge.points.map(pointKey)); return keys.has(aKey) && keys.has(bKey); })
      .map((edge) => edge.edgeIndex);
    evidence.push({
      endpoints: [a, b],
      endpointDistance: Math.hypot(a.x - b.x, a.y - b.y),
      endpointEqual: aKey === bKey,
      authoredConnectorSegments: matches,
      authoredConnectorCategories: [...new Set(matches.map((match) => match.category))],
      incidentSegmentCountAtEndpoints: [incidentAtA, incidentAtB],
      incidentEdgesAtEndpoints: [incidentAtAEges, incidentAtBEdges],
      bridgedBySameStyleSkippedEdge: matchingSameStyle.length > 0,
      sameStyleSkippedEdgeIndices: matchingSameStyle,
    });
  }
  return evidence;
}

function summarizeEdgeGeometry(decoded) {
  const subpaths = [];
  let current = null;
  const pointOf = (command) => ({ x: command.x, y: command.y });
  for (const command of decoded.commands) {
    if (command.type === 'M') { current = { start: pointOf(command), last: pointOf(command), points: 1, closed: false }; subpaths.push(current); continue; }
    if (!current) { current = { start: pointOf(command), last: pointOf(command), points: 1, closed: false }; subpaths.push(current); continue; }
    if (command.type === 'Z') { current.closed = true; current.last = current.start; continue; }
    current.last = pointOf(command);
    current.points += 1;
  }
  return {
    commandCount: decoded.commands.length,
    subpathCount: subpaths.length,
    subpaths: subpaths.map((subpath) => ({ start: subpath.start, end: subpath.last, points: subpath.points, closed: subpath.closed })),
    error: decoded.error ?? null,
  };
}

function analyzeShapeBlock(shapeId, block) {
  const shape = parseShapeAt(block);
  const base = {
    shapeId,
    sourceXmlBytes: Buffer.byteLength(block, 'utf8'),
    fillStyleCount: shape.fillStyles.length,
    strokeStyleCount: shape.strokeStyles.length,
    edgeCount: shape.edgeStrings.length,
    fillStyles: shape.fillStyles.map((style) => ({ index: style.index, type: style.type, color: style.color, alpha: style.alpha })),
    edges: shape.edgeStrings.map((edge, index) => ({
      index,
      fillStyle0: edge.fillStyle0,
      fillStyle1: edge.fillStyle1,
      strokeStyle: edge.strokeStyle,
      encodedChars: (edge.cubics || edge.edges).length,
      hasCubics: Boolean(edge.cubics),
      geometry: summarizeEdgeGeometry(decodeEdgesWithStyleChanges(edge.cubics || edge.edges)),
    })),
  };
  if (shape.issue) return { ...base, ok: false, failure: 'PARSE_ISSUE', issue: shape.issue };
  const runs = buildStyleRuns(shape, shapeId);
  if (!runs.ok) return { ...base, ok: false, failure: 'RUN_BUILD_FAILED', message: runs.message };
  const { boundaryByStyle, styleErrors, skippedSameStyleEdges, segmentCount } = buildFillBoundaries(runs.representation);
  const styles = [];
  for (const style of shape.fillStyles) {
    const segments = boundaryByStyle.get(style.index);
    if (!segments || segments.length === 0) { styles.push({ index: style.index, type: style.type, segmentCount: 0, note: 'no boundary segments' }); continue; }
    styles.push({ index: style.index, type: style.type, ...stitchDiagnose(segments) });
  }
  const failures = styles.filter((style) => style.productionFailure);
  for (const style of styles) {
    if (!style.productionFailure) continue;
    style.closureEvidence = closureEvidence(style, runs.representation, skippedSameStyleEdges);
  }
  return {
    ...base,
    ok: failures.length === 0 && !styleErrors.size,
    failure: failures.length ? 'FILL_BOUNDARY_UNCLOSED' : (styleErrors.size ? 'STYLE_ERROR' : null),
    styledBoundarySegmentCount: segmentCount,
    noStartPointError: styleErrors.get('__NO_START__') ?? null,
    skippedSameStyleEdges,
    styles,
    failingStyles: failures.map((style) => style.index),
    duplicateEvidence: duplicateEdgeEvidence(boundaryByStyle),
  };
}

// ---------------------------------------------------------------------------
// Gradient forensic (J3 seed data — research only, no implementation)
// ---------------------------------------------------------------------------

function analyzeGradientStyle(shapeId, block, styleIndex) {
  const shape = parseShapeAt(block);
  const style = shape.fillStyles.find((entry) => entry.index === styleIndex);
  if (!style) return { shapeId, styleIndex, present: false };
  const xml = style.sourceXml;
  const matrixWrapperCount = (xml.match(/<matrix\b/gu) ?? []).length;
  const matrixBlocks = extractBalancedBlocks(xml, 'matrix');
  const matrixTagCount = (xml.match(/<Matrix\b/gu) ?? []).length;
  const matrixTags = matrixBlocks.length ? (matrixBlocks[0].match(/<Matrix\b[^>]*\/?\s*>/gu) ?? []) : [];
  const matrixAttributes = {};
  if (matrixTags.length === 1) {
    for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty']) {
      const raw = attributeFromElement(matrixTags[0], 'Matrix', key);
      if (raw !== null) matrixAttributes[key] = raw;
    }
  }
  const gradientType = /<RadialGradient\b/u.test(xml) ? 'radial' : /<LinearGradient\b/u.test(xml) ? 'linear' : 'none';
  const gradientEntryCount = (xml.match(/<GradientEntry\b/gu) ?? []).length;
  return {
    shapeId,
    styleIndex,
    present: true,
    declaredType: style.type,
    gradientType,
    gradientEntryCount,
    matrixWrapperCount,
    matrixBlockCount: matrixBlocks.length,
    matrixTagCount,
    matrixPresent: matrixWrapperCount === 1 && matrixBlocks.length === 1 && matrixTagCount === 1,
    matrixAttributes,
    matrixAttributeCount: Object.keys(matrixAttributes).length,
    sourceXmlHead: xml.slice(0, 800),
  };
}

// ---------------------------------------------------------------------------
// Counterfactual bounded models (in-memory only; never applied to production)
// ---------------------------------------------------------------------------

const EPSILONS = [0, 1e-9, 1e-6, 1e-3, 1e-2, 1e-1, 0.5];

function quantize(point, epsilon) {
  const q = epsilon === 0 ? 1e-12 : epsilon;
  return `${Math.round(point.x / q)},${Math.round(point.y / q)}`;
}

/**
 * Counterfactual: does the shape's fill topology close (per production stitch
 * rule) if endpoints are merged with the given tolerance?
 * Records whether the merge fabricates a connector (two endpoints that are not
 * exactly equal being joined).
 */
function counterfactualToleranceJoin(representation, epsilon) {
  const byStyle = new Map();
  const fabricated = new Set();
  let nextOrder = 0;
  const keyOf = (point) => quantize(point, epsilon);
  const pointByKey = new Map();
  const register = (point) => { const k = keyOf(point); if (!pointByKey.has(k)) pointByKey.set(k, point); return k; };
  let currentEdgeIndex = -1;
  let current = null;
  let subpathStart = null;
  const add = (styleIndex, from, to, command, reverse) => {
    const styleSegments = byStyle.get(styleIndex) ?? [];
    const orientedFrom = reverse ? to : from;
    const orientedTo = reverse ? from : to;
    const orientedCommand = reverse ? reverseFillDrawCommand(command, from) : command;
    const fk = register(orientedFrom); const tk = register(orientedTo);
    if (epsilon !== 0 && keyOf(orientedTo) !== keyOf(orientedFrom)) {
      // flag when a non-exact endpoint was snapped to an existing distinct point
    }
    if (epsilon !== 0 && tk !== fk) {
      const originalKey = `${orientedTo.x},${orientedTo.y}`;
      if (pointByKey.has(tk) && !fabricated.has(tk)) fabricated.add(tk);
      void originalKey;
    }
    styleSegments.push({ from: { x: orientedFrom.x, y: orientedFrom.y, k: fk }, to: { x: orientedTo.x, y: orientedTo.y, k: tk }, command: orientedCommand, order: nextOrder });
    byStyle.set(styleIndex, styleSegments);
    nextOrder += 1;
  };
  for (const run of representation.styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) { currentEdgeIndex = run.edgeIndex; current = null; subpathStart = null; }
    for (const command of run.commands) {
      if (command.type === 'M') { current = { x: command.x, y: command.y }; subpathStart = current; continue; }
      if (command.type === 'Z') {
        if (current && subpathStart && keyOf(current) !== keyOf(subpathStart)) {
          if (run.fillStyle0 !== run.fillStyle1) {
            if (run.fillStyle1 !== null) add(run.fillStyle1, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, false);
            if (run.fillStyle0 !== null) add(run.fillStyle0, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, true);
          }
        }
        current = subpathStart; continue;
      }
      const end = { x: command.x, y: command.y };
      if (!current) { current = end; continue; }
      if (run.fillStyle0 !== run.fillStyle1) {
        if (run.fillStyle1 !== null) add(run.fillStyle1, current, end, command, false);
        if (run.fillStyle0 !== null) add(run.fillStyle0, current, end, command, true);
      }
      current = end;
    }
  }
  // Stitch using the quantized keys.
  const results = [];
  for (const [styleIndex, segments] of byStyle) {
    const outgoing = new Map();
    for (const segment of segments) {
      const list = outgoing.get(segment.from.k) ?? [];
      list.push(segment); outgoing.set(segment.from.k, list);
    }
    const visited = new Set();
    let contours = 0;
    let open = false;
    for (const first of segments) {
      if (visited.has(first.order)) continue;
      const startKey = first.from.k;
      let cur = first;
      let guard = 0;
      while (cur && !visited.has(cur.order) && guard++ <= segments.length + 2) {
        visited.add(cur.order);
        if (cur.to.k === startKey) break;
        const candidates = (outgoing.get(cur.to.k) ?? []).filter((c) => !visited.has(c.order));
        if (candidates.length === 0) { open = true; break; }
        cur = candidates[0];
      }
      if (open) break;
      if (!cur || (cur && cur.to.k !== startKey)) { open = true; break; }
      contours += 1;
    }
    results.push({ styleIndex, closed: !open, contourCount: open ? null : contours });
  }
  return { epsilon, fabricatedSnapCount: fabricated.size, styles: results, allClosed: results.every((r) => r.closed) };
}

// ---------------------------------------------------------------------------
// Rule engine: re-evaluate the whole fixture under bounded fill rules
// (mirror of production; parity with production is asserted for the baseline rule)
// ---------------------------------------------------------------------------

const RULES = [
  { id: 'baseline', emitSameStyle: false, tolerance: 0, neighborReuse: false, unstyledReuse: false },
  { id: 'emit-same-style', emitSameStyle: true, tolerance: 0, neighborReuse: false, unstyledReuse: false },
  { id: 'tolerance-1e-6', emitSameStyle: false, tolerance: 1e-6, neighborReuse: false, unstyledReuse: false },
  { id: 'tolerance-1e-3', emitSameStyle: false, tolerance: 1e-3, neighborReuse: false, unstyledReuse: false },
  { id: 'tolerance-quantum-0.05', emitSameStyle: false, tolerance: 1 / COORD_SCALE, neighborReuse: false, unstyledReuse: false },
  { id: 'neighbor-reuse', emitSameStyle: false, tolerance: 0, neighborReuse: true, unstyledReuse: false },
  { id: 'unstyled-edge-reuse', emitSameStyle: false, tolerance: 0, neighborReuse: false, unstyledReuse: true },
  { id: 'emit-same-style+unstyled-edge-reuse', emitSameStyle: true, tolerance: 0, neighborReuse: false, unstyledReuse: true },
];

/** Build boundaries under a rule; returns per-style segment lists. */
function buildBoundariesUnderRule(representation, rule) {
  const key = (point) => rule.tolerance === 0 ? pointKey(point)
    : `${Math.round(point.x / rule.tolerance)},${Math.round(point.y / rule.tolerance)}`;
  const byStyle = new Map();
  let order = 0;
  const add = (styleIndex, from, to, command, reverse) => {
    const list = byStyle.get(styleIndex) ?? [];
    const orientedFrom = reverse ? to : from;
    const orientedTo = reverse ? from : to;
    const orientedCommand = reverse ? reverseFillDrawCommand(command, from) : command;
    list.push({ from: orientedFrom, to: orientedTo, command: orientedCommand, order: order++, keyFrom: key(orientedFrom), keyTo: key(orientedTo) });
    byStyle.set(styleIndex, list);
  };
  let currentEdgeIndex = -1;
  let current = null;
  let subpathStart = null;
  for (const run of representation.styleRuns) {
    if (run.edgeIndex !== currentEdgeIndex) { currentEdgeIndex = run.edgeIndex; current = null; subpathStart = null; }
    const sameStyle = run.fillStyle0 !== null && run.fillStyle0 === run.fillStyle1;
    for (const command of run.commands) {
      if (command.type === 'M') { current = { x: command.x, y: command.y }; subpathStart = current; continue; }
      if (command.type === 'Z') {
        if (current && subpathStart && key(current) !== key(subpathStart)) {
          if (run.fillStyle0 !== run.fillStyle1) {
            if (run.fillStyle1 !== null) add(run.fillStyle1, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, false);
            if (run.fillStyle0 !== null) add(run.fillStyle0, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, true);
          } else if (sameStyle && rule.emitSameStyle) {
            add(run.fillStyle0, current, subpathStart, { type: 'L', x: subpathStart.x, y: subpathStart.y }, false);
          }
        }
        current = subpathStart; continue;
      }
      const end = { x: command.x, y: command.y };
      if (!current) { current = end; continue; }
      if (run.fillStyle0 !== run.fillStyle1) {
        if (run.fillStyle1 !== null) add(run.fillStyle1, current, end, command, false);
        if (run.fillStyle0 !== null) add(run.fillStyle0, current, end, command, true);
      } else if (sameStyle && rule.emitSameStyle) {
        add(run.fillStyle0, current, end, command, false);
      }
      current = end;
    }
  }
  return byStyle;
}

/** Authored draw segments of a shape keyed by exact start point (for neighbour reuse). */
function authoredOutgoingIndex(representation) {
  const index = new Map();
  for (const run of representation.styleRuns) {
    let previous = null;
    let subStart = null;
    for (const command of run.commands) {
      if (command.type === 'M') { previous = { x: command.x, y: command.y }; subStart = previous; continue; }
      if (command.type === 'Z') { previous = subStart; continue; }
      const to = { x: command.x, y: command.y };
      if (previous) {
        const key = pointKey(previous);
        const list = index.get(key) ?? [];
        list.push({ from: previous, to, keyFrom: key, keyTo: pointKey(to), styled: run.fillStyle0 !== null || run.fillStyle1 !== null });
        index.set(key, list);
      }
      previous = to;
    }
  }
  return index;
}

/** Stitch under a rule (steps mirror production), optionally reusing neighbor segments. */
function stitchUnderRule(segments, authoredOutgoing, rule) {
  const outgoing = new Map();
  for (const segment of segments) {
    const list = outgoing.get(segment.keyFrom) ?? [];
    list.push(segment); outgoing.set(segment.keyFrom, list);
  }
  const visited = new Set();
  let contours = 0;
  for (const first of segments) {
    if (visited.has(first.order)) continue;
    const startKey = first.keyFrom;
    let current = first;
    let guard = 0;
    while (current && !visited.has(current.order) && guard++ <= segments.length + 8) {
      visited.add(current.order);
      if (current.keyTo === startKey) break;
      let candidates = (outgoing.get(current.keyTo) ?? []).filter((candidate) => !visited.has(candidate.order));
      if (candidates.length === 0 && rule.neighborReuse) {
        const reused = (authoredOutgoing.get(current.keyTo) ?? [])
          .filter((segment) => segment.keyTo !== current.keyTo)
          .map((segment, offset) => ({ ...segment, command: { type: 'L', x: segment.to.x, y: segment.to.y }, order: 1_000_000 + offset }));
        candidates = reused;
      }
      if (candidates.length === 0) return { ok: false, reason: 'OPEN' };
      current = candidates[0];
    }
    if (!current || current.keyTo !== startKey) return { ok: false, reason: 'OPEN' };
    contours += 1;
  }
  return { ok: true, contours };
}

/** Permissive closure criterion: every component is an Eulerian closed multigraph. */
function eulerianClosure(segments) {
  const inDeg = new Map();
  const outDeg = new Map();
  const adjacency = new Map();
  const touch = (map, key, delta) => map.set(key, (map.get(key) ?? 0) + delta);
  const link = (a, b) => { const list = adjacency.get(a) ?? []; list.push(b); adjacency.set(a, list); };
  for (const segment of segments) {
    touch(outDeg, segment.keyFrom, 1);
    touch(inDeg, segment.keyTo, 1);
    link(segment.keyFrom, segment.keyTo); link(segment.keyTo, segment.keyFrom);
  }
  const seen = new Set();
  for (const key of adjacency.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    const nodes = [];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node); nodes.push(node);
      for (const neighbor of adjacency.get(node) ?? []) if (!seen.has(neighbor)) stack.push(neighbor);
    }
    const bad = nodes.some((node) => (inDeg.get(node) ?? 0) !== (outDeg.get(node) ?? 0)
      || ((inDeg.get(node) ?? 0) + (outDeg.get(node) ?? 0)) % 2 !== 0);
    if (bad) return false;
  }
  return true;
}

/** Replace open tips of a style's chain with authored unstyled segments (source-proven? no). */
function reuseUnstyled(segments, authoredOutgoing) {
  const keys = new Set(segments.flatMap((segment) => [segment.keyFrom, segment.keyTo]));
  const extra = [];
  let order = 2_000_000;
  for (const key of keys) {
    for (const candidate of authoredOutgoing.get(key) ?? []) {
      if (candidate.styled) continue;
      if (!keys.has(candidate.keyTo)) continue;
      extra.push({ from: candidate.from, to: candidate.to, command: { type: 'L', x: candidate.to.x, y: candidate.to.y }, order: order++, keyFrom: candidate.keyFrom, keyTo: candidate.keyTo });
    }
  }
  return [...segments, ...extra];
}

function evaluateShapeUnderRule(representation, rule, authoredOutgoing) {
  const byStyle = buildBoundariesUnderRule(representation, rule);
  let walkFailing = 0;
  let eulerianFailing = 0;
  for (const [, segments] of byStyle) {
    if (!segments.length) continue;
    const effective = rule.unstyledReuse ? reuseUnstyled(segments, authoredOutgoing) : segments;
    const stitched = rule.unstyledReuse ? { ok: eulerianClosure(effective) } : stitchUnderRule(segments, authoredOutgoing, rule);
    if (!stitched.ok) walkFailing += 1;
    if (!eulerianClosure(rule.unstyledReuse ? effective : segments)) eulerianFailing += 1;
  }
  return { ok: walkFailing === 0, walkFailing, eulerianFailing };
}

function counterfactualRuleSweep(blocksByHash) {
  const results = RULES.map((rule) => ({
    rule: rule.id, emitSameStyle: rule.emitSameStyle, tolerance: rule.tolerance, neighborReuse: rule.neighborReuse, unstyledReuse: rule.unstyledReuse,
    walkFailingShapes: 0, eulerianFailingShapes: 0, failingShapeSample: [],
  }));
  let checked = 0;
  for (const [hash, block] of [...blocksByHash.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const shape = parseShapeAt(block);
    if (shape.issue) continue;
    const runs = buildStyleRuns(shape, `fla-shape-sweep-${hash.slice(0, 8)}`);
    if (!runs.ok) continue;
    checked += 1;
    const authoredOutgoing = authoredOutgoingIndex(runs.representation);
    for (const entry of results) {
      const rule = RULES.find((candidate) => candidate.id === entry.rule);
      const verdict = evaluateShapeUnderRule(runs.representation, rule, authoredOutgoing);
      if (verdict.walkFailing > 0) {
        entry.walkFailingShapes += 1;
        if (entry.failingShapeSample.length < 10) entry.failingShapeSample.push(`fla-shape-${hash.slice(0, 12)}`);
      }
      if (verdict.eulerianFailing > 0) entry.eulerianFailingShapes += 1;
    }
  }
  return { shapesEvaluated: checked, results };
}

/** The exact frozen J0 classification enum (#718). No sixth value may be added (#719 STOP gate 3). */
const J0_ENUMS = [
  'MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED',
  'CURRENT_IMPLEMENTATION_BUG',
  'MALFORMED_SOURCE',
  'AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH',
  'UNKNOWN',
];

/**
 * J0 classification for one failing shape (exactly one frozen enum value + reasons).
 *
 * #719 C2: conservative semantic precedence — an unresolved open-chain ambiguity
 * forces AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH even when non-manifold branch junctions
 * are numerically larger. A bigger count of one class never erases the other.
 */
function classifyShapeFailure(forensic) {
  if (forensic.failure !== 'FILL_BOUNDARY_UNCLOSED') {
    return { classification: 'UNKNOWN', reasons: [`unexpected failure kind: ${forensic.failure}`], subReasons: { openChains: 0, branchJunctions: 0 } };
  }
  let openChains = 0;
  let branchComponents = 0;
  const categories = {};
  for (const style of forensic.styles ?? []) {
    if (!style.productionFailure) continue;
    for (const component of style.components ?? []) {
      if (component.closedUndirected) continue;
      if ((component.endpoints ?? []).length === 2) openChains += 1; else branchComponents += 1;
    }
    for (const evidence of style.closureEvidence ?? []) {
      if (evidence.bridged === 'NOT_SIMPLE_OPEN_CHAIN') { categories.NOT_SIMPLE_OPEN_CHAIN = (categories.NOT_SIMPLE_OPEN_CHAIN ?? 0) + 1; continue; }
      const list = evidence.authoredConnectorCategories?.length ? evidence.authoredConnectorCategories : ['NO_AUTHORED_CONNECTOR'];
      for (const category of list) categories[category] = (categories[category] ?? 0) + 1;
    }
  }
  const reasons = [];
  if (openChains > 0) reasons.push(`${openChains} open chain(s): the boundary is an open polyline with no source-declared fill-side ownership for the closing edge`);
  if (branchComponents > 0) reasons.push(`${branchComponents} non-manifold branch junction(s): an authored vertex is shared by 3+ edges`);
  if (categories.NO_FILL_OWNERSHIP) reasons.push(`${categories.NO_FILL_OWNERSHIP} open tip pair(s) joined only by an edge with no fill/stroke ownership`);
  if (categories.NO_AUTHORED_CONNECTOR) reasons.push(`${categories.NO_AUTHORED_CONNECTOR} open tip pair(s) with no authored connecting segment at all`);
  if (categories.OWNED_BY_THIS_STYLE_BUT_NOT_CLOSING) reasons.push(`${categories.OWNED_BY_THIS_STYLE_BUT_NOT_CLOSING} tip pair(s) with a same-style edge that still does not close the directed walk`);
  // Conservative semantic precedence (#719 C2): source ambiguity dominates.
  //   - an open chain cannot be closed without inventing a fill-side -> AMBIGUOUS;
  //   - only when no such ambiguity exists and a non-manifold junction remains does
  //     the failure reduce to a rule the model lacks -> MODEL_INCOMPLETE;
  //   - otherwise there is no source/mode evidence -> UNKNOWN.
  const classification = openChains > 0
    ? 'AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH'
    : branchComponents > 0
      ? 'MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED'
      : 'UNKNOWN';
  return {
    classification,
    reasons,
    subReasons: { openChains, branchJunctions: branchComponents, connectorCategories: categories },
    openChains,
    branchComponents,
    categories,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });

  const originalBytes = await fs.promises.readFile(args.source);
  const originalSha256 = HASH(originalBytes);
  assert.equal(originalSha256, args.expectedSha256.toLowerCase(), 'source bytes do not match the expected SHA-256');

  const loaded = await loadSourceFromBytes(originalBytes);
  const source = loaded.source;

  // 1. Per-root compose in an ISOLATED source load so the failing shape id maps to
  //    its own block without cross-root id collisions.
  const rootNames = [{ name: '(scene)', kind: 'scene' }, ...source.graphicSymbols.map((symbol) => ({ name: symbol.sourceLibraryItemName, kind: 'graphic' }))];
  const rootVerdicts = [];
  const allBlocks = new Map();
  const idToContentHashes = new Map();
  for (const { name, kind } of rootNames) {
    const isolated = await loadSourceFromBytes(originalBytes);
    const verdict = composeProduction(isolated.source, name, kind);
    let failingShapeId = null;
    let failingContentHash = null;
    if (!verdict.ok) {
      failingShapeId = (verdict.message ?? '').match(/Shape (fla-shape-[0-9a-f]+)/u)?.[1] ?? null;
      if (failingShapeId) {
        const block = isolated.source.shapeBlocks.get(failingShapeId);
        failingContentHash = block ? HASH(block) : null;
      }
    }
    for (const [id, block] of isolated.source.shapeBlocks.entries()) {
      const hash = HASH(block);
      allBlocks.set(hash, block);
      const set = idToContentHashes.get(id) ?? new Set();
      set.add(hash);
      idToContentHashes.set(id, set);
    }
    rootVerdicts.push({ name, kind, ...verdict, failingShapeId, failingContentHash });
  }
  const shapeBlockCount = source.shapeBlocks.size;

  // Shape ids are hashed from (scope, display-list path), so two roots can register
  // DIFFERENT DOMShape XML under the same id. Audit by CONTENT, not id.
  const uniqueShapeDefs = new Map();
  for (const [hash, block] of allBlocks.entries()) uniqueShapeDefs.set(hash, { hash, block, ids: [] });
  for (const [id, hashes] of idToContentHashes.entries()) {
    for (const hash of hashes) uniqueShapeDefs.get(hash)?.ids.push(id);
  }
  const idCollisionGroupCount = [...idToContentHashes.values()].filter((set) => set.size > 1).length;

  // 2. Production + mirror verdict for EVERY distinct shape definition.
  const shapeRecords = [];
  let parityMismatches = 0;
  let probeIndex = 0;
  for (const entry of [...uniqueShapeDefs.values()].sort((a, b) => a.hash.localeCompare(b.hash))) {
    probeIndex += 1;
    const probeId = `fla-shape-j0probe-${String(probeIndex).padStart(4, '0')}`;
    const blocks = new Map([[probeId, entry.block]]);
    const production = composeSingleShape(source, probeId, blocks);
    const mirror = analyzeShapeBlock(probeId, entry.block);
    const productionOk = production.ok;
    const mirrorOk = Boolean(mirror.ok);
    const agrees = productionOk === mirrorOk;
    if (!agrees) parityMismatches += 1;
    shapeRecords.push({ shapeId: probeId, ids: entry.ids, contentHash: entry.hash, production, mirrorOk, mirrorFailure: mirror.failure ?? null, agrees });
  }
  assert.equal(parityMismatches, 0, `mirror/production parity failed on ${parityMismatches} shape definition(s)`);

  // 3. Deep forensic for every failing shape definition.
  const failingProduction = shapeRecords.filter((record) => !record.production.ok);
  const forensics = failingProduction.map((record) => {
    const analyzed = analyzeShapeBlock(record.shapeId, uniqueShapeDefs.get(record.contentHash).block);
    const gradientStyle = /gradient matrix/u.test(record.production.message ?? '')
      ? (record.production.message.match(/FillStyle (\d+)/u)?.[1] ?? '')
      : '';
    return {
      shapeId: record.shapeId,
      contentHash: record.contentHash,
      registeredIds: record.ids,
      registeredIdCount: record.ids.length,
      productionVerdict: record.production,
      forensic: analyzed,
      classification: /gradient matrix/u.test(record.production.message ?? '')
        ? {
          // #719 C1: the gradient failure must use a frozen J0 enum value. "J3" is a
          // workflow destination, not a source classification -> metadata only.
          classification: 'UNKNOWN',
          deferredTo: 'J3',
          reasons: ['source FillStyle is a gradient with no authored <matrix> child; a legal default vs a malformed source cannot be decided without external truth'],
          subReasons: { missingGradientMatrix: true, deferredTo: 'J3' },
        }
        : classifyShapeFailure(analyzed),
      gradient: gradientStyle
        ? analyzeGradientStyle(record.shapeId, uniqueShapeDefs.get(record.contentHash).block, Number(gradientStyle))
        : null,
    };
  });

  // 4. Counterfactuals on the failing fill-topology shapes.
  const counterfactuals = [];
  for (const record of forensics) {
    if (!/open fill boundary|ambiguous fill topology/u.test(record.productionVerdict.message ?? '')) continue;
    const block = uniqueShapeDefs.get(record.contentHash).block;
    const shape = parseShapeAt(block);
    if (shape.issue) continue;
    const runs = buildStyleRuns(shape, record.shapeId);
    if (!runs.ok) continue;
    const perEpsilon = EPSILONS.map((epsilon) => counterfactualToleranceJoin(runs.representation, epsilon));
    counterfactuals.push({
      shapeId: record.shapeId,
      failingStyles: record.forensic.failingStyles,
      sameStyleSkippedEdges: record.forensic.skippedSameStyleEdges,
      toleranceJoin: perEpsilon.map((entry) => ({ epsilon: entry.epsilon, allClosed: entry.allClosed, fabricatedSnapCount: entry.fabricatedSnapCount })),
      note: 'Tolerance join fabricates connector geometry whenever it closes an open contour; it is never authorized.',
    });
  }

  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, originalSha256, 'source FLA changed during census');

  // 5. Counterfactual rule sweep on the Blue fixture + accepted real controls.
  const primarySweep = counterfactualRuleSweep(allBlocks);
  const controlSweeps = [];
  for (const control of args.controls ?? []) {
    const controlPath = path.resolve(control.file);
    if (!fs.existsSync(controlPath)) { controlSweeps.push({ label: control.label, file: controlPath, present: false }); continue; }
    const controlBytes = await fs.promises.readFile(controlPath);
    const controlSha = HASH(controlBytes);
    const base = await loadSourceFromBytes(controlBytes);
    for (const { name, kind } of [{ name: '(scene)', kind: 'scene' }, ...base.source.graphicSymbols.map((symbol) => ({ name: symbol.sourceLibraryItemName, kind: 'graphic' }))]) {
      composeProduction(base.source, name, kind);
    }
    const controlBlocks = new Map();
    for (const [, block] of base.source.shapeBlocks.entries()) controlBlocks.set(HASH(block), block);
    const shaAfter = HASH(await fs.promises.readFile(controlPath));
    assert.equal(shaAfter, controlSha, `control fixture changed during census: ${control.file}`);
    controlSweeps.push({
      label: control.label,
      file: controlPath,
      expectedSha256: control.sha ?? null,
      sha256: controlSha,
      shaMatchesExpected: control.sha ? controlSha === control.sha.toLowerCase() : null,
      sourceMutation: 'NO',
      sweep: counterfactualRuleSweep(controlBlocks),
    });
  }

  const byFailure = (record) => {
    const message = record.production.message ?? '';
    if (/open fill boundary/u.test(message)) return 'SHAPE_FILL_TOPOLOGY';
    if (/ambiguous fill topology/u.test(message)) return 'SHAPE_FILL_TOPOLOGY_AMBIGUOUS';
    if (/gradient matrix/u.test(message)) return 'GRADIENT_MATRIX';
    return 'OTHER';
  };

  const classificationTally = forensics.reduce((acc, entry) => {
    acc[entry.classification.classification] = (acc[entry.classification.classification] ?? 0) + 1;
    return acc;
  }, {});
  // Full frozen-enum tally, including zeros (the receipt lists all five values).
  const enumTally = Object.fromEntries(J0_ENUMS.map((name) => [name, classificationTally[name] ?? 0]));
  const subReasonTally = forensics.reduce((acc, entry) => {
    const sub = entry.classification.subReasons ?? {};
    acc.openChains += sub.openChains ?? 0;
    acc.branchJunctions += sub.branchJunctions ?? 0;
    if (sub.missingGradientMatrix) acc.missingGradientMatrix += 1;
    if (sub.deferredTo) acc.gradientDeferredToJ3 += 1;
    return acc;
  }, { openChains: 0, branchJunctions: 0, missingGradientMatrix: 0, gradientDeferredToJ3: 0 });

  // #719 C4: recompute the J0 gate from evidence, never hard-code it. A candidate
  // rule may graduate to J1 only if it strictly reduces Blue's failing count AND
  // does not increase any accepted real control's failing count.
  const baselineOf = (results) => results?.find((entry) => entry.rule === 'baseline')?.walkFailingShapes ?? null;
  const blueBaseline = baselineOf(primarySweep.results);
  const graduatingRules = primarySweep.results
    .filter((entry) => entry.rule !== 'baseline' && blueBaseline !== null && entry.walkFailingShapes < blueBaseline)
    .filter((entry) => controlSweeps.every((control) => {
      const base = baselineOf(control.sweep?.results) ?? 0;
      const cand = control.sweep?.results?.find((x) => x.rule === entry.rule)?.walkFailingShapes ?? 0;
      return cand <= base;
    }))
    .map((entry) => entry.rule);
  const gate = {
    sourceProvenCandidateRule: graduatingRules.length ? graduatingRules : 'NONE',
    j0Result: graduatingRules.length ? 'GO' : 'NO-GO',
    j1: graduatingRules.length ? 'AUTHORIZED' : 'NOT_STARTED',
    basis: 'a rule graduates only if it strictly reduces Blue failing shapes and never increases an accepted control',
  };

  const report = {
    schemaVersion: 'issue718-j0-shape-forensic/2',
    issue: 718,
    correctiveIssue: 719,
    phase: 'J0',
    generatedNote: 'research-only; no production behavior changed; no source mutation; no invented connector geometry',
    classificationModel: {
      corrective: 'Issue #719 — classification semantics cleanup (C1/C2)',
      enums: J0_ENUMS,
      gradientRule: 'gradient failure -> UNKNOWN; J3 is deferredTo metadata, not a classification',
      topologyPrecedence: [
        'AMBIGUOUS_WITHOUT_EXTERNAL_TRUTH if any unresolved open chain exists',
        'else MODEL_INCOMPLETE_SOURCE_SEMANTIC_IDENTIFIED if any non-manifold branch junction exists',
        'else UNKNOWN',
      ],
      subReasons: 'openChains / branchJunctions counts retained separately per failing shape',
    },
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
      shapeBlockCount,
    },
    productionRootVerdicts: rootVerdicts,
    shapeAudit: {
      totalShapeBlocks: shapeBlockCount,
      distinctShapeDefinitions: shapeRecords.length,
      idCollisionGroupCount,
      idCollisionNote: 'shape ids hash (scope, display-list path); identical paths under different roots collide, so the audit is content-addressed',
      productionFailingCount: failingProduction.length,
      mirrorProductionParity: 'PASS',
      productionFailingShapeIds: failingProduction.map((record) => record.shapeId),
      productionFailingContentHashes: failingProduction.map((record) => record.contentHash),
      failureFamilies: failingProduction.reduce((acc, record) => {
        const family = byFailure(record);
        acc[family] = (acc[family] ?? 0) + 1;
        return acc;
      }, {}),
      classificationTally,
      enumTally,
      subReasonTally,
    },
    failingShapes: forensics,
    counterfactuals,
    ruleSweep: {
      note: 'baseline rule must reproduce the production failing count; any other rule is in-memory only',
      primary: primarySweep,
      controls: controlSweeps,
    },
    gate,
    productionChanges: 'NONE',
    sourceMutation: 'NO',
    inventedConnectorGeometry: 'NO',
  };

  const artifacts = [];
  artifacts.push(await writeExclusive(path.join(args.out, 'j0-shape-forensic.json'), `${JSON.stringify(report, null, 2)}\n`));

  const receiptLines = [
    'Issue #719 J0 classification corrective — regenerated forensic census receipt',
    'parent issue: #718 · mother PR: #677 · baseline: 56392e2ce43ff34ce2d31aa8148bf5e03e96efe1',
    'corrective: C1 gradient -> frozen enum (UNKNOWN, J3 as deferredTo metadata); C2 topology -> conservative semantic precedence (no majority vote)',
    `source: ${args.source}`,
    `sha256 before: ${originalSha256}`,
    `sha256 after:  ${sourceSha256After}`,
    'source mutation: NO',
    '',
    `shape blocks audited: ${shapeBlockCount} (distinct definitions: ${shapeRecords.length}, id-collision groups: ${idCollisionGroupCount})`,
    `production-failing shape definitions: ${failingProduction.length}`,
    `failure families: ${JSON.stringify(report.shapeAudit.failureFamilies)}`,
    `classification tally (frozen enum, zeros shown): ${J0_ENUMS.map((name) => `${name}=${enumTally[name]}`).join(' ')}`,
    `sub-reasons (sum over failing shapes): openChains=${subReasonTally.openChains} branchJunctions=${subReasonTally.branchJunctions} missingGradientMatrix=${subReasonTally.missingGradientMatrix} gradientDeferredToJ3=${subReasonTally.gradientDeferredToJ3}`,
    `mirror/production parity: PASS`,
    '',
    'rule sweep (failing shapes / total evaluated):',
    ...primarySweep.results.map((entry) => `  Blue  ${entry.rule}: walk=${entry.walkFailingShapes} eulerian=${entry.eulerianFailingShapes}/${primarySweep.shapesEvaluated}`),
    ...controlSweeps.flatMap((control) => control.present === false
      ? [`  ${control.label}: MISSING`]
      : control.sweep.results.map((entry) => `  ${control.label}  ${entry.rule}: walk=${entry.walkFailingShapes} eulerian=${entry.eulerianFailingShapes}/${control.sweep.shapesEvaluated}`)),
    '',
    ...failingProduction.map((record) => `shape ${record.shapeId}: ${record.production.code} :: ${record.production.message}`),
    '',
    `source-proven candidate rule: ${gate.sourceProvenCandidateRule}`,
    `J0 gate (recomputed from evidence): ${gate.j0Result}`,
    'production changes: NONE',
    'invented connector geometry: NO',
    'J1..J5: NOT_STARTED',
  ];
  artifacts.push(await writeExclusive(path.join(args.out, 'completion-receipt.txt'), receiptLines.join('\n') + '\n'));
  artifacts.push(await writeExclusive(path.join(args.out, 'completion-receipt.json'), `${JSON.stringify({
    schemaVersion: 'issue719-j0-receipt/1',
    parentIssue: 718,
    corrective: 'classification semantics cleanup (C1/C2/C4)',
    baseline: '56392e2ce43ff34ce2d31aa8148bf5e03e96efe1',
    source: { path: args.source, sha256Before: originalSha256, sha256After: sourceSha256After, sourceMutation: 'NO' },
    shapeAudit: report.shapeAudit,
    classificationModel: report.classificationModel,
    gate,
    artifacts,
  }, null, 2)}\n`));

  process.stdout.write(JSON.stringify({
    shapeBlockCount,
    distinctShapeDefinitions: shapeRecords.length,
    idCollisionGroupCount,
    productionFailingCount: failingProduction.length,
    failureFamilies: report.shapeAudit.failureFamilies,
    classificationTally: report.shapeAudit.classificationTally,
    enumTally: report.shapeAudit.enumTally,
    subReasonTally: report.shapeAudit.subReasonTally,
    gate,
    ruleSweepPrimary: primarySweep.results.map((entry) => ({ rule: entry.rule, walkFailing: entry.walkFailingShapes, eulerianFailing: entry.eulerianFailingShapes })),
    ruleSweepControls: controlSweeps.map((control) => ({
      label: control.label,
      present: control.present !== false,
      results: control.sweep ? control.sweep.results.map((entry) => ({ rule: entry.rule, walkFailing: entry.walkFailingShapes, eulerianFailing: entry.eulerianFailingShapes })) : null,
    })),
    artifacts,
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
