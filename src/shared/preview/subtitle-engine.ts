import { z } from 'zod';

export const SubtitleCueSchema = z
  .object({
    id: z.uuid(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().trim().min(1).max(500),
    styleId: z.uuid().optional(),
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

/**
 * Dialogue authoring rejects new overlaps, but legacy projects can still
 * contain them. Keep one stable winner for every renderer and preview caller:
 * latest start, then latest end, then the binary id order.
 */
export function compareSubtitleCuePriority(
  left: Pick<SubtitleCue, 'startMs' | 'endMs' | 'id'>,
  right: Pick<SubtitleCue, 'startMs' | 'endMs' | 'id'>,
): number {
  const idOrder = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return right.startMs - left.startMs || right.endMs - left.endMs || idOrder;
}

export function evaluateSubtitleAtTime(
  cues: readonly SubtitleCue[],
  timeMs: number,
): SubtitleCue | null {
  const parsedTimeMs = z.number().int().nonnegative().parse(timeMs);
  return (
    cues
      .filter(
        (cue) => parsedTimeMs >= cue.startMs && parsedTimeMs < cue.endMs,
      )
      .sort(compareSubtitleCuePriority)[0] ?? null
  );
}
