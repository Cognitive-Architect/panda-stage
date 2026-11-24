import { z } from 'zod';

export const AnimationSourceRangeSchema = z.object({
  firstFrame: z.number().int().nonnegative(),
  lastFrame: z.number().int().nonnegative(),
}).strict().refine((range) => range.firstFrame <= range.lastFrame, 'Invalid animation source range.');

export type AnimationSourceRange = z.infer<typeof AnimationSourceRangeSchema>;
