import {
  interpolateFlaViewerClassicTweenMatrix,
  type FlaViewerTweenRotation,
} from './fla-viewer-tween-evaluator';
import type { FlaDisplayListMatrix } from './fla-display-list-resolver';

export type FlaMotionTweenTransformInterpolationFailureCode =
  | 'INVALID_PROGRESS'
  | 'INVALID_MATRIX'
  | 'INVALID_ROTATION';

export interface FlaMotionTweenRotation {
  readonly direction: 'clockwise' | 'counter-clockwise';
  readonly turns: number;
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
