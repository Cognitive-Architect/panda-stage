import { z } from 'zod';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { AudioClipSchema, AudioClipV7Schema } from './audio';
import { IdSchema, NameSchema } from './common';
import { DialogueSchema } from './dialogue';
import {
  LayerSchema,
  LayerV14Schema,
  LayerV16Schema,
  LayerV15AdaptiveSchema,
  LayerV15AnimationSchema,
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

/** Exact persisted v16 shot contract before Graphic instance layer fields. */
export const ShotV16Schema = ShotSchema.extend({
  layers: z.array(LayerV16Schema),
});

/** Strict animation-era v15 shot shape before persisted playback settings. */
export const ShotV15AnimationSchema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerV15AnimationSchema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

/** Strict origin/main v15 shot shape with Adaptive Parts layer references. */
export const ShotV15AdaptiveSchema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerV15AdaptiveSchema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

/** Backward-compatible name for the PR branch's historical v15 contract. */
export const ShotV15Schema = ShotV15AnimationSchema;

/** Exact persisted v14 shot shape, retained for the v14 -> v16 migration. */
export const ShotV14Schema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerV14Schema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

/** Historical v7+ shot shape before current animation and Adaptive Parts layers. */
export const ShotV7Schema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipV7Schema),
    layers: z.array(LayerV14Schema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

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
