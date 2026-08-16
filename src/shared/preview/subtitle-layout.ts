import type { SubtitleStyle } from '../../domain';
import { STAGE_CAPTION_SAFE_AREA } from '../stage/layout';

export interface SubtitleLayout {
  text: string;
  lines: readonly string[];
  lineCount: number;
  truncated: boolean;
  warning: string | null;
  width: number;
  height: number;
  fontSize: number;
}

const DEFAULT_FONT_SIZE = 44;
const DEFAULT_TEXT_COLOR = '#fffdf6';
const DEFAULT_BACKGROUND_COLOR = 'rgba(10, 20, 17, 0.78)';

export const DEFAULT_SUBTITLE_STYLE = {
  fontFamily: 'Microsoft YaHei, Segoe UI, sans-serif',
  fontSize: DEFAULT_FONT_SIZE,
  textColor: DEFAULT_TEXT_COLOR,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  strokeColor: undefined as string | undefined,
  strokeWidth: 0,
  position: 'bottom' as const,
  align: 'center' as const,
  maxWidth: STAGE_CAPTION_SAFE_AREA.width,
};

function characterUnits(character: string): number {
  return (character.codePointAt(0) ?? 0) <= 0xff ? 0.58 : 1;
}

function wrapLine(line: string, maxUnits: number): string[] {
  const result: string[] = [];
  let current = '';
  let currentUnits = 0;
  for (const character of Array.from(line)) {
    const nextUnits = currentUnits + characterUnits(character);
    if (current && nextUnits > maxUnits) {
      result.push(current.trimEnd());
      current = character;
      currentUnits = characterUnits(character);
    } else {
      current += character;
      currentUnits = nextUnits;
    }
  }
  if (current.trim().length > 0 || line.length === 0) {
    result.push(current.trimEnd());
  }
  return result;
}

function truncateSecondLine(line: string, maxUnits: number): string {
  const ellipsis = '…';
  let result = '';
  let width = 0;
  for (const character of Array.from(line)) {
    const next = width + characterUnits(character);
    if (next + characterUnits(ellipsis) > maxUnits) break;
    result += character;
    width = next;
  }
  return `${result.trimEnd()}${ellipsis}`;
}

/**
 * Deterministic, renderer-independent subtitle wrapping. The product safe
 * area is deliberately narrower than the full stage and never emits more than
 * two lines. A long cue is visibly shortened and carries a warning for the
 * editor instead of overflowing the stage or silently changing the contract.
 */
export function layoutSubtitleText(
  rawText: string,
  style: Pick<SubtitleStyle, 'fontSize' | 'maxWidth'> = DEFAULT_SUBTITLE_STYLE,
): SubtitleLayout {
  const fontSize = Number.isInteger(style.fontSize) && style.fontSize > 0
    ? style.fontSize
    : DEFAULT_FONT_SIZE;
  const width = Math.max(
    240,
    Math.min(
      STAGE_CAPTION_SAFE_AREA.width - STAGE_CAPTION_SAFE_AREA.horizontalPadding * 2,
      style.maxWidth,
    ),
  );
  const maxUnits = Math.max(8, width / fontSize);
  const normalized = rawText.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) {
    return {
      text: '',
      lines: [],
      lineCount: 0,
      truncated: false,
      warning: null,
      width,
      height: STAGE_CAPTION_SAFE_AREA.height,
      fontSize,
    };
  }

  const wrapped = normalized
    .split('\n')
    .flatMap((line) => wrapLine(line, maxUnits));
  let lines = wrapped.slice(0, 2);
  const truncated = wrapped.length > 2;
  if (truncated && lines.length === 2) {
    lines = [lines[0]!, truncateSecondLine(lines[1]!, maxUnits)];
  }
  const text = lines.join('\n');
  return {
    text,
    lines,
    lineCount: lines.length,
    truncated,
    warning: truncated
      ? '字幕超过安全区两行，已截断；请在对白编辑器中缩短文本。'
      : null,
    width,
    height: STAGE_CAPTION_SAFE_AREA.height,
    fontSize,
  };
}

export function subtitleStyleOrDefault(
  style: SubtitleStyle | undefined,
): SubtitleStyle | typeof DEFAULT_SUBTITLE_STYLE {
  return style ?? DEFAULT_SUBTITLE_STYLE;
}
