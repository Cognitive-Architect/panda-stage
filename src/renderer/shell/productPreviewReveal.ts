export type ProductPreviewRevealPhase =
  | 'covered'
  | 'revealing'
  | 'revealed';

export const PRODUCT_PREVIEW_REVEAL_DURATION_MS = 160;
export const PRODUCT_PREVIEW_REDUCED_REVEAL_DURATION_MS = 1;

export interface ProductPreviewPaintFenceScheduler {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

/**
 * Wait for two animation-frame callbacks so a data-ready Stage gets at least
 * one browser paint opportunity while the Preview curtain is still opaque.
 * The returned disposer also makes a close/reopen cycle unable to resurrect
 * the previous Preview's reveal callback.
 */
export function scheduleProductPreviewPaintFence(
  onPassed: () => void,
  scheduler: ProductPreviewPaintFenceScheduler = {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  },
): () => void {
  let disposed = false;
  let firstFrame = 0;
  let secondFrame = 0;

  firstFrame = scheduler.requestAnimationFrame(() => {
    if (disposed) return;
    secondFrame = scheduler.requestAnimationFrame(() => {
      if (!disposed) onPassed();
    });
  });

  return () => {
    disposed = true;
    scheduler.cancelAnimationFrame(firstFrame);
    if (secondFrame !== 0) scheduler.cancelAnimationFrame(secondFrame);
  };
}

export function productPreviewRevealDurationMs(
  prefersReducedMotion: boolean,
): number {
  return prefersReducedMotion
    ? PRODUCT_PREVIEW_REDUCED_REVEAL_DURATION_MS
    : PRODUCT_PREVIEW_REVEAL_DURATION_MS;
}

export function canStartProductPreviewPlayback(
  dataReady: boolean,
  revealPhase: ProductPreviewRevealPhase,
): boolean {
  return dataReady && revealPhase === 'revealed';
}
