import { assertLayerClipFinalScalesInBounds } from '../evaluate-shot-at-time';
import {
  AnimationKeySchema, sameAnimationTarget,
  type AnimationKey, type AnimationProperty, type AnimationTargetRef,
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
  const edited = ProjectSchema.parse({ ...project, shots: project.shots.map((entry) => entry === shot
    ? { ...shot, layers: shot.layers.map((candidate) => candidate === layer
      ? { ...layer, animationClip: { ...clip, tracks } } : candidate) }
    : entry) });
  if (clip.version === 2) {
    const nextShot = edited.shots.find(({ id }) => id === shot.id)!;
    const nextLayer = nextShot.layers.find(({ id }) => id === layer.id)!;
    assertLayerClipFinalScalesInBounds(nextShot, nextLayer, edited, [next.timeMs]);
  }
  return edited;
}
