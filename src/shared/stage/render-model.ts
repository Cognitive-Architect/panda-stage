import type {
  Asset,
  EvaluatedLayer,
  EvaluatedShot,
  Project,
} from '../domain';
import {
  buildStageLayerRenderInstruction,
  type StageLayerRenderInstruction,
} from './layer-render-contract';

export type StageAssetUrlMap = Readonly<Record<string, string | undefined>>;

export interface StageRenderLayer extends EvaluatedLayer {
  asset: Asset;
  sourceUrl: string;
  render: StageLayerRenderInstruction;
}

export interface StageRenderModel {
  width: number;
  height: number;
  shotId: string;
  timeMs: number;
  layers: StageRenderLayer[];
}

export class StageAssetError extends Error {
  constructor(
    readonly code: 'UNKNOWN_SHOT' | 'UNKNOWN_ASSET' | 'MISSING_ASSET_URL',
    message: string,
  ) {
    super(message);
    this.name = 'StageAssetError';
  }
}

/**
 * Converts an evaluated snapshot into render instructions. It never evaluates
 * animation: callers must provide final layer coordinates for one exact time.
 */
export function buildStageRenderModel(
  project: Project,
  evaluatedShot: EvaluatedShot,
  assetUrls: StageAssetUrlMap,
): StageRenderModel {
  if (!project.shots.some((shot) => shot.id === evaluatedShot.shotId)) {
    throw new StageAssetError(
      'UNKNOWN_SHOT',
      `Stage cannot render unknown shot: ${evaluatedShot.shotId}`,
    );
  }

  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const layers = evaluatedShot.layers.map((layer) => {
    const asset = assetsById.get(layer.assetId);
    if (!asset) {
      throw new StageAssetError(
        'UNKNOWN_ASSET',
        `Stage layer ${layer.id} references missing asset ${layer.assetId}.`,
      );
    }

    const sourceUrl = assetUrls[asset.id];
    if (!sourceUrl) {
      throw new StageAssetError(
        'MISSING_ASSET_URL',
        `Stage asset "${asset.name}" has no loadable URL (${asset.relativePath}).`,
      );
    }

    if (
      asset.kind !== 'image' ||
      asset.width === undefined ||
      asset.height === undefined
    ) {
      throw new StageAssetError(
        'UNKNOWN_ASSET',
        `Stage layer ${layer.id} requires an image asset.`,
      );
    }

    return {
      ...layer,
      asset,
      sourceUrl,
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
          flipX: false,
          rotationDeg: layer.rotationDeg,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex: layer.zIndex,
        },
        { width: project.width, height: project.height },
        evaluatedShot.backgroundLayerId === layer.id,
      ),
    };
  });

  return {
    width: project.width,
    height: project.height,
    shotId: evaluatedShot.shotId,
    timeMs: evaluatedShot.timeMs,
    layers,
  };
}
