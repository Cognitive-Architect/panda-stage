import { z } from 'zod';

export const DESKTOP_AUTOMATION_PROTOCOL = 1 as const;
export const DESKTOP_AUTOMATION_MAX_REQUEST_BYTES = 64 * 1024;
export const DESKTOP_AUTOMATION_TIMEOUT_MS = 20_000;

export const DesktopAutomationCommandSchema = z.object({ name: z.literal('state') }).strict();
export const DesktopAutomationSocketRequestSchema = z.object({
  protocol: z.literal(DESKTOP_AUTOMATION_PROTOCOL),
  credential: z.string().regex(/^[a-f0-9]{64}$/u),
  command: DesktopAutomationCommandSchema,
}).strict();

export const DesktopAutomationStatusSchema = z.object({
  protocol: z.literal(DESKTOP_AUTOMATION_PROTOCOL),
  appVersion: z.string(),
  sessionFile: z.string(),
  cliFile: z.string(),
}).strict().nullable();

export const DesktopAutomationRendererRequestSchema = z.object({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  appVersion: z.string(),
  deadlineMs: z.number().int().positive(),
  command: DesktopAutomationCommandSchema,
}).strict();

export const DesktopAutomationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ ok: z.literal(false), code: z.enum([
    'INVALID_REQUEST', 'UNAUTHORIZED', 'UNAVAILABLE', 'TIMEOUT', 'NO_PROJECT', 'STALE_SESSION', 'COMMAND_FAILED',
  ]), message: z.string() }).strict(),
]);

export const DesktopAutomationRendererResponseSchema = z.object({
  requestId: z.uuid(), result: DesktopAutomationResultSchema,
}).strict();

export type DesktopAutomationRendererRequest = z.infer<typeof DesktopAutomationRendererRequestSchema>;
export type DesktopAutomationRendererResponse = z.infer<typeof DesktopAutomationRendererResponseSchema>;
export type DesktopAutomationResult = z.infer<typeof DesktopAutomationResultSchema>;
export type DesktopAutomationStatus = z.infer<typeof DesktopAutomationStatusSchema>;
