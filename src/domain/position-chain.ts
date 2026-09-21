import {
  isValidFrameTime,
  lastValidFrameTime,
  resolveTimelineFrameTime,
} from './timeline/frame-grid';
import type { Point } from './geometry';
import type { Layer, MoveEvent, TimelineEvent } from './models';
import { IdSchema } from './models/common';

export type PositionKeyKind = 'base' | 'key';

/** One logical Position checkpoint. The base point is always the 0:00 root. */
export interface PositionKey {
  readonly timeMs: number;
  readonly position: Point;
  readonly kind: PositionKeyKind;
}

/**
 * A normalized, Events-backed logical Position chain. `segments` are the
 * single source of runtime truth for this pure slice; each shared endpoint is
 * represented once in `points` and twice in adjacent MoveEvents internally.
 */
export interface PositionChain {
  readonly status: 'none' | 'editable';
  readonly layerId: string;
  readonly shotDurationMs: number;
  readonly points: readonly PositionKey[];
  readonly segments: readonly MoveEvent[];
}

export type PositionChainRejectionCode =
  | 'duplicate-event-id'
  | 'invalid-time'
  | 'outside-shot'
  | 'off-frame'
  | 'non-linear-easing'
  | 'missing-base-segment'
  | 'base-mismatch'
  | 'same-time-competing-keys'
  | 'overlapping-segments'
  | 'discontinuous-segments';

export interface PositionChainRejection {
  readonly code: PositionChainRejectionCode;
  readonly message: string;
  readonly eventIds: readonly string[];
}

export type PositionChainRecognition =
  | {
      readonly status: 'none';
      readonly chain: PositionChain;
    }
  | {
      readonly status: 'editable';
      readonly chain: PositionChain;
    }
  | {
      readonly status: 'playback-only';
      readonly reason: PositionChainRejection;
      readonly events: readonly MoveEvent[];
    };

export interface PositionChainInput {
  readonly shot: {
    readonly durationMs: number;
    readonly timelineEvents: readonly TimelineEvent[];
  };
  readonly layer: Pick<Layer, 'id' | 'x' | 'y'>;
  readonly timelineEvents?: readonly TimelineEvent[];
}

export interface EmptyPositionChainInput {
  readonly layerId: string;
  readonly shotDurationMs: number;
  readonly basePosition: Point;
}

export interface PositionKeyInput {
  readonly timeMs: number;
  readonly position: Point;
  /** Required for a new runtime segment because this module is deterministic. */
  readonly eventId: string;
}

export interface PositionHoldInput {
  readonly timeMs: number;
  /** Required when the hold creates a new runtime segment. */
  readonly eventId: string;
}

export interface PositionChainOperationError {
  readonly code:
    | 'invalid-chain'
    | 'invalid-time'
    | 'invalid-position'
    | 'invalid-event-id'
    | 'no-managed-chain'
    | 'no-segment'
    | 'existing-key'
    | 'missing-key'
    | 'base-protected'
    | 'invalid-neighbor'
    | 'event-id-collision';
  readonly message: string;
}

export type PositionChainOperationResult =
  | {
      readonly ok: true;
      readonly chain: PositionChain;
      readonly events: readonly MoveEvent[];
      readonly addedEventIds: readonly string[];
      readonly changedEventIds: readonly string[];
      readonly removedEventIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly error: PositionChainOperationError;
    };

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function pointsEqual(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function basePoint(chain: PositionChain): Point {
  return copyPoint(chain.points[0]!.position);
}

function chainFrom(
  chain: PositionChain,
  points: readonly PositionKey[],
  segments: readonly MoveEvent[],
): PositionChain {
  return {
    status: segments.length > 0 ? 'editable' : 'none',
    layerId: chain.layerId,
    shotDurationMs: chain.shotDurationMs,
    points: points.map((point) => ({
      timeMs: point.timeMs,
      position: copyPoint(point.position),
      kind: point.kind,
    })),
    segments: [...segments],
  };
}

function operationSuccess(
  chain: PositionChain,
  addedEventIds: readonly string[] = [],
  changedEventIds: readonly string[] = [],
  removedEventIds: readonly string[] = [],
): PositionChainOperationResult {
  return {
    ok: true,
    chain,
    events: chain.segments,
    addedEventIds: [...addedEventIds],
    changedEventIds: [...changedEventIds],
    removedEventIds: [...removedEventIds],
  };
}

function operationFailure(
  code: PositionChainOperationError['code'],
  message: string,
): PositionChainOperationResult {
  return { ok: false, error: { code, message } };
}

function patchMoveEvent(
  event: MoveEvent,
  patch: Partial<Pick<MoveEvent, 'startMs' | 'endMs' | 'from' | 'to'>>,
): MoveEvent {
  return {
    ...event,
    ...patch,
    from: copyPoint(patch.from ?? event.from),
    to: copyPoint(patch.to ?? event.to),
    easing: 'linear',
  };
}

function newMoveEvent(
  chain: PositionChain,
  eventId: string,
  startMs: number,
  endMs: number,
  from: Point,
  to: Point,
): MoveEvent {
  return {
    id: eventId,
    type: 'move',
    layerId: chain.layerId,
    startMs,
    endMs,
    from: copyPoint(from),
    to: copyPoint(to),
    easing: 'linear',
  };
}

function validatePositionChain(
  chain: PositionChain,
): PositionChainOperationError | null {
  if (
    !Number.isFinite(chain.shotDurationMs) ||
    chain.shotDurationMs < 0 ||
    !Number.isInteger(chain.shotDurationMs) ||
    chain.points.length === 0
  ) {
    return {
      code: 'invalid-chain',
      message: 'Position chain context is not a finite integer Shot range.',
    };
  }

  const first = chain.points[0]!;
  if (
    first.kind !== 'base' ||
    first.timeMs !== 0 ||
    !isValidFrameTime(first.timeMs) ||
    !finitePoint(first.position)
  ) {
    return {
      code: 'invalid-chain',
      message: 'Position chain must start with a finite 0:00 Base point.',
    };
  }

  if (
    chain.status === 'none' &&
    (chain.points.length !== 1 || chain.segments.length !== 0)
  ) {
    return {
      code: 'invalid-chain',
      message: 'A chain without managed animation cannot contain segments.',
    };
  }
  if (
    chain.status === 'editable' &&
    (chain.points.length < 2 || chain.segments.length !== chain.points.length - 1)
  ) {
    return {
      code: 'invalid-chain',
      message: 'An editable Position chain must have one segment per key gap.',
    };
  }

  for (let index = 1; index < chain.points.length; index += 1) {
    const previous = chain.points[index - 1]!;
    const point = chain.points[index]!;
    if (
      point.kind !== 'key' ||
      !Number.isInteger(point.timeMs) ||
      !isValidFrameTime(point.timeMs) ||
      point.timeMs <= previous.timeMs ||
      point.timeMs > chain.shotDurationMs ||
      !finitePoint(point.position)
    ) {
      return {
        code: 'invalid-chain',
        message: 'Position keys must be ordered, in-range, and on the frame grid.',
      };
    }
  }

  for (let index = 0; index < chain.segments.length; index += 1) {
    const event = chain.segments[index]!;
    const from = chain.points[index]!;
    const to = chain.points[index + 1]!;
    if (
      event.type !== 'move' ||
      event.layerId !== chain.layerId ||
      event.easing !== 'linear' ||
      event.startMs !== from.timeMs ||
      event.endMs !== to.timeMs ||
      event.endMs <= event.startMs ||
      !pointsEqual(event.from, from.position) ||
      !pointsEqual(event.to, to.position)
    ) {
      return {
        code: 'invalid-chain',
        message: 'Position segments must be adjacent linear MoveEvents.',
      };
    }
  }
  return null;
}

function validNewEventId(
  chain: PositionChain,
  eventId: string,
): PositionChainOperationResult | null {
  if (!IdSchema.safeParse(eventId).success) {
    return operationFailure(
      'invalid-event-id',
      'A new Position segment requires a valid event id.',
    );
  }
  if (chain.segments.some((event) => event.id === eventId)) {
    return operationFailure(
      'event-id-collision',
      'The new Position segment id already belongs to this chain.',
    );
  }
  return null;
}

function guardChain(chain: PositionChain): PositionChainOperationResult | null {
  const error = validatePositionChain(chain);
  return error ? { ok: false, error } : null;
}

function resolveOperationTime(
  chain: PositionChain,
  rawTimeMs: number,
): number | PositionChainOperationResult {
  if (!Number.isFinite(rawTimeMs)) {
    return operationFailure('invalid-time', 'Position time must be finite.');
  }
  return resolveTimelineFrameTime(rawTimeMs, chain.shotDurationMs);
}

function validPosition(
  position: Point,
): PositionChainOperationResult | null {
  return finitePoint(position)
    ? null
    : operationFailure(
        'invalid-position',
        'Position coordinates must be finite numbers.',
      );
}

/** Construct the read-only Base-only state used before the first Position key. */
export function createEmptyPositionChain(
  input: EmptyPositionChainInput,
): PositionChain {
  if (
    !Number.isInteger(input.shotDurationMs) ||
    input.shotDurationMs < 0 ||
    !finitePoint(input.basePosition)
  ) {
    throw new Error('Position chain context must use a finite integer Shot range and position.');
  }
  return {
    status: 'none',
    layerId: input.layerId,
    shotDurationMs: input.shotDurationMs,
    points: [
      {
        timeMs: 0,
        position: copyPoint(input.basePosition),
        kind: 'base',
      },
    ],
    segments: [],
  };
}

/**
 * Recognize only an unambiguous, normalized linear Move chain. Reading is
 * interpretive: it never rewrites the supplied Shot, Layer, or events.
 */
export function recognizePositionChain(
  input: PositionChainInput,
): PositionChainRecognition {
  const timelineEvents = input.timelineEvents ?? input.shot.timelineEvents;
  const empty = createEmptyPositionChain({
    layerId: input.layer.id,
    shotDurationMs: input.shot.durationMs,
    basePosition: { x: input.layer.x, y: input.layer.y },
  });
  const moveEvents = timelineEvents.filter(
    (event): event is MoveEvent =>
      event.type === 'move' && event.layerId === input.layer.id,
  );

  if (moveEvents.length === 0) {
    return { status: 'none', chain: empty };
  }

  const fail = (
    code: PositionChainRejectionCode,
    message: string,
    events: readonly MoveEvent[] = moveEvents,
  ): PositionChainRecognition => ({
    status: 'playback-only',
    reason: {
      code,
      message,
      eventIds: events.map((event) => event.id),
    },
    events: moveEvents,
  });

  const ids = new Set<string>();
  for (const event of moveEvents) {
    if (ids.has(event.id)) {
      return fail(
        'duplicate-event-id',
        'The Position Move chain contains duplicate event ids.',
      );
    }
    ids.add(event.id);
    if (!Number.isInteger(event.startMs) || !Number.isInteger(event.endMs)) {
      return fail(
        'invalid-time',
        'The Position Move chain contains a non-integer time.',
      );
    }
    if (event.startMs < 0 || event.endMs > input.shot.durationMs) {
      return fail(
        'outside-shot',
        'The Position Move chain leaves the Shot range.',
      );
    }
    if (event.endMs <= event.startMs) {
      return fail(
        'invalid-time',
        'Position Move segments must have positive duration.',
      );
    }
    if (!isValidFrameTime(event.startMs) || !isValidFrameTime(event.endMs)) {
      return fail(
        'off-frame',
        'Position Move endpoints must lie on the 24 FPS frame grid.',
      );
    }
    if (event.easing !== 'linear') {
      return fail(
        'non-linear-easing',
        'Non-linear legacy Position movement remains playback-only.',
      );
    }
  }

  const sorted = [...moveEvents].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.id.localeCompare(right.id),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.startMs === sorted[index - 1]!.startMs) {
      return fail(
        'same-time-competing-keys',
        'The Position chain contains competing points at the same time.',
        sorted,
      );
    }
  }

  const first = sorted[0]!;
  if (first.startMs !== 0) {
    return fail(
      'missing-base-segment',
      'An editable Position chain must start at the 0:00 Base point.',
      sorted,
    );
  }
  if (!pointsEqual(first.from, empty.points[0]!.position)) {
    return fail(
      'base-mismatch',
      'The first Position Move does not start at the Layer Base position.',
      sorted,
    );
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current.startMs < previous.endMs) {
      return fail(
        'overlapping-segments',
        'Position Move segments overlap and cannot form one logical chain.',
        sorted,
      );
    }
    if (current.startMs > previous.endMs) {
      return fail(
        'discontinuous-segments',
        'Position Move segments have a time gap and cannot be adopted safely.',
        sorted,
      );
    }
    if (!pointsEqual(previous.to, current.from)) {
      return fail(
        'discontinuous-segments',
        'Adjacent Position Move endpoints disagree.',
        sorted,
      );
    }
  }

  const points: PositionKey[] = [
    {
      timeMs: 0,
      position: copyPoint(empty.points[0]!.position),
      kind: 'base',
    },
    ...sorted.map((event) => ({
      timeMs: event.endMs,
      position: copyPoint(event.to),
      kind: 'key' as const,
    })),
  ];
  const chain = chainFrom(empty, points, sorted);
  return { status: 'editable', chain };
}

/** Create the first non-zero Position key from the 0:00 Base. */
export function createFirstPositionKey(
  chain: PositionChain,
  input: PositionKeyInput,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  if (chain.status !== 'none') {
    return operationFailure(
      'no-managed-chain',
      'The chain already has a non-zero Position key.',
    );
  }
  const positionError = validPosition(input.position);
  if (positionError) return positionError;
  const time = resolveOperationTime(chain, input.timeMs);
  if (typeof time !== 'number') return time;
  if (time <= 0 || time > lastValidFrameTime(chain.shotDurationMs)) {
    return operationFailure(
      'invalid-time',
      'The first Position key must be a non-zero in-range frame.',
    );
  }
  const idError = validNewEventId(chain, input.eventId);
  if (idError) return idError;
  const event = newMoveEvent(
    chain,
    input.eventId,
    0,
    time,
    basePoint(chain),
    input.position,
  );
  const next = chainFrom(
    chain,
    [
      ...chain.points,
      { timeMs: time, position: copyPoint(input.position), kind: 'key' },
    ],
    [event],
  );
  return operationSuccess(next, [input.eventId]);
}

/** Append a later Position key without changing existing runtime segments. */
export function appendPositionKey(
  chain: PositionChain,
  input: PositionKeyInput,
): PositionChainOperationResult {
  if (chain.status === 'none') {
    return createFirstPositionKey(chain, input);
  }
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const positionError = validPosition(input.position);
  if (positionError) return positionError;
  const time = resolveOperationTime(chain, input.timeMs);
  if (typeof time !== 'number') return time;
  const previous = chain.points[chain.points.length - 1]!;
  if (time <= previous.timeMs) {
    return operationFailure(
      'invalid-neighbor',
      'An appended Position key must be later than the last key.',
    );
  }
  if (time > lastValidFrameTime(chain.shotDurationMs)) {
    return operationFailure(
      'invalid-time',
      'A Position key must remain inside the last legal Shot frame.',
    );
  }
  const idError = validNewEventId(chain, input.eventId);
  if (idError) return idError;
  const event = newMoveEvent(
    chain,
    input.eventId,
    previous.timeMs,
    time,
    previous.position,
    input.position,
  );
  const next = chainFrom(
    chain,
    [
      ...chain.points,
      { timeMs: time, position: copyPoint(input.position), kind: 'key' },
    ],
    [...chain.segments, event],
  );
  return operationSuccess(next, [input.eventId]);
}

/** Insert a key into a tween, or update the existing key at that frame. */
export function insertPositionKey(
  chain: PositionChain,
  input: PositionKeyInput,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const positionError = validPosition(input.position);
  if (positionError) return positionError;
  const time = resolveOperationTime(chain, input.timeMs);
  if (typeof time !== 'number') return time;
  if (time === 0) {
    return operationFailure(
      'base-protected',
      'The 0:00 Base is not an ordinary insertable Position key.',
    );
  }
  const existingIndex = chain.points.findIndex((point) => point.timeMs === time);
  if (existingIndex >= 0) {
    return updatePositionKey(chain, {
      timeMs: time,
      position: input.position,
    });
  }
  if (chain.status !== 'editable') {
    return operationFailure(
      'no-segment',
      'A Position key can only be inserted inside an existing tween.',
    );
  }
  const rightIndex = chain.points.findIndex((point) => point.timeMs > time);
  if (rightIndex <= 0) {
    return operationFailure(
      'invalid-neighbor',
      'The inserted Position key has no valid segment to split.',
    );
  }
  const idError = validNewEventId(chain, input.eventId);
  if (idError) return idError;
  const leftIndex = rightIndex - 1;
  const right = chain.points[rightIndex]!;
  const covering = chain.segments[leftIndex]!;
  const firstEvent = patchMoveEvent(covering, {
    endMs: time,
    to: input.position,
  });
  const secondEvent = newMoveEvent(
    chain,
    input.eventId,
    time,
    right.timeMs,
    input.position,
    right.position,
  );
  const points = [...chain.points];
  points.splice(rightIndex, 0, {
    timeMs: time,
    position: copyPoint(input.position),
    kind: 'key',
  });
  const segments = [...chain.segments];
  segments.splice(leftIndex, 1, firstEvent, secondEvent);
  const next = chainFrom(chain, points, segments);
  return operationSuccess(next, [input.eventId], [covering.id]);
}

/** Update an existing logical key and both shared runtime endpoints. */
export function updatePositionKey(
  chain: PositionChain,
  input: Omit<PositionKeyInput, 'eventId'>,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const positionError = validPosition(input.position);
  if (positionError) return positionError;
  const time = resolveOperationTime(chain, input.timeMs);
  if (typeof time !== 'number') return time;
  const index = chain.points.findIndex((point) => point.timeMs === time);
  if (index < 0) {
    return operationFailure(
      'missing-key',
      'No logical Position key exists at the requested frame.',
    );
  }
  const current = chain.points[index]!;
  if (pointsEqual(current.position, input.position)) {
    return operationSuccess(chain);
  }

  const points = [...chain.points];
  points[index] = {
    ...current,
    position: copyPoint(input.position),
  };
  const segments = [...chain.segments];
  const changedEventIds: string[] = [];
  if (index > 0) {
    const previous = segments[index - 1]!;
    segments[index - 1] = patchMoveEvent(previous, { to: input.position });
    changedEventIds.push(previous.id);
  }
  if (index < segments.length) {
    const next = segments[index]!;
    segments[index] = patchMoveEvent(next, { from: input.position });
    changedEventIds.push(next.id);
  }
  return operationSuccess(
    chainFrom(chain, points, segments),
    [],
    changedEventIds,
  );
}

/** Delete one non-zero key and reconnect its neighboring checkpoints. */
export function deletePositionKey(
  chain: PositionChain,
  rawTimeMs: number,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const time = resolveOperationTime(chain, rawTimeMs);
  if (typeof time !== 'number') return time;
  if (time === 0) {
    return operationFailure(
      'base-protected',
      'The 0:00 Base cannot be deleted as an ordinary Position key.',
    );
  }
  const index = chain.points.findIndex((point) => point.timeMs === time);
  if (index < 0) {
    return operationFailure(
      'missing-key',
      'No logical Position key exists at the requested frame.',
    );
  }

  const points = [...chain.points];
  points.splice(index, 1);
  if (chain.segments.length === 1) {
    const removed = chain.segments[0]!;
    const next = chainFrom(chain, points, []);
    return operationSuccess(next, [], [], [removed.id]);
  }

  const segments = [...chain.segments];
  if (index === chain.points.length - 1) {
    const removed = segments.pop()!;
    const next = chainFrom(chain, points, segments);
    return operationSuccess(next, [], [], [removed.id]);
  }

  const previous = segments[index - 1]!;
  const nextEvent = segments[index]!;
  segments.splice(
    index - 1,
    2,
    patchMoveEvent(previous, {
      endMs: nextEvent.endMs,
      to: nextEvent.to,
    }),
  );
  const next = chainFrom(chain, points, segments);
  return operationSuccess(next, [], [previous.id], [nextEvent.id]);
}

/** Move a logical key in time without changing its spatial value. */
export function retimePositionKey(
  chain: PositionChain,
  rawFromTimeMs: number,
  rawToTimeMs: number,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const fromTime = resolveOperationTime(chain, rawFromTimeMs);
  if (typeof fromTime !== 'number') return fromTime;
  if (fromTime === 0) {
    return operationFailure(
      'base-protected',
      'The 0:00 Base cannot be retimed as an ordinary Position key.',
    );
  }
  const index = chain.points.findIndex((point) => point.timeMs === fromTime);
  if (index < 0) {
    return operationFailure(
      'missing-key',
      'No logical Position key exists at the requested frame.',
    );
  }
  const toTime = resolveOperationTime(chain, rawToTimeMs);
  if (typeof toTime !== 'number') return toTime;
  if (toTime === fromTime) return operationSuccess(chain);

  const previous = chain.points[index - 1]!;
  const nextPoint = chain.points[index + 1];
  const upperBound = nextPoint?.timeMs ?? lastValidFrameTime(chain.shotDurationMs);
  const crossesNeighbor = nextPoint
    ? toTime >= upperBound
    : toTime > upperBound;
  if (toTime <= previous.timeMs || crossesNeighbor) {
    return operationFailure(
      'invalid-neighbor',
      'A Position key cannot cross or collide with its immediate neighbors.',
    );
  }

  const points = [...chain.points];
  points[index] = { ...points[index]!, timeMs: toTime };
  const segments = [...chain.segments];
  const changedEventIds: string[] = [];
  const previousEvent = segments[index - 1]!;
  segments[index - 1] = patchMoveEvent(previousEvent, { endMs: toTime });
  changedEventIds.push(previousEvent.id);
  if (index < segments.length) {
    const nextEvent = segments[index]!;
    segments[index] = patchMoveEvent(nextEvent, { startMs: toTime });
    changedEventIds.push(nextEvent.id);
  }
  return operationSuccess(
    chainFrom(chain, points, segments),
    [],
    changedEventIds,
  );
}

/** Create an intentional repeated-value hold from the previous authored key. */
export function createHoldPositionKey(
  chain: PositionChain,
  input: PositionHoldInput,
): PositionChainOperationResult {
  const guarded = guardChain(chain);
  if (guarded) return guarded;
  const time = resolveOperationTime(chain, input.timeMs);
  if (typeof time !== 'number') return time;
  if (time === 0) {
    return operationFailure(
      'base-protected',
      'A hold point is only meaningful after the 0:00 Base point.',
    );
  }
  if (chain.points.some((point) => point.timeMs === time)) {
    return operationFailure(
      'existing-key',
      'A hold point cannot compete with an existing Position key.',
    );
  }

  if (chain.status === 'none') {
    return createFirstPositionKey(chain, {
      timeMs: time,
      position: basePoint(chain),
      eventId: input.eventId,
    });
  }

  const rightIndex = chain.points.findIndex((point) => point.timeMs > time);
  const previous =
    chain.points[rightIndex < 0 ? chain.points.length - 1 : rightIndex - 1]!;
  if (rightIndex < 0) {
    return appendPositionKey(chain, {
      timeMs: time,
      position: previous.position,
      eventId: input.eventId,
    });
  }
  return insertPositionKey(chain, {
    timeMs: time,
    position: previous.position,
    eventId: input.eventId,
  });
}

/** Return the normalized runtime MoveEvents for a validated pure chain. */
export function compilePositionChain(
  chain: PositionChain,
): readonly MoveEvent[] {
  const error = validatePositionChain(chain);
  if (error) {
    throw new Error(error.message);
  }
  return chain.segments;
}

/** Alias emphasizing that timelineEvents remain the persisted V1 truth. */
export const positionChainToMoveEvents = compilePositionChain;
