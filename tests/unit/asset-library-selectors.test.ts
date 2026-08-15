import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject } from '../../src/domain';
import {
  assetCategoryCounts,
  selectAssetLibraryEntries,
} from '../../src/renderer/stores/assetLibrarySelectors';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('asset library selectors', () => {
  it('categorizes character images, backgrounds, and audio', () => {
    const project = migrateProject(exampleProject);
    expect(assetCategoryCounts(project)).toEqual({
      character: 2,
      background: 1,
      audio: 1,
    });
    expect(
      selectAssetLibraryEntries(project, 'character').map(
        (entry) => entry.asset.name,
      ),
    ).toEqual(['Panda happy', 'Panda neutral']);
  });

  it('classifies a configured mouth image as a character image', () => {
    const project = migrateProject(exampleProject);
    const withMouth = ProjectSchema.parse({
      ...project,
      characters: project.characters.map((character, index) =>
        index === 0
          ? {
              ...character,
              mouthOpenAssetId: project.assets[0]!.id,
            }
          : character,
      ),
    });

    expect(assetCategoryCounts(withMouth)).toEqual({
      character: 3,
      background: 0,
      audio: 1,
    });
    const mouthEntry = selectAssetLibraryEntries(
      withMouth,
      'character',
    ).find((entry) => entry.asset.id === project.assets[0]!.id);
    expect(mouthEntry).toMatchObject({
      contextLabel: '嘴型素材 · 作为普通图片放置',
      dropPayload: {
        version: 2,
        type: 'asset-image',
        assetId: project.assets[0]!.id,
      },
    });
  });

  it('emits one explicit identity entry per character expression even when assets are shared', () => {
    const project = migrateProject(exampleProject);
    const characterA = project.characters[0]!;
    const sharedAssetId = characterA.expressions[0]!.assetId;
    const characterB = {
      ...characterA,
      id: 'a4500000-0000-4000-8000-000000000001',
      name: 'Panda B',
      expressions: [
        {
          ...characterA.expressions[0]!,
          id: 'a4500000-0000-4000-8000-000000000002',
          name: 'normal B',
          assetId: sharedAssetId,
        },
      ],
      defaultExpressionId:
        'a4500000-0000-4000-8000-000000000002',
      baseAssetId: sharedAssetId,
      defaultVoiceProfileId:
        'a4500000-0000-4000-8000-000000000003',
    };
    const shared = ProjectSchema.parse({
      ...project,
      characters: [characterA, characterB],
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

    const entries = selectAssetLibraryEntries(
      shared,
      'character',
    ).filter((entry) => entry.asset.id === sharedAssetId);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.dropPayload)).toContainEqual({
      version: 2,
      type: 'character-expression',
      assetId: sharedAssetId,
      characterId: characterB.id,
      expressionId: characterB.expressions[0]!.id,
    });
  });

  it('selects and sorts 100 background fixtures without loading file paths', () => {
    const base = migrateProject({
      ...exampleProject,
      assets: [],
      characters: [],
      voiceProfiles: [],
      shots: [],
    });
    const project = ProjectSchema.parse({
      ...base,
      assets: Array.from({ length: 100 }, (_, index) => ({
        id: randomUUID(),
        name: `Background ${String(99 - index).padStart(3, '0')}`,
        relativePath: `assets/source-${index}.png`,
        mimeType: 'image/png',
        kind: 'image',
        width: 16,
        height: 12,
      })),
    });
    const entries = selectAssetLibraryEntries(project, 'background');
    expect(entries).toHaveLength(100);
    expect(entries[0]?.asset.name).toBe('Background 000');
    expect(entries[99]?.asset.name).toBe('Background 099');
  });
});
