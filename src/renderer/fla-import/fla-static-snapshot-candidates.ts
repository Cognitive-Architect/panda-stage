import type { FlaRenderableTargetCatalogEntry } from '../../shared/fla-static-snapshot-api';

export type FlaStaticSnapshotCandidateStatus = 'checking' | 'supported' | 'unsupported' | 'blank';

export interface FlaStaticSnapshotCandidatePreview {
  status: FlaStaticSnapshotCandidateStatus;
  previewUrl?: string;
  sha256?: string;
  reason?: string;
}

export interface FlaStaticSnapshotCandidateGroup {
  key: string;
  entries: FlaRenderableTargetCatalogEntry[];
  duplicate: boolean;
  sourceCount: number;
  status: FlaStaticSnapshotCandidateStatus;
  sha256?: string;
}

export type FlaStaticSnapshotCandidatePreviews = Readonly<Record<string, FlaStaticSnapshotCandidatePreview>>;

export function flaStaticSnapshotCandidateKey(entry: FlaRenderableTargetCatalogEntry): string {
  return `${entry.target.renderTargetId}:${entry.target.selectedFrameIndex ?? 0}`;
}

export function flaStaticSnapshotCandidateLabel(entry: FlaRenderableTargetCatalogEntry): string {
  if (entry.target.kind === 'scene') return entry.target.userLabel;
  return `${entry.target.userLabel} · 第 ${(entry.target.selectedFrameIndex ?? 0) + 1} 帧`;
}

export function flaStaticSnapshotCandidateKindLabel(entry: FlaRenderableTargetCatalogEntry): string {
  switch (entry.target.kind) {
    case 'scene':
      return '主场景';
    case 'timeline':
      return '时间线';
    case 'graphic-symbol':
      return '图形元件';
    default:
      return '未分类目标';
  }
}

export function groupFlaStaticSnapshotCandidates(
  entries: readonly FlaRenderableTargetCatalogEntry[],
  previews: FlaStaticSnapshotCandidatePreviews,
  search = '',
): FlaStaticSnapshotCandidateGroup[] {
  const query = search.trim().toLocaleLowerCase();
  const allGroups = new Map<string, {
    entries: FlaRenderableTargetCatalogEntry[];
    status: FlaStaticSnapshotCandidateStatus;
    sha256?: string;
  }>();

  for (const entry of entries) {
    const key = flaStaticSnapshotCandidateKey(entry);
    const preview = previews[key];
    const status: FlaStaticSnapshotCandidateStatus = entry.isBlank
      ? 'blank'
      : preview?.status ?? (entry.previewSupported ? 'checking' : 'unsupported');
    const sha256 = status === 'supported' ? preview?.sha256 : undefined;
    const groupKey = sha256 ? `sha256:${sha256}` : `candidate:${key}`;
    const existing = allGroups.get(groupKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      allGroups.set(groupKey, {
        entries: [entry],
        status,
        ...(sha256 ? { sha256 } : {}),
      });
    }
  }

  const priority: Record<FlaStaticSnapshotCandidateStatus, number> = {
    supported: 0,
    checking: 1,
    unsupported: 2,
    blank: 3,
  };
  return [...allGroups.entries()]
    .map(([key, group]) => {
      const visibleEntries = group.entries.filter((entry) =>
        !query || flaStaticSnapshotCandidateLabel(entry).toLocaleLowerCase().includes(query),
      );
      return {
        key,
        entries: visibleEntries,
        duplicate: group.entries.length > 1,
        sourceCount: group.entries.length,
        status: group.status,
        ...(group.sha256 ? { sha256: group.sha256 } : {}),
      } satisfies FlaStaticSnapshotCandidateGroup;
    })
    .filter((group) => group.entries.length > 0)
    .sort((left, right) => priority[left.status] - priority[right.status] || left.key.localeCompare(right.key));
}
