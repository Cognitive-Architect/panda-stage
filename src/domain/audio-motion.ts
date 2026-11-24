import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import type { AnimationKey, AnimationProperty, LayerAnimationClip } from './models/animationCore';
import { frameTimeMs, TIMELINE_FPS } from './timeline/frame-grid';

export interface AudioMotionLevel {
  timeMs: number;
  level: number;
}

export interface AudioMotionDraft {
  startMs: number;
  endMs: number;
  property: 'vertical' | 'uniform-scale';
  strength: number;
  replaceExisting: boolean;
  levels: readonly AudioMotionLevel[];
}

/** Shape bounded energy. Preserve pauses instead of smoothing across speech gaps. */
export function smoothAudioMotionLevels(raw: readonly AudioMotionLevel[]): AudioMotionLevel[] {
  const peak = raw.reduce((maximum, entry) => Math.max(maximum, entry.level), 0);
  const threshold = Math.max(0.004, peak * 0.08);
  const normalized = raw.map(({ level }) => peak > threshold ? Math.max(0, (level - threshold) / (peak - threshold)) : 0);
  return raw.map(({ timeMs }, index) => {
    const current = normalized[index]!;
    return { timeMs, level: current === 0 ? 0
      : current * 0.68 + (normalized[index - 1] ?? current) * 0.16 + (normalized[index + 1] ?? current) * 0.16 };
  });
}

export function audioMotionSampleTimes(startMs: number, endMs: number): number[] {
  const startFrame = Math.round(startMs * TIMELINE_FPS / 1_000);
  const endFrame = Math.round(endMs * TIMELINE_FPS / 1_000);
  const stride = Math.max(2, Math.ceil((endFrame - startFrame) / 320));
  const times: number[] = [];
  for (let frame = startFrame + 1; frame < endFrame; frame += stride) times.push(frameTimeMs(frame));
  return times;
}

function boundaryKey(keys: readonly AnimationKey[], timeMs: number, value: number): AnimationKey {
  const exact = keys.find((key) => key.timeMs === timeMs);
  if (exact) return exact;
  const later = keys.findIndex((key) => key.timeMs > timeMs);
  const prior = later > 0 ? keys[later - 1]! : undefined;
  if (prior && prior.value !== keys[later]!.value &&
    (prior.interpolationToNext !== 'step' || prior.curveToNext?.bezier)) {
    throw new Error('所选边界穿过已有缓动。请把边界移到已有关键帧或平稳段，以保留范围外的运动。');
  }
  return { timeMs, value, interpolationToNext: 'step' };
}

export function buildAudioMotionTracks(clip: LayerAnimationClip, layerId: string, draft: AudioMotionDraft): LayerAnimationClip['tracks'] {
  const affected: readonly AnimationProperty[] = draft.property === 'vertical'
    ? ['transform.offsetY'] : ['transform.scaleX', 'transform.scaleY'];
  const tracks = new Map(clip.tracks.map((track) => [track.property, track]));
  for (const property of affected) {
    const track = tracks.get(property);
    const keys = track?.keys ?? [];
    if (!draft.replaceExisting && keys.some(({ timeMs }) => timeMs > draft.startMs && timeMs < draft.endMs)) {
      throw new Error('选定时段已有手工关键帧。请选择空闲时段，或确认替换时段内的关键帧。');
    }
    const scale = draft.property === 'uniform-scale';
    const baseAt = (timeMs: number): number => track
      ? evaluateAnimationTrackAtTime(track, timeMs) : scale ? 1 : 0;
    const start = boundaryKey(keys, draft.startMs, baseAt(draft.startMs));
    const end = boundaryKey(keys, draft.endMs, baseAt(draft.endMs));
    const earlier: AnimationKey[] = keys.filter(({ timeMs }) => timeMs < draft.startMs);
    if (draft.startMs > 0 && !earlier.length) earlier.push({ timeMs: 0, value: baseAt(0), interpolationToNext: 'step' });
    const samples: AnimationKey[] = draft.levels.map(({ timeMs, level }) => ({
      timeMs, interpolationToNext: 'linear',
      value: scale ? baseAt(timeMs) * (1 + level * draft.strength * 0.12) : baseAt(timeMs) - level * draft.strength * 20,
    }));
    tracks.set(property, { target: { kind: 'layer', layerId }, property, keys: [
      ...earlier,
      { timeMs: start.timeMs, value: start.value, interpolationToNext: 'linear' },
      ...samples,
      end,
      ...keys.filter(({ timeMs }) => timeMs > draft.endMs),
    ] });
  }
  return [...tracks.values()];
}
