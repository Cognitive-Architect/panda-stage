import { describe, expect, it } from 'vitest';
import { AssetSchema } from '../../src/domain';
import {
  AssetMetadataRequestSchema,
  AssetMetadataResponseSchema,
} from '../../src/shared/asset-metadata-api';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('asset metadata contracts', () => {
  it('accepts persisted SHA-256 and structured metadata state', () => {
    const asset = AssetSchema.parse({
      ...exampleProject.assets[0],
      sha256: 'a'.repeat(64),
      metadata: {
        status: 'ready',
        warnings: [
          {
            code: 'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
            message: '缓存可稍后重建。',
          },
        ],
      },
    });

    expect(asset.sha256).toBe('a'.repeat(64));
    expect(asset.metadata?.status).toBe('ready');
  });

  it('requires a non-negative integer duration and exact cache path contract', () => {
    const project = structuredClone(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const response = AssetMetadataResponseSchema.parse({
      ok: true,
      project,
      result: {
        status: 'ready',
        asset: audio,
        thumbnail: null,
        warnings: [],
      },
    });
    expect(response.ok).toBe(true);
    expect(() =>
      AssetSchema.parse({ ...audio, durationMs: 1.5 }),
    ).toThrow();
  });

  it('rejects malformed requests and cache descriptors outside cache/', () => {
    expect(() =>
      AssetMetadataRequestSchema.parse({
        projectRoot: 'D:\\project.pandastage',
        assetId: 'not-a-uuid',
      }),
    ).toThrow();
    expect(() =>
      AssetMetadataResponseSchema.parse({
        ok: true,
        project: exampleProject,
        result: {
          status: 'ready',
          asset: exampleProject.assets[0],
          thumbnail: {
            relativePath: 'assets/full-size.png',
            width: 16,
            height: 12,
            cacheHit: false,
          },
          warnings: [],
        },
      }),
    ).toThrow();
  });
});
