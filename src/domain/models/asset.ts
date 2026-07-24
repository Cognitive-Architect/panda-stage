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
};

export const ImageAssetSchema = z
  .object({
    ...AssetBaseShape,
    kind: z.literal('image'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
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
