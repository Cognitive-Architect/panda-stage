'use strict';

const PRIMARY_CLASSES = new Set([
  'STATIC_MULTI_POSE',
  'STATIC_SINGLE_ASSET',
  'TEMPORAL_ACTION_CANDIDATE',
  'PROP',
  'SCENE',
  'MIXED',
  'UNSUPPORTED_FEATURE_FAMILY',
  'UNKNOWN',
]);

const BLOCKER_FAMILIES = new Set([
  'BITMAP_FILL',
  'MASK',
  'FILTER',
  'BLEND_MODE',
  'TEXT',
  'NESTED_GRAPHIC_TIMING',
  'TWEEN_INTERPOLATION',
  'MOVIECLIP_RUNTIME',
  'CAMERA',
  'SCRIPT_RUNTIME',
  'LAYER_ORDER',
  'TRANSFORM',
  'UNKNOWN_SEMANTIC',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function makeCandidateId(sourceSha256, ownerKind, ownerName, frameIndex) {
  invariant(/^[a-f0-9]{64}$/iu.test(sourceSha256), 'source SHA-256 is malformed');
  invariant(ownerKind === 'scene' || ownerKind === 'graphic-symbol', 'candidate owner kind is unsupported');
  invariant(typeof ownerName === 'string' && ownerName.length > 0, 'candidate owner name is missing');
  invariant(Number.isSafeInteger(frameIndex) && frameIndex >= 0, 'authored frame index is invalid');
  const address = JSON.stringify([sourceSha256.toLowerCase(), ownerKind, ownerName, frameIndex]);
  const digest = require('node:crypto').createHash('sha256').update(address, 'utf8').digest('hex');
  return `B4-${digest.slice(0, 24).toUpperCase()}`;
}

/** Return the union of visible authored span starts without expanding held frames. */
function enumerateVisibleAuthoredStarts(frameSpanIndex) {
  invariant(frameSpanIndex && Array.isArray(frameSpanIndex.layers), 'timeline frame-span index is missing');
  const byIndex = new Map();
  for (let layerIndex = 0; layerIndex < frameSpanIndex.layers.length; layerIndex += 1) {
    const layer = frameSpanIndex.layers[layerIndex];
    if (!layer?.visible || !Array.isArray(layer.spans)) continue;
    for (const span of layer.spans) {
      if (!Number.isSafeInteger(span.index) || span.index < 0) continue;
      const record = byIndex.get(span.index) ?? { frameIndex: span.index, layerIndexes: [], spans: [] };
      record.layerIndexes.push(layerIndex);
      record.spans.push({
        layerIndex,
        duration: span.duration,
        endExclusive: span.endExclusive,
        tweenType: span.tweenType,
      });
      byIndex.set(span.index, record);
    }
  }
  return [...byIndex.values()]
    .map((record) => ({
      ...record,
      layerIndexes: [...new Set(record.layerIndexes)].sort((left, right) => left - right),
      spans: record.spans.sort((left, right) => left.layerIndex - right.layerIndex),
    }))
    .sort((left, right) => left.frameIndex - right.frameIndex);
}

function classifyBlockerFamily(featureOrReason) {
  const value = String(featureOrReason ?? '').toLocaleLowerCase('en-US');
  if (/bitmap.?fill|fill.?bitmap|embedded.?bitmap|bitmap.?paint/u.test(value)) return 'BITMAP_FILL';
  if (/mask|matte/u.test(value)) return 'MASK';
  if (/filter|blur|glow|shadow/u.test(value)) return 'FILTER';
  if (/blend|composite.?mode/u.test(value)) return 'BLEND_MODE';
  if (/text|font|glyph/u.test(value)) return 'TEXT';
  if (/nested.?graphic|graphic.?timing|playback.?mode|first.?frame|last.?frame|loop.?span|reverse.?playback/u.test(value)) return 'NESTED_GRAPHIC_TIMING';
  if (/tween|motion.?interpolat|shape.?interpolat/u.test(value)) return 'TWEEN_INTERPOLATION';
  if (/movie.?clip|movieclip/u.test(value)) return 'MOVIECLIP_RUNTIME';
  if (/camera/u.test(value)) return 'CAMERA';
  if (/action.?script|script.?runtime|domscript/u.test(value)) return 'SCRIPT_RUNTIME';
  if (/layer.?order|z.?order|depth.?order/u.test(value)) return 'LAYER_ORDER';
  if (/transform|matrix|rotation|skew/u.test(value)) return 'TRANSFORM';
  return 'UNKNOWN_SEMANTIC';
}

function classifyPrimaryCorpus(evidence) {
  const temporalStructure = evidence.tweenSpanCount > 0 || evidence.temporalTimelineCount > 0;
  const hasTemporalEvidence = evidence.tweenSpanCount > 0 || (evidence.actionIntentHint === true && evidence.temporalTimelineCount > 0);
  const hasStaticRender = evidence.independentStaticAssetCount > 0;
  const hasBlockedMaterial = evidence.unsupportedCandidateCount > 0 || evidence.candidateBlockerFamilies?.length > 0 || evidence.blockerFamilies?.length > 0;

  if (evidence.assetFamilyHint === 'PROP' && evidence.visibleAuthoredStateCount > 0 && !hasTemporalEvidence) return 'PROP';
  if (evidence.assetFamilyHint === 'SCENE' && evidence.visibleAuthoredStateCount > 0) return 'SCENE';
  if (hasTemporalEvidence && hasStaticRender) return 'MIXED';
  if (hasTemporalEvidence) return 'TEMPORAL_ACTION_CANDIDATE';
  if (temporalStructure && evidence.staticRenderableCandidateCount === 0 && hasBlockedMaterial) return 'UNSUPPORTED_FEATURE_FAMILY';
  if (evidence.sceneAuthoredStateCount >= 2) return 'STATIC_MULTI_POSE';
  if (evidence.staticRenderableCandidateCount === 1 && !hasBlockedMaterial) return 'STATIC_SINGLE_ASSET';
  if (hasBlockedMaterial && !hasStaticRender) return 'UNSUPPORTED_FEATURE_FAMILY';
  return 'UNKNOWN';
}

module.exports = {
  BLOCKER_FAMILIES,
  PRIMARY_CLASSES,
  classifyBlockerFamily,
  classifyPrimaryCorpus,
  enumerateVisibleAuthoredStarts,
  makeCandidateId,
};
