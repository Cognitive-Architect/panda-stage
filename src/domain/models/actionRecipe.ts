import { z } from 'zod';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';

const StepBase = { id: IdSchema, offsetMs: z.number().int().nonnegative() };
const Duration = { durationMs: z.number().int().positive() };

const BuiltinPresetSchema = z.enum([
  'enter-left', 'enter-right', 'move-to', 'scale-emphasis', 'shake', 'fade-in', 'fade-out',
]);

export const ActionRecipeStepSchema = z.discriminatedUnion('kind', [
  z.object({
    ...StepBase, ...Duration, kind: z.literal('preset'), presetId: BuiltinPresetSchema,
    parameters: z.object({
      targetX: FiniteNumberSchema.optional(),
      targetY: FiniteNumberSchema.optional(),
      scaleFactor: FiniteNumberSchema.optional(),
      amplitudeX: FiniteNumberSchema.optional(),
      amplitudeY: FiniteNumberSchema.optional(),
      frequencyHz: FiniteNumberSchema.optional(),
    }).strict().optional(),
  }).strict(),
  z.object({ ...StepBase, ...Duration, kind: z.literal('expression'), preferredName: NameSchema.optional() }).strict(),
  z.object({ ...StepBase, ...Duration, kind: z.literal('action'), preferredName: NameSchema.optional() }).strict(),
  z.object({ ...StepBase, kind: z.literal('motion'), presetId: IdSchema }).strict(),
]);

export const ActionRecipeSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  steps: z.array(ActionRecipeStepSchema).min(1).max(32).refine(
    (steps) => new Set(steps.map(({ id }) => id)).size === steps.length,
    'Recipe step IDs must be unique.',
  ),
}).strict();

export type ActionRecipe = z.infer<typeof ActionRecipeSchema>;
export type ActionRecipeStep = z.infer<typeof ActionRecipeStepSchema>;
