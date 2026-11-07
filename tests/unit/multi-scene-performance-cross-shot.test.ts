import { describe, expect, it } from 'vitest';
import {
  MultiScenePerformanceService,
  parseMultiSceneInput,
  type MultiScenePerformancePlan,
} from '../../src/domain';
import { performanceDirectivesByOrdinal } from '../../src/renderer/features/shots/multiSceneDialoguePanelModel';
import {
  PERFORMANCE_CROSS_SHOT_BLOCKS,
  TWO_BLOCKS,
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

/**
 * AUTO-06-FIX-01 B: a later Shot's `表演：` may direct an earlier Shot's line.
 * The planner always honoured that; the preview filtered per block and silently
 * hid it, so the author saw "no action" while generation wrote one.
 */
describe('AUTO-06 cross-Shot directives', () => {
  function plan(): MultiScenePerformancePlan {
    const outcome = new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }).plan(
      buildPerformanceProject(),
      parseMultiSceneInput(PERFORMANCE_CROSS_SHOT_BLOCKS),
      [],
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.plan;
  }

  it('keeps a later Shot allowed to direct an earlier Shot ordinal', () => {
    const blocks = parseMultiSceneInput(PERFORMANCE_CROSS_SHOT_BLOCKS);
    expect(blocks[0]!.performances).toHaveLength(0);
    expect(
      blocks[1]!.performances.map((directive) => directive.dialogueOrdinal),
    ).toEqual([1, 3]);
  });

  it('attributes every directive to the dialogue it really targets', () => {
    const blocks = parseMultiSceneInput(PERFORMANCE_CROSS_SHOT_BLOCKS);
    const byOrdinal = performanceDirectivesByOrdinal(blocks);
    expect(byOrdinal.get(1)?.map((directive) => directive.action)).toEqual([
      'shake',
    ]);
    expect(byOrdinal.get(3)?.map((directive) => directive.action)).toEqual([
      'fade-in',
    ]);
    // Ordinal 2 has no directive, and the writing block is not the owner.
    expect(byOrdinal.has(2)).toBe(false);
    expect([...byOrdinal.keys()].sort()).toEqual([1, 3]);
  });

  it('writes the event into the earlier Shot, unchanged by the preview fix', () => {
    const planResult = plan();
    const row = planResult.performance.rows.find(
      (entry) => entry.dialogueOrdinal === 1,
    );
    expect(row?.action).toBe('shake');
    const firstDialogue = planResult.dialogue.rows.find(
      (entry) => entry.ordinal === 1,
    );
    expect(row?.shotId).toBe(firstDialogue!.shotId);
    const shot = planResult.candidateProject.shots.find(
      (entry) => entry.id === row!.shotId,
    );
    const event = shot?.timelineEvents.find(
      (entry) => entry.id === row!.eventIds[0],
    );
    expect(event).toMatchObject({ type: 'shake', startMs: 0 });

    const ownShotRow = planResult.performance.rows.find(
      (entry) => entry.dialogueOrdinal === 3,
    );
    const thirdDialogue = planResult.dialogue.rows.find(
      (entry) => entry.ordinal === 3,
    );
    expect(ownShotRow?.shotId).toBe(thirdDialogue!.shotId);
    expect(ownShotRow?.shotId).not.toBe(row?.shotId);
  });

  it('stays empty when the batch has no performance section', () => {
    const byOrdinal = performanceDirectivesByOrdinal(
      parseMultiSceneInput(TWO_BLOCKS),
    );
    expect(byOrdinal.size).toBe(0);
  });
});
