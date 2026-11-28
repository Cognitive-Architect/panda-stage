import type {
  FlaVectorContour,
  FlaVectorPathCommand,
} from '../fla-shape-vector';

/**
 * Pure single-pair / multi-contour shape morph normalization for native author
 * Shape Tweens (#1457, #1458).
 *
 * Method (the public polygon / Bezier blending method, matching the documented
 * AniCraft `crates/geom/src/morph.rs` algorithm shape at fixed upstream commit
 * aa74ed798fc78beb4f517ae4865ccb0130323625, MIT OR Apache-2.0, consulted for
 * algorithm shape only; this file is an independent TypeScript implementation
 * over Panda's own `M/L/Q/C/Z` path representation):
 *
 * 1. every emitted segment becomes a cubic; `L` / `Q` are degree-elevated
 *    exactly, so no curve family is invented or lost;
 * 2. contours are grouped into outer + direct holes by containment and then
 *    paired outer-first; a contour without a counterpart shrinks to (or grows
 *    from) a degenerate point placed inside the paired counterpart (or at its
 *    own centre when the whole group is absent);
 * 3. the longer of each matched pair is subdivided longest-segment-first with
 *    de Casteljau until both sides have the same number of cubic segments;
 * 4. closed contours are aligned: opposite windings are reversed and the second
 *    contour's start is rotated to the anchor minimizing squared anchor
 *    distance, so an in-between frame cannot twist or collapse;
 * 5. author hints are applied BEFORE that alignment heuristic: both contours are
 *    split at each hinted location with de Casteljau, rotated to the first hint,
 *    cut into matching arcs and paired arc-by-arc in hinted order, then step 3
 *    equalizes each arc. Hinted endpoints therefore map to hinted endpoints at
 *    every progress value, and unhinted contours keep the exact #1457 output.
 *
 * `prepareShapeMorphPair` does all structural work once; per-frame evaluation
 * only lerps aligned control points. The module is deterministic and free of
 * React, DOM, Node, and project/store imports.
 *
 * Supported multi-contour boundary (`allowMultipleContours`):
 * - one outer contour plus any number of direct holes (a contour directly
 *   inside the outer), for either or both poses; holes are paired by descending
 *   area and keep their authored winding relative to the outer, so a hole cannot
 *   flip into a filled island or drift outside its paired outer endpoint;
 * - several disjoint outer contours, each optionally with direct holes. These
 *   pair by descending outer area (a documented heuristic, not Adobe's private
 *   Shape Hint matching);
 * - holes present on one pose only collapse into / grow out of the paired outer
 *   centre, which keeps them inside the outer at both exact endpoints.
 * Unsupported topology returns a typed failure so callers keep the authored
 * geometry and degrade locally: nested holes (a contour inside a hole), a hole
 * that is not strictly contained by one outer, and overlapping/ambiguous
 * outer containment.
 *
 * Style interpolation is out of scope for this module and lives in the model
 * (`flaShapeTween.ts`): fills and strokes must match between the two poses and
 * are taken from the authored region; gradients and stroke widths are never
 * interpolated.
 */

export interface ShapeMorphPoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeMorphPose {
  readonly contours: readonly FlaVectorContour[];
}

/** A normalized location on one pose contour, used by author shape hints. */
export interface ShapeMorphContourLocation {
  /** Index into the pose's authored `contours` array. */
  readonly contourIndex: number;
  /** Index of the normalized cubic segment along that contour. */
  readonly segmentIndex: number;
  /** Position along that segment, in [0, 1]; 1 is the segment end anchor. */
  readonly t: number;
}

/** Author-specified point correspondence between the `from` and `to` poses. */
export interface ShapeMorphHint {
  readonly from: ShapeMorphContourLocation;
  readonly to: ShapeMorphContourLocation;
}

export type ShapeMorphFailureCode =
  | 'empty-pose'
  | 'open-contour'
  | 'unsupported-topology'
  | 'degenerate-contour'
  | 'too-many-segments'
  | 'non-finite'
  | 'invalid-hint'
  | 'ambiguous-hints'
  | 'crossing-hints';

export interface ShapeMorphFailure {
  readonly ok: false;
  readonly code: ShapeMorphFailureCode;
  readonly message: string;
}

export interface ShapeMorphCubicSegment {
  readonly c1: ShapeMorphPoint;
  readonly c2: ShapeMorphPoint;
  readonly end: ShapeMorphPoint;
}

export interface ShapeMorphPreparedContour {
  readonly start: ShapeMorphPoint;
  readonly segments: readonly ShapeMorphCubicSegment[];
}

export interface PreparedShapeMorphPair {
  /** Contours are index-aligned; every pair has the same segment count. */
  readonly from: readonly ShapeMorphPreparedContour[];
  readonly to: readonly ShapeMorphPreparedContour[];
  readonly contourCount: number;
  readonly segmentCount: number;
}

export interface ShapeMorphPrepareOptions {
  /**
   * Enables the documented outer-contour + direct-hole / multi-outer boundary
   * above. When omitted or false, any multi-contour pose is a typed
   * unsupported-topology failure.
   */
  readonly allowMultipleContours?: boolean;
  /**
   * Author point correspondence. Applied before the alignment heuristic; an
   * inconsistent hint set fails with `ambiguous-hints` / `crossing-hints` so the
   * caller keeps the authored geometry instead of rendering a self-intersection.
   * Hint locations are validated against the normalized contours.
   */
  readonly hints?: readonly ShapeMorphHint[];
}

export type ShapeMorphPrepareResult =
  | { readonly ok: true; readonly pair: PreparedShapeMorphPair }
  | ShapeMorphFailure;

/** Upper bound on subdivided segments per contour, matching the upstream work cap. */
const MAX_SEGMENTS = 4_096;
/** Above this anchor count the start-point search samples rotations instead of scanning all. */
const ALIGN_EXACT = 256;
/** Distance under which two authored anchors count as the same point. */
const POINT_EPSILON = 1e-6;
/** Relative area under which a closed contour counts as degenerate (zero-area). */
const AREA_EPSILON = 1e-9;
/** Contour-parameter distance under which two hinted locations count as the same point. */
const PARAMETER_EPSILON = 1e-9;
/** Ring sampling density used only for containment / winding side tests. */
const RING_SAMPLES_PER_SEGMENT = 12;
/** Cap on sampled hole vertices when checking that a hole stays inside its outer. */
const CONTAINMENT_SAMPLE_LIMIT = 64;

interface CubicSegment {
  readonly c1: ShapeMorphPoint;
  readonly c2: ShapeMorphPoint;
  readonly end: ShapeMorphPoint;
}

interface NormalizedContour {
  readonly start: ShapeMorphPoint;
  readonly segments: readonly CubicSegment[];
}

const point = (x: number, y: number): ShapeMorphPoint => ({ x, y });

function isFinitePoint(p: ShapeMorphPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function lerpPoint(
  from: ShapeMorphPoint,
  to: ShapeMorphPoint,
  t: number,
): ShapeMorphPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function distance(left: ShapeMorphPoint, right: ShapeMorphPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function failure(
  code: ShapeMorphFailureCode,
  message: string,
): ShapeMorphFailure {
  return { ok: false, code, message };
}

/** Narrows a `T | ShapeMorphFailure` union without `Array.isArray` readonly gaps. */
function isShapeMorphFailure(value: unknown): value is ShapeMorphFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { readonly ok: unknown }).ok === false
  );
}

function lineCubic(
  from: ShapeMorphPoint,
  to: ShapeMorphPoint,
): CubicSegment {
  return {
    c1: lerpPoint(from, to, 1 / 3),
    c2: lerpPoint(from, to, 2 / 3),
    end: to,
  };
}

/** Exact quadratic-to-cubic degree elevation. */
function quadraticCubic(
  from: ShapeMorphPoint,
  control: ShapeMorphPoint,
  to: ShapeMorphPoint,
): CubicSegment {
  return {
    c1: {
      x: from.x + (2 / 3) * (control.x - from.x),
      y: from.y + (2 / 3) * (control.y - from.y),
    },
    c2: {
      x: to.x + (2 / 3) * (control.x - to.x),
      y: to.y + (2 / 3) * (control.y - to.y),
    },
    end: to,
  };
}

/** Converts one repo contour into absolute cubic segments, closing the loop implicitly. */
function normalizeContour(
  contour: FlaVectorContour,
): NormalizedContour | ShapeMorphFailure {
  let start: ShapeMorphPoint | null = null;
  let cursor: ShapeMorphPoint = point(0, 0);
  let sawClose = false;
  const segments: CubicSegment[] = [];
  for (const command of contour.commands) {
    if (command.type === 'M') {
      if (start !== null) {
        return failure(
          'unsupported-topology',
          'A contour with more than one subpath is not morph-supported.',
        );
      }
      start = point(command.x, command.y);
      cursor = start;
      continue;
    }
    if (sawClose) {
      return failure(
        'unsupported-topology',
        'Path commands after a close command are not morph-supported.',
      );
    }
    if (start === null) {
      return failure(
        'unsupported-topology',
        'A morph contour must begin with a move command.',
      );
    }
    if (command.type === 'Z') {
      sawClose = true;
      continue;
    }
    if (command.type === 'L') {
      const next = point(command.x, command.y);
      segments.push(lineCubic(cursor, next));
      cursor = next;
    } else if (command.type === 'Q') {
      const next = point(command.x, command.y);
      segments.push(quadraticCubic(cursor, point(command.cx, command.cy), next));
      cursor = next;
    } else if (command.type === 'C') {
      const next = point(command.x, command.y);
      segments.push({
        c1: point(command.c1x, command.c1y),
        c2: point(command.c2x, command.c2y),
        end: next,
      });
      cursor = next;
    }
  }
  if (start === null || segments.length === 0) {
    return failure('empty-pose', 'A morph contour must contain at least one segment.');
  }
  const closed = contour.closed || sawClose;
  if (!closed) {
    return failure(
      'open-contour',
      'Shape tweens require both poses to be closed contours.',
    );
  }
  const points = [start, ...segments.map((segment) => segment.end)];
  if (!points.every(isFinitePoint)) {
    return failure('non-finite', 'Morph geometry contains a non-finite coordinate.');
  }
  return { start, segments: closeSegments(start, segments) };
}

/** Adds the explicit closing edge so every anchor is a segment end (mirrors `Z`). */
function closeSegments(
  start: ShapeMorphPoint,
  segments: readonly CubicSegment[],
): readonly CubicSegment[] {
  const last = segments[segments.length - 1]!;
  if (distance(last.end, start) <= POINT_EPSILON) return segments;
  return [...segments, lineCubic(last.end, start)];
}

/** Signed area of the contour anchor ring; used only to compare windings and sizes. */
function contourSignedArea(contour: NormalizedContour): number {
  const ring = [contour.start, ...contour.segments.map((segment) => segment.end)];
  // The final anchor equals the start; drop it so the shoelace loop is not short-circuited.
  const points =
    ring.length > 1 && distance(ring[ring.length - 1]!, contour.start) <= POINT_EPSILON
      ? ring.slice(0, -1)
      : ring;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

/** Anchor ring excluding the duplicate closing anchor. */
function contourRing(contour: NormalizedContour): readonly ShapeMorphPoint[] {
  const ring = [contour.start, ...contour.segments.map((segment) => segment.end)];
  return ring.length > 1 &&
    distance(ring[ring.length - 1]!, contour.start) <= POINT_EPSILON
    ? ring.slice(0, -1)
    : ring;
}

function contourBounds(contour: NormalizedContour): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of contourRing(contour)) {
    if (entry.x < minX) minX = entry.x;
    if (entry.y < minY) minY = entry.y;
    if (entry.x > maxX) maxX = entry.x;
    if (entry.y > maxY) maxY = entry.y;
  }
  return { minX, minY, maxX, maxY };
}

function isDegenerateContour(contour: NormalizedContour): boolean {
  const bounds = contourBounds(contour);
  const scale = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  return Math.abs(contourSignedArea(contour)) <= AREA_EPSILON * scale * scale;
}

/** Reverses a closed contour's winding while keeping the same start anchor. */
function reverseContour(contour: NormalizedContour): NormalizedContour {
  const segments = contour.segments;
  const reversed: CubicSegment[] = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const from = index === 0 ? contour.start : segments[index - 1]!.end;
    reversed.push({ c1: segment.c2, c2: segment.c1, end: from });
  }
  return { start: segments[segments.length - 1]!.end, segments: reversed };
}

/** Rotates a closed contour so it starts at anchor `offset` (segment index). */
function rotateContour(
  contour: NormalizedContour,
  offset: number,
): NormalizedContour {
  const count = contour.segments.length;
  if (count === 0) return contour;
  const shift = ((offset % count) + count) % count;
  if (shift === 0) return contour;
  const start = contour.segments[shift - 1]!.end;
  return {
    start,
    segments: [
      ...contour.segments.slice(shift),
      ...contour.segments.slice(0, shift),
    ],
  };
}

/** de Casteljau split of the cubic from `from` at `t`. */
function splitCubicAt(
  from: ShapeMorphPoint,
  segment: CubicSegment,
  t: number,
): readonly [CubicSegment, CubicSegment] {
  const { c1, c2, end } = segment;
  const ab = lerpPoint(from, c1, t);
  const bc = lerpPoint(c1, c2, t);
  const cd = lerpPoint(c2, end, t);
  const abc = lerpPoint(ab, bc, t);
  const bcd = lerpPoint(bc, cd, t);
  const middle = lerpPoint(abc, bcd, t);
  return [
    { c1: ab, c2: abc, end: middle },
    { c1: bcd, c2: cd, end },
  ];
}

function segmentLength(
  from: ShapeMorphPoint,
  segment: CubicSegment,
): number {
  return (
    distance(from, segment.c1) +
    distance(segment.c1, segment.c2) +
    distance(segment.c2, segment.end)
  );
}

/** Exact cubic point at parameter `t`. */
function cubicPointAt(
  from: ShapeMorphPoint,
  segment: CubicSegment,
  t: number,
): ShapeMorphPoint {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x:
      uu * u * from.x +
      3 * uu * t * segment.c1.x +
      3 * u * tt * segment.c2.x +
      tt * t * segment.end.x,
    y:
      uu * u * from.y +
      3 * uu * t * segment.c1.y +
      3 * u * tt * segment.c2.y +
      tt * t * segment.end.y,
  };
}

function pointOnContourAtParameter(
  contour: NormalizedContour,
  parameter: number,
): ShapeMorphPoint {
  const count = contour.segments.length;
  if (count === 0) return contour.start;
  const wrapped = ((parameter % count) + count) % count;
  if (wrapped <= PARAMETER_EPSILON) return contour.start;
  const index = Math.min(count - 1, Math.floor(wrapped));
  const t = wrapped - index;
  const from = index === 0 ? contour.start : contour.segments[index - 1]!.end;
  return cubicPointAt(from, contour.segments[index]!, t);
}

interface ContourParameterResult {
  readonly ok: true;
  readonly parameter: number;
}

/** Maps a hint location onto the contour's normalized `[0, segments.length)` parameter. */
function resolveContourLocationParameter(
  contour: NormalizedContour,
  location: ShapeMorphContourLocation,
): ContourParameterResult | ShapeMorphFailure {
  const count = contour.segments.length;
  if (
    !Number.isInteger(location.segmentIndex) ||
    location.segmentIndex < 0 ||
    location.segmentIndex >= count
  ) {
    return failure(
      'invalid-hint',
      'A shape hint segment index is outside its normalized contour.',
    );
  }
  if (!Number.isFinite(location.t) || location.t < 0 || location.t > 1) {
    return failure('invalid-hint', 'A shape hint position must be within [0, 1].');
  }
  const raw = location.segmentIndex + location.t;
  return { ok: true, parameter: raw >= count ? 0 : raw };
}

/** Parameter of the same geometric point when a closed contour is traversed backwards. */
function reverseContourParameter(parameter: number, segmentCount: number): number {
  if (parameter <= PARAMETER_EPSILON) return 0;
  const reversed = segmentCount - parameter;
  return reversed <= PARAMETER_EPSILON ? 0 : reversed;
}

interface SplitContourAtHints {
  readonly start: ShapeMorphPoint;
  readonly segments: readonly CubicSegment[];
  /** Segment offset of each hint's anchor, aligned with the sorted hint order. */
  readonly boundaries: readonly number[];
}

/**
 * Splits every hinted segment exactly with de Casteljau (no approximation),
 * then rotates the ring so the first hinted anchor becomes the start anchor.
 * Boundaries are the anchor offsets after that rotation; each is the number of
 * segments before the hint, so `segments[boundary - 1]` ends at the hint.
 */
function splitContourAtHintParameters(
  contour: NormalizedContour,
  sortedParameters: readonly number[],
): SplitContourAtHints {
  const count = contour.segments.length;
  interface HintEntry {
    readonly index: number;
    readonly t: number;
    readonly boundaryBefore: boolean;
  }
  const entries: HintEntry[] = sortedParameters.map((parameter) => {
    const wrapped = ((parameter % count) + count) % count;
    if (wrapped <= PARAMETER_EPSILON) {
      return { index: 0, t: 0, boundaryBefore: true };
    }
    const index = Math.floor(wrapped);
    const fraction = wrapped - index;
    if (fraction <= PARAMETER_EPSILON) {
      return { index, t: 0, boundaryBefore: true };
    }
    return { index, t: fraction, boundaryBefore: false };
  });

  const segments: CubicSegment[] = [];
  const boundaries: number[] = new Array(sortedParameters.length).fill(-1);
  let cursor = 0;
  let currentStart = contour.start;
  for (let index = 0; index < count; index += 1) {
    while (
      cursor < entries.length &&
      entries[cursor]!.boundaryBefore &&
      entries[cursor]!.index === index
    ) {
      boundaries[cursor] = segments.length;
      cursor += 1;
    }
    const interior: number[] = [];
    while (
      cursor < entries.length &&
      !entries[cursor]!.boundaryBefore &&
      entries[cursor]!.index === index
    ) {
      interior.push(cursor);
      cursor += 1;
    }
    let remaining = contour.segments[index]!;
    let pieceStart = currentStart;
    let previousT = 0;
    for (const hintIndex of interior) {
      const t = entries[hintIndex]!.t;
      const local = (t - previousT) / (1 - previousT);
      const [left, right] = splitCubicAt(pieceStart, remaining, local);
      segments.push(left);
      boundaries[hintIndex] = segments.length;
      pieceStart = left.end;
      remaining = right;
      previousT = t;
    }
    segments.push(remaining);
    currentStart = remaining.end;
  }

  let result: NormalizedContour = { start: contour.start, segments };
  const firstBoundary = boundaries[0] ?? 0;
  if (firstBoundary > 0) {
    result = rotateContour(result, firstBoundary);
  }
  const total = result.segments.length;
  const shifted = boundaries.map(
    (boundary) => ((boundary - firstBoundary) % total + total) % total,
  );
  return { start: result.start, segments: result.segments, boundaries: shifted };
}

/** Subdivides a segment slice longest-first until it reaches `count` segments. */
function subdivideSegmentSliceToCount(
  start: ShapeMorphPoint,
  slices: readonly CubicSegment[],
  count: number,
): readonly CubicSegment[] {
  const segments: CubicSegment[] = [...slices];
  while (segments.length < count) {
    let longestIndex = 0;
    let longest = -1;
    let previous = start;
    for (let index = 0; index < segments.length; index += 1) {
      const length = segmentLength(previous, segments[index]!);
      if (length > longest) {
        longest = length;
        longestIndex = index;
      }
      previous = segments[index]!.end;
    }
    const target = segments[longestIndex]!;
    const from = longestIndex === 0 ? start : segments[longestIndex - 1]!.end;
    const [left, right] = splitCubicAt(from, target, 0.5);
    segments[longestIndex] = left;
    segments.splice(longestIndex + 1, 0, right);
  }
  return segments;
}

/** Subdivides the longest segments until the contour has exactly `count` segments. */
function subdivideContourToCount(
  contour: NormalizedContour,
  count: number,
): NormalizedContour {
  const segments: CubicSegment[] = [...contour.segments];
  const start = contour.start;
  while (segments.length < count) {
    let longestIndex = 0;
    let longest = -1;
    let previous = start;
    for (let index = 0; index < segments.length; index += 1) {
      const length = segmentLength(previous, segments[index]!);
      if (length > longest) {
        longest = length;
        longestIndex = index;
      }
      previous = segments[index]!.end;
    }
    const target = segments[longestIndex]!;
    const from = longestIndex === 0 ? start : segments[longestIndex - 1]!.end;
    const [left, right] = splitCubicAt(from, target, 0.5);
    segments[longestIndex] = left;
    segments.splice(longestIndex + 1, 0, right);
    // `start` stays the same; the split never moves the contour's start anchor.
  }
  return { start, segments };
}

/** A zero-length contour at `centre` shaped like `like` (used for absent counterparts). */
function collapsedContour(
  centre: ShapeMorphPoint,
  like: NormalizedContour,
): NormalizedContour {
  const count = Math.max(1, like.segments.length);
  const segments: CubicSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    segments.push({ c1: centre, c2: centre, end: centre });
  }
  return { start: centre, segments };
}

function anchorsOf(contour: NormalizedContour): readonly ShapeMorphPoint[] {
  return contour.segments.map((segment) => segment.end);
}

/** Rotates closed `to` so its anchors best match `from`'s (same segment count). */
function alignStartingAnchor(
  from: NormalizedContour,
  to: NormalizedContour,
): NormalizedContour {
  const count = to.segments.length;
  if (count === 0 || from.segments.length !== count) return to;
  const fromAnchors = anchorsOf(from);
  const toAnchors = anchorsOf(to);
  const step = Math.max(1, Math.ceil(count / ALIGN_EXACT));
  let bestOffset = 0;
  let bestCost = Infinity;
  for (let offset = 0; offset < count; offset += step) {
    let cost = 0;
    for (let index = 0; index < count; index += step) {
      const left = fromAnchors[index]!;
      const right = toAnchors[(index + offset) % count]!;
      const dx = left.x - right.x;
      const dy = left.y - right.y;
      cost += dx * dx + dy * dy;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  // Result segment j is authored segment (j + offset), so it ends at authored anchor j + offset.
  return rotateContour(to, bestOffset);
}

/** Ring of sampled points used only for containment and winding side tests. */
function sampledContourRing(
  contour: NormalizedContour,
  samplesPerSegment = RING_SAMPLES_PER_SEGMENT,
): readonly ShapeMorphPoint[] {
  const points: ShapeMorphPoint[] = [contour.start];
  let current = contour.start;
  for (const segment of contour.segments) {
    for (let step = 1; step <= samplesPerSegment; step += 1) {
      points.push(cubicPointAt(current, segment, step / samplesPerSegment));
    }
    current = segment.end;
  }
  return points;
}

/** Winding number of `point` against a sampled ring (0 means outside). */
function ringWinding(point: ShapeMorphPoint, ring: readonly ShapeMorphPoint[]): number {
  if (ring.length < 3) return 0;
  let winding = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    if (a.y <= point.y) {
      if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) {
        winding += 1;
      }
    } else if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

/** A point known to be inside a closed contour (centroid, else a horizontal scan). */
function contourInteriorPoint(contour: NormalizedContour): ShapeMorphPoint {
  const ring = sampledContourRing(contour);
  if (ring.length === 0) return contour.start;
  let sumX = 0;
  let sumY = 0;
  for (const entry of ring) {
    sumX += entry.x;
    sumY += entry.y;
  }
  const centroid = point(sumX / ring.length, sumY / ring.length);
  if (ringWinding(centroid, ring) !== 0) return centroid;
  const bounds = contourBounds(contour);
  const scanY = (bounds.minY + bounds.maxY) * 0.5;
  const crossings: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
      crossings.push(a.x + ((scanY - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  crossings.sort((left, right) => left - right);
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    const candidate = point((crossings[index]! + crossings[index + 1]!) * 0.5, scanY);
    if (ringWinding(candidate, ring) !== 0) return candidate;
  }
  return contour.start;
}

/** Samples a contour's ring down to a bounded count for containment checks. */
function sampledRingStride(ring: readonly ShapeMorphPoint[]): readonly ShapeMorphPoint[] {
  if (ring.length <= CONTAINMENT_SAMPLE_LIMIT) return ring;
  const step = ring.length / CONTAINMENT_SAMPLE_LIMIT;
  const sampled: ShapeMorphPoint[] = [];
  for (let index = 0; index < ring.length; index += step) {
    sampled.push(ring[Math.floor(index)]!);
  }
  return sampled;
}

interface ContourGroup {
  readonly outerIndex: number;
  /** Authored contour indices of this outer's direct holes (declaration order). */
  readonly holeIndices: readonly number[];
}

/**
 * Classifies one pose into outer + direct-hole groups. Holes are contours that
 * are strictly contained by exactly one larger contour; anything nested deeper
 * (a contour inside a hole) or ambiguously contained is a typed unsupported
 * failure so the caller keeps authored geometry.
 */
function groupContours(
  contours: readonly NormalizedContour[],
): readonly ContourGroup[] | ShapeMorphFailure {
  const count = contours.length;
  if (count === 0) {
    return failure('empty-pose', 'A shape tween pose requires at least one contour.');
  }
  const rings = contours.map((contour) => sampledContourRing(contour));
  const interior = contours.map((contour) => contourInteriorPoint(contour));
  const areas = contours.map((contour) => Math.abs(contourSignedArea(contour)));
  const containers: number[][] = contours.map((_contour, index) => {
    const result: number[] = [];
    for (let other = 0; other < count; other += 1) {
      if (other === index) continue;
      if (areas[other]! <= areas[index]! + AREA_EPSILON) continue;
      if (ringWinding(interior[index]!, rings[other]!) !== 0) result.push(other);
    }
    return result;
  });
  for (let index = 0; index < count; index += 1) {
    if (containers[index]!.length > 1) {
      return failure(
        'unsupported-topology',
        'Overlapping contour containment is ambiguous for shape tweening.',
      );
    }
    if (containers[index]!.length === 1) {
      const parent = containers[index]![0]!;
      if (containers[parent]!.length !== 0) {
        return failure(
          'unsupported-topology',
          'A contour nested inside a hole is not shape-tween supported.',
        );
      }
      const outerRing = rings[parent]!;
      const holeRing = rings[index]!;
      const holeSamples = sampledRingStride(holeRing);
      for (const sample of holeSamples) {
        if (ringWinding(sample, outerRing) === 0) {
          return failure(
            'unsupported-topology',
            'A hole contour is not strictly contained by its outer contour.',
          );
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  const order: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (containers[index]!.length === 0) {
      groups.set(index, []);
      order.push(index);
    }
  }
  for (let index = 0; index < count; index += 1) {
    if (containers[index]!.length !== 1) continue;
    const parent = containers[index]![0]!;
    groups.get(parent)?.push(index);
  }
  if (order.length === 0) {
    return failure('empty-pose', 'A shape tween pose requires at least one outer contour.');
  }
  // Largest outer first: a documented heuristic, not Adobe's private matching.
  order.sort((left, right) => areas[right]! - areas[left]!);
  return order.map((outerIndex) => ({
    outerIndex,
    holeIndices: groups.get(outerIndex) ?? [],
  }));
}

interface ContourPairPlan {
  readonly from: NormalizedContour;
  readonly to: NormalizedContour;
  /** Authored contour index, or null when this side is a synthetic collapse. */
  readonly fromAuthoredIndex: number | null;
  readonly toAuthoredIndex: number | null;
}

function byDescendingArea(
  contours: readonly NormalizedContour[],
  indices: readonly number[],
): readonly number[] {
  return [...indices].sort(
    (left, right) =>
      Math.abs(contourSignedArea(contours[right]!)) -
      Math.abs(contourSignedArea(contours[left]!)),
  );
}

/** Builds the outer/hole/leftover pairing plan, preserving authored identities. */
function planContourPairs(
  fromContours: readonly NormalizedContour[],
  toContours: readonly NormalizedContour[],
): readonly ContourPairPlan[] | ShapeMorphFailure {
  const fromGroups = groupContours(fromContours);
  if (isShapeMorphFailure(fromGroups)) return fromGroups;
  const toGroups = groupContours(toContours);
  if (isShapeMorphFailure(toGroups)) return toGroups;
  const plans: ContourPairPlan[] = [];
  const pairCount = Math.max(fromGroups.length, toGroups.length);
  for (let index = 0; index < pairCount; index += 1) {
    const fromGroup = fromGroups[index];
    const toGroup = toGroups[index];
    if (fromGroup && toGroup) {
      const fromOuter = fromContours[fromGroup.outerIndex]!;
      const toOuter = toContours[toGroup.outerIndex]!;
      plans.push({
        from: fromOuter,
        to: toOuter,
        fromAuthoredIndex: fromGroup.outerIndex,
        toAuthoredIndex: toGroup.outerIndex,
      });
      const fromHoles = byDescendingArea(fromContours, fromGroup.holeIndices);
      const toHoles = byDescendingArea(toContours, toGroup.holeIndices);
      const holeCount = Math.max(fromHoles.length, toHoles.length);
      for (let hole = 0; hole < holeCount; hole += 1) {
        const fromHoleIndex = fromHoles[hole];
        const toHoleIndex = toHoles[hole];
        if (fromHoleIndex !== undefined && toHoleIndex !== undefined) {
          plans.push({
            from: fromContours[fromHoleIndex]!,
            to: toContours[toHoleIndex]!,
            fromAuthoredIndex: fromHoleIndex,
            toAuthoredIndex: toHoleIndex,
          });
        } else if (fromHoleIndex !== undefined) {
          const fromHole = fromContours[fromHoleIndex]!;
          // A vanishing hole collapses inside its paired destination outer, so
          // the final frame cannot show a hole outside the outer contour.
          plans.push({
            from: fromHole,
            to: collapsedContour(contourInteriorPoint(toOuter), fromHole),
            fromAuthoredIndex: null,
            toAuthoredIndex: null,
          });
        } else {
          const toHole = toContours[toHoleIndex!]!;
          plans.push({
            from: collapsedContour(contourInteriorPoint(fromOuter), toHole),
            to: toHole,
            fromAuthoredIndex: null,
            toAuthoredIndex: null,
          });
        }
      }
    } else if (fromGroup) {
      const fromOuter = fromContours[fromGroup.outerIndex]!;
      const centre = contourInteriorPoint(fromOuter);
      plans.push({
        from: fromOuter,
        to: collapsedContour(centre, fromOuter),
        fromAuthoredIndex: null,
        toAuthoredIndex: null,
      });
      for (const holeIndex of byDescendingArea(fromContours, fromGroup.holeIndices)) {
        const fromHole = fromContours[holeIndex]!;
        plans.push({
          from: fromHole,
          to: collapsedContour(centre, fromHole),
          fromAuthoredIndex: null,
          toAuthoredIndex: null,
        });
      }
    } else if (toGroup) {
      const toOuter = toContours[toGroup.outerIndex]!;
      const centre = contourInteriorPoint(toOuter);
      plans.push({
        from: collapsedContour(centre, toOuter),
        to: toOuter,
        fromAuthoredIndex: null,
        toAuthoredIndex: null,
      });
      for (const holeIndex of byDescendingArea(toContours, toGroup.holeIndices)) {
        const toHole = toContours[holeIndex]!;
        plans.push({
          from: collapsedContour(centre, toHole),
          to: toHole,
          fromAuthoredIndex: null,
          toAuthoredIndex: null,
        });
      }
    }
  }
  return plans;
}

interface ContourPairHintParameters {
  readonly fromParameter: number;
  readonly toParameter: number;
}

/**
 * Resolves hinted locations to contour parameters, aligns `to` to the `from`
 * winding, then sorts the hints by `from` parameter and proves the `to`
 * parameters stay in the same cyclic order. Duplicate/overlapping or crossing
 * hint order is a typed failure (the caller keeps authored geometry).
 */
function resolveHintedPairParameters(
  from: NormalizedContour,
  to: NormalizedContour,
  hints: readonly ShapeMorphHint[],
): readonly ContourPairHintParameters[] | ShapeMorphFailure {
  const segmentCount = to.segments.length;
  const fromParameters: number[] = [];
  const toParameters: number[] = [];
  for (const hint of hints) {
    const fromResult = resolveContourLocationParameter(from, hint.from);
    if (!fromResult.ok) return fromResult;
    const toResult = resolveContourLocationParameter(to, hint.to);
    if (!toResult.ok) return toResult;
    fromParameters.push(fromResult.parameter);
    toParameters.push(toResult.parameter);
  }
  const reversed =
    Math.sign(contourSignedArea(from)) !== Math.sign(contourSignedArea(to));
  const alignedToParameters = reversed
    ? toParameters.map((parameter) => reverseContourParameter(parameter, segmentCount))
    : toParameters;
  const order = fromParameters
    .map((_parameter, index) => index)
    .sort((left, right) => fromParameters[left]! - fromParameters[right]! || left - right);
  const sortedFrom = order.map((index) => fromParameters[index]!);
  const sortedTo = order.map((index) => alignedToParameters[index]!);
  for (let index = 1; index < sortedFrom.length; index += 1) {
    if (sortedFrom[index]! - sortedFrom[index - 1]! <= PARAMETER_EPSILON) {
      return failure(
        'ambiguous-hints',
        'Two shape hints target the same location on the from pose.',
      );
    }
  }
  for (let index = 1; index < sortedTo.length; index += 1) {
    const delta = sortedTo[index]! - sortedTo[index - 1]!;
    if (delta < -PARAMETER_EPSILON) {
      return failure(
        'crossing-hints',
        'Shape hint order crosses between the two poses.',
      );
    }
    if (Math.abs(delta) <= PARAMETER_EPSILON) {
      return failure(
        'ambiguous-hints',
        'Two shape hints target the same location on the to pose.',
      );
    }
  }
  return sortedFrom.map((fromParameter, index) => ({
    fromParameter,
    toParameter: sortedTo[index]!,
  }));
}

/** Prepares a hinted pair: split at hints, rotate to the first hint, pair arcs. */
function prepareHintedPair(
  fromContour: NormalizedContour,
  toContour: NormalizedContour,
  hints: readonly ShapeMorphHint[],
): ShapeMorphPrepareResult {
  const parameters = resolveHintedPairParameters(fromContour, toContour, hints);
  if (isShapeMorphFailure(parameters)) return parameters;
  const resolved = parameters;
  const reversed =
    Math.sign(contourSignedArea(fromContour)) !== Math.sign(contourSignedArea(toContour));
  const alignedTo = reversed ? reverseContour(toContour) : toContour;
  const fromSplit = splitContourAtHintParameters(
    fromContour,
    resolved.map((entry) => entry.fromParameter),
  );
  const toSplit = splitContourAtHintParameters(
    alignedTo,
    resolved.map((entry) => entry.toParameter),
  );
  const fromTotal = fromSplit.segments.length;
  const toTotal = toSplit.segments.length;
  if (fromTotal > MAX_SEGMENTS || toTotal > MAX_SEGMENTS) {
    return failure(
      'too-many-segments',
      'The contour pair is too detailed for shape tweening.',
    );
  }
  const arcCount = resolved.length;
  const fromSegments: CubicSegment[] = [];
  const toSegments: CubicSegment[] = [];
  let totalSegments = 0;
  for (let arc = 0; arc < arcCount; arc += 1) {
    const fromStart = fromSplit.boundaries[arc]!;
    const fromEnd = arc + 1 < arcCount ? fromSplit.boundaries[arc + 1]! : fromTotal;
    const toStart = toSplit.boundaries[arc]!;
    const toEnd = arc + 1 < arcCount ? toSplit.boundaries[arc + 1]! : toTotal;
    const fromArc = fromSplit.segments.slice(fromStart, fromEnd);
    const toArc = toSplit.segments.slice(toStart, toEnd);
    const target = Math.max(fromArc.length, toArc.length);
    if (target > MAX_SEGMENTS) {
      return failure(
        'too-many-segments',
        'The contour pair is too detailed for shape tweening.',
      );
    }
    totalSegments += target;
    if (totalSegments > MAX_SEGMENTS) {
      return failure(
        'too-many-segments',
        'The contour pair is too detailed for shape tweening.',
      );
    }
    const fromArcStart =
      fromStart === 0 ? fromSplit.start : fromSplit.segments[fromStart - 1]!.end;
    const toArcStart = toStart === 0 ? toSplit.start : toSplit.segments[toStart - 1]!.end;
    fromSegments.push(...subdivideSegmentSliceToCount(fromArcStart, fromArc, target));
    toSegments.push(...subdivideSegmentSliceToCount(toArcStart, toArc, target));
  }
  return {
    ok: true,
    pair: {
      from: [{ start: fromSplit.start, segments: fromSegments }],
      to: [{ start: toSplit.start, segments: toSegments }],
      contourCount: 1,
      segmentCount: totalSegments,
    },
  };
}

/**
 * Aligns one normalized contour pair. Without hints this is the exact #1457
 * path (winding reversal, count equalization, best-anchor rotation); with hints
 * the hints take over start/arc correspondence before equalization.
 */
function prepareAlignedPair(
  fromContour: NormalizedContour,
  toContour: NormalizedContour,
  hints: readonly ShapeMorphHint[] | undefined,
  requireNonDegenerate: boolean,
): ShapeMorphPrepareResult {
  if (
    requireNonDegenerate &&
    (isDegenerateContour(fromContour) || isDegenerateContour(toContour))
  ) {
    return failure(
      'degenerate-contour',
      'A zero-area closed contour cannot be shape-tweened.',
    );
  }
  if (hints && hints.length > 0) {
    return prepareHintedPair(fromContour, toContour, hints);
  }
  const fromArea = contourSignedArea(fromContour);
  const toArea = contourSignedArea(toContour);
  const alignedTo =
    Math.sign(fromArea) === Math.sign(toArea)
      ? toContour
      : reverseContour(toContour);
  const segmentCount = Math.min(
    MAX_SEGMENTS,
    Math.max(fromContour.segments.length, alignedTo.segments.length),
  );
  if (Math.max(fromContour.segments.length, alignedTo.segments.length) > MAX_SEGMENTS) {
    return failure(
      'too-many-segments',
      'The contour pair is too detailed for shape tweening.',
    );
  }
  const fromNormalized = subdivideContourToCount(fromContour, segmentCount);
  const toNormalized = alignStartingAnchor(
    fromNormalized,
    subdivideContourToCount(alignedTo, segmentCount),
  );
  return {
    ok: true,
    pair: {
      from: [fromNormalized],
      to: [toNormalized],
      contourCount: 1,
      segmentCount,
    },
  };
}

function prepareRegions(
  fromContours: readonly NormalizedContour[],
  toContours: readonly NormalizedContour[],
  options: ShapeMorphPrepareOptions,
): ShapeMorphPrepareResult {
  const allowMultiple = options.allowMultipleContours === true;
  if (!allowMultiple && (fromContours.length > 1 || toContours.length > 1)) {
    return failure(
      'unsupported-topology',
      'Holes and multi-contour shapes are not shape-tween supported yet.',
    );
  }
  const singlePair = fromContours.length === 1 && toContours.length === 1;
  const plans = singlePair
    ? [
        {
          from: fromContours[0]!,
          to: toContours[0]!,
          fromAuthoredIndex: 0,
          toAuthoredIndex: 0,
        } satisfies ContourPairPlan,
      ]
    : planContourPairs(fromContours, toContours);
  if (isShapeMorphFailure(plans)) return plans;
  const pairs = plans;
  if (pairs.length === 0) {
    return failure('empty-pose', 'A shape tween requires at least one closed contour.');
  }

  const hints = options.hints ?? [];
  for (const hint of hints) {
    if (
      !Number.isInteger(hint.from.contourIndex) ||
      hint.from.contourIndex < 0 ||
      hint.from.contourIndex >= fromContours.length
    ) {
      return failure('invalid-hint', 'A shape hint references a missing from contour.');
    }
    if (
      !Number.isInteger(hint.to.contourIndex) ||
      hint.to.contourIndex < 0 ||
      hint.to.contourIndex >= toContours.length
    ) {
      return failure('invalid-hint', 'A shape hint references a missing to contour.');
    }
  }
  const hintsByPlan: ShapeMorphHint[][] = pairs.map(() => []);
  for (const hint of hints) {
    const planIndex = pairs.findIndex(
      (pair) =>
        pair.fromAuthoredIndex === hint.from.contourIndex &&
        pair.toAuthoredIndex === hint.to.contourIndex,
    );
    if (planIndex < 0) {
      return failure(
        'ambiguous-hints',
        'Shape hints must target contours that are paired by the morph.',
      );
    }
    hintsByPlan[planIndex]!.push(hint);
  }

  let maxSegmentCount = 0;
  const preparedFrom: ShapeMorphPreparedContour[] = [];
  const preparedTo: ShapeMorphPreparedContour[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    const result = prepareAlignedPair(
      pair.from,
      pair.to,
      hintsByPlan[index],
      pairs.length === 1,
    );
    if (!result.ok) return result;
    maxSegmentCount = Math.max(maxSegmentCount, result.pair.segmentCount);
    preparedFrom.push(result.pair.from[0]!);
    preparedTo.push(result.pair.to[0]!);
  }
  return {
    ok: true,
    pair: {
      from: preparedFrom,
      to: preparedTo,
      contourCount: pairs.length,
      segmentCount: maxSegmentCount,
    },
  };
}

export interface ShapeMorphContourAnchor {
  readonly segmentIndex: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Lists the author-pickable anchors (start anchor plus every cubic segment end)
 * of one closed contour, expressed as normalized contour locations. Returns an
 * empty list when the contour cannot be normalized. Author UIs use this to place
 * hints on real anchors instead of asking for raw segment indices.
 */
export function listShapeMorphContourAnchors(
  contour: FlaVectorContour,
): readonly ShapeMorphContourAnchor[] {
  const normalized = normalizeContour(contour);
  if ('ok' in normalized) return [];
  const anchors: ShapeMorphContourAnchor[] = [
    {
      segmentIndex: 0,
      t: 0,
      x: normalized.start.x,
      y: normalized.start.y,
    },
  ];
  for (let anchor = 1; anchor < normalized.segments.length; anchor += 1) {
    const end = normalized.segments[anchor - 1]!.end;
    anchors.push({ segmentIndex: anchor, t: 0, x: end.x, y: end.y });
  }
  return anchors;
}

/** Samples the exact geometric point at a normalized contour location. */
export function sampleShapeMorphContourLocation(
  contour: FlaVectorContour,
  location: Pick<ShapeMorphContourLocation, 'segmentIndex' | 't'>,
): ShapeMorphPoint | null {
  const normalized = normalizeContour(contour);
  if ('ok' in normalized) return null;
  const parameter = resolveContourLocationParameter(normalized, {
    contourIndex: 0,
    segmentIndex: location.segmentIndex,
    t: location.t,
  });
  if (!parameter.ok) return null;
  return pointOnContourAtParameter(normalized, parameter.parameter);
}

/**
 * Normalizes both poses into a segment-aligned cubic pair. Pure and
 * deterministic; the caller may cache the returned pair and interpolate it on
 * every frame without touching authored project geometry.
 */
export function prepareShapeMorphPair(
  from: ShapeMorphPose,
  to: ShapeMorphPose,
  options: ShapeMorphPrepareOptions = {},
): ShapeMorphPrepareResult {
  const normalizePose = (
    pose: ShapeMorphPose,
  ): readonly NormalizedContour[] | ShapeMorphFailure => {
    if (pose.contours.length === 0) {
      return failure('empty-pose', 'A shape tween pose requires at least one contour.');
    }
    const contours: NormalizedContour[] = [];
    for (const contour of pose.contours) {
      const normalized = normalizeContour(contour);
      if ('ok' in normalized && normalized.ok === false) return normalized;
      contours.push(normalized as NormalizedContour);
    }
    return contours;
  };
  const fromContours = normalizePose(from);
  if ('ok' in fromContours) return fromContours;
  const toContours = normalizePose(to);
  if ('ok' in toContours) return toContours;
  return prepareRegions(fromContours, toContours, options);
}

function toContourCommands(
  contour: ShapeMorphPreparedContour,
): FlaVectorPathCommand[] {
  const commands: FlaVectorPathCommand[] = [
    { type: 'M', x: contour.start.x, y: contour.start.y },
  ];
  for (const segment of contour.segments) {
    commands.push({
      type: 'C',
      c1x: segment.c1.x,
      c1y: segment.c1.y,
      c2x: segment.c2.x,
      c2y: segment.c2.y,
      x: segment.end.x,
      y: segment.end.y,
    });
  }
  commands.push({ type: 'Z' });
  return commands;
}

/**
 * Interpolates an already-prepared pair at `progress` (0..1, caller applies any
 * easing first). Endpoints return the prepared end pose exactly; the middle
 * frame is a plain control-point lerp of the aligned pair, so the result never
 * introduces a second path format.
 */
export function interpolateShapeMorphPair(
  pair: PreparedShapeMorphPair,
  progress: number,
): { readonly contours: readonly FlaVectorContour[]; readonly segmentCount: number } | null {
  if (!Number.isFinite(progress)) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  const contours: FlaVectorContour[] = [];
  for (let index = 0; index < pair.from.length; index += 1) {
    const fromContour = pair.from[index]!;
    const toContour = pair.to[index]!;
    if (clamped <= 0) {
      contours.push({ closed: true, commands: toContourCommands(fromContour) });
      continue;
    }
    if (clamped >= 1) {
      contours.push({ closed: true, commands: toContourCommands(toContour) });
      continue;
    }
    const start = lerpPoint(fromContour.start, toContour.start, clamped);
    const commands: FlaVectorPathCommand[] = [
      { type: 'M', x: start.x, y: start.y },
    ];
    for (let segmentIndex = 0; segmentIndex < fromContour.segments.length; segmentIndex += 1) {
      const fromSegment = fromContour.segments[segmentIndex]!;
      const toSegment = toContour.segments[segmentIndex]!;
      const c1 = lerpPoint(fromSegment.c1, toSegment.c1, clamped);
      const c2 = lerpPoint(fromSegment.c2, toSegment.c2, clamped);
      const end = lerpPoint(fromSegment.end, toSegment.end, clamped);
      commands.push({
        type: 'C',
        c1x: c1.x,
        c1y: c1.y,
        c2x: c2.x,
        c2y: c2.y,
        x: end.x,
        y: end.y,
      });
    }
    commands.push({ type: 'Z' });
    contours.push({ closed: true, commands });
  }
  return { contours, segmentCount: pair.segmentCount };
}
