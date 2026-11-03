import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import type { AssetCanvasImageReadResponse } from '../../src/shared/asset-canvas-image-api';
import {
  MAX_CONCURRENT_PREVIEW_IMAGE_READS,
  MAX_NEXT_PREVIEW_IMAGE_CACHE,
  MAX_OPTIONAL_PREVIEW_IMAGE_READS,
  MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES,
  MAX_RETAINED_PREVIEW_CANDIDATE_BYTES,
  ProductPreviewImageSession,
} from '../../src/renderer/shell/productPreviewImages';
import {
  applyProductPreviewMouthFallback,
  buildProductPreviewImagePlan,
  gateProductPreviewImagePrewarm,
  isProductPreviewMouthFallbackFailure,
  projectProductPreviewMouth,
  PRODUCT_PREVIEW_ANIMATION_PREWARM_FRAMES,
  PRODUCT_PREVIEW_MAX_RECENT_ANIMATION_ASSETS,
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
const HEAD_ID = '10000000-0000-4000-8000-000000000009';
const ANIMATION_FRAME_A_ID = '10000000-0000-4000-8000-000000000010';
const ANIMATION_FRAME_B_ID = '10000000-0000-4000-8000-000000000011';
const SECOND_ANIMATION_LAYER_ID = '70000000-0000-4000-8000-000000000003';

function imageProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === IDS.assetBg ? { ...asset, sha256: HASH } : asset,
    ),
  });
}

function compositePreviewProject(options: { head?: boolean } = {}): Project {
  const base = buildProject();
  const hasHead = options.head ?? false;
  const character = base.characters[0]!;
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets.map((asset) =>
        asset.kind === 'image' ? { ...asset, sha256: HASH } : asset,
      ),
      ...(hasHead
        ? [
            {
              id: HEAD_ID,
              kind: 'image' as const,
              name: 'head',
              relativePath: 'assets/head.png',
              mimeType: 'image/png',
              width: 400,
              height: 600,
              sha256: 'e'.repeat(64),
              usage: 'uncategorized' as const,
              keywords: [],
            },
          ]
        : []),
      {
        id: MOUTH_ID,
        kind: 'image' as const,
        name: 'mouth-open',
        relativePath: 'assets/mouth-open.png',
        mimeType: 'image/png',
        width: 120,
        height: 80,
        sha256: 'b'.repeat(64),
        usage: 'uncategorized' as const,
        keywords: [],
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
        usage: 'uncategorized' as const,
        keywords: [],
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
        ...(hasHead
          ? {
              head: {
                assetId: HEAD_ID,
                placement: { offsetX: 10, offsetY: -360, scale: 0.75 },
                pivot: { x: 10, y: -300 },
              },
            }
          : {}),
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
          role: 'dialogue',
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

function animationPreviewProject(
  instances: Array<{
    id: string;
    startTimeMs: number;
    mode: 'once' | 'loop';
    endBehavior: 'hold' | 'hide';
  }>,
): Project {
  const base = compositePreviewProject();
  const frameAssets = [
    {
      id: ANIMATION_FRAME_A_ID,
      kind: 'image' as const,
      name: 'animation-frame-a',
      relativePath: 'assets/animation-frame-a.png',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      sha256: 'e'.repeat(64),
      usage: 'uncategorized' as const,
      keywords: [],
    },
    {
      id: ANIMATION_FRAME_B_ID,
      kind: 'image' as const,
      name: 'animation-frame-b',
      relativePath: 'assets/animation-frame-b.png',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      sha256: 'f'.repeat(64),
      usage: 'uncategorized' as const,
      keywords: [],
    },
  ];
  const frameAssetIds = [
    ANIMATION_FRAME_A_ID,
    ANIMATION_FRAME_B_ID,
    MOUTH_ID,
    ALT_FACE_ID,
  ];
  const animation = {
    id: IDS.animation,
    name: 'preview animation',
    source: {
      basename: 'preview.fla',
      sha256: '9'.repeat(64),
      renderTargetId: 'preview-target',
      targetKind: 'graphic-symbol' as const,
      targetName: 'preview animation',
      startFrameIndex: 0,
      endFrameIndex: frameAssetIds.length - 1,
      sourceFps: 10,
      canvas: { width: 100, height: 100 },
      documentCanvas: { width: 100, height: 100 },
      anchor: { x: 0, y: 0 },
    },
    durationMs: frameAssetIds.length * 100,
    frames: frameAssetIds.map((assetId, ordinal) => ({
      ordinal,
      sourceFrameIndex: ordinal,
      assetId,
      sha256: [...base.assets, ...frameAssets].find((asset) => asset.id === assetId)!.sha256!,
      sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
      offset: { x: 0, y: 0 },
      startMs: ordinal * 100,
      durationMs: 100,
      createdBySequenceImport: true,
    })),
  };
  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets],
    animations: [animation],
    shots: base.shots.map((shot) => ({
      ...shot,
      layers: [
        ...shot.layers,
        ...instances.map((instance, index) => ({
          id: instance.id,
          name: `animation-${index}`,
          source: { kind: 'animation' as const, animationId: IDS.animation },
          anchor: 'center' as const,
          x: 900 + index * 100,
          y: 500,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          zIndex: shot.layers.length + index,
          locked: false,
          flipX: false,
          startTimeMs: instance.startTimeMs,
          animationPlayback: {
            mode: instance.mode,
            endBehavior: instance.endBehavior,
          },
        })),
      ],
    })),
  });
}

function projectWithExtraImages(count: number): {
  project: Project;
  assetIds: string[];
} {
  const base = imageProject();
  const extras = Array.from({ length: count }, (_, index) => ({
    id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'image' as const,
    name: `queue-image-${index}`,
    relativePath: `assets/queue-image-${index}.png`,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    sha256: index.toString(16).padStart(64, '0'),
    usage: 'uncategorized' as const,
    keywords: [],
  }));
  return {
    project: ProjectSchema.parse({ ...base, assets: [...base.assets, ...extras] }),
    assetIds: extras.map((asset) => asset.id),
  };
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

function readyImage(
  assetId: string = IDS.assetBg,
  byteLength: number = 4,
): AssetCanvasImageReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId,
    mimeType: 'image/png',
    width: 1_920,
    height: 1_080,
    byteLength,
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
  it('stops optional image prewarm when playback is paused or the window is inactive', () => {
    const plan: ProductPreviewImagePlan = {
      requiredAssetIds: [MOUTH_ID],
      fallbackAssetIds: [ALT_FACE_ID],
      candidateAssetIds: [ANIMATION_FRAME_A_ID],
      recentAnimationAssetIds: [ANIMATION_FRAME_A_ID],
      mouthFallbacks: [
        {
          partId: 'mouth-part',
          sourceAssetId: MOUTH_ID,
          fallbackAssetId: ALT_FACE_ID,
        },
      ],
    };

    expect(gateProductPreviewImagePrewarm(plan, true)).toBe(plan);
    expect(gateProductPreviewImagePrewarm(plan, false)).toEqual({
      ...plan,
      candidateAssetIds: [],
      recentAnimationAssetIds: [],
    });
  });

  it('warms a small upcoming animation window using each instance clock and playback mode', () => {
    const project = animationPreviewProject([
      {
        id: IDS.animationLayer,
        startTimeMs: 0,
        mode: 'loop',
        endBehavior: 'hold',
      },
      {
        id: SECOND_ANIMATION_LAYER_ID,
        startTimeMs: 200,
        mode: 'once',
        endBehavior: 'hide',
      },
    ]);
    const shot = project.shots[0]!;
    const currentPlan = buildProductPreviewImagePlan(
      project,
      shot,
      evaluateShotAtTime(shot, 150, project),
    );

    expect(currentPlan.requiredAssetIds).toContain(ANIMATION_FRAME_B_ID);
    expect(currentPlan.recentAnimationAssetIds).toEqual([
      MOUTH_ID,
      ALT_FACE_ID,
    ]);
    expect(
      currentPlan.candidateAssetIds.slice(
        0,
        currentPlan.recentAnimationAssetIds.length,
      ),
    ).toEqual(
      currentPlan.recentAnimationAssetIds,
    );
    expect(currentPlan.recentAnimationAssetIds.length).toBeLessThanOrEqual(
      PRODUCT_PREVIEW_MAX_RECENT_ANIMATION_ASSETS,
    );
    const animationFrameAssetIds = new Set(
      project.animations[0]!.frames.map((frame) => frame.assetId),
    );
    expect(
      currentPlan.candidateAssetIds.filter((assetId) =>
        animationFrameAssetIds.has(assetId),
      ),
    ).toEqual(currentPlan.recentAnimationAssetIds);
    expect(PRODUCT_PREVIEW_ANIMATION_PREWARM_FRAMES).toBe(3);

    const loopProject = animationPreviewProject([
      {
        id: IDS.animationLayer,
        startTimeMs: 0,
        mode: 'loop',
        endBehavior: 'hold',
      },
    ]);
    const loopShot = loopProject.shots[0]!;
    const wrapped = buildProductPreviewImagePlan(
      loopProject,
      loopShot,
      evaluateShotAtTime(loopShot, 450, loopProject),
    );
    expect(wrapped.requiredAssetIds).toContain(ANIMATION_FRAME_A_ID);
    expect(wrapped.recentAnimationAssetIds).toEqual([
      ANIMATION_FRAME_B_ID,
      MOUTH_ID,
      ALT_FACE_ID,
    ]);

    for (const endBehavior of ['hold', 'hide'] as const) {
      const onceProject = animationPreviewProject([
        {
          id: IDS.animationLayer,
          startTimeMs: 0,
          mode: 'once',
          endBehavior,
        },
      ]);
      const onceShot = onceProject.shots[0]!;
      const ended = buildProductPreviewImagePlan(
        onceProject,
        onceShot,
        evaluateShotAtTime(onceShot, 450, onceProject),
      );
      expect(ended.recentAnimationAssetIds).toEqual([]);
    }
  });

  it('requires and preloads Head through the existing Product Preview image plan', async () => {
    const fixture = compositePlan(compositePreviewProject({ head: true }));
    const requested: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) => {
        requested.push(assetId);
        return readyImage(assetId);
      },
      createObjectUrl: () => `blob:head-enabled`,
    });

    expect(fixture.plan.requiredAssetIds).toContain(HEAD_ID);
    await expect(
      session.load(PROJECT_ROOT, fixture.project, fixture.plan),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(requested).toContain(HEAD_ID);
    expect(
      session.snapshot(PROJECT_ROOT, fixture.project, fixture.plan)?.urls,
    ).toHaveProperty(HEAD_ID);
    session.dispose();
  });

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
    expect(session.getDiagnostics()).toMatchObject({ readRequests: 1 });
    expect(session.getDiagnostics().cacheHits).toBeGreaterThan(0);
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

  it('allows fallback only for the active Mouth Face part and keeps required Face failures fatal', () => {
    const fixture = compositePlan(compositePreviewProject());
    const mouthRule = fixture.plan.mouthFallbacks[0]!;

    expect(mouthRule).toEqual({
      partId: `${IDS.layerChar}:face`,
      sourceAssetId: MOUTH_ID,
      fallbackAssetId: IDS.assetChar2,
    });
    expect(
      isProductPreviewMouthFallbackFailure(fixture.plan, {
        partId: mouthRule.partId,
        assetId: MOUTH_ID,
      }),
    ).toBe(true);
    expect(
      isProductPreviewMouthFallbackFailure(fixture.plan, {
        partId: `${IDS.layerChar}:body`,
        assetId: IDS.assetChar,
      }),
    ).toBe(false);

    const expressionShot = evaluateShotAtTime(fixture.shot, 1_500, fixture.project);
    const expressionPlan = buildProductPreviewImagePlan(
      fixture.project,
      fixture.shot,
      expressionShot,
    );
    expect(expressionPlan.mouthFallbacks).toEqual([]);
    const currentFaceAssetId = expressionPlan.requiredAssetIds.find(
      (assetId) =>
        assetId !== IDS.assetBg && assetId !== IDS.assetChar,
    );
    expect(currentFaceAssetId).toBe(IDS.assetChar2);
    expect(
      isProductPreviewMouthFallbackFailure(expressionPlan, {
        partId: `${IDS.layerChar}:face`,
        assetId: currentFaceAssetId!,
      }),
    ).toBe(false);
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

  it('prioritizes required and recent frames ahead of other candidates and the next shot', async () => {
    const { project, assetIds } = projectWithExtraImages(6);
    const [recentA, recentB, recentC, otherA, otherB, nextShot] = assetIds;
    const requested: string[] = [];
    const reads = new Map<
      string,
      ReturnType<typeof deferred<AssetCanvasImageReadResponse>>
    >();
    const session = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        requested.push(assetId);
        const read = deferred<AssetCanvasImageReadResponse>();
        reads.set(assetId, read);
        return read.promise;
      },
    });
    const scope = {
      requiredAssetIds: [IDS.assetBg],
      recentAnimationAssetIds: [recentA!, recentB!, recentC!],
      candidateAssetIds: [recentA!, recentB!, recentC!, otherA!, otherB!],
    };
    const load = session.prepare(PROJECT_ROOT, project, scope, [nextShot!]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requested).toEqual([IDS.assetBg, recentA, recentB]);
    expect(session.getDiagnostics()).toMatchObject({
      inFlightCount: MAX_CONCURRENT_PREVIEW_IMAGE_READS,
      optionalInFlightCount: MAX_OPTIONAL_PREVIEW_IMAGE_READS,
    });

    reads.get(IDS.assetBg)!.resolve(readyImage(IDS.assetBg));
    await expect(load).resolves.toMatchObject({ status: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested).toEqual([IDS.assetBg, recentA, recentB]);

    reads.get(recentA!)!.resolve(readyImage(recentA));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested[3]).toBe(recentC);

    reads.get(recentB!)!.resolve(readyImage(recentB));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested[4]).toBe(otherA);

    reads.get(recentC!)!.resolve(readyImage(recentC));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested[5]).toBe(otherB);

    reads.get(otherA!)!.resolve(readyImage(otherA));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested[6]).toBe(nextShot);

    reads.get(otherB!)!.resolve(readyImage(otherB));
    reads.get(nextShot!)!.resolve(readyImage(nextShot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.dispose();
  });

  it('limits speculative next-shot reads to the configured cache window', async () => {
    const { project, assetIds } = projectWithExtraImages(12);
    const requested: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) => {
        requested.push(assetId);
        return readyImage(assetId);
      },
      createObjectUrl: (() => {
        let index = 0;
        return () => `blob:next-window-${index++}`;
      })(),
    });

    await expect(
      session.prepare(PROJECT_ROOT, project, {
        requiredAssetIds: [IDS.assetBg],
      }, assetIds),
    ).resolves.toMatchObject({ status: 'ready' });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const diagnostics = session.getDiagnostics();
      if (diagnostics.inFlightCount === 0 && diagnostics.queuedOptionalCount === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(requested).toEqual([
      IDS.assetBg,
      ...assetIds.slice(0, MAX_NEXT_PREVIEW_IMAGE_CACHE),
    ]);
    expect(requested).not.toContain(assetIds[MAX_NEXT_PREVIEW_IMAGE_CACHE]);
    session.dispose();
  });

  it('reuses a recently prepared animation frame when it becomes current', async () => {
    const project = animationPreviewProject([
      {
        id: IDS.animationLayer,
        startTimeMs: 0,
        mode: 'loop',
        endBehavior: 'hold',
      },
    ]);
    const shot = project.shots[0]!;
    const firstPlan = buildProductPreviewImagePlan(
      project,
      shot,
      evaluateShotAtTime(shot, 150, project),
    );
    const requests: string[] = [];
    const session = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) => {
        requests.push(assetId);
        return readyImage(assetId);
      },
      createObjectUrl: (() => {
        let index = 0;
        return () => `blob:animation-frame-${index++}`;
      })(),
    });

    await expect(
      session.prepare(PROJECT_ROOT, project, firstPlan),
    ).resolves.toMatchObject({ status: 'ready' });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const diagnostics = session.getDiagnostics();
      if (diagnostics.inFlightCount === 0 && diagnostics.queuedOptionalCount === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    session.commitScope(PROJECT_ROOT, project, firstPlan);
    const readsBeforePromotion = requests.length;
    const nextPlan = buildProductPreviewImagePlan(
      project,
      shot,
      evaluateShotAtTime(shot, 200, project),
    );

    expect(nextPlan.requiredAssetIds).toContain(MOUTH_ID);
    await expect(
      session.prepare(PROJECT_ROOT, project, nextPlan),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(requests).toHaveLength(readsBeforePromotion);
    expect(requests.filter((assetId) => assetId === MOUTH_ID)).toHaveLength(1);
    expect(session.getDiagnostics().cacheHits).toBeGreaterThan(0);
    session.dispose();
  });

  it('promotes a queued candidate to current required and ignores stale seek results', async () => {
    const { project, assetIds } = projectWithExtraImages(3);
    const [candidateA, candidateB, promoted] = assetIds;
    const requested: string[] = [];
    const createdUrls: string[] = [];
    const reads = new Map<
      string,
      ReturnType<typeof deferred<AssetCanvasImageReadResponse>>
    >();
    const session = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        requested.push(assetId);
        const read = deferred<AssetCanvasImageReadResponse>();
        reads.set(assetId, read);
        return read.promise;
      },
      createObjectUrl: () => {
        const url = `blob:promoted-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
    });
    const firstLoad = session.prepare(PROJECT_ROOT, project, {
      requiredAssetIds: [IDS.assetBg],
      candidateAssetIds: [candidateA!, candidateB!, promoted!],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested).toEqual([IDS.assetBg, candidateA, candidateB]);
    expect(session.getDiagnostics().queuedOptionalCount).toBe(1);

    reads.get(IDS.assetBg)!.resolve(readyImage(IDS.assetBg));
    await expect(firstLoad).resolves.toMatchObject({ status: 'ready' });
    const currentLoad = session.prepare(PROJECT_ROOT, project, {
      requiredAssetIds: [promoted!],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requested).toEqual([IDS.assetBg, candidateA, candidateB, promoted]);
    expect(session.getDiagnostics()).toMatchObject({
      inFlightCount: MAX_CONCURRENT_PREVIEW_IMAGE_READS,
      optionalInFlightCount: MAX_OPTIONAL_PREVIEW_IMAGE_READS,
      queuedOptionalCount: 0,
    });

    reads.get(promoted!)!.resolve(readyImage(promoted));
    await expect(currentLoad).resolves.toMatchObject({ status: 'ready' });
    const urlsBeforeStaleReads = createdUrls.length;
    reads.get(candidateA!)!.resolve(readyImage(candidateA));
    reads.get(candidateB!)!.resolve(readyImage(candidateB));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createdUrls).toHaveLength(urlsBeforeStaleReads);
    expect(urlsBeforeStaleReads).toBe(2);
    expect(
      session.snapshot(PROJECT_ROOT, project, { requiredAssetIds: [promoted!] }),
    ).toMatchObject({
      status: 'ready',
      urls: { [promoted!]: createdUrls[1] },
    });
    session.dispose();
  });

  it('caps optional queue growth, concurrent reads, and retained original bytes', async () => {
    const queueFixture = projectWithExtraImages(100);
    const pendingReads = new Map<
      string,
      ReturnType<typeof deferred<AssetCanvasImageReadResponse>>
    >();
    const queueSession = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        const read = deferred<AssetCanvasImageReadResponse>();
        pendingReads.set(assetId, read);
        return read.promise;
      },
    });
    const queueScope = {
      requiredAssetIds: [IDS.assetBg],
      recentAnimationAssetIds: queueFixture.assetIds.slice(0, 3),
      candidateAssetIds: queueFixture.assetIds,
    };
    const pendingLoad = queueSession.prepare(
      PROJECT_ROOT,
      queueFixture.project,
      queueScope,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const queueDiagnostics = queueSession.getDiagnostics();
    expect(queueDiagnostics.queuePeak).toBe(MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES);
    expect(queueDiagnostics.queuedOptionalCount).toBeLessThanOrEqual(
      MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES,
    );
    expect(queueDiagnostics.droppedOptionalQueueEntries).toBeGreaterThan(0);
    expect(queueDiagnostics.inFlightPeak).toBeLessThanOrEqual(
      MAX_CONCURRENT_PREVIEW_IMAGE_READS,
    );
    expect(queueDiagnostics.optionalInFlightCount).toBeLessThanOrEqual(
      MAX_OPTIONAL_PREVIEW_IMAGE_READS,
    );
    queueSession.dispose();
    await expect(pendingLoad).resolves.toBeNull();
    for (const [assetId, read] of pendingReads) {
      read.resolve(readyImage(assetId));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cacheFixture = projectWithExtraImages(18);
    const cacheScope = {
      requiredAssetIds: [IDS.assetBg],
      candidateAssetIds: cacheFixture.assetIds,
    };
    const cacheSession = new ProductPreviewImageSession({
      readCanvasImage: async ({ assetId }) =>
        readyImage(assetId, 5 * 1024 * 1024),
      createObjectUrl: (() => {
        let index = 0;
        return () => `blob:bounded-cache-${index++}`;
      })(),
    });
    await expect(
      cacheSession.prepare(PROJECT_ROOT, cacheFixture.project, cacheScope),
    ).resolves.toMatchObject({ status: 'ready' });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const diagnostics = cacheSession.getDiagnostics();
      if (diagnostics.inFlightCount === 0 && diagnostics.queuedOptionalCount === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    cacheSession.commitScope(PROJECT_ROOT, cacheFixture.project, cacheScope);
    const cacheDiagnostics = cacheSession.getDiagnostics();
    expect(cacheDiagnostics.readyCacheBytes).toBeLessThanOrEqual(
      MAX_RETAINED_PREVIEW_CANDIDATE_BYTES + 4,
    );
    expect(cacheDiagnostics.readyCacheEntries).toBeLessThan(18);
    cacheSession.dispose();
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      session.snapshot(PROJECT_ROOT, fixture.project, fixture.plan),
    ).toMatchObject({
      status: 'ready',
      optionalFailedAssetIds: [ALT_FACE_ID],
    });
    session.dispose();
  });

  it('retries an optional image once when it becomes required, then reaches exact ready', async () => {
    const project = compositePreviewProject();
    const optionalRead = deferred<AssetCanvasImageReadResponse>();
    const requiredRetry = deferred<AssetCanvasImageReadResponse>();
    const alternateReads = [optionalRead, requiredRetry];
    let alternateReadCount = 0;
    let objectUrlCount = 0;
    const session = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        if (assetId !== ALT_FACE_ID) return Promise.resolve(readyImage(assetId));
        const read = alternateReads[alternateReadCount];
        alternateReadCount += 1;
        if (!read) throw new Error('Unexpected alternate-face read.');
        return read.promise;
      },
      createObjectUrl: () => `blob:required-retry-${++objectUrlCount}`,
      revokeObjectUrl: () => {},
    });
    const candidateScope = {
      requiredAssetIds: [IDS.assetBg],
      candidateAssetIds: [ALT_FACE_ID],
    };

    const candidateLoad = session.prepare(
      PROJECT_ROOT,
      project,
      candidateScope,
    );
    await expect(candidateLoad).resolves.toMatchObject({ status: 'ready' });
    expect(alternateReadCount).toBe(1);

    optionalRead.resolve(failedImage(ALT_FACE_ID));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      session.snapshot(PROJECT_ROOT, project, candidateScope),
    ).toMatchObject({
      status: 'ready',
      optionalFailedAssetIds: [ALT_FACE_ID],
    });

    const requiredScope = {
      requiredAssetIds: [IDS.assetBg, ALT_FACE_ID],
    };
    const requiredLoad = session.prepare(PROJECT_ROOT, project, requiredScope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alternateReadCount).toBe(2);
    expect(
      session.snapshot(PROJECT_ROOT, project, requiredScope),
    ).toMatchObject({
      status: 'loading',
      fatalAssetIds: [],
    });

    requiredRetry.resolve(readyImage(ALT_FACE_ID));
    await expect(requiredLoad).resolves.toMatchObject({ status: 'ready' });
    expect(
      session.snapshot(PROJECT_ROOT, project, requiredScope).urls[ALT_FACE_ID],
    ).toBe('blob:required-retry-2');
    expect(alternateReadCount).toBe(2);
    session.dispose();
  });

  it('reports a required retry failure once and does not retry on later prepares', async () => {
    const project = compositePreviewProject();
    const optionalRead = deferred<AssetCanvasImageReadResponse>();
    const requiredRetry = deferred<AssetCanvasImageReadResponse>();
    const alternateReads = [optionalRead, requiredRetry];
    let alternateReadCount = 0;
    const session = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        if (assetId !== ALT_FACE_ID) return Promise.resolve(readyImage(assetId));
        const read = alternateReads[alternateReadCount];
        alternateReadCount += 1;
        if (!read) throw new Error('Unexpected alternate-face read.');
        return read.promise;
      },
      createObjectUrl: () => 'blob:required-retry',
      revokeObjectUrl: () => {},
    });
    const candidateScope = {
      requiredAssetIds: [IDS.assetBg],
      candidateAssetIds: [ALT_FACE_ID],
    };
    await expect(
      session.prepare(PROJECT_ROOT, project, candidateScope),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(alternateReadCount).toBe(1);

    optionalRead.resolve(failedImage(ALT_FACE_ID));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const requiredScope = {
      requiredAssetIds: [IDS.assetBg, ALT_FACE_ID],
    };
    const requiredLoad = session.prepare(PROJECT_ROOT, project, requiredScope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alternateReadCount).toBe(2);

    requiredRetry.resolve(failedImage(ALT_FACE_ID));
    await expect(requiredLoad).resolves.toMatchObject({
      status: 'error',
      fatalAssetIds: [ALT_FACE_ID],
      missingCount: 1,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        session.prepare(PROJECT_ROOT, project, requiredScope),
      ).resolves.toMatchObject({
        status: 'error',
        fatalAssetIds: [ALT_FACE_ID],
      });
    }
    expect(alternateReadCount).toBe(2);
    expect(session.getDiagnostics().inFlightCount).toBe(0);
    session.dispose();
  });

  it('does not retry an image that first failed as required on repeated prepares', async () => {
    const project = compositePreviewProject();
    let alternateReadCount = 0;
    const session = new ProductPreviewImageSession({
      readCanvasImage: ({ assetId }) => {
        if (assetId === ALT_FACE_ID) {
          alternateReadCount += 1;
          return Promise.resolve(failedImage(assetId));
        }
        return Promise.resolve(readyImage(assetId));
      },
    });
    const requiredScope = {
      requiredAssetIds: [IDS.assetBg, ALT_FACE_ID],
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        session.prepare(PROJECT_ROOT, project, requiredScope),
      ).resolves.toMatchObject({
        status: 'error',
        fatalAssetIds: [ALT_FACE_ID],
      });
    }
    expect(alternateReadCount).toBe(1);
    session.dispose();
  });
});
