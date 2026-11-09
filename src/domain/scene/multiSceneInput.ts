import {
  PERFORMANCE_FIELD,
  parsePerformanceLines,
  type PerformanceDirective,
  type PerformanceInputErrorCode,
} from './multiScenePerformance';

/**
 * AUTO-05 extends the AUTO-04 strict storyboard contract with a `对白：` section.
 * AUTO-06 adds an optional `表演：` section after it. It still accepts an
 * already-written storyboard, not prose: 2-3 blocks, each a fixed four-field
 * record followed by explicit dialogue lines. Anything the parser cannot prove
 * is rejected instead of guessed.
 *
 * Dialogue line rules are the #926 / #934 paste contract: split on the first
 * `：` or `:`, skip blank lines, and never merge adjacent same-speaker lines.
 */
export const MULTI_SCENE_MIN_BLOCKS = 2;
export const MULTI_SCENE_MAX_BLOCKS = 3;
export const MULTI_SCENE_STANCE = '双人对话';
export const MULTI_SCENE_SHOT_DURATION_MS = 3_000;
export const MULTI_SCENE_MAX_DIALOGUE_LENGTH = 10_000;

const BLOCK_SEPARATOR = '---';
const SCENE_FIELDS = ['镜头', '背景', '出场', '站位'] as const;
const DIALOGUE_FIELD = '对白';
const CAST_SEPARATORS = /[、,]/u;

export type MultiSceneField = (typeof SCENE_FIELDS)[number];

export interface MultiSceneDialogueLine {
  /** 1-based position across the whole script; drives numbered audio matching. */
  readonly ordinal: number;
  /** 1-based line number in the raw paste, for in-place refusal copy. */
  readonly lineNumber: number;
  readonly speaker: string;
  readonly text: string;
}

export interface MultiSceneBlock {
  /** 1-based position in the pasted batch; the UI numbers blocks with it. */
  readonly index: number;
  readonly shotName: string;
  readonly backgroundName: string;
  readonly cast: readonly [string, string];
  readonly stance: typeof MULTI_SCENE_STANCE;
  readonly dialogues: readonly MultiSceneDialogueLine[];
  /** AUTO-06: empty when the optional `表演：` section is omitted. */
  readonly performances: readonly PerformanceDirective[];
}

export type MultiSceneInputErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_FIELD'
  | 'MISSING_FIELD'
  | 'EMPTY_FIELD'
  | 'INVALID_CAST_COUNT'
  | 'SAME_CHARACTER'
  | 'INVALID_STANCE'
  | 'BLOCK_COUNT_OUT_OF_RANGE'
  | 'DUPLICATE_SHOT_NAME'
  | 'MISSING_DIALOGUE_SECTION'
  | 'DUPLICATE_DIALOGUE_SECTION'
  | 'INVALID_DIALOGUE_SECTION'
  | 'EMPTY_DIALOGUE'
  | 'MALFORMED_DIALOGUE'
  | 'EMPTY_SPEAKER'
  | 'EMPTY_TEXT'
  | 'TEXT_TOO_LONG'
  | 'SPEAKER_NOT_IN_CAST'
  | PerformanceInputErrorCode;

export class MultiSceneInputError extends Error {
  constructor(
    readonly code: MultiSceneInputErrorCode,
    message: string,
    readonly blockIndex?: number,
    readonly lineNumber?: number,
  ) {
    super(message);
    this.name = 'MultiSceneInputError';
  }
}

interface RawField {
  readonly value: string;
  readonly lineNumber: number;
}

interface SourceLine {
  readonly lineNumber: number;
  readonly text: string;
}

interface ParsedLine {
  readonly label: string;
  readonly value: string;
}

function parseLine(line: string): ParsedLine | null {
  const asciiColon = line.indexOf(':');
  const fullWidthColon = line.indexOf('：');
  const separatorIndex =
    asciiColon < 0
      ? fullWidthColon
      : fullWidthColon < 0
        ? asciiColon
        : Math.min(asciiColon, fullWidthColon);
  if (separatorIndex < 0) return null;
  return {
    label: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function splitBlocks(rawInput: string): SourceLine[][] {
  const blocks: SourceLine[][] = [];
  let current: SourceLine[] = [];
  const lines = rawInput.replace(/\r\n?/gu, '\n').split('\n');
  for (const [lineIndex, rawLine] of lines.entries()) {
    const text = rawLine.trim();
    if (text === BLOCK_SEPARATOR) {
      blocks.push(current);
      current = [];
      continue;
    }
    if (!text) continue;
    current.push({ lineNumber: lineIndex + 1, text });
  }
  blocks.push(current);
  return blocks;
}

function requiredField(
  fields: Map<MultiSceneField, RawField>,
  field: MultiSceneField,
  blockIndex: number,
): RawField {
  const found = fields.get(field);
  if (!found) {
    throw new MultiSceneInputError(
      'MISSING_FIELD',
      `镜头 ${blockIndex} 缺少「${field}」字段。`,
      blockIndex,
    );
  }
  return found;
}

function parseCast(
  fields: Map<MultiSceneField, RawField>,
  blockIndex: number,
): readonly [string, string] {
  const raw = requiredField(fields, '出场', blockIndex);
  const names = raw.value
    .split(CAST_SEPARATORS)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length !== 2) {
    throw new MultiSceneInputError(
      'INVALID_CAST_COUNT',
      `镜头 ${blockIndex} 的「出场」必须恰好是两个角色，用「、」分隔。`,
      blockIndex,
      raw.lineNumber,
    );
  }
  const [left, right] = names as [string, string];
  if (left === right) {
    throw new MultiSceneInputError(
      'SAME_CHARACTER',
      `镜头 ${blockIndex} 的两个出场角色不能是同一个人。`,
      blockIndex,
      raw.lineNumber,
    );
  }
  return [left, right];
}

function parseStance(
  fields: Map<MultiSceneField, RawField>,
  blockIndex: number,
): typeof MULTI_SCENE_STANCE {
  const raw = requiredField(fields, '站位', blockIndex);
  if (raw.value !== MULTI_SCENE_STANCE) {
    throw new MultiSceneInputError(
      'INVALID_STANCE',
      `镜头 ${blockIndex} 的「站位」只支持「${MULTI_SCENE_STANCE}」。`,
      blockIndex,
      raw.lineNumber,
    );
  }
  return MULTI_SCENE_STANCE;
}

function parseDialogueLines(
  entries: readonly SourceLine[],
  blockIndex: number,
  cast: readonly [string, string],
  firstOrdinal: number,
): MultiSceneDialogueLine[] {
  const lines: MultiSceneDialogueLine[] = [];
  for (const { lineNumber, text } of entries) {
    const parsed = parseLine(text);
    if (!parsed) {
      throw new MultiSceneInputError(
        'MALFORMED_DIALOGUE',
        `镜头 ${blockIndex} 第 ${lineNumber} 行对白缺少「：」分隔符。`,
        blockIndex,
        lineNumber,
      );
    }
    if (
      parsed.label === DIALOGUE_FIELD ||
      SCENE_FIELDS.some((field) => field === parsed.label)
    ) {
      throw new MultiSceneInputError(
        'MALFORMED_DIALOGUE',
        `镜头 ${blockIndex} 第 ${lineNumber} 行不是对白，场景字段必须写在「${DIALOGUE_FIELD}：」之前。`,
        blockIndex,
        lineNumber,
      );
    }
    const speaker = parsed.label;
    const content = parsed.value;
    if (speaker.length === 0) {
      throw new MultiSceneInputError(
        'EMPTY_SPEAKER',
        `镜头 ${blockIndex} 第 ${lineNumber} 行对白缺少角色名。`,
        blockIndex,
        lineNumber,
      );
    }
    if (content.length === 0) {
      throw new MultiSceneInputError(
        'EMPTY_TEXT',
        `镜头 ${blockIndex} 第 ${lineNumber} 行对白内容为空。`,
        blockIndex,
        lineNumber,
      );
    }
    if (content.length > MULTI_SCENE_MAX_DIALOGUE_LENGTH) {
      throw new MultiSceneInputError(
        'TEXT_TOO_LONG',
        `镜头 ${blockIndex} 第 ${lineNumber} 行对白超过 ${MULTI_SCENE_MAX_DIALOGUE_LENGTH} 字。`,
        blockIndex,
        lineNumber,
      );
    }
    if (speaker !== cast[0] && speaker !== cast[1]) {
      throw new MultiSceneInputError(
        'SPEAKER_NOT_IN_CAST',
        `镜头 ${blockIndex} 第 ${lineNumber} 行的「${speaker}」不在本镜头出场两人中。`,
        blockIndex,
        lineNumber,
      );
    }
    lines.push({
      ordinal: firstOrdinal + lines.length,
      lineNumber,
      speaker,
      text: content,
    });
  }
  if (lines.length === 0) {
    throw new MultiSceneInputError(
      'EMPTY_DIALOGUE',
      `镜头 ${blockIndex} 的「${DIALOGUE_FIELD}：」后至少需要一条对白。`,
      blockIndex,
    );
  }
  return lines;
}

function parsePerformanceSection(
  entries: readonly SourceLine[],
  start: number | null,
  blockIndex: number,
): readonly PerformanceDirective[] {
  if (start === null) return [];
  const result = parsePerformanceLines(entries.slice(start), blockIndex);
  if (!result.ok) {
    throw new MultiSceneInputError(
      result.error.code,
      `镜头 ${blockIndex} ${result.error.message}`,
      blockIndex,
      result.error.lineNumber,
    );
  }
  return result.directives;
}

/** Ordered, de-duplicated speaker labels from cast and dialogue lines. */
export function collectSpeakerLabels(
  blocks: readonly MultiSceneBlock[],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const block of blocks) {
    const candidates = [
      ...block.cast,
      ...block.dialogues.map((line) => line.speaker),
    ];
    for (const label of candidates) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/**
 * The batch surface is shared by three tools with different contracts.
 *
 * - `static-staging` (AUTO-04) stages Shots by background and cast only. It
 *   legitimately has no dialogue, so a missing `对白：` section yields an empty
 *   dialogue list instead of a refusal.
 * - `dialogue` (AUTO-05, and AUTO-06 through the same panel) anchors real
 *   dialogue lines and performance directives, so the section stays mandatory.
 *
 * The mode names the caller's contract instead of weakening the shared
 * parser, which keeps a dialogue tool from silently accepting a dialogue-free
 * batch.
 */
export type MultiSceneInputMode = 'dialogue' | 'static-staging';

export interface ParseMultiSceneInputOptions {
  /** Defaults to `dialogue`, the auto-dialogue tools' strict contract. */
  mode?: MultiSceneInputMode;
}

/**
 * Parse 2-3 strict blocks. A single block, four blocks, a missing dialogue
 * section (in `dialogue` mode), or an unprovable line is a refusal rather than
 * a guessed partial.
 */
export function parseMultiSceneInput(
  rawInput: string,
  options: ParseMultiSceneInputOptions = {},
): MultiSceneBlock[] {
  const mode = options.mode ?? 'dialogue';
  if (typeof rawInput !== 'string') {
    throw new MultiSceneInputError('INVALID_INPUT', '输入必须是文本。');
  }

  const rawBlocks = splitBlocks(rawInput).filter(
    (block) => block.length > 0,
  );
  if (
    rawBlocks.length < MULTI_SCENE_MIN_BLOCKS ||
    rawBlocks.length > MULTI_SCENE_MAX_BLOCKS
  ) {
    throw new MultiSceneInputError(
      'BLOCK_COUNT_OUT_OF_RANGE',
      `一次只能生成 ${MULTI_SCENE_MIN_BLOCKS}～${MULTI_SCENE_MAX_BLOCKS} 个镜头，当前是 ${rawBlocks.length} 个。`,
    );
  }

  const blocks: MultiSceneBlock[] = [];
  const seenShotNames = new Set<string>();
  let nextOrdinal = 1;
  for (const [blockOffset, entries] of rawBlocks.entries()) {
    const index = blockOffset + 1;
    const fields = new Map<MultiSceneField, RawField>();
    let dialogueStart: number | null = null;
    /** Index of the `表演：` header; dialogue lines end right before it. */
    let performanceHeader: number | null = null;
    let performanceStart: number | null = null;

    for (const [entryIndex, { lineNumber, text }] of entries.entries()) {
      const parsed = parseLine(text);
      if (parsed !== null && parsed.label === PERFORMANCE_FIELD) {
        if (performanceStart !== null) {
          throw new MultiSceneInputError(
            'DUPLICATE_PERFORMANCE_SECTION',
            `镜头 ${index} 的「${PERFORMANCE_FIELD}」段只能出现一次。`,
            index,
            lineNumber,
          );
        }
        if (dialogueStart === null) {
          throw new MultiSceneInputError(
            'PERFORMANCE_SECTION_INVALID',
            `镜头 ${index} 的「${PERFORMANCE_FIELD}」段必须写在「${DIALOGUE_FIELD}：」之后。`,
            index,
            lineNumber,
          );
        }
        if (parsed.value.length > 0) {
          throw new MultiSceneInputError(
            'PERFORMANCE_SECTION_INVALID',
            `镜头 ${index} 的「${PERFORMANCE_FIELD}：」后面请换行写表演指令。`,
            index,
            lineNumber,
          );
        }
        performanceHeader = entryIndex;
        performanceStart = entryIndex + 1;
        continue;
      }
      if (parsed !== null && parsed.label === DIALOGUE_FIELD) {
        if (performanceStart !== null) {
          throw new MultiSceneInputError(
            'PERFORMANCE_SECTION_INVALID',
            `镜头 ${index} 的「${DIALOGUE_FIELD}」段必须写在「${PERFORMANCE_FIELD}：」之前。`,
            index,
            lineNumber,
          );
        }
        if (dialogueStart !== null) {
          throw new MultiSceneInputError(
            'DUPLICATE_DIALOGUE_SECTION',
            `镜头 ${index} 的「${DIALOGUE_FIELD}」段只能出现一次。`,
            index,
            lineNumber,
          );
        }
        if (parsed.value.length > 0) {
          throw new MultiSceneInputError(
            'INVALID_DIALOGUE_SECTION',
            `镜头 ${index} 的「${DIALOGUE_FIELD}：」后面请换行写对白。`,
            index,
            lineNumber,
          );
        }
        dialogueStart = entryIndex + 1;
        continue;
      }
      if (dialogueStart !== null) continue;

      if (!parsed || !SCENE_FIELDS.some((field) => field === parsed.label)) {
        throw new MultiSceneInputError(
          parsed ? 'UNKNOWN_FIELD' : 'INVALID_INPUT',
          parsed
            ? `镜头 ${index} 不支持「${parsed.label}」字段。`
            : `镜头 ${index} 第 ${lineNumber} 行无法识别，请使用「字段：值」格式。`,
          index,
          lineNumber,
        );
      }
      const field = parsed.label as MultiSceneField;
      if (fields.has(field)) {
        throw new MultiSceneInputError(
          'DUPLICATE_FIELD',
          `镜头 ${index} 的「${field}」字段只能出现一次。`,
          index,
          lineNumber,
        );
      }
      if (!parsed.value) {
        throw new MultiSceneInputError(
          'EMPTY_FIELD',
          `镜头 ${index} 的「${field}」字段不能为空。`,
          index,
          lineNumber,
        );
      }
      fields.set(field, { value: parsed.value, lineNumber });
    }

    if (dialogueStart === null && mode !== 'static-staging') {
      throw new MultiSceneInputError(
        'MISSING_DIALOGUE_SECTION',
        `镜头 ${index} 缺少「${DIALOGUE_FIELD}：」段。`,
        index,
      );
    }

    const shotName = requiredField(fields, '镜头', index).value;
    if (seenShotNames.has(shotName)) {
      throw new MultiSceneInputError(
        'DUPLICATE_SHOT_NAME',
        `本批镜头名称「${shotName}」重复，请先改名。`,
        index,
        fields.get('镜头')!.lineNumber,
      );
    }
    seenShotNames.add(shotName);
    const cast = parseCast(fields, index);
    const dialogues =
      dialogueStart === null
        ? []
        : parseDialogueLines(
            entries.slice(dialogueStart, performanceHeader ?? entries.length),
            index,
            cast,
            nextOrdinal,
          );
    const performances = parsePerformanceSection(
      entries,
      performanceStart,
      index,
    );
    nextOrdinal += dialogues.length;
    blocks.push({
      index,
      shotName,
      backgroundName: requiredField(fields, '背景', index).value,
      cast,
      stance: parseStance(fields, index),
      dialogues,
      performances,
    });
  }

  // A performance directive is anchored to a real Dialogue of this batch, not
  // to a line number or a guessed speaker. Check after every block is parsed so
  // an ordinal in a later block may still point at an earlier Shot's line.
  const ordinals = new Set(
    blocks.flatMap((block) =>
      block.dialogues.map((line) => line.ordinal),
    ),
  );
  for (const block of blocks) {
    for (const directive of block.performances) {
      if (!ordinals.has(directive.dialogueOrdinal)) {
        throw new MultiSceneInputError(
          'PERFORMANCE_ORDINAL_UNKNOWN',
          `第 ${directive.dialogueOrdinal} 句对白不存在，表演指令无法锚定。`,
          directive.blockIndex,
          directive.sourceLine,
        );
      }
    }
  }
  return blocks;
}
