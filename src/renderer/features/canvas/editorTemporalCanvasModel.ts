import {
  evaluateLayerMotionAtTime,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotMouth,
  resolveLayerImageAsset,
  type EditorStageRenderModel,
  type EvaluatedLayer,
  type EvaluatedShot,
  type LayerVisualParts,
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
  /** All decoded current and retained source versions. */
  readyResourceKeys?: ReadonlySet<string>;
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
  visualsByLayer: ReadonlyMap<string, LayerVisualParts | null>;
  visualSourceKeysByLayer: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >;
  visualStatusByLayer: ReadonlyMap<string, EditorTemporalVisualStatus>;
  targetReadyLayerIds: ReadonlySet<string>;
}

/**
 * The editor's 0:00 transform view uses base Layer values so Canvas and
 * Inspector edits agree. Authored Expression events at 0:00 are projected
 * separately; Preview and Export use the formal runtime evaluator.
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
  readyResourceKeys,
  missingAssetIds,
  previousVisuals,
  positionDraft,
}: EditorTemporalCanvasModelInput): EditorTemporalCanvasModel {
  const temporalInspection = currentTimeMs !== 0;
  const baseEditorShot = buildBaseEditorShot(project, shot);
  // Keep base transform editing at 0:00, while showing any formally authored
  // Expression switch that starts there. Only the Face state is projected;
  // Position, scale, opacity and the non-speaking base view stay unchanged.
  const zeroTimeExpressionShot = shot.timelineEvents.some(
    (event) => event.type === 'expression' && event.startMs === 0,
  )
    ? (() => {
        const formal = evaluateShotAtTime(shot, 0, project);
        return {
          ...baseEditorShot,
          layers: baseEditorShot.layers.map((layer) => {
            const source = shot.layers.find((candidate) => candidate.id === layer.id);
            const evaluated = formal.layers.find((candidate) => candidate.id === layer.id);
            return source?.source.kind === 'character' && evaluated
              ? {
                  ...layer,
                  assetId: evaluated.assetId,
                  currentExpressionId: evaluated.currentExpressionId,
                }
              : layer;
          }),
        };
      })()
    : baseEditorShot;
  const evaluatedShot = temporalInspection
    ? projectShotMouth(
        project,
        shot,
        evaluateShotAtTime(shot, currentTimeMs, project),
        activeDialogueId,
      )
    : zeroTimeExpressionShot;
  // Base Edit View owns 0:00 transforms and the continuity resolver owns image
  // transitions. At 0:00 we show authored Expression state without projecting
  // runtime Mouth/dialogue state, and retain the previous complete visual
  // until the new Face is ready.
  const resolved = resolveEditorTemporalAssetResolution(
    project,
    shot,
    evaluatedShot,
    readyAssetIds,
    previousVisuals,
    readyAssetSourceKeys,
    missingAssetIds,
    readyResourceKeys,
  );

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
      resolved.visualsByLayer,
    ),
    directEditingEnabled: !temporalInspection,
    temporalInspection,
    positionAuthoringShakeOffset,
    lastValidVisuals: resolved.lastValidVisuals,
    visualsByLayer: resolved.visualsByLayer,
    visualSourceKeysByLayer: resolved.visualSourceKeysByLayer,
    visualStatusByLayer: resolved.visualStatusByLayer,
    targetReadyLayerIds: resolved.targetReadyLayerIds,
  };
}
