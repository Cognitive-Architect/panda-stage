import { describe, expect, it } from 'vitest';
import {
  interpolateFlaClassicMotionInstanceTransform,
  interpolateFlaLinearMotionTransform,
  type FlaMotionTweenRotation,
} from '../../src/main/services/fla-motion-tween-transform-interpolator';
import type { FlaDisplayListMatrix } from '../../src/main/services/fla-display-list-resolver';

const IDENTITY: FlaDisplayListMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

describe('FLA Classic Motion transform interpolation', () => {
  it('interpolates position and rotation as properties without shrinking the object', () => {
    const end: FlaDisplayListMatrix = {
      a: 0,
      b: 2,
      c: -3,
      d: 0,
      tx: 100,
      ty: -50,
    };

    const result = interpolateFlaLinearMotionTransform(IDENTITY, end, 0.5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matrix).toMatchObject({ tx: 50, ty: -25 });
    expect(result.matrix.a).toBeCloseTo(Math.SQRT2 * 0.75, 12);
    expect(result.matrix.b).toBeCloseTo(Math.SQRT2 * 0.75, 12);
    expect(result.matrix.c).toBeCloseTo(-Math.SQRT2, 12);
    expect(result.matrix.d).toBeCloseTo(Math.SQRT2, 12);
    expect(Math.hypot(result.matrix.a, result.matrix.b)).toBeCloseTo(1.5, 12);
    expect(Math.hypot(result.matrix.c, result.matrix.d)).toBeCloseTo(2, 12);
  });

  it('returns exact authored endpoint matrices at progress boundaries', () => {
    const start = {
      a: 0.422882080078125,
      b: 0.906173706054688,
      c: -0.906173706054688,
      d: 0.422882080078125,
      tx: 817.35,
      ty: 349.05,
    };
    const end = {
      a: 0.1009521484375,
      b: 0.994873046875,
      c: -0.994873046875,
      d: 0.1009521484375,
      tx: 1260.7,
      ty: 472.6,
    };

    expect(interpolateFlaLinearMotionTransform(start, end, 0)).toEqual({ ok: true, matrix: start });
    expect(interpolateFlaLinearMotionTransform(start, end, 1)).toEqual({ ok: true, matrix: end });
  });

  it('keeps an instance pivot on the straight world-space path through a Classic Motion span', () => {
    const end: FlaDisplayListMatrix = {
      a: 0,
      b: 1,
      c: -1,
      d: 0,
      tx: 20,
      ty: 30,
    };
    const startPivot = { x: 5, y: 7 };
    const endPivot = { x: 8, y: 3 };
    const result = interpolateFlaClassicMotionInstanceTransform(
      IDENTITY,
      end,
      0.5,
      undefined,
      startPivot,
      endPivot,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pivot = {
      x: startPivot.x + (endPivot.x - startPivot.x) * 0.5,
      y: startPivot.y + (endPivot.y - startPivot.y) * 0.5,
    };
    const expectedWorldPivot = { x: 11, y: 22.5 };
    expect(result.matrix.tx).toBeCloseTo(9.939339828220179, 12);
    expect(result.matrix.ty).toBeCloseTo(14.368272016354704, 12);
    expect(result.matrix.a * pivot.x + result.matrix.c * pivot.y + result.matrix.tx)
      .toBeCloseTo(expectedWorldPivot.x, 12);
    expect(result.matrix.b * pivot.x + result.matrix.d * pivot.y + result.matrix.ty)
      .toBeCloseTo(expectedWorldPivot.y, 12);
  });

  it('keeps authored matrices exact at pivot-corrected endpoint boundaries', () => {
    const end = { a: 0, b: 1, c: -1, d: 0, tx: 20, ty: 30 };
    const startPivot = { x: 5, y: 7 };
    const endPivot = { x: 8, y: 3 };
    expect(interpolateFlaClassicMotionInstanceTransform(
      IDENTITY,
      end,
      0,
      undefined,
      startPivot,
      endPivot,
    )).toEqual({ ok: true, matrix: IDENTITY });
    expect(interpolateFlaClassicMotionInstanceTransform(
      IDENTITY,
      end,
      1,
      undefined,
      startPivot,
      endPivot,
    )).toEqual({ ok: true, matrix: end });
  });

  it('leaves the legacy transform unchanged when both pivots are at the origin', () => {
    const end = { a: 0, b: 1, c: -1, d: 0, tx: 20, ty: 30 };
    expect(interpolateFlaClassicMotionInstanceTransform(IDENTITY, end, 0.5)).toEqual(
      interpolateFlaLinearMotionTransform(IDENTITY, end, 0.5),
    );
  });

  it('rejects non-finite transformation points', () => {
    expect(interpolateFlaClassicMotionInstanceTransform(
      IDENTITY,
      IDENTITY,
      0.5,
      undefined,
      { x: Number.NaN, y: 0 },
      { x: 0, y: 0 },
    )).toMatchObject({ ok: false, code: 'INVALID_PIVOT' });
  });

  it('keeps the legacy shortest arc when source rotation metadata is absent', () => {
    const negativeQuarterTurn: FlaDisplayListMatrix = {
      a: 0,
      b: -1,
      c: 1,
      d: 0,
      tx: 0,
      ty: 0,
    };
    const result = interpolateFlaLinearMotionTransform(IDENTITY, negativeQuarterTurn, 0.5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matrix.a).toBeCloseTo(Math.SQRT1_2, 12);
    expect(result.matrix.b).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  it('interpolates positive independent scales while keeping the axes orthogonal', () => {
    const end: FlaDisplayListMatrix = {
      a: 0,
      b: 2,
      c: -3,
      d: 0,
      tx: 0,
      ty: 0,
    };
    const result = interpolateFlaLinearMotionTransform(IDENTITY, end, 0.5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const startColumnLength = Math.hypot(result.matrix.a, result.matrix.b);
    const endColumnLength = Math.hypot(result.matrix.c, result.matrix.d);
    expect(startColumnLength).toBeCloseTo(1.5, 12);
    expect(endColumnLength).toBeCloseTo(2, 12);
    expect(result.matrix.a * result.matrix.c + result.matrix.b * result.matrix.d).toBeCloseTo(0, 12);
  });

  it('adds complete clockwise and counter-clockwise turns even when the endpoint matrix is unchanged', () => {
    const clockwise = interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, 0.25, {
      direction: 'clockwise',
      turns: 1,
    });
    const counterClockwise = interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, 0.25, {
      direction: 'counter-clockwise',
      turns: 1,
    });

    expect(clockwise.ok).toBe(true);
    if (clockwise.ok) {
      expect(clockwise.matrix.a).toBeCloseTo(0, 12);
      expect(clockwise.matrix.b).toBeCloseTo(1, 12);
    }
    expect(counterClockwise.ok).toBe(true);
    if (counterClockwise.ok) {
      expect(counterClockwise.matrix.a).toBeCloseTo(0, 12);
      expect(counterClockwise.matrix.b).toBeCloseTo(-1, 12);
    }
  });

  it('uses the authored direction to resolve a half-turn boundary', () => {
    const halfTurn: FlaDisplayListMatrix = { a: -1, b: 0, c: 0, d: -1, tx: 0, ty: 0 };
    const clockwise = interpolateFlaLinearMotionTransform(IDENTITY, halfTurn, 0.5, {
      direction: 'clockwise',
      turns: 0,
    });
    const counterClockwise = interpolateFlaLinearMotionTransform(IDENTITY, halfTurn, 0.5, {
      direction: 'counter-clockwise',
      turns: 0,
    });

    expect(clockwise.ok).toBe(true);
    if (clockwise.ok) expect(clockwise.matrix.b).toBeCloseTo(1, 12);
    expect(counterClockwise.ok).toBe(true);
    if (counterClockwise.ok) expect(counterClockwise.matrix.b).toBeCloseTo(-1, 12);
  });

  it('rejects an invalid rotation direction or non-integral/out-of-bound turn count', () => {
    const invalidDirection = { direction: 'cw', turns: 1 } as unknown as FlaMotionTweenRotation;
    expect(interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, 0.5, invalidDirection)).toMatchObject({
      ok: false,
      code: 'INVALID_ROTATION',
    });

    for (const turns of [-1, 1.5, 1_000_001]) {
      expect(interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, 0.5, {
        direction: 'clockwise',
        turns,
      })).toMatchObject({ ok: false, code: 'INVALID_ROTATION' });
    }
  });

  it('rejects progress outside the authored span', () => {
    expect(interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, -0.01)).toMatchObject({
      ok: false,
      code: 'INVALID_PROGRESS',
    });
    expect(interpolateFlaLinearMotionTransform(IDENTITY, IDENTITY, 1.01)).toMatchObject({
      ok: false,
      code: 'INVALID_PROGRESS',
    });
  });

  it('interpolates skew and uses entry-wise interpolation across a reflection', () => {
    const skewed = interpolateFlaLinearMotionTransform(IDENTITY, {
      a: 1,
      b: 0,
      c: 0.1,
      d: 1,
      tx: 0,
      ty: 0,
    }, 0.5);
    expect(skewed.ok).toBe(true);
    if (skewed.ok) {
      expect(skewed.matrix.c).toBeGreaterThan(0);
      expect(skewed.matrix.c).toBeLessThan(0.1);
    }

    const reflected = interpolateFlaLinearMotionTransform(IDENTITY, {
      a: -1,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0,
    }, 0.5);
    expect(reflected).toEqual({
      ok: true,
      matrix: { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    });

    const halfTurn = interpolateFlaLinearMotionTransform(IDENTITY, {
      a: -1,
      b: 0,
      c: 0,
      d: -1,
      tx: 0,
      ty: 0,
    }, 0.5);
    expect(halfTurn.ok).toBe(true);
    if (halfTurn.ok) expect(halfTurn.matrix.b).toBeCloseTo(-1, 12);
  });

  it('rejects non-finite matrices', () => {
    expect(interpolateFlaLinearMotionTransform({ ...IDENTITY, tx: Number.NaN }, IDENTITY, 0.5)).toMatchObject({
      ok: false,
      code: 'INVALID_MATRIX',
    });
  });
});
