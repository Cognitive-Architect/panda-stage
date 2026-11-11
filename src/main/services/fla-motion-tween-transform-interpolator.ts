import {
  interpolateFlaViewerClassicTweenMatrix,
  type FlaViewerTweenRotation,
} from './fla-viewer-tween-evaluator';
import type { FlaDisplayListMatrix } from './fla-display-list-resolver';

export type FlaMotionTweenTransformInterpolationFailureCode =
  | 'INVALID_PROGRESS'
  | 'INVALID_MATRIX'
  | 'INVALID_ROTATION'
  | 'INVALID_PIVOT';

export interface FlaMotionTweenRotation {
  readonly direction: 'clockwise' | 'counter-clockwise';
  readonly turns: number;
}

export interface FlaMotionTransformPivot {
  readonly x: number;
  readonly y: number;
}

export type FlaMotionTweenTransformInterpolationResult =
  | { readonly ok: true; readonly matrix: FlaDisplayListMatrix }
  | {
      readonly ok: false;
      readonly code: FlaMotionTweenTransformInterpolationFailureCode;
      readonly message: string;
    };

/** Compatibility entry point for the adapted Classic Motion matrix evaluator. */
export function interpolateFlaLinearMotionTransform(
  start: FlaDisplayListMatrix,
  end: FlaDisplayListMatrix,
  progress: number,
  rotation?: FlaMotionTweenRotation,
): FlaMotionTweenTransformInterpolationResult {
  const adaptedRotation: FlaViewerTweenRotation | undefined = rotation;
  const result = interpolateFlaViewerClassicTweenMatrix(start, end, progress, adaptedRotation);
  return result.ok ? result : { ok: false, code: result.code, message: result.message };
}

/**
 * Interpolate an Animate Graphic instance while keeping its authored pivot on
 * the straight world-space path between the two keyframes.
 */
export function interpolateFlaClassicMotionInstanceTransform(
  start: FlaDisplayListMatrix,
  end: FlaDisplayListMatrix,
  progress: number,
  rotation?: FlaMotionTweenRotation,
  startPivot: FlaMotionTransformPivot = { x: 0, y: 0 },
  endPivot: FlaMotionTransformPivot = { x: 0, y: 0 },
): FlaMotionTweenTransformInterpolationResult {
  if (![startPivot.x, startPivot.y, endPivot.x, endPivot.y].every(Number.isFinite)) {
    return {
      ok: false,
      code: 'INVALID_PIVOT',
      message: 'Classic Motion endpoint pivots must be finite',
    };
  }

  const interpolated = interpolateFlaLinearMotionTransform(start, end, progress, rotation);
  if (!interpolated.ok || progress === 0 || progress === 1) return interpolated;

  const interpolatePoint = (
    from: FlaMotionTransformPivot,
    to: FlaMotionTransformPivot,
  ): FlaMotionTransformPivot => ({
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  });
  const transformPoint = (
    matrix: FlaDisplayListMatrix,
    point: FlaMotionTransformPivot,
  ): FlaMotionTransformPivot => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  });

  const startWorldPivot = transformPoint(start, startPivot);
  const endWorldPivot = transformPoint(end, endPivot);
  const targetWorldPivot = interpolatePoint(startWorldPivot, endWorldPivot);
  const interpolatedPivot = interpolatePoint(startPivot, endPivot);
  const currentLinearPivot = {
    x: interpolated.matrix.a * interpolatedPivot.x +
      interpolated.matrix.c * interpolatedPivot.y,
    y: interpolated.matrix.b * interpolatedPivot.x +
      interpolated.matrix.d * interpolatedPivot.y,
  };
  const matrix = {
    ...interpolated.matrix,
    tx: targetWorldPivot.x - currentLinearPivot.x,
    ty: targetWorldPivot.y - currentLinearPivot.y,
  };
  if (![matrix.tx, matrix.ty].every(Number.isFinite)) {
    return {
      ok: false,
      code: 'INVALID_PIVOT',
      message: 'Classic Motion pivot interpolation produced a non-finite translation',
    };
  }
  return { ok: true, matrix };
}
