/**
 * Pure geometric variable-width stroke outline builder for Adobe Animate XFL
 * `SolidStroke` / `VariablePointWidth` / `WidthMarker` definitions.
 *
 * Independent clean-room implementation of the public arc-length width-profile
 * geometry (informed by the documented XFL `WidthMarker` semantics in
 * `lifeart/fla-viewer@b14fa1d`):
 *  - Operates on directed, author-ordered subpaths within each original `<Edge>`
 *    (never reversing or stitching across `<Edge>` boundaries).
 *  - Evaluates asymmetric left/right half-widths along normalized arc length
 *    using smooth cubic Hermite interpolation (and crisp transitions at
 *    `type="corner"` markers).
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
 * Evaluates left and right half-widths (in pixels) at normalized arc-length `t` in `[0, 1]`.
 */
export function evaluateVariableWidthProfile(
  t: number,
  markers: readonly VariableWidthMarker[],
  weight: number,
): { readonly left: number; readonly right: number } {
  if (markers.length === 0) {
    const half = weight * 0.5;
    return { left: half, right: half };
  }
  const clamped = Math.max(0, Math.min(1, t));
  const first = markers[0]!;
  if (clamped <= first.position || markers.length === 1) {
    return { left: first.left * weight, right: first.right * weight };
  }
  const last = markers[markers.length - 1]!;
  if (clamped >= last.position) {
    return { left: last.left * weight, right: last.right * weight };
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
    return { left: m1.left * weight, right: m1.right * weight };
  }
  const u = (clamped - m0.position) / span;
  let factor: number;
  if (m0.corner && m1.corner) {
    factor = u;
  } else if (m0.corner) {
    factor = 1 - (1 - u) * (1 - u);
  } else if (m1.corner) {
    factor = u * u;
  } else {
    factor = u * u * (3 - 2 * u);
  }
  return {
    left: (m0.left + (m1.left - m0.left) * factor) * weight,
    right: (m0.right + (m1.right - m0.right) * factor) * weight,
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

function appendCapPoints(
  out: VariableWidthPoint[],
  fromPt: VariableWidthPoint,
  toPt: VariableWidthPoint,
  outwardTangent: VariableWidthPoint,
  cap: 'butt' | 'round' | 'square',
): void {
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const diameter = Math.hypot(dx, dy);
  if (diameter <= 1e-3 || cap === 'butt') return;
  const radius = diameter * 0.5;
  if (cap === 'square') {
    out.push({ x: fromPt.x + outwardTangent.x * radius, y: fromPt.y + outwardTangent.y * radius });
    out.push({ x: toPt.x + outwardTangent.x * radius, y: toPt.y + outwardTangent.y * radius });
    return;
  }
  // Round cap centered at midpoint between fromPt and toPt
  const cx = (fromPt.x + toPt.x) * 0.5;
  const cy = (fromPt.y + toPt.y) * 0.5;
  const startAngle = Math.atan2(fromPt.y - cy, fromPt.x - cx);
  const endAngle = Math.atan2(toPt.y - cy, toPt.x - cx);
  let delta = endAngle - startAngle;
  // Choose the half-circle pointing along outwardTangent
  const midA = startAngle + delta * 0.5;
  const dot = Math.cos(midA) * outwardTangent.x + Math.sin(midA) * outwardTangent.y;
  if (dot < 0) {
    delta = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
  }
  for (let i = 1; i < ROUND_ARC_SEGMENTS; i += 1) {
    const a = startAngle + (delta * i) / ROUND_ARC_SEGMENTS;
    out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
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

/**
 * Expands a single directed connected subpath with a `VariablePointWidth` profile
 * into a closed filled SVG outline (`fill-rule="nonzero"`).
 */
export function buildVariableWidthStrokeOutline(
  segments: readonly VariableWidthDirectedSegment[],
  options: VariableWidthOutlineOptions,
): VariableWidthOutlineResult {
  const maxSamplePoints = options.maxSamplePoints ?? DEFAULT_MAX_SAMPLE_POINTS;
  const maxOutlinePoints = options.maxOutlinePoints ?? DEFAULT_MAX_OUTLINE_POINTS;

  const flattened = flattenDirectedSegments(segments, maxSamplePoints);
  if (!flattened.ok) {
    return { ok: false, code: 'BUDGET_EXCEEDED', message: flattened.message };
  }

  let pts = flattened.points;
  const isClosed =
    options.closed &&
    pts.length >= 3 &&
    Math.hypot(pts[pts.length - 1]!.x - pts[0]!.x, pts[pts.length - 1]!.y - pts[0]!.y) <= 1e-3;

  // For closed loops, drop the duplicate closing vertex while keeping total arc length accurate.
  if (isClosed && pts.length > 3) {
    pts = pts.slice(0, pts.length - 1);
  }

  if (pts.length < 2) {
    return { ok: true, commands: [], pathD: '', pointCount: 0 };
  }

  const count = pts.length;
  const segCount = isClosed ? count : count - 1;
  const cumLen = new Array<number>(segCount + 1);
  cumLen[0] = 0;
  const tangents: VariableWidthPoint[] = [];

  for (let i = 0; i < segCount; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % count]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    cumLen[i + 1] = cumLen[i]! + len;
    const t = unitVector(b.x - a.x, b.y - a.y);
    tangents.push(t ?? (tangents[tangents.length - 1] ?? { x: 1, y: 0 }));
  }

  const totalLength = cumLen[segCount]!;
  if (totalLength <= EPSILON) {
    return { ok: true, commands: [], pathD: '', pointCount: 0 };
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
    return {
      ok: true,
      commands,
      pathD: parts.join(' '),
      pointCount: leftPts.length + reversedRight.length,
    };
  }

  // Open path
  for (let i = 0; i < count; i += 1) {
    const p = pts[i]!;
    const tNorm = cumLen[i]! / totalLength;
    const { left, right } = evaluateVariableWidthProfile(tNorm, options.markers, options.weight);
    if (i === 0) {
      const t0 = tangents[0]!;
      const nl = leftNormal(t0);
      const nr = rightNormal(t0);
      leftPts.push({ x: p.x + nl.x * left, y: p.y + nl.y * left });
      rightPts.push({ x: p.x + nr.x * right, y: p.y + nr.y * right });
    } else if (i === count - 1) {
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
  appendCapPoints(outline, leftPts[leftPts.length - 1]!, rightPts[rightPts.length - 1]!, endTangent, options.cap);
  for (let i = rightPts.length - 1; i >= 0; i -= 1) {
    outline.push(rightPts[i]!);
  }
  const startTangent = tangents[0]!;
  appendCapPoints(
    outline,
    rightPts[0]!,
    leftPts[0]!,
    { x: -startTangent.x, y: -startTangent.y },
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
  return {
    ok: true,
    commands,
    pathD: parts.join(' '),
    pointCount: outline.length,
  };
}
