import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import { applyAssetDeleteResponse } from '../../src/renderer/features/assets/applyAssetDeleteResponse';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { AssetDeleteService } from '../../src/main/services/AssetDeleteService';
import {
  AssetDeleteFileSystemService,
  type AssetDeleteFileSystemFaultInjector,
} from '../../src/main/services/AssetDeleteFileSystemService';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import { CacheService } from '../../src/main/services/CacheService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import { ProjectOperationCoordinator } from '../../src/main/services/ProjectOperationCoordinator';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecoveryService } from '../../src/main/services/RecoveryService';

const temporaryDirectories: string[] = [];
const fixturePath = path.resolve(
  'tests/fixtures/assets/熊猫 图片.png',
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function noTimerClock() {
  return {
    setInterval: () => ({}) as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function recoveryHashes(projectRoot: string): Promise<string[]> {
  const directory = path.join(projectRoot, 'recovery');
  const names = await readdir(directory);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.recovery.json'))
      .sort()
      .map((name) => sha256(path.join(directory, name))),
  );
}

async function createHarness(
  options: {
    referenced?: boolean;
    deleteFaults?: AssetDeleteFileSystemFaultInjector;
  } = {},
) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-delete-'));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, '安全 删除 🐼.pandastage');
  const coordinator = new ProjectOperationCoordinator();
  const recoveryService = new RecoveryService({ nowMs: () => 3_000 });
  const autosaveHolder: { current?: AutosaveService } = {};
  const failProjectSave = { current: false };
  const projectService = new ProjectService({
    coordinator,
    fileSystem: new ProjectFileSystemService({
      beforeAtomicReplace: () => {
        if (failProjectSave.current) {
          throw new Error('Injected project save failure.');
        }
      },
    }),
    onProjectSaved: async (root, project, revision) => {
      await recoveryService.cleanupAfterFormalSave(root, project.id);
      if (revision !== undefined) {
        autosaveHolder.current?.markFormalSaved(
          root,
          project,
          revision,
        );
      }
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'Asset delete safety',
  });
  const assetPath = path.join(projectRoot, 'assets', '待删除 图片.png');
  await copyFile(fixturePath, assetPath);
  const hash = await sha256(assetPath);
  const asset = {
    id: randomUUID(),
    name: '待删除 图片',
    relativePath: 'assets/待删除 图片.png',
    mimeType: 'image/png',
    kind: 'image' as const,
    width: 16,
    height: 12,
    sha256: hash,
  };
  const project = ProjectSchema.parse({
    ...created.project,
    assets: [asset],
    shots: options.referenced
      ? [
          {
            id: randomUUID(),
            name: '引用素材的镜头',
            durationMs: 3_000,
            defaultSubtitleStyleId:
              created.project.subtitleStyles[0]!.id,
            layers: [
              {
                id: randomUUID(),
                name: '背景',
                source: { kind: 'asset', assetId: asset.id },
                anchor: 'center',
                x: 960,
                y: 540,
                scaleX: 1,
                scaleY: 1,
                rotationDeg: 0,
                opacity: 1,
                visible: true,
                zIndex: 0,
              },
            ],
            dialogues: [],
            audioClips: [],
            timelineEvents: [],
          },
        ]
      : [],
  });
  await projectService.save(projectRoot, project, 1);
  const cache = new CacheService();
  const cachePath = cache.thumbnailPath(
    projectRoot,
    cache.thumbnailKey(hash),
  );
  await mkdir(path.dirname(cachePath), { recursive: true });
  await copyFile(fixturePath, cachePath);

  const autosaveService = new AutosaveService({
    recoveryService,
    coordinator,
    clock: noTimerClock(),
  });
  autosaveHolder.current = autosaveService;
  const revision3 = ProjectSchema.parse({
    ...project,
    name: 'Revision 3 dirty',
  });
  autosaveService.track({
    projectRoot,
    project: revision3,
    revision: 3,
    dirty: true,
  });
  await autosaveService.tick(projectRoot);
  const deleteService = new AssetDeleteService({
    projectService,
    getCurrentProjectSnapshot: (root) =>
      autosaveService.getProjectSnapshot(root),
    fileSystem: new AssetDeleteFileSystemService(
      options.deleteFaults,
    ),
    cache,
    now: () => new Date('2026-07-25T03:00:00.000Z'),
  });
  return {
    projectRoot,
    projectService,
    autosaveService,
    deleteService,
    revision3,
    asset,
    assetPath,
    cachePath,
    failProjectSave,
  };
}

function request(
  input: Awaited<ReturnType<typeof createHarness>>,
  project: Project = input.revision3,
  baseRevision = 3,
) {
  return {
    projectRoot: input.projectRoot,
    project,
    baseRevision,
    assetId: input.asset.id,
  };
}

async function state(
  input: Awaited<ReturnType<typeof createHarness>>,
) {
  return {
    projectHash: await sha256(
      path.join(input.projectRoot, 'project.json'),
    ),
    recoveryHashes: await recoveryHashes(input.projectRoot),
    assetHash: await sha256(input.assetPath),
    cacheHash: await sha256(input.cachePath),
  };
}

describe('asset delete integration', () => {
  it('deletes an unreferenced asset, thumbnail cache, model record, recovery, and syncs revision 4', async () => {
    const input = await createHarness();
    const editor = new EditorProjectStore();
    editor.open(input.projectRoot, {
      ...input.revision3,
      name: 'Revision 0',
    });
    editor.updateProject({ ...input.revision3, name: 'Revision 1' });
    editor.updateProject({ ...input.revision3, name: 'Revision 2' });
    editor.updateProject(input.revision3);

    const operation = await input.deleteService.deleteAsset(request(input));
    const outcome = applyAssetDeleteResponse(
      { ok: true, ...operation },
      editor,
    );

    expect(outcome.applied).toBe(true);
    expect(operation).toMatchObject({
      baseRevision: 3,
      savedRevision: 4,
      deletedAssetId: input.asset.id,
      cleanupResidualPaths: [],
      project: { assets: [] },
    });
    expect(await exists(input.assetPath)).toBe(false);
    expect(await exists(input.cachePath)).toBe(false);
    expect(
      (await input.projectService.open(input.projectRoot)).project.assets,
    ).toEqual([]);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({ revision: 4, dirty: false });
    expect(editor.getSnapshot()).toMatchObject({
      revision: 4,
      dirty: false,
      project: { assets: [] },
    });
    expect(await recoveryHashes(input.projectRoot)).toEqual([]);
  });

  it('blocks a referenced background and reports its exact location without touching state', async () => {
    const input = await createHarness({ referenced: true });
    const before = await state(input);
    await expect(
      input.deleteService.deleteAsset(request(input)),
    ).rejects.toMatchObject({
      code: 'ASSET_DELETE_REFERENCED',
      references: [
        expect.objectContaining({
          kind: 'shot-background',
          path: 'shots[0].layers[0].source.assetId',
        }),
      ],
    });
    expect(await state(input)).toEqual(before);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({ revision: 3, dirty: true });
  });

  it('rolls the asset file back when cache staging fails', async () => {
    const input = await createHarness({
      deleteFaults: {
        beforeStage: (_filePath, kind) => {
          if (kind === 'thumbnail') {
            throw new Error('Injected cache stage failure.');
          }
        },
      },
    });
    const before = await state(input);
    await expect(
      input.deleteService.deleteAsset(request(input)),
    ).rejects.toMatchObject({ code: 'ASSET_DELETE_FAILED' });
    expect(await state(input)).toEqual(before);
    expect(
      (await input.projectService.open(input.projectRoot)).project.assets,
    ).toHaveLength(1);
  });

  it('restores asset and cache when atomic project save fails', async () => {
    const input = await createHarness();
    const before = await state(input);
    input.failProjectSave.current = true;
    await expect(
      input.deleteService.deleteAsset(request(input)),
    ).rejects.toMatchObject({ code: 'ASSET_DELETE_FAILED' });
    expect(await state(input)).toEqual(before);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({ revision: 3, dirty: true });
  });

  it('rejects stale revision before moving any file', async () => {
    const input = await createHarness();
    const before = await state(input);
    await expect(
      input.deleteService.deleteAsset(request(input, input.revision3, 2)),
    ).rejects.toMatchObject({
      code: 'ASSET_DELETE_STALE_REVISION',
      currentRevision: 3,
    });
    expect(await state(input)).toEqual(before);
  });
});
