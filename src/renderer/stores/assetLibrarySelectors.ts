import type { Asset, Project } from '../../domain';

export type AssetLibraryCategory =
  | 'character'
  | 'background'
  | 'audio';

export interface AssetLibraryEntry {
  asset: Asset;
  category: AssetLibraryCategory;
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
    ]),
  );
  return characterAssetIds.has(asset.id) ? 'character' : 'background';
}

export function selectAssetLibraryEntries(
  project: Project,
  category: AssetLibraryCategory,
): AssetLibraryEntry[] {
  return project.assets
    .flatMap((asset) => {
      const resolvedCategory = assetCategory(project, asset);
      return resolvedCategory === category
        ? [{ asset, category: resolvedCategory }]
        : [];
    })
    .sort((left, right) =>
      left.asset.name.localeCompare(right.asset.name, 'zh-CN'),
    );
}

export function assetCategoryCounts(
  project: Project,
): Record<AssetLibraryCategory, number> {
  const counts = { character: 0, background: 0, audio: 0 };
  for (const asset of project.assets) {
    counts[assetCategory(project, asset)] += 1;
  }
  return counts;
}
