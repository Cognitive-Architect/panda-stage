import { z } from 'zod';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
} from '../constants';
import { FiniteNumberSchema, IdSchema } from './common';
import {
  CharacterPartSchema,
  CharacterPartStaticAdjustmentSchema,
  CharacterPartTransformSchema,
} from './character';

export const PartPoseEasingSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
]);

export const PartPosePointSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  })
  .strict();

export const PartPoseKeyframeSchema = z
  .object({
    /** Absolute zero-based frame index on the Project FPS grid. */
    frame: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Character-local translation applied after the source/root transforms. */
    offsetX: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    offsetY: FiniteNumberSchema.min(-1_000_000).max(1_000_000),
    /** Authored continuous angle; the evaluator never wraps to a shortest arc. */
    rotationDeg: FiniteNumberSchema,
    scale: FiniteNumberSchema.min(CHARACTER_PART_MIN_SCALE).max(
      CHARACTER_PART_MAX_SCALE,
    ),
    easingToNext: PartPoseEasingSchema,
  })
  .strict();

const PosePartSnapshotSchema = CharacterPartSchema.extend({
  // New animation snapshots are complete even when they originate in a legacy
  // v15 Character whose source-rest fields were optional.
  sourceRestTransform: CharacterPartTransformSchema,
  staticAdjustment: CharacterPartStaticAdjustmentSchema,
});

export const PartPoseTrackSchema = PosePartSnapshotSchema.extend({
  /** Pivot in the full, uncropped source-image pixel coordinate system. */
  pivotSource: PartPosePointSchema,
  keys: z.array(PartPoseKeyframeSchema).min(1),
})
  .strict()
  .superRefine((track, context) => {
    const crop = track.imageMapping.crop;
    if (
      track.pivotSource.x < crop.x ||
      track.pivotSource.x > crop.x + crop.width ||
      track.pivotSource.y < crop.y ||
      track.pivotSource.y > crop.y + crop.height
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pivotSource'],
        message: 'Part pivot must lie within its captured source crop.',
      });
    }

    const first = track.keys[0];
    if (first?.frame !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['keys', 0, 'frame'],
        message: 'Every Part pose track requires a protected frame-zero key.',
      });
    }
    if (
      first &&
      (first.offsetX !== 0 ||
        first.offsetY !== 0 ||
        first.rotationDeg !== 0 ||
        first.scale !== 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['keys', 0],
        message: 'The protected frame-zero key must preserve the captured pose.',
      });
    }

    for (let index = 1; index < track.keys.length; index += 1) {
      if (track.keys[index]!.frame <= track.keys[index - 1]!.frame) {
        context.addIssue({
          code: 'custom',
          path: ['keys', index, 'frame'],
          message: 'Part pose keyframes must be strictly ascending and unique.',
        });
      }
    }
  });

export const PartPoseAnimationSchema = z
  .object({
    version: z.literal(1),
    characterId: IdSchema,
    sourceRootTransform: CharacterPartTransformSchema,
    /** Stable local origin captured from the original source-pose bounds. */
    fixedCharacterCenter: PartPosePointSchema,
    /** One immutable source snapshot and one key track for every Part. */
    tracks: z.array(PartPoseTrackSchema).min(1),
  })
  .strict()
  .superRefine((animation, context) => {
    const partIds = new Set<string>();
    const sourceIds = new Set<string>();

    animation.tracks.forEach((track, index) => {
      if (partIds.has(track.partId)) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'partId'],
          message: `Duplicate Part pose track: ${track.partId}`,
        });
      }
      partIds.add(track.partId);
      if (sourceIds.has(track.source.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'source', 'sourceId'],
          message: `Duplicate Part source identity: ${track.source.sourceId}`,
        });
      }
      sourceIds.add(track.source.sourceId);
      if (track.drawOrder !== index) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'drawOrder'],
          message: 'Part pose snapshots must preserve contiguous draw order.',
        });
      }
    });
  });

export type PartPoseEasing = z.infer<typeof PartPoseEasingSchema>;
export type PartPosePoint = z.infer<typeof PartPosePointSchema>;
export type PartPoseKeyframe = z.infer<typeof PartPoseKeyframeSchema>;
export type PartPoseTrack = z.infer<typeof PartPoseTrackSchema>;
export type PartPoseAnimation = z.infer<typeof PartPoseAnimationSchema>;
