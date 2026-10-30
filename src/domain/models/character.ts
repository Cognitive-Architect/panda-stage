import { z } from 'zod';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
} from '../constants';
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

const CharacterIdentityShape = {
  id: IdSchema,
  name: NameSchema,
  defaultVoiceProfileId: IdSchema,
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

/** Body translation and uniform scale in Character-local coordinates. */
export const BodyPlacementSchema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.min(CHARACTER_PART_MIN_SCALE).max(
      CHARACTER_PART_MAX_SCALE,
    ),
  })
  .strict();

export type BodyPlacement = z.infer<typeof BodyPlacementSchema>;

export const DEFAULT_BODY_PLACEMENT: Readonly<BodyPlacement> = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
});

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
    bodyPlacement: BodyPlacementSchema.default({ ...DEFAULT_BODY_PLACEMENT }),
    facePlacement: FacePlacementSchema,
    head: CharacterHeadSchema.optional(),
    talkingHeadMotionIntensityPercent:
      TalkingHeadMotionIntensityPercentSchema,
  })
  .strict();

const NonEmptySourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value) &&
      !value
        .replaceAll('\\', '/')
        .split('/')
        .some((segment) => segment === '..'),
    { message: 'Part source identifiers must not contain absolute paths.' },
  );

export const CharacterPartSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('source-instance'),
      sourceId: NonEmptySourceIdSchema,
      sourcePoseFrame: z.number().int().nonnegative(),
      effectiveFrame: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('manual'),
      sourceId: NonEmptySourceIdSchema,
    })
    .strict(),
]);

export const CharacterPartTransformSchema = z
  .object({
    a: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    b: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    c: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    d: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    tx: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    ty: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
  })
  .strict()
  .superRefine((transform, context) => {
    const determinant = transform.a * transform.d - transform.b * transform.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      context.addIssue({
        code: 'custom',
        path: ['a'],
        message: 'Part transform must be invertible.',
      });
    }
  });

const PartCropSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const CharacterPartImageMappingSchema = z
  .object({
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
    crop: PartCropSchema,
    /** Asset pixels per source pixel. Crop offsets remain in source pixels. */
    exportScale: FiniteNumberSchema.min(0.0001).max(1000),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (mapping.crop.x + mapping.crop.width > mapping.sourceWidth) {
      context.addIssue({
        code: 'custom',
        path: ['crop', 'width'],
        message: 'Part crop extends beyond the source image width.',
      });
    }
    if (mapping.crop.y + mapping.crop.height > mapping.sourceHeight) {
      context.addIssue({
        code: 'custom',
        path: ['crop', 'height'],
        message: 'Part crop extends beyond the source image height.',
      });
    }
  });

export const CharacterPartSchema = z
  .object({
    partId: IdSchema,
    assetId: IdSchema,
    source: CharacterPartSourceSchema,
    /** Full 2D affine transform from source-image coordinates to Character-local coordinates. */
    restTransform: CharacterPartTransformSchema,
    imageMapping: CharacterPartImageMappingSchema,
    /** Unique integer order, lower values behind higher values. */
    drawOrder: z.number().int().nonnegative().max(1_000_000),
    visible: z.boolean(),
    displayName: NameSchema.optional(),
  })
  .strict();

export const AdaptivePartsCharacterSchema = z
  .object({
    ...CharacterIdentityShape,
    mode: z.literal('adaptive-parts'),
    /** Source container transform; C2 applies it separately from Part-local transforms. */
    sourceRootTransform: CharacterPartTransformSchema.default({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0,
    }),
    parts: z.array(CharacterPartSchema).min(1),
  })
  .strict()
  .superRefine((character, context) => {
    const partIds = new Set<string>();
    const drawOrders = new Set<number>();
    const sourceIds = new Set<string>();

    character.parts.forEach((part, index) => {
      if (partIds.has(part.partId)) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'partId'],
          message: `Duplicate Part identity: ${part.partId}`,
        });
      }
      partIds.add(part.partId);

      if (drawOrders.has(part.drawOrder)) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'drawOrder'],
          message: `Duplicate Part draw order: ${part.drawOrder}`,
        });
      }
      if (part.drawOrder !== index) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'drawOrder'],
          message:
            'Parts must be stored in contiguous bottom-to-top draw order.',
        });
      }
      drawOrders.add(part.drawOrder);

      if (sourceIds.has(part.source.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['parts', index, 'source', 'sourceId'],
          message: `Source instance is already used by another Part: ${part.source.sourceId}`,
        });
      }
      sourceIds.add(part.source.sourceId);
    });
  });

const CompositeCharacterV11Schema = z
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

/** Historical v11 Character data, before independent Body placement. */
export const CharacterV11Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterV11Schema,
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
  AdaptivePartsCharacterSchema,
]);

/** Strict persisted Character shape accepted by Project schema v14. */
export const CharacterV14Schema = z.discriminatedUnion('mode', [
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
export type CharacterPartSource = z.infer<typeof CharacterPartSourceSchema>;
export type CharacterPartTransform = z.infer<
  typeof CharacterPartTransformSchema
>;
export type CharacterPartImageMapping = z.infer<
  typeof CharacterPartImageMappingSchema
>;
export type CharacterPart = z.infer<typeof CharacterPartSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type ExpressionCharacter = Extract<
  Character,
  { mode: 'single-image' | 'composite' }
>;
export type AdaptivePartsCharacter = Extract<
  Character,
  { mode: 'adaptive-parts' }
>;
export type CharacterV8 = z.infer<typeof CharacterV8Schema>;
export type CharacterV9 = z.infer<typeof CharacterV9Schema>;
export type CharacterV10 = z.infer<typeof CharacterV10Schema>;
export type CharacterV11 = z.infer<typeof CharacterV11Schema>;
export type CharacterV6 = z.infer<typeof CharacterV6Schema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
