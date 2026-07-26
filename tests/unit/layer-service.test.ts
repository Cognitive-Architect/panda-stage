import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  LayerServiceError,
  ProjectSchema,
} from '../../src/domain';

const CREATED_LAYER_ID = 'd2200000-0000-4000-8000-000000000001';
const NOW = new Date('2026-07-26T01:00:00.000Z');

function fixture() {
  return ProjectSchema.parse(exampleProject);
}

function service() {
  return new LayerService({
    createId: () => CREATED_LAYER_ID,
    now: () => NOW,
  });
}

describe('LayerService', () => {
  it('creates a centered direct-asset layer with the next zIndex', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const asset = project.assets[0]!;
    const result = service().createFromAsset(project, shot.id, {
      version: 2,
      assetId: asset.id,
      type: 'asset-image',
      position: { x: 640, y: 360 },
    });

    expect(result.layer).toMatchObject({
      id: CREATED_LAYER_ID,
      name: asset.name,
      source: { kind: 'asset', assetId: asset.id },
      anchor: 'center',
      x: 640,
      y: 360,
      locked: false,
      zIndex: Math.max(...shot.layers.map((layer) => layer.zIndex)) + 1,
    });
    expect(result.project.shots[0]!.layers.at(-1)).toEqual(result.layer);
    expect(result.project.updatedAt).toBe(NOW.toISOString());
    expect(project.shots[0]!.layers).toHaveLength(2);
  });

  it('creates a character layer from the matching expression and default scale', () => {
    const project = fixture();
    const character = project.characters[0]!;
    const expression = character.expressions[1]!;
    const result = service().createFromAsset(
      project,
      project.shots[0]!.id,
      {
        version: 2,
        assetId: expression.assetId,
        type: 'character-expression',
        characterId: character.id,
        expressionId: expression.id,
        position: { x: 960, y: 540 },
      },
    );

    expect(result.layer).toMatchObject({
      source: {
        kind: 'character',
        characterId: character.id,
        expressionId: expression.id,
      },
      scaleX: character.defaultScale,
      scaleY: character.defaultScale,
    });
  });

  it('keeps explicit identity when characters and expressions share one asset', () => {
    const project = fixture();
    const characterA = project.characters[0]!;
    const sharedAssetId = characterA.expressions[0]!.assetId;
    const angry = {
      ...characterA.expressions[0]!,
      id: 'd2230000-0000-4000-8000-000000000002',
      name: 'angry',
    };
    const characterB = {
      ...characterA,
      id: 'd2230000-0000-4000-8000-000000000003',
      name: 'Panda B',
      expressions: [
        {
          ...characterA.expressions[0]!,
          id: 'd2230000-0000-4000-8000-000000000004',
        },
      ],
      defaultExpressionId:
        'd2230000-0000-4000-8000-000000000004',
      defaultVoiceProfileId:
        'd2230000-0000-4000-8000-000000000005',
    };
    const shared = ProjectSchema.parse({
      ...project,
      characters: [
        {
          ...characterA,
          expressions: [...characterA.expressions, angry],
        },
        characterB,
      ],
      voiceProfiles: [
        ...project.voiceProfiles,
        {
          ...project.voiceProfiles[0]!,
          id: characterB.defaultVoiceProfileId,
          characterId: characterB.id,
          name: 'Panda B default',
        },
      ],
    });

    const angryResult = service().createFromAsset(
      shared,
      shared.shots[0]!.id,
      {
        version: 2,
        type: 'character-expression',
        assetId: sharedAssetId,
        characterId: characterA.id,
        expressionId: angry.id,
        position: { x: 100, y: 200 },
      },
    );
    const characterBResult = service().createFromAsset(
      shared,
      shared.shots[0]!.id,
      {
        version: 2,
        type: 'character-expression',
        assetId: sharedAssetId,
        characterId: characterB.id,
        expressionId: characterB.expressions[0]!.id,
        position: { x: 100, y: 200 },
      },
    );

    expect(angryResult.layer.source).toEqual({
      kind: 'character',
      characterId: characterA.id,
      expressionId: angry.id,
    });
    expect(characterBResult.layer.source).toEqual({
      kind: 'character',
      characterId: characterB.id,
      expressionId: characterB.expressions[0]!.id,
    });
  });

  it.each([
    {
      label: 'unknown character',
      characterId: 'd2240000-0000-4000-8000-000000000001',
      expressionId: null,
      assetOffset: 0,
    },
    {
      label: 'expression from another character',
      characterId: null,
      expressionId: 'd2240000-0000-4000-8000-000000000002',
      assetOffset: 0,
    },
    {
      label: 'asset mismatch',
      characterId: null,
      expressionId: null,
      assetOffset: 1,
    },
  ])('rejects forged identity: $label', ({
    characterId,
    expressionId,
    assetOffset,
  }) => {
    const project = fixture();
    const character = project.characters[0]!;
    const expression = character.expressions[0]!;
    const before = structuredClone(project);

    expect(() =>
      service().createFromAsset(project, project.shots[0]!.id, {
        version: 2,
        type: 'character-expression',
        assetId:
          assetOffset === 1
            ? project.assets.find(
                (asset) =>
                  asset.kind === 'image' &&
                  asset.id !== expression.assetId,
              )!.id
            : expression.assetId,
        characterId: characterId ?? character.id,
        expressionId: expressionId ?? expression.id,
        position: { x: 100, y: 200 },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CHARACTER_IDENTITY_MISMATCH',
      }),
    );
    expect(project).toEqual(before);
  });

  it('places a mouth-open-only image as a direct asset layer', () => {
    const project = fixture();
    const character = project.characters[0]!;
    const directAsset = project.assets.find(
      (asset) =>
        asset.kind === 'image' &&
        !character.expressions.some(
          (expression) => expression.assetId === asset.id,
        ),
    )!;
    const withMouth = ProjectSchema.parse({
      ...project,
      characters: [
        { ...character, mouthOpenAssetId: directAsset.id },
      ],
    });

    const result = service().createFromAsset(
      withMouth,
      withMouth.shots[0]!.id,
      {
        version: 2,
        type: 'asset-image',
        assetId: directAsset.id,
        position: { x: 100, y: 200 },
      },
    );

    expect(result.layer.source).toEqual({
      kind: 'asset',
      assetId: directAsset.id,
    });
  });

  it('rejects an expression image disguised as a direct asset payload', () => {
    const project = fixture();
    const expression = project.characters[0]!.expressions[0]!;
    const before = structuredClone(project);

    expect(() =>
      service().createFromAsset(project, project.shots[0]!.id, {
        version: 2,
        type: 'asset-image',
        assetId: expression.assetId,
        position: { x: 100, y: 200 },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'ASSET_TYPE_MISMATCH' }),
    );
    expect(project).toEqual(before);
  });

  it('clamps a canvas-exterior drop to the logical stage', () => {
    const project = fixture();
    const result = service().createFromAsset(
      project,
      project.shots[0]!.id,
      {
        version: 2,
        assetId: project.assets[0]!.id,
        type: 'asset-image',
        position: { x: -80, y: 1200 },
      },
    );

    expect(result.layer).toMatchObject({ x: 0, y: 1080 });
  });

  it.each([
    {
      name: 'missing asset',
      input: {
        version: 2 as const,
        assetId: 'd2200000-0000-4000-8000-000000000099',
        type: 'asset-image' as const,
        position: { x: 10, y: 20 },
      },
      code: 'ASSET_NOT_FOUND',
    },
    {
      name: 'audio',
      input: {
        version: 2 as const,
        assetId: '10000000-0000-4000-8000-000000000005',
        type: 'audio' as const,
        position: { x: 10, y: 20 },
      },
      code: 'ASSET_TYPE_MISMATCH',
    },
    {
      name: 'non-finite x',
      input: {
        version: 2 as const,
        assetId: '10000000-0000-4000-8000-000000000002',
        type: 'asset-image' as const,
        position: { x: Number.NaN, y: 20 },
      },
      code: 'INVALID_POSITION',
    },
    {
      name: 'non-finite y',
      input: {
        version: 2 as const,
        assetId: '10000000-0000-4000-8000-000000000002',
        type: 'asset-image' as const,
        position: { x: 20, y: Number.POSITIVE_INFINITY },
      },
      code: 'INVALID_POSITION',
    },
  ])('rejects $name without mutating the project', ({ input, code }) => {
    const project = fixture();
    const before = structuredClone(project);

    expect(() =>
      service().createFromAsset(
        project,
        project.shots[0]!.id,
        input,
      ),
    ).toThrow(expect.objectContaining({ code }));
    expect(project).toEqual(before);
  });

  it('updates an unlocked center position and treats an identical move as a no-op', () => {
    const project = fixture();
    const layer = project.shots[0]!.layers[1]!;
    const moved = service().updatePosition(
      project,
      project.shots[0]!.id,
      layer.id,
      { x: 777.5, y: 333.25 },
    );

    expect(moved.shots[0]!.layers[1]).toMatchObject({
      x: 777.5,
      y: 333.25,
    });
    expect(
      service().updatePosition(
        moved,
        moved.shots[0]!.id,
        layer.id,
        { x: 777.5, y: 333.25 },
      ),
    ).toBe(moved);
  });

  it('rejects out-of-stage property coordinates and locked movement', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;

    expect(() =>
      service().updatePosition(project, shot.id, layer.id, {
        x: -1,
        y: 20,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSITION' }));

    const locked = service().setLocked(project, shot.id, layer.id, true);
    expect(locked.shots[0]!.layers[1]!.locked).toBe(true);
    expect(() =>
      service().updatePosition(locked, shot.id, layer.id, {
        x: 300,
        y: 400,
      }),
    ).toThrow(
      expect.objectContaining<Partial<LayerServiceError>>({
        code: 'LAYER_LOCKED',
      }),
    );
  });

  it('commits a finite uniform transform, normalizes rotation, and keeps the center while flipping', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;
    const transformed = service().updateTransform(
      project,
      shot.id,
      layer.id,
      {
        x: layer.x,
        y: layer.y,
        scale: 1.25,
        rotationDeg: 540,
        opacity: 0.4,
        flipX: true,
      },
    );
    const result = transformed.shots[0]!.layers[1]!;

    expect(result).toMatchObject({
      x: layer.x,
      y: layer.y,
      scaleX: 1.25,
      scaleY: 1.25,
      rotationDeg: -180,
      opacity: 0.4,
      flipX: true,
    });
    const unflipped = service().toggleFlipX(
      transformed,
      shot.id,
      layer.id,
    );
    expect(unflipped.shots[0]!.layers[1]).toMatchObject({
      x: layer.x,
      y: layer.y,
      flipX: false,
    });
  });

  it.each([
    { label: 'NaN x', patch: { x: Number.NaN } },
    { label: 'Infinity y', patch: { y: Number.POSITIVE_INFINITY } },
    { label: 'zero scale', patch: { scale: 0 } },
    { label: 'negative scale', patch: { scale: -1 } },
    { label: 'too-small scale', patch: { scale: 0.049 } },
    { label: 'too-large scale', patch: { scale: 20.01 } },
    { label: 'NaN rotation', patch: { rotationDeg: Number.NaN } },
    { label: 'Infinity opacity', patch: { opacity: Number.POSITIVE_INFINITY } },
    { label: 'negative opacity', patch: { opacity: -0.01 } },
    { label: 'oversized opacity', patch: { opacity: 1.01 } },
  ])('rejects an invalid transform: $label', ({ patch }) => {
    const project = fixture();
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;
    const input = {
      x: layer.x,
      y: layer.y,
      scale: layer.scaleX,
      rotationDeg: layer.rotationDeg,
      opacity: layer.opacity,
      flipX: layer.flipX,
      ...patch,
    };

    expect(() =>
      service().updateTransform(project, shot.id, layer.id, input),
    ).toThrow();
    expect(project).toEqual(fixture());
  });

  it('moves content forward/back/front/back and keeps zIndex continuous with the background pinned', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const ordinary = shot.layers[1]!;
    const secondId = 'd2300000-0000-4000-8000-000000000002';
    const thirdId = 'd2300000-0000-4000-8000-000000000003';
    const layered = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          layers: [
            shot.layers[0]!,
            ordinary,
            { ...ordinary, id: secondId, name: 'Second', zIndex: 2 },
            { ...ordinary, id: thirdId, name: 'Third', zIndex: 3 },
          ],
        },
      ],
    });

    const front = service().reorder(
      layered,
      shot.id,
      ordinary.id,
      'front',
    );
    expect(front.shots[0]!.layers.map((layer) => layer.id)).toEqual([
      shot.backgroundLayerId,
      secondId,
      thirdId,
      ordinary.id,
    ]);
    expect(front.shots[0]!.layers.map((layer) => layer.zIndex)).toEqual([
      0, 1, 2, 3,
    ]);

    const back = service().reorder(
      front,
      shot.id,
      ordinary.id,
      'back',
    );
    expect(back.shots[0]!.layers.map((layer) => layer.id)).toEqual([
      shot.backgroundLayerId,
      ordinary.id,
      secondId,
      thirdId,
    ]);
    expect(
      service().reorder(back, shot.id, ordinary.id, 'back'),
    ).toBe(back);
  });

  it('deletes content, cascades its timeline events, and normalizes remaining order', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const layer = shot.layers[1]!;
    expect(
      shot.timelineEvents.some((event) => event.layerId === layer.id),
    ).toBe(true);

    const deleted = service().deleteLayer(project, shot.id, layer.id);
    const result = deleted.shots[0]!;
    expect(result.layers.map((candidate) => candidate.id)).toEqual([
      shot.backgroundLayerId,
    ]);
    expect(result.layers[0]!.zIndex).toBe(0);
    expect(
      result.timelineEvents.some((event) => event.layerId === layer.id),
    ).toBe(false);
  });

  it('protects backgrounds and makes locking block transform, flip, order, and delete', () => {
    const project = fixture();
    const shot = project.shots[0]!;
    const background = shot.layers[0]!;
    const layer = shot.layers[1]!;
    const transform = {
      x: layer.x,
      y: layer.y,
      scale: layer.scaleX,
      rotationDeg: layer.rotationDeg,
      opacity: layer.opacity,
      flipX: layer.flipX,
    };

    for (const operation of [
      () => service().updateTransform(project, shot.id, background.id, transform),
      () => service().toggleFlipX(project, shot.id, background.id),
      () => service().reorder(project, shot.id, background.id, 'front'),
      () => service().deleteLayer(project, shot.id, background.id),
      () => service().setLocked(project, shot.id, background.id, true),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({ code: 'BACKGROUND_LAYER_PROTECTED' }),
      );
    }

    const locked = service().setLocked(project, shot.id, layer.id, true);
    for (const operation of [
      () => service().updateTransform(locked, shot.id, layer.id, transform),
      () => service().toggleFlipX(locked, shot.id, layer.id),
      () => service().reorder(locked, shot.id, layer.id, 'front'),
      () => service().deleteLayer(locked, shot.id, layer.id),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({ code: 'LAYER_LOCKED' }),
      );
    }
  });
});
