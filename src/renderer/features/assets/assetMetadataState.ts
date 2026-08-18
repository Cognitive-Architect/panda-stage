import type { Asset } from '../../../domain';

export type AudioMetadataState = 'pending' | 'ready' | 'error';

export function audioMetadataState(
  asset: Asset,
  transientError?: string,
): AudioMetadataState | null {
  if (asset.kind !== 'audio') return null;
  if (transientError || asset.metadata?.status === 'error') {
    return 'error';
  }
  return asset.durationMs === undefined ? 'pending' : 'ready';
}

export function audioMetadataError(
  asset: Asset,
  transientError?: string,
): string | null {
  if (asset.kind !== 'audio') return null;
  if (transientError) return transientError;
  return asset.metadata?.status === 'error'
    ? asset.metadata.message
    : null;
}
