import { describe, expect, it } from 'vitest';
import { mapProjectTime } from '../../src/domain';
import {
  ExportRenderFrameRequestSchema,
  FullProbeExportRequestSchema,
  createFrameSchedule,
  formatFrameFileName,
  frameTimeMs,
  formalFrameCount,
  iterateFormalProjectFrameSchedule,
  iterateFormalFrameSchedule,
} from '../../src/shared/export-types';
import { buildProject } from './domain/testProject';

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

  it('schedules formal shots by their actual duration beyond the probe range', () => {
    const schedule = Array.from(iterateFormalFrameSchedule(6_501));
    expect(formalFrameCount(6_501)).toBe(157);
    expect(schedule).toHaveLength(157);
    expect(schedule[156]).toEqual({
      frameIndex: 156,
      timeMs: 6_500,
      fileName: 'frame_000156.png',
    });
    expect(schedule.at(-1)?.timeMs).toBeLessThan(6_501);
  });

  it('uses one global grid for three 1001 ms Shots and maps every frame to Shot-local time', () => {
    const base = buildProject();
    const firstShot = base.shots[0]!;
    const project = {
      ...base,
      shots: Array.from({ length: 3 }, (_, index) => ({
        ...firstShot,
        id: `50000000-0000-4000-8000-00000000000${index + 1}`,
        name: `shot-${index + 1}`,
        durationMs: 1_001,
      })),
    };
    const schedule = Array.from(iterateFormalProjectFrameSchedule(project));

    expect(formalFrameCount(3 * 1_001)).toBe(73);
    expect(schedule).toHaveLength(73);
    expect(schedule[24]).toMatchObject({
      timeMs: 1_000,
      shotIndex: 0,
      shotStartMs: 0,
      shotLocalTimeMs: 1_000,
    });
    expect(schedule[25]).toMatchObject({
      timeMs: 1_041,
      shotIndex: 1,
      shotStartMs: 1_001,
      shotLocalTimeMs: 40,
    });
    expect(schedule.at(-1)).toMatchObject({
      timeMs: 3_000,
      shotIndex: 2,
      shotStartMs: 2_002,
      shotLocalTimeMs: 998,
    });
    expect(mapProjectTime(project, 1_000).shotIndex).toBe(0);
    expect(mapProjectTime(project, 1_001).shotIndex).toBe(1);
    expect(mapProjectTime(project, 1_002).shotLocalTimeMs).toBe(1);
  });

  it('requires formal Shot identity and local time to travel together', () => {
    const base = {
      jobId: '57100000-0000-4000-8000-000000000901',
      frameIndex: 11,
      timeMs: 458,
    };
    expect(ExportRenderFrameRequestSchema.safeParse(base).success).toBe(true);
    expect(
      ExportRenderFrameRequestSchema.safeParse({
        ...base,
        shotId: '50000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      ExportRenderFrameRequestSchema.safeParse({
        ...base,
        shotId: '50000000-0000-4000-8000-000000000001',
        shotLocalTimeMs: 17,
      }).success,
    ).toBe(true);
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
