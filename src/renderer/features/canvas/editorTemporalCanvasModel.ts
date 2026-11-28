import {
  applyResolvedCoverageMasks,
  evaluateLayerMotionAtTime,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerImageAsset,
  resolveShotCoverageMasks,
  type EditorStageRenderModel,
  type EvaluatedLayer,
  type EvaluatedShot,
  type LayerVisualParts,
  type Point,
  type Project,
  type Shot,
} from '../../../domain';
import type { DialogueSilence } from '../../../shared/dialogue-silence';
import { listCharacterTalkingSources } from '../../../domain/selectors/characterFaceSource';
import {
  resolveEditorTemporalAssetResolution,
  type EditorTemporalVisual,
  type EditorTemporalVisualStatus,
} from './temporalVisualContinuity';

export interface EditorTemporalCanvasModelInput {
  project: Project;
  shot: Shot;
  currentTimeMs: number;
  cameraViewActive?: boolean;
  activeDialogueId?: string | null;
  dialogueSilence?: DialogueSilence;
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
  const evaluatedAtZero = new Map(
    evaluateShotAtTime(shot, 0, project).layers.map((layer) => [layer.id, layer]),
  );
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EvaluatedLayer => {
      const asset = resolveLayerImageAsset(project, layer);
      const evaluatedLayer = evaluatedAtZero.get(layer.id);
      const animationAtZero =
        layer.source.kind === 'animation'
          ? evaluatedLayer
          : undefined;
      return {
        id: layer.id,
        // The 0:00 editor base view overrides the editable transform fields
        // only; the formal evaluation still owns the pin-warp mesh (#1460).
        ...(evaluatedLayer?.pinWarp ? { pinWarp: evaluatedLayer.pinWarp } : {}),
        ...(layer.source.kind === 'control' ? { control: true } : {}),
        ...(evaluatedLayer?.effectiveDepth !== undefined ? { effectiveDepth: evaluatedLayer.effectiveDepth } : {}),
        ...(evaluatedLayer?.effectiveCameraSpace ? { effectiveCameraSpace: evaluatedLayer.effectiveCameraSpace } : {}),
        ...(layer.animationClip ? {
          animationValues: evaluatedLayer?.animationValues,
          animationTimeMs: 0,
          ...(evaluatedLayer?.faceTransform
            ? { faceTransform: evaluatedLayer.faceTransform }
            : {}),
        } : {}),
        assetId: animationAtZero?.assetId ?? asset?.id ?? '',
        ...(animationAtZero?.animationFrame
          ? { animationFrame: animationAtZero.animationFrame }
          : {}),
        currentExpressionId:
          layer.source.kind === 'character'
            ? layer.source.expressionId
            : null,
        mouthOverrideAssetId: null,
        anchor: layer.anchor,
        x:
          layer.animationClip?.version === 2 && animationAtZero
            ? animationAtZero.x
            : layer.x,
        y:
          layer.animationClip?.version === 2 && animationAtZero
            ? animationAtZero.y
            : layer.y,
        scaleX:
          layer.animationClip?.version === 2 && animationAtZero
            ? animationAtZero.scaleX
            : layer.scaleX,
        scaleY:
          layer.animationClip?.version === 2 && animationAtZero
            ? animationAtZero.scaleY
            : layer.scaleY,
        flipX: layer.flipX,
        rotationDeg:
          layer.animationClip?.version === 2 && animationAtZero
            ? animationAtZero.rotationDeg
            : layer.rotationDeg,
        opacity: layer.opacity,
        visible: animationAtZero?.visible ?? layer.visible,
        zIndex: layer.zIndex,
      };
    });

  return {
    shotId: shot.id,
    timeMs: 0,
    backgroundLayerId: shot.backgroundLayerId,
    layers: applyResolvedCoverageMasks(layers, resolveShotCoverageMasks(shot)),
  };
}

/** The visible pose at the playhead, including the Canvas reference view at 0:00. */
export function evaluateEditorCanvasShot(
  project: Project,
  shot: Shot,
  currentTimeMs: number,
  activeDialogueId: string | null,
  dialogueSilence?: DialogueSilence,
  cameraViewActive = false,
): EvaluatedShot {
  if (cameraViewActive || currentTimeMs !== 0) {
    return projectShotDialogueVisual(
      project,
      shot,
      evaluateShotAtTime(shot, currentTimeMs, project),
      activeDialogueId,
      dialogueSilence,
    );
  }
  const baseEditorShot = buildBaseEditorShot(project, shot);
  // Keep base transform editing at 0:00, while showing any formally authored
  // Expression switch or configured talking face at zero. Only the face
  // state is projected so the base transforms remain editable.
  const hasSilenceAnalysis = dialogueSilence !== undefined && Object.keys(dialogueSilence).length > 0;
  const manualAtZero = new Set(shot.timelineEvents.flatMap((event) =>
    event.type === 'mouth-pose' && event.origin === 'manual' && event.startMs === 0 ? [event.layerId] : []));
  const hasConfiguredTalkingFace = shot.layers.some(({ source }) =>
    source.kind === 'character' && project.characters.some(character =>
      character.id === source.characterId && (character.mouthPoseSet?.driveMode === 'mouth-poses' ||
        listCharacterTalkingSources(character).some(({ playback }) => hasSilenceAnalysis || playback))),
  );
  const zeroTimeExpressionShot = hasConfiguredTalkingFace || shot.timelineEvents.some(
    (event) =>
      (event.type === 'expression' || event.type === 'mouth-cue' || event.type === 'mouth-pose') &&
      event.startMs === 0,
  )
    ? (() => {
        const atZero = evaluateShotAtTime(shot, 0, project);
        const formal = hasConfiguredTalkingFace || manualAtZero.size > 0
          ? projectShotDialogueVisual(project, shot, atZero, activeDialogueId, dialogueSilence) : atZero;
        return {
          ...baseEditorShot,
          layers: baseEditorShot.layers.map((layer) => {
            const source = shot.layers.find((candidate) => candidate.id === layer.id)?.source;
            if (source?.kind !== 'character') return layer;
            const configured = project.characters.some(character =>
              character.id === source.characterId && (character.mouthPoseSet?.driveMode === 'mouth-poses' ||
                listCharacterTalkingSources(character).some(({ playback }) => hasSilenceAnalysis || playback)));
            const evaluated = (configured || manualAtZero.has(layer.id) ? formal : atZero).layers.find(candidate => candidate.id === layer.id);
            return evaluated
              ? {
                  ...layer,
                  assetId: evaluated.assetId,
                  currentExpressionId: evaluated.currentExpressionId,
                  mouthOverrideAssetId: evaluated.mouthOverrideAssetId ?? null,
                  ...(evaluated.mouthOpen ? { mouthOpen: true } : {}),
                  talkingAnimationElapsedMs: evaluated.talkingAnimationElapsedMs,
                  ...(evaluated.mouthPose ? { mouthPose: evaluated.mouthPose } : {}),
                }
              : layer;
          }),
        };
      })()
    : baseEditorShot;
  const members = new Set(shot.layers
    .filter(({ parentLayerId, parentSpaceOffset, parentKeys, layerMotionTracks }) =>
      parentLayerId || parentSpaceOffset || parentKeys?.length || layerMotionTracks?.length)
    .flatMap((layer) => [layer.id, layer.parentLayerId, ...(layer.parentKeys?.map((key) => key.parentLayerId ?? undefined) ?? [])]));
  if (members.size) {
    const formal = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, 0, project), activeDialogueId, dialogueSilence);
    const evaluatedById = new Map(formal.layers.map((layer) => [layer.id, layer]));
    return { ...zeroTimeExpressionShot, layers: zeroTimeExpressionShot.layers.map((layer) =>
      members.has(layer.id) ? evaluatedById.get(layer.id)! : layer) };
  }
  return zeroTimeExpressionShot;
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
  cameraViewActive = false,
  activeDialogueId = null,
  dialogueSilence,
  readyAssetIds,
  readyAssetSourceKeys,
  readyResourceKeys,
  missingAssetIds,
  previousVisuals,
  positionDraft,
}: EditorTemporalCanvasModelInput): EditorTemporalCanvasModel {
  const temporalInspection = cameraViewActive || currentTimeMs !== 0;
  const evaluatedShot = evaluateEditorCanvasShot(project, shot, currentTimeMs, activeDialogueId, dialogueSilence, cameraViewActive);
  // Base Edit View owns 0:00 transforms and the continuity resolver owns image
  // transitions. At 0:00 we retain the previous complete visual
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
