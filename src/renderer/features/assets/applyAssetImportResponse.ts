import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../../shared/asset-import-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface AssetImportUiOutcome {
  status: string;
  results: AssetImportResult[] | null;
}

/**
 * Keep the primary import acknowledgement short while retaining a clear
 * follow-up whenever a batch also contains reused or unsuccessful entries.
 */
export function formatAssetImportStatus(
  results: readonly AssetImportResult[],
): string {
  const importedCount = results.filter(
    (result) => result.status === 'imported',
  ).length;
  const duplicateCount = results.filter(
    (result) => result.status === 'duplicate',
  ).length;
  const unsuccessfulCount = results.filter(
    (result) => result.status === 'rejected' || result.status === 'failed',
  ).length;

  if (importedCount === 1 && results.length === 1) {
    return `已导入：${results.find((result) => result.status === 'imported')!.sourceName}`;
  }
  if (
    importedCount > 0 &&
    duplicateCount === 0 &&
    unsuccessfulCount === 0
  ) {
    return `已导入 ${importedCount} 个素材`;
  }

  const facts: string[] = [];
  if (importedCount > 0) facts.push(`已导入 ${importedCount} 个素材`);
  if (duplicateCount > 0) facts.push(`已复用 ${duplicateCount} 个已有素材`);
  if (unsuccessfulCount > 0) {
    facts.push(`另有 ${unsuccessfulCount} 个素材未导入，请查看下方详情`);
  }
  return facts.length > 0
    ? `${facts.join('；')}。`
    : '没有素材被导入，项目未发生变化。';
}

export function applyAssetImportResponse(
  response: AssetImportResponse,
  store: EditorProjectStore,
): AssetImportUiOutcome {
  if (!response.ok) {
    if (response.error.code === 'ASSET_IMPORT_ROLLBACK_FAILED') {
      const residualPaths = response.error.residualPaths ?? [];
      return {
        status:
          residualPaths.length > 0
            ? `导入清理未完成，请手动清理残留文件：${residualPaths.join('；')}`
            : `导入清理未完成。${response.error.message}`,
        results: null,
      };
    }
    return {
      status: response.error.message,
      results: null,
    };
  }
  if (response.status === 'cancelled') {
    return {
      status: '已取消素材导入，项目未发生变化。',
      results: null,
    };
  }
  if (response.projectChanged) {
    const importedAssets = response.results.flatMap((result) =>
      result.status === 'imported' && result.asset
        ? [result.asset]
        : [],
    );
    const acknowledgement = store.applyAssetImport(
      response.project,
      importedAssets,
      response.baseRevision,
      response.savedRevision,
    );
    const importStatus = formatAssetImportStatus(response.results);
    return {
      status:
        acknowledgement === 'current'
          ? importStatus
          : `${importStatus}；导入期间的新编辑仍保持未保存状态。`,
      results: response.results,
    };
  }
  return {
    status: formatAssetImportStatus(response.results),
    results: response.results,
  };
}
