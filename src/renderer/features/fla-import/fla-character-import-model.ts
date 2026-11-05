import type { FlaRenderableTargetCatalogEntry } from '../../../shared/fla-static-snapshot-api';
import { isR05SafeGraphicCandidateId } from '../../../shared/fla-character-import-safe-graphic-targets';

export function getCharacterImportEntries(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): FlaRenderableTargetCatalogEntry[] {
  return entries.filter((entry) => entry.target.kind === 'scene' || (
    entry.target.kind === 'graphic-symbol' &&
    entry.catalogRole === 'scene-referenced-graphic' &&
    isR05SafeGraphicCandidateId(entry.target.renderTargetId)
  ));
}

export function getUniqueCharacterImportCandidate(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): FlaRenderableTargetCatalogEntry | null {
  const candidates = getCharacterImportEntries(entries).filter(
    (entry) => entry.previewSupported && !entry.isBlank,
  );
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

export function getSelectableCharacterImportCandidateCount(
  entries: readonly FlaRenderableTargetCatalogEntry[],
): number {
  return getCharacterImportEntries(entries).filter(
    (entry) => entry.previewSupported && !entry.isBlank,
  ).length;
}
