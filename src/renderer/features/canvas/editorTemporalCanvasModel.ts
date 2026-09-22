import {
  evaluateLayerMotionAtTime,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotMouth,
  resolveLayerImageAsset,
  type EditorStageRenderModel,
  type EvaluatedLayer,
  type EvaluatedShot,
  type Point,
  type Project,
  type Shot,
} from '../../../domain';
import {
  resolveEditorTemporalAssetResolution,
  type EditorTemporalVisual,
  type EditorTemporalVisualStatus,
} from './temporalVisualContinuity';

export interface EditorTemporalCanvasModelInput {
  project: Project;
  shot: Shot;
  currentTimeMs: number;
  activeDialogueId?: string | null;
  readyAssetIds: ReadonlySet<string>;
  /** Decoded source hashes keyed by Asset id; distinguishes replacement bytes. */
  readyAssetSourceKeys?: ReadonlyMap<string, string>;
  /** Assets whose read/decode has definitively failed; pending assets are absent. */
  missingAssetIds?: ReadonlySet<string>;
  previousVisuals: ReadonlyMap<string, EditorTemporalVisual>;
  /** Ephemeral main Position draft; never part of the formal Project. */
  positionDraft?: {
    readonly layerId: string;
    readonly position: Point;
  };
}

export interface EditorTemporalCanvasModel {
  evaluatedShot: EvaluatedShot;
  stageModel: EditorStageRenderModel;
  directEditingEnabled: boolean;
  temporalInspection: boolean;
  /** Visual-only Shake offset applied around a Position authoring draft. */
  positionAuthoringShakeOffset: Point | null;
  lastValidVisuals: ReadonlyMap<string, EditorTemporalVisual>;
  visualStatusByLayer: ReadonlyMap<string, EditorTemporalVisualStatus>;
  targetReadyLayerIds: ReadonlySet<string>;
}

/**
 * The editor's 0:00 view is deliberately a base-state view. This conversion
 * stays local to the editor seam so the value shown in Canvas is the same
 * Layer value that the Inspector and direct Canvas editing mutate. Preview
 * and Export continue to call the formal runtime evaluator independently.
 */
function buildBaseEditorShot(project: Project, shot: Shot): EvaluatedShot {
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EvaluatedLayer => {
      const asset = resolveLayerImageAsset(project, layer);
      return {
        id: layer.id,
        assetId: asset?.id ?? '',
        currentExpressionId:
          layer.source.kind === 'character'
            ? layer.source.expressionId
            : null,
        mouthOverrideAssetId: null,
        anchor: layer.anchor,
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        flipX: layer.flipX,
        rotationDeg: layer.rotationDeg,
        opacity: layer.opacity,
        visible: layer.visible,
        zIndex: layer.zIndex,
      };
    });

  return {
    shotId: shot.id,
    timeMs: 0,
    backgroundLayerId: shot.backgroundLayerId,
    layers,
  };
}

/**
 * Production Canvas seam for one Timeline time. It intentionally composes the
 * formal evaluator, the shared mouth projection, complete-visual continuity,
 * and the editor render model without creating another clock or evaluator.
 */
export function buildEditorTemporalCanvasModel({
  project,
  shot,
  currentTimeMs,
  activeDialogueId = null,
  readyAssetIds,
  readyAssetSourceKeys,
  missingAssetIds,
  previousVisuals,
  positionDraft,
}: EditorTemporalCanvasModelInput): EditorTemporalCanvasModel {
  const temporalInspection = currentTimeMs !== 0;
  const baseEditorShot = buildBaseEditorShot(project, shot);
  const evaluatedShot = temporalInspection
    ? projectShotMouth(
        project,
        shot,
        evaluateShotAtTime(shot, currentTimeMs, project),
        activeDialogueId,
      )
    : baseEditorShot;
  const resolved = temporalInspection
    ? resolveEditorTemporalAssetResolution(
        project,
        shot,
        evaluatedShot,
        readyAssetIds,
        previousVisuals,
        readyAssetSourceKeys,
        missingAssetIds,
      )
    : {
        // A temporal visual must not survive the transition back into Base
        // Edit View, even when the same layer remains selected.
        evaluatedShot: baseEditorShot,
        lastValidVisuals: new Map<string, EditorTemporalVisual>(),
        visualStatusByLayer: new Map<string, EditorTemporalVisualStatus>(),
        targetReadyLayerIds: new Set<string>(),
      };

  const positionAuthoringShakeOffset = positionDraft
    ? (() => {
        const layer = shot.layers.find(
          (candidate) => candidate.id === positionDraft.layerId,
        );
        if (
          !layer ||
          !Number.isFinite(positionDraft.position.x) ||
          !Number.isFinite(positionDraft.position.y)
        ) {
          return null;
        }
        return evaluateLayerMotionAtTime(
          layer,
          shot.timelineEvents,
          currentTimeMs,
        ).shakeOffset;
      })()
    : null;

  const renderedEvaluatedShot = positionDraft
    ? {
        ...resolved.evaluatedShot,
        layers: resolved.evaluatedShot.layers.map((evaluatedLayer) => {
          if (
            evaluatedLayer.id !== positionDraft.layerId ||
            !Number.isFinite(positionDraft.position.x) ||
            !Number.isFinite(positionDraft.position.y)
          ) {
            return evaluatedLayer;
          }
          if (!positionAuthoringShakeOffset) return evaluatedLayer;
          return {
            ...evaluatedLayer,
            // The draft is main Position. Keep runtime Shake in the preview
            // without baking it into the draft or the eventual Position key.
            x: positionDraft.position.x + positionAuthoringShakeOffset.x,
            y: positionDraft.position.y + positionAuthoringShakeOffset.y,
          };
        }),
      }
    : resolved.evaluatedShot;

  return {
    evaluatedShot: renderedEvaluatedShot,
    stageModel: buildEditorStageRenderModel(
      project,
      shot,
      renderedEvaluatedShot,
    ),
    directEditingEnabled: !temporalInspection,
    temporalInspection,
    positionAuthoringShakeOffset,
    lastValidVisuals: resolved.lastValidVisuals,
    visualStatusByLayer: resolved.visualStatusByLayer,
    targetReadyLayerIds: resolved.targetReadyLayerIds,
  };
}
