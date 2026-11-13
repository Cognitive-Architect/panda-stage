import type {
  EvaluatedFlaGraphicNode,
  EvaluatedFlaGraphicVisual,
} from '../../../domain';

export type FlaGraphicImageMap = ReadonlyMap<string, CanvasImageSource>;

const MAX_RENDER_EDGE = 4_096;
const MAX_RENDER_PIXELS = 4_194_304;
const MAX_COMPOSITE_DEPTH = 8;
interface RenderedCanvasCacheEntry {
  readonly imageSources: readonly (CanvasImageSource | undefined)[];
  readonly canvas: HTMLCanvasElement | null;
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

/**
 * Raster adapter shared by the editor Stage, hidden export Stage, Definition
 * preview, and Shot thumbnail. Evaluation stays pure in src/domain; this file
 * only interprets its display data with browser Canvas primitives.
 */
export function renderFlaGraphicCanvas(
  visual: EvaluatedFlaGraphicVisual,
  images: FlaGraphicImageMap,
  requestedScale = 1,
): HTMLCanvasElement | null {
  const imageSources = visual.resourceAssetIds.map((assetId) => images.get(assetId));
  let cacheByScale = renderedCanvasCache.get(visual);
  const cached = cacheByScale?.get(requestedScale);
  if (
    cached &&
    cached.imageSources.length === imageSources.length &&
    cached.imageSources.every((image, index) => image === imageSources[index])
  ) {
    return cached.canvas;
  }
  const canvas = renderFlaGraphicCanvasUncached(visual, images, requestedScale);
  if (!cacheByScale) {
    cacheByScale = new Map();
    renderedCanvasCache.set(visual, cacheByScale);
  }
  cacheByScale.set(requestedScale, { imageSources, canvas });
  return canvas;
}

function renderFlaGraphicCanvasUncached(
  visual: EvaluatedFlaGraphicVisual,
  images: FlaGraphicImageMap,
  requestedScale: number,
): HTMLCanvasElement | null {
  if (!visual.structureFrame || !visual.layers || typeof document === 'undefined') {
    return null;
  }
  const sourceWidth = visual.canvas.width;
  const sourceHeight = visual.canvas.height;
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) return null;
  const scaleByEdge = Math.min(
    1,
    MAX_RENDER_EDGE / sourceWidth,
    MAX_RENDER_EDGE / sourceHeight,
  );
  const scaleByArea = Math.sqrt(
    MAX_RENDER_PIXELS / Math.max(1, sourceWidth * sourceHeight),
  );
  const scale = Math.max(
    0.0001,
    Math.min(requestedScale, scaleByEdge, scaleByArea),
  );
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
    -scale * visual.anchor.x,
    -scale * visual.anchor.y,
  ];
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
        const viewport = visual.frameViewport;
        if (viewport.width <= 0 || viewport.height <= 0) return false;
        const scaleX = size.width / viewport.width;
        const scaleY = size.height / viewport.height;
        const rawX = (source.fallbackViewBox.x - viewport.x) * scaleX;
        const rawY = (source.fallbackViewBox.y - viewport.y) * scaleY;
        const rawWidth = source.fallbackViewBox.width * scaleX;
        const rawHeight = source.fallbackViewBox.height * scaleY;
        const x = Math.max(0, rawX);
        const y = Math.max(0, rawY);
        const right = Math.min(size.width, rawX + rawWidth);
        const bottom = Math.min(size.height, rawY + rawHeight);
        if (right <= x || bottom <= y) return false;
        crop = { x, y, width: right - x, height: bottom - y };
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

  const applyRgbTransform = (
    target: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
  ): boolean => {
    if (node.source.type !== 'symbol' || !node.source.rgbTransform) return true;
    const { multiplier, offset } = node.source.rgbTransform;
    if (multiplier === 1 && offset === 0) return true;
    try {
      const imageData = target.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = Math.min(255, Math.round(pixels[index]! * multiplier + offset));
        pixels[index + 1] = Math.min(255, Math.round(pixels[index + 1]! * multiplier + offset));
        pixels[index + 2] = Math.min(255, Math.round(pixels[index + 2]! * multiplier + offset));
      }
      target.putImageData(imageData, 0, 0);
      return true;
    } catch {
      return false;
    }
  };

  const drawNode = (
    target: CanvasRenderingContext2D,
    node: EvaluatedFlaGraphicNode,
    compositeDepth = 0,
  ): boolean => {
    if (!node.renderable) return false;
    const needsComposite =
      node.clipPaths.length > 0 ||
      (node.source.type === 'symbol' &&
        ((node.source.opacity ?? 1) !== 1 || Boolean(node.source.rgbTransform)));
    if (!needsComposite) {
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
    if (!applyNodeClips(scratch.canvas, node)) return false;
    if (!applyRgbTransform(scratch.context, node)) return false;
    target.save();
    if (node.source.type === 'symbol') {
      target.globalAlpha = node.source.opacity ?? 1;
    }
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
    return canvas;
  }
  return canvas;
}
