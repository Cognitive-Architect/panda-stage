import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  ShotService,
  findDialogueText,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProductPreviewCues } from '../../src/renderer/shell/productPreviewModel';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
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
  it('replaces literal dialogue occurrences in scope as one edit, keeping the original recording and subtitle style', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-dialogue-find-'));
    temporaryParents.push(parent);
    const root = path.join(parent, 'episode.pandastage');
    const projects = new ProjectService();
    const created = await projects.create(root, { name: 'Episode' });
    const dialogues = new DialogueService();
    let project = addAudio(ProjectSchema.parse({ ...buildProject(), id: created.project.id }));
    project = new ShotService().create(project, { name: '镜头 2', durationMs: 3_000 });
    const secondShot = project.shots[1]!.id;
    project = dialogues.create(project, { shotId: IDS.shot, characterId: IDS.character, text: '师父+，师父+！', pointTimeMs: 500 });
    project = dialogues.create(project, { shotId: secondShot, speakerType: 'narrator', text: '师父+来了', pointTimeMs: 1_000 });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    project = dialogues.setTiming(project, { shotId: IDS.shot, dialogueId, startMs: 500, endMs: 1_500 });
    project = dialogues.bindAudio(project, { shotId: IDS.shot, dialogueId, assetId: AUDIO_ID });
    const editor = new EditorProjectStore();
    editor.open(root, project);
    const initial = editor.getSnapshot();
    const current = { query: '师父+', shotId: IDS.shot };
    const whole = { ...current, shotId: null };
    const firstShotHits = [...findDialogueText(project, current)];
    expect(firstShotHits.map((hit) => hit.offset)).toEqual([0, 4]);
    expect([...findDialogueText(project, whole)].map((hit) => hit.shotId)).toEqual([IDS.shot, IDS.shot, secondShot]);
    expect(editor.getSnapshot()).toBe(initial);
    expect(editor.history.getSnapshot().undoCount).toBe(0);
    const once = dialogues.replaceText(project, current, '$&师兄', firstShotHits[1]);
    expect(once.shots[0]!.dialogues[0]!.text).toBe('师父+，$&师兄！');
    expect(once.shots[1]).toEqual(project.shots[1]);
    expect(dialogues.replaceText(once, whole, '先生', firstShotHits[0])).toBe(once);
    const inShot = dialogues.replaceText(project, current, '老师');
    expect(inShot.shots[0]!.dialogues[0]!.text).toBe('老师，老师！');
    expect(inShot.shots[1]).toEqual(project.shots[1]);
    const all = dialogues.replaceText(project, whole, '老师');
    editor.updateProject(all, '替换台词');
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(project);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(all);
    await projects.save(root, all);
    const reopened = (await projects.open(root)).project;
    expect(reopened.shots[0]!.dialogues[0]).toEqual({ ...project.shots[0]!.dialogues[0], text: '老师，老师！' });
    expect(reopened.shots[1]!.dialogues[0]!.text).toBe('老师来了');
    expect(reopened.shots[0]!.audioClips).toEqual(project.shots[0]!.audioClips);
    expect(evaluateSubtitleAtTime(buildProductPreviewCues(reopened.shots[0]!), 750)).toMatchObject({
      text: '老师，老师！', styleId: project.shots[0]!.dialogues[0]!.subtitleStyleId,
    });
  });

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

  it('persists a shortened bound AudioClip tail across save and reopen', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-day29-trim-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'dialogue-audio-trim.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(root, { name: 'Audio trim' });
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
      text: '裁剪持久化',
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
    project = dialogueService.resizeBoundAudioEnd(project, {
      shotId: IDS.shot,
      dialogueId,
      endMs: 450,
    });
    await projectService.save(root, project, 1);

    const reopened = await projectService.open(root);
    expect(reopened.project.shots[0]!.audioClips[0]).toMatchObject({
      startMs: 0,
      endMs: 450,
      offsetMs: 0,
    });
  });
});
