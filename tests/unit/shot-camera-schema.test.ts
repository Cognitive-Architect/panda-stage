import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOT_CAMERA,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildProject, IDS, legacyShot, legacyShots } from './domain/testProject';

function currentProject(): Project {
  return buildProject();
}

describe('AUTO-07B Shot camera persistence contract', () => {
  it('defaults every Shot to the historical full-stage framing', () => {
    const project = currentProject();
    expect(project.shots[0]!.camera).toEqual(DEFAULT_SHOT_CAMERA);
    expect(ProjectSchema.parse(project)).toEqual(project);
  });

  it('migrates a strict v16 Project to v18 with a static camera on every Shot', () => {
    const current = currentProject();
    const version16 = {
      ...current,
      schemaVersion: 16,
      shots: legacyShots(current.shots),
    };
    const migrated = migrateProject(version16);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shots.every((shot) => shot.camera.mode === 'static')).toBe(true);
    expect(migrated.shots.every((shot) => shot.camera.keyframes.length === 0)).toBe(true);
    // Pre-camera Shot data is preserved verbatim.
    expect(migrated.shots.map(legacyShot)).toEqual(version16.shots);
  });

  it('round-trips a manual track through persistence', () => {
    const current = currentProject();
    const withCamera = ProjectSchema.parse({
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        camera: {
          mode: 'manual',
          keyframes: [
            { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
            { timeMs: 2_000, centerX: 1_100, centerY: 500, zoom: 1.8 },
          ],
        },
      })),
    });
    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(withCamera)) as unknown,
    );
    expect(reopened.shots[0]!.camera).toEqual(withCamera.shots[0]!.camera);
  });

  it('rejects keyframes outside the Shot or out of order', () => {
    const current = currentProject();
    const shot = current.shots[0]!;
    const build = (keyframes: unknown[]) => ({
      ...current,
      shots: [{ ...shot, camera: { mode: 'manual', keyframes } }],
    });

    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 1 }]),
      ).success,
    ).toBe(true);
    expect(
      ProjectSchema.safeParse(
        build([
          { timeMs: shot.durationMs + 1, centerX: 960, centerY: 540, zoom: 1 },
        ]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse(
        build([
          { timeMs: 500, centerX: 960, centerY: 540, zoom: 1 },
          { timeMs: 500, centerX: 900, centerY: 540, zoom: 1.2 },
        ]),
      ).success,
    ).toBe(false);
    // Unknown keys and out-of-range zoom stay rejected.
    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 12 }]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse(
        build([{ timeMs: 0, centerX: 960, centerY: 540, zoom: 1, extra: 1 }]),
      ).success,
    ).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...current,
        shots: [{ ...shot, camera: { mode: 'dolly', keyframes: [] } }],
      }).success,
    ).toBe(false);
  });

  it('keeps the camera scoped to its own Shot', () => {
    const current = currentProject();
    const shot = current.shots[0]!;
    const second = {
      ...shot,
      id: IDS.shot.replace('01', '02'),
      name: 'second shot',
      camera: {
        mode: 'manual' as const,
        keyframes: [{ timeMs: 0, centerX: 700, centerY: 400, zoom: 1.5 }],
      },
    };
    const twoShots = ProjectSchema.parse({
      ...current,
      shots: [shot, second],
    });
    expect(twoShots.shots[0]!.camera).toEqual(DEFAULT_SHOT_CAMERA);
    expect(twoShots.shots[1]!.camera.keyframes).toHaveLength(1);
  });
});
