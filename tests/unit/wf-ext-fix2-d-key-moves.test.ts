import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeKeyTimes,
  type MoveEvent,
  type PlannedPerformanceRow,
  type Project,
} from '../../src/domain';
import { DialoguePerformanceLinkStore } from '../../src/renderer/stores/dialoguePerformanceLinkStore';
import { buildProject, IDS } from './domain/testProject';

const LAYER_ID = '60000000-0000-4000-8000-000000000491';
const EVENT_ID = '87000000-0000-4000-8000-000000000491';
const DIALOGUE_ID = '82000000-0000-4000-8000-000000000491';
const KEY_TIMES = [42, 83] as const;
const SPREAD_KEY_TIMES = [42, 500] as const;

function buildProjectWithKeys(keyTimes: readonly number[] = KEY_TIMES): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const layer = {
    ...shot.layers[0]!,
    id: LAYER_ID,
    name: '错位键层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const event: MoveEvent = {
    id: EVENT_ID,
    type: 'move',
    layerId: LAYER_ID,
    startMs: 42,
    endMs: 500,
    from: { x: 0, y: 0 },
    to: { x: 50, y: 0 },
    easing: 'linear',
  };
  let project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 2_000,
        layers: [...shot.layers, layer],
        timelineEvents: [event],
      },
    ],
  });
  const motion = new LayerMotionService();
  for (const timeMs of keyTimes) {
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs, autoKey: true },
      { x: 100 + timeMs },
    );
  }
  return project;
}

function keyTimes(project: Project): number[] {
  return layerCompositeKeyTimes(
    project.shots[0]!.layers.find((layer) => layer.id === LAYER_ID)!,
  );
}

function row(layerKeyTimes: readonly number[] = KEY_TIMES): PlannedPerformanceRow {
  return {
    directiveId: 'perf-1',
    blockIndex: 1,
    sourceLineNumber: 1,
    raw: '1｜配方｜错位键',
    dialogueOrdinal: 1,
    draftRowId: 'draft-row-1',
    dialogueId: DIALOGUE_ID,
    shotId: IDS.shot,
    shotName: '镜头',
    layerId: LAYER_ID,
    characterId: IDS.character,
    speakerName: '熊猫',
    action: 'action-recipe',
    actionLabel: '配方：错位键',
    property: 'action-recipe',
    startMs: 42,
    endMs: 500,
    requiredShotDurationMs: null,
    status: 'ready',
    eventIds: [EVENT_ID],
    motionKeyTimes: layerKeyTimes,
    issueCode: null,
    issueMessage: null,
  };
}

describe('WF-EXT FIX-02 D: per-key remap from the real batch result (R-P2-04)', () => {
  it('moves 42ms and 83ms keys to 83ms and 125ms without a fake 124ms identity', () => {
    const service = new TimelineEventBatchService();
    const project = buildProjectWithKeys();
    expect(keyTimes(project)).toEqual([0, 42, 83]);

    const spans = [
      {
        id: 'linked',
        layerId: LAYER_ID,
        startMs: 42,
        endMs: 83,
        keyTimesMs: [...KEY_TIMES],
      },
    ];
    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 42 },
    });
    const keyMoves = plan.motionSpanEntries[0]!.keyMoves!;
    expect(keyMoves).toEqual([
      { fromTimeMs: 42, toTimeMs: 83 },
      { fromTimeMs: 83, toTimeMs: 125 },
    ]);

    const applied = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 42 },
    });
    expect(keyTimes(applied)).toEqual([0, 83, 125]);

    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);
    store.remapAfterMove(project.id, IDS.shot, [DIALOGUE_ID], [
      { layerId: LAYER_ID, keyMoves },
    ]);

    const resolved = store.resolve(applied.id, applied.shots[0]!, [DIALOGUE_ID]);
    // A single integer delta (+42 everywhere) would fabricate 124ms and lose both.
    expect(resolved.layerMotionSpans[0]!.keyTimesMs).toEqual([83, 125]);
    expect(resolved.missingCount).toBe(0);
    expect(resolved.blockedCount).toBe(0);
  });

  it('only remaps keys that really moved and leaves unselected keys alone', () => {
    const service = new TimelineEventBatchService();
    const project = buildProjectWithKeys(SPREAD_KEY_TIMES);
    expect(keyTimes(project)).toEqual([0, 42, 500]);

    const spans = [
      {
        id: 'linked',
        layerId: LAYER_ID,
        startMs: 42,
        endMs: 42,
        keyTimesMs: [42],
      },
    ];
    const plan = service.plan(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 42 },
    });
    const keyMoves = plan.motionSpanEntries[0]!.keyMoves!;
    expect(keyMoves).toEqual([{ fromTimeMs: 42, toTimeMs: 83 }]);

    const applied = service.apply(project, {
      shotId: IDS.shot,
      layerMotionSpans: spans,
      edit: { action: 'shift', deltaMs: 42 },
    });
    expect(keyTimes(applied)).toEqual([0, 83, 500]);

    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row(SPREAD_KEY_TIMES)], project);
    store.remapAfterMove(project.id, IDS.shot, [DIALOGUE_ID], [
      { layerId: LAYER_ID, keyMoves },
    ]);

    const resolved = store.resolve(applied.id, applied.shots[0]!, [DIALOGUE_ID]);
    // The untouched 500ms key keeps its reference; only the moved key follows.
    expect(resolved.layerMotionSpans[0]!.keyTimesMs).toEqual([83, 500]);
    expect(resolved.missingCount).toBe(0);
  });
});
