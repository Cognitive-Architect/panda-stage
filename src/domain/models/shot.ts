import { z } from 'zod';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { AudioClipSchema, AudioClipV7Schema, AudioClipV22Schema } from './audio';
import { IdSchema, NameSchema } from './common';
import { DialogueSchema, DialogueV18Schema, DialogueV22Schema } from './dialogue';
import {
  LayerSchema,
  LayerV30Schema,
  LayerV32Schema,
  LayerV41Schema,
  LayerV42Schema,
  LayerV22Schema,
  LayerV21Schema,
  LayerV20Schema,
  LayerV14Schema,
  LayerV16Schema,
  LayerV15AdaptiveSchema,
  LayerV15AnimationSchema,
  LayerV3Schema,
  LayerV4Schema,
} from './layer';
import { TimelineEventSchema, TimelineEventV22Schema, TimelineEventV26Schema, TimelineEventV27Schema, TimelineEventV28Schema, TimelineEventV33Schema, TimelineEventV40Schema } from './timeline-event';
import { ShotCameraSchema } from './shotCamera';

const ShotIdentityShape = {
  id: IdSchema,
  name: NameSchema,
  durationMs: z.number().int().min(SHOT_MIN_DURATION_MS),
  defaultSubtitleStyleId: IdSchema,
};

const ShotBaseShape = {
  ...ShotIdentityShape,
  dialogues: z.array(DialogueV18Schema),
  audioClips: z.array(AudioClipV7Schema),
  timelineEvents: z.array(TimelineEventV22Schema).default([]),
};

export const ShotV2Schema = z
  .object({
    ...ShotBaseShape,
    layers: z.array(LayerV3Schema),
  })
  .strict();

/** Frozen v20 Shot reader. */
export const ShotV20Schema = z
  .object({
    ...ShotBaseShape,
    dialogues: z.array(DialogueSchema),
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerV20Schema),
    /** The only layer rendered with the background cover contract. */
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

function validateShotClipKeyTimes(
  shot: { durationMs: number; layers: readonly { animationClip?: { tracks: readonly { keys: readonly { timeMs: number }[] }[] } }[] },
  context: z.RefinementCtx,
): void {
  shot.layers.forEach((layer, layerIndex) => {
    layer.animationClip?.tracks.forEach((track, trackIndex) => {
      track.keys.forEach((key, keyIndex) => {
        if (key.timeMs > shot.durationMs) {
          context.addIssue({
            code: 'custom',
            path: ['layers', layerIndex, 'animationClip', 'tracks', trackIndex, 'keys', keyIndex, 'timeMs'],
            message: 'Animation key must be within the owning Shot duration.',
          });
        }
      });
    });
  });
}

/** Frozen v21 Shot reader: preserves Character Clip v1 bounds checks. */
export const ShotV21Schema = ShotV20Schema.extend({
  layers: z.array(LayerV21Schema),
}).superRefine(validateShotClipKeyTimes);

/** Frozen v22 Shot reader with full clip key time validation. */
export const ShotV22Schema = z.object({
  ...ShotIdentityShape,
  dialogues: z.array(DialogueV22Schema),
  audioClips: z.array(AudioClipV22Schema),
  timelineEvents: z.array(TimelineEventV22Schema).default([]),
  layers: z.array(LayerV22Schema),
  backgroundLayerId: IdSchema.nullable(),
}).strict().superRefine(validateShotClipKeyTimes);

export const ShotV26Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV26Schema).default([]),
  layers: z.array(LayerV30Schema),
}).superRefine(validateShotClipKeyTimes);

/** Frozen v27 Shot reader before bounded Character action events. */
export const ShotV27Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV27Schema).default([]),
  layers: z.array(LayerV30Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV28Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV28Schema).default([]),
  layers: z.array(LayerV30Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV30Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV33Schema).default([]),
  layers: z.array(LayerV30Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV32Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV33Schema).default([]),
  layers: z.array(LayerV32Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV33Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV33Schema).default([]),
  layers: z.array(LayerV41Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV40Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventV40Schema).default([]),
  layers: z.array(LayerV41Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV41Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventSchema).default([]),
  layers: z.array(LayerV41Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotV42Schema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventSchema).default([]),
  layers: z.array(LayerV42Schema),
}).superRefine(validateShotClipKeyTimes);

export const ShotSchema = ShotV20Schema.extend({
  timelineEvents: z.array(TimelineEventSchema).default([]),
  layers: z.array(LayerSchema),
  camera: ShotCameraSchema.optional(),
}).superRefine(validateShotClipKeyTimes).superRefine((shot, context) => {
  shot.layers.forEach((layer, layerIndex) => layer.layerMotionTracks?.forEach((track, trackIndex) =>
    track.keys.forEach((key, keyIndex) => {
      if (key.timeMs > shot.durationMs) context.addIssue({
        code: 'custom', path: ['layers', layerIndex, 'layerMotionTracks', trackIndex, 'keys', keyIndex, 'timeMs'],
        message: 'Animation key must be within the owning Shot duration.',
      });
    })));
  shot.camera?.keys.forEach((key, index, keys) => {
    if (key.timeMs > shot.durationMs || (index > 0 && key.timeMs <= keys[index - 1]!.timeMs)) {
      context.addIssue({
        code: 'custom',
        path: ['camera', 'keys', index, 'timeMs'],
        message: 'Camera keys must be ordered, unique and within the Shot duration.',
      });
    }
  });
});

/** v19 has the same Shot fields as v20; freeze its reader independently. */
export const ShotV19Schema = z.object({
  ...ShotBaseShape,
  dialogues: z.array(DialogueSchema),
  audioClips: z.array(AudioClipSchema),
  layers: z.array(LayerV20Schema),
  backgroundLayerId: IdSchema.nullable(),
}).strict();

/** Exact pre-narrator v18 Shot, also used by earlier frozen Shot contracts. */
export const ShotV18Schema = ShotV19Schema.extend({
  dialogues: z.array(DialogueV18Schema),
}).strict();

/** Exact persisted v16 shot contract before Graphic instance layer fields. */
export const ShotV16Schema = ShotV18Schema.extend({
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
