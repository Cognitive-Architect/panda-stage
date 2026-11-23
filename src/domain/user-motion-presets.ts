import { evaluateAnimationTrackAtTime, sliceAnimationCurve } from './evaluate-animation-core';
import type { AnimationKey, AnimationProperty, AnimationTrack, LayerAnimationClip } from './models/animationCore';
import { UserMotionPresetSchema, type UserMotionPreset } from './models/userMotionPreset';
import { frameTimeMs, TIMELINE_FPS } from './timeline/frame-grid';

export const MOTION_PROPERTY_LABELS: Readonly<Record<AnimationProperty, string>> = {
  'transform.offsetX': '水平位置',
  'transform.offsetY': '垂直位置',
  'transform.rotationDeg': '旋转',
  'transform.scaleX': '水平缩放',
  'transform.scaleY': '垂直缩放',
};

const frameNumber = (timeMs: number): number => Math.round(timeMs * TIMELINE_FPS / 1_000);
const scaleProperty = (property: AnimationProperty): boolean =>
  property === 'transform.scaleX' || property === 'transform.scaleY';

function captureTrack(track: AnimationTrack, startMs: number, endMs: number): UserMotionPreset['tracks'][number] {
  const times = [startMs, ...track.keys.map((key) => key.timeMs).filter((time) => time > startMs && time < endMs), endMs];
  const fromFrame = frameNumber(startMs);
  const baseline = evaluateAnimationTrackAtTime(track, startMs);
  const scale = scaleProperty(track.property);
  const keys: UserMotionPreset['tracks'][number]['keys'] = [];
  const capture = (timeMs: number, interpolationToNext: AnimationKey['interpolationToNext'], curveToNext?: AnimationKey['curveToNext']): void => {
    const value = evaluateAnimationTrackAtTime(track, timeMs);
    keys.push({ frameOffset: frameNumber(timeMs) - fromFrame, value: scale ? value / baseline : value - baseline,
      interpolationToNext, ...(curveToNext ? { curveToNext } : {}) });
  };
  let authoredIndex = 0;
  for (let index = 0; index < times.length - 1; index += 1) {
    const from = times[index]!;
    const to = times[index + 1]!;
    while (track.keys[authoredIndex + 1] && track.keys[authoredIndex + 1]!.timeMs <= from) {
      authoredIndex += 1;
    }
    const previous = track.keys[authoredIndex];
    const next = track.keys[authoredIndex + 1];
    const interpolation = previous?.interpolationToNext ?? 'linear';
    const curve = previous?.curveToNext;
    if (!previous || !next || (!curve && (interpolation === 'linear' || interpolation === 'step')) ||
      (previous.timeMs === from && next.timeMs === to)) {
      capture(from, interpolation, next ? curve : undefined);
    } else {
      const duration = next.timeMs - previous.timeMs;
      capture(from, interpolation, sliceAnimationCurve(curve, (from - previous.timeMs) / duration, (to - previous.timeMs) / duration));
    }
  }
  capture(endMs, 'step');
  return { property: track.property, keys };
}

export function captureUserMotionPreset(clip: LayerAnimationClip, id: string, name: string, startMs: number, endMs: number): UserMotionPreset {
  const tracks = clip.tracks.map((track) => captureTrack(track, startMs, endMs))
    .filter(({ property, keys }) => keys.some(({ value }) => value !== (scaleProperty(property) ? 1 : 0)));
  if (!tracks.length) throw new Error('这个时段内没有可保存的运动。');
  return UserMotionPresetSchema.parse({ id, name, durationFrames: frameNumber(endMs) - frameNumber(startMs), tracks });
}

export function userMotionPresetRange(preset: UserMotionPreset, startMs: number, shotDurationMs: number) {
  const frame = frameNumber(startMs);
  const endMs = frameTimeMs(frame + preset.durationFrames);
  if (endMs > shotDurationMs) throw new Error('预设时段超出当前镜头。');
  const nextFrameMs = frameTimeMs(frame + preset.durationFrames + 1);
  return { endMs, restoreAtMs: nextFrameMs <= shotDurationMs ? nextFrameMs : null };
}

export function applyUserMotionPresetTracks(
  clip: LayerAnimationClip, layerId: string, preset: UserMotionPreset, startMs: number, shotDurationMs: number,
): LayerAnimationClip['tracks'] {
  const startFrame = frameNumber(startMs);
  const { endMs, restoreAtMs } = userMotionPresetRange(preset, startMs, shotDurationMs);
  const existing = new Map(clip.tracks.map((track) => [track.property, track]));
  const conflicts = preset.tracks.filter(({ property }) => {
    const keys = existing.get(property)?.keys;
    return keys && keys.length > 1 && keys.at(-1)!.timeMs >= startMs;
  });
  if (conflicts.length) {
    throw new Error(`时段 ${startMs}–${endMs} ms 与已有运动重叠：${conflicts.map(({ property }) => MOTION_PROPERTY_LABELS[property]).join('、')}。请选择这些属性的空闲时段。`);
  }

  for (const { property, keys } of preset.tracks) {
    const track = existing.get(property);
    const scale = scaleProperty(property);
    const baseline = track ? evaluateAnimationTrackAtTime(track, startMs) : scale ? 1 : 0;
    const authored: AnimationKey[] = keys.map(({ frameOffset, value, interpolationToNext, curveToNext }) => ({
      timeMs: frameTimeMs(startFrame + frameOffset),
      value: scale ? baseline * value : baseline + value,
      interpolationToNext,
      ...(curveToNext ? { curveToNext } : {}),
    }));
    const earlier: AnimationKey[] = startMs === 0 ? [] : track?.keys ?? [{ timeMs: 0, value: baseline, interpolationToNext: 'step' }];
    const restore: AnimationKey[] = restoreAtMs === null ? [] : [{ timeMs: restoreAtMs, value: baseline, interpolationToNext: 'step' }];
    existing.set(property, { target: { kind: 'layer', layerId }, property, keys: [...earlier, ...authored, ...restore] });
  }
  return [...existing.values()];
}
