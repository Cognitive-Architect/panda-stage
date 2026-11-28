import { describe, expect, it } from 'vitest';
import { calculateViewportTransform, screenToStage, stageToScreen } from '../../src/domain';
import { CanvasViewportStore } from '../../src/renderer/stores/canvasViewportStore';

describe('Canvas viewport navigation', () => {
  it('fits within the frame and uses the same signed geometry at Actual Size', () => {
    const container = { width: 800, height: 600 };
    const navigation = { zoom: 1, pan: { x: 0, y: 0 }, padding: 16 };
    const fit = calculateViewportTransform(container, 'fit', undefined, navigation);
    expect(fit.scale).toBeCloseTo(0.4);
    expect(fit.offsetX).toBeCloseTo(16);
    const actual = calculateViewportTransform(container, 'actual', undefined, {
      ...navigation, pan: { x: 41, y: -20 },
    });
    expect(actual.scale).toBe(1);
    expect(actual.offsetX).toBe(-519);
    expect(actual.offsetY).toBe(-260);
    const point = { x: 640, y: 360 };
    expect(screenToStage(stageToScreen(point, actual), actual)).toEqual(point);
  });

  it('recenters when Fit is explicitly reapplied after zoom and pan', () => {
    const viewport = new CanvasViewportStore();
    viewport.navigate(2, { x: 100, y: -48 });
    viewport.setMode('fit');
    expect(viewport.getSnapshot()).toMatchObject({
      mode: 'fit', navigation: { zoom: 1, pan: { x: 0, y: 0 }, padding: 16 },
    });
  });
});
