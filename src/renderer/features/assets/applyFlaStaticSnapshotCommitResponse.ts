import type { FlaStaticSnapshotCommitResponse } from '../../../shared/fla-static-snapshot-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface FlaStaticSnapshotCommitUiOutcome {
  status: string;
  applied: boolean;
}

type CompletedFlaStaticSnapshotCommitResponse = Extract<
  FlaStaticSnapshotCommitResponse,
  { ok: true; status: 'completed' }
>;

export function formatFlaStaticSnapshotCommitStatus(
  response: CompletedFlaStaticSnapshotCommitResponse,
): string {
  const { result } = response;
  if (result.status === 'duplicate') {
    return `已复用已有素材：${result.targetFileName}。没有创建重复文件。`;
  }
  return `当前帧已导入：${result.targetFileName}${result.renamed ? '（已自动避免重名）' : ''}。`;
}

/**
 * Applies a successful V2-R1 static-snapshot commit to the editor store so
 * the imported ImageAsset shows up in the asset library. This adapter only
 * acknowledges Main's authoritative transaction; it does not own commit
 * eligibility or Project revision reconciliation.
 */
export function applyFlaStaticSnapshotCommitResponse(
  response: FlaStaticSnapshotCommitResponse,
  store: EditorProjectStore,
): FlaStaticSnapshotCommitUiOutcome {
  if (!response.ok) {
    return { status: response.error.message, applied: false };
  }
  const status = formatFlaStaticSnapshotCommitStatus(response);
  if (!response.projectChanged) {
    return { status, applied: false };
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
        ? status
        : `导入已保存，但期间存在新的编辑；${status}`,
    applied: true,
  };
}
