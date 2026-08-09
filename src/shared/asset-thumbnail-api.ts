import { z } from 'zod';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const AssetThumbnailReadRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    assetId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  })
  .strict();

export const AssetThumbnailReadResponseSchema = z.union(
  [
    z
      .object({
        ok: z.literal(true),
        status: z.literal('ready'),
        assetId: z.uuid(),
        dataUrl: z
          .string()
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u)
          .max(8_500_000),
      })
      .strict(),
    z
      .object({
        ok: z.literal(true),
        status: z.literal('missing'),
        assetId: z.uuid(),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: z
          .object({
            code: z.enum([
              'ASSET_THUMBNAIL_INVALID_REQUEST',
              'ASSET_THUMBNAIL_PROJECT_NOT_TRACKED',
              'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
              'ASSET_THUMBNAIL_HASH_MISMATCH',
              'ASSET_THUMBNAIL_SOURCE_MISSING',
              'ASSET_THUMBNAIL_READ_FAILED',
            ]),
            message: z.string().trim().min(1).max(1_000),
            assetId: z.string().trim().min(1).max(200),
            relativePath: z.string().trim().min(1).max(32_767).optional(),
          })
          .strict(),
      })
      .strict(),
  ],
);

export type AssetThumbnailReadRequest = z.infer<
  typeof AssetThumbnailReadRequestSchema
>;
export type AssetThumbnailReadResponse = z.infer<
  typeof AssetThumbnailReadResponseSchema
>;
