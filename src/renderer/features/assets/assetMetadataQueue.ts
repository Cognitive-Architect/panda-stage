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
}

export interface AssetMetadataBatchOutcome {
  readyCount: number;
  errorCount: number;
  stopped: boolean;
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
  return {
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
  };
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
 * Runs imported-audio metadata refreshes in deterministic order. Each item
 * starts only after the previous response has been applied, so the next
 * request observes the latest renderer revision.
 */
export async function refreshImportedAudioMetadata(
  assetIds: readonly string[],
  options: AssetMetadataBatchOptions,
): Promise<AssetMetadataBatchOutcome> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return { readyCount: 0, errorCount: 0, stopped: false };
  }

  const initialSnapshot = options.getSnapshot();
  if (!initialSnapshot) {
    return { readyCount: 0, errorCount: 0, stopped: true };
  }
  const identity = identityOf(initialSnapshot);
  let readyCount = 0;
  let errorCount = 0;

  for (const assetId of uniqueAssetIds) {
    if (!sameIdentity(options.getSnapshot(), identity)) {
      return { readyCount, errorCount, stopped: true };
    }
    const result = await options.refresh(assetId, identity);
    if (result.status === 'stopped') {
      return { readyCount, errorCount, stopped: true };
    }
    if (result.status === 'ready' && result.applied) {
      readyCount += 1;
    } else {
      errorCount += 1;
    }
  }

  return { readyCount, errorCount, stopped: false };
}
