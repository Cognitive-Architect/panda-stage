import { describe, expect, it } from 'vitest';
import {
  clampTime,
  clampZoom,
  computePixelsPerMs,
  formatTimecode,
  frameDurationMs,
  generateRulerTicks,
  integerFrameSpanMs,
  pxToTime,
  snapToFrame,
  timeToPx,
} from '../../../../src/renderer/features/timeline/timeGeometry';

const FRAME_MS = frameDurationMs();

describe('timeGeometry time<->pixel core', () => {
  it('frameDurationMs matches 1000 / FPS', () => {
    expect(FRAME_MS).toBeCloseTo(1000 / 24, 6);
  });

  it('clampTime keeps values inside [0, durationMs]', () => {
    expect(clampTime(500, 3000)).toBe(500);
    expect(clampTime(-10, 3000)).toBe(0);
    expect(clampTime(9999, 3000)).toBe(3000);
    expect(clampTime(500, 0)).toBe(0);
    expect(clampTime(Number.NaN, 3000)).toBe(0);
    expect(clampTime(-5, Number.NaN)).toBe(0);
  });

  it('snapToFrame lands on 24 FPS frame boundaries as integer ms', () => {
    expect(snapToFrame(0)).toBe(0);
    expect(snapToFrame(1000)).toBe(1000); // exactly frame 24
    expect(snapToFrame(13)).toBe(0);
    expect(snapToFrame(30)).toBe(Math.round(FRAME_MS)); // frame 1
    expect(snapToFrame(1041.66)).toBe(Math.round(25 * FRAME_MS)); // frame 25
    expect(snapToFrame(459)).toBe(458);
    expect(snapToFrame(460)).toBe(458);
    expect(snapToFrame(-50)).toBe(0);
    expect(snapToFrame(Number.NaN)).toBe(0);
  });

  it('derives the persisted one-frame span from Day26 frame geometry', () => {
    expect(integerFrameSpanMs()).toBe(
      snapToFrame(frameDurationMs()),
    );
    expect(integerFrameSpanMs()).toBe(42);
  });

  it('timeToPx / pxToTime are exact inverses for the same scale', () => {
    const ppm = 0.5;
    expect(timeToPx(1000, ppm)).toBe(500);
    expect(pxToTime(500, ppm)).toBe(1000);
    expect(pxToTime(timeToPx(1500, ppm), ppm)).toBeCloseTo(1500, 6);
  });

  it('negative inputs never produce negative geometry', () => {
    expect(timeToPx(-100, 0.5)).toBe(0);
    expect(pxToTime(-100, 0.5)).toBe(0);
  });
});

describe('timeGeometry zoom and ticks', () => {
  it('computePixelsPerMs scales linearly with zoom but preserves real time', () => {
    const base = computePixelsPerMs(1000, 3000, 1);
    const zoomed = computePixelsPerMs(1000, 3000, 2);
    expect(zoomed).toBeCloseTo(base * 2, 6);
    // Same real time maps to different px, but inverts back to the same time.
    const t = 1500;
    expect(pxToTime(timeToPx(t, zoomed), zoomed)).toBeCloseTo(t, 6);
    expect(pxToTime(timeToPx(t, base), base)).toBeCloseTo(t, 6);
  });

  it('computePixelsPerMs is zero for degenerate viewports/durations', () => {
    expect(computePixelsPerMs(0, 3000, 1)).toBe(0);
    expect(computePixelsPerMs(1000, 0, 1)).toBe(0);
    expect(computePixelsPerMs(-100, 3000, 1)).toBe(0);
  });

  it('generateRulerTicks yields frame-aligned, ascending, in-range ticks', () => {
    const ticks = generateRulerTicks(3000, computePixelsPerMs(1000, 3000, 1));
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]!.timeMs).toBe(0);
    expect(ticks[ticks.length - 1]!.timeMs).toBeLessThanOrEqual(3000);
    for (let i = 1; i < ticks.length; i++) {
      const tick = ticks[i]!;
      expect(tick.timeMs).toBeGreaterThan(ticks[i - 1]!.timeMs);
      // Each tick lands exactly on a 24 FPS frame boundary.
      expect(snapToFrame(tick.timeMs)).toBe(tick.timeMs);
      expect(tick.label).toMatch(/^\d{2}:\d{2}\.\d{3}$/u);
    }
  });

  it('generateRulerTicks is empty for zero duration', () => {
    expect(generateRulerTicks(0, 0.5)).toEqual([]);
    expect(generateRulerTicks(3000, 0)).toEqual([]);
  });

  it('clampZoom stays within [1, 8]', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('timeGeometry timecode', () => {
  it('formats mm:ss.mmm', () => {
    expect(formatTimecode(0)).toBe('00:00.000');
    expect(formatTimecode(1234)).toBe('00:01.234');
    expect(formatTimecode(65000)).toBe('01:05.000');
    expect(formatTimecode(-10)).toBe('00:00.000');
  });
});
