import { audioClipSourceTimeMs, audioMotionSampleTimes, smoothAudioMotionLevels, type AudioClip } from '../../../domain';
import type { EditorAudioClipSamples } from '../../shell/productPreviewAudio';

const BLOCK = 128;

export function buildWaveformPeaks(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData' | 'length' | 'sampleRate'>) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const low = new Float32Array(Math.ceil(buffer.length / BLOCK));
  const high = new Float32Array(low.length);
  for (const samples of channels) {
    for (let index = 0; index < samples.length; index += 1) {
      const block = Math.floor(index / BLOCK);
      low[block] = Math.min(low[block]!, samples[index]!);
      high[block] = Math.max(high[block]!, samples[index]!);
    }
  }
  return (startMs: number, endMs: number): readonly [number, number] => {
    const start = Math.max(0, Math.floor(startMs * buffer.sampleRate / 1_000));
    const end = Math.min(buffer.length, Math.max(start + 1, Math.ceil(endMs * buffer.sampleRate / 1_000)));
    let min = 0;
    let max = 0;
    for (let index = start; index < end;) {
      if (index % BLOCK === 0 && end - index >= BLOCK) {
        min = Math.min(min, low[index / BLOCK]!);
        max = Math.max(max, high[index / BLOCK]!);
        index += BLOCK;
      } else {
        for (const samples of channels) {
          min = Math.min(min, samples[index]!);
          max = Math.max(max, samples[index]!);
        }
        index += 1;
      }
    }
    return [min, max];
  };
}

export function projectWaveformViewport(clip: Pick<AudioClip, 'startMs' | 'endMs' | 'offsetMs'>,
  pixelsPerMs: number, scrollPx: number, viewportWidth: number, laneLabelWidth: number) {
  if (pixelsPerMs <= 0 || viewportWidth <= laneLabelWidth) return null;
  const clipLeft = laneLabelWidth + clip.startMs * pixelsPerMs;
  const fromPx = Math.max(0, scrollPx + laneLabelWidth - clipLeft);
  const toPx = Math.min((clip.endMs - clip.startMs) * pixelsPerMs, scrollPx + viewportWidth - clipLeft);
  if (toPx <= fromPx) return null;
  return {
    fromPx, width: toPx - fromPx,
    sourceStartMs: audioClipSourceTimeMs(clip, clip.startMs + fromPx / pixelsPerMs),
  };
}

export function sampleAudioMotionLevels(samples: EditorAudioClipSamples, clip: AudioClip, startMs: number, endMs: number) {
  const { buffer, sourceStartMs } = samples;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const halfWindow = 24;
  const sourceIndex = (timeMs: number) => Math.min(buffer.length, Math.max(0,
    Math.round((audioClipSourceTimeMs(clip, timeMs) - sourceStartMs) * buffer.sampleRate / 1_000)));
  const levels = audioMotionSampleTimes(startMs, endMs).map((timeMs) => {
    const first = sourceIndex(Math.max(startMs, timeMs - halfWindow));
    const end = sourceIndex(Math.min(endMs, timeMs + halfWindow));
    let energy = 0;
    for (const pcm of channels) {
      for (let index = first; index < end; index += 1) energy += pcm[index]! ** 2;
    }
    return { timeMs, level: Math.sqrt(energy / Math.max(1, (end - first) * channels.length)) };
  });
  return smoothAudioMotionLevels(levels);
}
