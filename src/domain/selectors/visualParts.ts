import {
  hasFlaGraphicTemporalPlayback,
  resolveAnimationPlaybackFrameState,
  type EvaluatedHeadGroupTransform,
  type EvaluatedLayer,
  type EvaluatedShot,
} from '../evaluate-shot-at-time';
import {
  isFlaGraphicDefinition,
  resolveCharacterPartVisualSource,
  resolveExpressionVisualSource,
  resolveMouthVisualSource,
  type CharacterFaceSource,
  type CharacterPartTransform,
  type CharacterPart,
  type FacePlacement,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Layer,
  type Project,
} from '../models';
import {
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicVisual,
} from '../evaluate-fla-graphic';
import { selectFlaGraphicSubtreeVisual } from '../fla-graphic-subtree';
import { resolveImageAsset } from './canvasLayers';
import {
  characterPartRegionAnchorBounds,
  characterPartSourceBounds,
  composeAdaptiveFaceReplacementMatrix,
  stripCropTransformFromAdaptivePartMatrix,
} from '../geometry/characterPartLayout';
import {
  captureCharacterPartAnimationBasis, composeAnimatedCharacterPartTransform, resolveLayeredCharacterPartTransforms,
} from '../character-part-animation';
import {
  evaluateCompositeFacePoseAtTime,
  type EvaluatedCharacterNodePose,
} from '../character-node-animation';
import { sameAnimationTarget } from '../models/animationCore';
import {
  resolveCharacterFaceSource,
  resolveCharacterFaceSourceOrNull,
  findTalkingAnimation,
  listCharacterTalkingSources,
  listTalkingAnimationImageIds,
  resolveCharacterTalkingFace,
} from './characterFaceSource';

export type LayerVisualKind =
  | 'ordinary-image'
  | 'single-image-character'
  | 'composite-character'
  | 'adaptive-parts-character'
  | 'fla-graphic'
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
  | { kind: 'character-face-fla-graphic'; animationId: string; firstFrame: number }
  | { kind: 'asset'; assetId: string }
  | { kind: 'animation-frame'; animationId: string; assetId: string }
  | { kind: 'character-body'; assetId: string }
  | { kind: 'character-head'; assetId: string }
  | { kind: 'character-expression'; expressionId: string; assetId: string }
  | { kind: 'character-mouth'; assetId: string }
  | { kind: 'adaptive-part'; characterPartId: string; assetId: string }
  | {
      kind: 'adaptive-part-fla-graphic';
      characterPartId: string;
      animationId: string;
    };

export interface LayerVisualPart {
  /** Stable runtime identity; never persisted as a Project Layer. */
  partId: string;
  ownerLayerId: string;
  slot: VisualPartSlot;
  source: VisualPartSource;
  assetId?: string;
  /** Per-part structured FLA Graphic visual when sourced from an FLA Graphic Definition. */
  flaGraphic?: EvaluatedFlaGraphicVisual;
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
  visualSource?: CharacterFaceSource;
  fallbackVisualSource?: CharacterFaceSource;
  mouthResourceAssetIds?: readonly string[];
  currentExpressionId: string;
  currentExpressionAssetId: string;
  source: 'expression' | 'mouth';
  assetId: string;
  configuredMouthAssetId: string | null;
  /** The current Expression resource to use if the active Mouth cannot load. */
  fallbackAssetId: string | null;
  /** An Adaptive Parts image replacement can be dropped to reveal its original parts. */
  originalPartsFallback?: {
    partId: string;
    assetIds: readonly string[];
  };
}

export type VisualResourceReason =
  | 'current-layer'
  | 'body'
  | 'head'
  | 'active-expression'
  | 'active-mouth'
  | 'alternate-expression'
  | 'mouth-override'
  | 'current-expression-fallback'
  | 'animation-frame'
  | 'fla-graphic-resource';

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
  /** Exact per-frame Definition/Instance result for structured FLA Graphics. */
  flaGraphic?: EvaluatedFlaGraphicVisual;
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
  asset: Pick<ImageAsset, 'width' | 'height'>,
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
  includeHidden = false,
): VisualLocalRect {
  const boundedParts = includeHidden
    ? parts
    : parts.filter((part) => part.visible !== false);
  if (boundedParts.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const headPartIds = new Set(headGroup?.partIds ?? []);
  return unionRects(
    boundedParts.map((part) => {
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
    const resolved = resolveCharacterFaceSource(project, resolveExpressionVisualSource(expression));
    for (const assetId of resolved.flaGraphic?.resourceAssetIds ?? (resolved.assetId ? [resolved.assetId] : [])) {
      if (!requiredAssetIds.has(assetId) && !fallbackAssetIds.has(assetId) && resolveImageAsset(project, assetId)) addResource(candidates, assetId, 'alternate-expression');
    }
  }
  const mouth = resolveMouthVisualSource(character);
  if (mouth?.kind === 'fla-graphic') {
    const resolved = resolveCharacterFaceSource(project, mouth);
    for (const assetId of resolved.flaGraphic?.resourceAssetIds ?? []) {
      if (!requiredAssetIds.has(assetId) && !fallbackAssetIds.has(assetId) && resolveImageAsset(project, assetId)) addResource(candidates, assetId, 'mouth-override');
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

  for (const { animationId } of listCharacterTalkingSources(character)) {
    const talking = findTalkingAnimation(project, animationId);
    if (!talking) continue;
    for (const assetId of listTalkingAnimationImageIds(talking)) {
      if (!required.has(assetId) && !fallback.has(assetId) && resolveImageAsset(project, assetId)) {
        addResource(candidates, assetId, 'mouth-override');
      }
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
  isImageUnavailable?: (assetId: string) => boolean,
): { face: ActiveCharacterFace; visualSource: CharacterFaceSource; asset: ReturnType<typeof resolveCharacterFaceSource>; fallback: ReturnType<typeof resolveCharacterFaceSource> | null } {
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
  const expressionSource = resolveExpressionVisualSource(expression);
  const expressionAsset = resolveCharacterFaceSource(project, expressionSource);
  const poseSource = evaluated.mouthPose?.source;
  const poseAsset = poseSource ? resolveCharacterFaceSourceOrNull(project, poseSource) : null;
  const talking = resolveCharacterTalkingFace(project, character, expression.id, evaluated.talkingAnimationElapsedMs, isImageUnavailable);
  const requestedMouth = (poseAsset ? poseSource : undefined) ?? talking?.source ?? (evaluated.mouthOverrideAssetId
    ? { kind: 'image' as const, assetId: evaluated.mouthOverrideAssetId }
    : evaluated.mouthOpen ? resolveMouthVisualSource(character) : null);
  const mouthSource = requestedMouth?.kind === 'image' && !resolveImageAsset(project, requestedMouth.assetId) ? null : requestedMouth;
  const mouthAsset = mouthSource ? poseAsset ?? talking?.asset ?? resolveCharacterFaceSourceOrNull(project, mouthSource) : null;
  const activeAsset = mouthAsset ?? expressionAsset;
  const source = mouthAsset ? 'mouth' : 'expression';
  return {
    face: {
      currentExpressionId: expression.id,
      ...((mouthSource ?? expressionSource).kind === 'fla-graphic' ? { visualSource: mouthSource ?? expressionSource } : {}),
      ...(mouthAsset?.flaGraphic ? { mouthResourceAssetIds: mouthAsset.flaGraphic.resourceAssetIds } : {}),
      ...(mouthSource && expressionSource.kind === 'fla-graphic' ? { fallbackVisualSource: expressionSource } : {}),
      currentExpressionAssetId: expressionAsset.assetId ?? '',
      source,
      assetId: activeAsset.assetId ?? '',
      configuredMouthAssetId: character.mouthOpenAssetId ?? null,
      fallbackAssetId: mouthAsset ? expressionAsset.assetId ?? null : null,
    },
    asset: activeAsset,
    visualSource: mouthSource ?? expressionSource,
    fallback: mouthAsset ? expressionAsset : null,
  };
}

function facePixelGeometry(
  project: Project,
  asset: ReturnType<typeof resolveCharacterFaceSource>,
  ownerLayerId: string,
): {
  pixelToCanvas: CharacterPartTransform;
  localRect: VisualLocalRect;
  assetId?: string;
  flaGraphic?: EvaluatedFlaGraphicVisual;
} {
  const graphic = asset.flaGraphic;
  if (asset.rasterFrame) {
    const { offset, sourceViewport } = asset.rasterFrame;
    const image = imageAsset(project, asset.rasterFrame.assetId, ownerLayerId);
    return {
      assetId: image.id,
      localRect: { x: 0, y: 0, width: image.width, height: image.height },
      pixelToCanvas: {
        a: sourceViewport.width / image.width,
        b: 0,
        c: 0,
        d: sourceViewport.height / image.height,
        tx: offset.x - asset.width / 2,
        ty: offset.y - asset.height / 2,
      },
    };
  }
  if (!graphic) {
    return {
      pixelToCanvas: {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: -asset.width / 2,
        ty: -asset.height / 2,
      },
      localRect: { x: 0, y: 0, width: asset.width, height: asset.height },
      ...(asset.assetId ? { assetId: asset.assetId } : {}),
    };
  }
  const fallback = graphic.structureFrame
    ? null
    : imageAsset(project, graphic.frameAssetId, ownerLayerId);
  const pixelToCanvas = fallback
    ? {
        a: graphic.frameViewport.width / fallback.width,
        b: 0,
        c: 0,
        d: graphic.frameViewport.height / fallback.height,
        tx: graphic.frameOffset.x - asset.width / 2,
        ty: graphic.frameOffset.y - asset.height / 2,
      }
    : {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: -asset.width / 2,
        ty: -asset.height / 2,
      };
  return {
    pixelToCanvas,
    localRect: {
      x: 0,
      y: 0,
      width: fallback?.width ?? asset.width,
      height: fallback?.height ?? asset.height,
    },
    ...(fallback ? { assetId: fallback.id } : {}),
    ...(graphic.structureFrame ? { flaGraphic: graphic } : {}),
  };
}

function faceVisualPart(project: Project, resolved: ReturnType<typeof resolveCharacterFace>, evaluated: EvaluatedLayer, slot: 'single' | 'face', placement: EvaluatedCharacterNodePose, drawOrder: number): LayerVisualPart {
  const { asset, face } = resolved;
  const graphic = asset.flaGraphic;
  const width = asset.width * placement.scaleX;
  const height = asset.height * placement.scaleY;
  const rect = {
    x: placement.offsetX - width / 2,
    y: placement.offsetY - height / 2,
    width,
    height,
  };
  const part: LayerVisualPart = {
    partId: `${evaluated.id}:${slot}`, ownerLayerId: evaluated.id, slot,
    source: resolved.visualSource.kind === 'fla-graphic'
      ? { kind: 'character-face-fla-graphic', animationId: resolved.visualSource.animationId, firstFrame: resolved.visualSource.firstFrame }
      : face.source === 'mouth' ? { kind: 'character-mouth', assetId: resolved.visualSource.assetId }
      : { kind: 'character-expression', expressionId: face.currentExpressionId, assetId: resolved.visualSource.assetId },
    ...(asset.assetId ? { assetId: asset.assetId } : {}),
    ...(graphic?.structureFrame ? { flaGraphic: graphic } : {}),
    localRect: rect, rotationDeg: placement.rotationDeg, flipX: placement.flipX,
    drawOrder, ownerZIndex: evaluated.zIndex,
  };
  if (graphic || asset.rasterFrame) {
    // Center/rotate/mirror the full source canvas; cropped fallback pixels do
    // not redefine the face pivot. Structure uses exactly the same affine.
    const angle = placement.rotationDeg * Math.PI / 180;
    const sx = placement.scaleX * (placement.flipX ? -1 : 1), sy = placement.scaleY;
    const matrix = { a: Math.cos(angle) * sx, b: Math.sin(angle) * sx, c: -Math.sin(angle) * sy, d: Math.cos(angle) * sy, tx: placement.offsetX, ty: placement.offsetY };
    const geom = facePixelGeometry(project, asset, evaluated.id);
    part.imageTransform = composeAffine(matrix, geom.pixelToCanvas);
    part.localRect = geom.localRect;
    part.rotationDeg = 0; part.flipX = false;
  }
  return part;
}

function isResolvedFaceRenderable(
  asset: ReturnType<typeof resolveCharacterFaceSource> | null,
  validImageAssetIds: ReadonlySet<string>,
): asset is ReturnType<typeof resolveCharacterFaceSource> {
  if (!asset) return false;
  if (!asset.flaGraphic) {
    return Boolean(asset.assetId && validImageAssetIds.has(asset.assetId));
  }
  if (!asset.flaGraphic.structureFrame) {
    return validImageAssetIds.has(asset.flaGraphic.frameAssetId);
  }
  return true;
}

function adaptivePartIdOfSource(source: VisualPartSource): string | undefined {
  return source.kind === 'adaptive-part' || source.kind === 'adaptive-part-fla-graphic'
    ? source.characterPartId
    : undefined;
}

function projectAdaptivePartsFaceVisual(input: {
  readonly project: Project;
  readonly character: AdaptivePartsCharacter;
  readonly visualDefinition: AdaptivePartVisualDefinition;
  readonly parts: LayerVisualPart[];
  readonly evaluated: EvaluatedLayer;
  readonly sourceExpressionId?: string;
  readonly validImageAssetIds: ReadonlySet<string>;
  readonly isImageUnavailable?: (assetId: string) => boolean;
  readonly expressionOnly?: boolean;
  readonly preservePartId?: string;
}): {
  readonly parts: LayerVisualPart[];
  readonly activeFace: ActiveCharacterFace | null;
  readonly fallbackAssetIds: ReadonlySet<string>;
} {
  const {
    project,
    character,
    visualDefinition,
    parts: inputParts,
    evaluated,
    sourceExpressionId,
    validImageAssetIds,
    isImageUnavailable,
  } = input;
  const faceBinding = character.faceBinding;
  const poseSource = input.expressionOnly ? undefined : evaluated.mouthPose?.source;
  const resolvedPose = poseSource ? resolveCharacterFaceSourceOrNull(project, poseSource) : null;
  const poseAsset = resolvedPose?.assetId && isImageUnavailable?.(resolvedPose.assetId) ? null : resolvedPose;
  const independentTarget = evaluated.mouthPose?.target.kind === 'mouth' &&
    isResolvedFaceRenderable(poseAsset, validImageAssetIds)
    ? evaluated.mouthPose.target.partId : undefined;
  const expressionProjection = independentTarget && independentTarget !== faceBinding?.targetPartId &&
    inputParts.some((part) => adaptivePartIdOfSource(part.source) === independentTarget)
    ? projectAdaptivePartsFaceVisual({ ...input, expressionOnly: true, preservePartId: independentTarget }) : undefined;
  const parts = expressionProjection?.parts ?? inputParts;
  const fallbackAssetIds = new Set(expressionProjection?.fallbackAssetIds);
  const targetPartId = independentTarget ?? faceBinding?.targetPartId;
  if (!targetPartId) {
    return { parts, activeFace: null, fallbackAssetIds };
  }
  const targetPartIndex = parts.findIndex(
    (part) => adaptivePartIdOfSource(part.source) === targetPartId,
  );
  const targetDefinitionPart = visualDefinition.parts.find(
    (part) => part.partId === targetPartId,
  );
  if (targetPartIndex === -1 || !targetDefinitionPart) {
    return { parts, activeFace: null, fallbackAssetIds };
  }

  const expressions = character.expressions ?? [];
  const requestedExpressionId =
    evaluated.currentExpressionId ?? sourceExpressionId ?? character.defaultExpressionId;
  const expression =
    (requestedExpressionId
      ? expressions.find((candidate) => candidate.id === requestedExpressionId)
      : undefined) ??
    (character.defaultExpressionId
      ? expressions.find((candidate) => candidate.id === character.defaultExpressionId)
      : undefined);

  const expressionSource = expression ? resolveExpressionVisualSource(expression) : null;
  const rawExpressionAsset = expressionSource
    ? resolveCharacterFaceSourceOrNull(project, expressionSource)
    : null;
  const expressionAsset = isResolvedFaceRenderable(rawExpressionAsset, validImageAssetIds)
    ? rawExpressionAsset
    : null;

  const talking = input.expressionOnly ? null : resolveCharacterTalkingFace(project, character, expression?.id, evaluated.talkingAnimationElapsedMs, isImageUnavailable);
  const requestedMouth = input.expressionOnly ? null : (poseAsset ? poseSource : undefined) ?? talking?.source ?? (evaluated.mouthOverrideAssetId
    ? ({ kind: 'image', assetId: evaluated.mouthOverrideAssetId } as const)
    : evaluated.mouthOpen
      ? resolveMouthVisualSource(character)
      : null);
  const rawMouthAsset = poseAsset ?? talking?.asset ?? (requestedMouth
    ? resolveCharacterFaceSourceOrNull(project, requestedMouth)
    : null);
  const mouthAsset = isResolvedFaceRenderable(rawMouthAsset, validImageAssetIds)
    ? rawMouthAsset
    : null;

  const chosenSource = mouthAsset ? requestedMouth! : expressionAsset ? expressionSource! : null;
  const chosenAsset = mouthAsset ?? expressionAsset;
  const chosenKind: 'mouth' | 'expression' | null = mouthAsset
    ? 'mouth'
    : expressionAsset
      ? 'expression'
      : null;

  const collectAssetIds = (resolved: ReturnType<typeof resolveCharacterFaceSource> | null): void => {
    if (!resolved) return;
    if (resolved.flaGraphic) {
      for (const id of resolved.flaGraphic.resourceAssetIds) {
        if (validImageAssetIds.has(id)) fallbackAssetIds.add(id);
      }
      if (!resolved.flaGraphic.structureFrame && validImageAssetIds.has(resolved.flaGraphic.frameAssetId)) {
        fallbackAssetIds.add(resolved.flaGraphic.frameAssetId);
      }
    } else if (resolved.assetId && validImageAssetIds.has(resolved.assetId)) {
      fallbackAssetIds.add(resolved.assetId);
    }
  };
  if (chosenKind === 'mouth') {
    collectAssetIds(expressionAsset);
  }
  const replaceSet = new Set(independentTarget ? [] : faceBinding?.replacePartIds ?? []);
  if (input.preservePartId) replaceSet.delete(input.preservePartId);
  for (const part of parts) {
    const partCharId = adaptivePartIdOfSource(part.source);
    if (partCharId === targetPartId || (partCharId !== undefined && replaceSet.has(partCharId))) {
      if (part.assetId && validImageAssetIds.has(part.assetId)) {
        fallbackAssetIds.add(part.assetId);
      }
      if (part.flaGraphic) {
        for (const id of part.flaGraphic.resourceAssetIds) {
          if (validImageAssetIds.has(id)) fallbackAssetIds.add(id);
        }
      }
    }
  }

  if (!chosenAsset || !chosenSource || !chosenKind) {
    return { parts, activeFace: null, fallbackAssetIds };
  }

  const targetVisual = parts[targetPartIndex]!;
  if (!targetVisual.imageTransform) {
    return { parts, activeFace: null, fallbackAssetIds };
  }
  const canRestoreOriginalParts =
    expressionAsset &&
    expressionSource?.kind === 'image' &&
    !parts.some((part) =>
      part.assetId === expressionSource.assetId ||
      part.flaGraphic?.resourceAssetIds.includes(expressionSource.assetId),
    );
  if (chosenKind === 'expression' && canRestoreOriginalParts && isImageUnavailable?.(expressionSource.assetId)) {
    return { parts, activeFace: null, fallbackAssetIds };
  }
  const targetBaseTransform = independentTarget ? targetVisual.imageTransform : stripCropTransformFromAdaptivePartMatrix(
    targetDefinitionPart,
    targetVisual.imageTransform,
  );
  const placementMatrix = composeAdaptiveFaceReplacementMatrix({
    targetBaseTransform,
    anchorRect: independentTarget ? targetVisual.localRect : faceBinding!.anchorRect,
    placement: independentTarget ? { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0, flipX: false } : faceBinding!.placement,
    resolvedWidth: chosenAsset.width,
    resolvedHeight: chosenAsset.height,
  });
  const geom = facePixelGeometry(project, chosenAsset, evaluated.id);
  const replacedImageTransform = composeAffine(placementMatrix, geom.pixelToCanvas);

  const replacedTarget: LayerVisualPart = {
    partId: targetVisual.partId,
    ownerLayerId: targetVisual.ownerLayerId,
    slot: 'adaptive-part',
    source: chosenSource.kind === 'fla-graphic'
      ? {
          kind: 'adaptive-part-fla-graphic',
          characterPartId: targetPartId,
          animationId: chosenSource.animationId,
        }
      : {
          kind: 'adaptive-part',
          characterPartId: targetPartId,
          assetId: geom.assetId!,
        },
    ...(geom.assetId ? { assetId: geom.assetId } : {}),
    ...(geom.flaGraphic ? { flaGraphic: geom.flaGraphic } : {}),
    localRect: geom.localRect,
    rotationDeg: 0,
    flipX: false,
    imageTransform: replacedImageTransform,
    visible: targetVisual.visible,
    drawOrder: targetVisual.drawOrder,
    ownerZIndex: targetVisual.ownerZIndex,
  };

  const nextParts = parts.map((part, index) => {
    if (index === targetPartIndex) return replacedTarget;
    const partCharId = adaptivePartIdOfSource(part.source);
    if (partCharId !== undefined && replaceSet.has(partCharId)) {
      return { ...part, visible: false };
    }
    return part;
  });

  const activeFace: ActiveCharacterFace = {
    currentExpressionId: expression?.id ?? '',
    ...(chosenSource.kind === 'fla-graphic' ? { visualSource: chosenSource } : {}),
    ...(mouthAsset?.flaGraphic ? { mouthResourceAssetIds: mouthAsset.flaGraphic.resourceAssetIds } : {}),
    ...(chosenKind === 'mouth' && expressionSource?.kind === 'fla-graphic'
      ? { fallbackVisualSource: expressionSource }
      : {}),
    currentExpressionAssetId: expressionAsset?.assetId ?? '',
    source: chosenKind,
    assetId: chosenAsset.assetId ?? '',
    configuredMouthAssetId: character.mouthOpenAssetId ?? null,
    ...(canRestoreOriginalParts
      ? { originalPartsFallback: {
          partId: targetVisual.partId,
          assetIds: [...fallbackAssetIds].filter((id) => id !== expressionSource.assetId),
        } }
      : {}),
    fallbackAssetId:
      chosenKind === 'mouth'
        ? (expressionAsset?.assetId ?? null)
        : (targetVisual.assetId ?? null),
  };

  return { parts: nextParts, activeFace, fallbackAssetIds };
}

type AdaptivePartsCharacter = Extract<
  Project['characters'][number],
  { mode: 'adaptive-parts' }
>;

type AdaptivePartVisualDefinition = {
  sourceRootTransform: CharacterPartTransform;
  parts: readonly Pick<CharacterPart, 'partId' | 'visualSource' | 'assetId' | 'imageMapping' | 'restTransform' | 'visible' | 'drawOrder'>[];
};

function adaptivePartVisuals(
  project: Project,
  character: AdaptivePartVisualDefinition,
  ownerLayerId: string,
  ownerZIndex: number,
  layerStartTimeMs = 0,
  timeMs?: number,
): LayerVisualPart[] {
  return character.parts.map((part): LayerVisualPart => {
    const visualSource = resolveCharacterPartVisualSource(part);
    if (visualSource.kind === 'fla-graphic') {
      const definition = project.animations.find(
        (candidate) =>
          isFlaGraphicDefinition(candidate) &&
          candidate.id === visualSource.animationId,
      );
      if (
        !definition ||
        !isFlaGraphicDefinition(definition) ||
        (!definition.structure && !visualSource.nodePath)
      ) {
        throw new Error(
          `Adaptive Part ${part.partId} references unknown or unstructured FLA Graphic Definition: ${visualSource.animationId}.`,
        );
      }
      if (visualSource.nodePath || visualSource.regionRef || visualSource.regionVector) {
        const pinnedFrameOrdinal =
          visualSource.poseFrameOrdinal ?? (definition.frames[0]?.ordinal ?? 0);
        const evaluated = definition.structure && visualSource.nodePath
          ? evaluateFlaGraphicVisual({
              definition,
              frameOrdinal: pinnedFrameOrdinal,
              mode: 'instance',
              instanceTransformOverrides:
                visualSource.instanceTransformOverrides,
            })
          : null;
        const baseFrame = definition.frames.find(
          (candidate) => candidate.ordinal === pinnedFrameOrdinal,
        ) ?? definition.frames[0];
        const emptySubtreeVisual: EvaluatedFlaGraphicVisual = {
          mode: 'instance',
          frameOrdinal: pinnedFrameOrdinal,
          frameAssetId: evaluated?.frameAssetId ?? baseFrame?.assetId ?? '',
          frameOffset: evaluated?.frameOffset ?? baseFrame?.offset ?? { x: 0, y: 0 },
          frameViewport: evaluated?.frameViewport ?? baseFrame?.sourceViewport ?? {
            x: 0,
            y: 0,
            width: definition.source.canvas.width,
            height: definition.source.canvas.height,
          },
          canvas: definition.source.canvas,
          anchor: definition.source.anchor,
          structureFrame: {
            ordinal: pinnedFrameOrdinal,
            layers: [],
          },
          layers: [],
          resourceAssetIds: [],
        };
        const subtreeVisual =
          evaluated && evaluated.structureFrame && evaluated.layers && visualSource.nodePath
            ? selectFlaGraphicSubtreeVisual(
                evaluated,
                visualSource.nodePath,
                visualSource.regionVector || visualSource.regionRef
                  ? {
                      ...(visualSource.regionRef
                        ? { regionRef: visualSource.regionRef }
                        : {}),
                      ...(visualSource.regionVector
                        ? { regionVector: visualSource.regionVector }
                        : {}),
                    }
                  : undefined,
              )
            : emptySubtreeVisual;
        const tightBounds = characterPartSourceBounds(
          part,
          project.animations,
          project.assets,
        );
        const imageTransform = composeAffine(
          character.sourceRootTransform,
          part.restTransform,
        );
        return {
          partId: `${ownerLayerId}:${part.partId}`,
          ownerLayerId,
          slot: 'adaptive-part',
          source: {
            kind: 'adaptive-part-fla-graphic',
            characterPartId: part.partId,
            animationId: definition.id,
          },
          flaGraphic: subtreeVisual,
          localRect: tightBounds ?? {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
          rotationDeg: 0,
          flipX: false,
          imageTransform,
          visible: part.visible,
          drawOrder: part.drawOrder,
          ownerZIndex,
        };
      }
      const temporalPlayback =
        timeMs !== undefined && hasFlaGraphicTemporalPlayback(definition);
      const playbackState = temporalPlayback
        ? resolveAnimationPlaybackFrameState(
            definition,
            layerStartTimeMs,
            0,
            { mode: 'loop', endBehavior: 'hold' },
            timeMs,
          )
        : null;
      const frameOrdinal = playbackState
        ? playbackState.frame.ordinal
        : (definition.frames[0]?.ordinal ?? 0);
      const flaGraphic = evaluateFlaGraphicVisual({
        definition,
        frameOrdinal,
        mode: 'instance',
        ...(playbackState ? { internalTimeMs: playbackState.internalTimeMs } : {}),
        instanceTransformOverrides: visualSource.instanceTransformOverrides,
      });
      if (!flaGraphic) {
        throw new Error(
          `Adaptive Part ${part.partId} cannot resolve frame ${frameOrdinal} of FLA Graphic ${definition.id}.`,
        );
      }
      if (!flaGraphic.structureFrame) {
        const fallbackAsset = imageAsset(project, flaGraphic.frameAssetId, ownerLayerId);
        const frameToCanvas = {
          a: fallbackAsset.width > 0 ? flaGraphic.frameViewport.width / fallbackAsset.width : 1,
          b: 0,
          c: 0,
          d: fallbackAsset.height > 0 ? flaGraphic.frameViewport.height / fallbackAsset.height : 1,
          tx: flaGraphic.frameOffset.x,
          ty: flaGraphic.frameOffset.y,
        };
        const imageTransform = composeAffine(
          character.sourceRootTransform,
          composeAffine(part.restTransform, frameToCanvas),
        );
        return {
          partId: `${ownerLayerId}:${part.partId}`,
          ownerLayerId,
          slot: 'adaptive-part',
          source: {
            kind: 'adaptive-part-fla-graphic',
            characterPartId: part.partId,
            animationId: definition.id,
          },
          assetId: fallbackAsset.id,
          localRect: {
            x: 0,
            y: 0,
            width: fallbackAsset.width,
            height: fallbackAsset.height,
          },
          rotationDeg: 0,
          flipX: false,
          imageTransform,
          visible: part.visible,
          drawOrder: part.drawOrder,
          ownerZIndex,
        };
      }
      const imageTransform = composeAffine(
        character.sourceRootTransform,
        part.restTransform,
      );
      return {
        partId: `${ownerLayerId}:${part.partId}`,
        ownerLayerId,
        slot: 'adaptive-part',
        source: {
          kind: 'adaptive-part-fla-graphic',
          characterPartId: part.partId,
          animationId: definition.id,
        },
        flaGraphic,
        localRect: {
          x: 0,
          y: 0,
          width: flaGraphic.canvas.width,
          height: flaGraphic.canvas.height,
        },
        rotationDeg: 0,
        flipX: false,
        imageTransform,
        visible: part.visible,
        drawOrder: part.drawOrder,
        ownerZIndex,
      };
    }

    const asset = imageAsset(project, visualSource.assetId, ownerLayerId);
    const mapping = visualSource.imageMapping;
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

function adaptiveCharacterSourceBounds(
  project: Project,
  character: AdaptivePartsCharacter,
  parts: readonly LayerVisualPart[],
): VisualLocalRect {
  // Source geometry is independent of frame-local fallback viewport/offset.
  // Preserve PNG bounds while measuring Graphics against their full Definition canvas.
  // If a scoped subtree/region Part fails closed on render, reuse any persisted
  // historical regionVector bounds strictly for pivot stability without rendering it.
  const measuredParts = parts.flatMap((visual, index) => {
    const part = character.parts[index]!;
    const visualSource = resolveCharacterPartVisualSource(part);
    if (visualSource.kind !== 'fla-graphic') return [visual];
    let bounds = characterPartSourceBounds(
      part,
      project.animations,
      project.assets,
    );
    if (!bounds) {
      if (visualSource.regionRef || visualSource.nodePath || visualSource.regionVector) {
        bounds = characterPartRegionAnchorBounds(part, project.animations);
        if (!bounds) {
          return [];
        }
      } else {
        throw new Error(`Cannot resolve source bounds for Adaptive Part ${part.partId}.`);
      }
    }
    return [{
      ...visual,
      localRect: bounds,
      imageTransform: composeAffine(character.sourceRootTransform, part.restTransform),
    }];
  });
  if (measuredParts.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return visualBounds(measuredParts, null, true);
}

/** Returns the source-stage visual center used by a center-anchored Shot Layer. */
export function adaptiveCharacterSourceAnchor(
  project: Project,
  character: AdaptivePartsCharacter,
): VisualPoint {
  const bounds = adaptiveCharacterSourceBounds(
    project,
    character,
    adaptivePartVisuals(project, character, character.id, 0),
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

/** Apply transient action placement to the latest evaluated owner transform. */
export function resolveCharacterActionRenderTransform(evaluated: EvaluatedLayer): VisualOwnerTransform {
  const transform = ownerTransform(evaluated);
  const placement = evaluated.characterAction?.placement;
  if (!placement) return transform;
  const radians = transform.rotationDeg * Math.PI / 180;
  const localX = placement.offsetX * transform.scaleX * (transform.flipX ? -1 : 1);
  const localY = placement.offsetY * transform.scaleY;
  return {
    ...transform,
    x: transform.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: transform.y + localX * Math.sin(radians) + localY * Math.cos(radians),
    scaleX: transform.scaleX * placement.scale,
    scaleY: transform.scaleY * placement.scale,
  };
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
  timeMs = 0,
  isImageUnavailable?: (assetId: string) => boolean,
  options?: { collectCandidates: boolean },
): LayerVisualParts {
  const layer = shot.layers.find((candidate) => candidate.id === evaluated.id);
  if (!layer) {
    throw new Error(`Cannot resolve visual owner Layer ${evaluated.id}.`);
  }

  if (evaluated.characterAction) {
    const actionLayer: Layer = {
      ...layer,
      source: { kind: 'animation', animationId: evaluated.characterAction.animationId },
    };
    const actionEvaluated: EvaluatedLayer = {
      ...evaluated,
      ...resolveCharacterActionRenderTransform(evaluated),
      characterAction: undefined,
    };
    return resolveLayerVisualParts(
      project,
      { layers: shot.layers.map((candidate) => candidate.id === layer.id ? actionLayer : candidate) },
      actionEvaluated,
      timeMs,
      isImageUnavailable,
    );
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

  if (source.kind === 'animation') {
    const animation = project.animations.find(
      (candidate) => candidate.id === source.animationId,
    );
    if (animation && 'kind' in animation && animation.kind === 'fla-graphic') {
      const frameOrdinal =
        evaluated.animationFrame?.animationId === animation.id
          ? evaluated.animationFrame.frameOrdinal
          : animation.frames.find(
              (candidate) => candidate.assetId === evaluated.assetId,
            )?.ordinal ?? animation.frames[0]?.ordinal ?? 0;
      const flaGraphic = evaluateFlaGraphicVisual({
        definition: animation as FlaGraphicDefinition,
        frameOrdinal,
        mode: 'instance',
        instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
        instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
        internalTimeMs: evaluated.animationFrame?.internalTimeMs,
        instanceColor: source.flaOccurrence?.instanceColor,
      });
      if (!flaGraphic) {
        throw new Error('Cannot resolve FLA Graphic frame ' + frameOrdinal + ' for layer ' + layer.id + '.');
      }
      const bakedAsset = flaGraphic.structureFrame
        ? resolveImageAsset(project, flaGraphic.frameAssetId)
        : imageAsset(project, flaGraphic.frameAssetId, layer.id);
      const parts: LayerVisualPart[] = bakedAsset
        ? [{
            partId: layer.id + ':animation-frame',
            ownerLayerId: layer.id,
            slot: 'single',
            source: {
              kind: 'animation-frame',
              animationId: animation.id,
              assetId: bakedAsset.id,
            },
            assetId: bakedAsset.id,
            localRect: {
              x: flaGraphic.frameOffset.x - flaGraphic.canvas.width / 2,
              y: flaGraphic.frameOffset.y - flaGraphic.canvas.height / 2,
              width: flaGraphic.frameViewport.width,
              height: flaGraphic.frameViewport.height,
            },
            rotationDeg: 0,
            flipX: false,
            drawOrder: 0,
            ownerZIndex: evaluated.zIndex,
          }]
        : [];
      const required = flaGraphic.resourceAssetIds.flatMap((assetId) => {
        const resource = project.assets.find(
          (candidate) => candidate.id === assetId && candidate.kind === 'image',
        );
        return resource
          ? [{
              assetId,
              reason: assetId === flaGraphic.frameAssetId
                ? 'current-layer' as const
                : 'fla-graphic-resource' as const,
            }]
          : [];
      });
      return {
        ...baseResult(
          evaluated,
          'fla-graphic',
          null,
          parts,
          null,
          { required, candidates: [], fallback: [] },
        ),
        flaGraphic,
        combinedLocalBounds: {
          x: -flaGraphic.canvas.width / 2,
          y: -flaGraphic.canvas.height / 2,
          width: flaGraphic.canvas.width,
          height: flaGraphic.canvas.height,
        },
      };
    }
    const frameAssetId = evaluated.assetId || animation?.frames[0]?.assetId;
    if (!animation || !frameAssetId) {
      throw new Error(`Cannot resolve animation ${source.animationId}.`);
    }
    const asset = imageAsset(project, frameAssetId, layer.id);
    const frame = animation.frames.find(
      (candidate) => candidate.assetId === frameAssetId,
    ) ?? animation.frames[0]!;
    const canvas =
      evaluated.animationFrame?.animationId === animation.id
        ? evaluated.animationFrame.canvas
        : animation.source.canvas;
    const offset =
      evaluated.animationFrame?.animationId === animation.id
        ? evaluated.animationFrame.offset
        : frame.offset;
    const viewport =
      evaluated.animationFrame?.animationId === animation.id
        ? evaluated.animationFrame.viewport
        : frame.sourceViewport;
    const part: LayerVisualPart = {
      partId: `${layer.id}:animation-frame`,
      ownerLayerId: layer.id,
      slot: 'single',
      source: {
        kind: 'animation-frame',
        animationId: animation.id,
        assetId: asset.id,
      },
      assetId: asset.id,
      localRect: {
        x: offset.x - canvas.width / 2,
        y: offset.y - canvas.height / 2,
        width: viewport.width,
        height: viewport.height,
      },
      rotationDeg: 0,
      flipX: false,
      drawOrder: 0,
      ownerZIndex: evaluated.zIndex,
    };
    const otherFrames = animation.frames
      .filter((candidate) => candidate.assetId !== asset.id)
      .map((candidate) => ({
        assetId: candidate.assetId,
        reason: 'animation-frame' as const,
      }));
    return {
      ...baseResult(
        evaluated,
        'ordinary-image',
        null,
        [part],
        null,
        {
          required: [{ assetId: asset.id, reason: 'current-layer' }],
          candidates: otherFrames,
          fallback: [],
        },
      ),
      combinedLocalBounds: {
        x: -canvas.width / 2,
        y: -canvas.height / 2,
        width: canvas.width,
        height: canvas.height,
      },
    };
  }

  const character = project.characters.find(
    (candidate) => candidate.id === source.characterId,
  );
  if (!character) {
    throw new Error(`Cannot resolve Character ${source.characterId}.`);
  }
  if (character.mode === 'adaptive-parts') {
    const authoredClip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    const layeredAction = evaluated.layeredCharacterAction;
    const clip = authoredClip ?? (layeredAction ? captureCharacterPartAnimationBasis(project, character, layer.id) : undefined);
    let parts: LayerVisualPart[];
    let visualDefinition: AdaptivePartVisualDefinition = character;
    if (clip) {
      const values = evaluated.animationValues ?? [];
      if (values.length !== clip.tracks.length || clip.tracks.some(track =>
        !values.some(value => sameAnimationTarget(value.target, track.target) && value.property === track.property),
      )) throw new Error('Animation Clip requires complete Shot-time evaluation.');
      const layeredTransforms = layeredAction ? resolveLayeredCharacterPartTransforms(clip, character, values, layeredAction) : undefined;
      visualDefinition = {
        sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        parts: clip.targetBases.map(basis => ({
          partId: basis.target.partId, visualSource: basis.visualSource,
          restTransform: layeredTransforms?.get(basis.target.partId) ?? composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, values),
          visible: basis.visible, drawOrder: basis.drawOrder,
        })),
      };
      parts = adaptivePartVisuals(project, visualDefinition, layer.id, evaluated.zIndex, layer.startTimeMs ?? 0, evaluated.animationTimeMs ?? timeMs);
    } else {
      const sourceParts = adaptivePartVisuals(
        project,
        character,
        layer.id,
        evaluated.zIndex,
        layer.startTimeMs ?? 0,
        timeMs,
      );
      // Keep the visual pivot tied to the trusted source pose. If it followed
      // the edited bounds, moving an edge Part would recenter every other Part
      // and make the selected Part lag behind the pointer. C3 persists this
      // baseline; legacy Parts without one retain their current behavior until
      // the assembly draft captures and applies it.
      const sourcePoseCharacter: AdaptivePartsCharacter = {
        ...character,
        parts: character.parts.map((part) => ({
          ...part,
          restTransform: part.sourceRestTransform ?? part.restTransform,
        })),
      };
      const sourcePoseParts = adaptivePartVisuals(
        project,
        sourcePoseCharacter,
        layer.id,
        evaluated.zIndex,
      );
      // Adaptive source coordinates may be absolute to the imported stage. The
      // persisted Layer is center anchored, so express the current Parts around
      // the stable source-pose bounds center. Placement stores that same center
      // on the Layer, preserving the imported pose and owner transforms.
      // Visibility controls pixels and output bounds, but it must not move the
      // Character's source pivot or the remaining Parts in existing Shots.
      const sourceBounds = adaptiveCharacterSourceBounds(project, sourcePoseCharacter, sourcePoseParts);
      const sourceCenterX = sourceBounds.x + sourceBounds.width / 2;
      const sourceCenterY = sourceBounds.y + sourceBounds.height / 2;
      parts = sourceParts.map((part) => ({
        ...part,
        imageTransform: {
          ...part.imageTransform!,
          tx: part.imageTransform!.tx - sourceCenterX,
          ty: part.imageTransform!.ty - sourceCenterY,
        },
      }));
    }
    const validImageAssetIds = new Set(
      project.assets
        .filter((candidate) => candidate.kind === 'image')
        .map((candidate) => candidate.id),
    );
    const faceProjection = projectAdaptivePartsFaceVisual({
      project,
      character,
      visualDefinition,
      parts,
      evaluated,
      sourceExpressionId: source.expressionId,
      validImageAssetIds,
      isImageUnavailable,
    });
    parts = [...faceProjection.parts];
    const headDelta = evaluated.headGroupTransform;
    const boundHeadPartIds = character.headMotionBinding?.partIds;
    if (
      headDelta &&
      boundHeadPartIds &&
      boundHeadPartIds.length > 0 &&
      (headDelta.translateX !== 0 || headDelta.translateY !== 0)
    ) {
      const headPartIdSet = new Set(boundHeadPartIds);
      const deltaMatrix: CharacterPartTransform = {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: headDelta.translateX,
        ty: headDelta.translateY,
      };
      parts = parts.map((part) => {
        const charPartId = adaptivePartIdOfSource(part.source);
        if (!charPartId || !headPartIdSet.has(charPartId) || !part.imageTransform) {
          return part;
        }
        return {
          ...part,
          imageTransform: composeAffine(deltaMatrix, part.imageTransform),
        };
      });
    }
    const requiredAssetIds = new Set<string>();
    const candidateAssetIds = new Set<string>();
    for (const part of parts) {
      if (part.assetId) {
        requiredAssetIds.add(part.assetId);
      }
      if (part.flaGraphic) {
        for (const assetId of part.flaGraphic.resourceAssetIds) {
          if (validImageAssetIds.has(assetId)) {
            requiredAssetIds.add(assetId);
          }
        }
      }
    }
    if (options?.collectCandidates !== false) {
      const collectCandidateFaceSourceAssets = (faceSource: CharacterFaceSource): void => {
        const resolved = resolveCharacterFaceSourceOrNull(project, faceSource);
        if (!resolved) return;
        for (const id of resolved.flaGraphic?.resourceAssetIds ?? (resolved.assetId ? [resolved.assetId] : [])) {
          if (validImageAssetIds.has(id) && !requiredAssetIds.has(id) && !faceProjection.fallbackAssetIds.has(id)) {
            candidateAssetIds.add(id);
          }
        }
      };
      for (const { animationId } of character.faceBinding ? listCharacterTalkingSources(character) : []) {
        const talking = findTalkingAnimation(project, animationId);
        if (!talking) continue;
        for (const assetId of listTalkingAnimationImageIds(talking)) {
          if (validImageAssetIds.has(assetId) && !requiredAssetIds.has(assetId)) candidateAssetIds.add(assetId);
        }
      }
      for (const expression of character.expressions ?? []) {
        collectCandidateFaceSourceAssets(resolveExpressionVisualSource(expression));
      }
      const configuredMouth = resolveMouthVisualSource(character);
      if (configuredMouth) {
        collectCandidateFaceSourceAssets(configuredMouth);
      }
      for (const part of visualDefinition.parts) {
        const visualSource = resolveCharacterPartVisualSource(part);
        if (
          visualSource.kind !== 'fla-graphic' ||
          visualSource.nodePath ||
          visualSource.regionRef ||
          visualSource.regionVector
        ) continue;
        const definition = project.animations.find(
          (candidate): candidate is FlaGraphicDefinition =>
            isFlaGraphicDefinition(candidate) &&
            candidate.id === visualSource.animationId,
        );
        if (!definition || definition.frames.length <= 1) continue;
        for (const frame of definition.frames) {
          const evaluatedFrame = evaluateFlaGraphicVisual({
            definition,
            frameOrdinal: frame.ordinal,
            mode: 'instance',
            instanceTransformOverrides: visualSource.instanceTransformOverrides,
          });
          if (!evaluatedFrame) continue;
          for (const assetId of evaluatedFrame.resourceAssetIds) {
            if (
              validImageAssetIds.has(assetId) &&
              !requiredAssetIds.has(assetId)
            ) {
              candidateAssetIds.add(assetId);
            }
          }
        }
      }
    }
    return baseResult(
      evaluated,
      'adaptive-parts-character',
      null,
      parts,
      faceProjection.activeFace,
      {
        required: [...requiredAssetIds].map((assetId) => ({
          assetId,
          reason: 'current-layer' as const,
        })),
        candidates: [...candidateAssetIds].map((assetId) => ({
          assetId,
          reason: 'fla-graphic-resource' as const,
        })),
        fallback: [...faceProjection.fallbackAssetIds].map((assetId) => ({
          assetId,
          reason: 'current-expression-fallback' as const,
        })),
      },
    );
  }
  const resolved = resolveCharacterFace(
    project,
    character,
    evaluated,
    source.expressionId ?? character.defaultExpressionId,
    isImageUnavailable,
  );
  const requiredAssetIds = new Set<string>();
  const fallbackAssetIds = new Set<string>();

  if (character.mode === 'composite') {
    requiredAssetIds.add(character.bodyAssetId);
    if (character.head) requiredAssetIds.add(character.head.assetId);
  }

  for (const assetId of resolved.asset.flaGraphic?.resourceAssetIds ?? (resolved.asset.assetId ? [resolved.asset.assetId] : [])) {
    if (resolveImageAsset(project, assetId)) requiredAssetIds.add(assetId);
  }
  if (resolved.fallback) {
    for (const assetId of resolved.fallback.flaGraphic?.resourceAssetIds ?? (resolved.fallback.assetId ? [resolved.fallback.assetId] : [])) {
      if (resolveImageAsset(project, assetId)) fallbackAssetIds.add(assetId);
    }
  }

  if (character.mode === 'single-image') {
    if (resolved.face.fallbackAssetId) {
      fallbackAssetIds.add(resolved.face.fallbackAssetId);
    }
    const part = faceVisualPart(project, resolved, evaluated, 'single', { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, flipX: false }, 0);
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
  const facePose: EvaluatedCharacterNodePose =
    evaluated.faceTransform ??
    evaluateCompositeFacePoseAtTime(
      project,
      layer,
      evaluated.animationTimeMs ?? 0,
      evaluated.animationValues,
    ) ?? {
      offsetX: character.facePlacement.offsetX,
      offsetY: character.facePlacement.offsetY,
      scaleX: character.facePlacement.scale,
      scaleY: character.facePlacement.scale,
      rotationDeg: character.facePlacement.rotationDeg,
      flipX: character.facePlacement.flipX,
    };
  const facePart = faceVisualPart(project, resolved, evaluated, 'face', facePose, headAsset ? 2 : 1);
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
    {
      offsetX: facePose.offsetX,
      offsetY: facePose.offsetY,
      scale: facePose.scaleX,
      rotationDeg: facePose.rotationDeg,
      flipX: facePose.flipX,
    },
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
    resolveLayerVisualParts(project, shot, layer, evaluated.timeMs),
  );
}
