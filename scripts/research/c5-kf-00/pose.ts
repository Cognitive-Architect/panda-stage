import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from '../../../src/domain/constants';
import type {
  CharacterPartImageMapping,
  CharacterPartTransform,
} from '../../../src/domain/models/character';

export interface ResearchPoint {
  x: number;
  y: number;
}

export interface ResearchPose {
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
}

export interface ResearchKeyframe extends ResearchPose {
  timeMs: number;
}

export const KF00_SCALE_MIN = LAYER_MIN_SCALE;
export const KF00_SCALE_MAX = LAYER_MAX_SCALE;
const MATRIX_DETERMINANT_EPSILON = 1e-12;
const MAX_ABSOLUTE_ANGLE_DEGREES = 3_600;

export function assertFiniteAffine(
  matrix: CharacterPartTransform,
): void {
  if (Object.values(matrix).some((value) => !Number.isFinite(value))) {
    throw new Error('Affine matrix values must be finite.');
  }
}

export function affineDeterminant(matrix: CharacterPartTransform): number {
  assertFiniteAffine(matrix);
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

export function multiplyAffine(
  outer: CharacterPartTransform,
  inner: CharacterPartTransform,
): CharacterPartTransform {
  assertFiniteAffine(outer);
  assertFiniteAffine(inner);
  const result = {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
  assertFiniteAffine(result);
  return result;
}

export function inverseAffine(
  matrix: CharacterPartTransform,
): CharacterPartTransform {
  const determinant = affineDeterminant(matrix);
  if (Math.abs(determinant) < MATRIX_DETERMINANT_EPSILON) {
    throw new Error('Affine matrix is singular or degenerate.');
  }
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  const inverse = {
    a,
    b,
    c,
    d,
    tx: -(a * matrix.tx + c * matrix.ty),
    ty: -(b * matrix.tx + d * matrix.ty),
  };
  assertFiniteAffine(inverse);
  return inverse;
}

export function transformPoint(
  matrix: CharacterPartTransform,
  point: ResearchPoint,
): ResearchPoint {
  assertFiniteAffine(matrix);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Point coordinates must be finite.');
  }
  const result = {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) {
    throw new Error('Transformed point is not finite.');
  }
  return result;
}

function angleDelta(fromDeg: number, toDeg: number): number {
  const requestedDelta = toDeg - fromDeg;
  // A full turn is intentional when the keys differ by 360 degrees or more.
  // For normalized angles across +/-180, use the continuous shortest crossing.
  if (Math.abs(requestedDelta) >= 360) return requestedDelta;
  let continuousDelta = requestedDelta;
  while (continuousDelta > 180) continuousDelta -= 360;
  while (continuousDelta < -180) continuousDelta += 360;
  return continuousDelta;
}

function assertKeyframe(frame: ResearchKeyframe): void {
  if (
    !Number.isFinite(frame.timeMs) ||
    !Number.isFinite(frame.offsetX) ||
    !Number.isFinite(frame.offsetY) ||
    !Number.isFinite(frame.rotationDeg) ||
    !Number.isFinite(frame.scale)
  ) {
    throw new Error('Keyframe time and pose parameters must be finite.');
  }
  if (
    frame.scale < KF00_SCALE_MIN ||
    frame.scale > KF00_SCALE_MAX
  ) {
    throw new Error(
      `Keyframe scale must be in [${KF00_SCALE_MIN}, ${KF00_SCALE_MAX}].`,
    );
  }
  if (Math.abs(frame.rotationDeg) > MAX_ABSOLUTE_ANGLE_DEGREES) {
    throw new Error(
      `Keyframe rotation must be within +/-${MAX_ABSOLUTE_ANGLE_DEGREES} degrees.`,
    );
  }
}

/** Linear two-key interpolation from absolute time; no previous-frame state. */
export function interpolatePoseAtTime(
  start: ResearchKeyframe,
  end: ResearchKeyframe,
  timeMs: number,
): ResearchPose {
  assertKeyframe(start);
  assertKeyframe(end);
  if (!Number.isFinite(timeMs)) {
    throw new Error('Absolute time must be finite.');
  }
  if (end.timeMs <= start.timeMs) {
    throw new Error('End keyframe time must be after start keyframe time.');
  }

  const progress = Math.max(
    0,
    Math.min(1, (timeMs - start.timeMs) / (end.timeMs - start.timeMs)),
  );
  const interpolate = (from: number, to: number) =>
    from + (to - from) * progress;
  return {
    offsetX: interpolate(start.offsetX, end.offsetX),
    offsetY: interpolate(start.offsetY, end.offsetY),
    rotationDeg:
      start.rotationDeg +
      angleDelta(start.rotationDeg, end.rotationDeg) * progress,
    scale: interpolate(start.scale, end.scale),
  };
}

export function cropToSourceTransform(
  mapping: CharacterPartImageMapping,
): CharacterPartTransform {
  if (
    !Number.isFinite(mapping.exportScale) ||
    mapping.exportScale <= 0 ||
    mapping.crop.x < 0 ||
    mapping.crop.y < 0 ||
    mapping.crop.width <= 0 ||
    mapping.crop.height <= 0 ||
    mapping.crop.x + mapping.crop.width > mapping.sourceWidth ||
    mapping.crop.y + mapping.crop.height > mapping.sourceHeight
  ) {
    throw new Error('Image crop mapping is invalid.');
  }
  return {
    a: 1 / mapping.exportScale,
    b: 0,
    c: 0,
    d: 1 / mapping.exportScale,
    tx: mapping.crop.x,
    ty: mapping.crop.y,
  };
}

/** Reverse maps an uncropped source-image pivot to cropped asset pixels. */
export function sourcePivotToAssetPixels(
  pivotSource: ResearchPoint,
  mapping: CharacterPartImageMapping,
): ResearchPoint {
  return transformPoint(
    inverseAffine(cropToSourceTransform(mapping)),
    pivotSource,
  );
}

/** Maps a source pivot through root/rest and the fixed source-pose anchor. */
export function sourcePivotToCenteredCharacter(
  sourceRootTransform: CharacterPartTransform,
  restTransform: CharacterPartTransform,
  sourceAnchor: ResearchPoint,
  pivotSource: ResearchPoint,
): ResearchPoint {
  const centeredRoot: CharacterPartTransform = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: -sourceAnchor.x,
    ty: -sourceAnchor.y,
  };
  return transformPoint(
    multiplyAffine(
      centeredRoot,
      multiplyAffine(sourceRootTransform, restTransform),
    ),
    pivotSource,
  );
}

/** Compose translation/rotation/positive scale around one fixed Character pivot. */
export function poseTransformAroundPivot(
  pivot: ResearchPoint,
  pose: ResearchPose,
): CharacterPartTransform {
  if (
    !Number.isFinite(pose.offsetX) ||
    !Number.isFinite(pose.offsetY) ||
    !Number.isFinite(pose.rotationDeg) ||
    !Number.isFinite(pose.scale) ||
    pose.scale < KF00_SCALE_MIN ||
    pose.scale > KF00_SCALE_MAX ||
    Math.abs(pose.rotationDeg) > MAX_ABSOLUTE_ANGLE_DEGREES
  ) {
    throw new Error('Pose is invalid or outside the bounded experiment range.');
  }
  const radians = (pose.rotationDeg * Math.PI) / 180;
  const a = Math.cos(radians) * pose.scale;
  const b = Math.sin(radians) * pose.scale;
  const c = -Math.sin(radians) * pose.scale;
  const d = Math.cos(radians) * pose.scale;
  const matrix = {
    a,
    b,
    c,
    d,
    tx: pose.offsetX + pivot.x - a * pivot.x - c * pivot.y,
    ty: pose.offsetY + pivot.y - b * pivot.x - d * pivot.y,
  };
  assertFiniteAffine(matrix);
  return matrix;
}

export function applyPoseToImageTransform(
  staticImageTransform: CharacterPartTransform,
  pivot: ResearchPoint,
  pose: ResearchPose,
): CharacterPartTransform {
  return multiplyAffine(
    poseTransformAroundPivot(pivot, pose),
    staticImageTransform,
  );
}
