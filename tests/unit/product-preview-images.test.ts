import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import type { AssetCanvasImageReadResponse } from '../../src/shared/asset-canvas-image-api';
import { ProductPreviewImageSession } from '../../src/renderer/shell/productPreviewImages';
import {
  applyProductPreviewMouthFallback,
  buildProductPreviewImagePlan,
  projectProductPreviewMouth,
  type ProductPreviewImagePlan,
} from '../../src/renderer/shell/productPreviewModel';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:\\preview-images.pandastage';
const HASH = 'a'.repeat(64);
const MOUTH_ID = '10000000-0000-4000-8000-000000000004';
const ALT_FACE_ID = '10000000-0000-4000-8000-000000000005';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000004';
const AUDIO_CLIP_ID = '70000000-0000-4000-8000-000000000004';
const AUDIO_ID = '10000000-0000-4000-8000-000000000006';

function imageProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === IDS.assetBg ? { ...asset, sha256: HASH } : asset,
    ),
  });
}

function compositePreviewProject(): Project {
  const base = buildProject();
  const character = base.characters[0]!;
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets.map((asset) =>
        asset.kind === 'image' ? { ...asset, sha256: HASH } : asset,
      ),
      {
        id: MOUTH_ID,
        kind: 'image' as const,
        name: 'mouth-open',
        relativePath: 'assets/mouth-open.png',
        mimeType: 'image/png',
        width: 120,
        height: 80,
        sha256: 'b'.repeat(64),
      },
      {
        id: ALT_FACE_ID,
        kind: 'image' as const,
        name: 'alternate-face',
        relativePath: 'assets/alternate-face.png',
        mimeType: 'image/png',
        width: 220,
        height: 120,
        sha256: 'c'.repeat(64),
      },
      {
        id: AUDIO_ID,
        kind: 'audio' as const,
        name: 'voice',
        relativePath: 'assets/voice.wav',
        mimeType: 'audio/wav',
        durationMs: 1_000,
        sha256: 'd'.repeat(64),
      },
    ],
    characters: [
      {
        ...character,
        mode: 'composite' as const,
        baseAssetId: IDS.assetChar2,
        expressions: [
          {
            id: IDS.expressionNormal,
            name: 'normal-face',
            assetId: IDS.assetChar2,
          },
          {
            id: IDS.expressionAngry,
            name: 'alternate-face',
            assetId: ALT_FACE_ID,
          },
        ],
        defaultExpressionId: IDS.expressionNormal,
        bodyAssetId: IDS.assetChar,
        facePlacement: { offsetX: 120, offsetY: -40, scale: 0.5 },
        mouthOpenAssetId: MOUTH_ID,
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [
        {
          id: DIALOGUE_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: AUDIO_CLIP_ID,
          startMs: 0,
          endMs: 1_000,
          text: 'speaking',
        },
      ],
      audioClips: [
        {
          id: AUDIO_CLIP_ID,
          name: 'voice',
          assetId: AUDIO_ID,
          startMs: 0,
          endMs: 1_000,
          offsetMs: 0,
          volume: 1,
        },
      ],
    })),
  });
}

function compositePlan(project: Project): {
  project: Project;
  plan: ProductPreviewImagePlan;
  shot: Project['shots'][number];
  renderedShot: ReturnType<typeof evaluateShotAtTime>;
} {
  const shot = project.shots[0]!;
  const renderedShot = projectProductPreviewMouth(
    project,
    shot,
    evaluateShotAtTime(shot, 0, project),
    DIALOGUE_ID,
  );
  return {
    project,
    plan: buildProductPreviewImagePlan(project, shot, renderedShot),
    shot,
    renderedShot,
  };
}

function failedImage(assetId: string): AssetCanvasImageReadResponse {
  return {
    ok: false,
    error: {
      code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
      message: `failed ${assetId}`,
      assetId,
    },
  };
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

  it('classifies a failed Mouth as degraded and falls back to the current Expression', async () => {
    const fixture = compositePlan(compositePreviewProject());
    let urlIndex = 0;
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) =>
        assetId === MOUTH_ID ? failedImage(assetId) : readyImage(assetId),
      createObjectUrl: (blob) => `blob:${blob.size}:${urlIndex++}`,
    });

    const state = await session.load(PROJECT_ROOT, fixture.project, fixture.plan);

    expect(state).toMatchObject({
      status: 'degraded',
      degradedAssetIds: [MOUTH_ID],
      fatalAssetIds: [],
    });
    expect(state?.urls).toHaveProperty(IDS.assetChar);
    expect(state?.urls).toHaveProperty(IDS.assetChar2);
    expect(state?.urls).not.toHaveProperty(MOUTH_ID);
    const fallbackShot = applyProductPreviewMouthFallback(
      fixture.project,
      fixture.shot,
      fixture.renderedShot,
      new Set(state?.degradedAssetIds),
    );
    expect(
      fallbackShot.layers.find((layer) => layer.id === IDS.layerChar),
    ).toMatchObject({
      assetId: IDS.assetChar2,
      mouthOverrideAssetId: null,
    });
    session.dispose();
  });

  it('keeps a fallback-loading Mouth in loading and makes Body failure fatal', async () => {
    const fixture = compositePlan(compositePreviewProject());
    const fallback = deferred<AssetCanvasImageReadResponse>();
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) => {
        if (assetId === MOUTH_ID) return failedImage(assetId);
        if (assetId === IDS.assetChar2) return fallback.promise;
        return readyImage(assetId);
      },
    });
    const load = session.load(PROJECT_ROOT, fixture.project, fixture.plan);
    await Promise.resolve();
    expect(
      session.snapshot(PROJECT_ROOT, fixture.project, fixture.plan).status,
    ).toBe('loading');
    fallback.resolve(readyImage(IDS.assetChar2));
    await expect(load).resolves.toMatchObject({ status: 'degraded' });
    session.dispose();

    const bodyFailure = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) =>
        assetId === IDS.assetChar ? failedImage(assetId) : readyImage(assetId),
    });
    await expect(
      bodyFailure.load(PROJECT_ROOT, fixture.project, fixture.plan),
    ).resolves.toMatchObject({
      status: 'error',
      fatalAssetIds: [IDS.assetChar],
    });
    bodyFailure.dispose();
  });

  it('does not let a failed bounded candidate block the exact current frame', async () => {
    const fixture = compositePlan(compositePreviewProject());
    const candidate = deferred<AssetCanvasImageReadResponse>();
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) =>
        assetId === ALT_FACE_ID ? candidate.promise : readyImage(assetId),
    });

    await expect(
      session.load(PROJECT_ROOT, fixture.project, fixture.plan),
    ).resolves.toMatchObject({ status: 'ready' });
    candidate.resolve(failedImage(ALT_FACE_ID));
    await candidate.promise;
    await Promise.resolve();
    expect(
      session.snapshot(PROJECT_ROOT, fixture.project, fixture.plan),
    ).toMatchObject({
      status: 'ready',
      optionalFailedAssetIds: [ALT_FACE_ID],
    });
    session.dispose();
  });
});
