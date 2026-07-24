import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetImportFileSystemService } from '../../src/main/services/AssetImportFileSystemService';
import { AssetImportService } from '../../src/main/services/AssetImportService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import { ProjectService } from '../../src/main/services/ProjectService';

const fixtureDirectory = path.resolve('tests/fixtures/assets');
const temporaryDirectories: string[] = [];
const IDS = Array.from(
  { length: 40 },
  (_, index) =>
    `16000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function hash(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function harness(): Promise<{
  parent: string;
  projectRoot: string;
  projectService: ProjectService;
  assetImportService: AssetImportService;
  created: Awaited<ReturnType<ProjectService['create']>>;
  nextId: () => string;
}> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-assets-'));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(
    parent,
    '素材 项目 中文 🐼.pandastage',
  );
  let idIndex = 0;
  const nextId = () => IDS[idIndex++]!;
  const projectService = new ProjectService({
    createId: nextId,
    now: () => new Date('2026-07-24T09:00:00.000Z'),
  });
  const created = await projectService.create(projectRoot, {
    name: 'Day 16 素材项目',
  });
  const assetImportService = new AssetImportService({
    projectService,
    createId: nextId,
    now: () => new Date('2026-07-24T09:10:00.000Z'),
  });
  return {
    parent,
    projectRoot,
    projectService,
    assetImportService,
    created,
    nextId,
  };
}

async function externalCopy(
  parent: string,
  fixtureName: string,
  targetName = fixtureName,
  subdirectory = '外部 素材 🐼',
): Promise<string> {
  const directory = path.join(parent, subdirectory);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, targetName);
  await copyFile(path.join(fixtureDirectory, fixtureName), target);
  return target;
}

describe('asset import integration', () => {
  it('imports PNG, JPG, MP3, and WAV, saves relative records, and survives source deletion', async () => {
    const {
      parent,
      projectRoot,
      projectService,
      assetImportService,
      created,
    } = await harness();
    const sources = await Promise.all([
      externalCopy(parent, '熊猫 图片.png'),
      externalCopy(parent, '熊猫 照片.jpg'),
      externalCopy(parent, '熊猫 声音.mp3'),
      externalCopy(parent, '熊猫 声音.wav'),
    ]);
    const mimeTypes = [
      'image/png',
      'image/jpeg',
      'audio/mpeg',
      'audio/wav',
    ];

    const operation = await assetImportService.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: sources.map((sourcePath, index) => ({
        sourcePath,
        declaredMimeType: mimeTypes[index]!,
      })),
    });

    expect(operation.results.map(({ status }) => status)).toEqual([
      'imported',
      'imported',
      'imported',
      'imported',
    ]);
    expect(operation.savedRevision).toBe(1);
    expect(operation.project.assets).toHaveLength(4);
    expect(
      operation.project.assets.every(
        (asset) =>
          asset.relativePath.startsWith('assets/') &&
          !path.isAbsolute(asset.relativePath) &&
          !asset.relativePath.includes('..'),
      ),
    ).toBe(true);
    expect(
      operation.project.assets
        .filter((asset) => asset.kind === 'audio')
        .every((asset) => asset.durationMs === undefined),
    ).toBe(true);

    await Promise.all(sources.map((source) => rm(source)));
    for (const asset of operation.project.assets) {
      await expect(
        readFile(path.join(projectRoot, asset.relativePath)),
      ).resolves.toBeInstanceOf(Buffer);
    }
    expect((await projectService.open(projectRoot)).project.assets).toEqual(
      operation.project.assets,
    );
  });

  it('reuses hash duplicates without copying a second file or asset', async () => {
    const { parent, projectRoot, assetImportService, created } =
      await harness();
    const source = await externalCopy(parent, '熊猫 图片.png');
    const first = await assetImportService.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [
        { sourcePath: source, declaredMimeType: 'image/png' },
        { sourcePath: source, declaredMimeType: 'image/png' },
      ],
    });

    expect(first.results.map(({ status }) => status)).toEqual([
      'imported',
      'duplicate',
    ]);
    expect(first.results[1]?.duplicateOfAssetId).toBe(
      first.results[0]?.asset?.id,
    );
    expect(first.project.assets).toHaveLength(1);
    expect(
      (await readdir(path.join(projectRoot, 'assets'))).filter(
        (name) => !name.endsWith('.tmp'),
      ),
    ).toHaveLength(1);

    const second = await assetImportService.importCandidates({
      projectRoot,
      project: first.project,
      baseRevision: first.savedRevision,
      candidates: [
        { sourcePath: source, declaredMimeType: 'image/png' },
      ],
    });
    expect(second.projectChanged).toBe(false);
    expect(second.results[0]?.status).toBe('duplicate');
    expect(second.project.assets).toHaveLength(1);
  });

  it('keeps same-name different-content assets with a deterministic hash suffix', async () => {
    const { parent, projectRoot, assetImportService, created } =
      await harness();
    const first = await externalCopy(
      parent,
      '熊猫 图片.png',
      '同名 图片.png',
      '来源 A',
    );
    const second = await externalCopy(
      parent,
      '另一张 图片.png',
      '同名 图片.png',
      '来源 B',
    );

    const operation = await assetImportService.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [first, second].map((sourcePath) => ({
        sourcePath,
        declaredMimeType: 'image/png',
      })),
    });

    const relativePaths = operation.project.assets.map(
      ({ relativePath }) => relativePath,
    );
    expect(relativePaths[0]).toBe('assets/同名 图片.png');
    expect(relativePaths[1]).toMatch(
      /^assets\/同名 图片-[0-9a-f]{8}\.png$/u,
    );
    expect(new Set(relativePaths).size).toBe(2);
    const copiedHashes = await Promise.all(
      relativePaths.map((relativePath) =>
        hash(path.join(projectRoot, relativePath)),
      ),
    );
    expect(copiedHashes).toHaveLength(2);
    expect(new Set(copiedHashes).size).toBe(2);
  });

  it('rejects unsupported, disguised, mismatched, and unreadable sources without saving', async () => {
    const { parent, projectRoot, assetImportService, created } =
      await harness();
    const unsupported = await externalCopy(parent, '不支持 素材.txt');
    const disguised = await externalCopy(parent, '伪装 图片.png');
    const validPng = await externalCopy(parent, '熊猫 图片.png');
    const missing = path.join(parent, '不存在.wav');
    const projectFile = path.join(projectRoot, 'project.json');
    const beforeHash = await hash(projectFile);

    const operation = await assetImportService.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [
        { sourcePath: unsupported, declaredMimeType: 'text/plain' },
        { sourcePath: disguised, declaredMimeType: 'image/png' },
        { sourcePath: validPng, declaredMimeType: 'image/jpeg' },
        { sourcePath: missing, declaredMimeType: 'audio/wav' },
      ],
    });

    expect(operation.results.map(({ code }) => code)).toEqual([
      'ASSET_IMPORT_UNSUPPORTED_TYPE',
      'ASSET_IMPORT_INVALID_CONTENT',
      'ASSET_IMPORT_DECLARED_TYPE_MISMATCH',
      'ASSET_IMPORT_SOURCE_UNREADABLE',
    ]);
    expect(operation.results.every(({ status }) => status === 'rejected')).toBe(
      true,
    );
    expect(operation.projectChanged).toBe(false);
    expect(await hash(projectFile)).toBe(beforeHash);
    expect(await readdir(path.join(projectRoot, 'assets'))).toEqual([]);
  });

  it('leaves project JSON and assets unchanged when the copy fails', async () => {
    const { parent, projectRoot, projectService, created, nextId } =
      await harness();
    const source = await externalCopy(parent, '熊猫 图片.png');
    const beforeHash = await hash(path.join(projectRoot, 'project.json'));
    const service = new AssetImportService({
      projectService,
      createId: nextId,
      fileSystem: new AssetImportFileSystemService({
        afterTemporarySync: () => {
          throw Object.assign(new Error('Injected copy fault.'), {
            code: 'EIO',
          });
        },
      }),
    });

    const operation = await service.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [
        { sourcePath: source, declaredMimeType: 'image/png' },
      ],
    });

    expect(operation.results[0]).toMatchObject({
      status: 'failed',
      code: 'ASSET_IMPORT_COPY_FAILED',
    });
    expect(operation.project.assets).toEqual([]);
    expect(await hash(path.join(projectRoot, 'project.json'))).toBe(
      beforeHash,
    );
    expect(await readdir(path.join(projectRoot, 'assets'))).toEqual([]);
  });

  it('revalidates committed bytes and rolls back a corrupted copy', async () => {
    const {
      parent,
      projectRoot,
      projectService,
      created,
      nextId,
    } = await harness();
    const source = await externalCopy(parent, '熊猫 图片.png');
    const projectFile = path.join(projectRoot, 'project.json');
    const beforeHash = await hash(projectFile);
    const service = new AssetImportService({
      projectService,
      createId: nextId,
      fileSystem: new AssetImportFileSystemService({
        beforeFinalize: async ({ temporaryPath }) => {
          await writeFile(temporaryPath, 'corrupted after validation');
        },
      }),
    });

    const operation = await service.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [
        { sourcePath: source, declaredMimeType: 'image/png' },
      ],
    });

    expect(operation.projectChanged).toBe(false);
    expect(operation.project.assets).toHaveLength(0);
    expect(operation.results[0]).toMatchObject({
      status: 'failed',
      code: 'ASSET_IMPORT_COPY_FAILED',
    });
    expect(await hash(projectFile)).toBe(beforeHash);
    expect(await readdir(path.join(projectRoot, 'assets'))).toEqual([]);
  });

  it('rolls back the new file and model when atomic project save fails', async () => {
    const { parent, projectRoot, created, nextId } = await harness();
    const source = await externalCopy(parent, '熊猫 图片.png');
    const projectFile = path.join(projectRoot, 'project.json');
    const beforeHash = await hash(projectFile);
    const failingProjectService = new ProjectService({
      fileSystem: new ProjectFileSystemService({
        afterTemporarySync: () => {
          throw Object.assign(new Error('Injected save fault.'), {
            code: 'EIO',
          });
        },
      }),
    });
    const service = new AssetImportService({
      projectService: failingProjectService,
      createId: nextId,
    });

    const operation = await service.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: [
        { sourcePath: source, declaredMimeType: 'image/png' },
      ],
    });

    expect(operation.results[0]).toMatchObject({
      status: 'failed',
      code: 'ASSET_IMPORT_SAVE_FAILED',
      asset: null,
    });
    expect(operation.project.assets).toEqual([]);
    expect(await hash(projectFile)).toBe(beforeHash);
    expect(await readdir(path.join(projectRoot, 'assets'))).toEqual([]);
  });
});
