import {
  DIALOGUE_SPEAKER_NARRATOR,
  ProjectSchema,
  type AudioAsset,
  type DialogueSpeakerType,
  type Project,
} from '../models';
import { DialogueService } from './DialogueService';
import { ShotService } from './ShotService';

/**
 * Shared WF-01 / WF-04 audio-matching & real-duration sequential timing planner.
 *
 * Design invariants:
 * - Pure functions & services: planning/matching never mutates Project or stores.
 * - Stable draft-row identity across inserts/deletes/reorders within an editing session.
 * - Match priority: existing Dialogue.id > confirmed audioAssetId > unique `<ordinal>_<speakerName>` > manual selection (explicit manual selection overrides prior binding).
 * - Duplicates / ambiguity / role mismatch never silently guess; unready or missing audio stays draft while valid ready subset can be committed.
 * - Real source range (`[sourceStartMs, sourceEndMs)`) sequential timing: never estimates duration, never clips tails, never rounds away tail milliseconds.
 * - Commit delegates to official `ShotService.setDuration` (only on explicit confirmation) and `DialogueService.createManyTimedWithAudio`.
 */

export interface NumberedAudioAsset {
  readonly asset: AudioAsset;
  readonly sequence: number;
  readonly roleName: string;
}

export type DialogueAudioMatchSource =
  | 'manual'
  | 'existing-dialogue'
  | 'confirmed'
  | 'auto-numbered'
  | 'none';

export type DialogueAudioMatchIssueCode =
  | 'AUDIO_AMBIGUOUS'
  | 'AUDIO_ROLE_MISMATCH'
  | 'AUDIO_NOT_FOUND'
  | 'AUDIO_UNSELECTED'
  | 'AUDIO_SELECTION_MISSING'
  | 'AUDIO_ERROR'
  | 'AUDIO_PENDING'
  | 'AUDIO_DURATION_INVALID'
  | 'SOURCE_RANGE_INVALID';

export interface DialogueDraftRowSeed {
  readonly sourceLineNumber: number;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly speakerName: string;
  readonly existingDialogueId?: string;
  readonly confirmedAudioAssetId?: string;
  readonly sourceStartMs?: number;
  readonly sourceEndMs?: number;
}

export interface StableDialogueDraftRow extends DialogueDraftRowSeed {
  readonly draftRowId: string;
  readonly confirmedSpeakerKey?: string;
}

export interface DialogueAudioMatchRequest {
  readonly draftRowId: string;
  /** 1-based ordinal used for `<ordinal>_<speakerName>` initial matching. */
  readonly ordinal: number;
  readonly sourceLineNumber: number;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly speakerName: string;
  /** Priority 1: existing formal Dialogue.id in target shot. */
  readonly existingDialogueId?: string;
  /** Priority 2: previously confirmed AudioAsset.id on this stable draftRowId. */
  readonly confirmedAudioAssetId?: string;
  /** Explicit manual pick (`string`) or explicit clear (`null`). */
  readonly manualAudioAssetId?: string | null;
  /** Optional explicit source start offset in ms (defaults to 0 or existing clip offset). */
  readonly sourceStartMs?: number;
  /** Optional explicit source end in ms (defaults to asset.durationMs). */
  readonly sourceEndMs?: number;
}

export interface DialogueAudioMatchRow {
  readonly draftRowId: string;
  readonly ordinal: number;
  readonly sourceLineNumber: number;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly speakerName: string;
  readonly existingDialogueId?: string;
  readonly audioAsset: AudioAsset | null;
  readonly audioAssetId: string | null;
  readonly fileName: string | null;
  readonly sourceStartMs: number | null;
  readonly sourceEndMs: number | null;
  readonly durationMs: number | null;
  readonly matchSource: DialogueAudioMatchSource;
  readonly issue: DialogueAudioMatchIssueCode | null;
  readonly issueMessage: string | null;
  readonly ambiguousCandidates: readonly AudioAsset[];
  readonly ready: boolean;
}

export interface DialogueAudioMatchReport {
  readonly rows: readonly DialogueAudioMatchRow[];
  readonly readyRows: readonly DialogueAudioMatchRow[];
  readonly draftRows: readonly DialogueAudioMatchRow[];
  readonly readyCount: number;
  readonly draftCount: number;
  readonly totalDurationMs: number;
  readonly allReady: boolean;
  readonly hasCommitableSubset: boolean;
}

export interface DialogueAudioScheduleRowInput {
  readonly draftRowId: string;
  readonly sourceLineNumber: number;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly existingDialogueId?: string;
  readonly audioAssetId: string;
  /** Explicit source start offset in ms (defaults to 0). */
  readonly sourceStartMs?: number;
  /** Explicit source end in ms (defaults to asset.durationMs). */
  readonly sourceEndMs?: number;
}

export interface PlanDialogueAudioScheduleInput {
  readonly shotId: string;
  readonly startMs: number;
  readonly rows: readonly DialogueAudioScheduleRowInput[];
}

export interface PlannedDialogueAudioRow {
  readonly draftRowId: string;
  readonly sourceLineNumber: number;
  readonly text: string;
  readonly speakerType: DialogueSpeakerType;
  readonly characterId?: string;
  readonly existingDialogueId?: string;
  readonly audioAssetId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly durationMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

export type DialogueAudioScheduleBlockerCode =
  | 'SHOT_NOT_FOUND'
  | 'INVALID_START_TIME'
  | 'EMPTY_BATCH'
  | 'CHARACTER_NOT_FOUND'
  | 'DIALOGUE_NOT_FOUND'
  | 'INVALID_TEXT'
  | 'AUDIO_ASSET_NOT_FOUND'
  | 'AUDIO_ASSET_NOT_READY'
  | 'SOURCE_RANGE_INVALID'
  | 'TIME_OVERFLOW'
  | 'DIALOGUE_OVERLAP';

export interface DialogueAudioScheduleBlocker {
  readonly code: DialogueAudioScheduleBlockerCode;
  readonly message: string;
  readonly draftRowId?: string;
  readonly sourceLineNumber?: number;
  readonly conflictDialogueId?: string;
  readonly conflictRangeMs?: { readonly startMs: number; readonly endMs: number };
}

export interface DialogueAudioSchedulePlan {
  readonly shotId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly totalDurationMs: number;
  readonly shotDurationMs: number;
  readonly remainingDurationMs: number;
  readonly needsShotExtension: boolean;
  readonly extensionToMs: number | null;
  readonly rows: readonly PlannedDialogueAudioRow[];
  readonly blockers: readonly DialogueAudioScheduleBlocker[];
  readonly ready: boolean;
}

export type AutoSubtitleAudioErrorCode =
  | DialogueAudioScheduleBlockerCode
  | 'EXTENSION_REQUIRED'
  | 'STALE_EXTENSION_CONFIRMATION'
  | 'GENERATION_INVARIANT_FAILED';

export class AutoSubtitleAudioError extends Error {
  constructor(
    readonly code: AutoSubtitleAudioErrorCode,
    message: string,
    readonly sourceLineNumber?: number,
  ) {
    super(message);
    this.name = 'AutoSubtitleAudioError';
  }
}

export interface ApplyDialogueAudioScheduleInput
  extends PlanDialogueAudioScheduleInput {
  /** Must equal `plan.extensionToMs` when `plan.needsShotExtension` is true. */
  readonly extendShotToMs?: number;
}

export interface ApplyDialogueAudioScheduleResult {
  readonly project: Project;
  readonly plan: DialogueAudioSchedulePlan;
  readonly dialogueIds: readonly string[];
  readonly audioClipIds: readonly string[];
  readonly previousShotDurationMs: number;
  readonly nextShotDurationMs: number;
}

export function dialogueDraftSpeakerKey(input: {
  speakerType: DialogueSpeakerType;
  characterId?: string;
}): string {
  return input.speakerType === DIALOGUE_SPEAKER_NARRATOR
    ? 'narrator'
    : `character:${input.characterId ?? ''}`;
}

export function audioAssetDisplayFileName(asset: AudioAsset): string {
  const normalized = asset.relativePath.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || asset.name;
}

export function formatAudioDurationMs(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '—';
  const seconds = (milliseconds / 1_000).toFixed(3).replace(/\.?0+$/u, '');
  return `${seconds} 秒`;
}

function parseNumberedAudioStem(
  fileName: string,
  hasExtension: boolean,
): { sequence: number; roleName: string } | null {
  const extensionIndex = hasExtension ? fileName.lastIndexOf('.') : -1;
  const stem =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const match = /^(\d+)_([^/]+)$/u.exec(stem);
  if (!match) return null;
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { sequence, roleName: match[2]! };
}

export function parseNumberedAudioAsset(
  asset: AudioAsset,
): NumberedAudioAsset | null {
  // Imported assets keep the original filename stem in `name` even when the
  // stored relative path carries a collision hash. Prefer `name`; fall back to
  // the relative path filename.
  const fromName = parseNumberedAudioStem(asset.name, false);
  const fromPath = fromName
    ? null
    : parseNumberedAudioStem(audioAssetDisplayFileName(asset), true);
  const parsed = fromName ?? fromPath;
  return parsed ? { asset, ...parsed } : null;
}

export function isAudioAssetReady(asset: AudioAsset): boolean {
  return (
    asset.kind === 'audio' &&
    asset.metadata?.status !== 'error' &&
    Number.isSafeInteger(asset.durationMs) &&
    (asset.durationMs ?? 0) > 0
  );
}

function sameCanonicalName(left: string, right: string): boolean {
  return left.normalize('NFC') === right.normalize('NFC');
}

/**
 * Reconciles incoming parsed lines against previous session draft rows so
 * inserting, deleting, or reordering lines preserves stable `draftRowId` and
 * confirmed audio bindings for unchanged rows.
 */
export function reconcileDialogueDraftRows(
  previousRows: readonly StableDialogueDraftRow[],
  nextSeeds: readonly DialogueDraftRowSeed[],
  createDraftRowId?: () => string,
): StableDialogueDraftRow[] {
  const existingIds = new Set(previousRows.map((row) => row.draftRowId));
  let counter = previousRows.length + 1;
  const nextId = (): string => {
    if (createDraftRowId) {
      const candidate = createDraftRowId();
      existingIds.add(candidate);
      return candidate;
    }
    while (existingIds.has(`draft-row-${counter}`)) {
      counter += 1;
    }
    const id = `draft-row-${counter}`;
    existingIds.add(id);
    counter += 1;
    return id;
  };

  const available = new Set<number>(previousRows.map((_, index) => index));
  const matchedPrevious: Array<StableDialogueDraftRow | null> = nextSeeds.map(
    () => null,
  );

  // Pass 1: exact existingDialogueId match.
  nextSeeds.forEach((seed, nextIndex) => {
    if (!seed.existingDialogueId) return;
    for (const prevIndex of available) {
      const prev = previousRows[prevIndex]!;
      if (prev.existingDialogueId === seed.existingDialogueId) {
        matchedPrevious[nextIndex] = prev;
        available.delete(prevIndex);
        break;
      }
    }
  });

  // Pass 2: exact (speakerKey, text) match in order — survives inserts,
  // deletes, and reorders without cross-wiring confirmed bindings.
  nextSeeds.forEach((seed, nextIndex) => {
    if (matchedPrevious[nextIndex]) return;
    const seedSpeakerKey = dialogueDraftSpeakerKey(seed);
    for (const prevIndex of available) {
      const prev = previousRows[prevIndex]!;
      if (
        dialogueDraftSpeakerKey(prev) === seedSpeakerKey &&
        prev.text === seed.text
      ) {
        matchedPrevious[nextIndex] = prev;
        available.delete(prevIndex);
        break;
      }
    }
  });

  // Pass 3: in-place text edit at the same sourceLineNumber with the same
  // speaker preserves the row's draft identity and confirmed audio binding.
  nextSeeds.forEach((seed, nextIndex) => {
    if (matchedPrevious[nextIndex]) return;
    const seedSpeakerKey = dialogueDraftSpeakerKey(seed);
    for (const prevIndex of available) {
      const prev = previousRows[prevIndex]!;
      if (
        prev.sourceLineNumber === seed.sourceLineNumber &&
        dialogueDraftSpeakerKey(prev) === seedSpeakerKey
      ) {
        matchedPrevious[nextIndex] = prev;
        available.delete(prevIndex);
        break;
      }
    }
  });

  return nextSeeds.map((seed, index) => {
    const prev = matchedPrevious[index];
    const speakerKey = dialogueDraftSpeakerKey(seed);
    if (!prev) {
      return {
        ...seed,
        draftRowId: nextId(),
        ...(seed.confirmedAudioAssetId
          ? { confirmedSpeakerKey: speakerKey }
          : {}),
      };
    }

    const sameSpeaker =
      (prev.confirmedSpeakerKey ?? dialogueDraftSpeakerKey(prev)) === speakerKey;
    const confirmedAudioAssetId =
      seed.confirmedAudioAssetId ??
      (sameSpeaker ? prev.confirmedAudioAssetId : undefined);
    const sourceStartMs =
      seed.sourceStartMs ?? (sameSpeaker ? prev.sourceStartMs : undefined);
    const sourceEndMs =
      seed.sourceEndMs ?? (sameSpeaker ? prev.sourceEndMs : undefined);

    return {
      ...seed,
      draftRowId: prev.draftRowId,
      ...(seed.existingDialogueId ?? prev.existingDialogueId
        ? { existingDialogueId: seed.existingDialogueId ?? prev.existingDialogueId }
        : {}),
      ...(confirmedAudioAssetId !== undefined
        ? { confirmedAudioAssetId, confirmedSpeakerKey: speakerKey }
        : {}),
      ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
      ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
    };
  });
}

function validateAudioAssetReadiness(asset: AudioAsset): {
  issue: DialogueAudioMatchIssueCode | null;
  message: string | null;
} {
  if (asset.metadata?.status === 'error') {
    return {
      issue: 'AUDIO_ERROR',
      message: '所选配音无法读取，请更换配音。',
    };
  }
  if (asset.durationMs === undefined) {
    return {
      issue: 'AUDIO_PENDING',
      message: '所选配音尚未就绪（缺少真实时长），将保留在草稿。',
    };
  }
  if (!Number.isSafeInteger(asset.durationMs) || asset.durationMs < 1) {
    return {
      issue: 'AUDIO_DURATION_INVALID',
      message: '所选配音时长无效，请更换配音。',
    };
  }
  return { issue: null, message: null };
}

function autoMatchNumberedAudio(
  ordinal: number,
  speakerName: string,
  numbered: readonly NumberedAudioAsset[],
): {
  asset: AudioAsset | null;
  issue: DialogueAudioMatchIssueCode | null;
  message: string | null;
  ambiguousCandidates: readonly AudioAsset[];
} {
  const sameSequence = numbered.filter(
    (candidate) => candidate.sequence === ordinal,
  );
  if (sameSequence.length > 1) {
    return {
      asset: null,
      issue: 'AUDIO_AMBIGUOUS',
      message: `第 ${ordinal} 句存在多个同编号配音，请手动选择。`,
      ambiguousCandidates: sameSequence.map((candidate) => candidate.asset),
    };
  }
  if (sameSequence.length === 0) {
    return {
      asset: null,
      issue: 'AUDIO_NOT_FOUND',
      message: `未找到第 ${ordinal} 句配音（${ordinal}_${speakerName}），可手动选择或留作草稿。`,
      ambiguousCandidates: [],
    };
  }
  const candidate = sameSequence[0]!;
  if (!sameCanonicalName(candidate.roleName, speakerName)) {
    return {
      asset: null,
      issue: 'AUDIO_ROLE_MISMATCH',
      message: `第 ${ordinal} 句配音名称为“${candidate.roleName}”，与“${speakerName}”不一致，请手动选择。`,
      ambiguousCandidates: [candidate.asset],
    };
  }
  return {
    asset: candidate.asset,
    issue: null,
    message: null,
    ambiguousCandidates: [],
  };
}

/**
 * Pure audio matcher shared by WF-01 and WF-04.
 *
 * Resolution priority per row:
 * - Explicit `manualAudioAssetId` (user pick or explicit clear `null`)
 * - Priority 1: `existingDialogueId` -> bound AudioClip.assetId in `shotId`
 * - Priority 2: `confirmedAudioAssetId` -> previously confirmed binding on this draftRowId
 * - Priority 3: unique `<ordinal>_<speakerName>` match
 *
 * Explicit manual reuse of the same AudioAsset across multiple lines is allowed
 * (each Dialogue receives its own AudioClip). Unready/missing/ambiguous rows
 * stay draft without blocking the ready subset.
 */
export function matchDialogueAudioRows(
  project: Project,
  requests: readonly DialogueAudioMatchRequest[],
  options: { readonly shotId?: string } = {},
): DialogueAudioMatchReport {
  const audioAssets = project.assets.filter(
    (asset): asset is AudioAsset => asset.kind === 'audio',
  );
  const audioById = new Map(audioAssets.map((asset) => [asset.id, asset]));
  const numbered = audioAssets
    .map(parseNumberedAudioAsset)
    .filter((candidate): candidate is NumberedAudioAsset => candidate !== null);
  const shot = options.shotId
    ? project.shots.find((candidate) => candidate.id === options.shotId)
    : undefined;

  const rows: DialogueAudioMatchRow[] = requests.map((request) => {
    let audioAsset: AudioAsset | null = null;
    let matchSource: DialogueAudioMatchSource;
    let issue: DialogueAudioMatchIssueCode | null = null;
    let issueMessage: string | null = null;
    let ambiguousCandidates: readonly AudioAsset[] = [];
    let defaultSourceStartMs = 0;
    let defaultSourceEndMs: number | undefined;

    if (request.manualAudioAssetId !== undefined) {
      matchSource = 'manual';
      if (request.manualAudioAssetId === null) {
        issue = 'AUDIO_UNSELECTED';
        issueMessage = '未选择配音，将保留在草稿。';
      } else {
        audioAsset = audioById.get(request.manualAudioAssetId) ?? null;
        if (!audioAsset) {
          issue = 'AUDIO_SELECTION_MISSING';
          issueMessage = '所选配音已从素材库移除，请重新选择。';
        }
      }
    } else {
      // Priority 1: existing formal Dialogue.id in shot
      const existingDialogue =
        request.existingDialogueId && shot
          ? shot.dialogues.find(
              (candidate) => candidate.id === request.existingDialogueId,
            )
          : undefined;
      const existingClip =
        existingDialogue?.audioClipId && shot
          ? shot.audioClips.find(
              (clip) => clip.id === existingDialogue.audioClipId,
            )
          : undefined;
      if (existingClip) {
        matchSource = 'existing-dialogue';
        audioAsset = audioById.get(existingClip.assetId) ?? null;
        defaultSourceStartMs = existingClip.offsetMs;
        defaultSourceEndMs =
          existingClip.offsetMs + (existingClip.endMs - existingClip.startMs);
        if (!audioAsset) {
          issue = 'AUDIO_SELECTION_MISSING';
          issueMessage = '已有对白绑定的配音素材不存在，请重新选择。';
        }
      } else if (request.confirmedAudioAssetId !== undefined) {
        // Priority 2: previously confirmed audioAssetId on this draftRowId
        matchSource = 'confirmed';
        audioAsset = audioById.get(request.confirmedAudioAssetId) ?? null;
        if (!audioAsset) {
          issue = 'AUDIO_SELECTION_MISSING';
          issueMessage = '已确认的配音已从素材库移除，请重新选择。';
        }
      } else {
        // Priority 3: unique `<ordinal>_<speakerName>` match
        const automatic = autoMatchNumberedAudio(
          request.ordinal,
          request.speakerName,
          numbered,
        );
        audioAsset = automatic.asset;
        matchSource = automatic.asset ? 'auto-numbered' : 'none';
        issue = automatic.issue;
        issueMessage = automatic.message;
        ambiguousCandidates = automatic.ambiguousCandidates;
      }
    }

    let sourceStartMs: number | null = null;
    let sourceEndMs: number | null = null;
    let durationMs: number | null = null;

    if (audioAsset && !issue) {
      const readiness = validateAudioAssetReadiness(audioAsset);
      if (readiness.issue) {
        issue = readiness.issue;
        issueMessage = readiness.message;
      } else {
        const assetDurationMs = audioAsset.durationMs!;
        const start = request.sourceStartMs ?? defaultSourceStartMs;
        const end =
          request.sourceEndMs ?? defaultSourceEndMs ?? assetDurationMs;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end > assetDurationMs
        ) {
          issue = 'SOURCE_RANGE_INVALID';
          issueMessage = `源区间 ${start}–${end}ms 超出音频真实时长 ${formatAudioDurationMs(assetDurationMs)}。`;
        } else {
          sourceStartMs = start;
          sourceEndMs = end;
          durationMs = end - start;
        }
      }
    }

    return {
      draftRowId: request.draftRowId,
      ordinal: request.ordinal,
      sourceLineNumber: request.sourceLineNumber,
      text: request.text,
      speakerType: request.speakerType,
      ...(request.characterId ? { characterId: request.characterId } : {}),
      speakerName: request.speakerName,
      ...(request.existingDialogueId
        ? { existingDialogueId: request.existingDialogueId }
        : {}),
      audioAsset,
      audioAssetId: audioAsset?.id ?? null,
      fileName: audioAsset ? audioAssetDisplayFileName(audioAsset) : null,
      sourceStartMs,
      sourceEndMs,
      durationMs,
      matchSource,
      issue,
      issueMessage,
      ambiguousCandidates,
      ready: issue === null && audioAsset !== null && durationMs !== null,
    };
  });

  const readyRows = rows.filter((row) => row.ready);
  const draftRows = rows.filter((row) => !row.ready);
  const totalDurationMs = readyRows.reduce(
    (sum, row) => sum + (row.durationMs ?? 0),
    0,
  );

  return {
    rows,
    readyRows,
    draftRows,
    readyCount: readyRows.length,
    draftCount: draftRows.length,
    totalDurationMs,
    allReady: rows.length > 0 && readyRows.length === rows.length,
    hasCommitableSubset: readyRows.length > 0,
  };
}

/**
 * Shared formal timing planner and atomic applier for WF-01 & WF-04.
 * Never mutates input Project; delegates formal commit to ShotService +
 * DialogueService.createManyTimedWithAudio.
 */
export class AutoSubtitleAudioService {
  constructor(
    private readonly dialogues = new DialogueService(),
    private readonly shots = new ShotService(),
  ) {}

  plan(
    project: Project,
    input: PlanDialogueAudioScheduleInput,
  ): DialogueAudioSchedulePlan {
    const shot = project.shots.find((candidate) => candidate.id === input.shotId);
    const blockers: DialogueAudioScheduleBlocker[] = [];
    if (!shot) {
      return {
        shotId: input.shotId,
        startMs: input.startMs,
        endMs: input.startMs,
        totalDurationMs: 0,
        shotDurationMs: 0,
        remainingDurationMs: 0,
        needsShotExtension: false,
        extensionToMs: null,
        rows: [],
        blockers: [
          {
            code: 'SHOT_NOT_FOUND',
            message: '当前镜头已不存在，请重新选择镜头。',
          },
        ],
        ready: false,
      };
    }

    if (
      !Number.isSafeInteger(input.startMs) ||
      input.startMs < 0 ||
      input.startMs > shot.durationMs
    ) {
      blockers.push({
        code: 'INVALID_START_TIME',
        message: '当前排轴起点无效，请重新定位播放头。',
      });
    }
    if (input.rows.length === 0) {
      blockers.push({
        code: 'EMPTY_BATCH',
        message: '没有可排轴的就绪配音台词。',
      });
    }

    const updatedExistingIds = new Set(
      input.rows
        .map((row) => row.existingDialogueId)
        .filter((id): id is string => id !== undefined),
    );
    const existingTimedDialogues = shot.dialogues.filter(
      (dialogue) =>
        dialogue.endMs > dialogue.startMs &&
        !updatedExistingIds.has(dialogue.id),
    );

    const plannedRows: PlannedDialogueAudioRow[] = [];
    let cursor =
      Number.isSafeInteger(input.startMs) && input.startMs >= 0
        ? input.startMs
        : 0;

    for (const row of input.rows) {
      let valid = true;
      const trimmedText = row.text.trim();
      if (trimmedText.length === 0) {
        blockers.push({
          code: 'INVALID_TEXT',
          message: `第 ${row.sourceLineNumber} 行台词为空。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }

      if (row.speakerType !== DIALOGUE_SPEAKER_NARRATOR) {
        const character = row.characterId
          ? project.characters.find(
              (candidate) => candidate.id === row.characterId,
            )
          : undefined;
        if (!character) {
          blockers.push({
            code: 'CHARACTER_NOT_FOUND',
            message: `第 ${row.sourceLineNumber} 行的角色已不存在，请重新选择。`,
            draftRowId: row.draftRowId,
            sourceLineNumber: row.sourceLineNumber,
          });
          valid = false;
        }
      }

      if (row.existingDialogueId !== undefined) {
        const exists = shot.dialogues.some(
          (candidate) => candidate.id === row.existingDialogueId,
        );
        if (!exists) {
          blockers.push({
            code: 'DIALOGUE_NOT_FOUND',
            message: `第 ${row.sourceLineNumber} 行对应的已有字幕已不存在。`,
            draftRowId: row.draftRowId,
            sourceLineNumber: row.sourceLineNumber,
          });
          valid = false;
        }
      }

      const asset = project.assets.find(
        (candidate) => candidate.id === row.audioAssetId,
      );
      if (!asset || asset.kind !== 'audio') {
        blockers.push({
          code: 'AUDIO_ASSET_NOT_FOUND',
          message: `第 ${row.sourceLineNumber} 行所选配音不存在。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      } else if (!isAudioAssetReady(asset)) {
        blockers.push({
          code: 'AUDIO_ASSET_NOT_READY',
          message: `第 ${row.sourceLineNumber} 行配音尚未就绪。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }

      if (!valid || !asset || asset.kind !== 'audio') continue;

      const sourceStartMs = row.sourceStartMs ?? 0;
      const sourceEndMs = row.sourceEndMs ?? asset.durationMs!;
      if (
        !Number.isSafeInteger(sourceStartMs) ||
        !Number.isSafeInteger(sourceEndMs) ||
        sourceStartMs < 0 ||
        sourceEndMs <= sourceStartMs ||
        sourceEndMs > asset.durationMs!
      ) {
        blockers.push({
          code: 'SOURCE_RANGE_INVALID',
          message: `第 ${row.sourceLineNumber} 行音频源区间 ${sourceStartMs}–${sourceEndMs}ms 无效。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
        });
        continue;
      }

      const durationMs = sourceEndMs - sourceStartMs;
      const endMs = cursor + durationMs;
      if (!Number.isSafeInteger(endMs) || endMs <= cursor) {
        blockers.push({
          code: 'TIME_OVERFLOW',
          message: `第 ${row.sourceLineNumber} 行排轴时间超出范围。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
        });
        continue;
      }

      const conflict = existingTimedDialogues.find(
        (dialogue) => cursor < dialogue.endMs && endMs > dialogue.startMs,
      );
      if (conflict) {
        blockers.push({
          code: 'DIALOGUE_OVERLAP',
          message: `第 ${row.sourceLineNumber} 行（${formatAudioDurationMs(cursor)}–${formatAudioDurationMs(endMs)}）与已有字幕（${formatAudioDurationMs(conflict.startMs)}–${formatAudioDurationMs(conflict.endMs)}）重叠，请移动播放头或调整已有字幕。`,
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
          conflictDialogueId: conflict.id,
          conflictRangeMs: {
            startMs: conflict.startMs,
            endMs: conflict.endMs,
          },
        });
        cursor = endMs;
        continue;
      }

      plannedRows.push({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: trimmedText,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        ...(row.existingDialogueId
          ? { existingDialogueId: row.existingDialogueId }
          : {}),
        audioAssetId: asset.id,
        sourceStartMs,
        sourceEndMs,
        durationMs,
        startMs: cursor,
        endMs,
      });
      cursor = endMs;
    }

    const ready =
      blockers.length === 0 && plannedRows.length === input.rows.length;
    const endMs = ready ? cursor : input.startMs;
    const totalDurationMs = ready ? endMs - input.startMs : 0;
    const needsShotExtension = ready && endMs > shot.durationMs;

    return {
      shotId: shot.id,
      startMs: input.startMs,
      endMs,
      totalDurationMs,
      shotDurationMs: shot.durationMs,
      remainingDurationMs: Math.max(0, shot.durationMs - input.startMs),
      needsShotExtension,
      extensionToMs: needsShotExtension ? endMs : null,
      rows: plannedRows,
      blockers,
      ready,
    };
  }

  apply(
    project: Project,
    input: ApplyDialogueAudioScheduleInput,
  ): ApplyDialogueAudioScheduleResult {
    const plan = this.plan(project, input);
    if (plan.blockers.length > 0 || !plan.ready) {
      const blocker = plan.blockers[0] ?? {
        code: 'EMPTY_BATCH' as const,
        message: '没有可排轴的就绪配音台词。',
      };
      throw new AutoSubtitleAudioError(
        blocker.code,
        blocker.message,
        blocker.sourceLineNumber,
      );
    }

    if (plan.needsShotExtension && input.extendShotToMs === undefined) {
      throw new AutoSubtitleAudioError(
        'EXTENSION_REQUIRED',
        `本批排轴需要将镜头延长至 ${formatAudioDurationMs(plan.extensionToMs!)}，请先确认延长。`,
      );
    }
    if (
      (plan.needsShotExtension && input.extendShotToMs !== plan.extensionToMs) ||
      (!plan.needsShotExtension && input.extendShotToMs !== undefined)
    ) {
      throw new AutoSubtitleAudioError(
        'STALE_EXTENSION_CONFIRMATION',
        '镜头或排轴预览已变化，请重新确认延长时长。',
      );
    }

    const initialShot = project.shots.find((shot) => shot.id === plan.shotId)!;
    const previousShotDurationMs = initialShot.durationMs;
    const preparedProject = plan.needsShotExtension
      ? this.shots.setDuration(project, plan.shotId, plan.extensionToMs!)
      : project;

    const batchResult = this.dialogues.createManyTimedWithAudio(
      preparedProject,
      {
        shotId: plan.shotId,
        lines: plan.rows.map((row) => ({
          ...(row.existingDialogueId
            ? { existingDialogueId: row.existingDialogueId }
            : {}),
          speakerType: row.speakerType,
          ...(row.characterId ? { characterId: row.characterId } : {}),
          text: row.text,
          startMs: row.startMs,
          endMs: row.endMs,
          audioAssetId: row.audioAssetId,
          offsetMs: row.sourceStartMs,
        })),
      },
    );

    const validatedProject = ProjectSchema.parse(batchResult.project);
    const resultShot = validatedProject.shots.find(
      (shot) => shot.id === plan.shotId,
    )!;

    // Verify exact post-commit invariants: subtitle timing, audio clip timing,
    // source offset, asset binding, and role match the plan identically.
    const invariantFailed = plan.rows.some((row, index) => {
      const dialogueId = batchResult.dialogueIds[index];
      const dialogue = resultShot.dialogues.find(
        (candidate) => candidate.id === dialogueId,
      );
      const clip = resultShot.audioClips.find(
        (candidate) => candidate.id === dialogue?.audioClipId,
      );
      return (
        !dialogue ||
        dialogue.startMs !== row.startMs ||
        dialogue.endMs !== row.endMs ||
        !clip ||
        clip.role !== 'dialogue' ||
        clip.assetId !== row.audioAssetId ||
        clip.startMs !== row.startMs ||
        clip.endMs !== row.endMs ||
        clip.offsetMs !== row.sourceStartMs
      );
    });

    if (invariantFailed) {
      throw new AutoSubtitleAudioError(
        'GENERATION_INVARIANT_FAILED',
        '生成结果未能保持字幕、配音区间和源 offset 一致；工程未提交任何更改。',
      );
    }

    return {
      project: validatedProject,
      plan,
      dialogueIds: batchResult.dialogueIds,
      audioClipIds: batchResult.audioClipIds,
      previousShotDurationMs,
      nextShotDurationMs: resultShot.durationMs,
    };
  }
}
