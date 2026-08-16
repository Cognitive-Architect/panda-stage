import type { Dialogue } from '../../domain';
import type { SubtitleCue } from './subtitle-engine';

export const DIALOGUE_SUBTITLE_MAX_TEXT_LENGTH = 500;

/**
 * Single Dialogue → SubtitleCue projection for editor Canvas and Product
 * Preview. It deliberately accepts legacy overlap and leaves winner selection
 * to evaluateSubtitleAtTime().
 */
export function buildDialogueSubtitleCues(
  dialogues: readonly Dialogue[],
): SubtitleCue[] {
  return dialogues
    .filter((dialogue) => dialogue.endMs > dialogue.startMs)
    .map((dialogue) => ({
      id: dialogue.id,
      startMs: dialogue.startMs,
      endMs: dialogue.endMs,
      text: dialogue.text
        .trim()
        .slice(0, DIALOGUE_SUBTITLE_MAX_TEXT_LENGTH),
      styleId: dialogue.subtitleStyleId,
    }))
    .filter((cue) => cue.text.length > 0)
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}
