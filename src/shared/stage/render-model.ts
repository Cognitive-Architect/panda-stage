import type {
  Asset,
  EvaluatedLayer,
  EvaluatedShot,
  Project,
} from '../domain';

export type StageAssetUrlMap = Readonly<Record<string, string | undefined>>;

export interface StageRenderLayer extends EvaluatedLayer {
  asset: Asset;
  sourceUrl: string;
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

    return { ...layer, asset, sourceUrl };
  });

  return {
    width: project.width,
    height: project.height,
    shotId: evaluatedShot.shotId,
    timeMs: evaluatedShot.timeMs,
    layers,
  };
}
