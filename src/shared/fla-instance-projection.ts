import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from './affine-matrix';

export interface FlaInstanceProjection {
  readonly focalLength: number;
  readonly vanishingX: number;
  readonly vanishingY: number;
  readonly pivotX?: number;
  readonly pivotY?: number;
  readonly depth: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
}

/** First-order perspective at the 3D pivot, expressed in the original parent space. */
export function projectFlaInstance(
  authored: AffineMatrix2D, parent: AffineMatrix2D, projection: FlaInstanceProjection,
): AffineMatrix2D | null {
  const inverse = invertAffineMatrix(parent);
  const focal = projection.focalLength;
  const distance = focal + projection.depth;
  if (!inverse || !Number.isFinite(distance) || distance <= 1e-6 || focal <= 0) return null;
  const px = projection.pivotX ?? authored.tx;
  const py = projection.pivotY ?? authored.ty;
  const radians = Math.PI / 180;
  const matrixAngle = Math.atan2(authored.b, authored.a) / radians;
  const delta = ((matrixAngle - projection.rotationZ) % 180 + 180) % 180;
  const hasAuthoredZ = Math.min(delta, 180 - delta) <= 1e-4;
  const z = (hasAuthoredZ ? 0 : projection.rotationZ) * radians;
  const x = projection.rotationX * radians;
  const y = projection.rotationY * radians;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)] as const;
  const ratio = focal / distance;
  const stageX = parent.a * px + parent.c * py + parent.tx;
  const stageY = parent.b * px + parent.d * py + parent.ty;
  const vx = stageX - projection.vanishingX;
  const vy = stageY - projection.vanishingY;
  const derivative = (rx: number, ry: number, rz: number) => [
    ratio * (parent.a * rx + parent.c * ry - vx * rz / distance),
    ratio * (parent.b * rx + parent.d * ry - vy * rz / distance),
  ] as const;
  const [a, b] = derivative(cz * cy, sz * cy, -sy);
  const [c, d] = derivative(cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx);
  const stage = {
    a, b, c, d,
    tx: projection.vanishingX + vx * ratio - a * px - c * py,
    ty: projection.vanishingY + vy * ratio - b * px - d * py,
  };
  const local = multiplyAffineMatrices(multiplyAffineMatrices(inverse, stage), authored);
  return invertAffineMatrix(local) ? local : null;
}
