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
  ProjectSchema,
  ShotService,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('explicit background identity lifecycle', () => {
  it('migrates v2, saves, copies, removes, and reopens without a dangling background', async () => {
    const parent = await mkdtemp(
      path.join(os.tmpdir(), 'panda-stage-background-v3-'),
    );
    temporaryParents.push(parent);
    const root = path.join(parent, 'background.pandastage');
    await mkdir(root, { recursive: true });
    const current = ProjectSchema.parse(exampleProject);
    const version2 = {
      ...current,
      schemaVersion: 2,
      shots: current.shots.map(({ backgroundLayerId, ...shot }) => {
        void backgroundLayerId;
        return shot;
      }),
    };
    await writeFile(
      path.join(root, 'project.json'),
      `${JSON.stringify(version2, null, 2)}\n`,
      'utf8',
    );
    const projectService = new ProjectService();

    const migrated = await projectService.open(root);
    expect(migrated).toMatchObject({
      migrated: true,
      sourceVersion: 2,
      project: { schemaVersion: 3 },
    });
    const source = migrated.project.shots[0]!;
    expect(source.backgroundLayerId).toBe(source.layers[0]!.id);

    let counter = 0;
    const shotService = new ShotService({
      createId: () =>
        `d2420000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    });
    const duplicated = shotService.duplicate(
      migrated.project,
      source.id,
    );
    const copy = duplicated.shots[1]!;
    expect(copy.backgroundLayerId).not.toBe(source.backgroundLayerId);
    expect(
      copy.layers.some((layer) => layer.id === copy.backgroundLayerId),
    ).toBe(true);
    const copyOnly = shotService.remove(duplicated, source.id);
    await projectService.save(root, copyOnly, 1);
    const reopened = await projectService.open(root);

    expect(reopened).toMatchObject({
      migrated: false,
      sourceVersion: 3,
    });
    expect(reopened.project.shots).toHaveLength(1);
    expect(reopened.project.shots[0]!.backgroundLayerId).toBe(
      copy.backgroundLayerId,
    );
    expect(
      reopened.project.shots[0]!.layers.some(
        (layer) =>
          layer.id === reopened.project.shots[0]!.backgroundLayerId,
      ),
    ).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')))
      .toMatchObject({
        schemaVersion: 3,
        shots: [{ backgroundLayerId: copy.backgroundLayerId }],
      });
  });
});
