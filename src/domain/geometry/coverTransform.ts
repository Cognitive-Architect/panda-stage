import type { Point, Size } from './viewportTransform';

export interface CoverTransform extends Point, Size {
  scale: number;
}

export function calculateCoverTransform(
  source: Size,
  destination: Size,
): CoverTransform | null {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    !Number.isFinite(destination.width) ||
    !Number.isFinite(destination.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    destination.width <= 0 ||
    destination.height <= 0
  ) {
    return null;
  }
  const scale = Math.max(
    destination.width / source.width,
    destination.height / source.height,
  );
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    scale,
    width,
    height,
    x: (destination.width - width) / 2,
    y: (destination.height - height) / 2,
  };
}
