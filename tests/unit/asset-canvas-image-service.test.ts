import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import { AssetCanvasImageService } from '../../src/main/services/AssetCanvasImageService';
import type { MediaInspectionService } from '../../src/main/services/MediaInspectionService';
import {
  CANVAS_IMAGE_MAX_BYTES,
} from '../../src/shared/asset-canvas-image-api';
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

function imageAsset(
  base: Project,
  input: {
    relativePath: string;
    mimeType: 'image/png' | 'image/jpeg';
    width: number;
    height: number;
    sha256: string;
  },
): Project {
  return ProjectSchema.parse({
    ...base,
    assets: base.assets.map((asset) =>
      asset.id === IDS.assetBg ? { ...asset, ...input } : asset,
    ),
  });
}

async function createPngProject(options?: {
  writeSource?: boolean;
  relativePath?: string;
  width?: number;
  height?: number;
  mimeType?: 'image/png' | 'image/jpeg';
  bytes?: Buffer;
}) {
  const projectRoot = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-canvas-image-'),
  );
  temporaryDirectories.push(projectRoot);
  const bytes = options?.bytes ?? createRgbaPng(4, 3);
  const relativePath = options?.relativePath ?? 'assets/source.png';
  const sourcePath = path.join(projectRoot, relativePath);
  if (options?.writeSource !== false) {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, bytes);
  }
  const project = imageAsset(buildProject(), {
    relativePath,
    mimeType: options?.mimeType ?? 'image/png',
    width: options?.width ?? 4,
    height: options?.height ?? 3,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  return {
    projectRoot,
    sourcePath,
    bytes,
    project,
    assetId: IDS.assetBg,
    sha256: project.assets.find((asset) => asset.id === IDS.assetBg)!.sha256!,
  };
}

function request(input: Awaited<ReturnType<typeof createPngProject>>) {
  return {
    projectRoot: input.projectRoot,
    assetId: input.assetId,
    sha256: input.sha256,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AssetCanvasImageService', () => {
  it('rejects malformed, untracked, unknown-asset, and request-hash inputs structurally', async () => {
    const input = await createPngProject();
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    await expect(service.read(null)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_INVALID_REQUEST', assetId: '(invalid)' },
    });
    await expect(
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => null,
      }).read(request(input)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_PROJECT_NOT_TRACKED' },
    });
    await expect(
      service.read({
        ...request(input),
        assetId: '10000000-0000-4000-8000-000000000099',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND' },
    });
    await expect(
      service.read({ ...request(input), sha256: 'b'.repeat(64) }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_HASH_MISMATCH' },
    });
  });

  it('reads original PNG bytes lazily without creating a thumbnail cache', async () => {
    const input = await createPngProject();
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    const response = await service.read(request(input));

    expect(response).toMatchObject({
      ok: true,
      status: 'ready',
      assetId: input.assetId,
      mimeType: 'image/png',
      width: 4,
      height: 3,
      byteLength: input.bytes.byteLength,
    });
    if (!response.ok) throw new Error('PNG fixture was not ready');
    expect(Buffer.from(response.bytes)).toEqual(input.bytes);
    expect(response.byteLength).toBe(response.bytes.byteLength);
    await expect(
      readFile(
        path.join(
          input.projectRoot,
          'cache',
          'asset-thumbnails',
          `v1-max256-${input.sha256}.png`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads a valid JPEG with project MIME and dimensions', async () => {
    const bytes = await readFile('tests/fixtures/assets/熊猫 照片.jpg');
    const input = await createPngProject({
      bytes,
      relativePath: 'assets/source.jpg',
      mimeType: 'image/jpeg',
      width: 18,
      height: 14,
    });
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });

    await expect(service.read(request(input))).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      mimeType: 'image/jpeg',
      width: 18,
      height: 14,
      byteLength: bytes.byteLength,
    });
  });

  it('rejects traversal, sibling paths, unsupported MIME, and metadata mismatches', async () => {
    const sibling = await createPngProject({
      relativePath: 'assets2/source.png',
    });
    const siblingService = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: sibling.project }),
    });
    await expect(siblingService.read(request(sibling))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const base = buildProject();
    const traversal = {
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === IDS.assetBg
          ? { ...asset, relativePath: 'assets/../outside.png' }
          : asset,
      ),
    } as unknown as Project;
    await expect(
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: traversal }),
      }).read({
        projectRoot: 'D:\\demo.pandastage',
        assetId: IDS.assetBg,
        sha256: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const audioProject = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: '10000000-0000-4000-8000-000000000099',
          kind: 'audio',
          name: '音频',
          relativePath: 'assets/audio.mp3',
          mimeType: 'audio/mpeg',
          sha256: 'a'.repeat(64),
        },
      ],
    });
    await expect(
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: audioProject }),
      }).read({
        projectRoot: sibling.projectRoot,
        assetId: '10000000-0000-4000-8000-000000000099',
        sha256: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const dimensions = await createPngProject({ width: 5 });
    await expect(
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: dimensions.project }),
      }).read(request(dimensions)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const mime = await createPngProject({ mimeType: 'image/jpeg' });
    await expect(
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: mime.project }),
      }).read(request(mime)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });
  });

  it('rejects missing, empty, directory, oversized, unreadable, and hash-mismatched sources', async () => {
    const missing = await createPngProject({ writeSource: false });
    const serviceFor = (input: Awaited<ReturnType<typeof createPngProject>>) =>
      new AssetCanvasImageService({
        getCurrentProjectSnapshot: () => ({ project: input.project }),
      });
    await expect(serviceFor(missing).read(request(missing))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const empty = await createPngProject({ writeSource: false });
    await mkdir(path.dirname(empty.sourcePath), { recursive: true });
    await writeFile(empty.sourcePath, Buffer.alloc(0));
    await expect(serviceFor(empty).read(request(empty))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const directory = await createPngProject({ writeSource: false });
    await mkdir(directory.sourcePath, { recursive: true });
    await expect(
      serviceFor(directory).read(request(directory)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const oversized = await createPngProject({ writeSource: false });
    await mkdir(path.dirname(oversized.sourcePath), { recursive: true });
    const oversizedHandle = await open(oversized.sourcePath, 'w');
    await oversizedHandle.truncate(CANVAS_IMAGE_MAX_BYTES + 1);
    await oversizedHandle.close();
    await expect(
      serviceFor(oversized).read(request(oversized)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const unreadable = await createPngProject();
    const inspectionService = {
      inspect: vi.fn().mockRejectedValue(new Error('source unreadable')),
    } as unknown as MediaInspectionService;
    await expect(
      new AssetCanvasImageService({
        inspectionService,
        getCurrentProjectSnapshot: () => ({ project: unreadable.project }),
      }).read(request(unreadable)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    const changed = await createPngProject();
    const changedBytes = Buffer.from(changed.bytes);
    changedBytes[changedBytes.length - 1] =
      (changedBytes[changedBytes.length - 1] ?? 0) ^ 1;
    await writeFile(changed.sourcePath, changedBytes);
    await expect(
      serviceFor(changed).read(request(changed)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_HASH_MISMATCH' },
    });
  });

  it('deduplicates identical in-flight reads and clears the entry after failure', async () => {
    const input = await createPngProject({ writeSource: false });
    const service = new AssetCanvasImageService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    const first = service.read(request(input));
    const second = service.read(request(input));
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_CANVAS_IMAGE_READ_FAILED' },
    });

    await mkdir(path.dirname(input.sourcePath), { recursive: true });
    await writeFile(input.sourcePath, input.bytes);
    const retry = service.read(request(input));
    expect(retry).not.toBe(first);
    await expect(retry).resolves.toMatchObject({ ok: true, status: 'ready' });
  });
});
