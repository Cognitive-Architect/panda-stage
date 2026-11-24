import { z } from 'zod';
import { AssetImportProjectRequestSchema } from './asset-import-api';
import { FlaImportErrorSchema } from './fla-import-api';

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
