import { z } from 'zod';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import { LayerSchema } from './layer';
import { TimelineEventSchema } from './timeline-event';

/**
 * A project-local snapshot of a Shot's scene structure.
 *
 * AUTO-03 V0 (Issue #1003) keeps the reusable part of a Shot — duration,
 * stage layers, background identity and timeline structure — and drops the
 * episode-specific `dialogues` / `audioClips`. The template owns its own
 * Layer and TimelineEvent IDs, so it never depends on the source Shot still
 * existing, and instantiating it always allocates fresh instance IDs.
 */
export const ShotTemplateSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    createdAt: IsoDateTimeSchema,
    durationMs: z.number().int().min(SHOT_MIN_DURATION_MS),
    defaultSubtitleStyleId: IdSchema,
    layers: z.array(LayerSchema),
    backgroundLayerId: IdSchema.nullable(),
    timelineEvents: z.array(TimelineEventSchema).default([]),
  })
  .strict();

export type ShotTemplate = z.infer<typeof ShotTemplateSchema>;
