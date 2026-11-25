import { z } from 'zod';
import type { Layer, Project, Shot } from '../domain';
import { mapProjectTime } from '../domain/selectors/projectTime';
import { projectDurationMs } from '../domain/selectors/projectDuration';
import { exportFrameTimeMs } from '../domain/timeline/frame-grid';
import { ExportPreparationCameraModeSchema, type PngSequenceOptions } from './export-preparation-types';
import { DialogueSilenceSchema } from './dialogue-silence';
import { ExportAudioClipInputSchema } from './audio-mix-types';

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
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
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
    solidClear: z.literal(true).optional(),
    outputLayerId: z.uuid().optional(),
    dialogueSilence: DialogueSilenceSchema.optional(),
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
    audioClips: z.array(ExportAudioClipInputSchema),
    outputPath: Mp4OutputPathSchema,
    durationMs: DurationSchema,
    fps: z.literal(EXPORT_FPS),
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
    outputPath: FileSystemPathSchema.optional(),
    incomplete: z.boolean().optional(),
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
  return exportFrameTimeMs(parsedFrameIndex, parsedFps);
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

export const SPRITE_SHEET_MAX_DIMENSION = 8_192 as const;
export const SPRITE_SHEET_MAX_PIXELS = 32 * 1024 * 1024;

export interface SpriteSheetGrid {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export interface SpriteSheetPagePlan extends SpriteSheetGrid {
  pageIndex: number;
  frameStart: number;
  frameCount: number;
  imageName: string;
}

export interface SpriteSheetPlan {
  totalFrames: number;
  frameWidth: number;
  frameHeight: number;
  maxFramesPerPage: number;
  maxDimension: number;
  maxPixels: number;
  pages: SpriteSheetPagePlan[];
}

export function formatSpriteSheetPageImageName(pageIndex: number, pageCount: number): string {
  if (pageCount <= 1) return 'sprite-sheet.png';
  return `sprite-sheet-${String(pageIndex).padStart(3, '0')}.png`;
}

export function formatSpriteSheetFrameName(frameIndex: number): string {
  const parsedFrameIndex = FrameIndexSchema.parse(frameIndex);
  return `frame_${String(parsedFrameIndex).padStart(FRAME_FILE_DIGITS, '0')}`;
}

/** Shot-local formal frame samples in a half-open interval, with contiguous output names. */
export function planSpriteSheetGrid(
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  limits?: { maxDimension?: number; maxPixels?: number },
): SpriteSheetGrid {
  const maxDimension = limits?.maxDimension ?? SPRITE_SHEET_MAX_DIMENSION;
  const maxPixels = limits?.maxPixels ?? SPRITE_SHEET_MAX_PIXELS;
  if (![frameCount, frameWidth, frameHeight, maxDimension, maxPixels].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('没有可排入精灵图的有效帧。');
  }
  let best: SpriteSheetGrid | undefined;
  let bestAspect = Infinity;
  for (let columns = 1; columns <= Math.min(frameCount, Math.floor(maxDimension / frameWidth)); columns += 1) {
    const rows = Math.ceil(frameCount / columns);
    const width = frameWidth * columns;
    const height = frameHeight * rows;
    if (height > maxDimension || width * height > maxPixels) continue;
    const aspect = Math.max(width, height) / Math.min(width, height);
    if (aspect < bestAspect) {
      bestAspect = aspect;
      best = { columns, rows, width, height };
    }
  }
  if (!best) throw new Error('这些帧超出单张精灵图的容量。请缩短导出时间段，或改用 PNG 序列。');
  return best;
}

/**
 * Plans single- or multi-page sprite sheet capacity from actual cell dimensions
 * and page budgets (maxDimension and maxPixels), without hardcoding page size.
 */
export function planSpriteSheetPages(
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  limits?: { maxDimension?: number; maxPixels?: number },
): SpriteSheetPlan {
  const maxDimension = limits?.maxDimension ?? SPRITE_SHEET_MAX_DIMENSION;
  const maxPixels = limits?.maxPixels ?? SPRITE_SHEET_MAX_PIXELS;
  if (![frameCount, frameWidth, frameHeight, maxDimension, maxPixels].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('没有可排入精灵图的有效帧。');
  }
  const maxCols = Math.floor(maxDimension / frameWidth);
  const maxRows = Math.floor(maxDimension / frameHeight);
  const cellPixels = frameWidth * frameHeight;
  let maxFramesPerPage = 0;
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.min(maxRows, Math.floor(maxPixels / (cols * cellPixels)));
    if (rows <= 0) continue;
    const capacity = cols * rows;
    if (capacity > maxFramesPerPage) {
      maxFramesPerPage = capacity;
    }
  }
  if (maxFramesPerPage <= 0) {
    throw new Error('单帧尺寸超出精灵图页容量限制，无法排入精灵图。');
  }
  const pageCount = Math.ceil(frameCount / maxFramesPerPage);
  const pages: SpriteSheetPagePlan[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const frameStart = pageIndex * maxFramesPerPage;
    const pageFrameCount = Math.min(maxFramesPerPage, frameCount - frameStart);
    const grid = planSpriteSheetGrid(pageFrameCount, frameWidth, frameHeight, { maxDimension, maxPixels });
    pages.push({
      pageIndex,
      frameStart,
      frameCount: pageFrameCount,
      ...grid,
      imageName: formatSpriteSheetPageImageName(pageIndex, pageCount),
    });
  }
  return {
    totalFrames: frameCount,
    frameWidth,
    frameHeight,
    maxFramesPerPage,
    maxDimension,
    maxPixels,
    pages,
  };
}

/**
 * Isolates a single visible object Layer (Graphic / animation / character / asset)
 * inside its owning Shot for transparent sprite-sheet export, preserving source clock,
 * instance transform/color/effects and Shot-local time range while excluding background
 * and all unrelated layers.
 */
export function scopeShotForLayerExport(shot: Shot, layerId: string): { shot: Shot; layer: Layer } {
  const layer = shot.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('请选择当前镜头中可导出的对象图层。');
  }
  if (!layer.visible) {
    throw new Error('当前选中对象处于隐藏状态，请先显示后再导出。');
  }
  return {
    layer,
    shot: {
      ...shot,
      backgroundLayerId: null,
      layers: [layer],
      dialogues: [],
      audioClips: [],
    },
  };
}

/**
 * Computes a stable normalized stage-space anchor for an isolated Layer export.
 */
export function computeLayerExportAnchor(
  layer: Layer,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  if (stageWidth <= 0 || stageHeight <= 0) return { x: 0.5, y: 0.5 };
  const rawX = layer.x / stageWidth;
  const rawY = layer.y / stageHeight;
  const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;
  return {
    x: Number.isFinite(rawX) ? clamp01(rawX) : 0.5,
    y: Number.isFinite(rawY) ? clamp01(rawY) : 0.5,
  };
}

export function planPngSequenceFrames(project: Project, settings: PngSequenceOptions) {
  const baseShot = project.shots.find(({ id }) => id === settings.shotId);
  if (!baseShot) throw new Error('请选择一个可导出的镜头。');
  const scoped = settings.layerId ? scopeShotForLayerExport(baseShot, settings.layerId) : null;
  const shot = baseShot;
  const startMs = settings.range?.startMs ?? 0;
  const endMs = settings.range?.endMs ?? shot.durationMs;
  if (startMs < 0 || endMs > shot.durationMs || startMs >= endMs) throw new Error('PNG 时间段须在当前镜头范围内。');
  const first = startMs === 0 ? 0 : formalFrameCount(startMs);
  const lastExclusive = formalFrameCount(endMs);
  const totalFrames = lastExclusive - first;
  if (totalFrames <= 0) throw new Error('该时间段内没有可导出的帧。');
  return {
    totalFrames,
    firstFrameIndex: first,
    shot,
    outputShot: scoped?.shot ?? shot,
    selectedLayer: scoped?.layer,
    *frames(): Generator<ProjectFrameScheduleEntry> {
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const timeMs = frameTimeMs(first + frameIndex);
        yield { frameIndex, timeMs, shotId: settings.shotId, shotIndex: 0, shotStartMs: 0, shotLocalTimeMs: timeMs,
          fileName: formatFrameFileName(frameIndex) };
      }
    },
  };
}
