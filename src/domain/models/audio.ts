import { z } from 'zod';
import {
  FiniteNumberSchema,
  IdSchema,
  MillisecondsSchema,
  NameSchema,
} from './common';

export const AudioClipV7Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    assetId: IdSchema,
    startMs: MillisecondsSchema,
    endMs: MillisecondsSchema,
    offsetMs: MillisecondsSchema.default(0),
    volume: FiniteNumberSchema.min(0).max(2).default(1),
  })
  .strict()
  .superRefine((clip, context) => {
    if (clip.endMs < clip.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Audio clip endMs must be greater than or equal to startMs.',
        path: ['endMs'],
      });
    }
  });

export const AudioClipRoleSchema = z.enum(['dialogue', 'bgm', 'sfx']);
export const AudioClipSchema = AudioClipV7Schema.safeExtend({
  role: AudioClipRoleSchema,
});

export type AudioClip = z.infer<typeof AudioClipSchema>;
