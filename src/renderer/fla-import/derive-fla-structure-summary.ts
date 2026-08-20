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
 * - `tweenCount`           = frames carrying supported structural
 *                            `tweenType=motion|shape` evidence, OR
 *                            with `tweens.length>0`, OR
 *                            with a defined `morphShape`
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
      if (isTweenFrame(frame)) tweenCount += 1;
    }
  }
  consume({ layerCount, frameCount, tweenCount });
}

function isTweenFrame(frame: Frame): boolean {
  if (frame.tweenType === 'motion' || frame.tweenType === 'shape') return true;
  if ((frame.tweens?.length ?? 0) > 0) return true;
  if (frame.morphShape !== undefined) return true;
  return false;
}
