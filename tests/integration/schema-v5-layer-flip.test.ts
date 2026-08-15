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
import { ProjectSchema, migrateProject } from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('schema v5 explicit flip lifecycle', () => {
  it('migrates v4 once, saves v5, and preserves locked and flip values on reopen', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-schema-v4-'),
    );
    temporaryRoots.push(parent);
    const projectRoot = path.join(parent, 'schema-v4.pandastage');
    const projectFile = path.join(projectRoot, 'project.json');
    const current = migrateProject(exampleProject);
    const version4 = {
      ...current,
      schemaVersion: 4,
      shots: current.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map(({ flipX, ...layer }) => {
          void flipX;
          return layer;
        }),
      })),
    };
    const service = new ProjectService();

    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      projectFile,
      `${JSON.stringify(version4, null, 2)}\n`,
      'utf8',
    );

    const migrated = await service.open(projectRoot);
    expect(migrated).toMatchObject({
      migrated: true,
      sourceVersion: 4,
      project: { schemaVersion: 5 },
    });
    expect(
      migrated.project.shots.flatMap((shot) => shot.layers)
        .every((layer) => layer.flipX === false),
    ).toBe(true);

    const layerId = migrated.project.shots[0]!.layers[1]!.id;
    const locked = ProjectSchema.parse({
      ...migrated.project,
      shots: migrated.project.shots.map((shot, shotIndex) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          shotIndex === 0 && layer.id === layerId
            ? { ...layer, locked: true, flipX: true }
            : layer,
        ),
      })),
    });
    await service.save(projectRoot, locked, 1);

    const serialized = JSON.parse(
      await readFile(projectFile, 'utf8'),
    );
    const reopened = await service.open(projectRoot);
    expect(serialized.schemaVersion).toBe(5);
    expect(reopened).toMatchObject({
      migrated: false,
      sourceVersion: 5,
      project: { schemaVersion: 5 },
    });
    expect(
      reopened.project.shots[0]!.layers.find(
        (layer) => layer.id === layerId,
      ),
    ).toMatchObject({ locked: true, flipX: true });
  });
});
