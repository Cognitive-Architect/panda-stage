import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV6Schema,
  migrateProject,
  scanAssetReferences,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

function compositeProject() {
  const project = buildProject();
  const character = project.characters[0]!;
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...character,
        mode: 'composite',
        bodyAssetId: IDS.assetBg,
        facePlacement: {
          offsetX: -12.5,
          offsetY: 8,
          scale: 1.25,
        },
        head: {
          assetId: IDS.assetChar2,
          placement: { offsetX: 14, offsetY: -6, scale: 0.8 },
          pivot: { x: 320, y: 280 },
        },
      },
    ],
  });
}

describe('BFM-S01 Character schema', () => {
  it('persists a composite body and one shared face placement without changing baseAssetId', () => {
    const project = compositeProject();
    const character = project.characters[0]!;

    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(character).toMatchObject({
      mode: 'composite',
      bodyAssetId: IDS.assetBg,
      facePlacement: {
        offsetX: -12.5,
        offsetY: 8,
        scale: 1.25,
      },
      head: {
        assetId: IDS.assetChar2,
        placement: { offsetX: 14, offsetY: -6, scale: 0.8 },
        pivot: { x: 320, y: 280 },
      },
      baseAssetId: IDS.assetChar,
    });
    expect(migrateProject(project)).toEqual(project);
  });

  it('rejects invalid mode/placement combinations and dangling Body assets', () => {
    const project = buildProject();
    const character = project.characters[0]!;

    expect(
      ProjectSchema.safeParse({
        ...project,
        characters: [
          {
            ...character,
            mode: 'single-image',
            bodyAssetId: IDS.assetBg,
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ProjectSchema.safeParse({
        ...project,
        characters: [
          {
            ...character,
            mode: 'composite',
            bodyAssetId: IDS.assetBg,
            facePlacement: { offsetX: 0, offsetY: 0, scale: 0 },
          },
        ],
      }).success,
    ).toBe(false);

    const dangling = ProjectSchema.safeParse({
      ...project,
      characters: [
        {
          ...character,
          mode: 'composite',
          bodyAssetId: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
          facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        },
      ],
    });
    expect(dangling.success).toBe(false);
    if (!dangling.success) {
      expect(dangling.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['characters', 0, 'bodyAssetId'] }),
        ]),
      );
    }
  });

  it('requires a valid Character-local Head only on composite Characters', () => {
    const project = buildProject();
    const character = project.characters[0]!;
    const validHead = {
      assetId: IDS.assetChar2,
      placement: { offsetX: 4, offsetY: -9, scale: 0.75 },
      pivot: { x: 320, y: 280 },
    };

    expect(
      ProjectSchema.safeParse({
        ...project,
        characters: [
          {
            ...character,
            mode: 'composite',
            bodyAssetId: IDS.assetBg,
            facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
            head: validHead,
          },
        ],
      }).success,
    ).toBe(true);

    for (const head of [
      { ...validHead, placement: { ...validHead.placement, scale: 0 } },
      {
        ...validHead,
        placement: { ...validHead.placement, offsetX: Number.NaN },
      },
      { ...validHead, pivot: { ...validHead.pivot, y: Number.POSITIVE_INFINITY } },
    ]) {
      expect(
        ProjectSchema.safeParse({
          ...project,
          characters: [
            {
              ...character,
              mode: 'composite',
              bodyAssetId: IDS.assetBg,
              facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
              head,
            },
          ],
        }).success,
      ).toBe(false);
    }

    expect(
      ProjectSchema.safeParse({
        ...project,
        characters: [{ ...character, head: validHead }],
      }).success,
    ).toBe(false);

    const dangling = ProjectSchema.safeParse({
      ...project,
      characters: [
        {
          ...character,
          mode: 'composite',
          bodyAssetId: IDS.assetBg,
          facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
          head: { ...validHead, assetId: 'ffffffff-ffff-4fff-8fff-fffffffffff1' },
        },
      ],
    });
    expect(dangling.success).toBe(false);
    if (!dangling.success) {
      expect(dangling.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['characters', 0, 'head', 'assetId'] }),
        ]),
      );
    }

    const nonImage = ProjectSchema.safeParse({
      ...project,
      assets: [
        ...project.assets,
        {
          id: '10000000-0000-4000-8000-000000000004',
          kind: 'audio',
          name: 'Voice asset',
          relativePath: 'voice.wav',
          mimeType: 'audio/wav',
        },
      ],
      characters: [
        {
          ...character,
          mode: 'composite',
          bodyAssetId: IDS.assetBg,
          facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
          head: {
            ...validHead,
            assetId: '10000000-0000-4000-8000-000000000004',
          },
        },
      ],
    });
    expect(nonImage.success).toBe(false);
  });

  it('keeps the historical v6 Character shape independent from current validation', () => {
    const project = buildProject();
    const { mode, ...historicalCharacter } = project.characters[0]!;
    void mode;
    const v6 = {
      ...project,
      schemaVersion: 6 as const,
      characters: [historicalCharacter],
    };

    expect(ProjectSchema.safeParse(v6).success).toBe(false);
    expect(ProjectV6Schema.parse(v6).characters[0]).toEqual(
      historicalCharacter,
    );
    expect(migrateProject(v6).characters[0]).toMatchObject({
      mode: 'single-image',
      baseAssetId: historicalCharacter.baseAssetId,
    });
  });

  it('scans a composite Body reference for asset deletion protection', () => {
    const project = compositeProject();
    const references = scanAssetReferences(project, IDS.assetBg);

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character-body',
          path: 'characters[0].bodyAssetId',
        }),
      ]),
    );
  });

  it('scans the composite Head asset reference for deletion protection', () => {
    const project = compositeProject();
    const references = scanAssetReferences(project, IDS.assetChar2);

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character-head',
          path: 'characters[0].head.assetId',
        }),
      ]),
    );
  });
});
