import type { Project } from '../models';

export interface LegacyCharacterImageLayerMatch {
  assetId: string;
  layerId: string;
  layerName: string;
  shotId: string;
  shotName: string;
}

function characterExpressionAssetIds(project: Project): Set<string> {
  return new Set(
    project.characters.flatMap((character) =>
      character.expressions.map((expression) => expression.assetId),
    ),
  );
}

/**
 * Find existing direct image layers whose asset has since become a Character
 * expression. Formal Shot backgrounds are intentionally excluded: they have
 * their own explicit identity and are not a Character-binding mismatch.
 */
export function findLegacyCharacterImageLayers(
  project: Project,
  assetIds: Iterable<string>,
): LegacyCharacterImageLayerMatch[] {
  const requestedAssetIds = new Set(assetIds);
  const expressionAssetIds = characterExpressionAssetIds(project);
  if (requestedAssetIds.size === 0 || expressionAssetIds.size === 0) {
    return [];
  }

  return project.shots.flatMap((shot) =>
    shot.layers.flatMap((layer) => {
      if (
        layer.source.kind !== 'asset' ||
        shot.backgroundLayerId === layer.id ||
        !requestedAssetIds.has(layer.source.assetId) ||
        !expressionAssetIds.has(layer.source.assetId)
      ) {
        return [];
      }

      return [
        {
          assetId: layer.source.assetId,
          layerId: layer.id,
          layerName: layer.name,
          shotId: shot.id,
          shotName: shot.name,
        },
      ];
    }),
  );
}

export function countLegacyCharacterImageLayers(
  project: Project,
  assetIds: Iterable<string>,
): number {
  return findLegacyCharacterImageLayers(project, assetIds).length;
}

export function isLegacyCharacterImageLayer(
  project: Project,
  shotId: string,
  layerId: string,
): boolean {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (
    !shot ||
    !layer ||
    shot.backgroundLayerId === layer.id ||
    layer.source.kind !== 'asset'
  ) {
    return false;
  }

  return characterExpressionAssetIds(project).has(layer.source.assetId);
}
