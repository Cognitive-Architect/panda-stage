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
  'discard-failed',
]);

export const UnsavedChangesIntentSchema = z.enum(['close', 'switch']);

export const UnsavedChangesResolutionSchema = z.enum([
  'clean',
  'saved',
  'discarded',
  'cancelled',
  'save-failed',
  'discard-failed',
]);

export type UnsavedCloseChoice = z.infer<
  typeof UnsavedCloseChoiceSchema
>;
export type UnsavedCloseOutcome = z.infer<
  typeof UnsavedCloseOutcomeSchema
>;
export type UnsavedChangesIntent = z.infer<
  typeof UnsavedChangesIntentSchema
>;
export type UnsavedChangesResolution = z.infer<
  typeof UnsavedChangesResolutionSchema
>;
