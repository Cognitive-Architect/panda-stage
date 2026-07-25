import { createHash } from 'node:crypto';
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
import { ProjectSchema } from '../../src/domain';
import { AssetThumbnailService } from '../../src/main/services/AssetThumbnailService';
import { CacheService } from '../../src/main/services/CacheService';
import exampleProject from '../../demo-project/project-v1.example.json';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AssetThumbnailService', () => {
  it('reads only the hash-addressed cache PNG as a data URL', async () => {
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), 'panda-thumbnail-read-'),
    );
    temporaryDirectories.push(projectRoot);
    const bytes = await readFile('tests/fixtures/assets/熊猫 图片.png');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const project = ProjectSchema.parse({
      ...exampleProject,
      assets: [
        {
          ...exampleProject.assets[0],
          sha256,
        },
        ...exampleProject.assets.slice(1),
      ],
    });
    const cache = new CacheService();
    const cacheKey = cache.thumbnailKey(sha256);
    const thumbnailPath = cache.thumbnailPath(projectRoot, cacheKey);
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, bytes);
    const service = new AssetThumbnailService({
      cache,
      getCurrentProjectSnapshot: () => ({ project }),
    });

    await expect(
      service.read({
        projectRoot,
        assetId: project.assets[0]!.id,
        sha256,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
    });
  });

  it('returns a rebuildable missing state for absent or corrupt cache', async () => {
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), 'panda-thumbnail-missing-'),
    );
    temporaryDirectories.push(projectRoot);
    const sha256 = 'a'.repeat(64);
    const project = ProjectSchema.parse({
      ...exampleProject,
      assets: [
        { ...exampleProject.assets[0], sha256 },
        ...exampleProject.assets.slice(1),
      ],
    });
    const service = new AssetThumbnailService({
      getCurrentProjectSnapshot: () => ({ project }),
    });

    await expect(
      service.read({
        projectRoot,
        assetId: project.assets[0]!.id,
        sha256,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'missing',
      assetId: project.assets[0]!.id,
    });
  });

  it('rejects a hash that no longer matches the Main snapshot', async () => {
    const project = ProjectSchema.parse({
      ...exampleProject,
      assets: [
        { ...exampleProject.assets[0], sha256: 'a'.repeat(64) },
        ...exampleProject.assets.slice(1),
      ],
    });
    const service = new AssetThumbnailService({
      getCurrentProjectSnapshot: () => ({ project }),
    });
    await expect(
      service.read({
        projectRoot: 'D:\\project.pandastage',
        assetId: project.assets[0]!.id,
        sha256: 'b'.repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_THUMBNAIL_HASH_MISMATCH' },
    });
  });
});
