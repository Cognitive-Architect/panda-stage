import { z } from 'zod';
import { FlaInstanceColorSchema } from '../../shared/fla-instance-color';
import { AnimationSourceRangeSchema } from './animationSourceRange';
import {
  AnimationClipSchema,
  AnimationClipV32Schema,
  AnimationClipV0V22Schema,
  AnimationClipV22Schema,
  LayerAnimationTrackSchema,
  type AnimationClip,
} from './animationCore';
import { LAYER_ANCHOR } from '../constants';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import { FlaGraphicShapeOverridesSchema } from '../fla-shape-vector';
import { FlaGraphicInstanceTextOverridesSchema } from './flaGraphicInstanceText';
import { FlaGraphicInstanceTransformOverridesSchema, FlaGraphicInstanceTransformOverridesV22Schema } from './flaGraphicInstanceOverrides';

const AssetLayerSourceV22Schema = z
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
  AssetLayerSourceV22Schema,
  CharacterLayerSourceSchema,
]);

export const AnimationLayerSourceV15Schema = z
  .object({
    kind: z.literal('animation'),
    animationId: IdSchema,
  })
  .strict();

const AnimationLayerSourceV22Schema = z
  .object({
    kind: z.literal('animation'),
    animationId: IdSchema,
    flaOccurrence: z
      .object({
        occurrenceId: z.string().regex(/^occ-[a-f0-9]{24,64}$/u),
        sourceAddress: z.string().trim().min(1).max(1_000),
        adapterIdentity: z.string().trim().min(1).max(500),
        drawOrder: z.number().int().nonnegative().max(100_000),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Exact persisted animation source shape before FLA occurrence provenance. */
export const AnimationLayerSourceV16Schema = z
  .object({
    kind: z.literal('animation'),
    animationId: IdSchema,
  })
  .strict();

/** Strict v15 Adaptive Parts source contract from origin/main. */
export const LayerSourceV15AdaptiveSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceV22Schema,
  CharacterLayerSourceV15Schema,
]);

/** Strict animation-era v15 source contract from the PR branch. */
export const LayerSourceV15AnimationSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceV22Schema,
  CharacterLayerSourceSchema,
  AnimationLayerSourceV15Schema,
]);

/** Layer source variants persisted in v22. */
const LayerSourceV22Schema = z.discriminatedUnion('kind', [
  AssetLayerSourceV22Schema,
  CharacterLayerSourceV15Schema,
  AnimationLayerSourceV22Schema,
]);

/** Exact source variants persisted by schema v16. */
export const LayerSourceV16Schema = z.discriminatedUnion('kind', [
  AssetLayerSourceV22Schema,
  CharacterLayerSourceV15Schema,
  AnimationLayerSourceV16Schema,
]);

export const AnimationPlaybackV16Schema = z
  .object({
    mode: z.enum(['once', 'loop']),
    endBehavior: z.enum(['hold', 'hide']),
  })
  .strict();

const AnimationPlaybackV22Schema = z
  .object({
    mode: z.enum(['once', 'loop', 'single-frame']),
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
    animationFirstFrame?: number;
    animationPlayback?: z.infer<typeof AnimationPlaybackV22Schema>;
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
    if (layer.animationFirstFrame !== undefined &&
        (!Number.isSafeInteger(layer.animationFirstFrame) || layer.animationFirstFrame < 0)) {
      context.addIssue({
        code: 'custom',
        path: ['animationFirstFrame'],
        message: 'Animation first frame must be a nonnegative integer.',
      });
    }
    return;
  }

  if (layer.source.kind === 'video') {
    if (layer.animationPlayback !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['animationPlayback'],
        message: 'Only animation layers may have playback settings.',
      });
    }
    if (layer.animationFirstFrame !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['animationFirstFrame'],
        message: 'Only animation layers may have an animation first frame.',
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
  if (layer.animationFirstFrame !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['animationFirstFrame'],
      message: 'Only animation layers may have an animation first frame.',
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

export const AssetLayerSourceSchema = AssetLayerSourceV22Schema;
export const AnimationLayerSourceSchema = AnimationLayerSourceV22Schema.extend({
  flaOccurrence: AnimationLayerSourceV22Schema.shape.flaOccurrence.unwrap().extend({
    instanceColor: FlaInstanceColorSchema.optional(),
  }).optional(),
});
export const VideoLayerSourceSchema = z
  .object({
    kind: z.literal('video'),
    assetId: IdSchema,
    playbackMode: z.enum(['play-once', 'loop', 'single-frame']).optional(),
    trimStartMs: FiniteNumberSchema.nonnegative().optional(),
    trimEndMs: FiniteNumberSchema.positive().optional(),
    heldFrameIndex: FiniteNumberSchema.int().nonnegative().optional(),
    sourceFps: FiniteNumberSchema.positive().max(1_000).optional(),
    audioAssetId: IdSchema.optional(),
  })
  .strict();
export const LayerSourceSchema = z.discriminatedUnion('kind', [
  AssetLayerSourceSchema,
  CharacterLayerSourceV15Schema,
  AnimationLayerSourceSchema,
  VideoLayerSourceSchema,
]);
export const AnimationPlaybackSchema = AnimationPlaybackV22Schema;

/** Frozen v20 Layer reader, before Animation Core. */
export const LayerV20Schema = z
  .object({
    ...LayerV15AnimationShape,
    source: LayerSourceV22Schema,
    /** Authored first frame offset for Graphic or raster animation instances. */
    animationFirstFrame: FiniteNumberSchema.int().nonnegative().optional(),
    animationPlayback: AnimationPlaybackSchema.optional(),
    /** Sparse transforms authored on this Layer instance, never on its Definition. */
    flaGraphicInstanceTransformOverrides:
      FlaGraphicInstanceTransformOverridesSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) => {
    validateAnimationLayerFields(layer, context, true);
  });

/** Frozen v21 Layer reader: accepts only Character Clip v1 on Character layers. */
export const LayerV21Schema = LayerV20Schema.safeExtend({
  animationClip: AnimationClipV0V22Schema.optional(),
}).superRefine((layer, context) => {
  if (!layer.animationClip) return;
  if (layer.source.kind !== 'character') {
    context.addIssue({ code: 'custom', path: ['animationClip'], message: 'Only Character layers may contain an animation clip.' });
  }
  for (const collection of ['targetBases', 'tracks'] as const) {
    layer.animationClip[collection].forEach((entry, index) => {
      if (entry.target.layerId !== layer.id) {
        context.addIssue({ code: 'custom', path: ['animationClip', collection, index, 'target', 'layerId'], message: 'Animation target must belong to its owning Layer.' });
      }
    });
  }
});

function validateClipOwnership(
  layer: {
    id: string;
    source: { kind: string; animationId?: string };
    animationClip?: AnimationClip;
  },
  context: z.RefinementCtx,
): void {
  const clip = layer.animationClip;
  if (!clip) return;
  if (clip.version === 1 || clip.version === 3) {
    if (layer.source.kind !== 'character') {
      context.addIssue({ code: 'custom', path: ['animationClip'], message: 'Only Character layers may contain a Character animation clip.' });
    }
  } else {
    if (layer.source.kind !== 'animation') {
      context.addIssue({ code: 'custom', path: ['animationClip'], message: 'Layer animation clips require an animation Layer.' });
    }
    if (clip.targetBases.length !== 1) {
      context.addIssue({ code: 'custom', path: ['animationClip', 'targetBases'], message: 'Layer animation clip requires exactly one Layer target basis.' });
    }
    if (layer.source.kind === 'animation') {
      const animationId = layer.source.animationId;
      clip.targetBases.forEach((basis, index) => {
        if (basis.animationId !== animationId) {
          context.addIssue({ code: 'custom', path: ['animationClip', 'targetBases', index, 'animationId'], message: 'Layer animation basis must match its owning Layer animation Definition.' });
        }
      });
    }
  }
  for (const collection of ['targetBases', 'tracks'] as const) {
    clip[collection].forEach((entry, index) => {
      if (entry.target.layerId !== layer.id) {
        context.addIssue({ code: 'custom', path: ['animationClip', collection, index, 'target', 'layerId'], message: 'Animation target must belong to its owning Layer.' });
      }
    });
  }
}

/** Frozen v22 Layer reader with Character Clip v1 and Layer Clip v2. */
export const LayerV22Schema = LayerV20Schema.safeExtend({
  source: LayerSourceV22Schema,
  animationPlayback: AnimationPlaybackV22Schema.optional(),
  flaGraphicInstanceTransformOverrides: FlaGraphicInstanceTransformOverridesV22Schema.optional(),
  animationClip: AnimationClipV22Schema.optional(),
}).superRefine(validateClipOwnership);

export const LayerV30Schema = LayerV20Schema.safeExtend({
  animationClip: AnimationClipV32Schema.optional(),
  flaGraphicInstanceShapeOverrides: FlaGraphicShapeOverridesSchema.optional(),
}).superRefine(validateClipOwnership);

export const LayerV32Schema = LayerV30Schema.safeExtend({
  animationSourceRange: AnimationSourceRangeSchema.optional(),
}).superRefine((layer, context) => {
  if (layer.animationSourceRange && layer.source.kind !== 'animation') {
    context.addIssue({ code: 'custom', path: ['animationSourceRange'], message: 'Animation source ranges require an animation layer.' });
  }
});

export const LayerV41Schema = LayerV32Schema.safeExtend({
  animationClip: AnimationClipSchema.optional(),
});

export const LayerV42Schema = z
  .object({
    ...LayerV15AnimationShape,
    source: LayerSourceSchema,
    /** Authored first frame offset for Graphic or raster animation instances. */
    animationFirstFrame: FiniteNumberSchema.int().nonnegative().optional(),
    animationPlayback: AnimationPlaybackSchema.optional(),
    /** Sparse transforms authored on this Layer instance, never on its Definition. */
    flaGraphicInstanceTransformOverrides:
      FlaGraphicInstanceTransformOverridesSchema.optional(),
    flaGraphicInstanceShapeOverrides: FlaGraphicShapeOverridesSchema.optional(),
    flaGraphicInstanceTextOverrides: FlaGraphicInstanceTextOverridesSchema.optional(),
    animationSourceRange: AnimationSourceRangeSchema.optional(),
    animationClip: AnimationClipSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) => {
    validateAnimationLayerFields(layer, context, true);
    validateClipOwnership(layer, context);
    if (layer.animationSourceRange && layer.source.kind !== 'animation') {
      context.addIssue({
        code: 'custom',
        path: ['animationSourceRange'],
        message: 'Animation source ranges require an animation layer.',
      });
    }
  });

const LayerSpaceMatrixSchema = z.object({
  a: FiniteNumberSchema, b: FiniteNumberSchema, c: FiniteNumberSchema,
  d: FiniteNumberSchema, tx: FiniteNumberSchema, ty: FiniteNumberSchema,
}).strict();

export const LayerSchema = LayerV42Schema.safeExtend({
  parentLayerId: IdSchema.optional(),
  /** Maps authored local animation into the current parent's space (or world when detached). */
  parentSpaceOffset: LayerSpaceMatrixSchema.optional(),
  /** Local root motion for layers without a Graphic Layer Clip. */
  layerMotionTracks: z.array(LayerAnimationTrackSchema).optional(),
}).superRefine((layer, context) => {
  const properties = new Set<string>();
  layer.layerMotionTracks?.forEach((track, index) => {
    if (track.target.layerId !== layer.id || properties.has(track.property) || layer.animationClip?.version === 2) {
      context.addIssue({
        code: 'custom', path: ['layerMotionTracks', index],
        message: 'Root motion requires a unique track on its owning layer and cannot duplicate a Layer Clip.',
      });
    }
    properties.add(track.property);
  });
});

/** Exact persisted v16 layer shape before Graphic frame offsets and provenance. */
export const LayerV16Schema = z
  .object({
    ...LayerV15AnimationShape,
    source: LayerSourceV16Schema,
    animationPlayback: AnimationPlaybackV16Schema.optional(),
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
export type LayerSourceV15Adaptive = z.infer<typeof LayerSourceV15AdaptiveSchema>;
export type LayerSourceV15Animation = z.infer<typeof LayerSourceV15AnimationSchema>;
export type LayerV3 = z.infer<typeof LayerV3Schema>;
export type LayerV4 = z.infer<typeof LayerV4Schema>;
export type LayerV14 = z.infer<typeof LayerV14Schema>;
export type LayerV15 = z.infer<typeof LayerV15AnimationSchema>;
export type LayerV15Adaptive = z.infer<typeof LayerV15AdaptiveSchema>;
export type Layer = z.infer<typeof LayerSchema>;
