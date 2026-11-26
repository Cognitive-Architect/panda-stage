import { z } from 'zod';
import { AnimationCurveSchema, AnimationInterpolationSchema, AnimationKeySchema } from './animationKeys';
import { FiniteNumberSchema } from './common';

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

export const ShotCameraModeSchema = z.enum(['static', 'speaker-focus', 'manual']);
export const ShotCameraSchema = z.object({
  mode: ShotCameraModeSchema,
  keys: z.array(ShotCameraKeySchema),
}).strict();

export type ManualCameraPose = z.infer<typeof ManualCameraPoseSchema>;
export type ShotCameraMode = z.infer<typeof ShotCameraModeSchema>;
export type ShotCameraKey = z.infer<typeof ShotCameraKeySchema>;
