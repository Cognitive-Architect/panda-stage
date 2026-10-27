export interface SynchronouslyDrawableLayer {
  draw(): unknown;
}

/** Draws every output scene layer synchronously before the Stage is captured. */
export function drawStageLayersSynchronously(
  layers: readonly SynchronouslyDrawableLayer[],
): number {
  if (layers.length === 0) {
    throw new Error('The export Stage has no scene layers to draw.');
  }
  for (const layer of layers) layer.draw();
  return layers.length;
}
