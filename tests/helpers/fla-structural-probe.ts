/**
 * FLA V1.5-B0 structural probe harness (test/evidence scope only).
 *
 * This is NOT a production FLA inspector and does NOT change any Panda-owned
 * contract. It is a read-only, bounded evidence vehicle that derives the
 * candidate structural facts from the SAME modern ZIP/XFL byte sources the
 * pinned `lifeart/fla-viewer` production path consumes (DOMDocument.xml
 * `<media>`/`<symbols>`/`<timelines>` and `LIBRARY/*.xml`). It does not execute
 * the parser runtime (canvas/DOM), does not decode media, and does not leak any
 * parser-specific object into renderer/product contracts.
 *
 * Proven sources (cite in the B0 evidence matrix):
 *  - DOMDocument.xml `<media><DOMBitmapItem>`  -> bitmap/media count (mirrors FLADocument.bitmaps)
 *  - DOMDocument.xml `<symbols><DOMSymbolItem symbolType>` + LIBRARY/*.xml -> symbol/movieclip/graphic/button
 *  - DOMDocument.xml `<timelines><DOMTimeline>` -> scene/top-level timeline count (mirrors FLADocument.timelines)
 *  - `<DOMLayer>` / `<DOMFrame keyMode>` / `tweenType` -> layer/frame/keyframe/tween facts
 *  - `<DOMBitmapInstance libraryItemName>` in frames -> placed vs library-only count
 *
 * The pinned parser core reads these exact entries in:
 *  - src/renderer/fla-import/parser-core/fla-parser.ts
 *  - src/renderer/fla-import/parser-core/binary-timeline-decoder.ts
 *  - src/renderer/fla-import/parser-core/binary-instance-decoder.ts
 * and the adapter exposes only a subset via AnimationImportIR (media,
 * timelines/layers/frames/instances, summary.placed/libraryOnly, compatibility).
 */

import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { FLA_IMPORT_LIMITS } from '../../src/shared/fla-import-api';

export interface FlaStructuralFacts {
  /** DOMBitmapItem count across <media> and LIBRARY (mirrors FLADocument.bitmaps.size). */
  bitmapMediaCount: number;
  /** Top-level DOMTimeline count in DOMDocument.xml (<timelines>); equals scene count in XFL. */
  sceneCount: number;
  topLevelTimelineCount: number;
  /** DOMSymbolItem count across <symbols> and LIBRARY. */
  symbolCount: number;
  movieClipCount: number;
  graphicCount: number;
  buttonCount: number;
  /** DOMLayer count across top-level + symbol timelines. */
  layerCount: number;
  /** DOMFrame count across top-level + symbol timelines. */
  frameCount: number;
  /** DOMFrame elements with a non-zero keyMode attribute. */
  keyframeCount: number;
  /** tweenType="motion|shape" occurrences across all timelines. */
  tweenCount: number;
  /** Timelines (top-level or symbol) with frames>1 OR tweens>0 OR keyframes>1. */
  animatedTimelineCandidateCount: number;
  /** Distinct DOMBitmapInstance libraryItemName references in frames. */
  placedInstanceCount: number;
  /** bitmapMediaCount - placedInstanceCount (matches AnimationImportIR.summary.libraryOnlyMediaCount). */
  libraryOnlyMediaCount: number;
}

export class FlaStructuralProbeBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlaStructuralProbeBudgetExceededError';
  }
}

function nextTagIndex(xml: string, tag: string, from: number): number {
  const needle = `<${tag}`;
  let i = from;
  for (;;) {
    const idx = xml.indexOf(needle, i);
    if (idx === -1) return -1;
    if (idx === 0 || xml[idx - 1] !== '/') return idx;
    i = idx + needle.length;
  }
}

/** Balanced extractor for `<tag ...>...</tag>` blocks (handles nesting). */
function extractBalancedBlocks(xml: string, tag: string): string[] {
  const close = `</${tag}>`;
  const blocks: string[] = [];
  const openStack: number[] = [];
  let i = 0;
  for (;;) {
    const oi = nextTagIndex(xml, tag, i);
    const ci = xml.indexOf(close, i);
    if (oi === -1 && ci === -1) break;
    if (ci !== -1 && (oi === -1 || ci < oi)) {
      const start = openStack.pop();
      if (start !== undefined) blocks.push(xml.slice(start, ci + close.length));
      i = ci + close.length;
    } else if (oi !== -1) {
      openStack.push(oi);
      i = oi + `<${tag}`.length;
    } else {
      break;
    }
  }
  return blocks;
}

function countOccurrences(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
}

function attrValue(block: string, name: string): string | null {
  const m = block.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? (m[1] ?? null) : null;
}

interface TimelineAnalysis {
  layers: number;
  frames: number;
  keyframes: number;
  tweens: number;
}

function analyzeTimeline(timelineXml: string): TimelineAnalysis {
  const layers = countOccurrences(timelineXml, 'DOMLayer');
  const frames = countOccurrences(timelineXml, 'DOMFrame');
  let keyframes = 0;
  const kmRe = /<DOMFrame\b[^>]*\bkeyMode="(\d+)"/g;
  let km: RegExpExecArray | null;
  while ((km = kmRe.exec(timelineXml))) {
    if (km[1] !== '0') keyframes += 1;
  }
  const tweens = (timelineXml.match(/\btweenType="(motion|shape)"/g) || []).length;
  return { layers, frames, keyframes, tweens };
}

/**
 * Pure, read-only structural derivation from the modern ZIP/XFL source XML.
 * No fs, no jszip, no DOM — safely unit-testable with synthetic input.
 */
export function probeFlaStructure(
  domDocumentXml: string,
  libraryXmlEntries: readonly string[],
): FlaStructuralFacts {
  if (!domDocumentXml) {
    return {
      bitmapMediaCount: 0,
      sceneCount: 0,
      topLevelTimelineCount: 0,
      symbolCount: 0,
      movieClipCount: 0,
      graphicCount: 0,
      buttonCount: 0,
      layerCount: 0,
      frameCount: 0,
      keyframeCount: 0,
      tweenCount: 0,
      animatedTimelineCandidateCount: 0,
      placedInstanceCount: 0,
      libraryOnlyMediaCount: 0,
    };
  }

  const bitmapInMedia = countOccurrences(domDocumentXml, 'DOMBitmapItem');
  const embeddedSymbols = countOccurrences(domDocumentXml, 'DOMSymbolItem');

  let bitmapInLibrary = 0;
  let movieClipCount = 0;
  let graphicCount = 0;
  let buttonCount = 0;
  const symbolTimelineAnalyses: TimelineAnalysis[] = [];

  for (const libXml of libraryXmlEntries) {
    if (/<DOMBitmapItem\b/.test(libXml)) bitmapInLibrary += 1;
    const symMatch = libXml.match(/<DOMSymbolItem\b[^>]*\bsymbolType="(\w+)"/);
    if (symMatch) {
      if (symMatch[1] === 'movieclip') movieClipCount += 1;
      else if (symMatch[1] === 'graphic') graphicCount += 1;
      else if (symMatch[1] === 'button') buttonCount += 1;
      for (const tl of extractBalancedBlocks(libXml, 'DOMTimeline')) {
        symbolTimelineAnalyses.push(analyzeTimeline(tl));
      }
    }
  }

  const topTimelines = extractBalancedBlocks(domDocumentXml, 'DOMTimeline');
  const topAnalyses = topTimelines.map(analyzeTimeline);
  const allAnalyses = [...topAnalyses, ...symbolTimelineAnalyses];

  const bitmapMediaCount = bitmapInMedia + bitmapInLibrary;

  // Placed bitmap instances: distinct libraryItemName references in DOMDocument frames.
  const placedRefs = domDocumentXml.match(/<DOMBitmapInstance\b[^>]*\blibraryItemName="([^"]*)"/g) || [];
  const placedNames = new Set<string>();
  for (const ref of placedRefs) {
    const name = attrValue(ref, 'libraryItemName');
    if (name) placedNames.add(name);
  }
  const placedInstanceCount = placedNames.size;

  const layerCount = allAnalyses.reduce((sum, a) => sum + a.layers, 0);
  const frameCount = allAnalyses.reduce((sum, a) => sum + a.frames, 0);
  const keyframeCount = allAnalyses.reduce((sum, a) => sum + a.keyframes, 0);
  const tweenCount = allAnalyses.reduce((sum, a) => sum + a.tweens, 0);
  const animatedTimelineCandidateCount = allAnalyses.filter(
    (a) => a.frames > 1 || a.tweens > 0 || a.keyframes > 1,
  ).length;

  return {
    bitmapMediaCount,
    sceneCount: topAnalyses.length,
    topLevelTimelineCount: topAnalyses.length,
    symbolCount: movieClipCount + graphicCount + buttonCount + embeddedSymbols,
    movieClipCount,
    graphicCount,
    buttonCount,
    layerCount,
    frameCount,
    keyframeCount,
    tweenCount,
    animatedTimelineCandidateCount,
    placedInstanceCount,
    libraryOnlyMediaCount: bitmapMediaCount - placedInstanceCount,
  };
}

export interface FlaStructuralProbeSource {
  basename: string;
  byteLength: number;
  sha256: string;
  facts: FlaStructuralFacts;
}

/**
 * Bounded loader: reads the modern ZIP/XFL bytes (read-only), applies the same
 * archive/entry budgets the production path uses, and derives structural facts.
 * Throws FlaStructuralProbeBudgetExceededError if the source exceeds a budget,
 * and propagates the underlying jszip error for malformed archives (so the
 * production fail-closed behavior is preserved, not normalized).
 */
export async function probeFlaStructureFromBytes(
  bytes: Uint8Array,
  basename: string,
): Promise<FlaStructuralProbeSource> {
  if (bytes.byteLength > FLA_IMPORT_LIMITS.maxSourceBytes) {
    throw new FlaStructuralProbeBudgetExceededError(
      `FLA source ${bytes.byteLength} bytes exceeds budget ${FLA_IMPORT_LIMITS.maxSourceBytes}`,
    );
  }
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.length > FLA_IMPORT_LIMITS.maxZipEntries) {
    throw new FlaStructuralProbeBudgetExceededError(
      `FLA archive entry count ${names.length} exceeds budget ${FLA_IMPORT_LIMITS.maxZipEntries}`,
    );
  }
  const domDocName = names.find((n) => n === 'DOMDocument.xml');
  if (!domDocName) {
    throw new FlaStructuralProbeBudgetExceededError('FLA archive has no DOMDocument.xml');
  }
  const domDocumentXml = await zip.files[domDocName]!.async('string');
  const libraryXmlEntries = await Promise.all(
    names
      .filter((n) => /LIBRARY\//i.test(n) && /\.xml$/i.test(n))
      .map((n) => zip.files[n]!.async('string')),
  );

  const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex').toUpperCase();

  return {
    basename,
    byteLength: bytes.byteLength,
    sha256,
    facts: probeFlaStructure(domDocumentXml, libraryXmlEntries),
  };
}
