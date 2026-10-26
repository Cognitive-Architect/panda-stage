import {
  ExportAudioClipInputSchema,
  ExportAudioMixPlanSchema,
  type ExportAudioClipInput,
  type ExportAudioMixPlan,
} from '../shared/audio-mix-types';
import { audioClipGain, audioClipSourceTimeMs } from './audio-contract';

/**
 * Resolves audio into the portion that belongs to a legacy full-probe export.
 * Formal Project exports use the strict builder below instead.
 */
export function buildExportAudioMixPlan(
  durationMs: number,
  rawAudioClips: readonly ExportAudioClipInput[],
): ExportAudioMixPlan {
  const audioClips = rawAudioClips.map((clip) =>
    ExportAudioClipInputSchema.parse(clip),
  );
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

/**
 * Resolves preflighted Project audio without clipping or dropping caller data,
 * and keeps the mix alive through the complete Project including a silent tail.
 */
export function buildFormalExportAudioMixPlan(
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

  return ExportAudioMixPlanSchema.parse({
    durationMs,
    clips,
    preserveSilentTail: true,
  });
}
