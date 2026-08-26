import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import {
  AssetCard,
  formatAssetDuration,
} from '../../src/renderer/features/assets/AssetCard';
import { AssetDetails } from '../../src/renderer/features/assets/AssetDetails';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const noop = () => undefined;

function directPayload(assetId: string) {
  return {
    version: 2 as const,
    type: 'asset-image' as const,
    assetId,
  };
}

describe('Issue #343 portrait Assets media library', () => {
  it('uses truthful media-specific card presentation and metadata', () => {
    const project = migrateProject(exampleProject);
    const background = project.assets.find(
      (asset) => asset.relativePath.includes('bamboo'),
    )!;
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const readyThumbnail = {
      status: 'ready' as const,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    };

    const backgroundMarkup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: background,
        category: 'background',
        contextLabel: '图片',
        dragging: false,
        dropPayload: directPayload(background.id),
        onDragEnd: noop,
        onDragStart: noop,
        onRebuildThumbnail: noop,
        onSelect: noop,
        onThumbnailError: noop,
        selected: false,
        thumbnail: readyThumbnail,
      }),
    );
    const audioMarkup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: audio,
        category: 'audio',
        contextLabel: '音频',
        dragging: false,
        dropPayload: {
          version: 2 as const,
          type: 'audio' as const,
          assetId: audio.id,
        },
        onDragEnd: noop,
        onDragStart: noop,
        onRebuildThumbnail: noop,
        onSelect: noop,
        onThumbnailError: noop,
        selected: false,
        thumbnail: { status: 'loading' },
      }),
    );

    expect(backgroundMarkup).toContain('data-asset-type="background"');
    expect(backgroundMarkup).toContain('>背景</span>');
    expect(backgroundMarkup).toContain('1920 × 1080 px');
    expect(backgroundMarkup).toContain('data-media-kind="image"');
    expect(audioMarkup).toContain('data-asset-type="audio"');
    expect(audioMarkup).toContain('asset-card-audio-placeholder');
    expect(audioMarkup).toContain('3.00 秒');
    expect(audioMarkup).not.toContain('♫');
    expect(formatAssetDuration(65_000)).toBe('1:05');
    expect(formatAssetDuration(undefined)).toBe('时长未知');
  });

  it('reuses AssetDetails for an audio summary without inventing source state', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset: audio,
        busy: false,
        onDelete: noop,
        references: [],
      }),
    );

    expect(markup).toContain('asset-details-preview-audio');
    expect(markup).toContain('3.00 秒');
    expect(markup).toContain('尚未读取源文件状态');
    expect(markup).toContain(audio.relativePath);
  });

  it('keeps the portrait browser controls and optional FLA placement on existing owners', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        hideHeading: true,
        showFlaAction: false,
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 3,
        },
      }),
    );
    const library = source('src/renderer/features/assets/AssetLibrary.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(markup).toContain('asset-library-search-control');
    expect(markup).toContain('asset-library-search-input');
    expect(markup).toContain('全部');
    expect(markup).toContain('角色');
    expect(markup).toContain('背景');
    expect(markup).toContain('音频');
    expect(markup).not.toContain('data-testid="asset-import-fla"');
    expect(library).toContain('data-testid="asset-selected-summary"');
    expect(library).toContain('flaReviewRequestToken');
    expect(dock).toContain('Upload');
    expect(dock).toContain('FileArchive');
    expect(dock).toContain('resource-activity-fla-action');
  });
});
