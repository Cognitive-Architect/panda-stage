import { describe, expect, it } from 'vitest';
import {
  createFrameSchedule,
  formatFrameFileName,
  frameTimeMs,
} from '../../src/shared/export-types';

describe('export frame schedule', () => {
  it.each([
    [3_000, 72],
    [5_000, 120],
  ])('creates %i ms at 24 fps as %i frames', (durationMs, count) => {
    const schedule = createFrameSchedule({ durationMs, fps: 24 });

    expect(schedule).toHaveLength(count);
    expect(schedule[0]).toEqual({
      frameIndex: 0,
      timeMs: 0,
      fileName: 'frame_000000.png',
    });
    expect(schedule.at(-1)?.timeMs).toBeLessThan(durationMs);
    expect(new Set(schedule.map((frame) => frame.fileName)).size).toBe(count);
  });

  it('uses the integer millisecond timeline required by the export contract', () => {
    expect(frameTimeMs(0, 24)).toBe(0);
    expect(frameTimeMs(1, 24)).toBe(41);
    expect(frameTimeMs(24, 24)).toBe(1_000);
    expect(frameTimeMs(71, 24)).toBe(2_958);
    expect(formatFrameFileName(71)).toBe('frame_000071.png');
  });
});
