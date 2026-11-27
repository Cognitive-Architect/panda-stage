import { evaluateAnimationEase } from '../evaluate-animation-core';
import type { Point } from './viewportTransform';

export interface CubicBezier2D {
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
}

export type CurveMotionSpeedMode = 'constant' | 'ease-in-out';

export const MIN_CURVE_ARC_LENGTH = 1e-6;

// 5-point Gauss-Legendre quadrature nodes and weights on [-1, 1].
const GL5_NODES: readonly number[] = [
  -0.906179845938664,
  -0.5384693101056831,
  0,
  0.5384693101056831,
  0.906179845938664,
];
const GL5_WEIGHTS: readonly number[] = [
  0.23692688505618908,
  0.47862867049936647,
  0.5688888888888889,
  0.47862867049936647,
  0.23692688505618908,
];

const ARC_TABLE_SEGMENTS = 256;

export function evaluateCubicBezier2D(curve: CubicBezier2D, t: number): Point {
  if (t <= 0) return { x: curve.p0.x, y: curve.p0.y };
  if (t >= 1) return { x: curve.p3.x, y: curve.p3.y };
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
  };
}

export function evaluateCubicBezierDerivative2D(
  curve: CubicBezier2D,
  t: number,
): Point {
  const clamped = Math.min(1, Math.max(0, t));
  const mt = 1 - clamped;
  const a = 3 * mt * mt;
  const b = 6 * mt * clamped;
  const c = 3 * clamped * clamped;
  return {
    x:
      a * (curve.p1.x - curve.p0.x) +
      b * (curve.p2.x - curve.p1.x) +
      c * (curve.p3.x - curve.p2.x),
    y:
      a * (curve.p1.y - curve.p0.y) +
      b * (curve.p2.y - curve.p1.y) +
      c * (curve.p3.y - curve.p2.y),
  };
}

function cubicBezierSpeed(curve: CubicBezier2D, t: number): number {
  const d = evaluateCubicBezierDerivative2D(curve, t);
  return Math.hypot(d.x, d.y);
}

/** 5-point Gauss-Legendre arc-length integral over [t0, t1]. */
export function cubicBezierSegmentArcLength(
  curve: CubicBezier2D,
  t0: number,
  t1: number,
): number {
  if (t1 <= t0) return 0;
  const half = (t1 - t0) / 2;
  const mid = (t0 + t1) / 2;
  let sum = 0;
  for (let i = 0; i < GL5_NODES.length; i += 1) {
    sum += GL5_WEIGHTS[i]! * cubicBezierSpeed(curve, mid + half * GL5_NODES[i]!);
  }
  return half * sum;
}

export interface CubicBezierArcLengthTable {
  readonly curve: CubicBezier2D;
  readonly totalLength: number;
  readonly cumulativeLengths: readonly number[];
}

export function buildCubicBezierArcLengthTable(
  curve: CubicBezier2D,
  segments: number = ARC_TABLE_SEGMENTS,
): CubicBezierArcLengthTable {
  const count = Math.max(16, Math.round(segments));
  const cumulativeLengths = new Array<number>(count + 1);
  cumulativeLengths[0] = 0;
  let total = 0;
  for (let i = 1; i <= count; i += 1) {
    const t0 = (i - 1) / count;
    const t1 = i / count;
    total += cubicBezierSegmentArcLength(curve, t0, t1);
    cumulativeLengths[i] = total;
  }
  return {
    curve,
    totalLength: total,
    cumulativeLengths,
  };
}

/** Invert normalized arc-length fraction in [0, 1] to Bézier parameter t in [0, 1]. */
export function solveCubicBezierParameterAtArcFraction(
  table: CubicBezierArcLengthTable,
  arcFraction: number,
): number {
  if (arcFraction <= 0) return 0;
  if (arcFraction >= 1) return 1;
  const { curve, totalLength, cumulativeLengths } = table;
  if (totalLength <= MIN_CURVE_ARC_LENGTH) return 0;

  const targetLength = arcFraction * totalLength;
  const segments = cumulativeLengths.length - 1;
  let lo = 0;
  let hi = segments;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulativeLengths[mid]! < targetLength) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const baseLength = cumulativeLengths[lo]!;
  const segLength = cumulativeLengths[hi]! - baseLength;
  const tLo = lo / segments;
  const tHi = hi / segments;
  if (segLength <= 0) return tLo;

  const localTarget = targetLength - baseLength;
  let low = tLo;
  let high = tHi;
  let t = tLo + (localTarget / segLength) * (tHi - tLo);

  for (let iter = 0; iter < 8; iter += 1) {
    const length = cubicBezierSegmentArcLength(curve, tLo, t);
    const error = length - localTarget;
    if (Math.abs(error) <= 1e-9 * Math.max(1, totalLength)) {
      return t;
    }
    if (error < 0) {
      low = t;
    } else {
      high = t;
    }
    const speed = cubicBezierSpeed(curve, t);
    const candidate = speed > 1e-9 ? t - error / speed : Number.NaN;
    if (Number.isFinite(candidate) && candidate > low && candidate < high) {
      t = candidate;
    } else {
      t = (low + high) / 2;
    }
  }
  return t;
}

export function sampleCubicBezierAtArcFraction(
  table: CubicBezierArcLengthTable,
  arcFraction: number,
): Point {
  const t = solveCubicBezierParameterAtArcFraction(table, arcFraction);
  return evaluateCubicBezier2D(table.curve, t);
}

/** Sample `stepCount + 1` points (inclusive of P0 and P3) along `curve` under `speedMode`. */
export function sampleCubicBezierBySteps(
  curve: CubicBezier2D,
  stepCount: number,
  speedMode: CurveMotionSpeedMode,
): { readonly totalLength: number; readonly points: readonly Point[] } {
  const table = buildCubicBezierArcLengthTable(curve);
  const steps = Math.max(1, Math.round(stepCount));
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const linearProgress = step / steps;
    const arcFraction =
      speedMode === 'ease-in-out'
        ? evaluateAnimationEase(linearProgress, 'ease-in-out')
        : linearProgress;
    points.push(sampleCubicBezierAtArcFraction(table, arcFraction));
  }
  return {
    totalLength: table.totalLength,
    points,
  };
}
