import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ProjectSchema, migrateProject } from '../../src/domain';
import {
  AnimationLibraryPanel,
  AnimationPreview,
  createAnimationCoverLoader,
} from '../../src/renderer/features/assets/AnimationLibraryPanel';
import { createAnimationImageBlob } from '../../src/renderer/features/assets/animationImageBytes';
import exampleProject from '../../demo-project/project-v1.example.json';

function projectWithAnimation() {
  const project = migrateProject(exampleProject);
  const image = project.assets.find((asset) => asset.kind === 'image');
  if (!image || image.kind !== 'image') throw new Error('Expected image fixture.');
  const sha256 = 'a'.repeat(64);
  const frameDurationMs = 1_000 / 12;
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === image.id ? { ...asset, sha256 } : asset,
    ),
    animations: [{
      id: '70000000-0000-4000-8000-000000000001',
      name: 'Walk',
      source: {
        basename: 'walk.fla',
        sha256: 'b'.repeat(64),
        renderTargetId: 'fla-render-target-test-walk',
        targetKind: 'graphic-symbol',
        targetName: 'Walk cycle',
        startFrameIndex: 4,
        endFrameIndex: 5,
        sourceFps: 12,
        canvas: { width: 1920, height: 1080 },
        documentCanvas: { width: 1920, height: 1080 },
        anchor: { x: 960, y: 540 },
      },
      durationMs: 2 * frameDurationMs,
      frames: [0, 1].map((ordinal) => ({
        ordinal,
        sourceFrameIndex: 4 + ordinal,
        assetId: image.id,
        sha256,
        sourceViewport: { x: 960, y: 540, width: 1920, height: 1080 },
        offset: { x: 0, y: 0 },
        startMs: ordinal * frameDurationMs,
        durationMs: frameDurationMs,
        createdBySequenceImport: true,
      })),
    }],
  });
}

describe('animation library', () => {
  it('creates a Blob from exactly the visible Uint8Array byte range', async () => {
    const backing = new Uint8Array([10, 20, 30, 40]);
    const blob = createAnimationImageBlob(backing.subarray(1, 3), 'image/png');

    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([20, 30]);
  });

  it('renders one unified-grid animation card with concise source timing', () => {
    const project = projectWithAnimation();
    const markup = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: '',
    }));

    expect(markup).toContain('data-testid="animation-library-panel"');
    expect(markup).toContain('data-testid="animation-library-card"');
    expect(markup).toContain('data-category="animation"');
    expect(markup).toContain('Walk');
    expect(markup).toContain('2 帧 · 0.17 秒');
    expect(markup).toContain('12 FPS');
    expect(markup).not.toContain('Walk cycle');
    expect(markup).not.toContain('animation-preview-dialog');
  });

  it('keeps the animation list searchable by source name and target name', () => {
    const project = projectWithAnimation();
    const markup = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: 'walk.fla',
    }));
    expect(markup).toContain('Walk');

    const noMatch = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: 'missing',
    }));
    expect(noMatch).toContain('data-testid="animation-library-empty"');
  });

  it('renders the modal preview without duplicating source FPS or frame metadata', () => {
    const project = projectWithAnimation();
    const animation = project.animations[0]!;
    const markup = renderToStaticMarkup(createElement(AnimationPreview, {
      animation,
      project,
      projectRoot: 'D:\\project.pandastage',
      titleId: 'animation-preview-title',
    }));

    expect(markup).toContain('id="animation-preview-title">Walk</strong>');
    expect(markup).not.toContain('12 FPS');
    expect(markup).not.toContain('12 fps');
    expect(markup).not.toContain('2 帧 ·');
    expect(markup).not.toContain('<span>帧</span>');
    expect(markup).toContain('aria-label="选择动画帧"');
    expect(markup).toContain('1 / 2');
    expect(markup).toContain('data-testid="animation-preview-replay"');
    expect(markup).toContain('data-testid="animation-preview-play"');
  });

  it('loads a cover only while visible and revokes its URL when it leaves view', async () => {
    const deferredReads: Array<(value: { ok: boolean; mimeType?: string; bytes?: Uint8Array }) => void> = [];
    const read = vi.fn(() => new Promise<{ ok: boolean; mimeType?: string; bytes?: Uint8Array }>(
      (resolve) => deferredReads.push(resolve),
    ));
    const createUrl = vi.fn(() => 'blob:animation-cover');
    const revokeUrl = vi.fn();
    const onStateChange = vi.fn();
    const loader = createAnimationCoverLoader({ read, createUrl, revokeUrl, onStateChange });

    expect(read).not.toHaveBeenCalled();
    loader.setVisible(true);
    expect(read).toHaveBeenCalledTimes(1);
    loader.setVisible(false);
    deferredReads[0]!({ ok: true, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(createUrl).not.toHaveBeenCalled();

    loader.setVisible(true);
    expect(read).toHaveBeenCalledTimes(2);
    deferredReads[1]!({ ok: true, mimeType: 'image/png', bytes: new Uint8Array([4, 5, 6]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(onStateChange).toHaveBeenLastCalledWith({
      url: 'blob:animation-cover',
      error: false,
      loading: false,
    });

    loader.setVisible(false);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:animation-cover');
    expect(onStateChange).toHaveBeenLastCalledWith({ url: null, error: false, loading: false });
    loader.dispose();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:animation-cover');
  });

  it('discards stale replies on disposal and preserves the unavailable-cover state', async () => {
    let resolveRead!: (value: { ok: boolean; mimeType?: string; bytes?: Uint8Array }) => void;
    const createUrl = vi.fn(() => 'blob:stale-cover');
    const onStateChange = vi.fn();
    const loader = createAnimationCoverLoader({
      read: () => new Promise((resolve) => { resolveRead = resolve; }),
      createUrl,
      revokeUrl: vi.fn(),
      onStateChange,
    });

    loader.setVisible(true);
    const stateCountBeforeDispose = onStateChange.mock.calls.length;
    loader.dispose();
    resolveRead({ ok: true, mimeType: 'image/png', bytes: new Uint8Array([1]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(createUrl).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledTimes(stateCountBeforeDispose);

    const failedState = vi.fn();
    const failedLoader = createAnimationCoverLoader({
      read: async () => ({ ok: false }),
      createUrl: vi.fn(() => 'blob:unused'),
      revokeUrl: vi.fn(),
      onStateChange: failedState,
    });
    failedLoader.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(failedState).toHaveBeenLastCalledWith({ url: null, error: true, loading: false });
    failedLoader.dispose();
  });

  it('revokes a loaded cover when its card unmounts', async () => {
    const revokeUrl = vi.fn();
    const loader = createAnimationCoverLoader({
      read: async () => ({ ok: true, mimeType: 'image/png', bytes: new Uint8Array([1]) }),
      createUrl: () => 'blob:unmounted-cover',
      revokeUrl,
      onStateChange: vi.fn(),
    });

    loader.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();
    loader.dispose();

    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:unmounted-cover');
  });

  it('matches the animation cover style to the classes on the preview element', async () => {
    const css = await readFile('src/renderer/styles/features/assets/animation-library.css', 'utf8');

    expect(css).toContain('.asset-card-preview.animation-library-card-preview {');
    expect(css).not.toContain('.asset-card.animation-library-card-preview');
  });
});
