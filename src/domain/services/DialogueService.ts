import {
  ProjectSchema,
  type AudioClip,
  type AudioAsset,
  type Character,
  type Dialogue,
  type Project,
  type Shot,
} from '../models';

const MIN_TIMED_DIALOGUE_DURATION_MS = 1;

export type DialogueServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DIALOGUE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'INVALID_DIALOGUE_TIME'
  | 'INVALID_DIALOGUE_DURATION'
  | 'INVALID_DIALOGUE_TEXT'
  | 'DIALOGUE_OVERLAP'
  | 'DIALOGUE_NO_AVAILABLE_SLOT'
  | 'AUDIO_ASSET_NOT_FOUND'
  | 'AUDIO_ASSET_NOT_AUDIO'
  | 'AUDIO_ASSET_DURATION_UNAVAILABLE'
  | 'AUDIO_CLIP_NOT_FOUND'
  | 'AUDIO_CLIP_TOO_SHORT'
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
  characterId: string;
  text: string;
  pointTimeMs: number;
}

export interface CreateManyDialogueInput {
  shotId: string;
  pointTimeMs: number;
  lines: ReadonlyArray<{ characterId: string; text: string }>;
}

export interface UpdateDialogueInput {
  shotId: string;
  dialogueId: string;
  characterId?: string;
  text?: string;
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
}

export interface MoveDialogueInput {
  shotId: string;
  dialogueId: string;
  deltaMs: number;
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
    const character = this.character(project, input.characterId);
    const timeMs = this.clampTime(shot, input.pointTimeMs);
    const dialogue: Dialogue = {
      id: this.nextId(this.collectIds(project)),
      characterId: character.id,
      voiceProfileId: character.defaultVoiceProfileId,
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
   */
  createMany(project: Project, input: CreateManyDialogueInput): Project {
    if (input.lines.length === 0) return project;
    const shot = this.shot(project, input.shotId);
    const timeMs = this.clampTime(shot, input.pointTimeMs);
    const usedIds = this.collectIds(project);
    const added: Dialogue[] = input.lines.map((line) => {
      const character = this.character(project, line.characterId);
      return {
        id: this.nextId(usedIds),
        characterId: character.id,
        voiceProfileId: character.defaultVoiceProfileId,
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

  update(project: Project, input: UpdateDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    let next: Dialogue = dialogue;
    if (input.text !== undefined) {
      next = { ...next, text: this.validText(input.text) };
    }
    if (
      input.characterId !== undefined &&
      input.characterId !== dialogue.characterId
    ) {
      const character = this.character(project, input.characterId);
      next = {
        ...next,
        characterId: character.id,
        voiceProfileId: character.defaultVoiceProfileId,
      };
    }
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id ? next : candidate,
      ),
    });
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
   * Atomically binds one existing project AudioAsset to one timed Dialogue.
   * Dialogue.audioClipId and Shot.audioClips are changed in the same Project
   * snapshot so callers can commit exactly one renderer History command.
   */
  bindAudio(project: Project, input: BindDialogueAudioInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    const dialogueDurationMs = this.timedDuration(dialogue);
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
    const offsetMs = sameAsset ? existingClip!.offsetMs : 0;
    const volume = sameAsset ? existingClip!.volume : 1;
    const name = sameAsset ? existingClip!.name : asset.name;
    this.assertAudioRange(asset, offsetMs, dialogueDurationMs);

    if (
      existingClip &&
      sameAsset &&
      existingClip.startMs === dialogue.startMs &&
      existingClip.endMs === dialogue.endMs
    ) {
      return project;
    }

    const usedIds = this.collectIds(project);
    const clipId =
      existingClip && existingReferences === 1
        ? existingClip.id
        : this.nextId(usedIds);
    const nextClip: AudioClip = {
      id: clipId,
      name,
      assetId: asset.id,
      startMs: dialogue.startMs,
      endMs: dialogue.endMs,
      offsetMs,
      volume,
    };
    const nextDialogue: Dialogue = {
      ...dialogue,
      audioClipId: clipId,
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
        candidate.id === dialogue.id ? nextDialogue : candidate,
      ),
    });
  }

  /**
   * Explicit Untimed → Timed action. The renderer derives frameSpanMs from
   * Day26 frameDurationMs()/snapToFrame() and passes the integer span as data.
   */
  arrange(project: Project, input: ArrangeDialogueInput): Project {
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
    const timing = this.findFirstAvailableTiming(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      dialogue.startMs,
      spanMs,
      shot.durationMs,
    );
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return this.replaceDialogueTiming(project, shot, dialogue.id, timing);
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
    return this.replaceDialogueTiming(project, shot, dialogue.id, timing);
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
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.filter(
        (candidate) => candidate.id !== dialogueId,
      ),
    });
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
    if (!current.audioClipId) {
      return this.replaceShot(project, shot.id, {
        ...shot,
        dialogues: shot.dialogues.map((candidate) =>
          candidate.id === dialogueId ? nextDialogue : candidate,
        ),
      });
    }

    const clip = this.audioClip(shot, current.audioClipId);
    const asset = this.audioAsset(project, clip.assetId);
    this.assertAudioRange(asset, clip.offsetMs, timing.endMs - timing.startMs);
    const references = shot.dialogues.filter(
      (candidate) => candidate.audioClipId === clip.id,
    ).length;
    const clipId =
      references === 1
        ? clip.id
        : this.nextId(this.collectIds(project));
    const nextClip: AudioClip = {
      ...clip,
      id: clipId,
      startMs: timing.startMs,
      endMs: timing.endMs,
    };
    const nextDialogueWithClip = {
      ...nextDialogue,
      audioClipId: clipId,
    };
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
        candidate.id === dialogueId ? nextDialogueWithClip : candidate,
      ),
    });
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

  private replaceShot(
    project: Project,
    shotId: string,
    replacement: Shot,
  ): Project {
    return this.finish(project, {
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === shotId ? replacement : shot,
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

  private assertNoOverlap(
    dialogues: readonly Dialogue[],
    timing: { startMs: number; endMs: number },
  ): void {
    const conflict = dialogues.find(
      (dialogue) =>
        dialogue.endMs > dialogue.startMs &&
        timing.startMs < dialogue.endMs &&
        timing.endMs > dialogue.startMs,
    );
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
      character.expressions.forEach((expression) => ids.add(expression.id));
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
