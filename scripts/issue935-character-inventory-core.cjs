'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const FILE_CLASSES = Object.freeze([
  'FULL_BODY_ACTION_CANDIDATE',
  'PARTIAL_ACTION_ONLY',
  'STATIC_OR_MULTIVIEW',
  'UNKNOWN_OR_UNSUPPORTED',
]);

function normalizePathKey(value) {
  return String(value).replaceAll('\\', '/').normalize('NFC').toLocaleLowerCase('en-US');
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function comparePathEntries(left, right) {
  const a = normalizePathKey(left.relativePath);
  const b = normalizePathKey(right.relativePath);
  return a.localeCompare(b, 'en-US') || left.relativePath.localeCompare(right.relativePath, 'en-US');
}

async function enumerateFlaFiles(rootPath) {
  const root = path.resolve(rootPath);
  const rootRealPath = await fs.realpath(root);
  const files = [];
  const skipped = [];

  async function walk(directoryPath) {
    let entries;
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      skipped.push({
        relativePath: path.relative(root, directoryPath).replaceAll('\\', '/') || '.',
        reason: `directory-read-failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    entries.sort((left, right) =>
      normalizePathKey(left.name).localeCompare(normalizePathKey(right.name), 'en-US') ||
      left.name.localeCompare(right.name, 'en-US'),
    );

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
      let stat;
      try {
        stat = await fs.lstat(absolutePath);
      } catch (error) {
        skipped.push({
          relativePath,
          reason: `stat-failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        if (/\.fla$/iu.test(entry.name) || stat.isDirectory()) {
          skipped.push({ relativePath, reason: 'reparse-point-not-followed' });
        }
        continue;
      }

      if (stat.isDirectory()) {
        let realPath;
        try {
          realPath = await fs.realpath(absolutePath);
        } catch (error) {
          skipped.push({
            relativePath,
            reason: `directory-realpath-failed: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        if (!isWithin(rootRealPath, realPath)) {
          skipped.push({ relativePath, reason: 'directory-escapes-source-root' });
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (stat.isFile() && /\.fla$/iu.test(entry.name)) {
        files.push({ absolutePath, relativePath });
      }
    }
  }

  await walk(root);
  files.sort(comparePathEntries);
  skipped.sort(comparePathEntries);

  const normalizedPathGroups = new Map();
  for (const item of files) {
    const key = normalizePathKey(item.relativePath);
    const group = normalizedPathGroups.get(key) ?? [];
    group.push(item.relativePath);
    normalizedPathGroups.set(key, group);
  }
  const normalizedPathCollisions = [...normalizedPathGroups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([normalizedRelativePath, relativePaths]) => ({ normalizedRelativePath, relativePaths }));

  return {
    root,
    rootRealPath,
    files,
    skipped,
    normalizedPathCollisions,
    complete: skipped.length === 0 && normalizedPathCollisions.length === 0,
  };
}

function sampleFrameIndices(frameCount) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) return [];
  return [...new Set([0, Math.floor((frameCount - 1) / 2), frameCount - 1])];
}

function classifyTargetEvidence(evidence) {
  const review = evidence.visualReview ?? null;
  const renderedChange = evidence.renderedFrameHashes
    ? evidence.renderedFrameHashes.length >= 3 && new Set(evidence.renderedFrameHashes).size > 1
    : Boolean(evidence.frameContextChanged);
  const dynamicEvidence = Boolean(evidence.structuralDynamic || renderedChange);

  if (review === 'FULL_BODY' && dynamicEvidence && renderedChange && evidence.sourceTraceable !== false) {
    return {
      classification: 'FULL_BODY_ACTION_CANDIDATE',
      reason: 'S2 frame renders show visible change and reviewer marked head, torso, and lower body present.',
    };
  }
  if (review === 'PARTIAL_ONLY' && dynamicEvidence && renderedChange) {
    return {
      classification: 'PARTIAL_ACTION_ONLY',
      reason: 'S2 frame renders show visible change, while reviewed content covers only part of the body.',
    };
  }
  if (review === 'STATIC_MULTIVIEW' || (!dynamicEvidence && evidence.previewSupported !== false)) {
    return {
      classification: 'STATIC_OR_MULTIVIEW',
      reason: review === 'STATIC_MULTIVIEW'
        ? 'S2 review found no action and/or separate static views.'
        : 'No sampled visible-state change or authored motion span was found.',
    };
  }
  const reason = evidence.previewSupported === false
    ? `Preview unsupported: ${evidence.unsupportedReason || 'reason not supplied'}`
    : review === 'UNKNOWN'
      ? 'S2 review could not establish body coverage or visible action.'
      : dynamicEvidence
        ? 'Potentially dynamic structure is present, but whole-body coverage is not visually established.'
        : 'Source structure or visible behavior could not be established.';
  return { classification: 'UNKNOWN_OR_UNSUPPORTED', reason };
}

function classifyFileEvidence(targets, parserStatus) {
  if (parserStatus !== 'success') {
    return {
      classification: 'UNKNOWN_OR_UNSUPPORTED',
      reason: parserStatus || 'production parser did not complete',
    };
  }
  if (targets.length === 0) {
    return { classification: 'UNKNOWN_OR_UNSUPPORTED', reason: 'Production inspection found no inspectable Scene or Graphic target.' };
  }
  const classes = new Set(targets.map((target) => target.classification));
  if (classes.has('FULL_BODY_ACTION_CANDIDATE')) {
    return { classification: 'FULL_BODY_ACTION_CANDIDATE', reason: 'At least one target met the reviewed full-body action criteria.' };
  }
  if (classes.has('UNKNOWN_OR_UNSUPPORTED')) {
    return { classification: 'UNKNOWN_OR_UNSUPPORTED', reason: 'At least one target still needs visual review or is unsupported.' };
  }
  if (classes.has('PARTIAL_ACTION_ONLY')) {
    return { classification: 'PARTIAL_ACTION_ONLY', reason: 'At least one reviewed target contains partial-body action only, and no target remains unreviewed.' };
  }
  return { classification: 'STATIC_OR_MULTIVIEW', reason: 'No target contains a verified dynamic full-body or partial action.' };
}

function groupFilesBySha256(files) {
  const groups = new Map();
  for (const file of files) {
    if (!file.sha256) continue;
    const key = file.sha256.toLowerCase();
    const paths = groups.get(key) ?? [];
    paths.push(file.relativePath);
    groups.set(key, paths);
  }
  return [...groups.entries()]
    .filter(([, relativePaths]) => relativePaths.length > 1)
    .map(([sha256, relativePaths]) => ({ sha256, relativePaths: [...relativePaths].sort((a, b) => a.localeCompare(b, 'en-US')) }))
    .sort((a, b) => a.sha256.localeCompare(b.sha256, 'en-US'));
}

function tallyFileClasses(files) {
  const totals = Object.fromEntries(FILE_CLASSES.map((classification) => [classification, 0]));
  for (const file of files) {
    if (Object.hasOwn(totals, file.classification)) totals[file.classification] += 1;
  }
  return totals;
}

function applyVisualReviews(manifest, reviewRecords) {
  const reviewIndex = new Map();
  for (const review of reviewRecords) {
    if (!review || typeof review.sourceSha256 !== 'string' || typeof review.renderTargetId !== 'string') {
      throw new Error('Each visual review needs sourceSha256 and renderTargetId.');
    }
    if (!['FULL_BODY', 'PARTIAL_ONLY', 'STATIC_MULTIVIEW', 'UNKNOWN'].includes(review.coverage)) {
      throw new Error(`Unsupported visual review coverage: ${String(review.coverage)}`);
    }
    reviewIndex.set(`${review.sourceSha256.toLowerCase()}\u0000${review.renderTargetId}`, review);
  }

  let matchedReviewCount = 0;
  for (const file of manifest.files) {
    for (const target of file.targets ?? []) {
      const key = `${String(file.sha256 ?? '').toLowerCase()}\u0000${target.renderTargetId}`;
      const review = reviewIndex.get(key);
      if (!review) continue;
      if (!target.s2?.renderedFrameHashes?.length) {
        throw new Error(`Target ${target.renderTargetId} has no private S2 frame renders to review.`);
      }
      matchedReviewCount += 1;
      target.visualReview = {
        coverage: review.coverage,
        notes: typeof review.notes === 'string' ? review.notes : '',
        reviewedAt: review.reviewedAt ?? null,
      };
      const classified = classifyTargetEvidence({
        structuralDynamic: target.structuralDynamic,
        frameContextChanged: target.frameContextChanged,
        renderedFrameHashes: target.s2.renderedFrameHashes,
        visualReview: review.coverage,
        sourceTraceable: true,
        previewSupported: target.previewSupported,
        unsupportedReason: target.unsupportedReason,
      });
      target.classification = classified.classification;
      target.classificationReason = classified.reason;
    }
    const classifiedFile = classifyFileEvidence(file.targets ?? [], file.parserStatus);
    file.classification = classifiedFile.classification;
    file.classificationReason = classifiedFile.reason;
  }

  if (matchedReviewCount !== reviewRecords.length) {
    throw new Error(`Only ${matchedReviewCount}/${reviewRecords.length} visual reviews matched this inventory.`);
  }
  manifest.review = {
    applied: true,
    matchedTargetCount: matchedReviewCount,
    reviewedAt: new Date().toISOString(),
  };
  refreshSummary(manifest);
  return manifest;
}

function refreshSummary(manifest) {
  const allTargets = manifest.files.flatMap((file) => file.targets ?? []);
  manifest.summary = {
    discoveredCount: manifest.enumeration?.discoveredCount ?? manifest.files.length,
    parsedCount: manifest.files.filter((file) => file.parserStatus === 'success').length,
    unsupportedCount: manifest.files.filter((file) => file.parserStatus !== 'success').length,
    unknownClassificationCount: manifest.files.filter((file) => file.classification === 'UNKNOWN_OR_UNSUPPORTED').length,
    classificationCounts: tallyFileClasses(manifest.files),
    targetClassificationCounts: tallyFileClasses(allTargets),
    duplicateContentGroups: groupFilesBySha256(manifest.files),
    recommendation: null,
  };
  const fullTargets = manifest.files.flatMap((file) => (file.targets ?? [])
    .filter((target) => target.classification === 'FULL_BODY_ACTION_CANDIDATE')
    .map((target) => ({ file, target })));
  manifest.summary.recommendation = fullTargets.length > 0
    ? {
        status: 'RECOMMEND_P01',
        primary: fullTargets[0],
        backup: fullTargets[1] ?? null,
      }
    : { status: 'NO_SUITABLE_SOURCE', primary: null, backup: null };
  return manifest.summary;
}

module.exports = {
  FILE_CLASSES,
  classifyFileEvidence,
  classifyTargetEvidence,
  enumerateFlaFiles,
  applyVisualReviews,
  groupFilesBySha256,
  isWithin,
  normalizePathKey,
  sampleFrameIndices,
  refreshSummary,
  tallyFileClasses,
};
