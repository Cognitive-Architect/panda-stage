import { describe, expect, it } from 'vitest';
import {
  MultiScenePerformanceService,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotService } from '../../src/domain/services';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  MULTI_SCENE_PERFORMANCE_HISTORY_LABEL,
  commitMultiScenePerformancePreview,
  prepareMultiScenePerformancePreview,
} from '../../src/renderer/features/shots/multiScenePerformancePlan';
import { MultiSceneActionError } from '../../src/renderer/features/shots/multiScenePlan';
import {
  PERFORMANCE_THREE_BLOCKS,
  PERFORMANCE_TWO_BLOCKS,
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

function harness(project: Project = buildPerformanceProject()) {
  const editorStore = new EditorProjectStore();
  const shotStore = new ShotStore(editorStore, new ShotService());
  editorStore.open('D:\\auto06.pandastage', project);
  return { editorStore, shotStore, project };
}

function service() {
  return new MultiScenePerformanceService({
    createEventId: sequentialEventIds(),
  });
}

function prepare(raw: string, h: ReturnType<typeof harness>) {
  return prepareMultiScenePerformancePreview(
    parseMultiSceneInput(raw),
    [],
    {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: service(),
    },
  );
}

describe('AUTO-06 one atomic Project write', () => {
  it('commits Shots + Dialogue + AudioClips + TimelineEvents in one History', () => {
    const h = harness();
    const prepared = prepare(PERFORMANCE_THREE_BLOCKS, h);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // Preview stays runtime-only.
    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length,
    );

    const committed = commitMultiScenePerformancePreview(prepared.preview, {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: service(),
    });

    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });
    expect(h.editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: MULTI_SCENE_PERFORMANCE_HISTORY_LABEL,
    });
    const next = h.editorStore.getSnapshot()!.project;
    expect(next.shots).toHaveLength(h.project.shots.length + 3);
    expect(committed.performance.eventCount).toBe(8);
    const generated = next.shots.filter((shot) =>
      committed.createdShotIds.includes(shot.id),
    );
    expect(generated).toHaveLength(3);
    for (const shot of generated) {
      expect(shot.dialogues).toHaveLength(2);
      expect(shot.audioClips).toHaveLength(2);
      expect(shot.timelineEvents.length).toBeGreaterThan(0);
    }
    expect(
      generated.reduce((total, shot) => total + shot.timelineEvents.length, 0),
    ).toBe(8);
  });

  it('undoes and redoes the entire batch including performance events', () => {
    const h = harness();
    const prepared = prepare(PERFORMANCE_THREE_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    const committed = commitMultiScenePerformancePreview(prepared.preview, {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: service(),
    });

    h.editorStore.undo();
    const undone = h.editorStore.getSnapshot()!.project;
    expect(undone.shots).toHaveLength(h.project.shots.length);
    expect(
      committed.createdShotIds.every(
        (id) => !undone.shots.some((shot) => shot.id === id),
      ),
    ).toBe(true);

    h.editorStore.redo();
    const redone = h.editorStore.getSnapshot()!.project;
    const generated = redone.shots.filter((shot) =>
      committed.createdShotIds.includes(shot.id),
    );
    expect(generated).toHaveLength(3);
    expect(
      generated.reduce((total, shot) => total + shot.timelineEvents.length, 0),
    ).toBe(8);
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('writes nothing when a performance directive fails', () => {
    const conflicting = PERFORMANCE_TWO_BLOCKS.replace(
      '1｜抖动',
      '1｜抖动\n1｜右入场',
    );
    const h = harness();
    const prepared = prepare(conflicting, h);
    expect(prepared.ok).toBe(false);
    expect(prepared.ok ? '' : prepared.code).toBe('PERFORMANCE_CONFLICT');
    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length,
    );
  });

  it('refuses a stale preview after the Project changed', () => {
    const h = harness();
    const prepared = prepare(PERFORMANCE_TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    h.editorStore.updateProject({ ...h.project, name: 'Edited meanwhile' });

    expect(() =>
      commitMultiScenePerformancePreview(prepared.preview, {
        editorStore: h.editorStore,
        shotStore: h.shotStore,
        service: service(),
      }),
    ).toThrow(MultiSceneActionError);
    expect(h.editorStore.getSnapshot()).toMatchObject({ revision: 1 });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('a second confirm does not generate a second batch', () => {
    const h = harness();
    const prepared = prepare(PERFORMANCE_TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    const options = {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: service(),
    };
    commitMultiScenePerformancePreview(prepared.preview, options);
    expect(() =>
      commitMultiScenePerformancePreview(prepared.preview, options),
    ).toThrow(MultiSceneActionError);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length + 2,
    );
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(1);
  });
});
