import { z } from 'zod';

const RequestIdSchema = z.string().trim().min(1).max(200);

export const NativeCloseSyncRequestSchema = z
  .object({
    requestId: RequestIdSchema,
  })
  .strict();

export const NativeCloseSyncResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      requestId: RequestIdSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      requestId: RequestIdSchema,
      error: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

export type NativeCloseSyncRequest = z.infer<
  typeof NativeCloseSyncRequestSchema
>;
export type NativeCloseSyncResponse = z.infer<
  typeof NativeCloseSyncResponseSchema
>;
