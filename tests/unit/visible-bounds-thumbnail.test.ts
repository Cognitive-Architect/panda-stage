import { describe, expect, it } from 'vitest';
import { findVisibleImageBounds } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { getVisibleBoundsThumbnailTransform } from '../../src/renderer/features/characters/VisibleBoundsThumbnail';

describe('visible bounds thumbnails', () => {
  it('measures alpha bounds from the visible pixels only', () => {
    const pixels = new Uint8Array(4 * 2 * 4);
    pixels[(0 * 4 + 1) * 4 + 3] = 255;
    pixels[(1 * 4 + 2) * 4 + 3] = 255;

    expect(findVisibleImageBounds(pixels, 4, 2)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(findVisibleImageBounds(new Uint8Array(4 * 2 * 4), 4, 2)).toBeNull();
  });

  it('uniformly scales and centers visible content without stretching it', () => {
    const transform = getVisibleBoundsThumbnailTransform(
      { x: 0.4, y: 0.1, width: 0.1, height: 0.3 },
      1920,
      1080,
      48,
      48,
    );

    expect(transform).not.toBeNull();
    expect(transform!.scale).toBeGreaterThan(1);
    expect(transform!.translateX).toBeGreaterThan(0);
    expect(transform!.translateY).toBeGreaterThan(0);
  });

  it('falls back when bounds or image/container dimensions are invalid', () => {
    expect(getVisibleBoundsThumbnailTransform(
      { x: 0, y: 0, width: 1, height: 1 },
      0,
      1080,
      48,
      48,
    )).toBeNull();
  });
});
