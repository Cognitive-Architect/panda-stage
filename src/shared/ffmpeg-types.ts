import { z } from 'zod';
import { EXPORT_FPS } from './export-types';

export const EncodePngSequenceRequestSchema = z
  .object({
    framesDirectory: z.string().trim().min(1),
    outputPath: z.string().trim().min(1),
    fps: z.literal(EXPORT_FPS),
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

export type EncodePngSequenceRequest = z.input<
  typeof EncodePngSequenceRequestSchema
>;
export type VideoProbeExpectation = z.input<
  typeof VideoProbeExpectationSchema
>;

export interface VideoProbeResult {
  codecName: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number | null;
  durationSeconds: number;
  hasAudio: boolean;
  raw: unknown;
}
