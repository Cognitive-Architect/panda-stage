import { z } from 'zod';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import {
  CharacterPartTransformV22Schema,
  CharacterPartVisualSourceSchema,
  CharacterPartVisualSourceV22Schema,
} from './character';
import { isValidFrameTime } from '../timeline/frame-grid';
import { CHARACTER_PART_MIN_SCALE, CHARACTER_PART_MAX_SCALE } from '../constants';

export const LayerTargetRefSchema = z.object({
  kind: z.literal('layer'),
  layerId: IdSchema,
}).strict();

export const CharacterPartTargetRefSchema = z.object({
  kind: z.literal('character-part'),
  layerId: IdSchema,
  partId: IdSchema,
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
  CharacterNodeTargetRefSchema,
]);

export const AnimationPropertySchema = z.enum([
  'transform.offsetX', 'transform.offsetY', 'transform.rotationDeg',
  'transform.scaleX', 'transform.scaleY',
]);

export const AnimationInterpolationSchema = z.enum([
  'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step',
]);

export const AnimationKeySchema = z.object({
  /** Persisted integer milliseconds on the Project FPS grid (#979). */
  timeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .refine((timeMs) => isValidFrameTime(timeMs), {
      message: 'Animation key time must be on the Project frame grid.',
    }),
  value: FiniteNumberSchema,
  interpolationToNext: AnimationInterpolationSchema,
}).strict();

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
    case 'character-node': return JSON.stringify([target.kind, target.layerId, target.nodeId]);
  }
}

export function sameAnimationTarget(left: AnimationTargetRef, right: AnimationTargetRef): boolean {
  if (left.layerId !== right.layerId) return false;
  switch (left.kind) {
    case 'layer': return right.kind === 'layer';
    case 'character-part': return right.kind === 'character-part' && left.partId === right.partId;
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
    const target = animationTargetIdentity(track.target);
    const identity = JSON.stringify([target, track.property]);
    if (tracks.has(identity)) {
      context.addIssue({ code: 'custom', path: ['tracks', index], message: 'Duplicate target + property track.' });
    }
    tracks.add(identity);
    if (!bases.has(target)) {
      context.addIssue({ code: 'custom', path: ['tracks', index, 'target'], message: 'Animation track requires a matching target basis.' });
    }
  });
}

export const AnimationClipV0V22Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisV22Schema),
  tracks: z.array(CharacterPartAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

export const AnimationClipV0Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisSchema),
  tracks: z.array(CharacterPartAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

export const LayerAnimationClipSchema = z.object({
  version: z.literal(2),
  targetBases: z.array(LayerTargetBasisSchema),
  tracks: z.array(LayerAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

/** Frozen v22 clip union. */
export const AnimationClipV22Schema = z.discriminatedUnion('version', [
  AnimationClipV0V22Schema,
  LayerAnimationClipSchema,
]);

export const CharacterNodeAnimationClipSchema = z.object({
  version: z.literal(3),
  targetBases: z.array(CharacterNodeTargetBasisSchema),
  tracks: z.array(CharacterNodeAnimationTrackSchema),
}).strict().superRefine(validateUniqueClipTargetsAndTracks);

export const AnimationClipSchema = z.discriminatedUnion('version', [
  AnimationClipV0Schema,
  LayerAnimationClipSchema,
  CharacterNodeAnimationClipSchema,
]);

export type CharacterNodeId = z.infer<typeof CharacterNodeIdSchema>;
export type CharacterNodeTargetRef = z.infer<typeof CharacterNodeTargetRefSchema>;
export type CharacterNodeTargetBasis = z.infer<typeof CharacterNodeTargetBasisSchema>;
export type CharacterNodeAnimationClip = z.infer<typeof CharacterNodeAnimationClipSchema>;
export type LayerTargetRef = z.infer<typeof LayerTargetRefSchema>;
export type CharacterPartTargetRef = z.infer<typeof CharacterPartTargetRefSchema>;
export type AnimationTargetRef = z.infer<typeof AnimationTargetRefSchema>;
export type AnimationProperty = z.infer<typeof AnimationPropertySchema>;
export type AnimationInterpolation = z.infer<typeof AnimationInterpolationSchema>;
export type AnimationKey = z.infer<typeof AnimationKeySchema>;
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;
export type CharacterPartAnimationTrack = z.infer<typeof CharacterPartAnimationTrackSchema>;
export type LayerAnimationTrack = z.infer<typeof LayerAnimationTrackSchema>;
export type TargetLocalPivot = z.infer<typeof TargetLocalPivotSchema>;
export type CharacterPartTargetBasis = z.infer<typeof CharacterPartTargetBasisSchema>;
export type LayerTargetBasis = z.infer<typeof LayerTargetBasisSchema>;
export type AnimationClipV0 = z.infer<typeof AnimationClipV0Schema>;
export type LayerAnimationClip = z.infer<typeof LayerAnimationClipSchema>;
export type AnimationClip = z.infer<typeof AnimationClipSchema>;
