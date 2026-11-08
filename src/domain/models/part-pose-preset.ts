import { z } from 'zod';
import { CharacterPartTransformSchema } from './character';
import { IdSchema, IsoDateTimeSchema, NameSchema } from './common';
import {
  PartPoseKeyframeSchema,
  PartPosePointSchema,
} from './pose-animation';

/**
 * One saved user Part pose action. Stores only references and parameters:
 * relative-time keyframes, the fixed pivot and the source rest-pose snapshot
 * of the Character the motion was authored on. No image or FLA frame data is
 * duplicated; applying re-creates an independent trajectory on the target
 * instance through the shared Part pose engine.
 */
export const PartPosePresetTrackSchema = z
  .object({
    /** Character Part identity; both instances of one Character share it. */
    partId: z.string().min(1),
    keys: z.array(PartPoseKeyframeSchema).min(1),
    /** Fixed pivot in the uncropped source-image pixel coordinates. */
    pivotSource: PartPosePointSchema,
    /**
     * The rest pose the deltas were authored against; applying refuses the
     * preset when the target Character's current rest pose differs.
     */
    sourceRestTransform: CharacterPartTransformSchema,
  })
  .strict()
  .superRefine((track, context) => {
    const first = track.keys[0];
    if (first?.timeMs !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['keys', 0, 'timeMs'],
        message: 'Every preset track requires the protected 0 ms key.',
      });
    }
    for (let index = 1; index < track.keys.length; index += 1) {
      if (track.keys[index]!.timeMs <= track.keys[index - 1]!.timeMs) {
        context.addIssue({
          code: 'custom',
          path: ['keys', index, 'timeMs'],
          message: 'Preset keyframes must be strictly ascending and unique.',
        });
      }
    }
  });

export const PartPoseActionPresetSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    /** Presets only ever apply to instances of this Character. */
    characterId: IdSchema,
    /** Relative motion length from 0 ms; equals the last key time. */
    durationMs: z.number().int().positive(),
    sourceRootTransform: CharacterPartTransformSchema,
    fixedCharacterCenter: PartPosePointSchema,
    tracks: z.array(PartPosePresetTrackSchema).min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((preset, context) => {
    const partIds = new Set<string>();
    preset.tracks.forEach((track, index) => {
      if (partIds.has(track.partId)) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'partId'],
          message: `Duplicate preset Part track: ${track.partId}`,
        });
      }
      partIds.add(track.partId);
    });
    const lastKey = preset.tracks
      .flatMap((track) => track.keys)
      .reduce((latest, key) => Math.max(latest, key.timeMs), 0);
    if (lastKey !== preset.durationMs) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Preset duration must equal the latest keyframe time.',
      });
    }
  });

export type PartPosePresetTrack = z.infer<typeof PartPosePresetTrackSchema>;
export type PartPoseActionPreset = z.infer<typeof PartPoseActionPresetSchema>;
