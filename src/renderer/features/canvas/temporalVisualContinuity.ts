import type {
  EvaluatedLayer,
  EvaluatedShot,
} from '../../../domain';
import type { Project, Shot } from '../../../domain/models';
import {
  resolveImageAsset,
  resolveLayerImageAsset,
  resolveLayerVisualParts,
  type LayerVisualParts,
} from '../../../domain';

/** One complete drawable visual snapshot for one editor layer. */
export type EditorTemporalVisual = EvaluatedLayer;

export type EditorTemporalVisualStatus =
  | 'current-complete'
  | 'mouth-expression-fallback'
  | 'previous-complete'
  | 'base-complete'
  | 'unavailable';

export interface EditorTemporalAssetResolution {
  evaluatedShot: EvaluatedShot;
  lastValidVisuals: ReadonlyMap<string, EditorTemporalVisual>;
  /** The status of the complete visual selected for each logical Layer. */
  visualStatusByLayer: ReadonlyMap<string, EditorTemporalVisualStatus>;
  /** Exact current evaluated visuals only; retained/fallback visuals are excluded. */
  targetReadyLayerIds: ReadonlySet<string>;
}

function isAssetReady(
  project: Project,
  assetId: string,
  readyAssetIds: ReadonlySet<string>,
  readyAssetSourceKeys?: ReadonlyMap<string, string>,
): boolean {
  if (!assetId || !readyAssetIds.has(assetId)) return false;
  const asset = resolveImageAsset(project, assetId);
  if (!asset) return false;
  // Tests and non-content-addressed fixtures use the id-only compatibility
  // set. A real Canvas image state also supplies sourceKeys, which makes a
  // replaced asset with the same id stay pending until its expected bytes
  // have decoded.
  if (!asset.sha256 || !readyAssetSourceKeys) return true;
  return readyAssetSourceKeys.get(assetId) === asset.sha256;
}

function visualAssetIds(
  visual: LayerVisualParts,
  evaluated: EvaluatedLayer,
): string[] {
  return visual.parts.map((part) => {
    // `assetId` is the formal evaluated face/ordinary image identity. Using
    // it for the face slot also keeps this seam compatible with older
    // evaluator snapshots while S03 remains the sole geometry resolver.
    if (part.slot === 'face' || part.slot === 'single') {
      return evaluated.assetId || part.assetId;
    }
    return part.assetId;
  });
}

function isCompleteVisualReady(
  project: Project,
  visual: LayerVisualParts | null,
  evaluated: EvaluatedLayer,
  readyAssetIds: ReadonlySet<string>,
  readyAssetSourceKeys?: ReadonlyMap<string, string>,
): boolean {
  if (!visual || visual.parts.length === 0) return false;
  return visualAssetIds(visual, evaluated).every((assetId) =>
    isAssetReady(project, assetId, readyAssetIds, readyAssetSourceKeys),
  );
}

function resolveVisual(
  project: Project,
  shot: Shot,
  evaluated: EvaluatedLayer,
): LayerVisualParts | null {
  try {
    return resolveLayerVisualParts(project, shot, evaluated);
  } catch {
    // Invalid/missing Project references are represented by the existing
    // Canvas loading/missing state. They must not produce a half visual.
    return null;
  }
}

function buildBaseVisual(
  project: Project,
  shot: Shot,
  layerId: string,
): EditorTemporalVisual | null {
  const baseLayer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!baseLayer) return null;
  const baseAsset = resolveLayerImageAsset(project, baseLayer);
  if (!baseAsset) return null;
  return {
    id: baseLayer.id,
    assetId: baseAsset.id,
    currentExpressionId:
      baseLayer.source.kind === 'character'
        ? baseLayer.source.expressionId
        : null,
    mouthOverrideAssetId: null,
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
  };
}

function mouthExpressionFallback(
  evaluated: EditorTemporalVisual,
  visual: LayerVisualParts | null,
  missingAssetIds?: ReadonlySet<string>,
): EditorTemporalVisual | null {
  const fallbackAssetId = visual?.activeFace?.fallbackAssetId;
  if (
    !fallbackAssetId ||
    visual?.activeFace?.source !== 'mouth' ||
    (missingAssetIds && !missingAssetIds.has(visual.activeFace.assetId))
  ) {
    return null;
  }
  return {
    ...evaluated,
    assetId: fallbackAssetId,
    mouthOverrideAssetId: null,
  };
}

/**
 * Keeps a complete visual for each logical editor Layer while a temporal
 * replacement is decoding. Body and Face are resolved and gated as one unit;
 * this function never chooses one newly-ready part beside an older part.
 */
export function resolveEditorTemporalAssetResolution(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  readyAssetIds: ReadonlySet<string>,
  previousVisuals: ReadonlyMap<string, EditorTemporalVisual>,
  readyAssetSourceKeys?: ReadonlyMap<string, string>,
  missingAssetIds?: ReadonlySet<string>,
): EditorTemporalAssetResolution {
  const lastValidVisuals = new Map<string, EditorTemporalVisual>();
  const visualStatusByLayer = new Map<
    string,
    EditorTemporalVisualStatus
  >();
  const targetReadyLayerIds = new Set<string>();

  const layers = evaluatedShot.layers.map((layer) => {
    const currentVisual = resolveVisual(project, shot, layer);
    const currentReady = isCompleteVisualReady(
      project,
      currentVisual,
      layer,
      readyAssetIds,
      readyAssetSourceKeys,
    );
    if (currentReady) {
      targetReadyLayerIds.add(layer.id);
      visualStatusByLayer.set(layer.id, 'current-complete');
      lastValidVisuals.set(layer.id, layer);
      return layer;
    }

    const fallback = mouthExpressionFallback(
      layer,
      currentVisual,
      missingAssetIds,
    );
    if (
      fallback &&
      isCompleteVisualReady(
        project,
        resolveVisual(project, shot, fallback),
        fallback,
        readyAssetIds,
        readyAssetSourceKeys,
      )
    ) {
      visualStatusByLayer.set(layer.id, 'mouth-expression-fallback');
      lastValidVisuals.set(layer.id, fallback);
      return fallback;
    }

    const previousVisual = previousVisuals.get(layer.id);
    if (
      previousVisual &&
      isCompleteVisualReady(
        project,
        resolveVisual(project, shot, previousVisual),
        previousVisual,
        readyAssetIds,
        readyAssetSourceKeys,
      )
    ) {
      visualStatusByLayer.set(layer.id, 'previous-complete');
      lastValidVisuals.set(layer.id, previousVisual);
      return previousVisual;
    }

    const baseVisual = buildBaseVisual(project, shot, layer.id);
    if (
      baseVisual &&
      isCompleteVisualReady(
        project,
        resolveVisual(project, shot, baseVisual),
        baseVisual,
        readyAssetIds,
        readyAssetSourceKeys,
      )
    ) {
      visualStatusByLayer.set(layer.id, 'base-complete');
      lastValidVisuals.set(layer.id, baseVisual);
      return baseVisual;
    }

    visualStatusByLayer.set(layer.id, 'unavailable');
    // The render model may still expose the current logical transform, but
    // Canvas receives no decoded complete visual and therefore shows no half
    // Character. This preserves the existing explicit missing/loading seam.
    return layer;
  });

  return {
    evaluatedShot: { ...evaluatedShot, layers },
    lastValidVisuals,
    visualStatusByLayer,
    targetReadyLayerIds,
  };
}
