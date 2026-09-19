import { describe, expect, it } from 'vitest';
import {
  canStartProductPreviewPlayback,
  productPreviewRevealDurationMs,
  scheduleProductPreviewPaintFence,
  shouldStartProductPreviewAutoplay,
  type ProductPreviewPaintFenceScheduler,
} from '../../src/renderer/shell/productPreviewReveal';

function createScheduler(): {
  scheduler: ProductPreviewPaintFenceScheduler;
  flushNext(): void;
  pendingCount(): number;
} {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const scheduler: ProductPreviewPaintFenceScheduler = {
    requestAnimationFrame(callback) {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      callbacks.delete(handle);
    },
  };

  return {
    scheduler,
    flushNext() {
      const first = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!first) throw new Error('no animation frame is pending');
      callbacks.delete(first[0]);
      first[1]();
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

describe('product preview first-paint reveal', () => {
  it('keeps data readiness separate from playback readiness', () => {
    expect(canStartProductPreviewPlayback(false, 'covered')).toBe(false);
    expect(canStartProductPreviewPlayback(true, 'covered')).toBe(false);
    expect(canStartProductPreviewPlayback(true, 'revealing')).toBe(false);
    expect(canStartProductPreviewPlayback(false, 'revealed')).toBe(false);
    expect(canStartProductPreviewPlayback(true, 'revealed')).toBe(true);
  });

  it('starts autoplay only after reveal and keeps autoPlay=false paused', () => {
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: false,
        dataReady: true,
        durationMs: 4_000,
        revealPhase: 'revealed',
      }),
    ).toBe(false);
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: true,
        dataReady: true,
        durationMs: 4_000,
        revealPhase: 'revealing',
      }),
    ).toBe(false);
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: true,
        dataReady: true,
        durationMs: 4_000,
        revealPhase: 'revealed',
      }),
    ).toBe(true);
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: true,
        dataReady: true,
        durationMs: 0,
        revealPhase: 'revealed',
      }),
    ).toBe(false);
  });

  it('requires two animation frames before passing the paint fence', () => {
    const fake = createScheduler();
    let passed = false;

    scheduleProductPreviewPaintFence(
      () => {
        passed = true;
      },
      fake.scheduler,
    );

    expect(fake.pendingCount()).toBe(1);
    fake.flushNext();
    expect(passed).toBe(false);
    expect(fake.pendingCount()).toBe(1);
    fake.flushNext();
    expect(passed).toBe(true);
  });

  it('cancels a pending fence so a closed Preview cannot reveal later', () => {
    const fake = createScheduler();
    let passed = false;
    const dispose = scheduleProductPreviewPaintFence(
      () => {
        passed = true;
      },
      fake.scheduler,
    );

    fake.flushNext();
    dispose();

    expect(fake.pendingCount()).toBe(0);
    expect(passed).toBe(false);
  });

  it('keeps the reduced-motion transition short without removing the fence', () => {
    expect(productPreviewRevealDurationMs(false)).toBe(160);
    expect(productPreviewRevealDurationMs(true)).toBe(1);
  });
});
