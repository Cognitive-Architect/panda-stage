import { z } from 'zod';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import {
  CharacterPartTransformV22Schema,
  CharacterPartVisualSourceSchema,
  CharacterPartVisualSourceV22Schema,
} from './character';
import {
  AnimationBezierSchema, AnimationCurveSchema, AnimationInterpolationSchema, AnimationKeySchema,
  AnimationKeyV32Schema, AnimationPropertySchema,
} from './animationKeys';
import { CHARACTER_PART_MIN_SCALE, CHARACTER_PART_MAX_SCALE } from '../constants';

export { AnimationKeySchema, AnimationPropertySchema, AnimationInterpolationSchema, AnimationCurveSchema, AnimationBezierSchema } from './animationKeys';

export const LayerTargetRefSchema = z.object({
  kind: z.literal('layer'),
  layerId: IdSchema,
}).strict();

export const CharacterPartTargetRefSchema = z.object({
  kind: z.literal('character-part'),
  layerId: IdSchema,
  partId: IdSchema,
}).strict();

/** Bone pose target of an Adaptive Parts Character instance (#1455). */
export const CharacterBoneTargetRefSchema = z.object({
  kind: z.literal('character-bone'),
  layerId: IdSchema,
  boneId: IdSchema,
}).strict();

export const CharacterNodeIdSchema = z.union([
  z.enum(['root', 'body', 'face', 'head']),
  z.templateLiteral(['part:', IdSchema]),
]);

export const CharacterNodeTargetRefSchema = z.object({
  kind: z.literal('character-node'),
  layerId: IdSchema,
  nodeId: CharacterNodeIdSchema,
}).strict();

export const AnimationTargetRefSchema = z.discriminatedUnion('kind', [
  LayerTargetRefSchema,
  CharacterPartTargetRefSchema,
  CharacterBoneTargetRefSchema,
  CharacterNodeTargetRefSchema,
]);

function validateAnimationTrack(
  track: {
    target: { kind: string; layerId: string };
    property: z.infer<typeof AnimationPropertySchema>;
    keys: readonly z.infer<typeof AnimationKeySchema>[];
  },
  context: z.RefinementCtx,
): void {
  if (track.property === 'transform.scaleX' || track.property === 'transform.scaleY') {
    track.keys.forEach((key, index) => {
      if (track.target.kind === 'layer') {
        if (key.value <= 0) {
          context.addIssue({
            code: 'custom',
            path: ['keys', index, 'value'],
            message: 'Layer animation scale multiplier must be a positive finite number.',
          });
        }
      } else if (key.value < CHARACTER_PART_MIN_SCALE || key.value > CHARACTER_PART_MAX_SCALE) {
        context.addIssue({
          code: 'custom',
          path: ['keys', index, 'value'],
          message: `Animation scale must be between ${CHARACTER_PART_MIN_SCALE} and ${CHARACTER_PART_MAX_SCALE}.`,
        });
      }
    });
  }
  // Ported from #979: the base key may change value, but cannot disappear/retime.
  if (track.keys[0]?.timeMs !== 0) {
    context.addIssue({ code: 'custom', path: ['keys', 0, 'timeMs'], message: 'Every track requires a protected 0 ms key.' });
  }
  for (let index = 1; index < track.keys.length; index += 1) {
    if (track.keys[index]!.timeMs <= track.keys[index - 1]!.timeMs) {
      context.addIssue({ code: 'custom', path: ['keys', index, 'timeMs'], message: 'Animation keys must be strictly ascending and unique.' });
    }
  }
}

export const AnimationTrackSchema = z.object({
  target: AnimationTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine(validateAnimationTrack);

export const CharacterPartAnimationTrackSchema = z.object({
  target: CharacterPartTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine(validateAnimationTrack);

export const CharacterNodeAnimationTrackSchema = z.object({
  target: CharacterNodeTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine(validateAnimationTrack);

/** Target union accepted by the current Character Clip v1: Part pose + Bone pose. */
export const CharacterPoseTargetRefSchema = z.union([
  CharacterPartTargetRefSchema,
  CharacterBoneTargetRefSchema,
]);

/**
 * Current Character Clip v1 track. Bone pose tracks reuse the five existing
 * transform properties and carry no target basis: bones are defined on the
 * Character, not frozen per Layer instance.
 */
export const CharacterPoseAnimationTrackSchema = z.object({
  target: CharacterPoseTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine(validateAnimationTrack);

export const LayerAnimationTrackSchema = z.object({
  target: LayerTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine(validateAnimationTrack);

export const TargetLocalPivotSchema = z.object({
  space: z.literal('target-local'),
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
}).strict();

export const CharacterPartTargetBasisV22Schema = z.object({
  target: CharacterPartTargetRefSchema,
  visualSource: CharacterPartVisualSourceV22Schema,
  /** Frozen source-local -> Character-local transform; no runtime composition here. */
  baseTransform: CharacterPartTransformV22Schema,
  pivot: TargetLocalPivotSchema,
  drawOrder: z.number().int().nonnegative().max(1_000_000),
  visible: z.boolean(),
  displayName: NameSchema.optional(),
}).strict();

export const CharacterPartTargetBasisSchema = z.object({
  target: CharacterPartTargetRefSchema,
  visualSource: CharacterPartVisualSourceSchema,
  /** Frozen source-local -> Character-local transform; no runtime composition here. */
  baseTransform: CharacterPartTransformV22Schema,
  pivot: TargetLocalPivotSchema,
  drawOrder: z.number().int().nonnegative().max(1_000_000),
  visible: z.boolean(),
  displayName: NameSchema.optional(),
}).strict();

export const LayerTargetBasisSchema = z.object({
  target: LayerTargetRefSchema,
  animationId: IdSchema,
  /** Frozen Layer Instance static transform; never stores Pose or computed deltas. */
  baseTransform: z.object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    scaleX: FiniteNumberSchema.positive(),
    scaleY: FiniteNumberSchema.positive(),
    rotationDeg: FiniteNumberSchema,
  }).strict(),
  sourceCanvas: z.object({
    width: FiniteNumberSchema.positive(),
    height: FiniteNumberSchema.positive(),
  }).strict(),
  pivot: TargetLocalPivotSchema,
}).strict();

export const CharacterNodeTargetBasisSchema = z.object({
  target: CharacterNodeTargetRefSchema,
  baseTransform: LayerTargetBasisSchema.shape.baseTransform,
  pivot: TargetLocalPivotSchema,
}).strict();

export function animationTargetIdentity(target: AnimationTargetRef): string {
  switch (target.kind) {
    case 'layer': return JSON.stringify([target.kind, target.layerId]);
    case 'character-part': return JSON.stringify([target.kind, target.layerId, target.partId]);
    case 'character-bone': return JSON.stringify([target.kind, target.layerId, target.boneId]);
    case 'character-node': return JSON.stringify([target.kind, target.layerId, target.nodeId]);
  }
}

export function sameAnimationTarget(left: AnimationTargetRef, right: AnimationTargetRef): boolean {
  if (left.layerId !== right.layerId) return false;
  switch (left.kind) {
    case 'layer': return right.kind === 'layer';
    case 'character-part': return right.kind === 'character-part' && left.partId === right.partId;
    case 'character-bone': return right.kind === 'character-bone' && left.boneId === right.boneId;
    case 'character-node': return right.kind === 'character-node' && left.nodeId === right.nodeId;
  }
}

function validateUniqueClipTargetsAndTracks(
  clip: {
    targetBases: readonly { target: AnimationTargetRef }[];
    tracks: readonly { target: AnimationTargetRef; property: AnimationProperty }[];
  },
  context: z.RefinementCtx,
): void {
  const bases = new Set<string>();
  clip.targetBases.forEach((basis, index) => {
    const identity = animationTargetIdentity(basis.target);
    if (bases.has(identity)) {
      context.addIssue({ code: 'custom', path: ['targetBases', index, 'target'], message: 'Duplicate target basis.' });
    }
    bases.add(identity);
  });
  const tracks = new Set<string>();
  clip.tracks.forEach((track, index) => {
    const identity = JSON.stringify([animationTargetIdentity(track.target), track.property]);
    if (tracks.has(identity)) {
      context.addIssue({ code: 'custom', path: ['tracks', index], message: 'Duplicate target + property track.' });
    }
    tracks.add(identity);
    // Bone pose tracks are defined by the Character Bone tree, so they carry no
    // frozen Layer target basis. Every other target kind still requires one.
    if (track.target.kind !== 'character-bone' && !bases.has(animationTargetIdentity(track.target))) {
      context.addIssue({ code: 'custom', path: ['tracks', index, 'target'], message: 'Animation track requires a matching target basis.' });
    }
  });
}

export const AnimationClipV0V22Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisV22Schema),
  tracks: z.array(CharacterPartAnimationTrackSchema.safeExtend({ keys: z.array(AnimationKeyV32Schema).min(1) })),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

/** Frozen Character Clip v1 reader: Part pose tracks only, before Bone pose tracks. */
export const AnimationClipV0Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisSchema),
  tracks: z.array(CharacterPartAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

/**
 * Current Character Clip v1: Part pose tracks plus Bone pose tracks that reuse
 * the same five transform properties and need no frozen target basis.
 */
export const CharacterPoseAnimationClipV0Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisSchema),
  tracks: z.array(CharacterPoseAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

export const LayerAnimationClipSchema = z.object({
  version: z.literal(2),
  targetBases: z.array(LayerTargetBasisSchema),
  tracks: z.array(LayerAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

const LayerAnimationClipV32Schema = LayerAnimationClipSchema.safeExtend({
  tracks: z.array(LayerAnimationTrackSchema.safeExtend({ keys: z.array(AnimationKeyV32Schema).min(1) })),
});

/** Frozen v22 clip union. */
export const AnimationClipV22Schema = z.discriminatedUnion('version', [
  AnimationClipV0V22Schema,
  LayerAnimationClipV32Schema,
]);

export const CharacterNodeAnimationClipSchema = z.object({
  version: z.literal(3),
  targetBases: z.array(CharacterNodeTargetBasisSchema),
  tracks: z.array(CharacterNodeAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

export const AnimationClipV32Schema = z.discriminatedUnion('version', [
  AnimationClipV0Schema.safeExtend({
    tracks: z.array(CharacterPartAnimationTrackSchema.safeExtend({ keys: z.array(AnimationKeyV32Schema).min(1) })),
  }),
  LayerAnimationClipV32Schema,
  CharacterNodeAnimationClipSchema.safeExtend({
    tracks: z.array(CharacterNodeAnimationTrackSchema.safeExtend({ keys: z.array(AnimationKeyV32Schema).min(1) })),
  }),
]);

/** Frozen v41 clip union: Character Clip v1 with curve keys, before Bone pose tracks. */
export const AnimationClipV41Schema = z.discriminatedUnion('version', [
  AnimationClipV0Schema,
  LayerAnimationClipSchema,
  CharacterNodeAnimationClipSchema,
]);

/** Current clip union, including Bone pose tracks on Character Clip v1. */
export const AnimationClipSchema = z.discriminatedUnion('version', [
  CharacterPoseAnimationClipV0Schema,
  LayerAnimationClipSchema,
  CharacterNodeAnimationClipSchema,
]);

export type CharacterNodeId = z.infer<typeof CharacterNodeIdSchema>;
export type CharacterNodeTargetRef = z.infer<typeof CharacterNodeTargetRefSchema>;
export type CharacterNodeTargetBasis = z.infer<typeof CharacterNodeTargetBasisSchema>;
export type CharacterNodeAnimationClip = z.infer<typeof CharacterNodeAnimationClipSchema>;
export type LayerTargetRef = z.infer<typeof LayerTargetRefSchema>;
export type CharacterPartTargetRef = z.infer<typeof CharacterPartTargetRefSchema>;
export type CharacterBoneTargetRef = z.infer<typeof CharacterBoneTargetRefSchema>;
export type CharacterPoseTargetRef = z.infer<typeof CharacterPoseTargetRefSchema>;
export type CharacterPoseAnimationTrack = z.infer<typeof CharacterPoseAnimationTrackSchema>;
export type AnimationTargetRef = z.infer<typeof AnimationTargetRefSchema>;
export type AnimationProperty = z.infer<typeof AnimationPropertySchema>;
export type AnimationInterpolation = z.infer<typeof AnimationInterpolationSchema>;
export type AnimationBezier = z.infer<typeof AnimationBezierSchema>;
export type AnimationCurve = z.infer<typeof AnimationCurveSchema>;
export type AnimationKey = z.infer<typeof AnimationKeySchema>;
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;
export type CharacterPartAnimationTrack = z.infer<typeof CharacterPartAnimationTrackSchema>;
export type LayerAnimationTrack = z.infer<typeof LayerAnimationTrackSchema>;
export type TargetLocalPivot = z.infer<typeof TargetLocalPivotSchema>;
export type CharacterPartTargetBasis = z.infer<typeof CharacterPartTargetBasisSchema>;
export type LayerTargetBasis = z.infer<typeof LayerTargetBasisSchema>;
export type AnimationClipV0 = z.infer<typeof CharacterPoseAnimationClipV0Schema>;
export type LayerAnimationClip = z.infer<typeof LayerAnimationClipSchema>;
export type AnimationClip = z.infer<typeof AnimationClipSchema>;
