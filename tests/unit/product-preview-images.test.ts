import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import type { AssetCanvasImageReadResponse } from '../../src/shared/asset-canvas-image-api';
import { ProductPreviewImageSession } from '../../src/renderer/shell/productPreviewImages';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:\\preview-images.pandastage';
const HASH = 'a'.repeat(64);

function imageProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === IDS.assetBg ? { ...asset, sha256: HASH } : asset,
    ),
  });
}

function readyImage(): AssetCanvasImageReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId: IDS.assetBg,
    mimeType: 'image/png',
    width: 1_920,
    height: 1_080,
    byteLength: 4,
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe('Product Preview bounded-original image session — Phase 2 gate C', () => {
  it('uses the existing canvas-image request and revokes every owned URL', async () => {
    const project = imageProject();
    const requests: unknown[] = [];
    const blobs: Array<{ size: number; type: string }> = [];
    const revoked: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async (request) => {
        requests.push(request);
        return readyImage();
      },
      createObjectUrl: (blob) => {
        blobs.push({ size: blob.size, type: blob.type });
        return 'blob:original-image';
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });

    const state = await session.load(PROJECT_ROOT, project, [IDS.assetBg]);

    expect(requests).toEqual([
      { projectRoot: PROJECT_ROOT, assetId: IDS.assetBg, sha256: HASH },
    ]);
    expect(blobs).toEqual([{ size: 4, type: 'image/png' }]);
    expect(state).toEqual({
      status: 'ready',
      urls: { [IDS.assetBg]: 'blob:original-image' },
      missingCount: 0,
    });
    session.dispose();
    expect(revoked).toEqual(['blob:original-image']);
  });

  it('ignores a late image response after dispose without URL or stale state', async () => {
    const project = imageProject();
    const read = deferred<AssetCanvasImageReadResponse>();
    const created: string[] = [];
    const revoked: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: () => read.promise,
      createObjectUrl: () => {
        created.push('blob:late-image');
        return 'blob:late-image';
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });

    const result = session.load(PROJECT_ROOT, project, [IDS.assetBg]);
    session.dispose();
    read.resolve(readyImage());

    await expect(result).resolves.toBeNull();
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('revokes immediately if disposal occurs during image URL creation', async () => {
    const project = imageProject();
    const revoked: string[] = [];
    const holder: { session?: ProductPreviewImageSession } = {};
    const session = new ProductPreviewImageSession({
      readCanvasImage: async () => readyImage(),
      createObjectUrl: () => {
        holder.session?.dispose();
        return 'blob:dispose-during-image-create';
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    holder.session = session;

    await expect(
      session.load(PROJECT_ROOT, project, [IDS.assetBg]),
    ).resolves.toBeNull();
    expect(revoked).toEqual(['blob:dispose-during-image-create']);
  });

  it('reports unreadable assets without exposing a thumbnail fallback', async () => {
    const project = imageProject();
    const session = new ProductPreviewImageSession({
      readCanvasImage: async () => ({
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
          message: 'safe failure',
          assetId: IDS.assetBg,
        },
      }),
    });

    await expect(
      session.load(PROJECT_ROOT, project, [IDS.assetBg]),
    ).resolves.toEqual({ status: 'error', urls: {}, missingCount: 1 });
    session.dispose();
  });
});
