#!/usr/bin/env node

'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join, relative, resolve } = require('node:path');
const { isCompleteBoundary, scanCss } = require('./css-split-boundary.cjs');

const repoRoot = resolve(__dirname, '..');
const manifestPath = join(__dirname, 'css-split-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const preflightOnly = process.argv.includes('--preflight');
const writeReceipt = process.argv.includes('--write-receipt');
const writeP2Receipt = process.argv.includes('--write-p2-receipt');
const receiptPath = join(
  repoRoot,
  'docs',
  'evidence',
  'issue-530-css-split',
  'receipt.json',
);
const p2ReceiptPath = join(
  repoRoot,
  'docs',
  'evidence',
  'issue-541-p2-01',
  'receipt.json',
);

const failures = [];
const warn = [];
const fail = (message) => failures.push(message);
const normalize = (value) => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function linesOf(value) {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function rangeText(value, startLine, endLine) {
  const lines = linesOf(value);
  return `${lines.slice(startLine - 1, endLine).join('\n')}\n`;
}

function readBaseline() {
  try {
    return normalize(
      execFileSync(
        'git',
        [
          '-C',
          repoRoot,
          'show',
          `${manifest.baseline.commit}:${manifest.baseline.sourcePath}`,
        ],
        { encoding: 'utf8' },
      ),
    );
  } catch (error) {
    fail(`Cannot read pinned baseline: ${error.message}`);
    return '';
  }
}

function stateBefore(scan, lineNumber) {
  return lineNumber <= 1 ? scan.states[0] : scan.states[lineNumber - 1];
}

function lineNumberForIndex(value, index) {
  return value.slice(0, index).split('\n').length;
}

function inventoryPathSensitive(value) {
  const entries = [];
  const pattern = /@import\b[^;\n]*;|url\s*\([^)]*\)|@font-face\b/gu;
  for (const match of value.matchAll(pattern)) {
    entries.push({
      line: lineNumberForIndex(value, match.index ?? 0),
      text: match[0].replaceAll('\n', ' '),
      kind: match[0].startsWith('@import')
        ? 'import'
        : match[0].startsWith('@font-face')
          ? 'font-face'
          : 'url',
    });
  }
  return entries;
}

function pathSensitiveSliceEntries(entries, slice) {
  return entries.filter(
    (entry) => entry.line >= slice.range.startLine && entry.line <= slice.range.endLine,
  );
}

function urlValue(text) {
  const match = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/u.exec(text);
  return match?.[2] ?? null;
}

function proveRelocatedUrl(entry) {
  const value = urlValue(entry.text);
  if (!value) {
    return {
      line: entry.line,
      kind: entry.kind,
      source: entry.text,
      identical: false,
      reason: 'URL value could not be parsed',
    };
  }
  if (/^(?:data|blob|https?):/iu.test(value) || value.startsWith('#')) {
    return {
      line: entry.line,
      kind: entry.kind,
      source: entry.text,
      beforeTarget: value,
      afterTarget: value,
      resolution: 'document-or-absolute URL; stylesheet directory does not participate',
      identical: true,
    };
  }
  if (!value.startsWith('/')) {
    return {
      line: entry.line,
      kind: entry.kind,
      source: entry.text,
      beforeTarget: value,
      afterTarget: value,
      resolution: 'relative URL requires an explicit relocation proof',
      identical: false,
      reason: 'relative resource URL changes meaning when moved deeper under styles/legacy-slices',
    };
  }

  const publicPath = join(repoRoot, 'public', value.slice(1));
  const targetExists = existsSync(publicPath);
  return {
    line: entry.line,
    kind: entry.kind,
    source: entry.text,
    beforeTarget: value,
    afterTarget: value,
    resolution: 'root-relative browser URL',
    publicPath: relative(repoRoot, publicPath).replaceAll('\\', '/'),
    targetExists,
    identical: targetExists,
    ...(targetExists ? {} : { reason: 'root-relative public resource is missing' }),
  };
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        output.push(...walkFiles(absolute));
      }
    } else if (/\.(?:cjs|js|mjs|json|ts|tsx)$/u.test(entry.name)) {
      output.push(absolute);
    }
  }
  return output;
}

function inventoryReaders() {
  const mentions = [];
  const likelyReaders = [];
  for (const root of ['tests', 'scripts']) {
    for (const absolute of walkFiles(join(repoRoot, root))) {
      const text = readFileSync(absolute, 'utf8');
      if (!text.includes('styles.css')) continue;
      const path = relative(repoRoot, absolute).replaceAll('\\', '/');
      mentions.push(path);
      if (
        /readFileSync[\s\S]{0,240}styles\.css|(?:source|readSource|readSourceFile)\s*\(\s*['"][^'"]*styles\.css/u.test(
          text,
        )
      ) {
        likelyReaders.push(path);
      }
    }
  }
  return { mentions, likelyReaders };
}

function verifyBaseline(baseline, scan) {
  if (!baseline) return;
  const actualBlob = execFileSync(
    'git',
    ['-C', repoRoot, 'rev-parse', `${manifest.baseline.commit}:${manifest.baseline.sourcePath}`],
    { encoding: 'utf8' },
  ).trim();
  if (actualBlob !== manifest.baseline.sourceBlob) {
    fail(
      `Pinned source blob mismatch: expected ${manifest.baseline.sourceBlob}, got ${actualBlob}`,
    );
  }
  if (scan.lines.length !== manifest.baseline.originalFileEndLine) {
    fail(
      `Pinned baseline line count mismatch: expected ${manifest.baseline.originalFileEndLine}, got ${scan.lines.length}`,
    );
  }
  for (const line of manifest.baseline.baseImportLines) {
    if (!scan.lines[line - 1]?.startsWith('@import ')) {
      fail(`Baseline line ${line} is not an @import line`);
    }
  }
}

function readCanonicalMap() {
  const canonicalMap = manifest.canonicalMap;
  if (!canonicalMap?.commit || !canonicalMap?.path) {
    fail('Canonical Section Map commit/path is missing from the manifest');
    return '';
  }
  try {
    return normalize(
      execFileSync(
        'git',
        ['-C', repoRoot, 'show', `${canonicalMap.commit}:${canonicalMap.path}`],
        { encoding: 'utf8' },
      ),
    );
  } catch (error) {
    fail(`Cannot read canonical Section Map: ${error.message}`);
    return '';
  }
}

function parseCanonicalSlices(value) {
  const slices = [];
  const rowPattern = /^\|\s*(S\d+)\s*\|\s*([\d,]+)-([\d,]+)\s*\|\s*[\d,]+\s*\|\s*`([^`]+)`\s*\|\s*(P1-\d+)\s*\|$/u;
  for (const line of linesOf(value)) {
    const match = rowPattern.exec(line);
    if (!match) continue;
    slices.push({
      id: match[1],
      startLine: Number(match[2].replaceAll(',', '')),
      endLine: Number(match[3].replaceAll(',', '')),
      targetPath: match[4],
      workItem: match[5],
    });
  }
  return slices;
}

function verifyCanonicalMap(canonicalMapText) {
  const canonicalSlices = parseCanonicalSlices(canonicalMapText);
  if (canonicalSlices.length !== 16) {
    fail(`Canonical Section Map yielded ${canonicalSlices.length} slices, expected 16`);
  }
  for (let index = 0; index < Math.min(canonicalSlices.length, manifest.slices.length); index += 1) {
    const canonical = canonicalSlices[index];
    const actual = manifest.slices[index];
    const expected = {
      id: canonical.id,
      order: index + 1,
      workItem: canonical.workItem,
      candidateRange: {
        startLine: canonical.startLine,
        endLine: canonical.endLine,
      },
      targetPath: join('src/renderer/styles/legacy-slices', canonical.targetPath).replaceAll('\\', '/'),
    };
    if (
      actual.id !== expected.id ||
      actual.order !== expected.order ||
      actual.workItem !== expected.workItem ||
      actual.candidateRange.startLine !== expected.candidateRange.startLine ||
      actual.candidateRange.endLine !== expected.candidateRange.endLine ||
      actual.targetPath !== expected.targetPath
    ) {
      fail(
        `${actual.id || `slice-${index + 1}`} does not match canonical Section Map: ${JSON.stringify(expected)}`,
      );
    }
  }
  return {
    path: manifest.canonicalMap?.path,
    commit: manifest.canonicalMap?.commit,
    sliceCount: canonicalSlices.length,
    slices: canonicalSlices,
  };
}

function readPhase2CanonicalMap() {
  const canonicalMap = manifest.phase2CanonicalMap;
  if (!canonicalMap?.commit || !canonicalMap?.path) {
    fail('Phase 2 Canonical Section Map commit/path is missing from the manifest');
    return '';
  }
  try {
    return normalize(
      execFileSync(
        'git',
        ['-C', repoRoot, 'show', canonicalMap.commit + ':' + canonicalMap.path],
        { encoding: 'utf8' },
      ),
    );
  } catch (error) {
    fail('Cannot read Phase 2 Canonical Section Map: ' + error.message);
    return '';
  }
}

function verifyPhase2CanonicalMap(canonicalMapText) {
  const canonicalMap = manifest.phase2CanonicalMap ?? {};
  if (canonicalMap.approvedForAutomaticRelocation !== false) {
    fail('Phase 2 Canonical Section Map must remain explicitly non-automatic');
  }
  if (canonicalMap.sha256 && sha256(canonicalMapText) !== canonicalMap.sha256) {
    fail(
      'Phase 2 Canonical Section Map SHA-256 mismatch: expected ' +
        canonicalMap.sha256 +
        ', got ' +
        sha256(canonicalMapText),
    );
  }
  if (canonicalMap.lineCount && linesOf(canonicalMapText).length !== canonicalMap.lineCount) {
    fail(
      'Phase 2 Canonical Section Map line count mismatch: expected ' +
        canonicalMap.lineCount +
        ', got ' +
        linesOf(canonicalMapText).length,
    );
  }
  const requiredIds = new Set([
    'G001',
    'G003',
    'G014',
    'G015',
    'G016',
    'G017',
    'G018',
    'G019',
    'G021',
    'G023',
    'G024',
    'G025',
    'G026',
    'G027',
    'G028',
    'G029',
    'G030',
    'G031',
    'G032',
    'G033',
    'G034',
    'G035',
    'G037',
    'G038',
    'G039',
    'G040',
    'G041',
    'G042',
    'G043',
    'G048',
    'G053',
    'G058',
    'G069',
    'G070',
    'G071',
    'G073',
    'G078',
    'G083',
    'G086',
    'G088',
    'G090',
    'G091',
    'G095',
    'G111',
    'G106',
    'G113',
    'G114',
    'G115',
    'G117',
    'G118',
    'G119',
    'G123',
    'G125',
    'G127',
    'G130',
    'G132',
    'G134',
    'G137',
    'G138',
    'G139',
    'G140',
    'G141',
    'G142',
    'G143',
    'G144',
    'G145',
    'G146',
    'S14-14',
    'S15-01',
    'S15-03',
    'S15-04',
    'S15-06',
    'S15-12',
    'S15-14',
    'S15-15',
    'S16-07',
  ]);
  const marker = String.fromCharCode(96);
  const mappings = [];
  for (const relocation of (manifest.semanticRelocations ?? []).filter(({ id }) => requiredIds.has(id))) {
    const segmentRow = '| ' + marker + relocation.segment + marker + ' |';
    const hasSegment = canonicalMapText.includes(segmentRow);
    const hasTarget = canonicalMapText.includes(marker + relocation.targetPath + marker);
    if (!hasSegment) {
      fail(relocation.id + ' / ' + relocation.segment + ' is absent from the pinned Phase 2 Segment registry');
    }
    if (!hasTarget) {
      fail(relocation.id + ' target is absent from the pinned Phase 2 Segment registry');
    }
    mappings.push({
      id: relocation.id,
      segment: relocation.segment,
      targetPath: relocation.targetPath,
      present: hasSegment && hasTarget,
    });
  }
  return {
    path: canonicalMap.path,
    commit: canonicalMap.commit,
    sha256: sha256(canonicalMapText),
    lineCount: linesOf(canonicalMapText).length,
    automaticRelocationApproved: false,
    mappings,
  };
}

function verifyMap(baseline, scan) {
  const slices = manifest.slices;
  if (slices.length !== 16) fail(`Expected 16 slices, got ${slices.length}`);
  const actualBoundaryChecks = [];
  const candidateBoundaryChecks = [];
  let previousActualEnd = manifest.coverage.startLine - 1;
  let previousCandidateEnd = manifest.coverage.startLine - 1;

  for (const slice of slices) {
    const candidateStart = slice.candidateRange.startLine;
    const candidateEnd = slice.candidateRange.endLine;
    const actualStart = slice.range.startLine;
    const actualEnd = slice.range.endLine;
    const candidateEndState = scan.states[candidateEnd];
    const actualStartState = stateBefore(scan, actualStart);
    const actualEndState = scan.states[actualEnd];

    if (candidateStart !== previousCandidateEnd + 1) {
      fail(`${slice.id} candidate coverage does not start after the previous candidate slice`);
    }
    if (actualStart !== previousActualEnd + 1) {
      fail(`${slice.id} actual coverage does not start after the previous actual slice`);
    }
    const candidateSafe = isCompleteBoundary(candidateEndState);
    const actualSafe = isCompleteBoundary(actualEndState);
    candidateBoundaryChecks.push({
      afterLine: candidateEnd,
      safe: candidateSafe,
      state: candidateEndState,
    });
    actualBoundaryChecks.push({
      afterLine: actualEnd,
      safe: actualSafe,
      state: actualEndState,
    });
    if (!isCompleteBoundary(actualStartState)) {
      fail(`${slice.id} actual start line ${actualStart} is inside a CSS structure`);
    }
    if (!actualSafe) fail(`${slice.id} actual boundary after line ${actualEnd} is unsafe`);
    if (candidateEnd !== actualEnd && !slice.boundaryAdjustment) {
      fail(`${slice.id} changed its candidate boundary without a recorded adjustment`);
    }
    if (candidateEnd === actualEnd && slice.boundaryAdjustment) {
      fail(`${slice.id} records an adjustment even though its boundary did not move`);
    }
    previousActualEnd = actualEnd;
    previousCandidateEnd = candidateEnd;
  }

  if (previousActualEnd !== manifest.coverage.endLine) {
    fail(`Actual slice coverage ends at ${previousActualEnd}, not ${manifest.coverage.endLine}`);
  }
  if (previousCandidateEnd !== manifest.coverage.endLine) {
    fail(`Candidate slice coverage ends at ${previousCandidateEnd}, not ${manifest.coverage.endLine}`);
  }
  if (slices[0].range.startLine !== 3 || slices[0].range.endLine !== 1951) {
    fail('S01 does not retain the fixed L3-L1951 range');
  }
  return { candidateBoundaryChecks, actualBoundaryChecks };
}

function verifyPathInventory(baseline) {
  const entries = inventoryPathSensitive(baseline);
  const s01 = entries.filter(
    (entry) => entry.line >= 3 && entry.line <= 1951,
  );
  if (s01.length > 0) {
    fail(
      `S01 contains path-sensitive constructs that need an explicit relocation proof: ${s01.map((entry) => `${entry.kind}@${entry.line}`).join(', ')}`,
    );
  }
  function proveSliceResources(slice) {
      const sliceEntries = pathSensitiveSliceEntries(entries, slice);
      const proofs = [];
      for (const entry of sliceEntries) {
        if (entry.kind !== 'url') {
          fail(
            `${slice.id} contains ${entry.kind}@${entry.line}; its relocated resource resolution is not proven`,
          );
          proofs.push({
            line: entry.line,
            kind: entry.kind,
            source: entry.text,
            identical: false,
            reason: 'imports and font-face declarations require a dedicated target proof',
          });
          continue;
        }
        const proof = proveRelocatedUrl(entry);
        proofs.push(proof);
        if (!proof.identical) {
          fail(
            `${slice.id} resource at line ${entry.line} does not have identical relocation proof: ${proof.reason}`,
          );
        }
      }
      return {
        id: slice.id,
        range: slice.range,
        entries: sliceEntries,
        relocationProof: proofs,
        relocationRisk: proofs.every((proof) => proof.identical) ? 'none' : 'unresolved',
      };
  }
  const p1_03 = manifest.slices
    .filter((slice) => slice.id === 'S04' || slice.id === 'S05')
    .map(proveSliceResources);
  const p1_04 = manifest.slices
    .filter((slice) => slice.id === 'S06' || slice.id === 'S07')
    .map(proveSliceResources);
  const p1_05 = manifest.slices
    .filter((slice) => slice.id === 'S08')
    .map(proveSliceResources);
  const p1_06 = manifest.slices
    .filter((slice) => slice.id === 'S09' || slice.id === 'S10')
    .map(proveSliceResources);
  const p1_07 = manifest.slices
    .filter((slice) => slice.id === 'S11' || slice.id === 'S12' || slice.id === 'S13')
    .map(proveSliceResources);
  const p1_08 = manifest.slices
    .filter((slice) => slice.id === 'S14' || slice.id === 'S15' || slice.id === 'S16')
    .map(proveSliceResources);
  const imports = entries.filter((entry) => entry.kind === 'import');
  if (imports.length !== 2 || imports.some((entry, index) => entry.line !== index + 1)) {
    fail('Baseline imports are not exactly the two fixed top-of-file imports');
  }
  return {
    all: entries,
    s01,
    p1_03,
    p1_04,
    p1_05,
    p1_06,
    p1_07,
    p1_08,
    relocationRisk:
      s01.length === 0 &&
      p1_03.every((slice) => slice.relocationRisk === 'none') &&
      p1_04.every((slice) => slice.relocationRisk === 'none') &&
      p1_05.every((slice) => slice.relocationRisk === 'none') &&
      p1_06.every((slice) => slice.relocationRisk === 'none') &&
      p1_07.every((slice) => slice.relocationRisk === 'none') &&
      p1_08.every((slice) => slice.relocationRisk === 'none')
      ? 'none'
      : 'unresolved',
  };
}

function entryImportPath(entryPath, targetPath) {
  const importPath = relative(dirname(entryPath), join(repoRoot, targetPath)).replaceAll('\\', '/');
  return `./${importPath.replace(/^\.\//u, '')}`;
}

function importPath(line) {
  return /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null;
}

function readEntryImports(entry) {
  const entryLines = linesOf(entry);
  const imports = [];
  let bodyStart = 0;
  while (bodyStart < entryLines.length) {
    const path = importPath(entryLines[bodyStart]);
    if (!path) break;
    imports.push(path);
    bodyStart += 1;
  }
  return { entryLines, imports, bodyStart };
}

function byteOffsetAtLine(value, lineNumber) {
  const lines = linesOf(value);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length + 1) {
    return null;
  }
  const prefix = lines.slice(0, lineNumber - 1).join('\n');
  return Buffer.byteLength(`${prefix}${lineNumber > 1 ? '\n' : ''}`, 'utf8');
}

function relocationSourceSegments(relocation) {
  if (Array.isArray(relocation.sourceSegments) && relocation.sourceSegments.length > 0) {
    return relocation.sourceSegments;
  }
  return [{
    sourceSlice: relocation.sourceSlice,
    sourceRange: relocation.sourceRange,
    sourceLocalRange: relocation.sourceLocalRange,
  }];
}

function relocationSegmentViews(relocation) {
  const segments = relocationSourceSegments(relocation);
  let targetStartLine = 1;
  return segments.map((segment, index) => {
    const lineCount = segment.sourceRange.endLine - segment.sourceRange.startLine + 1;
    const view = {
      ...relocation,
      sourceSlice: segment.sourceSlice,
      sourceRange: segment.sourceRange,
      sourceLocalRange: segment.sourceLocalRange,
      targetRange: { startLine: targetStartLine, endLine: targetStartLine + lineCount - 1 },
      sourceSegmentIndex: index,
      sourceSegmentCount: segments.length,
      sourceSegmentContinuation: index > 0,
    };
    targetStartLine += lineCount;
    return view;
  });
}

function relevantRelocationsForSlice(slice, relocations) {
  return relocations
    .flatMap((relocation) => relocationSegmentViews(relocation))
    .filter((relocation) => relocation.sourceSlice === slice.id)
    .sort((left, right) => left.sourceRange.startLine - right.sourceRange.startLine);
}

function verifySemanticRelocations(baseline, scan) {
  const relocations = manifest.semanticRelocations ?? [];
  const slicesById = new Map(manifest.slices.map((slice) => [slice.id, slice]));
  const targetPaths = new Set();
  for (const relocation of relocations) {
    const id = relocation.id || relocation.sourceSlice || 'semantic relocation';
    const sourceSegments = relocationSourceSegments(relocation);
    const firstSegment = sourceSegments[0];
    const slice = slicesById.get(firstSegment?.sourceSlice ?? relocation.sourceSlice);
    if (!slice) {
      fail(`${id} references unknown source slice ${firstSegment?.sourceSlice ?? relocation.sourceSlice}`);
      continue;
    }
    if (relocation.status !== 'relocated') {
      fail(`${id} does not have relocated status`);
    }
    const sourceParts = Array.isArray(slice.sourceParts) ? slice.sourceParts : [];
    const declaredPart = sourceParts.find(
      (part) => (part.relocationId ?? part.id) === relocation.id,
    );
    if (declaredPart) {
      if (declaredPart.kind !== 'semantic') {
        fail(`${id} is not declared as a semantic source part`);
      }
      if (declaredPart.targetPath !== relocation.targetPath) {
        fail(`${id} source part target differs from the semantic relocation target`);
      }
      if (
        declaredPart.sourceRange?.startLine !== relocation.sourceLocalRange.startLine ||
        declaredPart.sourceRange?.endLine !== relocation.sourceLocalRange.endLine
      ) {
        fail(`${id} source part range differs from the semantic relocation range`);
      }
    }
    if (relocation.insertBefore) {
      const partIndex = declaredPart ? sourceParts.indexOf(declaredPart) : -1;
      const nextPart = partIndex >= 0 ? sourceParts[partIndex + 1] : null;
      const expectedInsertBefore = sourceParts.length === 0
        ? slice.targetPath
        : nextPart?.targetPath;
      if (expectedInsertBefore && relocation.insertBefore !== expectedInsertBefore) {
        fail(`${id} must be inserted immediately before ${expectedInsertBefore}`);
      }
    }
    if (!relocation.insertBefore && relocation.placement !== 'source-order') {
      fail(`${id} must declare source-order placement when it is not a slice-prefix relocation`);
    }
    const expectedStart = slice.range.startLine + firstSegment.sourceLocalRange.startLine - 1;
    const expectedEnd = slice.range.startLine + firstSegment.sourceLocalRange.endLine - 1;
    if (
      firstSegment.sourceRange.startLine !== expectedStart ||
      firstSegment.sourceRange.endLine !== expectedEnd
    ) {
      fail(`${id} local/global source ranges disagree`);
    }
    if (!Array.isArray(relocation.sectionIds) || relocation.sectionIds.length === 0) {
      fail(`${id} must record at least one canonical Section identity`);
    }
    const expectedPieces = [];
    for (const [index, segment] of sourceSegments.entries()) {
      const segmentSlice = slicesById.get(segment.sourceSlice);
      if (!segmentSlice) {
        fail(`${id} references unknown source slice ${segment.sourceSlice}`);
        continue;
      }
      const expectedSegmentStart = segmentSlice.range.startLine + segment.sourceLocalRange.startLine - 1;
      const expectedSegmentEnd = segmentSlice.range.startLine + segment.sourceLocalRange.endLine - 1;
      if (
        segment.sourceRange.startLine !== expectedSegmentStart ||
        segment.sourceRange.endLine !== expectedSegmentEnd
      ) {
        fail(`${id} source segment ${index + 1} local/global ranges disagree`);
      }
      const sourceStart = byteOffsetAtLine(baseline, segment.sourceRange.startLine);
      const sourceEnd = byteOffsetAtLine(baseline, segment.sourceRange.endLine + 1);
      const sliceStart = byteOffsetAtLine(baseline, segmentSlice.range.startLine);
      if (sourceStart === null || sourceEnd === null || sliceStart === null) {
        fail(`${id} source segment ${index + 1} has an invalid line range for byte verification`);
      } else if (
        Number.isInteger(segment.sourceStartByte) &&
        segment.sourceStartByte !== sourceStart - sliceStart
      ) {
        fail(`${id} source segment ${index + 1} sourceStartByte does not match its source-slice-local offset`);
      } else if (
        Number.isInteger(segment.sourceEndByteExclusive) &&
        segment.sourceEndByteExclusive !== sourceEnd - sliceStart
      ) {
        fail(`${id} source segment ${index + 1} sourceEndByteExclusive does not match its source-slice-local offset`);
      }
      if (!isCompleteBoundary(stateBefore(scan, segment.sourceRange.startLine))) {
        fail(`${id} source segment ${index + 1} starts inside a CSS structure`);
      }
      if (!isCompleteBoundary(scan.states[segment.sourceRange.endLine])) {
        fail(`${id} source segment ${index + 1} ends at an unsafe CSS boundary`);
      }
      expectedPieces.push(rangeText(
        baseline,
        segment.sourceRange.startLine,
        segment.sourceRange.endLine,
      ));
    }
    const expected = expectedPieces.join('');
    const sourceStart = byteOffsetAtLine(baseline, firstSegment.sourceRange.startLine);
    const firstSliceStart = byteOffsetAtLine(baseline, slice.range.startLine);
    const sourceEnd = byteOffsetAtLine(
      baseline,
      sourceSegments.at(-1).sourceRange.endLine + 1,
    );
    if (sourceStart === null || sourceEnd === null || firstSliceStart === null) {
      fail(`${id} has an invalid composite line range for byte verification`);
    } else {
      if (relocation.sourceStartByte !== sourceStart - firstSliceStart) {
        fail(`${id} sourceStartByte does not match its first source-slice-local offset`);
      }
      if (relocation.sourceEndByteExclusive !== sourceEnd - firstSliceStart) {
        fail(`${id} sourceEndByteExclusive does not match its composite source range`);
      }
    }
    const targetAbsolute = join(repoRoot, relocation.targetPath);
    if (!existsSync(targetAbsolute)) {
      fail(`${id} target is missing: ${relocation.targetPath}`);
      continue;
    }
    if (targetPaths.has(relocation.targetPath)) {
      fail(`${id} reuses semantic target path ${relocation.targetPath}`);
    }
    targetPaths.add(relocation.targetPath);
    const actual = normalize(readFileSync(targetAbsolute, 'utf8'));
    if (actual !== expected) {
      fail(`${id} target is not an exact baseline range copy`);
    }
    if (sha256(expected) !== relocation.sourceSha256) {
      fail(`${id} source SHA-256 does not match its recorded receipt`);
    }
    if (Buffer.byteLength(expected, 'utf8') !== relocation.sourceEndByteExclusive - relocation.sourceStartByte) {
      fail(`${id} recorded byte range does not match the exact source section`);
    }
  }
  const orderedSegments = relocations
    .flatMap((relocation) => relocationSegmentViews(relocation))
    .filter((relocation) => relocation.sourceRange?.startLine !== undefined)
    .slice()
    .sort((left, right) => left.sourceRange.startLine - right.sourceRange.startLine);
  for (let index = 1; index < orderedSegments.length; index += 1) {
    const previous = orderedSegments[index - 1];
    const current = orderedSegments[index];
    if (current.sourceRange.startLine <= previous.sourceRange.endLine) {
      fail(`${current.id} overlaps ${previous.id} in the canonical source order`);
    }
  }
  const ordered = relocations
    .map((relocation) => ({ relocation, firstSegment: relocationSourceSegments(relocation)[0] }))
    .filter(({ firstSegment }) => firstSegment?.sourceRange?.startLine !== undefined)
    .sort((left, right) => left.firstSegment.sourceRange.startLine - right.firstSegment.sourceRange.startLine);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].relocation;
    const current = ordered[index].relocation;
    if (
      Number.isInteger(previous.canonicalOrder) &&
      Number.isInteger(current.canonicalOrder) &&
      current.canonicalOrder <= previous.canonicalOrder
    ) {
      fail(`${current.id} canonical order is not increasing with its source position`);
    }
  }
  return relocations;
}

function verifyExactSourceFile(baseline, path, range, label) {
  const targetAbsolute = join(repoRoot, path);
  if (!existsSync(targetAbsolute)) {
    fail(`${label} target is missing: ${path}`);
    return null;
  }
  const expected = rangeText(baseline, range.startLine, range.endLine);
  const actual = normalize(readFileSync(targetAbsolute, 'utf8'));
  if (actual !== expected) {
    fail(`${label} target is not an exact baseline range copy`);
  }
  return {
    path,
    range,
    expected,
    actual,
    exact: actual === expected,
  };
}

function globalRangeForLocal(slice, localRange) {
  return {
    startLine: slice.range.startLine + localRange.startLine - 1,
    endLine: slice.range.startLine + localRange.endLine - 1,
  };
}

function orderedSourceParts(baseline, slice, relocations) {
  const relevant = relevantRelocationsForSlice(slice, relocations);
  if (Array.isArray(slice.sourceParts)) {
    const parts = [];
    const usedIds = new Set();
    const usedPaths = new Set();
    let cursor = 1;
    for (const declared of slice.sourceParts) {
      const id = declared.id || slice.id + '-part-' + (parts.length + 1);
      const localRange = declared.sourceRange;
      if (usedIds.has(id)) {
        fail(slice.id + ' source part ' + id + ' is declared more than once');
      }
      usedIds.add(id);
      if (usedPaths.has(declared.targetPath)) {
        fail(slice.id + ' source part target is reused: ' + declared.targetPath);
      }
      usedPaths.add(declared.targetPath);
      if (!localRange || !Number.isInteger(localRange.startLine) || !Number.isInteger(localRange.endLine)) {
        fail(slice.id + ' source part ' + id + ' has no complete local range');
        continue;
      }
      if (localRange.startLine !== cursor || localRange.startLine > localRange.endLine) {
        fail(slice.id + ' source parts are not contiguous at ' + id);
        continue;
      }
      if (localRange.endLine > slice.range.endLine - slice.range.startLine + 1) {
        fail(slice.id + ' source part ' + id + ' escapes the slice range');
        continue;
      }
      if (declared.kind !== 'remainder' && declared.kind !== 'semantic') {
        fail(slice.id + ' source part ' + id + ' has an unknown kind');
        continue;
      }
      const relocationId = declared.relocationId ?? declared.id;
      const relocation = declared.kind === 'semantic'
        ? relevant.find((candidate) => candidate.id === relocationId)
        : null;
      if (declared.kind === 'semantic') {
        if (!relocation) {
          fail(slice.id + ' source part ' + id + ' has no matching semantic relocation');
        } else if (
          relocation.sourceLocalRange.startLine !== localRange.startLine ||
          relocation.sourceLocalRange.endLine !== localRange.endLine ||
          relocation.targetPath !== declared.targetPath
        ) {
          fail(slice.id + ' source part ' + id + ' disagrees with its semantic relocation');
        }
      } else if (declared.relocationId) {
        fail(slice.id + ' remainder source part ' + id + ' must not carry relocationId');
      }
      const range = globalRangeForLocal(slice, localRange);
      verifyExactSourceFile(baseline, declared.targetPath, range, slice.id + '/' + id);
      parts.push({
        ...declared,
        id,
        path: declared.targetPath,
        range,
        localRange,
        targetRange: { startLine: 1, endLine: localRange.endLine - localRange.startLine + 1 },
      });
      cursor = localRange.endLine + 1;
    }
    const expectedCursor = slice.range.endLine - slice.range.startLine + 2;
    if (cursor !== expectedCursor) {
      fail(slice.id + ' source parts do not cover the complete slice');
    }
    for (const relocation of relevant) {
      if (!parts.some((part) => part.kind === 'semantic' && (part.relocationId ?? part.id) === relocation.id)) {
        fail(slice.id + ' is missing source part for ' + relocation.id);
      }
    }
    return parts;
  }

  const declaredRemainders = (manifest.remainderParts ?? [])
    .filter((part) => part.sourceSlice === slice.id)
    .slice()
    .sort((left, right) => left.sourceRange.startLine - right.sourceRange.startLine);
  if (relevant.length === 0) {
    if (declaredRemainders.length > 0) {
      fail(slice.id + ' declares remainder parts without a semantic relocation');
    }
    return [{
      kind: 'remainder',
      path: slice.targetPath,
      range: slice.range,
      id: slice.id + '-full',
    }];
  }

  const parts = [];
  const usedRemainders = new Set();
  const appendRemainder = (startLine, endLine) => {
    if (startLine > endLine) return;
    const candidates = declaredRemainders.filter(
      (part) =>
        part.sourceRange.startLine === startLine &&
        part.sourceRange.endLine === endLine,
    );
    if (candidates.length !== 1) {
      fail(
        slice.id + ' needs one remainder part for L' + startLine + '-L' + endLine + ', found ' + candidates.length,
      );
      return;
    }
    const part = candidates[0];
    if (usedRemainders.has(part.id)) {
      fail(slice.id + ' remainder part ' + part.id + ' is used more than once');
      return;
    }
    usedRemainders.add(part.id);
    verifyExactSourceFile(baseline, part.targetPath, part.sourceRange, part.id);
    parts.push({
      kind: 'remainder',
      ...part,
      path: part.targetPath,
      range: part.sourceRange,
    });
  };

  let cursor = slice.range.startLine;
  for (const relocation of relevant) {
    const startLine = relocation.sourceRange.startLine;
    const endLine = relocation.sourceRange.endLine;
    if (
      startLine < slice.range.startLine ||
      endLine > slice.range.endLine ||
      startLine > endLine ||
      startLine < cursor
    ) {
      fail(relocation.id + ' source range overlaps or escapes ' + slice.id);
      continue;
    }
    appendRemainder(cursor, startLine - 1);
    parts.push({
      kind: relocation.sourceSegmentContinuation ? 'semantic-continuation' : 'semantic',
      id: relocation.sourceSegmentContinuation
        ? `${relocation.id}@${relocation.sourceSlice}`
        : relocation.id,
      path: relocation.sourceSegmentContinuation ? null : relocation.targetPath,
      targetPath: relocation.targetPath,
      relocationId: relocation.id,
      range: relocation.sourceRange,
      targetRange: relocation.targetRange,
    });
    cursor = endLine + 1;
  }
  appendRemainder(cursor, slice.range.endLine);
  for (const part of declaredRemainders) {
    if (!usedRemainders.has(part.id)) {
      fail(slice.id + ' remainder part ' + part.id + ' is not reachable in source order');
    }
  }
  return parts;
}
function verifyExtraction(baseline, scan) {
  const entryPath = join(repoRoot, manifest.rootEntry.path);
  const entry = normalize(readFileSync(entryPath, 'utf8'));
  const { entryLines, imports: actualImports, bodyStart } = readEntryImports(entry);
  const extracted = manifest.slices.filter((slice) => slice.status === 'extracted');
  const relocations = verifySemanticRelocations(baseline, scan);
  const baseImports = manifest.rootEntry.entryImportOrder;
  const sourcePartsBySlice = extracted.map((slice) => ({
    slice,
    parts: orderedSourceParts(baseline, slice, relocations),
  }));
  const expectedImports = [
    ...baseImports,
    ...sourcePartsBySlice.flatMap(({ parts }) =>
      parts
        .filter((part) => part.kind !== 'semantic-continuation')
        .map((part) => entryImportPath(entryPath, part.path)),
    ),
  ];
  if (actualImports.length !== expectedImports.length) {
    fail(`Production entry import count mismatch: expected ${expectedImports.length}, got ${actualImports.length}`);
  }
  for (let index = 0; index < Math.max(actualImports.length, expectedImports.length); index += 1) {
    if (actualImports[index] !== expectedImports[index]) {
      fail(
        `Production entry import order mismatch at position ${index + 1}: expected ${expectedImports[index] ?? '(none)'}, got ${actualImports[index] ?? '(none)'}`,
      );
    }
  }
  const semanticImportPaths = relocations.map((relocation) => entryImportPath(entryPath, relocation.targetPath));
  for (const semanticImportPath of semanticImportPaths) {
    const occurrences = actualImports.filter((path) => path === semanticImportPath).length;
    if (occurrences !== 1) {
      fail(`Semantic relocation ${semanticImportPath} is loaded ${occurrences} times instead of exactly once`);
    }
  }
  const body = entryLines.length > bodyStart
    ? `${entryLines.slice(bodyStart).join('\n')}\n`
    : '';
  const pending = manifest.slices.filter((slice) => slice.status !== 'extracted');
  const expectedBody = pending
    .map((slice) => rangeText(baseline, slice.range.startLine, slice.range.endLine))
    .join('');
  if (body !== expectedBody) {
    fail('Root stylesheet remainder differs from the ordered untouched baseline remainder');
  }

  const sliceTexts = [];
  for (const { slice, parts } of sourcePartsBySlice) {
    const sourceTexts = parts.map((part) => {
      const targetPath = part.targetPath ?? part.path;
      const targetAbsolute = targetPath ? join(repoRoot, targetPath) : null;
      if (!targetAbsolute || !existsSync(targetAbsolute)) return '';
      const target = normalize(readFileSync(targetAbsolute, 'utf8'));
      return part.targetRange
        ? rangeText(target, part.targetRange.startLine, part.targetRange.endLine)
        : target;
    });
    const expected = parts
      .map((part) => rangeText(baseline, part.range.startLine, part.range.endLine))
      .join('');
    const actual = sourceTexts.join('');
    sliceTexts.push({
      id: slice.id,
      path: slice.targetPath,
      range: slice.range,
      expectedSha256: sha256(expected),
      actualSha256: sha256(actual),
      exact: actual === expected,
      partPaths: parts.map((part) => part.path),
      remainderPaths: parts.filter((part) => part.kind === 'remainder').map((part) => part.path),
    });
  }

  const importedSources = actualImports
    .slice(baseImports.length)
    .map((path) => {
      const absolute = resolve(dirname(entryPath), path);
      if (!existsSync(absolute)) {
        fail(`Production entry import target is missing: ${path}`);
        return '';
      }
      return normalize(readFileSync(absolute, 'utf8'));
    });
  const reconstructed =
    rangeText(baseline, 1, 2) +
    importedSources.join('') +
    body;
  if (reconstructed !== baseline) {
    fail('Logical source reconstruction from the real production entry is not byte-equivalent to the pinned baseline');
  }
  return {
    extracted: sliceTexts,
    semanticRelocations: relocations.map((relocation) => ({
      id: relocation.id,
      sourceSlice: relocation.sourceSlice,
      targetPath: relocation.targetPath,
      sourceRange: relocation.sourceRange,
      sourceSha256: relocation.sourceSha256,
      exact: true,
    })),
    productionEntry: {
      path: manifest.rootEntry.path,
      importOrder: actualImports,
      expectedImportOrder: expectedImports,
      orderEquivalent: actualImports.length === expectedImports.length &&
        actualImports.every((path, index) => path === expectedImports[index]),
    },
    pending: pending.map((slice) => slice.id),
    baselineSha256: sha256(baseline),
    reconstructedSha256: sha256(reconstructed),
    exact: reconstructed === baseline,
    rootEntryBytes: Buffer.byteLength(entry, 'utf8'),
    rootEntryLines: entryLines.length,
    stylesheetScanErrors: scan.errors,
  };
}

const baseline = readBaseline();
const baselineScan = scanCss(baseline);
if (baselineScan.errors.length > 0) {
  for (const error of baselineScan.errors) fail(`Baseline CSS structure: ${error}`);
}
verifyBaseline(baseline, baselineScan);
const canonicalMap = verifyCanonicalMap(readCanonicalMap());
const phase2CanonicalMap = verifyPhase2CanonicalMap(readPhase2CanonicalMap());
const boundaries = verifyMap(baseline, baselineScan);
const pathInventory = verifyPathInventory(baseline);
const readers = inventoryReaders();
let extraction = {
  skipped: preflightOnly,
  extracted: [],
  pending: manifest.slices.filter((slice) => slice.status !== 'extracted').map((slice) => slice.id),
};
if (!preflightOnly && baseline) extraction = verifyExtraction(baseline, baselineScan);

const result = {
  issue: manifest.issue,
  mode: preflightOnly ? 'preflight' : 'final-equivalence',
  status: failures.length === 0 ? 'pass' : 'fail',
  baseline: {
    commit: manifest.baseline.commit,
    sourcePath: manifest.baseline.sourcePath,
    sourceBlob: manifest.baseline.sourceBlob,
    lineCount: baselineScan.lines.length,
    scanErrors: baselineScan.errors,
  },
  canonicalMap,
  phase2CanonicalMap,
  map: {
    sliceCount: manifest.slices.length,
    coverage: manifest.coverage,
    candidateBoundaries: boundaries.candidateBoundaryChecks,
    actualBoundaries: boundaries.actualBoundaryChecks,
    adjustments: manifest.slices.filter((slice) => slice.boundaryAdjustment).map((slice) => ({ id: slice.id, ...slice.boundaryAdjustment })),
  },
  pathSensitive: pathInventory,
  directReaderSearch: {
    roots: manifest.readerReview.searchRoots,
    mentions: readers.mentions,
    likelyReaders: readers.likelyReaders,
    materiallyAffected: manifest.readerReview.materiallyAffected,
    sharedReader: manifest.readerReview.sharedReader,
  },
  extraction,
  warnings: warn,
  failures,
};

if (writeReceipt) {
  const directory = dirname(receiptPath);
  require('node:fs').mkdirSync(directory, { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

if (writeP2Receipt) {
  const preflightPath = join(
    repoRoot,
    'docs',
    'evidence',
    'issue-541-p2-01',
    'preflight.json',
  );
  const preflight = existsSync(preflightPath)
    ? JSON.parse(readFileSync(preflightPath, 'utf8'))
    : {};
  const relocation = manifest.semanticRelocations?.find(({ id }) => id === 'S11-01') ?? {};
  const productionEntry = result.extraction.productionEntry ?? {};
  const finalHead = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const p2Receipt = {
    issue: 541,
    phase: 'P2-01',
    canonicalSection: 'S11-01',
    segment: 'G097',
    startingMainHead: preflight.startingMainHead ?? null,
    finalHead,
    sourceBlobSha: preflight.sourceBlob ?? null,
    sectionStartLine: preflight.sourceLocalRange?.startLine ?? null,
    sectionEndLine: preflight.sourceLocalRange?.endLine ?? null,
    sectionStartByte: preflight.sectionStartByte ?? null,
    sectionEndByteExclusive: preflight.sectionEndByteExclusive ?? null,
    sectionSha256: preflight.sectionSha256 ?? null,
    predecessor: relocation.predecessor ?? null,
    successor: relocation.successor ?? null,
    targetPath: relocation.targetPath ?? null,
    productionEntryVerified: result.status === 'pass' && Boolean(productionEntry.path),
    realOrderEquivalent: productionEntry.orderEquivalent ?? false,
    missingSections: result.status === 'pass' ? 0 : null,
    duplicateSections: result.status === 'pass' ? 0 : null,
    viewModeFit: 'PENDING_HUMAN_ACCEPTANCE',
    viewModeActualSize: 'PENDING_HUMAN_ACCEPTANCE',
    actionPresetRegression: 'PENDING_HUMAN_ACCEPTANCE',
    windowsElectronSmoke: 'PENDING_HUMAN_ACCEPTANCE',
    targetedValidation: 'See verification.output and Issue #541 execution comment.',
    automaticCi: 'PENDING',
    MANUAL_FULL_TRIGGERED: false,
    VERIFY_PROJECT_MANUALLY_RUN: false,
    scopeExceptions: [],
    preflight,
    verification: result,
  };
  const directory = dirname(p2ReceiptPath);
  require('node:fs').mkdirSync(directory, { recursive: true });
  writeFileSync(p2ReceiptPath, `${JSON.stringify(p2Receipt, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
