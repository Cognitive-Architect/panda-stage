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
