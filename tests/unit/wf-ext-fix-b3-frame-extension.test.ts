import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeKeyTimes,
  type Dialogue,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const TAIL_LAYER_ID = '60000000-0000-4000-8000-000000000299';
const TAIL_DIALOGUE = '82000000-0000-4000-8000-000000000301';

function tailDialogue(): Dialogue {
  return {
    id: TAIL_DIALOGUE,
    characterId: IDS.character,
    voiceProfileId: IDS.voiceProfile,
    subtitleStyleId: IDS.subtitle,
    startMs: 900,
    endMs: 1_000,
    text: '贴着镜头末尾',
  };
}

/** Short shot whose last root-motion key sits exactly on the shot end. */
function buildTailKeyProject(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const motionLayer = {
    ...shot.layers[0]!,
    id: TAIL_LAYER_ID,
    name: '尾部层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 1_000,
        layers: [...shot.layers, motionLayer],
        dialogues: [tailDialogue()],
        timelineEvents: [],
      },
    ],
  });
  return new LayerMotionService().applyTransform(
    project,
    { shotId: IDS.shot, layerId: TAIL_LAYER_ID, timeMs: 1_000, autoKey: true },
    { x: 500 },
  );
}

function keyTimes(project: Project): number[] {
  return layerCompositeKeyTimes(
    project.shots[0]!.layers.find((layer) => layer.id === TAIL_LAYER_ID)!,
  );
}

describe('WF-EXT FIX B3: frame-snapped spacer extension (P2-05)', () => {
  it('extends to the real frame-snapped end instead of the requested delta', () => {
    const service = new TimelineEventBatchService();
    const project = buildTailKeyProject();
    expect(keyTimes(project)).toEqual([0, 1_000]);
    expect(project.shots[0]!.durationMs).toBe(1_000);

    const input = {
      shotId: IDS.shot,
      atMs: 900,
      durationMs: 30,
      layerIds: [TAIL_LAYER_ID],
    };
    const plan = service.planInsertGap(project, input);

    // 30ms is 0.72 frames; the 24fps grid moves the key to 1042ms, so 1030ms
    // would have been an incorrect (and out-of-bounds) extension.
    expect(plan.effectiveDeltaMs).toBe(42);
    expect(plan.frameSnapped).toBe(true);
    expect(plan.needsShotExtension).toBe(true);
    expect(plan.extensionToMs).toBe(1_042);
    expect(plan.changedCount).toBeGreaterThan(0);

    const applied = service.applyInsertGap(project, input);
    expect(applied.shots[0]!.durationMs).toBe(1_042);
    expect(keyTimes(applied)).toEqual([0, 1_042]);
    // Mixed-ms dialogue moves by the same real delta.
    expect(
      applied.shots[0]!.dialogues.find((item) => item.id === TAIL_DIALOGUE),
    ).toMatchObject({ startMs: 942, endMs: 1_042 });
  });

  it('does nothing (and extends nothing) when the request is under one frame', () => {
    const service = new TimelineEventBatchService();
    const project = buildTailKeyProject();
    const input = {
      shotId: IDS.shot,
      atMs: 900,
      durationMs: 10,
      layerIds: [TAIL_LAYER_ID],
    };

    const plan = service.planInsertGap(project, input);
    expect(plan.effectiveDeltaMs).toBe(0);
    expect(plan.changedCount).toBe(0);
    expect(plan.needsShotExtension).toBe(false);
    expect(plan.extensionToMs).toBeNull();

    expect(service.applyInsertGap(project, input)).toBe(project);
  });

  it('keeps the shot duration unchanged when the real result still fits', () => {
    const service = new TimelineEventBatchService();
    const base = buildProject();
    const shot = base.shots[0]!;
    const motionLayer = {
      ...shot.layers[0]!,
      id: TAIL_LAYER_ID,
      name: '尾部层',
      source: { kind: 'asset' as const, assetId: IDS.assetBg },
      cameraSpace: 'screen' as const,
    };
    const roomy = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...shot,
          durationMs: 2_000,
          layers: [...shot.layers, motionLayer],
          dialogues: [],
          timelineEvents: [],
        },
      ],
    });
    const project = new LayerMotionService().applyTransform(
      roomy,
      { shotId: IDS.shot, layerId: TAIL_LAYER_ID, timeMs: 1_000, autoKey: true },
      { x: 500 },
    );

    const plan = service.planInsertGap(project, {
      shotId: IDS.shot,
      atMs: 900,
      durationMs: 30,
      layerIds: [TAIL_LAYER_ID],
    });
    expect(plan.effectiveDeltaMs).toBe(42);
    expect(plan.needsShotExtension).toBe(false);
    expect(plan.extensionToMs).toBeNull();
    expect(keyTimes(service.applyInsertGap(project, {
      shotId: IDS.shot,
      atMs: 900,
      durationMs: 30,
      layerIds: [TAIL_LAYER_ID],
    }))).toEqual([0, 1_042]);
  });
});
