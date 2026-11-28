import type {
  FlaVectorContour,
  FlaVectorPathCommand,
} from '../fla-shape-vector';

/**
 * Pure single-pair shape morph normalization for native author Shape Tweens.
 *
 * Method (the public polygon / Bezier blending method, matching the documented
 * AniCraft `crates/geom/src/morph.rs` algorithm shape at fixed upstream commit
 * aa74ed798fc78beb4f517ae4865ccb0130323625, MIT OR Apache-2.0, consulted for
 * algorithm shape only; this file is an independent TypeScript implementation
 * over Panda's own `M/L/Q/C/Z` path representation):
 *
 * 1. every emitted segment becomes a cubic; `L` / `Q` are degree-elevated
 *    exactly, so no curve family is invented or lost;
 * 2. contours are paired largest-area first; a contour without a counterpart
 *    shrinks to (or grows from) a degenerate point at its own centroid;
 * 3. the longer of each matched pair is subdivided longest-segment-first with
 *    de Casteljau until both sides have the same number of cubic segments;
 * 4. closed contours are aligned: opposite windings are reversed and the second
 *    contour's start is rotated to the anchor minimizing squared anchor
 *    distance, so an in-between frame cannot twist or collapse.
 *
 * `prepareShapeMorphPair` does all structural work once; per-frame evaluation
 * only lerps aligned control points. The module is deterministic and free of
 * React, DOM, Node, and project/store imports.
 *
 * First-ticket policy: only one closed contour per pose is morph-supported.
 * Holes / multi-contour topology are reported as a typed failure so callers can
 * keep the authored geometry and degrade locally. The pairing / degenerate
 * machinery is already general (allowMultipleContours) for the follow-up
 * ticket that adds hints and multi-contour support.
 */

export interface ShapeMorphPoint {
  readonly x: number;
  readonly y: number;
}

export interface ShapeMorphPose {
  readonly contours: readonly FlaVectorContour[];
}

export type ShapeMorphFailureCode =
  | 'empty-pose'
  | 'open-contour'
  | 'unsupported-topology'
  | 'degenerate-contour'
  | 'too-many-segments'
  | 'non-finite';

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
   * Multi-contour / hole pairing is deferred to the follow-up ticket. When
   * allowed, contours pair by descending absolute area and leftovers collapse
   * to a point; when disallowed (default) any multi-contour pose is a typed
   * unsupported-topology failure.
   */
  readonly allowMultipleContours?: boolean;
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

function contourCentre(contour: NormalizedContour): ShapeMorphPoint {
  const ring = contourRing(contour);
  if (ring.length === 0) return contour.start;
  let x = 0;
  let y = 0;
  for (const entry of ring) {
    x += entry.x;
    y += entry.y;
  }
  return point(x / ring.length, y / ring.length);
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

function prepareSinglePair(
  fromContour: NormalizedContour,
  toContour: NormalizedContour,
): ShapeMorphPrepareResult {
  if (isDegenerateContour(fromContour) || isDegenerateContour(toContour)) {
    return failure(
      'degenerate-contour',
      'A zero-area closed contour cannot be shape-tweened.',
    );
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
  if (fromContours.length === 1 && toContours.length === 1) {
    return prepareSinglePair(fromContours[0]!, toContours[0]!);
  }

  const order = (contours: readonly NormalizedContour[]): readonly NormalizedContour[] =>
    [...contours].sort(
      (left, right) =>
        Math.abs(contourSignedArea(right)) - Math.abs(contourSignedArea(left)),
    );
  const orderedFrom = order(fromContours);
  const orderedTo = order(toContours);
  const pairCount = Math.max(orderedFrom.length, orderedTo.length);
  const pairs: { from: NormalizedContour; to: NormalizedContour }[] = [];
  for (let index = 0; index < pairCount; index += 1) {
    const fromContour = orderedFrom[index];
    const toContour = orderedTo[index];
    if (fromContour && toContour) {
      pairs.push({ from: fromContour, to: toContour });
    } else if (fromContour) {
      pairs.push({
        from: fromContour,
        to: collapsedContour(contourCentre(fromContour), fromContour),
      });
    } else if (toContour) {
      pairs.push({
        from: collapsedContour(contourCentre(toContour), toContour),
        to: toContour,
      });
    }
  }
  if (pairs.length === 0) {
    return failure('empty-pose', 'A shape tween requires at least one closed contour.');
  }
  let maxSegmentCount = 0;
  const preparedFrom: ShapeMorphPreparedContour[] = [];
  const preparedTo: ShapeMorphPreparedContour[] = [];
  for (const pair of pairs) {
    const fromArea = contourSignedArea(pair.from);
    const toArea = contourSignedArea(pair.to);
    const alignedTo =
      Math.sign(fromArea) === Math.sign(toArea) ? pair.to : reverseContour(pair.to);
    const target = Math.max(pair.from.segments.length, alignedTo.segments.length);
    if (target > MAX_SEGMENTS) {
      return failure(
        'too-many-segments',
        'The contour pair is too detailed for shape tweening.',
      );
    }
    maxSegmentCount = Math.max(maxSegmentCount, target);
    const fromNormalized = subdivideContourToCount(pair.from, target);
    const toNormalized = alignStartingAnchor(
      fromNormalized,
      subdivideContourToCount(alignedTo, target),
    );
    preparedFrom.push(fromNormalized);
    preparedTo.push(toNormalized);
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
