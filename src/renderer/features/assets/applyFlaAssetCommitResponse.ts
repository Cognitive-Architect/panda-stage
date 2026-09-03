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

type CompletedFlaAssetCommitResponse = Extract<
  FlaAssetCommitResponse,
  { ok: true; status: 'completed' }
>;

export function formatFlaAssetCommitStatus(
  response: CompletedFlaAssetCommitResponse,
): string {
  const { selectedCount, importedCount, duplicateCount, renamedCount } = response.summary;
  const facts: string[] = [];
  if (importedCount > 0) facts.push(`新增 ${importedCount} 项`);
  if (duplicateCount > 0) facts.push(`复用已有素材 ${duplicateCount} 项`);
  if (renamedCount > 0) facts.push(`重命名 ${renamedCount} 项`);
  if (importedCount === 0 && duplicateCount > 0) {
    return `${selectedCount} 项均已存在于素材库，已复用已有素材，没有创建重复文件。`;
  }
  return `素材导入完成：${facts.join('，')}；共处理 ${selectedCount} 项。`;
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
  const status = formatFlaAssetCommitStatus(response);
  if (!response.projectChanged) {
    return {
      status,
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
        ? status
        : `导入已保存，但期间存在新的编辑；${status}`,
    results: response.results,
    applied: true,
  };
}
