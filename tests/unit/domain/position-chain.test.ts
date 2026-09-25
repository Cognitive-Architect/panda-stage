import { describe, expect, it } from 'vitest';
import {
  appendPositionKey,
  bindPositionBase,
  compilePositionChain,
  createEmptyPositionChain,
  createFirstPositionKey,
  createHoldPositionKey,
  deletePositionKey,
  frameTimeMs,
  insertPositionKey,
  lastValidFrameTime,
  recognizePositionChain,
  retimePositionKey,
  updatePositionKey,
  type MoveEvent,
  type PositionChain,
  type PositionChainOperationResult,
} from '../../../src/domain';

const LAYER_ID = '10000000-0000-4000-8000-000000000001';
const EVENT_A = '10000000-0000-4000-8000-000000000011';
const EVENT_B = '10000000-0000-4000-8000-000000000012';
const EVENT_C = '10000000-0000-4000-8000-000000000013';
const EVENT_D = '10000000-0000-4000-8000-000000000014';
const BASE = { x: 100, y: 200 };
const B = { x: 300, y: 400 };
const C = { x: 500, y: 600 };
const D = { x: 700, y: 800 };

function move(
  id: string,
  startMs: number,
  endMs: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  easing: MoveEvent['easing'] = 'linear',
): MoveEvent {
  return {
    id,
    type: 'move',
    layerId: LAYER_ID,
    startMs,
    endMs,
    from,
    to,
    easing,
  };
}

function empty(durationMs = 8_000): PositionChain {
  return createEmptyPositionChain({
    layerId: LAYER_ID,
    shotDurationMs: durationMs,
    basePosition: BASE,
  });
}

function chainWithTwoKeys(): PositionChain {
  const first = createFirstPositionKey(empty(), {
    timeMs: 4_000,
    position: B,
    eventId: EVENT_A,
  });
  if (!first.ok) throw new Error(first.error.message);
  return first.chain;
}

function chainWithThreeKeys(): PositionChain {
  const first = chainWithTwoKeys();
  const appended = appendPositionKey(first, {
    timeMs: 7_000,
    position: C,
    eventId: EVENT_B,
  });
  if (!appended.ok) throw new Error(appended.error.message);
  return appended.chain;
}

function recognize(events: readonly MoveEvent[], durationMs = 8_000) {
  return recognizePositionChain({
    shot: { durationMs, timelineEvents: events },
    layer: { id: LAYER_ID, x: BASE.x, y: BASE.y },
  });
}

describe('24 FPS frame-grid boundaries', () => {
  it('keeps an already-legal rounded persisted frame as the last frame', () => {
    expect(frameTimeMs(14)).toBe(583);
    expect(lastValidFrameTime(582)).toBe(542);
    expect(lastValidFrameTime(583)).toBe(583);
    expect(lastValidFrameTime(584)).toBe(583);
  });

  it.each([0, 1, 2, 13, 14, 24, 71, 103])(
    'returns the same legal persisted frame for frame index %s',
    (frameIndex) => {
      const persistedTime = frameTimeMs(frameIndex);
      expect(lastValidFrameTime(persistedTime)).toBe(persistedTime);
    },
  );
});

describe('Position-chain recognition', () => {
  it('recognizes no managed animation without mutating the input', () => {
    const events = [
      move('10000000-0000-4000-8000-000000000021', 0, 1_000, BASE, B),
    ];
    const snapshot = structuredClone(events);
    const result = recognizePositionChain({
      shot: { durationMs: 8_000, timelineEvents: [] },
      layer: { id: LAYER_ID, x: BASE.x, y: BASE.y },
      timelineEvents: [],
    });
    expect(result.status).toBe('none');
    if (result.status !== 'none') return;
    expect(result.chain.points).toEqual([
      { timeMs: 0, position: BASE, kind: 'base' },
    ]);
    expect(events).toEqual(snapshot);
  });

  it('adopts a clean 0:00 Base -> 4s -> 7s chain and preserves event identity', () => {
    const events = [move(EVENT_A, 0, 4_000, BASE, B), move(EVENT_B, 4_000, 7_000, B, C)];
    const result = recognize(events);

    expect(result.status).toBe('editable');
    if (result.status !== 'editable') return;
    expect(result.chain.points).toEqual([
      { timeMs: 0, position: BASE, kind: 'base' },
      { timeMs: 4_000, position: B, kind: 'key' },
      { timeMs: 7_000, position: C, kind: 'key' },
    ]);
    expect(result.chain.segments[0]).toBe(events[0]);
    expect(result.chain.segments[1]).toBe(events[1]);
  });

  it.each([
    ['non-linear', [move(EVENT_A, 0, 4_000, BASE, B, 'ease-in-out')], 'non-linear-easing'],
    ['missing root', [move(EVENT_A, 1_000, 4_000, BASE, B)], 'missing-base-segment'],
    ['base mismatch', [move(EVENT_A, 0, 4_000, { x: 101, y: 200 }, B)], 'base-mismatch'],
    ['gap', [move(EVENT_A, 0, 4_000, BASE, B), move(EVENT_B, 5_000, 7_000, B, C)], 'discontinuous-segments'],
    ['overlap', [move(EVENT_A, 0, 4_000, BASE, B), move(EVENT_B, 3_000, 7_000, B, C)], 'overlapping-segments'],
    ['discontinuous endpoints', [move(EVENT_A, 0, 4_000, BASE, B), move(EVENT_B, 4_000, 7_000, D, C)], 'discontinuous-segments'],
    ['same-time competition', [move(EVENT_A, 0, 4_000, BASE, B), move(EVENT_B, 0, 7_000, BASE, C)], 'same-time-competing-keys'],
    ['off-grid', [move(EVENT_A, 0, 4_001, BASE, B)], 'off-frame'],
    ['outside Shot', [move(EVENT_A, 0, 9_000, BASE, B)], 'outside-shot'],
  ] as const)('leaves %s legacy data playback-only with a reason', (_label, events, code) => {
    const snapshot = structuredClone(events);
    const result = recognize(events);
    expect(result.status).toBe('playback-only');
    if (result.status !== 'playback-only') return;
    expect(result.reason.code).toBe(code);
    expect(result.events).toEqual(events);
    expect(events).toEqual(snapshot);
  });

  it('does not treat another layer’s MoveEvents as this layer’s Position chain', () => {
    const result = recognize([
      {
        ...move(EVENT_A, 0, 4_000, BASE, B),
        layerId: '10000000-0000-4000-8000-000000000099',
      },
    ]);
    expect(result.status).toBe('none');
  });
});

describe('pure Position-chain operations', () => {
  it('creates and appends linear first and later keys', () => {
    const first = createFirstPositionKey(empty(), {
      timeMs: 4_003,
      position: B,
      eventId: EVENT_A,
    });
    expect(first).toMatchObject({ ok: true, addedEventIds: [EVENT_A] });
    if (!first.ok) return;
    expect(first.chain.points.map((point) => point.timeMs)).toEqual([0, 4_000]);
    expect(first.chain.segments[0]).toMatchObject({
      id: EVENT_A,
      startMs: 0,
      endMs: 4_000,
      from: BASE,
      to: B,
      easing: 'linear',
    });

    const second = appendPositionKey(first.chain, {
      timeMs: 7_000,
      position: C,
      eventId: EVENT_B,
    });
    expect(second).toMatchObject({ ok: true, addedEventIds: [EVENT_B] });
    if (!second.ok) return;
    expect(second.chain.segments[0]).toBe(first.chain.segments[0]);
    expect(second.chain.segments[1]).toMatchObject({
      startMs: 4_000,
      endMs: 7_000,
      from: B,
      to: C,
      easing: 'linear',
    });
  });

  it('inserts a logical key by splitting one covering segment', () => {
    const first = createFirstPositionKey(empty(), {
      timeMs: 7_000,
      position: C,
      eventId: EVENT_A,
    });
    if (!first.ok) throw new Error(first.error.message);
    const original = first.chain.segments[0]!;
    const result = insertPositionKey(first.chain, {
      timeMs: 4_000,
      position: B,
      eventId: EVENT_B,
    });
    expect(result).toMatchObject({
      ok: true,
      addedEventIds: [EVENT_B],
      changedEventIds: [EVENT_A],
    });
    if (!result.ok) return;
    expect(result.chain.points.map((point) => point.timeMs)).toEqual([0, 4_000, 7_000]);
    expect(result.chain.segments).toEqual([
      expect.objectContaining({ id: EVENT_A, startMs: 0, endMs: 4_000, from: BASE, to: B }),
      expect.objectContaining({ id: EVENT_B, startMs: 4_000, endMs: 7_000, from: B, to: C }),
    ]);
    expect(result.chain.segments).not.toContain(original);
  });

  it('updates both runtime endpoints of an existing logical key', () => {
    const chain = chainWithThreeKeys();
    const result = updatePositionKey(chain, { timeMs: 4_000, position: D });
    expect(result).toMatchObject({ ok: true, changedEventIds: [EVENT_A, EVENT_B] });
    if (!result.ok) return;
    expect(result.chain.points[1]).toMatchObject({ timeMs: 4_000, position: D });
    expect(result.chain.segments[0]).toMatchObject({ to: D });
    expect(result.chain.segments[1]).toMatchObject({ from: D });
    expect(result.chain.segments[0]!.id).toBe(EVENT_A);
    expect(result.chain.segments[1]!.id).toBe(EVENT_B);
  });

  it('deletes a middle key by reconnecting its neighbors', () => {
    const result = deletePositionKey(chainWithThreeKeys(), 4_000);
    expect(result).toMatchObject({
      ok: true,
      changedEventIds: [EVENT_A],
      removedEventIds: [EVENT_B],
    });
    if (!result.ok) return;
    expect(result.chain.points.map((point) => point.timeMs)).toEqual([0, 7_000]);
    expect(result.chain.segments).toEqual([
      expect.objectContaining({ id: EVENT_A, startMs: 0, endMs: 7_000, from: BASE, to: C }),
    ]);
  });

  it('deletes terminal C while preserving the complete A -> B segment', () => {
    const result = deletePositionKey(chainWithThreeKeys(), 7_000);
    expect(result).toMatchObject({
      ok: true,
      removedEventIds: [EVENT_B],
    });
    if (!result.ok) return;
    expect(result.chain.points).toEqual([
      { timeMs: 0, position: BASE, kind: 'base' },
      { timeMs: 4_000, position: B, kind: 'key' },
    ]);
    expect(result.chain.segments).toEqual([
      expect.objectContaining({
        id: EVENT_A,
        startMs: 0,
        endMs: 4_000,
        from: BASE,
        to: B,
        easing: 'linear',
      }),
    ]);
    expect(result.chain.segments).toHaveLength(1);
    expect(result.chain.segments.some((event) => event.id === EVENT_B)).toBe(false);
  });

  it('deletes the last non-zero key and removes the managed animation when it was the only key', () => {
    const chain = chainWithTwoKeys();
    const removed = deletePositionKey(chain, 4_000);
    expect(removed).toMatchObject({ ok: true, removedEventIds: [EVENT_A] });
    if (!removed.ok) return;
    expect(removed.chain.status).toBe('none');
    expect(removed.chain.points).toEqual([
      { timeMs: 0, position: BASE, kind: 'base' },
    ]);
    expect(compilePositionChain(removed.chain)).toEqual([]);
  });

  it('protects Base from ordinary deletion, retiming, and update', () => {
    const chain = chainWithTwoKeys();
    expect(deletePositionKey(chain, 0)).toMatchObject({
      ok: false,
      error: { code: 'base-protected' },
    });
    expect(retimePositionKey(chain, 0, 1_000)).toMatchObject({
      ok: false,
      error: { code: 'base-protected' },
    });

    expect(updatePositionKey(chain, { timeMs: 0, position: D })).toMatchObject({
      ok: false,
      error: { code: 'base-protected' },
    });
    expect(updatePositionKey(chain, { timeMs: 20, position: D })).toMatchObject({
      ok: false,
      error: { code: 'base-protected' },
    });
  });

  it('binds the protected Base only through the explicit Base operation', () => {
    const chain = chainWithThreeKeys();
    const result = bindPositionBase(chain, D);

    expect(result).toMatchObject({
      ok: true,
      changedEventIds: [EVENT_A],
    });
    if (!result.ok) return;
    expect(result.chain.points[0]).toMatchObject({ timeMs: 0, position: D });
    expect(result.chain.points[1]).toMatchObject({ timeMs: 4_000, position: B });
    expect(result.chain.points[2]).toMatchObject({ timeMs: 7_000, position: C });
    expect(result.chain.segments[0]).toMatchObject({ from: D, to: B });
    expect(result.chain.segments[1]).toMatchObject({ from: B, to: C });
  });

  it('retimes without changing spatial values and prevents crossing/collisions', () => {
    const chain = chainWithThreeKeys();
    const result = retimePositionKey(chain, 4_000, 5_000);
    expect(result).toMatchObject({ ok: true, changedEventIds: [EVENT_A, EVENT_B] });
    if (!result.ok) return;
    expect(result.chain.points.map((point) => point.timeMs)).toEqual([0, 5_000, 7_000]);
    expect(result.chain.points[1]!.position).toEqual(B);
    expect(result.chain.segments[0]).toMatchObject({ startMs: 0, endMs: 5_000, from: BASE, to: B });
    expect(result.chain.segments[1]).toMatchObject({ startMs: 5_000, endMs: 7_000, from: B, to: C });
    expect(retimePositionKey(chain, 4_000, 7_000)).toMatchObject({
      ok: false,
      error: { code: 'invalid-neighbor' },
    });
    expect(retimePositionKey(chain, 4_000, 0)).toMatchObject({
      ok: false,
      error: { code: 'invalid-neighbor' },
    });

    const lastKeyAtShotEnd = retimePositionKey(chain, 7_000, 8_000);
    expect(lastKeyAtShotEnd).toMatchObject({ ok: true });
    if (lastKeyAtShotEnd.ok) {
      expect(lastKeyAtShotEnd.chain.points.at(-1)?.timeMs).toBe(8_000);
    }
  });

  it('rejects finite authoring times outside the Shot for every PK-01 operation', () => {
    const operations: readonly [string, (timeMs: number) => PositionChainOperationResult][] = [
      [
        'create first',
        (timeMs) =>
          createFirstPositionKey(empty(), {
            timeMs,
            position: B,
            eventId: EVENT_C,
          }),
      ],
      [
        'append',
        (timeMs) =>
          appendPositionKey(chainWithTwoKeys(), {
            timeMs,
            position: C,
            eventId: EVENT_C,
          }),
      ],
      [
        'insert',
        (timeMs) =>
          insertPositionKey(chainWithTwoKeys(), {
            timeMs,
            position: C,
            eventId: EVENT_C,
          }),
      ],
      [
        'update',
        (timeMs) =>
          updatePositionKey(chainWithTwoKeys(), {
            timeMs,
            position: C,
          }),
      ],
      ['delete', (timeMs) => deletePositionKey(chainWithTwoKeys(), timeMs)],
      [
        'retime source',
        (timeMs) => retimePositionKey(chainWithTwoKeys(), timeMs, 2_000),
      ],
      [
        'retime target',
        (timeMs) => retimePositionKey(chainWithTwoKeys(), 4_000, timeMs),
      ],
      [
        'hold',
        (timeMs) =>
          createHoldPositionKey(chainWithTwoKeys(), {
            timeMs,
            eventId: EVENT_C,
          }),
      ],
    ];

    for (const timeMs of [-1, 8_001]) {
      for (const [name, operation] of operations) {
        expect(operation(timeMs), `${name} at ${timeMs}ms`).toMatchObject({
          ok: false,
          error: { code: 'invalid-time' },
        });
      }
    }
  });

  it('does not create or retime a point at the Shot edge after an out-of-range rejection', () => {
    const emptyChain = empty();
    const emptySnapshot = structuredClone(emptyChain);
    const createResult = createFirstPositionKey(emptyChain, {
      timeMs: 8_001,
      position: D,
      eventId: EVENT_C,
    });
    expect(createResult).toMatchObject({
      ok: false,
      error: { code: 'invalid-time' },
    });
    expect(emptyChain).toEqual(emptySnapshot);
    expect(emptyChain.points).toHaveLength(1);

    const chain = chainWithThreeKeys();
    const chainSnapshot = structuredClone(chain);
    const retimeResult = retimePositionKey(chain, 4_000, -1);
    expect(retimeResult).toMatchObject({
      ok: false,
      error: { code: 'invalid-time' },
    });
    expect(chain).toEqual(chainSnapshot);
    expect(chain.points.map((point) => point.timeMs)).toEqual([0, 4_000, 7_000]);
  });

  it('creates a repeated-value hold from the previous authored point, not interpolation', () => {
    const result = createHoldPositionKey(chainWithTwoKeys(), {
      timeMs: 2_000,
      eventId: EVENT_C,
    });
    expect(result).toMatchObject({ ok: true, addedEventIds: [EVENT_C] });
    if (!result.ok) return;
    expect(result.chain.points).toEqual([
      { timeMs: 0, position: BASE, kind: 'base' },
      { timeMs: 2_000, position: BASE, kind: 'key' },
      { timeMs: 4_000, position: B, kind: 'key' },
    ]);
    expect(result.chain.segments).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 2_000, from: BASE, to: BASE, easing: 'linear' }),
      expect.objectContaining({ startMs: 2_000, endMs: 4_000, from: BASE, to: B, easing: 'linear' }),
    ]);
  });

  it('can create a first or terminal hold without inventing an interpolated value', () => {
    const first = createHoldPositionKey(empty(), {
      timeMs: 2_000,
      eventId: EVENT_C,
    });
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    expect(first.chain.points[1]).toEqual({ timeMs: 2_000, position: BASE, kind: 'key' });

    const terminal = createHoldPositionKey(chainWithTwoKeys(), {
      timeMs: 6_000,
      eventId: EVENT_C,
    });
    expect(terminal).toMatchObject({ ok: true });
    if (!terminal.ok) return;
    expect(terminal.chain.points.at(-1)).toEqual({ timeMs: 6_000, position: B, kind: 'key' });
    expect(terminal.chain.segments.at(-1)).toMatchObject({
      startMs: 4_000,
      endMs: 6_000,
      from: B,
      to: B,
    });
  });

  it('uses the final legal frame for an off-grid Shot end and never rewrites Shot duration', () => {
    const durationMs = 4_321;
    expect(lastValidFrameTime(durationMs)).toBe(4_292);
    const result = createFirstPositionKey(empty(durationMs), {
      timeMs: durationMs,
      position: B,
      eventId: EVENT_D,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.chain.shotDurationMs).toBe(durationMs);
    expect(result.chain.points[1]!.timeMs).toBe(4_292);
    expect(result.chain.points[1]!.timeMs).not.toBe(durationMs);
    expect(result.chain.segments[0]!.endMs).toBe(4_292);
  });

  it('requires deterministic ids for newly created runtime segments', () => {
    const result = createFirstPositionKey(empty(), {
      timeMs: 4_000,
      position: B,
      eventId: 'not-a-uuid',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-event-id' } });
  });
});
