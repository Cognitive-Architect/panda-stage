import { z } from 'zod';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

/**
 * Bound the bytes returned to the renderer. Audio preview is intentionally a
 * small, read-only seam; a malformed project must not turn one IPC request
 * into an unbounded allocation.
 */
export const ASSET_PREVIEW_AUDIO_MAX_BYTES = 64 * 1024 * 1024;

export const PreviewAudioMimeTypeSchema = z.enum([
  'audio/mpeg',
  'audio/wav',
]);

const PreviewAudioBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength > 0,
    'Audio preview payload is empty.',
  )
  .refine(
    (bytes) => bytes.byteLength <= ASSET_PREVIEW_AUDIO_MAX_BYTES,
    `Audio preview payload exceeds ${ASSET_PREVIEW_AUDIO_MAX_BYTES} bytes.`,
  );

export const AssetPreviewAudioReadRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    assetId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const AssetPreviewAudioReadyResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('ready'),
    assetId: z.uuid(),
    mimeType: PreviewAudioMimeTypeSchema,
    byteLength: z.number().int().positive().max(ASSET_PREVIEW_AUDIO_MAX_BYTES),
    bytes: PreviewAudioBytesSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (response.byteLength !== response.bytes.byteLength) {
      context.addIssue({
        code: 'custom',
        message: 'Audio preview byteLength does not match bytes.',
        path: ['byteLength'],
      });
    }
  });

export const AssetPreviewAudioReadResponseSchema = z.union([
  AssetPreviewAudioReadyResponseSchema,
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
            'ASSET_PREVIEW_AUDIO_INVALID_REQUEST',
            'ASSET_PREVIEW_AUDIO_PROJECT_NOT_TRACKED',
            'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND',
            'ASSET_PREVIEW_AUDIO_NOT_AUDIO',
            'ASSET_PREVIEW_AUDIO_HASH_MISMATCH',
            'ASSET_PREVIEW_AUDIO_READ_FAILED',
          ]),
          message: z.string().trim().min(1).max(1_000),
          assetId: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetPreviewAudioReadRequest = z.infer<
  typeof AssetPreviewAudioReadRequestSchema
>;
export type AssetPreviewAudioReadResponse = z.infer<
  typeof AssetPreviewAudioReadResponseSchema
>;
