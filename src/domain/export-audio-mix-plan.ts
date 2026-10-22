import {
  ExportAudioClipInputSchema,
  ExportAudioMixPlanSchema,
  type ExportAudioClipInput,
  type ExportAudioMixPlan,
} from '../shared/audio-mix-types';
import { audioClipGain, audioClipSourceTimeMs } from './audio-contract';

/**
 * Resolves a preflighted Shot-local audio list into the export mix plan.
 * Invalid or out-of-range clips are rejected; this function never clips or
 * drops caller data to make a plan fit the export duration.
 */
export function buildExportAudioMixPlan(
  durationMs: number,
  rawAudioClips: readonly ExportAudioClipInput[],
): ExportAudioMixPlan {
  const audioClips = rawAudioClips.map((clip) =>
    ExportAudioClipInputSchema.parse(clip),
  );
  const clips = audioClips.map((clip) => ({
    clipId: clip.clipId,
    assetId: clip.assetId,
    role: clip.role,
    sourcePath: clip.sourcePath,
    startMs: clip.startMs,
    endMs: clip.endMs,
    sourceOffsetMs: audioClipSourceTimeMs(clip, clip.startMs),
    volume: audioClipGain(clip.volume),
  }));

  return ExportAudioMixPlanSchema.parse({ durationMs, clips });
}
