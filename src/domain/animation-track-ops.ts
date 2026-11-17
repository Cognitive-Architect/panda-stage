import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import {
  AnimationTrackSchema,
  sameAnimationTarget,
  type AnimationInterpolation,
  type AnimationProperty,
  type AnimationTargetRef,
  type AnimationTrack,
} from './models/animationCore';
import {
  TIMELINE_FPS,
  frameTimeMs,
  isValidFrameTime,
} from './timeline/frame-grid';

export type AnimationMotionValues = Record<AnimationProperty, number>;

export const NEUTRAL_ANIMATION_MOTION: Readonly<AnimationMotionValues> = {
  'transform.offsetX': 0,
  'transform.offsetY': 0,
  'transform.rotationDeg': 0,
  'transform.scaleX': 1,
  'transform.scaleY': 1,
};

export interface TargetKeysRetimeInput {
  readonly fromTimesMs: readonly number[];
  readonly deltaMs?: number;
  readonly deltaFrames?: number;
}

export interface TargetKeyMove {
  readonly fromTimeMs: number;
  readonly toTimeMs: number;
}

export interface TargetKeysRetimePlan {
  readonly moves: readonly TargetKeyMove[];
  readonly deltaMs: number;
  readonly deltaFrames: number;
}

function frameIndexForTimeMs(timeMs: number): number {
  return Math.round((timeMs * TIMELINE_FPS) / 1_000);
}

/** Return all tracks belonging strictly to the matching target identity. */
export function targetTracks<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTargetRef,
): TTrack[] {
  return tracks.filter((track) => sameAnimationTarget(track.target, target));
}

/** Evaluate all five relative motion properties for a target at `timeMs`. */
export function evaluateTargetMotionValues(
  tracks: readonly AnimationTrack[],
  target: AnimationTargetRef,
  timeMs: number,
): AnimationMotionValues {
  const values: AnimationMotionValues = { ...NEUTRAL_ANIMATION_MOTION };
  for (const track of tracks) {
    if (sameAnimationTarget(track.target, target)) {
      values[track.property] = evaluateAnimationTrackAtTime(track, timeMs);
    }
  }
  return values;
}

/** Sorted distinct composite key timestamps across all tracks of `target`. */
export function compositeKeyTimesForTarget(
  tracks: readonly AnimationTrack[],
  target: AnimationTargetRef,
): number[] {
  return [
    ...new Set(
      targetTracks(tracks, target).flatMap((track) =>
        track.keys.map((key) => key.timeMs),
      ),
    ),
  ].sort((a, b) => a - b);
}

/** True when `target` has a key at `timeMs` followed by at least one later key. */
export function hasTargetOutgoingInterval(
  tracks: readonly AnimationTrack[],
  target: AnimationTargetRef,
  timeMs: number,
): boolean {
  return targetTracks(tracks, target).some((track) =>
    track.keys.some((key, index) =>
      key.timeMs === timeMs && index < track.keys.length - 1,
    ),
  );
}

/** Resolve the outgoing easing at `timeMs` if an outgoing interval exists. */
export function targetCompositeKeyEasing(
  tracks: readonly AnimationTrack[],
  target: AnimationTargetRef,
  timeMs: number,
): AnimationInterpolation | null {
  for (const track of targetTracks(tracks, target)) {
    const index = track.keys.findIndex((key) => key.timeMs === timeMs);
    if (index >= 0 && index < track.keys.length - 1) {
      return track.keys[index]!.interpolationToNext;
    }
  }
  return null;
}

/** Insert or update keys for `target` at `timeMs`. By default writes only properties differing from `evaluateTargetMotionValues`. */
export function upsertTargetKeyValues<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: TTrack['target'],
  timeMs: number,
  changes: Partial<AnimationMotionValues>,
  options: { readonly forceWrite?: boolean } = {},
): TTrack[] {
  const current = evaluateTargetMotionValues(tracks, target, timeMs);
  const properties = (Object.keys(changes) as AnimationProperty[]).filter(
    (property) =>
      changes[property] !== undefined &&
      (options.forceWrite || changes[property] !== current[property]),
  );
  if (properties.length === 0) return [...tracks];

  let nextTracks = [...tracks];
  for (const property of properties) {
    const existing = nextTracks.find(
      (track) =>
        sameAnimationTarget(track.target, target) && track.property === property,
    );
    const keys = existing?.keys ?? [
      {
        timeMs: 0,
        value: NEUTRAL_ANIMATION_MOTION[property],
        interpolationToNext: 'linear' as const,
      },
    ];
    const atTime = keys.find((key) => key.timeMs === timeMs);
    const nextKey = {
      timeMs,
      value: changes[property]!,
      interpolationToNext: atTime?.interpolationToNext ?? ('linear' as const),
    };
    const parsedTrack = AnimationTrackSchema.parse({
      target,
      property,
      keys: [...keys.filter((key) => key.timeMs !== timeMs), nextKey].sort(
        (a, b) => a.timeMs - b.timeMs,
      ),
    }) as TTrack;
    nextTracks = [
      ...nextTracks.filter(
        (track) =>
          !(
            sameAnimationTarget(track.target, target) &&
            track.property === property
          ),
      ),
      parsedTrack,
    ];
  }
  return nextTracks;
}

/** Remove all non-0ms keys for `target` at `timeMs`, pruning tracks left with 0ms? No, retains remaining tracks (0ms key remains protected). */
export function deleteTargetKeyAtTime<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTargetRef,
  timeMs: number,
): TTrack[] {
  if (!Number.isInteger(timeMs) || timeMs <= 0) {
    throw new Error('0 ms 基础姿势关键帧受保护，不能删除。');
  }
  const hasAnyAtTime = targetTracks(tracks, target).some((track) =>
    track.keys.some((key) => key.timeMs === timeMs),
  );
  if (!hasAnyAtTime) {
    throw new Error(`找不到位于 ${timeMs} ms 的关键帧。`);
  }
  return tracks.map((track) => {
    if (!sameAnimationTarget(track.target, target)) return track;
    if (!track.keys.some((key) => key.timeMs === timeMs)) return track;
    return AnimationTrackSchema.parse({
      ...track,
      keys: track.keys.filter((key) => key.timeMs !== timeMs),
    }) as TTrack;
  });
}

/** Validate and plan an atomic batch retime for `target` without mutating tracks. */
export function planTargetKeysRetime(
  tracks: readonly AnimationTrack[],
  target: AnimationTargetRef,
  shotDurationMs: number,
  input: TargetKeysRetimeInput,
): TargetKeysRetimePlan {
  if (input.fromTimesMs.length === 0) {
    throw new Error('请选择要移动的关键帧。');
  }
  const hasDeltaMs = input.deltaMs !== undefined;
  const hasDeltaFrames = input.deltaFrames !== undefined;
  if (hasDeltaMs === hasDeltaFrames) {
    throw new Error('请指定单一且有效的时间偏移量。');
  }

  const fromTimes = [...new Set(input.fromTimesMs)].sort((a, b) => a - b);
  if (fromTimes.length !== input.fromTimesMs.length) {
    throw new Error('批量移动关键帧不能包含重复源时间。');
  }

  const existingTimes = new Set(compositeKeyTimesForTarget(tracks, target));
  const selectedSet = new Set(fromTimes);

  const deltaFrames = hasDeltaFrames
    ? input.deltaFrames!
    : (() => {
        if (!Number.isInteger(input.deltaMs!)) {
          throw new Error('目标时间必须对齐项目帧网格。');
        }
        const firstTo = fromTimes[0]! + input.deltaMs!;
        if (!isValidFrameTime(firstTo)) {
          throw new Error('目标时间必须对齐项目帧网格。');
        }
        return frameIndexForTimeMs(firstTo) - frameIndexForTimeMs(fromTimes[0]!);
      })();

  if (!Number.isInteger(deltaFrames)) {
    throw new Error('帧偏移量必须是整数。');
  }

  const moves: TargetKeyMove[] = [];
  const targetTimeSet = new Set<number>();
  for (const fromTimeMs of fromTimes) {
    if (fromTimeMs === 0) {
      throw new Error('0 ms 基础姿势关键帧受保护，不能移动。');
    }
    if (!existingTimes.has(fromTimeMs)) {
      throw new Error(`找不到位于 ${fromTimeMs} ms 的关键帧。`);
    }
    const toTimeMs = hasDeltaMs
      ? fromTimeMs + input.deltaMs!
      : frameTimeMs(frameIndexForTimeMs(fromTimeMs) + deltaFrames);
    if (!isValidFrameTime(toTimeMs)) {
      throw new Error('目标时间必须对齐项目帧网格。');
    }
    if (toTimeMs <= 0 || toTimeMs > shotDurationMs) {
      throw new Error('关键帧时间必须位于镜头有效帧范围内。');
    }
    if (targetTimeSet.has(toTimeMs)) {
      throw new Error('多个关键帧不能移动到同一帧时间。');
    }
    if (existingTimes.has(toTimeMs) && !selectedSet.has(toTimeMs)) {
      throw new Error(`目标时间 ${toTimeMs} ms 已存在关键帧。`);
    }
    targetTimeSet.add(toTimeMs);
    moves.push({ fromTimeMs, toTimeMs });
  }

  const representativeMove = moves[0]!;
  return {
    moves,
    deltaMs: representativeMove.toTimeMs - representativeMove.fromTimeMs,
    deltaFrames,
  };
}

/** Atomically retime a batch of composite keys for `target`. */
export function retimeTargetKeys<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTargetRef,
  shotDurationMs: number,
  input: TargetKeysRetimeInput,
): TTrack[] {
  const plan = planTargetKeysRetime(tracks, target, shotDurationMs, input);
  if (plan.deltaMs === 0 && plan.deltaFrames === 0) return [...tracks];
  const moveMap = new Map(plan.moves.map((move) => [move.fromTimeMs, move.toTimeMs]));
  return tracks.map((track) => {
    if (!sameAnimationTarget(track.target, target)) return track;
    if (!track.keys.some((key) => moveMap.has(key.timeMs))) return track;
    return AnimationTrackSchema.parse({
      ...track,
      keys: track.keys
        .map((key) => {
          const toTimeMs = moveMap.get(key.timeMs);
          return toTimeMs === undefined ? key : { ...key, timeMs: toTimeMs };
        })
        .sort((a, b) => a.timeMs - b.timeMs),
    }) as TTrack;
  });
}

/** Update `interpolationToNext` on outgoing keys of `target` at `timeMs`. */
export function setTargetKeyEasing<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTargetRef,
  timeMs: number,
  easing: AnimationInterpolation,
): TTrack[] {
  if (!hasTargetOutgoingInterval(tracks, target, timeMs)) {
    throw new Error('该关键帧没有可设置插值的后续区间。');
  }
  return tracks.map((track) => {
    if (!sameAnimationTarget(track.target, target)) return track;
    const keyIndex = track.keys.findIndex((key) => key.timeMs === timeMs);
    if (keyIndex < 0 || keyIndex >= track.keys.length - 1) return track;
    return AnimationTrackSchema.parse({
      ...track,
      keys: track.keys.map((key, index) =>
        index === keyIndex ? { ...key, interpolationToNext: easing } : key,
      ),
    }) as TTrack;
  });
}

/** Read ONLY actually authored key values at `timeMs` without materializing missing sparse properties. */
export function readTargetAuthoredKeyValues<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: TTrack['target'],
  timeMs: number,
): Partial<AnimationMotionValues> | null {
  const authored: Partial<AnimationMotionValues> = {};
  let found = false;
  for (const track of targetTracks(tracks, target)) {
    const key = track.keys.find((candidate) => candidate.timeMs === timeMs);
    if (key) {
      authored[track.property] = key.value;
      found = true;
    }
  }
  return found ? authored : null;
}

/** Write a previously snapshotted sparse key map onto `toTimeMs` for `target`. */
export function pasteTargetKeySnapshotAtTime<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: TTrack['target'],
  shotDurationMs: number,
  toTimeMs: number,
  pose: Partial<AnimationMotionValues>,
): TTrack[] {
  if (!isValidFrameTime(toTimeMs) || toTimeMs < 0 || toTimeMs > shotDurationMs) {
    throw new Error('请选择镜头内的有效帧。');
  }
  if (Object.keys(pose).length === 0) {
    throw new Error('剪贴板中没有可粘贴的关键帧姿势。');
  }
  return upsertTargetKeyValues(tracks, target, toTimeMs, pose, {
    forceWrite: true,
  });
}

/** Copy authored key values from `fromTimeMs` onto `toTimeMs` for `target`. */
export function pasteTargetKeysAtTime<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: TTrack['target'],
  shotDurationMs: number,
  fromTimeMs: number,
  toTimeMs: number,
): TTrack[] {
  const authoredAtSource = readTargetAuthoredKeyValues(tracks, target, fromTimeMs);
  if (!authoredAtSource) {
    throw new Error(`找不到位于 ${fromTimeMs} ms 的可粘贴关键帧。`);
  }
  return pasteTargetKeySnapshotAtTime(
    tracks,
    target,
    shotDurationMs,
    toTimeMs,
    authoredAtSource,
  );
}
