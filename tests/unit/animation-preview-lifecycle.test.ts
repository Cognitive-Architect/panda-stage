import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookHarness = vi.hoisted(() => {
  let cursor = 0;
  const values: unknown[] = [];
  let effects: Array<() => unknown> = [];

  return {
    beginRender(): void {
      cursor = 0;
      effects = [];
    },
    reset(): void {
      cursor = 0;
      values.length = 0;
      effects = [];
    },
    useState(initialValue: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = initialValue;
      const setState = (next: unknown | ((previous: unknown) => unknown)): void => {
        values[index] = typeof next === 'function'
          ? (next as (previous: unknown) => unknown)(values[index])
          : next;
      };
      return [values[index], setState] as [unknown, typeof setState];
    },
    useRef(initialValue: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initialValue };
      return values[index];
    },
    useCallback(callback: unknown) {
      cursor += 1;
      return callback;
    },
    useEffect(effect: () => unknown): void {
      cursor += 1;
      effects.push(effect);
    },
    runEffects(): Array<() => void> {
      const registeredEffects = effects;
      effects = [];
      return registeredEffects
        .map((effect) => effect())
        .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: hookHarness.useCallback,
    useEffect: hookHarness.useEffect,
    useRef: hookHarness.useRef,
    useState: hookHarness.useState,
  } as unknown as typeof actual;
});

import type { AnimationDefinition, Project } from '../../src/domain';
import { AnimationPreview } from '../../src/renderer/features/assets/AnimationLibraryPanel';

interface ImageReadResult {
  ok: boolean;
  mimeType?: string;
  bytes?: Uint8Array;
}

interface PendingImageRead {
  projectRoot: string;
  resolve: (result: ImageReadResult) => void;
}

function makeDeferredImageReader() {
  const pending: PendingImageRead[] = [];
  const read = vi.fn((request: { projectRoot: string }) => new Promise<ImageReadResult>((resolve) => {
    pending.push({ projectRoot: request.projectRoot, resolve });
  }));

  return {
    read,
    resolve(projectRoot: string, result: ImageReadResult): void {
      const request = pending.find((candidate) => candidate.projectRoot === projectRoot);
      if (!request) throw new Error(`No pending preview read for ${projectRoot}.`);
      request.resolve(result);
    },
  };
}

function makePreviewProps(projectRoot: string) {
  const assetId = `asset-${projectRoot}`;
  const sha256 = projectRoot === 'project-A' ? 'a'.repeat(64) : 'b'.repeat(64);
  const animation = {
    id: `animation-${projectRoot}`,
    name: 'Walk',
    durationMs: 40,
    source: { sourceFps: 25, canvas: { width: 128, height: 128 } },
    frames: [{
      assetId,
      sha256,
      offset: { x: 0, y: 0 },
      sourceViewport: { width: 128, height: 128 },
    }],
  } as unknown as AnimationDefinition;
  const project = {
    assets: [{ id: assetId, kind: 'image', sha256 }],
  } as unknown as Project;

  return { animation, project, projectRoot, titleId: `title-${projectRoot}` };
}

function successfulImageRead(): ImageReadResult {
  return { ok: true, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
}

function mountPreview(projectRoot: string): Array<() => void> {
  AnimationPreview(makePreviewProps(projectRoot));
  return hookHarness.runEffects();
}

function stubPreviewEnvironment(readCanvasImage: (request: { projectRoot: string }) => Promise<ImageReadResult>) {
  vi.stubGlobal('window', {
    pandaStage: { assets: { readCanvasImage } },
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
  });
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:project-B');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return { createUrl, revokeUrl };
}

describe('AnimationPreview request lifecycle', () => {
  beforeEach(() => {
    hookHarness.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['project switch', 'unmount'] as const)(
    'ignores an in-flight frame reply after %s cleanup',
    async (cleanupReason) => {
      const reader = makeDeferredImageReader();
      const { createUrl } = stubPreviewEnvironment(reader.read);
      const cleanupsA = mountPreview('project-A');

      expect(reader.read).toHaveBeenCalledTimes(1);
      cleanupsA[0]!();

      if (cleanupReason === 'project switch') {
        hookHarness.beginRender();
        const cleanupsB = mountPreview('project-B');
        reader.resolve('project-B', successfulImageRead());
        await Promise.resolve();
        await Promise.resolve();

        expect(createUrl).toHaveBeenCalledTimes(1);
        cleanupsB[0]!();
      }

      reader.resolve('project-A', successfulImageRead());
      await Promise.resolve();
      await Promise.resolve();

      expect(createUrl).toHaveBeenCalledTimes(cleanupReason === 'project switch' ? 1 : 0);
    },
  );

  it('revokes the loaded frame URL when the preview unmounts', async () => {
    const reader = makeDeferredImageReader();
    const { createUrl, revokeUrl } = stubPreviewEnvironment(reader.read);
    const cleanups = mountPreview('project-B');

    reader.resolve('project-B', successfulImageRead());
    await Promise.resolve();
    await Promise.resolve();

    expect(createUrl).toHaveBeenCalledTimes(1);
    cleanups[0]!();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:project-B');
  });
});
