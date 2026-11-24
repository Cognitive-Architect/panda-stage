import { z } from 'zod';

export const DESKTOP_AUTOMATION_PROTOCOL = 1 as const;
export const DESKTOP_AUTOMATION_MAX_REQUEST_BYTES = 64 * 1024;
export const DESKTOP_AUTOMATION_TIMEOUT_MS = 20_000;

const TimeMsSchema = z.number().int().nonnegative();
const PresetParametersSchema = z.object({
  startMs: TimeMsSchema.optional(), durationMs: z.number().int().positive().optional(),
  targetX: z.number().finite().optional(), targetY: z.number().finite().optional(), scaleFactor: z.number().finite().optional(),
  amplitudeX: z.number().finite().optional(), amplitudeY: z.number().finite().optional(), frequencyHz: z.number().finite().optional(),
  expressionId: z.uuid().optional(),
}).strict();
const DialogueEditSchema = z.object({ name: z.literal('dialogue.update'), shotId: z.uuid(), dialogueId: z.uuid(),
  text: z.string().trim().min(1).max(8_000) }).strict();
const PresetEditSchema = z.object({ name: z.literal('preset.apply'), shotId: z.uuid(), layerId: z.uuid(),
  presetId: z.enum(['enter-left', 'enter-right', 'move-to', 'scale-emphasis', 'shake', 'expression-switch', 'fade-in', 'fade-out']),
  parameters: PresetParametersSchema.optional(),
}).strict();
const RecipeShape = { shotId: z.uuid(), layerId: z.uuid(), recipeId: z.uuid(), startMs: TimeMsSchema,
  bindings: z.record(z.uuid(), z.uuid().nullable()) };
const RecipeEditSchema = z.object({ name: z.literal('recipe.apply'), ...RecipeShape }).strict();
const UndoSchema = z.object({ name: z.literal('undo') }).strict();
const EditSchema = z.discriminatedUnion('name', [DialogueEditSchema, PresetEditSchema, RecipeEditSchema]);
const SessionSchema = z.object({ sessionId: z.uuid(), projectId: z.uuid(), instanceId: z.number().int().nonnegative() }).strict();
const Scene = { session: SessionSchema };
export const DesktopAutomationCommandSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('state') }).strict(),
  DialogueEditSchema.extend(Scene), PresetEditSchema.extend(Scene), RecipeEditSchema.extend(Scene), UndoSchema.extend(Scene),
  z.object({ name: z.literal('recipe.preview'), ...RecipeShape, ...Scene }).strict(),
  z.object({ name: z.literal('batch'), ...Scene, operations: z.array(EditSchema).min(1).max(32) }).strict(),
  z.object({ name: z.literal('sequence'), ...Scene, operations: z.array(z.union([EditSchema, UndoSchema])).min(1).max(32) }).strict(),
]);
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
export type DesktopAutomationEdit = z.infer<typeof EditSchema>;
export type DesktopAutomationSession = z.infer<typeof SessionSchema>;
