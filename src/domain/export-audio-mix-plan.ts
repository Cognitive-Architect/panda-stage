import {
  ExportAudioMixPlanSchema,
  type ExportAudioClipInput,
  type ExportAudioMixPlan,
} from '../shared/audio-mix-types';
import { audioClipGain, audioClipSourceTimeMs } from './audio-contract';

/**
 * Resolves Shot-local audio into the portion that belongs to this export.
 * All roles share the persisted AudioClip timing and gain contract.
 */
export function buildExportAudioMixPlan(
  durationMs: number,
  audioClips: readonly ExportAudioClipInput[],
): ExportAudioMixPlan {
  const clips = audioClips.flatMap((clip) => {
    const startMs = clip.startMs;
    const endMs = Math.min(clip.endMs, durationMs);
    if (startMs >= durationMs || endMs <= startMs) return [];

    return [
      {
        clipId: clip.clipId,
        assetId: clip.assetId,
        role: clip.role,
        sourcePath: clip.sourcePath,
        startMs,
        endMs,
        sourceOffsetMs: audioClipSourceTimeMs(clip, startMs),
        volume: audioClipGain(clip.volume),
      },
    ];
  });

  return ExportAudioMixPlanSchema.parse({ durationMs, clips });
}
