import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const core = require('../../scripts/research/issue706-cross-corpus-core.cjs') as {
  makeCandidateId: (sourceSha256: string, ownerKind: string, ownerName: string, frameIndex: number) => string;
  enumerateVisibleAuthoredStarts: (index: { layers: Array<{ visible: boolean; spans: Array<{ index: number; duration: number; endExclusive: number; tweenType: string }> }> }) => Array<{
    frameIndex: number;
    layerIndexes: number[];
    spans: Array<{ layerIndex: number; duration: number; endExclusive: number; tweenType: string }>;
  }>;
  classifyBlockerFamily: (featureOrReason: string) => string;
  classifyPrimaryCorpus: (evidence: Record<string, unknown>) => string;
};

const sourceSha256 = 'a'.repeat(64);

describe('Issue #706 cross-corpus discovery core', () => {
  it('derives stable candidate IDs from source identity and authored address', () => {
    const first = core.makeCandidateId(sourceSha256, 'scene', 'scene:0:Timeline', 4);
    expect(first).toMatch(/^B4-[A-F0-9]{24}$/u);
    expect(core.makeCandidateId(sourceSha256, 'scene', 'scene:0:Timeline', 4)).toBe(first);
    expect(core.makeCandidateId(sourceSha256, 'scene', 'scene:0:Timeline', 5)).not.toBe(first);
    expect(core.makeCandidateId('b'.repeat(64), 'scene', 'scene:0:Timeline', 4)).not.toBe(first);
    expect(core.makeCandidateId(sourceSha256, 'graphic-symbol', 'LIBRARY/part.xml', 4)).not.toBe(first);
  });

  it('unions visible authored span starts and does not expand held frames', () => {
    const starts = core.enumerateVisibleAuthoredStarts({
      layers: [
        {
          visible: true,
          spans: [
            { index: 0, duration: 4, endExclusive: 4, tweenType: 'none' },
            { index: 4, duration: 1, endExclusive: 5, tweenType: 'none' },
          ],
        },
        {
          visible: true,
          spans: [
            { index: 0, duration: 2, endExclusive: 2, tweenType: 'none' },
            { index: 2, duration: 3, endExclusive: 5, tweenType: 'none' },
          ],
        },
        { visible: false, spans: [{ index: 1, duration: 4, endExclusive: 5, tweenType: 'motion' }] },
      ],
    });

    expect(starts.map((start) => start.frameIndex)).toEqual([0, 2, 4]);
    expect(starts[0]?.layerIndexes).toEqual([0, 1]);
    expect(starts[1]?.spans[0]).toMatchObject({ layerIndex: 1, duration: 3, endExclusive: 5 });
  });

  it('keeps known unsupported capability families distinct', () => {
    expect(core.classifyBlockerFamily('unsupported bitmap fill style')).toBe('BITMAP_FILL');
    expect(core.classifyBlockerFamily('nested Graphic playback firstFrame/lastFrame')).toBe('NESTED_GRAPHIC_TIMING');
    expect(core.classifyBlockerFamily('MovieClip runtime required')).toBe('MOVIECLIP_RUNTIME');
    expect(core.classifyBlockerFamily('unrecognized source operation')).toBe('UNKNOWN_SEMANTIC');
  });

  it('classifies temporal action, mixed sources, props, and unknown structure without character assumptions', () => {
    expect(core.classifyPrimaryCorpus({
      actionIntentHint: false,
      visibleAuthoredStateCount: 3,
      sceneAuthoredStateCount: 3,
      tweenSpanCount: 0,
      temporalTimelineCount: 0,
      staticRenderableCandidateCount: 3,
      independentStaticAssetCount: 0,
      unsupportedCandidateCount: 0,
      blockerFamilies: [],
    })).toBe('STATIC_MULTI_POSE');
    expect(core.classifyPrimaryCorpus({
      actionIntentHint: true,
      visibleAuthoredStateCount: 3,
      sceneAuthoredStateCount: 3,
      tweenSpanCount: 0,
      temporalTimelineCount: 1,
      staticRenderableCandidateCount: 0,
      independentStaticAssetCount: 0,
      unsupportedCandidateCount: 0,
      blockerFamilies: [],
    })).toBe('TEMPORAL_ACTION_CANDIDATE');
    expect(core.classifyPrimaryCorpus({
      actionIntentHint: true,
      visibleAuthoredStateCount: 3,
      sceneAuthoredStateCount: 3,
      tweenSpanCount: 0,
      temporalTimelineCount: 1,
      staticRenderableCandidateCount: 2,
      independentStaticAssetCount: 2,
      unsupportedCandidateCount: 0,
      blockerFamilies: [],
    })).toBe('MIXED');
    expect(core.classifyPrimaryCorpus({
      assetFamilyHint: 'PROP',
      actionIntentHint: false,
      visibleAuthoredStateCount: 1,
      sceneAuthoredStateCount: 1,
      tweenSpanCount: 0,
      temporalTimelineCount: 0,
      staticRenderableCandidateCount: 1,
      independentStaticAssetCount: 0,
      unsupportedCandidateCount: 0,
      blockerFamilies: [],
    })).toBe('PROP');
    expect(core.classifyPrimaryCorpus({
      actionIntentHint: false,
      visibleAuthoredStateCount: 4,
      sceneAuthoredStateCount: 0,
      tweenSpanCount: 0,
      temporalTimelineCount: 0,
      staticRenderableCandidateCount: 4,
      independentStaticAssetCount: 4,
      unsupportedCandidateCount: 0,
      blockerFamilies: [],
    })).toBe('UNKNOWN');
  });
});
