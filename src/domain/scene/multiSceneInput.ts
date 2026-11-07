/**
 * AUTO-04 accepts an already-written storyboard, not prose. Every block is a
 * fixed four-field record, blocks are separated by a lone `---`, and anything
 * the parser cannot prove is rejected instead of guessed.
 */
export const MULTI_SCENE_MIN_BLOCKS = 2;
export const MULTI_SCENE_MAX_BLOCKS = 3;
export const MULTI_SCENE_STANCE = '双人对话';
export const MULTI_SCENE_SHOT_DURATION_MS = 3_000;

const BLOCK_SEPARATOR = '---';
const REQUIRED_FIELDS = ['镜头', '背景', '出场', '站位'] as const;
const CAST_SEPARATORS = /[、,]/u;

export type MultiSceneField = (typeof REQUIRED_FIELDS)[number];

export interface MultiSceneBlock {
  /** 1-based position in the pasted batch; the UI numbers blocks with it. */
  readonly index: number;
  readonly shotName: string;
  readonly backgroundName: string;
  readonly cast: readonly [string, string];
  readonly stance: typeof MULTI_SCENE_STANCE;
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
  | 'DUPLICATE_SHOT_NAME';

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

interface ParsedLine {
  /** Null when the line has a `字段：值` shape but the label is unsupported. */
  readonly field: MultiSceneField | null;
  readonly label: string;
  readonly value: string;
}

function fieldName(line: string): ParsedLine | null {
  const asciiColon = line.indexOf(':');
  const fullWidthColon = line.indexOf('：');
  const separatorIndex =
    asciiColon < 0
      ? fullWidthColon
      : fullWidthColon < 0
        ? asciiColon
        : Math.min(asciiColon, fullWidthColon);
  if (separatorIndex < 0) return null;
  const label = line.slice(0, separatorIndex).trim();
  return {
    field: REQUIRED_FIELDS.find((candidate) => candidate === label) ?? null,
    label,
    value: line.slice(separatorIndex + 1).trim(),
  };
}

interface SourceLine {
  readonly lineNumber: number;
  readonly text: string;
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

function collectFields(
  entries: readonly SourceLine[],
  blockIndex: number,
): Map<MultiSceneField, RawField> {
  const fields = new Map<MultiSceneField, RawField>();
  for (const { lineNumber, text } of entries) {
    const parsed = fieldName(text);
    if (!parsed || !parsed.field) {
      throw new MultiSceneInputError(
        parsed ? 'UNKNOWN_FIELD' : 'INVALID_INPUT',
        parsed
          ? `镜头 ${blockIndex} 不支持「${parsed.label}」字段。`
          : `镜头 ${blockIndex} 第 ${lineNumber} 行无法识别，请使用「字段：值」格式。`,
        blockIndex,
        lineNumber,
      );
    }
    if (fields.has(parsed.field)) {
      throw new MultiSceneInputError(
        'DUPLICATE_FIELD',
        `镜头 ${blockIndex} 的「${parsed.field}」字段只能出现一次。`,
        blockIndex,
        lineNumber,
      );
    }
    if (!parsed.value) {
      throw new MultiSceneInputError(
        'EMPTY_FIELD',
        `镜头 ${blockIndex} 的「${parsed.field}」字段不能为空。`,
        blockIndex,
        lineNumber,
      );
    }
    fields.set(parsed.field, { value: parsed.value, lineNumber });
  }
  return fields;
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

/**
 * Parse 2-3 strict blocks. A single block, four blocks, or an empty paste is a
 * batch-level refusal rather than a per-block error.
 */
export function parseMultiSceneInput(rawInput: string): MultiSceneBlock[] {
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
  for (const [blockOffset, entries] of rawBlocks.entries()) {
    const index = blockOffset + 1;
    const fields = collectFields(entries, index);
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
    blocks.push({
      index,
      shotName,
      backgroundName: requiredField(fields, '背景', index).value,
      cast: parseCast(fields, index),
      stance: parseStance(fields, index),
    });
  }
  return blocks;
}
