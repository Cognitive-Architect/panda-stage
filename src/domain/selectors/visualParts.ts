import type { EvaluatedLayer, EvaluatedShot } from '../evaluate-shot-at-time';
import type {
  FacePlacement,
  ImageAsset,
  Layer,
  Project,
} from '../models';
import { resolveImageAsset } from './canvasLayers';

export type LayerVisualKind =
  | 'ordinary-image'
  | 'single-image-character'
  | 'composite-character';

export type VisualPartSlot = 'single' | 'body' | 'face';

export interface VisualLocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualOwnerTransform {
  anchor: EvaluatedLayer['anchor'];
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
}

export type VisualPartSource =
  | { kind: 'asset'; assetId: string }
  | { kind: 'character-body'; assetId: string }
  | { kind: 'character-expression'; expressionId: string; assetId: string }
  | { kind: 'character-mouth'; assetId: string };

export interface LayerVisualPart {
  /** Stable runtime identity; never persisted as a Project Layer. */
  partId: string;
  ownerLayerId: string;
  slot: VisualPartSlot;
  source: VisualPartSource;
  assetId: string;
  localRect: VisualLocalRect;
  drawOrder: number;
  ownerZIndex: number;
}

export interface ActiveCharacterFace {
  currentExpressionId: string;
  currentExpressionAssetId: string;
  source: 'expression' | 'mouth';
  assetId: string;
  configuredMouthAssetId: string | null;
  /** The current Expression resource to use if the active Mouth cannot load. */
  fallbackAssetId: string | null;
}

export type VisualResourceReason =
  | 'current-layer'
  | 'body'
  | 'active-expression'
  | 'active-mouth'
  | 'alternate-expression'
  | 'mouth-override'
  | 'current-expression-fallback';

export interface VisualResourceReference {
  assetId: string;
  reason: VisualResourceReason;
}

export interface LayerVisualResources {
  /** Resources needed for the exact current complete visual. */
  required: VisualResourceReference[];
  /** Other resources that may be needed at another time or state. */
  candidates: VisualResourceReference[];
  /** Resources that can replace an unavailable active override. */
  fallback: VisualResourceReference[];
}

export interface LayerVisualParts {
  ownerLayerId: string;
  kind: LayerVisualKind;
  ownerTransform: VisualOwnerTransform;
  /** Null for ordinary and single-image layers; one shared placement for composite. */
  facePlacement: FacePlacement | null;
  /** Exactly one part for ordinary/single-image, Body + Face for composite. */
  parts: LayerVisualPart[];
  combinedLocalBounds: VisualLocalRect;
  activeFace: ActiveCharacterFace | null;
  resources: LayerVisualResources;
}

function imageAsset(
  project: Project,
  assetId: string,
  ownerLayerId: string,
): ImageAsset {
  const asset = resolveImageAsset(project, assetId);
  if (!asset) {
    throw new Error(
      `Cannot resolve image asset ${assetId} for visual layer ${ownerLayerId}.`,
    );
  }
  return asset;
}

function centeredRect(
  asset: ImageAsset,
  centerX = 0,
  centerY = 0,
  scale = 1,
): VisualLocalRect {
  const width = asset.width * scale;
  const height = asset.height * scale;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function unionRects(rects: readonly VisualLocalRect[]): VisualLocalRect {
  const first = rects[0];
  if (!first) {
    throw new Error('Cannot calculate visual bounds without a visual part.');
  }
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function ownerTransform(evaluated: EvaluatedLayer): VisualOwnerTransform {
  return {
    anchor: evaluated.anchor,
    x: evaluated.x,
    y: evaluated.y,
    scaleX: evaluated.scaleX,
    scaleY: evaluated.scaleY,
    flipX: evaluated.flipX,
    rotationDeg: evaluated.rotationDeg,
    opacity: evaluated.opacity,
    visible: evaluated.visible,
    zIndex: evaluated.zIndex,
  };
}

function addResource(
  resources: Map<string, VisualResourceReference>,
  assetId: string,
  reason: VisualResourceReason,
): void {
  if (!resources.has(assetId)) resources.set(assetId, { assetId, reason });
}

function characterResources(
  project: Project,
  character: Extract<Project['characters'][number], { mode: 'single-image' | 'composite' }>,
  activeFace: ActiveCharacterFace,
  requiredAssetIds: ReadonlySet<string>,
  fallbackAssetIds: ReadonlySet<string>,
): LayerVisualResources {
  const required = new Map<string, VisualResourceReference>();
  const candidates = new Map<string, VisualResourceReference>();
  const fallback = new Map<string, VisualResourceReference>();

  for (const assetId of requiredAssetIds) {
    addResource(
      required,
      assetId,
      assetId === activeFace.assetId && activeFace.source === 'mouth'
        ? 'active-mouth'
        : assetId === activeFace.assetId
          ? 'active-expression'
          : 'body',
    );
  }
  for (const assetId of fallbackAssetIds) {
    addResource(fallback, assetId, 'current-expression-fallback');
  }

  for (const expression of character.expressions) {
    if (!resolveImageAsset(project, expression.assetId)) continue;
    if (
      !requiredAssetIds.has(expression.assetId) &&
      !fallbackAssetIds.has(expression.assetId)
    ) {
      addResource(candidates, expression.assetId, 'alternate-expression');
    }
  }
  if (character.mouthOpenAssetId) {
    const mouthAsset = resolveImageAsset(project, character.mouthOpenAssetId);
    if (
      mouthAsset &&
      !requiredAssetIds.has(character.mouthOpenAssetId) &&
      !fallbackAssetIds.has(character.mouthOpenAssetId)
    ) {
      addResource(candidates, character.mouthOpenAssetId, 'mouth-override');
    }
  }

  return {
    required: [...required.values()],
    candidates: [...candidates.values()],
    fallback: [...fallback.values()],
  };
}

function resolveCharacterFace(
  project: Project,
  character: Extract<Project['characters'][number], { mode: 'single-image' | 'composite' }>,
  evaluated: EvaluatedLayer,
  fallbackExpressionId: string,
): { face: ActiveCharacterFace; asset: ImageAsset } {
  const currentExpressionId =
    evaluated.currentExpressionId ?? fallbackExpressionId;
  const expression =
    character.expressions.find(
      (candidate) => candidate.id === currentExpressionId,
    ) ??
    character.expressions.find(
      (candidate) => candidate.id === character.defaultExpressionId,
    );
  if (!expression) {
    throw new Error(
      `Cannot resolve current Expression for Character ${character.id}.`,
    );
  }
  const expressionAsset = imageAsset(project, expression.assetId, evaluated.id);
  const mouthAsset = evaluated.mouthOverrideAssetId
    ? resolveImageAsset(project, evaluated.mouthOverrideAssetId)
    : null;
  const activeAsset = mouthAsset ?? expressionAsset;
  const source = mouthAsset ? 'mouth' : 'expression';
  return {
    face: {
      currentExpressionId: expression.id,
      currentExpressionAssetId: expressionAsset.id,
      source,
      assetId: activeAsset.id,
      configuredMouthAssetId: character.mouthOpenAssetId ?? null,
      fallbackAssetId: mouthAsset ? expressionAsset.id : null,
    },
    asset: activeAsset,
  };
}

function baseResult(
  evaluated: EvaluatedLayer,
  kind: LayerVisualKind,
  facePlacement: FacePlacement | null,
  parts: LayerVisualPart[],
  activeFace: ActiveCharacterFace | null,
  resources: LayerVisualResources,
): LayerVisualParts {
  return {
    ownerLayerId: evaluated.id,
    kind,
    ownerTransform: ownerTransform(evaluated),
    facePlacement,
    parts,
    combinedLocalBounds: unionRects(parts.map((part) => part.localRect)),
    activeFace,
    resources,
  };
}

/**
 * Resolves one logical Layer into its complete runtime visual parts.
 *
 * The returned Body/Face identities are ephemeral (`<layerId>:body` and
 * `<layerId>:face`) and stay under the one logical owner Layer. Local geometry
 * deliberately excludes the owner transform: Body is centered at the root
 * local origin, while Face uses the one persisted shared Face Placement.
 */
export function resolveLayerVisualParts(
  project: Project,
  shot: { layers: readonly Layer[] },
  evaluated: EvaluatedLayer,
): LayerVisualParts {
  const layer = shot.layers.find((candidate) => candidate.id === evaluated.id);
  if (!layer) {
    throw new Error(`Cannot resolve visual owner Layer ${evaluated.id}.`);
  }

  const source = layer.source;
  if (source.kind === 'asset') {
    const asset = imageAsset(project, evaluated.assetId || source.assetId, layer.id);
    const part: LayerVisualPart = {
      partId: `${layer.id}:single`,
      ownerLayerId: layer.id,
      slot: 'single',
      source: { kind: 'asset', assetId: asset.id },
      assetId: asset.id,
      localRect: centeredRect(asset),
      drawOrder: 0,
      ownerZIndex: evaluated.zIndex,
    };
    return baseResult(
      evaluated,
      'ordinary-image',
      null,
      [part],
      null,
      {
        required: [{ assetId: asset.id, reason: 'current-layer' }],
        candidates: [],
        fallback: [],
      },
    );
  }

  const character = project.characters.find(
    (candidate) => candidate.id === source.characterId,
  );
  if (!character) {
    throw new Error(`Cannot resolve Character ${source.characterId}.`);
  }
  const resolved = resolveCharacterFace(
    project,
    character,
    evaluated,
    source.expressionId,
  );
  const requiredAssetIds = new Set<string>();
  const fallbackAssetIds = new Set<string>();

  if (character.mode === 'single-image') {
    requiredAssetIds.add(resolved.face.assetId);
    if (resolved.face.fallbackAssetId) {
      fallbackAssetIds.add(resolved.face.fallbackAssetId);
    }
    const part: LayerVisualPart = {
      partId: `${layer.id}:single`,
      ownerLayerId: layer.id,
      slot: 'single',
      source:
        resolved.face.source === 'mouth'
          ? { kind: 'character-mouth', assetId: resolved.asset.id }
          : {
              kind: 'character-expression',
              expressionId: resolved.face.currentExpressionId,
              assetId: resolved.asset.id,
            },
      assetId: resolved.asset.id,
      localRect: centeredRect(resolved.asset),
      drawOrder: 0,
      ownerZIndex: evaluated.zIndex,
    };
    return baseResult(
      evaluated,
      'single-image-character',
      null,
      [part],
      resolved.face,
      characterResources(
        project,
        character,
        resolved.face,
        requiredAssetIds,
        fallbackAssetIds,
      ),
    );
  }

  const body = imageAsset(project, character.bodyAssetId, layer.id);
  requiredAssetIds.add(body.id);
  requiredAssetIds.add(resolved.face.assetId);
  if (resolved.face.fallbackAssetId) {
    fallbackAssetIds.add(resolved.face.fallbackAssetId);
  }
  const bodyPart: LayerVisualPart = {
    partId: `${layer.id}:body`,
    ownerLayerId: layer.id,
    slot: 'body',
    source: { kind: 'character-body', assetId: body.id },
    assetId: body.id,
    localRect: centeredRect(body),
    drawOrder: 0,
    ownerZIndex: evaluated.zIndex,
  };
  const facePart: LayerVisualPart = {
    partId: `${layer.id}:face`,
    ownerLayerId: layer.id,
    slot: 'face',
    source:
      resolved.face.source === 'mouth'
        ? { kind: 'character-mouth', assetId: resolved.asset.id }
        : {
            kind: 'character-expression',
            expressionId: resolved.face.currentExpressionId,
            assetId: resolved.asset.id,
          },
    assetId: resolved.asset.id,
    localRect: centeredRect(
      resolved.asset,
      character.facePlacement.offsetX,
      character.facePlacement.offsetY,
      character.facePlacement.scale,
    ),
    drawOrder: 1,
    ownerZIndex: evaluated.zIndex,
  };
  return baseResult(
    evaluated,
    'composite-character',
    { ...character.facePlacement },
    [bodyPart, facePart],
    resolved.face,
    characterResources(
      project,
      character,
      resolved.face,
      requiredAssetIds,
      fallbackAssetIds,
    ),
  );
}

/** Resolves all evaluated layers through the same production boundary. */
export function resolveShotVisualParts(
  project: Project,
  shot: { layers: readonly Layer[] },
  evaluated: EvaluatedShot,
): LayerVisualParts[] {
  return evaluated.layers.map((layer) =>
    resolveLayerVisualParts(project, shot, layer),
  );
}
