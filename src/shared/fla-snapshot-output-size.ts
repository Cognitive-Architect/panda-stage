export const FLA_SNAPSHOT_MAX_WIDTH = 4_096;
export const FLA_SNAPSHOT_MAX_HEIGHT = 4_096;
export const FLA_SNAPSHOT_MAX_PIXELS = FLA_SNAPSHOT_MAX_WIDTH * FLA_SNAPSHOT_MAX_HEIGHT;

export function computeBoundedFlaGraphicOutputSize(width: number, height: number): {
  readonly outputWidth: number;
  readonly outputHeight: number;
} | null {
  const pixelScale = Math.sqrt(FLA_SNAPSHOT_MAX_PIXELS) / Math.sqrt(width) / Math.sqrt(height);
  const scale = Math.min(1, FLA_SNAPSHOT_MAX_WIDTH / width, FLA_SNAPSHOT_MAX_HEIGHT / height, pixelScale);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  let outputWidth = Math.max(1, Math.min(FLA_SNAPSHOT_MAX_WIDTH, Math.ceil(width * scale)));
  let outputHeight = Math.max(1, Math.min(FLA_SNAPSHOT_MAX_HEIGHT, Math.ceil(height * scale)));
  while (outputWidth * outputHeight > FLA_SNAPSHOT_MAX_PIXELS) {
    if (outputWidth / width >= outputHeight / height && outputWidth > 1) outputWidth -= 1;
    else if (outputHeight > 1) outputHeight -= 1;
    else return null;
  }
  return { outputWidth, outputHeight };
}
