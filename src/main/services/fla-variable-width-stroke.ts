/**
 * Pure geometric variable-width stroke outline builder for Adobe Animate XFL
 * `SolidStroke` / `VariablePointWidth` / `WidthMarker` definitions.
 *
 * Geometry and upstream attribution:
 *  - Operates on directed, author-ordered subpaths within each original `<Edge>`
 *    (never reversing or stitching across `<Edge>` boundaries), keeping Panda
 *    Stage's exact arc-length sampling, binary marker lookup, closed-loop
 *    opposite-winding inner/outer contours, paint/opacity handling, and
 *    cumulative command/point budgets.
 *  - Profile evaluation (`markerSlope` + cubic Hermite with corner one-sided
 *    secants and non-negative clamp) and asymmetric quarter-ellipse round cap
 *    (`appendCapPoints`) are adapted from `lifeart/fla-viewer` at pinned commit
 *    `b14fa1d1e3e2d2b035e174bde472a7941d385b17` (`src/variable-width-stroke.ts`
 *    L39-78 and L285-303). Upstream `README.md` (L161-163) and `package.json`
 *    (L21) declare the ISC license (no standalone `LICENSE` file is present in
 *    that pinned tree). Note that upstream's Catmull-Rom/Hermite inter-marker
 *    curve is inferred rather than an official Adobe Animate formula.
 *  - Emits bounded closed polygon contours (`M`/`L`/`Z`) with `nonzero` winding
 *    (opposite-winding inner/outer contours for closed loops so hollow rings
 *    retain their interior hole).
 */

export interface VariableWidthMarker {
  readonly position: number;
  readonly left: number;
  readonly right: number;
  readonly corner: boolean;
}

export interface VariableWidthPoint {
  readonly x: number;
  readonly y: number;
}

export type VariableWidthSegmentCommand =
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | { readonly type: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | {
      readonly type: 'C';
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    };

export interface VariableWidthDirectedSegment {
  readonly from: VariableWidthPoint;
  readonly to: VariableWidthPoint;
  readonly command: VariableWidthSegmentCommand;
}

export interface VariableWidthOutlineOptions {
  readonly weight: number;
  readonly markers: readonly VariableWidthMarker[];
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly closed: boolean;
  readonly maxSamplePoints?: number;
  readonly maxOutlinePoints?: number;
  readonly maxOutlineCommands?: number;
}

export type VariableWidthOutlineCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | { readonly type: 'Z' };

export type VariableWidthOutlineResult =
  | {
      readonly ok: true;
      readonly commands: readonly VariableWidthOutlineCommand[];
      readonly pathD: string;
      readonly pointCount: number;
    }
  | {
      readonly ok: false;
      readonly code: 'BUDGET_EXCEEDED' | 'RENDER_FAILED';
      readonly message: string;
    };

const DEFAULT_MAX_SAMPLE_POINTS = 4_096;
const DEFAULT_MAX_OUTLINE_POINTS = 12_000;
const CURVE_FLATNESS_TOLERANCE = 0.35;
const MAX_CURVE_SUBDIVISIONS = 64;
const EPSILON = 1e-6;
const ROUND_ARC_SEGMENTS = 8;

function formatCoord(value: number): string {
  const normalized = Object.is(value, -0) || Math.abs(value) < 1e-9 ? 0 : value;
  return normalized.toFixed(4);
}

/**
 * Neighborhood finite-difference slope for one side at marker `index`, for the
 * span leaving (`out`) or arriving (`in`). Corner markers and the two endpoints
 * use the span's own one-sided secant; interior smooth markers use the
 * Catmull-Rom chord across `(prev, next)`.
 *
 * Adapted from `lifeart/fla-viewer@b14fa1d` (`markerSlope`, ISC per upstream
 * README.md / package.json).
 */
function markerSlope(
  markers: readonly VariableWidthMarker[],
  index: number,
  side: 'left' | 'right',
  dir: 'in' | 'out',
): number {
  const m = markers[index]!;
  const prev = markers[index - 1];
  const next = markers[index + 1];
  if (m.corner || !prev || !next) {
    const other = dir === 'out' ? next : prev;
    if (!other) return 0;
    const delta = other.position - m.position;
    if (Math.abs(delta) <= 1e-9) return 0;
    return (other[side] - m[side]) / delta;
  }
  const span = next.position - prev.position;
  return span > 1e-9 ? (next[side] - prev[side]) / span : 0;
}

/**
 * Evaluates left and right half-widths (in pixels) at normalized arc-length `t` in `[0, 1]`.
 *
 * Uses Panda's binary search with neighborhood-slope cubic Hermite interpolation
 * (non-negative clamped ratio multiplied by stroke `weight` once), adapted from
 * `lifeart/fla-viewer@b14fa1d` (`widthProfileAt`, ISC per upstream README.md /
 * package.json).
 */
export function evaluateVariableWidthProfile(
  t: number,
  markers: readonly VariableWidthMarker[],
  weight: number,
): { readonly left: number; readonly right: number } {
  const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 0;
  if (markers.length === 0) {
    const half = safeWeight * 0.5;
    return { left: half, right: half };
  }
  const clamped = Math.max(0, Math.min(1, t));
  const first = markers[0]!;
  if (clamped <= first.position || markers.length === 1) {
    return {
      left: Math.max(0, first.left) * safeWeight,
      right: Math.max(0, first.right) * safeWeight,
    };
  }
  const last = markers[markers.length - 1]!;
  if (clamped >= last.position) {
    return {
      left: Math.max(0, last.left) * safeWeight,
      right: Math.max(0, last.right) * safeWeight,
    };
  }

  let lo = 0;
  let hi = markers.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid]!.position <= clamped) lo = mid;
    else hi = mid;
  }
  const m0 = markers[lo]!;
  const m1 = markers[hi]!;
  const span = m1.position - m0.position;
  if (span <= 1e-9) {
    return {
      left: Math.max(0, m1.left) * safeWeight,
      right: Math.max(0, m1.right) * safeWeight,
    };
  }
  const u = (clamped - m0.position) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = (u3 - 2 * u2 + u) * span;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = (u3 - u2) * span;
  const evalSide = (side: 'left' | 'right'): number => {
    const ratio =
      h00 * m0[side] +
      h10 * markerSlope(markers, lo, side, 'out') +
      h01 * m1[side] +
      h11 * markerSlope(markers, hi, side, 'in');
    return Math.max(0, ratio) * safeWeight;
  };
  return {
    left: evalSide('left'),
    right: evalSide('right'),
  };
}

function estimateQuadraticSteps(p0: VariableWidthPoint, c: VariableWidthPoint, p1: VariableWidthPoint): number {
  const mx = (p0.x + p1.x) * 0.5;
  const my = (p0.y + p1.y) * 0.5;
  const dev = Math.hypot(c.x - mx, c.y - my);
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const flatnessSteps = Math.ceil(Math.sqrt(Math.max(0, dev) / CURVE_FLATNESS_TOLERANCE) * 2);
  const lengthSteps = Math.ceil(chord / 16);
  return Math.max(2, Math.min(MAX_CURVE_SUBDIVISIONS, Math.max(flatnessSteps, lengthSteps)));
}

function estimateCubicSteps(
  p0: VariableWidthPoint,
  c1: VariableWidthPoint,
  c2: VariableWidthPoint,
  p1: VariableWidthPoint,
): number {
  const d1 = Math.hypot(c1.x - (p0.x * 2 + p1.x) / 3, c1.y - (p0.y * 2 + p1.y) / 3);
  const d2 = Math.hypot(c2.x - (p0.x + p1.x * 2) / 3, c2.y - (p0.y + p1.y * 2) / 3);
  const dev = Math.max(d1, d2);
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const flatnessSteps = Math.ceil(Math.sqrt(Math.max(0, dev) / CURVE_FLATNESS_TOLERANCE) * 2.5);
  const lengthSteps = Math.ceil(chord / 16);
  return Math.max(2, Math.min(MAX_CURVE_SUBDIVISIONS, Math.max(flatnessSteps, lengthSteps)));
}

function flattenDirectedSegments(
  segments: readonly VariableWidthDirectedSegment[],
  maxSamplePoints: number,
): { readonly ok: true; readonly points: readonly VariableWidthPoint[] } | { readonly ok: false; readonly message: string } {
  if (segments.length === 0) return { ok: true, points: [] };

  // Estimate total chord length to choose sensible line-subdivision granularity
  // so smooth width profiles along straight lines do not look faceted.
  let approxLength = 0;
  for (const seg of segments) {
    approxLength += Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
  }
  const targetLineStep = Math.max(2, Math.min(16, approxLength / 24));

  const points: VariableWidthPoint[] = [{ x: segments[0]!.from.x, y: segments[0]!.from.y }];
  const pushPoint = (x: number, y: number): boolean => {
    const prev = points[points.length - 1]!;
    if (Math.hypot(x - prev.x, y - prev.y) <= EPSILON) return true;
    if (points.length >= maxSamplePoints) return false;
    points.push({ x, y });
    return true;
  };

  for (const seg of segments) {
    const { from, to, command } = seg;
    if (command.type === 'L') {
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = len <= EPSILON ? 0 : Math.max(1, Math.min(32, Math.ceil(len / targetLineStep)));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        if (!pushPoint(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) {
          return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
        }
      }
      continue;
    }
    if (command.type === 'Q') {
      const c = { x: command.cx, y: command.cy };
      const steps = estimateQuadraticSteps(from, c, to);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt * mt * from.x + 2 * mt * t * c.x + t * t * to.x;
        const y = mt * mt * from.y + 2 * mt * t * c.y + t * t * to.y;
        if (!pushPoint(x, y)) {
          return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
        }
      }
      continue;
    }
    const c1 = { x: command.c1x, y: command.c1y };
    const c2 = { x: command.c2x, y: command.c2y };
    const steps = estimateCubicSteps(from, c1, c2, to);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const mt = 1 - t;
      const x =
        mt * mt * mt * from.x +
        3 * mt * mt * t * c1.x +
        3 * mt * t * t * c2.x +
        t * t * t * to.x;
      const y =
        mt * mt * mt * from.y +
        3 * mt * mt * t * c1.y +
        3 * mt * t * t * c2.y +
        t * t * t * to.y;
      if (!pushPoint(x, y)) {
        return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
      }
    }
  }

  return { ok: true, points };
}

function unitVector(dx: number, dy: number): VariableWidthPoint | null {
  const len = Math.hypot(dx, dy);
  if (len <= EPSILON) return null;
  return { x: dx / len, y: dy / len };
}

/** Left normal in SVG screen coords (+x right, +y down): (ty, -tx). */
function leftNormal(t: VariableWidthPoint): VariableWidthPoint {
  return { x: t.y, y: -t.x };
}

/** Right normal in SVG screen coords (+x right, +y down): (-ty, tx). */
function rightNormal(t: VariableWidthPoint): VariableWidthPoint {
  return { x: -t.y, y: t.x };
}

function appendJoinPoints(
  out: VariableWidthPoint[],
  center: VariableWidthPoint,
  nIn: VariableWidthPoint,
  nOut: VariableWidthPoint,
  width: number,
  join: 'miter' | 'round' | 'bevel',
  miterLimit: number,
  isOuterTurn: boolean,
): void {
  const pIn = { x: center.x + nIn.x * width, y: center.y + nIn.y * width };
  const pOut = { x: center.x + nOut.x * width, y: center.y + nOut.y * width };

  if (width <= EPSILON) {
    out.push(center);
    return;
  }

  const dot = Math.max(-1, Math.min(1, nIn.x * nOut.x + nIn.y * nOut.y));
  if (dot > 0.999) {
    out.push({ x: (pIn.x + pOut.x) * 0.5, y: (pIn.y + pOut.y) * 0.5 });
    return;
  }

  if (!isOuterTurn) {
    // Inner side of turn: simple miter-clamped average avoids self-intersection spikes.
    const bx = nIn.x + nOut.x;
    const by = nIn.y + nOut.y;
    const bLen = Math.hypot(bx, by);
    if (bLen > EPSILON) {
      const invCos = 2 / (bLen * bLen);
      const scale = Math.min(2, invCos);
      out.push({
        x: center.x + (bx / bLen) * width * Math.min(scale, 1.5),
        y: center.y + (by / bLen) * width * Math.min(scale, 1.5),
      });
    } else {
      out.push(pIn);
      out.push(pOut);
    }
    return;
  }

  if (join === 'miter') {
    const bx = nIn.x + nOut.x;
    const by = nIn.y + nOut.y;
    const bLen = Math.hypot(bx, by);
    if (bLen > EPSILON) {
      const cosHalf = bLen * 0.5;
      const miterRatio = 1 / cosHalf;
      if (Number.isFinite(miterRatio) && miterRatio <= miterLimit) {
        out.push({
          x: center.x + (bx / bLen) * width * miterRatio,
          y: center.y + (by / bLen) * width * miterRatio,
        });
        return;
      }
    }
    // Exceeds miterLimit -> fall back to bevel
    out.push(pIn);
    out.push(pOut);
    return;
  }

  if (join === 'bevel') {
    out.push(pIn);
    out.push(pOut);
    return;
  }

  // Round join
  const startAngle = Math.atan2(nIn.y, nIn.x);
  const endAngle = Math.atan2(nOut.y, nOut.x);
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const steps = Math.max(2, Math.min(ROUND_ARC_SEGMENTS, Math.ceil(Math.abs(delta) / (Math.PI / 6))));
  out.push(pIn);
  for (let i = 1; i < steps; i += 1) {
    const a = startAngle + (delta * i) / steps;
    out.push({
      x: center.x + Math.cos(a) * width,
      y: center.y + Math.sin(a) * width,
    });
  }
  out.push(pOut);
}

/**
 * Appends cap points at an open endpoint `anchor`, sweeping from the `from` edge
 * (offset by `fromNormal * fromHalfWidth`) to the opposite edge (offset by
 * `-fromNormal * toHalfWidth`), projecting along `outwardTangent` by the average
 * half-width `(fromHalfWidth + toHalfWidth) * 0.5`.
 *
 * For `round` caps, each side uses a quarter-ellipse anchored at `anchor`
 * (degenerating to a semicircle when `fromHalfWidth === toHalfWidth`), adapted
 * from `lifeart/fla-viewer@b14fa1d` (`capPoints`, ISC per upstream README.md /
 * package.json). The two edge points themselves are not duplicated.
 */
function appendCapPoints(
  out: VariableWidthPoint[],
  anchor: VariableWidthPoint,
  fromNormal: VariableWidthPoint,
  outwardTangent: VariableWidthPoint,
  fromHalfWidth: number,
  toHalfWidth: number,
  cap: 'butt' | 'round' | 'square',
): void {
  const diameter = fromHalfWidth + toHalfWidth;
  if (diameter <= 1e-3 || cap === 'butt') return;
  const forwardExt = diameter * 0.5;
  if (cap === 'square') {
    out.push({
      x: anchor.x + fromNormal.x * fromHalfWidth + outwardTangent.x * forwardExt,
      y: anchor.y + fromNormal.y * fromHalfWidth + outwardTangent.y * forwardExt,
    });
    out.push({
      x: anchor.x - fromNormal.x * toHalfWidth + outwardTangent.x * forwardExt,
      y: anchor.y - fromNormal.y * toHalfWidth + outwardTangent.y * forwardExt,
    });
    return;
  }
  for (let i = 1; i < ROUND_ARC_SEGMENTS; i += 1) {
    const phi = (Math.PI * i) / ROUND_ARC_SEGMENTS;
    const c = Math.cos(phi);
    const lateral = c * (c >= 0 ? fromHalfWidth : toHalfWidth);
    const forward = Math.sin(phi) * forwardExt;
    out.push({
      x: anchor.x + fromNormal.x * lateral + outwardTangent.x * forward,
      y: anchor.y + fromNormal.y * lateral + outwardTangent.y * forward,
    });
  }
}

function encodeContour(
  contour: readonly VariableWidthPoint[],
  commands: VariableWidthOutlineCommand[],
  parts: string[],
): boolean {
  if (contour.length < 3) return true;
  const first = contour[0]!;
  if (!Number.isFinite(first.x) || !Number.isFinite(first.y)) return false;
  commands.push({ type: 'M', x: first.x, y: first.y });
  parts.push(`M ${formatCoord(first.x)} ${formatCoord(first.y)}`);
  for (let i = 1; i < contour.length; i += 1) {
    const p = contour[i]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    commands.push({ type: 'L', x: p.x, y: p.y });
    parts.push(`L ${formatCoord(p.x)} ${formatCoord(p.y)}`);
  }
  commands.push({ type: 'Z' });
  parts.push('Z');
  return true;
}

function mergeMarkerArcLengthSamples(
  pts: readonly VariableWidthPoint[],
  cumLen: readonly number[],
  totalLength: number,
  isClosed: boolean,
  markers: readonly VariableWidthMarker[],
  maxSamplePoints: number,
):
  | { readonly ok: true; readonly points: readonly VariableWidthPoint[]; readonly cumLen: readonly number[] }
  | { readonly ok: false; readonly message: string } {
  const targetDists: number[] = [];
  for (const marker of markers) {
    if (marker.position <= 0 || marker.position >= 1) continue;
    const dist = marker.position * totalLength;
    if (dist <= EPSILON || totalLength - dist <= EPSILON) continue;
    if (targetDists.length === 0 || dist - targetDists[targetDists.length - 1]! > EPSILON) {
      targetDists.push(dist);
    }
  }
  if (targetDists.length === 0) {
    return { ok: true, points: pts, cumLen };
  }

  const count = pts.length;
  const segCount = isClosed ? count : count - 1;
  const mergedPts: VariableWidthPoint[] = [];
  const mergedCumLen: number[] = [];
  let markerIdx = 0;

  for (let i = 0; i < segCount; i += 1) {
    const segStart = cumLen[i]!;
    const segEnd = cumLen[i + 1]!;
    const segSpan = segEnd - segStart;
    if (mergedPts.length >= maxSamplePoints) {
      return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
    }
    mergedPts.push(pts[i]!);
    mergedCumLen.push(segStart);

    while (markerIdx < targetDists.length && targetDists[markerIdx]! <= segStart + EPSILON) {
      markerIdx += 1;
    }
    const a = pts[i]!;
    const b = pts[(i + 1) % count]!;
    while (markerIdx < targetDists.length && targetDists[markerIdx]! < segEnd - EPSILON) {
      if (mergedPts.length >= maxSamplePoints) {
        return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
      }
      const dist = targetDists[markerIdx]!;
      const alpha = segSpan > EPSILON ? (dist - segStart) / segSpan : 0;
      mergedPts.push({
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
      });
      mergedCumLen.push(dist);
      markerIdx += 1;
    }
  }

  if (!isClosed) {
    if (mergedPts.length >= maxSamplePoints) {
      return { ok: false, message: 'Variable-width stroke sample point budget exceeded' };
    }
    mergedPts.push(pts[count - 1]!);
    mergedCumLen.push(totalLength);
  } else {
    mergedCumLen.push(totalLength);
  }

  return { ok: true, points: mergedPts, cumLen: mergedCumLen };
}

/**
 * Expands a single directed connected subpath with a `VariablePointWidth` profile
 * into a closed filled SVG outline (`fill-rule="nonzero"`).
 */
export function buildVariableWidthStrokeOutline(
  segments: readonly VariableWidthDirectedSegment[],
  options: VariableWidthOutlineOptions,
): VariableWidthOutlineResult {
  const rawMaxOutlinePoints = options.maxOutlinePoints ?? DEFAULT_MAX_OUTLINE_POINTS;
  const maxOutlineCommands = options.maxOutlineCommands;
  if (maxOutlineCommands !== undefined && maxOutlineCommands < 4) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: 'Composition path-command budget exceeded during variable-width stroke expansion',
    };
  }
  const preliminaryMaxOutlinePoints = maxOutlineCommands !== undefined
    ? Math.min(rawMaxOutlinePoints, maxOutlineCommands - 1)
    : rawMaxOutlinePoints;
  const maxSamplePoints = Math.min(
    options.maxSamplePoints ?? DEFAULT_MAX_SAMPLE_POINTS,
    preliminaryMaxOutlinePoints,
  );

  const flattened = flattenDirectedSegments(segments, maxSamplePoints);
  if (!flattened.ok) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: flattened.message };
  }

  let pts = flattened.points;
  const isClosed =
    options.closed &&
    pts.length >= 3 &&
    Math.hypot(pts[pts.length - 1]!.x - pts[0]!.x, pts[pts.length - 1]!.y - pts[0]!.y) <= 1e-3;

  const contourOverhead = isClosed ? 2 : 1;
  const maxOutlinePoints = maxOutlineCommands !== undefined
    ? Math.min(rawMaxOutlinePoints, maxOutlineCommands - contourOverhead)
    : rawMaxOutlinePoints;
  if (maxOutlinePoints < (isClosed ? 6 : 3)) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: 'Composition path-command budget exceeded during variable-width stroke expansion',
    };
  }

  // For closed loops, drop the duplicate closing vertex while keeping total arc length accurate.
  if (isClosed && pts.length > 3) {
    pts = pts.slice(0, pts.length - 1);
  }

  if (pts.length < 2) {
    return { ok: true, commands: [], pathD: '', pointCount: 0 };
  }

  const rawCount = pts.length;
  const rawSegCount = isClosed ? rawCount : rawCount - 1;
  const rawCumLen = new Array<number>(rawSegCount + 1);
  rawCumLen[0] = 0;

  for (let i = 0; i < rawSegCount; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % rawCount]!;
    rawCumLen[i + 1] = rawCumLen[i]! + Math.hypot(b.x - a.x, b.y - a.y);
  }

  const totalLength = rawCumLen[rawSegCount]!;
  if (totalLength <= EPSILON) {
    return { ok: true, commands: [], pathD: '', pointCount: 0 };
  }

  const merged = mergeMarkerArcLengthSamples(
    pts,
    rawCumLen,
    totalLength,
    isClosed,
    options.markers,
    maxSamplePoints,
  );
  if (!merged.ok) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: merged.message };
  }

  pts = merged.points;
  const cumLen = merged.cumLen;
  const count = pts.length;
  const segCount = isClosed ? count : count - 1;
  const tangents: VariableWidthPoint[] = [];

  for (let i = 0; i < segCount; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % count]!;
    const t = unitVector(b.x - a.x, b.y - a.y);
    tangents.push(t ?? (tangents[tangents.length - 1] ?? { x: 1, y: 0 }));
  }

  const leftPts: VariableWidthPoint[] = [];
  const rightPts: VariableWidthPoint[] = [];

  if (isClosed) {
    for (let i = 0; i < count; i += 1) {
      const p = pts[i]!;
      const tNorm = cumLen[i]! / totalLength;
      const { left, right } = evaluateVariableWidthProfile(tNorm, options.markers, options.weight);
      const tIn = tangents[(i - 1 + segCount) % segCount]!;
      const tOut = tangents[i]!;
      // Cross product in screen coords: > 0 means turning right (clockwise), so left side is outer.
      const cross = tIn.x * tOut.y - tIn.y * tOut.x;
      appendJoinPoints(leftPts, p, leftNormal(tIn), leftNormal(tOut), left, options.join, options.miterLimit, cross > 0);
      appendJoinPoints(rightPts, p, rightNormal(tIn), rightNormal(tOut), right, options.join, options.miterLimit, cross < 0);
      if (leftPts.length + rightPts.length > maxOutlinePoints) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Variable-width stroke outline point budget exceeded' };
      }
    }

    // Opposite winding for left (forward) and right (reversed) contours preserves hollow interior under nonzero fill-rule.
    const reversedRight = [...rightPts].reverse();
    const commands: VariableWidthOutlineCommand[] = [];
    const parts: string[] = [];
    if (!encodeContour(leftPts, commands, parts) || !encodeContour(reversedRight, commands, parts)) {
      return { ok: false, code: 'RENDER_FAILED', message: 'Variable-width stroke produced non-finite coordinates' };
    }
    if (maxOutlineCommands !== undefined && commands.length > maxOutlineCommands) {
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: 'Composition path-command budget exceeded during variable-width stroke expansion',
      };
    }
    return {
      ok: true,
      commands,
      pathD: parts.join(' '),
      pointCount: leftPts.length + reversedRight.length,
    };
  }

  // Open path
  let startProfile = { left: 0, right: 0 };
  let endProfile = { left: 0, right: 0 };
  for (let i = 0; i < count; i += 1) {
    const p = pts[i]!;
    const tNorm = cumLen[i]! / totalLength;
    const profile = evaluateVariableWidthProfile(tNorm, options.markers, options.weight);
    const { left, right } = profile;
    if (i === 0) {
      startProfile = profile;
      const t0 = tangents[0]!;
      const nl = leftNormal(t0);
      const nr = rightNormal(t0);
      leftPts.push({ x: p.x + nl.x * left, y: p.y + nl.y * left });
      rightPts.push({ x: p.x + nr.x * right, y: p.y + nr.y * right });
    } else if (i === count - 1) {
      endProfile = profile;
      const tLast = tangents[segCount - 1]!;
      const nl = leftNormal(tLast);
      const nr = rightNormal(tLast);
      leftPts.push({ x: p.x + nl.x * left, y: p.y + nl.y * left });
      rightPts.push({ x: p.x + nr.x * right, y: p.y + nr.y * right });
    } else {
      const tIn = tangents[i - 1]!;
      const tOut = tangents[i]!;
      const cross = tIn.x * tOut.y - tIn.y * tOut.x;
      appendJoinPoints(leftPts, p, leftNormal(tIn), leftNormal(tOut), left, options.join, options.miterLimit, cross > 0);
      appendJoinPoints(rightPts, p, rightNormal(tIn), rightNormal(tOut), right, options.join, options.miterLimit, cross < 0);
    }
    if (leftPts.length + rightPts.length > maxOutlinePoints) {
      return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Variable-width stroke outline point budget exceeded' };
    }
  }

  const outline: VariableWidthPoint[] = [...leftPts];
  const endTangent = tangents[segCount - 1]!;
  appendCapPoints(
    outline,
    pts[count - 1]!,
    leftNormal(endTangent),
    endTangent,
    endProfile.left,
    endProfile.right,
    options.cap,
  );
  for (let i = rightPts.length - 1; i >= 0; i -= 1) {
    outline.push(rightPts[i]!);
  }
  const startTangent = tangents[0]!;
  appendCapPoints(
    outline,
    pts[0]!,
    rightNormal(startTangent),
    { x: -startTangent.x, y: -startTangent.y },
    startProfile.right,
    startProfile.left,
    options.cap,
  );

  if (outline.length > maxOutlinePoints) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Variable-width stroke outline point budget exceeded' };
  }

  const commands: VariableWidthOutlineCommand[] = [];
  const parts: string[] = [];
  if (!encodeContour(outline, commands, parts)) {
    return { ok: false, code: 'RENDER_FAILED', message: 'Variable-width stroke produced non-finite coordinates' };
  }
  if (maxOutlineCommands !== undefined && commands.length > maxOutlineCommands) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      message: 'Composition path-command budget exceeded during variable-width stroke expansion',
    };
  }
  return {
    ok: true,
    commands,
    pathD: parts.join(' '),
    pointCount: outline.length,
  };
}
