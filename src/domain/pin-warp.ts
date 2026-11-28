import type { Layer } from './models/layer';
import type { PinWarp, PinWarpMeshDensity, PinWarpPoint } from './models/pinWarp';
import {
  PIN_WARP_MAX_MESH_CELLS,
  PIN_WARP_MAX_PINS,
  PIN_WARP_MAX_POSES,
  PIN_WARP_MIN_MESH_CELLS,
  PIN_WARP_MIN_PINS,
} from './models/pinWarp';
import { isValidFrameTime, lastValidFrameTime, resolveTimelineFrameTime } from './timeline/frame-grid';

/**
 * Deterministic pin-warp geometry (#1460, FLA-RIG-07B / R-D / R06 prototype).
 *
 * Algorithm reference: AniCraft `crates/doc/src/warp.rs` @ aa74ed7
 * (MIT OR Apache-2.0) — rest/at pins, a deterministic triangulated grid, rigid
 * moving-least-squares (Schaefer, McPhail & Warren, *Image deformation using
 * moving least squares*, SIGGRAPH 2006 §2.3), and piecewise-affine textured
 * triangles. Only the geometry and authoring semantics are ported; the Rust
 * document model is not.
 *
 * Invariants:
 * - pure and deterministic: same inputs always produce the same vertices,
 *   triangles, and order (no clock, no randomness, no motion history);
 * - pose evaluation is resolved from rest each time (never accumulated);
 * - a broken/degenerate warp reports an explicit invalid result; it never
 *   yields NaN or throws into a frame.
 */

export interface PinWarpRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EvaluatedPinWarpMesh {
  /** Layer-local rect the grid covers (the image `localRect`). */
  readonly rect: PinWarpRect;
  readonly columns: number;
  readonly rows: number;
  /** Grid vertices as drawn (rest), row-major, stable order. */
  readonly restVertices: readonly PinWarpPoint[];
  /** Grid vertices after the pinned rigid MLS deformation. */
  readonly vertices: readonly PinWarpPoint[];
  /** Per-vertex source-image pixel UV, same order as the vertices. */
  readonly uvPerVertex: readonly PinWarpPoint[];
  /** Two triangles per cell, row-major, alternating diagonals. */
  readonly triangles: readonly (readonly [number, number, number])[];
  /** Diagnostics only: triangles whose orientation flipped under the pins. */
  readonly flippedTriangleCount: number;
  /** Extra local-unit overlap used by the renderer to hide triangle seams. */
  readonly seamOverlap: number;
}

export type PinWarpPoseSampleMode = 'exact' | 'between' | 'hold-before' | 'hold-after';

export type PinWarpInvalidReason =
  | 'unsupported-layer'
  | 'missing-asset'
  | 'invalid-local-rect'
  | 'invalid-mesh'
  | 'pin-count-mismatch'
  | 'duplicate-pins'
  | 'non-finite'
  | 'pose-times-not-ascending'
  | 'degenerate-triangle';

export interface PinWarpPoseSample {
  readonly status: 'valid';
  readonly pins: readonly PinWarpPoint[];
  readonly mode: PinWarpPoseSampleMode;
  /** Authored pose time the sample resolves from (segment start or exact pose). */
  readonly sampleTimeMs: number;
}

export type PinWarpPoseResult =
  | PinWarpPoseSample
  | { readonly status: 'invalid'; readonly reason: PinWarpInvalidReason };

export type PinWarpMeshResult =
  | { readonly status: 'valid'; readonly mesh: EvaluatedPinWarpMesh }
  | { readonly status: 'invalid'; readonly reason: PinWarpInvalidReason };

export type EvaluatedPinWarp =
  | {
      readonly status: 'valid';
      readonly mesh: EvaluatedPinWarpMesh;
      /** Evaluated pin positions (`at`) at the sampled time, layer-local pixels. */
      readonly pins: readonly PinWarpPoint[];
      readonly mode: PinWarpPoseSampleMode;
    }
  | { readonly status: 'invalid'; readonly reason: PinWarpInvalidReason };

const DUPLICATE_PIN_DISTANCE = 1e-6;
const COLLAPSED_TRIANGLE_AREA = 1e-9;
/**
 * Net-zero pin drag tolerance in layer-local image pixels (#1471 R5). A drag
 * that returns to the currently evaluated pin position is not an edit.
 */
const PIN_WARP_PIN_NOOP_EPSILON = 1e-6;

function pinPointsWithinNoopEpsilon(
  left: PinWarpPoint,
  right: PinWarpPoint,
): boolean {
  return (
    Math.abs(left.x - right.x) <= PIN_WARP_PIN_NOOP_EPSILON &&
    Math.abs(left.y - right.y) <= PIN_WARP_PIN_NOOP_EPSILON
  );
}

export function isFinitePinWarpPoint(point: unknown): point is PinWarpPoint {
  return Boolean(
    point &&
      typeof point === 'object' &&
      Number.isFinite((point as PinWarpPoint).x) &&
      Number.isFinite((point as PinWarpPoint).y),
  );
}

/** The image `localRect` used by `resolveLayerVisualParts` for an ordinary asset Layer. */
export function pinWarpRectForImage(
  width: number,
  height: number,
): PinWarpRect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { x: -width / 2, y: -height / 2, width, height };
}

function validRect(rect: PinWarpRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function validDensity(density: PinWarpMeshDensity): boolean {
  return (
    Number.isInteger(density.columns) &&
    Number.isInteger(density.rows) &&
    density.columns >= PIN_WARP_MIN_MESH_CELLS &&
    density.rows >= PIN_WARP_MIN_MESH_CELLS &&
    density.columns <= PIN_WARP_MAX_MESH_CELLS &&
    density.rows <= PIN_WARP_MAX_MESH_CELLS
  );
}

function cellVertexIndex(columns: number, column: number, row: number): number {
  return row * (columns + 1) + column;
}

/** Whether cell `(column,row)`'s diagonal runs top-left → bottom-right. */
function fallingDiagonal(column: number, row: number): boolean {
  return (column + row) % 2 === 0;
}

/**
 * Builds the deterministic rest grid over `rect`: `(columns+1) × (rows+1)`
 * row-major vertices and two triangles per cell with alternating diagonals so
 * the mesh has no preferred direction. Returns `null` for an unusable rect.
 */
export function buildPinWarpGrid(
  rect: PinWarpRect,
  density: PinWarpMeshDensity,
): {
  readonly restVertices: PinWarpPoint[];
  readonly uvPerVertex: PinWarpPoint[];
  readonly triangles: [number, number, number][];
} | null {
  if (!validRect(rect) || !validDensity(density)) return null;
  const { columns, rows } = density;
  const restVertices: PinWarpPoint[] = [];
  const uvPerVertex: PinWarpPoint[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const y = row === rows ? rect.y + rect.height : rect.y + (rect.height * row) / rows;
    for (let column = 0; column <= columns; column += 1) {
      const x =
        column === columns
          ? rect.x + rect.width
          : rect.x + (rect.width * column) / columns;
      restVertices.push({ x, y });
      uvPerVertex.push({ x: x - rect.x, y: y - rect.y });
    }
  }
  const triangles: [number, number, number][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = cellVertexIndex(columns, column, row);
      const b = cellVertexIndex(columns, column + 1, row);
      const c = cellVertexIndex(columns, column, row + 1);
      const d = cellVertexIndex(columns, column + 1, row + 1);
      if (fallingDiagonal(column, row)) {
        triangles.push([a, b, d], [a, d, c]);
      } else {
        triangles.push([a, b, c], [b, d, c]);
      }
    }
  }
  return { restVertices, uvPerVertex, triangles };
}

interface PointPair {
  readonly from: PinWarpPoint;
  readonly to: PinWarpPoint;
}

function mlsRigidAtPower(pairs: readonly PointPair[], point: PinWarpPoint, power: number): PinWarpPoint {
  if (pairs.length === 0) return { x: point.x, y: point.y };
  const vx = point.x;
  const vy = point.y;
  let sumWeight = 0;
  let px = 0;
  let py = 0;
  let qx = 0;
  let qy = 0;
  const weights: number[] = [];
  for (const { from, to } of pairs) {
    const dx = from.x - vx;
    const dy = from.y - vy;
    const distanceSquared = dx * dx + dy * dy;
    // A point exactly on a pin goes with that pin (AniCraft warp.rs mls_rigid).
    if (distanceSquared < 1e-12) return { x: to.x, y: to.y };
    const weight = 1 / Math.pow(distanceSquared, power / 2);
    weights.push(weight);
    sumWeight += weight;
    px += weight * from.x;
    py += weight * from.y;
    qx += weight * to.x;
    qy += weight * to.y;
  }
  if (!(sumWeight > 0) || !Number.isFinite(sumWeight)) {
    return { x: point.x, y: point.y };
  }
  const centerX = px / sumWeight;
  const centerY = py / sumWeight;
  const targetX = qx / sumWeight;
  const targetY = qy / sumWeight;
  let dot = 0;
  let cross = 0;
  for (const [index, { from, to }] of pairs.entries()) {
    const ax = from.x - centerX;
    const ay = from.y - centerY;
    const bx = to.x - targetX;
    const by = to.y - targetY;
    const weight = weights[index]!;
    dot += weight * (ax * bx + ay * by);
    cross += weight * (ax * by - ay * bx);
  }
  const radius = Math.hypot(dot, cross);
  const cosine = radius > 1e-18 && Number.isFinite(radius) ? dot / radius : 1;
  const sine = radius > 1e-18 && Number.isFinite(radius) ? cross / radius : 0;
  const dx = vx - centerX;
  const dy = vy - centerY;
  const out = {
    x: targetX + cosine * dx - sine * dy,
    y: targetY + sine * dx + cosine * dy,
  };
  return Number.isFinite(out.x) && Number.isFinite(out.y)
    ? out
    : { x: point.x, y: point.y };
}

/**
 * Rigid moving-least-squares deformation of `point` by `from → to` pin pairs.
 * Primary weights are `1/|from - point|²`; a `1/|from - point|⁴` retry and
 * finally the identity are used if the primary solve is numerically unusable,
 * so a pathological pin layout can never emit NaN.
 */
export function mlsRigid(
  pairs: readonly PointPair[],
  point: PinWarpPoint,
): PinWarpPoint {
  const primary = mlsRigidAtPower(pairs, point, 2);
  if (Number.isFinite(primary.x) && Number.isFinite(primary.y)) return primary;
  const sharpened = mlsRigidAtPower(pairs, point, 4);
  if (Number.isFinite(sharpened.x) && Number.isFinite(sharpened.y)) {
    return sharpened;
  }
  return { x: point.x, y: point.y };
}

function triangleArea(a: PinWarpPoint, b: PinWarpPoint, c: PinWarpPoint): number {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

/**
 * Evaluates the pinned mesh: `restPins` (as drawn) → `pins` (where they are)
 * carried onto every grid vertex with rigid MLS. Reports invalid input instead
 * of producing NaN/collapsed geometry.
 */
export function evaluatePinWarpMesh(input: {
  readonly restPins: readonly PinWarpPoint[];
  readonly pins: readonly PinWarpPoint[];
  readonly mesh: PinWarpMeshDensity;
  readonly rect: PinWarpRect;
}): PinWarpMeshResult {
  const { restPins, pins, mesh, rect } = input;
  if (!validRect(rect)) {
    return { status: 'invalid', reason: 'invalid-local-rect' };
  }
  if (
    restPins.length !== pins.length ||
    restPins.length < PIN_WARP_MIN_PINS ||
    restPins.length > PIN_WARP_MAX_PINS
  ) {
    return { status: 'invalid', reason: 'pin-count-mismatch' };
  }
  if (!restPins.every(isFinitePinWarpPoint) || !pins.every(isFinitePinWarpPoint)) {
    return { status: 'invalid', reason: 'non-finite' };
  }
  for (let left = 0; left < restPins.length; left += 1) {
    for (let right = left + 1; right < restPins.length; right += 1) {
      const dx = restPins[left]!.x - restPins[right]!.x;
      const dy = restPins[left]!.y - restPins[right]!.y;
      if (Math.hypot(dx, dy) < DUPLICATE_PIN_DISTANCE) {
        return { status: 'invalid', reason: 'duplicate-pins' };
      }
    }
  }
  const grid = buildPinWarpGrid(rect, mesh);
  if (!grid) {
    return { status: 'invalid', reason: 'invalid-mesh' };
  }
  const pairs = restPins.map((from, index) => ({ from, to: pins[index]! }));
  const vertices = grid.restVertices.map((vertex) => mlsRigid(pairs, vertex));
  if (!vertices.every(isFinitePinWarpPoint)) {
    return { status: 'invalid', reason: 'non-finite' };
  }
  let degenerate = false;
  let flippedTriangleCount = 0;
  for (const [a, b, c] of grid.triangles) {
    const restArea = triangleArea(grid.restVertices[a]!, grid.restVertices[b]!, grid.restVertices[c]!);
    const shownArea = triangleArea(vertices[a]!, vertices[b]!, vertices[c]!);
    if (Math.abs(shownArea) < COLLAPSED_TRIANGLE_AREA) {
      degenerate = true;
      break;
    }
    if (Math.sign(shownArea) !== Math.sign(restArea)) {
      flippedTriangleCount += 1;
    }
  }
  if (degenerate) {
    return { status: 'invalid', reason: 'degenerate-triangle' };
  }
  const cellWidth = rect.width / mesh.columns;
  const cellHeight = rect.height / mesh.rows;
  const seamOverlap = Math.min(
    2,
    Math.max(0.5, Math.min(cellWidth, cellHeight) * 0.02),
  );
  return {
    status: 'valid',
    mesh: {
      rect,
      columns: mesh.columns,
      rows: mesh.rows,
      restVertices: grid.restVertices,
      vertices,
      uvPerVertex: grid.uvPerVertex,
      triangles: grid.triangles,
      flippedTriangleCount,
      seamOverlap,
    },
  };
}

function lerpPoint(from: PinWarpPoint, to: PinWarpPoint, progress: number): PinWarpPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

/**
 * Resolves the pose at `timeMs`: exact at authored times, linear between
 * adjacent poses, hold before the first / after the last pose. Deterministic
 * and evaluated from the authored poses only (no motion history).
 */
export function resolvePinWarpPoseAtTime(
  pinWarp: PinWarp,
  timeMs: number,
): PinWarpPoseResult {
  const { restPins, poses } = pinWarp;
  if (!Number.isFinite(timeMs)) {
    return { status: 'invalid', reason: 'non-finite' };
  }
  let previousTimeMs = -1;
  for (const pose of poses) {
    if (pose.timeMs <= previousTimeMs) {
      return { status: 'invalid', reason: 'pose-times-not-ascending' };
    }
    previousTimeMs = pose.timeMs;
    if (pose.pins.length !== restPins.length) {
      return { status: 'invalid', reason: 'pin-count-mismatch' };
    }
    if (!pose.pins.every(isFinitePinWarpPoint)) {
      return { status: 'invalid', reason: 'non-finite' };
    }
  }
  if (poses.length === 0) {
    return { status: 'invalid', reason: 'invalid-mesh' };
  }
  const first = poses[0]!;
  const last = poses[poses.length - 1]!;
  if (timeMs <= first.timeMs) {
    return {
      status: 'valid',
      pins: first.pins,
      mode: timeMs === first.timeMs ? 'exact' : 'hold-before',
      sampleTimeMs: first.timeMs,
    };
  }
  if (timeMs >= last.timeMs) {
    return {
      status: 'valid',
      pins: last.pins,
      mode: timeMs === last.timeMs ? 'exact' : 'hold-after',
      sampleTimeMs: last.timeMs,
    };
  }
  for (let index = 0; index < poses.length - 1; index += 1) {
    const from = poses[index]!;
    const to = poses[index + 1]!;
    if (timeMs < from.timeMs || timeMs > to.timeMs) continue;
    if (timeMs === from.timeMs) {
      return { status: 'valid', pins: from.pins, mode: 'exact', sampleTimeMs: from.timeMs };
    }
    if (timeMs === to.timeMs) {
      return { status: 'valid', pins: to.pins, mode: 'exact', sampleTimeMs: to.timeMs };
    }
    const progress = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    return {
      status: 'valid',
      pins: from.pins.map((pin, pinIndex) =>
        lerpPoint(pin, to.pins[pinIndex]!, progress),
      ),
      mode: 'between',
      sampleTimeMs: from.timeMs,
    };
  }
  // Unreachable for strictly ascending, in-range poses; hold the final pose.
  return {
    status: 'valid',
    pins: last.pins,
    mode: 'hold-after',
    sampleTimeMs: last.timeMs,
  };
}

/**
 * Evaluates one Layer's pin warp at a time. Only ordinary image-asset Layers are
 * supported by this prototype slice; anything else degrades to an explicit
 * invalid result so consumers draw the ordinary un-warped image.
 */
export function evaluateLayerPinWarp(input: {
  readonly pinWarp: PinWarp | undefined;
  readonly sourceKind: Layer['source']['kind'];
  readonly asset: { readonly width: number; readonly height: number; readonly kind: string } | null;
  readonly timeMs: number;
}): EvaluatedPinWarp | undefined {
  const { pinWarp, sourceKind, asset, timeMs } = input;
  if (!pinWarp) return undefined;
  if (sourceKind !== 'asset') {
    return { status: 'invalid', reason: 'unsupported-layer' };
  }
  if (!asset || asset.kind !== 'image') {
    return { status: 'invalid', reason: 'missing-asset' };
  }
  const rect = pinWarpRectForImage(asset.width, asset.height);
  if (!rect) {
    return { status: 'invalid', reason: 'invalid-local-rect' };
  }
  const pose = resolvePinWarpPoseAtTime(pinWarp, timeMs);
  if (pose.status === 'invalid') return pose;
  const meshResult = evaluatePinWarpMesh({
    restPins: pinWarp.restPins,
    pins: pose.pins,
    mesh: pinWarp.mesh,
    rect,
  });
  if (meshResult.status === 'invalid') return meshResult;
  return {
    status: 'valid',
    mesh: meshResult.mesh,
    pins: pose.pins,
    mode: pose.mode,
  };
}

/** Seed pin positions: three columns × two rows across the image rect (6 pins). */
export function seedPinWarpPoints(rect: PinWarpRect): PinWarpPoint[] {
  const points: PinWarpPoint[] = [];
  for (const yFraction of [0, 1] as const) {
    for (const xFraction of [0, 0.5, 1] as const) {
      points.push({
        x: rect.x + rect.width * xFraction,
        y: rect.y + rect.height * yFraction,
      });
    }
  }
  return points;
}

export const PIN_WARP_DEFAULT_MESH: PinWarpMeshDensity = { columns: 4, rows: 3 };

/** Creates a new, un-deformed pin warp with one pose at `timeMs`. */
export function createPinWarp(
  rect: PinWarpRect,
  timeMs: number,
  mesh: PinWarpMeshDensity = PIN_WARP_DEFAULT_MESH,
): PinWarp {
  const restPins = seedPinWarpPoints(rect);
  return {
    mesh: { columns: mesh.columns, rows: mesh.rows },
    restPins,
    poses: [{ timeMs, pins: restPins.map(({ x, y }) => ({ x, y })) }],
  };
}

function clonePoint(point: PinWarpPoint): PinWarpPoint {
  return { x: point.x, y: point.y };
}

function sortedPoses(poses: readonly PinWarp['poses'][number][]): PinWarp['poses'] {
  return [...poses].sort((left, right) => left.timeMs - right.timeMs);
}

/**
 * Writes one pin at `timeMs`. An existing exact-time pose is updated; otherwise
 * a new pose is inserted at that time from the currently evaluated pose (an
 * auto-key). One call = one authoring action. A net-zero drag (the requested
 * point equals the evaluated pin at that time) returns the same `pinWarp`
 * reference so no auto-key, project update, or History entry is created. The
 * explicit `addPinWarpPoseAtTime` still records the current pose on demand.
 */
export function setPinWarpPinAtTime(input: {
  readonly pinWarp: PinWarp;
  readonly timeMs: number;
  readonly pinIndex: number;
  readonly point: PinWarpPoint;
}): PinWarp {
  const { pinWarp, timeMs, pinIndex, point } = input;
  if (pinIndex < 0 || pinIndex >= pinWarp.restPins.length) {
    throw new Error('控制点序号超出范围。');
  }
  const evaluated = resolvePinWarpPoseAtTime(pinWarp, timeMs);
  if (evaluated.status === 'invalid') {
    throw new Error('当前控制点姿态无效，无法记录。');
  }
  const evaluatedPin = evaluated.pins[pinIndex]!;
  if (pinPointsWithinNoopEpsilon(evaluatedPin, point)) {
    return pinWarp;
  }
  const existing = pinWarp.poses.find((pose) => pose.timeMs === timeMs);
  if (existing) {
    return {
      ...pinWarp,
      poses: pinWarp.poses.map((pose) =>
        pose === existing
          ? {
              timeMs,
              pins: pose.pins.map((pin, index) =>
                index === pinIndex ? clonePoint(point) : pin,
              ),
            }
          : pose,
      ),
    };
  }
  if (pinWarp.poses.length >= PIN_WARP_MAX_POSES) {
    throw new Error(`控制点姿态最多 ${PIN_WARP_MAX_POSES} 个。`);
  }
  const pins = evaluated.pins.map(clonePoint);
  pins[pinIndex] = clonePoint(point);
  return {
    ...pinWarp,
    poses: sortedPoses([...pinWarp.poses, { timeMs, pins }]),
  };
}

/** Adds (or leaves unchanged) a pose at `timeMs` holding the evaluated pins. */
export function addPinWarpPoseAtTime(pinWarp: PinWarp, timeMs: number): PinWarp {
  if (pinWarp.poses.some((pose) => pose.timeMs === timeMs)) return pinWarp;
  const evaluated = resolvePinWarpPoseAtTime(pinWarp, timeMs);
  if (evaluated.status === 'invalid') {
    throw new Error('当前控制点姿态无效，无法记录。');
  }
  if (pinWarp.poses.length >= PIN_WARP_MAX_POSES) {
    throw new Error(`控制点姿态最多 ${PIN_WARP_MAX_POSES} 个。`);
  }
  return {
    ...pinWarp,
    poses: sortedPoses([
      ...pinWarp.poses,
      { timeMs, pins: evaluated.pins.map(clonePoint) },
    ]),
  };
}

/** Removes the exact-time pose; the last remaining pose cannot be removed. */
export function removePinWarpPoseAtTime(pinWarp: PinWarp, timeMs: number): PinWarp {
  const existing = pinWarp.poses.find((pose) => pose.timeMs === timeMs);
  if (!existing) return pinWarp;
  if (pinWarp.poses.length <= 1) {
    throw new Error('至少保留一个控制点姿态。');
  }
  return {
    ...pinWarp,
    poses: pinWarp.poses.filter((pose) => pose !== existing),
  };
}

/** Resets the exact-time pose (or every pose when `timeMs` is undefined) to rest. */
export function resetPinWarpPoseToRest(
  pinWarp: PinWarp,
  timeMs?: number,
): PinWarp {
  const rest = pinWarp.restPins.map(clonePoint);
  if (timeMs === undefined) {
    return {
      ...pinWarp,
      poses: pinWarp.poses.map((pose) => ({ timeMs: pose.timeMs, pins: rest.map(clonePoint) })),
    };
  }
  let changed = false;
  const poses = pinWarp.poses.map((pose) => {
    if (pose.timeMs !== timeMs) return pose;
    changed = true;
    return { timeMs: pose.timeMs, pins: rest.map(clonePoint) };
  });
  return changed ? { ...pinWarp, poses } : pinWarp;
}

/** Reseeds the rest pins for `rect` and resets every pose to that rest shape. */
export function reseedPinWarpPins(pinWarp: PinWarp, rect: PinWarpRect): PinWarp {
  const restPins = seedPinWarpPoints(rect);
  return {
    mesh: { ...pinWarp.mesh },
    restPins,
    poses: pinWarp.poses.map((pose) => ({
      timeMs: pose.timeMs,
      pins: restPins.map(clonePoint),
    })),
  };
}

/** Changes the mesh cell density only; pins and poses are preserved. */
export function setPinWarpMeshDensity(
  pinWarp: PinWarp,
  mesh: PinWarpMeshDensity,
): PinWarp {
  if (!validDensity(mesh)) {
    throw new Error('变形网格行列数超出范围。');
  }
  if (pinWarp.mesh.columns === mesh.columns && pinWarp.mesh.rows === mesh.rows) {
    return pinWarp;
  }
  return { ...pinWarp, mesh: { columns: mesh.columns, rows: mesh.rows } };
}

export interface PinWarpValidationIssue {
  readonly message: string;
}

/**
 * Authoring validation against a concrete Shot: pin counts, strictly ascending
 * on-grid pose times inside the Shot, finite values, and a usable mesh. Used by
 * services before writing; the persisted reader stays tolerant for load-time
 * local degradation.
 */
export function validatePinWarpForShot(
  pinWarp: PinWarp,
  shotDurationMs: number,
): PinWarpValidationIssue[] {
  const issues: PinWarpValidationIssue[] = [];
  const { restPins, poses, mesh } = pinWarp;
  if (restPins.length < PIN_WARP_MIN_PINS || restPins.length > PIN_WARP_MAX_PINS) {
    issues.push({
      message: `控制点数量必须在 ${PIN_WARP_MIN_PINS}–${PIN_WARP_MAX_PINS} 之间。`,
    });
  }
  if (!validDensity(mesh)) {
    issues.push({ message: '变形网格行列数超出范围。' });
  }
  if (!restPins.every(isFinitePinWarpPoint)) {
    issues.push({ message: '控制点坐标必须是有限数字。' });
  }
  if (poses.length === 0 || poses.length > PIN_WARP_MAX_POSES) {
    issues.push({ message: `控制点姿态数量必须在 1–${PIN_WARP_MAX_POSES} 之间。` });
  }
  let previousTimeMs = -1;
  for (const [poseIndex, pose] of poses.entries()) {
    if (pose.pins.length !== restPins.length) {
      issues.push({
        message: `第 ${poseIndex + 1} 个姿态的控制点数量与初始控制点不一致。`,
      });
    }
    if (!pose.pins.every(isFinitePinWarpPoint)) {
      issues.push({ message: `第 ${poseIndex + 1} 个姿态包含非有限坐标。` });
    }
    if (pose.timeMs <= previousTimeMs) {
      issues.push({ message: '姿态时间必须严格递增。' });
      break;
    }
    previousTimeMs = pose.timeMs;
    if (!isValidFrameTime(pose.timeMs)) {
      issues.push({ message: '姿态时间必须落在项目帧网格上。' });
      break;
    }
    if (pose.timeMs > shotDurationMs) {
      issues.push({ message: '姿态时间超出镜头时长。' });
      break;
    }
  }
  return issues;
}

/** Snaps an arbitrary UI time to a legal authoring frame inside the Shot. */
export function resolvePinWarpAuthoringTimeMs(
  requestedTimeMs: number,
  shotDurationMs: number,
): number {
  const snapped = resolveTimelineFrameTime(requestedTimeMs, shotDurationMs);
  return isValidFrameTime(snapped) ? snapped : lastValidFrameTime(shotDurationMs);
}
