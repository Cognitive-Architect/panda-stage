import { describe, expect, it } from 'vitest';
import {
  evaluateCharacterDialogueAtTime,
  evaluateDialogueAtTime,
} from '../../src/domain/evaluators/dialogueEvaluator';
import {
  evaluateMouthMotionAtTime,
  MOUTH_CYCLE_MS,
  MOUTH_OPEN_PHASE_MS,
} from '../../src/domain/evaluators/mouthMotionEvaluator';
import type { Dialogue } from '../../src/domain';

const CHARACTER_A = '20000000-0000-4000-8000-000000000001';
const CHARACTER_B = '20000000-0000-4000-8000-000000000002';

function dialogue(
  id: string,
  characterId: string,
  startMs: number,
  endMs: number,
): Dialogue {
  return {
    id,
    characterId,
    voiceProfileId: '30000000-0000-4000-8000-000000000001',
    subtitleStyleId: '40000000-0000-4000-8000-000000000001',
    startMs,
    endMs,
    text: id,
  };
}

describe('Day28 dialogue and mouth evaluators', () => {
  it('uses a stable latest-start priority for legacy overlaps', () => {
    const first = dialogue(
      '50000000-0000-4000-8000-000000000001',
      CHARACTER_A,
      0,
      1_000,
    );
    const later = dialogue(
      '50000000-0000-4000-8000-000000000002',
      CHARACTER_B,
      500,
      1_500,
    );
    const sameStartShorter = dialogue(
      '50000000-0000-4000-8000-000000000003',
      CHARACTER_A,
      500,
      900,
    );

    expect(evaluateDialogueAtTime([later, first], 600)?.id).toBe(later.id);
    expect(
      evaluateDialogueAtTime([sameStartShorter, later], 600)?.id,
    ).toBe(later.id);
    expect(evaluateDialogueAtTime([first], 1_000)).toBeNull();
    expect(
      evaluateCharacterDialogueAtTime([first, later], CHARACTER_A, 600)?.id,
    ).toBe(first.id);
  });

  it('drives mouth motion from the same integer timeline and resets at the end', () => {
    const speaking = dialogue(
      '50000000-0000-4000-8000-000000000011',
      CHARACTER_A,
      1_000,
      2_000,
    );
    expect(
      evaluateMouthMotionAtTime([speaking], CHARACTER_A, 1_000),
    ).toMatchObject({ speaking: true, mouthOpen: true, dialogueId: speaking.id });
    expect(
      evaluateMouthMotionAtTime([speaking], CHARACTER_A, 1_000 + MOUTH_OPEN_PHASE_MS),
    ).toMatchObject({ speaking: true, mouthOpen: false });
    expect(
      evaluateMouthMotionAtTime([speaking], CHARACTER_A, 1_000 + MOUTH_CYCLE_MS),
    ).toMatchObject({ speaking: true, mouthOpen: true });
    expect(
      evaluateMouthMotionAtTime([speaking], CHARACTER_A, 2_000),
    ).toMatchObject({ speaking: false, mouthOpen: false, dialogueId: null });
    expect(
      evaluateMouthMotionAtTime([speaking], CHARACTER_B, 1_200),
    ).toMatchObject({ speaking: false, mouthOpen: false, dialogueId: null });
  });
});
