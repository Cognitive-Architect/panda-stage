import { z } from 'zod';
import { FiniteNumberSchema } from './common';
import { isValidFrameTime } from '../timeline/frame-grid';

export const AnimationPropertySchema = z.enum([
  'transform.offsetX', 'transform.offsetY', 'transform.rotationDeg',
  'transform.scaleX', 'transform.scaleY',
]);

export const AnimationInterpolationSchema = z.enum([
  'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step',
]);

export const AnimationKeyV32Schema = z.object({
  /** Persisted integer milliseconds on the Project FPS grid (#979). */
  timeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .refine((timeMs) => isValidFrameTime(timeMs), {
      message: 'Animation key time must be on the Project frame grid.',
    }),
  value: FiniteNumberSchema,
  interpolationToNext: AnimationInterpolationSchema,
}).strict();

export const AnimationBezierSchema = z.object({
  x1: FiniteNumberSchema.min(0).max(1),
  y1: FiniteNumberSchema.min(0).max(1),
  x2: FiniteNumberSchema.min(0).max(1),
  y2: FiniteNumberSchema.min(0).max(1),
}).strict().refine(({ x1, x2 }) => x1 <= x2, 'Bézier time handles must be ordered.');

export const AnimationCurveSchema = z.object({
  bezier: AnimationBezierSchema.optional(),
  /** A time slice of the original easing, retained when inserting a key. */
  window: z.tuple([FiniteNumberSchema.min(0).max(1), FiniteNumberSchema.min(0).max(1)]).optional(),
}).strict().refine(({ bezier, window }) => !!bezier || !!window, 'A curve requires handles or a time window.')
  .refine(({ window }) => !window || window[0] < window[1], 'A curve time window must have positive duration.');

export const AnimationKeySchema = AnimationKeyV32Schema.extend({ curveToNext: AnimationCurveSchema.optional() });
