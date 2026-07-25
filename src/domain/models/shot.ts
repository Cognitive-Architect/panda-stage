import { z } from 'zod';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { AudioClipSchema } from './audio';
import { IdSchema, NameSchema } from './common';
import { DialogueSchema } from './dialogue';
import { LayerSchema } from './layer';
import { TimelineEventSchema } from './timeline-event';

export const ShotSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    durationMs: z.number().int().min(SHOT_MIN_DURATION_MS),
    defaultSubtitleStyleId: IdSchema,
    layers: z.array(LayerSchema),
    dialogues: z.array(DialogueSchema),
    audioClips: z.array(AudioClipSchema),
    timelineEvents: z.array(TimelineEventSchema),
  })
  .strict();

export type Shot = z.infer<typeof ShotSchema>;
