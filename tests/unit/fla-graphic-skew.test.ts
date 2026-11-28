import { describe, expect, it } from 'vitest';
import {
  composeAffineMatrix,
  decomposeAffineMatrix,
  evaluateFlaGraphicTrackAtTime,
  interpolateDecomposedTransform,
  isAffineMatrixDecomposable,
  isAffineMatrixTimelineRepresentable,
  isAffineMatrixTrsSafe,
  isDecomposedTransformPairInterpolationSafe,
  isFlaGraphicTransformTrackInterpolationSafe,
  type FlaGraphicDecomposedTransform,
  type FlaGraphicTransformEasing,
  type FlaGraphicTransformTrack,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';

const MATRIX_KEYS = ['a', 'b', 'c', 'd', 'tx', 'ty'] as const;

function expectMatrixClose(
  actual: AffineMatrix2D,
  expected: AffineMatrix2D,
  epsilon = 1e-9,
): void {
  for (const key of MATRIX_KEYS) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${key}: ${actual[key]} vs ${expected[key]}`,
    ).toBeLessThanOrEqual(epsilon);
  }
}

function expectRoundTrip(matrix: AffineMatrix2D, epsilon = 1e-9): void {
  expectMatrixClose(composeAffineMatrix(decomposeAffineMatrix(matrix)), matrix, epsilon);
}

/** Historical E6 V1 TRS-only decomposition, kept verbatim as the baseline. */
function legacyDecompose(matrix: AffineMatrix2D): FlaGraphicDecomposedTransform {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY =
    scaleX > 1e-12 ? determinant / scaleX : Math.hypot(matrix.c, matrix.d);
  const rotationDeg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return { tx: matrix.tx, ty: matrix.ty, rotationDeg, scaleX, scaleY };
}

/** Historical E6 V1 TRS-only composition, kept verbatim as the baseline. */
function legacyCompose(transform: FlaGraphicDecomposedTransform): AffineMatrix2D {
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: transform.scaleX * cos,
    b: transform.scaleX * sin,
    c: -transform.scaleY * sin,
    d: transform.scaleY * cos,
    tx: transform.tx,
    ty: transform.ty,
  };
}

const TRS_SAMPLES: readonly AffineMatrix2D[] = [
  composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }),
  composeAffineMatrix({ tx: 12, ty: -8, rotationDeg: 37, scaleX: 1.4, scaleY: 0.75 }),
  composeAffineMatrix({ tx: -120, ty: 44, rotationDeg: -170, scaleX: 0.25, scaleY: 3 }),
  composeAffineMatrix({ tx: 3, ty: 4, rotationDeg: 180, scaleX: 2, scaleY: 2 }),
  // Mirrored TRS: scaleY carries the sign.
  composeAffineMatrix({ tx: 5, ty: 6, rotationDeg: 20, scaleX: 1.2, scaleY: -0.8 }),
  composeAffineMatrix({ tx: 5, ty: 6, rotationDeg: -20, scaleX: -1.2, scaleY: 0.8 }),
];

const SKEW_SAMPLES: readonly AffineMatrix2D[] = [
  { a: 1, b: 0, c: 0.45, d: 1, tx: 12, ty: -8 },
  { a: 0.8, b: 0.35, c: -0.2, d: 1.1, tx: 2, ty: 3 },
  { a: 1.25, b: -0.4, c: 0.7, d: -0.9, tx: -3, ty: 7 },
  { a: -2, b: 0.5, c: 0.3, d: -1, tx: 0, ty: 0 },
];

describe('FLA Graphic exact affine (skew/shear) decomposition', () => {
  it('round-trips every TRS sample without adding skewXDeg, matching the legacy decomposition exactly', () => {
    for (const matrix of TRS_SAMPLES) {
      expect(isAffineMatrixTrsSafe(matrix)).toBe(true);
      const decomposed = decomposeAffineMatrix(matrix);
      expect(Object.prototype.hasOwnProperty.call(decomposed, 'skewXDeg')).toBe(false);
      // Byte-identical to the historical TRS decomposition (JSON equality).
      expect(JSON.parse(JSON.stringify(decomposed))).toEqual(legacyDecompose(matrix));
      expectRoundTrip(matrix, 1e-12);
    }
  });

  it('round-trips sheared and mirrored matrices exactly through composeAffineMatrix', () => {
    for (const matrix of [...SKEW_SAMPLES, ...TRS_SAMPLES]) {
      const decomposed = decomposeAffineMatrix(matrix);
      expectRoundTrip(matrix, 1e-9);
      const recomposed = composeAffineMatrix(decomposed);
      // Determinant sign (mirror) is preserved by scaleY.
      expect(Math.sign(recomposed.a * recomposed.d - recomposed.b * recomposed.c))
        .toBe(Math.sign(matrix.a * matrix.d - matrix.b * matrix.c));
      // scaleX is normalized to >= 0; skewXDeg lives in (-90, 90) degrees.
      expect(decomposed.scaleX).toBeGreaterThanOrEqual(0);
      if (decomposed.skewXDeg !== undefined) {
        expect(Math.abs(decomposed.skewXDeg)).toBeLessThan(90);
      }
    }
  });

  it('uses the documented convention shear = scaleY * tan(skewXDeg) in K * S', () => {
    const matrix = { a: 1, b: 0, c: 0.5, d: 1, tx: 10, ty: 20 };
    const decomposed = decomposeAffineMatrix(matrix);
    expect(decomposed.rotationDeg).toBeCloseTo(0, 12);
    expect(decomposed.scaleX).toBeCloseTo(1, 12);
    expect(decomposed.scaleY).toBeCloseTo(1, 12);
    const tanSkew = Math.tan(((decomposed.skewXDeg ?? 0) * Math.PI) / 180);
    expect(decomposed.scaleY * tanSkew).toBeCloseTo(0.5, 12);
    // The same convention reproduces the matrix entry directly.
    expect(composeAffineMatrix(decomposed).c).toBeCloseTo(0.5, 12);
  });

  it('rejects non-finite, near-singular, and non-round-tripping matrices as undecomposable', () => {
    const nearSingular = { a: 1, b: 1, c: 1, d: 1 + 1e-9, tx: 0, ty: 0 };
    expect(isAffineMatrixDecomposable(nearSingular)).toBe(false);
    expect(isAffineMatrixTrsSafe(nearSingular)).toBe(false);
    expect(isAffineMatrixTimelineRepresentable(nearSingular)).toBe(false);
    for (const matrix of [
      { a: Number.NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      { a: 1, b: 0, c: 0, d: Number.POSITIVE_INFINITY, tx: 0, ty: 0 },
      { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
      { a: 1, b: 1, c: 1, d: 1, tx: 0, ty: 0 },
    ]) {
      expect(isAffineMatrixDecomposable(matrix)).toBe(false);
    }
  });

  it('accepts TRS, shear, and mirrored matrices as decomposable while keeping trsSafe semantics unchanged', () => {
    for (const matrix of [...TRS_SAMPLES, ...SKEW_SAMPLES]) {
      expect(isAffineMatrixDecomposable(matrix)).toBe(true);
      expect(isAffineMatrixTimelineRepresentable(matrix)).toBe(true);
    }
    // trsSafe keeps its exact historical meaning: shear is NOT trsSafe.
    expect(isAffineMatrixTrsSafe({ a: 1, b: 0, c: 0.45, d: 1, tx: 0, ty: 0 })).toBe(false);
    // Collapsed axis is singular but still TRS-safe, so legacy keys stay editable.
    const collapsed = { a: 1, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
    expect(isAffineMatrixTrsSafe(collapsed)).toBe(true);
    expect(isAffineMatrixDecomposable(collapsed)).toBe(false);
    expect(isAffineMatrixTimelineRepresentable(collapsed)).toBe(true);
  });

  it('interpolates a sheared pair with exact endpoints, finite mid-frame, and no determinant flip', () => {
    const from = decomposeAffineMatrix({
      a: 1.2, b: 0.1, c: 0.35, d: 0.9, tx: 10, ty: 20,
    });
    const to = decomposeAffineMatrix({
      a: 0.7, b: -0.25, c: -0.1, d: 1.3, tx: 110, ty: -20,
    });
    expect(from.skewXDeg).toBeDefined();
    expect(to.skewXDeg).toBeDefined();

    expect(interpolateDecomposedTransform(from, to, 0, 'linear')).toBe(from);
    expect(interpolateDecomposedTransform(from, to, 1, 'linear')).toBe(to);
    expect(composeAffineMatrix(interpolateDecomposedTransform(from, to, 0, 'linear')))
      .toEqual(composeAffineMatrix(from));
    expect(composeAffineMatrix(interpolateDecomposedTransform(from, to, 1, 'linear')))
      .toEqual(composeAffineMatrix(to));

    const fromSign = Math.sign(from.scaleY);
    const toSign = Math.sign(to.scaleY);
    expect(fromSign).toBe(toSign);
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const mid = interpolateDecomposedTransform(from, to, progress, 'linear');
      expect(Number.isFinite(mid.skewXDeg)).toBe(true);
      const matrix = composeAffineMatrix(mid);
      expect(MATRIX_KEYS.every((key) => Number.isFinite(matrix[key]))).toBe(true);
      expect(Math.sign(matrix.a * matrix.d - matrix.b * matrix.c)).toBe(fromSign);
    }
  });

  it('interpolates 170° to -170° the short way but does not guess a full 360° turn', () => {
    const from = composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: 170, scaleX: 1, scaleY: 1 });
    const to = composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: -170, scaleX: 1, scaleY: 1 });
    const mid = interpolateDecomposedTransform(
      decomposeAffineMatrix(from),
      decomposeAffineMatrix(to),
      0.5,
      'linear',
    );
    // Shortest route is +20°, so 170° -> 180° at the midpoint.
    expect(mid.rotationDeg).toBeCloseTo(180, 9);

    const fullTurnFrom = decomposeAffineMatrix(
      composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 }),
    );
    const fullTurnTo = decomposeAffineMatrix(
      composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: 360, scaleX: 1, scaleY: 1 }),
    );
    const quarterTurn = interpolateDecomposedTransform(
      fullTurnFrom,
      fullTurnTo,
      0.25,
      'linear',
    );
    // A 360° authored difference is not auto-expanded into a guessed turn.
    expect(quarterTurn.rotationDeg).toBeCloseTo(0, 9);
    // Endpoints remain exact regardless.
    expect(interpolateDecomposedTransform(fullTurnFrom, fullTurnTo, 0, 'linear')).toBe(fullTurnFrom);
    expect(interpolateDecomposedTransform(fullTurnFrom, fullTurnTo, 1, 'linear')).toBe(fullTurnTo);
  });

  it('flags determinant sign-flip key pairs as unsafe for decomposed interpolation', () => {
    const positive = decomposeAffineMatrix({ a: 1, b: 0, c: 0.2, d: 1, tx: 0, ty: 0 });
    const negative = decomposeAffineMatrix({ a: 1, b: 0, c: 0.2, d: -1, tx: 0, ty: 0 });
    expect(positive.scaleY).toBeGreaterThan(0);
    expect(negative.scaleY).toBeLessThan(0);
    expect(isDecomposedTransformPairInterpolationSafe(positive, negative)).toBe(false);
    expect(isDecomposedTransformPairInterpolationSafe(positive, positive)).toBe(true);
    // A collapsed axis is not a sign flip.
    const collapsed = { tx: 0, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 0 };
    expect(isDecomposedTransformPairInterpolationSafe(positive, collapsed)).toBe(true);

    const track = (first: FlaGraphicDecomposedTransform, second: FlaGraphicDecomposedTransform): FlaGraphicTransformTrack => ({
      trackId: 'addr:Hero/arm',
      keyframes: [
        { timeMs: 0, transform: first, easing: 'linear' },
        { timeMs: 1_000, transform: second, easing: 'linear' },
      ],
    });
    expect(isFlaGraphicTransformTrackInterpolationSafe(track(positive, positive))).toBe(true);
    expect(isFlaGraphicTransformTrackInterpolationSafe(track(positive, negative))).toBe(false);
  });

  it('evaluates pure-TRS tracks byte-identically to the legacy E6 evaluator', () => {
    const legacyEase = (raw: number, easing: FlaGraphicTransformEasing): number => {
      if (easing === 'hold') return 0;
      if (easing === 'linear') return raw;
      return raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    };
    const legacyShortest = (fromDeg: number, toDeg: number): number =>
      ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
    const legacyEvaluate = (
      track: FlaGraphicTransformTrack,
      internalTimeMs: number,
    ): AffineMatrix2D | null => {
      const { keyframes } = track;
      if (keyframes.length === 0) return null;
      const time = Number.isFinite(internalTimeMs)
        ? Math.max(0, internalTimeMs)
        : 0;
      const first = keyframes[0]!;
      if (time <= first.timeMs) return legacyCompose(first.transform);
      const last = keyframes[keyframes.length - 1]!;
      if (time >= last.timeMs) return legacyCompose(last.transform);
      for (let index = 0; index < keyframes.length - 1; index += 1) {
        const start = keyframes[index]!;
        const end = keyframes[index + 1]!;
        if (time === start.timeMs) return legacyCompose(start.transform);
        if (time < end.timeMs) {
          const span = end.timeMs - start.timeMs;
          const rawProgress = span > 0 ? (time - start.timeMs) / span : 1;
          if (rawProgress <= 0 || start.easing === 'hold') {
            return legacyCompose(start.transform);
          }
          if (rawProgress >= 1) return legacyCompose(end.transform);
          const t = legacyEase(rawProgress, start.easing);
          return legacyCompose({
            tx: start.transform.tx + (end.transform.tx - start.transform.tx) * t,
            ty: start.transform.ty + (end.transform.ty - start.transform.ty) * t,
            rotationDeg:
              start.transform.rotationDeg +
              legacyShortest(
                start.transform.rotationDeg,
                end.transform.rotationDeg,
              ) *
                t,
            scaleX:
              start.transform.scaleX +
              (end.transform.scaleX - start.transform.scaleX) * t,
            scaleY:
              start.transform.scaleY +
              (end.transform.scaleY - start.transform.scaleY) * t,
          });
        }
      }
      return legacyCompose(last.transform);
    };

    const trsTrack: FlaGraphicTransformTrack = {
      trackId: 'addr:Hero/arm',
      keyframes: [
        { timeMs: 0, transform: { tx: 10, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 }, easing: 'linear' },
        { timeMs: 400, transform: { tx: 60, ty: -20, rotationDeg: 170, scaleX: 1.3, scaleY: 0.7 }, easing: 'ease' },
        { timeMs: 1_000, transform: { tx: 110, ty: 40, rotationDeg: -170, scaleX: 0.9, scaleY: 1.1 }, easing: 'linear' },
      ],
    };
    for (const timeMs of [0, 100, 250, 400, 500, 700, 999, 1_000, 1_400, -20]) {
      const current = evaluateFlaGraphicTrackAtTime(trsTrack, timeMs);
      const legacy = legacyEvaluate(trsTrack, timeMs);
      // Byte-identical: same arithmetic, same object shape (no skewXDeg added).
      expect(JSON.stringify(current)).toBe(JSON.stringify(legacy));
    }
  });
});
