import { z } from 'zod';
import { multiplyAffineMatrices, type AffineMatrix2D } from '../shared/affine-matrix';

export const FlaVectorPathCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('M'),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('L'),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('Q'),
      cx: z.number().finite(),
      cy: z.number().finite(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('C'),
      c1x: z.number().finite(),
      c1y: z.number().finite(),
      c2x: z.number().finite(),
      c2y: z.number().finite(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('Z'),
    })
    .strict(),
]);

export type FlaVectorPathCommand = z.infer<typeof FlaVectorPathCommandSchema>;

export const FlaVectorContourSchema = z
  .object({
    closed: z.boolean(),
    commands: z.array(FlaVectorPathCommandSchema).min(1).max(20_000),
  })
  .strict();

export type FlaVectorContour = z.infer<typeof FlaVectorContourSchema>;

export const FlaEditableStrokeSchema = z
  .object({
    color: z.string().trim().min(1).max(128),
    opacity: z.number().finite().min(0).max(1),
    lineWidth: z.number().finite().positive().max(10_000),
    lineCap: z.enum(['butt', 'round', 'square']),
    lineJoin: z.enum(['miter', 'round', 'bevel']),
    miterLimit: z.number().finite().positive().max(1_000),
    closed: z.boolean(),
    commands: z.array(FlaVectorPathCommandSchema).min(1).max(20_000),
  })
  .strict();

export type FlaEditableStroke = z.infer<typeof FlaEditableStrokeSchema>;

export const FlaEditableFillSchema = z
  .object({
    kind: z.enum(['solid', 'gradient-ref', 'preserved']),
    color: z.string().trim().min(1).max(64).optional(),
    opacity: z.number().finite().min(0).max(1),
    fillRule: z.enum(['nonzero', 'evenodd']),
    svgPaint: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type FlaEditableFill = z.infer<typeof FlaEditableFillSchema>;

export const FlaShapeBoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export type FlaShapeBounds = z.infer<typeof FlaShapeBoundsSchema>;

export const FlaEditableShapeRegionSchema = z
  .object({
    regionRef: z.string().trim().min(1).max(128),
    sourceShapeRef: z.string().trim().min(1).max(200).optional(),
    fill: FlaEditableFillSchema,
    contours: z.array(FlaVectorContourSchema).min(1).max(512),
    strokes: z.array(FlaEditableStrokeSchema).max(2_000).default([]),
    bounds: FlaShapeBoundsSchema,
  })
  .strict();

export type FlaEditableShapeRegion = z.infer<typeof FlaEditableShapeRegionSchema>;

const FlaStructureAffineMatrixSchema = z
  .object({
    a: z.number().finite(),
    b: z.number().finite(),
    c: z.number().finite(),
    d: z.number().finite(),
    tx: z.number().finite(),
    ty: z.number().finite(),
  })
  .strict();

export const FlaExtractedShapeRegionEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(1_000),
    regionRef: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(120),
    region: FlaEditableShapeRegionSchema,
    baseViewBox: FlaShapeBoundsSchema,
    localTransform: FlaStructureAffineMatrixSchema,
  })
  .strict();

export type FlaExtractedShapeRegionEntry = z.infer<
  typeof FlaExtractedShapeRegionEntrySchema
>;

export const FlaGraphicShapeNodeOverrideSchema = z
  .object({
    baseViewBox: FlaShapeBoundsSchema,
    regions: z.array(FlaEditableShapeRegionSchema).max(512),
    excludedRegionRefs: z.array(z.string().trim().min(1).max(128)).max(512).default([]),
    extractedRegions: z.array(FlaExtractedShapeRegionEntrySchema).max(512).default([]),
    residueStrokes: z.array(FlaEditableStrokeSchema).max(2_000).optional(),
    hasUnrenderableResidue: z.boolean().optional(),
    ambiguousRegionRefs: z.array(z.string().trim().min(1).max(128)).max(512).optional(),
    bitmapFillRegionRefs: z.array(z.string().trim().min(1).max(128)).max(512).optional(),
    sourceDefsSvg: z.string().max(512 * 1024).optional(),
  })
  .strict();

export type FlaGraphicShapeNodeOverride = z.infer<
  typeof FlaGraphicShapeNodeOverrideSchema
>;

export const FlaGraphicShapeOverridesSchema = z.record(
  z.string().regex(/^(0|[1-9]\d*)$/u),
  z.record(z.string().min(3).max(65_536), FlaGraphicShapeNodeOverrideSchema),
);

export type FlaGraphicShapeOverrides = z.infer<
  typeof FlaGraphicShapeOverridesSchema
>;

export interface FlaShapeVertexTarget {
  readonly contourIndex: number;
  readonly commandIndex: number;
  readonly pointKind: 'anchor' | 'q-control' | 'c1' | 'c2';
}

export interface FlaShapeVertexHandle extends FlaShapeVertexTarget {
  readonly x: number;
  readonly y: number;
}

export interface FlaShapeRegionDecompositionResult {
  readonly viewBox: FlaShapeBounds;
  readonly regions: readonly FlaEditableShapeRegion[];
  readonly residueStrokes: readonly FlaEditableStroke[];
  readonly hasUnrenderableResidue: boolean;
  readonly ambiguousRegionRefs: ReadonlySet<string>;
  readonly bitmapFillRegionRefs: ReadonlySet<string>;
  readonly defsSvg?: string;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Parses standard SVG path `d` syntax into absolute `M/L/Q/C/Z` commands. */
export function parseSvgPathCommands(d: string): readonly FlaVectorPathCommand[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gu);
  if (!tokens) return [];
  const commands: FlaVectorPathCommand[] = [];
  let index = 0;
  let currentX = 0;
  let currentY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let activeCommand = '';

  const nextNumber = (): number | null => {
    const token = tokens[index];
    if (token === undefined || /^[a-zA-Z]$/u.test(token)) return null;
    index += 1;
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  };

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[a-zA-Z]$/u.test(token)) {
      activeCommand = token;
      index += 1;
      if (activeCommand === 'Z' || activeCommand === 'z') {
        commands.push({ type: 'Z' });
        currentX = subpathStartX;
        currentY = subpathStartY;
        activeCommand = '';
        continue;
      }
    }
    if (!activeCommand) break;
    const relative = activeCommand === activeCommand.toLowerCase();
    const op = activeCommand.toUpperCase();
    if (op === 'M' || op === 'L') {
      const x = nextNumber();
      const y = nextNumber();
      if (x === null || y === null) break;
      const absX = relative ? currentX + x : x;
      const absY = relative ? currentY + y : y;
      commands.push({ type: op, x: absX, y: absY });
      currentX = absX;
      currentY = absY;
      if (op === 'M') {
        subpathStartX = absX;
        subpathStartY = absY;
        activeCommand = relative ? 'l' : 'L';
      }
    } else if (op === 'H') {
      const x = nextNumber();
      if (x === null) break;
      const absX = relative ? currentX + x : x;
      commands.push({ type: 'L', x: absX, y: currentY });
      currentX = absX;
    } else if (op === 'V') {
      const y = nextNumber();
      if (y === null) break;
      const absY = relative ? currentY + y : y;
      commands.push({ type: 'L', x: currentX, y: absY });
      currentY = absY;
    } else if (op === 'Q') {
      const cx = nextNumber();
      const cy = nextNumber();
      const x = nextNumber();
      const y = nextNumber();
      if (cx === null || cy === null || x === null || y === null) break;
      const absCx = relative ? currentX + cx : cx;
      const absCy = relative ? currentY + cy : cy;
      const absX = relative ? currentX + x : x;
      const absY = relative ? currentY + y : y;
      commands.push({ type: 'Q', cx: absCx, cy: absCy, x: absX, y: absY });
      currentX = absX;
      currentY = absY;
    } else if (op === 'C') {
      const c1x = nextNumber();
      const c1y = nextNumber();
      const c2x = nextNumber();
      const c2y = nextNumber();
      const x = nextNumber();
      const y = nextNumber();
      if (c1x === null || c1y === null || c2x === null || c2y === null || x === null || y === null) {
        break;
      }
      commands.push({
        type: 'C',
        c1x: relative ? currentX + c1x : c1x,
        c1y: relative ? currentY + c1y : c1y,
        c2x: relative ? currentX + c2x : c2x,
        c2y: relative ? currentY + c2y : c2y,
        x: relative ? currentX + x : x,
        y: relative ? currentY + y : y,
      });
      currentX = relative ? currentX + x : x;
      currentY = relative ? currentY + y : y;
    } else {
      break;
    }
  }
  return commands;
}

/** Formats canonical commands back into an SVG path `d` string. */
export function commandsToSvgPathD(
  commands: readonly FlaVectorPathCommand[],
): string {
  const parts: string[] = [];
  const fmt = (n: number): string => Number(n.toFixed(4)).toString();
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        parts.push(`M ${fmt(cmd.x)} ${fmt(cmd.y)}`);
        break;
      case 'L':
        parts.push(`L ${fmt(cmd.x)} ${fmt(cmd.y)}`);
        break;
      case 'Q':
        parts.push(`Q ${fmt(cmd.cx)} ${fmt(cmd.cy)} ${fmt(cmd.x)} ${fmt(cmd.y)}`);
        break;
      case 'C':
        parts.push(
          `C ${fmt(cmd.c1x)} ${fmt(cmd.c1y)} ${fmt(cmd.c2x)} ${fmt(cmd.c2y)} ${fmt(cmd.x)} ${fmt(cmd.y)}`,
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

function readTagAttrs(tagText: string): ReadonlyMap<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tagText)) !== null) {
    attrs.set(match[1]!, match[2]!);
  }
  return attrs;
}

function parseSvgTransformAttr(raw: string | undefined): AffineMatrix2D | null {
  if (!raw) return null;
  let result: AffineMatrix2D | null = null;
  const opPattern = /(matrix|translate|scale)\s*\(([^)]+)\)/gu;
  let match: RegExpExecArray | null;
  while ((match = opPattern.exec(raw)) !== null) {
    const kind = match[1]!;
    const nums = match[2]!
      .trim()
      .split(/[\s,]+/u)
      .map(Number)
      .filter(Number.isFinite);
    let next: AffineMatrix2D | null = null;
    if (kind === 'matrix' && nums.length === 6) {
      next = { a: nums[0]!, b: nums[1]!, c: nums[2]!, d: nums[3]!, tx: nums[4]!, ty: nums[5]! };
    } else if (kind === 'translate' && nums.length >= 1) {
      next = { a: 1, b: 0, c: 0, d: 1, tx: nums[0]!, ty: nums[1] ?? 0 };
    } else if (kind === 'scale' && nums.length >= 1) {
      next = { a: nums[0]!, b: 0, c: 0, d: nums[1] ?? nums[0]!, tx: 0, ty: 0 };
    }
    if (next) result = result ? multiplyAffineMatrices(result, next) : next;
  }
  return result;
}

/** Applies an affine matrix to canonical vector path commands (translation-safe). */
export function transformCommands(
  commands: readonly FlaVectorPathCommand[],
  matrix: AffineMatrix2D | null,
): FlaVectorPathCommand[] {
  if (!matrix) return commands.map((c) => ({ ...c }));
  const mapPt = (x: number, y: number): Pt => ({
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  });
  return commands.map((cmd) => {
    switch (cmd.type) {
      case 'M': {
        const p = mapPt(cmd.x, cmd.y);
        return { type: 'M', x: p.x, y: p.y };
      }
      case 'L': {
        const p = mapPt(cmd.x, cmd.y);
        return { type: 'L', x: p.x, y: p.y };
      }
      case 'Q': {
        const pc = mapPt(cmd.cx, cmd.cy);
        const p = mapPt(cmd.x, cmd.y);
        return { type: 'Q', cx: pc.x, cy: pc.y, x: p.x, y: p.y };
      }
      case 'C': {
        const p1 = mapPt(cmd.c1x, cmd.c1y);
        const p2 = mapPt(cmd.c2x, cmd.c2y);
        const p = mapPt(cmd.x, cmd.y);
        return {
          type: 'C',
          c1x: p1.x,
          c1y: p1.y,
          c2x: p2.x,
          c2y: p2.y,
          x: p.x,
          y: p.y,
        };
      }
      case 'Z':
        return { type: 'Z' };
    }
  });
}

function splitSubpathContours(
  commands: readonly FlaVectorPathCommand[],
): FlaVectorContour[] {
  const result: FlaVectorContour[] = [];
  let current: FlaVectorPathCommand[] = [];
  let closed = false;
  const flush = (): void => {
    if (current.length > 0) {
      result.push({ closed, commands: current });
    }
    current = [];
    closed = false;
  };
  for (const cmd of commands) {
    if (cmd.type === 'M') {
      flush();
      current.push(cmd);
    } else if (cmd.type === 'Z') {
      closed = true;
      current.push(cmd);
      flush();
    } else {
      current.push(cmd);
    }
  }
  flush();
  return result;
}

function flattenCommandsToPolyline(
  commands: readonly FlaVectorPathCommand[],
): Pt[] {
  const pts: Pt[] = [];
  let cx = 0;
  let cy = 0;
  const steps = 12;
  for (const cmd of commands) {
    if (cmd.type === 'M' || cmd.type === 'L') {
      pts.push({ x: cmd.x, y: cmd.y });
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Q') {
      const x0 = cx;
      const y0 = cy;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const u = 1 - t;
        pts.push({
          x: u * u * x0 + 2 * u * t * cmd.cx + t * t * cmd.x,
          y: u * u * y0 + 2 * u * t * cmd.cy + t * t * cmd.y,
        });
      }
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'C') {
      const x0 = cx;
      const y0 = cy;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const u = 1 - t;
        pts.push({
          x: u * u * u * x0 + 3 * u * u * t * cmd.c1x + 3 * u * t * t * cmd.c2x + t * t * t * cmd.x,
          y: u * u * u * y0 + 3 * u * u * t * cmd.c1y + 3 * u * t * t * cmd.c2y + t * t * t * cmd.y,
        });
      }
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Z' && pts.length > 0) {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-4) {
        pts.push({ ...first });
      }
    }
  }
  return pts;
}

function signedArea(poly: readonly Pt[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function polylineBounds(poly: readonly Pt[]): FlaShapeBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function pointInRing(px: number, py: number, poly: readonly Pt[]): number {
  if (poly.length < 3) return 0;
  let winding = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a.y <= py) {
      if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) {
        winding += 1;
      }
    } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function sampleInteriorPoint(poly: readonly Pt[]): Pt {
  if (poly.length === 0) return { x: 0, y: 0 };
  const b = polylineBounds(poly);
  const cx = b.x + b.width * 0.5;
  const cy = b.y + b.height * 0.5;
  if (pointInRing(cx, cy, poly) !== 0) return { x: cx, y: cy };
  // Midpoint scan along centroid horizontal ray to pick a strict interior point for concave polygons.
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    if ((a.y <= cy && c.y > cy) || (c.y <= cy && a.y > cy)) {
      const t = (cy - a.y) / (c.y - a.y);
      xs.push(a.x + t * (c.x - a.x));
    }
  }
  xs.sort((l, r) => l - r);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const midX = (xs[i]! + xs[i + 1]!) * 0.5;
    if (pointInRing(midX, cy, poly) !== 0) return { x: midX, y: cy };
  }
  return poly[0]!;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function minDistancePointToPoly(pt: Pt, poly: readonly Pt[]): number {
  let min = Infinity;
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const d = distToSegment(pt.x, pt.y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  return min;
}

function stableRegionSignatureHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b);
  }
  return `reg-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeHexColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^#[0-9a-f]{6}$/iu.test(trimmed)) return trimmed.toUpperCase();
  const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  }
  const hex8 = trimmed.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/iu);
  if (hex8) return `#${hex8[1]!.toUpperCase()}`;
  return undefined;
}

/** Computes exact bounding box covering all contours and stroke widths of one region. */
export function computeFlaShapeRegionBounds(
  region: Pick<FlaEditableShapeRegion, 'contours' | 'strokes'>,
): FlaShapeBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of region.contours) {
    const poly = flattenCommandsToPolyline(contour.commands);
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  for (const stroke of region.strokes) {
    const pad = stroke.lineWidth * 0.5;
    const poly = flattenCommandsToPolyline(stroke.commands);
    for (const p of poly) {
      if (p.x - pad < minX) minX = p.x - pad;
      if (p.y - pad < minY) minY = p.y - pad;
      if (p.x + pad > maxX) maxX = p.x + pad;
      if (p.y + pad > maxY) maxY = p.y + pad;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

/**
 * Decomposes an isolated Shape SVG (from Panda's formal builder) into
 * independent filled regions (each keeping its outer contour, enclosed holes,
 * fill paint, and uniquely attributed adjacent strokes).
 */
export function decomposeSvgToEditableShapeRegions(
  svgText: string,
  options?: {
    readonly sourceShapeRef?: string;
    readonly baseViewBox?: FlaShapeBounds;
  },
): FlaShapeRegionDecompositionResult {
  const vbMatch = svgText.match(/\bviewBox="([^"]+)"/u);
  const vbNums = vbMatch?.[1]?.trim().split(/[\s,]+/u).map(Number) ?? [];
  const viewBox: FlaShapeBounds =
    vbNums.length === 4 && vbNums.every(Number.isFinite)
      ? { x: vbNums[0]!, y: vbNums[1]!, width: Math.max(0, vbNums[2]!), height: Math.max(0, vbNums[3]!) }
      : options?.baseViewBox ?? { x: 0, y: 0, width: 100, height: 100 };

  const defsMatch = svgText.match(/<defs\b[^>]*>([\s\S]*?)<\/defs>/u);
  const defsSvg = defsMatch?.[1]?.trim() || undefined;
  const clipPaths = new Map<string, FlaVectorContour[]>();
  const patternDefIds = new Set<string>();
  if (defsSvg) {
    const clipPattern = /<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/gu;
    let cm: RegExpExecArray | null;
    while ((cm = clipPattern.exec(defsSvg)) !== null) {
      const cid = readTagAttrs(cm[1]!).get('id');
      if (!cid) continue;
      const cList: FlaVectorContour[] = [];
      const pm = /<path\b([^>]*)\/?>/gu;
      let match: RegExpExecArray | null;
      while ((match = pm.exec(cm[2]!)) !== null) {
        const d = readTagAttrs(match[1]!).get('d');
        if (d) cList.push(...splitSubpathContours(parseSvgPathCommands(d)));
      }
      if (cList.length > 0) clipPaths.set(cid, cList);
    }
    const patRegex = /<pattern\b([^>]*)>/gu;
    let patMatch: RegExpExecArray | null;
    while ((patMatch = patRegex.exec(defsSvg)) !== null) {
      const pid = readTagAttrs(patMatch[1]!).get('id');
      if (pid) patternDefIds.add(pid);
    }
  }

  const body = svgText.replace(/<defs\b[\s\S]*?<\/defs>/gu, '');
  interface RawContourGroup {
    fill: FlaEditableFill;
    contours: FlaVectorContour[];
    polys: Pt[][];
    isBitmapFill: boolean;
  }
  const regionGroups: RawContourGroup[] = [];
  const rawStrokes: FlaEditableStroke[] = [];
  let hasInternalClipOrUseResidue = false;
  const groupStack: Array<{ transform: AffineMatrix2D | null; clipPathId: string | null }> = [];

  const tagPattern = /<(\/?)(g|path|use)\b([^>]*)>/gu;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(body)) !== null) {
    const isClose = tagMatch[1] === '/';
    const tag = tagMatch[2]!;
    const rawAttrs = tagMatch[3]!;
    const selfClosing = rawAttrs.trimEnd().endsWith('/');
    if (isClose) {
      if (tag === 'g' && groupStack.length > 0) groupStack.pop();
      continue;
    }
    const attrs = readTagAttrs(rawAttrs);
    const parent = groupStack[groupStack.length - 1];
    const ownTx = parseSvgTransformAttr(attrs.get('transform'));
    const tx = parent?.transform && ownTx
      ? multiplyAffineMatrices(parent.transform, ownTx)
      : ownTx ?? parent?.transform ?? null;
    const clipAttr = attrs.get('clip-path')?.match(/^url\(#([^)]+)\)$/u)?.[1] ?? parent?.clipPathId ?? null;
    if (tag === 'g') {
      if (!selfClosing) groupStack.push({ transform: tx, clipPathId: clipAttr });
      continue;
    }
    if (tag === 'use') {
      hasInternalClipOrUseResidue = true;
      if (clipAttr && clipPaths.has(clipAttr)) {
        const contours = clipPaths.get(clipAttr)!.map((c) => ({
          closed: c.closed,
          commands: transformCommands(c.commands, tx),
        }));
        for (const c of contours) {
          regionGroups.push({
            fill: { kind: 'preserved', opacity: 1, fillRule: 'nonzero', svgPaint: 'none' },
            contours: [c],
            polys: [flattenCommandsToPolyline(c.commands)],
            isBitmapFill: true,
          });
        }
      }
      continue;
    }

    if (clipAttr) {
      hasInternalClipOrUseResidue = true;
    }
    const d = attrs.get('d');
    if (!d) continue;
    const baseCommands = transformCommands(parseSvgPathCommands(d), tx);
    if (baseCommands.length === 0) continue;

    const fillRaw = attrs.get('fill') ?? '#000000';
    const fillOpacityRaw = attrs.get('fill-opacity');
    const fillOpacity = fillOpacityRaw !== undefined ? Number(fillOpacityRaw) : 1;
    const fillRule: 'nonzero' | 'evenodd' =
      attrs.get('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
    if (fillRaw !== 'none' && Number.isFinite(fillOpacity) && fillOpacity > 0) {
      const hex = normalizeHexColor(fillRaw);
      const urlMatch = fillRaw.match(/^url\(#([^)]+)\)$/u);
      const urlId = urlMatch?.[1];
      const isPattern = Boolean(
        urlId && (urlId.startsWith('fla-bitmap-pattern-') || patternDefIds.has(urlId)),
      );
      const fill: FlaEditableFill = hex
        ? { kind: 'solid', color: hex, opacity: Math.min(1, Math.max(0, fillOpacity)), fillRule }
        : urlId && !isPattern
          ? { kind: 'gradient-ref', opacity: Math.min(1, Math.max(0, fillOpacity)), fillRule, svgPaint: fillRaw }
          : { kind: 'preserved', opacity: Math.min(1, Math.max(0, fillOpacity)), fillRule, svgPaint: fillRaw };

      // Partition multi-subpath fill into independent outer+holes components!
      const subContours = splitSubpathContours(baseCommands);
      const polys = subContours.map((c) => flattenCommandsToPolyline(c.commands));
      const areas = polys.map((p) => signedArea(p));
      const samples = polys.map((p) => sampleInteriorPoint(p));
      const parents = subContours.map((_, idx) => {
        const pt = samples[idx]!;
        const containers: number[] = [];
        for (let other = 0; other < subContours.length; other += 1) {
          if (other === idx) continue;
          if (Math.abs(areas[other]!) <= Math.abs(areas[idx]!)) continue;
          if (pointInRing(pt.x, pt.y, polys[other]!) !== 0) {
            containers.push(other);
          }
        }
        return containers;
      });
      const depthByIdx = parents.map((p) => p.length);
      const isHole = subContours.map((_c, idx) => {
        const depth = depthByIdx[idx]!;
        if (depth === 0) return false;
        if (fillRule === 'evenodd') return depth % 2 === 1;
        // Under nonzero: sum enclosing winding directions + self vs outer winding sign
        let enclosingWinding = 0;
        const pt = samples[idx]!;
        for (const pIdx of parents[idx]!) {
          enclosingWinding += pointInRing(pt.x, pt.y, polys[pIdx]!);
        }
        const selfSign = areas[idx]! >= 0 ? 1 : -1;
        const enclosingSign = enclosingWinding >= 0 ? 1 : -1;
        return enclosingWinding !== 0 && selfSign !== enclosingSign;
      });

      const groupByOuter = new Map<number, RawContourGroup>();
      for (let idx = 0; idx < subContours.length; idx += 1) {
        if (isHole[idx]) continue;
        const grp: RawContourGroup = {
          fill,
          contours: [subContours[idx]!],
          polys: [polys[idx]!],
          isBitmapFill: isPattern,
        };
        groupByOuter.set(idx, grp);
        regionGroups.push(grp);
      }
      for (let idx = 0; idx < subContours.length; idx += 1) {
        if (!isHole[idx]) continue;
        // Attach hole to nearest (deepest) non-hole enclosing outer contour.
        let nearestOuter: number | null = null;
        let bestDepth = -1;
        for (const pIdx of parents[idx]!) {
          if (!isHole[pIdx] && depthByIdx[pIdx]! > bestDepth) {
            bestDepth = depthByIdx[pIdx]!;
            nearestOuter = pIdx;
          }
        }
        if (nearestOuter !== null && groupByOuter.has(nearestOuter)) {
          const grp = groupByOuter.get(nearestOuter)!;
          grp.contours.push(subContours[idx]!);
          grp.polys.push(polys[idx]!);
        } else {
          // Fallback standalone contour if orphan
          regionGroups.push({
            fill,
            contours: [subContours[idx]!],
            polys: [polys[idx]!],
            isBitmapFill: isPattern,
          });
        }
      }
    }

    const strokeRaw = attrs.get('stroke') ?? 'none';
    const strokeOpacity = attrs.get('stroke-opacity') !== undefined ? Number(attrs.get('stroke-opacity')) : 1;
    const lineWidth = attrs.get('stroke-width') !== undefined ? Number(attrs.get('stroke-width')) : 1;
    if (
      strokeRaw !== 'none' &&
      Number.isFinite(strokeOpacity) &&
      strokeOpacity > 0 &&
      Number.isFinite(lineWidth) &&
      lineWidth > 0
    ) {
      const cap = attrs.get('stroke-linecap');
      const join = attrs.get('stroke-linejoin');
      const miter = Number(attrs.get('stroke-miterlimit') ?? '4');
      for (const strokeSub of splitSubpathContours(baseCommands)) {
        rawStrokes.push({
          color: normalizeHexColor(strokeRaw) ?? strokeRaw,
          opacity: Math.min(1, Math.max(0, strokeOpacity)),
          lineWidth,
          lineCap: cap === 'round' || cap === 'square' ? cap : 'butt',
          lineJoin: join === 'round' || join === 'bevel' ? join : 'miter',
          miterLimit: Number.isFinite(miter) && miter > 0 ? miter : 4,
          closed: strokeSub.closed,
          commands: strokeSub.commands,
        });
      }
    }
  }

  // Compute stable deterministic regionRefs before stroke attribution.
  const usedRefs = new Set<string>();
  const preliminaryRegions = regionGroups.map((grp) => {
    const outerPts = grp.polys[0] ?? [];
    const sig = JSON.stringify([
      grp.fill.kind,
      grp.fill.color ?? grp.fill.svgPaint ?? '',
      grp.contours.length,
      outerPts.slice(0, 12).map((p) => [Math.round(p.x * 100), Math.round(p.y * 100)]),
    ]);
    const baseRef = stableRegionSignatureHash(sig);
    let regionRef = baseRef;
    for (let suffix = 2; usedRefs.has(regionRef); suffix += 1) {
      regionRef = `${baseRef}-${suffix}`;
    }
    usedRefs.add(regionRef);
    return {
      regionRef,
      grp,
      strokes: [] as FlaEditableStroke[],
    };
  });

  const ambiguousRegionRefs = new Set<string>();
  const bitmapFillRegionRefs = new Set<string>();
  for (const item of preliminaryRegions) {
    if (item.grp.isBitmapFill) bitmapFillRegionRefs.add(item.regionRef);
  }

  const residueStrokes: FlaEditableStroke[] = [];

  // Attribute each stroke to its closest bordering fill region, preserving unattached or shared strokes cleanly.
  for (const stroke of rawStrokes) {
    const strokePts = flattenCommandsToPolyline(stroke.commands);
    if (strokePts.length === 0) continue;
    const sampleIndices = [
      0,
      Math.floor(strokePts.length * 0.25),
      Math.floor(strokePts.length * 0.5),
      Math.floor(strokePts.length * 0.75),
      strokePts.length - 1,
    ];
    const samples = [...new Set(sampleIndices)].map((i) => strokePts[i]!);
    const tol = Math.max(2.5, stroke.lineWidth * 0.75 + 1.5);
    const scored = preliminaryRegions.map((item) => {
      let maxSampleDist = 0;
      let minSampleDist = Infinity;
      for (const sPt of samples) {
        let bestPolyDist = Infinity;
        for (const poly of item.grp.polys) {
          const d = minDistancePointToPoly(sPt, poly);
          if (d < bestPolyDist) bestPolyDist = d;
        }
        if (bestPolyDist > maxSampleDist) maxSampleDist = bestPolyDist;
        if (bestPolyDist < minSampleDist) minSampleDist = bestPolyDist;
      }
      return { item, dist: maxSampleDist, minDist: minSampleDist };
    }).sort((l, r) => l.dist - r.dist);

    const best = scored[0];
    const second = scored[1];
    const touchingRegions = scored.filter((entry) => entry.minDist <= tol);
    if ((!best || best.dist > tol) && touchingRegions.length >= 2) {
      for (const entry of touchingRegions) {
        ambiguousRegionRefs.add(entry.item.regionRef);
      }
      residueStrokes.push(stroke);
      continue;
    }
    if (!best || best.dist > tol) {
      // Preserve unattached isolated strokes as read-only residue on the source Shape.
      residueStrokes.push(stroke);
      continue;
    }
    const ambiguous = Boolean(
      second && second.dist <= tol && second.dist - best.dist <= Math.max(1.5, stroke.lineWidth * 0.5),
    );
    if (ambiguous) {
      ambiguousRegionRefs.add(best.item.regionRef);
      ambiguousRegionRefs.add(second!.item.regionRef);
      residueStrokes.push(stroke);
      continue;
    }
    best.item.strokes.push(stroke);
  }

  const regions: FlaEditableShapeRegion[] = preliminaryRegions.map((item) => {
    const base: Omit<FlaEditableShapeRegion, 'bounds'> = {
      regionRef: item.regionRef,
      ...(options?.sourceShapeRef ? { sourceShapeRef: options.sourceShapeRef } : {}),
      fill: item.grp.fill,
      contours: item.grp.contours,
      strokes: item.strokes,
    };
    return {
      ...base,
      bounds: computeFlaShapeRegionBounds(base),
    };
  });

  const hasUnrenderableResidue =
    hasInternalClipOrUseResidue ||
    bitmapFillRegionRefs.size > 0 ||
    regions.some((region) => region.fill.kind === 'preserved');

  return {
    viewBox,
    regions,
    residueStrokes,
    hasUnrenderableResidue,
    ambiguousRegionRefs,
    bitmapFillRegionRefs,
    ...(defsSvg ? { defsSvg } : {}),
  };
}

/** Tests which region (in viewBox coordinates) is hit first matching Fill-pass -> Stroke-pass order. */
export function pickFlaShapeRegionAtPoint(
  regions: readonly FlaEditableShapeRegion[],
  x: number,
  y: number,
  strokeFloor = 2,
): FlaEditableShapeRegion | null {
  const inBounds = (region: FlaEditableShapeRegion): boolean =>
    !(
      x < region.bounds.x - strokeFloor ||
      y < region.bounds.y - strokeFloor ||
      x > region.bounds.x + region.bounds.width + strokeFloor ||
      y > region.bounds.y + region.bounds.height + strokeFloor
    );
  // Stroke pass sits visually on top of all fills; check topmost strokes first.
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const region = regions[i]!;
    if (!inBounds(region)) continue;
    for (const stroke of region.strokes) {
      const halfWidth = Math.max(stroke.lineWidth, strokeFloor) * 0.5;
      const poly = flattenCommandsToPolyline(stroke.commands);
      if (minDistancePointToPoly({ x, y }, poly) <= halfWidth) {
        return region;
      }
    }
  }
  // Then check topmost fills underneath strokes.
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const region = regions[i]!;
    if (!inBounds(region) || region.fill.opacity <= 0) continue;
    let totalWinding = 0;
    for (const contour of region.contours) {
      totalWinding += pointInRing(x, y, flattenCommandsToPolyline(contour.commands));
    }
    const hitFill =
      region.fill.fillRule === 'evenodd'
        ? (Math.abs(totalWinding) % 2) === 1
        : totalWinding !== 0;
    if (hitFill) return region;
  }
  return null;
}

/** Lists all editable vertex/control handles on a region's contours. */
export function listFlaShapeRegionVertices(
  region: FlaEditableShapeRegion,
): FlaShapeVertexHandle[] {
  const handles: FlaShapeVertexHandle[] = [];
  region.contours.forEach((contour, contourIndex) => {
    contour.commands.forEach((cmd, commandIndex) => {
      if (cmd.type === 'M' || cmd.type === 'L') {
        handles.push({ contourIndex, commandIndex, pointKind: 'anchor', x: cmd.x, y: cmd.y });
      } else if (cmd.type === 'Q') {
        handles.push({ contourIndex, commandIndex, pointKind: 'q-control', x: cmd.cx, y: cmd.cy });
        handles.push({ contourIndex, commandIndex, pointKind: 'anchor', x: cmd.x, y: cmd.y });
      } else if (cmd.type === 'C') {
        handles.push({ contourIndex, commandIndex, pointKind: 'c1', x: cmd.c1x, y: cmd.c1y });
        handles.push({ contourIndex, commandIndex, pointKind: 'c2', x: cmd.c2x, y: cmd.c2y });
        handles.push({ contourIndex, commandIndex, pointKind: 'anchor', x: cmd.x, y: cmd.y });
      }
    });
  });
  return handles;
}

/**
 * Moves one vertex or Bezier control point on `region`, keeping coincident
 * start/end anchors of closed contours locked together so boundaries never tear.
 */
export function moveFlaShapeRegionVertex(
  region: FlaEditableShapeRegion,
  target: FlaShapeVertexTarget,
  x: number,
  y: number,
): FlaEditableShapeRegion {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return region;
  const contour = region.contours[target.contourIndex];
  const cmd = contour?.commands[target.commandIndex];
  if (!contour || !cmd || cmd.type === 'Z') return region;

  let origAnchor: Pt | null = null;
  if (target.pointKind === 'anchor' && 'x' in cmd) {
    origAnchor = { x: cmd.x, y: cmd.y };
  }

  const nextCommands = contour.commands.map((item, idx) => {
    if (idx === target.commandIndex) {
      if (target.pointKind === 'anchor' && item.type !== 'Z') {
        return { ...item, x, y };
      }
      if (target.pointKind === 'q-control' && item.type === 'Q') {
        return { ...item, cx: x, cy: y };
      }
      if (target.pointKind === 'c1' && item.type === 'C') {
        return { ...item, c1x: x, c1y: y };
      }
      if (target.pointKind === 'c2' && item.type === 'C') {
        return { ...item, c2x: x, c2y: y };
      }
    }
    // Preserve closure when editing the start or closing endpoint of a closed contour.
    if (
      contour.closed &&
      origAnchor &&
      target.pointKind === 'anchor' &&
      item.type !== 'Z' &&
      (idx === 0 || idx === contour.commands.length - 1 || contour.commands[idx + 1]?.type === 'Z') &&
      Math.hypot(item.x - origAnchor.x, item.y - origAnchor.y) < 0.05
    ) {
      return { ...item, x, y };
    }
    return item;
  });

  const nextContours = region.contours.map((c, idx) =>
    idx === target.contourIndex ? { ...c, commands: nextCommands } : c,
  );
  const updated: FlaEditableShapeRegion = {
    ...region,
    contours: nextContours,
    bounds: computeFlaShapeRegionBounds({ contours: nextContours, strokes: region.strokes }),
  };
  return updated;
}

/** Updates a solid-fill region's hex color (and optional opacity) cleanly. */
export function setFlaShapeRegionSolidFillColor(
  region: FlaEditableShapeRegion,
  color: string,
  opacity?: number,
): FlaEditableShapeRegion {
  if (region.fill.kind !== 'solid') {
    throw new Error('仅支持编辑纯色填充区域的 Fill 颜色。');
  }
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    throw new Error(`无效的十六进制颜色值：${color}`);
  }
  const nextOpacity =
    opacity !== undefined && Number.isFinite(opacity)
      ? Math.min(1, Math.max(0, opacity))
      : region.fill.opacity;
  return {
    ...region,
    fill: {
      ...region.fill,
      color: normalized,
      opacity: nextOpacity,
    },
  };
}

export function unionFlaShapeRegionBounds(
  regions: readonly FlaEditableShapeRegion[],
  residueStrokes: readonly FlaEditableStroke[] = [],
): FlaShapeBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const region of regions) {
    const b = region.bounds;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  for (const stroke of residueStrokes) {
    const pad = stroke.lineWidth * 0.5;
    for (const pt of flattenCommandsToPolyline(stroke.commands)) {
      if (pt.x - pad < minX) minX = pt.x - pad;
      if (pt.y - pad < minY) minY = pt.y - pad;
      if (pt.x + pad > maxX) maxX = pt.x + pad;
      if (pt.y + pad > maxY) maxY = pt.y + pad;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1e-6, maxX - minX),
    height: Math.max(1e-6, maxY - minY),
  };
}

function serializeStrokeSvg(s: FlaEditableStroke): string {
  const d = commandsToSvgPathD(s.commands);
  return `<path d="${d}" fill="none" stroke="${s.color}" stroke-opacity="${s.opacity}" stroke-width="${s.lineWidth}" stroke-linecap="${s.lineCap}" stroke-linejoin="${s.lineJoin}" stroke-miterlimit="${s.miterLimit}"/>`;
}

/** Emits a clean SVG document from editable regions aligned with Fill pass -> Stroke pass order. */
export function buildSvgFromFlaEditableShapeRegions(input: {
  readonly regions: readonly FlaEditableShapeRegion[];
  readonly residueStrokes?: readonly FlaEditableStroke[];
  readonly viewBox: FlaShapeBounds;
  readonly defsSvg?: string;
}): string {
  const { regions, residueStrokes = [], viewBox, defsSvg } = input;
  const defsMarkup = defsSvg ? `<defs>${defsSvg}</defs>` : '';
  const fillMarkup = regions
    .map((region) => {
      const fillD = region.contours.map((c) => commandsToSvgPathD(c.commands)).join(' ');
      const paint =
        region.fill.kind === 'solid'
          ? region.fill.color ?? '#000000'
          : region.fill.svgPaint ?? 'none';
      return paint !== 'none' && region.fill.opacity > 0 && fillD
        ? `<path d="${fillD}" fill="${paint}" fill-opacity="${region.fill.opacity}" stroke="none" fill-rule="${region.fill.fillRule}"/>`
        : '';
    })
    .join('');
  const regionStrokeMarkup = regions
    .flatMap((region) => region.strokes.map(serializeStrokeSvg))
    .join('');
  const residueMarkup = residueStrokes.map(serializeStrokeSvg).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${Math.max(1, viewBox.width)} ${Math.max(1, viewBox.height)}" width="${Math.max(1, Math.ceil(viewBox.width))}" height="${Math.max(1, Math.ceil(viewBox.height))}">${defsMarkup}${fillMarkup}${regionStrokeMarkup}${residueMarkup}</svg>`;
}

export function cloneFlaEditableShapeRegion(
  region: FlaEditableShapeRegion,
): FlaEditableShapeRegion {
  return {
    regionRef: region.regionRef,
    ...(region.sourceShapeRef ? { sourceShapeRef: region.sourceShapeRef } : {}),
    fill: { ...region.fill },
    contours: region.contours.map((c) => ({
      closed: c.closed,
      commands: c.commands.map((cmd) => ({ ...cmd })),
    })),
    strokes: region.strokes.map((s) => ({
      ...s,
      commands: s.commands.map((cmd) => ({ ...cmd })),
    })),
    bounds: { ...region.bounds },
  };
}

export function cloneFlaGraphicShapeNodeOverride(
  override: FlaGraphicShapeNodeOverride,
): FlaGraphicShapeNodeOverride {
  return {
    baseViewBox: { ...override.baseViewBox },
    regions: override.regions.map(cloneFlaEditableShapeRegion),
    excludedRegionRefs: [...override.excludedRegionRefs],
    extractedRegions: override.extractedRegions.map((entry) => ({
      id: entry.id,
      regionRef: entry.regionRef,
      displayName: entry.displayName,
      region: cloneFlaEditableShapeRegion(entry.region),
      baseViewBox: { ...entry.baseViewBox },
      localTransform: { ...entry.localTransform },
    })),
    ...(override.residueStrokes
      ? {
          residueStrokes: override.residueStrokes.map((s) => ({
            ...s,
            commands: s.commands.map((cmd) => ({ ...cmd })),
          })),
        }
      : {}),
    ...(override.hasUnrenderableResidue !== undefined
      ? { hasUnrenderableResidue: override.hasUnrenderableResidue }
      : {}),
    ...(override.ambiguousRegionRefs
      ? { ambiguousRegionRefs: [...override.ambiguousRegionRefs] }
      : {}),
    ...(override.bitmapFillRegionRefs
      ? { bitmapFillRegionRefs: [...override.bitmapFillRegionRefs] }
      : {}),
    ...(override.sourceDefsSvg ? { sourceDefsSvg: override.sourceDefsSvg } : {}),
  };
}

export interface FlaExtractedShapeRegionMatch {
  readonly ownerPathKey: string;
  readonly ownerPath: readonly string[];
  readonly entryIndex: number;
  readonly entry: FlaExtractedShapeRegionEntry;
}

/** Looks up an extracted-region sibling node matching `nodePath` in one frame's overrides. */
export function findFlaExtractedShapeRegionByPath(
  frameOverrides: Readonly<Record<string, FlaGraphicShapeNodeOverride>> | undefined,
  nodePath: readonly string[],
): FlaExtractedShapeRegionMatch | null {
  if (!frameOverrides || nodePath.length === 0) return null;
  const targetId = nodePath[nodePath.length - 1]!;
  for (const [ownerPathKey, nodeOverride] of Object.entries(frameOverrides)) {
    let ownerPath: unknown;
    try {
      ownerPath = JSON.parse(ownerPathKey);
    } catch {
      continue;
    }
    if (
      !Array.isArray(ownerPath) ||
      ownerPath.length !== nodePath.length ||
      !ownerPath.every((entry): entry is string => typeof entry === 'string')
    ) {
      continue;
    }
    let parentMatches = true;
    for (let i = 0; i < nodePath.length - 1; i += 1) {
      if (ownerPath[i] !== nodePath[i]) {
        parentMatches = false;
        break;
      }
    }
    if (!parentMatches) continue;
    const entryIndex = nodeOverride.extractedRegions.findIndex(
      (entry) => entry.id === targetId,
    );
    if (entryIndex >= 0) {
      return {
        ownerPathKey,
        ownerPath,
        entryIndex,
        entry: nodeOverride.extractedRegions[entryIndex]!,
      };
    }
  }
  return null;
}

/** Collects valid extracted-sibling transforms per frame from instance/shared shape overrides. */
export function collectFlaExtractedRegionTransformPaths(
  sharedShapeOverrides: FlaGraphicShapeOverrides | undefined,
  instanceShapeOverrides?: FlaGraphicShapeOverrides,
): ReadonlyMap<string, ReadonlyMap<string, AffineMatrix2D>> {
  const result = new Map<string, Map<string, AffineMatrix2D>>();
  const addFrom = (overrides: FlaGraphicShapeOverrides | undefined): void => {
    if (!overrides) return;
    for (const [frameOrdinal, frameMap] of Object.entries(overrides)) {
      let valid = result.get(frameOrdinal);
      if (!valid) {
        valid = new Map();
        result.set(frameOrdinal, valid);
      }
      for (const [ownerPathKey, nodeOverride] of Object.entries(frameMap)) {
        if (nodeOverride.extractedRegions.length === 0) continue;
        let ownerPath: unknown;
        try {
          ownerPath = JSON.parse(ownerPathKey);
        } catch {
          continue;
        }
        if (
          !Array.isArray(ownerPath) ||
          ownerPath.length === 0 ||
          !ownerPath.every((entry): entry is string => typeof entry === 'string')
        ) {
          continue;
        }
        const parentPath = ownerPath.slice(0, -1);
        for (const entry of nodeOverride.extractedRegions) {
          const siblingKey = JSON.stringify([...parentPath, entry.id]);
          valid.set(siblingKey, entry.localTransform);
        }
      }
    }
  };
  addFrom(sharedShapeOverrides);
  addFrom(instanceShapeOverrides);
  return result;
}

export function cloneFlaGraphicShapeOverrides(
  overrides: FlaGraphicShapeOverrides | undefined,
): FlaGraphicShapeOverrides | undefined {
  if (!overrides) return undefined;
  return Object.fromEntries(
    Object.entries(overrides).map(([frameOrdinal, frameMap]) => [
      frameOrdinal,
      Object.fromEntries(
        Object.entries(frameMap).map(([pathKey, nodeOverride]) => [
          pathKey,
          cloneFlaGraphicShapeNodeOverride(nodeOverride),
        ]),
      ),
    ]),
  );
}
