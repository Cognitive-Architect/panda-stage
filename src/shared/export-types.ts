import { z } from 'zod';

export const EXPORT_FPS = 24 as const;
export const MAX_PENDING_FRAMES = 3 as const;
export const FRAME_FILE_DIGITS = 6 as const;

const JobIdSchema = z.uuid();
const DurationSchema = z.number().int().min(3_000).max(5_000);
const FrameIndexSchema = z.number().int().nonnegative();
const FrameTimeSchema = z.number().int().nonnegative();

export const ExportProbeConfigSchema = z
  .object({
    durationMs: DurationSchema,
    fps: z.literal(EXPORT_FPS),
  })
  .strict();

export const ExportLoadProbeRequestSchema = z
  .object({
    jobId: JobIdSchema,
    durationMs: DurationSchema,
    fps: z.literal(EXPORT_FPS),
  })
  .strict();

export const ExportProbeLoadedSchema = z
  .object({
    jobId: JobIdSchema,
    acknowledged: z.literal(true),
  })
  .strict();

export const ExportRenderFrameRequestSchema = z
  .object({
    jobId: JobIdSchema,
    frameIndex: FrameIndexSchema,
    timeMs: FrameTimeSchema,
  })
  .strict();

export const ExportFrameReadySchema = z
  .object({
    jobId: JobIdSchema,
    frameIndex: FrameIndexSchema,
    timeMs: FrameTimeSchema,
    width: z.literal(1_920),
    height: z.literal(1_080),
    pngBytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 8, 'PNG payload is empty.'),
  })
  .strict();

export const ExportFrameFailedSchema = z
  .object({
    jobId: JobIdSchema,
    frameIndex: FrameIndexSchema,
    timeMs: FrameTimeSchema,
    error: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const ExportCancelRenderRequestSchema = z
  .object({
    jobId: JobIdSchema,
  })
  .strict();

export const ExportJobStatusSchema = z.enum([
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]);

export const ExportJobPhaseSchema = z.enum([
  'preparing',
  'rendering',
  'writing',
  'encoding',
  'muxing',
  'cleaning',
  'finished',
]);

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const FullProbeExportRequestSchema = z
  .object({
    projectDirectory: FileSystemPathSchema,
    audioPath: FileSystemPathSchema,
    outputPath: FileSystemPathSchema,
    durationMs: DurationSchema,
    fps: z.literal(EXPORT_FPS),
    audioStartMs: z.number().int().nonnegative(),
    overwrite: z.boolean().default(false),
  })
  .strict();

export const ExportStartResponseSchema = z
  .object({
    jobId: JobIdSchema,
    status: z.literal('running'),
  })
  .strict();

export const ExportCancelRequestSchema = z
  .object({
    jobId: JobIdSchema,
  })
  .strict();

export const ExportCancelResponseSchema = z
  .object({
    jobId: JobIdSchema,
    accepted: z.boolean(),
    status: ExportJobStatusSchema,
  })
  .strict();

export const ExportJobUpdateSchema = z
  .object({
    jobId: JobIdSchema,
    status: ExportJobStatusSchema,
    phase: ExportJobPhaseSchema,
    completedFrames: z.number().int().nonnegative(),
    totalFrames: z.number().int().nonnegative(),
    error: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export type ExportProbeConfig = z.infer<typeof ExportProbeConfigSchema>;
export type ExportLoadProbeRequest = z.infer<
  typeof ExportLoadProbeRequestSchema
>;
export type ExportProbeLoaded = z.infer<typeof ExportProbeLoadedSchema>;
export type ExportRenderFrameRequest = z.infer<
  typeof ExportRenderFrameRequestSchema
>;
export type ExportFrameReady = z.infer<typeof ExportFrameReadySchema>;
export type ExportFrameFailed = z.infer<typeof ExportFrameFailedSchema>;
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;
export type ExportJobPhase = z.infer<typeof ExportJobPhaseSchema>;
export type ExportCancelRenderRequest = z.infer<
  typeof ExportCancelRenderRequestSchema
>;
export type FullProbeExportRequest = z.infer<
  typeof FullProbeExportRequestSchema
>;
export type ExportStartResponse = z.infer<typeof ExportStartResponseSchema>;
export type ExportCancelRequest = z.infer<typeof ExportCancelRequestSchema>;
export type ExportCancelResponse = z.infer<typeof ExportCancelResponseSchema>;
export type ExportJobUpdate = z.infer<typeof ExportJobUpdateSchema>;

export interface FrameScheduleEntry {
  frameIndex: number;
  timeMs: number;
  fileName: string;
}

export function frameTimeMs(frameIndex: number, fps = EXPORT_FPS): number {
  const parsedFrameIndex = FrameIndexSchema.parse(frameIndex);
  const parsedFps = z.literal(EXPORT_FPS).parse(fps);
  return Math.floor((parsedFrameIndex / parsedFps) * 1_000);
}

export function formatFrameFileName(frameIndex: number): string {
  const parsedFrameIndex = FrameIndexSchema.parse(frameIndex);
  return `frame_${String(parsedFrameIndex).padStart(FRAME_FILE_DIGITS, '0')}.png`;
}

export function createFrameSchedule(
  rawConfig: ExportProbeConfig,
): FrameScheduleEntry[] {
  const config = ExportProbeConfigSchema.parse(rawConfig);
  const totalFrames = Math.ceil((config.durationMs / 1_000) * config.fps);

  return Array.from({ length: totalFrames }, (_, frameIndex) => ({
    frameIndex,
    timeMs: frameTimeMs(frameIndex, config.fps),
    fileName: formatFrameFileName(frameIndex),
  }));
}
