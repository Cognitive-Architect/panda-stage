import { z } from 'zod';

export const ExportPreferencesSchema = z.object({
  format: z.enum(['mp4', 'png-sequence']),
  rangeMode: z.enum(['shot', 'range']),
  transparent: z.boolean(),
}).strict();

export type ExportPreferences = z.infer<typeof ExportPreferencesSchema>;

export const DEFAULT_EXPORT_PREFERENCES: Readonly<ExportPreferences> = Object.freeze({
  format: 'mp4', rangeMode: 'shot', transparent: true,
});
