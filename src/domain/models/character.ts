import { z } from 'zod';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';

export const CharacterExpressionSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    assetId: IdSchema,
  })
  .strict();

const CharacterBaseShape = {
  id: IdSchema,
  name: NameSchema,
  baseAssetId: IdSchema,
  defaultVoiceProfileId: IdSchema,
  expressions: z.array(CharacterExpressionSchema).min(1),
  defaultExpressionId: IdSchema,
  mouthOpenAssetId: IdSchema.optional(),
  defaultScale: FiniteNumberSchema.min(0.1).max(10),
  defaultFlipX: z.boolean(),
};

export const FacePlacementSchema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.positive(),
  })
  .strict();

const SingleImageCharacterSchema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('single-image'),
  })
  .strict();

const CompositeCharacterSchema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('composite'),
    bodyAssetId: IdSchema,
    facePlacement: FacePlacementSchema,
  })
  .strict();

/**
 * Current Character data is explicit about whether its face assets represent
 * a complete image or a reusable face placed over a shared body. Body/face
 * assembly is intentionally a later section; this schema only owns the
 * persisted configuration and its references.
 */
export const CharacterSchema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterSchema,
]);

/**
 * Historical v2-v6 Character shape. Keep this independent from the current
 * discriminated union so opening an old project does not require fields that
 * did not exist when that project was written.
 */
export const CharacterV6Schema = z
  .object(CharacterBaseShape)
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
export type FacePlacement = z.infer<typeof FacePlacementSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterV6 = z.infer<typeof CharacterV6Schema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
