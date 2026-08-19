import { z } from 'zod';
import { ImageAssetSchema, ProjectSchema } from '../domain';
import {
  FLA_IMPORT_LIMITS,
  FlaMediaIdSchema,
  FlaSourceFormatSchema,
} from './fla-import-api';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const RevisionSchema = z.number().int().nonnegative();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const SelectedMediaIdsSchema = z
  .array(FlaMediaIdSchema)
  .min(1)
  .max(FLA_IMPORT_LIMITS.maxMediaCount)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'selectedMediaIds must be unique',
  );

/**
 * Slice 3 commit request.  This is deliberately identifier-only: encoded
 * image bytes, source paths, and destination paths never cross the Renderer
 * boundary.
 */
export const FlaAssetCommitRequestSchema = z
  .object({
    format: z.literal('fla-raster-commit'),
    version: z.literal(1),
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    baseRevision: RevisionSchema,
    sessionId: z.uuid(),
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        sha256: Sha256Schema,
      })
      .strict(),
    selectedMediaIds: SelectedMediaIdsSchema,
    selectedCount: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxMediaCount),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (request) => request.selectedCount === request.selectedMediaIds.length,
    'selectedCount must match selectedMediaIds.length',
  );

export const FlaAssetCommitResultSchema = z
  .object({
    mediaId: FlaMediaIdSchema,
    sourceName: z.string().trim().min(1).max(500),
    sourceFormat: FlaSourceFormatSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    status: z.enum(['imported', 'duplicate']),
    sha256: Sha256Schema,
    asset: ImageAssetSchema,
    duplicateOfAssetId: z.uuid().nullable(),
    targetFileName: z.string().trim().min(1).max(260),
    renamed: z.boolean(),
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const FlaAssetCommitSummarySchema = z
  .object({
    selectedCount: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxMediaCount),
    importedCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    renamedCount: z.number().int().nonnegative(),
  })
  .strict();

export const FlaAssetCommitErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'SOURCE_MISMATCH',
  'INVALID_SELECTION',
  'NO_MEDIA_SELECTED',
  'STALE_PROJECT_REVISION',
  'IMPORT_COLLISION',
  'ASSET_COMMIT_FAILED',
  'ROLLBACK_FAILED',
  'JOURNAL_RECOVERY_FAILED',
  'COMMIT_BUSY',
]);

export const FlaAssetCommitErrorSchema = z
  .object({
    code: FlaAssetCommitErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    projectRoot: FileSystemPathSchema,
    currentProject: ProjectSchema.optional(),
    currentRevision: RevisionSchema.optional(),
    residualPaths: z
      .array(z.string().trim().min(1).max(260))
      .max(FLA_IMPORT_LIMITS.maxMediaCount * 2)
      .optional(),
  })
  .strict();

export const FlaAssetCommitResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: RevisionSchema,
      savedRevision: RevisionSchema,
      projectChanged: z.boolean(),
      results: z.array(FlaAssetCommitResultSchema).min(1),
      summary: FlaAssetCommitSummarySchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal('cancelled'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: FlaAssetCommitErrorSchema,
    })
    .strict(),
]);

export type FlaAssetCommitRequest = z.infer<
  typeof FlaAssetCommitRequestSchema
>;
export type FlaAssetCommitResult = z.infer<
  typeof FlaAssetCommitResultSchema
>;
export type FlaAssetCommitResponse = z.infer<
  typeof FlaAssetCommitResponseSchema
>;
export type FlaAssetCommitErrorCode = z.infer<
  typeof FlaAssetCommitErrorCodeSchema
>;
