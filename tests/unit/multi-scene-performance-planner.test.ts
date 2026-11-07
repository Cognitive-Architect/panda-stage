import { describe, expect, it } from 'vitest';
import {
  ACTION_PRESET_BY_ID,
  MultiSceneDialogueService,
  MultiScenePerformanceService,
  ProjectSchema,
  TimelineEventSchema,
  evaluateShotAtTime,
  getActionPreset,
  parseMultiSceneInput,
  propertyOfType,
  type MultiScenePerformancePlan,
  type Project,
} from '../../src/domain';
import {
  AUTO06_IDS,
  PERFORMANCE_THREE_BLOCKS,
  PERFORMANCE_TWO_BLOCKS,
  THREE_BLOCKS,
  TWO_BLOCKS,
  buildDialogueProject,
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

function planner(project: Project = buildPerformanceProject()) {
  return {
    project,
    service: new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }),
  };
}

function plan(raw: string) {
  const { project, service } = planner();
  return {
    project,
    outcome: service.plan(project, parseMultiSceneInput(raw), []),
  };
}

function success(raw: string): MultiScenePerformancePlan {
  const { outcome } = plan(raw);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.plan;
}

describe('AUTO-06 planner — stock ActionPreset reuse', () => {
  it('omitting directives leaves the AUTO-05 candidate untouched', () => {
    const { project } = planner();
    const blocks = parseMultiSceneInput(THREE_BLOCKS);
    const dialogue = new MultiSceneDialogueService().plan(project, blocks, []);
    expect(dialogue.ok).toBe(true);
    if (!dialogue.ok) return;
    // Reuse the exact same AUTO-05 plan so random Shot/Layer ids do not differ.
    const cached = {
      plan: () => dialogue,
    } as unknown as MultiSceneDialogueService;
    const performance = new MultiScenePerformanceService({
      dialogueService: cached,
      createEventId: sequentialEventIds(),
    }).plan(project, blocks, []);
    expect(performance.ok).toBe(true);
    if (!performance.ok) return;
    expect(performance.plan.performance.rows).toHaveLength(0);
    expect(performance.plan.performance.eventCount).toBe(0);
    expect(performance.plan.candidateProject.shots).toEqual(
      dialogue.plan.candidateProject.shots,
    );
  });

  it('anchors all 8 stock presets to real Dialogue.startMs', () => {
    const planResult = success(PERFORMANCE_THREE_BLOCKS);
    const rows = planResult.performance.rows;
    expect(rows).toHaveLength(8);
    expect(planResult.performance.eventCount).toBe(8);
    expect(rows.map((row) => row.presetId)).toEqual([
      'expression-switch',
      'shake',
      'enter-right',
      'scale-emphasis',
      'fade-in',
      'move-to',
      'fade-out',
      'enter-left',
    ]);

    for (const row of rows) {
      const dialogue = planResult.dialogue.rows.find(
        (entry) => entry.ordinal === row.dialogueOrdinal,
      );
      expect(dialogue).toBeDefined();
      expect(row.startMs).toBe(dialogue!.startMs);
      expect(row.endMs - row.startMs).toBe(
        getActionPreset(row.presetId).defaultDurationMs,
      );
      expect(row.eventIds).toHaveLength(1);
    }

    // Different logical properties on one ordinal are allowed (position +
    // expression on #1, position + scale on #2).
    const first = rows.filter((row) => row.dialogueOrdinal === 1);
    expect(first.map((row) => row.property).sort()).toEqual([
      'expression',
      'position',
    ]);
  });

  it('writes ordinary TimelineEvents into the candidate Shot only', () => {
    const planResult = success(PERFORMANCE_TWO_BLOCKS);
    const project = ProjectSchema.parse(planResult.candidateProject);
    for (const row of planResult.performance.rows) {
      const shot = project.shots.find((entry) => entry.id === row.shotId);
      expect(shot).toBeDefined();
      const event = shot!.timelineEvents.find(
        (entry) => entry.id === row.eventIds[0],
      );
      expect(event).toBeDefined();
      expect(() => TimelineEventSchema.parse(event)).not.toThrow();
      expect(event!.layerId).toBe(row.layerId);
      expect(event!.startMs).toBe(row.startMs);
      expect(event!.endMs).toBe(row.endMs);
      expect(propertyOfType(event!.type)).toBe(row.property);
      expect(shot!.backgroundLayerId).not.toBe(row.layerId);
      // The existing evaluator consumes them without a second player.
      expect(
        evaluateShotAtTime(shot!, row.startMs, project).layers,
      ).toHaveLength(shot!.layers.length);
    }
    const touched = project.shots.filter((shot) =>
      planResult.createdShotIds.includes(shot.id),
    );
    expect(touched.flatMap((shot) => shot.timelineEvents)).toHaveLength(
      planResult.performance.eventCount,
    );
  });

  it('uses only that Character own exact-name expression', () => {
    const planResult = success(PERFORMANCE_TWO_BLOCKS);
    const row = planResult.performance.rows.find(
      (entry) => entry.action === 'expression',
    );
    expect(row?.dialogueOrdinal).toBe(1);
    const shot = planResult.candidateProject.shots.find(
      (entry) => entry.id === row!.shotId,
    );
    const event = shot!.timelineEvents.find(
      (entry) => entry.id === row!.eventIds[0],
    );
    expect(event).toMatchObject({
      type: 'expression',
      expressionId: AUTO06_IDS.exprZhangAngry,
    });
  });

  it('refuses the whole batch when no expression of that name exists', () => {
    const project = buildDialogueProject();
    const outcome = new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }).plan(project, parseMultiSceneInput(PERFORMANCE_TWO_BLOCKS), []);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('PERFORMANCE_EXPRESSION_UNRESOLVED');
    expect(outcome.message).toContain('生气');
    expect(project.shots.every((shot) => shot.timelineEvents.length === 0)).toBe(
      true,
    );
  });

  it('passes explicit move / scale parameters into the preset events', () => {
    const planResult = success(PERFORMANCE_TWO_BLOCKS);
    const move = planResult.performance.rows.find(
      (row) => row.action === 'move',
    )!;
    const shot = planResult.candidateProject.shots.find(
      (entry) => entry.id === move.shotId,
    )!;
    const event = shot.timelineEvents.find(
      (entry) => entry.id === move.eventIds[0],
    )!;
    expect(event.type).toBe('move');
    expect(event.type === 'move' && event.to).toEqual({ x: 1260, y: 760 });

    const scale = planResult.performance.rows.find(
      (row) => row.action === 'scale',
    )!;
    const scaleShot = planResult.candidateProject.shots.find(
      (entry) => entry.id === scale.shotId,
    )!;
    const scaleEvent = scaleShot.timelineEvents.find(
      (entry) => entry.id === scale.eventIds[0],
    )!;
    expect(scaleEvent.type).toBe('scale');
    expect(scaleEvent.type === 'scale' && scaleEvent.to.x / scaleEvent.from.x).toBeCloseTo(1.2);
  });

  it('keeps the AUTO-05 Dialogue / AudioClip / Shot duration contract intact', () => {
    const planResult = success(PERFORMANCE_THREE_BLOCKS);
    expect(planResult.dialogue.rows.map((row) => row.startMs)).toEqual([
      0, 1420, 0, 2000, 0, 1100,
    ]);
    expect(
      planResult.dialogue.timings.map((timing) => timing.nextDurationMs),
    ).toEqual([3290, 3600, 3000]);
    expect(planResult.createdShotIds).toHaveLength(3);
    expect(ACTION_PRESET_BY_ID['fade-in'].defaultDurationMs).toBe(800);
  });

  it('does not create a directive when the input has no performance section', () => {
    const planResult = success(TWO_BLOCKS);
    expect(planResult.performance.rows).toHaveLength(0);
    expect(planResult.candidateProject.shots.every((shot) =>
      planResult.createdShotIds.includes(shot.id)
        ? shot.timelineEvents.length === 0
        : true,
    )).toBe(true);
  });
});
