import {
  ProjectSchema,
  type Character,
  type Dialogue,
  type AudioClip,
  type Project,
  type Shot,
} from '../models';
import {
  DIALOGUE_DEFAULT_DURATION_MS,
  DIALOGUE_MIN_DURATION_MS,
} from '../constants';
import { isDialogueTimed } from '../evaluators/dialogueEvaluator';

export type DialogueServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DIALOGUE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'INVALID_DIALOGUE_TIME'
  | 'INVALID_DIALOGUE_DURATION'
  | 'INVALID_SUBTITLE_STYLE'
  | 'INVALID_DIALOGUE_TEXT'
  | 'DIALOGUE_OVERLAP'
  | 'AUDIO_ASSET_NOT_FOUND'
  | 'AUDIO_ASSET_INVALID'
  | 'AUDIO_DURATION_MISSING'
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
  subtitleStyleId?: string;
  startMs?: number;
  endMs?: number;
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

export interface AttachDialogueAudioInput {
  shotId: string;
  dialogueId: string;
  assetId: string;
}

export interface DialogueServiceOptions {
  createId?: () => string;
  now?: () => Date;
  defaultDurationMs?: number;
}

/**
 * Pure Project → Project dialogue mutation owner. Centralises every dialogue
 * write so the renderer never hand-rolls project replacement across components.
 *
 * Point-time is supplied as a plain `pointTimeMs` number by the caller (the
 * renderer reads the Timeline playhead and passes it in). This service must not
 * import any renderer/timeline store — the playhead is UI-only state.
 */
export class DialogueService {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly defaultDurationMs: number;

  constructor(options: DialogueServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.defaultDurationMs = this.validDefaultDuration(
      options.defaultDurationMs ?? DIALOGUE_DEFAULT_DURATION_MS,
    );
  }

  create(project: Project, input: CreateDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const character = this.character(project, input.characterId);
    const timing = this.defaultWindow(shot, input.pointTimeMs);
    this.assertNoOverlap(shot.dialogues, timing);
    const dialogue: Dialogue = {
      id: this.nextId(this.collectIds(project)),
      characterId: character.id,
      voiceProfileId: character.defaultVoiceProfileId,
      subtitleStyleId: shot.defaultSubtitleStyleId,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text: this.validText(input.text),
    };
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: [...shot.dialogues, dialogue],
    });
  }

  /**
   * Appends every resolved line as a single Project mutation. All lines share
   * the capture-time point (the renderer passes one `pointTimeMs` captured at
   * commit), so the whole batch becomes exactly one History command.
   */
  createMany(project: Project, input: CreateManyDialogueInput): Project {
    if (input.lines.length === 0) return project;
    const shot = this.shot(project, input.shotId);
    const usedIds = this.collectIds(project);
    const added: Dialogue[] = [];
    input.lines.forEach((line, index) => {
      const character = this.character(project, line.characterId);
      const timing = this.defaultWindow(
        shot,
        input.pointTimeMs + index * this.defaultDurationMs,
      );
      this.assertNoOverlap([...shot.dialogues, ...added], timing);
      added.push({
        id: this.nextId(usedIds),
        characterId: character.id,
        voiceProfileId: character.defaultVoiceProfileId,
        subtitleStyleId: shot.defaultSubtitleStyleId,
        startMs: timing.startMs,
        endMs: timing.endMs,
        text: this.validText(line.text),
      });
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
    if (input.subtitleStyleId !== undefined) {
      if (
        !project.subtitleStyles.some(
          (style) => style.id === input.subtitleStyleId,
        )
      ) {
        throw new DialogueServiceError(
          'INVALID_SUBTITLE_STYLE',
          `找不到字幕样式：${input.subtitleStyleId}`,
        );
      }
      next = { ...next, subtitleStyleId: input.subtitleStyleId };
    }
    if (input.startMs !== undefined || input.endMs !== undefined) {
      const timing = this.validTimedWindow(
        shot,
        input.startMs ?? dialogue.startMs,
        input.endMs ?? dialogue.endMs,
      );
      this.assertNoOverlap(
        shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
        timing,
      );
      next = { ...next, ...timing };
    }
    const replacement: Shot = {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id ? next : candidate,
      ),
      audioClips:
        input.startMs !== undefined || input.endMs !== undefined
          ? this.syncAudioClipTiming(shot, next, {
              startMs: next.startMs,
              endMs: next.endMs,
            })
          : shot.audioClips,
    };
    return this.replaceShot(project, shot.id, replacement);
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
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id ? { ...candidate, ...timing } : candidate,
      ),
      audioClips: this.syncAudioClipTiming(shot, dialogue, timing),
    });
  }

  resize(project: Project, input: ResizeDialogueInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    this.validInteger(input.timeMs, '调整时间');
    const timing =
      input.edge === 'start'
        ? this.validTimedWindow(shot, input.timeMs, dialogue.endMs)
        : this.validTimedWindow(shot, dialogue.startMs, input.timeMs);
    this.assertNoOverlap(
      shot.dialogues.filter((candidate) => candidate.id !== dialogue.id),
      timing,
    );
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id ? { ...candidate, ...timing } : candidate,
      ),
      audioClips: this.syncAudioClipTiming(shot, dialogue, timing),
    });
  }

  attachAudio(project: Project, input: AttachDialogueAudioInput): Project {
    const shot = this.shot(project, input.shotId);
    const dialogue = this.dialogue(shot, input.dialogueId);
    const asset = project.assets.find((candidate) => candidate.id === input.assetId);
    if (!asset) {
      throw new DialogueServiceError(
        'AUDIO_ASSET_NOT_FOUND',
        `找不到音频素材：${input.assetId}`,
      );
    }
    if (asset.kind !== 'audio') {
      throw new DialogueServiceError(
        'AUDIO_ASSET_INVALID',
        `素材不是音频：${asset.name}`,
      );
    }
    if (asset.durationMs === undefined) {
      throw new DialogueServiceError(
        'AUDIO_DURATION_MISSING',
        `音频尚未完成时长探测：${asset.name}`,
      );
    }
    const durationMs = this.timedDuration(dialogue);
    const clipDurationMs = Math.min(asset.durationMs, durationMs);
    if (clipDurationMs < DIALOGUE_MIN_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '对白必须先设置为正时长才能绑定音频。',
      );
    }
    const id = dialogue.audioClipId ?? this.nextId(this.collectIds(project));
    const clip: AudioClip = {
      id,
      name: `${asset.name} · ${dialogue.text.slice(0, 24)}`,
      assetId: asset.id,
      startMs: dialogue.startMs,
      endMs: dialogue.startMs + clipDurationMs,
      offsetMs: 0,
      volume: 1,
    };
    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips: [
        ...shot.audioClips.filter((candidate) => candidate.id !== id),
        clip,
      ],
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogue.id
          ? { ...candidate, audioClipId: clip.id }
          : candidate,
      ),
    });
  }

  detachAudio(project: Project, shotId: string, dialogueId: string): Project {
    const shot = this.shot(project, shotId);
    const dialogue = this.dialogue(shot, dialogueId);
    if (!dialogue.audioClipId) return project;
    const audioClipId = dialogue.audioClipId;
    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips: shot.audioClips.filter((clip) => clip.id !== audioClipId),
      dialogues: shot.dialogues.map((candidate) => {
        if (candidate.id !== dialogue.id) return candidate;
        return Object.fromEntries(
          Object.entries(candidate).filter(([key]) => key !== 'audioClipId'),
        ) as Dialogue;
      }),
    });
  }

  remove(project: Project, shotId: string, dialogueId: string): Project {
    const shot = this.shot(project, shotId);
    const dialogue = this.dialogue(shot, dialogueId);
    return this.replaceShot(project, shot.id, {
      ...shot,
      audioClips: shot.audioClips.filter(
        (clip) => clip.id !== dialogue.audioClipId,
      ),
      dialogues: shot.dialogues.filter(
        (candidate) => candidate.id !== dialogueId,
      ),
    });
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
    if (!Number.isFinite(rawMs) || !Number.isInteger(rawMs)) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_TIME',
        `对白时间点必须是有效整数毫秒：${rawMs}`,
      );
    }
    return Math.min(Math.max(rawMs, 0), shot.durationMs);
  }

  private defaultWindow(shot: Shot, rawMs: number): { startMs: number; endMs: number } {
    const pointMs = this.clampTime(shot, rawMs);
    const startMs =
      pointMs >= shot.durationMs
        ? Math.max(0, shot.durationMs - this.defaultDurationMs)
        : pointMs;
    const endMs = Math.min(shot.durationMs, startMs + this.defaultDurationMs);
    return this.validTimedWindow(shot, startMs, endMs);
  }

  private validTimedWindow(
    shot: Shot,
    startMs: number,
    endMs: number,
  ): { startMs: number; endMs: number } {
    this.validInteger(startMs, '开始时间');
    this.validInteger(endMs, '结束时间');
    const start = this.clampTime(shot, startMs);
    const end = this.clampTime(shot, endMs);
    if (end - start < DIALOGUE_MIN_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        `对白时长必须至少为 ${DIALOGUE_MIN_DURATION_MS}ms。`,
      );
    }
    return { startMs: start, endMs: end };
  }

  private timedDuration(dialogue: Dialogue): number {
    const duration = dialogue.endMs - dialogue.startMs;
    if (duration < DIALOGUE_MIN_DURATION_MS) {
      throw new DialogueServiceError(
        'INVALID_DIALOGUE_DURATION',
        '对白必须先设置为正时长。',
      );
    }
    return duration;
  }

  /** Moves/truncates an attached source with its dialogue, never stretches it. */
  private syncAudioClipTiming(
    shot: Shot,
    dialogue: Dialogue,
    timing: { startMs: number; endMs: number },
  ): AudioClip[] {
    if (!dialogue.audioClipId) return shot.audioClips;
    const existing = shot.audioClips.find(
      (clip) => clip.id === dialogue.audioClipId,
    );
    if (!existing) return shot.audioClips;
    const sourceDuration = Math.max(1, existing.endMs - existing.startMs);
    return shot.audioClips.map((clip) =>
      clip.id === existing.id
        ? {
            ...clip,
            startMs: timing.startMs,
            endMs: Math.min(timing.endMs, timing.startMs + sourceDuration),
          }
        : clip,
    );
  }

  private assertNoOverlap(
    dialogues: readonly Dialogue[],
    timing: { startMs: number; endMs: number },
  ): void {
    const conflict = dialogues.find(
      (dialogue) =>
        isDialogueTimed(dialogue) &&
        timing.startMs < dialogue.endMs &&
        timing.endMs > dialogue.startMs,
    );
    if (conflict) {
      throw new DialogueServiceError(
        'DIALOGUE_OVERLAP',
        `对白与 ${conflict.startMs}–${conflict.endMs}ms 的已有对白重叠。相邻时间段可以连接。`,
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

  private validDefaultDuration(raw: number): number {
    if (!Number.isInteger(raw) || raw < DIALOGUE_MIN_DURATION_MS) {
      throw new Error('Dialogue default duration must be a positive integer.');
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
