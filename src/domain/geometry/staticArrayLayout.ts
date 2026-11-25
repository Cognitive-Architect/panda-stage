import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import {
  buildCubicBezierArcLengthTable,
  evaluateCubicBezier2D,
  evaluateCubicBezierDerivative2D,
  MIN_CURVE_ARC_LENGTH,
  sampleCubicBezierAtArcFraction,
  solveCubicBezierParameterAtArcFraction,
  type CubicBezier2D,
  type CubicBezierArcLengthTable,
} from './cubicBezierPath';
import { normalizeAngleDeg360, normalizeNegativeZero } from './radialBurst';
import type { Point } from './viewportTransform';

export const STATIC_ARRAY_MIN_COUNT = 2;
export const STATIC_ARRAY_MAX_COUNT = 100;
export const STATIC_ARRAY_DEFAULT_COUNT = 8;
export const RADIAL_ARRAY_DEFAULT_RADIUS = 240;
export const RADIAL_ARRAY_DEFAULT_START_ANGLE_DEG = 0;

// Normalize only numerical spill from generated geometry, never raw inputs.
export function normalizeGeneratedStagePoint(point: Point): Point | null {
  const epsilon = 1e-9;
  const { x, y } = point;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < -epsilon ||
    x > PROJECT_WIDTH + epsilon ||
    y < -epsilon ||
    y > PROJECT_HEIGHT + epsilon
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(PROJECT_WIDTH, x)),
    y: Math.max(0, Math.min(PROJECT_HEIGHT, y)),
  };
}

export type StaticArrayOrientationMode = 'keep' | 'align';

export interface RadialArrayLayoutParams {
  readonly count: number;
  readonly center: Point;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly orientation: StaticArrayOrientationMode;
}

export interface PathArrayLayoutParams {
  readonly count: number;
  readonly curve: CubicBezier2D;
  readonly orientation: StaticArrayOrientationMode;
}

export interface StaticArrayLayoutSample {
  readonly index: number;
  readonly position: Point;
  /** Outward radial or forward path tangent angle in degrees (stage X-right, Y-down, clockwise positive). */
  readonly directionAngleDeg: number | null;
}

export type PathArrayLayoutResult =
  | {
      readonly ok: true;
      readonly samples: readonly StaticArrayLayoutSample[];
      readonly totalLength: number;
      readonly isClosed: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: 'degenerate-path' | 'degenerate-tangent';
      readonly index?: number;
    };

const DERIVATIVE_EPSILON = 1e-6;
const SECANT_EPSILON = 1e-9;
const CLOSED_ENDPOINT_EPSILON = 1e-6;
const SECANT_DELTAS: readonly number[] = [1e-4, 1e-3, 1e-2, 5e-2];

function angleFromVector(dx: number, dy: number, minLen: number): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) <= minLen) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Number.isFinite(deg) ? normalizeNegativeZero(deg) : null;
}

function resolvePathTangentAngleDeg(
  table: CubicBezierArcLengthTable,
  t: number,
  arcFraction: number,
  position: Point,
): number | null {
  const deriv = evaluateCubicBezierDerivative2D(table.curve, t);
  const direct = angleFromVector(deriv.x, deriv.y, DERIVATIVE_EPSILON);
  if (direct !== null) return direct;

  for (const delta of SECANT_DELTAS) {
    if (arcFraction >= 1 - 1e-12) {
      const prev = sampleCubicBezierAtArcFraction(table, Math.max(0, 1 - delta));
      const incoming = angleFromVector(
        position.x - prev.x,
        position.y - prev.y,
        SECANT_EPSILON,
      );
      if (incoming !== null) return incoming;
      continue;
    }
    if (arcFraction <= 1e-12) {
      const next = sampleCubicBezierAtArcFraction(table, Math.min(1, delta));
      const outgoing = angleFromVector(
        next.x - position.x,
        next.y - position.y,
        SECANT_EPSILON,
      );
      if (outgoing !== null) return outgoing;
      continue;
    }
    const prev = sampleCubicBezierAtArcFraction(table, Math.max(0, arcFraction - delta));
    const next = sampleCubicBezierAtArcFraction(table, Math.min(1, arcFraction + delta));
    const centered = angleFromVector(next.x - prev.x, next.y - prev.y, SECANT_EPSILON);
    if (centered !== null) return centered;
    const forward = angleFromVector(
      next.x - position.x,
      next.y - position.y,
      SECANT_EPSILON,
    );
    if (forward !== null) return forward;
    const backward = angleFromVector(
      position.x - prev.x,
      position.y - prev.y,
      SECANT_EPSILON,
    );
    if (backward !== null) return backward;
  }
  return null;
}

/**
 * Sample N static radial array positions evenly around a full circle (no duplicate 360° point).
 * Normalizes `startAngleDeg` before adding angular steps to prevent extreme-angle overflow.
 */
export function sampleRadialArrayLayout(
  params: RadialArrayLayoutParams,
): StaticArrayLayoutSample[] {
  const baseStartAngleDeg = normalizeAngleDeg360(params.startAngleDeg);
  const samples: StaticArrayLayoutSample[] = [];
  for (let index = 0; index < params.count; index += 1) {
    const angleDeg = normalizeNegativeZero(
      baseStartAngleDeg + (360 * index) / params.count,
    );
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = normalizeNegativeZero(params.center.x + Math.cos(angleRad) * params.radius);
    const y = normalizeNegativeZero(params.center.y + Math.sin(angleRad) * params.radius);
    samples.push({
      index,
      position: { x, y },
      directionAngleDeg:
        params.orientation === 'align' ? normalizeAngleDeg360(angleDeg) : null,
    });
  }
  return samples;
}

/**
 * Sample N static positions evenly by arc length along a single cubic Bézier segment.
 * Open paths sample i / (N - 1) (inclusive of P0 and P3); closed non-degenerate paths
 * (P0 == P3) sample i / N to avoid overlapping endpoints.
 */
export function samplePathArrayLayout(
  params: PathArrayLayoutParams,
): PathArrayLayoutResult {
  const table = buildCubicBezierArcLengthTable(params.curve);
  if (!Number.isFinite(table.totalLength) || table.totalLength <= MIN_CURVE_ARC_LENGTH) {
    return { ok: false, reason: 'degenerate-path' };
  }
  const isClosed =
    Math.hypot(
      params.curve.p3.x - params.curve.p0.x,
      params.curve.p3.y - params.curve.p0.y,
    ) <= CLOSED_ENDPOINT_EPSILON;
  const samples: StaticArrayLayoutSample[] = [];
  for (let index = 0; index < params.count; index += 1) {
    const arcFraction = isClosed ? index / params.count : index / (params.count - 1);
    const t = solveCubicBezierParameterAtArcFraction(table, arcFraction);
    const rawPos = evaluateCubicBezier2D(params.curve, t);
    const position: Point = {
      x: normalizeNegativeZero(rawPos.x),
      y: normalizeNegativeZero(rawPos.y),
    };
    let directionAngleDeg: number | null = null;
    if (params.orientation === 'align') {
      directionAngleDeg = resolvePathTangentAngleDeg(table, t, arcFraction, position);
      if (directionAngleDeg === null) {
        return { ok: false, reason: 'degenerate-tangent', index };
      }
    }
    samples.push({
      index,
      position,
      directionAngleDeg,
    });
  }
  return {
    ok: true,
    samples,
    totalLength: table.totalLength,
    isClosed,
  };
}
