import type {
  EvaluatedLayer,
  EvaluatedShot,
} from '../../../domain';
import type { LayerVisualParts } from '../../../domain';
import type { Project, Shot } from '../../../domain/models';
import {
  resolveImageAsset,
  resolveLayerVisualParts,
} from '../../../domain';
import { canvasImageResourceKey } from './canvasImageResources';

/**
 * One complete runtime visual snapshot for one logical editor Layer.
 *
 * The EvaluatedLayer fields keep the existing transform/visibility contract
 * readable to the Canvas. `visual` and `assetSourceKeys` are the important
 * continuity payload: a previous Character is reproduced from its own Body /
 * Face parts and decoded resource versions, not re-resolved from a replacement
 * Character definition.
 */
export type EditorTemporalVisual = EvaluatedLayer & {
  visual?: LayerVisualParts;
  assetSourceKeys?: ReadonlyMap<string, string>;
};

export type EditorTemporalVisualStatus =
  | 'current-complete'
  | 'mouth-expression-fallback'
  | 'mouth-fallback-pending'
  | 'previous-complete'
  | 'required-failed'
  | 'pending'
  | 'unavailable';

export interface EditorTemporalAssetResolution {
  evaluatedShot: EvaluatedShot;
  lastValidVisuals: ReadonlyMap<string, EditorTemporalVisual>;
  /** The exact complete visual selected for each logical Layer. */
  visualsByLayer: ReadonlyMap<string, LayerVisualParts | null>;
  /** Resource versions used by the selected visual for each logical Layer. */
  visualSourceKeysByLayer: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >;
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
  return visual.parts.map((part) =>
    part.slot === 'face' || part.slot === 'single'
      ? evaluated.assetId || part.assetId
      : part.assetId,
  );
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

function isRetainedVisualReady(
  project: Project,
  snapshot: EditorTemporalVisual,
  readyAssetIds: ReadonlySet<string>,
  readyAssetSourceKeys: ReadonlyMap<string, string> | undefined,
  readyResourceKeys: ReadonlySet<string> | undefined,
): boolean {
  if (!snapshot.visual || snapshot.visual.parts.length === 0) return false;
  return visualAssetIds(snapshot.visual, snapshot).every((assetId) => {
    const sourceKey = snapshot.assetSourceKeys?.get(assetId);
    if (sourceKey && readyResourceKeys) {
      return readyResourceKeys.has(canvasImageResourceKey(assetId, sourceKey));
    }
    return isAssetReady(project, assetId, readyAssetIds, readyAssetSourceKeys);
  });
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
    // Canvas missing state. They must not produce a half visual.
    return null;
  }
}

function sourceKeysForVisual(
  project: Project,
  visual: LayerVisualParts,
  evaluated: EvaluatedLayer,
  readyAssetSourceKeys?: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const sourceKeys = new Map<string, string>();
  for (const assetId of visualAssetIds(visual, evaluated)) {
    const sourceKey =
      readyAssetSourceKeys?.get(assetId) ??
      resolveImageAsset(project, assetId)?.sha256;
    if (sourceKey) sourceKeys.set(assetId, sourceKey);
  }
  return sourceKeys;
}

function snapshotVisual(
  project: Project,
  evaluated: EvaluatedLayer,
  visual: LayerVisualParts,
  readyAssetSourceKeys?: ReadonlyMap<string, string>,
): EditorTemporalVisual {
  return {
    ...evaluated,
    visual,
    assetSourceKeys: sourceKeysForVisual(
      project,
      visual,
      evaluated,
      readyAssetSourceKeys,
    ),
  };
}

function normalizePreviousVisual(
  project: Project,
  shot: Shot,
  previous: EditorTemporalVisual,
): EditorTemporalVisual | null {
  const visual = previous.visual ?? resolveVisual(project, shot, previous);
  if (!visual) return null;
  return previous.visual && previous.assetSourceKeys
    ? previous
    : snapshotVisual(project, previous, visual, previous.assetSourceKeys);
}

function evaluatedLayerOf(snapshot: EditorTemporalVisual): EvaluatedLayer {
  const evaluated = { ...snapshot };
  delete evaluated.visual;
  delete evaluated.assetSourceKeys;
  return evaluated;
}

function hasRequiredHardFailure(
  visual: LayerVisualParts | null,
  missingAssetIds: ReadonlySet<string>,
): boolean {
  if (!visual) return true;
  const activeMouthId =
    visual.activeFace?.source === 'mouth'
      ? visual.activeFace.assetId
      : null;
  return visual.resources.required.some(
    ({ assetId }) =>
      missingAssetIds.has(assetId) && assetId !== activeMouthId,
  );
}

function hasMouthHardFailure(
  visual: LayerVisualParts | null,
  missingAssetIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    visual?.activeFace?.source === 'mouth' &&
      missingAssetIds.has(visual.activeFace.assetId),
  );
}

function mouthExpressionFallback(
  evaluated: EvaluatedLayer,
  visual: LayerVisualParts | null,
  missingAssetIds?: ReadonlySet<string>,
): EvaluatedLayer | null {
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
  missingAssetIds: ReadonlySet<string> = new Set(),
  readyResourceKeys?: ReadonlySet<string>,
): EditorTemporalAssetResolution {
  const lastValidVisuals = new Map<string, EditorTemporalVisual>();
  const visualsByLayer = new Map<string, LayerVisualParts | null>();
  const visualSourceKeysByLayer = new Map<
    string,
    ReadonlyMap<string, string>
  >();
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
    if (currentReady && currentVisual) {
      const currentSnapshot = snapshotVisual(
        project,
        layer,
        currentVisual,
        readyAssetSourceKeys,
      );
      targetReadyLayerIds.add(layer.id);
      visualStatusByLayer.set(layer.id, 'current-complete');
      lastValidVisuals.set(layer.id, currentSnapshot);
      visualsByLayer.set(layer.id, currentSnapshot.visual!);
      visualSourceKeysByLayer.set(layer.id, currentSnapshot.assetSourceKeys!);
      return layer;
    }

    const fallbackLayer = mouthExpressionFallback(
      layer,
      currentVisual,
      missingAssetIds,
    );
    if (fallbackLayer) {
      const fallbackVisual = resolveVisual(project, shot, fallbackLayer);
      if (
        fallbackVisual &&
        isCompleteVisualReady(
          project,
          fallbackVisual,
          fallbackLayer,
          readyAssetIds,
          readyAssetSourceKeys,
        )
      ) {
        const fallbackSnapshot = snapshotVisual(
          project,
          fallbackLayer,
          fallbackVisual,
          readyAssetSourceKeys,
        );
        visualStatusByLayer.set(layer.id, 'mouth-expression-fallback');
        lastValidVisuals.set(layer.id, fallbackSnapshot);
        visualsByLayer.set(layer.id, fallbackSnapshot.visual!);
        visualSourceKeysByLayer.set(
          layer.id,
          fallbackSnapshot.assetSourceKeys!,
        );
        return fallbackLayer;
      }
    }

    const requiredFailed = hasRequiredHardFailure(
      currentVisual,
      missingAssetIds,
    );
    const mouthFailed = hasMouthHardFailure(currentVisual, missingAssetIds);
    const previousInput = previousVisuals.get(layer.id);
    const previousVisual = previousInput
      ? normalizePreviousVisual(project, shot, previousInput)
      : null;
    if (
      !mouthFailed &&
      previousVisual &&
      isRetainedVisualReady(
        project,
        previousVisual,
        readyAssetIds,
        readyAssetSourceKeys,
        readyResourceKeys,
      )
    ) {
      visualStatusByLayer.set(
        layer.id,
        requiredFailed
          ? 'required-failed'
          : mouthFailed
            ? 'mouth-fallback-pending'
            : 'previous-complete',
      );
      lastValidVisuals.set(layer.id, previousVisual);
      visualsByLayer.set(layer.id, previousVisual.visual!);
      visualSourceKeysByLayer.set(
        layer.id,
        previousVisual.assetSourceKeys ?? new Map(),
      );
      return evaluatedLayerOf(previousVisual);
    }

    visualStatusByLayer.set(
      layer.id,
      requiredFailed
        ? 'required-failed'
        : mouthFailed
          ? 'mouth-fallback-pending'
          : 'pending',
    );
    // A null override tells the stage model to keep the logical layer but draw
    // no Body/Face part. This is the explicit loading/missing seam; it cannot
    // accidentally render a newly-ready half Character.
    visualsByLayer.set(layer.id, null);
    return layer;
  });

  return {
    evaluatedShot: { ...evaluatedShot, layers },
    lastValidVisuals,
    visualsByLayer,
    visualSourceKeysByLayer,
    visualStatusByLayer,
    targetReadyLayerIds,
  };
}
