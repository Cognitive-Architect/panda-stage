/**
 * Portable UTF-8 CSV voice-list contract for WF-EXT A (#1435).
 *
 * The manifest carries stable dialogue identity (`lineKey` / formal
 * `dialogueId`) plus the real audio filename and source range. It is a
 * sidecar file only: parsing or serializing never mutates Project/History.
 */

export const DIALOGUE_AUDIO_MANIFEST_VERSION = 1;

export const DIALOGUE_AUDIO_MANIFEST_HEADERS = [
  'version',
  'projectId',
  'shotId',
  'lineKey',
  'dialogueId',
  'ordinal',
  'speaker',
  'text',
  'audioFilename',
  'sourceStartMs',
  'sourceEndMs',
  'textHash',
] as const;

export type DialogueAudioManifestHeader =
  (typeof DIALOGUE_AUDIO_MANIFEST_HEADERS)[number];

export interface DialogueAudioManifestRow {
  readonly version: number;
  readonly projectId: string;
  readonly shotId: string;
  readonly lineKey: string;
  readonly dialogueId?: string;
  readonly ordinal: number;
  readonly speaker: string;
  readonly text: string;
  readonly audioFilename?: string;
  readonly sourceStartMs?: number;
  readonly sourceEndMs?: number;
  readonly textHash?: string;
}

export type DialogueAudioManifestIssueCode =
  | 'CSV_HEADER_MISSING'
  | 'CSV_ROW_INVALID'
  | 'UNSUPPORTED_VERSION'
  | 'DUPLICATE_LINE_KEY'
  | 'PROJECT_MISMATCH'
  | 'SHOT_MISMATCH'
  | 'INVALID_SOURCE_RANGE'
  | 'TEXT_HASH_MISMATCH';

export interface DialogueAudioManifestIssue {
  readonly code: DialogueAudioManifestIssueCode;
  readonly message: string;
  /** 1-based CSV data row number (header excluded). */
  readonly csvRowNumber?: number;
  readonly lineKey?: string;
}

export interface DialogueAudioManifestParseResult {
  readonly rows: readonly DialogueAudioManifestRow[];
  readonly issues: readonly DialogueAudioManifestIssue[];
}

export class DialogueAudioManifestError extends Error {
  constructor(
    readonly code: 'CSV_HEADER_MISSING' | 'CSV_PARSE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'DialogueAudioManifestError';
  }
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/u;
const QUOTED_FORMULA_PREFIX = /^'+[=+\-@\t\r]/u;

/** Reversible spreadsheet-formula defense; the original text is restored on read. */
function protectField(value: string): string {
  return FORMULA_PREFIX.test(value) || QUOTED_FORMULA_PREFIX.test(value)
    ? `'${value}`
    : value;
}

function unprotectField(value: string): string {
  return QUOTED_FORMULA_PREFIX.test(value) ? value.slice(1) : value;
}

function encodeCsvField(value: string): string {
  const protectedValue = protectField(value);
  return /[",\r\n]/u.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function parseCsvRows(text: string): string[][] {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new DialogueAudioManifestError(
      'CSV_PARSE_FAILED',
      'CSV 中存在未闭合的引号，请检查文件。',
    );
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function dialogueAudioManifestTextHash(
  speaker: string,
  text: string,
): string {
  // FNV-1a is deterministic across renderer/Main and sufficient for a
  // local "text changed since export" guard, not a security checksum.
  let hash = 0x811c9dc5;
  for (const character of `${speaker}\u0000${text}`) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function serializeDialogueAudioManifestCsv(
  rows: readonly DialogueAudioManifestRow[],
): string {
  const header = DIALOGUE_AUDIO_MANIFEST_HEADERS.join(',');
  const body = rows.map((row) =>
    [
      row.version,
      row.projectId,
      row.shotId,
      row.lineKey,
      row.dialogueId ?? '',
      row.ordinal,
      row.speaker,
      row.text,
      row.audioFilename ?? '',
      row.sourceStartMs ?? '',
      row.sourceEndMs ?? '',
      row.textHash ?? '',
    ]
      .map((value) => encodeCsvField(String(value)))
      .join(','),
  );
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`;
}

function optionalString(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export function parseDialogueAudioManifestCsv(
  text: string,
): DialogueAudioManifestParseResult {
  const csvRows = parseCsvRows(text);
  if (csvRows.length === 0) {
    throw new DialogueAudioManifestError(
      'CSV_HEADER_MISSING',
      'CSV 为空，缺少表头。',
    );
  }

  const header = csvRows[0]!.map((value) => unprotectField(value).trim());
  const indexByHeader = new Map(header.map((value, index) => [value, index]));
  const missing = DIALOGUE_AUDIO_MANIFEST_HEADERS.filter(
    (name) =>
      name !== 'dialogueId' &&
      name !== 'audioFilename' &&
      name !== 'sourceStartMs' &&
      name !== 'sourceEndMs' &&
      name !== 'textHash' &&
      !indexByHeader.has(name),
  );
  if (missing.length > 0) {
    throw new DialogueAudioManifestError(
      'CSV_HEADER_MISSING',
      `CSV 缺少必要列：${missing.join('、')}。`,
    );
  }

  const rows: DialogueAudioManifestRow[] = [];
  const issues: DialogueAudioManifestIssue[] = [];
  const seenLineKeys = new Set<string>();

  const cell = (values: readonly string[], name: DialogueAudioManifestHeader): string => {
    const index = indexByHeader.get(name);
    return index === undefined ? '' : unprotectField(values[index] ?? '').trim();
  };

  for (let rowIndex = 1; rowIndex < csvRows.length; rowIndex += 1) {
    const values = csvRows[rowIndex]!;
    if (values.every((value) => value.trim() === '')) continue;
    const csvRowNumber = rowIndex;
    const lineKey = cell(values, 'lineKey');
    const speaker = cell(values, 'speaker');
    const dialogueText = unprotectField(
      values[indexByHeader.get('text')!] ?? '',
    );
    const ordinal = Number(cell(values, 'ordinal'));
    const version = Number(cell(values, 'version'));
    const projectId = cell(values, 'projectId');
    const shotId = cell(values, 'shotId');
    const dialogueId = optionalString(cell(values, 'dialogueId'));
    const audioFilename = optionalString(cell(values, 'audioFilename'));
    const sourceStartRaw = cell(values, 'sourceStartMs');
    const sourceEndRaw = cell(values, 'sourceEndMs');
    const textHash = optionalString(cell(values, 'textHash'));

    const rowIssues: DialogueAudioManifestIssue[] = [];
    if (version !== DIALOGUE_AUDIO_MANIFEST_VERSION) {
      rowIssues.push({
        code: 'UNSUPPORTED_VERSION',
        message: `不支持的清单版本 ${version}，当前只支持 ${DIALOGUE_AUDIO_MANIFEST_VERSION}。`,
        csvRowNumber,
        lineKey,
      });
    }
    if (!lineKey || !projectId || !shotId || !speaker || !dialogueText.trim()) {
      rowIssues.push({
        code: 'CSV_ROW_INVALID',
        message: '清单行缺少 lineKey、工程/镜头、角色或台词。',
        csvRowNumber,
        lineKey,
      });
    }
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      rowIssues.push({
        code: 'CSV_ROW_INVALID',
        message: '清单序号必须是大于 0 的整数。',
        csvRowNumber,
        lineKey,
      });
    }
    if (seenLineKeys.has(lineKey)) {
      rowIssues.push({
        code: 'DUPLICATE_LINE_KEY',
        message: `清单中存在重复 lineKey：${lineKey}。`,
        csvRowNumber,
        lineKey,
      });
    } else {
      seenLineKeys.add(lineKey);
    }

    const hasStart = sourceStartRaw !== '';
    const hasEnd = sourceEndRaw !== '';
    let sourceStartMs: number | undefined;
    let sourceEndMs: number | undefined;
    if (hasStart !== hasEnd) {
      rowIssues.push({
        code: 'INVALID_SOURCE_RANGE',
        message: '音频源起止毫秒必须同时填写或同时留空。',
        csvRowNumber,
        lineKey,
      });
    } else if (hasStart) {
      sourceStartMs = Number(sourceStartRaw);
      sourceEndMs = Number(sourceEndRaw);
      if (
        !Number.isSafeInteger(sourceStartMs) ||
        !Number.isSafeInteger(sourceEndMs) ||
        sourceStartMs < 0 ||
        sourceEndMs <= sourceStartMs
      ) {
        rowIssues.push({
          code: 'INVALID_SOURCE_RANGE',
          message: `音频源区间 ${sourceStartRaw}–${sourceEndRaw}ms 无效。`,
          csvRowNumber,
          lineKey,
        });
      }
      if (!audioFilename) {
        rowIssues.push({
          code: 'INVALID_SOURCE_RANGE',
          message: '填写音频源区间时必须同时填写音频文件名。',
          csvRowNumber,
          lineKey,
        });
      }
    }

    if (
      textHash &&
      textHash !== dialogueAudioManifestTextHash(speaker, dialogueText)
    ) {
      rowIssues.push({
        code: 'TEXT_HASH_MISMATCH',
        message: '台词或角色在导出后被修改，旧录音不会自动视为已确认。',
        csvRowNumber,
        lineKey,
      });
    }

    issues.push(...rowIssues);
    if (
      rowIssues.some(
        (issue) =>
          issue.code !== 'TEXT_HASH_MISMATCH',
      )
    ) {
      continue;
    }

    rows.push({
      version,
      projectId,
      shotId,
      lineKey,
      ...(dialogueId ? { dialogueId } : {}),
      ordinal,
      speaker,
      text: dialogueText,
      ...(audioFilename ? { audioFilename } : {}),
      ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
      ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
      ...(textHash ? { textHash } : {}),
    });
  }

  return { rows, issues };
}

export function validateDialogueAudioManifestScope(
  rows: readonly DialogueAudioManifestRow[],
  projectId: string,
  shotId: string,
): DialogueAudioManifestIssue[] {
  const issues: DialogueAudioManifestIssue[] = [];
  for (const row of rows) {
    if (row.projectId !== projectId) {
      issues.push({
        code: 'PROJECT_MISMATCH',
        message: `清单属于其他工程（${row.projectId}），当前工程为 ${projectId}。`,
        lineKey: row.lineKey,
      });
    } else if (row.shotId !== shotId) {
      issues.push({
        code: 'SHOT_MISMATCH',
        message: `清单属于其他镜头（${row.shotId}），当前镜头为 ${shotId}。`,
        lineKey: row.lineKey,
      });
    }
  }
  return issues;
}
