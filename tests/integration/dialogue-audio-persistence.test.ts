import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject, IDS } from '../unit/domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000501';
const temporaryParents: string[] = [];

function addAudio(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '集成对白',
        relativePath: 'assets/integration.wav',
        mimeType: 'audio/wav',
        sha256: 'd'.repeat(64),
        durationMs: 800,
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

describe('Dialogue audio Phase 1 persistence integration', () => {
  it('saves and reopens an independently timed bound Dialogue', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-day29-audio-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'dialogue-audio.pandastage');
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2950000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
    });
    const created = await projectService.create(root, {
      name: 'Day29 Phase 1 audio',
    });
    const dialogueService = new DialogueService({
      createId: (() => {
        let counter = 100;
        return () =>
          `d2950000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-09-06T02:00:00.000Z'),
    });
    let project = addAudio(
      ProjectSchema.parse({
        ...buildProject(),
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      }),
    );
    project = dialogueService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '集成对白',
      pointTimeMs: 500,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId,
      startMs: 500,
      endMs: 1_500,
    });
    project = dialogueService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_ID,
    });
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedDialogue = reopenedShot.dialogues[0]!;
    expect(reopenedDialogue).toMatchObject({
      audioClipId: expect.any(String),
      startMs: 500,
      endMs: 1_500,
    });
    expect(reopenedShot.audioClips).toHaveLength(1);
    expect(reopenedShot.audioClips[0]).toMatchObject({
      assetId: AUDIO_ID,
      startMs: 500,
      endMs: 1_300,
      offsetMs: 0,
    });

    const persisted = await readFile(path.join(root, 'project.json'), 'utf8');
    const persistedProject = JSON.parse(persisted) as Project;
    expect(persistedProject.shots[0]?.dialogues[0]?.audioClipId).toBe(
      reopenedDialogue.audioClipId,
    );
    expect(persisted).not.toContain('"undoCount"');
    expect(persisted).not.toContain('"history"');
  });

  it('persists an explicit unbind without deleting the source AudioAsset', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-day29-unbind-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'dialogue-audio-unbind.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(root, { name: 'Audio unbind' });
    const dialogueService = new DialogueService();
    let project = addAudio(
      ProjectSchema.parse({
        ...buildProject(),
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      }),
    );
    project = dialogueService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '解绑后保留素材',
      pointTimeMs: 0,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId,
      startMs: 0,
      endMs: 1_000,
    });
    project = dialogueService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_ID,
    });
    project = dialogueService.unbindAudio(project, IDS.shot, dialogueId);
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    expect(reopened.project.shots[0]!.dialogues[0]!.audioClipId).toBeUndefined();
    expect(reopened.project.shots[0]!.audioClips).toHaveLength(0);
    expect(reopened.project.assets.some(({ id }) => id === AUDIO_ID)).toBe(true);
  });
});
