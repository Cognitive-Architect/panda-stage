import { evaluateAnimationTrackAtTime } from './evaluate-animation-core';
import {
  AnimationTrackSchema,
  sameAnimationTarget,
  type AnimationInterpolation,
  type AnimationProperty,
  type AnimationTrack,
} from './models/animationCore';
import {
  TIMELINE_FPS,
  frameTimeMs,
  isValidFrameTime,
  lastValidFrameTime,
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
  readonly changed: boolean;
  readonly moves: readonly TargetKeyMove[];
  readonly deltaMs: number;
  readonly deltaFrames: number;
}

export interface TargetRetimePolicy {
  readonly disallowCrossingUnselected?: boolean;
  readonly messages?: {
    readonly emptySelection?: string;
    readonly duplicateSource?: string;
    readonly sourceZeroProtected?: string;
    readonly targetZeroProtected?: string;
    readonly invalidSourceGrid?: string;
    readonly invalidTargetGrid?: string;
    readonly missingSource?: string;
    readonly invalidDelta?: string;
    readonly duplicateTarget?: string;
    readonly outOfShot?: string;
    readonly collision?: string;
    readonly crossUnselected?: string;
  };
}

function frameIndexForTimeMs(timeMs: number): number {
  return Math.round((timeMs * TIMELINE_FPS) / 1_000);
}

/** Return all tracks belonging strictly to the matching target identity. */
export function targetTracks<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
): TTrack[] {
  return tracks.filter((track) => sameAnimationTarget(track.target, target));
}

/** Evaluate all five relative motion properties for a target at `timeMs`. */
export function evaluateTargetMotionValues(
  tracks: readonly AnimationTrack[],
  target: AnimationTrack['target'],
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
  target: AnimationTrack['target'],
): number[] {
  return [
    ...new Set(
      targetTracks(tracks, target).flatMap((track) =>
        track.keys.map((key) => key.timeMs),
      ),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Return every Property Key of `target` at `timeMs` that has a real outgoing interval
 * (`keyIndex < track.keys.length - 1`). Excludes terminal keys and spanning tracks.
 */
export function targetOutgoingPropertyKeysAtTime<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
  timeMs: number,
): Array<{
  readonly trackIndex: number;
  readonly keyIndex: number;
  readonly property: AnimationProperty;
  readonly interpolationToNext: AnimationInterpolation;
}> {
  const entries: Array<{
    readonly trackIndex: number;
    readonly keyIndex: number;
    readonly property: AnimationProperty;
    readonly interpolationToNext: AnimationInterpolation;
  }> = [];
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    if (!sameAnimationTarget(track.target, target)) continue;
    const keyIndex = track.keys.findIndex((key) => key.timeMs === timeMs);
    if (keyIndex >= 0 && keyIndex < track.keys.length - 1) {
      entries.push({
        trackIndex,
        keyIndex,
        property: track.property,
        interpolationToNext: track.keys[keyIndex]!.interpolationToNext,
      });
    }
  }
  return entries;
}

/** True when at least one Property Track of `target` has a real outgoing interval at `timeMs`. */
export function hasTargetOutgoingInterval(
  tracks: readonly AnimationTrack[],
  target: AnimationTrack['target'],
  timeMs: number,
): boolean {
  return targetOutgoingPropertyKeysAtTime(tracks, target, timeMs).length > 0;
}

/**
 * Resolve the shared outgoing interpolation across ALL real outgoing Property Keys at `timeMs`.
 * Returns `null` if no outgoing interval exists or if outgoing easings disagree (mixed easing).
 */
export function targetCompositeKeyEasing(
  tracks: readonly AnimationTrack[],
  target: AnimationTrack['target'],
  timeMs: number,
): AnimationInterpolation | null {
  const easings = targetOutgoingPropertyKeysAtTime(tracks, target, timeMs).map(
    (entry) => entry.interpolationToNext,
  );
  if (easings.length === 0) return null;
  const first = easings[0]!;
  return easings.every((entry) => entry === first) ? first : null;
}

/**
 * Insert or update keys for `target` at `timeMs`.
 * - Default (`forceWrite: false`): writes only properties differing from evaluated value.
 * - Snapshot (`forceWrite: true`): materializes explicit keys unless exact same value is already authored at `timeMs`.
 */
export function upsertTargetKeyValues<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: TTrack['target'],
  timeMs: number,
  changes: Partial<AnimationMotionValues>,
  options: { readonly forceWrite?: boolean } = {},
): TTrack[] {
  const current = evaluateTargetMotionValues(tracks, target, timeMs);
  const properties = (Object.keys(changes) as AnimationProperty[]).filter(
    (property) => {
      const nextValue = changes[property];
      if (nextValue === undefined) return false;
      if (!options.forceWrite) return nextValue !== current[property];
      const existing = tracks.find(
        (track) =>
          sameAnimationTarget(track.target, target) && track.property === property,
      );
      const atTime = existing?.keys.find((key) => key.timeMs === timeMs);
      return !existing || !atTime || atTime.value !== nextValue;
    },
  );
  if (properties.length === 0) return tracks as TTrack[];

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
          !(sameAnimationTarget(track.target, target) && track.property === property),
      ),
      parsedTrack,
    ];
  }
  return nextTracks;
}

/** Remove all non-0ms keys for `target` at `timeMs`. */
export function deleteTargetKeyAtTime<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
  timeMs: number,
  options: {
    readonly protectedBaseMessage?: string;
    readonly missingMessage?: string;
  } = {},
): TTrack[] {
  if (!Number.isInteger(timeMs) || timeMs <= 0) {
    throw new Error(
      options.protectedBaseMessage ?? '0 ms 基础姿势关键帧受保护，不能删除。',
    );
  }
  const hasAnyAtTime = targetTracks(tracks, target).some((track) =>
    track.keys.some((key) => key.timeMs === timeMs),
  );
  if (!hasAnyAtTime) {
    throw new Error(
      options.missingMessage ?? `找不到位于 ${timeMs} ms 的关键帧。`,
    );
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
  target: AnimationTrack['target'],
  shotDurationMs: number,
  input: TargetKeysRetimeInput,
  policy: TargetRetimePolicy = {},
): TargetKeysRetimePlan {
  const msg = policy.messages;
  if (input.fromTimesMs.length === 0) {
    throw new Error(msg?.emptySelection ?? '请选择要移动的关键帧。');
  }
  const hasDeltaMs = input.deltaMs !== undefined;
  const hasDeltaFrames = input.deltaFrames !== undefined;
  if (hasDeltaMs === hasDeltaFrames) {
    throw new Error(msg?.invalidDelta ?? '请指定单一且有效的时间偏移量。');
  }

  const fromTimes = [...new Set(input.fromTimesMs)].sort((a, b) => a - b);
  if (fromTimes.length !== input.fromTimesMs.length) {
    throw new Error(msg?.duplicateSource ?? '批量移动关键帧不能包含重复源时间。');
  }

  const compositeTimes = compositeKeyTimesForTarget(tracks, target);
  const existingTimes = new Set(compositeTimes);
  const selectedSet = new Set(fromTimes);

  for (const fromTimeMs of fromTimes) {
    if (!isValidFrameTime(fromTimeMs)) {
      throw new Error(msg?.invalidSourceGrid ?? '源关键帧时间必须在项目帧网格上。');
    }
    if (fromTimeMs === 0) {
      throw new Error(msg?.sourceZeroProtected ?? '0 ms 基础姿势关键帧受保护，不能移动。');
    }
    if (!existingTimes.has(fromTimeMs)) {
      throw new Error(msg?.missingSource ?? `找不到位于 ${fromTimeMs} ms 的关键帧。`);
    }
  }

  if (hasDeltaFrames) {
    if (!Number.isInteger(input.deltaFrames!)) {
      throw new Error(msg?.invalidDelta ?? '帧偏移量必须是整数。');
    }
    if (input.deltaFrames === 0) {
      return {
        changed: false,
        moves: fromTimes.map((timeMs) => ({ fromTimeMs: timeMs, toTimeMs: timeMs })),
        deltaMs: 0,
        deltaFrames: 0,
      };
    }
  } else {
    if (!Number.isInteger(input.deltaMs!)) {
      throw new Error(msg?.invalidTargetGrid ?? '目标时间必须对齐项目帧网格。');
    }
    if (input.deltaMs === 0) {
      return {
        changed: false,
        moves: fromTimes.map((timeMs) => ({ fromTimeMs: timeMs, toTimeMs: timeMs })),
        deltaMs: 0,
        deltaFrames: 0,
      };
    }
  }

  const deltaFrames = hasDeltaFrames
    ? input.deltaFrames!
    : (() => {
        const firstTo = fromTimes[0]! + input.deltaMs!;
        if (!isValidFrameTime(firstTo)) {
          throw new Error(msg?.invalidTargetGrid ?? '目标时间必须对齐项目帧网格。');
        }
        return frameIndexForTimeMs(firstTo) - frameIndexForTimeMs(fromTimes[0]!);
      })();

  const maxFrameTime = lastValidFrameTime(shotDurationMs);
  const unselectedTimes = compositeTimes.filter((timeMs) => !selectedSet.has(timeMs));
  const moves: TargetKeyMove[] = [];
  const targetTimeSet = new Set<number>();

  for (const fromTimeMs of fromTimes) {
    let toTimeMs: number;
    if (hasDeltaMs) {
      toTimeMs = fromTimeMs + input.deltaMs!;
    } else {
      const targetFrameIndex = frameIndexForTimeMs(fromTimeMs) + deltaFrames;
      if (targetFrameIndex === 0) {
        throw new Error(msg?.targetZeroProtected ?? '关键帧时间必须位于镜头有效帧范围内。');
      }
      if (targetFrameIndex < 0) {
        throw new Error(msg?.invalidTargetGrid ?? '目标时间必须对齐项目帧网格。');
      }
      toTimeMs = frameTimeMs(targetFrameIndex);
    }

    if (toTimeMs === 0) {
      throw new Error(msg?.targetZeroProtected ?? '关键帧时间必须位于镜头有效帧范围内。');
    }
    if (!isValidFrameTime(toTimeMs)) {
      throw new Error(msg?.invalidTargetGrid ?? '目标时间必须对齐项目帧网格。');
    }
    if (toTimeMs < 0 || toTimeMs > maxFrameTime) {
      throw new Error(msg?.outOfShot ?? '关键帧时间必须位于镜头有效帧范围内。');
    }
    if (targetTimeSet.has(toTimeMs)) {
      throw new Error(msg?.duplicateTarget ?? '多个关键帧不能移动到同一帧时间。');
    }
    if (existingTimes.has(toTimeMs) && !selectedSet.has(toTimeMs)) {
      throw new Error(msg?.collision ?? `目标时间 ${toTimeMs} ms 已存在关键帧。`);
    }
    if (policy.disallowCrossingUnselected) {
      for (const unselectedTimeMs of unselectedTimes) {
        if (
          (fromTimeMs < unselectedTimeMs && toTimeMs >= unselectedTimeMs) ||
          (fromTimeMs > unselectedTimeMs && toTimeMs <= unselectedTimeMs)
        ) {
          throw new Error(
            msg?.crossUnselected ?? '动作关键帧不能越过未选中的相邻关键帧。',
          );
        }
      }
    }
    targetTimeSet.add(toTimeMs);
    moves.push({ fromTimeMs, toTimeMs });
  }

  const representativeMove = moves[0]!;
  return {
    changed: true,
    moves,
    deltaMs: representativeMove.toTimeMs - representativeMove.fromTimeMs,
    deltaFrames,
  };
}

/** Apply already-validated Composite Key time moves across `target`'s sparse tracks. */
export function applyTargetKeyMoves<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
  moves: readonly TargetKeyMove[],
): TTrack[] {
  const moveMap = new Map(moves.map((move) => [move.fromTimeMs, move.toTimeMs]));
  let changed = false;
  const nextTracks = tracks.map((track) => {
    if (!sameAnimationTarget(track.target, target)) return track;
    if (!track.keys.some((key) => moveMap.has(key.timeMs))) return track;
    changed = true;
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
  return changed ? nextTracks : (tracks as TTrack[]);
}

/** Atomically retime a batch of composite keys for `target`. */
export function retimeTargetKeys<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
  shotDurationMs: number,
  input: TargetKeysRetimeInput,
  policy: TargetRetimePolicy = {},
): TTrack[] {
  const plan = planTargetKeysRetime(tracks, target, shotDurationMs, input, policy);
  if (!plan.changed) return tracks as TTrack[];
  return applyTargetKeyMoves(tracks, target, plan.moves);
}

/**
 * Update `interpolationToNext` strictly on Property Keys of `target` at `timeMs`
 * that actually have a subsequent key on the same track. Returns original `tracks` on no-op.
 */
export function setTargetKeyEasing<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
  timeMs: number,
  easing: AnimationInterpolation,
  options: { readonly missingOutgoingMessage?: string } = {},
): TTrack[] {
  const outgoing = targetOutgoingPropertyKeysAtTime(tracks, target, timeMs);
  if (outgoing.length === 0) {
    throw new Error(
      options.missingOutgoingMessage ?? '该关键帧没有可设置插值的后续区间。',
    );
  }
  const outgoingByTrack = new Map(
    outgoing.map((entry) => [entry.trackIndex, entry.keyIndex]),
  );
  let changed = false;
  const nextTracks = tracks.map((track, trackIndex) => {
    const keyIndex = outgoingByTrack.get(trackIndex);
    if (keyIndex === undefined) return track;
    if (track.keys[keyIndex]!.interpolationToNext === easing && !track.keys[keyIndex]!.curveToNext) return track;
    changed = true;
    return AnimationTrackSchema.parse({
      ...track,
      keys: track.keys.map((key, index) =>
        index === keyIndex ? { timeMs: key.timeMs, value: key.value, interpolationToNext: easing } : key,
      ),
    }) as TTrack;
  });
  return changed ? nextTracks : (tracks as TTrack[]);
}

/** Read ONLY actually authored key values at `timeMs` without materializing missing sparse properties. */
export function readTargetAuthoredKeyValues<TTrack extends AnimationTrack>(
  tracks: readonly TTrack[],
  target: AnimationTrack['target'],
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
  options: { readonly invalidFrameMessage?: string } = {},
): TTrack[] {
  if (
    !isValidFrameTime(toTimeMs) ||
    toTimeMs < 0 ||
    toTimeMs > lastValidFrameTime(shotDurationMs)
  ) {
    throw new Error(options.invalidFrameMessage ?? '请选择镜头内的有效帧。');
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
