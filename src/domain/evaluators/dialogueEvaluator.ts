import type { Dialogue } from '../models';

/**
 * Day 28 overlap rule: the dialogue that started most recently owns the
 * subtitle layer. Equal starts are resolved by the stable id, so the result
 * never depends on the persisted array order.
 */
export function compareDialoguePriority(
  left: Pick<Dialogue, 'startMs' | 'endMs' | 'id'>,
  right: Pick<Dialogue, 'startMs' | 'endMs' | 'id'>,
): number {
  const idOrder = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return (
    right.startMs - left.startMs ||
    right.endMs - left.endMs ||
    idOrder
  );
}

export function isDialogueTimed(dialogue: Pick<Dialogue, 'startMs' | 'endMs'>): boolean {
  return dialogue.endMs > dialogue.startMs;
}

export function isDialogueActive(
  dialogue: Pick<Dialogue, 'startMs' | 'endMs'>,
  timeMs: number,
): boolean {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  return (
    isDialogueTimed(dialogue) &&
    safeTimeMs >= dialogue.startMs &&
    safeTimeMs < dialogue.endMs
  );
}

export function listActiveDialogues(
  dialogues: readonly Dialogue[],
  timeMs: number,
): Dialogue[] {
  return dialogues
    .filter((dialogue) => isDialogueActive(dialogue, timeMs))
    .sort(compareDialoguePriority);
}

/** Returns the single dialogue that owns the global subtitle layer. */
export function evaluateDialogueAtTime(
  dialogues: readonly Dialogue[],
  timeMs: number,
): Dialogue | null {
  return listActiveDialogues(dialogues, timeMs)[0] ?? null;
}

/**
 * Mouth state is scoped to one character. Other characters may speak at the
 * same time without changing this result.
 */
export function evaluateCharacterDialogueAtTime(
  dialogues: readonly Dialogue[],
  characterId: string,
  timeMs: number,
): Dialogue | null {
  return (
    listActiveDialogues(dialogues, timeMs).find(
      (dialogue) => dialogue.characterId === characterId,
    ) ?? null
  );
}
