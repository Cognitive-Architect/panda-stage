import { z } from 'zod';
import { AnimationCurveSchema, AnimationInterpolationSchema, AnimationPropertySchema } from './animationCore';
import { FiniteNumberSchema, IdSchema, NameSchema } from './common';

const PresetKeyV32Schema = z.object({
  frameOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  value: FiniteNumberSchema,
  interpolationToNext: AnimationInterpolationSchema,
}).strict();

const PresetKeySchema = PresetKeyV32Schema.extend({ curveToNext: AnimationCurveSchema.optional() });
const PresetTrackSchema = z.object({
  property: AnimationPropertySchema,
  keys: z.array(PresetKeySchema).min(2),
}).strict();

export const UserMotionPresetSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  durationFrames: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  tracks: z.array(PresetTrackSchema).min(1).max(AnimationPropertySchema.options.length),
}).strict().superRefine((preset, context) => {
  const properties = new Set<string>();
  preset.tracks.forEach(({ property, keys }, trackIndex) => {
    if (properties.has(property)) {
      context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'property'], message: 'Preset properties must be unique.' });
    }
    properties.add(property);
    if (keys[0]?.frameOffset !== 0 || keys.at(-1)?.frameOffset !== preset.durationFrames) {
      context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'keys'], message: 'Preset tracks require both range boundaries.' });
    }
    const scale = property === 'transform.scaleX' || property === 'transform.scaleY';
    keys.forEach((key, index) => {
      if ((index > 0 && key.frameOffset <= keys[index - 1]!.frameOffset) || (scale && key.value <= 0)) {
        context.addIssue({ code: 'custom', path: ['tracks', trackIndex, 'keys', index], message: 'Invalid relative motion key.' });
      }
    });
  });
});

export const UserMotionPresetV32Schema = UserMotionPresetSchema.safeExtend({
  tracks: z.array(PresetTrackSchema.extend({ keys: z.array(PresetKeyV32Schema).min(2) }))
    .min(1).max(AnimationPropertySchema.options.length),
});

export type UserMotionPreset = z.infer<typeof UserMotionPresetSchema>;
