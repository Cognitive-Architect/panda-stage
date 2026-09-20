import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotMouth,
  type EditorStageRenderModel,
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
  const evaluatedShot = projectShotMouth(
    project,
    shot,
    evaluateShotAtTime(shot, currentTimeMs, project),
    activeDialogueId,
  );
  const resolved = resolveEditorTemporalAssetResolution(
    project,
    shot,
    evaluatedShot,
    readyAssetIds,
    previousVisuals,
  );

  return {
    evaluatedShot: resolved.evaluatedShot,
    stageModel: buildEditorStageRenderModel(
      project,
      shot,
      resolved.evaluatedShot,
    ),
    directEditingEnabled: currentTimeMs === 0,
    temporalInspection: currentTimeMs !== 0,
    lastValidVisuals: resolved.lastValidVisuals,
  };
}
