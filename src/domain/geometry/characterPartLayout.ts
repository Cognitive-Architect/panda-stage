import { z } from 'zod';
import {
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  CharacterPartImageMappingSchema,
  CharacterPartStaticAdjustmentSchema,
  CharacterPartTransformSchema,
  resolveCharacterPartVisualSource,
  type CharacterPart,
  type CharacterPartImageMapping,
  type CharacterPartStaticAdjustment,
  type CharacterPartTransform,
} from '../models/character';
import {
  isFlaGraphicDefinition,
  type ProjectAnimationDefinition,
} from '../models/animation';
import { FiniteNumberSchema } from '../models/common';

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
  return {
    x: 0,
    y: 0,
    width: definition.source.canvas.width,
    height: definition.source.canvas.height,
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
