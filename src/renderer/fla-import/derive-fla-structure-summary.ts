/**
 * FLA V1.5-B1 read-only structural summary derivation.
 *
 * Pure function from the parser-owned FLADocument to Panda-owned
 * `FlaStructuralSummary` counts. Inspects NO Project state, mutates NO
 * Asset, decodes NO bitmap. Implements the B0-proven count definitions:
 *
 * - `sceneCount`           = top-level DOMTimeline count
 * - `totalTimelineCount`   = top-level timelines + symbol-internal timelines
 * - `layerCount`           = DOMLayer count across top-level + symbol timelines
 * - `frameCount`           = DOMFrame count across top-level + symbol timelines
 * - `tweenCount`           = frames carrying `tweenType="motion"` or
 *                            `tweenType="shape"` (exact B0 evidence matrix
 *                            definition; deliberately NOT broadened to the
 *                            parser's `frame.tweens` array or `morphShape`,
 *                            which are parser-normalized artifacts with no
 *                            proven 1:1 equivalence to the B0 source fact)
 * - `symbolCount`          = total DOMSymbolItem structural count
 * - `movieClipCount` /
 *   `graphicCount`  /
 *   `buttonCount`         = subsets of `symbolCount` by proven source
 *                            `symbolType`
 *
 * `keyframeCount` and `animatedTimelineCandidateCount` are NOT exposed
 * (V1.5-B1 deferred per the B0 evidence matrix; see
 * `tests/helpers/fla-structural-probe.ts`).
 *
 * No FLADocument object leaves this module; only counts.
 */

import type { FLADocument, Frame, Timeline } from './parser-core/types';
import type { FlaStructuralSummary } from '../../shared/fla-import-api';

export function deriveStructureSummary(document: FLADocument): FlaStructuralSummary {
  const topLevelTimelineCount = document.timelines.length;
  const symbolCount = document.symbols.size;
  let movieClipCount = 0;
  let graphicCount = 0;
  let buttonCount = 0;

  let layerCount = 0;
  let frameCount = 0;
  let tweenCount = 0;

  for (const topTimeline of document.timelines) {
    accumulateTimeline(topTimeline, (counts) => {
      layerCount += counts.layerCount;
      frameCount += counts.frameCount;
      tweenCount += counts.tweenCount;
    });
  }

  for (const symbol of document.symbols.values()) {
    if (symbol.symbolType === 'movieclip') movieClipCount += 1;
    else if (symbol.symbolType === 'graphic') graphicCount += 1;
    else if (symbol.symbolType === 'button') buttonCount += 1;
    accumulateTimeline(symbol.timeline, (counts) => {
      layerCount += counts.layerCount;
      frameCount += counts.frameCount;
      tweenCount += counts.tweenCount;
    });
  }

  return {
    sceneCount: topLevelTimelineCount,
    totalTimelineCount: topLevelTimelineCount + symbolCount,
    layerCount,
    frameCount,
    tweenCount,
    symbolCount,
    movieClipCount,
    graphicCount,
    buttonCount,
  };
}

interface TimelineCounts {
  layerCount: number;
  frameCount: number;
  tweenCount: number;
}

function accumulateTimeline(
  timeline: Timeline,
  consume: (counts: TimelineCounts) => void,
): void {
  let layerCount = 0;
  let frameCount = 0;
  let tweenCount = 0;
  for (const layer of timeline.layers) {
    layerCount += 1;
    for (const frame of layer.frames) {
      frameCount += 1;
      if (isB0TweenFrame(frame)) tweenCount += 1;
    }
  }
  consume({ layerCount, frameCount, tweenCount });
}

/**
 * B0 evidence matrix (and #275 spike): a frame counts as tween-bearing only
 * when its `tweenType` attribute is `motion` or `shape`. This matches the
 * B0 XML probe exactly (`<DOMFrame ... tweenType="motion|shape">`).
 *
 * `frame.tweens` (parser-collected `<Ease>`/`<CustomEase>` elements) and
 * `frame.morphShape` are NOT included. They are parser-normalized artifacts
 * with no 1:1 proven equivalence to the B0 source structural fact:
 *  - `morphShape` is set by the parser *only when* `tweenType === 'shape'`,
 *    so it is strictly subsumed by the B0 definition.
 *  - `tweens` is parsed unconditionally for every frame; an XFL can carry
 *    `<Ease>` child elements without a matching `tweenType` attribute, which
 *    would let a broad definition count non-B0 frames as tweens.
 *
 * Until a wider equivalence is proven (a future V1.5-D or later slice), B1
 * must stay narrow. See issue #278 §"Required task B".
 */
function isB0TweenFrame(frame: Frame): boolean {
  return frame.tweenType === 'motion' || frame.tweenType === 'shape';
}
