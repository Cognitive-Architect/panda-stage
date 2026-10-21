import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectExportPreparationMedia,
  evaluateExportPreparationBudget,
  evaluateExportPreparationSupport,
} from '../../src/domain/export-preparation';
import { ProjectSchema, type Project } from '../../src/domain';
import {
  ExportPreparationService,
  type ExportPreparationMediaReader,
  type TrackedProjectSnapshot,
} from '../../src/main/services/ExportPreparationService';
import { NodeExportPreparationFileStore } from '../../src/main/services/ExportPreparationFileStore';
import {
  EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
  EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
  type ExportPreparationRequest,
} from '../../src/shared/export-preparation-types';
import { buildProject, IDS } from './domain/testProject';

const roots: string[] = [];
const OPEN_INSTANCE_ID = 4;
const DIALOGUE_ID = '40000000-0000-4000-8000-000000000020';

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function projectWithMedia(media = new Map<string, Uint8Array>()): Project {
  const base = buildProject();
  const assets = base.assets.map((asset) => {
    const bytes = Buffer.from('media:' + asset.id);
    media.set(asset.id, bytes);
    return {
      ...asset,
      relativePath: 'assets/' + asset.id + '.png',
      sha256: hash(bytes),
    };
  });
  const shot = base.shots[0]!;
  const project = ProjectSchema.parse({
    ...base,
    name: '导出准备测试工程',
    assets,
    shots: [
      {
        ...shot,
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 250,
            endMs: 1_500,
            text: '未保存的测试字幕',
          },
        ],
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerChar ? { ...layer, x: 620, y: 570 } : layer,
        ),
      },
    ],
  });
  return project;
}

function mediaReader(
  bytesByAssetId: Map<string, Uint8Array>,
  options: {
    onRead?: (assetId: string) => void;
    reportLengths?: Map<string, number>;
    readBytes?: Map<string, Uint8Array>;
  } = {},
): ExportPreparationMediaReader {
  return {
    async getByteLength(_projectRoot, asset) {
      const bytes = bytesByAssetId.get(asset.id);
      if (!bytes) throw new Error('fixture asset is missing');
      return options.reportLengths?.get(asset.id) ?? bytes.byteLength;
    },
    async read(_projectRoot, _project, asset) {
      options.onRead?.(asset.id);
      const bytes = options.readBytes?.get(asset.id) ?? bytesByAssetId.get(asset.id);
      if (!bytes) throw new Error('fixture asset is missing');
      return { bytes, mimeType: asset.mimeType };
    },
  };
}

async function harness(options: {
  project?: Project;
  media?: Map<string, Uint8Array>;
  reader?: ExportPreparationMediaReader;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'panda-export-preparation-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const outputDirectory = path.join(root, 'output');
  await Promise.all([
    mkdir(path.join(projectRoot, 'assets'), { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);
  const media = options.media ?? new Map<string, Uint8Array>();
  const project = options.project ?? projectWithMedia(media);
  const mediaReaderForTest =
    options.reader ?? mediaReader(media);
  const fileStore = new NodeExportPreparationFileStore(
    path.join(root, 'snapshots'),
  );
  let current: TrackedProjectSnapshot = {
    project,
    revision: 7,
    dirty: true,
    openInstanceId: OPEN_INSTANCE_ID,
  };
  const service = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) =>
      path.resolve(requestedRoot) === path.resolve(projectRoot) ? current : null,
    fileStore,
    mediaReader: mediaReaderForTest,
    now: () => new Date('2026-10-21T03:00:00.000Z'),
  });
  return {
    root,
    projectRoot,
    outputDirectory,
    project,
    media,
    fileStore,
    service,
    getCurrent: () => current,
    setCurrent: (next: TrackedProjectSnapshot) => {
      current = next;
    },
  };
}

async function selectOutput(
  fixture: Awaited<ReturnType<typeof harness>>,
  fileName = '候选输出.mp4',
) {
  const selection = await fixture.service.selectOutput(
    {
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      openInstanceId: OPEN_INSTANCE_ID,
    },
    path.join(fixture.outputDirectory, fileName),
  );
  expect(selection.status).toBe('selected');
  if (selection.status !== 'selected') throw new Error('selection failed');
  return selection;
}

function requestFor(
  fixture: Awaited<ReturnType<typeof harness>>,
  selectionId: string,
): ExportPreparationRequest {
  const current = fixture.getCurrent();
  return {
    selectionId,
    attemptId: randomUUID(),
    projectRoot: fixture.projectRoot,
    projectId: current.project.id,
    openInstanceId: OPEN_INSTANCE_ID,
    revision: current.revision,
    dirty: current.dirty,
    cameraMode: 'static',
    project: structuredClone(current.project),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('DL-01 export preparation domain rules', () => {
  it('enumerates every runtime expression and keeps text-only subtitles audio-free', () => {
    const project = projectWithMedia();
    const media = collectExportPreparationMedia(project);
    expect(media.map((entry) => entry.asset.id)).toEqual(
      expect.arrayContaining([IDS.assetBg, IDS.assetChar, IDS.assetChar2]),
    );
    expect(media.every((entry) => entry.asset.kind === 'image')).toBe(true);
    expect(evaluateExportPreparationSupport(project, 'static')).toEqual([]);
    expect(evaluateExportPreparationSupport(project, 'speaker-focus')).toEqual([]);
  });

  it('classifies legal BGM/SFX volume as unsupported audio, without invalidating or mutating it', () => {
    const base = projectWithMedia();
    const clipAsset = {
      id: '10000000-0000-4000-8000-000000000020',
      kind: 'audio' as const,
      name: '合法音效',
      relativePath: 'assets/legal-sfx.wav',
      mimeType: 'audio/wav',
      sha256: 'a'.repeat(64),
      durationMs: 3_000,
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, clipAsset],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [
            {
              id: '70000000-0000-4000-8000-000000000020',
              role: 'sfx',
              name: '合法音效片段',
              assetId: clipAsset.id,
              startMs: 0,
              endMs: 1_200,
              offsetMs: 0,
              volume: 2,
            },
          ],
        },
      ],
    });
    const before = structuredClone(project);
    const issues = evaluateExportPreparationSupport(project, 'static');
    expect(issues.map((item) => item.code)).toEqual([
      'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
    ]);
    expect(project.shots[0]!.audioClips[0]!.volume).toBe(2);
    expect(project).toEqual(before);
  });

  it('omits an unused optional mouth image when no dialogue audio activates it', () => {
    const base = projectWithMedia();
    const mouthAssetId = '10000000-0000-4000-8000-000000000099';
    const mouthAsset = {
      id: mouthAssetId,
      kind: 'image' as const,
      name: 'optional mouth image',
      relativePath: 'assets/optional-mouth.png',
      mimeType: 'image/png',
      width: 64,
      height: 64,
      sha256: 'b'.repeat(64),
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, mouthAsset],
      characters: [
        { ...base.characters[0]!, mouthOpenAssetId: mouthAssetId },
      ],
    });

    expect(
      collectExportPreparationMedia(project).some(
        (entry) => entry.asset.id === mouthAssetId,
      ),
    ).toBe(false);
  });

  it('classifies legal BGM at volume 0 as unsupported audio without changing it', () => {
    const base = projectWithMedia();
    const clipAsset = {
      id: '10000000-0000-4000-8000-000000000020',
      kind: 'audio' as const,
      name: 'legal BGM',
      relativePath: 'assets/legal-bgm.wav',
      mimeType: 'audio/wav',
      sha256: 'a'.repeat(64),
      durationMs: 3_000,
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, clipAsset],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [
            {
              id: '70000000-0000-4000-8000-000000000022',
              role: 'bgm',
              name: 'legal BGM',
              assetId: clipAsset.id,
              startMs: 0,
              endMs: 1_200,
              offsetMs: 0,
              volume: 0,
            },
          ],
        },
      ],
    });
    const before = structuredClone(project);

    expect(
      evaluateExportPreparationSupport(project, 'static').map((item) => item.code),
    ).toEqual(['UNSUPPORTED_IN_CURRENT_EXPORT_SLICE']);
    expect(project.shots[0]!.audioClips[0]!.volume).toBe(0);
    expect(project).toEqual(before);
  });

  it('classifies an invisible background as an invalid shot with a location', () => {
    const base = projectWithMedia();
    const shot = base.shots[0]!;
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === shot.backgroundLayerId
              ? { ...layer, visible: false }
              : layer,
          ),
        },
      ],
    });

    expect(evaluateExportPreparationSupport(project, 'static')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_PROJECT',
          location: expect.stringContaining(shot.name),
        }),
      ]),
    );
  });

  it('blocks multiple shots as unsupported instead of trimming the Project', () => {
    const base = projectWithMedia();
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        ...base.shots,
        {
          ...base.shots[0]!,
          id: '50000000-0000-4000-8000-000000000002',
          name: 'second shot',
        },
      ],
    });
    const before = structuredClone(project);

    expect(evaluateExportPreparationSupport(project, 'static')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
        }),
      ]),
    );
    expect(project).toEqual(before);
  });

  it('evaluates exact per-file and aggregate budget boundaries', () => {
    const oneFileAtLimit = evaluateExportPreparationBudget([
      {
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        location: '镜头“开场”的背景',
      },
    ]);
    expect(oneFileAtLimit.issues).toEqual([]);

    const aggregateAtLimit = evaluateExportPreparationBudget(
      Array.from({ length: 4 }, (_, index) => ({
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        location: '素材 ' + index,
      })),
    );
    expect(aggregateAtLimit.totalBytes).toBe(
      EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
    );
    expect(aggregateAtLimit.issues).toEqual([]);

    const exceeded = evaluateExportPreparationBudget([
      ...Array.from({ length: 4 }, (_, index) => ({
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        location: '素材 ' + index,
      })),
      { byteLength: 1, location: '额外素材' },
    ]);
    expect(exceeded.totalBytes).toBe(
      EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES + 1,
    );
    expect(exceeded.issues.map((item) => item.code)).toEqual([
      'PREPARATION_BUDGET_EXCEEDED',
    ]);
  });
});

describe('ExportPreparationService', () => {
  it('freezes the actual dirty Project revision and copies verified source content', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    const result = await fixture.service.prepare(request);

    expect(result.status).toBe('PREPARATION_READY');
    if (result.status !== 'PREPARATION_READY') return;
    expect(result.candidate.project).toEqual(request.project);
    expect(result.candidate.revision).toBe(7);
    expect(result.candidate.dirtyAtCapture).toBe(true);
    expect(result.candidate.supportProfileVersion).toBe(
      result.candidate.supportProfile.version,
    );
    expect(result.candidate.project.shots[0]!.dialogues[0]!.text).toBe(
      '未保存的测试字幕',
    );
    expect(
      result.candidate.project.shots[0]!.layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.x,
    ).toBe(620);

    const manifest = result.candidate.mediaManifest[0]!;
    const stored = await readFile(
      path.join(
        fixture.fileStore.rootDirectory,
        result.candidate.snapshotId,
        manifest.contentRelativePath,
      ),
    );
    expect(hash(stored)).toBe(manifest.sha256);
    expect(stored).toEqual(fixture.media.get(manifest.assetId));

    fixture.setCurrent({
      project: ProjectSchema.parse({ ...request.project, name: '后续编辑' }),
      revision: 8,
      dirty: true,
      openInstanceId: OPEN_INSTANCE_ID,
    });
    expect(result.candidate.project.name).toBe('导出准备测试工程');
    await expect(
      readdir(path.join(fixture.fileStore.rootDirectory, result.candidate.snapshotId)),
    ).resolves.toContain('media');
    expect(fixture.getCurrent().revision).toBe(8);
    expect(await fixture.service.discard(undefined, result.candidate.snapshotId)).toBe(
      true,
    );
  });

  it('blocks a renderer snapshot that no longer matches Main revision before reading media', async () => {
    const onRead = vi.fn();
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const fixture = await harness({ project, media, reader: mediaReader(media, { onRead }) });
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    fixture.setCurrent({
      project,
      revision: 8,
      dirty: true,
      openInstanceId: OPEN_INSTANCE_ID,
    });

    const result = await fixture.service.prepare(request);
    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues[0]?.code).toBe('PROJECT_SESSION_CHANGED');
    }
    expect(onRead).not.toHaveBeenCalled();
  });

  it('blocks a same-revision request from a prior open Project instance before reading media', async () => {
    const onRead = vi.fn();
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const fixture = await harness({ project, media, reader: mediaReader(media, { onRead }) });
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    fixture.setCurrent({
      project,
      revision: 7,
      dirty: true,
      openInstanceId: OPEN_INSTANCE_ID + 1,
    });

    const result = await fixture.service.prepare(request);
    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues[0]?.code).toBe('PROJECT_SESSION_CHANGED');
    }
    expect(onRead).not.toHaveBeenCalled();
  });

  it('blocks and cleans a same-revision request when Main observes a reopen during media capture', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const firstId = [...media.keys()][0]!;
    let markReadStarted!: () => void;
    let releaseRead!: (value: { bytes: Uint8Array; mimeType: string }) => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const reader: ExportPreparationMediaReader = {
      async getByteLength(_root, asset) {
        return media.get(asset.id)!.byteLength;
      },
      async read(_root, _project, asset) {
        if (asset.id === firstId) {
          markReadStarted();
          return new Promise((resolve) => {
            releaseRead = resolve;
          });
        }
        return { bytes: media.get(asset.id)!, mimeType: asset.mimeType };
      },
    };
    const fixture = await harness({ project, media, reader });
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    const pending = fixture.service.prepare(request);
    await readStarted;
    fixture.setCurrent({
      project,
      revision: 7,
      dirty: true,
      openInstanceId: OPEN_INSTANCE_ID + 1,
    });
    releaseRead({ bytes: media.get(firstId)!, mimeType: 'image/png' });

    const result = await pending;
    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues[0]?.code).toBe('PROJECT_SESSION_CHANGED');
    }
    await expect(readdir(fixture.fileStore.rootDirectory)).resolves.toEqual([]);
  });

  it('maps invalid Project references to located INVALID_PROJECT issues before reading media', async () => {
    const onRead = vi.fn();
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const fixture = await harness({ project, media, reader: mediaReader(media, { onRead }) });
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    const invalidProject = structuredClone(project);
    const characterLayer = invalidProject.shots[0]!.layers.find(
      (layer) => layer.id === IDS.layerChar,
    );
    if (!characterLayer || characterLayer.source.kind !== 'character') {
      throw new Error('The test fixture character layer is missing.');
    }
    characterLayer.name = 'Audit Character';
    characterLayer.source.characterId = '20000000-0000-4000-8000-000000000099';

    const result = await fixture.service.prepare({
      ...request,
      project: invalidProject,
    });
    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_PROJECT',
            location: expect.stringContaining('Audit Character'),
            problem: expect.any(String),
            nextStep: expect.any(String),
          }),
        ]),
      );
    }
    expect(onRead).not.toHaveBeenCalled();
  });

  it('blocks source bytes replaced after the size check and cleans its owned snapshot', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const firstId = [...media.keys()][0]!;
    const replacement = Buffer.from('replacement bytes');
    const fixture = await harness({
      project,
      media,
      reader: mediaReader(media, {
        readBytes: new Map([[firstId, replacement]]),
      }),
    });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues.map((item) => item.code)).toContain(
        'REQUIRED_MEDIA_UNAVAILABLE',
      );
    }
    await expect(readdir(fixture.fileStore.rootDirectory)).resolves.toEqual([]);
  });

  it("rejects a changed output target and leaves the user's replacement untouched", async () => {
    const fixture = await harness();
    const target = path.join(fixture.outputDirectory, 'existing.mp4');
    await writeFile(target, 'user movie');
    const selection = await selectOutput(fixture, 'existing.mp4');
    await writeFile(target, 'user replacement with changed length');
    const expected = await readFile(target);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues[0]?.code).toBe('OUTPUT_TARGET_CHANGED');
    }
    expect(await readFile(target)).toEqual(expected);
  });

  it('cancels an in-flight content read without retaining temporary files', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const firstId = [...media.keys()][0]!;
    let markReadStarted!: () => void;
    let releaseRead!: (value: { bytes: Uint8Array; mimeType: string }) => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const reader: ExportPreparationMediaReader = {
      async getByteLength(_root, asset) {
        return media.get(asset.id)!.byteLength;
      },
      async read(_root, _project, asset) {
        if (asset.id !== firstId) {
          return { bytes: media.get(asset.id)!, mimeType: asset.mimeType };
        }
        markReadStarted();
        return new Promise((resolve) => {
          releaseRead = resolve;
        });
      },
    };
    const fixture = await harness({ project, media, reader });
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    const pending = fixture.service.prepare(request);
    await readStarted;
    expect(fixture.service.cancel(request.attemptId)).toBe(true);
    releaseRead({ bytes: media.get(firstId)!, mimeType: 'image/png' });
    await expect(pending).resolves.toMatchObject({
      status: 'CANCELLED',
      attemptId: request.attemptId,
    });
    await expect(readdir(fixture.fileStore.rootDirectory)).resolves.toEqual([]);
  });

  it('reports temporary copy failures separately from missing or corrupt source media', async () => {
    const fixture = await harness();
    const brokenStore = {
      async create() {},
      async writeAsset() {
        throw new Error('disk full');
      },
      async delete() {},
      async dispose() {},
    };
    const service = new ExportPreparationService({
      getCurrentProjectSnapshot: () => fixture.getCurrent(),
      fileStore: brokenStore,
      mediaReader: mediaReader(fixture.media),
    });
    const selection = await service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      path.join(fixture.outputDirectory, 'copy-failure.mp4'),
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const result = await service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues.map((item) => item.code)).toContain(
        'PREPARATION_FAILED',
      );
      expect(result.issues.map((item) => item.code)).not.toContain(
        'REQUIRED_MEDIA_UNAVAILABLE',
      );
    }
  });

  it('keeps a consumed attempt id from creating a second candidate', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture);
    const request = requestFor(fixture, selection.selectionId);
    const result = await fixture.service.prepare(request);
    expect(result.status).toBe('PREPARATION_READY');
    const duplicate = await fixture.service.prepare(request);
    expect(duplicate.status).toBe('BLOCK');
    if (duplicate.status === 'BLOCK') {
      expect(duplicate.issues[0]?.code).toBe('PREPARATION_BUSY');
    }
    if (result.status === 'PREPARATION_READY') {
      await fixture.service.discard(undefined, result.candidate.snapshotId);
    }
  });

  it('treats Save As cancellation as no selection or preparation', async () => {
    const fixture = await harness();
    await expect(
      fixture.service.selectOutput(
        {
          projectRoot: fixture.projectRoot,
          projectId: fixture.project.id,
          projectName: fixture.project.name,
          openInstanceId: OPEN_INSTANCE_ID,
        },
        null,
      ),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(fixture.getCurrent()).toMatchObject({ revision: 7, dirty: true });
    await expect(readdir(path.join(fixture.root, 'snapshots'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
