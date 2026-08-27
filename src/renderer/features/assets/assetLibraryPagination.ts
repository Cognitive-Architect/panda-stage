export const ASSET_LIBRARY_PAGE_SIZE = 8;

export function assetLibraryPageCount(entryCount: number): number {
  return Math.max(1, Math.ceil(entryCount / ASSET_LIBRARY_PAGE_SIZE));
}

export function paginateAssetLibraryEntries<T>(
  entries: readonly T[],
  page: number,
): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const start = (safePage - 1) * ASSET_LIBRARY_PAGE_SIZE;
  return entries.slice(start, start + ASSET_LIBRARY_PAGE_SIZE);
}
