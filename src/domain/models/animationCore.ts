import { z } from 'zod';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import { CharacterPartTransformSchema, CharacterPartVisualSourceSchema } from './character';
import { isValidFrameTime } from '../timeline/frame-grid';

export const AnimationTargetRefSchema = z.object({
  kind: z.literal('character-part'),
  layerId: IdSchema,
  partId: IdSchema,
}).strict();

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

export const AnimationTrackSchema = z.object({
  target: AnimationTargetRefSchema,
  property: AnimationPropertySchema,
  keys: z.array(AnimationKeySchema).min(1),
}).strict().superRefine((track, context) => {
  // Ported from #979: the base key may change value, but cannot disappear/retime.
  if (track.keys[0]?.timeMs !== 0) {
    context.addIssue({ code: 'custom', path: ['keys', 0, 'timeMs'], message: 'Every track requires a protected 0 ms key.' });
  }
  for (let index = 1; index < track.keys.length; index += 1) {
    if (track.keys[index]!.timeMs <= track.keys[index - 1]!.timeMs) {
      context.addIssue({ code: 'custom', path: ['keys', index, 'timeMs'], message: 'Animation keys must be strictly ascending and unique.' });
    }
  }
});

export const TargetLocalPivotSchema = z.object({
  space: z.literal('target-local'),
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
}).strict();

export const CharacterPartTargetBasisSchema = z.object({
  target: AnimationTargetRefSchema,
  visualSource: CharacterPartVisualSourceSchema,
  /** Frozen source-local -> Character-local transform; no runtime composition here. */
  baseTransform: CharacterPartTransformSchema,
  pivot: TargetLocalPivotSchema,
  drawOrder: z.number().int().nonnegative().max(1_000_000),
  visible: z.boolean(),
  displayName: NameSchema.optional(),
}).strict();

function targetIdentity(target: AnimationTargetRef): string {
  return JSON.stringify([target.kind, target.layerId, target.partId]);
}

export const AnimationClipV0Schema = z.object({
  version: z.literal(1),
  fixedCharacterCenter: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
  targetBases: z.array(CharacterPartTargetBasisSchema),
  tracks: z.array(AnimationTrackSchema),
}).strict().superRefine((clip, context) => {
  const bases = new Set<string>();
  clip.targetBases.forEach((basis, index) => {
    const identity = targetIdentity(basis.target);
    if (bases.has(identity)) {
      context.addIssue({ code: 'custom', path: ['targetBases', index, 'target'], message: 'Duplicate target basis.' });
    }
    bases.add(identity);
  });
  const tracks = new Set<string>();
  clip.tracks.forEach((track, index) => {
    const target = targetIdentity(track.target);
    const identity = JSON.stringify([target, track.property]);
    if (tracks.has(identity)) {
      context.addIssue({ code: 'custom', path: ['tracks', index], message: 'Duplicate target + property track.' });
    }
    tracks.add(identity);
    if (!bases.has(target)) {
      context.addIssue({ code: 'custom', path: ['tracks', index, 'target'], message: 'Animation track requires a matching target basis.' });
    }
  });
});

export type AnimationTargetRef = z.infer<typeof AnimationTargetRefSchema>;
export type AnimationProperty = z.infer<typeof AnimationPropertySchema>;
export type AnimationInterpolation = z.infer<typeof AnimationInterpolationSchema>;
export type AnimationKey = z.infer<typeof AnimationKeySchema>;
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;
export type TargetLocalPivot = z.infer<typeof TargetLocalPivotSchema>;
export type CharacterPartTargetBasis = z.infer<typeof CharacterPartTargetBasisSchema>;
export type AnimationClipV0 = z.infer<typeof AnimationClipV0Schema>;
