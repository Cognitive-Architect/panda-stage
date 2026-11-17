import { findVisibleImageBounds, type NormalizedImageBounds } from './characterAssemblyPreview';

// Decoded image identity changes when its source changes. Share the work while it lives.
const measuredBounds = new WeakMap<HTMLImageElement, NormalizedImageBounds | null>();

export function measureImageVisibleBounds(
  image: HTMLImageElement | null | undefined,
): NormalizedImageBounds | null {
  if (
    !image ||
    !image.complete ||
    image.naturalWidth < 1 ||
    image.naturalHeight < 1 ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  if (measuredBounds.has(image)) return measuredBounds.get(image) ?? null;

  const bounds = sampleVisibleImageBounds(image);
  measuredBounds.set(image, bounds);
  return bounds;
}

function sampleVisibleImageBounds(image: HTMLImageElement): NormalizedImageBounds | null {
  const maxEdge = 256;
  const sampleScale = Math.min(
    1,
    maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
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
