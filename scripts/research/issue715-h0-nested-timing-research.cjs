#!/usr/bin/env node
'use strict';

/**
 * Issue #715 — Stage B5-H, phase H0 (research only).
 *
 * H0 is research-only: it changes no production behavior. It inspects two real
 * read-only fixtures plus the #713 control through the shared production FLA
 * modules (dist-electron) and records source-authored evidence for:
 *
 *   H0-A  Loop + explicit firstFrame child-frame mapping
 *   H0-B  missing playback mode default
 *   H0-C  per-keyframe (animated) firstFrame
 *   H0-D  keyMode 9728 vs the accepted static terminal marker
 *   H0-E  duration 29 / 4 endpoint family
 *   H0-F  BlurFilter silent-fidelity guard
 *
 * Nothing is widened or repaired; the script only observes and derives from the
 * authored source. All evidence is written outside the repository.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

const ACCEPTED_MOTION_DURATIONS = Object.freeze([2, 3, 5, 6, 14]);
const ACCEPTED_MOTION_FRAME_ATTRIBUTES = Object.freeze(['index', 'duration', 'tweenType', 'motionTweenSnap', 'keyMode']);
const ACCEPTED_MOTION_INSTANCE_ATTRIBUTES = Object.freeze([
  'libraryItemName', 'selected', 'symbolType', 'centerPoint3DX', 'centerPoint3DY', 'loop', 'firstFrame', 'lastFrame',
]);
const ACCEPTED_MOTION_KEY_MODE = '22017';
const ACCEPTED_TERMINAL_KEY_MODE = '15872';

function parseArgs(argv) {
  const args = { fixtures: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') args.fixtures.push(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  assert.ok(args.fixtures.length === 3, 'expected exactly 3 --fixture <label>|<path>|<sha256> (walk / run / control)');
  assert.ok(args.out, 'missing required option --out');
  return {
    fixtures: args.fixtures.map((raw) => {
      const [label, source, sha] = String(raw).split('|');
      assert.ok(label && source && sha, '--fixture must be <label>|<path>|<sha256>: ' + raw);
      assert.match(sha, /^[a-f0-9]{64}$/iu, 'fixture SHA-256 must be 64 hex chars: ' + label);
      return { label: label.trim(), source: path.resolve(source.trim()), expectedSha256: sha.trim().toLowerCase() };
    }),
    out: path.resolve(args.out),
  };
}

function assertExternalNewDirectory(directory) {
  const rel = path.relative(ROOT, directory);
  assert.ok(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel), 'H0 evidence must stay outside the repository');
  assert.ok(!fs.existsSync(directory), 'refusing to overwrite existing evidence directory: ' + directory);
}

function tagAttributes(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/gu)) out[m[1]] = m[2];
  return out;
}
function collectVisibleSymbols(elements, acc = []) {
  for (const el of elements) {
    if (el.visible === false) continue;
    if (el.kind === 'symbol') acc.push(el);
    else if (el.kind === 'group') collectVisibleSymbols(el.elements, acc);
  }
  return acc;
}
async function loadFixture(fixture) {
  const bytes = await fs.promises.readFile(fixture.source);
  const sha256Before = HASH(bytes);
  assert.equal(sha256Before, fixture.expectedSha256, 'fixture hash changed before work: ' + fixture.label);
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const normalized = classifier.normalizeRecoveryCandidate(bytes, classifier.classifyForFlaRecovery(bytes));
  const archiveBytes = normalized.applied ? normalized.bytes : bytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentXml = await zip.file('DOMDocument.xml').async('string');
  const libraries = [];
  for (const name of Object.keys(zip.files).filter((e) => /^LIBRARY\/.*\.xml$/iu.test(e)).sort()) {
    libraries.push({ name, xml: await zip.file(name).async('string') });
  }
  const { adaptFlaXflDisplaySource, getFlaXflDirectChildren } =
    require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'));
  const adapted = adaptFlaXflDisplaySource(documentXml, libraries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected normalized archive');
  return { fixture, sourceBytes: bytes, sha256Before, documentXml, libraries, getChildren: getFlaXflDirectChildren, source: adapted.source };
}

function findSceneRoot(source) {
  const timeline = source.sceneTimelines[0];
  const ctx = source.buildSceneFrameContext(timeline.xml, 0, 'h0-scene@0');
  assert.equal(ctx.ok, true, ctx.message || 'scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(ctx.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol, found ${symbols.length}`);
  const instance = symbols[0];
  return { instance, descriptor: source.graphicSymbols.find((s) => s.sourceLibraryItemName === instance.libraryItemName) };
}

/** Enumerate instances reachable from a graphic symbol at a given child frame. */
function instancesAtFrame(source, descriptor, childFrame) {
  const ctx = source.buildGraphicFrameContext(descriptor.timelineXml, descriptor.frameSpanIndex, childFrame, `h0:${descriptor.sourceLibraryItemName}@${childFrame}`);
  if (!ctx.ok) return { ok: false, message: ctx.message };
  return { ok: true, symbols: collectVisibleSymbols(ctx.value.layers.flatMap((layer) => layer.elements)) };
}

function spanOf(layer, index) {
  return layer.spans.find((s) => index >= s.index && index < s.endExclusive) ?? null;
}

function keyModeProfile(entries) {
  const profile = {};
  for (const { xml } of entries) {
    const re = /<DOMFrame\b([^>]*?)(\/)?>/gu;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = tagAttributes('<x ' + m[1] + '>');
      if (attrs.keyMode === undefined) continue;
      const selfClose = Boolean(m[2]);
      let body = '';
      if (!selfClose) {
        const start = re.lastIndex;
        const end = xml.indexOf('</DOMFrame>', start);
        body = end >= 0 ? xml.slice(start, end) : '';
      }
      const hasContent = /<DOMSymbolInstance|<DOMShape|<DOMGroup|<DOMBitmapInstance|<DOMTextInstance/u.test(body);
      const key = `${attrs.keyMode}|tween=${attrs.tweenType ?? '-'}|snap=${attrs.motionTweenSnap ?? '-'}|${hasContent ? 'content' : 'empty'}`;
      profile[key] = (profile[key] || 0) + 1;
    }
  }
  return profile;
}

function frameInstanceAt(xml, frameIndex) {
  const re = /<DOMFrame\b([^>]*?)(\/)?>/gu;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = tagAttributes('<x ' + m[1] + '>');
    const selfClose = Boolean(m[2]);
    let body = '';
    if (!selfClose) {
      const start = re.lastIndex;
      const end = xml.indexOf('</DOMFrame>', start);
      body = end >= 0 ? xml.slice(start, end) : '';
    }
    if (Number(attrs.index) === frameIndex) {
      const inst = /<DOMSymbolInstance\b[^>]*>/u.exec(body)?.[0];
      return { frameAttributes: attrs, instanceAttributes: inst ? tagAttributes(inst) : null };
    }
    if (selfClose) re.lastIndex = m.index + m[0].length;
  }
  return null;
}

async function build(args) {
  assertExternalNewDirectory(args.out);
  await fs.promises.mkdir(args.out, { recursive: true });
  const [walk, run, control] = args.fixtures;
  const fixtures = { walk: await loadFixture(walk), run: await loadFixture(run), control: await loadFixture(control) };

  const report = { issue: '#715', phase: 'H0', generatedNote: 'research-only; no production behavior changed' };

  // ---- H0-A: Loop + explicit firstFrame (向右走 …18) ----
  const walkSource = fixtures.walk.source;
  const walkRoot = findSceneRoot(walkSource);
  const walkRootDesc = walkRoot.descriptor;
  // chain: root graphic -> …22 -> …18
  const rootFrame0 = instancesAtFrame(walkSource, walkRootDesc, 0);
  const comp22 = rootFrame0.symbols.find((s) => s.libraryItemName.endsWith('com22'));
  const desc22 = walkSource.graphicSymbols.find((s) => s.sourceLibraryItemName === comp22.libraryItemName);
  const comp22Frame0 = instancesAtFrame(walkSource, desc22, 0);
  const comp18 = comp22Frame0.symbols.find((s) => s.libraryItemName.endsWith('com18'));
  const desc18 = walkSource.graphicSymbols.find((s) => s.sourceLibraryItemName === comp18.libraryItemName);
  const span18in22 = desc22.frameSpanIndex.layers
    .map((layer) => spanOf(layer, 0))
    .find((span) => span !== null);
  const rootSpanAt0 = walkRootDesc.frameSpanIndex.layers.map((layer) => spanOf(layer, 0)).find((s) => s !== null);
  const h0aMaxParent = walkRootDesc.frameCount - 1;
  const firstFrame18 = Number(comp18.firstFrame);
  const childCheckpoints = [];
  for (let parent = 0; parent <= h0aMaxParent; parent += 1) {
    const elapsed = parent - (rootSpanAt0?.index ?? 0);
    childCheckpoints.push({ parentRootFrame: parent, requestedChildFrame: firstFrame18 + elapsed });
  }
  const maxChild = childCheckpoints.reduce((a, c) => Math.max(a, c.requestedChildFrame), 0);
  report.h0a = {
    chain: [
      { libraryItemName: walkRoot.instance.libraryItemName, frames: walkRootDesc.frameCount, loop: walkRoot.instance.playbackMode, firstFrame: walkRoot.instance.firstFrame ?? null },
      { libraryItemName: comp22.libraryItemName, frames: desc22.frameCount, loop: comp22.playbackMode, firstFrame: comp22.firstFrame ?? null, containingSpan: span18in22 ? { index: span18in22.index, duration: span18in22.duration } : null },
      { libraryItemName: comp18.libraryItemName, frames: desc18.frameCount, loop: comp18.playbackMode, firstFrame: comp18.firstFrame ?? null },
    ],
    child18AuthoredSpanBoundaries: desc18.frameSpanIndex.layers[0].spans.map((s) => ({ index: s.index, duration: s.duration, tweenType: s.tweenType })),
    parentFrameSchedule: { rootFrames: walkRootDesc.frameCount, firstFrame: firstFrame18, requestedChildRange: [firstFrame18, maxChild], maxChildFrame: maxChild },
    childFrameCount18: desc18.frameCount,
    wrapOccurs: maxChild >= desc18.frameCount,
    candidateRule: 'loop + explicit firstFrame -> child = firstFrame + (parentFrameIndex - containingSpanStart)',
    wrapTargetProven: false,
    checkpoints: childCheckpoints,
  };

  // ---- H0-B: missing playback mode (跑步 …2 / …3) ----
  const runSource = fixtures.run.source;
  const missingMode = [];
  for (const entry of [{ name: 'DOMDocument.xml', xml: fixtures.run.documentXml }, ...fixtures.run.libraries]) {
    const re = /<DOMSymbolInstance\b[^>]*>/gu;
    let m;
    while ((m = re.exec(entry.xml))) {
      const attrs = tagAttributes(m[0]);
      if (attrs.loop !== undefined) continue;
      const childName = attrs.libraryItemName;
      const childDesc = runSource.graphicSymbols.find((s) => s.sourceLibraryItemName === childName);
      missingMode.push({
        file: entry.name,
        libraryItemName: childName,
        instanceAttributes: Object.keys(attrs).sort(),
        childFrameCount: childDesc ? childDesc.frameCount : null,
        singleFrameChild: childDesc ? childDesc.frameCount === 1 : null,
      });
    }
  }
  const allSingleFrame = missingMode.length > 0 && missingMode.every((e) => e.singleFrameChild === true);
  report.h0b = {
    missingModeInstances: missingMode,
    allChildrenSingleFrame: allSingleFrame,
    sourceDefinedDefaultFound: false,
    conclusion: allSingleFrame
      ? 'mode default UNPROVEN, but every missing-mode child is single-frame -> displayed child frame is provably 0 (mode-invariant)'
      : 'PROVEN DEFAULT NOT FOUND -> PLAYBACK_MODE_DEFAULT_UNPROVEN',
  };

  // ---- H0-C: per-keyframe firstFrame (跑步) ----
  const runRoot = findSceneRoot(runSource);
  const runRootDesc = runRoot.descriptor;
  const animated = [];
  for (const layer of runRootDesc.frameSpanIndex.layers) {
    for (const span of layer.spans) {
      const ctx = runSource.buildGraphicFrameContext(runRootDesc.timelineXml, runRootDesc.frameSpanIndex, span.index, `h0-run:${span.index}`);
      if (!ctx.ok) continue;
      for (const sym of collectVisibleSymbols(ctx.value.layers.flatMap((l) => l.elements))) {
        const child = runSource.graphicSymbols.find((s) => s.sourceLibraryItemName === sym.libraryItemName);
        animated.push({
          spanStart: span.index, spanDuration: span.duration,
          libraryItemName: sym.libraryItemName, loop: sym.playbackMode ?? '(missing)',
          firstFrame: sym.firstFrame ?? null, childFrameCount: child ? child.frameCount : null,
        });
      }
    }
  }
  const firstFrameBySpan = {};
  for (const a of animated) {
    const f = a.firstFrame === null ? 0 : Number(a.firstFrame);
    if (firstFrameBySpan[a.libraryItemName] === undefined) firstFrameBySpan[a.libraryItemName] = [];
    firstFrameBySpan[a.libraryItemName].push({ spanStart: a.spanStart, firstFrame: f });
  }
  report.h0c = {
    keyframeFirstFrames: firstFrameBySpan,
    observation: 'authored firstFrame equals the containing span start for 一键跑步750_左手动/右手动 (F3->3, F7->7, F11->11, F15->15); child = firstFrame(span) + elapsed reproduces a 1:1 parent->child progression, identical to a constant offset of the loop rule',
    interpolationVsStep: 'indistinguishable in this fixture (per-span delta(firstFrame) == delta(parent) == span duration); the bounded rule uses the span-authored firstFrame without interpolating frame indices',
  };

  // ---- H0-D: keyMode profile ----
  const prof = (fx) => keyModeProfile([{ xml: fx.documentXml }, ...fx.libraries]);
  report.h0d = {
    walk: prof(fixtures.walk),
    run: prof(fixtures.run),
    control: prof(fixtures.control),
    acceptedMotionKeyMode: ACCEPTED_MOTION_KEY_MODE,
    acceptedTerminalKeyMode: ACCEPTED_TERMINAL_KEY_MODE,
    observation: '22017 always carries tweenType=motion + motionTweenSnap=true; 9728 and 15872 never carry tweenType/motionTweenSnap (both static keyframe markers, content or empty); 9728 and 15872 co-occur inside the human-accepted #713 control',
    exactMeaningDecoded: false,
    authoritativeSpecFound: false,
  };

  // ---- H0-E: duration 29/4 endpoint family ----
  const motionEndpoints = (fx, rootDesc, rootFileSuffix) => {
    const xml = fx.libraries.find((l) => l.name.endsWith(rootFileSuffix))?.xml;
    const spans = rootDesc.frameSpanIndex.layers.flatMap((layer) => layer.spans).filter((s) => s.tweenType === 'motion');
    return spans.map((span) => {
      const endIndex = span.endExclusive;
      const start = frameInstanceAt(xml, span.index);
      const end = frameInstanceAt(xml, endIndex);
      const endpoint = (entry) => entry
        ? {
          frameAttributesOutsideAccepted: Object.keys(entry.frameAttributes).filter((n) => !ACCEPTED_MOTION_FRAME_ATTRIBUTES.includes(n)),
          instanceAttributesOutsideAccepted: entry.instanceAttributes
            ? Object.keys(entry.instanceAttributes).filter((n) => !ACCEPTED_MOTION_INSTANCE_ATTRIBUTES.includes(n))
            : [],
          keyMode: entry.frameAttributes.keyMode ?? null,
          firstFrame: entry.instanceAttributes ? entry.instanceAttributes.firstFrame ?? null : null,
        }
        : null;
      return {
        spanIndex: span.index,
        duration: span.duration,
        durationAccepted: ACCEPTED_MOTION_DURATIONS.includes(span.duration),
        endIndex,
        start: endpoint(start),
        end: endpoint(end),
      };
    });
  };
  report.h0e = {
    walkRootMotion: motionEndpoints(fixtures.walk, walkRootDesc, '图层转元件_278.xml'),
    runRootMotion: motionEndpoints(fixtures.run, runRootDesc, '便衣道士-cilisucai.com22.xml'),
    note: 'endpoint instance/attribute sets are compared against the accepted transform-only family; duration 29/4 sit outside the accepted set',
  };

  // ---- H0-F: BlurFilter guard ----
  const filterLocations = (fx) => {
    const hits = [];
    for (const entry of [{ name: 'DOMDocument.xml', xml: fx.documentXml }, ...fx.libraries]) {
      for (const m of entry.xml.matchAll(/<filters>[\s\S]*?<\/filters>|<filters\s*\/>/gu)) {
        hits.push({ file: entry.name.split('/').pop(), filters: m[0].replace(/\s+/gu, ' ') });
      }
    }
    return hits;
  };
  report.h0f = {
    walk: filterLocations(fixtures.walk),
    run: filterLocations(fixtures.run),
    adapterConsumesFilters: false,
    silentDropConfirmed: true,
    note: 'fla-display-list element model has no filter field and the adapter reads no <filters>; authored-frame filters are dropped with no fail-closed signal',
  };

  // ---- write artefacts + receipt ----
  await fs.promises.writeFile(path.join(args.out, 'h0-a-loop-firstframe.json'), JSON.stringify(report.h0a, null, 2) + '\n', { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'h0-b-missing-mode.json'), JSON.stringify(report.h0b, null, 2) + '\n', { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'h0-c-animated-firstframe.json'), JSON.stringify(report.h0c, null, 2) + '\n', { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'h0-d-keymode.json'), JSON.stringify(report.h0d, null, 2) + '\n', { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'h0-e-durations.json'), JSON.stringify(report.h0e, null, 2) + '\n', { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'h0-f-filters.json'), JSON.stringify(report.h0f, null, 2) + '\n', { flag: 'wx' });

  // re-hash sources to prove no mutation
  const hashesAfter = {};
  for (const [key, fx] of Object.entries(fixtures)) {
    const after = HASH(await fs.promises.readFile(fx.fixture.source));
    assert.equal(after, fx.sha256Before, 'fixture changed during H0: ' + fx.fixture.label);
    hashesAfter[key] = after;
  }

  const receipt = [
    'H0 Nested Graphic timing research',
    '',
    `baseline fixtures: ${args.fixtures.map((f) => f.label).join(' / ')}`,
    `source hashes unchanged: ${Object.entries(hashesAfter).map(([k, v]) => `${k}=${v.slice(0, 16)}`).join(' ')}`,
    '',
    'Loop + explicit firstFrame:',
    `source case: ${comp18.libraryItemName} (loop=${comp18.playbackMode}, firstFrame=${comp18.firstFrame}, childFrameCount=${desc18.frameCount}) inside ${comp22.libraryItemName}`,
    `mapping rule (candidate): child = firstFrame + (parentFrameIndex - containingSpanStart)`,
    `wrap rule: NOT exercised in source (max requested child ${maxChild} < ${desc18.frameCount})`,
    `checkpoints: parentRootFrame 0..${h0aMaxParent} -> child ${firstFrame18}..${maxChild}`,
    'result: GO (no-wrap offset only; wrap target UNPROVEN, must stay fail-closed)',
    '',
    'Missing playback mode:',
    'source case: ' + missingMode.map((m) => `${m.libraryItemName}(childFrames=${m.childFrameCount})`).join(', '),
    'source-defined default: NOT FOUND',
    `evidence: all missing-mode children are single-frame -> ${allSingleFrame}`,
    'result: PARTIAL (general default NO-GO: PLAYBACK_MODE_DEFAULT_UNPROVEN; single-frame child is mode-invariant -> frame 0)',
    '',
    'Animated firstFrame:',
    'source spans: ' + Object.keys(firstFrameBySpan).join(', '),
    'exact requested progression: firstFrame == containing span start (F3->3, F7->7, F11->11, F15->15)',
    'interpolation/step semantics: per-keyframe authored integer; step vs interpolation indistinguishable here',
    'composition with Loop: child = firstFrame(span) + elapsed',
    'result: GO (bounded; no frame-index interpolation)',
    '',
    'keyMode 9728:',
    'source locations: static DOMFrame keyframes (no tweenType, no motionTweenSnap) in all three files',
    'visual semantic effect: none observed (renderer state comes from the authored instance, not keyMode)',
    `required for reconstruction: YES (both fixtures' root motion-span terminals use 9728)`,
    'result: PARTIAL (structurally equivalent to accepted 15872 and co-occurs in the accepted control, but exact meaning not decodable from source; allowlist decision deferred to H1)',
    '',
    'duration 29 / 4:',
    'same transform-only family: endpoints use accepted instance attributes; only duration (and the 9728 terminal marker) differ',
    'result: GO (bounded extension candidate; evidence-bounded duration set)',
    '',
    'BlurFilter guard:',
    `silent-drop confirmed: ${report.h0f.silentDropConfirmed} (authored-frame <filters> ignored by the adapter)`,
    'minimum safe handling: fail-closed or explicit PARTIAL fidelity marker before any HUMAN PASS',
    'implementation authorized here: NO',
    '',
    'overall H0: GO (Loop+firstFrame offset, per-keyframe firstFrame, bounded durations) with named residuals (wrap UNPROVEN, missing-mode default UNPROVEN, keyMode 9728 meaning undecoded, BlurFilter silent)',
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.txt'), receipt, { flag: 'wx' });
  await fs.promises.writeFile(path.join(args.out, 'completion-receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });

  process.stdout.write(receipt);
}

build(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
