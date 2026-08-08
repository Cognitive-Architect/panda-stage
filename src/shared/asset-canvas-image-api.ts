import { z } from 'zod';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

/**
 * Canvas images are read lazily for the active editor source. The bound keeps
 * a malformed project from turning one IPC request into an unbounded memory
 * allocation while still covering large 4K editing sources.
 */
export const CANVAS_IMAGE_MAX_BYTES = 64 * 1024 * 1024;

const CanvasImageMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
]);

const CanvasImageBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength > 0,
    'Canvas image payload is empty.',
  )
  .refine(
    (bytes) => bytes.byteLength <= CANVAS_IMAGE_MAX_BYTES,
    `Canvas image payload exceeds ${CANVAS_IMAGE_MAX_BYTES} bytes.`,
  );

export const AssetCanvasImageReadRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    assetId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const AssetCanvasImageReadyResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal('ready'),
    assetId: z.uuid(),
    mimeType: CanvasImageMimeTypeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteLength: z.number().int().positive().max(CANVAS_IMAGE_MAX_BYTES),
    bytes: CanvasImageBytesSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (response.byteLength !== response.bytes.byteLength) {
      context.addIssue({
        code: 'custom',
        message: 'Canvas image byteLength does not match bytes.',
        path: ['byteLength'],
      });
    }
  });

export const AssetCanvasImageReadResponseSchema = z.union([
  AssetCanvasImageReadyResponseSchema,
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
            'ASSET_CANVAS_IMAGE_INVALID_REQUEST',
            'ASSET_CANVAS_IMAGE_PROJECT_NOT_TRACKED',
            'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
            'ASSET_CANVAS_IMAGE_HASH_MISMATCH',
            'ASSET_CANVAS_IMAGE_READ_FAILED',
          ]),
          message: z.string().trim().min(1).max(1_000),
          assetId: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetCanvasImageReadRequest = z.infer<
  typeof AssetCanvasImageReadRequestSchema
>;
export type AssetCanvasImageReadResponse = z.infer<
  typeof AssetCanvasImageReadResponseSchema
>;
