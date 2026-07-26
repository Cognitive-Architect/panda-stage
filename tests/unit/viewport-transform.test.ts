import { describe, expect, it } from 'vitest';
import {
  calculateViewportTransform,
  screenToStage,
  stageToScreen,
} from '../../src/domain';

describe('canvas viewport transform', () => {
  it.each([
    {
      container: { width: 800, height: 600 },
      scale: 5 / 12,
      offsetX: 0,
      offsetY: 75,
    },
    {
      container: { width: 1280, height: 720 },
      scale: 2 / 3,
      offsetX: 0,
      offsetY: 0,
    },
    {
      container: { width: 1920, height: 1080 },
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
  ])(
    'fits and centers a 1920x1080 stage in $container',
    ({ container, scale, offsetX, offsetY }) => {
      const transform = calculateViewportTransform(container, 'fit');
      expect(transform.scale).toBeCloseTo(scale);
      expect(transform.offsetX).toBeCloseTo(offsetX);
      expect(transform.offsetY).toBeCloseTo(offsetY);
      expect(stageToScreen({ x: 960, y: 540 }, transform)).toEqual({
        x: container.width / 2,
        y: container.height / 2,
      });
      expect(
        screenToStage(
          { x: container.width / 2, y: container.height / 2 },
          transform,
        ),
      ).toEqual({ x: 960, y: 540 });
    },
  );

  it('uses 1:1 pixels and scrolling dimensions in actual-size mode', () => {
    const transform = calculateViewportTransform(
      { width: 800, height: 600 },
      'actual',
    );
    expect(transform).toMatchObject({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      displayWidth: 1920,
      displayHeight: 1080,
      contentWidth: 1920,
      contentHeight: 1080,
    });
  });

  it('is safe for zero, negative, non-finite, and tiny containers', () => {
    for (const container of [
      { width: 0, height: 0 },
      { width: -1, height: Number.NaN },
      { width: 1, height: 1 },
    ]) {
      const transform = calculateViewportTransform(container, 'fit');
      expect(Object.values(transform).flatMap((value) =>
        typeof value === 'object' ? Object.values(value) : [value],
      )).not.toContain(Number.POSITIVE_INFINITY);
      expect(transform.scale).toBeGreaterThanOrEqual(0);
      if (transform.scale === 0) {
        expect(screenToStage({ x: 0, y: 0 }, transform)).toBeNull();
      }
    }
  });

  it('does not include device pixel ratio in logical coordinates', () => {
    const transform = calculateViewportTransform(
      { width: 1280, height: 720 },
      'fit',
    );
    const screenPoint = stageToScreen({ x: 400, y: 300 }, transform);
    const restored = screenToStage(screenPoint, transform);
    expect(restored?.x).toBeCloseTo(400);
    expect(restored?.y).toBeCloseTo(300);
  });
});
