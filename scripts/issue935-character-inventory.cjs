'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('./issue935-character-inventory-core.cjs');

const ROOT = path.resolve(__dirname, '..');
const MAX_VISUAL_CANDIDATES = 3;
const FILE_TIMEOUT_MS = 120_000;
let prepareDisplaySource;
let stableTargetId;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--root') args.root = argv[++index];
    else if (option === '--out') args.out = argv[++index];
    else if (option === '--expected-list') args.expectedList = argv[++index];
    else if (option === '--prior-evidence') args.priorEvidence = argv[++index];
    else if (option === '--manifest') args.manifestPath = argv[++index];
    else if (option === '--review-file') args.reviewFile = argv[++index];
    else if (option === '--apply-review') args.applyReview = true;
    else if (option === '--render-s2') args.renderS2 = true;
  }
  return args;
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]+/giu, '_').slice(0, 90) || 'target';
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markdownTableCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function renderMarkdown(manifest) {
  const summary = manifest.summary ?? {};
  const lines = [
    '# CA-SCAN-01 private FLA inventory',
    '',
    `Status: **${manifest.status}**`,
    `Source directory: \`${manifest.source?.rootPath ?? 'unavailable'}\``,
    `Discovered / parsed / unsupported: **${summary.discoveredCount ?? manifest.files.length} / ${summary.parsedCount ?? 0} / ${summary.unsupportedCount ?? 0}**`,
    `FULL_BODY_ACTION_CANDIDATE / PARTIAL_ACTION_ONLY / STATIC_OR_MULTIVIEW / UNKNOWN_OR_UNSUPPORTED: **${summary.classificationCounts?.FULL_BODY_ACTION_CANDIDATE ?? 0} / ${summary.classificationCounts?.PARTIAL_ACTION_ONLY ?? 0} / ${summary.classificationCounts?.STATIC_OR_MULTIVIEW ?? 0} / ${summary.classificationCounts?.UNKNOWN_OR_UNSUPPORTED ?? 0}**`,
    `Target classifications (same order): **${summary.targetClassificationCounts?.FULL_BODY_ACTION_CANDIDATE ?? 0} / ${summary.targetClassificationCounts?.PARTIAL_ACTION_ONLY ?? 0} / ${summary.targetClassificationCounts?.STATIC_OR_MULTIVIEW ?? 0} / ${summary.targetClassificationCounts?.UNKNOWN_OR_UNSUPPORTED ?? 0}**`,
    `Recursive coverage complete: **${manifest.enumeration?.complete ? 'YES' : 'NO'}**`,
    `Screenshot names present: **${manifest.expectedScreenshotCheck?.presentCount ?? 'NOT_CHECKED'}/${manifest.expectedScreenshotCheck?.expectedCount ?? 'NOT_CHECKED'}**`,
    '',
    '## File classification',
    '',
    '| Relative path | SHA-256 | Bytes | Main classification | Parser |',
    '| --- | --- | ---: | --- | --- |',
  ];
  for (const file of manifest.files) {
    lines.push(`| ${markdownTableCell(file.relativePath)} | ${markdownTableCell(file.sha256 ?? '')} | ${file.byteLength ?? ''} | ${file.classification} | ${file.parserStatus} |`);
  }
  lines.push('', '## Target details', '', '| File | Target identity | Kind | FPS | Frames | Tween spans | Frame change | Root transform change | Category | Notes |', '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |');
  for (const file of manifest.files) {
    for (const target of file.targets ?? []) {
      const tweenCount = target.motionEvidence?.motionTweenSpanCount ?? 0;
      const rootChange = target.motionEvidence?.visibleRootTransformChanged ? 'YES' : 'NO';
      const frameChange = target.s2?.renderedFramesDiffer === true
        ? 'RENDERED'
        : target.frameContextChanged ? 'STRUCTURAL' : 'NO';
      lines.push(`| ${markdownTableCell(file.relativePath)} | ${markdownTableCell(`${target.userLabel} (${target.renderTargetId})`)} | ${target.kind} | ${target.sourceFps ?? ''} | ${target.frameCount ?? ''} | ${tweenCount} | ${frameChange} | ${rootChange} | ${target.classification} | ${markdownTableCell(target.classificationReason)} |`);
    }
  }
  lines.push('', '## Bounded S2 checks', '');
  if (manifest.s2?.candidates?.length) {
    for (const candidate of manifest.s2.candidates) {
      lines.push(`- ${candidate.relativePath} · ${candidate.userLabel} · ${candidate.renderTargetId} · frames ${candidate.sampleFrameIndices.join(', ')} · ${candidate.previewStatus} · preview: \`${candidate.previewHtml ?? 'not produced'}\``);
    }
  } else {
    lines.push('- No renderable structural-motion targets were selected.');
  }
  lines.push('', '## Product decision', '', `**${summary.recommendation?.status ?? 'NO_SUITABLE_SOURCE'}**`);
  if (summary.recommendation?.status === 'RECOMMEND_P01') {
    lines.push('', `Primary: ${summary.recommendation.primary.file.relativePath} · ${summary.recommendation.primary.target.userLabel} · ${summary.recommendation.primary.target.renderTargetId}`);
    if (summary.recommendation.backup) lines.push(`Backup: ${summary.recommendation.backup.file.relativePath} · ${summary.recommendation.backup.target.userLabel} · ${summary.recommendation.backup.target.renderTargetId}`);
  } else {
    lines.push('', 'Next step: choose a product route that does not depend on an unverified complete native character action.');
  }
  lines.push('', 'This file, the JSON manifest, all source names, hashes, and rendered frames are private local evidence. No source artwork is copied into the repository.');
  return `${lines.join('\n')}\n`;
}

function refreshAndWriteManifest(manifest, runDirectory, partial = false) {
  core.refreshSummary(manifest);
  const fsSync = require('node:fs');
  fsSync.writeFileSync(path.join(runDirectory, 'inventory.partial.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!partial) {
    fsSync.writeFileSync(path.join(runDirectory, 'inventory.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fsSync.writeFileSync(path.join(runDirectory, 'inventory.md'), renderMarkdown(manifest));
  }
}

function collectVisibleElements(context) {
  const elements = [];
  const counts = { shape: 0, bitmap: 0, symbol: 0, group: 0 };
  const topLevel = [];
  const visit = (element, address, depth) => {
    if (!element || element.visible === false || depth > 64) return;
    const matrix = element.localTransform ?? null;
    const item = {
      kind: element.kind,
      sourceAddress: element.sourceAddress ?? address,
      sourceLibraryItemName: element.libraryItemName ?? null,
      shapeId: element.shapeId ?? null,
      symbolType: element.symbolType ?? null,
      localTransform: matrix,
    };
    elements.push(item);
    if (Object.hasOwn(counts, element.kind)) counts[element.kind] += 1;
    if (element.kind === 'group') {
      for (let index = 0; index < element.elements.length; index += 1) {
        visit(element.elements[index], `${address}/group-${index}`, depth + 1);
      }
    }
  };
  for (let layerIndex = 0; layerIndex < (context?.layers?.length ?? 0); layerIndex += 1) {
    const layer = context.layers[layerIndex];
    if (!layer?.visible) continue;
    for (let elementIndex = 0; elementIndex < layer.elements.length; elementIndex += 1) {
      const element = layer.elements[elementIndex];
      if (element?.visible === false) continue;
      topLevel.push({
        kind: element?.kind ?? 'unknown',
        sourceAddress: element?.sourceAddress ?? `layer-${layerIndex}/element-${elementIndex}`,
        sourceLibraryItemName: element?.libraryItemName ?? null,
        localTransform: element?.localTransform ?? null,
      });
      visit(element, `layer-${layerIndex}/element-${elementIndex}`, 0);
    }
  }
  const normalized = elements.map((element) => JSON.stringify(element));
  return {
    frameIndex: context?.frameIndex ?? null,
    unsupportedDisplayReason: context?.unsupportedDisplayReason ?? null,
    visibleElementCount: elements.length,
    visibleElementCounts: counts,
    occurrenceKeys: [...new Set(elements.map((element) => `${element.kind}:${element.sourceAddress}:${element.sourceLibraryItemName ?? element.shapeId ?? ''}`))].sort(),
    signature: hash(Buffer.from(normalized.join('\n'), 'utf8')),
    topLevel,
    sourceOccurrences: elements.slice(0, 200),
  };
}

function summarizeMotionSpans(frameSpanIndex) {
  const spans = [];
  for (let layerIndex = 0; layerIndex < (frameSpanIndex?.layers?.length ?? 0); layerIndex += 1) {
    const layer = frameSpanIndex.layers[layerIndex];
    if (!layer?.visible) continue;
    for (const span of layer.spans) {
      const tweenType = span.tweenType ?? 'none';
      spans.push({
        layerIndex,
        index: span.index,
        duration: span.duration,
        endExclusive: span.endExclusive,
        tweenType,
        sourceFrameAttributes: span.sourceFrame?.attributes ?? {},
      });
    }
  }
  return {
    motionTweenSpanCount: spans.filter((span) => span.tweenType === 'motion').length,
    shapeTweenSpanCount: spans.filter((span) => span.tweenType === 'shape').length,
    authoredSpanCount: spans.length,
    spans: spans.slice(0, 200),
  };
}

function matrixKey(matrix) {
  if (!matrix) return 'identity-or-absent';
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].join(',');
}

function compareSnapshots(snapshots) {
  const usable = snapshots.filter((snapshot) => snapshot.ok).map((snapshot) => snapshot.snapshot);
  const signatures = new Set(usable.map((snapshot) => snapshot.signature));
  const keys = usable.map((snapshot) => new Set(snapshot.occurrenceKeys));
  const firstTop = usable[0]?.topLevel[0] ?? null;
  const visibleRootTransformChanged = Boolean(firstTop && usable.some((snapshot) => {
    const next = snapshot.topLevel.find((item) => item.sourceAddress === firstTop.sourceAddress);
    return next && matrixKey(next.localTransform) !== matrixKey(firstTop.localTransform);
  }));
  const retainedOccurrences = keys.length > 1
    ? [...keys[0]].filter((key) => keys.slice(1).every((set) => set.has(key)))
    : [...(keys[0] ?? [])];
  const addedOrRemovedOccurrenceCount = keys.length > 1
    ? new Set(keys.flatMap((set) => [...set])).size - retainedOccurrences.length
    : 0;
  return {
    frameContextChanged: signatures.size > 1,
    sampleSignatureCount: signatures.size,
    visibleRootTransformChanged,
    retainedOccurrenceCount: retainedOccurrences.length,
    addedOrRemovedOccurrenceCount,
    sampleFailures: snapshots.filter((snapshot) => !snapshot.ok).map((snapshot) => ({ frameIndex: snapshot.frameIndex, reason: snapshot.reason })),
  };
}

function candidateTarget(entry, bytes, source) {
  if (entry.kind === 'scene') {
    const sceneIndex = entry.index;
    const scene = source.sceneTimelines.find((item) => item.index === sceneIndex);
    if (!scene || scene.frameCount <= 0) return null;
    return {
      owner: scene,
      frameSpanIndex: scene.frameSpanIndex ?? null,
      target: {
        renderTargetId: stableTargetId(bytes, `scene\u0000timeline\u0000${scene.index}`),
        kind: 'scene',
        userLabel: scene.name || `Scene ${scene.index + 1}`,
        sourceTimelineIndex: scene.index,
        frameCount: Math.min(100_000, scene.frameCount),
        selectedFrameIndex: 0,
        compatibility: ['degraded'],
      },
      buildContext: (frameIndex) => source.buildSceneFrameContext(scene.xml, frameIndex, `issue935:scene:${scene.index}:${frameIndex}`),
    };
  }
  const symbol = source.graphicSymbols.find((item) => item.sourceLibraryItemName === entry.sourceLibraryItemName);
  if (!symbol) return null;
  return {
    owner: symbol,
    frameSpanIndex: symbol.frameSpanIndex,
    target: {
      renderTargetId: stableTargetId(bytes, `graphic-symbol\u0000${symbol.sourceLibraryItemName}\u0000${symbol.userLabel}`),
      kind: 'graphic-symbol',
      userLabel: symbol.userLabel,
      sourceLibraryItemName: symbol.sourceLibraryItemName,
      frameCount: Math.min(100_000, Math.max(1, symbol.frameCount)),
      selectedFrameIndex: 0,
      compatibility: ['degraded'],
    },
    buildContext: (frameIndex) => source.buildGraphicFrameContext(
      symbol.timelineXml,
      symbol.frameSpanIndex,
      frameIndex,
      `issue935:graphic:${symbol.sourceLibraryItemName}:${frameIndex}`,
    ),
  };
}

async function prepareTimelineEvidence(bytes, inspection, catalogEntries) {
  const display = await prepareDisplaySource(bytes);
  if (!display.ok) return { ok: false, reason: display.message };
  const source = display.source;
  const catalogByTargetId = new Map(catalogEntries.map((entry) => [entry.target.renderTargetId, entry]));
  const targetEntries = [
    ...source.sceneTimelines.map((scene) => ({ kind: 'scene', index: scene.index })),
    ...source.graphicSymbols.map((symbol) => ({ kind: 'graphic-symbol', sourceLibraryItemName: symbol.sourceLibraryItemName })),
  ];
  const targets = [];
  for (const entry of targetEntries) {
    const owner = candidateTarget(entry, bytes, source);
    if (!owner) continue;
    const target = owner.target;
    const catalogEntry = catalogByTargetId.get(target.renderTargetId) ?? null;
    const sampleFrameIndices = core.sampleFrameIndices(target.frameCount);
    const snapshots = [];
    for (const frameIndex of sampleFrameIndices) {
      const result = owner.buildContext(frameIndex);
      snapshots.push(result.ok
        ? { ok: true, frameIndex, snapshot: collectVisibleElements(result.value) }
        : { ok: false, frameIndex, reason: result.message });
    }
    const motionEvidence = summarizeMotionSpans(owner.frameSpanIndex);
    const comparison = compareSnapshots(snapshots);
    const frameContextChanged = comparison.frameContextChanged;
    const structuralDynamic = target.frameCount > 1 && (
      frameContextChanged || motionEvidence.motionTweenSpanCount > 0 || motionEvidence.shapeTweenSpanCount > 0
    );
    const firstSnapshot = snapshots.find((item) => item.ok)?.snapshot ?? null;
    const previewSupported = catalogEntry ? catalogEntry.previewSupported : null;
    const classification = core.classifyTargetEvidence({
      structuralDynamic,
      frameContextChanged,
      previewSupported: previewSupported === false ? false : undefined,
      unsupportedReason: catalogEntry?.unsupportedReason ?? null,
    });
    targets.push({
      renderTargetId: target.renderTargetId,
      kind: target.kind,
      userLabel: target.userLabel,
      sourceLibraryItemName: target.sourceLibraryItemName ?? null,
      sourceTimelineIndex: target.sourceTimelineIndex ?? null,
      frameCount: target.frameCount,
      sourceFps: inspection.document?.frameRate ?? null,
      frameRange: target.frameCount > 0 ? { start: 0, end: target.frameCount - 1 } : null,
      catalogRole: catalogEntry?.catalogRole ?? null,
      previewSupported,
      unsupportedReason: catalogEntry?.unsupportedReason ?? null,
      structuralDynamic,
      frameContextChanged,
      motionEvidence: {
        ...motionEvidence,
        ...comparison,
        sampleFrameIndices,
        samples: snapshots.map((item) => item.ok
          ? { frameIndex: item.frameIndex, ...item.snapshot }
          : { frameIndex: item.frameIndex, failure: item.reason }),
      },
      sourceComposition: {
        graphicSymbolCount: source.graphicSymbols.length,
        nestedGraphicSymbolCount: source.graphicSymbols.filter((symbol) => symbol.hasNestedSymbol).length,
        visibleElementCountsAtFirstSample: firstSnapshot?.visibleElementCounts ?? null,
        visibleElementCountAtFirstSample: firstSnapshot?.visibleElementCount ?? null,
        sourceOccurrencesAtFirstSample: firstSnapshot?.sourceOccurrences ?? [],
      },
      classification: classification.classification,
      classificationReason: classification.reason,
      s2Candidate: structuralDynamic && previewSupported !== false && target.frameCount > 1,
      s2: null,
      _target: target,
    });
  }
  return { ok: true, targets };
}

function expectedNameCheck(expectedNames, files) {
  if (!expectedNames) return null;
  const expected = expectedNames.map((name) => String(name));
  const actual = new Map();
  for (const file of files) {
    const basename = path.posix.basename(file.relativePath);
    const key = core.normalizePathKey(basename);
    const group = actual.get(key) ?? [];
    group.push(file.relativePath);
    actual.set(key, group);
  }
  const present = [];
  const missing = [];
  const ambiguous = [];
  for (const name of expected) {
    const matches = actual.get(core.normalizePathKey(name)) ?? [];
    if (matches.length === 0) missing.push(name);
    else if (matches.length > 1) ambiguous.push({ expectedName: name, relativePaths: matches });
    else present.push(name);
  }
  return { expectedCount: expected.length, presentCount: present.length, present, missing, ambiguous };
}

async function inspectFileInProduction(mainWindow, filePath) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = filePath;
  const requestId = crypto.randomUUID();
  const expression = `
    (async () => {
      const api = window.pandaStage.fla;
      const inspected = await api.chooseAndInspect(${JSON.stringify(requestId)});
      if (!inspected.ok) return { ok: false, error: inspected.error, trace: inspected.trace ?? null };
      const catalog = await api.staticSnapshotCatalog({
        format: 'fla-static-snapshot-catalog', version: 1, sessionId: inspected.sessionId,
      });
      if (!catalog.ok) {
        await api.cancel(inspected.sessionId);
        return { ok: false, sessionId: inspected.sessionId, error: catalog.error, trace: inspected.trace ?? null };
      }
      return {
        ok: true,
        sessionId: inspected.sessionId,
        source: inspected.ir.source,
        document: inspected.ir.document,
        structure: inspected.ir.structure ?? null,
        summary: inspected.ir.summary,
        mediaCount: inspected.ir.media.length,
        timelineCount: inspected.ir.timelines.length,
        trace: inspected.trace ?? null,
        catalog: catalog.entries,
        omittedCandidateCount: catalog.omittedCandidateCount,
      };
    })()
  `;
  return mainWindow.webContents.executeJavaScript(expression, true);
}

async function renderPrivateFrames(mainWindow, candidate, runDirectory, candidateOrdinal) {
  const previewDirectory = path.join(runDirectory, 'previews');
  await fs.mkdir(previewDirectory, { recursive: true });
  const sessionId = candidate.sessionId;
  const target = candidate.target;
  const imageRecords = [];
  for (const frameIndex of candidate.sampleFrameIndices) {
    const requestId = crypto.randomUUID();
    const expression = `
      (async () => {
        const result = await window.pandaStage.fla.staticSnapshotPreview({
          format: 'fla-static-snapshot-preview', version: 1,
          requestId: ${JSON.stringify(requestId)},
          sessionId: ${JSON.stringify(sessionId)},
          target: { ...${JSON.stringify(target)}, selectedFrameIndex: ${frameIndex} },
        });
        if (!result.ok) return { ok: false, error: result.error };
        return {
          ok: true,
          targetRenderTargetId: result.targetRenderTargetId,
          targetSelectedFrameIndex: result.targetSelectedFrameIndex,
          width: result.width,
          height: result.height,
          sha256: result.sha256,
          wallClockMs: result.wallClockMs,
          bytes: Array.from(result.bytes),
        };
      })()
    `;
    const result = await mainWindow.webContents.executeJavaScript(expression, true);
    if (!result?.ok) {
      imageRecords.push({ frameIndex, ok: false, error: result?.error ?? { message: 'Preview returned no result' } });
      continue;
    }
    assert.equal(result.targetRenderTargetId, target.renderTargetId, 'production preview returned a different target identity');
    assert.equal(result.targetSelectedFrameIndex, frameIndex, 'production preview returned a different selected frame');
    const pngBytes = Buffer.from(result.bytes);
    if (pngBytes.byteLength === 0 || pngBytes.byteLength > 16 * 1024 * 1024) {
      imageRecords.push({ frameIndex, ok: false, error: { message: 'PNG output exceeded the local evidence budget' } });
      continue;
    }
    const fileName = `candidate-${String(candidateOrdinal).padStart(2, '0')}-${safeFileName(candidate.renderTargetId)}-frame-${String(frameIndex).padStart(6, '0')}.png`;
    const absolutePath = path.join(previewDirectory, fileName);
    await fs.writeFile(absolutePath, pngBytes, { flag: 'wx' });
    assert.equal(hash(await fs.readFile(absolutePath)), result.sha256, 'private PNG evidence failed its local SHA-256 check');
    imageRecords.push({
      frameIndex,
      ok: true,
      fileName: path.relative(runDirectory, absolutePath).replaceAll('\\', '/'),
      sha256: result.sha256,
      byteLength: pngBytes.byteLength,
      width: result.width,
      height: result.height,
      wallClockMs: result.wallClockMs,
    });
  }
  return imageRecords;
}

function createPreviewHtml(manifest, runDirectory, replace = false) {
  const candidates = manifest.s2?.candidates ?? [];
  const loopFrames = [];
  const sections = candidates.map((candidate, index) => {
    const goodFrames = candidate.frames.filter((frame) => frame.ok);
    const images = goodFrames.map((frame) =>
      `<figure><img src="${htmlEscape(frame.fileName)}" alt="sample frame ${frame.frameIndex}"/><figcaption>Frame ${frame.frameIndex}</figcaption></figure>`,
    ).join('\n');
    const playableFrames = goodFrames.map((frame) => frame.fileName);
    loopFrames.push(playableFrames);
    const loopPreview = playableFrames.length > 1
      ? `<div class="loop-wrap"><img id="loop-${index}" src="${htmlEscape(playableFrames[0])}" alt="sampled loop preview"/><p>Loop preview · sampled first/middle/last stills</p></div>`
      : '';
    return `<section><h2>${index + 1}. ${htmlEscape(candidate.relativePath)} — ${htmlEscape(candidate.userLabel)}</h2><p>${htmlEscape(candidate.renderTargetId)} · ${candidate.sourceFps ?? 'unknown'} fps · ${candidate.frameCount} frames · sampled points only</p>${loopPreview}<div class="frames">${images}</div></section>`;
  }).join('\n');
  const loopScript = `const sequences=${JSON.stringify(loopFrames)};for(let i=0;i<sequences.length;i++){const frames=sequences[i];const image=document.getElementById('loop-'+i);if(!image||frames.length<2)continue;let index=0;setInterval(()=>{index=(index+1)%frames.length;image.src=frames[index]},650)}`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CA-SCAN-01 private sampled previews</title><style>body{font:16px system-ui,sans-serif;background:#17191d;color:#f1f3f5;margin:24px}section{border:1px solid #464a52;border-radius:12px;padding:16px;margin:20px 0}.frames{display:flex;gap:12px;align-items:start;flex-wrap:wrap}.loop-wrap{width:min(60vw,640px);margin:12px 0}.loop-wrap img{height:440px}figure{margin:0;width:min(30vw,480px)}img{display:block;width:100%;height:360px;object-fit:contain;background:#282b31;border-radius:8px}figcaption{padding:6px}</style><h1>Private sampled loop previews</h1><p>Each preview cycles first/middle/last stills; it is not a complete playback render.</p>${sections}<script>${loopScript}</script></html>`;
  require('node:fs').writeFileSync(path.join(runDirectory, 'preview.html'), html, replace ? undefined : { flag: 'wx' });
}

function applyPriorEvidence(manifest, records) {
  if (!Array.isArray(records)) throw new Error('Prior evidence JSON must be an array.');
  const matched = [];
  for (const record of records) {
    if (record.classification !== 'PARTIAL_ACTION_ONLY' || !record.sha256 || !record.targetIdentity) continue;
    for (const file of manifest.files) {
      if (String(file.sha256 ?? '').toLowerCase() !== String(record.sha256).toLowerCase()) continue;
      const targets = (file.targets ?? []).filter((target) =>
        target.sourceLibraryItemName === record.targetIdentity ||
        target.userLabel === record.targetIdentity,
      );
      for (const target of targets) {
        target.classification = 'PARTIAL_ACTION_ONLY';
        target.classificationReason = record.reason || 'Matched same-source SHA-256 and target identity to prior private partial-action evidence.';
        target.priorEvidence = {
          issueReferences: record.issueReferences ?? [],
          verification: record.verification ?? 'same-source-sha-and-target-identity',
          reRenderedInIssue935: false,
        };
        target.s2Candidate = false;
        matched.push({ relativePath: file.relativePath, renderTargetId: target.renderTargetId, targetIdentity: record.targetIdentity });
      }
    }
  }
  manifest.priorEvidence = { matchedCount: matched.length, matched, appliedAt: new Date().toISOString() };
  return matched;
}

function structuralCandidateScore(target) {
  return (target.frameContextChanged ? 100 : 0) +
    ((target.motionEvidence?.motionTweenSpanCount ?? 0) * 20) +
    ((target.motionEvidence?.shapeTweenSpanCount ?? 0) * 8) +
    Math.min(40, target.sourceComposition?.visibleElementCountAtFirstSample ?? 0) +
    (target.kind === 'graphic-symbol' ? 5 : 0);
}

function annotateS2Ranking(manifest) {
  const ranked = [];
  for (const file of manifest.files) {
    for (const target of file.targets ?? []) {
      if (!target.s2Candidate) continue;
      ranked.push({ file, target, score: structuralCandidateScore(target) });
    }
  }
  ranked.sort((left, right) => right.score - left.score ||
    left.file.relativePath.localeCompare(right.file.relativePath, 'en-US') ||
    left.target.renderTargetId.localeCompare(right.target.renderTargetId, 'en-US'));
  const rankByTargetId = new Map(ranked.map((entry, index) => [entry.target.renderTargetId, { rank: index + 1, score: entry.score }]));
  for (const candidate of manifest.s2?.candidates ?? []) {
    const rank = rankByTargetId.get(candidate.renderTargetId);
    if (rank) {
      candidate.structuralRank = rank.rank;
      candidate.structuralScore = rank.score;
    }
  }
  manifest.s2 = {
    ...manifest.s2,
    selectionMethod: 'Highest structural scores: 100 for sampled frame-context change + 20 per visible motion tween span + 8 per visible shape tween span + up to 40 visible display nodes + 5 for a Graphic target. Ties use normalized relative path then target ID for deterministic replay.',
    eligibleDynamicTargetCount: ranked.length,
    selectedCandidateCount: manifest.s2?.candidates?.length ?? 0,
  };
  return ranked;
}

function writePartial(manifest, runDirectory) {
  refreshAndWriteManifest(manifest, runDirectory, true);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runFullScan(args) {
  if (!args.root || !args.out) throw new Error('Usage: --root <directory> --out <private evidence directory> [--expected-list <private JSON>] [--prior-evidence <private JSON>]');
  const rootPath = path.resolve(args.root);
  const outputBasePath = path.resolve(args.out);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error('The source root must be a directory.');
  const rootRealPath = await fs.realpath(rootPath);
  const repoRoot = await fs.realpath(ROOT);
  if (isWithin(repoRoot, outputBasePath)) throw new Error('Private inventory and artwork outputs must stay outside the repository.');
  if (isWithin(rootRealPath, outputBasePath)) throw new Error('Output directory must not be inside the source tree.');

  const runId = `run-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const runDirectory = path.join(outputBasePath, runId);
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.mkdir(path.join(runDirectory, 'electron-user-data'), { recursive: true });
  const enumeration = await core.enumerateFlaFiles(rootPath);
  let expectedNames = null;
  if (args.expectedList) {
    const parsedExpected = JSON.parse(await fs.readFile(path.resolve(args.expectedList), 'utf8'));
    expectedNames = Array.isArray(parsedExpected) ? parsedExpected : parsedExpected.filenames;
    if (!Array.isArray(expectedNames)) throw new Error('Expected-list JSON must be an array or contain a filenames array.');
  }
  let priorEvidence = [];
  if (args.priorEvidence) {
    const parsedPriorEvidence = JSON.parse(await fs.readFile(path.resolve(args.priorEvidence), 'utf8'));
    priorEvidence = Array.isArray(parsedPriorEvidence) ? parsedPriorEvidence : parsedPriorEvidence.records;
    if (!Array.isArray(priorEvidence)) throw new Error('Prior-evidence JSON must be an array or contain a records array.');
  }

  const manifest = {
    format: 'panda-stage-issue935-character-inventory',
    version: 1,
    status: 'S0_S1_IN_PROGRESS',
    startedAt: new Date().toISOString(),
    command: `pnpm issue935:scan01 -- --root "${rootPath}" --out "${outputBasePath}"${args.expectedList ? ` --expected-list "${path.resolve(args.expectedList)}"` : ''}${args.priorEvidence ? ` --prior-evidence "${path.resolve(args.priorEvidence)}"` : ''}`,
    source: { rootPath, rootRealPath, readOnly: true },
    outputDirectory: runDirectory,
    enumeration: {
      discoveredCount: enumeration.files.length,
      skipped: enumeration.skipped,
      normalizedPathCollisions: enumeration.normalizedPathCollisions,
      complete: enumeration.complete,
    },
    expectedScreenshotCheck: expectedNameCheck(expectedNames, enumeration.files),
    files: [],
    s2: { maxCandidates: MAX_VISUAL_CANDIDATES, candidates: [] },
    summary: null,
  };
  writePartial(manifest, runDirectory);
  if (enumeration.files.length === 0) throw new Error('No .fla files were discovered under the source directory.');

  const electron = require('electron');
  if (!electron || typeof electron === 'string') throw new Error('Run this scanner with the Electron command from package.json, not node.');
  const { app, BrowserWindow } = electron;
  app.on('window-all-closed', () => {});
  app.setPath('userData', path.join(runDirectory, 'electron-user-data'));
  process.env.VITE_DEV_SERVER_URL = '';
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  await app.whenReady();

  const waitForMainWindow = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
      );
      if (window) {
        try {
          const ready = await window.webContents.executeJavaScript(
            'Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotPreview)',
          );
          if (ready) return window;
        } catch { /* wait for preload */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Panda Stage renderer APIs did not become ready.');
  };
  const mainWindow = await waitForMainWindow();

  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const { preflightFlaBytes, FlaPreflightError } = require(path.join(ROOT, 'dist-electron/main/services/fla-import-preflight-service.js'));
  const displayBuilder = require(path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
  prepareDisplaySource = displayBuilder.prepareFlaStaticSnapshotDisplaySource;
  stableTargetId = displayBuilder.stableRenderTargetId;
  const renderCandidates = [];
  let stopRequested = false;
  const onSigint = () => { stopRequested = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let index = 0; index < enumeration.files.length; index += 1) {
      if (stopRequested) break;
      const listed = enumeration.files[index];
      const fileRecord = {
        absolutePath: listed.absolutePath,
        relativePath: listed.relativePath,
        sha256: null,
        byteLength: null,
        readStatus: 'pending',
        parserStatus: 'not-run',
        classification: 'UNKNOWN_OR_UNSUPPORTED',
        classificationReason: 'Scan did not reach this file.',
        targets: [],
        error: null,
      };
      manifest.files.push(fileRecord);
      let sessionId = null;
      try {
        const sourceBytes = await fs.readFile(listed.absolutePath);
        fileRecord.readStatus = 'success';
        fileRecord.byteLength = sourceBytes.byteLength;
        fileRecord.sha256 = hash(sourceBytes);

        let parseBytes = sourceBytes;
        let recovery = { applied: false, state: 'STRICT_VALID', normalizedSha256: null };
        try {
          preflightFlaBytes(sourceBytes, path.basename(listed.absolutePath), listed.absolutePath);
        } catch (error) {
          if (!(error instanceof FlaPreflightError)) throw error;
          const recoveryClassification = classifier.classifyForFlaRecovery(sourceBytes);
          recovery = {
            applied: false,
            state: recoveryClassification.state,
            reasonCodes: recoveryClassification.reasonCodes,
          };
          if (recoveryClassification.state === 'RECOVERY_CANDIDATE') {
            const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, recoveryClassification);
            if (!normalized.applied || normalized.originalBytesWritten !== false) {
              throw new Error('In-memory archive normalization did not complete safely.', { cause: error });
            }
            parseBytes = Buffer.from(normalized.bytes);
            preflightFlaBytes(parseBytes, path.basename(listed.absolutePath), listed.absolutePath);
            recovery = {
              applied: true,
              state: recoveryClassification.state,
              reasonCodes: recoveryClassification.reasonCodes,
              mode: normalized.mode,
              field: normalized.field,
              deltaBytes: normalized.deltaBytes,
              originalBytesWritten: normalized.originalBytesWritten,
              normalizedSha256: hash(parseBytes),
            };
          }
        }
        fileRecord.recovery = recovery;

        const inspected = await withTimeout(
          inspectFileInProduction(mainWindow, listed.absolutePath),
          FILE_TIMEOUT_MS,
          `Production inspection for ${listed.relativePath}`,
        );
        if (!inspected?.ok) {
          fileRecord.parserStatus = 'failed';
          fileRecord.parserFailure = inspected?.error ?? { message: 'Production inspection returned no result.' };
          fileRecord.inspectionTrace = inspected?.trace ?? null;
          fileRecord.classificationReason = inspected?.error?.message ?? 'Production parser did not complete.';
        } else {
          sessionId = inspected.sessionId;
          fileRecord.parserStatus = 'success';
          fileRecord.inspectionTrace = inspected.trace;
          fileRecord.productionSource = {
            sha256: inspected.source.sha256,
            originalSha256: inspected.trace?.originalSourceSha256 ?? inspected.source.sha256,
            mediaCount: inspected.mediaCount,
            timelineCount: inspected.timelineCount,
            document: inspected.document,
            structure: inspected.structure,
            summary: inspected.summary,
            catalogOmittedCandidateCount: inspected.omittedCandidateCount,
          };
          assert.equal(fileRecord.productionSource.originalSha256, fileRecord.sha256, 'production inspection source hash differs from the enumerated original bytes');
          const targetResult = await prepareTimelineEvidence(parseBytes, inspected, inspected.catalog);
          if (!targetResult.ok) {
            fileRecord.parserStatus = 'partial';
            fileRecord.classificationReason = `Production timeline adapter failed: ${targetResult.reason}`;
          } else {
            fileRecord.targets = targetResult.targets;
            for (const target of targetResult.targets) {
              if (!target.s2Candidate) continue;
              renderCandidates.push({
                relativePath: fileRecord.relativePath,
                absolutePath: fileRecord.absolutePath,
                sha256: fileRecord.sha256,
                sessionId,
                target: target._target,
                ...target,
              });
            }
            const classifiedFile = core.classifyFileEvidence(fileRecord.targets, fileRecord.parserStatus);
            fileRecord.classification = classifiedFile.classification;
            fileRecord.classificationReason = classifiedFile.reason;
          }
        }

        const afterBytes = await fs.readFile(listed.absolutePath);
        if (hash(afterBytes) !== fileRecord.sha256) throw new Error('Source SHA-256 changed while scanning; read-only invariant failed.');
      } catch (error) {
        fileRecord.parserStatus = fileRecord.parserStatus === 'not-run' ? 'failed' : fileRecord.parserStatus;
        fileRecord.error = { message: error instanceof Error ? error.message : String(error) };
        fileRecord.classification = 'UNKNOWN_OR_UNSUPPORTED';
        fileRecord.classificationReason = fileRecord.error.message;
        if (fileRecord.readStatus === 'success' && fileRecord.sha256) {
          try {
            const afterFailureBytes = await fs.readFile(listed.absolutePath);
            if (hash(afterFailureBytes) !== fileRecord.sha256) {
              fileRecord.sourceHashInvariant = false;
              fileRecord.classificationReason = 'Source SHA-256 changed during scan; read-only invariant failed.';
            }
          } catch (sourceCheckError) {
            fileRecord.sourceHashInvariant = false;
            fileRecord.classificationReason = `Source integrity recheck failed: ${sourceCheckError instanceof Error ? sourceCheckError.message : String(sourceCheckError)}`;
          }
        }
        if (fileRecord.error.message.includes('exceeded 120000 ms')) stopRequested = true;
      } finally {
        if (sessionId) {
          try {
            await mainWindow.webContents.executeJavaScript(
              `window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(sessionId)} }).catch(() => null)`,
              true,
            );
            await mainWindow.webContents.executeJavaScript(
              `window.pandaStage.fla.cancel(${JSON.stringify(sessionId)}).catch(() => null)`,
              true,
            );
          } catch { /* session release is best effort after a failed source */ }
        }
      }
      fileRecord.targetCount = fileRecord.targets.length;
      writePartial(manifest, runDirectory);
      process.stdout.write(`[${index + 1}/${enumeration.files.length}] ${fileRecord.relativePath}: ${fileRecord.parserStatus}, ${fileRecord.targetCount} targets\n`);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (args.priorEvidence) {
    const priorMatched = applyPriorEvidence(manifest, priorEvidence);
    manifest.priorEvidenceConfiguration = { supplied: true, matchedTargetCount: priorMatched.length };
  } else {
    manifest.priorEvidenceConfiguration = { supplied: false, matchedTargetCount: 0 };
  }
  const sortedCandidates = renderCandidates
    .filter((candidate) => {
      const file = manifest.files.find((item) => item.sha256 === candidate.sha256 && item.relativePath === candidate.relativePath);
      return file?.targets.find((item) => item.renderTargetId === candidate.renderTargetId)?.s2Candidate === true;
    })
    .sort((left, right) => structuralCandidateScore(right) - structuralCandidateScore(left) ||
      left.relativePath.localeCompare(right.relativePath, 'en-US') ||
      left.renderTargetId.localeCompare(right.renderTargetId, 'en-US'));
  const selected = sortedCandidates.slice(0, MAX_VISUAL_CANDIDATES);
  manifest.s2.selectionMethod = 'Highest structural scores: 100 for sampled frame-context change + 20 per visible motion tween span + 8 per visible shape tween span + up to 40 visible display nodes + 5 for a Graphic target. Ties use normalized relative path then target ID for deterministic replay.';
  manifest.s2.eligibleDynamicTargetCount = sortedCandidates.length;
  manifest.s2.selectedCandidateCount = selected.length;
  for (let index = 0; index < selected.length; index += 1) {
    if (stopRequested) break;
    const candidate = selected[index];
    const file = manifest.files.find((item) => item.sha256 === candidate.sha256 && item.relativePath === candidate.relativePath);
    const target = file?.targets.find((item) => item.renderTargetId === candidate.renderTargetId);
    if (!file || !target) continue;
    const sampleFrameIndices = candidate.motionEvidence.sampleFrameIndices;
    const frameResults = await renderPrivateFrames(mainWindow, {
      ...candidate,
      target: candidate.target,
      sampleFrameIndices,
    }, runDirectory, index + 1).catch((error) => [
      { ok: false, frameIndex: null, error: { message: error instanceof Error ? error.message : String(error) } },
    ]);
    const frameHashes = frameResults.filter((frame) => frame.ok).map((frame) => frame.sha256);
    target.s2 = {
      status: frameResults.length > 0 && frameResults.every((frame) => frame.ok) ? 'RENDERED' : 'PARTIAL_OR_FAILED',
      sampleFrameIndices,
      frames: frameResults,
      renderedFrameHashes: frameHashes,
      renderedFramesDiffer: new Set(frameHashes).size > 1,
      previewHtml: 'preview.html',
      visualCoverage: 'NOT_ASSESSED',
      ownerReviewNeeded: true,
    };
    target.visualReview = null;
    const classified = core.classifyTargetEvidence({
      structuralDynamic: target.structuralDynamic,
      frameContextChanged: target.frameContextChanged,
      renderedFrameHashes: frameHashes,
      previewSupported: target.previewSupported === false ? false : undefined,
      unsupportedReason: target.unsupportedReason,
    });
    target.classification = classified.classification;
    target.classificationReason = classified.reason;
    manifest.s2.candidates.push({
      relativePath: file.relativePath,
      sha256: file.sha256,
      renderTargetId: target.renderTargetId,
      userLabel: target.userLabel,
      kind: target.kind,
      sourceFps: target.sourceFps,
      frameCount: target.frameCount,
      sampleFrameIndices,
      previewStatus: target.s2.status,
      structuralScore: structuralCandidateScore(candidate),
      structuralRank: sortedCandidates.findIndex((entry) => entry.renderTargetId === candidate.renderTargetId) + 1,
      frames: frameResults,
      previewHtml: 'preview.html',
    });
    const fileClass = core.classifyFileEvidence(file.targets, file.parserStatus);
    file.classification = fileClass.classification;
    file.classificationReason = fileClass.reason;
    writePartial(manifest, runDirectory);
    process.stdout.write(`S2 ${index + 1}/${selected.length}: ${file.relativePath} · ${target.userLabel} · ${target.s2.status}\n`);
  }
  manifest.status = stopRequested || manifest.files.length < enumeration.files.length
    ? 'INTERRUPTED'
    : enumeration.complete ? 'COMPLETE' : 'INCOMPLETE_COVERAGE';
  manifest.completedAt = new Date().toISOString();
  if (manifest.s2.candidates.length) createPreviewHtml(manifest, runDirectory);
  if (manifest.expectedScreenshotCheck) {
    manifest.expectedScreenshotCheck.actualDiscoveredCount = enumeration.files.length;
  }
  for (const file of manifest.files) {
    for (const target of file.targets ?? []) delete target._target;
  }
  refreshAndWriteManifest(manifest, runDirectory);
  process.stdout.write(`\nPrivate evidence: ${runDirectory}\n`);
  process.stdout.write(`Discovered ${manifest.summary.discoveredCount}, parsed ${manifest.summary.parsedCount}, unsupported ${manifest.summary.unsupportedCount}.\n`);
  process.stdout.write(`Product decision: ${manifest.summary.recommendation.status}.\n`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  app.exit(manifest.status === 'COMPLETE' ? 0 : 2);
}

async function applyReview(args) {
  if (!args.manifestPath || !args.reviewFile) throw new Error('--apply-review requires --manifest and --review-file.');
  const manifestPath = path.resolve(args.manifestPath);
  const reviewPath = path.resolve(args.reviewFile);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const reviewJson = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  const records = Array.isArray(reviewJson) ? reviewJson : reviewJson.reviews;
  if (!Array.isArray(records)) throw new Error('Review JSON must be an array or contain a reviews array.');
  core.applyVisualReviews(manifest, records);
  annotateS2Ranking(manifest);
  const runDirectory = path.dirname(manifestPath);
  createPreviewHtml(manifest, runDirectory, true);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(runDirectory, 'inventory.md'), renderMarkdown(manifest));
  process.stdout.write(`Applied ${manifest.review.matchedTargetCount} private visual reviews.\n`);
  process.stdout.write(`Product decision: ${manifest.summary.recommendation.status}.\n`);
}

async function rerenderS2(args) {
  if (!args.manifestPath) throw new Error('--render-s2 requires --manifest.');
  const manifestPath = path.resolve(args.manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const runDirectory = path.dirname(manifestPath);
  const selected = manifest.s2?.candidates ?? [];
  if (selected.length > MAX_VISUAL_CANDIDATES) throw new Error('S2 candidate count exceeds the hard limit.');
  if (selected.length === 0) throw new Error('Inventory contains no selected S2 candidates.');

  const electron = require('electron');
  if (!electron || typeof electron === 'string') throw new Error('Run S2 rerender with Electron, not node.');
  const { app, BrowserWindow } = electron;
  app.on('window-all-closed', () => {});
  const rerenderUserData = path.join(runDirectory, `electron-user-data-s2-${crypto.randomBytes(3).toString('hex')}`);
  await fs.mkdir(rerenderUserData, { recursive: true });
  app.setPath('userData', rerenderUserData);
  process.env.VITE_DEV_SERVER_URL = '';
  require(path.join(ROOT, 'dist-electron/main/index.js'));
  await app.whenReady();
  const deadline = Date.now() + 30_000;
  let mainWindow = null;
  while (Date.now() < deadline) {
    mainWindow = BrowserWindow.getAllWindows().find((candidate) =>
      !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    ) ?? null;
    if (mainWindow) {
      try {
        if (await mainWindow.webContents.executeJavaScript('Boolean(window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotPreview)')) break;
      } catch { /* wait for preload */ }
      mainWindow = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!mainWindow) throw new Error('Panda Stage renderer APIs did not become ready for the bounded S2 rerender.');

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const file = manifest.files.find((item) => item.relativePath === candidate.relativePath && item.sha256 === candidate.sha256);
    const targetRecord = file?.targets.find((target) => target.renderTargetId === candidate.renderTargetId);
    if (!file || !targetRecord) throw new Error(`S2 target/source mapping no longer matches inventory: ${candidate.renderTargetId}`);
    const currentBytes = await fs.readFile(file.absolutePath);
    if (hash(currentBytes) !== file.sha256) throw new Error(`S2 source SHA-256 changed after S0/S1: ${file.relativePath}`);
    const target = {
      renderTargetId: targetRecord.renderTargetId,
      kind: targetRecord.kind,
      userLabel: targetRecord.userLabel,
      ...(targetRecord.sourceLibraryItemName ? { sourceLibraryItemName: targetRecord.sourceLibraryItemName } : {}),
      ...(targetRecord.sourceTimelineIndex !== null ? { sourceTimelineIndex: targetRecord.sourceTimelineIndex } : {}),
      frameCount: targetRecord.frameCount,
      selectedFrameIndex: 0,
      compatibility: ['degraded'],
    };
    let sessionId = null;
    try {
      const inspected = await withTimeout(
        inspectFileInProduction(mainWindow, file.absolutePath),
        FILE_TIMEOUT_MS,
        `S2 source reinspection for ${file.relativePath}`,
      );
      if (!inspected?.ok) throw new Error(inspected?.error?.message ?? 'Production inspection failed before S2 render.');
      sessionId = inspected.sessionId;
      if ((inspected.trace?.originalSourceSha256 ?? inspected.source.sha256) !== file.sha256) {
        throw new Error('S2 production source hash differs from the S0/S1 source hash.');
      }
      const sampleFrameIndices = candidate.sampleFrameIndices;
      const frames = await renderPrivateFrames(mainWindow, {
        sessionId,
        target,
        sampleFrameIndices,
        renderTargetId: target.renderTargetId,
      }, runDirectory, index + 11);
      const frameHashes = frames.filter((frame) => frame.ok).map((frame) => frame.sha256);
      targetRecord.s2 = {
        status: frames.length === sampleFrameIndices.length && frames.every((frame) => frame.ok) ? 'RENDERED' : 'PARTIAL_OR_FAILED',
        sampleFrameIndices,
        frames,
        renderedFrameHashes: frameHashes,
        renderedFramesDiffer: frames.length === sampleFrameIndices.length && new Set(frameHashes).size > 1,
        previewHtml: 'preview.html',
        visualCoverage: 'NOT_ASSESSED',
        ownerReviewNeeded: true,
      };
      targetRecord.visualReview = null;
      const classified = core.classifyTargetEvidence({
        structuralDynamic: targetRecord.structuralDynamic,
        frameContextChanged: targetRecord.frameContextChanged,
        renderedFrameHashes: targetRecord.s2.renderedFrameHashes,
        previewSupported: targetRecord.previewSupported === false ? false : undefined,
        unsupportedReason: targetRecord.unsupportedReason,
      });
      targetRecord.classification = classified.classification;
      targetRecord.classificationReason = classified.reason;
      candidate.frames = frames;
      candidate.previewStatus = targetRecord.s2.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      targetRecord.s2 = {
        status: 'FAILED',
        sampleFrameIndices: candidate.sampleFrameIndices,
        frames: [{ ok: false, frameIndex: null, error: { message } }],
        renderedFrameHashes: [],
        renderedFramesDiffer: false,
        previewHtml: 'preview.html',
        visualCoverage: 'NOT_ASSESSED',
        ownerReviewNeeded: true,
      };
      candidate.frames = targetRecord.s2.frames;
      candidate.previewStatus = 'FAILED';
    } finally {
      if (sessionId) {
        try {
          await mainWindow.webContents.executeJavaScript(
            `window.pandaStage.fla.staticSnapshotCancel({ format: 'fla-static-snapshot-cancel', version: 1, sessionId: ${JSON.stringify(sessionId)} }).catch(() => null)`,
            true,
          );
          await mainWindow.webContents.executeJavaScript(
            `window.pandaStage.fla.cancel(${JSON.stringify(sessionId)}).catch(() => null)`, true,
          );
        } catch { /* preserve the rendered evidence even if release reports late */ }
      }
    }
    file.classification = core.classifyFileEvidence(file.targets, file.parserStatus).classification;
    file.classificationReason = core.classifyFileEvidence(file.targets, file.parserStatus).reason;
    writePartial(manifest, runDirectory);
    process.stdout.write(`S2 rerender ${index + 1}/${selected.length}: ${file.relativePath} · ${candidate.previewStatus}\n`);
  }
  createPreviewHtml(manifest, runDirectory, true);
  refreshAndWriteManifest(manifest, runDirectory);
  process.stdout.write(`Updated bounded S2 evidence: ${runDirectory}\n`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  app.exit(0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.applyReview) await applyReview(args);
  else if (args.renderS2) await rerenderS2(args);
  else await runFullScan(args);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
