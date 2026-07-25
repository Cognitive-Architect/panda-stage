import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import { applyAssetMetadataResponse } from '../../src/renderer/features/assets/applyAssetMetadataResponse';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { AssetMetadataResponseSchema } from '../../src/shared/asset-metadata-api';
import { AssetMetadataService } from '../../src/main/services/AssetMetadataService';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import { CacheService } from '../../src/main/services/CacheService';
import { ProjectOperationCoordinator } from '../../src/main/services/ProjectOperationCoordinator';
import { ProjectService } from '../../src/main/services/ProjectService';
import { RecoveryService } from '../../src/main/services/RecoveryService';
import { ThumbnailService } from '../../src/main/services/ThumbnailService';

const temporaryDirectories: string[] = [];
const fixtures = path.resolve('tests/fixtures/assets');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function noTimerClock() {
  return {
    setInterval: () => ({}) as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  };
}

async function hash(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function recoveryFiles(projectRoot: string): Promise<string[]> {
  const directory = path.join(projectRoot, 'recovery');
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith('.recovery.json'))
      .map((name) => path.join(directory, name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function stateHashes(projectRoot: string): Promise<{
  project: string;
  recovery: string[];
}> {
  return {
    project: await hash(path.join(projectRoot, 'project.json')),
    recovery: await Promise.all(
      (await recoveryFiles(projectRoot)).map(hash),
    ),
  };
}

async function createHarness(kind: 'audio' | 'image' = 'audio') {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-revision-'));
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, 'revision-safe.pandastage');
  const coordinator = new ProjectOperationCoordinator();
  const recoveryService = new RecoveryService({ nowMs: () => 2_000 });
  const autosaveHolder: { current?: AutosaveService } = {};
  const projectService = new ProjectService({
    coordinator,
    now: () => new Date('2026-07-25T01:00:00.000Z'),
    onProjectSaved: async (root, project, revision) => {
      await recoveryService.cleanupAfterFormalSave(root, project.id);
      if (revision !== undefined) {
        autosaveHolder.current?.markFormalSaved(
          root,
          project,
          revision,
        );
      }
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'Revision safe metadata',
  });
  await mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  const fileName = kind === 'audio' ? 'sample.wav' : 'sample.png';
  await copyFile(
    path.join(
      fixtures,
      kind === 'audio' ? '熊猫 声音.wav' : '熊猫 图片.png',
    ),
    path.join(projectRoot, 'assets', fileName),
  );
  const formal = ProjectSchema.parse({
    ...created.project,
    assets: [
      kind === 'audio'
        ? {
            id: randomUUID(),
            kind: 'audio',
            name: fileName,
            relativePath: `assets/${fileName}`,
            mimeType: 'audio/wav',
            durationMs: 250,
          }
        : {
            id: randomUUID(),
            kind: 'image',
            name: fileName,
            relativePath: `assets/${fileName}`,
            mimeType: 'image/png',
            width: 16,
            height: 12,
          },
    ],
  });
  await projectService.save(projectRoot, formal, 1);
  const autosaveService = new AutosaveService({
    recoveryService,
    coordinator,
    clock: noTimerClock(),
  });
  autosaveHolder.current = autosaveService;
  const revision3 = ProjectSchema.parse({
    ...formal,
    name: 'Revision 3',
  });
  autosaveService.track({
    projectRoot,
    project: revision3,
    revision: 3,
    dirty: true,
  });
  await autosaveService.tick(projectRoot);
  return {
    projectRoot,
    projectService,
    autosaveService,
    revision3,
    asset: revision3.assets[0]!,
  };
}

function request(
  input: Awaited<ReturnType<typeof createHarness>>,
  project: Project,
  baseRevision: number,
) {
  return {
    projectRoot: input.projectRoot,
    project,
    baseRevision,
    assetId: input.asset.id,
    requestId: randomUUID(),
  };
}

function service(
  input: Awaited<ReturnType<typeof createHarness>>,
  overrides: {
    audioProbe?: {
      probeAudioFile: (
        path: string,
        signal?: AbortSignal,
      ) => Promise<{
        codecName: string;
        sampleRate: number;
        channels: number;
        durationSeconds: number;
        raw: unknown;
      }>;
    };
    thumbnailService?: ThumbnailService;
    inspectionService?: {
      inspect: (
        path: string,
        mime: string,
      ) => Promise<{
        kind: 'image';
        extension: '.png';
        mimeType: 'image/png';
        width: number;
        height: number;
      }>;
    };
    timeoutMs?: number;
  } = {},
) {
  return new AssetMetadataService({
    projectService: input.projectService,
    getCurrentProjectSnapshot: (root) =>
      input.autosaveService.getProjectSnapshot(root),
    thumbnailService:
      overrides.thumbnailService ??
      new ThumbnailService(new CacheService(), {
        generate: async () => undefined,
      }),
    audioProbe:
      overrides.audioProbe ??
      {
        probeAudioFile: async () => ({
          codecName: 'pcm_s16le',
          sampleRate: 44_100,
          channels: 1,
          durationSeconds: 0.25,
          raw: {},
        }),
      },
    ...(overrides.inspectionService
      ? {
          inspectionService:
            overrides.inspectionService as never,
        }
      : {}),
    timeoutMs: overrides.timeoutMs ?? 500,
    now: () => new Date('2026-07-25T01:05:00.000Z'),
  });
}

describe('asset metadata revision and operation safety', () => {
  it('rejects an old revision without touching formal or recovery state', async () => {
    const input = await createHarness();
    const before = await stateHashes(input.projectRoot);
    let probes = 0;
    const metadata = service(input, {
      audioProbe: {
        probeAudioFile: async () => {
          probes += 1;
          throw new Error('must not run');
        },
      },
    });

    await expect(
      metadata.refresh(request(input, input.revision3, 2)),
    ).rejects.toMatchObject({
      code: 'ASSET_METADATA_STALE_REVISION',
      currentRevision: 3,
    });

    expect(probes).toBe(0);
    expect(await stateHashes(input.projectRoot)).toEqual(before);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({ revision: 3, dirty: true });
  });

  it('revalidates after unlocked media work and cannot overwrite revision 4', async () => {
    const input = await createHarness();
    let release!: () => void;
    let started!: () => void;
    const mediaStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const metadata = service(input, {
      audioProbe: {
        probeAudioFile: async () => {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {
            codecName: 'pcm_s16le',
            sampleRate: 44_100,
            channels: 1,
            durationSeconds: 0.25,
            raw: {},
          };
        },
      },
    });
    const pending = metadata.refresh(
      request(input, input.revision3, 3),
    );
    await mediaStarted;
    const revision4 = ProjectSchema.parse({
      ...input.revision3,
      name: 'User edit at revision 4',
    });
    input.autosaveService.update({
      projectRoot: input.projectRoot,
      project: revision4,
      revision: 4,
      dirty: true,
    });
    await input.autosaveService.tick(input.projectRoot);
    const beforeRelease = await stateHashes(input.projectRoot);
    release();

    await expect(pending).rejects.toMatchObject({
      code: 'ASSET_METADATA_STALE_REVISION',
      currentRevision: 4,
    });
    expect(await stateHashes(input.projectRoot)).toEqual(beforeRelease);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({
      revision: 4,
      dirty: true,
      project: { name: 'User edit at revision 4' },
    });
  });

  it('commits revision 3 to 4 and synchronizes disk, Main, renderer, and recovery', async () => {
    const input = await createHarness();
    const editor = new EditorProjectStore();
    editor.open(input.projectRoot, {
      ...input.revision3,
      name: 'Revision 0',
    });
    editor.updateProject({ ...input.revision3, name: 'Revision 1' });
    editor.updateProject({ ...input.revision3, name: 'Revision 2' });
    editor.updateProject(input.revision3);

    const operation = await service(input).refresh(
      request(input, input.revision3, 3),
    );
    const response = AssetMetadataResponseSchema.parse({
      ok: true,
      ...operation,
    });
    applyAssetMetadataResponse(response, editor);

    expect(operation).toMatchObject({
      baseRevision: 3,
      savedRevision: 4,
      result: {
        status: 'ready',
        asset: { durationMs: 250, metadata: { status: 'ready' } },
      },
    });
    expect(
      (await input.projectService.open(input.projectRoot)).project,
    ).toEqual(operation.project);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({
      project: operation.project,
      revision: 4,
      dirty: false,
    });
    expect(editor.getSnapshot()).toMatchObject({
      project: operation.project,
      revision: 4,
      dirty: false,
    });
    expect(await recoveryFiles(input.projectRoot)).toEqual([]);
  });

  it('times out thumbnail generation, removes temp files, and releases the project lock', async () => {
    const input = await createHarness('image');
    let active = 0;
    let aborted = false;
    const cache = new CacheService();
    const thumbnailService = new ThumbnailService(cache, {
      generate: async (
        _source,
        _output,
        _width,
        _height,
        signal,
      ) => {
        active += 1;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              active -= 1;
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
      },
    });
    const metadata = service(input, {
      thumbnailService,
      inspectionService: {
        inspect: async () => ({
          kind: 'image',
          extension: '.png',
          mimeType: 'image/png',
          width: 16,
          height: 12,
        }),
      },
      timeoutMs: 20,
    });
    const before = await stateHashes(input.projectRoot);

    await expect(
      metadata.refresh(request(input, input.revision3, 3)),
    ).rejects.toMatchObject({ code: 'ASSET_METADATA_TIMEOUT' });
    expect({ active, aborted }).toEqual({ active: 0, aborted: true });
    expect(await stateHashes(input.projectRoot)).toEqual(before);
    const cacheFiles = await readdir(
      path.join(input.projectRoot, 'cache', 'asset-thumbnails'),
    );
    expect(cacheFiles.filter((name) => name.includes('.tmp.'))).toEqual([]);
    await expect(
      input.projectService.save(
        input.projectRoot,
        input.revision3,
        3,
      ),
    ).resolves.toBeTruthy();
  });

  it('times out or cancels audio probing with one terminal outcome and leaves later autosave usable', async () => {
    for (const mode of ['timeout', 'cancel'] as const) {
      const input = await createHarness();
      let active = 0;
      let aborted = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const metadata = service(input, {
        audioProbe: {
          probeAudioFile: async (_path, signal) => {
            active += 1;
            markStarted();
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => {
                  active -= 1;
                  aborted += 1;
                  reject(new Error('aborted'));
                },
                { once: true },
              );
            });
            throw new Error('unreachable');
          },
        },
        timeoutMs: mode === 'timeout' ? 20 : 1_000,
      });
      const before = await stateHashes(input.projectRoot);
      const controller = new AbortController();
      const pending = metadata.refresh(
        request(input, input.revision3, 3),
        { signal: controller.signal },
      );
      if (mode === 'cancel') {
        await started;
        controller.abort();
      }
      await expect(pending).rejects.toMatchObject({
        code:
          mode === 'timeout'
            ? 'ASSET_METADATA_TIMEOUT'
            : 'ASSET_METADATA_CANCELLED',
      });
      expect({ active, aborted }).toEqual({ active: 0, aborted: 1 });
      expect(await stateHashes(input.projectRoot)).toEqual(before);

      const revision4 = ProjectSchema.parse({
        ...input.revision3,
        name: `Autosave after ${mode}`,
      });
      input.autosaveService.update({
        projectRoot: input.projectRoot,
        project: revision4,
        revision: 4,
        dirty: true,
      });
      await input.autosaveService.tick(input.projectRoot);
      expect(await recoveryFiles(input.projectRoot)).toHaveLength(1);
    }
  });

  it('settles a stale-plus-timeout race once without committing or leaving media active', async () => {
    const input = await createHarness();
    let active = 0;
    let aborts = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const metadata = service(input, {
      audioProbe: {
        probeAudioFile: async (_path, signal) => {
          active += 1;
          markStarted();
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                active -= 1;
                aborts += 1;
                reject(new Error('aborted'));
              },
              { once: true },
            );
          });
          throw new Error('unreachable');
        },
      },
      timeoutMs: 30,
    });
    const pending = metadata.refresh(
      request(input, input.revision3, 3),
    );
    await started;
    const revision4 = ProjectSchema.parse({
      ...input.revision3,
      name: 'Revision 4 wins the race',
    });
    input.autosaveService.update({
      projectRoot: input.projectRoot,
      project: revision4,
      revision: 4,
      dirty: true,
    });
    await input.autosaveService.tick(input.projectRoot);
    const beforeTerminal = await stateHashes(input.projectRoot);

    await expect(pending).rejects.toMatchObject({
      code: 'ASSET_METADATA_TIMEOUT',
    });
    expect({ active, aborts }).toEqual({ active: 0, aborts: 1 });
    expect(await stateHashes(input.projectRoot)).toEqual(beforeTerminal);
    expect(
      input.autosaveService.getProjectSnapshot(input.projectRoot),
    ).toMatchObject({
      revision: 4,
      dirty: true,
      project: { name: 'Revision 4 wins the race' },
    });
  });
});
