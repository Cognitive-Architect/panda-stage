import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  TimelineEventBatchService,
  layerCompositeAuthoredValuesAtTime,
  layerCompositeKeyTimes,
  type MoveEvent,
  type PlannedPerformanceRow,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { DialoguePerformanceLinkStore } from '../../src/renderer/stores/dialoguePerformanceLinkStore';
import { buildProject, IDS } from './domain/testProject';

const LAYER_1_ID = '60000000-0000-4000-8000-000000000591';
const LAYER_2_ID = '60000000-0000-4000-8000-000000000592';
const EVENT_1_ID = '87000000-0000-4000-8000-000000000591';
const EVENT_2_ID = '87000000-0000-4000-8000-000000000592';
const DIALOGUE_1_ID = '82000000-0000-4000-8000-000000000591';
const DIALOGUE_2_ID = '82000000-0000-4000-8000-000000000592';

function buildFixtureProject(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const layer1 = {
    ...shot.layers[0]!,
    id: LAYER_1_ID,
    name: '主角联动层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const layer2 = {
    ...shot.layers[0]!,
    id: LAYER_2_ID,
    name: '配角健康层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const event1: MoveEvent = {
    id: EVENT_1_ID,
    type: 'move',
    layerId: LAYER_1_ID,
    startMs: 500,
    endMs: 900,
    from: { x: 0, y: 0 },
    to: { x: 40, y: 0 },
    easing: 'linear',
  };
  const event2: MoveEvent = {
    id: EVENT_2_ID,
    type: 'move',
    layerId: LAYER_2_ID,
    startMs: 1_500,
    endMs: 1_900,
    from: { x: 0, y: 0 },
    to: { x: 30, y: 0 },
    easing: 'linear',
  };
  let project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        durationMs: 4_000,
        layers: [...shot.layers, layer1, layer2],
        dialogues: [
          {
            id: DIALOGUE_1_ID,
            characterId: base.characters[0]!.id,
            speakerType: 'character',
            voiceProfileId: base.characters[0]!.defaultVoiceProfileId,
            text: '第一句',
            startMs: 42,
            endMs: 1_000,
            subtitleStyleId: shot.defaultSubtitleStyleId,
          },
          {
            id: DIALOGUE_2_ID,
            characterId: base.characters[0]!.id,
            speakerType: 'character',
            voiceProfileId: base.characters[0]!.defaultVoiceProfileId,
            text: '第二句',
            startMs: 1_500,
            endMs: 2_200,
            subtitleStyleId: shot.defaultSubtitleStyleId,
          },
        ],
        timelineEvents: [event1, event2],
      },
    ],
  });

  const motion = new LayerMotionService();
  // Linked keys on layer 1: 500ms (x=450) and 1000ms (x=500), plus unlinked key at 750ms (x=520).
  for (const [timeMs, x] of [
    [500, 450],
    [750, 520],
    [1_000, 500],
  ] as const) {
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs, autoKey: true },
      { x },
    );
  }
  // Healthy linked key on layer 2 for dialogue 2 at 1500ms (x=600).
  project = motion.applyTransform(
    project,
    { shotId: IDS.shot, layerId: LAYER_2_ID, timeMs: 1_500, autoKey: true },
    { x: 600 },
  );
  return project;
}

function row(
  overrides: Partial<PlannedPerformanceRow> = {},
): PlannedPerformanceRow {
  return {
    directiveId: 'perf-1',
    blockIndex: 1,
    sourceLineNumber: 1,
    raw: '1｜配方｜联动',
    dialogueOrdinal: 1,
    draftRowId: 'draft-row-1',
    dialogueId: DIALOGUE_1_ID,
    shotId: IDS.shot,
    shotName: '镜头',
    layerId: LAYER_1_ID,
    characterId: IDS.character,
    speakerName: '熊猫',
    action: 'action-recipe',
    actionLabel: '配方：联动',
    property: 'action-recipe',
    startMs: 500,
    endMs: 1_000,
    requiredShotDurationMs: null,
    status: 'ready',
    eventIds: [EVENT_1_ID],
    motionKeyTimes: [500, 1_000],
    issueCode: null,
    issueMessage: null,
    ...overrides,
  };
}

function layerKeyTimes(project: Project, layerId: string): number[] {
  return layerCompositeKeyTimes(
    project.shots[0]!.layers.find((layer) => layer.id === layerId)!,
  );
}

describe('WF-EXT FIX-03 D: transaction-driven invalidation on delete + identical re-create (R3-P2-03)', () => {
  it('invalidates a linked key deleted and re-created with identical time, property, and value while keeping healthy & unlinked keys safe', () => {
    const editorStore = new EditorProjectStore();
    const linkStore = new DialoguePerformanceLinkStore(editorStore);
    const motion = new LayerMotionService();
    const batch = new TimelineEventBatchService();

    const initial = buildFixtureProject();
    expect(layerKeyTimes(initial, LAYER_1_ID)).toEqual([0, 500, 750, 1_000]);
    editorStore.open('D:/wf-fix3-d.pandastage', initial);
    const beforeValues = layerCompositeAuthoredValuesAtTime(
      initial.shots[0]!.layers.find((layer) => layer.id === LAYER_1_ID)!,
      500,
    );

    linkStore.capture(
      initial.id,
      [
        row(),
        row({
          directiveId: 'perf-2',
          dialogueOrdinal: 2,
          draftRowId: 'draft-row-2',
          dialogueId: DIALOGUE_2_ID,
          layerId: LAYER_2_ID,
          eventIds: [EVENT_2_ID],
          motionKeyTimes: [1_500],
        }),
      ],
      initial,
    );

    // Real edit 1: delete the 500ms key through LayerMotionService + EditorProjectStore.
    const afterDelete = motion.deleteKey(editorStore.getSnapshot()!.project, {
      shotId: IDS.shot,
      layerId: LAYER_1_ID,
      timeMs: 500,
    });
    editorStore.updateProject(afterDelete, '删除对象动作关键帧');
    expect(layerKeyTimes(editorStore.getSnapshot()!.project, LAYER_1_ID)).not.toContain(
      500,
    );

    // Real edit 2: re-create a key at 500ms with the EXACT SAME property and value.
    const afterRecreate = motion.applyTransform(
      editorStore.getSnapshot()!.project,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 500, autoKey: true },
      { x: 450 },
    );
    editorStore.updateProject(afterRecreate, '重新创建关键帧');

    // Guard: authored values at 500ms are identical to the original key.
    const recreatedValues = layerCompositeAuthoredValuesAtTime(
      editorStore.getSnapshot()!.project.shots[0]!.layers.find(
        (layer) => layer.id === LAYER_1_ID,
      )!,
      500,
    );
    expect(recreatedValues).toEqual(beforeValues);

    // Resolve must mark the deleted-then-recreated 500ms key as missing and
    // only include the healthy 1000ms key + healthy event.
    const resolved = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_1_ID],
    );
    expect(resolved.missingCount).toBe(1);
    expect(resolved.blockedCount).toBe(0);
    expect(resolved.eventIds).toEqual([EVENT_1_ID]);
    expect(resolved.layerMotionSpans).toHaveLength(1);
    expect(resolved.layerMotionSpans[0]!.keyTimesMs).toEqual([1_000]);

    // Attempting a real linked shift must NOT move the re-created 500ms key
    // or the unlinked 750ms key, while moving the healthy 1000ms key & event.
    const plan = batch.planCrossTypeShift(editorStore.getSnapshot()!.project, {
      shotId: IDS.shot,
      dialogueIds: [DIALOGUE_1_ID],
      eventIds: resolved.eventIds,
      layerMotionSpans: resolved.layerMotionSpans,
      deltaMs: 42,
    });
    const moves = (plan.actionPlan?.motionSpanEntries ?? [])
      .filter((entry) => (entry.keyMoves?.length ?? 0) > 0)
      .map((entry) => ({
        layerId: entry.layerId,
        keyMoves: entry.keyMoves!,
      }));

    linkStore.applyTrackedMove(
      initial.id,
      IDS.shot,
      [DIALOGUE_1_ID],
      moves,
      () => {
        const next = batch.applyCrossTypeShift(
          editorStore.getSnapshot()!.project,
          {
            shotId: IDS.shot,
            dialogueIds: [DIALOGUE_1_ID],
            eventIds: resolved.eventIds,
            layerMotionSpans: resolved.layerMotionSpans,
            deltaMs: 42,
          },
        );
        editorStore.updateProject(next, 'Batch shift timeline items');
      },
    );

    const movedProject = editorStore.getSnapshot()!.project;
    // 500ms (re-created) and 750ms (unlinked) stay put; 1000ms -> 1042ms.
    expect(layerKeyTimes(movedProject, LAYER_1_ID)).toEqual([0, 500, 750, 1_042]);
    expect(
      movedProject.shots[0]!.timelineEvents.find((e) => e.id === EVENT_1_ID)
        ?.startMs,
    ).toBe(542);
    // Dialogue 2's healthy key and event remain untouched and alive.
    expect(layerKeyTimes(movedProject, LAYER_2_ID)).toEqual([0, 1_500]);
    const resolvedD2 = linkStore.resolve(
      movedProject.id,
      movedProject.shots[0]!,
      [DIALOGUE_2_ID],
    );
    expect(resolvedD2.missingCount).toBe(0);
    expect(resolvedD2.eventIds).toEqual([EVENT_2_ID]);
    expect(resolvedD2.layerMotionSpans[0]!.keyTimesMs).toEqual([1_500]);

    linkStore.dispose();
  });

  it('protects same-time unrelated property additions (blocked, recovers on undo) and invalidates value/property replacements even if edited back', () => {
    const editorStore = new EditorProjectStore();
    const linkStore = new DialoguePerformanceLinkStore(editorStore);
    const motion = new LayerMotionService();

    const initial = buildFixtureProject();
    editorStore.open('D:/wf-fix3-d-protect.pandastage', initial);
    linkStore.capture(initial.id, [row()], initial);

    // Adding an unrelated property (scaleX) at 500ms blocks locally instead of invalidating.
    const withExtraProp = motion.applyTransform(
      editorStore.getSnapshot()!.project,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 500, autoKey: true },
      { scaleX: 1.4 },
    );
    editorStore.updateProject(withExtraProp, '新增无关属性键');

    const blocked = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_1_ID],
    );
    expect(blocked.blockedCount).toBe(1);
    expect(blocked.missingCount).toBe(0);
    expect(blocked.layerMotionSpans[0]!.keyTimesMs).toEqual([1_000]);

    // Undoing the unrelated property addition cleanly unblocks 500ms.
    expect(editorStore.undo()).toBe(true);
    const unblocked = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_1_ID],
    );
    expect(unblocked.blockedCount).toBe(0);
    expect(unblocked.missingCount).toBe(0);
    expect(unblocked.layerMotionSpans[0]!.keyTimesMs).toEqual([500, 1_000]);

    // Replacing 500ms with a different value, then editing it back to 450,
    // keeps the old link permanently invalidated.
    const changedVal = motion.applyTransform(
      editorStore.getSnapshot()!.project,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 500, autoKey: true },
      { x: 900 },
    );
    editorStore.updateProject(changedVal, '改写数值');
    const restoredVal = motion.applyTransform(
      editorStore.getSnapshot()!.project,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 500, autoKey: true },
      { x: 450 },
    );
    editorStore.updateProject(restoredVal, '改回原值');

    const afterReplace = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_1_ID],
    );
    expect(afterReplace.missingCount).toBe(1);
    expect(afterReplace.layerMotionSpans[0]!.keyTimesMs).toEqual([1_000]);

    linkStore.dispose();
  });

  it('supports repeated per-key tracked moves and keeps unrelated dialogue links alive on undo', () => {
    const editorStore = new EditorProjectStore();
    const linkStore = new DialoguePerformanceLinkStore(editorStore);
    const motion = new LayerMotionService();
    const batch = new TimelineEventBatchService();

    let initial = buildFixtureProject();
    // Add 42ms and 83ms keys on layer 1 for non-uniform 24fps per-key remap testing.
    initial = motion.applyTransform(
      initial,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 42, autoKey: true },
      { x: 142 },
    );
    initial = motion.applyTransform(
      initial,
      { shotId: IDS.shot, layerId: LAYER_1_ID, timeMs: 83, autoKey: true },
      { x: 183 },
    );

    editorStore.open('D:/wf-fix3-d-repeat.pandastage', initial);
    linkStore.capture(
      initial.id,
      [
        row({ motionKeyTimes: [42, 83], eventIds: [EVENT_1_ID] }),
        row({
          directiveId: 'perf-2',
          dialogueOrdinal: 2,
          draftRowId: 'draft-row-2',
          dialogueId: DIALOGUE_2_ID,
          layerId: LAYER_2_ID,
          eventIds: [EVENT_2_ID],
          motionKeyTimes: [1_500],
        }),
      ],
      initial,
    );

    const runShift = (deltaMs: number): void => {
      const current = editorStore.getSnapshot()!.project;
      const resolved = linkStore.resolve(current.id, current.shots[0]!, [
        DIALOGUE_1_ID,
      ]);
      const plan = batch.planCrossTypeShift(current, {
        shotId: IDS.shot,
        dialogueIds: [DIALOGUE_1_ID],
        eventIds: resolved.eventIds,
        layerMotionSpans: resolved.layerMotionSpans,
        deltaMs,
      });
      const moves = (plan.actionPlan?.motionSpanEntries ?? [])
        .filter((entry) => (entry.keyMoves?.length ?? 0) > 0)
        .map((entry) => ({
          layerId: entry.layerId,
          keyMoves: entry.keyMoves!,
        }));
      linkStore.applyTrackedMove(
        current.id,
        IDS.shot,
        [DIALOGUE_1_ID],
        moves,
        () => {
          const next = batch.applyCrossTypeShift(current, {
            shotId: IDS.shot,
            dialogueIds: [DIALOGUE_1_ID],
            eventIds: resolved.eventIds,
            layerMotionSpans: resolved.layerMotionSpans,
            deltaMs,
          });
          editorStore.updateProject(next, 'Batch shift timeline items');
        },
      );
    };

    // Move 1: 42 -> 83, 83 -> 125.
    runShift(42);
    expect(
      linkStore.resolve(
        editorStore.getSnapshot()!.project.id,
        editorStore.getSnapshot()!.project.shots[0]!,
        [DIALOGUE_1_ID],
      ),
    ).toMatchObject({
      missingCount: 0,
      layerMotionSpans: [{ keyTimesMs: [83, 125] }],
    });

    // Move 2: 83 -> 125, 125 -> 167.
    runShift(42);
    expect(
      linkStore.resolve(
        editorStore.getSnapshot()!.project.id,
        editorStore.getSnapshot()!.project.shots[0]!,
        [DIALOGUE_1_ID],
      ),
    ).toMatchObject({
      missingCount: 0,
      layerMotionSpans: [{ keyTimesMs: [125, 167] }],
    });

    // Undo Move 2: moved keys on Dialogue 1 become local misses (never guessed),
    // while Dialogue 2's unrelated healthy key & event stay completely intact!
    expect(editorStore.undo()).toBe(true);
    const d1AfterUndo = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_1_ID],
    );
    expect(d1AfterUndo.layerMotionSpans).toEqual([]);
    expect(d1AfterUndo.missingCount).toBe(2);
    expect(d1AfterUndo.eventIds).toEqual([EVENT_1_ID]);

    const d2AfterUndo = linkStore.resolve(
      editorStore.getSnapshot()!.project.id,
      editorStore.getSnapshot()!.project.shots[0]!,
      [DIALOGUE_2_ID],
    );
    expect(d2AfterUndo.missingCount).toBe(0);
    expect(d2AfterUndo.eventIds).toEqual([EVENT_2_ID]);
    expect(d2AfterUndo.layerMotionSpans[0]!.keyTimesMs).toEqual([1_500]);

    // Reopening the same project clears session links cleanly.
    editorStore.open('D:/wf-fix3-d-repeat.pandastage', initial);
    const afterReopen = linkStore.resolve(
      initial.id,
      initial.shots[0]!,
      [DIALOGUE_2_ID],
    );
    expect(afterReopen.eventIds).toEqual([]);
    expect(afterReopen.layerMotionSpans).toEqual([]);
    expect(afterReopen.missingCount).toBe(0);

    linkStore.dispose();
  });
});
