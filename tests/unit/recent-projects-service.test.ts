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
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  RecentProjectsService,
  RecentProjectsServiceError,
} from '../../src/main/services/RecentProjectsService';

const temporaryDirectories: string[] = [];
const IDS = [
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000003',
  'd0000000-0000-4000-8000-000000000004',
];

async function harness(): Promise<{
  parent: string;
  projectRoot: string;
  configPath: string;
  projectService: ProjectService;
  recentProjects: RecentProjectsService;
}> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-day14-unit-'));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, '熊猫 项目 🐼.pandastage');
  const configPath = path.join(parent, 'app-user-data', 'recent-projects.json');
  let idIndex = 0;
  const projectService = new ProjectService({
    now: () => new Date('2026-07-24T02:00:00.000Z'),
    createId: () => IDS[idIndex++]!,
  });
  const recentProjects = new RecentProjectsService({
    configurationFilePath: configPath,
    now: () => new Date('2026-07-24T03:00:00.000Z'),
  });
  return {
    parent,
    projectRoot,
    configPath,
    projectService,
    recentProjects,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('RecentProjectsService', () => {
  it('stores application-level records, de-duplicates paths, and marks missing without deletion', async () => {
    const {
      projectRoot,
      configPath,
      projectService,
      recentProjects,
    } = await harness();
    const created = await projectService.create(projectRoot, {
      name: '第一版名称',
    });

    await recentProjects.record(created);
    await recentProjects.record({
      ...created,
      project: { ...created.project, name: '更新名称' },
      projectRoot: `${projectRoot}${path.sep}`,
    });

    expect(await recentProjects.list()).toEqual([
      expect.objectContaining({
        projectId: created.project.id,
        projectName: '更新名称',
        projectRoot: path.resolve(projectRoot),
        status: 'available',
      }),
    ]);
    expect(configPath.startsWith(projectRoot)).toBe(false);

    await rm(projectRoot, { recursive: true, force: true });
    expect(await recentProjects.list()).toEqual([
      expect.objectContaining({
        projectRoot: path.resolve(projectRoot),
        status: 'missing',
      }),
    ]);
    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as {
      entries: unknown[];
    };
    expect(persisted.entries).toHaveLength(1);
  });

  it('removes a record only through an explicit remove operation', async () => {
    const { projectRoot, projectService, recentProjects } = await harness();
    const created = await projectService.create(projectRoot, {
      name: 'Remove me',
    });
    await recentProjects.record(created);

    expect(await recentProjects.remove(projectRoot)).toEqual([]);
  });

  it('reports malformed configuration instead of silently replacing it', async () => {
    const { configPath, recentProjects } = await harness();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, '{"schemaVersion":1,', 'utf8');

    await expect(recentProjects.list()).rejects.toMatchObject({
      name: 'RecentProjectsServiceError',
      code: 'RECENT_PROJECT_CONFIG_INVALID',
    } satisfies Partial<RecentProjectsServiceError>);
  });

  it('keeps corrupt and future-schema projects as explicit invalid records', async () => {
    const { projectRoot, projectService, recentProjects } = await harness();
    const created = await projectService.create(projectRoot, {
      name: 'Invalid later',
    });
    await recentProjects.record(created);

    await writeFile(path.join(projectRoot, 'project.json'), '{broken', 'utf8');
    await expect(recentProjects.list()).resolves.toEqual([
      expect.objectContaining({ status: 'invalid' }),
    ]);

    await writeFile(
      path.join(projectRoot, 'project.json'),
      JSON.stringify({ ...created.project, schemaVersion: 99 }),
      'utf8',
    );
    await expect(recentProjects.list()).resolves.toEqual([
      expect.objectContaining({ status: 'invalid' }),
    ]);
  });

  it('marks path reuse as mismatched and refuses silent record replacement', async () => {
    const { parent, projectRoot, configPath, projectService, recentProjects } =
      await harness();
    const otherRoot = path.join(parent, 'other.pandastage');
    const first = await projectService.create(projectRoot, { name: 'A' });
    const second = await projectService.create(otherRoot, { name: 'B' });
    await recentProjects.record(first);
    await writeFile(
      path.join(projectRoot, 'project.json'),
      await readFile(path.join(otherRoot, 'project.json'), 'utf8'),
      'utf8',
    );

    await expect(recentProjects.list()).resolves.toEqual([
      expect.objectContaining({
        projectId: first.project.id,
        status: 'mismatched',
      }),
    ]);
    await expect(
      recentProjects.record({ ...second, projectRoot }),
    ).rejects.toMatchObject({ code: 'RECENT_PROJECT_MISMATCH' });
    expect(await readFile(configPath, 'utf8')).toContain(first.project.id);
    expect(await readFile(configPath, 'utf8')).not.toContain(
      second.project.id,
    );
  });
});
