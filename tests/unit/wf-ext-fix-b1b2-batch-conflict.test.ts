import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeKeyTimes,
  TimelineEventBatchError,
  type ExpressionEvent,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const EV_A = '87000000-0000-4000-8000-000000000201';
const EV_B = '87000000-0000-4000-8000-000000000202';
const EV_RESIDENT = '87000000-0000-4000-8000-000000000203';
const EV_C = '87000000-0000-4000-8000-000000000204';
const LAYER_ID = '60000000-0000-4000-8000-000000000099';

function expressionAt(id: string, startMs: number): ExpressionEvent {
  return {
    id,
    type: 'expression',
    layerId: IDS.layerChar,
    startMs,
    endMs: startMs,
    expressionId: IDS.expressionAngry,
  };
}

function buildTwoPointProject(
  starts: readonly [number, number],
  extra: readonly ExpressionEvent[] = [],
): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  return ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 8_000,
        timelineEvents: [
          expressionAt(EV_A, starts[0]),
          expressionAt(EV_B, starts[1]),
          ...extra,
        ],
      },
    ],
  });
}

function buildKeyedProject(): Project {
  const motion = new LayerMotionService();
  const base = buildProject();
  const shot = base.shots[0]!;
  const motionLayer = {
    ...shot.layers[0]!,
    id: LAYER_ID,
    name: '运动层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  let project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 4_000,
        layers: [...shot.layers, motionLayer],
      },
    ],
  });
  for (const timeMs of [500, 1_000, 1_500, 2_000]) {
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs, autoKey: true },
      { x: 400 + timeMs / 10 },
    );
  }
  return project;
}

function keyTimes(project: Project): number[] {
  const layer = project.shots[0]!.layers.find(
    (candidate) => candidate.id === LAYER_ID,
  )!;
  return layerCompositeKeyTimes(layer);
}

function pointStarts(project: Project): Array<[string, number, number]> {
  return project.shots[0]!.timelineEvents
    .filter((event) => event.type === 'expression')
    .map((event) => [event.id, event.startMs, event.endMs]);
}

describe('WF-EXT FIX B1: point events use final batch positions (P2-04)', () => {
  it('shifts 500/1000ms points by +500ms without a false conflict', () => {
    const service = new TimelineEventBatchService();
    const project = buildTwoPointProject([500, 1_000]);

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B],
      edit: { action: 'shift', deltaMs: 500 },
    });
    expect(plan.skipped).toHaveLength(0);
    expect(plan.entries.map((entry) => entry.nextStartMs)).toEqual([1_000, 1_500]);

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B],
      edit: { action: 'shift', deltaMs: 500 },
    });
    expect(pointStarts(shifted)).toEqual([
      [EV_A, 1_000, 1_000],
      [EV_B, 1_500, 1_500],
    ]);
  });

  it('shifts backwards without a false conflict and keeps zero span payloads', () => {
    const service = new TimelineEventBatchService();
    const project = buildTwoPointProject([500, 1_000]);

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B],
      edit: { action: 'shift', deltaMs: -500 },
    });
    const events = shifted.shots[0]!.timelineEvents;
    expect(events.find((event) => event.id === EV_A)).toMatchObject({
      startMs: 0,
      endMs: 0,
      expressionId: IDS.expressionAngry,
    });
    expect(events.find((event) => event.id === EV_B)).toMatchObject({
      startMs: 500,
      endMs: 500,
      expressionId: IDS.expressionAngry,
    });
  });

  it('still reports a real target conflict against an unselected point event', () => {
    const service = new TimelineEventBatchService();
    const project = buildTwoPointProject([500, 1_000], [
      expressionAt(EV_RESIDENT, 1_500),
      expressionAt(EV_C, 2_500),
    ]);

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B, EV_C],
      edit: { action: 'shift', deltaMs: 500 },
    });

    // EV_B would land on the untouched 1500ms event, so it is skipped; skipping
    // keeps it at 1000ms, which cascades onto EV_A. EV_C is still valid.
    expect(plan.skipped.map((item) => [item.itemId, item.reasonCode])).toEqual([
      [EV_B, 'POINT_EVENT_CONFLICT'],
      [EV_A, 'POINT_EVENT_CONFLICT'],
    ]);
    expect(plan.entries.map((entry) => entry.eventId)).toEqual([EV_C]);

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B, EV_C],
      edit: { action: 'shift', deltaMs: 500 },
    });
    expect(pointStarts(shifted)).toEqual([
      [EV_A, 500, 500],
      [EV_B, 1_000, 1_000],
      [EV_RESIDENT, 1_500, 1_500],
      [EV_C, 3_000, 3_000],
    ]);
  });

  it('fails loudly when every selected point is blocked by the cascade', () => {
    const service = new TimelineEventBatchService();
    const project = buildTwoPointProject([500, 1_000], [
      expressionAt(EV_RESIDENT, 1_500),
    ]);

    expect(() =>
      service.plan(project, {
        shotId: IDS.shot,
        eventIds: [EV_A, EV_B],
        edit: { action: 'shift', deltaMs: 500 },
      }),
    ).toThrow(TimelineEventBatchError);
  });

  it('does not cascade-skip when the freed slot is genuinely free', () => {
    const service = new TimelineEventBatchService();
    const project = buildTwoPointProject([500, 1_000], [
      expressionAt(EV_RESIDENT, 3_000),
    ]);

    const plan = service.plan(project, {
      shotId: IDS.shot,
      eventIds: [EV_A, EV_B],
      edit: { action: 'shift', deltaMs: 500 },
    });
    expect(plan.skipped).toHaveLength(0);
    expect(plan.entries).toHaveLength(2);
  });
});

describe('WF-EXT FIX B2: partially overlapping key selections (P3-01)', () => {
  it('collapses overlapping selections into one retime unit', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();
    expect(keyTimes(project)).toEqual([0, 500, 1_000, 1_500, 2_000]);

    const spans = [
      {
        id: 'span-a',
        layerId: LAYER_ID,
        startMs: 500,
        endMs: 1_000,
        keyTimesMs: [500, 1_000],
      },
      {
        id: 'span-b',
        layerId: LAYER_ID,
        startMs: 1_000,
        endMs: 1_500,
        keyTimesMs: [1_000, 1_500],
      },
    ];

    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 250 },
    });
    expect(plan.motionSpanEntries).toHaveLength(1);
    expect(plan.motionSpanEntries[0]!.keyTimesMs).toEqual([500, 1_000, 1_500]);

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 250 },
    });
    // The shared 1000ms key moved exactly once.
    expect(keyTimes(shifted)).toEqual([0, 750, 1_250, 1_750, 2_000]);
  });

  it('rejects overlapping ranges for a duration unify instead of widening the selection', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();

    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'span-a',
          layerId: LAYER_ID,
          startMs: 500,
          endMs: 1_000,
          keyTimesMs: [500, 1_000],
        },
        {
          id: 'span-b',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_500,
          keyTimesMs: [1_000, 1_500],
        },
      ],
      edit: { action: 'unify-duration', durationMs: 800 },
    });

    expect(plan.motionSpanEntries).toHaveLength(1);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        itemId: 'span-b',
        reasonCode: 'INVALID_MOTION_SPAN',
      }),
    ]);
  });
});
