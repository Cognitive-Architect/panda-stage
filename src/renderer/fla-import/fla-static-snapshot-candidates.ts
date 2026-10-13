import type {
  FlaRenderableTargetCatalogEntry,
  FlaRenderableTargetCatalogRole,
} from '../../shared/fla-static-snapshot-api';
import {
  createFlaWorkbenchCandidates,
  reconcileFlaWorkbenchFocus,
  readableRenderTargetLabel,
  snapshotCandidateId,
} from './fla-workbench-candidates';

export type FlaStaticSnapshotCandidateStatus = 'checking' | 'supported' | 'unsupported' | 'blank';

export interface FlaStaticSnapshotCandidatePreview {
  status: FlaStaticSnapshotCandidateStatus;
  previewUrl?: string;
  sha256?: string;
  reason?: string;
}

export interface FlaStaticSnapshotCandidateGroup {
  key: string;
  catalogRole: FlaRenderableTargetCatalogRole;
  entries: FlaRenderableTargetCatalogEntry[];
  duplicate: boolean;
  sourceCount: number;
  status: FlaStaticSnapshotCandidateStatus;
  sha256?: string;
}

export type FlaStaticSnapshotCandidatePreviews = Readonly<Record<string, FlaStaticSnapshotCandidatePreview>>;
export type FlaStaticSnapshotCandidateFilter = 'all' | 'compositions' | 'graphic-states';

export function reconcileFlaStaticSnapshotCandidateFocus(
  visibleGroups: readonly FlaStaticSnapshotCandidateGroup[],
  previews: FlaStaticSnapshotCandidatePreviews,
  currentFocusKey: string | null,
  allowCheckingCandidates: boolean,
): string | null {
  const candidates = createFlaWorkbenchCandidates({
    context: {
      sessionId: 'static-focus-reconciliation',
      source: { basename: 'focus.fla', sha256: '0'.repeat(64) },
    },
    snapshotEntries: visibleGroups.flatMap((group) => group.entries),
    snapshotPreviews: previews,
  }).filter((candidate) => candidate.kind === 'snapshot');
  return reconcileFlaWorkbenchFocus(candidates, currentFocusKey, allowCheckingCandidates);
}

export function flaStaticSnapshotCandidateKey(entry: FlaRenderableTargetCatalogEntry): string {
  return snapshotCandidateId(entry);
}

export function flaStaticSnapshotCandidateRole(
  entry: FlaRenderableTargetCatalogEntry,
): FlaRenderableTargetCatalogRole {
  return entry.catalogRole ?? (entry.target.kind === 'scene' ? 'scene' : 'graphic-state');
}

export function flaStaticSnapshotCandidateLabel(entry: FlaRenderableTargetCatalogEntry): string {
  return readableRenderTargetLabel(entry.target, true);
}

export function flaStaticSnapshotCandidateKindLabel(entry: FlaRenderableTargetCatalogEntry): string {
  switch (flaStaticSnapshotCandidateRole(entry)) {
    case 'scene':
      return '主场景';
    case 'scene-referenced-graphic':
      return '场景引用';
    case 'graphic-state':
      return entry.target.kind === 'timeline' ? '时间线' : '图形状态';
  }
}

export function groupFlaStaticSnapshotCandidates(
  entries: readonly FlaRenderableTargetCatalogEntry[],
  previews: FlaStaticSnapshotCandidatePreviews,
  search = '',
  filter: FlaStaticSnapshotCandidateFilter = 'all',
): FlaStaticSnapshotCandidateGroup[] {
  const query = search.trim().toLocaleLowerCase();
  const allGroups = new Map<string, {
    catalogRole: FlaRenderableTargetCatalogRole;
    entries: FlaRenderableTargetCatalogEntry[];
    status: FlaStaticSnapshotCandidateStatus;
    sha256?: string;
  }>();

  for (const entry of entries) {
    const catalogRole = flaStaticSnapshotCandidateRole(entry);
    if (filter === 'compositions' && catalogRole === 'graphic-state') continue;
    if (filter === 'graphic-states' && catalogRole !== 'graphic-state') continue;
    const key = flaStaticSnapshotCandidateKey(entry);
    const preview = previews[key];
    const status: FlaStaticSnapshotCandidateStatus = entry.isBlank
      ? 'blank'
      : preview?.status ?? (entry.previewSupported ? 'checking' : 'unsupported');
    const sha256 = status === 'supported' ? preview?.sha256 : undefined;
    const groupKey = sha256 ? `${catalogRole}:sha256:${sha256}` : `${catalogRole}:candidate:${key}`;
    const existing = allGroups.get(groupKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      allGroups.set(groupKey, {
        catalogRole,
        entries: [entry],
        status,
        ...(sha256 ? { sha256 } : {}),
      });
    }
  }

  const rolePriority: Record<FlaRenderableTargetCatalogRole, number> = {
    'scene-referenced-graphic': 0,
    scene: 1,
    'graphic-state': 2,
  };
  const availabilityPriority = (group: FlaStaticSnapshotCandidateGroup): number => {
    const firstEntry = group.entries[0];
    if (!firstEntry) return 3;
    if (firstEntry.isBlank) return 2;
    return firstEntry.previewSupported ? 0 : 1;
  };
  return [...allGroups.entries()]
    .map(([key, group]) => {
      const visibleEntries = group.entries.filter((entry) =>
        !query || flaStaticSnapshotCandidateLabel(entry).toLocaleLowerCase().includes(query),
      );
      return {
        key,
        catalogRole: group.catalogRole,
        entries: visibleEntries,
        duplicate: group.entries.length > 1,
        sourceCount: group.entries.length,
        status: group.status,
        ...(group.sha256 ? { sha256: group.sha256 } : {}),
      } satisfies FlaStaticSnapshotCandidateGroup;
    })
    .filter((group) => group.entries.length > 0)
    .sort((left, right) =>
      rolePriority[left.catalogRole] - rolePriority[right.catalogRole] ||
      availabilityPriority(left) - availabilityPriority(right),
    );
}
