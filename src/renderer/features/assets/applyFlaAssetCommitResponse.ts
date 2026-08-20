import type {
  FlaAssetCommitResponse,
  FlaAssetCommitResult,
} from '../../../shared/fla-asset-commit-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface FlaAssetCommitUiOutcome {
  status: string;
  results: FlaAssetCommitResult[] | null;
  applied: boolean;
}

export function applyFlaAssetCommitResponse(
  response: FlaAssetCommitResponse,
  store: EditorProjectStore,
): FlaAssetCommitUiOutcome {
  if (!response.ok) {
    return {
      status: response.error.message,
      results: null,
      applied: false,
    };
  }
  if (response.status === 'cancelled') {
    return {
      status: '已取消 FLA 素材导入，项目没有发生变化。',
      results: null,
      applied: false,
    };
  }
  if (!response.projectChanged) {
    return {
      status: `导入完成：${response.summary.selectedCount} 项；已复用重复素材：${response.summary.duplicateCount} 项。`,
      results: response.results,
      applied: false,
    };
  }

  const importedAssets = response.results
    .filter((result) => result.status === 'imported')
    .map((result) => result.asset);
  const acknowledgement = store.applyAssetImport(
    response.project,
    importedAssets,
    response.baseRevision,
    response.savedRevision,
  );
  return {
    status:
      acknowledgement === 'current'
        ? `导入完成：${response.summary.importedCount} 项；已复用重复素材：${response.summary.duplicateCount} 项；冲突重命名：${response.summary.renamedCount} 项。`
        : `导入已保存，但期间存在新的编辑；已保留新编辑并加入 ${response.summary.importedCount} 项素材。`,
    results: response.results,
    applied: true,
  };
}
