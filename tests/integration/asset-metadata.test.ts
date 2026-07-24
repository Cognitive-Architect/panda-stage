import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetImportService } from '../../src/main/services/AssetImportService';
import {
  AssetMetadataService,
  type AssetMetadataOperation,
} from '../../src/main/services/AssetMetadataService';
import { CacheService } from '../../src/main/services/CacheService';
import { FFmpegAdapter } from '../../src/main/services/FFmpegAdapter';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  FFmpegThumbnailGenerator,
  ThumbnailService,
} from '../../src/main/services/ThumbnailService';

const fixtures = path.resolve('tests/fixtures/assets');
const ffmpegPath = path.resolve(
  'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe',
);
const ffprobePath = path.resolve(
  'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe',
);
const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function harness(): Promise<{
  parent: string;
  projectRoot: string;
  projectService: ProjectService;
  importService: AssetImportService;
  project: Awaited<ReturnType<ProjectService['create']>>['project'];
}> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-metadata-'));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, '元数据 项目 🐼.pandastage');
  let current:
    | {
        project: Awaited<ReturnType<ProjectService['create']>>['project'];
        revision: number;
      }
    | undefined;
  const projectService = new ProjectService({
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) current = { project, revision };
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'Day 17 metadata',
  });
  current = { project: created.project, revision: 0 };
  const importService = new AssetImportService({
    projectService,
    getCurrentProjectSnapshot: () => structuredClone(current!),
    now: () => new Date('2026-07-24T12:05:00.000Z'),
  });
  return {
    parent,
    projectRoot,
    projectService,
    importService,
    project: created.project,
  };
}

function metadataService(
  projectService: ProjectService,
  cache = new CacheService(),
): AssetMetadataService {
  const mediaTools = new FFmpegAdapter({
    ffmpegPath,
    ffprobePath,
  });
  return new AssetMetadataService({
    projectService,
    thumbnailService: new ThumbnailService(
      cache,
      new FFmpegThumbnailGenerator(ffmpegPath),
    ),
    audioProbe: mediaTools,
    now: () => new Date('2026-07-24T12:10:00.000Z'),
  });
}

async function importFixtures(
  input: Awaited<ReturnType<typeof harness>>,
  names: readonly string[],
): Promise<{
  externalPaths: string[];
  project: AssetMetadataOperation['project'];
}> {
  const externalDirectory = path.join(input.parent, '外部 源文件');
  await mkdir(externalDirectory, { recursive: true });
  const externalPaths: string[] = [];
  for (const name of names) {
    const target = path.join(externalDirectory, name);
    await copyFile(path.join(fixtures, name), target);
    externalPaths.push(target);
  }
  const mimeTypes: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  const operation = await input.importService.importCandidates({
    projectRoot: input.projectRoot,
    project: input.project,
    baseRevision: 0,
    candidates: externalPaths.map((sourcePath) => ({
      sourcePath,
      declaredMimeType:
        mimeTypes[path.extname(sourcePath).toLowerCase()]!,
    })),
  });
  return { externalPaths, project: operation.project };
}

describe('asset metadata integration', () => {
  it('imports, extracts real metadata, rebuilds thumbnails, and survives external-source deletion', async () => {
    const input = await harness();
    const imported = await importFixtures(input, [
      '熊猫 图片.png',
      '熊猫 照片.jpg',
      '熊猫 声音.mp3',
      '熊猫 声音.wav',
    ]);
    await Promise.all(
      imported.externalPaths.map((sourcePath) => rm(sourcePath)),
    );
    const service = metadataService(input.projectService);
    const sourceHashes = new Map(
      await Promise.all(
        imported.project.assets.map(async (asset) => [
          asset.id,
          await sha256(path.join(input.projectRoot, asset.relativePath)),
        ] as const),
      ),
    );
    expect(
      imported.project.assets.every(
        (asset) => asset.sha256 === sourceHashes.get(asset.id),
      ),
    ).toBe(true);

    const operations = await Promise.all(
      imported.project.assets.map((asset) =>
        service.refresh(input.projectRoot, asset.id),
      ),
    );
    const ready = operations.map((operation) => operation.result);
    expect(ready.every((result) => result.status === 'ready')).toBe(true);

    const png = ready.find(
      (result) => result.asset.mimeType === 'image/png',
    )!;
    const jpg = ready.find(
      (result) => result.asset.mimeType === 'image/jpeg',
    )!;
    const mp3 = ready.find(
      (result) => result.asset.mimeType === 'audio/mpeg',
    )!;
    const wav = ready.find(
      (result) => result.asset.mimeType === 'audio/wav',
    )!;
    expect(png.asset).toMatchObject({ width: 16, height: 12 });
    expect(jpg.asset).toMatchObject({ width: 18, height: 14 });
    expect(mp3.asset).toMatchObject({ durationMs: 313 });
    expect(wav.asset).toMatchObject({ durationMs: 250 });
    if (
      png.status !== 'ready' ||
      jpg.status !== 'ready' ||
      !png.thumbnail ||
      !jpg.thumbnail
    ) {
      throw new Error('Image thumbnails were not generated.');
    }
    expect(png.thumbnail).toMatchObject({
      width: 16,
      height: 12,
      cacheHit: false,
    });
    expect(jpg.thumbnail).toMatchObject({
      width: 18,
      height: 14,
      cacheHit: false,
    });

    for (const asset of imported.project.assets) {
      expect(await sha256(path.join(input.projectRoot, asset.relativePath))).toBe(
        sourceHashes.get(asset.id),
      );
    }

    const thumbnailPath = path.join(
      input.projectRoot,
      png.thumbnail.relativePath,
    );
    await rm(thumbnailPath);
    const rebuilt = await service.refresh(input.projectRoot, png.asset.id);
    expect(rebuilt.result.status).toBe('ready');
    if (rebuilt.result.status !== 'ready') return;
    expect(rebuilt.result.thumbnail?.cacheHit).toBe(false);
    expect(await readFile(thumbnailPath)).not.toHaveLength(0);

    const reopened = await input.projectService.open(input.projectRoot);
    expect(
      reopened.project.assets.every(
        (asset) =>
          asset.sha256?.length === 64 &&
          asset.metadata?.status === 'ready',
      ),
    ).toBe(true);
    const serialized = await readFile(
      path.join(input.projectRoot, 'project.json'),
      'utf8',
    );
    expect(serialized).not.toContain('asset-thumbnails');
    expect(serialized).not.toContain('"thumbnail"');
  });

  it('persists structured image and audio errors without breaking project open', async () => {
    const input = await harness();
    const imported = await importFixtures(input, [
      '熊猫 图片.png',
      '熊猫 声音.wav',
    ]);
    const image = imported.project.assets.find(
      (asset) => asset.kind === 'image',
    )!;
    const audio = imported.project.assets.find(
      (asset) => asset.kind === 'audio',
    )!;
    await copyFile(
      path.join(fixtures, '伪装 图片.png'),
      path.join(input.projectRoot, image.relativePath),
    );
    await copyFile(
      path.join(fixtures, '损坏 音频.wav'),
      path.join(input.projectRoot, audio.relativePath),
    );
    const service = metadataService(input.projectService);

    const imageResult = await service.refresh(
      input.projectRoot,
      image.id,
    );
    const audioResult = await service.refresh(
      input.projectRoot,
      audio.id,
    );

    expect(imageResult.result).toMatchObject({
      status: 'error',
      error: {
        code: 'ASSET_METADATA_INVALID_IMAGE',
      },
    });
    expect(imageResult.result.status === 'error' && imageResult.result.error.message).toContain(
      image.name,
    );
    expect(audioResult.result).toMatchObject({
      status: 'error',
      error: {
        code: 'ASSET_METADATA_INVALID_AUDIO',
      },
    });
    expect(audioResult.result.status === 'error' && audioResult.result.error.message).toContain(
      audio.relativePath,
    );
    const reopened = await input.projectService.open(input.projectRoot);
    expect(
      reopened.project.assets.map((asset) => asset.metadata?.status),
    ).toEqual(['error', 'error']);
    expect(reopened.project.assets[0]?.sha256).toBe(
      await sha256(path.join(input.projectRoot, image.relativePath)),
    );
    expect(reopened.project.assets[1]?.sha256).toBe(
      await sha256(path.join(input.projectRoot, audio.relativePath)),
    );
  });

  it('warns and skips decoding an oversized image', async () => {
    const input = await harness();
    const imported = await importFixtures(input, ['熊猫 图片.png']);
    const asset = imported.project.assets[0]!;
    const projectAssetPath = path.join(
      input.projectRoot,
      asset.relativePath,
    );
    const bytes = await readFile(projectAssetPath);
    bytes.writeUInt32BE(10_000, 16);
    bytes.writeUInt32BE(5_000, 20);
    await writeFile(projectAssetPath, bytes);
    const beforeHash = await sha256(projectAssetPath);
    let generatorCalls = 0;
    const service = new AssetMetadataService({
      projectService: input.projectService,
      thumbnailService: new ThumbnailService(new CacheService(), {
        generate: async () => {
          generatorCalls += 1;
          throw new Error('Oversized image must not be decoded.');
        },
      }),
      audioProbe: new FFmpegAdapter({ ffmpegPath, ffprobePath }),
    });

    const operation = await service.refresh(input.projectRoot, asset.id);

    expect(operation.result).toMatchObject({
      status: 'ready',
      asset: { width: 10_000, height: 5_000 },
      thumbnail: null,
      warnings: [{ code: 'ASSET_IMAGE_TOO_LARGE' }],
    });
    expect(await sha256(projectAssetPath)).toBe(beforeHash);
    expect(generatorCalls).toBe(0);
  });

  it('generates a real thumbnail whose longest edge is capped at 256 pixels', async () => {
    const input = await harness();
    const externalDirectory = path.join(input.parent, '大图 源文件');
    await mkdir(externalDirectory, { recursive: true });
    const sourcePath = path.join(externalDirectory, '512x300.png');
    await execFileAsync(ffmpegPath, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=512x300',
      '-frames:v',
      '1',
      '-y',
      sourcePath,
    ]);
    const imported = await input.importService.importCandidates({
      projectRoot: input.projectRoot,
      project: input.project,
      baseRevision: 0,
      candidates: [{ sourcePath, declaredMimeType: 'image/png' }],
    });
    const asset = imported.project.assets[0]!;

    const operation = await metadataService(
      input.projectService,
    ).refresh(input.projectRoot, asset.id);

    expect(operation.result).toMatchObject({
      status: 'ready',
      asset: { width: 512, height: 300 },
      thumbnail: { width: 256, height: 150 },
    });
  });

  it('degrades cache write failure while keeping metadata and project readable', async () => {
    const input = await harness();
    const imported = await importFixtures(input, ['熊猫 图片.png']);
    const asset = imported.project.assets[0]!;
    const cache = new CacheService({
      beforeDirectoryCreate: () => {
        throw new Error('Injected read-only cache.');
      },
    });

    const operation = await metadataService(
      input.projectService,
      cache,
    ).refresh(input.projectRoot, asset.id);

    expect(operation.result).toMatchObject({
      status: 'ready',
      thumbnail: null,
      warnings: [
        { code: 'ASSET_THUMBNAIL_CACHE_UNAVAILABLE' },
      ],
    });
    await expect(input.projectService.open(input.projectRoot)).resolves.toBeTruthy();
  });
});
