import type { Asset } from '../models/asset';
import type { Project } from '../models/project';
import { reconstructFlaGraphicStructure } from '../models/flaGraphicStructure';

/** Shared identity rule from the existing Canvas Image reader; never infer ownership from names. */
export function isGeneratedFlaSvgAsset(project: Project, asset: Asset): boolean {
  return asset.kind === 'image' && asset.mimeType === 'image/svg+xml' &&
    (Boolean(asset.flaGraphicFrame) || project.animations.some((animation) =>
      'kind' in animation && animation.kind === 'fla-graphic' && animation.structure &&
      reconstructFlaGraphicStructure(animation.structure).some(({ node }) =>
        node.type === 'opaque' && node.opaqueKind === 'shape' &&
        node.fallbackScope === 'subtree' && node.fallbackAssetId === asset.id,
      ),
    ));
}
