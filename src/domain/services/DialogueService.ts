import {
  ProjectSchema,
  type Character,
  type Dialogue,
  type Project,
  type Shot,
} from '../models';

export type DialogueServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DIALOGUE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'INVALID_DIALOGUE_TIME'
  | 'INVALID_DIALOGUE_TEXT'
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

export interface DialogueServiceOptions {
  createId?: () => string;
  now?: () => Date;
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

  constructor(options: DialogueServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

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
   * Appends every resolved line as a single Project mutation. All lines share
   * the capture-time point (the renderer passes one `pointTimeMs` captured at
   * commit), so the whole batch becomes exactly one History command.
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
