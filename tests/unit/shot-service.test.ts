import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  ProjectSchema,
  evaluateShotAtTime,
  migrateProject,
  SHOT_MIN_DURATION_MS,
  ShotSchema,
  ShotService,
  ShotServiceError,
  type Project,
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

/**
 * A 3000ms Shot whose only content is one bitmap Layer with pin-warp poses at
 * 0ms and 2000ms. Other demo content is stripped so the content-end rule under
 * test cannot be satisfied by an unrelated audio/dialogue/event end time.
 */
function pinWarpShotFixture(): {
  project: Project;
  shotId: string;
  layerId: string;
  layerService: LayerService;
} {
  const base = migrateProject(exampleProject);
  const shot = base.shots[0]!;
  const clean = ProjectSchema.parse({
    ...base,
    shots: [{
      ...shot,
      durationMs: 3_000,
      layers: [],
      backgroundLayerId: null,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
      camera: undefined,
    }],
  });
  const imageAsset = clean.assets.find((asset) => asset.kind === 'image')!;
  const layerService = new LayerService({
    createId: ids(),
    now: () => new Date('2026-07-25T12:40:00.000Z'),
  });
  const created = layerService.createFromAsset(clean, shot.id, {
    version: 2,
    assetId: imageAsset.id,
    type: 'asset-image',
    position: { x: 960, y: 540 },
  });
  const bound = layerService.bindPinWarp(created.project, shot.id, created.layer.id, 0);
  const project = layerService.setPinWarpPin(
    bound,
    shot.id,
    created.layer.id,
    2_000,
    1,
    { x: 0, y: 120 },
  );
  return { project, shotId: shot.id, layerId: created.layer.id, layerService };
}

function pinWarpOf(project: Project, layerId: string) {
  const layer = project.shots[0]!.layers.find((candidate) => candidate.id === layerId);
  if (!layer?.pinWarp) throw new Error('Expected a pin-warp Layer.');
  return layer.pinWarp;
}

function capturedShotError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the action to throw.');
}

describe('ShotService pin-warp content end (#1471 R4)', () => {
  it('refuses to shorten a Shot past its last pin-warp pose with the existing content-end feedback', () => {
    const { project, shotId, layerId } = pinWarpShotFixture();
    const before = JSON.stringify(project.shots[0]);
    expect(pinWarpOf(project, layerId).poses.map((pose) => pose.timeMs)).toEqual([0, 2_000]);

    const error = capturedShotError(() => service().setDuration(project, shotId, 1_000));
    expect(error).toBeInstanceOf(ShotServiceError);
    expect((error as ShotServiceError).code).toBe('SHOT_CONTENT_OUT_OF_RANGE');
    // The established shortening policy and copy are reused unchanged.
    expect(error.message).toBe('镜头内容延伸到 2000ms，时长不能缩短到 1000ms。');
    // The refused edit leaves the Shot and its legal poses untouched.
    expect(JSON.stringify(project.shots[0])).toBe(before);
  });

  it('unblocks editing after enlarging the duration or deleting the tail pose without losing legal poses', () => {
    const { project, shotId, layerId, layerService } = pinWarpShotFixture();
    const legalPoses = JSON.stringify(pinWarpOf(project, layerId).poses);

    const enlarged = service().setDuration(project, shotId, 2_000);
    expect(enlarged.shots[0]!.durationMs).toBe(2_000);
    expect(JSON.stringify(pinWarpOf(enlarged, layerId).poses)).toBe(legalPoses);
    // With the Shot long enough again, editing at the retained tail frame works.
    const written = layerService.setPinWarpPin(
      enlarged, shotId, layerId, 2_000, 1, { x: 0, y: 140 },
    );
    expect(pinWarpOf(written, layerId).poses.map((pose) => pose.timeMs)).toEqual([0, 2_000]);
    expect(pinWarpOf(written, layerId).poses[1]!.pins[1]).toEqual({ x: 0, y: 140 });
    expect(pinWarpOf(written, layerId).poses[0]!.pins).toEqual(
      JSON.parse(legalPoses)[0].pins,
    );

    // Deleting the tail pose is the other valid path: shortening then succeeds
    // and the remaining legal pose is preserved.
    const withoutTail = layerService.removePinWarpPose(project, shotId, layerId, 2_000);
    expect(pinWarpOf(withoutTail, layerId).poses.map((pose) => pose.timeMs)).toEqual([0]);
    const shortened = service().setDuration(withoutTail, shotId, 1_000);
    expect(shortened.shots[0]!.durationMs).toBe(1_000);
    expect(pinWarpOf(shortened, layerId).poses.map((pose) => pose.timeMs)).toEqual([0]);
    expect(pinWarpOf(shortened, layerId).poses[0]!.pins).toEqual(JSON.parse(legalPoses)[0].pins);
  });

  it('still opens a project whose stored tail pose predates a shortened duration and degrades locally', () => {
    const { project, shotId, layerId, layerService } = pinWarpShotFixture();
    // Simulate data authored before this fix (or a foreign file): load-tolerant
    // persistence must accept it; only the authoring write is gated.
    const stale = ProjectSchema.parse({
      ...project,
      shots: [{ ...project.shots[0]!, durationMs: 1_000 }],
    });
    const reopened = migrateProject(JSON.parse(JSON.stringify(stale)));
    expect(reopened.shots[0]!.durationMs).toBe(1_000);
    expect(pinWarpOf(reopened, layerId).poses.map((pose) => pose.timeMs)).toEqual([0, 2_000]);
    // Read-time evaluation keeps working (no global hard gate).
    const evaluated = evaluateShotAtTime(reopened.shots[0]!, 0, reopened).layers.find(
      (layer) => layer.id === layerId,
    )!;
    expect(evaluated.pinWarp?.status).toBe('valid');
    const held = evaluateShotAtTime(reopened.shots[0]!, 1_500, reopened).layers.find(
      (layer) => layer.id === layerId,
    )!;
    expect(held.pinWarp?.status).toBe('valid');
    // The pre-existing write validation still reports the over-time pose group...
    expect(() =>
      layerService.setPinWarpPin(reopened, shotId, layerId, 1_000, 1, { x: 0, y: 100 }),
    ).toThrow('姿态时间超出镜头时长。');
    // ...and enlarging the duration back over the stored pose unblocks editing
    // without dropping it (the content-end rule now reports 2000ms, so 2000ms
    // is accepted while 1000ms would be refused).
    expect((capturedShotError(() => service().setDuration(reopened, shotId, 1_000)) as ShotServiceError).code)
      .toBe('SHOT_CONTENT_OUT_OF_RANGE');
    const repaired = service().setDuration(reopened, shotId, 2_000);
    const edited = layerService.setPinWarpPin(
      repaired, shotId, layerId, 2_000, 1, { x: 0, y: 100 },
    );
    expect(pinWarpOf(edited, layerId).poses.map((pose) => pose.timeMs)).toEqual([0, 2_000]);
    expect(pinWarpOf(edited, layerId).poses[1]!.pins[1]).toEqual({ x: 0, y: 100 });
  });
});
