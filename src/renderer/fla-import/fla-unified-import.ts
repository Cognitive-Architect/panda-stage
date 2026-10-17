import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import type { FlaWorkbenchCandidate, FlaWorkbenchCandidateKind } from './fla-workbench-candidates';

export type FlaUnifiedImportItemStatus = 'imported' | 'duplicate' | 'failed' | 'not-attempted';

export interface FlaUnifiedImportItem {
  key: string;
  kind: FlaWorkbenchCandidateKind;
  identityKey: string;
  label: string;
}

export interface FlaUnifiedImportResultItem extends FlaUnifiedImportItem {
  status: FlaUnifiedImportItemStatus;
  baseRevision?: number;
  savedRevision?: number;
  message?: string;
  importedAssetCount?: number;
  duplicateAssetCount?: number;
}

export interface FlaUnifiedRouteResult {
  items: readonly FlaUnifiedImportResultItem[];
  snapshot: EditorProjectSnapshot;
  warnings?: readonly string[];
  stopFollowingRoutes?: boolean;
  cancelled?: boolean;
}

export type FlaUnifiedImportRunner = (
  items: readonly FlaUnifiedImportItem[],
  snapshot: EditorProjectSnapshot,
  shouldCancel: () => boolean,
) => Promise<FlaUnifiedRouteResult>;

export interface FlaUnifiedImportReceipt {
  selectedCount: number;
  items: FlaUnifiedImportResultItem[];
  counts: {
    imported: number;
    duplicate: number;
    failed: number;
    notAttempted: number;
    importedAssets: number;
    duplicateAssets: number;
  };
  partial: boolean;
  cancelled: boolean;
  warnings: string[];
  snapshot: EditorProjectSnapshot;
}

export function flaUnifiedCandidateSelectionKey(candidate: FlaWorkbenchCandidate): string {
  const operationBinding = candidate.kind === 'sequence'
    ? candidate.preview.requestId ?? ''
    : candidate.kind === 'snapshot'
      ? candidate.preview.bindingKey
      : '';
  return JSON.stringify([candidate.kind, candidate.identityKey, operationBinding]);
}

export function describeFlaUnifiedCandidate(candidate: FlaWorkbenchCandidate): FlaUnifiedImportItem {
  return {
    key: flaUnifiedCandidateSelectionKey(candidate),
    kind: candidate.kind,
    identityKey: candidate.identityKey,
    label: candidate.displayLabel,
  };
}

export async function runFlaUnifiedImport(input: {
  items: readonly FlaUnifiedImportItem[];
  snapshot: EditorProjectSnapshot;
  runners: Partial<Record<FlaWorkbenchCandidateKind, FlaUnifiedImportRunner>>;
  shouldCancel: () => boolean;
}): Promise<FlaUnifiedImportReceipt> {
  const { items, runners, shouldCancel } = input;
  const resultsByKey = new Map<string, FlaUnifiedImportResultItem>();
  const warnings: string[] = [];
  const routeOrder = [...new Set(items.map((item) => item.kind))];
  let snapshot = input.snapshot;
  let stopFollowingRoutes = false;
  let cancelled = false;

  for (const kind of routeOrder) {
    const routeItems = items.filter((item) => item.kind === kind);
    if (routeItems.length === 0) continue;

    const cancellationRequested = shouldCancel();
    if (stopFollowingRoutes || cancellationRequested) {
      cancelled ||= cancellationRequested;
      for (const item of routeItems) {
        resultsByKey.set(item.key, {
          ...item,
          status: 'not-attempted',
          message: cancelled ? '已取消后续导入，此项未尝试。' : '前一项未能完成，后续项目未尝试。',
        });
      }
      continue;
    }

    const runner = runners[kind];
    if (!runner) {
      for (const item of routeItems) {
        resultsByKey.set(item.key, {
          ...item,
          status: 'failed',
          message: '当前候选没有可用的安全导入路由。',
        });
      }
      warnings.push(`${kind} 候选没有注册安全导入路由；已停止后续操作。`);
      stopFollowingRoutes = true;
      continue;
    }

    let routeResult: FlaUnifiedRouteResult;
    try {
      routeResult = await runner(routeItems, snapshot, shouldCancel);
    } catch (error) {
      const message = error instanceof Error
        ? `导入结果无法确认：${error.message}`
        : '导入结果无法确认；请检查素材库后再处理。';
      for (const item of routeItems) {
        resultsByKey.set(item.key, { ...item, status: 'failed', message });
      }
      warnings.push('导入路由异常结束；为避免重复写入，已停止后续项目。');
      stopFollowingRoutes = true;
      continue;
    }

    snapshot = routeResult.snapshot;
    warnings.push(...(routeResult.warnings ?? []));
    cancelled ||= routeResult.cancelled === true;
    const requestedKeys = new Set(routeItems.map((item) => item.key));
    for (const result of routeResult.items) {
      if (!requestedKeys.has(result.key)) {
        warnings.push('导入路由返回了不属于本次选择的结果；该结果未计入回执。');
        continue;
      }
      resultsByKey.set(result.key, result);
    }

    for (const item of routeItems) {
      if (resultsByKey.has(item.key)) continue;
      resultsByKey.set(item.key, {
        ...item,
        status: 'failed',
        message: '导入路由没有返回此项的结果；请检查素材库后再处理。',
      });
      warnings.push('至少一个已选择候选缺少结果回执；已停止后续项目。');
    }

    if (
      routeResult.stopFollowingRoutes ||
      routeResult.cancelled ||
      routeItems.some((item) => {
        const status = resultsByKey.get(item.key)?.status;
        return status === 'failed' || status === 'not-attempted';
      })
    ) {
      stopFollowingRoutes = true;
    }
  }

  const results = items.map((item) => resultsByKey.get(item.key) ?? {
    ...item,
    status: 'not-attempted' as const,
    message: '前一项未能完成，后续项目未尝试。',
  });
  const counts = {
    imported: results.filter((item) => item.status === 'imported').length,
    duplicate: results.filter((item) => item.status === 'duplicate').length,
    failed: results.filter((item) => item.status === 'failed').length,
    notAttempted: results.filter((item) => item.status === 'not-attempted').length,
    importedAssets: results.reduce((total, item) => total + (item.importedAssetCount ?? (item.status === 'imported' ? 1 : 0)), 0),
    duplicateAssets: results.reduce((total, item) => total + (item.duplicateAssetCount ?? (item.status === 'duplicate' ? 1 : 0)), 0),
  };
  const partial = counts.failed > 0 || counts.notAttempted > 0 || warnings.length > 0;

  return {
    selectedCount: items.length,
    items: results,
    counts,
    partial,
    cancelled,
    warnings,
    snapshot,
  };
}
