import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  TimelineEventBatchError,
  TimelineEventBatchService,
  evaluateShotAtTime,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const MOVE_A = '80000000-0000-4000-8000-0000000000a1';
const SHAKE_A = '80000000-0000-4000-8000-0000000000a2';
const SCALE_A = '80000000-0000-4000-8000-0000000000a3';
const OPACITY_A = '80000000-0000-4000-8000-0000000000a4';
const KEEP_MOVE = '80000000-0000-4000-8000-0000000000a5';
const LATE_MOVE = '80000000-0000-4000-8000-0000000000b1';
const FIXED_MOVE = '80000000-0000-4000-8000-0000000000b2';

const NOW = new Date('2026-11-08T00:00:00.000Z');

function baseEvents(): TimelineEvent[] {
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
      id: SCALE_A,
      layerId: IDS.layerAsset,
      type: 'scale',
      startMs: 1_000,
      endMs: 1_400,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 2 },
      easing: 'ease-in-out',
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
    {
      id: KEEP_MOVE,
      layerId: IDS.layerChar,
      type: 'move',
      startMs: 6_000,
      endMs: 6_800,
      from: { x: 100, y: 100 },
      to: { x: 200, y: 200 },
      easing: 'linear',
    },
  ];
}

/** A 10s shot carrying exactly the given events. */
function buildWith(
  events: readonly TimelineEvent[],
  mutate: (project: Project) => Project = (project) => project,
): Project {
  const base = mutate(buildProject());
  const shot = base.shots[0]!;
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    shots: [{ ...shot, durationMs: 10_000, timelineEvents: [...events] }],
  });
}

function fixture(
  extra: readonly TimelineEvent[] = [],
  mutate: (project: Project) => Project = (project) => project,
): Project {
  return buildWith([...baseEvents(), ...extra], mutate);
}

function service(): TimelineEventBatchService {
  return new TimelineEventBatchService({ now: () => NOW });
}

function eventsById(project: Project): Map<string, TimelineEvent> {
  return new Map(
    project.shots[0]!.timelineEvents.map((event) => [event.id, event]),
  );
}

function shotOf(project: Project) {
  return project.shots[0]!;
}

describe('EF-03 batch timeline edit — domain plan', () => {
  it('shifts a group forward and backward without changing durations or spacing', () => {
    const project = fixture();
    const selected = [MOVE_A, SHAKE_A];

    const forward = service().apply(project, {
      shotId: IDS.shot,
      eventIds: selected,
      edit: { action: 'shift', deltaMs: 500 },
    });
    const after = eventsById(forward);
    expect(after.get(MOVE_A)).toMatchObject({ startMs: 1_500, endMs: 2_300 });
    expect(after.get(SHAKE_A)).toMatchObject({ startMs: 2_900, endMs: 3_500 });
    // Each duration and the gap inside the group are untouched.
    expect(after.get(MOVE_A)!.endMs - after.get(MOVE_A)!.startMs).toBe(800);
    expect(after.get(SHAKE_A)!.endMs - after.get(SHAKE_A)!.startMs).toBe(600);
    expect(after.get(SHAKE_A)!.startMs - after.get(MOVE_A)!.endMs).toBe(600);
    // Payload and the unselected neighbour are byte-identical.
    expect(after.get(MOVE_A)).toMatchObject({
      from: { x: 400, y: 500 },
      to: { x: 900, y: 500 },
      easing: 'linear',
      layerId: IDS.layerChar,
      type: 'move',
    });
    expect(after.get(SHAKE_A)).toMatchObject({
      amplitudeX: 12,
      amplitudeY: 8,
      frequencyHz: 4,
    });
    expect(forward.shots[0]!.timelineEvents.find((e) => e.id === KEEP_MOVE)).toEqual(
      project.shots[0]!.timelineEvents.find((e) => e.id === KEEP_MOVE),
    );

    const backward = service().apply(project, {
      shotId: IDS.shot,
      eventIds: selected,
      edit: { action: 'shift', deltaMs: -500 },
    });
    const back = eventsById(backward);
    expect(back.get(MOVE_A)).toMatchObject({ startMs: 500, endMs: 1_300 });
    expect(back.get(SHAKE_A)).toMatchObject({ startMs: 1_900, endMs: 2_500 });
  });

  it('accepts a mixed group across layers and channels in one apply', () => {
    const project = fixture();

    const next = service().apply(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, SCALE_A, OPACITY_A],
      edit: { action: 'shift', deltaMs: 500 },
    });
    const after = eventsById(next);
    expect(after.get(MOVE_A)).toMatchObject({ startMs: 1_500, endMs: 2_300 });
    expect(after.get(SCALE_A)).toMatchObject({ startMs: 1_500, endMs: 1_900 });
    expect(after.get(OPACITY_A)).toMatchObject({ startMs: 2_500, endMs: 3_100 });
  });

  it('unifies duration by keeping each start and retiming only the end', () => {
    const project = fixture();
    const plan = service().plan(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, OPACITY_A],
      edit: { action: 'unify-duration', durationMs: 800 },
    });
    // The move is already 800ms long, so only the opacity row really changes.
    expect(plan.changedCount).toBe(1);
    expect(plan.entries).toHaveLength(2);

    const next = service().apply(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, OPACITY_A],
      edit: { action: 'unify-duration', durationMs: 800 },
    });
    const after = eventsById(next);
    expect(after.get(MOVE_A)).toMatchObject({ startMs: 1_000, endMs: 1_800 });
    expect(after.get(OPACITY_A)).toMatchObject({ startMs: 2_000, endMs: 2_800 });
    expect(after.get(OPACITY_A)).toMatchObject({ from: 0, to: 1, easing: 'linear' });
  });

  it('feeds the formal evaluator the retimed spans instead of the old ones', () => {
    const project = fixture();
    const next = service().apply(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, OPACITY_A, SHAKE_A],
      edit: { action: 'unify-duration', durationMs: 800 },
    });

    // Opacity: 2000–2800 now, so half-way is exactly 0.5.
    const mid = evaluateShotAtTime(shotOf(next), 2_400, next);
    expect(
      mid.layers.find((layer) => layer.id === IDS.layerAsset)!.opacity,
    ).toBeCloseTo(0.5, 6);
    // At the new end it has fully arrived, and one ms earlier it has not.
    expect(
      evaluateShotAtTime(shotOf(next), 2_800, next).layers.find(
        (layer) => layer.id === IDS.layerAsset,
      )!.opacity,
    ).toBeCloseTo(1, 6);
    expect(
      evaluateShotAtTime(shotOf(next), 2_700, next).layers.find(
        (layer) => layer.id === IDS.layerAsset,
      )!.opacity,
    ).toBeCloseTo(0.875, 6);
    // Move: 1000–1800 was already 800ms, so the half-way position is unchanged.
    expect(
      evaluateShotAtTime(shotOf(next), 1_400, next).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!.x,
    ).toBeCloseTo(650, 6);
    // Shake: 2400–3200 now, so the wave is still inside its new span.
    const shakeAt3200 = evaluateShotAtTime(shotOf(next), 3_200, next).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    expect(Number.isFinite(shakeAt3200.x)).toBe(true);
  });

  it('keeps move and shake stackable and never rejects them as a conflict', () => {
    const project = fixture([
      {
        id: '80000000-0000-4000-8000-0000000000c1',
        layerId: IDS.layerChar,
        type: 'shake',
        startMs: 1_000,
        endMs: 1_800,
        amplitudeX: 4,
        amplitudeY: 4,
        frequencyHz: 2,
      },
    ]);
    const secondShake = '80000000-0000-4000-8000-0000000000c1';

    // Two shakes overlapping each other and a move is the formal stacking case.
    const plan = service().plan(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, SHAKE_A, secondShake],
      edit: { action: 'shift', deltaMs: 300 },
    });
    expect(plan.entries).toHaveLength(3);
  });
});

describe('EF-03 batch timeline edit — refusals', () => {
  function expectRefusal(
    project: Project,
    eventIds: readonly string[],
    edit:
      | { action: 'shift'; deltaMs: number }
      | { action: 'unify-duration'; durationMs: number },
    code: string,
    message: RegExp,
  ): void {
    const before = JSON.stringify(project);
    let thrown: unknown;
    try {
      service().apply(project, { shotId: IDS.shot, eventIds, edit });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TimelineEventBatchError);
    expect((thrown as TimelineEventBatchError).code).toBe(code);
    expect((thrown as Error).message).toMatch(message);
    // The whole batch is rejected: the Project never changed.
    expect(JSON.stringify(project)).toBe(before);
  }

  it('refuses fewer than two events', () => {
    expectRefusal(
      fixture(),
      [MOVE_A],
      { action: 'shift', deltaMs: 100 },
      'TIMELINE_EVENT_BATCH_TOO_SMALL',
      /至少勾选两条/u,
    );
  });

  it('refuses an event that no longer exists', () => {
    expectRefusal(
      fixture(),
      [MOVE_A, '80000000-0000-4000-8000-0000000000ff'],
      { action: 'shift', deltaMs: 100 },
      'TIMELINE_EVENT_NOT_FOUND',
      /已不存在/u,
    );
  });

  it('refuses expression, flip and visibility events', () => {
    const project = fixture([
      {
        id: '80000000-0000-4000-8000-0000000000d1',
        layerId: IDS.layerChar,
        type: 'expression',
        startMs: 4_000,
        endMs: 4_000,
        expressionId: IDS.expressionAngry,
      },
    ]);
    expectRefusal(
      project,
      [MOVE_A, '80000000-0000-4000-8000-0000000000d1'],
      { action: 'shift', deltaMs: 100 },
      'TIMELINE_EVENT_UNSUPPORTED',
      /表情事件不支持批量调整/u,
    );
  });

  it('refuses an event without a real duration', () => {
    const project = fixture([
      {
        id: '80000000-0000-4000-8000-0000000000d2',
        layerId: IDS.layerAsset,
        type: 'move',
        startMs: 4_000,
        endMs: 4_000,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        easing: 'linear',
      },
    ]);
    expectRefusal(
      project,
      [MOVE_A, '80000000-0000-4000-8000-0000000000d2'],
      { action: 'shift', deltaMs: 100 },
      'TIMELINE_EVENT_NOT_TIMED',
      /还没有持续时间/u,
    );
  });

  it('refuses events of a locked Layer', () => {
    const project = fixture([], (base) => ({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerAsset ? { ...layer, locked: true } : layer,
        ),
      })),
    }));
    expectRefusal(
      project,
      [SCALE_A, OPACITY_A],
      { action: 'shift', deltaMs: 100 },
      'TIMELINE_EVENT_LAYER_LOCKED',
      /已锁定/u,
    );
  });

  it('refuses batches that would leave the shot or the representable range', () => {
    expectRefusal(
      fixture(),
      [MOVE_A, SHAKE_A],
      { action: 'shift', deltaMs: -1_500 },
      'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
      /超出镜头开头/u,
    );
    expectRefusal(
      fixture(),
      [MOVE_A, SHAKE_A],
      { action: 'shift', deltaMs: 9_000 },
      'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
      /超出镜头结尾/u,
    );
    expectRefusal(
      fixture(),
      [MOVE_A, OPACITY_A],
      { action: 'unify-duration', durationMs: 9_000 },
      'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
      /超出镜头结尾/u,
    );
  });

  it('refuses non-integer and non-positive amounts', () => {
    expectRefusal(
      fixture(),
      [MOVE_A, SHAKE_A],
      { action: 'shift', deltaMs: 100.5 },
      'INVALID_TIMELINE_EDIT_AMOUNT',
      /有效的秒数/u,
    );
    expectRefusal(
      fixture(),
      [MOVE_A, SHAKE_A],
      { action: 'unify-duration', durationMs: 0 },
      'INVALID_TIMELINE_EDIT_AMOUNT',
      /必须大于 0 秒/u,
    );
  });

  it('refuses a newly introduced overlap inside the same evaluator channel', () => {
    // SHAKE→2.3s would land on the unselected move at 2.2–2.8s.
    const project = fixture([
      {
        id: '80000000-0000-4000-8000-0000000000e1',
        layerId: IDS.layerChar,
        type: 'move',
        startMs: 2_200,
        endMs: 2_800,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        easing: 'linear',
      },
    ]);
    expectRefusal(
      project,
      [MOVE_A, SHAKE_A],
      { action: 'shift', deltaMs: 600 },
      'TIMELINE_EVENT_OVERLAP',
      /会重叠/u,
    );
  });

  it('refuses a pair whose evaluator override order would flip', () => {
    // A pre-existing overlap is not a new fault, but swapping which move wins
    // would silently change playback, so the batch is refused.
    const project = buildWith([
      {
        id: FIXED_MOVE,
        layerId: IDS.layerChar,
        type: 'move',
        startMs: 0,
        endMs: 2_000,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
        easing: 'linear',
      },
      {
        id: LATE_MOVE,
        layerId: IDS.layerChar,
        type: 'move',
        startMs: 1_000,
        endMs: 1_500,
        from: { x: 20, y: 20 },
        to: { x: 30, y: 30 },
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
    ]);
    expectRefusal(
      project,
      [LATE_MOVE, SHAKE_A],
      { action: 'shift', deltaMs: -1_000 },
      'TIMELINE_EVENT_ORDER_REVERSED',
      /顺序会被颠倒/u,
    );
  });
});

describe('EF-03 batch timeline edit — no-op and isolation', () => {
  it('treats a zero shift and an already-matching duration as no-ops', () => {
    const project = fixture();
    const svc = service();

    expect(
      svc.apply(project, {
        shotId: IDS.shot,
        eventIds: [MOVE_A, SHAKE_A],
        edit: { action: 'shift', deltaMs: 0 },
      }),
    ).toBe(project);

    expect(
      svc.apply(project, {
        shotId: IDS.shot,
        eventIds: [MOVE_A, KEEP_MOVE],
        edit: { action: 'unify-duration', durationMs: 800 },
      }),
    ).toBe(project);

    expect(
      svc.plan(project, {
        shotId: IDS.shot,
        eventIds: [MOVE_A, KEEP_MOVE],
        edit: { action: 'unify-duration', durationMs: 800 },
      }).changedCount,
    ).toBe(0);
  });

  it('never touches Dialogue, audio clips or the Shot length', () => {
    const project = fixture();
    const before = shotOf(project);

    const next = service().apply(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, SHAKE_A],
      edit: { action: 'shift', deltaMs: 500 },
    });
    const after = shotOf(next);

    expect(after.dialogues).toEqual(before.dialogues);
    expect(after.audioClips).toEqual(before.audioClips);
    expect(after.durationMs).toBe(before.durationMs);
    expect(after.layers).toEqual(before.layers);
    expect(next.assets).toEqual(project.assets);
    expect(next.characters).toEqual(project.characters);
    expect(next.animations).toEqual(project.animations);
    expect(next.createdAt).toBe(project.createdAt);
  });

  it('keeps two identically named Layers apart by event id', () => {
    const secondLayer = '60000000-0000-4000-8000-000000000009';
    const otherRoom = '80000000-0000-4000-8000-0000000000f1';
    const project = fixture(
      [
        {
          id: otherRoom,
          layerId: secondLayer,
          type: 'move',
          startMs: 1_000,
          endMs: 1_400,
          from: { x: 0, y: 0 },
          to: { x: 10, y: 10 },
          easing: 'linear',
        },
      ],
      (base) => ({
        ...base,
        shots: base.shots.map((shot) => ({
          ...shot,
          layers: [
            ...shot.layers,
            {
              ...shot.layers[2]!,
              id: secondLayer,
              zIndex: 3,
            },
          ],
        })),
      }),
    );

    const plan = service().plan(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, otherRoom],
      edit: { action: 'shift', deltaMs: 200 },
    });
    expect(plan.entries.map((entry) => entry.layerId)).toEqual([
      IDS.layerChar,
      secondLayer,
    ]);
    expect(plan.entries.map((entry) => entry.layerName)).toEqual(['角色', '角色']);

    const next = service().apply(project, {
      shotId: IDS.shot,
      eventIds: [otherRoom, SHAKE_A],
      edit: { action: 'shift', deltaMs: 200 },
    });
    const after = eventsById(next);
    expect(after.get(otherRoom)).toMatchObject({ startMs: 1_200, endMs: 1_600 });
    expect(after.get(MOVE_A)).toMatchObject({ startMs: 1_000, endMs: 1_800 });
  });

  it('does not mutate the input Project while planning', () => {
    const project = fixture();
    const before = JSON.stringify(project);

    const plan = service().plan(project, {
      shotId: IDS.shot,
      eventIds: [MOVE_A, SHAKE_A],
      edit: { action: 'shift', deltaMs: 500 },
    });

    expect(plan.earliestStartMs).toBe(1_500);
    expect(plan.latestEndMs).toBe(3_500);
    expect(JSON.stringify(project)).toBe(before);
  });
});
