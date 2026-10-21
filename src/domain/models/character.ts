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
    rotationDeg: FiniteNumberSchema.min(-180).max(180).default(0),
    flipX: z.boolean().default(false),
  })
  .strict();

/** Historical Face placement before C03 added per-part transforms. */
export const FacePlacementV10Schema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.positive(),
  })
  .strict();

/** Head translation, scale, and static transform relative to its Character. */
export const HeadPlacementSchema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.positive(),
    rotationDeg: FiniteNumberSchema.min(-180).max(180).default(0),
    flipX: z.boolean().default(false),
  })
  .strict();

/** Historical Head placement before C03 added per-part transforms. */
export const HeadPlacementV10Schema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.positive(),
  })
  .strict();

/** Head pivot point expressed in the owning Character's local coordinates. */
export const HeadPivotSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  })
  .strict();

export const CharacterHeadSchema = z
  .object({
    assetId: IdSchema,
    placement: HeadPlacementSchema,
    pivot: HeadPivotSchema,
  })
  .strict();

const CharacterHeadV10Schema = z
  .object({
    assetId: IdSchema,
    placement: HeadPlacementV10Schema,
    pivot: HeadPivotSchema,
  })
  .strict();

export const TalkingHeadMotionIntensityPercentSchema = z
  .number()
  .int()
  .min(0)
  .max(200)
  .default(100);

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
    head: CharacterHeadSchema.optional(),
    talkingHeadMotionIntensityPercent:
      TalkingHeadMotionIntensityPercentSchema,
  })
  .strict();

const CompositeCharacterV9Schema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('composite'),
    bodyAssetId: IdSchema,
    facePlacement: FacePlacementV10Schema,
    head: CharacterHeadV10Schema.optional(),
  })
  .strict();

const CompositeCharacterV8Schema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('composite'),
    bodyAssetId: IdSchema,
    facePlacement: FacePlacementV10Schema,
  })
  .strict();

const CompositeCharacterV10Schema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('composite'),
    bodyAssetId: IdSchema,
    facePlacement: FacePlacementV10Schema,
    head: CharacterHeadV10Schema.optional(),
    talkingHeadMotionIntensityPercent:
      TalkingHeadMotionIntensityPercentSchema,
  })
  .strict();

/** Historical v8 Character data: composite Body + Face, with no Head field. */
export const CharacterV8Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterV8Schema,
]);

/** Historical v9 Character data, before persisted talking-head intensity. */
export const CharacterV9Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterV9Schema,
]);

/** Historical v10 Character data, before static Head/Face transforms. */
export const CharacterV10Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterV10Schema,
]);

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
export type HeadPlacement = z.infer<typeof HeadPlacementSchema>;
export type HeadPivot = z.infer<typeof HeadPivotSchema>;
export type CharacterHead = z.infer<typeof CharacterHeadSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterV8 = z.infer<typeof CharacterV8Schema>;
export type CharacterV9 = z.infer<typeof CharacterV9Schema>;
export type CharacterV10 = z.infer<typeof CharacterV10Schema>;
export type CharacterV6 = z.infer<typeof CharacterV6Schema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
