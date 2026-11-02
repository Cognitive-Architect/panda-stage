import type { AudioAsset, Character } from '../../../domain';
import type {
  DialogueBatchResolution,
  ParseDialoguePasteResult,
} from './parseDialoguePaste';

export interface DialogueBatchAudioSelection {
  /** A user-picked asset, or null when the user explicitly cleared the row. */
  assetId: string | null;
  /** Character identity at the time of selection; role edits require reconfirmation. */
  characterId: string;
  /** User-editable clip length in seconds, kept as text to preserve invalid drafts. */
  durationSeconds: string;
}

export type DialogueBatchRowIssue =
  | 'format'
  | 'empty-speaker'
  | 'empty-text'
  | 'text-too-long'
  | 'character-unresolved'
  | 'audio-role-changed'
  | 'audio-unselected'
  | 'audio-selection-missing'
  | 'audio-ambiguous'
  | 'audio-role-mismatch'
  | 'audio-number-mismatch'
  | 'audio-not-found'
  | 'audio-error'
  | 'audio-pending'
  | 'audio-duration-invalid'
  | 'audio-reused'
  | 'duration-invalid'
  | 'duration-out-of-range';

export interface DialogueBatchPreviewRow {
  sourceLineNumber: number;
  text: string | null;
  characterId: string | null;
  characterName: string | null;
  audioAsset: AudioAsset | null;
  audioAssetId: string | null;
  suggestedAudioAsset: AudioAsset | null;
  automaticAsset: AudioAsset | null;
  audioFileName: string | null;
  audioReady: boolean;
  sourceDurationMs: number | null;
  durationSeconds: string | null;
  durationMs: number | null;
  automaticMatch: boolean;
  issue: DialogueBatchRowIssue | null;
  issueMessage: string | null;
  ready: boolean;
}

export interface DialogueBatchPreview {
  rows: DialogueBatchPreviewRow[];
  readyCount: number;
  pendingCount: number;
  totalDurationMs: number;
  allReady: boolean;
}

interface NumberedAudioAsset {
  asset: AudioAsset;
  sequence: number;
  roleName: string;
}

function assetFileName(asset: AudioAsset): string {
  const normalized = asset.relativePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || asset.name;
}

export function dialogueAudioFileName(asset: AudioAsset): string {
  return assetFileName(asset);
}

function parseNumberedAudioName(
  fileName: string,
  hasExtension: boolean,
): Omit<NumberedAudioAsset, 'asset'> | null {
  const extensionIndex = hasExtension ? fileName.lastIndexOf('.') : -1;
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const match = /^(\d+)_([^/]+)$/u.exec(stem);
  if (!match) return null;
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { sequence, roleName: match[2]! };
}

function numberedAudioAsset(asset: AudioAsset): NumberedAudioAsset | null {
  // Imported assets retain the source filename stem in `name`, even when the
  // on-disk path gained a collision hash. Prefer that exact trusted identity;
  // otherwise require the stored relative path itself to match exactly.
  const sourceName = parseNumberedAudioName(asset.name, false);
  const pathName = sourceName ? null : parseNumberedAudioName(assetFileName(asset), true);
  const identity = sourceName ?? pathName;
  return identity ? { asset, ...identity } : null;
}

function sameCanonicalName(left: string, right: string): boolean {
  return left.normalize('NFC') === right.normalize('NFC');
}

function isReadyAudio(asset: AudioAsset): boolean {
  return (
    asset.metadata?.status !== 'error' &&
    Number.isSafeInteger(asset.durationMs) &&
    (asset.durationMs ?? 0) > 0
  );
}

export function formatDialogueDuration(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '—';
  const seconds = (milliseconds / 1_000)
    .toFixed(3)
    .replace(/\.?0+$/u, '');
  return `${seconds} 秒`;
}

export function formatDialogueDurationInput(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) return '';
  return (milliseconds / 1_000)
    .toFixed(3)
    .replace(/\.0+$/u, '')
    .replace(/(\.\d*?)0+$/u, '$1');
}

function parseDialogueDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) return null;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const milliseconds = seconds * 1_000;
  const rounded = Math.round(milliseconds);
  if (
    !Number.isSafeInteger(rounded) ||
    Math.abs(milliseconds - rounded) > 1e-6
  ) {
    return null;
  }
  return rounded;
}

function rowTextProblem(
  line: ParseDialoguePasteResult['lines'][number],
): { issue: DialogueBatchRowIssue; message: string } | null {
  if (line.status === 'malformed') {
    return { issue: 'format', message: '请写成「角色：台词」。' };
  }
  if (line.status === 'invalid') {
    if (line.reason === 'empty-speaker') {
      return { issue: 'empty-speaker', message: '请填写角色名称。' };
    }
    if (line.reason === 'text-too-long') {
      return {
        issue: 'text-too-long',
        message: '台词内容不能超过 10000 个字符。',
      };
    }
    return { issue: 'empty-text', message: '请填写台词内容。' };
  }
  return null;
}

function autoMatch(
  sequenceNumber: number,
  sourceLineNumber: number,
  characterName: string,
  audioAssets: readonly AudioAsset[],
): {
  asset: AudioAsset | null;
  suggestion: AudioAsset | null;
  issue: DialogueBatchRowIssue | null;
  message: string | null;
} {
  const numbered = audioAssets
    .map(numberedAudioAsset)
    .filter((candidate): candidate is NumberedAudioAsset => candidate !== null);
  const sameSequence = numbered.filter(
    (candidate) => candidate.sequence === sequenceNumber,
  );
  if (sameSequence.length > 1) {
    return {
      asset: null,
      suggestion: null,
      issue: 'audio-ambiguous',
      message: `第 ${sourceLineNumber} 行对应的配音编号有多个候选，请手动选择。`,
    };
  }
  if (sameSequence.length === 1) {
    const candidate = sameSequence[0]!;
    if (!sameCanonicalName(candidate.roleName, characterName)) {
      return {
        asset: null,
        suggestion: candidate.asset,
        issue: 'audio-role-mismatch',
        message: `第 ${sourceLineNumber} 行对应的配音角色与当前角色不一致，请手动选择。`,
      };
    }
    if (candidate.asset.metadata?.status === 'error') {
      return {
        asset: null,
        suggestion: candidate.asset,
        issue: 'audio-error',
        message: '对应配音无法读取，请重新准备或手动选择。',
      };
    }
    if (
      candidate.asset.durationMs !== undefined &&
      (!Number.isSafeInteger(candidate.asset.durationMs) ||
        candidate.asset.durationMs < 1)
    ) {
      return {
        asset: null,
        suggestion: candidate.asset,
        issue: 'audio-duration-invalid',
        message: '对应配音时长无效，请重新准备或手动选择。',
      };
    }
    if (!isReadyAudio(candidate.asset)) {
      return {
        asset: null,
        suggestion: candidate.asset,
        issue: 'audio-pending',
        message: '对应配音尚未准备好，请稍后刷新或手动选择。',
      };
    }
    return {
      asset: candidate.asset,
      suggestion: candidate.asset,
      issue: null,
      message: null,
    };
  }

  const sameRole = numbered.some((candidate) =>
    sameCanonicalName(candidate.roleName, characterName),
  );
  return sameRole
    ? {
        asset: null,
        suggestion: null,
        issue: 'audio-number-mismatch',
        message: `找到角色配音，但编号与第 ${sourceLineNumber} 行不一致。`,
      }
    : {
        asset: null,
        suggestion: null,
        issue: 'audio-not-found',
        message: '未找到对应配音，请手动选择。',
      };
}

/**
 * Derives the read-only AS-01 generation plan from the existing paste parser,
 * role mapping, in-memory audio assets, and one DialogueAuthoringDraft snapshot.
 * It never creates a Dialogue, AudioClip, Project revision, or History entry.
 */
export function buildDialogueBatchPreview(input: {
  parsed: ParseDialoguePasteResult;
  resolution: DialogueBatchResolution;
  characters: readonly Character[];
  audioAssets: readonly AudioAsset[];
  audioSelections: Readonly<Record<number, DialogueBatchAudioSelection>>;
}): DialogueBatchPreview {
  const rows = input.parsed.lines.map((line, index): DialogueBatchPreviewRow => {
    const parsedProblem = rowTextProblem(line);
    const resolved = input.resolution.resolvedLines[index];
    if (parsedProblem) {
      return {
        sourceLineNumber: line.lineNumber,
        text: line.text ?? null,
        characterId: null,
        characterName: null,
        audioAsset: null,
        audioAssetId: null,
        suggestedAudioAsset: null,
        automaticAsset: null,
        audioFileName: null,
        audioReady: false,
        sourceDurationMs: null,
        durationSeconds: null,
        durationMs: null,
        automaticMatch: false,
        issue: parsedProblem.issue,
        issueMessage: parsedProblem.message,
        ready: false,
      };
    }
    if (!resolved) {
      const message = line.status === 'ambiguous'
        ? `「${line.speaker ?? '此角色'}」对应多个角色，请确认。`
        : `未找到「${line.speaker ?? '此角色'}」，请选择项目角色。`;
      return {
        sourceLineNumber: line.lineNumber,
        text: line.text ?? null,
        characterId: null,
        characterName: null,
        audioAsset: null,
        audioAssetId: null,
        suggestedAudioAsset: null,
        automaticAsset: null,
        audioFileName: null,
        audioReady: false,
        sourceDurationMs: null,
        durationSeconds: null,
        durationMs: null,
        automaticMatch: false,
        issue: 'character-unresolved',
        issueMessage: message,
        ready: false,
      };
    }

    const character = input.characters.find(
      (candidate) => candidate.id === resolved.characterId,
    );
    if (!character) {
      return {
        sourceLineNumber: line.lineNumber,
        text: resolved.text,
        characterId: null,
        characterName: null,
        audioAsset: null,
        audioAssetId: null,
        suggestedAudioAsset: null,
        automaticAsset: null,
        audioFileName: null,
        audioReady: false,
        sourceDurationMs: null,
        durationSeconds: null,
        durationMs: null,
        automaticMatch: false,
        issue: 'character-unresolved',
        issueMessage: '所选角色已不存在，请重新选择。',
        ready: false,
      };
    }

    const automatic = autoMatch(index + 1, line.lineNumber, character.name, input.audioAssets);
    const selection = input.audioSelections[line.lineNumber];
    if (selection && selection.characterId !== resolved.characterId) {
      return {
        sourceLineNumber: line.lineNumber,
        text: resolved.text,
        characterId: character.id,
        characterName: character.name,
        audioAsset: null,
        audioAssetId: null,
        suggestedAudioAsset: automatic.suggestion,
        automaticAsset: automatic.asset,
        audioFileName: null,
        audioReady: false,
        sourceDurationMs: null,
        durationSeconds: null,
        durationMs: null,
        automaticMatch: false,
        issue: 'audio-role-changed',
        issueMessage: '角色已更改，请重新选择配音。',
        ready: false,
      };
    }

    const manual = selection !== undefined;
    const selectedAsset = manual
      ? selection.assetId === null
        ? null
        : input.audioAssets.find((candidate) => candidate.id === selection.assetId) ?? null
      : automatic.asset;
    let issue: DialogueBatchRowIssue | null = manual
      ? selection.assetId === null
        ? 'audio-unselected'
        : selectedAsset
          ? null
          : 'audio-selection-missing'
      : automatic.issue;
    let issueMessage: string | null = manual
      ? selection.assetId === null
        ? '请选择配音。'
        : selectedAsset
          ? null
          : '所选配音已从素材库移除，请重新选择。'
      : automatic.message;

    const sourceDurationMs = selectedAsset?.durationMs ?? null;
    const audioReady = selectedAsset ? isReadyAudio(selectedAsset) : false;
    const durationSeconds = selectedAsset
      ? manual
        ? selection.durationSeconds
        : formatDialogueDurationInput(selectedAsset.durationMs ?? 0)
      : null;
    let durationMs: number | null = null;

    if (selectedAsset && !issue) {
      if (selectedAsset.metadata?.status === 'error') {
        issue = 'audio-error';
        issueMessage = '所选配音无法读取，请更换配音。';
      } else if (
        selectedAsset.durationMs !== undefined &&
        (!Number.isSafeInteger(selectedAsset.durationMs) ||
          selectedAsset.durationMs < 1)
      ) {
        issue = 'audio-duration-invalid';
        issueMessage = '所选配音时长无效，请更换配音。';
      } else if (!audioReady) {
        issue = 'audio-pending';
        issueMessage = '所选配音尚未准备好，请刷新或更换配音。';
      } else {
        durationMs = parseDialogueDurationInput(durationSeconds ?? '');
        if (durationMs === null) {
          issue = 'duration-invalid';
          issueMessage = '片段时长必须是大于 0 的毫秒数。';
        } else if (durationMs > (sourceDurationMs ?? 0)) {
          issue = 'duration-out-of-range';
          issueMessage = `片段时长不能超过音频时长 ${formatDialogueDuration(sourceDurationMs ?? 0)}。`;
        }
      }
    }

    return {
      sourceLineNumber: line.lineNumber,
      text: resolved.text,
      characterId: character.id,
      characterName: character.name,
      audioAsset: selectedAsset,
      audioAssetId: selectedAsset?.id ?? null,
      suggestedAudioAsset: automatic.suggestion,
      automaticAsset: automatic.asset,
      audioFileName: selectedAsset ? assetFileName(selectedAsset) : null,
      audioReady,
      sourceDurationMs,
      durationSeconds,
      durationMs,
      automaticMatch: !manual && selectedAsset !== null,
      issue,
      issueMessage,
      ready: issue === null,
    };
  });

  const assignedLines = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.audioAsset) continue;
    const lines = assignedLines.get(row.audioAsset.id) ?? [];
    lines.push(row.sourceLineNumber);
    assignedLines.set(row.audioAsset.id, lines);
  }
  for (const lines of assignedLines.values()) {
    if (lines.length < 2) continue;
    for (const lineNumber of lines) {
      const row = rows.find((candidate) => candidate.sourceLineNumber === lineNumber)!;
      row.issue = 'audio-reused';
      row.issueMessage = `这段配音已用于第 ${lines.find((candidate) => candidate !== lineNumber) ?? lineNumber} 行，请更换配音。`;
      row.ready = false;
    }
  }

  const readyRows = rows.filter((row) => row.ready);
  const totalDurationMs = readyRows.reduce(
    (sum, row) => sum + (row.durationMs ?? 0),
    0,
  );
  return {
    rows,
    readyCount: readyRows.length,
    pendingCount: rows.length - readyRows.length,
    totalDurationMs,
    allReady: rows.length > 0 && readyRows.length === rows.length,
  };
}
