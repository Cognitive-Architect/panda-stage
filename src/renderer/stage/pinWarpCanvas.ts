import type {
  EvaluatedLayer,
  EvaluatedPinWarpMesh,
  LayerVisualParts,
  PinWarpPoint,
  VisualLocalRect,
} from '../../domain';

/**
 * Canvas 2D per-triangle affine texture mapping for bitmap pin-warp (#1460),
 * with single-write seam compositing (#1471 R1).
 *
 * The evaluated mesh is the single shared deformation source: Stage, Preview,
 * Export, and the editor all draw it through this one module. Each mesh triangle
 * is drawn by clipping to the (slightly expanded) destination triangle, applying
 * the exact affine map that carries source-image pixels to the deformed
 * triangle, and drawing the whole image once under that transform.
 *
 * Why the whole image instead of a per-triangle source sub-rect: sampling a
 * sub-rect from the source image with bilinear filtering can clamp/bleed edge
 * pixels and produce a dark fringe on transparent artwork edges. Drawing the
 * full image under an exact affine and clipping means every destination pixel
 * samples a real source pixel.
 *
 * Compositing model (why a scratch surface):
 * Adjacent triangles must overlap slightly (`seamOverlap`) to hide the
 * antialiased clip hairline between them. Painting those expanded clips
 * directly onto the target with the default `source-over` operation blends each
 * seam pixel twice: a 50% alpha bitmap reaches ~75% alpha (≈192 instead of
 * ≈128) and a seam is visible. Instead, the whole mesh is painted once into a
 * transparent scratch surface, where every triangle uses
 * `globalCompositeOperation = 'copy'`: an overlapping triangle replaces the
 * destination pixel instead of accumulating alpha, so each scratch pixel is
 * written exactly once (the last triangle covering it wins). The finished
 * scratch is then blitted to the target with a single `drawImage`, so each
 * *target* pixel also receives exactly one `source-over` write and
 * semi-transparent artwork keeps its authored alpha. Group opacity applies once
 * per blit instead of once per triangle.
 *
 * Seams and real edges stay correct: inside a clip the whole image is still
 * drawn under its exact affine, so a destination pixel outside the image samples
 * nothing (stays transparent) rather than invented edge color, and an overlap
 * only ever replaces real image pixels. The overlap guarantees each interior
 * seam pixel is fully covered by at least one expanded triangle, so there is no
 * transparent crack.
 *
 * A rest/identity mesh (destination vertices equal the source UVs translated by
 * the mesh rect) is drawn as one unclipped `drawImage` and is also routed to the
 * ordinary image node by `resolvePinWarpDrawPlan`, so rest pixels equal the plain
 * bitmap exactly. If the host cannot create a scratch surface the painter falls
 * back to the historical direct per-triangle `source-over` path instead of
 * dropping the Layer.
 */

/** The minimal Canvas 2D surface used here; Konva's native wrapped context and a native `CanvasRenderingContext2D` both satisfy it. */
export interface PinWarpCanvas2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  clip(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth?: number,
    dHeight?: number,
  ): void;
  globalCompositeOperation: GlobalCompositeOperation;
  /** Optional; native contexts expose it. Clears a reused scratch surface. */
  clearRect?(x: number, y: number, width: number, height: number): void;
  /** Native contexts expose it; used to keep the scratch surface at device resolution. */
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
}

/** A transparent offscreen surface the mesh is flattened into before one blit. */
export interface PinWarpScratchSurface {
  readonly canvas: CanvasImageSource;
  readonly context: PinWarpCanvas2D;
}

/**
 * Test seam / host abstraction: allocates the transparent scratch surface the
 * mesh is painted into. The returned surface must be fully transparent; returning
 * `null` degrades to the historical direct per-triangle draw.
 */
export type PinWarpScratchCanvasFactory = (
  width: number,
  height: number,
) => PinWarpScratchSurface | null;

export interface PinWarpDrawOptions {
  readonly createScratchCanvas?: PinWarpScratchCanvasFactory;
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

/** Rest vertices come from MLS with an identity pin set, so this only absorbs float noise. */
const REST_MESH_EPSILON = 1e-6;

/** Above this the scratch allocation can be large; fall back to the direct path. */
const MAX_SCRATCH_PIXELS = 24 * 1024 * 1024;

const IDENTITY_TRANSFORM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * One-entry browser scratch pool: a Stage rAF draw would otherwise allocate a
 * multi-megapixel offscreen canvas on every frame. An exact size match is reused
 * and cleared; any other size allocates once and replaces the entry.
 */
let browserScratchCache: {
  readonly surface: PinWarpScratchSurface;
  readonly width: number;
  readonly height: number;
} | null = null;

function createBrowserScratchSurface(
  width: number,
  height: number,
): PinWarpScratchSurface | null {
  if (typeof document === 'undefined') return null;
  const cached = browserScratchCache;
  if (cached && cached.width === width && cached.height === height) {
    cached.surface.context.clearRect?.(0, 0, width, height);
    return cached.surface;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const surface: PinWarpScratchSurface = { canvas, context };
  browserScratchCache = { surface, width, height };
  return surface;
}

/**
 * True when the evaluated mesh is the exact rest grid: every drawn vertex is its
 * source UV translated by the mesh rect. Such a mesh must be painted as the plain
 * bitmap, never through the per-triangle path.
 */
export function isRestPinWarpMesh(mesh: EvaluatedPinWarpMesh): boolean {
  if (mesh.vertices.length !== mesh.uvPerVertex.length || mesh.vertices.length === 0) {
    return false;
  }
  const originX = mesh.rect.x;
  const originY = mesh.rect.y;
  for (let index = 0; index < mesh.vertices.length; index += 1) {
    const vertex = mesh.vertices[index]!;
    const uv = mesh.uvPerVertex[index]!;
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return false;
    if (Math.abs(vertex.x - (uv.x + originX)) > REST_MESH_EPSILON) return false;
    if (Math.abs(vertex.y - (uv.y + originY)) > REST_MESH_EPSILON) return false;
  }
  return true;
}

/**
 * Local draw bounds of one evaluated mesh: the destination vertex bounds,
 * expanded by `seamOverlap` because the renderer's expanded clips extend that far
 * past the triangle edges. A rest mesh is drawn as the plain image rect exactly.
 * Returns an empty rect for non-finite vertices so callers can skip drawing.
 */
export function pinWarpMeshDrawBounds(mesh: EvaluatedPinWarpMesh): VisualLocalRect {
  if (isRestPinWarpMesh(mesh)) return { ...mesh.rect };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const vertex of mesh.vertices) {
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  }
  if (!(maxX >= minX) || !(maxY >= minY)) return { x: 0, y: 0, width: 0, height: 0 };
  const overlap =
    Number.isFinite(mesh.seamOverlap) && mesh.seamOverlap > 0 ? mesh.seamOverlap : 0;
  return {
    x: minX - overlap,
    y: minY - overlap,
    width: maxX - minX + overlap * 2,
    height: maxY - minY + overlap * 2,
  };
}

/**
 * The one bounds rule shared by the Stage/Preview/Export composite+effects cache
 * and the editor canvas: a warped Layer uses its actual deformed draw bounds, any
 * other Layer keeps its existing `combinedLocalBounds` untouched.
 */
export function resolvePinWarpDrawBounds(
  plainBounds: VisualLocalRect,
  mesh: EvaluatedPinWarpMesh | null | undefined,
): VisualLocalRect {
  return mesh ? pinWarpMeshDrawBounds(mesh) : plainBounds;
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
 * Device-pixel scale of the caller's current transform, so the scratch surface is
 * allocated at the same effective resolution as a direct draw. Missing
 * `getTransform` (fake contexts) is treated as 1:1.
 */
function contextDeviceScale(context: PinWarpCanvas2D): { scaleX: number; scaleY: number } {
  const transform = context.getTransform?.() ?? IDENTITY_TRANSFORM;
  const scaleX = Math.hypot(transform.a, transform.b);
  const scaleY = Math.hypot(transform.c, transform.d);
  return {
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
  };
}

/**
 * Paints every mesh triangle into `context`, which must already use the target
 * origin/scale convention: a local point `p` maps to
 * `((p.x - originX) * scaleX, (p.y - originY) * scaleY)`. `compositeOperation` is
 * `'copy'` for the scratch pass (single write per pixel) and the destination
 * context's operation for the historical direct fallback.
 */
function drawMeshTriangles(
  context: PinWarpCanvas2D,
  image: CanvasImageSource,
  mesh: EvaluatedPinWarpMesh,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number,
  compositeOperation: GlobalCompositeOperation,
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
    context.moveTo((clip[0].x - originX) * scaleX, (clip[0].y - originY) * scaleY);
    context.lineTo((clip[1].x - originX) * scaleX, (clip[1].y - originY) * scaleY);
    context.lineTo((clip[2].x - originX) * scaleX, (clip[2].y - originY) * scaleY);
    context.closePath();
    context.clip();
    // Skip the default source-over accumulation at seams: the scratch pixel is
    // replaced by whichever triangle covers it last (single write).
    context.globalCompositeOperation = compositeOperation;
    context.transform(
      affine.a * scaleX,
      affine.b * scaleY,
      affine.c * scaleX,
      affine.d * scaleY,
      (affine.tx - originX) * scaleX,
      (affine.ty - originY) * scaleY,
    );
    context.drawImage(image, 0, 0);
    context.restore();
  }
}

/**
 * Draws one evaluated pin-warp mesh. A rest mesh is one plain `drawImage`; a
 * deformed mesh is flattened into a scratch surface with per-triangle `'copy'`
 * writes and then blitted to the target once, so no destination pixel blends
 * twice. Degenerate/NaN affine triangles are skipped instead of painted.
 */
export function drawPinWarpImage(
  context: PinWarpCanvas2D,
  image: CanvasImageSource,
  mesh: EvaluatedPinWarpMesh,
  options?: PinWarpDrawOptions,
): void {
  if (isRestPinWarpMesh(mesh)) {
    // Bit-exact ordinary image draw: one unclipped 1:1 blit at the mesh rect.
    context.drawImage(image, mesh.rect.x, mesh.rect.y);
    return;
  }
  const bounds = pinWarpMeshDrawBounds(mesh);
  if (!(bounds.width > 0) || !(bounds.height > 0)) return;
  const { scaleX, scaleY } = contextDeviceScale(context);
  const createScratchCanvas =
    options?.createScratchCanvas ?? createBrowserScratchSurface;
  const scratchWidth = Math.max(1, Math.ceil(bounds.width * scaleX));
  const scratchHeight = Math.max(1, Math.ceil(bounds.height * scaleY));
  if (scratchWidth * scratchHeight <= MAX_SCRATCH_PIXELS) {
    const scratch = createScratchCanvas(scratchWidth, scratchHeight);
    if (scratch) {
      drawMeshTriangles(
        scratch.context,
        image,
        mesh,
        bounds.x,
        bounds.y,
        scaleX,
        scaleY,
        'copy',
      );
      // One source-over write per destination pixel.
      context.drawImage(scratch.canvas, bounds.x, bounds.y, bounds.width, bounds.height);
      return;
    }
  }
  // No scratch surface available: keep the historical direct paint (correct
  // geometry, but semi-transparent seams blend twice).
  drawMeshTriangles(
    context,
    image,
    mesh,
    0,
    0,
    1,
    1,
    context.globalCompositeOperation,
  );
}

/**
 * Resolves the shared evaluated mesh for the per-triangle path, or `null` when
 * the Layer must use the ordinary image path. Anything unsupported or invalid
 * degrades to `null`, so the Layer keeps rendering exactly as before. Used by the
 * editor to keep its pin handles visible even when a rest mesh draws as the plain
 * bitmap.
 */
export function resolvePinWarpMesh(
  evaluated: Pick<EvaluatedLayer, 'pinWarp'>,
  visual: Pick<LayerVisualParts, 'kind' | 'parts'> | null | undefined,
  options?: { readonly isBackground?: boolean },
): EvaluatedPinWarpMesh | null {
  if (options?.isBackground) return null;
  const pinWarp = evaluated.pinWarp;
  if (!pinWarp || pinWarp.status !== 'valid') return null;
  if (!visual || visual.kind !== 'ordinary-image' || visual.parts.length !== 1) {
    return null;
  }
  const part = visual.parts[0]!;
  if (
    part.flaGraphic ||
    part.imageTransform ||
    part.rotationDeg !== 0 ||
    part.flipX ||
    part.slot !== 'single'
  ) {
    return null;
  }
  return pinWarp.mesh;
}

/**
 * Decides whether one Layer visual must be painted through the per-triangle
 * pin-warp path or the ordinary image path. A strict rest/identity mesh is routed
 * to `plain` too, so rest pixels equal the plain bitmap exactly.
 */
export function resolvePinWarpDrawPlan(
  evaluated: Pick<EvaluatedLayer, 'pinWarp'>,
  visual: Pick<LayerVisualParts, 'kind' | 'parts'> | null | undefined,
  options?: { readonly isBackground?: boolean },
): PinWarpDrawPlan {
  const mesh = resolvePinWarpMesh(evaluated, visual, options);
  if (!mesh || isRestPinWarpMesh(mesh)) return { kind: 'plain' };
  return { kind: 'pin-warp', mesh };
}
