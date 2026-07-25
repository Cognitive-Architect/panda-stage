import type {
  ImageAsset,
  Layer,
  Project,
  Shot,
} from '../models';

export function isShotBackgroundLayer(
  shot: Shot,
  layer: Layer,
): boolean {
  return shot.backgroundLayerId === layer.id;
}

export function resolveLayerImageAsset(
  project: Project,
  layer: Layer,
): ImageAsset | null {
  let assetId: string | undefined;
  if (layer.source.kind === 'asset') {
    assetId = layer.source.assetId;
  } else {
    const source = layer.source;
    const character = project.characters.find(
      (candidate) => candidate.id === source.characterId,
    );
    assetId = character?.expressions.find(
      (expression) => expression.id === source.expressionId,
    )?.assetId;
  }
  const asset = project.assets.find(
    (candidate) => candidate.id === assetId,
  );
  return asset?.kind === 'image' ? asset : null;
}

export function listShotImageAssets(
  project: Project,
  layers: readonly Layer[],
): ImageAsset[] {
  const assets = new Map<string, ImageAsset>();
  for (const layer of layers) {
    const asset = resolveLayerImageAsset(project, layer);
    if (asset) assets.set(asset.id, asset);
  }
  return [...assets.values()];
}
