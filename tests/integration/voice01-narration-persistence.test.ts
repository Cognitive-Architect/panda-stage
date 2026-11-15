import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogueService, ProjectSchema, type Project } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject, IDS } from '../unit/domain/testProject';

const NARRATION_AUDIO = '10000000-0000-4000-8000-000000000601';
const temporaryParents: string[] = [];

function addNarrationAudio(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      {
        id: NARRATION_AUDIO,
        kind: 'audio',
        name: '001_旁白',
        relativePath: 'assets/001_旁白.wav',
        mimeType: 'audio/wav',
        sha256: 'e'.repeat(64),
        durationMs: 900,
      },
    ],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('VOICE-01 narration persistence', () => {
  it('saves, reopens and keeps narration and character lines apart', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-voice01-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'voice01.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(root, { name: 'VOICE-01' });
    const dialogueService = new DialogueService({
      createId: (() => {
        let counter = 700;
        return () =>
          `d3000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-11-08T06:00:00.000Z'),
    });
    let project = addNarrationAudio(
      ProjectSchema.parse({
        ...buildProject(),
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      }),
    );
    project = dialogueService.createMany(project, {
      shotId: IDS.shot,
      pointTimeMs: 0,
      lines: [
        { speakerType: 'narrator', text: '十年前，少年张三踏上修仙之路……' },
        { characterId: IDS.character, text: '张三：我来了。' },
      ],
    });
    const [narrationId, characterDialogueId] = project.shots[0]!.dialogues.map(
      (dialogue) => dialogue.id,
    );
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: narrationId!,
      startMs: 0,
      endMs: 800,
    });
    project = dialogueService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId: narrationId!,
      assetId: NARRATION_AUDIO,
    });
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: characterDialogueId!,
      startMs: 800,
      endMs: 1_600,
    });
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    const shot = reopened.project.shots[0]!;
    expect(shot.dialogues).toHaveLength(2);
    expect(shot.dialogues[0]).toMatchObject({
      speakerType: 'narrator',
      text: '十年前，少年张三踏上修仙之路……',
      startMs: 0,
      endMs: 800,
      audioClipId: expect.any(String),
    });
    expect(shot.dialogues[0]!.characterId).toBeUndefined();
    expect(shot.dialogues[0]!.voiceProfileId).toBeUndefined();
    expect(shot.dialogues[1]).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
    });
    expect(shot.dialogues[1]!.speakerType).toBeUndefined();
    expect(shot.audioClips[0]).toMatchObject({
      role: 'dialogue',
      assetId: NARRATION_AUDIO,
      startMs: 0,
      endMs: 800,
    });

    const persisted = JSON.parse(
      await readFile(path.join(root, 'project.json'), 'utf8'),
    ) as Project;
    expect(persisted.shots[0]!.dialogues[0]!.speakerType).toBe('narrator');
    expect(persisted.shots[0]!.dialogues[1]!.speakerType).toBeUndefined();
  });

  it('reopens an older project that has no speakerType unchanged', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-voice01-legacy-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'legacy.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(root, { name: 'Legacy' });
    const dialogueService = new DialogueService({
      createId: () => 'd3000000-0000-4000-8000-000000000799',
      now: () => new Date('2026-11-08T06:10:00.000Z'),
    });
    let project = ProjectSchema.parse({
      ...buildProject(),
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    project = dialogueService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '旧工程对白',
      pointTimeMs: 400,
    });
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    const dialogue = reopened.project.shots[0]!.dialogues[0]!;
    expect(dialogue).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      text: '旧工程对白',
    });
    expect(dialogue.speakerType).toBeUndefined();
  });
});
