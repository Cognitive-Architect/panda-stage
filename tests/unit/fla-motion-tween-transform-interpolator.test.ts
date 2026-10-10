import { describe, expect, it } from 'vitest';
import {
  interpolateFlaLinearMotionTransform,
} from '../../src/main/services/fla-motion-tween-transform-interpolator';
import type { FlaDisplayListMatrix } from '../../src/main/services/fla-display-list-resolver';

const IDENTITY: FlaDisplayListMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

describe('bounded FLA linear motion transform interpolation', () => {
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

  it('fails closed for skew, reflection, and ambiguous half-turns', () => {
    expect(interpolateFlaLinearMotionTransform(IDENTITY, {
      a: 1,
      b: 0,
      c: 0.1,
      d: 1,
      tx: 0,
      ty: 0,
    }, 0.5)).toMatchObject({ ok: false, code: 'UNSUPPORTED_SKEW' });

    expect(interpolateFlaLinearMotionTransform(IDENTITY, {
      a: -1,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0,
    }, 0.5)).toMatchObject({ ok: false, code: 'UNSUPPORTED_REFLECTION' });

    expect(interpolateFlaLinearMotionTransform(IDENTITY, {
      a: -1,
      b: 0,
      c: 0,
      d: -1,
      tx: 0,
      ty: 0,
    }, 0.5)).toMatchObject({ ok: false, code: 'AMBIGUOUS_ROTATION' });
  });

  it('rejects non-finite matrices', () => {
    expect(interpolateFlaLinearMotionTransform({ ...IDENTITY, tx: Number.NaN }, IDENTITY, 0.5)).toMatchObject({
      ok: false,
      code: 'INVALID_MATRIX',
    });
  });
});
