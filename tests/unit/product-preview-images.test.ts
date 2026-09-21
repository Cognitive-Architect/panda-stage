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

function readyImage(assetId: string = IDS.assetBg): AssetCanvasImageReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId,
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

  it('reuses a SHA-compatible URL without resetting the active shot to loading', async () => {
    const project = imageProject();
    const requests: unknown[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async (request) => {
        requests.push(request);
        return readyImage(request.assetId);
      },
      createObjectUrl: () => 'blob:shared-image',
    });

    await session.prepare(PROJECT_ROOT, project, [IDS.assetBg]);
    const transition = session.prepare(PROJECT_ROOT, project, [IDS.assetBg]);

    expect(session.snapshot(PROJECT_ROOT, project, [IDS.assetBg])).toEqual({
      status: 'ready',
      urls: { [IDS.assetBg]: 'blob:shared-image' },
      missingCount: 0,
    });
    await transition;
    expect(requests).toHaveLength(1);
    session.dispose();
  });

  it('prepares only the next shot and makes its handoff immediately ready', async () => {
    const project = ProjectSchema.parse({
      ...imageProject(),
      assets: imageProject().assets.map((asset) => ({
        ...asset,
        sha256: asset.id === IDS.assetBg ? HASH : 'b'.repeat(64),
      })),
    });
    const requests: string[] = [];
    const revoked: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async (request) => {
        requests.push(request.assetId);
        return readyImage(request.assetId);
      },
      createObjectUrl: (() => {
        let index = 0;
        return () => (index++ === 0 ? 'blob:shot-a' : 'blob:shot-b');
      })(),
      revokeObjectUrl: (url) => revoked.push(url),
    });

    await session.prepare(
      PROJECT_ROOT,
      project,
      [IDS.assetBg],
      [IDS.assetChar],
    );
    await Promise.resolve();

    expect(session.snapshot(PROJECT_ROOT, project, [IDS.assetChar])).toEqual({
      status: 'ready',
      urls: { [IDS.assetChar]: 'blob:shot-b' },
      missingCount: 0,
    });
    await session.prepare(PROJECT_ROOT, project, [IDS.assetChar]);
    session.commitScope(PROJECT_ROOT, project, [IDS.assetChar]);
    expect(requests).toEqual([IDS.assetBg, IDS.assetChar]);
    expect(revoked).toEqual(['blob:shot-a']);
    session.dispose();
    expect(revoked).toEqual(['blob:shot-a', 'blob:shot-b']);
  });

  it('keeps the prior URL until a delayed next shot is ready, then revokes it', async () => {
    const project = ProjectSchema.parse({
      ...imageProject(),
      assets: imageProject().assets.map((asset) => ({
        ...asset,
        sha256: asset.id === IDS.assetBg ? HASH : 'b'.repeat(64),
      })),
    });
    const nextRead = deferred<AssetCanvasImageReadResponse>();
    const revoked: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: (request) =>
        request.assetId === IDS.assetBg
          ? Promise.resolve(readyImage(request.assetId))
          : nextRead.promise,
      createObjectUrl: (() => {
        let index = 0;
        return () => (index++ === 0 ? 'blob:shot-a' : 'blob:shot-b');
      })(),
      revokeObjectUrl: (url) => revoked.push(url),
    });

    await session.prepare(PROJECT_ROOT, project, [IDS.assetBg]);
    const handoff = session.prepare(PROJECT_ROOT, project, [IDS.assetChar]);

    expect(session.snapshot(PROJECT_ROOT, project, [IDS.assetChar]).status).toBe(
      'loading',
    );
    expect(revoked).toEqual([]);
    nextRead.resolve(readyImage(IDS.assetChar));
    await handoff;
    session.commitScope(PROJECT_ROOT, project, [IDS.assetChar]);
    expect(session.snapshot(PROJECT_ROOT, project, [IDS.assetChar]).status).toBe(
      'ready',
    );
    expect(revoked).toEqual(['blob:shot-a']);
    session.dispose();
  });

  it('cannot let a delayed old-shot read create or overwrite the active URL', async () => {
    const project = ProjectSchema.parse({
      ...imageProject(),
      assets: imageProject().assets.map((asset) => ({
        ...asset,
        sha256: asset.id === IDS.assetBg ? HASH : 'b'.repeat(64),
      })),
    });
    const oldRead = deferred<AssetCanvasImageReadResponse>();
    const created: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: (request) =>
        request.assetId === IDS.assetBg
          ? oldRead.promise
          : Promise.resolve(readyImage(request.assetId)),
      createObjectUrl: () => {
        const url = `blob:created-${created.length + 1}`;
        created.push(url);
        return url;
      },
    });

    const oldLoad = session.prepare(PROJECT_ROOT, project, [IDS.assetBg]);
    await session.prepare(PROJECT_ROOT, project, [IDS.assetChar]);
    session.commitScope(PROJECT_ROOT, project, [IDS.assetChar]);
    oldRead.resolve(readyImage(IDS.assetBg));
    await oldLoad;

    expect(created).toEqual(['blob:created-1']);
    expect(session.snapshot(PROJECT_ROOT, project, [IDS.assetChar])).toEqual({
      status: 'ready',
      urls: { [IDS.assetChar]: 'blob:created-1' },
      missingCount: 0,
    });
    session.dispose();
  });
});
