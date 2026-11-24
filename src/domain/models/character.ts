import { z } from 'zod';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
} from '../constants';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import { AnimationKeySchema, AnimationPropertySchema } from './animationKeys';
import {
  cloneFlaEditableShapeRegion,
  FlaEditableShapeRegionSchema,
} from '../fla-shape-vector';
import { FlaGraphicInstanceTransformOverridesV22Schema, type FlaGraphicInstanceTransformOverrides } from './flaGraphicInstanceOverrides';
import { FLA_GRAPHIC_STRUCTURE_MAX_DEPTH } from './flaGraphicStructure';

export const CharacterExpressionV19Schema = z
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
  expressions: z.array(CharacterExpressionV19Schema).min(1),
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

const FacePlacementV22Schema = z
  .object({
    offsetX: FiniteNumberSchema,
    offsetY: FiniteNumberSchema,
    scale: FiniteNumberSchema.positive(),
    rotationDeg: FiniteNumberSchema.min(-180).max(180).default(0),
    flipX: z.boolean().default(false),
  })
  .strict();

/** Body translation and uniform scale in Character-local coordinates. */
const BodyPlacementV22Schema = z
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
const HeadPlacementV22Schema = z
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
const HeadPivotV22Schema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  })
  .strict();

const CharacterHeadV22Schema = z
  .object({
    assetId: IdSchema,
    placement: HeadPlacementV22Schema,
    pivot: HeadPivotV22Schema,
  })
  .strict();

const CharacterHeadV10Schema = z
  .object({
    assetId: IdSchema,
    placement: HeadPlacementV10Schema,
    pivot: HeadPivotV22Schema,
  })
  .strict();

const TalkingHeadMotionIntensityPercentV22Schema = z
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
    bodyPlacement: BodyPlacementV22Schema.default({ ...DEFAULT_BODY_PLACEMENT }),
    facePlacement: FacePlacementV22Schema,
    head: CharacterHeadV22Schema.optional(),
    talkingHeadMotionIntensityPercent:
      TalkingHeadMotionIntensityPercentV22Schema,
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

const CharacterPartSourceV22Schema = z.discriminatedUnion('kind', [
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

export const CharacterPartTransformV22Schema = z
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

/** User-authored static change relative to an immutable source pose. */
const CharacterPartStaticAdjustmentV22Schema = z
  .object({
    offsetX: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    offsetY: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    scale: FiniteNumberSchema.min(CHARACTER_PART_MIN_SCALE).max(
      CHARACTER_PART_MAX_SCALE,
    ),
    rotationDeg: FiniteNumberSchema.min(-180).max(180),
  })
  .strict();

export type CharacterPartStaticAdjustment = z.infer<
  typeof CharacterPartStaticAdjustmentSchema
>;

export const DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT: Readonly<CharacterPartStaticAdjustment> =
  Object.freeze({ offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 });

const PartCropSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const CharacterPartImageMappingV22Schema = z
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

const CharacterPartImageVisualSourceV22Schema = z
  .object({
    kind: z.literal('image'),
    assetId: IdSchema,
    imageMapping: CharacterPartImageMappingV22Schema,
  })
  .strict();

const CharacterPartFlaGraphicVisualSourceV22Schema = z
  .object({
    kind: z.literal('fla-graphic'),
    animationId: IdSchema,
    instanceTransformOverrides:
      FlaGraphicInstanceTransformOverridesV22Schema.optional(),
  })
  .strict();

export const CharacterPartVisualSourceV22Schema = z.discriminatedUnion('kind', [
  CharacterPartImageVisualSourceV22Schema,
  CharacterPartFlaGraphicVisualSourceV22Schema,
]);

export const CharacterPartFlaGraphicNodePathSchema = z
  .array(z.string().trim().min(1).max(1024))
  .min(1)
  .max(FLA_GRAPHIC_STRUCTURE_MAX_DEPTH);

const CharacterPartFlaGraphicVisualSourceCurrentSchema = z
  .object({
    kind: z.literal('fla-graphic'),
    animationId: IdSchema,
    nodePath: CharacterPartFlaGraphicNodePathSchema.optional(),
    poseFrameOrdinal: z.number().int().nonnegative().optional(),
    regionRef: z.string().trim().min(1).max(128).optional(),
    regionVector: FlaEditableShapeRegionSchema.optional(),
    instanceTransformOverrides:
      FlaGraphicInstanceTransformOverridesV22Schema.optional(),
  })
  .strict();

export const CharacterPartVisualSourceCurrentSchema = z.discriminatedUnion('kind', [
  CharacterPartImageVisualSourceV22Schema,
  CharacterPartFlaGraphicVisualSourceCurrentSchema,
]);

const CharacterPartBaseShape = {
  partId: IdSchema,
  source: CharacterPartSourceV22Schema,
  /** Full 2D affine transform from source-local coordinates to Character-local coordinates. */
  restTransform: CharacterPartTransformV22Schema,
  /** Immutable source-pose transform. Optional only for legacy v15 records. */
  sourceRestTransform: CharacterPartTransformV22Schema.optional(),
  /** Static authoring controls relative to sourceRestTransform. */
  staticAdjustment: CharacterPartStaticAdjustmentV22Schema.optional(),
  /** Unique integer order, lower values behind higher values. */
  drawOrder: z.number().int().nonnegative().max(1_000_000),
  visible: z.boolean(),
  displayName: NameSchema.optional(),
};

/** Historical v15-v17 image-only Part shape. */
export const CharacterPartV17Schema = z
  .object({
    ...CharacterPartBaseShape,
    assetId: IdSchema,
    imageMapping: CharacterPartImageMappingV22Schema,
  })
  .strict();

function validateCharacterPartVisualSource(
  part: {
    assetId?: string;
    imageMapping?: z.infer<typeof CharacterPartImageMappingV22Schema>;
    visualSource?: z.infer<typeof CharacterPartVisualSourceCurrentSchema>;
  },
  context: z.RefinementCtx,
): void {
  if (part.visualSource?.kind === 'fla-graphic') {
    if (part.assetId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'FLA Graphic parts must not specify a bitmap assetId.',
      });
    }
    if (part.imageMapping !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['imageMapping'],
        message: 'FLA Graphic parts must not specify an imageMapping.',
      });
    }
    return;
  }

  if (part.visualSource?.kind === 'image') {
    if (part.assetId !== undefined && part.assetId !== part.visualSource.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'Part assetId must match visualSource.assetId.',
      });
    }
    if (
      part.imageMapping !== undefined &&
      JSON.stringify(part.imageMapping) !==
        JSON.stringify(part.visualSource.imageMapping)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['imageMapping'],
        message: 'Part imageMapping must match visualSource.imageMapping.',
      });
    }
    return;
  }

  if (part.assetId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['assetId'],
      message: 'Image parts require assetId or an explicit visualSource.',
    });
  }
  if (part.imageMapping === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['imageMapping'],
      message: 'Image parts require imageMapping or an explicit visualSource.',
    });
  }
}

const CharacterPartV22Schema = z
  .object({
    ...CharacterPartBaseShape,
    assetId: IdSchema.optional(),
    imageMapping: CharacterPartImageMappingV22Schema.optional(),
    visualSource: CharacterPartVisualSourceV22Schema.optional(),
  })
  .strict()
  .superRefine(validateCharacterPartVisualSource);

const CharacterPartCurrentSchema = z
  .object({
    ...CharacterPartBaseShape,
    assetId: IdSchema.optional(),
    imageMapping: CharacterPartImageMappingV22Schema.optional(),
    visualSource: CharacterPartVisualSourceCurrentSchema.optional(),
  })
  .strict()
  .superRefine(validateCharacterPartVisualSource);

const AdaptivePartsCharacterBaseShape = {
  ...CharacterIdentityShape,
  mode: z.literal('adaptive-parts'),
  /** Source container transform; C2 applies it separately from Part-local transforms. */
  sourceRootTransform: CharacterPartTransformV22Schema.default({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 0,
    ty: 0,
  }),
};

function validateAdaptivePartsUniqueness(
  character: {
    parts: readonly {
      partId: string;
      drawOrder: number;
      source: { sourceId: string };
    }[];
  },
  context: z.RefinementCtx,
): void {
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
}

const AdaptivePartsCharacterV22Schema = z
  .object({
    ...AdaptivePartsCharacterBaseShape,
    parts: z.array(CharacterPartV22Schema).min(1),
  })
  .strict()
  .superRefine(validateAdaptivePartsUniqueness);

/** Frozen v23 Adaptive Parts character before face/expression/head bindings. */
const AdaptivePartsCharacterV23Schema = z
  .object({
    ...AdaptivePartsCharacterBaseShape,
    parts: z.array(CharacterPartCurrentSchema).min(1),
  })
  .strict()
  .superRefine(validateAdaptivePartsUniqueness);

/** A Graphic face is always a frozen instance, never a raster-cache identity. */
const CharacterFaceGraphicSourceV22Schema = z.object({
  kind: z.literal('fla-graphic'),
  animationId: IdSchema,
  firstFrame: z.number().int().nonnegative(),
}).strict();

const CharacterExpressionV22Schema = CharacterExpressionV19Schema.extend({
  assetId: IdSchema.optional(),
  visualSource: CharacterFaceGraphicSourceV22Schema.optional(),
}).superRefine((expression, context) => {
  if (Boolean(expression.assetId) === Boolean(expression.visualSource)) {
    context.addIssue({ code: 'custom', path: ['visualSource'], message: 'Expression requires exactly one image or Graphic source.' });
  }
});

const AdaptivePartsFaceAnchorRectV24Schema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: FiniteNumberSchema.positive(),
    height: FiniteNumberSchema.positive(),
  })
  .strict();

const AdaptivePartsFaceBindingV24Schema = z
  .object({
    targetPartId: IdSchema,
    replacePartIds: z.array(IdSchema).max(64).default([]),
    anchorRect: AdaptivePartsFaceAnchorRectV24Schema,
    placement: FacePlacementV22Schema.default({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    }),
  })
  .strict();

const AdaptivePartsHeadMotionBindingV24Schema = z
  .object({
    partIds: z.array(IdSchema).min(1).max(256),
  })
  .strict();

function validateAdaptivePartsFaceAndHeadBindings(
  character: {
    parts: readonly { partId: string }[];
    faceBinding?: z.infer<typeof AdaptivePartsFaceBindingV24Schema>;
    expressions?: readonly { id: string }[];
    defaultExpressionId?: string;
    mouthOpenAssetId?: string;
    mouthOpenVisualSource?: z.infer<typeof CharacterFaceGraphicSourceV22Schema>;
    headMotionBinding?: z.infer<typeof AdaptivePartsHeadMotionBindingV24Schema>;
  },
  context: z.RefinementCtx,
): void {
  const partIds = new Set(character.parts.map((part) => part.partId));
  if (character.faceBinding) {
    if (!partIds.has(character.faceBinding.targetPartId)) {
      context.addIssue({
        code: 'custom',
        path: ['faceBinding', 'targetPartId'],
        message: `Face binding references unknown Part identity: ${character.faceBinding.targetPartId}`,
      });
    }
    const seenReplace = new Set<string>();
    character.faceBinding.replacePartIds.forEach((partId, index) => {
      if (partId === character.faceBinding!.targetPartId) {
        context.addIssue({
          code: 'custom',
          path: ['faceBinding', 'replacePartIds', index],
          message: 'Face replacePartIds must not duplicate targetPartId.',
        });
      }
      if (seenReplace.has(partId)) {
        context.addIssue({
          code: 'custom',
          path: ['faceBinding', 'replacePartIds', index],
          message: `Duplicate Part identity in faceBinding.replacePartIds: ${partId}`,
        });
      }
      seenReplace.add(partId);
      if (!partIds.has(partId)) {
        context.addIssue({
          code: 'custom',
          path: ['faceBinding', 'replacePartIds', index],
          message: `Face binding references unknown replaced Part identity: ${partId}`,
        });
      }
    });
  }
  if (character.defaultExpressionId !== undefined) {
    if (!character.expressions?.some((expr) => expr.id === character.defaultExpressionId)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultExpressionId'],
        message: `Unknown defaultExpressionId: ${character.defaultExpressionId}`,
      });
    }
  }
  if (character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({
      code: 'custom',
      path: ['mouthOpenVisualSource'],
      message: 'Mouth requires a single visual source.',
    });
  }
  if (character.headMotionBinding) {
    const seenHead = new Set<string>();
    character.headMotionBinding.partIds.forEach((partId, index) => {
      if (seenHead.has(partId)) {
        context.addIssue({
          code: 'custom',
          path: ['headMotionBinding', 'partIds', index],
          message: `Duplicate Part identity in headMotionBinding.partIds: ${partId}`,
        });
      }
      seenHead.add(partId);
      if (!partIds.has(partId)) {
        context.addIssue({
          code: 'custom',
          path: ['headMotionBinding', 'partIds', index],
          message: `Head motion binding references unknown Part identity: ${partId}`,
        });
      }
    });
  }
}

const AdaptivePartsCharacterV24Schema = z
  .object({
    ...AdaptivePartsCharacterBaseShape,
    parts: z.array(CharacterPartCurrentSchema).min(1),
    faceBinding: AdaptivePartsFaceBindingV24Schema.optional(),
    expressions: z.array(CharacterExpressionV22Schema).optional(),
    defaultExpressionId: IdSchema.optional(),
    mouthOpenAssetId: IdSchema.optional(),
    mouthOpenVisualSource: CharacterFaceGraphicSourceV22Schema.optional(),
    headMotionBinding: AdaptivePartsHeadMotionBindingV24Schema.optional(),
    talkingHeadMotionIntensityPercent:
      z.number().int().min(0).max(200).optional(),
  })
  .strict()
  .superRefine(validateAdaptivePartsUniqueness)
  .superRefine(validateAdaptivePartsFaceAndHeadBindings);

const CompositeCharacterV11Schema = z
  .object({
    ...CharacterBaseShape,
    mode: z.literal('composite'),
    bodyAssetId: IdSchema,
    facePlacement: FacePlacementV22Schema,
    head: CharacterHeadV22Schema.optional(),
    talkingHeadMotionIntensityPercent:
      TalkingHeadMotionIntensityPercentV22Schema,
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
      TalkingHeadMotionIntensityPercentV22Schema,
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

export const AdaptivePartsCharacterV17Schema = z
  .object({
    ...AdaptivePartsCharacterBaseShape,
    parts: z.array(CharacterPartV17Schema).min(1),
  })
  .strict()
  .superRefine(validateAdaptivePartsUniqueness);

/** Strict persisted Character shape accepted by Project schema v15-v17. */
export const CharacterV17Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterSchema,
  AdaptivePartsCharacterV17Schema,
]);

/**
 * Current Character data is explicit about whether its face assets represent
 * a complete image or a reusable face placed over a shared body. Body/face
 * assembly is intentionally a later section; this schema only owns the
 * persisted configuration and its references.
 */
export const CharacterV19Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema,
  CompositeCharacterSchema,
  AdaptivePartsCharacterV22Schema,
]);

const CharacterFaceV22Shape = {
  baseAssetId: IdSchema.optional(),
  expressions: z.array(CharacterExpressionV22Schema).min(1),
  mouthOpenVisualSource: CharacterFaceGraphicSourceV22Schema.optional(),
};

export const CharacterV22Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema.extend(CharacterFaceV22Shape),
  CompositeCharacterSchema.extend(CharacterFaceV22Shape),
  AdaptivePartsCharacterV22Schema,
]).superRefine((character, context) => {
  if (character.mode === 'adaptive-parts') return;
  if (character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({ code: 'custom', path: ['mouthOpenVisualSource'], message: 'Mouth requires a single visual source.' });
  }
});

/** Frozen v23 Character contract before AdaptiveParts face/expression/head bindings. */
export const CharacterV23Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema.extend(CharacterFaceV22Shape),
  CompositeCharacterSchema.extend(CharacterFaceV22Shape),
  AdaptivePartsCharacterV23Schema,
]).superRefine((character, context) => {
  if (character.mode === 'adaptive-parts') return;
  if (character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({ code: 'custom', path: ['mouthOpenVisualSource'], message: 'Mouth requires a single visual source.' });
  }
});

export const CharacterV24Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema.extend(CharacterFaceV22Shape),
  CompositeCharacterSchema.extend(CharacterFaceV22Shape),
  AdaptivePartsCharacterV24Schema,
]).superRefine((character, context) => {
  if (character.mode === 'adaptive-parts') return;
  if (character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({ code: 'custom', path: ['mouthOpenVisualSource'], message: 'Mouth requires a single visual source.' });
  }
});

export const TalkingAnimationPlaybackSchema = z.object({
  firstFrame: z.number().int().nonnegative(),
  lastFrame: z.number().int().nonnegative(),
  mode: z.enum(['loop', 'play once', 'single frame', 'loop reverse', 'play once reverse']),
  restFrame: z.number().int().nonnegative().optional(),
}).strict().refine(value => value.firstFrame <= value.lastFrame, {
  path: ['lastFrame'],
  message: 'End frame must not precede the start frame.',
});
export type TalkingAnimationPlayback = z.infer<typeof TalkingAnimationPlaybackSchema>;

const TalkingAnimationV25Shape = { talkingAnimationId: IdSchema.optional() };
const TalkingAnimationShape = {
  ...TalkingAnimationV25Shape,
  talkingAnimationPlayback: TalkingAnimationPlaybackSchema.optional(),
};
export const CharacterV25Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterSchema.extend({ ...CharacterFaceV22Shape, ...TalkingAnimationV25Shape }),
  CompositeCharacterSchema.extend({ ...CharacterFaceV22Shape, ...TalkingAnimationV25Shape }),
  AdaptivePartsCharacterV24Schema.safeExtend(TalkingAnimationV25Shape),
]).superRefine((character, context) => {
  if (character.mode !== 'adaptive-parts' && character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({ code: 'custom', path: ['mouthOpenVisualSource'], message: 'Mouth requires a single visual source.' });
  }
});

function validateMouthSource(character: { mode: string; mouthOpenAssetId?: string; mouthOpenVisualSource?: unknown },
  context: z.RefinementCtx) {
  if (character.mode === 'adaptive-parts') return;
  if (character.mouthOpenAssetId && character.mouthOpenVisualSource) {
    context.addIssue({ code: 'custom', path: ['mouthOpenVisualSource'], message: 'Mouth requires a single visual source.' });
  }
}

const SingleImageCharacterV26Schema = SingleImageCharacterSchema.extend({ ...CharacterFaceV22Shape, ...TalkingAnimationShape });
const CompositeCharacterV26Schema = CompositeCharacterSchema.extend({ ...CharacterFaceV22Shape, ...TalkingAnimationShape });
const AdaptivePartsCharacterV26Schema = AdaptivePartsCharacterV24Schema.safeExtend(TalkingAnimationShape);
export const CharacterV26Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema, CompositeCharacterV26Schema, AdaptivePartsCharacterV26Schema,
]).superRefine(validateMouthSource);

export const MouthPoseCategorySchema = z.enum(['rest', 'open', 'wide', 'round', 'closed']);
export const MouthPoseSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), assetId: IdSchema }).strict(),
  CharacterFaceGraphicSourceV22Schema.extend({ internalTimeMs: z.number().finite().nonnegative().optional() }),
]);
export const MouthPoseSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  source: MouthPoseSourceSchema,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('face') }).strict(),
    z.object({ kind: z.literal('mouth'), partId: IdSchema }).strict(),
  ]),
}).strict();
export const MouthPoseSetSchema = z.object({
  poses: z.array(MouthPoseSchema).min(1).max(64),
  restPoseId: IdSchema,
  analyzerMapping: z.record(MouthPoseCategorySchema, IdSchema),
  driveMode: z.enum(['asset-loop', 'mouth-poses']),
}).strict().superRefine((set, context) => {
  const ids = new Set(set.poses.map((pose) => pose.id));
  const check = (valid: boolean, path: (string | number)[], message: string) => {
    if (!valid) context.addIssue({ code: 'custom', path, message });
  };
  check(ids.size === set.poses.length, ['poses'], 'Mouth pose ids must be unique.');
  check(ids.has(set.restPoseId), ['restPoseId'], 'Unknown rest mouth pose.');
  for (const category of MouthPoseCategorySchema.options) {
    check(ids.has(set.analyzerMapping[category]), ['analyzerMapping', category], 'Unknown mapped mouth pose.');
  }
  check(set.analyzerMapping.rest === set.restPoseId, ['restPoseId'], 'Rest mapping must match the rest mouth pose.');
});
export type MouthPoseCategory = z.infer<typeof MouthPoseCategorySchema>;
export type MouthPoseSource = z.infer<typeof MouthPoseSourceSchema>;
export type MouthPose = z.infer<typeof MouthPoseSchema>;
export type MouthPoseSet = z.infer<typeof MouthPoseSetSchema>;

const MouthPoseShape = { mouthPoseSet: MouthPoseSetSchema.optional() };
export const CharacterV27Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema.safeExtend(MouthPoseShape),
  CompositeCharacterV26Schema.safeExtend(MouthPoseShape),
  AdaptivePartsCharacterV26Schema.safeExtend(MouthPoseShape),
]).superRefine(validateMouthSource);

export const CharacterActionPlacementSchema = z.object({
  offsetX: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
  offsetY: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
  scale: FiniteNumberSchema.min(CHARACTER_PART_MIN_SCALE).max(CHARACTER_PART_MAX_SCALE),
}).strict();

export const BakedCharacterActionSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  animationId: IdSchema,
  placement: CharacterActionPlacementSchema,
}).strict();

const ArmPointSchema = z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict();

const LayeredCharacterActionV37Schema = z.object({
  id: IdSchema,
  name: NameSchema,
  kind: z.literal('layered'),
  tracks: z.array(z.object({
    partId: IdSchema,
    property: AnimationPropertySchema,
    keys: z.array(AnimationKeySchema).min(2),
  }).strict()).min(1),
  headAnchorPartId: IdSchema.optional(),
}).strict().superRefine(({ tracks, headAnchorPartId }, context) => {
  const addresses = new Set<string>();
  tracks.forEach(({ partId, property, keys }, index) => {
    const address = `${partId}:${property}`;
    const scale = property === 'transform.scaleX' || property === 'transform.scaleY';
    if (addresses.has(address) || keys[0]?.timeMs !== 0 || keys.some((key, keyIndex) =>
      (keyIndex > 0 && key.timeMs <= keys[keyIndex - 1]!.timeMs) ||
      (scale && (key.value < CHARACTER_PART_MIN_SCALE || key.value > CHARACTER_PART_MAX_SCALE)))) {
      context.addIssue({ code: 'custom', path: ['tracks', index], message: 'Invalid or duplicate layered action track.' });
    }
    addresses.add(address);
  });
  if (headAnchorPartId && !tracks.some(({ partId }) => partId === headAnchorPartId)) {
    context.addIssue({ code: 'custom', path: ['headAnchorPartId'], message: 'The head anchor must have an action track.' });
  }
});

export const LayeredCharacterActionSchema = LayeredCharacterActionV37Schema.safeExtend({
  partPivotOffsets: z.array(z.object({ partId: IdSchema, offset: ArmPointSchema }).strict()).optional(),
}).superRefine(({ tracks, partPivotOffsets }, context) => {
  const seen = new Set<string>();
  partPivotOffsets?.forEach(({ partId }, index) => {
    if (seen.has(partId) || !tracks.some(track => track.partId === partId &&
      (track.property === 'transform.rotationDeg' || track.property === 'transform.scaleX' || track.property === 'transform.scaleY'))) {
      context.addIssue({ code: 'custom', path: ['partPivotOffsets', index], message: 'Pivot calibration requires a mapped rotation or scale.' });
    }
    seen.add(partId);
  });
});

const CharacterActionV37Schema = z.union([BakedCharacterActionSchema, LayeredCharacterActionV37Schema]);
export const CharacterActionSchema = z.union([BakedCharacterActionSchema, LayeredCharacterActionSchema]);

export const CharacterBodyPoseSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  parts: z.array(z.object({
    partId: IdSchema,
    partName: NameSchema.optional(),
    properties: z.partialRecord(AnimationPropertySchema, FiniteNumberSchema),
    /** Center-local pivot used to encode a pose captured from a layered action. */
    referencePivot: ArmPointSchema.optional(),
  }).strict()).min(1),
}).strict().superRefine(({ parts }, context) => {
  const ids = new Set<string>();
  parts.forEach(({ partId, properties }, index) => {
    const scales = [properties['transform.scaleX'], properties['transform.scaleY']];
    if (ids.has(partId) || !Object.keys(properties).length || scales.some((scale) =>
      scale !== undefined && (scale < CHARACTER_PART_MIN_SCALE || scale > CHARACTER_PART_MAX_SCALE))) {
      context.addIssue({ code: 'custom', path: ['parts', index], message: 'Invalid or duplicate body pose target.' });
    }
    ids.add(partId);
  });
});

export const CharacterArmChainSchema = z.object({
  segments: z.array(z.object({
    partId: IdSchema,
    joint: ArmPointSchema,
    minDeg: FiniteNumberSchema.min(-360).max(360),
    maxDeg: FiniteNumberSchema.min(-360).max(360),
  }).strict()).min(2).max(3),
  tip: ArmPointSchema,
}).strict().refine(({ segments }) => new Set(segments.map(({ partId }) => partId)).size === segments.length &&
  segments.every(({ minDeg, maxDeg }) => minDeg <= maxDeg), 'Invalid rigid arm joints or limits.');

export const CharacterMotionMappingRuleSchema = z.object({
  sourcePartId: IdSchema,
  targetPartId: IdSchema.optional(),
  mirror: z.boolean(),
  translationScale: FiniteNumberSchema.min(0.01).max(100),
  pivotOffset: ArmPointSchema,
  properties: z.array(AnimationPropertySchema).max(AnimationPropertySchema.options.length),
}).strict().refine(({ properties }) => new Set(properties).size === properties.length, 'Duplicate mapped properties.');

export const CharacterMotionMappingSchema = z.object({
  sourceCharacterId: IdSchema,
  sourceActionId: IdSchema,
  generatedActionId: IdSchema,
  rules: z.array(CharacterMotionMappingRuleSchema).min(1),
}).strict().refine(({ rules }) => {
  const targets = rules.flatMap(({ targetPartId }) => targetPartId ? [targetPartId] : []);
  return new Set(rules.map(({ sourcePartId }) => sourcePartId)).size === rules.length && new Set(targets).size === targets.length;
}, 'Each mapped source and selected target part must be unique.');

const CharacterActionsShape = {
  actions: z.array(BakedCharacterActionSchema).max(64).optional(),
};

const CharacterV28Fields = { ...MouthPoseShape, ...CharacterActionsShape };
const SingleImageCharacterV28Schema = SingleImageCharacterV26Schema.safeExtend(CharacterV28Fields);
const CompositeCharacterV28Schema = CompositeCharacterV26Schema.safeExtend(CharacterV28Fields);
const AdaptivePartsCharacterV28Schema = AdaptivePartsCharacterV26Schema.safeExtend(CharacterV28Fields);

function validateNamedActions(character: { actions?: CharacterAction[] }, context: z.RefinementCtx): void {
  const actions = character.actions ?? [];
  const actionIds = new Set<string>();
  const actionNames = new Set<string>();
  actions.forEach((action, index) => {
    const normalizedName = action.name.trim().toLocaleLowerCase();
    if (actionIds.has(action.id)) {
      context.addIssue({ code: 'custom', path: ['actions', index, 'id'], message: 'Character action ids must be unique.' });
    }
    if (actionNames.has(normalizedName)) {
      context.addIssue({ code: 'custom', path: ['actions', index, 'name'], message: 'Character action names must be unique.' });
    }
    actionIds.add(action.id);
    actionNames.add(normalizedName);
  });
}

export const CharacterV28Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV28Schema, CompositeCharacterV28Schema, AdaptivePartsCharacterV28Schema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions);

const ExpressionTalkingSourceSchema = z.object({
  animationId: IdSchema,
  playback: TalkingAnimationPlaybackSchema,
}).strict();
export type ExpressionTalkingSource = z.infer<typeof ExpressionTalkingSourceSchema>;

const ExpressionTalkingShape = {
  expressionTalkingSources: z.record(IdSchema, ExpressionTalkingSourceSchema).optional(),
};
const SingleImageCharacterWithTalkingSchema = SingleImageCharacterV28Schema.safeExtend(ExpressionTalkingShape);
const CompositeCharacterWithTalkingSchema = CompositeCharacterV28Schema.safeExtend(ExpressionTalkingShape);
const AdaptivePartsCharacterV34Schema = AdaptivePartsCharacterV28Schema.safeExtend(ExpressionTalkingShape);
const CurrentCharacterActionsShape = {
  actions: z.array(CharacterActionV37Schema).max(64).optional(),
};
const CurrentCharacterFields = { ...MouthPoseShape, ...ExpressionTalkingShape, ...CurrentCharacterActionsShape };
const AdaptivePartsCharacterV35Schema = AdaptivePartsCharacterV26Schema.safeExtend(CurrentCharacterFields);
const AdaptivePartsCharacterV36Schema = AdaptivePartsCharacterV35Schema.safeExtend({
  bodyPoses: z.array(CharacterBodyPoseSchema).max(64).refine((poses) =>
    new Set(poses.map(({ id }) => id)).size === poses.length &&
    new Set(poses.map(({ name }) => name.toLocaleLowerCase())).size === poses.length,
  'Body pose names and ids must be unique.').optional(),
});
const AdaptivePartsCharacterV37Schema = AdaptivePartsCharacterV36Schema.safeExtend({
  armChain: CharacterArmChainSchema.optional(),
});
const AdaptivePartsCharacterCurrentSchema = AdaptivePartsCharacterV37Schema.safeExtend({
  actions: z.array(CharacterActionSchema).max(64).optional(),
  motionMappings: z.array(CharacterMotionMappingSchema).max(64).refine((entries) =>
    new Set(entries.map(({ sourceCharacterId, sourceActionId }) => `${sourceCharacterId}:${sourceActionId}`)).size === entries.length,
  'Each source action may have one reusable mapping.').optional(),
});

function validateExpressionTalkingSources(character: {
  expressionTalkingSources?: Record<string, ExpressionTalkingSource>;
  expressions?: readonly { id: string }[];
}, context: z.RefinementCtx): void {
  for (const expressionId of Object.keys(character.expressionTalkingSources ?? {})) {
    if (!(character.expressions ?? []).some((entry) => entry.id === expressionId)) {
      context.addIssue({ code: 'custom', path: ['expressionTalkingSources', expressionId], message: 'Unknown expression.' });
    }
  }
}

export const CharacterV34Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterWithTalkingSchema, CompositeCharacterWithTalkingSchema, AdaptivePartsCharacterV34Schema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions).superRefine(validateExpressionTalkingSources);

const CharacterCurrentSchema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema.safeExtend(CurrentCharacterFields),
  CompositeCharacterV26Schema.safeExtend(CurrentCharacterFields),
  AdaptivePartsCharacterCurrentSchema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions).superRefine(validateExpressionTalkingSources);

export const CharacterV35Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema.safeExtend(CurrentCharacterFields),
  CompositeCharacterV26Schema.safeExtend(CurrentCharacterFields),
  AdaptivePartsCharacterV35Schema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions).superRefine(validateExpressionTalkingSources);

export const CharacterV36Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema.safeExtend(CurrentCharacterFields),
  CompositeCharacterV26Schema.safeExtend(CurrentCharacterFields),
  AdaptivePartsCharacterV36Schema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions).superRefine(validateExpressionTalkingSources);

export const CharacterV37Schema = z.discriminatedUnion('mode', [
  SingleImageCharacterV26Schema.safeExtend(CurrentCharacterFields),
  CompositeCharacterV26Schema.safeExtend(CurrentCharacterFields),
  AdaptivePartsCharacterV37Schema,
]).superRefine(validateMouthSource).superRefine(validateNamedActions).superRefine(validateExpressionTalkingSources);

export type CharacterFaceGraphicSource = z.infer<typeof CharacterFaceGraphicSourceSchema>;
export type CharacterFaceSource = { kind: 'image'; assetId: string } | CharacterFaceGraphicSource;
export type CharacterActionPlacement = z.infer<typeof CharacterActionPlacementSchema>;
export type CharacterAction = z.infer<typeof CharacterActionSchema>;
export type BakedCharacterAction = z.infer<typeof BakedCharacterActionSchema>;
export type LayeredCharacterAction = z.infer<typeof LayeredCharacterActionSchema>;
export type CharacterBodyPose = z.infer<typeof CharacterBodyPoseSchema>;
export type CharacterArmChain = z.infer<typeof CharacterArmChainSchema>;
export type CharacterMotionMappingRule = z.infer<typeof CharacterMotionMappingRuleSchema>;
export type CharacterMotionMapping = z.infer<typeof CharacterMotionMappingSchema>;

export function resolveExpressionVisualSource(expression: CharacterExpression): CharacterFaceSource {
  if (expression.visualSource) return expression.visualSource;
  if (expression.assetId) return { kind: 'image', assetId: expression.assetId };
  throw new Error(`Expression ${expression.id} has no visual source.`);
}

export function resolveMouthVisualSource(
  character: Pick<ExpressionCharacter, 'mouthOpenVisualSource' | 'mouthOpenAssetId'>,
): CharacterFaceSource | null {
  return character.mouthOpenVisualSource ?? (character.mouthOpenAssetId ? { kind: 'image', assetId: character.mouthOpenAssetId } : null);
}

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

export const VoiceProfileV22Schema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    characterId: IdSchema,
    locale: z.string().trim().min(2).max(35),
    rate: z.number().finite().min(0.5).max(2).default(1),
    pitch: z.number().finite().min(-1).max(1).default(0),
  })
  .strict();

// New persisted fields belong on the current exports.
export const FacePlacementSchema = FacePlacementV22Schema;
export const BodyPlacementSchema = BodyPlacementV22Schema;
export const HeadPlacementSchema = HeadPlacementV22Schema;
export const HeadPivotSchema = HeadPivotV22Schema;
export const CharacterHeadSchema = CharacterHeadV22Schema;
export const TalkingHeadMotionIntensityPercentSchema = TalkingHeadMotionIntensityPercentV22Schema;
export const CharacterPartSourceSchema = CharacterPartSourceV22Schema;
export const CharacterPartTransformSchema = CharacterPartTransformV22Schema;
export const CharacterPartStaticAdjustmentSchema = CharacterPartStaticAdjustmentV22Schema;
export const CharacterPartImageMappingSchema = CharacterPartImageMappingV22Schema;
export const CharacterPartImageVisualSourceSchema = CharacterPartImageVisualSourceV22Schema;
export const CharacterPartFlaGraphicVisualSourceSchema = CharacterPartFlaGraphicVisualSourceCurrentSchema;
export const CharacterPartVisualSourceSchema = CharacterPartVisualSourceCurrentSchema;
export const CharacterPartSchema = CharacterPartCurrentSchema;
export const AdaptivePartsFaceAnchorRectSchema = AdaptivePartsFaceAnchorRectV24Schema;
export const AdaptivePartsFaceBindingSchema = AdaptivePartsFaceBindingV24Schema;
export const AdaptivePartsHeadMotionBindingSchema = AdaptivePartsHeadMotionBindingV24Schema;
export const AdaptivePartsCharacterSchema = AdaptivePartsCharacterCurrentSchema;
export const CharacterFaceGraphicSourceSchema = CharacterFaceGraphicSourceV22Schema;
export const CharacterExpressionSchema = CharacterExpressionV22Schema;
export const CharacterSchema = CharacterCurrentSchema;
export const VoiceProfileSchema = VoiceProfileV22Schema;

export type AdaptivePartsFaceAnchorRect = z.infer<typeof AdaptivePartsFaceAnchorRectSchema>;
export type AdaptivePartsFaceBinding = z.infer<typeof AdaptivePartsFaceBindingSchema>;
export type AdaptivePartsHeadMotionBinding = z.infer<typeof AdaptivePartsHeadMotionBindingSchema>;
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
export type CharacterPartImageVisualSource = z.infer<
  typeof CharacterPartImageVisualSourceSchema
>;
export type CharacterPartFlaGraphicVisualSource = z.infer<
  typeof CharacterPartFlaGraphicVisualSourceSchema
>;
export type CharacterPartVisualSource = z.infer<
  typeof CharacterPartVisualSourceSchema
>;
export type CharacterPart = z.infer<typeof CharacterPartSchema>;
export type Character = z.infer<typeof CharacterSchema>;

/**
 * Resolves the canonical visual source for a `CharacterPart`. Legacy parts
 * without `visualSource` map cleanly to `{ kind: 'image', assetId, imageMapping }`.
 */
export function resolveCharacterPartVisualSource(
  part: Pick<CharacterPart, 'partId' | 'assetId' | 'imageMapping' | 'visualSource'>,
): CharacterPartVisualSource {
  if (part.visualSource) {
    return part.visualSource;
  }
  if (part.assetId !== undefined && part.imageMapping !== undefined) {
    return {
      kind: 'image',
      assetId: part.assetId,
      imageMapping: part.imageMapping,
    };
  }
  throw new Error(
    `CharacterPart ${part.partId} has neither valid image fields nor visualSource.`,
  );
}

function cloneFlaGraphicOverrides(
  overrides: FlaGraphicInstanceTransformOverrides,
): FlaGraphicInstanceTransformOverrides {
  return Object.fromEntries(
    Object.entries(overrides).map(([frameKey, frameMap]) => [
      frameKey,
      Object.fromEntries(
        Object.entries(frameMap).map(([pathKey, matrix]) => [
          pathKey,
          { ...matrix },
        ]),
      ),
    ]),
  );
}

/** Deep-clones a `CharacterPartVisualSource` so draft/session edits remain isolated. */
export function cloneCharacterPartVisualSource(
  visualSource: CharacterPartVisualSource,
): CharacterPartVisualSource {
  if (visualSource.kind === 'image') {
    return {
      kind: 'image',
      assetId: visualSource.assetId,
      imageMapping: {
        ...visualSource.imageMapping,
        crop: { ...visualSource.imageMapping.crop },
      },
    };
  }
  return {
    kind: 'fla-graphic',
    animationId: visualSource.animationId,
    ...(visualSource.nodePath ? { nodePath: [...visualSource.nodePath] } : {}),
    ...(visualSource.poseFrameOrdinal !== undefined
      ? { poseFrameOrdinal: visualSource.poseFrameOrdinal }
      : {}),
    ...(visualSource.regionRef ? { regionRef: visualSource.regionRef } : {}),
    ...(visualSource.regionVector
      ? { regionVector: cloneFlaEditableShapeRegion(visualSource.regionVector) }
      : {}),
    ...(visualSource.instanceTransformOverrides
      ? {
          instanceTransformOverrides: cloneFlaGraphicOverrides(
            visualSource.instanceTransformOverrides,
          ),
        }
      : {}),
  };
}

/** Deep-clones a `CharacterPart` across image and structured FLA Graphic visual sources. */
export function cloneCharacterPart(part: CharacterPart): CharacterPart {
  return {
    ...part,
    source: { ...part.source },
    restTransform: { ...part.restTransform },
    ...(part.sourceRestTransform
      ? { sourceRestTransform: { ...part.sourceRestTransform } }
      : {}),
    ...(part.staticAdjustment
      ? { staticAdjustment: { ...part.staticAdjustment } }
      : {}),
    ...(part.imageMapping
      ? {
          imageMapping: {
            ...part.imageMapping,
            crop: { ...part.imageMapping.crop },
          },
        }
      : {}),
    ...(part.visualSource
      ? { visualSource: cloneCharacterPartVisualSource(part.visualSource) }
      : {}),
  };
}
export function cloneAdaptivePartsFaceBinding(
  binding: AdaptivePartsFaceBinding,
): AdaptivePartsFaceBinding {
  return {
    targetPartId: binding.targetPartId,
    replacePartIds: [...binding.replacePartIds],
    anchorRect: { ...binding.anchorRect },
    placement: { ...binding.placement },
  };
}

export function cloneAdaptivePartsHeadMotionBinding(
  binding: AdaptivePartsHeadMotionBinding,
): AdaptivePartsHeadMotionBinding {
  return {
    partIds: [...binding.partIds],
  };
}

export function adaptiveCharacterHasFaceBinding(
  character: Pick<AdaptivePartsCharacter, 'faceBinding' | 'parts'>,
): boolean {
  return Boolean(
    character.faceBinding &&
      character.parts.some((part) => part.partId === character.faceBinding?.targetPartId),
  );
}

export function characterHasExpressions(
  character: Pick<Character, 'mode'> & {
    faceBinding?: AdaptivePartsFaceBinding;
    expressions?: readonly CharacterExpression[];
  },
): boolean {
  if (character.mode !== 'adaptive-parts') return true;
  return Boolean(character.faceBinding) || Boolean(character.expressions?.length);
}

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
