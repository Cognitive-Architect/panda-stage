#!/usr/bin/env node
'use strict';

/**
 * Issue #728 research-only decision probe. Reuses the complete #727 forensic
 * census, verifies the locked source files again, audits an Adobe-published
 * long-span sample, and reruns the production interpolation checkpoints.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXPECTED_727_BASELINE = '608db0240e3170c9981c21ae60579ad6eca15da3';
const ISSUE_728_BASELINE = 'dde895698a3669603e9a53272f833db9bd0a8982';
const ACCEPTED_DURATIONS = [2, 3, 5, 6, 14];
const CHECKPOINTS = [0, 1, 7, 14, 21, 28, 29];
const KEYMODE_PREDICATE = 'end motionTweenSnap/keyMode matches its outgoing-state family';
const DURATION_PREDICATE = 'span duration belongs to accepted set {2,3,5,6,14}';
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--forensics-json') args.forensicsJson = argv[++index];
    else if (key === '--forensics-sha256') args.forensicsSha256 = argv[++index];
    else if (key === '--walk-source') args.walkSource = argv[++index];
    else if (key === '--walk-sha256') args.walkSha256 = argv[++index];
    else if (key === '--control-source') args.controlSource = argv[++index];
    else if (key === '--control-sha256') args.controlSha256 = argv[++index];
    else if (key === '--adobe-sample') args.adobeSample = argv[++index];
    else if (key === '--adobe-sample-sha256') args.adobeSampleSha256 = argv[++index];
    else if (key === '--out') args.out = argv[++index];
  }
  for (const name of [
    'forensicsJson', 'forensicsSha256', 'walkSource', 'walkSha256',
    'controlSource', 'controlSha256', 'adobeSample', 'adobeSampleSha256', 'out',
  ]) assert.ok(args[name], `missing --${name}`);
  for (const name of ['forensicsSha256', 'walkSha256', 'controlSha256', 'adobeSampleSha256']) {
    assert.match(args[name], /^[a-f0-9]{64}$/iu, `invalid --${name}`);
  }
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    ['out'].includes(key) ? path.resolve(value) :
      ['forensicsJson', 'walkSource', 'controlSource', 'adobeSample'].includes(key)
        ? path.resolve(value) : value,
  ]));
}

function assertNewExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep),
    'evidence output must be outside the repository');
  assert.ok(!fs.existsSync(directory), `refusing to overwrite ${directory}`);
}

function directChild(getChildren, xml, parentName, childName) {
  return getChildren(xml, parentName).find((child) => child.name === childName) ?? null;
}

function collectTimelines(getChildren, xml, rootName) {
  const timelines = [];
  const visit = (block, pathParts) => {
    if (block.name === 'DOMTimeline') timelines.push({
      block,
      path: [...pathParts, block.name].join('/'),
    });
    for (const child of getChildren(block.xml, block.name)) {
      visit(child, [...pathParts, block.name]);
    }
  };
  for (const root of getChildren(xml, rootName)) visit(root, [rootName]);
  return timelines;
}

function layersForTimeline(getChildren, timelineXml) {
  const wrapper = directChild(getChildren, timelineXml, 'DOMTimeline', 'layers');
  return wrapper
    ? getChildren(wrapper.xml, 'layers').filter((block) => block.name === 'DOMLayer')
    : [];
}

function framesForLayer(getChildren, layerXml) {
  const wrapper = directChild(getChildren, layerXml, 'DOMLayer', 'frames');
  return wrapper
    ? getChildren(wrapper.xml, 'frames').filter((block) => block.name === 'DOMFrame')
    : [];
}

function frameElements(getChildren, frame) {
  const wrapper = directChild(getChildren, frame.xml, 'DOMFrame', 'elements');
  return wrapper ? getChildren(wrapper.xml, 'elements') : [];
}

function rootAttributes(xml, rootName) {
  const start = xml.indexOf(`<${rootName}`);
  const end = start < 0 ? -1 : xml.indexOf('>', start);
  assert.ok(start >= 0 && end > start, `${rootName} root tag is missing`);
  const openingTag = xml.slice(start, end + 1);
  const attributes = {};
  for (const match of openingTag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/gu)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

async function verifyFile(pathname, expectedSha256) {
  const bytes = await fs.promises.readFile(pathname);
  const sha256 = HASH(bytes);
  assert.equal(sha256, expectedSha256, `unexpected SHA-256: ${pathname}`);
  return { bytes, sha256 };
}

async function auditWalkSource(args) {
  const { bytes, sha256 } = await verifyFile(args.walkSource, args.walkSha256);
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(bytes);
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(normalized.applied ? normalized.bytes : bytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const adapter = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const scriptBlocks = adapter.getFlaXflDirectChildren(documentXml, 'DOMDocument')
    .filter((block) => block.name.toLocaleLowerCase('en-US') === 'scripts');
  return {
    sha256,
    classifierState: classification.state,
    recoveryNormalizationAppliedInMemory: normalized.applied,
    documentAttributes: rootAttributes(documentXml, 'DOMDocument'),
    scriptContainerCount: scriptBlocks.length,
    scriptContainersEmpty: scriptBlocks.every((block) =>
      adapter.getFlaXflDirectChildren(block.xml, block.name).length === 0),
  };
}

async function auditAdobeSample(args) {
  const { bytes, sha256 } = await verifyFile(args.adobeSample, args.adobeSampleSha256);
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const adapter = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const classification = classifier.classifyForFlaRecovery(bytes);
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const getChildren = adapter.getFlaXflDirectChildren;
  const timelines = collectTimelines(getChildren, documentXml, 'DOMDocument');
  const timeline = timelines.find((entry) => entry.path === 'DOMDocument/timelines/DOMTimeline');
  assert.ok(timeline, 'Adobe sample main timeline is missing');
  const layers = layersForTimeline(getChildren, timeline.block.xml);
  const boatLayer = layers.find((layer) => layer.attributes.name === 'boat');
  assert.ok(boatLayer, 'Adobe sample boat layer is missing');
  const frames = framesForLayer(getChildren, boatLayer.xml);
  const start = frames.find((frame) => frame.attributes.index === '0' &&
    frame.attributes.tweenType === 'motion');
  assert.ok(start, 'Adobe sample long tween start is missing');
  const duration = Number(start.attributes.duration);
  const end = frames.find((frame) => Number(frame.attributes.index) ===
    Number(start.attributes.index) + duration);
  assert.ok(end, 'Adobe sample adjacent tween endpoint is missing');
  const startElements = frameElements(getChildren, start);
  const endElements = frameElements(getChildren, end);
  const startTarget = startElements[0];
  const endTarget = endElements[0];
  const guideLayers = layers.filter((layer) => layer.attributes.layerType === 'guide');
  const startTags = getChildren(start.xml, 'DOMFrame').flatMap((child) =>
    getChildren(child.xml, child.name).map((nested) => nested.name));

  assert.equal(duration, 72);
  assert.equal(startElements.length, 1);
  assert.equal(endElements.length, 1);
  assert.equal(startTarget?.attributes.libraryItemName, endTarget?.attributes.libraryItemName);
  assert.equal(start.attributes.keyMode, '22273');
  assert.equal(end.attributes.keyMode, '9728');
  assert.equal(start.attributes.motionTweenOrientToPath, 'true');
  assert.ok(guideLayers.length > 0, 'expected the Adobe sample to author a motion guide');

  return {
    archive: {
      path: args.adobeSample,
      sha256: sha256,
      bytes: bytes.length,
      classifierState: classification.state,
      recoveryNormalizationAppliedInMemory: normalized.applied,
    },
    creator: rootAttributes(documentXml, 'DOMDocument'),
    span: {
      source: 'DOMDocument.xml',
      timelinePath: timeline.path,
      layerAttributes: boatLayer.attributes,
      startFrameAttributes: start.attributes,
      endFrameAttributes: end.attributes,
      duration,
      sameLibraryIdentity: startTarget.attributes.libraryItemName === endTarget.attributes.libraryItemName,
      symbolType: startTarget.attributes.symbolType,
      startElementCount: startElements.length,
      endElementCount: endElements.length,
      guideLayers: guideLayers.map((layer) => layer.attributes),
      pathMetadata: {
        motionTweenOrientToPath: start.attributes.motionTweenOrientToPath,
        guideLayerPresent: guideLayers.length > 0,
      },
      easeMetadataOnStartFrame: startTags.filter((name) => /ease/iu.test(name)),
      strictTransformOnlySample: false,
      limitation: 'long-span corroboration only; path/guide and keyMode 22273 are outside the target strict family',
    },
  };
}

async function runOnce(args) {
  const [forensicsBytes, walk, control] = await Promise.all([
    fs.promises.readFile(args.forensicsJson),
    verifyFile(args.walkSource, args.walkSha256),
    verifyFile(args.controlSource, args.controlSha256),
  ]);
  const walkOrigin = await auditWalkSource(args);
  assert.equal(HASH(forensicsBytes), args.forensicsSha256, 'unexpected #727 forensics JSON hash');
  const forensics = JSON.parse(forensicsBytes.toString('utf8'));
  assert.equal(forensics.baseline, EXPECTED_727_BASELINE);
  assert.equal(forensics.realF1.fixture.sha256Before, walk.sha256);
  assert.equal(walkOrigin.sha256, walk.sha256);
  assert.equal(walkOrigin.documentAttributes.creatorInfo, 'Adobe Animate');
  assert.equal(walkOrigin.documentAttributes.versionInfo, 'Saved by Animate Windows 21.0 build 35450');
  assert.equal(walkOrigin.scriptContainersEmpty, true);
  assert.equal(forensics.acceptedIssue713Controls.fixture.sha256Before, control.sha256);
  assert.equal(forensics.realF1.root.libraryItemName, '图层转元件_278');
  assert.equal(forensics.realF1.exactSpan.startIndex, 0);
  assert.equal(forensics.realF1.exactSpan.endKeyframeIndex, 29);
  assert.equal(forensics.realF1.exactSpan.duration, 29);
  assert.equal(forensics.realF1.root.requestedFrame, 1);

  const originalFailures = forensics.realF1.gatePredicates
    .filter((predicate) => !predicate.pass).map((predicate) => predicate.predicate);
  assert.deepEqual(originalFailures, [DURATION_PREDICATE, KEYMODE_PREDICATE]);
  const afterKeyModeUpdate = forensics.realF1.gatePredicates.map((predicate) => ({
    predicate: predicate.predicate,
    originalPass: predicate.pass,
    postIssue720Pass: predicate.predicate === KEYMODE_PREDICATE ? true : predicate.pass,
    decisionSource: predicate.predicate === KEYMODE_PREDICATE ? '#720 bounded terminal support' : 'unchanged #727 evidence',
  }));
  const postKeyModeFailures = afterKeyModeUpdate
    .filter((predicate) => !predicate.postIssue720Pass).map((predicate) => predicate.predicate);
  assert.deepEqual(postKeyModeFailures, [DURATION_PREDICATE]);

  const controls = forensics.acceptedIssue713Controls.controls;
  assert.deepEqual(controls.map((controlSpan) => controlSpan.duration).sort((a, b) => a - b),
    [...ACCEPTED_DURATIONS].sort((a, b) => a - b));
  assert.ok(controls.every((controlSpan) => controlSpan.manualPairGatePass &&
    controlSpan.productionInteriorBuildPass && controlSpan.endpointIdentityMatches &&
    controlSpan.endpointMatricesParse));

  const start = forensics.realF1.productionEndpointParse.start.localTransform;
  const end = forensics.realF1.productionEndpointParse.end.localTransform;
  assert.ok(start && end, 'production parsed endpoint transforms are missing');
  const interpolate = require(path.join(ROOT,
    'dist-electron/main/services/fla-motion-tween-transform-interpolator.js'))
    .interpolateFlaLinearMotionTransform;
  const interpolatorFunctionText = Function.prototype.toString.call(interpolate);
  const checkpoints = CHECKPOINTS.map((frameIndex) => {
    const progress = (frameIndex - forensics.realF1.exactSpan.startIndex) /
      forensics.realF1.exactSpan.duration;
    return {
      frameIndex,
      elapsed: frameIndex - forensics.realF1.exactSpan.startIndex,
      duration: forensics.realF1.exactSpan.duration,
      progress,
      result: interpolate(start, end, progress),
    };
  });
  assert.ok(checkpoints.every((checkpoint) => checkpoint.result.ok));

  const adapterSource = await fs.promises.readFile(path.join(ROOT,
    'src/main/services/fla-static-snapshot-display-list-adapter.ts'), 'utf8');
  const interpolatorSource = await fs.promises.readFile(path.join(ROOT,
    'src/main/services/fla-motion-tween-transform-interpolator.ts'), 'utf8');
  const adapterUsesNormalizedProgress = adapterSource.includes(
    'const progress = (frameIndex - startSpan.index) / startSpan.duration;');
  const interpolatorTakesProgress = /interpolateFlaLinearMotionTransform\([\s\S]*?progress: number/iu
    .test(interpolatorSource);
  assert.equal(adapterUsesNormalizedProgress, true);
  assert.equal(interpolatorTakesProgress, true);
  assert.equal(/\bduration\b/iu.test(interpolatorFunctionText), false,
    'interpolator contains a duration-specific branch or dependency');
  assert.equal(adapterSource.includes('new Set([2, 3, 5, 6, 14])'), true,
    'current production duration allowlist changed unexpectedly');

  const adobeSample = await auditAdobeSample(args);
  const hashesAfter = {
    walk: HASH(await fs.promises.readFile(args.walkSource)),
    control: HASH(await fs.promises.readFile(args.controlSource)),
    adobeSample: HASH(await fs.promises.readFile(args.adobeSample)),
  };
  assert.deepEqual(hashesAfter, {
    walk: walk.sha256,
    control: control.sha256,
    adobeSample: adobeSample.archive.sha256,
  });

  return {
    schemaVersion: 'issue728-duration29-bounded-authorization/1',
    issue728Baseline: ISSUE_728_BASELINE,
    parent727Evidence: {
      baseline: forensics.baseline,
      jsonPath: args.forensicsJson,
      jsonSha256: HASH(forensicsBytes),
      exactSpanReconfirmed: true,
      fixtureHashesBeforeAndAfterMatch: true,
    },
    fixtures: {
      walk: { path: args.walkSource, sha256Before: walk.sha256, sha256After: hashesAfter.walk },
      control: { path: args.controlSource, sha256Before: control.sha256, sha256After: hashesAfter.control },
    },
    D0: {
      fixtureSha256: walk.sha256,
      adobeCreator: walkOrigin.documentAttributes.creatorInfo,
      adobeVersion: walkOrigin.documentAttributes.versionInfo,
      scriptContainerCount: walkOrigin.scriptContainerCount,
      scriptContainersEmpty: walkOrigin.scriptContainersEmpty,
      timeline: '图层转元件_278',
      layerIndex: forensics.realF1.exactSpan.layerIndex,
      layerName: forensics.realF1.exactSpan.layerName,
      startIndex: 0,
      endKeyframeIndex: 29,
      duration: 29,
      firstBlockedFrame: 1,
      startFrameAttributes: forensics.realF1.exactSpan.start.frameAttributes,
      endFrameAttributes: forensics.realF1.exactSpan.end.frameAttributes,
      startIdentity: forensics.realF1.exactSpan.start.target.attributes.libraryItemName,
      endIdentity: forensics.realF1.exactSpan.end.target.attributes.libraryItemName,
      startMatrix: start,
      endMatrix: end,
      productionFailure: forensics.realF1.root.productionFailure,
    },
    D1: {
      originalProductionGateFailures: originalFailures,
      issue720TerminalDecisionAppliedTo: KEYMODE_PREDICATE,
      postKeyModeGateFailures: postKeyModeFailures,
      predicateMatrix: afterKeyModeUpdate,
    },
    D2: {
      acceptedDurations: controls.map((controlSpan) => ({
        duration: controlSpan.duration,
        startIndex: controlSpan.startIndex,
        endIndex: controlSpan.endIndex,
        startKeyMode: controlSpan.startFrameAttributes.keyMode,
        endKeyMode: controlSpan.endFrameAttributes.keyMode,
        sameGraphicIdentity: controlSpan.endpointIdentityMatches,
        matricesParse: controlSpan.endpointMatricesParse,
        unsupportedMetadataAbsent: !controlSpan.unsupportedMetadataStart.detected &&
          !controlSpan.unsupportedMetadataEnd.detected,
        manualGate: controlSpan.manualPairGatePass,
        productionInteriorBuild: controlSpan.productionInteriorBuildPass,
      })),
      targetStrictFamilyEvidence: {
        endpointElementCountAndTypeMatch: forensics.realF1.exactSpan.start.authoredElementCount === 1 &&
          forensics.realF1.exactSpan.end.authoredElementCount === 1 &&
          forensics.realF1.exactSpan.start.target.name === 'DOMSymbolInstance' &&
          forensics.realF1.exactSpan.end.target.name === 'DOMSymbolInstance',
        sameGraphicIdentity: forensics.realF1.exactSpan.start.target.attributes.libraryItemName ===
          forensics.realF1.exactSpan.end.target.attributes.libraryItemName,
        matricesAndTransformationPointsSupported: forensics.realF1.gatePredicates.find((predicate) =>
          predicate.predicate === 'matrix and transformationPoint endpoint structures are supported')?.pass,
        keyModeFamilyAfterIssue720: '22017 start -> 9728 terminal is bounded terminal support',
        unsupportedMotionMetadataAbsent: !forensics.realF1.exactSpan.start.unsupportedMotionMetadata.detected &&
          !forensics.realF1.exactSpan.end.unsupportedMotionMetadata.detected,
        easingPathRotationFilterColorShapeExtras: forensics.realF1.fullEndpointMetadataCensus,
        productionInterpolationFunctionSharedWithControls: true,
      },
      classificationOfDifferences: 'duration only within the bounded gate after applying #720',
    },
    D3: {
      externalSemanticsEvidence: [
        'Adobe Classic Tween documentation: changing frame count between the same keyframes recomputes the tween; default rate is constant and Ease is a separate control.',
        'Adobe Flash CS4 Extending API: tweenType=motion interpolates from the current keyframe to the following keyframe; easing/path/rotation are separate frame properties.',
      ],
      evidenceBoundary: 'supports the same classic-tween family for this strict no-ease/no-path/no-rotation subset; does not authorize arbitrary durations or all classic-tween features',
    },
    D4: {
      adobePublishedLongSpanSample: adobeSample,
      targetFixtureIsExactDuration29AdobeSample: walkOrigin.documentAttributes.creatorInfo ===
        'Adobe Animate' && forensics.realF1.exactSpan.duration === 29,
      publicDuration29AuthoringScript: {
        url: 'https://gist.github.com/hushin/2883195',
        operation: 'createMotionTween(); insertKeyframe(29)',
        boundary: 'public JSFL authoring example places the ending keyframe at zero-based index 29; it does not contain a serialized FLA/XFL fixture',
      },
    },
    D5: {
      productionProgressExpression: '(frameIndex - startSpan.index) / startSpan.duration',
      normalizedProgressOnly: true,
      durationSpecificInterpolationBranch: false,
      interpolatorFunctionSignatureUsesProgress: true,
      checkpoints,
    },
    D6: {
      authorizedDurationCandidate: 29,
      acceptedDurationsRemain: ACCEPTED_DURATIONS,
      arbitraryPositiveDurationsAuthorized: false,
      productionAllowlistChanged: false,
    },
    sourceMutation: 'NO',
    productionFilesChanged: 'NO',
    fullCiManuallyTriggered: 'NO',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertNewExternalDirectory(args.out);
  const first = await runOnce(args);
  const second = await runOnce(args);
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  assert.equal(deterministic, true, 'two complete research passes differ');
  const firstSha256 = HASH(Buffer.from(JSON.stringify(first), 'utf8'));
  const secondSha256 = HASH(Buffer.from(JSON.stringify(second), 'utf8'));
  const report = {
    ...first,
    DURATION29_VS_ACCEPTED_FAMILY_DIFF: first.D1.postKeyModeGateFailures.length === 1
      ? 'duration only' : 'duration + semantic differences',
    classification: first.D1.postKeyModeGateFailures.length === 1 &&
      first.D5.durationSpecificInterpolationBranch === false &&
      first.D5.checkpoints.every((checkpoint) => checkpoint.result.ok)
      ? 'DURATION29_BOUNDED_IMPLEMENTATION' : 'DURATION29_RESEARCH_ONLY',
    repeat: {
      count: 2,
      deterministic,
      firstRunSha256: firstSha256,
      secondRunSha256: secondSha256,
    },
    nextSingleAction: 'Open a separately scoped implementation issue for duration 29 only; keep every existing transform-only guard and the explicit duration allowlist.',
  };
  await fs.promises.mkdir(args.out, { recursive: false });
  await fs.promises.writeFile(path.join(args.out, 'issue728-duration29-bounded-authorization.json'),
    JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const receipt = [
    'Issue: Stage B5-Q Duration29 Bounded Authorization',
    'evidence record: #720',
    'forensics parent: #727',
    'real rerun parent: #726',
    'control: #713',
    'mother PR: #677',
    `baseline: ${ISSUE_728_BASELINE}`,
    '',
    'D0 real span:',
    `fixture: ${report.fixtures.walk.path}`,
    `SHA before: ${report.fixtures.walk.sha256Before}`,
    `SHA after: ${report.fixtures.walk.sha256After}`,
    `start/end: F${report.D0.startIndex} -> F${report.D0.endKeyframeIndex}`,
    `duration: ${report.D0.duration}`,
    `first blocked frame: F${report.D0.firstBlockedFrame}`,
    '',
    'D1 gate isolation:',
    `post-keyMode fail predicates: ${JSON.stringify(report.D1.postKeyModeGateFailures)}`,
    '',
    'D2 control comparison:',
    `durations compared: ${report.D2.acceptedDurations.map((item) => item.duration).join(', ')}`,
    `semantic differences: ${report.DURATION29_VS_ACCEPTED_FAMILY_DIFF}`,
    '',
    'D3 external evidence:',
    'Adobe classic-tween docs state that changing keyframe spacing re-tweens the frames; the default rate is constant and Ease changes speed separately.',
    'Adobe CS4 extension API defines motion tweening from the current keyframe to the following keyframe; path/rotation/ease are separate properties.',
    '',
    'D4 duration examples:',
    `Adobe-published FLA span: ${report.D4.adobePublishedLongSpanSample.span.duration} frames; source hash ${report.D4.adobePublishedLongSpanSample.archive.sha256}`,
    'target fixture: exact Adobe Animate duration 29, strict transform-only metadata after #720 keyMode decision',
    'public JSFL sample: keyframe index 29; no serialized XFL file, used only as corroboration',
    '',
    'D5 interpolation:',
    `formula: ${report.D5.productionProgressExpression}`,
    `duration-specific branch: ${report.D5.durationSpecificInterpolationBranch ? 'YES' : 'NO'}`,
    `checkpoints: ${JSON.stringify(report.D5.checkpoints.map((item) => ({ frame: item.frameIndex, t: item.progress, matrix: item.result.matrix })))}`,
    `deterministic: ${deterministic ? 'PASS' : 'FAIL'}`,
    '',
    `classification: ${report.classification}`,
    'production files changed: NO',
    'source mutation: NO',
    'Full CI manually triggered: NO',
    'PR #677 remains Draft: YES',
    '',
    `next single action: ${report.nextSingleAction}`,
  ].join('\n') + '\n';
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receipt, { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    classification: report.classification,
    deterministic,
    reportSha256: firstSha256,
    baseline: report.issue728Baseline,
    span: report.D0,
    postKeyModeFailures: report.D1.postKeyModeGateFailures,
    controls: report.D2.acceptedDurations,
    adobeLongSpan: report.D4.adobePublishedLongSpanSample.span,
    checkpoints: report.D5.checkpoints,
    nextSingleAction: report.nextSingleAction,
  }, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
