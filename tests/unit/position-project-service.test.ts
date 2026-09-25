import { describe, expect, it } from 'vitest';
import {
  LayerService,
  PositionProjectService,
  PositionProjectServiceError,
  ProjectSchema,
  type Point,
  type Project,
  type PositionProjectCommandResult,
  type PositionProjectOperation,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { PositionStore } from '../../src/renderer/stores/positionStore';
import { buildProject, IDS } from './domain/testProject';

const BASE: Point = { x: 500, y: 600 };
const B: Point = { x: 700, y: 800 };
const C: Point = { x: 900, y: 1_000 };
const D: Point = { x: 1_100, y: 300 };

const MOVE_A = '70000000-0000-4000-8000-000000000001';
const MOVE_B = '70000000-0000-4000-8000-000000000002';
const MOVE_C = '70000000-0000-4000-8000-000000000003';
const SHAKE = '70000000-0000-4000-8000-000000000004';
const SCALE = '70000000-0000-4000-8000-000000000005';
const VISIBILITY = '70000000-0000-4000-8000-000000000006';
const OPACITY = '70000000-0000-4000-8000-000000000007';
const EXPRESSION = '70000000-0000-4000-8000-000000000008';
const FLIP = '70000000-0000-4000-8000-000000000009';

function move(
  id: string,
  startMs: number,
  endMs: number,
  from: Point,
  to: Point,
  easing: 'linear' | 'ease-in-out' = 'linear',
) {
  return {
    id,
    type: 'move' as const,
    layerId: IDS.layerAsset,
    startMs,
    endMs,
    from,
    to,
    easing,
  };
}

function managedProject(): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...shot,
        timelineEvents: [
          move(MOVE_A, 0, 1_000, BASE, B),
          {
            id: SHAKE,
            type: 'shake' as const,
            layerId: IDS.layerAsset,
            startMs: 250,
            endMs: 750,
            amplitudeX: 12,
            amplitudeY: 4,
            frequencyHz: 2,
          },
          move(MOVE_B, 1_000, 2_000, B, C),
          {
            id: SCALE,
            type: 'scale' as const,
            layerId: IDS.layerAsset,
            startMs: 0,
            endMs: 1_000,
            from: { x: 1, y: 1 },
            to: { x: 1.2, y: 1.2 },
            easing: 'linear' as const,
          },
          {
            id: VISIBILITY,
            type: 'visibility' as const,
            layerId: IDS.layerBg,
            startMs: 0,
            endMs: 2_000,
            visible: true,
          },
          {
            id: OPACITY,
            type: 'opacity' as const,
            layerId: IDS.layerAsset,
            startMs: 0,
            endMs: 1_000,
            from: 0.4,
            to: 0.9,
            easing: 'linear' as const,
          },
          {
            id: EXPRESSION,
            type: 'expression' as const,
            layerId: IDS.layerChar,
            startMs: 500,
            endMs: 1_500,
            expressionId: IDS.expressionAngry,
          },
          {
            id: FLIP,
            type: 'flip' as const,
            layerId: IDS.layerAsset,
            startMs: 1_000,
            endMs: 2_000,
            axis: 'horizontal' as const,
            flipped: true,
          },
        ],
      },
    ],
  });
}

function projectWithoutPosition(): Project {
  return buildProject();
}

function projectWithPlaybackOnlyPosition(): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...shot,
        timelineEvents: [
          move(MOVE_A, 0, 1_000, BASE, B, 'ease-in-out'),
        ],
      },
    ],
  });
}

function editorHarness(project: Project) {
  const editor = new EditorProjectStore();
  editor.open('D:\\pk-03.pandastage', project);
  const shotId = project.shots[0]!.id;
  const layerId = project.shots[0]!.layers.find(
    (layer) => layer.id === IDS.layerAsset,
  )!.id;
  const layerService = new LayerService({
    now: () => new Date('2026-09-21T00:00:00.000Z'),
  });
  const positionStore = new PositionStore(
    editor,
    new PositionProjectService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    }),
  );
  const layers = new LayerStore(
    editor,
    { getCurrentShotId: () => shotId },
    layerService,
  );
  return { editor, layers, positionStore, shotId, layerId };
}

function positionEvents(project: Project, layerId = IDS.layerAsset) {
  return project.shots[0]!.timelineEvents.filter(
    (event) => event.type === 'move' && event.layerId === layerId,
  );
}

class ReplacingProjectDuringCommand extends PositionProjectService {
  constructor(
    private readonly replace: () => void,
  ) {
    super({ now: () => new Date('2026-09-21T00:00:00.000Z') });
  }

  override applyOperation(
    project: Project,
    shotId: string,
    layerId: string,
    operation: PositionProjectOperation,
  ): PositionProjectCommandResult {
    const result = super.applyOperation(project, shotId, layerId, operation);
    this.replace();
    return result;
  }
}

describe('PK-03 Position Project command boundary', () => {
  it('binds Base -> first Move.from atomically through direct position update', () => {
    const initial = managedProject();
    const input = editorHarness(initial);
    const before = input.editor.getSnapshot()!.project;

    input.layers.updatePosition(input.layerId, D);

    const snapshot = input.editor.getSnapshot()!;
    const layer = snapshot.project.shots[0]!.layers.find(
      (candidate) => candidate.id === input.layerId,
    )!;
    const [first, second] = positionEvents(snapshot.project);
    const [beforeFirst, beforeSecond] = positionEvents(before);
    expect(snapshot.revision).toBe(1);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
    expect(layer).toMatchObject(D);
    expect(first).toMatchObject({ from: D, to: B });
    expect(second).toEqual(beforeSecond);
    expect(beforeFirst).toMatchObject({ from: BASE, to: B });
    expect(
      snapshot.project.shots[0]!.timelineEvents.find(
        (event) => event.id === SHAKE,
      ),
    ).toEqual(
      before.shots[0]!.timelineEvents.find((event) => event.id === SHAKE),
    );

    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(before);
    expect(input.editor.redo()).toBe(true);
    expect(
      positionEvents(input.editor.getSnapshot()!.project)[0],
    ).toMatchObject({ from: D });
  });

  it.each([
    ['literal 0:00', 0],
    ['near-zero input resolved to 0:00', 20],
  ] as const)('rejects %s ordinary updates as Base-protected zero-write', (_label, timeMs) => {
    const initial = managedProject();
    const input = editorHarness(initial);
    const before = input.editor.getSnapshot()!;
    const beforeLayer = before.project.shots[0]!.layers.find(
      (candidate) => candidate.id === input.layerId,
    )!;
    const beforeFirstMove = positionEvents(before.project)[0]!;

    expect(() =>
      input.positionStore.updateKey(input.shotId, input.layerId, {
        timeMs,
        position: D,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'POSITION_OPERATION_REJECTED',
        cause: expect.objectContaining({ code: 'base-protected' }),
      }),
    );

    const after = input.editor.getSnapshot()!;
    expect(after).toBe(before);
    expect(after.project).toBe(before.project);
    expect(after.project.shots[0]!.layers.find(
      (candidate) => candidate.id === input.layerId,
    )).toEqual(beforeLayer);
    expect(positionEvents(after.project)[0]).toEqual(beforeFirstMove);
    expect(after).toMatchObject({ dirty: false, revision: 0 });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('uses the same Base binding for full Transform updates and keeps non-Position fields', () => {
    const initial = managedProject();
    const input = editorHarness(initial);

    input.layers.updateTransform(input.layerId, {
      x: D.x,
      y: D.y,
      scale: 1.35,
      rotationDeg: 30,
      opacity: 0.65,
      flipX: true,
    });

    const snapshot = input.editor.getSnapshot()!;
    const layer = snapshot.project.shots[0]!.layers.find(
      (candidate) => candidate.id === input.layerId,
    )!;
    const [first, second] = positionEvents(snapshot.project);
    expect(snapshot.revision).toBe(1);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
    expect(layer).toMatchObject({
      x: D.x,
      y: D.y,
      scaleX: 1.35,
      scaleY: 1.35,
      rotationDeg: 30,
      opacity: 0.65,
      flipX: true,
    });
    expect(first).toMatchObject({ from: D, to: B });
    expect(second).toMatchObject({ from: B, to: C });
  });

  it('does not invent a key when a layer has no managed Position chain', () => {
    const initial = projectWithoutPosition();
    const input = editorHarness(initial);

    input.layers.updatePosition(input.layerId, D);

    const snapshot = input.editor.getSnapshot()!;
    const layer = snapshot.project.shots[0]!.layers.find(
      (candidate) => candidate.id === input.layerId,
    )!;
    expect(layer).toMatchObject(D);
    expect(positionEvents(snapshot.project)).toEqual([]);
    expect(snapshot.revision).toBe(1);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('keeps playback-only legacy Move data unchanged during a plain Base edit', () => {
    const initial = projectWithPlaybackOnlyPosition();
    const input = editorHarness(initial);
    const beforeEvent = initial.shots[0]!.timelineEvents[0]!;

    input.layers.updatePosition(input.layerId, D);

    const snapshot = input.editor.getSnapshot()!;
    expect(snapshot.project.shots[0]!.layers[1]).toMatchObject(D);
    expect(snapshot.project.shots[0]!.timelineEvents[0]).toEqual(beforeEvent);

    expect(() =>
      input.positionStore.appendKey(input.shotId, input.layerId, {
        timeMs: 2_000,
        position: C,
        eventId: MOVE_C,
      }),
    ).toThrow(
      expect.objectContaining<Partial<PositionProjectServiceError>>({
        code: 'POSITION_CHAIN_PLAYBACK_ONLY',
      }),
    );
    expect(input.editor.getSnapshot()!.revision).toBe(1);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it.each([
    'create-first',
    'append',
    'insert',
    'update',
    'delete',
    'retime',
    'hold',
  ] as const)('commits one logical %s operation as one History unit', (type) => {
    const initial = type === 'create-first' || type === 'hold'
      ? projectWithoutPosition()
      : managedProject();
    const input = editorHarness(initial);

    switch (type) {
      case 'create-first':
        input.positionStore.createFirstKey(input.shotId, input.layerId, {
          timeMs: 1_000,
          position: B,
          eventId: MOVE_C,
        });
        break;
      case 'append':
        input.positionStore.appendKey(input.shotId, input.layerId, {
          timeMs: 3_000,
          position: D,
          eventId: MOVE_C,
        });
        break;
      case 'insert':
        input.positionStore.insertKey(input.shotId, input.layerId, {
          timeMs: 500,
          position: D,
          eventId: MOVE_C,
        });
        break;
      case 'update':
        input.positionStore.updateKey(input.shotId, input.layerId, {
          timeMs: 1_000,
          position: D,
        });
        break;
      case 'delete':
        input.positionStore.deleteKey(input.shotId, input.layerId, 2_000);
        break;
      case 'retime':
        input.positionStore.retimeKey(
          input.shotId,
          input.layerId,
          2_000,
          2_500,
        );
        break;
      case 'hold':
        input.positionStore.createHold(input.shotId, input.layerId, {
          timeMs: 1_000,
          eventId: MOVE_C,
        });
        break;
    }

    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(initial);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.revision).toBe(3);
  });

  it('updates both shared endpoints together and treats a no-op as zero-write', () => {
    const initial = managedProject();
    const input = editorHarness(initial);

    input.positionStore.updateKey(input.shotId, input.layerId, {
      timeMs: 1_000,
      position: D,
    });
    const afterUpdate = input.editor.getSnapshot()!;
    expect(positionEvents(afterUpdate.project)).toEqual([
      expect.objectContaining({ id: MOVE_A, to: D }),
      expect.objectContaining({ id: MOVE_B, from: D }),
    ]);
    expect(afterUpdate.revision).toBe(1);
    expect(afterUpdate.dirty).toBe(true);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);

    const beforeNoOp = input.editor.getSnapshot();
    input.positionStore.updateKey(input.shotId, input.layerId, {
      timeMs: 1_000,
      position: D,
    });
    expect(input.editor.getSnapshot()).toBe(beforeNoOp);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('treats same-time retime as an exact zero-write no-op', () => {
    const initial = managedProject();
    const input = editorHarness(initial);
    const before = input.editor.getSnapshot()!;
    const beforeUpdatedAt = before.project.updatedAt;

    input.positionStore.retimeKey(
      input.shotId,
      input.layerId,
      2_000,
      2_000,
    );

    const after = input.editor.getSnapshot()!;
    expect(after).toBe(before);
    expect(after.project.updatedAt).toBe(beforeUpdatedAt);
    expect(after).toMatchObject({ dirty: false, revision: 0 });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('preserves unrelated layers and timeline data while merging managed MoveEvents', () => {
    const initial = managedProject();
    const service = new PositionProjectService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    });
    const shot = initial.shots[0]!;
    const result = service.applyOperation(initial, shot.id, IDS.layerAsset, {
      type: 'insert',
      input: { timeMs: 500, position: D, eventId: MOVE_C },
    });

    expect(result.project.assets).toEqual(initial.assets);
    expect(result.project.characters).toEqual(initial.characters);
    expect(result.project.shots[0]!.layers).toEqual(shot.layers);
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === SHAKE,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === SHAKE));
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === SCALE,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === SCALE));
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === VISIBILITY,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === VISIBILITY));
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === OPACITY,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === OPACITY));
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === EXPRESSION,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === EXPRESSION));
    expect(
      result.project.shots[0]!.timelineEvents.find(
        (event) => event.id === FLIP,
      ),
    ).toEqual(shot.timelineEvents.find((event) => event.id === FLIP));
    expect(
      positionEvents(result.project).sort(
        (left, right) => left.startMs - right.startMs,
      ),
    ).toEqual([
      expect.objectContaining({ id: MOVE_A, startMs: 0, endMs: 500, to: D }),
      expect.objectContaining({ id: MOVE_C, startMs: 500, endMs: 1_000 }),
      expect.objectContaining({ id: MOVE_B, startMs: 1_000, endMs: 2_000 }),
    ]);
  });

  it('rejects stale or invalid targets without a Project write', () => {
    const initial = managedProject();
    const input = editorHarness(initial);
    const before = input.editor.getSnapshot();

    expect(() =>
      input.positionStore.updateKey(
        input.shotId,
        '60000000-0000-4000-8000-000000000099',
        { timeMs: 1_000, position: D },
      ),
    ).toThrow(
      expect.objectContaining<Partial<PositionProjectServiceError>>({
        code: 'LAYER_NOT_FOUND',
      }),
    );
    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });

    expect(() =>
      input.positionStore.updateKey(
        '50000000-0000-4000-8000-000000000099',
        input.layerId,
        { timeMs: 1_000, position: D },
      ),
    ).toThrow(
      expect.objectContaining<Partial<PositionProjectServiceError>>({
        code: 'SHOT_NOT_FOUND',
      }),
    );
    expect(input.editor.getSnapshot()).toBe(before);
  });

  it('refuses to commit a command after the active Project snapshot is replaced', () => {
    const initial = managedProject();
    const replacement = ProjectSchema.parse({
      ...projectWithoutPosition(),
      name: 'Replacement project',
    });
    const editor = new EditorProjectStore();
    editor.open('D:\\pk-03-stale.pandastage', initial);
    const service = new ReplacingProjectDuringCommand(() => {
      editor.open('D:\\pk-03-replacement.pandastage', replacement);
    });
    const positionStore = new PositionStore(editor, service);

    expect(() =>
      positionStore.updateKey(IDS.shot, IDS.layerAsset, {
        timeMs: 1_000,
        position: D,
      }),
    ).toThrow('Position command target became stale');
    expect(editor.getSnapshot()!.project).toEqual(replacement);
    expect(editor.getSnapshot()!.projectRoot).toBe(
      'D:\\pk-03-replacement.pandastage',
    );
    expect(editor.getSnapshot()!.revision).toBe(0);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });
});
