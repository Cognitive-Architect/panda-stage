import { z } from 'zod';
import { ExportVideoOptionsSchema } from '../../shared/export-output-profile';

export const ExportPreferencesSchema = z.object({
  format: z.enum(['mp4', 'png-sequence', 'sprite-sheet']),
  rangeMode: z.enum(['shot', 'range']),
  transparent: z.boolean(),
  videoOutput: ExportVideoOptionsSchema.optional(),
}).strict();

export type ExportPreferences = z.infer<typeof ExportPreferencesSchema>;

export const DEFAULT_EXPORT_PREFERENCES: Readonly<ExportPreferences> = Object.freeze({
  format: 'mp4', rangeMode: 'shot', transparent: true,
});
