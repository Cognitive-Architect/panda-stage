import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotMouth,
  resolveLayerImageAsset,
  type EditorStageRenderModel,
  type EvaluatedLayer,
  type EvaluatedShot,
  type Project,
  type Shot,
} from '../../../domain';
import {
  resolveEditorTemporalAssetResolution,
  type EditorTemporalVisual,
} from './temporalVisualContinuity';

export interface EditorTemporalCanvasModelInput {
  project: Project;
  shot: Shot;
  currentTimeMs: number;
  activeDialogueId?: string | null;
  readyAssetIds: ReadonlySet<string>;
  previousVisuals: ReadonlyMap<string, EditorTemporalVisual>;
}

export interface EditorTemporalCanvasModel {
  evaluatedShot: EvaluatedShot;
  stageModel: EditorStageRenderModel;
  directEditingEnabled: boolean;
  temporalInspection: boolean;
  lastValidVisuals: ReadonlyMap<string, EditorTemporalVisual>;
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
  previousVisuals,
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
      )
    : {
        // A temporal visual must not survive the transition back into Base
        // Edit View, even when the same layer remains selected.
        evaluatedShot: baseEditorShot,
        lastValidVisuals: new Map<string, EditorTemporalVisual>(),
      };

  return {
    evaluatedShot: resolved.evaluatedShot,
    stageModel: buildEditorStageRenderModel(
      project,
      shot,
      resolved.evaluatedShot,
    ),
    directEditingEnabled: !temporalInspection,
    temporalInspection,
    lastValidVisuals: resolved.lastValidVisuals,
  };
}
