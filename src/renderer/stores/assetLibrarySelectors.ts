import type {
  AnimationDefinition,
  Asset,
  AssetDropPayload,
  ImageAssetUsage,
  Project,
} from '../../domain';

export type AssetLibraryCategory =
  | 'character'
  | 'background'
  | 'audio';

export type AssetLibraryFilter = 'all' | AssetLibraryCategory | 'animation';

export type AssetLibraryUsageFilter = 'all' | ImageAssetUsage;

export interface AssetLibraryEntry {
  id: string;
  asset: Asset;
  category: AssetLibraryCategory;
  contextLabel: string;
  dropPayload: AssetDropPayload;
}

export type AssetLibraryItem =
  | { kind: 'asset'; id: string; entry: AssetLibraryEntry }
  | { kind: 'animation'; id: string; animation: AnimationDefinition };

export const ASSET_LIBRARY_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色图片' },
  { id: 'background', label: '未绑定角色' },
  { id: 'audio', label: '音频' },
  { id: 'animation', label: '动画' },
] as const satisfies readonly {
  id: AssetLibraryFilter;
  label: string;
}[];

export const ASSET_LIBRARY_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色' },
  { id: 'background', label: '未绑定' },
  { id: 'audio', label: '音频' },
  { id: 'animation', label: '动画' },
] as const satisfies readonly {
  id: AssetLibraryFilter;
  label: string;
}[];

export function assetCategory(
  project: Project,
  asset: Asset,
): AssetLibraryCategory {
  if (asset.kind === 'audio') return 'audio';
  const characterAssetIds = new Set(
    project.characters.flatMap((character) =>
      character.mode === 'adaptive-parts'
        ? character.parts.map((part) => part.assetId)
        : [
            character.baseAssetId,
            ...(character.mode === 'composite' ? [character.bodyAssetId] : []),
            ...character.expressions.map((expression) => expression.assetId),
            ...(character.mouthOpenAssetId
              ? [character.mouthOpenAssetId]
              : []),
          ],
    ),
  );
  return characterAssetIds.has(asset.id) ? 'character' : 'background';
}

export function selectAssetLibraryEntries(
  project: Project,
  category: AssetLibraryFilter,
): AssetLibraryEntry[] {
  const entries: AssetLibraryEntry[] = [];
  const sequenceCreatedAssetIds = new Set(
    project.animations.flatMap((animation) =>
      animation.frames
        .filter((frame) => frame.createdBySequenceImport)
        .map((frame) => frame.assetId),
    ),
  );
  const separatelyUsedAssetIds = new Set<string>();
  for (const character of project.characters) {
    if (character.mode === 'adaptive-parts') {
      character.parts.forEach((part) => separatelyUsedAssetIds.add(part.assetId));
      continue;
    }
    separatelyUsedAssetIds.add(character.baseAssetId);
    if (character.mode === 'composite') {
      separatelyUsedAssetIds.add(character.bodyAssetId);
      if (character.head) separatelyUsedAssetIds.add(character.head.assetId);
    }
    for (const expression of character.expressions) {
      separatelyUsedAssetIds.add(expression.assetId);
    }
    if (character.mouthOpenAssetId) {
      separatelyUsedAssetIds.add(character.mouthOpenAssetId);
    }
  }
  for (const shot of project.shots) {
    for (const layer of shot.layers) {
      if (layer.source.kind === 'asset') {
        separatelyUsedAssetIds.add(layer.source.assetId);
      }
    }
  }
  for (const asset of project.assets) {
    if (
      asset.kind === 'image' &&
      sequenceCreatedAssetIds.has(asset.id) &&
      !separatelyUsedAssetIds.has(asset.id)
    ) {
      continue;
    }
    const resolvedCategory = assetCategory(project, asset);
    if (category !== 'all' && resolvedCategory !== category) continue;
    if (resolvedCategory === 'audio') {
      entries.push({
        id: `audio:${asset.id}`,
        asset,
        category: resolvedCategory,
        contextLabel: '音频',
        dropPayload: {
          version: 2,
          type: 'audio',
          assetId: asset.id,
        },
      });
      continue;
    }
    if (resolvedCategory === 'background') {
      entries.push({
        id: `asset:${asset.id}`,
        asset,
        category: resolvedCategory,
        contextLabel: '图片',
        dropPayload: {
          version: 2,
          type: 'asset-image',
          assetId: asset.id,
        },
      });
      continue;
    }

    const expressionEntries = project.characters.flatMap(
      (character) =>
        (character.mode === 'adaptive-parts' ? [] : character.expressions)
          .filter((expression) => expression.assetId === asset.id)
          .map((expression) => ({
            id: `expression:${character.id}:${expression.id}`,
            asset,
            category: resolvedCategory,
            contextLabel: `${character.name} · ${expression.name}`,
            dropPayload: {
              version: 2 as const,
              type: 'character-expression' as const,
              assetId: asset.id,
              characterId: character.id,
              expressionId: expression.id,
            },
          })),
    );
    if (expressionEntries.length > 0) {
      entries.push(...expressionEntries);
      continue;
    }

    // Body/Mouth/base-only images have no expression identity. They remain
    // explicit raw-image actions instead of guessing a Character identity.
    const isBodyAsset = project.characters.some(
      (character) =>
        character.mode === 'composite' &&
        character.bodyAssetId === asset.id,
    );
    const isPartAsset = project.characters.some(
      (character) =>
        character.mode === 'adaptive-parts' &&
        character.parts.some((part) => part.assetId === asset.id),
    );
    const isMouthAsset = project.characters.some(
      (character) =>
        character.mode !== 'adaptive-parts' &&
        character.mouthOpenAssetId === asset.id,
    );
    entries.push({
      id: `character-direct:${asset.id}`,
      asset,
      category: resolvedCategory,
      contextLabel: isBodyAsset
        ? '身体素材 · 作为普通图片放置'
          : isPartAsset
            ? '部件图片 · 作为普通图片放置'
            : isMouthAsset
          ? '嘴型素材 · 作为普通图片放置'
          : '角色素材 · 作为普通图片放置',
      dropPayload: {
        version: 2,
        type: 'asset-image',
        assetId: asset.id,
      },
    });
  }
  return entries.sort((left, right) => {
    const byAsset = left.asset.name.localeCompare(
      right.asset.name,
      'zh-CN',
    );
    return byAsset || left.contextLabel.localeCompare(
      right.contextLabel,
      'zh-CN',
    );
  });
}

export function selectAssetLibraryItems(
  project: Project,
  category: AssetLibraryFilter,
): AssetLibraryItem[] {
  const items: AssetLibraryItem[] = selectAssetLibraryEntries(project, category)
    .map((entry) => ({ kind: 'asset', id: entry.id, entry }));
  if (category === 'all' || category === 'animation') {
    items.push(...project.animations.map((animation) => ({
      kind: 'animation' as const,
      id: `animation:${animation.id}`,
      animation,
    })));
  }
  const itemName = (item: AssetLibraryItem): string =>
    item.kind === 'animation' ? item.animation.name : item.entry.asset.name;
  return items.sort((left, right) =>
    itemName(left).localeCompare(itemName(right), 'zh-CN') || left.id.localeCompare(right.id),
  );
}

export function assetCategoryCounts(
  project: Project,
): Record<AssetLibraryCategory, number> {
  return {
    character: selectAssetLibraryEntries(project, 'character').length,
    background: selectAssetLibraryEntries(project, 'background').length,
    audio: selectAssetLibraryEntries(project, 'audio').length,
  };
}

export function assetLibraryFilterCounts(
  project: Project,
): Record<AssetLibraryFilter, number> {
  const entries = selectAssetLibraryEntries(project, 'all');
  return {
    all: entries.length + project.animations.length,
    character: entries.filter((entry) => entry.category === 'character')
      .length,
    background: entries.filter((entry) => entry.category === 'background')
      .length,
    audio: entries.filter((entry) => entry.category === 'audio').length,
    animation: project.animations.length,
  };
}

export function filterAssetLibraryItems(
  items: readonly AssetLibraryItem[],
  query: string,
  usage: AssetLibraryUsageFilter = 'all',
): AssetLibraryItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  return items.filter((item) => {
    if (usage !== 'all' && (
      item.kind !== 'asset' ||
      item.entry.asset.kind !== 'image' ||
      item.entry.asset.usage !== usage
    )) return false;
    if (!normalizedQuery) return true;
    const values = item.kind === 'animation'
      ? [item.animation.name, item.animation.source.basename, item.animation.source.targetName]
      : [
          item.entry.asset.name,
          item.entry.contextLabel,
          ...(item.entry.asset.kind === 'image' ? item.entry.asset.keywords : []),
        ];
    return values.some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery));
  });
}

export function filterAssetLibraryEntries(
  entries: readonly AssetLibraryEntry[],
  query: string,
  usage: AssetLibraryUsageFilter = 'all',
): AssetLibraryEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const usageFilteredEntries = usage === 'all'
    ? entries
    : entries.filter(
        (entry) =>
          entry.asset.kind === 'image' && entry.asset.usage === usage,
      );
  if (!normalizedQuery) return [...usageFilteredEntries];

  return usageFilteredEntries.filter((entry) =>
    [
      entry.asset.name,
      entry.contextLabel,
      ...(entry.asset.kind === 'image' ? entry.asset.keywords : []),
    ].some((value) =>
      value.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
    ),
  );
}
