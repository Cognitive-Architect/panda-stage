import type { EvaluatedFlaGraphicVisual, LayerVisualHeadGroup, VisualLocalRect } from '../../domain';
import type { LayerVisualEffects } from '../../domain/models/layerVisualEffects';
import type { StageRenderPart, StageRenderResource } from '../../shared/stage/render-model';

export interface StageCompositeCacheSignatureInput {
  ownerLayerId: string;
  composite: boolean;
  complete: boolean;
  visualBounds: VisualLocalRect;
  headGroup: LayerVisualHeadGroup | null;
  orderedParts: readonly StageRenderPart[];
  images: ReadonlyMap<string, unknown>;
  layerEffects?: {
    effects: LayerVisualEffects;
    structuredVisual?: EvaluatedFlaGraphicVisual;
    resources: readonly StageRenderResource[];
  };
}

function graphicCacheInput(graphic: EvaluatedFlaGraphicVisual | undefined) {
  if (!graphic) return null;
  return {
    mode: graphic.mode,
    frameOrdinal: graphic.frameOrdinal,
    frameAssetId: graphic.frameAssetId,
    frameOffset: graphic.frameOffset,
    frameViewport: graphic.frameViewport,
    canvas: graphic.canvas,
    anchor: graphic.anchor,
    hasStructure: graphic.structureFrame !== null,
    layers: graphic.layers,
    resourceAssetIds: graphic.resourceAssetIds,
  };
}

export function createStageCompositeCacheSignature({
  ownerLayerId,
  composite,
  complete,
  visualBounds,
  headGroup,
  orderedParts,
  images,
  layerEffects,
}: StageCompositeCacheSignatureInput): string {
  return JSON.stringify({
    ownerLayerId,
    composite,
    complete,
    visualBounds,
    effects: layerEffects?.effects,
    graphic: layerEffects && graphicCacheInput(layerEffects.structuredVisual),
    resources: layerEffects?.resources.map(({ id, sourceUrl, asset }) =>
      [id, sourceUrl, asset.sha256, asset.width, asset.height, images.has(id)]),
    headGroup: headGroup
      ? {
          id: headGroup.id,
          partIds: headGroup.partIds,
          pivot: headGroup.pivot,
          transform: headGroup.transform,
        }
      : null,
    parts: orderedParts.map((part) => ({
      id: part.id,
      slot: part.slot,
      drawOrder: part.drawOrder,
      assetId: part.asset.id,
      assetWidth: part.asset.width,
      assetHeight: part.asset.height,
      sourceUrl: part.sourceUrl,
      flaGraphic: graphicCacheInput(part.flaGraphic),
      render: part.render,
      imageReady: images.has(part.id),
    })),
  });
}

export interface StageCompositeCacheReuseInput {
  forceRebuild: boolean;
  previousSignature: string | null;
  inputSignature: string;
  cacheEligible: boolean;
  previouslyCached: boolean;
}

export function shouldReuseStageCompositeCache({
  forceRebuild,
  previousSignature,
  inputSignature,
  cacheEligible,
  previouslyCached,
}: StageCompositeCacheReuseInput): boolean {
  return (
    !forceRebuild &&
    previousSignature === inputSignature &&
    cacheEligible === previouslyCached
  );
}