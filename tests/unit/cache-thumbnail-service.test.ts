import {
  copyFile,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheService } from '../../src/main/services/CacheService';
import {
  ThumbnailService,
  type ThumbnailGenerator,
} from '../../src/main/services/ThumbnailService';

const fixture = path.resolve('tests/fixtures/assets/熊猫 图片.png');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'panda-cache-'));
  temporaryDirectories.push(root);
  return root;
}

class FixtureThumbnailGenerator implements ThumbnailGenerator {
  calls = 0;

  async generate(
    _sourcePath: string,
    outputPath: string,
  ): Promise<void> {
    this.calls += 1;
    await copyFile(fixture, outputPath);
  }
}

describe('thumbnail cache services', () => {
  it('binds the cache key to schema version, max edge, and asset hash', () => {
    const cache = new CacheService();
    const hash = 'b'.repeat(64);
    expect(cache.thumbnailKey(hash)).toBe(`v1-max256-${hash}.png`);
    expect(cache.thumbnailRelativePath(cache.thumbnailKey(hash))).toBe(
      `cache/asset-thumbnails/v1-max256-${hash}.png`,
    );
    expect(() => cache.thumbnailPath('D:\\project', '../escape.png')).toThrow(
      /unsafe/iu,
    );
  });

  it('creates, hits, deletes, and rebuilds a bounded thumbnail', async () => {
    const root = await projectRoot();
    const cache = new CacheService();
    const generator = new FixtureThumbnailGenerator();
    const service = new ThumbnailService(cache, generator);
    const input = {
      projectRoot: root,
      sourcePath: fixture,
      sha256: 'c'.repeat(64),
      width: 16,
      height: 12,
    };

    const created = await service.ensureThumbnail(input);
    const hit = await service.ensureThumbnail(input);
    await writeFile(
      cache.thumbnailPath(root, cache.thumbnailKey(input.sha256)),
      'corrupt cache',
    );
    const repaired = await service.ensureThumbnail(input);
    await cache.removeThumbnail(root, cache.thumbnailKey(input.sha256));
    const rebuilt = await service.ensureThumbnail(input);

    expect(created).toMatchObject({
      width: 16,
      height: 12,
      cacheHit: false,
    });
    expect(hit.cacheHit).toBe(true);
    expect(repaired.cacheHit).toBe(false);
    expect(rebuilt.cacheHit).toBe(false);
    expect(generator.calls).toBe(3);
  });

  it('cleans temporary files when an atomic cache commit fails', async () => {
    const root = await projectRoot();
    const cache = new CacheService({
      beforeCommit: () => {
        throw new Error('Injected cache commit failure.');
      },
    });
    const generator = new FixtureThumbnailGenerator();
    const service = new ThumbnailService(cache, generator);

    await expect(
      service.ensureThumbnail({
        projectRoot: root,
        sourcePath: fixture,
        sha256: 'd'.repeat(64),
        width: 16,
        height: 12,
      }),
    ).rejects.toThrow('Injected cache commit failure.');

    const entries = await readdir(
      path.join(root, 'cache', 'asset-thumbnails'),
    );
    expect(entries).toEqual([]);
  });
});
