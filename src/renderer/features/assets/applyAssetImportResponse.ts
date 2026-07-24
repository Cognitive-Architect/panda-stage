import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../../shared/asset-import-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface AssetImportUiOutcome {
  status: string;
  results: AssetImportResult[] | null;
}

export function applyAssetImportResponse(
  response: AssetImportResponse,
  store: EditorProjectStore,
): AssetImportUiOutcome {
  if (!response.ok) {
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
    return {
      status:
        acknowledgement === 'current'
          ? '素材已复制并保存到项目。'
          : '素材已保存；导入期间的新编辑仍保持未保存状态。',
      results: response.results,
    };
  }
  return {
    status: response.results.some(
      (result) => result.status === 'duplicate',
    )
      ? '没有复制重复素材；已保留并复用原素材记录。'
      : '没有素材被导入，项目未发生变化。',
    results: response.results,
  };
}
