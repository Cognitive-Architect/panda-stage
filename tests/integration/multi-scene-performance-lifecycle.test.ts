import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MultiScenePerformanceService,
  ProjectSchema,
  TimelineEventSchema,
  evaluateShotAtTime,
  parseMultiSceneInput,
} from '../../src/domain';
import { ShotService } from '../../src/domain/services';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  commitMultiScenePerformancePreview,
  prepareMultiScenePerformancePreview,
} from '../../src/renderer/features/shots/multiScenePerformancePlan';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  PERFORMANCE_THREE_BLOCKS,
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

const temporaryParents: string[] = [];

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-auto06-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, 'auto06.pandastage');
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AUTO-06 batch lifecycle', () => {
  it('saves, reopens, and keeps ordinary editable TimelineEvents', async () => {
    const root = await projectRoot();
    const projectService = new ProjectService({
      createId: (() => {
        let counter = 0;
        return () =>
          `d2a60000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
      })(),
      now: () => new Date('2026-11-07T12:00:00.000Z'),
    });
    const created = await projectService.create(root, {
      name: 'AUTO-06 表演编排',
    });
    const project = ProjectSchema.parse({
      ...buildPerformanceProject(),
      id: created.project.id,
    });

    const editorStore = new EditorProjectStore();
    const shotStore = new ShotStore(editorStore, new ShotService());
    editorStore.open(root, project);

    const service = new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    });
    const options = { editorStore, shotStore, service };
    const prepared = prepareMultiScenePerformancePreview(
      parseMultiSceneInput(PERFORMANCE_THREE_BLOCKS),
      [],
      options,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const committed = commitMultiScenePerformancePreview(
      prepared.preview,
      options,
    );

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
      expect(shot.audioClips.every((clip) => clip.role === 'dialogue')).toBe(
        true,
      );
      expect(evaluateShotAtTime(shot, 0, reopened.project).layers).toHaveLength(
        3,
      );
    }

    const events = generated.flatMap((shot) => shot.timelineEvents);
    expect(events).toHaveLength(committed.performance.eventCount);
    expect(events).toHaveLength(8);
    for (const event of events) {
      expect(() => TimelineEventSchema.parse(event)).not.toThrow();
      const shot = generated.find((entry) =>
        entry.timelineEvents.some((candidate) => candidate.id === event.id),
      )!;
      const layer = shot.layers.find((entry) => entry.id === event.layerId)!;
      expect(layer.source.kind).toBe('character');
      expect(event.layerId).not.toBe(shot.backgroundLayerId);
      const dialogue = shot.dialogues.find(
        (entry) => entry.startMs === event.startMs,
      );
      expect(dialogue).toBeDefined();
      if (layer.source.kind === 'character') {
        expect(layer.source.characterId).toBe(dialogue!.characterId);
      }
    }

    for (const row of committed.performance.rows) {
      const shot = generated.find((entry) => entry.id === row.shotId)!;
      expect(
        shot.timelineEvents.some((event) => event.id === row.eventIds[0]),
      ).toBe(true);
      expect(
        shot.dialogues.some((dialogue) => dialogue.startMs === row.startMs),
      ).toBe(true);
    }

    // The reopened Shot is still an ordinary editable Shot: a normal editor
    // service can extend it without touching any AUTO-06 event.
    const first = generated[0]!;
    const edited = new ShotService().setDuration(
      reopened.project,
      first.id,
      first.durationMs + 500,
    );
    const editedShot = edited.shots.find((shot) => shot.id === first.id)!;
    expect(editedShot.durationMs).toBe(first.durationMs + 500);
    expect(editedShot.timelineEvents).toEqual(first.timelineEvents);
  });
});
