import { z } from 'zod';
import {
  IdSchema,
  MillisecondsSchema,
  NonEmptyTextSchema,
} from './common';

/**
 * A Dialogue speaker is either a real Character or the explicit, formless
 * Narration voice. Narration is a speaker *type*, never a hidden Character and
 * never a special sentinel Character id.
 *
 * The field is intentionally optional on the persisted model: every Dialogue
 * written before voice-01 has no `speakerType` and stays a Character dialogue,
 * so old projects keep loading and saving unchanged. Only narration needs the
 * explicit discriminator.
 */
export const DIALOGUE_SPEAKER_CHARACTER = 'character' as const;
export const DIALOGUE_SPEAKER_NARRATOR = 'narrator' as const;

export const DialogueSpeakerTypeSchema = z.enum([
  DIALOGUE_SPEAKER_CHARACTER,
  DIALOGUE_SPEAKER_NARRATOR,
]);

export type DialogueSpeakerType = z.infer<typeof DialogueSpeakerTypeSchema>;

interface DialogueBaseShape {
  id: typeof IdSchema;
  audioClipId: typeof IdSchema;
  subtitleStyleId: typeof IdSchema;
  startMs: typeof MillisecondsSchema;
  endMs: typeof MillisecondsSchema;
  text: typeof NonEmptyTextSchema;
}

const dialogueBaseShape: DialogueBaseShape = {
  id: IdSchema,
  audioClipId: IdSchema,
  subtitleStyleId: IdSchema,
  startMs: MillisecondsSchema,
  endMs: MillisecondsSchema,
  text: NonEmptyTextSchema,
};

interface DialogueCharacterShape {
  characterId: typeof IdSchema;
  voiceProfileId: typeof IdSchema;
}

function refineDialogueDuration(
  dialogue: { startMs: number; endMs: number },
  context: z.RefinementCtx,
): void {
  if (dialogue.endMs < dialogue.startMs) {
    context.addIssue({
      code: 'custom',
      message: 'Dialogue endMs must be greater than or equal to startMs.',
      path: ['endMs'],
    });
  }
}

/**
 * Speaker contract shared by the formal model and the reference validator:
 * narration must not carry a Character / VoiceProfile, and a Character dialogue
 * must keep both. Legacy dialogues (no `speakerType`) are Character dialogues,
 * so their original strict references are preserved rather than relaxed.
 */
export function isNarratorDialogue(dialogue: {
  speakerType?: DialogueSpeakerType;
}): boolean {
  return dialogue.speakerType === DIALOGUE_SPEAKER_NARRATOR;
}

function refineDialogueSpeaker(
  dialogue: {
    speakerType?: DialogueSpeakerType;
    characterId?: string;
    voiceProfileId?: string;
  },
  context: z.RefinementCtx,
): void {
  if (isNarratorDialogue(dialogue)) {
    if (dialogue.characterId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Narration dialogue must not reference a character.',
        path: ['characterId'],
      });
    }
    if (dialogue.voiceProfileId !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Narration dialogue must not reference a voice profile.',
        path: ['voiceProfileId'],
      });
    }
    return;
  }
  if (dialogue.characterId === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Character dialogue requires a characterId.',
      path: ['characterId'],
    });
  }
  if (dialogue.voiceProfileId === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Character dialogue requires a voiceProfileId.',
      path: ['voiceProfileId'],
    });
  }
}

/**
 * Current (v6+) Dialogue schema. `audioClipId` is **optional**: a text dialogue
 * may exist before any audio asset is produced, so the schema must not force a
 * real audio clip to exist. Legacy v5 dialogues that already carry an
 * `audioClipId` remain valid because an optional field accepts a present value.
 *
 * `speakerType` is the narration discriminator added by VOICE-01: absent means
 * the legacy Character dialogue contract (characterId + voiceProfileId are
 * required and still validated by `refineDialogueSpeaker`).
 */
export const DialogueSchema = z
  .object({
    ...dialogueBaseShape,
    speakerType: DialogueSpeakerTypeSchema.optional(),
    characterId: IdSchema.optional(),
    voiceProfileId: IdSchema.optional(),
    audioClipId: IdSchema.optional(),
  })
  .strict()
  .superRefine(refineDialogueSpeaker)
  .superRefine(refineDialogueDuration);

export type Dialogue = z.infer<typeof DialogueSchema>;
export type CharacterDialogue = Dialogue & {
  characterId: string;
  voiceProfileId: string;
};
export type NarratorDialogue = Dialogue & {
  speakerType: typeof DIALOGUE_SPEAKER_NARRATOR;
};

/**
 * Historical v5 Dialogue schema. At v5 `audioClipId` was mandatory because the
 * only dialogue path was audio-backed, and every speaker was a Character. Kept
 * as the exact v5 shape so `ProjectV5Schema` can recognise a project the v5
 * product wrote and migrate it forward without silently relaxing the original
 * contract.
 */
export const DialogueV5Schema = z
  .object({
    ...dialogueBaseShape,
    ...({
      characterId: IdSchema,
      voiceProfileId: IdSchema,
    } satisfies DialogueCharacterShape),
  })
  .strict()
  .superRefine(refineDialogueDuration);

export type DialogueV5 = z.infer<typeof DialogueV5Schema>;
