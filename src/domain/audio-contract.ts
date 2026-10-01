import type { AudioClip } from './models/audio';

export function audioClipDurationMs(
  clip: Pick<AudioClip, 'startMs' | 'endMs'>,
): number {
  return clip.endMs - clip.startMs;
}

export function isAudioClipActiveAtTime(
  clip: Pick<AudioClip, 'startMs' | 'endMs'>,
  timeMs: number,
): boolean {
  return Number.isFinite(timeMs) && clip.startMs <= timeMs && timeMs < clip.endMs;
}

export function audioClipSourceTimeMs(
  clip: Pick<AudioClip, 'startMs' | 'offsetMs'>,
  timeMs: number,
): number {
  return clip.offsetMs + timeMs - clip.startMs;
}

/** Linear amplitude, not HTMLMediaElement.volume (which cannot exceed 1). */
export function audioClipGain(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 2) {
    throw new Error('Audio gain must be a finite number within 0..2.');
  }
  return volume;
}
