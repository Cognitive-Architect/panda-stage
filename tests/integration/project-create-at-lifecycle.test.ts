import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { ProjectSchema } from '../../src/domain';
import { buildProject, IDS as FIXTURE } from '../unit/domain/testProject';

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
  it('creates an independent episode from the current template snapshot, preserving the library and skipping unrelated files', async () => {
    const parent = await newParentDirectory();
    const root = path.join(parent, '源.pandastage');
    const fs = new ProjectFileSystemService();
    await fs.createProjectTree(root);
    const fixture = buildProject();
    const disk = ProjectSchema.parse({
      ...fixture,
      assets: fixture.assets.map((asset) => ({ ...asset, relativePath: 'assets/' + asset.relativePath })),
      shots: [fixture.shots[0], { ...fixture.shots[0], id: randomUUID(), name: '镜头 2', layers: [], backgroundLayerId: null }],
    });
    const draft = ProjectSchema.parse({ ...disk, shots: disk.shots.map((shot) => ({ ...shot, name: shot.name + ' 修改' })) });
    const revision = 3;
    const projectService = new ProjectService({ fileSystem: fs,
      getCurrentProjectSnapshot: (projectRoot) => projectRoot === root ? { project: draft, revision } : null });
    await fs.writeProjectFileAtomically(root, JSON.stringify(disk));
    for (const file of ['assets/bg.png', 'assets/char.png', 'assets/unused.png', 'exports/old.mp4', 'cache/preview.png', 'recovery/autosave.json']) {
      await writeFile(path.join(root, file), file);
    }
    const saveRequest = { projectRoot: root, project: draft, revision, parentDirectory: parent, templateName: '系列' };
    await expectServiceError(projectService.saveAsTemplate({ ...saveRequest, revision: 2 }), 'PROJECT_SAVE_STALE_REVISION');
    const template = await projectService.saveAsTemplate(saveRequest);
    expect(template.projectRoot).toBe(path.join(parent, '系列.pandastage-template'));
    expect(template.project).toMatchObject({ name: '系列', shots: draft.shots,
      characters: draft.characters, subtitleStyles: draft.subtitleStyles });
    await expectServiceError(projectService.saveAsTemplate(saveRequest), 'PROJECT_ALREADY_EXISTS');
    await expectServiceError(projectService.open(template.projectRoot), 'INVALID_PROJECT_ROOT');
    await expectServiceError(projectService.createAt(parent, '源', { name: '冲突' }, template.projectRoot), 'PROJECT_ALREADY_EXISTS');
    const episode = await projectService.createAt(parent, '下一集', { name: '下一集' }, template.projectRoot);
    expect(new Set([draft.id, template.project.id, episode.project.id]).size).toBe(3);
    expect((await projectService.open(episode.projectRoot)).project).toEqual(episode.project);
    expect(episode.project).toMatchObject({ name: '下一集', shots: draft.shots,
      characters: draft.characters, subtitleStyles: draft.subtitleStyles });
    for (const copy of [template, episode]) {
      expect(await readdir(path.join(copy.projectRoot, 'assets'))).toEqual(['bg.png', 'char.png']);
      expect(await readFile(path.join(copy.projectRoot, 'assets', 'bg.png'), 'utf8')).toBe('assets/bg.png');
      expect(await readdir(path.join(copy.projectRoot, 'exports'))).toEqual([]);
      expect(await readdir(path.join(copy.projectRoot, 'cache'))).toEqual([]);
      expect(await readdir(path.join(copy.projectRoot, 'recovery'))).toEqual([]);
    }
    const originalTemplate = await readFile(template.projectFilePath, 'utf8');
    const edited = ProjectSchema.parse({ ...episode.project, shots: episode.project.shots.map((shot) => ({
      ...shot, layers: shot.layers.filter((layer) => layer.id !== FIXTURE.layerBg), backgroundLayerId: null,
    })) });
    await projectService.save(episode.projectRoot, edited);
    expect((await projectService.open(episode.projectRoot)).project).toEqual(edited);
    expect((await projectService.open(root)).project).toEqual(disk);
    expect(await readFile(template.projectFilePath, 'utf8')).toBe(originalTemplate);
  });

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
