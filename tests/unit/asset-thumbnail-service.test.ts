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

async function serviceWithRepair(options?: {
  relativePath?: string;
  sourceExists?: boolean;
  cachedBytes?: Buffer;
}) {
  const projectRoot = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-thumbnail-repair-'),
  );
  temporaryDirectories.push(projectRoot);
  const sourceBytes = createRgbaPng(2, 2);
  const relativePath = options?.relativePath ?? 'assets/source.png';
  const sourcePath = path.join(projectRoot, relativePath);
  if (options?.sourceExists !== false) {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, sourceBytes);
  }
  const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const project = ProjectSchema.parse({
    ...exampleProject,
    assets: [
      {
        ...exampleProject.assets[0],
        relativePath,
        width: 2,
        height: 2,
        sha256,
      },
      ...exampleProject.assets.slice(1),
    ],
  });
  const cache = new CacheService();
  if (options?.cachedBytes) {
    const thumbnailPath = cache.thumbnailPath(
      projectRoot,
      cache.thumbnailKey(sha256),
    );
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, options.cachedBytes);
  }
  const ensureThumbnail = vi.fn().mockImplementation(async (input: {
    projectRoot: string;
    sha256: string;
  }) => {
    const thumbnailPath = cache.thumbnailPath(
      input.projectRoot,
      cache.thumbnailKey(input.sha256),
    );
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, createRgbaPng(2, 2));
    return {
      relativePath: cache.thumbnailRelativePath(
        cache.thumbnailKey(input.sha256),
      ),
      width: 2,
      height: 2,
      cacheHit: false,
    };
  });
  const service = new AssetThumbnailService({
    cache,
    getCurrentProjectSnapshot: () => ({ project }),
    thumbnailService: { ensureThumbnail },
  });
  return {
    service,
    projectRoot,
    sourcePath,
    project,
    cache,
    ensureThumbnail,
    request: {
      projectRoot,
      assetId: project.assets[0]!.id,
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

  it('regenerates a missing or corrupt cache from the authoritative asset path', async () => {
    const input = await serviceWithRepair({
      cachedBytes: Buffer.alloc(6_000_001),
    });
    const before = structuredClone(input.project);

    await expect(input.service.read(input.request)).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
    });
    expect(input.ensureThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: input.projectRoot,
        sourcePath: path.resolve(input.sourcePath),
        sha256: input.request.sha256,
        width: 2,
        height: 2,
      }),
    );
    expect(input.project).toEqual(before);
  });

  it('does not repair a valid cache and rejects missing or confined source paths', async () => {
    const valid = await serviceWithRepair({
      cachedBytes: createRgbaPng(2, 2),
    });
    await expect(valid.service.read(valid.request)).resolves.toMatchObject({
      ok: true,
      status: 'ready',
    });
    expect(valid.ensureThumbnail).not.toHaveBeenCalled();

    const missing = await serviceWithRepair({ sourceExists: false });
    await expect(missing.service.read(missing.request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_THUMBNAIL_READ_FAILED' },
    });
    expect(missing.ensureThumbnail).not.toHaveBeenCalled();

    const sibling = await serviceWithRepair({
      relativePath: 'assets2/source.png',
    });
    await expect(sibling.service.read(sibling.request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_THUMBNAIL_READ_FAILED' },
    });
    expect(sibling.ensureThumbnail).not.toHaveBeenCalled();
  });

  it('returns the structured thumbnail error when regeneration fails', async () => {
    const input = await serviceWithRepair();
    input.ensureThumbnail.mockRejectedValue(new Error('generator failed'));

    await expect(input.service.read(input.request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_THUMBNAIL_READ_FAILED' },
    });
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
