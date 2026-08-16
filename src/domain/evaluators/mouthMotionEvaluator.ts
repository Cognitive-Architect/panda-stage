import {
  evaluateCharacterDialogueAtTime,
} from './dialogueEvaluator';
import type { Dialogue } from '../models';

/** Four deterministic open/closed phases per second. */
export const MOUTH_CYCLE_MS = 250 as const;
export const MOUTH_OPEN_PHASE_MS = 125 as const;

export interface MouthMotionEvaluation {
  characterId: string;
  dialogueId: string | null;
  speaking: boolean;
  mouthOpen: boolean;
}

/**
 * Evaluates mouth motion from the same integer millisecond playhead used by
 * subtitles and audio. No wall clock, randomness, timers, or renderer state
 * participates in the result.
 */
export function evaluateMouthMotionAtTime(
  dialogues: readonly Dialogue[],
  characterId: string,
  timeMs: number,
): MouthMotionEvaluation {
  const dialogue = evaluateCharacterDialogueAtTime(
    dialogues,
    characterId,
    timeMs,
  );
  if (!dialogue) {
    return {
      characterId,
      dialogueId: null,
      speaking: false,
      mouthOpen: false,
    };
  }

  const elapsedMs = Math.max(0, Math.round(timeMs) - dialogue.startMs);
  const phaseMs = elapsedMs % MOUTH_CYCLE_MS;
  return {
    characterId,
    dialogueId: dialogue.id,
    speaking: true,
    mouthOpen: phaseMs < MOUTH_OPEN_PHASE_MS,
  };
}
