import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  DialogueService,
  DialogueServiceError,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

function ids() {
  let counter = 0;
  return () =>
    `d2000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

function dialogueService(): DialogueService {
  return new DialogueService({
    createId: ids(),
    now: () => new Date('2026-07-25T12:40:00.000Z'),
  });
}

function characterService(): CharacterService {
  return new CharacterService({
    createId: ids(),
    now: () => new Date('2026-07-25T12:40:00.000Z'),
  });
}

function expectDialogueError(
  action: () => unknown,
  code: DialogueServiceError['code'],
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(DialogueServiceError);
    expect((error as DialogueServiceError).code).toBe(code);
  }
}

describe('DialogueService', () => {
  it('creates a text dialogue with the speaker default voice profile and no audio clip', () => {
    const service = dialogueService();
    let project: Project = buildProject();
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '你好，世界',
      pointTimeMs: 1200,
    });
    const shot = project.shots[0]!;
    expect(shot.dialogues).toHaveLength(1);
    const dialogue = shot.dialogues[0]!;
    expect(dialogue.characterId).toBe(IDS.character);
    expect(dialogue.voiceProfileId).toBe(IDS.voiceProfile);
    expect(dialogue.subtitleStyleId).toBe(IDS.subtitle);
    expect(dialogue.startMs).toBe(1200);
    expect(dialogue.endMs).toBe(1200);
    expect(dialogue.text).toBe('你好，世界');
    expect(dialogue.audioClipId).toBeUndefined();
    expect(project.updatedAt).toBe('2026-07-25T12:40:00.000Z');
  });

  it('clamps the point time into [0, shot.durationMs]', () => {
    const service = dialogueService();
    let project = buildProject();
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '越过终点',
      pointTimeMs: 99_999,
    });
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '早于起点',
      pointTimeMs: -50,
    });
    const [over, under] = project.shots[0]!.dialogues;
    expect(over!.startMs).toBe(3000);
    expect(over!.endMs).toBe(3000);
    expect(under!.startMs).toBe(0);
    expect(under!.endMs).toBe(0);
  });

  it('creates many dialogues as one mutation sharing the captured point time', () => {
    const service = dialogueService();
    let project = buildProject();
    project = service.createMany(project, {
      shotId: IDS.shot,
      pointTimeMs: 1500,
      lines: [
        { characterId: IDS.character, text: '第一句' },
        { characterId: IDS.character, text: '第二句' },
        { characterId: IDS.character, text: '第三句' },
      ],
    });
    const dialogues = project.shots[0]!.dialogues;
    expect(dialogues).toHaveLength(3);
    for (const dialogue of dialogues) {
      expect(dialogue.startMs).toBe(1500);
      expect(dialogue.endMs).toBe(1500);
      expect(dialogue.characterId).toBe(IDS.character);
    }
  });

  it('updates text and switches the voice profile when the speaker changes', () => {
    const service = dialogueService();
    let project = buildProject();
    project = characterService().create(project, {
      name: '老虎',
      expressions: [{ name: '正常', assetId: IDS.assetChar2 }],
    });
    const tiger = project.characters[1]!;
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '原始',
      pointTimeMs: 100,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;

    project = service.update(project, {
      shotId: IDS.shot,
      dialogueId,
      text: '改过的话',
    });
    project = service.update(project, {
      shotId: IDS.shot,
      dialogueId,
      characterId: tiger.id,
    });

    const dialogue = project.shots[0]!.dialogues[0]!;
    expect(dialogue.text).toBe('改过的话');
    expect(dialogue.characterId).toBe(tiger.id);
    expect(dialogue.voiceProfileId).toBe(tiger.defaultVoiceProfileId);
  });

  it('removes a dialogue by id', () => {
    const service = dialogueService();
    let project = buildProject();
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '待删',
      pointTimeMs: 100,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = service.remove(project, IDS.shot, dialogueId);
    expect(project.shots[0]!.dialogues).toHaveLength(0);
  });

  it('rejects an empty or whitespace-only text', () => {
    const service = dialogueService();
    const project = buildProject();
    expectDialogueError(
      () =>
        service.create(project, {
          shotId: IDS.shot,
          characterId: IDS.character,
          text: '   ',
          pointTimeMs: 100,
        }),
      'INVALID_DIALOGUE_TEXT',
    );
  });

  it('rejects a non-integer point time', () => {
    const service = dialogueService();
    const project = buildProject();
    expectDialogueError(
      () =>
        service.create(project, {
          shotId: IDS.shot,
          characterId: IDS.character,
          text: '时间错误',
          pointTimeMs: Number.NaN,
        }),
      'INVALID_DIALOGUE_TIME',
    );
    expectDialogueError(
      () =>
        service.create(project, {
          shotId: IDS.shot,
          characterId: IDS.character,
          text: '时间错误',
          pointTimeMs: 1200.5,
        }),
      'INVALID_DIALOGUE_TIME',
    );
  });

  it('round-trips a no-audio dialogue through JSON save/reopen', () => {
    const service = dialogueService();
    let project = buildProject();
    project = service.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '持久化台词',
      pointTimeMs: 700,
    });
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(project)),
    );
    const dialogue = reopened.shots[0]!.dialogues[0]!;
    expect(reopened.schemaVersion).toBe(6);
    expect(dialogue.text).toBe('持久化台词');
    expect(dialogue.audioClipId).toBeUndefined();
    expect(dialogue.voiceProfileId).toBe(IDS.voiceProfile);
    expect(reopened.shots[0]!.dialogues).toHaveLength(1);
  });

  it('rejects unknown shot, character, and dialogue', () => {
    const service = dialogueService();
    const project = buildProject();
    expectDialogueError(
      () =>
        service.create(project, {
          shotId: 'missing-shot',
          characterId: IDS.character,
          text: 'x',
          pointTimeMs: 100,
        }),
      'SHOT_NOT_FOUND',
    );
    expectDialogueError(
      () =>
        service.create(project, {
          shotId: IDS.shot,
          characterId: 'missing-character',
          text: 'x',
          pointTimeMs: 100,
        }),
      'CHARACTER_NOT_FOUND',
    );
    expectDialogueError(
      () => service.remove(project, IDS.shot, 'missing-dialogue'),
      'DIALOGUE_NOT_FOUND',
    );
  });
});
