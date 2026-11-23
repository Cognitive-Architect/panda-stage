import { z } from 'zod';
import { AnimationSourceRangeSchema } from './animationSourceRange';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';
import { AnimationPlaybackSchema } from './layer';

export const ReusableAnimationSegmentSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  animationId: IdSchema,
  range: AnimationSourceRangeSchema,
  playback: AnimationPlaybackSchema,
  position: z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema }).strict(),
}).strict();

export type ReusableAnimationSegment = z.infer<typeof ReusableAnimationSegmentSchema>;
