import { z } from 'zod';
import {
  AudioAssetSchema,
  LayerSchema,
  ProjectSchema,
  VideoAssetSchema,
} from '../domain';

export const FlaVideoImportErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'STALE_PROJECT_REVISION',
  'VIDEO_IMPORT_FAILED',
  'VIDEO_IMPORT_CANCELLED',
]);

export const FlaVideoImportRequestSchema = z
  .object({
    sessionId: z.uuid(),
    videoName: z.string().trim().min(1).max(500),
    projectRoot: z.string().trim().min(1).max(32_767),
    project: ProjectSchema,
    baseRevision: z.number().int().nonnegative(),
    shotId: z.uuid(),
    playbackMode: z.enum(['play-once', 'loop', 'single-frame']).optional(),
    startTimeMs: z.number().finite().min(0).optional(),
    trimStartMs: z.number().finite().min(0).optional(),
    trimEndMs: z.number().finite().min(0).optional(),
    heldFrameIndex: z.number().int().nonnegative().optional(),
    sourceFps: z.number().finite().positive().optional(),
    includeAudio: z.boolean().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .strict();

export const FlaVideoImportErrorSchema = z
  .object({
    code: FlaVideoImportErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    projectRoot: z.string().trim().min(1).max(32_767),
    currentProject: ProjectSchema.optional(),
    currentRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export const FlaVideoImportResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: z.number().int().nonnegative(),
      savedRevision: z.number().int().nonnegative(),
      videoAsset: VideoAssetSchema,
      layer: LayerSchema,
      audioAsset: AudioAssetSchema.optional(),
      audioClipId: z.uuid().optional(),
      audioClipIds: z.array(z.uuid()).max(256).optional(),
      diagnostics: z.array(z.string().trim().min(1).max(1_000)).max(32).optional(),
      reusedVideoAsset: z.boolean(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: FlaVideoImportErrorSchema,
    })
    .strict(),
]);

export type FlaVideoImportErrorCode = z.infer<typeof FlaVideoImportErrorCodeSchema>;
export type FlaVideoImportRequest = z.infer<typeof FlaVideoImportRequestSchema>;
export type FlaVideoImportError = z.infer<typeof FlaVideoImportErrorSchema>;
export type FlaVideoImportResponse = z.infer<typeof FlaVideoImportResponseSchema>;
