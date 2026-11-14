/** A finite 2D affine matrix in the same layout used by XFL and Konva. */
export interface AffineMatrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface AffineMatrixScale {
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Returns the absolute local axis scales using the same matrix decomposition as Konva. */
export function getAffineMatrixScale(
  matrix: AffineMatrix2D,
): AffineMatrixScale {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY = scaleX > 1e-12
    ? determinant / scaleX
    : Math.hypot(matrix.c, matrix.d);
  return { scaleX: Math.abs(scaleX), scaleY: Math.abs(scaleY) };
}

export type AffineMatrixResult =
  | { readonly ok: true; readonly value: AffineMatrix2D }
  | { readonly ok: false; readonly message: string };

export function multiplyAffineMatrices(
  parent: AffineMatrix2D,
  local: AffineMatrix2D,
): AffineMatrix2D {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

export function invertAffineMatrix(
  matrix: AffineMatrix2D,
): AffineMatrix2D | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  const inverse = {
    a,
    b,
    c,
    d,
    tx: -(a * matrix.tx + c * matrix.ty),
    ty: -(b * matrix.tx + d * matrix.ty),
  };
  return [inverse.a, inverse.b, inverse.c, inverse.d, inverse.tx, inverse.ty]
    .every(Number.isFinite)
    ? inverse
    : null;
}

/** Convert an absolute leaf transform to the requested parent's local space. */
export function localizeAbsoluteLeafMatrix(
  parentWorld: AffineMatrix2D,
  sourceAbsolute: AffineMatrix2D,
): AffineMatrixResult {
  const parentInverse = invertAffineMatrix(parentWorld);
  if (!parentInverse) {
    return {
      ok: false,
      message: 'Cannot localize an absolute XFL child matrix under a singular parent group',
    };
  }
  const value = multiplyAffineMatrices(parentInverse, sourceAbsolute);
  if (![value.a, value.b, value.c, value.d, value.tx, value.ty].every(Number.isFinite)) {
    return { ok: false, message: 'Localized XFL child matrix is not finite' };
  }
  return { ok: true, value };
}
