import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  ProjectSchema,
  migrateProject,
  SHOT_MIN_DURATION_MS,
  ShotSchema,
  ShotService,
  ShotServiceError,
} from '../../src/domain';

function ids() {
  let counter = 0;
  return () =>
    `d2000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

function service(): ShotService {
  return new ShotService({
    createId: ids(),
    now: () => new Date('2026-07-25T12:40:00.000Z'),
  });
}

function entityIds(shot: ReturnType<typeof ShotSchema.parse>): Set<string> {
  return new Set([
    shot.id,
    ...shot.layers.map((layer) => layer.id),
    ...shot.audioClips.map((clip) => clip.id),
    ...shot.dialogues.map((dialogue) => dialogue.id),
    ...shot.timelineEvents.map((event) => event.id),
  ]);
}

function expectShotError(
  action: () => unknown,
  code: ShotServiceError['code'],
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ShotServiceError);
    expect((error as ShotServiceError).code).toBe(code);
  }
}

describe('ShotService', () => {
  it('creates, renames, reorders, removes, and sums five valid shots', () => {
    const shotService = service();
    let project = migrateProject({
      ...exampleProject,
      shots: [],
    });
    const durations = [500, 1_000, 1_500, 2_000, 2_500];
    durations.forEach((durationMs, index) => {
      project = shotService.create(project, {
        name: `镜头 ${index + 1}`,
        durationMs,
      });
    });
    project = shotService.rename(project, project.shots[2]!.id, '中场');
    project = shotService.move(project, project.shots[4]!.id, 0);
    project = shotService.remove(project, project.shots[3]!.id);

    expect(project.shots.map((shot) => shot.name)).toEqual([
      '镜头 5',
      '镜头 1',
      '镜头 2',
      '镜头 4',
    ]);
    expect(project.shots.map((shot) => shot.durationMs)).toEqual([
      2_500,
      500,
      1_000,
      2_000,
    ]);
    expect(project.updatedAt).toBe('2026-07-25T12:40:00.000Z');
  });

  it('duplicates a populated shot with globally new entity IDs and remapped internal references', () => {
    const project = migrateProject(exampleProject);
    const duplicated = service().duplicate(project, project.shots[0]!.id);
    const source = duplicated.shots[0]!;
    const copy = duplicated.shots[1]!;
    const sourceIds = entityIds(source);
    const copyIds = entityIds(copy);

    expect(copy.name).toBe('Opening 副本');
    expect([...copyIds].every((id) => !sourceIds.has(id))).toBe(true);
    expect(copy.layers.map((layer) => layer.id)).not.toEqual(
      source.layers.map((layer) => layer.id),
    );
    expect(copy.backgroundLayerId).not.toBe(source.backgroundLayerId);
    expect(
      copy.layers.some((layer) => layer.id === copy.backgroundLayerId),
    ).toBe(true);
    expect(
      copy.timelineEvents.every((event) =>
        copy.layers.some((layer) => layer.id === event.layerId),
      ),
    ).toBe(true);
    expect(
      copy.dialogues.every((dialogue) =>
        copy.audioClips.some((clip) => clip.id === dialogue.audioClipId),
      ),
    ).toBe(true);
    expect(ProjectSchema.parse(duplicated)).toEqual(duplicated);
  });

  it('rejects fractional, NaN, and sub-500ms durations at both service and schema boundaries', () => {
    const project = migrateProject(exampleProject);
    const shotId = project.shots[0]!.id;
    for (const durationMs of [499, 500.5, Number.NaN]) {
      expectShotError(
        () => service().setDuration(project, shotId, durationMs),
        'INVALID_SHOT_DURATION',
      );
    }
    expect(() =>
      ShotSchema.parse({
        ...project.shots[0],
        durationMs: SHOT_MIN_DURATION_MS - 1,
      }),
    ).toThrow();
  });

  it('rejects a duration shorter than existing content', () => {
    const project = migrateProject(exampleProject);
    expectShotError(
      () => service().setDuration(project, project.shots[0]!.id, 2_999),
      'SHOT_CONTENT_OUT_OF_RANGE',
    );
  });

  it('allows the final shot to be removed and rejects duplicate names or invalid target order', () => {
    const shotService = service();
    const project = migrateProject(exampleProject);
    expect(shotService.remove(project, project.shots[0]!.id).shots).toEqual(
      [],
    );
    expectShotError(
      () =>
        shotService.create(project, {
          name: ' opening ',
          durationMs: 500,
        }),
      'DUPLICATE_SHOT_NAME',
    );
    expectShotError(
      () => shotService.move(project, project.shots[0]!.id, 1),
      'INVALID_SHOT_ORDER',
    );
  });
});
