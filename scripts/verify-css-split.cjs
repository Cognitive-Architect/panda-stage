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
const receiptPath = join(
  repoRoot,
  'docs',
  'evidence',
  'issue-530-css-split',
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

function verifyExtraction(baseline, scan) {
  const entryPath = join(repoRoot, manifest.rootEntry.path);
  const entry = normalize(readFileSync(entryPath, 'utf8'));
  const entryLines = linesOf(entry);
  const extracted = manifest.slices.filter((slice) => slice.status === 'extracted');
  const expectedImports = [
    "@import './styles/tokens.css';",
    "@import './styles/primitives.css';",
    ...extracted.map((slice) => {
      const importPath = relative(dirname(entryPath), join(repoRoot, slice.targetPath)).replaceAll('\\', '/');
      return `@import './${importPath.replace(/^\.\//u, '')}';`;
    }),
  ];
  for (let index = 0; index < expectedImports.length; index += 1) {
    if (entryLines[index] !== expectedImports[index]) {
      fail(`Root import order mismatch at line ${index + 1}: expected ${expectedImports[index]}`);
    }
  }
  const importCount = expectedImports.length;
  const body = entryLines.length > importCount
    ? `${entryLines.slice(importCount).join('\n')}\n`
    : '';
  const pending = manifest.slices.filter((slice) => slice.status !== 'extracted');
  const expectedBody = pending
    .map((slice) => rangeText(baseline, slice.range.startLine, slice.range.endLine))
    .join('');
  if (body !== expectedBody) {
    fail('Root stylesheet remainder differs from the ordered untouched baseline remainder');
  }

  const sliceTexts = [];
  for (const slice of extracted) {
    const targetAbsolute = join(repoRoot, slice.targetPath);
    if (!existsSync(targetAbsolute)) {
      fail(`${slice.id} target is missing: ${slice.targetPath}`);
      continue;
    }
    const actual = normalize(readFileSync(targetAbsolute, 'utf8'));
    const expected = rangeText(baseline, slice.range.startLine, slice.range.endLine);
    if (actual !== expected) fail(`${slice.id} target is not an exact baseline range copy`);
    sliceTexts.push({
      id: slice.id,
      path: slice.targetPath,
      range: slice.range,
      expectedSha256: sha256(expected),
      actualSha256: sha256(actual),
      exact: actual === expected,
    });
  }

  const reconstructed =
    rangeText(baseline, 1, 2) +
    extracted
      .map((slice) => rangeText(baseline, slice.range.startLine, slice.range.endLine))
      .join('') +
    body;
  if (reconstructed !== baseline) {
    fail('Logical source reconstruction is not byte-equivalent to the pinned baseline');
  }
  return {
    extracted: sliceTexts,
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

console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
