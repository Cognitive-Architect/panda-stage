import { z } from 'zod';
import {
  IdSchema,
  MillisecondsSchema,
  NonEmptyTextSchema,
} from './common';

export const DialogueSchema = z
  .object({
    id: IdSchema,
    characterId: IdSchema,
    voiceProfileId: IdSchema,
    audioClipId: IdSchema,
    subtitleStyleId: IdSchema,
    startMs: MillisecondsSchema,
    endMs: MillisecondsSchema,
    text: NonEmptyTextSchema,
  })
  .strict()
  .superRefine((dialogue, context) => {
    if (dialogue.endMs < dialogue.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Dialogue endMs must be greater than or equal to startMs.',
        path: ['endMs'],
      });
    }
  });

export type Dialogue = z.infer<typeof DialogueSchema>;
