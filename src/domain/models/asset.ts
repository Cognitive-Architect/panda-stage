import { z } from 'zod';
import {
  IdSchema,
  NameSchema,
  PositiveMillisecondsSchema,
  RelativeProjectPathSchema,
} from './common';

export const ImageAssetUsageSchema = z.enum([
  'uncategorized',
  'background',
  'character',
  'prop',
  'effect',
]);

export const AssetKeywordsSchema = z
  .array(z.string().trim().min(1).max(32))
  .max(8)
  .superRefine((keywords, context) => {
    const seen = new Set<string>();
    keywords.forEach((keyword, index) => {
      const normalized = keyword.toLowerCase();
      if (seen.has(normalized)) {
        context.addIssue({
          code: 'custom',
          message: 'Keywords must be unique, ignoring case.',
          path: [index],
        });
      }
      seen.add(normalized);
    });
  });

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
    usage: ImageAssetUsageSchema,
    keywords: AssetKeywordsSchema,
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

/** Strict image shape persisted by schema v12 and earlier. */
export const ImageAssetV12Schema = z
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

/** Strict audio shape persisted by schema v12 and earlier. */
export const AudioAssetV12Schema = z
  .object({
    ...AssetBaseShape,
    kind: z.literal('audio'),
    durationMs: PositiveMillisecondsSchema.optional(),
  })
  .strict();

export const AssetV12Schema = z.discriminatedUnion('kind', [
  ImageAssetV12Schema,
  AudioAssetV12Schema,
]);

export const AssetSchema = z.discriminatedUnion('kind', [
  ImageAssetSchema,
  AudioAssetSchema,
]);

export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export type AudioAsset = z.infer<typeof AudioAssetSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type ImageAssetV12 = z.infer<typeof ImageAssetV12Schema>;
export type AudioAssetV12 = z.infer<typeof AudioAssetV12Schema>;
export type AssetV12 = z.infer<typeof AssetV12Schema>;
export type ImageAssetUsage = z.infer<typeof ImageAssetUsageSchema>;
