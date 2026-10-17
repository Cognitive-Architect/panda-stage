#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = '1e7091c4b34e4ff8b7d77bc5c10015b6e37f0c9f';
const ELECTRON_PROBE = path.join(ROOT, 'scripts/research/issue706-cross-corpus-electron-probe.cjs');
const SCREENSHOT_INVENTORY = Object.freeze({
  EFFECT: [
    '飞奔.跑.fla', '尴尬.fla', '内心独白.fla', '人物死亡消失.fla', '生气.fla',
    '手忙脚乱.fla', '水花.fla', '叹气.fla', '吐血.fla', '直播间.fla',
  ],
  PROP: [
    '草药 仙草 灵植 (1).fla', '草药 仙草 灵植.fla', '储物袋.fla', '飞舟、飞船.fla',
    '莲台.fla', '炼丹炉.fla', '石碑.fla',
  ],
  CHARACTER: [
    '汉服修仙女.fla', '黑袍大师兄（四视角）.fla', '红伞蝶衣（四视角）.fla', '蓝白古装男.fla',
    '蓝发修仙女.fla', '魔修.fla', '浅蓝修仙女.fla', '青绫修仙女（四视角）.fla',
    '修仙大长老（三视角）.fla', '修仙男.fla', '修仙宗门圣女（四视角）.fla',
  ],
});
const SOURCE_ROOTS = Object.freeze({
  EFFECT: 'D:\\表情合集\\特效',
  PROP: 'D:\\表情合集\\道具',
  CHARACTER: 'D:\\表情合集\\新人物',
});
const FIXTURES = Object.freeze([
  { category: 'EFFECT', basename: '飞奔.跑.fla', sha256: '15d3d727f5f5a86bc877dbc42642d43d0b91e671f828451e8a311028f0d88abc' },
  { category: 'EFFECT', basename: '尴尬.fla', sha256: '030c9eb792fd43920cead22c7e7f3f2f5fe9922f121637e44d9e299b8c576e5b' },
  { category: 'EFFECT', basename: '内心独白.fla', sha256: 'a931b0820a88d4c99363325c23864b792dbc4591738db4effeec3251fba1bcbe' },
  { category: 'EFFECT', basename: '人物死亡消失.fla', sha256: '6c3ad29c284c967d84699009e9d6933fd21e8523b617b1128420bd6943a828ec' },
  { category: 'EFFECT', basename: '生气.fla', sha256: '04fbbe68117844e9152f52e4a68310371ae40ad73564b856a0ce6cd8cb161000' },
  { category: 'EFFECT', basename: '手忙脚乱.fla', sha256: '10d69bf1ce1222bdb59725bbf8306b2e030d65b03f7a111b91e68c7866c07d9b' },
  { category: 'EFFECT', basename: '水花.fla', sha256: '89f043644edd20626c33573cbf8001362195a8bd9e271b01aa83ddf9306fbc9a' },
  { category: 'EFFECT', basename: '叹气.fla', sha256: 'e695f4d652bcb2eca0a4bde2a7ca720e1526eaa6edf1d134feca35e90a4fd2ce' },
  { category: 'EFFECT', basename: '吐血.fla', sha256: '56028cb3f6be853ea132f3e7b43eaa807e88bbdd53a2b1c4dea7e6cfe6c8dced' },
  { category: 'EFFECT', basename: '直播间.fla', sha256: '098394b02589cf71249270a63f78d4d4d0a17c21ba11f87af95fc1c401915960' },
  { category: 'PROP', basename: '草药 仙草 灵植 (1).fla', sha256: 'a15c340ee3c3b2c6458624aa198971772f2e12490841e87e5de2f257364bfc50' },
  { category: 'PROP', basename: '草药 仙草 灵植.fla', sha256: '610b362a056b19790db6f7b44ad093f32955760aeb7e060284b7b95d8f572535' },
  { category: 'PROP', basename: '储物袋.fla', sha256: '5d94df2d256208a4338ff10e8355402e572d2f86ffb906a5a5cf4902c1d054d7' },
  { category: 'PROP', basename: '飞舟、飞船.fla', sha256: '54b5f16fca73e0af93911e6d71595d9c98bce7a60eba3ae60d4974cce5451dc2' },
  { category: 'PROP', basename: '莲台.fla', sha256: '7fcb4d6e8fc300f514a62b0af9b8dc8de5402c48c5503edc197d5a530b7ee714' },
  { category: 'PROP', basename: '炼丹炉.fla', sha256: '498537baa9cf900f613987eb9dab99727ee09ddaad4fb06e2d2c4351cb283a68' },
  { category: 'PROP', basename: '石碑.fla', sha256: '12f05ac8faa0141fe0d0c19de41161b9766d4a4dcf2022bbacce9a8054f198c9' },
  { category: 'CHARACTER', basename: '汉服修仙女.fla', sha256: '6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535' },
  { category: 'CHARACTER', basename: '黑袍大师兄（四视角）.fla', sha256: '3ae497bf13e1af8fdfb755cf70cf16d3e94176ea463d5621ae011c83dec53456' },
  { category: 'CHARACTER', basename: '红伞蝶衣（四视角）.fla', sha256: '76c8b1ceb22e427a43d2b6b39502316208dd34fec3b1786b3063640386852781' },
  { category: 'CHARACTER', basename: '蓝白古装男.fla', sha256: '0d4aecbc159990ce54b9d0d8c31ea0f3354cd7ed86df77bac19a562dfc761fa2' },
  { category: 'CHARACTER', basename: '蓝发修仙女.fla', sha256: '86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2' },
  { category: 'CHARACTER', basename: '魔修.fla', sha256: 'c16792991c9704b6b29b8798c8e1030bf868963b51c6f0e9018113a4b641aa79' },
  { category: 'CHARACTER', basename: '浅蓝修仙女.fla', sha256: '050e222cd536b28ed07466c77a87f0dbabf66eaa993be25d803ef12bee3a55b1' },
  { category: 'CHARACTER', basename: '青绫修仙女（四视角）.fla', sha256: 'd0958d4432decbf6c54566ba15a2f5e97bd88c82d75dcb2f84603e9b2273f0e4' },
  { category: 'CHARACTER', basename: '修仙大长老（三视角）.fla', sha256: '78e4c1106114eb8f153ddefe64418a0023b018a414f6a9ad603e15b0cae49472' },
  { category: 'CHARACTER', basename: '修仙男.fla', sha256: '565c5609a7610ef64ed9f98b09d98dd82d5a45255adb4d3d410a5a365e0ef4a5' },
  { category: 'CHARACTER', basename: '修仙宗门圣女（四视角）.fla', sha256: 'c2c1a41dfb58eb7b4998cb7e4f35d56a34e39a11777442121ca5c7340605e18d' },
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') args.out = argv[++index];
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return {
    out: path.resolve(args.out ?? path.join(path.parse(ROOT).root, 'PandaStage-Acceptance', `issue732-b5u-round1-${stamp}`)),
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function enumerateFlas(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return enumerateFlas(entryPath);
    return entry.isFile() && entry.name.toLocaleLowerCase('en-US').endsWith('.fla') ? [entry.name] : [];
  }).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function reconcileInventory() {
  const categories = {};
  for (const category of Object.keys(SCREENSHOT_INVENTORY)) {
    const actual = enumerateFlas(SOURCE_ROOTS[category]);
    const expected = [...SCREENSHOT_INVENTORY[category]].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    categories[category] = {
      root: SOURCE_ROOTS[category],
      expectedCount: expected.length,
      actualCount: actual.length,
      expectedNames: expected,
      actualNames: actual,
      missingFromFilesystem: expected.filter((name) => !actualSet.has(name)),
      additionalOnFilesystem: actual.filter((name) => !expectedSet.has(name)),
      exactMatch: actual.length === expected.length && actual.every((name, index) => name === expected[index]),
    };
  }
  return {
    categories,
    expectedTotal: Object.values(SCREENSHOT_INVENTORY).reduce((sum, files) => sum + files.length, 0),
    actualTotal: Object.values(categories).reduce((sum, category) => sum + category.actualCount, 0),
  };
}

function invokeProbe(fixture, sourcePath, outputPath, runNumber) {
  const electronBinary = require('electron');
  const args = [
    ELECTRON_PROBE,
    '--fixture-id', `issue732-${fixture.category.toLowerCase()}-${runNumber}-${fixture.slug}`,
    '--source', sourcePath,
    '--expected-sha256', fixture.sha256,
    '--wave', 'B5-U',
    '--asset-family-hint', fixture.category === 'PROP' ? 'PROP' : 'NONE',
    '--action-intent-hint', 'false',
    '--out', outputPath,
  ];
  const result = spawnSync(electronBinary, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').slice(-12_000);
    const stdout = String(result.stdout ?? '').slice(-4_000);
    throw new Error(`${fixture.basename} Electron probe exited ${result.status}: ${stderr || stdout}`);
  }
  const jsonLine = String(result.stdout ?? '').trim().split(/\r?\n/u)
    .reverse().find((line) => line.trimStart().startsWith('{'));
  assert.ok(jsonLine, `${fixture.basename} probe emitted no JSON receipt`);
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
    status: candidate.status,
    svgSha256: candidate.output?.svg?.sha256 ?? null,
    pngSha256: candidate.output?.png?.sha256 ?? null,
    isBlank: candidate.isBlank ?? null,
    duplicateGroupId: candidate.duplicateGroupId ?? null,
    representativeCandidateId: candidate.representativeCandidateId ?? null,
    previewIncluded: candidate.previewIncluded ?? null,
  }));
}

function summarizeFixture(fixture, receipts, runOutputs, sourcePath) {
  const [first, second] = receipts;
  const sourceShaAfter = sha256File(sourcePath);
  assert.equal(sourceShaAfter, fixture.sha256, `${fixture.basename} source changed during census`);
  assert.equal(first.source.originalSha256, fixture.sha256, `${fixture.basename} first probe hash mismatch`);
  assert.equal(first.source.originalSha256After, fixture.sha256, `${fixture.basename} first probe changed source`);
  assert.equal(second.source.originalSha256, fixture.sha256, `${fixture.basename} second probe hash mismatch`);
  assert.equal(second.source.originalSha256After, fixture.sha256, `${fixture.basename} second probe changed source`);

  const firstCandidates = first.discovery.candidates;
  const catalog = first.productionInspection.catalog;
  const temporalTimelines = first.discovery.timelineFacts.filter((row) =>
    row.frameCount > 1 || row.tweenSpanCount > 0 || row.authoredStartCount > 1);
  return {
    fixtureId: fixture.id,
    category: fixture.category,
    filename: fixture.basename,
    sourcePath,
    sourceSha256: fixture.sha256,
    sourceShaUnchanged: sourceShaAfter === fixture.sha256,
    gate0: {
      status: first.source.sourceHashInvariance && first.productionInspection.parserResult === 'success' ? 'PASS' : 'BLOCKED',
      parseResult: first.productionInspection.parserResult,
      postNormalizationStrictResult: first.productionInspection.postNormalizationStrictResult,
      normalization: first.source.normalization,
      trace: first.source.recoveryTrace,
      fatalBlocker: null,
    },
    productionInspection: {
      document: first.productionInspection.document,
      structure: first.productionInspection.structure,
      compatibility: first.productionInspection.compatibility,
      mediaCount: first.productionInspection.mediaCount,
      diagnostics: first.productionInspection.diagnostics,
      catalog,
    },
    gate1: {
      status: catalog.length > 0 ? 'PASS' : 'BLOCKED',
      productCatalogCandidateCount: catalog.length,
      candidateTypes: catalog.reduce((counts, entry) => ({
        ...counts,
        [entry.target.kind]: (counts[entry.target.kind] ?? 0) + 1,
      }), {}),
      candidates: catalog.map((entry) => ({
        target: entry.target,
        previewSupported: entry.previewSupported,
        unsupportedReason: entry.unsupportedReason ?? null,
      })),
      blankCandidateCount: first.artifactBatch.blankCount,
      exactDuplicateCandidateGroupCount: first.artifactBatch.exactDuplicateGroupCount,
      likelyUsefulAuthoredRootFound: catalog.some((entry) => entry.target.kind === 'scene' || entry.target.kind === 'graphic-symbol'),
    },
    gate2: {
      status: first.artifactBatch.attemptedCount > 0 && first.artifactBatch.renderFailureCount === 0 ? 'PASS' :
        first.artifactBatch.attemptedCount > 0 ? 'PARTIAL' : 'BLOCKED',
      authoredStateCandidateCount: first.discovery.candidateCount,
      renderedCandidateCount: first.artifactBatch.attemptedCount,
      blankCount: first.artifactBatch.blankCount,
      exactDuplicateGroupCount: first.artifactBatch.exactDuplicateGroupCount,
      renderFailureCount: first.artifactBatch.renderFailureCount,
      unsupportedCount: first.artifactBatch.unsupportedCount,
      contactSheet: first.artifactBatch.contactSheet,
      repeatDeterminism: {
        candidateDiscoveryIdentical: JSON.stringify(discoverySignature(first)) === JSON.stringify(discoverySignature(second)),
        renderArtifactsIdentical: JSON.stringify(artifactSignature(first)) === JSON.stringify(artifactSignature(second)),
      },
      blockerFamilies: [...new Set(firstCandidates.flatMap((candidate) => candidate.blockerFamilies ?? []))].sort(),
      caveat: 'Candidate evidence comes from the existing Issue #706 research seam; its legacy nestedTimingBlockers prefilter is not authoritative for the post-#724 timing baseline. Direct current product API sequence evidence is recorded separately when available.',
    },
    temporal: {
      classification: temporalTimelines.length > 0 ? 'TEMPORAL_CANDIDATE' : 'STATIC_CANDIDATE',
      sourceTimelineCount: first.discovery.timelineFacts.length,
      temporalTimelineCount: temporalTimelines.length,
      timelineFacts: first.discovery.timelineFacts,
      g4: 'NEEDS_FAMILY_REVIEW',
      g5: 'NOT_RUN',
    },
    artifactEvidence: {
      run1: runOutputs[0],
      run2: runOutputs[1],
      contactSheet: first.artifactBatch.contactSheet,
      candidateRenderIndex: first.discovery.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        sourceAddressLabel: candidate.sourceAddressLabel,
        status: candidate.status,
        blockerFamilies: candidate.blockerFamilies,
        output: candidate.output ?? null,
      })),
    },
    preliminaryClass: 'UNCLASSIFIED_PENDING_G3_G5_G6_REVIEW',
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const relative = path.relative(ROOT, args.out);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'evidence must remain outside the repository');
  assert.ok(!fs.existsSync(args.out), `refusing to overwrite existing evidence directory: ${args.out}`);

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(head.status, 0, 'git rev-parse HEAD failed');
  assert.equal(head.stdout.trim(), BASELINE, 'working tree HEAD differs from the frozen #732 baseline');

  const inventory = reconcileInventory();
  const inventoryDelta = Object.fromEntries(Object.entries(inventory.categories)
    .filter(([, record]) => !record.exactMatch)
    .map(([category, record]) => [category, {
      missingFromFilesystem: record.missingFromFilesystem,
      additionalOnFilesystem: record.additionalOnFilesystem,
      expectedCount: record.expectedCount,
      actualCount: record.actualCount,
    }]));
  assert.equal(FIXTURES.length, inventory.expectedTotal, 'frozen source manifest does not cover the screenshot inventory');
  assert.deepEqual(Object.keys(inventoryDelta), [], 'filesystem inventory differs from the frozen maintainer screenshot inventory');

  fs.mkdirSync(args.out, { recursive: false });
  const results = [];
  for (const [index, sourceFixture] of FIXTURES.entries()) {
    const fixture = {
      ...sourceFixture,
      id: `${sourceFixture.category.toLowerCase()}-${String(index + 1).padStart(2, '0')}`,
      slug: String(index + 1).padStart(2, '0'),
    };
    const sourcePath = path.join(SOURCE_ROOTS[fixture.category], fixture.basename);
    assert.ok(fs.existsSync(sourcePath), `source file does not exist: ${sourcePath}`);
    assert.equal(sha256File(sourcePath), fixture.sha256, `${fixture.basename} differs from the frozen source SHA-256`);
    const fixtureOut = path.join(args.out, fixture.id);
    fs.mkdirSync(fixtureOut, { recursive: false });
    const runOutputs = [path.join(fixtureOut, 'run-1'), path.join(fixtureOut, 'run-2')];
    const receipts = [];
    for (let runIndex = 0; runIndex < runOutputs.length; runIndex += 1) {
      const outputPath = runOutputs[runIndex];
      fs.mkdirSync(outputPath, { recursive: false });
      const receipt = invokeProbe(fixture, sourcePath, outputPath, runIndex + 1);
      receipts.push(receipt);
      process.stdout.write(`${index + 1}/${FIXTURES.length} ${fixture.category} ${fixture.basename} run ${runIndex + 1}: candidates=${receipt.discovery.candidateCount}, rendered=${receipt.artifactBatch.attemptedCount}, blocked=${receipt.artifactBatch.unsupportedCount + receipt.artifactBatch.renderFailureCount}\n`);
    }
    const result = summarizeFixture(fixture, receipts, runOutputs, sourcePath);
    if (!result.gate2.repeatDeterminism.candidateDiscoveryIdentical) {
      process.stderr.write(`WARNING discovery nondeterminism: ${fixture.basename}\n`);
    }
    if (!result.gate2.repeatDeterminism.renderArtifactsIdentical) {
      process.stderr.write(`WARNING render nondeterminism: ${fixture.basename}\n`);
    }
    writeJson(path.join(fixtureOut, 'census-record.json'), result);
    results.push(result);
  }

  const sourceIntegrity = results.map((result) => ({
    category: result.category,
    filename: result.filename,
    path: result.sourcePath,
    sha256: result.sourceSha256,
    unchanged: result.sourceShaUnchanged,
  }));
  const batch = {
    schemaVersion: 'issue732-cross-category-census/1',
    issue: 732,
    baseline: { commit: BASELINE, currentHead: head.stdout.trim(), productionFilesChangedByRound1: 0 },
    inventory: {
      sourceRoots: SOURCE_ROOTS,
      categories: inventory.categories,
      expectedTotal: inventory.expectedTotal,
      actualTotal: inventory.actualTotal,
      exactInventoryMatch: Object.keys(inventoryDelta).length === 0,
      delta: inventoryDelta,
    },
    variantGroups: [{ id: 'herb-asset-two-source-files', files: ['草药 仙草 灵植 (1).fla', '草药 仙草 灵植.fla'], rawDenominatorCount: 2 }],
    sourceIntegrity,
    fileCount: results.length,
    results,
    interpretationNote: 'Round 1 uses the existing Issue #706 production-backed inspection/discovery/reconstruction/rasterization seam twice per source. Its older nestedTimingBlockers helper can overstate nested-timeline blockers relative to the frozen post-#724 baseline; those blocker strings are retained as probe observations, not treated as a final capability verdict. G5 must use the current frameSequenceRender API before final classes are assigned.',
    evidenceDirectory: args.out,
  };
  writeJson(path.join(args.out, 'census-manifest.json'), batch);
  const csvHeader = 'category,filename,sourceSha256,candidateCount,renderedCandidateCount,blankCount,duplicateGroups,unsupportedCount,renderFailureCount,temporalTimelineCount,discoveryDeterministic,renderDeterministic';
  const csvRows = results.map((result) => [
    result.category,
    JSON.stringify(result.filename),
    result.sourceSha256,
    result.gate1.productCatalogCandidateCount,
    result.gate2.renderedCandidateCount,
    result.gate2.blankCount,
    result.gate2.exactDuplicateGroupCount,
    result.gate2.unsupportedCount,
    result.gate2.renderFailureCount,
    result.temporal.temporalTimelineCount,
    result.gate2.repeatDeterminism.candidateDiscoveryIdentical,
    result.gate2.repeatDeterminism.renderArtifactsIdentical,
  ].join(','));
  fs.writeFileSync(path.join(args.out, 'census-summary.csv'), `${csvHeader}\n${csvRows.join('\n')}\n`, { flag: 'wx' });
  process.stdout.write(`\nIssue #732 Round 1 static/discovery census complete: ${results.length} files; evidence=${args.out}\n`);
}

run();
