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
import { resolveLayerImageAsset } from './canvasLayers';

export interface EditorStageRenderLayer {
  layer: Layer;
  asset: ImageAsset;
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
): EditorStageRenderModel {
  const layers = [...shot.layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer): EditorStageRenderLayer => {
      const asset = resolveLayerImageAsset(project, layer);
      if (!asset) {
        throw new Error(
          `Cannot resolve image asset for editor layer ${layer.id}.`,
        );
      }
      return {
        layer,
        asset,
        render: buildStageLayerRenderInstruction(
          {
            id: layer.id,
            assetId: asset.id,
            assetWidth: asset.width,
            assetHeight: asset.height,
            x: layer.x,
            y: layer.y,
            scaleX: layer.scaleX,
            scaleY: layer.scaleY,
            rotationDeg: layer.rotationDeg,
            opacity: layer.opacity,
            visible: layer.visible,
            zIndex: layer.zIndex,
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
