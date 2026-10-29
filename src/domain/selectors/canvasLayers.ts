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
  const source = layer.source;
  switch (source.kind) {
    case 'asset':
      assetId = source.assetId;
      break;
    case 'character': {
      const character = project.characters.find(
        (candidate) => candidate.id === source.characterId,
      );
      assetId = character?.expressions.find(
        (expression) => expression.id === source.expressionId,
      )?.assetId;
      break;
    }
    case 'animation': {
      const animation = project.animations.find(
        (candidate) => candidate.id === source.animationId,
      );
      assetId = animation?.frames[0]?.assetId;
      break;
    }
  }
  return resolveImageAsset(project, assetId);
}

export function resolveImageAsset(
  project: Project,
  assetId: string | undefined,
): ImageAsset | null {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
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
