import {
  buildStageLayerRenderInstruction,
  type StageLayerRenderInstruction,
} from '../../shared/stage/layer-render-contract';
import {
  applyResolvedCoverageMasks,
  resolveShotCoverageMasks,
} from '../coverage-mask';
import type {
  ImageAsset,
  Layer,
  Project,
  Shot,
} from '../models';
import { evaluateShotAtTime, type EvaluatedLayer, type EvaluatedShot } from '../evaluate-shot-at-time';
import { resolveRuntimeImageAsset, resolveLayerImageAsset } from './canvasLayers';
import {
  resolveCharacterActionRenderTransform,
  resolveLayerVisualParts,
  type LayerVisualParts,
} from './visualParts';

export interface EditorStageRenderLayer {
  layer: Layer;
  evaluated: EvaluatedLayer;
  asset: ImageAsset;
  /** The complete runtime visual owned by this one logical Layer. */
  visual: LayerVisualParts;
  render: StageLayerRenderInstruction;
}

export interface EditorStageRenderModel {
  width: number;
  height: number;
  shotId: string;
  backgroundLayerId: string | null;
  layers: EditorStageRenderLayer[];
}

export function buildEditorStageRenderModel(
  project: Project,
  shot: Shot,
  evaluatedShot?: EvaluatedShot,
  visualOverrides?: ReadonlyMap<string, LayerVisualParts | null>,
): EditorStageRenderModel {
  if (!evaluatedShot && shot.layers.some(layer => layer.animationClip || layer.parentLayerId || layer.parentKeys?.length || layer.parentSpaceOffset)) {
    evaluatedShot = evaluateShotAtTime(shot, 0, project);
  }
  const evaluatedById = new Map(
    evaluatedShot?.layers.map((layer) => [layer.id, layer]) ?? [],
  );
  const coverageMaskResolution = resolveShotCoverageMasks(shot);
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EditorStageRenderLayer => {
      const baseAsset = resolveLayerImageAsset(project, layer);
      const evaluatedSource = evaluatedById.get(layer.id) ?? {
        id: layer.id,
        assetId: baseAsset?.id ?? '',
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
      // The Canvas may render the authored base pose without the formal
      // evaluator; coverage mask relations still must be available there.
      const evaluated = applyResolvedCoverageMasks(
        [evaluatedSource],
        coverageMaskResolution,
      )[0]!;
      const visual = visualOverrides?.has(layer.id)
        ? visualOverrides.get(layer.id) ?? emptyVisual(project, layer, evaluated)
        : resolveLayerVisualParts(
            project,
            shot,
            evaluated,
            evaluatedShot?.timeMs ?? 0,
          );
      // `asset` remains as a compatibility/diagnostic primary asset for the
      // existing stage contract. Canvas rendering uses `visual.parts`, so a
      // composite Character is never reduced to this one asset.
      const primaryPart = visual.parts[0];
      const asset = primaryPart?.assetId
        ? resolveRuntimeImageAsset(project, primaryPart.assetId)
        : baseAsset;
      const compatibilityAsset =
        asset ??
        compatibilityImageAsset(
          primaryPart?.assetId ??
            primaryPart?.partId ??
            evaluated.assetId ??
            `${layer.id}:missing`,
          primaryPart?.localRect.width ?? baseAsset?.width ?? 1,
          primaryPart?.localRect.height ?? baseAsset?.height ?? 1,
        );
      return {
        layer,
        evaluated,
        asset: compatibilityAsset,
        visual,
        render: buildStageLayerRenderInstruction(
          {
            id: layer.id,
            assetId: compatibilityAsset.id,
            assetWidth: compatibilityAsset.width,
            assetHeight: compatibilityAsset.height,
            // Cached visuals can predate a live Position draft.
            ...resolveCharacterActionRenderTransform(evaluated),
          },
          { width: project.width, height: project.height },
          shot.backgroundLayerId === layer.id,
        ),
      };
    });

  return {
    width: project.width,
    height: project.height,
    shotId: shot.id,
    backgroundLayerId: shot.backgroundLayerId,
    layers,
  };
}

function compatibilityImageAsset(
  id: string,
  width: number,
  height: number,
): ImageAsset {
  return {
    id,
    kind: 'image',
    name: 'Canvas continuity visual',
    relativePath: 'assets/canvas-continuity-placeholder.png',
    mimeType: 'image/png',
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    usage: 'uncategorized',
    keywords: [],
  };
}

function emptyVisual(
  project: Project,
  layer: Layer,
  evaluated: EvaluatedLayer,
): LayerVisualParts {
  const characterId =
    layer.source.kind === 'character' ? layer.source.characterId : null;
  const character =
    characterId
      ? project.characters.find((candidate) => candidate.id === characterId)
      : null;
  return {
    ownerLayerId: layer.id,
    kind:
      character?.mode === 'adaptive-parts'
        ? 'adaptive-parts-character'
        : character?.mode === 'composite'
          ? 'composite-character'
          : character
          ? 'single-image-character'
          : 'ordinary-image',
    ownerTransform: {
      anchor: evaluated.anchor,
      x: evaluated.x,
      y: evaluated.y,
      scaleX: evaluated.scaleX,
      scaleY: evaluated.scaleY,
      flipX: evaluated.flipX,
      rotationDeg: evaluated.rotationDeg,
      opacity: evaluated.opacity,
      visible: evaluated.visible,
      zIndex: evaluated.zIndex,
    },
    facePlacement: null,
    parts: [],
    headGroup: null,
    combinedLocalBounds: { x: 0, y: 0, width: 0, height: 0 },
    activeFace: null,
    resources: { required: [], candidates: [], fallback: [] },
  };
}
