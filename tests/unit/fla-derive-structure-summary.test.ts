/**
 * V1.5-B1 read-only structural summary — pure-function unit tests.
 *
 * - synthetic FLADocument + derived timeline fragments
 * - counts every B1-approved field
 * - asserts `keyframeCount` / `animatedTimelineCandidateCount` are NOT exposed
 * - asserts B0-documented known-good baselines for 文件.fla / 剑.fla
 */

import { describe, expect, it } from 'vitest';

import { deriveStructureSummary } from '../../src/renderer/fla-import/derive-fla-structure-summary';
import type {
  FLADocument,
  Frame,
  Layer,
  Symbol,
  Timeline,
} from '../../src/renderer/fla-import/parser-core/types';

function emptyDoc(): FLADocument {
  return {
    width: 0,
    height: 0,
    frameRate: 0,
    backgroundColor: '#FFFFFF',
    timelines: [],
    symbols: new Map(),
    bitmaps: new Map(),
    sounds: new Map(),
    videos: new Map(),
  };
}

function makeTimeline(layers: Layer[]): Timeline {
  return {
    name: 'Scene 1',
    layers,
    totalFrames: layers.reduce(
      (sum, layer) =>
        sum +
        layer.frames.reduce((s, f) => s + Math.max(1, f.duration), 0),
      0,
    ),
    referenceLayers: new Set<number>(),
  };
}

function makeLayer(name: string, frames: Frame[]): Layer {
  return {
    name,
    color: '#000000',
    visible: true,
    locked: false,
    outline: false,
    frames,
  };
}

function makeFrame(
  index: number,
  duration: number,
  extras: Partial<Frame> = {},
): Frame {
  return {
    index,
    duration,
    keyMode: 0,
    elements: [],
    ...extras,
  };
}

function makeSymbol(
  name: string,
  type: Symbol['symbolType'],
  timeline: Timeline,
): Symbol {
  return {
    name,
    itemID: name,
    symbolType: type,
    timeline,
  };
}

describe('deriveStructureSummary — empty document', () => {
  it('returns all-zero counts when the document has no timelines or symbols', () => {
    const result = deriveStructureSummary(emptyDoc());
    expect(result).toEqual({
      sceneCount: 0,
      totalTimelineCount: 0,
      layerCount: 0,
      frameCount: 0,
      tweenCount: 0,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
    });
  });
});

describe('deriveStructureSummary — top-level scenes only', () => {
  it('counts a single scene, layer, and frame', () => {
    const doc = emptyDoc();
    doc.timelines = [makeTimeline([makeLayer('L1', [makeFrame(0, 1)])])];
    expect(deriveStructureSummary(doc)).toEqual({
      sceneCount: 1,
      totalTimelineCount: 1,
      layerCount: 1,
      frameCount: 1,
      tweenCount: 0,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
    });
  });

  it('counts tween frames via tweenType=motion', () => {
    const doc = emptyDoc();
    doc.timelines = [
      makeTimeline([
        makeLayer('L1', [
          makeFrame(0, 1, { tweenType: 'motion' }),
          makeFrame(1, 1),
        ]),
      ]),
    ];
    const result = deriveStructureSummary(doc);
    expect(result.frameCount).toBe(2);
    expect(result.tweenCount).toBe(1);
  });

  it('counts tween frames via tweenType=shape', () => {
    const doc = emptyDoc();
    doc.timelines = [
      makeTimeline([makeLayer('L1', [makeFrame(0, 1, { tweenType: 'shape' })])]),
    ];
    expect(deriveStructureSummary(doc).tweenCount).toBe(1);
  });

  it('does NOT count tween frames via only `tweens` array (parser-normalized, not B0 evidence)', () => {
    // #278 corrective: a frame with no `tweenType` attribute but with a
    // non-empty parser-collected `tweens` array must NOT be counted as a
    // tween under B0 semantics. The B0 evidence matrix defines a tween
    // structural fact strictly by `tweenType="motion|shape"`.
    const doc = emptyDoc();
    doc.timelines = [
      makeTimeline([
        makeLayer('L1', [
          makeFrame(0, 1, { tweens: [{ target: 'Layer_1' }] }),
        ]),
      ]),
    ];
    expect(deriveStructureSummary(doc).tweenCount).toBe(0);
  });

  it('does NOT count tween frames via only `morphShape` (parser-normalized, not B0 evidence)', () => {
    // #278 corrective: a frame with no `tweenType` attribute but with a
    // parser-set `morphShape` must NOT be counted as a tween under B0
    // semantics. In production, `morphShape` is set only when
    // `tweenType === 'shape'`, so this case should not arise; we still
    // pin the narrow B0 definition here to prevent future drift.
    const doc = emptyDoc();
    doc.timelines = [
      makeTimeline([
        makeLayer('L1', [
          makeFrame(0, 1, { morphShape: { segments: [] } }),
        ]),
      ]),
    ];
    expect(deriveStructureSummary(doc).tweenCount).toBe(0);
  });

  it('does NOT count tween frames with tweenType="none" even if `tweens` is non-empty', () => {
    const doc = emptyDoc();
    doc.timelines = [
      makeTimeline([
        makeLayer('L1', [
          makeFrame(0, 1, {
            tweenType: 'none',
            tweens: [{ target: 'Layer_1' }],
          }),
        ]),
      ]),
    ];
    expect(deriveStructureSummary(doc).tweenCount).toBe(0);
  });
});

describe('deriveStructureSummary — symbols + their internal timelines', () => {
  it('counts graphic / movieclip / button symbols and aggregates their timelines', () => {
    const doc = emptyDoc();
    doc.timelines = [makeTimeline([makeLayer('Root', [makeFrame(0, 1)])])];

    doc.symbols.set(
      'graphic_sym',
      makeSymbol(
        'graphic_sym',
        'graphic',
        makeTimeline([makeLayer('L', [makeFrame(0, 1), makeFrame(1, 1)])]),
      ),
    );
    doc.symbols.set(
      'movieclip_sym',
      makeSymbol(
        'movieclip_sym',
        'movieclip',
        makeTimeline([makeLayer('L', [makeFrame(0, 1)])]),
      ),
    );
    doc.symbols.set(
      'button_sym',
      makeSymbol(
        'button_sym',
        'button',
        makeTimeline([makeLayer('L', [makeFrame(0, 1)])]),
      ),
    );

    const result = deriveStructureSummary(doc);
    expect(result).toMatchObject({
      sceneCount: 1,
      totalTimelineCount: 4, // 1 top-level + 3 symbol-internal
      symbolCount: 3,
      graphicCount: 1,
      movieClipCount: 1,
      buttonCount: 1,
      layerCount: 4, // 1 root + 1 per symbol
      frameCount: 5, // 1 root + 2 + 1 + 1
      tweenCount: 0,
    });
  });
});

describe('deriveStructureSummary — file.fla / 剑.fla known-good baselines (corrected #278)', () => {
  it('matches B0-documented file.fla structure', () => {
    const doc = emptyDoc();
    // file.fla B0 evidence (handoff #270 / spike #275 / corrective #278):
    //   sha256    = 84682EDCD49B8FCC072AE740188677BAE9D7D0FD603B8BED51A7AC4DDEB3119F
    //   scene     = 1
    //   layers    = 1 (top-level)
    //   frames    = 1 (top-level DOMFrame count, NOT bitmap placements)
    //   symbols   = 0
    //   bitmaps   = 158 (independent from frameCount)
    //   placed    = 156 (independent from frameCount)
    //   libraryOnly = 2 (independent from frameCount)
    //   tweenType attrs = 0 (no XML `tweenType="motion|shape"` anywhere)
    //   <Ease> elements = 0 (no parser-normalized tween references)
    //
    // #277 accidentally encoded `frameCount = 156` (= placed bitmap
    // instances) into the synthetic fixture, contradicting the B0 evidence
    // matrix. #278 corrects this so the tests no longer teach CI that
    // "156 placed bitmaps = 156 frames".
    doc.timelines = [
      makeTimeline([makeLayer('Layer 1', [makeFrame(0, 1)])]),
    ];
    // No symbols; bitmaps/sounds/videos are not used by deriveStructureSummary
    const result = deriveStructureSummary(doc);
    expect(result).toMatchObject({
      sceneCount: 1,
      totalTimelineCount: 1,
      symbolCount: 0,
      layerCount: 1,
      frameCount: 1,
      tweenCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
    });
  });

  it('matches B0-documented 剑.fla zero-raster structure', () => {
    const doc = emptyDoc();
    // 剑.fla B0 evidence:
    //   sha256  = E773508C4079C4FA8235043B69A0F5415BCC1596A3ED345A4C6652B48CE54377
    //   scene   = 1
    //   symbol  = 1 graphic
    //   layers  = 2 (1 top-level + 1 inside the symbol)
    //   frames  = 2 (1 top-level DOMFrame + 1 inside the symbol timeline;
    //                NOT "1 + 2 = 3" as #277's fixture asserted)
    //   bitmaps = 0
    //   tweenType attrs = 0
    //   <Ease> elements = 0
    doc.timelines = [
      makeTimeline([makeLayer('L1', [makeFrame(0, 1)])]),
    ];
    doc.symbols.set(
      'graphic_sym',
      makeSymbol(
        'graphic_sym',
        'graphic',
        makeTimeline([makeLayer('Inner', [makeFrame(0, 1)])]),
      ),
    );
    const result = deriveStructureSummary(doc);
    expect(result).toMatchObject({
      sceneCount: 1,
      totalTimelineCount: 2,
      symbolCount: 1,
      graphicCount: 1,
      movieClipCount: 0,
      buttonCount: 0,
      layerCount: 2,
      frameCount: 2,
      tweenCount: 0,
    });
  });
});

describe('deriveStructureSummary — does not expose V1.5-deferred fields', () => {
  it('produces only B0-approved fields', () => {
    const result = deriveStructureSummary(emptyDoc());
    const allowedKeys = [
      'sceneCount',
      'totalTimelineCount',
      'layerCount',
      'frameCount',
      'tweenCount',
      'symbolCount',
      'movieClipCount',
      'graphicCount',
      'buttonCount',
    ];
    expect(Object.keys(result).sort()).toEqual(allowedKeys.slice().sort());
    expect(result).not.toHaveProperty('keyframeCount');
    expect(result).not.toHaveProperty('animatedTimelineCandidateCount');
  });
});
