import { flaUnifiedCandidateSelectionKey, type FlaUnifiedImportItem } from './fla-unified-import';
import type { FlaWorkbenchCandidate } from './fla-workbench-candidates';

export const FLA_UNIFIED_BULK_CONFIRM_THRESHOLD = 50;

export function matchesFlaUnifiedCandidateSearch(
  candidate: FlaWorkbenchCandidate,
  searchText: string,
): boolean {
  const query = searchText.trim().toLocaleLowerCase('en-US');
  if (!query) return true;
  return candidate.searchText.includes(query) ||
    candidate.displayLabel.toLocaleLowerCase('en-US').includes(query) ||
    candidate.source.basename.toLocaleLowerCase('en-US').includes(query);
}

export function filterFlaUnifiedCandidates(
  candidates: readonly FlaWorkbenchCandidate[],
  searchText: string,
  selectedOnly: boolean,
): FlaWorkbenchCandidate[] {
  return candidates.filter((candidate) =>
    (!selectedOnly || candidate.checked) &&
    (selectedOnly || matchesFlaUnifiedCandidateSearch(candidate, searchText)),
  );
}

/**
 * Keep checks across preview focus and filtering. A check is removed only
 * when that same import kind no longer has a currently selectable operation.
 */
export function reconcileFlaUnifiedSelection(
  current: Map<string, FlaUnifiedImportItem>,
  kind: FlaUnifiedImportItem['kind'],
  currentSelectableKeys: ReadonlySet<string>,
): Map<string, FlaUnifiedImportItem> {
  let changed = false;
  const next = new Map<string, FlaUnifiedImportItem>();
  for (const [key, item] of current) {
    if (item.kind === kind && !currentSelectableKeys.has(key)) {
      changed = true;
      continue;
    }
    next.set(key, item);
  }
  return changed ? next : current;
}

/**
 * Return every unique, currently eligible addition for a query. The complete
 * candidate catalog is supplied, so offscreen and virtualized rows count too.
 */
export function newSelectableFlaUnifiedCandidates(
  candidates: readonly FlaWorkbenchCandidate[],
  searchText: string,
): FlaWorkbenchCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.selectable || candidate.checked || !matchesFlaUnifiedCandidateSearch(candidate, searchText)) {
      return false;
    }
    const key = flaUnifiedCandidateSelectionKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function requiresFlaBulkSelectionConfirmation(newCandidateCount: number): boolean {
  return newCandidateCount > FLA_UNIFIED_BULK_CONFIRM_THRESHOLD;
}
