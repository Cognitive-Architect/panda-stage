import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationDefinition, Project } from '../../src/domain';

function depsEqual(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (!prev || !next || prev.length !== next.length) return false;
  return prev.every((item, idx) => Object.is(item, next[idx]));
}

const depHarness = vi.hoisted(() => {
  type EffectSlot = {
    effect: () => void | (() => void);
    deps?: readonly unknown[];
    cleanup?: () => void;
    dirty: boolean;
  };
  type CallbackSlot = {
    fn: unknown;
    deps?: readonly unknown[];
  };
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const callbacks: CallbackSlot[] = [];
  const effects: EffectSlot[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let callbackIndex = 0;
  let effectIndex = 0;

  return {
    reset() {
      states.length = 0;
      refs.length = 0;
      callbacks.length = 0;
      effects.length = 0;
      stateIndex = 0;
      refIndex = 0;
      callbackIndex = 0;
      effectIndex = 0;
    },
    beginRender() {
      stateIndex = 0;
      refIndex = 0;
      callbackIndex = 0;
      effectIndex = 0;
    },
    useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateIndex++;
      if (!(idx in states)) states[idx] = initial;
      const setState = (next: T | ((prev: T) => T)): void => {
        const prev = states[idx] as T;
        states[idx] =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      };
      return [states[idx] as T, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const idx = refIndex++;
      if (!refs[idx]) refs[idx] = { current: initial };
      return refs[idx] as { current: T };
    },
    useCallback<T>(fn: T, deps?: readonly unknown[]): T {
      const idx = callbackIndex++;
      const slot = callbacks[idx];
      if (!slot || !depsEqual(slot.deps, deps)) {
        callbacks[idx] = { fn, deps };
      }
      return callbacks[idx]!.fn as T;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const idx = effectIndex++;
      const slot = effects[idx];
      if (!slot || !depsEqual(slot.deps, deps)) {
        effects[idx] = {
          effect,
          deps,
          cleanup: slot?.cleanup,
          dirty: true,
        };
      }
    },
    flushEffects(): { ranCount: number; initRan: boolean } {
      let ranCount = 0;
      let initRan = false;
      for (let i = 0; i < effects.length; i += 1) {
        const slot = effects[i]!;
        if (!slot.dirty) continue;
        slot.dirty = false;
        slot.cleanup?.();
        const cleanup = slot.effect();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        ranCount += 1;
        if (i === 0) initRan = true;
      }
      return { ranCount, initRan };
    },
    unmount(): void {
      for (const slot of effects) {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
    },
    getCallback(idx: number): unknown {
      return callbacks[idx]?.fn;
    },
    getState<T>(idx: number): T {
      return states[idx] as T;
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: depHarness.useState,
    useRef: depHarness.useRef,
    useCallback: depHarness.useCallback,
    useEffect: depHarness.useEffect,
  };
});

import { AnimationPreview } from '../../src/renderer/features/assets/AnimationLibraryPanel';

function makeProps(id: string) {
  const assetId = `asset-${id}`;
  const sha256 = id === 'A' ? 'a'.repeat(64) : 'b'.repeat(64);
  const animation = {
    id: `anim-${id}`,
    name: `Anim ${id}`,
    durationMs: 250,
    source: { sourceFps: 24, canvas: { width: 128, height: 128 } },
    frames: Array.from({ length: 6 }, (_, ordinal) => ({
      ordinal,
      assetId,
      sha256,
      offset: { x: 0, y: 0 },
      sourceViewport: { width: 128, height: 128 },
    })),
  } as unknown as AnimationDefinition;
  const project = {
    assets: [{ id: assetId, kind: 'image', sha256 }],
  } as unknown as Project;
  return { animation, project, projectRoot: `root-${id}`, titleId: `title-${id}` };
}

function findByTestId(
  node: unknown,
  testId: string,
): { props: Record<string, unknown> } | null {
  if (node === null || typeof node !== 'object') return null;
  const element = node as { props?: Record<string, unknown> };
  if (element.props?.['data-testid'] === testId) {
    return element as { props: Record<string, unknown> };
  }
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findByTestId(child, testId);
    if (match) return match;
  }
  return null;
}

describe('AnimationPreview E6-FIX-02 real dependency identity stability', () => {
  beforeEach(() => {
    depHarness.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps loadFrame and initialization effect stable across load, seek, and play rerenders, and resets only on animation switch', async () => {
    const readCanvasImage = vi.fn(async () => ({
      ok: true as const,
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    }));
    vi.stubGlobal('window', {
      pandaStage: { assets: { readCanvasImage } },
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview-1');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    const propsA = makeProps('A');

    // 1. Initial mount
    depHarness.beginRender();
    AnimationPreview(propsA);
    const loadFrame0 = depHarness.getCallback(1);
    const startPlayback0 = depHarness.getCallback(2);
    const mountEffects = depHarness.flushEffects();
    expect(mountEffects.initRan).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(readCanvasImage).toHaveBeenCalledTimes(1);

    // 2. Load-success rerender (frameUrl / loading state updated) -> no init rerun, no extra read
    depHarness.beginRender();
    const renderedAfterLoad = AnimationPreview(propsA);
    expect(depHarness.getCallback(1)).toBe(loadFrame0);
    expect(depHarness.getCallback(2)).toBe(startPlayback0);
    const postLoadEffects = depHarness.flushEffects();
    expect(postLoadEffects.initRan).toBe(false);
    expect(readCanvasImage).toHaveBeenCalledTimes(1);

    // 3. Seek to frame 3 -> rerender -> stays on frame 3, does not reset to 0
    const seekInput = findByTestId(renderedAfterLoad, 'animation-preview-seek')!;
    (seekInput.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '3' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(readCanvasImage).toHaveBeenCalledTimes(2);

    depHarness.beginRender();
    const renderedAfterSeek = AnimationPreview(propsA);
    expect(depHarness.flushEffects().initRan).toBe(false);
    expect(readCanvasImage).toHaveBeenCalledTimes(2);
    const stageAfterSeek = findByTestId(renderedAfterSeek, 'animation-preview-stage')!;
    expect(stageAfterSeek.props['data-frame-index']).toBe(3);

    // 4. Play -> rerender -> init effect does not rerun and playing remains true
    const playButton = findByTestId(renderedAfterSeek, 'animation-preview-play')!;
    (playButton.props.onClick as () => void)();
    depHarness.beginRender();
    const renderedPlaying = AnimationPreview(propsA);
    expect(depHarness.flushEffects().initRan).toBe(false);
    const playButtonWhilePlaying = findByTestId(
      renderedPlaying,
      'animation-preview-play',
    )!;
    expect(playButtonWhilePlaying.props['aria-label']).toBe('暂停动画');

    // 5. Real animation switch -> cleanup runs & new animation reinitializes cleanly
    const propsB = makeProps('B');
    depHarness.beginRender();
    AnimationPreview(propsB);
    expect(depHarness.getCallback(1)).not.toBe(loadFrame0);
    const switchEffects = depHarness.flushEffects();
    expect(switchEffects.initRan).toBe(true);
    expect(revokeSpy).toHaveBeenCalled();

    depHarness.unmount();
  });
});
