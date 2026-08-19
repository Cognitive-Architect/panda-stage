import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnimationImportIRSchema,
  type AnimationImportIR,
} from '../../src/shared/fla-import-api';
import {
  FlaAssetCommitRequestSchema,
  type FlaAssetCommitRequest,
} from '../../src/shared/fla-asset-commit-api';
import { migrateProject, ProjectSchema } from '../../src/domain';
import {
  AssetImportFileSystemService,
  type AssetImportFileSystemFaultInjector,
} from '../../src/main/services/AssetImportFileSystemService';
import {
  FlaAssetCommitJournalService,
  type FlaAssetCommitJournal,
} from '../../src/main/services/FlaAssetCommitJournalService';
import {
  FlaAssetCommitService,
  type FlaAssetCommitFaultInjector,
  type FlaAssetCommitSession,
} from '../../src/main/services/FlaAssetCommitService';
import { ProjectService } from '../../src/main/services/ProjectService';

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

function createRgbaPng(width: number, height: number, fill = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4), fill);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const ID_VALUES = Array.from(
  { length: 100 },
  (_, index) =>
    `26000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function media(
  id: string,
  name: string,
  bytes: Buffer,
  sourceFormat: 'png' | 'jpg',
  width: number,
  height: number,
  alpha: 'opaque' | 'transparent' = 'opaque',
): AnimationImportIR['media'][number] {
  return {
    id,
    name,
    sourceReference: `LIBRARY/${name}`,
    bitmapDataReference: `bitmap/${id}`,
    sourceFormat,
    width,
    height,
    payload: {
      mimeType: 'image/png',
      width,
      height,
      bytes,
      alpha: {
        kind: alpha,
        zeroAlphaPixels: alpha === 'transparent' ? width * height : 0,
        partialAlphaPixels: 0,
      },
    },
  };
}

function createIr(
  mediaItems: readonly AnimationImportIR['media'][number][],
): AnimationImportIR {
  const instances = mediaItems.map((item, index) => ({
    id: `fla-instance-item-${String(index + 1).padStart(4, '0')}`,
    mediaId: item.id,
    sourceLibraryItemName: item.name,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  }));
  return AnimationImportIRSchema.parse({
    source: {
      format: 'fla',
      basename: '文件.fla',
      byteLength: 1,
      sha256: 'a'.repeat(64),
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164',
      },
    },
    document: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      backgroundColor: '#ffffff',
    },
    media: mediaItems,
    timelines: [
      {
        id: 'fla-timeline-main-0001',
        name: 'Main',
        totalFrames: 1,
        layers: [
          {
            id: 'fla-layer-main-0001',
            name: 'Layer 1',
            sourceLayerIndex: 0,
            visible: true,
            locked: false,
            frames: [
              {
                id: 'fla-frame-main-0001',
                sourceFrameIndex: 0,
                startFrame: 0,
                duration: 1,
                instances,
              },
            ],
          },
        ],
      },
    ],
    compatibility: [],
    summary: {
      placedInstanceCount: instances.length,
      libraryOnlyMediaCount: 0,
    },
  });
}

interface Harness {
  parent: string;
  projectRoot: string;
  created: Awaited<ReturnType<ProjectService['create']>>;
  projectService: ProjectService;
  service: FlaAssetCommitService;
  createService: (
    options?: {
      fileSystem?: AssetImportFileSystemService;
      journal?: FlaAssetCommitJournalService;
      faults?: FlaAssetCommitFaultInjector;
    },
  ) => FlaAssetCommitService;
  current: { project: ReturnType<typeof migrateProject>; revision: number };
  setCurrent: (project: ReturnType<typeof migrateProject>, revision: number) => void;
  setSession: (session: FlaAssetCommitSession) => void;
  released: () => boolean;
  ir: AnimationImportIR;
}

async function harness(): Promise<Harness> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-fla-commit-'),
  );
  temporaryDirectories.push(parent);
  const projectRoot = path.join(parent, 'FLA Commit Test.pandastage');
  let idIndex = 0;
  const nextId = () => ID_VALUES[idIndex++] ?? ID_VALUES[0]!;
  const current: Harness['current'] = {
    project: undefined as unknown as ReturnType<typeof migrateProject>,
    revision: 0,
  };
  let activeSession: FlaAssetCommitSession | null = null;
  let sessionReleased = false;
  const projectService = new ProjectService({
    createId: nextId,
    now: () => new Date('2026-08-19T04:00:00.000Z'),
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) {
        current.project = project;
        current.revision = revision;
      }
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'FLA Commit Test',
  });
  current.project = created.project;
  current.revision = 0;
  const transparent = media(
    'fla-media-transparent-0001',
    '透明.png',
    createRgbaPng(2, 2),
    'png',
    2,
    2,
    'transparent',
  );
  const nonDefault = media(
    'fla-media-a1-item-0002',
    'a1.png',
    createRgbaPng(3, 1, 1),
    'png',
    3,
    1,
  );
  const jpegOrigin = media(
    'fla-media-jpeg-0003',
    '笑.jpg',
    createRgbaPng(1, 3, 2),
    'jpg',
    1,
    3,
  );
  const ir = createIr([transparent, nonDefault, jpegOrigin]);
  const sessionId = '26000000-0000-4000-8000-000000000257';
  activeSession = { sessionId, ir };
  const projectRootValue = projectRoot;
  const createService = (options: Parameters<Harness['createService']>[0] = {}) =>
    new FlaAssetCommitService({
      projectService,
      getCurrentProjectSnapshot: (root) =>
        root === projectRootValue ? current : null,
      getSession: (id) => (activeSession?.sessionId === id ? activeSession : null),
      releaseSession: () => {
        sessionReleased = true;
        activeSession = null;
      },
      createId: nextId,
      now: () => new Date('2026-08-19T04:10:00.000Z'),
      ...options,
    });
  const service = createService();
  return {
    parent,
    projectRoot,
    created,
    projectService,
    service,
    createService,
    current,
    setCurrent: (project, revision) => {
      current.project = project;
      current.revision = revision;
    },
    setSession: (session) => {
      activeSession = session;
      sessionReleased = false;
    },
    released: () => sessionReleased,
    ir,
  };
}

function request(
  harnessValue: Harness,
  selectedMediaIds = harnessValue.ir.media.map((item) => item.id),
): FlaAssetCommitRequest {
  return FlaAssetCommitRequestSchema.parse({
    format: 'fla-raster-commit',
    version: 1,
    projectRoot: harnessValue.projectRoot,
    project: harnessValue.current.project,
    baseRevision: harnessValue.current.revision,
    sessionId: '26000000-0000-4000-8000-000000000257',
    source: {
      basename: harnessValue.ir.source.basename,
      sha256: harnessValue.ir.source.sha256,
    },
    selectedMediaIds,
    selectedCount: selectedMediaIds.length,
    confirmed: true,
  });
}

async function assetEntries(projectRoot: string): Promise<string[]> {
  return (await readdir(path.join(projectRoot, 'assets'))).sort();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('FLA Slice 3 atomic Asset commit', () => {
  it('materializes a representative subset as ordinary PNG ImageAssets and reopens it', async () => {
    const value = await harness();
    const operation = await value.service.commit(request(value));

    expect(operation.projectChanged).toBe(true);
    expect(operation.savedRevision).toBe(1);
    expect(operation.summary).toEqual({
      selectedCount: 3,
      importedCount: 3,
      duplicateCount: 0,
      renamedCount: 0,
    });
    expect(operation.project.assets).toHaveLength(3);
    expect(operation.project.assets.every((asset) => asset.kind === 'image')).toBe(true);
    expect(operation.project.assets.every((asset) => asset.mimeType === 'image/png')).toBe(true);
    expect((await assetEntries(value.projectRoot)).filter((entry) => !entry.startsWith('.'))).toEqual(
      ['a1.png', '透明.png', '笑.png'].sort(),
    );
    expect((await assetEntries(value.projectRoot)).some((entry) => entry.endsWith('.fla'))).toBe(false);
    await expect(
      access(path.join(value.projectRoot, 'recovery', '.fla-asset-commit-journal.json')),
    ).rejects.toThrow();

    const reopened = await value.projectService.open(value.projectRoot);
    expect(reopened.project.assets).toEqual(operation.project.assets);
    expect(value.released()).toBe(true);
    for (const result of operation.results) {
      const file = await readFile(path.join(value.projectRoot, 'assets', result.targetFileName));
      expect(createHash('sha256').update(file).digest('hex')).toBe(result.sha256);
    }
  });

  it('reuses duplicate bytes and deterministically handles collisions and reserved names', async () => {
    const value = await harness();
    const first = await value.service.commit(request(value));
    const duplicate = media(
      'fla-media-duplicate-0004',
      '另一个.jpg',
      createRgbaPng(2, 2),
      'jpg',
      2,
      2,
    );
    const collision = media(
      'fla-media-collision-0005',
      '透明.png',
      createRgbaPng(4, 1, 3),
      'png',
      4,
      1,
    );
    const reserved = media(
      'fla-media-reserved-0006',
      'CON.jpg',
      createRgbaPng(5, 1, 4),
      'jpg',
      5,
      1,
    );
    const nextIr = createIr([duplicate, collision, reserved]);
    value.setSession({ sessionId: '26000000-0000-4000-8000-000000000257', ir: nextIr });
    const second = await value.service.commit(request(value, nextIr.media.map((item) => item.id)));

    expect(second.summary.importedCount).toBe(2);
    expect(second.summary.duplicateCount).toBe(1);
    expect(second.summary.renamedCount).toBe(1);
    expect(second.results.find((result) => result.mediaId === duplicate.id)).toMatchObject({
      status: 'duplicate',
      duplicateOfAssetId: first.results.find(
        (result) => result.mediaId === 'fla-media-transparent-0001',
      )!.asset.id,
    });
    expect(second.results.find((result) => result.mediaId === collision.id)?.targetFileName).toMatch(
      /^透明-[a-f0-9]{8}\.png$/u,
    );
    expect(second.results.find((result) => result.mediaId === reserved.id)?.targetFileName).toBe('_CON.png');
    expect((await assetEntries(value.projectRoot)).filter((entry) => !entry.startsWith('.'))).toHaveLength(5);
    const preserved = await readFile(path.join(value.projectRoot, 'assets', '透明.png'));
    expect(createHash('sha256').update(preserved).digest('hex')).toBe(
      first.results.find((result) => result.mediaId === 'fla-media-transparent-0001')?.sha256,
    );
  });

  it('rejects arbitrary renderer bytes and zero selection before any mutation', async () => {
    const value = await harness();
    const valid = request(value);
    await expect(
      value.service.commit({ ...valid, bytes: [1, 2, 3] }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(
      FlaAssetCommitRequestSchema.safeParse({ ...valid, sourcePath: 'C:\\outside.png' }).success,
    ).toBe(false);
    expect(
      FlaAssetCommitRequestSchema.safeParse({
        ...valid,
        selectedMediaIds: [],
        selectedCount: 0,
      }).success,
    ).toBe(false);
    expect(await assetEntries(value.projectRoot)).toEqual([]);
  });

  it('rejects an invalid selected PNG before journal or file mutation', async () => {
    const value = await harness();
    const invalid = media(
      'fla-media-invalid-png-0007',
      'invalid.png',
      Buffer.from('not a png'),
      'png',
      2,
      2,
    );
    value.setSession({
      sessionId: '26000000-0000-4000-8000-000000000257',
      ir: createIr([invalid]),
    });

    await expect(
      value.service.commit(request(value, [invalid.id])),
    ).rejects.toMatchObject({ code: 'ASSET_COMMIT_FAILED' });
    expect(await assetEntries(value.projectRoot)).toEqual([]);
    await expect(
      access(path.join(value.projectRoot, 'recovery', '.fla-asset-commit-journal.json')),
    ).rejects.toThrow();
    expect((await value.projectService.open(value.projectRoot)).project.assets).toEqual([]);
  });

  it('rolls back and clears artifacts for journal, staging, and post-save failures', async () => {
    const cases: Array<{
      name: string;
      createService: (value: Harness) => FlaAssetCommitService;
    }> = [
      {
        name: 'journal write',
        createService: (value) => value.createService({
          journal: new FlaAssetCommitJournalService({
            beforeWrite: () => { throw new Error('injected journal failure'); },
          }),
        }),
      },
      {
        name: 'journal sync',
        createService: (value) => value.createService({
          journal: new FlaAssetCommitJournalService({
            afterSync: () => { throw new Error('injected journal sync failure'); },
          }),
        }),
      },
      {
        name: 'staging write',
        createService: (value) => value.createService({
          fileSystem: new AssetImportFileSystemService({
            beforeFlaTemporaryWrite: () => { throw new Error('injected staging write failure'); },
          }),
        }),
      },
      {
        name: 'staging sync',
        createService: (value) => value.createService({
          fileSystem: new AssetImportFileSystemService({
            afterFlaTemporarySync: () => { throw new Error('injected staging failure'); },
          }),
        }),
      },
      {
        name: 'finalize postcondition',
        createService: (value) => value.createService({
          fileSystem: new AssetImportFileSystemService({
            afterFlaFinalize: () => { throw new Error('injected finalize postcondition failure'); },
          }),
        }),
      },
      {
        name: 'post-save consistency',
        createService: (value) => value.createService({
          faults: {
            afterConsistencyCheck: () => { throw new Error('injected consistency failure'); },
          },
        }),
      },
    ];

    for (const failure of cases) {
      const value = await harness();
      const projectFileBefore = await readFile(
        path.join(value.projectRoot, 'project.json'),
      );
      await expect(
        failure.createService(value).commit(request(value)),
      ).rejects.toMatchObject({ code: 'ASSET_COMMIT_FAILED' });
      expect(await assetEntries(value.projectRoot)).toEqual([]);
      expect(await readFile(path.join(value.projectRoot, 'project.json'))).toEqual(
        projectFileBefore,
      );
      expect((await value.projectService.open(value.projectRoot)).project.assets).toEqual([]);
      await expect(
        access(path.join(value.projectRoot, 'recovery', '.fla-asset-commit-journal.json')),
      ).rejects.toThrow();
    }
  });

  it('rolls back every finalized file when finalization or Project save fails', async () => {
    const value = await harness();
    let finalizeCount = 0;
    const finalizationFaults: AssetImportFileSystemFaultInjector = {
      beforeFlaFinalize: () => {
        finalizeCount += 1;
        if (finalizeCount === 2) throw new Error('injected finalize failure');
      },
    };
    await expect(
      value.createService({
        fileSystem: new AssetImportFileSystemService(finalizationFaults),
      }).commit(request(value)),
    ).rejects.toMatchObject({ code: 'ASSET_COMMIT_FAILED' });
    expect(await assetEntries(value.projectRoot)).toEqual([]);
    expect((await value.projectService.open(value.projectRoot)).project.assets).toEqual([]);

    const saveFailure = await harness();
    const projectFileBefore = await readFile(path.join(saveFailure.projectRoot, 'project.json'));
    await expect(
      saveFailure.createService({
        faults: { beforeProjectSave: () => { throw new Error('injected save failure'); } },
      }).commit(request(saveFailure)),
    ).rejects.toMatchObject({ code: 'ASSET_COMMIT_FAILED' });
    expect(await readFile(path.join(saveFailure.projectRoot, 'project.json'))).toEqual(projectFileBefore);
    expect(await assetEntries(saveFailure.projectRoot)).toEqual([]);
  });

  it('rejects a stale Project snapshot without files, Asset records, or journal mutation', async () => {
    const value = await harness();
    const changed = ProjectSchema.parse({
      ...value.current.project,
      updatedAt: '2026-08-19T05:00:00.000Z',
    });
    value.setCurrent(changed, 1);
    await expect(value.service.commit({
      ...request(value),
      project: value.created.project,
      baseRevision: 0,
    })).rejects.toMatchObject({ code: 'STALE_PROJECT_REVISION' });
    expect(await assetEntries(value.projectRoot)).toEqual([]);
    expect((await value.projectService.open(value.projectRoot)).project.assets).toEqual([]);
  });

  it('recovers an interrupted journal and preserves a durably saved operation', async () => {
    const value = await harness();
    const journal = new FlaAssetCommitJournalService();
    const interrupted: FlaAssetCommitJournal = {
      version: 1,
      operationId: '26000000-0000-4000-8000-000000000258',
      projectId: value.created.project.id,
      baseRevision: 0,
      phase: 'finalized',
      entries: [{
        assetId: ID_VALUES[20]!,
        sha256: 'b'.repeat(64),
        temporaryFileName: '.fla-asset-commit.26000000-0000-4000-8000-000000000258-0001.tmp',
        targetFileName: 'orphan.png',
      }],
    };
    await journal.write(value.projectRoot, interrupted);
    await writeFile(path.join(value.projectRoot, 'assets', interrupted.entries[0]!.temporaryFileName), Buffer.from('temp'));
    await writeFile(path.join(value.projectRoot, 'assets', interrupted.entries[0]!.targetFileName), Buffer.from('orphan'));
    await value.service.recoverProjectArtifacts(value.projectRoot, value.created.project);
    expect(await assetEntries(value.projectRoot)).toEqual([]);

    const committed = await value.service.commit(request(value));
    const committedEntry = {
      ...interrupted,
      phase: 'project-saved' as const,
      projectId: committed.project.id,
      baseRevision: committed.baseRevision,
      entries: [{
        assetId: committed.results[0]!.asset.id,
        sha256: committed.results[0]!.sha256,
        temporaryFileName: '.fla-asset-commit.26000000-0000-4000-8000-000000000258-0001.tmp',
        targetFileName: committed.results[0]!.targetFileName,
      }],
    } satisfies FlaAssetCommitJournal;
    await journal.write(value.projectRoot, committedEntry);
    await writeFile(path.join(value.projectRoot, 'assets', committedEntry.entries[0]!.temporaryFileName), Buffer.from('temp'));
    await value.service.recoverProjectArtifacts(value.projectRoot, committed.project);
    const reopened = await value.projectService.open(value.projectRoot);
    expect(reopened.project.assets).toHaveLength(3);
    await expect(
      access(path.join(value.projectRoot, 'assets', committedEntry.entries[0]!.targetFileName)),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(value.projectRoot, 'assets', committedEntry.entries[0]!.temporaryFileName)),
    ).rejects.toThrow();
  });

  it('preserves a durable Project when the journal is still finalized after the save', async () => {
    const value = await harness();
    const committed = await value.service.commit(request(value));
    const operationId = '26000000-0000-4000-8000-000000000259';
    const finalized: FlaAssetCommitJournal = {
      version: 1,
      operationId,
      projectId: committed.project.id,
      baseRevision: committed.baseRevision,
      phase: 'finalized',
      entries: committed.results.map((result, index) => ({
        assetId: result.asset.id,
        sha256: result.sha256,
        temporaryFileName: `.fla-asset-commit.${operationId}-${String(index + 1).padStart(4, '0')}.tmp`,
        targetFileName: result.targetFileName,
      })),
    };
    const journal = new FlaAssetCommitJournalService();
    await journal.write(value.projectRoot, finalized);
    for (const entry of finalized.entries) {
      await writeFile(
        path.join(value.projectRoot, 'assets', entry.temporaryFileName),
        Buffer.from('stale temporary output'),
      );
    }

    await value.service.recoverProjectArtifacts(
      value.projectRoot,
      committed.project,
    );

    expect((await assetEntries(value.projectRoot)).filter((entry) => !entry.startsWith('.'))).toEqual(
      committed.results.map((result) => result.targetFileName).sort(),
    );
    for (const result of committed.results) {
      const bytes = await readFile(
        path.join(value.projectRoot, 'assets', result.targetFileName),
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.sha256);
    }
    expect((await value.projectService.open(value.projectRoot)).project.assets).toEqual(
      committed.project.assets,
    );
    await expect(
      access(path.join(value.projectRoot, 'recovery', '.fla-asset-commit-journal.json')),
    ).rejects.toThrow();
    for (const entry of finalized.entries) {
      await expect(
        access(path.join(value.projectRoot, 'assets', entry.temporaryFileName)),
      ).rejects.toThrow();
    }
  });

  it('fails safely when a late journal disagrees with the durable Project or target file', async () => {
    const cases = ['missing-target', 'changed-target', 'path-mismatch'] as const;
    for (const scenario of cases) {
      const value = await harness();
      const committed = await value.service.commit(request(value));
      const result = committed.results[0]!;
      const operationId =
        scenario === 'missing-target'
          ? '26000000-0000-4000-8000-000000000260'
          : scenario === 'changed-target'
            ? '26000000-0000-4000-8000-000000000261'
            : '26000000-0000-4000-8000-000000000262';
      const targetFileName =
        scenario === 'path-mismatch' ? 'different-path.png' : result.targetFileName;
      const entry = {
        assetId: result.asset.id,
        sha256: result.sha256,
        temporaryFileName: `.fla-asset-commit.${operationId}-0001.tmp`,
        targetFileName,
      };
      const journal = new FlaAssetCommitJournalService();
      await journal.write(value.projectRoot, {
        version: 1,
        operationId,
        projectId: committed.project.id,
        baseRevision: committed.baseRevision,
        phase: 'finalized',
        entries: [entry],
      });
      await writeFile(
        path.join(value.projectRoot, 'assets', entry.temporaryFileName),
        Buffer.from('stale temporary output'),
      );
      if (scenario === 'missing-target') {
        await rm(
          path.join(value.projectRoot, 'assets', result.targetFileName),
          { force: true },
        );
      } else if (scenario === 'changed-target') {
        await writeFile(
          path.join(value.projectRoot, 'assets', result.targetFileName),
          Buffer.from('changed committed output'),
        );
      } else {
        await writeFile(
          path.join(value.projectRoot, 'assets', targetFileName),
          await readFile(
            path.join(value.projectRoot, 'assets', result.targetFileName),
          ),
        );
      }

      await expect(
        value.service.recoverProjectArtifacts(
          value.projectRoot,
          committed.project,
        ),
      ).rejects.toMatchObject({ code: 'JOURNAL_RECOVERY_FAILED' });
      await expect(
        access(path.join(value.projectRoot, 'recovery', '.fla-asset-commit-journal.json')),
      ).resolves.toBeUndefined();
      await expect(
        access(path.join(value.projectRoot, 'assets', entry.temporaryFileName)),
      ).rejects.toThrow();
    }
  });
});
