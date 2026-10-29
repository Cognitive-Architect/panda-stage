import { z } from 'zod';
import { LAYER_ANCHOR } from '../constants';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';

export const AssetLayerSourceSchema = z
  .object({
    kind: z.literal('asset'),
    assetId: IdSchema,
  })
  .strict();

export const CharacterLayerSourceSchema = z
  .object({
    kind: z.literal('character'),
    characterId: IdSchema,
    expressionId: IdSchema,
  })
  .strict();

/** Source variants accepted by all persisted schemas through v14. */
export const LayerSourceV14Schema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceSchema,
]);

export const AnimationLayerSourceSchema = z
  .object({
    kind: z.literal('animation'),
    animationId: IdSchema,
  })
  .strict();

export const LayerSourceSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceSchema,
  AnimationLayerSourceSchema,
]);

export const AnimationPlaybackSchema = z
  .object({
    mode: z.enum(['once', 'loop']),
    endBehavior: z.enum(['hold', 'hide']),
  })
  .strict();

const LayerV3Shape = {
  id: IdSchema,
  name: NameSchema,
  source: LayerSourceV14Schema,
  /** x/y are always the visual center of the layer on the 1920×1080 canvas. */
  anchor: z.literal(LAYER_ANCHOR),
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  scaleX: FiniteNumberSchema.positive().default(1),
  scaleY: FiniteNumberSchema.positive().default(1),
  rotationDeg: FiniteNumberSchema.default(0),
  opacity: FiniteNumberSchema.min(0).max(1).default(1),
  visible: z.boolean().default(true),
  zIndex: z.number().int().nonnegative(),
};

/** Schema v3 layer shape before persistent locking was introduced. */
export const LayerV3Schema = z.object(LayerV3Shape).strict();

/** Schema v4 layer shape before explicit horizontal flip was introduced. */
export const LayerV4Schema = z
  .object({
    ...LayerV3Shape,
    locked: z.boolean(),
  })
  .strict();

const LayerV15AnimationShape = {
  ...LayerV3Shape,
  source: LayerSourceSchema,
  locked: z.boolean(),
  flipX: z.boolean(),
  /** Shot-local timeline start; only present on animation instances. */
  startTimeMs: FiniteNumberSchema.nonnegative().optional(),
};

function validateAnimationLayerFields(
  layer: {
    source: LayerSource;
    startTimeMs?: number;
    animationPlayback?: z.infer<typeof AnimationPlaybackSchema>;
  },
  context: z.RefinementCtx,
  requiresPlayback: boolean,
): void {
  if (layer.source.kind === 'animation') {
    if (layer.startTimeMs === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['startTimeMs'],
        message: 'Animation layers require a persisted start time.',
      });
    }
    if (requiresPlayback && layer.animationPlayback === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['animationPlayback'],
        message: 'Animation layers require persisted playback settings.',
      });
    }
    return;
  }

  if (layer.startTimeMs !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['startTimeMs'],
      message: 'Only animation layers may have a start time.',
    });
  }
  if (layer.animationPlayback !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['animationPlayback'],
      message: 'Only animation layers may have playback settings.',
    });
  }
}

/** Exact current-v15 layer shape before per-instance playback was introduced. */
export const LayerV15Schema = z
  .object(LayerV15AnimationShape)
  .strict()
  .superRefine((layer, context) =>
    validateAnimationLayerFields(layer, context, false),
  );

export const LayerSchema = z
  .object({
    ...LayerV15AnimationShape,
    animationPlayback: AnimationPlaybackSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) => {
    validateAnimationLayerFields(layer, context, true);
  });

/** Exact v14 Layer shape; do not widen this when current sources evolve. */
export const LayerV14Schema = z
  .object({
    ...LayerV3Shape,
    locked: z.boolean(),
    flipX: z.boolean(),
  })
  .strict();

export type LayerSource = z.infer<typeof LayerSourceSchema>;
export type AnimationPlayback = z.infer<typeof AnimationPlaybackSchema>;
export type LayerSourceV14 = z.infer<typeof LayerSourceV14Schema>;
export type LayerV3 = z.infer<typeof LayerV3Schema>;
export type LayerV4 = z.infer<typeof LayerV4Schema>;
export type LayerV14 = z.infer<typeof LayerV14Schema>;
export type LayerV15 = z.infer<typeof LayerV15Schema>;
export type Layer = z.infer<typeof LayerSchema>;
