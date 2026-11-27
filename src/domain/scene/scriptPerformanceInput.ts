import type { ActionPresetId } from '../actions/ActionPreset';
import {
  DIALOGUE_SPEAKER_CHARACTER,
  DIALOGUE_SPEAKER_NARRATOR,
  type Character,
  type DialogueSpeakerType,
} from '../models';
import {
  parseStructuredSceneBlocks,
  type ParseStructuredSceneOptions,
  type SceneDraftBlock,
  type SceneParseIssue,
} from './sceneInput';

export const SCRIPT_DIALOGUE_SECTION = '对白';
export const SCRIPT_PERFORMANCE_SECTION = '表演';
export const SCRIPT_NARRATOR_KEYWORD = '旁白';

export type BasicPerformanceAction =
  | 'left-enter'
  | 'right-enter'
  | 'move'
  | 'scale'
  | 'shake'
  | 'expression'
  | 'fade-in'
  | 'fade-out';

export type PerformanceDirectiveAction =
  | BasicPerformanceAction
  | 'character-action'
  | 'action-recipe';

export type PerformanceTimeAnchor = 'start' | 'end';

export const BASIC_PERFORMANCE_PRESET_IDS: Readonly<
  Record<BasicPerformanceAction, ActionPresetId>
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
  Record<PerformanceDirectiveAction, string>
> = {
  'left-enter': '左入场',
  'right-enter': '右入场',
  move: '移动',
  scale: '放大',
  shake: '抖动',
  expression: '表情',
  'fade-in': '淡入',
  'fade-out': '淡出',
  'character-action': '角色动作',
  'action-recipe': '配方',
};

const ACTION_BY_LABEL: Readonly<Record<string, PerformanceDirectiveAction>> = {
  左入场: 'left-enter',
  右入场: 'right-enter',
  移动: 'move',
  放大: 'scale',
  放大强调: 'scale',
  抖动: 'shake',
  表情: 'expression',
  表情切换: 'expression',
  淡入: 'fade-in',
  淡出: 'fade-out',
  角色动作: 'character-action',
  动作: 'character-action',
  配方: 'action-recipe',
  操作配方: 'action-recipe',
};

export type ScriptDialogueParseIssueCode =
  | 'DIALOGUE_MALFORMED'
  | 'DIALOGUE_EMPTY_SPEAKER'
  | 'DIALOGUE_EMPTY_TEXT'
  | 'DIALOGUE_UNKNOWN_SPEAKER'
  | 'DIALOGUE_AMBIGUOUS_SPEAKER';

export interface ScriptDialogueDraftLine {
  /** 1-based global dialogue ordinal across the entire script. */
  readonly ordinal: number;
  /** 1-based scene block index. */
  readonly blockIndex: number;
  /** 0-based index within the block's dialogue section. */
  readonly lineIndexInBlock: number;
  readonly sourceLineNumber: number;
  readonly raw: string;
  readonly speakerName: string;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly parseIssue?: {
    readonly code: ScriptDialogueParseIssueCode;
    readonly message: string;
  };
}

export type PerformanceParseIssueCode =
  | 'PERFORMANCE_MALFORMED'
  | 'PERFORMANCE_UNKNOWN_ACTION'
  | 'PERFORMANCE_MISSING_PARAM'
  | 'PERFORMANCE_EXTRA_PARAM'
  | 'PERFORMANCE_INVALID_NUMBER'
  | 'PERFORMANCE_INVALID_SCALE'
  | 'PERFORMANCE_EMPTY_TARGET'
  | 'PERFORMANCE_INVALID_TIMING';

export interface ParsedPerformanceDirective {
  /** Stable deterministic directive identifier for per-row UI/CLI overrides. */
  readonly directiveId: string;
  readonly blockIndex: number;
  readonly sourceLineNumber: number;
  readonly raw: string;
  /** 1-based global dialogue ordinal (null if malformed before ordinal). */
  readonly dialogueOrdinal: number | null;
  readonly actionLabel: string;
  readonly action: PerformanceDirectiveAction | null;
  readonly anchor: PerformanceTimeAnchor;
  readonly offsetMs: number;
  readonly durationMs?: number;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly scaleFactor?: number;
  readonly amplitudeX?: number;
  readonly amplitudeY?: number;
  readonly frequencyHz?: number;
  readonly expressionName?: string;
  readonly characterActionName?: string;
  readonly recipeName?: string;
  readonly parseIssue?: {
    readonly code: PerformanceParseIssueCode;
    readonly message: string;
  };
}

export interface ParsedScriptBlock {
  readonly scene: SceneDraftBlock;
  readonly dialogues: readonly ScriptDialogueDraftLine[];
  readonly performances: readonly ParsedPerformanceDirective[];
}

export interface ParseScriptPerformanceResult {
  readonly ok: boolean;
  readonly blocks: readonly ParsedScriptBlock[];
  readonly sceneBlocks: readonly SceneDraftBlock[];
  readonly dialogues: readonly ScriptDialogueDraftLine[];
  readonly performances: readonly ParsedPerformanceDirective[];
  readonly sceneParseIssues: readonly SceneParseIssue[];
  readonly hasDialogueOrPerformance: boolean;
}

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u;

function findFirstColon(line: string): number {
  const full = line.indexOf('：');
  const ascii = line.indexOf(':');
  if (full < 0) return ascii;
  if (ascii < 0) return full;
  return Math.min(full, ascii);
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!NUMBER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseSignedMs(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const msMatch = /^([+-]?\d+(?:\.\d+)?)\s*(?:ms|毫秒)?$/u.exec(trimmed);
  if (msMatch) {
    const value = Math.round(Number(msMatch[1]));
    return Number.isSafeInteger(value) ? value : null;
  }
  const secMatch = /^([+-]?\d+(?:\.\d+)?)\s*(?:s|sec|秒)$/u.exec(trimmed);
  if (secMatch) {
    const value = Math.round(Number(secMatch[1]) * 1_000);
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

function parsePositiveDurationMs(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const msMatch = /^(\d+(?:\.\d+)?)\s*(?:ms|毫秒)$/u.exec(trimmed);
  if (msMatch) {
    const value = Math.round(Number(msMatch[1]));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const secMatch = /^(\d+(?:\.\d+)?)\s*(?:s|sec|秒)$/u.exec(trimmed);
  if (secMatch) {
    const value = Math.round(Number(secMatch[1]) * 1_000);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const plain = /^(\d+(?:\.\d+)?)$/u.exec(trimmed);
  if (plain) {
    const num = Number(plain[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    const value = Math.round(num);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}

function parseDialogueSectionLine(
  line: { readonly lineNumber: number; readonly text: string },
  ordinal: number,
  blockIndex: number,
  lineIndexInBlock: number,
  characters: readonly Character[],
): ScriptDialogueDraftLine {
  const trimmed = line.text.trim();
  const colonIndex = findFirstColon(trimmed);
  if (colonIndex < 0) {
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName: '',
      text: '',
      speakerType: DIALOGUE_SPEAKER_CHARACTER,
      parseIssue: {
        code: 'DIALOGUE_MALFORMED',
        message: `第 ${line.lineNumber} 行对白格式应为「角色名：台词」。`,
      },
    };
  }

  const speakerName = trimmed.slice(0, colonIndex).trim();
  const text = trimmed.slice(colonIndex + 1).trim();
  if (!speakerName) {
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName: '',
      text,
      speakerType: DIALOGUE_SPEAKER_CHARACTER,
      parseIssue: {
        code: 'DIALOGUE_EMPTY_SPEAKER',
        message: `第 ${line.lineNumber} 行对白缺少说话人。`,
      },
    };
  }
  if (!text) {
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName,
      text: '',
      speakerType: DIALOGUE_SPEAKER_CHARACTER,
      parseIssue: {
        code: 'DIALOGUE_EMPTY_TEXT',
        message: `第 ${line.lineNumber} 行「${speakerName}」的台词内容为空。`,
      },
    };
  }

  const key = normalizeName(speakerName);
  const matches = characters.filter(
    (character) => normalizeName(character.name) === key,
  );
  if (key === normalizeName(SCRIPT_NARRATOR_KEYWORD)) {
    if (matches.length > 0) {
      return {
        ordinal,
        blockIndex,
        lineIndexInBlock,
        sourceLineNumber: line.lineNumber,
        raw: trimmed,
        speakerName,
        text,
        speakerType: DIALOGUE_SPEAKER_NARRATOR,
        parseIssue: {
          code: 'DIALOGUE_AMBIGUOUS_SPEAKER',
          message: `第 ${line.lineNumber} 行「旁白」与工程角色重名，请明确区分。`,
        },
      };
    }
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName,
      text,
      speakerType: DIALOGUE_SPEAKER_NARRATOR,
    };
  }

  if (matches.length === 0) {
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName,
      text,
      speakerType: DIALOGUE_SPEAKER_CHARACTER,
      parseIssue: {
        code: 'DIALOGUE_UNKNOWN_SPEAKER',
        message: `第 ${line.lineNumber} 行角色「${speakerName}」未在工程角色库中找到。`,
      },
    };
  }

  if (matches.length > 1) {
    return {
      ordinal,
      blockIndex,
      lineIndexInBlock,
      sourceLineNumber: line.lineNumber,
      raw: trimmed,
      speakerName,
      text,
      speakerType: DIALOGUE_SPEAKER_CHARACTER,
      parseIssue: {
        code: 'DIALOGUE_AMBIGUOUS_SPEAKER',
        message: `第 ${line.lineNumber} 行角色「${speakerName}」匹配到多个同名角色。`,
      },
    };
  }

  return {
    ordinal,
    blockIndex,
    lineIndexInBlock,
    sourceLineNumber: line.lineNumber,
    raw: trimmed,
    speakerName: matches[0]!.name,
    text,
    speakerType: DIALOGUE_SPEAKER_CHARACTER,
    characterId: matches[0]!.id,
  };
}

function parsePerformanceDirectiveLine(
  line: { readonly lineNumber: number; readonly text: string },
  blockIndex: number,
  directiveIndex: number,
): ParsedPerformanceDirective {
  const directiveId = `perf-b${blockIndex}-l${line.lineNumber}-${directiveIndex}`;
  const raw = line.text.trim();
  const parts = raw
    .replace(/｜/gu, '|')
    .split('|')
    .map((part) => part.trim());

  const makeIssue = (
    code: PerformanceParseIssueCode,
    message: string,
    dialogueOrdinal: number | null = null,
    actionLabel = parts[1] ?? '',
    action: PerformanceDirectiveAction | null = null,
  ): ParsedPerformanceDirective => ({
    directiveId,
    blockIndex,
    sourceLineNumber: line.lineNumber,
    raw,
    dialogueOrdinal,
    actionLabel,
    action,
    anchor: 'start',
    offsetMs: 0,
    parseIssue: { code, message },
  });

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return makeIssue(
      'PERFORMANCE_MALFORMED',
      `第 ${line.lineNumber} 行表演指令格式应为「对白序号｜动作｜参数」。`,
    );
  }

  if (!/^\d+$/u.test(parts[0])) {
    return makeIssue(
      'PERFORMANCE_MALFORMED',
      `第 ${line.lineNumber} 行表演指令第一列必须是正整数对白序号。`,
    );
  }
  const dialogueOrdinal = Number(parts[0]);
  if (!Number.isSafeInteger(dialogueOrdinal) || dialogueOrdinal < 1) {
    return makeIssue(
      'PERFORMANCE_MALFORMED',
      `第 ${line.lineNumber} 行对白序号「${parts[0]}」无效。`,
    );
  }

  const actionLabel = parts[1];
  const action = ACTION_BY_LABEL[actionLabel] ?? null;
  if (!action) {
    return makeIssue(
      'PERFORMANCE_UNKNOWN_ACTION',
      `第 ${line.lineNumber} 行动作「${actionLabel}」不受支持。`,
      dialogueOrdinal,
      actionLabel,
      null,
    );
  }

  // Extract optional common timing modifiers (anchor / offset / duration)
  // while leaving action-specific tokens in `actionTokens`.
  let anchor: PerformanceTimeAnchor = 'start';
  let offsetMs = 0;
  let durationMs: number | undefined;
  const actionTokens: string[] = [];

  for (const token of parts.slice(2)) {
    if (!token) continue;
    const eqIndex = token.indexOf('=');
    if (eqIndex > 0) {
      const key = token.slice(0, eqIndex).trim().toLowerCase();
      const val = token.slice(eqIndex + 1).trim();
      if (key === '锚点' || key === 'anchor') {
        if (val === '起点' || val === '开头' || val.toLowerCase() === 'start') {
          anchor = 'start';
          continue;
        }
        if (val === '结尾' || val === '结束' || val.toLowerCase() === 'end') {
          anchor = 'end';
          continue;
        }
        return makeIssue(
          'PERFORMANCE_INVALID_TIMING',
          `第 ${line.lineNumber} 行锚点「${val}」无效，请使用「起点」或「结尾」。`,
          dialogueOrdinal,
          actionLabel,
          action,
        );
      }
      if (key === '偏移' || key === 'offset') {
        const parsedOffset = parseSignedMs(val);
        if (parsedOffset === null) {
          return makeIssue(
            'PERFORMANCE_INVALID_TIMING',
            `第 ${line.lineNumber} 行偏移「${val}」无效，请输入整数毫秒（如 +200ms 或 200）。`,
            dialogueOrdinal,
            actionLabel,
            action,
          );
        }
        offsetMs = parsedOffset;
        continue;
      }
      if (key === '时长' || key === 'duration') {
        const parsedDuration = parsePositiveDurationMs(val);
        if (parsedDuration === null) {
          return makeIssue(
            'PERFORMANCE_INVALID_TIMING',
            `第 ${line.lineNumber} 行时长「${val}」无效，请输入正整数毫秒（如 600ms 或 0.6s）。`,
            dialogueOrdinal,
            actionLabel,
            action,
          );
        }
        durationMs = parsedDuration;
        continue;
      }
    } else if (token === '结尾' || token === '结束' || token.toLowerCase() === 'end') {
      anchor = 'end';
      continue;
    } else if (token === '起点' || token === '开头' || token.toLowerCase() === 'start') {
      anchor = 'start';
      continue;
    } else if (/^[+-]\d+(?:\.\d+)?\s*(?:ms|毫秒|s|sec|秒)$/iu.test(token)) {
      const parsedOffset = parseSignedMs(token);
      if (parsedOffset !== null) {
        offsetMs = parsedOffset;
        continue;
      }
    }
    actionTokens.push(token);
  }

  const base: ParsedPerformanceDirective = {
    directiveId,
    blockIndex,
    sourceLineNumber: line.lineNumber,
    raw,
    dialogueOrdinal,
    actionLabel: PERFORMANCE_ACTION_LABELS[action],
    action,
    anchor,
    offsetMs,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };

  if (action === 'move') {
    if (actionTokens.length < 2) {
      return makeIssue(
        'PERFORMANCE_MISSING_PARAM',
        `第 ${line.lineNumber} 行「移动」需要 x=数字｜y=数字 两个参数。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    if (actionTokens.length > 2) {
      return makeIssue(
        'PERFORMANCE_EXTRA_PARAM',
        `第 ${line.lineNumber} 行「移动」只接受 x 与 y 两个坐标参数。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    let targetX: number | undefined;
    let targetY: number | undefined;
    for (const token of actionTokens) {
      const match = /^(x|y)\s*=\s*(.+)$/iu.exec(token);
      if (!match) {
        return makeIssue(
          'PERFORMANCE_INVALID_NUMBER',
          `第 ${line.lineNumber} 行「移动」参数「${token}」格式应为 x=数字 或 y=数字。`,
          dialogueOrdinal,
          actionLabel,
          action,
        );
      }
      const axis = match[1]!.toLowerCase();
      const num = parseFiniteNumber(match[2]!);
      if (num === null) {
        return makeIssue(
          'PERFORMANCE_INVALID_NUMBER',
          `第 ${line.lineNumber} 行「移动」参数「${token}」不是有效数字。`,
          dialogueOrdinal,
          actionLabel,
          action,
        );
      }
      if (axis === 'x') {
        if (targetX !== undefined) {
          return makeIssue(
            'PERFORMANCE_EXTRA_PARAM',
            `第 ${line.lineNumber} 行「移动」重复指定了 x。`,
            dialogueOrdinal,
            actionLabel,
            action,
          );
        }
        targetX = num;
      } else {
        if (targetY !== undefined) {
          return makeIssue(
            'PERFORMANCE_EXTRA_PARAM',
            `第 ${line.lineNumber} 行「移动」重复指定了 y。`,
            dialogueOrdinal,
            actionLabel,
            action,
          );
        }
        targetY = num;
      }
    }
    if (targetX === undefined || targetY === undefined) {
      return makeIssue(
        'PERFORMANCE_MISSING_PARAM',
        `第 ${line.lineNumber} 行「移动」必须同时给出 x 与 y。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    return { ...base, targetX, targetY };
  }

  if (action === 'scale') {
    if (actionTokens.length === 0) {
      return { ...base, scaleFactor: 1.3 };
    }
    if (actionTokens.length > 1) {
      return makeIssue(
        'PERFORMANCE_EXTRA_PARAM',
        `第 ${line.lineNumber} 行「放大」只接受一个倍数参数。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    const rawScale = actionTokens[0]!.replace(/^(?:倍数|scale)\s*=\s*/iu, '');
    const scaleFactor = parseFiniteNumber(rawScale);
    if (scaleFactor === null) {
      return makeIssue(
        'PERFORMANCE_INVALID_NUMBER',
        `第 ${line.lineNumber} 行「放大」倍数「${actionTokens[0]}」不是有效数字。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    if (scaleFactor <= 0) {
      return makeIssue(
        'PERFORMANCE_INVALID_SCALE',
        `第 ${line.lineNumber} 行「放大」倍数必须大于 0。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    return { ...base, scaleFactor };
  }

  if (action === 'shake') {
    let amplitudeX: number | undefined;
    let amplitudeY: number | undefined;
    let frequencyHz: number | undefined;
    for (const token of actionTokens) {
      const match = /^(幅度x|幅度y|幅度|频率|amplitudex|amplitudey|frequencyhz)\s*=\s*(.+)$/iu.exec(token);
      if (!match) {
        return makeIssue(
          'PERFORMANCE_EXTRA_PARAM',
          `第 ${line.lineNumber} 行「抖动」不支持参数「${token}」。`,
          dialogueOrdinal,
          actionLabel,
          action,
        );
      }
      const key = match[1]!.toLowerCase();
      const val = parseFiniteNumber(match[2]!);
      if (val === null || val < 0) {
        return makeIssue(
          'PERFORMANCE_INVALID_NUMBER',
          `第 ${line.lineNumber} 行「抖动」参数「${token}」无效。`,
          dialogueOrdinal,
          actionLabel,
          action,
        );
      }
      if (key === '幅度' || key === '幅度x' || key === 'amplitudex') amplitudeX = val;
      else if (key === '幅度y' || key === 'amplitudey') amplitudeY = val;
      else if (key === '频率' || key === 'frequencyhz') frequencyHz = val;
    }
    return {
      ...base,
      ...(amplitudeX !== undefined ? { amplitudeX } : {}),
      ...(amplitudeY !== undefined ? { amplitudeY } : {}),
      ...(frequencyHz !== undefined ? { frequencyHz } : {}),
    };
  }

  if (action === 'expression') {
    if (actionTokens.length === 0) {
      return makeIssue(
        'PERFORMANCE_MISSING_PARAM',
        `第 ${line.lineNumber} 行「表情」需要指定表情名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    if (actionTokens.length > 1) {
      return makeIssue(
        'PERFORMANCE_EXTRA_PARAM',
        `第 ${line.lineNumber} 行「表情」只接受一个表情名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    const expressionName = actionTokens[0]!.replace(/^(?:表情|expression)\s*=\s*/iu, '').trim();
    if (!expressionName) {
      return makeIssue(
        'PERFORMANCE_EMPTY_TARGET',
        `第 ${line.lineNumber} 行「表情」名称不能为空。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    return { ...base, expressionName };
  }

  if (action === 'character-action') {
    if (actionTokens.length === 0) {
      return makeIssue(
        'PERFORMANCE_MISSING_PARAM',
        `第 ${line.lineNumber} 行「角色动作」需要指定动作名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    if (actionTokens.length > 1) {
      return makeIssue(
        'PERFORMANCE_EXTRA_PARAM',
        `第 ${line.lineNumber} 行「角色动作」只接受一个动作名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    const characterActionName = actionTokens[0]!.replace(/^(?:动作|action)\s*=\s*/iu, '').trim();
    if (!characterActionName) {
      return makeIssue(
        'PERFORMANCE_EMPTY_TARGET',
        `第 ${line.lineNumber} 行「角色动作」名称不能为空。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    return { ...base, characterActionName };
  }

  if (action === 'action-recipe') {
    if (actionTokens.length === 0) {
      return makeIssue(
        'PERFORMANCE_MISSING_PARAM',
        `第 ${line.lineNumber} 行「配方」需要指定操作配方名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    if (actionTokens.length > 1) {
      return makeIssue(
        'PERFORMANCE_EXTRA_PARAM',
        `第 ${line.lineNumber} 行「配方」只接受一个配方名称。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    const recipeName = actionTokens[0]!.replace(/^(?:配方|recipe)\s*=\s*/iu, '').trim();
    if (!recipeName) {
      return makeIssue(
        'PERFORMANCE_EMPTY_TARGET',
        `第 ${line.lineNumber} 行「配方」名称不能为空。`,
        dialogueOrdinal,
        actionLabel,
        action,
      );
    }
    return { ...base, recipeName };
  }

  // left-enter, right-enter, fade-in, fade-out accept no extra positional params
  if (actionTokens.length > 0) {
    return makeIssue(
      'PERFORMANCE_EXTRA_PARAM',
      `第 ${line.lineNumber} 行「${actionLabel}」不接受多余参数「${actionTokens[0]}」。`,
      dialogueOrdinal,
      actionLabel,
      action,
    );
  }
  return base;
}

/**
 * Parse a multi-shot Chinese script containing WF-03 staging fields plus
 * optional WF-04 `对白` and `表演` sections. Reuses WF-03's
 * `parseStructuredSceneBlocks` directly so scene parsing is never duplicated.
 */
export function parseScriptPerformanceInput(
  rawInput: string,
  characters: readonly Character[],
  options: Omit<ParseStructuredSceneOptions, 'allowExtraSections'> = {},
): ParseScriptPerformanceResult {
  const parsedScenes = parseStructuredSceneBlocks(rawInput, {
    ...options,
    allowExtraSections: [SCRIPT_DIALOGUE_SECTION, SCRIPT_PERFORMANCE_SECTION],
  });

  const blocks: ParsedScriptBlock[] = [];
  const allDialogues: ScriptDialogueDraftLine[] = [];
  const allPerformances: ParsedPerformanceDirective[] = [];
  let globalOrdinal = 0;

  for (const sceneBlock of parsedScenes.blocks) {
    const rawDialogueLines = sceneBlock.extraSections?.[SCRIPT_DIALOGUE_SECTION] ?? [];
    const blockDialogues: ScriptDialogueDraftLine[] = [];
    for (const [idx, line] of rawDialogueLines.entries()) {
      globalOrdinal += 1;
      const parsedLine = parseDialogueSectionLine(
        line,
        globalOrdinal,
        sceneBlock.index,
        idx,
        characters,
      );
      blockDialogues.push(parsedLine);
      allDialogues.push(parsedLine);
    }

    const rawPerfLines = sceneBlock.extraSections?.[SCRIPT_PERFORMANCE_SECTION] ?? [];
    const blockPerformances: ParsedPerformanceDirective[] = [];
    for (const [idx, line] of rawPerfLines.entries()) {
      const parsedDirective = parsePerformanceDirectiveLine(
        line,
        sceneBlock.index,
        idx,
      );
      blockPerformances.push(parsedDirective);
      allPerformances.push(parsedDirective);
    }

    blocks.push({
      scene: sceneBlock,
      dialogues: blockDialogues,
      performances: blockPerformances,
    });
  }

  return {
    ok: parsedScenes.ok,
    blocks,
    sceneBlocks: parsedScenes.blocks,
    dialogues: allDialogues,
    performances: allPerformances,
    sceneParseIssues: parsedScenes.issues,
    hasDialogueOrPerformance:
      allDialogues.length > 0 || allPerformances.length > 0,
  };
}
