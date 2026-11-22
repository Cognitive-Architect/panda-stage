import type {
  LayerVisualPart,
  Point,
  ViewportTransform,
  VisualLocalRect,
} from '../../../domain';
import { invertAffineMatrix } from '../../../shared/affine-matrix';

export type AdaptivePartAlphaHitMode = 'alpha' | 'transparent' | 'list-only';

export interface AdaptivePartAlphaHitMap {
  mode: AdaptivePartAlphaHitMode;
  sourceWidth: number;
  sourceHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  opaquePixels: Uint8Array | null;
  visibleBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

const MAX_ALPHA_SAMPLE_EDGE = 2048;
const FALLBACK_ALPHA_SAMPLE_EDGE = 256;
const MIN_HIT_ALPHA = 8;
const decodedAlphaMaps = new WeakMap<HTMLImageElement | HTMLCanvasElement, AdaptivePartAlphaHitMap>();

function listOnlyAlphaMap(
  sourceWidth: number,
  sourceHeight: number,
): AdaptivePartAlphaHitMap {
  return {
    mode: 'list-only',
    sourceWidth,
    sourceHeight,
    sampleWidth: 0,
    sampleHeight: 0,
    opaquePixels: null,
    visibleBounds: null,
  };
}

export function createAdaptivePartAlphaHitMapFromRgba(
  rgba: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
  sourceWidth = sampleWidth,
  sourceHeight = sampleHeight,
): AdaptivePartAlphaHitMap {
  const pixelCount = sampleWidth * sampleHeight;
  if (
    !Number.isInteger(sampleWidth) ||
    !Number.isInteger(sampleHeight) ||
    sampleWidth < 1 ||
    sampleHeight < 1 ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    rgba.length < pixelCount * 4
  ) {
    return listOnlyAlphaMap(sourceWidth, sourceHeight);
  }

  const opaquePixels = new Uint8Array(Math.ceil(pixelCount / 8));
  let left = sampleWidth;
  let top = sampleHeight;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < pixelCount; index += 1) {
    if (rgba[index * 4 + 3]! < MIN_HIT_ALPHA) continue;
    const byteIndex = index >> 3;
    opaquePixels[byteIndex] = opaquePixels[byteIndex]! | (1 << (index & 7));
    const x = index % sampleWidth;
    const y = Math.floor(index / sampleWidth);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  if (right < left || bottom < top) {
    return {
      mode: 'transparent',
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      opaquePixels,
      visibleBounds: null,
    };
  }

  return {
    mode: 'alpha',
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    opaquePixels,
    visibleBounds: {
      x: left / sampleWidth,
      y: top / sampleHeight,
      width: (right - left + 1) / sampleWidth,
      height: (bottom - top + 1) / sampleHeight,
    },
  };
}

function readAdaptivePartAlphaHitMap(
  image: HTMLImageElement | HTMLCanvasElement,
): AdaptivePartAlphaHitMap {
  const sourceWidth = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const sourceHeight = 'naturalHeight' in image ? image.naturalHeight : image.height;
  if (
    ('complete' in image && !image.complete) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    typeof document === 'undefined'
  ) {
    return listOnlyAlphaMap(sourceWidth, sourceHeight);
  }

  for (const maxEdge of [MAX_ALPHA_SAMPLE_EDGE, FALLBACK_ALPHA_SAMPLE_EDGE]) {
    const sampleScale = Math.min(
      1,
      maxEdge / Math.max(sourceWidth, sourceHeight),
    );
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight);
      return createAdaptivePartAlphaHitMapFromRgba(
        pixels.data,
        sampleWidth,
        sampleHeight,
        sourceWidth,
        sourceHeight,
      );
    } catch {
      // A smaller bounded read is attempted before falling back to the list.
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return listOnlyAlphaMap(sourceWidth, sourceHeight);
}

export function getAdaptivePartAlphaHitMap(
  image: HTMLImageElement | HTMLCanvasElement,
): AdaptivePartAlphaHitMap {
  const cached = decodedAlphaMaps.get(image);
  if (cached) return cached;
  const map = readAdaptivePartAlphaHitMap(image);
  decodedAlphaMaps.set(image, map);
  return map;
}

export interface AdaptivePartHitSurface {
  /** The rectangle occupied by the decoded bitmap in Part-local coordinates. */
  rect: VisualLocalRect;
  alpha: AdaptivePartAlphaHitMap;
}

export function viewportClientToAssemblyPoint(
  clientX: number,
  clientY: number,
  viewportBounds: Pick<DOMRect, 'left' | 'top'>,
  clientBorder: Pick<Point, 'x' | 'y'>,
  transform: ViewportTransform,
): Point | null {
  if (!(Number.isFinite(transform.scale) && transform.scale > 0)) return null;
  const localX = clientX - viewportBounds.left - clientBorder.x;
  const localY = clientY - viewportBounds.top - clientBorder.y;
  const stageX = (localX - transform.offsetX) / transform.scale;
  const stageY = (localY - transform.offsetY) / transform.scale;
  return {
    x: stageX - transform.logical.width / 2,
    y: stageY - transform.logical.height / 2,
  };
}

function alphaMapHasPixel(
  hitMap: AdaptivePartAlphaHitMap,
  sourcePoint: Point,
): boolean {
  if (
    hitMap.mode !== 'alpha' ||
    !hitMap.opaquePixels ||
    hitMap.sampleWidth < 1 ||
    hitMap.sampleHeight < 1
  ) {
    return false;
  }
  const x = Math.min(
    hitMap.sampleWidth - 1,
    Math.floor((sourcePoint.x / hitMap.sourceWidth) * hitMap.sampleWidth),
  );
  const y = Math.min(
    hitMap.sampleHeight - 1,
    Math.floor((sourcePoint.y / hitMap.sourceHeight) * hitMap.sampleHeight),
  );
  const index = y * hitMap.sampleWidth + x;
  return Boolean(hitMap.opaquePixels[index >> 3]! & (1 << (index & 7)));
}

export function hitTestAdaptivePartsAtPoint(
  parts: readonly LayerVisualPart[],
  surfacesByPartId: ReadonlyMap<string, AdaptivePartHitSurface>,
  point: Point,
): LayerVisualPart | null {
  // These parts are painted in ascending draw order, including ties.
  const ordered = parts.filter((part) => part.visible !== false)
    .sort((left, right) => left.drawOrder - right.drawOrder);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const part = ordered[index]!;
    const surface = surfacesByPartId.get(part.partId);
    const inverse = part.imageTransform && invertAffineMatrix(part.imageTransform);
    if (!surface || surface.alpha.mode !== 'alpha' || !inverse) continue;
    const { rect, alpha } = surface;
    const x = (inverse.a * point.x + inverse.c * point.y + inverse.tx - rect.x) / rect.width;
    const y = (inverse.b * point.x + inverse.d * point.y + inverse.ty - rect.y) / rect.height;
    if (x >= 0 && x < 1 && y >= 0 && y < 1 &&
        alphaMapHasPixel(alpha, { x: x * alpha.sourceWidth, y: y * alpha.sourceHeight })) {
      return part;
    }
  }
  return null;
}
