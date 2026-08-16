import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  migrateProject,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('layer placement persistence lifecycle', () => {
  it('creates, moves, locks, saves, and reopens the exact center coordinates', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-day22-'),
    );
    temporaryRoots.push(parent);
    const projectRoot = path.join(parent, 'placement.pandastage');
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const asset = project.assets[0]!;
    const service = new LayerService({
      createId: () =>
        'd2220000-0000-4000-8000-000000000001',
      now: () => new Date('2026-07-26T02:00:00.000Z'),
    });
    const created = service.createFromAsset(project, shot.id, {
      version: 2,
      assetId: asset.id,
      type: 'asset-image',
      position: { x: 420.5, y: 260.25 },
    });
    const moved = service.updatePosition(
      created.project,
      shot.id,
      created.layer.id,
      { x: 777.75, y: 444.5 },
    );
    const locked = service.setLocked(
      moved,
      shot.id,
      created.layer.id,
      true,
    );
    const projectService = new ProjectService();

    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      path.join(projectRoot, 'project.json'),
      `${JSON.stringify(project, null, 2)}\n`,
      'utf8',
    );
    await projectService.save(projectRoot, locked, 3);
    const reopened = await projectService.open(projectRoot);
    const reopenedLayer = reopened.project.shots[0]!.layers.find(
      (layer) => layer.id === created.layer.id,
    );
    const serialized = JSON.parse(
      await readFile(
        path.join(projectRoot, 'project.json'),
        'utf8',
      ),
    );

    expect(reopened).toMatchObject({
      migrated: false,
      sourceVersion: 6,
    });
    expect(reopenedLayer).toMatchObject({
      source: { kind: 'asset', assetId: asset.id },
      anchor: 'center',
      x: 777.75,
      y: 444.5,
      locked: true,
    });
    expect(serialized).not.toHaveProperty('selectedLayerId');
    expect(serialized.shots[0].layers).toContainEqual(
      expect.objectContaining({
        id: created.layer.id,
        x: 777.75,
        y: 444.5,
        locked: true,
      }),
    );
  });
});
