import { describe, expect, it, vi } from 'vitest';
import type { AssetCanvasImageReadResponse } from '../../src/shared/asset-canvas-image-api';
import {
  CanvasImageResourceSession,
  type CanvasImageState,
} from '../../src/renderer/features/canvas/canvasImageResources';

const ASSET_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ROOT = 'D:\\Projects\\canvas-lifecycle.pandastage';
const CONTEXT = `project-1:${PROJECT_ROOT}`;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface FakeImage {
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  src: string;
  succeed(): void;
  fail(): void;
}

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

function readyImage(
  assetId = ASSET_ID,
): AssetCanvasImageReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    byteLength: 4,
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
}

function failedImage(): AssetCanvasImageReadResponse {
  return {
    ok: false,
    error: {
      code: 'ASSET_CANVAS_IMAGE_READ_FAILED',
      message: 'safe failure',
      assetId: ASSET_ID,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function createHarness(
  readCanvasImage: (
    request: { projectRoot: string; assetId: string; sha256: string },
  ) => Promise<AssetCanvasImageReadResponse> = async () => readyImage(),
): {
  session: CanvasImageResourceSession;
  readCanvasImage: ReturnType<typeof vi.fn>;
  images: FakeImage[];
  revoked: string[];
  states: CanvasImageState[];
} {
  const images: FakeImage[] = [];
  const revoked: string[] = [];
  const states: CanvasImageState[] = [];
  const read = vi.fn(readCanvasImage);
  let nextUrl = 0;
  const session = new CanvasImageResourceSession({
    readCanvasImage: read,
    createImage: () => {
      const image = createFakeImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    createObjectUrl: () => `blob:canvas-${++nextUrl}`,
    revokeObjectUrl: (url) => revoked.push(url),
  });
  return { session, readCanvasImage: read, images, revoked, states };
}

function reconcile(
  harness: ReturnType<typeof createHarness>,
  assets: Array<{ id: string; sha256?: string }>,
  contextKey: string | null = CONTEXT,
  projectRoot: string | null = PROJECT_ROOT,
): void {
  harness.session.reconcile(
    { contextKey, projectRoot, assets },
    (state) => harness.states.push(state),
  );
}

describe('Canvas image resource lifecycle — Issue #450', () => {
  it('does not re-read or re-decode unchanged sources across move, scale, and rotation commits', async () => {
    const harness = createHarness();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    harness.images[0]?.succeed();

    // Each reconcile represents a new Project snapshot after a transform-only
    // commit. The resource identity is intentionally unchanged.
    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]); // move
    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]); // scale
    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]); // rotate
    await flushMicrotasks();

    expect(harness.readCanvasImage).toHaveBeenCalledTimes(1);
    expect(harness.images).toHaveLength(1);
    expect(harness.session.getSnapshot().images.get(ASSET_ID)).toBe(
      harness.images[0],
    );
    expect(harness.revoked).toEqual([]);
  });

  it('keeps the previous decoded image visible until a changed hash is ready', async () => {
    const harness = createHarness();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    harness.images[0]?.succeed();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_B }]);
    await flushMicrotasks();

    expect(harness.readCanvasImage).toHaveBeenCalledTimes(2);
    expect(harness.session.getSnapshot().images.get(ASSET_ID)).toBe(
      harness.images[0],
    );
    expect(harness.revoked).toEqual([]);

    harness.images[1]?.succeed();
    expect(harness.session.getSnapshot().images.get(ASSET_ID)).toBe(
      harness.images[1],
    );
    expect(harness.session.getSnapshot().sourceKeys.get(ASSET_ID)).toBe(HASH_B);
    expect(harness.revoked).toEqual(['blob:canvas-1']);
  });

  it('marks missing/error sources and releases obsolete or removed resources', async () => {
    const harness = createHarness(async (request) =>
      request.sha256 === HASH_B ? failedImage() : readyImage(),
    );

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    harness.images[0]?.succeed();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_B }]);
    expect(harness.session.getSnapshot().images.get(ASSET_ID)).toBe(
      harness.images[0],
    );
    await flushMicrotasks();

    expect(harness.session.getSnapshot().images.has(ASSET_ID)).toBe(false);
    expect(harness.session.getSnapshot().missing.has(ASSET_ID)).toBe(true);
    expect(harness.revoked).toEqual(['blob:canvas-1']);

    reconcile(harness, [{ id: ASSET_ID }]);
    expect(harness.session.getSnapshot().missing.has(ASSET_ID)).toBe(true);
    reconcile(harness, []);
    expect(harness.session.getSnapshot().missing.has(ASSET_ID)).toBe(false);
  });

  it('removes a loaded image and revokes its URL when the asset leaves the shot', async () => {
    const harness = createHarness();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    harness.images[0]?.succeed();
    expect(harness.session.getSnapshot().images.has(ASSET_ID)).toBe(true);

    reconcile(harness, []);

    expect(harness.session.getSnapshot().images.has(ASSET_ID)).toBe(false);
    expect(harness.session.getSnapshot().missing.has(ASSET_ID)).toBe(false);
    expect(harness.revoked).toEqual(['blob:canvas-1']);
    harness.session.dispose();
    expect(harness.revoked).toEqual(['blob:canvas-1']);
  });

  it('ignores stale reads so an older source cannot replace the newer source', async () => {
    const readA = deferred<AssetCanvasImageReadResponse>();
    const readB = deferred<AssetCanvasImageReadResponse>();
    const harness = createHarness((request) =>
      request.sha256 === HASH_A ? readA.promise : readB.promise,
    );

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_B }]);
    await flushMicrotasks();

    readA.resolve(readyImage());
    await flushMicrotasks();
    expect(harness.images).toHaveLength(0);

    readB.resolve(readyImage());
    await flushMicrotasks();
    expect(harness.images).toHaveLength(1);
    harness.images[0]?.succeed();

    expect(harness.session.getSnapshot().sourceKeys.get(ASSET_ID)).toBe(HASH_B);
    expect(harness.readCanvasImage).toHaveBeenCalledTimes(2);
  });

  it('revokes pending and active Object URLs exactly once on replacement and dispose', async () => {
    const harness = createHarness();

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_A }]);
    await flushMicrotasks();
    expect(harness.images[0]?.src).toBe('blob:canvas-1');

    reconcile(harness, [{ id: ASSET_ID, sha256: HASH_B }]);
    await flushMicrotasks();
    expect(harness.images[0]?.src).toBe('');
    expect(harness.revoked).toEqual(['blob:canvas-1']);

    harness.images[1]?.succeed();
    harness.session.dispose();
    harness.session.dispose();
    expect(harness.revoked).toEqual(['blob:canvas-1', 'blob:canvas-2']);
  });
});
