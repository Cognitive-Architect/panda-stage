import { z } from 'zod';

const AudioClipIdSchema = z.uuid();
const AudioAssetIdSchema = z.uuid();
const AudioRoleSchema = z.enum(['dialogue', 'bgm', 'sfx']);
const AudioPathSchema = z.string().trim().min(1).max(32_767);
const MillisecondsSchema = z.number().int().nonnegative();
const GainSchema = z.number().finite().min(0).max(2);

export const ExportAudioClipInputSchema = z
  .object({
    clipId: AudioClipIdSchema,
    assetId: AudioAssetIdSchema,
    role: AudioRoleSchema,
    sourcePath: AudioPathSchema,
    startMs: MillisecondsSchema,
    endMs: MillisecondsSchema,
    offsetMs: MillisecondsSchema,
    volume: GainSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    if (clip.endMs < clip.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Audio clip endMs must not be before startMs.',
        path: ['endMs'],
      });
    }
  });

export const ExportAudioMixPlanClipSchema = z
  .object({
    clipId: AudioClipIdSchema,
    assetId: AudioAssetIdSchema,
    role: AudioRoleSchema,
    sourcePath: AudioPathSchema,
    startMs: MillisecondsSchema,
    endMs: MillisecondsSchema,
    sourceOffsetMs: MillisecondsSchema,
    volume: GainSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    if (clip.endMs <= clip.startMs) {
      context.addIssue({
        code: 'custom',
        message: 'Audio mix plan clips must have a positive duration.',
        path: ['endMs'],
      });
    }
  });

export const ExportAudioMixPlanSchema = z
  .object({
    durationMs: MillisecondsSchema.positive(),
    clips: z.array(ExportAudioMixPlanClipSchema),
  })
  .strict()
  .superRefine((plan, context) => {
    plan.clips.forEach((clip, index) => {
      if (clip.endMs > plan.durationMs) {
        context.addIssue({
          code: 'custom',
          message: 'Audio mix plan clips must end within the export range.',
          path: ['clips', index, 'endMs'],
        });
      }
    });
  });

export type ExportAudioClipInput = z.infer<typeof ExportAudioClipInputSchema>;
export type ExportAudioMixPlanClip = z.infer<
  typeof ExportAudioMixPlanClipSchema
>;
export type ExportAudioMixPlan = z.infer<typeof ExportAudioMixPlanSchema>;
