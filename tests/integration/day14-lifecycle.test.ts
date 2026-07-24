import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutosaveService,
  type AutosaveClock,
} from '../../src/main/services/AutosaveService';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecentProjectsService } from '../../src/main/services/RecentProjectsService';
import { RecoveryService } from '../../src/main/services/RecoveryService';

const temporaryDirectories: string[] = [];
const IDS = [
  'e0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002',
];
const inertClock: AutosaveClock = {
  setInterval: () =>
    1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => undefined,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Day 14 complete moved-project lifecycle', () => {
  it('retains a missing recent record, relocates the moved project, recovery, and relative asset', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-day14-real-'));
    temporaryDirectories.push(parent);
    const oldRoot = path.join(
      parent,
      '原项目 中文 空格 🐼.pandastage',
    );
    const movedRoot = path.join(
      parent,
      '移动后 项目 🚚.pandastage',
    );
    const configPath = path.join(
      parent,
      'app-user-data',
      'recent-projects.json',
    );
    let idIndex = 0;
    const projectService = new ProjectService({
      now: () => new Date('2026-07-24T04:00:00.000Z'),
      createId: () => IDS[idIndex++]!,
    });
    const recentProjects = new RecentProjectsService({
      configurationFilePath: configPath,
      now: () => new Date('2026-07-24T05:00:00.000Z'),
    });
    const recoveryService = new RecoveryService({
      nowMs: () => 4_102_444_800_000,
    });
    const created = await projectService.create(oldRoot, {
      name: '移动测试项目',
    });
    const relativeAssetPath = 'assets/角色 image 🐼.png';
    await writeFile(
      path.join(oldRoot, relativeAssetPath),
      'portable-asset',
      'utf8',
    );
    const savedProject = {
      ...created.project,
      assets: [
        {
          id: 'e0000000-0000-4000-8000-000000000003',
          kind: 'image' as const,
          name: '角色',
          relativePath: relativeAssetPath,
          mimeType: 'image/png',
          width: 256,
          height: 256,
        },
      ],
    };
    const saved = await projectService.save(oldRoot, savedProject);
    await recentProjects.record(saved);
    const autosave = new AutosaveService({
      recoveryService,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: oldRoot,
      project: savedProject,
      dirty: false,
      revision: 1,
    });
    const recoveredProject = {
      ...savedProject,
      name: '移动前未保存恢复',
    };
    autosave.update({
      projectRoot: oldRoot,
      project: recoveredProject,
      dirty: true,
      revision: 2,
    });
    await autosave.tick(oldRoot);
    await autosave.stop(oldRoot);

    await rename(oldRoot, movedRoot);

    await expect(access(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await recentProjects.list()).toEqual([
      expect.objectContaining({
        projectRoot: path.resolve(oldRoot),
        status: 'missing',
      }),
    ]);
    const reopened = await projectService.open(movedRoot);
    expect(reopened.project.assets[0]?.relativePath).toBe(
      relativeAssetPath,
    );
    expect(
      await readFile(path.join(movedRoot, relativeAssetPath), 'utf8'),
    ).toBe('portable-asset');
    expect(
      (
        await recoveryService.detectLatest(
          movedRoot,
          reopened.project,
        )
      )?.project.name,
    ).toBe('移动前未保存恢复');

    const entries = await recentProjects.relocate(oldRoot, reopened);

    expect(entries).toEqual([
      expect.objectContaining({
        projectId: created.project.id,
        projectRoot: path.resolve(movedRoot),
        status: 'available',
      }),
    ]);
    expect(
      reopened.project.assets[0]?.relativePath.startsWith('assets/'),
    ).toBe(true);
    expect(
      reopened.project.assets[0]?.relativePath.includes(movedRoot),
    ).toBe(false);
    expect(configPath.startsWith(movedRoot)).toBe(false);
    expect(
      JSON.parse(await readFile(configPath, 'utf8')),
    ).toMatchObject({
      entries: [{ projectRoot: path.resolve(movedRoot) }],
    });
    console.info(
      `DAY14_RELOCATION_EVIDENCE oldMissing=true movedRoot=${path.basename(movedRoot)} relativeAsset=${relativeAssetPath} recoveryRestored=true recentStatus=available`,
    );
  });

  it('rejects relocating a missing record to a different project identity', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-day14-id-'));
    temporaryDirectories.push(parent);
    const configPath = path.join(parent, 'user-data', 'recent.json');
    const firstRoot = path.join(parent, 'first.pandastage');
    const secondRoot = path.join(parent, 'second.pandastage');
    await mkdir(path.dirname(configPath), { recursive: true });
    let idIndex = 0;
    const projects = new ProjectService({
      createId: () =>
        [
          'f0000000-0000-4000-8000-000000000001',
          'f0000000-0000-4000-8000-000000000002',
          'f0000000-0000-4000-8000-000000000003',
          'f0000000-0000-4000-8000-000000000004',
        ][idIndex++]!,
    });
    const recent = new RecentProjectsService({
      configurationFilePath: configPath,
    });
    const first = await projects.create(firstRoot, { name: 'First' });
    const second = await projects.create(secondRoot, { name: 'Second' });
    await recent.record(first);
    await rm(firstRoot, { recursive: true, force: true });

    await expect(recent.relocate(firstRoot, second)).rejects.toMatchObject({
      code: 'RECENT_PROJECT_MISMATCH',
    });
    expect(await recent.list()).toEqual([
      expect.objectContaining({
        projectId: first.project.id,
        projectRoot: path.resolve(firstRoot),
        status: 'missing',
      }),
    ]);
  });
});
