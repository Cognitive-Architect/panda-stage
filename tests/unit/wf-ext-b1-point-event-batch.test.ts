import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  TimelineEventBatchError,
  TimelineEventBatchService,
  type ExpressionEvent,
  type FlipEvent,
  type MoveEvent,
  type Project,
  type VisibilityEvent,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const EV_EXPR = '87000000-0000-4000-8000-000000000101';
const EV_FLIP = '87000000-0000-4000-8000-000000000102';
const EV_VIS = '87000000-0000-4000-8000-000000000103';
const EV_EXPR_BLOCKER = '87000000-0000-4000-8000-000000000104';
const EV_MOVE = '87000000-0000-4000-8000-000000000105';

function buildPointProject(extraEvents: Project['shots'][number]['timelineEvents'] = []): Project {
  const base = buildProject();
  const shot = base.shots[0]!;

  const expression: ExpressionEvent = {
    id: EV_EXPR,
    type: 'expression',
    layerId: IDS.layerChar,
    startMs: 1_200,
    endMs: 1_200,
    expressionId: IDS.expressionAngry,
  };
  const flip: FlipEvent = {
    id: EV_FLIP,
    type: 'flip',
    layerId: IDS.layerChar,
    startMs: 1_500,
    endMs: 1_500,
    axis: 'horizontal',
    flipped: true,
  };
  const visibility: VisibilityEvent = {
    id: EV_VIS,
    type: 'visibility',
    layerId: IDS.layerChar,
    startMs: 1_800,
    endMs: 1_800,
    visible: false,
  };
  const move: MoveEvent = {
    id: EV_MOVE,
    type: 'move',
    layerId: IDS.layerAsset,
    startMs: 500,
    endMs: 1_500,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    easing: 'linear',
  };

  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 8_000,
        timelineEvents: [expression, flip, visibility, move, ...extraEvents],
      },
    ],
  });
}

const blocker: ExpressionEvent = {
  id: EV_EXPR_BLOCKER,
  type: 'expression',
  layerId: IDS.layerChar,
  startMs: 1_600,
  endMs: 1_600,
  expressionId: IDS.expressionAngry,
};

describe('WF-EXT B1 point-event batch shift', () => {
  it('shifts expression/flip/visibility by one delta while preserving IDs, payload and zero span', () => {
    const service = new TimelineEventBatchService();
    const project = buildPointProject();

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_EXPR, EV_FLIP, EV_VIS],
      edit: { action: 'shift', deltaMs: 400 },
    });

    expect(plan.entries).toHaveLength(3);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.entries.map((entry) => entry.nextStartMs)).toEqual([
      1_600, 1_900, 2_200,
    ]);
    expect(plan.entries.every((entry) => entry.nextStartMs === entry.nextEndMs)).toBe(true);

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_EXPR, EV_FLIP, EV_VIS],
      edit: { action: 'shift', deltaMs: 400 },
    });
    const shot = shifted.shots[0]!;

    expect(shot.timelineEvents.find((event) => event.id === EV_EXPR)).toMatchObject({
      id: EV_EXPR,
      type: 'expression',
      startMs: 1_600,
      endMs: 1_600,
      expressionId: IDS.expressionAngry,
    });
    expect(shot.timelineEvents.find((event) => event.id === EV_FLIP)).toMatchObject({
      id: EV_FLIP,
      type: 'flip',
      startMs: 1_900,
      endMs: 1_900,
      axis: 'horizontal',
      flipped: true,
    });
    expect(shot.timelineEvents.find((event) => event.id === EV_VIS)).toMatchObject({
      id: EV_VIS,
      type: 'visibility',
      startMs: 2_200,
      endMs: 2_200,
      visible: false,
    });
    // Unselected interval event is untouched.
    expect(shot.timelineEvents.find((event) => event.id === EV_MOVE)).toMatchObject({
      startMs: 500,
      endMs: 1_500,
    });
  });

  it('reports a same-layer same-type target collision instead of silently stacking', () => {
    const service = new TimelineEventBatchService();
    const project = buildPointProject([blocker]);

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_EXPR, EV_FLIP, EV_VIS],
      edit: { action: 'shift', deltaMs: 400 },
    });

    expect(plan.entries.map((entry) => entry.eventId)).toEqual([EV_FLIP, EV_VIS]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({
      itemId: EV_EXPR,
      reasonCode: 'POINT_EVENT_CONFLICT',
    });

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_EXPR, EV_FLIP, EV_VIS],
      edit: { action: 'shift', deltaMs: 400 },
    });
    const shot = shifted.shots[0]!;
    expect(shot.timelineEvents.find((event) => event.id === EV_EXPR)).toMatchObject({
      startMs: 1_200,
      endMs: 1_200,
    });
    expect(shot.timelineEvents.find((event) => event.id === EV_FLIP)).toMatchObject({
      startMs: 1_900,
      endMs: 1_900,
    });
    expect(shot.timelineEvents.find((event) => event.id === EV_VIS)).toMatchObject({
      startMs: 2_200,
      endMs: 2_200,
    });
  });

  it('keeps interval events editable while point events reject unify-duration', () => {
    const service = new TimelineEventBatchService();
    const project = buildPointProject();

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_EXPR, EV_MOVE],
      edit: { action: 'unify-duration', durationMs: 1_000 },
    });

    expect(plan.entries.map((entry) => entry.eventId)).toEqual([EV_MOVE]);
    expect(plan.skipped.map((item) => [item.itemId, item.reasonCode])).toEqual([
      [EV_EXPR, 'POINT_EVENT_DURATION_UNSUPPORTED'],
    ]);

    expect(() =>
      service.plan(project, {
        shotId: IDS.shot,
        eventIds: [EV_EXPR],
        edit: { action: 'unify-duration', durationMs: 1_000 },
      }),
    ).toThrow(TimelineEventBatchError);
  });
});
