import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  migrateProject,
  updateImageAssetAuthorMetadata,
} from '../../src/domain';
import {
  assetCategoryCounts,
  assetLibraryFilterCounts,
  filterAssetLibraryEntries,
  selectAssetLibraryEntries,
} from '../../src/renderer/stores/assetLibrarySelectors';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
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
    const audioEntry = selectAssetLibraryEntries(project, 'audio')[0];
    expect(audioEntry?.dropPayload.type).toBe('audio');
  });

  it('provides an all filter and simple name search over the same entries', () => {
    const project = migrateProject(exampleProject);
    const entries = selectAssetLibraryEntries(project, 'all');

    expect(assetLibraryFilterCounts(project)).toEqual({
      all: 4,
      character: 2,
      background: 1,
      audio: 1,
    });
    expect(
      filterAssetLibraryEntries(entries, 'happy').map(
        (entry) => entry.asset.name,
      ),
    ).toEqual(['Panda happy']);
    expect(filterAssetLibraryEntries(entries, '  ')).toEqual(entries);
  });

  it('filters every explicit image usage without changing role grouping or drop identity', () => {
    const project = migrateProject(exampleProject);
    const template = project.assets.find((asset) => asset.kind === 'image')!;
    if (template.kind !== 'image') throw new Error('Expected image asset.');
    const usages = [
      'uncategorized',
      'background',
      'character',
      'prop',
      'effect',
    ] as const;
    const authoredImages = usages.map((usage) => ({
      ...template,
      id: randomUUID(),
      name: `Purpose ${usage}`,
      relativePath: `assets/${usage}.png`,
      usage,
      keywords: [],
    }));
    const withUsages = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, ...authoredImages],
    });
    const entries = selectAssetLibraryEntries(withUsages, 'all');
    const backgroundIds = new Set(
      selectAssetLibraryEntries(withUsages, 'background').map(
        (entry) => entry.asset.id,
      ),
    );

    for (const [index, usage] of usages.entries()) {
      const matchingEntries = filterAssetLibraryEntries(entries, '', usage);
      expect(matchingEntries).toEqual(
        entries.filter(
          (entry) =>
            entry.asset.kind === 'image' && entry.asset.usage === usage,
        ),
      );
      expect(matchingEntries.every(
        (entry) => entry.asset.kind === 'image' && entry.asset.usage === usage,
      )).toBe(true);
      const authoredEntry = matchingEntries.find(
        (entry) => entry.asset.id === authoredImages[index]!.id,
      );
      expect(authoredEntry?.dropPayload).toMatchObject({
        type: 'asset-image',
        assetId: authoredImages[index]!.id,
      });
      expect(backgroundIds.has(authoredImages[index]!.id)).toBe(true);
    }
  });

  it('searches author keywords while keeping same-name images independent by ID', () => {
    const project = migrateProject(exampleProject);
    const template = project.assets.find((asset) => asset.kind === 'image')!;
    if (template.kind !== 'image') throw new Error('Expected image asset.');
    const first = {
      ...template,
      id: randomUUID(),
      name: '道具图A',
      relativePath: 'assets/door-a.png',
      usage: 'prop' as const,
      keywords: ['门', '关闭'],
    };
    const second = {
      ...first,
      id: randomUUID(),
      relativePath: 'assets/door-b.png',
    };
    const withDuplicates = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, first, second],
    });
    const entries = selectAssetLibraryEntries(withDuplicates, 'all');
    const projectBeforeFiltering = JSON.stringify(withDuplicates);
    const store = new EditorProjectStore();
    store.open('D:\\project.pandastage', withDuplicates);
    const snapshotBeforeFiltering = store.getSnapshot();
    const historyBeforeFiltering = store.history.getSnapshot();
    const matches = filterAssetLibraryEntries(entries, '门', 'prop')
      .filter((entry) => entry.asset.name === '道具图A');

    expect(matches.map((entry) => entry.asset.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(matches[0]?.asset.id).not.toBe(matches[1]?.asset.id);
    expect(matches.every((entry) => entry.dropPayload.type === 'asset-image'))
      .toBe(true);
    expect(filterAssetLibraryEntries(entries, '', 'prop').map(
      (entry) => entry.asset.id,
    )).toEqual([first.id, second.id]);
    expect(filterAssetLibraryEntries(entries, 'missing keyword', 'prop'))
      .toEqual([]);
    expect(filterAssetLibraryEntries(entries, '', 'all')).toEqual(entries);
    expect(
      filterAssetLibraryEntries(
        selectAssetLibraryEntries(store.getSnapshot()!.project, 'all'),
        '道具图A',
        'prop',
      ).map((entry) => entry.asset.id),
    ).toEqual([first.id, second.id]);
    expect(store.getSnapshot()).toBe(snapshotBeforeFiltering);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(store.history.getSnapshot()).toEqual(historyBeforeFiltering);
    expect(JSON.stringify(withDuplicates)).toBe(projectBeforeFiltering);

    const edited = updateImageAssetAuthorMetadata(
      withDuplicates,
      first.id,
      { name: '木门·关闭', usage: 'prop', keywords: ['门', '关闭'] },
    );
    expect(edited.assets.find((asset) => asset.id === first.id)?.name).toBe(
      '木门·关闭',
    );
    expect(edited.assets.find((asset) => asset.id === second.id)).toEqual(
      second,
    );
    expect(
      selectAssetLibraryEntries(edited, 'background').some(
        (entry) => entry.asset.id === first.id,
      ),
    ).toBe(true);
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

  it('classifies a composite Body as Character-related without guessing Character identity', () => {
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const bodyAsset = project.assets.find(
      (asset) =>
        asset.kind === 'image' &&
        !character.expressions.some(
          (expression) => expression.assetId === asset.id,
        ),
    )!;
    const withBody = ProjectSchema.parse({
      ...project,
      characters: [
        {
          ...character,
          mode: 'composite' as const,
          bodyAssetId: bodyAsset.id,
          facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
        },
      ],
    });

    expect(assetCategoryCounts(withBody).character).toBeGreaterThan(2);
    const bodyEntry = selectAssetLibraryEntries(withBody, 'character').find(
      (entry) => entry.asset.id === bodyAsset.id,
    );
    expect(bodyEntry).toMatchObject({
      contextLabel: '身体素材 · 作为普通图片放置',
      dropPayload: {
        version: 2,
        type: 'asset-image',
        assetId: bodyAsset.id,
      },
    });
    expect(bodyEntry?.dropPayload).not.toHaveProperty('characterId');
    expect(bodyEntry?.dropPayload).not.toHaveProperty('expressionId');
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
        usage: 'uncategorized',
        keywords: [],
      })),
    });
    const entries = selectAssetLibraryEntries(project, 'background');
    expect(entries).toHaveLength(100);
    expect(entries[0]?.asset.name).toBe('Background 000');
    expect(entries[99]?.asset.name).toBe('Background 099');
  });
});
