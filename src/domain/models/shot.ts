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

/** AUTO-07B camera modes. Static keeps the historical full-stage framing. */
export const SHOT_CAMERA_MODES = ['static', 'speaker-focus', 'manual'] as const;
export const ShotCameraModeSchema = z.enum(SHOT_CAMERA_MODES);
export type ShotCameraMode = z.infer<typeof ShotCameraModeSchema>;
export const SHOT_CAMERA_MAX_KEYFRAMES = 32;
export const SHOT_CAMERA_MIN_ZOOM = 1;
export const SHOT_CAMERA_MAX_ZOOM = 8;

export const ShotCameraKeyframeSchema = z
  .object({
    timeMs: z.number().int().nonnegative(),
    centerX: z.number().finite(),
    centerY: z.number().finite(),
    zoom: z.number().finite().min(SHOT_CAMERA_MIN_ZOOM).max(SHOT_CAMERA_MAX_ZOOM),
  })
  .strict();

/**
 * The one persisted camera contract per Shot. `manual` keyframes stay stored
 * while other modes are active, so switching modes never destroys authoring.
 */
export const ShotCameraSchema = z
  .object({
    mode: ShotCameraModeSchema,
    keyframes: z
      .array(ShotCameraKeyframeSchema)
      .max(SHOT_CAMERA_MAX_KEYFRAMES),
  })
  .strict()
  .default({ mode: 'static', keyframes: [] });

export const DEFAULT_SHOT_CAMERA: z.infer<typeof ShotCameraSchema> = {
  mode: 'static',
  keyframes: [],
};

/**
 * Strict v16 Shot shape: the last envelope before the project-local Shot
 * template list (v17), the Layer Part pose animation track (v17) and the
 * persisted per-Shot camera track (v18).
 */
export const ShotV16Schema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerV16Schema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

/** Strict v17 Shot shape: v16 plus the optional Layer Part pose track. */
export const ShotV17Schema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerSchema),
    backgroundLayerId: IdSchema.nullable(),
  })
  .strict();

export const ShotSchema = z
  .object({
    ...ShotBaseShape,
    audioClips: z.array(AudioClipSchema),
    layers: z.array(LayerSchema),
    /** The only layer rendered with the background cover contract. */
    backgroundLayerId: IdSchema.nullable(),
    camera: ShotCameraSchema,
  })
  .strict()
  .superRefine((shot, context) => {
    const keyframes = shot.camera.keyframes;
    for (let index = 0; index < keyframes.length; index += 1) {
      const keyframe = keyframes[index]!;
      if (keyframe.timeMs > shot.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['camera', 'keyframes', index, 'timeMs'],
          message: 'Camera keyframe must sit inside the Shot duration.',
        });
      }
      const previous = keyframes[index - 1];
      if (previous && previous.timeMs >= keyframe.timeMs) {
        context.addIssue({
          code: 'custom',
          path: ['camera', 'keyframes', index, 'timeMs'],
          message: 'Camera keyframes must be strictly ordered by time.',
        });
      }
    }
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
