import type { Character, Dialogue } from '../../../domain';
import { isNarratorDialogue } from '../../../domain';

/** Single display name for a speaker, shared by Timeline, Sheet and Inspector. */
export const NARRATOR_SPEAKER_NAME = '旁白';

export function isNarratorSpeaker(
  dialogue: Pick<Dialogue, 'speakerType'>,
): boolean {
  return isNarratorDialogue(dialogue);
}

/**
 * Speaker label for one Dialogue. Narration is a speaker type, not a Character
 * lookup, so it must never fall back to a raw character id.
 */
export function dialogueSpeakerName(
  dialogue: Pick<Dialogue, 'speakerType' | 'characterId'>,
  characters: readonly Character[],
): string {
  if (isNarratorSpeaker(dialogue)) return NARRATOR_SPEAKER_NAME;
  const character = characters.find(
    (candidate) => candidate.id === dialogue.characterId,
  );
  return character?.name ?? dialogue.characterId ?? '未知角色';
}
