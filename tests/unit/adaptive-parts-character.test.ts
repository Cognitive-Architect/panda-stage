import { describe, expect, it } from 'vitest';
import {
  AdaptivePartsCharacterSchema,
  CharacterService,
  CharacterServiceError,
  LayerService,
  LayerServiceError,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV14Schema,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  migrateProject,
  scanAssetReferences,
  type Project,
} from '../../src/domain';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

function createAdaptivePartsProject(): {
  service: CharacterService;
  project: Project;
  characterId: string;
} {
  const service = new CharacterService();
  const project = service.createAdaptiveParts(buildProject(), {
    name: 'Synthetic Static Parts',
    sourceRootTransform: adaptivePartsSourceRootTransform(),
    parts: adaptivePartsFixture(IDS.assetChar),
  });
  const character = project.characters.find(
    (candidate) => candidate.name === 'Synthetic Static Parts',
  );
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('Expected the Adaptive Parts test Character.');
  }
  return { service, project, characterId: character.id };
}

function expectDefinitionError(action: () => unknown): CharacterServiceError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CharacterServiceError);
    expect((error as CharacterServiceError).code).toBe(
      'INVALID_ADAPTIVE_PARTS_DEFINITION',
    );
    return error as CharacterServiceError;
  }
  throw new Error('Expected an invalid Adaptive Parts definition error.');
}

describe('Adaptive Parts Character C1 model', () => {
  it('keeps five source instances in bottom-to-top order and accepts a separate composite Part', () => {
    const { service, project, characterId } = createAdaptivePartsProject();
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );

    expect(character).toMatchObject({ mode: 'adaptive-parts' });
    if (!character || character.mode !== 'adaptive-parts') return;
    expect(character.parts).toHaveLength(6);
    expect(character.parts.map((part) => part.displayName)).toEqual([
      'com6',
      'com2',
      'com5',
      'com4',
      'com3',
      'Body + arm composite',
    ]);
    expect(character.parts.map((part) => part.drawOrder)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(character.sourceRootTransform).toEqual(
      adaptivePartsSourceRootTransform(),
    );
    expect(character.parts.slice(0, 5).map((part) => part.restTransform)).toEqual([
      { a: 1, b: 0, c: 0, d: 1, tx: 191.1, ty: 424.75 },
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 396.3 },
      { a: 1, b: 0, c: 0, d: 1, tx: 167.05, ty: 665.2 },
      { a: 1, b: 0, c: 0, d: 1, tx: 151.7, ty: 191.1 },
      { a: 1, b: 0, c: 0, d: 1, tx: 230.2, ty: 669.7 },
    ]);
    expect(character.parts.slice(0, 5).map((part) => part.source)).toEqual([
      {
        kind: 'source-instance',
        sourceId: 'com1.instances[4]:com6',
        sourcePoseFrame: 0,
        effectiveFrame: 0,
      },
      {
        kind: 'source-instance',
        sourceId: 'com1.instances[3]:com2',
        sourcePoseFrame: 0,
        effectiveFrame: 0,
      },
      {
        kind: 'source-instance',
        sourceId: 'com1.instances[2]:com5',
        sourcePoseFrame: 0,
        effectiveFrame: 0,
      },
      {
        kind: 'source-instance',
        sourceId: 'com1.instances[1]:com4',
        sourcePoseFrame: 0,
        effectiveFrame: 0,
      },
      {
        kind: 'source-instance',
        sourceId: 'com1.instances[0]:com3',
        sourcePoseFrame: 0,
        effectiveFrame: 0,
      },
    ]);
    expect(character.parts[5]!.source).toEqual({
      kind: 'manual',
      sourceId: 'manual:fixture:body-arm-composite',
    });
    expect(new Set(character.parts.map((part) => part.partId)).size).toBe(6);
    expect(new Set(character.parts.map((part) => part.source.sourceId)).size).toBe(6);
    expect(new Set(character.parts.map((part) => part.assetId))).toEqual(
      new Set([IDS.assetChar]),
    );
    expect(
      scanAssetReferences(project, IDS.assetChar).filter(
        (reference) => reference.kind === 'character-part',
      ),
    ).toHaveLength(6);

    const definition = service.getAdaptivePartsDefinition(project, characterId);
    definition.parts[0]!.restTransform.tx = -999;
    expect(character.parts[0]!.restTransform.tx).toBe(191.1);
    const freshDefinition = service.getAdaptivePartsDefinition(project, characterId);
    expect(service.applyAdaptivePartsDefinition(project, characterId, freshDefinition)).toBe(
      project,
    );

    const updated = service.updateAdaptivePart(
      project,
      characterId,
      character.parts[5]!.partId,
      { visible: false },
    );
    const updatedCharacter = updated.characters.find(
      (candidate) => candidate.id === characterId,
    );
    expect(updatedCharacter?.mode).toBe('adaptive-parts');
    if (updatedCharacter?.mode === 'adaptive-parts') {
      expect(updatedCharacter.parts[5]).toMatchObject({
        partId: character.parts[5]!.partId,
        visible: false,
      });
    }

    const updatedDefinition = service.getAdaptivePartsDefinition(
      updated,
      characterId,
    );
    updatedDefinition.sourceRootTransform.tx = 791;
    const movedSourceRoot = service.updateAdaptivePartsDefinition(
      updated,
      characterId,
      updatedDefinition,
    );
    const movedCharacter = movedSourceRoot.characters.find(
      (candidate) => candidate.id === characterId,
    );
    expect(movedCharacter?.mode).toBe('adaptive-parts');
    if (movedCharacter?.mode === 'adaptive-parts') {
      expect(movedCharacter.sourceRootTransform.tx).toBe(791);
      expect(movedCharacter.parts[0]!.restTransform.tx).toBe(191.1);
    }
  });

  it('rejects duplicate identity/source instances, invalid order, transforms, crops, and asset mappings', () => {
    const { service, project, characterId } = createAdaptivePartsProject();
    const validDefinition = service.getAdaptivePartsDefinition(project, characterId);
    const valid = validDefinition.parts;
    const definitionFor = (parts: typeof valid) => ({
      sourceRootTransform: validDefinition.sourceRootTransform,
      parts,
    });

    const duplicatePartId = structuredClone(valid);
    duplicatePartId[1]!.partId = duplicatePartId[0]!.partId;
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(duplicatePartId),
      ),
    );

    const duplicateSource = structuredClone(valid);
    duplicateSource[1]!.source.sourceId = duplicateSource[0]!.source.sourceId;
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(duplicateSource),
      ),
    );

    const duplicateDrawOrder = structuredClone(valid);
    duplicateDrawOrder[1]!.drawOrder = 0;
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(duplicateDrawOrder),
      ),
    );

    const singularTransform = structuredClone(valid);
    singularTransform[0]!.restTransform = {
      a: 0,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0,
    };
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(singularTransform),
      ),
    );

    const outOfBoundsCrop = structuredClone(valid);
    outOfBoundsCrop[0]!.imageMapping.crop.width = 641;
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(outOfBoundsCrop),
      ),
    );

    const wrongAssetSize = structuredClone(valid);
    wrongAssetSize[0]!.assetId = IDS.assetBg;
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(wrongAssetSize),
      ),
    );

    const missingAsset = structuredClone(valid);
    missingAsset[0]!.assetId = '79000000-0000-4000-8000-000000000001';
    expect(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(missingAsset),
      ),
    ).toThrowError(expect.objectContaining({ code: 'IMAGE_ASSET_REQUIRED' }));

    const unsafeSourcePath = structuredClone(valid);
    unsafeSourcePath[0]!.source.sourceId = '../private/source';
    expectDefinitionError(() =>
      service.applyAdaptivePartsDefinition(
        project,
        characterId,
        definitionFor(unsafeSourcePath),
      ),
    );
  });

  it('keeps v14 strict and migrates its legacy Character shape to v15 unchanged', () => {
    const base = buildProject();
    const version14 = ProjectV14Schema.parse({
      ...base,
      schemaVersion: 14,
    });

    const migrated = migrateProject(version14);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(15);
    expect(migrated.characters).toEqual(version14.characters);
    expect(() => migrateProject({ ...version14, unknownFutureField: true })).toThrow();

    const adaptive = createAdaptivePartsProject().project.characters.at(-1)!;
    expect(adaptive.mode).toBe('adaptive-parts');
    expect(
      AdaptivePartsCharacterSchema.safeParse(adaptive).success,
    ).toBe(true);
    expect(
      ProjectV14Schema.safeParse({
        ...version14,
        characters: [adaptive],
      }).success,
    ).toBe(false);
  });

  it('keeps Adaptive Parts outside Stage character rendering in C1', () => {
    const { project, characterId } = createAdaptivePartsProject();
    const characterLayer = project.shots[0]!.layers.find(
      (layer) => layer.source.kind === 'character',
    )!;
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    )!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }

    const layerService = new LayerService();
    try {
      layerService.createFromAsset(project, IDS.shot, {
        version: 2,
        assetId: IDS.assetChar,
        type: 'character-expression',
        characterId,
        expressionId: IDS.expressionNormal,
        position: { x: 500, y: 600 },
      });
      throw new Error('Expected C1 to reject a Stage Character layer.');
    } catch (error) {
      expect(error).toBeInstanceOf(LayerServiceError);
      expect((error as LayerServiceError).code).toBe('CHARACTER_IDENTITY_MISMATCH');
    }

    const unsupportedProject = {
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === characterLayer.id
            ? {
                ...layer,
                source: {
                  kind: 'character' as const,
                  characterId,
                  expressionId: IDS.expressionNormal,
                },
              }
            : layer,
        ),
      })),
    } as Project;
    expect(() => ProjectSchema.parse(unsupportedProject)).toThrow(
      /Adaptive Parts Character/u,
    );

    const shot = unsupportedProject.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, unsupportedProject);
    const rendered = buildEditorStageRenderModel(
      unsupportedProject,
      shot,
      evaluated,
    );
    const layer = rendered.layers.find(
      (candidate) => candidate.layer.id === characterLayer.id,
    )!;
    expect(layer.evaluated).toMatchObject({ assetId: '', visible: false });
    expect(layer.visual).toMatchObject({
      kind: 'unsupported-character',
      parts: [],
      resources: { required: [], candidates: [], fallback: [] },
    });
    expect(layer.render.visible).toBe(false);
    expect(layer.asset.id).not.toBe(IDS.assetChar);
  });
});
