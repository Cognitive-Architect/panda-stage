import { assertLayerClipFinalScalesInBounds } from '../evaluate-shot-at-time';
import { evaluateAnimationTrackAtTime, sliceAnimationCurve } from '../evaluate-animation-core';
import {
  AnimationKeySchema, sameAnimationTarget,
  type AnimationKey, type AnimationProperty, type AnimationTargetRef,
  type AnimationTrack,
} from '../models/animationCore';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';

export interface AnimationPropertyKeyAddress {
  shotId: string;
  target: AnimationTargetRef;
  property: AnimationProperty;
  keyTimeMs: number;
}

/** Edit exactly one authored property key. The renderer may evaluate this as a draft before a single commit. */
export function editAnimationPropertyKey(
  project: Project, address: AnimationPropertyKeyAddress, change: Partial<AnimationKey>,
): Project {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.target.layerId);
  const clip = layer?.animationClip;
  if (!shot || !layer || !clip || layer.locked) throw new Error('所选对象动作已不可编辑。');
  const track = clip.tracks.find((candidate) => candidate.property === address.property &&
    sameAnimationTarget(candidate.target, address.target));
  const index = track?.keys.findIndex(({ timeMs }) => timeMs === address.keyTimeMs) ?? -1;
  const key = track?.keys[index];
  if (!track || !key) throw new Error('所选属性关键帧已不存在。');
  const next = AnimationKeySchema.parse({ ...key, ...change });
  const previous = track.keys[index - 1];
  const following = track.keys[index + 1];
  if (!isValidFrameTime(next.timeMs) || next.timeMs > shot.durationMs ||
    (index === 0 && next.timeMs !== 0) ||
    (previous && next.timeMs <= previous.timeMs) || (following && next.timeMs >= following.timeMs)) {
    throw new Error('关键帧必须留在相邻关键帧之间，起始键固定在零帧。');
  }
  if (next.curveToNext && !following) throw new Error('尾帧没有可编辑的后续曲线。');
  if (JSON.stringify(next) === JSON.stringify(key)) return project;
  const tracks = clip.tracks.map((candidate) => candidate === track
    ? { ...track, keys: track.keys.map((entry) => entry === key ? next : entry) }
    : candidate);
  return commitTrackChanges(project, shot, layer, tracks, [next.timeMs]);
}

function commitTrackChanges(
  project: Project, shot: Project['shots'][number], layer: Project['shots'][number]['layers'][number],
  tracks: readonly AnimationTrack[], checkTimes: readonly number[],
): Project {
  const clip = layer.animationClip;
  if (!clip) return project;
  const edited = ProjectSchema.parse({ ...project, shots: project.shots.map((entry) => entry === shot
    ? { ...shot, layers: shot.layers.map((candidate) => candidate === layer
      ? { ...layer, animationClip: { ...clip, tracks } } : candidate) }
    : entry) });
  if (clip.version === 2) {
    const nextShot = edited.shots.find(({ id }) => id === shot.id)!;
    const nextLayer = nextShot.layers.find(({ id }) => id === layer.id)!;
    assertLayerClipFinalScalesInBounds(nextShot, nextLayer, edited, checkTimes);
  }
  return edited;
}

/** Record the current pose on explicitly selected targets without changing either side of a tween. */
export function keySelectedAnimationTargets(
  project: Project, shotId: string, layerId: string, targets: readonly AnimationTargetRef[], timeMs: number,
): { project: Project; inserted: number; skipped: number } {
  const shot = project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  const clip = layer?.animationClip;
  if (!shot || !layer || !clip || layer.locked) throw new Error('所选对象动作已不可编辑。');
  if (!isValidFrameTime(timeMs) || timeMs > shot.durationMs) throw new Error('播放头必须停在镜头内的有效帧。');
  const skipped = targets.filter((target) => !clip.tracks.some((track) => sameAnimationTarget(target, track.target))).length;
  let inserted = 0;
  const tracks = clip.tracks.map((track) => {
    if (!targets.some((target) => sameAnimationTarget(target, track.target)) ||
      track.keys.some((key) => key.timeMs === timeMs)) return track;
    const keys = [...track.keys];
    const later = keys.findIndex((key) => key.timeMs > timeMs);
    const index = later < 0 ? keys.length : later;
    const previous = keys[index - 1]!;
    const following = keys[index];
    const key: AnimationKey = {
      timeMs, value: evaluateAnimationTrackAtTime(track, timeMs),
      interpolationToNext: following ? previous.interpolationToNext : 'step',
    };
    if (following && (previous.curveToNext ||
      (previous.interpolationToNext !== 'step' && previous.interpolationToNext !== 'linear'))) {
      const fraction = (timeMs - previous.timeMs) / (following.timeMs - previous.timeMs);
      key.curveToNext = sliceAnimationCurve(previous.curveToNext, fraction, 1);
      keys[index - 1] = { ...previous, curveToNext: sliceAnimationCurve(previous.curveToNext, 0, fraction) };
    }
    keys.splice(index, 0, key);
    inserted += 1;
    return { ...track, keys };
  });
  return { project: inserted ? commitTrackChanges(project, shot, layer, tracks, [timeMs]) : project, inserted, skipped };
}
