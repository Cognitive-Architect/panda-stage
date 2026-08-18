import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import { AssetPreviewAudioService } from '../../src/main/services/AssetPreviewAudioService';
import type { MediaInspectionService } from '../../src/main/services/MediaInspectionService';
import {
  ASSET_PREVIEW_AUDIO_MAX_BYTES,
} from '../../src/shared/asset-preview-audio-api';
import { buildProject } from './domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000201';
const temporaryDirectories: string[] = [];

function createWav(): Buffer {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(4, 40);
  bytes.writeInt16LE(0, 44);
  bytes.writeInt16LE(0, 46);
  return bytes;
}

async function createAudioProject(options?: {
  writeSource?: boolean;
  relativePath?: string;
  bytes?: Buffer;
  durationMs?: number;
}) {
  const projectRoot = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-preview-audio-'),
  );
  temporaryDirectories.push(projectRoot);
  const bytes = options?.bytes ?? createWav();
  const relativePath = options?.relativePath ?? 'assets/source.wav';
  const sourcePath = path.join(projectRoot, relativePath);
  if (options?.writeSource !== false) {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, bytes);
  }
  const project = ProjectSchema.parse({
    ...buildProject(),
    assets: [
      ...buildProject().assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '测试对白',
        relativePath,
        mimeType: 'audio/wav',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        durationMs: options?.durationMs ?? 1_000,
      },
    ],
  });
  const asset = project.assets.find((candidate) => candidate.id === AUDIO_ID);
  if (!asset || asset.kind !== 'audio' || !asset.sha256) {
    throw new Error('audio fixture failed');
  }
  return {
    projectRoot,
    sourcePath,
    bytes,
    project,
    assetId: AUDIO_ID,
    sha256: asset.sha256,
  };
}

function request(input: Awaited<ReturnType<typeof createAudioProject>>) {
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

describe('AssetPreviewAudioService', () => {
  it('rejects malformed, untracked, unknown, non-audio, and hash-mismatched requests', async () => {
    const input = await createAudioProject();
    const service = new AssetPreviewAudioService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    await expect(service.read(null)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_PREVIEW_AUDIO_INVALID_REQUEST',
        assetId: '(invalid)',
      },
    });
    await expect(
      service.read({
        projectRoot: input.projectRoot,
        assetId: 'C:\\secret.wav',
        sha256: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { assetId: '(invalid)' },
    });
    await expect(
      new AssetPreviewAudioService({
        getCurrentProjectSnapshot: () => null,
      }).read(request(input)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_PROJECT_NOT_TRACKED' },
    });
    await expect(
      service.read({
        ...request(input),
        assetId: '10000000-0000-4000-8000-000000000299',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_ASSET_NOT_FOUND' },
    });
    await expect(
      new AssetPreviewAudioService({
        getCurrentProjectSnapshot: () => ({ project: buildProject() }),
      }).read({
        ...request(input),
        assetId: '10000000-0000-4000-8000-000000000002',
        sha256: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_NOT_AUDIO' },
    });
    await expect(
      service.read({ ...request(input), sha256: 'b'.repeat(64) }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_HASH_MISMATCH' },
    });
  });

  it('reads validated WAV bytes and returns no filesystem path', async () => {
    const input = await createAudioProject();
    const service = new AssetPreviewAudioService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    const response = await service.read(request(input));
    expect(response).toMatchObject({
      ok: true,
      status: 'ready',
      assetId: input.assetId,
      mimeType: 'audio/wav',
      byteLength: input.bytes.byteLength,
    });
    if (!response.ok) throw new Error('WAV fixture was not ready');
    expect(Buffer.from(response.bytes)).toEqual(input.bytes);
    expect(response.byteLength).toBe(response.bytes.byteLength);
    expect(JSON.stringify(response)).not.toContain(input.projectRoot);
  });

  it('enforces assets containment, declared MIME, and media signature', async () => {
    const traversal = await createAudioProject({
      writeSource: false,
    });
    await writeFile(path.join(traversal.projectRoot, 'outside.wav'), traversal.bytes);
    const traversalProject = {
      ...traversal.project,
      assets: traversal.project.assets.map((asset) =>
        asset.id === AUDIO_ID
          ? { ...asset, relativePath: 'assets/../outside.wav' }
          : asset,
      ),
    } as unknown as Project;
    await expect(
      new AssetPreviewAudioService({
        getCurrentProjectSnapshot: () => ({ project: traversalProject }),
      }).read(request(traversal)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const unsupported = await createAudioProject();
    const unsupportedProject = ProjectSchema.parse({
      ...unsupported.project,
      assets: unsupported.project.assets.map((asset) =>
        asset.id === AUDIO_ID ? { ...asset, mimeType: 'audio/ogg' } : asset,
      ),
    });
    await expect(
      new AssetPreviewAudioService({
        getCurrentProjectSnapshot: () => ({ project: unsupportedProject }),
      }).read(request(unsupported)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const invalid = await createAudioProject({ bytes: Buffer.from('not wav') });
    await expect(
      new AssetPreviewAudioService({
        getCurrentProjectSnapshot: () => ({ project: invalid.project }),
      }).read(request(invalid)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });
  });

  it('rejects missing, empty, directory, oversized, inspection, symlink, and changed sources', async () => {
    const serviceFor = (
      input: Awaited<ReturnType<typeof createAudioProject>>,
      inspectionService?: MediaInspectionService,
    ) =>
      new AssetPreviewAudioService({
        inspectionService,
        getCurrentProjectSnapshot: () => ({ project: input.project }),
      });

    const missing = await createAudioProject({ writeSource: false });
    await expect(serviceFor(missing).read(request(missing))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const empty = await createAudioProject({ writeSource: false });
    await mkdir(path.dirname(empty.sourcePath), { recursive: true });
    await writeFile(empty.sourcePath, Buffer.alloc(0));
    await expect(serviceFor(empty).read(request(empty))).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const directory = await createAudioProject({ writeSource: false });
    await mkdir(directory.sourcePath, { recursive: true });
    await expect(
      serviceFor(directory).read(request(directory)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const oversized = await createAudioProject({ writeSource: false });
    await mkdir(path.dirname(oversized.sourcePath), { recursive: true });
    const oversizedHandle = await open(oversized.sourcePath, 'w');
    await oversizedHandle.truncate(ASSET_PREVIEW_AUDIO_MAX_BYTES + 1);
    await oversizedHandle.close();
    await expect(
      serviceFor(oversized).read(request(oversized)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });

    const inspection = await createAudioProject();
    const inspectionService = {
      inspect: vi.fn().mockRejectedValue(new Error('outside path leaked')),
    } as unknown as MediaInspectionService;
    const inspectionResponse = await serviceFor(
      inspection,
      inspectionService,
    ).read(request(inspection));
    expect(inspectionResponse).toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });
    expect(JSON.stringify(inspectionResponse)).not.toContain(
      inspection.projectRoot,
    );

    const outside = await createAudioProject();
    const link = path.join(outside.projectRoot, 'assets', 'linked.wav');
    const external = path.join(outside.projectRoot, 'external.wav');
    await writeFile(external, outside.bytes);
    try {
      await symlink(external, link, 'file');
      const linkedProject = ProjectSchema.parse({
        ...outside.project,
        assets: outside.project.assets.map((asset) =>
          asset.id === AUDIO_ID
            ? { ...asset, relativePath: 'assets/linked.wav' }
            : asset,
        ),
      });
      await expect(
        new AssetPreviewAudioService({
          getCurrentProjectSnapshot: () => ({ project: linkedProject }),
        }).read(request(outside)),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
      });
    } catch {
      // Windows test hosts without symlink privileges still exercise the
      // lexical and realpath containment checks above.
    }

    const changed = await createAudioProject();
    await writeFile(changed.sourcePath, Buffer.concat([changed.bytes, Buffer.from([1])]));
    await expect(
      serviceFor(changed).read(request(changed)),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_HASH_MISMATCH' },
    });
  });

  it('deduplicates identical in-flight reads and clears the key after failure', async () => {
    const input = await createAudioProject({ writeSource: false });
    const service = new AssetPreviewAudioService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    const first = service.read(request(input));
    const second = service.read(request(input));
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_PREVIEW_AUDIO_READ_FAILED' },
    });
    await mkdir(path.dirname(input.sourcePath), { recursive: true });
    await writeFile(input.sourcePath, input.bytes);
    const retry = service.read(request(input));
    expect(retry).not.toBe(first);
    await expect(retry).resolves.toMatchObject({ ok: true, status: 'ready' });
    await expect(readFile(input.sourcePath)).resolves.toEqual(input.bytes);
  });
});
