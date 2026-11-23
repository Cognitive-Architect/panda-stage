import { z } from 'zod';
import {
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  CharacterPartImageMappingSchema,
  CharacterPartStaticAdjustmentSchema,
  CharacterPartTransformSchema,
  FacePlacementSchema,
  resolveCharacterPartVisualSource,
  type AdaptivePartsFaceAnchorRect,
  type CharacterPart,
  type CharacterPartImageMapping,
  type CharacterPartStaticAdjustment,
  type CharacterPartTransform,
  type FacePlacement,
} from '../models/character';
import {
  isFlaGraphicDefinition,
  type ProjectAnimationDefinition,
} from '../models/animation';
import { FiniteNumberSchema } from '../models/common';
import {
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicLayer,
  type EvaluatedFlaGraphicNode,
} from '../evaluate-fla-graphic';
import {
  measureFlaGraphicSubtreeBounds,
  selectFlaGraphicSubtreeVisual,
  type FlaGraphicAssetDimensionLike,
} from '../fla-graphic-subtree';
import { unionFlaShapeRegionBounds } from '../fla-shape-vector';

export const CharacterPartSourceBoundsSchema = z
  .object({
    x: FiniteNumberSchema.default(0),
    y: FiniteNumberSchema.default(0),
    width: FiniteNumberSchema.positive(),
    height: FiniteNumberSchema.positive(),
  })
  .strict();

export type CharacterPartSourceBounds = z.infer<
  typeof CharacterPartSourceBoundsSchema
>;

interface Point {
  x: number;
  y: number;
}

function multiply(
  outer: CharacterPartTransform,
  inner: CharacterPartTransform,
): CharacterPartTransform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

function inverse(transform: CharacterPartTransform): CharacterPartTransform {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('The source root transform must be invertible.');
  }
  const a = transform.d / determinant;
  const b = -transform.b / determinant;
  const c = -transform.c / determinant;
  const d = transform.a / determinant;
  return {
    a,
    b,
    c,
    d,
    tx: -(a * transform.tx + c * transform.ty),
    ty: -(b * transform.tx + d * transform.ty),
  };
}

function transformPoint(
  transform: CharacterPartTransform,
  point: Point,
): Point {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty,
  };
}

function resolveSourceBoundsRect(
  sourceBoundsOrImageMapping: CharacterPartImageMapping | CharacterPartSourceBounds,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if ('crop' in sourceBoundsOrImageMapping) {
    const mapping = CharacterPartImageMappingSchema.parse(sourceBoundsOrImageMapping);
    return {
      x: mapping.crop.x,
      y: mapping.crop.y,
      width: mapping.crop.width,
      height: mapping.crop.height,
    };
  }
  return CharacterPartSourceBoundsSchema.parse(sourceBoundsOrImageMapping);
}

/**
 * Resolves the Part's source-space bounding rect before `sourceRootTransform * restTransform`.
 */
export function characterPartSourceBounds(
  part: Pick<CharacterPart, 'partId' | 'assetId' | 'imageMapping' | 'visualSource'>,
  animations: readonly ProjectAnimationDefinition[],
  assets: readonly FlaGraphicAssetDimensionLike[] = [],
): CharacterPartSourceBounds | null {
  const visualSource = resolveCharacterPartVisualSource(part);
  if (visualSource.kind === 'image') {
    return {
      x: visualSource.imageMapping.crop.x,
      y: visualSource.imageMapping.crop.y,
      width: visualSource.imageMapping.crop.width,
      height: visualSource.imageMapping.crop.height,
    };
  }
  const definition = animations.find(
    (candidate) =>
      isFlaGraphicDefinition(candidate) && candidate.id === visualSource.animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return null;
  }
  if (visualSource.nodePath && definition.structure) {
    const evaluated = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: visualSource.poseFrameOrdinal ?? 0,
      mode: 'instance',
      instanceTransformOverrides: visualSource.instanceTransformOverrides,
    });
    if (evaluated) {
      const subtreeVisual = selectFlaGraphicSubtreeVisual(
        evaluated,
        visualSource.nodePath,
        visualSource.regionVector || visualSource.regionRef
          ? {
              ...(visualSource.regionRef ? { regionRef: visualSource.regionRef } : {}),
              ...(visualSource.regionVector
                ? { regionVector: visualSource.regionVector }
                : {}),
            }
          : undefined,
      );
      const tightBounds = measureFlaGraphicSubtreeBounds(subtreeVisual, assets);
      if (tightBounds) {
        return tightBounds;
      }
    }
  }
  if (visualSource.regionRef || visualSource.nodePath || visualSource.regionVector) {
    return null;
  }
  return {
    x: 0,
    y: 0,
    width: definition.source.canvas.width,
    height: definition.source.canvas.height,
  };
}

function isEvaluatedShapeLeafNode(node: EvaluatedFlaGraphicNode): boolean {
  return (
    node.source.type === 'opaque' &&
    node.source.opaqueKind === 'shape' &&
    node.children.length === 0
  );
}

function findEvaluatedNodeAtPath(
  layers: readonly EvaluatedFlaGraphicLayer[],
  nodePath: readonly string[],
): EvaluatedFlaGraphicNode | undefined {
  if (nodePath.length === 0) return undefined;
  const visit = (nodes: readonly EvaluatedFlaGraphicNode[]): EvaluatedFlaGraphicNode | undefined => {
    for (const node of nodes) {
      if (
        node.path.length === nodePath.length &&
        node.path.every((segment, index) => segment === nodePath[index])
      ) {
        return node;
      }
      if (
        node.path.length < nodePath.length &&
        node.path.every((segment, index) => segment === nodePath[index])
      ) {
        const hit = visit(node.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const layer of layers) {
    const hit = visit(layer.nodes);
    if (hit) return hit;
  }
  return undefined;
}

function findUniqueEvaluatedShapeBySourceRef(
  layers: readonly EvaluatedFlaGraphicLayer[],
  sourceRef: string,
): EvaluatedFlaGraphicNode | undefined {
  let matched: EvaluatedFlaGraphicNode | undefined;
  let ambiguous = false;
  const visit = (nodes: readonly EvaluatedFlaGraphicNode[]): void => {
    for (const node of nodes) {
      if (
        isEvaluatedShapeLeafNode(node) &&
        node.source.type === 'opaque' &&
        node.source.sourceRef === sourceRef
      ) {
        if (matched) {
          ambiguous = true;
          return;
        }
        matched = node;
      }
      if (node.children.length > 0) {
        visit(node.children);
        if (ambiguous) return;
      }
    }
  };
  for (const layer of layers) {
    visit(layer.nodes);
    if (ambiguous) return undefined;
  }
  return matched;
}

function viewBoxContainsRect(
  viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  if (!viewBox) return false;
  const eps = 1e-3;
  return (
    rect.x >= viewBox.x - eps &&
    rect.y >= viewBox.y - eps &&
    rect.x + rect.width <= viewBox.x + viewBox.width + eps &&
    rect.y + rect.height <= viewBox.y + viewBox.height + eps
  );
}

/**
 * Recovers source-pose anchor bounds strictly from a Part's persisted
 * `regionVector` when formal region selection failed closed. Used only to keep
 * Character source-pose pivot stable across sibling Parts; never makes the
 * broken Part renderable.
 */
export function characterPartRegionAnchorBounds(
  part: Pick<CharacterPart, 'partId' | 'assetId' | 'imageMapping' | 'visualSource'>,
  animations: readonly ProjectAnimationDefinition[],
): CharacterPartSourceBounds | null {
  const visualSource = resolveCharacterPartVisualSource(part);
  if (visualSource.kind !== 'fla-graphic' || !visualSource.regionVector) {
    return null;
  }
  const regionVector = visualSource.regionVector;
  const regionBounds = unionFlaShapeRegionBounds([regionVector]);
  if (!regionBounds || regionBounds.width <= 0 || regionBounds.height <= 0) {
    return null;
  }
  const definition = animations.find(
    (candidate) =>
      isFlaGraphicDefinition(candidate) && candidate.id === visualSource.animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return null;
  }
  const frameOrdinal =
    visualSource.poseFrameOrdinal ?? (definition.frames[0]?.ordinal ?? 0);
  const evaluated = definition.structure
    ? evaluateFlaGraphicVisual({
        definition,
        frameOrdinal,
        mode: 'instance',
        instanceTransformOverrides: visualSource.instanceTransformOverrides,
      })
    : null;
  if (evaluated?.layers) {
    const pathNode = visualSource.nodePath
      ? findEvaluatedNodeAtPath(evaluated.layers, visualSource.nodePath)
      : undefined;
    const refNode = regionVector.sourceShapeRef
      ? findUniqueEvaluatedShapeBySourceRef(evaluated.layers, regionVector.sourceShapeRef)
      : undefined;
    const pathIsShape = Boolean(pathNode && isEvaluatedShapeLeafNode(pathNode));
    const pathMatchesRef =
      pathIsShape &&
      (!regionVector.sourceShapeRef ||
        pathNode!.source.type !== 'opaque' ||
        !pathNode!.source.sourceRef ||
        pathNode!.source.sourceRef === regionVector.sourceShapeRef);
    const pathViewBox =
      pathNode?.vectorVisual?.baseViewBox ??
      (pathNode?.source.type === 'opaque' ? pathNode.source.fallbackViewBox : undefined);
    const refViewBox =
      refNode?.vectorVisual?.baseViewBox ??
      (refNode?.source.type === 'opaque' ? refNode.source.fallbackViewBox : undefined);
    const refHasRegion = Boolean(
      refNode?.vectorVisual?.regions.some(
        (candidate) => candidate.regionRef === regionVector.regionRef,
      ),
    );
    const preferRefNode = Boolean(
      refNode &&
        (!pathIsShape ||
          refHasRegion ||
          (viewBoxContainsRect(refViewBox, regionBounds) &&
            !viewBoxContainsRect(pathViewBox, regionBounds))),
    );
    const hostNode = pathMatchesRef ? pathNode : preferRefNode ? refNode : pathNode;
    if (hostNode) {
      const baseViewBox =
        hostNode.vectorVisual?.baseViewBox ??
        (hostNode.source.type === 'opaque' ? hostNode.source.fallbackViewBox : undefined);
      const bx = baseViewBox?.x ?? 0;
      const by = baseViewBox?.y ?? 0;
      const rx = regionBounds.x - bx;
      const ry = regionBounds.y - by;
      const corners = [
        transformPoint(hostNode.worldTransform, { x: rx, y: ry }),
        transformPoint(hostNode.worldTransform, { x: rx + regionBounds.width, y: ry }),
        transformPoint(hostNode.worldTransform, { x: rx, y: ry + regionBounds.height }),
        transformPoint(hostNode.worldTransform, {
          x: rx + regionBounds.width,
          y: ry + regionBounds.height,
        }),
      ];
      if (corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
        const minX = Math.min(...corners.map((point) => point.x));
        const minY = Math.min(...corners.map((point) => point.y));
        const maxX = Math.max(...corners.map((point) => point.x));
        const maxY = Math.max(...corners.map((point) => point.y));
        const width = maxX - minX;
        const height = maxY - minY;
        if (width > 0 && height > 0) {
          return {
            x: minX - evaluated.anchor.x,
            y: minY - evaluated.anchor.y,
            width,
            height,
          };
        }
      }
    }
  }
  const anchor = definition.source.anchor;
  return {
    x: regionBounds.x - anchor.x,
    y: regionBounds.y - anchor.y,
    width: regionBounds.width,
    height: regionBounds.height,
  };
}

/**
 * Computes replacement pose transforms that place `newBounds` centered at the
 * previous Part visual center in Character space while preserving visual width.
 */
export function characterPartPlacementForReplacement(input: {
  sourceRootTransform: CharacterPartTransform;
  oldRestTransform: CharacterPartTransform;
  oldBounds: CharacterPartSourceBounds;
  newBounds: CharacterPartSourceBounds;
}): {
  readonly sourceRestTransform: CharacterPartTransform;
  readonly restTransform: CharacterPartTransform;
  readonly staticAdjustment: CharacterPartStaticAdjustment;
} {
  const sourceRoot = CharacterPartTransformSchema.parse(input.sourceRootTransform);
  const oldRest = CharacterPartTransformSchema.parse(input.oldRestTransform);
  const oldBounds = CharacterPartSourceBoundsSchema.parse(input.oldBounds);
  const newBounds = CharacterPartSourceBoundsSchema.parse(input.newBounds);

  const oldPose = multiply(sourceRoot, oldRest);
  const oldCenter = transformPoint(oldPose, {
    x: oldBounds.x + oldBounds.width / 2,
    y: oldBounds.y + oldBounds.height / 2,
  });
  const oldVisualWidth = oldBounds.width * Math.hypot(oldPose.a, oldPose.b);
  const rawScale = oldVisualWidth > 0 ? oldVisualWidth / newBounds.width : 1;
  const scale = Number.isFinite(rawScale) && rawScale > 1e-4 ? rawScale : 1;

  const newCenterX = newBounds.x + newBounds.width / 2;
  const newCenterY = newBounds.y + newBounds.height / 2;
  const desiredPose: CharacterPartTransform = {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    tx: oldCenter.x - newCenterX * scale,
    ty: oldCenter.y - newCenterY * scale,
  };
  const restTransform = CharacterPartTransformSchema.parse(
    multiply(inverse(sourceRoot), desiredPose),
  );
  return {
    sourceRestTransform: restTransform,
    restTransform,
    staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
  };
}

/**
 * Rebuilds the persisted Part matrix from its immutable source pose and
 * user-authored Character-local controls. The controls act after the source
 * root, so source rotation, reflection, shear, and crop/canvas mapping remain intact.
 */
export function characterPartTransformFromStaticAdjustment(
  sourceRootTransform: CharacterPartTransform,
  sourceRestTransform: CharacterPartTransform,
  sourceBoundsOrImageMapping: CharacterPartImageMapping | CharacterPartSourceBounds,
  adjustment: CharacterPartStaticAdjustment,
): CharacterPartTransform {
  const sourceRoot = CharacterPartTransformSchema.parse(sourceRootTransform);
  const sourceRest = CharacterPartTransformSchema.parse(sourceRestTransform);
  const bounds = resolveSourceBoundsRect(sourceBoundsOrImageMapping);
  const safeAdjustment = CharacterPartStaticAdjustmentSchema.parse(adjustment);

  const sourcePose = multiply(sourceRoot, sourceRest);
  const cropCenter = transformPoint(sourcePose, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  const radians = (safeAdjustment.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians) * safeAdjustment.scale;
  const sine = Math.sin(radians) * safeAdjustment.scale;
  const characterAdjustment: CharacterPartTransform = {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    tx:
      cropCenter.x + safeAdjustment.offsetX -
      cosine * cropCenter.x + sine * cropCenter.y,
    ty:
      cropCenter.y + safeAdjustment.offsetY -
      sine * cropCenter.x - cosine * cropCenter.y,
  };
  const currentSourcePose = multiply(characterAdjustment, sourcePose);
  const result = multiply(inverse(sourceRoot), currentSourcePose);
  return CharacterPartTransformSchema.parse(result);
}

/**
 * Computes a frozen `anchorRect` in `targetPart`'s pre-crop source coordinates
 * covering `targetPartId` and any optional `replacePartIds` in their current rest pose.
 */
export function computeAdaptiveFaceAnchorRect(input: {
  readonly sourceRootTransform: CharacterPartTransform;
  readonly parts: readonly Pick<
    CharacterPart,
    'partId' | 'assetId' | 'imageMapping' | 'visualSource' | 'restTransform'
  >[];
  readonly targetPartId: string;
  readonly replacePartIds?: readonly string[];
  readonly animations: readonly ProjectAnimationDefinition[];
  readonly assets?: readonly FlaGraphicAssetDimensionLike[];
}): AdaptivePartsFaceAnchorRect | null {
  const sourceRoot = CharacterPartTransformSchema.parse(input.sourceRootTransform);
  const targetPart = input.parts.find((part) => part.partId === input.targetPartId);
  if (!targetPart) return null;

  const targetBounds =
    characterPartSourceBounds(targetPart, input.animations, input.assets ?? []) ??
    characterPartRegionAnchorBounds(targetPart, input.animations);
  if (!targetBounds || targetBounds.width <= 0 || targetBounds.height <= 0) {
    return null;
  }

  const replaceIds = (input.replacePartIds ?? []).filter(
    (partId) => partId !== input.targetPartId,
  );
  if (replaceIds.length === 0) {
    return {
      x: targetBounds.x,
      y: targetBounds.y,
      width: targetBounds.width,
      height: targetBounds.height,
    };
  }

  const targetPose = multiply(
    sourceRoot,
    CharacterPartTransformSchema.parse(targetPart.restTransform),
  );
  const poseCorners: Point[] = [];
  for (const partId of [input.targetPartId, ...replaceIds]) {
    const part = input.parts.find((candidate) => candidate.partId === partId);
    if (!part) return null;
    const bounds =
      characterPartSourceBounds(part, input.animations, input.assets ?? []) ??
      characterPartRegionAnchorBounds(part, input.animations);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const partPose = multiply(
      sourceRoot,
      CharacterPartTransformSchema.parse(part.restTransform),
    );
    for (const x of [bounds.x, bounds.x + bounds.width]) {
      for (const y of [bounds.y, bounds.y + bounds.height]) {
        poseCorners.push(transformPoint(partPose, { x, y }));
      }
    }
  }
  const minPoseX = Math.min(...poseCorners.map((point) => point.x));
  const maxPoseX = Math.max(...poseCorners.map((point) => point.x));
  const minPoseY = Math.min(...poseCorners.map((point) => point.y));
  const maxPoseY = Math.max(...poseCorners.map((point) => point.y));
  const invTargetPose = inverse(targetPose);
  const localCorners = [
    transformPoint(invTargetPose, { x: minPoseX, y: minPoseY }),
    transformPoint(invTargetPose, { x: maxPoseX, y: minPoseY }),
    transformPoint(invTargetPose, { x: minPoseX, y: maxPoseY }),
    transformPoint(invTargetPose, { x: maxPoseX, y: maxPoseY }),
  ];
  const x = Math.min(...localCorners.map((point) => point.x));
  const y = Math.min(...localCorners.map((point) => point.y));
  const width = Math.max(...localCorners.map((point) => point.x)) - x;
  const height = Math.max(...localCorners.map((point) => point.y)) - y;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

/**
 * Recovers the target Part's pre-crop base transform (`sourceRoot * restTransform`
 * or Clip-animated base matrix) from the evaluated `imageTransform`.
 */
export function stripCropTransformFromAdaptivePartMatrix(
  part: Pick<CharacterPart, 'partId' | 'assetId' | 'imageMapping' | 'visualSource'>,
  imageTransform: CharacterPartTransform,
): CharacterPartTransform {
  const visualSource = resolveCharacterPartVisualSource(part);
  if (visualSource.kind !== 'image') {
    return imageTransform;
  }
  const { crop, exportScale } = visualSource.imageMapping;
  const cropInverse: CharacterPartTransform = {
    a: exportScale,
    b: 0,
    c: 0,
    d: exportScale,
    tx: -crop.x * exportScale,
    ty: -crop.y * exportScale,
  };
  return multiply(imageTransform, cropInverse);
}

/**
 * Places a center-origin replacement Expression / Mouth canvas into a bound
 * Adaptive Part's frozen `anchorRect`, plus user-authored fine-tuning `placement`.
 */
export function composeAdaptiveFaceReplacementMatrix(input: {
  readonly targetBaseTransform: CharacterPartTransform;
  readonly anchorRect: AdaptivePartsFaceAnchorRect;
  readonly placement: FacePlacement;
  readonly resolvedWidth: number;
  readonly resolvedHeight: number;
}): CharacterPartTransform {
  const safePlacement = FacePlacementSchema.parse(input.placement);
  const fitScale = Math.min(
    input.anchorRect.width / input.resolvedWidth,
    input.anchorRect.height / input.resolvedHeight,
  );
  const safeFitScale = Number.isFinite(fitScale) && fitScale > 1e-6 ? fitScale : 1;
  const anchorCenterX = input.anchorRect.x + input.anchorRect.width / 2;
  const anchorCenterY = input.anchorRect.y + input.anchorRect.height / 2;
  const angle = (safePlacement.rotationDeg * Math.PI) / 180;
  const sx = safeFitScale * safePlacement.scale * (safePlacement.flipX ? -1 : 1);
  const sy = safeFitScale * safePlacement.scale;
  const faceInTargetSpace: CharacterPartTransform = {
    a: Math.cos(angle) * sx,
    b: Math.sin(angle) * sx,
    c: -Math.sin(angle) * sy,
    d: Math.cos(angle) * sy,
    tx: anchorCenterX + safePlacement.offsetX,
    ty: anchorCenterY + safePlacement.offsetY,
  };
  return multiply(input.targetBaseTransform, faceInTargetSpace);
}
