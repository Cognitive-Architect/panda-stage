import type { Character } from '../../../domain/models';

/**
 * Status of a single pasted line after deterministic parsing.
 *
 * - `valid`       — has a separator, non-empty speaker + text, and the speaker
 *                   matched exactly one existing character (or the fixed
 *                   narration keyword `旁白`).
 * - `malformed`   — no separator (e.g. a line without `:` / `：`).
 * - `invalid`     — separator present but the speaker or text is empty after trim.
 * - `unknown`     — parsed but the speaker matched no existing character.
 * - `ambiguous`   — the speaker matched more than one character (not possible
 *                   under the current unique-name schema, but handled defensively),
 *                   or the narration keyword collides with a real Character name.
 */
export type DialogueLineStatus =
  | 'valid'
  | 'malformed'
  | 'invalid'
  | 'unknown'
  | 'ambiguous';

export type DialogueLineReason =
  | 'empty-speaker'
  | 'empty-text'
  | 'narrator-name-conflict';

export interface ParsedDialogueLine {
  /** 1-based line number within the raw input. */
  lineNumber: number;
  /** The original line, trimmed of leading/trailing whitespace. */
  raw: string;
  status: DialogueLineStatus;
  /** Parsed speaker label (present unless `malformed`). */
  speaker?: string;
  /** Parsed dialogue text (present unless `malformed` / empty-text). */
  text?: string;
  /** Resolved character id; present only for `valid` Character lines. */
  characterId?: string;
  /** Present only for `valid` narration lines (speaker written as 旁白). */
  speakerType?: 'narrator';
  /** Why a line is `invalid` or needs explicit disambiguation. */
  reason?: DialogueLineReason;
}

export interface ParseDialoguePasteResult {
  lines: ParsedDialogueLine[];
  /** Number of blank lines skipped (reported honestly to the preview). */
  ignoredEmpty: number;
  /** Count of lines that may be submitted as-is (`valid`). */
  validCount: number;
}

export interface ResolvedDialogueLine {
  characterId?: string;
  speakerType?: 'narrator';
  text: string;
}

export interface DialogueBatchResolution {
  resolvedLines: Array<ResolvedDialogueLine | null>;
  readyCount: number;
  failureCount: number;
  unknownCount: number;
  allResolved: boolean;
}

const FULL_WIDTH_COLON = '：';
const ASCII_COLON = ':';

/** The one fixed narration keyword accepted by batch authoring. */
export const NARRATOR_PASTE_KEYWORD = '旁白';

function findFirstSeparator(line: string): number {
  const full = line.indexOf(FULL_WIDTH_COLON);
  const ascii = line.indexOf(ASCII_COLON);
  if (full < 0) return ascii;
  if (ascii < 0) return full;
  return Math.min(full, ascii);
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Parses multi-line pasted dialogue text of the form `角色名：台词`.
 *
 * The split happens on the **first** colon only (full-width `：` or ASCII `:`),
 * so colons inside the dialogue text are preserved. Speaker matching is strictly
 * deterministic: a `trim + locale-lowercase` exact match against existing
 * `Character.name`. No fuzzy / AI / similarity guessing is performed.
 *
 * `旁白：台词` is the one reserved narration spelling. If the project also has a
 * real Character named `旁白`, the line is NOT silently turned into narration:
 * it is reported as `ambiguous` and needs an explicit decision.
 *
 * This function performs matching only; it never creates characters. Unknown
 * speakers are surfaced for explicit manual mapping by the caller.
 */
export function parseDialoguePaste(
  raw: string,
  characters: readonly Character[],
): ParseDialoguePasteResult {
  const lines: ParsedDialogueLine[] = [];
  let ignoredEmpty = 0;
  let validCount = 0;

  const sourceLines = raw.split(/\r?\n/);
  sourceLines.forEach((source, index) => {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      ignoredEmpty += 1;
      return;
    }

    const separatorIndex = findFirstSeparator(trimmed);
    if (separatorIndex < 0) {
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'malformed',
      });
      return;
    }

    const speaker = trimmed.slice(0, separatorIndex).trim();
    const text = trimmed.slice(separatorIndex + 1).trim();
    if (speaker.length === 0) {
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'invalid',
        speaker: '',
        text,
        reason: 'empty-speaker',
      });
      return;
    }
    if (text.length === 0) {
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'invalid',
        speaker,
        text: '',
        reason: 'empty-text',
      });
      return;
    }

    const key = normalizedName(speaker);
    const matches = characters.filter(
      (character) => normalizedName(character.name) === key,
    );
    if (key === normalizedName(NARRATOR_PASTE_KEYWORD)) {
      if (matches.length > 0) {
        lines.push({
          lineNumber: index + 1,
          raw: trimmed,
          status: 'ambiguous',
          speaker,
          text,
          reason: 'narrator-name-conflict',
        });
        return;
      }
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'valid',
        speaker,
        text,
        speakerType: 'narrator',
      });
      validCount += 1;
      return;
    }
    if (matches.length === 0) {
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'unknown',
        speaker,
        text,
      });
      return;
    }
    if (matches.length > 1) {
      lines.push({
        lineNumber: index + 1,
        raw: trimmed,
        status: 'ambiguous',
        speaker,
        text,
      });
      return;
    }

    lines.push({
      lineNumber: index + 1,
      raw: trimmed,
      status: 'valid',
      speaker,
      text,
      characterId: matches[0]!.id,
    });
    validCount += 1;
  });

  return { lines, ignoredEmpty, validCount };
}

/**
 * Determines whether every parsed line is ready to commit. A batch is
 * submittable only when there are no malformed / invalid / unknown / ambiguous
 * lines — the caller must first resolve any unknown speakers through manual
 * mapping before commit is enabled.
 */
export function isBatchSubmittable(result: ParseDialoguePasteResult): boolean {
  return (
    result.lines.length > 0 &&
    result.lines.every((line) => line.status === 'valid')
  );
}

/**
 * Applies the existing draft-only speaker mapping to one parse result. This is
 * presentation readiness only: it never creates a Character or mutates the
 * Project/History, and stale mappings to removed characters stay unresolved.
 */
export function resolveDialoguePaste(
  result: ParseDialoguePasteResult,
  mapping: Readonly<Record<number, string>>,
  characters: readonly Character[],
): DialogueBatchResolution {
  const characterIds = new Set(characters.map((character) => character.id));
  const resolvedLines = result.lines.map((line): ResolvedDialogueLine | null => {
    if (line.status === 'valid') {
      return line.speakerType === 'narrator'
        ? { speakerType: 'narrator', text: line.text! }
        : { characterId: line.characterId!, text: line.text! };
    }
    if (line.status !== 'unknown' && line.status !== 'ambiguous') return null;
    const mappedCharacterId = mapping[line.lineNumber];
    if (!mappedCharacterId || !characterIds.has(mappedCharacterId)) return null;
    return { characterId: mappedCharacterId, text: line.text! };
  });
  const readyCount = resolvedLines.filter((line) => line !== null).length;
  const failureCount = result.lines.filter(
    (line) => line.status === 'malformed' || line.status === 'invalid',
  ).length;
  const unknownCount = result.lines.filter(
    (line) => line.status === 'unknown' || line.status === 'ambiguous',
  ).length;
  return {
    resolvedLines,
    readyCount,
    failureCount,
    unknownCount,
    allResolved:
      result.lines.length > 0 && readyCount === result.lines.length,
  };
}
