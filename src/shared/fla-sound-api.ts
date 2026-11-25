import { z } from 'zod';
import { ProjectSchema } from '../domain';
import { AssetImportErrorSchema, AssetImportProjectRequestSchema } from './asset-import-api';
import { FlaFrameSoundSyncSchema, FlaImportErrorSchema } from './fla-import-api';

export const FLA_SOUND_MAX_BYTES = 16 * 1024 * 1024;
export const FLA_SOUND_MAX_SECONDS = 120;

export const FlaSoundPreviewRequestSchema = z.object({
  sessionId: z.uuid(),
  requestId: z.uuid(),
  soundId: z.string().min(1).max(200),
}).strict();

export const FlaSoundCancelRequestSchema = FlaSoundPreviewRequestSchema.omit({ soundId: true });

export const FlaSoundImportRequestSchema = AssetImportProjectRequestSchema.extend({
  sessionId: z.uuid(),
  soundId: z.string().min(1).max(200),
}).strict();

export const FlaSoundTimelineDiagnosticCodeSchema = z.enum([
  'unsupported-sync',
  'unsupported-loop',
  'unresolved-sound',
  'missing-audio-asset',
  'outside-shot-boundary',
  'empty-source-range',
  'zero-duration-clip',
]);

export const FlaSoundTimelineDiagnosticSchema = z.object({
  code: FlaSoundTimelineDiagnosticCodeSchema,
  soundName: z.string().min(1).max(260),
  frameIndex: z.number().int().nonnegative(),
  layerIndex: z.number().int().nonnegative().optional(),
  sync: FlaFrameSoundSyncSchema.optional(),
  message: z.string().min(1).max(1_000),
}).strict();

export const FlaSoundTimelineImportRequestSchema = AssetImportProjectRequestSchema.extend({
  sessionId: z.uuid(),
  shotId: z.uuid(),
  timelineIndex: z.number().int().nonnegative(),
  role: z.enum(['bgm', 'sfx']).optional(),
}).strict();

export const FlaSoundTimelineImportResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.literal('completed'),
    project: ProjectSchema,
    baseRevision: z.number().int().nonnegative(),
    savedRevision: z.number().int().nonnegative(),
    projectChanged: z.boolean(),
    importedAssetIds: z.array(z.uuid()),
    createdClipIds: z.array(z.uuid()),
    diagnostics: z.array(FlaSoundTimelineDiagnosticSchema),
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: AssetImportErrorSchema,
  }).strict(),
]);

export const FlaSoundPreviewResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= FLA_SOUND_MAX_BYTES),
    mimeType: z.enum(['audio/mpeg', 'audio/wav']),
    durationMs: z.number().positive().max(FLA_SOUND_MAX_SECONDS * 1000),
    sampleRate: z.number().int().positive().max(96000),
    channels: z.number().int().min(1).max(2),
  }).strict(),
  z.object({ ok: z.literal(false), error: FlaImportErrorSchema }).strict(),
]);

export type FlaSoundPreviewRequest = z.infer<typeof FlaSoundPreviewRequestSchema>;
export type FlaSoundCancelRequest = z.infer<typeof FlaSoundCancelRequestSchema>;
export type FlaSoundImportRequest = z.infer<typeof FlaSoundImportRequestSchema>;
export type FlaSoundPreviewResponse = z.infer<typeof FlaSoundPreviewResponseSchema>;
export type FlaSoundTimelineDiagnostic = z.infer<typeof FlaSoundTimelineDiagnosticSchema>;
export type FlaSoundTimelineImportRequest = z.infer<typeof FlaSoundTimelineImportRequestSchema>;
export type FlaSoundTimelineImportResponse = z.infer<typeof FlaSoundTimelineImportResponseSchema>;
