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

function createAt(
  service: DialogueService,
  project: Project,
  pointTimeMs: number,
  text: string,
): Project {
  return service.create(project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text,
    pointTimeMs,
  });
}

describe('DialogueService Day27 authoring contract', () => {
  it('creates one Untimed Dialogue at exactly the captured 1200ms point', () => {
    const service = dialogueService();
    const project = createAt(service, buildProject(), 1200, '你好，世界');
    const dialogue = project.shots[0]!.dialogues[0]!;

    expect(dialogue).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 1200,
      endMs: 1200,
      text: '你好，世界',
    });
    expect(dialogue.audioClipId).toBeUndefined();
    expect(project.updatedAt).toBe('2026-07-25T12:40:00.000Z');
  });

  it('clamps creation past shot end to duration/duration', () => {
    const project = createAt(
      dialogueService(),
      buildProject(),
      99_999,
      '越过终点',
    );
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 3000,
      endMs: 3000,
    });
  });

  it('clamps creation before zero to 0/0', () => {
    const project = createAt(
      dialogueService(),
      buildProject(),
      -50,
      '早于起点',
    );
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 0,
      endMs: 0,
    });
  });

  it('creates every batch line at one captured point with no slot limit', () => {
    const service = dialogueService();
    const lines = Array.from({ length: 8 }, (_, index) => ({
      characterId: IDS.character,
      text: `第 ${index + 1} 句`,
    }));
    const project = service.createMany(buildProject(), {
      shotId: IDS.shot,
      pointTimeMs: 1700,
      lines,
    });
    const dialogues = project.shots[0]!.dialogues;

    expect(dialogues).toHaveLength(8);
    expect(
      dialogues.map((dialogue) => [dialogue.startMs, dialogue.endMs]),
    ).toEqual(Array.from({ length: 8 }, () => [1700, 1700]));
  });

  it('does not reject Untimed creation inside an existing Timed interval', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 0, 'timed');
    const timedId = project.shots[0]!.dialogues[0]!.id;
    project = service.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: timedId,
      startMs: 0,
      endMs: 1000,
    });
    project = createAt(service, project, 500, 'untimed at occupied point');
    expect(project.shots[0]!.dialogues.at(-1)).toMatchObject({
      startMs: 500,
      endMs: 500,
    });
  });
});

describe('DialogueService Day28 timing contract', () => {
  it('explicitly arranges Untimed Dialogue into one renderer-provided frame', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 1200, 'one frame');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: id,
      frameSpanMs: 42,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1200,
      endMs: 1242,
    });
  });

  it('reuses the same one-frame rule for an explicit Timeline drop start', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 100, 'drag to place');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: id,
      frameSpanMs: 42,
      startMs: 1200,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1200,
      endMs: 1242,
    });
  });

  it('keeps explicit drop starts inside the shot by using the incumbent end backfill', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 100, 'drag at end');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: id,
      frameSpanMs: 42,
      startMs: 3000,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 2958,
      endMs: 3000,
    });
  });

  it('validates an explicit drop preview without returning a Project mutation', () => {
    const service = dialogueService();
    const project = createAt(service, buildProject(), 100, 'preview only');
    const id = project.shots[0]!.dialogues[0]!.id;
    expect(
      service.getArrangementTiming(project, {
        shotId: IDS.shot,
        dialogueId: id,
        frameSpanMs: 42,
        startMs: 1800,
      }),
    ).toEqual({ startMs: 1800, endMs: 1842 });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 100,
      endMs: 100,
    });
  });

  it('backfills one frame to the left when arranging at shot end', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 3000, 'shot end');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: id,
      frameSpanMs: 42,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 2958,
      endMs: 3000,
    });
  });

  it('checks overlap only at explicit timing commit and allows adjacency', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 0, 'first');
    project = createAt(service, project, 42, 'adjacent');
    project = createAt(service, project, 20, 'overlap candidate');
    const [first, adjacent, overlap] = project.shots[0]!.dialogues;

    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: first!.id,
      frameSpanMs: 42,
    });
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: adjacent!.id,
      frameSpanMs: 42,
    });
    expect(project.shots[0]!.dialogues.slice(0, 2)).toMatchObject([
      { startMs: 0, endMs: 42 },
      { startMs: 42, endMs: 84 },
    ]);
    expectDialogueError(
      () =>
        service.arrange(project, {
          shotId: IDS.shot,
          dialogueId: overlap!.id,
          frameSpanMs: 42,
        }),
      'DIALOGUE_OVERLAP',
    );
    expect(project.shots[0]!.dialogues[2]).toMatchObject({
      startMs: 20,
      endMs: 20,
    });
  });

  it('clamps move and resize while preserving positive spans', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 1000, 'move');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: id,
      startMs: 1000,
      endMs: 1500,
    });
    project = service.move(project, {
      shotId: IDS.shot,
      dialogueId: id,
      deltaMs: 99_999,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 2500,
      endMs: 3000,
    });
    project = service.move(project, {
      shotId: IDS.shot,
      dialogueId: id,
      deltaMs: -99_999,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 0,
      endMs: 500,
    });
    project = service.resize(project, {
      shotId: IDS.shot,
      dialogueId: id,
      edge: 'end',
      timeMs: 99_999,
    });
    expect(project.shots[0]!.dialogues[0]!.endMs).toBe(3000);
  });

  it('returns the original Project for an identical resize boundary', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 0, 'no-op resize');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.arrange(project, {
      shotId: IDS.shot,
      dialogueId: id,
      frameSpanMs: 42,
    });
    const before = project;

    const after = service.resize(project, {
      shotId: IDS.shot,
      dialogueId: id,
      edge: 'end',
      timeMs: 42,
    });

    expect(after).toBe(before);
    expect(after.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 0,
      endMs: 42,
    });
  });

  it('keeps legacy overlapping Timed data loadable while rejecting new overlap', () => {
    const raw = buildProject();
    const legacy = ProjectSchema.parse({
      ...raw,
      shots: raw.shots.map((shot) => ({
        ...shot,
        dialogues: [
          {
            id: 'd2000000-0000-4000-8000-000000000091',
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 0,
            endMs: 1000,
            text: 'legacy one',
          },
          {
            id: 'd2000000-0000-4000-8000-000000000092',
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 500,
            endMs: 1500,
            text: 'legacy two',
          },
        ],
      })),
    });
    expect(legacy.shots[0]!.dialogues).toHaveLength(2);

    const service = dialogueService();
    const project = createAt(service, legacy, 750, 'new untimed');
    const id = project.shots[0]!.dialogues.at(-1)!.id;
    expectDialogueError(
      () =>
        service.arrange(project, {
          shotId: IDS.shot,
          dialogueId: id,
          frameSpanMs: 42,
        }),
      'DIALOGUE_OVERLAP',
    );
  });
});

describe('DialogueService shared mutation behavior', () => {
  it('updates text and switches the default voice with speaker', () => {
    const service = dialogueService();
    let project = characterService().create(buildProject(), {
      name: '老虎',
      expressions: [{ name: '正常', assetId: IDS.assetChar2 }],
    });
    const tiger = project.characters[1]!;
    project = createAt(service, project, 100, '原始');
    const id = project.shots[0]!.dialogues[0]!.id;
    project = service.update(project, {
      shotId: IDS.shot,
      dialogueId: id,
      text: '改过的话',
      characterId: tiger.id,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      text: '改过的话',
      characterId: tiger.id,
      voiceProfileId: tiger.defaultVoiceProfileId,
    });
  });

  it('removes and round-trips Untimed Dialogue without schema changes', () => {
    const service = dialogueService();
    let project = createAt(service, buildProject(), 700, '持久化台词');
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(reopened.schemaVersion).toBe(6);
    expect(reopened.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 700,
      endMs: 700,
      text: '持久化台词',
    });
    const id = reopened.shots[0]!.dialogues[0]!.id;
    project = service.remove(reopened, IDS.shot, id);
    expect(project.shots[0]!.dialogues).toHaveLength(0);
  });

  it('rejects invalid text/time and missing identities', () => {
    const service = dialogueService();
    const project = buildProject();
    expectDialogueError(
      () => createAt(service, project, 1.5, 'fraction'),
      'INVALID_DIALOGUE_TIME',
    );
    expectDialogueError(
      () => createAt(service, project, 100, '   '),
      'INVALID_DIALOGUE_TEXT',
    );
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
