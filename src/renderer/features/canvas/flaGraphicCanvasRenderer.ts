import {
  applyFlaRgbaTransform,
  isZeroAlphaFlaInstanceColor,
  normalizeFlaInstanceColorToRgba,
  type FlaInstanceColor,
  type FlaRgbaTransform,
} from '../../../shared/fla-instance-color';
import { layoutFlaStaticText, type FlaStaticTextLayoutResult, type FlaStaticTextMeasurer } from '../../../shared/fla-static-text';
import { createCanvasStaticTextMeasurer, drawCanvasStaticText } from '../../fla-static-text-canvas';
import {
  commandsToSvgPathD,
  evaluateFlaGraphicNodeCompositePlan,
  evaluateOpaqueFrameCropNormalizedRect,
  unionFlaShapeRegionBounds,
  type EvaluatedFlaGraphicNode,
  type EvaluatedFlaGraphicVectorVisual,
  type EvaluatedFlaGraphicVisual,
  type FlaEditableStroke,
  type FlaVectorPathCommand,
} from '../../../domain';

interface ParsedSvgGradientStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity: number;
}

type ParsedSvgGradient =
  | {
      readonly kind: 'linear';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stops: readonly ParsedSvgGradientStop[];
    }
  | {
      readonly kind: 'radial';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fx: number;
      readonly fy: number;
      readonly stops: readonly ParsedSvgGradientStop[];
    };

const parsedGradientDefsCache = new Map<string, ReadonlyMap<string, ParsedSvgGradient>>();

function replaySvgPathDToContext(
  target: CanvasRenderingContext2D,
  pathD: string,
): void {
  const tokens = pathD.match(/[MLQCZ]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/giu);
  if (!tokens) return;
  let index = 0;
  let command = '';
  const readNum = (): number => Number(tokens[index++] ?? 'NaN');
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[MLQCZ]$/iu.test(token)) {
      command = token.toUpperCase();
      index += 1;
      if (command === 'Z') {
        target.closePath();
        continue;
      }
    }
    if (command === 'M') {
      const x = readNum();
      const y = readNum();
      if (Number.isFinite(x) && Number.isFinite(y)) target.moveTo(x, y);
      command = 'L';
    } else if (command === 'L') {
      const x = readNum();
      const y = readNum();
      if (Number.isFinite(x) && Number.isFinite(y)) target.lineTo(x, y);
    } else if (command === 'Q') {
      const cx = readNum();
      const cy = readNum();
      const x = readNum();
      const y = readNum();
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(x) && Number.isFinite(y)) {
        target.quadraticCurveTo(cx, cy, x, y);
      }
    } else if (command === 'C') {
      const c1x = readNum();
      const c1y = readNum();
      const c2x = readNum();
      const c2y = readNum();
      const x = readNum();
      const y = readNum();
      if ([c1x, c1y, c2x, c2y, x, y].every(Number.isFinite)) {
        target.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
      }
    } else {
      break;
    }
  }
}

function readSvgTagAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrPattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw)) !== null) {
    attrs.set(match[1]!, match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function parseGradientStops(inner: string): ParsedSvgGradientStop[] {
  const stops: ParsedSvgGradientStop[] = [];
  const stopPattern = /<stop\b([^>]*)\/?>/gu;
  let match: RegExpExecArray | null;
  while ((match = stopPattern.exec(inner)) !== null) {
    const attrs = readSvgTagAttributes(match[1]!);
    const rawOffset = attrs.get('offset') ?? '0';
    const offset = rawOffset.endsWith('%')
      ? Math.max(0, Math.min(1, Number.parseFloat(rawOffset) / 100))
      : Math.max(0, Math.min(1, Number.parseFloat(rawOffset)));
    if (!Number.isFinite(offset)) continue;
    stops.push({
      offset,
      color: attrs.get('stop-color') ?? '#000000',
      opacity: Math.max(
        0,
        Math.min(1, Number.parseFloat(attrs.get('stop-opacity') ?? '1') || 1),
      ),
    });
  }
  return stops;
}

function parseSvgDefsGradients(
  defsSvg: string | undefined,
): ReadonlyMap<string, ParsedSvgGradient> {
  if (!defsSvg) return new Map();
  const cached = parsedGradientDefsCache.get(defsSvg);
  if (cached) return cached;
  const result = new Map<string, ParsedSvgGradient>();
  const gradPattern = /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gu;
  let match: RegExpExecArray | null;
  while ((match = gradPattern.exec(defsSvg)) !== null) {
    const kind = match[1]!;
    const attrs = readSvgTagAttributes(match[2]!);
    const id = attrs.get('id');
    if (!id) continue;
    const stops = parseGradientStops(match[3]!);
    if (kind === 'linearGradient') {
      result.set(id, {
        kind: 'linear',
        x1: Number.parseFloat(attrs.get('x1') ?? '0') || 0,
        y1: Number.parseFloat(attrs.get('y1') ?? '0') || 0,
        x2: Number.parseFloat(attrs.get('x2') ?? '100') || 0,
        y2: Number.parseFloat(attrs.get('y2') ?? '0') || 0,
        stops,
      });
    } else {
      const cx = Number.parseFloat(attrs.get('cx') ?? '0') || 0;
      const cy = Number.parseFloat(attrs.get('cy') ?? '0') || 0;
      const r = Number.parseFloat(attrs.get('r') ?? '50') || 50;
      result.set(id, {
        kind: 'radial',
        cx,
        cy,
        r: Math.max(1e-3, r),
        fx: Number.parseFloat(attrs.get('fx') ?? String(cx)) || cx,
        fy: Number.parseFloat(attrs.get('fy') ?? String(cy)) || cy,
        stops,
      });
    }
  }
  if (parsedGradientDefsCache.size > 256) parsedGradientDefsCache.clear();
  parsedGradientDefsCache.set(defsSvg, result);
  return result;
}

function replayVectorCommands(
  ctx: Pick<
    CanvasRenderingContext2D,
    'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'
  >,
  commands: readonly FlaVectorPathCommand[],
): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        ctx.moveTo(cmd.x, cmd.y);
        break;
      case 'L':
        ctx.lineTo(cmd.x, cmd.y);
        break;
      case 'Q':
        ctx.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x, cmd.y);
        break;
      case 'C':
        ctx.bezierCurveTo(cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y);
        break;
      case 'Z':
        ctx.closePath();
        break;
    }
  }
}

function resolveRegionCanvasFillStyle(
  target: CanvasRenderingContext2D,
  svgPaint: string | undefined,
  defsSvg: string | undefined,
): string | CanvasGradient | null {
  if (!svgPaint || svgPaint === 'none') return null;
  const gradMatch = svgPaint.match(/^url\(#([^)]+)\)$/u);
  if (!gradMatch) return svgPaint;
  const grad = parseSvgDefsGradients(defsSvg).get(gradMatch[1]!);
  if (!grad || grad.stops.length === 0) return null;
  const canvasGrad =
    grad.kind === 'linear'
      ? target.createLinearGradient(grad.x1, grad.y1, grad.x2, grad.y2)
      : target.createRadialGradient(grad.fx, grad.fy, 0, grad.cx, grad.cy, grad.r);
  for (const stop of grad.stops) {
    canvasGrad.addColorStop(stop.offset, stop.color);
  }
  return canvasGrad;
}

function drawEditableStrokeToContext(
  target: CanvasRenderingContext2D,
  stroke: FlaEditableStroke,
  Path2DConstructor: typeof Path2D | undefined,
): void {
  if (stroke.opacity <= 0 || stroke.lineWidth <= 0) return;
  const strokeD = commandsToSvgPathD(stroke.commands);
  target.save();
  target.globalAlpha *= stroke.opacity;
  target.strokeStyle = stroke.color;
  target.lineWidth = stroke.lineWidth;
  target.lineCap = stroke.lineCap;
  target.lineJoin = stroke.lineJoin;
  target.miterLimit = stroke.miterLimit;
  if (Path2DConstructor && strokeD) {
    target.stroke(new Path2DConstructor(strokeD));
  } else {
    target.beginPath();
    replayVectorCommands(target, stroke.commands);
    target.stroke();
  }
  target.restore();
}

/** Draws editable `vectorVisual` fill pass first and stroke pass second to match Animate/SVG order. */
export function drawFlaVectorVisualToContext(
  target: CanvasRenderingContext2D,
  vectorVisual: EvaluatedFlaGraphicVectorVisual,
): void {
  const Path2DConstructor = globalThis.Path2D;
  // Pass 1: all fills in region order
  for (const region of vectorVisual.regions) {
    const paint =
      region.fill.kind === 'solid'
        ? region.fill.color ?? '#000000'
        : region.fill.svgPaint;
    if (region.fill.opacity > 0 && paint && paint !== 'none') {
      const fillStyle =
        region.fill.kind === 'solid'
          ? paint
          : resolveRegionCanvasFillStyle(target, paint, vectorVisual.defsSvg);
      if (fillStyle) {
        const fillD = region.contours
          .map((contour) => commandsToSvgPathD(contour.commands))
          .join(' ');
        target.save();
        target.globalAlpha *= region.fill.opacity;
        target.fillStyle = fillStyle;
        if (Path2DConstructor && fillD) {
          target.fill(new Path2DConstructor(fillD), region.fill.fillRule);
        } else {
          target.beginPath();
          for (const contour of region.contours) {
            replayVectorCommands(target, contour.commands);
          }
          target.fill(region.fill.fillRule);
        }
        target.restore();
      }
    }
  }
  // Pass 2: all strokes on top of fills, then isolated/shared residue strokes
  for (const region of vectorVisual.regions) {
    for (const stroke of region.strokes) {
      drawEditableStrokeToContext(target, stroke, Path2DConstructor);
    }
  }
  for (const residueStroke of vectorVisual.residueStrokes ?? []) {
    drawEditableStrokeToContext(target, residueStroke, Path2DConstructor);
  }
}

export type FlaGraphicImageMap = ReadonlyMap<string, CanvasImageSource>;

export interface FlaGraphicRaster {
  readonly canvas: HTMLCanvasElement;
  /** Placement in the existing owner-local space; the authored anchor stays fixed. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Drawable leaf extent in the same coordinate space, excluding the authored canvas. */
  readonly visibleRect: FlaGraphicRaster['rect'] | null;
}

const MAX_RENDER_EDGE = 4_096;
const MAX_RENDER_PIXELS = 4_194_304;
const MAX_COMPOSITE_DEPTH = 8;
interface RenderedCanvasCacheEntry {
  readonly imageSources: readonly (CanvasImageSource | undefined)[];
  readonly raster: FlaGraphicRaster | null;
}

const renderedCanvasCache = new WeakMap<
  EvaluatedFlaGraphicVisual,
  Map<number, RenderedCanvasCacheEntry>
>();

function sourceSize(image: CanvasImageSource): { width: number; height: number } {
  if ('naturalWidth' in image && 'naturalHeight' in image) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if ('videoWidth' in image && 'videoHeight' in image) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  return {
    width: 'width' in image ? Number(image.width) : 0,
    height: 'height' in image ? Number(image.height) : 0,
  };
}

function affineProduct(
  outer: readonly [number, number, number, number, number, number],
  inner: { a: number; b: number; c: number; d: number; tx: number; ty: number },
): [number, number, number, number, number, number] {
  const [a, b, c, d, tx, ty] = outer;
  return [
    a * inner.a + c * inner.b,
    b * inner.a + d * inner.b,
    a * inner.c + c * inner.d,
    b * inner.c + d * inner.d,
    a * inner.tx + c * inner.ty + tx,
    b * inner.tx + d * inner.ty + ty,
  ];
}

function validTransform(
  matrix: readonly [number, number, number, number, number, number],
): boolean {
  return matrix.every(Number.isFinite);
}

function applyGraphicColor(
  target: CanvasRenderingContext2D,
  { width, height }: Pick<HTMLCanvasElement, 'width' | 'height'>,
  color: FlaInstanceColor,
  coverageCanvas?: HTMLCanvasElement | null,
): boolean {
  const rgba = normalizeFlaInstanceColorToRgba(color);
  const [rm, gm, bm, am] = rgba.multipliers;
  const [ro, go, bo, ao] = rgba.offsets;
  const isRgbIdentity = rm === 1 && gm === 1 && bm === 1 && ro === 0 && go === 0 && bo === 0;
  if (isRgbIdentity && ao === 0) {
    if (am === 1) return true;
    if (am >= 0 && am <= 1) {
      target.save();
      target.globalAlpha = am;
      target.globalCompositeOperation = 'destination-in';
      target.fillStyle = '#000';
      target.fillRect(0, 0, width, height);
      target.restore();
      return true;
    }
  }
  try {
    const imageData = target.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const coveragePixels = ao > 0 && coverageCanvas
      ? coverageCanvas.getContext('2d')?.getImageData(0, 0, width, height).data ?? null
      : null;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3]!;
      const covAlpha = coveragePixels !== null ? coveragePixels[index + 3]! : 0;
      const hasCoverage = alpha > 0 || covAlpha > 0;
      if (!hasCoverage) continue;
      if (alpha === 0 && coveragePixels && covAlpha > 0) {
        const [r, g, b, a] = applyFlaRgbaTransform(
          [coveragePixels[index]!, coveragePixels[index + 1]!, coveragePixels[index + 2]!, 0], rgba,
        );
        pixels[index] = Math.round(r);
        pixels[index + 1] = Math.round(g);
        pixels[index + 2] = Math.round(b);
        pixels[index + 3] = Math.round((a * covAlpha) / 255);
        continue;
      }
      const [r, g, b, a] = applyFlaRgbaTransform(
        [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!, alpha],
        rgba,
      );
      pixels[index] = Math.round(r);
      pixels[index + 1] = Math.round(g);
      pixels[index + 2] = Math.round(b);
      pixels[index + 3] = Math.round(a);
    }
    target.putImageData(imageData, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function boundedRasterScale(width: number, height: number, requestedScale: number): number {
  return Math.min(
    Math.max(0.0001, requestedScale), 1,
    MAX_RENDER_EDGE / width, MAX_RENDER_EDGE / height,
    Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height)),
  );
}

function renderColoredBakedFrame(
  visual: EvaluatedFlaGraphicVisual,
  source: CanvasImageSource,
  color: FlaInstanceColor,
  requestedScale: number,
): FlaGraphicRaster | null {
  const { width, height } = visual.frameViewport;
  const scale = boundedRasterScale(width, height, requestedScale);
  if (!Number.isFinite(scale) || scale <= 0 || width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  applyGraphicColor(context, canvas, color);
  const rect = {
    x: visual.frameOffset.x - visual.canvas.width / 2,
    y: visual.frameOffset.y - visual.canvas.height / 2,
    width,
    height,
  };
  return { canvas, rect, visibleRect: isZeroAlphaFlaInstanceColor(color) ? null : rect };
}

/**
 * Raster adapter shared by the editor Stage, hidden export Stage, Definition
 * preview, and Shot thumbnail. Evaluation stays pure in src/domain; this file
 * only interprets its display data with browser Canvas primitives.
 */
export function renderFlaGraphicCanvas(
  visual: EvaluatedFlaGraphicVisual,
  images: FlaGraphicImageMap,
  requestedScale = 1,
): FlaGraphicRaster | null {
  const imageSources = visual.resourceAssetIds.map((assetId) => images.get(assetId));
  let cacheByScale = renderedCanvasCache.get(visual);
  const cached = cacheByScale?.get(requestedScale);
  if (
    cached &&
    cached.imageSources.length === imageSources.length &&
    cached.imageSources.every((image, index) => image === imageSources[index])
  ) {
    return cached.raster;
  }
  const raster = renderFlaGraphicCanvasUncached(visual, images, requestedScale);
  if (!cacheByScale) {
    cacheByScale = new Map();
    renderedCanvasCache.set(visual, cacheByScale);
  }
  cacheByScale.set(requestedScale, { imageSources, raster });
  return raster;
}

function renderFlaGraphicCanvasUncached(
  visual: EvaluatedFlaGraphicVisual,
  images: FlaGraphicImageMap,
  requestedScale: number,
): FlaGraphicRaster | null {
  if (typeof document === 'undefined') return null;
  if (!visual.structureFrame || !visual.layers) {
    const source = visual.instanceColor ? images.get(visual.frameAssetId) : undefined;
    return source && visual.instanceColor
      ? renderColoredBakedFrame(visual, source, visual.instanceColor, requestedScale)
      : null;
  }
  // Include the authored canvas to preserve its anchor, and every drawable
  // evaluated leaf so negative/outside Child transforms are never clipped.
  let left = visual.anchor.x;
  let top = visual.anchor.y;
  let right = left + visual.canvas.width;
  let bottom = top + visual.canvas.height;
  let contentLeft = Infinity;
  let contentTop = Infinity;
  let contentRight = -Infinity;
  let contentBottom = -Infinity;
  let measureText: FlaStaticTextMeasurer | undefined;
  const textLayouts = new Map<EvaluatedFlaGraphicNode, FlaStaticTextLayoutResult>();
  const includeNodes = (nodes: readonly EvaluatedFlaGraphicNode[], visible = true): void => {
    for (const node of nodes) {
      if (!node.renderable) continue;
      const source = node.source;
      const plan = evaluateFlaGraphicNodeCompositePlan(node);
      const nodeVisibleByColor = plan.rgbaTransform
        ? !isZeroAlphaFlaInstanceColor({ rgbaTransform: plan.rgbaTransform })
        : plan.opacity > 0;
      const drawsVisibleContent = visible && nodeVisibleByColor;
      if (source.type === 'group' || source.type === 'symbol') {
        includeNodes(node.children, drawsVisibleContent);
        continue;
      }
      const includeCorners = (
        m: EvaluatedFlaGraphicNode['worldTransform'],
        corners: readonly [number, number][],
      ): void => {
        for (const [x, y] of corners) {
          const worldX = m.a * x + m.c * y + m.tx;
          const worldY = m.b * x + m.d * y + m.ty;
          if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) continue;
          left = Math.min(left, worldX);
          top = Math.min(top, worldY);
          right = Math.max(right, worldX);
          bottom = Math.max(bottom, worldY);
          if (drawsVisibleContent) {
            contentLeft = Math.min(contentLeft, worldX);
            contentTop = Math.min(contentTop, worldY);
            contentRight = Math.max(contentRight, worldX);
            contentBottom = Math.max(contentBottom, worldY);
          }
        }
      };
      if (node.staticText) {
        if (!measureText) {
          const measurementContext = document.createElement('canvas').getContext('2d');
          if (!measurementContext) continue;
          measureText = createCanvasStaticTextMeasurer(measurementContext);
        }
        const layout = layoutFlaStaticText(node.staticText, measureText);
        textLayouts.set(node, layout);
        if (layout.lines.some((line) => line.fragments.some((fragment) => fragment.text.trim()))) {
          const { x, y, width, height } = layout.bounds;
          includeCorners(node.worldTransform, [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]);
        }
        continue;
      }
      if (node.vectorVisual) {
        const bounds = unionFlaShapeRegionBounds(
          node.vectorVisual.regions,
          node.vectorVisual.residueStrokes,
        );
        if (!bounds) continue;
        const rx = bounds.x - node.vectorVisual.baseViewBox.x;
        const ry = bounds.y - node.vectorVisual.baseViewBox.y;
        includeCorners(node.worldTransform, [
          [rx, ry],
          [rx + bounds.width, ry],
          [rx, ry + bounds.height],
          [rx + bounds.width, ry + bounds.height],
        ]);
        continue;
      }
      const image = images.get(source.type === 'bitmap' ? source.assetId ?? '' : source.fallbackAssetId ?? '');
      if (!image) continue;
      const size = source.type === 'bitmap' ? sourceSize(image) : source.fallbackViewBox;
      if (!size || size.width <= 0 || size.height <= 0) continue;
      includeCorners(node.worldTransform, [
        [0, 0],
        [size.width, 0],
        [0, size.height],
        [size.width, size.height],
      ]);
    }
  };
  includeNodes(visual.layers.flatMap((layer) => layer.nodes));
  const sourceWidth = right - left;
  const sourceHeight = bottom - top;
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) return null;
  const scale = boundedRasterScale(sourceWidth, sourceHeight, requestedScale);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const width = Math.max(1, Math.ceil(sourceWidth * scale));
  const height = Math.max(1, Math.ceil(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const rootTransform: [number, number, number, number, number, number] = [
    scale,
    0,
    0,
    scale,
    -scale * left,
    -scale * top,
  ];
  const visibleRect = contentRight > contentLeft && contentBottom > contentTop ? {
    x: contentLeft - visual.anchor.x - visual.canvas.width / 2,
    y: contentTop - visual.anchor.y - visual.canvas.height / 2,
    width: contentRight - contentLeft,
    height: contentBottom - contentTop,
  } : null;
  const raster: FlaGraphicRaster = { canvas, visibleRect, rect: {
    x: left - visual.anchor.x - visual.canvas.width / 2,
    y: top - visual.anchor.y - visual.canvas.height / 2,
    width: sourceWidth,
    height: sourceHeight,
  } };
  let renderedNodeCount = 0;

  const makeScratch = (): {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  } | null => {
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const scratchContext = scratch.getContext('2d');
    return scratchContext ? { canvas: scratch, context: scratchContext } : null;
  };

  const drawLeaf = (
    target: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
  ): boolean => {
    const source = node.source;
    const matrix = affineProduct(rootTransform, node.worldTransform);
    if (!validTransform(matrix)) return false;
    if (node.staticText) {
      const layout = textLayouts.get(node);
      if (!layout) return false;
      target.save();
      target.setTransform(...matrix);
      drawCanvasStaticText(target, layout);
      target.restore();
      renderedNodeCount += 1;
      return true;
    }
    if (node.vectorVisual) {
      if (
        node.vectorVisual.regions.length === 0 &&
        (node.vectorVisual.residueStrokes?.length ?? 0) === 0
      ) {
        return false;
      }
      target.save();
      target.setTransform(...matrix);
      target.translate(
        -node.vectorVisual.baseViewBox.x,
        -node.vectorVisual.baseViewBox.y,
      );
      drawFlaVectorVisualToContext(target, node.vectorVisual);
      target.restore();
      renderedNodeCount += 1;
      return true;
    }
    let image: CanvasImageSource | undefined;
    let destinationWidth: number;
    let destinationHeight: number;
    let crop: { x: number; y: number; width: number; height: number } | null = null;
    if (source.type === 'bitmap') {
      image = source.assetId ? images.get(source.assetId) : undefined;
      if (!image) return false;
      const size = sourceSize(image);
      destinationWidth = size.width;
      destinationHeight = size.height;
    } else if (source.type === 'opaque') {
      image = source.fallbackAssetId
        ? images.get(source.fallbackAssetId)
        : undefined;
      if (!image || !source.fallbackViewBox || !source.fallbackScope) return false;
      destinationWidth = source.fallbackViewBox.width;
      destinationHeight = source.fallbackViewBox.height;
      if (source.fallbackScope === 'frame-crop') {
        const size = sourceSize(image);
        const normalizedCrop = evaluateOpaqueFrameCropNormalizedRect(
          source.fallbackViewBox,
          visual.frameViewport,
        );
        if (!normalizedCrop) return false;
        crop = {
          x: normalizedCrop.normX * size.width,
          y: normalizedCrop.normY * size.height,
          width: normalizedCrop.normWidth * size.width,
          height: normalizedCrop.normHeight * size.height,
        };
      }
    } else {
      return false;
    }
    target.save();
    target.setTransform(...matrix);
    if (crop) {
      target.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        destinationWidth,
        destinationHeight,
      );
    } else {
      target.drawImage(image, 0, 0, destinationWidth, destinationHeight);
    }
    target.restore();
    renderedNodeCount += 1;
    return true;
  };

  const renderContents = (
    target: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
    drawNode: (target: CanvasRenderingContext2D, child: EvaluatedFlaGraphicNode) => boolean,
  ): boolean => {
    if (node.source.type === 'group' || node.source.type === 'symbol') {
      let drewChild = false;
      for (const child of node.children) {
        if (drawNode(target, child)) drewChild = true;
      }
      return drewChild;
    }
    return drawLeaf(target, node);
  };

  const applyNodeClips = (
    targetCanvas: HTMLCanvasElement,
    node: EvaluatedFlaGraphicNode,
  ): boolean => {
    if (node.clipPaths.length === 0) return true;
    const Path2DConstructor = globalThis.Path2D;
    if (!Path2DConstructor) return false;
    const mask = makeScratch();
    if (!mask) return false;
    for (const clipPath of node.clipPaths) {
      mask.context.setTransform(1, 0, 0, 1, 0, 0);
      mask.context.clearRect(0, 0, width, height);
      let drewShape = false;
      for (const shape of clipPath.shapes) {
        const transform = affineProduct(rootTransform, shape.worldTransform);
        if (!validTransform(transform)) return false;
        for (const pathData of shape.pathData) {
          try {
            mask.context.save();
            mask.context.setTransform(...transform);
            mask.context.fillStyle = '#fff';
            mask.context.fill(new Path2DConstructor(pathData), 'nonzero');
            mask.context.restore();
            drewShape = true;
          } catch {
            mask.context.restore();
            return false;
          }
        }
      }
      if (!drewShape) return false;
      const targetContext = targetCanvas.getContext('2d');
      if (!targetContext) return false;
      targetContext.save();
      targetContext.globalCompositeOperation = 'destination-in';
      targetContext.drawImage(mask.canvas, 0, 0);
      targetContext.restore();
    }
    return true;
  };

  const drawLeafCoverage = (
    coverageTarget: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
  ): void => {
    const source = node.source;
    const matrix = affineProduct(rootTransform, node.worldTransform);
    if (!validTransform(matrix)) return;
    if (node.staticText) {
      const layout = textLayouts.get(node);
      if (!layout) return;
      coverageTarget.save();
      coverageTarget.setTransform(...matrix);
      drawCanvasStaticText(coverageTarget, layout, '#000000');
      coverageTarget.restore();
      return;
    }
    if (node.vectorVisual) {
      const Path2DConstructor = globalThis.Path2D;
      coverageTarget.save();
      coverageTarget.setTransform(...matrix);
      coverageTarget.translate(
        -node.vectorVisual.baseViewBox.x,
        -node.vectorVisual.baseViewBox.y,
      );
      coverageTarget.fillStyle = '#000000';
      for (const region of node.vectorVisual.regions) {
        const fillD = region.contours.map((contour) => commandsToSvgPathD(contour.commands)).join(' ');
        if (Path2DConstructor && fillD) {
          coverageTarget.fill(new Path2DConstructor(fillD), region.fill.fillRule);
        } else {
          coverageTarget.beginPath();
          for (const contour of region.contours) replayVectorCommands(coverageTarget, contour.commands);
          coverageTarget.fill(region.fill.fillRule);
        }
      }
      coverageTarget.restore();
      return;
    }
    if (source.type === 'opaque' && source.opaqueKind === 'shape' && source.coveragePathData?.length) {
      const Path2DConstructor = globalThis.Path2D;
      coverageTarget.save();
      coverageTarget.setTransform(...matrix);
      if (source.fallbackScope === 'subtree' && source.fallbackViewBox) {
        coverageTarget.translate(-source.fallbackViewBox.x, -source.fallbackViewBox.y);
      }
      for (const [index, pathD] of source.coveragePathData.entries()) {
        coverageTarget.fillStyle = source.coverageZeroAlphaColors?.[index] ?? '#000000';
        if (Path2DConstructor) {
          try {
            coverageTarget.fill(new Path2DConstructor(pathD), 'nonzero');
          } catch {
            // Skip malformed path cleanly without tinting the whole scratch canvas.
          }
        } else {
          coverageTarget.beginPath();
          replaySvgPathDToContext(coverageTarget, pathD);
          coverageTarget.fill('nonzero');
        }
      }
      coverageTarget.restore();
      return;
    }
    if (source.type === 'bitmap') {
      const image = source.assetId ? images.get(source.assetId) : undefined;
      if (!image) return;
      const size = sourceSize(image);
      if (size.width <= 0 || size.height <= 0) return;
      // A bitmap instance's own texel rectangle is valid object coverage (including
      // interior transparent texels), while canvas/filter padding outside stays empty.
      coverageTarget.save();
      coverageTarget.setTransform(...matrix);
      coverageTarget.fillStyle = '#000000';
      coverageTarget.fillRect(0, 0, size.width, size.height);
      coverageTarget.restore();
    }
  };

  const drawNodeCoverage = (
    coverageTarget: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
  ): void => {
    if (!node.renderable) return;
    if (node.clipPaths.length > 0) {
      const clipped = makeScratch();
      if (!clipped) return;
      if (node.source.type === 'group' || node.source.type === 'symbol') {
        for (const child of node.children) drawNodeCoverage(clipped.context, child);
      } else {
        drawLeafCoverage(clipped.context, node);
      }
      if (!applyNodeClips(clipped.canvas, node)) return;
      coverageTarget.save();
      coverageTarget.setTransform(1, 0, 0, 1, 0, 0);
      coverageTarget.drawImage(clipped.canvas, 0, 0);
      coverageTarget.restore();
      return;
    }
    if (node.source.type === 'group' || node.source.type === 'symbol') {
      for (const child of node.children) drawNodeCoverage(coverageTarget, child);
    } else {
      drawLeafCoverage(coverageTarget, node);
    }
  };

  const drawNode = (
    target: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
    compositeDepth = 0,
  ): boolean => {
    if (!node.renderable) return false;
    const compositePlan = evaluateFlaGraphicNodeCompositePlan(node);
    if (!compositePlan.needsComposite) {
      return renderContents(
        target,
        node,
        (context, child) => drawNode(context, child, compositeDepth),
      );
    }
    if (compositeDepth >= MAX_COMPOSITE_DEPTH) return false;
    const scratch = makeScratch();
    if (!scratch) return false;
    const drewContent = renderContents(
      scratch.context,
      node,
      (context, child) => drawNode(context, child, compositeDepth + 1),
    );
    if (!drewContent) return false;
    if (compositePlan.hasClips && !applyNodeClips(scratch.canvas, node)) return false;
    if (compositePlan.rgbaTransform) {
      let coverageCanvas: HTMLCanvasElement | null = null;
      if (compositePlan.rgbaTransform.offsets[3] > 0) {
        const cov = makeScratch();
        if (cov) {
          drawNodeCoverage(cov.context, node);
          if (!compositePlan.hasClips || applyNodeClips(cov.canvas, node)) {
            coverageCanvas = cov.canvas;
          }
        }
      }
      if (!applyGraphicColor(scratch.context, scratch.canvas, { rgbaTransform: compositePlan.rgbaTransform }, coverageCanvas)) {
        return false;
      }
    } else if (
      compositePlan.rgbTransform &&
      !applyGraphicColor(scratch.context, scratch.canvas, { rgbTransform: compositePlan.rgbTransform })
    ) {
      return false;
    }
    target.save();
    target.globalAlpha = compositePlan.opacity;
    target.globalCompositeOperation = compositePlan.canvasCompositeOperation;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(scratch.canvas, 0, 0);
    target.restore();
    return true;
  };

  for (const layer of visual.layers) {
    for (const node of layer.nodes) drawNode(context, node);
  }
  if (renderedNodeCount === 0) {
    // A structured frame may intentionally degrade to empty when every node
    // is unsafe; the baked frame must not resurrect unsupported content.
    return { ...raster, visibleRect: null };
  }
  if (visual.instanceColor) {
    const effectiveRgba: FlaRgbaTransform = normalizeFlaInstanceColorToRgba(visual.instanceColor);
    let rootCoverage: HTMLCanvasElement | null = null;
    if (effectiveRgba.offsets[3] > 0) {
      const cov = makeScratch();
      if (cov) {
        for (const layer of visual.layers) {
          for (const node of layer.nodes) drawNodeCoverage(cov.context, node);
        }
        rootCoverage = cov.canvas;
      }
    }
    applyGraphicColor(context, canvas, visual.instanceColor, rootCoverage);
    if (isZeroAlphaFlaInstanceColor(visual.instanceColor)) return { ...raster, visibleRect: null };
  }
  return raster;
}
