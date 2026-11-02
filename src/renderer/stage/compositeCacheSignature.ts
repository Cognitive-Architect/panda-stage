import type { LayerVisualHeadGroup, VisualLocalRect } from '../../domain';
import type { StageRenderPart } from '../../shared/stage/render-model';

export interface StageCompositeCacheSignatureInput {
  ownerLayerId: string;
  composite: boolean;
  complete: boolean;
  visualBounds: VisualLocalRect;
  headGroup: LayerVisualHeadGroup | null;
  orderedParts: readonly StageRenderPart[];
  images: ReadonlyMap<string, unknown>;
}

export function createStageCompositeCacheSignature({
  ownerLayerId,
  composite,
  complete,
  visualBounds,
  headGroup,
  orderedParts,
  images,
}: StageCompositeCacheSignatureInput): string {
  return JSON.stringify({
    ownerLayerId,
    composite,
    complete,
    visualBounds,
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