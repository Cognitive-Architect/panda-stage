import { describe, expect, it } from 'vitest';
import {
  FullProbeExportRequestSchema,
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

  it('accepts MP4 case-insensitively and rejects other full-export extensions', () => {
    const request = {
      projectDirectory: 'C:\\项目',
      audioPath: 'C:\\项目\\声音.wav',
      outputPath: 'C:\\输出\\成片.MP4',
      durationMs: 3_000,
      fps: 24,
      audioStartMs: 400,
      overwrite: true,
    } as const;
    expect(FullProbeExportRequestSchema.parse(request).outputPath).toBe(
      request.outputPath,
    );
    expect(
      FullProbeExportRequestSchema.safeParse({
        ...request,
        outputPath: 'C:\\输出\\成片.mkv',
      }).success,
    ).toBe(false);
  });
});
