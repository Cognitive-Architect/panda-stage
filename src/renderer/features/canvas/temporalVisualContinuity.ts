import type {
  EvaluatedLayer,
  EvaluatedShot,
} from '../../../domain';
import type { Project, Shot } from '../../../domain/models';
import { resolveLayerImageAsset } from '../../../domain/selectors/canvasLayers';

/** One complete drawable visual snapshot for one editor layer. */
export type EditorTemporalVisual = EvaluatedLayer;

export interface EditorTemporalAssetResolution {
  evaluatedShot: EvaluatedShot;
  lastValidVisuals: ReadonlyMap<string, EditorTemporalVisual>;
}

/**
 * Keeps the last complete drawable visual for each editor layer while a
 * temporal asset replacement is still decoding. The affected layer's asset,
 * pose, opacity, flip, visibility, and ordering move together; unaffected
 * siblings continue to follow the current evaluated time.
 */
export function resolveEditorTemporalAssetResolution(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  readyAssetIds: ReadonlySet<string>,
  previousVisuals: ReadonlyMap<string, EditorTemporalVisual>,
): EditorTemporalAssetResolution {
  const lastValidVisuals = new Map<string, EditorTemporalVisual>();
  const layers = evaluatedShot.layers.map((layer) => {
    const baseLayer = shot.layers.find(
      (candidate) => candidate.id === layer.id,
    );
    const baseAsset = baseLayer
      ? resolveLayerImageAsset(project, baseLayer)
      : null;
    const baseVisual: EditorTemporalVisual | null = baseLayer && baseAsset
      ? {
          id: baseLayer.id,
          assetId: baseAsset.id,
          anchor: baseLayer.anchor,
          x: baseLayer.x,
          y: baseLayer.y,
          scaleX: baseLayer.scaleX,
          scaleY: baseLayer.scaleY,
          flipX: baseLayer.flipX,
          rotationDeg: baseLayer.rotationDeg,
          opacity: baseLayer.opacity,
          visible: baseLayer.visible,
          zIndex: baseLayer.zIndex,
        }
      : null;
    const previousVisual = previousVisuals.get(layer.id);
    const displayVisual = [
      layer,
      previousVisual,
      baseVisual,
    ].find(
      (candidate): candidate is EditorTemporalVisual =>
        Boolean(candidate?.assetId && readyAssetIds.has(candidate.assetId)),
    );
    const effectiveVisual = displayVisual ?? layer;

    if (readyAssetIds.has(effectiveVisual.assetId)) {
      lastValidVisuals.set(layer.id, effectiveVisual);
    }
    return effectiveVisual;
  });

  return {
    evaluatedShot: { ...evaluatedShot, layers },
    lastValidVisuals,
  };
}
