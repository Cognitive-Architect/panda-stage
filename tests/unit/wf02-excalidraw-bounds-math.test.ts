import { describe, expect, it } from 'vitest';
import {
  boundsFromRect,
  computeAlignTranslation,
  computeDistributeTranslations,
  transformRectToWorldBounds,
  translateLayoutBounds,
  unionLayoutBounds,
} from '../../src/domain';
import { composeAffineMatrix } from '../../src/domain/models/flaGraphicTimeline';

describe('WF-02 Excalidraw-derived bounds align & distribute math', () => {
  it('computes 6-way alignment translations against a reference rectangle', () => {
    const ref = boundsFromRect({ x: 100, y: 200, width: 400, height: 300 });
    const item = boundsFromRect({ x: 250, y: 280, width: 100, height: 60 });

    expect(computeAlignTranslation(item, ref, 'x', 'start')).toEqual({ dx: -150, dy: 0 });
    expect(computeAlignTranslation(item, ref, 'x', 'center')).toEqual({ dx: 0, dy: 0 });
    expect(computeAlignTranslation(item, ref, 'x', 'end')).toEqual({ dx: 150, dy: 0 });

    expect(computeAlignTranslation(item, ref, 'y', 'start')).toEqual({ dx: 0, dy: -80 });
    expect(computeAlignTranslation(item, ref, 'y', 'center')).toEqual({ dx: 0, dy: 40 });
    expect(computeAlignTranslation(item, ref, 'y', 'end')).toEqual({ dx: 0, dy: 160 });
  });

  it('distributes items with equal positive gaps along X and Y', () => {
    const itemsX = [
      { id: 'a', bounds: boundsFromRect({ x: 0, y: 0, width: 100, height: 50 }) },
      { id: 'b', bounds: boundsFromRect({ x: 120, y: 0, width: 80, height: 50 }) },
      { id: 'c', bounds: boundsFromRect({ x: 500, y: 0, width: 100, height: 50 }) },
    ];
    const resultX = computeDistributeTranslations(itemsX, 'x');
    expect(resultX.ok).toBe(true);
    expect(resultX.negativeGapDetected).toBe(false);
    expect(resultX.rawGap).toBeCloseTo(160, 6);

    const nextA = translateLayoutBounds(itemsX[0]!.bounds, resultX.translations.get('a')!.dx, 0);
    const nextB = translateLayoutBounds(itemsX[1]!.bounds, resultX.translations.get('b')!.dx, 0);
    const nextC = translateLayoutBounds(itemsX[2]!.bounds, resultX.translations.get('c')!.dx, 0);
    expect(nextA.minX).toBeCloseTo(0, 6);
    expect(nextB.minX - nextA.maxX).toBeCloseTo(160, 6);
    expect(nextC.minX - nextB.maxX).toBeCloseTo(160, 6);
    expect(nextC.maxX).toBeCloseTo(600, 6);

    const itemsY = [
      { id: 'top', bounds: boundsFromRect({ x: 0, y: 100, width: 40, height: 60 }) },
      { id: 'mid', bounds: boundsFromRect({ x: 0, y: 180, width: 40, height: 40 }) },
      { id: 'bot', bounds: boundsFromRect({ x: 0, y: 400, width: 40, height: 100 }) },
    ];
    const resultY = computeDistributeTranslations(itemsY, 'y');
    expect(resultY.ok).toBe(true);
    expect(resultY.rawGap).toBeCloseTo(100, 6);
    const midY = translateLayoutBounds(itemsY[1]!.bounds, 0, resultY.translations.get('mid')!.dy);
    expect(midY.minY).toBeCloseTo(260, 6);
  });

  it('handles negative gap explicitly with center-distribute, expand, or error', () => {
    // Total span = 220, sum of widths = 100 + 100 + 100 = 300 -> rawGap = -40
    const crowded = [
      { id: 'a', bounds: boundsFromRect({ x: 0, y: 0, width: 100, height: 50 }) },
      { id: 'b', bounds: boundsFromRect({ x: 30, y: 0, width: 100, height: 50 }) },
      { id: 'c', bounds: boundsFromRect({ x: 120, y: 0, width: 100, height: 50 }) },
    ];

    const centerDist = computeDistributeTranslations(crowded, 'x', {
      negativeGapStrategy: 'center-distribute',
    });
    expect(centerDist.ok).toBe(true);
    expect(centerDist.negativeGapDetected).toBe(true);
    expect(centerDist.usedStrategy).toBe('center-distribute');
    // Centers were 50, 80, 170 -> distributed centers should be 50, 110, 170
    const nextB = translateLayoutBounds(crowded[1]!.bounds, centerDist.translations.get('b')!.dx, 0);
    expect(nextB.centerX).toBeCloseTo(110, 6);

    const expanded = computeDistributeTranslations(crowded, 'x', {
      negativeGapStrategy: 'expand',
      expandGapPx: 10,
    });
    expect(expanded.ok).toBe(true);
    expect(expanded.usedStrategy).toBe('expand');
    const expA = translateLayoutBounds(crowded[0]!.bounds, expanded.translations.get('a')!.dx, 0);
    const expB = translateLayoutBounds(crowded[1]!.bounds, expanded.translations.get('b')!.dx, 0);
    const expC = translateLayoutBounds(crowded[2]!.bounds, expanded.translations.get('c')!.dx, 0);
    expect(expA.minX).toBeCloseTo(0, 6);
    expect(expB.minX).toBeCloseTo(110, 6);
    expect(expC.minX).toBeCloseTo(220, 6);

    const errored = computeDistributeTranslations(crowded, 'x', {
      negativeGapStrategy: 'error',
    });
    expect(errored.ok).toBe(false);
    expect(errored.negativeGapDetected).toBe(true);
    expect(errored.error).toBeTruthy();
  });

  it('detects degenerate span when one item spans both outer edges', () => {
    const items = [
      { id: 'wide', bounds: boundsFromRect({ x: 0, y: 0, width: 500, height: 50 }) },
      { id: 'left', bounds: boundsFromRect({ x: 50, y: 0, width: 40, height: 50 }) },
      { id: 'right', bounds: boundsFromRect({ x: 400, y: 0, width: 40, height: 50 }) },
    ];
    const result = computeDistributeTranslations(items, 'x', {
      negativeGapStrategy: 'center-distribute',
    });
    expect(result.ok).toBe(true);
    expect(result.degenerateSpan).toBe(true);
    expect(result.negativeGapDetected).toBe(true);
    expect(result.usedStrategy).toBe('center-distribute');
  });

  it('transforms rotated and mirrored local rectangles into exact world AABBs', () => {
    const rect = { x: -50, y: -25, width: 100, height: 50 };
    const rotated90 = composeAffineMatrix({
      tx: 500,
      ty: 300,
      rotationDeg: 90,
      scaleX: -2,
      scaleY: 1,
    });
    const bounds = transformRectToWorldBounds(rect, rotated90)!;
    // 100 * 2 = 200 becomes vertical height; 50 * 1 = 50 becomes horizontal width
    expect(bounds.width).toBeCloseTo(50, 6);
    expect(bounds.height).toBeCloseTo(200, 6);
    expect(bounds.centerX).toBeCloseTo(500, 6);
    expect(bounds.centerY).toBeCloseTo(300, 6);

    const combined = unionLayoutBounds([
      bounds,
      boundsFromRect({ x: 600, y: 100, width: 40, height: 40 }),
    ])!;
    expect(combined.minX).toBeCloseTo(475, 6);
    expect(combined.maxX).toBeCloseTo(640, 6);
    expect(combined.minY).toBeCloseTo(100, 6);
    expect(combined.maxY).toBeCloseTo(400, 6);
  });
});
