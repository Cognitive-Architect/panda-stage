import { describe, expect, it } from 'vitest';
import { sampleAnimationFrameIndex } from '../../src/renderer/features/assets/animationPlayback';

describe('sampleAnimationFrameIndex', () => {
  it('samples source-frame boundaries without looping past the last frame', () => {
    expect(sampleAnimationFrameIndex(0, 12, 4)).toBe(0);
    expect(sampleAnimationFrameIndex(83.332, 12, 4)).toBe(0);
    expect(sampleAnimationFrameIndex(83.334, 12, 4)).toBe(1);
    expect(sampleAnimationFrameIndex(250, 12, 4)).toBe(3);
    expect(sampleAnimationFrameIndex(10_000, 12, 4)).toBe(3);
  });

  it('samples four 30 fps frames at source-frame boundaries and keeps repeated images timed', () => {
    expect(sampleAnimationFrameIndex(0, 30, 4)).toBe(0);
    expect(sampleAnimationFrameIndex(1_000 / 30, 30, 4)).toBe(1);
    expect(sampleAnimationFrameIndex(2_000 / 30, 30, 4)).toBe(2);
    expect(sampleAnimationFrameIndex(100, 30, 4)).toBe(3);
    expect(sampleAnimationFrameIndex(133.333, 30, 4)).toBe(3);
  });

  it('clamps negative elapsed time and handles invalid input safely', () => {
    expect(sampleAnimationFrameIndex(-1, 24, 3)).toBe(0);
    expect(sampleAnimationFrameIndex(100, 0, 3)).toBe(0);
    expect(sampleAnimationFrameIndex(100, 24, 0)).toBe(0);
  });
});
