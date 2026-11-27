import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
} from '../constants';
import {
  assertLayerClipFinalScalesInBounds,
  evaluateLayerPreTrackState,
} from '../evaluate-shot-at-time';
import { evaluateAnimationTrackAtTime, insertAnimationTrackSample } from '../evaluate-animation-core';
import {
  evaluateRichEasing,
  isRichEasingPresetId,
  type RichEasingPresetId,
} from '../geometry/richEasing';
import {
  AnimationKeySchema, sameAnimationTarget,
  type AnimationKey, type AnimationProperty, type AnimationTargetRef,
  type AnimationTrack,
} from '../models/animationCore';
import { ProjectSchema, type Project } from '../models/project';
import { OpacityEventSchema } from '../models/timeline-event';
import { frameTimeMs, isValidFrameTime, TIMELINE_FPS } from '../timeline/frame-grid';

export interface AnimationPropertyKeyAddress {
  shotId: string;
  target: AnimationTargetRef;
  property: AnimationProperty;
  keyTimeMs: number;
}

export type CurveEditableProperty = AnimationProperty | 'opacity';

export interface RichEasingPropertyApplicability {
  readonly applicable: boolean;
  readonly reason?: string;
}

export interface BakeRichEasingInput {
  readonly shotId: string;
  readonly target: AnimationTargetRef;
  readonly property: CurveEditableProperty;
  readonly presetId: RichEasingPresetId;
  /**
   * Two or more existing keyframe timestamps on the target property track.
   * Each adjacent segment spanning the selected keyframes is baked separately
   * on the 24 FPS Shot-local frame grid while preserving all existing manual
   * anchor keyframes.
   */
  readonly keyTimesMs: readonly number[];
}

export interface BakeRichEasingResult {
  readonly project: Project;
  readonly bakedSegments: number;
  readonly insertedKeys: number;
  readonly preservedAnchorTimesMs: readonly number[];
  readonly clampedScaleSamples: number;
}

const OPACITY_INAPPLICABLE_REASON =
  '透明度使用单段事件而非属性关键帧轨，暂不支持烘焙高级缓动关键帧。';

/**
 * Determine whether a curve-panel property supports rich easing native keyframe
 * baking. Opacity is modeled as a single `OpacityEvent` interval rather than a
 * multi-keyframe `AnimationTrack`, so it is explicitly locally inapplicable.
 */
export function getRichEasingPropertyApplicability(
  property: CurveEditableProperty,
  presetId?: RichEasingPresetId,
): RichEasingPropertyApplicability {
  if (presetId !== undefined && !isRichEasingPresetId(presetId)) {
    return { applicable: false, reason: '不支持的高级缓动预设。' };
  }
  if (property === 'opacity') {
    return { applicable: false, reason: OPACITY_INAPPLICABLE_REASON };
  }
  return { applicable: true };
}

/** Edit an endpoint of the existing opacity interval, preserving its event identity and ownership. */
export function editOpacityEventKey(
  project: Project, shotId: string, layerId: string, eventId: string, timeMs: number, change: Partial<AnimationKey>,
): Project {
  const shot = project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  const event = shot?.timelineEvents.find((entry) => entry.id === eventId && entry.layerId === layerId);
  if (!shot || !layer || layer.locked || event?.type !== 'opacity' || event.startMs >= event.endMs ||
    (timeMs !== event.startMs && timeMs !== event.endMs)) throw new Error('所选透明度区段已不可编辑。');
  const start = timeMs === event.startMs;
  const next = OpacityEventSchema.parse({
    ...event,
    ...(start ? {
      startMs: change.timeMs ?? event.startMs,
      from: change.value ?? event.from,
      easing: change.interpolationToNext ?? event.easing,
      curveToNext: 'curveToNext' in change ? change.curveToNext : event.curveToNext,
    } : { endMs: change.timeMs ?? event.endMs, to: change.value ?? event.to }),
  });
  if (next.startMs >= next.endMs || next.endMs > shot.durationMs) throw new Error('透明度起止必须在镜头内且保持顺序。');
  if (JSON.stringify(next) === JSON.stringify(event)) return project;
  return ProjectSchema.parse({ ...project, shots: project.shots.map((entry) => entry === shot
    ? { ...shot, timelineEvents: shot.timelineEvents.map((item) => item === event ? next : item) } : entry) });
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
    const keys = insertAnimationTrackSample(track.keys, timeMs);
    inserted += 1;
    return { ...track, keys };
  });
  return { project: inserted ? commitTrackChanges(project, shot, layer, tracks, [timeMs]) : project, inserted, skipped };
}

export type AnimationPropertyRangeEdit =
  | { kind: 'insert'; startMs: number; endMs: number; count: number }
  | { kind: 'delete'; startMs: number; endMs: number }
  | { kind: 'paste'; timeMs: number; keys: readonly AnimationKey[]; overwrite: boolean };

const animationFrameIndex = (timeMs: number): number => Math.round(timeMs * TIMELINE_FPS / 1_000);

export function placeAnimationPropertyKeys(keys: readonly AnimationKey[], timeMs: number): AnimationKey[] {
  const sourceStart = animationFrameIndex(keys[0]?.timeMs ?? 0);
  const destinationStart = animationFrameIndex(timeMs);
  return keys.map((key) => ({
    ...key, timeMs: frameTimeMs(destinationStart + animationFrameIndex(key.timeMs) - sourceStart),
  }));
}

export function availableAnimationPropertyFrames(
  keys: readonly AnimationKey[], startMs: number, endMs: number,
): number[] {
  const occupied = new Set(keys.map(({ timeMs }) => timeMs));
  const available: number[] = [];
  for (let frame = animationFrameIndex(startMs) + 1; frame < animationFrameIndex(endMs); frame += 1) {
    const timeMs = frameTimeMs(frame);
    if (!occupied.has(timeMs)) available.push(timeMs);
  }
  return available;
}

export function editAnimationPropertyRange(
  project: Project, address: Omit<AnimationPropertyKeyAddress, 'keyTimeMs'>, edit: AnimationPropertyRangeEdit,
): Project {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.target.layerId);
  const clip = layer?.animationClip;
  if (!shot || !layer || !clip || layer.locked) throw new Error('所选对象动作已不可编辑。');
  const track = clip.tracks.find((candidate) => candidate.property === address.property &&
    sameAnimationTarget(candidate.target, address.target));
  if (!track) throw new Error('所选属性轨道已不存在。');

  let keys = track.keys;
  let checkTimes: number[];
  if (edit.kind === 'paste') {
    if (!isValidFrameTime(edit.timeMs) || edit.timeMs < 0 || !edit.keys.length ||
      edit.keys.some(({ timeMs }, index) => !isValidFrameTime(timeMs) ||
        (index > 0 && timeMs <= edit.keys[index - 1]!.timeMs))) throw new Error('复制的关键帧或粘贴起点无效。');
    const pasted = placeAnimationPropertyKeys(edit.keys, edit.timeMs);
    const end = pasted.at(-1)!.timeMs;
    if (pasted[0]!.timeMs === 0 || end > shot.durationMs) throw new Error('粘贴会覆盖固定零帧或超出镜头范围。');
    const colliding = keys.filter(({ timeMs }) => timeMs >= edit.timeMs && timeMs <= end);
    if (colliding.length && !edit.overwrite) throw new Error('粘贴范围内已有关键帧，请调整起点或明确选择覆盖。');
    const first = pasted[0]!;
    const last = pasted.at(-1)!;
    const startChanges = first.value !== evaluateAnimationTrackAtTime(track, first.timeMs);
    const endChanges = last.value !== evaluateAnimationTrackAtTime(track, end);
    // A replaced endpoint may jump. Preserve the original curve as far as the
    // adjacent frame outside the paste, and isolate the jump to a one-frame bridge.
    const leftTime = startChanges ? frameTimeMs(animationFrameIndex(first.timeMs) - 1) : first.timeMs;
    const rightTime = endChanges ? frameTimeMs(animationFrameIndex(end) + 1) : end;
    const left = insertAnimationTrackSample(keys, leftTime).filter(({ timeMs }) => timeMs < first.timeMs);
    if (startChanges) {
      left[left.length - 1] = { ...left.at(-1)!, interpolationToNext: 'step', curveToNext: undefined };
    }
    const right = rightTime <= shot.durationMs ? insertAnimationTrackSample(keys, rightTime) : keys;
    const outgoing = !endChanges ? right.find(({ timeMs }) => timeMs === end) : undefined;
    pasted[pasted.length - 1] = {
      ...last,
      interpolationToNext: outgoing?.interpolationToNext ?? 'step',
      curveToNext: outgoing?.curveToNext,
    };
    keys = [...left, ...pasted, ...right.filter(({ timeMs }) => timeMs > end)];
    checkTimes = [...pasted.map(({ timeMs }) => timeMs), leftTime];
    if (rightTime <= shot.durationMs) checkTimes.push(rightTime);
  } else {
    if (edit.startMs >= edit.endMs || !keys.some(({ timeMs }) => timeMs === edit.startMs) ||
      !keys.some(({ timeMs }) => timeMs === edit.endMs)) throw new Error('请选择两个有效的区段边界。');
    if (edit.kind === 'delete') {
      keys = keys.filter(({ timeMs }) => timeMs <= edit.startMs || timeMs >= edit.endMs);
      checkTimes = [edit.startMs, edit.endMs];
      if (keys.length === track.keys.length) return project;
    } else {
      const available = availableAnimationPropertyFrames(keys, edit.startMs, edit.endMs);
      if (!Number.isSafeInteger(edit.count) || edit.count < 1 || edit.count > available.length) {
        throw new Error('此区段最多可补 ' + available.length + ' 帧。');
      }
      checkTimes = Array.from({ length: edit.count }, (_, index) =>
        available[Math.floor((index + 1) * (available.length + 1) / (edit.count + 1)) - 1]!);
      keys = checkTimes.reduce(insertAnimationTrackSample, keys);
    }
  }
  return commitTrackChanges(project, shot, layer, clip.tracks.map((candidate) =>
    candidate === track ? { ...track, keys } : candidate), checkTimes);
}

/** Move uses a signed frame delta. Scale and hold use positive frame lengths. */
export function retimeAnimationPropertyRange(
  project: Project, address: Omit<AnimationPropertyKeyAddress, 'keyTimeMs'>,
  range: { startMs: number; endMs: number; mode: 'move' | 'scale' | 'hold'; frames: number },
): Project {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.target.layerId);
  const clip = layer?.animationClip;
  if (!shot || !layer || !clip || layer.locked) throw new Error('所选对象动作已不可编辑。');
  const track = clip.tracks.find((candidate) => candidate.property === address.property &&
    sameAnimationTarget(candidate.target, address.target));
  if (!track) throw new Error('所选属性轨道已不存在。');
  const start = track.keys.findIndex((key) => key.timeMs === range.startMs);
  const end = track.keys.findIndex((key) => key.timeMs === range.endMs);
  if (start < 0 || end <= start || !Number.isSafeInteger(range.frames) ||
    (range.mode !== 'move' && range.frames <= 0)) throw new Error('请选择起止关键帧和有效帧数。');
  if (range.mode === 'move' && range.frames === 0) return project;
  const frameIndex = (time: number) => Math.round(time * TIMELINE_FPS / 1_000);
  const startFrame = frameIndex(range.startMs);
  const endFrame = frameIndex(range.endMs);
  const keys = [...track.keys];
  if (range.mode === 'hold') {
    const endKey = keys[end]!;
    keys[end] = { timeMs: endKey.timeMs, value: endKey.value, interpolationToNext: 'step' };
    keys.splice(end + 1, 0, { ...endKey, timeMs: frameTimeMs(endFrame + range.frames) });
  } else {
    for (let index = start; index <= end; index += 1) {
      const key = keys[index]!;
      const position = frameIndex(key.timeMs);
      const frame = range.mode === 'move' ? position + range.frames
        : startFrame + Math.round((position - startFrame) * range.frames / (endFrame - startFrame));
      if (frame < 0) throw new Error('选段不能移动到镜头外。');
      keys[index] = { ...key, timeMs: frameTimeMs(frame) };
    }
  }
  if (keys[0]!.timeMs !== 0 || keys.some((key, index) =>
    key.timeMs > shot.durationMs || (index > 0 && key.timeMs <= keys[index - 1]!.timeMs))) {
    throw new Error('选段越界、遇到其他关键帧，或会移动固定起始帧。');
  }
  if (range.mode !== 'hold' && keys.every((key, index) => key.timeMs === track.keys[index]?.timeMs)) return project;
  return commitTrackChanges(project, shot, layer, clip.tracks.map((candidate) =>
    candidate === track ? { ...track, keys } : candidate), keys.slice(start, end + 2).map(({ timeMs }) => timeMs));
}

/**
 * Bake a rich easing preset into native linear keyframes on the formal 24 FPS
 * Shot-local frame grid across the selected keyframe span of one transform track.
 *
 * - Preserves all existing manual anchor keyframes and external adjacent segments.
 * - Clears replaced curve metadata only on baked segments.
 * - Preserves `back` overshoot on position/rotation; clamps scale samples to
 *   the target's legal scale range per property without mutating endpoints.
 * - Rejects opacity, locked layers, missing/stale keys, or invalid targets atomically.
 */
export function bakeRichEasingToPropertySegments(
  project: Project,
  input: BakeRichEasingInput,
): BakeRichEasingResult {
  if (!isRichEasingPresetId(input.presetId)) {
    throw new Error('不支持的高级缓动预设。');
  }
  const applicability = getRichEasingPropertyApplicability(input.property, input.presetId);
  if (!applicability.applicable) {
    throw new Error(applicability.reason ?? '该属性不支持烘焙高级缓动。');
  }

  const shot = project.shots.find(({ id }) => id === input.shotId);
  const layer = shot?.layers.find(({ id }) => id === input.target.layerId);
  const clip = layer?.animationClip;
  if (!shot || !layer || !clip || layer.locked) {
    throw new Error('所选对象动作已不可编辑。');
  }
  const track = clip.tracks.find(
    (candidate) =>
      candidate.property === input.property &&
      sameAnimationTarget(candidate.target, input.target),
  );
  if (!track) {
    throw new Error('所选属性轨道已不存在。');
  }

  if (input.keyTimesMs.length < 2) {
    throw new Error('请至少选择两个关键帧以确定可烘焙区段。');
  }

  const seenTimes = new Set<number>();
  const selectedIndices: number[] = [];
  for (const timeMs of input.keyTimesMs) {
    if (!isValidFrameTime(timeMs) || timeMs > shot.durationMs) {
      throw new Error('所选关键帧时间不在镜头有效帧网格内。');
    }
    if (seenTimes.has(timeMs)) {
      throw new Error('所选关键帧不能包含重复时间戳。');
    }
    seenTimes.add(timeMs);
    const keyIndex = track.keys.findIndex((key) => key.timeMs === timeMs);
    if (keyIndex < 0) {
      throw new Error('所选属性关键帧已不存在。');
    }
    selectedIndices.push(keyIndex);
  }

  selectedIndices.sort((left, right) => left - right);
  const startIndex = selectedIndices[0]!;
  const endIndex = selectedIndices[selectedIndices.length - 1]!;
  if (endIndex <= startIndex) {
    throw new Error('请至少选择两个关键帧以确定可烘焙区段。');
  }
  if (track.keys[endIndex]!.timeMs > shot.durationMs) {
    throw new Error('所选关键帧时间超出镜头时长。');
  }

  const isScaleProperty =
    track.property === 'transform.scaleX' || track.property === 'transform.scaleY';
  const layerEvents =
    isScaleProperty && track.target.kind === 'layer'
      ? shot.timelineEvents.filter((event) => event.layerId === layer.id)
      : undefined;

  const nextKeys: AnimationKey[] = track.keys.slice(0, startIndex);
  const preservedAnchorTimesMs: number[] = [];
  const checkTimes: number[] = [];
  let insertedKeys = 0;
  let clampedScaleSamples = 0;

  for (let seg = startIndex; seg < endIndex; seg += 1) {
    const fromKey = track.keys[seg]!;
    const toKey = track.keys[seg + 1]!;
    preservedAnchorTimesMs.push(fromKey.timeMs);
    checkTimes.push(fromKey.timeMs);
    // Preserve start anchor timestamp & value; clear replaced curve metadata on this segment.
    nextKeys.push({
      timeMs: fromKey.timeMs,
      value: fromKey.value,
      interpolationToNext: 'linear',
    });

    const startFrame = Math.round((fromKey.timeMs * TIMELINE_FPS) / 1_000);
    const endFrame = Math.round((toKey.timeMs * TIMELINE_FPS) / 1_000);
    const spanMs = toKey.timeMs - fromKey.timeMs;

    for (let frameIndex = startFrame + 1; frameIndex < endFrame; frameIndex += 1) {
      const timeMs = frameTimeMs(frameIndex, TIMELINE_FPS);
      if (timeMs <= fromKey.timeMs || timeMs >= toKey.timeMs || timeMs > shot.durationMs) {
        continue;
      }
      const progress = (timeMs - fromKey.timeMs) / spanMs;
      const eased = evaluateRichEasing(input.presetId, progress);
      let value = fromKey.value + (toKey.value - fromKey.value) * eased;
      if (!Number.isFinite(value)) {
        throw new Error('高级缓动烘焙产生了非法数值。');
      }

      if (isScaleProperty) {
        let minLegal: number;
        let maxLegal: number;
        if (track.target.kind === 'layer') {
          const preTrack = evaluateLayerPreTrackState(shot, layer, timeMs, project, layerEvents);
          const preScale =
            track.property === 'transform.scaleX' ? preTrack.scaleX : preTrack.scaleY;
          if (!Number.isFinite(preScale) || preScale <= 0) {
            throw new Error('图层基础缩放无效，无法烘焙缩放缓动。');
          }
          minLegal = LAYER_MIN_SCALE / preScale;
          maxLegal = LAYER_MAX_SCALE / preScale;
        } else {
          minLegal = CHARACTER_PART_MIN_SCALE;
          maxLegal = CHARACTER_PART_MAX_SCALE;
        }
        if (value < minLegal) {
          value = minLegal;
          clampedScaleSamples += 1;
        } else if (value > maxLegal) {
          value = maxLegal;
          clampedScaleSamples += 1;
        }
      }

      const normalizedValue = value === 0 ? 0 : value;
      nextKeys.push({
        timeMs,
        value: normalizedValue,
        interpolationToNext: 'linear',
      });
      checkTimes.push(timeMs);
      insertedKeys += 1;
    }
  }

  const endAnchor = track.keys[endIndex]!;
  preservedAnchorTimesMs.push(endAnchor.timeMs);
  checkTimes.push(endAnchor.timeMs);
  // End anchor and all subsequent keys keep their exact values, interpolationToNext, and curveToNext.
  nextKeys.push(...track.keys.slice(endIndex));

  const bakedSegments = endIndex - startIndex;
  const unchanged =
    nextKeys.length === track.keys.length &&
    nextKeys.every((key, index) => JSON.stringify(key) === JSON.stringify(track.keys[index]));
  if (unchanged) {
    return {
      project,
      bakedSegments,
      insertedKeys: 0,
      preservedAnchorTimesMs,
      clampedScaleSamples: 0,
    };
  }

  const nextTracks = clip.tracks.map((candidate) =>
    candidate === track ? { ...track, keys: nextKeys } : candidate,
  );
  const edited = commitTrackChanges(project, shot, layer, nextTracks, checkTimes);
  return {
    project: edited,
    bakedSegments,
    insertedKeys,
    preservedAnchorTimesMs,
    clampedScaleSamples,
  };
}
