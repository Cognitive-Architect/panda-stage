import type Konva from 'konva';
import {
  commandsToSvgPathD,
  parseSvgPathCommands,
  type EvaluatedFlaGraphicClipPath,
  type EvaluatedFlaGraphicVectorVisual,
  type FlaVectorPathCommand,
} from '../../../domain';
import {
  localizeAbsoluteLeafMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../../shared/affine-matrix';

export { parseSvgPathCommands };
export type SvgPathCommand = FlaVectorPathCommand;

export interface FlaSvgHitClipShape {
  readonly d: string;
  readonly commands: readonly SvgPathCommand[];
  readonly clipRule: 'nonzero' | 'evenodd';
}

export interface FlaSvgHitFillPrimitive {
  readonly kind: 'fill';
  readonly d: string;
  readonly commands: readonly SvgPathCommand[];
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly transform: AffineMatrix2D | null;
  readonly clipPathIds: readonly string[];
}

export interface FlaSvgHitStrokePrimitive {
  readonly kind: 'stroke';
  readonly d: string;
  readonly commands: readonly SvgPathCommand[];
  readonly lineWidth: number;
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
  readonly miterLimit: number;
  readonly transform: AffineMatrix2D | null;
  readonly clipPathIds: readonly string[];
}

export type FlaSvgHitPrimitive = FlaSvgHitFillPrimitive | FlaSvgHitStrokePrimitive;

export interface FlaSvgShapeHitGeometry {
  readonly primitives: readonly FlaSvgHitPrimitive[];
  readonly clipPaths: ReadonlyMap<string, readonly FlaSvgHitClipShape[]>;
}

const MAX_CACHED_SVGS = 512;
const parsedSvgCache = new Map<string, FlaSvgShapeHitGeometry>();
const compiledPath2DCache = new Map<string, Path2D>();

function getCompiledPath2D(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let cached = compiledPath2DCache.get(d);
  if (cached) return cached;
  try {
    cached = new Path2D(d);
    if (compiledPath2DCache.size >= MAX_CACHED_SVGS * 8) {
      compiledPath2DCache.clear();
    }
    compiledPath2DCache.set(d, cached);
    return cached;
  } catch {
    return null;
  }
}

export function extractFlaSvgTextForAsset(
  assetId: string | undefined,
  image: HTMLImageElement | undefined,
  svgTexts?: ReadonlyMap<string, string>,
): string | null {
  if (!assetId) return null;
  const fromMap = svgTexts?.get(assetId);
  if (fromMap !== undefined) return fromMap;
  const src = image?.src;
  if (!src || !src.startsWith('data:image/svg+xml')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const meta = src.slice(0, comma).toLowerCase();
  const body = src.slice(comma + 1);
  try {
    if (meta.includes(';base64')) {
      return atob(body);
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

function readTagAttributes(tagText: string): ReadonlyMap<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tagText)) !== null) {
    attrs.set(match[1]!, match[2]!);
  }
  return attrs;
}

function isZeroAlphaPaint(paint: string | undefined, opacityAttr: string | undefined): boolean {
  if (!paint || paint === 'none') return true;
  if (opacityAttr !== undefined) {
    const parsed = Number(opacityAttr);
    if (!Number.isFinite(parsed) || parsed <= 0) return true;
  }
  if (/^#[0-9a-f]{4}$/iu.test(paint) && paint[4]?.toLowerCase() === '0') return true;
  if (/^#[0-9a-f]{8}$/iu.test(paint) && paint.slice(7, 9).toLowerCase() === '00') return true;
  return false;
}

function parseSvgTransform(raw: string | undefined): AffineMatrix2D | null {
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
    if (next) {
      result = result ? multiplyAffineMatrices(result, next) : next;
    }
  }
  if (!result) return null;
  if (
    Math.abs(result.a - 1) <= 1e-12 &&
    Math.abs(result.b) <= 1e-12 &&
    Math.abs(result.c) <= 1e-12 &&
    Math.abs(result.d - 1) <= 1e-12 &&
    Math.abs(result.tx) <= 1e-12 &&
    Math.abs(result.ty) <= 1e-12
  ) {
    return null;
  }
  return result;
}

function extractClipPathId(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/^url\(#([^)]+)\)$/u);
  return match?.[1] ?? null;
}

function combineTransforms(
  outer: AffineMatrix2D | null,
  inner: AffineMatrix2D | null,
): AffineMatrix2D | null {
  if (!outer) return inner;
  if (!inner) return outer;
  return multiplyAffineMatrices(outer, inner);
}

/** Parses Panda's SVG builder output into fill, stroke, and clip hit primitives. */
export function parseFlaSvgShapeHitGeometry(svgText: string): FlaSvgShapeHitGeometry {
  const cached = parsedSvgCache.get(svgText);
  if (cached) return cached;

  const clipPaths = new Map<string, readonly FlaSvgHitClipShape[]>();
  const clipBlockPattern = /<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/gu;
  let clipMatch: RegExpExecArray | null;
  while ((clipMatch = clipBlockPattern.exec(svgText)) !== null) {
    const clipAttrs = readTagAttributes(clipMatch[1]!);
    const id = clipAttrs.get('id');
    if (!id) continue;
    const shapes: FlaSvgHitClipShape[] = [];
    const innerPattern = /<path\b([^>]*)\/?>/gu;
    let pathMatch: RegExpExecArray | null;
    while ((pathMatch = innerPattern.exec(clipMatch[2]!)) !== null) {
      const attrs = readTagAttributes(pathMatch[1]!);
      const d = attrs.get('d');
      if (!d) continue;
      const commands = parseSvgPathCommands(d);
      if (commands.length === 0) continue;
      shapes.push({
        d,
        commands,
        clipRule: attrs.get('clip-rule') === 'evenodd' ? 'evenodd' : 'nonzero',
      });
    }
    if (shapes.length > 0) clipPaths.set(id, shapes);
  }

  const body = svgText.replace(/<defs\b[\s\S]*?<\/defs>/gu, '');
  const primitives: FlaSvgHitPrimitive[] = [];
  const groupStack: Array<{
    readonly hidden: boolean;
    readonly transform: AffineMatrix2D | null;
    readonly clipPathIds: readonly string[];
  }> = [];

  const tagPattern = /<(\/?)(g|path|use)\b([^>]*)>/gu;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(body)) !== null) {
    const isClose = tagMatch[1] === '/';
    const tagName = tagMatch[2]!;
    const rawAttrs = tagMatch[3]!;
    const selfClosing = rawAttrs.trimEnd().endsWith('/');

    if (isClose) {
      if (tagName === 'g' && groupStack.length > 0) groupStack.pop();
      continue;
    }

    const attrs = readTagAttributes(rawAttrs);
    const parentGroup = groupStack[groupStack.length - 1];
    const hidden =
      Boolean(parentGroup?.hidden) ||
      attrs.get('display') === 'none' ||
      attrs.get('visibility') === 'hidden' ||
      (attrs.get('opacity') !== undefined && Number(attrs.get('opacity')) <= 0);
    const ownTransform = parseSvgTransform(attrs.get('transform'));
    const transform = combineTransforms(parentGroup?.transform ?? null, ownTransform);
    const ownClipId = extractClipPathId(attrs.get('clip-path'));
    const clipPathIds = ownClipId
      ? [...(parentGroup?.clipPathIds ?? []), ownClipId]
      : [...(parentGroup?.clipPathIds ?? [])];

    if (tagName === 'g') {
      if (!selfClosing) {
        groupStack.push({ hidden, transform, clipPathIds });
      }
      continue;
    }

    if (hidden) continue;

    if (tagName === 'use') {
      // Panda's ClippedBitmapFill emits `<g clip-path="url(#id)"><use .../></g>`.
      const clipId = clipPathIds[clipPathIds.length - 1];
      const clipShapes = clipId ? clipPaths.get(clipId) : undefined;
      if (clipShapes) {
        const remainingClips = clipPathIds.slice(0, -1);
        for (const clipShape of clipShapes) {
          primitives.push({
            kind: 'fill',
            d: clipShape.d,
            commands: clipShape.commands,
            fillRule: clipShape.clipRule,
            transform: parentGroup?.transform ?? null,
            clipPathIds: remainingClips,
          });
        }
      }
      continue;
    }

    const d = attrs.get('d');
    if (!d) continue;
    const commands = parseSvgPathCommands(d);
    if (commands.length === 0) continue;

    const fill = attrs.get('fill') ?? '#000000';
    if (!isZeroAlphaPaint(fill, attrs.get('fill-opacity'))) {
      primitives.push({
        kind: 'fill',
        d,
        commands,
        fillRule: attrs.get('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero',
        transform,
        clipPathIds,
      });
    }

    const stroke = attrs.get('stroke') ?? 'none';
    const rawStrokeWidth = attrs.get('stroke-width');
    const lineWidth = rawStrokeWidth !== undefined ? Number(rawStrokeWidth) : 1;
    if (
      !isZeroAlphaPaint(stroke, attrs.get('stroke-opacity')) &&
      Number.isFinite(lineWidth) &&
      lineWidth > 0
    ) {
      const cap = attrs.get('stroke-linecap');
      const join = attrs.get('stroke-linejoin');
      const miter = Number(attrs.get('stroke-miterlimit') ?? '4');
      primitives.push({
        kind: 'stroke',
        d,
        commands,
        lineWidth,
        lineCap: cap === 'round' || cap === 'square' ? cap : 'butt',
        lineJoin: join === 'round' || join === 'bevel' ? join : 'miter',
        miterLimit: Number.isFinite(miter) && miter > 0 ? miter : 4,
        transform,
        clipPathIds,
      });
    }
  }

  const geometry: FlaSvgShapeHitGeometry = { primitives, clipPaths };
  if (parsedSvgCache.size >= MAX_CACHED_SVGS) {
    parsedSvgCache.clear();
  }
  parsedSvgCache.set(svgText, geometry);
  return geometry;
}

function replaySvgPathCommands(
  context: Konva.Context,
  commands: readonly SvgPathCommand[],
  matrix?: AffineMatrix2D,
): void {
  const tx = (x: number, y: number): [number, number] =>
    matrix
      ? [matrix.a * x + matrix.c * y + matrix.tx, matrix.b * x + matrix.d * y + matrix.ty]
      : [x, y];
  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        const [x, y] = tx(command.x, command.y);
        context.moveTo(x, y);
        break;
      }
      case 'L': {
        const [x, y] = tx(command.x, command.y);
        context.lineTo(x, y);
        break;
      }
      case 'Q': {
        const [cx, cy] = tx(command.cx, command.cy);
        const [x, y] = tx(command.x, command.y);
        context.quadraticCurveTo(cx, cy, x, y);
        break;
      }
      case 'C': {
        const [c1x, c1y] = tx(command.c1x, command.c1y);
        const [c2x, c2y] = tx(command.c2x, command.c2y);
        const [x, y] = tx(command.x, command.y);
        context.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
        break;
      }
      case 'Z':
        context.closePath();
        break;
    }
  }
}

function applyEvaluatedNodeClips(
  context: Konva.Context,
  nodeWorldTransform: AffineMatrix2D,
  clipPaths: readonly EvaluatedFlaGraphicClipPath[],
): boolean {
  if (clipPaths.length === 0) return true;
  const rawContext = context._context;
  const hasPath2D = typeof Path2D !== 'undefined' && typeof DOMMatrix !== 'undefined';

  for (const clipPath of clipPaths) {
    if (clipPath.shapes.length === 0) return false;
    if (hasPath2D && typeof rawContext?.clip === 'function') {
      const unionPath = new Path2D();
      let added = false;
      for (const shape of clipPath.shapes) {
        const local = localizeAbsoluteLeafMatrix(nodeWorldTransform, shape.worldTransform);
        if (!local.ok) continue;
        const m = new DOMMatrix([
          local.value.a,
          local.value.b,
          local.value.c,
          local.value.d,
          local.value.tx,
          local.value.ty,
        ]);
        for (const pathD of shape.pathData) {
          const compiled = getCompiledPath2D(pathD);
          if (!compiled) continue;
          unionPath.addPath(compiled, m);
          added = true;
        }
      }
      if (!added) return false;
      rawContext.clip(unionPath, 'nonzero');
    } else {
      context.beginPath();
      let added = false;
      for (const shape of clipPath.shapes) {
        const local = localizeAbsoluteLeafMatrix(nodeWorldTransform, shape.worldTransform);
        if (!local.ok) continue;
        for (const pathD of shape.pathData) {
          const commands = parseSvgPathCommands(pathD);
          if (commands.length === 0) continue;
          replaySvgPathCommands(context, commands, local.value);
          added = true;
        }
      }
      if (!added) return false;
      context.clip('nonzero');
    }
  }
  return true;
}

function applySvgDefClipPath(
  context: Konva.Context,
  clipId: string,
  geometry: FlaSvgShapeHitGeometry,
): boolean {
  const shapes = geometry.clipPaths.get(clipId);
  if (!shapes?.length) return false;
  const rawContext = context._context;
  if (typeof Path2D !== 'undefined' && typeof rawContext?.clip === 'function') {
    const unionPath = new Path2D();
    for (const shape of shapes) {
      const compiled = getCompiledPath2D(shape.d);
      if (compiled) unionPath.addPath(compiled);
    }
    rawContext.clip(unionPath, shapes[0]?.clipRule ?? 'nonzero');
    return true;
  }
  context.beginPath();
  for (const shape of shapes) {
    replaySvgPathCommands(context, shape.commands);
  }
  context.clip(shapes[0]?.clipRule ?? 'nonzero');
  return true;
}

/**
 * Draws only the SVG shape's actual fill and stroke paths (plus active clips)
 * onto Konva's hit canvas, leaving transparent holes and bbox void empty.
 */
export function drawFlaSvgShapeHitRegion(
  context: Konva.Context,
  konvaShape: Konva.Shape,
  input: {
    readonly viewBox: { readonly x: number; readonly y: number };
    readonly geometry: FlaSvgShapeHitGeometry;
    readonly nodeWorldTransform: AffineMatrix2D;
    readonly clipPaths: readonly EvaluatedFlaGraphicClipPath[];
  },
): void {
  const colorKey = konvaShape.colorKey;
  if (!colorKey || input.geometry.primitives.length === 0) return;

  const absScale = konvaShape.getAbsoluteScale();
  const minScale = Math.max(0.05, Math.min(Math.abs(absScale.x), Math.abs(absScale.y)));
  // Konva's hit test requires alpha === 255; a 2px floor prevents 1px hairlines
  // on fractional coordinates or zoomed-out canvases from anti-aliasing away.
  const minHitStrokeWidth = 2 / minScale;
  const rawContext = context._context;

  context.save();
  if (!applyEvaluatedNodeClips(context, input.nodeWorldTransform, input.clipPaths)) {
    context.restore();
    return;
  }
  context.translate(-input.viewBox.x, -input.viewBox.y);

  for (const primitive of input.geometry.primitives) {
    let clipped = true;
    context.save();
    for (const clipId of primitive.clipPathIds) {
      if (!applySvgDefClipPath(context, clipId, input.geometry)) {
        clipped = false;
        break;
      }
    }
    if (!clipped) {
      context.restore();
      continue;
    }
    if (primitive.transform) {
      const t = primitive.transform;
      context.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
    }

    const path2d = getCompiledPath2D(primitive.d);
    if (primitive.kind === 'fill') {
      context.setAttr('fillStyle', colorKey);
      if (path2d && rawContext) {
        rawContext.fill(path2d, primitive.fillRule);
      } else {
        context.beginPath();
        replaySvgPathCommands(context, primitive.commands);
        context.fill(primitive.fillRule);
      }
    } else {
      context.setAttr('strokeStyle', colorKey);
      context.setAttr('lineWidth', Math.max(primitive.lineWidth, minHitStrokeWidth));
      context.setAttr('lineCap', primitive.lineCap);
      context.setAttr('lineJoin', primitive.lineJoin);
      context.setAttr('miterLimit', primitive.miterLimit);
      if (path2d && rawContext) {
        rawContext.stroke(path2d);
      } else {
        context.beginPath();
        replaySvgPathCommands(context, primitive.commands);
        context.stroke();
      }
    }
    context.restore();
  }

  context.restore();
}

/**
 * Draws editable `vectorVisual` fill and stroke regions onto Konva's hit canvas
 * so extracted or vertex-edited shapes stay accurately selectable without bounding boxes.
 */
export function drawFlaVectorVisualHitRegion(
  context: Konva.Context,
  konvaShape: Konva.Shape,
  input: {
    readonly vectorVisual: EvaluatedFlaGraphicVectorVisual;
    readonly nodeWorldTransform: AffineMatrix2D;
    readonly clipPaths: readonly EvaluatedFlaGraphicClipPath[];
  },
): void {
  const colorKey = konvaShape.colorKey;
  if (!colorKey || input.vectorVisual.regions.length === 0) return;

  const absScale = konvaShape.getAbsoluteScale();
  const minScale = Math.max(0.05, Math.min(Math.abs(absScale.x), Math.abs(absScale.y)));
  const minHitStrokeWidth = 2 / minScale;
  const rawContext = context._context;

  context.save();
  if (!applyEvaluatedNodeClips(context, input.nodeWorldTransform, input.clipPaths)) {
    context.restore();
    return;
  }
  context.translate(-input.vectorVisual.baseViewBox.x, -input.vectorVisual.baseViewBox.y);

  for (const region of input.vectorVisual.regions) {
    if (region.fill.opacity > 0 && region.fill.svgPaint !== 'none') {
      const fillD = region.contours.map((contour) => commandsToSvgPathD(contour.commands)).join(' ');
      const path2d = fillD ? getCompiledPath2D(fillD) : null;
      context.setAttr('fillStyle', colorKey);
      if (path2d && rawContext) {
        rawContext.fill(path2d, region.fill.fillRule);
      } else {
        context.beginPath();
        for (const contour of region.contours) {
          replaySvgPathCommands(context, contour.commands);
        }
        context.fill(region.fill.fillRule);
      }
    }
    for (const stroke of region.strokes) {
      const d = commandsToSvgPathD(stroke.commands);
      const path2d = d ? getCompiledPath2D(d) : null;
      context.setAttr('strokeStyle', colorKey);
      context.setAttr('lineWidth', Math.max(stroke.lineWidth, minHitStrokeWidth));
      context.setAttr('lineCap', stroke.lineCap);
      context.setAttr('lineJoin', stroke.lineJoin);
      context.setAttr('miterLimit', stroke.miterLimit);
      if (path2d && rawContext) {
        rawContext.stroke(path2d);
      } else {
        context.beginPath();
        replaySvgPathCommands(context, stroke.commands);
        context.stroke();
      }
    }
  }
  context.restore();
}

/** Draws a clipped bitmap leaf hit area bounded by its active Graphic clips. */
export function drawClippedBitmapHitRegion(
  context: Konva.Context,
  konvaShape: Konva.Shape,
  input: {
    readonly width: number;
    readonly height: number;
    readonly nodeWorldTransform: AffineMatrix2D;
    readonly clipPaths: readonly EvaluatedFlaGraphicClipPath[];
  },
): void {
  const colorKey = konvaShape.colorKey;
  if (!colorKey) return;
  context.save();
  if (!applyEvaluatedNodeClips(context, input.nodeWorldTransform, input.clipPaths)) {
    context.restore();
    return;
  }
  context.setAttr('fillStyle', colorKey);
  context.beginPath();
  context.rect(0, 0, input.width, input.height);
  context.fill('nonzero');
  context.restore();
}
