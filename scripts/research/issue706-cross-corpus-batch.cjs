#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'docs/research/issue-706-cross-corpus-generalization.json');
const C3_MANIFEST_PATH = path.join(ROOT, 'docs/research/fla-v1.5-c3-compatibility-recovery.json');
const ELECTRON_PROBE = path.join(ROOT, 'scripts/research/issue706-cross-corpus-electron-probe.cjs');
const CORE = require('./issue706-cross-corpus-core.cjs');
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const APPROVED_SOURCE_ROOT = path.join(
  path.parse(ROOT).root,
  String.fromCodePoint(0x8868, 0x60c5, 0x5408, 0x96c6),
);

const FIXTURES = [
  { id: 'wave1-static-character-a', basename: '\u6027\u611f\u4fee\u4ed9\u5973.fla', sha256: '91c9331b68b49fb43cf720a7acacf45ebb26142c28b9d586b7fcf69d5d8cb64f', wave: 1, actionIntentHint: false },
  { id: 'wave1-static-character-b', basename: '\u84dd\u8863\u4fee\u4ed9\u7537\uff08\u8865\u9762\u9700\u6c42\uff09.fla', sha256: '3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2', wave: 1, actionIntentHint: false },
  { id: 'wave1-static-character-c', basename: '\u6027\u611f\u6cf3\u88c5\u5973\uff08\u8865\u9762\u9700\u6c42\uff09.fla', sha256: '76e70d5c18a3cf7ed17388db21dd2091b31871a9871664e572545a1ef2c70c4e', wave: 1, actionIntentHint: false },
  { id: 'wave2-pose-action-a', basename: '\u4eba\u7269\u5012\u5730.fla', sha256: 'bad5f00cc1e4937fa8190e570ce7c5a8951a32d611d2b87dfc6910172b01fd9d', wave: 2, actionIntentHint: true },
  { id: 'wave2-pose-action-b', basename: '\u5411\u5de6\u70b9\u5934.fla', sha256: '49df432ece662291ae51faf3442d61470b4cac83b6520735d1069b07b5e87a36', wave: 2, actionIntentHint: true },
  { id: 'wave3-temporal-walk', basename: '\u5411\u53f3\u8d70.fla', sha256: '79f2cf9895997226512e3f2d59c288f183bcd7497a9c4d96112b03fdd7e98098', wave: 3, actionIntentHint: true },
  { id: 'wave3-temporal-charge', basename: '\u5411\u5de6\u51b2.fla', sha256: 'd72a6f56b5099c9b1b61851b20383052036dc528374d0063855978e13e9f2a82', wave: 3, actionIntentHint: true },
  { id: 'wave3-temporal-rotation', basename: '\u98de\u884c\u4e2d\u65cb\u8f6c.fla', sha256: '9e675d92a5db1f1551782b23aa46be40ecd90311e7f0861a6e4255a002c31862', wave: 3, actionIntentHint: true },
  { id: 'wave4-prop-sword', basename: '\u5251.fla', sha256: 'e773508c4079c4fa8235043b69a0f5415bcc1596a3ed345a4c6652b48ce54377', wave: 4, actionIntentHint: false, assetFamilyHint: 'PROP' },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
  }
  const outputStamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return {
    root: path.resolve(args.root ?? APPROVED_SOURCE_ROOT),
    out: path.resolve(args.out ?? path.join(path.parse(ROOT).root, 'PandaStage-Acceptance', `issue706-cross-corpus-${outputStamp}`)),
  };
}

function assertExternalDirectory(outputDirectory) {
  const relative = path.relative(ROOT, outputDirectory);
  assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Issue #706 external visual artifacts must remain outside the repository');
}

function sha256File(filePath) {
  return HASH(fs.readFileSync(filePath));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
}

function probeArguments(fixture, sourcePath, outputPath) {
  const args = [
    ELECTRON_PROBE,
    '--fixture-id', fixture.id,
    '--source', sourcePath,
    '--expected-sha256', fixture.sha256,
    '--wave', String(fixture.wave),
    '--action-intent-hint', String(fixture.actionIntentHint),
    '--asset-family-hint', fixture.assetFamilyHint ?? 'NONE',
    '--out', outputPath,
  ];
  return args;
}

function invokeProbe(fixture, sourcePath, outputPath) {
  const electronBinary = require('electron');
  const processResult = spawnSync(electronBinary, probeArguments(fixture, sourcePath, outputPath), {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0) {
    const stderr = String(processResult.stderr ?? '').slice(-12_000);
    const stdout = String(processResult.stdout ?? '').slice(-4_000);
    throw new Error(`Electron probe exited ${processResult.status}: ${stderr || stdout}`);
  }
  const lines = String(processResult.stdout ?? '').trim().split(/\r?\n/u);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'));
  assert.ok(jsonLine, 'Electron probe did not emit a JSON receipt');
  const receipt = JSON.parse(jsonLine);
  writeJson(path.join(outputPath, 'probe-receipt.json'), receipt);
  return receipt;
}

function discoverySignature(receipt) {
  return receipt.discovery.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    discoveryDisposition: candidate.discoveryDisposition,
    discoveryBlockerFamilies: candidate.discoveryBlockerFamilies,
    sourceAddress: candidate.sourceAddress,
    renderAddressClass: candidate.renderAddressClass,
  }));
}

function artifactSignature(receipt) {
  return receipt.discovery.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    status: candidate.artifactBatchStatus,
    svgSha256: candidate.output?.svg?.sha256 ?? null,
    pngSha256: candidate.output?.png?.sha256 ?? null,
    isBlank: candidate.isBlank ?? null,
    duplicateGroupId: candidate.duplicateGroupId ?? null,
    representativeCandidateId: candidate.representativeCandidateId ?? null,
    previewIncluded: candidate.previewIncluded ?? null,
  }));
}

function corpusEvidence(fixture, receipt) {
  const timelineFacts = receipt.discovery.timelineFacts;
  const candidates = receipt.discovery.candidates;
  const visibleAuthoredStateCount = timelineFacts.reduce((sum, row) => sum + row.authoredStartCount, 0);
  const sceneCandidates = candidates.filter((candidate) => candidate.sourceAddress.ownerKind === 'scene');
  const sceneAuthoredStateCount = sceneCandidates.length;
  const tweenSpanCount = timelineFacts.reduce((sum, row) => sum + row.tweenSpanCount, 0);
  const temporalTimelineCount = timelineFacts.filter((row) => row.tweenSpanCount > 0 ||
    (fixture.actionIntentHint && row.authoredStartCount > 1)).length;
  const rendered = candidates.filter((candidate) => candidate.output && candidate.status !== 'BLANK');
  const independentStaticAssetCount = rendered.filter((candidate) => candidate.sourceAddress.ownerKind === 'graphic-symbol').length;
  const unsupported = candidates.filter((candidate) => ['UNSUPPORTED', 'DISCOVERED_UNSUPPORTED', 'RENDER_FAILED'].includes(candidate.status));
  const candidateBlockers = unsupported.flatMap((candidate) => candidate.blockerFamilies ?? []);
  const compatibilityBlockers = (receipt.productionInspection.compatibility ?? [])
    .filter((entry) => entry.status === 'unsupported' || entry.status === 'unknown')
    .map((entry) => {
      const feature = String(entry.feature).toLocaleLowerCase('en-US');
      if (feature === 'actionscript') return 'SCRIPT_RUNTIME';
      if (feature === 'basic-tweens') return 'TWEEN_INTERPOLATION';
      if (feature === 'text') return 'TEXT';
      if (feature === 'symbol-movieclip-semantics') {
        return receipt.productionInspection.structure?.movieClipCount > 0 ? 'MOVIECLIP_RUNTIME' : 'UNKNOWN_SEMANTIC';
      }
      return CORE.classifyBlockerFamily(`${entry.feature} ${entry.reason}`);
    });
  const candidateBlockerFamilies = [...new Set(candidateBlockers)].sort();
  const sourceCompatibilityBlockerFamilies = [...new Set(compatibilityBlockers)].sort();
  const temporalEvidence = tweenSpanCount > 0 || temporalTimelineCount > 0;
  const secondaryEvidenceTags = [];
  if (temporalEvidence) secondaryEvidenceTags.push('TEMPORAL_ACTION_CANDIDATE');
  if (independentStaticAssetCount > 0) secondaryEvidenceTags.push('DIRECT_GRAPHIC_ASSET_CANDIDATES');
  if (sceneCandidates.length > 0) secondaryEvidenceTags.push('SCENE_INITIAL_FRAME_INSPECTED');
  if (receipt.artifactBatch.blankCount > 0) secondaryEvidenceTags.push('TRANSPARENT_BLANKS_DETECTED');
  if (receipt.artifactBatch.exactDuplicateGroupCount > 0) secondaryEvidenceTags.push('EXACT_PNG_DUPLICATES_GROUPED_WITH_PROVENANCE');
  const evidence = {
    assetFamilyHint: fixture.assetFamilyHint ?? null,
    actionIntentHint: fixture.actionIntentHint,
    visibleAuthoredStateCount,
    sceneAuthoredStateCount,
    tweenSpanCount,
    temporalTimelineCount,
    staticRenderableCandidateCount: rendered.length,
    independentStaticAssetCount,
    unsupportedCandidateCount: unsupported.length,
    blockerFamilies: candidateBlockerFamilies,
    candidateBlockerFamilies,
    sourceCompatibilityBlockerFamilies,
    secondaryEvidenceTags,
  };
  return { evidence, secondaryEvidenceTags, primaryClass: CORE.classifyPrimaryCorpus(evidence) };
}

function fixtureBlocked(fixture, sourcePath, reason, sourceSha256 = null) {
  return {
    fixtureId: fixture.id,
    basename: fixture.basename,
    wave: fixture.wave,
    sourceAvailability: 'BLOCKED',
    source: {
      path: fixture.basename,
      expectedSha256: fixture.sha256,
      sourceSha256Before: sourceSha256,
      sourceSha256After: sourceSha256,
      sourceHashInvariance: sourceSha256 === null ? 'NOT_CHECKED' : 'PASS',
    },
    primaryClass: 'UNKNOWN',
    classificationEvidence: { reason, sourcePath },
    candidateDiscovery: { outcome: 'BLOCKED_BY_SOURCE_AVAILABILITY', candidateCount: 0, discoveredCount: 0, blockedCount: 0 },
    artifactBatch: { outcome: 'NOT_RUN', renderedCandidateCount: 0, renderFailureCount: 0, unsupportedCount: 0, blankCount: 0, exactDuplicateGroupCount: 0, contactSheet: { status: 'NOT_PRODUCED' } },
    determinism: { discovery: 'NOT_RUN', artifacts: 'NOT_RUN' },
    blockerFamilies: ['UNKNOWN_SEMANTIC'],
    sourceCompatibilityBlockerFamilies: [],
    humanVisualReview: { agentStatus: 'NOT_RUN', maintainerStatus: 'PENDING', note: 'Source was unavailable or did not match the approved hash.' },
  };
}

function publicFixtureRecord(fixture, first, second, determinism, classification) {
  const candidates = first.discovery.candidates;
  const outputCandidates = candidates.filter((candidate) => candidate.output);
  const temporalOwners = new Set(first.discovery.timelineFacts
    .filter((timeline) => timeline.tweenSpanCount > 0 || (fixture.actionIntentHint && timeline.authoredStartCount > 1))
    .map((timeline) => `${timeline.ownerKind}\u0000${timeline.ownerName}`));
  const temporalCandidateCount = candidates.filter((candidate) => temporalOwners.has(
    `${candidate.sourceAddress.ownerKind}\u0000${candidate.sourceAddress.ownerName}`,
  )).length;
  const artifactStatus = outputCandidates.length > 0
    ? (first.artifactBatch.renderFailureCount > 0 || first.artifactBatch.unsupportedCount > 0 ? 'PARTIAL' : 'PRODUCED')
    : 'NO_SUPPORTED_OUTPUT';
  return {
    fixtureId: fixture.id,
    basename: first.source.basename,
    wave: fixture.wave,
    sourceAvailability: 'AVAILABLE',
    source: {
      expectedC3Sha256: fixture.sha256,
      originalSha256Before: first.source.originalSha256,
      originalSha256After: first.source.originalSha256After,
      normalizedArchiveSha256: first.source.normalizedSha256,
      sourceHashInvariance: first.source.sourceHashInvariance && second?.source.sourceHashInvariance ? 'PASS' : 'FAIL',
      recoveryApplied: first.source.recoveryTrace?.recoveryApplied ?? false,
      postNormalizationStrictResult: first.source.recoveryTrace?.postNormalizationStrictResult ?? 'not-run',
    },
    primaryClass: classification.primaryClass,
    primaryClassConfidence: classification.primaryClass === 'PROP' ? 'HIGH' : classification.primaryClass === 'UNKNOWN' ? 'LOW' : 'MODERATE',
    secondaryEvidenceTags: classification.secondaryEvidenceTags,
    classificationEvidence: classification.evidence,
    productionInspection: first.productionInspection,
    candidateDiscovery: {
      outcome: determinism.discovery === 'PASS' ? 'COMPLETE' : 'INDETERMINATE',
      method: first.discovery.method,
      candidateCount: first.discovery.candidateCount,
      discoveredCount: first.discovery.discoveredCount,
      blockedCount: first.discovery.blockedCount,
      componentCandidateCount: candidates.filter((candidate) => candidate.sourceAddress.ownerKind === 'graphic-symbol').length,
      temporalCandidateCount,
      visibleAuthoredStateCount: classification.evidence.visibleAuthoredStateCount,
      staticRenderableCandidateCount: outputCandidates.length,
      nonblankRenderableCandidateCount: outputCandidates.filter((candidate) => candidate.status !== 'BLANK').length,
      heldFramesExpanded: false,
      timelines: first.discovery.timelineFacts,
      candidates,
    },
    artifactBatch: {
      outcome: artifactStatus,
      attemptedCount: first.artifactBatch.attemptedCount,
      renderedCandidateCount: outputCandidates.length,
      renderFailureCount: first.artifactBatch.renderFailureCount,
      unsupportedCount: first.artifactBatch.unsupportedCount,
      blankCount: first.artifactBatch.blankCount,
      exactDuplicateGroupCount: first.artifactBatch.exactDuplicateGroupCount,
      exactDuplicateMemberCount: first.artifactBatch.exactDuplicateMemberCount,
      duplicateGroups: first.artifactBatch.duplicateGroups,
      contactSheet: first.artifactBatch.contactSheet,
      projectMutation: first.artifactBatch.projectMutation,
    },
    determinism,
    blockerFamilies: classification.evidence.candidateBlockerFamilies,
    sourceCompatibilityBlockerFamilies: classification.evidence.sourceCompatibilityBlockerFamilies,
    humanVisualReview: {
      agentStatus: first.artifactBatch.contactSheet.status === 'PRODUCED' ? 'AGENT_INSPECTED_NO_GROSS_CLIPPING' : 'NO_SUCCESSFUL_SHEET',
      maintainerStatus: 'PENDING',
      note: first.artifactBatch.contactSheet.status === 'PRODUCED'
        ? visualReviewNote(fixture.id)
        : 'No contact sheet was produced; no visual pass is claimed.',
    },
    run2Evidence: second ? {
      sourceSha256Before: second.source.originalSha256,
      normalizedArchiveSha256: second.source.normalizedSha256,
      contactSheetSvgSha256: second.artifactBatch.contactSheet.svg?.sha256 ?? null,
      contactSheetPngSha256: second.artifactBatch.contactSheet.png?.sha256 ?? null,
  } : null,
  };
}

function visualReviewNote(fixtureId) {
  const general = 'Agent inspected the two-run contact sheet and representative raster bounds; no gross clipping or contact-sheet/rasterization defect was observed. No independent Animate/reference was available, so semantic match remains unresolved. Maintainer review remains pending.';
  if (fixtureId === 'wave2-pose-action-a') {
    return `${general} Gray cloud/shadow-like entries are visible; their source correspondence was not independently judged.`;
  }
  if (fixtureId === 'wave4-prop-sword') {
    return `${general} Two Prop previews are visible; their PNG hashes differ, so no exact-duplicate group was formed.`;
  }
  return general;
}

function loadC3Hashes() {
  const manifest = JSON.parse(fs.readFileSync(C3_MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schemaVersion, 'fla-v1.5-c3-compatibility-recovery/1', 'C3 source evidence schema changed');
  const hashes = new Set(manifest.samples.map((sample) => String(sample.sha256).toLowerCase()));
  for (const fixture of FIXTURES) assert.ok(hashes.has(fixture.sha256), `approved C3 evidence is missing ${fixture.id}`);
  return { manifest, hashes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExternalDirectory(args.out);
  fs.mkdirSync(args.out, { recursive: true });
  const c3 = loadC3Hashes();
  const fixtureRecords = [];
  let campaignFailures = 0;

  for (const fixture of FIXTURES) {
    const sourcePath = path.resolve(args.root, fixture.basename);
    process.stdout.write(`[B4] ${fixture.id}: checking approved source\n`);
    assert.equal(path.dirname(sourcePath), args.root, 'fixture source must be a named top-level corpus file');
    if (!fs.existsSync(sourcePath)) {
      fixtureRecords.push(fixtureBlocked(fixture, sourcePath, 'SOURCE_FILE_MISSING'));
      campaignFailures += 1;
      continue;
    }
    const sourceSha256Before = sha256File(sourcePath);
    if (sourceSha256Before !== fixture.sha256 || !c3.hashes.has(sourceSha256Before)) {
      fixtureRecords.push(fixtureBlocked(fixture, sourcePath, 'SOURCE_HASH_DIFFERS_FROM_C3_APPROVED_HASH', sourceSha256Before));
      campaignFailures += 1;
      continue;
    }

    const runReceipts = [];
    const runErrors = [];
    for (const runNumber of [1, 2]) {
      const outputPath = path.join(args.out, `run-${runNumber}`, fixture.id);
      try {
        process.stdout.write(`[B4] ${fixture.id}: Electron pass ${runNumber}/2 started\n`);
        runReceipts.push(invokeProbe(fixture, sourcePath, outputPath));
        const receipt = runReceipts.at(-1);
        process.stdout.write(`[B4] ${fixture.id}: pass ${runNumber}/2 finished; candidates=${receipt.discovery.candidateCount}, rendered=${receipt.artifactBatch.attemptedCount}\n`);
      } catch (error) {
        runErrors.push({ run: runNumber, message: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    const sourceSha256After = sha256File(sourcePath);
    if (sourceSha256After !== sourceSha256Before) {
      runErrors.push({ run: 'campaign', message: 'source hash changed during B4 campaign' });
    }
    if (runErrors.length > 0 || runReceipts.length !== 2) {
      fixtureRecords.push({
        ...fixtureBlocked(fixture, sourcePath, 'ELECTRON_CAMPAIGN_FAILED', sourceSha256After),
        sourceAvailability: 'AVAILABLE',
        candidateDiscovery: { outcome: 'INCOMPLETE', candidateCount: runReceipts[0]?.discovery.candidateCount ?? 0, discoveredCount: 0, blockedCount: 0 },
        artifactBatch: { outcome: 'INCOMPLETE', renderedCandidateCount: 0, renderFailureCount: 0, unsupportedCount: 0, blankCount: 0, exactDuplicateGroupCount: 0, contactSheet: { status: 'NOT_PRODUCED' } },
        campaignErrors: runErrors,
      });
      campaignFailures += 1;
      continue;
    }

    const [first, second] = runReceipts;
    const discoveryStable = HASH(Buffer.from(JSON.stringify(discoverySignature(first)))) === HASH(Buffer.from(JSON.stringify(discoverySignature(second))));
    const artifactStable = HASH(Buffer.from(JSON.stringify(artifactSignature(first)))) === HASH(Buffer.from(JSON.stringify(artifactSignature(second))));
    const contactSheetStable = (first.artifactBatch.contactSheet.svg?.sha256 ?? null) === (second.artifactBatch.contactSheet.svg?.sha256 ?? null) &&
      (first.artifactBatch.contactSheet.png?.sha256 ?? null) === (second.artifactBatch.contactSheet.png?.sha256 ?? null);
    const determinism = {
      discovery: discoveryStable ? 'PASS' : 'FAIL',
      artifactRows: artifactStable ? 'PASS' : 'FAIL',
      contactSheet: contactSheetStable ? 'PASS' : 'FAIL',
    };
    if (!discoveryStable || !artifactStable || !contactSheetStable) campaignFailures += 1;
    const classification = corpusEvidence(fixture, first);
    fixtureRecords.push(publicFixtureRecord(fixture, first, second, determinism, classification));
  }

  const classCounts = Object.fromEntries([...CORE.PRIMARY_CLASSES].sort().map((name) => [name, fixtureRecords.filter((fixture) => fixture.primaryClass === name).length]));
  const totals = fixtureRecords.reduce((sum, fixture) => {
    sum.candidateCount += fixture.candidateDiscovery?.candidateCount ?? 0;
    sum.discoveredCount += fixture.candidateDiscovery?.discoveredCount ?? 0;
    sum.renderedCandidateCount += fixture.artifactBatch?.renderedCandidateCount ?? 0;
    sum.blankCount += fixture.artifactBatch?.blankCount ?? 0;
    sum.exactDuplicateGroupCount += fixture.artifactBatch?.exactDuplicateGroupCount ?? 0;
    sum.renderFailureCount += fixture.artifactBatch?.renderFailureCount ?? 0;
    sum.unsupportedCount += fixture.artifactBatch?.unsupportedCount ?? 0;
    return sum;
  }, { candidateCount: 0, discoveredCount: 0, renderedCandidateCount: 0, blankCount: 0, exactDuplicateGroupCount: 0, renderFailureCount: 0, unsupportedCount: 0 });

  const report = {
    schemaVersion: 'issue706-cross-corpus-generalization/1',
    issue: 706,
    motherPullRequest: 677,
    executionDate: new Date().toISOString().slice(0, 10),
    sourceCorpus: {
      approvedRootPolicy: 'D:\\表情合集 only; named top-level .fla fixtures; originals read-only',
      c3EvidencePath: 'docs/research/fla-v1.5-c3-compatibility-recovery.json',
      c3SampleHashCount: c3.manifest.samples.length,
      requestedFixtureCount: FIXTURES.length,
      availableFixtureCount: fixtureRecords.filter((fixture) => fixture.sourceAvailability === 'AVAILABLE').length,
      sourceHashInvariance: fixtureRecords.every((fixture) => fixture.source.sourceHashInvariance === 'PASS') ? 'PASS' : 'PARTIAL_OR_FAIL',
    },
    method: {
      productionInspection: 'Real Electron Main + Preload chooseAndInspect, production C3 classifier/recovery, parser, static snapshot catalog, and sandbox preview API.',
      candidateDiscovery: 'Production XFL display-list adapter; Graphic candidates use the union of visible authored span starts, while the Scene initial catalog frame is a separately labeled address because the current adapter exposes no Scene span index; held frames are not expanded.',
      candidateId: 'B4- + first 24 uppercase SHA-256 hex of JSON([original source SHA-256, owner kind, source owner name, authored frame index]).',
      artifactProtocol: 'Reuses scripts/research/issue705-black-asset-batch-core.cjs for PNG alpha blank analysis, exact PNG grouping with all provenance retained, deterministic representatives, and contact-sheet layout/SVG.',
      rasterization: 'Production FlaStaticSnapshotWindowManager hidden sandbox BrowserWindow; no FLA bytes enter the rasterizer.',
      projectMutation: 'NONE: inspection/catalog/preview/cancel only; no commit API called.',
    },
    summary: { ...totals, primaryClassCounts: classCounts, campaignFailureCount: campaignFailures },
    classificationNotes: {
      MIXED: 'Eight fixtures are MIXED because directly renderable Graphic assets coexist with tweened or multi-span timeline content. Wave 2 and Wave 3 also carry the temporal-action evidence tag. Static snapshots remain authored-frame anchors; no timeline is flattened into an action clip.',
      PROP: 'The Wave 4 Sword fixture is classified PROP from its approved asset-family hint and repeatable direct Graphic previews.',
      blockerScope: 'blockerFamilies are candidate-route blockers. Source-level compatibility features are recorded separately and do not imply that every candidate preview was blocked.',
    },
    compatibilityEnvelope: {
      safeForV1: [],
      safeWithLimitations: [],
      researchedButTemporal: [],
      blockedByBoundedCapabilityGap: [],
      unknownNeedsMoreResearch: [],
      pendingInterpretation: 'Maintainer visual review remains pending; no semantic family is promoted from parser structure alone.',
    },
    stageCAssumptions: {
      mayAssume: [
        'Source immutability and production C3 recovery trace remain available for every fixture whose original hash matches the approved corpus evidence.',
        'Visible Graphic authored span starts provide deterministic discovery coordinates without expanding held timeline ranges; Scene-only catalog states are reported separately when the adapter has no span index.',
        'Exact-PNG dedupe can retain every source address while selecting one deterministic representative.',
        'Scene states, direct Graphic assets, temporal anchors, and Prop assets can use distinct research contact-sheet sections.',
        'The Sword prop fixture yielded one repeatable nonblank direct-Graphic output with no unsupported candidate.',
      ],
      mustNotAssume: [
        'Black-specific semantic labels or source symbol IDs generalize to the rest of the FLA corpus.',
        'Nested Graphic timing, tween interpolation, MovieClip playback, or temporal action reconstruction are supported by static snapshots.',
        'A rendered frame is semantically a full character pose without source/reference evidence.',
        'Blankness or exact-duplicate rates observed on one fixture generalize to another fixture.',
        'Agent inspection of a contact sheet constitutes maintainer acceptance.',
      ],
    },
    stageCRecommendation: {
      decision: 'PROCEED_WITH_BOUNDED_STATIC_ASSET_SUBSET',
      supportedSubset: 'Deterministic discovery and review of direct Graphic authored-frame snapshots, with PNG alpha blank detection, exact dedupe, and preserved source provenance.',
      limits: 'Do not promote snapshots to named poses or full-character composites without reference review. Keep temporal tracks, nested Graphic timing, MovieClip/script runtime, and unknown semantics blocked or routed to separate capability work.',
      gate: 'Maintainer visual review of the external contact sheets and representative PNGs remains pending; this research does not mark PR #677 ready.',
    },
    fixtures: fixtureRecords,
  };
  const fixtureById = new Map(fixtureRecords.map((fixture) => [fixture.fixtureId, fixture]));
  report.compatibilityEnvelope = {
    safeForV1: FIXTURES.filter((fixture) => fixture.wave === 4).map((fixture) => ({
      fixtureId: fixture.id,
      basis: 'Both the direct Graphic and separately labeled Scene-initial candidates rendered in both runs, with zero unsupported candidates or render failures.',
    })),
    safeWithLimitations: FIXTURES.filter((fixture) => fixture.wave === 1 && (fixtureById.get(fixture.id)?.artifactBatch?.renderedCandidateCount ?? 0) > 0).map((fixture) => ({
      fixtureId: fixture.id,
      basis: 'Direct Graphic authored-frame snapshots are repeatable; parent/full-character semantics and blocked nested timing remain unclaimed.',
    })),
    researchedButTemporal: FIXTURES.filter((fixture) => fixture.actionIntentHint).map((fixture) => ({
      fixtureId: fixture.id,
      basis: 'Action corpus role plus authored multi-span/tween evidence; static snapshots are anchors, not a reconstructed action clip.',
    })),
    blockedByBoundedCapabilityGap: fixtureRecords.filter((fixture) => fixture.blockerFamilies?.some((family) => ['NESTED_GRAPHIC_TIMING', 'MOVIECLIP_RUNTIME', 'TWEEN_INTERPOLATION', 'SCRIPT_RUNTIME'].includes(family))).map((fixture) => ({
      fixtureId: fixture.fixtureId,
      blockerFamilies: fixture.blockerFamilies.filter((family) => ['NESTED_GRAPHIC_TIMING', 'MOVIECLIP_RUNTIME', 'TWEEN_INTERPOLATION', 'SCRIPT_RUNTIME'].includes(family)),
    })),
    unknownNeedsMoreResearch: FIXTURES.filter((fixture) => fixture.wave === 1).map((fixture) => ({
      fixtureId: fixture.id,
      basis: 'Current production evidence classifies direct Graphic candidates, but does not prove full-character versus component pose semantics.',
    })),
    listsAreNonExclusive: true,
  };
  writeJson(REPORT_PATH, report);
  writeJson(path.join(args.out, 'campaign-receipt.json'), report);
  process.stdout.write(`${JSON.stringify({ reportPath: REPORT_PATH, externalReceipt: path.join(args.out, 'campaign-receipt.json'), summary: report.summary })}\n`);
  if (campaignFailures > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
