import {
  ProjectSchema,
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
    const pointMs = dialogue.startMs;
    const timing =
      pointMs + spanMs <= shot.durationMs
        ? { startMs: pointMs, endMs: pointMs + spanMs }
        : {
            startMs: Math.max(0, shot.durationMs - spanMs),
            endMs: shot.durationMs,
          };
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
    return this.replaceShot(project, shot.id, {
      ...shot,
      dialogues: shot.dialogues.map((candidate) =>
        candidate.id === dialogueId ? { ...candidate, ...timing } : candidate,
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
