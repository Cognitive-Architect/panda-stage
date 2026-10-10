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
const batch = require('../../scripts/research/issue706-cross-corpus-batch.cjs') as {
  buildCompletionReceipt: (fixtures: Array<Record<string, unknown>>) => unknown;
  recommendedFollowUp: (fixtureId: string, wave: number) => string;
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

  it('builds a ranked completion receipt from per-fixture evidence and keeps source compatibility separate', () => {
    const fixture = {
      fixtureId: 'sample-wave1',
      wave: 1,
      primaryClass: 'MIXED',
      sourceAvailability: 'AVAILABLE',
      classificationEvidence: { tweenSpanCount: 1 },
      candidateDiscovery: {
        candidateCount: 2,
        discoveredCount: 1,
        candidates: [
          {
            candidateId: 'B4-A',
            renderAddressClass: 'DIRECT_GRAPHIC_FRAME',
            sourceStateClasses: ['DIRECT_GRAPHIC_ASSET'],
            blockerFamilies: ['NESTED_GRAPHIC_TIMING'],
            discoveryBlockerFamilies: ['NESTED_GRAPHIC_TIMING'],
          },
          {
            candidateId: 'B4-B',
            renderAddressClass: 'DIRECT_SCENE_FRAME',
            sourceStateClasses: ['AUTHORED_SCENE_STATE'],
            blockerFamilies: ['UNKNOWN_SEMANTIC'],
            discoveryBlockerFamilies: ['UNKNOWN_SEMANTIC'],
          },
        ],
      },
      artifactBatch: {
        renderedCandidateCount: 1,
        blankCount: 0,
        exactDuplicateGroupCount: 0,
        renderFailureCount: 0,
        unsupportedCount: 1,
      },
    } satisfies Record<string, unknown>;

    const receipt = batch.buildCompletionReceipt([fixture]) as {
      corpusFixturesAttempted: number;
      candidateBlockerCount: number;
      candidateAndRenderAddressClasses: {
        newSemanticCandidateClassRequired: boolean;
        addressCounts: Record<string, number>;
      };
      blockerImpactRanking: Array<{ family: string; candidateCount: number | null; fixtureCount: number; actionWaveFixtureCount?: number }>;
      waveSummary: Array<{ wave: number; candidateCount: number; discoveredCount: number; renderedCandidateCount: number }>;
    };

    expect(receipt.corpusFixturesAttempted).toBe(1);
    expect(receipt.candidateBlockerCount).toBe(2);
    expect(receipt.candidateAndRenderAddressClasses.newSemanticCandidateClassRequired).toBe(false);
    expect(receipt.candidateAndRenderAddressClasses.addressCounts).toEqual({ DIRECT_GRAPHIC_FRAME: 1, DIRECT_SCENE_FRAME: 1 });
    expect(receipt.blockerImpactRanking.slice(0, 2).map((entry) => entry.family)).toEqual([
      'NESTED_GRAPHIC_TIMING',
      'TEMPORAL_ACTION_FIDELITY',
    ]);
    expect(receipt.blockerImpactRanking[0]).toMatchObject({ candidateCount: 1, fixtureCount: 1 });
    expect(receipt.blockerImpactRanking[1]).toMatchObject({ candidateCount: null, fixtureCount: 1, actionWaveFixtureCount: 0 });
    expect(receipt.waveSummary[0]).toMatchObject({ wave: 1, candidateCount: 2, discoveredCount: 1, renderedCandidateCount: 1 });
    expect(batch.recommendedFollowUp('sample-wave2', 2)).toContain('#694');
  });
});
