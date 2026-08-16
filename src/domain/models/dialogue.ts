import { z } from 'zod';
import {
  IdSchema,
  MillisecondsSchema,
  NonEmptyTextSchema,
} from './common';

interface DialogueShape {
  id: typeof IdSchema;
  characterId: typeof IdSchema;
  voiceProfileId: typeof IdSchema;
  audioClipId: typeof IdSchema;
  subtitleStyleId: typeof IdSchema;
  startMs: typeof MillisecondsSchema;
  endMs: typeof MillisecondsSchema;
  text: typeof NonEmptyTextSchema;
}

const dialogueShape: DialogueShape = {
  id: IdSchema,
  characterId: IdSchema,
  voiceProfileId: IdSchema,
  audioClipId: IdSchema,
  subtitleStyleId: IdSchema,
  startMs: MillisecondsSchema,
  endMs: MillisecondsSchema,
  text: NonEmptyTextSchema,
};

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
 * Current (v6+) Dialogue schema. `audioClipId` is **optional**: a text dialogue
 * may exist before any audio asset is produced, so the schema must not force a
 * real audio clip to exist. Legacy v5 dialogues that already carry an
 * `audioClipId` remain valid because an optional field accepts a present value.
 */
export const DialogueSchema = z
  .object({
    ...dialogueShape,
    audioClipId: IdSchema.optional(),
  })
  .strict()
  .superRefine(refineDialogueDuration);

export type Dialogue = z.infer<typeof DialogueSchema>;

/**
 * Historical v5 Dialogue schema. At v5 `audioClipId` was mandatory because the
 * only dialogue path was audio-backed. Kept as the exact v5 shape so
 * `ProjectV5Schema` can recognise a project the v5 product wrote and migrate it
 * forward without silently relaxing the original contract.
 */
export const DialogueV5Schema = z
  .object({ ...dialogueShape })
  .strict()
  .superRefine(refineDialogueDuration);

export type DialogueV5 = z.infer<typeof DialogueV5Schema>;
