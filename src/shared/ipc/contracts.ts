import { z } from 'zod';

export const AppPingRequestSchema = z.object({}).strict();
export const AppPingResponseSchema = z
  .object({
    message: z.literal('pong'),
    receivedAtMs: z.number().int().nonnegative(),
  })
  .strict();

export const HiddenReadyRequestSchema = z
  .object({
    role: z.literal('hidden-renderer'),
    loadedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export const HiddenReadyResponseSchema = z
  .object({
    acknowledged: z.literal(true),
    role: z.literal('hidden-renderer'),
  })
  .strict();

export type AppPingResponse = z.infer<typeof AppPingResponseSchema>;
export type HiddenReadyResponse = z.infer<typeof HiddenReadyResponseSchema>;
