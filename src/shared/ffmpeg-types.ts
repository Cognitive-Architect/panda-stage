import { z } from 'zod';
import { EXPORT_FPS } from './export-types';

const Mp4OutputPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => /\.mp4$/iu.test(value), {
    message: '视频输出路径必须使用 .mp4 扩展名。',
  });

export const EncodePngSequenceRequestSchema = z
  .object({
    framesDirectory: z.string().trim().min(1),
    outputPath: Mp4OutputPathSchema,
    fps: z.literal(EXPORT_FPS),
    overwrite: z.boolean().default(true),
  })
  .strict();

export const MuxSingleAudioRequestSchema = z
  .object({
    videoPath: z.string().trim().min(1),
    audioPath: z.string().trim().min(1),
    startMs: z.number().int().nonnegative(),
    outputPath: Mp4OutputPathSchema,
    overwrite: z.boolean().default(true),
  })
  .strict();

export const VideoProbeExpectationSchema = z
  .object({
    codecName: z.literal('h264'),
    pixelFormat: z.literal('yuv420p'),
    width: z.literal(1_920),
    height: z.literal(1_080),
    fps: z.literal(EXPORT_FPS),
    frameCount: z.number().int().positive(),
    durationSeconds: z.number().positive(),
    durationToleranceSeconds: z.number().positive().default(0.08),
    requireSilent: z.boolean().default(true),
  })
  .strict();

export const MuxProbeExpectationSchema = z
  .object({
    videoCodecName: z.literal('h264'),
    pixelFormat: z.literal('yuv420p'),
    width: z.literal(1_920),
    height: z.literal(1_080),
    fps: z.literal(EXPORT_FPS),
    frameCount: z.number().int().positive(),
    audioCodecName: z.literal('aac'),
    audioSampleRate: z.number().int().positive(),
    audioChannels: z.number().int().positive(),
    videoDurationSeconds: z.number().positive(),
    audioDurationSeconds: z.number().positive(),
    formatDurationSeconds: z.number().positive(),
    durationToleranceSeconds: z.number().positive().default(0.08),
  })
  .strict();

export type EncodePngSequenceRequest = z.input<
  typeof EncodePngSequenceRequestSchema
>;
export type MuxSingleAudioRequest = z.input<
  typeof MuxSingleAudioRequestSchema
>;
export type VideoProbeExpectation = z.input<
  typeof VideoProbeExpectationSchema
>;
export type MuxProbeExpectation = z.input<typeof MuxProbeExpectationSchema>;

export interface VideoProbeResult {
  codecName: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number | null;
  durationSeconds: number;
  hasAudio: boolean;
  audioCodecName: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  audioStartSeconds: number | null;
  audioDurationSeconds: number | null;
  formatDurationSeconds: number;
  raw: unknown;
}

export interface AudioTimingResult {
  leadingSilenceEndSeconds: number;
  silenceStartsSeconds: number[];
  silenceEndsSeconds: number[];
  stderr: string;
}

export interface AudioProbeResult {
  codecName: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  raw: unknown;
}
