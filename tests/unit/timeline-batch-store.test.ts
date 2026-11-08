import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ShotService,
  TimelineEventBatchError,
  TimelineEventBatchService,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { TimelineBatchStore } from '../../src/renderer/stores/timelineBatchStore';
import { buildProject, IDS } from './domain/testProject';

const MOVE_A = '80000000-0000-4000-8000-0000000000a1';
const SHAKE_A = '80000000-0000-4000-8000-0000000000a2';
const OPACITY_A = '80000000-0000-4000-8000-0000000000a4';
const OTHER_SHOT = '50000000-0000-4000-8000-000000000002';

function events(): TimelineEvent[] {
  return [
    {
      id: MOVE_A,
      layerId: IDS.layerChar,
      type: 'move',
      startMs: 1_000,
      endMs: 1_800,
      from: { x: 400, y: 500 },
      to: { x: 900, y: 500 },
      easing: 'linear',
    },
    {
      id: SHAKE_A,
      layerId: IDS.layerChar,
      type: 'shake',
      startMs: 2_400,
      endMs: 3_000,
      amplitudeX: 12,
      amplitudeY: 8,
      frequencyHz: 4,
    },
    {
      id: OPACITY_A,
      layerId: IDS.layerAsset,
      type: 'opacity',
      startMs: 2_000,
      endMs: 2_600,
      from: 0,
      to: 1,
      easing: 'linear',
    },
  ];
}

function fixture(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    shots: [
      { ...shot, durationMs: 10_000, timelineEvents: events() },
      {
        ...shot,
        id: OTHER_SHOT,
        name: '第二个镜头',
        durationMs: 10_000,
        timelineEvents: [],
      },
    ],
  });
}

function harness() {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const store = new TimelineBatchStore(
    editor,
    shots,
    new TimelineEventBatchService({
      now: () => new Date('2026-11-08T00:00:00.000Z'),
    }),
  );
  editor.open('D:\\batch-timeline.pandastage', fixture());
  shots.select(IDS.shot);
  return { editor, shots, store };
}

const SELECTED = [MOVE_A, SHAKE_A];

describe('EF-03 batch timeline edit store', () => {
  it('commits one Project update and one History command for the whole group', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    store.apply(SELECTED, { action: 'shift', deltaMs: 500 });

    const after = editor.getSnapshot()!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.dirty).toBe(true);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Shift timeline events',
    });
    const byId = new Map(
      after.project.shots[0]!.timelineEvents.map((event) => [event.id, event]),
    );
    expect(byId.get(MOVE_A)).toMatchObject({ startMs: 1_500, endMs: 2_300 });
    expect(byId.get(SHAKE_A)).toMatchObject({ startMs: 2_900, endMs: 3_500 });
    expect(byId.get(OPACITY_A)).toMatchObject({ startMs: 2_000, endMs: 2_600 });
  });

  it('labels the unify action and keeps one Undo covering the whole batch', () => {
    const { editor, store } = harness();
    store.apply([MOVE_A, OPACITY_A], {
      action: 'unify-duration',
      durationMs: 800,
    });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Unify timeline event duration',
    });
    const unified = editor.getSnapshot()!.project.shots[0]!;
    expect(
      unified.timelineEvents.find((event) => event.id === OPACITY_A),
    ).toMatchObject({ startMs: 2_000, endMs: 2_800 });

    expect(editor.undo()).toBe(true);
    const undone = editor.getSnapshot()!.project.shots[0]!;
    expect(
      undone.timelineEvents.find((event) => event.id === OPACITY_A),
    ).toMatchObject({ startMs: 2_000, endMs: 2_600 });
    expect(
      undone.timelineEvents.find((event) => event.id === MOVE_A),
    ).toMatchObject({ startMs: 1_000, endMs: 1_800 });

    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.timelineEvents).toEqual(
      unified.timelineEvents,
    );
  });

  it('rejects an illegal batch without a revision or a History entry', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    expect(() =>
      store.apply(SELECTED, { action: 'shift', deltaMs: -1_500 }),
    ).toThrowError(/会超出镜头开头/u);

    const after = editor.getSnapshot()!;
    expect(after.revision).toBe(before.revision);
    expect(after.project).toBe(before.project);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('writes nothing when the batch is a no-op', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    store.apply(SELECTED, { action: 'shift', deltaMs: 0 });

    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('never commits a stale selection into a different Shot', () => {
    const { editor, shots, store } = harness();
    shots.select(OTHER_SHOT);
    const before = editor.getSnapshot()!;

    let thrown: unknown;
    try {
      store.apply(SELECTED, { action: 'shift', deltaMs: 500 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimelineEventBatchError);
    expect((thrown as TimelineEventBatchError).code).toBe(
      'TIMELINE_EVENT_NOT_FOUND',
    );
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('previews the candidate plan through the same domain owner', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    const plan = store.plan(SELECTED, { action: 'shift', deltaMs: -500 });

    expect(plan.earliestStartMs).toBe(500);
    expect(plan.latestEndMs).toBe(2_500);
    expect(plan.changedCount).toBe(2);
    expect(editor.getSnapshot()).toBe(before);
  });
});
