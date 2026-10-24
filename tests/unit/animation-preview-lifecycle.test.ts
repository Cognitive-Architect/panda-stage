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
    seedSlots(entries: Array<[number, unknown]>): void {
      for (const [index, value] of entries) values[index] = value;
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

import { migrateProject, type AnimationDefinition, type Project } from '../../src/domain';
import { AnimationPreview } from '../../src/renderer/features/assets/AnimationLibraryPanel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

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

function findElementByTestId(
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
    const match = findElementByTestId(child, testId);
    if (match) return match;
  }
  return null;
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

  it('keeps Project dirty/revision and History unchanged while preview controls run', async () => {
    const projectRoot = 'D:\\preview-read-only.pandastage';
    const project = migrateProject(exampleProject);
    const image = project.assets.find((asset) => asset.kind === 'image');
    if (!image || image.kind !== 'image') throw new Error('Expected an image in the project fixture.');
    const animation = {
      id: 'preview-only-animation',
      name: 'Preview only',
      durationMs: 80,
      source: { sourceFps: 25, canvas: { width: 128, height: 128 } },
      frames: [0, 1].map((ordinal) => ({
        ordinal,
        sourceFrameIndex: ordinal,
        assetId: image.id,
        sha256: image.sha256,
        sourceViewport: { x: 0, y: 0, width: 128, height: 128 },
        offset: { x: 0, y: 0 },
        startMs: ordinal * 40,
        durationMs: 40,
        createdBySequenceImport: true,
      })),
    } as unknown as AnimationDefinition;
    const store = new EditorProjectStore();
    store.open(projectRoot, project);
    const projectSnapshot = store.getSnapshot();
    const historySnapshot = store.history.getSnapshot();
    const readCanvasImage = vi.fn(async () => successfulImageRead());
    stubPreviewEnvironment(readCanvasImage);
    hookHarness.seedSlots([
      [0, 0],
      [1, 'blob:initial-frame'],
      [2, false],
      [3, false],
      [4, null],
      [5, { current: 0 }],
      [6, { current: 'blob:initial-frame' }],
      [7, { current: 0 }],
      [8, { current: false }],
      [9, { current: null }],
      [10, { current: null }],
      [11, { current: null }],
    ]);

    const props = { animation, project, projectRoot, titleId: 'preview-only-title' };
    const firstRender = AnimationPreview(props);
    const playButton = findElementByTestId(firstRender, 'animation-preview-play');
    const onPlay = playButton?.props.onClick as (() => void) | undefined;
    expect(onPlay).toBeTypeOf('function');
    onPlay!();

    hookHarness.beginRender();
    const playingRender = AnimationPreview(props);
    const pauseButton = findElementByTestId(playingRender, 'animation-preview-play');
    const onPause = pauseButton?.props.onClick as (() => void) | undefined;
    const seek = findElementByTestId(playingRender, 'animation-preview-seek');
    const onSeek = seek?.props.onChange as ((event: { target: { value: string } }) => void) | undefined;
    const replayButton = findElementByTestId(playingRender, 'animation-preview-replay');
    const onReplay = replayButton?.props.onClick as (() => void) | undefined;
    expect(onPause).toBeTypeOf('function');
    expect(onSeek).toBeTypeOf('function');
    expect(onReplay).toBeTypeOf('function');
    onPause!();
    onSeek!({ target: { value: '1' } });
    onReplay!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readCanvasImage).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(projectSnapshot);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(store.history.getSnapshot()).toEqual(historySnapshot);
    expect(store.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });
});
