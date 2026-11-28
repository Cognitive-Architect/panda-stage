import {
  type FlaVectorPathCommand,
} from '../fla-shape-vector';

/**
 * Fill-rule normalization for author-level coverage masks (#1464 R3, #1469 F4).
 *
 * A single Konva `Path2D` clip can carry only ONE fill rule, while authored FLA
 * regions may be `nonzero` or `evenodd` and are often merged from several child
 * shapes. This module converts one region into a stage-space `nonzero`
 * representation whose winding is non-negative everywhere, so that merging
 * several regions into one `nonzero` path is their exact union.
 *
 * Exactness boundary (#1469 F4): normalization is only applied to LINE-ONLY
 * contours. A polygon is its own exact geometry (no flattening is involved), so
 * the self-intersection / mutual-intersection / containment tests below use
 * exact (`+/-` floating point) segment math, not sampling. Bézier contours are
 * never converted here: flattening a curve into a fixed number of line segments
 * is an approximation, not an equivalence proof — two real curves can cross
 * between samples, so an evenodd<->nonzero conversion decided from that polyline
 * can invert winding. Callers keep the authored curve path with its authored
 * fill rule where that is exact (a mask made of a single region, or same-rule
 * regions whose exact bounds are provably disjoint) and otherwise report a
 * typed `unsupported-curve-fill-rule`; `coverageMaskGeometry.ts` owns that
 * decision and the merge eligibility.
 *
 * - `evenodd` (polygons): with non-crossing, non-touching nested contours the
 *   filled set is exactly the odd nesting depth. Orienting every contour by its
 *   nesting parity (`+1` for even depth, `-1` for odd) makes the winding `1` on
 *   filled faces and `0` on holes, so it is provably equivalent to the authored
 *   `evenodd` fill.
 * - `nonzero` (polygons): the authored winding per nesting face is
 *   `sum(orientation)`. When every face winding is already non-negative (or the
 *   whole region can be globally reversed to become non-negative) the region is
 *   kept; otherwise a single `nonzero` clip cannot represent the union without
 *   cancellation and the region is reported as
 *   `unsupported-fill-rule-conversion`.
 *
 * Because every region emitted from this module has non-negative winding,
 * merging several of them into one `nonzero` path is their union: an overlap
 * sums to >= 2 and a hole (0) can be filled by another region.
 */

export type CoverageMaskFillRule = 'nonzero' | 'evenodd';

export type CoverageMaskFillRuleIssueCode =
  | 'unsupported-fill-rule-conversion'
  | 'unsupported-geometry'
  /**
   * A curve contour needs a fill-rule conversion (or a cross-region merge) that
   * cannot be proven exact without a real curve-intersection engine. The caller
   * degrades that contribution/region locally instead of sampling it.
   */
  | 'unsupported-curve-fill-rule';

export type CoverageMaskFillRuleConversion =
  | {
      readonly ok: true;
      /** Stage-space contours normalized to a non-negative `nonzero` winding. */
      readonly contours: readonly (readonly FlaVectorPathCommand[])[];
    }
  | {
      readonly ok: false;
      readonly code: CoverageMaskFillRuleIssueCode;
      readonly detail: string;
    };

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Stage-space axis-aligned bounds; conservative superset for curve commands. */
export interface CoverageMaskBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface Segment {
  readonly kind: 'L' | 'Q' | 'C';
  readonly start: Point;
  readonly end: Point;
  readonly control1: Point;
  readonly control2: Point;
}

interface ContourGeometry {
  readonly commands: readonly FlaVectorPathCommand[];
  readonly points: readonly Point[];
  /** Signed shoelace area in stage coordinates; its sign is the orientation. */
  readonly signedArea: number;
}

/** Bounds keep the containment/intersection proof deterministic and cheap. */
const MAX_CONTOUR_POINTS = 1_024;
const MAX_REGION_CONTOURS = 64;
const MAX_REGION_POINTS = 4_096;
/** Upper bound on segment-pair tests per region before reporting complexity. */
const MAX_SEGMENT_PAIR_TESTS = 400_000;
/** Smaller than any visually meaningful stage-space area (1920x1080 output). */
const MIN_CONTOUR_AREA = 1e-3;
const EPSILON = 1e-9;

function samePoint(left: Point, right: Point): boolean {
  return (
    Math.abs(left.x - right.x) <= EPSILON &&
    Math.abs(left.y - right.y) <= EPSILON
  );
}

/**
 * True when a contour contains Bézier segments. Such contours are never
 * fill-rule normalized: see the module header for the exactness boundary.
 */
export function coverageContourHasCurve(
  commands: readonly FlaVectorPathCommand[],
): boolean {
  return commands.some((command) => command.type === 'Q' || command.type === 'C');
}

function includePoint(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

/**
 * Conservative stage-space bounds of one contour. Curve control points are
 * included, so the returned box always contains the real curve: a disjointness
 * proof from these bounds is exact (it can only report "overlapping" for shapes
 * that are actually apart, never the reverse).
 */
export function coverageContourBounds(
  commands: readonly FlaVectorPathCommand[],
): CoverageMaskBounds | null {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let hasPoint = false;
  for (const command of commands) {
    if (command.type === 'Z') continue;
    hasPoint = true;
    if (command.type === 'Q') {
      includePoint(bounds, command.cx, command.cy);
    } else if (command.type === 'C') {
      includePoint(bounds, command.c1x, command.c1y);
      includePoint(bounds, command.c2x, command.c2y);
    }
    includePoint(bounds, command.x, command.y);
  }
  if (!hasPoint) return null;
  return bounds;
}

/** Strict separation; touching boxes are treated as overlapping (conservative). */
export function coverageBoundsDisjoint(
  left: CoverageMaskBounds,
  right: CoverageMaskBounds,
): boolean {
  return (
    left.maxX < right.minX ||
    right.maxX < left.minX ||
    left.maxY < right.minY ||
    right.maxY < left.minY
  );
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Splits a contour into explicit segments, adding the implicit closing segment
 * SVG fills apply when the last point differs from the first.
 */
function contourSegments(
  commands: readonly FlaVectorPathCommand[],
): Segment[] | null {
  const first = commands[0];
  if (!first || first.type !== 'M') return null;
  const segments: Segment[] = [];
  let current: Point = { x: first.x, y: first.y };
  for (let index = 1; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === 'Z') continue;
    if (command.type === 'M') return null;
    const end: Point = { x: command.x, y: command.y };
    if (command.type === 'L') {
      segments.push({
        kind: 'L',
        start: current,
        end,
        control1: current,
        control2: end,
      });
    } else if (command.type === 'Q') {
      const control = { x: command.cx, y: command.cy };
      segments.push({ kind: 'Q', start: current, end, control1: control, control2: end });
    } else {
      segments.push({
        kind: 'C',
        start: current,
        end,
        control1: { x: command.c1x, y: command.c1y },
        control2: { x: command.c2x, y: command.c2y },
      });
    }
    current = end;
  }
  const start = { x: first.x, y: first.y };
  if (segments.length === 0) return [];
  if (!samePoint(current, start)) {
    segments.push({ kind: 'L', start: current, end: start, control1: current, control2: start });
  }
  return segments;
}

/**
 * Vertices of a polygon contour. The caller has already rejected Bézier
 * contours, so a non-line segment is a programming error in the proof path and
 * is reported instead of being flattened approximately.
 */
function polygonPoints(segments: readonly Segment[]): Point[] | null {
  if (segments.length === 0) return [];
  const points: Point[] = [segments[0]!.start];
  for (const segment of segments) {
    if (segment.kind !== 'L') return null;
    points.push(segment.end);
  }
  // Drop a duplicated closing point; the polygon is implicitly closed.
  while (points.length > 1 && samePoint(points[points.length - 1]!, points[0]!)) {
    points.pop();
  }
  return points;
}

function signedArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return samePoint(point, start);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  if (t < -EPSILON || t > 1 + EPSILON) return false;
  const projected = { x: start.x + t * dx, y: start.y + t * dy };
  return Math.hypot(point.x - projected.x, point.y - projected.y) <= 1e-6;
}

/** True when the two closed segments share at least one point (touching counts). */
function segmentsIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): boolean {
  const d1 = cross(b2.x - b1.x, b2.y - b1.y, a1.x - b1.x, a1.y - b1.y);
  const d2 = cross(b2.x - b1.x, b2.y - b1.y, a2.x - b1.x, a2.y - b1.y);
  const d3 = cross(a2.x - a1.x, a2.y - a1.y, b1.x - a1.x, b1.y - a1.y);
  const d4 = cross(a2.x - a1.x, a2.y - a1.y, b2.x - a1.x, b2.y - a1.y);
  const sign = (value: number): number =>
    Math.abs(value) <= EPSILON ? 0 : value > 0 ? 1 : -1;
  const s1 = sign(d1);
  const s2 = sign(d2);
  const s3 = sign(d3);
  const s4 = sign(d4);
  if (s1 !== 0 && s2 !== 0 && s3 !== 0 && s4 !== 0) {
    return s1 !== s2 && s3 !== s4;
  }
  if (s1 === 0 && pointOnSegment(a1, b1, b2)) return true;
  if (s2 === 0 && pointOnSegment(a2, b1, b2)) return true;
  if (s3 === 0 && pointOnSegment(b1, a1, a2)) return true;
  if (s4 === 0 && pointOnSegment(b2, a1, a2)) return true;
  return false;
}

/** Shared deterministic work budget for one region's proof checks. */
interface WorkBudget {
  remaining: number;
}

function polygonIsSimple(
  points: readonly Point[],
  budget: WorkBudget,
): 'simple' | 'complex' | 'self-intersecting' {
  const count = points.length;
  if (count < 3) return 'self-intersecting';
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    const a1 = points[first]!;
    const a2 = points[firstNext]!;
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      // Skip the shared-endpoint neighbours of an adjacent edge pair.
      if (second === firstNext || secondNext === first) continue;
      budget.remaining -= 1;
      if (budget.remaining < 0) return 'complex';
      if (segmentsIntersect(a1, a2, points[second]!, points[secondNext]!)) {
        return 'self-intersecting';
      }
    }
  }
  return 'simple';
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function polygonBounds(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsDisjoint(left: Bounds, right: Bounds): boolean {
  return (
    left.maxX < right.minX ||
    right.maxX < left.minX ||
    left.maxY < right.minY ||
    right.maxY < left.minY
  );
}

function polygonsIntersect(
  left: readonly Point[],
  right: readonly Point[],
  budget: WorkBudget,
): 'clear' | 'complex' | 'intersecting' {
  if (boundsDisjoint(polygonBounds(left), polygonBounds(right))) return 'clear';
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[(leftIndex + 1) % left.length]!;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      budget.remaining -= 1;
      if (budget.remaining < 0) return 'complex';
      if (segmentsIntersect(
        leftStart,
        leftEnd,
        right[rightIndex]!,
        right[(rightIndex + 1) % right.length]!,
      )) {
        return 'intersecting';
      }
    }
  }
  return 'clear';
}

type PointContainment = 'inside' | 'outside' | 'boundary';

function pointInPolygon(point: Point, points: readonly Point[]): PointContainment {
  if (points.length < 3) return 'outside';
  for (let index = 0; index < points.length; index += 1) {
    if (pointOnSegment(point, points[index]!, points[(index + 1) % points.length]!)) {
      return 'boundary';
    }
  }
  let winding = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    if (start.y <= point.y) {
      if (end.y > point.y && cross(end.x - start.x, end.y - start.y, point.x - start.x, point.y - start.y) > 0) {
        winding += 1;
      }
    } else if (end.y <= point.y && cross(end.x - start.x, end.y - start.y, point.x - start.x, point.y - start.y) < 0) {
      winding -= 1;
    }
  }
  return winding === 0 ? 'outside' : 'inside';
}

/** Deterministic strict interior sample used for nesting tests. */
function interiorPoint(points: readonly Point[]): Point | null {
  if (points.length < 3) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!(maxY > minY)) return null;
  for (let step = 1; step <= 16; step += 1) {
    const y = minY + ((maxY - minY) * step) / 17;
    const crossings: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!;
      const end = points[(index + 1) % points.length]!;
      if ((start.y <= y && end.y > y) || (end.y <= y && start.y > y)) {
        const t = (y - start.y) / (end.y - start.y);
        crossings.push(start.x + t * (end.x - start.x));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const candidate = { x: (crossings[index]! + crossings[index + 1]!) / 2, y };
      if (pointInPolygon(candidate, points) === 'inside') return candidate;
    }
  }
  return null;
}

/** Reverses a closed contour while preserving its exact geometry. */
export function reverseCoverageContourCommands(
  commands: readonly FlaVectorPathCommand[],
): FlaVectorPathCommand[] {
  const segments = contourSegments(commands);
  if (!segments || segments.length === 0) return [...commands];
  const reversed: FlaVectorPathCommand[] = [];
  const last = segments[segments.length - 1]!;
  reversed.push({ type: 'M', x: last.end.x, y: last.end.y });
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const target = segment.start;
    if (segment.kind === 'L') {
      reversed.push({ type: 'L', x: target.x, y: target.y });
    } else if (segment.kind === 'Q') {
      reversed.push({
        type: 'Q',
        cx: segment.control1.x,
        cy: segment.control1.y,
        x: target.x,
        y: target.y,
      });
    } else {
      reversed.push({
        type: 'C',
        c1x: segment.control2.x,
        c1y: segment.control2.y,
        c2x: segment.control1.x,
        c2y: segment.control1.y,
        x: target.x,
        y: target.y,
      });
    }
  }
  reversed.push({ type: 'Z' });
  return reversed;
}

function unsupported(
  code: CoverageMaskFillRuleIssueCode,
  detail: string,
): CoverageMaskFillRuleConversion {
  return { ok: false, code, detail };
}

/**
 * Converts one authored region (already transformed into stage space) into a
 * single `nonzero`-safe contour set. See the module comment for the exact
 * equivalence contract and degradation rules.
 */
export function convertCoverageRegionToNonzero(input: {
  readonly fillRule: CoverageMaskFillRule;
  readonly contours: readonly (readonly FlaVectorPathCommand[])[];
}): CoverageMaskFillRuleConversion {
  if (input.contours.length === 0) return { ok: true, contours: [] };
  if (input.contours.length > MAX_REGION_CONTOURS) {
    return unsupported('unsupported-geometry', 'too many contours in one region');
  }
  // Curves are never converted from a flat approximation (#1469 F4). The caller
  // keeps the authored path + rule when that is provably exact and reports this
  // typed unsupported otherwise.
  if (input.contours.some((commands) => coverageContourHasCurve(commands))) {
    return unsupported(
      'unsupported-curve-fill-rule',
      'curve contours cannot be proven equivalent without exact curve intersection',
    );
  }
  const geometries: ContourGeometry[] = [];
  const budget: WorkBudget = { remaining: MAX_SEGMENT_PAIR_TESTS };
  let totalPoints = 0;
  for (const commands of input.contours) {
    const segments = contourSegments(commands);
    if (!segments) {
      return unsupported('unsupported-geometry', 'contour does not start with M');
    }
    const points = polygonPoints(segments);
    if (!points) {
      return unsupported('unsupported-geometry', 'unexpected non-line segment');
    }
    if (points.length < 3) continue;
    if (points.length > MAX_CONTOUR_POINTS) {
      return unsupported('unsupported-geometry', 'contour too complex to prove');
    }
    totalPoints += points.length;
    if (totalPoints > MAX_REGION_POINTS) {
      return unsupported('unsupported-geometry', 'region too complex to prove');
    }
    const area = signedArea(points);
    if (Math.abs(area) < MIN_CONTOUR_AREA) {
      // A collapsed (zero-area) simple contour paints nothing. A zero NET area
      // that is self-intersecting (e.g. a symmetric figure-eight) still paints
      // under nonzero, so it must be reported instead of silently dropped.
      const simplicity = polygonIsSimple(points, budget);
      if (simplicity === 'complex') {
        return unsupported('unsupported-geometry', 'geometry too complex to prove');
      }
      if (simplicity === 'self-intersecting') {
        return unsupported('unsupported-geometry', 'self-intersecting contour');
      }
      continue;
    }
    geometries.push({ commands, points, signedArea: area });
  }
  if (geometries.length === 0) return { ok: true, contours: [] };
  for (const geometry of geometries) {
    const simplicity = polygonIsSimple(geometry.points, budget);
    if (simplicity === 'complex') {
      return unsupported('unsupported-geometry', 'geometry too complex to prove');
    }
    if (simplicity === 'self-intersecting') {
      return unsupported('unsupported-geometry', 'self-intersecting contour');
    }
  }
  for (let left = 0; left < geometries.length; left += 1) {
    for (let right = left + 1; right < geometries.length; right += 1) {
      const intersection = polygonsIntersect(
        geometries[left]!.points,
        geometries[right]!.points,
        budget,
      );
      if (intersection === 'complex') {
        return unsupported('unsupported-geometry', 'geometry too complex to prove');
      }
      if (intersection === 'intersecting') {
        return unsupported('unsupported-geometry', 'intersecting contours in one region');
      }
    }
  }

  // Containment forest: immediate parent is the smallest-area containing contour.
  const parent: number[] = geometries.map(() => -1);
  const samples: Point[] = geometries.map((geometry) => {
    const sample = interiorPoint(geometry.points);
    return sample ?? geometry.points[0]!;
  });
  for (let child = 0; child < geometries.length; child += 1) {
    const childArea = Math.abs(geometries[child]!.signedArea);
    let best = -1;
    let bestArea = Infinity;
    for (let candidate = 0; candidate < geometries.length; candidate += 1) {
      if (candidate === child) continue;
      const candidateArea = Math.abs(geometries[candidate]!.signedArea);
      if (candidateArea <= childArea) continue;
      budget.remaining -= geometries[candidate]!.points.length;
      if (budget.remaining < 0) {
        return unsupported('unsupported-geometry', 'geometry too complex to prove');
      }
      const containment = pointInPolygon(samples[child]!, geometries[candidate]!.points);
      if (containment === 'boundary') {
        return unsupported('unsupported-geometry', 'touching contours in one region');
      }
      if (containment === 'inside' && candidateArea < bestArea) {
        best = candidate;
        bestArea = candidateArea;
      }
    }
    parent[child] = best;
  }
  const depth: number[] = geometries.map(() => 0);
  for (let index = 0; index < geometries.length; index += 1) {
    let current = parent[index]!;
    let steps = 0;
    while (current !== -1) {
      steps += 1;
      if (steps > geometries.length) {
        return unsupported('unsupported-geometry', 'cyclic contour containment');
      }
      current = parent[current]!;
    }
    depth[index] = steps;
  }

  const authoredSign = geometries.map((geometry) => (geometry.signedArea > 0 ? 1 : -1));
  const winding = geometries.map(() => 0);
  const order = [...geometries.keys()].sort((left, right) => depth[left]! - depth[right]!);
  for (const index of order) {
    const parentIndex = parent[index]!;
    winding[index] = authoredSign[index]! + (parentIndex === -1 ? 0 : winding[parentIndex]!);
  }

  const reverse: boolean[] = geometries.map(() => false);
  if (input.fillRule === 'evenodd') {
    // Parity orientation: +1 on even nesting depth, -1 on odd (holes).
    for (let index = 0; index < geometries.length; index += 1) {
      const targetSign = depth[index]! % 2 === 0 ? 1 : -1;
      reverse[index] = authoredSign[index] !== targetSign;
    }
  } else {
    const minWinding = Math.min(...winding);
    const maxWinding = Math.max(...winding);
    if (minWinding < 0) {
      if (maxWinding > 0) {
        return unsupported(
          'unsupported-fill-rule-conversion',
          'mixed nonzero winding cannot be normalized without changing coverage',
        );
      }
      for (let index = 0; index < geometries.length; index += 1) reverse[index] = true;
    }
  }

  return {
    ok: true,
    contours: geometries.map((geometry, index) =>
      reverse[index]
        ? reverseCoverageContourCommands(geometry.commands)
        : geometry.commands),
  };
}
