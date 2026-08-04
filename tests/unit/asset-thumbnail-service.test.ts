import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { AssetThumbnailService } from '../../src/main/services/AssetThumbnailService';
import { CacheService } from '../../src/main/services/CacheService';
import exampleProject from '../../demo-project/project-v1.example.json';

const temporaryDirectories: string[] = [];
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, data])),
    8 + data.length,
  );
  return output;
}

function createRgbaPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function serviceWithCachedBytes(
  bytes: Buffer,
  assetIndex = 0,
) {
  const projectRoot = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-thumbnail-invalid-'),
  );
  temporaryDirectories.push(projectRoot);
  const sha256 = 'a'.repeat(64);
  const project = ProjectSchema.parse({
    ...exampleProject,
    assets: exampleProject.assets.map((asset, index) =>
      index === assetIndex ? { ...asset, sha256 } : asset,
    ),
  });
  const cache = new CacheService();
  const thumbnailPath = cache.thumbnailPath(
    projectRoot,
    cache.thumbnailKey(sha256),
  );
  await mkdir(path.dirname(thumbnailPath), { recursive: true });
  await writeFile(thumbnailPath, bytes);
  return {
    service: new AssetThumbnailService({
      cache,
      getCurrentProjectSnapshot: () => ({ project }),
    }),
    request: {
      projectRoot,
      assetId: project.assets[assetIndex]!.id,
      sha256,
    },
  };
}

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
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-thumbnail-read-'),
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
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-thumbnail-missing-'),
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

  it('lazily rebuilds a missing cache from the project asset path', async () => {
    const projectRoot = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-thumbnail-lazy-'),
    );
    temporaryDirectories.push(projectRoot);
    const sha256 = 'c'.repeat(64);
    const project = ProjectSchema.parse({
      ...exampleProject,
      assets: [
        { ...exampleProject.assets[0], sha256 },
        ...exampleProject.assets.slice(1),
      ],
    });
    const sourcePath = path.join(
      projectRoot,
      project.assets[0]!.relativePath,
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, createRgbaPng(2, 2));

    const cache = new CacheService();
    const ensureThumbnail = vi.fn().mockImplementation(
      async (input: {
        projectRoot: string;
        sourcePath: string;
        sha256: string;
        width: number;
        height: number;
      }) => {
        const cachePath = cache.thumbnailPath(
          input.projectRoot,
          cache.thumbnailKey(input.sha256),
        );
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, createRgbaPng(2, 2));
        return {
          relativePath: cache.thumbnailRelativePath(
            cache.thumbnailKey(input.sha256),
          ),
          width: 2,
          height: 2,
          cacheHit: false,
        };
      },
    );
    const service = new AssetThumbnailService({
      cache,
      getCurrentProjectSnapshot: () => ({ project }),
      thumbnailService: { ensureThumbnail },
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
    expect(ensureThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        sourcePath: path.resolve(sourcePath),
        sha256,
      }),
    );
  });

  it('treats a valid PNG signature with a truncated body as missing', async () => {
    const input = await serviceWithCachedBytes(
      Buffer.concat([PNG_SIGNATURE, Buffer.from('truncated body')]),
    );

    const response = await input.service.read(input.request);

    expect(response).toEqual({
      ok: true,
      status: 'missing',
      assetId: input.request.assetId,
    });
    expect(response).not.toHaveProperty('dataUrl');
  });

  it('treats a fully parseable PNG above the 256px cache bound as missing', async () => {
    const input = await serviceWithCachedBytes(
      createRgbaPng(257, 1),
    );

    const response = await input.service.read(input.request);

    expect(response).toEqual({
      ok: true,
      status: 'missing',
      assetId: input.request.assetId,
    });
    expect(response).not.toHaveProperty('dataUrl');
  });

  it('never serves a PNG cache entry for a non-image asset', async () => {
    const input = await serviceWithCachedBytes(
      createRgbaPng(1, 1),
      3,
    );

    await expect(input.service.read(input.request)).resolves.toEqual({
      ok: true,
      status: 'missing',
      assetId: input.request.assetId,
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
