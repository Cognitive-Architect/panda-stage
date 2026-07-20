import { z } from 'zod';

export const SubtitleCueSchema = z
  .object({
    id: z.uuid(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(500),
  })
  .refine((cue) => cue.endMs > cue.startMs, {
    message: 'Subtitle cue endMs must be greater than startMs.',
  });

export const SubtitleTrackSchema = z
  .array(SubtitleCueSchema)
  .superRefine((cues, context) => {
    const sorted = [...cues].sort((left, right) => left.startMs - right.startMs);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous && current && current.startMs < previous.endMs) {
        context.addIssue({
          code: 'custom',
          message: 'Subtitle cues cannot overlap.',
          path: [index, 'startMs'],
        });
      }
    }
  });

export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

export function evaluateSubtitleAtTime(
  cues: readonly SubtitleCue[],
  timeMs: number,
): SubtitleCue | null {
  const parsedTimeMs = z.number().int().nonnegative().parse(timeMs);
  return (
    cues.find(
      (cue) => parsedTimeMs >= cue.startMs && parsedTimeMs < cue.endMs,
    ) ?? null
  );
}
