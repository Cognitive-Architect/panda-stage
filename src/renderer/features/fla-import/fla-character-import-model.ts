import type { FlaRenderableTargetCatalogEntry } from '../../../shared/fla-static-snapshot-api';

export function getCharacterImportSceneEntries(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): FlaRenderableTargetCatalogEntry[] {
  return entries.filter((entry) => entry.target.kind === 'scene');
}

export function getUniqueCharacterImportCandidate(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): FlaRenderableTargetCatalogEntry | null {
  const candidates = getCharacterImportSceneEntries(entries).filter(
    (entry) => entry.previewSupported && !entry.isBlank,
  );
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export function getSelectableCharacterImportCandidateCount(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): number {
  return getCharacterImportSceneEntries(entries).filter(
    (entry) => entry.previewSupported && !entry.isBlank,
  ).length;
}
