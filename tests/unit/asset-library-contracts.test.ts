import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import {
  AssetDeleteRequestSchema,
  AssetDeleteResponseSchema,
} from '../../src/shared/asset-delete-api';
import {
  AssetThumbnailReadRequestSchema,
  AssetThumbnailReadResponseSchema,
} from '../../src/shared/asset-thumbnail-api';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('asset library IPC contracts', () => {
  it('requires revision-aware deletion and structured references', () => {
    const request = AssetDeleteRequestSchema.parse({
      projectRoot: 'D:\\project.pandastage',
      project: migrateProject(exampleProject),
      baseRevision: 3,
      assetId: exampleProject.assets[0]!.id,
    });
    expect(request.baseRevision).toBe(3);
    const response = AssetDeleteResponseSchema.parse({
      ok: false,
      error: {
        code: 'ASSET_DELETE_REFERENCED',
        message: '素材仍在使用。',
        projectRoot: request.projectRoot,
        assetId: request.assetId,
        references: [
          {
            kind: 'shot-background',
            path: 'shots[0].layers[0].source.assetId',
            label: '镜头“Opening”的背景“Background”',
          },
        ],
      },
    });
    expect(response.ok).toBe(false);
  });

  it('rejects deletion payloads without the project snapshot', () => {
    expect(() =>
      AssetDeleteRequestSchema.parse({
        projectRoot: 'D:\\project.pandastage',
        baseRevision: 3,
        assetId: exampleProject.assets[0]!.id,
      }),
    ).toThrow();
  });

  it('accepts thumbnail data only through the PNG data URL contract', () => {
    const request = AssetThumbnailReadRequestSchema.parse({
      projectRoot: 'D:\\project.pandastage',
      assetId: exampleProject.assets[0]!.id,
      sha256: 'a'.repeat(64),
    });
    expect(
      AssetThumbnailReadResponseSchema.parse({
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toMatchObject({ status: 'ready' });
    expect(() =>
      AssetThumbnailReadResponseSchema.parse({
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        dataUrl: 'file:///D:/project/assets/original.png',
      }),
    ).toThrow();
    expect(
      AssetThumbnailReadRequestSchema.parse({
        projectRoot: 'D:\\project.pandastage',
        assetId: exampleProject.assets[0]!.id,
      }),
    ).not.toHaveProperty('sha256');
    expect(
      AssetThumbnailReadResponseSchema.parse({
        ok: false,
        error: {
          code: 'ASSET_THUMBNAIL_SOURCE_MISSING',
          message: '源文件缺失，无法重建缩略图：assets/panda-happy.png',
          assetId: exampleProject.assets[0]!.id,
          relativePath: 'assets/panda-happy.png',
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ASSET_THUMBNAIL_SOURCE_MISSING' },
    });
  });
});
