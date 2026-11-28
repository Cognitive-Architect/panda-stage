import type {
  EvaluatedLayer,
  EvaluatedPinWarpMesh,
  LayerVisualParts,
  PinWarpPoint,
} from '../../domain';

/**
 * Canvas 2D per-triangle affine texture mapping for bitmap pin-warp (#1460).
 *
 * The evaluated mesh is the single shared deformation source: Stage, Preview,
 * Export, and the editor all draw it through this one module. Each mesh triangle
 * is drawn by clipping to the (slightly expanded) destination triangle, applying
 * the affine map that carries source-image pixels to the deformed triangle, and
 * drawing the whole image once under that transform.
 *
 * Why the whole image instead of a per-triangle source sub-rect: sampling a
 * sub-rect from the source image with bilinear filtering can clamp/bleed edge
 * pixels and produce a dark fringe on transparent artwork edges. Drawing the
 * full image under an exact affine and clipping means every destination pixel
 * samples a real source pixel.
 */

/** The minimal Canvas 2D surface used here; Konva's `Context` and a native `CanvasRenderingContext2D` both satisfy it. */
export interface PinWarpCanvas2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  clip(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number): void;
}

export type PinWarpDrawPlan =
  | { readonly kind: 'plain' }
  | { readonly kind: 'pin-warp'; readonly mesh: EvaluatedPinWarpMesh };

interface Affine2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

function affineTriangle(
  source: readonly [PinWarpPoint, PinWarpPoint, PinWarpPoint],
  destination: readonly [PinWarpPoint, PinWarpPoint, PinWarpPoint],
): Affine2D | null {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const s1x = s1.x - s0.x;
  const s1y = s1.y - s0.y;
  const s2x = s2.x - s0.x;
  const s2y = s2.y - s0.y;
  const determinant = s1x * s2y - s1y * s2x;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }
  const d1x = d1.x - d0.x;
  const d1y = d1.y - d0.y;
  const d2x = d2.x - d0.x;
  const d2y = d2.y - d0.y;
  const inverse = 1 / determinant;
  // A = D * S^-1 where S has the source edge vectors as columns.
  const a = (d1x * s2y - d2x * s1y) * inverse;
  const b = (d1y * s2y - d2y * s1y) * inverse;
  const c = (d2x * s1x - d1x * s2x) * inverse;
  const d = (d2y * s1x - d1y * s2x) * inverse;
  const tx = d0.x - (a * s0.x + c * s0.y);
  const ty = d0.y - (b * s0.x + d * s0.y);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(ty)
  ) {
    return null;
  }
  return { a, b, c, d, tx, ty };
}

function triangleCentroid(
  triangle: readonly [PinWarpPoint, PinWarpPoint, PinWarpPoint],
): PinWarpPoint {
  return {
    x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
    y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
  };
}

/**
 * Moves every triangle vertex slightly away from the centroid. Adjacent
 * triangles then overlap by ~`seamOverlap` local units, hiding the antialiasing
 * hairline that two hard clips would otherwise leave between them. The expanded
 * clip lies under the same affine map and the full image is drawn, so the
 * overlap can only repeat real image pixels (never invent edge color).
 */
function expandTriangle(
  triangle: readonly [PinWarpPoint, PinWarpPoint, PinWarpPoint],
  seamOverlap: number,
): [PinWarpPoint, PinWarpPoint, PinWarpPoint] {
  if (!(seamOverlap > 0)) return [triangle[0], triangle[1], triangle[2]];
  const centroid = triangleCentroid(triangle);
  const expand = (point: PinWarpPoint): PinWarpPoint => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-9)) return { x: point.x, y: point.y };
    return {
      x: point.x + (dx / length) * seamOverlap,
      y: point.y + (dy / length) * seamOverlap,
    };
  };
  return [expand(triangle[0]), expand(triangle[1]), expand(triangle[2])];
}

/**
 * Draws one evaluated pin-warp mesh. Draws exactly one clipped `drawImage` per
 * triangle; degenerate/NaN affine triangles are skipped instead of painted.
 */
export function drawPinWarpImage(
  context: PinWarpCanvas2D,
  image: CanvasImageSource,
  mesh: EvaluatedPinWarpMesh,
): void {
  for (const [a, b, c] of mesh.triangles) {
    const source: [PinWarpPoint, PinWarpPoint, PinWarpPoint] = [
      mesh.uvPerVertex[a]!,
      mesh.uvPerVertex[b]!,
      mesh.uvPerVertex[c]!,
    ];
    const destination: [PinWarpPoint, PinWarpPoint, PinWarpPoint] = [
      mesh.vertices[a]!,
      mesh.vertices[b]!,
      mesh.vertices[c]!,
    ];
    const affine = affineTriangle(source, destination);
    if (!affine) continue;
    const clip = expandTriangle(destination, mesh.seamOverlap);
    context.save();
    context.beginPath();
    context.moveTo(clip[0].x, clip[0].y);
    context.lineTo(clip[1].x, clip[1].y);
    context.lineTo(clip[2].x, clip[2].y);
    context.closePath();
    context.clip();
    context.transform(affine.a, affine.b, affine.c, affine.d, affine.tx, affine.ty);
    context.drawImage(image, 0, 0);
    context.restore();
  }
}

/**
 * Decides whether one Layer visual must be painted through the per-triangle
 * pin-warp path or the ordinary image path. Anything unsupported or invalid
 * degrades to `plain`, so the Layer keeps rendering exactly as before.
 */
export function resolvePinWarpDrawPlan(
  evaluated: Pick<EvaluatedLayer, 'pinWarp'>,
  visual: Pick<LayerVisualParts, 'kind' | 'parts'> | null | undefined,
  options?: { readonly isBackground?: boolean },
): PinWarpDrawPlan {
  if (options?.isBackground) return { kind: 'plain' };
  const pinWarp = evaluated.pinWarp;
  if (!pinWarp || pinWarp.status !== 'valid') return { kind: 'plain' };
  if (!visual || visual.kind !== 'ordinary-image' || visual.parts.length !== 1) {
    return { kind: 'plain' };
  }
  const part = visual.parts[0]!;
  if (
    part.flaGraphic ||
    part.imageTransform ||
    part.rotationDeg !== 0 ||
    part.flipX ||
    part.slot !== 'single'
  ) {
    return { kind: 'plain' };
  }
  return { kind: 'pin-warp', mesh: pinWarp.mesh };
}
