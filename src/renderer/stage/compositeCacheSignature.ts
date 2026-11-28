import type {
  EvaluatedFlaGraphicVisual,
  EvaluatedPinWarp,
  EvaluatedPinWarpMesh,
  LayerVisualHeadGroup,
  VisualLocalRect,
} from '../../domain';
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
  /**
   * Shared evaluated pin-warp for this exact frame (#1471 R3). Two deformation
   * poses with the same transform/effects must not reuse one composite cache;
   * absent/`null` keeps the pre-#1471 signature byte-identical.
   */
  pinWarp?: EvaluatedPinWarp | null;
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

/**
 * Quantize one mesh coordinate for the cache fingerprint. 1/1000 local pixel is
 * far below a visible deformation step but keeps the signature compact.
 */
function roundMeshValue(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

function meshCacheInput(mesh: EvaluatedPinWarpMesh) {
  return {
    rect: [
      roundMeshValue(mesh.rect.x),
      roundMeshValue(mesh.rect.y),
      roundMeshValue(mesh.rect.width),
      roundMeshValue(mesh.rect.height),
    ],
    columns: mesh.columns,
    rows: mesh.rows,
    triangleCount: mesh.triangles.length,
    seamOverlap: roundMeshValue(mesh.seamOverlap),
    // Rounded destination vertices + source UVs: enough to tell two poses apart,
    // cheap enough to serialize on every Stage/Preview/Export frame.
    vertices: mesh.vertices.map((vertex) => [
      roundMeshValue(vertex.x),
      roundMeshValue(vertex.y),
    ]),
    uv: mesh.uvPerVertex.map((uv) => [roundMeshValue(uv.x), roundMeshValue(uv.y)]),
  };
}

/**
 * Compact deterministic fingerprint of the evaluated pin warp (#1471 R3). An
 * invalid warp draws the plain image, so only the status/reason participates;
 * an absent warp returns `undefined` so `JSON.stringify` omits the key and the
 * pre-#1471 signature is unchanged.
 */
function pinWarpCacheInput(
  pinWarp: EvaluatedPinWarp | null | undefined,
): unknown {
  if (!pinWarp) return undefined;
  if (pinWarp.status === 'invalid') {
    return { status: 'invalid', reason: pinWarp.reason };
  }
  return { status: 'valid', mesh: meshCacheInput(pinWarp.mesh) };
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
  pinWarp,
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
    pinWarp: pinWarpCacheInput(pinWarp),
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