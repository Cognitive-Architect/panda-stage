import type {
  EvaluatedHeadGroupTransform,
  EvaluatedLayer,
  EvaluatedShot,
} from '../evaluate-shot-at-time';
import type {
  CharacterPartTransform,
  FacePlacement,
  ImageAsset,
  Layer,
  Project,
} from '../models';
import { resolveImageAsset } from './canvasLayers';

export type LayerVisualKind =
  | 'ordinary-image'
  | 'single-image-character'
  | 'composite-character'
  | 'adaptive-parts-character'
  | 'unsupported-character';

export type VisualPartSlot =
  | 'single'
  | 'body'
  | 'head'
  | 'face'
  | 'adaptive-part';

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

export type VisualHeadGroupTransform = EvaluatedHeadGroupTransform;

export interface LayerVisualHeadGroup {
  /** Stable runtime identity; never persisted as a Project Layer. */
  id: string;
  /** Character-local pivot shared by Head and Face/Mouth. */
  pivot: { x: number; y: number };
  /** Runtime children in draw order. Body is deliberately excluded. */
  partIds: string[];
  transform: VisualHeadGroupTransform;
}

export interface VisualPoint {
  x: number;
  y: number;
}

export interface VisualHeadGroupRenderTransform {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface VisualPartRenderTransform {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX?: number;
  skewY?: number;
}

export type VisualPartSource =
  | { kind: 'asset'; assetId: string }
  | { kind: 'character-body'; assetId: string }
  | { kind: 'character-head'; assetId: string }
  | { kind: 'character-expression'; expressionId: string; assetId: string }
  | { kind: 'character-mouth'; assetId: string }
  | { kind: 'adaptive-part'; characterPartId: string; assetId: string };

export interface LayerVisualPart {
  /** Stable runtime identity; never persisted as a Project Layer. */
  partId: string;
  ownerLayerId: string;
  slot: VisualPartSlot;
  source: VisualPartSource;
  assetId: string;
  localRect: VisualLocalRect;
  /** Static rotation about this part's center, before the shared Head Group. */
  rotationDeg: number;
  /** Static horizontal mirror about this part's center. */
  flipX: boolean;
  /** Optional exact source-pixel-to-Character affine, used by Adaptive Parts. */
  imageTransform?: CharacterPartTransform;
  /** Persisted visibility for an Adaptive Part; other visual kinds default visible. */
  visible?: boolean;
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
  | 'head'
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
  /** Exactly one part for ordinary/single-image; Body + optional Head + Face for composite. */
  parts: LayerVisualPart[];
  /** Internal visual group; null for single-image and headless layers. */
  headGroup: LayerVisualHeadGroup | null;
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

const IDENTITY_HEAD_GROUP_TRANSFORM: VisualHeadGroupTransform = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
};

/**
 * Maps the Character-local Head Group transform to Konva's position/offset
 * convention. Both Canvas and the shared Stage consume this same mapping.
 */
export function visualHeadGroupRenderTransform(
  group: LayerVisualHeadGroup,
): VisualHeadGroupRenderTransform {
  return {
    x: group.pivot.x + group.transform.translateX,
    y: group.pivot.y + group.transform.translateY,
    offsetX: group.pivot.x,
    offsetY: group.pivot.y,
    scaleX: group.transform.scaleX,
    scaleY: group.transform.scaleY,
    rotation: group.transform.rotationDeg,
  };
}

/** Maps one static visual part to a center-based Konva transform. */
export function visualPartRenderTransform(
  part: LayerVisualPart,
): VisualPartRenderTransform {
  if (part.imageTransform) {
    const { a, b, c, d, tx, ty } = part.imageTransform;
    const determinant = a * d - b * c;
    const scaleX = Math.hypot(a, b);
    if (
      !Number.isFinite(determinant) ||
      !Number.isFinite(scaleX) ||
      Math.abs(determinant) < 1e-12 ||
      scaleX < 1e-12
    ) {
      throw new Error(`Adaptive Part ${part.partId} has an invalid affine transform.`);
    }
    const rotation = (Math.atan2(b, a) * 180) / Math.PI;
    const scaleY = determinant / scaleX;
    // Konva's Transform.skew expects unitless shear coefficients. With its
    // translate → rotate → skew → scale order, this coefficient reconstructs
    // the original second column for both positive and negative determinants.
    const skewX = (a * c + b * d) / determinant;
    return {
      x: tx,
      y: ty,
      offsetX: 0,
      offsetY: 0,
      scaleX,
      scaleY,
      rotation,
      ...(Math.abs(skewX) > 1e-10 ? { skewX } : {}),
    };
  }
  if (part.rotationDeg === 0 && !part.flipX) {
    return {
      x: part.localRect.x,
      y: part.localRect.y,
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
  }
  return {
    x: part.localRect.x + part.localRect.width / 2,
    y: part.localRect.y + part.localRect.height / 2,
    offsetX: part.localRect.width / 2,
    offsetY: part.localRect.height / 2,
    scaleX: part.flipX ? -1 : 1,
    scaleY: 1,
    rotation: part.rotationDeg,
  };
}

/** Applies the runtime Head Group transform to a Character-local point. */
export function transformPointByVisualHeadGroup(
  point: VisualPoint,
  group: LayerVisualHeadGroup,
): VisualPoint {
  const radians = (group.transform.rotationDeg * Math.PI) / 180;
  const relativeX = (point.x - group.pivot.x) * group.transform.scaleX;
  const relativeY = (point.y - group.pivot.y) * group.transform.scaleY;
  return {
    x:
      group.pivot.x +
      group.transform.translateX +
      relativeX * Math.cos(radians) -
      relativeY * Math.sin(radians),
    y:
      group.pivot.y +
      group.transform.translateY +
      relativeX * Math.sin(radians) +
      relativeY * Math.cos(radians),
  };
}

function transformedRect(
  rect: VisualLocalRect,
  group: LayerVisualHeadGroup,
): VisualLocalRect {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => transformPointByVisualHeadGroup(point, group));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function transformPointByVisualPart(
  point: VisualPoint,
  part: Pick<
    LayerVisualPart,
    'localRect' | 'rotationDeg' | 'flipX' | 'imageTransform'
  >,
): VisualPoint {
  if (part.imageTransform) {
    const matrix = part.imageTransform;
    return {
      x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
      y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
    };
  }
  const centerX = part.localRect.x + part.localRect.width / 2;
  const centerY = part.localRect.y + part.localRect.height / 2;
  let relativeX = point.x - centerX;
  const relativeY = point.y - centerY;
  if (part.flipX) relativeX = -relativeX;
  const radians = (part.rotationDeg * Math.PI) / 180;
  return {
    x: centerX + relativeX * Math.cos(radians) - relativeY * Math.sin(radians),
    y: centerY + relativeX * Math.sin(radians) + relativeY * Math.cos(radians),
  };
}

export function transformVisualRectByPart(
  rect: VisualLocalRect,
  part: Pick<
    LayerVisualPart,
    'localRect' | 'rotationDeg' | 'flipX' | 'imageTransform'
  >,
): VisualLocalRect {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => transformPointByVisualPart(point, part));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function transformedPartRect(part: LayerVisualPart): VisualLocalRect {
  return transformVisualRectByPart(part.localRect, part);
}

function visualBounds(
  parts: readonly LayerVisualPart[],
  headGroup: LayerVisualHeadGroup | null,
): VisualLocalRect {
  const visibleParts = parts.filter((part) => part.visible !== false);
  if (visibleParts.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const headPartIds = new Set(headGroup?.partIds ?? []);
  return unionRects(
    visibleParts.map((part) => {
      const transformedPart = transformedPartRect(part);
      return headPartIds.has(part.partId) && headGroup
        ? transformedRect(transformedPart, headGroup)
        : transformedPart;
    }),
  );
}

/**
 * Returns a visual with an ephemeral local Head Group transform. Persisted
 * Head placement and Face placement remain Character-local and unchanged.
 */
export function withVisualHeadGroupTransform(
  visual: LayerVisualParts,
  transform: VisualHeadGroupTransform,
): LayerVisualParts {
  if (!visual.headGroup) return visual;
  const headGroup = {
    ...visual.headGroup,
    transform: { ...transform },
  };
  return {
    ...visual,
    headGroup,
    combinedLocalBounds: visualBounds(visual.parts, headGroup),
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
  headAssetId: string | null,
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
      assetId === headAssetId
        ? 'head'
        : assetId === activeFace.assetId && activeFace.source === 'mouth'
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

type AdaptivePartsCharacter = Extract<
  Project['characters'][number],
  { mode: 'adaptive-parts' }
>;

function adaptivePartVisuals(
  project: Project,
  character: AdaptivePartsCharacter,
  ownerLayerId: string,
  ownerZIndex: number,
): LayerVisualPart[] {
  return character.parts.map((part): LayerVisualPart => {
    const asset = imageAsset(project, part.assetId, ownerLayerId);
    const mapping = part.imageMapping;
    const expectedWidth = Math.round(mapping.crop.width * mapping.exportScale);
    const expectedHeight = Math.round(mapping.crop.height * mapping.exportScale);
    if (asset.width !== expectedWidth || asset.height !== expectedHeight) {
      throw new Error(
        `Adaptive Part ${part.partId} crop resolves to ${expectedWidth}x${expectedHeight}, but asset ${asset.id} is ${asset.width}x${asset.height}.`,
      );
    }
    const cropToSource: CharacterPartTransform = {
      a: 1 / mapping.exportScale,
      b: 0,
      c: 0,
      d: 1 / mapping.exportScale,
      tx: mapping.crop.x,
      ty: mapping.crop.y,
    };
    const imageTransform = composeAffine(
      character.sourceRootTransform,
      composeAffine(part.restTransform, cropToSource),
    );
    return {
      partId: `${ownerLayerId}:${part.partId}`,
      ownerLayerId,
      slot: 'adaptive-part',
      source: {
        kind: 'adaptive-part',
        characterPartId: part.partId,
        assetId: asset.id,
      },
      assetId: asset.id,
      localRect: {
        x: 0,
        y: 0,
        width: asset.width,
        height: asset.height,
      },
      rotationDeg: 0,
      flipX: false,
      imageTransform,
      visible: part.visible,
      drawOrder: part.drawOrder,
      ownerZIndex,
    };
  });
}

/** Returns the source-stage visual center used by a center-anchored Shot Layer. */
export function adaptiveCharacterSourceAnchor(
  project: Project,
  character: AdaptivePartsCharacter,
): VisualPoint {
  const bounds = visualBounds(
    adaptivePartVisuals(project, character, character.id, 0),
    null,
  );
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function baseResult(
  evaluated: EvaluatedLayer,
  kind: LayerVisualKind,
  facePlacement: FacePlacement | null,
  parts: LayerVisualPart[],
  activeFace: ActiveCharacterFace | null,
  resources: LayerVisualResources,
  headGroup: LayerVisualHeadGroup | null = null,
): LayerVisualParts {
  return {
    ownerLayerId: evaluated.id,
    kind,
    ownerTransform: ownerTransform(evaluated),
    facePlacement,
    parts,
    headGroup,
    combinedLocalBounds: visualBounds(parts, headGroup),
    activeFace,
    resources,
  };
}

function composeAffine(
  outer: CharacterPartTransform,
  inner: CharacterPartTransform,
): CharacterPartTransform {
  const result = {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
  if (Object.values(result).some((value) => !Number.isFinite(value))) {
    throw new Error('Adaptive Part transform composition is not finite.');
  }
  return result;
}

/**
 * Resolves one logical Layer into its complete runtime visual parts.
 *
 * The returned part identities are ephemeral and stay under the one logical
 * owner Layer. Local geometry deliberately excludes the owner transform: Body
 * uses its Character-local placement, while Head and Face use their existing
 * Character-local placements. Head and Face share one internal Head Group.
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
      rotationDeg: 0,
      flipX: false,
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
  if (character.mode === 'adaptive-parts') {
    const sourceParts = adaptivePartVisuals(
      project,
      character,
      layer.id,
      evaluated.zIndex,
    );
    // Adaptive source coordinates may be absolute to the imported stage. The
    // persisted Layer is center anchored, so express the composed Part layout
    // around the visible Character bounds center. Placement stores that same
    // source-stage center on the Layer, preserving the imported pose while
    // keeping owner scale/mirror/rotation around the visual pivot.
    const sourceBounds = visualBounds(sourceParts, null);
    const sourceCenterX = sourceBounds.x + sourceBounds.width / 2;
    const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
    const parts = sourceParts.map((part) => ({
      ...part,
      imageTransform: {
        ...part.imageTransform!,
        tx: part.imageTransform!.tx - sourceCenterX,
        ty: part.imageTransform!.ty - sourceCenterY,
      },
    }));
    return baseResult(
      evaluated,
      'adaptive-parts-character',
      null,
      parts,
      null,
      {
        required: [...new Set(parts.map((part) => part.assetId))].map(
          (assetId) => ({ assetId, reason: 'current-layer' as const }),
        ),
        candidates: [],
        fallback: [],
      },
    );
  }
  const resolved = resolveCharacterFace(
    project,
    character,
    evaluated,
    source.expressionId ?? character.defaultExpressionId,
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
      rotationDeg: 0,
      flipX: false,
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
        null,
        requiredAssetIds,
        fallbackAssetIds,
      ),
    );
  }

  const body = imageAsset(project, character.bodyAssetId, layer.id);
  requiredAssetIds.add(body.id);
  const headAsset = character.head
    ? imageAsset(project, character.head.assetId, layer.id)
    : null;
  if (headAsset) requiredAssetIds.add(headAsset.id);
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
    localRect: centeredRect(
      body,
      character.bodyPlacement.offsetX,
      character.bodyPlacement.offsetY,
      character.bodyPlacement.scale,
    ),
    rotationDeg: 0,
    flipX: false,
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
    rotationDeg: character.facePlacement.rotationDeg,
    flipX: character.facePlacement.flipX,
    drawOrder: headAsset ? 2 : 1,
    ownerZIndex: evaluated.zIndex,
  };
  const headPart: LayerVisualPart | null =
    headAsset && character.head
      ? {
          partId: `${layer.id}:head`,
          ownerLayerId: layer.id,
          slot: 'head',
          source: { kind: 'character-head', assetId: headAsset.id },
          assetId: headAsset.id,
          localRect: centeredRect(
            headAsset,
            character.head.placement.offsetX,
            character.head.placement.offsetY,
            character.head.placement.scale,
          ),
          rotationDeg: character.head.placement.rotationDeg,
          flipX: character.head.placement.flipX,
          drawOrder: 1,
          ownerZIndex: evaluated.zIndex,
        }
      : null;
  const parts = [bodyPart, ...(headPart ? [headPart] : []), facePart];
  const headGroup: LayerVisualHeadGroup | null =
    headPart && character.head
      ? {
          id: `${layer.id}:head-group`,
          pivot: { ...character.head.pivot },
          partIds: [headPart.partId, facePart.partId],
          transform: {
            ...(evaluated.headGroupTransform ?? IDENTITY_HEAD_GROUP_TRANSFORM),
          },
        }
      : null;
  return baseResult(
    evaluated,
    'composite-character',
    { ...character.facePlacement },
    parts,
    resolved.face,
    characterResources(
      project,
      character,
      resolved.face,
      headAsset?.id ?? null,
      requiredAssetIds,
      fallbackAssetIds,
    ),
    headGroup,
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
