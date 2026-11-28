import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
  layerCompositeKeyTimes,
  type MoveEvent,
  type PlannedPerformanceRow,
  type Project,
} from '../../src/domain';
import { DialoguePerformanceLinkStore } from '../../src/renderer/stores/dialoguePerformanceLinkStore';
import { buildProject, IDS } from './domain/testProject';

const LAYER_ID = '60000000-0000-4000-8000-000000000299';
const EVENT_ID = '87000000-0000-4000-8000-000000000299';
const DIALOGUE_ID = '82000000-0000-4000-8000-000000000299';

function buildLinkedProject(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const layer = {
    ...shot.layers[0]!,
    id: LAYER_ID,
    name: '联动层',
    source: { kind: 'asset' as const, assetId: IDS.assetBg },
    cameraSpace: 'screen' as const,
  };
  const event: MoveEvent = {
    id: EVENT_ID,
    type: 'move',
    layerId: LAYER_ID,
    startMs: 500,
    endMs: 1_000,
    from: { x: 0, y: 0 },
    to: { x: 50, y: 0 },
    easing: 'linear',
  };
  let project = ProjectSchema.parse({
    ...base,
    shots: [
      {
        ...shot,
        layers: [...shot.layers, layer],
        timelineEvents: [event],
      },
    ],
  });
  const motion = new LayerMotionService();
  for (const timeMs of [500, 1_000]) {
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs, autoKey: true },
      { x: 400 + timeMs / 10 },
    );
  }
  return project;
}

function row(overrides: Partial<PlannedPerformanceRow> = {}): PlannedPerformanceRow {
  return {
    directiveId: 'perf-1',
    blockIndex: 1,
    sourceLineNumber: 1,
    raw: '1｜配方｜联动',
    dialogueOrdinal: 1,
    draftRowId: 'draft-row-1',
    dialogueId: DIALOGUE_ID,
    shotId: IDS.shot,
    shotName: '镜头',
    layerId: LAYER_ID,
    characterId: IDS.character,
    speakerName: '熊猫',
    action: 'action-recipe',
    actionLabel: '配方：联动',
    property: 'action-recipe',
    startMs: 500,
    endMs: 1_000,
    requiredShotDurationMs: null,
    status: 'ready',
    eventIds: [EVENT_ID],
    motionKeyTimes: [500],
    issueCode: null,
    issueMessage: null,
    ...overrides,
  };
}

function shiftKeys(project: Project, deltaMs: number): Project {
  const layer = project.shots[0]!.layers.find((item) => item.id === LAYER_ID)!;
  const fromTimes = layerCompositeKeyTimes(layer).filter((timeMs) => timeMs > 0);
  return new LayerMotionService().retimeKeys(project, {
    shotId: IDS.shot,
    layerId: LAYER_ID,
    fromTimesMs: fromTimes,
    deltaFrames: Math.round((deltaMs * 24) / 1_000),
  });
}

function stripLayerKeys(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...project.shots[0]!,
        layers: project.shots[0]!.layers.map((layer) =>
          layer.id === LAYER_ID
            ? { ...layer, layerMotionTracks: undefined, animationClip: undefined }
            : layer,
        ),
      },
    ],
  });
}

describe('WF-EXT D dialogue -> performance session links', () => {
  it('resolves generated event and root-motion key references for selected dialogues', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);

    const resolved = store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]);
    expect(resolved.eventIds).toEqual([EVENT_ID]);
    expect(resolved.layerMotionSpans).toHaveLength(1);
    expect(resolved.layerMotionSpans[0]).toMatchObject({
      layerId: LAYER_ID,
      keyTimesMs: [500],
    });
    expect(resolved.missingCount).toBe(0);
  });

  it('drops references that were edited/deleted instead of guessing nearby content', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);

    const changed = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...project.shots[0]!,
          timelineEvents: [],
          layers: project.shots[0]!.layers.map((layer) =>
            layer.id === LAYER_ID
              ? { ...layer, layerMotionTracks: undefined }
              : layer,
          ),
        },
      ],
    });
    const resolved = store.resolve(changed.id, changed.shots[0]!, [DIALOGUE_ID]);
    expect(resolved.eventIds).toEqual([]);
    expect(resolved.layerMotionSpans).toEqual([]);
    expect(resolved.missingCount).toBe(2);
  });

  it('does not link a different shot or an unrelated dialogue', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);

    const otherShot = { ...project.shots[0]!, id: 'other-shot' };
    expect(
      store.resolve(project.id, otherShot, [DIALOGUE_ID]),
    ).toMatchObject({
      eventIds: [],
      layerMotionSpans: [],
    });
    expect(
      store.resolve(project.id, project.shots[0]!, ['other-dialogue']),
    ).toMatchObject({
      eventIds: [],
      layerMotionSpans: [],
    });
  });

  it('keeps other shots when a second scene is generated and ignores scenery-only runs', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);

    // Second scene in another shot: first shot's links must survive.
    store.capture(project.id, [
      row({
        dialogueId: 'dialogue-second-scene',
        shotId: 'shot-2',
        eventIds: ['event-second-scene'],
      }),
    ]);
    expect(
      store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]).eventIds,
    ).toEqual([EVENT_ID]);

    // Pure scenery generation produces no performance rows.
    store.capture(project.id, []);
    expect(
      store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]).eventIds,
    ).toEqual([EVENT_ID]);
  });

  it('replaces the previous links of the same shot on regeneration', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);
    store.capture(project.id, [
      row({ dialogueId: 'regenerated-dialogue', eventIds: ['regenerated-event'] }),
    ]);

    expect(
      store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]).missingCount,
    ).toBe(0);
    expect(
      store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]).eventIds,
    ).toEqual([]);
  });

  it('does not treat a brand-new key on another property at the same time as linked', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);

    // Drop the authored keys, then author a *different* property at 500ms.
    const regenerated = new LayerMotionService().applyTransform(
      stripLayerKeys(project),
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs: 500, autoKey: true },
      { scaleX: 1.5 },
    );
    // Guard: the timestamp exists again, but only for another property.
    expect(
      layerCompositeKeyTimes(
        regenerated.shots[0]!.layers.find((layer) => layer.id === LAYER_ID)!,
      ),
    ).toContain(500);

    const resolved = store.resolve(regenerated.id, regenerated.shots[0]!, [
      DIALOGUE_ID,
    ]);
    expect(resolved.layerMotionSpans).toEqual([]);
    expect(resolved.missingCount).toBe(1);
  });

  it('clears session links when the project switches', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()]);

    const resolved = store.resolve(
      '10000000-0000-4000-8000-0000000000ff',
      project.shots[0]!,
      [DIALOGUE_ID],
    );
    expect(resolved.eventIds).toEqual([]);
    expect(resolved.layerMotionSpans).toEqual([]);
  });

  it('follows the exact per-key moves so repeated linked moves still resolve', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);

    // Move one frame: 500ms (frame 12) -> 542ms.
    const movedProject = shiftKeys(project, 42);
    store.remapAfterMove(project.id, IDS.shot, [DIALOGUE_ID], [
      { layerId: LAYER_ID, keyMoves: [{ fromTimeMs: 500, toTimeMs: 542 }] },
    ]);
    const first = store.resolve(movedProject.id, movedProject.shots[0]!, [
      DIALOGUE_ID,
    ]);
    expect(first.layerMotionSpans[0]!.keyTimesMs).toEqual([542]);
    expect(first.missingCount).toBe(0);

    // Second linked move follows the same key again.
    const movedTwice = shiftKeys(movedProject, 42);
    store.remapAfterMove(project.id, IDS.shot, [DIALOGUE_ID], [
      { layerId: LAYER_ID, keyMoves: [{ fromTimeMs: 542, toTimeMs: 583 }] },
    ]);
    const second = store.resolve(movedTwice.id, movedTwice.shots[0]!, [
      DIALOGUE_ID,
    ]);
    expect(second.layerMotionSpans[0]!.keyTimesMs).toEqual([583]);
    expect(second.missingCount).toBe(0);
  });

  it('treats an undo (keys back at the old time) as a local miss, never a guess', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);
    store.remapAfterMove(project.id, IDS.shot, [DIALOGUE_ID], [
      { layerId: LAYER_ID, keyMoves: [{ fromTimeMs: 500, toTimeMs: 542 }] },
    ]);

    const undone = store.resolve(project.id, project.shots[0]!, [DIALOGUE_ID]);
    expect(undone.layerMotionSpans).toEqual([]);
    expect(undone.missingCount).toBe(1);
  });

  it('invalidates a same-time same-property key that was re-created with other values', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);

    // Delete the authored key, then re-create one at 500ms on the same property
    // with a different value: it is a different product, not ours.
    const replaced = new LayerMotionService().applyTransform(
      stripLayerKeys(project),
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs: 500, autoKey: true },
      { x: 900 },
    );

    const resolved = store.resolve(replaced.id, replaced.shots[0]!, [DIALOGUE_ID]);
    expect(resolved.layerMotionSpans).toEqual([]);
    expect(resolved.missingCount).toBe(1);
  });

  it('skips a linked key locally when an unrelated property was authored at the same time', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture(project.id, [row()], project);

    // Keep the original key and add a scale key on the same timestamp.
    const mixed = new LayerMotionService().applyTransform(
      project,
      { shotId: IDS.shot, layerId: LAYER_ID, timeMs: 500, autoKey: true },
      { scaleX: 1.4 },
    );

    const resolved = store.resolve(mixed.id, mixed.shots[0]!, [DIALOGUE_ID]);
    expect(resolved.layerMotionSpans).toEqual([]);
    expect(resolved.blockedCount).toBe(1);
    expect(resolved.missingCount).toBe(0);
  });
});
