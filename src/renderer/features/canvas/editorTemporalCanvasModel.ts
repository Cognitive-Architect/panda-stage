import {
  evaluateLayerMotionAtTime,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerImageAsset,
  type EditorStageRenderModel,
  type EvaluatedLayer,
  type EvaluatedShot,
  type LayerVisualParts,
  type MouthEnvelopeSource,
  type Point,
  type Project,
  type Shot,
} from '../../../domain';
import {
  resolveEditorTemporalAssetResolution,
  type EditorTemporalVisual,
  type EditorTemporalVisualStatus,
} from './temporalVisualContinuity';

/**
 * Runtime-only transform candidate for one Layer. Position is always present;
 * scale only applies to a preview that resizes, such as Equal Height.
 */
export interface CanvasTransformOverride {
  readonly x: number;
  readonly y: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

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
  /** Decoded volume envelopes for bound AudioClips; read-only, rebuildable. */
  mouthSource?: MouthEnvelopeSource;
  /** Ephemeral main Position draft; never part of the formal Project. */
  positionDraft?: {
    readonly layerId: string;
    readonly position: Point;
  };
  /**
   * Ephemeral transforms for a runtime-only preview such as Quick Layout or an
   * align/distribute candidate. Overrides apply to the rendered transform only;
   * nothing is persisted. A map keyed by Layer id keeps the seam open to any
   * number of objects while a preset may still supply only a position.
   */
  positionOverrides?: ReadonlyMap<string, CanvasTransformOverride>;
}

export interface EditorTemporalCanvasModel {
  evaluatedShot: EvaluatedShot;
  stageModel: EditorStageRenderModel;
  directEditingEnabled: boolean;
  temporalInspection: boolean;
  /**
   * Layers whose rendered position comes from a runtime-only preview. Direct
   * canvas editing stays off for them: the candidate stance is read-only, and
   * only the explicit Apply action may write the formal Project.
   */
  previewReadOnlyLayerIds: ReadonlySet<string>;
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

const NO_LAYER_IDS: ReadonlySet<string> = new Set<string>();

/** Shared empty set so a model without a preview never allocates one. */
export const NO_PREVIEW_LAYER_IDS: ReadonlySet<string> = NO_LAYER_IDS;

/**
 * Direct canvas editing for one Layer needs a writable stage and a Layer that
 * no runtime-only preview owns. A preview candidate is read-only until the
 * panel's explicit Apply writes the Project.
 */
export function canvasDirectEditingEnabled(input: {
  readonly stageEnabled: boolean;
  readonly previewReadOnlyLayerIds: ReadonlySet<string>;
  readonly layerId: string;
}): boolean {
  if (input.previewReadOnlyLayerIds.has(input.layerId)) return false;
  return input.stageEnabled;
}

/**
 * The editor's 0:00 transform view uses base Layer values so Canvas and
 * Inspector edits agree. Authored Expression events at 0:00 are projected
 * separately; Preview and Export use the formal runtime evaluator.
 */
function buildBaseEditorShot(project: Project, shot: Shot): EvaluatedShot {
  const evaluatedAtZero = new Map(
    evaluateShotAtTime(shot, 0, project).layers.map((layer) => [layer.id, layer]),
  );
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EvaluatedLayer => {
      const asset = resolveLayerImageAsset(project, layer);
      const animationAtZero =
        layer.source.kind === 'animation'
          ? evaluatedAtZero.get(layer.id)
          : undefined;
      return {
        id: layer.id,
        assetId: animationAtZero?.assetId ?? asset?.id ?? '',
        ...(evaluatedAtZero.get(layer.id)?.partPoses
          ? { partPoses: evaluatedAtZero.get(layer.id)!.partPoses }
          : {}),
        ...(animationAtZero?.animationFrame
          ? { animationFrame: animationAtZero.animationFrame }
          : {}),
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
        visible: animationAtZero?.visible ?? layer.visible,
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
  mouthSource,
  positionDraft,
  positionOverrides,
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
    ? projectShotDialogueVisual(
        project,
        shot,
        evaluateShotAtTime(shot, currentTimeMs, project),
        activeDialogueId,
        mouthSource,
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

  const overriddenEvaluatedShot =
    positionOverrides && positionOverrides.size > 0
      ? {
          ...renderedEvaluatedShot,
          layers: renderedEvaluatedShot.layers.map((evaluatedLayer) => {
            const override = positionOverrides.get(evaluatedLayer.id);
            if (
              !override ||
              !Number.isFinite(override.x) ||
              !Number.isFinite(override.y)
            ) {
              return evaluatedLayer;
            }
            const next: EvaluatedLayer = {
              ...evaluatedLayer,
              x: override.x,
              y: override.y,
            };
            if (override.scaleX === undefined && override.scaleY === undefined) {
              return next;
            }
            return {
              ...next,
              scaleX:
                override.scaleX !== undefined && Number.isFinite(override.scaleX)
                  ? override.scaleX
                  : evaluatedLayer.scaleX,
              scaleY:
                override.scaleY !== undefined && Number.isFinite(override.scaleY)
                  ? override.scaleY
                  : evaluatedLayer.scaleY,
            };
          }),
        }
      : renderedEvaluatedShot;

  return {
    evaluatedShot: overriddenEvaluatedShot,
    stageModel: buildEditorStageRenderModel(
      project,
      shot,
      overriddenEvaluatedShot,
      resolved.visualsByLayer,
    ),
    directEditingEnabled: !temporalInspection,
    temporalInspection,
    previewReadOnlyLayerIds: positionOverrides
      ? new Set(positionOverrides.keys())
      : NO_LAYER_IDS,
    positionAuthoringShakeOffset,
    lastValidVisuals: resolved.lastValidVisuals,
    visualsByLayer: resolved.visualsByLayer,
    visualSourceKeysByLayer: resolved.visualSourceKeysByLayer,
    visualStatusByLayer: resolved.visualStatusByLayer,
    targetReadyLayerIds: resolved.targetReadyLayerIds,
  };
}
