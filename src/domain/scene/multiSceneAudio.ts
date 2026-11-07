import type { AudioAsset, Project } from '../models';

/**
 * AUTO-05 reuses the #926 / #934 numbered-audio contract:
 * `<全剧本序号>_<角色规范名称>.<ext>`. The name only suggests a match; the
 * formal foreign key is always a real Audio Asset id.
 */
export type AudioMatchIssueCode =
  | 'AUDIO_AMBIGUOUS'
  | 'AUDIO_ROLE_MISMATCH'
  | 'AUDIO_NOT_FOUND'
  | 'AUDIO_ERROR'
  | 'AUDIO_PENDING'
  | 'AUDIO_DURATION_INVALID'
  | 'AUDIO_REUSED'
  | 'AUDIO_SELECTION_MISSING';

export interface NumberedAudioAsset {
  readonly asset: AudioAsset;
  readonly sequence: number;
  readonly roleName: string;
}

export interface AudioMatchRequest {
  readonly ordinal: number;
  readonly characterName: string;
}

export interface AudioMatchRow extends AudioMatchRequest {
  readonly asset: AudioAsset | null;
  readonly durationMs: number | null;
  readonly fileName: string | null;
  readonly issue: AudioMatchIssueCode | null;
  readonly message: string | null;
  /** True when the row came from the numbered exact match, not a manual pick. */
  readonly automatic: boolean;
}

export interface AudioMatchReport {
  readonly rows: readonly AudioMatchRow[];
  readonly ready: boolean;
}

export function assetFileName(asset: AudioAsset): string {
  const normalized = asset.relativePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || asset.name;
}

/** Preview copy only; the plan always uses the integer durationMs. */
export function formatDurationMs(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '—';
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

function parseNumberedName(
  fileName: string,
  hasExtension: boolean,
): { sequence: number; roleName: string } | null {
  const extensionIndex = hasExtension ? fileName.lastIndexOf('.') : -1;
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const match = /^(\d+)_([^/]+)$/u.exec(stem);
  if (!match) return null;
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { sequence, roleName: match[2]! };
}

export function parseNumberedAudioAsset(
  asset: AudioAsset,
): NumberedAudioAsset | null {
  // Imported assets keep the source filename stem in `name`, even when the
  // on-disk path gained a collision hash. Prefer that trusted identity.
  const source = parseNumberedName(asset.name, false);
  const fromPath = source
    ? null
    : parseNumberedName(assetFileName(asset), true);
  const identity = source ?? fromPath;
  return identity ? { asset, ...identity } : null;
}

function isReadyAudio(asset: AudioAsset): boolean {
  return (
    asset.metadata?.status !== 'error' &&
    Number.isSafeInteger(asset.durationMs) &&
    (asset.durationMs ?? 0) > 0
  );
}

interface AutomaticMatch {
  readonly asset: AudioAsset | null;
  readonly issue: AudioMatchIssueCode | null;
  readonly message: string | null;
}

function automaticMatch(
  request: AudioMatchRequest,
  numbered: readonly NumberedAudioAsset[],
): AutomaticMatch {
  const sameSequence = numbered.filter(
    (candidate) => candidate.sequence === request.ordinal,
  );
  if (sameSequence.length > 1) {
    return {
      asset: null,
      issue: 'AUDIO_AMBIGUOUS',
      message: `第 ${request.ordinal} 句有多个同编号配音，请手动选择，不自动猜测。`,
    };
  }
  if (sameSequence.length === 0) {
    return {
      asset: null,
      issue: 'AUDIO_NOT_FOUND',
      message: `第 ${request.ordinal} 句没有找到对应编号的配音。`,
    };
  }
  const candidate = sameSequence[0]!;
  if (
    candidate.roleName.normalize('NFC') !==
    request.characterName.normalize('NFC')
  ) {
    return {
      asset: null,
      issue: 'AUDIO_ROLE_MISMATCH',
      message: `第 ${request.ordinal} 句配音的角色名与「${request.characterName}」不一致，不自动猜测。`,
    };
  }
  return { asset: candidate.asset, issue: null, message: null };
}

function assetIssue(asset: AudioAsset): {
  issue: AudioMatchIssueCode | null;
  message: string | null;
} {
  if (asset.metadata?.status === 'error') {
    return { issue: 'AUDIO_ERROR', message: '这段配音无法读取，请更换配音。' };
  }
  if (
    asset.durationMs === undefined ||
    !Number.isSafeInteger(asset.durationMs) ||
    asset.durationMs < 1
  ) {
    return {
      issue: asset.durationMs === undefined ? 'AUDIO_PENDING' : 'AUDIO_DURATION_INVALID',
      message:
        asset.durationMs === undefined
          ? '这段配音还没有可用时长，请刷新素材。'
          : '这段配音的时长无效，请更换配音。',
    };
  }
  if (!isReadyAudio(asset)) {
    return { issue: 'AUDIO_PENDING', message: '这段配音尚未准备好。' };
  }
  return { issue: null, message: null };
}

/**
 * Pure runtime report. A manual selection can resolve an unmatched row, but
 * the asset still has to exist, be ready and carry a real durationMs.
 */
export function resolveAudioMatches(
  project: Project,
  requests: readonly AudioMatchRequest[],
  selections: Readonly<Record<number, string>> = {},
): AudioMatchReport {
  const audioAssets = project.assets.filter(
    (asset): asset is AudioAsset => asset.kind === 'audio',
  );
  const numbered = audioAssets
    .map(parseNumberedAudioAsset)
    .filter((candidate): candidate is NumberedAudioAsset => candidate !== null);

  const rows: AudioMatchRow[] = requests.map((request) => {
    const manualId = selections[request.ordinal];
    const automatic = automaticMatch(request, numbered);
    const asset = manualId
      ? (audioAssets.find((candidate) => candidate.id === manualId) ?? null)
      : automatic.asset;
    let issue: AudioMatchIssueCode | null = manualId
      ? asset
        ? null
        : 'AUDIO_SELECTION_MISSING'
      : automatic.issue;
    let message: string | null = manualId
      ? asset
        ? null
        : '所选配音已从素材库移除，请重新选择。'
      : automatic.message;
    const checked = asset && !issue ? assetIssue(asset) : null;
    if (checked?.issue) {
      issue = checked.issue;
      message = checked.message;
    }
    return {
      ...request,
      asset,
      durationMs: issue === null ? (asset?.durationMs ?? null) : null,
      fileName: asset ? assetFileName(asset) : null,
      issue,
      message,
      automatic: !manualId,
    };
  });

  // One Audio Asset may back at most one dialogue across the whole script.
  const usage = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (!row.asset || row.issue) return;
    const ordinals = usage.get(row.asset.id) ?? [];
    ordinals.push(index);
    usage.set(row.asset.id, ordinals);
  });
  for (const indices of usage.values()) {
    if (indices.length < 2) continue;
    for (const index of indices) {
      const row = rows[index]!;
      rows[index] = {
        ...row,
        issue: 'AUDIO_REUSED',
        message: `这段配音被第 ${indices
          .filter((other) => other !== index)
          .map((other) => requests[other]!.ordinal)
          .join('、')} 句重复使用，请更换素材。`,
      };
    }
  }

  return {
    rows,
    ready: rows.length > 0 && rows.every((row) => row.issue === null),
  };
}
