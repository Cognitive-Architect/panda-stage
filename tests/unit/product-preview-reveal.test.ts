import { describe, expect, it } from 'vitest';
import {
  advanceProductPreviewHandoffPhase,
  advanceProductPreviewRevealPhase,
  canStartProductPreviewPlayback,
  productPreviewRevealDurationMs,
  productPreviewRevealDurationMsFromComputedStyle,
  scheduleProductPreviewPaintFence,
  scheduleProductPreviewRevealCompletion,
  scheduleProductPreviewWarmupStatus,
  shouldBlockProductPreviewWarmupKeyboard,
  shouldStartProductPreviewAutoplay,
  type ProductPreviewHandoffPhase,
  type ProductPreviewPaintFenceScheduler,
  type ProductPreviewRevealCompletionScheduler,
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

function createCompletionScheduler(): {
  scheduler: ProductPreviewRevealCompletionScheduler;
  flushNext(): void;
  nextDelay(): number;
  pendingCount(): number;
} {
  let nextHandle = 0;
  const callbacks = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();
  const scheduler: ProductPreviewRevealCompletionScheduler = {
    setTimeout(callback, delayMs) {
      const handle = ++nextHandle;
      callbacks.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeout(handle) {
      callbacks.delete(handle);
    },
  };

  return {
    scheduler,
    flushNext() {
      const first = callbacks.entries().next().value as
        | [number, { callback: () => void; delayMs: number }]
        | undefined;
      if (!first) throw new Error('no timeout is pending');
      callbacks.delete(first[0]);
      first[1].callback();
    },
    nextDelay() {
      const first = callbacks.values().next().value as
        | { callback: () => void; delayMs: number }
        | undefined;
      if (!first) throw new Error('no timeout is pending');
      return first.delayMs;
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

describe('product preview first-paint reveal', () => {
  it('requires the Editor-owned handoff after the first frame paint fence', () => {
    let phase: ProductPreviewHandoffPhase = 'warming';

    expect(advanceProductPreviewHandoffPhase(phase, 'surface-activated')).toBe(
      'warming',
    );
    phase = advanceProductPreviewHandoffPhase(phase, 'paint-fence-passed');
    expect(phase).toBe('ready');
    expect(advanceProductPreviewHandoffPhase(phase, 'paint-fence-passed')).toBe(
      'ready',
    );
    phase = advanceProductPreviewHandoffPhase(phase, 'surface-activated');
    expect(phase).toBe('active');
    expect(advanceProductPreviewHandoffPhase(phase, 'paint-fence-passed')).toBe(
      'active',
    );
  });

  it('does not allow playback before the Editor-owned surface is active', () => {
    expect(canStartProductPreviewPlayback(true, 'warming')).toBe(false);
    expect(canStartProductPreviewPlayback(true, 'ready')).toBe(false);
    expect(canStartProductPreviewPlayback(true, 'active')).toBe(true);
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: true,
        dataReady: true,
        durationMs: 4_000,
        revealPhase: 'ready',
      }),
    ).toBe(false);
    expect(
      shouldStartProductPreviewAutoplay({
        autoPlay: true,
        dataReady: true,
        durationMs: 4_000,
        revealPhase: 'active',
      }),
    ).toBe(true);
  });

  it('blocks editor keyboard mutations during warmup but preserves Preview controls', () => {
    expect(shouldBlockProductPreviewWarmupKeyboard('Delete', false)).toBe(true);
    expect(shouldBlockProductPreviewWarmupKeyboard('z', false)).toBe(true);
    expect(shouldBlockProductPreviewWarmupKeyboard(' ', false)).toBe(true);
    expect(shouldBlockProductPreviewWarmupKeyboard('Escape', false)).toBe(
      false,
    );
    expect(shouldBlockProductPreviewWarmupKeyboard('Enter', true)).toBe(false);
    expect(shouldBlockProductPreviewWarmupKeyboard(' ', true)).toBe(false);
  });

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

  it('keeps reduced motion within the short multi-frame dissolve contract', () => {
    expect(productPreviewRevealDurationMs(false)).toBe(160);
    expect(productPreviewRevealDurationMs(true)).toBe(100);
    expect(productPreviewRevealDurationMs(true)).toBeGreaterThan(
      (1_000 / 60) * 2,
    );
    expect(productPreviewRevealDurationMs(true)).toBeLessThanOrEqual(120);
    expect(productPreviewRevealDurationMs(true)).toBeGreaterThanOrEqual(80);
    expect(productPreviewRevealDurationMsFromComputedStyle('0.16s', false)).toBe(
      160,
    );
    expect(productPreviewRevealDurationMsFromComputedStyle('0.1s', true)).toBe(
      100,
    );
  });

  it('preserves covered -> revealing -> revealed in both motion modes', () => {
    for (const prefersReducedMotion of [false, true]) {
      let phase = advanceProductPreviewRevealPhase(
        'covered',
        'transition-completed',
      );
      expect(phase).toBe('covered');
      phase = advanceProductPreviewRevealPhase(phase, 'paint-fence-passed');
      expect(phase).toBe('revealing');
      phase = advanceProductPreviewRevealPhase(
        phase,
        'transition-completed',
      );
      expect(phase).toBe('revealed');
      expect(productPreviewRevealDurationMs(prefersReducedMotion)).toBeGreaterThan(
        0,
      );
    }
  });

  it('waits for a delayed completion in both modes instead of skipping a frame', () => {
    for (const prefersReducedMotion of [false, true]) {
      const fake = createCompletionScheduler();
      let phase = advanceProductPreviewRevealPhase(
        'covered',
        'paint-fence-passed',
      );
      scheduleProductPreviewRevealCompletion(
        () => {
          phase = advanceProductPreviewRevealPhase(
            phase,
            'transition-completed',
          );
        },
        productPreviewRevealDurationMs(prefersReducedMotion),
        fake.scheduler,
      );

      expect(phase).toBe('revealing');
      expect(fake.pendingCount()).toBe(1);
      expect(fake.nextDelay()).toBe(
        productPreviewRevealDurationMs(prefersReducedMotion) + 50,
      );
      fake.flushNext();
      expect(phase).toBe('revealed');
    }
  });

  it('cancels a pending reveal completion for a closed Preview', () => {
    const fake = createCompletionScheduler();
    let completed = false;
    const dispose = scheduleProductPreviewRevealCompletion(
      () => {
        completed = true;
      },
      productPreviewRevealDurationMs(true),
      fake.scheduler,
    );

    dispose();
    expect(fake.pendingCount()).toBe(0);
    expect(completed).toBe(false);
  });

  it('delays the non-blocking warmup status and cancels it on close', () => {
    const fake = createCompletionScheduler();
    let shown = false;
    const dispose = scheduleProductPreviewWarmupStatus(
      () => {
        shown = true;
      },
      fake.scheduler,
    );

    expect(fake.nextDelay()).toBe(240);
    expect(shown).toBe(false);
    dispose();
    expect(fake.pendingCount()).toBe(0);
    expect(shown).toBe(false);

    scheduleProductPreviewWarmupStatus(
      () => {
        shown = true;
      },
      fake.scheduler,
    );
    fake.flushNext();
    expect(shown).toBe(true);
  });
});
