import type { FlaStaticSnapshotCommitResponse } from '../../../shared/fla-static-snapshot-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface FlaStaticSnapshotCommitUiOutcome {
  status: string;
  applied: boolean;
}

/**
 * Applies a successful V2-R1 static-snapshot commit to the editor store so
 * the imported ImageAsset shows up in the asset library. Mirrors
 * applyFlaAssetCommitResponse but consumes the R1 commit contract
 * (FlaStaticSnapshotCommitResponse), which carries exactly one asset.
 */
export function applyFlaStaticSnapshotCommitResponse(
  response: FlaStaticSnapshotCommitResponse,
  store: EditorProjectStore,
): FlaStaticSnapshotCommitUiOutcome {
  if (!response.ok) {
    return { status: response.error.message, applied: false };
  }
  if (!response.projectChanged) {
    return {
      status: `已复用重复素材：${response.result.targetFileName}。`,
      applied: false,
    };
  }
  const importedAssets =
    response.result.status === 'imported' ? [response.result.asset] : [];
  const acknowledgement = store.applyAssetImport(
    response.project,
    importedAssets,
    response.baseRevision,
    response.savedRevision,
  );
  return {
    status:
      acknowledgement === 'current'
        ? `已导入静态快照：${response.result.targetFileName}。`
        : `快照已保存，但期间存在新的编辑；已保留新编辑并加入 ${response.result.targetFileName}。`,
    applied: true,
  };
}
