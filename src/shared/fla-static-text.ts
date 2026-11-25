/**
 * Bounded classic FLA static text model, offline font fallback sanitizer,
 * and Unicode/CJK-aware multi-run horizontal text layout engine.
 *
 * Cross-checked against Animate XFL DOMStaticText/DOMTextRun public semantics
 * and lifeart/fla-viewer@b14fa1d1 (src/fla-parser.ts, src/renderer.ts), with
 * independent CJK/Unicode grapheme-safe wrapping and zero DOM/network access.
 */

import { computeBoundedFlaGraphicOutputSize } from './fla-snapshot-output-size';

export const FLA_STATIC_TEXT_LIMITS = {
  maxRunsPerText: 128,
  maxCharsPerText: 8_192,
  maxCharsPerComposition: 32_768,
  maxTextNodesPerComposition: 128,
  maxLinesPerText: 256,
  maxFontFaceLength: 128,
  maxBoxDimension: 8_192,
  minFontSize: 1,
  maxFontSize: 512,
  maxLetterSpacing: 512,
  maxLineSpacing: 1_024,
  maxLineHeight: 1_024,
  maxRasterDimension: 2_048,
  maxTotalRasterPixels: 4_194_304,
} as const;

export type FlaStaticTextAlignment = 'left' | 'center' | 'right' | 'justify';

export interface FlaStaticTextRun {
  readonly characters: string;
  readonly alignment: FlaStaticTextAlignment;
  readonly size: number;
  readonly lineHeight: number;
  readonly lineSpacing: number;
  readonly letterSpacing: number;
  readonly face?: string;
  readonly fillColor: string;
  readonly alpha: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline?: boolean;
  readonly leftMargin?: number;
  readonly rightMargin?: number;
  readonly indent?: number;
}

export interface FlaStaticTextDescriptor {
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly runs: readonly FlaStaticTextRun[];
}

export const FLA_STATIC_TEXT_PLACEHOLDER_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface FlaStaticTextMatrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface FlaStaticTextGraphicFraming {
  readonly nonTextBounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null;
  readonly textTransforms: readonly {
    readonly placeholderId: string;
    readonly worldTransform: FlaStaticTextMatrix2D;
  }[];
  readonly filterExpansion: { readonly x: number; readonly y: number };
  readonly padding: number;
}

export interface FlaStaticTextRenderItem {
  readonly placeholderId: string;
  readonly descriptor: FlaStaticTextDescriptor;
  readonly scaleHint: number;
}

export interface FlaStaticTextMeasurement {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

export type FlaStaticTextMeasurer = (
  text: string,
  run: FlaStaticTextRun,
) => FlaStaticTextMeasurement;

export interface FlaStaticTextLaidOutFragment {
  readonly text: string;
  readonly run: FlaStaticTextRun;
  readonly x: number;
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

export interface FlaStaticTextLaidOutLine {
  readonly baselineY: number;
  readonly ascent: number;
  readonly descent: number;
  readonly width: number;
  readonly fragments: readonly FlaStaticTextLaidOutFragment[];
}

export interface FlaStaticTextBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlaStaticTextLayoutResult {
  readonly lines: readonly FlaStaticTextLaidOutLine[];
  readonly bounds: FlaStaticTextBounds;
  readonly truncated: boolean;
}

const OFFLINE_FALLBACK_FONTS =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimHei", "Segoe UI", Arial, sans-serif';

const SAFE_FONT_CHAR_PATTERN = /[^\p{L}\p{N} ._+-]/gu;
const CJK_OR_FULLWIDTH_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;
const LEADING_PUNCTUATION_FORBIDDEN = /^[，。、！？：；）】》」』”’.,!?;:)\]]/u;

let sharedGraphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (sharedGraphemeSegmenter !== undefined) return sharedGraphemeSegmenter;
  try {
    sharedGraphemeSegmenter =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  } catch {
    sharedGraphemeSegmenter = null;
  }
  return sharedGraphemeSegmenter;
}

export function splitGraphemes(text: string): string[] {
  if (text.length === 0) return [];
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return [...text];
  const result: string[] = [];
  for (const part of segmenter.segment(text)) {
    result.push(part.segment);
  }
  return result;
}

/**
 * Sanitize a raw XFL font face name into a safe offline CSS font-family stack.
 * Strips quotes, punctuation, URLs, and markup characters; never loads remote fonts.
 */
export function buildSafeOfflineFontFamily(rawFace?: string): string {
  if (!rawFace) return OFFLINE_FALLBACK_FONTS;
  const cleaned = rawFace
    .slice(0, FLA_STATIC_TEXT_LIMITS.maxFontFaceLength)
    .replace(SAFE_FONT_CHAR_PATTERN, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return OFFLINE_FALLBACK_FONTS;
  return `"${cleaned}", ${OFFLINE_FALLBACK_FONTS}`;
}

export function buildCanvasFontSpec(run: FlaStaticTextRun): string {
  const style = run.italic ? 'italic ' : '';
  const weight = run.bold ? 'bold ' : '';
  const size = Math.max(
    FLA_STATIC_TEXT_LIMITS.minFontSize,
    Math.min(FLA_STATIC_TEXT_LIMITS.maxFontSize, run.size),
  );
  return `${style}${weight}${size}px ${buildSafeOfflineFontFamily(run.face)}`;
}

/**
 * Deterministic Node/headless fallback measurer used for Main-side bounds
 * estimation and unit testing when Chromium Canvas 2D is not present.
 */
export function estimateFlaStaticTextMeasurement(
  text: string,
  run: FlaStaticTextRun,
): FlaStaticTextMeasurement {
  const size = run.size;
  let width = 0;
  for (const grapheme of splitGraphemes(text)) {
    if (grapheme === ' ' || grapheme === '\t') {
      width += size * 0.3;
    } else if (CJK_OR_FULLWIDTH_PATTERN.test(grapheme)) {
      width += size * 1.0;
    } else {
      width += size * (run.bold ? 0.62 : 0.56);
    }
  }
  return {
    width,
    ascent: size * 0.88,
    descent: size * 0.26,
  };
}

function measureFragment(
  text: string,
  run: FlaStaticTextRun,
  measure: FlaStaticTextMeasurer,
): FlaStaticTextMeasurement {
  if (text.length === 0) {
    return { width: 0, ascent: run.size * 0.85, descent: run.size * 0.25 };
  }
  if (run.letterSpacing === 0) {
    return measure(text, run);
  }
  const graphemes = splitGraphemes(text);
  let width = 0;
  let ascent = run.size * 0.85;
  let descent = run.size * 0.25;
  for (let index = 0; index < graphemes.length; index += 1) {
    const m = measure(graphemes[index]!, run);
    width += m.width;
    if (index < graphemes.length - 1) width += run.letterSpacing;
    if (m.ascent > ascent) ascent = m.ascent;
    if (m.descent > descent) descent = m.descent;
  }
  return { width, ascent, descent };
}

interface InlineToken {
  readonly text: string;
  readonly run: FlaStaticTextRun;
  readonly isWhitespace: boolean;
  readonly isCjk: boolean;
}

function tokenizeSegment(text: string, run: FlaStaticTextRun): InlineToken[] {
  const tokens: InlineToken[] = [];
  const graphemes = splitGraphemes(text);
  let index = 0;
  while (index < graphemes.length) {
    const ch = graphemes[index]!;
    if (ch === ' ' || ch === '\t') {
      let ws = ch;
      index += 1;
      while (index < graphemes.length && (graphemes[index] === ' ' || graphemes[index] === '\t')) {
        ws += graphemes[index]!;
        index += 1;
      }
      tokens.push({ text: ws, run, isWhitespace: true, isCjk: false });
      continue;
    }
    if (CJK_OR_FULLWIDTH_PATTERN.test(ch)) {
      let chunk = ch;
      index += 1;
      // Minimal kinsoku: keep an immediately following closing punctuation attached.
      if (index < graphemes.length && LEADING_PUNCTUATION_FORBIDDEN.test(graphemes[index]!)) {
        chunk += graphemes[index]!;
        index += 1;
      }
      tokens.push({ text: chunk, run, isWhitespace: false, isCjk: true });
      continue;
    }
    let word = ch;
    index += 1;
    while (
      index < graphemes.length &&
      graphemes[index] !== ' ' &&
      graphemes[index] !== '\t' &&
      !CJK_OR_FULLWIDTH_PATTERN.test(graphemes[index]!)
    ) {
      word += graphemes[index]!;
      index += 1;
    }
    tokens.push({ text: word, run, isWhitespace: false, isCjk: false });
  }
  return tokens;
}

interface DraftFragment {
  readonly gapBefore: number;
  text: string;
  readonly run: FlaStaticTextRun;
  width: number;
  ascent: number;
  descent: number;
  readonly isWhitespace: boolean;
}

interface DraftLine {
  readonly fragments: DraftFragment[];
  readonly alignment: FlaStaticTextAlignment;
  readonly leftMargin: number;
  readonly rightMargin: number;
  readonly firstLineIndent: number;
  readonly fallbackRun: FlaStaticTextRun;
}

/**
 * Lay out classic horizontal multi-run static text with explicit newlines,
 * continuous inline cursor across style runs, CJK + Latin wrapping,
 * alignment, letterSpacing, lineHeight, and lineSpacing (leading).
 */
export function layoutFlaStaticText(
  descriptor: FlaStaticTextDescriptor,
  measure: FlaStaticTextMeasurer = estimateFlaStaticTextMeasurement,
): FlaStaticTextLayoutResult {
  const fallbackRun: FlaStaticTextRun = descriptor.runs[0] ?? {
    characters: '',
    alignment: 'left',
    size: 12,
    lineHeight: 14.4,
    lineSpacing: 0,
    letterSpacing: 0,
    fillColor: '#000000',
    alpha: 1,
    bold: false,
    italic: false,
  };

  // Split runs into paragraphs separated by explicit \r\n / \r / \n newlines.
  type ParagraphSegment = { readonly text: string; readonly run: FlaStaticTextRun };
  const paragraphs: { readonly segments: ParagraphSegment[]; readonly leadRun: FlaStaticTextRun }[] = [];
  let currentSegments: ParagraphSegment[] = [];
  let currentLeadRun: FlaStaticTextRun = fallbackRun;

  for (const run of descriptor.runs) {
    const normalized = run.characters.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
    const parts = normalized.split('\n');
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex]!;
      if (currentSegments.length === 0) currentLeadRun = run;
      if (part.length > 0) {
        currentSegments.push({ text: part, run });
      }
      if (partIndex < parts.length - 1) {
        paragraphs.push({ segments: currentSegments, leadRun: currentLeadRun });
        currentSegments = [];
        currentLeadRun = run;
      }
    }
  }
  paragraphs.push({ segments: currentSegments, leadRun: currentLeadRun });

  const draftLines: DraftLine[] = [];
  let truncated = false;

  const pushDraftLine = (line: DraftLine): boolean => {
    if (draftLines.length >= FLA_STATIC_TEXT_LIMITS.maxLinesPerText) {
      truncated = true;
      return false;
    }
    draftLines.push(line);
    return true;
  };

  for (const paragraph of paragraphs) {
    if (truncated) break;
    const lead = paragraph.leadRun;
    const alignment = lead.alignment;
    const leftMargin = Math.max(0, lead.leftMargin ?? 0);
    const rightMargin = Math.max(0, lead.rightMargin ?? 0);
    const indent = lead.indent ?? 0;

    let isFirstLine = true;
    let currentLine: DraftFragment[] = [];
    let currentWidth = 0;

    const lineAvailableWidth = (): number =>
      Math.max(1, descriptor.width - leftMargin - rightMargin - (isFirstLine ? Math.max(0, indent) : 0));

    const flushLine = (): boolean => {
      // Trim trailing whitespace on wrapped lines so right/center alignment stays accurate.
      while (currentLine.length > 0 && currentLine[currentLine.length - 1]!.isWhitespace) {
        currentLine.pop();
      }
      const ok = pushDraftLine({
        fragments: currentLine,
        alignment,
        leftMargin,
        rightMargin,
        firstLineIndent: isFirstLine ? indent : 0,
        fallbackRun: lead,
      });
      currentLine = [];
      currentWidth = 0;
      isFirstLine = false;
      return ok;
    };

    const prepareFragment = (text: string, run: FlaStaticTextRun, isWhitespace: boolean) => {
      const prev = currentLine.at(-1);
      const merge = prev?.run === run && prev.isWhitespace === isWhitespace ? prev : undefined;
      const mergedText = merge ? merge.text + text : text;
      const fragment: DraftFragment = {
        text: mergedText,
        run,
        ...measureFragment(mergedText, run, measure),
        gapBefore: merge ? merge.gapBefore : (prev?.run.letterSpacing ?? 0),
        isWhitespace,
      };
      return {
        width: currentWidth + fragment.width + (merge ? -merge.width : fragment.gapBefore),
        append() {
          if (merge) currentLine.pop();
          currentLine.push(fragment);
          currentWidth += fragment.width + (merge ? -merge.width : fragment.gapBefore);
        },
      };
    };

    if (paragraph.segments.length === 0) {
      pushDraftLine({
        fragments: [],
        alignment,
        leftMargin,
        rightMargin,
        firstLineIndent: indent,
        fallbackRun: lead,
      });
      continue;
    }

    for (const segment of paragraph.segments) {
      if (truncated) break;
      const tokens = tokenizeSegment(segment.text, segment.run);
      for (const token of tokens) {
        if (truncated) break;
        const maxWidth = lineAvailableWidth();
        const tokenMeasure = measureFragment(token.text, token.run, measure);

        if (token.isWhitespace) {
          if (currentLine.length > 0) {
            prepareFragment(token.text, token.run, true).append();
          }
          continue;
        }

        let candidate = prepareFragment(token.text, token.run, false);
        if (currentLine.length > 0 && candidate.width > maxWidth + 0.5) {
          if (!flushLine()) break;
          candidate = prepareFragment(token.text, token.run, false);
        }

        if (tokenMeasure.width > lineAvailableWidth() + 0.5 && !token.isCjk) {
          // Oversized non-CJK word: fall back to grapheme-level wrapping.
          for (const grapheme of splitGraphemes(token.text)) {
            let glyph = prepareFragment(grapheme, token.run, false);
            if (currentLine.length > 0 && glyph.width > lineAvailableWidth() + 0.5) {
              if (!flushLine()) break;
              glyph = prepareFragment(grapheme, token.run, false);
            }
            glyph.append();
          }
          continue;
        }

        candidate.append();
      }
    }

    if (!truncated && (currentLine.length > 0 || isFirstLine)) {
      flushLine();
    }
  }

  // Position lines vertically and horizontally, and compute tight ink bounds.
  const laidOutLines: FlaStaticTextLaidOutLine[] = [];
  let cursorY = 0;
  let maxFontSize = fallbackRun.size;
  let minX = descriptor.left;
  let maxX = descriptor.left + descriptor.width;
  let minY = 0;
  let maxY = descriptor.height;

  for (const draft of draftLines) {
    let lineMaxSize = draft.fallbackRun.size;
    let lineMaxHeight = Math.max(draft.fallbackRun.lineHeight, draft.fallbackRun.size);
    let lineSpacing = draft.fallbackRun.lineSpacing;
    let lineAscent = draft.fallbackRun.size * 0.85;
    let lineDescent = draft.fallbackRun.size * 0.25;
    let totalWidth = 0;

    for (const frag of draft.fragments) {
      if (frag.run.size > lineMaxSize) lineMaxSize = frag.run.size;
      const candidateLineHeight = Math.max(frag.run.lineHeight, frag.run.size);
      if (candidateLineHeight > lineMaxHeight) lineMaxHeight = candidateLineHeight;
      if (frag.run.lineSpacing > lineSpacing) lineSpacing = frag.run.lineSpacing;
      if (frag.ascent > lineAscent) lineAscent = frag.ascent;
      if (frag.descent > lineDescent) lineDescent = frag.descent;
      totalWidth += frag.gapBefore + frag.width;
    }
    if (lineMaxSize > maxFontSize) maxFontSize = lineMaxSize;

    const availWidth = Math.max(
      1,
      descriptor.width - draft.leftMargin - draft.rightMargin - Math.max(0, draft.firstLineIndent),
    );
    let lineStartX = descriptor.left + draft.leftMargin + draft.firstLineIndent;
    if (draft.alignment === 'center') {
      lineStartX = descriptor.left + draft.leftMargin + (availWidth - totalWidth) / 2;
    } else if (draft.alignment === 'right') {
      lineStartX = descriptor.left + descriptor.width - draft.rightMargin - totalWidth;
    }

    const baselineY = cursorY + Math.max(lineAscent, lineMaxHeight * 0.8);
    let cursorX = lineStartX;
    const fragments: FlaStaticTextLaidOutFragment[] = [];
    for (const frag of draft.fragments) {
      cursorX += frag.gapBefore;
      fragments.push({
        text: frag.text,
        run: frag.run,
        x: cursorX,
        width: frag.width,
        ascent: frag.ascent,
        descent: frag.descent,
      });
      if (cursorX < minX) minX = cursorX;
      if (cursorX + frag.width > maxX) maxX = cursorX + frag.width;
      cursorX += frag.width;
    }

    if (baselineY - lineAscent < minY) minY = baselineY - lineAscent;
    if (baselineY + lineDescent > maxY) maxY = baselineY + lineDescent;

    laidOutLines.push({
      baselineY,
      ascent: lineAscent,
      descent: lineDescent,
      width: totalWidth,
      fragments,
    });

    const advance = Math.max(lineMaxSize * 0.5, lineMaxHeight + lineSpacing);
    cursorY += advance;
    if (cursorY > maxY) maxY = cursorY;
  }

  const inkPadX = Math.ceil(maxFontSize * 0.35 + 4);
  const inkPadY = Math.ceil(maxFontSize * 0.35 + 4);
  const bounds: FlaStaticTextBounds = {
    x: minX - inkPadX,
    y: minY - inkPadY,
    width: Math.max(1, maxX - minX + inkPadX * 2),
    height: Math.max(1, maxY - minY + inkPadY * 2),
  };

  return { lines: laidOutLines, bounds, truncated };
}

export function countExplicitStaticTextLines(descriptor: FlaStaticTextDescriptor): number {
  let lines = 1;
  for (const run of descriptor.runs) {
    const normalized = run.characters.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
    for (let i = 0; i < normalized.length; i += 1) {
      if (normalized.charCodeAt(i) === 10) lines += 1;
    }
  }
  return lines;
}

export function hasUnresolvedFlaStaticTextPlaceholder(svg: string): boolean {
  return (
    svg.includes(FLA_STATIC_TEXT_PLACEHOLDER_BASE64) &&
    /<image\b[^>]*\bid=["']fla-text-[a-f0-9]{16,40}["'][^>]*iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=/u.test(svg)
  );
}

export function computeAuthoritativeGraphicViewport(
  framing: FlaStaticTextGraphicFraming,
  measuredBoundsByPlaceholderId: ReadonlyMap<string, FlaStaticTextBounds>,
): {
  readonly viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly outputWidth: number;
  readonly outputHeight: number;
} | null {
  let minX = framing.nonTextBounds ? framing.nonTextBounds.minX : Number.POSITIVE_INFINITY;
  let minY = framing.nonTextBounds ? framing.nonTextBounds.minY : Number.POSITIVE_INFINITY;
  let maxX = framing.nonTextBounds ? framing.nonTextBounds.maxX : Number.NEGATIVE_INFINITY;
  let maxY = framing.nonTextBounds ? framing.nonTextBounds.maxY : Number.NEGATIVE_INFINITY;

  const include = (x: number, y: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    return true;
  };

  for (const entry of framing.textTransforms) {
    const rect = measuredBoundsByPlaceholderId.get(entry.placeholderId);
    if (!rect) return null;
    const m = entry.worldTransform;
    const corners: readonly [number, number][] = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x + rect.width, rect.y + rect.height],
      [rect.x, rect.y + rect.height],
    ];
    for (const [cx, cy] of corners) {
      if (!include(m.a * cx + m.c * cy + m.tx, m.b * cx + m.d * cy + m.ty)) return null;
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth < 0 || rawHeight < 0) {
    return null;
  }
  const filterX = Math.max(0, framing.filterExpansion.x);
  const filterY = Math.max(0, framing.filterExpansion.y);
  const padding = Math.max(0, framing.padding);
  const contentX = minX - filterX;
  const contentY = minY - filterY;
  const contentWidth = Math.max(1, rawWidth + filterX * 2);
  const contentHeight = Math.max(1, rawHeight + filterY * 2);
  const viewBox = {
    x: contentX - padding,
    y: contentY - padding,
    width: contentWidth + padding * 2,
    height: contentHeight + padding * 2,
  };
  if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height].every(Number.isFinite) ||
      viewBox.width <= 0 || viewBox.height <= 0) {
    return null;
  }

  const size = computeBoundedFlaGraphicOutputSize(viewBox.width, viewBox.height);
  return size ? { viewBox, ...size } : null;
}

export function isValidFlaStaticTextGraphicFraming(value: unknown): value is FlaStaticTextGraphicFraming {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.nonTextBounds !== null) {
    if (typeof candidate.nonTextBounds !== 'object' || candidate.nonTextBounds === null) return false;
    const b = candidate.nonTextBounds as Record<string, unknown>;
    if (![b.minX, b.minY, b.maxX, b.maxY].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return false;
    }
  }
  if (
    !Array.isArray(candidate.textTransforms) ||
    candidate.textTransforms.length > FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition
  ) {
    return false;
  }
  for (const item of candidate.textTransforms) {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as Record<string, unknown>;
    if (typeof entry.placeholderId !== 'string' || !/^fla-text-[a-f0-9]{16,40}$/u.test(entry.placeholderId)) {
      return false;
    }
    if (typeof entry.worldTransform !== 'object' || entry.worldTransform === null) return false;
    const m = entry.worldTransform as Record<string, unknown>;
    if (![m.a, m.b, m.c, m.d, m.tx, m.ty].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return false;
    }
  }
  if (typeof candidate.filterExpansion !== 'object' || candidate.filterExpansion === null) return false;
  const f = candidate.filterExpansion as Record<string, unknown>;
  if (
    typeof f.x !== 'number' || !Number.isFinite(f.x) || f.x < 0 || f.x > 4_096 ||
    typeof f.y !== 'number' || !Number.isFinite(f.y) || f.y < 0 || f.y > 4_096 ||
    typeof candidate.padding !== 'number' || !Number.isFinite(candidate.padding) || candidate.padding < 0 || candidate.padding > 256
  ) {
    return false;
  }
  return true;
}

/** Strict runtime validator for preload/renderer IPC boundary. */
export function isValidFlaStaticTextRenderItem(value: unknown): value is FlaStaticTextRenderItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.placeholderId !== 'string' || !/^fla-text-[a-f0-9]{16,40}$/u.test(item.placeholderId)) {
    return false;
  }
  if (typeof item.scaleHint !== 'number' || !Number.isFinite(item.scaleHint) || item.scaleHint < 1 || item.scaleHint > 4) {
    return false;
  }
  if (typeof item.descriptor !== 'object' || item.descriptor === null) return false;
  const desc = item.descriptor as Record<string, unknown>;
  if (
    typeof desc.left !== 'number' || !Number.isFinite(desc.left) || Math.abs(desc.left) > FLA_STATIC_TEXT_LIMITS.maxBoxDimension ||
    typeof desc.width !== 'number' || !Number.isFinite(desc.width) || desc.width <= 0 || desc.width > FLA_STATIC_TEXT_LIMITS.maxBoxDimension ||
    typeof desc.height !== 'number' || !Number.isFinite(desc.height) || desc.height <= 0 || desc.height > FLA_STATIC_TEXT_LIMITS.maxBoxDimension
  ) {
    return false;
  }
  if (!Array.isArray(desc.runs) || desc.runs.length > FLA_STATIC_TEXT_LIMITS.maxRunsPerText) {
    return false;
  }
  let totalChars = 0;
  for (const rawRun of desc.runs) {
    if (typeof rawRun !== 'object' || rawRun === null) return false;
    const run = rawRun as Record<string, unknown>;
    if (typeof run.characters !== 'string') return false;
    totalChars += run.characters.length;
    if (totalChars > FLA_STATIC_TEXT_LIMITS.maxCharsPerText) return false;
    if (run.alignment !== 'left' && run.alignment !== 'center' && run.alignment !== 'right' && run.alignment !== 'justify') {
      return false;
    }
    if (
      typeof run.size !== 'number' || !Number.isFinite(run.size) || run.size < FLA_STATIC_TEXT_LIMITS.minFontSize || run.size > FLA_STATIC_TEXT_LIMITS.maxFontSize ||
      typeof run.lineHeight !== 'number' || !Number.isFinite(run.lineHeight) || run.lineHeight <= 0 || run.lineHeight > FLA_STATIC_TEXT_LIMITS.maxLineHeight ||
      typeof run.lineSpacing !== 'number' || !Number.isFinite(run.lineSpacing) || Math.abs(run.lineSpacing) > FLA_STATIC_TEXT_LIMITS.maxLineSpacing ||
      typeof run.letterSpacing !== 'number' || !Number.isFinite(run.letterSpacing) || Math.abs(run.letterSpacing) > FLA_STATIC_TEXT_LIMITS.maxLetterSpacing ||
      typeof run.fillColor !== 'string' || !/^#[0-9a-f]{6}$/iu.test(run.fillColor) ||
      typeof run.alpha !== 'number' || !Number.isFinite(run.alpha) || run.alpha < 0 || run.alpha > 1 ||
      typeof run.bold !== 'boolean' || typeof run.italic !== 'boolean'
    ) {
      return false;
    }
    if (run.face !== undefined && (typeof run.face !== 'string' || run.face.length > FLA_STATIC_TEXT_LIMITS.maxFontFaceLength)) {
      return false;
    }
    if (run.underline !== undefined && typeof run.underline !== 'boolean') return false;
    for (const opt of [run.leftMargin, run.rightMargin, run.indent]) {
      if (opt !== undefined && (typeof opt !== 'number' || !Number.isFinite(opt) || Math.abs(opt) > FLA_STATIC_TEXT_LIMITS.maxBoxDimension)) {
        return false;
      }
    }
  }
  return true;
}
