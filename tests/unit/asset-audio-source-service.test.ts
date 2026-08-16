import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import { AssetAudioSourceService } from '../../src/main/services/AssetAudioSourceService';
import { AssetAudioReadResponseSchema } from '../../src/shared/asset-audio-api';
import { buildProject } from './domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000099';
const roots: string[] = [];

async function fixture(relativePath = 'assets/voice.wav') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'panda-audio-source-'));
  roots.push(root);
  const bytes = Buffer.from('Panda Stage Day 28 audio fixture');
  const sourcePath = path.join(root, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
  const project = ProjectSchema.parse({
    ...buildProject(),
    assets: [
      ...buildProject().assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: 'voice.wav',
        relativePath,
        mimeType: 'audio/wav',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        durationMs: 500,
      },
    ],
  });
  return { root, bytes, project, sha256: project.assets.at(-1)!.sha256! };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('AssetAudioSourceService', () => {
  it('reads a project-owned audio file with hash and bounded data-url metadata', async () => {
    const input = await fixture();
    const service = new AssetAudioSourceService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    const response = await service.read({
      projectRoot: input.root,
      assetId: AUDIO_ID,
      sha256: input.sha256,
    });
    const parsed = AssetAudioReadResponseSchema.parse(response);
    expect(parsed).toMatchObject({
      ok: true,
      status: 'ready',
      assetId: AUDIO_ID,
      mimeType: 'audio/wav',
      byteLength: input.bytes.byteLength,
    });
    if (parsed.ok && parsed.status === 'ready') {
      expect(Buffer.from(parsed.dataUrl.split(',')[1]!, 'base64')).toEqual(input.bytes);
    }
  });

  it('rejects untracked, unknown, stale-hash, missing, and outside sources', async () => {
    const input = await fixture();
    const request = {
      projectRoot: input.root,
      assetId: AUDIO_ID,
      sha256: input.sha256,
    };
    await expect(
      new AssetAudioSourceService({ getCurrentProjectSnapshot: () => null }).read(request),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_AUDIO_PROJECT_NOT_TRACKED' } });
    const service = new AssetAudioSourceService({
      getCurrentProjectSnapshot: () => ({ project: input.project }),
    });
    await expect(service.read({ ...request, sha256: 'b'.repeat(64) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ASSET_AUDIO_HASH_MISMATCH' },
    });
    await expect(
      service.read({ ...request, assetId: '10000000-0000-4000-8000-000000000098' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_AUDIO_ASSET_NOT_FOUND' } });
    const missing = await fixture('assets/missing.wav');
    const missingService = new AssetAudioSourceService({
      getCurrentProjectSnapshot: () => ({ project: missing.project }),
    });
    await rm(path.join(missing.root, 'assets/missing.wav'));
    await expect(
      missingService.read({
        projectRoot: missing.root,
        assetId: AUDIO_ID,
        sha256: missing.sha256,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_AUDIO_SOURCE_MISSING' } });
    const outsideProject = {
      ...input.project,
      assets: input.project.assets.map((asset) =>
        asset.id === AUDIO_ID ? { ...asset, relativePath: 'assets2/voice.wav' } : asset,
      ),
    } as Project;
    await expect(
      new AssetAudioSourceService({
        getCurrentProjectSnapshot: () => ({ project: outsideProject }),
      }).read(request),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_AUDIO_SOURCE_MISSING' } });
  });
});
