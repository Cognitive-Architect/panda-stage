import { describe, expect, it } from 'vitest';
import {
  animationPlaybackDurationMs,
  createAnimationPlaybackTimeline,
  markAnimationPlaybackFrameVisible,
  sampleAnimationFrameIndex,
  sampleAnimationPlaybackTimeline,
  sampleLoopingAnimationFrameIndex,
} from '../../src/renderer/features/assets/animationPlayback';

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

  it.each([12, 24, 25, 30])('uses source FPS %i for looping preview samples', (sourceFps) => {
    const frameDurationMs = 1_000 / sourceFps;
    for (const frameCount of [2, 4, 24]) {
      expect(sampleLoopingAnimationFrameIndex(0, sourceFps, frameCount)).toBe(0);
      expect(sampleLoopingAnimationFrameIndex(frameDurationMs, sourceFps, frameCount)).toBe(1);
      expect(sampleLoopingAnimationFrameIndex(frameCount * frameDurationMs, sourceFps, frameCount)).toBe(0);
    }
  });

  it('keeps a 21-frame, 25 fps final frame visible for a full 40 ms', () => {
    const timeline = createAnimationPlaybackTimeline(25, 21, 100);

    expect(animationPlaybackDurationMs(25, 21)).toBe(840);
    expect(sampleAnimationPlaybackTimeline(timeline, 900).frameIndex).toBe(20);
    markAnimationPlaybackFrameVisible(timeline, 20, 900);
    expect(sampleAnimationPlaybackTimeline(timeline, 939).complete).toBe(false);
    expect(sampleAnimationPlaybackTimeline(timeline, 940).complete).toBe(true);
  });

  it('does not retime the source clock when a slow final-frame read completes', () => {
    const timeline = createAnimationPlaybackTimeline(25, 21, 100);
    const startedAtMs = timeline.startedAtMs;
    const initiallyRequestedIndex = sampleAnimationPlaybackTimeline(timeline, 140).frameIndex;
    markAnimationPlaybackFrameVisible(timeline, 20, 1_020);

    expect(initiallyRequestedIndex).toBe(1);
    expect(sampleAnimationPlaybackTimeline(timeline, 260).frameIndex).toBe(4);
    expect(timeline.startedAtMs).toBe(startedAtMs);
    expect(sampleAnimationPlaybackTimeline(timeline, 1_059).complete).toBe(false);
    expect(sampleAnimationPlaybackTimeline(timeline, 1_060).complete).toBe(true);
  });
});
