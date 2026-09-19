import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  StageImageResourceSession,
  type StageImageResourceState,
} from '../../src/renderer/stage/stageImageResourceSession';

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  succeed(): void;
  fail(): void;
}

const LAYER_A = 'layer-a';
const LAYER_B = 'layer-b';

function createFakeImage(): FakeImage {
  return {
    onload: null,
    onerror: null,
    src: '',
    succeed() {
      this.onload?.({} as Event);
    },
    fail() {
      this.onerror?.({} as Event);
    },
  };
}

function createHarness(): {
  session: StageImageResourceSession;
  images: FakeImage[];
  states: StageImageResourceState[];
} {
  const images: FakeImage[] = [];
  const states: StageImageResourceState[] = [];
  const session = new StageImageResourceSession({
    createImage: () => {
      const image = createFakeImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
  });
  return { session, images, states };
}

function reconcile(
  harness: ReturnType<typeof createHarness>,
  layers: Array<{ id: string; sourceUrl: string }>,
): void {
  harness.session.reconcile(layers, (state) => {
    harness.states.push(state);
  });
}

describe('StageImageResourceSession', () => {
  it('wires exact current-frame readiness through StageRenderer and hidden Export', () => {
    const stageRenderer = readFileSync(
      'src/renderer/stage/StageRenderer.tsx',
      'utf8',
    );
    const exportRenderer = readFileSync(
      'src/export-renderer/ExportRendererApp.tsx',
      'utf8',
    );

    expect(stageRenderer).toContain('StageImageResourceSession');
    expect(stageRenderer).toContain(
      'imageState.state.desiredSourceKey === imageSourceKey',
    );
    expect(stageRenderer).toContain('data-stage-ready={String(ready)}');
    expect(exportRenderer).toContain('onReady={handleStageReady}');
    expect(exportRenderer).toContain('onError={handleStageError}');
  });

  it('does not announce the initial desired frame until every image is decoded', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.size).toBe(0);

    harness.images[0]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('reuses unchanged decoded sources across time and transform reconciles', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);

    expect(harness.images).toHaveLength(1);
    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
  });

  it('keeps source A committed while source B is pending, then replaces it atomically', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: false,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
    expect(harness.session.getSnapshot().desiredSourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );

    harness.images[1]!.succeed();

    expect(harness.session.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
    });
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[1],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-b',
    );
  });

  it('does not re-decode or remove unchanged siblings during one-layer replacement', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);

    expect(harness.images).toHaveLength(3);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );
  });

  it('commits simultaneous replacements only when the desired frame is complete', () => {
    const harness = createHarness();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a' },
      { id: LAYER_B, sourceUrl: 'asset-b' },
    ]);
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    reconcile(harness, [
      { id: LAYER_A, sourceUrl: 'asset-a-next' },
      { id: LAYER_B, sourceUrl: 'asset-b-next' },
    ]);
    harness.images[2]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[1],
    );

    harness.images[3]!.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[2],
    );
    expect(harness.session.getSnapshot().images.get(LAYER_B)).toBe(
      harness.images[3],
    );
  });

  it('ignores a late B completion after the desired frame returns to A', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);
    const staleB = harness.images[1]!;

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    staleB.succeed();

    expect(harness.session.getSnapshot().ready).toBe(true);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(staleB.src).toBe('');
  });

  it('keeps the last committed frame as an explicit fallback when a replacement fails', () => {
    const harness = createHarness();

    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-a' }]);
    harness.images[0]!.succeed();
    reconcile(harness, [{ id: LAYER_A, sourceUrl: 'asset-b' }]);
    harness.images[1]!.fail();

    expect(harness.session.getSnapshot().ready).toBe(false);
    expect(harness.session.getSnapshot().error).toBeInstanceOf(Error);
    expect(harness.session.getSnapshot().images.get(LAYER_A)).toBe(
      harness.images[0],
    );
    expect(harness.session.getSnapshot().sourceUrls.get(LAYER_A)).toBe(
      'asset-a',
    );
  });

  it('releases removed resources and makes late callbacks harmless after disposal', () => {
    const harness = createHarness();
    let callbackCount = 0;

    harness.session.reconcile(
      [
        { id: LAYER_A, sourceUrl: 'asset-a' },
        { id: LAYER_B, sourceUrl: 'asset-b' },
      ],
      () => {
        callbackCount += 1;
      },
    );
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    harness.session.reconcile(
      [{ id: LAYER_A, sourceUrl: 'asset-a' }],
      () => {
        callbackCount += 1;
      },
    );
    expect(harness.session.getSnapshot().images.has(LAYER_B)).toBe(false);
    expect(harness.images[1]!.onload).toBeNull();

    const callbacksBeforeDispose = callbackCount;
    harness.session.dispose();
    harness.images[0]!.succeed();
    harness.images[1]!.succeed();

    expect(callbackCount).toBe(callbacksBeforeDispose);
    expect(harness.session.getSnapshot().images.size).toBe(0);
  });
});
