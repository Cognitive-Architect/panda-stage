export interface AssetMetadataBatchSnapshot {
  projectRoot: string;
  project: { id: string };
}

export interface AssetMetadataProjectIdentity {
  projectRoot: string;
  projectId: string;
}

export type AssetMetadataRefreshStatus = 'ready' | 'error' | 'stopped';

export interface AssetMetadataRefreshOutcome {
  status: AssetMetadataRefreshStatus;
  applied: boolean;
  message?: string;
}

export interface AssetMetadataBatchFailure {
  assetId: string;
  message: string;
}

export interface AssetMetadataBatchOutcome {
  readyCount: number;
  errorCount: number;
  stopped: boolean;
  failures: AssetMetadataBatchFailure[];
}

export interface AssetMetadataBatchOptions {
  getSnapshot: () => AssetMetadataBatchSnapshot | null;
  refresh: (
    assetId: string,
    expected: AssetMetadataProjectIdentity,
  ) => Promise<AssetMetadataRefreshOutcome>;
}

function identityOf(
  snapshot: AssetMetadataBatchSnapshot,
): AssetMetadataProjectIdentity {
  return { projectRoot: snapshot.projectRoot, projectId: snapshot.project.id };
}

function sameIdentity(
  snapshot: AssetMetadataBatchSnapshot | null,
  identity: AssetMetadataProjectIdentity,
): boolean {
  return Boolean(
    snapshot &&
      snapshot.projectRoot === identity.projectRoot &&
      snapshot.project.id === identity.projectId,
  );
}

/**
 * Runs imported-audio metadata refreshes serially and against one project
 * identity. Each next request observes the revision applied by the last one.
 */
export async function refreshImportedAudioMetadata(
  assetIds: readonly string[],
  options: AssetMetadataBatchOptions,
): Promise<AssetMetadataBatchOutcome> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return { readyCount: 0, errorCount: 0, stopped: false, failures: [] };
  }
  const initialSnapshot = options.getSnapshot();
  if (!initialSnapshot) {
    return { readyCount: 0, errorCount: 0, stopped: true, failures: [] };
  }
  const identity = identityOf(initialSnapshot);
  let readyCount = 0;
  let errorCount = 0;
  const failures: AssetMetadataBatchFailure[] = [];

  for (const assetId of uniqueAssetIds) {
    if (!sameIdentity(options.getSnapshot(), identity)) {
      return { readyCount, errorCount, stopped: true, failures };
    }
    const result = await options.refresh(assetId, identity);
    if (result.status === 'stopped') {
      return { readyCount, errorCount, stopped: true, failures };
    }
    if (result.status === 'ready' && result.applied) readyCount += 1;
    else {
      errorCount += 1;
      failures.push({
        assetId,
        message: result.message ?? '音频时长分析失败，可在素材详情中重试。',
      });
    }
  }
  return { readyCount, errorCount, stopped: false, failures };
}
