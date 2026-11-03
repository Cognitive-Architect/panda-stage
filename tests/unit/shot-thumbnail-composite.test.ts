import { asExpressionCharacter } from '../helpers/characterAssertions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  buildEditorStageRenderModel,
  LayerService,
  ProjectSchema,
  migrateProject,
  type Layer,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture, adaptivePartsSourceRootTransform } from '../helpers/adaptivePartsFixtures';
import {
  createShotThumbnailDataUrl,
  isShotThumbnailRequestCurrent,
  requestShotThumbnail,
  shotThumbnailFingerprint,
} from '../../src/renderer/features/shots/shotThumbnail';
import { buildProject as buildSyntheticProject } from './domain/testProject';

const IDS = {
  body: '60800000-0000-4000-8000-000000000001',
  alternateBody: '60800000-0000-4000-8000-000000000002',
} as const;

const BASE_SHA = 'a'.repeat(64);

type DrawCall = {
  image: unknown;
  alpha: number;
  args: number[];
};

class FakeCanvasContext {
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  draws: DrawCall[] = [];
  transforms: number[][] = [];
  private alphaStack: number[] = [];

  save(): void {
    this.alphaStack.push(this.globalAlpha);
  }

  restore(): void {
    this.globalAlpha = this.alphaStack.pop() ?? 1;
  }

  translate(): void {}

  rotate(): void {}

  scale(): void {}

  transform(...values: number[]): void {
    this.transforms.push(values);
  }

  setTransform(): void {}

  clearRect(): void {}

  fillRect(): void {}

  drawImage(image: unknown, ...args: number[]): void {
    this.draws.push({ image, alpha: this.globalAlpha, args });
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeCanvasContext();

  getContext(): CanvasRenderingContext2D {
    return this.context as unknown as CanvasRenderingContext2D;
  }

  toDataURL(): string {
    return 'data:image/png;base64,c2hvdC10aHVtYm5haWw=';
  }
}

class FakeImage {
  decoding = '';
  onload: HTMLImageElement['onload'] = null;
  onerror: HTMLImageElement['onerror'] = null;

  private source = '';

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    queueMicrotask(() =>
      this.onload?.call(this as unknown as GlobalEventHandlers, {} as Event),
    );
  }
}

function installBrowser(readThumbnail: (assetId: string) => Promise<unknown>) {
  const canvases: FakeCanvas[] = [];
  vi.stubGlobal('window', {
    Image: FakeImage,
    pandaStage: {
      assets: {
        readThumbnail: ({ assetId }: { assetId: string }) => readThumbnail(assetId),
      },
    },
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
  });
  return canvases;
}

function makeCompositeProject(): Project {
  const migrated = migrateProject(exampleProject);
  const character = asExpressionCharacter(migrated.characters[0]!);
  const shot = migrated.shots[0]!;
  const baseExpression = character.expressions[0]!;
  const compositeCharacter = {
    ...character,
    mode: 'composite' as const,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: 110, offsetY: -80, scale: 0.5 },
    defaultScale: 1,
    defaultFlipX: false,
  };
  const bodyAsset = {
    id: IDS.body,
    kind: 'image' as const,
    name: 'Composite body',
    relativePath: 'assets/composite-body.png',
    mimeType: 'image/png',
    width: 800,
    height: 1000,
    sha256: BASE_SHA,
    usage: 'uncategorized' as const,
    keywords: [],
  };
  return ProjectSchema.parse({
    ...migrated,
    assets: [...migrated.assets, bodyAsset],
    characters: [compositeCharacter],
    shots: [
      {
        ...shot,
        layers: shot.layers.map((layer, index) =>
          index === 1
            ? {
                ...layer,
                source: {
                  kind: 'character',
                  characterId: character.id,
                  expressionId: baseExpression.id,
                },
                x: 960,
                y: 540,
                scaleX: 0.8,
                scaleY: 0.7,
                flipX: false,
                rotationDeg: 12,
                opacity: 0.5,
                visible: true,
                zIndex: 1,
              }
            : layer,
        ),
      },
    ],
  });
}

function makeAdaptivePartsProject(): Project {
  const base = buildSyntheticProject();
  const sourceCharacter = base.characters[0]!;
  if (sourceCharacter.mode === 'adaptive-parts') {
    throw new Error('Expected a whole-image source Character.');
  }
  const project = new CharacterService().createAdaptiveParts(base, {
    name: 'Synthetic Adaptive Character',
    sourceRootTransform: adaptivePartsSourceRootTransform(),
    parts: adaptivePartsFixture(sourceCharacter.expressions[0]!.assetId),
  });
  const character = project.characters.at(-1)!;
  if (character.mode !== 'adaptive-parts') {
    throw new Error('Expected the Adaptive Parts test Character.');
  }
  const placed = new LayerService().createFromAdaptiveCharacter(
    project,
    project.shots[0]!.id,
    character.id,
    { x: 960, y: 540 },
  );
  return ProjectSchema.parse({
    ...placed.project,
    shots: placed.project.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) =>
        layer.id === placed.layer.id ? { ...layer, opacity: 0.5 } : layer,
      ),
    })),
  });
}

function withCharacter(
  project: Project,
  update: (character: Extract<Project['characters'][number], { mode: 'composite' }>) => unknown,
): Project {
  const current = project.characters[0];
  if (!current || current.mode !== 'composite') {
    throw new Error('Composite fixture Character is missing.');
  }
  return ProjectSchema.parse({
    ...project,
    characters: [update(current)],
  });
}

function withShotLayer(
  project: Project,
  update: (layer: Layer) => Layer,
): Project {
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...shot,
        layers: shot.layers.map((layer, index) =>
          index === 1 ? update(layer) : layer,
        ),
      },
    ],
  });
}

function readyThumbnail(assetId: string) {
  return {
    ok: true,
    status: 'ready',
    assetId,
    dataUrl: `data:image/png;base64,${btoa(assetId)}`,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Shot thumbnail composite rendering (Issue #608)', () => {
  it('takes Body, base Face, draw order, local geometry, and the shared owner transform from S03', () => {
    const project = makeCompositeProject();
    const model = buildEditorStageRenderModel(project, project.shots[0]!);
    const visual = model.layers[1]!.visual;

    expect(visual.kind).toBe('composite-character');
    expect(visual.parts.map(({ slot, drawOrder }) => ({ slot, drawOrder }))).toEqual([
      { slot: 'body', drawOrder: 0 },
      { slot: 'face', drawOrder: 1 },
    ]);
    expect(visual.parts.map(({ localRect }) => localRect)).toEqual([
      { x: -400, y: -500, width: 800, height: 1000 },
      { x: -50, y: -240, width: 320, height: 320 },
    ]);
    expect(visual.facePlacement).toEqual({
      offsetX: 110,
      offsetY: -80,
      scale: 0.5,
      rotationDeg: 0,
      flipX: false,
    });
    expect(visual.ownerTransform).toMatchObject({
      x: 960,
      y: 540,
      scaleX: 0.8,
      scaleY: 0.7,
      rotationDeg: 12,
      opacity: 0.5,
      visible: true,
      zIndex: 1,
    });
    expect(shotThumbnailFingerprint(project, project.shots[0]!)).toContain(
      'composite-character',
    );
  });

  it('invalidates on Body/base-Face identity or hash, Face Placement, base expression, and root visuals', () => {
    const project = makeCompositeProject();
    const shot = project.shots[0]!;
    const baseline = shotThumbnailFingerprint(project, shot);
    const baseLayerSource = shot.layers[1]!.source;
    if (baseLayerSource.kind !== 'character') throw new Error('Expected Character Layer.');
    const currentFaceId = asExpressionCharacter(project.characters[0]!).expressions.find(
      ({ id }) => id === baseLayerSource.expressionId,
    )!.assetId;

    const alternateBody = withCharacter(project, (character) => ({
      ...character,
      bodyAssetId: project.assets.find((asset) => asset.id !== IDS.body && asset.kind === 'image')!.id,
    }));
    const changedBodyHash = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === IDS.body ? { ...asset, sha256: 'b'.repeat(64) } : asset,
      ),
    });
    const changedFaceHash = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === currentFaceId ? { ...asset, sha256: 'c'.repeat(64) } : asset,
      ),
    });
    const changedPlacement = withCharacter(project, (character) => ({
      ...character,
      facePlacement: { ...character.facePlacement, offsetX: 111 },
    }));
    const alternateExpressionId = asExpressionCharacter(project.characters[0]!).expressions[1]!.id;
    const layerSource = project.shots[0]!.layers[1]!.source;
    if (layerSource.kind !== 'character') throw new Error('Expected Character Layer.');
    const changedBaseFace = withShotLayer(project, (layer) => ({
      ...layer,
      source: {
        kind: 'character',
        characterId: layerSource.characterId,
        expressionId: alternateExpressionId,
      },
    }));
    const changedBackgroundIdentity = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          backgroundLayerId: null,
        },
      ],
    });

    for (const changed of [
      alternateBody,
      changedBodyHash,
      changedFaceHash,
      changedPlacement,
      changedBaseFace,
      changedBackgroundIdentity,
    ]) {
      expect(shotThumbnailFingerprint(changed, changed.shots[0]!)).not.toBe(baseline);
    }

    const rootChanges: Array<[string, (layer: Layer) => Layer]> = [
      ['x', (layer) => ({ ...layer, x: layer.x + 1 })],
      ['y', (layer) => ({ ...layer, y: layer.y + 1 })],
      ['scaleX', (layer) => ({ ...layer, scaleX: layer.scaleX + 0.1 })],
      ['scaleY', (layer) => ({ ...layer, scaleY: layer.scaleY + 0.1 })],
      ['flipX', (layer) => ({ ...layer, flipX: !layer.flipX })],
      ['rotationDeg', (layer) => ({ ...layer, rotationDeg: layer.rotationDeg + 1 })],
      ['opacity', (layer) => ({ ...layer, opacity: layer.opacity - 0.1 })],
      ['visible', (layer) => ({ ...layer, visible: !layer.visible })],
      ['zIndex', (layer) => ({ ...layer, zIndex: layer.zIndex + 1 })],
    ];
    for (const [field, update] of rootChanges) {
      const changed = withShotLayer(project, update);
      expect(shotThumbnailFingerprint(changed, changed.shots[0]!), field).not.toBe(
        baseline,
      );
    }
  });

  it('keeps the fingerprint stable for names, timing, dialogue/audio, Mouth, and unused alternate expression state', () => {
    const project = makeCompositeProject();
    const baseline = shotThumbnailFingerprint(project, project.shots[0]!);
    const alternateExpression = asExpressionCharacter(project.characters[0]!).expressions[1]!;
    const alternateAssetId = alternateExpression.assetId;
    const unrelated = ProjectSchema.parse({
      ...project,
      name: 'Renamed project',
      assets: project.assets.map((asset) =>
        asset.id === alternateAssetId
          ? { ...asset, sha256: 'd'.repeat(64) }
          : asset,
      ),
      characters: [
        {
          ...asExpressionCharacter(project.characters[0]!),
          name: 'Renamed Character',
          mouthOpenAssetId: alternateAssetId,
          baseAssetId: alternateAssetId,
          defaultExpressionId: alternateExpression.id,
        },
      ],
      shots: [
        {
          ...project.shots[0]!,
          name: 'Renamed Shot',
          durationMs: project.shots[0]!.durationMs + 100,
          dialogues: [],
          audioClips: [],
          timelineEvents: [],
        },
      ],
    });

    expect(shotThumbnailFingerprint(unrelated, unrelated.shots[0]!)).toBe(baseline);
  });

  it('flattens composite parts before applying the owner opacity once', async () => {
    const project = makeCompositeProject();
    const readThumbnail = vi.fn(async (assetId: string) => readyThumbnail(assetId));
    const canvases = installBrowser(readThumbnail);

    await createShotThumbnailDataUrl({
      projectRoot: 'D:\\issue608-composite-alpha',
      project,
      shot: project.shots[0]!,
    });

    expect(canvases).toHaveLength(2);
    const [main, composite] = canvases;
    const faceAssetId = asExpressionCharacter(project.characters[0]!).expressions[0]!.assetId;
    expect(composite!.context.draws.map(({ image }) => (image as FakeImage).src)).toEqual(
      [readyThumbnail(IDS.body).dataUrl, readyThumbnail(faceAssetId).dataUrl],
    );
    expect(composite!.context.draws.map(({ alpha }) => alpha)).toEqual([1, 1]);
    expect(main!.context.draws.at(-1)).toMatchObject({ image: composite, alpha: 0.5 });
    expect(main!.context.draws.at(-1)?.args).toEqual([0, 0]);
    expect(readThumbnail).toHaveBeenCalledTimes(3);
  });

  it('flattens each Adaptive Part identity with affine geometry and applies owner opacity once', async () => {
    const project = makeAdaptivePartsProject();
    const shot = project.shots[0]!;
    const model = buildEditorStageRenderModel(project, shot);
    const adaptiveLayer = model.layers.find(
      ({ visual }) => visual.kind === 'adaptive-parts-character',
    )!;
    const parts = adaptiveLayer.visual.parts;
    const readThumbnail = vi.fn(async (assetId: string) => readyThumbnail(assetId));
    const canvases = installBrowser(readThumbnail);

    await createShotThumbnailDataUrl({
      projectRoot: 'D:\\issue897-adaptive-thumbnail',
      project,
      shot,
    });

    expect(parts).toHaveLength(6);
    expect(new Set(parts.map((part) => part.partId)).size).toBe(6);
    expect(new Set(parts.map((part) => part.assetId))).toEqual(
      new Set([parts[0]!.assetId]),
    );
    expect(canvases).toHaveLength(2);
    const [main, adaptive] = canvases;
    expect(adaptive!.context.draws).toHaveLength(6);
    expect(adaptive!.context.draws.every(({ alpha }) => alpha === 1)).toBe(true);
    expect(adaptive!.context.transforms).toEqual(
      parts.map((part) => {
        const transform = part.imageTransform!;
        return [
          transform.a,
          transform.b,
          transform.c,
          transform.d,
          transform.tx,
          transform.ty,
        ];
      }),
    );
    expect(main!.context.draws.at(-1)).toMatchObject({ image: adaptive, alpha: 0.5 });
    expect(readThumbnail).toHaveBeenCalledTimes(2);
  });

  it('invalidates Adaptive Part thumbnails when source affine, visibility, or stored order changes', () => {
    const project = makeAdaptivePartsProject();
    const shot = project.shots[0]!;
    const baseline = shotThumbnailFingerprint(project, shot);
    const characterIndex = project.characters.findIndex(
      (character) => character.mode === 'adaptive-parts',
    );
    const character = project.characters[characterIndex]!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }
    const updateCharacter = (
      update: (character: Extract<Project['characters'][number], { mode: 'adaptive-parts' }>) => unknown,
    ): Project => ProjectSchema.parse({
      ...project,
      characters: project.characters.map((candidate, index) =>
        index === characterIndex ? update(character) : candidate,
      ),
    });
    const changedAffine = updateCharacter((current) => ({
      ...current,
      sourceRootTransform: { ...current.sourceRootTransform, a: 1.1 },
    }));
    const changedVisibility = updateCharacter((current) => ({
      ...current,
      parts: current.parts.map((part, index) =>
        index === 0 ? { ...part, visible: false } : part,
      ),
    }));
    const changedOrder = updateCharacter((current) => ({
      ...current,
      parts: [current.parts[1]!, current.parts[0]!, ...current.parts.slice(2)]
        .map((part, index) => ({ ...part, drawOrder: index })),
    }));

    for (const changed of [changedAffine, changedVisibility, changedOrder]) {
      expect(shotThumbnailFingerprint(changed, changed.shots[0]!)).not.toBe(baseline);
    }
  });

  it.each(['body', 'face'] as const)(
    'does not publish a partial composite when the %s read fails, and retries the same fingerprint',
    async (failedPart) => {
      const project = makeCompositeProject();
      const shot = project.shots[0]!;
      const model = buildEditorStageRenderModel(project, shot);
      const failedAssetId = model.layers[1]!.visual.parts[
        failedPart === 'body' ? 0 : 1
      ]!.assetId;
      let available = false;
      const readThumbnail = vi.fn(async (assetId: string) => {
        if (assetId === failedAssetId && !available) {
          return { ok: true, status: 'missing', assetId };
        }
        return readyThumbnail(assetId);
      });
      const canvases = installBrowser(readThumbnail);
      const request = {
        projectRoot: `D:\\issue608-retry-${failedPart}`,
        project,
        shot,
      };

      const failed = await requestShotThumbnail(request);
      expect(failed.status).toBe('missing');
      expect(canvases).toHaveLength(0);
      expect(readThumbnail.mock.calls.filter(([id]) => id === failedAssetId)).toHaveLength(1);

      available = true;
      const retried = await requestShotThumbnail(request);
      expect(retried.status).toBe('ready');
      expect(retried.fingerprint).toBe(failed.fingerprint);
      expect(canvases).toHaveLength(2);
      expect(readThumbnail.mock.calls.filter(([id]) => id === failedAssetId)).toHaveLength(2);
    },
  );

  it('keeps ordinary-image and single-image Character thumbnails on one-part compatibility paths', async () => {
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const model = buildEditorStageRenderModel(project, shot);
    expect(model.layers.map(({ visual }) => visual.kind)).toEqual([
      'ordinary-image',
      'single-image-character',
    ]);
    expect(model.layers.map(({ visual }) => visual.parts.map(({ slot }) => slot))).toEqual([
      ['single'],
      ['single'],
    ]);

    const readThumbnail = vi.fn(async (assetId: string) => readyThumbnail(assetId));
    const canvases = installBrowser(readThumbnail);
    await createShotThumbnailDataUrl({
      projectRoot: 'D:\\issue608-single-compatibility',
      project,
      shot,
    });
    expect(canvases).toHaveLength(1);
    expect(canvases[0]!.context.draws).toHaveLength(2);
    expect(readThumbnail).toHaveBeenCalledTimes(2);
  });

  it('rejects an older completion after the view has moved to a newer fingerprint or project root', () => {
    const oldRequest = {
      projectRoot: 'D:\\issue608-project',
      fingerprint: 'old-fingerprint',
    };
    expect(isShotThumbnailRequestCurrent(oldRequest, oldRequest)).toBe(true);
    expect(
      isShotThumbnailRequestCurrent(
        { ...oldRequest, fingerprint: 'new-fingerprint' },
        oldRequest,
      ),
    ).toBe(false);
    expect(
      isShotThumbnailRequestCurrent(
        { ...oldRequest, projectRoot: 'D:\\issue608-other-project' },
        oldRequest,
      ),
    ).toBe(false);
    expect(isShotThumbnailRequestCurrent(null, oldRequest)).toBe(false);
  });
});
