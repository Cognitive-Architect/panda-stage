import { z } from 'zod';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { AudioClipSchema, AudioClipV7Schema } from './audio';
import { IdSchema, NameSchema } from './common';
import { DialogueSchema } from './dialogue';
import {
  LayerSchema,
  LayerV3Schema,
  LayerV4Schema,
} from './layer';
import { TimelineEventSchema } from './timeline-event';

const ShotBaseShape = {
  id: IdSchema,
  name: NameSchema,
  durationMs: z.number().int().min(SHOT_MIN_DURATION_MS),
  defaultSubtitleStyleId: IdSchema,
  dialogues: z.array(DialogueSchema),
  audioClips: z.array(AudioClipV7Schema),
  timelineEvents: z.array(TimelineEventSchema).default([]),
};

export const ShotV2Schema = z
  .object({
    ...ShotBaseShape,
    layers: z.array(LayerV3Schema),
  })
  .strict();

export const ShotSchema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerSchema),
    /** The only layer rendered with the background cover contract. */
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

export const ShotV7Schema = ShotSchema.extend({
  audioClips: z.array(AudioClipV7Schema),
});

export const ShotV3Schema = z
  .object({
    ...ShotBaseShape,
    layers: z.array(LayerV3Schema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

export const ShotV4Schema = z
  .object({
    ...ShotBaseShape,
    layers: z.array(LayerV4Schema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

export type Shot = z.infer<typeof ShotSchema>;
