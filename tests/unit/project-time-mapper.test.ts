import { describe, expect, it } from 'vitest';
import { ProjectSchema, mapProjectTime } from '../../src/domain';
import { buildProject } from './domain/testProject';

const SECOND_SHOT_ID = '50000000-0000-4000-8000-000000000002';

function projectWithDurations(
  durations: readonly number[],
): ReturnType<typeof ProjectSchema.parse> {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    shots: durations.map((durationMs, index) => ({
      ...project.shots[0]!,
      id:
        index === 0
          ? project.shots[0]!.id
          : `${SECOND_SHOT_ID.slice(0, -1)}${index + 1}`,
      durationMs,
    })),
  });
}

describe('project-time mapper', () => {
  it('returns an empty position for a project with no shots', () => {
    const project = projectWithDurations([]);

    expect(mapProjectTime(project, 0)).toEqual({
      projectTimeMs: 0,
      shot: null,
      shotIndex: null,
      shotStartMs: 0,
      shotLocalTimeMs: 0,
      totalDurationMs: 0,
    });
  });

  it('maps one shot including its terminal sample', () => {
    const project = projectWithDurations([2_000]);
    const shot = project.shots[0]!;

    expect(mapProjectTime(project, 0)).toMatchObject({
      projectTimeMs: 0,
      shot,
      shotIndex: 0,
      shotStartMs: 0,
      shotLocalTimeMs: 0,
      totalDurationMs: 2_000,
    });
    expect(mapProjectTime(project, 2_000)).toMatchObject({
      projectTimeMs: 2_000,
      shot,
      shotIndex: 0,
      shotStartMs: 0,
      shotLocalTimeMs: 2_000,
    });
  });

  it('uses half-open shot intervals at an unequal-duration boundary', () => {
    const project = projectWithDurations([2_000, 3_500]);
    const firstShot = project.shots[0]!;
    const secondShot = project.shots[1]!;

    expect(mapProjectTime(project, 1_999)).toMatchObject({
      projectTimeMs: 1_999,
      shot: firstShot,
      shotIndex: 0,
      shotStartMs: 0,
      shotLocalTimeMs: 1_999,
    });
    expect(mapProjectTime(project, 2_000)).toMatchObject({
      projectTimeMs: 2_000,
      shot: secondShot,
      shotIndex: 1,
      shotStartMs: 2_000,
      shotLocalTimeMs: 0,
    });
    expect(mapProjectTime(project, 2_001)).toMatchObject({
      projectTimeMs: 2_001,
      shot: secondShot,
      shotIndex: 1,
      shotStartMs: 2_000,
      shotLocalTimeMs: 1,
    });
    expect(mapProjectTime(project, 5_500)).toMatchObject({
      projectTimeMs: 5_500,
      shot: secondShot,
      shotIndex: 1,
      shotStartMs: 2_000,
      shotLocalTimeMs: 3_500,
      totalDurationMs: 5_500,
    });
  });

  it('clamps negative, non-finite, and over-terminal time samples', () => {
    const project = projectWithDurations([2_000, 3_500]);

    expect(mapProjectTime(project, -10)).toMatchObject({
      projectTimeMs: 0,
      shotIndex: 0,
      shotLocalTimeMs: 0,
    });
    expect(mapProjectTime(project, Number.NaN).projectTimeMs).toBe(0);
    expect(mapProjectTime(project, Number.POSITIVE_INFINITY).projectTimeMs).toBe(
      0,
    );
    expect(mapProjectTime(project, 99_999)).toMatchObject({
      projectTimeMs: 5_500,
      shotIndex: 1,
      shotLocalTimeMs: 3_500,
    });
  });

  it('rounds fractional input once before applying the boundary contract', () => {
    const project = projectWithDurations([2_000, 3_500]);

    expect(mapProjectTime(project, 1_999.6)).toMatchObject({
      projectTimeMs: 2_000,
      shotIndex: 1,
      shotLocalTimeMs: 0,
    });
  });
});
