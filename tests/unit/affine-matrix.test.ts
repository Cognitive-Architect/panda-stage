import { describe, expect, it } from 'vitest';
import {
  localizeAbsoluteLeafMatrix,
  multiplyAffineMatrices,
} from '../../src/shared/affine-matrix';

describe('shared affine matrix localization', () => {
  it('uses parent inverse times the dragged absolute leaf matrix under rotation, scale, and translation', () => {
    const parent = { a: 0, b: 2, c: -2, d: 0, tx: 20, ty: 10 };
    const childLocal = { a: 1, b: 0.25, c: 0, d: 1, tx: 2, ty: 3 };
    const draggedLocal = { ...childLocal, tx: 9, ty: -4 };
    const originalAbsolute = multiplyAffineMatrices(parent, childLocal);
    const draggedAbsolute = multiplyAffineMatrices(parent, draggedLocal);

    const localized = localizeAbsoluteLeafMatrix(parent, draggedAbsolute);

    expect(localizeAbsoluteLeafMatrix(parent, originalAbsolute)).toEqual({ ok: true, value: childLocal });
    expect(localized).toEqual({ ok: true, value: draggedLocal });
  });

  it('fails closed for a singular Group transform', () => {
    expect(localizeAbsoluteLeafMatrix(
      { a: 0, b: 0, c: 0, d: 0, tx: 5, ty: 6 },
      { a: 1, b: 0, c: 0, d: 1, tx: 8, ty: 9 },
    )).toEqual({
      ok: false,
      message: 'Cannot localize an absolute XFL child matrix under a singular parent group',
    });
  });
});
