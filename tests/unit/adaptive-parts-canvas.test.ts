import { describe, expect, it } from 'vitest';
import { calculateViewportTransform, type LayerVisualPart } from '../../src/domain';
import {
  assemblyMarqueeRect,
  createAdaptivePartAlphaHitMapFromRgba,
  hitTestAdaptivePartsAtPoint,
  selectAdaptivePartsInMarquee,
  viewportClientToAssemblyPoint,
} from '../../src/renderer/features/characters/adaptivePartHitTesting';
import {
  panAssemblyViewportTransform,
  resizeAssemblyViewportTransformPreservingCenter,
  zoomAssemblyViewportTransformAtPoint,
} from '../../src/renderer/features/characters/characterAssemblyPreview';

describe('Adaptive Parts assembly camera and hit testing', () => {
  it('retains the pointer anchor through zoom and camera center through resize', () => {
    const fit = calculateViewportTransform({ width: 640, height: 480 }, 'fit', { width: 1920, height: 1080 });
    const border = { x: 1, y: 1 };
    const viewport = { left: 100, top: 60 };
    const anchor = { x: 193, y: 188 };
    const pointAt = (transform: typeof fit, x: number, y: number) =>
      viewportClientToAssemblyPoint(x + viewport.left + border.x, y + viewport.top + border.y, viewport, border, transform);
    const zoomed = zoomAssemblyViewportTransformAtPoint(fit, anchor, 1.2);
    expect(pointAt(zoomed, anchor.x, anchor.y)?.x).toBeCloseTo(pointAt(fit, anchor.x, anchor.y)!.x);
    expect(pointAt(zoomed, anchor.x, anchor.y)?.y).toBeCloseTo(pointAt(fit, anchor.x, anchor.y)!.y);
    const panned = panAssemblyViewportTransform(zoomed, 90, -15);
    const resized = resizeAssemblyViewportTransformPreservingCenter(panned, { width: 820, height: 620 });
    expect(pointAt(resized, 410, 310)).toEqual(pointAt(panned, 320, 240));
    expect(resized.scale).toBe(1.2);
    expect(zoomAssemblyViewportTransformAtPoint(fit, anchor, 99).scale).toBe(4);
    const distantFit = { ...fit, scale: 0.02 };
    expect(zoomAssemblyViewportTransformAtPoint(distantFit, anchor, 0.016).scale).toBe(0.02);
  });

  it('hits Graphic and image alpha in painter order with an off-center mirrored raster', () => {
    const rear = {
      partId: 'rear', ownerLayerId: 'layer', ownerZIndex: 0,
      slot: 'adaptive-part', source: { kind: 'adaptive-part', characterPartId: 'rear', assetId: 'rear-image' },
      localRect: { x: 0, y: 0, width: 60, height: 60 },
      imageTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      drawOrder: 0, rotationDeg: 0, flipX: false,
    } satisfies LayerVisualPart;
    const front = {
      ...rear, partId: 'front', drawOrder: 1,
      source: { kind: 'adaptive-part-fla-graphic', characterPartId: 'front', animationId: 'graphic' },
      imageTransform: { a: 0, b: -2, c: -2, d: 0, tx: 60, ty: 60 },
    } satisfies LayerVisualPart;
    const rearAlpha = createAdaptivePartAlphaHitMapFromRgba(Uint8ClampedArray.of(0, 0, 0, 255), 1, 1);
    const frontAlpha = createAdaptivePartAlphaHitMapFromRgba(Uint8ClampedArray.of(0, 0, 0, 255, 0, 0, 0, 0), 2, 1);
    const surfaces = new Map([
      ['rear', { rect: rear.localRect, alpha: rearAlpha }],
      ['front', { rect: { x: 4, y: 10, width: 20, height: 10 }, alpha: frontAlpha }],
    ]);
    expect(hitTestAdaptivePartsAtPoint([rear, front], surfaces, { x: 30, y: 42 })).toBe(front);
    expect(hitTestAdaptivePartsAtPoint([rear, front], surfaces, { x: 30, y: 22 })).toBe(rear);
    expect(hitTestAdaptivePartsAtPoint([rear, { ...front, visible: false }], surfaces, { x: 30, y: 42 })).toBe(rear);

    // The Graphic raster contains padding, and its opaque half is rotated and mirrored.
    const tight = new Map([
      ['rear', rear.localRect],
      ['front', { x: 4, y: 10, width: 10, height: 10 }],
    ]);
    const enclosing = assemblyMarqueeRect({ x: 40, y: 52 }, { x: 20, y: 32 });
    expect(selectAdaptivePartsInMarquee([rear, front], tight, enclosing)).toEqual([front]);
    expect(selectAdaptivePartsInMarquee([rear, front], tight, { ...enclosing, width: 19 })).toEqual([]);
    expect(selectAdaptivePartsInMarquee([front], new Map(), enclosing)).toEqual([]);
    expect(selectAdaptivePartsInMarquee([{ ...front, visible: false }], tight, enclosing)).toEqual([]);
  });
});
