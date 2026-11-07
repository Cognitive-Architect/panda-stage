import { describe, expect, it } from 'vitest';
import {
  MultiScenePerformanceService,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { PERFORMANCE_INPUT_PLACEHOLDER } from '../../src/renderer/features/shots/multiScenePerformanceExample';
import {
  buildPerformanceProject,
  sequentialEventIds,
} from '../helpers/multiSceneDialogueFixture';

/**
 * AUTO-06-FIX-01 A: the placeholder shown to the author must be a legal batch.
 * It is the only example most users will copy, so a self-conflicting sample
 * blocks the whole feature; the fix belongs in the copy, never in the gate.
 */
describe('AUTO-06 placeholder example', () => {
  function plan(project: Project = buildPerformanceProject()) {
    return new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }).plan(project, parseMultiSceneInput(PERFORMANCE_INPUT_PLACEHOLDER), []);
  }

  it('parses into the documented two-Shot shape', () => {
    const blocks = parseMultiSceneInput(PERFORMANCE_INPUT_PLACEHOLDER);
    expect(blocks.map((block) => block.shotName)).toEqual([
      '花园相遇',
      '宗门大厅',
    ]);
    expect(blocks.flatMap((block) => block.dialogues)).toHaveLength(4);
    expect(
      blocks.flatMap((block) => block.performances).map((directive) =>
        directive.dialogueOrdinal,
      ),
    ).toEqual([1, 1, 2, 2, 3, 4]);
  });

  it('plans every sample action instead of failing on a real conflict', () => {
    const outcome = plan();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.plan.performance.eventCount).toBe(6);
    expect(outcome.plan.performance.rows).toHaveLength(6);
  });

  it('never puts two actions of one logical property on the same line', () => {
    const outcome = plan();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const byOrdinal = new Map<number, string[]>();
    for (const row of outcome.plan.performance.rows) {
      byOrdinal.set(row.dialogueOrdinal, [
        ...(byOrdinal.get(row.dialogueOrdinal) ?? []),
        row.property,
      ]);
    }
    for (const [, properties] of byOrdinal) {
      expect(new Set(properties).size).toBe(properties.length);
    }
    // The example keeps its diversity: line 2 still enters from the right and
    // then scales, line 4 still moves.
    expect(byOrdinal.get(2)?.sort()).toEqual(['position', 'scale']);
    expect(byOrdinal.get(4)).toEqual(['position']);
  });

  it('keeps the gate closed for the previous sample that stacked two positions', () => {
    // The pre-fix copy had `2｜右入场` and `2｜移动` on the same line: both are
    // `position`, so the sample itself was refused. The copy changed, not the
    // gate.
    const previous = PERFORMANCE_INPUT_PLACEHOLDER.replace(
      '2｜放大｜1.20',
      '2｜移动｜x=1260｜y=760',
    );
    const outcome = new MultiScenePerformanceService({
      createEventId: sequentialEventIds(),
    }).plan(buildPerformanceProject(), parseMultiSceneInput(previous), []);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('PERFORMANCE_CONFLICT');
  });
});
