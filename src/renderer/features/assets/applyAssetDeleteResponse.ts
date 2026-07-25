import type { AssetDeleteResponse } from '../../../shared/asset-delete-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface AssetDeleteUiOutcome {
  applied: boolean;
  status: string;
  references: readonly { label: string; path: string }[];
}

export function applyAssetDeleteResponse(
  response: AssetDeleteResponse,
  store: EditorProjectStore,
): AssetDeleteUiOutcome {
  if (!response.ok) {
    return {
      applied: false,
      status: response.error.message,
      references: response.error.references ?? [],
    };
  }
  const acknowledgement = store.applyAssetDelete(
    response.project,
    response.deletedAssetId,
    response.baseRevision,
    response.savedRevision,
  );
  return {
    applied: true,
    status:
      response.cleanupResidualPaths.length > 0
        ? `素材已从项目中删除，但有待清理文件：${response.cleanupResidualPaths.join('；')}`
        : acknowledgement === 'current'
          ? '素材文件、缩略图缓存和项目记录已同步删除。'
          : '素材已删除；删除期间产生的新编辑仍保持未保存状态。',
    references: [],
  };
}
