import { z } from 'zod';
import { AssetSchema, ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const RevisionSchema = z.number().int().nonnegative();

export const AssetMetadataRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    baseRevision: RevisionSchema,
    assetId: z.uuid(),
    requestId: z.uuid(),
  })
  .strict();

export const AssetMetadataCancelRequestSchema = z
  .object({
    requestId: z.uuid(),
  })
  .strict();

export const AssetMetadataCancelResponseSchema = z
  .object({
    requestId: z.uuid(),
    accepted: z.boolean(),
  })
  .strict();

export const AssetMetadataResultErrorCodeSchema = z.enum([
  'ASSET_METADATA_FILE_UNREADABLE',
  'ASSET_METADATA_INVALID_IMAGE',
  'ASSET_METADATA_INVALID_AUDIO',
  'ASSET_METADATA_UNSUPPORTED_KIND',
]);

export const AssetMetadataWarningSchema = z
  .object({
    code: z.enum([
      'ASSET_IMAGE_TOO_LARGE',
      'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
    ]),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const ThumbnailDescriptorSchema = z
  .object({
    relativePath: z
      .string()
      .trim()
      .regex(/^cache\/asset-thumbnails\/[^/]+\.png$/u),
    width: z.number().int().positive().max(256),
    height: z.number().int().positive().max(256),
    cacheHit: z.boolean(),
  })
  .strict();

const AssetMetadataReadyResultSchema = z
  .object({
    status: z.literal('ready'),
    asset: AssetSchema,
    thumbnail: ThumbnailDescriptorSchema.nullable(),
    warnings: z.array(AssetMetadataWarningSchema).max(10),
  })
  .strict();

const AssetMetadataErrorResultSchema = z
  .object({
    status: z.literal('error'),
    asset: AssetSchema,
    error: z
      .object({
        code: AssetMetadataResultErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export const AssetMetadataResultSchema = z.discriminatedUnion('status', [
  AssetMetadataReadyResultSchema,
  AssetMetadataErrorResultSchema,
]);

export const AssetMetadataOperationErrorCodeSchema = z.enum([
  'ASSET_METADATA_PROJECT_NOT_FOUND',
  'ASSET_METADATA_ASSET_NOT_FOUND',
  'ASSET_METADATA_SOURCE_MISSING',
  'ASSET_METADATA_PROJECT_MISMATCH',
  'ASSET_METADATA_STALE_REVISION',
  'ASSET_METADATA_TIMEOUT',
  'ASSET_METADATA_CANCELLED',
  'ASSET_METADATA_INVALID_REQUEST',
  'ASSET_METADATA_OPERATION_FAILED',
]);

export const AssetMetadataResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      project: ProjectSchema,
      baseRevision: RevisionSchema,
      savedRevision: RevisionSchema,
      result: AssetMetadataResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: AssetMetadataOperationErrorCodeSchema,
          message: z.string().trim().min(1).max(1_000),
          projectRoot: FileSystemPathSchema,
          assetId: z.string().trim().min(1).max(200),
          relativePath: z
            .string()
            .trim()
            .min(1)
            .max(32_767)
            .optional(),
          currentProject: ProjectSchema.optional(),
          currentRevision: RevisionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetMetadataRequest = z.infer<
  typeof AssetMetadataRequestSchema
>;
export type AssetMetadataCancelRequest = z.infer<
  typeof AssetMetadataCancelRequestSchema
>;
export type AssetMetadataCancelResponse = z.infer<
  typeof AssetMetadataCancelResponseSchema
>;
export type AssetMetadataResult = z.infer<
  typeof AssetMetadataResultSchema
>;
export type AssetMetadataResponse = z.infer<
  typeof AssetMetadataResponseSchema
>;
export type AssetMetadataWarning = z.infer<
  typeof AssetMetadataWarningSchema
>;
export type AssetMetadataResultErrorCode = z.infer<
  typeof AssetMetadataResultErrorCodeSchema
>;
export type AssetMetadataOperationErrorCode = z.infer<
  typeof AssetMetadataOperationErrorCodeSchema
>;
