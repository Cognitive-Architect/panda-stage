import { z } from 'zod';

export const UnsavedCloseChoiceSchema = z.enum([
  'save',
  'discard',
  'cancel',
]);

export const UnsavedCloseOutcomeSchema = z.enum([
  'allow-close',
  'cancelled',
  'save-failed',
]);

export type UnsavedCloseChoice = z.infer<
  typeof UnsavedCloseChoiceSchema
>;
export type UnsavedCloseOutcome = z.infer<
  typeof UnsavedCloseOutcomeSchema
>;
