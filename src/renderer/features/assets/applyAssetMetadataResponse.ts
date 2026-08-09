import type { AssetMetadataResponse } from '../../../shared/asset-metadata-api';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export interface AssetMetadataUiOutcome {
  status: string;
  applied: boolean;
}

export function applyAssetMetadataResponse(
  response: AssetMetadataResponse,
  store: EditorProjectStore,
): AssetMetadataUiOutcome {
  if (!response.ok) {
    return { status: response.error.message, applied: false };
  }
  if (response.result.status === 'error') {
    return { status: response.result.error.message, applied: false };
  }
  const acknowledgement = store.applyAssetMetadata(
    response.project,
    response.result.asset,
    response.baseRevision,
    response.savedRevision,
  );
  return {
    status:
      acknowledgement === 'current'
        ? 'Asset metadata refreshed.'
        : 'Asset metadata refreshed; newer edits remain unsaved.',
    applied: true,
  };
}
