import type { EditorStageRenderModel } from '../../../domain';

/** A short local grace period avoids flashing routine Canvas loading copy. */
export const CANVAS_PENDING_FEEDBACK_DELAY_MS = 300;

type CanvasFeedbackLayer = EditorStageRenderModel['layers'][number];

/** Known required-resource failures bypass the routine pending grace period. */
export function failedRequiredCanvasLayers(
  layers: readonly CanvasFeedbackLayer[],
  missingAssetIds: ReadonlySet<string>,
): CanvasFeedbackLayer[] {
  return layers.filter((stageLayer) => {
    if (stageLayer.render.isBackground) return false;
    const activeMouthId =
      stageLayer.visual.activeFace?.source === 'mouth'
        ? stageLayer.visual.activeFace.assetId
        : null;
    return stageLayer.visual.resources.required.some(
      ({ assetId }) =>
        missingAssetIds.has(assetId) && assetId !== activeMouthId,
    );
  });
}

export interface CanvasPendingFeedbackScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export function scheduleCanvasPendingFeedback(
  onShow: () => void,
  scheduler: CanvasPendingFeedbackScheduler = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  },
): () => void {
  let disposed = false;
  const handle = scheduler.setTimeout(() => {
    if (!disposed) onShow();
  }, CANVAS_PENDING_FEEDBACK_DELAY_MS);

  return () => {
    disposed = true;
    scheduler.clearTimeout(handle);
  };
}
