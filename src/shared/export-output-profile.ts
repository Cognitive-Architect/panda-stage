import { z } from 'zod';

export const ExportOutputFpsSchema = z.union([z.literal(24), z.literal(30), z.literal(60)]);
export type ExportOutputFps = z.infer<typeof ExportOutputFpsSchema>;
export const ExportVideoFormatSchema = z.enum(['mp4', 'webm', 'gif']);
export type ExportVideoFormat = z.infer<typeof ExportVideoFormatSchema>;

export const ExportVideoOptionsSchema = z.object({
  width: z.union([z.literal(1280), z.literal(1920)]),
  fps: ExportOutputFpsSchema,
}).strict();

export type ExportVideoOptions = z.infer<typeof ExportVideoOptionsSchema>;
export const DEFAULT_EXPORT_VIDEO_OPTIONS: Readonly<ExportVideoOptions> = Object.freeze({ width: 1920, fps: 24 });

const outputDimensions = [
  z.object({ width: z.literal(1920), height: z.literal(1080) }),
  z.object({ width: z.literal(1280), height: z.literal(720) }),
] as const;

const mp4Codecs = Object.freeze({ format: 'mp4', videoCodec: 'h264', audioCodec: 'aac' } as const);
const webmCodecs = Object.freeze({ format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' } as const);
const gifCodecs = Object.freeze({ format: 'gif', videoCodec: 'gif', audioCodec: null } as const);
const videoSettings = { fps: ExportOutputFpsSchema, format: z.literal('mp4'), videoCodec: z.literal('h264'), audioCodec: z.literal('aac') };
const webmSettings = { fps: ExportOutputFpsSchema, format: z.literal('webm'), videoCodec: z.literal('vp9'), audioCodec: z.literal('opus') };
const gifSettings = {
  fps: z.union([z.literal(24), z.literal(30)]),
  format: z.literal('gif'),
  videoCodec: z.literal('gif'),
  audioCodec: z.null(),
  loop: z.boolean(),
};

export const ExportRenderSettingsSchema = z.union([
  outputDimensions[0].extend(videoSettings).strict(),
  outputDimensions[1].extend(videoSettings).strict(),
  outputDimensions[0].extend(webmSettings).strict(),
  outputDimensions[1].extend(webmSettings).strict(),
  outputDimensions[0].extend(gifSettings).strict(),
  outputDimensions[1].extend(gifSettings).strict(),
  outputDimensions[0].extend({ fps: z.literal(24) }).strict(),
]);

export type ExportRenderSettings = z.infer<typeof ExportRenderSettingsSchema>;

export function freezeMp4OutputProfile(rawOptions = DEFAULT_EXPORT_VIDEO_OPTIONS) {
  const { width, fps } = ExportVideoOptionsSchema.parse(rawOptions);
  return width === 1280
    ? { width, height: 720 as const, fps, ...mp4Codecs }
    : { width, height: 1080 as const, fps, ...mp4Codecs };
}

export function freezeVideoOutputProfile(format: ExportVideoFormat, rawOptions = DEFAULT_EXPORT_VIDEO_OPTIONS, loop = true): ExportRenderSettings {
  const base = freezeMp4OutputProfile(rawOptions);
  if (format === 'mp4') return base;
  if (format === 'webm') return { ...base, ...webmCodecs };
  return { ...base, ...gifCodecs, fps: base.fps === 60 ? 30 : base.fps, loop };
}
