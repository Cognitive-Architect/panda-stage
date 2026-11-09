import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MultiSceneDialogueService,
  ProjectSchema,
  evaluateShotAtTime,
  parseMultiSceneInput,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  commitMultiSceneDialoguePreview,
  prepareMultiSceneDialoguePreview,
} from '../../src/renderer/features/shots/multiSceneDialoguePlan';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  THREE_BLOCKS,
  buildDialogueProject,
} from '../helpers/multiSceneDialogueFixture';

const temporaryParents: string[] = [];

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-auto05-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, 'auto05.pandastage');
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AUTO-05 batch lifecycle', () => {
  it('saves, reopens, and keeps Shots / Dialogue / AudioClips fully editable', async () => {
    const root = await projectRoot();
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2a50000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-11-07T08:00:00.000Z'),
    });
    const created = await projectService.create(root, { name: 'AUTO-05 三镜头' });
    const project = ProjectSchema.parse({
      ...buildDialogueProject(),
      id: created.project.id,
    });

    const editorStore = new EditorProjectStore();
    const shotStore = new ShotStore(editorStore, new ShotService());
    editorStore.open(root, project);

    const service = new MultiSceneDialogueService();
    const prepared = prepareMultiSceneDialoguePreview(
      parseMultiSceneInput(THREE_BLOCKS),
      [],
      { editorStore, shotStore, service },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const committed = commitMultiSceneDialoguePreview(prepared.preview, {
      editorStore,
      shotStore,
      service,
    });

    await projectService.save(root, editorStore.getSnapshot()!.project, 1);
    const reopened = await projectService.open(root);

    const generated = reopened.project.shots.filter((shot) =>
      committed.createdShotIds.includes(shot.id),
    );
    expect(generated.map((shot) => shot.name)).toEqual([
      '花园相遇',
      '宗门大厅',
      '山门',
    ]);
    for (const shot of generated) {
      expect(shot.dialogues).toHaveLength(2);
      expect(shot.audioClips).toHaveLength(2);
      expect(shot.audioClips.every((clip) => clip.role === 'dialogue')).toBe(true);
      for (const clip of shot.audioClips) {
        expect(
          reopened.project.assets.some(
            (asset) => asset.id === clip.assetId && asset.kind === 'audio',
          ),
        ).toBe(true);
        const dialogue = shot.dialogues.find(
          (candidate) => candidate.audioClipId === clip.id,
        );
        expect(dialogue).toBeDefined();
        expect(dialogue!.startMs).toBe(clip.startMs);
        expect(dialogue!.endMs).toBe(clip.endMs);
      }
      const evaluated = evaluateShotAtTime(shot, 0, reopened.project);
      expect(evaluated.layers).toHaveLength(3);
    }
    expect(committed.dialogue.timings.map((timing) =>
      reopened.project.shots.find((shot) => shot.id === timing.shotId)!.durationMs,
    )).toEqual([3290, 3600, 3000]);
  });
});
