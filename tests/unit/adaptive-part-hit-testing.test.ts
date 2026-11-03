import { describe, expect, it, vi } from 'vitest';
import {
  calculateViewportTransform,
  type LayerVisualPart,
} from '../../src/domain';
import {
  calculateAdaptivePartsVisibleBounds,
  panAssemblyViewportTransform,
  resizeAssemblyViewportTransformPreservingCenter,
  zoomAssemblyViewportTransformAtPoint,
} from '../../src/renderer/features/characters/characterAssemblyPreview';
import {
  createAdaptivePartAlphaHitMapFromRgba,
  getOrCreateAdaptivePartAlphaHitMap,
  hitTestAdaptivePartsAtPoint,
  viewportClientToAssemblyPoint,
} from '../../src/renderer/features/characters/adaptivePartHitTesting';

function alphaMap(
  width: number,
  height: number,
  opaque: readonly { x: number; y: number; alpha?: number }[],
) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const pixel of opaque) {
    rgba[(pixel.y * width + pixel.x) * 4 + 3] = pixel.alpha ?? 255;
  }
  return createAdaptivePartAlphaHitMapFromRgba(rgba, width, height);
}

function adaptivePart(
  partId: string,
  assetId: string,
  drawOrder: number,
  imageTransform: NonNullable<LayerVisualPart['imageTransform']>,
  visible = true,
): LayerVisualPart {
  return {
    partId,
    ownerLayerId: 'owner',
    slot: 'adaptive-part',
    source: { kind: 'adaptive-part', characterPartId: partId, assetId },
    assetId,
    localRect: { x: 0, y: 0, width: 4, height: 4 },
    rotationDeg: 0,
    flipX: false,
    imageTransform,
    visible,
    drawOrder,
    ownerZIndex: 0,
  };
}

describe('Adaptive Parts alpha hit testing', () => {
  it('passes through transparent pixels to the foremost visible opaque Part', () => {
    const lower = adaptivePart(
      'lower',
      'asset-lower',
      0,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const upper = adaptivePart(
      'upper',
      'asset-upper',
      1,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const maps = new Map([
      ['asset-lower', alphaMap(4, 4, [{ x: 1, y: 1 }])],
      ['asset-upper', alphaMap(4, 4, [])],
    ]);

    expect(hitTestAdaptivePartsAtPoint([lower, upper], maps, { x: 1.5, y: 1.5 }))
      .toEqual({ kind: 'hit', part: lower });
  });

  it('selects the upper Part when its sampled alpha is visible and skips hidden Parts', () => {
    const lower = adaptivePart(
      'lower',
      'asset-lower',
      0,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const upper = adaptivePart(
      'upper',
      'asset-upper',
      1,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const hidden = adaptivePart(
      'hidden',
      'asset-hidden',
      2,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      false,
    );
    const maps = new Map([
      ['asset-lower', alphaMap(4, 4, [{ x: 1, y: 1 }])],
      ['asset-upper', alphaMap(4, 4, [{ x: 1, y: 1 }])],
      ['asset-hidden', alphaMap(4, 4, [{ x: 1, y: 1 }])],
    ]);

    expect(hitTestAdaptivePartsAtPoint(
      [lower, upper, hidden],
      maps,
      { x: 1.5, y: 1.5 },
    )).toEqual({ kind: 'hit', part: upper });
  });

  it('uses the inverse affine matrix for rotation, flip, and shear', () => {
    const sourcePoint = { x: 1.5, y: 2.5 };
    const matrices = [
      { a: -1, b: 0, c: 0, d: 1, tx: 4, ty: 0 },
      { a: 0, b: 1, c: -1, d: 0, tx: 4, ty: 0 },
      { a: 1, b: 0.25, c: 0.5, d: 1, tx: -1, ty: 2 },
    ];

    for (const [index, matrix] of matrices.entries()) {
      const part = adaptivePart(
        'part-' + index,
        'asset-' + index,
        0,
        matrix,
      );
      const point = {
        x: matrix.a * sourcePoint.x + matrix.c * sourcePoint.y + matrix.tx,
        y: matrix.b * sourcePoint.x + matrix.d * sourcePoint.y + matrix.ty,
      };
      const maps = new Map([
        ['asset-' + index, alphaMap(4, 4, [{ x: 1, y: 2 }])],
      ]);

      expect(hitTestAdaptivePartsAtPoint([part], maps, point))
        .toEqual({ kind: 'hit', part });
    }
  });

  it('returns an actionable list fallback when the top Part alpha cannot be read', () => {
    const lower = adaptivePart(
      'lower',
      'asset-lower',
      0,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const upper = adaptivePart(
      'upper',
      'asset-upper',
      1,
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    );
    const unreadable = {
      mode: 'list-only' as const,
      sourceWidth: 4,
      sourceHeight: 4,
      sampleWidth: 0,
      sampleHeight: 0,
      opaquePixels: null,
      visibleBounds: null,
    };
    const maps = new Map([
      ['asset-lower', alphaMap(4, 4, [{ x: 1, y: 1 }])],
      ['asset-upper', unreadable],
    ]);

    expect(hitTestAdaptivePartsAtPoint([lower, upper], maps, { x: 1.5, y: 1.5 }))
      .toEqual({ kind: 'unavailable', part: upper });
  });

  it('keeps alpha maps by asset and content version without rebuilding on repeated reads', () => {
    const cache = new Map();
    const create = vi.fn(() => alphaMap(2, 2, [{ x: 0, y: 0 }]));
    const first = getOrCreateAdaptivePartAlphaHitMap(
      cache,
      'asset',
      'sha256:first',
      create,
    );

    expect(getOrCreateAdaptivePartAlphaHitMap(
      cache,
      'asset',
      'sha256:first',
      create,
    )).toBe(first);
    expect(getOrCreateAdaptivePartAlphaHitMap(
      cache,
      'asset',
      'sha256:second',
      create,
    )).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps real client coordinates through viewport and camera transforms', () => {
    const transform = calculateViewportTransform(
      { width: 400, height: 300 },
      'fit',
      { width: 100, height: 60 },
    );
    const point = viewportClientToAssemblyPoint(
      100 + 1 + transform.offsetX + (50 + 5) * transform.scale,
      200 + 2 + transform.offsetY + (30 - 4) * transform.scale,
      { left: 100, top: 200 },
      { x: 1, y: 2 },
      transform,
    );

    expect(point?.x).toBeCloseTo(5);
    expect(point?.y).toBeCloseTo(-4);
  });

  it('zooms around the pointer and clamps manual zoom to 10% through 400%', () => {
    const initial = calculateViewportTransform(
      { width: 500, height: 300 },
      'fit',
      { width: 1000, height: 600 },
    );
    const point = { x: 145, y: 72 };
    const logicalBefore = {
      x: (point.x - initial.offsetX) / initial.scale,
      y: (point.y - initial.offsetY) / initial.scale,
    };
    const zoomed = zoomAssemblyViewportTransformAtPoint(
      initial,
      point,
      initial.scale * 2,
    );
    const logicalAfter = {
      x: (point.x - zoomed.offsetX) / zoomed.scale,
      y: (point.y - zoomed.offsetY) / zoomed.scale,
    };

    expect(logicalAfter.x).toBeCloseTo(logicalBefore.x);
    expect(logicalAfter.y).toBeCloseTo(logicalBefore.y);
    expect(zoomAssemblyViewportTransformAtPoint(initial, point, 0.01).scale)
      .toBe(0.1);
    expect(zoomAssemblyViewportTransformAtPoint(initial, point, 10).scale)
      .toBe(4);
  });

  it('pans the camera and preserves its logical center when the viewport resizes', () => {
    const initial = calculateViewportTransform(
      { width: 500, height: 300 },
      'fit',
      { width: 1000, height: 600 },
    );
    const panned = panAssemblyViewportTransform(initial, -75, 35);
    expect(panned.offsetX).toBe(initial.offsetX - 75);
    expect(panned.offsetY).toBe(initial.offsetY + 35);

    const beforeCenter = {
      x: (panned.container.width / 2 - panned.offsetX) / panned.scale,
      y: (panned.container.height / 2 - panned.offsetY) / panned.scale,
    };
    const resized = resizeAssemblyViewportTransformPreservingCenter(
      panned,
      { width: 800, height: 500 },
    );
    const afterCenter = {
      x: (resized.container.width / 2 - resized.offsetX) / resized.scale,
      y: (resized.container.height / 2 - resized.offsetY) / resized.scale,
    };

    expect(afterCenter.x).toBeCloseTo(beforeCenter.x);
    expect(afterCenter.y).toBeCloseTo(beforeCenter.y);
  });

  it('fits visible Part bounds and excludes hidden Parts', () => {
    const visible = adaptivePart(
      'visible',
      'asset-visible',
      0,
      { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 200 },
    );
    const hidden = adaptivePart(
      'hidden',
      'asset-hidden',
      1,
      { a: 1, b: 0, c: 0, d: 1, tx: 900, ty: 900 },
      false,
    );
    const transparent = adaptivePart(
      'transparent',
      'asset-transparent',
      2,
      { a: 1, b: 0, c: 0, d: 1, tx: 1_900, ty: 1_900 },
    );

    expect(calculateAdaptivePartsVisibleBounds(
      [visible, hidden, transparent],
      new Map([
        ['asset-visible', { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }],
        ['asset-hidden', { x: 0, y: 0, width: 1, height: 1 }],
        ['asset-transparent', null],
      ]),
      new Set(['asset-transparent']),
    )).toEqual({ x: 101, y: 201, width: 2, height: 2 });
  });
});
