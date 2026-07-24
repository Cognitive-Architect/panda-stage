import { z } from 'zod';
import { AssetSchema, ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const AssetMetadataRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    assetId: z.uuid(),
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
  'ASSET_METADATA_INVALID_REQUEST',
  'ASSET_METADATA_OPERATION_FAILED',
]);

export const AssetMetadataResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      project: ProjectSchema,
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
        })
        .strict(),
    })
    .strict(),
]);

export type AssetMetadataRequest = z.infer<
  typeof AssetMetadataRequestSchema
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
