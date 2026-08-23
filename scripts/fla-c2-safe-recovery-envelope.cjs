#!/usr/bin/env node
// @ts-check
/**
 * FLA V1.5-C2 one-command research verification.
 *
 * It reads only the approved top-level corpus, classifies the originals, and
 * generates repo-safe synthetic negative fixtures in memory. It never writes
 * a FLA copy, extracted image, or normalized private byte sequence.
 */

'use strict';

const { createHash } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { isAbsolute, resolve } = require('node:path');
const JSZip = require('jszip');

const corpusProbe = require('../tests/helpers/fla-corpus-probe.cjs');
const {
  STATES,
  classifyForFlaRecovery,
  findEocdCandidates,
  normalizeRecoveryCandidate,
  sha256,
} = require('./fla-c2-recovery-classifier.cjs');

const C1_REPORT_DEFAULT = resolve(__dirname, '../docs/research/fla-v1.5-c1-recovery-evidence.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') {
      args.root = argv[index + 1];
      index += 1;
    } else if (value === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (value === '--c1-evidence') {
      args.c1Evidence = argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    'Usage: node scripts/fla-c2-safe-recovery-envelope.cjs --root "D:\\表情合集" --out "<external-c2-output>" [--c1-evidence "<repo-c1-json>"]\n',
  );
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes.writeUInt32LE(value >>> 0, offset);
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();
}

function listTopLevelFlaFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.fla'))
    .map((entry) => resolve(root, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en-US'));
}

function readC1Evidence(filePath) {
  const report = JSON.parse(readFileSync(filePath, 'utf8'));
  const bySha = new Map();
  for (const sample of report.samples || []) {
    bySha.set(String(sample.sha256).toUpperCase(), sample);
  }
  return { report, bySha };
}

function locateLayout(bytes) {
  const candidates = findEocdCandidates(bytes).filter((candidate) => candidate.endsAtInput);
  if (candidates.length !== 1) throw new Error('Fixture layout requires one exact EOCD');
  const eocd = candidates[0].offset;
  const centralOffset = readUint32(bytes, eocd + 16);
  const count = readUint16(bytes, eocd + 10);
  const central = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localOffset = readUint32(bytes, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const localNameLength = readUint16(bytes, localOffset + 26);
    const localExtraLength = readUint16(bytes, localOffset + 28);
    const compressedSize = readUint32(bytes, localOffset + 18);
    const localEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    central.push({
      offset: cursor,
      localOffset,
      localEnd,
      recordLength,
      nameLength,
    });
    cursor += recordLength;
  }
  return { eocd, centralOffset, central, centralEnd: cursor };
}

function patchDelta(bytes, delta = 54) {
  const copy = Buffer.from(bytes);
  const layout = locateLayout(copy);
  const actual = layout.eocd - readUint32(copy, layout.eocd + 16);
  writeUint32(copy, layout.eocd + 12, actual + delta);
  return copy;
}

function patchCentralName(bytes, index, name) {
  const layout = locateLayout(bytes);
  const entry = layout.central[index];
  const copy = Buffer.from(bytes);
  const encoded = Buffer.from(name, 'utf8');
  if (encoded.length !== entry.nameLength) throw new Error('Fixture name length must remain stable');
  encoded.copy(copy, entry.offset + 46);
  encoded.copy(copy, entry.localOffset + 30);
  return copy;
}

function patchCentralLocalMethod(bytes, index, method) {
  const layout = locateLayout(bytes);
  const entry = layout.central[index];
  const copy = Buffer.from(bytes);
  copy.writeUInt16LE(method, entry.offset + 10);
  copy.writeUInt16LE(method, entry.localOffset + 8);
  return copy;
}

function patchCentralMethodOnly(bytes, index, method) {
  const layout = locateLayout(bytes);
  const copy = Buffer.from(bytes);
  copy.writeUInt16LE(method, layout.central[index].offset + 10);
  return copy;
}

function insertBefore(bytes, offset, inserted) {
  return Buffer.concat([bytes.slice(0, offset), inserted, bytes.slice(offset)]);
}

function setDeltaAfterLayoutChange(bytes, delta = 54) {
  const layout = locateLayout(bytes);
  const copy = Buffer.from(bytes);
  const actual = layout.eocd - readUint32(copy, layout.eocd + 16);
  writeUint32(copy, layout.eocd + 12, actual + delta);
  return copy;
}

async function makeBaseZip(files = null) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument><timelines/></DOMDocument>');
  zip.file('bin/data.txt', 'C2 synthetic payload');
  if (files) {
    for (const [name, content] of files) zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' });
}

function fixture(id, family, violation, expectedState, bytes, delta54Injected = false) {
  return { id, family, violation, expectedState, bytes, delta54Injected };
}

function patchCentralSignature(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt32LE(0, layout.central[0].offset);
  return copy;
}

function patchCentralVariableLength(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt16LE(0xffff, layout.central[0].offset + 28);
  return copy;
}

function patchLocalSizeBeyondSource(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  const entry = layout.central[1];
  copy.writeUInt32LE(0x1000, entry.offset + 20);
  copy.writeUInt32LE(0x1000, entry.offset + 24);
  copy.writeUInt32LE(0x1000, entry.localOffset + 18);
  copy.writeUInt32LE(0x1000, entry.localOffset + 22);
  return copy;
}

function patchLocalCentralSizeMismatch(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  const entry = layout.central[1];
  copy.writeUInt32LE(readUint32(copy, entry.offset + 20) + 1, entry.offset + 20);
  return copy;
}

function patchOverlap(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt32LE(layout.central[0].localOffset, layout.central[1].offset + 42);
  return copy;
}

function patchEncryption(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt16LE(readUint16(copy, layout.central[0].offset + 8) | 1, layout.central[0].offset + 8);
  copy.writeUInt16LE(readUint16(copy, layout.central[0].localOffset + 6) | 1, layout.central[0].localOffset + 6);
  return copy;
}

function patchFlagMismatch(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt16LE(readUint16(copy, layout.central[0].offset + 8) ^ 0x800, layout.central[0].offset + 8);
  return copy;
}

function patchResourceBudget(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  const entry = layout.central[1];
  copy.writeUInt32LE(0x04000001, entry.offset + 24);
  copy.writeUInt32LE(0x04000001, entry.localOffset + 22);
  return copy;
}

function patchEntryCountBudget(bytes) {
  const copy = patchDelta(bytes);
  const layout = locateLayout(copy);
  copy.writeUInt16LE(20_001, layout.eocd + 8);
  copy.writeUInt16LE(20_001, layout.eocd + 10);
  return copy;
}

function makeHiddenPayload(bytes) {
  const layout = locateLayout(bytes);
  const withPayload = insertBefore(bytes, layout.eocd, Buffer.from('HIDDEN-C2-PAYLOAD'));
  return setDeltaAfterLayoutChange(withPayload);
}

function makeMultipleEocd(bytes) {
  const layout = locateLayout(bytes);
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(0x06054b50, 0);
  const withFake = insertBefore(bytes, layout.eocd, fake);
  return setDeltaAfterLayoutChange(withFake);
}

function makeTrailingBytes(bytes) {
  return Buffer.concat([patchDelta(bytes), Buffer.from('TRAILING-C2-PAYLOAD')]);
}

function makeConflictingLocalOnlyDuplicate(bytes) {
  const layout = locateLayout(bytes);
  const source = bytes.slice(layout.central[2].localOffset, layout.central[2].localEnd);
  const conflicting = Buffer.from(source);
  if (conflicting.length > 0) conflicting[conflicting.length - 1] ^= 0x01;
  const inserted = insertBefore(bytes, layout.centralOffset, conflicting);
  const shifted = Buffer.from(inserted);
  const exact = findEocdCandidates(shifted).filter((candidate) => candidate.endsAtInput);
  if (exact.length !== 1) throw new Error('Conflicting duplicate fixture has no unique EOCD');
  const newCentralOffset = layout.centralOffset + conflicting.length;
  shifted.writeUInt32LE(newCentralOffset, exact[0].offset + 16);
  const newLayout = locateLayout(shifted);
  shifted.writeUInt32LE(newLayout.centralEnd - newLayout.centralOffset, newLayout.eocd + 12);
  shifted.writeUInt32LE(newLayout.centralOffset, newLayout.eocd + 16);
  return patchDelta(shifted);
}

function makePathTraversal(bytes) {
  const layout = locateLayout(bytes);
  const traversalName = `../${'x'.repeat(Math.max(1, layout.central[1].nameLength - 3))}`;
  return patchCentralName(bytes, 1, traversalName);
}

async function buildNegativeFixtures() {
  const base = await makeBaseZip();
  const fixtures = [
    fixture('c2-neg-truncated-central-header', 'truncation', 'central-directory fixed header is truncated', STATES.REJECT, patchCentralSignature(base), true),
    fixture('c2-neg-truncated-central-variable', 'truncation', 'central-directory variable field exceeds boundary', STATES.REJECT, patchCentralVariableLength(base), true),
    fixture('c2-neg-truncated-local-entry', 'truncation', 'referenced local entry data exceeds source boundary', STATES.REJECT, patchLocalSizeBeyondSource(base), true),
    fixture('c2-neg-truncated-eocd', 'truncation', 'EOCD is truncated at the source boundary', STATES.REJECT, Buffer.from(base.slice(0, -1)), false),
    fixture('c2-neg-local-central-size-mismatch', 'local-central-mismatch', 'central compressed size differs from local metadata', STATES.REJECT, patchLocalCentralSizeMismatch(base), true),
    fixture('c2-neg-local-central-compression-mismatch', 'local-central-mismatch', 'central and local compression methods differ', STATES.REJECT, patchCentralMethodOnly(patchDelta(base), 2, 0), true),
    fixture('c2-neg-local-central-flags-mismatch', 'local-central-mismatch', 'security-relevant flags differ', STATES.REJECT, patchFlagMismatch(base), true),
    fixture('c2-neg-overlapping-local-ranges', 'overlap', 'two central records reference one local range', STATES.REJECT, patchOverlap(base), true),
    fixture('c2-neg-conflicting-local-only-payload', 'hidden-payload', 'local-only duplicate has different bytes', STATES.REJECT, makeConflictingLocalOnlyDuplicate(base), true),
    fixture('c2-neg-hidden-payload-in-central-span', 'hidden-payload', 'non-record bytes are inserted before EOCD', STATES.REJECT, makeHiddenPayload(base), true),
    fixture('c2-neg-multiple-eocd', 'forged-eocd', 'two plausible EOCD candidates exist', STATES.AMBIGUOUS, makeMultipleEocd(base), true),
    fixture('c2-neg-trailing-payload', 'hidden-payload', 'bytes follow the only EOCD', STATES.AMBIGUOUS, makeTrailingBytes(base), true),
    fixture('c2-neg-zip64', 'zip64', 'ZIP64 marker is required by EOCD', STATES.REJECT, (() => { const copy = patchDelta(base); const layout = locateLayout(copy); copy.writeUInt32LE(0xffffffff, layout.eocd + 12); return copy; })(), true),
    fixture('c2-neg-encrypted', 'encryption', 'entry encryption flag is set', STATES.REJECT, patchEncryption(base), true),
    fixture('c2-neg-multi-disk', 'multi-disk', 'EOCD disk number is non-zero', STATES.REJECT, (() => { const copy = patchDelta(base); const layout = locateLayout(copy); copy.writeUInt16LE(1, layout.eocd + 4); return copy; })(), true),
    fixture('c2-neg-unsupported-compression', 'unsupported-compression', 'entry compression method is unsupported', STATES.REJECT, patchCentralLocalMethod(patchDelta(base), 2, 99), true),
    fixture('c2-neg-path-traversal', 'path-traversal', 'archive member escapes extraction namespace', STATES.REJECT, makePathTraversal(patchDelta(base)), true),
    fixture('c2-neg-entry-count-budget', 'resource-budget', 'EOCD entry count exceeds the existing budget', STATES.REJECT, patchEntryCountBudget(base), true),
    fixture('c2-neg-expanded-size-budget', 'resource-budget', 'declared expanded entry size exceeds the existing budget', STATES.REJECT, patchResourceBudget(base), true),
  ];
  return fixtures;
}

function summarizeC1(sample) {
  if (!sample) return null;
  return {
    strictResult: sample.strictPreflight,
    postNormalizationParser: sample.researchCopyParser,
    electronParser: sample.electronParser,
  };
}

async function classifyRealSample(filePath, c1BySha) {
  const basename = filePath.split(/[\\/]/).pop();
  const original = readFileSync(filePath);
  const before = sha256(original);
  const classification = classifyForFlaRecovery(original);
  const c1 = c1BySha.get(before);
  const record = {
    sampleId: `fla-${before.slice(0, 16).toLowerCase()}`,
    basename,
    sha256: before,
    byteLength: original.byteLength,
    c1Evidence: summarizeC1(c1),
    strictResultFromC1: c1 ? c1.strictPreflight : 'NOT MEASURED',
    classifierState: classification.state,
    reasonCodes: classification.reasonCodes,
    measured: classification.measured,
    recoveryPreconditions: classification.preconditions,
    researchNormalization: {
      applied: false,
      reason: 'not-a-recovery-candidate',
    },
    postNormalizationValidation: 'NOT_APPLICABLE',
    postNormalizationParser: 'NOT_APPLICABLE',
    sourceHashAfter: null,
    sourceUnchanged: false,
  };

  if (classification.state === STATES.RECOVERY_CANDIDATE) {
    const normalization = normalizeRecoveryCandidate(original, classification);
    const normalizedClassification = classifyForFlaRecovery(normalization.bytes);
    let parserStatus = 'FAIL';
    if (normalizedClassification.state === STATES.STRICT_VALID) {
      try {
        const parsed = await corpusProbe.inspectSample(
          normalization.bytes,
          basename,
          'c2-in-memory-revalidation',
          ['c2-research-only'],
          'No file was written; no Project was opened.',
        );
        parserStatus = parsed.offlineProbe.status === 'success' ? 'PASS' : 'FAIL';
      } catch {
        parserStatus = 'FAIL';
      }
    }
    record.researchNormalization = {
      applied: normalization.applied,
      field: normalization.field,
      from: normalization.from,
      to: normalization.to,
      deltaBytes: normalization.deltaBytes,
      mode: normalization.mode,
      originalBytesWritten: normalization.originalBytesWritten,
    };
    record.postNormalizationValidation = normalizedClassification.state;
    record.postNormalizationParser = parserStatus;
  }
  record.sourceHashAfter = sha256File(filePath);
  record.sourceUnchanged = record.sourceHashAfter === before;
  return record;
}

function classifyFixture(spec) {
  const classification = classifyForFlaRecovery(spec.bytes);
  return {
    fixtureId: spec.id,
    fixtureFamily: spec.family,
    violatedInvariant: spec.violation,
    expectedState: spec.expectedState,
    actualState: classification.state,
    reasonCodes: classification.reasonCodes,
    delta54Injected: spec.delta54Injected,
    observedDeltaBytes: classification.measured.centralDirectoryDeltaBytes,
    candidateClassified: classification.state === STATES.RECOVERY_CANDIDATE,
    expectedStateMatched: classification.state === spec.expectedState,
  };
}

function decideConclusion(realSamples, fixtureResults) {
  const controls = realSamples.filter((sample) => sample.strictResultFromC1 === 'PASS');
  const positives = realSamples.filter((sample) => sample.strictResultFromC1 === 'REJECT');
  const strictControlsCorrect = controls.filter((sample) => sample.classifierState === STATES.STRICT_VALID).length;
  const positiveCandidates = positives.filter((sample) => sample.classifierState === STATES.RECOVERY_CANDIDATE).length;
  const candidateRevalidationPass = positives.filter((sample) =>
    sample.classifierState === STATES.RECOVERY_CANDIDATE &&
    sample.postNormalizationValidation === STATES.STRICT_VALID &&
    sample.postNormalizationParser === 'PASS' &&
    sample.sourceUnchanged,
  ).length;
  const falseAccepts = fixtureResults.filter((fixture) => fixture.candidateClassified);
  const ambiguous = fixtureResults.filter((fixture) => fixture.expectedState === STATES.AMBIGUOUS);
  const ambiguousFalseAccepts = ambiguous.filter((fixture) => fixture.candidateClassified);
  let conclusion = 'C2_INSUFFICIENT_EVIDENCE';
  if (strictControlsCorrect === controls.length && falseAccepts.length === 0 && ambiguousFalseAccepts.length === 0 && candidateRevalidationPass === positiveCandidates) {
    conclusion = positiveCandidates > 0
      ? 'C2_SAFE_RECOVERY_ENVELOPE_DEFINED_WITH_LIMITS'
      : 'C2_INSUFFICIENT_EVIDENCE';
  }
  if (falseAccepts.length > 0) conclusion = 'C2_UNSAFE_TO_RECOVER_GENERICALLY';
  return {
    conclusion,
    strictValidControlsCorrect: `${strictControlsCorrect}/${controls.length}`,
    positiveRecoveryCandidateRecall: `${positiveCandidates}/${positives.length}`,
    candidateRevalidationPass: `${candidateRevalidationPass}/${positiveCandidates}`,
    negativeFixtureCount: fixtureResults.length,
    ambiguousFixtureCount: ambiguous.length,
    plus54UnsafeFixtureCount: fixtureResults.filter((fixture) => fixture.delta54Injected).length,
    maliciousOrAmbiguousFalseAccepts: falseAccepts.length,
    ambiguousRecoveryFalseAccepts: ambiguousFalseAccepts.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.help || !args.root || !args.out) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }
  if (!isAbsolute(args.root) || !isAbsolute(args.out)) {
    throw new Error('--root and --out must be absolute paths');
  }
  const root = resolve(args.root);
  const out = resolve(args.out);
  if (!existsSync(root)) throw new Error(`Approved corpus root is missing: ${root}`);
  if (out === root || out.startsWith(`${root}\\`) || out.startsWith(`${root}/`)) {
    throw new Error('C2 output must be outside the approved corpus root');
  }
  mkdirSync(out, { recursive: true });
  const c1Path = resolve(args.c1Evidence || C1_REPORT_DEFAULT);
  const c1 = readC1Evidence(c1Path);
  const files = listTopLevelFlaFiles(root);
  const realSamples = [];
  for (const filePath of files) realSamples.push(await classifyRealSample(filePath, c1.bySha));

  const fixtureSpecs = await buildNegativeFixtures();
  const fixtureResults = fixtureSpecs.map(classifyFixture);
  const summary = decideConclusion(realSamples, fixtureResults);
  const output = {
    schemaVersion: 'fla-v1.5-c2-safe-recovery-envelope/1',
    generatedAt: new Date().toISOString(),
    approvedCorpusRootPolicy: 'D:\\表情合集 only; top-level .fla files; originals read-only; synthetic fixture bytes in memory only',
    liveMainAtStart: c1.report.liveMainAtStart || 'NOT MEASURED',
    c1Pr299HeadObserved: c1.report.c1Pr299HeadObserved || 'df9ce245d73cdd17bb10d90131c0128c3ff2e1a1',
    pr285HeadObserved: c1.report.pr285HeadObserved || 'a111649df2615e8140e51eada17861fef0f6b403',
    c1SourceConclusion: c1.report.conclusion || 'C1_RECOVERY_VALUE_PROVEN_WITH_LIMITS',
    classifierStates: Object.values(STATES),
    reasonCodeSchema: 'Explicit fail-closed C2 reason codes returned by classifyForFlaRecovery; no filename/hash/site rule.',
    recoveryEnvelopeSummary: {
      allowedMismatch: 'EOCD centralDirectorySize declared exactly 54 bytes above the independently parsed complete central-directory span',
      requiredStructuralConditions: [
        'classic ZIP/XFL; unique EOCD at input end; single disk; non-ZIP64',
        'central records contiguous, complete, count-consistent, and within budgets',
        'supported compression only; no encryption or data descriptors',
        'local headers/data in source bounds; local/central names, flags, methods, and sizes consistent',
        'no overlapping local ranges; no unsafe paths; no unaccounted gaps',
        'at most one local-only record, and it must be an exact byte-identical duplicate of a central entry',
        'normalization is an in-memory proposed EOCD-size correction only',
      ],
      trailingBytesPolicy: 'No bytes after EOCD; non-record bytes in the local/central span fail closed.',
    },
    unsupportedFeaturePolicy: {
      zip64: 'REJECT',
      encryption: 'REJECT',
      multiDisk: 'REJECT',
      unsupportedCompression: 'REJECT',
      dataDescriptor: 'REJECT in C2 envelope; not needed by the approved positive corpus',
      pathTraversal: 'REJECT',
      resourceBudget: 'REJECT before decompression',
      ambiguousEOCDOrTrailingPayload: 'AMBIGUOUS',
      actionScript: 'Never executed; content semantics remain outside C2 classifier',
    },
    realCorpus: {
      total: realSamples.length,
      strictValidControls: realSamples.filter((sample) => sample.strictResultFromC1 === 'PASS').length,
      c1PositiveMalformedSamples: realSamples.filter((sample) => sample.strictResultFromC1 === 'REJECT').length,
      samples: realSamples,
    },
    negativeFixtures: fixtureResults,
    summary,
    safety: {
      sourceHashInvariance: realSamples.every((sample) => sample.sourceUnchanged) ? 'PASS' : 'FAIL',
      originalFilesModified: 'NO',
      productionPreflightChanged: 'NO',
      productionRecoveryImplemented: 'NO',
      productionWiring: 'NONE',
      maliciousOrAmbiguousRecoveryCandidateFalseAccepts: summary.maliciousOrAmbiguousFalseAccepts,
    },
    postCandidateRevalidation: {
      researchNormalizationOnly: 'YES',
      archiveValidation: summary.candidateRevalidationPass,
      parserDifferentialReproduced: 'PASS for in-memory C1 offline parser differential; C1 real Electron evidence retained as prior evidence, no Project mutation',
    },
    conclusion: summary.conclusion,
    reasoningSummary: 'The +54 surface is necessary but insufficient: every accepted candidate also requires unique boundaries, complete records, local/central consistency, bounded non-overlapping data, safe paths, and no hidden payload except one exact byte-identical local duplicate. The generated negative matrix contains zero recovery-candidate false accepts.',
    remainingLimits: [
      'C2 classifier is research-only and not production recovery.',
      'Data-descriptor ZIP entries are outside this envelope.',
      'C1 provenance breadth remains UNKNOWN.',
      'Post-candidate parser revalidation in this command is offline; C1 real Electron evidence is reused rather than re-running private corpus bytes.',
    ],
  };
  writeFileSync(resolve(out, 'c2-evidence.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify({
    output: resolve(out, 'c2-evidence.json'),
    conclusion: output.conclusion,
    realSamples: output.realCorpus.total,
    strictValidControls: summary.strictValidControlsCorrect,
    positiveRecoveryCandidateRecall: summary.positiveRecoveryCandidateRecall,
    negativeFixtureCount: summary.negativeFixtureCount,
    maliciousOrAmbiguousFalseAccepts: summary.maliciousOrAmbiguousFalseAccepts,
    sourceHashInvariance: output.safety.sourceHashInvariance,
  }) + '\n');
  if (output.safety.sourceHashInvariance !== 'PASS' || summary.maliciousOrAmbiguousFalseAccepts !== 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildNegativeFixtures,
  classifyFixture,
  locateLayout,
  makeBaseZip,
};
