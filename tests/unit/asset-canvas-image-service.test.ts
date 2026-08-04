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
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import { CANVAS_IMAGE_MAX_BYTES } from '../../src/shared/asset-canvas-image-api';
import { buildProject, IDS } from './domain/testProject';

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

async function createImageProject() {
  const projectRoot = await mkdtemp(
    path.join(
      process.env.RUNNER_TEMP ?? os.tmpdir(),
      'panda-canvas-image-',
    ),
  );
  temporaryDirectories.push(projectRoot);
  const bytes = createRgbaPng(4, 3);
  const sourcePath = path.join(projectRoot, 'assets', 'source.png');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const project = ProjectSchema.parse({
    ...buildProject(),
    assets: buildProject().assets.map((asset) =>
      asset.id === IDS.assetBg
        ? {
            ...asset,
            relativePath: 'assets/source.png',
            width: 4,
            height: 3,
            sha256,
          }
        : asset,
    ),
  });
  return { projectRoot, sourcePath, bytes, project, sha256 };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AssetCanvasImageService', () => {
  it('returns a structured failure for malformed requests', async () => {
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => null,
    });

    await expect(service.read({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'ASSET_CANVAS_IMAGE_INVALID_REQUEST',
        message: 'Canvas image request is invalid.',
        assetId: '(invalid)',
      },
    });
  });

  it('reads the original PNG bytes and never creates a thumbnail cache', async () => {
    const input = await createImageProject();
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    const response = await service.read({
      projectRoot: input.projectRoot,
      assetId: IDS.assetBg,
      sha256: input.sha256,
    });

    expect(response).toMatchObject({
      ok: true,
      status: 'ready',
      assetId: IDS.assetBg,
      mimeType: 'image/png',
      width: 4,
      height: 3,
      byteLength: input.bytes.byteLength,
    });
    if (!response.ok) throw new Error('canvas image fixture was not ready');
    expect(Buffer.from(response.bytes)).toEqual(input.bytes);
    expect(
      await readFile(
        path.join(
          input.projectRoot,
          'cache',
          'asset-thumbnails',
          `v1-max256-${input.sha256}.png`,
        ),
      ).catch(() => null),
    ).toBeNull();
  });

  it('deduplicates concurrent reads for the same active source', async () => {
    const input = await createImageProject();
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    const first = service.read({
      projectRoot: input.projectRoot,
      assetId: IDS.assetBg,
      sha256: input.sha256,
    });
    const second = service.read({
      projectRoot: input.projectRoot,
      assetId: IDS.assetBg,
      sha256: input.sha256,
    });

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it('returns a structured hash failure when the source changes', async () => {
    const input = await createImageProject();
    const changed = Buffer.from(input.bytes);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    await writeFile(input.sourcePath, changed);
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    await expect(
      service.read({
        projectRoot: input.projectRoot,
        assetId: IDS.assetBg,
        sha256: input.sha256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_HASH_MISMATCH' },
    });
  });

  it('returns a structured read failure for a missing source', async () => {
    const input = await createImageProject();
    await rm(input.sourcePath);
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    await expect(
      service.read({
        projectRoot: input.projectRoot,
        assetId: IDS.assetBg,
        sha256: input.sha256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });
  });

  it('keeps the IPC payload bounded for pathological source files', () => {
    expect(CANVAS_IMAGE_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});
