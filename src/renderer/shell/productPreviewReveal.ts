export type ProductPreviewRevealPhase =
  | 'covered'
  | 'revealing'
  | 'revealed';

export const PRODUCT_PREVIEW_REVEAL_DURATION_MS = 160;
export const PRODUCT_PREVIEW_REDUCED_REVEAL_DURATION_MS = 100;

export interface ProductPreviewPaintFenceScheduler {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface ProductPreviewRevealCompletionScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export type ProductPreviewRevealEvent =
  | 'paint-fence-passed'
  | 'transition-completed';

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

/**
 * Keep the fallback completion behind the opacity transition in both motion
 * modes. The transitionend handler is the normal completion path; this timer
 * only protects the state machine when a browser drops that event.
 */
export function scheduleProductPreviewRevealCompletion(
  onComplete: () => void,
  durationMs: number,
  scheduler: ProductPreviewRevealCompletionScheduler = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  },
): () => void {
  let disposed = false;
  const fallback = scheduler.setTimeout(() => {
    if (!disposed) onComplete();
  }, durationMs + 50);

  return () => {
    disposed = true;
    scheduler.clearTimeout(fallback);
  };
}

export function advanceProductPreviewRevealPhase(
  phase: ProductPreviewRevealPhase,
  event: ProductPreviewRevealEvent,
): ProductPreviewRevealPhase {
  if (phase === 'covered' && event === 'paint-fence-passed') {
    return 'revealing';
  }
  if (phase === 'revealing' && event === 'transition-completed') {
    return 'revealed';
  }
  return phase;
}

export function productPreviewRevealDurationMs(
  prefersReducedMotion: boolean,
): number {
  return prefersReducedMotion
    ? PRODUCT_PREVIEW_REDUCED_REVEAL_DURATION_MS
    : PRODUCT_PREVIEW_REVEAL_DURATION_MS;
}

/**
 * Read the effective CSS duration so JS fallback timing cannot drift from the
 * Preview curtain's media-query policy. The motion-specific constants remain
 * a safe fallback for a missing or invalid computed style.
 */
export function productPreviewRevealDurationMsFromComputedStyle(
  transitionDuration: string,
  prefersReducedMotion: boolean,
): number {
  const seconds = Number.parseFloat(transitionDuration);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : productPreviewRevealDurationMs(prefersReducedMotion);
}

export function canStartProductPreviewPlayback(
  dataReady: boolean,
  revealPhase: ProductPreviewRevealPhase,
): boolean {
  return dataReady && revealPhase === 'revealed';
}

export interface ProductPreviewAutoplayGateInput {
  autoPlay: boolean;
  dataReady: boolean;
  durationMs: number;
  revealPhase: ProductPreviewRevealPhase;
}

export function shouldStartProductPreviewAutoplay({
  autoPlay,
  dataReady,
  durationMs,
  revealPhase,
}: ProductPreviewAutoplayGateInput): boolean {
  return (
    autoPlay &&
    durationMs > 0 &&
    canStartProductPreviewPlayback(dataReady, revealPhase)
  );
}
