import { z } from 'zod';
import type { Project } from '../domain';
import { mapProjectTime } from '../domain/selectors/projectTime';
import { projectDurationMs } from '../domain/selectors/projectDuration';
import { ExportPreparationCameraModeSchema } from './export-preparation-types';

export const EXPORT_FPS = 24 as const;
export const MAX_PENDING_FRAMES = 3 as const;
export const FRAME_FILE_DIGITS = 6 as const;

const JobIdSchema = z.uuid();
const DurationSchema = z.number().int().min(3_000).max(5_000);
const FormalDurationSchema = z.number().int().positive().safe();
const FrameIndexSchema = z.number().int().nonnegative();
const FrameTimeSchema = z.number().int().nonnegative();
export const MAX_FORMAL_EXPORT_FRAMES = 2_000_000 as const;

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

export const ExportStartFormalRequestSchema = z
  .object({
    snapshotId: JobIdSchema,
    reuseSnapshot: z.boolean().default(false),
  })
  .strict();

export const ExportLoadFormalMediaSchema = z
  .object({
    assetId: z.uuid(),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    bytes: z.instanceof(Uint8Array).refine(
      (bytes) => bytes.byteLength > 0 && bytes.byteLength <= 64 * 1024 * 1024,
      'Formal export image exceeds its media budget.',
    ),
  })
  .strict();

export const ExportLoadFormalRequestSchema = z
  .object({
    jobId: JobIdSchema,
    project: z.unknown(),
    cameraMode: ExportPreparationCameraModeSchema,
    media: z.array(ExportLoadFormalMediaSchema).max(512),
  })
  .strict()
  .superRefine((request, context) => {
    const totalBytes = request.media.reduce(
      (total, entry) => total + entry.bytes.byteLength,
      0,
    );
    if (totalBytes > 256 * 1024 * 1024) {
      context.addIssue({
        code: 'custom',
        message: 'Formal export media exceeds its total byte budget.',
        path: ['media'],
      });
    }
  });

export const ExportFormalLoadedSchema = z
  .object({ jobId: JobIdSchema, acknowledged: z.literal(true) })
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
    shotId: z.uuid().optional(),
    shotLocalTimeMs: FrameTimeSchema.optional(),
  })
  .strict()
  .superRefine((frame, context) => {
    if ((frame.shotId === undefined) !== (frame.shotLocalTimeMs === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Shot identity and Shot-local time must be supplied together.',
      });
    }
  });

export const ExportFrameReadySchema = z
  .object({
    jobId: JobIdSchema,
    frameIndex: FrameIndexSchema,
    timeMs: FrameTimeSchema,
    shotId: z.uuid().optional(),
    shotLocalTimeMs: FrameTimeSchema.optional(),
    width: z.literal(1_920),
    height: z.literal(1_080),
    pngBytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 8, 'PNG payload is empty.'),
  })
  .strict()
  .superRefine((frame, context) => {
    if ((frame.shotId === undefined) !== (frame.shotLocalTimeMs === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Shot identity and Shot-local time must be supplied together.',
      });
    }
  });

export const ExportFrameFailedSchema = z
  .object({
    jobId: JobIdSchema,
    frameIndex: FrameIndexSchema,
    timeMs: FrameTimeSchema,
    shotId: z.uuid().optional(),
    shotLocalTimeMs: FrameTimeSchema.optional(),
    error: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((frame, context) => {
    if ((frame.shotId === undefined) !== (frame.shotLocalTimeMs === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Shot identity and Shot-local time must be supplied together.',
      });
    }
  });

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
  'probing',
  'muxing',
  'cleaning',
  'committing',
  'finished',
]);

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const Mp4OutputPathSchema = FileSystemPathSchema.refine(
  (value) => /\.mp4$/iu.test(value),
  '完整导出仅支持 .mp4 输出路径。',
);

export const FullProbeExportRequestSchema = z
  .object({
    projectDirectory: FileSystemPathSchema,
    audioPath: FileSystemPathSchema,
    outputPath: Mp4OutputPathSchema,
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

export const ExportRevealOutputRequestSchema = z
  .object({ jobId: JobIdSchema })
  .strict();

export const ExportRevealOutputResponseSchema = z
  .object({ opened: z.boolean() })
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
    attemptId: z.uuid().optional(),
    snapshotId: z.uuid().optional(),
    status: ExportJobStatusSchema,
    phase: ExportJobPhaseSchema,
    completedFrames: z.number().int().nonnegative(),
    totalFrames: z.number().int().nonnegative(),
    error: z.string().trim().min(1).max(2_000).nullable(),
    originalError: z.string().trim().min(1).max(2_000).nullable().optional(),
    cleanupError: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict();

export type ExportProbeConfig = z.infer<typeof ExportProbeConfigSchema>;
export type ExportLoadProbeRequest = z.infer<
  typeof ExportLoadProbeRequestSchema
>;
export type ExportStartFormalRequest = z.infer<
  typeof ExportStartFormalRequestSchema
>;
export type ExportLoadFormalRequest = Omit<
  z.infer<typeof ExportLoadFormalRequestSchema>,
  'project'
> & { project: Project };
export type ExportLoadFormalMedia = z.infer<
  typeof ExportLoadFormalMediaSchema
>;
export type ExportFormalLoaded = z.infer<typeof ExportFormalLoadedSchema>;
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
export type ExportRevealOutputRequest = z.infer<
  typeof ExportRevealOutputRequestSchema
>;
export type ExportRevealOutputResponse = z.infer<
  typeof ExportRevealOutputResponseSchema
>;
export type ExportJobUpdate = z.infer<typeof ExportJobUpdateSchema>;

export interface FrameScheduleEntry {
  frameIndex: number;
  timeMs: number;
  fileName: string;
}

export interface ProjectFrameScheduleEntry extends FrameScheduleEntry {
  shotId: string;
  shotIndex: number;
  shotStartMs: number;
  shotLocalTimeMs: number;
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

export function formalFrameCount(durationMs: number, fps = EXPORT_FPS): number {
  const parsedDuration = FormalDurationSchema.parse(durationMs);
  const parsedFps = z.literal(EXPORT_FPS).parse(fps);
  const count = Math.ceil((parsedDuration / 1_000) * parsedFps);
  if (!Number.isSafeInteger(count) || count > MAX_FORMAL_EXPORT_FRAMES) {
    throw new Error('Formal export duration exceeds the frame budget.');
  }
  return count;
}

export function* iterateFormalFrameSchedule(
  durationMs: number,
  fps = EXPORT_FPS,
): Generator<FrameScheduleEntry> {
  const count = formalFrameCount(durationMs, fps);
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    yield {
      frameIndex,
      timeMs: frameTimeMs(frameIndex, fps),
      fileName: formatFrameFileName(frameIndex),
    };
  }
}

/**
 * Maps one global formal frame grid to Project order and Shot-local time.
 * The frame count is calculated once from the summed Project duration; no
 * Shot gets a separately rounded frame count or a synthetic terminal frame.
 */
export function* iterateFormalProjectFrameSchedule(
  project: Project,
  fps = EXPORT_FPS,
): Generator<ProjectFrameScheduleEntry> {
  const durationMs = projectDurationMs(project);
  const count = formalFrameCount(durationMs, fps);
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const timeMs = frameTimeMs(frameIndex, fps);
    const position = mapProjectTime(project, timeMs);
    if (!position.shot || position.shotIndex === null) {
      throw new Error('Formal export Project frame has no owning Shot.');
    }
    yield {
      frameIndex,
      timeMs,
      fileName: formatFrameFileName(frameIndex),
      shotId: position.shot.id,
      shotIndex: position.shotIndex,
      shotStartMs: position.shotStartMs,
      shotLocalTimeMs: position.shotLocalTimeMs,
    };
  }
}
