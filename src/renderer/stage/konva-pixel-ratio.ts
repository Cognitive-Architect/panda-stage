export interface KonvaSceneLayer {
  getCanvas(): {
    getPixelRatio(): number;
    setPixelRatio(pixelRatio: number): void;
  };
  batchDraw(): unknown;
}

export const PREVIEW_CANVAS_PIXEL_RATIO = 1;

export function resolveEditorCanvasPixelRatio(
  devicePixelRatio: number,
): number {
  if (!Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), 2);
}

export function configureKonvaScenePixelRatio(
  layer: KonvaSceneLayer,
  pixelRatio: number,
): void {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new Error('Konva scene pixel ratio must be a positive finite number.');
  }
  const canvas = layer.getCanvas();
  if (canvas.getPixelRatio() === pixelRatio) return;
  canvas.setPixelRatio(pixelRatio);
  layer.batchDraw();
}
