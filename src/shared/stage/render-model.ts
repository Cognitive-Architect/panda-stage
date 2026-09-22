import {
  resolveLayerVisualParts,
  type EvaluatedLayer,
  type EvaluatedShot,
  type LayerVisualPart,
  type LayerVisualParts,
  type Project as FormalProject,
} from '../../domain';
import {
  buildStageLayerRenderInstruction,
  type StageLayerRenderInstruction,
} from './layer-render-contract';

/**
 * Structural asset accepted by the render model. Decoupled from the
 * schema-specific `Asset` types (legacy v1 and formal v5) so the single render
 * model serves both the editor path and the shared stage path after the
 * Day 25 evaluator convergence (RISK-EVENT-001).
 */
export interface RenderModelAsset {
  readonly id: string;
  readonly kind: 'image' | 'audio';
  readonly name: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Structural project accepted by the render model. Intentionally decoupled
 * from the schema-specific `Project` types so both the legacy (v1) and the
 * formal (v5) domain projects render through one model.
 */
export interface RenderModelProject {
  readonly width: number;
  readonly height: number;
  readonly shots: ReadonlyArray<{ readonly id: string }>;
  readonly assets: ReadonlyArray<RenderModelAsset>;
}

export type StageAssetUrlMap = Readonly<Record<string, string | undefined>>;

export interface StageRenderPart {
  /** Stable runtime render-part identity, never a persisted Project Layer. */
  readonly id: string;
  readonly slot: 'single' | 'body' | 'face';
  readonly drawOrder: number;
  readonly asset: RenderModelAsset;
  readonly sourceUrl: string;
  /** Local geometry; the owning logical Layer owns the root transform. */
  readonly render: StageLayerRenderInstruction;
}

export interface StageRenderLayer extends EvaluatedLayer {
  asset: RenderModelAsset;
  sourceUrl: string;
  render: StageLayerRenderInstruction;
  /** Complete runtime visual parts owned by this one logical Layer. */
  parts: StageRenderPart[];
  /** Null only for the historical structural probe compatibility path. */
  visual: LayerVisualParts | null;
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

function imageAsset(
  project: RenderModelProject,
  assetId: string,
  layerId: string,
): RenderModelAsset {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (
    !asset ||
    asset.kind !== 'image' ||
    asset.width === undefined ||
    asset.height === undefined
  ) {
    throw new StageAssetError(
      'UNKNOWN_ASSET',
      `Stage layer ${layerId} requires an image asset ${assetId}.`,
    );
  }
  return asset;
}

function sourceUrlFor(
  assetUrls: StageAssetUrlMap,
  asset: RenderModelAsset,
  layerId: string,
): string {
  const sourceUrl = assetUrls[asset.id];
  if (!sourceUrl) {
    throw new StageAssetError(
      'MISSING_ASSET_URL',
      `Stage asset "${asset.name}" has no loadable URL (${asset.relativePath}) for layer ${layerId}.`,
    );
  }
  return sourceUrl;
}

function localPartRender(
  part: LayerVisualPart,
  visible: boolean,
): StageLayerRenderInstruction {
  return {
    id: part.partId,
    assetId: part.assetId,
    isBackground: false,
    listening: false,
    x: part.localRect.x,
    y: part.localRect.y,
    width: part.localRect.width,
    height: part.localRect.height,
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible,
    zIndex: part.ownerZIndex,
    coverScale: null,
  };
}

function isFormalCompositeProject(
  project: RenderModelProject,
  evaluatedShot: EvaluatedShot,
): project is FormalProject {
  const candidate = project as Partial<FormalProject>;
  const shot = candidate.shots?.find(
    (item) => item.id === evaluatedShot.shotId,
  );
  return Boolean(
    Array.isArray(candidate.characters) &&
      shot &&
      shot.layers.some((layer) => 'source' in layer),
  );
}

function buildLegacyStageRenderModel(
  project: RenderModelProject,
  evaluatedShot: EvaluatedShot,
  assetUrls: StageAssetUrlMap,
): StageRenderModel {
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const layers = evaluatedShot.layers.map((layer) => {
    const asset = assetsById.get(layer.assetId);
    if (!asset) {
      throw new StageAssetError(
        'UNKNOWN_ASSET',
        `Stage layer ${layer.id} references missing asset ${layer.assetId}.`,
      );
    }

    const sourceUrl = sourceUrlFor(assetUrls, asset, layer.id);
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
    const render = buildStageLayerRenderInstruction(
      {
        id: layer.id,
        assetId: asset.id,
        assetWidth: asset.width,
        assetHeight: asset.height,
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        flipX: layer.flipX,
        rotationDeg: layer.rotationDeg,
        opacity: layer.opacity,
        visible: layer.visible,
        zIndex: layer.zIndex,
      },
      { width: project.width, height: project.height },
      evaluatedShot.backgroundLayerId === layer.id,
    );

    const parts: StageRenderPart[] = [
      {
        id: layer.id,
        slot: 'single',
        drawOrder: 0,
        asset,
        sourceUrl,
        render,
      },
    ];
    return {
      ...layer,
      asset,
      sourceUrl,
      render,
      parts,
      visual: null,
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

function buildFormalStageRenderModel(
  project: FormalProject,
  evaluatedShot: EvaluatedShot,
  assetUrls: StageAssetUrlMap,
): StageRenderModel {
  const shot = project.shots.find(
    (candidate) => candidate.id === evaluatedShot.shotId,
  );
  if (!shot) {
    throw new StageAssetError(
      'UNKNOWN_SHOT',
      `Stage cannot render unknown shot: ${evaluatedShot.shotId}`,
    );
  }

  const layers = evaluatedShot.layers.map((layer) => {
    const visual = resolveLayerVisualParts(project, shot, layer);
    const primaryPart = visual.parts[0];
    if (!primaryPart) {
      throw new StageAssetError(
        'UNKNOWN_ASSET',
        `Stage layer ${layer.id} has no renderable visual part.`,
      );
    }
    const primaryAsset = imageAsset(project, primaryPart.assetId, layer.id);
    const render = buildStageLayerRenderInstruction(
      {
        id: layer.id,
        assetId: primaryAsset.id,
        assetWidth: primaryAsset.width!,
        assetHeight: primaryAsset.height!,
        x: layer.x,
        y: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        flipX: layer.flipX,
        rotationDeg: layer.rotationDeg,
        opacity: layer.opacity,
        visible: layer.visible,
        zIndex: layer.zIndex,
      },
      { width: project.width, height: project.height },
      evaluatedShot.backgroundLayerId === layer.id,
    );

    const parts: StageRenderPart[] = visual.parts.map((part): StageRenderPart => {
      const asset = imageAsset(project, part.assetId, layer.id);
      const sourceUrl = sourceUrlFor(assetUrls, asset, layer.id);
      const isBackground =
        evaluatedShot.backgroundLayerId === layer.id &&
        part.slot === 'single';
      return {
        id: part.partId,
        slot: part.slot,
        drawOrder: part.drawOrder,
        asset,
        sourceUrl,
        render: isBackground
          ? render
          : localPartRender(part, visual.ownerTransform.visible),
      };
    });

    return {
      ...layer,
      asset: primaryAsset,
      sourceUrl: parts[0]!.sourceUrl,
      render,
      parts,
      visual,
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

/**
 * Converts an evaluated snapshot into render instructions. It never evaluates
 * animation: callers must provide final layer coordinates for one exact time.
 */
export function buildStageRenderModel(
  project: RenderModelProject,
  evaluatedShot: EvaluatedShot,
  assetUrls: StageAssetUrlMap,
): StageRenderModel {
  if (!project.shots.some((shot) => shot.id === evaluatedShot.shotId)) {
    throw new StageAssetError(
      'UNKNOWN_SHOT',
      `Stage cannot render unknown shot: ${evaluatedShot.shotId}`,
    );
  }

  return isFormalCompositeProject(project, evaluatedShot)
    ? buildFormalStageRenderModel(project, evaluatedShot, assetUrls)
    : buildLegacyStageRenderModel(project, evaluatedShot, assetUrls);
}
