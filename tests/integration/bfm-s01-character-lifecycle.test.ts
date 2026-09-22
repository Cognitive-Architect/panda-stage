import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
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

describe('BFM-S01 composite Character persistence', () => {
  it('saves and reopens the same Body and shared Face Placement', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-bfm-s01-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'composite-character.pandastage');
    const service = new ProjectService();
    const created = await service.create(projectRoot, {
      name: 'BFM S01 composite character',
    });
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      id: created.project.id,
      name: created.project.name,
      subtitleStyles: created.project.subtitleStyles,
      shots: [],
      characters: [
        {
          ...base.characters[0]!,
          mode: 'composite',
          bodyAssetId: IDS.assetBg,
          facePlacement: { offsetX: 16, offsetY: -9, scale: 0.875 },
        },
      ],
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });

    await service.save(projectRoot, project, 1);
    const serialized = JSON.parse(
      await readFile(path.join(projectRoot, 'project.json'), 'utf8'),
    );
    const reopened = await service.open(projectRoot);

    expect(serialized.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened).toMatchObject({
      sourceVersion: PROJECT_SCHEMA_VERSION,
      migrated: false,
    });
    expect(reopened.project.characters[0]).toEqual(
      project.characters[0],
    );
  });

  it('opens a v6 whole-image project without rewriting it until an explicit save', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-bfm-s01-v6-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'legacy-character.pandastage');
    const projectFile = path.join(projectRoot, 'project.json');
    const service = new ProjectService();
    const created = await service.create(projectRoot, {
      name: 'BFM S01 legacy character',
    });
    const base = buildProject();
    const { mode, ...historicalCharacter } = base.characters[0]!;
    void mode;
    const v6 = {
      ...base,
      id: created.project.id,
      name: created.project.name,
      schemaVersion: 6 as const,
      characters: [historicalCharacter],
    };
    const source = `${JSON.stringify(v6, null, 2)}\n`;
    await writeFile(projectFile, source, 'utf8');

    const opened = await service.open(projectRoot);

    expect(opened).toMatchObject({
      sourceVersion: 6,
      migrated: true,
      project: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        characters: [{ mode: 'single-image' }],
      },
    });
    expect(await readFile(projectFile, 'utf8')).toBe(source);

    await service.save(projectRoot, opened.project);
    const reopened = await service.open(projectRoot);
    expect(reopened).toMatchObject({
      sourceVersion: PROJECT_SCHEMA_VERSION,
      migrated: false,
      project: { schemaVersion: PROJECT_SCHEMA_VERSION },
    });
  });
});
