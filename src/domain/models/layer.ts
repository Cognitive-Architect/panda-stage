import { z } from 'zod';
import { LAYER_ANCHOR } from '../constants';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import { PartPoseAnimationSchema } from './pose-animation';

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

/** Adaptive Parts layers may reference a Character without an Expression. */
export const CharacterLayerSourceV15Schema = z
  .object({
    kind: z.literal('character'),
    characterId: IdSchema,
    expressionId: IdSchema.optional(),
  })
  .strict();

/** Source variants accepted by persisted schemas through v14. */
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

/** Strict v15 Adaptive Parts source contract from origin/main. */
export const LayerSourceV15AdaptiveSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceV15Schema,
]);

/** Strict animation-era v15 source contract from the PR branch. */
export const LayerSourceV15AnimationSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceSchema,
  AnimationLayerSourceSchema,
]);

/** Persisted v16 source contract combines Adaptive Parts and animation layers. */
export const LayerSourceV16Schema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceV15Schema,
  AnimationLayerSourceSchema,
]);

/** Current Layer sources remain compatible with the frozen v16 contract. */
export const LayerSourceSchema = LayerSourceV16Schema;

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
  source: LayerSourceV15AnimationSchema,
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

/** Strict animation-era v15 layer shape before persisted playback settings. */
export const LayerV15AnimationSchema = z
  .object(LayerV15AnimationShape)
  .strict()
  .superRefine((layer, context) =>
    validateAnimationLayerFields(layer, context, false),
  );

/** Strict origin/main v15 layer shape with Adaptive Parts references. */
export const LayerV15AdaptiveSchema = z
  .object({
    ...LayerV3Shape,
    source: LayerSourceV15AdaptiveSchema,
    locked: z.boolean(),
    flipX: z.boolean(),
  })
  .strict();

/** Backward-compatible name for the PR branch's historical v15 contract. */
export const LayerV15Schema = LayerV15AnimationSchema;

/** Exact persisted v16 Layer shape before Part pose animation. */
export const LayerV16Schema = z
  .object({
    ...LayerV15AnimationShape,
    source: LayerSourceV16Schema,
    animationPlayback: AnimationPlaybackSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) =>
    validateAnimationLayerFields(layer, context, true),
  );

export const LayerSchema = z
  .object({
    ...LayerV15AnimationShape,
    source: LayerSourceSchema,
    animationPlayback: AnimationPlaybackSchema.optional(),
    poseAnimation: PartPoseAnimationSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) => {
    validateAnimationLayerFields(layer, context, true);
    if (layer.poseAnimation) {
      if (layer.source.kind !== 'character') {
        context.addIssue({
          code: 'custom',
          path: ['poseAnimation'],
          message: 'Part pose animation requires a Character Layer.',
        });
      } else if (layer.source.characterId !== layer.poseAnimation.characterId) {
        context.addIssue({
          code: 'custom',
          path: ['poseAnimation', 'characterId'],
          message: 'Part pose animation must snapshot its owning Character.',
        });
      }
    }
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
export type LayerSourceV15Adaptive = z.infer<typeof LayerSourceV15AdaptiveSchema>;
export type LayerSourceV15Animation = z.infer<typeof LayerSourceV15AnimationSchema>;
export type LayerSourceV16 = z.infer<typeof LayerSourceV16Schema>;
export type LayerV3 = z.infer<typeof LayerV3Schema>;
export type LayerV4 = z.infer<typeof LayerV4Schema>;
export type LayerV14 = z.infer<typeof LayerV14Schema>;
export type LayerV15 = z.infer<typeof LayerV15AnimationSchema>;
export type LayerV15Adaptive = z.infer<typeof LayerV15AdaptiveSchema>;
export type LayerV16 = z.infer<typeof LayerV16Schema>;
export type Layer = z.infer<typeof LayerSchema>;
