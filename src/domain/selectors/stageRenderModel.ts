import {
  buildStageLayerRenderInstruction,
  type StageLayerRenderInstruction,
} from '../../shared/stage/layer-render-contract';
import type {
  ImageAsset,
  Layer,
  Project,
  Shot,
} from '../models';
import type { EvaluatedLayer, EvaluatedShot } from '../evaluate-shot-at-time';
import { resolveImageAsset, resolveLayerImageAsset } from './canvasLayers';
import {
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
): EditorStageRenderModel {
  const evaluatedById = new Map(
    evaluatedShot?.layers.map((layer) => [layer.id, layer]) ?? [],
  );
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EditorStageRenderLayer => {
      const baseAsset = resolveLayerImageAsset(project, layer);
      const evaluated = evaluatedById.get(layer.id) ?? {
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
      const visual = resolveLayerVisualParts(project, shot, evaluated);
      // `asset` remains as a compatibility/diagnostic primary asset for the
      // existing stage contract. Canvas rendering uses `visual.parts`, so a
      // composite Character is never reduced to this one asset.
      const primaryPart = visual.parts[0];
      const asset = primaryPart
        ? resolveImageAsset(project, primaryPart.assetId)
        : null;
      if (!asset) {
        throw new Error(
          `Cannot resolve image asset for editor layer ${layer.id}.`,
        );
      }
      return {
        layer,
        evaluated,
        asset,
        visual,
        render: buildStageLayerRenderInstruction(
          {
            id: layer.id,
            assetId: asset.id,
            assetWidth: asset.width,
            assetHeight: asset.height,
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
