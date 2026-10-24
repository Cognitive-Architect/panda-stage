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
import {
  NodeExportPreparationFileStore,
  type ExportPreparationFileStore,
} from '../../src/main/services/ExportPreparationFileStore';
import {
  exportCapabilityStatusForMimeType,
  EXPORT_PREPARATION_MAX_ASSETS,
  EXPORT_PREPARATION_MAX_SHOTS,
  EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
  EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
  EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS,
  EXPORT_PREPARATION_SUPPORT_PROFILE,
  type ExportPreparationRequest,
} from '../../src/shared/export-preparation-types';
import { buildProject, IDS } from './domain/testProject';

const roots: string[] = [];
const OPEN_INSTANCE_ID = 4;
const DIALOGUE_ID = '40000000-0000-4000-8000-000000000020';

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readDirectoryOrEmpty(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
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
    readErrors?: Map<string, Error>;
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
      const error = options.readErrors?.get(asset.id);
      if (error) throw error;
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
  assertFormalOutputLocation?: (outputPath: string) => Promise<void>;
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
  let currentTime = new Date('2026-10-21T03:00:00.000Z');
  let current: TrackedProjectSnapshot = {
    project,
    revision: 7,
    dirty: true,
    openInstanceId: OPEN_INSTANCE_ID,
  };
  const service = new ExportPreparationService({
    getCurrentProjectSnapshot: (requestedRoot) =>
      path.resolve(requestedRoot) === path.resolve(projectRoot) ? current : null,
    assertFormalOutputLocation: options.assertFormalOutputLocation,
    fileStore,
    mediaReader: mediaReaderForTest,
    now: () => new Date(currentTime),
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
    setNow: (next: Date) => {
      currentTime = next;
    },
  };
}

async function selectOutput(
  fixture: Awaited<ReturnType<typeof harness>>,
  fileName = '候选输出.mp4',
  snapshotId?: string,
) {
  const selection = await fixture.service.selectOutput(
    {
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      openInstanceId: OPEN_INSTANCE_ID,
      ...(snapshotId ? { snapshotId } : {}),
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('DL-01 export preparation domain rules', () => {
  it('uses the versioned capability matrix as the formal media support source', () => {
    const matrix = EXPORT_PREPARATION_SUPPORT_PROFILE.capabilityMatrix;
    const flaSequence = matrix.entries.find(
      (entry) => entry.id === 'fla-frame-sequence',
    );

    expect(matrix.version).toBe(EXPORT_PREPARATION_SUPPORT_PROFILE.version);
    expect(EXPORT_PREPARATION_SUPPORT_PROFILE.audio).toBe('supported');
    expect(
      EXPORT_PREPARATION_SUPPORT_PROFILE.windowsFormalOutputMaxPathCharacters,
    ).toBe(EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS);
    expect(exportCapabilityStatusForMimeType('image/png')).toBe(
      'SUPPORTED_VERIFIED',
    );
    expect(exportCapabilityStatusForMimeType('image/jpeg')).toBe(
      'SUPPORTED_UNVERIFIED',
    );
    expect(exportCapabilityStatusForMimeType('audio/wav')).toBe(
      'SUPPORTED_VERIFIED',
    );
    expect(exportCapabilityStatusForMimeType('audio/aac')).toBe('UNKNOWN');
    expect(flaSequence?.statuses).toEqual({
      import: 'SUPPORTED_VERIFIED',
      shot: 'NOT_SUPPORTED',
      preview: 'SUPPORTED_VERIFIED',
      formalExport: 'NOT_SUPPORTED',
    });
    expect(
      EXPORT_PREPARATION_SUPPORT_PROFILE.imageMimeTypes,
    ).toEqual(['image/png', 'image/jpeg']);
    expect(EXPORT_PREPARATION_SUPPORT_PROFILE.audioMimeTypes).toEqual([
      'audio/mpeg',
      'audio/wav',
    ]);
  });

  it('enumerates current visual assets and keeps text-only subtitles audio-free', () => {
    const project = projectWithMedia();
    const media = collectExportPreparationMedia(project);
    expect(media.map((entry) => entry.asset.id)).toEqual(
      expect.arrayContaining([IDS.assetBg, IDS.assetChar]),
    );
    expect(media.map((entry) => entry.asset.id)).not.toContain(IDS.assetChar2);
    expect(media.every((entry) => entry.asset.kind === 'image')).toBe(true);
    expect(evaluateExportPreparationSupport(project, 'static')).toEqual([]);
    expect(evaluateExportPreparationSupport(project, 'speaker-focus')).toEqual([]);
  });

  it('prepares only expressions used by the shot timeline, not preload candidates', async () => {
    const media = new Map<string, Uint8Array>();
    const base = projectWithMedia(media);
    const unusedFaceAsset = {
      id: '10000000-0000-4000-8000-000000000099',
      kind: 'image' as const,
      name: 'Unused face C',
      relativePath: 'assets/unused-face-c.png',
      mimeType: 'image/png' as const,
      width: 64,
      height: 64,
      sha256: 'd'.repeat(64),
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, unusedFaceAsset],
      characters: base.characters.map((character) =>
        character.id === IDS.character
          ? {
              ...character,
              expressions: [
                ...character.expressions,
                {
                  id: '20000000-0000-4000-8000-000000000098',
                  name: 'Unused face C',
                  assetId: unusedFaceAsset.id,
                },
              ],
            }
          : character,
      ),
    });
    media.delete(IDS.assetChar2);

    const requiredIds = collectExportPreparationMedia(project).map(
      (entry) => entry.asset.id,
    );
    expect(requiredIds).not.toContain(IDS.assetChar2);
    expect(requiredIds).not.toContain(unusedFaceAsset.id);

    const fixture = await harness({ project, media });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('PREPARATION_READY');
    if (result.status === 'PREPARATION_READY') {
      const manifestIds = result.candidate.mediaManifest.map(
        (entry) => entry.assetId,
      );
      expect(manifestIds).not.toContain(IDS.assetChar2);
      expect(manifestIds).not.toContain(unusedFaceAsset.id);
      expect(manifestIds).toContain(IDS.assetChar);
      expect(manifestIds).toContain(IDS.assetBg);
    }
  });

  it('requires an expression that becomes active later in the shot', async () => {
    const media = new Map<string, Uint8Array>();
    const base = projectWithMedia(media);
    media.delete(IDS.assetChar2);
    const shot = base.shots[0]!;
    const project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...shot,
          timelineEvents: [
            {
              id: '70000000-0000-4000-8000-000000000098',
              type: 'expression',
              layerId: IDS.layerChar,
              startMs: 1_500,
              endMs: 1_500,
              expressionId: IDS.expressionAngry,
            },
          ],
        },
      ],
    });
    const fixture = await harness({ project, media });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      const issue = result.issues.find(
        (item) => item.code === 'REQUIRED_MEDIA_UNAVAILABLE',
      );
      expect(issue?.location).toContain(project.characters[0]!.name);
      expect(issue?.location).toContain(
        project.characters[0]!.expressions.find(
          (expression) => expression.id === IDS.expressionAngry,
        )!.name,
      );
    }
  });

  it('allows valid BGM/SFX within the shared Project v8 contract without mutating them', () => {
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
    expect(issues).toEqual([]);
    expect(project.shots[0]!.audioClips[0]!.volume).toBe(2);
    expect(project).toEqual(before);
  });

  it('freezes and returns the hashed audio bytes with the formal candidate', async () => {
    const media = new Map<string, Uint8Array>();
    const base = projectWithMedia(media);
    const audioAssetId = '10000000-0000-4000-8000-000000000021';
    const clipId = '70000000-0000-4000-8000-000000000021';
    const audioBytes = Buffer.from('frozen audio bytes');
    media.set(audioAssetId, audioBytes);
    const audioAsset = {
      id: audioAssetId,
      kind: 'audio' as const,
      name: 'Frozen WAV',
      relativePath: 'assets/frozen.wav',
      mimeType: 'audio/wav',
      sha256: hash(audioBytes),
      durationMs: 3_000,
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, audioAsset],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [
            {
              id: clipId,
              role: 'sfx',
              name: 'Frozen SFX',
              assetId: audioAssetId,
              startMs: 250,
              endMs: 1_250,
              offsetMs: 100,
              volume: 1.5,
            },
          ],
        },
      ],
    });
    const fixture = await harness({ project, media });
    const selection = await selectOutput(fixture);
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;
    expect(prepared.candidate.mediaManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetId: audioAssetId, kind: 'audio' }),
      ]),
    );
    const frozen = await fixture.service.acquireCandidateForExport(
      prepared.candidate.snapshotId,
    );
    expect(frozen.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: audioAssetId,
          kind: 'audio',
          mimeType: 'audio/wav',
          bytes: new Uint8Array(audioBytes),
        }),
      ]),
    );
  });

  it('blocks zero-length audio clips during strict preflight', () => {
    const base = projectWithMedia();
    const audioAssetId = '10000000-0000-4000-8000-000000000022';
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: audioAssetId,
          kind: 'audio',
          name: 'Zero range WAV',
          relativePath: 'assets/zero-range.wav',
          mimeType: 'audio/wav',
          sha256: 'd'.repeat(64),
          durationMs: 3_000,
        },
      ],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [
            {
              id: '70000000-0000-4000-8000-000000000022',
              role: 'sfx',
              name: 'Zero range',
              assetId: audioAssetId,
              startMs: 1_000,
              endMs: 1_000,
              offsetMs: 0,
              volume: 1,
            },
          ],
        },
      ],
    });

    expect(evaluateExportPreparationSupport(project, 'static')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_PROJECT' }),
      ]),
    );
  });

  it('blocks missing frozen audio media before formal export', async () => {
    const media = new Map<string, Uint8Array>();
    const base = projectWithMedia(media);
    const missingAsset = {
      id: '10000000-0000-4000-8000-000000000020',
      kind: 'audio' as const,
      name: 'F05 missing BGM',
      relativePath: 'assets/f05-missing-bgm.wav',
      mimeType: 'audio/wav',
      sha256: 'c'.repeat(64),
      durationMs: 3_000,
    };
    const missingClip = {
      id: '70000000-0000-4000-8000-000000000020',
      role: 'bgm' as const,
      name: 'F05 missing audio clip',
      assetId: missingAsset.id,
      startMs: 0,
      endMs: 1_200,
      offsetMs: 0,
      volume: 1,
    };
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, missingAsset],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [missingClip],
        },
      ],
    });
    const before = structuredClone(project);
    const fixture = await harness({ project, media });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining(['REQUIRED_MEDIA_UNAVAILABLE']),
      );
      expect(
        result.issues.find((item) => item.code === 'REQUIRED_MEDIA_UNAVAILABLE')
          ?.location,
      ).toContain(missingClip.name);
    }
    expect(project).toEqual(before);
    expect(fixture.getCurrent()).toMatchObject({ revision: 7, dirty: true });
  });

  it('gives actionable read-permission guidance for required media', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    const fixture = await harness({
      project,
      media,
      reader: mediaReader(media, {
        readErrors: new Map([
          [
            IDS.assetBg,
            Object.assign(new Error('permission denied'), { code: 'EACCES' }),
          ],
        ]),
      }),
    });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'REQUIRED_MEDIA_UNAVAILABLE',
            location: expect.stringContaining(project.shots[0]!.name),
            problem: '无法读取所需素材，素材文件或所在目录可能没有读取权限。',
            nextStep: '检查素材文件和上级目录的读取权限，或重新导入素材后再检查。',
          }),
        ]),
      );
    }
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual(
      [],
    );
    expect(fixture.getCurrent()).toMatchObject({ revision: 7, dirty: true });
  });

  it('aggregates a missing background and tampered used expression in one preflight', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    media.delete(IDS.assetBg);
    const tamperedBytes = Buffer.from('tampered face bytes');
    const reads: string[] = [];
    const fixture = await harness({
      project,
      media,
      reader: mediaReader(media, {
        onRead: (assetId) => reads.push(assetId),
        readBytes: new Map([[IDS.assetChar, tamperedBytes]]),
      }),
    });
    const selection = await selectOutput(fixture);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    expect(reads).toContain(IDS.assetChar);
    if (result.status === 'BLOCK') {
      const mediaIssues = result.issues.filter(
        (item) => item.code === 'REQUIRED_MEDIA_UNAVAILABLE',
      );
      expect(mediaIssues).toHaveLength(2);
      expect(new Set(mediaIssues.map((item) => item.location)).size).toBe(2);
      expect(
        mediaIssues.some((item) =>
          item.location.includes(project.shots[0]!.name),
        ),
      ).toBe(true);
      expect(
        mediaIssues.some((item) =>
          item.location.includes(project.characters[0]!.name),
        ),
      ).toBe(true);
      expect(JSON.stringify(mediaIssues)).not.toContain(fixture.projectRoot);
    }
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
    expect(hash(media.get(IDS.assetChar)!)).toBe(
      project.assets.find((asset) => asset.id === IDS.assetChar)!.sha256,
    );
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

  it('includes composite Body/Face and audio-driven Mouth with its referenced audio', () => {
    const base = projectWithMedia();
    const bodyAssetId = '10000000-0000-4000-8000-000000000097';
    const mouthAssetId = '10000000-0000-4000-8000-000000000096';
    const audioAssetId = '10000000-0000-4000-8000-000000000095';
    const audioClipId = '70000000-0000-4000-8000-000000000097';
    const assets = [
      {
        id: bodyAssetId,
        kind: 'image' as const,
        name: 'Composite body',
        relativePath: 'assets/composite-body.png',
        mimeType: 'image/png' as const,
        width: 640,
        height: 640,
        sha256: 'e'.repeat(64),
      },
      {
        id: mouthAssetId,
        kind: 'image' as const,
        name: 'Speaking mouth',
        relativePath: 'assets/speaking-mouth.png',
        mimeType: 'image/png' as const,
        width: 128,
        height: 128,
        sha256: 'f'.repeat(64),
      },
      {
        id: audioAssetId,
        kind: 'audio' as const,
        name: 'Dialogue audio',
        relativePath: 'assets/dialogue.wav',
        mimeType: 'audio/wav' as const,
        durationMs: 3_000,
        sha256: 'a'.repeat(64),
      },
    ];
    const project = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, ...assets],
      characters: base.characters.map((character) =>
        character.id === IDS.character
          ? {
              ...character,
              mode: 'composite',
              bodyAssetId,
              facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
              mouthOpenAssetId: mouthAssetId,
            }
          : character,
      ),
      shots: base.shots.map((shot) => ({
        ...shot,
        audioClips: [
          {
            id: audioClipId,
            role: 'dialogue',
            name: 'Speaking audio',
            assetId: audioAssetId,
            startMs: 200,
            endMs: 1_600,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            audioClipId,
            subtitleStyleId: IDS.subtitle,
            startMs: 200,
            endMs: 1_600,
            text: 'Speaking',
          },
        ],
      })),
    });

    const mediaIds = collectExportPreparationMedia(project).map(
      (entry) => entry.asset.id,
    );
    expect(mediaIds).toEqual(
      expect.arrayContaining([
        IDS.assetBg,
        IDS.assetChar,
        bodyAssetId,
        mouthAssetId,
        audioAssetId,
      ]),
    );
    expect(mediaIds).not.toContain(IDS.assetChar2);

    const longAudioProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === audioAssetId && asset.kind === 'audio'
          ? { ...asset, durationMs: 1_000_000_000 }
          : asset,
      ),
      shots: project.shots.map((shot) => ({
        ...shot,
        durationMs: 1_000_000_000,
        audioClips: shot.audioClips.map((clip) => ({
          ...clip,
          endMs: 1_000_000_000,
        })),
      })),
    });
    expect(
      collectExportPreparationMedia(longAudioProject).map(
        (entry) => entry.asset.id,
      ),
    ).toContain(mouthAssetId);

    const closedOnlyProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          {
            id: '70000000-0000-4000-8000-000000000094',
            type: 'visibility',
            layerId: IDS.layerChar,
            startMs: 0,
            endMs: 0,
            visible: false,
          },
          {
            id: '70000000-0000-4000-8000-000000000093',
            type: 'visibility',
            layerId: IDS.layerChar,
            startMs: 360,
            endMs: 360,
            visible: true,
          },
          {
            id: '70000000-0000-4000-8000-000000000092',
            type: 'visibility',
            layerId: IDS.layerChar,
            startMs: 520,
            endMs: 520,
            visible: false,
          },
        ],
      })),
    });
    const closedOnlyMediaIds = collectExportPreparationMedia(
      closedOnlyProject,
    ).map((entry) => entry.asset.id);
    expect(closedOnlyMediaIds).toContain(audioAssetId);
    expect(closedOnlyMediaIds).not.toContain(mouthAssetId);
  });


  it('allows legal BGM at volume 0 without changing it', () => {
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

    expect(evaluateExportPreparationSupport(project, 'static')).toEqual([]);
    expect(project.shots[0]!.audioClips[0]!.volume).toBe(0);
    expect(project).toEqual(before);
  });

  it('classifies an invisible background as unsupported with a location', () => {
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
          code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
          location: expect.stringContaining(shot.name),
        }),
      ]),
    );
  });

  it('classifies a valid shot with no selected background as unsupported', () => {
    const base = projectWithMedia();
    const project = ProjectSchema.parse({
      ...base,
      shots: [{ ...base.shots[0]!, backgroundLayerId: null }],
    });

    expect(evaluateExportPreparationSupport(project, 'static')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
          location: expect.stringContaining(project.shots[0]!.name),
        }),
      ]),
    );
  });

  it('supports a three-Shot Project and keeps the Project intact', () => {
    const base = projectWithMedia();
    const project = ProjectSchema.parse({
      ...base,
      shots: Array.from({ length: 3 }, (_, index) => ({
        ...base.shots[0]!,
        id: `50000000-0000-4000-8000-00000000000${index + 1}`,
        name: `shot-${index + 1}`,
      })),
    });
    const before = structuredClone(project);

    expect(EXPORT_PREPARATION_SUPPORT_PROFILE.shotCount).toEqual({
      minimum: 1,
      maximum: EXPORT_PREPARATION_MAX_SHOTS,
    });
    expect(evaluateExportPreparationSupport(project, 'static')).toEqual([]);
    expect(project).toEqual(before);
  });

  it('evaluates Shot-count values below, at, and one above the limit', () => {
    const base = projectWithMedia();
    const makeShot = (index: number) => ({
      ...base.shots[0]!,
      id: `60000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      name: `镜头-${index}`,
    });
    const withinLimit = ProjectSchema.parse({
      ...base,
      shots: Array.from({ length: EXPORT_PREPARATION_MAX_SHOTS - 1 }, (_, i) =>
        makeShot(i + 1),
      ),
    });
    const atLimit = ProjectSchema.parse({
      ...base,
      shots: Array.from({ length: EXPORT_PREPARATION_MAX_SHOTS }, (_, i) =>
        makeShot(i + 1),
      ),
    });
    const overLimit = ProjectSchema.parse({
      ...base,
      shots: Array.from({ length: EXPORT_PREPARATION_MAX_SHOTS + 1 }, (_, i) =>
        makeShot(i + 1),
      ),
    });

    expect(evaluateExportPreparationSupport(withinLimit, 'static')).toEqual([]);
    expect(evaluateExportPreparationSupport(atLimit, 'static')).toEqual([]);
    expect(evaluateExportPreparationSupport(overLimit, 'static')).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
        location: '项目',
        problem: expect.stringContaining(String(EXPORT_PREPARATION_MAX_SHOTS)),
        nextStep: expect.stringContaining('镜头'),
      }),
    ]);
  });

  it('evaluates below, exact, and one-over preparation budget boundaries', () => {
    const oneFileWithinLimit = evaluateExportPreparationBudget([
      {
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES - 1,
        location: '镜头“开场”的背景',
      },
    ]);
    expect(oneFileWithinLimit.issues).toEqual([]);

    const oneFileAtLimit = evaluateExportPreparationBudget([
      {
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        location: '镜头“开场”的背景',
      },
    ]);
    expect(oneFileAtLimit.issues).toEqual([]);

    const oneFileOverLimit = evaluateExportPreparationBudget([
      {
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES + 1,
        location: '镜头“开场”的背景',
      },
    ]);
    expect(oneFileOverLimit.issues).toEqual([
      expect.objectContaining({
        code: 'PREPARATION_BUDGET_EXCEEDED',
        location: '镜头“开场”的背景',
        problem: expect.stringContaining('64 MiB'),
        nextStep: expect.stringContaining('更小'),
      }),
    ]);

    const withinAssetCount = evaluateExportPreparationBudget(
      Array.from({ length: EXPORT_PREPARATION_MAX_ASSETS - 1 }, () => ({
        byteLength: 0,
        location: '镜头“开场”的图层',
      })),
    );
    expect(withinAssetCount.issues).toEqual([]);
    expect(
      evaluateExportPreparationBudget(
        Array.from({ length: EXPORT_PREPARATION_MAX_ASSETS }, () => ({
          byteLength: 0,
          location: '镜头“开场”的图层',
        })),
      ).issues,
    ).toEqual([]);
    const overAssetCount = evaluateExportPreparationBudget(
      Array.from({ length: EXPORT_PREPARATION_MAX_ASSETS + 1 }, () => ({
        byteLength: 0,
        location: '镜头“开场”的图层',
      })),
    );
    expect(overAssetCount.issues).toEqual([
      expect.objectContaining({
        code: 'PREPARATION_BUDGET_EXCEEDED',
        location: '工程素材',
        problem: expect.stringContaining(String(EXPORT_PREPARATION_MAX_ASSETS)),
        nextStep: expect.stringContaining('减少'),
      }),
    ]);

    const aggregateWithinLimit = evaluateExportPreparationBudget([
      ...Array.from({ length: 3 }, (_, index) => ({
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        location: '素材 ' + index,
      })),
      {
        byteLength: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES - 1,
        location: '素材 3',
      },
    ]);
    expect(aggregateWithinLimit.totalBytes).toBe(
      EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES - 1,
    );
    expect(aggregateWithinLimit.issues).toEqual([]);

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
    expect(exceeded.issues).toEqual([
      expect.objectContaining({
        code: 'PREPARATION_BUDGET_EXCEEDED',
        location: '工程素材',
        problem: expect.stringContaining('256 MiB'),
        nextStep: expect.stringContaining('降低'),
      }),
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
    fixture.media.set(
      manifest.assetId,
      Buffer.from('source changed after candidate preparation'),
    );
    const storedAfterSourceReplacement = await readFile(
      path.join(
        fixture.fileStore.rootDirectory,
        result.candidate.snapshotId,
        manifest.contentRelativePath,
      ),
    );
    expect(hash(storedAfterSourceReplacement)).toBe(manifest.sha256);
    expect(storedAfterSourceReplacement).toEqual(stored);

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

  it('acquires only verified frozen media and rechecks the overwrite target', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'Frozen candidate.mp4');
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    const candidate = prepared.candidate;
    const manifest = candidate.mediaManifest[0]!;
    const acquired = await fixture.service.acquireCandidateForExport(
      candidate.snapshotId,
    );
    expect(acquired.candidate).toEqual(candidate);
    expect(acquired.media).toHaveLength(candidate.mediaManifest.length);
    expect(
      Buffer.from(
        acquired.media.find((entry) => entry.assetId === manifest.assetId)!.bytes,
      ).equals(fixture.media.get(manifest.assetId)!),
    ).toBe(true);
    fixture.service.releaseCandidateExport(candidate.snapshotId);

    const current = fixture.getCurrent();
    fixture.setCurrent({
      ...current,
      revision: current.revision + 1,
      dirty: true,
    });
    await expect(
      fixture.service.acquireCandidateForExport(candidate.snapshotId),
    ).rejects.toThrow('PROJECT_SNAPSHOT_CHANGED');
    const retry = await fixture.service.acquireCandidateForExport(
      candidate.snapshotId,
      true,
    );
    expect(retry.candidate.revision).toBe(candidate.revision);
    fixture.service.releaseCandidateExport(candidate.snapshotId);

    const outputPath = path.join(
      fixture.outputDirectory,
      candidate.outputIntent.fileName,
    );
    await writeFile(outputPath, 'appeared after preparation');
    await expect(
      fixture.service.assertOutputTargetUnchanged(candidate.snapshotId),
    ).rejects.toThrow('OUTPUT_TARGET_CHANGED');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe(
      'appeared after preparation',
    );
    await fixture.service.discard(undefined, candidate.snapshotId);
  });

  it('deletes a frozen candidate when a successful export is finalized', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'candidate-cleanup.mp4');
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    await fixture.service.acquireCandidateForExport(prepared.candidate.snapshotId);
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toContain(
      prepared.candidate.snapshotId,
    );

    await fixture.service.finalizeCandidateExport(prepared.candidate.snapshotId);

    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
    await expect(
      fixture.service.acquireCandidateForExport(prepared.candidate.snapshotId),
    ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
  });

  it('retains original frozen content for retry and validates a replacement output target', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'first-output.mp4');
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    const candidate = prepared.candidate;
    const manifest = candidate.mediaManifest[0]!;
    const frozenPath = path.join(
      fixture.fileStore.rootDirectory,
      candidate.snapshotId,
      manifest.contentRelativePath,
    );
    const frozenBytes = await readFile(frozenPath);
    await fixture.service.acquireCandidateForExport(candidate.snapshotId);
    await fixture.service.retainCandidateForRetry(candidate.snapshotId);

    const current = fixture.getCurrent();
    fixture.setCurrent({
      ...current,
      project: ProjectSchema.parse({
        ...current.project,
        name: 'Edited after failure',
      }),
      revision: current.revision + 1,
      dirty: true,
    });

    const retrySelection = await selectOutput(
      fixture,
      'retry-original-content.mp4',
      candidate.snapshotId,
    );
    const retry = await fixture.service.acquireCandidateForExport(
      candidate.snapshotId,
      true,
    );

    expect(retry.candidate.snapshotId).toBe(candidate.snapshotId);
    expect(retry.candidate.project.name).toBe(candidate.project.name);
    expect(retry.candidate.outputIntent.fileName).toBe(retrySelection.fileName);
    expect(retry.candidate.outputIntent.targetPath).toBe(
      path.join(fixture.outputDirectory, retrySelection.fileName),
    );
    expect(hash(await readFile(frozenPath))).toBe(hash(frozenBytes));
    expect(
      retry.media.find((entry) => entry.assetId === manifest.assetId)?.bytes,
    ).toEqual(Uint8Array.from(frozenBytes));

    fixture.service.releaseCandidateExport(candidate.snapshotId);
    await fixture.service.discard(undefined, candidate.snapshotId);
  });

  it('expires retained snapshots and removes their owned media', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'expires.mp4');
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    fixture.setNow(new Date('2026-10-21T03:31:00.000Z'));
    await expect(
      fixture.service.acquireCandidateForExport(prepared.candidate.snapshotId),
    ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual(
      [],
    );
    fixture.service.disposeSync();
  });

  it('keeps at most two retained snapshots by pruning the oldest retry candidate', async () => {
    const fixture = await harness();
    const firstSelection = await selectOutput(fixture, 'first-retained.mp4');
    const firstPrepared = await fixture.service.prepare(
      requestFor(fixture, firstSelection.selectionId),
    );
    expect(firstPrepared.status).toBe('PREPARATION_READY');
    if (firstPrepared.status !== 'PREPARATION_READY') return;
    fixture.setNow(new Date('2026-10-21T03:00:01.000Z'));
    const secondSelection = await selectOutput(fixture, 'second-retained.mp4');
    const secondPrepared = await fixture.service.prepare(
      requestFor(fixture, secondSelection.selectionId),
    );
    expect(secondPrepared.status).toBe('PREPARATION_READY');
    if (secondPrepared.status !== 'PREPARATION_READY') return;

    fixture.setNow(new Date('2026-10-21T03:00:02.000Z'));
    fixture.setNow(new Date('2026-10-21T03:00:02.000Z'));
    const thirdSelection = await selectOutput(fixture, 'third-retained.mp4');
    const thirdPrepared = await fixture.service.prepare(
      requestFor(fixture, thirdSelection.selectionId),
    );
    expect(thirdPrepared.status).toBe('PREPARATION_READY');
    if (thirdPrepared.status !== 'PREPARATION_READY') return;
    expect(
      await readDirectoryOrEmpty(fixture.fileStore.rootDirectory),
    ).toEqual(
      expect.arrayContaining([
        secondPrepared.candidate.snapshotId,
        thirdPrepared.candidate.snapshotId,
      ]),
    );
    expect(
      await readDirectoryOrEmpty(fixture.fileStore.rootDirectory),
    ).toHaveLength(2);
    expect(
      fixture.fileStore.getOwnedPath(firstPrepared.candidate.snapshotId),
    ).toBeNull();
    expect(
      fixture.fileStore.getOwnedPath(secondPrepared.candidate.snapshotId),
    ).not.toBeNull();

    expect(
      await fixture.service.discard(undefined, secondPrepared.candidate.snapshotId),
    ).toBe(true);
    expect(
      await fixture.service.discard(undefined, thirdPrepared.candidate.snapshotId),
    ).toBe(true);
    fixture.service.disposeSync();
  });

  it('blocks an expired snapshot while a same-session cleanup retry removes its owned directory', async () => {
    vi.useFakeTimers();
    const fixture = await harness();
    const baseStore = fixture.fileStore;
    let locked = true;
    let deleteAttempts = 0;
    const fileStore: ExportPreparationFileStore = {
      create: (snapshotId) => baseStore.create(snapshotId),
      writeAsset: (snapshotId, contentHandleId, mimeType, bytes) =>
        baseStore.writeAsset(snapshotId, contentHandleId, mimeType, bytes),
      readAsset: (snapshotId, contentHandleId, mimeType) =>
        baseStore.readAsset(snapshotId, contentHandleId, mimeType),
      delete: async (snapshotId) => {
        deleteAttempts += 1;
        if (locked) throw new Error('controlled Windows file lock');
        await baseStore.delete(snapshotId);
      },
      dispose: () => baseStore.dispose(),
      getOwnedPath: (snapshotId) => baseStore.getOwnedPath(snapshotId),
      disposeSync: () => baseStore.disposeSync(),
    };
    let currentTime = new Date('2026-10-21T03:00:00.000Z');
    const service = new ExportPreparationService({
      getCurrentProjectSnapshot: (requestedRoot) =>
        path.resolve(requestedRoot) === path.resolve(fixture.projectRoot)
          ? fixture.getCurrent()
          : null,
      fileStore,
      mediaReader: mediaReader(fixture.media),
      now: () => new Date(currentTime),
    });
    const selection = await service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      path.join(fixture.outputDirectory, 'locked-expiry.mp4'),
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const prepared = await service.prepare(requestFor(fixture, selection.selectionId));
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    currentTime = new Date('2026-10-21T03:31:00.000Z');
    await expect(
      service.acquireCandidateForExport(prepared.candidate.snapshotId),
    ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    expect(deleteAttempts).toBe(1);
    expect(baseStore.getOwnedPath(prepared.candidate.snapshotId)).not.toBeNull();
    expect(service.getDiagnostics(prepared.candidate.attemptId).join('\n')).toContain(
      'controlled Windows file lock',
    );

    locked = false;
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    const cleanupDeadline = Date.now() + 2_000;
    while (
      baseStore.getOwnedPath(prepared.candidate.snapshotId) !== null &&
      Date.now() < cleanupDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(deleteAttempts).toBe(2);
    expect(baseStore.getOwnedPath(prepared.candidate.snapshotId)).toBeNull();
    await expect(
      service.acquireCandidateForExport(prepared.candidate.snapshotId),
    ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    await service.dispose();
  });

  it('keeps frozen media owned by an active export when the expiry timer fires', async () => {
    vi.useFakeTimers();
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'active-expiry.mp4');
    const prepared = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    const input = await fixture.service.acquireCandidateForExport(
      prepared.candidate.snapshotId,
    );
    fixture.setNow(new Date('2026-10-21T03:31:00.000Z'));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);

    expect(fixture.fileStore.getOwnedPath(prepared.candidate.snapshotId)).not.toBeNull();
    expect(
      input.media.every((item) => item.bytes.byteLength > 0),
    ).toBe(true);
    await expect(
      fixture.service.assertOutputTargetUnchanged(prepared.candidate.snapshotId),
    ).resolves.toBeUndefined();

    fixture.service.releaseCandidateExport(prepared.candidate.snapshotId);
    await expect(
      fixture.service.discard(undefined, prepared.candidate.snapshotId),
    ).resolves.toBe(true);
    fixture.service.disposeSync();
  });

  it('bounds cleanup retries and records the exact owned path and takeover action', async () => {
    vi.useFakeTimers();
    const fixture = await harness();
    const baseStore = fixture.fileStore;
    let deleteAttempts = 0;
    let snapshotId = '';
    const fileStore: ExportPreparationFileStore = {
      create: async (id) => {
        snapshotId = id;
        await baseStore.create(id);
      },
      writeAsset: (id, contentHandleId, mimeType, bytes) =>
        baseStore.writeAsset(id, contentHandleId, mimeType, bytes),
      readAsset: (id, contentHandleId, mimeType) =>
        baseStore.readAsset(id, contentHandleId, mimeType),
      delete: async () => {
        deleteAttempts += 1;
        throw new Error('controlled persistent file lock');
      },
      dispose: async () => {
        throw new Error('controlled persistent file lock at shutdown');
      },
      getOwnedPath: (id) => baseStore.getOwnedPath(id),
      disposeSync: () => [
        {
          snapshotId,
          ownedPath: baseStore.getOwnedPath(snapshotId) ?? snapshotId,
          error: 'controlled persistent file lock at shutdown',
        },
      ],
    };
    let currentTime = new Date('2026-10-21T03:00:00.000Z');
    const service = new ExportPreparationService({
      getCurrentProjectSnapshot: (requestedRoot) =>
        path.resolve(requestedRoot) === path.resolve(fixture.projectRoot)
          ? fixture.getCurrent()
          : null,
      fileStore,
      mediaReader: mediaReader(fixture.media),
      now: () => new Date(currentTime),
    });
    const selection = await service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      path.join(fixture.outputDirectory, 'persistent-lock.mp4'),
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const prepared = await service.prepare(requestFor(fixture, selection.selectionId));
    expect(prepared.status).toBe('PREPARATION_READY');
    if (prepared.status !== 'PREPARATION_READY') return;

    currentTime = new Date('2026-10-21T03:31:00.000Z');
    await expect(
      service.acquireCandidateForExport(prepared.candidate.snapshotId),
    ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(deleteAttempts).toBe(4);
    const diagnostics = service.getDiagnostics(prepared.candidate.attemptId).join('\n');
    expect(diagnostics).toContain(`snapshot ${prepared.candidate.snapshotId}`);
    expect(diagnostics).toContain(baseStore.getOwnedPath(prepared.candidate.snapshotId));
    expect(diagnostics).toContain('attempt 4/4');
    expect(diagnostics).toContain('Takeover action');

    const shutdownFailures = service.disposeSync();
    expect(shutdownFailures).toMatchObject([
      {
        snapshotId: prepared.candidate.snapshotId,
        ownedPath: baseStore.getOwnedPath(prepared.candidate.snapshotId),
        error: 'controlled persistent file lock at shutdown',
      },
    ]);
    expect(service.getDiagnostics(prepared.candidate.attemptId).join('\n')).toContain(
      'Application shutdown cleanup failed',
    );
  });

  it('recovers two exhausted expired snapshots after an explicit same-session export retry', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fixture = await harness();
    const baseStore = fixture.fileStore;
    const lockedSnapshotIds = new Set<string>();
    const deleteAttempts = new Map<string, number>();
    const fileStore: ExportPreparationFileStore = {
      create: (snapshotId) => baseStore.create(snapshotId),
      writeAsset: (snapshotId, contentHandleId, mimeType, bytes) =>
        baseStore.writeAsset(snapshotId, contentHandleId, mimeType, bytes),
      readAsset: (snapshotId, contentHandleId, mimeType) =>
        baseStore.readAsset(snapshotId, contentHandleId, mimeType),
      delete: async (snapshotId) => {
        deleteAttempts.set(
          snapshotId,
          (deleteAttempts.get(snapshotId) ?? 0) + 1,
        );
        if (lockedSnapshotIds.has(snapshotId)) {
          throw new Error('controlled Windows file lock');
        }
        await baseStore.delete(snapshotId);
      },
      dispose: () => baseStore.dispose(),
      getOwnedPath: (snapshotId) => baseStore.getOwnedPath(snapshotId),
      disposeSync: () => baseStore.disposeSync(),
    };
    let currentTime = new Date('2026-10-21T03:00:00.000Z');
    const service = new ExportPreparationService({
      getCurrentProjectSnapshot: (requestedRoot) =>
        path.resolve(requestedRoot) === path.resolve(fixture.projectRoot)
          ? fixture.getCurrent()
          : null,
      fileStore,
      mediaReader: mediaReader(fixture.media),
      now: () => new Date(currentTime),
    });
    const selectForService = async (fileName: string) => {
      const selection = await service.selectOutput(
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
    };

    const firstSelection = await selectForService('expired-first.mp4');
    const firstPrepared = await service.prepare(
      requestFor(fixture, firstSelection.selectionId),
    );
    expect(firstPrepared.status).toBe('PREPARATION_READY');
    if (firstPrepared.status !== 'PREPARATION_READY') return;

    const secondSelection = await selectForService('expired-second.mp4');
    const secondPrepared = await service.prepare(
      requestFor(fixture, secondSelection.selectionId),
    );
    expect(secondPrepared.status).toBe('PREPARATION_READY');
    if (secondPrepared.status !== 'PREPARATION_READY') return;

    const expiredSnapshots = [
      firstPrepared.candidate.snapshotId,
      secondPrepared.candidate.snapshotId,
    ];
    const ownedPaths = new Map(
      expiredSnapshots.map((snapshotId) => [
        snapshotId,
        baseStore.getOwnedPath(snapshotId),
      ]),
    );
    expect([...ownedPaths.values()].every(Boolean)).toBe(true);
    expiredSnapshots.forEach((snapshotId) => lockedSnapshotIds.add(snapshotId));

    currentTime = new Date('2026-10-21T03:31:00.000Z');
    for (const snapshotId of expiredSnapshots) {
      await expect(
        service.acquireCandidateForExport(snapshotId),
      ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    }
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(expiredSnapshots.map((id) => deleteAttempts.get(id))).toEqual([4, 4]);
    expect(await readDirectoryOrEmpty(baseStore.rootDirectory)).toEqual(
      expect.arrayContaining(expiredSnapshots),
    );
    expect(await readDirectoryOrEmpty(baseStore.rootDirectory)).toHaveLength(2);
    for (const snapshotId of expiredSnapshots) {
      expect(baseStore.getOwnedPath(snapshotId)).toBe(ownedPaths.get(snapshotId));
      await expect(
        service.acquireCandidateForExport(snapshotId),
      ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    }

    const lockedSelection = await selectForService('blocked-while-locked.mp4');
    const blocked = await service.prepare(
      requestFor(fixture, lockedSelection.selectionId),
    );
    expect(blocked.status).toBe('BLOCK');
    if (blocked.status !== 'BLOCK') return;
    expect(blocked.issues[0]).toMatchObject({ code: 'PREPARATION_BUSY' });
    expect(blocked.issues[0]?.problem).toContain('旧导出临时文件');
    expect(blocked.issues[0]?.nextStep).toContain('解除文件占用后重试导出');
    expect(JSON.stringify(blocked.issues)).not.toContain('controlled Windows file lock');
    expect(JSON.stringify(blocked.issues)).not.toContain(expiredSnapshots[0]);
    const blockedDiagnostics = service.getDiagnostics(blocked.diagnosticId).join('\n');
    for (const snapshotId of expiredSnapshots) {
      expect(blockedDiagnostics).toContain(snapshotId);
      expect(blockedDiagnostics).toContain(ownedPaths.get(snapshotId));
    }
    expect(blockedDiagnostics).toContain('attempt 4/4; explicit recovery 1');
    expect(blockedDiagnostics).toContain('Takeover action');

    const machineLog = consoleError.mock.calls.map((call) => String(call[0])).join('\n');
    for (const snapshotId of expiredSnapshots) {
      expect(machineLog).toContain(snapshotId);
      expect(machineLog).toContain(ownedPaths.get(snapshotId));
    }
    expect(machineLog).toContain('attempt 4/4');
    expect(machineLog).toContain('Takeover action');

    expiredSnapshots.forEach((snapshotId) => lockedSnapshotIds.delete(snapshotId));
    const recoveredSelection = await selectForService('same-session-recovered.mp4');
    const recovered = await service.prepare(
      requestFor(fixture, recoveredSelection.selectionId),
    );
    expect(recovered.status).toBe('PREPARATION_READY');
    if (recovered.status !== 'PREPARATION_READY') return;
    expect(expiredSnapshots.map((id) => deleteAttempts.get(id))).toEqual([6, 6]);
    expect(await readDirectoryOrEmpty(baseStore.rootDirectory)).toEqual([
      recovered.candidate.snapshotId,
    ]);
    for (const snapshotId of expiredSnapshots) {
      expect(baseStore.getOwnedPath(snapshotId)).toBeNull();
      await expect(
        service.acquireCandidateForExport(snapshotId),
      ).rejects.toThrow('EXPORT_SNAPSHOT_UNAVAILABLE');
    }

    const recoveredInput = await service.acquireCandidateForExport(
      recovered.candidate.snapshotId,
    );
    expect(recoveredInput.candidate.snapshotId).toBe(
      recovered.candidate.snapshotId,
    );
    service.releaseCandidateExport(recovered.candidate.snapshotId);
    await expect(
      service.discard(undefined, recovered.candidate.snapshotId),
    ).resolves.toBe(true);
    await service.dispose();
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

  it('rejects an existing MP4 even when Windows Save As returned its path', async () => {
    const fixture = await harness();
    const target = path.join(fixture.outputDirectory, 'existing.mp4');
    await writeFile(target, 'user movie');
    const expected = await readFile(target);
    const result = await fixture.service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      target,
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issue: { code: 'OUTPUT_TARGET_EXISTS' },
    });
    expect(await readFile(target)).toEqual(expected);
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it('blocks a file created after output selection and preserves its bytes', async () => {
    const fixture = await harness();
    const target = path.join(fixture.outputDirectory, 'created-after-selection.mp4');
    const selection = await selectOutput(fixture, 'created-after-selection.mp4');
    const externalBytes = Buffer.from('third-party MP4 created after selection');
    await writeFile(target, externalBytes);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues.map((item) => item.code)).toContain('OUTPUT_TARGET_CHANGED');
    }
    expect(await readFile(target)).toEqual(externalBytes);
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it('blocks a file created during media preflight and preserves its bytes', async () => {
    const media = new Map<string, Uint8Array>();
    const project = projectWithMedia(media);
    let target = '';
    let changed = false;
    const reader: ExportPreparationMediaReader = {
      async getByteLength(_projectRoot, asset) {
        const bytes = media.get(asset.id);
        if (!bytes) throw new Error('fixture asset is missing');
        return bytes.byteLength;
      },
      async read(_projectRoot, _project, asset) {
        if (!changed) {
          changed = true;
          await writeFile(target, 'third-party MP4 created during preflight');
        }
        return { bytes: media.get(asset.id)!, mimeType: asset.mimeType };
      },
    };
    const fixture = await harness({ project, media, reader });
    target = path.join(fixture.outputDirectory, 'preflight-target.mp4');
    const selection = await selectOutput(fixture, 'preflight-target.mp4');
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      expect(result.issues.map((item) => item.code)).toContain(
        'OUTPUT_TARGET_CHANGED',
      );
    }
    expect(await readFile(target, 'utf8')).toBe(
      'third-party MP4 created during preflight',
    );
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it('blocks a file that appeared while the native Save As dialog was open', async () => {
    const fixture = await harness();
    const target = path.join(fixture.outputDirectory, 'appeared-during-selection.mp4');
    const selectionRequest = {
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      openInstanceId: OPEN_INSTANCE_ID,
    };
    expect(await readdir(fixture.outputDirectory)).toEqual([]);
    // Simulate another process creating the selected name while the native
    // Save As dialog is open, before Main inspects the returned path.
    await writeFile(target, 'external movie');
    const expected = await readFile(target);
    const result = await fixture.service.selectOutput(selectionRequest, target);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.issue.code).toBe('OUTPUT_TARGET_EXISTS');
    }
    expect(await readFile(target)).toEqual(expected);
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it('records false overwrite consent and a missing target in the preparation candidate', async () => {
    const fixture = await harness();
    const selection = await selectOutput(fixture, 'new-output.mp4');
    expect(selection.overwriteApproved).toBe(false);
    const result = await fixture.service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('PREPARATION_READY');
    if (result.status === 'PREPARATION_READY') {
      expect(result.candidate.outputIntent).toMatchObject({
        overwriteApproved: false,
        targetIdentity: null,
      });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'blocks Windows output paths beyond the staging-path limit with an actionable issue',
    async () => {
      const fixture = await harness();
      const parentDirectory = path.resolve(fixture.outputDirectory);
      const longStagingDirectory =
        parentDirectory.length < 230
          ? path.join(parentDirectory, 'd'.repeat(229 - parentDirectory.length))
          : parentDirectory;
      const outputWithLongStagingPath = path.join(
        longStagingDirectory,
        'out.mp4',
      );
      expect(outputWithLongStagingPath.length).toBeLessThanOrEqual(259);
      const fileNameLength = Math.max(4, 260 - parentDirectory.length - 1);
      const fileName = `${'x'.repeat(fileNameLength - 4)}.mp4`;
      const overlongTargetPath = path.join(parentDirectory, fileName);
      expect(overlongTargetPath.length).toBeGreaterThan(259);

      const request = {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      };
      const stagePathResult = await fixture.service.selectOutput(
        request,
        outputWithLongStagingPath,
      );
      const targetPathResult = await fixture.service.selectOutput(
        request,
        overlongTargetPath,
      );

      for (const result of [stagePathResult, targetPathResult]) {
        expect(result).toMatchObject({
          status: 'blocked',
          issue: {
            code: 'OUTPUT_LOCATION_UNSUPPORTED',
            problem: expect.stringContaining('259'),
            nextStep: expect.stringContaining('259'),
          },
        });
      }
    },
  );

  it('blocks output folders that fail the local NTFS capability check', async () => {
    const fixture = await harness({
      assertFormalOutputLocation: async () => {
        throw new Error('network or non-NTFS output');
      },
    });
    const result = await fixture.service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      path.join(fixture.outputDirectory, 'unsupported.mp4'),
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issue: { code: 'OUTPUT_LOCATION_UNSUPPORTED' },
    });
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it('removes the output-directory write probe after successful selection', async () => {
    const fixture = await harness();

    await selectOutput(fixture, 'write-probe-cleanup.mp4');

    await expect(
      readDirectoryOrEmpty(fixture.outputDirectory),
    ).resolves.toEqual([]);
  });

  it('gives writable-folder guidance when output validation reports permission denial', async () => {
    const fixture = await harness({
      assertFormalOutputLocation: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    const result = await fixture.service.selectOutput(
      {
        projectRoot: fixture.projectRoot,
        projectId: fixture.project.id,
        projectName: fixture.project.name,
        openInstanceId: OPEN_INSTANCE_ID,
      },
      path.join(fixture.outputDirectory, 'permission-denied.mp4'),
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issue: {
        code: 'OUTPUT_LOCATION_UNSUPPORTED',
        location: '输出位置',
        problem: '所选文件夹没有创建 MP4 文件所需的写入权限。',
        nextStep: '检查文件夹的写入权限，或选择当前账户可写的本地 NTFS 文件夹后重试。',
      },
    });
    expect(await readDirectoryOrEmpty(fixture.fileStore.rootDirectory)).toEqual([]);
  });

  it.each([
    {
      kind: 'unknown layer',
      backgroundLayerId: '60000000-0000-4000-8000-000000000099',
    },
    { kind: 'character layer', backgroundLayerId: IDS.layerChar },
  ])(
    'keeps an illegal background reference to a $kind as INVALID_PROJECT',
    async ({ backgroundLayerId }) => {
      const fixture = await harness();
      const selection = await selectOutput(fixture);
      const invalidProject = structuredClone(fixture.project);
      invalidProject.shots[0]!.backgroundLayerId = backgroundLayerId;
      const result = await fixture.service.prepare({
        ...requestFor(fixture, selection.selectionId),
        project: invalidProject,
      });

      expect(result.status).toBe('BLOCK');
      if (result.status === 'BLOCK') {
        expect(result.issues[0]).toMatchObject({
          code: 'INVALID_PROJECT',
          location: expect.stringContaining(fixture.project.shots[0]!.name),
        });
      }
    },
  );

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

  it('blocks temporary copy failures with actionable locations and cleanup', async () => {
    const fixture = await harness();
    const projectFilePath = path.join(fixture.projectRoot, 'project.json');
    const projectBytes = Buffer.from(
      JSON.stringify(fixture.project, null, 2) + '\n',
    );
    await writeFile(projectFilePath, projectBytes);
    const previousOutputPath = path.join(
      fixture.outputDirectory,
      'previous-output-sentinel.mp4',
    );
    const previousOutputBytes = Buffer.from(
      'pre-existing output sentinel; not a media file',
    );
    await writeFile(previousOutputPath, previousOutputBytes);
    const targetPath = path.join(fixture.outputDirectory, 'copy-failure.mp4');
    const brokenStore: ExportPreparationFileStore = {
      create: (snapshotId) => fixture.fileStore.create(snapshotId),
      async writeAsset() {
        throw new Error('disk full');
      },
      delete: (snapshotId) => fixture.fileStore.delete(snapshotId),
      dispose: () => fixture.fileStore.dispose(),
      getOwnedPath: (snapshotId) => fixture.fileStore.getOwnedPath(snapshotId),
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
      targetPath,
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const result = await service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      const expectedLocations = collectExportPreparationMedia(
        fixture.project,
      ).map((entry) => entry.usages[0] ?? '工程素材');
      const copyFailures = result.issues.filter(
        (item) => item.code === 'PREPARATION_FAILED',
      );
      expect(expectedLocations).not.toContain('工程素材');
      expect(copyFailures).toHaveLength(expectedLocations.length);
      expect(copyFailures).toEqual(
        expect.arrayContaining(
          expectedLocations.map((location) =>
            expect.objectContaining({
              code: 'PREPARATION_FAILED',
              location,
              problem: '素材副本无法安全写入临时准备目录。',
              nextStep: '检查可用磁盘空间后重新检查；工程和已有输出未被修改。',
            }),
          ),
        ),
      );
      expect(result.issues.map((item) => item.code)).not.toContain(
        'REQUIRED_MEDIA_UNAVAILABLE',
      );
    }
    await expect(readFile(projectFilePath)).resolves.toEqual(projectBytes);
    await expect(readFile(previousOutputPath)).resolves.toEqual(
      previousOutputBytes,
    );
    await expect(readFile(targetPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readDirectoryOrEmpty(fixture.fileStore.rootDirectory),
    ).resolves.toEqual([]);
  });

  it('reports temporary-copy permission failures separately from disk exhaustion', async () => {
    const fixture = await harness();
    const projectFilePath = path.join(fixture.projectRoot, 'project.json');
    const projectBytes = Buffer.from(
      JSON.stringify(fixture.project, null, 2) + '\n',
    );
    await writeFile(projectFilePath, projectBytes);
    const previousOutputPath = path.join(
      fixture.outputDirectory,
      'previous-output-permission-sentinel.mp4',
    );
    const previousOutputBytes = Buffer.from(
      'pre-existing output sentinel; not a media file',
    );
    await writeFile(previousOutputPath, previousOutputBytes);
    const targetPath = path.join(
      fixture.outputDirectory,
      'copy-permission-denied.mp4',
    );
    const permissionError = Object.assign(
      new Error('permission denied'),
      { code: 'EACCES' },
    );
    const brokenStore: ExportPreparationFileStore = {
      create: (snapshotId) => fixture.fileStore.create(snapshotId),
      async writeAsset() {
        throw permissionError;
      },
      delete: (snapshotId) => fixture.fileStore.delete(snapshotId),
      dispose: () => fixture.fileStore.dispose(),
      getOwnedPath: (snapshotId) => fixture.fileStore.getOwnedPath(snapshotId),
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
      targetPath,
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const result = await service.prepare(
      requestFor(fixture, selection.selectionId),
    );

    expect(result.status).toBe('BLOCK');
    if (result.status === 'BLOCK') {
      const expectedLocations = collectExportPreparationMedia(
        fixture.project,
      ).map((entry) => entry.usages[0] ?? '工程素材');
      const copyFailures = result.issues.filter(
        (item) => item.code === 'PREPARATION_FAILED',
      );
      expect(copyFailures).toHaveLength(expectedLocations.length);
      expect(copyFailures).toEqual(
        expect.arrayContaining(
          expectedLocations.map((location) =>
            expect.objectContaining({
              code: 'PREPARATION_FAILED',
              location,
              problem: '所需素材无法写入临时准备目录，目录权限可能受限。',
              nextStep: '检查系统临时目录的写入权限后重新检查；工程和已有输出未被修改。',
            }),
          ),
        ),
      );
      expect(result.issues.map((item) => item.code)).not.toContain(
        'REQUIRED_MEDIA_UNAVAILABLE',
      );
    }
    await expect(readFile(projectFilePath)).resolves.toEqual(projectBytes);
    await expect(readFile(previousOutputPath)).resolves.toEqual(
      previousOutputBytes,
    );
    await expect(readFile(targetPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readDirectoryOrEmpty(fixture.fileStore.rootDirectory),
    ).resolves.toEqual([]);
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
