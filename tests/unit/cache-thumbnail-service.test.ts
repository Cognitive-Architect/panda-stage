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
  const root = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-cache-'));
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

  it('uses short, unique temporary names beside the final cache target', async () => {
    const root = await projectRoot();
    const contexts: Array<{ targetPath: string; temporaryPath: string }> = [];
    const cache = new CacheService({
      beforeWrite: ({ targetPath, temporaryPath }) => {
        contexts.push({ targetPath, temporaryPath });
      },
    });
    const service = new ThumbnailService(
      cache,
      new FixtureThumbnailGenerator(),
    );
    const hashes = ['e'.repeat(64), 'f'.repeat(64)];

    for (const sha256 of hashes) {
      await service.ensureThumbnail({
        projectRoot: root,
        sourcePath: fixture,
        sha256,
        width: 16,
        height: 12,
      });
    }

    expect(contexts).toHaveLength(2);
    const names = contexts.map(({ temporaryPath }) =>
      path.basename(temporaryPath),
    );
    expect(new Set(names).size).toBe(2);
    contexts.forEach(({ targetPath, temporaryPath }, index) => {
      const name = names[index]!;
      const sha256 = hashes[index]!;
      expect(path.dirname(temporaryPath)).toBe(path.dirname(targetPath));
      expect(name).toMatch(
        /^\.thumb-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp\.png$/u,
      );
      expect(name).toHaveLength(51);
      expect(name).not.toContain(sha256);
      expect(name).not.toContain(cache.thumbnailKey(sha256));
    });
  });

  it('shares an in-flight write for the same cache target', async () => {
    const root = await projectRoot();
    const cache = new CacheService();
    const cacheKey = cache.thumbnailKey('a'.repeat(64));
    let writerCalls = 0;
    const writeTemporary = async (temporaryPath: string) => {
      writerCalls += 1;
      await copyFile(fixture, temporaryPath);
    };

    const first = cache.ensureThumbnail(root, cacheKey, writeTemporary);
    const second = cache.ensureThumbnail(root, cacheKey, writeTemporary);
    expect(second).toBe(first);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(writerCalls).toBe(1);
    expect(secondResult).toEqual(firstResult);
    expect(await readdir(path.dirname(firstResult.filePath))).toEqual([
      cacheKey,
    ]);
  });

  it('cleans a partial temporary file after generation failure and can retry', async () => {
    const root = await projectRoot();
    const cache = new CacheService();
    let generatorCalls = 0;
    const generator: ThumbnailGenerator = {
      async generate(_sourcePath, outputPath) {
        generatorCalls += 1;
        if (generatorCalls === 1) {
          await writeFile(outputPath, 'partial thumbnail');
          throw new Error('Injected thumbnail generation failure.');
        }
        await copyFile(fixture, outputPath);
      },
    };
    const service = new ThumbnailService(cache, generator);
    const input = {
      projectRoot: root,
      sourcePath: fixture,
      sha256: 'b'.repeat(64),
      width: 16,
      height: 12,
    };
    const directory = path.join(root, 'cache', 'asset-thumbnails');

    await expect(service.ensureThumbnail(input)).rejects.toThrow(
      'Injected thumbnail generation failure.',
    );
    expect(await readdir(directory)).toEqual([]);

    const retried = await service.ensureThumbnail(input);
    expect(retried.cacheHit).toBe(false);
    expect(generatorCalls).toBe(2);
    expect(await readdir(directory)).toEqual([
      cache.thumbnailKey(input.sha256),
    ]);
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
