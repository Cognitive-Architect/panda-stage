/**
 * AUTO-06 performance directives: the optional `表演：` section that says
 * exactly which scripted dialogue a stock ActionPreset must be anchored to.
 *
 * This module is pure data + parsing. It never reads a Project, never creates a
 * TimelineEvent, and never guesses an emotion from prose. The caller
 * (`parseMultiSceneInput`) owns error throwing, so the two parsers stay
 * dependency-free of each other.
 */
import type { ActionPresetId } from '../actions/ActionPreset';

export const PERFORMANCE_FIELD = '表演';

export type PerformanceAction =
  | 'left-enter'
  | 'right-enter'
  | 'move'
  | 'scale'
  | 'shake'
  | 'expression'
  | 'fade-in'
  | 'fade-out';

interface DirectiveBase {
  /** 1-based Dialogue ordinal across the whole script (AUTO-05 contract). */
  readonly dialogueOrdinal: number;
  /** 1-based line in the raw paste, for in-place refusal copy. */
  readonly sourceLine: number;
  readonly blockIndex: number;
}

export type PerformanceDirective =
  | (DirectiveBase & {
      readonly action:
        | 'left-enter'
        | 'right-enter'
        | 'shake'
        | 'fade-in'
        | 'fade-out';
    })
  | (DirectiveBase & {
      readonly action: 'move';
      readonly targetX: number;
      readonly targetY: number;
    })
  | (DirectiveBase & {
      readonly action: 'scale';
      readonly scaleFactor: number;
    })
  | (DirectiveBase & {
      readonly action: 'expression';
      readonly expressionName: string;
    });

export const PERFORMANCE_PRESET_IDS: Readonly<
  Record<PerformanceAction, ActionPresetId>
> = {
  'left-enter': 'enter-left',
  'right-enter': 'enter-right',
  move: 'move-to',
  scale: 'scale-emphasis',
  shake: 'shake',
  expression: 'expression-switch',
  'fade-in': 'fade-in',
  'fade-out': 'fade-out',
};

export const PERFORMANCE_ACTION_LABELS: Readonly<
  Record<PerformanceAction, string>
> = {
  'left-enter': '左入场',
  'right-enter': '右入场',
  move: '移动',
  scale: '放大',
  shake: '抖动',
  expression: '表情',
  'fade-in': '淡入',
  'fade-out': '淡出',
};

const ACTION_BY_LABEL: Readonly<Record<string, PerformanceAction>> = {
  左入场: 'left-enter',
  右入场: 'right-enter',
  移动: 'move',
  放大: 'scale',
  抖动: 'shake',
  表情: 'expression',
  淡入: 'fade-in',
  淡出: 'fade-out',
};

export type PerformanceInputErrorCode =
  | 'PERFORMANCE_MALFORMED'
  | 'PERFORMANCE_UNKNOWN_ACTION'
  | 'PERFORMANCE_MISSING_PARAM'
  | 'PERFORMANCE_EXTRA_PARAM'
  | 'PERFORMANCE_INVALID_NUMBER'
  | 'PERFORMANCE_INVALID_SCALE'
  | 'PERFORMANCE_EMPTY_EXPRESSION'
  | 'PERFORMANCE_ORDINAL_UNKNOWN'
  | 'PERFORMANCE_SECTION_INVALID'
  | 'DUPLICATE_PERFORMANCE_SECTION';

export interface PerformanceParseError {
  readonly code: PerformanceInputErrorCode;
  readonly message: string;
  readonly lineNumber: number;
}

export type PerformanceParseResult =
  | { readonly ok: true; readonly directives: readonly PerformanceDirective[] }
  | { readonly ok: false; readonly error: PerformanceParseError };

export interface PerformanceSourceLine {
  readonly lineNumber: number;
  readonly text: string;
}

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const MOVE_PARAM_PATTERN = /^(x|y)=(.+)$/u;

function finiteNumber(raw: string): number | null {
  if (!NUMBER_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseOrdinal(raw: string): number | null {
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function moveParams(
  rest: readonly string[],
  lineNumber: number,
):
  | { readonly ok: true; readonly x: number; readonly y: number }
  | { readonly ok: false; readonly error: PerformanceParseError } {
  if (rest.length < 2) {
    return {
      ok: false,
      error: {
        code: 'PERFORMANCE_MISSING_PARAM',
        message: `第 ${lineNumber} 行「移动」需要 x=数字｜y=数字 两个参数。`,
        lineNumber,
      },
    };
  }
  if (rest.length > 2) {
    return {
      ok: false,
      error: {
        code: 'PERFORMANCE_EXTRA_PARAM',
        message: `第 ${lineNumber} 行「移动」只接受 x 与 y 两个参数。`,
        lineNumber,
      },
    };
  }
  const values: Record<string, number> = {};
  for (const token of rest) {
    const match = MOVE_PARAM_PATTERN.exec(token);
    if (!match || (match[1] as string) in values) {
      return {
        ok: false,
        error: {
          code: match ? 'PERFORMANCE_EXTRA_PARAM' : 'PERFORMANCE_INVALID_NUMBER',
          message: match
            ? `第 ${lineNumber} 行「移动」的参数「${match[1]}」重复了。`
            : `第 ${lineNumber} 行「移动」的参数「${token}」不是 x=数字 或 y=数字。`,
          lineNumber,
        },
      };
    }
    const value = finiteNumber((match[2] as string).trim());
    if (value === null) {
      return {
        ok: false,
        error: {
          code: 'PERFORMANCE_INVALID_NUMBER',
          message: `第 ${lineNumber} 行「移动」的「${token}」不是有限数字。`,
          lineNumber,
        },
      };
    }
    values[match[1] as string] = value;
  }
  if (values.x === undefined || values.y === undefined) {
    return {
      ok: false,
      error: {
        code: 'PERFORMANCE_MISSING_PARAM',
        message: `第 ${lineNumber} 行「移动」必须同时给出 x 与 y。`,
        lineNumber,
      },
    };
  }
  return { ok: true, x: values.x, y: values.y };
}

/** Parse every `序号｜动作｜参数` line of one block's performance section. */
export function parsePerformanceLines(
  entries: readonly PerformanceSourceLine[],
  blockIndex: number,
): PerformanceParseResult {
  const directives: PerformanceDirective[] = [];
  for (const { lineNumber, text } of entries) {
    const parts = text
      .replace(/｜/gu, '|')
      .split('|')
      .map((part) => part.trim());
    if (
      parts.length < 2 ||
      (parts[0] as string).length === 0 ||
      (parts[1] as string).length === 0
    ) {
      return {
        ok: false,
        error: {
          code: 'PERFORMANCE_MALFORMED',
          message: `第 ${lineNumber} 行表演指令必须是「全剧本序号｜动作｜参数」。`,
          lineNumber,
        },
      };
    }
    const ordinal = parseOrdinal(parts[0] as string);
    if (ordinal === null) {
      return {
        ok: false,
        error: {
          code: 'PERFORMANCE_MALFORMED',
          message: `第 ${lineNumber} 行的第一列必须是正整数全剧本对白序号。`,
          lineNumber,
        },
      };
    }
    const action = ACTION_BY_LABEL[parts[1] as string];
    if (!action) {
      return {
        ok: false,
        error: {
          code: 'PERFORMANCE_UNKNOWN_ACTION',
          message: `第 ${lineNumber} 行的动作「${parts[1]}」不支持。`,
          lineNumber,
        },
      };
    }
    const rest = parts.slice(2);
    const base = { dialogueOrdinal: ordinal, sourceLine: lineNumber, blockIndex };

    if (action === 'move') {
      const params = moveParams(rest, lineNumber);
      if (!params.ok) return params;
      directives.push({
        ...base,
        action,
        targetX: params.x,
        targetY: params.y,
      });
      continue;
    }
    if (action === 'scale') {
      if (rest.length < 1) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_MISSING_PARAM',
            message: `第 ${lineNumber} 行「放大」需要一个大于 0 的倍数。`,
            lineNumber,
          },
        };
      }
      if (rest.length > 1) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_EXTRA_PARAM',
            message: `第 ${lineNumber} 行「放大」只接受一个倍数。`,
            lineNumber,
          },
        };
      }
      const factor = finiteNumber(rest[0] as string);
      if (factor === null) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_INVALID_NUMBER',
            message: `第 ${lineNumber} 行「放大」的「${rest[0]}」不是有限数字。`,
            lineNumber,
          },
        };
      }
      if (factor <= 0) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_INVALID_SCALE',
            message: `第 ${lineNumber} 行「放大」的倍数必须大于 0。`,
            lineNumber,
          },
        };
      }
      directives.push({ ...base, action, scaleFactor: factor });
      continue;
    }
    if (action === 'expression') {
      if (rest.length < 1) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_MISSING_PARAM',
            message: `第 ${lineNumber} 行「表情」需要一个表情名称。`,
            lineNumber,
          },
        };
      }
      if (rest.length > 1) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_EXTRA_PARAM',
            message: `第 ${lineNumber} 行「表情」只接受一个名称。`,
            lineNumber,
          },
        };
      }
      const name = (rest[0] as string).trim();
      if (!name) {
        return {
          ok: false,
          error: {
            code: 'PERFORMANCE_EMPTY_EXPRESSION',
            message: `第 ${lineNumber} 行「表情」的名称不能为空。`,
            lineNumber,
          },
        };
      }
      directives.push({ ...base, action, expressionName: name });
      continue;
    }

    if (rest.length > 0) {
      return {
        ok: false,
        error: {
          code: 'PERFORMANCE_EXTRA_PARAM',
          message: `第 ${lineNumber} 行「${parts[1]}」不接受参数。`,
          lineNumber,
        },
      };
    }
    directives.push({ ...base, action });
  }
  return { ok: true, directives };
}
