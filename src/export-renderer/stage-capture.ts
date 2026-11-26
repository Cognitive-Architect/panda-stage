export interface ExportSceneLayerCanvas {
  getNativeCanvasElement(): HTMLCanvasElement;
}

export interface ExportSceneStageCanvas {
  getLayers(): readonly ExportSceneLayerCanvas[];
  toCanvas(options: { pixelRatio: number }): HTMLCanvasElement;
}

export type ExportStageCaptureStrategy =
  | 'drawn-output-layer'
  | 'stage-composite';

/** Rasterize the already-composed project canvas at the frozen output size. */
export function resizeExportOutputCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (source.width === width && source.height === height) return source;
  const target = document.createElement('canvas');
  target.width = width;
  target.height = height;
  const context = target.getContext('2d');
  if (!context) throw new Error('Cannot prepare the export output canvas.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return target;
}

/** Reuses the already drawn output canvas when possible; multi-layer Stages are composited. */
export function captureExportStageCanvas(
  stage: ExportSceneStageCanvas,
): { canvas: HTMLCanvasElement; strategy: ExportStageCaptureStrategy } {
  const layers = stage.getLayers();
  if (layers.length === 0) {
    throw new Error('The export Stage has no output scene layers.');
  }
  if (layers.length === 1) {
    return {
      canvas: layers[0]!.getNativeCanvasElement(),
      strategy: 'drawn-output-layer',
    };
  }
  return {
    canvas: stage.toCanvas({ pixelRatio: 1 }),
    strategy: 'stage-composite',
  };
}
