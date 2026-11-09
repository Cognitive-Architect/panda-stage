import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeShotCameraKeyframes,
  ProjectSchema,
  resolveShotCamera,
  withShotCamera,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_MS = 3000;

/** The Stage B Gate story: 0s full stage -> mid push-in -> tail pan/pull-out. */
const RECORDED_KEYFRAMES = normalizeShotCameraKeyframes(
  [
    { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
    { timeMs: 1_200, centerX: 960, centerY: 540, zoom: 1.6 },
    { timeMs: 3_000, centerX: 1_300, centerY: 540, zoom: 1.35 },
  ],
  WIDTH,
  HEIGHT,
  DURATION_MS,
);

async function openFixtureRoot(): Promise<{
  root: string;
  service: ProjectService;
  base: Project;
}> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-auto07-camera-'),
  );
  temporaryParents.push(parent);
  const root = path.join(parent, 'shot-camera.pandastage');
  const service = new ProjectService();
  const created = await service.create(root, { name: 'AUTO-07B camera' });
  const base = ProjectSchema.parse({
    ...buildProject(),
    id: created.project.id,
    name: created.project.name,
    createdAt: created.project.createdAt,
    updatedAt: created.project.updatedAt,
  });
  return { root, service, base };
}

function manualProject(base: Project): Project {
  return ProjectSchema.parse(
    withShotCamera(base, IDS.shot, {
      mode: 'manual',
      keyframes: RECORDED_KEYFRAMES,
    }),
  );
}

describe('AUTO-07B Shot camera save/reopen integration', () => {
  it('persists the manual track and mode without moving any layer', async () => {
    const { root, service, base } = await openFixtureRoot();
    const project = manualProject(base);
    const layersBefore = project.shots[0]!.layers;
    await service.save(root, project, 1);

    const reopened = await service.open(root);
    const shot = reopened.project.shots[0]!;
    expect(shot.camera.mode).toBe('manual');
    expect(shot.camera.keyframes).toEqual(RECORDED_KEYFRAMES);
    // Camera is a Shot-level contract: no Character layer was translated.
    expect(shot.layers).toEqual(layersBefore);

    const persisted = await readFile(path.join(root, 'project.json'), 'utf8');
    const parsed = JSON.parse(persisted) as Project;
    expect(parsed.shots[0]!.camera).toEqual({
      mode: 'manual',
      keyframes: RECORDED_KEYFRAMES,
    });
    expect(persisted).not.toContain('"history"');
  });

  it('restores deterministic camera values at shot boundaries after reopen', async () => {
    const { root, service, base } = await openFixtureRoot();
    const project = manualProject(base);
    const times = [0, 1_200, 3_000];
    const expected = times.map((timeMs) =>
      resolveShotCamera(project, project.shots[0]!, timeMs),
    );
    await service.save(root, project, 1);

    const reopened = await service.open(root);
    const shot = reopened.project.shots[0]!;
    // Editor Canvas, Product Preview and hidden Export all read this one
    // evaluator, so the reopened values are the contract for every consumer.
    expect(
      times.map((timeMs) => resolveShotCamera(reopened.project, shot, timeMs)),
    ).toEqual(expected);
    expect(expected[0]!.zoom).toBeCloseTo(1);
    expect(expected[1]!.zoom).toBeCloseTo(1.6);
    expect(expected[2]!.centerX).toBeGreaterThan(expected[1]!.centerX);
  });
});
