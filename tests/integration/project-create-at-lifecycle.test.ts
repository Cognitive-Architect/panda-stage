import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME,
  ProjectFileSystemService,
} from '../../src/main/services/ProjectFileSystemService';
import {
  ProjectService,
  ProjectServiceError,
} from '../../src/main/services/ProjectService';

const FIXED_NOW = '2026-07-23T12:00:00.000Z';
const IDS = [
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000004',
];
const temporaryParents: string[] = [];

function service(): ProjectService {
  let idIndex = 0;
  return new ProjectService({
    fileSystem: new ProjectFileSystemService(),
    now: () => new Date(FIXED_NOW),
    createId: () => IDS[idIndex++ % IDS.length]!,
  });
}

async function newParentDirectory(): Promise<string> {
  const parent = await mkdtemp(
    path.join(
      process.env.RUNNER_TEMP ?? os.tmpdir(),
      'panda-stage-create-at-',
    ),
  );
  temporaryParents.push(parent);
  return parent;
}

async function expectServiceError(
  promise: Promise<unknown>,
  code: ProjectServiceError['code'],
): Promise<ProjectServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).code).toBe(code);
    return error as ProjectServiceError;
  }
  throw new Error(`Expected ProjectServiceError ${code}.`);
}

afterEach(async () => {
  await Promise.all(
    temporaryParents
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('secure project creation from a parent directory and a name', () => {
  it('joins the parent directory with the name and writes the full project tree', async () => {
    const parentDirectory = await newParentDirectory();
    const projectName = '熊猫 项目 with spaces 🐼';

    const created = await service().createAt(parentDirectory, projectName, {
      name: '熊猫短片',
    });

    const expectedRoot = path.resolve(
      path.join(parentDirectory, `${projectName}.pandastage`),
    );
    expect(created.projectRoot).toBe(expectedRoot);
    expect(created.projectFilePath).toBe(
      path.join(expectedRoot, PROJECT_FILE_NAME),
    );
    expect((await readdir(expectedRoot)).sort()).toEqual(
      [...PROJECT_DIRECTORIES, PROJECT_FILE_NAME].sort(),
    );
    expect(created.project.name).toBe('熊猫短片');
    expect(created.migrated).toBe(false);
    const serialized = JSON.parse(
      await readFile(created.projectFilePath, 'utf8'),
    ) as { name: string; shots: unknown[] };
    expect(serialized.name).toBe('熊猫短片');
    expect(serialized.shots).toEqual([]);
    expect((await readdir(parentDirectory)).sort()).toEqual([
      `${projectName}.pandastage`,
    ]);
  });

  it('rejects a duplicate project name without overwriting or leaving debris', async () => {
    const parentDirectory = await newParentDirectory();
    const created = await service().createAt(parentDirectory, '重名项目', {
      name: '第一个',
    });
    const beforeHash = createHash('sha256')
      .update(await readFile(created.projectFilePath, 'utf8'))
      .digest('hex');

    const error = await expectServiceError(
      service().createAt(parentDirectory, '重名项目', { name: '第二个' }),
      'PROJECT_ALREADY_EXISTS',
    );

    expect(error.projectRoot).toBe(created.projectRoot);
    expect(
      createHash('sha256')
        .update(await readFile(created.projectFilePath, 'utf8'))
        .digest('hex'),
    ).toBe(beforeHash);
    expect(
      (JSON.parse(await readFile(created.projectFilePath, 'utf8')) as {
        name: string;
      }).name,
    ).toBe('第一个');
    expect(await readdir(parentDirectory)).toEqual(['重名项目.pandastage']);
  });

  it('refuses names that would escape the selected parent directory', async () => {
    const parentDirectory = await newParentDirectory();

    for (const projectName of [
      '..',
      '.',
      `..${path.sep}逃逸`,
      '子目录/逃逸',
      '子目录\\逃逸',
      '',
      '   ',
      '项目.',
      '项目.pandastage',
      'CON',
    ]) {
      await expectServiceError(
        service().createAt(parentDirectory, projectName, { name: '逃逸' }),
        'INVALID_PROJECT_ROOT',
      );
    }

    expect(await readdir(parentDirectory)).toEqual([]);
    expect(
      await readdir(path.dirname(parentDirectory)),
    ).not.toContain('逃逸.pandastage');
  });

  it('refuses an empty parent directory before touching the disk', async () => {
    await expectServiceError(
      service().createAt('   ', '项目', { name: '项目' }),
      'INVALID_PROJECT_ROOT',
    );
  });

  it('produces a project root the existing open path can reload', async () => {
    const parentDirectory = await newParentDirectory();
    const created = await service().createAt(parentDirectory, '可重开项目', {
      name: '可重开项目',
    });

    const reopened = await service().open(created.projectRoot);

    expect(reopened.projectRoot).toBe(created.projectRoot);
    expect(reopened.project).toEqual(created.project);
    expect(reopened.migrated).toBe(false);
  });
});
