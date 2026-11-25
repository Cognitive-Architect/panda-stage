import {
  isFlaGraphicDefinition,
  type ImageAsset,
  type Layer,
  type Project,
  type Shot,
} from '../models';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import { parseFlaVideoFrameAssetKey } from '../../shared/fla-video-clock';

export interface BackgroundVisualDimensions {
  width: number;
  height: number;
}

export function resolveBackgroundSourceDimensions(
  project: Pick<Project, 'assets'> & Partial<Pick<Project, 'animations'>>,
  layer: Pick<Layer, 'source'> & Partial<Pick<Layer, 'animationFirstFrame'>>,
): BackgroundVisualDimensions | null {
  if (layer.source.kind === 'asset') {
    const assetId = layer.source.assetId;
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== 'image') {
      return null;
    }
    return {
      width: asset.width,
      height: asset.height,
    };
  }

  if (layer.source.kind === 'video') {
    const videoAssetId = layer.source.assetId;
    const asset = project.assets.find((candidate) => candidate.id === videoAssetId);
    if (!asset || asset.kind !== 'video') return null;
    return { width: asset.width, height: asset.height };
  }

  if (layer.source.kind === 'animation') {
    const animationId = layer.source.animationId;
    const animation = project.animations?.find(
      (candidate) => candidate.id === animationId,
    );
    if (!animation || !isFlaGraphicDefinition(animation)) {
      return null;
    }
    const frameIndex = Math.max(
      0,
      Math.min(layer.animationFirstFrame ?? 0, animation.frames.length - 1),
    );
    const frameOrdinal =
      animation.frames[frameIndex]?.ordinal ?? animation.frames[0]?.ordinal;
    if (frameOrdinal === undefined) {
      return null;
    }
    const evaluated = evaluateFlaGraphicVisual({
      definition: animation,
      frameOrdinal,
      mode: 'definition',
    });
    if (!evaluated) {
      return null;
    }
    return {
      width: evaluated.canvas.width,
      height: evaluated.canvas.height,
    };
  }

  return null;
}

export function resolveBackgroundVisualDimensions(
  project: Pick<Project, 'assets'> & Partial<Pick<Project, 'animations'>>,
  layer: Pick<Layer, 'source'> & Partial<Pick<Layer, 'animationFirstFrame'>>,
): BackgroundVisualDimensions | null {
  const dimensions = resolveBackgroundSourceDimensions(project, layer);
  if (
    !dimensions ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return null;
  }
  return dimensions;
}

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
      if (!character || character.mode === 'adaptive-parts') return null;
      if (source.expressionId === undefined) return null;
      assetId = character?.expressions.find(
        (expression) => expression.id === source.expressionId,
      )?.assetId;
      break;
    }
    case 'video':
      return null;
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

/** A decoded video's frame is an image resource only within the render pipeline. */
export function resolveRuntimeImageAsset(project: Project, assetId: string): ImageAsset | null {
  const frame = parseFlaVideoFrameAssetKey(assetId);
  if (!frame) return resolveImageAsset(project, assetId);
  const asset = project.assets.find((candidate) => candidate.id === frame.assetId);
  if (asset?.kind !== 'video' || frame.sampleIndex >= asset.videoTiming.presentationTicks.length) return null;
  return {
    id: assetId, name: asset.name, relativePath: asset.relativePath, kind: 'image', mimeType: 'image/png',
    sha256: asset.sha256, width: asset.width, height: asset.height, usage: 'uncategorized', keywords: [],
  };
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
