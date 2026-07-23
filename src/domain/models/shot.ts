import { z } from 'zod';
import { AudioClipSchema } from './audio';
import { IdSchema, NameSchema, PositiveMillisecondsSchema } from './common';
import { DialogueSchema } from './dialogue';
import { LayerSchema } from './layer';
import { TimelineEventSchema } from './timeline-event';

export const ShotSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    durationMs: PositiveMillisecondsSchema,
    defaultSubtitleStyleId: IdSchema,
    layers: z.array(LayerSchema),
    dialogues: z.array(DialogueSchema),
    audioClips: z.array(AudioClipSchema),
    timelineEvents: z.array(TimelineEventSchema),
  })
  .strict();

export type Shot = z.infer<typeof ShotSchema>;
