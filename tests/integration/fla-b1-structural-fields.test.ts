/**
 * V1.5-B1 IR contract integration tests.
 *
 * - AnimationImportIRSchema accepts a Panda-owned `structure` summary
 * - AnimationImportIRSchema remains backwards-compatible: IRs WITHOUT a
 *   `structure` field still parse (older V1 success-path IRs, e.g. ones
 *   returned by way-back parsers during a rolling deploy)
 * - The shared schema matches the B0-proven field allowlist exactly
 * - B1-deferred fields (keyframeCount / animatedTimelineCandidateCount)
 *   are NOT part of the B1 production contract
 */

import { describe, expect, it } from 'vitest';
import {
  AnimationImportIRSchema,
  FlaStructuralSummaryIRSchema,
} from '../../src/shared/fla-import-api';

function baseIRWith(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      format: 'fla' as const,
      basename: 'sample.fla',
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      parser: {
        package: 'lifeart/fla-viewer' as const,
        entrypoint: 'FLAParser.parse' as const,
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164' as const,
      },
    },
    document: {
      width: 100,
      height: 100,
      frameRate: 30,
      backgroundColor: '#FFFFFF',
    },
    media: [],
    timelines: [],
    compatibility: [],
    summary: {
      placedInstanceCount: 0,
      libraryOnlyMediaCount: 0,
    },
    ...overrides,
  };
}

describe('FlaStructuralSummaryIRSchema — field allowlist', () => {
  it('accepts only the B0-approved fields', () => {
    const valid = {
      sceneCount: 1,
      totalTimelineCount: 2,
      layerCount: 3,
      frameCount: 4,
      tweenCount: 0,
      symbolCount: 1,
      movieClipCount: 0,
      graphicCount: 1,
      buttonCount: 0,
    };
    const parsed = FlaStructuralSummaryIRSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('rejects fields B0 deferred (keyframeCount)', () => {
    expect(() =>
      FlaStructuralSummaryIRSchema.parse({
        sceneCount: 1,
        totalTimelineCount: 1,
        layerCount: 0,
        frameCount: 0,
        tweenCount: 0,
        symbolCount: 0,
        movieClipCount: 0,
        graphicCount: 0,
        buttonCount: 0,
        keyframeCount: 1, // B1-deferred
      }),
    ).toThrow();
  });

  it('rejects fields B0 deferred (animatedTimelineCandidateCount)', () => {
    expect(() =>
      FlaStructuralSummaryIRSchema.parse({
        sceneCount: 1,
        totalTimelineCount: 1,
        layerCount: 0,
        frameCount: 0,
        tweenCount: 0,
        symbolCount: 0,
        movieClipCount: 0,
        graphicCount: 0,
        buttonCount: 0,
        animatedTimelineCandidateCount: 1, // B1-deferred
      }),
    ).toThrow();
  });
});

describe('AnimationImportIRSchema — V1.5-B1 structure attachment', () => {
  it('parses an IR that has a structure summary', () => {
    const ir = baseIRWith({
      structure: {
        sceneCount: 1,
        totalTimelineCount: 2,
        layerCount: 2,
        frameCount: 3,
        tweenCount: 0,
        symbolCount: 1,
        movieClipCount: 0,
        graphicCount: 1,
        buttonCount: 0,
      },
    });
    const parsed = AnimationImportIRSchema.parse(ir);
    expect(parsed.structure).toEqual({
      sceneCount: 1,
      totalTimelineCount: 2,
      layerCount: 2,
      frameCount: 3,
      tweenCount: 0,
      symbolCount: 1,
      movieClipCount: 0,
      graphicCount: 1,
      buttonCount: 0,
    });
  });

  it('parses an IR without a structure summary (backwards-compatible)', () => {
    const ir = baseIRWith();
    const parsed = AnimationImportIRSchema.parse(ir);
    expect(parsed.structure).toBeUndefined();
  });

  it('rejects an IR whose structure summary violates the allowlist', () => {
    const ir = baseIRWith({
      structure: {
        sceneCount: -1, // nonnegative required
        totalTimelineCount: 1,
        layerCount: 0,
        frameCount: 0,
        tweenCount: 0,
        symbolCount: 0,
        movieClipCount: 0,
        graphicCount: 0,
        buttonCount: 0,
      },
    });
    expect(() => AnimationImportIRSchema.parse(ir)).toThrow();
  });
});
