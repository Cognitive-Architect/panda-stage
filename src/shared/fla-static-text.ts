/**
 * Bounded classic FLA static text model, offline font fallback sanitizer,
 * and Unicode/CJK-aware multi-run horizontal text layout engine.
 *
 * Cross-checked against Animate XFL DOMStaticText/DOMTextRun public semantics
 * and lifeart/fla-viewer@b14fa1d1 (src/fla-parser.ts, src/renderer.ts), with
 * independent CJK/Unicode grapheme-safe wrapping and zero DOM/network access.
 */

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
  return { width: Math.max(0, width), ascent, descent };
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

    const appendMeasured = (text: string, run: FlaStaticTextRun, isWhitespace: boolean): void => {
      const m = measureFragment(text, run, measure);
      const prev = currentLine[currentLine.length - 1];
      const spacingGap =
        prev && prev.run === run && run.letterSpacing !== 0 && !isWhitespace && !prev.isWhitespace
          ? run.letterSpacing
          : 0;
      if (prev && prev.run === run && prev.isWhitespace === isWhitespace) {
        const mergedText = prev.text + text;
        const mergedMeasure = measureFragment(mergedText, run, measure);
        currentWidth = currentWidth - prev.width + mergedMeasure.width;
        prev.text = mergedText;
        prev.width = mergedMeasure.width;
        prev.ascent = Math.max(prev.ascent, mergedMeasure.ascent);
        prev.descent = Math.max(prev.descent, mergedMeasure.descent);
      } else {
        currentLine.push({
          text,
          run,
          width: m.width,
          ascent: m.ascent,
          descent: m.descent,
          isWhitespace,
        });
        currentWidth += spacingGap + m.width;
      }
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
            appendMeasured(token.text, token.run, true);
          }
          continue;
        }

        if (currentLine.length > 0 && currentWidth + tokenMeasure.width > maxWidth + 0.5) {
          if (!flushLine()) break;
        }

        const freshMaxWidth = lineAvailableWidth();
        if (tokenMeasure.width > freshMaxWidth + 0.5 && !token.isCjk) {
          // Oversized non-CJK word: fall back to grapheme-level wrapping.
          for (const grapheme of splitGraphemes(token.text)) {
            const gm = measureFragment(grapheme, token.run, measure);
            if (currentLine.length > 0 && currentWidth + gm.width > lineAvailableWidth() + 0.5) {
              if (!flushLine()) break;
            }
            appendMeasured(grapheme, token.run, false);
          }
          continue;
        }

        appendMeasured(token.text, token.run, false);
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
      totalWidth += frag.width;
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
