import type { EvaluatedShot } from '../../../domain';
import type { Project, Shot } from '../../../domain/models';
import { resolveLayerImageAsset } from '../../../domain/selectors/canvasLayers';

export interface EditorTemporalAssetResolution {
  evaluatedShot: EvaluatedShot;
  lastValidAssetIds: ReadonlyMap<string, string>;
}

/**
 * Keeps the last drawable image for each editor layer while a temporal asset
 * replacement is still decoding. The evaluated pose remains current; only the
 * image source is held until the requested source is ready.
 */
export function resolveEditorTemporalAssetResolution(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  readyAssetIds: ReadonlySet<string>,
  previousAssetIds: ReadonlyMap<string, string>,
): EditorTemporalAssetResolution {
  const lastValidAssetIds = new Map<string, string>();
  const layers = evaluatedShot.layers.map((layer) => {
    const baseAsset = shot.layers.find(
      (candidate) => candidate.id === layer.id,
    );
    const baseAssetId = baseAsset
      ? resolveLayerImageAsset(project, baseAsset)?.id
      : undefined;
    const previousAssetId = previousAssetIds.get(layer.id);
    const displayAssetId = [
      layer.assetId,
      previousAssetId,
      baseAssetId,
    ].find((assetId) => assetId && readyAssetIds.has(assetId));
    const effectiveAssetId =
      displayAssetId ?? (layer.assetId || baseAssetId || '');

    if (readyAssetIds.has(effectiveAssetId)) {
      lastValidAssetIds.set(layer.id, effectiveAssetId);
    }
    return effectiveAssetId === layer.assetId
      ? layer
      : { ...layer, assetId: effectiveAssetId };
  });

  return {
    evaluatedShot: { ...evaluatedShot, layers },
    lastValidAssetIds,
  };
}
