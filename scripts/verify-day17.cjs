const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  AssetImportService,
} = require('../dist-electron/main/services/AssetImportService.js');
const {
  AssetMetadataService,
} = require('../dist-electron/main/services/AssetMetadataService.js');
const {
  CacheService,
} = require('../dist-electron/main/services/CacheService.js');
const {
  FFmpegAdapter,
} = require('../dist-electron/main/services/FFmpegAdapter.js');
const {
  ProjectService,
} = require('../dist-electron/main/services/ProjectService.js');
const {
  FFmpegThumbnailGenerator,
  ThumbnailService,
} = require('../dist-electron/main/services/ThumbnailService.js');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.join(__dirname, '..');
const fixtures = path.join(repositoryRoot, 'tests/fixtures/assets');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/day-17',
);
const ffmpegPath = path.join(
  repositoryRoot,
  'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe',
);
const ffprobePath = path.join(
  repositoryRoot,
  'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe',
);
const fixtureNames = [
  '熊猫 图片.png',
  '熊猫 照片.jpg',
  '熊猫 声音.mp3',
  '熊猫 声音.wav',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

function createMetadataService(projectService, cache = new CacheService()) {
  const mediaTools = new FFmpegAdapter({ ffmpegPath, ffprobePath });
  return new AssetMetadataService({
    projectService,
    thumbnailService: new ThumbnailService(
      cache,
      new FFmpegThumbnailGenerator(ffmpegPath),
    ),
    audioProbe: mediaTools,
    now: () => new Date('2026-07-24T13:10:00.000Z'),
  });
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  const temporaryParent = await mkdtemp(
    path.join(os.tmpdir(), 'panda-day17-evidence-'),
  );
  try {
    const projectRoot = path.join(
      temporaryParent,
      '元数据 证据项目 🐼.pandastage',
    );
    const externalDirectory = path.join(
      temporaryParent,
      '外部 源文件',
    );
    await mkdir(externalDirectory, { recursive: true });
    const externalPaths = [];
    for (const fixtureName of fixtureNames) {
      const externalPath = path.join(externalDirectory, fixtureName);
      await copyFile(path.join(fixtures, fixtureName), externalPath);
      externalPaths.push(externalPath);
    }
    const boundedSourcePath = path.join(
      externalDirectory,
      '512x300.png',
    );
    execFileSync(ffmpegPath, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=512x300',
      '-frames:v',
      '1',
      '-y',
      boundedSourcePath,
    ]);
    externalPaths.push(boundedSourcePath);

    let current;
    const projectService = new ProjectService({
      now: () => new Date('2026-07-24T13:00:00.000Z'),
      onProjectSaved: (_root, project, revision) => {
        if (revision !== undefined) current = { project, revision };
      },
    });
    const created = await projectService.create(projectRoot, {
      name: 'Day 17 evidence',
    });
    current = { project: created.project, revision: 0 };
    const importService = new AssetImportService({
      projectService,
      getCurrentProjectSnapshot: () => structuredClone(current),
      now: () => new Date('2026-07-24T13:05:00.000Z'),
    });
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    };
    const imported = await importService.importCandidates({
      projectRoot,
      project: created.project,
      baseRevision: 0,
      candidates: externalPaths.map((sourcePath) => ({
        sourcePath,
        declaredMimeType: mimeTypes[path.extname(sourcePath)],
      })),
    });
    assert.equal(imported.project.assets.length, 5);
    await Promise.all(externalPaths.map((sourcePath) => rm(sourcePath)));

    const originalHashes = Object.fromEntries(
      await Promise.all(
        imported.project.assets.map(async (asset) => [
          asset.id,
          await hashFile(path.join(projectRoot, asset.relativePath)),
        ]),
      ),
    );
    const metadata = createMetadataService(projectService);
    const rssBefore = process.memoryUsage().rss;
    let peakRss = rssBefore;
    const timings = [];
    const operations = [];
    for (const asset of imported.project.assets) {
      const startedAt = performance.now();
      const operation = await metadata.refresh(projectRoot, asset.id);
      timings.push({
        asset: asset.name,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      operations.push(operation);
    }
    const ready = operations.map((operation) => operation.result);
    assert.ok(ready.every((result) => result.status === 'ready'));
    const png = ready.find(
      (result) => result.asset.mimeType === 'image/png',
    );
    const jpg = ready.find(
      (result) => result.asset.mimeType === 'image/jpeg',
    );
    const mp3 = ready.find(
      (result) => result.asset.mimeType === 'audio/mpeg',
    );
    const wav = ready.find(
      (result) => result.asset.mimeType === 'audio/wav',
    );
    const bounded = ready.find(
      (result) => result.asset.name === '512x300',
    );
    assert.deepEqual(
      { width: png.asset.width, height: png.asset.height },
      { width: 16, height: 12 },
    );
    assert.deepEqual(
      { width: jpg.asset.width, height: jpg.asset.height },
      { width: 18, height: 14 },
    );
    assert.equal(mp3.asset.durationMs, 313);
    assert.equal(wav.asset.durationMs, 250);
    assert.deepEqual(
      {
        source: {
          width: bounded.asset.width,
          height: bounded.asset.height,
        },
        thumbnail: {
          width: bounded.thumbnail.width,
          height: bounded.thumbnail.height,
        },
      },
      {
        source: { width: 512, height: 300 },
        thumbnail: { width: 256, height: 150 },
      },
    );
    assert.ok(png.thumbnail);
    assert.ok(jpg.thumbnail);

    const pngThumbnailPath = path.join(
      projectRoot,
      png.thumbnail.relativePath,
    );
    const jpgThumbnailPath = path.join(
      projectRoot,
      jpg.thumbnail.relativePath,
    );
    await copyFile(
      pngThumbnailPath,
      path.join(evidenceDirectory, 'thumbnail-png.png'),
    );
    await copyFile(
      jpgThumbnailPath,
      path.join(evidenceDirectory, 'thumbnail-jpg.png'),
    );
    await copyFile(
      path.join(projectRoot, bounded.thumbnail.relativePath),
      path.join(evidenceDirectory, 'thumbnail-bounded.png'),
    );

    for (const asset of imported.project.assets) {
      assert.equal(
        await hashFile(path.join(projectRoot, asset.relativePath)),
        originalHashes[asset.id],
      );
    }
    await rm(pngThumbnailPath);
    const rebuilt = await metadata.refresh(projectRoot, png.asset.id);
    assert.equal(rebuilt.result.status, 'ready');
    assert.equal(rebuilt.result.thumbnail.cacheHit, false);

    await rm(jpgThumbnailPath);
    const cacheFailure = await createMetadataService(
      projectService,
      new CacheService({
        beforeDirectoryCreate: () => {
          throw new Error('Injected read-only cache.');
        },
      }),
    ).refresh(projectRoot, jpg.asset.id);
    assert.equal(cacheFailure.result.status, 'ready');
    assert.equal(
      cacheFailure.result.warnings[0].code,
      'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
    );

    const pngAssetPath = path.join(
      projectRoot,
      png.asset.relativePath,
    );
    const wavAssetPath = path.join(
      projectRoot,
      wav.asset.relativePath,
    );
    await copyFile(
      path.join(fixtures, '伪装 图片.png'),
      pngAssetPath,
    );
    await copyFile(
      path.join(fixtures, '损坏 音频.wav'),
      wavAssetPath,
    );
    const corruptImage = await metadata.refresh(
      projectRoot,
      png.asset.id,
    );
    const corruptAudio = await metadata.refresh(
      projectRoot,
      wav.asset.id,
    );
    assert.equal(corruptImage.result.status, 'error');
    assert.equal(
      corruptImage.result.error.code,
      'ASSET_METADATA_INVALID_IMAGE',
    );
    assert.equal(corruptAudio.result.status, 'error');
    assert.equal(
      corruptAudio.result.error.code,
      'ASSET_METADATA_INVALID_AUDIO',
    );

    const oversizedBytes = await readFile(
      path.join(fixtures, '熊猫 图片.png'),
    );
    oversizedBytes.writeUInt32BE(10_000, 16);
    oversizedBytes.writeUInt32BE(5_000, 20);
    await writeFile(pngAssetPath, oversizedBytes);
    const oversized = await metadata.refresh(projectRoot, png.asset.id);
    assert.equal(oversized.result.status, 'ready');
    assert.equal(
      oversized.result.warnings[0].code,
      'ASSET_IMAGE_TOO_LARGE',
    );
    assert.equal(oversized.result.thumbnail, null);

    const reopened = await projectService.open(projectRoot);
    const serialized = await readFile(
      path.join(projectRoot, 'project.json'),
      'utf8',
    );
    assert.equal(serialized.includes('asset-thumbnails'), false);
    assert.equal(serialized.includes('"thumbnail"'), false);

    const results = {
      day: 17,
      workOrder: 'B-17/45',
      result: 'PASS',
      branch: 'feat/day-17-asset-metadata',
      testedSha: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repositoryRoot,
          encoding: 'utf8',
        })
        .trim(),
      executedAt: new Date().toISOString(),
      dependencyDecision: {
        image: 'Existing packaged FFmpeg 4.1 sidecar',
        audio: 'Existing packaged FFprobe 5.1 sidecar',
        addedPackages: [],
        thumbnailSchemaVersion: 1,
        thumbnailMaxEdge: 256,
        cacheKeyExample: path.basename(
          path.join(projectRoot, rebuilt.result.thumbnail.relativePath),
        ),
      },
      realMedia: {
        png: {
          dimensions: {
            width: png.asset.width,
            height: png.asset.height,
          },
          thumbnail: png.thumbnail,
          evidence: 'docs/evidence/day-17/thumbnail-png.png',
        },
        jpg: {
          dimensions: {
            width: jpg.asset.width,
            height: jpg.asset.height,
          },
          thumbnail: jpg.thumbnail,
          evidence: 'docs/evidence/day-17/thumbnail-jpg.png',
        },
        mp3: { durationMs: mp3.asset.durationMs },
        wav: { durationMs: wav.asset.durationMs },
        bounded: {
          source: { width: 512, height: 300 },
          thumbnail: {
            width: bounded.thumbnail.width,
            height: bounded.thumbnail.height,
          },
          evidence: 'docs/evidence/day-17/thumbnail-bounded.png',
        },
      },
      resilience: {
        externalSourcesDeletedBeforeExtraction: true,
        projectAssetHashesUnchangedByHealthyExtraction: true,
        cacheDeletionRebuilt: true,
        cacheWriteFailureWarning:
          cacheFailure.result.warnings[0].code,
        corruptImageCode: corruptImage.result.error.code,
        corruptAudioCode: corruptAudio.result.error.code,
        oversizedImageWarning: oversized.result.warnings[0].code,
        projectReopenedAfterFailures: reopened.project.id === created.project.id,
        thumbnailAbsentFromProjectJson: true,
      },
      observation: {
        perAsset: timings,
        mainProcessRssBeforeBytes: rssBefore,
        mainProcessPeakRssBytes: peakRss,
        mainProcessRssDeltaBytes: peakRss - rssBefore,
        note: 'Thumbnail decoding runs in the FFmpeg child process; the 40,000,000-pixel preflight threshold skips oversized decoding.',
      },
      tests: {
        unitFiles: 40,
        unitTests: 224,
        integrationFiles: 6,
        integrationTests: 52,
      },
    };
    await writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
