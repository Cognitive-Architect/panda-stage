import { z } from 'zod';

export const DialogueSilenceIntervalsSchema = z.array(
  z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
).max(2_048).refine(intervals => intervals.every(([start, end], index) =>
  start < end && (index === 0 || intervals[index - 1]![1] <= start),
), 'Silence intervals must be sorted and disjoint.');

const DialogueSilenceEntrySchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  intervals: DialogueSilenceIntervalsSchema,
}).strict();

export const DialogueSilenceSchema = z.record(z.uuid(), DialogueSilenceEntrySchema);
export type DialogueSilence = z.infer<typeof DialogueSilenceSchema>;
export type DialogueSilenceIntervals = z.infer<typeof DialogueSilenceIntervalsSchema>;
