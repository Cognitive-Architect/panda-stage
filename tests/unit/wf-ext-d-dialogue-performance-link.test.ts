import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  ProjectSchema,
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

describe('WF-EXT D dialogue -> performance session links', () => {
  it('resolves generated event and root-motion key references for selected dialogues', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture([row()]);

    const resolved = store.resolve(project.shots[0]!, [DIALOGUE_ID]);
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
    store.capture([row()]);

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
    const resolved = store.resolve(changed.shots[0]!, [DIALOGUE_ID]);
    expect(resolved.eventIds).toEqual([]);
    expect(resolved.layerMotionSpans).toEqual([]);
    expect(resolved.missingCount).toBe(2);
  });

  it('does not link a different shot or an unrelated dialogue', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture([row()]);

    const otherShot = { ...project.shots[0]!, id: 'other-shot' };
    expect(store.resolve(otherShot, [DIALOGUE_ID])).toMatchObject({
      eventIds: [],
      layerMotionSpans: [],
    });
    expect(store.resolve(project.shots[0]!, ['other-dialogue'])).toMatchObject({
      eventIds: [],
      layerMotionSpans: [],
    });
  });

  it('capturing a new script replaces prior session links', () => {
    const project = buildLinkedProject();
    const store = new DialoguePerformanceLinkStore();
    store.capture([row()]);
    store.capture([]);
    expect(store.resolve(project.shots[0]!, [DIALOGUE_ID])).toMatchObject({
      eventIds: [],
      layerMotionSpans: [],
    });
  });
});
