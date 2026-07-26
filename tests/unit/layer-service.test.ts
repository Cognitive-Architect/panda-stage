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
});
