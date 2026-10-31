import { asExpressionCharacter } from '../helpers/characterAssertions';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  CharacterServiceError,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  migrateProject,
  scanAssetReferences,
  scanExpressionReferences,
  type Project,
} from '../../src/domain';

const IDS = [
  '19000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000002',
  '19000000-0000-4000-8000-000000000003',
  '19000000-0000-4000-8000-000000000004',
  '19000000-0000-4000-8000-000000000005',
  '19000000-0000-4000-8000-000000000006',
];

function service(): CharacterService {
  let index = 0;
  return new CharacterService({
    createId: () => IDS[index++]!,
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });
}

function emptyCharacterProject(): Project {
  const migrated = migrateProject(exampleProject);
  return ProjectSchema.parse({
    ...migrated,
    characters: [],
    voiceProfiles: [],
    shots: [],
    assets: [
      {
        ...migrated.assets[0]!,
        id: '19100000-0000-4000-8000-000000000001',
        name: 'normal image',
        width: 100,
        height: 100,
      },
      {
        ...migrated.assets[1]!,
        id: '19100000-0000-4000-8000-000000000002',
        name: 'angry image',
        width: 150,
        height: 100,
      },
      {
        ...migrated.assets[2]!,
        id: '19100000-0000-4000-8000-000000000003',
        name: 'mouth image',
        width: 100,
        height: 45,
      },
      migrated.assets.find((asset) => asset.kind === 'audio')!,
    ],
  });
}

function createPanda(project = emptyCharacterProject()): Project {
  return service().create(project, {
    name: 'Panda',
    expressions: [
      {
        name: 'normal',
        assetId: '19100000-0000-4000-8000-000000000001',
      },
      {
        name: 'angry',
        assetId: '19100000-0000-4000-8000-000000000002',
      },
    ],
    mouthOpenAssetId: '19100000-0000-4000-8000-000000000003',
    defaultScale: 0.8,
    defaultFlipX: true,
  });
}

function headedCompositeProject(): Project {
  const project = createPanda();
  const character = asExpressionCharacter(project.characters[0]!);
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...character,
        mode: 'composite',
        bodyAssetId: character.baseAssetId,
        facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        head: {
          assetId: character.baseAssetId,
          placement: { offsetX: 0, offsetY: 0, scale: 1 },
          pivot: { x: 320, y: 300 },
        },
      },
    ],
  });
}

function expectCharacterError(
  action: () => unknown,
  code: CharacterServiceError['code'],
): CharacterServiceError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CharacterServiceError);
    expect((error as CharacterServiceError).code).toBe(code);
    return error as CharacterServiceError;
  }
  throw new Error(`Expected CharacterServiceError ${code}.`);
}

describe('CharacterService', () => {
  it('creates normal/angry expressions, a mouth asset, default transform, and a minimal voice profile using IDs only', () => {
    const result = createPanda();
    const character = asExpressionCharacter(result.characters[0]!);

    expect(character).toMatchObject({
      id: IDS[2],
      name: 'Panda',
      defaultExpressionId: IDS[0],
      baseAssetId: '19100000-0000-4000-8000-000000000001',
      mouthOpenAssetId: '19100000-0000-4000-8000-000000000003',
      defaultScale: 0.8,
      defaultFlipX: true,
      expressions: [
        { id: IDS[0], name: 'normal' },
        { id: IDS[1], name: 'angry' },
      ],
    });
    expect(result.voiceProfiles).toEqual([
      expect.objectContaining({
        id: IDS[3],
        characterId: character.id,
        locale: 'zh-CN',
      }),
    ]);
    const serialized = JSON.stringify(character);
    expect(serialized).not.toContain('assets/');
    expect(serialized).not.toContain('data:image');
    expect(result.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(character.mode).toBe('single-image');
  });

  it('validates and persists Head motion intensity from 0 to 200 percent', () => {
    const initial = headedCompositeProject();
    const characterId = asExpressionCharacter(initial.characters[0]!).id;
    let project = initial;

    for (const intensityPercent of [0, 100, 200]) {
      project = service().setTalkingHeadMotionIntensityPercent(
        project,
        characterId,
        intensityPercent,
      );
      expect(project.characters[0]).toMatchObject({
        mode: 'composite',
        talkingHeadMotionIntensityPercent: intensityPercent,
      });
    }

    for (const intensityPercent of [-10, 10.5, 210, Number.NaN]) {
      expectCharacterError(
        () =>
          service().setTalkingHeadMotionIntensityPercent(
            project,
            characterId,
            intensityPercent,
          ),
        'INVALID_TALKING_HEAD_INTENSITY',
      );
    }

    const composite = asExpressionCharacter(project.characters[0]!);
    if (composite.mode !== 'composite') throw new Error('Expected composite.');
    const { head: _head, ...headlessCharacter } = composite;
    expect(_head).toBeDefined();
    const headlessProject = ProjectSchema.parse({
      ...project,
      characters: [headlessCharacter],
    });
    expectCharacterError(
      () =>
        service().setTalkingHeadMotionIntensityPercent(
          headlessProject,
          characterId,
          100,
        ),
      'INVALID_TALKING_HEAD_INTENSITY',
    );
  });

  it('rejects duplicate expression names and non-image mouth references', () => {
    const project = emptyCharacterProject();
    expectCharacterError(
      () =>
        service().create(project, {
          name: 'Panda',
          expressions: [
            {
              name: 'Normal',
              assetId: '19100000-0000-4000-8000-000000000001',
            },
            {
              name: ' normal ',
              assetId: '19100000-0000-4000-8000-000000000002',
            },
          ],
        }),
      'DUPLICATE_EXPRESSION_NAME',
    );
    expectCharacterError(
      () =>
        service().create(project, {
          name: 'Panda',
          expressions: [
            {
              name: 'normal',
              assetId: '19100000-0000-4000-8000-000000000001',
            },
          ],
          mouthOpenAssetId: project.assets.find(
            (asset) => asset.kind === 'audio',
          )!.id,
        }),
      'IMAGE_ASSET_REQUIRED',
    );
  });

  it('supports character rename/delete and expression add/rename while cleaning the minimal voice profile', () => {
    const characterService = service();
    const created = characterService.create(emptyCharacterProject(), {
      name: 'Panda',
      expressions: [
        {
          name: 'normal',
          assetId: '19100000-0000-4000-8000-000000000001',
        },
      ],
    });
    const character = asExpressionCharacter(created.characters[0]!);
    const renamed = characterService.renameCharacter(
      created,
      character.id,
      '熊猫',
    );
    const added = characterService.addExpression(
      renamed,
      character.id,
      {
        name: 'surprised',
        assetId: '19100000-0000-4000-8000-000000000002',
      },
    );
    const addedExpression = asExpressionCharacter(added.characters[0]!).expressions[1]!;
    const expressionRenamed = characterService.renameExpression(
      added,
      character.id,
      addedExpression.id,
      'angry',
    );

    expect(expressionRenamed.characters[0]).toMatchObject({
      name: '熊猫',
      expressions: [
        { name: 'normal' },
        { name: 'angry' },
      ],
    });
    const deleted = characterService.deleteCharacter(
      expressionRenamed,
      character.id,
    );
    expect(deleted.characters).toEqual([]);
    expect(deleted.voiceProfiles).toEqual([]);
  });

  it('rejects duplicate character names and audio expression assets', () => {
    const characterService = service();
    const created = characterService.create(emptyCharacterProject(), {
      name: 'Panda',
      expressions: [
        {
          name: 'normal',
          assetId: '19100000-0000-4000-8000-000000000001',
        },
      ],
    });
    expectCharacterError(
      () =>
        characterService.create(created, {
          name: ' panda ',
          expressions: [
            {
              name: 'normal',
              assetId: '19100000-0000-4000-8000-000000000001',
            },
          ],
        }),
      'DUPLICATE_CHARACTER_NAME',
    );
    expectCharacterError(
      () =>
        characterService.addExpression(created, asExpressionCharacter(created.characters[0]!).id, {
          name: 'voice',
          assetId: created.assets.find(
            (asset) => asset.kind === 'audio',
          )!.id,
        }),
      'IMAGE_ASSET_REQUIRED',
    );
  });

  it('requires replacing the default expression before deletion and protects referenced expressions', () => {
    const characterService = service();
    const created = characterService.create(emptyCharacterProject(), {
      name: 'Panda',
      expressions: [
        {
          name: 'normal',
          assetId: '19100000-0000-4000-8000-000000000001',
        },
        {
          name: 'angry',
          assetId: '19100000-0000-4000-8000-000000000002',
        },
      ],
    });
    const character = asExpressionCharacter(created.characters[0]!);
    expectCharacterError(
      () =>
        characterService.removeExpression(
          created,
          character.id,
          character.defaultExpressionId,
        ),
      'DEFAULT_EXPRESSION_REQUIRED',
    );

    const angry = character.expressions[1]!;
    const withAngryDefault = characterService.setDefaultExpression(
      created,
      character.id,
      angry.id,
    );
    const removed = characterService.removeExpression(
      withAngryDefault,
      character.id,
      character.expressions[0]!.id,
    );
    expect(asExpressionCharacter(removed.characters[0]!).expressions).toEqual([angry]);
    expect(asExpressionCharacter(removed.characters[0]!).baseAssetId).toBe(angry.assetId);
  });

  it('warns when real image metadata differs by more than 30 percent without changing either size', () => {
    const project = createPanda();
    const character = asExpressionCharacter(project.characters[0]!);
    const warnings = service().dimensionWarnings(project, character.id);

    expect(warnings).toEqual([
      expect.objectContaining({
        label: '表情“angry”',
        baseline: { width: 100, height: 100 },
        candidate: { width: 150, height: 100 },
        widthDifferenceRatio: 0.5,
      }),
      expect.objectContaining({
        label: '张嘴图片',
        baseline: { width: 100, height: 100 },
        candidate: { width: 100, height: 45 },
        heightDifferenceRatio: 0.55,
      }),
    ]);
    expect(
      project.assets.find(
        (asset) => asset.id === '19100000-0000-4000-8000-000000000002',
      ),
    ).toMatchObject({ width: 150, height: 100 });
  });

  it('keeps the logical center stable when switching between different-sized expressions', () => {
    const project = createPanda();
    const character = asExpressionCharacter(project.characters[0]!);
    const center = { x: 960, y: 540 };
    const normal = service().resolveAppearance(
      project,
      character.id,
      character.expressions[0]!.id,
      center,
    );
    const angry = service().resolveAppearance(
      project,
      character.id,
      character.expressions[1]!.id,
      center,
    );

    expect(normal.center).toEqual(center);
    expect(angry.center).toEqual(center);
    expect(normal.width).toBe(100);
    expect(angry.width).toBe(150);
    expect(normal.scaleX).toBe(-0.8);
    expect(angry.scaleX).toBe(-0.8);
  });

  it('blocks deleting a character used by a layer or dialogue through the shared reference scanner', () => {
    const migrated = migrateProject(exampleProject);
    const character = asExpressionCharacter(migrated.characters[0]!);
    const error = expectCharacterError(
      () => service().deleteCharacter(migrated, character.id),
      'CHARACTER_REFERENCED',
    );

    expect(error.references.map((reference) => reference.kind)).toEqual([
      'shot-layer-character',
      'dialogue-character',
    ]);
    expect(error.references[0]?.path).toContain('shots[0].layers[1]');
  });

  it('blocks deleting a non-default expression used by a timeline event', () => {
    const project = migrateProject(exampleProject);
    const character = asExpressionCharacter(project.characters[0]!);
    const expression = character.expressions[1]!;
    const error = expectCharacterError(
      () =>
        service().removeExpression(
          project,
          character.id,
          expression.id,
        ),
      'EXPRESSION_REFERENCED',
    );

    expect(error.references).toEqual([
      expect.objectContaining({
        kind: 'timeline-expression-event',
        path: 'shots[0].timelineEvents[4].expressionId',
      }),
    ]);
  });

  it('replaces a shot/timeline-referenced expression asset without changing its ID or name', () => {
    const characterService = service();
    const project = migrateProject(exampleProject);
    const character = asExpressionCharacter(project.characters[0]!);
    const expression = character.expressions[1]!;
    const oldAssetId = expression.assetId;
    const replacementAsset = project.assets.find(
      (asset) =>
        asset.kind === 'image' &&
        !character.expressions.some(
          (candidate) => candidate.assetId === asset.id,
        ),
    )!;
    if (replacementAsset.kind !== 'image') {
      throw new Error('Expected the replacement fixture to be an image.');
    }
    const referenced = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.source.kind === 'character'
            ? {
                ...layer,
                source: {
                  ...layer.source,
                  expressionId: expression.id,
                },
              }
            : layer,
        ),
      })),
    });
    const withDefault = characterService.setDefaultExpression(
      referenced,
      character.id,
      expression.id,
    );
    const replaced = characterService.setExpressionAsset(
      withDefault,
      character.id,
      expression.id,
      replacementAsset.id,
    );
    const nextCharacter = asExpressionCharacter(replaced.characters[0]!);
    const nextExpression = nextCharacter.expressions.find(
      (candidate) => candidate.id === expression.id,
    )!;

    expect(nextExpression).toEqual({
      ...expression,
      assetId: replacementAsset.id,
    });
    expect(nextCharacter.defaultExpressionId).toBe(expression.id);
    expect(nextCharacter.baseAssetId).toBe(replacementAsset.id);
    expect(
      scanExpressionReferences(
        replaced,
        character.id,
        expression.id,
      ).map((reference) => reference.kind),
    ).toEqual([
      'shot-layer-expression',
      'timeline-expression-event',
    ]);
    expect(scanAssetReferences(replaced, oldAssetId)).toEqual([]);
    expect(
      characterService.dimensionWarnings(replaced, character.id),
    ).toEqual([
      expect.objectContaining({
        expressionId: character.expressions[0]!.id,
        baseline: {
          width: replacementAsset.width,
          height: replacementAsset.height,
        },
      }),
    ]);
  });

  it('rejects replacing an expression with a non-image asset', () => {
    const project = migrateProject(exampleProject);
    const character = asExpressionCharacter(project.characters[0]!);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;

    expectCharacterError(
      () =>
        service().setExpressionAsset(
          project,
          character.id,
          character.expressions[0]!.id,
          audio.id,
        ),
      'IMAGE_ASSET_REQUIRED',
    );
  });
});
