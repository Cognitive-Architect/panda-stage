import type {
  Asset,
  AssetDropPayload,
  Project,
} from '../../domain';

export type AssetLibraryCategory =
  | 'character'
  | 'background'
  | 'audio';

export interface AssetLibraryEntry {
  id: string;
  asset: Asset;
  category: AssetLibraryCategory;
  contextLabel: string;
  dropPayload: AssetDropPayload;
}

export const ASSET_LIBRARY_CATEGORIES = [
  { id: 'character', label: '角色图片' },
  { id: 'background', label: '背景图片' },
  { id: 'audio', label: '音频' },
] as const satisfies readonly {
  id: AssetLibraryCategory;
  label: string;
}[];

export function assetCategory(
  project: Project,
  asset: Asset,
): AssetLibraryCategory {
  if (asset.kind === 'audio') return 'audio';
  const characterAssetIds = new Set(
    project.characters.flatMap((character) => [
      character.baseAssetId,
      ...character.expressions.map((expression) => expression.assetId),
      ...(character.mouthOpenAssetId
        ? [character.mouthOpenAssetId]
        : []),
    ]),
  );
  return characterAssetIds.has(asset.id) ? 'character' : 'background';
}

export function selectAssetLibraryEntries(
  project: Project,
  category: AssetLibraryCategory,
): AssetLibraryEntry[] {
  const entries: AssetLibraryEntry[] = [];
  for (const asset of project.assets) {
    const resolvedCategory = assetCategory(project, asset);
    if (resolvedCategory !== category) continue;
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
        character.expressions
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

    // A mouth-open-only/base-only image has no expression identity. It is
    // intentionally placed as a direct image layer instead of guessing.
    entries.push({
      id: `character-direct:${asset.id}`,
      asset,
      category: resolvedCategory,
      contextLabel: '嘴型素材 · 作为普通图片放置',
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

export function assetCategoryCounts(
  project: Project,
): Record<AssetLibraryCategory, number> {
  return {
    character: selectAssetLibraryEntries(project, 'character').length,
    background: selectAssetLibraryEntries(project, 'background').length,
    audio: selectAssetLibraryEntries(project, 'audio').length,
  };
}
