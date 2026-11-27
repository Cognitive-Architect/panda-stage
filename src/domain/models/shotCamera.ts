import { z } from 'zod';
import { AnimationCurveSchema, AnimationInterpolationSchema, AnimationKeySchema } from './animationKeys';
import { FiniteNumberSchema, IdSchema } from './common';

export const ManualCameraPoseSchema = z.object({
  centerX: FiniteNumberSchema,
  centerY: FiniteNumberSchema,
  zoom: FiniteNumberSchema.positive(),
  rotationDeg: FiniteNumberSchema,
}).strict();

export const ShotCameraKeySchema = ManualCameraPoseSchema.extend({
  timeMs: AnimationKeySchema.shape.timeMs,
  interpolationToNext: AnimationInterpolationSchema,
  curveToNext: AnimationCurveSchema.optional(),
});

/** Frozen v43–v45 camera contract before hybrid mode and manual override intervals. */
export const ShotCameraModeV45Schema = z.enum(['static', 'speaker-focus', 'manual']);
export const ShotCameraV45Schema = z.object({
  mode: ShotCameraModeV45Schema,
  keys: z.array(ShotCameraKeySchema),
}).strict();

export const ShotCameraOverrideSchema = z.object({
  id: IdSchema,
  startMs: AnimationKeySchema.shape.timeMs,
  endMs: FiniteNumberSchema.int().positive(),
  blendInMs: FiniteNumberSchema.int().nonnegative().default(250),
  blendOutMs: FiniteNumberSchema.int().nonnegative().default(250),
  easingIn: AnimationInterpolationSchema.optional(),
  easingOut: AnimationInterpolationSchema.optional(),
  curveIn: AnimationCurveSchema.optional(),
  curveOut: AnimationCurveSchema.optional(),
}).strict().superRefine((override, context) => {
  if (override.endMs <= override.startMs) {
    context.addIssue({
      code: 'custom',
      path: ['endMs'],
      message: 'Camera override endMs must be greater than startMs.',
    });
  }
});

export const ShotCameraAutoFramingSchema = z.object({
  zoom: FiniteNumberSchema.min(1).optional(),
  targetU: FiniteNumberSchema.min(0).max(1).optional(),
  targetV: FiniteNumberSchema.min(0).max(1).optional(),
}).strict();

export const ShotCameraModeSchema = z.enum(['static', 'speaker-focus', 'manual', 'hybrid']);
export const ShotCameraSchema = z.object({
  mode: ShotCameraModeSchema,
  keys: z.array(ShotCameraKeySchema),
  overrides: z.array(ShotCameraOverrideSchema).optional(),
  autoFraming: ShotCameraAutoFramingSchema.optional(),
}).strict();

export type ManualCameraPose = z.infer<typeof ManualCameraPoseSchema>;
export type ShotCameraModeV45 = z.infer<typeof ShotCameraModeV45Schema>;
export type ShotCameraV45 = z.infer<typeof ShotCameraV45Schema>;
export type ShotCameraMode = z.infer<typeof ShotCameraModeSchema>;
export type ShotCameraKey = z.infer<typeof ShotCameraKeySchema>;
export type ShotCameraOverride = z.infer<typeof ShotCameraOverrideSchema>;
export type ShotCameraAutoFraming = z.infer<typeof ShotCameraAutoFramingSchema>;
export type ShotCamera = z.infer<typeof ShotCameraSchema>;
