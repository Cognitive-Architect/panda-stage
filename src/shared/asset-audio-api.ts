import { z } from 'zod';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
export const ASSET_AUDIO_MAX_BYTES = 64 * 1024 * 1024;

export const AssetAudioReadRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    assetId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const AudioDataUrlSchema = z
  .string()
  .regex(/^data:audio\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/u)
  .max(Math.ceil((ASSET_AUDIO_MAX_BYTES * 4) / 3) + 128);

export const AssetAudioReadResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('ready'),
      assetId: z.uuid(),
      mimeType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/u).max(200),
      byteLength: z.number().int().positive().max(ASSET_AUDIO_MAX_BYTES),
      dataUrl: AudioDataUrlSchema,
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
            'ASSET_AUDIO_INVALID_REQUEST',
            'ASSET_AUDIO_PROJECT_NOT_TRACKED',
            'ASSET_AUDIO_ASSET_NOT_FOUND',
            'ASSET_AUDIO_ASSET_INVALID',
            'ASSET_AUDIO_HASH_MISMATCH',
            'ASSET_AUDIO_SOURCE_MISSING',
            'ASSET_AUDIO_TOO_LARGE',
            'ASSET_AUDIO_READ_FAILED',
          ]),
          message: z.string().trim().min(1).max(1_000),
          assetId: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetAudioReadRequest = z.infer<
  typeof AssetAudioReadRequestSchema
>;
export type AssetAudioReadResponse = z.infer<
  typeof AssetAudioReadResponseSchema
>;
export type AssetAudioReadErrorCode =
  | 'ASSET_AUDIO_INVALID_REQUEST'
  | 'ASSET_AUDIO_PROJECT_NOT_TRACKED'
  | 'ASSET_AUDIO_ASSET_NOT_FOUND'
  | 'ASSET_AUDIO_ASSET_INVALID'
  | 'ASSET_AUDIO_HASH_MISMATCH'
  | 'ASSET_AUDIO_SOURCE_MISSING'
  | 'ASSET_AUDIO_TOO_LARGE'
  | 'ASSET_AUDIO_READ_FAILED';
