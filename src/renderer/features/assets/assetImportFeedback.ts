import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../../shared/asset-import-api';

export const ASSET_IMPORT_FEEDBACK_DISMISS_MS = 4_000;

export type AssetImportFeedbackKind =
  | 'progress'
  | 'success'
  | 'info'
  | 'warning'
  | 'error';

export interface AssetImportFeedbackDetail {
  sourceName: string;
  message: string;
}

export interface AssetImportFeedback {
  kind: AssetImportFeedbackKind;
  summary: string;
  details: AssetImportFeedbackDetail[];
  dismissAfterMs: number | null;
}

export function createAssetImportProgressFeedback(): AssetImportFeedback {
  return {
    kind: 'progress',
    summary: '正在导入素材…',
    details: [],
    dismissAfterMs: null,
  };
}

export function createAssetImportFeedback(
  response: AssetImportResponse,
  operationError: string,
  audioFailures: readonly AssetImportFeedbackDetail[] = [],
): AssetImportFeedback | null {
  if (response.ok && response.status === 'cancelled') return null;
  if (!response.ok) {
    return {
      kind: 'error',
      summary: operationError,
      details: [{ sourceName: '导入操作', message: operationError }],
      dismissAfterMs: null,
    };
  }

  const imported = response.results.filter(
    (result) => result.status === 'imported',
  );
  const duplicated = response.results.filter(
    (result) => result.status === 'duplicate',
  );
  const rejected = response.results.filter(
    (result) => result.status === 'rejected' || result.status === 'failed',
  );
  const failures = [
    ...rejected.map((result) => ({
      sourceName: result.sourceName,
      message: result.message,
    })),
    ...audioFailures,
  ];

  if (failures.length > 0) {
    const facts: string[] = [];
    if (imported.length > 0) facts.push(`已导入 ${imported.length} 个`);
    if (duplicated.length > 0) facts.push(`复用 ${duplicated.length} 个已有素材`);
    if (rejected.length > 0) facts.push(`${rejected.length} 个未能导入`);
    if (audioFailures.length > 0) {
      facts.push(`${audioFailures.length} 个音频时长分析失败`);
    }
    return {
      kind: imported.length > 0 || duplicated.length > 0 ? 'warning' : 'error',
      summary: `${facts.join('，')} · 查看详情`,
      details: failures,
      dismissAfterMs: null,
    };
  }

  if (imported.length === 0 && duplicated.length > 0) {
    return {
      kind: 'info',
      summary: `${duplicated.length} 个素材已存在，无需重复导入`,
      details: [],
      dismissAfterMs: ASSET_IMPORT_FEEDBACK_DISMISS_MS,
    };
  }

  const summary =
    imported.length === 1 && response.results.length === 1
      ? `已导入：${imported[0]!.sourceName}`
      : duplicated.length > 0
        ? `已导入 ${imported.length} 个素材，复用 ${duplicated.length} 个已有素材`
        : `已导入 ${imported.length} 个素材`;
  return {
    kind: 'success',
    summary,
    details: [],
    dismissAfterMs: ASSET_IMPORT_FEEDBACK_DISMISS_MS,
  };
}

export function importedAudioFeedbackDetails(
  results: readonly AssetImportResult[],
  failures: readonly { assetId: string; message: string }[],
): AssetImportFeedbackDetail[] {
  const sourceNameByAssetId = new Map(
    results.flatMap((result) =>
      result.status === 'imported' && result.asset
        ? [[result.asset.id, result.sourceName] as const]
        : [],
    ),
  );
  return failures.map((failure) => ({
    sourceName: sourceNameByAssetId.get(failure.assetId) ?? '音频素材',
    message: failure.message,
  }));
}
