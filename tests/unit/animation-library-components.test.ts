import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject } from '../../src/domain';
import { AnimationLibraryPanel } from '../../src/renderer/features/assets/AnimationLibraryPanel';
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
  it('renders a distinct animation item with source FPS playback and frame selection controls', () => {
    const project = projectWithAnimation();
    const markup = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: '',
    }));

    expect(markup).toContain('data-testid="animation-library-panel"');
    expect(markup).toContain('data-testid="animation-library-item"');
    expect(markup).toContain('Walk cycle');
    expect(markup).toContain('仅支持素材库预览');
    expect(markup).toContain('12 fps');
    expect(markup).toContain('data-testid="animation-preview-play"');
    expect(markup).toContain('data-testid="animation-preview-replay"');
    expect(markup).toContain('data-testid="animation-preview-seek"');
    expect(markup).toContain('aria-label="选择动画帧"');
    expect(markup).toContain('1 / 2');
  });

  it('keeps the animation list searchable by source name and target name', () => {
    const project = projectWithAnimation();
    const markup = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: 'walk.fla',
    }));
    expect(markup).toContain('Walk cycle');

    const noMatch = renderToStaticMarkup(createElement(AnimationLibraryPanel, {
      animations: project.animations,
      project,
      projectRoot: 'D:\\project.pandastage',
      searchQuery: 'missing',
    }));
    expect(noMatch).toContain('data-testid="animation-library-empty"');
  });
});
