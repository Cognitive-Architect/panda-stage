import { useLayoutEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import {
  findVisibleImageBounds,
  type NormalizedImageBounds,
} from './characterAssemblyPreview';

const MAX_ALPHA_SAMPLE_EDGE = 256;
const VISIBLE_BOUNDS_CACHE_LIMIT = 256;
const VISIBLE_CONTENT_PADDING = 0.04;

const visibleBoundsCache = new Map<string, NormalizedImageBounds | null>();
const pendingVisibleBounds = new Map<
  string,
  Promise<NormalizedImageBounds | null>
>();

export interface VisibleBoundsThumbnailTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export function getVisibleBoundsThumbnailTransform(
  bounds: NormalizedImageBounds,
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): VisibleBoundsThumbnailTransform | null {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height, imageWidth, imageHeight, boxWidth, boxHeight].every(Number.isFinite) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > 1.000001 ||
    bounds.y + bounds.height > 1.000001 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    return null;
  }

  const left = Math.max(0, bounds.x - bounds.width * VISIBLE_CONTENT_PADDING);
  const top = Math.max(0, bounds.y - bounds.height * VISIBLE_CONTENT_PADDING);
  const right = Math.min(
    1,
    bounds.x + bounds.width * (1 + VISIBLE_CONTENT_PADDING),
  );
  const bottom = Math.min(
    1,
    bounds.y + bounds.height * (1 + VISIBLE_CONTENT_PADDING),
  );
  const sourceScale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const visibleWidth = (right - left) * imageWidth * sourceScale;
  const visibleHeight = (bottom - top) * imageHeight * sourceScale;
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;

  const scale = Math.min(boxWidth / visibleWidth, boxHeight / visibleHeight);
  const visibleCenterX = ((left + right) / 2 - 0.5) * imageWidth * sourceScale;
  const visibleCenterY = ((top + bottom) / 2 - 0.5) * imageHeight * sourceScale;
  return {
    scale,
    translateX: -visibleCenterX * scale,
    translateY: -visibleCenterY * scale,
  };
}

function measureVisibleImageBounds(
  image: HTMLImageElement,
): NormalizedImageBounds | null {
  if (
    !image.complete ||
    image.naturalWidth < 1 ||
    image.naturalHeight < 1 ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  const sampleScale = Math.min(
    1,
    MAX_ALPHA_SAMPLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const sampleWidth = Math.max(1, Math.round(image.naturalWidth * sampleScale));
  const sampleHeight = Math.max(1, Math.round(image.naturalHeight * sampleScale));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight);
    return findVisibleImageBounds(pixels.data, sampleWidth, sampleHeight);
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function cacheVisibleBounds(
  cacheKey: string,
  bounds: NormalizedImageBounds | null,
): void {
  visibleBoundsCache.delete(cacheKey);
  visibleBoundsCache.set(cacheKey, bounds);
  if (visibleBoundsCache.size > VISIBLE_BOUNDS_CACHE_LIMIT) {
    const oldestKey = visibleBoundsCache.keys().next().value;
    if (oldestKey !== undefined) visibleBoundsCache.delete(oldestKey);
  }
}

function loadVisibleBounds(
  cacheKey: string,
  src: string,
): Promise<NormalizedImageBounds | null> {
  if (visibleBoundsCache.has(cacheKey)) {
    return Promise.resolve(visibleBoundsCache.get(cacheKey) ?? null);
  }
  const pending = pendingVisibleBounds.get(cacheKey);
  if (pending) return pending;

  const measurement = new Promise<NormalizedImageBounds | null>((resolve) => {
    const image = new Image();
    const finish = (bounds: NormalizedImageBounds | null): void => {
      image.onload = null;
      image.onerror = null;
      cacheVisibleBounds(cacheKey, bounds);
      resolve(bounds);
    };
    image.onload = () => finish(measureVisibleImageBounds(image));
    image.onerror = () => finish(null);
    image.src = src;
    if (image.complete && image.naturalWidth > 0) {
      queueMicrotask(() => finish(measureVisibleImageBounds(image)));
    }
  }).finally(() => pendingVisibleBounds.delete(cacheKey));

  pendingVisibleBounds.set(cacheKey, measurement);
  return measurement;
}

export interface VisibleBoundsThumbnailProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  cacheKey: string;
  src: string;
}

/** A UI-only alpha crop that leaves the original image and project data untouched. */
export function VisibleBoundsThumbnail({
  cacheKey,
  src,
  onLoad,
  onError,
  style,
  ...imageProps
}: VisibleBoundsThumbnailProps): React.JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null);
  const [bounds, setBounds] = useState<NormalizedImageBounds | null>(() =>
    visibleBoundsCache.get(cacheKey) ?? null,
  );
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const image = imageRef.current;
    const container = image?.parentElement;
    if (!container) return undefined;

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      setBox((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    let current = true;
    const cached = visibleBoundsCache.get(cacheKey);
    if (visibleBoundsCache.has(cacheKey)) {
      setBounds(cached ?? null);
      return () => {
        current = false;
      };
    }
    setBounds(null);
    void loadVisibleBounds(cacheKey, src).then((nextBounds) => {
      if (current) setBounds(nextBounds);
    });
    return () => {
      current = false;
    };
  }, [cacheKey, src]);

  const transform = bounds
    ? getVisibleBoundsThumbnailTransform(
        bounds,
        imageSize.width,
        imageSize.height,
        box.width,
        box.height,
      )
    : null;

  return (
    <img
      {...imageProps}
      onError={(event) => {
        setImageSize({ width: 0, height: 0 });
        onError?.(event);
      }}
      onLoad={(event) => {
        const loadedImage = event.currentTarget;
        setImageSize({
          width: loadedImage.naturalWidth,
          height: loadedImage.naturalHeight,
        });
        onLoad?.(event);
      }}
      ref={imageRef}
      src={src}
      style={{
        ...style,
        ...(transform
          ? {
              transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
              transformOrigin: 'center center',
            }
          : {}),
      }}
    />
  );
}
