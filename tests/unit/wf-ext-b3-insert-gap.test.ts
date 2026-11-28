import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeKeyTimes,
  type Dialogue,
  type FlipEvent,
  type MoveEvent,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const LAYER_ID = '60000000-0000-4000-8000-000000000199';
const LOCKED_LAYER_ID = '60000000-0000-4000-8000-000000000198';
const DIALOGUE_BEFORE = '82000000-0000-4000-8000-000000000201';
const DIALOGUE_CROSSING = '82000000-0000-4000-8000-000000000202';
const DIALOGUE_AFTER = '82000000-0000-4000-8000-000000000203';
const DIALOGUE_TAIL = '82000000-0000-4000-8000-000000000204';
const EVENT_POINT = '87000000-0000-4000-8000-000000000201';
const EVENT_INTERVAL = '87000000-0000-4000-8000-000000000202';
const EVENT_CROSSING = '87000000-0000-4000-8000-000000000203';
const EVENT_LOCKED = '87000000-0000-4000-8000-000000000204';

function buildGapProject(durationMs = 3_000): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const motionLayer = {
    ...shot.layers[0]!,
    id: LAYER_ID,
    name: '运动层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const lockedLayer = {
    ...motionLayer,
    id: LOCKED_LAYER_ID,
    name: '锁定层',
    locked: true,
  };
  const dialog = (
    id: string,
    startMs: number,
    endMs: number,
    text: string,
  ): Dialogue => ({
    id,
    characterId: IDS.character,
    voiceProfileId: IDS.voiceProfile,
    subtitleStyleId: IDS.subtitle,
    startMs,
    endMs,
    text,
  });
  const point: FlipEvent = {
    id: EVENT_POINT,
    type: 'flip',
    layerId: LAYER_ID,
    startMs: 1_200,
    endMs: 1_200,
    axis: 'horizontal',
    flipped: true,
  };
  const interval: MoveEvent = {
    id: EVENT_INTERVAL,
    type: 'move',
    layerId: LAYER_ID,
    startMs: 1_100,
    endMs: 1_500,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    easing: 'linear',
  };
  const crossing: MoveEvent = {
    id: EVENT_CROSSING,
    type: 'move',
    layerId: LAYER_ID,
    startMs: 900,
    endMs: 1_300,
    from: { x: 100, y: 0 },
    to: { x: 200, y: 0 },
    easing: 'linear',
  };
  const lockedPoint: FlipEvent = {
    id: EVENT_LOCKED,
    type: 'flip',
    layerId: LOCKED_LAYER_ID,
    startMs: 1_200,
    endMs: 1_200,
    axis: 'horizontal',
    flipped: true,
  };

  let project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs,
        layers: [...shot.layers, motionLayer, lockedLayer],
        dialogues: [
          dialog(DIALOGUE_BEFORE, 400, 800, '插入点之前'),
          dialog(DIALOGUE_CROSSING, 800, 1_100, '跨越插入点'),
          dialog(DIALOGUE_AFTER, 1_200, 1_600, '插入点之后'),
          dialog(DIALOGUE_TAIL, 2_500, 2_900, '尾部内容'),
        ],
        timelineEvents: [point, interval, crossing, lockedPoint],
      },
    ],
  });

  const motion = new LayerMotionService();
  for (const timeMs of [500, 1_000, 1_500]) {
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs, autoKey: true },
      { x: 400 + timeMs / 10 },
    );
  }
  return project;
}

function keyTimes(project: Project): number[] {
  return layerCompositeKeyTimes(
    project.shots[0]!.layers.find((layer) => layer.id === LAYER_ID)!,
  );
}

describe('WF-EXT B3 insert time gap', () => {
  it('shifts supported content at/after the playhead and reports crossing/locked items', () => {
    const service = new TimelineEventBatchService();
    const project = buildGapProject(5_000);

    const plan = service.planInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_000,
      durationMs: 500,
      layerIds: [LAYER_ID, LOCKED_LAYER_ID],
    });

    expect(plan.changedCount).toBeGreaterThan(0);
    expect(plan.dialogueIds).toEqual([DIALOGUE_AFTER, DIALOGUE_TAIL]);
    expect(plan.eventIds).toEqual([EVENT_POINT, EVENT_INTERVAL]);
    expect(plan.layerMotionSpans).toHaveLength(1);
    expect(plan.layerMotionSpans[0]!.keyTimesMs).toEqual([1_000, 1_500]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: DIALOGUE_CROSSING, reasonCode: 'CROSSES_INSERT_POINT' }),
        expect.objectContaining({ itemId: EVENT_CROSSING, reasonCode: 'CROSSES_INSERT_POINT' }),
        expect.objectContaining({ itemId: EVENT_LOCKED, reasonCode: 'LAYER_LOCKED' }),
      ]),
    );
    expect(plan.needsShotExtension).toBe(false);

    const applied = service.applyInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_000,
      durationMs: 500,
      layerIds: [LAYER_ID, LOCKED_LAYER_ID],
    });
    const shot = applied.shots[0]!;
    expect(shot.dialogues.find((item) => item.id === DIALOGUE_BEFORE)).toMatchObject({
      startMs: 400,
      endMs: 800,
    });
    expect(shot.dialogues.find((item) => item.id === DIALOGUE_AFTER)).toMatchObject({
      startMs: 1_700,
      endMs: 2_100,
    });
    expect(shot.timelineEvents.find((item) => item.id === EVENT_POINT)).toMatchObject({
      startMs: 1_700,
      endMs: 1_700,
    });
    expect(shot.timelineEvents.find((item) => item.id === EVENT_INTERVAL)).toMatchObject({
      startMs: 1_600,
      endMs: 2_000,
    });
    expect(shot.timelineEvents.find((item) => item.id === EVENT_CROSSING)).toMatchObject({
      startMs: 900,
      endMs: 1_300,
    });
    expect(keyTimes(applied)).toEqual([0, 500, 1_500, 2_000]);
  });

  it('extends the shot in the same candidate plan when tail content would overflow', () => {
    const service = new TimelineEventBatchService();
    const project = buildGapProject(3_000);

    const plan = service.planInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_000,
      durationMs: 500,
      layerIds: [LAYER_ID],
    });
    expect(plan.needsShotExtension).toBe(true);
    expect(plan.extensionToMs).toBe(3_400);

    const applied = service.applyInsertGap(project, {
      shotId: IDS.shot,
      atMs: 1_000,
      durationMs: 500,
      layerIds: [LAYER_ID],
    });
    expect(applied.shots[0]!.durationMs).toBe(3_400);
    expect(
      applied.shots[0]!.dialogues.find((item) => item.id === DIALOGUE_TAIL),
    ).toMatchObject({ startMs: 3_000, endMs: 3_400 });
    expect(keyTimes(applied)).toEqual([0, 500, 1_500, 2_000]);
  });

  it('does not move anything when the playhead is at the shot end', () => {
    const service = new TimelineEventBatchService();
    const project = buildGapProject(5_000);
    const plan = service.planInsertGap(project, {
      shotId: IDS.shot,
      atMs: 5_000,
      durationMs: 500,
      layerIds: [LAYER_ID],
    });
    expect(plan.changedCount).toBe(0);
    expect(service.applyInsertGap(project, {
      shotId: IDS.shot,
      atMs: 5_000,
      durationMs: 500,
      layerIds: [LAYER_ID],
    })).toBe(project);
  });
});
