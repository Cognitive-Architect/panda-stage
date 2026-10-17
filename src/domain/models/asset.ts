import { z } from 'zod';
import {
  IdSchema,
  NameSchema,
  PositiveMillisecondsSchema,
  RelativeProjectPathSchema,
} from './common';

const AssetBaseShape = {
  id: IdSchema,
  name: NameSchema,
  relativePath: RelativeProjectPathSchema,
  mimeType: z.string().trim().min(1).max(200),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  metadata: z
    .discriminatedUnion('status', [
      z
        .object({
          status: z.literal('ready'),
          warnings: z
            .array(
              z
                .object({
                  code: z.enum([
                    'ASSET_IMAGE_TOO_LARGE',
                    'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
                  ]),
                  message: z.string().trim().min(1).max(500),
                })
                .strict(),
            )
            .max(10),
        })
        .strict(),
      z
        .object({
          status: z.literal('error'),
          code: z.enum([
            'ASSET_METADATA_FILE_UNREADABLE',
            'ASSET_METADATA_INVALID_IMAGE',
            'ASSET_METADATA_INVALID_AUDIO',
            'ASSET_METADATA_UNSUPPORTED_KIND',
          ]),
          message: z.string().trim().min(1).max(500),
        })
        .strict(),
    ])
    .optional(),
};

export const ImageAssetSchema = z
  .object({
    ...AssetBaseShape,
    kind: z.literal('image'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    flaSnapshot: z
      .object({
        sourceBasename: z.string().trim().min(1).max(260),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        targetName: z.string().trim().min(1).max(500),
        sourceLibraryItemName: z.string().trim().min(1).max(500).optional(),
        renderTargetId: z.string().trim().min(1).max(128),
        selectedFrameIndex: z.number().int().nonnegative(),
        previewSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AudioAssetSchema = z
  .object({
    ...AssetBaseShape,
    kind: z.literal('audio'),
    durationMs: PositiveMillisecondsSchema.optional(),
  })
  .strict();

export const AssetSchema = z.discriminatedUnion('kind', [
  ImageAssetSchema,
  AudioAssetSchema,
]);

export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type AudioAsset = z.infer<typeof AudioAssetSchema>;
export type Asset = z.infer<typeof AssetSchema>;
