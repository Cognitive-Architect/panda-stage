import {
  reconcileDialogueMouthPoses,
  type DialogueMouthPoseMove,
} from './mouthPoses';
import {
  DIALOGUE_SPEAKER_CHARACTER,
  DIALOGUE_SPEAKER_NARRATOR,
  ProjectSchema,
  type AudioAsset,
  type AudioClip,
  type Character,
  type Dialogue,
  type DialogueSpeakerType,
  type Project,
  type Shot,
} from '../models';
import { integerFrameSpanMs } from '../timeline/frame-grid';

const MIN_TIMED_DIALOGUE_DURATION_MS = 1;

export type DialogueServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DIALOGUE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'DIALOGUE_SPEAKER_INVALID'
  | 'INVALID_DIALOGUE_TIME'
  | 'INVALID_DIALOGUE_DURATION'
  | 'INVALID_DIALOGUE_TEXT'
  | 'DIALOGUE_OVERLAP'
  | 'DIALOGUE_NO_AVAILABLE_SLOT'
  | 'DIALOGUE_BATCH_TOO_SMALL'
  | 'DIALOGUE_NOT_TIMED'
  | 'DIALOGUE_BATCH_OUT_OF_RANGE'
  | 'AUDIO_ASSET_NOT_FOUND'
  | 'AUDIO_ASSET_NOT_AUDIO'
  | 'AUDIO_ASSET_DURATION_UNAVAILABLE'
  | 'AUDIO_CLIP_NOT_FOUND'
  | 'AUDIO_CLIP_TOO_SHORT'
  | 'AUDIO_CLIP_OUT_OF_RANGE'
  | 'AUDIO_DIALOGUE_NO_ROOM'
  | 'ID_GENERATION_FAILED';

export class DialogueServiceError extends Error {
  constructor(
    readonly code: DialogueServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DialogueServiceError';
  }
}

export interface CreateDialogueInput {
  shotId: string;
  /** Character speaker: the project Character that owns the voice. */
  characterId?: string;
  /**
   * `narrator` creates a formless narration line: no Character, no VoiceProfile,
   * and therefore no mouth/focus target. Absent means a Character dialogue.
   */
  speakerType?: DialogueSpeakerType;
  text: string;
  pointTimeMs: number;
}

export interface CreateManyDialogueInput {
  shotId: string;
  pointTimeMs: number;
  lines: ReadonlyArray<{
    characterId?: string;
    speakerType?: DialogueSpeakerType;
    text: string;
  }>;
}

export interface CreateTimedAudioDialogueLine {
  /** Optional existing formal Dialogue.id in this shot to update in place. */
  existingDialogueId?: string;
  characterId?: string;
  speakerType?: DialogueSpeakerType;
  text: string;
  startMs: number;
  endMs: number;
  audioAssetId: string;
  /** Explicit source start offset in milliseconds (defaults to 0). */
  offsetMs?: number;
}

export interface CreateManyTimedWithAudioInput {
  shotId: string;
  lines: ReadonlyArray<CreateTimedAudioDialogueLine>;
}

export interface CreateManyTimedWithAudioResult {
  project: Project;
  dialogueIds: string[];
  audioClipIds: string[];
}

export interface UpdateDialogueInput {
  shotId: string;
  dialogueId: string;
  /**
   * Switching to `narrator` clears the Character binding. Switching to
   * `character` (or supplying `characterId`) restores the full Character
   * contract, including the Character default VoiceProfile.
   */
  speakerType?: DialogueSpeakerType;
  characterId?: string;
  text?: string;
}

export interface DialogueTextMatch {
  shotId: string;
  dialogueId: string;
  text: string;
  offset: number;
}

export interface DialogueTextSearch {
  query: string;
  /** Null means the entire project. */
  shotId: string | null;
}

export function* findDialogueText(project: Project, { query, shotId }: DialogueTextSearch): IterableIterator<DialogueTextMatch> {
  if (!query) return;
  for (const shot of project.shots) {
    if (shotId !== null && shot.id !== shotId) continue;
    const dialogues = [...shot.dialogues].sort((a, b) => a.startMs - b.startMs);
    for (const { id, text } of dialogues) {
      for (let offset = text.indexOf(query); offset !== -1; offset = text.indexOf(query, offset + query.length)) {
        yield { shotId: shot.id, dialogueId: id, text, offset };
      }
    }
  }
}

export interface SetDialogueTimingInput {
  shotId: string;
  dialogueId: string;
  startMs: number;
  endMs: number;
}

export interface ArrangeDialogueInput {
  shotId: string;
  dialogueId: string;
  frameSpanMs: number;
  /** Optional explicit start point used by Timeline direct manipulation. */
  startMs?: number;
}

export interface DialogueArrangementTiming {
  startMs: number;
  endMs: number;
}

export interface MoveDialogueInput {
  shotId: string;
  dialogueId: string;
  deltaMs: number;
}

export type SharedAudioClipPolicy = 'split' | 'include';

export type BatchBoundaryMode = 'reject' | 'clamp';

export interface MoveManyDialoguesInput {
  readonly shotId: string;
  readonly dialogueIds: readonly string[];
  readonly deltaMs: number;
  /**
   * How to handle an AudioClip shared with an unselected Dialogue:
   * - `'split'` (default): keep the original clip untouched for unselected
   *   dialogues and create a shifted copy for the selected dialogues.
   * - `'include'`: explicitly include the unselected dialogues that share the
   *   clip into the batch shift so they move together with one unified delta.
   */
  readonly sharedClipPolicy?: SharedAudioClipPolicy;
  /**
   * How to handle shot boundary limits:
   * - `'reject'` (default): reject deltas outside the group's legal range.
   * - `'clamp'`: clamp the single unified delta for the whole group to
   *   `[minDeltaMs, maxDeltaMs]` without per-item clamping.
   */
  readonly boundaryMode?: BatchBoundaryMode;
}

export interface DialogueBatchMoveEntry {
  readonly dialogueId: string;
  readonly characterId?: string;
  readonly speakerType?: DialogueSpeakerType;
  readonly originalStartMs: number;
  readonly originalEndMs: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly audioClipId: string | null;
  readonly audioStartMs: number | null;
  readonly audioEndMs: number | null;
  readonly includedBySharedClip: boolean;
}

export interface DialogueBatchMovePlan {
  readonly shotId: string;
  readonly requestedDeltaMs: number;
  readonly deltaMs: number;
  readonly clamped: boolean;
  readonly allowedDeltaRange: {
    readonly minDeltaMs: number;
    readonly maxDeltaMs: number;
  };
  readonly sharedClipPolicy: SharedAudioClipPolicy;
  readonly entries: readonly DialogueBatchMoveEntry[];
  readonly includedDialogueIds: readonly string[];
  readonly splitAudioClipIds: readonly string[];
  readonly earliestStartMs: number;
  readonly latestEndMs: number;
  readonly audioClipCount: number;
}

export interface ResizeDialogueInput {
  shotId: string;
  dialogueId: string;
  edge: 'start' | 'end';
  timeMs: number;
}

export interface BindDialogueAudioInput {
  shotId: string;
  dialogueId: string;
  assetId: string;
}

export interface ResizeBoundAudioEndInput {
  shotId: string;
  dialogueId: string;
  endMs: number;
}

export interface BoundAudioEndRangeInput {
  shotDurationMs: number;
  dialogueEndMs: number;
  clipStartMs: number;
  clipOffsetMs: number;
  sourceDurationMs: number;
}

export interface BoundAudioEndRange {
  minimumEndMs: number;
  maximumEndMs: number;
}

/**
 * One shared legal range for both Timeline and Inspector tail controls.
 * The bound clip remains constrained by Shot, Dialogue, and available source.
 */
export function getBoundAudioEndRange(
  input: BoundAudioEndRangeInput,
): BoundAudioEndRange | null {
  const minimumEndMs = input.clipStartMs + MIN_TIMED_DIALOGUE_DURATION_MS;
  const sourceEndMs =
    input.clipStartMs +
    Math.max(0, input.sourceDurationMs - input.clipOffsetMs);
  const maximumEndMs = Math.min(
    input.shotDurationMs,
    input.dialogueEndMs,
    sourceEndMs,
  );
  return maximumEndMs < minimumEndMs
    ? null
    : { minimumEndMs, maximumEndMs };
}

export interface DialogueServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

/**
 * Pure Project → Project dialogue mutation owner. Point-time and frame span are
 * supplied as plain integer milliseconds; Timeline geometry remains renderer
 * state and is never imported into the domain.
 */
export class DialogueService {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: DialogueServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  /** Day27 contract: newly authored Dialogue is Untimed at one captured point. */
  create(project: Project, input: CreateDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const timeMs = this.clampTime(shot, input.pointTimeMs);
    const speaker = this.resolveNewSpeaker(project, input);
    const dialogue: Dialogue = {
      id: this.nextId(this.collectIds(project)),
      ...speaker,
      subtitleStyleId: shot.defaultSubtitleStyleId,
      startMs: timeMs,
      endMs: timeMs,
      text: this.validText(input.text),
    };
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: [...shot.dialogues, dialogue],
    });
  }

  /**
   * Day27 batch contract: every line shares one captured point-time and the
   * returned Project is committed by the renderer as one History command.
   * Narration and Character lines may be mixed in one batch.
   */
  createMany(project: Project, input: CreateManyDialogueInput): Project {
    if (input.lines.length === 0) return project;
    const shot = this.shot(project, input.shotId);
    const timeMs = this.clampTime(shot, input.pointTimeMs);
    const usedIds = this.collectIds(project);
    const added: Dialogue[] = input.lines.map((line) => {
      const speaker = this.resolveNewSpeaker(project, line);
      return {
        id: this.nextId(usedIds),
        ...speaker,
        subtitleStyleId: shot.defaultSubtitleStyleId,
        startMs: timeMs,
        endMs: timeMs,
        text: this.validText(line.text),
      };
    });
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: [...shot.dialogues, ...added],
    });
  }

  /**
   * Thin official batch path for WF-01 / WF-04 timed dialogue + real audio
   * scheduling. Preserves exact integer timing and source offset without
   * triggering one-frame placeholder extension or silent tail clamping, while
   * reusing official ID generation, speaker/audio validation, clip ownership,
   * mouth-pose reconciliation, and ProjectSchema validation.
   */
  createManyTimedWithAudio(
    project: Project,
    input: CreateManyTimedWithAudioInput,
  ): CreateManyTimedWithAudioResult {
    if (input.lines.length === 0) {
      return { project, dialogueIds: [], audioClipIds: [] };
    }
    const shot = this.shot(project, input.shotId);
    const usedIds = this.collectIds(project);
    const nextDialogues = [...shot.dialogues];
    let nextAudioClips = [...shot.audioClips];
    const dialogueIds: string[] = [];
    const audioClipIds: string[] = [];
    const updatedExistingIds = new Set<string>();

    for (const line of input.lines) {
      const text = this.validText(line.text);
      const asset = this.audioAsset(project, line.audioAssetId);
      const startMs = this.validInteger(line.startMs, '对白开始时间');
      const endMs = this.validInteger(line.endMs, '对白结束时间');
      if (startMs < 0 || endMs > shot.durationMs) {
        throw new DialogueServiceError(
          'INVALID_DIALOGUE_TIME',
          `对白时间区间 ${startMs}–${endMs}ms 超出镜头范围（0–${shot.durationMs}ms）。`,
        );
      }
      const durationMs = endMs - startMs;
      if (durationMs < MIN_TIMED_DIALOGUE_DURATION_MS) {
        throw new DialogueServiceError(
          'INVALID_DIALOGUE_DURATION',
          '对白结束时间必须晚于开始时间。',
        );
      }
      const offsetMs = line.offsetMs ?? 0;
      this.validInteger(offsetMs, '音频源起点');
      if (offsetMs < 0) {
        throw new DialogueServiceError(
          'INVALID_DIALOGUE_TIME',
          `音频源起点不能为负数：${offsetMs}`,
        );
      }
      this.assertAudioRange(asset, offsetMs, durationMs);

      if (line.existingDialogueId !== undefined) {
        if (updatedExistingIds.has(line.existingDialogueId)) {
          throw new DialogueServiceError(
            'DIALOGUE_OVERLAP',
            `批次中重复指定了已有对白：${line.existingDialogueId}`,
          );
        }
        const existingIndex = nextDialogues.findIndex(
          (candidate) => candidate.id === line.existingDialogueId,
        );
        if (existingIndex < 0) {
          throw new DialogueServiceError(
            'DIALOGUE_NOT_FOUND',
            `找不到对白：${line.existingDialogueId}`,
          );
        }
        updatedExistingIds.add(line.existingDialogueId);
        const existing = nextDialogues[existingIndex]!;
        this.assertNoOverlap(
          nextDialogues.filter((candidate) => candidate.id !== existing.id),
          { startMs, endMs },
        );

        let updatedDialogue: Dialogue = { ...existing, text, startMs, endMs };
        if (line.speakerType === DIALOGUE_SPEAKER_NARRATOR) {
          updatedDialogue = this.asNarrator(updatedDialogue);
        } else {
          updatedDialogue = this.asCharacter(
            project,
            updatedDialogue,
            line.characterId,
          );
        }

        const existingClip = existing.audioClipId
          ? nextAudioClips.find((clip) => clip.id === existing.audioClipId) ?? null
          : null;
        const existingReferences = existingClip
          ? nextDialogues.filter(
              (candidate) => candidate.audioClipId === existingClip.id,
            ).length
          : 0;
        const clipId =
          existingClip && existingReferences === 1
            ? existingClip.id
            : this.nextId(usedIds);
        const sameAsset = existingClip?.assetId === asset.id;
        const nextClip: AudioClip = {
          id: clipId,
          role: 'dialogue',
          name: sameAsset ? existingClip.name : asset.name,
          assetId: asset.id,
          startMs,
          endMs,
          offsetMs,
          volume: sameAsset ? existingClip.volume : 1,
        };
        nextAudioClips =
          existingClip && existingReferences === 1
            ? nextAudioClips.map((clip) =>
                clip.id === existingClip.id ? nextClip : clip,
              )
            : [...nextAudioClips, nextClip];
        nextDialogues[existingIndex] = {
          ...updatedDialogue,
          audioClipId: clipId,
        };
        dialogueIds.push(existing.id);
        audioClipIds.push(clipId);
      } else {
        this.assertNoOverlap(nextDialogues, { startMs, endMs });
        const speaker = this.resolveNewSpeaker(project, line);
        const dialogueId = this.nextId(usedIds);
        const clipId = this.nextId(usedIds);
        const nextClip: AudioClip = {
          id: clipId,
          role: 'dialogue',
          name: asset.name,
          assetId: asset.id,
          startMs,
          endMs,
          offsetMs,
          volume: 1,
        };
        const nextDialogue: Dialogue = {
          id: dialogueId,
          ...speaker,
          subtitleStyleId: shot.defaultSubtitleStyleId,
          startMs,
          endMs,
          text,
          audioClipId: clipId,
        };
        nextDialogues.push(nextDialogue);
        nextAudioClips = [...nextAudioClips, nextClip];
        dialogueIds.push(dialogueId);
        audioClipIds.push(clipId);
      }
    }

    const nextProject = this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: nextDialogues,
      audioClips: nextAudioClips,
    });
    return {
      project: nextProject,
      dialogueIds,
      audioClipIds,
    };
  }

  update(project: Project, input: UpdateDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    let next: Dialogue = dialogue;
    if (input.text !== undefined) {
      next = { ...next, text: this.validText(input.text) };
    }
    const requestedSpeakerType =
      input.speakerType ??
      (input.characterId === undefined ? undefined : DIALOGUE_SPEAKER_CHARACTER);
    if (requestedSpeakerType === DIALOGUE_SPEAKER_NARRATOR) {
      next = this.asNarrator(next);
    } else if (requestedSpeakerType === DIALOGUE_SPEAKER_CHARACTER) {
      next = this.asCharacter(
        project,
        next,
        input.characterId ?? dialogue.characterId,
      );
    }
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id ? next : candidate,
      ),
    });
  }

  replaceText(project: Project, search: DialogueTextSearch, replacement: string, match?: DialogueTextMatch): Project {
    const { query, shotId } = search;
    if (!query || query === replacement || (match &&
      (!Number.isSafeInteger(match.offset) || match.offset < 0))) return project;
    let changed = false;
    const shots = project.shots.map((shot) => {
      if ((shotId !== null && shot.id !== shotId) || (match && shot.id !== match.shotId)) return shot;
      let shotChanged = false;
      const dialogues = shot.dialogues.map((dialogue) => {
        const { text } = dialogue;
        if (match && (dialogue.id !== match.dialogueId || text !== match.text ||
          !text.startsWith(query, match.offset))) return dialogue;
        if (!text.includes(query)) return dialogue;
        const replaced = match
          ? text.slice(0, match.offset) + replacement + text.slice(match.offset + query.length)
          : text.replaceAll(query, () => replacement);
        const next = this.validText(replaced);
        if (next.length > 10_000) {
          throw new DialogueServiceError('INVALID_DIALOGUE_TEXT', '替换后的台词不能超过 10000 个字符。');
        }
        if (next === text) return dialogue;
        shotChanged = true;
        return { ...dialogue, text: next };
      });
      if (!shotChanged) return shot;
      changed = true;
      return { ...shot, dialogues };
    });
    return changed ? this.finish(project, { ...project, shots }) : project;
  }

  /** Explicitly commits a positive Timed interval. */
  setTiming(project: Project, input: SetDialogueTimingInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    const timing = this.validTimedWindow(shot, input.startMs, input.endMs);
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return this.replaceDialogueTiming(project, shot, dialogue.id, timing);
  }

  /**
   * Atomically binds one Ready AudioAsset to one timed Dialogue. The Dialogue
   * reference and Shot AudioClip change in one Project snapshot so the
   * renderer records exactly one History command.
   *
   * A first bind onto a still-untouched one-frame placeholder also grows that
   * placeholder — Dialogue window and clip together, in the same snapshot — to
   * the detected source duration, so a real recording is never reported as a
   * single frame.
   */
  bindAudio(project: Project, input: BindDialogueAudioInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    this.timedDuration(dialogue);
    const asset = this.audioAsset(project, input.assetId);
    const existingClip = dialogue.audioClipId
      ? this.audioClip(shot, dialogue.audioClipId)
      : null;
    const existingReferences = existingClip
      ? shot.dialogues.filter(
          (candidate) => candidate.audioClipId === existingClip.id,
        ).length
      : 0;
    const sameAsset = existingClip?.assetId === asset.id;

    // Preserve an independently trimmed clip when the same asset is selected.
    if (existingClip && sameAsset) return project;

    const offsetMs = sameAsset ? existingClip.offsetMs : 0;
    const volume = sameAsset ? existingClip.volume : 1;
    const name = sameAsset ? existingClip.name : asset.name;
    const firstBindTiming = this.firstBindDialogueTiming(
      shot,
      dialogue,
      asset,
      existingClip,
    );
    const timing = firstBindTiming
      ? firstBindTiming
      : this.initialAudioTiming(dialogue, asset, offsetMs);
    this.assertAudioRange(asset, offsetMs, timing.endMs - timing.startMs);

    const clipId =
      existingClip && existingReferences === 1
        ? existingClip.id
        : this.nextId(this.collectIds(project));
    const nextClip: AudioClip = {
      id: clipId,
      role: 'dialogue',
      name,
      assetId: asset.id,
      startMs: timing.startMs,
      endMs: timing.endMs,
      offsetMs,
      volume,
    };
    const nextAudioClips = existingClip
      ? existingReferences === 1
        ? shot.audioClips.map((clip) =>
            clip.id === existingClip.id ? nextClip : clip,
          )
        : [...shot.audioClips, nextClip]
      : [...shot.audioClips, nextClip];

    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips: nextAudioClips,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id
          ? { ...candidate, ...(firstBindTiming ?? {}), audioClipId: clipId }
          : candidate,
      ),
    });
  }

  /**
   * Explicit Untimed → Timed action. The renderer derives frameSpanMs from
   * Day26 frameDurationMs()/snapToFrame() and passes the integer span as data.
   */
  arrange(project: Project, input: ArrangeDialogueInput): Project {
    const timing = this.getArrangementTiming(project, input);
    const shot = this.shot(project, input.shotId);
    return this.replaceDialogueTiming(project, shot, input.dialogueId, timing);
  }

  /** Resolve an arrangement without changing Project, History, or revision. */
  getArrangementTiming(
    project: Project,
    input: ArrangeDialogueInput,
  ): DialogueArrangementTiming {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    if (dialogue.endMs !== dialogue.startMs) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '只有未定时对白可以使用“一帧安排”。',
      );
    }
    this.validPositiveInteger(input.frameSpanMs, '默认帧时长');
    const spanMs = Math.min(input.frameSpanMs, shot.durationMs);
    if (spanMs < MIN_TIMED_DIALOGUE_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '镜头时长不足，无法安排对白。',
      );
    }
    const timing =
      input.startMs === undefined
        ? this.findFirstAvailableTiming(
            shot.dialogues.filter(
              (candidate) => candidate.id !== dialogue.id,
            ),
            dialogue.startMs,
            spanMs,
            shot.durationMs,
          )
        : this.explicitArrangementTiming(shot, input.startMs, spanMs);
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return timing;
  }

  move(project: Project, input: MoveDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    this.validInteger(input.deltaMs, '移动量');
    const duration = this.timedDuration(dialogue);
    const startMs = Math.min(
      Math.max(dialogue.startMs + input.deltaMs, 0),
      shot.durationMs - duration,
    );
    const timing = { startMs, endMs: startMs + duration };
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return this.replaceMovedDialogueTiming(
      project,
      shot,
      dialogue.id,
      timing,
      startMs - dialogue.startMs,
    );
  }

  /**
   * Validates a batch shift of timed Dialogues (and bound AudioClips) from the
   * original Shot snapshot without mutating Project. Uses a single unified
   * delta for the entire group so adjacent lines never cause false intermediate
   * collisions and relative spacing is always preserved.
   */
  planMoveMany(
    project: Project,
    input: MoveManyDialoguesInput,
  ): DialogueBatchMovePlan {
    const shot = this.shot(project, input.shotId);
    this.validInteger(input.deltaMs, '移动量');
    const requestedIds = [...new Set(input.dialogueIds)];
    if (requestedIds.length < 1) {
      throw new DialogueServiceError(
        'DIALOGUE_BATCH_TOO_SMALL',
        '至少选择一条对白才能移动。',
      );
    }

    const sharedClipPolicy: SharedAudioClipPolicy =
      input.sharedClipPolicy ?? 'split';
    const boundaryMode: BatchBoundaryMode = input.boundaryMode ?? 'reject';

    const requestedDialogues = requestedIds.map((dialogueId) =>
      this.dialogue(shot, dialogueId),
    );
    const requestedSet = new Set(requestedIds);

    const referencedClipIds = new Set<string>();
    for (const dialogue of requestedDialogues) {
      if (dialogue.audioClipId) referencedClipIds.add(dialogue.audioClipId);
    }

    const includedDialogueIds: string[] = [];
    const splitAudioClipIds: string[] = [];
    const effectiveIds = new Set(requestedIds);

    for (const clipId of referencedClipIds) {
      const unselectedSharing = shot.dialogues.filter(
        (candidate) =>
          candidate.audioClipId === clipId && !requestedSet.has(candidate.id),
      );
      if (unselectedSharing.length === 0) continue;
      if (sharedClipPolicy === 'include') {
        for (const candidate of unselectedSharing) {
          if (!effectiveIds.has(candidate.id)) {
            effectiveIds.add(candidate.id);
            includedDialogueIds.push(candidate.id);
          }
        }
      } else {
        splitAudioClipIds.push(clipId);
      }
    }

    const effectiveDialogues = shot.dialogues.filter((candidate) =>
      effectiveIds.has(candidate.id),
    );
    for (const dialogue of effectiveDialogues) {
      if (dialogue.endMs <= dialogue.startMs) {
        throw new DialogueServiceError(
          'DIALOGUE_NOT_TIMED',
          `「${this.dialogueLabel(project, dialogue)}」还没有确定时长，不能整体移动。`,
        );
      }
    }

    // Validate all referenced audio clips once and compute group delta bounds.
    const clipsById = new Map<string, AudioClip>();
    let minDeltaMs = Number.NEGATIVE_INFINITY;
    let maxDeltaMs = Number.POSITIVE_INFINITY;
    for (const dialogue of effectiveDialogues) {
      minDeltaMs = Math.max(minDeltaMs, -dialogue.startMs);
      maxDeltaMs = Math.min(maxDeltaMs, shot.durationMs - dialogue.endMs);
      if (!dialogue.audioClipId) continue;
      if (!clipsById.has(dialogue.audioClipId)) {
        const clip = this.audioClip(shot, dialogue.audioClipId);
        const asset = this.audioAsset(project, clip.assetId);
        this.assertAudioRange(asset, clip.offsetMs, clip.endMs - clip.startMs);
        clipsById.set(clip.id, clip);
        minDeltaMs = Math.max(minDeltaMs, -clip.startMs);
        maxDeltaMs = Math.min(maxDeltaMs, shot.durationMs - clip.endMs);
      }
    }

    const effectiveDeltaMs =
      boundaryMode === 'clamp'
        ? Math.min(Math.max(input.deltaMs, minDeltaMs), maxDeltaMs)
        : input.deltaMs;
    const clamped = effectiveDeltaMs !== input.deltaMs;

    const obstacles = shot.dialogues.filter(
      (candidate) => !effectiveIds.has(candidate.id),
    );
    const direction = input.deltaMs < 0 ? '向前' : '向后';
    const deltaLabel = this.formatDeltaSeconds(input.deltaMs);

    const entries = effectiveDialogues.map(
      (dialogue): DialogueBatchMoveEntry => {
        const startMs = dialogue.startMs + effectiveDeltaMs;
        const endMs = dialogue.endMs + effectiveDeltaMs;
        if (startMs < 0) {
          throw new DialogueServiceError(
            'DIALOGUE_BATCH_OUT_OF_RANGE',
            `再${direction}移动 ${deltaLabel} 秒会超出镜头开头。`,
          );
        }
        if (endMs > shot.durationMs) {
          throw new DialogueServiceError(
            'DIALOGUE_BATCH_OUT_OF_RANGE',
            `再${direction}移动 ${deltaLabel} 秒会超出镜头结尾。`,
          );
        }

        const conflict = obstacles.find(
          (candidate) =>
            candidate.endMs > candidate.startMs &&
            startMs < candidate.endMs &&
            endMs > candidate.startMs,
        );
        if (conflict) {
          throw new DialogueServiceError(
            'DIALOGUE_OVERLAP',
            `「${this.dialogueLabel(project, dialogue)}」移动后会与「${this.dialogueLabel(
              project,
              conflict,
            )}」的对白重叠；首尾相接可以。`,
          );
        }

        if (!dialogue.audioClipId) {
          return {
            dialogueId: dialogue.id,
            ...(dialogue.characterId !== undefined
              ? { characterId: dialogue.characterId }
              : {}),
            ...(dialogue.speakerType !== undefined
              ? { speakerType: dialogue.speakerType }
              : {}),
            originalStartMs: dialogue.startMs,
            originalEndMs: dialogue.endMs,
            startMs,
            endMs,
            audioClipId: null,
            audioStartMs: null,
            audioEndMs: null,
            includedBySharedClip: !requestedSet.has(dialogue.id),
          };
        }

        const clip = clipsById.get(dialogue.audioClipId)!;
        const audioStartMs = clip.startMs + effectiveDeltaMs;
        const audioEndMs = clip.endMs + effectiveDeltaMs;
        if (audioStartMs < 0 || audioEndMs > shot.durationMs) {
          throw new DialogueServiceError(
            'AUDIO_CLIP_OUT_OF_RANGE',
            `「${this.dialogueLabel(project, dialogue)}」的配音会超出镜头范围。`,
          );
        }
        return {
          dialogueId: dialogue.id,
          ...(dialogue.characterId !== undefined
            ? { characterId: dialogue.characterId }
            : {}),
          ...(dialogue.speakerType !== undefined
            ? { speakerType: dialogue.speakerType }
            : {}),
          originalStartMs: dialogue.startMs,
          originalEndMs: dialogue.endMs,
          startMs,
          endMs,
          audioClipId: clip.id,
          audioStartMs,
          audioEndMs,
          includedBySharedClip: !requestedSet.has(dialogue.id),
        };
      },
    );

    return {
      shotId: shot.id,
      requestedDeltaMs: input.deltaMs,
      deltaMs: effectiveDeltaMs,
      clamped,
      allowedDeltaRange: { minDeltaMs, maxDeltaMs },
      sharedClipPolicy,
      entries,
      includedDialogueIds,
      splitAudioClipIds,
      earliestStartMs: Math.min(...entries.map((entry) => entry.startMs)),
      latestEndMs: Math.max(...entries.map((entry) => entry.endMs)),
      audioClipCount: clipsById.size,
    };
  }

  /**
   * Shifts multiple Timed Dialogues, their bound AudioClips, and their bound
   * MouthPoseEvents together in one atomic Shot replacement. Shared AudioClips
   * are shifted at most once and never silently moved for unselected dialogues.
   */
  moveMany(project: Project, input: MoveManyDialoguesInput): Project {
    const plan = this.planMoveMany(project, input);
    if (plan.deltaMs === 0) return project;

    const shot = this.shot(project, input.shotId);
    const entryByDialogueId = new Map(
      plan.entries.map((entry) => [entry.dialogueId, entry]),
    );
    const effectiveIds = new Set(entryByDialogueId.keys());

    const usedIds = this.collectIds(project);
    const replacedClips = new Map<string, AudioClip>();
    const clipIdForSelected = new Map<string, string>();
    const appendedClips: AudioClip[] = [];
    const selectedIdsByClipId = new Map<string, Set<string>>();

    for (const dialogue of shot.dialogues) {
      if (!effectiveIds.has(dialogue.id) || !dialogue.audioClipId) continue;
      const ids = selectedIdsByClipId.get(dialogue.audioClipId) ?? new Set();
      ids.add(dialogue.id);
      selectedIdsByClipId.set(dialogue.audioClipId, ids);
    }

    for (const [clipId, selectedForClip] of selectedIdsByClipId) {
      const clip = this.audioClip(shot, clipId);
      const references = shot.dialogues.filter(
        (candidate) => candidate.audioClipId === clipId,
      );
      const timing = {
        startMs: clip.startMs + plan.deltaMs,
        endMs: clip.endMs + plan.deltaMs,
      };
      const hasUnselectedReference = references.some(
        (candidate) => !selectedForClip.has(candidate.id),
      );
      if (!hasUnselectedReference) {
        replacedClips.set(clipId, { ...clip, ...timing });
        clipIdForSelected.set(clipId, clipId);
        continue;
      }
      const copy: AudioClip = {
        ...clip,
        id: this.nextId(usedIds),
        ...timing,
      };
      appendedClips.push(copy);
      clipIdForSelected.set(clipId, copy.id);
    }

    const movedDeltas = new Map<string, number>();
    const nextDialogues: Dialogue[] = shot.dialogues.map((dialogue) => {
      const entry = entryByDialogueId.get(dialogue.id);
      if (!entry) return dialogue;
      movedDeltas.set(dialogue.id, plan.deltaMs);
      const audioClipId = dialogue.audioClipId
        ? (clipIdForSelected.get(dialogue.audioClipId) ?? dialogue.audioClipId)
        : undefined;
      const moved: Dialogue = {
        ...dialogue,
        startMs: entry.startMs,
        endMs: entry.endMs,
      };
      if (audioClipId !== undefined) {
        moved.audioClipId = audioClipId;
      }
      return moved;
    });

    return this.replaceShot(
      project,
      shot.id,
      {
        ...shot,
        audioClips: [
          ...shot.audioClips.map(
            (clip) => replacedClips.get(clip.id) ?? clip,
          ),
          ...appendedClips,
        ],
        dialogues: nextDialogues,
      },
      movedDeltas,
    );
  }

  resize(project: Project, input: ResizeDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    this.timedDuration(dialogue);
    this.validInteger(input.timeMs, '调整时间');
    const timing =
      input.edge === 'start'
        ? this.validTimedWindow(shot, input.timeMs, dialogue.endMs)
        : this.validTimedWindow(shot, dialogue.startMs, input.timeMs);
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return this.replaceDialogueTiming(project, shot, dialogue.id, timing);
  }

  remove(project: Project, shotId: string, dialogueId: string): Project {
    const shot = this.shot(project, shotId);
    this.dialogue(shot, dialogueId);
    const detachedShot = this.unbindAndCollectClip(shot, dialogueId);
    return this.replaceShot(project, shot.id, {
      ...detachedShot,
      dialogues: detachedShot.dialogues.filter(
        (candidate) => candidate.id !== dialogueId,
      ),
    });
  }

  duplicate(project: Project, shotId: string, dialogueId: string): { project: Project; dialogueId: string } {
    const shot = this.shot(project, shotId);
    const source = this.dialogue(shot, dialogueId);
    const timing = this.findFirstAvailableTiming(shot.dialogues, source.endMs, this.timedDuration(source), shot.durationMs);
    const deltaMs = timing.startMs - source.startMs;
    const ids = this.collectIds(project);
    const id = this.nextId(ids);
    const sourceClip = source.audioClipId ? this.audioClip(shot, source.audioClipId) : undefined;
    const clip = sourceClip ? {
      ...sourceClip, id: this.nextId(ids),
      startMs: Math.max(0, sourceClip.startMs + deltaMs),
      endMs: Math.min(shot.durationMs, sourceClip.endMs + deltaMs),
      offsetMs: sourceClip.offsetMs + Math.max(0, -(sourceClip.startMs + deltaMs)),
    } : undefined;
    const audio = clip && clip.startMs < clip.endMs ? clip : undefined;
    const generationIds = new Map<string, string>();
    const poses = shot.timelineEvents.flatMap((event) => {
      if (event.type !== 'mouth-pose' || event.dialogueId !== dialogueId ||
          (event.origin === 'generated' && !audio)) return [];
      const generationId = event.generationId
        ? generationIds.get(event.generationId) ?? this.nextId(ids) : undefined;
      if (event.generationId && generationId) generationIds.set(event.generationId, generationId);
      return [{
        ...event, id: this.nextId(ids), startMs: event.startMs + deltaMs, endMs: event.endMs + deltaMs,
        dialogueId: id, ...(generationId ? { generationId } : {}),
      }];
    });
    const replacement: Shot = {
      ...shot,
      dialogues: [...shot.dialogues, { ...source, ...timing, id, audioClipId: audio?.id }],
      audioClips: audio ? [...shot.audioClips, audio] : shot.audioClips,
      timelineEvents: [...shot.timelineEvents, ...poses],
    };
    return { project: this.replaceShot(project, shotId, replacement), dialogueId: id };
  }

  /** Clear one Dialogue voice binding and collect only an orphaned child clip. */
  unbindAudio(project: Project, shotId: string, dialogueId: string): Project {
    const shot = this.shot(project, shotId);
    const dialogue = this.dialogue(shot, dialogueId);
    if (!dialogue.audioClipId) return project;
    return this.replaceShot(
      project,
      shot.id,
      this.unbindAndCollectClip(shot, dialogueId),
    );
  }

  /** Resize only the tail of a bound voice clip, isolated by copy-on-write. */
  resizeBoundAudioEnd(
    project: Project,
    input: ResizeBoundAudioEndInput,
  ): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    if (!dialogue.audioClipId) {
      throw new DialogueServiceError(
        'AUDIO_CLIP_NOT_FOUND',
        '当前对白没有可调整的配音片段。',
      );
    }
    this.validInteger(input.endMs, '配音结束时间');
    const clip = this.audioClip(shot, dialogue.audioClipId);
    const asset = this.audioAsset(project, clip.assetId);
    const range = getBoundAudioEndRange({
      shotDurationMs: shot.durationMs,
      dialogueEndMs: dialogue.endMs,
      clipStartMs: clip.startMs,
      clipOffsetMs: clip.offsetMs,
      sourceDurationMs: asset.durationMs ?? 0,
    });
    if (!range) {
      throw new DialogueServiceError(
        'AUDIO_CLIP_TOO_SHORT',
        '当前配音没有可用的正时长尾部。',
      );
    }
    const endMs = Math.min(
      range.maximumEndMs,
      Math.max(range.minimumEndMs, input.endMs),
    );
    if (endMs === clip.endMs) return project;

    const references = shot.dialogues.filter(
      (candidate) => candidate.audioClipId === clip.id,
    ).length;
    const clipId =
      references === 1 ? clip.id : this.nextId(this.collectIds(project));
    const nextClip: AudioClip = { ...clip, id: clipId, endMs };
    const audioClips =
      references === 1
        ? shot.audioClips.map((candidate) =>
            candidate.id === clip.id ? nextClip : candidate,
          )
        : [...shot.audioClips, nextClip];

    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id
          ? { ...candidate, audioClipId: clipId }
          : candidate,
      ),
    });
  }

  /**
   * Detach one Dialogue from its child AudioClip and collect the clip only when
   * no other (legacy shared) Dialogue still references it. The source
   * AudioAsset is project-owned and deliberately left untouched.
   */
  private unbindAndCollectClip(shot: Shot, dialogueId: string): Shot {
    const dialogue = this.dialogue(shot, dialogueId);
    if (!dialogue.audioClipId) return shot;

    const clipId = dialogue.audioClipId;
    const dialogues: Dialogue[] = shot.dialogues.map((candidate) => {
      if (candidate.id !== dialogueId) return candidate;
      const unboundDialogue: Dialogue = { ...candidate };
      delete unboundDialogue.audioClipId;
      return unboundDialogue;
    });
    const clipStillReferenced = dialogues.some(
      (candidate) => candidate.audioClipId === clipId,
    );

    return {
      ...shot,
      dialogues,
      audioClips: clipStillReferenced
        ? shot.audioClips
        : shot.audioClips.filter((clip) => clip.id !== clipId),
    };
  }

  private replaceDialogueTiming(
    project: Project,
    shot: Shot,
    dialogueId: string,
    timing: { startMs: number; endMs: number },
  ): Project {
    const current = this.dialogue(shot, dialogueId);
    if (
      current.startMs === timing.startMs &&
      current.endMs === timing.endMs
    ) {
      return project;
    }
    const nextDialogue = { ...current, ...timing };
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogueId ? nextDialogue : candidate,
      ),
    });
  }

  private replaceMovedDialogueTiming(
    project: Project,
    shot: Shot,
    dialogueId: string,
    timing: { startMs: number; endMs: number },
    deltaMs: number,
  ): Project {
    const current = this.dialogue(shot, dialogueId);
    const nextDialogue = { ...current, ...timing };
    if (!current.audioClipId) {
      if (deltaMs === 0) return project;
      return this.replaceShot(project, shot.id, {
        ...shot,
        dialogues: shot.dialogues.map((candidate) => candidate.id === dialogueId ? nextDialogue : candidate),
      }, { dialogueId, deltaMs });
    }

    const clip = this.audioClip(shot, current.audioClipId);
    const asset = this.audioAsset(project, clip.assetId);
    const clipDurationMs = clip.endMs - clip.startMs;
    this.assertAudioRange(asset, clip.offsetMs, clipDurationMs);
    const nextClipTiming = this.shiftAudioTiming(
      clip,
      deltaMs,
      shot.durationMs,
    );
    if (
      current.startMs === timing.startMs &&
      current.endMs === timing.endMs &&
      clip.startMs === nextClipTiming.startMs &&
      clip.endMs === nextClipTiming.endMs
    ) {
      return project;
    }

    const references = shot.dialogues.filter(
      (candidate) => candidate.audioClipId === clip.id,
    ).length;
    const clipId =
      references === 1 ? clip.id : this.nextId(this.collectIds(project));
    const nextClip: AudioClip = { ...clip, id: clipId, ...nextClipTiming };
    const nextAudioClips =
      references === 1
        ? shot.audioClips.map((candidate) =>
            candidate.id === clip.id ? nextClip : candidate,
          )
        : [...shot.audioClips, nextClip];

    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips: nextAudioClips,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogueId
          ? { ...nextDialogue, audioClipId: clipId }
          : candidate,
      ),
    }, { dialogueId, deltaMs });
  }

  private explicitArrangementTiming(
    shot: Shot,
    rawStartMs: number,
    spanMs: number,
  ): { startMs: number; endMs: number } {
    const pointMs = this.clampTime(shot, rawStartMs);
    return pointMs + spanMs <= shot.durationMs
      ? { startMs: pointMs, endMs: pointMs + spanMs }
      : {
          startMs: Math.max(0, shot.durationMs - spanMs),
          endMs: shot.durationMs,
        };
  }

  private findFirstAvailableTiming(
    dialogues: readonly Dialogue[],
    pointMs: number,
    spanMs: number,
    shotDurationMs: number,
  ): { startMs: number; endMs: number } {
    const latestStartMs = shotDurationMs - spanMs;
    let startMs = Math.min(pointMs, latestStartMs);
    const occupiedIntervals = dialogues
      .filter((dialogue) => dialogue.endMs > dialogue.startMs)
      .map((dialogue) => ({
        startMs: dialogue.startMs,
        endMs: dialogue.endMs,
      }))
      .sort(
        (left, right) =>
          left.startMs - right.startMs || left.endMs - right.endMs,
      );

    for (const interval of occupiedIntervals) {
      if (interval.endMs <= startMs) continue;
      if (interval.startMs >= startMs + spanMs) break;
      startMs = Math.max(startMs, interval.endMs);
      if (startMs > latestStartMs) break;
    }

    if (startMs > latestStartMs) {
      throw new DialogueServiceError(
        'DIALOGUE_NO_AVAILABLE_SLOT',
        '镜头内没有可用的一帧空档，请调整或移动已有对白后重试。',
      );
    }
    return { startMs, endMs: startMs + spanMs };
  }

  private initialAudioTiming(
    dialogue: Dialogue,
    asset: AudioAsset,
    offsetMs: number,
  ): { startMs: number; endMs: number } {
    const dialogueDurationMs = this.timedDuration(dialogue);
    const sourceDurationMs = Math.max(0, (asset.durationMs ?? 0) - offsetMs);
    const clipDurationMs = Math.min(dialogueDurationMs, sourceDurationMs);
    if (clipDurationMs < MIN_TIMED_DIALOGUE_DURATION_MS) {
      throw new DialogueServiceError(
        'AUDIO_CLIP_TOO_SHORT',
        '音频素材在当前源位置没有可播放的有效时长。',
      );
    }
    return {
      startMs: dialogue.startMs,
      endMs: dialogue.startMs + clipDurationMs,
    };
  }

  /**
   * "快速安排" commits exactly one Timeline frame for a subtitle that has no
   * audio yet. That single frame is a placeholder, not an authored length, so
   * the first real recording replaces it with the detected source duration.
   *
   * The condition is deliberately narrow: only an unbound Dialogue whose
   * committed span is exactly one frame — and shorter than the source — is
   * realigned. A Dialogue the author already stretched, already bound, or
   * already trimmed keeps its committed duration. A one-frame span set on
   * purpose is indistinguishable in the current model and is treated the same
   * way; that is the accepted boundary of this fix rather than new metadata.
   *
   * When the whole source cannot be placed, the bind is rejected. The
   * placeholder is never silently left at one frame, and no Shot duration or
   * other Dialogue is altered to make room.
   */
  private firstBindDialogueTiming(
    shot: Shot,
    dialogue: Dialogue,
    asset: AudioAsset,
    existingClip: AudioClip | null,
  ): { startMs: number; endMs: number } | null {
    if (existingClip) return null;
    const committedDurationMs = dialogue.endMs - dialogue.startMs;
    if (committedDurationMs !== integerFrameSpanMs()) return null;
    const sourceDurationMs = Math.max(0, asset.durationMs ?? 0);
    if (sourceDurationMs <= committedDurationMs) return null;

    const endMs = dialogue.startMs + sourceDurationMs;
    const conflict = this.findOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      { startMs: dialogue.startMs, endMs },
    );
    if (endMs > shot.durationMs || conflict) {
      const limitEndMs = conflict ? conflict.startMs : shot.durationMs;
      const roomMs = Math.max(0, limitEndMs - dialogue.startMs);
      throw new DialogueServiceError(
        'AUDIO_DIALOGUE_NO_ROOM',
        `配音完整时长为 ${sourceDurationMs}ms，但从 ${dialogue.startMs}ms 起只有 ${roomMs}ms 可用；请延长镜头或调整后续字幕后再绑定。`,
      );
    }
    return { startMs: dialogue.startMs, endMs };
  }

  private shiftAudioTiming(
    clip: AudioClip,
    deltaMs: number,
    shotDurationMs: number,
  ): { startMs: number; endMs: number } {
    const durationMs = clip.endMs - clip.startMs;
    const latestStartMs = Math.max(0, shotDurationMs - durationMs);
    const startMs = Math.min(
      Math.max(clip.startMs + deltaMs, 0),
      latestStartMs,
    );
    return { startMs, endMs: startMs + durationMs };
  }

  private dialogueLabel(project: Project, dialogue: Dialogue): string {
    if (dialogue.speakerType === DIALOGUE_SPEAKER_NARRATOR) return '旁白';
    const characterName = dialogue.characterId
      ? project.characters.find((candidate) => candidate.id === dialogue.characterId)?.name
      : undefined;
    const text = dialogue.text.trim();
    if (characterName) return text ? `${characterName}：${text.slice(0, 10)}` : characterName;
    return text ? text.slice(0, 12) : '对白';
  }

  private formatDeltaSeconds(ms: number): string {
    const seconds = Math.abs(ms) / 1_000;
    return Number.isInteger(seconds)
      ? String(seconds)
      : seconds.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
  }

  private replaceShot(
    project: Project,
    shotId: string,
    replacement: Shot,
    moved?: DialogueMouthPoseMove,
  ): Project {
    const timelineEvents = reconcileDialogueMouthPoses(this.shot(project, shotId), replacement, moved);
    return this.finish(project, {
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === shotId ? { ...replacement, timelineEvents } : shot,
      ),
    });
  }

  private finish(project: Project, next: Project): Project {
    return ProjectSchema.parse({
      ...next,
      updatedAt: this.now().toISOString(),
      createdAt: project.createdAt,
    });
  }

  private shot(project: Project, shotId: string): Shot {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) {
      throw new DialogueServiceError('SHOT_NOT_FOUND', `找不到镜头：${shotId}`);
    }
    return shot;
  }

  private dialogue(shot: Shot, dialogueId: string): Dialogue {
    const dialogue = shot.dialogues.find(
      (candidate) => candidate.id === dialogueId,
    );
    if (!dialogue) {
      throw new DialogueServiceError(
        'DIALOGUE_NOT_FOUND',
        `找不到对白：${dialogueId}`,
      );
    }
    return dialogue;
  }

  /**
   * Resolve the persisted speaker fields for a new Dialogue. Narration keeps
   * only the explicit discriminator; a Character speaker keeps the original
   * strict Character + default VoiceProfile binding.
   */
  private resolveNewSpeaker(
    project: Project,
    input: { characterId?: string; speakerType?: DialogueSpeakerType },
  ): Pick<Dialogue, 'speakerType' | 'characterId' | 'voiceProfileId'> {
    if (input.speakerType === DIALOGUE_SPEAKER_NARRATOR) {
      return { speakerType: DIALOGUE_SPEAKER_NARRATOR };
    }
    if (input.characterId === undefined) {
      throw new DialogueServiceError(
        'DIALOGUE_SPEAKER_INVALID',
        '请选择字幕的说话人或旁白。',
      );
    }
    const character = this.character(project, input.characterId);
    return {
      characterId: character.id,
      voiceProfileId: character.defaultVoiceProfileId,
    };
  }

  /** Narration carries no Character and no VoiceProfile. */
  private asNarrator(dialogue: Dialogue): Dialogue {
    if (dialogue.speakerType === DIALOGUE_SPEAKER_NARRATOR) return dialogue;
    const narration: Dialogue = {
      ...dialogue,
      speakerType: DIALOGUE_SPEAKER_NARRATOR,
    };
    delete narration.characterId;
    delete narration.voiceProfileId;
    return narration;
  }

  /** Character dialogue restores the original strict speaker contract. */
  private asCharacter(
    project: Project,
    dialogue: Dialogue,
    characterId: string | undefined,
  ): Dialogue {
    if (characterId === undefined) {
      throw new DialogueServiceError(
        'DIALOGUE_SPEAKER_INVALID',
        '请选择角色。',
      );
    }
    const character = this.character(project, characterId);
    const next: Dialogue = {
      ...dialogue,
      characterId: character.id,
      voiceProfileId: this.characterVoiceProfileId(dialogue, character),
    };
    delete next.speakerType;
    return next;
  }

  /**
   * Re-selecting the same character keeps the dialogue's existing legal voice
   * profile instead of silently resetting it to the character default. A real
   * character switch, or a narration → character switch, still binds the target
   * character's default profile.
   */
  private characterVoiceProfileId(
    dialogue: Dialogue,
    character: Character,
  ): string {
    const isSameCharacter =
      dialogue.speakerType !== DIALOGUE_SPEAKER_NARRATOR &&
      dialogue.characterId === character.id;
    if (isSameCharacter && dialogue.voiceProfileId !== undefined) {
      return dialogue.voiceProfileId;
    }
    return character.defaultVoiceProfileId;
  }

  private character(project: Project, characterId: string): Character {
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character) {
      throw new DialogueServiceError(
        'CHARACTER_NOT_FOUND',
        `找不到角色：${characterId}`,
      );
    }
    return character;
  }

  private audioAsset(project: Project, assetId: string): AudioAsset {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      throw new DialogueServiceError(
        'AUDIO_ASSET_NOT_FOUND',
        `找不到音频素材：${assetId}`,
      );
    }
    if (asset.kind !== 'audio') {
      throw new DialogueServiceError(
        'AUDIO_ASSET_NOT_AUDIO',
        '只能绑定音频素材。',
      );
    }
    if (asset.durationMs === undefined) {
      throw new DialogueServiceError(
        'AUDIO_ASSET_DURATION_UNAVAILABLE',
        '音频素材尚未完成时长分析，请先刷新素材元数据。',
      );
    }
    return asset;
  }

  private audioClip(shot: Shot, clipId: string): AudioClip {
    const clip = shot.audioClips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      throw new DialogueServiceError(
        'AUDIO_CLIP_NOT_FOUND',
        `找不到对白引用的音频片段：${clipId}`,
      );
    }
    return clip;
  }

  private assertAudioRange(
    asset: AudioAsset,
    offsetMs: number,
    requestedDurationMs: number,
  ): void {
    if (offsetMs + requestedDurationMs > (asset.durationMs ?? 0)) {
      throw new DialogueServiceError(
        'AUDIO_CLIP_TOO_SHORT',
        `音频素材时长不足以覆盖对白的 ${requestedDurationMs}ms 时间段。`,
      );
    }
  }

  private validText(raw: string): string {
    const text = raw.trim();
    if (text.length === 0) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_TEXT',
        '对白文本不能为空。',
      );
    }
    return text;
  }

  private clampTime(shot: Shot, rawMs: number): number {
    this.validInteger(rawMs, '对白时间点');
    return Math.min(Math.max(rawMs, 0), shot.durationMs);
  }

  private validTimedWindow(
    shot: Shot,
    startMs: number,
    endMs: number,
  ): { startMs: number; endMs: number } {
    const start = this.clampTime(shot, startMs);
    const end = this.clampTime(shot, endMs);
    if (end - start < MIN_TIMED_DIALOGUE_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '对白结束时间必须晚于开始时间。',
      );
    }
    return { startMs: start, endMs: end };
  }

  private timedDuration(dialogue: Dialogue): number {
    const duration = dialogue.endMs - dialogue.startMs;
    if (duration < MIN_TIMED_DIALOGUE_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '请先把未定时对白安排为正时长。',
      );
    }
    return duration;
  }

  private findOverlap(
    dialogues: readonly Dialogue[],
    timing: { startMs: number; endMs: number },
  ): Dialogue | undefined {
    return dialogues.find(
      (dialogue) =>
        dialogue.endMs > dialogue.startMs &&
        timing.startMs < dialogue.endMs &&
        timing.endMs > dialogue.startMs,
    );
  }

  private assertNoOverlap(
    dialogues: readonly Dialogue[],
    timing: { startMs: number; endMs: number },
  ): void {
    const conflict = this.findOverlap(dialogues, timing);
    if (conflict) {
      throw new DialogueServiceError(
        'DIALOGUE_OVERLAP',
        `对白与 ${conflict.startMs}–${conflict.endMs}ms 的已有对白重叠；首尾相接可以。`,
      );
    }
  }

  private validInteger(raw: number, label: string): number {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_TIME',
        `${label}必须是整数毫秒：${raw}`,
      );
    }
    return raw;
  }

  private validPositiveInteger(raw: number, label: string): number {
    this.validInteger(raw, label);
    if (raw < MIN_TIMED_DIALOGUE_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        `${label}必须为正整数毫秒：${raw}`,
      );
    }
    return raw;
  }

  private collectIds(project: Project): Set<string> {
    const ids = new Set<string>([project.id]);
    project.assets.forEach((asset) => ids.add(asset.id));
    project.characters.forEach((character) => {
      ids.add(character.id);
      if (character.mode === 'adaptive-parts') {
        character.parts.forEach((part) => ids.add(part.partId));
        character.expressions?.forEach((expression) => ids.add(expression.id));
      } else {
        character.expressions.forEach((expression) => ids.add(expression.id));
      }
    });
    project.voiceProfiles.forEach((profile) => ids.add(profile.id));
    project.subtitleStyles.forEach((style) => ids.add(style.id));
    project.shots.forEach((shot) => {
      ids.add(shot.id);
      shot.layers.forEach((layer) => ids.add(layer.id));
      shot.audioClips.forEach((clip) => ids.add(clip.id));
      shot.dialogues.forEach((dialogue) => ids.add(dialogue.id));
      shot.timelineEvents.forEach((event) => ids.add(event.id));
    });
    return ids;
  }

  private nextId(usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId();
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
    throw new DialogueServiceError(
      'ID_GENERATION_FAILED',
      '生成对白 ID 失败，请重试。',
    );
  }
}
