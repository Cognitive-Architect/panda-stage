import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeKeyTimes,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const KEY_TIMES = [500, 1_000, 1_500, 2_000] as const;
const LAYER_ID = '60000000-0000-4000-8000-000000000099';

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
  for (const timeMs of KEY_TIMES) {
    project = motion.applyTransform(
      project,
      {
        shotId: IDS.shot,
        layerId: LAYER_ID,
        timeMs,
        autoKey: true,
      },
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

describe('WF-EXT B2 precise keyframe selection', () => {
  it('shifts exactly one non-zero key without touching the base key or other keys', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();
    expect(keyTimes(project)).toEqual([0, ...KEY_TIMES]);

    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'selected-1000',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });
    expect(plan.motionSpanEntries).toHaveLength(1);
    expect(plan.motionSpanEntries[0]).toMatchObject({
      startMs: 1_000,
      endMs: 1_000,
      nextStartMs: 1_250,
      nextEndMs: 1_250,
    });

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'selected-1000',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });
    expect(keyTimes(shifted)).toEqual([0, 500, 1_250, 1_500, 2_000]);
  });

  it('shifts a middle key selection and leaves keys outside the selection untouched', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();

    const shifted = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'selected-middle',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_500,
          keyTimesMs: [1_000, 1_500],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });

    expect(keyTimes(shifted)).toEqual([0, 500, 1_250, 1_750, 2_000]);
  });

  it('deduplicates identical key selections instead of shifting them twice', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();

    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'first',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
        {
          id: 'duplicate',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });

    expect(plan.motionSpanEntries).toHaveLength(1);
    const shifted = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'first',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
        {
          id: 'duplicate',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });
    expect(keyTimes(shifted)).toEqual([0, 500, 1_250, 1_500, 2_000]);
  });

  it('rejects non-contiguous key sets for unified duration and protects the 0ms base key', () => {
    const service = new TimelineEventBatchService();
    const project = buildKeyedProject();

    const nonContiguous = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'gap',
          layerId: LAYER_ID,
          startMs: 500,
          endMs: 1_500,
          keyTimesMs: [500, 1_500],
        },
        {
          id: 'contiguous',
          layerId: LAYER_ID,
          startMs: 500,
          endMs: 1_500,
          keyTimesMs: [500, 1_000, 1_500],
        },
      ],
      edit: { action: 'unify-duration', durationMs: 1_000 },
    });
    expect(nonContiguous.motionSpanEntries).toHaveLength(1);
    expect(nonContiguous.skipped[0]).toMatchObject({
      itemId: 'gap',
      reasonCode: 'INVALID_MOTION_SPAN',
    });

    const baseKey = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: [
        {
          id: 'base',
          layerId: LAYER_ID,
          startMs: 0,
          endMs: 500,
          keyTimesMs: [0, 500],
        },
        {
          id: 'normal',
          layerId: LAYER_ID,
          startMs: 1_000,
          endMs: 1_000,
          keyTimesMs: [1_000],
        },
      ],
      edit: { action: 'shift', deltaMs: 250 },
    });
    expect(baseKey.motionSpanEntries).toHaveLength(1);
    expect(baseKey.skipped[0]).toMatchObject({
      itemId: 'base',
      reasonCode: 'PROTECTED_BASE_KEY',
    });
  });
});
