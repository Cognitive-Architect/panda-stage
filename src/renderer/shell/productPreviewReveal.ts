export type ProductPreviewRevealPhase =
  | 'covered'
  | 'revealing'
  | 'revealed';

export type ProductPreviewHandoffPhase = 'warming' | 'ready' | 'active';

export type ProductPreviewHandoffEvent =
  | 'paint-fence-passed'
  | 'surface-activated';

export const PRODUCT_PREVIEW_REVEAL_DURATION_MS = 160;
export const PRODUCT_PREVIEW_REDUCED_REVEAL_DURATION_MS = 100;
export const PRODUCT_PREVIEW_WARMUP_STATUS_DELAY_MS = 240;

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
 * The Preview is not allowed to own the viewport while it is warming up.
 * `ready` means that the real first frame passed the paint fence and the
 * EditorShell may commit the surface handoff. `active` is only entered after
 * that parent-owned commit.
 */
export function advanceProductPreviewHandoffPhase(
  phase: ProductPreviewHandoffPhase,
  event: ProductPreviewHandoffEvent,
): ProductPreviewHandoffPhase {
  if (phase === 'warming' && event === 'paint-fence-passed') {
    return 'ready';
  }
  if (phase === 'ready' && event === 'surface-activated') {
    return 'active';
  }
  return phase;
}

export function productPreviewRevealPhaseFromHandoff(
  phase: ProductPreviewHandoffPhase,
): ProductPreviewRevealPhase {
  if (phase === 'warming') return 'covered';
  if (phase === 'ready') return 'revealing';
  return 'revealed';
}

/**
 * Wait for two animation-frame callbacks so a data-ready Stage gets at least
 * one browser paint opportunity before the Preview can request ownership.
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
 * Legacy curtain timing helper retained for the earlier reveal contract.
 * Issue #576 no longer uses a curtain as the surface handoff mechanism.
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

export function scheduleProductPreviewWarmupStatus(
  onShow: () => void,
  scheduler: ProductPreviewRevealCompletionScheduler = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  },
): () => void {
  let disposed = false;
  const handle = scheduler.setTimeout(() => {
    if (!disposed) onShow();
  }, PRODUCT_PREVIEW_WARMUP_STATUS_DELAY_MS);

  return () => {
    disposed = true;
    scheduler.clearTimeout(handle);
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
  revealPhase: ProductPreviewRevealPhase | ProductPreviewHandoffPhase,
): boolean {
  return dataReady && (revealPhase === 'revealed' || revealPhase === 'active');
}

/**
 * While the Preview is warming, the real Editor stays visible but must not
 * receive keyboard mutations. Preview-owned controls remain usable, and
 * Escape is handled by the overlay as its cancellation path.
 */
export function shouldBlockProductPreviewWarmupKeyboard(
  key: string,
  targetInsidePreview: boolean,
): boolean {
  return key !== 'Escape' && !targetInsidePreview;
}

export interface ProductPreviewAutoplayGateInput {
  autoPlay: boolean;
  dataReady: boolean;
  durationMs: number;
  revealPhase: ProductPreviewRevealPhase | ProductPreviewHandoffPhase;
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
