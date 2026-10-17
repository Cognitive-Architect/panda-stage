import type { FlaDisplayListMatrix } from './fla-display-list-resolver';

const ORTHOGONAL_TOLERANCE = 1e-8;
const ROTATION_AMBIGUITY_TOLERANCE = 1e-10;
const TWO_PI = Math.PI * 2;

export type FlaMotionTweenTransformInterpolationFailureCode =
  | 'INVALID_PROGRESS'
  | 'INVALID_MATRIX'
  | 'UNSUPPORTED_REFLECTION'
  | 'UNSUPPORTED_SKEW'
  | 'AMBIGUOUS_ROTATION';

export type FlaMotionTweenTransformInterpolationResult =
  | { readonly ok: true; readonly matrix: FlaDisplayListMatrix }
  | {
      readonly ok: false;
      readonly code: FlaMotionTweenTransformInterpolationFailureCode;
      readonly message: string;
    };

interface DecomposedTransform {
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

function isFiniteMatrix(matrix: FlaDisplayListMatrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .every(Number.isFinite);
}

function failure(
  code: FlaMotionTweenTransformInterpolationFailureCode,
  message: string,
): FlaMotionTweenTransformInterpolationResult {
  return { ok: false, code, message };
}

function decomposePositiveOrthogonalMatrix(
  matrix: FlaDisplayListMatrix,
  endpoint: 'start' | 'end',
): DecomposedTransform | FlaMotionTweenTransformInterpolationResult {
  if (!isFiniteMatrix(matrix)) {
    return failure('INVALID_MATRIX', `Motion tween ${endpoint} matrix contains non-finite values`);
  }

  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || determinant <= 0 || scaleX <= 0 || scaleY <= 0) {
    return failure(
      'UNSUPPORTED_REFLECTION',
      `Motion tween ${endpoint} matrix must have positive scale and no reflection`,
    );
  }

  const normalizedColumnDot = (matrix.a * matrix.c + matrix.b * matrix.d) / (scaleX * scaleY);
  if (!Number.isFinite(normalizedColumnDot) || Math.abs(normalizedColumnDot) > ORTHOGONAL_TOLERANCE) {
    return failure(
      'UNSUPPORTED_SKEW',
      `Motion tween ${endpoint} matrix contains skew outside the bounded transform subset`,
    );
  }

  return {
    rotation: Math.atan2(matrix.b, matrix.a),
    scaleX,
    scaleY,
  };
}

/**
 * Interpolate a default, un-eased 2D transform using source-keyed properties.
 * The caller must first prove that the span has no custom ease/path metadata.
 * Matrix coefficients are not interpolated directly, which would distort
 * rotations. Reflection, skew, invalid progress, and a half-turn with no
 * source rotation direction fail closed.
 */
export function interpolateFlaLinearMotionTransform(
  start: FlaDisplayListMatrix,
  end: FlaDisplayListMatrix,
  progress: number,
): FlaMotionTweenTransformInterpolationResult {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return failure('INVALID_PROGRESS', 'Motion tween progress must be between 0 and 1');
  }
  const from = decomposePositiveOrthogonalMatrix(start, 'start');
  if ('ok' in from) return from;
  const to = decomposePositiveOrthogonalMatrix(end, 'end');
  if ('ok' in to) return to;
  if (progress === 0) return { ok: true, matrix: { ...start } };
  if (progress === 1) return { ok: true, matrix: { ...end } };

  let rotationDelta = (to.rotation - from.rotation) % TWO_PI;
  if (rotationDelta > Math.PI) rotationDelta -= TWO_PI;
  if (rotationDelta < -Math.PI) rotationDelta += TWO_PI;
  if (Math.abs(Math.abs(rotationDelta) - Math.PI) <= ROTATION_AMBIGUITY_TOLERANCE) {
    return failure(
      'AMBIGUOUS_ROTATION',
      'Motion tween endpoints are half a turn apart without source rotation-direction metadata',
    );
  }

  const rotation = from.rotation + rotationDelta * progress;
  const scaleX = from.scaleX + (to.scaleX - from.scaleX) * progress;
  const scaleY = from.scaleY + (to.scaleY - from.scaleY) * progress;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);

  return {
    ok: true,
    matrix: {
      a: cosine * scaleX,
      b: sine * scaleX,
      c: -sine * scaleY,
      d: cosine * scaleY,
      tx: start.tx + (end.tx - start.tx) * progress,
      ty: start.ty + (end.ty - start.ty) * progress,
    },
  };
}
