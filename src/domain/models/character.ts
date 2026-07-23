import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const CharacterExpressionSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    assetId: IdSchema,
  })
  .strict();

export const CharacterSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    baseAssetId: IdSchema,
    defaultVoiceProfileId: IdSchema,
    expressions: z.array(CharacterExpressionSchema).min(1),
  })
  .strict();

export const VoiceProfileSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    characterId: IdSchema,
    locale: z.string().trim().min(2).max(35),
    rate: z.number().finite().min(0.5).max(2).default(1),
    pitch: z.number().finite().min(-1).max(1).default(0),
  })
  .strict();

export type CharacterExpression = z.infer<typeof CharacterExpressionSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
