import { describe, expect, it, vi } from 'vitest';
import { synchronizeEditorLayerAuthority } from '../../src/renderer/features/canvas/CanvasStage';

interface Point {
  x: number;
  y: number;
}

describe('editor Konva hit authority', () => {
  it('publishes the mounted top layer to real hit resolution before selection', () => {
    const point: Point = { x: 900, y: 500 };
    const backgroundId = 'background';
    const topLayerId = 'locked-sticker';
    let visibleTopId = backgroundId;
    let hitTopId = backgroundId;
    const mountedTopId = topLayerId;
    const selected = vi.fn();

    const layer = {
      draw: () => {
        visibleTopId = mountedTopId;
        hitTopId = mountedTopId;
        return layer;
      },
      getIntersection: (targetPoint: Point) =>
        targetPoint === point ? hitTopId : backgroundId,
    };

    // This is the first divergence from #189: the complete layer tree exists,
    // but the previous hit target remains authoritative until publication.
    expect(layer.getIntersection(point)).toBe(backgroundId);

    synchronizeEditorLayerAuthority(layer);

    expect(visibleTopId).toBe(topLayerId);
    expect(layer.getIntersection(point)).toBe(topLayerId);
    selected(layer.getIntersection(point));
    expect(selected).toHaveBeenCalledWith(topLayerId);
  });
});
