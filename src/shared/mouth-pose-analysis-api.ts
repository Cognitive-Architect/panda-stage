import { z } from 'zod';
import { AssetDialogueSilenceRequestSchema } from './asset-preview-audio-api';

export const MAX_MOUTH_POSE_ANALYSIS_MS = 120_000;
export const MOUTH_POSE_SAMPLE_RATE = 8_000;
export const MouthPoseAnalysisRequestSchema = AssetDialogueSilenceRequestSchema.extend({
  requestId: z.uuid(),
  sourceStartMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  durationMs: z.number().int().positive().max(MAX_MOUTH_POSE_ANALYSIS_MS),
});
export const MouthPoseAnalysisCancelSchema = z.object({ requestId: z.uuid() }).strict();
export const MouthPoseAnalysisResponseSchema = z.array(z.object({
  startMs: z.number().int().nonnegative().max(MAX_MOUTH_POSE_ANALYSIS_MS),
  endMs: z.number().int().positive().max(MAX_MOUTH_POSE_ANALYSIS_MS),
  category: z.enum(['rest', 'open', 'wide', 'round', 'closed']),
}).strict()).max(6_000).nullable();
export type MouthPoseAnalysisRequest = z.infer<typeof MouthPoseAnalysisRequestSchema>;
export type MouthPoseAnalysisResponse = z.infer<typeof MouthPoseAnalysisResponseSchema>;
