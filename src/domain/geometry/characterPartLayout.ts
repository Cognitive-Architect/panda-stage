import {
  CharacterPartImageMappingSchema,
  CharacterPartStaticAdjustmentSchema,
  CharacterPartTransformSchema,
  type CharacterPartImageMapping,
  type CharacterPartStaticAdjustment,
  type CharacterPartTransform,
} from '../models/character';

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

/**
 * Rebuilds the persisted Part matrix from its immutable source pose and
 * user-authored Character-local controls. The controls act after the source
 * root, so source rotation, reflection, shear, and crop mapping remain intact.
 */
export function characterPartTransformFromStaticAdjustment(
  sourceRootTransform: CharacterPartTransform,
  sourceRestTransform: CharacterPartTransform,
  imageMapping: CharacterPartImageMapping,
  adjustment: CharacterPartStaticAdjustment,
): CharacterPartTransform {
  const sourceRoot = CharacterPartTransformSchema.parse(sourceRootTransform);
  const sourceRest = CharacterPartTransformSchema.parse(sourceRestTransform);
  const mapping = CharacterPartImageMappingSchema.parse(imageMapping);
  const safeAdjustment = CharacterPartStaticAdjustmentSchema.parse(adjustment);

  const sourcePose = multiply(sourceRoot, sourceRest);
  const cropCenter = transformPoint(sourcePose, {
    x: mapping.crop.x + mapping.crop.width / 2,
    y: mapping.crop.y + mapping.crop.height / 2,
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
